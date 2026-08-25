import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages";
import type pg from "pg";
import {
  evaluatePredicate,
  paramsHashOf,
  type ActionResult,
  type Confirmation,
  type ExpectPredicate,
  type GrantTier,
  type PageDigest,
  actionResultSchema,
  pageDigestSchema,
} from "@sga/contract/public";
import { evaluatePolicy } from "@sga/policy";
import type { Environment } from "../env";
import type { QuotaService } from "../turn/quota";
import type { TurnStore } from "../turn/store";
import { injectionScanSchema, type InjectionScan } from "./classifier";
import { envelopeDigest, envelopeObservation, extractPageStrings } from "./provenance";
import {
  askUserInputSchema,
  buildPlannerRequest,
  buildTaskMessage,
  finishInputSchema,
  pageActionInputSchema,
} from "./prompts";
import { classifyRisk } from "./risk";

export interface TurnInput {
  turnId: string;
  deviceId: string;
  origin: string;
  url: string;
  tier: GrantTier;
  taskText: string;
  digest: PageDigest;
}

export interface AgentWaits {
  resultTimeoutMs: number;
  confirmTimeoutMs: number;
  pollMs: number;
}

export interface AgentDeps {
  env: Environment;
  pool: pg.Pool;
  store: TurnStore;
  quotas: QuotaService;
  plan(request: BetaMessageStreamParams): Promise<Anthropic.Beta.Messages.BetaMessage>;
  scan(strings: string[]): Promise<InjectionScan>;
  waits?: Partial<AgentWaits>;
}

const DEFAULT_WAITS: AgentWaits = {
  resultTimeoutMs: 120_000,
  confirmTimeoutMs: 300_000,
  pollMs: 250,
};

interface ToolOutcome {
  content: string;
  isError: boolean;
  digest: PageDigest | null;
}

type TurnEnd = "completed" | "failed" | "needs-input";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class TurnAgent {
  private readonly waits: AgentWaits;

  constructor(private readonly deps: AgentDeps) {
    this.waits = { ...DEFAULT_WAITS, ...deps.waits };
  }

  start(input: TurnInput): void {
    void this.run(input).catch(async (cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      await this.deps.store.appendTrajectory(input.turnId, "error", { message });
      await this.deps.store.appendEvent(input.turnId, {
        kind: "report",
        outcome: "not-completed",
        detail: "the agent stopped on an internal error; nothing further was done",
        failedPredicate: null,
        lastVerifiedState: null,
      });
      await this.endTurn(input, "failed");
    }).catch(() => undefined);
  }

  async run(input: TurnInput): Promise<void> {
    const { store, env } = this.deps;

    const scan = await this.deps
      .scan(extractPageStrings(input.digest))
      .then((verdict) => injectionScanSchema.parse(verdict))
      .catch(
        (): InjectionScan => ({
          suspicious: true,
          findings: ["the injection scan was unavailable; treating the page as suspect"],
        }),
      );
    await store.appendTrajectory(input.turnId, "injection-scan", scan);

    let digest: PageDigest | null = input.digest;
    const verification: {
      lastVerified: string | null;
      lastFailedPredicate: ExpectPredicate | null;
    } = { lastVerified: null, lastFailedPredicate: null };

    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      {
        role: "user",
        content: buildTaskMessage({
          taskText: input.taskText,
          origin: input.origin,
          url: input.url,
          tier: input.tier,
          envelopedDigest: envelopeDigest(input.digest, scan),
        }),
      },
    ];

    for (let step = 0; step < env.SGA_STEP_BUDGET; step += 1) {
      const response = await this.deps.plan(buildPlannerRequest(messages));
      await store.appendTrajectory(input.turnId, "model-response", {
        stopReason: response.stop_reason,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadInputTokens: response.usage.cache_read_input_tokens,
          cacheCreationInputTokens: response.usage.cache_creation_input_tokens,
        },
      });

      if (response.stop_reason === "refusal") {
        const category = response.stop_details?.type === "refusal"
          ? (response.stop_details.category ?? null)
          : null;
        await store.appendTrajectory(input.turnId, "refusal", { source: "model", category });
        await store.appendEvent(input.turnId, {
          kind: "refusal",
          reason: "model_refusal",
          detail:
            category === null
              ? "the model declined this request"
              : `the model declined this request (${category})`,
        });
        await this.endTurn(input, "failed");
        return;
      }

      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      if (response.stop_reason === "max_tokens") {
        await store.appendEvent(input.turnId, {
          kind: "report",
          outcome: "not-completed",
          detail: "the model's response was truncated at the token limit; the task did not finish",
          failedPredicate: verification.lastFailedPredicate,
          lastVerifiedState: verification.lastVerified,
        });
        await this.endTurn(input, "failed");
        return;
      }

      for (const block of response.content) {
        if (block.type === "text" && block.text.trim().length > 0) {
          await store.appendEvent(input.turnId, { kind: "assistant-text", text: block.text });
        }
      }

      const toolUses = response.content.filter(
        (block): block is Anthropic.Beta.Messages.BetaToolUseBlock => block.type === "tool_use",
      );
      if (toolUses.length === 0) {
        await this.endTurn(input, "needs-input");
        return;
      }

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        if (toolUse.name === "finish") {
          const finish = finishInputSchema.safeParse(toolUse.input);
          if (!finish.success) {
            results.push(invalidInput(toolUse.id, finish.error.message));
            continue;
          }
          // A completion claim is honoured only when no predicate is standing
          // failed; otherwise the report is downgraded to what was verified.
          const honest =
            finish.data.outcome === "completed" && verification.lastFailedPredicate !== null
              ? "not-completed"
              : finish.data.outcome;
          await store.appendTrajectory(input.turnId, "report", {
            outcome: honest,
            claimed: finish.data.outcome,
            detail: finish.data.detail,
          });
          await store.appendEvent(input.turnId, {
            kind: "report",
            outcome: honest,
            detail: finish.data.detail,
            failedPredicate: verification.lastFailedPredicate,
            lastVerifiedState: verification.lastVerified,
          });
          await this.endTurn(input, honest === "completed" ? "completed" : "failed");
          return;
        }

        if (toolUse.name === "ask_user") {
          const ask = askUserInputSchema.safeParse(toolUse.input);
          if (!ask.success) {
            results.push(invalidInput(toolUse.id, ask.error.message));
            continue;
          }
          await store.appendTrajectory(input.turnId, "question", { text: ask.data.question });
          await store.appendEvent(input.turnId, { kind: "question", text: ask.data.question });
          await this.endTurn(input, "needs-input");
          return;
        }

        if (toolUse.name === "page_action") {
          const outcome = await this.handlePageAction(input, digest, toolUse, verification);
          digest = outcome.digest ?? digest;
          results.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: outcome.content,
            ...(outcome.isError ? { is_error: true } : {}),
          });
          continue;
        }

        results.push(invalidInput(toolUse.id, `unknown tool ${toolUse.name}`));
      }
      messages.push({ role: "user", content: results });
    }

    await store.appendTrajectory(input.turnId, "report", {
      outcome: "not-completed",
      detail: "step budget exhausted",
    });
    await store.appendEvent(input.turnId, {
      kind: "report",
      outcome: "not-completed",
      detail: `the step budget of ${String(env.SGA_STEP_BUDGET)} was spent before the task finished`,
      failedPredicate: verification.lastFailedPredicate,
      lastVerifiedState: verification.lastVerified,
    });
    await this.endTurn(input, "failed");
  }

  private async handlePageAction(
    input: TurnInput,
    digest: PageDigest | null,
    toolUse: Anthropic.Beta.Messages.BetaToolUseBlock,
    verification: {
      lastVerified: string | null;
      lastFailedPredicate: ExpectPredicate | null;
    },
  ): Promise<ToolOutcome> {
    const { store } = this.deps;
    const parsed = pageActionInputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      return { content: `invalid page_action input: ${parsed.error.message}`, isError: true, digest: null };
    }
    const { action, expect, summary } = parsed.data;
    const actionId = crypto.randomUUID();
    const risk = classifyRisk(action, digest);
    const paramsHash = await paramsHashOf(action);
    await store.appendTrajectory(input.turnId, "action-planned", {
      actionId,
      action,
      risk,
      expect,
      summary,
    });

    let verdict = evaluatePolicy({
      actionId,
      action,
      paramsHash,
      risk,
      adapterMatched: false,
      siteActivated: true,
      tier: input.tier,
      confirmation: null,
    });
    await store.appendTrajectory(input.turnId, "policy-verdict", { actionId, verdict });

    if (verdict.kind === "confirm") {
      await store.appendEvent(input.turnId, {
        kind: "action-request",
        actionId,
        action,
        risk,
        expect,
        paramsHash,
        needsConfirmation: true,
        summary: verdict.summary,
      });
      const confirmation = await this.waitForConfirmation(actionId);
      if (confirmation === null) {
        await store.appendTrajectory(input.turnId, "error", {
          actionId,
          message: "no confirmation decision arrived in time",
        });
        return {
          content: "the person did not decide on the confirmation in time; the action did not run",
          isError: false,
          digest: null,
        };
      }
      verdict = evaluatePolicy({
        actionId,
        action,
        paramsHash,
        risk,
        adapterMatched: false,
        siteActivated: true,
        tier: input.tier,
        confirmation,
      });
      await store.appendTrajectory(input.turnId, "policy-verdict", {
        actionId,
        verdict,
        confirmed: true,
      });
      await this.consumeConfirmation(actionId);
    }

    if (verdict.kind === "refuse") {
      await store.appendTrajectory(input.turnId, "refusal", { actionId, reason: verdict.reason });
      await store.appendEvent(input.turnId, {
        kind: "refusal",
        reason: verdict.reason,
        detail: summary,
      });
      return {
        content: `the action was refused (${verdict.reason}) and did not run`,
        isError: false,
        digest: null,
      };
    }

    await store.appendTrajectory(input.turnId, "action-dispatched", { actionId });
    await store.appendEvent(input.turnId, {
      kind: "action-request",
      actionId,
      action,
      risk,
      expect,
      paramsHash,
      needsConfirmation: false,
      summary,
    });

    const delivered = await this.waitForActionResult(actionId);
    if (delivered === null) {
      await store.appendTrajectory(input.turnId, "error", {
        actionId,
        message: "no action result arrived in time",
      });
      return {
        content: "the page returned no result for this action in time",
        isError: true,
        digest: null,
      };
    }

    const fresh = delivered.digest;
    const predicates =
      fresh === null
        ? []
        : expect.map((predicate) => ({
            predicate,
            satisfied: evaluatePredicate(predicate, fresh),
          }));
    const failed = predicates.find((entry) => !entry.satisfied)?.predicate ?? null;
    verification.lastFailedPredicate = failed;
    if (delivered.result.status === "completed" && failed === null && predicates.length > 0) {
      verification.lastVerified = summary;
    }
    await store.appendTrajectory(input.turnId, "observation", {
      actionId,
      status: delivered.result.status,
      predicates,
    });
    return {
      content: envelopeObservation({ result: delivered.result, predicates }),
      isError: false,
      digest: fresh,
    };
  }

  private async endTurn(input: TurnInput, end: TurnEnd): Promise<void> {
    const { store, quotas } = this.deps;
    const now = new Date();
    if (end === "completed") {
      await store.finishTurn(input.turnId, "completed", async (client) => {
        await client.query("UPDATE turn SET counted = true WHERE id = $1", [input.turnId]);
        await quotas.recordCompletedTask(input.deviceId, now, client);
      });
      await store.appendEvent(input.turnId, {
        kind: "quota",
        quota: await quotas.deviceQuota(input.deviceId, now),
      });
    } else {
      await store.finishTurn(input.turnId, end === "failed" ? "failed" : "needs-input");
    }
    await store.appendTrajectory(input.turnId, "turn-end", { status: end });
    await store.appendEvent(input.turnId, {
      kind: "turn-end",
      status: end === "needs-input" ? "needs-input" : end,
    });
  }

  private async waitForActionResult(
    actionId: string,
  ): Promise<{ result: ActionResult; digest: PageDigest | null } | null> {
    const deadline = Date.now() + this.waits.resultTimeoutMs;
    for (;;) {
      const rows = await this.deps.pool.query<{ result: unknown; digest: unknown }>(
        "SELECT result, digest FROM action_result WHERE action_id = $1",
        [actionId],
      );
      const row = rows.rows[0];
      if (row !== undefined) {
        const result = actionResultSchema.safeParse(row.result);
        if (!result.success) return null;
        const digest = pageDigestSchema.safeParse(row.digest);
        return { result: result.data, digest: digest.success ? digest.data : null };
      }
      if (Date.now() >= deadline) return null;
      await delay(this.waits.pollMs);
    }
  }

  private async waitForConfirmation(actionId: string): Promise<Confirmation | null> {
    const deadline = Date.now() + this.waits.confirmTimeoutMs;
    for (;;) {
      const rows = await this.deps.pool.query<{ params_hash: string; approved: boolean }>(
        "SELECT params_hash, approved FROM confirmation WHERE action_id = $1 AND consumed = false",
        [actionId],
      );
      const row = rows.rows[0];
      if (row !== undefined) {
        return { actionId, paramsHash: row.params_hash, approved: row.approved };
      }
      if (Date.now() >= deadline) return null;
      await delay(this.waits.pollMs);
    }
  }

  private async consumeConfirmation(actionId: string): Promise<void> {
    await this.deps.pool.query("UPDATE confirmation SET consumed = true WHERE action_id = $1", [
      actionId,
    ]);
  }
}

function invalidInput(
  toolUseId: string,
  detail: string,
): Anthropic.Beta.Messages.BetaToolResultBlockParam {
  return { type: "tool_result", tool_use_id: toolUseId, content: detail, is_error: true };
}
