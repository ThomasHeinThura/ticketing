import type { SQL } from "drizzle-orm";
import { and, count, eq, inArray, isNull, min, sql } from "drizzle-orm";
import db from "../../database";
import {
  projectTable,
  stateTable,
  stateTemplateTable,
  workItemTable,
} from "../../database/schema";
import { loadVisibleProjectSubtrees } from "../descendants.repository";

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

type ProjectStatisticsWithCompleted = ProjectStatistics & {
  completedTasks: number;
};

/** Pure reach-filtered aggregation of the visible subtree, including its root. */
export function aggregateVisibleTreeStatistics(
  subtrees: ReadonlyMap<string, readonly string[]>,
  workItemReadableProjectIds: readonly string[],
  statisticsByProject: ReadonlyMap<string, ProjectStatisticsWithCompleted>,
) {
  const result = new Map<string, ProjectStatistics>();
  const readable = new Set(workItemReadableProjectIds);
  for (const [rootId, ids] of subtrees) {
    // Do not emit an aggregate that would reveal that hidden/unreachable descendants exist.
    if (!ids.some((id) => id !== rootId && readable.has(id))) continue;
    let totalTasks = 0;
    let completedTasks = 0;
    let dueDate: Date | null = null;
    for (const id of ids) {
      if (!readable.has(id)) continue;
      const statistics = statisticsByProject.get(id);
      if (!statistics) continue;
      totalTasks += statistics.totalTasks;
      completedTasks += statistics.completedTasks;
      if (statistics.dueDate && (!dueDate || statistics.dueDate < dueDate))
        dueDate = statistics.dueDate;
    }
    result.set(rootId, {
      totalTasks,
      completionPercentage:
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      dueDate,
    });
  }
  return result;
}

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
      projectId: workItemTable.projectId,
      totalTasks: count(),
      completedTasks: count(
        sql`case when ${stateTemplateTable.group} in ('completed', 'cancelled') then 1 end`,
      ),
      dueDate: min(workItemTable.dueDate),
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(workItemTable.projectId, projectTable.id))
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    )
    .where(
      // #187: a soft-deleted project's statistics never surface, `includeArchived` or
      // not -- `archivedAt` and `deletedAt` are independent (PR-16), and there is no
      // "show deleted" toggle to extend `includeArchived` into.
      includeArchived
        ? and(
            eq(projectTable.workspaceId, workspaceId),
            isNull(workItemTable.archivedAt),
            isNull(workItemTable.deletedAt),
            isNull(projectTable.deletedAt),
            reachFilter,
          )
        : and(
            eq(projectTable.workspaceId, workspaceId),
            isNull(workItemTable.archivedAt),
            isNull(workItemTable.deletedAt),
            isNull(projectTable.archivedAt),
            isNull(projectTable.deletedAt),
            reachFilter,
          ),
    )
    .groupBy(workItemTable.projectId);

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

async function getVisibleTreeStatistics(
  workspaceId: string,
  roots: readonly string[],
  workItemReadableProjectIds: readonly string[],
) {
  const result = new Map<string, ProjectStatistics>();
  if (roots.length === 0 || workItemReadableProjectIds.length === 0)
    return result;

  const subtrees = await loadVisibleProjectSubtrees(db, workspaceId, roots);
  const readable = new Set(workItemReadableProjectIds);
  const visibleIds = new Set<string>();
  for (const ids of subtrees.values()) {
    for (const id of ids) if (readable.has(id)) visibleIds.add(id);
  }
  if (visibleIds.size === 0) return result;

  const rows = await db
    .select({
      projectId: workItemTable.projectId,
      totalTasks: count(),
      completedTasks: count(
        sql`case when ${stateTemplateTable.group} in ('completed', 'cancelled') then 1 end`,
      ),
      dueDate: min(workItemTable.dueDate),
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(workItemTable.projectId, projectTable.id))
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    )
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        inArray(workItemTable.projectId, [...visibleIds]),
        isNull(workItemTable.archivedAt),
        isNull(workItemTable.deletedAt),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .groupBy(workItemTable.projectId);

  const statisticsByProject = new Map<
    string,
    ProjectStatistics & { completedTasks: number }
  >();
  for (const row of rows) {
    const totalTasks = Number(row.totalTasks);
    const completedTasks = Number(row.completedTasks);
    statisticsByProject.set(row.projectId, {
      totalTasks,
      completedTasks,
      completionPercentage:
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      dueDate: row.dueDate ?? null,
    });
  }

  return aggregateVisibleTreeStatistics(
    subtrees,
    workItemReadableProjectIds,
    statisticsByProject,
  );
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
  includeDeleted = false,
  workItemReadableProjectIds: readonly string[] = [],
) {
  if (reachableProjectIds !== null && reachableProjectIds.length === 0) {
    return [];
  }
  const reachFilter =
    reachableProjectIds === null
      ? undefined
      : inArray(projectTable.id, [...reachableProjectIds]);
  const projects = await db.query.projectTable.findMany({
    // #187 / PR-16: `archivedAt` and `deletedAt` are independent. The default list excludes
    // both; `includeArchived` reveals archived rows and `includeDeleted` reveals rows still
    // inside their 30-day soft-delete window, each on its own. Statistics (below) never
    // cover a deleted project, so a revealed deleted project shows empty statistics.
    where: and(
      eq(projectTable.workspaceId, workspaceId),
      includeArchived ? undefined : isNull(projectTable.archivedAt),
      includeDeleted ? undefined : isNull(projectTable.deletedAt),
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
  const descendantStatisticsByProject = await getVisibleTreeStatistics(
    workspaceId,
    projects.map((project) => project.id),
    workItemReadableProjectIds,
  );

  return projects.map((project) => ({
    ...project,
    statistics: statisticsByProject.get(project.id) ?? EMPTY_STATISTICS,
    ...(descendantStatisticsByProject.has(project.id)
      ? {
          descendantStatistics: descendantStatisticsByProject.get(project.id),
        }
      : {}),
    archivedTasks: [],
    plannedTasks: [],
    columns: [],
  }));
}

export default getProjects;
