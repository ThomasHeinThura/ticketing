import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { recordLegacyTaskCompatibilityEvent } from "../../events/legacy-task-compatibility";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import { lockTaskAndAssertProjectLiveForIdentity } from "../assert-task-project-live";
import { insertTaskActivity, updateTaskRow } from "../repository";

async function updateTaskTitle({
  identity,
  id,
  title,
  currentUserId,
  apiKeyId,
}: {
  identity: ResolvedIdentity;
  id: string;
  title: string;
  currentUserId: string;
  apiKeyId?: string | null;
}) {
  const { existingTask, updatedTask } = await db.transaction(async (tx) => {
    const existingTask = await lockTaskAndAssertProjectLiveForIdentity(
      tx,
      id,
      identity,
    );
    if (existingTask.title === title) {
      return { existingTask, updatedTask: existingTask };
    }
    const task = await updateTaskRow(tx, identity, id, { title });

    if (!task) {
      throw new HTTPException(500, {
        message: "Failed to update task title",
      });
    }

    const workspaceId = await getProjectWorkspaceId(task.projectId, tx);
    await recordLegacyTaskCompatibilityEvent(tx, {
      kind: "task.title_changed",
      taskId: task.id,
      projectId: task.projectId,
      workspaceId,
      identity,
      apiKeyId,
      payload: {
        oldTitle: existingTask.title,
        newTitle: task.title,
        type: "title_changed",
      },
    });

    const activity = await insertTaskActivity(tx, identity, {
      taskId: task.id,
      type: "title_changed",
      userId: currentUserId,
      content: null,
      eventData: { oldTitle: existingTask.title, newTitle: title },
    });
    if (!activity) {
      throw new HTTPException(500, {
        message: "Failed to create task title activity",
      });
    }

    return { existingTask, updatedTask: task };
  });

  if (existingTask.title === title) return updatedTask;

  await publishEvent("task.title_changed", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    userId: currentUserId,
    oldTitle: existingTask.title,
    newTitle: title,
    type: "title_changed",
  });

  return updatedTask;
}

export default updateTaskTitle;
