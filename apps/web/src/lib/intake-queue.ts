import type { IntakeAgeFilter, IntakeAssigneeFilter } from "@/lib/routes";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const AGE_THRESHOLD_MS: Record<IntakeAgeFilter, number> = {
  "1d": DAY,
  "3d": 3 * DAY,
  "7d": 7 * DAY,
  "30d": 30 * DAY,
};

/** `IQ-5`: a submission's age as the shortest unit: `12m`, `5h`, `3d`. */
export function formatSubmissionAge(
  createdAt: string | number | Date,
  now: number = Date.now(),
): string {
  const elapsed = Math.max(0, now - new Date(createdAt).getTime());
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  return `${Math.floor(elapsed / DAY)}d`;
}

export type IntakeQueueRowFacts = {
  submission: { createdAt: string; claimedBy: string | null };
  requestType: { id: string };
};

type IntakeUrlFilters = {
  requestType?: string;
  assignee?: IntakeAssigneeFilter;
  age?: IntakeAgeFilter;
};

/** The query parameters `GET /api/submissions` filters by (`IQ-21`), cursor-safe on the server. */
export type IntakeServerFilters = {
  requestTypeKey?: string;
  /** `unclaimed`, `claimed` or a person id. */
  assignee?: string;
  olderThanDays?: number;
};

/**
 * `IQ-21`: split the URL filters into what the server applies (`requestTypeKey`, `assignee`
 * `unclaimed`/`claimed`, `olderThanDays`) and what it has no parameter for: a request type id
 * whose key is unknown. `pending` is set while the request type list that resolves the key is not loaded.
 */
export function splitIntakeFilters(
  filters: IntakeUrlFilters,
  requestTypes: ReadonlyArray<{ id: string; key?: string }> | undefined,
): {
  server: IntakeServerFilters;
  residual: IntakeUrlFilters;
  pending: boolean;
} {
  const server: IntakeServerFilters = {};
  const residual: IntakeUrlFilters = {};
  let pending = false;
  if (filters.requestType) {
    const key = requestTypes?.find(
      (type) => type.id === filters.requestType,
    )?.key;
    if (key) server.requestTypeKey = key;
    else if (requestTypes === undefined) pending = true;
    else residual.requestType = filters.requestType;
  }
  if (filters.assignee) server.assignee = filters.assignee;
  if (filters.age) {
    server.olderThanDays = Math.round(AGE_THRESHOLD_MS[filters.age] / DAY);
  }
  return { server, residual, pending };
}

/**
 * `IQ-19`/`IQ-21`: the client-side fallback for the filters the server has no parameter for
 * (see `splitIntakeFilters`), applied to the page already loaded.
 */
export function matchesIntakeFilters(
  row: IntakeQueueRowFacts,
  filters: IntakeUrlFilters,
  now: number = Date.now(),
): boolean {
  if (filters.requestType && row.requestType.id !== filters.requestType)
    return false;
  if (filters.assignee === "claimed" && !row.submission.claimedBy) return false;
  if (filters.assignee === "unclaimed" && row.submission.claimedBy)
    return false;
  if (
    filters.age &&
    now - new Date(row.submission.createdAt).getTime() <
      AGE_THRESHOLD_MS[filters.age]
  )
    return false;
  return true;
}
