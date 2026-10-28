// Pure report helpers: window parsing, bucketing, the null-with-sample rule (RP-1), trends (RP-6),
// weekly series and CSV cells (RP-10). Nothing here touches the database, so every function is
// unit-tested against fixtures with known answers.

export const DAY_MS = 86_400_000;
export const WINDOW_PRESETS = [7, 30, 60, 90] as const;
export const DEFAULT_WINDOW_DAYS = 30;
/** A custom window is at most one year: a wider one is a data dump, not a report. */
export const MAX_CUSTOM_WINDOW_DAYS = 366;
/** RP-1: the smallest sample a rate, share or average is shown for. */
export const DEFAULT_MIN_SAMPLE = 10;

export type ReportWindow = {
  /** `7`/`30`/`60`/`90` or `custom`. */
  preset: "7" | "30" | "60" | "90" | "custom";
  /** Inclusive start (UTC midnight). */
  from: Date;
  /** Exclusive end (UTC midnight after the last day, or `now` for a preset window). */
  to: Date;
  days: number;
};

export type WindowInput = { window?: string; from?: string; to?: string };

function utcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export type WindowResult =
  | { ok: true; window: ReportWindow }
  | {
      ok: false;
      reason: "invalid_window" | "window_too_long" | "window_order";
    };

/**
 * RP-7: 7, 30, 60 or 90 days back from `now`, or a custom `from`/`to` pair of calendar days
 * (both inclusive). A preset window ends at `now`, so the current partial day is in it.
 */
export function resolveWindow(input: WindowInput, now: Date): WindowResult {
  const preset = input.window ?? (input.from || input.to ? "custom" : "30");
  if (preset === "custom") {
    if (!isCalendarDate(input.from) || !isCalendarDate(input.to))
      return { ok: false, reason: "invalid_window" };
    const from = new Date(`${input.from}T00:00:00.000Z`);
    const to = new Date(`${input.to}T00:00:00.000Z`);
    if (to < from) return { ok: false, reason: "window_order" };
    const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
    if (days > MAX_CUSTOM_WINDOW_DAYS)
      return { ok: false, reason: "window_too_long" };
    return {
      ok: true,
      window: {
        preset: "custom",
        from,
        to: new Date(to.getTime() + DAY_MS),
        days,
      },
    };
  }
  if (preset !== "7" && preset !== "30" && preset !== "60" && preset !== "90")
    return { ok: false, reason: "invalid_window" };
  const days = Number(preset);
  const end = new Date(now);
  return {
    ok: true,
    window: {
      preset,
      from: new Date(utcMidnight(end).getTime() - (days - 1) * DAY_MS),
      to: end,
      days,
    },
  };
}

/** The window of the same length immediately before `window` (RP-6's comparable period). */
export function previousWindow(window: ReportWindow): ReportWindow {
  const length = window.to.getTime() - window.from.getTime();
  return {
    preset: window.preset,
    from: new Date(window.from.getTime() - length),
    to: new Date(window.from.getTime()),
    days: window.days,
  };
}

// ---------------------------------------------------------------------------------------------
// Buckets (RP-2): age and duration are shown as ranges, never as a mean
// ---------------------------------------------------------------------------------------------

export type BucketDef = { key: string; label: string; maxDays: number | null };

/** Open-item age and time-in-state: the ninety-day ticket must have its own bar. */
export const AGE_BUCKETS: readonly BucketDef[] = [
  { key: "lt1", label: "< 1 day", maxDays: 1 },
  { key: "d1_3", label: "1-3 days", maxDays: 4 },
  { key: "d4_7", label: "4-7 days", maxDays: 8 },
  { key: "d8_14", label: "8-14 days", maxDays: 15 },
  { key: "d15_30", label: "15-30 days", maxDays: 31 },
  { key: "d31_60", label: "31-60 days", maxDays: 61 },
  { key: "d61_90", label: "61-90 days", maxDays: 91 },
  { key: "gt90", label: "> 90 days", maxDays: null },
];

/** Created-to-resolved duration. */
export const DURATION_BUCKETS: readonly BucketDef[] = [
  { key: "lt1", label: "< 1 day", maxDays: 1 },
  { key: "d1_2", label: "1-2 days", maxDays: 3 },
  { key: "d3_7", label: "3-7 days", maxDays: 8 },
  { key: "d8_14", label: "8-14 days", maxDays: 15 },
  { key: "d15_30", label: "15-30 days", maxDays: 31 },
  { key: "gt30", label: "> 30 days", maxDays: null },
];

/** The bucket a duration in milliseconds falls into. Negative durations count as the first. */
export function bucketOf(
  durationMs: number,
  buckets: readonly BucketDef[],
): BucketDef {
  const days = Math.max(0, durationMs) / DAY_MS;
  for (const bucket of buckets)
    if (bucket.maxDays === null || days < bucket.maxDays) return bucket;
  return buckets[buckets.length - 1] as BucketDef;
}

export function bucketCounts(
  durationsMs: readonly number[],
  buckets: readonly BucketDef[],
): Array<{ key: string; label: string; count: number }> {
  const counts = new Map(buckets.map((bucket) => [bucket.key, 0]));
  for (const duration of durationsMs) {
    const key = bucketOf(duration, buckets).key;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: counts.get(bucket.key) ?? 0,
  }));
}

// ---------------------------------------------------------------------------------------------
// The honesty rule (RP-1): insufficient data is null with its sample, never 0% or 100%
// ---------------------------------------------------------------------------------------------

export type Sampled = { value: number | null; n: number; needed: number };

/** A cell for "not enough data (n of needed)": a rate whose denominator is below the minimum. */
export function ratePercent(
  numerator: number,
  denominator: number,
  needed = DEFAULT_MIN_SAMPLE,
): Sampled {
  if (denominator < needed || denominator <= 0)
    return { value: null, n: denominator, needed };
  return {
    value: Math.round((numerator / denominator) * 1000) / 10,
    n: denominator,
    needed,
  };
}

/** A count is always shown (it is a fact, not an estimate); this only wraps it as a sampled value. */
export function countValue(n: number): Sampled {
  return { value: n, n, needed: 0 };
}

export type Trend =
  | {
      status: "ok";
      direction: "up" | "down" | "flat";
      delta: number;
      previous: number;
    }
  | { status: "insufficient"; reason: "needs_two_periods" };

/**
 * RP-6: a trend arrow needs two comparable periods, each with a value. Anything less says so
 * rather than drawing an arrow. `flat` is a change under `flatBelow` (in the metric's own unit).
 */
export function trendOf(
  current: Sampled,
  previous: Sampled,
  flatBelow = 0.5,
): Trend {
  if (current.value === null || previous.value === null)
    return { status: "insufficient", reason: "needs_two_periods" };
  const delta = Math.round((current.value - previous.value) * 10) / 10;
  return {
    status: "ok",
    direction: Math.abs(delta) < flatBelow ? "flat" : delta > 0 ? "up" : "down",
    delta,
    previous: previous.value,
  };
}

// ---------------------------------------------------------------------------------------------
// Weekly series (Monday starts the week, UTC)
// ---------------------------------------------------------------------------------------------

export function weekStartOf(date: Date): Date {
  const day = utcMidnight(date);
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * DAY_MS);
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Every Monday from the week of `from` to the week of the last instant before `to`. */
export function weeksBetween(from: Date, to: Date): string[] {
  const weeks: string[] = [];
  const last = weekStartOf(new Date(to.getTime() - 1)).getTime();
  for (
    let cursor = weekStartOf(from).getTime();
    cursor <= last;
    cursor += 7 * DAY_MS
  )
    weeks.push(isoDay(new Date(cursor)));
  return weeks;
}

// ---------------------------------------------------------------------------------------------
// Median and percentile-free summaries are deliberately absent: RP-2 asks for buckets.
// ---------------------------------------------------------------------------------------------

/** Whole minutes to exact decimal hours; display surfaces choose their own precision. */
export function minutesToHours(minutes: number): number {
  return minutes / 60;
}

// ---------------------------------------------------------------------------------------------
// CSV (RP-10): RFC 4180 quoting, and no cell a spreadsheet can run as a formula
// ---------------------------------------------------------------------------------------------

/**
 * A cell that starts with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with an
 * apostrophe so a spreadsheet shows it instead of evaluating it. Numbers are written as numbers.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvRow(
  cells: ReadonlyArray<string | number | null | undefined>,
): string {
  return cells.map(csvCell).join(",");
}

/**
 * A timestamp as `db.execute` returns it: a string, with or without a zone. A `timestamp` (no
 * zone) column is UTC wall-clock time in this schema, so a value with no zone is read as UTC;
 * `new Date("2026-01-01 10:00:00")` would read it in the process time zone.
 */
export function utc(value: string | Date): Date {
  if (value instanceof Date) return value;
  let text = value.trim().replace(" ", "T");
  if (/[+-]\d\d$/.test(text)) text = `${text}:00`;
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(text)) text = `${text}Z`;
  return new Date(text);
}
