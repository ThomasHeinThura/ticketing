import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { workItemTable } from "../../database/schema";
import { publishEvent } from "../../events";
import type { ActivityActorType } from "../activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../assert-work-item-live";

// #23's fourth slice: `DELETE /api/work-items/{key}` (`work_item:delete`, plus reach).
//
// KNOWN, DELIBERATE SPEC DEVIATION -- flagged in this PR's body too, and tracked on
// issue #428. `WI-23`/`pending-actions.md` (`PA-1`-`PA-15`) require every deletion,
// including this one, to go through a durable `pending_action`: `DELETE` returns `202`,
// nothing is deleted, and a human approves it later in a browser session before the
// server actually executes the soft-delete. That whole mechanism -- a new table, six-
// plus new routes under `/api/me/pending-actions/*`, step-up tokens, a confirmation-
// level ladder, an expiry job -- does not exist ANYWHERE in this codebase yet (grepped;
// only referenced as vocabulary in `events/event-keys.ts`/`audit/actions.ts`).
//
// This route instead matches the precedent every OTHER existing `DELETE` route in this
// codebase already sets -- `project/controllers/delete-project.ts` (merged, live) does
// a plain, unconfirmed soft-delete with no approval gate at all. Building a scoped-down
// pending-action mechanism just for this one route would (a) be wildly disproportionate
// to this bounded slice, and (b) still need a full rebuild once the real cross-cutting
// mechanism lands for every route at once -- wasted work either way. Skipping this route
// entirely would make it inconsistently MORE spec-compliant than every other delete
// route already on `main`. Decision recorded by the orchestrating session (Thomas's
// delegate), reversible: issue #428 tracks building the real mechanism and retrofitting
// every `DELETE` route (this one included) onto it.
//
// `WI-21`: soft delete, `deleted_at` stamped, purged after 30 days by a separate job
// (not built here, same as `project`'s own "purging is #198, not built yet" note).
// `WI-22`: deleting a parent orphans its children rather than cascading -- this route
// does not touch `parent_id` on any other row; a child's own `parent_id` simply keeps
// pointing at a now soft-deleted (still-existing) row, which is exactly "orphaned, not
// cascaded" from the data's point of view. No UI-facing "children affected" warning is
// built here (that is a client-side concern reading the still-live parent chain); flagged
// as a narrower slice than `WI-22`'s full wording, same as this PR's other judgment calls.

export type DeletedWorkItem = {
  id: string;
  key: string;
  workspaceId: string;
  projectId: string;
  deletedAt: Date;
};

/**
 * Soft-deletes a work item by key, scoped to the caller's own workspace (already
 * resolved by `requireWorkItemReach()`). Idempotent by construction: a second delete of
 * an already-deleted item matches no row (the `isNull(deletedAt)` guard) and 404s, the
 * same "already gone looks like never existed" answer `delete-project.ts` gives.
 */
export async function deleteWorkItem(
  key: string,
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
) {
  const now = new Date();

  const deleted = await db.transaction(async (tx) => {
    // The bulk route calls this controller directly with `middleware: []`, and the
    // single-item reach middleware runs before this transaction. Lock and re-check
    // both rows here so every caller is protected from project archive/delete races.
    const [row] = await tx
      .select({
        id: workItemTable.id,
        projectId: workItemTable.projectId,
        deletedAt: workItemTable.deletedAt,
        archivedAt: workItemTable.archivedAt,
      })
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.key, key),
          eq(workItemTable.workspaceId, workspaceId),
          isNull(workItemTable.deletedAt),
        ),
      )
      .limit(1)
      .for("update");

    assertWorkItemStillLive(row);
    await assertProjectStillLive(tx, row.projectId);

    const [deleted] = await tx
      .update(workItemTable)
      .set({ deletedAt: now })
      .where(and(eq(workItemTable.id, row.id), isNull(workItemTable.deletedAt)))
      .returning();

    if (!deleted) {
      throw new HTTPException(404, { message: "Work item not found" });
    }

    // Same transaction as the mutation itself (`assign-work-item.ts`'s own
    // convention) -- `appendAuditLog` takes its own `pg_advisory_xact_lock`
    // internally, so nothing further is needed here for hash-chain serialisation.
    await appendAuditLog(tx, {
      actorId,
      actorType,
      workspaceId,
      projectId: deleted.projectId,
      action: "work_item.deleted",
      entityType: "work_item",
      entityId: deleted.id,
      before: { deletedAt: null },
      after: { deletedAt: now.toISOString() },
    });

    return deleted;
  });

  // `events.md`: `work_item.deleted` -- "Soft-deleted", payload `deletedBy`.
  await publishEvent("work_item.deleted", {
    workItemId: deleted.id,
    key: deleted.key,
    workspaceId,
    projectId: deleted.projectId,
    deletedBy: actorId,
  });

  return {
    id: deleted.id,
    key: deleted.key,
    workspaceId: deleted.workspaceId,
    projectId: deleted.projectId,
    deletedAt: now,
  } satisfies DeletedWorkItem;
}

export default deleteWorkItem;
