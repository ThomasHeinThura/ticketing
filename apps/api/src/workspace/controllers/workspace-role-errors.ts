/**
 * Shared error classes for S7's four native role controllers (issue #6, organization-plugin
 * retrofit S7 row). One file per the existing convention (`workspace-membership-errors.ts`),
 * since several of these are thrown from more than one controller and must be the SAME class
 * for a single `instanceof` check in `apps/api/src/workspace/index.ts` to catch every call
 * site.
 *
 * `WorkspaceRoleNotFoundError` is deliberately NOT redefined here — it already exists in
 * `workspace-membership-errors.ts` and is reused unchanged for the update/delete 404s. Its
 * message text names a `role` STRING (`Workspace has no role named "${role}"`), which reads a
 * little oddly when the identifier passed is actually an opaque `roleId`
 * (`Workspace has no role named "a1b2c3-uuid"`) rather than a human name — a known, accepted
 * cosmetic gap (S7 task list item 2), not a behavior change, and not worth widening that
 * class's constructor for the two other call sites that DO pass a real name.
 */

/**
 * `role` in the request body normalizes to a `BUILT_IN_ROLES` key -- `"owner"`, or (issue
 * #318, security) any of `admin`/`manager`/`lead`/`member`/`viewer`/`customer`/
 * `instance_admin`. The `"owner"` message is kept byte-for-byte what it was before #318, so
 * nothing that matched on it breaks; every other reserved name gets a message naming it.
 */
export class RoleNameReservedError extends Error {
  constructor(public readonly role: string = "owner") {
    super(
      role === "owner"
        ? 'The role name "owner" is reserved. Ownership is granted only by the ownership-transfer endpoint.'
        : `The role name "${role}" is reserved for a built-in role and cannot be used for a custom role.`,
    );
    this.name = "RoleNameReservedError";
  }
}

/** A `workspace_role` row already exists for this `(workspaceId, role)` pair. */
export class RoleNameTakenError extends Error {
  constructor(public readonly role: string) {
    super(`A role named "${role}" already exists in this workspace`);
    this.name = "RoleNameTakenError";
  }
}

/**
 * A key of the submitted `permission` object is not a resource `@taskdesk/permissions`'s
 * legacy `statement` recognizes (mirrors better-auth's own `checkForInvalidResources`).
 */
export class InvalidPermissionResourceError extends Error {
  constructor(public readonly resources: readonly string[]) {
    super(`Unknown permission resource(s): ${resources.join(", ")}`);
    this.name = "InvalidPermissionResourceError";
  }
}

/**
 * The caller is trying to grant a `(resource, action)` pair they do not themselves hold
 * (`RL-3`, S7 blueprint Finding F2 — mirrors better-auth's own `checkIfMemberHasPermission`).
 * `missingPermissions` names every offending pair as `"resource:action"`.
 */
export class InsufficientPermissionToGrantError extends Error {
  constructor(public readonly missingPermissions: readonly string[]) {
    super(
      `You cannot grant a permission you do not hold yourself: ${missingPermissions.join(", ")}`,
    );
    this.name = "InsufficientPermissionToGrantError";
  }
}

/** The workspace already holds `MAX_WORKSPACE_ROLES_PER_WORKSPACE` roles. */
export class RoleLimitReachedError extends Error {
  constructor(public readonly limit: number) {
    super(`This workspace already has the maximum of ${limit} roles`);
    this.name = "RoleLimitReachedError";
  }
}

/**
 * The role being deleted is still referenced by at least one `workspace_member.role` value
 * (comma-aware — see `delete-workspace-role.ts`'s own doc comment for the deliberate, narrow
 * exception to issue #82's "never comma-split" rule this check is).
 */
export class RoleAssignedToMembersError extends Error {
  constructor(public readonly role: string) {
    super(
      `Role "${role}" is still assigned to one or more members and cannot be deleted`,
    );
    this.name = "RoleAssignedToMembersError";
  }
}
