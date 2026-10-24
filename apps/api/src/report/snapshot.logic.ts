// RP-9, pure part: which part of a window can be read from stored daily snapshots and which part has
// to be computed live. Nothing here touches the database, so every function is unit-tested.

import { DAY_MS } from "./logic";

/** The metrics the `metrics-snapshot` job stores, one row set per closed UTC day. */
export const SNAPSHOT_METRICS = [
  "sla_resolution",
  "sla_first_response",
  "throughput",
] as const;
export type SnapshotMetric = (typeof SNAPSHOT_METRICS)[number];

/** Closed days recomputed on every run, so a late SLA flip or a deletion reaches the stored day. */
export const SNAPSHOT_LOOKBACK_DAYS = 3;
/**
 * How long a day is kept. The contract names no retention for `metric_snapshot`; the widest report
 * window is 366 days and its comparison period is another 366, so 800 days keeps every closed day a
 * report can ask for. A day that is pruned (or never computed) is simply read live.
 */
export const SNAPSHOT_RETENTION_DAYS = 800;
/** Missing days written per workspace per run, newest first, so a first run cannot hold the lease for long. */
export const SNAPSHOT_BACKFILL_DAYS_PER_RUN = 120;

export function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dayFromKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export type LiveRange = { from: Date; to: Date };

export type WindowSplit = {
  /** First closed whole UTC day (inclusive) and the end of the last one (exclusive), or null. */
  closed: { from: Date; to: Date } | null;
  /** The part before the first whole day and the part from today on: always computed live. */
  live: LiveRange[];
};

/**
 * Splits `[from, to)` into whole UTC days that are over at `now` (candidates for snapshots) and the
 * rest. A preset window ends at `now` and its comparison period starts mid-day, so both edges are
 * usually partial: those parts are live, which is why a snapshot-backed report equals a live one.
 */
export function splitForSnapshots(
  from: Date,
  to: Date,
  now: Date,
): WindowSplit {
  if (to <= from) return { closed: null, live: [] };
  const today = utcDayStart(now);
  const firstWhole = utcDayStart(from);
  const closedFrom =
    firstWhole.getTime() === from.getTime()
      ? firstWhole
      : addDays(firstWhole, 1);
  const closedTo = new Date(
    Math.min(utcDayStart(to).getTime(), today.getTime()),
  );
  if (closedFrom >= closedTo) return { closed: null, live: [{ from, to }] };
  const live: LiveRange[] = [];
  if (from < closedFrom) live.push({ from, to: closedFrom });
  if (closedTo < to) live.push({ from: closedTo, to });
  return { closed: { from: closedFrom, to: closedTo }, live };
}

/** Every UTC day key in `[from, to)`. */
export function dayKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = [];
  for (let at = from.getTime(); at < to.getTime(); at += DAY_MS)
    keys.push(dayKey(new Date(at)));
  return keys;
}

/** Contiguous runs of day keys, as live ranges: the closed days with no snapshot are read live. */
export function runsOf(days: readonly string[]): LiveRange[] {
  const sorted = [...days].sort();
  const runs: LiveRange[] = [];
  for (const key of sorted) {
    const start = dayFromKey(key);
    const last = runs[runs.length - 1];
    if (last && last.to.getTime() === start.getTime())
      last.to = addDays(start, 1);
    else runs.push({ from: start, to: addDays(start, 1) });
  }
  return runs;
}

/** How a report read its numbers (RP-9: "the boundary is stated"). */
export type SnapshotUse = {
  /** Closed days read from stored snapshots. */
  snapshotDays: number;
  /** Whole closed days that had no snapshot and were computed live. */
  uncoveredDays: number;
  /** Whether any part of a window (the current day, a partial edge, or a missing day) was live. */
  liveParts: boolean;
  /** The newest `computed_at` among the snapshot days read. */
  computedAt: Date | null;
  /** The end of the last day read from snapshots: everything after it is live. */
  throughDay: Date | null;
};

export function emptyUse(): SnapshotUse {
  return {
    snapshotDays: 0,
    uncoveredDays: 0,
    liveParts: false,
    computedAt: null,
    throughDay: null,
  };
}

export type Boundary = "live" | "snapshot" | "mixed";

export function boundaryOf(use: SnapshotUse): Boundary {
  if (use.snapshotDays === 0) return "live";
  return use.liveParts || use.uncoveredDays > 0 ? "mixed" : "snapshot";
}

/** Merges the use of the current and the comparison window (a report reads both). */
export function mergeUse(into: SnapshotUse, part: SnapshotUse): SnapshotUse {
  into.snapshotDays += part.snapshotDays;
  into.uncoveredDays += part.uncoveredDays;
  into.liveParts = into.liveParts || part.liveParts;
  if (
    part.computedAt &&
    (!into.computedAt || part.computedAt > into.computedAt)
  )
    into.computedAt = part.computedAt;
  if (
    part.throughDay &&
    (!into.throughDay || part.throughDay > into.throughDay)
  )
    into.throughDay = part.throughDay;
  return into;
}

/** The days the job writes in one run: the lookback, then missing days newest first, within retention. */
export function daysToCompute(input: {
  now: Date;
  /** Days that already have a marker. */
  covered: ReadonlySet<string>;
  /** The oldest day with anything to count (the workspace's first item), or null for none. */
  earliest: Date | null;
}): string[] {
  const today = utcDayStart(input.now);
  const oldestKept = addDays(today, -SNAPSHOT_RETENTION_DAYS);
  const lookback: string[] = [];
  for (let i = 1; i <= SNAPSHOT_LOOKBACK_DAYS; i += 1)
    lookback.push(dayKey(addDays(today, -i)));
  if (!input.earliest) return lookback;
  const floor = new Date(
    Math.max(utcDayStart(input.earliest).getTime(), oldestKept.getTime()),
  );
  const missing: string[] = [];
  for (
    let at = addDays(today, -SNAPSHOT_LOOKBACK_DAYS - 1).getTime();
    at >= floor.getTime() && missing.length < SNAPSHOT_BACKFILL_DAYS_PER_RUN;
    at -= DAY_MS
  ) {
    const key = dayKey(new Date(at));
    if (!input.covered.has(key)) missing.push(key);
  }
  return [...lookback.filter((key) => floor <= dayFromKey(key)), ...missing];
}
