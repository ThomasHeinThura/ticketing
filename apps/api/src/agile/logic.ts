/**
 * Pure rules for cycles, modules and estimates (feature-contracts-p5.md, "Cycles, modules and
 * estimates"). No database and no clock: every function takes what it needs, so the arithmetic is
 * unit tested exactly as the contract states it.
 *
 * Dates are calendar dates (`YYYY-MM-DD`) and "today" is the UTC calendar date. A workspace
 * timezone is not stored on the workspace, so UTC is the single documented reference; the
 * boundary days (start day, end day, the day after) are covered in `logic.test.ts`.
 */

export const CYCLE_INCOMPLETE_POLICIES = [
  "next_cycle",
  "backlog",
  "leave",
] as const;
export type CycleIncompletePolicy = (typeof CYCLE_INCOMPLETE_POLICIES)[number];
export const DEFAULT_CYCLE_INCOMPLETE_POLICY: CycleIncompletePolicy = "backlog";

export const MODULE_STATES = [
  "backlog",
  "planned",
  "in_progress",
  "paused",
  "completed",
  "cancelled",
] as const;
export type ModuleState = (typeof MODULE_STATES)[number];

export const ESTIMATE_SYSTEMS = ["points", "categories", "time"] as const;
export type EstimateSystem = (typeof ESTIMATE_SYSTEMS)[number];

export const MAX_CYCLE_NAME_LENGTH = 120;
export const MAX_MODULE_NAME_LENGTH = 120;
export const MAX_ESTIMATE_POINTS = 30;
export const MAX_CYCLE_SPAN_DAYS = 366;
export const MAX_BULK_WORK_ITEMS = 200;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isCalendarDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "Today" as the UTC calendar date. */
export function todayUtc(now: Date): string {
  return toDateString(now);
}

function dayNumber(value: string): number {
  return Math.round(Date.parse(`${value}T00:00:00.000Z`) / DAY_MS);
}

export function addDays(value: string, days: number): string {
  return toDateString(new Date((dayNumber(value) + days) * DAY_MS));
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

// ---------------------------------------------------------------------------------------------
// Cycles: status (CY-3), overlap (CY-2), completion (CY-6), summary (CY-7), velocity (CY-9)
// ---------------------------------------------------------------------------------------------

export type CycleDates = {
  startDate: string;
  endDate: string;
  completedAt: Date | null;
};
export type CycleStatus = "upcoming" | "active" | "completed";

/**
 * CY-3. `completed` once the completion action ran or the end date has passed (the end date is
 * inclusive, so the end day itself is still `active`); `upcoming` before the start date.
 */
export function cycleStatus(cycle: CycleDates, today: string): CycleStatus {
  if (cycle.completedAt) return "completed";
  if (today > cycle.endDate) return "completed";
  if (today < cycle.startDate) return "upcoming";
  return "active";
}

/**
 * The last day a cycle occupies the calendar. A cycle completed before its planned end gives the
 * remaining days back, so the next sprint can start the day after it was actually closed.
 */
export function effectiveEndDate(cycle: CycleDates): string {
  if (!cycle.completedAt) return cycle.endDate;
  const closed = toDateString(cycle.completedAt);
  if (closed < cycle.startDate) return cycle.startDate;
  return closed < cycle.endDate ? closed : cycle.endDate;
}

export type CycleRange = CycleDates & { id: string; name: string };

/** CY-2: inclusive ranges overlap when each starts on or before the other's last day. */
export function cyclesOverlap(a: CycleRange, b: CycleRange): boolean {
  return (
    a.startDate <= effectiveEndDate(b) && b.startDate <= effectiveEndDate(a)
  );
}

/** The first existing cycle (by start date) the candidate overlaps, ignoring itself. */
export function findOverlap(
  candidate: CycleRange,
  others: readonly CycleRange[],
): CycleRange | null {
  const sorted = [...others].sort((x, y) =>
    x.startDate === y.startDate
      ? x.id.localeCompare(y.id)
      : x.startDate.localeCompare(y.startDate),
  );
  return (
    sorted.find(
      (other) => other.id !== candidate.id && cyclesOverlap(candidate, other),
    ) ?? null
  );
}

export type CycleDateProblem = "invalid_date" | "end_before_start" | "too_long";

export function validateCycleDates(
  startDate: string,
  endDate: string,
): CycleDateProblem | null {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate))
    return "invalid_date";
  if (endDate < startDate) return "end_before_start";
  if (daysBetween(startDate, endDate) + 1 > MAX_CYCLE_SPAN_DAYS)
    return "too_long";
  return null;
}

/** The next cycle incomplete items can move to: the earliest not-completed cycle after this one. */
export function nextCycleAfter(
  cycle: CycleRange,
  others: readonly CycleRange[],
  today: string,
): CycleRange | null {
  const candidates = others
    .filter(
      (other) =>
        other.id !== cycle.id &&
        other.startDate > cycle.startDate &&
        cycleStatus(other, today) !== "completed",
    )
    .sort((x, y) => x.startDate.localeCompare(y.startDate));
  return candidates[0] ?? null;
}

export type StateGroup =
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "cancelled";

/** Anything not completed and not cancelled is still open work when a cycle closes. */
export function isIncomplete(group: StateGroup): boolean {
  return group !== "completed" && group !== "cancelled";
}

export type CompletionPlan =
  | {
      ok: true;
      policy: CycleIncompletePolicy;
      destinationCycleId: string | null;
      moveItemIds: string[];
      leaveItemIds: string[];
    }
  | { ok: false; reason: "no_next_cycle" };

/**
 * CY-6. `leave` keeps incomplete items in the finished cycle; `backlog` clears their cycle;
 * `next_cycle` moves them into the next upcoming cycle and is refused when none exists (nothing
 * is silently dropped). Completing a cycle with everything incomplete is allowed.
 */
export function planCompletion(input: {
  policy: CycleIncompletePolicy;
  items: ReadonlyArray<{ id: string; group: StateGroup }>;
  nextCycleId: string | null;
}): CompletionPlan {
  const incomplete = input.items
    .filter((item) => isIncomplete(item.group))
    .map((item) => item.id);
  if (input.policy === "leave")
    return {
      ok: true,
      policy: input.policy,
      destinationCycleId: null,
      moveItemIds: [],
      leaveItemIds: incomplete,
    };
  if (input.policy === "next_cycle") {
    if (!input.nextCycleId && incomplete.length > 0)
      return { ok: false, reason: "no_next_cycle" };
    return {
      ok: true,
      policy: input.policy,
      destinationCycleId: input.nextCycleId,
      moveItemIds: incomplete,
      leaveItemIds: [],
    };
  }
  return {
    ok: true,
    policy: input.policy,
    destinationCycleId: null,
    moveItemIds: incomplete,
    leaveItemIds: [],
  };
}

// ---------------------------------------------------------------------------------------------
// Burndown (CY-7, CY-8) and summary
// ---------------------------------------------------------------------------------------------

export type ScopeUnit = "points" | "time" | "count";

/** The unit a project's scope is expressed in: summable estimates, otherwise a plain count. */
export function scopeUnitFor(system: EstimateSystem | null): ScopeUnit {
  if (system === "points") return "points";
  if (system === "time") return "time";
  return "count";
}

export type ScopeEvent = {
  workItemId: string;
  /** `rolled_over`: left the cycle at completion; stays in that cycle's history. */
  kind: "added" | "removed" | "rolled_over";
  at: Date;
  afterStart: boolean;
  retrospective: boolean;
};

export type BurndownItem = {
  id: string;
  /** Summable size, or null when unestimated (never treated as zero in the report, ES-5). */
  weight: number | null;
  /** When the item reached a completed or cancelled state, if it currently has. */
  resolvedAt: Date | null;
};

export type BurndownPoint = {
  date: string;
  scope: number;
  completed: number;
  remaining: number;
  /** The straight line from the opening scope to zero at the end date. */
  ideal: number;
};

export type Burndown = {
  unit: ScopeUnit;
  noScope: boolean;
  startDate: string;
  endDate: string;
  openingScope: number;
  points: BurndownPoint[];
};

function unitWeight(unit: ScopeUnit, item: BurndownItem): number {
  if (unit === "count") return 1;
  return item.weight ?? 0;
}

function endOfDay(date: string): number {
  return Date.parse(`${date}T23:59:59.999Z`);
}

/**
 * CY-7: the scope in the cycle at the end of each day (replayed from the append-only scope log)
 * and how much of it was resolved by then. Opening scope is what was in the cycle at the end of
 * the start day minus nothing: items added after the start day are scope change (CY-8), not
 * opening scope. The series stops at the earlier of the end date, the completion day and today.
 */
export function buildBurndown(input: {
  startDate: string;
  endDate: string;
  completedAt: Date | null;
  today: string;
  unit: ScopeUnit;
  events: readonly ScopeEvent[];
  items: readonly BurndownItem[];
}): Burndown {
  const { startDate, endDate, unit } = input;
  const lastDay = [
    endDate,
    input.today,
    input.completedAt ? toDateString(input.completedAt) : endDate,
  ].reduce((a, b) => (a < b ? a : b));
  const items = new Map(input.items.map((item) => [item.id, item]));
  const events = [...input.events].sort(
    (a, b) => a.at.getTime() - b.at.getTime(),
  );
  const points: BurndownPoint[] = [];
  const span = Math.max(1, daysBetween(startDate, endDate));
  let openingScope = 0;
  if (lastDay >= startDate) {
    for (let day = startDate; day <= lastDay; day = addDays(day, 1)) {
      const cutoff = endOfDay(day);
      const member = new Set<string>();
      for (const event of events) {
        if (event.at.getTime() > cutoff) break;
        if (event.kind === "added") member.add(event.workItemId);
        else if (event.kind === "removed") member.delete(event.workItemId);
      }
      let scope = 0;
      let completed = 0;
      for (const id of member) {
        const item = items.get(id);
        if (!item) continue;
        const weight = unitWeight(unit, item);
        scope += weight;
        if (item.resolvedAt && item.resolvedAt.getTime() <= cutoff)
          completed += weight;
      }
      if (day === startDate) openingScope = scope;
      const elapsed = daysBetween(startDate, day);
      points.push({
        date: day,
        scope: round2(scope),
        completed: round2(completed),
        remaining: round2(scope - completed),
        ideal: round2(Math.max(0, openingScope * (1 - elapsed / span))),
      });
    }
  }
  return {
    unit,
    noScope: events.every((event) => event.kind !== "added"),
    startDate,
    endDate,
    openingScope: round2(openingScope),
    points,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type SummaryItem = {
  id: string;
  group: StateGroup;
  weight: number | null;
  /** Has an estimate point. A category point has no weight but is still estimated. */
  estimated: boolean;
};
export type Bucket = { count: number; points: number };
export type CycleSummary = {
  unit: ScopeUnit;
  total: Bucket;
  completed: Bucket;
  inProgress: Bucket;
  notStarted: Bucket;
  cancelled: Bucket;
  /** ES-5: reported rather than counted as zero. */
  unestimated: { count: number; share: number };
};

function emptyBucket(): Bucket {
  return { count: 0, points: 0 };
}

/** CY-7: scope, completed, in progress, not started and how much is unestimated. */
export function summariseCycle(
  items: readonly SummaryItem[],
  unit: ScopeUnit,
): CycleSummary {
  const summary: CycleSummary = {
    unit,
    total: emptyBucket(),
    completed: emptyBucket(),
    inProgress: emptyBucket(),
    notStarted: emptyBucket(),
    cancelled: emptyBucket(),
    unestimated: { count: 0, share: 0 },
  };
  for (const item of items) {
    const weight = unit === "count" ? 1 : (item.weight ?? 0);
    const bucket =
      item.group === "completed"
        ? summary.completed
        : item.group === "cancelled"
          ? summary.cancelled
          : item.group === "started"
            ? summary.inProgress
            : summary.notStarted;
    for (const target of [summary.total, bucket]) {
      target.count += 1;
      target.points += weight;
    }
    if (!item.estimated) summary.unestimated.count += 1;
  }
  for (const bucket of [
    summary.total,
    summary.completed,
    summary.inProgress,
    summary.notStarted,
    summary.cancelled,
  ])
    bucket.points = round2(bucket.points);
  summary.unestimated.share =
    items.length === 0 ? 0 : round2(summary.unestimated.count / items.length);
  return summary;
}

export type ScopeChange = {
  workItemId: string;
  kind: "added" | "removed";
  at: Date;
  retrospective: boolean;
};

/** CY-8: only changes after the cycle started are scope change; the log keeps their order. */
export function scopeChanges(events: readonly ScopeEvent[]): ScopeChange[] {
  return events
    .filter((event) => event.afterStart && event.kind !== "rolled_over")
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((event) => ({
      workItemId: event.workItemId,
      kind:
        event.kind === "removed" ? ("removed" as const) : ("added" as const),
      at: event.at,
      retrospective: event.retrospective,
    }));
}

/** A work item added on or after the cycle started is scope change; after the end it is retrospective. */
export function classifyAdd(
  cycle: { startDate: string; endDate: string },
  today: string,
): { afterStart: boolean; retrospective: boolean } {
  return {
    afterStart: today > cycle.startDate,
    retrospective: today > cycle.endDate,
  };
}

export type VelocityInput = {
  cycleId: string;
  completedAt: Date;
  unit: ScopeUnit;
  completedPoints: number;
};
export type Velocity =
  | { status: "ok"; unit: ScopeUnit; value: number; cycles: number }
  | {
      status: "insufficient_data";
      cycles: number;
      reason: "fewer_than_three" | "mixed_units";
    };

export const VELOCITY_WINDOW = 3;

/**
 * CY-9: the mean completed points over the last three completed cycles, and "insufficient data"
 * until three exist. Never extrapolated from one or two; and not averaged across different units
 * (an estimate system change mid-window), because that mean would mean nothing.
 */
export function computeVelocity(history: readonly VelocityInput[]): Velocity {
  const recent = [...history]
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
    .slice(0, VELOCITY_WINDOW);
  if (recent.length < VELOCITY_WINDOW)
    return {
      status: "insufficient_data",
      cycles: recent.length,
      reason: "fewer_than_three",
    };
  const unit = recent[0]?.unit ?? "count";
  if (recent.some((entry) => entry.unit !== unit))
    return {
      status: "insufficient_data",
      cycles: recent.length,
      reason: "mixed_units",
    };
  const sum = recent.reduce((total, entry) => total + entry.completedPoints, 0);
  return {
    status: "ok",
    unit,
    value: round2(sum / VELOCITY_WINDOW),
    cycles: recent.length,
  };
}

// ---------------------------------------------------------------------------------------------
// Modules (MO-4)
// ---------------------------------------------------------------------------------------------

export type ModuleForecast =
  | { status: "no_target" }
  | { status: "complete" }
  | { status: "insufficient_data"; completedInWindow: number }
  | {
      status: "on_track" | "at_risk" | "late";
      /** A range, never a false-precision date. */
      earliest: string;
      latest: string;
      targetDate: string;
    };

export const FORECAST_WINDOW_DAYS = 28;
export const FORECAST_MIN_COMPLETIONS = 3;
/** The forecast range brackets the observed rate by +/- 25 percent. */
const RATE_SPREAD = 0.25;

/**
 * MO-4: whether the current rate will meet the target date, expressed as a range. The rate is the
 * items resolved over the last 28 days; fewer than three completions is "insufficient data" and
 * is never extrapolated.
 */
export function forecastModule(input: {
  today: string;
  targetDate: string | null;
  remaining: number;
  resolvedDates: readonly string[];
  state: ModuleState;
}): ModuleForecast {
  if (!input.targetDate) return { status: "no_target" };
  if (input.remaining === 0 || input.state === "completed")
    return { status: "complete" };
  const windowStart = addDays(input.today, -(FORECAST_WINDOW_DAYS - 1));
  const completedInWindow = input.resolvedDates.filter(
    (date) => date >= windowStart && date <= input.today,
  ).length;
  if (completedInWindow < FORECAST_MIN_COMPLETIONS)
    return { status: "insufficient_data", completedInWindow };
  const ratePerDay = completedInWindow / FORECAST_WINDOW_DAYS;
  const fastDays = Math.ceil(
    input.remaining / (ratePerDay * (1 + RATE_SPREAD)),
  );
  const slowDays = Math.ceil(
    input.remaining / (ratePerDay * (1 - RATE_SPREAD)),
  );
  const earliest = addDays(input.today, fastDays);
  const latest = addDays(input.today, slowDays);
  const status =
    latest <= input.targetDate
      ? "on_track"
      : earliest > input.targetDate
        ? "late"
        : "at_risk";
  return { status, earliest, latest, targetDate: input.targetDate };
}

// ---------------------------------------------------------------------------------------------
// Estimates (ES-1..ES-5)
// ---------------------------------------------------------------------------------------------

export type PointSpec = { key?: string; value: string; weight: number | null };

export const DEFAULT_SCALES: Record<EstimateSystem, PointSpec[]> = {
  points: [1, 2, 3, 5, 8, 13, 21].map((n) => ({
    value: String(n),
    weight: n,
  })),
  categories: ["XS", "S", "M", "L", "XL"].map((value) => ({
    value,
    weight: null,
  })),
  time: [
    ["1h", 60],
    ["2h", 120],
    ["4h", 240],
    ["1d", 480],
    ["2d", 960],
    ["1w", 2400],
  ].map(([value, weight]) => ({
    value: String(value),
    weight: Number(weight),
  })),
};

const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(m|h|d|w)$/i;
const MINUTES_PER = { m: 1, h: 60, d: 480, w: 2400 } as const;

/** `time` durations are minutes; a working day is eight hours, a week five days. */
export function durationToMinutes(value: string): number | null {
  const match = DURATION_RE.exec(value.trim());
  if (!match) return null;
  const unit = (match[2] ?? "").toLowerCase() as keyof typeof MINUTES_PER;
  return Math.round(Number(match[1]) * MINUTES_PER[unit]);
}

export type ScaleProblem =
  | "empty"
  | "too_many"
  | "blank_label"
  | "duplicate_label"
  | "invalid_points_value"
  | "invalid_duration";

/**
 * ES-1: a scale is valid for its system. Points are positive numbers, categories are names,
 * time points are durations (`1h`, `2d`, `1w`). Labels are unique within a scale. The returned
 * specs carry the summable weight (points; minutes for time; null for categories).
 */
export function normaliseScale(
  system: EstimateSystem,
  specs: readonly { key?: string; value: string }[],
): { ok: true; points: PointSpec[] } | { ok: false; problem: ScaleProblem } {
  if (specs.length === 0) return { ok: false, problem: "empty" };
  if (specs.length > MAX_ESTIMATE_POINTS)
    return { ok: false, problem: "too_many" };
  const seen = new Set<string>();
  const points: PointSpec[] = [];
  for (const spec of specs) {
    const value = spec.value.trim();
    if (value === "") return { ok: false, problem: "blank_label" };
    const label = value.toLowerCase();
    if (seen.has(label)) return { ok: false, problem: "duplicate_label" };
    seen.add(label);
    let weight: number | null = null;
    if (system === "points") {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0 || n > 1000)
        return { ok: false, problem: "invalid_points_value" };
      weight = n;
    } else if (system === "time") {
      weight = durationToMinutes(value);
      if (weight === null || weight <= 0)
        return { ok: false, problem: "invalid_duration" };
    }
    points.push({ key: spec.key, value, weight });
  }
  return { ok: true, points };
}

export type CurrentPoint = { id: string; key: string; value: string };
export type EstimateChangePlan = {
  /** For each current point: the new point it maps to (by key), or null when it is cleared. */
  mapping: Array<{
    fromPointId: string;
    fromValue: string;
    toKey: string | null;
    toValue: string | null;
    itemCount: number;
  }>;
  mappedItems: number;
  clearedItems: number;
};

/**
 * ES-3: how existing estimates carry over. Within the same system a point keeps its identity (its
 * key), so renaming or rescaling never rewrites history and only a removed point clears. Across
 * systems a point maps where an equivalent exists (the same label, case-insensitive) and clears
 * where none does. The preview and the applied change both use this function, so what the
 * preview promised is what the change does.
 */
export function planEstimateChange(input: {
  fromSystem: EstimateSystem | null;
  toSystem: EstimateSystem;
  current: readonly CurrentPoint[];
  usage: ReadonlyMap<string, number>;
  next: readonly { key: string; value: string }[];
}): EstimateChangePlan {
  const sameSystem = input.fromSystem === input.toSystem;
  const byKey = new Map(input.next.map((point) => [point.key, point]));
  const byLabel = new Map(
    input.next.map((point) => [point.value.trim().toLowerCase(), point]),
  );
  const mapping = input.current.map((point) => {
    const target = sameSystem
      ? byKey.get(point.key)
      : byLabel.get(point.value.trim().toLowerCase());
    return {
      fromPointId: point.id,
      fromValue: point.value,
      toKey: target?.key ?? null,
      toValue: target?.value ?? null,
      itemCount: input.usage.get(point.id) ?? 0,
    };
  });
  return {
    mapping,
    mappedItems: mapping
      .filter((entry) => entry.toKey !== null)
      .reduce((total, entry) => total + entry.itemCount, 0),
    clearedItems: mapping
      .filter((entry) => entry.toKey === null)
      .reduce((total, entry) => total + entry.itemCount, 0),
  };
}

export type EstimateRollup = {
  own: number | null;
  rollup: number | null;
  /** Own estimate when there is one, otherwise the roll-up. */
  effective: number | null;
  /** Both exist and differ: a discrepancy is information (ES-4). */
  discrepancy: boolean;
};

/** ES-4: a parent's estimate rolls up from its children only when it has none of its own. */
export function rollUpEstimate(
  own: number | null,
  children: ReadonlyArray<number | null>,
): EstimateRollup {
  const estimated = children.filter((value): value is number => value !== null);
  const rollup =
    estimated.length === 0
      ? null
      : round2(estimated.reduce((sum, value) => sum + value, 0));
  return {
    own,
    rollup,
    effective: own ?? rollup,
    discrepancy: own !== null && rollup !== null && own !== rollup,
  };
}

/** A fresh stable key for a new point in a scale. */
export function pointKeyFor(index: number): string {
  return `p${index + 1}`;
}
