import { sql } from "drizzle-orm";
import db from "../database";
import { deleteExpiredPreferenceHandoffs } from "../notification/preference-handoff.repository";
import { purgeReadNotifications } from "../notification/retention";
import { withJobLease } from "./leader-lock";
import {
  purgeExpiredOutboxReservations,
  purgeExpiredSessions,
} from "./repository";
import {
  purgeSoftDeletedRows,
  type SoftDeletePurgeOutcome,
} from "./soft-delete-purge";

/**
 * `session-cleanup` — `docs/01-architecture/background-jobs.md`.
 *
 * The spec is: "Expired sessions, invitations, idempotency keys, soft-deleted rows past
 * their window — **the soft-delete purge skips any row whose organisation or person is
 * under an open `legal_hold`**, and leaves it soft-deleted until the hold lifts."
 *
 * Expired sessions, notification reservations, preference handoffs, idempotency keys and soft-deleted work
 * items/projects past their 30-day window (`soft-delete-purge.ts`, hold-aware through the
 * workspace/project organisation and the attached people) are purged here. Still absent, each
 * for a concrete reason:
 *
 * - **Soft-deleted organisations** — an organisation purge cascades through every workspace and
 *   is not specified beyond `organisation.purge_after`; it is not attempted.
 * - **Invitations** — the predicate is not obvious from the schema alone (an expired row
 *   that was already accepted is not a candidate), so it wants its own reading of
 *   `IP-*` rather than a guess here.
 * - **Idempotency keys** — purged here once past `expires_at` (`deleteExpiredIdempotencyKeys`).
 * - **Notification/event-envelope retention** — read notifications are purged here (`NO-17`,
 *   `notification/retention.ts`); terminal children, digest groups and terminal parent
 *   envelopes are not purged by this job yet.
 * - **Soft-deleted comments** — not purged by this job yet (review-p0 F20 gap).
 *
 * None of this is a silent omission: it is tracked on issue #198, and the exclusion
 * helper below is written so that adding the remaining halves is a matter of giving each one
 * a scope, not of re-deriving the hold rule. Expired reservations are deliberately exempt
 * from holds: they contain only short-lived coordination identifiers, and lease takeover is
 * governed by the lease timestamp before this daily physical cleanup runs.
 */

// background-jobs.md's table: `session-cleanup`, cadence daily 03:15, lease TTL 5 minutes.
const LEASE_NAME = "session-cleanup";
const LEASE_MS = 5 * 60 * 1000;

export type SessionCleanupOutcome = {
  sessionsDeleted: number;
  notificationReservationsDeleted: number;
  notificationPreferenceHandoffsDeleted: number;
  /** `NO-17`: read notifications past `notification_retention_days`. */
  readNotificationsPurged?: number;
  softDelete: SoftDeletePurgeOutcome;
  degraded: boolean;
};

const NO_SOFT_DELETE_WORK: SoftDeletePurgeOutcome = {
  projectsPurged: 0,
  workItemsPurged: 0,
  awaitingAttachments: 0,
  skipped: 0,
  failed: 0,
  degraded: false,
};

/**
 * Deletes sessions that have already expired, minus any held scope's.
 *
 * The cutoff is `dbNowUtc()`, not `now()`, and that is load-bearing rather than cosmetic:
 * `session.expires_at` is `timestamp without time zone` holding a UTC wall clock (better-auth
 * writes it through the Drizzle column mapper, `Date.prototype.toISOString()`), while `now()`
 * is `timestamptz` and would be coerced through the session's `TimeZone` — the database
 * server's setting. On a server ahead of UTC the unqualified form reads a session that
 * expires in an hour as already expired and **deletes it**; this is the one place in the tree
 * where that mistake destroys rows rather than merely gating a lease. See `utils/db-time.ts`
 * for the measurement, and `tests/api-integration/session-cleanup-server-ahead-of-utc.test.ts`
 * for the regression test.
 *
 * A single statement rather than a chunked loop: the work is entirely in the database, so it
 * does not occupy the event loop between batches the way a JavaScript-side iteration would
 * (`background-jobs.md` § Why in-process, on chunking). If this ever needs bounding, the
 * shape is a `WHERE id IN (SELECT id ... LIMIT n)` around the same predicate, not a change to
 * the predicate itself.
 */
export async function deleteExpiredSessions(): Promise<number> {
  return purgeExpiredSessions();
}

/**
 * Physically removes expired dedupe reservations. `lease_expires_at` is a UTC wall clock
 * stored in `timestamp without time zone`, so compare it with PostgreSQL's current UTC wall
 * clock directly. This purge is intentionally not filtered by legal holds; ownership and
 * delivery history live in their separate retained rows.
 */
export async function deleteExpiredNotificationReservations(): Promise<number> {
  return purgeExpiredOutboxReservations();
}

/**
 * Physically removes idempotency keys past `expires_at` (`idempotency_key`, migration 0130).
 * `expires_at` is `timestamptz`, so `now()` is the correct comparison. Both `done` rows and
 * abandoned `in_flight` rows are removed once expired; a live key is never touched. Not
 * filtered by legal holds: the row holds only a replay cache, not retained business data.
 */
export async function deleteExpiredIdempotencyKeys(): Promise<number> {
  const result = await db.execute(
    sql`DELETE FROM "idempotency_key" WHERE "expires_at" <= now()`,
  );
  return result.rowCount ?? 0;
}

/**
 * The registered job body. Leader-locked: every replica runs the cron, one does the work
 * (`background-jobs.md` § Leasing). Idempotent by construction — a second run finds nothing
 * left to delete, which is what a lease's at-least-once guarantee requires.
 *
 * Emits the structured log line `background-jobs.md` § Observability requires of every run:
 * job name, duration, items processed and outcome. A run that deletes rows is destructive, so
 * it is never silent — including the run that deletes nothing, which is the one that tells an
 * operator the schedule is firing at all, and including the run that fails, whose line is why
 * `outcome` is a field that can ever hold anything but `"ok"`.
 *
 * Deliberately absent from the line: `traceId`. The same section names it, but there is no
 * tracing configured anywhere in this process to take one from, and inventing a field that is
 * always empty is worse than leaving it out with a reason. `traceId`, the Prometheus counters
 * and the OTel span are all the same seam — `observability.md`'s — and land together, at
 * which point this line becomes theirs rather than sitting beside them.
 */
export function logRun(
  startedAt: number,
  itemsProcessed: number | null,
  outcome: "ok" | "degraded" | "failed",
): void {
  console.log(
    JSON.stringify({
      job: LEASE_NAME,
      durationMs: Date.now() - startedAt,
      itemsProcessed,
      outcome,
    }),
  );
}

export async function runSessionCleanup(): Promise<SessionCleanupOutcome> {
  const startedAt = Date.now();
  // Counted in the structured run line only, so the `SessionCleanupOutcome` shape is unchanged.
  let idempotencyKeysDeleted = 0;

  try {
    const outcome = await withJobLease(
      LEASE_NAME,
      async () => {
        const sessionsDeleted = await deleteExpiredSessions();
        const notificationReservationsDeleted =
          await deleteExpiredNotificationReservations();
        const notificationPreferenceHandoffsDeleted =
          await deleteExpiredPreferenceHandoffs();
        idempotencyKeysDeleted = await deleteExpiredIdempotencyKeys();
        // A failure here must not skip the soft-delete purge in the same lease; the run is
        // reported degraded and the next daily run retries.
        let readNotificationsPurged = 0;
        let retentionFailed = false;
        try {
          readNotificationsPurged = await purgeReadNotifications();
        } catch {
          retentionFailed = true;
        }
        const softDelete = await purgeSoftDeletedRows();
        return {
          sessionsDeleted,
          notificationReservationsDeleted,
          notificationPreferenceHandoffsDeleted,
          readNotificationsPurged,
          softDelete,
          degraded: softDelete.degraded || retentionFailed,
        };
      },
      // Held elsewhere: not an error, and not this replica's work to do.
      () => ({
        sessionsDeleted: 0,
        notificationReservationsDeleted: 0,
        notificationPreferenceHandoffsDeleted: 0,
        readNotificationsPurged: 0,
        softDelete: NO_SOFT_DELETE_WORK,
        degraded: false,
      }),
      LEASE_MS,
    );

    logRun(
      startedAt,
      outcome.sessionsDeleted +
        outcome.notificationReservationsDeleted +
        outcome.notificationPreferenceHandoffsDeleted +
        (outcome.readNotificationsPurged ?? 0) +
        idempotencyKeysDeleted +
        outcome.softDelete.projectsPurged +
        outcome.softDelete.workItemsPurged,
      outcome.degraded ? "degraded" : "ok",
    );
    return outcome;
  } catch (error) {
    // The scheduler's own wrapper logs the failure too; this line is not a duplicate of it but
    // the structured record `background-jobs.md` asks of *every* run. `itemsProcessed` is
    // genuinely unknown here — the statement either completed or it did not — so it reports
    // null rather than a fabricated 0.
    logRun(startedAt, null, "failed");
    throw error;
  }
}
