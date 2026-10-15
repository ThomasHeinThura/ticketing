import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  max,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { type Executor, executorOrDefault } from "../database/executor";
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

/**
 * Legacy task repository (issue #580, batch 9a). Every statement of the small task controllers
 * lives here, moved verbatim. The controllers keep their transactions, lock order (task row
 * first, then project liveness), version bump semantics, events and error mapping.
 */

// ---- row locks -------------------------------------------------------------------------

/** Exclusive row lock on one task (legacy writes lock the task first). */
export async function lockTaskRow(executor: Executor, taskId: string) {
  const [task] = await executor
    .select()
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
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

/** Atomically advance `project.lastTaskNumber` by `count`; undefined when the project is gone. */
export async function advanceProjectTaskNumber(
  executor: Executor,
  projectId: string,
  count: number,
) {
  const [updated] = await executor
    .update(projectTable)
    .set({
      lastTaskNumber: sql`${projectTable.lastTaskNumber} + ${count}`,
    })
    .where(eq(projectTable.id, projectId))
    .returning({ lastTaskNumber: projectTable.lastTaskNumber });
  return updated;
}

// ---- reads -----------------------------------------------------------------------------

export async function listColumnSlugs(executor: Executor, projectId: string) {
  return await executor
    .select({ slug: columnTable.slug })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));
}

export async function findColumnBySlug(
  executor: Executor,
  projectId: string,
  slug: string,
) {
  return await executor.query.columnTable.findFirst({
    where: and(
      eq(columnTable.projectId, projectId),
      eq(columnTable.slug, slug),
    ),
  });
}

export async function listProjectColumns(projectId: string) {
  return await executorOrDefault()
    .select()
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));
}

/** A project that is not soft-deleted (#187), or undefined. */
export async function findLiveProject(projectId: string) {
  return await executorOrDefault().query.projectTable.findFirst({
    // #187: a soft-deleted project is treated as gone everywhere in ordinary use,
    // matching `get-project.ts`'s convention.
    where: and(eq(projectTable.id, projectId), isNull(projectTable.deletedAt)),
  });
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
  projectId: string,
) {
  const [context] = await executor
    .select({ workspaceId: workspaceTable.id })
    .from(projectTable)
    .innerJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(eq(projectTable.id, projectId));
  return context;
}

export async function findTaskWithAssignee(taskId: string) {
  const task = await executorOrDefault()
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
  return task[0];
}

export async function findTaskAssigneeId(taskId: string) {
  const [existingTask] = await executorOrDefault()
    .select({ userId: taskTable.userId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  return existingTask;
}

export async function findUserName(userId: string, executor?: Executor) {
  const [user] = await executorOrDefault(executor)
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
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

function taskListWhere(projectId: string, filters: TaskListFilters) {
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

  return and(...conditions);
}

/** Count of a project's tasks matching the filters; the project predicate is in the statement. */
export async function countProjectTasks(
  projectId: string,
  filters: TaskListFilters,
) {
  const [taskCount] = await executorOrDefault()
    .select({ count: sql<number>`count(*)` })
    .from(taskTable)
    .where(taskListWhere(projectId, filters));
  return taskCount;
}

/** A project's tasks with assignee columns, sorted, optionally paginated. */
export async function listProjectTasks(
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
    .where(taskListWhere(projectId, filters))
    .orderBy(buildOrderBy(sort.sortBy ?? "position", sort.sortOrder ?? "asc"));

  return page ? await query.limit(page.limit).offset(page.offset) : await query;
}

/** A project's tasks in board order with the assignee columns the export needs. */
export async function listProjectTasksForExport(projectId: string) {
  return await executorOrDefault()
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

export async function listLabelsForTasks(taskIds: string[]) {
  return await executorOrDefault()
    .select({
      id: labelTable.id,
      name: labelTable.name,
      color: labelTable.color,
      taskId: labelTable.taskId,
    })
    .from(labelTable)
    .where(inArray(labelTable.taskId, taskIds));
}

export async function listExternalLinksForTasks(taskIds: string[]) {
  return await executorOrDefault()
    .select()
    .from(externalLinkTable)
    .where(inArray(externalLinkTable.taskId, taskIds));
}

export async function listTaskRelations(executor: Executor, taskId: string) {
  return await executor
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

// ---- writes ----------------------------------------------------------------------------

export async function deleteTaskById(executor: Executor, taskId: string) {
  const [deletedTask] = await executor
    .delete(taskTable)
    .where(eq(taskTable.id, taskId))
    .returning()
    .execute();
  return deletedTask;
}

/** Update a task row by id and bump its version; the caller holds the row lock. */
export async function updateTaskRow(
  executor: Executor,
  taskId: string,
  values: Partial<typeof taskTable.$inferInsert>,
) {
  const [updatedTask] = await executor
    .update(taskTable)
    .set({ ...values, version: sql`${taskTable.version} + 1` })
    .where(eq(taskTable.id, taskId))
    .returning();
  return updatedTask;
}

export async function clearTaskReminders(executor: Executor, taskId: string) {
  await executor
    .delete(taskReminderSentTable)
    .where(eq(taskReminderSentTable.taskId, taskId));
}

export async function insertTaskActivity(
  executor: Executor,
  values: typeof taskActivityTable.$inferInsert,
) {
  await executor.insert(taskActivityTable).values(values);
}

// ---- assets (task image uploads) -------------------------------------------------------

export async function findAssetIdByObjectKey(
  executor: Executor,
  objectKey: string,
) {
  const [existingAsset] = await executor
    .select({ id: assetTable.id })
    .from(assetTable)
    .where(eq(assetTable.objectKey, objectKey))
    .limit(1);
  return existingAsset;
}

export async function updateAssetById(
  executor: Executor,
  id: string,
  values: Partial<typeof assetTable.$inferInsert>,
) {
  const [asset] = await executor
    .update(assetTable)
    .set(values)
    .where(eq(assetTable.id, id))
    .returning({ id: assetTable.id });
  return asset;
}

export async function insertAsset(
  executor: Executor,
  values: typeof assetTable.$inferInsert,
) {
  const [asset] = await executor
    .insert(assetTable)
    .values(values)
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
      ),
    );
}

/** A label by id that belongs to the workspace (or is legacy workspace-less). */
export async function findLabelInWorkspaceScope(
  executor: Executor,
  labelId: string,
  workspaceId: string,
) {
  const scope = and(
    eq(labelTable.id, labelId),
    or(eq(labelTable.workspaceId, workspaceId), isNull(labelTable.workspaceId)),
  );
  return await executor.query.labelTable.findFirst({ where: scope });
}

export async function updateTaskRowReturningId(
  executor: Executor,
  taskId: string,
  values: Partial<typeof taskTable.$inferInsert>,
) {
  const [updated] = await executor
    .update(taskTable)
    .set({ ...values, version: sql`${taskTable.version} + 1` })
    .where(eq(taskTable.id, taskId))
    .returning({ id: taskTable.id });
  return updated;
}

export async function deleteTaskReturningId(
  executor: Executor,
  taskId: string,
) {
  const [deleted] = await executor
    .delete(taskTable)
    .where(eq(taskTable.id, taskId))
    .returning({ id: taskTable.id });
  return deleted;
}

export async function findTaskLabelByName(
  executor: Executor,
  taskId: string,
  name: string,
) {
  return await executor.query.labelTable.findFirst({
    where: and(eq(labelTable.name, name), eq(labelTable.taskId, taskId)),
  });
}

export async function insertTaskLabelOnConflictDoNothing(
  executor: Executor,
  values: { name: string; color: string; workspaceId: string; taskId: string },
) {
  const [inserted] = await executor
    .insert(labelTable)
    .values(values)
    .onConflictDoNothing({
      target: [labelTable.taskId, labelTable.name],
    })
    .returning({ id: labelTable.id });
  return inserted;
}

export async function deleteTaskLabelByName(
  executor: Executor,
  input: { workspaceId: string; name: string; taskId: string },
) {
  const [deleted] = await executor
    .delete(labelTable)
    .where(
      and(
        eq(labelTable.workspaceId, input.workspaceId),
        eq(labelTable.name, input.name),
        eq(labelTable.taskId, input.taskId),
      ),
    )
    .returning();
  return deleted;
}

/** Highest task position in a project's column (or status when the column is unknown). */
export async function findMaxTaskPositionInColumnOrStatus(
  executor: Executor,
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
        eq(taskTable.status, status),
        eq(taskTable.columnId, columnId),
      ),
    );
  return maxPositionResult;
}

export async function insertTask(
  executor: Executor,
  values: typeof taskTable.$inferInsert,
) {
  const [task] = await executor.insert(taskTable).values(values).returning();
  return task;
}

export async function findProjectById(executor: Executor, projectId: string) {
  const [liveProject] = await executor
    .select()
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return liveProject;
}

export async function listColumnsForMove(
  executor: Executor,
  projectId: string,
) {
  return await executor
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      position: columnTable.position,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));
}

/** The source project with its freeze flags (reach preflight for a move). */
export async function findProjectFreezeState(
  executor: Executor,
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
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return sourcePreflight;
}

/** A live, unarchived project of the given workspace (destination preflight for a move). */
export async function findLiveUnarchivedProjectInWorkspace(
  executor: Executor,
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
  projectId: string,
) {
  const [sourceProject] = await executor
    .select({
      id: projectTable.id,
      name: projectTable.name,
      workspaceId: projectTable.workspaceId,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return sourceProject;
}

/** A non-deleted project of the source's workspace: foreign and missing ids stay indistinct. */
export async function findNotDeletedProjectInWorkspace(
  executor: Executor,
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
      ),
    )
    .limit(1);
  return destinationProject;
}

/** Move the task's assets with it. */
export async function reassignTaskAssetsToProject(
  executor: Executor,
  taskId: string,
  projectId: string,
) {
  await executor
    .update(assetTable)
    .set({ projectId })
    .where(eq(assetTable.taskId, taskId));
}
