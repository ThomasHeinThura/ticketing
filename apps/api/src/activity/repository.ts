import { and, desc, eq } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import { taskActivityTable, userTable } from "../database/schema";

/**
 * Query ownership for `task_activity` (issue #580). Statements that run inside the
 * controllers' transactions take the handle as their first parameter (`Executor`); the
 * others use the shared connection. Every function awaits and returns rows.
 */

export type NewTaskActivity = {
  taskId: string;
  type: string;
  userId: string;
  content: string | null;
  eventData?: Record<string, unknown> | null;
};

export async function insertTaskActivity(
  executor: Executor,
  values: NewTaskActivity,
) {
  const [row] = await executor
    .insert(taskActivityTable)
    .values({
      taskId: values.taskId,
      type: values.type,
      userId: values.userId,
      content: values.content,
      eventData: values.eventData ?? null,
    })
    .returning();
  return row;
}

export async function insertCommentActivity(
  executor: Executor,
  values: {
    taskId: string;
    userId: string;
    content: string;
    external?: { userName: string; source: string };
  },
) {
  const { taskId, userId, content, external } = values;
  const [activity] = await executor
    .insert(taskActivityTable)
    .values({
      taskId,
      type: "comment",
      userId,
      content,
      ...(external
        ? {
            externalUserName: external.userName,
            externalSource: external.source,
          }
        : {}),
    })
    .returning();
  return activity;
}

/** The project's workspace id inside the comment transaction, or `undefined`. */
export async function findProjectWorkspaceId(
  executor: Executor,
  projectId: string,
) {
  return executor.query.projectTable.findFirst({
    columns: { workspaceId: true },
    where: (project, { eq }) => eq(project.id, projectId),
  });
}

export async function findUserName(userId: string) {
  const [user] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId));
  return user;
}

/** The comment when `userId` authored it, else `undefined`. */
export async function findOwnComment(userId: string, id: string) {
  const [existing] = await db
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
  return existing;
}

export async function deleteOwnComment(
  executor: Executor,
  userId: string,
  id: string,
) {
  const [deleted] = await executor
    .delete(taskActivityTable)
    .where(
      and(
        eq(taskActivityTable.id, id),
        eq(taskActivityTable.userId, userId),
        eq(taskActivityTable.type, "comment"),
      ),
    )
    .returning();
  return deleted;
}

export async function updateOwnCommentContent(
  executor: Executor,
  userId: string,
  id: string,
  content: string,
) {
  const [updated] = await executor
    .update(taskActivityTable)
    .set({ content })
    .where(
      and(
        eq(taskActivityTable.id, id),
        eq(taskActivityTable.userId, userId),
        eq(taskActivityTable.type, "comment"),
      ),
    )
    .returning();
  return updated;
}

export async function listTaskActivitiesNewestFirst(taskId: string) {
  return db.query.taskActivityTable.findMany({
    where: eq(taskActivityTable.taskId, taskId),
    orderBy: [desc(taskActivityTable.createdAt)],
  });
}
