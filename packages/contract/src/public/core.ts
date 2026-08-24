import { z } from "zod";

export const grantTierSchema = z.enum(["observe", "control"]);
export type GrantTier = z.infer<typeof grantTierSchema>;

export const riskClassSchema = z.enum(["read", "write", "sensitive"]);
export type RiskClass = z.infer<typeof riskClassSchema>;

export const verdictKindSchema = z.enum(["proceed", "confirm", "refuse"]);
export type VerdictKind = z.infer<typeof verdictKindSchema>;
