import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import type { Transaction } from "../../database/executor";
import { workItemTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { lockRelationGraph } from "../../work-item-relation/blockers";
import type { ActivityActorType } from "../activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../assert-work-item-live";
import { WORK_ITEM_HIERARCHY_LOCK_NAMESPACE } from "../hierarchy-lock";
import { publishWorkItemHint, recordWorkItemEvent } from "../native-event";
import { cancelPendingScheduledTransitions } from "../scheduled-transition-cancel";

/** Executor-only mutation: approval and soft deletion must share this transaction. */
export async function deleteWorkItemInTransaction(
  tx: Transaction,
  key: string,
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
) {
  const [anchor] = await tx
    .select({ projectId: workItemTable.projectId })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!anchor) throw new HTTPException(404, { message: "Work item not found" });
  await lockRelationGraph(tx, workspaceId);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${WORK_ITEM_HIERARCHY_LOCK_NAMESPACE}, hashtext(${anchor.projectId}))`,
  );
  const [row] = await tx
    .select()
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .for("update")
    .limit(1);
  assertWorkItemStillLive(row);
  await assertProjectStillLive(tx, row.projectId);
  const now = new Date();
  const [deleted] = await tx
    .update(workItemTable)
    .set({
      deletedAt: now,
      updatedAt: now,
      version: sql`${workItemTable.version} + 1`,
    })
    .where(and(eq(workItemTable.id, row.id), isNull(workItemTable.deletedAt)))
    .returning();
  if (!deleted)
    throw new HTTPException(404, { message: "Work item not found" });
  await cancelPendingScheduledTransitions(tx, deleted.id);
  // Stored parent/relation rows survive the restore window; live views hide deleted parents.
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
  const event = await recordWorkItemEvent(tx, {
    kind: "work_item.deleted",
    workItemId: deleted.id,
    key: deleted.key,
    workspaceId,
    projectId: deleted.projectId,
    actorId,
    actorType,
    customerVisible: false,
    payload: {
      workItemId: deleted.id,
      key: deleted.key,
      url: `/agent/work-items/${encodeURIComponent(deleted.key)}`,
      deletedBy: actorId,
    },
  });
  return {
    id: deleted.id,
    key: deleted.key,
    workspaceId,
    projectId: deleted.projectId,
    deletedAt: now,
    event,
    actorId,
  };
}
export async function publishWorkItemDeletion(
  deleted: Awaited<ReturnType<typeof deleteWorkItemInTransaction>>,
) {
  await publishEvent("work_item.deleted", {
    workItemId: deleted.id,
    key: deleted.key,
    workspaceId: deleted.workspaceId,
    projectId: deleted.projectId,
    deletedBy: deleted.actorId,
  });
  await publishWorkItemHint(deleted.event, {
    kind: "work_item.deleted",
    key: deleted.key,
    projectId: deleted.projectId,
    customerVisible: false,
  });
}
