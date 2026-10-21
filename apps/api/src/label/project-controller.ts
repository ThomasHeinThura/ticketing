import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { isUniqueViolation } from "../utils/is-unique-violation";
import { assertProjectStillLive } from "../work-item/assert-work-item-live";
import {
  clearCatalogueLabel,
  publishCatalogueLabelChanges,
} from "../work-item/clear-catalogue-label";
import {
  deleteProjectLabel,
  findLabelProject,
  insertProjectLabel,
  listProjectLabels,
  lockProjectLabel,
  updateProjectLabel,
} from "./project-repository";
import { lockWorkspaceLabelNames } from "./repository";

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
) {
  const project = await requireProject(identity, projectId);
  return db.transaction(async (tx) => {
    // Use the same catalogue-before-item lock order as assignment and deletion.
    await lockWorkspaceLabelNames(tx, project.workspaceId, [values.name]);
    await assertProjectStillLive(tx, projectId, "Project not found");
    const label = await insertProjectLabel(
      identity,
      projectId,
      values.name,
      values.color,
      tx,
    );
    if (!label) throw new HTTPException(404, { message: "Project not found" });
    return label;
  });
}

export async function editProjectCatalogueLabel(
  identity: ResolvedIdentity,
  projectId: string,
  id: string,
  values: { name: string; color: string },
) {
  const project = await requireProject(identity, projectId);
  try {
    return await db.transaction(async (tx) => {
      await lockWorkspaceLabelNames(tx, project.workspaceId, [values.name]);
      await assertProjectStillLive(tx, projectId, "Project not found");
      if (!(await lockProjectLabel(identity, projectId, id, tx)))
        throw new HTTPException(404, { message: "Label not found" });
      const label = await updateProjectLabel(
        identity,
        projectId,
        id,
        values,
        tx,
      );
      if (!label) throw new HTTPException(404, { message: "Label not found" });
      return label;
    });
  } catch (error) {
    if (isUniqueViolation(error, "label_project_name_unique"))
      throw new HTTPException(409, {
        message: "A label with this name already exists in this project",
      });
    throw error;
  }
}

export async function removeProjectCatalogueLabel(
  identity: ResolvedIdentity,
  projectId: string,
  id: string,
  actorId: string,
) {
  const project = await requireProject(identity, projectId);
  const result = await db.transaction(async (tx) => {
    await lockWorkspaceLabelNames(tx, project.workspaceId, []);
    await assertProjectStillLive(tx, projectId, "Project not found");
    const label = await lockProjectLabel(identity, projectId, id, tx);
    if (!label) throw new HTTPException(404, { message: "Label not found" });
    const changes = await clearCatalogueLabel(
      tx,
      project.workspaceId,
      id,
      actorId,
      identity,
    );
    const deleted = await deleteProjectLabel(identity, projectId, id, tx);
    if (!deleted) throw new HTTPException(404, { message: "Label not found" });
    return { deleted, changes };
  });
  await publishCatalogueLabelChanges(result.changes);
  return result.deleted;
}
