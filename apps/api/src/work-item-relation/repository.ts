import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  personTable,
  projectTable,
  stateTable,
  stateTemplateTable,
  userTable,
  workItemRelationTable,
  workItemTable,
  workspaceUserTable,
} from "../database/schema";

export async function findEndpoint(
  key: string,
  workspaceId: string,
  executor: Executor = db,
) {
  const [row] = await executor
    .select()
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return row;
}
export async function lockEndpoints(executor: Executor, ids: string[]) {
  return executor
    .select()
    .from(workItemTable)
    .where(inArray(workItemTable.id, [...new Set(ids)]))
    .orderBy(asc(workItemTable.id))
    .for("update");
}
export async function findRelation(id: string, executor: Executor = db) {
  const [row] = await executor
    .select()
    .from(workItemRelationTable)
    .where(eq(workItemRelationTable.id, id))
    .limit(1);
  return row;
}
export async function findExisting(
  executor: Executor,
  sourceId: string,
  targetId: string,
  type: string,
) {
  const [row] = await executor
    .select()
    .from(workItemRelationTable)
    .where(
      and(
        eq(workItemRelationTable.type, type),
        type === "relates"
          ? or(
              and(
                eq(workItemRelationTable.sourceId, sourceId),
                eq(workItemRelationTable.targetId, targetId),
              ),
              and(
                eq(workItemRelationTable.sourceId, targetId),
                eq(workItemRelationTable.targetId, sourceId),
              ),
            )
          : and(
              eq(workItemRelationTable.sourceId, sourceId),
              eq(workItemRelationTable.targetId, targetId),
            ),
      ),
    )
    .limit(1);
  return row;
}
export async function insertRelation(
  executor: Executor,
  sourceId: string,
  targetId: string,
  type: string,
) {
  const [row] = await executor
    .insert(workItemRelationTable)
    .values({ sourceId, targetId, type })
    .returning();
  if (!row) throw new Error("Relation insert returned no row");
  return row;
}
export async function removeRelation(
  executor: Executor,
  row: typeof workItemRelationTable.$inferSelect,
) {
  const [removed] = await executor
    .delete(workItemRelationTable)
    .where(
      and(
        eq(workItemRelationTable.id, row.id),
        eq(workItemRelationTable.sourceId, row.sourceId),
        eq(workItemRelationTable.targetId, row.targetId),
        eq(workItemRelationTable.type, row.type),
      ),
    )
    .returning();
  return removed;
}
export async function listRelationRows(itemId: string, workspaceId: string) {
  const peer = alias(workItemTable, "relation_peer");
  return db
    .select({
      relation: workItemRelationTable,
      peer,
      organisationId: projectTable.organisationId,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
      assigneeName: userTable.name,
      assigneeMember: workspaceUserTable.id,
    })
    .from(workItemRelationTable)
    .innerJoin(
      peer,
      or(
        and(
          eq(workItemRelationTable.sourceId, itemId),
          eq(peer.id, workItemRelationTable.targetId),
        ),
        and(
          eq(workItemRelationTable.targetId, itemId),
          eq(peer.id, workItemRelationTable.sourceId),
        ),
      ),
    )
    .innerJoin(projectTable, eq(projectTable.id, peer.projectId))
    .innerJoin(stateTable, eq(stateTable.id, peer.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .leftJoin(personTable, eq(personTable.id, peer.assigneeId))
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, peer.workspaceId),
        eq(workspaceUserTable.userId, personTable.userId),
      ),
    )
    .where(
      and(
        eq(peer.workspaceId, workspaceId),
        isNull(peer.deletedAt),
        isNull(peer.archivedAt),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
      ),
    )
    .orderBy(asc(workItemRelationTable.id));
}
export async function hasBlockingCycle(sourceId: string, targetId: string) {
  const result = await db.execute<{
    cycle: boolean;
  }>(sql`WITH RECURSIVE reachable(id) AS (
    SELECT target_id FROM work_item_relation WHERE source_id = ${targetId} AND type = 'blocks'
    UNION SELECT relation.target_id FROM work_item_relation relation JOIN reachable ON relation.source_id = reachable.id WHERE relation.type = 'blocks'
  ) SELECT EXISTS (SELECT 1 FROM reachable WHERE id = ${sourceId}) AS cycle`);
  return result.rows[0]?.cycle ?? false;
}

export async function listCandidateRows(input: {
  workspaceId: string;
  sourceId: string;
  q: string;
  after?: { key: string; id: string };
  limit: number;
}) {
  const pattern = `%${input.q.replace(/[\\%_]/g, "\\$&")}%`;
  return db
    .select({
      item: workItemTable,
      organisationId: projectTable.organisationId,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
      assigneeName: userTable.name,
      assigneeMember: workspaceUserTable.id,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .leftJoin(personTable, eq(personTable.id, workItemTable.assigneeId))
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, workItemTable.workspaceId),
        eq(workspaceUserTable.userId, personTable.userId),
      ),
    )
    .where(
      and(
        eq(workItemTable.workspaceId, input.workspaceId),
        sql`${workItemTable.id} <> ${input.sourceId}`,
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        sql`(${workItemTable.title} ILIKE ${pattern} ESCAPE '\\' OR ${workItemTable.key} ILIKE ${pattern} ESCAPE '\\')`,
        input.after
          ? sql`(${workItemTable.key},${workItemTable.id}) > (${input.after.key},${input.after.id})`
          : undefined,
      ),
    )
    .orderBy(asc(workItemTable.key), asc(workItemTable.id))
    .limit(input.limit);
}
