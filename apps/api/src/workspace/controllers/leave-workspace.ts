import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../../database";
import {
  anyRoleIsOwner,
  distinctOwnerUserCount,
  workspaceMemberRoles,
} from "../../utils/workspace-member-roles";
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
 *
 * The caller's role is read via `workspaceMemberRoles`
 * (`apps/api/src/utils/workspace-member-roles.ts`), not a bare `.limit(1)`
 * select, for the same duplicate-row reason documented on
 * `remove-workspace-member.ts` and that file.
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

    const membershipRoles = await workspaceMemberRoles(tx, workspaceId, userId);
    if (membershipRoles.length === 0) {
      throw new NotAMemberError();
    }

    if (anyRoleIsOwner(membershipRoles)) {
      // DISTINCT USERS, not rows. Counting rows let a single owner user with
      // two `"owner"` rows read as "two owners", so this guard passed and the
      // delete below -- which matches `(workspaceId, userId)` and therefore
      // removes EVERY row for the pair -- left the workspace with zero owners.
      // Found by the independent security review of this pull request.
      if ((await distinctOwnerUserCount(tx, workspaceId)) <= 1) {
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
