import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import type { AppendAuditLogInput } from "../audit/audit-writer";
import db from "../database";
import { appendAuditSavepoint } from "../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { isUniqueViolation } from "../utils/is-unique-violation";
import { assertProjectStillLive } from "../work-item/assert-work-item-live";
import {
  findLabelProject,
  insertProjectLabel,
  listProjectLabels,
  lockProjectLabel,
  updateProjectLabel,
} from "./project-repository";
import { lockWorkspaceLabelNames } from "./repository";

type AuditActor = Pick<
  AppendAuditLogInput,
  | "actorId"
  | "actorType"
  | "apiKeyId"
  | "impersonatorId"
  | "actorIp"
  | "userAgent"
  | "traceId"
>;

async function requireProject(identity: ResolvedIdentity, projectId: string) {
  const project = await findLabelProject(identity, projectId);
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  return project;
}

export async function getProjectLabelCatalogue(
  identity: ResolvedIdentity,
  projectId: string,
) {
  await requireProject(identity, projectId);
  return listProjectLabels(identity, projectId);
}

export async function createProjectCatalogueLabel(
  identity: ResolvedIdentity,
  projectId: string,
  values: { name: string; color: string },
  actor: AuditActor,
) {
  const project = await requireProject(identity, projectId);
  const result = await db.transaction(async (tx) => {
    // Use the same catalogue-before-item lock order as assignment and deletion.
    await lockWorkspaceLabelNames(tx, project.workspaceId, [values.name]);
    await assertProjectStillLive(tx, projectId, "Project not found");
    const result = await insertProjectLabel(
      identity,
      projectId,
      values.name,
      values.color,
      tx,
    );
    if (!result) throw new HTTPException(404, { message: "Project not found" });
    const auditFailed = result.inserted
      ? await appendAuditSavepoint(tx, {
          ...actor,
          workspaceId: project.workspaceId,
          projectId,
          action: "label.catalogue_created",
          entityType: "label",
          entityId: result.label.id,
          after: { changedFields: ["name", "color"] },
        })
      : false;
    return { label: result.label, auditFailed };
  });
  if (result.auditFailed)
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return result.label;
}

export async function editProjectCatalogueLabel(
  identity: ResolvedIdentity,
  projectId: string,
  id: string,
  values: { name: string; color: string },
  actor: AuditActor,
) {
  const project = await requireProject(identity, projectId);
  try {
    const result = await db.transaction(async (tx) => {
      await lockWorkspaceLabelNames(tx, project.workspaceId, [values.name]);
      await assertProjectStillLive(tx, projectId, "Project not found");
      const before = await lockProjectLabel(identity, projectId, id, tx);
      if (!before) throw new HTTPException(404, { message: "Label not found" });
      const changedFields = [
        ...(before.name === values.name ? [] : ["name"]),
        ...(before.color === values.color ? [] : ["color"]),
      ];
      if (!changedFields.length) return { label: before, auditFailed: false };
      const label = await updateProjectLabel(
        identity,
        projectId,
        id,
        values,
        tx,
      );
      if (!label) throw new HTTPException(404, { message: "Label not found" });
      const auditFailed = await appendAuditSavepoint(tx, {
        ...actor,
        workspaceId: project.workspaceId,
        projectId,
        action: "label.catalogue_updated",
        entityType: "label",
        entityId: id,
        after: { changedFields },
      });
      return { label, auditFailed };
    });
    if (result.auditFailed)
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    return result.label;
  } catch (error) {
    if (isUniqueViolation(error, "label_project_name_unique"))
      throw new HTTPException(409, {
        message: "A label with this name already exists in this project",
      });
    throw error;
  }
}
