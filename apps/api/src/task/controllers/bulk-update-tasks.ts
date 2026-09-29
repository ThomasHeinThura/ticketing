import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
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
import { assertAssignableUser } from "../../utils/assert-assignable-user";
import { rejectNulByte } from "../../utils/reject-nul-byte";
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

  const events: Array<() => Promise<void>> = [];
  const result = await db.transaction(async (tx) => {
    // Repeat the middleware's workspace scope in the transaction. Task rows can be
    // moved between the first lookup and the lock, so the locked rows below are the
    // authoritative scope for both the update and its project freeze checks.
    const candidateIds = await tx
      .select({ id: taskTable.id })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          inArray(taskTable.id, taskIds),
          eq(projectTable.workspaceId, workspaceId),
        ),
      );
    const scopedIds = candidateIds.map((task) => task.id);
    if (scopedIds.length === 0) {
      throw new HTTPException(404, { message: "No tasks found" });
    }

    let bulkLabel: typeof labelTable.$inferSelect | undefined;
    if (operation === "addLabel" || operation === "removeLabel") {
      if (!value) {
        throw new HTTPException(400, { message: "Label ID is required" });
      }
      rejectNulByte(value, "Label id");
      const label = await tx.query.labelTable.findFirst({
        where: and(
          eq(labelTable.id, value),
          or(
            eq(labelTable.workspaceId, workspaceId),
            isNull(labelTable.workspaceId),
          ),
        ),
      });
      if (!label) {
        throw new HTTPException(404, { message: "Label not found" });
      }

      // Bulk label writes join the same name family before task/project locks.
      await lockWorkspaceLabelNames(tx, workspaceId, [label.name]);
      const currentLabel = await tx.query.labelTable.findFirst({
        where: and(
          eq(labelTable.id, value),
          or(
            eq(labelTable.workspaceId, workspaceId),
            isNull(labelTable.workspaceId),
          ),
        ),
      });
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
      bulkLabel = currentLabel;
    }

    const lockedTasks = await tx
      .select({
        id: taskTable.id,
        title: taskTable.title,
        projectId: taskTable.projectId,
        userId: taskTable.userId,
        dueDate: taskTable.dueDate,
      })
      .from(taskTable)
      .where(inArray(taskTable.id, scopedIds))
      .orderBy(asc(taskTable.id))
      .for("update");
    const projectIds = [
      ...new Set(lockedTasks.map((task) => task.projectId)),
    ].sort();
    const projects = projectIds.length
      ? await tx
          .select({
            id: projectTable.id,
            workspaceId: projectTable.workspaceId,
            archivedAt: projectTable.archivedAt,
            deletedAt: projectTable.deletedAt,
          })
          .from(projectTable)
          .where(inArray(projectTable.id, projectIds))
          .orderBy(asc(projectTable.id))
          .for("share")
      : [];
    // Stable task -> project lock ordering makes bulk operations serialize with
    // archive and delete. A project archived first is omitted after the lock wait;
    // otherwise archive waits until this write commits.
    const liveProjectIds = new Set(
      projects
        .filter(
          (project) =>
            project.workspaceId === workspaceId &&
            project.archivedAt === null &&
            project.deletedAt === null,
        )
        .map((project) => project.id),
    );
    const tasks = lockedTasks.filter((task) =>
      liveProjectIds.has(task.projectId),
    );
    if (tasks.length === 0) {
      throw new HTTPException(404, { message: "No tasks found" });
    }
    const foundIds = tasks.map((task) => task.id);
    let updatedCount = 0;

    switch (operation) {
      case "updateStatus": {
        if (!value) {
          throw new HTTPException(400, { message: "Status value is required" });
        }
        const groupedProjectIds = [
          ...new Set(tasks.map((task) => task.projectId)),
        ];
        for (const projectId of groupedProjectIds) {
          await assertValidTaskStatus(value, projectId);
          const column = await tx.query.columnTable.findFirst({
            where: and(
              eq(columnTable.projectId, projectId),
              eq(columnTable.slug, value),
            ),
          });
          const taskIdsForProject = tasks
            .filter((task) => task.projectId === projectId)
            .map((task) => task.id);
          const changed = await tx
            .update(taskTable)
            .set({ status: value, columnId: column?.id ?? null })
            .where(inArray(taskTable.id, taskIdsForProject));
          updatedCount += changed.rowCount ?? taskIdsForProject.length;
          for (const taskId of taskIdsForProject) {
            events.push(() =>
              publishEvent("task.status_changed", {
                taskId,
                projectId,
                userId,
                newStatus: value,
                type: "status_changed",
              }),
            );
          }
          events.push(() =>
            publishEvent("task-relation.refresh", { projectId, userId }),
          );
        }
        break;
      }

      case "updatePriority": {
        if (!value) {
          throw new HTTPException(400, {
            message: "Priority value is required",
          });
        }
        assertValidPriority(value);
        const changed = await tx
          .update(taskTable)
          .set({ priority: value })
          .where(inArray(taskTable.id, foundIds));
        updatedCount = changed.rowCount ?? foundIds.length;
        for (const task of tasks) {
          events.push(() =>
            publishEvent("task.priority_changed", {
              taskId: task.id,
              projectId: task.projectId,
              userId,
              newPriority: value,
              type: "priority_changed",
            }),
          );
        }
        break;
      }

      case "updateAssignee": {
        const assigneeId = value?.trim() || null;
        if (assigneeId) await assertAssignableUser(assigneeId, workspaceId);
        const newAssigneeName = assigneeId
          ? (
              await tx
                .select({ name: userTable.name })
                .from(userTable)
                .where(eq(userTable.id, assigneeId))
                .limit(1)
            )[0]?.name
          : undefined;
        const changed = await tx
          .update(taskTable)
          .set({ userId: assigneeId })
          .where(inArray(taskTable.id, foundIds));
        updatedCount = changed.rowCount ?? foundIds.length;
        for (const task of tasks) {
          const eventType = assigneeId
            ? "task.assignee_changed"
            : "task.unassigned";
          events.push(() =>
            publishEvent(eventType, {
              taskId: task.id,
              projectId: task.projectId,
              userId,
              oldAssignee: task.userId,
              newAssignee: newAssigneeName,
              newAssigneeId: assigneeId,
              title: task.title,
              type: assigneeId ? "assignee_changed" : "unassigned",
            }),
          );
        }
        break;
      }

      case "delete": {
        const deleted = await tx
          .delete(taskTable)
          .where(inArray(taskTable.id, foundIds));
        updatedCount = deleted.rowCount ?? foundIds.length;
        for (const task of tasks) {
          events.push(() =>
            publishEvent("task.deleted", {
              taskId: task.id,
              projectId: task.projectId,
              userId,
              title: task.title,
            }),
          );
        }
        break;
      }

      case "addLabel": {
        const label = bulkLabel;
        if (!label)
          throw new HTTPException(404, { message: "Label not found" });
        for (const task of tasks) {
          const existing = await tx.query.labelTable.findFirst({
            where: and(
              eq(labelTable.name, label.name),
              eq(labelTable.taskId, task.id),
            ),
          });
          if (existing) continue;
          await tx
            .insert(labelTable)
            .values({
              name: label.name,
              color: label.color,
              workspaceId,
              taskId: task.id,
            })
            .onConflictDoNothing({
              target: [labelTable.taskId, labelTable.name],
            });
          updatedCount++;
          events.push(() =>
            publishEvent("task.label_assigned", {
              projectId: task.projectId,
              taskId: task.id,
              userId,
              type: "label_assigned",
            }),
          );
        }
        break;
      }

      case "removeLabel": {
        const label = bulkLabel;
        if (!label)
          throw new HTTPException(404, { message: "Label not found" });
        const deleted = await tx
          .delete(labelTable)
          .where(
            and(
              eq(labelTable.workspaceId, workspaceId),
              eq(labelTable.name, label.name),
              inArray(labelTable.taskId, foundIds),
            ),
          )
          .returning();
        updatedCount = deleted.length;
        for (const removed of deleted) {
          const task = tasks.find((entry) => entry.id === removed.taskId);
          if (!task || !removed.taskId) continue;
          events.push(() =>
            publishEvent("task.label_unassigned", {
              label: removed,
              task,
              projectId: task.projectId,
              taskId: removed.taskId,
              userId,
              type: "label_unassigned",
            }),
          );
        }
        break;
      }

      case "updateDueDate": {
        let parsedDate: Date | null = null;
        if (value) {
          parsedDate = new Date(value);
          if (Number.isNaN(parsedDate.getTime())) {
            throw new HTTPException(400, {
              message: `Invalid date value "${value}"`,
            });
          }
        }
        const changed = await tx
          .update(taskTable)
          .set({ dueDate: parsedDate })
          .where(inArray(taskTable.id, foundIds));
        updatedCount = changed.rowCount ?? foundIds.length;
        for (const task of tasks) {
          events.push(() =>
            publishEvent("task.due_date_changed", {
              taskId: task.id,
              projectId: task.projectId,
              userId,
              oldDueDate: task.dueDate,
              newDueDate: parsedDate,
              title: task.title,
              type: "due_date_changed",
            }),
          );
        }
        break;
      }
    }
    return { success: true as const, updatedCount };
  });

  for (const publish of events) await publish();
  return result;
}

export default bulkUpdateTasks;
