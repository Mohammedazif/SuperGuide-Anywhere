import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMigrationEnvironment } from "../env";
import { runMigrations } from "./migrate";

const environment = loadMigrationEnvironment();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const ran = await runMigrations(environment.SGA_MIGRATION_DATABASE_URL, migrationsDir);
process.stdout.write(
  ran.length === 0 ? "migrations already up to date\n" : `applied: ${ran.join(", ")}\n`,
);
