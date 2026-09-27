# Pre-merge security review — PR #405 (track `workspace_role_workspace_id_role_unique` in Drizzle, #251)

**Reviewed head:** `5af59960244049374355d7d85ade1e41a4d80ed4`

**Verdict: CLEAR.** No HIGH, no MEDIUM, no LOW defect in the change. Three informational
notes, all pre-existing on `main` and none introduced or worsened here.

**Status of the gate:** this review ran **before** merge and closes the mandatory independent
Opus security review for the head named above, **and for that head only.** A later commit
touching anything outside `docs/07-planning/security-reviews/` (including a merge of `main`)
voids it and needs a fresh delta review. No waiver was sought or used; none is authorized.

**Reviewer independence.** A fresh, review-only Opus 5.5 subagent context. It authored,
directed and remediated no part of the change. The PR body's "Implemented by" session id is
the orchestrating top-level session's id, which this subagent also runs under; the
implementing Sonnet lane was a separate subagent context. This reviewer made no edit to the
change, checked the exact head out into its own detached worktree (never the shared
checkout), and its only commit is this note.

**Scope.** `git diff origin/main...HEAD --stat` at merge base `ed2507236c52305c71325f72cd7f727b4f603172`:
`apps/api/src/database/schema.ts` (+11), `apps/api/drizzle/meta/0070_snapshot.json` (+7/−1),
`tests/api/database/workspace-role-unique-schema-drift.test.ts` (+92, new). No `.sql`
migration and no `_journal.json` change. `schema.ts` is in `ci-cd.md`'s security scope
(`apps/api/src/database/**`), which is why this pass is required.

---

## What was established, by measurement

| Question | Evidence |
| --- | --- |
| **1. Does editing an already-applied migration's snapshot touch applied DB state?** **No.** | Read from the installed code, not the docs. `drizzle-orm@0.45.2` `migrator.js` `readMigrationFiles()` reads only `meta/_journal.json` and each `<tag>.sql`; the stored `__drizzle_migrations.hash` is `sha256` of the **SQL file text** only; ordering is by the journal's `when`. The word `snapshot` does not occur in the migrator. `drizzle-kit migrate` (v0.31.10) delegates to those same `drizzle-orm/*/migrator` modules. The app's own boot path (`apps/api/src/index.ts:1070`) is `drizzle-orm/node-postgres/migrator`'s `migrate()`. So no already-applied environment re-runs, re-hashes or skips anything because of this PR. Snapshots are consumed only by `drizzle-kit generate` (diff baseline = latest snapshot) and `drizzle-kit check` (snapshot-chain consistency). `drizzle-kit push` introspects the live DB and ignores snapshots; it is not wired into any package script |
| **2. Is the declaration identical to `0051`'s real SQL?** **Yes.** | `0051_workspace_role_unique.sql:116-118`: `ALTER TABLE "workspace_role" ADD CONSTRAINT "workspace_role_workspace_id_role_unique" UNIQUE ("workspace_id", "role");`. `schema.ts`: `unique("workspace_role_workspace_id_role_unique").on(table.workspaceId, table.role)` → columns `workspace_id`, `role`, same order, plain `UNIQUE`, `nullsNotDistinct: false` (Postgres default; moot anyway, both columns are `NOT NULL`). Strongest check: PR `schema.ts` against **main's unpatched** `0070_snapshot.json` makes `drizzle-kit generate` emit exactly `ALTER TABLE "workspace_role" ADD CONSTRAINT "workspace_role_workspace_id_role_unique" UNIQUE("workspace_id","role");`, i.e. Drizzle's own rendering of the declaration is `0051`'s DDL. After migrating a fresh private DB through `0071`, `pg_get_constraintdef` returns `workspace_role_workspace_id_role_unique \| u \| UNIQUE (workspace_id, role)` |
| **3. `drizzle-kit generate` at the head** | Run by this reviewer on a scratch copy of `apps/api/drizzle/` with the real `schema.ts`: **"No schema changes, nothing to migrate"**, and `diff -r` of the scratch copy against the tree is empty afterwards. `drizzle-kit check`: **"Everything's fine"**. Both negative controls fire: PR schema plus main snapshot → `ADD CONSTRAINT` (above); main schema plus PR snapshot → `ALTER TABLE "workspace_role" DROP CONSTRAINT "workspace_role_workspace_id_role_unique";`. So the new test's no-op assertion is not vacuous: removing or changing the declaration fails it. `0070` is the latest snapshot (`0071` is data-only and has none), and `main` has not touched `apps/api/drizzle/**` or `apps/api/src/database/**` since the merge base, so the zero diff also holds against current `origin/main` (`ee5d4fae113abfc60daf18f3e038e9adab2b3cbb`). The branch merges cleanly into it |
| **4. Does #134's `onConflictDoNothing` still resolve, and did any other query change?** **Yes / No.** | `seed-default-workspace-roles.ts:140-149` targets **columns** `[workspaceId, role]`. Drizzle renders that as `on conflict ("workspace_id","role") do nothing`, and Postgres picks the arbiter index from that column set. It does not depend on Drizzle knowing the constraint's name, so the seed was already correct at runtime; what was missing was drift detection. `tsx` rendering of `insert … onConflictDoNothing`, `select`, and `update` on `workspaceRoleTable` is **byte-identical** between main's `schema.ts` and the PR's. Drizzle's query builder does not read a table's extra-config `unique()` entries, and nothing in `apps/` or `packages/` calls `getTableConfig`. Private DB `opus405_test` (dropped afterwards): `concurrent-startup-seed-race`, `workspace-role-uniqueness`, `workspace-role-duplicate-rows` → **3 files / 13 tests passed**. New unit test → **1/1 passed** locally. CI's `unit + component` is green at this head |
| **5. Is one Opus pass the right tier?** **Yes.** | A declarative tracking fix. No migration, no DDL reaches any database, no query text changes, no route, policy, capability or gate machinery touched. It removes a hazard (a silent future `DROP` of #134's arbiter going unnoticed) and redesigns no authority or gate-semantics invariant. Per `AGENTS.md`'s review-tier table and the 2026-09-16 decision, that is one ordinary review plus this single Opus pass |

## Findings

**None blocking.** Informational, all pre-existing:

- **INFO**: historical snapshots `0052`–`0069` still omit the constraint, and `0051`/`0071`
  have no snapshot file at all. Harmless: `generate` diffs against the latest snapshot only,
  and `check` passes. Rewriting history to "fix" them would be churn with no effect.
- **INFO**: before this PR, an ad-hoc `drizzle-kit push` against a real database would have
  proposed dropping `workspace_role_workspace_id_role_unique`, because the schema did not
  declare it. This PR removes that hazard. Reasoned from `push`'s introspect-and-diff
  behavior, not measured. `push` is not in any package script.
- **INFO, gate state, not code**: the PR body's `## Reviewed by` (ordinary review) still reads
  PENDING at this head. This Opus pass does not replace it. The orchestrator must record it
  before merge.

## Not checked

- The full `apps/api` unit suite, and the full integration suite beyond the three
  `workspace_role` files above. The PR body reports pre-existing unrelated failures on
  `origin/main`; this reviewer did not re-measure that claim.
- Any real deployed environment's `__drizzle_migrations` table. The claim of no effect rests
  on the migrator source above, not on inspecting a live install.

---

## Lightweight re-confirmation after branch update (2026-09-27)

**Reviewed head:** `ae90fdf95e34648ae1977cb5b29e42e70965cac2`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. `git show --remerge-diff` empty; brings in already-reviewed
main content (#394's check:tokens gate), zero overlap with this PR's own files.

---

## Lightweight re-confirmation after branch update, round 2 (2026-09-27)

**Reviewed head:** `dc17dc2ca187a32f1fbd4db82702b9d1a8120105`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. Empty remerge-diff; brings in #346's already-reviewed P3
identity domain code, zero overlap with this PR's own files.

---

## Lightweight re-confirmation after branch update, round 3 (2026-09-27)

**Reviewed head:** `340d805c7929dd4bc3d83b2865b8e006aa3dfceb`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. Empty remerge-diff; brings in #406's already-reviewed
command-palette fix, zero overlap with this PR's own files.

---

## Lightweight re-confirmation after branch update, round 4 (2026-09-27)

**Reviewed head:** `795eeb5515ba3aa415a5b024c2d2369602280deb`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. Empty diff on `apps/api/src/database/schema.ts` and
`apps/api/drizzle/meta/0070_snapshot.json` between the last reviewed head
(`340d805c7929dd4bc3d83b2865b8e006aa3dfceb`) and this one — the intervening commits
(`1493b0eac`, `79d0093bc`, `91ce0bfc9`, and #404's own content) bring in #404's
already-reviewed unique-violation-exact-match fix, zero overlap with this PR's own files.
