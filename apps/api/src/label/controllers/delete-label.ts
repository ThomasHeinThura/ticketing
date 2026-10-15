import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import {
  type lockLegacyTaskRow,
  lockLegacyTaskRowIfPresent,
  lockProjectsAndAssertLive,
  lockTaskAndAssertProjectLive,
} from "../../task/assert-task-project-live";
import {
  deleteLabelById,
  deleteLabelsByIds,
  findLabelById,
  listTaskLabelCopiesWithTask,
  lockLabelRow,
  lockTaskLabelCopies,
  lockWorkspaceLabelNames,
} from "../repository";

async function deleteLabel(id: string, userId: string) {
  const labelSnapshot = await findLabelById(id);
  if (!labelSnapshot) {
    throw new HTTPException(404, { message: "Label not found" });
  }

  const result = await db.transaction(async (tx) => {
    await lockWorkspaceLabelNames(tx, labelSnapshot.workspaceId, [
      labelSnapshot.name,
    ]);
    let lockedTask: Awaited<ReturnType<typeof lockLegacyTaskRow>> | undefined;
    if (labelSnapshot.taskId) {
      lockedTask = await lockTaskAndAssertProjectLive(tx, labelSnapshot.taskId);
    }
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

    if (label.taskId) {
      if (!lockedTask) {
        throw new HTTPException(404, { message: "Task not found" });
      }
      const deletedLabel = await deleteLabelById(tx, id);
      if (!deletedLabel) {
        throw new HTTPException(404, { message: "Label not found" });
      }
      return {
        deletedLabel,
        affectedLabels: [
          {
            label: deletedLabel,
            taskId: lockedTask.id,
            projectId: lockedTask.projectId,
          },
        ],
      };
    }

    const affectedLabels = label.workspaceId
      ? await listTaskLabelCopiesWithTask(tx, label.workspaceId, label.name)
      : [];
    const taskIds = [
      ...new Set(affectedLabels.map((entry) => entry.taskId)),
    ].sort();
    const tasks = new Map<
      string,
      Awaited<ReturnType<typeof lockLegacyTaskRow>>
    >();
    for (const taskId of taskIds) {
      const task = await lockLegacyTaskRowIfPresent(tx, taskId);
      if (task) tasks.set(taskId, task);
    }
    await lockProjectsAndAssertLive(
      tx,
      [...tasks.values()].map((task) => task.projectId),
    );

    const remainingTaskIds = [...tasks.keys()];
    const remainingCopies =
      label.workspaceId && remainingTaskIds.length
        ? await lockTaskLabelCopies(
            tx,
            label.workspaceId,
            label.name,
            remainingTaskIds,
          )
        : [];

    const deletedLabel = await deleteLabelById(tx, id);
    if (!deletedLabel) {
      throw new HTTPException(404, { message: "Label not found" });
    }

    const deletedCopies = remainingCopies.length
      ? await deleteLabelsByIds(
          tx,
          remainingCopies.map((copy) => copy.id),
        )
      : [];
    const emittedRows = deletedCopies.flatMap((child) => {
      const taskId = child.taskId;
      const task = taskId ? tasks.get(taskId) : undefined;
      return task && taskId
        ? [{ label: child, taskId, projectId: task.projectId }]
        : [];
    });
    return {
      deletedLabel,
      affectedLabels: emittedRows,
    };
  });

  for (const { label, taskId, projectId } of result.affectedLabels) {
    await publishEvent("task.label_deleted", {
      label,
      task: { id: taskId, projectId },
      projectId,
      taskId,
      userId,
      type: "label_deleted",
    });
  }

  return result.deletedLabel;
}

export default deleteLabel;
