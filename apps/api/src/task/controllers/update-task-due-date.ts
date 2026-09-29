import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskReminderSentTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { lockTaskAndAssertProjectLive } from "../assert-task-project-live";

async function updateTaskDueDate({
  id,
  dueDate,
  currentUserId,
}: {
  id: string;
  dueDate: Date | null;
  currentUserId: string;
}) {
  const { existingTask, updatedTask } = await db.transaction(async (tx) => {
    const existingTask = await lockTaskAndAssertProjectLive(tx, id);
    await tx
      .delete(taskReminderSentTable)
      .where(eq(taskReminderSentTable.taskId, id));
    const [updatedTask] = await tx
      .update(taskTable)
      .set({ dueDate: dueDate || null })
      .where(eq(taskTable.id, id))
      .returning();
    return { existingTask, updatedTask };
  });

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task due date",
    });
  }

  await publishEvent("task.due_date_changed", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    userId: currentUserId,
    oldDueDate: existingTask.dueDate,
    newDueDate: dueDate,
    title: updatedTask.title,
    type: "due_date_changed",
  });

  return updatedTask;
}

export default updateTaskDueDate;
