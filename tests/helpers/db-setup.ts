import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { adminDatabaseUrl, migratorDatabaseUrl } from "./db";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function connectAdmin(): Promise<pg.Client | null> {
  const client = new pg.Client({ connectionString: adminDatabaseUrl() });
  try {
    await client.connect();
    return client;
  } catch {
    await client.end().catch(() => undefined);
    return null;
  }
}

export async function prepareDatabase(): Promise<void> {
  let admin = await connectAdmin();
  if (admin === null) {
    spawnSync("node", [join(REPO_ROOT, "tools/scripts/pg-dev.mjs"), "start"], {
      stdio: "inherit",
    });
    admin = await connectAdmin();
  }
  if (admin === null) {
    throw new Error("postgres is not reachable: run `docker compose up -d` or `pnpm db:start` first");
  }
  await admin.query("DROP SCHEMA public CASCADE");
  await admin.query("CREATE SCHEMA public");
  await admin.query(readFileSync(join(REPO_ROOT, "tools/scripts/bootstrap-roles.sql"), "utf8"));
  await admin.end();

  const result = spawnSync(
    "node",
    ["--import", "tsx", join(REPO_ROOT, "apps/control-plane/src/db/migrate-cli.ts")],
    {
      encoding: "utf8",
      env: { ...process.env, SGA_MIGRATION_DATABASE_URL: migratorDatabaseUrl() },
    },
  );
  if (result.status !== 0) {
    throw new Error(`migrations failed\n${result.stdout}\n${result.stderr}`);
  }
}
