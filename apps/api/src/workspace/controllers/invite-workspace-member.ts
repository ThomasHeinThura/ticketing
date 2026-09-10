import { and, eq, gt, sql } from "drizzle-orm";
import db, { schema } from "../../database";
import { sendNativeWorkspaceInvitationEmail } from "../../utils/send-workspace-invitation-email";
import { roleGrantsOwner } from "../../utils/workspace-member-roles";
import { InvitationAlreadyPendingError } from "./workspace-invitation-errors";
import {
  OwnerRoleNotAssignableHereError,
  UserAlreadyMemberError,
  WorkspaceRoleNotFoundError,
} from "./workspace-membership-errors";
import { WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE } from "./workspace-membership-lock";

/** Matches better-auth's own default (`crud-invites.mjs`:
 * `getDate(ctx.context.orgOptions.invitationExpiresIn || 3600 * 48, "sec")`),
 * which `apps/api/src/auth.ts`'s `organization()` config never overrides. */
const INVITATION_EXPIRY_MS = 48 * 60 * 60 * 1000;

export type InviteWorkspaceMemberInput = {
  workspaceId: string;
  email: string;
  role: string;
  inviterId: string;
  resend?: boolean;
};

export type InvitedWorkspaceMember = {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  inviterId: string;
};

/**
 * Invite a user, by email, into a workspace. Native replacement for
 * `authClient.organization.inviteMember()` (retrofit plan §3, S6a row).
 *
 * Mirrors better-auth's own `createInvitation` (`crud-invites.mjs`) for the
 * shape this app's client actually exercises -- team assignment and the
 * per-organization invitation-count limit are NOT reproduced: no client call
 * site ever passed a `teamId`, and `apps/web`'s only caller
 * (`use-invite-workspace-user.ts`) has no equivalent for the count limit
 * either. Reproduced faithfully:
 *
 *  - `role` must already be a `workspace_role` row for this workspace, same
 *    ROLE_NOT_FOUND semantics as `addWorkspaceMember`. `"owner"` is refused
 *    outright, same reasoning as that controller: ownership only ever moves
 *    through `transferWorkspaceOwnership`.
 *  - a target email that already has a `workspace_member` row is refused
 *    (`UserAlreadyMemberError`, reused from S5 -- same meaning, discovered by
 *    email here instead of by user id).
 *  - a still-pending, unexpired invitation for the same `(workspaceId,
 *    email)` pair is refused UNLESS `resend` is set, in which case its
 *    expiry is refreshed and the email is re-sent rather than a second row
 *    being created.
 *
 * Takes the SAME advisory lock as every S5 membership write
 * (`WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE`), even though this controller never
 * writes `workspace_member` itself: the existing-member check below reads
 * that table, and taking the lock is what stops it racing a concurrent
 * `acceptInvitation` for the same email -- accept and this create would
 * otherwise be able to interleave their reads of `workspace_member` around
 * each other's writes.
 *
 * The email send happens AFTER the transaction commits, matching
 * `create-workspace.ts`'s own reasoning: nothing should be mailed for a
 * write that a rollback later undid.
 */
async function inviteWorkspaceMember(
  input: InviteWorkspaceMemberInput,
): Promise<InvitedWorkspaceMember> {
  const email = input.email.trim().toLowerCase();

  if (roleGrantsOwner(input.role)) {
    throw new OwnerRoleNotAssignableHereError();
  }

  const invitation = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE}, hashtext(${input.workspaceId}))`,
    );

    const [roleRow] = await tx
      .select({ role: schema.workspaceRoleTable.role })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, input.workspaceId),
          eq(schema.workspaceRoleTable.role, input.role),
        ),
      )
      .limit(1);
    if (!roleRow) {
      throw new WorkspaceRoleNotFoundError(input.role);
    }

    const [existingMember] = await tx
      .select({ userId: schema.workspaceUserTable.userId })
      .from(schema.workspaceUserTable)
      .innerJoin(
        schema.userTable,
        eq(schema.workspaceUserTable.userId, schema.userTable.id),
      )
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, input.workspaceId),
          eq(schema.userTable.email, email),
        ),
      )
      .limit(1);
    if (existingMember) {
      throw new UserAlreadyMemberError();
    }

    const now = new Date();
    const [existingInvitation] = await tx
      .select({ id: schema.invitationTable.id })
      .from(schema.invitationTable)
      .where(
        and(
          eq(schema.invitationTable.workspaceId, input.workspaceId),
          eq(schema.invitationTable.email, email),
          eq(schema.invitationTable.status, "pending"),
          gt(schema.invitationTable.expiresAt, now),
        ),
      )
      .limit(1);

    const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_MS);

    if (existingInvitation) {
      if (!input.resend) {
        throw new InvitationAlreadyPendingError();
      }
      const [updated] = await tx
        .update(schema.invitationTable)
        .set({ expiresAt, role: input.role })
        .where(eq(schema.invitationTable.id, existingInvitation.id))
        .returning();
      if (!updated) {
        throw new Error("invitation update returned no row");
      }
      return updated;
    }

    const [created] = await tx
      .insert(schema.invitationTable)
      .values({
        workspaceId: input.workspaceId,
        email,
        role: input.role,
        status: "pending",
        expiresAt,
        createdAt: now,
        inviterId: input.inviterId,
      })
      .returning();
    if (!created) {
      throw new Error("invitation insert returned no row");
    }
    return created;
  });

  const [workspace] = await db
    .select({ name: schema.workspaceTable.name })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, input.workspaceId))
    .limit(1);
  const [inviter] = await db
    .select({ name: schema.userTable.name, email: schema.userTable.email })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, input.inviterId))
    .limit(1);

  await sendNativeWorkspaceInvitationEmail({
    invitationId: invitation.id,
    email: invitation.email,
    workspaceName: workspace?.name ?? "",
    inviterName: inviter?.name ?? "",
    inviterEmail: inviter?.email ?? "",
  });

  return invitation;
}

export default inviteWorkspaceMember;
