import type {
  CalendarWindow,
  Holiday,
  ServiceCalendar,
  Weekday,
} from "@/fetchers/service-calendar";

export const WEEKDAYS: { key: Weekday; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

export type CalendarWindowsForm = Record<Weekday, CalendarWindow[]>;

export function emptyCalendarWindows(): CalendarWindowsForm {
  return {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  };
}

export function copyCalendarWindows(
  windows: ServiceCalendar["windows"],
): CalendarWindowsForm {
  const copy = emptyCalendarWindows();
  for (const day of Object.keys(copy) as Weekday[]) {
    copy[day] = (windows[day] ?? []).map((window) => ({ ...window }));
  }
  return copy;
}

export function formatClockTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function parseClockTime(
  value: string,
  allowEndOfDay: boolean,
): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  if (hours === 24 && minutes === 0 && allowEndOfDay) return 1440;
  if (hours > 23) return null;
  return hours * 60 + minutes;
}

export function normalizeHolidays(
  holidays: ServiceCalendar["holidays"],
): Holiday[] {
  return holidays.map((holiday) => ({ ...holiday }));
}

export function weeklyCoverHours(minutes: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(minutes / 60);
}

export function isValidIanaTimezone(timezone: string): boolean {
  try {
    const canonicalTimeZone = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
    }).resolvedOptions().timeZone;
    return !/^[+-]/.test(canonicalTimeZone);
  } catch {
    return false;
  }
}

export function timezoneOptions(): string[] {
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  return ["UTC", ...zones.filter((zone) => zone !== "UTC")];
}

export function timezoneChangeNeedsConfirmation(
  isNew: boolean,
  savedTimezone: string | undefined,
  nextTimezone: string,
): boolean {
  return !isNew && savedTimezone !== nextTimezone.trim();
}

export function parseCalendarEditorSearch(raw: unknown): { year: number } {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  const year = Number(candidate.year);
  return {
    year:
      Number.isInteger(year) && year >= 1 && year <= 9998
        ? year
        : new Date().getFullYear(),
  };
}

export type CalendarEditorSearch = ReturnType<typeof parseCalendarEditorSearch>;
