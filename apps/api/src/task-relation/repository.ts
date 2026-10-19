import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  or,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import {
  projectTable,
  taskRelationTable,
  taskTable,
  userTable,
} from "../database/schema";

function currentTaskReach(
  identity: ResolvedIdentity,
  taskId: string | SQLWrapper,
  executor: Executor,
) {
  const taskIdPredicate =
    typeof taskId === "string"
      ? eq(taskTable.id, taskId)
      : eq(taskTable.id, taskId);
  return exists(
    executor
      .select({ one: sql`1` })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          taskIdPredicate,
          currentProjectReachPredicate(
            identity,
            projectTable.id,
            projectTable.workspaceId,
            projectTable.organisationId,
            executor,
          ),
        ),
      ),
  );
}

export async function findTaskReachRow(
  identity: ResolvedIdentity,
  taskId: string,
) {
  const [task] = await db
    .select({
      workspaceId: projectTable.workspaceId,
      projectId: taskTable.projectId,
      taskId: taskTable.id,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          db,
        ),
      ),
    )
    .limit(1);
  return task;
}

function relationEndpointReach(
  identity: ResolvedIdentity,
  endpoint: SQLWrapper,
  relationId: SQLWrapper,
  direction: "source" | "target",
  executor: Executor,
) {
  const relation = alias(taskRelationTable, `relation_${direction}_row`);
  const task = alias(taskTable, `relation_${direction}_task`);
  const project = alias(projectTable, `relation_${direction}_project`);
  const relationTaskId =
    direction === "source" ? relation.sourceTaskId : relation.targetTaskId;
  return exists(
    executor
      .select({ one: sql`1` })
      .from(relation)
      .innerJoin(task, eq(task.id, relationTaskId))
      .innerJoin(project, eq(task.projectId, project.id))
      .where(
        and(
          eq(relation.id, relationId),
          eq(task.id, endpoint),
          currentProjectReachPredicate(
            identity,
            project.id,
            project.workspaceId,
            project.organisationId,
            executor,
          ),
        ),
      ),
  );
}

export async function findRelationEndpoints(
  identity: ResolvedIdentity,
  id: string,
) {
  const [rel] = await db
    .select({
      sourceTaskId: taskRelationTable.sourceTaskId,
      targetTaskId: taskRelationTable.targetTaskId,
    })
    .from(taskRelationTable)
    .where(
      and(
        eq(taskRelationTable.id, id),
        relationEndpointReach(
          identity,
          taskRelationTable.sourceTaskId,
          taskRelationTable.id,
          "source",
          db,
        ),
        relationEndpointReach(
          identity,
          taskRelationTable.targetTaskId,
          taskRelationTable.id,
          "target",
          db,
        ),
      ),
    )
    .limit(1);
  return rel;
}

export async function findTaskInWorkspace(
  identity: ResolvedIdentity,
  taskId: string,
  workspaceId: string,
) {
  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        eq(projectTable.workspaceId, workspaceId),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          db,
        ),
      ),
    )
    .limit(1);
  return task;
}

export async function lockTaskAndAssertProjectLive(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
) {
  const [task] = await executor
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      userId: taskTable.userId,
      title: taskTable.title,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    )
    .for("update", { of: taskTable });
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  await lockProjectsAndAssertLive(executor, identity, [task.projectId]);
  return task;
}

export async function lockTasksInStableOrder(
  executor: Executor,
  identity: ResolvedIdentity,
  taskIds: readonly string[],
) {
  const tasks = [];
  for (const id of [...new Set(taskIds)].sort()) {
    const [task] = await executor
      .select({
        id: taskTable.id,
        projectId: taskTable.projectId,
        userId: taskTable.userId,
        title: taskTable.title,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          eq(taskTable.id, id),
          currentProjectReachPredicate(
            identity,
            projectTable.id,
            projectTable.workspaceId,
            projectTable.organisationId,
            executor,
          ),
        ),
      )
      .for("update", { of: taskTable });
    if (!task) throw new HTTPException(404, { message: "Task not found" });
    tasks.push(task);
  }
  return tasks;
}

export async function lockProjectsAndAssertLive(
  executor: Executor,
  identity: ResolvedIdentity,
  projectIds: readonly string[],
) {
  const projects = [];
  for (const id of [...new Set(projectIds)].sort()) {
    const [project] = await executor
      .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, id),
          isNull(projectTable.deletedAt),
          isNull(projectTable.archivedAt),
          currentProjectReachPredicate(
            identity,
            projectTable.id,
            projectTable.workspaceId,
            projectTable.organisationId,
            executor,
          ),
        ),
      )
      .for("share");
    if (!project) throw new HTTPException(404, { message: "Task not found" });
    projects.push(project);
  }
  return projects;
}

export async function listProjectWorkspaces(
  executor: Executor,
  identity: ResolvedIdentity,
  projectIds: string[],
) {
  return executor
    .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(
      and(
        inArray(projectTable.id, projectIds),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
}

export async function findRelationBetween(
  executor: Executor,
  identity: ResolvedIdentity,
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
        relationEndpointReach(
          identity,
          taskRelationTable.sourceTaskId,
          taskRelationTable.id,
          "source",
          executor,
        ),
        relationEndpointReach(
          identity,
          taskRelationTable.targetTaskId,
          taskRelationTable.id,
          "target",
          executor,
        ),
      ),
    )
    .limit(1);
}

export async function insertTaskRelation(
  executor: Executor,
  identity: ResolvedIdentity,
  values: {
    sourceTaskId: string;
    targetTaskId: string;
    relationType: string;
    workspaceId: string;
  },
) {
  const sourceTask = alias(taskTable, "relation_insert_source_task");
  const sourceProject = alias(projectTable, "relation_insert_source_project");
  const targetTask = alias(taskTable, "relation_insert_target_task");
  const targetProject = alias(projectTable, "relation_insert_target_project");
  const select = executor
    .select({
      id: sql`${sql.param(createId(), taskRelationTable.id)}`.as("id"),
      sourceTaskId: sourceTask.id,
      targetTaskId: targetTask.id,
      relationType:
        sql`${sql.param(values.relationType, taskRelationTable.relationType)}`.as(
          "relationType",
        ),
      createdAt: sql`now()`.as("createdAt"),
    })
    .from(sourceTask)
    .innerJoin(sourceProject, eq(sourceTask.projectId, sourceProject.id))
    .innerJoin(targetTask, eq(targetTask.id, values.targetTaskId))
    .innerJoin(targetProject, eq(targetTask.projectId, targetProject.id))
    .where(
      and(
        eq(sourceTask.id, values.sourceTaskId),
        eq(sourceProject.workspaceId, values.workspaceId),
        eq(targetProject.workspaceId, values.workspaceId),
        isNull(sourceProject.deletedAt),
        isNull(sourceProject.archivedAt),
        isNull(targetProject.deletedAt),
        isNull(targetProject.archivedAt),
        currentProjectReachPredicate(
          identity,
          sourceProject.id,
          sourceProject.workspaceId,
          sourceProject.organisationId,
          executor,
        ),
        currentProjectReachPredicate(
          identity,
          targetProject.id,
          targetProject.workspaceId,
          targetProject.organisationId,
          executor,
        ),
      ),
    );
  const [relation] = await executor
    .insert(taskRelationTable)
    .select(select)
    .returning();
  return relation;
}

export async function deleteTaskRelationById(
  executor: Executor,
  identity: ResolvedIdentity,
  id: string,
) {
  const [relation] = await executor
    .delete(taskRelationTable)
    .where(
      and(
        eq(taskRelationTable.id, id),
        relationEndpointReach(
          identity,
          taskRelationTable.sourceTaskId,
          taskRelationTable.id,
          "source",
          executor,
        ),
        relationEndpointReach(
          identity,
          taskRelationTable.targetTaskId,
          taskRelationTable.id,
          "target",
          executor,
        ),
      ),
    )
    .returning();
  return relation;
}

export async function listRelationsOfTask(
  identity: ResolvedIdentity,
  taskId: string,
  executor: Executor = db,
) {
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
      and(
        or(
          eq(taskRelationTable.sourceTaskId, taskId),
          eq(taskRelationTable.targetTaskId, taskId),
        ),
        currentTaskReach(identity, taskId, executor),
        relationEndpointReach(
          identity,
          taskRelationTable.sourceTaskId,
          taskRelationTable.id,
          "source",
          executor,
        ),
        relationEndpointReach(
          identity,
          taskRelationTable.targetTaskId,
          taskRelationTable.id,
          "target",
          executor,
        ),
      ),
    );
}

export async function listTaskSummariesInWorkspace(
  identity: ResolvedIdentity,
  taskIds: string[],
  workspaceId: string,
  executor: Executor = db,
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
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
}
