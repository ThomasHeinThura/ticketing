import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { recordLegacyTaskCompatibilityEvent } from "../../events/legacy-task-compatibility";
import { insertLegacyTaskActivity } from "../../events/legacy-task-effects";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import { lockTaskAndAssertProjectLiveForIdentity } from "../assert-task-project-live";
import { updateTaskRow } from "../repository";

async function updateTaskPriority({
  identity,
  id,
  priority,
  currentUserId,
  apiKeyId,
}: {
  identity: ResolvedIdentity;
  id: string;
  priority: string;
  currentUserId: string;
  apiKeyId?: string | null;
}) {
  const { existingTask, updatedTask, changed } = await db.transaction(
    async (tx) => {
      const existingTask = await lockTaskAndAssertProjectLiveForIdentity(
        tx,
        id,
        identity,
      );
      if (existingTask.priority === priority) {
        return { existingTask, updatedTask: existingTask, changed: false };
      }
      const updatedTask = await updateTaskRow(tx, identity, id, { priority });
      if (updatedTask) {
        const workspaceId = await getProjectWorkspaceId(
          updatedTask.projectId,
          tx,
        );
        await recordLegacyTaskCompatibilityEvent(tx, {
          kind: "task.priority_changed",
          taskId: updatedTask.id,
          projectId: updatedTask.projectId,
          workspaceId,
          identity,
          apiKeyId,
          payload: {
            oldPriority: existingTask.priority,
            newPriority: updatedTask.priority,
            type: "priority_changed",
          },
        });
        await insertLegacyTaskActivity(tx, identity, {
          taskId: updatedTask.id,
          type: "priority_changed",
          userId: currentUserId,
          eventData: {
            oldPriority: existingTask.priority,
            newPriority: priority,
          },
        });
      }
      return { existingTask, updatedTask, changed: true };
    },
  );

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task priority",
    });
  }

  if (!changed) return updatedTask;

  await publishEvent("task.priority_changed", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    userId: currentUserId,
    oldPriority: existingTask.priority,
    newPriority: priority,
    title: updatedTask.title,
    type: "priority_changed",
  });

  return updatedTask;
}

export default updateTaskPriority;
