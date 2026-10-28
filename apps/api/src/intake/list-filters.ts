import { HTTPException } from "hono/http-exception";

/**
 * IQ-21: the staff queue's server-side filters. They compose with the `state` filter and
 * are part of the cursor scope, so a cursor minted under one filter set is rejected under
 * another and a shared queue URL always shows the same rows.
 */
export type SubmissionListFilters = {
  requestTypeKey?: string;
  /** `claimed`, `unclaimed` or a person id; filters `claimed_by`. */
  assignee?: string;
  /** Created strictly before `now - N days`. */
  olderThanDays?: number;
};

export const UNCLAIMED = "unclaimed";
export const CLAIMED = "claimed";
const MAX_OLDER_THAN_DAYS = 3650;

type RawFilters = {
  requestTypeKey?: string;
  assignee?: string;
  olderThanDays?: string;
};

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseSubmissionListFilters(
  raw: RawFilters,
): SubmissionListFilters {
  const filters: SubmissionListFilters = {};
  const requestTypeKey = present(raw.requestTypeKey);
  if (requestTypeKey) {
    if (requestTypeKey.length > 200 || requestTypeKey.includes("\u0000"))
      throw new HTTPException(400, { message: "Invalid requestTypeKey" });
    filters.requestTypeKey = requestTypeKey;
  }
  const assignee = present(raw.assignee);
  if (assignee) {
    if (assignee.length > 200 || assignee.includes("\u0000"))
      throw new HTTPException(400, { message: "Invalid assignee" });
    filters.assignee = assignee;
  }
  const older = present(raw.olderThanDays);
  if (older !== undefined) {
    if (!/^\d{1,4}$/.test(older) || Number(older) > MAX_OLDER_THAN_DAYS)
      throw new HTTPException(400, {
        message: `olderThanDays must be an integer from 0 to ${MAX_OLDER_THAN_DAYS}`,
      });
    filters.olderThanDays = Number(older);
  }
  return filters;
}

export function olderThanCutoff(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/** Stable text for the cursor scope. `olderThanDays` is part of it (the cutoff moves with `now`). */
export function filtersScope(filters: SubmissionListFilters): string {
  return JSON.stringify([
    filters.requestTypeKey ?? null,
    filters.assignee ?? null,
    filters.olderThanDays ?? null,
  ]);
}
