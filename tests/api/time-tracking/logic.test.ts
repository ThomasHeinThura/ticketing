import { describe, expect, it } from "vitest";
import {
  budgetThreshold,
  checkEntryDate,
  costMinor,
  isCalendarDate,
  nextLocalMidnight,
  resolveTimeZone,
  selectEffectiveRate,
  shiftDate,
  splitAtMidnight,
  stopTimer,
  sumMinutes,
  TIMER_CAP_MINUTES,
  timerExpired,
  weekStart,
  zonedDate,
} from "../../../apps/api/src/time-tracking/logic";

const at = (iso: string) => Date.parse(iso);

describe("timezone chain (owner decision D4)", () => {
  it("prefers the profile zone, then the next zone, then UTC, skipping invalid names", () => {
    expect(resolveTimeZone("Asia/Yangon", "Europe/Paris")).toBe("Asia/Yangon");
    expect(resolveTimeZone(null, "Europe/Paris")).toBe("Europe/Paris");
    expect(resolveTimeZone("Not/AZone", "Europe/Paris")).toBe("Europe/Paris");
    expect(resolveTimeZone(undefined, null)).toBe("UTC");
    expect(resolveTimeZone("Nope", "Also nope")).toBe("UTC");
  });
});

describe("midnight split", () => {
  it("cuts a span that crosses UTC midnight into two dated entries that sum to the span", () => {
    const segments = splitAtMidnight(
      at("2026-10-21T22:30:00Z"),
      at("2026-10-22T01:15:00Z"),
      "UTC",
    );
    expect(segments.map((s) => [s.date, s.minutes])).toEqual([
      ["2026-10-21", 90],
      ["2026-10-22", 75],
    ]);
  });

  it("cuts at the profile timezone's midnight, not UTC's", () => {
    // 2026-10-21T20:00Z is 2026-10-22 02:30 in Yangon (UTC+6:30): midnight there is 17:30Z.
    const segments = splitAtMidnight(
      at("2026-10-21T17:00:00Z"),
      at("2026-10-21T19:00:00Z"),
      "Asia/Yangon",
    );
    expect(segments.map((s) => [s.date, s.minutes])).toEqual([
      ["2026-10-21", 30],
      ["2026-10-22", 90],
    ]);
  });

  it("keeps a span inside one local day as one entry", () => {
    const segments = splitAtMidnight(
      at("2026-10-21T09:00:00Z"),
      at("2026-10-21T10:00:00Z"),
      "UTC",
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.minutes).toBe(60);
  });

  it("floors both bounds to whole minutes so every segment is an integer", () => {
    const segments = splitAtMidnight(
      at("2026-10-21T23:59:30Z"),
      at("2026-10-22T00:00:50Z"),
      "UTC",
    );
    expect(segments.every((s) => Number.isInteger(s.minutes))).toBe(true);
    expect(sumMinutes(segments.map((s) => s.minutes))).toBe(1);
  });

  it("handles a spring-forward day (23 hours long) in a DST zone", () => {
    // America/New_York springs forward on 2026-03-08: local midnight to midnight is 23 h.
    const start = at("2026-03-08T05:00:00Z"); // 00:00 EST
    const end = at("2026-03-09T04:00:00Z"); // 00:00 EDT
    const segments = splitAtMidnight(start, end, "America/New_York");
    expect(segments).toHaveLength(1);
    expect(segments[0]?.minutes).toBe(23 * 60);
    expect(segments[0]?.date).toBe("2026-03-08");
  });

  it("nextLocalMidnight is the first minute of the next local date", () => {
    const next = nextLocalMidnight(at("2026-10-21T10:00:00Z"), "UTC");
    expect(new Date(next).toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(zonedDate(next - 60_000, "UTC")).toBe("2026-10-21");
  });
});

describe("timer cap and rounding", () => {
  it("rounds elapsed time to the nearest minute, at least one", () => {
    const start = at("2026-10-21T09:00:10Z");
    expect(stopTimer(start, start + 20_000).minutes).toBe(1);
    expect(stopTimer(start, at("2026-10-21T09:10:40Z")).minutes).toBe(11);
  });

  it("caps at 12 hours and says so", () => {
    const start = at("2026-10-21T09:00:00Z");
    const stopped = stopTimer(start, start + 30 * 3_600_000);
    expect(stopped.capped).toBe(true);
    expect(stopped.minutes).toBe(TIMER_CAP_MINUTES);
    expect(stopped.endMs).toBe(start + 12 * 3_600_000);
  });

  it("is not capped exactly at the cap", () => {
    const start = at("2026-10-21T09:00:00Z");
    expect(stopTimer(start, start + 12 * 3_600_000).capped).toBe(false);
  });

  it("timerExpired is true from the cap on", () => {
    const start = at("2026-10-21T09:00:00Z");
    expect(timerExpired(start, start + 12 * 3_600_000 - 1)).toBe(false);
    expect(timerExpired(start, start + 12 * 3_600_000)).toBe(true);
  });
});

describe("effective-rate selection (TC-8..TC-10)", () => {
  const rates = [
    {
      projectId: null,
      effectiveFrom: "2026-01-01",
      rateMinor: 5000,
      currency: "EUR",
    },
    {
      projectId: null,
      effectiveFrom: "2026-06-01",
      rateMinor: 6000,
      currency: "EUR",
    },
    {
      projectId: "p1",
      effectiveFrom: "2026-03-01",
      rateMinor: 9000,
      currency: "USD",
    },
  ];

  it("uses the rate in force on the entry's date, not today's", () => {
    expect(selectEffectiveRate(rates, "p2", "2026-05-31")?.rateMinor).toBe(
      5000,
    );
    expect(selectEffectiveRate(rates, "p2", "2026-06-01")?.rateMinor).toBe(
      6000,
    );
  });

  it("prefers a project-specific rate over the default once it is in force", () => {
    expect(selectEffectiveRate(rates, "p1", "2026-02-28")?.rateMinor).toBe(
      5000,
    );
    expect(selectEffectiveRate(rates, "p1", "2026-03-01")?.rateMinor).toBe(
      9000,
    );
    expect(selectEffectiveRate(rates, "p1", "2026-07-01")?.currency).toBe(
      "USD",
    );
  });

  it("returns null (unpriced) before any rate starts", () => {
    expect(selectEffectiveRate(rates, "p2", "2025-12-31")).toBeNull();
    expect(selectEffectiveRate([], "p1", "2026-07-01")).toBeNull();
  });

  it("splitting across an effective_from boundary prices each day separately", () => {
    const days = ["2026-05-31", "2026-06-01"].map(
      (date) => selectEffectiveRate(rates, "p2", date)?.rateMinor,
    );
    expect(days).toEqual([5000, 6000]);
  });
});

describe("integer cost arithmetic", () => {
  it("never uses a float hour", () => {
    expect(costMinor(60, 6000)).toBe(6000);
    expect(costMinor(90, 6000)).toBe(9000);
    expect(costMinor(1, 6000)).toBe(100);
    expect(costMinor(7, 5000)).toBe(583); // 583.33 rounds down
    expect(costMinor(8, 5000)).toBe(667); // 666.67 rounds up
    expect(Number.isInteger(costMinor(13, 4321))).toBe(true);
  });

  it("unpriced entries have no cost", () => {
    expect(costMinor(60, null)).toBeNull();
  });

  it("sumMinutes refuses a non-integer", () => {
    expect(sumMinutes([30, 45, 15])).toBe(90);
    expect(() => sumMinutes([30, 0.5])).toThrow();
  });
});

describe("backdating window (TC-4)", () => {
  const base = { today: "2026-10-24", limitDays: 30, canLogBackdated: false };

  it("allows today and the whole window", () => {
    expect(checkEntryDate({ ...base, date: "2026-10-24" })).toBeNull();
    expect(checkEntryDate({ ...base, date: "2026-09-24" })).toBeNull();
  });

  it("refuses a date older than the limit without the capability", () => {
    expect(checkEntryDate({ ...base, date: "2026-09-23" })).toBe("too_old");
  });

  it("allows an old date with time_entry:log_backdated", () => {
    expect(
      checkEntryDate({ ...base, date: "2025-01-01", canLogBackdated: true }),
    ).toBeNull();
  });

  it("refuses the future even with the capability", () => {
    expect(checkEntryDate({ ...base, date: "2026-10-25" })).toBe("future");
    expect(
      checkEntryDate({ ...base, date: "2026-10-25", canLogBackdated: true }),
    ).toBe("future");
  });

  it("a zero limit means same day only", () => {
    expect(checkEntryDate({ ...base, limitDays: 0, date: "2026-10-23" })).toBe(
      "too_old",
    );
  });
});

describe("dates", () => {
  it("validates calendar dates", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("26-02-28")).toBe(false);
  });

  it("shifts across month and year edges", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("finds the Monday of a week", () => {
    expect(weekStart("2026-10-24")).toBe("2026-10-19"); // Saturday
    expect(weekStart("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday
  });
});

describe("budget thresholds (TC-18)", () => {
  it("reports the highest threshold reached", () => {
    expect(budgetThreshold(1000, 749)).toBeNull();
    expect(budgetThreshold(1000, 750)).toBe(75);
    expect(budgetThreshold(1000, 899)).toBe(75);
    expect(budgetThreshold(1000, 900)).toBe(90);
    expect(budgetThreshold(0, 10)).toBeNull();
  });
});
