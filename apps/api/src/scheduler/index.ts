import { Cron } from "croner";
import { checkDueDateReminders } from "./due-date-reminders";
import { runSessionCleanup } from "./session-cleanup";

const jobs: Cron[] = [];

/**
 * What was registered, keyed by the name `background-jobs.md` calls the job's identifier.
 *
 * Kept alongside `jobs` because a bare `Cron` does not remember the name it was registered
 * under, and a test that can only see patterns cannot tell *which* job a cadence belongs to —
 * transposing two jobs' patterns would leave every other assertion in the suite green. An
 * independent review of #208 demonstrated exactly that, so the mapping is kept rather than
 * inferred.
 */
const registeredByName = new Map<string, Cron>();

type JobOutcome = { degraded?: boolean };

// Cron jobs swallow their operational failures (per-item try/catch) so they
// can keep processing the rest of the batch, which means the thrown-rejection
// channel alone would report "ok" for a partially failed run. The returned
// outcome is inspected instead, so a handled failure is still visible.
//
// kaneo reported this to Sentry as a check-in. TaskDesk has no phone-home, so
// it goes to the log. When observability lands (Pino + Prometheus per
// observability.md) this is the seam that emits a job metric.
function withCheckIn<T>(name: string, fn: () => Promise<T>) {
  return async (): Promise<void> => {
    try {
      const result = await fn();
      const degraded = Boolean(
        (result as JobOutcome | null | undefined)?.degraded,
      );
      if (degraded) {
        console.warn(`Cron job ${name} completed with handled failures`);
      }
    } catch (error) {
      console.error(`Cron job ${name} failed`, error);
    }
  };
}

export function initializeScheduler(): void {
  const definitions: ReadonlyArray<{
    name: string;
    pattern: string;
    handler: () => Promise<unknown>;
  }> = [
    // background-jobs.md's cadence table.
    {
      name: "due-date-reminders",
      pattern: "*/5 * * * *",
      handler: checkDueDateReminders,
    },
    {
      name: "session-cleanup",
      pattern: "15 3 * * *",
      handler: runSessionCleanup,
    },
  ];

  for (const definition of definitions) {
    const job = new Cron(
      definition.pattern,
      withCheckIn(definition.name, definition.handler),
    );
    jobs.push(job);
    registeredByName.set(definition.name, job);
  }

  console.log(
    "⏰ Scheduler started (due-date reminders every 5 minutes, session cleanup daily 03:15)",
  );
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

/**
 * The registered jobs by the name they were registered under, for tests.
 *
 * `registeredJobs()` alone cannot answer "is `session-cleanup` on its spec'd cadence" — it
 * exposes patterns without names, so it cannot tell a correct registration from two jobs whose
 * patterns were transposed.
 */
export function registeredJobByName(name: string): Cron | undefined {
  return registeredByName.get(name);
}

export function shutdownScheduler(): void {
  for (const job of jobs) {
    job.stop();
  }
  jobs.length = 0;
  registeredByName.clear();
}
