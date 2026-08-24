import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { turnEventSchema, type TurnEvent } from "@sga/contract/public";
import { SseParser } from "../../packages/transport/src/sse";
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
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function api(path: string, init: ApiInit = {}): Promise<Response> {
  return fetch(`${server.baseUrl}${path}`, {
    ...(init.method === undefined ? {} : { method: init.method }),
    ...(init.body === undefined ? {} : { body: init.body }),
    ...(init.signal === undefined ? {} : { signal: init.signal }),
    headers: {
      origin: TEST_EXTENSION_ORIGIN,
      "content-type": "application/json",
      "x-sga-device-token": token,
      ...(init.headers ?? {}),
    },
  });
}

function emit(text: string): Promise<number> {
  return server.store.appendEvent(turnId, { kind: "assistant-text", text });
}

async function readStream(
  after: number,
  takeCount: number,
  abort: AbortController,
): Promise<TurnEvent[]> {
  const response = await api(`/v1/stream?turnId=${turnId}&after=${after}`, {
    signal: abort.signal,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const events: TurnEvent[] = [];
  while (events.length < takeCount) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
      events.push(turnEventSchema.parse(JSON.parse(frame.data)));
    }
  }
  abort.abort();
  return events;
}

beforeAll(async () => {
  server = await startTestControlPlane();
  const deviceId = randomUUID();
  const registered = await fetch(`${server.baseUrl}/v1/device`, {
    method: "POST",
    headers: { origin: TEST_EXTENSION_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  expect(registered.status).toBe(200);
  token = ((await registered.json()) as { sessionToken: string }).sessionToken;

  const digest = { url: "https://app.example.com/settings", title: "Settings", nodes: [] };
  const started = await api("/v1/task", {
    method: "POST",
    body: JSON.stringify({
      origin: "https://app.example.com",
      url: digest.url,
      tier: "control",
      taskText: "walk me through the transport",
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

describe("the resumable stream", () => {
  it("replays, survives a killed connection, and resumes with no duplicate and no gap", async () => {
    await emit("zero");
    await emit("one");
    await emit("two");

    const first = await readStream(-1, 3, new AbortController());
    expect(first.map((event) => event.seq)).toEqual([0, 1, 2]);

    await emit("three");
    await emit("four");
    await emit("five");

    const second = await readStream(2, 3, new AbortController());
    expect(second.map((event) => event.seq)).toEqual([3, 4, 5]);
    const texts = [...first, ...second].map((event) =>
      event.kind === "assistant-text" ? event.text : "?",
    );
    expect(texts).toEqual(["zero", "one", "two", "three", "four", "five"]);
  });

  it("delivers live events over LISTEN/NOTIFY while connected", async () => {
    const abort = new AbortController();
    const pending = readStream(5, 2, abort);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
    await emit("six");
    await emit("seven");
    const events = await pending;
    expect(events.map((event) => event.seq)).toEqual([6, 7]);
  }, 20_000);

  it("honours Last-Event-ID when no query parameter is given", async () => {
    const abort = new AbortController();
    const response = await api(`/v1/stream?turnId=${turnId}`, {
      headers: { "last-event-id": "6" },
      signal: abort.signal,
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const events: TurnEvent[] = [];
    while (events.length < 1) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
        events.push(turnEventSchema.parse(JSON.parse(frame.data)));
      }
    }
    abort.abort();
    expect(events[0]?.seq).toBe(7);
  });

  it("rejects a stream for a turn owned by another device", async () => {
    const otherDevice = await fetch(`${server.baseUrl}/v1/device`, {
      method: "POST",
      headers: { origin: TEST_EXTENSION_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ deviceId: randomUUID() }),
    });
    const otherToken = ((await otherDevice.json()) as { sessionToken: string }).sessionToken;
    const response = await fetch(`${server.baseUrl}/v1/stream?turnId=${turnId}&after=-1`, {
      headers: { origin: TEST_EXTENSION_ORIGIN, "x-sga-device-token": otherToken },
    });
    expect(response.status).toBe(404);
  });
});

describe("action results", () => {
  it("is idempotent on actionId: the same delivery twice has one effect", async () => {
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
    const first = await api("/v1/action-result", { method: "POST", body });
    const second = await api("/v1/action-result", { method: "POST", body });
    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    const stored = await server.pool.query("SELECT count(*) FROM action_result WHERE action_id = $1", [
      actionId,
    ]);
    expect(stored.rows[0]).toEqual({ count: "1" });
    const steps = await server.pool.query(
      "SELECT count(*) FROM trajectory WHERE turn_id = $1 AND kind = 'action-result'",
      [turnId],
    );
    expect(steps.rows[0]).toEqual({ count: "1" });
  });
});

describe("origin validation", () => {
  it("rejects any request without an allowed extension origin, including the stream", async () => {
    const noOrigin = await fetch(`${server.baseUrl}/v1/quota`, {
      headers: { "x-sga-device-token": token },
    });
    expect(noOrigin.status).toBe(403);
    const wrongOrigin = await fetch(`${server.baseUrl}/v1/stream?turnId=${turnId}`, {
      headers: { origin: "https://evil.example", "x-sga-device-token": token },
    });
    expect(wrongOrigin.status).toBe(403);
  });
});
