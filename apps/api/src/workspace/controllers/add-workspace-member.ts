import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../../database";
import { roleGrantsOwner } from "../../utils/workspace-member-roles";
import {
  OwnerRoleNotAssignableHereError,
  TargetUserNotFoundError,
  UserAlreadyMemberError,
  WorkspaceRoleNotFoundError,
} from "./workspace-membership-errors";
import { WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE } from "./workspace-membership-lock";

export type AddWorkspaceMemberInput = {
  workspaceId: string;
  userId: string;
  role: string;
};

export type AddedWorkspaceMember = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
};

/**
 * Add an EXISTING platform user directly to a workspace, by id.
 *
 * This has no inherited plugin equivalent to reproduce: better-auth's own
 * `addMember` (`crud-members.mjs`) is `createAuthEndpoint.serverOnly` --
 * never a public HTTP route -- and is reached only from the internals of
 * accept-invitation (S6a's, not this batch's). The S5 row of the retrofit
 * plan names `POST /api/workspace/{id}/members` explicitly, so this is new
 * surface, modelled on `addMember`'s own validation (user must exist, must
 * not already be a member) rather than on a byte-for-byte equivalence
 * obligation -- there is nothing to be equivalent TO.
 *
 * `role` must already be a `workspace_role` row for this workspace (the
 * seeded `viewer`/`member`/`admin`, or a custom role an admin created) --
 * same ROLE_NOT_FOUND semantics `tests/api-integration/
 * organization-plugin-characterization.test.ts` pins for role assignment
 * generally. `"owner"` is refused outright: ownership is granted only by
 * `transferWorkspaceOwnership`, atomically, so this route can never produce
 * a second owner.
 */
async function addWorkspaceMember(
  input: AddWorkspaceMemberInput,
): Promise<AddedWorkspaceMember> {
  // `roleGrantsOwner`, not `=== "owner"`: a comma-joined incoming value like
  // `"owner,admin"` also grants owner and must be refused here too. An exact
  // match let it through to the role-row lookup, which would accept it if a
  // role with that literal name existed -- and `create-role` only lowercases
  // names, so one is creatable. Issue #82 removes the value at its source.
  if (roleGrantsOwner(input.role)) {
    throw new OwnerRoleNotAssignableHereError();
  }

  return db.transaction(async (tx) => {
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

    const [user] = await tx
      .select({
        id: schema.userTable.id,
        name: schema.userTable.name,
        email: schema.userTable.email,
        image: schema.userTable.image,
      })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, input.userId))
      .limit(1);
    if (!user) {
      throw new TargetUserNotFoundError();
    }

    const [existing] = await tx
      .select({ userId: schema.workspaceUserTable.userId })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, input.workspaceId),
          eq(schema.workspaceUserTable.userId, input.userId),
        ),
      )
      .limit(1);
    if (existing) {
      throw new UserAlreadyMemberError();
    }

    await tx.insert(schema.workspaceUserTable).values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
      joinedAt: new Date(),
    });

    return { ...user, role: input.role };
  });
}

export default addWorkspaceMember;
