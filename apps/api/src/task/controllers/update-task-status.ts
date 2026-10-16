import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { lockTaskAndAssertProjectLiveForIdentity } from "../assert-task-project-live";
import { findColumnBySlugForIdentity, updateTaskRow } from "../repository";
import { assertValidTaskStatus } from "../validate-task-fields";

async function updateTaskStatus({
  identity,
  id,
  status,
  currentUserId,
}: {
  identity: ResolvedIdentity;
  id: string;
  status: string;
  currentUserId: string;
}) {
  const { existingTask, updatedTask } = await db.transaction(async (tx) => {
    const existingTask = await lockTaskAndAssertProjectLiveForIdentity(
      tx,
      id,
      identity,
    );
    await assertValidTaskStatus(status, existingTask.projectId, tx);
    const column = await findColumnBySlugForIdentity(
      identity,
      tx,
      existingTask.projectId,
      status,
    );
    const updatedTask = await updateTaskRow(identity, tx, id, {
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
