import { and, eq, inArray } from "drizzle-orm";
import db from "../database";
import {
  notificationTable,
  projectTable,
  taskTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceRuleTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";

export function getWorkspaceMembership(userId: string, workspaceId: string) {
  return db
    .select({ workspaceId: workspaceUserTable.workspaceId })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.userId, userId),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
}

export function listSelectedProjects(
  workspaceId: string,
  projectIds: string[],
) {
  return db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        inArray(projectTable.id, projectIds),
      ),
    );
}

export function getPreference(userId: string) {
  return db.query.userNotificationPreferenceTable.findFirst({
    where: eq(userNotificationPreferenceTable.userId, userId),
  });
}

export function getWorkspaceRules(userId: string) {
  return db.query.userNotificationWorkspaceRuleTable.findMany({
    where: eq(userNotificationWorkspaceRuleTable.userId, userId),
    with: { workspace: true, selectedProjects: true },
    orderBy: (table, { asc }) => [asc(table.createdAt)],
  });
}

export function getWorkspaceRule(userId: string, workspaceId: string) {
  return db.query.userNotificationWorkspaceRuleTable.findFirst({
    where: and(
      eq(userNotificationWorkspaceRuleTable.userId, userId),
      eq(userNotificationWorkspaceRuleTable.workspaceId, workspaceId),
    ),
  });
}

export function getNotification(notificationId: string) {
  return db.query.notificationTable.findFirst({
    where: eq(notificationTable.id, notificationId),
  });
}

export function getNotificationRecipient(userId: string) {
  return db
    .select({
      email: userTable.email,
      name: userTable.name,
      locale: userTable.locale,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
}

export function getDeliveryWorkspaceRule(userId: string, workspaceId: string) {
  return db.query.userNotificationWorkspaceRuleTable.findFirst({
    where: and(
      eq(userNotificationWorkspaceRuleTable.userId, userId),
      eq(userNotificationWorkspaceRuleTable.workspaceId, workspaceId),
    ),
    with: { selectedProjects: true },
  });
}

export function getTaskNotificationContext(taskId: string) {
  return db
    .select({
      taskId: taskTable.id,
      taskTitle: taskTable.title,
      projectId: projectTable.id,
      projectName: projectTable.name,
      workspaceId: workspaceTable.id,
      workspaceName: workspaceTable.name,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .innerJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);
}

export function getWorkspaceNotificationContext(workspaceId: string) {
  return db
    .select({
      workspaceId: workspaceTable.id,
      workspaceName: workspaceTable.name,
    })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
}
