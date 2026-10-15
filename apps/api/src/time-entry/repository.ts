import { eq } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import { timeEntryTable, userTable } from "../database/schema";

/**
 * Query ownership for `time_entry` (issue #580). Statements that run inside the
 * controllers' transactions take the handle as their first parameter (`Executor`);
 * the others use the shared connection. Every function awaits and returns rows.
 */

export type NewTimeEntry = Pick<
  typeof timeEntryTable.$inferInsert,
  | "id"
  | "taskId"
  | "userId"
  | "description"
  | "startTime"
  | "endTime"
  | "duration"
>;
export type TimeEntryChanges = Pick<
  typeof timeEntryTable.$inferInsert,
  "startTime" | "endTime" | "duration" | "description"
>;

export async function insertTimeEntry(
  executor: Executor,
  values: NewTimeEntry,
) {
  const [created] = await executor
    .insert(timeEntryTable)
    .values(values)
    .returning();
  return created;
}

export async function updateTimeEntryById(
  executor: Executor,
  id: string,
  changes: Partial<TimeEntryChanges>,
) {
  const [updated] = await executor
    .update(timeEntryTable)
    .set(changes)
    .where(eq(timeEntryTable.id, id))
    .returning();
  return updated;
}

export async function findTimeEntryById(id: string) {
  const [timeEntry] = await db
    .select()
    .from(timeEntryTable)
    .where(eq(timeEntryTable.id, id));
  return timeEntry;
}

export async function listTimeEntriesWithUserByTask(taskId: string) {
  return db
    .select({
      id: timeEntryTable.id,
      taskId: timeEntryTable.taskId,
      userId: timeEntryTable.userId,
      userName: userTable.name,
      description: timeEntryTable.description,
      startTime: timeEntryTable.startTime,
      endTime: timeEntryTable.endTime,
      duration: timeEntryTable.duration,
      createdAt: timeEntryTable.createdAt,
      updatedAt: timeEntryTable.updatedAt,
    })
    .from(timeEntryTable)
    .leftJoin(userTable, eq(timeEntryTable.userId, userTable.id))
    .where(eq(timeEntryTable.taskId, taskId))
    .orderBy(timeEntryTable.startTime);
}
