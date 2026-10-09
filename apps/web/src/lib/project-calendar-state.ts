import { addMonths } from "date-fns";
import type { ProjectCalendarSearch } from "./project-board-search";
import { parseMonth } from "./project-board-search";
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
