import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { buildPlannerRequest } from "../../apps/control-plane/src/agent/prompts";
import {
  fromOpenAIResponse,
  toOpenAIRequest,
} from "../../apps/control-plane/src/agent/providers/openai";
import { liveProvider } from "../helpers/live";

const live = liveProvider();

// Gemini is excluded: its implicit caching makes no per-request read guarantee,
// so there is nothing honest to assert. Anthropic and OpenAI both report cache
// reads that a byte-stable prefix must produce on the second call.
describe.skipIf(live.key.length === 0 || live.provider === "gemini")(
  "prompt cache stability against the live API",
  () => {
    it(
      "serves the tools-and-system prefix from cache on the second turn",
      async () => {
        const request = (detail: string) =>
          buildPlannerRequest([
            {
              role: "user",
              content:
                "This is a connectivity probe, not a page task. Call the finish tool " +
                `immediately with outcome not-completed and detail '${detail}'. Do nothing else.`,
            },
          ]);
        const probe =
          live.provider === "anthropic"
            ? (() => {
                const client = new Anthropic({ apiKey: live.key });
                return (detail: string) =>
                  client.beta.messages.stream(request(detail)).finalMessage();
              })()
            : (() => {
                const client = new OpenAI({ apiKey: live.key });
                return async (detail: string) =>
                  fromOpenAIResponse(await client.responses.create(toOpenAIRequest(request(detail))));
              })();
        await probe("cache probe one");
        const second = await probe("cache probe two");
        expect(second.usage.cache_read_input_tokens ?? 0).toBeGreaterThan(0);
      },
      180_000,
    );
  },
);
