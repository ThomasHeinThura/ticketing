# PR #663 — authentic selected expiry reviews and closures

**Reviewed head:** `e306ca48f612191cd79f0bd9122815abded9d5dd`

Original reports, blocking findings, factual/model corrections and independently cleared deltas are preserved verbatim below. The full security review blocked6c28 on a stale snapshot hash; the separate e306 closure covers its one-line correction. This own additive record does not clear current hosted/integrated/image gates, grant a waiver, or relabel source-bound runtime evidence.

## Original report: 663-expiry-independent-a-luna.md

SHA256: `7cb039a4fa78381b47a4e098fedcd4b8f11fb6002865dd012d7db1bea5cbea6f`

# PR #663 independent ordinary review A — GPT-6 Luna

**Verdict: BLOCKED — one focused regression-fixture correction is required.**

**Candidate:** `eca1d69241d5d89e5f8db0877a794ae189813e2a`  
**Comparison base:** `40f05826109fec0f8fc6fcebfe142593fa1d205c`  
**Worktree:** `/Users/heinthura/.codex/worktrees/legacy-ws-reauthorization/Ticketing.v2`  
**Reviewer/context:** fresh independent GPT-6 Luna ordinary reviewer A, dispatched by the orchestrating session. I did not author, direct, or remediate this candidate. No files were changed and no subagents were used.

## Blocking finding

**B1 — The 302,000-row planner fixture contains no due workspace-scoped rows.** In `tests/api-integration/pending-action-expire.test.ts`, the bulk insert marks only `n=200001..202000` and `n=301001..302000` as due. The first range is the two supported null-scope instance shapes; the second is the unsupported null-scope control. Rows assigned `workspace_id='plan-workspace'` are `n=100001..201000`, and their expiry falls into the future-date branch. Therefore, the first-page/cursor custom/generic EXPLAIN assertions exercise due instance rows and the unsupported probe but do not exercise the required supported workspace-due portion of the candidate set. This falls short of the explicit planner acceptance design in the private current-selected manifest (which requires supported workspace, canonical and legacy due rows) and leaves the largest candidate branch unrepresented in this planner regression. Add a bounded workspace-due range to the fixture without reducing the 302,000 rows or relaxing assertions, then retain the existing null-scope and terminal/future controls. The separate routine worker test does exercise due workspace actions, but it does not close this planner-fixture gap.

## Review scope and checks

Inspected all nine candidate-owned files and the full diff from the stated base: migration SQL, schema declarations, scheduler, integration test, 0122 snapshot and journal, data model, pending-actions spec, and migration ledger. Read the repository workflow, review-tier and migration guidance, the assigned private source-selection manifest and author handoff, and the current pending-action service and God Mode route references.

Commands/reproductions run in this review:

- `git status --short --branch`, `git rev-parse HEAD`, base resolution and `git diff --stat`: exact checked-out head/base confirmed; nine files changed.
- `git diff --quiet <base>...HEAD -- apps/api/drizzle/0121_instance_admin_suspend_step_up.sql apps/api/drizzle/meta/0121_snapshot.json`: exit 0; both 0121 files are unchanged.
- Read-only Python lineage check: journal prefix equals accepted-base journal byte data parsed as JSON; entry count 122→123; appended idx 122 has `when=1791744014813`, greater than idx 121's `1791691958123`; 0122 snapshot `prevId` equals accepted 0121 snapshot id; only the two intended indexes are added to `pending_action` in the snapshot. Exact current hashes match ledger/handoff: SQL `bd628a99a8479f1e2051336487e2b48a9e1160d47a611687cbd77a62b11e357b`, snapshot `a241b991a23fb84c4e91d5acac5b1253c48e871d526bcdbd9ccf5cfb7a60f492`, journal `fe40ab48321db5d5d8e51e2e10b660e77101c4548bdd3d4a40395a48b837ce57`.
- `git diff --check <base>...HEAD`: exit 0.
- Inspected the preserved original migration/test failure log and corrected `r2` evidence. Original record shows all 15 tests failed when PostgreSQL rejected the unmatched parenthesis in the second index predicate (exit 1); corrected run record shows 1 file and 15/15 tests pass, 14.86 seconds, PostgreSQL 18.6, scratch latest migration hash equal to the exact 0122 SQL hash. These are author-run results, not a test I reran; the assigned review scope excluded DB/runtime execution. The corrected run’s EXPLAIN strings are asserted in the test but not separately captured in the log.

## Findings that cleared

- The 0121 migration and snapshot remain unchanged; 0122 follows the current accepted snapshot lineage and monotonically appends journal idx 122.
- The migration SQL predicates balance and match the schema declarations. The supported partial index admits pending workspace rows and only the canonical and legacy null-scope user-deactivation forms with exact registered `/deactivate` route and null project/organisation. Unsupported null-workspace rows are excluded from mutation candidates and represented by the complementary probe index.
- The old `/deactivation-requests` path is not used as authority: current service normalization and feature/architecture docs establish `/api/instance/users/{id}/deactivate`; the candidate’s legacy fixture uses that route and tests wrong-route exclusion.
- Scheduler change retains the bounded lease/1,000-row cap, candidate lock ordering, post-lock fresh clock sample and existing terminal update/event/audit order. The scalar clock cutoff and one-shot unsupported probe remain present.
- Planner assertions retain forced custom and generic plans, first page and cursor variants, selected index-name checks, InitPlan checks and no-Sort checks; the issue is fixture population rather than weakened assertions.

**Not performed:** no migration/runtime or DB command, broad build, Docker, browser, route-policy/security check, GitHub check/review query, or independent Sol pass. This is ordinary reviewer A only; it does not satisfy the other two required Luna reviews or the subsequent full GPT-6 Sol security review.

## Original report: 663-expiry-independent-b-luna.md

SHA256: `92e2f0253a0144bc286575457e63d45a460211bc9a4a9ac1a7f1de00a26473c4`

# PR #663 independent ordinary review B — GPT-6

**Verdict: CLEAR — no blocking or non-blocking findings.**

**Candidate:** `eca1d69241d5d89e5f8db0877a794ae189813e2a`  
**Comparison base:** `40f05826109fec0f8fc6fcebfe142593fa1d205c`  
**Worktree:** `/Users/heinthura/.codex/worktrees/legacy-ws-reauthorization/Ticketing.v2`  
**Reviewer/context:** fresh independent ordinary reviewer B. I did not author, direct, or remediate this candidate. The platform identifies this context as GPT-6; I cannot attest to a Luna-specific model label. No files in the checkout were changed and no subagents were used.

## Findings

No blocking or non-blocking findings.

Review A’s fixture finding is not supported by the source. The planner fixture marks `200001..202000` due and gives `100001..201000` a non-null workspace id. Their overlap is `200001..201000`, so the candidate planner does include 1,000 due workspace rows. Rows `201001..202000` supply 1,000 due canonical/legacy null-scope rows. Both first-page and cursor assertions therefore exercise the workspace candidate branch as well as the instance branch. The fixture also includes the due unsupported null-scope probe population, terminal rows, and future rows.

## Scope and checks

Read the repository operating workflow and review policy, CI security-path guidance, current `pending-actions.md`, `data-model.md`, migration ledger, current God Mode/service row-shape authority, private current-source manifest and author handoff. Inspected the full candidate diff for scheduler, focused integration test, schema/index declarations, migration SQL, and technical docs, and read the whole expiry worker and integration test.

Commands run: `git status --short`, `git rev-parse HEAD`, `git diff --stat <base>...<head>`, and targeted `git diff`/`sed`/`rg` inspection. HEAD matched the assigned exact candidate. The checkout has a pre-existing modified `apps/api/drizzle/meta/0122_snapshot.json`; I did not touch it. I did not run DB, browser, Docker, broad build, or tests because the shared runtime is assigned to the orchestrator. The author handoff reports 15/15 focused integration tests passing; I treat that as author evidence, not a test I ran.

## Semantic review

- Candidate selection preserves workspace rows and admits only the canonical `delete`/`user` and legacy `user_deactivation`/`person` null-scope shapes on the registered `/deactivate` route with both project and organisation null. The matching partial-index predicate and complementary unsupported-row probe use the same row-shape predicates.
- The unsupported probe is read-only, scalar and bounded by ordered `LIMIT 1`; unsupported null-workspace rows stay outside candidate selection. SQL `IS NULL` predicates and the supported-shape expression are non-null booleans, so `NOT (...)` does not silently discard nullable values through three-valued logic.
- Each candidate statement has one scalar database-clock cutoff. After `FOR UPDATE SKIP LOCKED`, the worker samples `clock_timestamp()` again for the locked row, then performs the existing conditional terminal update, outbox write and audit attempt. The candidate lock ordering, cursor, 100-row batch and 1,000-row run cap remain intact.
- Terminal rows remain outside the partial index/candidate set; exact expiry boundary is rechecked after lock. The existing focused tests cover audit/outbox behavior, terminal/future rows, cap, unsupported-scope degradation, leases, contention and cancellation races. I found no additional semantic defect in those paths by inspection.

**Disposition:** No findings. Review A’s B1 is cleared by the fixture’s due workspace intersection explained above. This review does not itself satisfy the review panel or the required subsequent GPT-6 Sol security pass.

## Original report: 663-expiry-independent-c-luna.md

SHA256: `47e131c0eaaae8cc718f02034944f9d933d838ca5491a4e436cebdb04bf5a329`

# PR #663 independent ordinary review C — GPT-6 Luna

**Verdict: BLOCKED — the planner regression does not establish execution of all intended candidate paths.**

**Candidate:** `eca1d69241d5d89e5f8db0877a794ae189813e2a`  
**Comparison base:** `40f05826109fec0f8fc6fcebfe142593fa1d205c`  
**Worktree:** `/Users/heinthura/.codex/worktrees/legacy-ws-reauthorization/Ticketing.v2`  
**Reviewer/context:** fresh independent ordinary reviewer C, GPT-6 Luna. I did not author, direct, or remediate this candidate. No files in the repository were changed and no subagents were used.

## Blocking finding

**B1 — The 302,000-row planner regression does not prove the required supported candidate branches are executed.** In `tests/api-integration/pending-action-expire.test.ts`, rows `n=100001..201000` receive `workspace_id='plan-workspace'`, but the due-expiry ranges are only `n=200001..202000` and `n=301001..302000`. Thus there are no due workspace rows. The first range is 1,000 due supported nullable instance rows (500 canonical and 500 legacy); the second is 1,000 due unsupported-null rows for the probe. The required due workspace branch of `pending_action_expiry_scoped_idx` is absent from the planner population. A's report identified this same fixture omission; I independently recomputed it from the SQL and confirm it blocks the planner claim.

There is also an assertion gap in the same mechanism: each candidate EXPLAIN is checked for the index name, `InitPlan`, and no `Sort`, but not for positive `actual rows`; the zero-due EXPLAIN is likewise not checked for zero `actual rows`. The unsupported probe plan checks its index and `InitPlan`, but does not assert a positive result. Consequently, even after adding due workspace rows, these textual plan checks alone can pass without demonstrating that the due candidate/probe data cases were traversed. Keep the 302,000-row fixture and existing plan constraints; add explicit result/actual-row assertions for due candidate executions, the unsupported probe, and the zero-due control, with fixture data that includes supported due workspace rows.

This is one blocking planner-evidence defect class: the test checks planned access-path shape, but does not bind the claimed branch coverage to rows actually present and returned.

## Independent inspection and checks

Inspected the complete candidate diff across its nine changed files: migration SQL, generated snapshot and journal, current schema indexes, scheduler worker, planner and worker integration tests, technical pending-actions/data-model docs, and migration ledger. Read the required repository workflow, CLAUDE provider guide, CI guidance, private #569 selected manifest and author handoff, current route/service contract, and A's private report.

- Confirmed exact checked-out head and stated accepted base. Repository status showed only a dirty `apps/api/drizzle/meta/0122_snapshot.json`; it is candidate-owned, and I did not modify it.
- Independently traced the index predicates and worker predicates. The scoped index and candidate query cover pending workspace rows plus only the exact canonical `delete/user` and legacy `user_deactivation/person` rows with route `POST /api/instance/users/{id}/deactivate` and all-null remaining scope. The complementary probe index/query cover unsupported pending null-workspace rows. The runtime's fresh per-row clock sample remains after candidate row locking, and the state update, outbox and audit behavior remain in their existing order. The bounded batch/lease and 1,000-row run cap remain present.
- Confirmed the old `/deactivation-requests` path is not used as authority; current service normalization and the feature/architecture docs establish `/deactivate`, and the candidate includes wrong-route exclusion coverage.
- Verified 0121 SQL and snapshot are unchanged from the comparison base (`git diff --quiet ...` exit 0). Independently parsed the journal and snapshots: the prior 122 journal entries are preserved, idx 122 is appended with a later `when`, the 0122 snapshot chains from the accepted 0121 snapshot, and only the two intended pending-action indexes are added. Schema columns and other schema-level collections compared unchanged. The handoff hashes for 0122 SQL/snapshot/journal match the current files. The old frozen 0082 migration has a different SHA-256 from the current 0122 SQL, consistent with re-generation rather than copying that migration.
- `git diff --check <base>...HEAD` passed.
- Read the author's preserved PG18 run handoff: it reports the exact integration test command passed 1 file / 15 of 15 tests, including the 302,000-row test. I did not rerun any DB or integration workload. The original failed migration application and corrected run are author evidence only, not independent reproduction. The detailed plan output is not separately preserved in the handoff.

## Not performed

No DB, browser, Docker, broad build, integration/unit suite, GitHub status/review query, or security review was run. This is ordinary reviewer C only. The required independent Sol security review remains pending after ordinary reviews clear. The root's API integration run was left undisturbed.

## Original report: 663-expiry-a-fixture-factual-correction-luna.md

SHA256: `a85f3543fcdd9c58a5ee5a958659be45e90250a81bbb68d45964ebccbabeb4c3`

# PR #663 ordinary review A — additive fixture finding correction

**Correction to:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/663-expiry-independent-a-luna.md`  
**Exact candidate checked:** `eca1d69241d5d89e5f8db0877a794ae189813e2a`  
**Base:** `40f05826109fec0f8fc6fcebfe142593fa1d205c`  
**Reviewer/context:** same fresh independent GPT-6 Luna reviewer A. This report supplements the original; it does not rewrite it.

## Source check and corrected row count

I re-opened the planner fixture using `git show eca1d69241d5d89e5f8db0877a794ae189813e2a:tests/api-integration/pending-action-expire.test.ts` (lines 319–344) and confirmed the worktree planner test equals that exact candidate file. The `workspace_id` and `expires_at` values come from separate `CASE` expressions. I previously treated their row ranges as disjoint; they overlap from 200001 through 201000.

Enumerating the fixture's 302,000 generated rows against those exact CASE predicates gives:

- 1,000 due pending workspace rows (`n=200001..201000`), action `delete` / target `work_item` / work-item route;
- 500 due canonical instance rows (`n=201001..201500`);
- 500 due legacy instance rows (`n=201501..202000`);
- 1,000 due unsupported null-scope rows (`n=301001..302000`), which the candidate query excludes and which the test marks expired before running the probe.

Thus each first-page and cursor EXPLAIN candidate-plan execution starts with 2,000 supported due rows and 1,000 eligible workspace rows. Both are below/above the page limit as intended: the 100-row page has supported workspace and both instance shapes in its candidate population; the cursor at 2000-01-01 precedes all fixture due timestamps. The later update marks all `n=200001..202000` supported due rows expired before the explicit zero-due control.

The original finding B1 is **withdrawn**. My corrected verdict for review A's assigned fixture-coverage scope is **CLEAR**; the specific claim that no workspace-scoped due row existed was false. I did not run database commands or tests.

This correction addresses only the factual premise of A/B1. It does not adjudicate or close any separately reported concern about whether the EXPLAIN assertions should explicitly inspect positive `Actual Rows`; that remains for its reviewer/panel to assess on its own merits.

**Commands/checks:** exact-source `git show`; `git diff --quiet <candidate> -- tests/api-integration/pending-action-expire.test.ts` (exit 0); independent Python enumeration of `n=1..302000` using the fixture's CASE expressions (counts above). No source or test files were edited. The only worktree change remains the orchestrator's formatting-only modification to `apps/api/drizzle/meta/0122_snapshot.json`, outside the planner test and ignored for this correction.

## Original report: 663-expiry-c-fixture-factual-correction-luna.md

SHA256: `233bbf0bc9f3d7f3e165963a2790680b08c764825d2efa66c182b4711658d46c`

# PR #663 reviewer C — additive fixture factual correction

**Candidate reviewed:** `eca1d69241d5d89e5f8db0877a794ae189813e2a`  
**Comparison base:** `40f05826109fec0f8fc6fcebfe142593fa1d205c`  
**Reviewer:** fresh independent ordinary reviewer C, GPT-6 Luna. This is an additive correction to my report `663-expiry-independent-c-luna.md`; that original report is left unchanged.

## Withdrawal of incorrect claim

I withdraw the statement in my original report that the 302,000-row fixture has no due workspace rows. Re-reading the actual `CASE` ranges in the candidate test:

- `workspace_id='plan-workspace'` for `n=100001..201000`;
- due expiry for `n=200001..202000` and `n=301001..302000`.

The first due interval intersects the workspace interval at `n=200001..201000`, exactly 1,000 due workspace rows. Rows `n=201001..201500` and `n=201501..202000` are the 500 canonical and 500 legacy supported instance rows. Therefore the supported candidate fixture does contain due workspace and instance rows; my earlier arithmetic incorrectly treated the endpoint 201000 as excluded. The original B1 wording about a missing due workspace branch is withdrawn and must not be relied on.

## Surviving planner-evidence finding

The unsupported probe's intended due-data case is absent at the time its EXPLAIN runs. Before the unsupported query at test lines 414 onward, the test updates `plan-pa-301001..plan-pa-302000` to `state='expired'` (lines 408–412). Those are the 1,000 unsupported nullable-scope rows, so the probe query at lines 416–430 runs with no due unsupported pending rows. Its index-name and `InitPlan` assertions therefore establish the plan shape for an empty probe result, not the bounded probe path under the representative unsupported-due load called for by the private selection manifest (“unsupported nullable due rows” and “unsupported probe uses its scalar bounded index path”). This is the surviving required planner-evidence gap. Retain the unsupported due rows until after the probe EXPLAIN, then apply the state update; check a positive probe actual row/result before cleanup so the case is anchored to data.

The candidate first-page and cursor EXPLAINs do have due candidates in the population. The cursor bind uses `'2000-01-01T00:00:00Z', '', 100`, earlier than every fixture expiry, so every fixture row is after that cursor. The cursor predicate is syntactically present and its plan is checked for the scoped index/no Sort. The private manifest requires first-page and cursor query shapes under custom and generic plans and their index-supported ordering; it does not specify a deep cursor position or exact result counts. I therefore classify deeper cursor-boundary coverage and exact candidate/probe row counts as useful strengthening, not an independent blocker under the stated plan requirement. The positive unsupported-probe case is different because the explicit fixture plan requires unsupported due rows to exercise the probe, but the test expires them first.

## Corrected verdict classification

My original verdict remains **BLOCKED**, with the blocker narrowed to unsupported-probe planner evidence only. The missing-workspace claim is withdrawn. No source changes, DB/builds, tests, or repository edits were made for this factual audit. No conclusion is added about runtime acceptance or the pending Sol review.

## Original report: 663-expiry-c-positive-probe-closure-luna.md

SHA256: `73beefc21ea44d9ab85f4e27c40b2ff509c07684b9786ab35a2cd9e5eb89f59f`

# PR #663 independent reviewer C — positive-probe blocker closure

**Verdict for the prior C blocker: CLEAR.**

**Exact candidate:** `bde7d4c3d7254402f5e5307eecfb7ed190ec4553`  
**Compared delta from:** `eca1d69241d5d89e5f8db0877a794ae189813e2a`  
**Accepted base:** `40f05826109fec0f8fc6fcebfe142593fa1d205c`  
**Worktree:** `/Users/heinthura/.codex/worktrees/legacy-ws-reauthorization/Ticketing.v2`  
**Reviewer/context:** independent ordinary reviewer C, GPT-6 Luna. I did not author, direct, or remediate this delta. No repository files were changed and no subagents were used.

## Blocker closure

The sole surviving C blocker from the additive factual correction was that the due unsupported-null rows were marked expired before the probe EXPLAIN, so that plan covered an empty result only. The new test delta fixes the ordering and proves the positive case:

- The due fixture expands from unsupported rows `n=301001..302000` to `n=299001..302000`, increasing that due population from 1,000 to 4,000 rows without reducing the 302,000-row table or changing the supported workspace/canonical/legacy due ranges.
- Before any unsupported rows are expired, the test runs the exact unsupported-due scalar predicate and asserts `unsupported_due: true`.
- It then runs `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SUMMARY)` against that still-populated unsupported-due case and retains the `pending_action_expiry_unscoped_probe_idx` and `InitPlan` assertions.
- Only after the positive probe plan does it mark `n=299001..302000` expired, analyze, and retain a separate empty-probe EXPLAIN with the same index and InitPlan assertions.
- The first-page/cursor custom and generic candidate plans, index assertions, InitPlan checks, no-Sort checks, the 302,000-row dataset, the later zero-due candidate plan, and all authority/runtime source remain unchanged in the per-parent diff.

This restores the requested supported positive and empty controls without weakening the dataset or plan oracles. I confirmed the changed files are only the focused integration test and `0122_snapshot.json`. The snapshot parses JSON-equivalent to its prior exact-head version; its byte hash changed because of formatter output, with no schema-semantic change. The test-only delta does not alter authorization or runtime behavior.

## Evidence and limits

I read the exact per-parent diff and the author's preserved PG18 run `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/569-expiry-positive-probe-r3.log`, which reports the focused integration file passed with 15/15 tests. I did not rerun the database suite; the runtime result is author evidence, not my independent reproduction. No DB, browser, Docker, broad build, or other test was run. This closure addresses only the prior ordinary C planner-fixture blocker; it is not a security review or a general acceptance/merge verdict.

## Original report: 663-accepted-openapi-composition-independent-luna.md

SHA256: `bc7f5d559d422da3fc549a0d659b1e1ffe1c73a47f80d198b1016afb1efc9faf`

# PR #663 accepted OpenAPI composition — independent ordinary delta review

**Verdict: CLEAR for the accepted OpenAPI composition delta only.** No blocking or non-blocking findings.

- **Reviewed head:** `6c28c076dc7316eebe2d31dda1d28efeaecef841`
- **Merge parents:** expiry candidate `bde7d4c3d7254402f5e5307eecfb7ed190ec4553`; accepted main `3dadd086d2a0bc3d35621fc97683cc0dea2eec7d`
- **Accepted checker source:** `8fb32f18afceefb0f930872093dd62144aaddc95`
- **Reviewer:** fresh independent ordinary-review context; I did not author, direct, or remediate the checker or this composition.

## Scope and checks

I read the accepted #662 ordinary/Sol reports and preservation note, all three authentic original #663 panel reports, their A/C factual corrections, C's positive-probe closure, and the #663 author handoff. I inspected both merge parents and the parent-relative changes. The #662 incoming first-parent delta is only the 65-line review record and the two checker files; both source blobs at `6c28c076` match accepted checker commit `8fb32f18`. Against the accepted-main second parent, the candidate retains the complete #663 expiry migration/test/docs source, including the correction that establishes the positive unsupported-due probe before expiring those rows.

The original A/C fixture blockers and factual corrections remain separately preserved; C's subsequent positive-probe closure remains the source-bound closure record. The accepted OpenAPI change does not rewrite or replace those reports or alter the #663 expiry source. The #662 exact-source focused checker evidence is 55/55 tests with large-object byte fidelity and missing-ref/path failures; I relied on its recorded ordinary/Sol review and did not rerun the checker suite here. No PostgreSQL, database, broad build, browser, or Docker run was performed.

## Limits

This clears composition only. It does not replace #663's original ordinary panel, correct any prior panel report, establish current PostgreSQL/image/runtime/hosted acceptance, or satisfy the fresh GPT-6 Sol security review required on this current security-scope head. No general PR readiness or merge claim is made.

## Original report: 663-expiry-current-full-security-sol.md

SHA256: `224bba542450ca9f652d75e4d608b52a4f83b01b41108f16c7050e8469ced9a2`

# PR #663 — independent full security review at current head

**Verdict: BLOCK.** One current-head provenance defect must be corrected and reviewed at the new exact head. I found no separate authority bypass in the expiry selection or mutation logic inspected here.

**Reviewed head:** `6c28c076dc7316eebe2d31dda1d28efeaecef841`  
**Accepted comparison base:** `3dadd086d2a0bc3d35621fc97683cc0dea2eec7d`  
**Owning source base:** `40f05826109fec0f8fc6fcebfe142593fa1d205c`  
**Reviewer:** fresh independent GPT-6.1 Sol security context, dispatched for this review after ordinary clearance. I did not author, direct, or remediate the candidate or its ordinary-review corrections. No source edit, subagent, database, browser, Docker, or broad build was used.

## Blocking finding

The 0122 migration ledger records snapshot SHA-256 `a241b991a23fb84c4e91d5acac5b1253c48e871d526bcdbd9ccf5cfb7a60f492`, while the snapshot committed at the current head hashes `f994f16dee182854589ab6be35c26622bb62487b5b7c211998679f19008f1cd0`. The old hash belongs to `eca1d692`; `bde7d4c3` reformatted `apps/api/drizzle/meta/0122_snapshot.json` without updating `docs/07-planning/migration-ledger.md`. I parsed both committed snapshots and confirmed JSON structural equality, including snapshot id and predecessor, so this is a provenance/factual-integrity defect rather than an identified migration-semantic defect. The ledger nevertheless asserts a false exact-byte hash for the review candidate. Reconcile the recorded hash to the final committed artifact through the normal owner flow and obtain required exact-head delta review; this report does not approve a later head.

## Security checks and evidence

I inspected all nine #663 source paths, the two-parent merge from `bde7d4c3` and accepted `3dadd086`, the current worker, integration test, migration/index declarations and specification. The merge imports exactly the accepted #662 review note plus `scripts/ci/test-contract.mjs` and its test. Those two checker blobs equal accepted source `8fb32f18afceefb0f930872093dd62144aaddc95`; no worker, migration, or planner test file changed in this composition. The accepted #662 strong ordinary and full Sol reviews cover that unchanged checker source. This is a separate current-head assessment of its composition, not a replacement review of that product checker.

The worker's candidate and partial-index predicates agree: all pending workspace rows remain eligible, while nullable-workspace rows require null project and organisation, one of the two canonical/legacy action-target pairs, and the exact registered `/deactivate` route. The complementary unsupported probe contains the inverse null-workspace shape and does not select those rows for mutation. The predicate's null checks and non-null action, target and route columns avoid an SQL three-valued-logic omission. The test adds wrong-route exclusion and both canonical and legacy positive expiry cases. It also asserts a positive unsupported-due result before its positive EXPLAIN, then exercises a separate empty probe. The 302,000-row planner fixture includes due workspace rows (`200001..201000`) and due canonical/legacy rows (`201001..202000`); this corrects the A/C original range claims through their preserved factual corrections and C's positive-probe closure.

Candidate selection retains `(expires_at, id)` order, `FOR UPDATE SKIP LOCKED`, 100-row batches and the 1,000-row run cap. Each candidate statement has one scalar database-clock cutoff, and each locked row receives a fresh `clock_timestamp()` sample before the conditional terminal update. Event enqueue stays in the same transaction as that update, and the pre-existing audit-failure/degraded path remains. I inspected the 15 focused test cases for expiry, lease, contention, cancellation, terminal/future state and audit/outbox consequences; the author's PostgreSQL 18 log at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/569-expiry-positive-probe-r3.log` reports one file, 15/15 passed. I did not independently rerun PostgreSQL or infer broad integration coverage from it.

The new 0122 SQL SHA-256 is `bd628a99a8479f1e2051336487e2b48a9e1160d47a611687cbd77a62b11e357b`, matching the ledger. Journal SHA-256 `fe40ab48321db5d5d8e51e2e10b660e77101c4548bdd3d4a40395a48b837ce57` also matches. The journal preserves its accepted prefix, appends idx 122 after 0121, and snapshot `prevId` equals the accepted 0121 id. The 0121 SQL and snapshot are unchanged. `git diff --check` passed. These checks do not cure the false 0122 snapshot byte hash.

**Limits:** This is a full security review of the specified expiry candidate and exact accepted-main composition, with static and source-bound test evidence. It is not overall PR readiness, current hosted checks, image/runtime acceptance, or approval to merge. Original ordinary reports and corrections remain authentic and are not rewritten by this verdict.

## Original report: current-security-reviews-model-provenance-correction.md

SHA256: `99f3930949a77be8b1f8801d74de59567d62485e3e3a6790b7e09c450019c106`

# Model provenance correction for four current security reports

The four original security reports below remain preserved verbatim. Their reviewer lines identify this context as **GPT-6.1 Sol**. That specific serving variant is not independently visible to this reviewer and should not be asserted as fact. The parent dispatch explicitly selected **`gpt-6-sol`**, a Sol-tier model, for this fresh independent context. The truthful provenance is therefore **GPT-6 Sol (dispatch selector `gpt-6-sol`; actual serving variant not independently exposed)**. This correction changes no security finding, review scope, head SHA, or verdict.

- `663-expiry-current-full-security-sol.md` — current-head BLOCK, snapshot ledger byte-hash mismatch.
- `650-accepted-openapi-composition-security-sol.md` — bounded composition PASS only.
- `661-accepted-openapi-composition-security-sol.md` — bounded composition PASS only.
- `660-accepted-openapi-composition-security-sol.md` — bounded composition PASS only.

The four reports were produced in one fresh reviewer context, which served only the security-review role for distinct candidate compositions and #663. It did not author, direct, or remediate any of those candidates. This correction must travel alongside any cited report so the model label is not misrepresented.

## Original report: 663-expiry-ledger-provenance-delta-luna.md

SHA256: `72455b42b4557a09a76876f93e675ba45b83aeb630e7107ef5ca086baf6b99b0`

# PR #663 independent ordinary provenance-delta review — GPT-6 Luna

**Verdict for the provenance-only delta: CLEAR.**

**Exact candidate:** `e306ca48f612191cd79f0bd9122815abded9d5dd`  
**Parent:** `6c28c076dc7316eebe2d31dda1d28efeaecef841`  
**Accepted base:** `40f05826109fec0f8fc6fcebfe142593fa1d205c`  
**Worktree:** `/Users/heinthura/.codex/worktrees/legacy-ws-reauthorization/Ticketing.v2`  
**Reviewer/context:** fresh independent ordinary reviewer, GPT-6 Luna. I did not author, direct, or remediate this one-line delta. No repository files were changed and no subagents were used.

## Scope and finding

The entire parent-to-candidate diff is one changed line in `docs/07-planning/migration-ledger.md`: the 0122 snapshot SHA-256 changed from `a241b991…f492` to `f994f16d…1cd0`. I recomputed the hash of the exact candidate Git blob for `apps/api/drizzle/meta/0122_snapshot.json`; it is `f994f16dee182854589ab6be35c26622bb62487b5b7c211998679f19008f1cd0`, matching the corrected ledger value.

I independently computed all three 0122 artifact blob hashes at the exact candidate:

- SQL: `bd628a99a8479f1e2051336487e2b48a9e1160d47a611687cbd77a62b11e357b`
- Snapshot: `f994f16dee182854589ab6be35c26622bb62487b5b7c211998679f19008f1cd0`
- Journal: `fe40ab48321db5d5d8e51e2e10b660e77101c4548bdd3d4a40395a48b837ce57`

All three migration artifacts are byte-identical between the parent and candidate; this delta changes no migration SQL, snapshot bytes, journal bytes, runtime source, tests, or schema inputs. Parsing the parent and candidate 0122 snapshots yields equal JSON values. The journal still has 123 entries with the original 122-entry prefix intact and idx 122 appended; its `when` (`1791744014813`) is later than idx 121 (`1791691958123`). The 0122 snapshot keeps id `ad77f50c-137a-4055-8be7-62d22e641839` and `prevId` `e84c11cb-c53a-478b-9ce9-7971ca12b691`, matching the accepted 0121 snapshot id. Compared with 0121, its only changed table remains `public.pending_action`, columns are identical, and the two intended expiry indexes are the only additions. `git diff --check` passes.

This clears the stale-ledger-hash factual blocker only. It does not replace the existing ordinary composition reviews, the C positive-probe closure, or the separate full security review, and does not make a CI/runtime/merge claim.

## Not performed

No DB, browser, Docker, build, unit, or integration command was run. No GitHub state was queried. Root's API integration run was left undisturbed.

## Original report: 663-expiry-ledger-provenance-security-closure-sol.md

SHA256: `442706729a91e8295eea427cb6da8765d5d63ef42a0f25a4769cc4d96c94467f`

# PR #663 — independent Sol security closure of provenance blocker

**Verdict: CLEAR for the exact-head one-line provenance correction.** The blocking finding in the original full security review is closed at this new head. No new security finding was identified in this delta.

**Reviewed head:** `e306ca48f612191cd79f0bd9122815abded9d5dd`  
**Parent/full-review source:** `6c28c076dc7316eebe2d31dda1d28efeaecef841`  
**Accepted main in the composed candidate:** `3dadd086d2a0bc3d35621fc97683cc0dea2eec7d`  
**Reviewer:** fresh independent Sol-tier security context dispatched with selector `gpt-6-sol`; actual serving variant is not independently exposed. I did not author, direct, or remediate this correction.

The authentic full BLOCK report is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/E/663-expiry-current-full-security-sol.md`. Its separately preserved model-provenance correction is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/E/current-security-reviews-model-provenance-correction.md`. I also read the independent ordinary delta CLEAR at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/663-expiry-ledger-provenance-delta-luna.md`. These original reports remain unchanged; this note closes only their identified new-head delta.

## Exact-head verification

The new commit has one parent, the full-review head above. Its entire diff is one value replacement in `docs/07-planning/migration-ledger.md`: 0122 snapshot SHA-256 `a241b991a23fb84c4e91d5acac5b1253c48e871d526bcdbd9ccf5cfb7a60f492` becomes `f994f16dee182854589ab6be35c26622bb62487b5b7c211998679f19008f1cd0`. I recomputed the latter from the committed `0122_snapshot.json` bytes at this head; it matches. The other ledger hashes also match their committed artifacts: SQL `bd628a99a8479f1e2051336487e2b48a9e1160d47a611687cbd77a62b11e357b` and journal `fe40ab48321db5d5d8e51e2e10b660e77101c4548bdd3d4a40395a48b837ce57`.

`git diff --name-status` shows only the ledger file. I verified identical Git blob ids between parent and current head for the 0122 SQL, snapshot, journal, schema, expiry worker, and focused integration test. The remaining #663 spec and data-model files are likewise untouched; the parent-to-head `git diff --check` passes. This correction changes no selection predicate, index, authorization, gate, test, event/audit, or runtime behavior. The full security assessment of the unchanged source remains source-bound to the parent; the exact-head delta closes its sole blocker without relabelling the parent's PostgreSQL result as a new-head run.

**Limits:** This is a security delta closure, not a fresh database, broad test, Docker, browser, image, hosted-CI, or merge-readiness claim. Any future source edit requires review at its own exact head. No repository files were edited by this reviewer.

