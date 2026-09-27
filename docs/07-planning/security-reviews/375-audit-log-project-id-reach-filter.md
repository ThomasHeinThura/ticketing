# Security review: PR #375, `audit_log.project_id` and the workspace audit reach filter (#344)

**Reviewed head:** `5284482236f9200b3825941b5c8ca4dea89e71ce`

- **Reviewer:** Claude Opus 5.5, a fresh and independent context. It did not author, direct or fix this change.
- **Tier:** full: a migration plus an authority change.
- **Base:** `origin/main` at `8a51415`. Main moved past the PR's base only by docs (#374: `decision-log.md` and `status.md`), so there is no code drift.
- **Scope:** `apps/api/drizzle/0070_*`, the journal and snapshot, `audit-writer.ts`, `list-workspace-audit.ts`, `schema.ts`, `data-model.md`, `audit-trail.md`, and the three test files.

_Findings are written as they are found. The verdict comes last._

## Findings

### Migration: checked, no finding

- `0070_audit_log_project_id.sql` is a single `ALTER TABLE "audit_log" ADD COLUMN "project_id" text;`. It is nullable, with no default, no FK and no index.
- On PostgreSQL 11+ this changes only the catalog: no table rewrite, no scan. It takes a brief `ACCESS EXCLUSIVE` lock, the same as every `ADD COLUMN`.
- It is forward-only. Journal `idx` 70 follows main's latest (`0069_policy_shadow_tables`). `when` is 1790397730657, which is greater than 1790201000000.
- The column is not covered by the existing grants' column lists. `taskdesk_app` holds table-level `INSERT`/`SELECT` only, so the new column inherits them and gains no `UPDATE`.
- The triggers are untouched by `ADD COLUMN`.
- `audit-log-project-id-migration.test.ts` runs the full existing-row sequence required by #344's acceptance: migrate to 0069, insert a row with raw SQL, apply the real 0070 file, then assert the column shape, that the old row reads `NULL`, and that a new row accepts a value.

### Read filter: SQL shape, checked, no finding

The generated SQL (drizzle `toSQL`, captured by the reviewer) is:
`where ("workspace_id" = $1 and ("project_id" is null or "project_id" in ($2,$3)) and "action" like $4)`.

- The `or()` is parenthesised inside the outer `and()`, so the #320 D0 class (an ungrouped `OR` that escapes the tenant predicate) does not occur.
- The tenant predicate `workspace_id = :ws` stays an unconditional top-level conjunct on every branch, including the `sees_all` branch, which returns `undefined`.
- The response goes through `toRowResponse`, which does not emit `project_id`. The OpenAPI schema is unchanged.

### H1 (Low, non-blocking): the stated reason for leaving `project_id` out of the hash is inaccurate, but the trade-off is acceptable

**What the code comments and `data-model.md` say.** They say that hashing a new column "would make every pre-existing row fail recomputation" because "the recipe applies uniformly". That is not true of this recipe.

- `canonicalRowHash` joins a closed, positional field list with `\x1e`, and it rejects `\x1e` inside any field (the #175 S-2 fix).
- A recipe that appends a sixteenth field only when `project_id IS NOT NULL` would therefore stay injective, because the separator count differs.
- Every pre-migration row (`NULL`) would still recompute byte-identically.
- So hashing `project_id` for new rows was feasible without breaking old chains.

**Failure scenario.** A party able to mutate `audit_log` re-points a row's `project_id` without `audit-verify` noticing. Re-pointing to `NULL` shows the row to every `workspace:manage_settings` holder in the workspace. Re-pointing to a project the intended reader cannot reach hides it from them. Either way, what changes is who can *read* the row. The recorded event (actor, action, entity, before/after) stays hash-protected.

**Judgement.** Acceptable for this PR, and it does not defeat AU integrity:

1. #344's acceptance explicitly permits "not part of the hash input". `organisation_id` is the direct precedent: it is also a reach column outside the hash.
2. The column is protected by the same first two layers as every hashed column. Grants: `taskdesk_app` has no `UPDATE`. The trigger: see S1 below, which is where the real gap is.
3. Anyone who can bypass both layers is the owner or a superuser. They can also recompute an unkeyed SHA-256 chain from the tamper point onward, so the hash does not protect any column against them in isolation.
4. `project_id` is partly corroborated by hashed data: `entity_type`/`entity_id`, and usually `before`/`after`, identify the project-bound entity.

**Recommended follow-up (not blocking):**

- Correct the rationale in `schema.ts`, `audit-writer.ts` and `data-model.md`, so that no future reader believes hashing was impossible.
- Decide deliberately whether to hash `project_id` conditionally for new rows. That change belongs to the `packages/domain` recipe, which is a shared contract, with a golden-hash update, so it belongs in its own PR.

### S1 (Medium, BLOCKING): the AU-7 tombstone carve-out in the append-only trigger lets `project_id` be rewritten. Reproduced.

**The gap.** `audit_log_reject_mutation()` (0067) allows an `UPDATE` only when `organisation_id` changes to `NULL` for an organisation that no longer exists. It enforces "nothing else changed" with a closed list of `NEW.x IS DISTINCT FROM OLD.x` checks. Migration 0070 adds `project_id` but does not replace the function, so `project_id` is not in that list. This PR's own reach filter uses `project_id` to decide who can read a row.

**Reproduction.** Run as the table owner on `o375_test` at the reviewed head:

```sql
UPDATE audit_log SET project_id = NULL WHERE id = 'a-o375';
-- ERROR: audit_log is append-only: UPDATE is not permitted      (baseline: blocked)

WITH d AS (DELETE FROM organisation WHERE id = 'org-o375' RETURNING id)
UPDATE audit_log SET organisation_id = NULL, project_id = NULL
WHERE organisation_id IN (SELECT id FROM d);
-- UPDATE 1   -> project_id 'prj-secret' is now NULL
```

**What happens.**

- Inside the trigger, the organisation deleted by the same statement is already invisible, so the "organisation still exists" check passes.
- Every checked column is unchanged, so the carve-out accepts the row.
- `project_id` is rewritten, to `NULL` or to any other project.
- `audit-verify` still reports `ok`, because neither column is hashed (see H1).

**Failure scenario.** A customer organisation is being deleted. In the same statement, a row that was scoped to a restricted project is set to `project_id = NULL`. It then becomes visible to every workspace manager, and a row can equally be hidden from its rightful readers. This is plain DML, not DDL: no `DISABLE TRIGGER` appears anywhere.

**Why it blocks.** The trigger is documented as firing "for every role, including the table owner". It is also the *only* layer under the single-URL local-development fallback. The Opus review of PR #291 (S4) treated the identical carve-out bypass on `organisation_id` as blocking, and fixed it. Before this PR, the carve-out could change nothing but `organisation_id`; this PR widens it. The split-role production shape still stops `taskdesk_app`, because it has no `UPDATE` grant. That is why this is Medium and not High.

**Required fix.**

- Add a statement to `0070_audit_log_project_id.sql` (after a `--> statement-breakpoint`) that does `CREATE OR REPLACE FUNCTION audit_log_reject_mutation()`, identical to 0067's body plus `OR NEW.project_id IS DISTINCT FROM OLD.project_id`.
- Add a regression test that runs the CTE above and expects the append-only exception.
- Better still, have the test enumerate `information_schema.columns` for `audit_log`, and assert that every column except `organisation_id` appears in the function's equality list. The next added column will then fail CI instead of silently widening the carve-out again. A cheap version is to read `pg_get_functiondef` and check that it names each column.

### T1 (Medium, BLOCKING): per-workspace `sees_all` scoping is unpinned, and #344's two-workspace acceptance test is missing

**The mutation.** The reviewer deleted `eq(membershipTable.scopeId, workspaceId)` from the `sees_all` lookup. That turns a `sees_all` grant on *any* workspace into "see every project here". With that change, **all of `audit-read.test.ts` still passed**; only the reviewer's own probe caught it.

**The acceptance gap.** #344's acceptance names "a two-workspace, two-project test". The PR's reach tests all use one workspace, and the pre-existing tenant test has two workspaces but no projects.

**Failure scenario.** A later refactor, for example moving to `resolve-identity`'s membership list, drops the scope-id predicate. A manager with `sees_all` in workspace B then reads every restricted project's audit rows in workspace A, and CI stays green.

**Required fix.** Add at least the reviewer's P1 as a committed test: a `sees_all` grant on workspace B does not lift the filter on workspace A. P2 and P3 below are also worth committing.

### W1 (Low, non-blocking now; binding on the first writer, #353): the writer does not check that `project_id` belongs to `workspace_id`

**The gap.** `appendAuditLog` stores `input.projectId` as given. No caller passes it yet (verified with grep), so nothing is exposed today. The reach filter's project-membership query is deliberately not scoped to the workspace. Its correctness relies on every row's `project_id` being a project *of that row's workspace*.

**Probes.**

- P6: the writer accepted a project from workspace B on a workspace-A row.
- P5: a reader whose only project membership is in workspace B then saw that row through workspace A's audit route.

**Failure scenario.** A future writer takes `projectId` from a request body or path while `workspaceId` comes from context. Its rows then land under a mismatched workspace. They become visible to members of the foreign project and invisible to the managers who should see them.

**Recommendation.** One of these:

- Before merging #353, add a guard in `appendAuditLog` (inside the existing transaction) that `project.workspace_id = input.workspaceId` whenever `projectId` is non-null.
- Or state as a writer contract that `projectId` must come from the already-loaded entity row, never from caller input. #353's reviewers should check this regardless.

### Checked and clean (reviewer probes, `tests/api-integration/o375-probe.test.ts`, not committed)

- **P1.** A `sees_all` grant on another workspace does not lift the filter. It passes at head, and it fails under the T1 mutation.
- **P2.** A project membership in workspace B gives no reach into workspace A's projects, and B's rows never appear in A's read.
- **P3.** `sees_all` on this workspace never reveals another workspace's rows.
- **P4.** The `?action=` prefix filter composes with reach. No `OR` escape.
- **Null `project_id` rows** are shown to every workspace reader, per AU-10 and the decision log.
- **Fail-closed paths:**
  - a missing `userId`, no person row, or a person with no project memberships leaves only the `IS NULL` arm;
  - `inArray` is never called with an empty list;
  - reach can only narrow what `workspace:manage_settings` already allowed, so the under-exposure the code comment admits cannot become over-exposure.
- **Existence oracle:** none new. Filtered rows are simply absent: same status and same body shape, with no count, and `limit` is applied after the filter. `seq` is a global identity, so its gaps reveal instance-wide row volume. That was already true across workspaces before this PR (#343), and it is informational.
- **`toRowResponse`** does not emit `project_id`, and the OpenAPI document is unchanged. `check:openapi` and `test:contract` are clean.

### Informational

- **I1.** The OpenAPI description of `listWorkspaceAudit` (`audit/index.ts`) still reads "see their own workspace's rows (AU-10)", without mentioning the reach filter. It is a documentation-only drift, safe to fix with S1.
- **I2.** Reach reads the `membership` table directly, while the rest of the app decides access from `workspace_user`, and `resolve-identity` always resolves `seesAll: false`. The code comment records this as fail-closed under-exposure pending #8. That is accurate, and it does not create a security issue. Functionally, once #353 writes project-scoped rows, workspace managers will see none of them until a `membership` writer or #8 lands. The orchestrator should know that this is the expected behaviour, not a bug.
- **I3.** The PR body fails `check:pr-template` with 12 problems: missing `## Not done`, missing checklists, gate rows with free text, and the security-review link. The "Code scanning AI findings" run failed on infrastructure ("The requested model is not supported"), not on a finding. Both are for the orchestrator. The reviewer does not edit the PR body.

## Evidence

All runs are at `5284482236f9200b3825941b5c8ca4dea89e71ce`, with the offline install and `packages/*` built, on a private `o375_test` database.

| Suite | Result |
| --- | --- |
| Integration (full, `vitest.integration.config.ts`) | 91 files, 1229 tests passed |
| `db-application-role`, `audit-log`, `audit-read` and `audit-log-project-id-migration` re-run | 4 files, 91 tests passed |
| `test:permissions` | 11 files, 81 tests passed |
| API unit | 59 files, 490 tests passed |
| Package unit tests | domain 530, permissions 261, mcp 30, email 16, libs 3: all passed |
| `check:openapi` | matches, 110 operations |
| `test:contract` | Redocly 16 findings, the same as main's 16; oasdiff shows no breaking changes |
| Reviewer probes P1–P6 | 6 passed at head. P1 fails under the T1 mutation |
| Trigger carve-out probe (S1) | reproduced: `project_id` rewritten through the tombstone path |
| GitHub CI at head | "CI - full" green. "CI - fast" red only on `pull request template + security review` (I3). The AI code-scanning run failed on infrastructure |

## Verdict

**CHANGES REQUIRED.**

- The migration is metadata-only and forward-only, with correct numbering and an existing-row test.
- The read filter is correctly grouped, correctly tenant-bound and fail-closed.
- Keeping `project_id` outside the hash is an acceptable, documented trade-off (H1, with a rationale correction recommended).

Two items block:

- **S1:** close the trigger carve-out for `project_id` in 0070, with a regression test.
- **T1:** commit a two-workspace test that pins per-workspace `sees_all` scoping.

W1 must be settled before #353 (the first project-scoped writer) merges. After the fixes, a delta Opus review on the new exact head is required.

## Delta review: S1/T1 fix confirmation

**Reviewed head:** `fbba252171603a3be35faafbf3708c9d3ec8f486`

- **Reviewer:** Claude Opus 5.5 (`claude-opus-5-5`), a fresh and independent context. It did not author, direct or fix this change, including the fix commit `fbba252`.
- **Tier:** delta over the review at `5284482236f9200b3825941b5c8ca4dea89e71ce`.
- **Base:** `origin/main` at `0b1bcc1`, which is also the branch's merge-base. The PR is `MERGEABLE`.
- **Scope:** the fix commit `fbba252`, plus a check that the two intervening `main` merges (`fc6e6b8`, `9c26ded`) brought in nothing else.

_Findings are written as they are found. The verdict comes last._

### Diff scope: checked, no finding

- `git show --remerge-diff` is empty for both merge commits, so they carry no conflict resolution or hidden edits.
- Measured against `main`, the PR's net diff changed in only these ways since the earlier review:
  - the 8 files of `fbba252`: the 0070 migration, `audit-writer.ts`, `audit/index.ts`, `schema.ts`, `data-model.md`, `openapi.json`, `audit-log.test.ts` and `audit-read.test.ts`;
  - this review document itself (`0d8ed3a`).
- `list-workspace-audit.ts`, the journal and snapshot, `audit-trail.md` and the migration test are byte-identical to `5284482`.
- `fbba252` adds no new migration and no new journal entry. The change sits inside 0070, which has not yet been applied anywhere outside tests.

### S1: closed. Reproduced against the fix.

**The trigger.** 0070 now ends with `CREATE OR REPLACE FUNCTION audit_log_reject_mutation()`. A textual diff against 0067's body shows one difference, apart from `CREATE` becoming `CREATE OR REPLACE`: the added line `OR NEW.project_id IS DISTINCT FROM OLD.project_id`. That line sits inside the closed carve-out equality list itself.

**Coverage.** The list now covers every `audit_log` column except `organisation_id`: the 18 columns in 0067 plus `project_id`. No other migration adds a column to `audit_log`.

**The trigger binding.** The `audit_log_append_only` trigger (`BEFORE UPDATE OR DELETE ... FOR EACH ROW`) binds the function by name, so the replacement takes effect without re-creating the trigger.

**Live SQL, as the table owner (superuser), on the private `o375d_test` database:**

| Statement | Result |
| --- | --- |
| `UPDATE audit_log SET project_id = NULL` (direct) | rejected: `append-only: UPDATE is not permitted` |
| Original S1 exploit: CTE `DELETE organisation` plus `SET organisation_id = NULL, project_id = NULL` | **rejected** at the carve-out: `beyond the AU-7 organisation_id tombstone`. The whole statement rolled back, so both the organisation and the row are intact |
| The same CTE, re-pointing to `project_id = 'prj-other'` | **rejected**, as above |
| Legitimate: plain `DELETE FROM organisation` (FK `ON DELETE SET NULL`) | succeeds: `organisation_id` becomes `NULL` and `project_id` is unchanged |
| Legitimate: the CTE tombstone that sets `organisation_id = NULL` only | succeeds: `project_id` is unchanged |
| After the tombstone, `SET project_id = NULL` | rejected (the generic path) |

The fix fails closed without breaking the legitimate AU-7 path.

**Mutation.** The reviewer removed the `project_id` line from 0070 and ran `audit-log.test.ts` on a fresh database. The new test "refuses the AU-7 tombstone UPDATE if it also rewrites project_id…" went **red**, and only that test. The line was then restored.

The direct-`UPDATE` test correctly stays green under that mutation, because the generic reject path catches it.

### T1: closed

The reviewer deleted `eq(membershipTable.scopeId, workspaceId)` from the `sees_all` lookup in `list-workspace-audit.ts`. The new test "a sees_all grant on ANOTHER workspace does not lift the filter on this one" went **red**, and it was the only failure in `audit-read.test.ts`. The line was then restored. This is the reviewer's original P1 probe, now committed.

### H1 and I1: addressed, with one new inaccuracy (non-blocking)

- **I1.** The OpenAPI description now mentions the reach filter. `openapi.json` is regenerated, and `check:openapi` matches (110 operations).
- **H1.** The false claim that hashing would break old rows is gone from `schema.ts`, `audit-writer.ts` and `data-model.md`.

**H1-b (Low, non-blocking, docs only).** The replacement rationale in all three places has a new problem. It says `project_id` stays out of the hash because, "like the tombstone, this column can legitimately change after the row is written". That is not true. There is no legitimate path that changes `project_id`: it has no FK and no `SET NULL`, and this very fix makes the trigger refuse every change to it.

The accurate reason:

- #344's acceptance permits leaving it out of the hash;
- `organisation_id` is the precedent;
- hashing it conditionally would be a change to the shared `packages/domain` recipe, with a golden-hash update, which belongs in its own PR.

`data-model.md` also says the original rationale is "below this line", but it has been replaced. Fix this in a follow-up, or with the next commit to this branch. It does not affect behaviour.

### Informational

- **I4.** The comment in the S1 regression test says "the organisation stays deleted (it is not re-created)". In fact the whole statement rolls back, so the organisation still exists; the reviewer observed this live. The assertions themselves are correct.
- **I5.** The "better still" guard from the original S1 recommendation was not added. That guard is a test asserting that every `audit_log` column except `organisation_id` appears in `pg_get_functiondef('audit_log_reject_mutation')`. Without it, the next column added to `audit_log` will silently widen the carve-out again, which is exactly how S1 arose. This is a recommended follow-up, not blocking here.
- **I3 (carried).** At this head, `pull request template + security review` is still red on GitHub. That gate is for the orchestrator. All other required checks are green.

### Evidence

All runs are at `fbba252171603a3be35faafbf3708c9d3ec8f486`, in a detached worktree, with the offline install and `packages/*` built, on the private databases `o375d_test` and `o375m_test` (the latter for the S1 mutation).

| Suite | Result |
| --- | --- |
| `pnpm --filter @taskdesk/api typecheck` | clean |
| Integration (full, `vitest.integration.config.ts`) | 91 files, 1236 tests passed |
| `audit-log`, `audit-read` and `audit-log-project-id-migration` | 3 files, 66 tests passed |
| `test:permissions` | 11 files, 81 tests passed |
| `check:openapi` | matches, 110 operations |
| S1 live SQL (exploit and legitimate paths) | exploit rejected, legitimate tombstone succeeds |
| S1 mutation (drop the `project_id` line) | the new S1 test goes red |
| T1 mutation (drop the `scopeId` predicate) | the new T1 test goes red |

### Delta verdict

**CLEAR** at `fbba252171603a3be35faafbf3708c9d3ec8f486`.

- S1 and T1 are closed. Each is verified by live reproduction and by a mutation that turns its regression test red.
- The legitimate AU-7 tombstone path still works.
- No out-of-scope change entered through the `main` merges.
- H1-b, I4 and I5 are non-blocking.
- W1 still binds on #353, not on this PR.

Any further commit to this branch (including a fix for H1-b) changes the head. That needs a fresh exact-head confirmation before merge.
