import { Cron } from "croner";
import { runCycleSnapshotJob } from "../agile/cycle-snapshot-job";
import {
  AUTOMATION_SCHEDULE_JOB,
  runAutomationSchedule,
} from "../automation/schedule";
import { runCustomerInvitationDeliveryJob } from "../customer-invitation/delivery/worker";
import { checkIdentityConnectionHealth } from "../identity/connection-health";
import { sweepExpiredImpersonations } from "../instance/impersonation/finish";
import {
  readJobConfigurations,
  runScheduledJobWithHistory,
  startJobRunWorker,
} from "../instance/jobs/runtime";
import { logTaskDesk } from "../instance/observability/runtime";
import type { ServingRole } from "../runtime-role";
import {
  cleanupPendingAttachments,
  collectDeletedAttachments,
} from "./attachment-cleanup";
import { runAuditPurgeJob } from "./audit-purge";
import { runCustomFieldPurgeJob } from "./custom-field-purge";
import { checkDueDateReminders } from "./due-date-reminders";
import { runImportPreviewCleanup } from "./import-preview-cleanup";
import { IMPORT_RUN_JOB, runImportRunSweep } from "./import-run";
import { runNotificationDigest } from "./notification-digest";
import { runQuietHoursRelease } from "./notification-digest-release";
import { drainOutbox } from "./outbox-drain";
import { runPagePurgeJob } from "./page-purge";
import { expirePendingActions } from "./pending-action-expire";
import { runPositionRebalanceJob } from "./position-rebalance-job";
import { runReminderScan } from "./reminder-scan";
import {
  METRICS_SNAPSHOT_JOB,
  REPORT_EXPORT_JOB,
  runMetricsSnapshot,
  runReportExport,
} from "./report-jobs";
import { scanScheduledTransitions } from "./scheduled-transition";
import { runSecretsRekeyJob, SECRETS_REKEY_JOB } from "./secrets-rekey";
import { runSessionCleanup } from "./session-cleanup";
import { scanSla } from "./sla-scan";
import { runTimerSweeper, TIMER_SWEEPER_JOB } from "./timer-sweeper";

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

export type RegisteredJobDefinition = {
  name: string;
  pattern: string;
  handler: () => Promise<unknown>;
  timezone?: string;
  manualRunAllowed?: boolean;
  /** Independently controls clock scheduling; manual admission is a separate policy. */
  onDemand?: true;
};

let registeredDefinitions: readonly RegisteredJobDefinition[] = [];
const runtimeConfigurationSignature = new Map<string, string>();
const runtimeJobEnabled = new Map<string, boolean>();
// Owned jobs whose latest persisted override failed to build a Cron: not retried or re-logged until it changes.
const rejectedConfigurationSignature = new Map<string, string>();
// Refreshes run one at a time per lifecycle: a read in flight plus at most one coalesced follow-up read.
type RefreshFlight = { generation: number; promise: Promise<void> };
let refreshRunning: RefreshFlight | undefined;
let refreshQueued: RefreshFlight | undefined;
let configurationPoll: ReturnType<typeof setInterval> | undefined;
let stopManualWorker: (() => Promise<void>) | undefined;
let schedulerRole: ServingRole = "all";
let schedulerGeneration = 0;

const inFlightRuns = new Set<Promise<unknown>>();
export const DEFAULT_SCHEDULER_SHUTDOWN_TIMEOUT_MS = 10_000;
let shutdownTimeoutMs = DEFAULT_SCHEDULER_SHUTDOWN_TIMEOUT_MS;

export function setSchedulerShutdownTimeoutForTest(timeoutMs: number): void {
  shutdownTimeoutMs = timeoutMs;
}

type JobOutcome = { degraded?: boolean };

function safeJobTraceId(name: string): string | undefined {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(name) ? name : undefined;
}

// Cron jobs swallow their operational failures (per-item try/catch) so they
// can keep processing the rest of the batch, which means the thrown-rejection
// channel alone would report "ok" for a partially failed run. The returned
// outcome is inspected instead, so a handled failure is still visible.
function withCheckIn<T>(name: string, fn: () => Promise<T>) {
  return (): Promise<void> => {
    const traceId = safeJobTraceId(name);
    const run = (async () => {
      try {
        const result = await runScheduledJobWithHistory(name, fn);
        const degraded = Boolean(
          (result as JobOutcome | null | undefined)?.degraded,
        );
        if (degraded) {
          logTaskDesk({
            module: "jobs",
            message: "jobs.failure",
            level: "warn",
            result: "degraded",
            ...(traceId ? { traceId } : {}),
          });
          console.warn(`Cron job ${name} completed with handled failures`);
        }
      } catch (error) {
        logTaskDesk({
          module: "jobs",
          message: "jobs.failure",
          level: "error",
          result: "failed",
          ...(traceId ? { traceId } : {}),
        });
        console.error(`Cron job ${name} failed`, error);
      }
    })();
    inFlightRuns.add(run);
    void run.finally(() => {
      inFlightRuns.delete(run);
    });
    return run;
  };
}

function createRegisteredJobDefinitions(): ReadonlyArray<RegisteredJobDefinition> {
  const definitions: ReadonlyArray<RegisteredJobDefinition> = [
    {
      name: AUTOMATION_SCHEDULE_JOB,
      pattern: "* * * * *",
      handler: runAutomationSchedule,
      timezone: "UTC",
    },
    // background-jobs.md's cadence table.
    {
      name: "outbox-drain",
      pattern: "*/30 * * * * *",
      // Parent event envelopes, immediate children (EV-1/EV-2), P4 consumers, and digest groups.
      handler: drainOutbox,
    },
    {
      // NO-6: seals and drains digest groups whose window has ended.
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
      // PG-7: hard-deletes project pages deleted more than 30 days ago (legal-hold aware).
      name: "page-purge",
      pattern: "50 3 * * *",
      handler: runPagePurgeJob,
    },
    {
      name: "pending-action-expire",
      pattern: "* * * * *",
      handler: expirePendingActions,
    },
    {
      name: "import-preview-cleanup",
      pattern: "* * * * *",
      handler: runImportPreviewCleanup,
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
      // TC-6: stops timers left running past the 12 h cap into capped, review-flagged entries.
      name: TIMER_SWEEPER_JOB,
      pattern: "*/15 * * * *",
      handler: runTimerSweeper,
    },
    {
      // RP-9: stores closed days of the SLA and throughput metrics (day grain, aggregates only).
      name: METRICS_SNAPSHOT_JOB,
      pattern: "0 * * * *",
      handler: () => runMetricsSnapshot(),
    },
    {
      // CY-9: also snapshots cycles completed by their end date without a UI action.
      name: "cycle-snapshot",
      pattern: "15 0 * * *",
      timezone: "UTC",
      handler: () => runCycleSnapshotJob(),
    },
    {
      // RP-10: renders queued large exports; also started right after one is queued.
      name: REPORT_EXPORT_JOB,
      pattern: "* * * * *",
      handler: () => runReportExport(),
    },
    {
      // IP-25: pings each enabled identity connection's OIDC discovery document.
      name: "plugin-health",
      pattern: "*/10 * * * *",
      handler: () => checkIdentityConnectionHealth(),
    },
  ];
  return definitions;
}

function createWebPollerDefinitions(): ReadonlyArray<RegisteredJobDefinition> {
  return [
    {
      name: "customer-invitation-delivery",
      pattern: "* * * * *",
      handler: runCustomerInvitationDeliveryJob,
      manualRunAllowed: false,
    },
  ];
}

function createOnDemandJobDefinitions(): ReadonlyArray<RegisteredJobDefinition> {
  return [
    {
      name: SECRETS_REKEY_JOB,
      onDemand: true,
      pattern: "0 0 1 1 *",
      handler: () => runSecretsRekeyJob({ userId: null }),
      manualRunAllowed: false,
    },
    {
      // P6: executes engine import runs as their starter; started by /execute and /resume (resume
      // also re-kicks a run left `running`). Not clock-fired and not manually runnable: the
      // sweep handler exists for the job registry only.
      name: IMPORT_RUN_JOB,
      onDemand: true,
      pattern: "0 0 1 1 *",
      handler: () => runImportRunSweep(),
      manualRunAllowed: false,
    },
  ];
}

export function initializeScheduler(role: ServingRole = "all"): void {
  if (jobs.length > 0) return;
  schedulerGeneration += 1;
  schedulerRole = role;
  const definitions = createRegisteredJobDefinitions();
  const webPollerDefinitions = createWebPollerDefinitions();
  const onDemandDefinitions = createOnDemandJobDefinitions();
  registeredDefinitions = [
    ...definitions,
    ...webPollerDefinitions,
    ...onDemandDefinitions,
  ];

  for (const definition of registeredDefinitions) {
    const ownedByRole =
      definition.name === "customer-invitation-delivery"
        ? role !== "jobs"
        : role !== "web";
    if (!ownedByRole) continue;
    const job = new Cron(
      definition.pattern,
      // Do not let the default cadence fire before persisted disable/override state has
      // loaded successfully. The refresh below replaces and starts the Cron atomically.
      { timezone: definition.timezone, paused: true },
      withCheckIn(definition.name, definition.handler),
    );
    jobs.push(job);
    registeredByName.set(definition.name, job);
  }

  // On-demand jobs (background-jobs.md): registered so God Mode lists them and a lease name
  // exists, but never fired by a clock. The elevated trigger route runs the body directly with
  // the acting administrator, so the audit row names a person.
  for (const definition of registeredDefinitions) {
    runtimeJobEnabled.set(definition.name, false);
  }
  if (role !== "web") {
    stopManualWorker = startJobRunWorker(
      (name) =>
        registeredDefinitions.find(
          (definition) =>
            definition.name === name && definition.manualRunAllowed !== false,
        )?.handler,
    );
  }
  void refreshRegisteredJobConfiguration();
  configurationPoll = setInterval(() => {
    void refreshRegisteredJobConfiguration();
  }, 5_000);
  configurationPoll.unref?.();

  if (role === "web") {
    console.log(
      "⏰ Customer invitation delivery poller started (every minute)",
    );
  } else {
    console.log(
      "⏰ Scheduler started (outbox drain every 30 seconds, SLA scan every 5 minutes, due-date reminders every 5 minutes, audit purge daily 03:00, session cleanup with soft-delete purge daily 03:15, custom-field purge daily 03:45, pending-action expiry every minute, reminder scan every 15 minutes, scheduled transitions every minute, position rebalance every 5 minutes)",
    );
  }
}

function startRefresh(
  generation: number,
  after?: Promise<void>,
): RefreshFlight {
  const flight: RefreshFlight = { generation, promise: Promise.resolve() };
  flight.promise = (async () => {
    if (after) {
      await after.catch(() => {});
      if (refreshQueued === flight) refreshQueued = undefined;
      // A shut-down lifecycle's queued refresh must not touch the current one.
      if (generation !== schedulerGeneration) return;
    }
    refreshRunning = flight;
    try {
      await applyJobConfiguration();
    } finally {
      if (refreshRunning === flight) refreshRunning = undefined;
    }
  })();
  return flight;
}

export function refreshRegisteredJobConfiguration(): Promise<void> {
  const generation = schedulerGeneration;
  if (refreshQueued?.generation === generation) return refreshQueued.promise;
  if (refreshRunning?.generation === generation) {
    refreshQueued = startRefresh(generation, refreshRunning.promise);
    return refreshQueued.promise;
  }
  return startRefresh(generation).promise;
}

async function applyJobConfiguration(): Promise<void> {
  const generation = schedulerGeneration;
  const configurable = registeredDefinitions.filter(
    (definition) => definition.onDemand !== true,
  );
  if (configurable.length === 0) return;
  try {
    const configurations = await readJobConfigurations(
      configurable.map((definition) => definition.name),
    );
    if (
      generation !== schedulerGeneration ||
      registeredDefinitions.length === 0
    ) {
      return;
    }
    for (const definition of configurable) {
      const config = configurations.get(definition.name);
      const pattern = config?.pattern ?? definition.pattern;
      const enabled = config?.enabled ?? true;
      const signature = `${enabled}\u0000${pattern}\u0000${config?.version ?? 0}`;
      const unchanged =
        runtimeConfigurationSignature.get(definition.name) === signature;
      const ownsJob =
        definition.name === "customer-invitation-delivery"
          ? schedulerRole !== "jobs"
          : schedulerRole !== "web";
      if (!ownsJob) {
        runtimeConfigurationSignature.set(definition.name, signature);
        runtimeJobEnabled.set(definition.name, enabled);
        continue;
      }
      if (unchanged && registeredByName.has(definition.name)) {
        // The applied signature is back, so a rejected override may be reported again.
        rejectedConfigurationSignature.delete(definition.name);
        continue;
      }
      if (rejectedConfigurationSignature.get(definition.name) === signature)
        continue;

      let replacement: Cron;
      try {
        replacement = new Cron(
          pattern,
          { timezone: definition.timezone, paused: !enabled },
          withCheckIn(definition.name, definition.handler),
        );
      } catch {
        const traceId = safeJobTraceId(definition.name);
        logTaskDesk({
          module: "jobs",
          message: "jobs.failure",
          level: "warn",
          result: "degraded",
          ...(traceId ? { traceId } : {}),
        });
        // A malformed persisted override replaces neither the running job nor its published state.
        rejectedConfigurationSignature.set(definition.name, signature);
        continue;
      }
      rejectedConfigurationSignature.delete(definition.name);
      runtimeConfigurationSignature.set(definition.name, signature);
      runtimeJobEnabled.set(definition.name, enabled);
      const previous = registeredByName.get(definition.name);
      previous?.stop();
      if (previous) {
        registeredByName.delete(definition.name);
        const index = jobs.indexOf(previous);
        if (index >= 0) jobs.splice(index, 1);
      }
      jobs.push(replacement);
      registeredByName.set(definition.name, replacement);
    }
  } catch {
    if (generation !== schedulerGeneration) return;
    logTaskDesk({
      module: "jobs",
      message: "jobs.failure",
      level: "error",
      result: "degraded",
    });
    // Keep the last known scheduler configuration on database/configuration failure.
  }
}

export type RegisteredJobStatus = {
  name: string;
  defaultPattern: string | null;
  timezone: string | null;
  enabled: boolean;
  nextRunAt: Date | null;
  manualRunAllowed: boolean;
};

/** Computes a display-only next invocation without starting a scheduler worker. */
export function nextScheduledAt(
  pattern: string,
  timezone?: string | null,
): Date | null {
  try {
    const cron = new Cron(pattern, {
      timezone: timezone ?? undefined,
      paused: true,
    });
    const next = cron.nextRun() ?? null;
    cron.stop();
    return next;
  } catch {
    return null;
  }
}

/** Live registration catalog, without the God Mode discovery fallback. */
export function liveRegisteredJobCatalog(): readonly RegisteredJobStatus[] {
  const names = new Set(registeredDefinitions.map((job) => job.name));
  return registeredJobCatalog().filter((job) => names.has(job.name));
}

/** Exact job names and live schedule state registered in this process. */
export function registeredJobCatalog(): readonly RegisteredJobStatus[] {
  const definitions =
    registeredDefinitions.length > 0
      ? registeredDefinitions
      : [
          ...createRegisteredJobDefinitions(),
          ...createWebPollerDefinitions(),
          ...createOnDemandJobDefinitions(),
        ];
  return definitions.map((definition) => {
    const cron = registeredByName.get(definition.name);
    const enabled =
      definition.onDemand === true
        ? true
        : (runtimeJobEnabled.get(definition.name) ?? true);
    return {
      name: definition.name,
      defaultPattern: definition.onDemand === true ? null : definition.pattern,
      timezone: definition.timezone ?? null,
      enabled,
      nextRunAt:
        definition.onDemand === true || !enabled
          ? null
          : (cron?.nextRun() ??
            nextScheduledAt(definition.pattern, definition.timezone)),
      manualRunAllowed: definition.manualRunAllowed !== false,
    };
  });
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

export function shutdownScheduler(): Promise<void> {
  schedulerGeneration += 1;
  if (configurationPoll) clearInterval(configurationPoll);
  configurationPoll = undefined;
  const manualDrain = stopManualWorker?.();
  stopManualWorker = undefined;
  for (const job of jobs) {
    job.stop();
  }
  jobs.length = 0;
  registeredByName.clear();
  registeredDefinitions = [];
  runtimeConfigurationSignature.clear();
  runtimeJobEnabled.clear();
  rejectedConfigurationSignature.clear();
  refreshRunning = undefined;
  refreshQueued = undefined;
  schedulerRole = "all";

  if (inFlightRuns.size === 0 && !manualDrain) {
    return Promise.resolve();
  }

  const pending = [...inFlightRuns];
  if (manualDrain) pending.push(manualDrain);
  const timeoutMs = shutdownTimeoutMs;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const safetyTimeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(resolve, timeoutMs);
    timeoutHandle.unref?.();
  });

  return Promise.race([
    Promise.allSettled(pending).then(() => undefined),
    safetyTimeout,
  ]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });
}
