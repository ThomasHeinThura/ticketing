import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import type { Transaction } from "../../database/executor";
import { projectTable, workItemTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { lockProjectHierarchy } from "../../project/hierarchy.repository";
import { dbClockUtc } from "../../utils/db-time";
import { type ActivityActorType, recordWorkItemActivity } from "../activity";
import { WORK_ITEM_HIERARCHY_LOCK_NAMESPACE } from "../hierarchy-lock";
import { publishWorkItemHint, recordWorkItemEvent } from "../native-event";
import { WorkItemVersionConflictError } from "./update-work-item";

export async function restoreWorkItem(
  key: string,
  workspaceId: string,
  assertedVersion: number,
  actorId: string,
  actorType: ActivityActorType,
) {
  const restored = await db.transaction(async (tx) =>
    restoreWorkItemInTransaction(
      tx,
      key,
      workspaceId,
      assertedVersion,
      actorId,
      actorType,
    ),
  );

  await publishEvent("work_item.updated", {
    workItemId: restored.id,
    key: restored.key,
    workspaceId,
    projectId: restored.projectId,
    changes: [
      { field: "deleted_at", from: restored.deletedAt.toISOString(), to: null },
    ],
  });
  await publishWorkItemHint(restored.event, {
    kind: "work_item.updated",
    key: restored.key,
    projectId: restored.projectId,
    customerVisible: false,
  });
  return restored.item;
}

async function restoreWorkItemInTransaction(
  tx: Transaction,
  key: string,
  workspaceId: string,
  assertedVersion: number,
  actorId: string,
  actorType: ActivityActorType,
) {
  const [anchor] = await tx
    .select({ id: workItemTable.id, projectId: workItemTable.projectId })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
        isNotNull(workItemTable.deletedAt),
      ),
    )
    .limit(1);
  if (!anchor) throw new HTTPException(404, { message: "Work item not found" });

  // Serialize against project deletion/restoration before locking the parent project row.
  await lockProjectHierarchy(tx, workspaceId);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${WORK_ITEM_HIERARCHY_LOCK_NAMESPACE}, hashtext(${anchor.projectId}))`,
  );
  const [project] = await tx
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, anchor.projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
      ),
    )
    .for("share")
    .limit(1);
  if (!project)
    throw new HTTPException(404, { message: "Work item not found" });

  const [locked] = await tx
    .select({
      item: workItemTable,
      withinRestoreWindow: sql<boolean>`${workItemTable.deletedAt} > ${dbClockUtc()} - interval '30 days'`,
    })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.id, anchor.id),
        eq(workItemTable.workspaceId, workspaceId),
        isNotNull(workItemTable.deletedAt),
      ),
    )
    .for("update")
    .limit(1);
  if (!locked) throw new HTTPException(404, { message: "Work item not found" });
  if (locked.item.version !== assertedVersion)
    throw new WorkItemVersionConflictError(
      assertedVersion,
      locked.item.version,
    );
  if (!locked.withinRestoreWindow)
    throw new HTTPException(409, {
      message: "The 30 day work-item restore window has passed",
    });
  const priorDeletedAt = locked.item.deletedAt;
  if (priorDeletedAt === null)
    throw new HTTPException(404, { message: "Work item not found" });

  const [item] = await tx
    .update(workItemTable)
    .set({
      deletedAt: null,
      updatedAt: dbClockUtc(),
      version: sql`${workItemTable.version} + 1`,
    })
    .where(
      and(
        eq(workItemTable.id, locked.item.id),
        eq(workItemTable.version, assertedVersion),
        isNotNull(workItemTable.deletedAt),
        sql`${workItemTable.deletedAt} > ${dbClockUtc()} - interval '30 days'`,
      ),
    )
    .returning();
  if (!item)
    throw new WorkItemVersionConflictError(
      assertedVersion,
      locked.item.version,
    );

  await recordWorkItemActivity(tx, [
    {
      workspaceId,
      workItemId: item.id,
      actorId,
      actorType,
      verb: "updated",
      field: "deleted_at",
      oldValue: priorDeletedAt.toISOString(),
      newValue: null,
      visibility: "internal",
    },
  ]);
  await appendAuditLog(tx, {
    actorId,
    actorType,
    workspaceId,
    projectId: item.projectId,
    action: "work_item.updated",
    entityType: "work_item",
    entityId: item.id,
    before: { deletedAt: priorDeletedAt.toISOString() },
    after: { deletedAt: null },
  });
  const event = await recordWorkItemEvent(tx, {
    kind: "work_item.updated",
    workItemId: item.id,
    key: item.key,
    workspaceId,
    projectId: item.projectId,
    actorId,
    actorType,
    customerVisible: false,
    payload: {
      key: item.key,
      url: `/agent/work-items/${encodeURIComponent(item.key)}`,
      changes: [
        {
          field: "deleted_at",
          from: priorDeletedAt.toISOString(),
          to: null,
          visibility: "internal",
        },
      ],
    },
  });
  return {
    id: item.id,
    key: item.key,
    workspaceId,
    projectId: item.projectId,
    deletedAt: priorDeletedAt,
    event,
    item,
  };
}
