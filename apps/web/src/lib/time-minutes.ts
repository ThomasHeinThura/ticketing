/**
 * Integer-minute helpers for time tracking (TC-1). Durations are typed as people write them
 * ("90", "1:30", "1h30", "1.5h", "45m") and always leave as whole minutes, so a float hour never
 * reaches the API or a total.
 */

export const MAX_ENTRY_MINUTES = 24 * 60;

/** Parse a typed duration into whole minutes (1..1440), or null when it is not one. */
export function parseMinutes(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/gu, "");
  if (!text) return null;
  const clock = /^(\d+):(\d{1,2})$/u.exec(text);
  const hoursMinutes = /^(\d+)h(?:(\d+)m?)?$/u.exec(text);
  const decimalHours = /^(\d+(?:[.,]\d+)?)h$/u.exec(text);
  const minutesOnly = /^(\d+)m(?:in)?$/u.exec(text);
  let minutes: number | null = null;
  if (clock) {
    const rest = Number(clock[2]);
    minutes = rest < 60 ? Number(clock[1]) * 60 + rest : null;
  } else if (hoursMinutes) {
    minutes = Number(hoursMinutes[1]) * 60 + Number(hoursMinutes[2] ?? 0);
  } else if (decimalHours) {
    minutes = Math.round(
      Number((decimalHours[1] ?? "").replace(",", ".")) * 60,
    );
  } else if (minutesOnly) {
    minutes = Number(minutesOnly[1]);
  } else if (/^\d+$/u.test(text)) {
    minutes = Number(text);
  }
  if (minutes === null || !Number.isSafeInteger(minutes)) return null;
  return minutes >= 1 && minutes <= MAX_ENTRY_MINUTES ? minutes : null;
}

/** `90` -> `1:30`, `45` -> `0:45`, `0` -> `0:00`. */
export function formatMinutes(minutes: number): string {
  const whole = Math.max(0, Math.trunc(minutes));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Add whole days to a `YYYY-MM-DD` date (UTC calendar arithmetic, no local zone involved). */
export function shiftDate(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

/** Monday of the ISO week containing `date`. */
export function weekStart(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftDate(date, -((weekday + 6) % 7));
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => shiftDate(start, index));
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

/** Elapsed whole minutes between an ISO start and "now" (never negative). */
export function elapsedMinutes(startedAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000));
}
