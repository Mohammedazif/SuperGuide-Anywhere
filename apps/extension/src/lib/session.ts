import {
  STORAGE_KEYS,
  inFlightTurnSchema,
  type GrantTier,
  type InFlightTurn,
  type PageDigest,
  type WorkerToContentMessage,
} from "@sga/contract/public";
import type { ControlPlaneClient } from "@sga/transport";
import { cachedAdapterVersion } from "./adapters";

interface LiveTurn {
  turnId: string;
  abort: AbortController;
}

function turnKey(turnId: string): string {
  return `${STORAGE_KEYS.turnPrefix}${turnId}`;
}

export class TurnSessionManager {
  private readonly live = new Map<string, LiveTurn>();
  private readonly pausedOrigins = new Set<string>();
  private held: { tabId: number; origin: string; message: WorkerToContentMessage }[] = [];

  constructor(
    private readonly getClient: () => Promise<ControlPlaneClient>,
    private readonly postToTab: (tabId: number, message: WorkerToContentMessage) => void,
    private readonly tierFor: (origin: string) => Promise<GrantTier | null>,
  ) {}

  async startTask(input: {
    origin: string;
    tabId: number;
    tier: GrantTier;
    taskText: string;
    digest: PageDigest;
  }): Promise<void> {
    const client = await this.getClient();
    const started = await client.startTask({
      origin: input.origin,
      url: input.digest.url,
      tier: input.tier,
      taskText: input.taskText,
      digest: input.digest,
      adapterSetVersion: await cachedAdapterVersion(),
    });
    const record: InFlightTurn = {
      turnId: started.turnId,
      origin: input.origin,
      tabId: input.tabId,
      lastSeq: -1,
      delivered: 0,
    };
    await chrome.storage.session.set({ [turnKey(started.turnId)]: record });
    this.postToTab(input.tabId, {
      type: "sw:status",
      tier: input.tier,
      turnId: started.turnId,
      paused: false,
      quota: started.quota,
    });
    this.pump(record);
  }

  async resumeAll(): Promise<void> {
    const everything = await chrome.storage.session.get(null);
    for (const [key, value] of Object.entries(everything)) {
      if (!key.startsWith(STORAGE_KEYS.turnPrefix)) continue;
      const parsed = inFlightTurnSchema.safeParse(value);
      if (!parsed.success) {
        await chrome.storage.session.remove(key);
        continue;
      }
      if (this.live.has(parsed.data.turnId)) continue;
      this.pump(parsed.data);
    }
  }

  pause(origin: string): void {
    this.pausedOrigins.add(origin);
  }

  resume(origin: string): void {
    this.pausedOrigins.delete(origin);
    const releasable = this.held.filter((entry) => entry.origin === origin);
    this.held = this.held.filter((entry) => entry.origin !== origin);
    for (const entry of releasable) this.postToTab(entry.tabId, entry.message);
  }

  isPaused(origin: string): boolean {
    return this.pausedOrigins.has(origin);
  }

  stopForOrigin(origin: string): void {
    this.pausedOrigins.delete(origin);
    this.held = this.held.filter((entry) => entry.origin !== origin);
    for (const [turnId, turn] of this.live) {
      void chrome.storage.session.get(turnKey(turnId)).then((stored) => {
        const parsed = inFlightTurnSchema.safeParse(stored[turnKey(turnId)]);
        if (parsed.success && parsed.data.origin === origin) {
          turn.abort.abort();
          this.live.delete(turnId);
          void chrome.storage.session.remove(turnKey(turnId));
        }
      });
    }
  }

  private pump(record: InFlightTurn): void {
    const abort = new AbortController();
    this.live.set(record.turnId, { turnId: record.turnId, abort });
    let state = record;
    void (async () => {
      const client = await this.getClient();
      await client.streamTurn(
        record.turnId,
        record.lastSeq,
        {
          onEvent: async (event) => {
            state = { ...state, lastSeq: event.seq, delivered: state.delivered + 1 };
            await chrome.storage.session.set({ [turnKey(record.turnId)]: state });
            this.postToTab(record.tabId, {
              type: "sw:event",
              turnId: record.turnId,
              event,
            });
            if (event.kind === "action-request" && !event.needsConfirmation) {
              // The tier is read at dispatch time, not turn start, so a mid-turn
              // downgrade to observe stops the next action.
              const tier = await this.tierFor(record.origin);
              if (tier === null) return;
              const execute: WorkerToContentMessage = {
                type: "sw:execute",
                turnId: record.turnId,
                actionId: event.actionId,
                action: event.action,
                risk: event.risk,
                expect: event.expect,
                tier,
              };
              if (this.pausedOrigins.has(record.origin)) {
                this.held.push({ tabId: record.tabId, origin: record.origin, message: execute });
              } else {
                this.postToTab(record.tabId, execute);
              }
            }
          },
          onEnd: () => {
            this.live.delete(record.turnId);
          },
        },
        abort.signal,
      );
    })().catch(() => {
      this.live.delete(record.turnId);
    });
  }
}
