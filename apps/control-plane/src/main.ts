import pg from "pg";
import { loadEnvironment, EnvironmentError } from "./env";
import { EventBus } from "./notify/bus";
import { buildServer } from "./server";

try {
  const env = loadEnvironment();
  const pool = new pg.Pool({ connectionString: env.SGA_DATABASE_URL });
  const bus = await EventBus.start(env.SGA_DATABASE_URL);
  const app = buildServer({ env, pool, bus });

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
