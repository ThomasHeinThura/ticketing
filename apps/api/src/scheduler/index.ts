import { Cron } from "croner";
import { checkIdentityConnectionHealth } from "../identity/connection-health";
import { sweepExpiredImpersonations } from "../instance/impersonation/finish";
import {
  cleanupPendingAttachments,
  collectDeletedAttachments,
} from "./attachment-cleanup";
import { runAuditPurgeJob } from "./audit-purge";
import { runCustomFieldPurgeJob } from "./custom-field-purge";
import { checkDueDateReminders } from "./due-date-reminders";
import { runNotificationDigest } from "./notification-digest";
import { runQuietHoursRelease } from "./notification-digest-release";
import { drainOutbox } from "./outbox-drain";
import { expirePendingActions } from "./pending-action-expire";
import { runPositionRebalanceJob } from "./position-rebalance-job";
import { runReminderScan } from "./reminder-scan";
import { scanScheduledTransitions } from "./scheduled-transition";
import { runSecretsRekeyJob, SECRETS_REKEY_JOB } from "./secrets-rekey";
import { runSessionCleanup } from "./session-cleanup";
import { scanSla } from "./sla-scan";

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
      name: "outbox-drain",
      pattern: "*/30 * * * * *",
      // Parent event envelopes, then immediate notification children (EV-1/EV-2).
      handler: drainOutbox,
    },
    {
      // NO-6: seals collecting digest groups whose window has ended (no provider call).
      name: "notification-digest",
      pattern: "0 * * * *",
      handler: runNotificationDigest,
    },
    {
      // NO-3: releases legacy-path deliveries held for quiet hours; survives restarts.
      name: "quiet-hours-release",
      pattern: "* * * * *",
      handler: runQuietHoursRelease,
    },
    {
      name: "attachment-pending-cleanup",
      pattern: "0 * * * *",
      handler: cleanupPendingAttachments,
    },
    {
      name: "attachment-gc",
      pattern: "30 3 * * *",
      handler: collectDeletedAttachments,
    },
    { name: "sla-scan", pattern: "*/5 * * * *", handler: scanSla },
    {
      name: "due-date-reminders",
      pattern: "*/5 * * * *",
      handler: checkDueDateReminders,
    },
    {
      name: "audit-purge",
      pattern: "0 3 * * *",
      handler: runAuditPurgeJob,
    },
    {
      name: "session-cleanup",
      pattern: "15 3 * * *",
      handler: runSessionCleanup,
    },
    {
      // CF-8: hard-deletes custom fields soft-deleted more than 30 days ago (legal-hold aware).
      name: "custom-field-purge",
      pattern: "45 3 * * *",
      handler: runCustomFieldPurgeJob,
    },
    {
      name: "pending-action-expire",
      pattern: "* * * * *",
      handler: expirePendingActions,
    },
    {
      name: "reminder-scan",
      pattern: "*/15 * * * *",
      handler: runReminderScan,
    },
    {
      // WF-19: fires due `scheduled_transition` rows as a system actor, every minute.
      name: "scheduled-transition",
      pattern: "* * * * *",
      handler: scanScheduledTransitions,
    },
    {
      name: "position-rebalance",
      pattern: "*/5 * * * *",
      handler: () => runPositionRebalanceJob(),
    },
    {
      // GM-7: ends impersonation sessions that reached their 30-minute cap without an exit.
      name: "impersonation-cap",
      pattern: "* * * * *",
      handler: () => sweepExpiredImpersonations(),
    },
    {
      // IP-25: pings each enabled identity connection's OIDC discovery document.
      name: "plugin-health",
      pattern: "*/10 * * * *",
      handler: () => checkIdentityConnectionHealth(),
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

  // On-demand jobs (background-jobs.md): registered so God Mode lists them and a lease name
  // exists, but never fired by a clock. The elevated trigger route runs the body directly with
  // the acting administrator, so the audit row names a person.
  for (const definition of [
    {
      name: SECRETS_REKEY_JOB,
      pattern: "0 0 1 1 *",
      handler: () => runSecretsRekeyJob({ userId: null }),
    },
  ]) {
    const job = new Cron(
      definition.pattern,
      { paused: true },
      withCheckIn(definition.name, definition.handler),
    );
    jobs.push(job);
    registeredByName.set(definition.name, job);
  }

  console.log(
    "⏰ Scheduler started (outbox drain every 30 seconds, SLA scan every 5 minutes, due-date reminders every 5 minutes, audit purge daily 03:00, session cleanup with soft-delete purge daily 03:15, custom-field purge daily 03:45, pending-action expiry every minute, reminder scan every 15 minutes, scheduled transitions every minute, position rebalance every 5 minutes)",
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
