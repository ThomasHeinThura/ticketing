import { localMinutes, nextLocalOccurrence } from "./quiet-hours";

export type DigestCadence = "hourly" | "daily";

export type DigestWindow = { startAt: Date; endAt: Date; timezone: string };

const MINUTE_MS = 60_000;

/** Whether `timeZone` is an IANA zone this runtime knows. */
export function isKnownTimezone(timeZone: string): boolean {
  try {
    localMinutes(new Date(0), timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The closed `NO-5`/`NO-6` window containing `at`: an hourly window runs from one local
 * top-of-hour to the next, a daily window from one local midnight to the next. Boundaries are
 * returned as UTC instants so a daylight-saving change is unambiguous: a daily window on a
 * transition day is 23 or 25 hours long, an hourly one is always 60 minutes.
 */
export function digestWindowContaining(
  at: Date,
  timeZone: string,
  cadence: DigestCadence,
): DigestWindow {
  if (cadence === "hourly") {
    const floored = Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS;
    const minuteOfHour = localMinutes(new Date(floored), timeZone) % 60;
    const startAt = new Date(floored - minuteOfHour * MINUTE_MS);
    return {
      startAt,
      endAt: new Date(startAt.getTime() + 60 * MINUTE_MS),
      timezone: timeZone,
    };
  }
  const endAt = nextLocalOccurrence(at, timeZone, 0);
  // The previous local midnight is the first one after (end - 26h): the longest day is 25h.
  const startAt = nextLocalOccurrence(
    new Date(endAt.getTime() - 26 * 60 * MINUTE_MS),
    timeZone,
    0,
  );
  return { startAt, endAt, timezone: timeZone };
}

/** The window that begins exactly where `window` ends. */
export function nextDigestWindow(
  window: DigestWindow,
  cadence: DigestCadence,
): DigestWindow {
  return digestWindowContaining(window.endAt, window.timezone, cadence);
}
