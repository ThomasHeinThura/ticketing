import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { lockTaskAndAssertProjectLive } from "../assert-task-project-live";
import { insertTaskActivity, updateTaskRow } from "../repository";

async function updateTaskTitle({
  id,
  title,
  currentUserId,
}: {
  id: string;
  title: string;
  currentUserId: string;
}) {
  const { existingTask, updatedTask } = await db.transaction(async (tx) => {
    const existingTask = await lockTaskAndAssertProjectLive(tx, id);
    if (existingTask.title === title) {
      return { existingTask, updatedTask: existingTask };
    }
    const task = await updateTaskRow(tx, id, { title });

    if (!task) {
      throw new HTTPException(500, {
        message: "Failed to update task title",
      });
    }

    await insertTaskActivity(tx, {
      taskId: task.id,
      type: "title_changed",
      userId: currentUserId,
      content: null,
      eventData: { oldTitle: existingTask.title, newTitle: title },
    });

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
