import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import db from "../database";
import {
  notificationTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../database/schema";
import { approvalNotificationReadable } from "./approval-reach.repository";
import { reachableTaskNotificationPredicate } from "./task-reach.repository";

/**
 * Query ownership for the user-facing notification inbox (issue #580). Every function awaits
 * and returns rows. The reach predicates (`approvalNotificationReadable`,
 * `reachableTaskNotificationPredicate`) are composed here, inside the statement, so no
 * inbox read or write can omit them.
 */

/** Rows of other resource types pass; task rows need current task reach. */
function taskNotificationReadable(
  userId: string,
  credentialCanReadTask?: boolean,
) {
  return or(
    isNull(notificationTable.resourceType),
    ne(notificationTable.resourceType, "task"),
    credentialCanReadTask === undefined
      ? reachableTaskNotificationPredicate(userId)
      : reachableTaskNotificationPredicate(userId, credentialCanReadTask),
  );
}

export async function deleteReadableNotifications(userId: string) {
  await db
    .delete(notificationTable)
    .where(
      and(
        eq(notificationTable.userId, userId),
        approvalNotificationReadable(userId),
        taskNotificationReadable(userId),
      ),
    );
}

export async function markReadableNotificationsRead(userId: string) {
  await db
    .update(notificationTable)
    .set({ isRead: true })
    .where(
      and(
        eq(notificationTable.userId, userId),
        approvalNotificationReadable(userId),
        taskNotificationReadable(userId),
      ),
    );
}

/** The caller's own notification type, or `undefined` (used to hide admin-only alerts). */
export async function findOwnNotificationType(id: string, userId: string) {
  const [existing] = await db
    .select({ type: notificationTable.type })
    .from(notificationTable)
    .where(
      and(eq(notificationTable.id, id), eq(notificationTable.userId, userId)),
    )
    .limit(1);
  return existing;
}

export async function markOwnReadableNotificationRead(
  id: string,
  userId: string,
) {
  const [notification] = await db
    .update(notificationTable)
    .set({ isRead: true })
    .where(
      and(
        eq(notificationTable.id, id),
        eq(notificationTable.userId, userId),
        approvalNotificationReadable(userId),
        taskNotificationReadable(userId),
      ),
    )
    .returning();
  return notification;
}

/** The newest 50 visible inbox rows with their task's project and workspace ids. */
export async function listVisibleNotificationRows(params: {
  userId: string;
  canReadInstanceAlerts: boolean;
  credentialCanReadTask: boolean;
}) {
  const { userId, canReadInstanceAlerts, credentialCanReadTask } = params;
  const visibleToUser = canReadInstanceAlerts
    ? eq(notificationTable.userId, userId)
    : and(
        eq(notificationTable.userId, userId),
        ne(notificationTable.type, "audit_write_failed"),
      );
  return db
    .select({
      notification: notificationTable,
      projectId: projectTable.id,
      workspaceId: workspaceTable.id,
    })
    .from(notificationTable)
    .leftJoin(
      taskTable,
      and(
        eq(notificationTable.resourceId, taskTable.id),
        eq(notificationTable.resourceType, "task"),
      ),
    )
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(
      and(
        visibleToUser,
        approvalNotificationReadable(userId),
        taskNotificationReadable(userId, credentialCanReadTask),
      ),
    )
    .orderBy(desc(notificationTable.createdAt))
    .limit(50);
}

export async function findNotificationPreferenceRow(userId: string) {
  return db.query.userNotificationPreferenceTable.findFirst({
    where: (table, { eq }) => eq(table.userId, userId),
  });
}

export async function insertNotificationRow(
  values: typeof notificationTable.$inferInsert,
) {
  const [notification] = await db
    .insert(notificationTable)
    .values(values)
    .returning();
  return notification;
}

/** The project's workspace id, or `undefined`. */
export async function findProjectWorkspaceId(projectId: string) {
  const [project] = await db
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return project;
}

/** The task's project id, or `undefined`. */
export async function findTaskProjectId(taskId: string) {
  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  return task;
}
