import {
  PORT_NAME,
  workerToContentMessageSchema,
  type ActionResult,
  type GrantTier,
  type PageDigest,
  type TurnEvent,
  type WorkerToContentMessage,
} from "@sga/contract/public";
import { diffDigests, observe } from "@sga/observer";
import { executeAction } from "@sga/executor";
import { createPanel, type PanelHandle } from "@sga/ui";
import { grantFor } from "./lib/storage";

const HOST_ID = "sga-root";
const WIDGET_HOST_ID = "sg-root";
const RECONNECT_DELAY_MS = 400;
const NAVIGATE_DELAY_MS = 30;

function runtimeAlive(): boolean {
  try {
    return typeof chrome.runtime.id === "string";
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}

function disconnectMessage(): string {
  try {
    return chrome.runtime.lastError?.message ?? "";
  } catch (error) {
    if (error instanceof Error) return "invalidated";
    throw error;
  }
}

type ExecuteMessage = Extract<WorkerToContentMessage, { type: "sw:execute" }>;

const MODEL_OR_VENDOR =
  /\b(?:open\s*ai|chatgpt|chat\s*gpt|anthropic|claude(?:[-\s][\w.]+)?|gemini(?:[-\s][\w.]+)?|google\s*ai(?:\s*studio)?|gpt-[\w.]+|o3(?:-mini)?)\b/gi;

function concealLine(text: string, fallback: string): string {
  MODEL_OR_VENDOR.lastIndex = 0;
  if (!MODEL_OR_VENDOR.test(text)) return text;
  const kept = text
    .split(/(?<=[.!?])(?:\s+|$)/)
    .map((part) => part.trim())
    .filter((part) => {
      MODEL_OR_VENDOR.lastIndex = 0;
      return part.length > 0 && !MODEL_OR_VENDOR.test(part);
    });
  return kept.length === 0 ? fallback : kept.join(" ");
}

function describeEvent(event: TurnEvent): string {
  switch (event.kind) {
    case "assistant-text":
      return concealLine(event.text, "I can't share that. Tell me what you need on this page.");
    case "action-request":
      return `wants to act: ${concealLine(event.summary, "act on the page")}`;
    case "question":
      return `question: ${concealLine(event.text, "I need one detail from you to continue.")}`;
    case "report":
      return `${event.outcome === "completed" ? "done" : "not finished"}: ${concealLine(event.detail, "the turn finished")}`;
    case "refusal":
      return `refused (${event.reason}): ${concealLine(event.detail, "the request was refused")}`;
    case "quota":
      return `quota ${String(event.quota.used)}/${String(event.quota.limit)}`;
    case "turn-end":
      return `turn ended: ${event.status}`;
    default: {
      const exhausted: never = event;
      throw new Error(`unreachable event ${JSON.stringify(exhausted)}`);
    }
  }
}

function describeResult(result: ActionResult): string {
  switch (result.status) {
    case "completed":
      return result.readBack === undefined ? "done" : `read: ${result.readBack}`;
    case "failed":
      return `failed: ${concealLine(result.error, "the action did not complete")}`;
    case "refused":
      return `refused (${result.reason}): ${concealLine(result.detail, "the request was refused")}`;
    default: {
      const exhausted: never = result;
      throw new Error(`unreachable result ${JSON.stringify(exhausted)}`);
    }
  }
}

function captureDigest(): PageDigest {
  return observe(document).digest;
}

class Agent {
  private port: chrome.runtime.Port | null = null;
  private active = true;
  private mounted = false;
  private readonly panel: PanelHandle = createPanel(document, HOST_ID, {
    onTask: (taskText) => {
      this.post({ type: "cs:task", taskText, digest: captureDigest() });
    },
    onPause: () => {
      this.post({ type: "cs:pause" });
    },
    onResume: () => {
      this.post({ type: "cs:resume" });
    },
    onStop: () => {
      this.post({ type: "cs:stop" });
      this.panel.setActivity("idle");
      this.panel.appendLine("stopped");
    },
  });

  private post(message: object): void {
    const port = this.port;
    if (port === null || !runtimeAlive()) return;
    try {
      port.postMessage(message);
    } catch (error) {
      this.port = null;
      this.active = false;
      if (error instanceof Error) return;
      throw error;
    }
  }

  connect(): void {
    if (!this.active) return;
    if (!runtimeAlive()) {
      this.active = false;
      return;
    }
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch (error) {
      this.active = false;
      this.port = null;
      if (error instanceof Error) return;
      throw error;
    }
    this.port = port;
    port.onDisconnect.addListener(() => {
      this.port = null;
      const detail = disconnectMessage();
      if (!this.active) return;
      if (!runtimeAlive() || /invalidated/i.test(detail)) {
        this.active = false;
        return;
      }
      setTimeout(() => {
        this.connect();
      }, RECONNECT_DELAY_MS);
    });
    port.onMessage.addListener((raw: unknown) => {
      const parsed = workerToContentMessageSchema.safeParse(raw);
      if (parsed.success) this.handle(parsed.data);
    });
    this.post({ type: "cs:hello", origin: location.origin, url: location.href });
  }

  private mount(tier: GrantTier): void {
    if (!this.mounted) {
      document.documentElement.append(this.panel.host);
      this.mounted = true;
    }
    this.panel.setTier(tier);
  }

  private handle(message: WorkerToContentMessage): void {
    switch (message.type) {
      case "sw:status":
        this.mount(message.tier);
        this.panel.setQuota(message.quota);
        if (message.paused) this.panel.setActivity("paused");
        return;
      case "sw:event": {
        this.panel.appendLine(describeEvent(message.event));
        const event = message.event;
        if (event.kind === "action-request") {
          this.panel.setActivity("running");
          this.panel.open();
        }
        if (event.kind === "quota") this.panel.setQuota(event.quota);
        if (event.kind === "turn-end") this.panel.setActivity("idle");
        if (event.kind === "action-request" && event.needsConfirmation) {
          this.panel.showConfirmation((approved) => {
            this.post({
              type: "cs:confirm",
              turnId: message.turnId,
              actionId: event.actionId,
              paramsHash: event.paramsHash,
              approved,
            });
          });
        }
        return;
      }
      case "sw:execute":
        this.panel.setActivity("running");
        this.panel.open();
        void this.execute(message);
        return;
      case "sw:error":
        if (message.code === "not_activated") {
          this.active = false;
          this.mounted = false;
          this.panel.remove();
          this.port = null;
          return;
        }
        this.panel.appendLine(
          `error: ${concealLine(message.detail, "something went wrong; try again")}`,
        );
        return;
      default: {
        const exhausted: never = message;
        throw new Error(`unreachable message ${JSON.stringify(exhausted)}`);
      }
    }
  }

  private async execute(message: ExecuteMessage): Promise<void> {
    // Stored grant at execute time outranks worker tier; mid-turn revoke/downgrade must refuse.
    const grant = await grantFor(location.origin);
    const tier: GrantTier = grant?.tier ?? "observe";
    const result = await executeAction(message.action, tier, {
      document,
      observe: () => observe(document),
      diff: diffDigests,
      navigate: (path) => {
        setTimeout(() => {
          location.assign(path);
        }, NAVIGATE_DELAY_MS);
      },
      delay: (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }),
      preview: (element) => this.panel.highlightTarget(element),
    });
    const digest = message.action.kind === "navigate" ? null : captureDigest();
    this.post({
      type: "cs:action-result",
      turnId: message.turnId,
      actionId: message.actionId,
      result,
      digest,
    });
    this.panel.appendLine(describeResult(result));
  }
}

function main(): void {
  if (document.getElementById(HOST_ID) !== null) return;
  if (document.getElementById(WIDGET_HOST_ID) !== null) return;
  new Agent().connect();
}

main();
