/**
 * The advisory-lock namespace `set-work-item-parent.ts` takes, keyed on `project_id`.
 *
 * Distinct from every other namespace already in use in this codebase:
 * `apps/api/src/project/controllers/create-project.ts` / `reorder-projects.ts` use
 * `1524`, `auth.ts`'s migration lock uses `2026`,
 * `workspace-membership-lock.ts`/`workspace-role-lock.ts`/`column-migration.ts`/
 * `label-name-lock.ts`/`audit/lock.ts`/`ensure-application-role.ts` use
 * `4_002`/`4_003`/`4_004`/`4_007`/`4_010`/`4_011`.
 *
 * THE RACE THIS CLOSES (Opus security review of PR #432, finding F1, reproduced live).
 * `set-work-item-parent.ts` reads a proposed parent's ancestor chain and the item's own
 * descendant depth, then decides via `@taskdesk/domain`'s `validateReparent`, BEFORE
 * issuing its `UPDATE` -- a plain, unlocked read-then-write. Two concurrent reparents
 * within the SAME project can each read a snapshot that individually looks safe and
 * still jointly violate `RH-7`'s depth-5 cap: move X under P (holds its transaction open
 * before commit); concurrently, move Y under Z where Z is (about to become, via X's
 * not-yet-committed move) a descendant of P through X -- the second transaction's read of
 * X's ancestor chain does not see X's uncommitted `parent_id` change, so it also looks
 * individually valid, and both commit, producing a depth past the cap that neither
 * transaction's own check would have permitted alone. The DB trigger (migration 0056)
 * only rejects CYCLES, never depth (its own migration comment says so explicitly), so it
 * does not catch this.
 *
 * Same fix shape as `workspace-membership-lock.ts`'s own race (two concurrent
 * `transferWorkspaceOwnership` calls): a workspace/project-scoped
 * `pg_advisory_xact_lock`, taken as the FIRST statement inside the transaction, so every
 * reparent within the SAME project is fully serialized against every other one. Whoever
 * gets there first holds it for the rest of that transaction; every other reparent for
 * the SAME project blocks until it commits or rolls back, then re-reads current state --
 * closing the depth race, and removing the cycle-detection TOCTOU window entirely (the DB
 * trigger remains the race-free backstop for cycles regardless, unchanged by this).
 * Different projects never contend with each other.
 *
 * Scoped by `project_id`, not `workspace_id` -- `RH-6`'s composite self-FK on
 * `work_item.parent_id` (`schema.ts`) guarantees a whole hierarchy tree lives within one
 * project, and the depth race above is only ever reachable between reparents that share a
 * project (two reparents in different projects can never interact through the same
 * ancestor/descendant chain). Locking at the workspace level would serialize every
 * project's reparents against every other project's in the same workspace for no reason.
 *
 * Used as
 * `sql\`SELECT pg_advisory_xact_lock(${WORK_ITEM_HIERARCHY_LOCK_NAMESPACE}, hashtext(${projectId}))\``
 * -- not wrapped in a shared function, matching how every other advisory-lock call site
 * in this codebase calls `pg_advisory_xact_lock` inline (`workspace-membership-lock.ts`'s
 * own doc comment: no exported `Transaction` type to usefully type a shared wrapper
 * against).
 */
export const WORK_ITEM_HIERARCHY_LOCK_NAMESPACE = 4_012;
