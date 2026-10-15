import { and, asc, eq, isNotNull } from "drizzle-orm";
import db from "../database";
import { taskActivityTable, userTable } from "../database/schema";

/** Comment-typed activity rows of a task with their author, oldest first (issue #580). */
export async function listTaskCommentRows(taskId: string) {
  return db
    .select({
      id: taskActivityTable.id,
      taskId: taskActivityTable.taskId,
      userId: userTable.id,
      content: taskActivityTable.content,
      createdAt: taskActivityTable.createdAt,
      updatedAt: taskActivityTable.updatedAt,
      userName: userTable.name,
      userImage: userTable.image,
    })
    .from(taskActivityTable)
    .innerJoin(userTable, eq(taskActivityTable.userId, userTable.id))
    .where(
      and(
        eq(taskActivityTable.taskId, taskId),
        eq(taskActivityTable.type, "comment"),
        isNotNull(taskActivityTable.userId),
        isNotNull(taskActivityTable.content),
      ),
    )
    .orderBy(asc(taskActivityTable.createdAt));
}
