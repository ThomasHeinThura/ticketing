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
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import { lockTaskAndAssertProjectLiveForIdentity } from "../assert-task-project-live";
import { findColumnBySlugForIdentity, updateTaskRow } from "../repository";
import { assertValidTaskStatus } from "../validate-task-fields";

async function updateTaskStatus({
  identity,
  id,
  status,
  currentUserId,
  apiKeyId,
}: {
  identity: ResolvedIdentity;
  id: string;
  status: string;
  currentUserId: string;
  apiKeyId?: string | null;
}) {
  const { existingTask, updatedTask, notification, statusChanged } =
    await db.transaction(async (tx) => {
      const existingTask = await lockTaskAndAssertProjectLiveForIdentity(
        tx,
        id,
        identity,
      );
      await assertValidTaskStatus(identity, status, existingTask.projectId, tx);
      const column = await findColumnBySlugForIdentity(
        tx,
        identity,
        existingTask.projectId,
        status,
      );
      if (existingTask.status === status) {
        return {
          existingTask,
          updatedTask: existingTask,
          notification: null,
          statusChanged: false,
        };
      }
      const updatedTask = await updateTaskRow(tx, identity, id, {
        status,
        columnId: column?.id ?? null,
      });
      let notification: Awaited<
        ReturnType<typeof insertLegacyTaskNotification>
      > = null;
      if (updatedTask) {
        const workspaceId = await getProjectWorkspaceId(
          updatedTask.projectId,
          tx,
        );
        if (!workspaceId) {
          throw new HTTPException(404, { message: "Task not found" });
        }
        const eventId = await recordLegacyTaskCompatibilityEvent(tx, {
          kind: "task.status_changed",
          taskId: updatedTask.id,
          projectId: updatedTask.projectId,
          workspaceId,
          identity,
          apiKeyId,
          payload: {
            oldStatus: existingTask.status,
            newStatus: status,
            type: "status_changed",
          },
        });
        await insertLegacyTaskActivity(tx, identity, {
          taskId: updatedTask.id,
          type: "status_changed",
          userId: currentUserId,
          eventData: { oldStatus: existingTask.status, newStatus: status },
        });
        if (updatedTask.userId && updatedTask.userId !== currentUserId) {
          notification = await insertLegacyTaskNotification(tx, {
            eventId,
            eventKind: "task.status_changed",
            userId: updatedTask.userId,
            type: "task_status_changed",
            taskId: updatedTask.id,
            projectId: updatedTask.projectId,
            eventData: {
              taskTitle: updatedTask.title,
              oldStatus: existingTask.status,
              newStatus: status,
            },
          });
        }
      }
      return { existingTask, updatedTask, notification, statusChanged: true };
    });

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task status",
    });
  }

  if (!statusChanged) return updatedTask;

  await publishEvent("task.status_changed", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    userId: currentUserId,
    oldStatus: existingTask.status,
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

  return updatedTask;
}

export default updateTaskStatus;
