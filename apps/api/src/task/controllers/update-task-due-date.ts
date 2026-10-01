import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskReminderSentTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { validateAndParseDate } from "../../utils/validate-dates";
import { lockTaskAndAssertProjectLive } from "../assert-task-project-live";

async function updateTaskDueDate({
  id,
  dueDate: dueDateInput,
  currentUserId,
}: {
  id: string;
  dueDate: string | null;
  currentUserId: string;
}) {
  const { existingTask, updatedTask, dueDate } = await db.transaction(
    async (tx) => {
      const existingTask = await lockTaskAndAssertProjectLive(tx, id);
      const dueDate = dueDateInput
        ? validateAndParseDate(dueDateInput, "dueDate")
        : null;
      await tx
        .delete(taskReminderSentTable)
        .where(eq(taskReminderSentTable.taskId, id));
      const [updatedTask] = await tx
        .update(taskTable)
        .set({
          dueDate: dueDate || null,
          version: sql`${taskTable.version} + 1`,
        })
        .where(eq(taskTable.id, id))
        .returning();
      return { existingTask, updatedTask, dueDate };
    },
  );

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
