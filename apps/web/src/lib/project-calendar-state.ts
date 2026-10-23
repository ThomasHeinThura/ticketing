import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfWeek,
  startOfWeek,
} from "date-fns";
import type {
  CalendarView,
  ProjectCalendarSearch,
} from "./project-board-search";
import { parseCalendarDay, parseMonth } from "./project-board-search";
import { withProjectViewState } from "./project-board-search-state";

export function formatCalendarMonth(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(
    date.getMonth() + 1,
  ).padStart(2, "0")}`;
}

export function dateFromCalendarMonth(month: string, fallback: Date): Date {
  if (!parseMonth(month))
    return new Date(fallback.getFullYear(), fallback.getMonth(), 1);
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(year, monthIndex - 1, 1);
}

export function shiftCalendarMonthSearch(
  search: ProjectCalendarSearch,
  visibleMonth: Date,
  offset: -1 | 1,
): ProjectCalendarSearch {
  return withProjectViewState(search, {
    month: formatCalendarMonth(addMonths(visibleMonth, offset)),
  });
}

export function formatCalendarDay(date: Date): string {
  return `${formatCalendarMonth(date)}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateFromCalendarDay(day: string, fallback: Date): Date {
  if (!parseCalendarDay(day)) return fallback;
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  return new Date(year, month - 1, dayOfMonth);
}

type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The day a week or day view is anchored on: the URL's `date`, else today. */
export function calendarAnchorDay(
  search: Pick<ProjectCalendarSearch, "date">,
  today: Date,
): Date {
  return dateFromCalendarDay(
    search.date ?? "",
    new Date(today.getFullYear(), today.getMonth(), today.getDate()),
  );
}

/** One row of seven days for the week view, one row of one day for the day view. */
export function buildCalendarRange(
  view: Exclude<CalendarView, "month">,
  anchor: Date,
  weekStartsOn: WeekStartsOn,
): Date[][] {
  if (view === "day") return [[anchor]];
  return [
    eachDayOfInterval({
      start: startOfWeek(anchor, { weekStartsOn }),
      end: endOfWeek(anchor, { weekStartsOn }),
    }),
  ];
}

/** Previous and next step by the active range: a month, seven days or one day. */
export function shiftCalendarSearch(
  search: ProjectCalendarSearch,
  view: CalendarView,
  visibleMonth: Date,
  anchor: Date,
  offset: -1 | 1,
): ProjectCalendarSearch {
  if (view === "month")
    return shiftCalendarMonthSearch(search, visibleMonth, offset);
  return withProjectViewState(search, {
    month: undefined,
    date: formatCalendarDay(
      addDays(anchor, offset * (view === "week" ? 7 : 1)),
    ),
  });
}

/**
 * Switching the range keeps the person where they were: a week or day opens on today when
 * today is inside the month they were looking at, else on that month's first day; going back
 * to the month shows the month the week or day was in. The default (`month`) is not written.
 */
export function switchCalendarView(
  search: ProjectCalendarSearch,
  from: CalendarView,
  to: CalendarView,
  visibleMonth: Date,
  anchor: Date,
  today: Date,
): ProjectCalendarSearch {
  if (from === to) return search;
  const calendarView = to === "month" ? undefined : to;
  if (to === "month") {
    return withProjectViewState(search, {
      calendarView,
      date: undefined,
      month: from === "month" ? search.month : formatCalendarMonth(anchor),
    });
  }
  const date =
    from === "month"
      ? formatCalendarDay(
          today.getFullYear() === visibleMonth.getFullYear() &&
            today.getMonth() === visibleMonth.getMonth()
            ? today
            : visibleMonth,
        )
      : formatCalendarDay(anchor);
  return withProjectViewState(search, { calendarView, date, month: undefined });
}
