import { z } from "zod";
import { deviceIdSchema, turnIdSchema } from "../public/core";

export const CONTRACT_INTERNAL_MARKER = "sga-contract-internal-must-never-ship-in-the-extension";

export const deviceTokenClaimsSchema = z.strictObject({
  deviceId: deviceIdSchema,
  issuedAt: z.number().int().min(0),
  expiresAt: z.number().int().min(0),
});
export type DeviceTokenClaims = z.infer<typeof deviceTokenClaimsSchema>;

export const trajectoryStepKindSchema = z.enum([
  "task-received",
  "model-response",
  "injection-scan",
  "action-planned",
  "policy-verdict",
  "action-dispatched",
  "action-result",
  "confirmation",
  "observation",
  "question",
  "report",
  "refusal",
  "error",
  "turn-end",
]);
export type TrajectoryStepKind = z.infer<typeof trajectoryStepKindSchema>;

export const trajectoryStepSchema = z.strictObject({
  turnId: turnIdSchema,
  seq: z.number().int().min(0),
  kind: trajectoryStepKindSchema,
  payload: z.json(),
});
export type TrajectoryStep = z.infer<typeof trajectoryStepSchema>;
