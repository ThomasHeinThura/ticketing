import { and, eq, inArray, or } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  projectTable,
  taskRelationTable,
  taskTable,
  userTable,
} from "../database/schema";

/**
 * Query ownership for `task_relation` (issue #580). Statements that run inside the
 * create/delete transactions take the handle as their first parameter (`Executor`); the
 * others use the shared connection. Every function awaits and returns rows. Workspace
 * scoping stays in the statement: task lookups join the project and filter on its workspace.
 */

/** A task's workspace, project and id for reach checks, or `undefined`. */
export async function findTaskReachRow(taskId: string) {
  const [task] = await db
    .select({
      workspaceId: projectTable.workspaceId,
      projectId: taskTable.projectId,
      taskId: taskTable.id,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);
  return task;
}

/** A relation's two task ids, or `undefined`. */
export async function findRelationEndpoints(id: string) {
  const [rel] = await db
    .select({
      sourceTaskId: taskRelationTable.sourceTaskId,
      targetTaskId: taskRelationTable.targetTaskId,
    })
    .from(taskRelationTable)
    .where(eq(taskRelationTable.id, id))
    .limit(1);
  return rel;
}

/** The task when its project lives in `workspaceId`, else `undefined`. */
export async function findTaskInWorkspace(taskId: string, workspaceId: string) {
  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(eq(taskTable.id, taskId), eq(projectTable.workspaceId, workspaceId)),
    )
    .limit(1);
  return task;
}

export async function listProjectWorkspaces(
  executor: Executor,
  projectIds: string[],
) {
  return executor
    .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(inArray(projectTable.id, projectIds));
}

/** An existing relation of this type between the two tasks, in either direction. */
export async function findRelationBetween(
  executor: Executor,
  sourceTaskId: string,
  targetTaskId: string,
  relationType: string,
) {
  return executor
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
}

export async function insertTaskRelation(
  executor: Executor,
  values: { sourceTaskId: string; targetTaskId: string; relationType: string },
) {
  const [relation] = await executor
    .insert(taskRelationTable)
    .values(values)
    .returning();
  return relation;
}

export async function deleteTaskRelationById(executor: Executor, id: string) {
  const [relation] = await executor
    .delete(taskRelationTable)
    .where(eq(taskRelationTable.id, id))
    .returning();
  return relation;
}

/** Relations in which the task is either end. */
export async function listRelationsOfTask(taskId: string) {
  return db
    .select({
      id: taskRelationTable.id,
      sourceTaskId: taskRelationTable.sourceTaskId,
      targetTaskId: taskRelationTable.targetTaskId,
      relationType: taskRelationTable.relationType,
      createdAt: taskRelationTable.createdAt,
    })
    .from(taskRelationTable)
    .where(
      or(
        eq(taskRelationTable.sourceTaskId, taskId),
        eq(taskRelationTable.targetTaskId, taskId),
      ),
    );
}

/** Summary rows for the given tasks that live in `workspaceId`. */
export async function listTaskSummariesInWorkspace(
  taskIds: string[],
  workspaceId: string,
) {
  return db
    .select({
      id: taskTable.id,
      version: taskTable.version,
      title: taskTable.title,
      status: taskTable.status,
      priority: taskTable.priority,
      number: taskTable.number,
      projectId: taskTable.projectId,
      userId: taskTable.userId,
      assigneeName: userTable.name,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(
      and(
        inArray(taskTable.id, taskIds),
        eq(projectTable.workspaceId, workspaceId),
      ),
    );
}
