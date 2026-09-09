/**
 * Service calendar — pure data types.
 *
 * Mirrors `service_calendar`'s `windows`/`holidays` jsonb columns verbatim
 * (`docs/01-architecture/data-model.md` §7, `docs/03-features/service-calendars.md`).
 * `workspace_id`/`name`/`id` are database concerns and never appear here — a calendar
 * is passed into this module as plain data, never loaded by it (do-not 11's tables live
 * in `data-model.md`; this file is the code shape of the `windows`/`holidays` columns,
 * not a second registration of them).
 */

/** The seven weekday keys a calendar's `windows` jsonb is keyed by. */
export const WEEKDAYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/**
 * A single covered window on one weekday, in minutes-from-midnight local time
 * (`CAL-3`). `0..1440` — `1440` (never higher) means midnight at the end of that day.
 * A window may not span midnight; a shift that crosses it is two windows on
 * consecutive days.
 */
export interface CalendarWindow {
  /** Minutes from local midnight, inclusive. `0 <= from < to`. */
  from: number;
  /** Minutes from local midnight, exclusive-at-day-end. `from < to <= 1440`. */
  to: number;
}

/** `windows` jsonb: zero or more windows per weekday. An absent day means no cover. */
export type CalendarWindows = Partial<Record<Weekday, CalendarWindow[]>>;

/** A single named calendar date, `YYYY-MM-DD` in the calendar's own timezone. */
export interface DatedHoliday {
  date: string;
  name?: string;
}

/** An inclusive date range with no cover, e.g. a company shutdown. */
export interface RangedHoliday {
  from: string;
  to: string;
  name?: string;
}

/** A holiday that recurs on the same month/day every year (`CAL-12`), e.g. 25 December. */
export interface RecurringHoliday {
  recurs: "annually";
  month: number;
  day: number;
  name?: string;
}

export type Holiday = DatedHoliday | RangedHoliday | RecurringHoliday;

/** The calendar as plain data — exactly what `coveredMinutesBetween` needs and nothing else. */
export interface ServiceCalendar {
  /** An IANA zone name, e.g. `"Europe/London"`. All windows are interpreted in it (`CAL-1`). */
  timezone: string;
  windows: CalendarWindows;
  holidays: Holiday[];
}

/** A calendar-local date, independent of time-of-day — what `isHoliday` reasons about. */
export interface LocalDate {
  year: number;
  /** 1-indexed, matching `Date`'s convention elsewhere in this module reversed (not 0-indexed). */
  month: number;
  day: number;
}

/** A calendar-local date plus a minute-of-day offset — the internal unit `calendar.ts` works in. */
export interface LocalDateTime extends LocalDate {
  /** Minutes since local midnight. `0..1440`; `1440` only ever appears as an exclusive bound. */
  minuteOfDay: number;
}

/** The result of validating a calendar's `windows`/`holidays` shape before it is saved. */
export interface CalendarValidationResult {
  valid: boolean;
  errors: string[];
}
