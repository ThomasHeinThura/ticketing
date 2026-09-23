import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable, workItemTable } from "../../database/schema";
import {
  type ActivityActorType,
  diffWorkItemFieldChanges,
  recordWorkItemActivity,
  type WorkItemFieldSnapshot,
} from "../activity";

export type UpdateWorkItemInput = {
  title?: string;
  description?: unknown;
  priority?: "low" | "medium" | "high" | "urgent" | null;
  startDate?: Date | null;
  dueDate?: Date | null;
};

/**
 * Thrown on a `WI-7` version mismatch. Carries both versions so the route handler can
 * build the structured 409 body (`workItemVersionConflictSchema`) -- a plain
 * `HTTPException(409, { message })` cannot carry the extra fields, since Hono's default
 * `getResponse()` only ever emits the message as plain text.
 */
export class WorkItemVersionConflictError extends Error {
  constructor(
    public readonly assertedVersion: number,
    public readonly currentVersion: number,
  ) {
    super(
      `Version mismatch: expected version ${assertedVersion}, but the work item is now at version ${currentVersion}`,
    );
    this.name = "WorkItemVersionConflictError";
  }
}

/**
 * `PATCH /api/work-items/{key}` (`work_item:update`, plus reach -- `require-work-item-
 * reach.ts` already resolved this key to a row's `workspaceId` before this runs, the same
 * middleware `get-work-item.ts` relies on).
 *
 * Implements `WI-7` (optimistic concurrency), `WI-8` (title/description/priority/dates
 * editable by anyone with `work_item:update`) and, as of issue #23's third slice, `WI-6`
 * (every field change writes an `activity` row with the old and new value). Label and
 * custom-field editing (also named in WI-8), state changes (`WI-9`) and assignment
 * (`WI-10`) are explicitly NOT here -- see `schema.ts`'s own comment on
 * `updateWorkItemBody` and this PR's body for why.
 *
 * TRANSACTION DESIGN, and why it changed from the previous single-statement CAS.
 * `WI-6` needs the row's PRE-update values to build `activity.old_value`, and the
 * `UPDATE ... WHERE version = $assertedVersion` clause alone only ever returns the NEW
 * row. Two ways to get the old values without breaking the CAS guarantee (no lost
 * update, no phantom old value) were considered:
 *
 * 1. `UPDATE ... RETURNING` plus an "old row" CTE (`WITH old AS (SELECT ... FOR UPDATE)
 *    UPDATE ... FROM old ...`) -- one round trip, but the CTE's `SELECT` still needs its
 *    own `FOR UPDATE` to be race-free, so it buys nothing over (2) except reducing this
 *    from two statements to one, at the cost of a hand-written CTE Drizzle cannot type
 *    the way it types `.update()`/`.select()`.
 * 2. `SELECT ... FOR UPDATE` to lock and read the current row, THEN the same
 *    `UPDATE ... WHERE version = $assertedVersion` as before -- two statements, still one
 *    transaction, still Drizzle's typed query builder throughout.
 *
 * This picks (2). The row lock the `FOR UPDATE` select takes is what keeps it race-free:
 * once it returns, no OTHER transaction can commit a change to this row until this one
 * commits or rolls back (Postgres blocks a concurrent `UPDATE`/`SELECT ... FOR UPDATE` on
 * the same row until the lock holder finishes), so the values it reads are guaranteed to
 * be the row's true state immediately before this transaction's own `UPDATE` -- exactly
 * what `old_value` must be. A plain (unlocked) `SELECT` here would NOT be race-free: a
 * concurrent writer could commit a change between that `SELECT` and this `UPDATE`, and if
 * the version it left behind happened to equal `assertedVersion` again is impossible
 * (version only ever increases), but the more realistic failure is subtler -- the
 * unlocked `SELECT` could read a stale version while a concurrent commit has already
 * moved the row to a version this `UPDATE`'s `WHERE` then matches, recording the WRONG
 * predecessor values. Locking first closes that.
 *
 * The soft-deleted-project guard is unchanged in effect, kept in TWO places on purpose
 * (closing the same race #204/T3 closed for the previous design): checked once right
 * after the lock (so a project already soft-deleted by lock time is a clean 404, not a
 * spurious version conflict), and again in the final `UPDATE`'s own `WHERE` via the same
 * `projectNotDeleted` EXISTS clause as before (so a project soft-deleted in the narrow
 * window between the lock and this transaction's own `UPDATE` -- by a concurrent
 * transaction that does not touch `work_item` and so is not blocked by this row lock --
 * still fails the write, not silently succeeds). The `version` equality is ALSO kept on
 * the final `UPDATE`'s `WHERE`, redundant with the lock but cheap defence in depth and
 * exactly the same clause the previous design relied on alone.
 *
 * `WI-6`'s rows are written in the SAME transaction as the field update -- if the
 * activity insert fails, the whole update rolls back (`recordWorkItemActivity` is
 * awaited before the transaction returns, and any error it throws propagates out of
 * `db.transaction`'s callback, which Drizzle rolls back on).
 */
export async function updateWorkItem(
  key: string,
  workspaceId: string,
  assertedVersion: number,
  actorId: string,
  actorType: ActivityActorType,
  input: UpdateWorkItemInput,
) {
  const values: Partial<typeof workItemTable.$inferInsert> = {};
  if (input.title !== undefined) values.title = input.title;
  if (input.description !== undefined) values.description = input.description;
  if (input.priority !== undefined) values.priority = input.priority;
  if (input.startDate !== undefined) values.startDate = input.startDate;
  if (input.dueDate !== undefined) values.dueDate = input.dueDate;

  // #202 / PR #204's freeze invariant -- see this function's own doc comment above for
  // why it is applied in two places now instead of one.
  const projectNotDeleted = sql`EXISTS (SELECT 1 FROM ${projectTable} WHERE ${projectTable.id} = ${workItemTable.projectId} AND ${projectTable.deletedAt} IS NULL)`;

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.key, key),
          eq(workItemTable.workspaceId, workspaceId),
        ),
      )
      .for("update");

    if (!locked) {
      // Genuinely gone -- deleted, or moved out of this workspace -- since the
      // reach-check middleware ran. 404, matching that middleware's own "not there"
      // outcome for this route.
      throw new HTTPException(404, { message: "Work item not found" });
    }

    const [projectAlive] = await tx
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, locked.projectId),
          isNull(projectTable.deletedAt),
        ),
      );

    if (!projectAlive) {
      // Its project was soft-deleted since the reach-check middleware ran (or is
      // already soft-deleted and the middleware raced) -- 404, not a version conflict.
      throw new HTTPException(404, { message: "Work item not found" });
    }

    if (locked.version !== assertedVersion) {
      throw new WorkItemVersionConflictError(assertedVersion, locked.version);
    }

    const [updated] = await tx
      .update(workItemTable)
      .set({ ...values, version: sql`${workItemTable.version} + 1` })
      .where(
        and(
          eq(workItemTable.id, locked.id),
          eq(workItemTable.version, assertedVersion),
          projectNotDeleted,
        ),
      )
      .returning();

    if (!updated) {
      // The version matched moments ago under the row lock, and the row itself is not
      // gone (we are updating by `id`, not re-resolving `key`), so the only remaining
      // reason the `WHERE` can fail to match is `projectNotDeleted` -- the project was
      // soft-deleted in the window between the lock above and this statement, by a
      // concurrent transaction that does not touch `work_item` and so was never blocked
      // by the lock. Same outcome as the "already soft-deleted" case: 404.
      throw new HTTPException(404, { message: "Work item not found" });
    }

    // WI-6/CA-6: one `updated` row per changed field named in `DIFFABLE_FIELDS`, built
    // from ONLY the fields this PATCH actually supplied (matching the partial-update
    // semantics already applied to `values` above) -- an unsupplied field is "not part
    // of this update", not a change to/from `undefined`.
    const before: WorkItemFieldSnapshot = {};
    const after: WorkItemFieldSnapshot = {};
    if (input.title !== undefined) {
      before.title = locked.title;
      after.title = updated.title;
    }
    if (input.description !== undefined) {
      before.description = locked.description;
      after.description = updated.description;
    }
    if (input.priority !== undefined) {
      before.priority = locked.priority;
      after.priority = updated.priority;
    }
    if (input.dueDate !== undefined) {
      before.dueDate = locked.dueDate;
      after.dueDate = updated.dueDate;
    }
    if (input.startDate !== undefined) {
      before.startDate = locked.startDate;
      after.startDate = updated.startDate;
    }

    const activityRows = diffWorkItemFieldChanges(before, after, {
      workspaceId: updated.workspaceId,
      workItemId: updated.id,
      actorId,
      actorType,
    });

    if (activityRows.length > 0) {
      await recordWorkItemActivity(tx, activityRows);
    }

    return updated;
  });
}

export default updateWorkItem;
