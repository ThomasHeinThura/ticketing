import type { SQL } from "drizzle-orm";
import { and, count, eq, inArray, isNull, min, sql } from "drizzle-orm";
import db from "../../database";
import { projectTable, taskTable } from "../../database/schema";

type ProjectStatistics = {
  completionPercentage: number;
  totalTasks: number;
  dueDate: Date | null;
};

const EMPTY_STATISTICS: ProjectStatistics = {
  completionPercentage: 0,
  totalTasks: 0,
  dueDate: null,
};

async function getProjectStatistics(
  workspaceId: string,
  includeArchived: boolean,
  reachFilter: SQL | undefined,
) {
  const statisticsByProject = new Map<string, ProjectStatistics>();

  // Aggregate in the database instead of loading every task row into memory.
  // This endpoint needs three numbers per project; the previous
  // `with: { tasks: true }` made both the query and the response grow linearly
  // with the number of tasks in the workspace. Scoping by workspaceId through
  // a join (rather than an `IN (...projectIds)` list) keeps the statement size
  // constant regardless of how many projects the workspace has.
  const rows = await db
    .select({
      projectId: taskTable.projectId,
      totalTasks: count(),
      completedTasks: count(
        sql`case when ${taskTable.status} in ('done', 'archived') then 1 end`,
      ),
      dueDate: min(taskTable.dueDate),
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      // #187: a soft-deleted project's statistics never surface, `includeArchived` or
      // not -- `archivedAt` and `deletedAt` are independent (PR-16), and there is no
      // "show deleted" toggle to extend `includeArchived` into.
      includeArchived
        ? and(
            eq(projectTable.workspaceId, workspaceId),
            isNull(projectTable.deletedAt),
            reachFilter,
          )
        : and(
            eq(projectTable.workspaceId, workspaceId),
            isNull(projectTable.archivedAt),
            isNull(projectTable.deletedAt),
            reachFilter,
          ),
    )
    .groupBy(taskTable.projectId);

  for (const row of rows) {
    const totalTasks = Number(row.totalTasks);
    const completedTasks = Number(row.completedTasks);

    statisticsByProject.set(row.projectId, {
      totalTasks,
      completionPercentage:
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      dueDate: row.dueDate ?? null,
    });
  }

  return statisticsByProject;
}

/**
 * `reachableProjectIds` (#740) restricts the list to projects the caller reaches. It is
 * required, not optional, so a new caller cannot forget it: pass `null` only for a trusted,
 * non-request context that has no caller (none exists today).
 */
async function getProjects(
  workspaceId: string,
  includeArchived: boolean,
  reachableProjectIds: readonly string[] | null,
) {
  if (reachableProjectIds !== null && reachableProjectIds.length === 0) {
    return [];
  }
  const reachFilter =
    reachableProjectIds === null
      ? undefined
      : inArray(projectTable.id, [...reachableProjectIds]);
  const projects = await db.query.projectTable.findMany({
    // #187: same reasoning as `getProjectStatistics` above -- `deletedAt` is always
    // excluded, `includeArchived` only ever controls `archivedAt`.
    where: includeArchived
      ? and(
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
          reachFilter,
        )
      : and(
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.archivedAt),
          isNull(projectTable.deletedAt),
          reachFilter,
        ),
    // `id` is the deterministic tie-breaker: without it, rows sharing both a
    // position and a createdAt come back in an unspecified order.
    orderBy: (project, { asc }) => [
      asc(project.position),
      asc(project.createdAt),
      asc(project.id),
    ],
  });

  const statisticsByProject = await getProjectStatistics(
    workspaceId,
    includeArchived,
    reachFilter,
  );

  return projects.map((project) => ({
    ...project,
    statistics: statisticsByProject.get(project.id) ?? EMPTY_STATISTICS,
    archivedTasks: [],
    plannedTasks: [],
    columns: [],
  }));
}

export default getProjects;
