import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

export class MigrationError extends Error {
  constructor(
    readonly file: string,
    cause: unknown,
  ) {
    super(`migration ${file} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "MigrationError";
  }
}

export async function runMigrations(
  databaseUrl: string,
  migrationsDir: string,
): Promise<readonly string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const appliedRows = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const applied = new Set(appliedRows.rows.map((row) => row.name));
    const files = readdirSync(migrationsDir)
      .filter((file) => /^\d{4}_[a-z0-9_-]+\.sql$/.test(file))
      .sort();
    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (cause) {
        await client.query("ROLLBACK");
        throw new MigrationError(file, cause);
      }
      ran.push(file);
    }
    return ran;
  } finally {
    await client.end();
  }
}
