import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  columnTable,
  labelTable,
  projectTable,
  taskTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { lockWorkspaceLabelNames } from "../../label/label-name-lock";
import { assertAssignableUserAndLockMembership } from "../../utils/assert-assignable-user";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import { lockTaskAndAssertProjectLive } from "../assert-task-project-live";
import {
  assertValidPriority,
  assertValidTaskStatus,
} from "../validate-task-fields";

type BulkOperation =
  | "updateStatus"
  | "updatePriority"
  | "updateAssignee"
  | "delete"
  | "addLabel"
  | "removeLabel"
  | "updateDueDate";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type ItemResult =
  | { taskId: string; success: true }
  | { taskId?: string; success: false; error: string };
type DeferredEvent = () => Promise<void>;

async function resolveBulkLabel(
  tx: DbOrTx,
  value: string,
  workspaceId: string,
) {
  const scope = and(
    eq(labelTable.id, value),
    or(eq(labelTable.workspaceId, workspaceId), isNull(labelTable.workspaceId)),
  );
  const label = await tx.query.labelTable.findFirst({ where: scope });
  if (!label) throw new HTTPException(404, { message: "Label not found" });

  // Join the label-name family before task/project row locks so rename and cascade
  // operations cannot deadlock against this bulk writer.
  await lockWorkspaceLabelNames(tx, workspaceId, [label.name]);
  const currentLabel = await tx.query.labelTable.findFirst({ where: scope });
  if (!currentLabel) {
    throw new HTTPException(404, { message: "Label not found" });
  }
  if (
    currentLabel.workspaceId !== label.workspaceId ||
    currentLabel.taskId !== label.taskId ||
    currentLabel.name !== label.name
  ) {
    throw new HTTPException(409, {
      message: "Label changed; retry the request",
    });
  }
  return currentLabel;
}

async function bulkUpdateTasks({
  taskIds,
  operation,
  value,
  userId,
  workspaceId,
}: {
  taskIds: string[];
  operation: BulkOperation;
  value?: string | null;
  userId: string;
  workspaceId: string;
}) {
  if (!workspaceId) {
    throw new HTTPException(500, {
      message: "Could not determine workspace for this request",
    });
  }

  const [membership] = await db
    .select({ id: workspaceUserTable.id })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.userId, userId),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!membership) {
    throw new HTTPException(403, {
      message: "You don't have access to this workspace",
    });
  }

  const uniqueTaskIds = [...new Set(taskIds)];
  const scopedRows = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        inArray(taskTable.id, uniqueTaskIds),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    );
  const scopedIds = new Set(scopedRows.map((task) => task.id));
  if (scopedIds.size === 0) {
    throw new HTTPException(404, { message: "No tasks found" });
  }

  const results: ItemResult[] = [];
  let updatedCount = 0;
  let committedAssigneeWrites = 0;
  const refreshedRelationProjects = new Set<string>();

  // Recheck each scoped row under its own task/project locks below. Opaque ids
  // filtered by workspace reach stay in the response only as anonymous failures,
  // so a foreign task and a nonexistent id have byte-identical results.
  for (const taskId of uniqueTaskIds) {
    if (!scopedIds.has(taskId)) {
      results.push({ success: false, error: "Task not found" });
      continue;
    }
    let taskInScope = false;
    let itemProjectId: string | undefined;
    const itemEvents: DeferredEvent[] = [];
    let itemUpdatedCount = 0;
    try {
      itemUpdatedCount = await db.transaction(async (tx) => {
        let label: typeof labelTable.$inferSelect | undefined;
        let labelError: HTTPException | undefined;
        if (
          (operation === "addLabel" || operation === "removeLabel") &&
          value &&
          !value.includes("\u0000")
        ) {
          try {
            label = await resolveBulkLabel(tx, value, workspaceId);
          } catch (error) {
            if (!(error instanceof HTTPException)) throw error;
            labelError = error;
          }
        }

        const task = await lockTaskAndAssertProjectLive(tx, taskId);
        const [project] = await tx
          .select({ workspaceId: projectTable.workspaceId })
          .from(projectTable)
          .where(eq(projectTable.id, task.projectId))
          .limit(1);
        if (!project || project.workspaceId !== workspaceId) {
          throw new HTTPException(404, { message: "Task not found" });
        }
        taskInScope = true;
        itemProjectId = task.projectId;

        if (
          operation !== "delete" &&
          operation !== "updateDueDate" &&
          value === undefined
        ) {
          throw new HTTPException(400, {
            message: "Value is required for this operation",
          });
        }
        if (operation === "updateStatus" && !value) {
          throw new HTTPException(400, { message: "Status value is required" });
        }
        if (operation === "updatePriority") {
          if (!value) {
            throw new HTTPException(400, {
              message: "Priority value is required",
            });
          }
          assertValidPriority(value);
        }
        if (operation === "addLabel" || operation === "removeLabel") {
          if (!value) {
            throw new HTTPException(400, { message: "Label ID is required" });
          }
          rejectNulByte(value, "Label id");
          if (labelError) throw labelError;
        }
        if (operation === "updateAssignee" && value) {
          rejectNulByte(value, "Assignee id");
        }

        let parsedDate: Date | null = null;
        if (operation === "updateDueDate" && value) {
          parsedDate = new Date(value);
          if (Number.isNaN(parsedDate.getTime())) {
            throw new HTTPException(400, {
              message: `Invalid date value "${value}"`,
            });
          }
        }

        switch (operation) {
          case "updateStatus": {
            const status = value as string;
            await assertValidTaskStatus(status, task.projectId, tx);
            const column = await tx.query.columnTable.findFirst({
              where: and(
                eq(columnTable.projectId, task.projectId),
                eq(columnTable.slug, status),
              ),
            });
            const [updated] = await tx
              .update(taskTable)
              .set({ status, columnId: column?.id ?? null })
              .where(eq(taskTable.id, taskId))
              .returning({ id: taskTable.id });
            itemEvents.push(() =>
              publishEvent("task.status_changed", {
                taskId,
                projectId: task.projectId,
                userId,
                newStatus: status,
                type: "status_changed",
              }),
            );
            return updated ? 1 : 0;
          }

          case "updatePriority": {
            const priority = value as string;
            const [updated] = await tx
              .update(taskTable)
              .set({ priority })
              .where(eq(taskTable.id, taskId))
              .returning({ id: taskTable.id });
            itemEvents.push(() =>
              publishEvent("task.priority_changed", {
                taskId,
                projectId: task.projectId,
                userId,
                newPriority: priority,
                type: "priority_changed",
              }),
            );
            return updated ? 1 : 0;
          }

          case "updateAssignee": {
            const assigneeId = value?.trim() || null;
            // Membership is checked and locked in every item transaction. A
            // concurrent removal therefore serializes with this assignment,
            // and a removal committed between items makes the later item fail.
            if (assigneeId) {
              await assertAssignableUserAndLockMembership(
                assigneeId,
                workspaceId,
                tx,
              );
            }
            const newAssigneeName = assigneeId
              ? (
                  await tx
                    .select({ name: userTable.name })
                    .from(userTable)
                    .where(eq(userTable.id, assigneeId))
                    .limit(1)
                )[0]?.name
              : undefined;
            const [updated] = await tx
              .update(taskTable)
              .set({ userId: assigneeId })
              .where(eq(taskTable.id, taskId))
              .returning({ id: taskTable.id });
            const eventData = {
              taskId,
              projectId: task.projectId,
              userId,
              oldAssignee: task.userId,
              newAssignee: newAssigneeName,
              newAssigneeId: assigneeId,
              title: task.title,
              type: assigneeId ? "assignee_changed" : "unassigned",
            };
            if (assigneeId) {
              itemEvents.push(() =>
                publishEvent("task.assignee_changed", eventData),
              );
            } else {
              itemEvents.push(() => publishEvent("task.unassigned", eventData));
            }
            return updated ? 1 : 0;
          }

          case "delete": {
            const [deleted] = await tx
              .delete(taskTable)
              .where(eq(taskTable.id, taskId))
              .returning({ id: taskTable.id });
            if (deleted) {
              itemEvents.push(() =>
                publishEvent("task.deleted", {
                  taskId,
                  projectId: task.projectId,
                  userId,
                  title: task.title,
                }),
              );
            }
            return deleted ? 1 : 0;
          }

          case "addLabel": {
            if (!label)
              throw new HTTPException(404, { message: "Label not found" });
            const existing = await tx.query.labelTable.findFirst({
              where: and(
                eq(labelTable.name, label.name),
                eq(labelTable.taskId, taskId),
              ),
            });
            if (existing) return 0;
            const [inserted] = await tx
              .insert(labelTable)
              .values({
                name: label.name,
                color: label.color,
                workspaceId,
                taskId,
              })
              .onConflictDoNothing({
                target: [labelTable.taskId, labelTable.name],
              })
              .returning({ id: labelTable.id });
            if (inserted) {
              itemEvents.push(() =>
                publishEvent("task.label_assigned", {
                  projectId: task.projectId,
                  taskId,
                  userId,
                  type: "label_assigned",
                }),
              );
            }
            return inserted ? 1 : 0;
          }

          case "removeLabel": {
            if (!label)
              throw new HTTPException(404, { message: "Label not found" });
            const [deleted] = await tx
              .delete(labelTable)
              .where(
                and(
                  eq(labelTable.workspaceId, workspaceId),
                  eq(labelTable.name, label.name),
                  eq(labelTable.taskId, taskId),
                ),
              )
              .returning();
            if (deleted) {
              itemEvents.push(() =>
                publishEvent("task.label_unassigned", {
                  label: deleted,
                  task,
                  projectId: task.projectId,
                  taskId,
                  userId,
                  type: "label_unassigned",
                }),
              );
            }
            return deleted ? 1 : 0;
          }

          case "updateDueDate": {
            const [updated] = await tx
              .update(taskTable)
              .set({ dueDate: parsedDate })
              .where(eq(taskTable.id, taskId))
              .returning({ id: taskTable.id });
            itemEvents.push(() =>
              publishEvent("task.due_date_changed", {
                taskId,
                projectId: task.projectId,
                userId,
                oldDueDate: task.dueDate,
                newDueDate: parsedDate,
                title: task.title,
                type: "due_date_changed",
              }),
            );
            return updated ? 1 : 0;
          }
          default:
            throw new HTTPException(400, {
              message: `Unknown operation "${operation}"`,
            });
        }
      });
    } catch (error) {
      if (!(error instanceof HTTPException)) throw error;
      // Keep the legacy top-level 403 when no assignment has committed. If a
      // membership is revoked between item transactions, preserve the already
      // committed items and report this later item through the WI-25 result.
      if (error.status === 403) {
        if (operation !== "updateAssignee" || committedAssigneeWrites === 0) {
          throw error;
        }
        results.push({ taskId, success: false, error: error.message });
        continue;
      }
      results.push({
        ...(taskInScope ? { taskId } : {}),
        success: false,
        error:
          error.status === 404 &&
          (error.message === "Task not found" ||
            error.message === "No tasks found")
            ? "Task not found"
            : error.message,
      });
      continue;
    }

    updatedCount += itemUpdatedCount;
    if (operation === "updateAssignee" && itemUpdatedCount > 0) {
      committedAssigneeWrites += itemUpdatedCount;
    }
    // Each transaction owns its event queue. Publish as soon as that item's
    // commit succeeds so a later item's database failure cannot suppress it.
    for (const publish of itemEvents) await publish();
    if (
      operation === "updateStatus" &&
      itemProjectId &&
      !refreshedRelationProjects.has(itemProjectId)
    ) {
      await publishEvent("task-relation.refresh", {
        projectId: itemProjectId,
        userId,
      });
      refreshedRelationProjects.add(itemProjectId);
    }
    results.push({ taskId, success: true });
  }

  return {
    success: true,
    updatedCount,
    results,
  };
}

export default bulkUpdateTasks;
