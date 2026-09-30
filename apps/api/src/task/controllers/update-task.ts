import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import {
  assertAssignableUser,
  getProjectWorkspaceId,
} from "../../utils/assert-assignable-user";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import {
  validateAndParseDate,
  validateDateRange,
} from "../../utils/validate-dates";
import { lockTaskAndAssertProjectLive } from "../assert-task-project-live";
import { assertValidTaskStatus } from "../validate-task-fields";

async function updateTask(
  id: string,
  title: string,
  status: string,
  startDate: string | undefined,
  dueDate: string | undefined,
  projectId: string,
  description: string,
  priority: string,
  position: number,
  userId?: string,
  currentUserId?: string,
) {
  const [existingTask] = await db
    .select({
      id: taskTable.id,
      description: taskTable.description,
      status: taskTable.status,
    })
    .from(taskTable)
    .where(eq(taskTable.id, id))
    .limit(1);

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  const normalizedUserId = userId?.trim() || undefined;

  const { existingTask: lockedTask, updatedTask } = await db.transaction(
    async (tx) => {
      const lockedTask = await lockTaskAndAssertProjectLive(tx, id);
      if (projectId !== lockedTask.projectId) {
        throw new HTTPException(400, {
          message: "Use the task move endpoint to move tasks between projects",
        });
      }
      // Keep field validation behind the locked source liveness check.
      const parsedStartDate =
        startDate !== undefined
          ? validateAndParseDate(startDate, "startDate")
          : undefined;
      const parsedDueDate =
        dueDate !== undefined
          ? validateAndParseDate(dueDate, "dueDate")
          : undefined;
      validateDateRange(parsedStartDate, parsedDueDate);
      if (normalizedUserId) {
        rejectNulByte(normalizedUserId, "Assignee id");
      }
      const projectWorkspaceId = await getProjectWorkspaceId(projectId, tx);
      await assertValidTaskStatus(status, projectId, tx);
      if (normalizedUserId) {
        await assertAssignableUser(normalizedUserId, projectWorkspaceId, tx);
      }
      const column = await tx.query.columnTable.findFirst({
        where: and(
          eq(columnTable.projectId, projectId),
          eq(columnTable.slug, status),
        ),
      });
      const [updatedTask] = await tx
        .update(taskTable)
        .set({
          title,
          status,
          columnId: column?.id ?? null,
          startDate: parsedStartDate || null,
          dueDate: parsedDueDate || null,
          projectId,
          description,
          priority,
          position,
          userId: normalizedUserId ?? null,
        })
        .where(eq(taskTable.id, id))
        .returning();
      return { existingTask: lockedTask, updatedTask };
    },
  );

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task",
    });
  }

  const previousStatus = lockedTask.status;
  const previousDescription = lockedTask.description;

  if (previousStatus !== status) {
    await publishEvent("task.status_changed", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      oldStatus: previousStatus,
      newStatus: status,
      title: updatedTask.title,
      assigneeId: updatedTask.userId,
      type: "status_changed",
    });

    await publishEvent("task-relation.refresh", {
      projectId: updatedTask.projectId,
      userId: currentUserId,
    });
  }

  await publishEvent("task.updated", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    title: updatedTask.title,
    status: updatedTask.status,
    userId: currentUserId,
  });

  if (previousDescription !== description) {
    deleteOrphanedAssets(previousDescription, description, {
      taskId: id,
    }).catch(() => {});
  }

  return updatedTask;
}

export default updateTask;
