import { asc, eq, sql } from "drizzle-orm";
import db from "../database";
import { columnTable, taskTable } from "../database/schema";

export const listColumnsQuery = (projectId: string) =>
  db
    .select()
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));
export const findColumnSlugQuery = (projectId: string, slug: string) =>
  db
    .select({ id: columnTable.id })
    .from(columnTable)
    .where(
      sql`${columnTable.projectId} = ${projectId} AND ${columnTable.slug} = ${slug}`,
    );
export const getColumnMaxPositionQuery = (projectId: string) =>
  db
    .select({
      maxPosition: sql<number>`COALESCE(MAX(${columnTable.position}), -1)`,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId));
export const getColumnQuery = (id: string) =>
  db.query.columnTable.findFirst({ where: eq(columnTable.id, id) });
export const countColumnTasksQuery = (id: string) =>
  db
    .select({ count: sql<number>`count(*)` })
    .from(taskTable)
    .where(eq(taskTable.columnId, id));
export const getColumnsByProjectQuery = (projectId: string) =>
  db.query.columnTable.findMany({
    where: eq(columnTable.projectId, projectId),
    orderBy: (columns, { asc }) => [asc(columns.position)],
  });
