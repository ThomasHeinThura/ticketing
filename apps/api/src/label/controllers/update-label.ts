import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import type { AppendAuditLogInput } from "../../audit/audit-writer";
import db from "../../database";
import { appendAuditSavepoint } from "../../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../../instance/observability/audit-failure-notifier";
import {
  lockLegacyTaskRowIfPresent,
  lockProjectsAndAssertLive,
  lockTaskAndAssertProjectLive,
} from "../../task/assert-task-project-live";
import {
  findLabelById,
  listTaskLabelCopyTaskIds,
  lockLabelRow,
  lockTaskLabelCopies,
  lockWorkspaceLabelNames,
  updateLabelById,
  updateLabelsByIds,
} from "../repository";

async function updateLabel(
  identity: ResolvedIdentity,
  id: string,
  name: string,
  color: string,
  actor: Pick<
    AppendAuditLogInput,
    | "actorId"
    | "actorType"
    | "apiKeyId"
    | "impersonatorId"
    | "actorIp"
    | "userAgent"
    | "traceId"
  >,
) {
  const labelSnapshot = await findLabelById(identity, id);
  if (!labelSnapshot) {
    throw new HTTPException(404, { message: "Label not found" });
  }

  const result = await db.transaction(async (tx) => {
    await lockWorkspaceLabelNames(tx, labelSnapshot.workspaceId, [
      labelSnapshot.name,
      name,
    ]);
    if (labelSnapshot.taskId) {
      await lockTaskAndAssertProjectLive(tx, labelSnapshot.taskId);
    }
    const label = await lockLabelRow(tx, identity, id);

    if (!label) {
      throw new HTTPException(404, {
        message: "Label not found",
      });
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

    const changedFields = [
      ...(label.name === name ? [] : ["name"]),
      ...(label.color === color ? [] : ["color"]),
    ];
    if (!changedFields.length)
      return { updatedLabel: label, auditFailed: false };

    let remainingCopyIds: string[] = [];
    if (!label.taskId && label.workspaceId) {
      const copies = await listTaskLabelCopyTaskIds(
        tx,
        label.workspaceId,
        label.name,
      );
      const taskIds = [
        ...new Set(
          copies
            .map((copy) => copy.taskId)
            .filter((taskId): taskId is string => Boolean(taskId)),
        ),
      ].sort();
      const tasks = [];
      for (const taskId of taskIds) {
        const task = await lockLegacyTaskRowIfPresent(tx, taskId);
        if (task) tasks.push(task);
      }
      await lockProjectsAndAssertLive(
        tx,
        tasks.map((task) => task.projectId),
      );
      const lockedTaskIds = tasks.map((task) => task.id);
      const remainingCopies = lockedTaskIds.length
        ? await lockTaskLabelCopies(
            tx,
            label.workspaceId,
            label.name,
            lockedTaskIds,
          )
        : [];
      remainingCopyIds = remainingCopies.map((copy) => copy.id);
    }

    const updatedLabel = await updateLabelById(tx, identity, id, {
      name,
      color,
    });

    if (remainingCopyIds.length > 0) {
      await updateLabelsByIds(tx, remainingCopyIds, { name, color });
    }

    const auditFailed =
      updatedLabel && !label.taskId && !label.projectId
        ? await appendAuditSavepoint(tx, {
            ...actor,
            workspaceId: label.workspaceId,
            action: "label.catalogue_updated",
            entityType: "label",
            entityId: id,
            after: { changedFields },
          })
        : false;
    return { updatedLabel, auditFailed };
  });
  if (result.auditFailed)
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return result.updatedLabel;
}

export default updateLabel;
