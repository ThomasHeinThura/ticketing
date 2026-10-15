import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";
import {
  deleteLabelById,
  findLabelSnapshot,
  lockLabelRow,
  lockWorkspaceLabelNames,
} from "../repository";

async function unassignLabelFromTask(id: string, userId: string) {
  const { deletedLabel, task } = await db.transaction(async (tx) => {
    const labelSnapshot = await findLabelSnapshot(tx, id);
    if (!labelSnapshot) {
      throw new HTTPException(404, { message: "Label not found" });
    }
    if (!labelSnapshot.taskId) {
      throw new HTTPException(400, {
        message: "Label is not assigned to a task",
      });
    }

    await lockWorkspaceLabelNames(tx, labelSnapshot.workspaceId, [
      labelSnapshot.name,
    ]);

    // Match task deletion's task -> child-row lock order. A stale snapshot is
    // rejected below instead of taking a second task lock after the label lock.
    const lockedTask = await lockTaskAndAssertProjectLive(
      tx,
      labelSnapshot.taskId,
    );
    const label = await lockLabelRow(tx, id);
    if (!label) {
      throw new HTTPException(404, { message: "Label not found" });
    }
    if (
      label.taskId !== labelSnapshot.taskId ||
      label.workspaceId !== labelSnapshot.workspaceId ||
      label.name !== labelSnapshot.name
    ) {
      throw new HTTPException(409, {
        message: "Label changed; retry the request",
      });
    }

    const deletedLabel = await deleteLabelById(tx, id);
    return {
      deletedLabel,
      task: {
        id: lockedTask.id,
        projectId: lockedTask.projectId,
      },
    };
  });

  if (!deletedLabel) {
    throw new HTTPException(500, {
      message: "Failed to detach label from task",
    });
  }

  await publishEvent("task.label_unassigned", {
    label: deletedLabel,
    task,
    projectId: task.projectId,
    taskId: deletedLabel.taskId,
    userId,
    type: "label_unassigned",
  });

  return deletedLabel;
}

export default unassignLabelFromTask;
