import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
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
import { cancelPendingScheduledTransitions } from "../scheduled-transition-cancel";
import { WorkItemVersionConflictError } from "./update-work-item";

/**
 * `WI-20`: archiving (`work_item.archived_at`) hides an item from views but preserves it and its
 * history; it never starts the 30-day purge timer (`WI-21`) and is independent of `deleted_at`.
 *
 * Shared by `POST /api/v2/work-items/{key}/archive` and the bulk `archive` operation. The caller
 * has already decided reach and `work_item:update`; this function re-reads the row under
 * `FOR UPDATE` (a concurrent soft-delete or archive between the middleware and here is a 404),
 * enforces `assertedVersion` when supplied, and writes the activity, audit row and realtime
 * event in the same transaction. `publishEffects: false` lets bulk keep its per-item summary
 * behaviour while single-item callers get the board/list hint.
 */
export async function archiveWorkItem(
  key: string,
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
  options: { assertedVersion?: number; publishEffects?: boolean } = {},
) {
  const now = new Date();
  const { archived, realtimeEvent } = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.key, key),
          eq(workItemTable.workspaceId, workspaceId),
          isNull(workItemTable.deletedAt),
          isNull(workItemTable.archivedAt),
        ),
      )
      .limit(1)
      .for("update");

    assertWorkItemStillLive(locked);
    await assertProjectStillLive(tx, locked.projectId);
    if (
      options.assertedVersion !== undefined &&
      locked.version !== options.assertedVersion
    ) {
      throw new WorkItemVersionConflictError(
        options.assertedVersion,
        locked.version,
      );
    }

    const [archived] = await tx
      .update(workItemTable)
      .set({
        archivedAt: now,
        version: sql`${workItemTable.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(workItemTable.id, locked.id),
          eq(workItemTable.version, locked.version),
          isNull(workItemTable.deletedAt),
          isNull(workItemTable.archivedAt),
          projectNotDeletedClause,
        ),
      )
      .returning();
    if (!archived) {
      throw new HTTPException(404, { message: "Work item not found" });
    }

    await cancelPendingScheduledTransitions(tx, archived.id);

    await recordWorkItemActivity(tx, [
      {
        workspaceId,
        workItemId: archived.id,
        actorId,
        actorType,
        verb: "archived",
        field: null,
        oldValue: null,
        newValue: now.toISOString(),
      },
    ]);

    await appendAuditLog(tx, {
      actorId,
      actorType,
      workspaceId,
      projectId: archived.projectId,
      action: "work_item.updated",
      entityType: "work_item",
      entityId: archived.id,
      before: { archivedAt: null },
      after: { archivedAt: now.toISOString() },
    });

    const realtimeEvent =
      options.publishEffects === false
        ? undefined
        : await recordWorkItemEvent(tx, {
            kind: "work_item.updated",
            workItemId: archived.id,
            key: archived.key,
            workspaceId,
            projectId: archived.projectId,
            actorId,
            actorType,
            customerVisible: false,
            payload: {
              key: archived.key,
              url: `/agent/work-items/${encodeURIComponent(archived.key)}`,
              changes: [
                {
                  field: "archived_at",
                  from: null,
                  to: now.toISOString(),
                  visibility: "internal",
                },
              ],
            },
          });
    return { archived, realtimeEvent };
  });

  if (realtimeEvent) {
    await publishWorkItemHint(realtimeEvent, {
      kind: "work_item.updated",
      key: archived.key,
      projectId: archived.projectId,
      customerVisible: false,
    });
    await publishEvent("work_item.updated", {
      workItemId: archived.id,
      key: archived.key,
      workspaceId,
      projectId: archived.projectId,
      changes: [
        {
          field: "archived_at",
          from: null,
          to: now.toISOString(),
          visibility: resolveVisibility({
            workspaceId,
            workItemId: archived.id,
            actorId,
            actorType,
            verb: "archived",
            field: "archived_at",
          }),
        },
      ],
      actorId,
      actorType,
    });
  }
  return archived;
}

export default archiveWorkItem;
