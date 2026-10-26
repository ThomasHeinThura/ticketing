/** Source clocks may be wrong or hostile; an implausible time is reported and replaced, never stored. */
const EARLIEST_PLAUSIBLE = Date.UTC(1990, 0, 1);
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export type SourceTime = { at: Date; valid: boolean };

/**
 * Parse an optional ISO source time. Absent -> `fallback`, valid. Present but implausible (before
 * 1990, or later than `now` plus five minutes) -> `fallback`, `valid: false` so the caller reports
 * `timestamp_invalid` instead of silently stamping the import time.
 */
export function readSourceTime(
  value: string | undefined,
  fallback: Date,
  now: Date,
): SourceTime {
  if (value === undefined) return { at: fallback, valid: true };
  const parsed = new Date(value);
  const ms = parsed.getTime();
  if (
    Number.isNaN(ms) ||
    ms < EARLIEST_PLAUSIBLE ||
    ms > now.getTime() + FUTURE_SKEW_MS
  )
    return { at: fallback, valid: false };
  return { at: parsed, valid: true };
}
