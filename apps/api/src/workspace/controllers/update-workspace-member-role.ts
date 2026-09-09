import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../../database";
import {
  anyRoleIsOwner,
  roleGrantsOwner,
  workspaceMemberRoles,
} from "../../utils/workspace-member-roles";
import {
  CannotChangeOwnerRoleHereError,
  MemberNotFoundError,
  OwnerRoleNotAssignableHereError,
  WorkspaceRoleNotFoundError,
} from "./workspace-membership-errors";
import { WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE } from "./workspace-membership-lock";

/**
 * Change a member's assigned role.
 *
 * Mirrors better-auth's own `updateMemberRole` (`crud-members.mjs`) with one
 * deliberate simplification: `workspace_member.role` is a single text value
 * here (`apps/api/src/database/schema.ts`), not the comma-separated role SET
 * better-auth supports, so the "am I allowed to touch the creator role"
 * logic that function carries collapses to two flat rules instead of four
 * combinations of "is the target the creator" x "is the actor the creator":
 *
 *  1. The new role may never be `"owner"` -- ownership is granted only by
 *     `transferWorkspaceOwnership`.
 *  2. The target's CURRENT role may never be `"owner"` -- not by anyone,
 *     including the owner acting on themselves. That second rule is what
 *     makes "an owner cannot self-demote" true unconditionally rather than
 *     only when they are the LAST owner: better-auth allows a creator to
 *     demote themselves once a second owner exists, but this route has no
 *     path that can ever produce a second owner (rule 1), so there being
 *     "another owner to hand off to first" can never happen here -- the
 *     atomic transfer endpoint always both installs the new owner AND
 *     demotes the old one in one transaction, so a bare demote of an owner
 *     never has anywhere legitimate to land.
 *
 * `role` must be an existing `workspace_role` row for this workspace, same
 * as `addWorkspaceMember` -- ROLE_NOT_FOUND semantics, not a free-text
 * write.
 *
 * Rule 2 is checked against EVERY row for the pair
 * (`workspaceMemberRoles`, `apps/api/src/utils/workspace-member-roles.ts`),
 * not a bare `.limit(1)` select -- `workspace_member` has no unique
 * constraint on `(workspace_id, user_id)`, so a duplicate-row owner could
 * otherwise have their owner-ness missed by an unordered read that returns
 * their OTHER, non-owner row, and this route would then silently demote
 * them. See that file's doc comment and
 * `workspace-membership-duplicate-rows.test.ts` (P3).
 */
async function updateWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  role: string,
): Promise<{ userId: string; role: string }> {
  // Comma-aware for the same reason as `add-workspace-member.ts`: `"owner,admin"`
  // grants owner and must not be assignable through this route either.
  if (roleGrantsOwner(role)) {
    throw new OwnerRoleNotAssignableHereError();
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE}, hashtext(${workspaceId}))`,
    );

    const targetRoles = await workspaceMemberRoles(tx, workspaceId, userId);
    if (targetRoles.length === 0) {
      throw new MemberNotFoundError();
    }
    if (anyRoleIsOwner(targetRoles)) {
      throw new CannotChangeOwnerRoleHereError();
    }

    const [roleRow] = await tx
      .select({ role: schema.workspaceRoleTable.role })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspaceId),
          eq(schema.workspaceRoleTable.role, role),
        ),
      )
      .limit(1);
    if (!roleRow) {
      throw new WorkspaceRoleNotFoundError(role);
    }

    await tx
      .update(schema.workspaceUserTable)
      .set({ role })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, userId),
        ),
      );

    return { userId, role };
  });
}

export default updateWorkspaceMemberRole;
