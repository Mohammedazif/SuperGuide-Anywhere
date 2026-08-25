export type LiveProviderName = "anthropic" | "openai" | "gemini";

export interface LiveProvider {
  provider: LiveProviderName;
  keyName: string;
  key: string;
}

// The live suites run against whichever provider .env selects, gated on that
// provider's key rather than always on the Anthropic one.
export function liveProvider(): LiveProvider {
  const raw = process.env["SGA_MODEL_PROVIDER"] ?? "anthropic";
  const provider: LiveProviderName =
    raw === "openai" || raw === "gemini" ? raw : "anthropic";
  const keyName =
    provider === "openai"
      ? "OPENAI_API_KEY"
      : provider === "gemini"
        ? "GEMINI_API_KEY"
        : "ANTHROPIC_API_KEY";
  return { provider, keyName, key: process.env[keyName] ?? "" };
}
