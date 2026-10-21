import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, asc, count, eq, exists, gt, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "../database/executor";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import {
  projectTable,
  stateTable,
  stateTemplateTable,
  workItemTable,
} from "../database/schema";

export type HierarchyScope = {
  workspaceId: string;
  projectId: string;
  parentId: string;
};
const visibleItem = () =>
  and(isNull(workItemTable.deletedAt), isNull(workItemTable.archivedAt));

export async function findHierarchyPageParentQuery(
  executor: Executor,
  identity: ResolvedIdentity,
  key: string,
  workspaceId: string,
) {
  const [row] = await executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      parentId: workItemTable.parentId,
      projectId: workItemTable.projectId,
      workspaceId: workItemTable.workspaceId,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
        visibleItem(),
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
  return row;
}

export async function findHierarchyAncestorQuery(
  executor: Executor,
  scope: HierarchyScope,
  id: string,
) {
  const [row] = await executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      parentId: workItemTable.parentId,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
    })
    .from(workItemTable)
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .where(
      and(
        eq(workItemTable.id, id),
        eq(workItemTable.workspaceId, scope.workspaceId),
        eq(workItemTable.projectId, scope.projectId),
        visibleItem(),
      ),
    )
    .limit(1);
  return row;
}

export async function listHierarchyChildrenQuery(
  executor: Executor,
  scope: HierarchyScope,
  after: { position: string; id: string } | undefined,
  limit: number,
) {
  const child = alias(workItemTable, "hierarchy_child");
  return executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      position: workItemTable.position,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
      hasChildren: sql<boolean>`${exists(
        executor
          .select({ one: sql`1` })
          .from(child)
          .where(
            and(
              eq(child.parentId, workItemTable.id),
              eq(child.workspaceId, scope.workspaceId),
              eq(child.projectId, scope.projectId),
              isNull(child.deletedAt),
              isNull(child.archivedAt),
            ),
          ),
      )}`,
    })
    .from(workItemTable)
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .where(
      and(
        eq(workItemTable.parentId, scope.parentId),
        eq(workItemTable.workspaceId, scope.workspaceId),
        eq(workItemTable.projectId, scope.projectId),
        visibleItem(),
        after
          ? or(
              gt(workItemTable.position, after.position),
              and(
                eq(workItemTable.position, after.position),
                gt(workItemTable.id, after.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(workItemTable.position), asc(workItemTable.id))
    .limit(limit);
}

export async function countHierarchyChildrenQuery(
  executor: Executor,
  scope: HierarchyScope,
) {
  const [row] = await executor
    .select({ total: count() })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.parentId, scope.parentId),
        eq(workItemTable.workspaceId, scope.workspaceId),
        eq(workItemTable.projectId, scope.projectId),
        visibleItem(),
      ),
    );
  return row?.total ?? 0;
}

export async function hierarchyProgressQuery(
  executor: Executor,
  scope: HierarchyScope,
) {
  // Depth is at most five. UNION deduplicates IDs as defense against pre-guard corrupt cycles.
  // This aggregate has no page or 500-node presentation limit.
  const result = await executor.execute<{
    total: string;
    completed: string;
  }>(sql`
    WITH RECURSIVE descendants AS (
      SELECT id, state_id FROM work_item WHERE parent_id = ${scope.parentId}
        AND workspace_id = ${scope.workspaceId} AND project_id = ${scope.projectId}
        AND deleted_at IS NULL AND archived_at IS NULL AND id <> ${scope.parentId}
      UNION
      SELECT child.id, child.state_id FROM work_item child
        JOIN descendants parent ON child.parent_id = parent.id
        WHERE child.workspace_id = ${scope.workspaceId} AND child.project_id = ${scope.projectId}
          AND child.deleted_at IS NULL AND child.archived_at IS NULL AND child.id <> ${scope.parentId}
    )
    SELECT count(*)::text AS total,
      count(*) FILTER (WHERE template."group" IN ('completed', 'cancelled'))::text AS completed
    FROM descendants item JOIN state ON state.id = item.state_id
      JOIN state_template template ON template.id = state.state_template_id
  `);
  return {
    total: Number(result.rows[0]?.total ?? 0),
    completed: Number(result.rows[0]?.completed ?? 0),
  };
}
