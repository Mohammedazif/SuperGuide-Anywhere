import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { buildPlannerRequest } from "../../apps/control-plane/src/agent/prompts";

const key = process.env["ANTHROPIC_API_KEY"] ?? "";

describe.skipIf(key.length === 0)("prompt cache stability against the live API", () => {
  it(
    "serves the tools-and-system prefix from cache on the second turn",
    async () => {
      const client = new Anthropic({ apiKey: key });
      const probe = async (detail: string): Promise<Anthropic.Beta.Messages.BetaMessage> => {
        const stream = client.beta.messages.stream(
          buildPlannerRequest([
            {
              role: "user",
              content:
                "This is a connectivity probe, not a page task. Call the finish tool " +
                `immediately with outcome not-completed and detail '${detail}'. Do nothing else.`,
            },
          ]),
        );
        return stream.finalMessage();
      };
      await probe("cache probe one");
      const second = await probe("cache probe two");
      expect(second.usage.cache_read_input_tokens ?? 0).toBeGreaterThan(0);
    },
    180_000,
  );
});
