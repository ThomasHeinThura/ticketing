import { describe, expect, it } from "vitest";
import {
  calendarHasCover,
  compareLocalDate,
  coveredMinutesBetween,
  expandRecurringHoliday,
  formatLocalDate,
  instantToLocalDateTime,
  isHoliday,
  nextWindowOpening,
  validateCalendar,
  weekdayOf,
  zonedDateTimeToInstant,
} from "./calendar.js";
import type { LocalDate, ServiceCalendar } from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures — the four presets `service-calendars.md` names, plus a UTC calendar for
// tests that must isolate the arithmetic from any timezone concern at all.
// ---------------------------------------------------------------------------

const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const WEEKDAYS_ONLY = ["mon", "tue", "wed", "thu", "fri"] as const;

function fullDayEveryDay(): ServiceCalendar["windows"] {
  const windows: ServiceCalendar["windows"] = {};
  for (const day of ALL_DAYS) windows[day] = [{ from: 0, to: 1440 }];
  return windows;
}

function businessHours(from: number, to: number): ServiceCalendar["windows"] {
  const windows: ServiceCalendar["windows"] = {};
  for (const day of WEEKDAYS_ONLY) windows[day] = [{ from, to }];
  return windows;
}

/** 24×7 — every day, 00:00–24:00. No holidays. */
const PRESET_24X7: ServiceCalendar = {
  timezone: "UTC",
  windows: fullDayEveryDay(),
  holidays: [],
};

/** 8×5 business hours — Mon–Fri 09:00–17:00. */
const PRESET_8X5: ServiceCalendar = {
  timezone: "UTC",
  windows: businessHours(540, 1020),
  holidays: [],
};

/** 12×5 extended — Mon–Fri 07:00–19:00. */
const PRESET_12X5: ServiceCalendar = {
  timezone: "UTC",
  windows: businessHours(420, 1140),
  holidays: [],
};

/**
 * "Follow the sun" — the spec names it as "multiple windows per day across regions"
 * without giving exact hours (an open gap this prep did not need to close: the
 * numbers below are a representative three-shift fixture, not a literal shipped
 * default). Three contiguous 8h windows covering the full day, which is the shape
 * that matters for testing: multiple windows summing correctly, not a single block.
 */
const PRESET_FOLLOW_THE_SUN: ServiceCalendar = {
  timezone: "UTC",
  windows: (() => {
    const windows: ServiceCalendar["windows"] = {};
    for (const day of ALL_DAYS) {
      windows[day] = [
        { from: 0, to: 480 },
        { from: 480, to: 960 },
        { from: 960, to: 1440 },
      ];
    }
    return windows;
  })(),
  holidays: [],
};

/** The spec's own Wednesday lunch-break example, verbatim (`service-calendars.md`). */
const CALENDAR_WITH_LUNCH_BREAK: ServiceCalendar = {
  timezone: "UTC",
  windows: {
    mon: [{ from: 540, to: 1020 }],
    tue: [{ from: 540, to: 1020 }],
    wed: [
      { from: 540, to: 720 }, // 09:00–12:00
      { from: 780, to: 1020 }, // 13:00–17:00
    ],
    sat: [],
    sun: [],
  },
  holidays: [],
};

const ZERO_COVER_CALENDAR: ServiceCalendar = {
  timezone: "UTC",
  windows: {},
  holidays: [],
};

function utc(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min));
}

// ---------------------------------------------------------------------------
// Local-date helpers.
// ---------------------------------------------------------------------------

describe("weekdayOf", () => {
  it("returns the correct weekday for known dates", () => {
    expect(weekdayOf({ year: 2026, month: 6, day: 1 })).toBe("mon"); // 2026-06-01 is a Monday
    expect(weekdayOf({ year: 2026, month: 6, day: 6 })).toBe("sat");
    expect(weekdayOf({ year: 2026, month: 6, day: 7 })).toBe("sun");
    expect(weekdayOf({ year: 2026, month: 12, day: 25 })).toBe("fri"); // 2026-12-25 is a Friday
  });
});

describe("compareLocalDate", () => {
  it("orders by year, then month, then day", () => {
    expect(
      compareLocalDate(
        { year: 2026, month: 1, day: 1 },
        { year: 2026, month: 1, day: 1 },
      ),
    ).toBe(0);
    expect(
      compareLocalDate(
        { year: 2025, month: 12, day: 31 },
        { year: 2026, month: 1, day: 1 },
      ),
    ).toBe(-1);
    expect(
      compareLocalDate(
        { year: 2026, month: 2, day: 1 },
        { year: 2026, month: 1, day: 31 },
      ),
    ).toBe(1);
  });
});

describe("formatLocalDate", () => {
  it("zero-pads month and day", () => {
    expect(formatLocalDate({ year: 2026, month: 1, day: 5 })).toBe(
      "2026-01-05",
    );
  });
});

describe("instantToLocalDateTime / zonedDateTimeToInstant round trip", () => {
  it("round-trips in UTC", () => {
    const instant = utc(2026, 6, 15, 14, 30);
    const local = instantToLocalDateTime("UTC", instant);
    expect(local).toEqual({
      year: 2026,
      month: 6,
      day: 15,
      minuteOfDay: 14 * 60 + 30,
    });
    const back = zonedDateTimeToInstant(
      "UTC",
      { year: 2026, month: 6, day: 15 },
      14 * 60 + 30,
    );
    expect(back.getTime()).toBe(instant.getTime());
  });

  it("round-trips in a fixed non-integer offset zone (Asia/Kolkata, UTC+5:30, no DST)", () => {
    const date: LocalDate = { year: 2026, month: 6, day: 15 };
    const instant = zonedDateTimeToInstant("Asia/Kolkata", date, 9 * 60); // 09:00 IST
    // 09:00 IST == 03:30 UTC
    expect(instant.getTime()).toBe(utc(2026, 6, 15, 3, 30).getTime());
    const local = instantToLocalDateTime("Asia/Kolkata", instant);
    expect(local).toEqual({ ...date, minuteOfDay: 9 * 60 });
  });
});

// ---------------------------------------------------------------------------
// Holidays.
// ---------------------------------------------------------------------------

describe("expandRecurringHoliday", () => {
  it("expands to the given year's concrete date", () => {
    const rule = {
      recurs: "annually" as const,
      month: 12,
      day: 25,
      name: "Christmas Day",
    };
    expect(expandRecurringHoliday(rule, 2026)).toEqual({
      year: 2026,
      month: 12,
      day: 25,
    });
    expect(expandRecurringHoliday(rule, 2027)).toEqual({
      year: 2027,
      month: 12,
      day: 25,
    });
  });
});

describe("isHoliday", () => {
  const calendar: ServiceCalendar = {
    timezone: "UTC",
    windows: {},
    holidays: [
      { date: "2026-01-01", name: "New Year's Day" },
      { from: "2026-12-27", to: "2026-12-31", name: "Company shutdown" },
      { recurs: "annually", month: 12, day: 25, name: "Christmas Day" },
    ],
  };

  it("matches a dated holiday", () => {
    expect(isHoliday(calendar, { year: 2026, month: 1, day: 1 })).toBe(true);
  });

  it("matches inside a ranged holiday, inclusive of both ends", () => {
    expect(isHoliday(calendar, { year: 2026, month: 12, day: 27 })).toBe(true);
    expect(isHoliday(calendar, { year: 2026, month: 12, day: 29 })).toBe(true);
    expect(isHoliday(calendar, { year: 2026, month: 12, day: 31 })).toBe(true);
    expect(isHoliday(calendar, { year: 2026, month: 12, day: 26 })).toBe(false);
    expect(isHoliday(calendar, { year: 2027, month: 1, day: 1 })).toBe(false);
  });

  it("expands a recurring holiday in any year", () => {
    expect(isHoliday(calendar, { year: 2026, month: 12, day: 25 })).toBe(true);
    expect(isHoliday(calendar, { year: 2031, month: 12, day: 25 })).toBe(true);
  });

  it("is false for an ordinary date", () => {
    expect(isHoliday(calendar, { year: 2026, month: 6, day: 15 })).toBe(false);
  });

  it("merges overlapping holiday ranges as a union — a date in either is a holiday", () => {
    const overlapping: ServiceCalendar = {
      timezone: "UTC",
      windows: {},
      holidays: [
        { from: "2026-07-01", to: "2026-07-10" },
        { from: "2026-07-05", to: "2026-07-15" },
      ],
    };
    for (const day of [1, 5, 10, 12, 15]) {
      expect(isHoliday(overlapping, { year: 2026, month: 7, day })).toBe(true);
    }
    expect(isHoliday(overlapping, { year: 2026, month: 7, day: 16 })).toBe(
      false,
    );
  });

  it("has no effect when the holiday falls on a day with no windows anyway", () => {
    // Not a distinct code path — isHoliday just answers "is this date a holiday", and
    // coveredMinutesBetween already contributes zero for a day with no windows. This
    // pins that a holiday flag on such a day is still correctly reported true, so a
    // caller that only checks isHoliday (rather than windows) is not misled.
    const weekendHoliday: ServiceCalendar = {
      timezone: "UTC",
      windows: businessHours(540, 1020),
      holidays: [
        { date: "2026-06-06", name: "Saturday, coincidentally a holiday" },
      ], // a Saturday
    };
    expect(isHoliday(weekendHoliday, { year: 2026, month: 6, day: 6 })).toBe(
      true,
    );
    expect(
      coveredMinutesBetween(
        weekendHoliday,
        utc(2026, 6, 6, 0, 0),
        utc(2026, 6, 7, 0, 0),
      ),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Validation — CAL-2, CAL-3, and the zero-length-window / reversed-holiday-range edges.
// ---------------------------------------------------------------------------

describe("validateCalendar", () => {
  it("accepts a well-formed calendar", () => {
    expect(validateCalendar(PRESET_8X5)).toEqual({ valid: true, errors: [] });
  });

  it("accepts a window ending exactly at 1440 (midnight at day end, CAL-3)", () => {
    expect(validateCalendar(PRESET_24X7)).toEqual({ valid: true, errors: [] });
  });

  it("rejects overlapping windows within a day (CAL-2)", () => {
    const calendar: ServiceCalendar = {
      timezone: "UTC",
      windows: {
        mon: [
          { from: 540, to: 1020 },
          { from: 900, to: 1080 },
        ],
      },
      holidays: [],
    };
    const result = validateCalendar(calendar);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("overlaps"))).toBe(true);
  });

  it("rejects a window of zero length", () => {
    const calendar: ServiceCalendar = {
      timezone: "UTC",
      windows: { mon: [{ from: 540, to: 540 }] },
      holidays: [],
    };
    expect(validateCalendar(calendar).valid).toBe(false);
  });

  it("rejects a window that spans past midnight (to > 1440)", () => {
    const calendar: ServiceCalendar = {
      timezone: "UTC",
      windows: { mon: [{ from: 1380, to: 1500 }] },
      holidays: [],
    };
    expect(validateCalendar(calendar).valid).toBe(false);
  });

  it("rejects a window starting before midnight (from < 0)", () => {
    const calendar: ServiceCalendar = {
      timezone: "UTC",
      windows: { mon: [{ from: -60, to: 60 }] },
      holidays: [],
    };
    expect(validateCalendar(calendar).valid).toBe(false);
  });

  it("rejects a holiday range that ends before it starts", () => {
    const calendar: ServiceCalendar = {
      timezone: "UTC",
      windows: {},
      holidays: [{ from: "2026-12-31", to: "2026-12-01" }],
    };
    expect(validateCalendar(calendar).valid).toBe(false);
  });

  it("accepts a zero-cover calendar as a shape (CAL-5 is allowed, only warned about elsewhere)", () => {
    expect(validateCalendar(ZERO_COVER_CALENDAR)).toEqual({
      valid: true,
      errors: [],
    });
  });
});

describe("calendarHasCover", () => {
  it("is true for every named preset", () => {
    expect(calendarHasCover(PRESET_24X7)).toBe(true);
    expect(calendarHasCover(PRESET_8X5)).toBe(true);
    expect(calendarHasCover(PRESET_12X5)).toBe(true);
    expect(calendarHasCover(PRESET_FOLLOW_THE_SUN)).toBe(true);
  });

  it("is false for a calendar with no working hours at all", () => {
    expect(calendarHasCover(ZERO_COVER_CALENDAR)).toBe(false);
  });

  it("is false for a calendar whose only windows are zero-length", () => {
    const calendar: ServiceCalendar = {
      timezone: "UTC",
      windows: { mon: [{ from: 540, to: 540 }] },
      holidays: [],
    };
    expect(calendarHasCover(calendar)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// coveredMinutesBetween — the core.
// ---------------------------------------------------------------------------

describe("coveredMinutesBetween — presets, one full week", () => {
  // 2026-06-01 is a Monday; spans exactly seven days to the following Monday.
  const weekStart = utc(2026, 6, 1);
  const weekEnd = utc(2026, 6, 8);

  it("24×7 — every hour of the week", () => {
    expect(coveredMinutesBetween(PRESET_24X7, weekStart, weekEnd)).toBe(
      7 * 1440,
    );
  });

  it("8×5 business hours — 5 × 8h", () => {
    expect(coveredMinutesBetween(PRESET_8X5, weekStart, weekEnd)).toBe(
      5 * 8 * 60,
    );
  });

  it("12×5 extended — 5 × 12h", () => {
    expect(coveredMinutesBetween(PRESET_12X5, weekStart, weekEnd)).toBe(
      5 * 12 * 60,
    );
  });

  it("follow-the-sun — three windows a day sum to the full day, every day", () => {
    expect(
      coveredMinutesBetween(PRESET_FOLLOW_THE_SUN, weekStart, weekEnd),
    ).toBe(7 * 1440);
  });
});

describe("coveredMinutesBetween — split windows within a day (lunch break)", () => {
  it("counts a full Wednesday as 7h, excluding the lunch hour", () => {
    const minutes = coveredMinutesBetween(
      CALENDAR_WITH_LUNCH_BREAK,
      utc(2026, 6, 3, 0, 0),
      utc(2026, 6, 4, 0, 0),
    );
    expect(minutes).toBe(7 * 60);
  });

  it("excludes the lunch gap even when the query spans across it", () => {
    // 2026-06-03 is a Wednesday. 11:00 to 13:30 crosses the 12:00-13:00 gap.
    const minutes = coveredMinutesBetween(
      CALENDAR_WITH_LUNCH_BREAK,
      utc(2026, 6, 3, 11, 0),
      utc(2026, 6, 3, 13, 30),
    );
    expect(minutes).toBe(60 + 30); // 11:00-12:00, then 13:00-13:30
  });

  it("counts zero for a query entirely inside the lunch gap", () => {
    const minutes = coveredMinutesBetween(
      CALENDAR_WITH_LUNCH_BREAK,
      utc(2026, 6, 3, 12, 15),
      utc(2026, 6, 3, 12, 45),
    );
    expect(minutes).toBe(0);
  });
});

describe("coveredMinutesBetween — weekend rollover", () => {
  it("a span crossing a weekend counts only the business days either side", () => {
    // 2026-06-05 is a Friday. Friday 00:00 to the following Wednesday 00:00 =
    // Fri(full) + Sat/Sun(0) + Mon(full) + Tue(full).
    const minutes = coveredMinutesBetween(
      PRESET_8X5,
      utc(2026, 6, 5, 0, 0),
      utc(2026, 6, 10, 0, 0),
    );
    expect(minutes).toBe(3 * 8 * 60);
  });

  it("a span that starts mid-Saturday and ends mid-Monday counts only Monday's partial morning", () => {
    // 2026-06-06 is a Saturday. Saturday 10:00 to Monday 10:00 -> only Monday
    // 09:00-10:00 is covered (1h); the calendar never opens on Sat/Sun at all.
    const minutes = coveredMinutesBetween(
      PRESET_8X5,
      utc(2026, 6, 6, 10, 0),
      utc(2026, 6, 8, 10, 0),
    );
    expect(minutes).toBe(60);
  });
});

describe("coveredMinutesBetween — holidays", () => {
  const calendarWithMondayHoliday: ServiceCalendar = {
    ...PRESET_8X5,
    holidays: [{ date: "2026-06-01" }], // the Monday of the test week
  };

  it("a span crossing a single holiday excludes it", () => {
    // Monday (holiday) + Tuesday + Wednesday.
    const minutes = coveredMinutesBetween(
      calendarWithMondayHoliday,
      utc(2026, 6, 1, 0, 0),
      utc(2026, 6, 4, 0, 0),
    );
    expect(minutes).toBe(2 * 8 * 60);
  });

  it("a span crossing consecutive holidays excludes both", () => {
    const calendar: ServiceCalendar = {
      ...PRESET_8X5,
      holidays: [{ from: "2026-06-01", to: "2026-06-02" }], // Monday and Tuesday
    };
    const minutes = coveredMinutesBetween(
      calendar,
      utc(2026, 6, 1, 0, 0),
      utc(2026, 6, 4, 0, 0),
    );
    expect(minutes).toBe(1 * 8 * 60); // only Wednesday
  });

  it("a span crossing both a weekend and a holiday excludes both", () => {
    // 2026-06-05 is Friday, holiday. Then Sat/Sun weekend, then Monday (normal).
    const calendar: ServiceCalendar = {
      ...PRESET_8X5,
      holidays: [{ date: "2026-06-05" }],
    };
    const minutes = coveredMinutesBetween(
      calendar,
      utc(2026, 6, 5, 0, 0),
      utc(2026, 6, 9, 0, 0),
    );
    expect(minutes).toBe(1 * 8 * 60); // only Monday 08-06
  });
});

describe("coveredMinutesBetween — zero-cover and zero-length edges", () => {
  it("a calendar with no working hours at all always covers zero minutes, any span length", () => {
    expect(
      coveredMinutesBetween(
        ZERO_COVER_CALENDAR,
        utc(2026, 1, 1),
        utc(2027, 1, 1),
      ),
    ).toBe(0);
  });

  it("a zero-length interval covers zero minutes", () => {
    const instant = utc(2026, 6, 1, 12, 0);
    expect(coveredMinutesBetween(PRESET_24X7, instant, instant)).toBe(0);
  });

  it("a reversed interval (to before from) covers zero minutes", () => {
    expect(
      coveredMinutesBetween(PRESET_24X7, utc(2026, 6, 2), utc(2026, 6, 1)),
    ).toBe(0);
  });
});

describe("coveredMinutesBetween — instants exactly on a window boundary", () => {
  it("from exactly at window open and to exactly at window close counts the full nominal duration", () => {
    const minutes = coveredMinutesBetween(
      PRESET_8X5,
      utc(2026, 6, 1, 9, 0),
      utc(2026, 6, 1, 17, 0),
    );
    expect(minutes).toBe(8 * 60);
  });

  it("from exactly at window close counts nothing after it", () => {
    const minutes = coveredMinutesBetween(
      PRESET_8X5,
      utc(2026, 6, 1, 17, 0),
      utc(2026, 6, 1, 18, 0),
    );
    expect(minutes).toBe(0);
  });

  it("to exactly at window open counts nothing before it", () => {
    const minutes = coveredMinutesBetween(
      PRESET_8X5,
      utc(2026, 6, 1, 8, 0),
      utc(2026, 6, 1, 9, 0),
    );
    expect(minutes).toBe(0);
  });

  it("a window ending at 24:00 — to exactly at the following local midnight includes the full day, none of the next", () => {
    const minutes = coveredMinutesBetween(
      PRESET_24X7,
      utc(2026, 6, 1, 0, 0),
      utc(2026, 6, 2, 0, 0),
    );
    expect(minutes).toBe(1440);
  });

  it("a window ending at 24:00 — the last hour of the day is covered", () => {
    const minutes = coveredMinutesBetween(
      PRESET_24X7,
      utc(2026, 6, 1, 23, 0),
      utc(2026, 6, 2, 0, 0),
    );
    expect(minutes).toBe(60);
  });
});

describe("coveredMinutesBetween — year boundary", () => {
  it("a 24×7 span crossing New Year's Eve into New Year's Day counts continuously", () => {
    const minutes = coveredMinutesBetween(
      PRESET_24X7,
      utc(2026, 12, 31, 22, 0),
      utc(2027, 1, 1, 2, 0),
    );
    expect(minutes).toBe(4 * 60);
  });
});

describe("coveredMinutesBetween — DST, Europe/London", () => {
  const calendar24x7: ServiceCalendar = {
    timezone: "Europe/London",
    windows: fullDayEveryDay(),
    holidays: [],
  };

  // Day boundaries must be the zone's own local midnights, via zonedDateTimeToInstant —
  // a UTC-midnight-to-UTC-midnight span is *not* the same 24h window once the zone's
  // offset is non-zero (it drifts by exactly the offset change across the query), which
  // would silently test the wrong span. This is exactly the kind of boundary mistake an
  // implementer reaches for first; pinned here so it is not rediscovered by a failing
  // test with a confusing diff.
  const londonMidnight = (y: number, m: number, d: number) =>
    zonedDateTimeToInstant("Europe/London", { year: y, month: m, day: d }, 0);

  it("spring-forward day (2026-03-29) has only 23 covered hours — the skipped hour is never covered", () => {
    const minutes = coveredMinutesBetween(
      calendar24x7,
      londonMidnight(2026, 3, 29),
      londonMidnight(2026, 3, 30),
    );
    expect(minutes).toBe(23 * 60);
  });

  it("autumn fall-back day (2026-10-25) has exactly 24 covered hours — the repeated hour is counted once, not twice", () => {
    const minutes = coveredMinutesBetween(
      calendar24x7,
      londonMidnight(2026, 10, 25),
      londonMidnight(2026, 10, 26),
    );
    expect(minutes).toBe(24 * 60);
  });

  it("a full week containing the spring-forward day is 6 normal days plus one 23h day", () => {
    const minutes = coveredMinutesBetween(
      calendar24x7,
      londonMidnight(2026, 3, 23),
      londonMidnight(2026, 3, 30),
    );
    expect(minutes).toBe(6 * 1440 + 23 * 60);
  });

  it("an 8×5 business week containing the (Sunday) transition is unaffected — DST falls outside business hours", () => {
    const calendar85: ServiceCalendar = {
      timezone: "Europe/London",
      windows: businessHours(540, 1020),
      holidays: [],
    };
    // 2026-03-23 is a Monday; the week ending 2026-03-30 contains the Sun 2026-03-29 transition.
    const minutes = coveredMinutesBetween(
      calendar85,
      londonMidnight(2026, 3, 23),
      londonMidnight(2026, 3, 30),
    );
    expect(minutes).toBe(5 * 8 * 60);
  });
});

describe("coveredMinutesBetween — DST, America/New_York", () => {
  const calendar24x7: ServiceCalendar = {
    timezone: "America/New_York",
    windows: fullDayEveryDay(),
    holidays: [],
  };
  const nyMidnight = (y: number, m: number, d: number) =>
    zonedDateTimeToInstant(
      "America/New_York",
      { year: y, month: m, day: d },
      0,
    );

  it("spring-forward day (2026-03-08) has only 23 covered hours", () => {
    const minutes = coveredMinutesBetween(
      calendar24x7,
      nyMidnight(2026, 3, 8),
      nyMidnight(2026, 3, 9),
    );
    expect(minutes).toBe(23 * 60);
  });

  it("autumn fall-back day (2026-11-01) has exactly 24 covered hours, not 25", () => {
    const minutes = coveredMinutesBetween(
      calendar24x7,
      nyMidnight(2026, 11, 1),
      nyMidnight(2026, 11, 2),
    );
    expect(minutes).toBe(24 * 60);
  });

  it("a window fully containing the skipped hour loses exactly that hour", () => {
    // NY spring-forward 2026: 02:00 EST jumps to 03:00 EDT. A 01:00-04:00 window
    // nominally spans 3h but only 2h of real time elapse.
    const calendar: ServiceCalendar = {
      timezone: "America/New_York",
      windows: { sun: [{ from: 60, to: 240 }] },
      holidays: [],
    };
    const minutes = coveredMinutesBetween(
      calendar,
      utc(2026, 3, 8, 0, 0),
      utc(2026, 3, 9, 0, 0),
    );
    expect(minutes).toBe(120);
  });

  it("a window fully containing the repeated hour is capped at its nominal duration", () => {
    // NY fall-back 2026: 01:00-02:00 EDT repeats as 01:00-02:00 EST. A 00:00-03:00
    // window nominally spans 3h and must stay 3h, not the 4h that really elapse.
    const calendar: ServiceCalendar = {
      timezone: "America/New_York",
      windows: { sun: [{ from: 0, to: 180 }] },
      holidays: [],
    };
    const minutes = coveredMinutesBetween(
      calendar,
      utc(2026, 11, 1, 0, 0),
      utc(2026, 11, 2, 0, 0),
    );
    expect(minutes).toBe(180);
  });
});

// ---------------------------------------------------------------------------
// nextWindowOpening.
// ---------------------------------------------------------------------------

describe("nextWindowOpening", () => {
  it("returns the same instant when already inside a window", () => {
    const instant = utc(2026, 6, 1, 12, 0); // Monday noon, inside 09:00-17:00
    expect(nextWindowOpening(PRESET_8X5, instant)).toEqual(instant);
  });

  it("finds the same day's opening when called before it", () => {
    const instant = utc(2026, 6, 1, 7, 0); // Monday 07:00, before 09:00 open
    expect(nextWindowOpening(PRESET_8X5, instant)).toEqual(
      utc(2026, 6, 1, 9, 0),
    );
  });

  it("rolls over the weekend to the following Monday", () => {
    const instant = utc(2026, 6, 6, 10, 0); // Saturday
    expect(nextWindowOpening(PRESET_8X5, instant)).toEqual(
      utc(2026, 6, 8, 9, 0),
    );
  });

  it("does not roll to Saturday when called after Friday's close", () => {
    const instant = utc(2026, 6, 5, 18, 0); // Friday, after 17:00 close
    expect(nextWindowOpening(PRESET_8X5, instant)).toEqual(
      utc(2026, 6, 8, 9, 0),
    );
  });

  it("skips a holiday that would otherwise be a working day", () => {
    const calendar: ServiceCalendar = {
      ...PRESET_8X5,
      holidays: [{ date: "2026-06-01" }],
    }; // Monday
    const instant = utc(2026, 5, 31, 12, 0); // Sunday
    expect(nextWindowOpening(calendar, instant)).toEqual(utc(2026, 6, 2, 9, 0)); // Tuesday
  });

  it("skips consecutive holidays", () => {
    const calendar: ServiceCalendar = {
      ...PRESET_8X5,
      holidays: [{ from: "2026-06-01", to: "2026-06-02" }],
    };
    const instant = utc(2026, 5, 31, 12, 0); // Sunday
    expect(nextWindowOpening(calendar, instant)).toEqual(utc(2026, 6, 3, 9, 0)); // Wednesday
  });

  it("returns null for a calendar with no working hours at all", () => {
    expect(
      nextWindowOpening(ZERO_COVER_CALENDAR, utc(2026, 6, 1, 12, 0)),
    ).toBeNull();
  });
});
