import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { insertRequiredTaskActivity } from "../../activity/repository";
import db from "../../database";
import { publishEvent } from "../../events";
import { assertAssignableUserAndLockMembership } from "../../utils/assert-assignable-user";
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
}: {
  identity: ResolvedIdentity;
  id: string;
  userId: string | null;
  currentUserId: string;
}) {
  const nextAssigneeId = userId?.trim() || null;
  const { existingTask, updatedTask, newAssigneeName } = await db.transaction(
    async (tx) => {
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
      const updatedTask = await updateTaskRow(tx, identity, id, {
        userId: nextAssigneeId,
      });
      if (updatedTask) {
        await insertRequiredTaskActivity(tx, identity, {
          taskId: updatedTask.id,
          type: nextAssigneeId ? "assignee_changed" : "unassigned",
          userId: currentUserId,
          content: null,
          eventData: nextAssigneeId
            ? {
                newAssigneeId: nextAssigneeId,
                newAssignee: newAssigneeName,
                isSelfAssigned: currentUserId === nextAssigneeId,
              }
            : {},
        });
      }
      return { existingTask, updatedTask, newAssigneeName };
    },
  );
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

  return updatedTask;
}

export default updateTaskAssignee;
