import {
  PORT_NAME,
  contentToWorkerMessageSchema,
  type ContentToWorkerMessage,
  type WorkerToContentMessage,
} from "@sga/contract/public";
import { ensureDeviceId, grantFor, readGrants, removeGrant, upsertGrant } from "./storage";
import { originPattern, syncContentScripts } from "./registration";
import { uiToWorkerMessageSchema, type UiToWorkerMessage, type WorkerReply } from "./ui-messages";

export class AgentGateway {
  private readonly ports = new Map<number, chrome.runtime.Port>();

  attach(): void {
    chrome.runtime.onInstalled.addListener(() => {
      void this.reconcile();
    });
    chrome.runtime.onStartup.addListener(() => {
      void this.reconcile();
    });
    chrome.runtime.onConnect.addListener((port) => {
      this.acceptPort(port);
    });
    chrome.runtime.onMessage.addListener(
      (raw: unknown, _sender, sendResponse: (reply: WorkerReply) => void) => {
        void this.handleUiMessage(raw).then(sendResponse);
        return true;
      },
    );
    chrome.permissions.onRemoved.addListener(() => {
      void this.reconcile();
    });
  }

  async reconcile(): Promise<void> {
    await ensureDeviceId();
    const grants = await readGrants();
    const held = [];
    for (const grant of grants) {
      const holds = await chrome.permissions.contains({ origins: [originPattern(grant.origin)] });
      if (holds) held.push(grant);
    }
    if (held.length !== grants.length) {
      const heldOrigins = new Set(held.map((grant) => grant.origin));
      for (const grant of grants) {
        if (!heldOrigins.has(grant.origin)) this.dropPortsFor(grant.origin);
      }
      await Promise.all(
        grants
          .filter((grant) => !heldOrigins.has(grant.origin))
          .map((grant) => removeGrant(grant.origin)),
      );
    }
    await syncContentScripts(held);
  }

  private dropPortsFor(origin: string): void {
    for (const [tabId, port] of this.ports) {
      if (port.sender?.origin === origin) {
        port.disconnect();
        this.ports.delete(tabId);
      }
    }
  }

  private acceptPort(port: chrome.runtime.Port): void {
    if (port.name !== PORT_NAME) {
      port.disconnect();
      return;
    }
    const tabId = port.sender?.tab?.id;
    if (tabId === undefined) {
      port.disconnect();
      return;
    }
    this.ports.set(tabId, port);
    port.onDisconnect.addListener(() => {
      this.ports.delete(tabId);
    });
    port.onMessage.addListener((raw: unknown) => {
      void this.handlePortMessage(port, raw);
    });
  }

  private post(port: chrome.runtime.Port, message: WorkerToContentMessage): void {
    port.postMessage(message);
  }

  private async handlePortMessage(port: chrome.runtime.Port, raw: unknown): Promise<void> {
    const parsed = contentToWorkerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.post(port, { type: "sw:error", code: "protocol", detail: "unparseable message" });
      return;
    }
    const message = parsed.data;
    const senderOrigin = port.sender?.origin;
    if (senderOrigin === undefined) {
      this.post(port, { type: "sw:error", code: "protocol", detail: "no sender origin" });
      port.disconnect();
      return;
    }
    const grant = await grantFor(senderOrigin);
    if (grant === null) {
      this.post(port, { type: "sw:error", code: "not_activated", detail: senderOrigin });
      port.disconnect();
      return;
    }
    this.dispatchPortMessage(port, message, grant.tier);
  }

  private dispatchPortMessage(
    port: chrome.runtime.Port,
    message: ContentToWorkerMessage,
    tier: "observe" | "control",
  ): void {
    switch (message.type) {
      case "cs:hello":
        this.post(port, {
          type: "sw:status",
          tier,
          turnId: null,
          paused: false,
          quota: null,
        });
        return;
      case "cs:task":
      case "cs:action-result":
      case "cs:confirm":
      case "cs:observation":
      case "cs:stop":
      case "cs:pause":
      case "cs:resume":
        this.post(port, {
          type: "sw:error",
          code: "internal",
          detail: `${message.type} is not wired yet`,
        });
        return;
      default: {
        const exhausted: never = message;
        throw new Error(`unreachable message ${JSON.stringify(exhausted)}`);
      }
    }
  }

  private async handleUiMessage(raw: unknown): Promise<WorkerReply> {
    const parsed = uiToWorkerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return { type: "reply:error", detail: "unparseable ui message" };
    }
    try {
      return await this.dispatchUiMessage(parsed.data);
    } catch (cause) {
      return {
        type: "reply:error",
        detail: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  private async dispatchUiMessage(message: UiToWorkerMessage): Promise<WorkerReply> {
    switch (message.type) {
      case "ui:status":
        return { type: "reply:status", grant: await grantFor(message.origin) };
      case "ui:list-grants":
        return { type: "reply:grants", grants: await readGrants() };
      case "ui:activated": {
        const pattern = originPattern(message.origin);
        const held = await chrome.permissions.contains({ origins: [pattern] });
        if (!held) {
          return { type: "reply:error", detail: `permission for ${pattern} is not held` };
        }
        const existing = await grantFor(message.origin);
        const grants = await upsertGrant(
          existing ?? { origin: message.origin, tier: "observe", grantedAt: Date.now() },
        );
        await syncContentScripts(grants);
        if (message.tabId !== null) {
          await chrome.scripting.executeScript({
            target: { tabId: message.tabId },
            files: ["content-script.js"],
          });
        }
        return { type: "reply:ok" };
      }
      case "ui:set-tier": {
        const grant = await grantFor(message.origin);
        if (grant === null) {
          return { type: "reply:error", detail: `${message.origin} is not activated` };
        }
        await upsertGrant({ ...grant, tier: message.tier });
        return { type: "reply:ok" };
      }
      case "ui:deactivate": {
        this.dropPortsFor(message.origin);
        const grants = await removeGrant(message.origin);
        await syncContentScripts(grants);
        // An install-time-held host (the e2e staging manifest) cannot be removed; the
        // grant record is the product's source of truth and is already gone either way.
        await chrome.permissions
          .remove({ origins: [originPattern(message.origin)] })
          .catch(() => false);
        return { type: "reply:ok" };
      }
      default: {
        const exhausted: never = message;
        throw new Error(`unreachable message ${JSON.stringify(exhausted)}`);
      }
    }
  }
}
