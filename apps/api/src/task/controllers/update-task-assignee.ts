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
import {
  assertAssignableUserAndLockMembership,
  getProjectWorkspaceId,
} from "../../utils/assert-assignable-user";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import { lockTaskAndAssertProjectLiveForIdentity } from "../assert-task-project-live";
import {
  findProjectWorkspaceContext,
  findUserName,
  updateTaskRow,
} from "../repository";

async function updateTaskAssignee({
  identity,
  id,
  userId,
  currentUserId,
  apiKeyId,
}: {
  identity: ResolvedIdentity;
  id: string;
  userId: string | null;
  currentUserId: string;
  apiKeyId?: string | null;
}) {
  const nextAssigneeId = userId?.trim() || null;
  const { existingTask, updatedTask, newAssigneeName, notification } =
    await db.transaction(async (tx) => {
      const existingTask = await lockTaskAndAssertProjectLiveForIdentity(
        tx,
        id,
        identity,
      );
      // Validate body identifiers after the frozen-task check, before they reach raw
      // database filters. `null` (unassign) is left alone.
      if (userId) {
        rejectNulByte(userId, "Assignee id");
      }
      if (existingTask.userId === nextAssigneeId) {
        return {
          existingTask,
          updatedTask: existingTask,
          newAssigneeName: undefined,
          notification: null,
        };
      }
      if (nextAssigneeId) {
        const project = await findProjectWorkspaceContext(
          tx,
          identity,
          existingTask.projectId,
        );
        if (!project)
          throw new HTTPException(404, { message: "Task not found" });
        await assertAssignableUserAndLockMembership(
          nextAssigneeId,
          project.workspaceId,
          tx,
        );
      }
      const updatedTask = await updateTaskRow(tx, identity, id, {
        userId: nextAssigneeId,
      });
      const newAssigneeName = nextAssigneeId
        ? (
            await findUserName(
              identity,
              nextAssigneeId,
              existingTask.projectId,
              tx,
            )
          )?.name
        : undefined;
      let notification: Awaited<
        ReturnType<typeof insertLegacyTaskNotification>
      > = null;
      if (updatedTask && existingTask.userId !== nextAssigneeId) {
        const workspaceId = await getProjectWorkspaceId(
          updatedTask.projectId,
          tx,
        );
        const eventId = await recordLegacyTaskCompatibilityEvent(tx, {
          kind: nextAssigneeId ? "task.assignee_changed" : "task.unassigned",
          taskId: updatedTask.id,
          projectId: updatedTask.projectId,
          workspaceId,
          identity,
          apiKeyId,
          payload: {
            oldAssigneeId: existingTask.userId,
            newAssigneeId: nextAssigneeId,
            type: nextAssigneeId ? "assignee_changed" : "unassigned",
          },
        });
        if (nextAssigneeId) {
          await insertLegacyTaskActivity(tx, identity, {
            taskId: updatedTask.id,
            type: "assignee_changed",
            userId: currentUserId,
            eventData: {
              newAssigneeId: nextAssigneeId,
              newAssignee: newAssigneeName,
              isSelfAssigned: currentUserId === nextAssigneeId,
            },
          });
          notification = await insertLegacyTaskNotification(tx, {
            eventId,
            eventKind: nextAssigneeId
              ? "task.assignee_changed"
              : "task.unassigned",
            userId: nextAssigneeId,
            type: "task_assignee_changed",
            taskId: updatedTask.id,
            projectId: updatedTask.projectId,
            eventData: { taskTitle: updatedTask.title },
          });
        } else {
          await insertLegacyTaskActivity(tx, identity, {
            taskId: updatedTask.id,
            type: "unassigned",
            userId: currentUserId,
          });
        }
      }
      return { existingTask, updatedTask, newAssigneeName, notification };
    });
  if (existingTask.userId === nextAssigneeId) return updatedTask;

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task assignee",
    });
  }

  if (!nextAssigneeId) {
    await publishEvent("task.unassigned", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      title: updatedTask.title,
      type: "unassigned",
    });

    await dispatchLegacyTaskNotification(notification);

    return updatedTask;
  }

  await publishEvent("task.assignee_changed", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    userId: currentUserId,
    oldAssignee: existingTask.userId,
    newAssignee: newAssigneeName,
    newAssigneeId: nextAssigneeId,
    title: updatedTask.title,
    type: "assignee_changed",
  });

  await dispatchLegacyTaskNotification(notification);

  return updatedTask;
}

export default updateTaskAssignee;
