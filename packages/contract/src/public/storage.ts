import { z } from "zod";
import { deviceIdSchema, grantTierSchema, originSchema, turnIdSchema } from "./core";
import { adapterSetSchema } from "./adapter";

export const STORAGE_KEYS = {
  deviceId: "sga.deviceId",
  grants: "sga.grants",
  adapterCache: "sga.adapterCache",
  globalOff: "sga.globalOff",
  turnPrefix: "sga.turn.",
} as const;

export const siteGrantSchema = z.strictObject({
  origin: originSchema,
  tier: grantTierSchema,
  grantedAt: z.number().int().min(0),
});
export type SiteGrant = z.infer<typeof siteGrantSchema>;

export const grantsRecordSchema = z.array(siteGrantSchema);
export type GrantsRecord = z.infer<typeof grantsRecordSchema>;

export const storedDeviceIdSchema = deviceIdSchema;

export const adapterCacheSchema = adapterSetSchema;

export const inFlightTurnSchema = z.strictObject({
  turnId: turnIdSchema,
  origin: originSchema,
  tabId: z.number().int().min(0),
  lastSeq: z.number().int().min(-1),
});
export type InFlightTurn = z.infer<typeof inFlightTurnSchema>;
