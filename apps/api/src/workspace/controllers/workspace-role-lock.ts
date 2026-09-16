/**
 * The advisory-lock namespace for `workspace_role` check-then-write races (issue #118,
 * organization-plugin retrofit S7 row).
 *
 * Distinct from the namespaces already in use: `apps/api/src/project/controllers/
 * create-project.ts` / `reorder-projects.ts` use `1524`, `auth.ts`'s migration lock uses
 * `2026`, and `workspace-membership-lock.ts` uses `4_002`
 * (`WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE`).
 *
 * THE RACE THIS CLOSES. `workspace_role` now carries `UNIQUE (workspace_id, role)`
 * (migration `0051_workspace_role_unique.sql`, issue #118), so a duplicate-name INSERT
 * eventually fails at the database — but a raw `23505` constraint-violation error is a
 * confusing unhandled 500 for a caller who submitted an ordinary, foreseeable "that name is
 * taken" request, and the 25-role ceiling and the "you cannot grant what you do not hold"
 * checks (S7 blueprint Findings F2/F3) have no unique-constraint backstop at all — they are
 * pure check-then-write. This lock, taken as the FIRST statement inside every mutating
 * transaction (create/update/delete), serializes all three per workspace so every check a
 * controller performs is answered against a state nothing else in this process can change out
 * from under it, and the loser of a concurrent duplicate-name race gets a clean, expected
 * `RoleNameTakenError` (409) rather than a raw driver error.
 *
 * Does NOT close the race against the still-mounted plugin's OWN `create-role`/`update-role`/
 * `delete-role` routes, which take no lock at all — exactly the same "among native callers
 * only" qualifier `workspace-membership-lock.ts` documents for `workspace_member`. That
 * residual gap closes at S10 (plugin unmount), not here.
 *
 * Used as
 * `sql\`SELECT pg_advisory_xact_lock(${WORKSPACE_ROLE_LOCK_NAMESPACE}, hashtext(${workspaceId}))\``
 * — not wrapped in a shared function, matching every other advisory-lock call site in this
 * codebase.
 */
export const WORKSPACE_ROLE_LOCK_NAMESPACE = 4_003;
