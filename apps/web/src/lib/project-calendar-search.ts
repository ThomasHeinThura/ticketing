import { addMonths } from "date-fns";
import {
  type ProjectViewSearch,
  parseProjectViewSearch,
} from "./project-board-search";

export type ProjectCalendarSearch = ProjectViewSearch;

export function parseProjectCalendarSearch(
  raw: Record<string, unknown>,
): ProjectCalendarSearch {
  const month = parseMonth(raw.month) ? raw.month : undefined;
  const { month: _month, ...shared } = parseProjectViewSearch(raw);
  return {
    ...shared,
    ...(month ? { month } : {}),
  };
}

export function parseMonth(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(value)) {
    return false;
  }
  const [year, month] = value.split("-").map(Number);
  return year >= 1000 && year <= 9999 && month >= 1 && month <= 12;
}

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

export function withCalendarMonth(
  search: ProjectCalendarSearch,
  month: string | undefined,
): ProjectCalendarSearch {
  const { month: _current, ...rest } = search;
  return month ? { ...rest, month } : rest;
}

export function withCalendarTask(
  search: ProjectCalendarSearch,
  taskId: string | undefined,
): ProjectCalendarSearch {
  const { taskId: _currentTaskId, ...rest } = search;
  return taskId ? { ...rest, taskId } : rest;
}

export function shiftCalendarMonthSearch(
  search: ProjectCalendarSearch,
  visibleMonth: Date,
  offset: -1 | 1,
): ProjectCalendarSearch {
  return withCalendarMonth(
    search,
    formatCalendarMonth(addMonths(visibleMonth, offset)),
  );
}
