import {
  PORT_NAME,
  workerToContentMessageSchema,
  type ActionResult,
  type AgentAction,
  type ExpectPredicate,
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

function describeEvent(event: TurnEvent): string | null {
  switch (event.kind) {
    case "assistant-text":
      return concealLine(event.text, "I can't share that. Tell me what you need on this page.");
    case "question":
      return concealLine(event.text, "I need one detail from you to continue.");
    case "report":
      return concealLine(event.detail, "the turn finished");
    case "refusal":
      return "error: SuperGuide could not continue.";
    case "action-request":
    case "quota":
    case "turn-end":
      return null;
    default: {
      const exhausted: never = event;
      throw new Error(`unreachable event ${JSON.stringify(exhausted)}`);
    }
  }
}

function nodeName(digest: PageDigest, id: string): string | null {
  const name = digest.nodes.find((node) => node.id === id)?.name.trim();
  return name !== undefined && name.length > 0 ? name : null;
}

function waitLabel(predicate: ExpectPredicate): string {
  switch (predicate.kind) {
    case "element-present":
      return `Waited for ${predicate.target.name}`;
    case "element-absent":
      return `Waited for ${predicate.target.name} to close`;
    case "text-matches":
      return predicate.target === null
        ? "Waited for the page to update"
        : `Waited for ${predicate.target.name} to update`;
    case "url-matches":
      return "Waited for the page to open";
    case "value-equals":
      return `Waited for ${predicate.target.name}`;
    case "state-is":
      return `Waited for ${predicate.target.name}`;
    default: {
      const exhausted: never = predicate;
      throw new Error(`unreachable predicate ${JSON.stringify(exhausted)}`);
    }
  }
}

function stepLabel(action: AgentAction, digest: PageDigest): string {
  const named = (id: string): string | null => nodeName(digest, id);
  switch (action.kind) {
    case "click": {
      const name = named(action.target.id);
      return name !== null ? `Clicked ${name}` : "Clicked";
    }
    case "type": {
      const name = named(action.target.id);
      return name !== null ? `Typed in ${name}` : "Typed";
    }
    case "select":
      return `Selected ${action.optionLabel}`;
    case "check": {
      const name = named(action.target.id);
      const verb = action.checked ? "Checked" : "Unchecked";
      return name !== null ? `${verb} ${name}` : verb;
    }
    case "focus": {
      const name = named(action.target.id);
      return name !== null ? `Focused ${name}` : "Focused";
    }
    case "scrollIntoView": {
      const name = named(action.target.id);
      return name !== null ? `Scrolled to ${name}` : "Scrolled into view";
    }
    case "navigate": {
      const leaf = action.path.split("/").filter((part) => part.length > 0).pop();
      return leaf !== undefined ? `Opened ${leaf.replaceAll(/[-_]/g, " ")}` : "Opened a page";
    }
    case "waitFor":
      return waitLabel(action.predicate);
    case "readBack": {
      const name = named(action.target.id);
      return name !== null ? `Read ${name}` : "Checked the page";
    }
    default: {
      const exhausted: never = action;
      throw new Error(`unreachable action ${JSON.stringify(exhausted)}`);
    }
  }
}

function failedStepLabel(action: AgentAction, digest: PageDigest, result: ActionResult): string {
  if (action.kind === "waitFor") {
    if (action.predicate.kind === "element-present") {
      return `Could not find ${action.predicate.target.name} in time`;
    }
    return "The page did not update in time";
  }
  if (result.status === "refused") {
    return "That step was not allowed";
  }
  const done = stepLabel(action, digest);
  return `${done} did not complete`;
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
    onStop: () => {
      this.post({ type: "cs:stop" });
      this.panel.setActivity("idle");
      this.panel.setThinking(null);
      this.panel.appendLine("Stopped.");
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
        const event = message.event;
        if (event.kind === "action-request") {
          this.panel.setActivity("running");
          this.panel.open();
        }
        if (event.kind === "quota") this.panel.setQuota(event.quota);
        if (event.kind === "turn-end") {
          this.panel.setActivity("idle");
          this.panel.setThinking(null);
        }
        if (event.kind === "action-request" && event.needsConfirmation) {
          this.panel.showConfirmation((approved) => {
            this.post({
              type: "cs:confirm",
              turnId: message.turnId,
              actionId: event.actionId,
              paramsHash: event.paramsHash,
              approved,
            });
            if (approved) this.panel.setThinking("Working on this page");
          });
          return;
        }
        if (event.kind === "action-request") {
          this.panel.setThinking("Working on this page");
          return;
        }
        const line = describeEvent(event);
        if (line !== null) {
          this.panel.setThinking(null);
          this.panel.appendLine(line);
        }
        return;
      }
      case "sw:execute":
        this.panel.setActivity("running");
        this.panel.open();
        this.panel.setThinking("Working on this page");
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
        this.panel.appendLine("error: Something went wrong. Try again.");
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
    const before = observe(document);
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
    const ok = result.status === "completed";
    this.panel.recordStep(
      ok ? stepLabel(message.action, before.digest) : failedStepLabel(message.action, before.digest, result),
      ok,
    );
    if (ok) {
      this.panel.setThinking("Working on this page");
      return;
    }
    this.panel.setThinking(null);
  }
}

function main(): void {
  if (document.getElementById(HOST_ID) !== null) return;
  if (document.getElementById(WIDGET_HOST_ID) !== null) return;
  new Agent().connect();
}

main();
