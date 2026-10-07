import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type db from "../database";
import { taskActivityTable, userTable } from "../database/schema";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function getProjectWorkspace(executor: Executor, projectId: string) {
  return executor.query.projectTable.findFirst({
    columns: { workspaceId: true },
    where: (project, { eq }) => eq(project.id, projectId),
  });
}

export function getUserName(executor: Executor, userId: string) {
  return executor
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId));
}

export function getCommentByAuthor(
  executor: Executor,
  userId: string,
  id: string,
) {
  return executor
    .select({
      id: taskActivityTable.id,
      content: taskActivityTable.content,
      taskId: taskActivityTable.taskId,
    })
    .from(taskActivityTable)
    .where(
      and(
        eq(taskActivityTable.id, id),
        eq(taskActivityTable.userId, userId),
        eq(taskActivityTable.type, "comment"),
      ),
    )
    .limit(1);
}

export function listActivities(executor: Executor, taskId: string) {
  return executor.query.taskActivityTable.findMany({
    where: eq(taskActivityTable.taskId, taskId),
    orderBy: [desc(taskActivityTable.createdAt)],
  });
}

export function listComments(executor: Executor, taskId: string) {
  return executor
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
