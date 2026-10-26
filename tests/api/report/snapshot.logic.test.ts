import { describe, expect, it } from "vitest";
import {
  capFor,
  EXPORT_ROW_LIMIT,
  EXPORT_SYNC_ROW_LIMIT,
  shouldQueueExport,
} from "../../../apps/api/src/report/export.logic";
import {
  DAY_MS,
  previousWindow,
  resolveWindow,
} from "../../../apps/api/src/report/logic";
import type { ReportEnvelope } from "../../../apps/api/src/report/present";
import { reportToCsv } from "../../../apps/api/src/report/present";
import {
  addDays,
  boundaryOf,
  dayKey,
  dayKeysBetween,
  daysToCompute,
  emptyUse,
  mergeUse,
  runsOf,
  SNAPSHOT_BACKFILL_DAYS_PER_RUN,
  SNAPSHOT_FAMILY_VERSION,
  SNAPSHOT_LOOKBACK_DAYS,
  SNAPSHOT_METRICS,
  SNAPSHOT_RETENTION_DAYS,
  splitForSnapshots,
  utcDayStart,
} from "../../../apps/api/src/report/snapshot.logic";

const NOW = new Date("2026-10-24T09:30:00.000Z");
const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("which part of a window is read from snapshots (RP-9)", () => {
  it("publishes coverage only for the complete versioned report fact family", () => {
    expect(SNAPSHOT_FAMILY_VERSION).toBe(2);
    expect(SNAPSHOT_METRICS).toEqual([
      "sla_resolution",
      "sla_first_response",
      "throughput",
      "item_created",
      "item_resolved",
      "sla_due_outcome",
      "satisfaction_rating",
      "time_logged",
      "cost_entry",
      "escalation_started",
      "kb_deflection",
      "cycle_completion",
    ]);
  });

  it("keeps the current day and a partial edge live, and whole closed days stored", () => {
    const window = resolveWindow({ window: "30" }, NOW);
    if (!window.ok) throw new Error("window");
    const split = splitForSnapshots(window.window.from, window.window.to, NOW);
    // The window starts at midnight and ends now: 29 closed days and today.
    expect(split.closed?.from).toEqual(at("2026-09-25"));
    expect(split.closed?.to).toEqual(at("2026-10-24"));
    expect(split.live).toEqual([{ from: at("2026-10-24"), to: NOW }]);
  });

  it("splits the comparison period, which starts mid-day, into a live edge and whole days", () => {
    const window = resolveWindow({ window: "30" }, NOW);
    if (!window.ok) throw new Error("window");
    const before = previousWindow(window.window);
    expect(before.from.getTime() % DAY_MS).not.toBe(0);
    const split = splitForSnapshots(before.from, before.to, NOW);
    expect(split.live).toHaveLength(1);
    expect(split.live[0]?.from).toEqual(before.from);
    expect(split.live[0]?.to).toEqual(split.closed?.from);
    expect(split.closed?.to).toEqual(before.to);
    // Every instant is in exactly one part.
    const length =
      (split.closed
        ? split.closed.to.getTime() - split.closed.from.getTime()
        : 0) +
      split.live.reduce(
        (sum, range) => sum + range.to.getTime() - range.from.getTime(),
        0,
      );
    expect(length).toBe(before.to.getTime() - before.from.getTime());
  });

  it("reads a fully closed custom window from snapshots only, and today's custom window live", () => {
    const closed = splitForSnapshots(at("2026-10-01"), at("2026-10-11"), NOW);
    expect(closed.live).toEqual([]);
    expect(
      dayKeysBetween(closed.closed?.from as Date, closed.closed?.to as Date),
    ).toHaveLength(10);
    const today = splitForSnapshots(at("2026-10-20"), at("2026-10-25"), NOW);
    expect(today.closed?.to).toEqual(at("2026-10-24"));
    expect(today.live).toEqual([
      { from: at("2026-10-24"), to: at("2026-10-25") },
    ]);
  });

  it("is all live inside one day or for an empty window", () => {
    const inside = splitForSnapshots(
      new Date("2026-10-24T01:00:00.000Z"),
      NOW,
      NOW,
    );
    expect(inside.closed).toBeNull();
    expect(inside.live).toHaveLength(1);
    expect(splitForSnapshots(NOW, NOW, NOW)).toEqual({
      closed: null,
      live: [],
    });
  });

  it("turns missing days into the fewest live ranges", () => {
    expect(
      runsOf(["2026-10-03", "2026-10-01", "2026-10-02", "2026-10-07"]),
    ).toEqual([
      { from: at("2026-10-01"), to: at("2026-10-04") },
      { from: at("2026-10-07"), to: at("2026-10-08") },
    ]);
    expect(runsOf([])).toEqual([]);
  });

  it("states the boundary: live, snapshot or mixed", () => {
    expect(boundaryOf(emptyUse())).toBe("live");
    expect(boundaryOf({ ...emptyUse(), snapshotDays: 5 })).toBe("snapshot");
    expect(
      boundaryOf({ ...emptyUse(), snapshotDays: 5, liveParts: true }),
    ).toBe("mixed");
    expect(
      boundaryOf({ ...emptyUse(), snapshotDays: 5, uncoveredDays: 1 }),
    ).toBe("mixed");
    const merged = mergeUse(
      { ...emptyUse(), snapshotDays: 2, computedAt: at("2026-10-20") },
      {
        ...emptyUse(),
        snapshotDays: 3,
        liveParts: true,
        computedAt: at("2026-10-22"),
        throughDay: at("2026-10-23"),
      },
    );
    expect(merged).toMatchObject({ snapshotDays: 5, liveParts: true });
    expect(merged.computedAt).toEqual(at("2026-10-22"));
    expect(merged.throughDay).toEqual(at("2026-10-23"));
  });
});

describe("which days the job writes", () => {
  it("always recomputes the lookback, then fills missing days newest first within retention", () => {
    const covered = new Set<string>();
    for (let i = 1; i <= 10; i += 1)
      covered.add(dayKey(addDays(utcDayStart(NOW), -i)));
    const days = daysToCompute({
      now: NOW,
      covered,
      earliest: at("2026-01-01"),
    });
    const lookback = Array.from({ length: SNAPSHOT_LOOKBACK_DAYS }, (_, i) =>
      dayKey(addDays(utcDayStart(NOW), -(i + 1))),
    );
    expect(days.slice(0, SNAPSHOT_LOOKBACK_DAYS)).toEqual(lookback);
    const filled = days.slice(SNAPSHOT_LOOKBACK_DAYS);
    // Days 4..10 are covered already; the next missing one is 11 days back.
    expect(filled[0]).toBe(dayKey(addDays(utcDayStart(NOW), -11)));
    expect(filled.length).toBeLessThanOrEqual(SNAPSHOT_BACKFILL_DAYS_PER_RUN);
    expect(filled).toEqual([...filled].sort().reverse());
    // Today is never written.
    expect(days).not.toContain(dayKey(NOW));
  });

  it("never reaches before the first item or past the retention horizon, and is idempotent", () => {
    const early = daysToCompute({
      now: NOW,
      covered: new Set(),
      earliest: at("2020-01-01"),
    });
    const oldest = dayKey(addDays(utcDayStart(NOW), -SNAPSHOT_RETENTION_DAYS));
    expect(early.every((key) => key >= oldest)).toBe(true);
    const recent = daysToCompute({
      now: NOW,
      covered: new Set(),
      earliest: at("2026-10-20"),
    });
    expect(recent.every((key) => key >= "2026-10-20")).toBe(true);
    expect(
      daysToCompute({
        now: NOW,
        covered: new Set(),
        earliest: at("2026-10-20"),
      }),
    ).toEqual(recent);
    expect(
      daysToCompute({ now: NOW, covered: new Set(), earliest: null }),
    ).toHaveLength(SNAPSHOT_LOOKBACK_DAYS);
  });
});

describe("when an export is queued (RP-10)", () => {
  it("answers a small export in the request and queues a truncated or large one", () => {
    expect(shouldQueueExport({ rows: 10, truncated: false })).toBe(false);
    expect(
      shouldQueueExport({ rows: EXPORT_SYNC_ROW_LIMIT, truncated: false }),
    ).toBe(false);
    expect(
      shouldQueueExport({ rows: EXPORT_SYNC_ROW_LIMIT + 1, truncated: false }),
    ).toBe(true);
    expect(shouldQueueExport({ rows: 3, truncated: true })).toBe(true);
  });

  it("lifts a report's row cap only in a background export", () => {
    expect(capFor(false, 200)).toBe(200);
    expect(capFor(true, 200)).toBe(EXPORT_ROW_LIMIT);
    expect(capFor(true, EXPORT_ROW_LIMIT + 10)).toBe(EXPORT_ROW_LIMIT + 10);
  });
});

describe("the CSV states what it is built from", () => {
  const envelope = (overrides: Partial<ReportEnvelope>): ReportEnvelope => ({
    key: "throughput",
    title: "Throughput",
    category: "delivery",
    tier: 1,
    scope: { kind: "all", projectCount: 2 },
    window: {
      preset: "30",
      from: "2026-09-25T00:00:00.000Z",
      to: "2026-10-24T09:30:00.000Z",
      days: 30,
      live: false,
    },
    asOf: "2026-10-24T09:30:00.000Z",
    boundary: "live",
    sources: {
      metricSnapshot: false,
      cycleSnapshot: false,
      liveComponents: ["selected_period"],
    },
    snapshot: null,
    filters: {},
    options: {},
    choices: [],
    metrics: [],
    chart: null,
    columns: [{ key: "week", label: "Week", kind: "text" }],
    rows: [{ week: "2026-10-19" }],
    truncated: false,
    empty: null,
    excluded: null,
    notes: [],
    drill: true,
    costVisible: false,
    ...overrides,
  });

  it("states source provenance, the stored period and a cut at the row cap", () => {
    const plain = reportToCsv(envelope({}));
    expect(plain).toContain("# Sources: live components: selected period");
    expect(plain).not.toContain("# Truncated");
    const csv = reportToCsv(
      envelope({
        boundary: "mixed",
        snapshot: {
          closedDays: 28,
          uncoveredDays: 0,
          computedAt: "2026-10-24T09:00:00.000Z",
          through: "2026-10-24T00:00:00.000Z",
        },
        sources: {
          metricSnapshot: true,
          cycleSnapshot: false,
          liveComponents: ["current_period"],
        },
        truncated: true,
      }),
    );
    expect(csv).toContain(
      "# Sources: daily report snapshots; live components: current or partial period",
    );
    expect(csv).toContain(
      // Snapshot coverage ends at an exclusive midnight; CSV names the last stored day.
      "# Source: 28 closed day(s) from stored daily snapshots up to 2026-10-23; the rest is computed live",
    );
    expect(csv).toContain("# Truncated: this report stops at 1 rows");
    // The data header still follows the preamble.
    expect(csv.indexOf("Week")).toBeGreaterThan(csv.indexOf("# Truncated"));
  });
});
