import { sql } from "drizzle-orm";
import db from "../database";
import { withJobLease } from "./leader-lock";

/**
 * `session-cleanup` — `docs/01-architecture/background-jobs.md`.
 *
 * The spec is: "Expired sessions, invitations, idempotency keys, soft-deleted rows past
 * their window — **the soft-delete purge skips any row whose organisation or person is
 * under an open `legal_hold`**, and leaves it soft-deleted until the hold lifts."
 *
 * **Only the expired-sessions half is implemented here, deliberately and visibly.** The
 * other three cannot be built correctly yet, and each for a concrete, checkable reason:
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
 * a scope, not of re-deriving the hold rule.
 */

// background-jobs.md's table: `session-cleanup`, cadence daily 03:15, lease TTL 5 minutes.
const LEASE_NAME = "session-cleanup";
const LEASE_MS = 5 * 60 * 1000;

export type SessionCleanupOutcome = {
  sessionsDeleted: number;
};

/**
 * The hold rule, in one place.
 *
 * A row is covered by an open hold when the *person* it belongs to is held, or that person's
 * *organisation* is. Both are reached through `person` — for a `session` that is
 * `session.user_id → person.user_id`, which is why this predicate can be written today while
 * the project purge's cannot (`person.organisation_id` exists; `workspace.organisation_id`
 * does not).
 *
 * `lifted_at is null` is the definition of "open" (`data-model.md` §2: "An **open** row
 * (`lifted_at is null`) suspends ... every hard delete for that scope"). The partial unique
 * index on the table means there is at most one open hold per scope, so this can never
 * double-count.
 *
 * Written as `NOT EXISTS` rather than a join or a NOT IN: it short-circuits per row, it does
 * not change the row count of the statement it is embedded in (a join against a second
 * matching hold would duplicate rows and make `rowCount` wrong), and it is NULL-safe in the
 * way that matters here — if the person row is missing, or its `organisation_id` is null,
 * every comparison is NULL, the subquery yields no rows, and the row is treated as *not*
 * held. That is correct for a session: a user with no `person` row yet is not a tenant's
 * retained data. It would NOT be correct for a project, which is part of why that half is
 * not here.
 */
export const NOT_UNDER_OPEN_LEGAL_HOLD_FOR_SESSION = sql`
  NOT EXISTS (
    SELECT 1
    FROM "legal_hold"
    LEFT JOIN "person" ON "person"."user_id" = "session"."user_id"
    WHERE "legal_hold"."lifted_at" IS NULL
      AND (
        ("legal_hold"."scope" = 'person'
          AND "legal_hold"."scope_id" = "person"."id")
        OR ("legal_hold"."scope" = 'organisation'
          AND "legal_hold"."scope_id" = "person"."organisation_id")
      )
  )
`;

/**
 * Deletes sessions that have already expired, minus any held scope's.
 *
 * A single statement rather than a chunked loop: the work is entirely in the database, so it
 * does not occupy the event loop between batches the way a JavaScript-side iteration would
 * (`background-jobs.md` § Why in-process, on chunking). If this ever needs bounding, the
 * shape is a `WHERE id IN (SELECT id ... LIMIT n)` around the same predicate, not a change to
 * the predicate itself.
 */
export async function deleteExpiredSessions(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM "session"
    WHERE "session"."expires_at" <= now()
      AND ${NOT_UNDER_OPEN_LEGAL_HOLD_FOR_SESSION};
  `);

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
 * operator the schedule is firing at all. The Prometheus counters and the OTel span that
 * section also names are the seam `observability.md` owns; they are not invented here, and
 * this log is what they will replace rather than sit beside.
 */
export async function runSessionCleanup(): Promise<SessionCleanupOutcome> {
  const startedAt = Date.now();

  const outcome = await withJobLease(
    LEASE_NAME,
    async () => ({ sessionsDeleted: await deleteExpiredSessions() }),
    // Held elsewhere: not an error, and not this replica's work to do.
    () => ({ sessionsDeleted: 0 }),
    LEASE_MS,
  );

  console.log(
    JSON.stringify({
      job: LEASE_NAME,
      durationMs: Date.now() - startedAt,
      itemsProcessed: outcome.sessionsDeleted,
      outcome: "ok",
    }),
  );

  return outcome;
}
