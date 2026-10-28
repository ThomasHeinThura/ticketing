import { useMemo, useSyncExternalStore } from "react";

/**
 * The server's clock as seen through API responses. Screens that show "today" or default to the
 * current month or year read it here instead of the browser clock, so a skewed or simulated
 * client clock does not move them. Each API response's HTTP `Date` header is the source; until
 * one is readable (a cross-origin response does not expose it), the browser clock stands in.
 */

/** The server's instant from an HTTP `Date` header, or `null` when it is absent or unreadable. */
export function serverInstant(dateHeader: string | null | undefined) {
  if (!dateHeader) return null;
  const instant = Date.parse(dateHeader);
  return Number.isNaN(instant) ? null : instant;
}

/** Server time minus browser time, once a response has told us. */
let offset: number | null = null;
const listeners = new Set<() => void>();

/** Notes the server's clock from a response. `Date` has one-second resolution, so smaller drift is ignored. */
export function recordServerDate(
  response: { headers: { get(name: string): string | null } },
  browserNow: number = Date.now(),
) {
  const instant = serverInstant(response.headers.get("date"));
  if (instant === null) return;
  const next = instant - browserNow;
  if (offset !== null && Math.abs(next - offset) < 1_000) return;
  offset = next;
  for (const listener of listeners) listener();
}

/** Now on the server's clock (the browser clock until a server `Date` has been seen). */
export function serverNow(browserNow: number = Date.now()) {
  return browserNow + (offset ?? 0);
}

/** Test seam: forget the recorded server clock. */
export function resetServerClock() {
  offset = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function dayKey(instant: number) {
  const day = new Date(instant);
  return `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
}

/** A local calendar day as `YYYY-MM-DD`. */
export function isoDay(day: Date) {
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

/** Today (local midnight) on the server's clock; re-renders when the server clock is first learnt. */
export function useServerToday(): Date {
  const key = useSyncExternalStore(subscribe, () => dayKey(serverNow()));
  return useMemo(() => {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  }, [key]);
}
