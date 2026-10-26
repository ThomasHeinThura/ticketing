import { describe, expect, it } from "vitest";
import {
  type AvailableHoursRow,
  availableHoursOn,
  availableMinutes,
  committedForecast,
  committedMinorForBudget,
  costEntryAmountMinor,
  newlyReachedThresholds,
  resolveCostRate,
  utilisationRatio,
} from "../../../apps/api/src/time-tracking/cost-logic";

describe("cost entry amounts (TC-13)", () => {
  it("is units times the captured rate in integer minor units", () => {
    expect(costEntryAmountMinor(3, 2500)).toBe(7500);
    expect(costEntryAmountMinor(1, 0)).toBe(0);
    expect(costEntryAmountMinor(1_000_000, 1_000_000)).toBe(1_000_000_000_000);
  });

  it("refuses a non-integer so a float can never reach a total", () => {
    expect(() => costEntryAmountMinor(1.5, 100)).toThrow();
    expect(() => costEntryAmountMinor(2, 10.5)).toThrow();
  });

  it("takes the explicit rate, else the type's default, else nothing", () => {
    expect(resolveCostRate(70, 2500)).toEqual({
      rateMinor: 70,
      source: "entry",
    });
    expect(resolveCostRate(0, 2500)).toEqual({ rateMinor: 0, source: "entry" });
    expect(resolveCostRate(undefined, 2500)).toEqual({
      rateMinor: 2500,
      source: "cost_type",
    });
    expect(resolveCostRate(undefined, null)).toBeNull();
  });
});

describe("committed work forecast (TC-17)", () => {
  const periodStart = "2026-10-01";
  const periodEnd = "2026-10-31";
  it("subtracts all logged minutes, floors remaining at zero and keeps currencies separate", () => {
    const result = committedForecast(
      [
        {
          dueDate: "2026-10-10",
          estimatedMinutes: 120,
          loggedMinutes: 60,
          assigneeId: "p1",
          rate: { rateMinor: 6000, currency: "EUR" },
        },
        {
          dueDate: "2026-10-11",
          estimatedMinutes: 30,
          loggedMinutes: 60,
          assigneeId: "p1",
          rate: { rateMinor: 6000, currency: "EUR" },
        },
        {
          dueDate: "2026-10-12",
          estimatedMinutes: 60,
          loggedMinutes: 0,
          assigneeId: "p2",
          rate: { rateMinor: 12_000, currency: "USD" },
        },
        {
          dueDate: "2026-11-01",
          estimatedMinutes: 120,
          loggedMinutes: 0,
          assigneeId: "p1",
          rate: { rateMinor: 6000, currency: "EUR" },
        },
      ],
      periodStart,
      periodEnd,
    );
    expect(result.byCurrency).toEqual([
      { currency: "EUR", amountMinor: 6000, taskCount: 2 },
      { currency: "USD", amountMinor: 12_000, taskCount: 1 },
    ]);
    expect(committedMinorForBudget(result, "EUR")).toBeNull();
  });

  it("reports mutually exclusive UNKNOWN reasons and known remaining minutes", () => {
    const result = committedForecast(
      [
        {
          dueDate: null,
          estimatedMinutes: 120,
          loggedMinutes: 30,
          assigneeId: "p1",
          rate: { rateMinor: 6000, currency: "EUR" },
        },
        {
          dueDate: "2026-10-10",
          estimatedMinutes: null,
          loggedMinutes: 0,
          assigneeId: "p1",
          rate: { rateMinor: 6000, currency: "EUR" },
        },
        {
          dueDate: "2026-10-11",
          estimatedMinutes: 90,
          loggedMinutes: 30,
          assigneeId: null,
          rate: null,
        },
        {
          dueDate: "2026-10-12",
          estimatedMinutes: 30,
          loggedMinutes: 0,
          assigneeId: "p2",
          rate: null,
        },
      ],
      periodStart,
      periodEnd,
    );
    expect(result.unknown).toEqual({
      taskCount: 4,
      reasons: { unscheduled: 1, nonTime: 1, unassigned: 1, unrated: 1 },
      knownRemainingMinutes: 180,
    });
    expect(committedMinorForBudget(result, "EUR")).toBeNull();
  });

  it("returns zero only when the in-period forecast is complete and empty", () => {
    expect(
      committedMinorForBudget(
        committedForecast([], periodStart, periodEnd),
        "EUR",
      ),
    ).toBe(0);
    expect(
      committedMinorForBudget(
        committedForecast(
          [
            {
              dueDate: "2026-10-10",
              estimatedMinutes: 60,
              loggedMinutes: 60,
              assigneeId: "p1",
              rate: { rateMinor: 6000, currency: "EUR" },
            },
          ],
          periodStart,
          periodEnd,
        ),
        "EUR",
      ),
    ).toBe(0);
  });
});

describe("budget thresholds (TC-18)", () => {
  const none = new Set<number>();
  it("reaches 75 and 90 exactly at the line, not before", () => {
    expect(newlyReachedThresholds(10_000, 7_499, none)).toEqual([]);
    expect(newlyReachedThresholds(10_000, 7_500, none)).toEqual([75]);
    expect(newlyReachedThresholds(10_000, 8_999, none)).toEqual([75]);
    expect(newlyReachedThresholds(10_000, 9_000, none)).toEqual([75, 90]);
  });

  it("returns every unannounced threshold of a jump, and none already announced", () => {
    expect(newlyReachedThresholds(1_000, 5_000, none)).toEqual([75, 90]);
    expect(newlyReachedThresholds(1_000, 5_000, new Set([75]))).toEqual([90]);
    expect(newlyReachedThresholds(1_000, 5_000, new Set([75, 90]))).toEqual([]);
  });

  it("never fires for a budget with nothing planned or while spending is zero", () => {
    expect(newlyReachedThresholds(0, 100, none)).toEqual([]);
    expect(newlyReachedThresholds(10_000, 0, none)).toEqual([]);
  });

  it("does not overflow on large amounts (integer arithmetic only)", () => {
    expect(
      newlyReachedThresholds(1_000_000_000_000, 750_000_000_000, none),
    ).toEqual([75]);
  });
});

const rows = (...entries: Array<[number, string]>): AvailableHoursRow[] =>
  entries.map(([minutesPerWeek, effectiveFrom]) => ({
    personId: "p1",
    minutesPerWeek,
    effectiveFrom,
  }));

describe("available hours in force (TC-20)", () => {
  it("is the latest effective date on or before the day", () => {
    const history = rows([2400, "2026-01-01"], [1200, "2026-06-01"]);
    expect(availableHoursOn(history, "2025-12-31")).toBeNull();
    expect(availableHoursOn(history, "2026-01-01")?.minutesPerWeek).toBe(2400);
    expect(availableHoursOn(history, "2026-05-31")?.minutesPerWeek).toBe(2400);
    expect(availableHoursOn(history, "2026-06-01")?.minutesPerWeek).toBe(1200);
    expect(availableHoursOn([], "2026-06-01")).toBeNull();
  });
});

describe("available minutes over a window (TC-21)", () => {
  it("is one week's minutes for seven days and scales with the window", () => {
    const history = rows([2400, "2026-01-01"]);
    expect(availableMinutes(history, "2026-01-05", "2026-01-11", null)).toEqual(
      { minutes: 2400, coveredDays: 7, totalDays: 7, fellBack: false },
    );
    expect(
      availableMinutes(history, "2026-01-05", "2026-01-18", null)?.minutes,
    ).toBe(4800);
    // Three days: 3 x 2400 / 7 = 1028.57 -> 1029 (rounded once at the end).
    expect(
      availableMinutes(history, "2026-01-05", "2026-01-07", null)?.minutes,
    ).toBe(1029);
  });

  it("switches rate mid-window on the effective date", () => {
    const history = rows([2400, "2025-12-01"], [1200, "2026-01-12"]);
    expect(
      availableMinutes(history, "2026-01-05", "2026-01-18", null)?.minutes,
    ).toBe(3600);
  });

  it("falls back to team capacity only for days no row covers, and says so", () => {
    const history = rows([1200, "2026-01-12"]);
    const result = availableMinutes(history, "2026-01-05", "2026-01-18", 2400);
    expect(result).toMatchObject({
      minutes: 1200 * 1 + 2400 * 1,
      coveredDays: 7,
      totalDays: 14,
      fellBack: true,
    });
  });

  it("is null when neither a row nor a fallback exists, and zero rows can be a real zero", () => {
    expect(availableMinutes([], "2026-01-05", "2026-01-11", null)).toBeNull();
    expect(
      availableMinutes(
        rows([0, "2026-01-01"]),
        "2026-01-05",
        "2026-01-11",
        null,
      )?.minutes,
    ).toBe(0);
  });

  it("handles a single-day window and a year boundary", () => {
    const history = rows([700, "2025-01-01"]);
    expect(
      availableMinutes(history, "2026-01-01", "2026-01-01", null)?.minutes,
    ).toBe(100);
    expect(
      availableMinutes(history, "2025-12-29", "2026-01-04", null)?.minutes,
    ).toBe(700);
  });
});

describe("utilisation ratio", () => {
  it("is logged over available and null without a denominator", () => {
    expect(utilisationRatio(60, 240)).toBe(0.25);
    expect(utilisationRatio(60, 0)).toBeNull();
    expect(utilisationRatio(60, null)).toBeNull();
  });
});
