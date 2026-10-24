import { describe, expect, it } from "vitest";
import { validateCustomQuery } from "../../../apps/api/src/report/custom";
import { layoutProblem } from "../../../apps/api/src/report/dashboard.logic";
import {
  AGE_BUCKETS,
  bucketCounts,
  bucketOf,
  csvCell,
  csvRow,
  DAY_MS,
  DURATION_BUCKETS,
  isCalendarDate,
  MAX_CUSTOM_WINDOW_DAYS,
  previousWindow,
  ratePercent,
  resolveWindow,
  trendOf,
  utc,
  weekStartOf,
  weeksBetween,
} from "../../../apps/api/src/report/logic";
import type { ReportEnvelope } from "../../../apps/api/src/report/present";
import { reportToCsv, stripRates } from "../../../apps/api/src/report/present";

const NOW = new Date("2026-10-24T09:30:00.000Z");

describe("windows (RP-7)", () => {
  it("defaults to the last 30 days, ending now", () => {
    const result = resolveWindow({}, NOW);
    expect(result.ok && result.window).toMatchObject({
      preset: "30",
      days: 30,
    });
    if (result.ok) {
      expect(result.window.from.toISOString()).toBe("2026-09-25T00:00:00.000Z");
      expect(result.window.to.toISOString()).toBe(NOW.toISOString());
    }
  });

  it("accepts the four presets and rejects others", () => {
    for (const preset of ["7", "30", "60", "90"])
      expect(resolveWindow({ window: preset }, NOW).ok).toBe(true);
    expect(resolveWindow({ window: "14" }, NOW)).toEqual({
      ok: false,
      reason: "invalid_window",
    });
  });

  it("takes a custom window with both days inclusive", () => {
    const result = resolveWindow(
      { window: "custom", from: "2026-10-01", to: "2026-10-07" },
      NOW,
    );
    expect(result.ok && result.window.days).toBe(7);
    if (result.ok)
      expect(result.window.to.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  it("treats from/to alone as custom, and refuses bad, reversed or oversized windows", () => {
    expect(
      resolveWindow({ from: "2026-10-01", to: "2026-10-02" }, NOW).ok,
    ).toBe(true);
    expect(
      resolveWindow(
        { window: "custom", from: "2026-02-30", to: "2026-03-01" },
        NOW,
      ),
    ).toEqual({ ok: false, reason: "invalid_window" });
    expect(
      resolveWindow(
        { window: "custom", from: "2026-10-05", to: "2026-10-01" },
        NOW,
      ),
    ).toEqual({ ok: false, reason: "window_order" });
    expect(
      resolveWindow(
        { window: "custom", from: "2025-01-01", to: "2026-10-01" },
        NOW,
      ),
    ).toEqual({ ok: false, reason: "window_too_long" });
    expect(MAX_CUSTOM_WINDOW_DAYS).toBe(366);
  });

  it("builds the previous comparable window of the same length", () => {
    const result = resolveWindow(
      { window: "custom", from: "2026-10-08", to: "2026-10-14" },
      NOW,
    );
    if (!result.ok) throw new Error("window");
    const previous = previousWindow(result.window);
    expect(previous.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(previous.to.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  it("validates calendar days", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("20260228")).toBe(false);
    expect(isCalendarDate(undefined)).toBe(false);
  });
});

describe("buckets (RP-2)", () => {
  const days = (n: number) => n * DAY_MS;
  it("puts boundaries in the upper bucket", () => {
    expect(bucketOf(days(0.99), AGE_BUCKETS).key).toBe("lt1");
    expect(bucketOf(days(1), AGE_BUCKETS).key).toBe("d1_3");
    expect(bucketOf(days(3.99), AGE_BUCKETS).key).toBe("d1_3");
    expect(bucketOf(days(4), AGE_BUCKETS).key).toBe("d4_7");
    expect(bucketOf(days(90.5), AGE_BUCKETS).key).toBe("d61_90");
    expect(bucketOf(days(91), AGE_BUCKETS).key).toBe("gt90");
    expect(bucketOf(days(400), AGE_BUCKETS).key).toBe("gt90");
    expect(bucketOf(-5, AGE_BUCKETS).key).toBe("lt1");
  });

  it("counts into every bucket, including empty ones, so the ninety-day item has a bar", () => {
    const counts = bucketCounts(
      [days(0.5), days(2), days(100), days(100)],
      AGE_BUCKETS,
    );
    expect(counts.map((c) => c.count)).toEqual([1, 1, 0, 0, 0, 0, 0, 2]);
    expect(counts.reduce((sum, c) => sum + c.count, 0)).toBe(4);
    expect(bucketCounts([], DURATION_BUCKETS).every((c) => c.count === 0)).toBe(
      true,
    );
  });
});

describe("the honesty rule (RP-1)", () => {
  it("is null with its sample below the minimum, never 0% or 100%", () => {
    expect(ratePercent(3, 3)).toEqual({ value: null, n: 3, needed: 10 });
    expect(ratePercent(0, 0)).toEqual({ value: null, n: 0, needed: 10 });
    expect(ratePercent(9, 9).value).toBeNull();
  });

  it("is a rounded percentage at the minimum", () => {
    expect(ratePercent(9, 10)).toEqual({ value: 90, n: 10, needed: 10 });
    expect(ratePercent(1, 3, 3).value).toBe(33.3);
    expect(ratePercent(0, 10).value).toBe(0);
    expect(ratePercent(5, 0.5, 1).value).toBeNull();
  });
});

describe("trends (RP-6)", () => {
  const sampled = (value: number | null) => ({ value, n: 10, needed: 10 });
  it("needs two comparable periods", () => {
    expect(trendOf(sampled(80), sampled(null))).toEqual({
      status: "insufficient",
      reason: "needs_two_periods",
    });
    expect(trendOf(sampled(null), sampled(80))).toEqual({
      status: "insufficient",
      reason: "needs_two_periods",
    });
  });
  it("gives direction and delta, flat under the threshold", () => {
    expect(trendOf(sampled(85), sampled(80))).toEqual({
      status: "ok",
      direction: "up",
      delta: 5,
      previous: 80,
    });
    expect(trendOf(sampled(70), sampled(80))).toMatchObject({
      direction: "down",
      delta: -10,
    });
    expect(trendOf(sampled(80.2), sampled(80))).toMatchObject({
      direction: "flat",
    });
    expect(trendOf(sampled(2), sampled(1), 1)).toMatchObject({
      direction: "up",
    });
  });
});

describe("weeks", () => {
  it("starts on Monday, in UTC", () => {
    expect(
      weekStartOf(new Date("2026-10-24T23:59:00Z")).toISOString().slice(0, 10),
    ).toBe("2026-10-19");
    expect(
      weekStartOf(new Date("2026-10-19T00:00:00Z")).toISOString().slice(0, 10),
    ).toBe("2026-10-19");
    expect(
      weekStartOf(new Date("2026-10-25T10:00:00Z")).toISOString().slice(0, 10),
    ).toBe("2026-10-19");
  });
  it("lists every week of a window, including the partial ends", () => {
    expect(
      weeksBetween(
        new Date("2026-10-08T00:00:00Z"),
        new Date("2026-10-24T09:00:00Z"),
      ),
    ).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
  });
});

describe("database timestamps", () => {
  it("reads a naive timestamp as UTC", () => {
    expect(utc("2026-10-24 09:30:00.123").toISOString()).toBe(
      "2026-10-24T09:30:00.123Z",
    );
    expect(utc("2026-10-24 15:30:00+06:30").toISOString()).toBe(
      "2026-10-24T09:00:00.000Z",
    );
    expect(utc("2026-10-24 09:30:00+00").toISOString()).toBe(
      "2026-10-24T09:30:00.000Z",
    );
    expect(utc("2026-10-24T09:30:00Z").toISOString()).toBe(
      "2026-10-24T09:30:00.000Z",
    );
    const date = new Date();
    expect(utc(date)).toBe(date);
  });
});

describe("CSV (RP-10)", () => {
  it("quotes per RFC 4180", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(-3)).toBe("-3");
  });

  it("neutralises every formula starter", () => {
    for (const start of ["=", "+", "-", "@", "\t", "\r"])
      expect(csvCell(`${start}1+1`)).toMatch(/^"?'/);
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("safe=1")).toBe("safe=1");
    expect(csvRow(["a", "=b", 3])).toBe("a,'=b,3");
  });
});

function envelope(overrides: Partial<ReportEnvelope> = {}): ReportEnvelope {
  return {
    key: "time_logged",
    title: "Time logged",
    category: "time",
    tier: 1,
    scope: { kind: "reach", projectCount: 2 },
    window: {
      preset: "30",
      from: "2026-09-25T00:00:00.000Z",
      to: "2026-10-24T09:30:00.000Z",
      days: 30,
      live: false,
    },
    asOf: "2026-10-24T09:30:00.000Z",
    boundary: "live",
    filters: {},
    options: {},
    choices: [],
    metrics: [
      {
        key: "hours",
        label: "Hours",
        unit: "hours",
        value: 3,
        n: 3,
        needed: 0,
      },
      {
        key: "cost_EUR",
        label: "Cost",
        unit: "money",
        value: 900,
        n: 900,
        needed: 0,
        sensitive: true,
        currency: "EUR",
      },
    ],
    chart: {
      type: "bar",
      unit: "hours",
      categories: ["A"],
      series: [
        { key: "hours", label: "Hours", values: [3] },
        { key: "cost", label: "Cost", values: [900], sensitive: true },
      ],
    },
    columns: [
      { key: "group", label: "Group", kind: "text" },
      { key: "hours", label: "Hours", kind: "hours" },
      { key: "cost", label: "Cost", kind: "text", sensitive: true },
      { key: "rate", label: "Rate", kind: "percent" },
    ],
    rows: [
      { group: "=A", hours: 3, cost: "EUR 9.00", rate: { n: 3, needed: 10 } },
    ],
    truncated: false,
    empty: null,
    excluded: null,
    notes: [],
    drill: false,
    costVisible: true,
    ...overrides,
  };
}

describe("rate stripping (TC-11)", () => {
  it("removes sensitive columns, row keys, metrics and series, not just blanks them", () => {
    const stripped = stripRates(envelope(), false);
    expect(stripped.costVisible).toBe(false);
    expect(stripped.columns.map((c) => c.key)).toEqual([
      "group",
      "hours",
      "rate",
    ]);
    expect(Object.keys(stripped.rows[0] ?? {})).toEqual([
      "group",
      "hours",
      "rate",
    ]);
    expect(stripped.metrics.map((m) => m.key)).toEqual(["hours"]);
    expect(stripped.chart?.series.map((s) => s.key)).toEqual(["hours"]);
    expect(JSON.stringify(stripped)).not.toContain("EUR");
  });

  it("keeps everything for a rate manager", () => {
    const kept = stripRates(envelope(), true);
    expect(kept.costVisible).toBe(true);
    expect(kept.columns).toHaveLength(4);
  });

  it("writes the same stripped report into the CSV, with scope, window and as-of", () => {
    const csv = reportToCsv(stripRates(envelope(), false));
    expect(csv).not.toContain("Cost");
    expect(csv).not.toContain("EUR");
    expect(csv).toContain("# Scope: your projects (2)");
    expect(csv).toContain("# Window: 2026-09-25 to 2026-10-24");
    expect(csv).toContain("# As of: 2026-10-24T09:30:00.000Z");
    expect(csv).toContain("'=A,3,not enough data (3 of 10)");
    const full = reportToCsv(stripRates(envelope(), true));
    expect(full).toContain("EUR 9.00");
  });

  it("states a live report as live", () => {
    expect(
      reportToCsv(envelope({ window: { ...envelope().window, live: true } })),
    ).toContain("# Window: live");
  });
});

describe("dashboard layout (RP-15)", () => {
  it("accepts a grid with no shared cell and refuses overlap", () => {
    expect(
      layoutProblem([
        { x: 0, y: 0, w: 6, h: 4 },
        { x: 6, y: 0, w: 6, h: 4 },
        { x: 0, y: 4, w: 12, h: 2 },
      ]),
    ).toBeNull();
    expect(
      layoutProblem([
        { x: 0, y: 0, w: 6, h: 4 },
        { x: 5, y: 3, w: 4, h: 4 },
      ]),
    ).toBe("overlap");
    expect(layoutProblem([])).toBeNull();
  });
});

describe("tier 3 grammar", () => {
  const parse = (query: Parameters<typeof validateCustomQuery>[0]) =>
    validateCustomQuery(query);
  it("accepts the supported shapes", () => {
    expect(
      parse({
        entity: "work_item",
        groupBy: "priority",
        aggregate: { fn: "count" },
      }),
    ).toBeNull();
    expect(parse({ entity: "work_item", groupBy: "field:abc" })).toBeNull();
    expect(
      parse({
        entity: "time_entry",
        groupBy: "person",
        aggregate: { fn: "sum", field: "minutes" },
      }),
    ).toBeNull();
  });
  it("refuses everything outside it", () => {
    expect(parse({ entity: "work_item", filter: { nope: 1 } })).toBe(
      "unsupported_filter",
    );
    expect(parse({ entity: "work_item", groupBy: "person" })).toBe(
      "unsupported_group",
    );
    expect(parse({ entity: "time_entry", groupBy: "field:abc" })).toBe(
      "unsupported_group",
    );
    expect(parse({ entity: "work_item", aggregate: { fn: "avg" } })).toBe(
      "unsupported_aggregate",
    );
    expect(
      parse({
        entity: "work_item",
        aggregate: { fn: "sum", field: "minutes" },
      }),
    ).toBe("unsupported_aggregate");
  });
});
