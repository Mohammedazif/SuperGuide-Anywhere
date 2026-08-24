const PORT = 55433;

function fromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.length > 0 ? value : fallback;
}

export function adminDatabaseUrl(): string {
  return fromEnv(
    "SGA_ADMIN_DATABASE_URL",
    `postgresql://postgres:postgres@127.0.0.1:${PORT}/superguide_anywhere`,
  );
}

export function migratorDatabaseUrl(): string {
  return fromEnv(
    "SGA_MIGRATION_DATABASE_URL",
    `postgresql://sga_migrator:local-dev-only@127.0.0.1:${PORT}/superguide_anywhere`,
  );
}

export function appDatabaseUrl(): string {
  return fromEnv(
    "SGA_DATABASE_URL",
    `postgresql://sga_app:local-dev-only@127.0.0.1:${PORT}/superguide_anywhere`,
  );
}
