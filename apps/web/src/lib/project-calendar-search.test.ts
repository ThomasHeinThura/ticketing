import { describe, expect, it } from "vitest";
import {
  appendProjectViewSearchParams,
  parseProjectCalendarSearch,
  parseProjectRouterSearch,
} from "./project-board-search";
import { withProjectViewState } from "./project-board-search-state";
import {
  buildCalendarRange,
  calendarAnchorDay,
  dateFromCalendarMonth,
  formatCalendarDay,
  formatCalendarMonth,
  shiftCalendarMonthSearch,
  shiftCalendarSearch,
  switchCalendarView,
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

describe("calendar range URL state (VW-25)", () => {
  it("round-trips calendarView and date and drops malformed values", () => {
    expect(
      parseProjectCalendarSearch({ calendarView: "week", date: "2026-10-23" }),
    ).toEqual({ calendarView: "week", date: "2026-10-23" });
    expect(
      parseProjectCalendarSearch({ calendarView: "year", date: "2026-02-30" }),
    ).toEqual({});
    expect(parseProjectCalendarSearch({ date: "2026-1-3" })).toEqual({});
    const router = parseProjectRouterSearch("calendarView=day&date=2026-10-23");
    expect(parseProjectCalendarSearch(router)).toEqual({
      calendarView: "day",
      date: "2026-10-23",
    });
    const params = new URLSearchParams();
    appendProjectViewSearchParams(params, {
      calendarView: "day",
      date: "2026-10-23",
      month: "2026-10",
    });
    expect(params.get("calendarView")).toBe("day");
    expect(params.get("date")).toBe("2026-10-23");
    expect(params.get("month")).toBe("2026-10");
  });

  it("builds a week as one row starting on the preferred weekday and a day as one cell", () => {
    const anchor = new Date(2026, 9, 23); // Friday
    const sunday = buildCalendarRange("week", anchor, 0);
    expect(sunday).toHaveLength(1);
    expect(sunday[0].map((d) => formatCalendarDay(d))).toEqual([
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
    ]);
    expect(buildCalendarRange("week", anchor, 1)[0][0]).toEqual(
      new Date(2026, 9, 19),
    );
    expect(buildCalendarRange("day", anchor, 0)).toEqual([[anchor]]);
  });

  it("anchors on the URL date, else today, and steps by the active range", () => {
    const today = new Date(2026, 9, 23, 15, 30);
    expect(calendarAnchorDay({}, today)).toEqual(new Date(2026, 9, 23));
    expect(calendarAnchorDay({ date: "2026-12-31" }, today)).toEqual(
      new Date(2026, 11, 31),
    );
    expect(calendarAnchorDay({ date: "nope" }, today)).toEqual(
      new Date(2026, 9, 23),
    );
    const anchor = new Date(2026, 11, 31);
    expect(
      shiftCalendarSearch({ taskId: "T-1" }, "week", anchor, anchor, 1),
    ).toEqual({ taskId: "T-1", date: "2027-01-07" });
    expect(
      shiftCalendarSearch({ date: "2026-12-31" }, "day", anchor, anchor, -1),
    ).toEqual({ date: "2026-12-30" });
    expect(
      shiftCalendarSearch(
        { calendarView: "month", month: "2026-12" },
        "month",
        new Date(2026, 11, 1),
        anchor,
        1,
      ),
    ).toEqual({ calendarView: "month", month: "2027-01" });
  });

  it("switches range without losing the place, and never writes the month default", () => {
    const today = new Date(2026, 9, 23);
    const october = new Date(2026, 9, 1);
    const november = new Date(2026, 10, 1);
    expect(
      switchCalendarView({ q: "x" }, "month", "week", october, october, today),
    ).toEqual({ q: "x", calendarView: "week", date: "2026-10-23" });
    expect(
      switchCalendarView(
        { month: "2026-11" },
        "month",
        "day",
        november,
        november,
        today,
      ),
    ).toEqual({ calendarView: "day", date: "2026-11-01" });
    expect(
      switchCalendarView(
        { calendarView: "week", date: "2026-12-14" },
        "week",
        "month",
        november,
        new Date(2026, 11, 14),
        today,
      ),
    ).toEqual({ month: "2026-12" });
    expect(
      switchCalendarView(
        { calendarView: "week", date: "2026-12-14" },
        "week",
        "day",
        november,
        new Date(2026, 11, 14),
        today,
      ),
    ).toEqual({ calendarView: "day", date: "2026-12-14" });
  });
});
