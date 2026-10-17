import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { insertRequiredTaskActivity } from "../../activity/repository";
import db from "../../database";
import { publishEvent } from "../../events";
import { lockTaskAndAssertProjectLiveForIdentity } from "../assert-task-project-live";
import { updateTaskRow } from "../repository";

async function updateTaskPriority({
  identity,
  id,
  priority,
  currentUserId,
}: {
  identity: ResolvedIdentity;
  id: string;
  priority: string;
  currentUserId: string;
}) {
  const { existingTask, updatedTask } = await db.transaction(async (tx) => {
    const existingTask = await lockTaskAndAssertProjectLiveForIdentity(
      tx,
      id,
      identity,
    );
    const updatedTask = await updateTaskRow(tx, identity, id, { priority });
    if (updatedTask) {
      await insertRequiredTaskActivity(tx, identity, {
        taskId: updatedTask.id,
        type: "priority_changed",
        userId: currentUserId,
        content: null,
        eventData: {
          oldPriority: existingTask.priority,
          newPriority: priority,
        },
      });
    }
    return { existingTask, updatedTask };
  });

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task priority",
    });
  }

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
