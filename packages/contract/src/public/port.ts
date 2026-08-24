import { z } from "zod";
import {
  actionIdSchema,
  grantTierSchema,
  originSchema,
  quotaSchema,
  riskClassSchema,
  sha256HexSchema,
  turnIdSchema,
} from "./core";
import { actionResultSchema, actionSchema } from "./action";
import { expectPredicateSchema } from "./predicate";
import { pageDigestSchema } from "./digest";
import { turnEventSchema } from "./events";

export const PORT_NAME = "sga:agent";

export const contentToWorkerMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("cs:hello"),
    origin: originSchema,
    url: z.url(),
  }),
  z.strictObject({
    type: z.literal("cs:task"),
    taskText: z.string().min(1).max(4000),
    digest: pageDigestSchema,
  }),
  z.strictObject({
    type: z.literal("cs:action-result"),
    turnId: turnIdSchema,
    actionId: actionIdSchema,
    result: actionResultSchema,
    digest: pageDigestSchema.nullable(),
  }),
  z.strictObject({
    type: z.literal("cs:confirm"),
    turnId: turnIdSchema,
    actionId: actionIdSchema,
    paramsHash: sha256HexSchema,
    approved: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("cs:observation"),
    turnId: turnIdSchema,
    digest: pageDigestSchema,
  }),
  z.strictObject({ type: z.literal("cs:stop") }),
  z.strictObject({ type: z.literal("cs:pause") }),
  z.strictObject({ type: z.literal("cs:resume") }),
]);
export type ContentToWorkerMessage = z.infer<typeof contentToWorkerMessageSchema>;

export const workerToContentMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("sw:status"),
    tier: grantTierSchema,
    turnId: turnIdSchema.nullable(),
    paused: z.boolean(),
    quota: quotaSchema.nullable(),
  }),
  z.strictObject({
    type: z.literal("sw:event"),
    turnId: turnIdSchema,
    event: turnEventSchema,
  }),
  z.strictObject({
    type: z.literal("sw:execute"),
    turnId: turnIdSchema,
    actionId: actionIdSchema,
    action: actionSchema,
    risk: riskClassSchema,
    expect: z.array(expectPredicateSchema),
    tier: grantTierSchema,
  }),
  z.strictObject({ type: z.literal("sw:observe"), turnId: turnIdSchema }),
  z.strictObject({
    type: z.literal("sw:error"),
    code: z.enum(["not_activated", "network", "protocol", "internal"]),
    detail: z.string(),
  }),
]);
export type WorkerToContentMessage = z.infer<typeof workerToContentMessageSchema>;
