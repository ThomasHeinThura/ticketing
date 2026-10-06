import { and, desc, eq, isNull, ne } from "drizzle-orm";
import db, { schema } from "../database";
import {
  notificationTable,
  projectTable,
  taskTable,
  userNotificationPreferenceTable,
  workspaceTable,
} from "../database/schema";
import type { DbTransaction } from "../events/outbox";

export function getNotificationPreference(userId: string) {
  return db.query.userNotificationPreferenceTable.findFirst({
    where: eq(userNotificationPreferenceTable.userId, userId),
  });
}

export function getProjectWorkspace(projectId: string) {
  return db
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
}

export function getTaskProject(taskId: string) {
  return db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
}

export function listVisibleNotifications(
  userId: string,
  canReadInstanceAlerts: boolean,
) {
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
    .where(visibleToUser)
    .orderBy(desc(notificationTable.createdAt))
    .limit(50);
}

export function getOwnedNotificationType(id: string, userId: string) {
  return db
    .select({ type: notificationTable.type })
    .from(notificationTable)
    .where(
      and(eq(notificationTable.id, id), eq(notificationTable.userId, userId)),
    )
    .limit(1);
}

export async function findApprovalNotificationContext(
  tx: DbTransaction,
  approvalId: string,
) {
  const [row] = await tx
    .select({
      id: schema.approvalTable.id,
      kind: schema.approvalTable.kind,
      requestedBy: schema.approvalTable.requestedBy,
      approverId: schema.approvalTable.approverId,
      workItemId: schema.workItemTable.id,
      workspaceId: schema.workItemTable.workspaceId,
      projectId: schema.workItemTable.projectId,
      organisationId: schema.workspaceTable.organisationId,
      requesterId: schema.workItemTable.requesterId,
      customerVisibility: schema.workItemTable.customerVisibility,
    })
    .from(schema.approvalTable)
    .innerJoin(
      schema.workItemTable,
      eq(schema.workItemTable.id, schema.approvalTable.workItemId),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, schema.workItemTable.workspaceId),
    )
    .where(
      and(
        eq(schema.approvalTable.id, approvalId),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function listApprovalWatcherPersonIds(
  tx: DbTransaction,
  workItemId: string,
) {
  return tx
    .select({ personId: schema.watcherTable.personId })
    .from(schema.watcherTable)
    .where(eq(schema.watcherTable.workItemId, workItemId));
}

export function listApprovalParticipantPersonIds(
  tx: DbTransaction,
  workItemId: string,
) {
  return tx
    .select({ personId: schema.requestParticipantTable.personId })
    .from(schema.requestParticipantTable)
    .where(eq(schema.requestParticipantTable.workItemId, workItemId));
}

export async function findNotificationPerson(
  tx: DbTransaction,
  personId: string,
) {
  const [person] = await tx
    .select({
      userId: schema.personTable.userId,
      side: schema.personTable.side,
      active: schema.personTable.active,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, personId))
    .limit(1);
  return person ?? null;
}

export async function findNotificationWorkspace(
  tx: DbTransaction,
  workspaceId: string,
) {
  const [workspace] = await tx
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .limit(1);
  return workspace ?? null;
}
