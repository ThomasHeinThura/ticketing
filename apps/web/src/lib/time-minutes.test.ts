import { describe, expect, it } from "vitest";
import {
  elapsedMinutes,
  formatMinutes,
  isCalendarDate,
  parseMinutes,
  shiftDate,
  weekDays,
  weekStart,
} from "./time-minutes";

describe("parseMinutes", () => {
  it.each([
    ["90", 90],
    ["1:30", 90],
    ["0:45", 45],
    ["1h30", 90],
    ["1h", 60],
    ["2h15m", 135],
    ["1.5h", 90],
    ["1,5h", 90],
    ["0.1h", 6],
    ["45m", 45],
    ["45 min", 45],
    [" 8:00 ", 480],
    ["1440", 1440],
  ])("reads %s as %i whole minutes", (text, expected) => {
    expect(parseMinutes(text)).toBe(expected);
  });

  it.each([
    "",
    "abc",
    "0",
    "-5",
    "1441",
    "1:75",
    "25h",
    "1.5",
    "1.5.5h",
    "9999999999999999",
  ])("refuses %s", (text) => {
    expect(parseMinutes(text)).toBeNull();
  });

  it("always answers an integer", () => {
    for (const text of ["0.1h", "0.7h", "1.33h", "2.999h"]) {
      const value = parseMinutes(text);
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe("formatMinutes", () => {
  it("renders h:mm from integer minutes", () => {
    expect(formatMinutes(0)).toBe("0:00");
    expect(formatMinutes(45)).toBe("0:45");
    expect(formatMinutes(90)).toBe("1:30");
    expect(formatMinutes(1500)).toBe("25:00");
  });
});

describe("dates", () => {
  it("shifts across month edges", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("finds the Monday and the seven days of a week", () => {
    expect(weekStart("2026-10-24")).toBe("2026-10-19");
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(weekDays("2026-10-19")).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
  });
  it("validates calendar dates", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate(20260228)).toBe(false);
  });
  it("counts elapsed whole minutes and never goes negative", () => {
    const start = "2026-10-24T09:00:00.000Z";
    expect(elapsedMinutes(start, Date.parse("2026-10-24T09:47:59.000Z"))).toBe(
      47,
    );
    expect(elapsedMinutes(start, Date.parse("2026-10-24T08:00:00.000Z"))).toBe(
      0,
    );
  });
});
