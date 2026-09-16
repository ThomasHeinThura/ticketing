/**
 * The maximum number of pending `invitation` rows a single workspace may hold (issue #6,
 * NB-1 in the organization-plugin retrofit ledger's S10 row -- the native ceiling that must
 * land BEFORE the plugin unmount, not after).
 *
 * WHY 100: the still-mounted `organization()` plugin has always enforced a real ceiling
 * here. `apps/api/src/auth.ts`'s `organization({...})` config never sets an
 * `invitationLimit`, so better-auth's own `crud-invites.mjs` has been running on ITS bare
 * default of 100 for as long as this app has existed -- never a deliberate choice, but a
 * real, currently-enforced number. This constant picks the SAME number, deliberately, so
 * that unmounting the plugin later (a separate, larger PR) does not silently loosen a limit
 * nobody ever actually chose to loosen.
 *
 * UNLIKE `MAX_WORKSPACE_ROLES_PER_WORKSPACE` (`workspace-role-limits.ts`), this is NOT a
 * "one number, two enforcers" situation. That constant is imported directly by the native
 * role controller specifically so the native ceiling and the plugin's configured
 * `dynamicAccessControl.maximumRolesPerOrganization` cannot silently drift apart -- both
 * call sites import the same identifier, so bumping one moves the other. Nothing here
 * imports FROM better-auth's default at runtime, and nothing meaningfully could:
 * `invitationLimit` is not a value this codebase configures or reads anywhere, it is just
 * the library's own hardcoded fallback baked into `crud-invites.mjs`. This constant is a
 * brand-new, NATIVE-ONLY enforcement point for a route
 * (`POST /api/workspace/{id}/invitations`) that has never had a ceiling of its own before
 * today. The two numbers are identical right now because 100 was chosen to match what has
 * always actually been enforced elsewhere -- they are not mechanically kept in sync the way
 * the role-limit constant is, and no code path would notice or care if a future change moved
 * one without the other. When the plugin unmounts, its cap disappears entirely; this one
 * keeps working exactly as it does today, on its own terms.
 */
export const MAX_PENDING_INVITATIONS_PER_WORKSPACE = 100;
