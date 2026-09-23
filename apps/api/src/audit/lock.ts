/**
 * The advisory-lock key that serialises every `audit_log` insert.
 *
 * Distinct from every other namespace already in use: `apps/api/src/project/controllers/
 * create-project.ts` / `reorder-projects.ts` use `1524`, `auth.ts`'s migration lock uses
 * `2026`, `workspace-membership-lock.ts` uses `4_002`, `workspace-role-lock.ts` uses
 * `4_003`, and `apps/api/src/migrations/column-migration.ts` uses `4_004`.
 *
 * `data-model.md`'s "The audit hash chain": "Every `audit_log` insert takes
 * `pg_advisory_xact_lock(<audit chain constant>)` first, in the same transaction as the
 * insert, then reads the current head's `row_hash` and writes its own row ... the chain
 * is per-instance and strictly serial" — a SINGLE global key, not one namespaced per
 * workspace/project the way the locks above are (`pg_advisory_xact_lock(key)`, the
 * one-argument form, matching `auth.ts`'s `pg_advisory_xact_lock(2026)`) — because the
 * chain itself is one sequence for the whole instance, not one per tenant.
 *
 * Used as `sql\`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})\`` — not wrapped in
 * a shared helper, matching every other advisory-lock call site in this codebase.
 */
export const AUDIT_CHAIN_LOCK_KEY = 4_010;
