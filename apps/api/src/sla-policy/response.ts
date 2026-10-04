import { responseTimestamp, z } from "../openapi";

const policyGoalsSchema = z.array(
  z.object({
    metric: z.enum(["first_response", "resolution"]),
    workItemTypeId: z.string(),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    targetMinutes: z.number().int().min(1).max(2_147_483_647),
  }),
);

const policyVersionSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  calendarId: z.string(),
  atRiskThresholdPct: z.number().int().min(1).max(99),
  effectiveFrom: responseTimestamp.nullable(),
  goals: policyGoalsSchema,
});

export const slaPolicySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
  activeVersion: policyVersionSchema.nullable(),
  draftVersion: policyVersionSchema.nullable(),
});

const slaPolicySummarySchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  calendarId: z.string(),
  atRiskThresholdPct: z.number().int().min(1).max(99),
  effectiveFrom: responseTimestamp,
  goalCount: z.number().int().nonnegative(),
});

export const slaPolicyListItemSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
  activeVersion: slaPolicySummarySchema.nullable(),
  hasDraft: z.boolean(),
});

export const slaPolicyListSchema = z.object({
  data: z.array(slaPolicyListItemSchema),
  page: z.object({
    previousCursor: z.string().nullable(),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  meta: z.object({ total: z.number().int().min(0) }),
});

export const slaPolicyVersionConflictSchema = z.object({
  message: z.string(),
  assertedVersion: z.number().int().optional(),
  currentVersion: z.number().int().optional(),
});
