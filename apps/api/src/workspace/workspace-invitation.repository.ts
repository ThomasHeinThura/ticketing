import { and, count, eq, gt } from "drizzle-orm";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";

/** The workspace role named by a manager invitation, scoped to that workspace. */
export async function findWorkspaceInvitationRole(
  executor: Executor,
  workspaceId: string,
  role: string,
) {
  // Canonical role rows (owner decision, 23 Oct): a role name is valid when this workspace has a
  // workspace-scope `role` row with that key.
  return await executor
    .select({ role: schema.roleTable.key })
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "workspace"),
        eq(schema.roleTable.workspaceId, workspaceId),
        eq(schema.roleTable.key, role),
      ),
    )
    .limit(1);
}

/** Existing workspace member with the invitation email, if present. */
export async function findExistingWorkspaceMemberByEmail(
  executor: Executor,
  workspaceId: string,
  email: string,
) {
  return await executor
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .innerJoin(
      schema.userTable,
      eq(schema.workspaceUserTable.userId, schema.userTable.id),
    )
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.userTable.email, email),
      ),
    )
    .limit(1);
}

/** A pending, unexpired invitation for the same workspace and normalized email. */
export async function findPendingWorkspaceInvitation(
  executor: Executor,
  workspaceId: string,
  email: string,
  now: Date,
) {
  return await executor
    .select({ id: schema.invitationTable.id })
    .from(schema.invitationTable)
    .where(
      and(
        eq(schema.invitationTable.workspaceId, workspaceId),
        eq(schema.invitationTable.scope, "staff"),
        eq(schema.invitationTable.email, email),
        eq(schema.invitationTable.status, "pending"),
        gt(schema.invitationTable.expiresAt, now),
      ),
    )
    .limit(1);
}

/** Count every pending invitation for the workspace, including expired rows. */
export async function countPendingWorkspaceInvitations(
  executor: Executor,
  workspaceId: string,
) {
  return await executor
    .select({ value: count() })
    .from(schema.invitationTable)
    .where(
      and(
        eq(schema.invitationTable.workspaceId, workspaceId),
        eq(schema.invitationTable.scope, "staff"),
        eq(schema.invitationTable.status, "pending"),
      ),
    );
}

/** Refresh a resendable invitation and return the original full returning row. */
export async function refreshWorkspaceInvitation(
  executor: Executor,
  invitationId: string,
  expiresAt: Date,
  role: string,
) {
  return await executor
    .update(schema.invitationTable)
    .set({ expiresAt, role })
    .where(eq(schema.invitationTable.id, invitationId))
    .returning();
}

/** Insert a new pending invitation and return the original full returning row. */
export async function insertWorkspaceInvitation(
  executor: Executor,
  values: typeof schema.invitationTable.$inferInsert,
) {
  return await executor
    .insert(schema.invitationTable)
    .values(values)
    .returning();
}

/** Workspace name used to render the post-commit invitation email. */
export async function findWorkspaceInvitationWorkspace(workspaceId: string) {
  return await db
    .select({ name: schema.workspaceTable.name })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .limit(1);
}

/** Inviter details used to render the post-commit invitation email. */
export async function findWorkspaceInvitationInviter(inviterId: string) {
  return await db
    .select({ name: schema.userTable.name, email: schema.userTable.email })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, inviterId))
    .limit(1);
}
