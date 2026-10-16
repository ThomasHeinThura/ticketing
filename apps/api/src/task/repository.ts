import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  ne,
  not,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Executor, executorOrDefault } from "../database/executor";
import {
  currentProjectReachPredicate,
  currentWorkspaceReachPredicate,
} from "../database/repositories/identity-scope.repository";
import {
  assetTable,
  columnTable,
  externalLinkTable,
  labelTable,
  projectTable,
  taskActivityTable,
  taskRelationTable,
  taskReminderSentTable,
  taskTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";

/** Current persisted reach for the addressed outer project row. */
function currentProjectRowReach(
  identity: ResolvedIdentity,
  executor: Executor,
) {
  return currentProjectReachPredicate(
    identity,
    projectTable.id,
    projectTable.workspaceId,
    projectTable.organisationId,
    executor,
  );
}

/** Current persisted task-project reach correlated to the supplied task row. */
function taskProjectReachFor(
  identity: ResolvedIdentity,
  taskProjectId: SQLWrapper,
  executor: Executor,
) {
  return exists(
    executor
      .select({ one: sql`1` })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, taskProjectId),
          isNull(projectTable.deletedAt),
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

/** Current persisted task-project reach, correlated to an outer task row. */
function taskProjectReach(identity: ResolvedIdentity, executor: Executor) {
  return taskProjectReachFor(identity, taskTable.projectId, executor);
}

/**
 * A task move must be authorized at the write statement for both its current source
 * project and its requested destination, which must remain in the same live workspace.
 */
function taskProjectMoveReach(
  identity: ResolvedIdentity,
  sourceProjectId: SQLWrapper,
  destinationProjectId: string,
  executor: Executor,
) {
  const sourceProject = alias(projectTable, "task_move_source_project");
  const destinationProject = alias(
    projectTable,
    "task_move_destination_project",
  );

  return exists(
    executor
      .select({ one: sql`1` })
      .from(sourceProject)
      .innerJoin(
        destinationProject,
        eq(destinationProject.workspaceId, sourceProject.workspaceId),
      )
      .where(
        and(
          eq(sourceProject.id, sourceProjectId),
          eq(destinationProject.id, destinationProjectId),
          isNull(sourceProject.deletedAt),
          isNull(sourceProject.archivedAt),
          isNull(destinationProject.deletedAt),
          isNull(destinationProject.archivedAt),
          currentProjectReachPredicate(
            identity,
            sourceProject.id,
            sourceProject.workspaceId,
            sourceProject.organisationId,
            executor,
          ),
          currentProjectReachPredicate(
            identity,
            destinationProject.id,
            destinationProject.workspaceId,
            destinationProject.organisationId,
            executor,
          ),
        ),
      ),
  );
}

function projectReach(
  identity: ResolvedIdentity,
  projectId: string,
  executor: Executor,
) {
  return exists(
    executor
      .select({ one: sql`1` })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, projectId),
          isNull(projectTable.deletedAt),
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

/**
 * Legacy task repository (issue #580, batch 9a). Every statement of the small task controllers
 * lives here, moved verbatim. The controllers keep their transactions, lock order (task row
 * first, then project liveness), version bump semantics, events and error mapping.
 */

// ---- row locks -------------------------------------------------------------------------

export async function lockTaskRowForIdentity(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
) {
  const [task] = await executor
    .select()
    .from(taskTable)
    .where(and(eq(taskTable.id, taskId), taskProjectReach(identity, executor)))
    .for("update");
  return task;
}

/**
 * Exclusive row lock on a live (not deleted, not archived) project, taken before
 * `claimTaskNumber` so concurrent creators serialize instead of upgrading `FOR SHARE` locks.
 */
export async function lockLiveProjectRow(
  executor: Executor,
  projectId: string,
) {
  const [project] = await executor
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
  return project;
}

export async function lockLiveProjectRowForIdentity(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
) {
  const [project] = await executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
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
    .for("update");
  return project;
}

export async function advanceProjectTaskNumberForIdentity(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
  count: number,
) {
  const [updated] = await executor
    .update(projectTable)
    .set({ lastTaskNumber: sql`${projectTable.lastTaskNumber} + ${count}` })
    .where(
      and(
        eq(projectTable.id, projectId),
        isNull(projectTable.deletedAt),
        currentProjectRowReach(identity, executor),
      ),
    )
    .returning({ lastTaskNumber: projectTable.lastTaskNumber });
  return updated;
}

// ---- reads -----------------------------------------------------------------------------

export async function listColumnSlugsForIdentity(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
) {
  return await executor
    .select({ slug: columnTable.slug })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, projectId),
        projectReach(identity, projectId, executor),
      ),
    )
    .orderBy(asc(columnTable.position));
}

export async function findColumnBySlugForIdentity(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
  slug: string,
) {
  const [column] = await executor
    .select()
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, projectId),
        eq(columnTable.slug, slug),
        projectReach(identity, projectId, executor),
      ),
    )
    .limit(1);
  return column;
}

export async function listProjectColumns(
  identity: ResolvedIdentity,
  projectId: string,
) {
  const executor = executorOrDefault();
  return await executor
    .select()
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, projectId),
        projectReach(identity, projectId, executor),
      ),
    )
    .orderBy(asc(columnTable.position));
}

/** A project that is not soft-deleted (#187), or undefined. */
export async function findLiveProject(
  identity: ResolvedIdentity,
  projectId: string,
) {
  const executor = executorOrDefault();
  const [project] = await executor
    .select()
    .from(projectTable)
    .where(
      // #187: a soft-deleted project is treated as gone everywhere in ordinary use,
      // matching `get-project.ts`'s convention.
      and(
        eq(projectTable.id, projectId),
        isNull(projectTable.deletedAt),
        currentProjectRowReach(identity, executor),
      ),
    )
    .limit(1);
  return project;
}

export async function findProjectWorkspaceId(
  executor: Executor,
  projectId: string,
) {
  const [project] = await executor
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId));
  return project;
}

/** The workspace that owns a project (joined through the workspace row), for asset contexts. */
export async function findProjectWorkspaceContext(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
) {
  const [context] = await executor
    .select({ workspaceId: workspaceTable.id })
    .from(projectTable)
    .innerJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(
      and(
        eq(projectTable.id, projectId),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
  return context;
}

export async function findTaskWithAssignee(
  identity: ResolvedIdentity,
  taskId: string,
) {
  const executor = executorOrDefault();
  const task = await executor
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
    .where(and(eq(taskTable.id, taskId), taskProjectReach(identity, executor)))
    .limit(1);
  return task[0];
}

export async function findTaskAssigneeId(
  identity: ResolvedIdentity,
  taskId: string,
) {
  const executor = executorOrDefault();
  const [existingTask] = await executor
    .select({ userId: taskTable.userId })
    .from(taskTable)
    .where(and(eq(taskTable.id, taskId), taskProjectReach(identity, executor)))
    .limit(1);
  return existingTask;
}

export async function findUserName(
  identity: ResolvedIdentity,
  userId: string,
  projectId: string,
  executor?: Executor,
) {
  const tx = executorOrDefault(executor);
  const [user] = await tx
    .select({ name: userTable.name })
    .from(userTable)
    .where(
      and(
        eq(userTable.id, userId),
        exists(
          tx
            .select({ one: sql`1` })
            .from(projectTable)
            .innerJoin(
              workspaceUserTable,
              eq(workspaceUserTable.workspaceId, projectTable.workspaceId),
            )
            .where(
              and(
                eq(projectTable.id, projectId),
                eq(workspaceUserTable.userId, userId),
                currentProjectReachPredicate(
                  identity,
                  projectTable.id,
                  projectTable.workspaceId,
                  projectTable.organisationId,
                  tx,
                ),
              ),
            ),
        ),
      ),
    )
    .limit(1);
  return user;
}

export type TaskListFilters = {
  status?: string;
  priority?: string;
  assigneeId?: string;
  dueBefore?: string;
  dueAfter?: string;
};

export type TaskListSort =
  | "createdAt"
  | "priority"
  | "dueDate"
  | "position"
  | "title"
  | "number";

const priorityCaseExpr = sql<number>`CASE
  WHEN ${taskTable.priority} = 'urgent' THEN 4
  WHEN ${taskTable.priority} = 'high' THEN 3
  WHEN ${taskTable.priority} = 'medium' THEN 2
  WHEN ${taskTable.priority} = 'low' THEN 1
  ELSE 0
END`;

function buildOrderBy(
  sortBy: TaskListSort | undefined,
  sortOrder: "asc" | "desc" | undefined,
): SQL {
  const direction = sortOrder === "desc" ? desc : asc;

  switch (sortBy) {
    case "createdAt":
      return direction(taskTable.createdAt);
    case "priority":
      return direction(priorityCaseExpr);
    case "dueDate":
      return direction(taskTable.dueDate);
    case "title":
      return direction(taskTable.title);
    case "number":
      return direction(taskTable.number);
    default:
      return direction(taskTable.position);
  }
}

function taskListWhere(
  identity: ResolvedIdentity,
  projectId: string,
  filters: TaskListFilters,
  executor: Executor,
) {
  const conditions = [eq(taskTable.projectId, projectId)];

  if (filters.status) {
    conditions.push(eq(taskTable.status, filters.status));
  }

  if (filters.priority) {
    conditions.push(eq(taskTable.priority, filters.priority));
  }

  if (filters.assigneeId) {
    conditions.push(eq(taskTable.userId, filters.assigneeId));
  }

  if (filters.dueBefore) {
    conditions.push(lte(taskTable.dueDate, new Date(filters.dueBefore)));
  }

  if (filters.dueAfter) {
    conditions.push(gte(taskTable.dueDate, new Date(filters.dueAfter)));
  }

  return and(...conditions, projectReach(identity, projectId, executor));
}

/** Count of a project's tasks matching the filters; the project predicate is in the statement. */
export async function countProjectTasks(
  identity: ResolvedIdentity,
  projectId: string,
  filters: TaskListFilters,
) {
  const executor = executorOrDefault();
  const [taskCount] = await executor
    .select({ count: sql<number>`count(*)` })
    .from(taskTable)
    .where(taskListWhere(identity, projectId, filters, executor));
  return taskCount;
}

/** A project's tasks with assignee columns, sorted, optionally paginated. */
export async function listProjectTasks(
  identity: ResolvedIdentity,
  projectId: string,
  filters: TaskListFilters,
  sort: { sortBy?: TaskListSort; sortOrder?: "asc" | "desc" },
  page?: { limit: number; offset: number },
) {
  const db = executorOrDefault();
  const taskSelection = {
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
  };

  const query = db
    .select(taskSelection)
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(taskListWhere(identity, projectId, filters, db))
    .orderBy(buildOrderBy(sort.sortBy ?? "position", sort.sortOrder ?? "asc"));

  return page ? await query.limit(page.limit).offset(page.offset) : await query;
}

/** A project's tasks in board order with the assignee columns the export needs. */
export async function listProjectTasksForExport(
  identity: ResolvedIdentity,
  projectId: string,
) {
  const executor = executorOrDefault();
  return await executor
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
    .where(
      and(
        eq(taskTable.projectId, projectId),
        taskProjectReach(identity, executor),
      ),
    )
    .orderBy(taskTable.position);
}

export async function listLabelsForTasks(
  identity: ResolvedIdentity,
  taskIds: string[],
) {
  const executor = executorOrDefault();
  return await executor
    .select({
      id: labelTable.id,
      name: labelTable.name,
      color: labelTable.color,
      taskId: labelTable.taskId,
    })
    .from(labelTable)
    .innerJoin(taskTable, eq(taskTable.id, labelTable.taskId))
    .where(
      and(
        inArray(labelTable.taskId, taskIds),
        taskProjectReach(identity, executor),
      ),
    );
}

export async function listExternalLinksForTasks(
  identity: ResolvedIdentity,
  taskIds: string[],
) {
  const executor = executorOrDefault();
  return await executor
    .select()
    .from(externalLinkTable)
    .where(
      and(
        inArray(externalLinkTable.taskId, taskIds),
        exists(
          executor
            .select({ one: sql`1` })
            .from(taskTable)
            .where(
              and(
                eq(taskTable.id, externalLinkTable.taskId),
                taskProjectReach(identity, executor),
              ),
            ),
        ),
      ),
    );
}

export async function listTaskRelations(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
) {
  return await executor
    .select()
    .from(taskRelationTable)
    .where(
      and(
        or(
          eq(taskRelationTable.sourceTaskId, taskId),
          eq(taskRelationTable.targetTaskId, taskId),
        ),
        exists(
          executor
            .select({ one: sql`1` })
            .from(taskTable)
            .where(
              and(
                eq(taskTable.id, taskId),
                taskProjectReach(identity, executor),
              ),
            ),
        ),
      ),
    )
    .execute();
}

// ---- writes ----------------------------------------------------------------------------

export async function deleteTaskById(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
) {
  const [deletedTask] = await executor
    .delete(taskTable)
    .where(and(eq(taskTable.id, taskId), taskProjectReach(identity, executor)))
    .returning()
    .execute();
  return deletedTask;
}

/** Update a task row by id and bump its version; the caller holds the row lock. */
export async function updateTaskRow(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
  values: Omit<Partial<typeof taskTable.$inferInsert>, "projectId">,
) {
  const [updatedTask] = await executor
    .update(taskTable)
    .set({
      ...values,
      projectId: taskTable.projectId,
      version: sql`${taskTable.version} + 1`,
    })
    .where(and(eq(taskTable.id, taskId), taskProjectReach(identity, executor)))
    .returning();
  return updatedTask;
}

export async function clearTaskReminders(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
) {
  await executor.delete(taskReminderSentTable).where(
    and(
      eq(taskReminderSentTable.taskId, taskId),
      exists(
        executor
          .select({ one: sql`1` })
          .from(taskTable)
          .where(
            and(
              eq(taskTable.id, taskReminderSentTable.taskId),
              taskProjectReach(identity, executor),
            ),
          ),
      ),
    ),
  );
}

export async function insertTaskActivity(
  executor: Executor,
  identity: ResolvedIdentity,
  values: typeof taskActivityTable.$inferInsert,
) {
  const selectedActivity = executor
    .select({
      id: sql`${sql.param(values.id === undefined ? createId() : values.id, taskActivityTable.id)}`.as(
        "id",
      ),
      taskId: taskTable.id,
      type: sql`${sql.param(values.type, taskActivityTable.type)}`.as("type"),
      createdAt:
        values.createdAt !== undefined
          ? sql`${sql.param(values.createdAt, taskActivityTable.createdAt)}`.as(
              "createdAt",
            )
          : sql`now()`.as("createdAt"),
      updatedAt:
        values.updatedAt !== undefined
          ? sql`${sql.param(values.updatedAt, taskActivityTable.updatedAt)}`.as(
              "updatedAt",
            )
          : sql`now()`.as("updatedAt"),
      userId:
        sql`${sql.param(values.userId ?? null, taskActivityTable.userId)}`.as(
          "userId",
        ),
      content:
        sql`${sql.param(values.content ?? null, taskActivityTable.content)}`.as(
          "content",
        ),
      eventData:
        sql`${sql.param(values.eventData ?? null, taskActivityTable.eventData)}`.as(
          "eventData",
        ),
      externalUserName:
        sql`${sql.param(values.externalUserName ?? null, taskActivityTable.externalUserName)}`.as(
          "externalUserName",
        ),
      externalUserAvatar:
        sql`${sql.param(values.externalUserAvatar ?? null, taskActivityTable.externalUserAvatar)}`.as(
          "externalUserAvatar",
        ),
      externalSource:
        sql`${sql.param(values.externalSource ?? null, taskActivityTable.externalSource)}`.as(
          "externalSource",
        ),
      externalUrl:
        sql`${sql.param(values.externalUrl ?? null, taskActivityTable.externalUrl)}`.as(
          "externalUrl",
        ),
    })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.id, values.taskId),
        taskProjectReach(identity, executor),
      ),
    );
  await executor.insert(taskActivityTable).select(selectedActivity);
}

// ---- assets (task image uploads) -------------------------------------------------------

export async function findAssetIdByObjectKey(
  executor: Executor,
  identity: ResolvedIdentity,
  objectKey: string,
  taskId: string,
) {
  const [existingAsset] = await executor
    .select({ id: assetTable.id })
    .from(assetTable)
    .where(
      and(
        eq(assetTable.objectKey, objectKey),
        eq(assetTable.taskId, taskId),
        exists(
          executor
            .select({ one: sql`1` })
            .from(taskTable)
            .where(
              and(
                eq(taskTable.id, assetTable.taskId),
                taskProjectReach(identity, executor),
              ),
            ),
        ),
      ),
    )
    .limit(1);
  return existingAsset;
}

export async function updateAssetById(
  executor: Executor,
  identity: ResolvedIdentity,
  id: string,
  values: Partial<typeof assetTable.$inferInsert>,
) {
  const [asset] = await executor
    .update(assetTable)
    .set(values)
    .where(
      and(
        eq(assetTable.id, id),
        exists(
          executor
            .select({ one: sql`1` })
            .from(taskTable)
            .where(
              and(
                eq(taskTable.id, assetTable.taskId),
                taskProjectReach(identity, executor),
              ),
            ),
        ),
      ),
    )
    .returning({ id: assetTable.id });
  return asset;
}

export async function insertAsset(
  executor: Executor,
  identity: ResolvedIdentity,
  values: typeof assetTable.$inferInsert,
) {
  const selectedAsset = executor
    .select({
      id: sql`${sql.param(values.id === undefined ? createId() : values.id, assetTable.id)}`.as(
        "id",
      ),
      workspaceId: workspaceTable.id,
      projectId: projectTable.id,
      taskId: taskTable.id,
      activityId:
        sql`${sql.param(values.activityId ?? null, assetTable.activityId)}`.as(
          "activityId",
        ),
      objectKey: sql`${sql.param(values.objectKey, assetTable.objectKey)}`.as(
        "objectKey",
      ),
      filename: sql`${sql.param(values.filename, assetTable.filename)}`.as(
        "filename",
      ),
      mimeType: sql`${sql.param(values.mimeType, assetTable.mimeType)}`.as(
        "mimeType",
      ),
      size: sql`${sql.param(values.size, assetTable.size)}`.as("size"),
      kind: sql`${sql.param(values.kind === undefined ? "image" : values.kind, assetTable.kind)}`.as(
        "kind",
      ),
      surface:
        sql`${sql.param(values.surface === undefined ? "description" : values.surface, assetTable.surface)}`.as(
          "surface",
        ),
      createdBy:
        sql`${sql.param(values.createdBy ?? null, assetTable.createdBy)}`.as(
          "createdBy",
        ),
      createdAt:
        values.createdAt !== undefined
          ? sql`${sql.param(values.createdAt, assetTable.createdAt)}`.as(
              "createdAt",
            )
          : sql`now()`.as("createdAt"),
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(
      and(
        eq(taskTable.id, values.taskId ?? ""),
        taskProjectReach(identity, executor),
      ),
    );
  const [asset] = await executor
    .insert(assetTable)
    .select(selectedAsset)
    .returning({ id: assetTable.id });
  return asset;
}

// ---- create / import / move / bulk (batch 9b) -----------------------------------------------

export async function findWorkspaceMembershipId(
  userId: string,
  workspaceId: string,
) {
  const [membership] = await executorOrDefault()
    .select({ id: workspaceUserTable.id })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.userId, userId),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return membership;
}

/**
 * The requested tasks that sit in a live (not archived, not deleted) project of `workspaceId`,
 * with their project; the workspace predicate is in the statement.
 */
export async function listWorkspaceScopedTasks(
  identity: ResolvedIdentity,
  taskIds: string[],
  workspaceId: string,
) {
  return await executorOrDefault()
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        inArray(taskTable.id, taskIds),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executorOrDefault(),
        ),
      ),
    );
}

/** A label by id that belongs to the workspace (or is legacy workspace-less). */
export async function findLabelInWorkspaceScope(
  executor: Executor,
  identity: ResolvedIdentity,
  labelId: string,
  workspaceId: string,
) {
  const scope = and(
    eq(labelTable.id, labelId),
    or(eq(labelTable.workspaceId, workspaceId), isNull(labelTable.workspaceId)),
  );
  const [label] = await executor
    .select()
    .from(labelTable)
    .where(
      and(
        scope,
        or(
          and(
            isNotNull(labelTable.taskId),
            exists(
              executor
                .select({ one: sql`1` })
                .from(taskTable)
                .where(
                  and(
                    eq(taskTable.id, labelTable.taskId),
                    taskProjectReach(identity, executor),
                  ),
                ),
            ),
          ),
          and(
            isNull(labelTable.taskId),
            labelTable.workspaceId
              ? currentWorkspaceReachPredicate(
                  identity,
                  labelTable.workspaceId,
                  executor,
                )
              : sql`false`,
          ),
        ),
      ),
    )
    .limit(1);
  return label;
}

export async function updateTaskRowReturningId(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
  values: Omit<Partial<typeof taskTable.$inferInsert>, "projectId">,
) {
  const [updated] = await executor
    .update(taskTable)
    .set({
      ...values,
      projectId: taskTable.projectId,
      version: sql`${taskTable.version} + 1`,
    })
    .where(and(eq(taskTable.id, taskId), taskProjectReach(identity, executor)))
    .returning({ id: taskTable.id });
  return updated;
}

export async function deleteTaskReturningId(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
) {
  const [deleted] = await executor
    .delete(taskTable)
    .where(and(eq(taskTable.id, taskId), taskProjectReach(identity, executor)))
    .returning({ id: taskTable.id });
  return deleted;
}

export async function findTaskLabelByName(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
  name: string,
) {
  const [label] = await executor
    .select()
    .from(labelTable)
    .where(
      and(
        eq(labelTable.name, name),
        eq(labelTable.taskId, taskId),
        exists(
          executor
            .select({ one: sql`1` })
            .from(taskTable)
            .where(
              and(
                eq(taskTable.id, labelTable.taskId),
                taskProjectReach(identity, executor),
              ),
            ),
        ),
      ),
    )
    .limit(1);
  return label;
}

export async function insertTaskLabelOnConflictDoNothing(
  executor: Executor,
  identity: ResolvedIdentity,
  values: { name: string; color: string; workspaceId: string; taskId: string },
) {
  const selectedLabel = executor
    .select({
      id: sql`${sql.param(createId(), labelTable.id)}`.as("id"),
      name: sql`${sql.param(values.name, labelTable.name)}`.as("name"),
      color: sql`${sql.param(values.color, labelTable.color)}`.as("color"),
      createdAt: sql`now()`.as("createdAt"),
      updatedAt: sql`now()`.as("updatedAt"),
      taskId: taskTable.id,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(taskTable.id, values.taskId),
        eq(projectTable.workspaceId, values.workspaceId),
        taskProjectReach(identity, executor),
      ),
    );
  const [inserted] = await executor
    .insert(labelTable)
    .select(selectedLabel)
    .onConflictDoNothing({
      target: [labelTable.taskId, labelTable.name],
    })
    .returning({ id: labelTable.id });
  return inserted;
}

export async function deleteTaskLabelByName(
  executor: Executor,
  identity: ResolvedIdentity,
  input: { workspaceId: string; name: string; taskId: string },
) {
  const [deleted] = await executor
    .delete(labelTable)
    .where(
      and(
        eq(labelTable.workspaceId, input.workspaceId),
        eq(labelTable.name, input.name),
        eq(labelTable.taskId, input.taskId),
        exists(
          executor
            .select({ one: sql`1` })
            .from(taskTable)
            .where(
              and(
                eq(taskTable.id, labelTable.taskId),
                taskProjectReach(identity, executor),
              ),
            ),
        ),
      ),
    )
    .returning();
  return deleted;
}

/** Highest task position in a project's column (or status when the column is unknown). */
export async function findMaxTaskPositionInColumnOrStatus(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
  status: string,
  columnId: string | undefined,
) {
  const [maxPositionResult] = await executor
    .select({ maxPosition: max(taskTable.position) })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.projectId, projectId),
        taskProjectReach(identity, executor),
        columnId
          ? eq(taskTable.columnId, columnId)
          : eq(taskTable.status, status),
      ),
    );
  return maxPositionResult;
}

/** Highest task position among a project's tasks with this status AND column (task move). */
export async function findMaxTaskPositionInStatusAndColumn(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
  status: string,
  columnId: string,
) {
  const [maxPositionResult] = await executor
    .select({ maxPosition: max(taskTable.position) })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.projectId, projectId),
        taskProjectReach(identity, executor),
        eq(taskTable.status, status),
        eq(taskTable.columnId, columnId),
      ),
    );
  return maxPositionResult;
}

export async function insertTask(
  executor: Executor,
  identity: ResolvedIdentity,
  values: typeof taskTable.$inferInsert,
) {
  const selectedTask = executor
    .select({
      id: sql`${sql.param(values.id === undefined ? createId() : values.id, taskTable.id)}`.as(
        "id",
      ),
      projectId: projectTable.id,
      position:
        sql`${sql.param(values.position === undefined ? 0 : values.position, taskTable.position)}`.as(
          "position",
        ),
      number:
        sql`${sql.param(values.number === undefined ? 1 : values.number, taskTable.number)}`.as(
          "number",
        ),
      userId: sql`${sql.param(values.userId ?? null, taskTable.userId)}`.as(
        "userId",
      ),
      title: sql`${sql.param(values.title, taskTable.title)}`.as("title"),
      description:
        sql`${sql.param(values.description ?? null, taskTable.description)}`.as(
          "description",
        ),
      status:
        sql`${sql.param(values.status === undefined ? "to-do" : values.status, taskTable.status)}`.as(
          "status",
        ),
      columnId:
        sql`${sql.param(values.columnId ?? null, taskTable.columnId)}`.as(
          "columnId",
        ),
      priority:
        sql`${sql.param(values.priority === undefined ? "low" : values.priority, taskTable.priority)}`.as(
          "priority",
        ),
      startDate:
        sql`${sql.param(values.startDate ?? null, taskTable.startDate)}`.as(
          "startDate",
        ),
      dueDate: sql`${sql.param(values.dueDate ?? null, taskTable.dueDate)}`.as(
        "dueDate",
      ),
      version:
        sql`${sql.param(values.version === undefined ? 1 : values.version, taskTable.version)}`.as(
          "version",
        ),
      createdAt:
        values.createdAt !== undefined
          ? sql`${sql.param(values.createdAt, taskTable.createdAt)}`.as(
              "createdAt",
            )
          : sql`now()`.as("createdAt"),
      updatedAt:
        values.updatedAt !== undefined
          ? sql`${sql.param(values.updatedAt, taskTable.updatedAt)}`.as(
              "updatedAt",
            )
          : sql`now()`.as("updatedAt"),
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, values.projectId),
        isNull(projectTable.deletedAt),
        currentProjectRowReach(identity, executor),
      ),
    );
  const [task] = await executor
    .insert(taskTable)
    .select(selectedTask)
    .returning();
  return task;
}

export async function findProjectById(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
) {
  const [liveProject] = await executor
    .select()
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        isNull(projectTable.deletedAt),
        currentProjectRowReach(identity, executor),
      ),
    )
    .limit(1);
  return liveProject;
}

export async function listColumnsForMove(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
) {
  return await executor
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      position: columnTable.position,
    })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, projectId),
        projectReach(identity, projectId, executor),
      ),
    )
    .orderBy(asc(columnTable.position));
}

/** The source project with its freeze flags (reach preflight for a move). */
export async function findProjectFreezeState(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
) {
  const [sourcePreflight] = await executor
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      archivedAt: projectTable.archivedAt,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    )
    .limit(1);
  return sourcePreflight;
}

/** A live, unarchived project of the given workspace (destination preflight for a move). */
export async function findLiveUnarchivedProjectInWorkspace(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
  workspaceId: string,
) {
  const [destinationPreflight] = await executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
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
    .limit(1);
  return destinationPreflight;
}

/**
 * Row-lock a live project for a move: `update` for the destination (which gets a new task
 * number), `share` for the source. A destination lock also pins the source's workspace.
 */
export async function lockLiveProjectForMove(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
  options: { mode: "update" | "share"; workspaceId?: string },
) {
  const [liveProject] = await executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
        ...(options.workspaceId !== undefined
          ? [eq(projectTable.workspaceId, options.workspaceId)]
          : []),
      ),
    )
    .for(options.mode);
  return liveProject;
}

export async function findProjectIdentity(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
) {
  const [sourceProject] = await executor
    .select({
      id: projectTable.id,
      name: projectTable.name,
      workspaceId: projectTable.workspaceId,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    )
    .limit(1);
  return sourceProject;
}

/** A non-deleted project of the source's workspace: foreign and missing ids stay indistinct. */
export async function findNotDeletedProjectInWorkspace(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
  workspaceId: string,
) {
  const [destinationProject] = await executor
    .select({
      id: projectTable.id,
      name: projectTable.name,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    )
    .limit(1);
  return destinationProject;
}

/** Move a task and all of its source-project assets under one statement snapshot. */
export async function moveTaskAndAssetsForIdentity(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
  sourceProjectId: string,
  destinationProjectId: string,
  values: Pick<
    Partial<typeof taskTable.$inferInsert>,
    "status" | "columnId" | "number" | "position"
  >,
) {
  const movedTask = executor.$with("moved_task").as(
    executor
      .update(taskTable)
      .set({
        ...values,
        projectId: destinationProjectId,
        version: sql`${taskTable.version} + 1`,
      })
      .where(
        and(
          eq(taskTable.id, taskId),
          eq(taskTable.projectId, sourceProjectId),
          taskProjectReach(identity, executor),
          taskProjectMoveReach(
            identity,
            taskTable.projectId,
            destinationProjectId,
            executor,
          ),
          not(
            exists(
              executor
                .select({ one: sql`1` })
                .from(assetTable)
                .where(
                  and(
                    eq(assetTable.taskId, taskId),
                    ne(assetTable.projectId, sourceProjectId),
                  ),
                ),
            ),
          ),
        ),
      )
      .returning(),
  );
  const movedAssets = executor.$with("moved_assets").as(
    executor
      .update(assetTable)
      .set({ projectId: destinationProjectId })
      .from(movedTask)
      .where(
        and(
          eq(assetTable.taskId, movedTask.id),
          eq(assetTable.projectId, sourceProjectId),
        ),
      )
      .returning({ id: assetTable.id }),
  );
  const [task] = await executor
    .with(movedTask, movedAssets)
    .select()
    .from(movedTask);
  return task;
}
