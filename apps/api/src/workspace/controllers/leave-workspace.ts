import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../../database";
import {
  LastOwnerCannotLeaveError,
  NotAMemberError,
} from "./workspace-membership-errors";
import { WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE } from "./workspace-membership-lock";

/**
 * A member leaves a workspace of their own accord.
 *
 * Mirrors better-auth's own `leaveOrganization` (`crud-members.mjs`): the
 * only rule is "the workspace's only owner cannot leave", counted inside the
 * SAME transaction as the delete, under `lockWorkspaceMembership`'s advisory
 * lock, so it cannot race (see that file's module comment for the general
 * argument and `remove-workspace-member.ts` for the sibling route sharing
 * the exact same count).
 *
 * No capability check: leaving is a self-action every member has, including
 * a `viewer`. `apps/api/src/workspace/index.ts` gates this route on
 * `requireWorkspaceMembership` alone -- no `requireWorkspacePermission` call
 * -- for that reason.
 *
 * Clears the CALLING session's `active_organization_id`/`active_team_id`
 * when either pointed at this workspace, same scope as `deleteWorkspace`
 * (the caller and the affected user are the same person here, unlike
 * `removeWorkspaceMember`, which clears every session of the removed user).
 */
async function leaveWorkspace(
  workspaceId: string,
  userId: string,
  sessionId: string,
): Promise<{ workspaceId: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE}, hashtext(${workspaceId}))`,
    );

    const [membership] = await tx
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, userId),
        ),
      )
      .limit(1);
    if (!membership) {
      throw new NotAMemberError();
    }

    if (membership.role === "owner") {
      const owners = await tx
        .select({ userId: schema.workspaceUserTable.userId })
        .from(schema.workspaceUserTable)
        .where(
          and(
            eq(schema.workspaceUserTable.workspaceId, workspaceId),
            eq(schema.workspaceUserTable.role, "owner"),
          ),
        );
      if (owners.length <= 1) {
        throw new LastOwnerCannotLeaveError();
      }
    }

    await tx
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, userId),
        ),
      );

    await tx
      .update(schema.sessionTable)
      .set({ activeOrganizationId: null, activeTeamId: null })
      .where(
        and(
          eq(schema.sessionTable.id, sessionId),
          eq(schema.sessionTable.activeOrganizationId, workspaceId),
        ),
      );

    return { workspaceId };
  });
}

export default leaveWorkspace;
