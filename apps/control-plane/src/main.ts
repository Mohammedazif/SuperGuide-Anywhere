import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";
import { loadEnvironment, EnvironmentError } from "./env";
import { TurnAgent } from "./agent/loop";
import { scanForInjection } from "./agent/classifier";
import { EventBus } from "./notify/bus";
import { buildServer } from "./server";
import { QuotaService } from "./turn/quota";
import { TurnStore } from "./turn/store";

try {
  const env = loadEnvironment();
  const pool = new pg.Pool({ connectionString: env.SGA_DATABASE_URL });
  const bus = await EventBus.start(env.SGA_DATABASE_URL);

  let agent: TurnAgent | null = null;
  if (env.SGA_AGENT_LOOP === "on") {
    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    agent = new TurnAgent({
      env,
      pool,
      store: new TurnStore(pool),
      quotas: new QuotaService(pool, env),
      plan: (request) => anthropic.beta.messages.stream(request).finalMessage(),
      scan: (strings) => scanForInjection(anthropic, strings),
    });
  }

  const app = buildServer({ env, pool, bus, agent });

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
