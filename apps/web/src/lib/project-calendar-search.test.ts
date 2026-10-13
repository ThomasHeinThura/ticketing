import { describe, expect, it } from "vitest";
import { parseProjectCalendarSearch } from "./project-board-search";
import { withProjectViewState } from "./project-board-search-state";
import {
  dateFromCalendarMonth,
  formatCalendarMonth,
  shiftCalendarMonthSearch,
} from "./project-calendar-state";

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
      withProjectViewState(
        { taskId: "task-1", month: "2026-10", q: "urgent" },
        { month: "2026-11" },
      ),
    ).toEqual({ taskId: "task-1", month: "2026-11", q: "urgent" });
    expect(
      withProjectViewState(
        { taskId: "task-1", month: "2026-10", q: "urgent" },
        { month: undefined },
      ),
    ).toEqual({ taskId: "task-1", q: "urgent" });
    expect(
      shiftCalendarMonthSearch(
        { taskId: "task-1", month: "2026-01" },
        new Date(2026, 0, 1),
        -1,
      ),
    ).toEqual({ taskId: "task-1", month: "2025-12" });
  });

  it("retains the established four-digit year and month boundaries", () => {
    expect(parseProjectCalendarSearch({ month: "0999-12" })).toEqual({});
    expect(parseProjectCalendarSearch({ month: "0000-01" })).toEqual({});
    expect(parseProjectCalendarSearch({ month: "1000-01" })).toEqual({
      month: "1000-01",
    });
    expect(parseProjectCalendarSearch({ month: "9999-12" })).toEqual({
      month: "9999-12",
    });
    expect(parseProjectCalendarSearch({ month: "2026-00" })).toEqual({});
    expect(parseProjectCalendarSearch({ month: "2026-13" })).toEqual({});
  });
});
