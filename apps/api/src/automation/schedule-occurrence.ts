import { Cron } from "croner";

/** One catch-up occurrence, never a replay of every missed window. */
export function scheduleOccurrence(pattern: string, now: Date): Date | null {
  let cron: Cron | undefined;
  try {
    cron = new Cron(pattern, { paused: true, timezone: "UTC" });
    return (
      cron.previousRuns(
        1,
        new Date(Math.floor(now.getTime() / 60_000) * 60_000 + 1000),
      )[0] ?? null
    );
  } catch {
    // Croner's backwards walker fails for leap-day schedules. Walk forwards
    // across the five-year validation horizon, with a hard occurrence cap.
    try {
      const start = new Date(now);
      start.setUTCFullYear(start.getUTCFullYear() - 5);
      let at = cron?.nextRun(start) ?? null;
      let latest: Date | null = null;
      for (let i = 0; at && at <= now && i < 10; i++) {
        latest = at;
        at = cron?.nextRun(at) ?? null;
      }
      return at && at <= now ? null : latest;
    } catch {
      return null;
    }
  } finally {
    cron?.stop();
  }
}
