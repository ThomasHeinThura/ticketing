import { and, eq, gt } from "drizzle-orm";
import db from "../database";
import { invitationTable, userTable, workspaceTable } from "../database/schema";

/**
 * Query ownership for registration and invitation lookups (issue #580), moved verbatim from
 * `check-registration-allowed.ts`. Every function awaits and returns rows.
 */

/** A pending, unexpired invitation matching the id and/or (lower-cased) email, or `undefined`. */
export async function findPendingInvitation(params: {
  email?: string | undefined;
  invitationId?: string | undefined;
  now: Date;
}) {
  const { email, invitationId, now } = params;
  const conditions = [
    eq(invitationTable.status, "pending"),
    gt(invitationTable.expiresAt, now),
  ];

  if (invitationId) {
    conditions.push(eq(invitationTable.id, invitationId));
  }

  if (email) {
    conditions.push(eq(invitationTable.email, email.toLowerCase()));
  }

  const result = await db
    .select({
      id: invitationTable.id,
      email: invitationTable.email,
      workspaceId: invitationTable.workspaceId,
      workspaceName: workspaceTable.name,
      inviterName: userTable.name,
      expiresAt: invitationTable.expiresAt,
      status: invitationTable.status,
    })
    .from(invitationTable)
    .innerJoin(
      workspaceTable,
      eq(invitationTable.workspaceId, workspaceTable.id),
    )
    .innerJoin(userTable, eq(invitationTable.inviterId, userTable.id))
    .where(and(...conditions))
    .limit(1);

  return result[0];
}

/** An invitation by id with its workspace and inviter names, or `undefined`. */
export async function findInvitationWithNames(invitationId: string) {
  const result = await db
    .select({
      id: invitationTable.id,
      email: invitationTable.email,
      workspaceName: workspaceTable.name,
      inviterName: userTable.name,
      expiresAt: invitationTable.expiresAt,
      status: invitationTable.status,
    })
    .from(invitationTable)
    .innerJoin(
      workspaceTable,
      eq(invitationTable.workspaceId, workspaceTable.id),
    )
    .innerJoin(userTable, eq(invitationTable.inviterId, userTable.id))
    .where(eq(invitationTable.id, invitationId))
    .limit(1);
  return result[0];
}

/** Pending, unexpired invitations addressed to the (lower-cased) email, oldest first. */
export async function listPendingInvitationsForEmail(
  userEmail: string,
  now: Date,
) {
  return db
    .select({
      id: invitationTable.id,
      email: invitationTable.email,
      workspaceId: invitationTable.workspaceId,
      workspaceName: workspaceTable.name,
      inviterName: userTable.name,
      expiresAt: invitationTable.expiresAt,
      createdAt: invitationTable.createdAt,
      status: invitationTable.status,
    })
    .from(invitationTable)
    .innerJoin(
      workspaceTable,
      eq(invitationTable.workspaceId, workspaceTable.id),
    )
    .innerJoin(userTable, eq(invitationTable.inviterId, userTable.id))
    .where(
      and(
        eq(invitationTable.email, userEmail.toLowerCase()),
        eq(invitationTable.status, "pending"),
        gt(invitationTable.expiresAt, now),
      ),
    )
    .orderBy(invitationTable.createdAt);
}
