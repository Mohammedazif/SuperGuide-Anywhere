import { z } from "zod";
import {
  grantTierSchema,
  grantsRecordSchema,
  originSchema,
  quotaSchema,
  siteGrantSchema,
} from "@sga/contract/public";

export const uiToWorkerMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ui:status"), origin: originSchema }),
  z.strictObject({
    type: z.literal("ui:begin-activate"),
    origin: originSchema,
    tabId: z.number().int().min(0).nullable(),
  }),
  z.strictObject({
    type: z.literal("ui:activated"),
    origin: originSchema,
    tabId: z.number().int().min(0).nullable(),
  }),
  z.strictObject({ type: z.literal("ui:set-tier"), origin: originSchema, tier: grantTierSchema }),
  z.strictObject({ type: z.literal("ui:deactivate"), origin: originSchema }),
  z.strictObject({ type: z.literal("ui:list-grants") }),
  z.strictObject({ type: z.literal("ui:set-global"), off: z.boolean() }),
  z.strictObject({ type: z.literal("ui:quota") }),
  z.strictObject({ type: z.literal("ui:erase") }),
]);
export type UiToWorkerMessage = z.infer<typeof uiToWorkerMessageSchema>;

export const workerReplySchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("reply:status"), grant: siteGrantSchema.nullable() }),
  z.strictObject({
    type: z.literal("reply:grants"),
    grants: grantsRecordSchema,
    globalOff: z.boolean(),
    deviceId: z.string(),
  }),
  z.strictObject({ type: z.literal("reply:quota"), quota: quotaSchema }),
  z.strictObject({ type: z.literal("reply:ok") }),
  z.strictObject({ type: z.literal("reply:needs-permission") }),
  z.strictObject({ type: z.literal("reply:error"), detail: z.string() }),
]);
export type WorkerReply = z.infer<typeof workerReplySchema>;

export async function requestWorker(message: UiToWorkerMessage): Promise<WorkerReply> {
  const reply: unknown = await chrome.runtime.sendMessage(message);
  return workerReplySchema.parse(reply);
}
