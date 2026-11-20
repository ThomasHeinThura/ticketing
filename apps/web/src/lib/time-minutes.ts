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

export {
  isCalendarDate,
  shiftDate,
  weekDays,
  weekStart,
} from "./calendar-date";

/** Elapsed whole minutes between an ISO start and "now" (never negative). */
export function elapsedMinutes(startedAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000));
}
