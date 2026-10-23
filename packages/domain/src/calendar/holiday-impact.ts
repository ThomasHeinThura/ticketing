import {
  formatLocalDate,
  instantToLocalDateTime,
  isHoliday,
  zonedDateTimeToInstant,
} from "./calendar.js";
import type { Holiday, LocalDate, ServiceCalendar } from "./types.js";

/** How far back a retroactive holiday is looked for; older additions cannot reach open items
 * in practice and the bound keeps the expansion finite for an unbounded ranged holiday. */
export const HOLIDAY_IMPACT_LOOKBACK_YEARS = 5;

/** A contiguous run of calendar days that became holidays and are not in the future. */
export interface RetroactiveHolidayWindow {
  /** First and last affected calendar day, `YYYY-MM-DD` in the calendar's timezone. */
  from: string;
  to: string;
  /** The instant the last affected day ends, in the calendar's timezone. */
  endsAt: Date;
}

function parseDay(value: string): LocalDate {
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  return { year, month, day };
}

function dayNumber(day: LocalDate): number {
  return Math.floor(Date.UTC(day.year, day.month - 1, day.day) / 86_400_000);
}

function fromDayNumber(n: number): LocalDate {
  const d = new Date(n * 86_400_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/**
 * CAL-13: the calendar days that `after` makes holidays and `before` did not, limited to
 * today and earlier (calendar-local) and to the lookback bound. Adding such a day removes cover
 * from time an open work item has already run through, so its deadline moves later.
 * Future-dated additions are not returned: their effect depends on each item's due instant,
 * which is not stored. Pure; `now` is supplied by the caller.
 */
export function retroactiveHolidayWindows(input: {
  timezone: string;
  before: readonly Holiday[];
  after: readonly Holiday[];
  now: Date;
}): RetroactiveHolidayWindow[] {
  const today = instantToLocalDateTime(input.timezone, input.now);
  const todayNumber = dayNumber(today);
  const earliest = todayNumber - 365 * HOLIDAY_IMPACT_LOOKBACK_YEARS;
  const beforeCalendar: ServiceCalendar = {
    timezone: input.timezone,
    windows: {},
    holidays: [...input.before],
  };

  const days = new Set<number>();
  const addDay = (n: number) => {
    if (n >= earliest && n <= todayNumber) days.add(n);
  };
  for (const holiday of input.after) {
    if ("recurs" in holiday) {
      for (
        let year = today.year - HOLIDAY_IMPACT_LOOKBACK_YEARS;
        year <= today.year;
        year++
      ) {
        const date = { year, month: holiday.month, day: holiday.day };
        // Skip impossible dates such as 29 February in a non-leap year.
        if (
          formatLocalDate(fromDayNumber(dayNumber(date))) !==
          formatLocalDate(date)
        )
          continue;
        addDay(dayNumber(date));
      }
    } else if ("from" in holiday) {
      const from = Math.max(dayNumber(parseDay(holiday.from)), earliest);
      const to = Math.min(dayNumber(parseDay(holiday.to)), todayNumber);
      for (let n = from; n <= to; n++) addDay(n);
    } else {
      addDay(dayNumber(parseDay(holiday.date)));
    }
  }

  const fresh = [...days]
    .filter((n) => !isHoliday(beforeCalendar, fromDayNumber(n)))
    .sort((a, b) => a - b);

  const windows: RetroactiveHolidayWindow[] = [];
  let start: number | undefined;
  let previous: number | undefined;
  const close = () => {
    if (start === undefined || previous === undefined) return;
    const last = fromDayNumber(previous);
    windows.push({
      from: formatLocalDate(fromDayNumber(start)),
      to: formatLocalDate(last),
      endsAt: zonedDateTimeToInstant(input.timezone, last, 1440),
    });
  };
  for (const n of fresh) {
    if (previous !== undefined && n === previous + 1) {
      previous = n;
      continue;
    }
    close();
    start = n;
    previous = n;
  }
  close();
  return windows;
}
