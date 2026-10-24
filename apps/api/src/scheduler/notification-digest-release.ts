import {
  claimDueHeldDeliveries,
  clearDeliveryHold,
} from "../notification-preferences/delivery.repository";
import { withJobLease } from "./leader-lock";

// Releases legacy-path deliveries held for quiet hours (`NO-3`) once the window ends. The hold
// is a durable marker on the notification row, so this survives a restart: the first run after
// the window releases whatever the previous process held.
export const QUIET_HOURS_RELEASE_JOB = "quiet-hours-release";
// Delivery is sequential and each row may call slow external endpoints (up to ~15 s per
// attempt, several channels), so the worst-case batch is BATCH x ~30 s = 10 min. The job lease
// must cover that, and the per-row claim lease must outlive the job lease: a later run can then
// never re-claim a row this run is still delivering. Delivery stays at-least-once: a crash
// between send and `clearDeliveryHold` re-sends once the claim lease lapses.
export const QUIET_HOURS_RELEASE_LEASE_MS = 15 * 60 * 1000;
const BATCH = 20;
// A held row older than this is abandoned (the in-app row is unaffected).
const MAX_HOLD_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// How long a claimed row is owned before another replica may retry it.
const CLAIM_LEASE_MS = 20 * 60 * 1000;

export async function releaseHeldNotifications(
  now: Date = new Date(),
): Promise<{ released: number; degraded: boolean }> {
  const { deliverNotification } = await import(
    "../notification-preferences/delivery"
  );
  const claimed = await claimDueHeldDeliveries(
    now,
    CLAIM_LEASE_MS,
    BATCH,
    MAX_HOLD_AGE_MS,
  );
  let degraded = false;
  for (const { id, lease } of claimed) {
    try {
      // Re-evaluates quiet hours: a changed window re-holds the row under a new marker.
      await deliverNotification(id);
    } catch (error) {
      degraded = true;
      console.error("Held notification release failed", {
        notificationId: id,
        error,
      });
      continue;
    }
    await clearDeliveryHold(id, lease);
  }
  return { released: claimed.length, degraded };
}

export async function runQuietHoursRelease(): Promise<{
  released: number;
  degraded: boolean;
}> {
  return withJobLease(
    QUIET_HOURS_RELEASE_JOB,
    () => releaseHeldNotifications(),
    () => ({ released: 0, degraded: false }),
    QUIET_HOURS_RELEASE_LEASE_MS,
  );
}
