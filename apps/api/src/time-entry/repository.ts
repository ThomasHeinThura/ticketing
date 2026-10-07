import { eq } from "drizzle-orm";
import type db from "../database";
import { timeEntryTable, userTable } from "../database/schema";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function getTimeEntry(executor: Executor, id: string) {
  return executor
    .select()
    .from(timeEntryTable)
    .where(eq(timeEntryTable.id, id));
}

export function listTimeEntriesByTaskId(executor: Executor, taskId: string) {
  return executor
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
