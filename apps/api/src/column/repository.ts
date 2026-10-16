import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, asc, eq, exists, sql } from "drizzle-orm";
import db from "../database";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import {
  columnTable,
  projectTable,
  taskTable,
} from "../database/schema";

export type ColumnRow = typeof columnTable.$inferSelect;
export type NewColumn = Pick<
  typeof columnTable.$inferInsert,
  "projectId" | "name" | "slug" | "position" | "icon" | "color" | "isFinal"
>;
export type ColumnChanges = Partial<
  Pick<typeof columnTable.$inferInsert, "name" | "icon" | "color" | "isFinal">
>;

function reachableProject(identity: ResolvedIdentity, projectId: string) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, projectId),
          sql`${projectTable.deletedAt} IS NULL`,
          currentProjectReachPredicate(
            identity,
            projectTable.id,
            projectTable.workspaceId,
            projectTable.organisationId,
            db,
          ),
        ),
      ),
  );
}

function reachableColumn(identity: ResolvedIdentity) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, columnTable.projectId),
          sql`${projectTable.deletedAt} IS NULL`,
          currentProjectReachPredicate(
            identity,
            projectTable.id,
            projectTable.workspaceId,
            projectTable.organisationId,
            db,
          ),
        ),
      ),
  );
}

export async function findColumnById(
  identity: ResolvedIdentity,
  id: string,
) {
  const [row] = await db
    .select()
    .from(columnTable)
    .where(and(eq(columnTable.id, id), reachableColumn(identity)))
    .limit(1);
  return row;
}

export async function listColumnIdsBySlug(
  identity: ResolvedIdentity,
  projectId: string,
  slug: string,
) {
  return await db
    .select({ id: columnTable.id })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, projectId),
        eq(columnTable.slug, slug),
        reachableProject(identity, projectId),
      ),
    );
}

export async function getMaxColumnPosition(
  identity: ResolvedIdentity,
  projectId: string,
) {
  const [maxPos] = await db
    .select({ maxPosition: sql<number>`COALESCE(MAX(${columnTable.position}), -1)` })
    .from(columnTable)
    .where(
      and(eq(columnTable.projectId, projectId), reachableProject(identity, projectId)),
    );
  return maxPos;
}

export async function insertColumn(
  identity: ResolvedIdentity,
  values: NewColumn,
) {
  const [created] = await db
    .insert(columnTable)
    .select(
      db
        .select({
          projectId: projectTable.id,
          name: sql`${values.name}`.as("name"),
          slug: sql`${values.slug}`.as("slug"),
          position: sql`${values.position}`.as("position"),
          icon: sql`${values.icon}`.as("icon"),
          color: sql`${values.color}`.as("color"),
          isFinal: sql`${values.isFinal}`.as("is_final"),
        })
        .from(projectTable)
        .where(
          and(
            eq(projectTable.id, values.projectId),
            sql`${projectTable.deletedAt} IS NULL`,
            currentProjectReachPredicate(
              identity,
              projectTable.id,
              projectTable.workspaceId,
              projectTable.organisationId,
              db,
            ),
          ),
        )
        .limit(1),
    )
    .returning();
  return created;
}

export async function countTasksInColumn(
  identity: ResolvedIdentity,
  columnId: string,
) {
  const [taskCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.columnId, columnId),
        exists(
          db
            .select({ one: sql`1` })
            .from(columnTable)
            .where(
              and(
                eq(columnTable.id, columnId),
                reachableColumn(identity),
              ),
            ),
        ),
      ),
    );
  return taskCount;
}

export async function deleteColumnById(
  identity: ResolvedIdentity,
  id: string,
) {
  const [deleted] = await db
    .delete(columnTable)
    .where(and(eq(columnTable.id, id), reachableColumn(identity)))
    .returning();
  return deleted;
}

export async function listProjectColumnsByPosition(
  identity: ResolvedIdentity,
  projectId: string,
) {
  return await db
    .select()
    .from(columnTable)
    .where(
      and(eq(columnTable.projectId, projectId), reachableProject(identity, projectId)),
    )
    .orderBy(asc(columnTable.position));
}

export async function updateColumnPositionInProject(
  identity: ResolvedIdentity,
  projectId: string,
  id: string,
  position: number,
) {
  const [updated] = await db
    .update(columnTable)
    .set({ position })
    .where(
      and(
        eq(columnTable.id, id),
        eq(columnTable.projectId, projectId),
        reachableProject(identity, projectId),
      ),
    )
    .returning({ id: columnTable.id });
  return updated;
}

export async function listProjectColumnsOrdered(
  identity: ResolvedIdentity,
  projectId: string,
) {
  return await db.query.columnTable.findMany({
    where: and(
      eq(columnTable.projectId, projectId),
      reachableProject(identity, projectId),
    ),
    orderBy: (columns, { asc }) => [asc(columns.position)],
  });
}

export async function updateColumnById(
  identity: ResolvedIdentity,
  id: string,
  changes: ColumnChanges,
) {
  const [updated] = await db
    .update(columnTable)
    .set(changes)
    .where(and(eq(columnTable.id, id), reachableColumn(identity)))
    .returning();
  return updated;
}
