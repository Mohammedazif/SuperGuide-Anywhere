import { z } from "zod";

const base64Key = z.string().refine(
  (value) => {
    try {
      return Buffer.from(value, "base64").length >= 32;
    } catch {
      return false;
    }
  },
  { message: "must be base64 decoding to at least 32 bytes" },
);

const commaSeparated = z
  .string()
  .min(1)
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .refine((entries) => entries.length > 0, { message: "must list at least one extension origin" });

const KEY_OF_PROVIDER = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
} as const;

export const environmentSchema = z
  .object({
    SGA_DATABASE_URL: z.url(),
    SGA_MIGRATION_DATABASE_URL: z.url().optional(),
    SGA_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    SGA_PUBLIC_ORIGIN: z.url(),
    SGA_MODEL_PROVIDER: z.enum(["anthropic", "openai", "gemini"]).default("anthropic"),
    ANTHROPIC_API_KEY: z.string().default(""),
    OPENAI_API_KEY: z.string().default(""),
    GEMINI_API_KEY: z.string().default(""),
    SGA_DEVICE_SIGNING_KEY: base64Key,
    SGA_STEP_BUDGET: z.coerce.number().int().min(1).default(12),
    SGA_DAILY_TASK_QUOTA: z.coerce.number().int().min(0).default(20),
    SGA_DAILY_IP_QUOTA: z.coerce.number().int().min(0).default(200),
    SGA_ALLOWED_EXTENSION_IDS: commaSeparated,
    SGA_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    SGA_AGENT_LOOP: z.enum(["on", "off"]).default("on"),
    SGA_ADAPTERS: z.enum(["on", "off"]).default("on"),
  })
  .superRefine((value, context) => {
    const keyName = KEY_OF_PROVIDER[value.SGA_MODEL_PROVIDER];
    if (value.SGA_AGENT_LOOP === "on" && value[keyName].length === 0) {
      context.addIssue({
        code: "custom",
        path: [keyName],
        message: `must be set when SGA_MODEL_PROVIDER=${value.SGA_MODEL_PROVIDER} and the agent loop is on`,
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export class EnvironmentError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`environment validation failed:\n${issues.join("\n")}`);
    this.name = "EnvironmentError";
  }
}

export function parseEnvironment(source: Record<string, string | undefined>): Environment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    throw new EnvironmentError(
      result.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return result.data;
}

export function loadEnvironment(): Environment {
  return parseEnvironment(process.env);
}

const migrationEnvironmentSchema = z.object({
  SGA_MIGRATION_DATABASE_URL: z.url(),
});

export type MigrationEnvironment = z.infer<typeof migrationEnvironmentSchema>;

export function loadMigrationEnvironment(): MigrationEnvironment {
  const result = migrationEnvironmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new EnvironmentError(
      result.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return result.data;
}
