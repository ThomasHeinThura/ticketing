/**
 * Service calendar arithmetic — pure functions, no I/O, no ambient clock.
 *
 * Every function here takes the calendar and every instant it needs as plain
 * arguments. None of them read `Date.now()`, load a `service_calendar` row, parse an
 * `.ics` file, or look up a country holiday preset — those are the impure edge
 * (`apps/api`), per `docs/03-features/service-calendars.md` and the P2 plan.
 *
 * **Timezone correctness (`CAL-6`/`CAL-7`) without a new dependency.** DST-correct
 * wall-clock ⇄ instant conversion needs a real IANA timezone database. Rather than add
 * one (`date-fns-tz` / `luxon` / `@js-temporal/polyfill` — all flagged as an open
 * question in the P2 plan, and AGENTS.md do-not 4 requires Thomas's yes for a new
 * dependency), this module uses `Intl.DateTimeFormat`, which is built into Node/V8 and
 * ships the full ICU timezone database (verified: `process.config.variables.icu_small`
 * is `false` on this toolchain's Node 24.20.0, and `Intl.supportedValuesOf("timeZone")`
 * lists both zones this spec names). That is not a new package dependency — it is the
 * JavaScript runtime itself — so do-not 4 does not apply and there is nothing to ask
 * Thomas about. See the pull request description for the two-instant experiment that
 * validated this against the actual 2026 transition instants in both named zones before
 * any test was written.
 */

import type {
  CalendarValidationResult,
  CalendarWindow,
  Holiday,
  LocalDate,
  LocalDateTime,
  RecurringHoliday,
  ServiceCalendar,
  Weekday,
} from "./types.js";
import { WEEKDAYS } from "./types.js";

// ---------------------------------------------------------------------------
// Instant ⇄ local wall-clock conversion, via Intl.DateTimeFormat.
// ---------------------------------------------------------------------------

const OFFSET_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = OFFSET_FORMATTER_CACHE.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    OFFSET_FORMATTER_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

/** The zone's UTC offset, in minutes east of UTC, at a given real instant. */
function offsetMinutesAt(timeZone: string, instant: Date): number {
  const parts = offsetFormatter(timeZone).formatToParts(instant);
  const value = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/** Converts a real instant into the calendar date and minute-of-day it falls on, in `timeZone`. */
export function instantToLocalDateTime(
  timeZone: string,
  instant: Date,
): LocalDateTime {
  const parts = offsetFormatter(timeZone).formatToParts(instant);
  const value = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    minuteOfDay: value("hour") * 60 + value("minute") + value("second") / 60,
  };
}

/**
 * Converts a local wall-clock point (a calendar date plus a minute-of-day, which may be
 * `1440` to mean "midnight at the end of `date`") into a real instant in `timeZone`.
 *
 * Uses the standard two-pass offset resolution: guess the instant as if the wall-clock
 * reading were UTC, read the zone's actual offset at that guess, correct, and check once
 * more. This is what every non-toy tz conversion does under the hood; two passes is
 * always enough because no real IANA zone's offset changes twice within one candidate
 * window. Ambiguous times (autumn fall-back's repeated hour) resolve to their first
 * (earlier, still-DST) occurrence, and nonexistent times (spring-forward's skipped hour)
 * are never asked for directly — every call site clips against a real instant first.
 */
export function zonedDateTimeToInstant(
  timeZone: string,
  date: LocalDate,
  minuteOfDay: number,
): Date {
  const dayOverflow = Math.floor(minuteOfDay / 1440);
  const remainder = minuteOfDay - dayOverflow * 1440;
  const hour = Math.floor(remainder / 60);
  const minute = remainder % 60;
  const naiveUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day + dayOverflow,
    hour,
    minute,
    0,
  );
  const firstOffset = offsetMinutesAt(timeZone, new Date(naiveUtc));
  let instantMs = naiveUtc - firstOffset * 60_000;
  const secondOffset = offsetMinutesAt(timeZone, new Date(instantMs));
  if (secondOffset !== firstOffset) {
    instantMs = naiveUtc - secondOffset * 60_000;
  }
  return new Date(instantMs);
}

/** The covered minutes of one window occurrence, correct across a DST transition (`CAL-7`). */
function windowInstanceCoveredMinutes(
  timeZone: string,
  date: LocalDate,
  startMinute: number,
  endMinute: number,
): number {
  const nominalMinutes = endMinute - startMinute;
  if (nominalMinutes <= 0) {
    return 0;
  }
  const startInstant = zonedDateTimeToInstant(timeZone, date, startMinute);
  const endInstant = zonedDateTimeToInstant(timeZone, date, endMinute);
  const realElapsedMinutes =
    (endInstant.getTime() - startInstant.getTime()) / 60_000;
  // Spring-forward: the skipped hour reduces real elapsed time below nominal — take it,
  // an hour that never happened is never covered. Autumn fall-back: the repeated hour
  // inflates real elapsed time above nominal — capped at nominal, so it is "counted
  // once" (CAL-7) rather than credited twice.
  return Math.min(nominalMinutes, realElapsedMinutes);
}

// ---------------------------------------------------------------------------
// Local date helpers.
// ---------------------------------------------------------------------------

/** The day-of-week a `LocalDate` falls on. A pure calendar fact, independent of any zone. */
export function weekdayOf(date: LocalDate): Weekday {
  const index = new Date(
    Date.UTC(date.year, date.month - 1, date.day),
  ).getUTCDay();
  // biome-ignore lint/style/noNonNullAssertion: index is 0..6, WEEKDAYS has exactly 7 entries
  return WEEKDAYS[index]!;
}

function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(
    Date.UTC(date.year, date.month - 1, date.day + days),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function sameLocalDate(a: LocalDate, b: LocalDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** Date-only ordering: -1 if `a` is before `b`, 0 if equal, 1 if after. */
export function compareLocalDate(a: LocalDate, b: LocalDate): number {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD`, matching `DatedHoliday.date`'s own format. */
export function formatLocalDate(date: LocalDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

// ---------------------------------------------------------------------------
// Holidays.
// ---------------------------------------------------------------------------

/** Expands a recurring holiday rule (`CAL-12`) to the concrete date it falls on in `year`. */
export function expandRecurringHoliday(
  rule: RecurringHoliday,
  year: number,
): LocalDate {
  return { year, month: rule.month, day: rule.day };
}

/**
 * Whether `date` has no cover regardless of windows (`CAL-4`). Dated, ranged and
 * recurring holidays are all checked; overlapping ranges are a union by construction —
 * a date matching any entry is a holiday, so overlap "merging" (the spec's edge case)
 * needs no separate step.
 */
export function isHoliday(calendar: ServiceCalendar, date: LocalDate): boolean {
  return calendar.holidays.some((holiday) => holidayCoversDate(holiday, date));
}

function holidayCoversDate(holiday: Holiday, date: LocalDate): boolean {
  if ("recurs" in holiday) {
    return holiday.month === date.month && holiday.day === date.day;
  }
  if ("from" in holiday) {
    return (
      formatLocalDate(date) >= holiday.from &&
      formatLocalDate(date) <= holiday.to
    );
  }
  return formatLocalDate(date) === holiday.date;
}

// ---------------------------------------------------------------------------
// Validation (CAL-2, CAL-3, and the "window of zero length" / "overlapping holiday
// ranges" edge cases) — a calendar is validated once, at save; coveredMinutesBetween
// never re-defends against malformed input on every call.
// ---------------------------------------------------------------------------

/** Validates a calendar's shape before it is saved. Computation assumes a valid calendar. */
export function validateCalendar(
  calendar: ServiceCalendar,
): CalendarValidationResult {
  const errors: string[] = [];

  for (const weekday of WEEKDAYS) {
    const windows = calendar.windows[weekday] ?? [];
    const sorted = [...windows].sort((a, b) => a.from - b.from);
    for (let i = 0; i < sorted.length; i++) {
      const window = sorted[i] as CalendarWindow;
      if (window.from < 0 || window.to > 1440) {
        errors.push(
          `${weekday}: window ${window.from}-${window.to} is outside 0..1440`,
        );
      }
      if (window.to <= window.from) {
        errors.push(
          `${weekday}: window ${window.from}-${window.to} has zero or negative length`,
        );
      }
      const next = sorted[i + 1];
      if (next && next.from < window.to) {
        errors.push(
          `${weekday}: window ${window.from}-${window.to} overlaps ${next.from}-${next.to}`,
        );
      }
    }
  }

  for (const holiday of calendar.holidays) {
    if ("from" in holiday && holiday.from > holiday.to) {
      errors.push(
        `holiday range ${holiday.from}..${holiday.to} ends before it starts`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Cover.
// ---------------------------------------------------------------------------

/** Whether the calendar provides any cover at all, on any weekday (`CAL-5`'s zero-cover case). */
export function calendarHasCover(calendar: ServiceCalendar): boolean {
  return WEEKDAYS.some((weekday) =>
    (calendar.windows[weekday] ?? []).some((w) => w.to > w.from),
  );
}

/**
 * The covered minutes between two instants — time inside the calendar's windows,
 * excluding holidays (`CAL-4`). `from`/`to` are real instants; `to <= from` (including a
 * zero-length interval) covers zero minutes.
 *
 * DST correctness (`CAL-6`/`CAL-7`) is handled per window-occurrence, not per whole day:
 * see `windowInstanceCoveredMinutes`.
 */
export function coveredMinutesBetween(
  calendar: ServiceCalendar,
  from: Date,
  to: Date,
): number {
  if (to.getTime() <= from.getTime()) {
    return 0;
  }

  const fromLocal = instantToLocalDateTime(calendar.timezone, from);
  const toLocal = instantToLocalDateTime(calendar.timezone, to);

  let total = 0;
  let cursor: LocalDate = {
    year: fromLocal.year,
    month: fromLocal.month,
    day: fromLocal.day,
  };
  const lastDate: LocalDate = {
    year: toLocal.year,
    month: toLocal.month,
    day: toLocal.day,
  };

  // Bound the loop defensively — a calendar and a range are both finite in every real
  // case; this only ever protects against a caller passing a malformed multi-year range.
  for (let guard = 0; guard < 100_000; guard++) {
    const isFirstDay = sameLocalDate(cursor, fromLocal);
    const isLastDay = sameLocalDate(cursor, lastDate);

    if (!isHoliday(calendar, cursor)) {
      const windows = calendar.windows[weekdayOf(cursor)] ?? [];
      for (const window of windows) {
        const start = isFirstDay
          ? Math.max(window.from, fromLocal.minuteOfDay)
          : window.from;
        const end = isLastDay
          ? Math.min(window.to, toLocal.minuteOfDay)
          : window.to;
        if (end > start) {
          total += windowInstanceCoveredMinutes(
            calendar.timezone,
            cursor,
            start,
            end,
          );
        }
      }
    }

    if (isLastDay) {
      break;
    }
    cursor = addDays(cursor, 1);
  }

  return total;
}

/**
 * The next instant at or after `instant` that the calendar covers. If `instant` is
 * already inside a window, it is returned unchanged — this is what lets a caller thread
 * "when does the clock start" through a single function regardless of whether the start
 * fact already falls in cover. A zero-cover calendar (`CAL-5`) never opens: `null`.
 */
export function nextWindowOpening(
  calendar: ServiceCalendar,
  instant: Date,
): Date | null {
  if (!calendarHasCover(calendar)) {
    return null;
  }

  const cursor = instantToLocalDateTime(calendar.timezone, instant);
  let cursorDate: LocalDate = {
    year: cursor.year,
    month: cursor.month,
    day: cursor.day,
  };
  let minuteFloor = cursor.minuteOfDay;

  // A year plus slack is far beyond any real holiday run; this only guards against an
  // unreachable calendar (e.g. every weekday holidayed out forever), which is not a
  // producible configuration but must not hang the caller if it somehow occurred.
  for (let daysChecked = 0; daysChecked < 400; daysChecked++) {
    if (!isHoliday(calendar, cursorDate)) {
      const windows = [...(calendar.windows[weekdayOf(cursorDate)] ?? [])].sort(
        (a, b) => a.from - b.from,
      );
      for (const window of windows) {
        if (window.to <= minuteFloor) {
          continue;
        }
        if (window.from <= minuteFloor) {
          // Already inside this window.
          return instant;
        }
        return zonedDateTimeToInstant(
          calendar.timezone,
          cursorDate,
          window.from,
        );
      }
    }
    cursorDate = addDays(cursorDate, 1);
    minuteFloor = 0;
  }

  return null;
}
