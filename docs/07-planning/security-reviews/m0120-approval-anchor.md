# Migration 0120: approval tenant anchor — review record

**Reviewed head:** `1305315219b66b672c4aed83a751233161d19175`
**Reviewed head:** `230b8102322a76d034877ad9ca765dd55ed7bbe6` (rebind after merging main `f4f6b011`, #623; the 0120 delta is byte-identical)

## Background

Thomas decided on 2026-10-10 that `approval` is anchored before any runtime slice writes it: migration 0120, following the 0119 tenant-FK pattern. The decision is in the decision log.

## The change

- `approval.workspace_id` is backfilled from the work item and is NOT NULL.
- A composite FK `(workspace_id, work_item_id)` → `work_item (workspace_id, id)` replaces the single-column FK.
- There is a workspace FK and an index.
- The journal and snapshot chain from 0119.
- The ledger allocates 0120 and reserves 0121 for the #569 re-cut.
- Only `approval` leaves the unanchored-tables guard.

## Review tier rationale

- **Ordinary review:** one strong ordinary review. The change is one forward-only migration on a table with no runtime reader or writer, built exactly on the reviewed 0119 template.
- **Security review:** the Sol-tier review re-proved every claim on a real database with 10 mutations.

## Contexts

- **Implementation:** Claude Sonnet `a6eb3c060ac7264c4`.
- **Ordinary review:** Claude Sonnet `a21c4de8428161cbe`. Verdict: APPROVE.
- **Security review:** Claude Opus 5.5 `a48c7a7a2eca545d3`. Verdict: CLEAR WITH NON-BLOCKING. It is Sol-tier under Thomas's routing and is not a GPT-6 Sol review.

The security review's runtime-check list is binding on slice S3. Its documentation items N-1, N-3 and N-4 are carried into S3's ledger and runbook changes.

Each report is inserted unmodified, with its SHA-256.

<!-- BEGIN REPORT (agent a21c4de8428161cbe; model claude-sonnet-5-5; role independent ordinary review; candidate 1305315219b66b672c4aed83a751233161d19175 + rebind 230b8102322a76d034877ad9ca765dd55ed7bbe6; sha256 8c7e7489794b21d83ccebbf3cf71ea559d3547237dbc57199d9b09ce8c0b2a93) -->
# Migration 0120 (approval tenant anchor) - ordinary review A

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: not exposed to this subagent (fresh, independent Sonnet subagent context; did not author, direct or remediate the change)
**Reviewed head:** 1305315219b66b672c4aed83a751233161d19175
Base: main 954eb84094e009658943af1e294d3b8a48d17f69 (3 commits: b3ff272b, a83b7fc8, 13053152; HEAD verified with git rev-parse)

## Verdict: APPROVE (no blocking findings; 3 non-blocking notes)

## 1. SQL correctness - PASS
- Order is right: ADD COLUMN nullable, UPDATE ... FROM work_item (join on work_item.id, the PK, so one match per row), SET NOT NULL, drop old FK, add FKs, create index. Every approval row has a work item because the old FK was NOT NULL + enforced, so the backfill cannot leave NULL.
- Composite FK `approval_workspace_work_item_fk` (workspace_id, work_item_id) -> work_item(workspace_id, id), ON DELETE cascade, ON UPDATE no action. The dropped `approval_work_item_id_work_item_id_fk` was (0116:23) single-column ON DELETE cascade with the default ON UPDATE no action, so delete and update semantics are identical to the old FK. Matches 0119's style (composite, `no action` on update, parent unique already present: work_item_workspace_id_id_unique, so none added). Verified by test that deleting a work item cascades to its approvals and that moving a work item's workspace is refused.
- Extra FK `approval_workspace_id_workspace_id_fk` ON DELETE cascade / ON UPDATE cascade matches the repo's other workspace FKs (grep shows onUpdate cascade as the norm). Workspace-id UPDATE is anyway blocked by pre-existing FKs elsewhere (project/work_item), unrelated to 0120; I saw no 0120-specific problem.
- Index `approval_workspaceId_idx` (workspace_id): reasonable and consistent with the repo's naming for workspace indexes; the composite FK child lookup is served by existing `approval_work_item_created_idx` on work_item_id for parent-delete cascades.
- Locks: drizzle runs all pending migrations in one transaction. UPDATE rewrites the table, SET NOT NULL and FK validation scan it under strong locks (ACCESS EXCLUSIVE on approval, SHARE ROW EXCLUSIVE on work_item during FK validation), index build blocks writes. Acceptable: `approval` was created in 0116 and has no runtime writer yet (the guard enforced that until now), so it is empty or tiny in practice. Same posture as 0119.
- Idempotence: no IF NOT EXISTS, like 0119; drizzle's hash/`when` ledger prevents re-run. I ran `migrate()` twice on one database: second run is a no-op, no error.
- Ledger SHA-256 cf4bb7c0...d029 matches `shasum -a 256` of the .sql.

## 2. Snapshot and journal - PASS
- Journal idx 120, `when` 1791628167040 > 0119's 1791609109777 (strictly increasing; roughly 2026-10-10, not in the future).
- 0120_snapshot id d329dd2c..., prevId 3bb9f18e... = 0119_snapshot id. Structural diff 0119 vs 0120 snapshot is exactly: +column workspace_id, +index approval_workspaceId_idx, +FK approval_workspace_id_workspace_id_fk, +FK approval_workspace_work_item_fk, -FK approval_work_item_id_work_item_id_fk, plus the id/prevId. Nothing else.
- `drizzle-kit check`: "Everything's fine". `drizzle-kit generate --name zzcheck`: "No schema changes, nothing to migrate"; git status clean afterwards (no file left behind).

## 3. Guard and ledger - PASS
- unanchored-tables-unreferenced.test.ts: only `approvalTable` and the `from|into|update|join approval` alternative were removed; custom_field_type_visibility / custom_field_value patterns unchanged. The self-test fixtures were flipped so approval references are now asserted as NOT flagged, and custom_field ones still flagged. 2/2 pass. biome check clean.
- Ledger: table rows 0120 allocated, 0121 reserved for #569, 0122+ unallocated; 0120 section with correct SHA and `when`; N2 disposition row for approval says Done in 0120 (work_item_id) with transition_id residual; "Open forward items after 0120" lists only the two custom-field tables; "Next allocation" is 0122 with when > 1791628167040. Accurate. No stale "after 0119" text remains in docs/scripts/tests (grep).

## 4. data-model.md - PASS
- Row declares workspace_id NOT NULL, FK to workspace ON DELETE CASCADE, composite FK name/shape/actions: matches schema.ts and the DB (pg_get_constraintdef asserted in the test). `pnpm check:vocabulary`: "111 table declaration(s), every one registered" (only existing baseline notes). Minor: the doc omits that the workspace FK is ON UPDATE CASCADE (NON-BLOCKING, N1).

## 5. Tests - PASS, non-vacuous
- New test + 0119 test: 2 files, 5 tests passed (postgres:18-alpine, tmpfs).
- Upgrade test migrates to exactly 0119 from a copy, seeds approvals in two workspaces via legacy insert, applies the shipped SQL split on breakpoints, checks per-row backfill equals work item workspace, constraint inventory (old gone, two new), exact FK definition, NOT NULL, index, cross-tenant insert/update refused both ways (23503), NULL (23502), unknown workspace, same-tenant control, cascade. Clean-replay test via the real migrator.
- Mutations I ran on a scratch copy (original never touched; each mutant reverted):
  - M1 single-column FK: 2 failed (def assertion).
  - M2 no backfill: upgrade test failed (SET NOT NULL on existing rows).
  - M3 wrong backfill (first workspace for all): upgrade test failed.
  - M4 ON UPDATE cascade on the composite FK: 2 failed.
  - M5 old FK kept: 2 failed.
  - M6 no SET NOT NULL: 2 failed.
  - M7 ON DELETE no action: 2 failed.
  All killed.
- Minor: the upgrade test applies 0120 by splitting statements rather than through migrator; the clean replay covers the migrator path, and I separately ran migrate() twice. Fine.

## 6. Open issue: approval.transition_id - recorded correctly; not an S3 blocker
- Recorded in three places: schema.ts comment, ledger "Residual: approval.transition_id" section, and the N2 disposition row. Reasoning is accurate: workflow_transition has no workspace_id (workspace reachable only via workflow_version -> workflow), so a composite FK needs a new denormalised column on workflow_transition or a trigger, a design change outside 0120's scope.
- It is not a blocker for merging 0120. For S3 it is a runtime obligation: the approval-creation path must verify the transition belongs to the work item's workspace. Impact is tenant-integrity of a gate reference (needs a bug or a forged id to exploit), not data exposure by itself.

## Findings
BLOCKING: none.
NON-BLOCKING:
- N1: data-model.md omits `ON UPDATE CASCADE` on the approval->workspace FK (docs nit).
- N2: With `approval` removed from the unanchored guard, nothing machine-enforces the transition_id runtime check; the ledger sentence is the only control. Suggest S3's PR include a non-vacuous negative test (cross-workspace transition_id rejected) and a tracked issue for the DB-level anchor (workflow_transition.workspace_id), and that the Sol security reviewer be told explicitly.
- N3: decision-log entry b3ff272b (written before the work) does not mention the transition_id residual; it is only in the ledger. Append-only rules mean the ledger is the right home, no action needed unless the conductor wants a cross-reference. Also this is a security-scope PR (migration), so the Sol review at the exact head is still required; this review does not substitute.

## Commands and counts
- git rev-parse HEAD -> 1305315219b66b672c4aed83a751233161d19175; git log main..HEAD -> 3 commits.
- docker run -d --rm --name m0120-ra-pg --tmpfs /var/lib/postgresql postgres:18-alpine (port 55432, db m0120_test).
- `vitest run --config vitest.integration.config.ts` (approval-workspace-anchor-migration + tenant-composite-fks-migration): 2 files, 5 tests passed.
- unanchored-tables-unreferenced: 1 file, 2 tests passed. biome check on 3 files: clean.
- drizzle-kit check: ok; drizzle-kit generate: no schema changes. check:vocabulary: 111 tables registered, pass.
- 7 mutations, all caught (above). Extra scratch test: migrate twice OK.

## Cleanup proof
- Scratch mutation copy /private/tmp/claude-501/m0120-mut deleted (ls shows only m0120 and m0120-out.md remain).
- Container m0120-ra-pg stopped (--rm removes it); `docker ps -a | grep -c m0120-ra-pg` = 0. No other container touched.
- Candidate worktree: `git status --short` empty, HEAD unchanged. No edits, commits or pushes. Only this report file was written.

## Rebind at 230b8102

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
**Reviewed head:** 230b8102322a76d034877ad9ca765dd55ed7bbe6

Verdict: APPROVE stands (rebind clean, no new findings).

- Head is a merge commit with parents 13053152 and f4f6b011 (#623).
- `git diff f4f6b011 230b8102` is byte-identical to `git diff 954eb840 13053152` (cmp: IDENTICAL, 15227 lines).
- #623 touches 6 files only: docs/05-operations/{container-image,one-line-install,runbook}.md, security-reviews/p0-installer-rerun-fix.md, install.sh, scripts/ci/install.test.mjs. File-name overlap with the 0120 change set is empty; none is a migration, schema, journal, snapshot, ledger, guard, data-model or decision-log file. The runbook change is installer text, not the 0119/0120 upgrade sections. No interaction with 0120.

Commands: git rev-parse HEAD; git log -1 --format='%H %P' 230b8102; git diff f4f6b011 230b8102 > a.diff; git diff 954eb840 13053152 > b.diff; cmp a.diff b.diff; git diff --stat 954eb840 f4f6b011; git diff --name-only (both ranges) piped to comm -12 (empty); git diff 954eb840 f4f6b011 -- docs/05-operations/runbook.md. Read-only; no edits, no container used.
<!-- END REPORT (sha256 8c7e7489794b21d83ccebbf3cf71ea559d3547237dbc57199d9b09ce8c0b2a93) -->

<!-- BEGIN REPORT (agent a48c7a7a2eca545d3; model claude-opus-5-5; role independent Sol-tier security review; candidate 1305315219b66b672c4aed83a751233161d19175 + rebind 230b8102322a76d034877ad9ca765dd55ed7bbe6; sha256 b0cf982fb68fe9b2641d58b8dc93d187252996b8644152e6c19a90d903d4ff3f) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:not-exposed (this subagent context was not given its own agent ID. Parent session is 3a9e9ce4-8409-47d4-b1be-1f1544697e70. The conductor should record the agent ID that its Agent tool returned for this run.)
**Reviewed head:** 1305315219b66b672c4aed83a751233161d19175
Verdict: CLEAR WITH NON-BLOCKING. There are no blocking findings. Four non-blocking items (N-1 to N-4) are listed below. The S3 runtime-check list is a hard precondition for S3, not for 0120.

# Migration 0120 `approval_workspace_anchor`: independent security review

## Role and independence

- I acted as the Sol-tier security reviewer, as a fresh Claude Opus 5.5 context. This is **not a GPT-6 Sol context**. Whether this review satisfies the GPT-6 Sol gate in CLAUDE.md is for the orchestrator to decide.
- I did not author, direct or remediate this candidate.
- I worked read-only:
  - I worked on a `git archive` export in the scratchpad, with `node_modules` symlinked.
  - The candidate worktree is clean afterwards: `git status --short` printed nothing, and HEAD is unchanged.

## Scope

- Candidate: `/private/tmp/claude-501/m0120`, branch `claude/m0120-approval-anchor`, HEAD `1305315219b66b672c4aed83a751233161d19175`.
- Base and merge base: main `954eb84094e009658943af1e294d3b8a48d17f69`. The range has 3 commits: b3ff272b, a83b7fc8 and 13053152. 9 files changed.
- Files examined:
  - `apps/api/drizzle/0120_approval_workspace_anchor.sql`;
  - `meta/0120_snapshot.json` and `meta/_journal.json`;
  - `apps/api/src/database/schema.ts`, the approval table at about lines 3241-3300;
  - `docs/01-architecture/data-model.md:413`;
  - `docs/07-planning/decision-log.md` (top entry, 2026-10-10);
  - `docs/07-planning/migration-ledger.md` (the 0120 section, the N2 disposition table and the forward items);
  - `tests/api-integration/approval-workspace-anchor-migration.test.ts`;
  - `tests/api/database/unanchored-tables-unreferenced.test.ts`.
- Background I read:
  - `apps/api/drizzle/0116_*.sql`, which created `approval`;
  - the workflow, workflow_version and workflow_transition schema;
  - the author's report `/private/tmp/claude-501/m0120-out.md`;
  - the 0119 record `docs/07-planning/security-reviews/m0119-tenant-fks.md`.

## Findings by focus

### 1. Cross-tenant integrity of `approval -> work_item`: closed

I tested this live on Postgres 18.6. The composite FK `approval_workspace_work_item_fk (workspace_id, work_item_id) -> work_item(workspace_id, id)` is MATCH SIMPLE, NOT DEFERRABLE, ON DELETE CASCADE and ON UPDATE NO ACTION. Both child columns are NOT NULL, so MATCH SIMPLE can never skip the check.

| Probe | Result |
| --- | --- |
| insert ws=A, item in B | 23503 `approval_workspace_work_item_fk` |
| insert ws=B, item in A | 23503 |
| insert with no `workspace_id` (old-image shape) | 23502 NOT NULL |
| `update approval set workspace_id` A->B | 23503 |
| `update approval set work_item_id` -> B item | 23503 |
| `update work_item set workspace_id='wsB'` (move the item's workspace) | 23503 (NO ACTION; not cascaded) |
| move item with workspace, project, state and type together | refused (23505 in my seed; the composite parent FKs would refuse it otherwise) |
| rename `work_item.id` | 23503 |
| `update project set workspace_id` (move a project) | 23503, from the existing `work_item_workspace_id_project_id...` FK |
| rename `workspace.id` | 23503, from the existing project/work_item composite FK, so the new `approval_workspace_id_workspace_id_fk` ON UPDATE CASCADE path can never be reached on its own |
| hard delete of a work item | cascades its approvals (0 remaining) |
| soft delete (`deleted_at`) | approvals kept, as before |

- A work item cannot be moved between workspaces while it has an approval, and no update path can make the two drift apart.
- The only "move" the database allows is an UPDATE that changes **both** `approval.workspace_id` and `approval.work_item_id` to a consistent pair in another tenant (probe: OK). That row is internally consistent, but it would carry its old `transition_id` and persons with it. See N-2 and S3 check 7.

### 2. References still unanchored on `approval`

`approval` has exactly five FKs after 0120. There is **no `decided_by` column**: the 0116 table has `requested_by` and `approver_id` only, and `decided_at` is a timestamp.

| Column | FK | Tenant-anchored? | Live probe |
| --- | --- | --- | --- |
| `workspace_id` | `workspace(id)`, cascade/cascade | yes (the anchor) | - |
| `(workspace_id, work_item_id)` | composite to `work_item` | **yes** | see §1 |
| `transition_id` | `workflow_transition(id)`, ON DELETE RESTRICT | **no**: `workflow_transition` has no `workspace_id` (path: `version_id -> workflow_version.workflow_id -> workflow.workspace_id`) | insert ws=A, item=A, transition=**wsB-tr**: **accepted** |
| `requested_by` | `person(id)`, RESTRICT | **no**: `person` is organisation-scoped (`organisation_id`) and has no workspace | insert with a person from **another organisation** (`orgX`, side `customer`): **accepted** |
| `approver_id` | `person(id)`, RESTRICT | **no**, same as above | accepted, as above |

- A cross-tenant transition also produces a cross-tenant RESTRICT coupling. Tenant A's approval blocked deleting tenant B's transition (probe: 23001). This is a small integrity and denial-of-service side effect if S3 ever writes such a row.
- The ledger records the `transition_id` residual honestly (0120 section, "Residual"). The person-column residual is **not** recorded anywhere in the ledger or data-model. See N-1.
- **Which of these can leak or act across tenants unless S3 checks them:**
  - **`transition_id`.** If S3 takes a transition id from the request, it could:
    - satisfy a gate on another tenant's transition;
    - read another tenant's transition metadata (name, required role, `requires_cab`) into the approval context or response;
    - pin another tenant's transition, which is the RESTRICT side effect above.
  - **`approver_id` and `requested_by`.** If S3 takes a person id from the request, it could:
    - name a person from another organisation or workspace as approver;
    - send them the approval notification, a cross-tenant data leak through notifications;
    - let them decide an approval on a work item they cannot see.
  - **Indirect lookups.** S3 must never look up an approval by `id` alone, for example a decide or withdraw link. It must always scope by `workspace_id` as well. The FK now makes that scoping trustworthy, but it does not enforce it.

### 3. Migration safety

- **Transactionality.** The production path is drizzle-orm 0.45.2 `pg-core/dialect.migrate`, which runs every pending migration in one `session.transaction`. I verified this in the installed source.
- **Orphan approval (work item missing).**
  - An orphan is only possible if the old single-column FK was bypassed, for example by `session_replication_role = replica` or a bad restore.
  - I reproduced one at 0119. The stock migrator then failed at `ALTER COLUMN "workspace_id" SET NOT NULL`.
  - It was **atomic**:
    - the history stayed at 120 rows, max `created_at` 1791609109777;
    - the `workspace_id` column was absent;
    - the old FK `approval_work_item_id_work_item_id_fk` was still present.
  - After the orphan was deleted, the migrator succeeded (121 rows). The failure is closed, loud and recoverable, and the ledger's "no preflight needed for a valid database" holds.
  - Minor: no runbook text says what to do if this happens. See N-4.
- **Soft-deleted work item.** It is backfilled correctly (`aA3` -> wsA, `deleted_at` set), because the backfill joins regardless of `deleted_at`.
- **Pre-existing cross-tenant transition rows.**
  - A pre-0120 approval with a wsB transition on a wsA item (`aXpre`) is **silently carried forward**. It gets the item's workspace, and the transition mismatch is not detected.
  - This is not a real-world risk: `grep` finds no writer of `approval` anywhere in the repository (runtime, seeds or scripts) except the two test files, so every real environment holds zero rows.
  - It does mean the ledger should not imply that 0120 makes existing approval rows tenant-clean. See N-2.
- **Locks.** I listed the locks held inside one transaction after running the 0120 statements:
  - `approval`: AccessExclusive;
  - **`work_item`: AccessExclusive**, from `DROP CONSTRAINT` on the old FK and the new FK's trigger install;
  - `workspace`: ShareRowExclusive.
  - All of them are held until the migrator commits. `approval` is empty in practice, so validation is instant. The cost is the queueing: the ACCESS EXCLUSIVE request on the hot `work_item` table waits behind any long reader and blocks every later reader.
  - This is acceptable inside the upgrade window. It is operational, not a security issue. See N-3.
- **Partial failure.** Any failing statement rolls back the whole batch, as shown above. There is no window without an FK.
- **Rollback to the old image (main 954eb840).**
  - The old image's schema has no `approval.workspace_id`, so a legacy insert would fail with 23502. That failure is fail-closed, which is acceptable.
  - Moot in practice: main has **no** runtime reader or writer of `approval`. `grep` over `apps/api/src`, `packages/*/src` and scripts found only `schema.ts`; the transition controllers still hard-code `approvalSatisfied: false`.
  - The old drizzle migrator sees the last `created_at` (0120) as greater than every journal entry it knows, so it applies nothing.
  - No startup code asserts the `approval` column set.
  - Rolling back the image is safe. Rolling back the schema is not supported, because the migration is forward-only, as documented.
- **History integrity.**
  - Journal entries 0-119 are deep-equal to main.
  - 0120's `when` is 1791628167040, greater than every earlier entry.
  - The snapshot `prevId` equals the 0119 snapshot `id`, and only `public.approval` differs between the two snapshots.
  - The SQL SHA-256 `cf4bb7c0…6d029` matches the ledger.
  - `drizzle-kit check` reported "Everything's fine" and `generate` reported "No schema changes", both on a scratch copy.

### 4. The guard narrowing keeps the custom_field tables blocked

- The new regex is the old one with only the `approvalTable` and `(from|into|update|join) approval` alternatives removed. The `custom_field_*` alternatives are byte-identical, and the match is still case-insensitive, so the camelCase forms are covered.
- The self-test now asserts that `approvalTable` and `insert into approval` are **not** flagged, and that three custom_field shapes **are** flagged.
- Mutations on the exported real `apps/api/src`, using an added `src/zz/probe.ts`:
  - `import { customFieldValueTable }`: guard **fails**;
  - `` `select * from custom_field_type_visibility` ``: guard **fails**;
  - an `approvalTable` import plus `update approval`: guard passes, as intended.
- The 0119 O-1 limitations still apply to the custom_field tables: schema-qualified names, `sql.identifier`, `db.query.*`, and `packages/*` are not scanned. They are unchanged and not widened.
- **Consequence:** with approval removed from the guard, nothing machine-enforced now stops S3 from omitting the checks listed below. The only gates are the ledger residual text and S3's own review. See N-1.

### 5. Tests, replays and mutations

- Candidate tests on Postgres 18.6:
  - `approval-workspace-anchor-migration.test.ts`: 3/3 passed;
  - `tenant-composite-fks-migration.test.ts`: 2/2 passed;
  - guard: 2/2 passed.
- The test's upgrade path (0119 -> seeded legacy rows -> shipped SQL) and its clean replay are non-vacuous. My own replays with the stock migrator also passed: the S1 upgrade, the S3/S4 clean replays and the S2 orphan run.
- I ran 10 mutations of the shipped SQL. Every mutation made the test file fail:

| Mutation | Result |
| --- | --- |
| M1 composite FK -> single-column `work_item_id` FK | 2 tests fail |
| M2 backfill removed | upgrade test fails (NOT NULL) |
| M3 wrong backfill (every row -> `min(workspace.id)`) | upgrade test fails |
| M4 `SET NOT NULL` removed | 2 fail (`is_nullable`) |
| M5 composite FK ON UPDATE CASCADE | 2 fail |
| M6 old single-column FK kept | 2 fail (inventory) |
| M7 workspace FK removed | 2 fail (inventory) |
| M8 `approval_workspaceId_idx` removed | 2 fail |
| M9 composite FK ON DELETE NO ACTION | 2 fail |
| M10 composite FK DEFERRABLE INITIALLY DEFERRED | 2 fail |

- Note: M5, M9 and M10 are caught by the exact `pg_get_constraintdef` string, not by a behavioural probe. That is still a real failure, and the string is exact, so it is not vacuous.

## Findings

No BLOCKING findings.

- **N-1 (NON-BLOCKING, documentation and gate): the person columns' residual is unrecorded.**
  - Where: `docs/07-planning/migration-ledger.md`, 0120 section "Residual: `approval.transition_id`"; and `docs/01-architecture/data-model.md:413`.
  - The ledger names only `transition_id` as unanchored. `requested_by` and `approver_id` are FKs to the organisation-scoped `person` table. A person from another organisation was accepted live.
  - Scenario: S3 reads `approver_id` from a CAB or customer request body without checking membership. The database accepts it, and the notification and decision rights go to a foreign tenant.
  - Fix: extend the residual paragraph so it names both person columns and points at the S3 check list below. A one-line data-model note would also help. The S3 PR should cite this list.
- **N-2 (NON-BLOCKING): `workspace_id` and `work_item_id` are mutable as a pair, and pre-existing rows are not transition-checked.**
  - Where: `0120_approval_workspace_anchor.sql:11`; probe "update both workspace_id and work_item_id -> B": OK.
  - The database allows an approval to be re-homed to another tenant's work item if both columns change together. It keeps its tenant-A `transition_id` and persons.
  - Separately, a pre-0120 row with a foreign transition (`aXpre`) is carried through silently.
  - Both are unreachable today, because nothing writes `approval`.
  - Fix: S3 must treat both columns as immutable after insert (check 7 below). Optionally a later migration could add a BEFORE UPDATE trigger. The ledger sentence "no data preflight is needed" could say it covers FK validity only, not transition tenancy.
- **N-3 (NON-BLOCKING, operational): ACCESS EXCLUSIVE lock on `work_item`.**
  - Where: `0120_approval_workspace_anchor.sql:9` (DROP CONSTRAINT) and `:11` (ADD composite FK).
  - The lock is held until the whole migrator batch commits.
  - Fix: note it in the upgrade runbook (run in the maintenance window, or set `lock_timeout` on the migrator session). Not a security issue.
- **N-4 (NON-BLOCKING, operational): no runbook entry for the orphan failure mode.**
  - If a restored database contains an approval whose work item is missing, the upgrade fails at `SET NOT NULL` with no guidance.
  - Fix: add a read-only preflight `select a.id from approval a left join work_item w on w.id = a.work_item_id where w.id is null`, with remediation. Low value while the table is empty everywhere.

### The 0119 Opus findings checked against 0120

- **0119 N-1** (instance events must not use `notification_delivery`; keep the tenant column NOT NULL): honoured. `approval.workspace_id` is NOT NULL, so MATCH SIMPLE is never vacuous (M4 proves the test enforces it).
- **0119 N-2** (data-model drift): honoured. `data-model.md:413` records the column, both FKs, the delete and update actions and the migration number. The person-column residual is missing (N-1).
- **0119 N-3** (machine guard): approval is correctly removed from the guard now that it is anchored. The custom_field coverage is unchanged and was verified by mutation. The remaining approval residuals have no machine gate (N-1).
- **0119 O-1** (the guard is a tripwire): unchanged for the custom_field tables, not regressed.
- **0119 O-2** (stale `outbox` row in data-model): not touched by this change, still open.
- **0119 Focus-3 forward requirement** ("`approval` ... composite FKs to `work_item` and `workflow_transition`"): met for `work_item`. Not met for `workflow_transition`, which is explicitly recorded as a residual that needs a design change, with S3 carrying the check. This is a conscious and documented deviation, so I do not block on it.
- **ON UPDATE NO ACTION on the composite FK (PR #191 O1):** honoured, and M5 proves the test enforces it.
- **Atomic failure:** reproduced, as for 0119.

## S3 runtime checks (must be in S3 before it writes or reads `approval`)

1. **Workspace scoping on every read and write.** Every query on `approval` filters `approval.workspace_id = <caller's resolved workspace>`, including:
   - decide, withdraw and expire;
   - reminder jobs, as a per-workspace sweep or by carrying `workspace_id` through;
   - approver inbox lists;
   - blocked-transition context.
   S3 never looks up an approval by `id` alone, and every route runs the workspace capability check first.
2. **Work item.** On create, load the work item **by `(workspace_id, id)` from the caller's workspace**, excluding soft-deleted items (`deleted_at is null`). Insert `workspace_id` from that row, never from the request body. The composite FK backstops this check; it does not replace it.
3. **Transition (no database backstop).** The `transition_id` must be a transition of the workflow version that governs this work item:
   - join `workflow_transition -> workflow_version -> workflow` and require `workflow.workspace_id = approval.workspace_id`;
   - require the version to be the one bound to the item's type and project;
   - require `requires_approval` or `requires_cab` to be set;
   - require its `from_state_template_id` (or NULL) to match the item's current state.
   Take the transition from the server-side transition evaluation, never from a client id.
4. **Approver (no database backstop).**
   - For `kind = 'cab'`: `approver_id` must be an active member of a CAB team (`team.is_cab`) **in this workspace**.
   - For `kind = 'customer'`: it must be a person entitled to the work item in this workspace, such as the requester or an organisation contact on it, according to the approvals spec.
   - The person must be active and must not be a placeholder.
   - Never accept an arbitrary person id from the body without this check.
5. **Requester (no database backstop).** `requested_by` is the authenticated caller's person, derived from the session and never taken from the body. That person must hold the capability in this workspace.
6. **Decider.** The decide action requires the caller's person to be `approver_id` (or a delegate per spec) **and** a current member of the workspace. Re-check at decision time, because membership may have been removed since the request. The approval must be `pending` and unexpired, with a compare-and-set on `state`.
7. **Immutability.** After insert, no code path updates `workspace_id`, `work_item_id`, `transition_id`, `kind`, `requested_by` or `approver_id`. Only `state`, `decided_at`, `decision_note` and the reminder timestamps change (N-2).
8. **Notifications and events.** `approval.*` events and notification fan-out carry the approval's `workspace_id` and only target persons who passed checks 4 and 5. This is consistent with the 0119 rule that `notification_delivery.workspace_id` stays NOT NULL.
9. **Feature flag.** The approvals flag (D5 narrow exception) is resolved per **approval's** workspace, not per caller default. With the flag off, the routes are closed.
10. **Negative tests in S3.** Each of the following is refused at the HTTP layer:
    - a cross-workspace transition id;
    - a cross-organisation or non-member approver;
    - a body-supplied `requested_by`;
    - deciding as a non-approver;
    - deciding after membership removal;
    - reading or deciding another workspace's approval by id (404, not 403).

## Commands (all against the export or a disposable container; the candidate was never modified)

- `git rev-parse HEAD` -> `1305315219b66b672c4aed83a751233161d19175`; `git merge-base HEAD 954eb840…` -> `954eb84094e009658943af1e294d3b8a48d17f69`; `git diff --stat 954eb840..HEAD` (9 files); `git log --oneline 954eb840..HEAD` (3 commits).
- `git archive 1305315… | tar -x -C scratchpad/m0120-sec-export` (with `node_modules` symlinked).
- Container `docker run -d --rm --name m0120-sec-pg --tmpfs /var/lib/postgresql -e POSTGRES_PASSWORD=… -p 127.0.0.1:55420:5432 postgres:18-alpine` (PostgreSQL 18.6). Database `sec_test`.
- `env -u CI TASKDESK_DATABASE_URL=…/sec_test npx vitest run --config vitest.integration.config.ts ../../tests/api-integration/approval-workspace-anchor-migration.test.ts ../../tests/api-integration/tenant-composite-fks-migration.test.ts` -> 2 files, 5 tests passed.
- `npx vitest run --config vitest.config.ts ../../tests/api/database/unanchored-tables-unreferenced.test.ts` -> 2 passed. Then the 3 probe-file mutations (2 fail as required, 1 passes as intended).
- `node scratchpad/m0120-sec-scripts/probe.mjs <export> postgres://…:55420` ran the stock drizzle migrator against these databases:
  - S1: upgrade 0119 -> 0120 with seeded rows and a soft-deleted item;
  - S2: orphan, atomic failure, then remediation;
  - S3: 20 post-0120 probes;
  - S4: the workspace-rename cascade path;
  - S5: the `pg_locks` inventory.
- `bash scratchpad/m0120-sec-scripts/mutate.sh <export>`: 10 SQL mutations, each followed by the test file. Each was caught, and `cmp` confirmed the file was restored.
- `shasum -a 256 apps/api/drizzle/0120_approval_workspace_anchor.sql` -> `cf4bb7c041bbeb2160cf352b8102a4477cba1b3baafba0844c72bb3d6697d029`.
- A Python check of the journal (0-119 equal to main, `when` monotonic) and the snapshot (`prevId` chain, only `public.approval` changed).
- `drizzle-kit check` and `generate`, with a temporary config whose `out` pointed at a copy inside the export: "Everything's fine" and "No schema changes". `diff -rq` showed no new files, and the copy and config were deleted.
- `grep` for writers and readers of `approval` / `approvalTable` across the repository, excluding `node_modules` and migration SQL: only `schema.ts` and the two tests.
- Cleanup: `docker stop m0120-sec-pg`; `--rm` removed it and its tmpfs.
  - The container count is 22, the same as before. The only name differences are two containers that other sessions created or removed during my run (`s2-final-sec-pg` gone, `s4-sec-pg` new). I did not touch either.

## Residual risk

- `approval.transition_id`, `requested_by` and `approver_id` rely entirely on S3 application checks. There is no database constraint and no machine guard for them (N-1, N-2).
- The `workspace.id` ON UPDATE CASCADE on the new single-column FK is unreachable while the project and work_item composite FKs refuse workspace renames. If those ever become cascading, re-check that the cascades to `approval.workspace_id` and `work_item.workspace_id` happen together within one statement.
- The custom_field tables are still unanchored and are gated only by the tripwire guard (0119 O-1).

## Not checked

- The full unit, integration, permissions and contract suites. I ran only the 0119 and 0120 migration tests and the guard.
- Typecheck, biome, image build, container boot, UAT.
- CI and PR state on GitHub. I did not query `gh`, and the branch is not pushed according to the author.
- The decision-log entry's authenticity. I read it as the branch states it.
- Lock behaviour under concurrent live load on a large `work_item` table. I took only a lock inventory.
- Whether the S3 checks listed above match the approvals feature spec's exact rules for customer approvers and delegates. I derived them from the schema and general tenancy rules, so the S3 reviewer must reconcile them with the spec.

---

## Rebind at 230b8102

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:not-exposed (the same context as the review above)
**Reviewed head:** 230b8102322a76d034877ad9ca765dd55ed7bbe6
Verdict: CLEAR WITH NON-BLOCKING. The merge commit is equivalent to 13053152 for every 0120 surface. My verdict at 13053152, the findings N-1 to N-4 and the S3 runtime-check list carry over unchanged.

This is an Opus context, not GPT-6 Sol.

### Checks

1. **The 0120 delta is unchanged.**
   - 230b8102 is a merge commit. Its parents are `1305315219b66b672c4aed83a751233161d19175` and `f4f6b0114fb20594b56e1d305c59c7efef23ec15`.
   - The diffs compare byte-identical: `cmp <(git diff 954eb840 13053152) <(git diff f4f6b011 230b8102)` printed no difference.
   - The blob ids at 13053152 and 230b8102 are identical for all seven 0120 files:
     - `0120_approval_workspace_anchor.sql`;
     - `meta/_journal.json`;
     - `meta/0120_snapshot.json`;
     - `apps/api/src/database/schema.ts`;
     - `unanchored-tables-unreferenced.test.ts`;
     - `approval-workspace-anchor-migration.test.ts`;
     - `migration-ledger.md`.
   - The SQL SHA-256 at 230b8102 is still `cf4bb7c041bbeb2160cf352b8102a4477cba1b3baafba0844c72bb3d6697d029`.
2. **#623 does not interact with 0120.**
   - `954eb840..f4f6b011` is the single commit f4f6b011 (#623).
   - It changes 6 files: `install.sh`, `scripts/ci/install.test.mjs`, `docs/05-operations/{container-image,one-line-install,runbook}.md` and `docs/07-planning/security-reviews/p0-installer-rerun-fix.md`.
   - It shares no file with the 0120 change: the `comm -12` intersection is empty.
   - `git diff --name-only 13053152 230b8102` lists exactly those 6 files.
   - A grep of #623's added and removed lines for `migrat|drizzle|approval|custom_field|schema|TASKDESK_DATABASE` found no match.
   - Main added no migration, so 0120 is still the next index after 0119.
3. **The tests still pass at 230b8102, on a fresh `git archive` export and Postgres 18:**
   - the 0120 and 0119 migration tests: 2 files, 5 tests passed;
   - the guard: 1 file, 2 tests passed.

### Commands

- `git cat-file -t 230b8102…` returned `commit`. `git rev-parse 230b8102^1 230b8102^2` returned 13053152… and f4f6b011…. `git merge-base 230b8102 f4f6b011` returned f4f6b011….
- `git log --oneline 954eb840..f4f6b011`
- `git diff --name-only 954eb840 f4f6b011`
- `git diff --name-only 13053152 230b8102`
- `cmp <(git diff 954eb840 13053152) <(git diff f4f6b011 230b8102)`
- `comm -12 <(git diff --name-only 954eb840 13053152|sort) <(git diff --name-only 954eb840 f4f6b011|sort)`
- `git diff 954eb840 f4f6b011 | grep -E '^[+-]' | grep -iE 'migrat|drizzle|approval|custom_field|schema|TASKDESK_DATABASE'`
- `git rev-parse 13053152:<f>` compared with `git rev-parse 230b8102:<f>` for each of the 7 files.
- `git show 230b8102:apps/api/drizzle/0120_approval_workspace_anchor.sql | shasum -a 256`
- `git archive 230b8102… | tar -x -C scratchpad/m0120-rebind-export`, with `node_modules` symlinked.
- `docker run -d --rm --name m0120-sec-pg --tmpfs /var/lib/postgresql … postgres:18-alpine`, then `create database sec_test`.
- `env -u CI TASKDESK_DATABASE_URL=…/sec_test npx vitest run --config vitest.integration.config.ts ../../tests/api-integration/approval-workspace-anchor-migration.test.ts ../../tests/api-integration/tenant-composite-fks-migration.test.ts`
- `npx vitest run --config vitest.config.ts ../../tests/api/database/unanchored-tables-unreferenced.test.ts`
- `docker stop m0120-sec-pg`. The `--rm` flag removed it, and it is no longer listed. I deleted the export.
- The candidate worktree is clean: `git status --short` returned 0 lines.

### Not re-run

- The live probes, the 10 mutations and drizzle-kit `check`/`generate`. Every 0120 file is the same blob as at 13053152, so those results carry over.
- CI and GitHub state.
- #623's own installer test. It is outside the 0120 scope.
<!-- END REPORT (sha256 b0cf982fb68fe9b2641d58b8dc93d187252996b8644152e6c19a90d903d4ff3f) -->
