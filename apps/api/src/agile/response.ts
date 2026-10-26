import { responseTimestamp, z } from "../openapi";
import {
  CYCLE_INCOMPLETE_POLICIES,
  ESTIMATE_SYSTEMS,
  MODULE_STATES,
} from "./logic";

const unit = z.enum(["points", "time", "count"]);
const bucket = z.object({ count: z.number().int(), points: z.number() });

export const cycleSummarySchema = z.object({
  unit,
  total: bucket,
  completed: bucket,
  inProgress: bucket,
  notStarted: bucket,
  cancelled: bucket,
  /** ES-5: how much of the scope has no estimate, never counted as zero. */
  unestimated: z.object({ count: z.number().int(), share: z.number() }),
  snapshot: z
    .object({
      capturedAt: z.string().datetime(),
      basis: z.enum(["completion_action", "date_catchup"]),
      endDateSummary: z.enum(["known_at_action", "unknown"]),
    })
    .optional(),
});

export const velocitySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    unit,
    value: z.number(),
    cycles: z.number().int(),
  }),
  z.object({
    status: z.literal("insufficient_data"),
    cycles: z.number().int(),
    reason: z.enum(["fewer_than_three", "mixed_units", "late_snapshot"]),
  }),
]);

export const cycleSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  /** CY-3: derived from the dates and the completion action, never stored or set by hand. */
  status: z.enum(["upcoming", "active", "completed"]),
  completedAt: responseTimestamp.nullable(),
  version: z.number().int(),
  summary: cycleSummarySchema,
});

export const cycleListSchema = z.object({
  data: z.array(cycleSchema),
  meta: z.object({
    unit,
    velocity: velocitySchema,
    incompletePolicy: z.enum(CYCLE_INCOMPLETE_POLICIES),
    canManage: z.boolean(),
    today: z.string(),
  }),
});

const cycleRef = z.object({
  id: z.string(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
});

export const cycleOverlapSchema = z.object({
  message: z.literal("cycle_overlap"),
  conflictingCycle: cycleRef,
});

export const scopeChangeSchema = z.object({
  workItemKey: z.string(),
  title: z.string(),
  kind: z.enum(["added", "removed"]),
  at: responseTimestamp,
  /** CY-8 / edge case: added after the cycle ended, for backfill. */
  retrospective: z.boolean(),
});

export const completionPreviewSchema = z.object({
  defaultPolicy: z.enum(CYCLE_INCOMPLETE_POLICIES),
  incompleteCount: z.number().int(),
  nextCycle: cycleRef.nullable(),
});

export const estimateDiscontinuitySchema = z.object({
  date: z.string(),
  kind: z.enum(["system", "scale"]),
  fromSystem: z.enum(ESTIMATE_SYSTEMS).nullable(),
  toSystem: z.enum(ESTIMATE_SYSTEMS).nullable(),
});

export const cycleDetailSchema = cycleSchema.extend({
  scopeChanges: z.array(scopeChangeSchema),
  completionPreview: completionPreviewSchema,
  velocity: velocitySchema,
  discontinuities: z.array(estimateDiscontinuitySchema),
  canManage: z.boolean(),
  canEditItems: z.boolean(),
});

export const burndownSchema = z.object({
  unit,
  noScope: z.boolean(),
  startDate: z.string(),
  endDate: z.string(),
  openingScope: z.number(),
  points: z.array(
    z.object({
      date: z.string(),
      scope: z.number(),
      completed: z.number(),
      remaining: z.number(),
      ideal: z.number(),
    }),
  ),
  unestimated: z.object({ count: z.number().int(), share: z.number() }),
  discontinuities: z.array(estimateDiscontinuitySchema),
});

export const completeCycleResponseSchema = z.object({
  dryRun: z.boolean(),
  cycle: cycleSchema,
  policy: z.enum(CYCLE_INCOMPLETE_POLICIES),
  destinationCycle: cycleRef.nullable(),
  /** Incomplete items moved (to the next cycle or the backlog); left in place for `leave`. */
  movedCount: z.number().int(),
  leftCount: z.number().int(),
});

export const cycleItemsResultSchema = z.object({
  added: z.array(z.string()),
  alreadyInCycle: z.array(z.string()),
  /** Items that were in another cycle and have been moved here (CY-4: at most one). */
  movedFromOtherCycle: z.array(z.string()),
  /** Refused with a reason, never silently dropped. */
  refused: z.array(z.object({ key: z.string(), reason: z.string() })),
});

export const moduleProgressSchema = z.object({
  total: z.number().int(),
  completed: z.number().int(),
  cancelled: z.number().int(),
  remaining: z.number().int(),
  percent: z.number(),
});

export const moduleForecastSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("no_target") }),
  z.object({ status: z.literal("complete") }),
  z.object({
    status: z.literal("insufficient_data"),
    completedInWindow: z.number().int(),
  }),
  z.object({
    status: z.enum(["on_track", "at_risk", "late"]),
    earliest: z.string(),
    latest: z.string(),
    targetDate: z.string(),
  }),
]);

export const moduleSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  lead: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
  state: z.enum(MODULE_STATES),
  targetDate: z.string().nullable(),
  version: z.number().int(),
  progress: moduleProgressSchema,
  forecast: moduleForecastSchema,
});

export const moduleListSchema = z.object({
  data: z.array(moduleSchema),
  meta: z.object({
    canManage: z.boolean(),
    /** Staff who could lead a module; empty unless the caller can manage. */
    leadCandidates: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
});

export const moduleDetailSchema = moduleSchema.extend({
  canManage: z.boolean(),
  canEditItems: z.boolean(),
  leadCandidates: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const estimatePointSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  weight: z.number().nullable(),
  position: z.number().int(),
});

export const estimateSchema = z.object({
  /** Null until a system is chosen (ES-1: at most one). */
  system: z.enum(ESTIMATE_SYSTEMS).nullable(),
  estimateId: z.string().nullable(),
  points: z.array(estimatePointSchema),
  defaults: z.object({
    points: z.array(z.string()),
    categories: z.array(z.string()),
    time: z.array(z.string()),
  }),
  incompletePolicy: z.enum(CYCLE_INCOMPLETE_POLICIES),
  canManage: z.boolean(),
});

export const estimatePreviewSchema = z.object({
  fromSystem: z.enum(ESTIMATE_SYSTEMS).nullable(),
  toSystem: z.enum(ESTIMATE_SYSTEMS),
  mapping: z.array(
    z.object({
      fromPointId: z.string(),
      fromValue: z.string(),
      toKey: z.string().nullable(),
      toValue: z.string().nullable(),
      itemCount: z.number().int(),
    }),
  ),
  mappedItems: z.number().int(),
  clearedItems: z.number().int(),
  /** Mid-cycle warning: active cycles whose burndown will note a discontinuity. */
  activeCycles: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const updateEstimatesResponseSchema = z.object({
  applied: z.boolean(),
  preview: estimatePreviewSchema,
  estimate: estimateSchema,
});

export const estimateConfirmationSchema = z.object({
  message: z.literal("estimate_change_requires_confirmation"),
  preview: estimatePreviewSchema,
});

export const agileSettingsSchema = z.object({
  incompletePolicy: z.enum(CYCLE_INCOMPLETE_POLICIES),
  version: z.number().int(),
});

export const workItemEstimateSchema = z.object({
  estimatePointId: z.string().nullable(),
  point: estimatePointSchema.nullable(),
  /** ES-4: the parent's own estimate with the roll-up beside it. */
  rollup: z.object({
    own: z.number().nullable(),
    rollup: z.number().nullable(),
    effective: z.number().nullable(),
    discrepancy: z.boolean(),
  }),
});

export const workItemCycleSchema = z.object({
  cycleId: z.string().nullable(),
  cycleName: z.string().nullable(),
});
export const workItemModuleSchema = z.object({
  moduleId: z.string().nullable(),
  moduleName: z.string().nullable(),
});

export const dependenciesSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["blocks", "precedes"]),
      sourceKey: z.string(),
      targetKey: z.string(),
    }),
  ),
});

export const wipLimitsSchema = z.object({
  data: z.array(z.object({ stateId: z.string(), limit: z.number().int() })),
  canManage: z.boolean(),
});
export const wipLimitSchema = z.object({
  stateId: z.string(),
  limit: z.number().int().nullable(),
});

export const versionConflictSchema = z.object({
  message: z.string(),
  currentVersion: z.number().int(),
});
