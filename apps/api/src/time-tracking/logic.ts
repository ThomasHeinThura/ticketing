/**
 * Pure time-and-cost rules (feature-contracts-p5.md "Time and cost"). No I/O, no floating point:
 * minutes are integers, money is integer minor units, cost is integer arithmetic.
 */

/** Timers are capped at 12 hours (edge-case table). */
export const TIMER_CAP_MINUTES = 12 * 60;
/** A single entry is at most one day: a longer span is split by the server at local midnight. */
export const MAX_ENTRY_MINUTES = 24 * 60;
/** Default `workspace.time_entry_backdate_limit_days` (TC-4). */
export const DEFAULT_BACKDATE_LIMIT_DAYS = 30;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export function isValidTimeZone(
  zone: string | null | undefined,
): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Owner decision D4: the timezone used to cut entries at midnight is the profile timezone, then
 * the workspace timezone, then UTC. An invalid stored value is skipped, never thrown on.
 */
export function resolveTimeZone(
  ...chain: Array<string | null | undefined>
): string {
  for (const zone of chain) if (isValidTimeZone(zone)) return zone;
  return "UTC";
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let existing = formatters.get(zone);
  if (!existing) {
    existing = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(zone, existing);
  }
  return existing;
}

/** The calendar date (`YYYY-MM-DD`) of an instant in `zone`. */
export function zonedDate(instantMs: number, zone: string): string {
  const parts = formatter(zone).formatToParts(new Date(instantMs));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The first whole minute strictly after `instantMs` at which the local date in `zone` has
 * changed. Found by bisection on the (monotone) date, so it is correct across DST changes and for
 * zones whose midnight does not exist on the transition day.
 */
export function nextLocalMidnight(instantMs: number, zone: string): number {
  const today = zonedDate(instantMs, zone);
  let lo = Math.floor(instantMs / MINUTE_MS); // minute with date === today
  let hi = lo + 49 * 60; // always a later local date
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (zonedDate(mid * MINUTE_MS, zone) === today) lo = mid;
    else hi = mid;
  }
  return hi * MINUTE_MS;
}

export type EntrySegment = {
  /** Local calendar date the segment belongs to. */
  date: string;
  startMs: number;
  endMs: number;
  minutes: number;
};

/**
 * Split `[startMs, endMs)` at every local midnight of `zone` (server-side midnight split, owner
 * decision D4). Both bounds are floored to whole minutes first, so every segment is a whole
 * number of minutes and the segments always sum to the (floored) span.
 */
export function splitAtMidnight(
  startMs: number,
  endMs: number,
  zone: string,
): EntrySegment[] {
  const start = Math.floor(startMs / MINUTE_MS) * MINUTE_MS;
  const end = Math.floor(endMs / MINUTE_MS) * MINUTE_MS;
  const segments: EntrySegment[] = [];
  let cursor = start;
  while (cursor < end) {
    const boundary = nextLocalMidnight(cursor, zone);
    const segmentEnd = Math.min(boundary, end);
    segments.push({
      date: zonedDate(cursor, zone),
      startMs: cursor,
      endMs: segmentEnd,
      minutes: (segmentEnd - cursor) / MINUTE_MS,
    });
    cursor = segmentEnd;
  }
  return segments;
}

export type TimerStop = {
  /** Instant the recorded span ends (the cap, when it applies). */
  endMs: number;
  /** Whole minutes recorded, at least 1 and at most the cap. */
  minutes: number;
  capped: boolean;
};

/**
 * Close a timer: elapsed time rounded to the nearest whole minute (at least one), capped at
 * `TIMER_CAP_MINUTES`. A capped result asks the person what actually happened (needs_review).
 */
export function stopTimer(
  startedAtMs: number,
  nowMs: number,
  capMinutes: number = TIMER_CAP_MINUTES,
): TimerStop {
  const start = Math.floor(startedAtMs / MINUTE_MS) * MINUTE_MS;
  const rawMinutes = Math.round((nowMs - start) / MINUTE_MS);
  const wanted = Math.max(1, rawMinutes);
  const capped = wanted > capMinutes;
  const minutes = capped ? capMinutes : wanted;
  return { endMs: start + minutes * MINUTE_MS, minutes, capped };
}

/** True when the timer has run past the cap and the sweeper (or the next start) must close it. */
export function timerExpired(
  startedAtMs: number,
  nowMs: number,
  capMinutes: number = TIMER_CAP_MINUTES,
): boolean {
  return nowMs - startedAtMs >= capMinutes * MINUTE_MS;
}

export type RateRow = {
  projectId: string | null;
  effectiveFrom: string;
  rateMinor: number;
  currency: string;
};

/**
 * TC-8..TC-10: the rate effective on `date` for `projectId`. A project-specific rate in force on
 * that date wins; otherwise the person's default (project-less) rate in force on that date;
 * otherwise null (unpriced). "In force" is the latest `effective_from <= date`. A rate that starts
 * after the date is ignored: today's rate never prices past work (TC-9).
 */
export function selectEffectiveRate(
  rates: readonly RateRow[],
  projectId: string,
  date: string,
): RateRow | null {
  const latest = (rows: readonly RateRow[]) =>
    rows
      .filter((row) => row.effectiveFrom <= date)
      .reduce<RateRow | null>(
        (best, row) =>
          best === null || row.effectiveFrom > best.effectiveFrom ? row : best,
        null,
      );
  return (
    latest(rates.filter((row) => row.projectId === projectId)) ??
    latest(rates.filter((row) => row.projectId === null))
  );
}

/**
 * Cost of `minutes` at an hourly rate in minor units, rounded half up, in integer arithmetic
 * (never a float hour). Null when the entry is unpriced.
 */
export function costMinor(
  minutes: number,
  rateMinor: number | null,
): number | null {
  if (rateMinor === null) return null;
  return Math.floor((minutes * rateMinor + 30) / 60);
}

export type DateWindowFailure = "future" | "too_old";

/**
 * TC-4: a date in the future is refused; a date more than `limitDays` before `today` needs
 * `time_entry:log_backdated` (the capability whose description is the workspace backdating
 * limit). Dates are `YYYY-MM-DD` in the person's timezone.
 */
export function checkEntryDate(input: {
  date: string;
  today: string;
  limitDays: number;
  canLogBackdated: boolean;
}): DateWindowFailure | null {
  if (input.date > input.today) return "future";
  if (input.canLogBackdated) return null;
  const earliest = shiftDate(input.today, -input.limitDays);
  return input.date < earliest ? "too_old" : null;
}

/** Add whole days to a `YYYY-MM-DD` date, in UTC calendar arithmetic. */
export function shiftDate(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return shifted.toISOString().slice(0, 10);
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

/** Monday of the ISO week containing `date`. */
export function weekStart(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  return shiftDate(date, -((weekday + 6) % 7));
}

/**
 * Whether an entry may be edited or deleted by someone who is not its owner needs the `_any`
 * capability; the owner needs the `_own` one. Returned as the single capability the caller must
 * hold, so the route and its tests share one rule.
 */
export function requiredEntryCapability(
  action: "update" | "delete",
  isOwner: boolean,
):
  | "time_entry:update_own"
  | "time_entry:update_any"
  | "time_entry:delete_own"
  | "time_entry:delete_any" {
  if (action === "update")
    return isOwner ? "time_entry:update_own" : "time_entry:update_any";
  return isOwner ? "time_entry:delete_own" : "time_entry:delete_any";
}

/** Sum integer minutes; throws on a non-integer so a float can never reach a total. */
export function sumMinutes(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isInteger(value)) throw new Error("minutes must be integers");
    total += value;
  }
  return total;
}

/** Budget threshold edges (TC-18): the highest of 75/90 reached, or null below 75%. */
export function budgetThreshold(
  plannedMinor: number,
  actualMinor: number,
): 75 | 90 | null {
  if (plannedMinor <= 0) return null;
  if (actualMinor * 100 >= plannedMinor * 90) return 90;
  if (actualMinor * 100 >= plannedMinor * 75) return 75;
  return null;
}
