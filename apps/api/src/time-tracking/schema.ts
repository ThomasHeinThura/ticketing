import { z } from "../openapi";
import { isCalendarDate, MAX_ENTRY_MINUTES } from "./logic";

const id = z.string().min(1).max(128);
export const calendarDate = z
  .string()
  .refine(isCalendarDate, "Expected a calendar date (YYYY-MM-DD)")
  .openapi({ format: "date", example: "2026-10-24" });
const description = z.string().trim().max(2000);
const minutes = z.number().int().min(1).max(MAX_ENTRY_MINUTES);

export const workspaceIdQuery = z.object({ workspaceId: id });
export const entryIdParam = z.object({ id });
export const projectIdParam = z.object({ projectId: id });
export const activityIdParam = z.object({ id });

export const listEntriesQuery = z.object({
  workspaceId: id,
  /** Defaults to the caller. Another person needs `time_entry:read_any`. */
  person: id.optional(),
  from: calendarDate.optional(),
  to: calendarDate.optional(),
  workItemId: id.optional(),
  projectId: id.optional(),
  needsReview: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const createEntryBody = z.object({
  workspaceId: id,
  workItemId: id,
  date: calendarDate,
  minutes,
  activityId: id,
  description: description.optional(),
  /** Defaults from the project (TC-3). */
  billable: z.boolean().optional(),
  /** Log for someone else: needs `time_entry:update_any`. */
  personId: id.optional(),
});

export const updateEntryBody = z
  .object({
    date: calendarDate.optional(),
    minutes: minutes.optional(),
    activityId: id.optional(),
    description: description.nullable().optional(),
    billable: z.boolean().optional(),
    workItemId: id.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to change",
  });

export const timerStartBody = z.object({
  workspaceId: id,
  workItemId: id,
  activityId: id.optional(),
  description: description.optional(),
  billable: z.boolean().optional(),
});

export const timerStopBody = z.object({
  workspaceId: id,
  /** What was actually done; replaces the description set at start. */
  description: description.optional(),
  activityId: id.optional(),
});

export const summaryQuery = z
  .object({
    workspaceId: id,
    workItemId: id.optional(),
    projectId: id.optional(),
    cycleId: id.optional(),
    moduleId: id.optional(),
    from: calendarDate.optional(),
    to: calendarDate.optional(),
  })
  .refine(
    (value) =>
      [value.workItemId, value.projectId, value.cycleId, value.moduleId].filter(
        Boolean,
      ).length === 1,
    {
      message:
        "Provide exactly one of workItemId, projectId, cycleId or moduleId",
    },
  );

export const timeSettingsQuery = z.object({
  workspaceId: id,
  projectId: id.optional(),
});

export const updateTimeSettingsBody = z
  .object({
    workspaceId: id,
    /** TC-4: days back a member may log without `time_entry:log_backdated`. */
    backdateLimitDays: z.number().int().min(0).max(3650).optional(),
    /** TC-3: the billable default of one project. */
    project: z.object({ id, defaultBillable: z.boolean() }).optional(),
  })
  .refine(
    (value) =>
      value.backdateLimitDays !== undefined || value.project !== undefined,
    { message: "Provide at least one setting to change" },
  );

export const createActivityBody = z.object({
  workspaceId: id,
  name: z.string().trim().min(1).max(80),
  position: z.number().int().min(0).max(1000).optional(),
});

export const updateActivityBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    position: z.number().int().min(0).max(1000).optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to change",
  });

export const listActivitiesQuery = z.object({
  workspaceId: id,
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

const currency = z
  .string()
  .regex(/^[A-Z]{3}$/, "Expected an ISO 4217 code such as EUR");
const amountMinor = z.number().int().min(0).max(1_000_000_000_000);

export const listRatesQuery = z.object({
  workspaceId: id,
  personId: id.optional(),
});

export const createRateBody = z.object({
  workspaceId: id,
  personId: id,
  /** Null or omitted = the person's default rate (TC-10). */
  projectId: id.nullable().optional(),
  rateMinor: amountMinor,
  currency,
  effectiveFrom: calendarDate,
});

export const createBudgetBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    plannedAmountMinor: amountMinor,
    currency,
    periodStart: calendarDate,
    periodEnd: calendarDate,
  })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: "periodEnd must not be before periodStart",
  });

// ---------------------------------------------------------------------------------------------
// Cost types, cost entries, available hours (TC-12..TC-14, TC-20)
// ---------------------------------------------------------------------------------------------

const costUnit = z.string().trim().min(1).max(40);
const costNote = z.string().trim().max(2000);

export const costTypeIdParam = z.object({ id });

export const listCostTypesQuery = z.object({
  workspaceId: id,
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const createCostTypeBody = z.object({
  workspaceId: id,
  name: z.string().trim().min(1).max(80),
  /** The unit a cost is counted in: "seat", "km", "licence". */
  unit: costUnit.default("unit"),
  /** Minor units per unit; null = every entry states its own rate. */
  defaultRateMinor: amountMinor.nullable().default(null),
  currency,
  billable: z.boolean().default(true),
});

export const updateCostTypeBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    unit: costUnit.optional(),
    defaultRateMinor: amountMinor.nullable().optional(),
    currency: currency.optional(),
    billable: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to change",
  });

const costUnits = z.number().int().min(1).max(1_000_000);

export const projectCostsQuery = z.object({
  workItemId: id.optional(),
  from: calendarDate.optional(),
  to: calendarDate.optional(),
});

export const createCostEntryBody = z.object({
  costTypeId: id,
  /** TC-14: omitted = attached directly to the project. */
  workItemId: id.optional(),
  date: calendarDate,
  units: costUnits.default(1),
  /** Minor units per unit; defaults to the cost type's default rate and is captured on the row (TC-13). */
  rateMinor: amountMinor.optional(),
  /** Defaults to the cost type's currency. */
  currency: currency.optional(),
  /** The person the cost is for; defaults to the caller. */
  personId: id.optional(),
  billable: z.boolean().optional(),
  note: costNote.optional(),
});

export const updateCostEntryBody = z
  .object({
    costTypeId: id.optional(),
    workItemId: id.nullable().optional(),
    date: calendarDate.optional(),
    units: costUnits.optional(),
    rateMinor: amountMinor.optional(),
    currency: currency.optional(),
    billable: z.boolean().optional(),
    note: costNote.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to change",
  });

export const costEntryIdParam = z.object({ id });

export const listAvailableHoursQuery = z.object({
  workspaceId: id,
  /** Defaults to the caller. Another person needs `time_entry:read_any`. */
  personId: id.optional(),
});

export const createAvailableHoursBody = z.object({
  workspaceId: id,
  personId: id,
  /** Integer minutes per week (40 h = 2400). */
  minutesPerWeek: z.number().int().min(0).max(10080),
  effectiveFrom: calendarDate,
});
