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
import { grantFor } from "./lib/storage";

const HOST_ID = "sga-root";
const WIDGET_HOST_ID = "sg-root";
const RECONNECT_DELAY_MS = 400;
const NAVIGATE_DELAY_MS = 30;

type ExecuteMessage = Extract<WorkerToContentMessage, { type: "sw:execute" }>;

function describeEvent(event: TurnEvent): string {
  switch (event.kind) {
    case "assistant-text":
      return event.text;
    case "action-request":
      return `wants to act: ${event.summary}`;
    case "question":
      return `question: ${event.text}`;
    case "report":
      return `${event.outcome === "completed" ? "done" : "not finished"}: ${event.detail}`;
    case "refusal":
      return `refused (${event.reason}): ${event.detail}`;
    case "quota":
      return `quota ${event.quota.used}/${event.quota.limit}`;
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
      return `failed: ${result.error}`;
    case "refused":
      return `refused (${result.reason}): ${result.detail}`;
    default: {
      const exhausted: never = result;
      throw new Error(`unreachable result ${JSON.stringify(exhausted)}`);
    }
  }
}

class Panel {
  private readonly host: HTMLDivElement;
  private readonly badge: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly log: HTMLDivElement;
  private mounted = false;

  constructor(private readonly onTask: (taskText: string) => void) {
    this.host = document.createElement("div");
    this.host.id = HOST_ID;
    const shadow = this.host.attachShadow({ mode: "closed" });

    this.badge = document.createElement("button");
    this.badge.textContent = "SG";
    this.badge.style.cssText =
      "position:fixed;right:12px;bottom:12px;width:40px;height:40px;border-radius:20px;" +
      "z-index:2147483647;border:none;background:#2b3a67;color:#fff;cursor:pointer;" +
      "font:600 13px/40px system-ui,sans-serif;text-align:center;padding:0";
    this.badge.addEventListener("click", () => {
      this.panel.style.display = this.panel.style.display === "none" ? "block" : "none";
    });

    this.panel = document.createElement("div");
    this.panel.style.cssText =
      "position:fixed;right:12px;bottom:64px;width:280px;height:200px;z-index:2147483647;" +
      "background:#fff;border:1px solid #c8c8d8;border-radius:10px;display:none;" +
      "box-shadow:0 4px 16px rgba(0,0,0,0.25);font:12px/1.4 system-ui,sans-serif;color:#1a1a2e";

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "What are you stuck on?";
    this.input.style.cssText =
      "position:absolute;top:8px;left:8px;right:8px;height:28px;box-sizing:border-box;" +
      "width:calc(100% - 16px);border:1px solid #c8c8d8;border-radius:6px;padding:0 8px;font:inherit";
    this.input.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Enter" && this.input.value.trim().length > 0) {
        this.onTask(this.input.value.trim());
        this.appendLine(`you: ${this.input.value.trim()}`);
        this.input.value = "";
      }
    });

    this.log = document.createElement("div");
    this.log.style.cssText =
      "position:absolute;top:44px;left:8px;right:8px;bottom:8px;overflow-y:auto;" +
      "white-space:pre-wrap;word-break:break-word";

    this.panel.append(this.input, this.log);
    shadow.append(this.badge, this.panel);
  }

  mount(tier: GrantTier): void {
    this.badge.title =
      tier === "control" ? "SuperGuide Anywhere: can act here" : "SuperGuide Anywhere: observing";
    this.badge.style.background = tier === "control" ? "#2b3a67" : "#5a6b94";
    if (this.mounted) return;
    this.mounted = true;
    document.documentElement.append(this.host);
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.host.remove();
  }

  appendLine(text: string): void {
    const line = document.createElement("div");
    line.textContent = text;
    line.style.marginBottom = "4px";
    this.log.append(line);
    this.log.scrollTop = this.log.scrollHeight;
  }

  // The decision bar sits at a fixed position inside the panel so the person
  // always finds it in the same place, however long the conversation is.
  appendConfirmation(decide: (approved: boolean) => void): void {
    this.panel.style.display = "block";
    const bar = document.createElement("div");
    bar.style.cssText =
      "position:absolute;left:8px;right:8px;bottom:8px;height:26px;display:flex;gap:8px;" +
      "background:#fff;border-top:1px solid #c8c8d8;padding-top:4px";
    const approve = document.createElement("button");
    approve.textContent = "Approve";
    const decline = document.createElement("button");
    decline.textContent = "Decline";
    for (const button of [approve, decline]) {
      button.style.cssText =
        "flex:1;border-radius:6px;border:1px solid #c8c8d8;background:#f2f3f8;" +
        "font:inherit;cursor:pointer;padding:0";
    }
    const settle = (approved: boolean): void => {
      bar.remove();
      this.appendLine(approved ? "you approved" : "you declined");
      decide(approved);
    };
    approve.addEventListener("click", () => {
      settle(true);
    });
    decline.addEventListener("click", () => {
      settle(false);
    });
    bar.append(approve, decline);
    this.panel.append(bar);
  }
}

function captureDigest(): PageDigest {
  return observe(document).digest;
}

class Agent {
  private port: chrome.runtime.Port | null = null;
  private active = true;
  private readonly panel = new Panel((taskText) => {
    this.port?.postMessage({ type: "cs:task", taskText, digest: captureDigest() });
  });

  connect(): void {
    if (!this.active) return;
    const port = chrome.runtime.connect({ name: PORT_NAME });
    this.port = port;
    port.onDisconnect.addListener(() => {
      this.port = null;
      if (this.active) {
        setTimeout(() => {
          this.connect();
        }, RECONNECT_DELAY_MS);
      }
    });
    port.onMessage.addListener((raw: unknown) => {
      const parsed = workerToContentMessageSchema.safeParse(raw);
      if (parsed.success) this.handle(parsed.data);
    });
    port.postMessage({ type: "cs:hello", origin: location.origin, url: location.href });
  }

  private handle(message: WorkerToContentMessage): void {
    switch (message.type) {
      case "sw:status":
        this.panel.mount(message.tier);
        return;
      case "sw:event": {
        this.panel.appendLine(describeEvent(message.event));
        const event = message.event;
        if (event.kind === "action-request" && event.needsConfirmation) {
          this.panel.appendConfirmation((approved) => {
            this.port?.postMessage({
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
        void this.execute(message);
        return;
      case "sw:error":
        if (message.code === "not_activated") {
          this.active = false;
          this.panel.unmount();
          this.port?.disconnect();
          return;
        }
        this.panel.appendLine(`error: ${message.detail}`);
        return;
      default: {
        const exhausted: never = message;
        throw new Error(`unreachable message ${JSON.stringify(exhausted)}`);
      }
    }
  }

  private async execute(message: ExecuteMessage): Promise<void> {
    // The stored grant, read at execution time, outranks the tier the worker
    // sent: a mid-turn downgrade or revocation must stop this action, and the
    // executor must refuse even if the server wrongly permitted it.
    const grant = await grantFor(location.origin);
    const tier: GrantTier = grant?.tier ?? "observe";
    const result = await executeAction(message.action, tier, {
      document,
      observe: () => observe(document),
      diff: diffDigests,
      navigate: (path) => {
        // Deferred so the action result posts before the page unloads.
        setTimeout(() => {
          location.assign(path);
        }, NAVIGATE_DELAY_MS);
      },
      delay: (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }),
    });
    const digest = message.action.kind === "navigate" ? null : captureDigest();
    this.port?.postMessage({
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
