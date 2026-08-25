import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  paramsHashOf,
  type AgentAction,
  type Confirmation,
  type PolicyInput,
} from "@sga/contract/public";
import { evaluatePolicy } from "../../packages/policy/src/policy";
import {
  startTestControlPlane,
  TEST_EXTENSION_ORIGIN,
  type TestControlPlane,
} from "../helpers/control-plane";

let server: TestControlPlane;
let token: string;
let turnId: string;

interface ApiInit {
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}

async function api(path: string, init: ApiInit = {}): Promise<Response> {
  return fetch(`${server.baseUrl}${path}`, {
    ...(init.method === undefined ? {} : { method: init.method }),
    ...(init.body === undefined ? {} : { body: init.body }),
    headers: {
      origin: TEST_EXTENSION_ORIGIN,
      "content-type": "application/json",
      "x-sga-device-token": token,
      ...(init.headers ?? {}),
    },
  });
}

async function registerDevice(): Promise<string> {
  const response = await fetch(`${server.baseUrl}/v1/device`, {
    method: "POST",
    headers: { origin: TEST_EXTENSION_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ deviceId: randomUUID() }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { sessionToken: string }).sessionToken;
}

async function storedConfirmation(actionId: string): Promise<Confirmation | null> {
  const rows = await server.pool.query<{ params_hash: string; approved: boolean }>(
    "SELECT params_hash, approved FROM confirmation WHERE action_id = $1",
    [actionId],
  );
  const row = rows.rows[0];
  if (row === undefined) return null;
  return { actionId, paramsHash: row.params_hash, approved: row.approved };
}

beforeAll(async () => {
  server = await startTestControlPlane();
  token = await registerDevice();
  const digest = { url: "https://app.example.com/billing", title: "Billing", nodes: [] };
  const started = await api("/v1/task", {
    method: "POST",
    body: JSON.stringify({
      origin: "https://app.example.com",
      url: digest.url,
      tier: "control",
      taskText: "update the billing email",
      digest,
      adapterSetVersion: null,
    }),
  });
  expect(started.status).toBe(202);
  turnId = ((await started.json()) as { turnId: string }).turnId;
});

afterAll(async () => {
  await server.stop();
});

describe("the confirmation round trip", () => {
  const clickA: AgentAction = { kind: "click", target: { id: "e0000000a" } };
  const clickB: AgentAction = { kind: "click", target: { id: "e0000000b" } };

  function policyInput(overrides: Partial<PolicyInput>): PolicyInput {
    return {
      actionId: randomUUID(),
      action: clickA,
      paramsHash: "0".repeat(64),
      risk: "write",
      adapterMatched: true,
      siteActivated: true,
      tier: "control",
      confirmation: null,
      ...overrides,
    };
  }

  it("stores an approval once, even when the extension delivers it twice", async () => {
    const actionId = randomUUID();
    const paramsHash = await paramsHashOf(clickA);
    const body = JSON.stringify({ turnId, actionId, paramsHash, approved: true });
    expect((await api("/v1/confirm", { method: "POST", body })).status).toBe(204);
    expect((await api("/v1/confirm", { method: "POST", body })).status).toBe(204);

    const rows = await server.pool.query("SELECT 1 FROM confirmation WHERE action_id = $1", [
      actionId,
    ]);
    expect(rows.rowCount).toBe(1);
    const steps = await server.pool.query(
      "SELECT 1 FROM trajectory WHERE turn_id = $1 AND kind = 'confirmation' AND payload->>'actionId' = $2",
      [turnId, actionId],
    );
    expect(steps.rowCount).toBe(1);
  });

  it("authorises exactly the action and params it was granted for", async () => {
    const actionId = randomUUID();
    const paramsHash = await paramsHashOf(clickA);
    const posted = await api("/v1/confirm", {
      method: "POST",
      body: JSON.stringify({ turnId, actionId, paramsHash, approved: true }),
    });
    expect(posted.status).toBe(204);

    const confirmation = await storedConfirmation(actionId);
    expect(confirmation).not.toBeNull();

    expect(evaluatePolicy(policyInput({ actionId, paramsHash, confirmation }))).toEqual({
      kind: "proceed",
    });
    expect(
      evaluatePolicy(
        policyInput({
          actionId: randomUUID(),
          action: clickB,
          paramsHash: await paramsHashOf(clickB),
          confirmation,
        }),
      ),
    ).toEqual({ kind: "refuse", reason: "confirmation_mismatch" });
    expect(
      evaluatePolicy(
        policyInput({
          actionId,
          action: { kind: "type", target: { id: "e0000000a" }, value: "attacker@evil.example" },
          paramsHash: await paramsHashOf({
            kind: "type",
            target: { id: "e0000000a" },
            value: "attacker@evil.example",
          }),
          confirmation,
        }),
      ),
    ).toEqual({ kind: "refuse", reason: "confirmation_mismatch" });
  });

  it("treats a stored decline as a refusal", async () => {
    const actionId = randomUUID();
    const paramsHash = await paramsHashOf(clickA);
    const posted = await api("/v1/confirm", {
      method: "POST",
      body: JSON.stringify({ turnId, actionId, paramsHash, approved: false }),
    });
    expect(posted.status).toBe(204);

    const confirmation = await storedConfirmation(actionId);
    expect(evaluatePolicy(policyInput({ actionId, paramsHash, confirmation }))).toEqual({
      kind: "refuse",
      reason: "declined_by_user",
    });
  });

  it("records a replayed action result exactly once", async () => {
    const actionId = randomUUID();
    const body = JSON.stringify({
      turnId,
      actionId,
      result: {
        status: "completed",
        delta: { added: [], removed: [], changed: [], urlChanged: null, titleChanged: null },
      },
      digest: null,
    });
    expect((await api("/v1/action-result", { method: "POST", body })).status).toBe(204);
    expect((await api("/v1/action-result", { method: "POST", body })).status).toBe(204);

    const rows = await server.pool.query("SELECT 1 FROM action_result WHERE action_id = $1", [
      actionId,
    ]);
    expect(rows.rowCount).toBe(1);
    const steps = await server.pool.query(
      "SELECT 1 FROM trajectory WHERE turn_id = $1 AND kind = 'action-result' AND payload->>'actionId' = $2",
      [turnId, actionId],
    );
    expect(steps.rowCount).toBe(1);
  });

  it("rejects a confirmation aimed at another device's turn", async () => {
    const strangerToken = await registerDevice();
    const response = await api("/v1/confirm", {
      method: "POST",
      body: JSON.stringify({
        turnId,
        actionId: randomUUID(),
        paramsHash: await paramsHashOf(clickA),
        approved: true,
      }),
      headers: { "x-sga-device-token": strangerToken },
    });
    expect(response.status).toBe(404);
  });
});
