import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { parseEnvironment, type Environment } from "../../apps/control-plane/src/env";
import { EventBus } from "../../apps/control-plane/src/notify/bus";
import { buildServer } from "../../apps/control-plane/src/server";
import { TurnStore } from "../../apps/control-plane/src/turn/store";
import { appDatabaseUrl } from "./db";

export const TEST_EXTENSION_ORIGIN = "chrome-extension://ghdcebndlanhmdeajdbbemcaihpenhoj";

export interface TestControlPlane {
  baseUrl: string;
  env: Environment;
  pool: pg.Pool;
  store: TurnStore;
  stop(): Promise<void>;
}

export async function startTestControlPlane(
  overrides: Partial<Record<string, string>> = {},
): Promise<TestControlPlane> {
  const env = parseEnvironment({
    SGA_DATABASE_URL: appDatabaseUrl(),
    SGA_PUBLIC_ORIGIN: "http://127.0.0.1:0",
    ANTHROPIC_API_KEY: "unused-in-transport-tests",
    SGA_DEVICE_SIGNING_KEY: randomBytes(32).toString("base64"),
    SGA_ALLOWED_EXTENSION_IDS: TEST_EXTENSION_ORIGIN,
    SGA_LOG_LEVEL: "warn",
    ...overrides,
  });
  const pool = new pg.Pool({ connectionString: env.SGA_DATABASE_URL });
  const bus = await EventBus.start(env.SGA_DATABASE_URL);
  const app = buildServer({ env, pool, bus });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    env,
    pool,
    store: new TurnStore(pool),
    stop: async () => {
      await app.close();
      await bus.stop();
      await pool.end();
    },
  };
}
