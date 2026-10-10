# M1 migration spine 0088–0118 — review record

**Reviewed head:** `efcc201719bbfcf1b189c9243750cfe6ac623181`

M1 lands the post-P0 migration spine 0088–0118 with the matching schema declarations, an operator runbook entry for 0093, the migration ledger, a negative test and the owner-decision record. The SQL is byte-identical to #589 (`2350397b`). It follows owner decisions D3/D5 (decision log, 2026-10-10).

- **Implementation:** Claude Sonnet context `aca54d9e5bc615971`, directed by the Claude Opus conductor.
- **Ordinary review:** three independent Claude Sonnet contexts (A, B, C).
- **Security review:** Claude Opus 5.5 (`claude-opus-5-5`) context `a3bc54a26659d3e77`, Sol tier under Thomas's routing. It is not a GPT-6 Sol review.

Each report below was written by its reviewer to its own file and is inserted unmodified, with its SHA-256.

<!-- BEGIN REPORT (agent a25fbefd3adf334c1; model claude-sonnet-5-5; role ordinary review A (static); candidate 5a35dd1072db8ca95c8c20701f667f0ede356fe3; sha256 29c1114fa8e6af3dfaaca001d654505e4490018855e5cf31b8801beb04e71243) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: independent ordinary reviewer A, fresh context (session 3a9e9ce4 subagent), read-only and static
Candidate: worktree /private/tmp/claude-501/m1-spine, branch claude/m1-migration-spine
Reviewed head: 5a35dd1072db8ca95c8c20701f667f0ede356fe3 (two commits over main 26c43def6bede50a4d831801d34a59433cbfc891: 3595cbda feat(db) and 5a35dd10 docs)
Verdict: CLEAR WITH NON-BLOCKING

No blocking defect was found in the migration spine itself. Four non-blocking items are listed under Findings.

## Method
Static only: git object comparison, JSON and hash checks with python, grep, and reading the diffs. No database, Docker, tsc, vitest or drizzle-kit was run. Whether the TS typechecks and the tests pass is left to reviewer B and CI.

## Check 1. Main 0-87 are byte-unchanged: PASS
- `git diff --name-status 26c43def..HEAD -- apps/api/drizzle` shows only `A` entries plus one `M`, `meta/_journal.json`. No `.sql` or snapshot from 0000-0087 is modified, deleted or renamed.
- `_journal.json` diff is 217 insertions and 0 deletions. Its first 88 entries equal main's exactly. `version` and `dialect` are unchanged.

## Check 2. 0088-0118 are byte-identical to 2350397b: PASS
- Per-file git blob ids for every 0088-0118 `.sql` and `_snapshot.json` equal 2350397b's.
- `git diff 2350397b HEAD -- apps/api/drizzle` is empty, so the whole directory including the journal is identical.
- Journal: 119 entries, idx 0..118 contiguous. Every journal tag has an `.sql` file. Every 0088-0118 entry has a snapshot. The snapshot `prevId` chain 0088..0118 is unbroken, and 0087's `id` equals 0088's `prevId`.
- `when` is strictly increasing from idx 87 (1791107747302) through idx 118 (1791344327180). It is not strictly increasing across the whole file. Three inherited inversions exist in main's range (idx 5/6, 24/25, 25/26) and are unchanged. They are already applied and harmless (the draft ledger notes this too).
- Recomputed SHA-256 of all 31 `.sql` files against the 31 rows in docs/07-planning/migration-ledger.md. Tag, `when` and hash all match.

## Check 3. Excluded units are absent: PASS
- No file or journal tag matches PROVISIONAL, `canonical_vocabulary` or `pending_action_expiry`.
- The journal at idx 88-118 uses only the train's tags. 0102 is `0102_productive_hawkeye`, whose only statement is `attachment ADD COLUMN submission_field_key`. There is no #513/#611 0087-0101 shift, and no #569 0080-0082 unit.
- `sla_pause` is created exactly once, in `0104_moaning_marvex.sql`:
  - primary key `(work_item_id, metric, started_at)`
  - CHECKs for metric, reason and ended-after-started
  - FK `ON DELETE cascade ON UPDATE cascade`
  - partial unique index `sla_pause_one_open_per_work_item_metric_unique` where `ended_at is null`

  This matches D3. `migration-schema.ts` (`slaPauseTable`) is consistent with it.
- 0112 is `sla_policy_workspace_fks`, not #608's no-op.

## Check 4. Schema TS: PASS, with caveats under Findings
- `drizzle.config.ts`, `schema.ts`, `migration-schema.ts` and `shadow-schema.ts` at HEAD are byte-identical to 2350397b (empty diff for all four).
- Against main:
  - `drizzle.config.ts` changes `schema` from a string to a three-file array (schema.ts, migration-schema.ts, shadow-schema.ts). This is config, not app code.
  - `migration-schema.ts` is new, 299 lines. It declares 5 tables only (custom_field_section, custom_field, custom_field_type_visibility, custom_field_value, sla_pause). It imports only drizzle-orm and `./schema`. It is referenced only from `drizzle.config.ts`, so it is not in any runtime import path.
  - `schema.ts` grows from 3621 to 5518 lines. Its non-table top-level code is the same as main's plus five small FK-thunk helpers.
    - Helpers at lines 191-205: `slaPolicyWorkspaceColumn`, `slaPolicyIdColumn`, `slaPolicyVersionWorkspaceColumn`, `slaPolicyVersionPolicyIdColumn`, `slaPolicyVersionIdColumn`. Each returns `AnyPgColumn` for a lazy FK reference. This is declaration support, not app logic.
    - The `export const user = userTable;` aliases and the `*Relations` blocks (HEAD lines ~5424-5520) are unchanged from main's. No new relations were added.
  - Comparing the 0118 snapshot's tables with the `pgTable("...")` names across the three files, all 100 snapshot tables are declared in TS and none is missing. 63 on main became 100 (37 new).
  - `shadow-schema.ts` changes only check-expression and index serialization, with no table or column change: `sql\`${table.x} IN (...)\`` became `sql.raw("outcome = ANY (ARRAY[...])")`, and `.desc()` became `.desc().nullsFirst()`. These are drizzle-kit metadata and have no runtime effect. The file is imported by the permissions code, so the edit is not in a purely isolated file (see Finding 3).
- No route, controller, service, repository, jobs or exported runtime function was added. `git diff --name-status 26c43def..HEAD` outside `apps/api/drizzle/` lists exactly: `drizzle.config.ts`, `migration-schema.ts` (A), `schema.ts`, `shadow-schema.ts`, `decision-log.md`, `migration-ledger.md` (A), and two tests.
- Changes to pre-existing tables in schema.ts (confirmed by diffing snapshot 0087 with 0118):
  - Real DDL from 0088-0118: new columns and constraints on attachment, instance_setting, notification, outbox, person, project, session, team, work_item and workspace; membership index swap; service_calendar unique; and others.
  - Drift reconciliation to DDL already applied on main. None of these is a 0088-0118 SQL change:
    - `apikey.reference_id` becomes nullable (0028).
    - `label.workspace_id` becomes NOT NULL (0005 line 73).
    - `user.email_verified` gets default false (0003 line 68).
    - `organisation_quota.max_storage_bytes` default is rendered as a string.
    - `workspace_member_role_single_value` CHECK (0050) is declared.
  - Many index and check differences are pure snapshot normalization. Examples: `"person"."user_id" is not null` became `(user_id IS NOT NULL)`, and `coalesce("workspace_id", '')` became `COALESCE(workspace_id, ''::text)`. No SQL changes.
- Large comment deletion: roughly 1355 lines were removed from schema.ts. Many were long design-rationale comments on existing tables, for example the workspace organisation_id and membership index notes. This is a documentation loss and also makes the diff against main very noisy. See Finding 3.

## Check 5. Test edits: PASS, one weakening and one wrong comment
- `work-item-schema.test.ts:257-264`: the column count 29 to 30 is correct. The 0087 snapshot has 29 columns on `work_item` and 0118 has 30. The only added column is `sla_policy_version_id` (0089). The assertion is not loosened (still an exact count).
- `work-item-assignable.test.ts` "AS-1": the old scenario inserted a second `membership` row for the same `(person, project, project)` with a higher-rank role and asserted the person appears once with the most-privileged role. That setup now violates 0093's unique index, so it had to change. The new test uses one project-admin roster row linked to a user and asserts length 1 and `roleName` "Project Admin". It does not weaken any other test. It does stop exercising the controller's "collapse duplicate memberships to the highest rank" path, which is now unreachable by DB constraint. It also uses `addWorkspaceMember` with a linked user, which is a different path from the old person-only setup. See Findings 1 and 2.

## Check 6. Ledger and decision log: mostly accurate
- docs/07-planning/migration-ledger.md: the 31 rows match the journal and recomputed hashes, and the claims about excluded units and the D3 shape match the tree. "`when` is strictly increasing from idx 87 to 118" is true as scoped.
- Decision-log entry: inserted at the top of `docs/07-planning/decision-log.md`, above the other 2026-10-10 entry. Newest-first holds. The scope is truthful about what it covers: D3, D5, D2 and D6 decisions plus the conductor allocation. It states what is not decided (D1, D9, D10). The "conformed" statements about #611 describe future work and are not claims about this diff. It records "directly to the conductor session"; I cannot verify that offline.
- Inconsistency (non-blocking): the ledger's "Decisions applied" paragraph says "D3 and D5 ... neither is recorded in decision-log.md yet. The conductor records them there." The second commit (5a35dd10) does record them, so that sentence is now stale.
- Unverifiable claim: "drizzle-kit generate reports no schema changes and drizzle-kit check passes at idx 118". It is plausible (snapshots, schema and config align) but no evidence is cited and I did not run it.

## Check 7. Risk review of 0093 and destructive SQL
- 0093 (`0093_mature_exodus.sql`): `DROP INDEX membership_personId_scope_scopeId_idx;` then `CREATE UNIQUE INDEX membership_person_scope_scope_id_unique ON membership(person_id, scope, scope_id)`. Both statements are in one drizzle transaction. It will fail, rolling back the migration, if any duplicate `(person_id, scope, scope_id)` rows exist.
- A preflight is documented in the ledger under "Notes for future allocation" (docs/07-planning/migration-ledger.md): `select person_id, scope, scope_id, count(*) from membership group by 1,2,3 having count(*) > 1;` must return no rows. There is no remediation, such as a dedupe rule or a repair script. It is also not in the deployment runbook. See Finding 1.
- Other things that run against existing rows, none a DROP TABLE, DROP COLUMN or DELETE:
  - 0099 `UPDATE "submission" SET submitted_at = created_at` (the train's own table, new in 0096).
  - 0100 `UPDATE "request_type_version" ... auto_accept` (new train table).
  - 0113 adds `project.kind NOT NULL DEFAULT 'project'`, which is safe.
  - 0110 `ALTER COLUMN outbox.workspace_id DROP NOT NULL` is relaxing; 0111 replaces its CHECK.
  - 0109 adds a CHECK on `pending_action.action`; 0099 and 0107 re-create CHECKs on submission and membership_grant. Each will fail only if existing rows violate it.
  - 0112 drops four FKs and re-adds them as composite workspace-scoped FKs. These could fail on cross-workspace data, though the `sla_*` tables are new in 0088 and the referencing columns were added in the same train, so they should be empty.
- Constraint or index drops: 0091 (FK drop and re-add), 0092, 0094, 0106 and 0108 (`step_up_operation_route` drop and re-add), 0093 (index swap), 0096 (`provisioning_event_kind_check`), 0107, 0109, 0111, 0112.
- No DROP TABLE, DROP COLUMN, TRUNCATE or DELETE FROM in 0088-0118.

## Findings
1. Non-blocking. 0093 unique index has a documented preflight but no remediation, and the preflight lives only in the ledger. If SIT or DEV holds duplicate membership rows, the first deploy fails and the migration transaction rolls back. Recommend adding the preflight query to the deployment runbook and recording the SIT and DEV results before rollout. Ledger: docs/07-planning/migration-ledger.md, "Notes for future allocation".
2. Non-blocking. `tests/api-integration/work-item-schema.test.ts:257-258` comment is wrong: "migration 0054 added first_response_at". 0054 is in main's 0-87 and is already in main's 29 columns (0087 snapshot has `first_response_at`). The +1 comes from 0089 (`sla_policy_version_id`). Correct the comment. Also the AS-1 rewrite in `tests/api-integration/work-item-assignable.test.ts:340-358` silently drops coverage of the duplicate-collapse branch, with no comment saying why (0093). The behaviour the AS-1 name described is no longer tested, though the DB now forbids the scenario.
3. Non-blocking. schema.ts was regenerated rather than edited: about 1355 deleted lines, mostly design-rationale comments on existing tables, plus `sql\`${table.x}\`` templates turned into `sql.raw` strings. This is a one-way reduction in code documentation and makes future blame harder. It also edits `shadow-schema.ts` (runtime-imported by permissions code) and existing-table TS types:
   - `apikey.referenceId` nullable
   - `label.workspaceId` not null
   - `user.emailVerified` default false

   They match already-applied DDL, but they can change inferred insert and select types in app code. Typecheck must be confirmed by reviewer B and CI (`tsc` of apps/api and tests). I did not run it.
4. Non-blocking. The ledger's "Decisions applied" sentence that D3 and D5 are not yet in the decision log (docs/07-planning/migration-ledger.md) is stale after commit 5a35dd10. The `drizzle-kit generate` and `drizzle-kit check` claim carries no evidence reference.

## Not checked
- DB behaviour: migration apply on an empty DB and on a populated one, `drizzle-kit generate` and `check` output, `__drizzle_migrations` hash comparison on DEV and SIT, and whether any environment already applied different `when` values for these tags.
- TypeScript compile, lint and the full test suite, including whether any other test or seed inserts duplicate memberships or relies on the old non-unique index.
- Whether SIT or DEV actually contain duplicate `membership` rows.
- The provenance claims in the ledger table (source PR per unit). I only cross-checked the draft's blob and SHA-256 prefixes for a sample and the full SHA-256 table against HEAD.
- Whether `apps/api/src/index.ts` and the other locally modified files in the main worktree (git status) matter. The candidate worktree's HEAD does not touch them.
<!-- END REPORT a25fbefd3adf334c1 5a35dd10 -->

<!-- BEGIN REPORT (agent a4048263d2a323430; model claude-sonnet-5-5; role ordinary review B (runtime); candidate 5a35dd1072db8ca95c8c20701f667f0ede356fe3; sha256 305c3dd9c36633bb3d63afcc3f1edd0e030d9bee1669c9696297d206f5c690bc) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: fresh independent reviewer B context (session 3a9e9ce4-8409-47d4-b1be-1f1544697e70, reviewer-B sub-agent; did not author, direct or remediate the candidate)
Candidate: M1 migration spine, worktree /private/tmp/claude-501/m1-spine
Reviewed head: 5a35dd1072db8ca95c8c20701f667f0ede356fe3 (verified with `git rev-parse HEAD`; worktree clean, 0 modified files, before and after)
Comparison base: main 26c43def
Verdict: APPROVE (ordinary review, runtime verification). No blocking findings. Two non-blocking notes below.

## Method and isolation
- Exports: `git archive HEAD` into scratchpad/b-new, `git archive 26c43def` into scratchpad/b-main. node_modules were symlinked read-only from the worktree. The worktree was never edited.
- One container `m1review-b-pg` (postgres:18-alpine) on 127.0.0.1:55442. Databases created inside it: clean, up, neg1, neg2, m1b_test.
- Docker count: 19 before I started, 19 + mine while it ran, 19 after `docker rm -f m1review-b-pg`. No other container touched, no prune, no context change.
- Migrator: the stock `drizzle-orm/node-postgres/migrator` `migrate()` with `migrationsFolder: apps/api/drizzle`. This is the same call as apps/api/src/index.ts:1627 and tests/api-integration/helpers/database.ts. I wrote my own 10-line driver (scratchpad/b-mig.mjs); I did not use the author's scripts.

## 1. Clean bootstrap 0-118
- `node b-mig.mjs b-new .../clean` printed `MIGRATE OK`.
- `__drizzle_migrations`: 119 rows, max created_at 1791344327180 (= journal idx 118 `when`).
- Each row's hash compared with SHA-256 of its `.sql` file, in journal order: 119 compared, 0 mismatches.
- All 31 SQL SHA-256 values in docs/07-planning/migration-ledger.md (idx 88-118) match the files: 0 missing.
- Journal: entries 0-87 are byte-identical to main's journal (`n[:88] == m` is true). `when` is strictly increasing across idx 88-118, and max main when 1791107747302 < idx 88 when 1791107748302. The non-monotonic `when` at idx 6, 25 and 26 is inherited from main and is unchanged. It does not affect a clean run (all 119 applied), and the ledger does not hide it.
- The `git diff 26c43def..HEAD` change to the journal is append-only. The only modified file under apps/api/drizzle is meta/_journal.json; all other drizzle files are additions.

## 2. Upgrade main(88) -> 118 with data
- Applied main 88 to DB `up` (88 rows). Seeded, with real FKs and CHECKs: 1 organisation, 2 users, 2 workspaces, 2 persons, 1 role, 3 memberships (all distinct person/scope/scope_id), 2 projects, state_template, state, work_item_type, 2 work_item_key_claim, 2 work_items, 1 notification, 1 session, 1 team, 1 outbox row (scratchpad/b-seed-up.sql).
- Upgraded with the same migrator: `MIGRATE OK`, 119 rows. The hash list is byte-identical to the clean DB's list (`cmp` equal).
- Row dump before and after (16 tables): the only differences are appended columns, with every pre-existing value unchanged (diff b-before.txt b-after.txt).
- Backfills and defaults observed on existing rows:
  - project.kind = 'project' for both rows (0113 default); health, support_level, service_calendar_id and sla_policy_id are NULL.
  - work_item.sla_policy_version_id is NULL, workspace.default_sla_policy_id is NULL, workspace.deleted_at and purge_after are NULL.
  - team.is_cab = false (0116).
  - outbox.created_at and updated_at are populated, set to migration time (see NB-2).
  - notification.person_id, event_id, kind, body and read_at are NULL on the legacy row (see NB-2).
  - session.identity_connection_id and person.display_name are NULL.
  - instance_feature_flag has 21 rows, all enabled=false, locked=false; the clean DB has the same rows (md5 of the rows equal).
  - instance_setting.approval_default_expiry_days = 7.
  - submission_number_seq: last_value 1, is_called false. This is correct, because the submission table is empty at upgrade.
- 0099 and 0100 backfills (submission.submitted_at, request_type_version.auto_accept) have no rows to act on in an upgrade from main, because those tables are created in 0096. They are inert on this path. I did not exercise them with data, and that is not possible via an upgrade from 87.

## 3. Schema parity
- `pg_dump -s --no-owner --no-privileges` of `clean` and `up`: 6751 lines each. `diff` shows only the random `\restrict` and `\unrestrict` tokens differing. The schema is otherwise IDENTICAL.

## 4. Negative cases
a) Duplicate membership before 0093 (DB neg1):
- Applied main 88, seeded the data, then inserted a duplicate row (`m1dup`, p1/workspace/ws1; the pre-0093 index is non-unique, so it was accepted). Ran the upgrade.
- It failed cleanly: `could not create unique index "membership_person_scope_scope_id_unique"`.
- It is transactional. After the failure: `__drizzle_migrations` still has 88 rows; no sla_policy, sla_goal, request_type or membership_grant tables exist; project has no sla_policy_id or kind column; membership indexes are still the old four (including the non-unique `membership_personId_scope_scopeId_idx`); membership still has 4 rows. So 0088-0092 were rolled back together with 0093, with no partial state.
- Remediation: deleting the duplicate and re-running gives `MIGRATE OK` with 119 rows. The remediation is documented in migration-ledger.md "Notes for future allocation". It gives a preflight query (`select person_id, scope, scope_id, count(*) ... having count(*) > 1`, which must return no rows), but it does not say which duplicate to keep. It is not in docs/05-operations; I grepped and found nothing there. See NB-1.
- App-level exposure: I found no `insert(...membershipTable)` in apps/api/src non-test code (membership is read-only in this tree), so the new unique index should not newly break a runtime writer. The suite is green, including the changed AS-1 test that no longer creates two membership rows for one person and scope.

b) sla_pause (DB neg2, clean 118; real work_item rows):
- A second open pause for the same work_item and metric, even with a different started_at, is rejected: `duplicate key ... "sla_pause_one_open_per_work_item_metric_unique"`.
- Accepted: an open pause on a different metric, an open pause on a different work item, and a new open pause after the previous one is closed.
- Rejected: ended_at before started_at (`sla_pause_ended_after_started`) and a bad metric (`sla_pause_metric_allowed`).
- Deleting the work_item cascades to its sla_pause rows (count 0).

## 5. Drift, typecheck, integration
- `drizzle-kit check` (in b-new/apps/api, against clean): "Everything's fine".
- `drizzle-kit generate`: "No schema changes, nothing to migrate". The drizzle directory still has 120 entries, so no files were generated.
- `npm run typecheck` (4 tsc projects), after linking the per-package node_modules: EXIT 0, no errors. My first attempt failed on unresolved `better-auth/plugins/access` only because my export lacked packages/permissions/node_modules. That was a harness issue, not a candidate defect.
- Integration suite against private DB `m1b_test` in my container, `vitest run --config vitest.integration.config.ts` (CI unset, so no Testcontainers): Test Files 138 passed (138), Tests 1674 passed (1674), 440.7 s, exit 0. This includes work-item-schema.test.ts (work_item has 30 columns, which I confirmed on the clean DB) and work-item-assignable.test.ts, both changed by the candidate.

## Findings
BLOCKING: none.

NON-BLOCKING:
- NB-1: Migration 0093 aborts the whole upgrade (including 0088-0092) on any database with duplicate membership rows. The only mitigation text is the preflight query in migration-ledger.md. It gives no guidance on which row to keep and is not in an operator-facing runbook (docs/05-operations). The API also runs the migration at startup, so an affected deployment would fail to boot. Recommend copying the preflight and a dedupe policy into the upgrade or deployment runbook before any non-greenfield deployment. It is safe, because the failure is atomic, but it is a surprising operational failure mode.
- NB-2: Legacy rows are not backfilled for new columns. Existing `notification` rows get NULL person_id, kind and body (0114), and existing `outbox` rows get created_at and updated_at = migration time rather than any original time (0115). The ledger says no runtime code is included, so this is inert now, but whichever PR adds the person-keyed notification runtime should decide how to treat the legacy rows.
- Observation, not a defect: the `when` ordering anomalies at idx 6, 25 and 26 are inherited from main. Drizzle's migrator only compares against the latest applied created_at, so this matters only for partially migrated databases, as the ledger already notes for future allocation.

## Not checked
- Upgrade paths starting from any state other than exactly main's 88 migrations (for example a database that already holds some of the train's 0088+ units from #585 or #589). Any DEV or UAT database was deliberately not touched.
- The 0099 and 0100 backfills against populated submission or request_type_version tables (unreachable from main).
- Production-scale timing and lock behaviour (0103 trigram index and the 0114 notification ALTERs on large tables).
- The unit, permissions and rls-prototype test suites, the web app, and the Docker image build and boot.
- Review of the full schema.ts (4,600-line diff) beyond what drizzle-kit check and generate verify mechanically. SQL semantics of units I did not run data through (0090, 0096, 0098, 0114 and 0118 table definitions) are verified only by clean-versus-upgraded parity and the green integration suite.
- Security review. That is the separate GPT-6 Sol gate and not this role.

## Cleanup proof
`docker rm -f m1review-b-pg` printed the container name; `docker ps -aq | wc -l` = 19 afterwards (19 before). The worktree is unchanged at 5a35dd1072db8ca95c8c20701f667f0ede356fe3 with a clean status. Scratch exports and logs remain only in the scratchpad directory.
<!-- END REPORT a4048263d2a323430 5a35dd10 -->

<!-- BEGIN REPORT (agent ae0b9c994e122dd06; model claude-sonnet-5-5; role ordinary review C; candidate d27aa02ad5a081cd1be4a2e1510f32118c3b3027; sha256 5dfc06a92fd555850daf00f697fe495ec0a338b806c7f6420d76bfb5fe5d1044) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: M1 ordinary reviewer C (fresh context, read-only, Luna tier)
Candidate: /private/tmp/claude-501/m1-spine, HEAD d27aa02ad5a081cd1be4a2e1510f32118c3b3027 (verified); base main 26c43def
Verdict: CLEAR WITH NON-BLOCKING (no blocking finding; 3 non-blocking docs/comment corrections recommended before or right after merge)

## 1. App-code impact of schema.ts type corrections: no behavioural or type break found

Typecheck: exported base (26c43def) and head (d27aa02a) with `git archive`, linked node_modules, ran all four API tsconfigs (main, permissions, tests, rls-prototype). Error sets are identical at base and head after stripping line numbers (23/20/20/20 errors, all environmental: missing `ws`, `pino`, `prom-client`, `@hono/node-server` upgradeWebSocket, stale linked `@taskdesk/permissions` types). Zero new errors, zero changed errors.

Consumer review:
- apikey.referenceId nullable, FK removed: no migration ever created the FK or NOT NULL (0013 adds `reference_id text`; 0118 snapshot has no apikey reference FK), so this matches the DB. Consumers are all `eq(apikeyTable.referenceId, x)` (workspace-access-middleware.ts:527, validate-workspace-access.ts:18, pending-action/service.ts:284/357/743, instance/reset-mfa.ts:160), unaffected by nullability. verify-api-key.ts:65 already uses `apiKey.referenceId ?? apiKey.userId ?? ""`. relations.ts:426 `one(user, {fields:[referenceId]})` still fine. Test inserts all pass a referenceId.
- label.workspaceId NOT NULL: matches 0005 SET NOT NULL. Every insert (create-label.ts:60/90, assign-label-to-task.ts:179) already supplies it (typecheck clean). The `if (!label.workspaceId)` guard at assign-label-to-task.ts:40 is now dead but harmless; the `!==` comparisons in update/delete/unassign are unaffected.
- outbox.workspaceId nullable: sole writer events/outbox.ts:38 still rejects a missing workspace before insert; no reader of outbox rows exists in src. New createdAt/updatedAt are defaulted so the insert type is unchanged. No change in behaviour.
- attachment: commentId/submissionId FKs (0096, ON DELETE cascade) and submissionFieldKey (nullable, 0102). All five controllers only use workItemId, state, uploadedBy; insert in presign-attachment.ts:209 unaffected (nullable columns optional). Observation only: deleting a comment/submission will now cascade attachment rows without storage-object cleanup; no runtime path creates such attachments yet (policy.ts is work-item only), so inert until the comment/submission attach feature lands.
- workspace columns + composite FK: deletedAt/purgeAfter/defaultSlaPolicyId are nullable with no insert impact; FK `(id, default_sla_policy_id) -> sla_policy(workspace_id, id)` is MATCH SIMPLE so a NULL default passes. Lazy thunk helpers (slaPolicyWorkspaceColumn etc.) are evaluated at drizzle-kit/relations time only; typecheck confirms they resolve.
- user.emailVerified: see N3.

## 2. Runbook "Upgrading across migration 0093"

Verified: migrator wraps all pending migrations in one `session.transaction` (drizzle-orm pg-core dialect.js migrate), so the abort-is-atomic claim is correct; migrate runs at API startup per index.ts; 0093 SQL matches the description; the heading anchor used by the ledger resolves; backup-and-restore.md exists.

Executed the exact `begin ... commit` block from runbook.md on PGlite 0.3.15 against a mock membership/role table (rows: low-rank direct with sees_all + higher-rank inherited; exact duplicate pair; singleton). SQL parses and runs; plan select works; sees_all carried to kept row; only keep_order>1 rows deleted; singleton untouched; temp table dropped on commit. Tie-break order (rank desc, direct first, created_at, id) is deterministic and consistent with list-assignable-people.ts:114-118 (sort by rank desc, first row per person wins; the app's tie order is just DB order, so the runbook is strictly more deterministic).

- NON-BLOCKING N1 (docs/05-operations/runbook.md ~lines 250-256, 285-290): the claim "chosen the way the application already collapses duplicates" is only true for the assignable-people display. Runtime authorisation does not collapse: resolve-identity.ts:491-530 pushes one authority grant per membership row, so capabilities are the union across duplicate rows. Deleting a lower-rank row can therefore drop capabilities a custom higher-rank role lacks, and "no access is lost" only covers sees_all. Reproduced a second case in the PGlite run: direct row (rank 10) and inherited row (`inherited_from` set, rank 30) in one group; the plan keeps the inherited row and deletes the direct one, so when the source ancestor membership is later removed the user loses access they held directly. Suggest: (a) say the collapse is display-only, (b) add a pre-commit check that lists groups whose rows have different `role_id` or whose kept row has `inherited_from`/`derived_from` set and require manual review of those, or prefer a direct row over a higher-rank inherited one. Low likelihood (no app code writes inherited_from today) but this is exactly the "delete a membership that should be kept" case the task asked about.
- NON-BLOCKING N2 (runbook.md:292): "Before 0093 no table references `membership`, so the delete cannot cascade" is false for a database that already applied 0090-0092: 0090 adds `membership_grant.membership_id` and `scim_group_member.membership_id` FKs to membership (ON DELETE SET NULL, drizzle/0090_unique_the_stranger.sql:163,183). Not a cascade delete, but it would null provenance links. Safe for upgrades from main (<=0087), which is the documented case; reword to "when upgrading from <=0087" or note SET NULL.
- NON-BLOCKING N2b (runbook.md:253-254, 258): the prose says "review the printed plan before the commit", but the block is a single paste; in psql that commits with no pause. Say to run through the review select first, then the update/delete/commit separately (or end the block at the select and put update/delete/commit in a second block).

## 3. Author claims in d27aa02a / ledger

Note d27aa02a itself does not touch schema.ts; the comment removals are in 3595cbda and the ledger claim is in migration-ledger.md.

- "Three comment blocks (about 16 lines) ... stated sla_policy and the attachment foreign keys do not exist yet": I diffed the set of comment lines in schema.ts main vs head (whitespace-normalised, moved workspace comments excluded). Dropped-but-not-reappearing comments are exactly three blocks, and the count is about right (2 + 9 + 7 = 18 lines), but the ledger names the wrong third block. The blocks are: (1) workItemType `sla_policy ... still P5 scope and does not exist yet` (false: sla_policy created in 0088, FK in 0089/0112); (2) attachment header (9 lines) saying comment and submission tables do not exist and FKs are future (false: submission created in 0088-0118 range, comment/submission FKs 0096); (3) workItem "Deliberately NOT added here: GIN trigram title index ... generated search_vector" (false for the trigram index: 0103 `work_item_title_trgm_idx`; schema.ts:3750 now carries a replacement note). The ledger says "sla_policy and the attachment foreign keys" and omits block 3. Factually minor; correct the sentence.
- The removal was correct for all three, but one false statement of the same class was missed (NON-BLOCKING N3a): schema.ts:2163-2164 (membership.derivedFrom) still says "`scim_group_member` is P3 SCIM-provisioning scope and does not exist yet", while scimGroupMemberTable is declared at schema.ts:2754 and created by 0090. The remaining work_item comments at 3670-3671 and 3679-3681 (service, estimate_point, cycle, module do not exist) are still true (no such CREATE TABLE in 0088-0118). Also src/attachment/policy.ts:5-9 still says comment/submission tables do not exist (outside the diff, now stale; non-blocking).
- NON-BLOCKING N3b (ledger, migration-ledger.md "`user.emailVerified` is unchanged"): inaccurate. Main had only `.$defaultFn(() => false)`; head adds `.default(false)` (schema.ts:36-38 vs main:33-35; diff hunk at schema.ts line ~35). So the task framing "already defaulted on main" is half true: an app-side default existed, the DB-side default is new in the declaration (and matches the introspected snapshot). Insert type is unchanged (optional both ways), so no behavioural impact; fix the ledger wording.
- maxStorageBytes `sql.raw("21474836480")` "serialization form only": confirmed (0052 DEFAULT 21474836480; mode:number select type unchanged). The "20 GiB ... hence bigint" comment was dropped; harmless.
- AS-1 test comment claim ("collapse code can no longer fire on a database with the unique index"): correct; the query is filtered to one scope/scope_id, so unique (person, scope, scope_id) means at most one row per person. The rewritten AS-1 uses `linkedUserId`, which the helper supports. work_item column count 30 and "0089 added sla_policy_version_id" are correct (0089 line 2).

## 4. Ledger and decision log at final head

- Recomputed SHA-256 of every `.sql` for idx 88-118 and matched tag + journal `when` + hash against the ledger table: all 31 rows match. Journal idx 0-87 unchanged (diff is additions only); max `when` of idx 0-87 is 1791107747302 at idx 87; `when` strictly increasing 87->118; final 1791344327180 as stated. Non-monotonic `when` at idx 6, 25, 26 predate this change (not claimed by the ledger).
- Snapshot-less migrations 0006, 0014, 0016, 0020, 0024, 0025, 0043, 0050, 0051, 0071: matches the directory exactly.
- Type-correction table (apikey, label, outbox, membership index, attachment, workspace, quota default): each justification checked against the cited migration; all correct.
- D3 text in decision log and ledger matches 0104_moaning_marvex.sql (composite PK, metric/reason/ended-after-started CHECKs, FK cascade/cascade, partial unique one-open index). Decision-log entry is placed newest-first, names what it holds/supersedes, no older entries rewritten. D5/D2/D6 are recorded; ledger references to them and to AGENTS.md#authority (exists, line 49) resolve.
- Only inaccuracies: N3 (third comment block mis-named) and N3b (emailVerified).

## Commands run
git rev-parse HEAD; git diff/--stat/log 26c43def..HEAD; git archive of base and head to the scratchpad (c-base, c-export) with linked node_modules; `npx tsc --noEmit -p tsconfig{,.permissions,.tests,.rls-prototype}.json` on both, error sets diffed; grep of apps/api/src for apikeyTable/referenceId/labelTable/outboxTable/attachmentTable/inheritedFrom; comm-based comment-set diff of schema.ts main vs head; PGlite script running the runbook SQL; node script hashing all 31 migration SQL files and cross-checking journal and ledger; read resolve-identity.ts, list-assignable-people.ts, events/outbox.ts, 0013/0028/0090/0093/0096/0103/0104 SQL, drizzle migrator source.

## Not checked
No Docker or real Postgres runtime (B's scope; PGlite only for the runbook SQL, on a reduced mock schema, not the 0087 production schema). Did not run the integration suites or drizzle-kit generate/check. Did not review SQL byte-identity against the source PRs or the snapshot JSON contents beyond the apikey FK grep. Did not review migration-schema.ts column-by-column. Did not evaluate whether duplicate membership rows can occur in practice on a production database.
<!-- END REPORT ae0b9c994e122dd06 d27aa02a -->

<!-- BEGIN REPORT (agent ae0b9c994e122dd06; model claude-sonnet-5-5; role ordinary review C delta; candidate e373364aa41cc91c3318801d6639dd370b5b7cf8; sha256 d2c130d44e05b4f8a92a3413d9b74779ff0ea0b69462f19285dae0f691a65630) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: M1 ordinary reviewer C, delta pass (same fresh reviewer context as the d27aa02a review; did not author or direct the change)
Delta reviewed: d27aa02a..e373364a. Exact head verified: e373364aa41cc91c3318801d6639dd370b5b7cf8 (worktree /private/tmp/claude-501/m1-spine)
Clean export: scratchpad/c-delta (git archive e373364a)
Verdict: CLEAR WITH NON-BLOCKING (1 non-blocking runbook defect that should be fixed in the same PR if cheap; no blocking finding)

## Disposition of my earlier findings
- N1 (display-only collapse; inherited beats direct; union of capabilities): fixed. The runbook now says rank is not a safe deletion rule, the plan models the resolver's `wellAnchored` test, and only groups where every row is anchored AND all rows have the same role_id are AUTO; everything else is MANUAL and the apply block refuses to run.
- N2 (FKs into membership at 0090-0092): fixed, scoped to "from accepted main" with the ON DELETE SET NULL caveat for 0090-0092.
- N2b (single paste commits): fixed as two blocks, interactive psql, explicit "do not use psql -f".
- N3a/N3 (scim_group_member comment, attachment policy.ts header, three blocks named, emailVerified): fixed and accurate (verified below).

## Runbook SQL: executed on PGlite 0.3.15 against a mock schema (workspace, project, organisation, role with jsonb capabilities, membership), using the exact blocks extracted from the exported runbook.md
Scenarios: p1 same role, direct + inherited with sees_all on the inherited row; p2 different roles with nested capabilities; p3 same scope but one role from another workspace (mis-anchored); p4 non-nested capabilities; p5 singleton.
- Plan block parses and runs. p1 -> AUTO (keeps the direct row, inherited removed). p2, p3, p4 -> MANUAL. p4 shows caps_nested = false, p2/p3 true. p5 not in plan. The mis-anchored row correctly shows anchored = false. Second result set lists exactly p2, p3, p4.
- Apply block with MANUAL groups present raises the intended exception and deletes nothing (after which `rollback;` is needed, as documented).
- After resolving p2-p4 by hand, rebuilding the plan, and running apply: only the AUTO group changes: the direct row is kept, sees_all carried from the removed inherited row, nothing else touched; final preflight returns no rows. The apply is one transaction and the temp table is session-level so the plan survives between blocks.
- Safety reasoning: delete set is `keep_order > 1` over a plan that only contains groups with >1 rows; MANUAL groups can never reach the delete because of the guard; NULL `anchored_sees_all` is falsy in the update so it cannot spuriously set the flag. `<@` on jsonb arrays works for the capability sets.

- NON-BLOCKING D1 (runbook.md, text after block (a): "re-run block (a) to rebuild the plan"): re-running block (a) in the same session fails with `relation "membership_dedupe_plan" already exists` (reproduced). Block (a) starts with `create temp table` and the table is deliberately session-scoped. Add `drop table if exists membership_dedupe_plan;` as the first line of block (a), or tell the operator to drop it before re-running. Without it an operator who resolves MANUAL groups hits an error and may improvise.
- NON-BLOCKING D2 (new "Before upgrading to migration 0088" section): "the result must be exactly 1791107747302" would wrongly stop a brand-new empty database (table missing or max is NULL). Add "or the table does not exist/is empty for a fresh install". The check itself is correct: max `when` of journal idx 0-87 is 1791107747302 (idx 87), and the migrator's skip rule is as described.
- Observation only: the kept row takes sees_all from the removed inherited row (p1 case). That persists after the inheritance source is later removed. Defensible and now explicitly reviewable in the plan output; no change required.

## Negative test (tests/api-integration/membership-unique-scope.test.ts)
Not run (needs Postgres; Docker not used per instruction; Opus runs the DB test). Read and checked instead:
- Non-vacuous: second test proves a different scope_id for the same person and the same scope_id for another person are accepted, so the rejection is specific to the unique index.
- Assertion shape `rejects.toMatchObject({ cause: { code: "23505", constraint: "membership_person_scope_scope_id_unique" } })` matches drizzle 0.45.2 wrapping (DrizzleQueryError.cause = pg error) and the existing pattern at workspace-role-writes.test.ts:702. A thenable query builder is accepted by `.rejects`.
- Seed satisfies NOT NULL/defaults (organisation key/name; person organisationId/side; project-scoped role with null workspace_id, same as the pre-existing AS-1 role insert); membership has no FK on scope_id, so "project-a" is valid. resetTestDatabase truncates with CASCADE.
- tsc with tsconfig.tests.json on the export: error set identical to the d27aa02a export (all environmental); the new file adds no errors.

## Comment and ledger accuracy
- schema.ts:2163-2165 new derivedFrom comment: accurate (scim_group_member.membership_id FK is in 0090; derived_from is unconstrained).
- attachment/policy.ts header: accurate (0096 adds the FKs; no route writes them).
- Ledger: emailVerified claim now correct (snapshot 0118 shows default false; 0003 adds the DEFAULT false column; `$defaultFn` retained so insert type unchanged). The three blocks (sla_policy note, trigram/search_vector note, attachment note) match my comment-set diff.
- Open-forward-items list: line references verified (0098:64 custom_field_type_visibility.work_item_type_id, 0098:66 custom_field_value.project_id, 0116:23-24 approval work_item_id/transition_id, 0118:36 saved_view.shared_with_team_id); all single-column FKs as stated. The 0090/0114 bullet is a claim about missing anchoring that I did not independently verify.
- Ledger cross-reference to the new applied-history check is accurate.
- apps/api src changes in the delta are comment-only (policy.ts, schema.ts); no runtime or type impact.

## Commands run
git rev-parse HEAD; git diff d27aa02a..e373364a (excluding snapshots); git archive e373364a to scratchpad/c-delta with linked node_modules; tsc --noEmit on tsconfig, .permissions, .tests, diffed against d27aa02a export (no change); PGlite harness (scratchpad/c-delta-t.mjs) running the runbook blocks extracted from the export; greps for migration line references, snapshot email_verified, vitest/drizzle error-shape precedents.

## Not checked
Real Postgres runtime of the new test and of the runbook against the real 0087 schema (mock schema only; role.capabilities assumed jsonb per schema.ts:2109). Did not re-verify the rest of the 0088-0118 spine (unchanged since the prior review). 0090/0114 anchoring claim in the ledger not independently verified.
<!-- END REPORT ae0b9c994e122dd06 e373364a -->

<!-- BEGIN REPORT (agent ae0b9c994e122dd06; model claude-sonnet-5-5; role ordinary review C closure; candidate b9a0c4680f05fb717985c2ccbf90512859ec7386; sha256 0a81c10665db5356dc7a043bb866c5f393aff020e31ecbb1cf6c9b94e5017122) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: M1 ordinary reviewer C, closure check of D1/D2
Reviewed head: b9a0c4680f05fb717985c2ccbf90512859ec7386 (delta e373364a..b9a0c468, runbook.md only; clean git archive export)
Verdict: CLOSED. D1 and D2 are fixed; no new finding.
D1: block (a) now begins `drop table if exists membership_dedupe_plan;`. Re-running (a) twice in one PGlite session works.
D2: `to_regclass('drizzle.__drizzle_migrations')` returns NULL on a database with no drizzle schema (checked); with an empty table `max(created_at)` is NULL (checked). The prose now lets fresh/empty databases proceed and still requires exactly 1791107747302 otherwise.
New apply guards (share row exclusive lock + 3 staleness checks), tested on PGlite with the exact runbook blocks: clean run OK (kept a2, sees_all carried); planned row deleted -> "stale plan" error; role changed -> error; new duplicate row not in plan -> error; kept row gone -> error. Each failure leaves data untouched after `rollback`.
Nit only: the new prose line in (b) is overlong; the "group has no kept row" guard is mostly redundant with the first stale check. Neither matters.
Not checked: real Postgres lock behaviour under concurrent writers (PGlite is single-connection); mock schema only.
<!-- END REPORT ae0b9c994e122dd06 b9a0c468 -->

<!-- BEGIN REPORT (agent ae0b9c994e122dd06; model claude-sonnet-5-5; role ordinary review C final; candidate efcc201719bbfcf1b189c9243750cfe6ac623181; sha256 f8e1dcdd22174a2d3e58e2118b73723c332b1caadd0e0fbb6e258268bb4a953b) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: M1 ordinary reviewer C, check of the structural stale-plan guard
Reviewed head: efcc201719bbfcf1b189c9243750cfe6ac623181 (delta b9a0c468..efcc2017, runbook.md only; clean git archive export, PGlite 0.3.15, mock schema)
Verdict: CLEAR. SQL is correct, the guard refuses stale plans, the normal path commits. No findings.
Tested with the exact blocks extracted from the runbook: clean path commits (keeps a2, carries sees_all, MANUAL group resolved by hand first); plan re-run works (drop of table, plan_now and view first); stale cases each raise "stale plan" and leave data untouched after rollback: sees_all changed, inherited_from changed, role changed, planned row deleted, new duplicate appeared; after re-running (a) the apply proceeds (or, where the change creates a MANUAL group, is refused by the MANUAL guard); an unrelated new singleton row does not trip the guard (correct); MANUAL guard still fires. The recomputed-plan EXCEPT comparison covers every column in both directions, including jsonb and timestamptz columns.
Not checked: real Postgres lock behaviour under concurrent writers; mock schema only.
<!-- END REPORT ae0b9c994e122dd06 efcc2017 -->

<!-- BEGIN REPORT (agent a3bc54a26659d3e77; model claude-opus-5-5; role Sol-tier security review and closures; candidate efcc201719bbfcf1b189c9243750cfe6ac623181; sha256 c913580d3ea60148f8a4153121a056e0c7ea3da6fd73358ae3a308df507597a4) -->
Reviewer model: Claude Opus (claude-opus-5-5)
Reviewer context ID: claude-agent:a3bc54a26659d3e77
**Reviewed head:** d27aa02ad5a081cd1be4a2e1510f32118c3b3027
Verdict: CLEAR WITH NON-BLOCKING

Role: independent Sol-tier security reviewer (Thomas routes the Sol tier to GPT-6/6.1 Sol or a fresh Claude Opus; this is a fresh Claude Opus context, not GPT-6 Sol). I did not author, direct or remediate the candidate. Read-only: no edit, commit or push. Worktree clean before and after (`git status --short` showed 0 lines).

Candidate: M1 migration spine, worktree /private/tmp/claude-501/m1-spine, branch claude/m1-migration-spine. Comparison base: main 26c43def6bede50a4d831801d34a59433cbfc891. Commits: 3595cbda, 5a35dd10, d27aa02a.

## Summary

The 0088-0118 SQL does not weaken tenant isolation or authorization on any constraint it drops and re-creates. Each replacement is equal or stronger, and I checked the key ones live on Postgres 18. Main's 0000-0087 and journal entries 0-87 are unchanged. The journal is append-only, and every new `when` is above main's maximum. The `apikey.referenceId` type correction changes no runtime behaviour.

There is one real problem: the 0093 remediation SQL in the runbook (added at d27aa02a, after both ordinary reviews). I reproduced it. It can delete the only valid membership a person has and keep an invalid one. It can also give a person `sees_all` from a row the resolver ignores. And the runbook's line "so no access is lost" is false. I rate this non-blocking, because it is operator documentation that only runs if the preflight finds duplicates, it runs in one transaction, and a backup is required first. But it should be fixed before any operator uses it, preferably in this PR.

## Surfaces examined

- All 31 SQL units `apps/api/drizzle/0088_*.sql` to `0118_*.sql`, read in full.
- The main-side definitions they replace: 0078 (outbox), 0086 (`step_up_operation_route`), 0077 (`pending_action_action_check`), 0053 (`membership_personId_scope_scopeId_idx`), 0054 (`work_item_type.sla_policy_id`).
- `apps/api/drizzle/meta/_journal.json` against main's.
- `apps/api/src/database/schema.ts`: a semantic comparison of every column on all 63 of main's tables, plus `shadow-schema.ts`, `migration-schema.ts` and `drizzle.config.ts`.
- `docs/05-operations/runbook.md` (0093 section), `docs/07-planning/migration-ledger.md`, and the decision-log entry.
- Consumers of `apikey.referenceId`: `utils/verify-api-key.ts`, `utils/authenticate-api-request.ts`, `utils/validate-workspace-access.ts`, `utils/workspace-access-middleware.ts`, `pending-action/service.ts`, `instance/reset-mfa.ts`, `database/relations.ts`, `utils/migrate-apikey-reference-id.ts`.
- Authorization consumers relevant to 0093 and the runbook: `permissions/resolve-identity.ts` (the `wellAnchored` filter, lines 491-534), `notification/task-reach.ts:227`, `audit/controllers/list-workspace-audit.ts`.
- `events/outbox.ts`, to see how runtime handles the now-nullable `outbox.workspace_id`.
- Drizzle's migrator, `drizzle-orm@0.45.2/pg-core/dialect.js` `migrate()` (lines 44-72).
- Ordinary reviews A and B (both at 5a35dd10, not this head) and the ledger draft.

## Commands run (summary)

- `git rev-parse HEAD` gave d27aa02a…3027. `git diff --name-status 26c43def..HEAD -- apps/api/drizzle` showed only `A` entries plus `M meta/_journal.json`. `git diff --quiet` over all main 00xx SQL passed (unchanged).
- A Python journal check: the first 88 entries are equal to main's, and the header is unchanged. Main's max `when` is 1791107747302 (idx 87). Entries 88-118 are strictly increasing from 1791107748302 to 1791344327180. Tags match idx, there are no orphan SQL files, and SHA-256 of every SQL file matches the ledger table.
- `pnpm -s typecheck` in apps/api ran all four tsconfig projects. Exit 0.
- A drizzle `getTableConfig` comparison of main's and the candidate's `schema.ts`, loaded via `node --import tsx/esm` from a temporary copy in $TMPDIR, since deleted. It covered every column of every table: name, export, SQL type, notNull, hasDefault, $defaultFn, $onUpdate and pk.
- Disposable container `m1sec-opus-pg` (postgres:18-alpine, PG 18.6), with these tests:
  - Applied 0000-0087 with psql in journal order. That DB was cloned as the template for the next two tests.
  - **m1a_test:** applied 0088-0118 in ONE transaction. Success: 100 public tables, and only `feature.scim` and `feature.import` seeded as enabled.
    - A cross-tenant `workspace.default_sla_policy_id` was rejected (FK violation).
    - Deleting a workspace with a default policy succeeded.
    - An outbox row with null workspace and a workspace-kind event was rejected (CHECK).
    - A null-workspace instance-kind row that carried `organisation_id` was rejected.
  - **m1b_test:** seeded duplicate memberships (below) and ran the runbook remediation block, extracted verbatim from runbook.md lines 259-289. Then re-ran the preflight.
  - `docker rm -f m1sec-opus-pg`. `docker ps -aq | wc -l` showed **19**.

## Focus 1: constraint and FK drops and re-creations

| Unit | Change | Equal or stronger? | Evidence |
| --- | --- | --- | --- |
| 0091 | `membership_grant.granted_by_person_id` FK changes from `ON DELETE set null` to `restrict` | Stronger | The table is new in 0090. `set null` would have broken `membership_grant_source_shape_check` (direct+admin needs granted_by non-null). `restrict` keeps the attribution of who granted it. The same unit adds `scim_connection_enabled_token_check` (cannot be enabled without a token): stronger. |
| 0092, 0094, 0106, 0108 | `step_up_operation_route` CHECK dropped and re-created | Equal or stronger | A strict allowlist of operation-to-route pairs. Each version is a superset of the last: 0086 has 4 pairs; 0092 adds `scim_admin_update`; 0094 adds the scim token rotate and revoke pairs; 0106 adds the identity_connection create and configure pairs; 0108 adds `instance_admin_grant`. Nothing is removed, and the pairs stay route-bound. Adding a pair only lets a new step-up operation be recorded for its single route. |
| 0093 | Non-unique index becomes UNIQUE `(person_id, scope, scope_id)` | Stronger | The resolver unions every row (resolve-identity.ts:491-534). Uniqueness removes ambiguity, so it cannot grant anything. Its operational cost (it aborts on duplicates) is atomic, because the migrator runs everything in one transaction (dialect.js:60). |
| 0096 | `provisioning_event_kind_check` dropped and re-created | Equal | It adds `group.directory_changed` and nothing else. This table is audit vocabulary, not authority. |
| 0099 | `submission_state_allowed` re-created with `draft`, and `submitted_at` consistency added | Equal or stronger | No tenancy column is involved. The backfill UPDATE only sets `submitted_at = created_at` where it is null. |
| 0107 | `membership_grant_revocation_reason_check` | Equal | It adds `person_deactivated`. Revocation vocabulary only. |
| 0109 | `pending_action_action_check` | Equal | It adds `user_deactivation`. It grants nothing: a pending action still needs the existing request, decision and execution flow. |
| 0110/0111 | `outbox.workspace_id DROP NOT NULL` plus `outbox_scope_check` | Bounded weakening of a DB constraint. Runtime is unchanged, and the scope check is net-stronger than the column alone. | Null is allowed only for the four instance kinds (`pending_action.*`, `identity.deprovisioned`). 0111 also requires `organisation_id is null`, so an org-scoped row cannot lose its workspace (tested live). `enqueueOutboxEvent` still throws when there is no workspace (events/outbox.ts:34). `notification_delivery.workspace_id` is NOT NULL, so instance events cannot fan out into a workspace delivery. |
| 0089 then 0112 | Single-column SLA FKs (0089) are replaced by composite `(workspace_id, …)` FKs with `ON UPDATE no action` (0112) | Stronger | The end state is tenant-anchored, and it avoids the PR #191 O1 hazard (CASCADE). A cross-tenant default policy was rejected live. On an upgrade, 0089-0112 run in one transaction, so a DB at 0087 never commits the single-column state. Before this, `work_item_type.sla_policy_id` had no FK at all, and main never writes it (default-work-item-types.ts:11-12). |
| 0113 | New `project.service_calendar_id` | Stronger | It is added with a composite `(workspace_id, service_calendar_id)` FK. |

**Tenant-anchoring gaps in tables new in this spine (NON-BLOCKING N2).** These are not weakenings of anything that exists today. They are byte-identical to the train units already reviewed under their PRs, and the runtime for them is not in M1. But they break the composite-FK convention in data-model.md (the #192 and #186 S2 technique), so database-level isolation depends entirely on future application code:

- `0098_custom_fields_runtime.sql:64`: `custom_field_type_visibility.work_item_type_id → work_item_type(id)` is single-column. A field in workspace A can be bound to a type in workspace B.
- `0098_custom_fields_runtime.sql:66`: `custom_field_value.project_id → project(id)` is single-column. Its `entity_id` is polymorphic and has no FK.
- `0116_approvals_lifecycle.sql:23-24`: `approval.work_item_id` and `approval.transition_id` are single-column. A transition from another workspace's workflow is accepted.
- `0118_fair_kabuki.sql:36`: `saved_view.shared_with_team_id → team(id)` is single-column, although `saved_view.workspace_id` exists. A view can be shared to another workspace's team.
- 0090 `membership_grant.role_id` / `scope_id` and the `oidc_group_mapping` / `scim_group_mapping` `role_id` / `scope_id` have no scope anchoring. This is the same shape as `membership`. The resolver's `wellAnchored` filter must be applied when grant-backed memberships are produced.
- 0114: `notification_delivery.workspace_id` is not tied to the workspace of `outbox.event_id`.

Recommendation: before the runtime PRs that write these tables land, add forward-only composite FKs in 0119+ (or record an explicit waiver in the decision log). Also add a negative test per table.

## Focus 2: authorization tables, defaults and seed rows

- Every INSERT, UPDATE and DELETE statement in 0088-0118: 0096's `instance_feature_flag` seed, 0099's `submitted_at` backfill, 0100's `auto_accept` copy, and 0101's `setval`. There is no DELETE. There is no role, membership, grant, policy or pending-action row insert, so no migration mints authority.
- `membership_grant.sees_all` is `DEFAULT false`. `membership_grant_source_shape_check` forces `sees_all = false` for `jit_default`, `oidc_group` and `scim_group`. Only `direct` grants can carry it, and `direct/admin` needs `granted_by_person_id`. Good.
- `identity_connection.enabled DEFAULT false`, and `scim_connection.enabled DEFAULT false`. 0091 also stops scim being enabled without a token. `oidc_group_mapping.enabled` and `scim_group_mapping.enabled` default to true, but a mapping only exists if an admin creates it.
- Feature-flag seed: `feature.scim` is enabled (unlocked), and `feature.import` is enabled and locked. Neither grants access by itself: SCIM still needs an enabled connection with a token, and per D5 these tables have no runtime consumer in M1. I found no consumer in apps/api/src except a reference in `permissions/shadow-config.ts`. NON-BLOCKING N4: when the feature-flag runtime lands, confirm that `feature.scim` defaulting to on is intended.
- `instance_plugin_config`: the scope and workspace CHECKs are coherent, `auth.*` plugins must declare `portal_scope`, and `secrets` is bytea. No seed.
- `shadow-schema.ts`: only the forms of the CHECK expressions and an index's `nullsFirst` change. Both are equivalent in Postgres (DESC defaults to NULLS FIRST, and `= ANY(ARRAY[…])` is IN). No column or semantic change.

## Focus 3: applied-history integrity

- Main 0000-0087 SQL and snapshots are unchanged, and journal entries 0-87 are deep-equal to main's (checked).
- The journal is append-only: 31 entries are added, and idx 88-118 are contiguous with tags matching idx.
- Main's maximum `when` is 1791107747302, at idx 87. All new `when` values are strictly greater and strictly increasing. The three inversions inside main's range (idx 5/6, 24/25, 25/26) are inherited, already applied and unchanged.
- Drizzle's migrator (dialect.js:56-71) reads only the newest `created_at` and runs a unit only if `created_at < folderMillis`. It never checks hashes, and it runs every pending unit in one transaction. So on an environment at main's 0087, all 31 units apply atomically.
- Residual (R1): if any environment already applied a train branch's units with different or higher `when` values (for example a UAT deploy from #585, #589, #513 or #611), the M1 units at or below that value would be skipped silently. Before deploying, run `select max(created_at) from drizzle.__drizzle_migrations` on each target. It must equal 1791107747302.

## Focus 4: 0093 runbook remediation (docs/05-operations/runbook.md:228-295)

It is transactional: an explicit `begin; … commit;` block, with a temp table set to `on commit drop`. Before 0093, no table references `membership` (checked: no FK into it exists at 0087), so the DELETE cannot cascade.

**NON-BLOCKING N1, recommended fix before operator use.** I reproduced this live on m1b_test with the runbook block run verbatim. The keep rule is "highest `role.rank`, then direct, then oldest, then id", and `any_sees_all` is OR'ed over every row in the group. The resolver does something different: it unions every row, but only counts rows that pass `wellAnchored` (resolve-identity.ts:506-518; the role must belong to the scope's workspace). Results:

| Case | Rows | Runbook keeps | Effect |
| --- | --- | --- | --- |
| p1 | m1 rA (w1 role, rank 10, valid); m2 rX (**w2** role, rank 90, sees_all) | m2 (deleted m1) | The person loses all resolver authority in w1. m2 is not anchored, so it is skipped. This is how an admin can lose their only valid membership. |
| p2 | m3 rA caps `[cap.a]`; m4 rB rank 50 caps `[cap.b]` | m4 | `cap.a` is lost. Rank does not mean a superset of capabilities for custom roles, but the runbook assumes it does. |
| p3 | m5 rA (valid, sees_all false); m6 rL (**w2** role, rank 1, sees_all true) | m5, with `sees_all` set to **true** | **The resolver now grants `sees_all`**. Before, it came only from an ignored, mis-anchored row. This is a narrow escalation that needs pre-existing corrupt data. `task-reach.ts:227` and `list-workspace-audit.ts` already read raw `membership.sees_all`, so those paths are unchanged. |
| p4 | m7 direct rA; m8 inherited (`inherited_from` set) rB | m8 (deleted the direct row) | The direct grant is gone. If the inheritance is later removed, access is lost. This is latent: nothing reads `inherited_from` or `derived_from` yet. |

The runbook's claim "If any removed row had `sees_all` set, the kept row inherits that flag so no access is lost" (line 254-255) is false for p1 and p2.

The printed review plan shows `role_id`, but not the role's workspace or capabilities. So an operator cannot see these cases from the plan. If the block is run with `psql -f`, it commits with no review pause at all.

Suggested fix:
- Join the scope owner and filter or label rows that fail the resolver's anchoring.
- Rank first by anchored, then direct, then rank.
- Compute `any_sees_all` only over anchored rows.
- Print `r.workspace_id`, `r.capabilities` and `inherited_from`/`derived_from` in the plan, and stop if a group holds capability sets that are not nested ("resolve by hand").
- Correct the "no access is lost" sentence.
- Say that it must be run interactively, and that the plan output must be kept in the release record.

Why this is not blocking: it is docs, not code. It only runs if the preflight returns rows. The ledger asks for the preflight result to be recorded per environment, a backup is mandatory first, the failure modes mostly lose access rather than grant it, and the escalation case needs data that is already corrupt.

## Focus 5: schema.ts type corrections and `apikey.referenceId`

- The semantic comparison of all columns on main's 63 tables found exactly three changed declarations: `apikey.reference_id` becomes nullable, `label.workspace_id` becomes NOT NULL, and `outbox.workspace_id` becomes nullable. Everything else is a column added by 0088-0118. No table or export is renamed or removed. `user.emailVerified` has no change in column metadata. Reviewer A's note says otherwise; at this head the comparison found no difference.
- `apikey.referenceId`: the database column has been nullable with no FK since 0013 (and the startup fixer `migrate-apikey-reference-id.ts` backfills it from `user_id`). So the change only corrects the TS type and drops a fictional `.references(user, cascade)`. Consumers:
  - `verify-api-key.ts:65` already does `referenceId ?? userId ?? ""`.
  - Every other consumer uses `eq(apikeyTable.referenceId, <id>)`. That is SQL equality, so a null never matches, never widens a match, and never yields an owner-less "super key".
  - No code branches on a missing `referenceId`.
  - Typecheck passes.
- Pre-existing and not introduced here (NON-BLOCKING N3): a key with both `reference_id` and `user_id` null still authenticates with `userId = ""` (authenticate-api-request.ts:77-91). Downstream resolution then finds no person, so it fails closed. Revocation paths (`reset-mfa.ts:160`, `pending-action/service.ts:284,357`) match only `reference_id`. Also, because the database has no FK, deleting a user never cascades to that user's API keys (the old declaration was misleading about this). Suggest a follow-up to reject owner-less keys in `verifyApiKey`, and to revoke by `reference_id OR user_id`.
- `label.workspaceId NOT NULL` matches the database since 0005, so the type is stricter. `outbox.workspaceId` nullable is covered above. `migration-schema.ts` is referenced only from `drizzle.config.ts` and is not imported at runtime.

## Findings

BLOCKING: none.

NON-BLOCKING:
- **N1:** the 0093 runbook remediation can keep a mis-anchored row and delete the valid one, drop capabilities that are not nested, lift `sees_all` from a row the resolver ignores, and prefer an inherited row over a direct one. Its "no access is lost" claim is false. See docs/05-operations/runbook.md:250-289; reproduced live. Fix before any operator uses it. This text was added at d27aa02a after both ordinary reviews (which were at 5a35dd10), so it has had no ordinary review at this head.
- **N2:** new tables lack tenant-composite FKs: 0098:64 and 0098:66, 0116:23-24, 0118:36. Also unanchored role and scope on 0090's grant and mapping tables, and the 0114 delivery-to-event workspace link. Add 0119+ composite FKs, or record a waiver, before the runtime that writes them.
- **N3:** pre-existing handling of owner-less API keys and revocation by `reference_id` only (authenticate-api-request.ts:77-91, reset-mfa.ts:160). Not introduced by M1.
- **N4:** `feature.scim` is seeded enabled and unlocked (0096:175-196). It is inert now; confirm the intent when the flag runtime lands.
- **N5:** there is no negative test proving the 0093 UNIQUE index rejects a duplicate membership. AS-1 lost its duplicate setup and nothing replaced it. A one-insert test would encode the invariant the dedupe code used to cover.

## Residual risk

- **R1:** environments that already applied train-branch units, with different `when` values or hashes, could silently skip M1 units. Verify `max(created_at)` is 1791107747302 per target before deploy.
- **R2:** whether SIT, DEV or UAT hold duplicate `membership` rows. If they do, N1 matters immediately.
- **R3:** the database-level tenancy gaps in N2 rely on application code that is not reviewed here.

## Not checked

- `drizzle-kit generate` and `check` (I relied on the ledger and the ordinary reviewers), and whether the snapshot JSON matches the applied database.
- Full integration or unit suites. I ran typecheck only.
- The real Drizzle migrator path, including the hand-written pre-migrate fixups in `apps/api/src/index.ts`. I applied the SQL with psql in journal order inside one transaction instead.
- Live environments: the `__drizzle_migrations` state and duplicate memberships.
- Provenance of each unit against the source PRs beyond the SHA-256 ledger match.
- Runtime code for the new tables (out of M1 scope).

---

# Closure check at e373364a

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:a3bc54a26659d3e77 (same independent security context as above; I did not author, direct or remediate the fixes)
**Reviewed head:** e373364aa41cc91c3318801d6639dd370b5b7cf8
Delta reviewed: `git diff d27aa02a..e373364a`. Five files: runbook.md, migration-ledger.md, the new tests/api-integration/membership-unique-scope.test.ts, and comment-only edits to attachment/policy.ts and schema.ts.
Verdict: **CLEAR WITH NON-BLOCKING**. N1, R1 (as a procedure), N2 (as a recorded forward item) and N5 are closed. Two new non-blocking hardening items, C1 and C2, are on the rewritten runbook.

## Commands run

- `git rev-parse HEAD` gave e373364a…b7cf8. The worktree stayed clean (0 lines from `git status --short`) before and after.
- Clean export: `git archive e373364a apps/api/drizzle docs/05-operations/runbook.md`, into scratchpad/m1close/export. I extracted the plan block (a) and apply block (b) **verbatim** from the exported runbook with awk (57 and 21 lines).
- One container, `m1sec-opus-pg2` (postgres:18-alpine). I applied 0000-0087 from the export in journal order and used that database as a template.
  - **c1_test:** 12 people and 25 duplicate rows. The cases were p1-p4 from the original review plus 8 adversarial cases (below). I sent the plan and apply blocks through psql stdin with no ON_ERROR_STOP, to imitate an interactive paste.
  - **c2_test:** a stale-plan test.
  - **Upgrade after remediation:** I applied 0088-0118 in one transaction on the remediated c1, then tried a duplicate insert.
- `docker rm -f m1sec-opus-pg2`. Then `docker ps -aq | wc -l` showed **19**, and no `m1sec*` container remains.

## Plan classification (c1_test, verbatim block (a))

| Case | Rows | Decision | Correct? |
| --- | --- | --- | --- |
| p1 | rA (valid) + rX (w2 role, rank 90, sees_all) | MANUAL | Yes. It no longer keeps the mis-anchored row. |
| p2 | rA caps a + rB caps b | MANUAL, caps_nested=f | Yes |
| p3 | rA (valid) + rL (w2 role, sees_all) | MANUAL, anchored_sees_all=f | Yes. `sees_all` is no longer lifted. |
| p4 | direct rP + inherited rB | MANUAL | Yes |
| p5 | same role, direct (newer) + inherited (older, sees_all) | AUTO. Kept the direct row and set sees_all=t | Yes |
| p6 | same role, both mis-anchored (w2 role in w1) | MANUAL | Yes |
| p7 | same role with `role.workspace_id` NULL in workspace scope, so `anchored` is NULL | MANUAL | Yes. `bool_and` over all-NULL gives NULL, which falls to MANUAL; the `filter (where anchored)` excludes NULL. |
| p8 | project scope, anchored, same role | AUTO. Kept the oldest | Yes |
| p9 | project in w2, role in w1 | MANUAL | Yes |
| p10 | organisation scope, 3 rows: one derived (SCIM), one sees_all | AUTO. Kept the oldest direct row and set sees_all=t | Yes |
| p11 | same role, all inherited | AUTO. Kept the oldest | Yes |
| p12 | workspace scope_id that does not exist | MANUAL | Yes |

The anchoring expression matches resolve-identity.ts `wellAnchored` for the workspace, project and organisation scopes. AUTO needs every row anchored and one `role_id`. So the rows in an AUTO group carry identical authority, and the OR of `sees_all` over anchored rows equals what the resolver already unions. AUTO cannot drop or grant authority. It only loses provenance (`inherited_from`/`derived_from`) on the deleted rows, which nothing reads yet.

## Apply guard: verified that it blocks

- **With MANUAL groups present** (same session as the plan): the `DO` block raised `MANUAL duplicate groups remain…`, the UPDATE and DELETE were rejected because the transaction was already aborted, and `commit` became `ROLLBACK`. The membership hash was the same before and after (72e18585…).
- **Apply in a fresh session with no plan table:** `relation "membership_dedupe_plan" does not exist`, so the transaction aborts. It fails closed.
- **After the manual deletes and a rebuilt plan:** apply ran `UPDATE 2` and the deletes, the duplicate-group count is 0, and 0088-0118 then applied in one transaction (exit 0). A duplicate insert was then rejected with `membership_person_scope_scope_id_unique`, and a different scope_id was accepted.

## New non-blocking items

- **C1: the plan can go stale between (a) and (b).** Apply trusts the temp table. It does not re-check that the kept row still exists or still has the planned role, and it does not lock `membership`. I reproduced this on c2_test. Between plan and apply I changed the p5 kept row's role (rA to rB) and deleted the p8 kept row (m16), imitating a still-running app or admin. Apply then committed. p5 lost rA (`cap.a`), and p8 lost **every** membership on pj1.
  - This needs a concurrent write during the operator's window. Before the upgrade the old API is still live, and the runbook does not say to stop it.
  - Fix: either state "stop the API (or make it read-only) before (a) and keep it stopped until (b) commits", or have (b) take `lock table membership in share row exclusive mode` and then refuse if any plan row's `(id, role_id)` no longer matches, or if any group's `keep_order = 1` row is missing.
- **C2: as written, "re-run block (a)" fails in the same session.** runbook.md:357 says to re-run (a) after the manual deletes, and line 279 says to keep the session open. But (a) is `create temp table membership_dedupe_plan as …` (line 288) with no drop, so the re-run fails with `relation "membership_dedupe_plan" already exists`. The second query then reports the **old** plan.
  - This fails safe: the stale plan still holds MANUAL rows, so the guard keeps blocking. But the documented flow cannot finish without an improvised `drop table`.
  - Fix: start (a) with `drop table if exists membership_dedupe_plan;`.

## Other closures

- **N1:** closed. The false sentence is gone, and AUTO, MANUAL and the guard behave as described (see the tables above). The runbook now explains why `rank` is not a deletion rule, forbids `psql -f`, and notes the `ON DELETE SET NULL` FKs from 0090 for databases that already applied 0090-0092.
- **R1:** closed as a procedure. The runbook's applied-history check queries `drizzle.__drizzle_migrations`. That matches the default schema and table that apps/api/src/index.ts:1627 uses (no custom `migrationsSchema`). It requires exactly 1791107747302 and says stop otherwise. Whether it has been run on each live target is still an operator action (R2 likewise).
- **N2:** recorded as an open forward item in migration-ledger.md, with an explicit "before any runtime slice writes the table" condition. That is acceptable as a tracked residual; it is not fixed.
- **N5:** closed in code. The new test has a positive case (the duplicate is rejected with code 23505 and the named constraint) and a negative case (a different scope_id or person is accepted), so it is not vacuous. I confirmed the same database behaviour in the container. I did not run the vitest file itself.
- **Comment fixes** (attachment/policy.ts header, schema.ts `derivedFrom`): comment-only, no code change. The ledger's `user.emailVerified` note is consistent with my column comparison (no metadata change on insert).
- N3 and N4 are unchanged and remain non-blocking residuals.

## Not checked at this head

- The vitest suites, typecheck and `drizzle-kit check` (the only TS change is comment-only).
- Live environments: the `max(created_at)` value and duplicate rows.

---

# Closure check of C1 and C2 at b9a0c468

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:a3bc54a26659d3e77 (the same independent security context; it did not author, direct or remediate the fixes)
**Reviewed head:** b9a0c4680f05fb717985c2ccbf90512859ec7386
Delta reviewed: `git diff e373364a..b9a0c468`. Only `docs/05-operations/runbook.md` changed (+47/−7).
Verdict: **CLEAR WITH NON-BLOCKING**. C2 is closed. C1 is closed for the cases it named (role change, missing kept row, unplanned duplicate) and for concurrent writers during (b). One narrower residual, C3, remains, and it only matters if the "stop the API" instruction is not followed.

## Commands run

- `git rev-parse HEAD` gave b9a0c468…7386. The worktree was clean (0 lines) before and after.
- Clean export: `git archive b9a0c468… apps/api/drizzle docs/05-operations/runbook.md`. I extracted the history check (2 lines), plan block (a) (59 lines) and apply block (b) (49 lines) verbatim from the exported runbook.
- `m1sec-opus-pg3` (postgres:18-alpine): I applied 0000–0087 from the export and used that database as a template. Each scenario ran on its own database: the seed from the previous closure, then one psql stdin session containing plan (a), then a simulated change, then apply (b). There was no `ON_ERROR_STOP`, to imitate an interactive paste.
- `docker rm -f m1sec-opus-pg3`. Then `docker ps -aq | wc -l` showed **19**, and no `m1sec*` container remains.

## Results

| Scenario | Change between (a) and (b) | Result |
|---|---|---|
| s1 (the original C1 repro, part 1) | kept row m9 changed from role rA to rB | Refused with "stale plan: a planned row was deleted or its role changed". The transaction rolled back and the data was unchanged. |
| s2 (the original C1 repro, part 2) | kept row m16 deleted | Refused with the same stale-plan error. It rolled back; m15 survived. |
| s3 | a new duplicate inserted into an AUTO group | Refused with "duplicate rows exist that are not in the plan". It rolled back. |
| s4 | none, with a MANUAL group present (p1) | Refused with the MANUAL guard. It rolled back. |
| s7 | none, AUTO only | Committed. Kept m9 (sees_all true) and m16. Correct. |
| s5 | `sees_all` **revoked** on m10 (the source of `anchored_sees_all`) | **Committed and gave `sees_all` back**: m9 ended with `sees_all = true` from the stale plan. See C3. |
| s6 | m10 moved to `scope_id = w2`, same `role_id` | **Committed and deleted m10**, although it was no longer a duplicate. p5 lost its w2 row. See C3. |
| s8 | m15 moved to `scope = workspace, scope_id = w1` | **Committed and deleted m15** (no longer a duplicate). p8 lost the w1 row. See C3. |

Further checks:

- **Lock really blocks writers.** I held `begin; lock table membership in share row exclusive mode; select pg_sleep(5)` in one session. In a second session, an INSERT and an UPDATE on `membership` each failed with `canceling statement due to lock timeout` (lock_timeout 1s), and a plain SELECT still succeeded. So no write can land during (b).
- **C2 is closed.** In a single session I ran plan (a), the manual deletes, (a) again, then (b). The re-run printed `DROP TABLE` and `SELECT 9`, and the MANUAL result set was empty (0 rows). Apply ran `UPDATE 2`, `DELETE 5`, `COMMIT`, leaving 0 duplicate groups. 0088–0118 then applied in one transaction (exit 0).
- **History check on a fresh database.** `to_regclass` returns null. The second query then errors with `relation … does not exist`, which is harmless; the runbook says to skip it when the first is null. The fresh-database allowance fails safe: a database that has application tables but no `drizzle` table would make the migrator re-run 0000 and abort atomically on the first `CREATE TABLE`.

## Findings

BLOCKING: none.

NON-BLOCKING:

- **C3: the stale-plan check compares only `(id, role_id)`.**
  - **What it misses:** a planned row whose `sees_all`, `person_id`, `scope` or `scope_id` changed after (a) still passes.
  - **Effects:**
    - (b) can give back a `sees_all` that was revoked in between (s5, a narrow escalation).
    - (b) can delete a row that has moved to a different scope and is no longer a duplicate (s6, s8: loss of access).
  - **When it can happen:** only through a write between (a) and the `lock` in (b). The runbook now tells the operator to stop the API for that whole window (runbook.md:281), and (b)'s lock covers the apply itself.
  - **Fix:** compare the full tuple `(id, person_id, scope, scope_id, role_id, sees_all, inherited_from, derived_from)` in the check at runbook.md:386-391. Alternatively, rebuild the plan inside (b) after the lock and refuse if it differs from the reviewed plan.
- **C4 (nit):** `drop table if exists membership_dedupe_plan;` (runbook.md:297) is not schema-qualified. In a session with no temp table, it would drop a permanent `public.membership_dedupe_plan` if one ever existed. `drop table if exists pg_temp.membership_dedupe_plan;` removes the risk.

## Status of the earlier findings

| Finding | Status |
|---|---|
| N1 | Closed |
| C1 | Closed for its named cases; C3 is the residual |
| C2 | Closed |
| R1 | Closed as a procedure; fresh-database handling verified |
| N5 | Closed |
| N2 | Recorded forward item |
| N3, N4 | Unchanged non-blocking residuals |
| R2 (live duplicate and history state) | Still an operator action |

## Not checked

- Live environments.
- Test suites (no code changed in this delta).

---

# Closure check of C3 and C4 at efcc2017

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:a3bc54a26659d3e77 (same independent security context; did not author, direct or remediate)
**Reviewed head:** efcc201719bbfcf1b189c9243750cfe6ac623181
Delta reviewed: `git diff b9a0c468..efcc2017`. Only `docs/05-operations/runbook.md` changed (+19/−29).
Verdict: **CLEAR**. C3 and C4 are closed. There are no new findings on the runbook. The earlier non-blocking residuals N2, N3 and N4 and the operator action R2 are unchanged, and none of them is a gate on this candidate.

## What changed and why it closes C3

The plan is now defined once as the temp view `membership_dedupe_plan_q` (runbook.md:304). (a) materialises it into `membership_dedupe_plan`. (b) takes the `share row exclusive` lock (line 386) and recomputes the same view into `membership_dedupe_plan_now`. It refuses unless the two tables are equal in both directions with `EXCEPT` (lines 397-398). `EXCEPT` compares every column with NULL-safe set semantics, and each row has a unique `id`, so set semantics loses nothing.

The plan columns include every `membership` column except `updated_at`: `id`, `person_id`, `scope`, `scope_id`, `role_id`, `sees_all`, `inherited_from`, `derived_from` and `created_at`. They also include the role's scope, workspace, rank and capabilities, the derived anchored and direct flags, the group aggregates, the decision and `keep_order`. So any change to membership, role or anchoring data that could change a decision is compared, as are changes to the existence or workspace of the scope owner.

C4: all three drops are now qualified with `pg_temp.` (lines 299-301 and 388).

## Commands run

- HEAD is efcc2017. The worktree was clean (0 lines) before and after.
- Clean `git archive` export of efcc2017. I extracted plan (a) (64 lines) and apply (b) (32 lines) verbatim.
- On one container, `m1sec-opus-pg4` (postgres:18-alpine), I applied 0000-0087 from the export. Each scenario ran on its own database from that template, as one psql stdin session: (a), then a simulated change, then (b), with no `ON_ERROR_STOP`.
- `docker rm -f m1sec-opus-pg4`. Then `docker ps -aq | wc -l` showed **19**, and no `m1sec*` container remains.

## Results

| Case | Change between (a) and (b) | Result |
|---|---|---|
| s1 | kept row's role rA → rB | Refused (stale plan). Rolled back. |
| s2 | kept row deleted | Refused. Rolled back. |
| s3 | unplanned duplicate inserted | Refused. Rolled back. |
| s4 | none, MANUAL group present | Refused (MANUAL guard). Rolled back. |
| s5 (was C3) | `sees_all` revoked on the source row | **Refused** (was: committed and gave `sees_all` back). Rolled back. |
| s6 (was C3) | row moved to another `scope_id` | **Refused** (was: committed and deleted it). Rolled back. |
| s7 | none, AUTO only | Committed with the correct result (kept m9 with `sees_all`, kept m16). |
| s8 (was C3) | row moved to another scope | **Refused** (was: committed and deleted it). Rolled back. |
| s9 (new) | the shared role's `capabilities` edited | Refused. Rolled back. |
| s10 (new) | the project moved to another workspace (anchoring changes) | Refused. Rolled back. |
| s11 (new) | `created_at` changed (would change `keep_order`) | Refused. Rolled back. |
| s12 (new) | `inherited_from` cleared (would change `direct` and `keep_order`) | Refused. Rolled back. |
| s13 (new; the only column the comparison misses) | `updated_at` only | Committed. This is correct: `updated_at` affects no decision, no kept row and no authority. |
| s14 (new) | `sees_all` granted on a row being deleted | Refused. Rolled back. |
| s15 (new) | (b) run in a fresh session with no view or plan | `relation "pg_temp.membership_dedupe_plan_q" does not exist`. The transaction aborted. |
| s16 (new) | permanent `public.membership_dedupe_plan` and `public.membership_dedupe_plan_now` already exist | The `pg_temp.`-qualified drops left both public tables intact (the decoy row is still there). The unqualified references resolved to the temp objects, and the guard acted on the real plan. |
| s17 (new) | the full documented flow in one session: (a), manual deletes, (a) again, (b) | The re-run of (a) succeeded and the MANUAL result set was empty. (b) ran `UPDATE 2` and `DELETE 5`, then `COMMIT`. 0 duplicate groups remained, and 0088-0118 then applied in one transaction (exit 0). |

The lock statement is unchanged from b9a0c468, where I verified that it blocks a concurrent INSERT and UPDATE and still allows reads. I did not re-run that check here.

## Findings

BLOCKING: none.
NON-BLOCKING (new): none.

## Status of all findings

| Finding | Status |
|---|---|
| N1, C1, C2, C3, C4, N5 | Closed |
| R1 | Closed as a procedure |
| N2 | Recorded forward item (before any runtime slice writes those tables) |
| N3, N4 | Unchanged non-blocking residuals |
| R2 (live duplicate and history state per environment) | Still an operator action |

## Not checked

- Live environments.
- Test suites (no code changed in this delta).
<!-- END REPORT a3bc54a26659d3e77 efcc2017 -->

