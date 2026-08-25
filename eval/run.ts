import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import type { BrowserContext, Page } from "@playwright/test";
import {
  EXTENSION_ID,
  launchWithExtension,
  serviceWorkerOf,
  stageExtension,
} from "../tests/e2e/helpers/launch";
import {
  spawnControlPlane,
  type ControlPlaneProcess,
} from "../tests/e2e/helpers/control-plane-process";
import {
  spawnFixtureApp,
  type FixtureAppProcess,
} from "../tests/e2e/helpers/fixture-app-process";
import { appDatabaseUrl } from "../tests/helpers/db";
import { evalTaskSchema, type EvalOutcome, type EvalTask } from "./schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW = { width: 1280, height: 720 };
const TURN_TIMEOUT_MS = 240_000;
// One retry per task, fixed; a task that fails twice is a failure, never
// retried away. Thresholds are documented in eval/README.md.
const RETRIES = 1;
const THRESHOLDS: Record<string, number> = { on: 0.8, off: 0.6 };

function parseMode(): "on" | "off" {
  const flag = process.argv.find((argument) => argument.startsWith("--adapters="));
  const value = flag?.split("=")[1];
  if (value !== "on" && value !== "off") {
    process.stderr.write("usage: pnpm eval --adapters=on|off\n");
    process.exit(2);
  }
  return value;
}

function loadTasks(): EvalTask[] {
  const dir = join(HERE, "tasks");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => evalTaskSchema.parse(JSON.parse(readFileSync(join(dir, name), "utf8"))));
}

interface Harness {
  server: ControlPlaneProcess;
  context: BrowserContext;
  pool: pg.Pool;
}

async function newestTurnAfter(pool: pg.Pool, cutoff: Date): Promise<string> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const rows = await pool.query<{ id: string }>(
      "SELECT id FROM turn WHERE created_at > $1 ORDER BY created_at DESC LIMIT 1",
      [cutoff],
    );
    const found = rows.rows[0]?.id;
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error("no turn was created");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function approveAll(pool: pg.Pool, page: Page, turnId: string): { stop: () => void } {
  const state = { running: true };
  const clicked = new Set<string>();
  void (async () => {
    while (state.running) {
      const rows = await pool
        .query<{ payload: { kind: string; needsConfirmation?: boolean; actionId?: string } }>(
          "SELECT payload FROM turn_event WHERE turn_id = $1 ORDER BY seq",
          [turnId],
        )
        .catch(() => ({ rows: [] as { payload: { kind: string; needsConfirmation?: boolean; actionId?: string } }[] }));
      for (const row of rows.rows) {
        const event = row.payload;
        if (event.kind !== "action-request" || event.needsConfirmation !== true) continue;
        const actionId = event.actionId ?? "";
        if (clicked.has(actionId)) continue;
        const answered = await pool.query("SELECT 1 FROM confirmation WHERE action_id = $1", [
          actionId,
        ]);
        if (answered.rowCount === 1) {
          clicked.add(actionId);
          continue;
        }
        clicked.add(actionId);
        await new Promise((resolve) => setTimeout(resolve, 750));
        await page.mouse.click(VIEW.width - 220, VIEW.height - 83).catch(() => undefined);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  })();
  return {
    stop: () => {
      state.running = false;
    },
  };
}

async function runTask(harness: Harness, task: EvalTask): Promise<Omit<EvalOutcome, "attempts">> {
  const { context, pool } = harness;
  const app: FixtureAppProcess = await spawnFixtureApp();
  const page = await context.newPage();
  const failures: string[] = [];
  const started = Date.now();
  try {
    await page.setViewportSize(VIEW);
    await page.goto(`${app.origin}${task.page}?variant=${task.variant}`);

    const popup = await context.newPage();
    await popup.goto(
      `chrome-extension://${EXTENSION_ID}/popup.html?target=${encodeURIComponent(app.origin)}`,
    );
    await popup.getByTestId("activate").click();
    await popup.getByTestId("tier").waitFor({ timeout: 10_000 });
    if (task.tier === "control") {
      await popup.getByTestId("enable-control").click();
      await popup.getByTestId("confirm-control").click();
    }
    await popup.close();
    await page.locator("#sga-root").waitFor({ state: "attached", timeout: 10_000 });

    const cutoff = new Date();
    await page.mouse.click(VIEW.width - 32, VIEW.height - 32);
    await page.mouse.click(VIEW.width - 152, VIEW.height - 242);
    await page.keyboard.type(task.taskText);
    await page.keyboard.press("Enter");
    const turnId = await newestTurnAfter(pool, cutoff);

    const approver = approveAll(pool, page, turnId);
    let turnStatus = "running";
    const deadline = Date.now() + TURN_TIMEOUT_MS;
    for (;;) {
      const rows = await pool.query<{ status: string }>("SELECT status FROM turn WHERE id = $1", [
        turnId,
      ]);
      turnStatus = rows.rows[0]?.status ?? "missing";
      if (turnStatus !== "running") break;
      if (Date.now() > deadline) {
        turnStatus = "timed-out";
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    approver.stop();

    const expectedStatus =
      task.expectedOutcome === "completed"
        ? "completed"
        : task.expectedOutcome === "needs-input"
          ? "needs-input"
          : "failed";
    if (turnStatus !== expectedStatus) {
      failures.push(`turn ended ${turnStatus}, expected ${expectedStatus}`);
    }

    for (const probe of task.verify.htmlContains ?? []) {
      const html = await (await fetch(`${app.origin}${probe.path}`)).text();
      if (!html.includes(probe.needle)) {
        failures.push(`${probe.path} does not contain "${probe.needle}"`);
      }
    }
    for (const probe of task.verify.htmlAbsent ?? []) {
      const html = await (await fetch(`${app.origin}${probe.path}`)).text();
      if (html.includes(probe.needle)) {
        failures.push(`${probe.path} still contains "${probe.needle}"`);
      }
    }
    if (task.verify.urlContains !== undefined && !page.url().includes(task.verify.urlContains)) {
      failures.push(`page url ${page.url()} does not contain ${task.verify.urlContains}`);
    }
    if (task.verify.answerContains !== undefined) {
      const rows = await pool.query<{ payload: { kind: string; text?: string; detail?: string } }>(
        "SELECT payload FROM turn_event WHERE turn_id = $1 ORDER BY seq",
        [turnId],
      );
      const spoken = rows.rows
        .map((row) => row.payload)
        .filter((event) => event.kind === "assistant-text" || event.kind === "report")
        .map((event) => `${event.text ?? ""} ${event.detail ?? ""}`)
        .join(" ")
        .toLowerCase();
      if (!spoken.includes(task.verify.answerContains.toLowerCase())) {
        failures.push(`no answer mentioned "${task.verify.answerContains}"`);
      }
    }

    const planned = await pool.query<{ payload: { level?: string } }>(
      "SELECT payload FROM trajectory WHERE turn_id = $1 AND kind = 'action-planned'",
      [turnId],
    );
    const levelsUsed = [...new Set(planned.rows.map((row) => row.payload.level ?? "L3"))];
    const asked = await pool.query(
      "SELECT 1 FROM trajectory WHERE turn_id = $1 AND kind = 'question'",
      [turnId],
    );
    const usage = await pool.query<{
      payload: { usage?: { inputTokens?: number; outputTokens?: number } };
    }>("SELECT payload FROM trajectory WHERE turn_id = $1 AND kind = 'model-response'", [turnId]);
    const tokens = usage.rows.reduce(
      (sum, row) => ({
        input: sum.input + (row.payload.usage?.inputTokens ?? 0),
        output: sum.output + (row.payload.usage?.outputTokens ?? 0),
      }),
      { input: 0, output: 0 },
    );

    return {
      id: task.id,
      pass: failures.length === 0,
      expectedResolution: task.expectedResolution,
      levelsUsed,
      askedQuestion: (asked.rowCount ?? 0) > 0,
      turnStatus,
      steps: planned.rowCount ?? 0,
      tokens,
      latencyMs: Date.now() - started,
      failures,
    };
  } finally {
    await page.close().catch(() => undefined);
    await app.stop();
  }
}

async function main(): Promise<void> {
  const mode = parseMode();
  if ((process.env["ANTHROPIC_API_KEY"] ?? "").length === 0) {
    process.stderr.write(
      "ANTHROPIC_API_KEY is not set. The eval suite runs the live model and cannot produce an honest result without it.\n",
    );
    process.exit(1);
  }

  const tasks = loadTasks();
  const pool = new pg.Pool({ connectionString: appDatabaseUrl() });
  const server = await spawnControlPlane({ agentLoop: "on", adapters: mode });
  const staged = stageExtension(["http://127.0.0.1/*"]);
  const context = await launchWithExtension(staged);
  const worker = await serviceWorkerOf(context);
  await worker.evaluate((base) => chrome.storage.local.set({ "sga.apiBase": base }), server.baseUrl);
  const harness: Harness = { server, context, pool };

  const outcomes: EvalOutcome[] = [];
  for (const task of tasks) {
    let last: Omit<EvalOutcome, "attempts"> | null = null;
    let attempts = 0;
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      attempts += 1;
      last = await runTask(harness, task).catch((cause: unknown) => ({
        id: task.id,
        pass: false,
        expectedResolution: task.expectedResolution,
        levelsUsed: [],
        askedQuestion: false,
        turnStatus: "harness-error",
        steps: 0,
        tokens: { input: 0, output: 0 },
        latencyMs: 0,
        failures: [cause instanceof Error ? cause.message : String(cause)],
      }));
      if (last.pass) break;
    }
    const outcome: EvalOutcome = { ...(last as Omit<EvalOutcome, "attempts">), attempts };
    outcomes.push(outcome);
    process.stdout.write(
      `${outcome.pass ? "PASS" : "FAIL"} ${outcome.id} [${outcome.levelsUsed.join(",") || "-"}] ` +
        `status=${outcome.turnStatus} steps=${String(outcome.steps)} ` +
        `tokens=${String(outcome.tokens.input)}/${String(outcome.tokens.output)} ` +
        `latency=${String(Math.round(outcome.latencyMs / 1000))}s attempts=${String(outcome.attempts)}` +
        `${outcome.failures.length > 0 ? ` — ${outcome.failures.join("; ")}` : ""}\n`,
    );
  }

  await context.close();
  await server.stop();
  await pool.end();

  const passed = outcomes.filter((outcome) => outcome.pass).length;
  const rate = passed / outcomes.length;
  const threshold = THRESHOLDS[mode] ?? 0.8;
  const resultsDir = join(HERE, "results");
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, `adapters-${mode}.json`),
    `${JSON.stringify({ mode, passed, total: outcomes.length, rate, threshold, outcomes }, null, 2)}\n`,
  );
  process.stdout.write(
    `\nadapters=${mode}: ${String(passed)}/${String(outcomes.length)} passed ` +
      `(${(rate * 100).toFixed(0)}%, threshold ${(threshold * 100).toFixed(0)}%)\n`,
  );
  process.exit(rate >= threshold ? 0 : 1);
}

void main();
