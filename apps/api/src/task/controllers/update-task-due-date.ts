import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { insertRequiredTaskActivity } from "../../activity/repository";
import db from "../../database";
import { publishEvent } from "../../events";
import { validateAndParseDate } from "../../utils/validate-dates";
import { lockTaskAndAssertProjectLiveForIdentity } from "../assert-task-project-live";
import { clearTaskReminders, updateTaskRow } from "../repository";

async function updateTaskDueDate({
  identity,
  id,
  dueDate: dueDateInput,
  currentUserId,
}: {
  identity: ResolvedIdentity;
  id: string;
  dueDate: string | null;
  currentUserId: string;
}) {
  const { existingTask, updatedTask, dueDate } = await db.transaction(
    async (tx) => {
      const existingTask = await lockTaskAndAssertProjectLiveForIdentity(
        tx,
        id,
        identity,
      );
      const dueDate = dueDateInput
        ? validateAndParseDate(dueDateInput, "dueDate")
        : null;
      await clearTaskReminders(tx, identity, id);
      const updatedTask = await updateTaskRow(tx, identity, id, {
        dueDate: dueDate || null,
      });
      if (!updatedTask) {
        throw new HTTPException(500, {
          message: "Failed to update task due date",
        });
      }
      await insertRequiredTaskActivity(tx, identity, {
        taskId: updatedTask.id,
        type: "due_date_changed",
        userId: currentUserId,
        content: null,
        eventData: {
          oldDueDate: existingTask.dueDate,
          newDueDate: dueDate,
        },
      });
      return { existingTask, updatedTask, dueDate };
    },
  );

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
