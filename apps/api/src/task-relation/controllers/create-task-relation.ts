import { and, eq, inArray, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  taskRelationTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import {
  lockLegacyTaskRow,
  lockProjectsAndAssertLive,
  lockTaskAndAssertProjectLive,
} from "../../task/assert-task-project-live";
import { rejectNulByte } from "../../utils/reject-nul-byte";

async function createTaskRelation({
  sourceTaskId,
  targetTaskId,
  relationType,
  userId,
  workspaceId,
}: {
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
  userId: string;
  workspaceId: string;
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

  const [sourceTask] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, sourceTaskId),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!sourceTask) {
    throw new HTTPException(404, { message: "Source task not found" });
  }

  const [targetTask] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, targetTaskId),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!targetTask) {
    throw new HTTPException(404, { message: "Target task not found" });
  }

  const { relation, sourceProjectId } = await db.transaction(async (tx) => {
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
    const lockedProjects = await tx
      .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
      .from(projectTable)
      .where(
        inArray(projectTable.id, [
          lockedSourceTask.projectId,
          lockedTargetTask.projectId,
        ]),
      );
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
    const existing = await tx
      .select({ id: taskRelationTable.id })
      .from(taskRelationTable)
      .where(
        and(
          eq(taskRelationTable.relationType, relationType),
          or(
            and(
              eq(taskRelationTable.sourceTaskId, sourceTaskId),
              eq(taskRelationTable.targetTaskId, targetTaskId),
            ),
            and(
              eq(taskRelationTable.sourceTaskId, targetTaskId),
              eq(taskRelationTable.targetTaskId, sourceTaskId),
            ),
          ),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new HTTPException(409, {
        message: "This relation already exists",
      });
    }
    const [relation] = await tx
      .insert(taskRelationTable)
      .values({ sourceTaskId, targetTaskId, relationType })
      .returning();
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
