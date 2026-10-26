import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { recordLegacyTaskCompatibilityEvent } from "../../events/legacy-task-compatibility";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import {
  findRelationBetween,
  findTaskInWorkspace,
  insertTaskRelation,
  listProjectWorkspaces,
  lockProjectsAndAssertLive,
  lockTaskAndAssertProjectLive,
  lockTasksInStableOrder,
} from "../repository";

async function createTaskRelation(input: {
  identity: ResolvedIdentity;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
  userId: string;
  apiKeyId?: string | null;
  workspaceId: string;
  canReachTarget: (task: {
    id: string;
    projectId: string;
    workspaceId: string;
  }) => Promise<boolean>;
}) {
  const {
    identity,
    sourceTaskId,
    targetTaskId,
    relationType,
    userId,
    apiKeyId,
    workspaceId,
    canReachTarget,
  } = input;
  if (targetTaskId.includes("\u0000")) {
    await db.transaction(async (tx) => {
      await lockTaskAndAssertProjectLive(tx, identity, sourceTaskId);
      rejectNulByte(targetTaskId, "Task id");
    });
  }
  const sourceTask = await findTaskInWorkspace(
    identity,
    sourceTaskId,
    workspaceId,
  );
  if (!sourceTask)
    throw new HTTPException(404, { message: "Source task not found" });

  // Target probing remains a preflight; the source freeze check still precedes its error.
  const foundTargetTask = await findTaskInWorkspace(
    identity,
    targetTaskId,
    workspaceId,
  );
  const targetTask =
    foundTargetTask && (await canReachTarget(foundTargetTask))
      ? foundTargetTask
      : undefined;
  const { relation, sourceProjectId } = await db.transaction(async (tx) => {
    if (!targetTask) {
      await lockTaskAndAssertProjectLive(tx, identity, sourceTaskId);
      throw new HTTPException(404, { message: "Target task not found" });
    }
    const tasks = await lockTasksInStableOrder(tx, identity, [
      sourceTaskId,
      targetTaskId,
    ]);
    const source = tasks.find((task) => task.id === sourceTaskId);
    const target = tasks.find((task) => task.id === targetTaskId);
    if (!source || !target)
      throw new HTTPException(404, { message: "Task not found" });
    if (sourceTaskId === targetTaskId) {
      await lockProjectsAndAssertLive(tx, identity, [source.projectId]);
      throw new HTTPException(400, {
        message: "Cannot create a relation between a task and itself",
      });
    }
    const projects = await lockProjectsAndAssertLive(tx, identity, [
      source.projectId,
      target.projectId,
    ]);
    const scopedProjects = await listProjectWorkspaces(tx, identity, [
      source.projectId,
      target.projectId,
    ]);
    const sourceProject = scopedProjects.find(
      (project) => project.id === source.projectId,
    );
    const targetProject = scopedProjects.find(
      (project) => project.id === target.projectId,
    );
    if (
      !sourceProject ||
      !targetProject ||
      sourceProject.workspaceId !== workspaceId ||
      targetProject.workspaceId !== workspaceId ||
      projects.length !== new Set([source.projectId, target.projectId]).size
    ) {
      throw new HTTPException(404, { message: "Task not found" });
    }
    const existing = await findRelationBetween(
      tx,
      identity,
      sourceTaskId,
      targetTaskId,
      relationType,
    );
    if (existing.length > 0)
      throw new HTTPException(409, { message: "This relation already exists" });
    const relation = await insertTaskRelation(tx, identity, {
      sourceTaskId,
      targetTaskId,
      relationType,
      workspaceId,
    });
    if (!relation) throw new HTTPException(404, { message: "Task not found" });
    await recordLegacyTaskCompatibilityEvent(tx, {
      kind: "task-relation.created",
      taskId: sourceTaskId,
      projectId: source.projectId,
      workspaceId,
      identity,
      apiKeyId,
      payload: {
        relationId: relation.id,
        sourceTaskId,
        targetTaskId,
        relationType,
        type: "created",
      },
    });
    return { relation, sourceProjectId: source.projectId };
  });

  await publishEvent("task-relation.created", {
    ...relation,
    taskId: sourceTaskId,
    projectId: sourceProjectId,
    userId,
  });
  return relation;
}

export default createTaskRelation;
