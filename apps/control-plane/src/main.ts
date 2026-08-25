import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnvironment, EnvironmentError } from "./env";
import { loadAdapterDirectory } from "./adapters-fs";
import { TurnAgent } from "./agent/loop";
import { makeProvider } from "./agent/provider";
import { EventBus } from "./notify/bus";
import { buildServer } from "./server";
import { QuotaService } from "./turn/quota";
import { TurnStore } from "./turn/store";

const ADAPTERS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../adapters");

try {
  const env = loadEnvironment();
  const pool = new pg.Pool({ connectionString: env.SGA_DATABASE_URL });
  const bus = await EventBus.start(env.SGA_DATABASE_URL);

  let agent: TurnAgent | null = null;
  if (env.SGA_AGENT_LOOP === "on") {
    const provider = makeProvider(env);
    agent = new TurnAgent({
      env,
      pool,
      store: new TurnStore(pool),
      quotas: new QuotaService(pool, env),
      plan: (request) => provider.plan(request),
      scan: (strings) => provider.scan(strings),
    });
  }

  const adapterSet =
    env.SGA_ADAPTERS === "on" ? loadAdapterDirectory(ADAPTERS_DIR) : { version: 1, adapters: [] };
  const app = buildServer({ env, pool, bus, agent, adapterSet });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await bus.stop();
    await pool.end();
  };
  process.on("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });

  await app.listen({ port: env.SGA_PORT, host: "::" });
} catch (cause) {
  if (cause instanceof EnvironmentError) {
    process.stderr.write(`${cause.message}\n`);
    process.exit(1);
  }
  throw cause;
}
