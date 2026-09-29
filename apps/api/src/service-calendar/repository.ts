import { and, eq } from "drizzle-orm";
import db from "../database";
import { serviceCalendarTable } from "../database/schema";

export const listCalendars = (workspaceId: string) =>
  db
    .select()
    .from(serviceCalendarTable)
    .where(eq(serviceCalendarTable.workspaceId, workspaceId))
    .orderBy(serviceCalendarTable.name);
export const getCalendar = async (id: string, workspaceId: string) =>
  (
    await db
      .select()
      .from(serviceCalendarTable)
      .where(eq(serviceCalendarTable.id, id))
      .limit(1)
  ).find((row) => row.workspaceId === workspaceId);
export async function createCalendar(input: {
  workspaceId: string;
  name: string;
  timezone: string;
  windows: unknown;
  holidays: unknown;
}) {
  const [row] = await db.insert(serviceCalendarTable).values(input).returning();
  return row;
}
export async function updateCalendar(
  id: string,
  workspaceId: string,
  input: {
    name?: string;
    timezone?: string;
    windows?: unknown;
    holidays?: unknown;
  },
) {
  const [row] = await db
    .update(serviceCalendarTable)
    .set(input)
    .where(
      and(
        eq(serviceCalendarTable.id, id),
        eq(serviceCalendarTable.workspaceId, workspaceId),
      ),
    )
    .returning();
  return row;
}
export async function deleteCalendar(id: string, workspaceId: string) {
  const [row] = await db
    .delete(serviceCalendarTable)
    .where(
      and(
        eq(serviceCalendarTable.id, id),
        eq(serviceCalendarTable.workspaceId, workspaceId),
      ),
    )
    .returning();
  return row;
}
