import type { SQL } from "drizzle-orm";
import { and, eq, gt } from "drizzle-orm";
import db, { schema } from "../database";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function getInvitationWorkspace(
  executor: Executor,
  invitationId: string,
) {
  return executor
    .select({ workspaceId: schema.invitationTable.workspaceId })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
}

export function findValidInvitation(
  email: string | undefined,
  invitationId: string | undefined,
  now: Date,
) {
  const conditions: SQL[] = [
    eq(schema.invitationTable.status, "pending"),
    gt(schema.invitationTable.expiresAt, now),
  ];
  if (invitationId)
    conditions.push(eq(schema.invitationTable.id, invitationId));
  if (email)
    conditions.push(eq(schema.invitationTable.email, email.toLowerCase()));
  return db
    .select({
      id: schema.invitationTable.id,
      email: schema.invitationTable.email,
      workspaceId: schema.invitationTable.workspaceId,
      workspaceName: schema.workspaceTable.name,
      inviterName: schema.userTable.name,
      expiresAt: schema.invitationTable.expiresAt,
      status: schema.invitationTable.status,
    })
    .from(schema.invitationTable)
    .innerJoin(
      schema.workspaceTable,
      eq(schema.invitationTable.workspaceId, schema.workspaceTable.id),
    )
    .innerJoin(
      schema.userTable,
      eq(schema.invitationTable.inviterId, schema.userTable.id),
    )
    .where(and(...conditions))
    .limit(1);
}

export function getInvitationDetailsRow(invitationId: string) {
  return db
    .select({
      id: schema.invitationTable.id,
      email: schema.invitationTable.email,
      workspaceName: schema.workspaceTable.name,
      inviterName: schema.userTable.name,
      expiresAt: schema.invitationTable.expiresAt,
      status: schema.invitationTable.status,
    })
    .from(schema.invitationTable)
    .innerJoin(
      schema.workspaceTable,
      eq(schema.invitationTable.workspaceId, schema.workspaceTable.id),
    )
    .innerJoin(
      schema.userTable,
      eq(schema.invitationTable.inviterId, schema.userTable.id),
    )
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
}

export function listPendingInvitationsForEmail(userEmail: string, now: Date) {
  return db
    .select({
      id: schema.invitationTable.id,
      email: schema.invitationTable.email,
      workspaceId: schema.invitationTable.workspaceId,
      workspaceName: schema.workspaceTable.name,
      inviterName: schema.userTable.name,
      expiresAt: schema.invitationTable.expiresAt,
      createdAt: schema.invitationTable.createdAt,
      status: schema.invitationTable.status,
    })
    .from(schema.invitationTable)
    .innerJoin(
      schema.workspaceTable,
      eq(schema.invitationTable.workspaceId, schema.workspaceTable.id),
    )
    .innerJoin(
      schema.userTable,
      eq(schema.invitationTable.inviterId, schema.userTable.id),
    )
    .where(
      and(
        eq(schema.invitationTable.email, userEmail.toLowerCase()),
        eq(schema.invitationTable.status, "pending"),
        gt(schema.invitationTable.expiresAt, now),
      ),
    )
    .orderBy(schema.invitationTable.createdAt);
}

export function getInvitationForAcceptance(
  executor: Executor,
  invitationId: string,
) {
  return executor
    .select({
      id: schema.invitationTable.id,
      workspaceId: schema.invitationTable.workspaceId,
      email: schema.invitationTable.email,
      role: schema.invitationTable.role,
      status: schema.invitationTable.status,
      expiresAt: schema.invitationTable.expiresAt,
    })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
}

export function getWorkspaceMember(
  executor: Executor,
  workspaceId: string,
  userId: string,
) {
  return executor
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
}

export function getWorkspaceRoleId(
  executor: Executor,
  workspaceId: string,
  role: string,
) {
  return executor
    .select({ id: schema.workspaceRoleTable.id })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    )
    .limit(1);
}

export function getInvitationForCancellation(
  executor: Executor,
  invitationId: string,
) {
  return executor
    .select({
      id: schema.invitationTable.id,
      status: schema.invitationTable.status,
    })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
}

export function getInvitationForRejection(
  executor: Executor,
  invitationId: string,
) {
  return executor
    .select({
      id: schema.invitationTable.id,
      email: schema.invitationTable.email,
      status: schema.invitationTable.status,
    })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
}
