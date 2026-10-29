import { z } from "zod";
import type { Holiday } from "@/fetchers/service-calendar";

const calendarDate = z.iso.date();

/** Editor-only validation; route search utilities keep their initial bundle light. */
export function isValidCalendarHoliday(holiday: Holiday): boolean {
  if ("date" in holiday) return calendarDate.safeParse(holiday.date).success;
  if ("from" in holiday) {
    return (
      calendarDate.safeParse(holiday.from).success &&
      calendarDate.safeParse(holiday.to).success &&
      holiday.from <= holiday.to
    );
  }
  if (!Number.isInteger(holiday.month) || !Number.isInteger(holiday.day))
    return false;
  // Leap day is a valid annual rule; use a leap year only to validate month/day.
  return calendarDate.safeParse(
    `2000-${String(holiday.month).padStart(2, "0")}-${String(holiday.day).padStart(2, "0")}`,
  ).success;
}
