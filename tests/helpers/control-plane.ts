import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import type { AdapterSet } from "@sga/contract/public";
import { parseEnvironment, type Environment } from "../../apps/control-plane/src/env";
import { EventBus } from "../../apps/control-plane/src/notify/bus";
import { buildServer, type TurnAgentStarter } from "../../apps/control-plane/src/server";
import { QuotaService } from "../../apps/control-plane/src/turn/quota";
import { TurnStore } from "../../apps/control-plane/src/turn/store";
import { appDatabaseUrl } from "./db";

export const TEST_EXTENSION_ORIGIN = "chrome-extension://ghdcebndlanhmdeajdbbemcaihpenhoj";

export interface TestControlPlane {
  baseUrl: string;
  env: Environment;
  pool: pg.Pool;
  store: TurnStore;
  quotas: QuotaService;
  stop(): Promise<void>;
}

export interface AgentContext {
  env: Environment;
  pool: pg.Pool;
  store: TurnStore;
  quotas: QuotaService;
}

export async function startTestControlPlane(
  overrides: Partial<Record<string, string>> = {},
  makeAgent?: (context: AgentContext) => TurnAgentStarter,
  adapterSet?: AdapterSet,
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
  const store = new TurnStore(pool);
  const quotas = new QuotaService(pool, env);
  const agent = makeAgent?.({ env, pool, store, quotas }) ?? null;
  const app = buildServer({
    env,
    pool,
    bus,
    agent,
    ...(adapterSet === undefined ? {} : { adapterSet }),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    env,
    pool,
    store,
    quotas,
    stop: async () => {
      await app.close();
      await bus.stop();
      await pool.end();
    },
  };
}
