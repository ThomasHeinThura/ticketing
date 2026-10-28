import { describe, expect, it } from "vitest";
import { retroactiveHolidayWindows } from "./holiday-impact.js";

const now = new Date("2026-10-20T12:00:00Z");

describe("retroactiveHolidayWindows (CAL-13)", () => {
  it("returns a past dated holiday as one window ending at the end of that day", () => {
    const windows = retroactiveHolidayWindows({
      timezone: "UTC",
      before: [],
      after: [{ date: "2026-10-10" }],
      now,
    });
    expect(windows).toEqual([
      {
        from: "2026-10-10",
        to: "2026-10-10",
        endsAt: new Date("2026-10-11T00:00:00Z"),
      },
    ]);
  });

  it("ignores future-dated additions and days the calendar already covered", () => {
    expect(
      retroactiveHolidayWindows({
        timezone: "UTC",
        before: [{ date: "2026-10-10" }],
        after: [{ date: "2026-10-10" }, { date: "2026-12-25" }],
        now,
      }),
    ).toEqual([]);
  });

  it("merges a range into one window and clips it at today", () => {
    const windows = retroactiveHolidayWindows({
      timezone: "UTC",
      before: [],
      after: [{ from: "2026-10-18", to: "2026-10-25" }],
      now,
    });
    expect(windows.map((w) => [w.from, w.to])).toEqual([
      ["2026-10-18", "2026-10-20"],
    ]);
  });

  it("expands an annual rule to past occurrences and skips impossible dates", () => {
    const windows = retroactiveHolidayWindows({
      timezone: "UTC",
      before: [],
      after: [{ recurs: "annually", month: 2, day: 29 }],
      now,
    });
    expect(windows.map((w) => w.from)).toEqual(["2024-02-29"]);
  });

  it("reads today in the calendar's own timezone", () => {
    // 2026-10-20T23:30Z is already 21 October in Pacific/Auckland.
    const windows = retroactiveHolidayWindows({
      timezone: "Pacific/Auckland",
      before: [],
      after: [{ date: "2026-10-21" }],
      now: new Date("2026-10-20T23:30:00Z"),
    });
    expect(windows).toHaveLength(1);
  });
});
