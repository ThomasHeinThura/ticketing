import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { schema } from "../database";
import type { Transaction } from "../database/executor";
import { publishEvent } from "../events";
import { appendAuditSavepoint } from "../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import type { ActivityActorType } from "../work-item/activity";
import {
  diffWorkItemFieldChanges,
  recordWorkItemActivity,
  resolveVisibility,
} from "../work-item/activity";
import { replaceWorkItemLabels } from "../work-item/labels-repository";
import {
  publishWorkItemHint,
  recordWorkItemEvent,
} from "../work-item/native-event";
import type { ImportItem } from "./schema";

export type ImportUpdateResult = {
  updated: typeof schema.workItemTable.$inferSelect;
  realtimeEvent: Awaited<ReturnType<typeof recordWorkItemEvent>> | undefined;
  changes: Array<{
    field: string;
    from: unknown;
    to: unknown;
    visibility: string;
  }>;
  auditFailed: boolean;
  actorId: string;
  actorType: ActivityActorType;
};

export async function updateImportedWorkItemInTransaction(
  tx: Transaction,
  input: {
    workspaceId: string;
    projectId: string;
    targetId: string;
    actorId: string;
    actorType: ActivityActorType;
    apiKeyId: string | null;
    origin?: "mcp";
    item: ImportItem;
  },
): Promise<ImportUpdateResult> {
  const [locked] = await tx
    .select()
    .from(schema.workItemTable)
    .where(
      and(
        eq(schema.workItemTable.id, input.targetId),
        eq(schema.workItemTable.workspaceId, input.workspaceId),
        eq(schema.workItemTable.projectId, input.projectId),
        sql`${schema.workItemTable.deletedAt} IS NULL AND ${schema.workItemTable.archivedAt} IS NULL`,
      ),
    )
    .for("update")
    .limit(1);
  if (!locked)
    throw new HTTPException(409, {
      message: "Linked target is no longer available",
    });

  if (
    input.item.assigneeId !== undefined &&
    input.item.assigneeId !== locked.assigneeId
  )
    throw new HTTPException(409, {
      message: "Imported assignment change requires manual reconciliation",
    });

  const labelChange =
    input.item.labelIds === undefined
      ? undefined
      : await replaceWorkItemLabels(
          tx,
          locked.id,
          input.workspaceId,
          input.projectId,
          input.item.labelIds,
        );
  const values: Partial<typeof schema.workItemTable.$inferInsert> = {
    title: input.item.title,
    ...(input.item.description !== undefined
      ? { description: input.item.description ?? null }
      : {}),
    ...(input.item.priority !== undefined
      ? { priority: input.item.priority }
      : {}),
    ...(input.item.startDate !== undefined
      ? { startDate: input.item.startDate }
      : {}),
    ...(input.item.dueDate !== undefined
      ? { dueDate: input.item.dueDate }
      : {}),
  };
  const [updated] = await tx
    .update(schema.workItemTable)
    .set({ ...values, version: sql`${schema.workItemTable.version} + 1` })
    .where(
      and(
        eq(schema.workItemTable.id, locked.id),
        eq(schema.workItemTable.version, locked.version),
      ),
    )
    .returning();
  if (!updated)
    throw new HTTPException(409, {
      message: "Linked target changed during import",
    });

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  if (labelChange) {
    before.labelIds = labelChange.before;
    after.labelIds = labelChange.after;
  }
  before.title = locked.title;
  after.title = updated.title;
  if (input.item.description !== undefined) {
    before.description = locked.description;
    after.description = updated.description;
  }
  if (input.item.priority !== undefined) {
    before.priority = locked.priority;
    after.priority = updated.priority;
  }
  if (input.item.startDate !== undefined) {
    before.startDate = locked.startDate;
    after.startDate = updated.startDate;
  }
  if (input.item.dueDate !== undefined) {
    before.dueDate = locked.dueDate;
    after.dueDate = updated.dueDate;
  }
  const activityRows = diffWorkItemFieldChanges(before, after, {
    workspaceId: updated.workspaceId,
    workItemId: updated.id,
    actorId: input.actorId,
    actorType: input.actorType,
  });
  if (activityRows.length) await recordWorkItemActivity(tx, activityRows);
  const changes = activityRows
    .filter((row) => row.field)
    .map((row) => ({
      field: row.field as string,
      from: row.oldValue,
      to: row.newValue,
      visibility: resolveVisibility(row),
    }));
  const realtimeEvent = changes.length
    ? await recordWorkItemEvent(tx, {
        kind: "work_item.updated",
        workItemId: updated.id,
        key: updated.key,
        workspaceId: updated.workspaceId,
        projectId: updated.projectId,
        actorId: input.actorId,
        actorType: input.actorType,
        customerVisible: changes.some(
          (change) => change.visibility === "public",
        ),
        payload: {
          key: updated.key,
          url: `/agent/work-items/${encodeURIComponent(updated.key)}`,
          changes,
          // History, not a trigger: automation and webhook consumers skip import events.
          source: "import",
        },
      })
    : undefined;
  const auditFailed = activityRows.length
    ? await appendAuditSavepoint(tx, {
        actorId: input.actorId,
        actorType: input.actorType,
        apiKeyId: input.apiKeyId,
        workspaceId: updated.workspaceId,
        projectId: updated.projectId,
        action: "work_item.updated",
        entityType: "work_item",
        entityId: updated.id,
        before: null,
        after: {
          changedFields: [
            ...new Set(
              activityRows
                .filter((row) => row.field)
                .map((row) => row.field as string),
            ),
          ],
          ...(input.origin ? { origin: input.origin } : {}),
        },
      })
    : false;
  return {
    updated,
    realtimeEvent,
    changes,
    auditFailed,
    actorId: input.actorId,
    actorType: input.actorType,
  };
}

export async function publishImportedWorkItemUpdate(
  result: ImportUpdateResult,
) {
  if (result.auditFailed)
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  if (!result.changes.length) return;
  await publishEvent("work_item.updated", {
    workItemId: result.updated.id,
    key: result.updated.key,
    workspaceId: result.updated.workspaceId,
    projectId: result.updated.projectId,
    changes: result.changes,
    actorId: result.actorId,
    actorType: result.actorType,
  });
  if (result.realtimeEvent)
    await publishWorkItemHint(result.realtimeEvent, {
      kind: "work_item.updated",
      key: result.updated.key,
      projectId: result.updated.projectId,
      customerVisible: result.changes.some(
        (change) => change.visibility === "public",
      ),
    });
}
