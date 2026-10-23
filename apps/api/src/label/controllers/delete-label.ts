import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import type { Transaction } from "../../database/executor";
import { publishEvent } from "../../events";
import {
  type lockLegacyTaskRow,
  lockLegacyTaskRowIfPresent,
  lockProjectsAndAssertLive,
  lockTaskAndAssertProjectLive,
} from "../../task/assert-task-project-live";
import {
  clearCatalogueLabel,
  publishCatalogueLabelChanges,
} from "../../work-item/clear-catalogue-label";
import {
  deleteLabelById,
  deleteLabelsByIds,
  findLabelById,
  listTaskLabelCopiesWithTask,
  lockLabelRow,
  lockTaskLabelCopies,
  lockWorkspaceLabelNames,
} from "../repository";

type LabelSnapshot = NonNullable<Awaited<ReturnType<typeof findLabelById>>>;

/**
 * The deletion body, run inside a caller-owned transaction (the direct controller below, or the
 * pending-action approval in `../label-deletion-target.ts`). Publishing stays with the caller,
 * after commit, through `publishLabelDeletion`.
 */
export async function deleteLabelInTransaction(
  tx: Transaction,
  identity: ResolvedIdentity,
  labelSnapshot: Pick<LabelSnapshot, "id" | "taskId" | "workspaceId" | "name">,
  userId: string,
) {
  const id = labelSnapshot.id;
  await lockWorkspaceLabelNames(tx, labelSnapshot.workspaceId, [
    labelSnapshot.name,
  ]);
  let lockedTask: Awaited<ReturnType<typeof lockLegacyTaskRow>> | undefined;
  if (labelSnapshot.taskId) {
    lockedTask = await lockTaskAndAssertProjectLive(tx, labelSnapshot.taskId);
  }
  const label = await lockLabelRow(tx, identity, id);
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
    const deletedLabel = await deleteLabelById(tx, identity, id);
    if (!deletedLabel) {
      throw new HTTPException(404, { message: "Label not found" });
    }
    return {
      deletedLabel,
      canonicalChanges: [],
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

  const canonicalChanges = await clearCatalogueLabel(
    tx,
    label.workspaceId,
    label.id,
    userId,
    identity,
  );

  const deletedLabel = await deleteLabelById(tx, identity, id);
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
    canonicalChanges,
    affectedLabels: emittedRows,
  };
}

export async function publishLabelDeletion(
  result: Awaited<ReturnType<typeof deleteLabelInTransaction>>,
  userId: string,
) {
  await publishCatalogueLabelChanges(result.canonicalChanges);
  for (const { taskId, projectId } of result.affectedLabels) {
    await publishEvent("task.label_deleted", {
      task: { id: taskId, projectId },
      projectId,
      taskId,
      userId,
      type: "label_deleted",
    });
  }
}

async function deleteLabel(
  identity: ResolvedIdentity,
  id: string,
  userId: string,
) {
  const labelSnapshot = await findLabelById(identity, id);
  if (!labelSnapshot) {
    throw new HTTPException(404, { message: "Label not found" });
  }

  const result = await db.transaction((tx) =>
    deleteLabelInTransaction(tx, identity, labelSnapshot, userId),
  );
  await publishLabelDeletion(result, userId);
  return result.deletedLabel;
}

export default deleteLabel;
