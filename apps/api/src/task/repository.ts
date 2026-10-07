import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  max,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type db from "../database";
import {
  assetTable,
  columnTable,
  externalLinkTable,
  labelTable,
  projectTable,
  taskRelationTable,
  taskTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function lockLegacyTaskRowQuery(
  executor: Executor,
  taskId: string,
) {
  return executor
    .select()
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .for("update");
}

export async function lockProjectForTaskNumberQuery(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
      ),
    )
    .for("update");
}

export async function listTaskStatusColumns(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select({ slug: columnTable.slug })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));
}

export async function getTaskByIdQuery(executor: Executor, taskId: string) {
  return executor
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      position: taskTable.position,
      createdAt: taskTable.createdAt,
      version: taskTable.version,
      userId: taskTable.userId,
      assigneeName: userTable.name,
      assigneeId: userTable.id,
      projectId: taskTable.projectId,
    })
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);
}

export async function listTaskRelationsForTask(
  executor: Executor,
  taskId: string,
) {
  return executor
    .select()
    .from(taskRelationTable)
    .where(
      or(
        eq(taskRelationTable.sourceTaskId, taskId),
        eq(taskRelationTable.targetTaskId, taskId),
      ),
    )
    .execute();
}

export async function getProjectByIdQuery(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select()
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
}

export async function findWorkspaceMemberQuery(
  executor: Executor,
  userId: string,
  workspaceId: string,
) {
  return executor
    .select({ id: workspaceUserTable.id })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.userId, userId),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
}

export async function listScopedTaskIdsQuery(
  executor: Executor,
  taskIds: string[],
  workspaceId: string,
) {
  return executor
    .select({ id: taskTable.id })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        inArray(taskTable.id, taskIds),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    );
}

export async function getProjectWorkspaceQuery(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
}

export async function findUserNameQuery(executor: Executor, userId: string) {
  return executor
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
}

export async function findCurrentAssigneeNameQuery(
  executor: Executor,
  userId: string,
) {
  return executor
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId));
}

export async function findAssigneeNameQuery(
  executor: Executor,
  userId: string,
) {
  return executor
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
}

export async function findExistingAssigneeQuery(
  executor: Executor,
  taskId: string,
) {
  return executor
    .select({ userId: taskTable.userId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
}

export async function findMaxTaskPositionQuery(
  executor: Executor,
  projectId: string,
  columnId: string | null,
  status: string,
) {
  return executor
    .select({ maxPosition: max(taskTable.position) })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.projectId, projectId),
        columnId
          ? eq(taskTable.columnId, columnId)
          : eq(taskTable.status, status),
      ),
    );
}

export async function findLiveProjectQuery(
  executor: Executor,
  projectId: string,
) {
  return executor.query.projectTable.findFirst({
    where: and(eq(projectTable.id, projectId), isNull(projectTable.deletedAt)),
  });
}

export async function findTaskColumnBySlugQuery(
  executor: Executor,
  projectId: string,
  slug: string,
) {
  return executor.query.columnTable.findFirst({
    where: and(
      eq(columnTable.projectId, projectId),
      eq(columnTable.slug, slug),
    ),
  });
}

export async function findBulkLabelByIdQuery(
  executor: Executor,
  id: string,
  workspaceId: string,
) {
  return executor.query.labelTable.findFirst({
    where: and(
      eq(labelTable.id, id),
      or(
        eq(labelTable.workspaceId, workspaceId),
        isNull(labelTable.workspaceId),
      ),
    ),
  });
}

export async function findTaskLabelByNameQuery(
  executor: Executor,
  name: string,
  taskId: string,
) {
  return executor.query.labelTable.findFirst({
    where: and(eq(labelTable.name, name), eq(labelTable.taskId, taskId)),
  });
}

export async function listExportTasksQuery(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select({
      version: taskTable.version,
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      position: taskTable.position,
      createdAt: taskTable.createdAt,
      userId: taskTable.userId,
      assigneeName: userTable.name,
      assigneeId: userTable.id,
    })
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(eq(taskTable.projectId, projectId))
    .orderBy(taskTable.position);
}

export async function listTaskLabelsForTasksQuery(
  executor: Executor,
  taskIds: string[],
) {
  return executor
    .select({
      id: labelTable.id,
      name: labelTable.name,
      color: labelTable.color,
      taskId: labelTable.taskId,
    })
    .from(labelTable)
    .where(inArray(labelTable.taskId, taskIds));
}

export async function countTasksQuery(
  executor: Executor,
  whereClause: SQL | undefined,
) {
  return executor
    .select({ count: sql<number>`count(*)` })
    .from(taskTable)
    .where(whereClause);
}

export async function listTaskRowsQuery(
  executor: Executor,
  whereClause: SQL | undefined,
  orderByClause: SQL,
  usePagination: boolean,
  pageSize: number,
  offset: number,
) {
  const query = executor
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      position: taskTable.position,
      createdAt: taskTable.createdAt,
      version: taskTable.version,
      userId: taskTable.userId,
      assigneeName: userTable.name,
      assigneeId: userTable.id,
      assigneeImage: userTable.image,
      projectId: taskTable.projectId,
    })
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(whereClause)
    .orderBy(orderByClause);
  return usePagination ? query.limit(pageSize).offset(offset) : query;
}

export async function listTaskExternalLinksQuery(
  executor: Executor,
  taskIds: string[],
) {
  return executor
    .select()
    .from(externalLinkTable)
    .where(inArray(externalLinkTable.taskId, taskIds));
}

export async function listTaskColumnsQuery(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select()
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));
}

export async function listMoveColumnsQuery(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      position: columnTable.position,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));
}

export async function maxMovePositionQuery(
  executor: Executor,
  projectId: string,
  status: string,
  columnId: string,
) {
  return executor
    .select({ maxPosition: max(taskTable.position) })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.projectId, projectId),
        eq(taskTable.status, status),
        eq(taskTable.columnId, columnId),
      ),
    );
}

export async function findMoveSourcePreflightQuery(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      archivedAt: projectTable.archivedAt,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
}

export async function findMoveDestinationPreflightQuery(
  executor: Executor,
  projectId: string,
  workspaceId: string,
) {
  return executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
      ),
    )
    .limit(1);
}

export async function lockMoveProjectLivenessQuery(
  executor: Executor,
  projectId: string,
  isDestination: boolean,
  workspaceId: string,
) {
  return executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        ...(isDestination ? [eq(projectTable.workspaceId, workspaceId)] : []),
      ),
    )
    .for(isDestination ? "update" : "share");
}

export async function findMoveSourceProjectQuery(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select({
      id: projectTable.id,
      name: projectTable.name,
      workspaceId: projectTable.workspaceId,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
}

export async function findMoveDestinationProjectQuery(
  executor: Executor,
  projectId: string,
  workspaceId: string,
) {
  return executor
    .select({ id: projectTable.id, name: projectTable.name })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
}

export async function findTaskAssetContextQuery(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select({ workspaceId: workspaceTable.id })
    .from(projectTable)
    .innerJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(eq(projectTable.id, projectId));
}

export async function findTaskAssetByObjectKeyQuery(
  executor: Executor,
  objectKey: string,
) {
  return executor
    .select({ id: assetTable.id })
    .from(assetTable)
    .where(eq(assetTable.objectKey, objectKey))
    .limit(1);
}
