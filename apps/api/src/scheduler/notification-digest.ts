import { processNextNotificationDigest } from "../notification/digest-delivery";
import { sealDueDigestGroups } from "../notification/digest-seal";
import { assertJobExecutionOwned, withJobLease } from "./leader-lock";

// background-jobs.md: `notification-digest`, hourly, lease TTL 5 minutes.
export const NOTIFICATION_DIGEST_JOB = "notification-digest";
export const NOTIFICATION_DIGEST_LEASE_MS = 5 * 60 * 1000;

export type NotificationDigestRun = {
  sealed: number;
  processed: number;
  delivered: number;
  deferred: number;
  retry: number;
  degraded: boolean;
};

export async function drainNotificationDigests({
  budgetMs = 240_000,
  maxGroups = 100,
}: {
  budgetMs?: number;
  maxGroups?: number;
} = {}): Promise<NotificationDigestRun> {
  const startedAt = Date.now();
  const outcome: NotificationDigestRun = {
    sealed: 0,
    processed: 0,
    delivered: 0,
    deferred: 0,
    retry: 0,
    degraded: false,
  };
  try {
    outcome.sealed = await sealDueDigestGroups();
  } catch {
    outcome.degraded = true;
    return outcome;
  }
  while (outcome.processed < maxGroups && Date.now() - startedAt < budgetMs) {
    await assertJobExecutionOwned();
    try {
      const result = await processNextNotificationDigest();
      if (result.kind === "idle") break;
      outcome.processed++;
      if (result.outcome === "delivered") outcome.delivered++;
      if (result.outcome === "deferred") outcome.deferred++;
      if (result.outcome === "retry") {
        outcome.retry++;
        outcome.degraded = true;
      }
    } catch {
      outcome.degraded = true;
      break;
    }
  }
  return outcome;
}

export async function runNotificationDigest(): Promise<NotificationDigestRun> {
  const startedAt = Date.now();
  try {
    const outcome = await withJobLease(
      NOTIFICATION_DIGEST_JOB,
      () => drainNotificationDigests(),
      () => ({
        sealed: 0,
        processed: 0,
        delivered: 0,
        deferred: 0,
        retry: 0,
        degraded: false,
      }),
      NOTIFICATION_DIGEST_LEASE_MS,
    );
    console.log(
      JSON.stringify({
        job: NOTIFICATION_DIGEST_JOB,
        durationMs: Date.now() - startedAt,
        itemsProcessed: outcome.sealed + outcome.processed,
        outcome: outcome.degraded ? "degraded" : "ok",
      }),
    );
    return outcome;
  } catch (error) {
    console.log(
      JSON.stringify({
        job: NOTIFICATION_DIGEST_JOB,
        durationMs: Date.now() - startedAt,
        itemsProcessed: null,
        outcome: "failed",
      }),
    );
    throw error;
  }
}
