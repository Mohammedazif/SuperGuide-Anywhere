import {
  adaptersResponseSchema,
  deviceRegisterResponseSchema,
  errorResponseSchema,
  quotaResponseSchema,
  taskResponseSchema,
  turnEventSchema,
  type ActionResult,
  type AdapterSet,
  type PageDigest,
  type Quota,
  type TaskRequest,
  type TurnEvent,
} from "@sga/contract/public";
import type { z } from "zod";
import { SseParser } from "./sse";
import { StreamSequencer } from "./sequencer";
import { TransportFailure } from "./errors";

const TOKEN_HEADER = "x-sga-device-token";

export interface ClientConfig {
  baseUrl: string;
  getToken(): Promise<string>;
  refreshToken(): Promise<string>;
}

export interface StreamHandlers {
  onEvent(event: TurnEvent): void | Promise<void>;
  onEnd(): void;
}

async function parseFailure(response: Response): Promise<TransportFailure> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const parsed = errorResponseSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, resetsAt } = parsed.data.error;
    return new TransportFailure(
      resetsAt === undefined
        ? { kind: "http", status: response.status, code, message }
        : { kind: "http", status: response.status, code, message, resetsAt },
    );
  }
  return new TransportFailure({
    kind: "http",
    status: response.status,
    code: "internal",
    message: "unrecognised error body",
  });
}

export async function registerDevice(
  baseUrl: string,
  deviceId: string,
): Promise<{ sessionToken: string; expiresAt: string }> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/device`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
  } catch (cause) {
    throw new TransportFailure({
      kind: "network",
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (!response.ok) throw await parseFailure(response);
  const parsed = deviceRegisterResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new TransportFailure({ kind: "protocol", detail: parsed.error.message });
  }
  return parsed.data;
}

export class ControlPlaneClient {
  constructor(private readonly config: ClientConfig) {}

  private async request(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown },
    retryOnAuthFailure = true,
  ): Promise<Response> {
    const token = await this.config.getToken();
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method: init.method,
        headers: {
          [TOKEN_HEADER]: token,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch (cause) {
      throw new TransportFailure({
        kind: "network",
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    }
    if (response.status === 401 && retryOnAuthFailure) {
      await this.config.refreshToken();
      return this.request(path, init, false);
    }
    return response;
  }

  private async requestParsed<Schema extends z.ZodType>(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown },
    schema: Schema,
  ): Promise<z.infer<Schema>> {
    const response = await this.request(path, init);
    if (!response.ok) throw await parseFailure(response);
    const body: unknown = await response.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new TransportFailure({ kind: "protocol", detail: parsed.error.message });
    }
    return parsed.data;
  }

  async startTask(request: TaskRequest): Promise<{ turnId: string; quota: Quota }> {
    return this.requestParsed("/v1/task", { method: "POST", body: request }, taskResponseSchema);
  }

  async postActionResult(input: {
    turnId: string;
    actionId: string;
    result: ActionResult;
    digest: PageDigest | null;
  }): Promise<void> {
    const response = await this.request("/v1/action-result", { method: "POST", body: input });
    if (!response.ok) throw await parseFailure(response);
  }

  async postConfirm(input: {
    turnId: string;
    actionId: string;
    paramsHash: string;
    approved: boolean;
  }): Promise<void> {
    const response = await this.request("/v1/confirm", { method: "POST", body: input });
    if (!response.ok) throw await parseFailure(response);
  }

  async fetchQuota(): Promise<Quota> {
    const parsed = await this.requestParsed("/v1/quota", { method: "GET" }, quotaResponseSchema);
    return parsed.quota;
  }

  async fetchAdapters(): Promise<AdapterSet> {
    return this.requestParsed("/v1/adapters", { method: "GET" }, adaptersResponseSchema);
  }

  async streamTurn(
    turnId: string,
    afterSeq: number,
    handlers: StreamHandlers,
    signal: AbortSignal,
  ): Promise<void> {
    const sequencer = new StreamSequencer(afterSeq);
    const aborted = (): boolean => signal.aborted;
    let backoffMs = 200;
    while (!aborted()) {
      let response: Response;
      try {
        const token = await this.config.getToken();
        response = await fetch(
          `${this.config.baseUrl}/v1/stream?turnId=${turnId}&after=${sequencer.lastSeq}`,
          { headers: { [TOKEN_HEADER]: token }, signal },
        );
      } catch {
        if (aborted()) break;
        await delay(backoffMs, signal);
        backoffMs = Math.min(backoffMs * 2, 5_000);
        continue;
      }
      if (response.status === 401) {
        await this.config.refreshToken();
        continue;
      }
      if (!response.ok || response.body === null) {
        await delay(backoffMs, signal);
        backoffMs = Math.min(backoffMs * 2, 5_000);
        continue;
      }
      backoffMs = 200;
      const ended = await this.consume(response.body, sequencer, handlers);
      if (ended) {
        handlers.onEnd();
        return;
      }
    }
  }

  private async consume(
    body: ReadableStream<Uint8Array>,
    sequencer: StreamSequencer,
    handlers: StreamHandlers,
  ): Promise<boolean> {
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return false;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          const parsed = turnEventSchema.safeParse(JSON.parse(frame.data));
          if (!parsed.success) continue;
          const verdict = sequencer.classify(parsed.data.seq);
          if (verdict === "duplicate") continue;
          if (verdict === "gap") return false;
          await handlers.onEvent(parsed.data);
          if (parsed.data.kind === "turn-end") return true;
        }
      }
    } catch {
      return false;
    } finally {
      reader.releaseLock();
    }
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveDelay) => {
    const timer = setTimeout(finish, ms);
    function finish(): void {
      signal.removeEventListener("abort", finish);
      clearTimeout(timer);
      resolveDelay();
    }
    signal.addEventListener("abort", finish);
  });
}
