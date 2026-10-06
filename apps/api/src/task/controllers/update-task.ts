import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import {
  assertAssignableUserAndLockMembership,
  getProjectWorkspaceId,
} from "../../utils/assert-assignable-user";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import {
  validateAndParseDate,
  validateDateRange,
} from "../../utils/validate-dates";
import { lockTaskAndAssertProjectLive } from "../assert-task-project-live";
import { findTaskColumnBySlugQuery } from "../repository";
import { assertValidTaskStatus } from "../validate-task-fields";

export class TaskVersionConflictError extends Error {
  constructor(
    public readonly assertedVersion: number,
    public readonly currentVersion: number,
  ) {
    super(
      `Version mismatch: expected version ${assertedVersion}, but the task is now at version ${currentVersion}`,
    );
    this.name = "TaskVersionConflictError";
  }
}

async function updateTask(
  id: string,
  assertedVersion: number | undefined,
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
  const normalizedUserId = userId?.trim() || undefined;

  const { existingTask: lockedTask, updatedTask } = await db.transaction(
    async (tx) => {
      const lockedTask = await lockTaskAndAssertProjectLive(tx, id);
      if (
        assertedVersion !== undefined &&
        lockedTask.version !== assertedVersion
      ) {
        throw new TaskVersionConflictError(assertedVersion, lockedTask.version);
      }
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
        await assertAssignableUserAndLockMembership(
          normalizedUserId,
          projectWorkspaceId,
          tx,
        );
      }
      const column = await findTaskColumnBySlugQuery(tx, projectId, status);
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
          version: sql`${taskTable.version} + 1`,
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
