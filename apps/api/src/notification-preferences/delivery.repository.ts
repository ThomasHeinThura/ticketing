import { and, eq } from "drizzle-orm";
import db from "../database";
import {
  notificationTable,
  projectTable,
  taskTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceRuleTable,
  userTable,
  workspaceTable,
} from "../database/schema";
import { reachableWorkspacePredicate } from "../utils/workspace-access-middleware";

export async function findDeliveryNotification(notificationId: string) {
  return await db.query.notificationTable.findFirst({
    where: eq(notificationTable.id, notificationId),
  });
}

export async function findDeliveryTaskContext(resourceId: string) {
  return await db
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
    .where(eq(taskTable.id, resourceId))
    .limit(1);
}

export async function findDeliveryWorkspaceContext(
  resourceId: string,
  userId: string,
) {
  return await db
    .select({
      workspaceId: workspaceTable.id,
      workspaceName: workspaceTable.name,
    })
    .from(workspaceTable)
    .where(
      and(
        eq(workspaceTable.id, resourceId),
        reachableWorkspacePredicate(workspaceTable.id, userId),
      ),
    )
    .limit(1);
}

export async function findDeliveryUser(userId: string) {
  return await db
    .select({
      email: userTable.email,
      name: userTable.name,
      locale: userTable.locale,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
}

export async function findDeliveryPreference(userId: string) {
  return await db.query.userNotificationPreferenceTable.findFirst({
    where: eq(userNotificationPreferenceTable.userId, userId),
  });
}

export async function findDeliveryWorkspaceRule(
  userId: string,
  workspaceId: string,
) {
  return await db.query.userNotificationWorkspaceRuleTable.findFirst({
    where: and(
      eq(userNotificationWorkspaceRuleTable.userId, userId),
      eq(userNotificationWorkspaceRuleTable.workspaceId, workspaceId),
    ),
    with: {
      selectedProjects: true,
    },
  });
}
