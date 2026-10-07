import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type db from "../database";
import { projectTable, workItemTable } from "../database/schema";
import { lockLiveProjectQuery } from "./repository";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Issue #493: the shared guard for the soft-delete/archive TOCTOU class closed piecemeal,
 * one call site at a time, by #276 (`update-work-item.ts`), #486/#481
 * (`set-work-item-parent.ts`'s two lookups), #488 (`detach-work-item-parent.ts`) and #490
 * (`transition-work-item.ts`/`assign-work-item.ts`/`unassign-work-item.ts`). Five-plus
 * instances of the identical fix (`requireWorkItemReach()`/`requireAttachmentReach()`
 * checks liveness before the request's own transaction opens; only a lock taken INSIDE
 * that transaction closes the window a concurrent soft-delete/archive can land in) is
 * what the Opus review of PR #491 flagged as past the point of patching one more call
 * site -- this is the consolidation.
 *
 * Call this on an item already read under a lock this transaction holds --
 * `.for("update")` (the row is about to be written) or `.for("share")` (the row is only
 * being read, but must not change under us) -- inside the SAME transaction that goes on to
 * use the result. An UNLOCKED read cannot close this race at all: a plain `SELECT` returns
 * a snapshot that a concurrent soft-delete can invalidate the instant the read completes,
 * which is exactly the bug this issue consolidates the fix for.
 */
export function assertWorkItemStillLive<
  T extends { deletedAt: Date | null; archivedAt: Date | null },
>(
  item: T | undefined | null,
  message = "Work item not found",
): asserts item is T {
  if (!item || item.deletedAt !== null || item.archivedAt !== null) {
    throw new HTTPException(404, { message });
  }
}

/**
 * The #202/#204 project-freeze invariant, promoted from `update-work-item.ts`'s own
 * `projectNotDeleted` shape to a shared sibling check (issue #493's "project-freeze gap":
 * `transition-work-item.ts`/`assign-work-item.ts`/`unassign-work-item.ts` never re-checked
 * their work item's PROJECT for a soft-delete inside their own transaction, unlike this
 * shape). A work item's row lock does not serialise a concurrent project archive or
 * deletion -- that is a different row entirely -- so this query also locks the project
 * row with `FOR SHARE` inside the same transaction. Freezing the project must wait for
 * this check and its guarded writes to commit; if archive or deletion wins the lock first,
 * the query waits and PostgreSQL rechecks the live-row predicate.
 */
export async function assertProjectStillLive(
  tx: DbOrTx,
  projectId: string,
  message = "Work item not found",
): Promise<void> {
  const [projectAlive] = await lockLiveProjectQuery(tx, projectId);

  if (!projectAlive) {
    throw new HTTPException(404, { message });
  }
}

/**
 * The WHERE-clause form of the same project-freeze invariant, for a conditional
 * `UPDATE ... WHERE` that folds it in alongside a version/CAS check rather than a separate
 * `SELECT` -- `update-work-item.ts`/`set-work-item-parent.ts`/`detach-work-item-parent.ts`'s
 * existing shape, now shared instead of copy-pasted a fourth, fifth and sixth time. Zero
 * rows matched because of THIS clause is indistinguishable, at the SQL level, from zero
 * rows matched for any other reason already in the same `WHERE` -- each caller's own
 * existing "no row updated" branch is what turns that into the right error for its route
 * (a 404, a version conflict, or -- `assign-work-item.ts`/`unassign-work-item.ts`'s own
 * established shape -- the assignee-conflict 409), unchanged by adding this clause.
 */
export const projectNotDeletedClause = sql`EXISTS (SELECT 1 FROM ${projectTable} WHERE ${projectTable.id} = ${workItemTable.projectId} AND ${projectTable.deletedAt} IS NULL AND ${projectTable.archivedAt} IS NULL)`;
