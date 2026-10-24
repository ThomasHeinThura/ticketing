import { z } from "../openapi";
import {
  CYCLE_INCOMPLETE_POLICIES,
  ESTIMATE_SYSTEMS,
  MAX_BULK_WORK_ITEMS,
  MAX_CYCLE_NAME_LENGTH,
  MAX_ESTIMATE_POINTS,
  MAX_MODULE_NAME_LENGTH,
  MODULE_STATES,
} from "./logic";

const noNul = (value: string) => !value.includes("\u0000");
const NO_NUL = "Must not contain a NUL byte";

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a calendar date (YYYY-MM-DD)");
const id = z.string().min(1).max(128).refine(noNul, NO_NUL);
const name = (max: number) =>
  z.string().trim().min(1).max(max).refine(noNul, NO_NUL);

export const projectKeyParam = z.object({ key: z.string().min(1).max(128) });
export const idParam = z.object({ id });
export const dependenciesQuery = z.object({
  /** Comma-separated subset of `blocks,precedes`; default both. */
  types: z
    .string()
    .max(64)
    .optional()
    .transform((value) => (value ? value.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(["blocks", "precedes"]))),
});
export const wipLimitParam = z.object({
  key: z.string().min(1).max(128),
  stateId: id,
});
export const setWipLimitBody = z.object({
  /** Null clears the limit. */
  limit: z.number().int().min(1).max(1000).nullable(),
});
export const cycleItemParam = z.object({
  id,
  workItemKey: z.string().min(1).max(128).refine(noNul, NO_NUL),
});
export const workItemKeyParam = z.object({
  key: z.string().min(1).max(128).refine(noNul, NO_NUL),
});

export const createCycleBody = z.object({
  name: name(MAX_CYCLE_NAME_LENGTH),
  startDate: calendarDate,
  endDate: calendarDate,
});

export const updateCycleBody = z
  .object({
    name: name(MAX_CYCLE_NAME_LENGTH).optional(),
    startDate: calendarDate.optional(),
    endDate: calendarDate.optional(),
    version: z.number().int().min(1),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.startDate !== undefined ||
      value.endDate !== undefined,
    { message: "Provide at least one field to change" },
  );

export const completeCycleBody = z.object({
  /** The choice shown at completion; omitted means the project's default. */
  incompletePolicy: z.enum(CYCLE_INCOMPLETE_POLICIES).optional(),
  /** Preview what would move without changing anything. */
  dryRun: z.boolean().optional(),
});

export const workItemKeysBody = z.object({
  workItemKeys: z
    .array(z.string().min(1).max(128).refine(noNul, NO_NUL))
    .min(1)
    .max(MAX_BULK_WORK_ITEMS),
});

export const createModuleBody = z.object({
  name: name(MAX_MODULE_NAME_LENGTH),
  description: z.string().trim().max(2000).refine(noNul, NO_NUL).optional(),
  leadId: id.nullable().optional(),
  state: z.enum(MODULE_STATES).optional(),
  targetDate: calendarDate.nullable().optional(),
});

export const updateModuleBody = z
  .object({
    name: name(MAX_MODULE_NAME_LENGTH).optional(),
    description: z
      .string()
      .trim()
      .max(2000)
      .refine(noNul, NO_NUL)
      .nullable()
      .optional(),
    leadId: id.nullable().optional(),
    state: z.enum(MODULE_STATES).optional(),
    targetDate: calendarDate.nullable().optional(),
    version: z.number().int().min(1),
  })
  .refine(
    (value) =>
      Object.entries(value).some(
        ([key, entry]) => key !== "version" && entry !== undefined,
      ),
    { message: "Provide at least one field to change" },
  );

const pointInput = z.object({
  /** An existing point's key keeps its identity (renaming never rewrites history). */
  key: z.string().min(1).max(64).refine(noNul, NO_NUL).optional(),
  value: z.string().trim().min(1).max(32).refine(noNul, NO_NUL),
});

export const updateEstimatesBody = z
  .object({
    system: z.enum(ESTIMATE_SYSTEMS).optional(),
    points: z.array(pointInput).min(1).max(MAX_ESTIMATE_POINTS).optional(),
    /** Report what the change would map and clear, and change nothing. */
    dryRun: z.boolean().optional(),
    /** Required to apply a change that clears existing estimates. */
    confirmClear: z.boolean().optional(),
  })
  .refine((value) => value.system !== undefined || value.points !== undefined, {
    message: "Provide a system or a set of points",
  });

export const updateAgileSettingsBody = z.object({
  incompletePolicy: z.enum(CYCLE_INCOMPLETE_POLICIES),
  version: z.number().int().min(1).optional(),
});

export const setEstimateBody = z.object({
  estimatePointId: id.nullable(),
});
export const setModuleBody = z.object({ moduleId: id.nullable() });
export const setCycleBody = z.object({ cycleId: id.nullable() });
