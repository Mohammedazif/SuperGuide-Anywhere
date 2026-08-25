import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestControlPlane,
  TEST_EXTENSION_ORIGIN,
  type TestControlPlane,
} from "../helpers/control-plane";

let server: TestControlPlane;

interface Registered {
  token: string;
  deviceId: string;
  turnId: string;
}

async function registerWithTurn(): Promise<Registered> {
  const deviceId = randomUUID();
  const registered = await fetch(`${server.baseUrl}/v1/device`, {
    method: "POST",
    headers: { origin: TEST_EXTENSION_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  expect(registered.status).toBe(200);
  const token = ((await registered.json()) as { sessionToken: string }).sessionToken;
  const started = await fetch(`${server.baseUrl}/v1/task`, {
    method: "POST",
    headers: {
      origin: TEST_EXTENSION_ORIGIN,
      "content-type": "application/json",
      "x-sga-device-token": token,
    },
    body: JSON.stringify({
      origin: "https://app.example.com",
      url: "https://app.example.com/settings",
      tier: "control",
      taskText: "leave a trace to erase",
      digest: { url: "https://app.example.com/settings", title: "Settings", nodes: [] },
      adapterSetVersion: null,
    }),
  });
  expect(started.status).toBe(202);
  const turnId = ((await started.json()) as { turnId: string }).turnId;
  await server.store.appendEvent(turnId, { kind: "assistant-text", text: "recorded" });
  return { token, deviceId, turnId };
}

async function countFor(deviceId: string): Promise<Record<string, number>> {
  const one = async (sql: string): Promise<number> => {
    const rows = await server.pool.query<{ count: string }>(sql, [deviceId]);
    return Number(rows.rows[0]?.count ?? "0");
  };
  return {
    devices: await one("SELECT COUNT(*) AS count FROM device WHERE id = $1"),
    turns: await one("SELECT COUNT(*) AS count FROM turn WHERE device_id = $1"),
    trajectory: await one(
      "SELECT COUNT(*) AS count FROM trajectory WHERE turn_id IN (SELECT id FROM turn WHERE device_id = $1)",
    ),
    events: await one(
      "SELECT COUNT(*) AS count FROM turn_event WHERE turn_id IN (SELECT id FROM turn WHERE device_id = $1)",
    ),
  };
}

beforeAll(async () => {
  server = await startTestControlPlane();
});

afterAll(async () => {
  await server.stop();
});

describe("the deletion path", () => {
  it("erases everything held for the requesting device, and only that device", async () => {
    const erased = await registerWithTurn();
    const bystander = await registerWithTurn();

    const before = await countFor(erased.deviceId);
    expect(before.turns).toBe(1);
    expect(before.trajectory).toBeGreaterThan(0);
    expect(before.events).toBeGreaterThan(0);

    const response = await fetch(`${server.baseUrl}/v1/erase`, {
      method: "POST",
      headers: { origin: TEST_EXTENSION_ORIGIN, "x-sga-device-token": erased.token },
    });
    expect(response.status).toBe(204);

    const after = await countFor(erased.deviceId);
    expect(after).toEqual({ devices: 0, turns: 0, trajectory: 0, events: 0 });

    const untouched = await countFor(bystander.deviceId);
    expect(untouched.devices).toBe(1);
    expect(untouched.turns).toBe(1);
    expect(untouched.trajectory).toBeGreaterThan(0);
  });

  it("leaves the append-only guarantee standing for every ordinary path", async () => {
    const { turnId } = await registerWithTurn();
    await expect(
      server.pool.query("DELETE FROM trajectory WHERE turn_id = $1", [turnId]),
    ).rejects.toThrow(/append-only|permission denied/);
    await expect(
      server.pool.query("UPDATE turn_event SET payload = '{}' WHERE turn_id = $1", [turnId]),
    ).rejects.toThrow(/append-only|permission denied/);
  });
});
