import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import {
  lockLegacyTaskRow,
  lockProjectsAndAssertLive,
  lockTaskAndAssertProjectLive,
} from "../../task/assert-task-project-live";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import {
  findRelationBetween,
  findTaskInWorkspace,
  insertTaskRelation,
  listProjectWorkspaces,
} from "../repository";

async function createTaskRelation({
  sourceTaskId,
  targetTaskId,
  relationType,
  userId,
  workspaceId,
  canReachTarget,
}: {
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
  userId: string;
  workspaceId: string;
  /**
   * Whether the caller reaches the target's project and may update it (`RH`: creating a
   * relation requires update on BOTH ends). An unreachable target is treated exactly like a
   * missing one, so the answer is the same 404 and nothing about it is revealed.
   */
  canReachTarget: (task: {
    id: string;
    projectId: string;
    workspaceId: string;
  }) => Promise<boolean>;
}) {
  // #285's S4 finding: `targetTaskId` reaches the `eq(taskTable.id, targetTaskId)`
  // query below unvalidated -- `sourceTaskId` is already checked by
  // `scopeToSourceTask` (task-relation/index.ts) before this controller runs, but
  // this is the one field that middleware never sees.
  if (targetTaskId.includes("\u0000")) {
    await db.transaction(async (tx) => {
      await lockTaskAndAssertProjectLive(tx, sourceTaskId);
      rejectNulByte(targetTaskId, "Task id");
    });
  }

  const sourceTask = await findTaskInWorkspace(sourceTaskId, workspaceId);

  if (!sourceTask) {
    throw new HTTPException(404, { message: "Source task not found" });
  }

  // Keep target existence as a preflight only. The response must wait until the
  // source project's freeze check so a frozen source cannot reveal target existence.
  const foundTargetTask = await findTaskInWorkspace(targetTaskId, workspaceId);
  const targetTask =
    foundTargetTask && (await canReachTarget(foundTargetTask))
      ? foundTargetTask
      : undefined;

  const { relation, sourceProjectId } = await db.transaction(async (tx) => {
    if (!targetTask) {
      await lockTaskAndAssertProjectLive(tx, sourceTaskId);
      throw new HTTPException(404, { message: "Target task not found" });
    }

    const taskIds = [sourceTaskId, targetTaskId].sort();
    const firstTaskId = taskIds[0];
    const secondTaskId = taskIds[1];
    if (!firstTaskId || !secondTaskId) {
      throw new HTTPException(400, { message: "Invalid task relation" });
    }
    const firstTask = await lockLegacyTaskRow(tx, firstTaskId);
    if (sourceTaskId === targetTaskId) {
      await lockProjectsAndAssertLive(tx, [firstTask.projectId]);
      throw new HTTPException(400, {
        message: "Cannot create a relation between a task and itself",
      });
    }
    const secondTask = await lockLegacyTaskRow(tx, secondTaskId);
    const lockedSourceTask =
      firstTask.id === sourceTaskId ? firstTask : secondTask;
    const lockedTargetTask =
      firstTask.id === targetTaskId ? firstTask : secondTask;
    await lockProjectsAndAssertLive(tx, [
      lockedSourceTask.projectId,
      lockedTargetTask.projectId,
    ]);
    const lockedProjects = await listProjectWorkspaces(tx, [
      lockedSourceTask.projectId,
      lockedTargetTask.projectId,
    ]);
    const sourceProject = lockedProjects.find(
      (project) => project.id === lockedSourceTask.projectId,
    );
    const targetProject = lockedProjects.find(
      (project) => project.id === lockedTargetTask.projectId,
    );
    if (
      !sourceProject ||
      !targetProject ||
      sourceProject.workspaceId !== workspaceId ||
      targetProject.workspaceId !== workspaceId
    ) {
      throw new HTTPException(404, { message: "Task not found" });
    }
    const existing = await findRelationBetween(
      tx,
      sourceTaskId,
      targetTaskId,
      relationType,
    );
    if (existing.length > 0) {
      throw new HTTPException(409, {
        message: "This relation already exists",
      });
    }
    const relation = await insertTaskRelation(tx, {
      sourceTaskId,
      targetTaskId,
      relationType,
    });
    return { relation, sourceProjectId: lockedSourceTask.projectId };
  });

  if (!relation) {
    throw new HTTPException(500, {
      message: "Failed to create task relation",
    });
  }

  await publishEvent("task-relation.created", {
    ...relation,
    taskId: sourceTaskId,
    projectId: sourceProjectId,
    userId,
  });

  return relation;
}

export default createTaskRelation;
