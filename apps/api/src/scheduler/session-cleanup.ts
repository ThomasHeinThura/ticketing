import { withJobLease } from "./leader-lock";
import {
  purgeExpiredOutboxReservations,
  purgeExpiredSessions,
} from "./repository";

/**
 * `session-cleanup` — `docs/01-architecture/background-jobs.md`.
 *
 * The spec is: "Expired sessions, invitations, idempotency keys, soft-deleted rows past
 * their window — **the soft-delete purge skips any row whose organisation or person is
 * under an open `legal_hold`**, and leaves it soft-deleted until the hold lifts."
 *
 * The expired-session and expired-notification-reservation purges are implemented here.
 * The other three cleanup families cannot be built correctly yet, each for a concrete,
 * checkable reason:
 *
 * - **Soft-deleted rows past their window.** Hold-awareness needs to know a row's
 *   *organisation*, and for the two tables that actually carry `deleted_at`/`purge_after`
 *   today that is not always derivable:
 *   - `organisation` — derivable: the row's own id is the hold's `scope_id`.
 *   - `project` — **not derivable.** `multi-tenancy.md`'s hierarchy is
 *     Organisation → Workspace → Project, but the live `workspace` table has no
 *     `organisation_id` column and `project` has none either, so nothing links a project to
 *     the tenant a hold applies to. Purging a project without that link would hard-delete
 *     an organisation's data *while a hold on that organisation is open*, which is the one
 *     thing a legal hold exists to prevent. This is the reason the project purge is absent
 *     rather than merely omitted — it needs `workspace.organisation_id` (or
 *     `project.organisation_id`, per `projects-and-engagements.md` PR-19) to exist first.
 * - **Invitations** — the predicate is not obvious from the schema alone (an expired row
 *   that was already accepted is not a candidate), so it wants its own reading of
 *   `IP-*` rather than a guess here.
 * - **Idempotency keys** — there is no such table in `apps/api/src/database/schema.ts`
 *   yet, so there is nothing to purge.
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
  outcome: "ok" | "failed",
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

  try {
    const outcome = await withJobLease(
      LEASE_NAME,
      async () => {
        const sessionsDeleted = await deleteExpiredSessions();
        const notificationReservationsDeleted =
          await deleteExpiredNotificationReservations();
        return { sessionsDeleted, notificationReservationsDeleted };
      },
      // Held elsewhere: not an error, and not this replica's work to do.
      () => ({ sessionsDeleted: 0, notificationReservationsDeleted: 0 }),
      LEASE_MS,
    );

    logRun(
      startedAt,
      outcome.sessionsDeleted + outcome.notificationReservationsDeleted,
      "ok",
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
