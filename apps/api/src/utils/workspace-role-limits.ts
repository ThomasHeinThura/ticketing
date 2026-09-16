/**
 * The maximum number of `workspace_role` rows a single workspace may hold (issue #6, retrofit
 * plan S7 row, S7 blueprint Finding F3).
 *
 * ONE NUMBER, TWO ENFORCERS UNTIL S10. The still-mounted `organization()` plugin enforces this
 * via `dynamicAccessControl.maximumRolesPerOrganization` (`apps/api/src/auth.ts`); the native
 * `createWorkspaceRole` controller enforces the identical ceiling by importing THIS constant,
 * so there is exactly one `25` in the codebase rather than two literals that can silently
 * drift apart — the failure mode Finding F3 names: an implementer bumps one and forgets the
 * other, and an admin discovers the inconsistency by hitting a limit on one path that the
 * other path does not enforce.
 *
 * Both enforcement points close at S10, when the plugin unmounts — this constant is not
 * deleted then, since the native route's own ceiling stays.
 */
export const MAX_WORKSPACE_ROLES_PER_WORKSPACE = 25;
