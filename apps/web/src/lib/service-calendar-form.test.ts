import { describe, expect, it } from "vitest";
import {
  copyCalendarWindows,
  emptyCalendarWindows,
  formatClockTime,
  parseCalendarEditorSearch,
  parseClockTime,
  weeklyCoverHours,
} from "./service-calendar-form";

describe("service calendar editor helpers", () => {
  it("CAL-3: formats and parses minute boundaries including end-of-day", () => {
    expect(formatClockTime(0)).toBe("00:00");
    expect(formatClockTime(540)).toBe("09:00");
    expect(formatClockTime(1440)).toBe("24:00");
    expect(parseClockTime("09:30", false)).toBe(570);
    expect(parseClockTime("24:00", true)).toBe(1440);
    expect(parseClockTime("24:00", false)).toBeNull();
    expect(parseClockTime("25:00", true)).toBeNull();
    expect(parseClockTime("09:60", false)).toBeNull();
  });

  it("CAL-3: creates all weekday buckets and copies absent days as empty", () => {
    const empty = emptyCalendarWindows();
    expect(Object.values(empty).every((windows) => windows.length === 0)).toBe(
      true,
    );
    expect(copyCalendarWindows({ mon: [{ from: 540, to: 1020 }] })).toEqual({
      ...empty,
      mon: [{ from: 540, to: 1020 }],
    });
  });

  it("keeps the preview year in a valid URL search state", () => {
    expect(parseCalendarEditorSearch({ year: "2026" })).toEqual({
      year: 2026,
    });
    expect(parseCalendarEditorSearch({ year: "0" }).year).toBe(
      new Date().getFullYear(),
    );
    expect(parseCalendarEditorSearch({ year: "not-a-year" }).year).toBe(
      new Date().getFullYear(),
    );
  });

  it("formats preview minutes as hours without rounding away fractional minutes", () => {
    expect(weeklyCoverHours(2400)).toBe("40");
    expect(weeklyCoverHours(2415)).toBe("40.25");
  });
});
