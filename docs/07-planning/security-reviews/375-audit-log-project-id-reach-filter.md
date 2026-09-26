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
