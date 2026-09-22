import { describe, expect, it } from "vitest";
import { annualCoverMinutes, weeklyCoverMinutes } from "./calendar.js";
import type { ServiceCalendar } from "./types.js";

const CALENDAR_8X5: ServiceCalendar = {
  timezone: "UTC",
  windows: {
    mon: [{ from: 540, to: 1020 }],
    tue: [{ from: 540, to: 1020 }],
    wed: [{ from: 540, to: 1020 }],
    thu: [{ from: 540, to: 1020 }],
    fri: [{ from: 540, to: 1020 }],
  },
  holidays: [],
};

const CALENDAR_24X7: ServiceCalendar = {
  timezone: "UTC",
  windows: {
    sun: [{ from: 0, to: 1440 }],
    mon: [{ from: 0, to: 1440 }],
    tue: [{ from: 0, to: 1440 }],
    wed: [{ from: 0, to: 1440 }],
    thu: [{ from: 0, to: 1440 }],
    fri: [{ from: 0, to: 1440 }],
    sat: [{ from: 0, to: 1440 }],
  },
  holidays: [],
};

describe("coverage preview", () => {
  it("weeklyCoverMinutes sums the wall-clock window spans", () => {
    // Mon–Fri 09:00–17:00 = 5 × 480 = the editor's "40 hours per week".
    expect(weeklyCoverMinutes(CALENDAR_8X5)).toBe(2400);
    expect(weeklyCoverMinutes(CALENDAR_24X7)).toBe(7 * 1440);
  });

  it("weeklyCoverMinutes is zero for a zero-cover calendar", () => {
    expect(
      weeklyCoverMinutes({ timezone: "UTC", windows: {}, holidays: [] }),
    ).toBe(0);
  });

  it("annualCoverMinutes counts every Monday of 2026 on a Monday-only calendar", () => {
    // 2026 has 52 Mondays (Jan 5 first, Dec 28 last); each carries the full
    // 09:00–17:00 window = 480 minutes. Hand-computed, not derived from the
    // function under test.
    const mondayOnly: ServiceCalendar = {
      timezone: "UTC",
      windows: { mon: [{ from: 540, to: 1020 }] },
      holidays: [],
    };
    expect(annualCoverMinutes(mondayOnly, 2026)).toBe(52 * 480);
  });

  it("annualCoverMinutes subtracts a dated holiday that lands on a covered weekday", () => {
    const mondayOnly: ServiceCalendar = {
      timezone: "UTC",
      windows: { mon: [{ from: 540, to: 1020 }] },
      holidays: [{ date: "2026-07-06", name: "Test Monday" }], // a Monday
    };
    expect(annualCoverMinutes(mondayOnly, 2026)).toBe(51 * 480);
  });

  it("annualCoverMinutes is unaffected by DST for a calendar whose windows fall outside the transition days", () => {
    // 2026 has 365 days = 52×7 + 1: Jan 1 is a THURSDAY, so Thursdays occur 53
    // times and every other weekday 52 — Mon–Fri = 261 covered days, × 480
    // nominal minutes each. Both 2026 DST transitions fall on Sundays (Mar 29,
    // Oct 25), outside the Mon–Fri windows, so no window's real elapsed length
    // differs from nominal this year. This calendar is still UTC, so on its
    // own it cannot tell a real non-UTC bug from a coincidence -- the next
    // test uses a real zone whose DST transitions land inside its windows.
    expect(annualCoverMinutes(CALENDAR_8X5, 2026)).toBe(261 * 480);
  });

  it("annualCoverMinutes respects the calendar's own timezone, not the test's -- a real non-UTC, DST-crossing calendar", () => {
    // Europe/London, 24x7: every calendar day is nominally 1440 minutes, but
    // real elapsed time differs on the two 2026 DST days (reusing the same
    // dates and behaviour calendar.test.ts's "coveredMinutesBetween -- DST,
    // Europe/London" suite already establishes per-day): 2026-03-29
    // (spring-forward) has only 23 real covered hours -- the skipped hour is
    // never covered -- and 2026-10-25 (fall-back) has exactly 24 -- the
    // repeated hour counts once, not twice, capped at nominal. So the year is
    // 365 nominal days minus the one hour lost on the spring-forward day, and
    // no addition for the fall-back day: 365 * 1440 - 60.
    const londonAllDay: ServiceCalendar = {
      timezone: "Europe/London",
      windows: {
        sun: [{ from: 0, to: 1440 }],
        mon: [{ from: 0, to: 1440 }],
        tue: [{ from: 0, to: 1440 }],
        wed: [{ from: 0, to: 1440 }],
        thu: [{ from: 0, to: 1440 }],
        fri: [{ from: 0, to: 1440 }],
        sat: [{ from: 0, to: 1440 }],
      },
      holidays: [],
    };
    expect(annualCoverMinutes(londonAllDay, 2026)).toBe(365 * 1440 - 60);
  });

  it("annualCoverMinutes for a 24×7 UTC calendar is the full year, with no DST adjustment", () => {
    // 365 days × 1440 minutes; 2026 is not a leap year. UTC has no DST, so
    // this is the control case the previous test's subtraction is measured
    // against -- the same calendar shape, only the timezone differs.
    expect(annualCoverMinutes(CALENDAR_24X7, 2026)).toBe(365 * 1440);
  });
});
