# Task query ownership recovery — #580 batch9

Current full security-reviewed source `09e3a531ce2f5213dfda1a49c7dd8fc2a3fe5609`, accepted comparison base `33995c2af23da197f2fd9d5690717f7aeb4e9f67`. The reports below retain their exact original bytes and original heads/verdicts. Author reports and earlier planning/advice are not independent reviews. Earlier blockers and failed/terminated runtime remain historical adverse evidence; current clearance is provided only by current ordinary coverage and the fresh full security report. The two private source planning maps remain retained separately.

Three independent ordinary contexts covered the full candidate with appropriate repairs/deltas; the latest strong A clears structural result/admission and administrative-reset repairs. Fresh independent requested GPT-6.1 Sol clears all28 current paths after ordinary review. Current focused PostgreSQL10 files165/165/native0 is source-bound; hosted/full-suite/image/browser acceptance is outstanding. Five inherited non-task helper bodies remain unchanged and owned by #773, with no blanket producer exception. Prior reset-reader origin remains unproven.


## Evidence file

`query580-b9-09e3-focused-pg-result-luna.md`

# Focused PostgreSQL result — 09e3a531

Candidate: `09e3a531ce2f5213dfda1a49c7dd8fc2a3fe5609` (clean worktree; runner verified 10 selected paths).

The single authorized run completed successfully. The native Vitest exit code was 0: **10 test files passed, 165 tests passed**, duration 51.892 seconds; CI was absent. The run exercised the reset-lock-acquisition cases together with the prior workspace-RBAC, task reach, label concurrency/idempotency, mutation atomicity, task move/archive, and reach regressions. The PostgreSQL log includes a real `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE NOWAIT` failure on `workspace` (`could not obtain lock on relation "workspace"`), observed by the test path; the suite passed, including retry/exhaustion and unrelated-error behavior. No failure stack or red test was reported by Vitest.

Exact invocation was the prepared runner:

`python3 /Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-09e3a531/run-focused-tests.py`

It ran `pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts` against these ten files: `task-title-activity.test.ts`, `task-repository.test.ts`, `task-repository-moves.test.ts`, `task-target-reach.test.ts`, `workspace-rbac.test.ts`, `label-detach.test.ts`, `label-bulk-rename-race.test.ts`, `task-update-concurrency.test.ts`, `project-archive-freeze-legacy.test.ts`, and `database-reset-locks.test.ts`.

Evidence is under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-09e3a531/`. Native Vitest log SHA-256: `6af30de9a97439929f90e8f04e15a990261e85d4bed1c9e5aede36e4a184ac68`; PostgreSQL log SHA-256: `4ac5f1c374003fd3f80429165c5b8ba8cab321077a3a0592bc57866c377a2c2c`; `/proc/mounts` proof SHA-256: `14e25561cce1dc0f67bc72a7bce2be18fc126e7d2db49e34afe790a2f8db7585`. The run used PostgreSQL 18 Alpine with exact `/var/lib/postgresql` tmpfs proof, dynamic loopback-only port, and no TZ override.

Cleanup stopped/removed only owned container `52924c163ba6b8a211f2070243cdbf43dd0775d409f6a572c5d03e36012a5435` (stop exit 0; labels matched candidate and run). Docker inventory returned exactly to baseline: containers 23/23, volumes 109/109, networks 7/7; no additions or missing resources. Temporary database URL file was removed by the runner.

This is a focused runtime result for the listed ten files only. It is not a full-suite/build/browser result or an independent review. Earlier adverse `1d1527` run and its causal-attribution correction remain preserved; this successful changed-head run does not rewrite that history.


## Evidence file

`query580-b9-09e3-full-security-61-sol.md`

# Query ownership #580 batch 9 — fresh full independent security review

**Model:** GPT-6.1 Sol
**Model provenance:** The conductor confirms this context was spawned with `fork_turns: none`, `model: gpt-6.1-sol`, `reasoning_effort: high`. No served model/version fingerprint is exposed to this reviewer or the conductor; requested routing is recorded without inventing one.
**Role/context:** Fresh independent FULL security reviewer, `/root/query580_b9_09e3_full_security_sol`.
**Reviewed head:** 09e3a531ce2f5213dfda1a49c7dd8fc2a3fe5609
**Comparison base:** 33995c2af23da197f2fd9d5690717f7aeb4e9f67 (assigned accepted main and verified merge base).
**Checkout:** `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`.
**Independence:** I did not author, direct, or remediate this candidate. This is a fresh context without inherited author turns. I inspected the actual full candidate, relevant callers and evidence rather than adopting earlier verdicts. No child agent was spawned.
**Verdict:** **CLEAR for the full 28-path candidate security-review scope.** No blocking or additional non-blocking security finding identified in this change. Prior B1 and B2 concrete findings are closed at this head as explained below. This is not merge approval, a phase finalizer, runtime/SIT acceptance or whole-#580 completion.

## Scope actually inspected

Read AGENTS.md, active mission, agent workflow, CLAUDE.md, coding standards including the actual query-ownership section, current status and newest decision-log entries, multi-tenancy query scoping, security-model query/reach requirements, RBAC reach contract, work-items WI-6/WI-7a/WI-25, project archive/deletion PR-15/PR-16, ADR 0011 and the authoritative CI security-review path list.

Inspected all 28 net changed paths against the assigned base: 21 production and seven test paths, 4,609 insertions and 775 deletions. Production scope covers the complete task repository; task index/routes and both full-update adapters; assert-task-project-live and validate-task-fields; all 17 changed controllers (bulk, number claim, create, delete, export, get one/list, import, move, permission middleware, six narrow updates and full update). Read complete repository and move integration tests, complete title/activity regression file, reset helper and new reset-lock tests, and the archive-freeze/bulk-unit test deltas. Separately inspected the five-path 7c-to-09e3 repair delta.

Followed unchanged relevant seams through resolveCallerIdentity, identity resolution and API-key binding, current identity-scope predicates, callerReach and route middleware, Executor, schema/defaults, assignable-user guards, project-freeze locking, label-name locking, event publication and activity/notification subscribers. Checked exported producer results and actual production callers. Source comparisons confirmed the five inherited legacy helper bodies remain identical to the assigned base.

Read prior full Sol 0e3/B1 and 7c/B2 reports, current Ordinary A, write-admission/result repair, reset-lock repair, wrapped-driver-error repair, the 1d1527 deadlock-attribution correction and exact-head focused PostgreSQL result. Those reports remain authentic historical records, including their adverse results.

## Prior blocker disposition and required-result invariant

**B1 closed.** Title update requires both its task UPDATE result and the synchronous activity INSERT SELECT RETURNING result inside one transaction. An activity scope refusal now throws before commit, rolling back title/version and preventing the postcommit title event. Due-date update checks its required task result inside the transaction containing reminder clearing; a refusal rolls back the earlier reminder deletion. Bulk status, priority, assignee and due-date branches require an admitted returned ID before queueing any mutation event or successful item count. Refusal throws inside the per-item transaction. Relation refresh is after a successful status item commit.

The real trigger-barrier tests pause an actual title UPDATE or reminder DELETE, commit persisted project-grant revocation on a separate connection and resume the real next statement. They assert unchanged title/due date/version, preserved reminder state, no activity and no captured events. Bulk barriers preserve the actual positive repository lookup before revocation; they do not replace the scoped mutation with a simulated refusal. These are meaningful source-level regression oracles for the previous defect class.

**B2 closed.** Bulk deletion requires the scoped DELETE to return an ID, otherwise throws opaque `Task not found` inside its transaction; a refused delete cannot report success or emit task.deleted. Label add/remove now return a discriminated `refused` / `unchanged` / `changed` result. Each uses an eligible-task CTE correlated to task ID, workspace and current persisted task-project reach, plus its mutation CTE, with the final result selecting both under one statement snapshot. No eligible row means refusal; an eligible task and no mutation row means a genuine idempotent result, including add's exact task/name ON CONFLICT no-op. Actual changed rows alone queue label events. Controller refusal is handled before item success.

The three new persisted-revocation cases cover delete-present, add-missing and remove-present after actual task locking and positive scoped project context. They assert failed item results, unchanged task/version and label rows, and no activity/events. The positive add-present/remove-absent case verifies zero-count successes and preserved rows without events. Task row and label-family locks retain the existing concurrency discipline. I found no remaining false-success or false-event instance in the inspected producer/caller paths.

## Full production security conclusions

Request identity comes from the existing credential-aware resolver, retaining enabled API-key owner binding, stored capability subset and session/impersonation distinction. Changed handlers consistently pass it into controllers/repositories. Existing workspace/project capability and API-key owner/scope gates remain in place; SQL reach does not replace authority. No route, policy kind, capability or trust-boundary expansion is introduced.

Task reads and writes, task-derived labels, links, relations, reminders, activity and asset statements correlate current reach to the addressed task/project. Project/context/column selectors include identity reach rather than treating an ID as scope. Generic task updates exclude projectId from inputs and pin it in the actual SET clause. The dedicated move checks exact task/source, current reach to both source and destination, live/unarchived projects in the same workspace, and rejects linked assets outside the source project. Its dependent asset UPDATE consumes the moved-task RETURNING row in one data-modifying CTE statement. Task/assets therefore share one authorization snapshot; unrelated assets are excluded.

Move orchestration locks the task first, then sorted project rows, destination exclusive and source shared. It does not reintroduce the premature source share lock from the earlier adverse run. Required number-claim/move results throw inside the transaction. Source-freeze/error precedence and postcommit task.moved remain. I found no new split-move, lock-order, tenant-write, injection, capability widening or credential-scope-erasure blocker.

Compared the task, activity, asset and task-label INSERT SELECT producers with their actual target schema. Supplied values use destination-column sql.param encoders, including Date/timestamp and JSONB fields. Scoped relationship columns derive from admitted source rows. Omitted defaults remain distinct from explicit nullable task position/number. Existing codec/default/null regressions meaningfully cover these shapes. Create/import publish no task.created without a returned inserted task. A late insert refusal can consume a number; no contiguous-number contract was found, so this is not classified as another blocker. Asset finalization requires a returned ID before success and has no preceding asset write to strand on that miss path.

## Administrative reset security and liveness

The reset repair retains the existing non-test database guard, catalog-derived public base-table list, identifier quoting, transaction-local trigger setting, full TRUNCATE RESTART IDENTITY CASCADE and migration check. It first requests ACCESS EXCLUSIVE NOWAIT locks on the same table list in the same transaction. A failed lock acquisition rejects the transaction, releasing partial locks before any observer/retry. The lock cycle created by retaining early table locks while waiting for a later reader is avoided by NOWAIT.

Only the lexical LOCK TABLE statement catch converts SQLSTATE 55P03 into the private retry wrapper. The cycle-safe cause-chain matcher recognizes the real Drizzle driver envelope. The outer loop catches only that wrapper and permits five attempts with 10/25/50/100ms delays. Original errors remain available to the observer and as the final exhaustion cause. Guard, trigger-setting, truncate, migration, other SQLSTATE and observer failures propagate; no product mutation or test action is retried. No runner/config skip, budget weakening or product exception was added.

New tests use actual separate-client PostgreSQL locks. They establish real NOWAIT refusal, prove release of an earlier account lock after rollback, preserve seeded data before retry, then verify full clearing and sequence restart after contention is released. Another holds contention for all five attempts and asserts bounded failure plus preserved rows; the non-test URL guard asserts no lock observer call. This verifies the relevant administrative control semantics without manufacturing driver failures.

The earlier 1d1527 reset-vs-task/project-reader deadlock remains adverse. Its reader's initiating caller/PID attribution remains unproven. The inspected event bus can leave async listeners in flight, but neither that source possibility nor this successful changed-head run proves the prior reader came from a particular callback or test. This review does not rewrite that causal limit or claim a general event-drain repair.

## Checks actually performed and evidence limits

Performed read-only Git/source/evidence inspection: exact HEAD/status, merge base, log, base-to-head and repair diffs/stat/numstat, caller searches, schema/contract comparison, read-only Python extraction/comparison of five legacy helper bodies, evidence JSON/native log inspection and SHA-256 checks. `git diff --check` against the assigned base passed; checkout was clean at inspection. Read live open-PR inventory only; this report makes no hosted exact-head CI or PR-readiness claim.

The existing exact-head operator run is source-bound to 09e3a531, ten selected files and native exit 0: **10 files / 165 tests passed**. The receipt records 51.892s wall time, CI absent; native Vitest summary reports 51.05s. Selected files cover title/activity, task repository/moves/reach, workspace RBAC, label detach/rename concurrency, update concurrency, archive freeze and reset locks. Independently checked log hashes: Vitest `6af30de9a97439929f90e8f04e15a990261e85d4bed1c9e5aede36e4a184ac68`; PostgreSQL `4ac5f1c374003fd3f80429165c5b8ba8cab321077a3a0592bc57866c377a2c2c`; /proc/mounts `14e25561cce1dc0f67bc72a7bce2be18fc126e7d2db49e34afe790a2f8db7585`. Receipts record PG18 Alpine, tmpfs at /var/lib/postgresql, dynamic loopback port, exact owned-container cleanup exit 0 and restored inventories (23 containers, 109 volumes, seven networks; no additions/missing IDs). Existing realtime.failure log entries remain; the passing suite is not acceptance of all realtime behavior. These are inspected operator results, not tests run by me.

No source edits, Git/ref writes, package installs, tests, PostgreSQL/Docker/runtime execution, image build/boot, browser, hosted CI execution, GitHub mutation, publication, push, merge or remediation occurred. The only write is this newly created private report. No full-suite, image/health, browser/SIT, current required-check or merge-readiness assertion is made.

Inherited shared non-task helpers remain the #773 ownership/scoping gap: lockLegacyTaskRowIfPresent, lockLegacyTaskRow, lockTaskAndAssertProjectLive, lockProjectsAndAssertLive and lockProjectAndAssertLiveForTaskNumber are unchanged. Other unchanged assignable-user/storage/shared-query seams remain with their owners. This clearance grants no blanket internal-producer exception, no rest-of-#580 conversion, no outbound activation and no stage completion. Remaining applicable exact-head gates still apply.


## Evidence file

`query580-b9-09e3-write-admission-reset-ordinary-a-luna.md`

# Ordinary A delta review — #580 batch 9 write admission and reset retry

- **Reviewer/model:** GPT-6 Luna; fresh independent review context, not an author or fixer of these changes. This review retains the complete 28-path scope previously inspected for c13/7c and focuses on the five-path delta from 7c.
- **Exact head:** `09e3a531ce2f5213dfda1a49c7dd8fc2a3fe5609`
- **Protected-main base:** `33995c2af23da197f2fd9d5690717f7aeb4e9f67` (merge-base). Worktree was clean. The complete candidate diff is 28 paths; the current delta from `7c461e2bdedf18cc96860cd77eb28927e8ce883e` is five paths: bulk controller, task repository, existing title/activity integration test, integration reset helper, and new reset-lock integration test. `git diff --check` against protected main is clean.
- **What I checked:** the three B2 bulk-delete/label refusal cases and label no-op semantics; one-statement eligible-task/mutation result classification and SQL snapshot behavior; exact reset lock/retry/error handling; its regression test sequencing, guard, bounded failure and state/sequence assertions; and retained c13/7c task-scope, move, codec, transaction/event conclusions. I read the repair notes, 7c Sol blocker, reset attribution/error-envelope notes and 09e3 focused PG result. Static source review only: I did not run tests, PG, build, runtime, browser or Docker and made no repository edits.
- **Verdict:** **CLEAR for this Ordinary A review scope; ready for the remaining required fresh Sol review and exact-head gates.** This does not clear the prior 7c Sol blocker as a reviewer verdict, approve merge, or claim full #580 completion.

## Findings

The B2 bulk paths now distinguish current-scope refusal from valid idempotency at the mutation statement. Bulk delete requires its identity-scoped DELETE to return a row; a zero-row result throws the opaque not-found error inside the per-item transaction, so the item cannot commit as success or publish `task.deleted`. Label add and remove each use one SQL statement with an eligible task CTE correlated to task ID, workspace and current `taskProjectReach(identity, executor)`, plus a data-modifying CTE returning the actual insert/delete. The final select yields `refused` when no eligible task exists, `unchanged` when the task remains eligible but the desired label state was already satisfied (including `ON CONFLICT DO NOTHING` on add), and `changed` when a row was actually inserted/deleted. The controller throws on refusal, queues events only for `changed`, and preserves success with zero count for genuine add-present/remove-absent cases. Because eligibility and mutation are in the same statement, a grant revocation committed after the retained task lock but before the write statement is reflected in that statement snapshot; an earlier positive context read cannot be mistaken for current authorization.

The three added revocation tests pause after the actual positive project-context lookup within the item transaction (following the task row lock), delete and verify the persisted project grant through the separate test DB connection, then resume the actual delete/add/remove operation. Assertions check failed item results, unchanged task/version and label rows, no activity and no events. A separate test covers add-present and remove-absent idempotent successes, preserved rows and no events. These are meaningful oracles for the prior false-success class. I reviewed them statically.

The reset helper keeps its test-database guard, catalog-derived public base-table enumeration, transaction-local trigger setting, full `TRUNCATE … RESTART IDENTITY CASCADE`, and post-reset migration check. It first acquires ACCESS EXCLUSIVE NOWAIT locks on the same quoted table list in the same transaction. A 55P03 from only that lock statement is wrapped; transaction rollback releases any partial locks before retry. The retry sequence is bounded to five total attempts with 10/25/50/100ms delays. The outer retry accepts only the private lock-unavailable wrapper; the original Drizzle/driver error is retained as its `cause`. Other lock, truncate, guard, migration or DB failures propagate. The SQLSTATE matcher walks nested `cause` objects, detects cycles, and returns true only upon finding the exact expected 55P03. This matches the Drizzle error envelope documented in the repair note (driver SQLSTATE nested under `DrizzleQueryError`) without broadening retry to unrelated errors.

The reset integration tests use actual second PostgreSQL connections: a held workspace reader lock yields a real NOWAIT failure, a probe proves the earlier account lock was released, then reset succeeds and verifies rows plus sequence restart; a non-test DB URL guard proves the observer is not called; and a held lock through all attempts proves bounded failure preserves rows. The optional observer receives the underlying error only after transaction rollback and is used only for deterministic test observation. No product mutation or test-action retry was added. The test-local SQLSTATE helper returns the first encountered `code` property; the recorded exact-head PG run passed these real-driver assertions, which verifies the observed envelope used in that run.

The retained full-scope conclusions remain applicable: identity reach is kept in the changed task SQL, generic updates pin project ownership, move writes preserve task/assets within the scoped atomic statement and sorted-lock sequence, and the four INSERT…SELECT paths retain destination-column encoders. The inherited shared non-task legacy lock/query gap remains outside this slice. I found no new scope, result-classification, event, reset-isolation or error-masking blocker.

## Runtime attribution and limits

The exact-head focused run is operator-authored evidence, not a run I performed: 10 files, 165 tests passed, native exit 0, 51.892 seconds, CI absent. Its selected files cover the reset-lock cases plus prior task reach, label, mutation, move/archive and workspace-RBAC regressions. The associated result note is `query580-b9-09e3-focused-pg-result-luna.md`. The earlier `1d1527` 161/162 reset-deadlock failure and its limited attribution correction remain preserved; the newer `09e3` result does not rewrite them.

No blocker in this Ordinary A scope. A fresh GPT-6 Sol review of exact 09e3 remains required because the 7c full Sol review was blocked and these are substantive repairs. Exact-head CI, other applicable acceptance gates, and any full #580 work remain separate.


## Evidence file

`query580-b9-0e3-focused-pg-result-luna.md`

# Query 580 batch 9 focused PostgreSQL result for workspace-context consolidation

Candidate `0e3ac4c546978489e88eb8516f66e3beba039db6` on `codex/query-ownership-580-b9-current`, exact worktree `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`. Before activation, the prepared operator verified this exact SHA, clean worktree, and all five requested paths. It used the reviewed configuration-only operator copy whose SHA-256 is `65d6d67f7818b5ba8a48449602c537c6382df7a62faf04e49050d8c77dfc0dde`; source operator hash is `49d79dfe784eb257d5d59c3c5937543eb82567ff7e79e89a42c4ccaa84d8e901`. The only configuration changes selected this evidence directory, exact SHA, unique container name, and five focused test paths.

One canonical command ran with `CI` absent: `pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts` for `task-repository.test.ts`, `task.test.ts`, `authorization-boundaries.test.ts`, `workspace-rbac.test.ts`, and `task-update-concurrency.test.ts`. Native exit code 0; 5/5 files and 94/94 tests passed; not timed out; operator measured 27.527 seconds (Vitest reports 26.17 seconds). This directly exercises the added repository scope positive/foreign/revocation regression and the existing task/bulk/assignee paths included in this focused set.

The owned PostgreSQL 18 container was labeled for this exact task/revision, used tmpfs at `/var/lib/postgresql` verified through container `/proc/mounts`, had no persistent mounts, and exposed a dynamically allocated port bound only to `127.0.0.1`. Exact owned container `ffa1d902583e4cc8e029a599abf6558021f3e37d5c066bb79ee378b7d10bfa8c` stopped with cleanup exit 0. The ephemeral env file was removed. Docker inventory returned to baseline with no additions or missing objects: 23 containers, 109 volumes, 7 networks. The worktree remained clean at the exact candidate; no source edits occurred during execution.

Evidence directory: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-0e3ac4c5/`. Log SHA-256 values: `vitest.full.log` `63cd39340b9c29c7da7f8233fc587ac2788c476bb3458e303afe94e66cd189fa`; `postgres-container.log` `e101f9708869038207a9c66f1a56a3aca26b762b4cbfbae09037186a52adec68`. Prior c13 focused evidence remains separate; it covered the earlier 13-file/212-test set. This report covers only the authorized five-file changed-head window and is author/operator evidence, not an independent review. No build, browser, full suite, or CI was run.


## Evidence file

`query580-b9-0e3-full-ordinary-c-luna.md`

# Query ownership #580 batch 9b — full ordinary review C

- **Model / role:** GPT-6 Luna, independent ordinary reviewer C
- **Reviewed head:** `0e3ac4c546978489e88eb8516f66e3beba039db6`
- **Comparison base:** accepted `main` `f5d8f51c1d502b58af2e7b6b9cf01a6e01f7680e`
- **Checkout:** `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`, branch `codex/query-ownership-580-b9-current`; clean at review start.
- **Independence:** I did not author, direct, or remediate this candidate. This is a fresh review context.
- **Verdict:** CLEAR on the reviewed source by inspection. No blocking finding identified in the requested task feature scope.

## Scope checked

Read the repository guidance (`AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`), current planning/decision records, and the accepted query ownership, tenancy, layout, and security contracts. Inspected the complete 26-path diff against the stated base, with focused review of task identity acquisition, scoped repository predicates, executor/transaction use, insert encoders and defaults, bulk task operations, move locking and task/asset atomicity, event ordering, and the added repository/move integration oracles. Compared transaction-sensitive task paths with their pre-change implementations. Also inspected the current six-path delta from `a817ff91` to the reviewed head.

## Findings

No blocker found. The task list, export, task/assignee reads, labels, external links, task mutations, and asset lookups/writes apply resolved identity reach in the repository statement. The final workspace-context helper is now the existing identity-scoped `findProjectWorkspaceContext`; the duplicate unscoped project-to-workspace helper was removed, and bulk update and assignee callers pass the identity. The added positive/foreign/revoked workspace-context test corresponds to that boundary.

The move path locks the addressed task under identity reach, checks source liveness before examining the caller-selected destination, restricts destination discovery to the source workspace and current reach, takes source/destination project locks in sorted id order with the destination exclusive, and repeats source/destination reach checks in the write statement. Task relocation and asset project-id updates are composed in one data-modifying CTE statement, so a failed/missing guarded task update cannot leave assets moved independently. Existing post-commit event publication remains after successful transaction completion.

The SQL `INSERT ... SELECT` rewrites explicitly encode supplied values using their destination columns. They distinguish omitted defaults from explicit `null`; the focused new fixture assertions cover task defaults/nulls/supplied values and timestamp/event-data preservation for task activities and assets. No defect was found in those mappings by inspection.

## Non-blocking limits

- I did not run tests, builds, PostgreSQL, browser, Docker, or runtime checks, per assignment. The latest focused PostgreSQL run is reported as in progress elsewhere; this review does not treat it as passing.
- The checkout is a frozen source review only. No source changes, Git writes, push, PR, or merge were made.
- Existing shared utility calls such as `getProjectWorkspaceId` and the legacy task-row lock helper were not broadened into this delta review; they predate this candidate scope. This does not waive the remaining #580 structural/query-ownership work or the eventual checker.

## Inspection evidence

- `git rev-parse HEAD` matched the reviewed head; comparison base resolved to the stated accepted-main SHA.
- `git diff --stat base...HEAD`: 26 files, 3,594 insertions and 730 deletions.
- `git diff --check base...HEAD`: no whitespace errors.
- No tests or runtime commands were executed by this reviewer.


## Evidence file

`query580-b9-0e3-full-security-61-sol.md`

# Query ownership #580 batch 9 — full independent security review

**Model:** GPT-6.1 Sol
**Role/context:** Fresh independent full security reviewer, `/root/query580_b9_0e3_full_security_sol`.
**Reviewed head:** 0e3ac4c546978489e88eb8516f66e3beba039db6
**Comparison base:** f5d8f51c1d502b58af2e7b6b9cf01a6e01f7680e (assigned accepted main).
**Checkout:** `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`.
**Independence:** I did not author, direct, or remediate this candidate. I inspected the complete candidate rather than adopting the author's or ordinary reviewers' verdicts. No subagent was spawned.
**Verdict:** **BLOCKED — B1 must be fixed and verified before this candidate can receive security clearance.** This is neither a merge approval nor a stage/#580 completion claim.

## Scope actually inspected

I read the checkout's AGENTS.md, active mission, agent workflow, provider adapter, coding standards and query-ownership contract, current planning/decision records, work-items feature contract (including WI-6, WI-7a and WI-25), query-scoping/security contracts, and applicable CI security-review path list. I inspected the complete 26-path base-to-head change: 21 production paths and five test paths, 3,594 insertions and 730 deletions.

Production scope: `apps/api/src/task/repository.ts` in full; `assert-task-project-live.ts`; `index.ts`; `validate-task-fields.ts`; and all changed task controllers: bulk-update-tasks, claim-task-numbers, create-task, delete-task, export-tasks, get-task, get-tasks, import-tasks, move-task, require-task-permission, update-task-assignee, update-task-description, update-task-due-date, update-task-priority, update-task-status, update-task-title and update-task. I followed relevant unchanged seams through resolveCallerIdentity, identity-scope.repository, Executor/database setup, assignable-user helpers, schema columns/defaults, activity subscribers and event publication. I compared the prior move implementation and the c13-to-current workspace-context delta.

Test scope: full new `tests/api-integration/task-repository.test.ts` and `task-repository-moves.test.ts`; all changes to `project-archive-freeze-legacy.test.ts`, `task-title-activity.test.ts` and `tests/api/task/bulk-update-tasks.test.ts`; the existing title/activity atomicity assertions and forced move revocation barrier. This is source inspection, not execution.

I read the authentic Ordinary A/B c13 full reports, Ordinary B current-head delta, and fresh Ordinary C current-head full report; atomic-move repair, b628 adverse run, a817 adverse run plus hash erratum, codec/fixture repair, c13 focused result, workspace-context consolidation and current-head focused result. I separately inspected the candidate-check, native result JSON, native log summary/hash, cleanup receipt and inventory delta in both the c13 and current-head runtime evidence directories.

## B1 — blocking, P2: a scoped zero-row write can commit partial effects or publish a mutation that did not happen

The new current-reach predicates legitimately make a repository write return no rows when a persisted grant is revoked between statements. Several callers still assume that an awaited statement either writes its row or throws. A normal zero-row result now breaks their transaction/effect invariants. Task/project row locks do not lock the membership rows used by currentProjectReachPredicate; the controller transactions do not request repeatable-read isolation. These are concrete inter-statement windows, not a claim that a statement must see revocation committed after its own snapshot started.

### Title and activity can separate

At `apps/api/src/task/controllers/update-task-title.ts:28`, the scoped title UPDATE succeeds and returns the changed task. At line 36 the controller then awaits `insertTaskActivity`, before returning normally from its transaction at line 44. In `apps/api/src/task/repository.ts:792-799`, the activity INSERT SELECT independently checks current task-project reach, but its affected rows are neither returned nor checked.

Interleaving: authorize and update the title while the project grant exists; commit removal of that grant on another connection after the UPDATE statement's snapshot and before the activity statement begins; the activity SELECT now returns zero rows; the INSERT resolves successfully; the controller commits the title/version and later publishes task.title_changed. No title_changed activity was persisted. The prior VALUES insert could not silently disappear for this reason. There is no task.title_changed activity subscriber fallback: the title route is deliberately the synchronous writer. This violates WI-6 and the existing test's explicit title/activity atomicity behavior. The test for an actual FK insert failure does not exercise a successful zero-row INSERT SELECT.

Required result: ensure the required activity insert produces a row, and reject inside the same transaction if it does not, or compose the dependent writes under a suitable common statement authorization snapshot. Preserve identity scope; do not introduce a blanket trusted/internal-producer exemption. Add a real persisted-grant revocation interleaving showing either title plus activity commit together or the title/version roll back, with no postcommit title event on failure.

### Due-date failure can leave reminders deleted

At `apps/api/src/task/controllers/update-task-due-date.ts:30`, clearTaskReminders performs its scoped DELETE. The next scoped task UPDATE can return undefined if the grant disappears before that statement starts. The transaction still returns normally at line 34. The missing-task check is at lines 38-41, after commit, so it cannot roll back the reminder deletion.

Interleaving: the reminder DELETE succeeds while the grant exists; revoke the grant before the task UPDATE starts; the task keeps its old due date/version, but the request's transaction commits deletion of its sent-reminder records and then reports 500. This can cause reminders for an unchanged due date to be sent again. Move the required task-update success check inside the transaction (or make the operation atomic), and verify failed scope leaves both task and reminder rows unchanged. Checking every SQL predicate alone does not establish operation atomicity.

### Bulk refused updates emit false postcommit effects

In `apps/api/src/task/controllers/bulk-update-tasks.ts`, status (lines 271-289), priority (294-311), assignee (the corresponding update/event branch), and due-date (430-449) all queue a mutation event even if updateTaskRowReturningId returned undefined. Each returns zero, but after the transaction the queued events publish at line 488 and the result reports success:true at line 500. Status also publishes task-relation.refresh at lines 489-498.

Interleaving: pass the scoped task lock/workspace lookup while the grant exists; revoke it before the UPDATE statement starts; the UPDATE correctly affects no row; nevertheless, publish task.priority_changed/status_changed/assignee_changed/unassigned/due_date_changed for a change that never happened. Existing activity subscribers can persist those false events as activity, and other subscribers can act on them. This is a failure of postcommit mutation attribution, rather than a cross-tenant SQL write bypass.

Required result: distinguish a required update refused by scope from a valid idempotent no-op; reject the refused item before queueing effects and preserve WI-25 per-item outcomes. Add a persisted-revocation regression for all four update operations proving unchanged task/version, no mutation event or downstream history, and a failed item outcome when the write is refused. Do not globally turn every zero-row result into an error: label ON CONFLICT and already-present labels intentionally permit idempotent no-ops.

These manifestations share one new failure class: required statement results must be consumed before committing dependent state and before attributing mutation events. Fix that class across this slice rather than only adding a special case to the title controller.

## Other producer return handling checked

- `insertTask` returns its row. Create checks !createdTask after its transaction; import explicitly branches on createdTask after its transaction, reporting a failed item when no task returned. Neither emits task.created for a missing inserted row. The preceding number claim can have committed before a late insert scope miss; that consumes a number, but I have not classified number gaps as a blocker because this review found no contract requiring contiguous numbers, and numbers must never be reused. An in-transaction success guard would give cleaner rollback behavior.
- `insertAsset` and updateAssetById return the asset ID. Finalization explicitly checks !asset at index.ts:1086 and throws Failed to save asset; the transaction contains no preceding asset mutation needing rollback in this miss path. I found no asset-success event on that path.
- Task-label insertion returns an inserted ID or undefined for ON CONFLICT. The add-label branch queues effects only when inserted is present. The delete-label and delete-task bulk branches likewise guard their mutation events on returned rows. Existing label idempotency must be preserved while repairing B1.
- The only production caller of the new insertTaskActivity is updateTaskTitle. Direct additional uses are integration tests. No other production insertTaskActivity caller hides a different mandatory-write outcome.

## Security properties that passed source inspection

Request identity is resolved via resolveCallerIdentity, preserving session, API-key owner/stored-scope context and impersonation credential type; changed handlers pass it through the controller/repository boundary. Existing route capability middleware remains in place, including the API-key ceiling/deferred legacy-capability layering. SQL reach does not replace those capability gates. The new statement predicates correlate addressed tasks, labels, external links, relations, reminders and assets to the identity-reachable task/project, and project-specific selectors include persisted current reach. The repaired workspace-context helper takes identity at both updated callers; its own positive/foreign/revoked integration oracle exercises the removed bare-ID lookup defect.

The move task UPDATE requires task ID and current source project, current reach to both source and destination, matching workspace, live/unarchived projects, and no pre-existing linked asset in a different project. The dependent asset UPDATE consumes the moved-task RETURNING row and affects only that task's source-project assets. Both writes are in one data-modifying CTE statement. I found no remaining split-snapshot task/asset relocation defect. Generic task update methods pin projectId and cannot be used to perform a move through their values object. Destination-number failure/move-result failure throws inside the move transaction, and task.moved remains after transaction success. The controller locks the task before preflight, then takes sorted project locks with an exclusive destination lock; it no longer takes the premature source share lock that caused the b628 adverse run. Existing error ordering for source freeze, malformed/same/foreign destination is conserved.

All four INSERT SELECT shapes were compared with target schema fields: task, activity, asset and task-label. Supplied parameters use sql.param(value, targetColumn), including timestamp and JSONB fields; task/project/workspace relationship columns derive from scoped source rows where applicable. Defaults and explicit null are distinct for nullable task position/number, and optional timestamp/default choices remain explicit. I found no additional codec, field-order, or source-conservation blocker by inspection.

## Inherited and non-blocking residuals

The shared NON-task legacy lock helpers remain an existing query-ownership/scoping gap. A corrected read-only source comparison confirmed all five existing functions in assert-task-project-live.ts are byte-equivalent to the base: lockLegacyTaskRowIfPresent, lockLegacyTaskRow, lockTaskAndAssertProjectLive, lockProjectsAndAssertLive and lockProjectAndAssertLiveForTaskNumber. This review does not grant their non-task callers a new exemption or claim the rest of #580 is converted. The new identity-aware task paths do not fall back to the unscoped legacy task lock.

The newly introduced repository still contains unused unscoped lockLiveProjectRow at lines 189-205; searches found no production or test caller of that actual export (tests alias lockLiveProjectRowForIdentity locally). It should be removed or scoped before use. I did not classify an unused export returning only the addressed project ID as a demonstrated current route vulnerability. findWorkspaceMembershipId is used as the existing actor/workspace membership gate; its production caller supplies the authenticated user ID. This observation is not a blanket exemption for unscoped producers or future repository reuse. Shared unchanged helpers such as assignable-user and storage cleanup still require their owning #580 work.

I did not identify a separate current route cross-tenant disclosure/write, SQL injection, capability expansion, key-scope erasure, or move-lock regression beyond B1 in the reviewed change. That statement does not clear B1 or establish runtime acceptance.

## Checks actually performed and evidence limits

I ran only read-only Git/source/evidence inspection commands: exact HEAD/status, base-to-head and c13-to-head diffs/stat/numstat, git diff --check (clean), repository/caller searches and reads, schema/contract comparisons, and a local read-only Python comparison/hash/JSON inspection. HEAD was 0e3ac4c546978489e88eb8516f66e3beba039db6 and the checkout was clean at both start and final recheck. No source/Git writes, checkout changes, package installs, tests, PostgreSQL, Docker, image/build, browser or CI execution were performed. B1 is a static control-flow/concurrency finding; I did not execute its proposed interleavings.

The c13 runtime receipts/native summary report native exit 0, 13/13 files and 212/212 tests, 57.545 seconds, CI absent; its Vitest log SHA-256 matches 93ad125b7669d84020b9556cfc9e055c8e652ef57903efb49ba6568c15e89aa5. Current 0e3 receipts/native summary report native exit 0, 5/5 files and 94/94 tests, 27.527 seconds, CI absent; current log hash matches 63cd39340b9c29c7da7f8233fc587ac2788c476bb3458e303afe94e66cd189fa. Both cleanup receipts report exact-ID successful stop and before/after inventories of 23 containers, 109 volumes and 7 networks with no added/missing IDs. These are inspected author/operator results, not my independent reproduction. The prior b628 interrupted lock-cycle result and a817 9/13 files, 207/212 tests adverse result remain adverse history, with the a817 source-hash erratum preserved.

The focused passing tests do not cover the B1 grant-revocation windows. No full-suite, exact-head hosted check, image boot, browser, SIT, merge readiness, stage completion or whole-580 closure is asserted. Candidate remains blocked on B1 and then the applicable fresh exact-head review/test gates.


## Evidence file

`query580-b9-0e3-ordinary-b-delta-luna.md`

# Query 580 batch 9 — Ordinary B delta review

- **Reviewer/model:** GPT-6 Luna, independent Ordinary B context; bounded follow-up to the prior review.
- **Reviewed head:** `0e3ac4c546978489e88eb8516f66e3beba039db6`
- **Comparison base:** `c13e5149c7ad9b529bf644347fa30834cf7c47f2`
- **Worktree:** `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`, exact head and clean.
- **Scope checked:** the four-file delta, author workspace-context consolidation report, focused PostgreSQL result for the five-file window, implementation and uses of `findProjectWorkspaceContext`, new direct integration regression, and the two adapted controller call sites. This is a bounded disposition of the prior `findProjectWorkspaceId` blocker; the unchanged c13 source received no new full review.

## Verdict: CLEAR for this delta; prior finding closed

The repair removes `findProjectWorkspaceId`, whose query had relied on a bare project ID, and reuses `findProjectWorkspaceContext(executor, identity, projectId)` in both bulk update and assignee update. The existing helper joins the workspace row and constrains the project in SQL using `currentProjectReachPredicate`. Both callers pass their resolved identity. Their established behavior remains intact: bulk still returns 404 when the project context is missing or outside its workspace; assignee update still returns 404 when context is absent before checking the target user's membership.

The new integration test checks an actor's own reachable project, a populated project in a different workspace hidden from that actor, the foreign actor's positive access to that project, and loss of the original actor's result after the persisted project membership is revoked. This directly exercises the formerly absent repository boundary. I found no residual instance of the removed helper or an equivalent bare project-to-workspace query in the reviewed delta.

## Checks

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/task/bulk-update-tasks.test.ts` — PASS, 1 file / 2 tests. Native log saved mode 0600 at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-0e3-unit-ordinary-b-243881771662.log`.
- Reviewed author/operator report `query580-b9-0e3-focused-pg-result-luna.md`: reports exact-head PostgreSQL execution of five files, 94/94 tests, with cleanup back to the recorded baseline. This is author/operator evidence, not my independent reproduction.
- No PostgreSQL, integration, build, browser, Docker, or CI command run by this reviewer. No edits.

## Limits

This clears only the bounded delta and closes the specific blocker recorded in my c13 report. It does not replace the other ordinary reviews or required full GPT-6 Sol security review, and it does not claim #580 or stage completion. The earlier c13 report remains the authentic historical BLOCKED verdict for its exact head; this delta provides its disposition on the successor head.


## Evidence file

`query580-b9-1d15-deadlock-attribution-luna.md`

# Query #580 batch 9 — 1d1527bf deadlock attribution (read-only author addendum)

- Candidate inspected: `1d1527bf90f3951a1cdbe9100fc062eaee607b02` (worktree clean at inspection).
- Original runtime report preserved unchanged: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-1d15-focused-pg-result-luna.md`.
- Raw PostgreSQL log: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-1d1527bf/postgres-container.log`.
- Raw Vitest log: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-1d1527bf/vitest.full.log`.
- No tests, PG, runtime, source edits, or new harness were run/created for this diagnosis.

## Correction to the prior author report

The earlier report described the deadlock as arising during concurrent test-file resets. That attribution is wrong: [`vitest.integration.config.ts`](file:///Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2/apps/api/vitest.integration.config.ts) sets `fileParallelism: false`, `maxWorkers: 1`, and `minWorkers: 1`. The log does not support two file resets running concurrently.

The native PostgreSQL deadlock record at `2026-10-16 18:22:38.801 UTC` states:

- Process 104 was executing the full-schema `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` from `resetTestDatabase`, reached from `tests/api-integration/workspace-rbac.test.ts:97` (`beforeEach`). It waited for an `AccessExclusiveLock` on relation OID 16463, blocked by process 87.
- Process 87 was executing a SELECT whose logged prefix is `select "task"."id" from "task" inner join "project" on "task"."project_id" = "project"."id" where ("task"."id" = $1 and "project"."deleted_at" is null and ((exists (select "user"."id" ...`. It waited for `AccessShareLock` on relation OID 16438, blocked by process 104.
- The server log provides those two relation OIDs but no relation-name mapping. This inspection did not query `pg_class` while the database was live; the ephemeral container is already cleaned up, so the OIDs are not mapped here.

Thus the established failure is a real lock cycle between the reset TRUNCATE and a task/project reach SELECT. The prior 8-file/161-pass plus 1-file/1-failure outcome remains adverse; nothing here changes that result.

## Source-shape comparison and causal limits

The logged SELECT shape matches [`userCanReachTask`](file:///Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2/apps/api/src/notification/task-reach.repository.ts) at lines 334–350 substantially more closely than the new task-label CTEs. In particular, it selects only `task.id`, joins task to project, filters `project.deleted_at IS NULL`, and applies a `userId`-based `projectReachPredicate` with instance-admin and membership branches. The new task repository helpers use `ResolvedIdentity`-based `taskProjectReach` and add task-label workspace criteria, which are absent from the logged prefix. `userCanReachTask` has callers in `apps/api/src/notification/controllers/create-notification.ts` and `apps/api/src/notification-preferences/delivery.ts`.

A plausible path to such a query crossing the next reset exists: `apps/api/src/notification/index.ts` subscribes to `task.created`; its async callback calls `createNotification`; `createNotification` awaits `userCanReachTask`. `publishEvent` calls `EventEmitter.emit` and returns without awaiting async listener promises. The listener callback is therefore able to continue after the task-creation request returns. `createNotification` can also start `deliverNotification` with `void`, and delivery has additional `userCanReachTask` checks. The API-integration `workspace-rbac.test.ts` does create tasks through the API in earlier tests, and its `beforeEach` globally truncates the DB.

This is a concrete candidate source path, not proof that PID 87 came from that callback or from a particular test. The deadlock statement omits parameters and does not identify the initiating caller/route. The nearby PostgreSQL log also records a failed notification insert at `18:22:33.863` (missing `notification.user_id` FK) on PID 89; that confirms notification work occurred, but does not associate PID 87 with that same event, listener, or task. The available receipts do not tie PID 87 to a test file or task ID. I cannot safely attribute the blocker to the new B2 source or to any specific existing test from these records alone.

## Cleanup/drain evidence and unresolved point

The inspected event bus exposes `shutdownEventBus()`, which only calls `EVENTS.removeAllListeners()`; it neither waits for in-flight handler promises nor cancels them. `subscribeToEvent()` wraps async handlers but does not register their promises for draining. The integration reset helper performs a schema-wide truncate and does not wait for event handlers. No existing drain or event-handler cleanup mechanism was found in the inspected code paths.

The runtime did have `fileParallelism: false`; that removes concurrent test-file execution as an explanation, but does not establish whether a prior async event callback was still running during a later `beforeEach`. A narrow synchronization repair cannot yet be selected responsibly without identifying whether PID 87 was a `task.created` notification callback, notification delivery, a direct notification API call, or another caller of `userCanReachTask`, and without identifying which relation OIDs were involved. No source fix or rerun is recommended from this evidence alone.

The B2 additions in `task-title-activity.test.ts` comprise three persisted-revocation cases (delete present, add missing, remove present) and one idempotency case (add existing/conflict and remove absent). The whole file was among the eight passing files in the captured run; the available log does not provide individual passing-test output, so this report makes no separate assertion about per-case database traces.

## Evidence hashes and limits

- Vitest log SHA256: `85739f71812092ca7b137756b3c050431f95c4efb254f994c597497f4000de99`.
- PostgreSQL log SHA256: `4e476100c982f224a9d53b3b71433ae7cefa92601e5816727880b7e4d3110d09`.
- The runtime report, logs, and cleanup receipts remain preserved. No runtime replay was made.


## Evidence file

`query580-b9-1d15-focused-pg-result-luna.md`

# Query #580 batch 9 — focused PG result (author/operator report)

- Candidate: `1d1527bf90f3951a1cdbe9100fc062eaee607b02`
- Worktree: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Pre-run git state: exact SHA matched; worktree clean.
- Operator: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-1d1527bf/run-focused-tests.py`
- Operator SHA256: `d7f0e0649ad2d01247058a30fa44067ad4be0e3e82b9c8968e62b83b965a3825`
- Operator was root-prepared configuration-only copy of `query580-b9-runtime-7b9ea329/run-focused-tests.py` (source SHA256 `178c0153f401d50e83b85dfb98ed76bd2eca5ce4830728121f641d69d230ac05`). Configuration diff changed only evidence directory, candidate SHA/container name, and selected paths from six to nine, adding current task-target reach, workspace RBAC, label detach, and label bulk rename race files.
- Invocation: `python3 /Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-1d1527bf/run-focused-tests.py` (one invocation only).
- Canonical test argv is recorded in `vitest-invocation.txt`; CI removed from child environment, no TZ override, timeout 600 seconds.

## Result

The focused Vitest invocation exited **1** after 49.773 seconds (started `2026-10-16T18:22:24.127350+00:00`, ended `2026-10-16T18:23:13.900667+00:00`). Actual summary: **8 test files passed, 1 failed; 161 tests passed, 1 failed (162 total)**.

The sole failure was `tests/api-integration/workspace-rbac.test.ts > API integration: workspace RBAC enforcement > resource coverage: project:create / update / delete > allows a member to create a project`. The captured stack shows `resetTestDatabase` at `tests/api-integration/helpers/database.ts:128-132` failing its full-schema `TRUNCATE` with PostgreSQL `40P01 deadlock detected`. PostgreSQL reported a circular wait: process 104 waited for `AccessExclusiveLock` on relation 16463, blocked by process 87; process 87 waited for `AccessShareLock` on relation 16438, blocked by process 104. The error occurred during concurrent test-file database reset. This report does not infer or claim a product-code cause from that environmental/inter-file deadlock. No test rerun or source edit was made after the failure.

The complete raw Vitest output is retained at `vitest.full.log` (SHA256 `85739f71812092ca7b137756b3c050431f95c4efb254f994c597497f4000de99`). PostgreSQL container output is retained at `postgres-container.log` (SHA256 `4e476100c982f224a9d53b3b71433ae7cefa92601e5816727880b7e4d3110d09`). Logs include application test output and the native PostgreSQL deadlock error; all raw output was retained.

## Runtime and cleanup

- PostgreSQL image: `postgres:18-alpine`; database `taskdesk_test`.
- Exact owned container ID: `6357b29e167cec4d0ff75c7f3443db318f1527fbeba4f0927484d50a8f96f065`; name `query580-b9-1d1527bf-pg`; labels bound to this task and SHA.
- Storage: `/var/lib/postgresql` configured as tmpfs `size=1g`, no mounts; in-container `/proc/mounts` explicitly proved exact tmpfs mountpoint.
- Network binding: dynamically allocated host port `127.0.0.1:32811` only.
- Native `pg_isready`: accepted after 2 attempts.
- Exact-ID cleanup return code 0; no other container was targeted.
- Docker inventory baseline and final were identical: **23 containers, 109 volumes, 7 networks**; additions/removals all empty.
- Ephemeral `test.env` was removed; no credentials are included in this report.
- Evidence dir: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-1d1527bf/` (raw receipts/logs remain there).

This was the one root-authorized focused runtime window. It is a failing runtime result, not a pass. No additional tests, builds, browser checks, or source edits were performed. Preserve this adverse result for root review; any further run requires a new explicit authorization.


## Evidence file

`query580-b9-77fd-ordinary-a-luna.md`

# Ordinary A static review — #580 b9 candidate

- **Reviewer/model:** GPT-6 Luna (independent fresh context; static review)
- **Reviewed head:** `77fd4013546c6efba938ddb40be8b9296455b466`
- **Comparison base:** `f5d8f51c1d502b58af2e7b6b9cf01a6e01f7680e` (merge base)
- **Scope:** actual 26-path candidate diff: 21 task production paths and 5 tests. Read repository operating instructions and query-ownership contract; inspected the repository, changed controllers and associated integration tests. No tests, build, runtime, PostgreSQL, push, or edits were performed. This report is not runtime evidence or approval.
- **Verdict:** **BLOCKED for focused PostgreSQL acceptance pending one query-scope correction and regression coverage.**

## Blocking finding — destination project ID is checked outside, but not scoped by, the move writes

The accepted tenant-scoping contract says a repository query applying reach must do so in the statement predicate; any additional project ID must also be checked against identity and appear in that predicate (`docs/04-engineering/coding-standards.md:157-162`; corroborated by `docs/01-architecture/security-model.md:110-122`). The actual review target claims repository ownership and explicitly keeps those predicates required.

`moveTask` does meaningful destination validation before writing: it checks the destination in the source workspace with identity reach, obtains sorted source/destination project locks, and later rechecks destination membership (`apps/api/src/task/controllers/move-task.ts:182-215`). This closes ordinary foreign-workspace and missing-project paths, and the destination project row lock helps serialize project liveness changes. It does not make the two subsequent statements satisfy the repository contract:

- `updateTaskRow` accepts arbitrary task insert fields and sets `projectId` from the supplied values, while its `WHERE` applies only `taskProjectReach` to the task's current/source `projectId` (`apps/api/src/task/repository.ts:655-665`). The move call supplies the request's destination at `move-task.ts:217-223`. No destination ID/reach predicate is part of this UPDATE. Thus the task write's authorization for the source row is not a statement-level authorization of the destination assignment.
- `reassignTaskAssetsToProject` similarly sets its independent `projectId` argument, while its predicate proves reach to the task's current project only (`repository.ts:1354-1378`); the move controller calls it with the destination at `move-task.ts:231-236`. It does not assert in this statement that the argument equals the task's current `projectId` or that the destination is reachable and in the same workspace.

This is more than an abstract API concern: project-scoped memberships can differ between two projects in the same workspace. If the destination membership is revoked after preflight/lock/check and before the task UPDATE, the UPDATE's source-project reach predicate can still pass while destination reach has ceased; the task can be moved into a project the identity no longer reaches. A later asset UPDATE may then affect zero rows (because it tests reach to the now-destination task), leaving task and asset `projectId`s divergent while the transaction still commits. Separately, an accidental future call passing a mismatched `projectId` to the asset helper can create that divergence without any equality guard. Project row locks do not lock project membership rows. The move transaction should make the identity-checked destination and same-workspace invariant part of each mutation statement (or use a repository operation that atomically joins/exists against the live reachable destination and enforces the task/asset relationship); retain the existing preflight/lock flow for its error behavior and lock ordering. Add a database regression that proves a destination without current reach cannot be assigned at the statement boundary, plus a task/asset destination-consistency case.

`updateTaskRowReturningId` has the same generic `Partial<$inferInsert>` signature and allows `projectId` in `.set`, with only current task-project reach in `WHERE` (`repository.ts:942-953`). Its current four callers are bulk status/priority/assignee/due-date operations and do not pass `projectId`, so I found no current endpoint exploit through that wrapper. It remains an unsafe mutation seam: prevent project changes there or enforce the destination scope if a caller is ever added.

## Static review notes

The changed insert-select helpers appear to derive inserted project/workspace/task relationships from scoped source rows; the repaired task INSERT SELECT explicitly accounts for all task columns and omitted defaults/nulls, and the integration suite includes checks for those cases. The move flow preserves task-first locking, ordered project locking, transaction grouping, destination task-number claim and position calculation; the task update and asset reassignment are in the same transaction, and move event publication occurs after commit. Bulk writes retain per-item transactions and defer events until successful operations. New tests exercise repository result scoping, cross-identity update/delete behavior, move locking, and asset movement. The asset movement test verifies a successful same-identity move but does not test mismatched/unreachable destination enforcement. No test outcome is claimed because this was a static-only review.

I did not elevate the inherited shared `lockLegacyTaskRowIfPresent` unscoped lock to a finding; preserve the known pre-existing #580 gap as directed. I found no additional blocking structural issue in the inspected changed mutation seams. This verdict is only an ordinary static review and cannot stand in for the focused PostgreSQL exercise or other required review gates.


## Evidence file

`query580-b9-7b9-focused-pg-result-luna.md`

# Query 580 batch 9 focused PostgreSQL result for required-result atomicity repair

Candidate `7b9ea329f9680ca353163b18aafa9d07a946262f`, branch `codex/query-ownership-580-b9-current`, exact worktree `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`. Prepared operator verified this exact SHA, clean status, and six selected existing integration files before activation. Source operator SHA-256: `65d6d67f7818b5ba8a48449602c537c6382df7a62faf04e49050d8c77dfc0dde`. Prepared execution operator SHA-256: `178c0153f401d50e83b85dfb98ed76bd2eca5ce4830728121f641d69d230ac05`. Preparation metadata records `configOnly: true`; the config diff changes only evidence directory, candidate SHA, unique container name, and the six-file selection.

One authorized canonical integration command ran with `CI` absent and no TZ override: `pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts` for `task-title-activity.test.ts`, `task-repository.test.ts`, `task-repository-moves.test.ts`, `task-update-concurrency.test.ts`, `work-item-bulk.test.ts`, and `project-archive-freeze-legacy.test.ts`. Native exit code 0, not timed out: 6/6 files and 62/62 tests passed. Operator measured 24.916 seconds; Vitest reported 23.52 seconds. The revocation-barrier cases in task-title-activity.test.ts completed as part of that native result. There were no `Repository barrier timeout` or `No PostgreSQL session blocked` errors in the retained Vitest output. The log includes existing `realtime.failure` structured records during other test actions; they are preserved in the raw output, and the native suite still exited 0 with all expected counts.

Owned PostgreSQL 18 container ID `ac9c1664151d026d147c056f9685e912bc82bab3d4bca49ca28169523de6eb02`, with task/revision labels for this exact candidate, used tmpfs at `/var/lib/postgresql` verified from container `/proc/mounts`, no persistent mounts, and a dynamically allocated port bound only to `127.0.0.1`. Cleanup stopped the exact container with exit 0. The ephemeral test env file was removed. Inventory returned to baseline without added or missing objects: 23 containers, 109 volumes, 7 networks. Worktree remained clean at exact candidate; no source changes occurred during the run. Host timezone was `+0630` (Asia/Yangon); no timezone override was set.

Evidence directory: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-7b9ea329/`. SHA-256: `vitest.full.log` `5f079413268bb1c7215ce64d64eccd0b826bd43016d3b7b8c490820fd965cbd1`; `postgres-container.log` `56f473e5aeb4207f19f80bcd2b9ab7c22d424af81e2751344c3038dee6b1f34c`. This is the one authorized focused runtime window only. No build, browser, full suite, or CI was run; this author/operator result is not an independent review or #580 completion claim.


## Evidence file

`query580-b9-7c-full-security-61-sol.md`

# Query ownership #580 batch 9 — fresh full security review

**Model:** GPT-6.1 Sol
**Model provenance:** Explicitly requested `gpt-6.1-sol` for this context. A served model/version fingerprint is unavailable to this reviewer; the requested name is not independent verification of a served fingerprint.
**Role/context:** Fresh independent FULL security reviewer, `/root/query580_b9_7c_full_security_sol`.
**Reviewed head:** 7c461e2bdedf18cc96860cd77eb28927e8ce883e
**Comparison base:** 33995c2af23da197f2fd9d5690717f7aeb4e9f67 (assigned protected main).
**Checkout:** `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`.
**Independence:** I did not author, direct, or remediate this candidate. I inspected the complete candidate and actual relevant callers rather than adopting the packet's verdicts. No subagent was spawned.
**Verdict:** **BLOCKED — B2 below remains in the required-result class.** The specific title/reminder/four-update B1 manifestations from the prior 0e3 security report are closed by inspection and meaningful focused evidence. This is not merge approval, runtime acceptance, a phase finalizer, or whole-#580 clearance.

## B2 — blocking, P2: scope-refused bulk deletion and label changes still report successful items

At `apps/api/src/task/controllers/bulk-update-tasks.ts:367-379`, bulk deletion returns zero normally when `deleteTaskReturningId` returns undefined. After the transaction, line 512 unconditionally adds `{ taskId, success: true }`. The new repository DELETE independently checks current persisted task-project reach. A task/project lock does not lock the membership rows in that predicate.

Concrete interleaving under the existing per-statement snapshots:

1. The initial scoped task lookup, per-item task lock, and identity-scoped project-context lookup succeed while the actor has a project grant. `taskInScope` is set true.
2. A second connection deletes and commits that persisted project grant before the DELETE statement starts.
3. The real identity-scoped DELETE selects zero rows and returns undefined. The item transaction commits normally, and the response reports success with updatedCount zero even though the task still exists.

There is no false task.deleted event here: it is correctly guarded by `deleted`. The defect is the false successful outcome for a refused deletion, contrary to WI-25's per-item success/failure contract. It is not a cross-tenant write bypass. The base's ID-only DELETE, following the retained exclusive task lock, did not have this new grant-refusal zero-row case. The current single-delete controller correctly turns the analogous missing result into failure; bulk does not.

The label branches retain the same ambiguity, so treating every zero-row result as a valid idempotent no-op is insufficient:

- `addLabel` at lines 382-412: start with a reachable task that lacks the label. Revoke reach after the positive scoped context/label-resolution reads and before its current task-label read or INSERT SELECT. Those real statements return no row, the desired label remains absent, and the branch returns zero followed by success:true. This is different from the intentional already-present/ON CONFLICT outcome, where the requested label is actually present.
- `removeLabel` at lines 415-435: start with the label present. Revoke reach before the scoped DELETE. The label remains present, but the branch returns zero followed by success:true. This is different from an already-absent label satisfying the requested postcondition.

Required result: distinguish scope refusal from a successfully achieved idempotent postcondition before reporting item success. For deletion, a missing required delete result after the retained positive task lock must fail the item. For labels, preserve genuine already-present/already-absent and ON CONFLICT no-ops while ensuring an authorization miss cannot masquerade as one. Keep the current SQL identity predicates and event guards. Add persisted-revocation regressions for deletion, adding a missing label and removing a present label; assert the failed item, unchanged data/version and no event, alongside positive idempotency assertions. A precomputed reach decision or removal of statement scoping is not a repair.

This is a remaining instance of required-result classification, not a request for an unrelated redesign or another comfort review round. The existing new four-operation bulk regression matrix omits delete/addLabel/removeLabel, so the 62-test pass does not disprove these interleavings. I did not execute them in this read-only assignment.

## Prior B1 disposition

The `7b9` repair, preserved byte-for-byte in the candidate paths at 7c, closes the prior 0e3 report's concrete title, reminder and four bulk-update manifestations:

- `insertTaskActivity` returns its INSERT SELECT RETURNING id row. `updateTaskTitle` requires that row inside the transaction. A scope miss after title UPDATE throws before commit, rolls back title/version, and prevents task.title_changed publication.
- `updateTaskDueDate` checks the scoped task UPDATE result inside the same transaction as reminder clearing. A missing update rolls back the earlier reminder DELETE and cannot publish a due-date event.
- Bulk status, priority, assignee and due-date branches require their update result before queueing events or returning item success. A refusal throws the established opaque 404 inside the transaction; the catch records a failed item. Relation refresh is after successful item commit.
- The unused newly introduced unscoped `lockLiveProjectRow` export is removed. The identity-scoped variant remains.

The tests use actual PostgreSQL AFTER UPDATE and BEFORE DELETE trigger barriers for title/reminders. They verify persisted grant removal before releasing the operation and assert rollback, version, activities and event absence. Bulk wrappers await the actual scoped repository lookup and preserve its genuine result before pausing; they do not fake a refused write or fake successful SQL. The four actual updates run after persisted grant deletion. These are meaningful regression oracles for the cases they cover.

## Full scope actually inspected

Read repository AGENTS.md, active mission, workflow, provider adapter, current status/decision records, query ownership and executor rules, coding standards, tenancy/security contracts, work-items WI-6/WI-7a/WI-25 and applicable security-review paths. The initially attempted standalone `docs/04-engineering/query-ownership.md` does not exist; the actual authoritative Query ownership section is in coding-standards.md and was read.

Inspected all 26 changed paths against the assigned base (21 production, five tests; 4,036 insertions and 741 deletions): full task repository; task route/index and both update adapters; assert-task-project-live; validate-task-fields; all 17 changed controllers (bulk, claim numbers, create, delete, export, get one/list, import, move, permission requirement, six narrow updates and full update); complete new repository/move tests; all changes to archive-freeze, title/activity and bulk unit tests. Followed unchanged relevant seams through resolveCallerIdentity/resolveIdentity, current identity-scope predicates, callerReach, key-scope/permission gates, assignable-user helpers, Executor, schema/defaults and event/activity subscribers. Compared transaction-sensitive controller changes with the base and inspected the 0e3-to-7b9 repair.

Read authentic c13 Ordinary A/B, 0e3 Ordinary B delta/C full, current 7c Ordinary A, prior 0e3 full security BLOCKED report, contract map, repair reports, focused runtime reports, the b628 interrupted adverse result, a817 failed result and its hash erratum. Existing adverse verdicts remain authentic history; this report does not rewrite them.

## Other full-scope security conclusions

Request identity comes from the existing resolveCallerIdentity seam, retaining API-key owner binding, enabled status, stored capability subset and impersonation/session credential type. Changed handlers pass this identity through controllers to repositories. Existing route capability/owner ceilings and the downstream legacy API-key scope gates remain; reach is not substituted for authority. No route/policy or new capability is introduced.

Task content reads/writes and task-derived label, external-link, relation, reminder, activity and asset statements carry current SQL reach correlated to the addressed task/project. Project selectors, workspace context and lock queries have identity predicates. The removed bare-ID project-to-workspace helper has no remaining production export/caller. The direct positive/foreign/revoked context test checks that boundary.

Generic task update methods pin the current project and exclude projectId from their input type. The dedicated move method checks the exact task/source project, current source and destination reach, both projects live/unarchived and in one workspace, and rejects linked assets in a different source project. Its dependent asset UPDATE consumes the moved-task RETURNING row in one data-modifying CTE statement, preserving one authorization snapshot and excluding unrelated assets. The controller takes the task lock first and sorted source/destination project locks, with destination exclusive. It no longer takes the premature source share lock implicated in b628. A missing move or number claim throws inside the transaction; task.moved is after commit. Source-freeze/error ordering is retained. I found no additional task/asset split-move or lock-order blocker by inspection.

All four INSERT SELECT producers were checked against actual target schema fields: task, activity, asset and task-label. Supplied values use their destination-column sql.param encoders, including timestamps and JSONB. Relationship columns derive from scoped source rows. Omitted defaults and explicit nullable position/number remain distinct. The supplied date/JSONB/default/null tests are meaningful. I found no additional codec, field-order, SQL-injection, credential widening or current cross-tenant read/write defect in the inspected change.

Create/import consume a number if a later scoped task insert misses, but publish no task.created for an absent task. I found no contiguous-number contract; numbers must not be reused, so that gap is not another blocker. Asset finalization checks its missing write result before returning success and has no earlier asset mutation to strand on that path.

## Inherited residuals and evidence limits

A read-only source comparison confirmed the five shared legacy helper bodies are unchanged from the base: lockLegacyTaskRowIfPresent, lockLegacyTaskRow, lockTaskAndAssertProjectLive, lockProjectsAndAssertLive and lockProjectAndAssertLiveForTaskNumber. Their non-task callers and other shared helper ownership/scoping gaps remain inherited work. The new task paths do not fall back to the unscoped legacy task lock. No general system/producer exemption, rest-of-#580 conversion, outbound activation or stage completion is granted.

I independently compared Git trees: exact HEAD is 7c461e2bdedf18cc96860cd77eb28927e8ce883e; normal parents are 7b9ea329f9680ca353163b18aafa9d07a946262f and 33995c2af23da197f2fd9d5690717f7aeb4e9f67; all 26 candidate-path entries equal 7b9; every other tree entry equals the assigned protected base. Worktree was clean. git diff --check against the base exited zero.

Inspected candidate/native-result JSON, log summaries and SHA-256 hashes, runtime/setup and exact-ID cleanup receipts and inventory deltas for c13, 0e3 and 7b9. They record respectively 13 files/212 tests in 57.545s, five/94 in 27.527s, and six/62 in 24.916s, each native exit zero with CI absent. These are author/operator runs on their actual source SHAs, not tests I performed or an executed 7c result. The latest 7b9 native log hash matches 5f079413268bb1c7215ce64d64eccd0b826bd43016d3b7b8c490820fd965cbd1 and PostgreSQL log hash matches 56f473e5aeb4207f19f80bcd2b9ab7c22d424af81e2751344c3038dee6b1f34c. Its receipt records PG18, tmpfs /var/lib/postgresql, dynamic 127.0.0.1 mapping, exact owned-container successful stop, and inventories restored to 23 containers/109 volumes/seven networks with no added/missing IDs. Existing realtime.failure lines are retained; passing test counts do not imply all runtime behavior is accepted.

Only read-only Git/source/evidence inspection and this new private report write were performed. No source edits, checkout/ref writes, package installs, tests, PostgreSQL, Docker, image/build, browser, CI, GitHub mutation, push, PR, merge or child-agent work occurred. No full-suite, image boot/health, browser/SIT, current required-CI or merge-readiness assertion is made. Candidate remains blocked on B2 and the applicable exact-head gates.


## Evidence file

`query580-b9-7c-required-result-ordinary-a-luna.md`

# Ordinary A required-result repair and accepted-main composition review — #580 batch 9

- **Reviewer/model:** GPT-6 Luna, fresh independent review context. I did not author or direct the `7b9` repair. This is the same Ordinary A lane that completed the full `c13` review; I preserved and selectively rechecked that full-scope conclusion against the composed candidate.
- **Reviewed exact head:** `7c461e2bdedf18cc96860cd77eb28927e8ce883e`
- **Protected-main base:** `33995c2af23da197f2fd9d5690717f7aeb4e9f67`
- **Scope:** complete 26-path batch-9 candidate scope retained from the c13 full review, with focused inspection of the 0e3 Sol B1 required-result findings, the `7b9` production/test repair, current transaction and event ordering, and accepted-main composition. Confirmed clean worktree and exact HEAD. The first parent is `7b9ea329f9680ca353163b18aafa9d07a946262f`, second parent is protected main; current source changes are the 26 batch paths and composition has no conflicts. `git diff --check` is clean. Static review only: I ran no tests, PostgreSQL, build, runtime, browser or Docker, and made no repository edits.
- **Verdict:** **CLEAR for this Ordinary A scope; ready for remaining independent review and exact-head gates.** Not a security approval, merge approval, or whole-#580 completion claim.

## Findings

The `7b9` repair closes the Sol B1 required-result class across the identified effectful paths. In `updateTaskTitle`, the scoped activity `INSERT … SELECT … RETURNING id` is now required inside the title transaction. If revocation makes the activity insertion return no row after the task update, the controller throws before commit, rolling back the title/version and preventing the post-commit title event. In `updateTaskDueDate`, the scoped task update result is checked inside the same transaction as reminder clearing; a zero-row update throws and restores deleted reminders. In bulk status, priority, assignee and due-date branches, each scoped update result is checked before queuing its mutation event or returning item success. A refusal throws the existing opaque not-found result, the per-item transaction rolls back, the established item error handling reports failure, and relation refresh remains after successful commit. The label conflict/no-op behavior remains intentional and unchanged.

The added regressions exercise the relevant persisted-revocation interleavings: real PostgreSQL trigger barriers for title and reminder mutation; bulk barriers after positive real scoped pre-write lookups, followed by persisted grant deletion before the actual update; and assertions on returned failures, rollback/state, activities, mutation events and relation-refresh events. I reviewed these tests statically. The retained operator report records a focused PostgreSQL run on exact `7b9`: 6 files, 62 tests, native exit 0, 24.916 seconds. That is author/operator evidence for `7b9`, not a run I performed or a claim that the 7c merge itself was executed.

I rechecked the relevant adjacent `updateTaskRow` callers: the other single-update routes check missing results before emitting events and have no earlier transactional side effect that this finding would leave committed. The due-date reminder path was the exceptional preceding mutation and is now atomic. The title activity insert was the exceptional required follow-up write and is now atomic. For the bulk branches, result checks precede both event queueing and the external relation-refresh event.

The c13 retained structural conclusions remain applicable to this exact composed tree: repository identity predicates remain on task/resource SQL; generic updates pin the current project; the dedicated move operation keeps task and linked-asset movement in the same identity-scoped SQL statement; task move lock ordering is preserved; and all four INSERT…SELECT producers retain target-column Drizzle encoders. The 26 candidate paths are unchanged by the accepted-main composition proof supplied for 7c, while all other tree entries equal accepted main. I found no composition conflict or regression in the touched transaction/effect paths. The inherited shared non-task legacy query/lock gap remains outside this slice.

## Limitations and attribution

No new blocking finding. This is static ordinary review, not runtime verification of 7c. The exact 7b9 focused PostgreSQL result is available in `query580-b9-7b9-focused-pg-result-luna.md`; the earlier b628/a817 adverse runs remain historical and are not overwritten by later successful evidence. Required additional independent ordinary reviews, fresh GPT-6 Sol security review, exact-head CI and other acceptance gates remain outstanding. Scope does not claim full #580 acceptance or stage completion.


## Evidence file

`query580-b9-a817-focused-pg-result-luna.md`

# #580 batch 9 focused PG18 result — a817ff91

- Repository/worktree: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Exact candidate SHA: `a817ff9160a1f805b8ba7293f8d2fcafd9eeb931`
- Pre-run worktree was clean at that exact SHA; all 13 configured test paths were present.
- Operator: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-a817ff91/run-focused-tests.py`
- Configured operator SHA256: `c9b1a805fb2e9a697ca2a5dccd19e258d4b63e496b5f450bcdb7765ca986c5e8`; validated predecessor source SHA256: `c9efef4185499b7fa578046a6dfac15258eb9ca`; the exact configuration-only copy diff and source-hash record are preserved in the evidence directory.
- Docker pre-run inventory was observed as 23 containers, 109 volumes, 7 networks.

## Invocation and outcome

The operator ran the configured canonical Vitest invocation once, with CI absent, against PostgreSQL 18. The exact argv, cwd, and all 13 test paths are in `vitest-invocation.txt` and `vitest-result.json`. PostgreSQL readiness succeeded. Native Vitest result: return code 1, not timed out; elapsed 57.475 seconds (`2026-10-16T17:31:00.096697Z` to `2026-10-16T17:31:57.572550Z`). Vitest summary: **13 files: 9 passed, 4 failed; 212 tests: 207 passed, 5 failed**. This candidate run is not passing.

The five reported failures were:

1. `project-archive-freeze-legacy.test.ts` — “rechecks source liveness when archive wins during destination preflight”: `Error: destination preflight did not start` at test line 1028 after its five-second wait.
2. `task-repository-moves.test.ts` — “task INSERT SELECT preserves omitted defaults, explicit nulls, and supplied values”: omitted insert result was `undefined`, expected `{ position: 0, number: 1 }` (line 191).
3. `task-repository-moves.test.ts` — “move preflights: freeze flags, workspace-scoped destination, lock modes and identities”: destination project lookup returned `undefined`, expected project ID `cf9vbxpj96gwpogfnf3sn8ar` (line 463).
4. `task-repository.test.ts` — “project reads: live-project lookup hides soft-deleted, the row lock skips deleted and archived, the number advances by count”: `lockLiveProjectRow(tx, p3.id)` returned `undefined`, expected project ID `fyt2tj4iv9tszbue8l4x93q4` (line 209).
5. `task.test.ts` — “creates an unassigned task with parsed dates when optional fields are provided”: expected `startDate` `2026-04-01T09:00:00.000Z` and `dueDate` `2026-04-05T17:00:00.000Z`; actual JSON values were `2026-04-01T15:30:00.000Z` and `2026-04-05T23:30:00.000Z` (line 234).

The full Vitest log contains each failure stack and final summary. No cause beyond those captured outputs is asserted here. This is the post-lock-order-fix source candidate; the prior interrupted `b6284aef` run and its observed lock chain remain separately preserved in its original evidence directory and report.

## Runtime and cleanup

The owned container was `postgres:18-alpine`, ID `0f6f8057275275a0876f801bf62961f085830c5197c4853b6b7eade7c9507ae7`, with candidate-bound labels, tmpfs `/var/lib/postgresql:size=1g`, verified `/proc/mounts` proof, and dynamic loopback mapping `127.0.0.1:32803`. The exact-ID cleanup receipt records successful stop (`returncode: 0`) with matching task/revision/run labels. Post-run inventories exactly matched pre-run counts: 23 containers, 109 volumes, 7 networks; no IDs added or missing. The operator removed its ephemeral `test.env`.

Full native output is preserved at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-a817ff91/vitest.full.log` (133,569 bytes, 625 lines), alongside the PG readiness, container inspect/proc-mounts, cleanup receipt, and inventory evidence. No follow-up test, source edit, or rerun was performed.


## Evidence file

`query580-b9-a817-runtime-hash-erratum-luna.md`

# Erratum — a817ff91 runtime report operator-source hash

This note supplements but does not replace `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-a817-focused-pg-result-luna.md`.

The original report's “validated predecessor source SHA256” value is truncated/incorrect. The contemporaneous `operator-source-hashes.json` receipt in `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-a817ff91/` records:

- Validated predecessor source: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-b6284aef/run-focused-tests.py`
- Correct full SHA256: `c9efef4185499b7fa578046a6df549203301847abec6ada25a40aa747bc4938c`
- Configured a817ff91 execution-copy SHA256: `c9b1a805fb2e9a697ca2a5dccd19e258d4b63e496b5f450bcdb7765ca986c5e8`

The original runtime report remains preserved unchanged. Its test counts, native exit, failure descriptions, PG18 runtime receipts, and cleanup evidence are unaffected by this hash correction.


## Evidence file

`query580-b9-atomic-move-repair-luna.md`

# #580 batch 9 atomic task and asset move repair

- Repository/worktree: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Parent candidate before repair: `c20871657a881db0e66701d7751a12f3352df6d5`
- Repair commit / exact head: `b6284aef2454a3f296307660b6dfac15258eb9ca`
- Parent-directed scope: repair the task-project move authorization snapshot race; preserve the existing route lock/transaction/error/event flow; no PG/runtime/build/browser/Docker/CI/push/PR was authorized or run.

## Change

The move route now calls `moveTaskAndAssetsForIdentity(executor, identity, taskId, sourceProjectId, destinationProjectId, values)`. It is one PostgreSQL statement with a `moved_task` UPDATE CTE and a dependent `moved_assets` UPDATE CTE. The task CTE enforces the current source and destination reach predicates, same live workspace, matching source project, and refuses to move if any linked asset is outside the task's source project. The asset CTE consumes the task CTE's `RETURNING` row and updates only that task's source-project assets. Both updates therefore share one statement snapshot and one transaction outcome.

The route still obtains its task/source/destination locks and performs its existing validation and task-number claim in the transaction. It still raises the existing “Failed to move task” error if no task row returns, and publishes `task.moved` only after the transaction completes. The old independently callable `reassignTaskAssetsToProject` export was removed. Generic `updateTaskRow` now excludes `projectId` from its values type and pins the existing project ID, so it cannot be used as the first half of a future split move. The ordinary update-task controller stopped redundantly passing its route project ID to that generic update; the ID remains used for its existing status/column checks.

The existing `task-repository-moves.test.ts` now exercises the atomic move method, checks that a linked asset with a mismatched project blocks both sides, and adds a forced revocation interleaving. In the interleaving, a task UPDATE trigger waits on an advisory-lock barrier after statement qualification; the test revokes destination membership while the statement is paused, then releases it and asserts the task and its linked asset both moved while an unrelated asset stayed in the source project. It checks source/destination reach before the race, one actual revoked membership, and destination denial after revocation. This test was authored but not executed.

## Evidence and limits

- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json` — passed.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json` — passed.
- `pnpm exec biome check apps/api/src/task/repository.ts apps/api/src/task/controllers/move-task.ts apps/api/src/task/controllers/update-task.ts tests/api-integration/task-repository-moves.test.ts` — passed (4 files).
- `git diff --check` — passed before commit.
- An actual-source probe imported `moveTaskAndAssetsForIdentity`, supplied Drizzle's installed `drizzle.mock()` executor, intercepted only the terminal query to capture `.toSQL()`, and verified the generated SQL has `WITH moved_task AS (UPDATE task ... RETURNING ...)`, `moved_assets AS (UPDATE asset ... FROM moved_task ...)`, current membership/project reach predicates, and the source-asset mismatch guard. Probe: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-atomic-move-source-probe-luna.ts`.
- A syntax error in an earlier, hand-composed probe attempt was corrected; the corrected actual-source probe above exited 0. No SQL was sent to PostgreSQL. CTE support, statement execution, and race-test behavior still require the root's authorized focused PG window.
- No integration test, runtime command, build, browser, Docker, or CI command was run.

The candidate contains a single newly added test case in the existing test path `tests/api-integration/task-repository-moves.test.ts`; production edits are limited to `apps/api/src/task/repository.ts`, `apps/api/src/task/controllers/move-task.ts`, and the compile-seam removal in `apps/api/src/task/controllers/update-task.ts`. No new production module or test path was added.


## Evidence file

`query580-b9-b628-focused-pg-result-luna.md`

# #580 batch 9 focused PostgreSQL run — interrupted adverse result

- Candidate/worktree: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Exact candidate SHA: `b6284aef2454a3f296307660b6dfac15258eb9ca`
- Pre-run worktree: clean; operator recorded `clean=true`, with all 13 configured paths present.
- Operator: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-b6284aef/run-focused-tests.py`; source hash matched its validated original (`aa09ad17f4e489c714aa1220c5f1a0ccc9062ee7968d2757c973a6256e886409`), and configured copy hash was `c9efef4185499b7fa578046a6df549203301847abec6ada25a40aa747bc4938c`. The only operator configuration delta is preserved in `operator-configuration-only.diff`.

## Invocation and result

The one authorized invocation was:

`pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/task.test.ts ../../tests/api-integration/task-repository.test.ts ../../tests/api-integration/task-target-reach.test.ts ../../tests/api-integration/move-task-workspace-reach.test.ts ../../tests/api-integration/project-archive-freeze-legacy.test.ts ../../tests/api-integration/project-soft-delete-freeze.test.ts ../../tests/api-integration/authorization-boundaries.test.ts ../../tests/api-integration/workspace-rbac.test.ts ../../tests/api-integration/label-detach.test.ts ../../tests/api-integration/label-bulk-rename-race.test.ts ../../tests/api-integration/task-update-concurrency.test.ts ../../tests/api-integration/task-repository-moves.test.ts ../../tests/api-integration/task-title-activity.test.ts`

The operator started at `2026-10-16T17:23:14.135062Z` and recorded its interrupted end at `2026-10-16T17:28:07.247815Z` (293.111 seconds). PostgreSQL 18 became ready after two probes. Root observed the actual lock cycle and terminated only the exact observed Vitest descendant PIDs with SIGTERM; the operator remained alive to execute its cleanup. Native Vitest subprocess return code is `-15`; the Python operator surfaced shell exit `241` because it propagated that negative signal code. The configured 600-second timeout did not fire (`timed_out=false`).

This is **not a passing run**. Vitest did not reach a final summary; test-file and test-case pass/fail totals are unavailable. Its retained log reached `project-archive-freeze-legacy.test.ts` > `rechecks source liveness when archive wins during destination preflight` when root intervened. The 13 configured file paths are in `vitest-result.json` and `vitest-invocation.txt`; no additional test command was run.

Root's retained `root-live-blocking-observation.log` records PostgreSQL sessions 191, 193, 207, 212, and 217: session 191 was idle in transaction; project archive UPDATE 193 waited on transaction 191; reset/TRUNCATE 207 waited on relation lock 191; reset 212 waited on 207; reset 217 waited on both 207 and 212. Root identified the mechanism: the move route now takes the source project's `FOR SHARE` lock earlier through `lockTaskAndAssertProjectLiveForIdentity`, before destination preflight. The prior route order held the task row lock, did source preflight without this early project lock, then acquired the sorted project locks. The old project archive race consequently exposes a lock-order regression introduced by this candidate. Restore the original route lock sequence before any further PG window; do not weaken the race test.

## Runtime setup and cleanup

The owned PostgreSQL 18 Alpine container used ID `44b927a34baeb001ed910cf3c6f324342b6cf49f7db3a30e585123f384f297b3`, labels bound to this task and exact candidate, tmpfs at `/var/lib/postgresql:size=1g`, and loopback-only dynamic port `127.0.0.1:32802`. Inspect, container `/proc/mounts`, and readiness receipts are retained. Cleanup verified the exact task/revision/run labels and stopped that exact ID successfully (`returncode: 0`). Before and after Docker inventories were identical: 23 containers, 109 volumes, 7 networks; added and missing ID lists are empty. The ephemeral `test.env` was removed by the operator.

Full adverse evidence remains in `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-b6284aef/`, including `vitest.full.log` (78,440 bytes, 294 lines), `vitest-result.json`, `root-live-blocking-observation.log`, `root-exact-owned-run-stop.json`, `postgres-container.log`, cleanup receipt, and before/after inventories. No credentials are reproduced here. No source edits or reruns were made after this result.


## Evidence file

`query580-b9-c13-full-ordinary-a-luna.md`

# Ordinary A full review — #580 batch 9 candidate c13e5149

- **Reviewer/model:** GPT-6 Luna; same independent Ordinary A context as the prior reviews. I reviewed findings and did not author or remediate candidate code.
- **Reviewed head:** `c13e5149c7ad9b529bf644347fa30834cf7c47f2`
- **Comparison base:** `f5d8f51c1d502b58af2e7b6b9cf01a6e01f7680e`
- **Scope:** complete exact-base diff, all 26 changed paths (21 production paths and five test paths), current repository statements and call sites, task move transaction and test barriers, credential propagation, lock/error/event behavior, and parameter codecs. Also read the specified repair/result reports and inspected the c13 focused-run result, log tail, container cleanup receipt, inventory delta and runtime receipt. Static source review; I did not run tests, PostgreSQL, build, runtime, browser, Docker, or make edits.
- **Verdict:** **CLEAR — no blocking findings in this Ordinary A review scope; ready to proceed with the remaining independent reviews and required gates.** This is not a merge approval or stage-completion claim.

## Findings

The earlier destination-scope finding is closed structurally. Generic `updateTaskRow` excludes `projectId` and pins the existing column; `updateTaskRowReturningId` also excludes moves and pins the current project. The only move path uses `moveTaskAndAssetsForIdentity`: its task UPDATE requires the locked task ID and source project plus current identity reach to both live/unarchived source and destination projects in the same workspace. It rejects pre-existing linked assets whose project differs from the source. A dependent data-modifying CTE updates all source-project assets for the returned moved-task row in the **same SQL statement and snapshot**. If the task CTE returns no row, the route raises its existing failure and the enclosing transaction rolls back its earlier destination-number claim. The asset CTE cannot run for a task the task CTE did not move, and unrelated task/unattached assets are excluded. The route publishes `task.moved` only after commit. This closes the previously identified reach-revocation inter-statement gap without relaxing statement-level destination scope.

The b628 lock-cycle regression was real and remains preserved as adverse history. On a817 the route now locks only the identity-scoped task before source/destination preflight, then obtains source/destination project locks in sorted order. It no longer takes the source project's share lock before destination preflight. This restores the relevant prior lock sequence and preserves source/destination liveness rechecks and status/error behavior. The c13 focused run includes the archive-freeze concurrency regression that had hung on b628 and failed to reach its destination-preflight barrier on a817; that test passed on c13.

The c13 parameter repair applies `sql.param(value, targetColumn)` to all four INSERT…SELECT producers (`insertTask`, `insertTaskActivity`, `insertAsset`, and task-label insertion), so Drizzle's target column encoders handle timestamps, JSONB and scalar values. Default-versus-explicit-null choices remain explicit. No environment timezone override was added. The c13 integration test adds UTC round-trip checks for task timestamps, activity JSONB/timestamps and asset timestamp. The previous a817 date-encoding failure on the +0630 host is repaired on c13; the source expectation in `task.test.ts` was not weakened.

Across the complete candidate diff, task feature SQL moved into the named task repository, with controller writes routed through repository methods that accept the transaction executor. The intended request identity is resolved using `resolveCallerIdentity`, which preserves session, impersonation and API-key credential context; route middleware remains responsible for capability decisions while repository predicates enforce current persisted reach. The inspected read/write paths correlate task-derived data (labels, external links, relations, reminders, activity and assets) to an identity-reachable task/project, and project-specific selectors include reach predicates. Insert-selects derive tenant/project/task relationship columns from scoped source rows rather than accepting destination ownership columns from caller values. I found no additional concrete cross-tenant read/write path or source-conservation defect in the remaining changed paths. The inherited shared non-task lock/query gap identified for this slice remains out of scope and is not reopened here.

## Runtime attribution and adverse history

I did not operate the runtime. The retained c13 result is bound to the exact reviewed SHA: PostgreSQL 18 focused Vitest command, 13 configured integration files, native exit 0, **13 files and 212 tests passed**, 57.545 seconds, `CI` absent and host timezone `Asia/Yangon` (+0630). I checked `vitest-result.json`, the final native log summary, the cleanup receipt and final inventory delta in `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-c13e5149/`. The exact labeled owned container stopped successfully; before/after inventories match at 23 containers, 109 volumes and 7 networks, with no added or missing IDs. The prepared result note is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-focused-pg-result-luna.md`.

The earlier b628 interrupted run remains a non-pass with an observed lock cycle; the a817 exact-head run remains a non-pass (9/13 files, 207/212 tests; five failures). The a817 hash erratum remains attached to that report. c13 is a later exact head with source repairs for the lock sequence, fixtures and encoders, and its own passing focused run; these later results do not rewrite or erase the historical adverse outputs. No full-suite, CI, image, browser, or deployability result is claimed.

## Non-blocking residuals

No new blocker. The review covers this candidate's stated query-ownership slice, not full #580 acceptance, every shared helper outside the changed slice, or any later-stage completion claim. Required independent Ordinary B/C reviews, the applicable fresh GPT-6 Sol security review, exact-head CI and any remaining acceptance work are still separate gates.


## Evidence file

`query580-b9-c13-full-ordinary-b-luna.md`

# Query 580 batch 9 — Ordinary B review

- **Reviewer/model:** GPT-6 Luna (independent Ordinary B context).
- **Reviewed head:** `c13e5149c7ad9b529bf644347fa30834cf7c47f2`
- **Comparison base:** `f5d8f51c1d502b58af2e7b6b9cf01a6e01f7680e`
- **Worktree:** `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2` (clean at reviewed head).
- **Scope:** Read repository authority, active mission, agent workflow, provider adapter, work-items feature contract, coding standards query-ownership rules, security model and multi-tenancy contract. Inspected the full production and test path list, task repository query helpers and controller seams, move mutation/asset CTE, identity scope predicate, selected repair reports, current focused PostgreSQL evidence, and the final move-revocation test.

## Verdict: BLOCKED

### Blocking finding — `findProjectWorkspaceId` omits current identity scope

`apps/api/src/task/repository.ts:331-339` selects `project.workspaceId` using only `project.id = projectId`. It accepts no `ResolvedIdentity` and does not apply `currentProjectReachPredicate`. The helper is used by the bulk-update and assignee-update controllers (`bulk-update-tasks.ts:209`, `update-task-assignee.ts:41`). Those present callers first obtain the project ID from an identity-scoped task lock, which limits the currently demonstrated exposure; however, repository functions must enforce current reach in the statement itself, and an additional project ID is not authoritative scope. This is an explicit violation of `docs/04-engineering/coding-standards.md` § Query ownership and `docs/01-architecture/security-model.md` § 5, not just a style concern. Thread the resolved identity through this helper and predicate the project lookup by current reach (or remove the extra lookup by deriving the workspace from a scoped query), with a focused regression showing an unreachable project ID yields no row.

I found no evidence that current routes can supply an arbitrary project ID to this helper after the task lock; the blocker is the unenforced repository boundary and potential reuse, rather than a demonstrated existing cross-tenant response. The inherited shared `lockLegacyTaskRowIfPresent` implementation and its non-task callers were unchanged and are outside this finding.

## Checks run

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/task/bulk-update-tasks.test.ts` — PASS, 1 file / 2 tests. Native output saved mode 0600 at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-c13-unit-review-XXXXXX.log`.
- Reviewed author/operator report `query580-b9-focused-pg-result-luna.md`: reports 13 integration files / 212 tests passed on exact c13 head under native +0630 timezone, with recorded exact cleanup. This is author/operator evidence, not an independent reproduction.
- No integration, PostgreSQL, build, browser, Docker, or CI command run by this reviewer. No edits.

## Non-blocking findings and residuals

- Move task and asset writes now occur in one data-modifying CTE statement. The focused integration test places revocation between statement start and completion and checks the task and its attached asset move together; this addresses the prior inter-statement partial-move race under PostgreSQL statement-snapshot semantics.
- The author’s current focused PostgreSQL report is favorable but does not close my repository-boundary finding.
- I did not identify another blocker in the inspected identity propagation, current reach predicates, API-key route permission layering, or task move atomicity. This review does not establish full feature acceptance or #580 completion.


## Evidence file

`query580-b9-c208-ordinary-a-luna.md`

# Ordinary A follow-up — #580 b9 candidate c208

- **Reviewer/model:** GPT-6 Luna, same independent reviewer context as the prior Ordinary A review; focused follow-up on its SQL-scope blocker and move consistency race.
- **Reviewed head:** `c20871657a881db0e66701d7751a12f3352df6d5` (checkout exact head)
- **Comparison base:** `f5d8f51c1d502b58af2e7b6b9cf01a6e01f7680e`
- **Scope:** reviewed the two private repair reports, repair diff from `77fd4013546c6efba938ddb40be8b9296455b466`, current repository helper and move transaction, canonical identity reach predicate, membership projection locking, and relevant test changes. The candidate remains the original 26 paths (21 production, five test paths); this follow-up's diff touches four existing paths: task repository, move controller, and two integration tests. Static-only. No tests, build, runtime, PostgreSQL, or edits.
- **Verdict:** **BLOCKED for focused PostgreSQL acceptance by a concrete transaction-consistency race.** The original query-scope finding is otherwise closed by this delta.

## Prior SQL-scope finding: closed

`taskProjectMoveReach` now correlates source and destination project rows in the mutation statement and requires both live/unarchived, same workspace, and current persisted identity reach to both. `updateTaskRow` adds it when changing `projectId`; `updateTaskRowReturningId` excludes `projectId` from the input and explicitly writes the current column value. `reassignTaskAssetsToProject` requires the expected asset source project, applies the same source/destination reach helper, and checks that the task row already has the destination project and current reach. The move controller passes the locked source ID. These changes satisfy the coding-standards rule that an additional project ID must be identity-checked and appear in the statement predicate.

The c208 fixture changes are material and correct: canonical project grants are created before identities are resolved; the positive case moves the task row before asset reassignment; and the negative case verifies destination reach before revoking exactly one membership and confirms it is denied afterward. The negative case is sequential, so it does not exercise the inter-statement race below.

## Blocking finding — a concurrent reach revocation can commit a partial move

The route wraps both writes in one `db.transaction` (`apps/api/src/task/controllers/move-task.ts:104`, `217-237`) and treats asset reassignment as part of moving the task (“Move the task's assets with it”, repository comment at `repository.ts:1422`). The task UPDATE and asset UPDATE are separate SQL statements. Under the default Drizzle/PostgreSQL transaction configuration (`apps/api/src/database/index.ts:335-365` creates a standard `pg.Pool`/`drizzle` instance; the move passes no isolation option), PostgreSQL READ COMMITTED gives each statement a fresh snapshot.

A reachable interleaving is:

1. The move statement's `taskProjectMoveReach` sees source and destination project grants and updates the task to destination.
2. A concurrent membership/grant revocation commits for the actor's destination reach.
3. The asset statement's reach predicates see the revoked membership and update zero matching assets. It is awaited, but its result/count is ignored (`repository.ts:1430-1457`).
4. The move transaction returns success and commits the task with an asset still carrying the source `projectId`.

The existing project row locks do not serialize the membership authorization rows. The membership-projection write path uses `taskdesk:membership:<personId>:<scope>:<scopeId>` advisory transaction locks and membership row locks (`apps/api/src/identity/repository.ts:1436-1457`, and projection logic at `2094-2106` onward); this move acquires no corresponding authorization lock. Thus the second statement's scope check can legitimately stop the asset mutation after the first mutation has already succeeded. A task asset stores both `taskId` and required `projectId` (`apps/api/src/database/schema.ts:1198-1220`), and asset access/lookups use that project association; the partial result is a persisted task/asset relationship inconsistency, not merely a denied optional update. The same interleaving was possible in the original candidate, but remains in this exact candidate after structural repair; the new positive/negative regressions do not cover it.

Close the transaction invariant by coordinating a stable authorization snapshot/lock across the full task-plus-assets move, or by another design that guarantees the asset step cannot silently skip after an authorized task update. Keep statement-level destination scope. Add a regression that forces a destination reach revocation between the task UPDATE and asset UPDATE and asserts either a fully consistent move or a rollback/denial with both rows at source. Focused PostgreSQL should verify the actual concurrency mechanism and resulting transaction behavior.

## Non-blocking notes and boundaries

I found no remaining concern with the previously cited `updateTaskRow` destination assignment, the bulk returning helper's project pin, or asset helper's source/destination/task correlation. The inherited `lockLegacyTaskRowIfPresent` unscoped lock remains out of this slice per assignment. This static follow-up does not claim runtime behavior or approve merge; after a structural correction the new exact head needs a fresh review at the required tier.


## Evidence file

`query580-b9-codec-and-runtime-fixture-repair-luna.md`

# #580 batch 9 parameter codec and runtime-fixture repair

- Repository/worktree: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Base candidate: `a817ff9160a1f805b8ba7293f8d2fcafd9eeb931`
- Repair commit / exact head: `c13e5149c7ad9b529bf644347fa30834cf7c47f2`
- Worktree after commit: clean.
- Scope: existing production `apps/api/src/task/repository.ts` and existing test paths `tests/api-integration/task-repository-moves.test.ts`, `tests/api-integration/task-repository.test.ts`, and `tests/api-integration/project-archive-freeze-legacy.test.ts`. No new path or module.

## Repairs tied to the a817ff91 failure evidence

The four INSERT…SELECT repository producers were `insertTask`, `insertTaskActivity`, `insertAsset`, and `insertTaskLabelOnConflictDoNothing`. Their input parameters now use `sql.param(value, targetColumn)` wrapped in the aliased SELECT projection, so the installed Drizzle column encoder applies. This covers timestamp encoding, JSONB serialization, and typed scalar values. Default selection remains based on `=== undefined` for task position/number, status, priority/version, asset kind/surface, and created/updated timestamps; explicit nullable task position/number remain `NULL`. No `TZ`, UTC server setting, or environment workaround was introduced.

The previous `task.test.ts` task-creation date expectation was left unchanged. The existing task repository move test now asserts explicit UTC round trips for task `startDate`, `dueDate`, `createdAt`, and `updatedAt`; task-activity `createdAt`/`updatedAt` plus JSONB `eventData`; and asset `createdAt`.

All four fixture/assertion causes were checked against source before correction:

- The omitted/null/default task insert test created a new project but granted the identity only the projects returned by `seed()` (p1/p2). It now grants the actor canonical project access to the new project and refreshes the resolved identity before writes.
- The project-read/number test created p3 but did not grant the actor project reach. It now grants p3 and refreshes the identity before the row-lock and number operations.
- The move-preflight test switched the shared identity to identity B to prove access to B's foreign project, then used it for identity A's p2 positive lock checks. It now restores A at that boundary and explicitly reasserts that B's project remains hidden from A.
- The archive-preflight barrier test created its sorted same-workspace destination after granting workspace members access to the source, leaving that destination outside current project reach. It now grants only the intended member canonical project access to `sortedDestination`; the foreign/missing cases and all barrier assertions/timeouts remain unchanged.

The failure details and preceding candidate result remain in `query580-b9-a817-focused-pg-result-luna.md`. This commit does not claim those regressions now pass: PG/integration execution is explicitly pending root review and authorization.

## Static and SQL-shape evidence

- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json` — passed.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json` — passed.
- `pnpm exec biome check apps/api/src/task/repository.ts tests/api-integration/task-repository-moves.test.ts tests/api-integration/task-repository.test.ts tests/api-integration/project-archive-freeze-legacy.test.ts` — passed (4 files).
- `git diff --check` — passed before commit.
- Nonexecuting probe: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-sqlparam-probe-luna.ts` imports the actual repository exports and uses installed Drizzle `drizzle.mock()` with a terminal-query capture. It captured all four INSERT…SELECT statements. The task timestamp params were emitted as their expected ISO strings; the activity eventData param was JSON-serialized; target insert columns and SELECT shapes were present. Probe exited 0. No SQL reached PostgreSQL.
- No unit/integration test, PG, build, browser, Docker, or CI command was run for this candidate.

The authentic focused PG window on a817ff91 reported 13 files, 9 passed / 4 failed, 212 tests, 207 passed / 5 failed. The failures are recorded as adverse evidence and have not been reinterpreted as passes or rerun unchanged.


## Evidence file

`query580-b9-current-author-report-luna.md`

# #580 batch 9 current-main identity recovery — author report

Prepared 2026-10-16. This is source recovery on the accepted-main composition, not a review, runtime verification, merge, or #580 completion claim.

## Candidate and provenance

- Worktree: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Accepted base: `f77f89d9a6eb862cbf9d601c7868ca009b04d5e1`
- Replayed original batch source: `4448249ef0b1e094760977e5b2eff612444b9483`
- Current candidate: `645b7b8c8d905b321c9b60877469d87265ed8f8e`
- Recovery commit: `645b7b8c8d905b321c9b60877469d87265ed8f8e fix(api): scope task repository queries by current identity`
- Original retained source worktree/ref was not modified. The replayed 23-path batch-9 source blobs exactly match the original retained `4d0e92cd3f1890f5320ab4a5e2e2ab55fe77e97c` blobs; each differs from accepted `f77f89d9` (the repository file did not yet exist on that base). Machine proof: `query580-b9-current-source-comparison-machineproof-luna.txt` (mode 0600, O_EXCL).
- The candidate has 24 recovery-commit paths: 20 task production paths plus four existing task test/call-site compilation seams. Combined source composition retains the original batch's other 23 paths, including `validate-task-fields.ts`; no unrelated production module was added.

## What changed

At task route boundaries, the implementation resolves the existing `ResolvedIdentity` using `resolveCallerIdentity` and carries it explicitly through controllers into task repository operations. The task repository uses accepted-main `currentProjectReachPredicate` (and current workspace reach where a workspace-scoped label is the actual resource) correlated with live project/task rows in the SQL statements. Actor-facing task reads, full-row task locks, row DML/returning, task labels/assets/activity, bulk task operations, and move project/task scopes now have identity-aware statements. The existing route policies and caller-side reach checks remain in place; the SQL predicate is an additional current-reach boundary, not a capability grant.

The unscoped full-row task repository lock export was removed. The accepted-main shared `lockLegacyTaskRowIfPresent` keeps its inline `SELECT … FOR UPDATE` implementation for its existing non-task callers, and the shared task-number/project-liveness helper keeps its accepted ID-only inline project lock. Task-specific task-row/project-row locks use the identity-scoped task repository variants. The unchanged activity/time-entry/relation producer paths still use their pre-existing shared inline task-lock helper; this candidate does not claim those shared paths close #580 and does not rewrite those modules.

The integration tests now derive actor identities with the canonical `resolveIdentity` loader after seeding their persisted fixtures. The foreign-project row in the move/bulk repository suite is seeded directly through test setup, then the scoped candidate statements prove foreign update/delete refusal and unchanged row values. A revocation case snapshots a resolved identity, removes the persisted project-role membership, and proves the later update returns no row and preserves title/version. A separate actor proves a valid same-scope project identity still reaches its row. Controller tests pass resolved identities; the bulk unit test uses `resolveIdentityFromFacts` for its intentionally pre-database fail-fast input.

## Validation actually performed

- `pnpm --filter @taskdesk/api typecheck` — PASS (all configured API, permission, test, RLS-prototype and approvals TypeScript projects).
- `pnpm exec biome check --write` on the 24 touched task source/test paths — PASS; final output reported no fixes applied.
- `git diff --check` — PASS before commit.
- No test/runtime/PostgreSQL/Docker/build/browser/CI command was run. Prior `198 + 7` tests, six selected mutants, and ordinary/Sol reports remain historical evidence for old `4d0e92cd`, not this candidate.

## Current limits and next dependencies

This is a structural tenant-reach repair to auth-adjacent SQL and therefore needs the root's requested **three fresh independent ordinary reviews plus a full fresh GPT-6 Sol security review** on this exact candidate, after root source inspection. The prior two ordinary reports and old Sol report do not count for the new SHA. No current query checker was run, and the old source comparison proves replay provenance, not checker closure.

Task route capability policies continue to enforce the API-key owner ceiling; repository reach predicates do not replace that layer. This candidate does not add a new API-key-specific HTTP authorization regression. The existing shared inline lock users (activity/comment, time-entry, relations) remain a known query-ownership gap and must stay visible to the #580 final checker; there is no blanket internal-producer exemption. Import/export formats/engines were not redesigned. Do not claim #580 or any phase complete from this bounded batch.

No push, PR, GitHub state change, runtime test, review request, or merge was performed. The candidate is committed and the original source remains preserved for root inspection.


## Evidence file

`query580-b9-current-null-default-fix-followup-luna.md`

# Query #580 batch 9 nullable/default semantics follow-up

Date: 2026-10-16 (Asia/Yangon)

## Candidate

- Worktree: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Accepted base: `f77f89d9a6eb862cbf9d601c7868ca009b04d5e1`
- New exact head: `f2f6775f909b87bc13dff5b0c391795d84869b79`
- Commit: `f2f6775f` (`fix(task): preserve explicit nullable insert values`)
- Previous repair head: `c3fc9595d881279405e2072e5df20c07281ea831`; its report remains intact and is supplemented here, not overwritten.

## Default semantics correction and audit

The `task.position` and `task.number` schema columns are nullable and default to `0` and `1`. The task insert projection now substitutes those defaults only for `undefined`; explicit `null` remains SQL `NULL`.

Audited the other INSERT…SELECT projections against `apps/api/src/database/schema.ts`:

- Task: ID, status, priority, version, and timestamps have database defaults and are generated only when `undefined`; nullable fields without defaults map omitted or explicit null to SQL `NULL`, as the original insert did.
- Asset: ID, `kind`, `surface`, and timestamp defaults are applied only when `undefined`; nullable activity and creator references remain null when omitted or explicit null.
- Activity: ID and created/updated timestamp defaults are applied only when `undefined`; nullable actor/content/event/external fields preserve null. `eventData` remains a raw SQL parameter; actual PostgreSQL codec/serialization behavior is still unverified.
- Label: ID and created/updated timestamps are generated as before; this helper accepts no nullable default-bearing values.

A native API integration regression was added to `tests/api-integration/task-repository-moves.test.ts`: it inserts omitted defaults, explicit nulls, and supplied non-default values through the repository, asserts the persisted results, and verifies another project’s task rows remain unchanged. The test was not executed because PostgreSQL/runtime remains unauthorized.

The private actual-Drizzle `.toSQL()` probe was extended to exercise task insert omitted, explicit-null, and supplied-value variants and still checks full task/asset/activity/label target and projection shapes. It passed, with task params showing `0,1`, then `null,null`, then `23,77` for position/number.

## Final net candidate paths

The corrected count against `f77f89d9a6eb862cbf9d601c7868ca009b04d5e1` is **26 paths: 21 production paths and 5 test paths** (not 25/4 as stated in the prior report). The five tests are:

- `tests/api-integration/project-archive-freeze-legacy.test.ts`
- `tests/api-integration/task-repository-moves.test.ts`
- `tests/api-integration/task-repository.test.ts`
- `tests/api-integration/task-title-activity.test.ts`
- `tests/api/task/bulk-update-tasks.test.ts`

The 21 production paths are: `apps/api/src/task/assert-task-project-live.ts`; controllers `bulk-update-tasks.ts`, `claim-task-numbers.ts`, `create-task.ts`, `delete-task.ts`, `export-tasks.ts`, `get-task.ts`, `get-tasks.ts`, `import-tasks.ts`, `move-task.ts`, `require-task-permission.ts`, `update-task-assignee.ts`, `update-task-description.ts`, `update-task-due-date.ts`, `update-task-priority.ts`, `update-task-status.ts`, `update-task-title.ts`, and `update-task.ts`; plus `apps/api/src/task/index.ts`, `repository.ts`, and `validate-task-fields.ts`. The two new commits contain 22 changed paths total, within that 26-path net candidate; original batch-9 replay accounting remains 23 own verified blobs.

## Validation and remaining authorization

- `pnpm exec biome check apps/api/src/task/repository.ts tests/api-integration/task-repository-moves.test.ts` passed.
- `git diff --check` passed.
- `pnpm --filter @taskdesk/api typecheck` completed without diagnostics after the source/test edits.
- `pnpm --filter @taskdesk/api exec tsx /Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-current-source-insert-select-probe-luna.ts` passed.
- No PostgreSQL, integration test, runtime, build, browser, CI, review, push, or PR occurred. The focused native integration test awaits root authorization. No claim is made about timestamp/JSON driver codecs or final behavior until that authorized run.
- Candidate requires three fresh independent ordinary Luna reviews plus one fresh full GPT-6 Sol security review at the exact eventual head; this follow-up is author work, not review evidence.


## Evidence file

`query580-b9-current-source-repair-addendum-luna.md`

# Query #580 batch 9 current-main source repair addendum

Date: 2026-10-16 (Asia/Yangon)
Author lane: GPT-6 Luna

## Candidate and provenance

- Repository: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Accepted base: `f77f89d9a6eb862cbf9d601c7868ca009b04d5e1`
- Candidate after this repair commit: `c3fc9595d881279405e2072e5df20c07281ea831`
- Repair commit: `c3fc9595` (`fix(task): correlate scoped repository repairs`)
- Previous blocked candidate reviewed by root: `645b7b8c8d905b321c9b60877469d87265ed8f8e`.
- This repair preserves the prior O_EXCL source-comparison report and the adverse root source preflight. The original batch-9 worktree/branch was not modified.
- Original verified replay was 23 paths/23 blobs. The author repair checkpoint was 20 changed paths; the net candidate remains 25 paths (21 production/source paths plus four test paths). These are distinct accounting scopes.

## Root preflight defects and source changes

The source preflight identified a real uncorrelated-EXISTS write/read flaw, an invalid relation query alias, partial INSERT…SELECT projections, and unscoped task repository exports. The repair:

- Constrains task-number update, project lookup, and task INSERT to the exact outer project row (project ID, live state, and current reach), preventing one authorized project from updating/selecting/inserting across every project it can reach.
- Rewrites task relation listing around an addressed task EXISTS predicate, eliminating the missing outer `taskTable` alias while preserving source/target relation matching.
- Replaces activity, asset, label, and task INSERT…SELECT projections with complete schema-order selections and explicit defaults/nulls.
- Removes the unscoped task number advance, column lookup, and column-slug exports. Task status validation now consumes the identity-scoped column query.
- Reorders all 31 transaction-only repository methods to `executor` first, then identity and other arguments, per `docs/04-engineering/coding-standards.md` executor convention; direct callers and test adapters were updated. Optional-executor methods retain optional executor last.
- Preserves task-first/project-second locking and existing task transaction orchestration.

Changed production paths include `repository.ts`, `validate-task-fields.ts`, task controllers, `assert-task-project-live.ts`, and the task router/index compilation seams. Four API integration test paths include task repository, move repository, and project archive/freeze legacy coverage. Tests were edited but not run by explicit instruction.

## INSERT…SELECT probe

Private probe: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-current-source-insert-select-probe-luna.ts` (mode 0600). It invokes the actual exported repository insertion methods with a non-executing proxy around the installed Drizzle mock executor, captures each generated INSERT…SELECT with `.toSQL()`, and checks target-column order and projection arity. It does not connect to or query PostgreSQL.

Successful command:

`pnpm --filter @taskdesk/api exec tsx /Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-current-source-insert-select-probe-luna.ts`

All four checks passed: task 15 target/projection columns; asset 13; activity 12; label 7. The task SQL includes exact `project.id = requested projectId`, `project.deleted_at IS NULL`, and current project reach correlated to the outer project row. The asset, activity, and label SQL each selects from the addressed task row with current task-project reach. The probe also surfaced the installed schema’s actual task target field name `assignee_id`; the check records the generated full target list.

An earlier direct attempt to invoke the probe via root `pnpm exec tsx` failed because `tsx` is not on the root executable path. It was rerun successfully through the API package. The probe is private evidence only and not committed.

## Validation and boundaries

- `pnpm --filter @taskdesk/api typecheck` completed successfully after the final edits; this runs API, permissions, tests, RLS prototype, and approvals E2E TypeScript configurations. A first shell wrapper used zsh’s reserved variable name `status` after running the command, so its wrapper exit was ambiguous; the command was rerun with `task_rc` and returned without diagnostics.
- `pnpm exec biome check ...` on the 22 affected source/test files passed after formatter application.
- `git diff --check` passed before commit.
- No database test, PostgreSQL/Docker, runtime, build, browser, CI, push, PR, or review was run.
- No independent review is claimed. Because the candidate changes task authorization and SQL access control, it still requires three fresh ordinary Luna contexts and one fresh full GPT-6 Sol review at the exact candidate head before any merge consideration. Prior reviews do not satisfy those gates.
- Root inspection is required next. This checkpoint does not claim the larger task feature or #580 complete. Existing shared inline producer SQL remains a tracked partial-migration boundary; this patch does not claim a blanket exemption or full #580 ownership closure.

## Commands

- `git rev-parse HEAD` → `c3fc9595d881279405e2072e5df20c07281ea831`
- `git diff --check` → passed
- `pnpm exec biome check apps/api/src/task/repository.ts apps/api/src/task/validate-task-fields.ts apps/api/src/task/controllers tests/api-integration/task-repository.test.ts tests/api-integration/task-repository-moves.test.ts tests/api-integration/project-archive-freeze-legacy.test.ts` → passed (22 files)
- `pnpm --filter @taskdesk/api typecheck` → passed
- `pnpm --filter @taskdesk/api exec tsx /Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-current-source-insert-select-probe-luna.ts` → passed four actual repository INSERT…SELECT probes


## Evidence file

`query580-b9-destination-scope-repair-luna.md`

# Query #580 batch 9 destination-scope structural repair

Date: 2026-10-16 (Asia/Yangon)
Author/fixer: GPT-6 Luna (not an independent reviewer)

## Exact candidate

- Repository: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Accepted comparison base: `f5d8f51c1d502b58af2e7b6b9cf01a6e01f7680e`
- Root-composed candidate before repair: `77fd4013546c6efba938ddb40be8b9296455b466`
- Repaired head: `fe8c0792a49cc170ff9453fd11545f3157dac9a7`
- Commit: `fe8c0792` (`fix(task): enforce reachable move destinations`)
- New path count: 0. Candidate net remains 26 paths: 21 production and five test paths. Only two existing production paths and one existing test path were edited in this repair.

I read the full fresh blocking review at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-77fd-ordinary-a-luna.md`, plus the cited coding standards executor/tenant-scope requirements and security-model §5. The finding was that move writes proved current source reach but did not enforce reachable destination identity and same-workspace correlation in the write statements.

## Before / after

Before, `updateTaskRow` could change `projectId` while only filtering the task by reach to its source project. The destination check in the controller could become stale before the UPDATE. The generic `updateTaskRowReturningId` also accepted `projectId` and spread it into `.set`. Asset reassignment accepted a task and arbitrary destination project ID and only checked reach through the task’s then-current project, so a mismatched project argument could diverge asset and task project IDs.

After:

- One repository helper, `taskProjectMoveReach`, joins aliased source and destination project rows in the same SQL predicate. It requires both rows live/unarchived, source and destination in the same workspace, and current persisted identity reach to both rows.
- `updateTaskRow` keeps its existing task ID/source reach checks. When `values.projectId` is supplied, its UPDATE additionally applies `taskProjectMoveReach` to the current task source and requested destination. Ordinary non-move task edits keep their previous predicate and behavior.
- `updateTaskRowReturningId` no longer exposes `projectId` in its TypeScript input and writes `projectId = task.projectId` explicitly, preventing a future caller or a runtime extra field from moving a row through the generic bulk-edit seam.
- `reassignTaskAssetsToProject` now receives both source and destination IDs. Its UPDATE requires the asset’s existing project ID to equal the expected source, applies same-workspace/live/current reach to both project rows, and requires the addressed task already to belong to the requested destination with current reach. A mismatched task or destination cannot update asset rows.
- The move controller passes the task’s locked source project ID into asset reassignment. Existing preflight checks, sorted project locks, transaction grouping, errors, task-first lock order, task number allocation, and event-after-commit flow remain in place.

The existing `task-repository-moves.test.ts` now covers three relevant cases through the repository layer: a normal source-to-destination asset move; a mismatched asset destination called before the task moved, which leaves the asset at source; and destination project reach revoked after resolving the identity, which leaves both task and asset in the source project with the original task number. The negative fixture uses `grantProjectRole` to seed actual canonical grants before resolving identity and then deletes only the destination project membership through test DB setup.

## Static SQL evidence

Private non-executing probe: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-destination-mutation-probe-luna.ts` (mode 0600). It calls the actual repository update methods against `drizzle.mock()` wrapped to intercept awaited builders and capture `.toSQL()`; it never connects to PostgreSQL.

Successful command:

`pnpm --filter @taskdesk/api exec tsx /Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-destination-mutation-probe-luna.ts`

The captured move UPDATE includes task source reach plus aliased live source/destination projects, same-workspace equality, and reach subqueries for both. The generic returning UPDATE pins `project_id` to the existing task row. Asset reassignment contains expected `asset.project_id = source`, destination reach and same-workspace guard, and `task.project_id = destination` correlation. This validates SQL structure, not PostgreSQL execution or driver behavior.

## Checks and boundaries

- `pnpm exec biome check --write ...` followed by `pnpm exec biome check ...` on the two production files and move integration test: passed, three files.
- `git diff --check`: passed.
- `pnpm --filter @taskdesk/api typecheck`: exit 0 (all five configured TypeScript projects).
- The non-executing SQL probe above: exit 0.
- No PostgreSQL, integration test, runtime, build, browser, Docker, CI, push, PR, central-document edit, or review was run.
- This is fixer work only. The independent ordinary reviewer’s blocker remains theirs to reassess at the new exact head; the candidate still needs its other ordinary reviews and required full GPT-6 Sol security review. Focused PostgreSQL acceptance awaits root authorization.


## Evidence file

`query580-b9-focused-pg-result-luna.md`

# Query 580 batch 9 focused PostgreSQL result (author/operator)

Candidate: `c13e5149c7ad9b529bf644347fa30834cf7c47f2` on `codex/query-ownership-580-b9-current`, exact approved worktree `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`. Candidate check recorded this SHA, clean status, and 13 verified test paths before execution. The worktree remains at this exact head and is clean.

I read the prepared operator and its configuration-only diff before activation. The source operator SHA-256 is `c9b1a805fb2e9a697ca2a5dccd19e258d4b63e496b5f450bcdb7765ca986c5e8`; configured execution operator SHA-256 is `49d79dfe784eb257d5d59c3c5937543eb82567ff7e79e89a42c4ccaa84d8e901`. The only configuration changes point to the c13e5149 evidence directory, exact candidate SHA, and uniquely named owned container. One invocation ran the canonical 13-file Vitest integration command with `CI` absent and no timezone override. Host timezone was Asia/Yangon (`+0630`) during the run.

Native result: exit code 0, not timed out, 13 test files passed and 212 tests passed. Runtime was 57.545 seconds (Vitest reports 56.24 seconds). The command was `pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts` followed by the 13 paths listed in `vitest-invocation.txt`. In particular, the new explicit date and JSON roundtrip assertions ran in `task-repository-moves.test.ts`; the existing `task.test.ts` date oracle was unchanged. This confirms the Drizzle encoder fix on the native +0630 host timezone for this focused test set.

The exact owned PostgreSQL 18 container used parent-directory tmpfs at `/var/lib/postgresql`, verified through container `/proc/mounts`; it had no persistent mounts and published a dynamic port bound only to `127.0.0.1`. Exact owned container ID `5ab0b88ac21f0923c04b91423f678bc5438cfff4ff939e28823a66e065389a4e` was stopped with cleanup exit 0. The ephemeral environment file was removed. Inventory returned exactly to baseline: 23 containers, 109 volumes, 7 networks, with no added or missing objects. No source edits occurred during the run.

Evidence directory: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query580-b9-runtime-c13e5149/`. Native logs and receipts are retained there with restrictive permissions. SHA-256: `vitest.full.log` `93ad125b7669d84020b9556cfc9e055c8e652ef57903efb49ba6568c15e89aa5`; `postgres-container.log` `30f2dd1abffd5932b57f1ff4fa40a75bdd4bbbd7605a58ae00e40f1ae6e9c5c8`. This is the authorized focused runtime only; it is not a full-suite/build/browser/CI result and does not constitute independent review.


## Evidence file

`query580-b9-lock-order-repair-luna.md`

# #580 batch 9 move lock-order repair

- Worktree: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Before: adverse candidate `b6284aef2454a3f296307660b6dfac15258eb9ca`
- Repair commit / exact head: `a817ff9160a1f805b8ba7293f8d2fcafd9eeb931`
- Worktree after commit: clean.

## Repair

In `apps/api/src/task/controllers/move-task.ts`, the move controller now calls the existing `lockTaskRowForIdentity(tx, identity, taskId)` and returns the established 404 `Task not found` when it yields no task. This retains the identity-scoped task `FOR UPDATE` lock while removing the premature source-project `FOR SHARE` that `lockTaskAndAssertProjectLiveForIdentity` took before destination preflight.

The malformed destination branch remains unchanged: it checks source liveness with the existing `assertProjectStillLive` share lock before rejecting the NUL-containing destination. For valid destinations, source preflight remains an unlocked reach/liveness read, followed by the existing sorted source/destination project-lock sequence. The atomic task-plus-assets repository statement, controller transaction, errors, and post-commit event behavior are unchanged. No test assertion was weakened or changed.

I inspected the other changed task-controller callers of `lockTaskAndAssertProjectLiveForIdentity`, plus `create-task` and `bulk-update-tasks`. Those paths do not take the early source-project share lock and then acquire the move controller's later sorted source/destination project locks. The multi-project lock-order regression was isolated to `move-task`'s use of the helper.

## Checks and limits

- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json` — passed.
- `pnpm exec biome check apps/api/src/task/controllers/move-task.ts` — passed after import ordering/formatting.
- `git diff --check` — passed.
- No PG/test/runtime/build/browser/Docker/CI command was run on `a817ff91`; root must inspect this exact new head and prepare the next authorized PG window. The interrupted `b6284aef` PG18 log and cleanup report remain historical adverse evidence and were not overwritten or rerun.

Commit diff is limited to one existing production file: `apps/api/src/task/controllers/move-task.ts` (5 insertions, 6 deletions). No new file, test path, module, documentation, or configuration was added.


## Evidence file

`query580-b9-project-fixture-repair-luna.md`

# Query #580 batch 9 project fixture repair

Date: 2026-10-16 (Asia/Yangon)
Author/fixer: GPT-6 Luna (not an independent reviewer)

## Exact head and scope

- Worktree: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Parent candidate: `fe8c0792a49cc170ff9453fd11545f3157dac9a7`
- New exact head: `c20871657a881db0e66701d7751a12f3352df6d5`
- Commit: `c2087165` (`test(task): seed canonical project reach`)
- Changed files: only existing `tests/api-integration/task-repository.test.ts` and `tests/api-integration/task-repository-moves.test.ts`; no new paths or production edits. Net candidate path scope remains the existing 26 paths.

## Fixture corrections

- Both shared `seed()` functions now create the projects, grant each intended actor canonical `grantWorkItemProjectAccess` on each project that actor should reach, and only then call `resolveIdentity`. The move suite gives actor A grants on its p1/p2 projects and actor B a grant on foreign-owner `pb`; actor A remains unable to reach `pb`. Task repository suite’s actor receives project grants on p1 and p2. This removes reliance on workspace admin membership as project reach.
- The positive asset-move regression now moves the task row to p2 with scoped `updateTaskRow` inside the same transaction before calling asset reassignment. It asserts the task and addressed asset both reach p2, while the other task’s asset stays at p1.
- The destination revocation regression now proves the destination project was reachable through the repository before revocation, asserts exactly one canonical destination membership was deleted, and verifies repository lookup denies it afterward. It then verifies task number/project and asset project remain unchanged after the denied task and asset mutation attempts.
- Foreign project `pb` remains an explicit cross-identity case: it is seeded under B’s identity grant while A is scoped only to A’s own p1/p2. Existing negative assertions remain unchanged.

## Validation and boundaries

- `pnpm exec biome check --write tests/api-integration/task-repository.test.ts tests/api-integration/task-repository-moves.test.ts`: passed (no formatting fixes needed).
- `pnpm exec biome check tests/api-integration/task-repository.test.ts tests/api-integration/task-repository-moves.test.ts`: passed, two files.
- `git diff --check`: passed.
- `pnpm --filter @taskdesk/api typecheck`: exit 0 across API, permissions, API tests, RLS prototype, and approvals E2E type projects.
- No PostgreSQL, integration tests, runtime, build, browser, Docker, CI, push, PR, or central-doc changes were run. This was fixture-only repair; the tests remain unexecuted pending root authorization.


## Evidence file

`query580-b9-required-result-atomicity-repair-luna.md`

# Query 580 batch 9 required-result atomicity repair (author)

Candidate `7b9ea329f9680ca353163b18aafa9d07a946262f`, branch `codex/query-ownership-580-b9-current`, based on root-reviewed clean `0e3ac4c546978489e88eb8516f66e3beba039db6`.

## Production changes

- `insertTaskActivity` now returns its `INSERT … SELECT … RETURNING id` row. `updateTaskTitle` requires that row and throws inside the same transaction if identity scope made the required activity insert affect zero rows. The existing task UPDATE then rolls back and no title event is published.
- `updateTaskDueDate` now throws on a missing scoped task update inside the transaction, after reminder clearing. A refusal therefore rolls back the reminder DELETE and cannot publish the due-date event.
- Bulk status, priority, assignee and due-date updates now check `updateTaskRowReturningId` before enqueuing an event or reporting a successful item. A missing row throws the existing opaque 404 inside the item transaction; the existing per-item catch returns a failed item. Relation refresh stays after transaction success. Delete and label handling were left alone; in particular, label ON CONFLICT remains an intentional idempotent no-op.
- Removed unused new unscoped `lockLiveProjectRow`; the identity-scoped variant remains. No additional repository or identity framework was added.

## Regression coverage added

In existing `tests/api-integration/task-title-activity.test.ts`, added deterministic persisted-grant revocation cases:

1. An actual PostgreSQL AFTER UPDATE trigger barrier confirms the task UPDATE reached its post-write trigger; another connection deletes and verifies the project grant, then releasing the trigger lets the required activity INSERT SELECT return zero. Assertions require the 500 failure, rolled-back title and version, no activity, and no title event.
2. An actual BEFORE DELETE reminder trigger barrier pauses reminder clearing. Another connection deletes and verifies the project grant before release; the reminder DELETE statement completes, the next task UPDATE is refused, and assertions require rollback of the reminder deletion, unchanged due date/version, no activity, and no due-date event.
3. Four bulk cases cover status, priority, assignee and due-date. Each test wrapper invokes the actual repository SQL and waits only after the real pre-write context read has returned positively: context lookup for priority/due-date, actual scoped column lookup for status, and actual assignable user-name lookup for assignee. The test then deletes the persisted project grant and verifies it is gone before releasing the controller. These wrappers introduce deterministic interleaving only; they do not fake query results. Each case asserts failed item outcome, zero updates, unchanged target field and version, no mutation/relation-refresh events, and no activity.

The tests use only the existing integration test file and existing Vitest/PostgreSQL facilities. No test runner or exported test seam was added.

## Validation

Passed:
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json`
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json`
- `pnpm exec biome check apps/api/src/task/repository.ts apps/api/src/task/controllers/update-task-title.ts apps/api/src/task/controllers/update-task-due-date.ts apps/api/src/task/controllers/bulk-update-tasks.ts tests/api-integration/task-title-activity.test.ts`
- `git diff --check`
- Caller search confirmed no remaining production `lockLiveProjectRow` or task-repository `findProjectWorkspaceId` export/use.

No integration/unit tests, PostgreSQL, Docker, build, browser, CI or runtime command was run on this changed head. In particular, the new real-database interleaving cases are unexecuted pending root review and a separately authorized focused PostgreSQL window. Prior c13 and 0e3 native focused results remain historical evidence for their own exact heads and do not validate this candidate. Candidate is committed and clean; this is author remediation, not independent review.


## Evidence file

`query580-b9-reset-driver-error-envelope-repair-luna.md`

# Query #580 batch 9 — reset lock SQLSTATE envelope repair (author report)

- Worktree: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Exact base: `5f478f1ee880332688e80c74f8731f4049ad711f`
- Exact candidate: `09e3a531ce2f5213dfda1a49c7dd8fc2a3fe5609`
- Commit: `fix(test): inspect wrapped postgres lock errors`
- Changed paths: `tests/api-integration/helpers/database.ts`, `tests/api-integration/database-reset-locks.test.ts`.

## Repair

The reset helper now recognizes SQLSTATE `55P03` on the actual LOCK TABLE NOWAIT statement by walking an error's nested `.cause` chain as well as its own `code`. The catch remains lexically limited to that one lock statement, so only a driver SQLSTATE of 55P03 is converted to the lock-unavailable retry outcome. The original Drizzle wrapper is retained in `ResetLockUnavailableError.original` and then as the exhausted error's `cause`; nonmatching errors still propagate unchanged.

The regression observer assertions now follow `.cause` to verify the actual driver code instead of assuming the wrapper exposes `code` at top level. No simulated errors were added; the real PostgreSQL cases remain unchanged and still use separate-client locks. The prior `5f478f1` report remains authentic as an unrun candidate report; this commit repairs its identified preflight defect.

## Checks

- Read installed Drizzle ORM 0.45.2 `errors.js` and source map. `DrizzleQueryError` preserves the original driver Error in `.cause` and has no top-level SQLSTATE.
- Offline construction probe using installed `DrizzleQueryError` and a PostgreSQL-shaped error `{code: "55P03"}` produced wrapper `DrizzleQueryError`, top-level code `null`, cause code `55P03`, and classifier result `true`.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json` — passed.
- Scoped Biome check on both changed files — passed.
- `git diff --check` — passed.
- Worktree clean at candidate SHA.

No PostgreSQL, integration test, runtime, build, or browser execution was performed. The lock regression still requires root preflight before its first PG run. Prior `1d1527bf` adverse runtime and all prior correction reports remain unchanged.


## Evidence file

`query580-b9-reset-lock-acquisition-repair-luna.md`

# Query #580 batch 9 — integration reset lock-acquisition repair (author report)

- Worktree: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Exact base: `1d1527bf90f3951a1cdbe9100fc062eaee607b02`
- Exact candidate: `5f478f1ee880332688e80c74f8731f4049ad711f`
- Commit: `test(api): avoid reset lock-order deadlocks`
- Changed paths: `tests/api-integration/helpers/database.ts` and new `tests/api-integration/database-reset-locks.test.ts`.

## Change

`resetTestDatabase` still performs its full-schema `TRUNCATE ... RESTART IDENTITY CASCADE`, with the existing `SET LOCAL session_replication_role = replica` semantics and test-database guard. Before truncate it now runs `LOCK TABLE <catalog-derived quoted table list> IN ACCESS EXCLUSIVE MODE NOWAIT` in that same transaction. A 55P03 from that exact lock statement aborts the transaction (releasing any partial locks), then the helper retries the lock acquisition with bounded delays (10, 25, 50, 100 ms; five attempts total). Only that lock statement's 55P03 is classified for retry; unrelated guard, lock, truncate, migration, and other failures propagate. On exhaustion the helper throws `Could not acquire all test-reset table locks after 5 attempts`, preserving the underlying PostgreSQL error as `cause`.

The existing helper accepts an optional test-only `onLockUnavailable` observer for deterministic coverage; it runs after transaction rejection/rollback and receives the actual 55P03. No production module, event bus, test runner configuration, or product behavior was changed.

The new existing-harness integration path has three cases:

1. Hold an actual `ACCESS SHARE` lock on `workspace` from a separate PostgreSQL connection. The reset helper reports a real 55P03 after the lock statement fails. While the reader remains held, prove the earlier alphabetic `account` lock is available `ACCESS EXCLUSIVE NOWAIT` (partial locks were released), prove seeded data remains, release the reader, and verify the retry performs the full reset, clears workspace/user rows, and restarts the real `submission.number` sequence.
2. Change the test URL to a non-test database name and prove the existing guard error propagates without calling the lock-unavailable observer.
3. Keep the actual workspace reader lock held through the full retry budget, observe five real 55P03 results, and prove clear bounded-exhaustion error plus preserved seeded workspace row.

## Checks and limits

- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json` — passed.
- `pnpm exec biome check --write tests/api-integration/helpers/database.ts tests/api-integration/database-reset-locks.test.ts` — formatting applied.
- `pnpm exec biome check tests/api-integration/helpers/database.ts tests/api-integration/database-reset-locks.test.ts` — passed.
- `git diff HEAD^ HEAD --check` — passed.
- Worktree clean at candidate SHA.
- The new PostgreSQL integration test was **not run**. No PG/runtime/test/build/browser command was run for this repair, pending root review.

The preceding `1d1527bf` focused run remains 161/162 with a workspace-rbac reset deadlock. Preserve its runtime result unchanged. The read-only attribution addendum corrects my earlier claim of concurrent file resets: the integration config serializes files, and the native record shows TRUNCATE versus a task/project reach SELECT. Its statement shape matched `userCanReachTask` most closely, but PID/caller/relation-OID origin was not proven. This repair addresses the demonstrated administrative reset-vs-reader lock cycle without asserting which reader was PID 87 or changing a product/event-bus path.


## Evidence file

`query580-b9-workspace-context-consolidation-luna.md`

# Query 580 batch 9 workspace-context consolidation (author)

The Ordinary B finding on c13e5149 was that `findProjectWorkspaceId(executor, projectId)` read a project workspace by ID without `ResolvedIdentity` or current project reach. Its only two TaskDesk callers were the bulk task update controller and task assignee controller. Both already held the resolved identity and a task row scoped through the identity-aware lock.

On candidate `0e3ac4c546978489e88eb8516f66e3beba039db6` (branch `codex/query-ownership-580-b9-current`), I removed the unscoped duplicate repository export and changed those two callers to use the existing `findProjectWorkspaceContext(executor, identity, projectId)`. That existing query joins the workspace row and constrains the project by `currentProjectReachPredicate`; caller behavior remains: bulk returns the existing 404 if context is missing or workspace mismatches, and assignee update returns the existing 404 if context is absent before membership validation. No other module or identity framework was changed.

Added one direct repository integration regression to `tests/api-integration/task-repository.test.ts`: an actor resolves their granted project, cannot resolve a populated project belonging to another workspace, the foreign actor can resolve their own project (positive control), and the original actor loses the lookup after their project membership is revoked. Existing unrelated shared inline legacy SQL and its non-task callers remain untouched.

Static validation passed:
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json`
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json`
- `pnpm exec biome check apps/api/src/task/repository.ts apps/api/src/task/controllers/bulk-update-tasks.ts apps/api/src/task/controllers/update-task-assignee.ts tests/api-integration/task-repository.test.ts`
- `git diff --check`

No unit/integration test, PostgreSQL, runtime, build, browser, Docker, CI, or SQL probe was run for this delta. The existing c13e5149 focused result (13 files / 212 tests) is retained as evidence for its prior source and does not validate this changed head. New head is clean and committed as `0e3ac4c546978489e88eb8516f66e3beba039db6`; this is author remediation, not independent review.


## Evidence file

`query580-b9-write-admission-result-repair-luna.md`

# Query #580 batch 9 — write admission/result repair (author report)

- Worktree: `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`
- Branch: `codex/query-ownership-580-b9-current`
- Exact base before this repair: `7c461e2bdedf18cc96860cd77eb28927e8ce883e` (accepted-main 806 composition retained)
- Exact candidate: `1d1527bf90f3951a1cdbe9100fc062eaee607b02`
- Commit: `fix(task): classify bulk write refusals atomically`
- Files changed: `apps/api/src/task/repository.ts`, `apps/api/src/task/controllers/bulk-update-tasks.ts`, `tests/api-integration/task-title-activity.test.ts` (one existing integration test path extended).

## Repair

Bulk delete now treats a zero-row scoped DELETE after the retained task lock as a required-write refusal and throws `404 Task not found` inside the item transaction. It can no longer commit as a successful zero-count item.

Added task-repository operations for label add/remove which classify three outcomes: `refused`, `unchanged`, and `changed`. Each operation uses one SQL statement with an eligible-task CTE whose target task, workspace correlation, and current `taskProjectReach(identity, executor)` predicate are evaluated alongside the mutation. The final SELECT reads the eligible CTE and the data-modifying CTE result together. For add, an eligible task with no returned inserted label is the existing-label / `ON CONFLICT DO NOTHING` idempotent case; no eligible task is refusal. For remove, an eligible task with no returned deleted label is the absent-label idempotent case; no eligible task is refusal. Controller effects are queued only for changed results; refusal throws before transaction commit and before the per-item success result. Existing label resolution/name locking and output shape remain in place.

The regression matrix adds persisted project-grant revocation after a real positive project-context lookup for delete-present, add-missing, and remove-present. It asserts failed item outcome, unchanged task version/title, unchanged label rows, no activity, and no captured events. A positive idempotency test covers add when the same task label already exists (the insert hits `ON CONFLICT DO NOTHING`) and remove when the task label is absent; both succeed with `updatedCount: 0`, preserve rows, and emit no events.

## Checks

Executed:

- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json` — passed.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json` — passed.
- `pnpm exec biome check --write apps/api/src/task/repository.ts apps/api/src/task/controllers/bulk-update-tasks.ts tests/api-integration/task-title-activity.test.ts` — formatting/import fixes applied.
- `pnpm exec biome check apps/api/src/task/repository.ts apps/api/src/task/controllers/bulk-update-tasks.ts tests/api-integration/task-title-activity.test.ts` — passed.
- `git diff HEAD^ HEAD --check` — passed.

Integration tests, PG, runtime tests, build, browser, and CI were not run, per authorization. The preceding B2 GPT-6 Sol BLOCK remains preserved as the source of this repair; this author report is not an independent review or runtime evidence. Root review is required before a focused runtime window.


## Current machine binding

**Reviewed head:** `09e3a531ce2f5213dfda1a49c7dd8fc2a3fe5609`


## Hosted static/unit repair and bounded independent confirmations

Old8b99 static and unit failures remain adverse. The formatter changes only three argument-list wraps; the unit fixture now supplies canonical session identity and retains real middleware/repository query construction and immediate NUL refusal. Prior full28-path review and focusedPG165 remain bound to09e3; current delta has separate independent ordinary and security confirmation. Current full hosted runtime/image acceptance remains mandatory.

## Evidence file

`b9-809-format-author-luna.md`

# PR 809 scoped Biome formatting repair

Published worktree `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2` was clean at before-commit SHA `8b99d2f6b7b3cefaafb7e5a7e91e390dfa39eecc`. Only `apps/api/src/task/index.ts` was formatted, using the installed repository formatter: `pnpm exec biome format --write apps/api/src/task/index.ts` (exit 0; “Formatted 1 file … Fixed 1 file”).

The delta consists of the formatter's argument-list line wrapping at the two `findProjectWorkspaceContext` calls and one `findAssetIdByObjectKey` call. The TypeScript token words are unchanged: `git show --format= --word-diff=porcelain --word-diff-regex='[^[:space:]]+' HEAD -- apps/api/src/task/index.ts` emitted only `~` whitespace records and no added/deleted word records. `git diff --check` passed.

One verification detail: the specifically requested `git diff -w --exit-code -- apps/api/src/task/index.ts` did **not** return empty; it displayed these line-wrap changes and exited 1 because Git's `-w` comparison retains line breaks. The whitespace-token word diff above confirms there are no non-whitespace token changes, but this does not satisfy a literal empty `git diff -w` condition.

The scoped PR 809 TypeScript Biome check passed (exit 0):

`pnpm exec biome ci --diagnostic-level=error <the 28 changed TypeScript paths from gh pr view 809>`

Biome reported “Checked 28 files … No fixes applied.” The exact 28 paths were the 21 `apps/api/src/task/**` files and 7 listed integration/unit test TypeScript files from the PR. No tests, typecheck, PostgreSQL, build, browser, or runtime checks were run.

Committed on the existing branch as `e00f99005c01a6d1f4f672b3bca6fe38c9ab8acf` (`style(api): format scoped task route arguments`). Commit changes only `apps/api/src/task/index.ts` (6 insertions, 3 deletions); worktree is clean. No push or PR changes were made.

## Evidence file

`b9-809-permission-fixture-author-luna.md`

# PR 809 permission-test fixture repair

Before SHA: `e00f99005c01a6d1f4f672b3bca6fe38c9ab8acf` (the prior formatter-only commit retained). After SHA: `791f9703b93b38049476eb27bf91d9f270fb2987`. Only `tests/api/task/require-task-permission.test.ts` changed in this repair.

The hosted API unit run at PR head `8b99d2f6b7b3cefaafb7e5a7e91e390dfa39eecc` had 871/872 tests pass; the failing case expected 200 but got 500. The preserved raw log is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/809-8b99-unit-failure.log` (SHA-256 `2ec938870936e6f57e9418dbdc44ebb70532e594f9971b021430c1004a0c35a2`). Its stack shows `resolveIdentity` dereferencing absent mocked schema at `resolve-identity.ts:650`, called by newly wired `resolveCallerIdentity` in `requireTaskAssigneePermission`. The prior unit fixture mocked the database with `schema: {}` and had no authenticated identity fixture.

The test now creates its session identity through canonical `resolveIdentityFromFacts`, mocks the request-boundary `resolveCallerIdentity` to return that valid identity, and asserts it receives the route's `user-1`. The repository mock supports the inner-join query shape of the genuine `findTaskAssigneeId` reach predicate and still records that the query is reached. The malformed NUL-ID case continues to assert immediate 400 with no repository query or handler call, and now also asserts identity resolution is not invoked. No production code or authorization behavior changed.

Focused verification passed at the after SHA:

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/task/require-task-permission.test.ts` — exit 0, 1 file / 2 tests passed.
- `pnpm exec biome ci --diagnostic-level=error tests/api/task/require-task-permission.test.ts` — exit 0, 1 file checked, no fixes.
- `git diff --check` — exit 0.

No broader unit run, PostgreSQL, browser, build, or CI run was performed. This is an author fixture repair, not independent review. The worktree is clean; no push or PR update was made.

## Evidence file

`b9-809-791f-ordinary-a-luna.md`

# Bounded Ordinary A review — PR 809 formatting and permission-test fixture repair

- **Reviewer/model:** GPT-6 Luna, independent review context; I did not author the two repair commits.
- **Exact current candidate:** `791f9703b93b38049476eb27bf91d9f270fb2987`
- **Prior full source/security-reviewed head:** `09e3a531ce2f5213dfda1a49c7dd8fc2a3fe5609`
- **Scope:** bounded review of the two formatting-only route changes and the `require-task-permission` unit-fixture repair, retaining prior full-candidate conclusions and the fresh 09e3 full Sol CLEAR as reported. I read the original hosted failure and both repair notes. Worktree is clean.
- **Verdict:** **CLEAR for this bounded delta; no blocking finding.** No production authorization logic changed. This review does not independently re-review the full source scope or replace the prior fresh full Sol review.

## Findings

The two `task/index.ts` edits only reflow three argument lists for `findProjectWorkspaceContext` and `findAssetIdByObjectKey`. The author’s word-token comparison records whitespace-only changes. The literal `git diff -w` did retain those line-wrap differences, so it was not empty; this is accurately disclosed in the author note. Inspection of the exact diff shows the argument sequence and expressions unchanged, with formatter-style line breaks only. No behavior change is indicated.

The permission unit-test repair addresses the hosted failure mode directly: the prior fixture returned `schema: {}` and lacked identity context, while the real middleware now resolves a caller identity before invoking the repository reach query. The revised test builds a valid session `ResolvedIdentity` through the canonical `resolveIdentityFromFacts` constructor and mocks only the request-boundary `resolveCallerIdentity` to return it. The well-formed request asserts exactly one resolver call with the request context and `user-1`, completes the actual `requireTaskAssigneePermission` control flow, and confirms the repository query delegate is reached. The mock query-builder implements the `select/from/innerJoin/leftJoin/where/limit` chain used by the actual `findTaskAssigneeId` repository query; it returns no assigned task so the unchanged-assignee path continues. The fixture does not change production identity/auth behavior or bypass the middleware’s resolver seam.

The NUL-byte regression remains present and non-skipped. It still asserts a 400, no repository query and no handler call, with the added assertion that identity resolution is also skipped. The production guard remains before resolver/repository work. Its comment correctly explains this is defense in depth for the standalone middleware because the paired real route’s workspace-access path already rejects NUL IDs; it does not inflate the defect into a live route vulnerability.

The original hosted head `8b99d2f6b7b3cefaafb7e5a7e91e390dfa39eecc` failure (871/872 tests, 1/2 in this file) and stack trace to missing mocked identity context are preserved in the author note. The author reports the focused repaired unit file passed 1 file / 2 tests and Biome at `791f`; I did not execute tests, typecheck, lint, build, PG, runtime or browser checks.

The added review-ledger document keeps its evaluated source binding explicit at `09e3a531` and states that its 28-path full Sol review, focused PG result, and outstanding hosted/full-suite/image/browser acceptance refer to that source review. The formatting and fixture commits do not alter production task behavior or invalidate that prior source review. The source-level full Sol CLEAR remains the existing evidence, not a claim that this bounded unit fixture was separately security-reviewed by Sol.

## Limits

No blocker in the two-commit delta. This report is not a merge/PR approval, hosted-run verification, runtime claim, or another full-panel review. The previous full review and exact-head gate status remain as recorded by the orchestrating session.

## Evidence file

`b9-809-791f-security-61-sol.md`

# PR 809 — bounded independent security confirmation

**Model:** GPT-6.1 Sol
**Model provenance:** The conductor confirmed this context's explicit dispatch as `model: gpt-6.1-sol`, `fork_turns: none`, `reasoning_effort: high`. This records requested routing. No served model/version fingerprint is independently exposed to this context or the conductor; none is invented.
**Role/context:** Fresh independent bounded security reviewer, `/root/b9_809_791f_fixture_security_sol`.
**Reviewed head:** 791f9703b93b38049476eb27bf91d9f270fb2987
**Comparison base:** 09e3a531ce2f5213dfda1a49c7dd8fc2a3fe5609, the prior full independent security-reviewed source.
**Checkout:** `/Users/heinthura/.codex/worktrees/q580b9-current/Ticketing.v2`.
**Independence:** I did not author, direct or remediate this candidate. This is a fresh context without inherited author turns. No child agent was spawned.
**Verdict:** **CLEAR for this bounded security confirmation.** No blocking or additional non-blocking security finding in the inspected delta. The prior full 28-path source review remains the baseline; this report does not claim a new full review or authorize merge.

## Scope and history inspected

Read actual AGENTS.md, active mission, agent workflow/review and evidence-reuse rules, CLAUDE.md and the applicable CI security-review scope. Read the complete prior full report `query580-b9-09e3-full-security-61-sol.md`, both author repair reports and current independent Ordinary A report `b9-809-791f-ordinary-a-luna.md` (CLEAR). Inspected actual current fixture, middleware, pure identity mapper, request identity adapter, repository lookup, executor and current persisted reach predicate; read the production call sites around the formatting edits and the preserved original API-unit failure stack/summary.

Confirmed exact HEAD and a clean checkout. Per-commit raw history from the comparison base contains exactly:

- `8b99d2f6b7b3cefaafb7e5a7e91e390dfa39eecc`: adds only mode-100644 `docs/07-planning/security-reviews/query-ownership-task-580.md`, 1,251 additions and zero deletions.
- `e00f99005c01a6d1f4f672b3bca6fe38c9ab8acf`: only `apps/api/src/task/index.ts`, six additions and three deletions, wrapping three argument lists.
- `791f9703b93b38049476eb27bf91d9f270fb2987`: only `tests/api/task/require-task-permission.test.ts`, 38 additions and one deletion.

The base is an ancestor; no intervening merge, revert, rename, mode change or other path appears. Read-only byte extraction found all 33 named source reports in the private evidence directory and each complete report's bytes present unchanged in the committed ledger. The ledger retains original heads, adverse findings and causal limits, and binds its existing full review to 09e3. Byte equality verifies publication preservation, not independence by itself; the conductor remains responsible for tracing dispatch origins. Nothing in these later commits changes review/gate policy or waives a check.

## Security conclusions

The production edit only splits `tx, identity,` onto separate lines at two `findProjectWorkspaceContext` calls and one `findAssetIdByObjectKey` call. Exact diff and whitespace-token word diff show no added/deleted non-whitespace words. By direct syntax inspection, callee, argument sequence, expressions, commas and enclosing statement/control flow are identical; no automatic-semicolon or string/template change is involved. I did not run an AST parser or a formatter. No production authorization, tenancy, write-result or event behavior changes.

The fixture now obtains a valid staff session identity from the canonical pure `resolveIdentityFromFacts`, with no instance-admin grant and empty workspace/team memberships, rather than fabricating a ResolvedIdentity object. It mocks the existing `resolveCallerIdentity` request boundary, leaving the actual `requireTaskAssigneePermission` and `findTaskAssigneeId` control flow in place. The real lookup still builds its task-ID plus persisted project-reach predicate; the database delegate gains join methods needed to construct that query. Returning an empty result preserves the intended no-existing-assignee continuation path. This narrow unit fixture does not prove live identity loading, SQL authorization or assignment permission decisions, and does not purport to.

The positive case retains HTTP 200, query-reached and handler-reached assertions and additionally requires exactly one resolver call with the route's `user-1`. Per-test mock reset prevents stale resolver calls or implementations from contaminating the NUL case. The malformed-ID test retains HTTP 400, no query and no handler, and now requires no resolver call. The real NUL guard remains before JSON-body, resolver and repository work. No test was skipped, focused, deleted or weakened; no capability or scope check is removed from production.

The old hosted API-unit failure genuinely reached the unprepared identity loader (`resolve-identity.ts:650`) through this middleware and returned 500; its summary remains 120/121 files and 871/872 tests passing. The repair addresses that fixture boundary rather than suppressing the response assertion. The old failed checks remain failed historical evidence, not waived gates.

The prior full independent Sol CLEAR at 09e3 continues to cover its actual 28-path source scope, including structural write-admission/result, move atomicity and reset-lock repairs. This bounded pass found no production semantic change invalidating those source conclusions. It does not independently re-review all those paths or erase the inherited #773 shared-helper gap and prior unproven reader attribution.

## Checks, limits and next gate

Performed only read-only Git/source/evidence inspection and a read-only Python byte-containment comparison. No tests, runtime, CI checker, formatter, typecheck, package installation, PostgreSQL, Docker, image build/boot, browser, GitHub action/mutation, remediation, Git/ref write, push or merge occurred. The sole write is this new private evidence report, created exclusively with mode 0600.

The author report records the focused repaired fixture result at 791f as one file/two tests passing plus scoped Biome success. Those are author results read from the report, not independently executed tests or a new full-suite result. The earlier 09e3 focused PostgreSQL ten-file/165-test result retains its original source binding. This pass makes no current hosted rollup, full-suite, image/health, browser/SIT, stage-completion or merge-readiness claim.

Required GitHub status checks must be green on the exact current candidate after the ordinary/security evidence is published through the normal flow. Old 8b99 failures are not waived, and this source confirmation does not substitute for new current mandatory CI.


## Current machine binding

**Reviewed head:** `791f9703b93b38049476eb27bf91d9f270fb2987`
