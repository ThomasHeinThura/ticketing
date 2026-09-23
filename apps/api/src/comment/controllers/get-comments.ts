import { and, asc, eq, isNotNull } from "drizzle-orm";
import db from "../../database";
import { taskActivityTable, userTable } from "../../database/schema";

async function getComments(taskId: string) {
  const comments = await db
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

  return comments.map((c) => ({
    id: c.id,
    taskId: c.taskId,
    userId: c.userId,
    content: c.content as string,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    user: {
      name: c.userName,
      image: c.userImage,
    },
  }));
}

export default getComments;
