import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

export const automationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  projectFilter: z.array(z.string()).nullable(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: z.string(),
  scheduleCron: z.string().nullable(),
  conditions: z.array(z.unknown()),
  actions: z.array(z.unknown()),
  effectiveRoleId: z.string(),
  effectiveRoleName: z.string().nullable(),
  position: z.number().int(),
  stopProcessing: z.boolean(),
  flaggedReason: z.string().nullable(),
  fireCount: z.number().int(),
  lastRunAt: nullableResponseTimestamp,
  createdBy: z.string(),
  version: z.number().int().min(1),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});

export const assignableRoleSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  rank: z.number().int(),
});

export const automationListSchema = z.object({
  data: z.array(automationSchema),
  meta: z.object({
    total: z.number().int().min(0),
    /** Roles the caller may pick as a rule's effective role (at or below their own rank). */
    assignableRoles: z.array(assignableRoleSchema),
    /** `feature.automations` for this scope. */
    featureEnabled: z.boolean(),
  }),
});

export const ruleProblemSchema = z.object({
  code: z.enum(["invalid", "unavailable"]),
  path: z.string(),
  message: z.string(),
});

export const ruleProblemsSchema = z.object({
  message: z.string(),
  problems: z.array(ruleProblemSchema),
});

export const automationRunSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  workItemId: z.string().nullable(),
  workItemKey: z.string().nullable(),
  eventId: z.string().nullable(),
  origin: z.string(),
  depth: z.number().int(),
  triggeredAt: responseTimestamp,
  finishedAt: nullableResponseTimestamp,
  state: z.string(),
  matched: z.boolean().nullable(),
  results: z.array(z.unknown()),
  error: z.string().nullable(),
});

export const automationRunListSchema = z.object({
  data: z.array(automationRunSchema),
  page: z.object({ hasMore: z.boolean(), nextBefore: z.string().nullable() }),
});

export const dryRunSchema = z.object({
  automationId: z.string(),
  windowDays: z.number().int(),
  since: z.string(),
  /** Events or items examined, at most the 1,000 cap. */
  evaluated: z.number().int(),
  wouldFire: z.number().int(),
  capped: z.boolean(),
  samples: z.array(
    z.object({
      eventId: z.string().nullable(),
      occurredAt: z.string().nullable(),
      workItemKey: z.string().nullable(),
      workItemTitle: z.string().nullable(),
    }),
  ),
  /** The validation panel: each action, whether the effective role may take it, and why not. */
  actions: z.array(
    z.object({
      index: z.number().int(),
      type: z.string(),
      allowed: z.boolean(),
      requiredCapability: z.string(),
      reason: z.string().nullable(),
    }),
  ),
  /** `AM-11`: every placeholder in the rule and its visibility. */
  placeholders: z.array(
    z.object({
      actionIndex: z.number().int(),
      path: z.string(),
      visibility: z.enum(["public", "staff", "unknown"]),
    }),
  ),
  note: z.string(),
});

export const automationVersionConflictSchema = z.object({
  message: z.string(),
  currentVersion: z.number().int(),
});
