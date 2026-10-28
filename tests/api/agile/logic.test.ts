import { describe, expect, it } from "vitest";
import {
  addDays,
  buildBurndown,
  classifyAdd,
  computeVelocity,
  cycleStatus,
  DEFAULT_SCALES,
  durationToMinutes,
  effectiveEndDate,
  findOverlap,
  forecastModule,
  nextCycleAfter,
  normaliseScale,
  planCompletion,
  planEstimateChange,
  rollUpEstimate,
  type ScopeEvent,
  scopeChanges,
  summariseCycle,
  validateCycleDates,
} from "../../../apps/api/src/agile/logic";

const cycle = (
  id: string,
  startDate: string,
  endDate: string,
  completedAt: Date | null = null,
) => ({ id, name: id, startDate, endDate, completedAt });

describe("cycle status derivation (CY-3)", () => {
  const c = cycle("a", "2026-10-05", "2026-10-18");
  it("is upcoming the day before the start", () => {
    expect(cycleStatus(c, "2026-10-04")).toBe("upcoming");
  });
  it("is active on the start day and on the end day (inclusive)", () => {
    expect(cycleStatus(c, "2026-10-05")).toBe("active");
    expect(cycleStatus(c, "2026-10-18")).toBe("active");
  });
  it("is completed the day after the end", () => {
    expect(cycleStatus(c, "2026-10-19")).toBe("completed");
  });
  it("is completed once the completion action ran, even early", () => {
    expect(
      cycleStatus(
        { ...c, completedAt: new Date("2026-10-10T08:00:00Z") },
        "2026-10-10",
      ),
    ).toBe("completed");
  });
});

describe("overlap (CY-2)", () => {
  const existing = [
    cycle("one", "2026-10-05", "2026-10-18"),
    cycle("two", "2026-10-19", "2026-11-01"),
  ];
  it("refuses a candidate sharing the end day of another, naming it", () => {
    expect(
      findOverlap(cycle("n", "2026-10-18", "2026-10-25"), existing)?.id,
    ).toBe("one");
  });
  it("refuses a candidate that fully contains another", () => {
    expect(
      findOverlap(cycle("n", "2026-10-01", "2026-12-01"), existing)?.id,
    ).toBe("one");
  });
  it("allows back-to-back cycles (end day, next start the day after)", () => {
    expect(
      findOverlap(cycle("n", "2026-11-02", "2026-11-15"), existing),
    ).toBeNull();
  });
  it("ignores the cycle being edited", () => {
    expect(
      findOverlap(cycle("one", "2026-10-06", "2026-10-17"), existing),
    ).toBeNull();
  });
  it("gives the days back when a cycle was completed early", () => {
    const early = cycle(
      "one",
      "2026-10-05",
      "2026-10-18",
      new Date("2026-10-09T12:00:00Z"),
    );
    expect(effectiveEndDate(early)).toBe("2026-10-09");
    expect(
      findOverlap(cycle("n", "2026-10-10", "2026-10-12"), [early]),
    ).toBeNull();
    expect(
      findOverlap(cycle("n", "2026-10-09", "2026-10-12"), [early])?.id,
    ).toBe("one");
  });
  it("validates dates", () => {
    expect(validateCycleDates("2026-02-30", "2026-03-01")).toBe("invalid_date");
    expect(validateCycleDates("2026-03-02", "2026-03-01")).toBe(
      "end_before_start",
    );
    expect(validateCycleDates("2026-01-01", "2027-06-01")).toBe("too_long");
    expect(validateCycleDates("2026-03-01", "2026-03-01")).toBeNull();
  });
});

describe("completion policy (CY-6)", () => {
  const items = [
    { id: "a", group: "completed" as const },
    { id: "b", group: "started" as const },
    { id: "c", group: "backlog" as const },
    { id: "d", group: "cancelled" as const },
  ];
  it("moves only incomplete items to the next cycle", () => {
    expect(
      planCompletion({ policy: "next_cycle", items, nextCycleId: "n" }),
    ).toEqual({
      ok: true,
      policy: "next_cycle",
      destinationCycleId: "n",
      moveItemIds: ["b", "c"],
      leaveItemIds: [],
    });
  });
  it("refuses next_cycle without a next cycle instead of dropping work", () => {
    expect(
      planCompletion({ policy: "next_cycle", items, nextCycleId: null }),
    ).toEqual({ ok: false, reason: "no_next_cycle" });
  });
  it("sends incomplete items to the backlog", () => {
    const plan = planCompletion({ policy: "backlog", items, nextCycleId: "n" });
    expect(plan).toMatchObject({ ok: true, destinationCycleId: null });
    expect(plan.ok && plan.moveItemIds).toEqual(["b", "c"]);
  });
  it("leaves them in place", () => {
    const plan = planCompletion({ policy: "leave", items, nextCycleId: null });
    expect(plan.ok && plan.leaveItemIds).toEqual(["b", "c"]);
    expect(plan.ok && plan.moveItemIds).toEqual([]);
  });
  it("allows completing a cycle where everything is incomplete", () => {
    const plan = planCompletion({
      policy: "backlog",
      items: [{ id: "x", group: "started" }],
      nextCycleId: null,
    });
    expect(plan.ok && plan.moveItemIds).toEqual(["x"]);
  });
  it("next_cycle with nothing incomplete needs no next cycle", () => {
    expect(
      planCompletion({
        policy: "next_cycle",
        items: [{ id: "a", group: "completed" }],
        nextCycleId: null,
      }).ok,
    ).toBe(true);
  });
  it("picks the earliest not-completed later cycle", () => {
    const all = [
      cycle("a", "2026-10-05", "2026-10-18"),
      cycle("c", "2026-11-02", "2026-11-15"),
      cycle("b", "2026-10-19", "2026-11-01"),
    ];
    expect(nextCycleAfter(all[0] as never, all, "2026-10-10")?.id).toBe("b");
    expect(nextCycleAfter(all[2] as never, all, "2026-10-10")?.id).toBe("c");
    expect(nextCycleAfter(all[1] as never, all, "2026-10-10")).toBeNull();
  });
});

describe("burndown arithmetic (CY-7, CY-8)", () => {
  const at = (date: string, time = "10:00:00") => new Date(`${date}T${time}Z`);
  const add = (id: string, date: string, afterStart = false): ScopeEvent => ({
    workItemId: id,
    kind: "added",
    at: at(date),
    afterStart,
    retrospective: false,
  });
  const base = {
    startDate: "2026-10-05",
    endDate: "2026-10-09",
    completedAt: null,
    today: "2026-10-09",
    unit: "points" as const,
  };
  it("tracks scope and completion per day, with scope added mid-cycle", () => {
    const burndown = buildBurndown({
      ...base,
      events: [
        add("a", "2026-10-05"),
        add("b", "2026-10-05"),
        add("c", "2026-10-07", true),
      ],
      items: [
        { id: "a", weight: 3, resolvedAt: at("2026-10-06") },
        { id: "b", weight: 5, resolvedAt: null },
        { id: "c", weight: 8, resolvedAt: at("2026-10-08") },
      ],
    });
    expect(burndown.openingScope).toBe(8);
    expect(burndown.noScope).toBe(false);
    expect(burndown.points.map((p) => [p.date, p.scope, p.completed])).toEqual([
      ["2026-10-05", 8, 0],
      ["2026-10-06", 8, 3],
      ["2026-10-07", 16, 3],
      ["2026-10-08", 16, 11],
      ["2026-10-09", 16, 11],
    ]);
    expect(burndown.points[2]?.remaining).toBe(13);
    // the ideal line runs from the OPENING scope to zero at the end date
    expect(burndown.points[0]?.ideal).toBe(8);
    expect(burndown.points[4]?.ideal).toBe(0);
  });
  it("removal reduces scope from that day on", () => {
    const burndown = buildBurndown({
      ...base,
      events: [
        add("a", "2026-10-05"),
        { ...add("a", "2026-10-07", true), kind: "removed" },
      ],
      items: [{ id: "a", weight: 5, resolvedAt: null }],
    });
    expect(burndown.points.map((p) => p.scope)).toEqual([5, 5, 0, 0, 0]);
  });
  it("a rolled-over item stays in the completed cycle's scope (honest)", () => {
    const burndown = buildBurndown({
      ...base,
      completedAt: at("2026-10-09"),
      events: [
        add("a", "2026-10-05"),
        { ...add("a", "2026-10-09"), kind: "rolled_over" },
      ],
      items: [{ id: "a", weight: 5, resolvedAt: null }],
    });
    expect(burndown.points.at(-1)).toMatchObject({ scope: 5, remaining: 5 });
  });
  it("reports no scope when nothing was ever added", () => {
    const burndown = buildBurndown({ ...base, events: [], items: [] });
    expect(burndown.noScope).toBe(true);
    expect(burndown.points.every((p) => p.scope === 0)).toBe(true);
  });
  it("counts items when the unit is count, and treats unestimated as zero points only in points mode", () => {
    const events = [add("a", "2026-10-05"), add("b", "2026-10-05")];
    const items = [
      { id: "a", weight: null, resolvedAt: null },
      { id: "b", weight: 5, resolvedAt: null },
    ];
    expect(
      buildBurndown({ ...base, unit: "count", events, items }).openingScope,
    ).toBe(2);
    expect(buildBurndown({ ...base, events, items }).openingScope).toBe(5);
  });
  it("stops at today for an active cycle and does not run past the end", () => {
    const active = buildBurndown({
      ...base,
      today: "2026-10-07",
      events: [add("a", "2026-10-05")],
      items: [{ id: "a", weight: 1, resolvedAt: null }],
    });
    expect(active.points.at(-1)?.date).toBe("2026-10-07");
    const past = buildBurndown({
      ...base,
      today: "2026-12-01",
      events: [add("a", "2026-10-05")],
      items: [{ id: "a", weight: 1, resolvedAt: null }],
    });
    expect(past.points.at(-1)?.date).toBe("2026-10-09");
  });
  it("lists only scope changes after the start, in order", () => {
    const changes = scopeChanges([
      add("a", "2026-10-05"),
      add("late", "2026-10-07", true),
      { ...add("gone", "2026-10-08", true), kind: "removed" },
      { ...add("a", "2026-10-09"), kind: "rolled_over" },
    ]);
    expect(changes.map((c) => [c.workItemId, c.kind])).toEqual([
      ["late", "added"],
      ["gone", "removed"],
    ]);
  });
  it("classifies adds relative to the cycle window", () => {
    const window = { startDate: "2026-10-05", endDate: "2026-10-09" };
    expect(classifyAdd(window, "2026-10-05")).toEqual({
      afterStart: false,
      retrospective: false,
    });
    expect(classifyAdd(window, "2026-10-06")).toEqual({
      afterStart: true,
      retrospective: false,
    });
    expect(classifyAdd(window, "2026-10-10")).toEqual({
      afterStart: true,
      retrospective: true,
    });
  });
});

describe("summary and unestimated share (CY-7, ES-5)", () => {
  it("reports unestimated items rather than counting them as zero", () => {
    const summary = summariseCycle(
      [
        { id: "a", group: "completed", weight: 3, estimated: true },
        { id: "b", group: "started", weight: 5, estimated: true },
        { id: "c", group: "backlog", weight: null, estimated: false },
        { id: "d", group: "cancelled", weight: 2, estimated: true },
      ],
      "points",
    );
    expect(summary.total).toEqual({ count: 4, points: 10 });
    expect(summary.completed).toEqual({ count: 1, points: 3 });
    expect(summary.inProgress.count).toBe(1);
    expect(summary.notStarted.count).toBe(1);
    expect(summary.unestimated).toEqual({ count: 1, share: 0.25 });
  });
  it("a category-estimated item is estimated even without a weight", () => {
    const summary = summariseCycle(
      [{ id: "a", group: "started", weight: null, estimated: true }],
      "count",
    );
    expect(summary.unestimated.count).toBe(0);
  });
});

describe("velocity (CY-9)", () => {
  const entry = (n: number, points: number, unit = "points" as const) => ({
    cycleId: `c${n}`,
    completedAt: new Date(Date.UTC(2026, 0, n)),
    unit,
    completedPoints: points,
  });
  it("is insufficient data with fewer than three completed cycles", () => {
    expect(computeVelocity([])).toMatchObject({ status: "insufficient_data" });
    expect(computeVelocity([entry(1, 10), entry(2, 20)])).toEqual({
      status: "insufficient_data",
      cycles: 2,
      reason: "fewer_than_three",
    });
  });
  it("is the mean of the LAST three completed cycles", () => {
    expect(
      computeVelocity([
        entry(1, 100),
        entry(2, 10),
        entry(3, 20),
        entry(4, 30),
      ]),
    ).toEqual({ status: "ok", unit: "points", value: 20, cycles: 3 });
  });
  it("does not average across different units", () => {
    expect(
      computeVelocity([
        entry(1, 10),
        entry(2, 20),
        entry(3, 5, "count" as never),
      ]),
    ).toMatchObject({ status: "insufficient_data", reason: "mixed_units" });
  });
  it("keeps the last-three window and refuses unknown late-catchup totals", () => {
    expect(
      computeVelocity([
        { ...entry(1, 100), historicalPointsKnown: true },
        { ...entry(2, 10), historicalPointsKnown: true },
        { ...entry(3, 20), historicalPointsKnown: false },
        { ...entry(4, 30), historicalPointsKnown: true },
      ]),
    ).toEqual({
      status: "insufficient_data",
      cycles: 3,
      reason: "late_snapshot",
    });
  });
});

describe("module forecast as a range (MO-4)", () => {
  const resolved = (n: number) =>
    Array.from({ length: n }, (_, i) => addDays("2026-10-01", i % 20));
  it("has no forecast without a target date", () => {
    expect(
      forecastModule({
        today: "2026-10-24",
        targetDate: null,
        remaining: 5,
        resolvedDates: resolved(10),
        state: "in_progress",
      }),
    ).toEqual({ status: "no_target" });
  });
  it("is complete when nothing remains", () => {
    expect(
      forecastModule({
        today: "2026-10-24",
        targetDate: "2026-11-30",
        remaining: 0,
        resolvedDates: [],
        state: "in_progress",
      }),
    ).toEqual({ status: "complete" });
  });
  it("never extrapolates from fewer than three completions", () => {
    expect(
      forecastModule({
        today: "2026-10-24",
        targetDate: "2026-11-30",
        remaining: 5,
        resolvedDates: resolved(2),
        state: "in_progress",
      }),
    ).toEqual({ status: "insufficient_data", completedInWindow: 2 });
  });
  it("brackets the rate and compares the whole range with the target", () => {
    const base = {
      today: "2026-10-24",
      remaining: 14,
      resolvedDates: resolved(14),
      state: "in_progress" as const,
    };
    const onTrack = forecastModule({ ...base, targetDate: "2027-01-31" });
    expect(onTrack).toMatchObject({ status: "on_track" });
    const late = forecastModule({ ...base, targetDate: "2026-10-25" });
    expect(late).toMatchObject({ status: "late" });
    const risky = forecastModule({ ...base, targetDate: "2026-11-25" });
    expect(risky).toMatchObject({ status: "at_risk" });
    if (onTrack.status === "on_track")
      expect(onTrack.earliest < onTrack.latest).toBe(true);
  });
});

describe("estimates (ES-1..ES-4)", () => {
  it("ships the three default scales", () => {
    expect(DEFAULT_SCALES.points.map((p) => p.value)).toEqual([
      "1",
      "2",
      "3",
      "5",
      "8",
      "13",
      "21",
    ]);
    expect(DEFAULT_SCALES.categories.map((p) => p.value)).toEqual([
      "XS",
      "S",
      "M",
      "L",
      "XL",
    ]);
    expect(DEFAULT_SCALES.time.map((p) => p.value)).toEqual([
      "1h",
      "2h",
      "4h",
      "1d",
      "2d",
      "1w",
    ]);
  });
  it("parses durations to minutes", () => {
    expect(durationToMinutes("1h")).toBe(60);
    expect(durationToMinutes("1d")).toBe(480);
    expect(durationToMinutes("1w")).toBe(2400);
    expect(durationToMinutes("soon")).toBeNull();
  });
  it("validates a scale per system", () => {
    expect(normaliseScale("points", [{ value: "3" }, { value: "x" }])).toEqual({
      ok: false,
      problem: "invalid_points_value",
    });
    expect(normaliseScale("time", [{ value: "2 weeks" }])).toEqual({
      ok: false,
      problem: "invalid_duration",
    });
    expect(
      normaliseScale("categories", [{ value: "S" }, { value: "s" }]),
    ).toEqual({
      ok: false,
      problem: "duplicate_label",
    });
    expect(normaliseScale("points", [])).toEqual({
      ok: false,
      problem: "empty",
    });
    expect(normaliseScale("categories", [{ value: " M " }])).toEqual({
      ok: true,
      points: [{ key: undefined, value: "M", weight: null }],
    });
  });
  const current = [
    { id: "p-1", key: "p1", value: "1" },
    { id: "p-2", key: "p2", value: "2" },
    { id: "p-3", key: "p3", value: "3" },
  ];
  const usage = new Map([
    ["p-1", 4],
    ["p-2", 2],
    ["p-3", 1],
  ]);
  it("rescaling within a system keeps identity by key; only removed points clear", () => {
    const plan = planEstimateChange({
      fromSystem: "points",
      toSystem: "points",
      current,
      usage,
      next: [
        { key: "p1", value: "1" },
        { key: "p2", value: "4" }, // renamed: items follow the key
      ],
    });
    expect(plan.mappedItems).toBe(6);
    expect(plan.clearedItems).toBe(1);
    expect(plan.mapping.find((m) => m.fromPointId === "p-2")?.toValue).toBe(
      "4",
    );
  });
  it("changing system maps equivalents by label and clears the rest", () => {
    const plan = planEstimateChange({
      fromSystem: "points",
      toSystem: "categories",
      current,
      usage,
      next: [
        { key: "p1", value: "XS" },
        { key: "p2", value: "2" },
      ],
    });
    expect(plan.mappedItems).toBe(2);
    expect(plan.clearedItems).toBe(5);
  });
  it("rolls up a parent's estimate from its children only when it has none", () => {
    expect(rollUpEstimate(null, [3, 5, null])).toEqual({
      own: null,
      rollup: 8,
      effective: 8,
      discrepancy: false,
    });
    expect(rollUpEstimate(13, [3, 5])).toEqual({
      own: 13,
      rollup: 8,
      effective: 13,
      discrepancy: true,
    });
    expect(rollUpEstimate(8, [3, 5]).discrepancy).toBe(false);
    expect(rollUpEstimate(null, [null])).toMatchObject({
      rollup: null,
      effective: null,
    });
  });
});
