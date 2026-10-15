import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { lockTaskAndAssertProjectLive } from "../assert-task-project-live";
import { findColumnBySlug, updateTaskRow } from "../repository";
import { assertValidTaskStatus } from "../validate-task-fields";

async function updateTaskStatus({
  id,
  status,
  currentUserId,
}: {
  id: string;
  status: string;
  currentUserId: string;
}) {
  const { existingTask, updatedTask } = await db.transaction(async (tx) => {
    const existingTask = await lockTaskAndAssertProjectLive(tx, id);
    await assertValidTaskStatus(status, existingTask.projectId, tx);
    const column = await findColumnBySlug(tx, existingTask.projectId, status);
    const updatedTask = await updateTaskRow(tx, id, {
      status,
      columnId: column?.id ?? null,
    });
    return { existingTask, updatedTask };
  });

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task status",
    });
  }

  await publishEvent("task.status_changed", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    userId: currentUserId,
    oldStatus: existingTask.status,
    newStatus: status,
    title: updatedTask.title,
    assigneeId: updatedTask.userId,
    type: "status_changed",
  });

  await publishEvent("task-relation.refresh", {
    projectId: updatedTask.projectId,
    userId: currentUserId,
  });

  return updatedTask;
}

export default updateTaskStatus;
