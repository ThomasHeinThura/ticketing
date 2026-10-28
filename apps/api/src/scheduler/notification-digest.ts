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

export async function runNotificationDigest(): Promise<NotificationDigestRun> {
  const startedAt = Date.now();
  try {
    const outcome = await withJobLease(
      NOTIFICATION_DIGEST_JOB,
      async () => {
        const sealed = await sealDueDigestGroups();
        let processed = 0;
        let delivered = 0;
        let deferred = 0;
        let retry = 0;
        let degraded = false;
        for (
          ;
          processed < 5 && Date.now() - startedAt < 240_000;
          processed += 1
        ) {
          await assertJobExecutionOwned();
          const result = await processNextNotificationDigest();
          if (result.kind === "idle") break;
          if (result.outcome === "delivered") delivered += 1;
          if (result.outcome === "deferred") deferred += 1;
          if (result.outcome === "retry") {
            retry += 1;
            degraded = true;
          }
        }
        return { sealed, processed, delivered, deferred, retry, degraded };
      },
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
