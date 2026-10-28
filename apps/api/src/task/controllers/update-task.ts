import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { recordLegacyTaskCompatibilityEvent } from "../../events/legacy-task-compatibility";
import {
  dispatchLegacyTaskNotification,
  insertLegacyTaskActivity,
  insertLegacyTaskNotification,
} from "../../events/legacy-task-effects";
import { syncInlineAssetReferences } from "../../storage/cleanup-assets";
import {
  assertAssignableUserAndLockMembership,
  getProjectWorkspaceId,
} from "../../utils/assert-assignable-user";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import {
  validateAndParseDate,
  validateDateRange,
} from "../../utils/validate-dates";
import { lockTaskAndAssertProjectLiveForIdentity } from "../assert-task-project-live";
import { findColumnBySlugForIdentity, updateTaskRow } from "../repository";
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
  identity: ResolvedIdentity,
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
  apiKeyId?: string | null,
) {
  const normalizedUserId = userId?.trim() || undefined;

  const {
    existingTask: lockedTask,
    updatedTask,
    notification,
    changes,
  } = await db.transaction(async (tx) => {
    const lockedTask = await lockTaskAndAssertProjectLiveForIdentity(
      tx,
      id,
      identity,
    );
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
    await assertValidTaskStatus(identity, status, projectId, tx);
    if (normalizedUserId) {
      await assertAssignableUserAndLockMembership(
        normalizedUserId,
        projectWorkspaceId,
        tx,
      );
    }
    const column = await findColumnBySlugForIdentity(
      tx,
      identity,
      projectId,
      status,
    );
    const nextStartDate = parsedStartDate ?? null;
    const nextDueDate = parsedDueDate ?? null;
    const nextUserId = normalizedUserId ?? null;
    const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
    const addChange = (field: string, from: unknown, to: unknown) => {
      if (from !== to) changes.push({ field, from, to });
    };
    const dateValue = (value: Date | null | undefined) =>
      value?.toISOString() ?? null;
    addChange("title", lockedTask.title, title);
    addChange("status", lockedTask.status, status);
    addChange(
      "startDate",
      dateValue(lockedTask.startDate),
      dateValue(nextStartDate),
    );
    addChange("dueDate", dateValue(lockedTask.dueDate), dateValue(nextDueDate));
    addChange("description", lockedTask.description ?? "", description);
    addChange("priority", lockedTask.priority, priority);
    addChange("position", lockedTask.position, position);
    addChange("userId", lockedTask.userId, nextUserId);
    if (changes.length === 0) {
      return {
        existingTask: lockedTask,
        updatedTask: lockedTask,
        notification: null,
        changes,
      };
    }
    const updatedTask = await updateTaskRow(tx, identity, id, {
      title,
      status,
      columnId: column?.id ?? null,
      startDate: nextStartDate,
      dueDate: nextDueDate,
      description,
      priority,
      position,
      userId: nextUserId,
    });
    let notification: Awaited<ReturnType<typeof insertLegacyTaskNotification>> =
      null;
    let eventId: string | null = null;
    if (updatedTask) {
      eventId = await recordLegacyTaskCompatibilityEvent(tx, {
        kind: "task.updated",
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        workspaceId: projectWorkspaceId,
        identity,
        apiKeyId,
        payload: { changes, type: "updated" },
      });
    }
    if (
      updatedTask &&
      eventId &&
      lockedTask.status !== status &&
      currentUserId
    ) {
      await insertLegacyTaskActivity(tx, identity, {
        taskId: updatedTask.id,
        type: "status_changed",
        userId: currentUserId,
        eventData: { oldStatus: lockedTask.status, newStatus: status },
      });
      if (updatedTask.userId && updatedTask.userId !== currentUserId) {
        notification = await insertLegacyTaskNotification(tx, {
          eventId,
          eventKind: "task.updated",
          userId: updatedTask.userId,
          type: "task_status_changed",
          taskId: updatedTask.id,
          projectId: updatedTask.projectId,
          eventData: {
            taskTitle: updatedTask.title,
            oldStatus: lockedTask.status,
            newStatus: status,
          },
        });
      }
    }
    if (updatedTask && (lockedTask.description ?? "") !== description) {
      // P0R1-01: detach (never delete) removed inline images in the same transaction.
      await syncInlineAssetReferences(
        tx,
        identity,
        lockedTask.description,
        description,
        { taskId: id },
      );
    }
    return { existingTask: lockedTask, updatedTask, notification, changes };
  });

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task",
    });
  }

  const previousStatus = lockedTask.status;

  if (changes.length === 0) return updatedTask;

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
    await dispatchLegacyTaskNotification(notification);
  }

  await publishEvent("task.updated", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    title: updatedTask.title,
    status: updatedTask.status,
    userId: currentUserId,
  });

  return updatedTask;
}

export default updateTask;
