import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { PageDigest, TurnEvent } from "@sga/contract/public";
import { loadAdapterDirectory } from "../../apps/control-plane/src/adapters-fs";
import { TurnAgent } from "../../apps/control-plane/src/agent/loop";
import {
  startTestControlPlane,
  TEST_EXTENSION_ORIGIN,
  type TestControlPlane,
} from "../helpers/control-plane";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock;

const ADAPTERS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../adapters");

let server: TestControlPlane;
let token: string;
const scripts = new Map<string, BetaMessage[]>();

function modelMessage(content: ContentBlock[], stopReason: BetaMessage["stop_reason"]): BetaMessage {
  return {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    container: null,
    context_management: null,
    diagnostics: null,
    content,
    stop_reason: stopReason,
    stop_details: null,
    stop_sequence: null,
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      fallback_credit: null,
      inference_geo: null,
      input_tokens: 100,
      iterations: null,
      output_tokens: 10,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
      speed: null,
    },
  };
}

function toolUse(name: string, input: unknown): ContentBlock {
  return { type: "tool_use", id: `toolu_${randomUUID()}`, name, input, caller: { type: "direct" } };
}

function taskTextOf(request: { messages: { content: unknown }[] }): string {
  const first = request.messages[0];
  const content = typeof first?.content === "string" ? first.content : "";
  const match = /^Task from the person: (.*)$/m.exec(content);
  if (match?.[1] === undefined) throw new Error("no task text in the first message");
  return match[1];
}

function node(
  id: string,
  role: string,
  name: string,
  value?: string,
): PageDigest["nodes"][number] {
  return {
    id,
    parentId: null,
    role,
    name,
    ...(value === undefined ? {} : { value }),
    state: { disabled: false },
    inViewport: true,
  };
}

function teamPage(origin: string, options: { saved: boolean; withEmailField: boolean }): PageDigest {
  return {
    url: `${origin}/settings/team`,
    title: "Team — Acme Workspace",
    nodes: [
      node("e00000001", "heading", "Team members"),
      ...(options.withEmailField ? [node("e00000002", "textbox", "Email")] : []),
      node("e00000003", "button", "Invite member"),
      ...(options.saved ? [node("e00000004", "status", "Invitation sent")] : []),
    ],
  };
}

function billingPage(origin: string): PageDigest {
  return {
    url: `${origin}/settings/billing`,
    title: "Billing — Acme Workspace",
    nodes: [
      node("e00000010", "heading", "Billing address"),
      node("e00000011", "textbox", "Address line 1", "1 Front St"),
      node("e00000012", "button", "Save address"),
    ],
  };
}

function dashboardPage(origin: string): PageDigest {
  return {
    url: `${origin}/`,
    title: "Dashboard — Acme Workspace",
    nodes: [node("e00000020", "heading", "Dashboard")],
  };
}

async function api(path: string, body: unknown): Promise<Response> {
  return fetch(`${server.baseUrl}${path}`, {
    method: "POST",
    headers: {
      origin: TEST_EXTENSION_ORIGIN,
      "content-type": "application/json",
      "x-sga-device-token": token,
    },
    body: JSON.stringify(body),
  });
}

const SITE_ORIGIN = "http://127.0.0.1:1";

async function startTask(taskText: string, digest: PageDigest): Promise<string> {
  const response = await api("/v1/task", {
    origin: SITE_ORIGIN,
    url: digest.url,
    tier: "control",
    taskText,
    digest,
    adapterSetVersion: 1,
  });
  expect(response.status).toBe(202);
  return ((await response.json()) as { turnId: string }).turnId;
}

async function events(turnId: string): Promise<TurnEvent[]> {
  return server.store.eventsAfter(turnId, -1);
}

async function eventually<T>(probe: () => Promise<T | null>, what: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const found = await probe();
    if (found !== null) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function awaitReport(
  turnId: string,
): Promise<Extract<TurnEvent, { kind: "report" }>> {
  return eventually(async () => {
    const all = await events(turnId);
    const found = all.find(
      (event): event is Extract<TurnEvent, { kind: "report" }> => event.kind === "report",
    );
    return found ?? null;
  }, `report on ${turnId}`);
}

async function deliver(
  turnId: string,
  actionId: string,
  digest: PageDigest | null,
): Promise<void> {
  const response = await api("/v1/action-result", {
    turnId,
    actionId,
    result: {
      status: "completed",
      delta: { added: [], removed: [], changed: [], urlChanged: null, titleChanged: null },
    },
    digest,
  });
  expect(response.status).toBe(204);
}

// Plays the extension's role: answers each dispatched action with a digest chosen
// by a state machine over the little fixture site.
function answerActions(turnId: string, state: { saved: boolean; withEmailField: boolean }): {
  stop: () => void;
} {
  const seen = new Set<string>();
  const loop = { running: true };
  void (async () => {
    while (loop.running) {
      const all = await events(turnId).catch(() => []);
      for (const event of all) {
        if (event.kind !== "action-request" || event.needsConfirmation) continue;
        if (seen.has(event.actionId)) continue;
        seen.add(event.actionId);
        if (event.action.kind === "click") state.saved = true;
        const digest =
          event.action.kind === "navigate"
            ? null
            : teamPage(SITE_ORIGIN, { saved: state.saved, withEmailField: state.withEmailField });
        await deliver(turnId, event.actionId, digest);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
  return {
    stop: () => {
      loop.running = false;
    },
  };
}

async function trajectoryRows(turnId: string): Promise<{ kind: string; payload: unknown }[]> {
  const rows = await server.pool.query<{ kind: string; payload: unknown }>(
    "SELECT kind, payload FROM trajectory WHERE turn_id = $1 ORDER BY seq",
    [turnId],
  );
  return rows.rows;
}

beforeAll(async () => {
  server = await startTestControlPlane(
    { SGA_STEP_BUDGET: "4" },
    (context) =>
      new TurnAgent({
        ...context,
        plan: (request) => {
          const script = scripts.get(taskTextOf(request));
          const next = script?.shift();
          if (next === undefined) throw new Error("the test script is out of responses");
          return Promise.resolve(next);
        },
        scan: () => Promise.resolve({ suspicious: false, findings: [] }),
        waits: { resultTimeoutMs: 8000, confirmTimeoutMs: 8000, pollMs: 50 },
      }),
    loadAdapterDirectory(ADAPTERS_DIR),
  );
  const registered = await fetch(`${server.baseUrl}/v1/device`, {
    method: "POST",
    headers: { origin: TEST_EXTENSION_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ deviceId: randomUUID() }),
  });
  expect(registered.status).toBe(200);
  token = ((await registered.json()) as { sessionToken: string }).sessionToken;
});

afterAll(async () => {
  await server.stop();
});

describe("the resolution ladder", () => {
  it("L1: a reviewed capability runs to a satisfied predicate after one confirmation", async () => {
    const task = `invite kim by capability ${randomUUID()}`;
    scripts.set(task, [
      modelMessage(
        [
          toolUse("adapter_capability", {
            id: "seat.invite",
            params: [{ name: "email", value: "kim@example.com" }],
          }),
        ],
        "tool_use",
      ),
      modelMessage(
        [toolUse("finish", { outcome: "completed", detail: "kim is invited" })],
        "tool_use",
      ),
    ]);
    const turnId = await startTask(task, teamPage(SITE_ORIGIN, { saved: false, withEmailField: true }));

    const asked = await eventually(async () => {
      const all = await events(turnId);
      return (
        all.find(
          (event): event is Extract<TurnEvent, { kind: "action-request" }> =>
            event.kind === "action-request" && event.needsConfirmation,
        ) ?? null
      );
    }, "capability confirmation");
    expect(asked.summary).toContain("seat.invite");
    expect(asked.summary).toContain("kim@example.com");

    const answering = answerActions(turnId, { saved: false, withEmailField: true });
    const approved = await api("/v1/confirm", {
      turnId,
      actionId: asked.actionId,
      paramsHash: asked.paramsHash,
      approved: true,
    });
    expect(approved.status).toBe(204);

    const report = await awaitReport(turnId);
    answering.stop();
    expect(report.outcome).toBe("completed");
    expect(report.failedPredicate).toBeNull();
    expect(report.lastVerifiedState).toContain("seat.invite");

    const rows = await trajectoryRows(turnId);
    const planned = rows.find((row) => row.kind === "action-planned");
    expect((planned?.payload as { level?: string }).level).toBe("L1");
    const observations = rows.filter((row) => row.kind === "observation");
    const verified = observations.find((row) => {
      const payload = row.payload as { predicates?: { satisfied: boolean }[] };
      return payload.predicates?.every((entry) => entry.satisfied) ?? false;
    });
    expect(verified).toBeDefined();
  });

  it("L2: a reviewed route navigates and hands back the new page, unconfirmed", async () => {
    const task = `go to billing by route ${randomUUID()}`;
    scripts.set(task, [
      modelMessage([toolUse("adapter_route", { id: "billing.address", params: [] })], "tool_use"),
      modelMessage(
        [
          toolUse("page_action", {
            action: { kind: "readBack", target: { id: "e00000010" } },
            expect: [{ kind: "url-matches", contains: "/settings/billing" }],
            summary: "Confirm we are on the billing page",
          }),
        ],
        "tool_use",
      ),
      modelMessage(
        [toolUse("finish", { outcome: "completed", detail: "on the billing page" })],
        "tool_use",
      ),
    ]);
    const turnId = await startTask(task, dashboardPage(SITE_ORIGIN));

    const seen = new Set<string>();
    const answering = (() => {
      const loop = { running: true };
      void (async () => {
        while (loop.running) {
          const all = await events(turnId).catch(() => []);
          for (const event of all) {
            if (event.kind !== "action-request" || event.needsConfirmation) continue;
            if (seen.has(event.actionId)) continue;
            seen.add(event.actionId);
            await deliver(
              turnId,
              event.actionId,
              event.action.kind === "navigate" ? null : billingPage(SITE_ORIGIN),
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      })();
      return {
        stop: () => {
          loop.running = false;
        },
      };
    })();

    const report = await awaitReport(turnId);
    answering.stop();
    expect(report.outcome).toBe("completed");

    const all = await events(turnId);
    expect(all.some((event) => event.kind === "action-request" && event.needsConfirmation)).toBe(
      false,
    );
    const rows = await trajectoryRows(turnId);
    const planned = rows.find(
      (row) => (row.payload as { level?: string }).level === "L2",
    );
    expect(planned).toBeDefined();
  });

  it("an induced failure produces an honest report, never a completion claim", async () => {
    const task = `invite against a broken page ${randomUUID()}`;
    scripts.set(task, [
      modelMessage(
        [
          toolUse("adapter_capability", {
            id: "seat.invite",
            params: [{ name: "email", value: "kim@example.com" }],
          }),
        ],
        "tool_use",
      ),
      modelMessage(
        [toolUse("finish", { outcome: "completed", detail: "kim is invited" })],
        "tool_use",
      ),
    ]);
    // The Email field is missing from the page, so step resolution must fail.
    const turnId = await startTask(
      task,
      teamPage(SITE_ORIGIN, { saved: false, withEmailField: false }),
    );

    const asked = await eventually(async () => {
      const all = await events(turnId);
      return (
        all.find(
          (event): event is Extract<TurnEvent, { kind: "action-request" }> =>
            event.kind === "action-request" && event.needsConfirmation,
        ) ?? null
      );
    }, "capability confirmation");
    const answering = answerActions(turnId, { saved: false, withEmailField: false });
    await api("/v1/confirm", {
      turnId,
      actionId: asked.actionId,
      paramsHash: asked.paramsHash,
      approved: true,
    });

    const report = await awaitReport(turnId);
    answering.stop();
    expect(report.outcome).toBe("not-completed");

    const status = await server.pool.query<{ status: string }>(
      "SELECT status FROM turn WHERE id = $1",
      [turnId],
    );
    expect(status.rows[0]?.status).toBe("failed");
    const rows = await trajectoryRows(turnId);
    const recorded = rows.find((row) => row.kind === "report");
    expect((recorded?.payload as { claimed?: string }).claimed).toBe("completed");
    expect((recorded?.payload as { outcome?: string }).outcome).toBe("not-completed");
  });
});
