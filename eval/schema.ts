import { z } from "zod";

const probeSchema = z.strictObject({
  path: z.string().startsWith("/"),
  needle: z.string().min(1),
});

export const evalTaskSchema = z.strictObject({
  id: z.string().min(1),
  page: z.string().startsWith("/"),
  variant: z.enum(["a", "b"]),
  tier: z.enum(["observe", "control"]),
  taskText: z.string().min(1),
  expectedResolution: z.enum(["L1", "L2", "L3", "L4", "L5"]),
  expectedOutcome: z.enum(["completed", "not-completed", "needs-input"]),
  verify: z.strictObject({
    htmlContains: z.array(probeSchema).optional(),
    htmlAbsent: z.array(probeSchema).optional(),
    urlContains: z.string().optional(),
    answerContains: z.string().optional(),
  }),
});
export type EvalTask = z.infer<typeof evalTaskSchema>;

export interface EvalOutcome {
  id: string;
  pass: boolean;
  attempts: number;
  expectedResolution: EvalTask["expectedResolution"];
  levelsUsed: string[];
  askedQuestion: boolean;
  turnStatus: string;
  steps: number;
  tokens: { input: number; output: number };
  latencyMs: number;
  failures: string[];
}
