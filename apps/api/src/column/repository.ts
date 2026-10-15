import { and, asc, eq, sql } from "drizzle-orm";
import db from "../database";
import { columnTable, taskTable } from "../database/schema";

/**
 * Query ownership for `column` (issue #580). Every function awaits and returns rows;
 * none opens a transaction, as the controllers did not.
 */

export type ColumnRow = typeof columnTable.$inferSelect;
export type NewColumn = Pick<
  typeof columnTable.$inferInsert,
  "projectId" | "name" | "slug" | "position" | "icon" | "color" | "isFinal"
>;
export type ColumnChanges = Partial<
  Pick<typeof columnTable.$inferInsert, "name" | "icon" | "color" | "isFinal">
>;

export async function findColumnById(id: string) {
  return db.query.columnTable.findFirst({
    where: eq(columnTable.id, id),
  });
}

/** Columns of a project sharing a slug (zero or one rows by the unique slug rule). */
export async function listColumnIdsBySlug(projectId: string, slug: string) {
  return db
    .select({ id: columnTable.id })
    .from(columnTable)
    .where(
      sql`${columnTable.projectId} = ${projectId} AND ${columnTable.slug} = ${slug}`,
    );
}

export async function getMaxColumnPosition(projectId: string) {
  const [maxPos] = await db
    .select({
      maxPosition: sql<number>`COALESCE(MAX(${columnTable.position}), -1)`,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId));
  return maxPos;
}

export async function insertColumn(values: NewColumn) {
  const [created] = await db.insert(columnTable).values(values).returning();
  return created;
}

export async function countTasksInColumn(columnId: string) {
  const [taskCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(taskTable)
    .where(eq(taskTable.columnId, columnId));
  return taskCount;
}

export async function deleteColumnById(id: string): Promise<void> {
  await db.delete(columnTable).where(eq(columnTable.id, id));
}

export async function listProjectColumnsByPosition(projectId: string) {
  return db
    .select()
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));
}

/** Sets one column's position when it belongs to the project; `undefined` otherwise. */
export async function updateColumnPositionInProject(
  projectId: string,
  id: string,
  position: number,
) {
  const [updated] = await db
    .update(columnTable)
    .set({ position })
    .where(and(eq(columnTable.id, id), eq(columnTable.projectId, projectId)))
    .returning({ id: columnTable.id });
  return updated;
}

export async function listProjectColumnsOrdered(projectId: string) {
  return db.query.columnTable.findMany({
    where: eq(columnTable.projectId, projectId),
    orderBy: (columns, { asc }) => [asc(columns.position)],
  });
}

export async function updateColumnById(id: string, changes: ColumnChanges) {
  const [updated] = await db
    .update(columnTable)
    .set(changes)
    .where(eq(columnTable.id, id))
    .returning();
  return updated;
}
