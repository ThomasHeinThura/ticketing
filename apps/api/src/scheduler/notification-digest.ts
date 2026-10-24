import { sealDueDigestGroups } from "../notification/digest-seal";
import { withJobLease } from "./leader-lock";

// background-jobs.md: `notification-digest`, hourly, lease TTL 5 minutes.
export const NOTIFICATION_DIGEST_JOB = "notification-digest";
export const NOTIFICATION_DIGEST_LEASE_MS = 5 * 60 * 1000;

export async function runNotificationDigest(): Promise<{ sealed: number }> {
  const startedAt = Date.now();
  try {
    const outcome = await withJobLease(
      NOTIFICATION_DIGEST_JOB,
      async () => ({ sealed: await sealDueDigestGroups() }),
      () => ({ sealed: 0 }),
      NOTIFICATION_DIGEST_LEASE_MS,
    );
    console.log(
      JSON.stringify({
        job: NOTIFICATION_DIGEST_JOB,
        durationMs: Date.now() - startedAt,
        itemsProcessed: outcome.sealed,
        outcome: "ok",
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
