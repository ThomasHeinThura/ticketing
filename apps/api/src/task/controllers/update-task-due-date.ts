import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { recordLegacyTaskCompatibilityEvent } from "../../events/legacy-task-compatibility";
import { insertLegacyTaskActivity } from "../../events/legacy-task-effects";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import { validateAndParseDate } from "../../utils/validate-dates";
import { lockTaskAndAssertProjectLiveForIdentity } from "../assert-task-project-live";
import { clearTaskReminders, updateTaskRow } from "../repository";

async function updateTaskDueDate({
  identity,
  id,
  dueDate: dueDateInput,
  currentUserId,
  apiKeyId,
}: {
  identity: ResolvedIdentity;
  id: string;
  dueDate: string | null;
  currentUserId: string;
  apiKeyId?: string | null;
}) {
  const { existingTask, updatedTask, dueDate, changed } = await db.transaction(
    async (tx) => {
      const existingTask = await lockTaskAndAssertProjectLiveForIdentity(
        tx,
        id,
        identity,
      );
      const dueDate = dueDateInput
        ? validateAndParseDate(dueDateInput, "dueDate")
        : null;
      if (
        (existingTask.dueDate?.getTime() ?? null) ===
        (dueDate?.getTime() ?? null)
      ) {
        return {
          existingTask,
          updatedTask: existingTask,
          dueDate,
          changed: false,
        };
      }
      await clearTaskReminders(tx, identity, id);
      const updatedTask = await updateTaskRow(tx, identity, id, {
        dueDate: dueDate || null,
      });
      if (!updatedTask) {
        throw new HTTPException(500, {
          message: "Failed to update task due date",
        });
      }
      const workspaceId = await getProjectWorkspaceId(
        updatedTask.projectId,
        tx,
      );
      await recordLegacyTaskCompatibilityEvent(tx, {
        kind: "task.due_date_changed",
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        workspaceId,
        identity,
        apiKeyId,
        payload: {
          oldDueDate: existingTask.dueDate?.toISOString() ?? null,
          newDueDate: dueDate?.toISOString() ?? null,
          type: "due_date_changed",
        },
      });
      await insertLegacyTaskActivity(tx, identity, {
        taskId: updatedTask.id,
        type: "due_date_changed",
        userId: currentUserId,
        eventData: {
          oldDueDate: existingTask.dueDate?.toISOString() ?? null,
          newDueDate: dueDate?.toISOString() ?? null,
        },
      });
      return { existingTask, updatedTask, dueDate, changed: true };
    },
  );

  if (!changed) return updatedTask;

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
