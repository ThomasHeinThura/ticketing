import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { schema } from "../database";
import {
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import type { PendingActionTransaction } from "../pending-action/service";
import { lockTaskAndAssertProjectLive } from "../task/assert-task-project-live";
import { assertProjectStillLive } from "../work-item/assert-work-item-live";
import {
  clearCatalogueLabel,
  publishCatalogueLabelChanges,
} from "../work-item/clear-catalogue-label";
import {
  deleteLabelInTransaction,
  publishLabelDeletion,
} from "./controllers/delete-label";
import { deleteProjectLabel } from "./project-repository";
import { lockWorkspaceLabelNames } from "./repository";

export const LABEL_DELETION_ROUTE = "DELETE /api/label/{id}" as const;
export const PROJECT_LABEL_DELETION_ROUTE =
  "DELETE /api/label/project/{projectId}/catalogue/{id}" as const;

/** A refusal raised by a live-row assertion means "target unavailable", never a 500. */
async function unlessGone(check: () => Promise<unknown>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 404) return false;
    throw error;
  }
}

async function readLabel(tx: PendingActionTransaction, id: string) {
  const [label] = await tx
    .select()
    .from(schema.labelTable)
    .where(eq(schema.labelTable.id, id))
    .limit(1);
  return label;
}

/**
 * `DELETE /api/label/{id}` (workspace catalogue label or a task-level copy). Locks in the same
 * order as `controllers/delete-label.ts`: workspace label-name family, then the task (and its
 * live project), then the label row.
 */
export const labelDeletionTarget: RegisteredDeletionTarget = {
  targetType: "label",
  routeKey: LABEL_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Label not found",
  load: async (tx, id) => {
    const anchor = await readLabel(tx, id);
    if (!anchor?.workspaceId) return undefined;
    await lockWorkspaceLabelNames(tx, anchor.workspaceId, [anchor.name]);
    const taskId = anchor.taskId;
    if (
      taskId &&
      !(await unlessGone(() => lockTaskAndAssertProjectLive(tx, taskId)))
    )
      return undefined;
    const [label] = await tx
      .select()
      .from(schema.labelTable)
      .where(eq(schema.labelTable.id, id))
      .for("update")
      .limit(1);
    if (
      !label ||
      label.workspaceId !== anchor.workspaceId ||
      label.name !== anchor.name ||
      label.taskId !== anchor.taskId
    )
      return undefined;
    return {
      id: label.id,
      workspaceId: anchor.workspaceId,
      projectId: null,
      organisationId: null,
      name: label.name,
      summary: {
        labelId: label.id,
        name: label.name,
        color: label.color,
        taskLabel: label.taskId !== null,
      },
      version: registeredDeletionFingerprint(label),
    };
  },
  execute: async (tx, { loaded, identity, input }) => {
    const label = await readLabel(tx, loaded.id);
    if (!label)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    const result = await deleteLabelInTransaction(
      tx,
      identity,
      {
        id: label.id,
        taskId: label.taskId,
        workspaceId: label.workspaceId,
        name: label.name,
      },
      input.userId,
    );
    return { afterCommit: () => publishLabelDeletion(result, input.userId) };
  },
};

/**
 * `DELETE /api/label/project/{projectId}/catalogue/{id}`: a project catalogue label and its
 * journaled removal from every work item, as `removeProjectCatalogueLabel` does.
 */
export const projectLabelDeletionTarget: RegisteredDeletionTarget = {
  targetType: "project_label",
  routeKey: PROJECT_LABEL_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Label not found",
  load: async (tx, id) => {
    const anchor = await readLabel(tx, id);
    if (!anchor?.projectId) return undefined;
    const projectId = anchor.projectId;
    const [project] = await tx
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, projectId))
      .limit(1);
    if (!project) return undefined;
    await lockWorkspaceLabelNames(tx, project.workspaceId, []);
    if (
      !(await unlessGone(() =>
        assertProjectStillLive(tx, projectId, "Project not found"),
      ))
    )
      return undefined;
    const [label] = await tx
      .select()
      .from(schema.labelTable)
      .where(
        and(
          eq(schema.labelTable.id, id),
          eq(schema.labelTable.projectId, projectId),
        ),
      )
      .for("update")
      .limit(1);
    if (!label) return undefined;
    return {
      id: label.id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      organisationId: project.organisationId,
      name: label.name,
      summary: {
        labelId: label.id,
        name: label.name,
        color: label.color,
        projectId: project.id,
        projectName: project.name,
      },
      version: registeredDeletionFingerprint(label),
    };
  },
  execute: async (tx, { loaded, identity, input }) => {
    const changes = await clearCatalogueLabel(
      tx,
      loaded.workspaceId,
      loaded.id,
      input.userId,
      identity,
    );
    const deleted = await deleteProjectLabel(
      identity,
      loaded.projectId ?? "",
      loaded.id,
      tx,
    );
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    return { afterCommit: () => publishCatalogueLabelChanges(changes) };
  },
};
