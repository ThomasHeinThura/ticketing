import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import { HttpError, readErrorDetail } from "@/lib/http-error";

/** Time and cost: entries, timer, activities, rates, roll-ups and budgets (`TC-1`..`TC-19`). */

export type EntryRate = {
  rateMinor: number | null;
  currency: string | null;
  costMinor: number | null;
};

export type TimeEntry = {
  id: string;
  workspaceId: string;
  projectId: string;
  workItemId: string | null;
  workItemKey: string | null;
  workItemTitle: string | null;
  personId: string;
  personName: string | null;
  date: string;
  minutes: number;
  activityId: string;
  activityName: string;
  description: string | null;
  billable: boolean;
  source: "manual" | "timer" | "timer_capped";
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
  /** Only present for callers who hold `time_entry:manage_rates` (`TC-11`). */
  rate?: EntryRate;
};

export type TimeEntryList = {
  data: TimeEntry[];
  totalMinutes: number;
  callerPersonId: string;
  canReadAny: boolean;
  canUpdateAny: boolean;
  canDeleteAny: boolean;
  canLogBackdated: boolean;
  backdateLimitDays: number;
  timeZone: string;
  today: string;
};

export type TimeActivity = {
  id: string;
  workspaceId: string;
  name: string;
  position: number;
  archived: boolean;
};

export type RunningTimer = {
  workspaceId: string;
  projectId: string;
  workItemId: string;
  workItemKey: string | null;
  workItemTitle: string | null;
  activityId: string;
  activityName: string;
  description: string | null;
  billable: boolean;
  startedAt: string;
};

export type TimerState = {
  timer: RunningTimer | null;
  serverNow: string;
  capMinutes: number;
};

export type TimerStopResult = { entries: TimeEntry[]; capped: boolean };

export type Breakdown = { key: string; label: string; minutes: number };
export type CostByCurrency = {
  currency: string;
  costMinor: number;
  pricedMinutes: number;
};
export type TimeSummary = {
  scope: "work_item" | "project";
  totalMinutes: number;
  billableMinutes: number;
  entryCount: number;
  byActivity: Breakdown[];
  byPerson: Breakdown[];
  cost?: { byCurrency: CostByCurrency[]; unpricedMinutes: number };
};

export type HourlyRate = {
  id: string;
  workspaceId: string;
  personId: string;
  personName: string | null;
  projectId: string | null;
  rateMinor: number;
  currency: string;
  effectiveFrom: string;
  createdAt: string;
};

export type ProjectBudget = {
  id: string;
  projectId: string;
  name: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  plannedAmountMinor: number;
  /** True for callers without `time_entry:manage_rates`: no figure derived from priced time is sent. */
  figuresHidden: boolean;
  actualMinor?: number;
  remainingMinor?: number;
  thresholdReached?: 75 | 90 | null;
  otherCurrencies?: CostByCurrency[];
  unpricedMinutes?: number;
  committedMinor: number | null;
};
export type BudgetOverview = {
  /** The caller holds `budget:manage`. */
  canManage: boolean;
  data: ProjectBudget[];
  byActivity: Breakdown[];
  byPerson: Breakdown[];
};

/** The feature switch is off: the API answers 409 `feature_disabled`. */
export class TimeTrackingDisabledError extends HttpError {
  constructor() {
    super(409, "feature_disabled");
    this.name = "TimeTrackingDisabledError";
  }
}

/** A capped or refused refusal the screen words itself (`date_too_old`, `timer_already_running`...). */
export class TimeRuleError extends HttpError {
  code: string;
  constructor(status: number, code: string) {
    super(status, code);
    this.name = "TimeRuleError";
    this.code = code;
  }
}

const RULE_CODES = new Set([
  "date_too_old",
  "date_in_future",
  "activity_unavailable",
  "person_not_loggable",
  "timer_already_running",
]);

async function failure(response: Response, fallback: string): Promise<never> {
  const detail = await readErrorDetail(response, fallback);
  if (response.status === 409 && detail === "feature_disabled")
    throw new TimeTrackingDisabledError();
  if ([409, 422].includes(response.status) && RULE_CODES.has(detail))
    throw new TimeRuleError(response.status, detail);
  throw new HttpError(response.status, detail);
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  fallback = "The request failed",
): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    method: init.method ?? "GET",
    credentials: "include",
    ...(init.method && init.method !== "GET"
      ? { headers: { "Content-Type": "application/json" } }
      : {}),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) await failure(response, fallback);
  return (await response.json()) as T;
}

const enc = encodeURIComponent;

function query(values: Record<string, string | boolean | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== false) params.set(key, String(value));
  return params.toString();
}

export type TimeEntryFilter = {
  workspaceId: string;
  /** A person id, or `all` for everyone (needs `time_entry:read_any`). */
  person?: string;
  from?: string;
  to?: string;
  workItemId?: string;
  projectId?: string;
  needsReview?: boolean;
};

export const getTimeEntries = (filter: TimeEntryFilter) =>
  request<TimeEntryList>(
    `/time-entries?${query(filter)}`,
    {},
    "Failed to load time entries",
  );

export type CreateTimeEntryInput = {
  workspaceId: string;
  workItemId: string;
  date: string;
  minutes: number;
  activityId: string;
  description?: string;
  billable?: boolean;
  personId?: string;
};

export const createTimeEntry = (input: CreateTimeEntryInput) =>
  request<TimeEntry>(
    "/time-entries",
    { method: "POST", body: input },
    "Failed to log the time",
  );

export type UpdateTimeEntryInput = {
  date?: string;
  minutes?: number;
  activityId?: string;
  description?: string | null;
  billable?: boolean;
  workItemId?: string;
};

export const updateTimeEntry = (id: string, input: UpdateTimeEntryInput) =>
  request<TimeEntry>(
    `/time-entries/${enc(id)}`,
    { method: "PATCH", body: input },
    "Failed to save the entry",
  );

/** Deleting an entry is a pending action; the requester approves it in the browser. */
export async function requestTimeEntryDeletion(id: string) {
  return readPendingDeletion(
    await apiFetch(getApiUrl(`/time-entries/${enc(id)}`), {
      method: "DELETE",
      credentials: "include",
    }),
    "Failed to request the deletion",
  );
}

export const getTimer = (workspaceId: string) =>
  request<TimerState>(
    `/time-entries/timer?${query({ workspaceId })}`,
    {},
    "Failed to load the timer",
  );

export const startTimer = (input: {
  workspaceId: string;
  workItemId: string;
  activityId?: string;
  description?: string;
  billable?: boolean;
}) =>
  request<TimerState>(
    "/time-entries/timer/start",
    { method: "POST", body: input },
    "Failed to start the timer",
  );

export const stopTimer = (input: {
  workspaceId: string;
  description?: string;
  activityId?: string;
}) =>
  request<TimerStopResult>(
    "/time-entries/timer/stop",
    { method: "POST", body: input },
    "Failed to stop the timer",
  );

export const getTimeSummary = (input: {
  workspaceId: string;
  workItemId?: string;
  projectId?: string;
  from?: string;
  to?: string;
}) =>
  request<TimeSummary>(
    `/time-entries/summary?${query(input)}`,
    {},
    "Failed to load the totals",
  );

export type TimeSettings = {
  backdateLimitDays: number;
  /** The caller holds `workspace:manage_settings`. */
  canManage: boolean;
  project: { id: string; defaultBillable: boolean } | null;
};

export const getTimeSettings = (workspaceId: string, projectId?: string) =>
  request<TimeSettings>(
    `/time-settings?${query({ workspaceId, projectId })}`,
    {},
    "Failed to load the time settings",
  );

export const updateTimeSettings = (input: {
  workspaceId: string;
  backdateLimitDays?: number;
  project?: { id: string; defaultBillable: boolean };
}) =>
  request<TimeSettings>(
    "/time-settings",
    { method: "PATCH", body: input },
    "Failed to save the time settings",
  );

export async function getTimeActivities(
  workspaceId: string,
  includeArchived = false,
) {
  const result = await request<{ data: TimeActivity[] }>(
    `/time-activities?${query({ workspaceId, includeArchived })}`,
    {},
    "Failed to load the activities",
  );
  return result.data;
}

export const createTimeActivity = (input: {
  workspaceId: string;
  name: string;
}) =>
  request<TimeActivity>(
    "/time-activities",
    { method: "POST", body: input },
    "Failed to add the activity",
  );

export const updateTimeActivity = (
  id: string,
  workspaceId: string,
  input: { name?: string; position?: number; archived?: boolean },
) =>
  request<TimeActivity>(
    `/time-activities/${enc(id)}?${query({ workspaceId })}`,
    { method: "PATCH", body: input },
    "Failed to save the activity",
  );

export type RateOverview = {
  data: HourlyRate[];
  /** Staff who can be given a rate. */
  people: Array<{ personId: string; name: string }>;
};

export const getHourlyRates = (workspaceId: string, personId?: string) =>
  request<RateOverview>(
    `/rates?${query({ workspaceId, personId })}`,
    {},
    "Failed to load the rates",
  );

export const createHourlyRate = (input: {
  workspaceId: string;
  personId: string;
  projectId?: string | null;
  rateMinor: number;
  currency: string;
  effectiveFrom: string;
}) =>
  request<HourlyRate>(
    "/rates",
    { method: "POST", body: input },
    "Failed to add the rate",
  );

export const getProjectBudget = (projectId: string) =>
  request<BudgetOverview>(
    `/projects/${enc(projectId)}/budget`,
    {},
    "Failed to load the budget",
  );

export const createProjectBudget = (
  projectId: string,
  input: {
    name: string;
    plannedAmountMinor: number;
    currency: string;
    periodStart: string;
    periodEnd: string;
  },
) =>
  request<BudgetOverview>(
    `/projects/${enc(projectId)}/budgets`,
    { method: "POST", body: input },
    "Failed to create the budget",
  );
