import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../../database";
import { WorkspaceRoleNotFoundError } from "./workspace-membership-errors";
import {
  RoleAssignedToMembersError,
  RoleNameReservedError,
} from "./workspace-role-errors";
import { WORKSPACE_ROLE_LOCK_NAMESPACE } from "./workspace-role-lock";

export type DeletedWorkspaceRole = { id: string; role: string };

/**
 * Is `roleName` currently referenced by any of these `workspace_member.role` values?
 *
 * **A DELIBERATE, NARROW EXCEPTION TO ISSUE #82's "NEVER COMMA-SPLIT" RULE — Thomas's
 * decision, S7 blueprint Ambiguity Q2.** Comma-aware, matching better-auth's own
 * `deleteOrgRole` guard byte-for-byte (S7 blueprint §0): a member's stored role value is
 * split on `,`, each piece trimmed and lower-cased, and the target role name is refused if it
 * appears in ANY piece of ANY member's value.
 *
 * Every OTHER authorization read in this codebase (`resolveMembershipRole` and everything
 * built on it) must keep refusing to interpret a malformed multi-role value — issue #82 says
 * so in as many words, with no carve-out. This check is the one narrow, explicitly-approved
 * exception, and the reason it is safe where the general rule is not: this check only ever
 * BLOCKS a deletion (fails conservatively, toward keeping a role that might not really still
 * be needed) rather than GRANTS a permission. Comma-splitting to decide "may this caller act"
 * is a privilege-widening interpretation of an invalid value; comma-splitting to decide "is
 * this row still referenced, so I should refuse to delete it" is the opposite — it can only
 * ever make the guard MORE conservative than an exact-match read would, never less. That
 * asymmetry is exactly what makes this the one place preserving inherited behavior exactly
 * and never-comma-split do not actually conflict. This must never be copied elsewhere without
 * a fresh decision — it is scoped to this one check, not a precedent for evaluating what a
 * member may do.
 *
 * EXPORTED FOR A UNIT TEST, NOT AN INTEGRATION ONE, AND THAT IS DELIBERATE.
 * `workspace_member_role_single_value` (migration `0050`, issue #82) is a CHECK constraint
 * that refuses a comma-joined `workspace_member.role` value at the DATABASE level, for every
 * write, including a raw SQL one from a test fixture (confirmed directly:
 * `multi-role-membership-characterization.test.ts`'s own "the CHECK constraint ... is the
 * backstop" case). So the state this function exists to handle safely is not reproducible
 * through any live write path in an integration test today — exactly the same situation
 * `workspace-member-roles.ts` already documents for `roleGrantsOwner`/`anyRoleIsOwner`. What
 * IS testable, and tested here (`tests/api/workspace/delete-workspace-role.test.ts`), is the
 * pure matching predicate itself: given a comma-joined value (however it got there — a row
 * that predates migration `0050`, or a future migration that has to lift the constraint),
 * does this function correctly refuse a delete an exact-match reader would have wrongly
 * allowed?
 */
export function roleIsReferencedBy(
  memberRoleValues: readonly string[],
  roleName: string,
): boolean {
  const target = roleName.trim().toLowerCase();
  return memberRoleValues.some((value) =>
    value
      .split(",")
      .map((piece) => piece.trim().toLowerCase())
      .includes(target),
  );
}

/**
 * Delete a custom role. Native replacement for `authClient.organization.deleteRole()`.
 *
 * Refuses `"owner"` (defensive — see the comment below) and refuses a role still assigned to
 * any member, both under the same advisory lock create/update use, so a concurrent add of a
 * member into this exact role cannot race the delete.
 */
async function deleteWorkspaceRole(
  workspaceId: string,
  roleId: string,
): Promise<DeletedWorkspaceRole> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${WORKSPACE_ROLE_LOCK_NAMESPACE}, hashtext(${workspaceId}))`,
    );

    const [existing] = await tx
      .select()
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspaceId),
          eq(schema.workspaceRoleTable.id, roleId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new WorkspaceRoleNotFoundError(roleId);
    }
    // Defensive only — see update-workspace-role.ts's identical comment: `owner` is never a
    // DB row, so this can never be reached through any known write path today.
    if (existing.role === "owner") {
      throw new RoleNameReservedError();
    }

    const memberRows = await tx
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));

    if (
      roleIsReferencedBy(
        memberRows.map((row) => row.role),
        existing.role,
      )
    ) {
      throw new RoleAssignedToMembersError(existing.role);
    }

    await tx
      .delete(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.id, roleId));

    return { id: existing.id, role: existing.role };
  });
}

export default deleteWorkspaceRole;
