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

function errorLabel(error: unknown): string {
  return error instanceof Error && /^[A-Za-z0-9_]{1,64}$/.test(error.name)
    ? error.name
    : "Error";
}

export async function drainNotificationDigests({
  budgetMs = 240_000,
  maxGroups = 100,
  send,
}: {
  budgetMs?: number;
  maxGroups?: number;
  send?: Parameters<typeof processNextNotificationDigest>[0];
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
  } catch (error) {
    console.error(
      JSON.stringify({
        job: NOTIFICATION_DIGEST_JOB,
        phase: "seal",
        error: errorLabel(error),
      }),
    );
    outcome.degraded = true;
    return outcome;
  }
  while (outcome.processed < maxGroups && Date.now() - startedAt < budgetMs) {
    await assertJobExecutionOwned();
    try {
      const result = send
        ? await processNextNotificationDigest(send)
        : await processNextNotificationDigest();
      if (result.kind === "idle") break;
      outcome.processed++;
      if (result.outcome === "delivered") outcome.delivered++;
      if (result.outcome === "deferred") outcome.deferred++;
      if (result.outcome === "retry") {
        outcome.retry++;
        outcome.degraded = true;
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          job: NOTIFICATION_DIGEST_JOB,
          phase: "deliver",
          error: errorLabel(error),
        }),
      );
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
