import db, { schema } from "../../database";
import { roleGrantsOwner } from "../../utils/workspace-member-roles";
import {
  getUserProfileQuery,
  getWorkspaceMemberQuery,
  getWorkspaceRoleQuery,
} from "../repository";
import {
  OwnerRoleNotAssignableHereError,
  TargetUserNotFoundError,
  UserAlreadyMemberError,
  WorkspaceRoleNotFoundError,
} from "./workspace-membership-errors";
import { lockWorkspaceRoleAssignment } from "./workspace-role-assignment-lock";

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
    await lockWorkspaceRoleAssignment(tx, input.workspaceId);

    const [roleRow] = await getWorkspaceRoleQuery(
      tx,
      input.workspaceId,
      input.role,
    );
    if (!roleRow) {
      throw new WorkspaceRoleNotFoundError(input.role);
    }

    const [user] = await getUserProfileQuery(tx, input.userId);
    if (!user) {
      throw new TargetUserNotFoundError();
    }

    const [existing] = await getWorkspaceMemberQuery(
      tx,
      input.workspaceId,
      input.userId,
    );
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
