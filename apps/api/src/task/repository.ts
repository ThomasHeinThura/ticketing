import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
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

export async function findUserName(userId: string) {
  const [user] = await executorOrDefault()
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
