import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workItemTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  type ActivityActorType,
  recordWorkItemActivity,
  resolveVisibility,
} from "../activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
  projectNotDeletedClause,
} from "../assert-work-item-live";
import { publishWorkItemHint, recordWorkItemEvent } from "../native-event";
import { runWithParentWriteDeadlockRetry } from "../parent-write-deadlock-retry";

/**
 * `DELETE /api/work-items/{key}/parent` (`work_item:update`, required on both ends,
 * including detach -- `relations-and-hierarchy.md` § Permissions: "it mutates the former
 * parent's roll-up too"). See `set-work-item-parent.ts`'s own doc comment for why "both
 * ends" is a single capability check under this codebase's current, workspace-role-based
 * permission model.
 *
 * Never touches `work_item_reject_parent_cycle` (migration 0056): setting `parent_id` to
 * `NULL` can never create a cycle, and the trigger itself returns immediately for a null
 * new parent (its own migration comment). No app-level cycle/depth check is needed here
 * either, for the same reason.
 *
 * Detaching an item that already has no parent is a no-op, not an error -- JUDGMENT CALL,
 * matching this spec's own idempotence philosophy for relations ("Duplicate relation
 * added twice -- Idempotent, no second row, no error"), applied here to the symmetric
 * "detach what is already detached" case, which the spec's own Edge cases table does not
 * separately name. Flagged in the PR body.
 *
 * ISSUE #295: also #23's write path for `parent_id` (setting it to `NULL`), so this
 * transaction gets the same bounded, idempotent `40P01` retry as `set-work-item-parent.ts`
 * -- see `runWithParentWriteDeadlockRetry`'s own doc comment for why the retry wraps the
 * whole transaction rather than just the final `UPDATE`.
 */
export async function detachWorkItemParent(
  key: string,
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
) {
  const { updated, oldParentId, changed, realtimeEvent } =
    await runWithParentWriteDeadlockRetry(() =>
      db.transaction(async (tx) => {
        const [item] = await tx
          .select()
          .from(workItemTable)
          .where(
            and(
              eq(workItemTable.key, key),
              eq(workItemTable.workspaceId, workspaceId),
            ),
          )
          .for("update");

        // Issue #488: the same TOCTOU class #486 closed for `set-work-item-parent.ts`'s
        // subject-item re-read. `delete-work-item.ts` sets `deletedAt` without bumping
        // `version`, so a concurrent soft-delete landing between the shared middleware's
        // reach-check and this transaction's own `FOR UPDATE` re-read would otherwise let
        // this detach still succeed against a since-deleted/archived item.
        assertWorkItemStillLive(item);
        await assertProjectStillLive(tx, item.projectId);

        if (item.parentId === null) {
          return { updated: item, oldParentId: null, changed: false };
        }

        const [updatedRow] = await tx
          .update(workItemTable)
          .set({ parentId: null, version: sql`${workItemTable.version} + 1` })
          .where(
            and(
              eq(workItemTable.id, item.id),
              eq(workItemTable.version, item.version),
              projectNotDeletedClause,
            ),
          )
          .returning();

        if (!updatedRow) {
          throw new HTTPException(404, { message: "Work item not found" });
        }

        await recordWorkItemActivity(tx, [
          {
            workspaceId: updatedRow.workspaceId,
            workItemId: updatedRow.id,
            actorId,
            actorType,
            verb: "updated",
            field: "parent",
            oldValue: item.parentId,
            newValue: null,
            visibility: "internal",
          },
        ]);

        const realtimeEvent = await recordWorkItemEvent(tx, {
          kind: "work_item.updated",
          workItemId: updatedRow.id,
          key: updatedRow.key,
          workspaceId: updatedRow.workspaceId,
          projectId: updatedRow.projectId,
          actorId,
          actorType,
          customerVisible: false,
          payload: {
            key: updatedRow.key,
            url: `/agent/work-items/${encodeURIComponent(updatedRow.key)}`,
            changes: [
              {
                field: "parent",
                from: item.parentId,
                to: null,
                visibility: "internal",
              },
            ],
          },
        });

        return {
          updated: updatedRow,
          oldParentId: item.parentId,
          changed: true,
          realtimeEvent,
        };
      }),
    );

  if (changed) {
    if (!realtimeEvent)
      throw new Error("Updated work item is missing realtime event");
    await publishWorkItemHint(realtimeEvent, {
      kind: "work_item.updated",
      key: updated.key,
      projectId: updated.projectId,
      customerVisible: false,
    });
    await publishEvent("work_item.updated", {
      workItemId: updated.id,
      key: updated.key,
      workspaceId: updated.workspaceId,
      projectId: updated.projectId,
      changes: [
        {
          field: "parent",
          from: oldParentId,
          to: null,
          visibility: resolveVisibility({
            workspaceId: updated.workspaceId,
            workItemId: updated.id,
            actorId,
            actorType,
            verb: "updated",
            field: "parent",
          }),
        },
      ],
      actorId,
      actorType,
    });
  }

  return updated;
}

export default detachWorkItemParent;
