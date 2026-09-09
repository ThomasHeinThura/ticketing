/**
 * The advisory-lock namespace shared by every S5 membership-mutating
 * transaction: add, remove, role-update, leave, and ownership-transfer
 * (issue #6, retrofit plan §3, S5 row).
 *
 * Distinct from the namespaces already in use --
 * `apps/api/src/project/controllers/create-project.ts` /
 * `reorder-projects.ts` use `1524`, and the migration lock in `auth.ts` uses
 * `2026`.
 *
 * THE RACE THIS CLOSES. `workspace_member` has no unique constraint on
 * `(workspace_id, user_id)` (`apps/api/src/database/schema.ts`) and this
 * batch adds no migration (S5 row: "No migration"), so a duplicate-member
 * guard and an owner-count guard can only be enforced by a read-then-write
 * inside the controller -- and a read-then-write with no lock is exactly the
 * shape of race the quality bar for this repository calls out: "count in the
 * database, inside the same transaction as the write, or the check races."
 *
 * Two owner-count races this makes impossible:
 *  - two concurrent `leave`/`remove` calls each reading "2 owners, safe to
 *    proceed" before either commits its delete, landing on zero;
 *  - two concurrent `transferWorkspaceOwnership` calls from the SAME owner,
 *    each reading "I am still the owner" before either commits its demote,
 *    producing two owners (or, combined with a third caller, zero).
 *
 * `pg_advisory_xact_lock` is used rather than `SELECT ... FOR UPDATE` on the
 * owner rows because `addWorkspaceMember`'s race has no existing row to lock
 * -- the target user is not a member yet, so there is nothing to
 * `FOR UPDATE` against. A workspace-scoped advisory lock covers both shapes
 * uniformly: every controller below takes this lock, keyed on `workspaceId`,
 * as the FIRST statement inside its transaction. Whoever gets there first
 * holds it for the rest of that transaction; every other membership write
 * for the SAME workspace blocks until it commits or rolls back, then
 * re-reads current state rather than the state it started with. Different
 * workspaces never contend with each other.
 *
 * Used as `sql\`SELECT pg_advisory_xact_lock(${WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE}, hashtext(${workspaceId}))\``
 * -- not wrapped in a shared function, matching how `create-project.ts` and
 * `reorder-projects.ts` each call `pg_advisory_xact_lock` inline: `tx`'s type
 * is whatever `db.transaction`'s callback parameter infers to, and there is
 * no exported `Transaction` alias in `apps/api/src/database` to type a
 * shared wrapper against.
 */
export const WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE = 4_002;
