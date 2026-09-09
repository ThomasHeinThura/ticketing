/**
 * Shared error classes for the S5 native membership-write controllers
 * (issue #6, retrofit plan §3, S5 row).
 *
 * One file rather than one-per-controller (contrast `WorkspaceSlugTakenError`,
 * which lives beside `createWorkspace` alone) because several of these are
 * thrown from more than one controller and must be the SAME class for a
 * single `instanceof` check in `apps/api/src/workspace/index.ts` to catch
 * both call sites.
 */

/** The target `role` string is not a row in this workspace's `workspace_role` table. */
export class WorkspaceRoleNotFoundError extends Error {
  constructor(public readonly role: string) {
    super(`Workspace has no role named "${role}"`);
    this.name = "WorkspaceRoleNotFoundError";
  }
}

/**
 * `role` in the request body was `"owner"`.
 *
 * Ownership is never granted or revoked through the generic add/update-role
 * routes -- it moves exclusively through `transferWorkspaceOwnership`, which
 * is atomic (assigns the new owner and demotes the old one in the same
 * transaction) and is the only path that can ever produce or remove an
 * `owner` row. Retrofit plan S5 row: "the client fakes [ownership transfer]
 * with a promote/demote pair … which should collapse into one atomic
 * transfer endpoint" -- this error is what forces every caller onto that
 * endpoint instead of reintroducing the two-call race the plan calls out.
 */
export class OwnerRoleNotAssignableHereError extends Error {
  constructor() {
    super(
      "The owner role cannot be granted or changed here. Use the ownership-transfer endpoint.",
    );
    this.name = "OwnerRoleNotAssignableHereError";
  }
}

/**
 * The target member's CURRENT role is `"owner"`.
 *
 * Thrown by `updateWorkspaceMemberRole` regardless of who is asking --
 * including the owner acting on themselves. That is deliberate: it is what
 * makes "an owner cannot self-demote" true by construction rather than by a
 * count check that could race. The only way to stop being the owner is the
 * atomic transfer, which always leaves the workspace with exactly one
 * owner.
 */
export class CannotChangeOwnerRoleHereError extends Error {
  constructor() {
    super(
      "The workspace owner's role cannot be changed here. Use the ownership-transfer endpoint.",
    );
    this.name = "CannotChangeOwnerRoleHereError";
  }
}

/** No `workspace_member` row for this `(workspaceId, userId)` pair. */
export class MemberNotFoundError extends Error {
  constructor() {
    super("Member not found");
    this.name = "MemberNotFoundError";
  }
}

/** The target user already has a `workspace_member` row for this workspace. */
export class UserAlreadyMemberError extends Error {
  constructor() {
    super("User is already a member of this workspace");
    this.name = "UserAlreadyMemberError";
  }
}

/** `userId` in the request body names no row in `user`. */
export class TargetUserNotFoundError extends Error {
  constructor() {
    super("User not found");
    this.name = "TargetUserNotFoundError";
  }
}

/**
 * Removing or leaving would take the workspace's owner count to zero.
 *
 * Mirrors better-auth's own `leaveOrganization` / `removeMember` guard
 * (`YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER`), re-expressed
 * server-side per the S5 row, and counted inside the same transaction as the
 * write under an advisory lock (`workspace-membership-lock.ts`) rather than
 * from a count read before it -- see that file for why.
 */
export class LastOwnerCannotLeaveError extends Error {
  constructor() {
    super("The workspace's only owner cannot leave or be removed");
    this.name = "LastOwnerCannotLeaveError";
  }
}

/** `POST .../leave` or `POST .../transfer-ownership` called by a non-member. */
export class NotAMemberError extends Error {
  constructor() {
    super("You are not a member of this workspace");
    this.name = "NotAMemberError";
  }
}

/** `POST .../transfer-ownership` called by someone other than the current owner. */
export class CallerNotOwnerError extends Error {
  constructor() {
    super("Only the current owner can transfer ownership");
    this.name = "CallerNotOwnerError";
  }
}

/** `newOwnerUserId` is not an existing `workspace_member` of this workspace. */
export class NewOwnerNotAMemberError extends Error {
  constructor() {
    super("The new owner must already be a member of this workspace");
    this.name = "NewOwnerNotAMemberError";
  }
}

/** `newOwnerUserId` is the caller themselves. */
export class AlreadyOwnerError extends Error {
  constructor() {
    super("That user is already the owner");
    this.name = "AlreadyOwnerError";
  }
}
