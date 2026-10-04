import { HTTPException } from "hono/http-exception";
import { z } from "../openapi";

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const identifier = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\u0000"));
const goal = z
  .object({
    metric: z.string().openapi({ enum: ["first_response", "resolution"] }),
    workItemTypeId: identifier,
    priority: z.string().openapi({ enum: ["low", "medium", "high", "urgent"] }),
    targetMinutes: z.number().openapi({
      type: "integer",
      minimum: 1,
      maximum: POSTGRES_INTEGER_MAX,
    }),
  })
  .strict();

export const policyGoalsSchema = z.array(goal);

const threshold = z.number().int().min(1).max(99);
export const createPolicyBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2_000).nullable().optional(),
    calendarId: identifier,
    atRiskThresholdPct: threshold.default(75),
    goals: policyGoalsSchema.default([]),
  })
  .strict();

export const updatePolicyBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2_000).nullable().optional(),
    calendarId: identifier.optional(),
    atRiskThresholdPct: threshold.optional(),
    goals: policyGoalsSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export const policyIdParam = z.object({ id: identifier });
export const workspaceIdQuery = z.object({
  workspaceId: identifier,
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const optionalPolicyIfMatchHeader = z.object({
  "if-match": z
    .string()
    .regex(
      /^"[1-9]\d*"$/,
      'If-Match must be a positive quoted version, e.g. "3"',
    )
    .refine(
      (value) => Number(value.slice(1, -1)) <= POSTGRES_INTEGER_MAX,
      `If-Match must not exceed ${POSTGRES_INTEGER_MAX}`,
    )
    .optional(),
});

export type PolicyGoalInput = {
  metric: "first_response" | "resolution";
  workItemTypeId: string;
  priority: "low" | "medium" | "high" | "urgent";
  targetMinutes: number;
};
export type PolicyGoalCandidate = Omit<
  PolicyGoalInput,
  "metric" | "priority"
> & {
  metric: string;
  priority: string;
};
export type CreatePolicyInput = z.infer<typeof createPolicyBody>;
export type UpdatePolicyInput = z.infer<typeof updatePolicyBody>;

export function validatePolicyGoals(
  goals: PolicyGoalCandidate[],
): PolicyGoalInput[] {
  const tuples = new Set<string>();
  for (const item of goals) {
    if (item.metric !== "first_response" && item.metric !== "resolution") {
      throw new HTTPException(422, { message: "Invalid policy configuration" });
    }
    if (!["low", "medium", "high", "urgent"].includes(item.priority)) {
      throw new HTTPException(422, { message: "Invalid policy configuration" });
    }
    if (
      !Number.isInteger(item.targetMinutes) ||
      item.targetMinutes < 1 ||
      item.targetMinutes > POSTGRES_INTEGER_MAX
    ) {
      throw new HTTPException(422, { message: "Invalid policy configuration" });
    }
    const tuple = `${item.metric}\u0000${item.workItemTypeId}\u0000${item.priority}`;
    if (tuples.has(tuple)) {
      throw new HTTPException(422, { message: "Invalid policy configuration" });
    }
    tuples.add(tuple);
  }
  return goals as PolicyGoalInput[];
}
