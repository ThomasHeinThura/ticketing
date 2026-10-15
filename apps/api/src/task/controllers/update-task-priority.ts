import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { lockTaskAndAssertProjectLive } from "../assert-task-project-live";
import { updateTaskRow } from "../repository";

async function updateTaskPriority({
  id,
  priority,
  currentUserId,
}: {
  id: string;
  priority: string;
  currentUserId: string;
}) {
  const { existingTask, updatedTask } = await db.transaction(async (tx) => {
    const existingTask = await lockTaskAndAssertProjectLive(tx, id);
    const updatedTask = await updateTaskRow(tx, id, { priority });
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
