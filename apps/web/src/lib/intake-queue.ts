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

/** `IQ-5`: a submission's age in its shortest unit; the screen translates the unit suffix. */
export function submissionAge(
  createdAt: string | number | Date,
  now: number = Date.now(),
): { unit: "m" | "h" | "d"; count: number } {
  const elapsed = Math.max(0, now - new Date(createdAt).getTime());
  if (elapsed < HOUR) return { unit: "m", count: Math.floor(elapsed / MINUTE) };
  if (elapsed < DAY) return { unit: "h", count: Math.floor(elapsed / HOUR) };
  return { unit: "d", count: Math.floor(elapsed / DAY) };
}

/** `IQ-5`: a submission's age as the shortest unit: `12m`, `5h`, `3d` (untranslated form). */
export function formatSubmissionAge(
  createdAt: string | number | Date,
  now: number = Date.now(),
): string {
  const age = submissionAge(createdAt, now);
  return `${age.count}${age.unit}`;
}

/** The machine codes the triage API returns on a refused action (`P2R1-12`). */
export const TRIAGE_ERROR_CODES = [
  "submission_not_open",
  "submission_already_converted",
  "submission_changed",
  "destination_required",
  "destination_unavailable",
  "work_item_type_unavailable",
  "form_version_unavailable",
] as const;
export type TriageErrorCode = (typeof TRIAGE_ERROR_CODES)[number];

export type TriageError = {
  code: TriageErrorCode | null;
  status: "conflict" | "other";
  /** The work item the first triager created, when an accept lost the race. */
  workItem: { id: string; key: string } | null;
};

/**
 * Reads a refused triage action. The intake fetchers throw the response body as the message,
 * so a coded body `{ error, message, workItem? }` is recovered here; anything else is a
 * generic failure.
 */
export function parseTriageError(error: unknown): TriageError {
  const fallback: TriageError = { code: null, status: "other", workItem: null };
  if (!(error instanceof Error)) return fallback;
  if (error.message === "destination_required")
    return { ...fallback, code: "destination_required" };
  let body: unknown;
  try {
    body = JSON.parse(error.message);
  } catch {
    return fallback;
  }
  if (!body || typeof body !== "object") return fallback;
  const record = body as {
    error?: unknown;
    workItem?: { id?: unknown; key?: unknown } | null;
  };
  const code = TRIAGE_ERROR_CODES.find((known) => known === record.error);
  if (!code) return fallback;
  const item = record.workItem;
  return {
    code,
    status:
      code === "submission_not_open" ||
      code === "submission_already_converted" ||
      code === "submission_changed" ||
      code === "form_version_unavailable"
        ? "conflict"
        : "other",
    workItem:
      item && typeof item.id === "string" && typeof item.key === "string"
        ? { id: item.id, key: item.key }
        : null,
  };
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
