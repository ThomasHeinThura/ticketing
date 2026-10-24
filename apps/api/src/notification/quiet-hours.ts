/**
 * `NO-3` quiet hours. A person's window is `quiet_hours_start`..`quiet_hours_end`, two
 * `HH:MM` 24-hour local times in `quiet_hours_timezone` (an IANA zone; the instance zone is
 * the fallback). A window whose end is earlier than its start crosses midnight. Evaluated at
 * every external-delivery drain, so a changed setting applies to already-queued children.
 *
 * SLA breach and approval expiry ignore quiet hours. This is NOT the digest-bypass set
 * (`URGENT_EVENT_KINDS` in `fanout.ts`), which also contains direct mentions.
 */
export const QUIET_HOURS_EXEMPT_EVENT_KINDS: ReadonlySet<string> = new Set([
  "sla.breached",
  "approval.expiring",
  "approval.expired",
]);

export type QuietHoursSetting = {
  start: string | null;
  end: string | null;
  timezone: string | null;
};

export type QuietHoursDecision =
  | { kind: "none" }
  | { kind: "allowed" }
  | { kind: "quiet"; until: Date }
  | { kind: "unresolved" };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseClockMinutes(value: string | null): number | null {
  if (value === null) return null;
  const match = TIME.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let existing = formatters.get(timeZone);
  if (!existing) {
    // Throws RangeError for an unknown zone; callers treat that as unresolved.
    existing = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(timeZone, existing);
  }
  return existing;
}

/** Local minutes since midnight of `at` in `timeZone`. */
export function localMinutes(at: Date, timeZone: string): number {
  let hour = 0;
  let minute = 0;
  for (const part of formatter(timeZone).formatToParts(at)) {
    if (part.type === "hour") hour = Number(part.value);
    if (part.type === "minute") minute = Number(part.value);
  }
  return (hour % 24) * 60 + minute;
}

function signedMinuteDelta(from: number, to: number): number {
  let delta = (((to - from) % 1440) + 1440) % 1440;
  if (delta > 720) delta -= 1440;
  return delta;
}

/**
 * The first instant after `now` whose local time of day is `targetMinutes`. Starts from the
 * naive offset and corrects against the zone's real offset, so a daylight-saving change inside
 * the interval moves the answer by the shift rather than landing an hour early or late.
 */
export function nextLocalOccurrence(
  now: Date,
  timeZone: string,
  targetMinutes: number,
): Date {
  const minuteMs = 60_000;
  const floored = Math.floor(now.getTime() / minuteMs) * minuteMs;
  const current = localMinutes(new Date(floored), timeZone);
  let candidate =
    floored + ((((targetMinutes - current) % 1440) + 1440) % 1440) * minuteMs;
  for (let i = 0; i < 4; i += 1) {
    const delta = signedMinuteDelta(
      localMinutes(new Date(candidate), timeZone),
      targetMinutes,
    );
    if (delta === 0) break;
    candidate += delta * minuteMs;
  }
  while (candidate <= now.getTime()) candidate += 24 * 60 * minuteMs;
  return new Date(candidate);
}

export function evaluateQuietHours(
  setting: QuietHoursSetting,
  fallbackTimezone: string,
  now: Date,
): QuietHoursDecision {
  if (setting.start === null && setting.end === null) {
    // A timezone alone configures nothing.
    return { kind: "none" };
  }
  const start = parseClockMinutes(setting.start);
  const end = parseClockMinutes(setting.end);
  if (start === null || end === null || start === end)
    return { kind: "unresolved" };
  const timeZone = setting.timezone ?? fallbackTimezone;
  let minutes: number;
  try {
    minutes = localMinutes(now, timeZone);
  } catch {
    return { kind: "unresolved" };
  }
  const inside =
    start < end
      ? minutes >= start && minutes < end
      : minutes >= start || minutes < end;
  if (!inside) return { kind: "allowed" };
  return { kind: "quiet", until: nextLocalOccurrence(now, timeZone, end) };
}
