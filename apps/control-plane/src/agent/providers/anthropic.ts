import Anthropic from "@anthropic-ai/sdk";
import { scanForInjection } from "../classifier";
import type { ModelProvider } from "../provider";

export function makeAnthropicProvider(apiKey: string): ModelProvider {
  const client = new Anthropic({ apiKey });
  return {
    plan: (request) => client.beta.messages.stream(request).finalMessage(),
    scan: (strings) => scanForInjection(client, strings),
  };
}
