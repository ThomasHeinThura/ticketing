import { describe, expect, it } from "vitest";
import {
  dateFromCalendarMonth,
  formatCalendarMonth,
  parseProjectCalendarSearch,
  shiftCalendarMonthSearch,
  withCalendarMonth,
} from "./project-calendar-search";

describe("project calendar URL state", () => {
  it("parses and formats a local calendar month without changing its day", () => {
    expect(
      parseProjectCalendarSearch({ month: "2026-11", taskId: "task-1" }),
    ).toEqual({
      month: "2026-11",
      taskId: "task-1",
    });
    expect(formatCalendarMonth(new Date(2026, 10, 27))).toBe("2026-11");
    expect(dateFromCalendarMonth("2026-11", new Date(2026, 0, 10))).toEqual(
      new Date(2026, 10, 1),
    );
  });

  it("drops malformed months and preserves the selected task during month navigation", () => {
    expect(
      parseProjectCalendarSearch({ month: "2026-13", taskId: "" }),
    ).toEqual({});
    expect(
      withCalendarMonth({ taskId: "task-1", month: "2026-10" }, "2026-11"),
    ).toEqual({ taskId: "task-1", month: "2026-11" });
    expect(
      withCalendarMonth({ taskId: "task-1", month: "2026-10" }, undefined),
    ).toEqual({ taskId: "task-1" });
    expect(
      shiftCalendarMonthSearch(
        { taskId: "task-1", month: "2026-01" },
        new Date(2026, 0, 1),
        -1,
      ),
    ).toEqual({ taskId: "task-1", month: "2025-12" });
  });
});
