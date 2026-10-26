import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import type { AuthenticatedApiKey } from "../../permissions/resolve-request-identity";
import { loadVisibleProjectSubtreeIds } from "../../project/descendants.repository";
import type { CombinedLegacyListFilters } from "../combined-list-query";
import type { WorkItemSearchQuery } from "../search/query";
import { searchWorkItems } from "../search/repository";

const STATE_GROUP_ORDER = sql<number>`case ${schema.stateTemplateTable.group}
  when 'backlog' then 0
  when 'unstarted' then 1
  when 'started' then 2
  when 'completed' then 3
  when 'cancelled' then 4
  else 5
end`;

/**
 * Search a project's visible subtree for the opt-in combined board. The route supplies its
 * ordinary reach-filtered project IDs; this controller intersects those with a fresh,
 * workspace-safe subtree, and `searchWorkItems` then independently intersects the set with
 * the caller's `work_item:read` capability before it reads, counts or pages any row.
 */
export async function listCombinedWorkItems(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  reachableProjectIds: readonly string[];
  query: WorkItemSearchQuery;
  legacyFilters?: CombinedLegacyListFilters;
  limit: number;
  cursor?: string;
  apiKey?: AuthenticatedApiKey;
  impersonatedBy?: string | null;
}) {
  const subtreeIds = await loadVisibleProjectSubtreeIds(
    db,
    input.workspaceId,
    input.projectId,
  );
  const reachable = new Set(input.reachableProjectIds);
  const projectScopeIds = subtreeIds.filter((id) => reachable.has(id));

  const result = await searchWorkItems({
    userId: input.userId,
    apiKey: input.apiKey,
    impersonatedBy: input.impersonatedBy,
    workspaceId: input.workspaceId,
    query: input.query,
    limit: input.limit,
    cursor: input.cursor,
    projectScopeIds,
    ...(input.legacyFilters ? { legacyListFilters: input.legacyFilters } : {}),
  });

  const authorizedProjectIds = result.serverScopedProjectIds;
  if (!authorizedProjectIds) {
    throw new HTTPException(500, {
      message: "Combined board reach could not be determined",
    });
  }

  const [projects, columns, states] = await Promise.all([
    authorizedProjectIds.length
      ? db
          .select({
            id: schema.projectTable.id,
            key: schema.projectTable.slug,
            name: schema.projectTable.name,
          })
          .from(schema.projectTable)
          .where(
            and(
              eq(schema.projectTable.workspaceId, input.workspaceId),
              inArray(schema.projectTable.id, authorizedProjectIds),
              isNull(schema.projectTable.archivedAt),
              isNull(schema.projectTable.deletedAt),
            ),
          )
      : Promise.resolve([]),
    authorizedProjectIds.length
      ? db
          .select({
            templateId: schema.stateTemplateTable.id,
            name: schema.stateTemplateTable.name,
            group: schema.stateTemplateTable.group,
            position: sql<number>`min(${schema.stateTable.position})::int`,
            key: schema.stateTemplateTable.key,
          })
          .from(schema.stateTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.projectTable.id, schema.stateTable.projectId),
          )
          .innerJoin(
            schema.stateTemplateTable,
            and(
              eq(
                schema.stateTemplateTable.id,
                schema.stateTable.stateTemplateId,
              ),
              eq(schema.stateTemplateTable.workspaceId, input.workspaceId),
            ),
          )
          .where(
            and(
              inArray(schema.projectTable.id, authorizedProjectIds),
              isNull(schema.projectTable.archivedAt),
              isNull(schema.projectTable.deletedAt),
              isNull(schema.stateTable.archivedAt),
            ),
          )
          .groupBy(
            schema.stateTemplateTable.id,
            schema.stateTemplateTable.name,
            schema.stateTemplateTable.group,
            schema.stateTemplateTable.key,
          )
          .orderBy(
            asc(sql`min(${schema.stateTable.position})`),
            asc(STATE_GROUP_ORDER),
            asc(schema.stateTemplateTable.key),
            asc(schema.stateTemplateTable.id),
          )
      : Promise.resolve([]),
    result.data.length
      ? db
          .select({
            id: schema.stateTable.id,
            templateId: schema.stateTable.stateTemplateId,
            workItemId: schema.workItemTable.id,
          })
          .from(schema.workItemTable)
          .innerJoin(
            schema.stateTable,
            and(
              eq(schema.stateTable.id, schema.workItemTable.stateId),
              eq(schema.stateTable.projectId, schema.workItemTable.projectId),
            ),
          )
          .where(
            inArray(
              schema.workItemTable.id,
              result.data.map((item) => item.id),
            ),
          )
      : Promise.resolve([]),
  ]);

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const templateByItemId = new Map(
    states.map((state) => [state.workItemId, state.templateId]),
  );
  const data = result.data.map((item) => {
    const sourceProject = projectById.get(item.projectId);
    const stateTemplateId = templateByItemId.get(item.id);
    if (!sourceProject || !stateTemplateId) {
      throw new HTTPException(500, {
        message: "Combined board row projection is incomplete",
      });
    }
    return { ...item, stateTemplateId, sourceProject };
  });

  return {
    data,
    columns: columns.map(({ key: _key, ...column }) => ({
      ...column,
      group: column.group as
        | "backlog"
        | "unstarted"
        | "started"
        | "completed"
        | "cancelled",
    })),
    page: result.page,
    meta: result.meta,
    ...(result.customFieldColumns
      ? { customFieldColumns: result.customFieldColumns }
      : {}),
    ...(result.customFieldPeople
      ? { customFieldPeople: result.customFieldPeople }
      : {}),
  };
}
