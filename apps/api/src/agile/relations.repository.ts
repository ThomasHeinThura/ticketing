import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../database";
import { workItemRelationTable, workItemTable } from "../database/schema";

export const DEPENDENCY_TYPES = ["blocks", "precedes"] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];
export const MAX_DEPENDENCY_EDGES = 2000;

/**
 * VW-28: the `blocks` and `precedes` edges whose two ends are both live work items of this
 * project, for the timeline's dependency arrows. An edge to an item in another project is not
 * drawn (the caller's reach to that project is not established here).
 */
export async function listProjectDependencies(
  projectId: string,
  types: readonly DependencyType[],
) {
  const target = alias(workItemTable, "target_item");
  const rows = await db
    .select({
      id: workItemRelationTable.id,
      type: workItemRelationTable.type,
      sourceKey: workItemTable.key,
      targetKey: target.key,
    })
    .from(workItemRelationTable)
    .innerJoin(
      workItemTable,
      eq(workItemTable.id, workItemRelationTable.sourceId),
    )
    .innerJoin(target, eq(target.id, workItemRelationTable.targetId))
    .where(
      and(
        inArray(workItemRelationTable.type, [...types]),
        eq(workItemTable.projectId, projectId),
        eq(target.projectId, projectId),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(target.deletedAt),
        isNull(target.archivedAt),
      ),
    )
    .orderBy(
      asc(workItemRelationTable.createdAt),
      asc(workItemRelationTable.id),
    )
    .limit(MAX_DEPENDENCY_EDGES);
  return rows.map((row) => ({
    id: row.id,
    type: row.type as DependencyType,
    sourceKey: row.sourceKey,
    targetKey: row.targetKey,
  }));
}
