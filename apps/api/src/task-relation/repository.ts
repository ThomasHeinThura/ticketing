import { and, eq, inArray, or } from "drizzle-orm";
import type db from "../database";
import {
  projectTable,
  taskRelationTable,
  taskTable,
  userTable,
} from "../database/schema";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function findSourceTask(
  executor: Executor,
  taskId: string,
  workspaceId: string,
) {
  return executor
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
}

export async function findTaskInWorkspace(
  executor: Executor,
  taskId: string,
  workspaceId: string,
) {
  return executor
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
}

export async function findProjects(executor: Executor, projectIds: string[]) {
  return executor
    .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(inArray(projectTable.id, projectIds));
}

export async function findExistingRelation(
  executor: Executor,
  relationType: string,
  sourceTaskId: string,
  targetTaskId: string,
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

export async function findRelationEndpoints(executor: Executor, id: string) {
  return executor
    .select({
      sourceTaskId: taskRelationTable.sourceTaskId,
      targetTaskId: taskRelationTable.targetTaskId,
    })
    .from(taskRelationTable)
    .where(eq(taskRelationTable.id, id))
    .limit(1);
}

export async function listRelationsForTask(executor: Executor, taskId: string) {
  return executor
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

export async function listRelationTasks(
  executor: Executor,
  taskIds: string[],
  workspaceId: string,
) {
  return executor
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

export async function findTaskWorkspace(executor: Executor, taskId: string) {
  return executor
    .select({ workspaceId: projectTable.workspaceId })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);
}

export async function findRelationSource(executor: Executor, id: string) {
  return executor
    .select({ sourceTaskId: taskRelationTable.sourceTaskId })
    .from(taskRelationTable)
    .where(eq(taskRelationTable.id, id))
    .limit(1);
}
