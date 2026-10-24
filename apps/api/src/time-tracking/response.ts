import { responseTimestamp, z } from "../openapi";

const money = {
  rateMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  costMinor: z.number().int().nullable(),
};

export const timeEntrySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  workItemId: z.string().nullable(),
  workItemKey: z.string().nullable(),
  workItemTitle: z.string().nullable(),
  personId: z.string(),
  personName: z.string().nullable(),
  date: z.string(),
  minutes: z.number().int(),
  activityId: z.string(),
  activityName: z.string(),
  description: z.string().nullable(),
  billable: z.boolean(),
  source: z.enum(["manual", "timer", "timer_capped"]),
  /** A capped timer: the person is asked what actually happened (edit clears it). */
  needsReview: z.boolean(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
  /** Present only for callers holding `time_entry:manage_rates` (TC-11). */
  rate: z.object(money).optional(),
});

export const timeEntryListSchema = z.object({
  data: z.array(timeEntrySchema),
  totalMinutes: z.number().int(),
  /** The caller's own entry list is complete; anyone else's is limited to reachable projects. */
  /** The caller's own person id: their entries are the ones `_own` capabilities cover. */
  callerPersonId: z.string(),
  canReadAny: z.boolean(),
  /** The caller may edit / delete other people's entries (`_any`); their own always need `_own`. */
  canUpdateAny: z.boolean(),
  canDeleteAny: z.boolean(),
  canLogBackdated: z.boolean(),
  backdateLimitDays: z.number().int(),
  timeZone: z.string(),
  today: z.string(),
});

export const timeSettingsSchema = z.object({
  backdateLimitDays: z.number().int(),
  /** The caller may change these (workspace:manage_settings). */
  canManage: z.boolean(),
  project: z
    .object({ id: z.string(), defaultBillable: z.boolean() })
    .nullable(),
});

export const activitySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  position: z.number().int(),
  archived: z.boolean(),
});
export const activityListSchema = z.object({ data: z.array(activitySchema) });

export const timerSchema = z.object({
  workspaceId: z.string(),
  projectId: z.string(),
  workItemId: z.string(),
  workItemKey: z.string().nullable(),
  workItemTitle: z.string().nullable(),
  activityId: z.string(),
  activityName: z.string(),
  description: z.string().nullable(),
  billable: z.boolean(),
  startedAt: responseTimestamp,
});

export const timerStateSchema = z.object({
  timer: timerSchema.nullable(),
  serverNow: responseTimestamp,
  capMinutes: z.number().int(),
});

export const timerStopSchema = z.object({
  entries: z.array(timeEntrySchema),
  capped: z.boolean(),
});

const breakdownMinutes = z.object({
  key: z.string(),
  label: z.string(),
  minutes: z.number().int(),
});

export const costByCurrencySchema = z.object({
  currency: z.string(),
  costMinor: z.number().int(),
  pricedMinutes: z.number().int(),
});

export const summarySchema = z.object({
  scope: z.enum(["work_item", "project", "cycle", "module"]),
  from: z.string().nullable(),
  to: z.string().nullable(),
  totalMinutes: z.number().int(),
  billableMinutes: z.number().int(),
  entryCount: z.number().int(),
  byActivity: z.array(breakdownMinutes),
  /** Minutes per person: never paired with cost unless the caller sees rates (TC-11). */
  byPerson: z.array(breakdownMinutes),
  /** Present only with `time_entry:manage_rates`: priced cost per currency, never summed across currencies. */
  cost: z
    .object({
      byCurrency: z.array(costByCurrencySchema),
      unpricedMinutes: z.number().int(),
    })
    .optional(),
});

export const rateSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  personId: z.string(),
  personName: z.string().nullable(),
  projectId: z.string().nullable(),
  rateMinor: z.number().int(),
  currency: z.string(),
  effectiveFrom: z.string(),
  createdAt: responseTimestamp,
});
export const ratePersonSchema = z.object({
  personId: z.string(),
  name: z.string(),
});
export const rateListSchema = z.object({
  data: z.array(rateSchema),
  /** Staff who can be given a rate: the picker for a new one. */
  people: z.array(ratePersonSchema),
});

export const budgetSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  currency: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  plannedAmountMinor: z.number().int(),
  /**
   * Priced time is rate-derived (TC-11): `actualMinor`, `remainingMinor`, `thresholdReached`,
   * `otherCurrencies` and `unpricedMinutes` are present only for callers with
   * `time_entry:manage_rates`; everyone else gets `figuresHidden: true` and none of them.
   */
  figuresHidden: z.boolean(),
  /** Time cost in the budget's currency inside the period; entries in other currencies are not converted. */
  actualMinor: z.number().int().optional(),
  remainingMinor: z.number().int().optional(),
  /** TC-18: the highest threshold reached (75 or 90), or null below 75%. */
  thresholdReached: z
    .union([z.literal(75), z.literal(90)])
    .nullable()
    .optional(),
  /** Minutes valued in other currencies, reported separately and never converted (TC-19). */
  otherCurrencies: z.array(costByCurrencySchema).optional(),
  unpricedMinutes: z.number().int().optional(),
  /** TC-17: remaining-work estimates do not exist yet, so committed is null rather than guessed. */
  committedMinor: z.number().int().nullable(),
  createdAt: responseTimestamp,
});
export const budgetResponseSchema = z.object({
  /** The caller holds `budget:manage`: the create form is offered. */
  canManage: z.boolean(),
  data: z.array(budgetSchema),
  byActivity: z.array(breakdownMinutes),
  byPerson: z.array(breakdownMinutes),
});
