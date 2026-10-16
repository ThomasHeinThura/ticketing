import { and, between, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import db from "../database";
import {
  columnTable,
  taskReminderSentTable,
  taskTable,
  userNotificationPreferenceTable,
} from "../database/schema";
import { dbNowUtc } from "../utils/db-time";

/**
 * Query ownership for the scheduler (issue #580): job leases, due-date reminder reads and
 * writes, and the session-cleanup purges. Every function awaits and returns plain values.
 * SQL moved verbatim from the job modules; the UTC wall-clock conventions in their doc
 * comments (`utils/db-time.ts`) are unchanged.
 */

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
const NOT_UNDER_OPEN_LEGAL_HOLD_FOR_SESSION = sql`
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

/** Deletes expired sessions not under an open legal hold; returns the row count. */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM "session"
    WHERE "session"."expires_at" <= ${dbNowUtc()}
      AND ${NOT_UNDER_OPEN_LEGAL_HOLD_FOR_SESSION};
  `);

  return result.rowCount ?? 0;
}

/** Deletes expired dedupe reservations (not hold-filtered); returns the row count. */
export async function purgeExpiredOutboxReservations(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM "outbox_dedupe_reservation"
    WHERE "lease_expires_at" <= clock_timestamp() AT TIME ZONE 'UTC';
  `);

  return result.rowCount ?? 0;
}

/**
 * Takes `name`'s lease when it is free or expired (UTC wall clock on both sides, see
 * `withJobLease`); returns whether this owner now holds it.
 */
export async function claimJobLease(
  name: string,
  owner: string,
  ttl: string,
): Promise<boolean> {
  const claimed = await db.execute(sql`
    INSERT INTO job_lease ("name", "owner", "expires_at")
    VALUES (${name}, ${owner}, ${dbNowUtc()} + ${ttl}::interval)
    ON CONFLICT ("name") DO UPDATE
      SET "owner" = EXCLUDED."owner", "expires_at" = EXCLUDED."expires_at"
      WHERE job_lease."expires_at" < ${dbNowUtc()}
    RETURNING "name";
  `);

  return (claimed.rowCount ?? 0) !== 0;
}

/** Releases the lease only if this owner still holds it. */
export async function releaseJobLease(
  name: string,
  owner: string,
): Promise<void> {
  await db.execute(
    sql`DELETE FROM job_lease WHERE "name" = ${name} AND "owner" = ${owner};`,
  );
}

export type ReminderType = "configured_before" | "overdue";

/** Tasks with a due date in the window that have not yet been reminded of this type. */
export async function listTasksNeedingReminder(
  windowStart: Date,
  windowEnd: Date,
  reminderType: ReminderType,
) {
  return db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      userId: taskTable.userId,
      dueDate: taskTable.dueDate,
      projectId: taskTable.projectId,
      leadTimeMinutes:
        userNotificationPreferenceTable.dueDateReminderLeadTimeMinutes,
    })
    .from(taskTable)
    .leftJoin(columnTable, eq(taskTable.columnId, columnTable.id))
    .leftJoin(
      userNotificationPreferenceTable,
      eq(userNotificationPreferenceTable.userId, taskTable.userId),
    )
    .leftJoin(
      taskReminderSentTable,
      and(
        eq(taskReminderSentTable.taskId, taskTable.id),
        eq(taskReminderSentTable.reminderType, reminderType),
      ),
    )
    .where(
      and(
        isNotNull(taskTable.userId),
        isNotNull(taskTable.dueDate),
        reminderType === "configured_before"
          ? sql`${taskTable.dueDate} - (COALESCE(${userNotificationPreferenceTable.dueDateReminderLeadTimeMinutes}, 1440) * interval '1 minute') BETWEEN ${windowStart.toISOString()} AND ${windowEnd.toISOString()}`
          : between(taskTable.dueDate, windowStart, windowEnd),
        isNull(taskReminderSentTable.id),
        or(
          isNull(userNotificationPreferenceTable.id),
          eq(userNotificationPreferenceTable.dueDateReminderEnabled, true),
        ),
        // Exclude tasks in final columns (completed); include tasks with no column
        or(isNull(columnTable.isFinal), eq(columnTable.isFinal, false)),
      ),
    );
}

/** Records the reminder; `undefined` when it was already recorded for this task and type. */
export async function insertReminderSent(
  taskId: string,
  reminderType: ReminderType,
) {
  const [inserted] = await db
    .insert(taskReminderSentTable)
    .values({ taskId, reminderType })
    .onConflictDoNothing({
      target: [
        taskReminderSentTable.taskId,
        taskReminderSentTable.reminderType,
      ],
    })
    .returning();
  return inserted;
}
