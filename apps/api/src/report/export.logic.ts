// RP-10, pure part: when an export is answered inside the request and when it becomes a background job.

/** An export whose screen run returns more rows than this is handed to the `report-export` job. */
export const EXPORT_SYNC_ROW_LIMIT = 150;
/** The most rows a background export returns from a report that caps its rows. */
export const EXPORT_ROW_LIMIT = 5000;
/** Queued or running exports one person may have at the same time. */
export const EXPORT_MAX_ACTIVE_PER_PERSON = 3;
/** How long a finished export can be downloaded, in hours. */
export const EXPORT_TTL_HOURS = 24;
/** How long an expired or failed export row is kept (metadata only) before it is deleted, in days. */
export const EXPORT_ROW_RETENTION_DAYS = 14;
/** A running export not finished by now was abandoned by a stopped worker, in minutes. */
export const EXPORT_STALE_RUNNING_MINUTES = 45;

/**
 * Small exports are answered in the request; an export that hit a report's row cap, or that is
 * larger than the synchronous limit, is queued. `truncated` also covers a report cut at its cap.
 */
export function shouldQueueExport(input: {
  rows: number;
  truncated: boolean;
}): boolean {
  return input.truncated || input.rows > EXPORT_SYNC_ROW_LIMIT;
}

/** The cap a report applies: its own on screen, the export limit in a background export. */
export function capFor(exporting: boolean, screenCap: number): number {
  return exporting ? Math.max(screenCap, EXPORT_ROW_LIMIT) : screenCap;
}
