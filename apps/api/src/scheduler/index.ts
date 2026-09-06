import * as Sentry from "@sentry/node";
import { Cron } from "croner";
import { checkDueDateReminders } from "./due-date-reminders";

const jobs: Cron[] = [];

type JobOutcome = { degraded?: boolean };

// Cron jobs swallow their operational failures (per-item try/catch) so they
// can keep processing the rest of the batch. Reporting Sentry status purely
// from the thrown-rejection channel would always show "ok" for any partially
// failed run. Inspect the returned outcome instead so handled failures light
// up the monitor without aborting the rest of the work. Unexpected throws are
// captured as exception events and swallowed so one bad tick can't take down
// the scheduler via an unhandled rejection.
function withCheckIn<T>(name: string, fn: () => Promise<T>) {
  return async (): Promise<void> => {
    const checkInId = Sentry.captureCheckIn({
      monitorSlug: name,
      status: "in_progress",
    });
    try {
      const result = await fn();
      const degraded = Boolean(
        (result as JobOutcome | null | undefined)?.degraded,
      );
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug: name,
        status: degraded ? "error" : "ok",
      });
    } catch (error) {
      Sentry.captureException(error, { tags: { area: "cron", job: name } });
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug: name,
        status: "error",
      });
      console.error(`Cron job ${name} failed`, error);
    }
  };
}

export function initializeScheduler(): void {
  jobs.push(
    new Cron(
      "*/5 * * * *",
      withCheckIn("due-date-reminders", checkDueDateReminders),
    ),
  );
  console.log("⏰ Scheduler started (due-date reminders every 5 minutes)");
}

/**
 * The jobs currently registered, for tests.
 *
 * This exists because a real defect shipped without it: removing a cron job
 * left a bare `jobs.push(new Cron(pattern))` behind — a schedule with NO
 * handler. It compiled, it type-checked, and the suite stayed green, because
 * nothing asserted what the scheduler actually registers. croner reports a
 * `nextRun()` for a handler-less job just as it does for a real one, so it
 * looked alive while doing nothing every five minutes.
 */
export function registeredJobs(): readonly Cron[] {
  return jobs;
}

export function shutdownScheduler(): void {
  for (const job of jobs) {
    job.stop();
  }
  jobs.length = 0;
}
