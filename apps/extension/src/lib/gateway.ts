import {
  PORT_NAME,
  STORAGE_KEYS,
  contentToWorkerMessageSchema,
  type ContentToWorkerMessage,
  type GrantTier,
  type WorkerToContentMessage,
} from "@sga/contract/public";
import { refreshAdapterCache } from "./adapters";
import { createApiClient } from "./api";
import {
  ensureDeviceId,
  grantFor,
  promoteObserveGrants,
  readGlobalOff,
  readGrants,
  removeGrant,
  upsertGrant,
  writeGlobalOff,
} from "./storage";
import { originFromPattern, originPattern, syncContentScripts } from "./registration";
import { TurnSessionManager } from "./session";
import { uiToWorkerMessageSchema, type UiToWorkerMessage, type WorkerReply } from "./ui-messages";

interface PortContext {
  tabId: number;
  origin: string;
  tier: GrantTier;
}

const PENDING_ACTIVATE_KEY = "sga.pendingActivate";

interface PendingActivate {
  origin: string;
  tabId: number | null;
  pattern: string;
}

export class AgentGateway {
  private readonly pendingActivate = new Map<string, PendingActivate>();
  private readonly ports = new Map<number, chrome.runtime.Port>();
  // Park outbound messages while the tab is navigating; flush on the next cs:hello.
  private readonly parked = new Map<number, WorkerToContentMessage[]>();
  private readonly sessions = new TurnSessionManager(
    createApiClient,
    (tabId, message) => {
      const port = this.ports.get(tabId);
      if (port !== undefined) {
        port.postMessage(message);
        return;
      }
      const queue = this.parked.get(tabId) ?? [];
      if (queue.length < 20) queue.push(message);
      this.parked.set(tabId, queue);
    },
    async (origin) => (await grantFor(origin))?.tier ?? null,
  );

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
    chrome.permissions.onAdded.addListener((delta) => {
      void this.finishAddedOrigins(delta.origins ?? []);
    });
    void this.restorePending();
    void this.sessions.resumeAll();
  }

  async reconcile(): Promise<void> {
    await ensureDeviceId();
    if (await readGlobalOff()) {
      await syncContentScripts([]);
      return;
    }
    const grants = await readGrants();
    const held = [];
    for (const grant of grants) {
      const holds = await chrome.permissions.contains({ origins: [originPattern(grant.origin)] });
      if (holds) held.push(grant);
    }
    if (held.length !== grants.length) {
      const heldOrigins = new Set(held.map((grant) => grant.origin));
      for (const grant of grants) {
        if (!heldOrigins.has(grant.origin)) this.teardownOrigin(grant.origin);
      }
      await Promise.all(
        grants
          .filter((grant) => !heldOrigins.has(grant.origin))
          .map((grant) => removeGrant(grant.origin)),
      );
    }
    await syncContentScripts(held);
    void refreshAdapterCache();
    await this.sessions.resumeAll();
  }

  private async restorePending(): Promise<void> {
    const stored = await chrome.storage.session.get(PENDING_ACTIVATE_KEY);
    const persisted = Array.isArray(stored[PENDING_ACTIVATE_KEY])
      ? (stored[PENDING_ACTIVATE_KEY] as PendingActivate[])
      : [];
    for (const entry of persisted) this.pendingActivate.set(entry.pattern, entry);
  }

  private rememberPending(origin: string, tabId: number | null): void {
    const pattern = originPattern(origin);
    const entry = { origin, tabId, pattern };
    this.pendingActivate.set(pattern, entry);
    void chrome.storage.session.get(PENDING_ACTIVATE_KEY).then((stored) => {
      const current = Array.isArray(stored[PENDING_ACTIVATE_KEY])
        ? (stored[PENDING_ACTIVATE_KEY] as PendingActivate[])
        : [];
      const next = [...current.filter((item) => item.pattern !== pattern), entry];
      return chrome.storage.session.set({ [PENDING_ACTIVATE_KEY]: next });
    });
  }

  private takePending(pattern: string): PendingActivate | null {
    const memory = this.pendingActivate.get(pattern) ?? null;
    this.pendingActivate.delete(pattern);
    void chrome.storage.session.get(PENDING_ACTIVATE_KEY).then((stored) => {
      const current = Array.isArray(stored[PENDING_ACTIVATE_KEY])
        ? (stored[PENDING_ACTIVATE_KEY] as PendingActivate[])
        : [];
      return chrome.storage.session.set({
        [PENDING_ACTIVATE_KEY]: current.filter((item) => item.pattern !== pattern),
      });
    });
    return memory;
  }

  private async inject(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-script.js"],
      });
    } catch {
      return;
    }
  }

  private async completeActivation(
    origin: string,
    tabId: number | null,
  ): Promise<Extract<WorkerReply, { type: "reply:ok" | "reply:error" }>> {
    const pattern = originPattern(origin);
    const held = await chrome.permissions.contains({ origins: [pattern] });
    if (!held) {
      return { type: "reply:error", detail: `permission for ${pattern} is not held` };
    }
    this.takePending(pattern);
    const existing = await grantFor(origin);
    const grants = await upsertGrant({
      origin,
      tier: "control",
      grantedAt: existing?.grantedAt ?? Date.now(),
    });
    await syncContentScripts(grants);
    if (tabId !== null) await this.inject(tabId);
    return { type: "reply:ok" };
  }

  private async beginActivate(origin: string, tabId: number | null): Promise<WorkerReply> {
    const pattern = originPattern(origin);
    this.rememberPending(origin, tabId);
    try {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) {
        this.takePending(pattern);
        return { type: "reply:error", detail: "permission was not granted" };
      }
      return await this.completeActivation(origin, tabId);
    } catch {
      return { type: "reply:needs-permission" };
    }
  }

  private async finishAddedOrigins(patterns: string[]): Promise<void> {
    const stored = await chrome.storage.session.get(PENDING_ACTIVATE_KEY);
    const persisted = Array.isArray(stored[PENDING_ACTIVATE_KEY])
      ? (stored[PENDING_ACTIVATE_KEY] as PendingActivate[])
      : [];
    for (const pattern of patterns) {
      const pending = this.pendingActivate.get(pattern) ?? persisted.find((entry) => entry.pattern === pattern);
      const origin = pending?.origin ?? originFromPattern(pattern);
      if (origin === null) continue;
      await this.completeActivation(origin, pending?.tabId ?? null);
    }
  }

  private teardownOrigin(origin: string): void {
    this.sessions.stopForOrigin(origin);
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
      void this.handlePortMessage(port, tabId, raw);
    });
  }

  private post(port: chrome.runtime.Port, message: WorkerToContentMessage): void {
    port.postMessage(message);
  }

  private async handlePortMessage(
    port: chrome.runtime.Port,
    tabId: number,
    raw: unknown,
  ): Promise<void> {
    const parsed = contentToWorkerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.post(port, { type: "sw:error", code: "protocol", detail: "unparseable message" });
      return;
    }
    const senderOrigin = port.sender?.origin;
    if (senderOrigin === undefined) {
      this.post(port, { type: "sw:error", code: "protocol", detail: "no sender origin" });
      port.disconnect();
      return;
    }
    const grant = await grantFor(senderOrigin);
    if (grant === null || (await readGlobalOff())) {
      this.post(port, { type: "sw:error", code: "not_activated", detail: senderOrigin });
      port.disconnect();
      return;
    }
    try {
      await this.dispatchPortMessage(port, parsed.data, {
        tabId,
        origin: senderOrigin,
        tier: grant.tier,
      });
    } catch (cause) {
      this.post(port, {
        type: "sw:error",
        code: "network",
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  private async dispatchPortMessage(
    port: chrome.runtime.Port,
    message: ContentToWorkerMessage,
    context: PortContext,
  ): Promise<void> {
    switch (message.type) {
      case "cs:hello": {
        this.post(port, {
          type: "sw:status",
          tier: context.tier,
          turnId: null,
          paused: false,
          quota: null,
        });
        const queued = this.parked.get(context.tabId) ?? [];
        this.parked.delete(context.tabId);
        for (const message of queued) this.post(port, message);
        await this.sessions.resumeAll();
        return;
      }
      case "cs:task":
        await this.sessions.startTask({
          origin: context.origin,
          tabId: context.tabId,
          tier: context.tier,
          taskText: message.taskText,
          digest: message.digest,
        });
        return;
      case "cs:action-result": {
        const client = await createApiClient();
        await client.postActionResult({
          turnId: message.turnId,
          actionId: message.actionId,
          result: message.result,
          digest: message.digest,
        });
        return;
      }
      case "cs:confirm": {
        const client = await createApiClient();
        await client.postConfirm({
          turnId: message.turnId,
          actionId: message.actionId,
          paramsHash: message.paramsHash,
          approved: message.approved,
        });
        return;
      }
      case "cs:stop":
        this.sessions.stopForOrigin(context.origin);
        this.post(port, {
          type: "sw:status",
          tier: context.tier,
          turnId: null,
          paused: false,
          quota: null,
        });
        return;
      case "cs:pause":
      case "cs:resume":
        if (message.type === "cs:pause") this.sessions.pause(context.origin);
        else this.sessions.resume(context.origin);
        this.post(port, {
          type: "sw:status",
          tier: context.tier,
          turnId: null,
          paused: this.sessions.isPaused(context.origin),
          quota: null,
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
      case "ui:status": {
        const grants = await promoteObserveGrants();
        return {
          type: "reply:status",
          grant: grants.find((grant) => grant.origin === message.origin) ?? null,
        };
      }
      case "ui:list-grants":
        return {
          type: "reply:grants",
          grants: await promoteObserveGrants(),
          globalOff: await readGlobalOff(),
          deviceId: await ensureDeviceId(),
        };
      case "ui:set-global": {
        await writeGlobalOff(message.off);
        if (message.off) {
          for (const grant of await readGrants()) this.teardownOrigin(grant.origin);
          await syncContentScripts([]);
        } else {
          await this.reconcile();
        }
        return { type: "reply:ok" };
      }
      case "ui:quota": {
        const client = await createApiClient();
        return { type: "reply:quota", quota: await client.fetchQuota() };
      }
      case "ui:erase": {
        const client = await createApiClient();
        await client.eraseDevice();
        // Erased device id never returns; a new anonymous id is generated on next use.
        await chrome.storage.local.remove(STORAGE_KEYS.deviceId);
        return { type: "reply:ok" };
      }
      case "ui:begin-activate":
        return this.beginActivate(message.origin, message.tabId);
      case "ui:activated":
        return this.completeActivation(message.origin, message.tabId);
      case "ui:set-tier": {
        const grant = await grantFor(message.origin);
        if (grant === null) {
          return { type: "reply:error", detail: `${message.origin} is not activated` };
        }
        await upsertGrant({ ...grant, tier: message.tier });
        return { type: "reply:ok" };
      }
      case "ui:deactivate": {
        this.teardownOrigin(message.origin);
        const grants = await removeGrant(message.origin);
        await syncContentScripts(grants);
        // Install-time hosts (e2e staging) cannot be removed; grant record is already gone.
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
