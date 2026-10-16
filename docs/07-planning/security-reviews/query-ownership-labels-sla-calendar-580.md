# Query ownership: recovered label, SLA and calendar slice (#580, original #786)

This note preserves authentic historical, adverse, author, runtime and independent review reports. Reports apply only to their named source/scope and are not silently promoted to current approval. Original Sonnet reports cover2f87, not the newer tests or identity repair. The original source/PR786 remains preserved. The isolated recovery adds current resolved-identity SQL reach and awaited materialization; acceptance remains partial580, with the structural checker unwired. No stage/whole-feature/N1 or release/SIT claim.

Current publication source and final import security verdict are bound after the reports, once actually available. Three independent ordinary reviews at6b are retained with authentic scope/model errata; fresh strong e31 delta ordinary and FULL independent GPT-6.1 Sol clear its minimal hidden-copy deletion/event repair. The original6b security BLOCK remains adverse. Runtimee31 is11files117/117/native0, separately attributed operator proof. Current accepted-main composition preserves all19 own source/test blobs; later hosted acceptance is still mandatory. Early setup failures/query failures/missing-role fixture failures and all corrections remain historical.



---

## Authentic report: 786-ordinary-a-sonnet.md

Source SHA-256: `d3ade49d8458d3716c57a44682c3a159d2035299e96a8d4506a720294784502e`. Original bytes follow.

# PR #786 ordinary review A (#580 batch 5: label repository, sla-policy/service-calendar awaited results)

**Reviewed head:** 2f87c275faef88585314a616ca5f85194d60e36d
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed with `gh pr view 786` (branch codex/query-ownership-580-b5). Single commit on b0 (`c4477744`): 14 files, +769/-305. Scratch worktree removed afterwards.

## Behaviour preservation
- `label/repository.ts` (333 lines) holds every label statement; the controllers keep transaction boundaries, lock order, `publishEvent` and error mapping (D1). Statement by statement against the old controllers: task-with-workspace and task-in-workspace lookups (the second keeps `projects.workspace_id = ?` in SQL), project-workspace lookups (`findProjectWorkspaceId` on `tx`, same unlimited select), task-label and workspace-label inserts with the same `ON CONFLICT` targets (the workspace insert keeps `WHERE task_id IS NULL`, `taskId: null` now set inside the repository), the two `findFirst` re-reads, label snapshot (`limit 1`), `lockLabelRow` (`FOR UPDATE`), id delete/update returning one row, task copies with task (inner join, `isNotNull(task_id)`), copy task ids, `lockTaskLabelCopies` (`ORDER BY task_id, id FOR UPDATE`, filtered by the supplied task ids), bulk delete/update by ids, and `listLabelsByWorkspaceId` (definitions always, task-bound labels only when the project is in the reachable ids; empty reach means definitions only). All identical in predicates, columns, ordering and return shape.
- Advisory family lock: `lockWorkspaceLabelNames` and `WORKSPACE_LABEL_NAME_LOCK_NAMESPACE = 4_007` moved verbatim (sorted unique names, `pg_advisory_xact_lock(4007, hashtext('<workspace>:<name>'))`); `label-name-lock.ts` is now a two-line re-export so importers outside the module keep working; the param type is `Executor`. Call sites keep the same position before label/task/project row locks.
- sla-policy/service-calendar: five exported read functions and `getCalendarWorkspace` become `async` and `return await` their statement, so they return awaited arrays rather than builders. No query text changed. Typecheck passing means no caller chained on the old builder.

## Commands (CI=true Testcontainers, targeted)
- Label, SLA and calendar integration files (9 files incl. the two new ones, label-bulk-rename-race, label-detach, cascade race): 64 passed. API `typecheck`: exit 0. `biome ci` on label, sla-policy, service-calendar: clean.
- Mutations on `label/repository.ts` (each reverted with `git checkout`, tree clean): family lock made a no-op: 1 fails (bulk rename race). `findTaskInWorkspace` drops its workspace predicate: 1 fails (repository test). List ignores reach: 1 fails. Workspace-label insert loses `WHERE task_id IS NULL`: 5 fail. `getPolicyWorkspace` returns the builder again: 1 fails (awaited-results test). Survivors: names no longer sorted in the lock (30/30), `ORDER BY task_id, id` removed from `lockTaskLabelCopies` (30/30), `FOR UPDATE` removed from `lockLabelRow` (30/30).

## Findings
Blocking: none.
Non-blocking:
1. The deadlock-avoidance properties (sorted lock names, ordered copy locking, `FOR UPDATE` on the label row) are verbatim moves but unprotected by any deterministic test (three survivors). They are concurrency properties that are hard to assert; a cheap guard would be a test that inspects the SQL issued (order of `pg_advisory_xact_lock` arguments for two names given in reverse order, presence of `for update`) or a comment in the repository noting these are load-bearing and verified by review.
2. `findTaskWithWorkspace` intentionally has no workspace predicate (documented: used before the workspace is known); fine, but callers must compare workspaces afterwards (create-label does).

## Residual risk
Low: statement-for-statement move with passing neighbour suites; the only risk is the three untested lock-order properties above.

**Verdict:** APPROVE


---

## Authentic report: 786-ordinary-b-sonnet.md

Source SHA-256: `46bb5229d03f028e736bc4f96600f008ed8fd04ce0eece3af994ec664c3d8438`. Original bytes follow.

# Ordinary review B, PR #786 (#580 batch 5: label repository; await sla-policy and service-calendar results): contract conformance

**Reviewed head:** 2f87c275faef88585314a616ca5f85194d60e36d
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Scope:** the commits after batch 0 (#764, c32ab85f): 2f87c275 (the batch; this branch carries batch 0's first two commits but not the later docs-alignment commit c32ab85f). Reviewer A's report was not read.
**Method:** scratch detached worktree at the exact head (removed afterwards); read-only; targeted tests only.
**Contract read:** apps/api/src/database/executor.ts and the "Query ownership" rules in coding-standards.md, monorepo-layout.md and multi-tenancy.md (batch 0): D1 (transactions are orchestration; statements inside go through repository functions that take the handle), D2 (raw SQL and fragments in scope), D3 (repositories recognised by name; no wildcard), Executor first when always in a transaction, optional last with `executorOrDefault` when both, awaited results, explicit tenant parameters instead of forIdentity.

## Commands and counts
- `gh pr view 786 --json headRefOid` = head above. 14 files (+769/-305). New `label/repository.ts` (+333); eight label controllers reduced to repository calls; `label-name-lock.ts` now re-exports the lock; `sla-policy/repository.ts` and `service-calendar/repository.ts` normalised.
- Remaining statement-like hits in `label/controllers/*.ts`: only `db.transaction(...)` openers (D1).
- Targeted tests, `CI=true vitest run --config vitest.integration.config.ts`: label-repository (new), repository-awaited-results (new), label, label-detach, label-bulk-rename-race, label-workspace-cascade-task-delete-race, plus neighbours: 8 files, **60 tests passed**.
- Merge probes: clean against #785 and #788.

## Contract conformance
- **Executor usage:** correct and consistent: `lockWorkspaceLabelNames(tx: Executor, ...)`, `findLabelSnapshot(executor, id)`, `lockLabelRow`, `deleteLabelById`, `updateLabelById`, `updateLabelsByIds`, `lockTaskLabelCopies` take the executor first; `findLabelById(id, executor?)` is optional-last with `executorOrDefault`; read-only list helpers with no transactional use take none. The advisory family lock is a label statement and lives in the repository (D2 raw SQL in scope), with namespace 4_007 unchanged and a re-export in `label-name-lock.ts` so `work-item/hierarchy-lock` and `task/bulk-update-tasks` keep their import path (a shim that adds no query; it does make work-item code depend on the label repository, which is the right direction).
- **Tenant semantics preserved:** statements moved verbatim. The by-id mutators (`updateLabelById`, `deleteLabelById`, `deleteLabelsByIds`) and `findTaskWithWorkspace` carry no workspace predicate, exactly as the removed controller code did (I diffed `update-label`: the original also updated by id, with workspace consistency enforced through the family lock and the reach middleware). `findTaskWithWorkspace` is annotated "(no workspace predicate)". Under the batch-0 convention ("takes the tenant explicitly and puts it in the predicate") these id-only mutators are a conscious carry-over, not a regression; hardening them (accept `workspaceId` and filter) would be a good follow-up but would change semantics and belongs outside a move-only batch.
- **Awaited results:** the 5 sla-policy exports and the one service-calendar export become `async` with `return await`; the new `repository-awaited-results.test.ts` asserts they resolve to rows (not builders). This closes the pre-existing builder-return shape from #580's own rule. Transactions and lock order in the label controllers are unchanged (tests, including the bulk-rename and cascade-delete race tests, pass).
- **Naming:** `label/repository.ts` follows the existing `<feature>/repository.ts` convention; function names are verb-first and tenant-qualified where they take a workspace.

## Can the final `check:queries` be honest with these shapes?
Yes for label, sla-policy and service-calendar: all statements are in `repository.ts`; no allowlist or baseline added; controllers only call repository functions and open transactions. Residual for later batches: the branch lacks the standards-alignment commit (c32ab85f) that #785 and #788 carry, so merging order should put #764 first (as the PR says) and rebase this one on it.

## Findings
**Blocking:** none.
**Non-blocking:** (1) id-only mutators as above; (2) rebase on final #764 for the docs alignment; (3) `Reviewed by` in the PR body still says "pending", to be filled before merge.

**Verdict:** APPROVE


---

## Authentic report: query786-10f209b9-focused-pg-result-luna.md

Source SHA-256: `2507eb458d17c1eb78876d141e44169f5af12220369a84112d97f0076226e773`. Original bytes follow.

# Query 786 focused PG18 runtime result (Luna)

Date: 2026-10-16

## Exact candidate and execution

- Candidate: `10f209b9a309861ce70223f0639d6ae6e2727f80` on `codex/786-label-await-scope-repair-luna`.
- Worktree: `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`; operator verified exact SHA and clean status before activation.
- One invocation, using the existing canonical Vitest integration config and the 11 authorized files: label-repository, label-lock-order, label, label-detach, label-bulk-rename-race, label-workspace-cascade-task-delete-race, repository-awaited-results, sla-policy, service-calendar, service-calendar-usage-delete, project-reach-reads.
- Native Vitest exit code: 1; timeout 600s, not timed out; duration 46.331s; CI absent. Actual count: 11 files (10 passed, 1 failed); 117 tests (116 passed, 1 failed).
- Evidence directory: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query786-runtime-10f209b9/` (directory 0700 and evidence files 0600).

## Environment and cleanup

The owned container was `query786-10f209b9-pg`, exact ID `5bccbf1e75ca996d701fad80607c9f6cc2c326520b3cef6a708998f384c42d22`, with candidate/run/task labels recorded in the receipts. Docker inspect verified exact `/var/lib/postgresql` tmpfs config, no overlapping conflicting mount, one dynamically assigned `127.0.0.1` binding; container `/proc/mounts` independently showed `/var/lib/postgresql` mounted as `tmpfs`. PostgreSQL readiness passed before the test invocation. Pre- and post-run container/volume/network inventories were exact (23/109/7 both sides; no added or missing IDs). The exact owned ID was stopped with return code 0, `test.env` was removed, and the native full log is mode 0600. No source was changed during the run. No rerun, build, browser, push, or PR action occurred.

The execution-copy runner is derived from the validated attempt-3 operator with only base evidence directory, candidate SHA, and unique container name changed; exact diff and SHA-256 are saved in `operator-configuration-only.diff` and the source file in this evidence directory. The earlier attempt-3 adverse run (95/108, 13 failures) and attempts 1/2 setup-only evidence remain unchanged. This current run supersedes neither history nor prior evidence.

## Sole current failure

`tests/api-integration/label-repository.test.ts:195` expects `listLabelsByWorkspaceId` for `identityWorkspaceOnly` to return the workspace definition but receives `[]`; every other selected test passes. Relevant setup: `seedTwoWorkspaces` seeds the target workspace's `admin` workspace role; the failing test manually inserts a second `workspaceUserTable` row with role `member`, then resolves identity. The current `currentWorkspaceReachPredicate` admits a legacy workspace-role grant only when the corresponding role is canonical in that workspace (`workspace_role` row with `isSystem = true`), and the fixture does not seed a `member` role row in the target workspace. The repository predicate intentionally delegates workspace definitions to that existing current-workspace contract. This points to an invalid fixture membership rather than evidence that membership alone should bypass canonical role validation; that classification is an inference from the existing predicate and fixture. The spec in `docs/01-architecture/rbac.md` says definitions are decided by workspace membership and label permission. Root should reconcile whether “membership” here means a canonical workspace membership/role (consistent with identity scope) and, if so, correct the fixture by seeding the canonical role row. Do not loosen current identity SQL based solely on this failing fixture.

No source fix or test rerun is authorized by this runtime grant. Root review/decision is required before further runtime activation.

## Review status

Any “approved” wording in previous author reports means root authorized implementation actions only; it is not independent source clearance. This identity-scoped repository work still requires three fresh independent ordinary GPT-6 Luna reviews and a full independent GPT-6 Sol security review on the exact frozen candidate before it can clear review gates.


---

## Authentic report: query786-6b-current-review-packet.md

Source SHA-256: `a344ae8c6ca900de6ec97c2cd21c43e8bac19048ca14668ba24940e4e94147ba`. Original bytes follow.

# Query786 current FULL ordinary/security review packet

Exact frozen clean candidate `6b4bc0d141db8b128afb7eb5855b5bd8e7bf7133` oncodex/786-label-await-scope-repair-luna; worktree `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`. Actual acceptedmainbase `f77f89d9a6eb862cbf9d601c7868ca009b04d5e1`. Normalcomposition parents `5bb7687a86f1e775c164e2dcc3e581ae394f8f6b` andacceptedf77; noresolutions; all19ownsource/testblobsunchanged from5bb, allotherpathsmain. Source preservesoriginal7500e06c8fab34bb61d4d00151d4e4af74b7a4b6/2f87c275 andq580b5worktree untouched. This is NEW fullcurrent19pathpanel: originalSonnet2f87reports are provenance, NOTcurrentapproval. Root/author/advisers disqualifiedindependentreview. ThreefreshLunaordinary contexts thenfreshFULLexplicitgpt-6.1-sol required; noordinarycountdowngrade.

Owning contractaccepted764/785: resolvedcredentialidentity/currentSQLreach oncrossorgcontent andDML-returning, minimalbootstrapfacts only, transactionExecutor ownership, awaitmaterializedresults, noexportquerybuilders. Readcodingstandards/multi-tenancy/securitymodel/labelpolicy/RBAC/SLA/calendar/actualdecisionlog. No newcapability/table/schema/route/dep/env. labelindexthreadsresolveRequestIdentity includingkeyfacts; repoactorcontentusescurrentWorkspace/ProjectReachPredicate. Preserveactualstoredkeysubset/ownerauthority gate, genericrefusal/statusmasking, workspacevsprojectcontent. Customerdirectinternalhelper nowreturnsitsorganisationprojectlabel butNOTstaffworkspaceDefinition, actualstaffroute401unchanged. Verify semanticsindependently, notrootclaim.

Source19paths:11label source(controller8,index,repo,name-lockshim), SLA/calendarrepo2, andtests label-repository, label-lock-order, repository-awaited-results, project-reach-reads plus2existingAPIlabelmocktests. Relevantall-copyfamilybehavior isintentional: workspacefamilyrename/delete includeshiddenprojectcopies. Preservefamilyadvisorynamespace4007/sortedunique names/familybeforerow/taskId-labelIdordering/sametx/projectlocks/atomicwrite+eventaudience/DTOshape. Internal minimalfamilyfacts shouldnotbeaccidentallyactorfiltered. HONEST residual:deleteLabelsByIds stillfull-row RETURNING idset because existingtask.label_deleted eventpayload usesrows; assesscontract/authority/outputscope independently, notautomaticinternalexemption; producerN1 remainsopenbeforecheckerwiring. FindProjectWorkspace(s) bootstrap IDfacts. SLA/calendarsixhelpersnormalizeawaitedresults, don'tchangepolicycalendarsemantics.

ActualcurrentfocusedPG11files117/117, native0/37.139s, CIunset, exacttmpfsparent/procproof/dynamic127/readiness/ownedcleanup23containers109volumes7networks verifiedbyroot rawlog+nativeJSON+inventories. Readquery786-6b4bc0d-focused-pg-result-luna.md andrawquery786-runtime-6b4bc0d/vitest.full.log asneeded; this isauthor/operatorruntime, notreviewerexecution. Includeslabeldirectqueries/API/detach/idempotency/lockorder/renamerace/cascadetaskdeleterace/projectreach/SLA/calendar/read/delete. Nofullhosted/image/browser/currentmergeyet.

AUTHENTIC adversehistory: firsttwo setup-onlyfailed beforeANYtests (PG18wrongtmpfsmount; thenengineMountsarrayomission), exactcleanup; correctedexistingoperatorstrongmetadata+actual/proc/tmpfsmount proof, notnewframework/gatewaiver. ffe63ec3 realPG95/108(13fail/5files), alias mismatch RQBlabelTable vsphysicalnestedlabelpredicate+deletedprojectliveness+customerdirectfixture. Structuralrepair ordinaryselect/from/await two namequeries, currentLabelReach project.deletedAtISNULL preservingarchivedreads; customerexactvisiblepositive+hidden/definitionnegative/public401. Transient2a855f7 exportedquerybuilder/testSQLmirrorseam wasrootBLOCKED/removedbeforefinalPG ascontractviolation;10fasyncinlineexportsnone. Its2passingunitcases areOLDremovedtestproof, notcurrentcoverage.10frealPG116/117, missingcanonicalmemberrole fixture.5bbtestONLYpreservesexplicitmissingrole[]deny, seedscanonicaldefaultRolePayloads.memberisSystemrow,re-resolvesnonnullidentity/assertsexacttargetworkspace-membergrant/zeroprojectgrants, requiresdefinitiononlypositive. Final6bactual117PASS. Alladversefilesunchanged/private, no skippedtests/calibration/TZchanges.

ReadFULLauthorreports query786-current-recovery-author-luna.md, query786-insert-selection-preflight-correction-luna.md, query786-current-source-repair-proposal-luna.md, query786-source-repair-author-luna.md, query786-source-repair-followup-luna.md, query786-canonical-workspace-role-test-luna.md; sourcecurrentwins overstaleauthorwording. Prior 'approved' meansrootimplementationauthorization ONLY, notindependentreview; sourcewasnotindependentlyclearedyet. Rootpacketisnotapproval.

ReviewerREADONLYsource/Git/cheapchecks; NO PG/Docker/browser/build/commit/ref/GitHubmutation orchildren. Caninspectfullsource/testingcontracts andactualqueryconstruction; testsrunonlyifrootexplicitnewwindow (nonegiven), attributeoldproofhonestly. Unique0600report exacthead/base/model/context/independence/scope/actualcommands/tests/findings/verdict/limits. BROWSERVERIFICATIONBLOCKED(noUIchanged, notN/Aindependentreview). Reportconcreteblockers/correctrisk. No PR/push/currentfullCI/image/whole580/phaseclaim. StructuralcheckerremainsUNWIRED, no baseline/exception expansion. Futureaccepted-mainimportrequiresappropriatecurrentheadclearance, do notapprovefuturechanges.


---

## Authentic report: query786-6b-full-security-61-sol.md

Source SHA-256: `bec9f63a780a73cb4cb515a55d987f78b39056e711db7b6ae58f654d11bff5e7`. Original bytes follow.

# Query786 — full independent security review

**Model:** GPT-6.1 Sol
**Reviewed head:** 6b4bc0d141db8b128afb7eb5855b5bd8e7bf7133
**Comparison base:** f77f89d9a6eb862cbf9d601c7868ca009b04d5e1
**Dispatch/context:** explicitly assigned GPT-6.1 Sol full security reviewer, fresh context `/root/query786_6b_full_security_sol`; no author/fixer/adviser/ordinary-review role. Served-model fingerprint beyond the assigned platform model is unavailable. I did not materially author, direct or remediate this candidate. Ordinary A/B/C reports and B scope/C model errata were read as evidence, not adopted as conclusions.
**Verdict:** BLOCKED — one security-contract blocker. No current HTTP/WebSocket disclosure was demonstrated. This distinction does not waive the accepted repository scope contract.

## Blocking finding S1 — hidden-copy DELETE returns full content without resolved identity/current reach

`apps/api/src/label/repository.ts:474–478` exports `deleteLabelsByIds(executor, ids)` with only an ID-set predicate and unprojected `.returning()`. Its actual caller, `controllers/delete-label.ts:109–135`, intentionally includes copies from projects outside the initiating actor's reach and transports every returned label row through the transaction result into `task.label_deleted`. These rows include label content and timestamps, not solely mutation/bootstrap IDs.

The accepted contract in coding-standards.md (Repositories own queries and Query ownership / Tenant scoping), multi-tenancy.md (Query scoping), and security-model.md §5 expressly requires a repository query that can return cross-organisation data to take resolved identity and apply current caller reach in its statement. It does not limit that rule to HTTP serialization. A workspace may contain projects belonging to different customer organisations. An ID selected under the family operation establishes the intended mutation set, but it is not the required resolved-identity content predicate. The event catalogue records `task.label_deleted` as inherited/unmapped, with no accepted full-content payload exemption. The existing event shape is implementation provenance, not authority to relax the newer query contract.

The source makes the concern concrete: a workspace label administrator without reach to a same-name task-copy project deletes the workspace definition; the family operation correctly deletes that hidden copy, then the repository returns its full content to the controller and the general in-memory event bus. The sole current matching WS subscriber uses project/task IDs and drops `label`. The endpoint returns only the requested definition. Therefore this review does NOT allege a present wire leak or incorrectly classify the intentional collateral deletion as unauthorized. It identifies a present content-returning query that violates the literal current contract; a future consumer is not necessary to establish that violation. Leaving producer N1 open for later checker work does not satisfy it today.

Required resolution: preserve all-copy deletion, locks and per-project invalidation, while removing unnecessary hidden content from the returned deletion facts/event payload, or obtain an explicit accepted contract disposition for this precisely bounded internal content producer through the normal policy/spec flow. Do not apply actor project reach to the family mutation and leave hidden copies behind. A narrowly projected deletion result supplying only the IDs actually used by the current consumer is the obvious implementation direction to assess with the event-contract owner. Verify the resulting event/output shape and hidden-family behavior with real regressions and review the changed exact head. This report does not authorize a policy exception or prescribe a new capability/schema.

## Full current candidate assessment

Inspected all 19 changed paths: 11 label source paths (eight controllers, router, repository, name-lock shim), two SLA/calendar repositories, four integration test paths and two API mock test paths. Inspected current identity-scope repository, request resolver/key subset projection and owner checks, permission middleware, executor contract, task/project lock helper, event bus and matching WS consumer. Read the packet, ordinary reports/errata, author repair/provenance reports and focused PG operator result; consulted canonical AGENTS, active mission, workflow/provider adapter, current status/decision entries, coding standards, multi-tenancy/security/RBAC, settings/work-item/calendar and event contracts. Source and actual predicates take precedence over packet summaries.

Apart from S1, no additional blocking security finding was identified in that scope:

- Every router handler now passes resolved request credential identity; API-key facts include the authenticated owner ID, enabled state and actual stored permission subset. The resolver rejects mismatched owner/disabled/missing key facts. Existing middleware still checks key narrowing and the caller's real workspace role; reach does not manufacture capability authority.
- Actor-facing label content reads, locks and single-row writes apply current SQL workspace/project reach. Task content correlates the label's workspace to its task's project and excludes deleted projects; archived reads remain allowed. Staff workspace definitions and project copies use distinct reach branches. Customer repository reach stays organisation-bound and does not admit workspace definitions; the public staff-route customer 401 assertion remains.
- Task/workspace insert-select predicates check actual current reach and same workspace. RETURNING only supplies inserted ID, followed by a scoped row read on the same executor. Name lookup queries now use ordinary select/from composition, avoiding the previous relational alias issue. No public builder seam remains.
- Project-to-workspace helper projections are minimal ID facts. Family scans/locks return narrow IDs, intentionally include hidden same-workspace/name copies, and are consumed under family/task/project/label locking. Update propagation returns no hidden content. The S1 distinction is specifically the full content RETURNING, not a blanket objection to these internal facts or collateral mutations.
- Family advisory namespace remains 4007, names are sorted/deduplicated, and locking precedes family/row mutation. Task locks are sorted, projects are sorted/deduplicated by their helper, copy locks sort task/id, and stale family/name/task assignment snapshots are rejected. Caller transactions own the executor; the repository neither commits nor escapes the transaction. Family mutations and copy selection remain in that transaction. Events remain post-commit with project/task audiences; no new durable-event guarantee is claimed for the inherited emitter.
- SLA/calendar changes only await/materialize the existing statements; no predicate, policy or calendar semantic delta is introduced. Native Promise tests exercise resolved result shapes. Canonical-role fixture repair retains the missing-role deny case and checks the real member grant/zero project grants before the definition-only positive case. Customer, foreign workspace, stale project membership, deleted/archived project, idempotency and family lock assertions remain meaningful. Removed query-builder tests are not current coverage.

## Commands, evidence and limits

Read-only commands actually used: `cat`, `sed -n`, `rg`/`rg --files`, `nl -ba`, `git status --short`, `git rev-parse HEAD`, `git diff --name-only`, `git diff --stat`, full and targeted `git diff <base> HEAD`, and `git diff --check <base> HEAD`. HEAD matched the stated candidate; worktree status was clean and diff whitespace check passed. A few initial combined output requests were truncated and were followed by narrower source/contract reads; no inference of a missing file's contents was made (the SLA contract is named sla.md, not sla-policies.md).

No tests, PG, Docker, build, browser, Git/ref/source/GitHub mutation or children were run by this reviewer. The operator report records exact-head focused PG 11/11 files, 117/117 tests, native exit 0; that is operator evidence, not my execution or independent reproduction. Earlier 95/108 and 116/117 adverse runs remain historical, and setup-only failures are not passing tests. I did not independently validate the operator container harness or inventories. BROWSER VERIFICATION: BLOCKED — no UI paths changed and no browser execution was authorized.

The structural checker is still unwired and N1 remains open; neither is an exemption. This is a full source security review of this current 19-path candidate, not a lightweight composition confirmation, approval of future heads, current hosted CI/image/boot acceptance, merge authorization, whole #580 completion or a phase finalizer. Do not merge this candidate under this security verdict until S1 is resolved and the current resulting head receives its required independent review.


---

## Authentic report: query786-6b-ordinary-a-luna.md

Source SHA-256: `eb31d750cee652471f9a6d83a5840e8a4a4241a96d9f644d2dbc5a6b3731b5da`. Original bytes follow.

# Query786 ordinary review A — 19-path label/current-SQL candidate

**Model:** GPT-6 Luna (assigned ordinary-review context)
**Role:** Fresh independent ordinary reviewer A
**Context:** `/root/query786_6b_ordinary_a_luna`
**Candidate:** `6b4bc0d141db8b128afb7eb5855b5bd8e7bf7133`
**Base:** `f77f89d9a6eb862cbf9d601c7868ca009b04d5e1`
**Branch/worktree:** `codex/786-label-await-scope-repair-luna` at `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`
**Independence:** I did not author, direct, or remediate the candidate. I read the author handoffs and prior failure reports as provenance, then inspected the frozen source and contracts directly. This is one of three required ordinary reviews; it is not a security review or approval of later changes.

## Scope checked

Reviewed all 19 changed paths at the exact candidate against the query-ownership, multi-tenancy, security-model, RBAC, SLA, calendar, label-family and decision-log contracts. Focused on request-identity/current SQL reach, workspace/project content boundaries, bootstrap reads, API-key owner identity flow, DML predicates and returning projections, family mutation internals, lock ordering, transaction boundaries, event payload path, and awaited repository results. Compared the candidate diff to the stated accepted base and read the focused PG evidence only as author/operator evidence, not as my own execution.

## Commands and execution

Read-only inspection commands actually run:

- `cat` of the current-review packet and the six listed author reports.
- `cat` of `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/07-planning/status.md`, `docs/07-planning/decision-log.md`, relevant coding/multi-tenancy/security/RBAC/label/SLA/calendar contracts.
- `git status --short --branch`
- `git diff --stat <base>..<candidate>`
- `git diff --name-only <base>..<candidate>`
- `git show --stat --oneline --no-renames <candidate>`
- `git diff <base>..<candidate> -- apps/api/src/sla-policy/repository.ts apps/api/src/service-calendar/repository.ts`
- `git diff --check <base>..<candidate>` (passed)
- `nl -ba`/`sed`/`rg` inspections of label repository/controllers, identity predicates/resolver, WS event consumer, event catalogue, and response schema.

No tests, builds, PostgreSQL, Docker, browser, or application runtime were run, per the review assignment's read-only restriction. The author/operator's current focused PostgreSQL result (117/117) is attributed to that operator and exact candidate; I did not reproduce it. Browser verification is blocked by scope: no UI changed and no browser use was authorized.

## Findings

1. **Low, non-blocking — full-row RETURNING on hidden-copy family deletion has a larger internal projection than the observed consumer needs.** `deleteLabelsByIds` returns every column from `label` (`apps/api/src/label/repository.ts`), and `deleteLabel` carries those full rows into `task.label_deleted` payloads (`apps/api/src/label/controllers/delete-label.ts`). I traced the only current subscriber in `apps/api/src/ws/index.ts`; it derives project/task IDs and emits `TASK_LABEL_UPDATED`, and does not read or serialize the `label` object. Thus I found no present cross-project disclosure path: the full rows remain in the internal event object and the websocket sends only the scoped invalidation. However, the candidate's own query-ownership/data-minimization intent favors returning only fields actually required, while a future event consumer could make these hidden-copy rows observable. This is a bounded non-blocking projection concern, not a finding that the intentional all-copy cascade is incorrectly actor-filtered. The established family contract requires processing hidden-project copies, so applying actor reach to these internal scans would be wrong. No evidence found that a reduced projection is already the accepted event contract, so I do not treat it as a blocker to this candidate.

2. **Low, non-blocking — repository header repeats a sentence.** The opening comment in `apps/api/src/label/repository.ts` repeats the statement about transaction boundaries/lock order/event mapping. No behavior impact.

## Review conclusions

The actor-facing label content queries and single-row DML carry current request identity predicates. The task label predicate includes same-workspace consistency, current project reach, and `project.deleted_at IS NULL`; archived projects remain readable. Workspace definitions use current workspace reach, while customers do not gain workspace-definition reach. Route handlers resolve current request identity including the authenticated API-key owner's user ID and stored capability subset before passing it to controllers; the resolver rejects owner mismatch and disabled keys. Task/workspace inserts use reach-filtered `INSERT ... SELECT`, return the inserted ID, then fetch the actor-visible row under the same executor. Bootstrap project/workspace reads are ID facts used after reachable task resolution and locks; they are not content responses.

The family scan/lock/update/delete helpers intentionally omit actor reach to preserve cross-project workspace-family rename/delete semantics. I verified they are called within the same transaction after the family advisory lock, enumerate by workspace/name, take task/project locks in sorted order, then lock label copies in task/id order. The copy operations are constrained to IDs obtained from those scans and retain the existing project audience for delete notifications. This is consistent with the documented family contract, not an authority leak to the caller.

`deleteLabelsByIds` still performs full-row `RETURNING`; assessment is recorded above rather than assuming internal helpers are categorically exempt. The only current WS consumer drops the label object, so I found no current response or event delivery that leaks hidden copy content. The controller returns the workspace definition row to its authorized caller, as the legacy route contract does.

SLA/calendar changes only make repository helpers `async` and `await` the same statement; I found no predicate, policy, or calendar behavior change. The removed historical query-builder test seam is absent from this candidate; I do not count its prior evidence as current coverage. The reports' earlier alias bug and soft-deleted-project gap are addressed in current source, and the canonical-role fixture correction remains test-only.

**Verdict: CLEAR WITH FINDINGS.** No blocking ordinary correctness or contract finding found in the inspected source. The low projection concern and duplicate comment are recorded. This verdict covers only the exact SHA and source scope above. It does not satisfy the other two ordinary reviews, required full GPT-6 Sol security review, exact-SHA hosted checks, browser evidence (if applicable), or any merge/phase acceptance gate.


---

## Authentic report: query786-6b-ordinary-b-luna.md

Source SHA-256: `b42bf2012835bd9cf8eff7bef3f8823ab67314fda563c44bcb54ecaf32115408`. Original bytes follow.

# Query #786 current candidate — independent ordinary review B

- **Candidate:** `6b4bc0d141db8b128afb7eb5855b5bd8e7bf7133`
- **Base:** `f77f89d9a6eb862cbf9d601c7868ca009b04d5e1`
- **Branch/worktree:** `codex/786-label-await-scope-repair-luna`, `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`
- **Model/tier:** GPT-6 Luna, fresh ordinary reviewer context B of the required three.
- **Independence:** I did not author, fix, direct, or advise on this candidate. The author and orchestrator packets/reports were treated as provenance and test evidence, not as review conclusions. I independently inspected the current source and contracts.
- **Verdict:** APPROVE for this ordinary-review tier, with no blocking findings. This is not merge authorization, a Sol security review, or stage completion.

## Scope actually reviewed

Full 19-path diff against the stated accepted base: all label controller/repository/index/name-lock changes, both SLA/calendar repository changes, and all seven changed/new tests. Particular attention went to transaction and executor ownership, family locks and row-lock order, copy-family behavior on hidden projects, SQL reach and authority, full-row `RETURNING`, internal workspace/project lookup helpers, event payload/audience flow, and the result shapes of converted SLA/calendar functions. I also inspected the current identity reach predicate and applicable work-item, workspace/project settings, multi-tenancy, coding-standard, SDLC, and workflow contracts. Current-staff and customer identity behavior was assessed independently.

## Review evidence and commands

Inspected the full review packet at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query786-6b-current-review-packet.md`, the canonical repository instructions and workflow docs, and source at the exact frozen head. Read the full label repository and changed controllers, route middleware/handlers, the current project/workspace reach predicates, the SLA/calendar diff and their call sites, and the label/reach integration test assertions. Read author reports as historical/test-provenance evidence only.

Commands run (read-only/cheap):

- `git status --short`, `git rev-parse HEAD`
- `git diff --name-only f77f89d9a6eb862cbf9d601c7868ca009b04d5e1..HEAD`
- `git diff --stat f77f89d9a6eb862cbf9d601c7868ca009b04d5e1..HEAD`
- `git diff f77f89d9a6eb862cbf9d601c7868ca009b04d5e1..HEAD -- apps/api/src/sla-policy/repository.ts apps/api/src/service-calendar/repository.ts`
- `git diff --check f77f89d9a6eb862cbf9d601c7868ca009b04d5e1..HEAD`
- `git show -s --format='%H%n%P%n%s' HEAD`
- targeted `rg` searches for repository callers, family helpers, hidden/customer reach assertions and relevant decision-log/spec references.

`git diff --check` passed; the worktree was clean and HEAD matched the candidate. No tests, build, PostgreSQL, Docker, browser, source/ref mutation or remote operation was run by this reviewer. The packet's operator-owned focused PG11 result (117/117) was noted as existing evidence, not represented as my execution. Browser verification is **BLOCKED** for this review context; no UI source is among the 19 paths.

## Findings

No blocker found in the reviewed candidate.

- Actor-facing label reads and single-row writes use the resolved request identity and include current workspace/project reach in SQL. The task-copy predicate excludes soft-deleted projects, retains archived-project reach, and separates workspace definitions from project-bound copies. Route handlers resolve identity for the actual credential (including API key and impersonation facts); middleware still enforces the route's workspace permission/reach policy. The inspected customer identity branch only reaches project-bound content through its organisation predicate, while workspace definition access remains staff-only; the customer-facing route continues to reject the unsupported staff-label API path.
- The internal all-copy helpers deliberately see same-workspace hidden-project copies so workspace label-family rename/delete remains coherent. Their result is used only after the initiating workspace definition was reached/authorized, within the same transaction, after a workspace/name advisory lock and canonical task/project/label locking. Family mutations remain scoped by workspace, name and selected IDs; I found no path to another workspace or organisation. Delete propagation's full-row `RETURNING` is confined to IDs gathered/row-locked by that internal family operation and supplies the existing per-task deletion event payload. It is a real broad result shape, but in this flow it does not expose the hidden rows to an API response or use their data to widen mutation authority. The internal helper must remain a deliberate producer candidate for the still-open structural query checker; it is not a blanket exemption.
- Advisory locks use the stable namespace and deduplicated sorted names before row locks. The reviewed workspace cascade and task mutation paths follow the intended ordering; task/project locks are sorted and copy rows lock in `(task_id, label_id)` order. Mutations and copy propagation stay in one caller-owned transaction. I found no lock-order inversion or un-awaited executor composition in the reviewed flows.
- Event emission remains after commit and uses the task/project audience for each affected copy. Assign/unassign and workspace-family delete retain their event kind and data shape; idempotent existing-copy behavior does not emit a duplicate assign event. I found no event emitted for an uncommitted or cross-workspace row.
- Converted SLA/calendar helpers resolve their query before returning. Current callers await the helpers and destructure/materialize the same row arrays they consumed when the thenable query builder was returned; no caller chains additional Drizzle clauses or depends on builder-only methods. Calendar paging, policy validation/versioning, audit and event behavior are unchanged by the diff.

## Limits and remaining gates

The packet reports the earlier adverse evidence (13 failures/5 files on the first substantive PG run; a later 116/117 fixture failure) and the subsequent repair history. I did not reclassify those runs or claim to rerun them. The packet's current focused Postgres evidence is author/operator evidence. `N1` and the structural query checker remain open/unwired, so the internal all-copy producer is not checker-validated; this review does not claim otherwise. Two other fresh ordinary reviews and the required independent full GPT-6 Sol pass remain mandatory. No hosted/image/browser/PR/current-merge or phase-finalizer evidence is claimed.


---

## Authentic report: query786-6b-ordinary-b-scope-erratum-luna.md

Source SHA-256: `140659430507a8470b0afad2aec3dce57200467bae0fba034745fc70daab9dd5`. Original bytes follow.

# Query #786 ordinary review B — factual scope erratum

- **Candidate:** `6b4bc0d141db8b128afb7eb5855b5bd8e7bf7133`
- **Base:** `f77f89d9a6eb862cbf9d601c7868ca009b04d5e1`
- **Original report:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query786-6b-ordinary-b-luna.md` (preserved unchanged)

I verified the exact `git diff --name-only` at the frozen candidate against the stated base. It contains 19 paths: 13 source paths (11 label source paths and two SLA/calendar repository paths) and six test paths:

- `tests/api-integration/label-repository.test.ts`
- `tests/api-integration/label-lock-order.test.ts`
- `tests/api-integration/repository-awaited-results.test.ts`
- `tests/api-integration/project-reach-reads.test.ts`
- `tests/api/label/assign-and-unassign-label.test.ts`
- `tests/api/label/delete-label.test.ts`

The original report's phrase “all seven changed/new tests” was an incorrect count. The intended review scope and verdict are unchanged: all 19 paths were reviewed, and the ordinary-review verdict remains APPROVE with no blocking findings. This erratum does not represent a new review round or new source/runtime/CI evidence.

Verification command: `git diff --name-only f77f89d9a6eb862cbf9d601c7868ca009b04d5e1..6b4bc0d141db8b128afb7eb5855b5bd8e7bf7133`; observed HEAD was the exact candidate and the worktree was clean.


---

## Authentic report: query786-6b-ordinary-c-luna.md

Source SHA-256: `c47c23e68f65908520855cc39335e5063c1fd3b96b7c7600d910d8daafa38291`. Original bytes follow.

# Query786 candidate 6b ordinary review — reviewer C

- **Verdict:** CLEAR for the ordinary review tier at this exact source head; one non-blocking residual noted below. This is not security clearance, future-head approval, CI/image/runtime acceptance, merge authorization, or whole-workstream/stage completion.
- **Model/context:** GPT-6.1 Luna, fresh independent reviewer context C.
- **Independence:** I did not author, direct, advise, or remediate this candidate. This review was performed read-only in the assigned clean worktree.
- **Candidate:** `6b4bc0d141db8b128afb7eb5855b5bd8e7bf7133`, branch `codex/786-label-await-scope-repair-luna`.
- **Comparison/accepted base:** `f77f89d9a6eb862cbf9d601c7868ca009b04d5e1`; merge base confirmed at that exact SHA. Candidate is a normal merge with parent `5bb7687a86f1e775c164e2dcc3e581ae394f8f6b` and accepted base, no conflict resolution.
- **Worktree:** `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`, clean at start and end.

## Scope inspected

Read the full assigned takeover packet, canonical `AGENTS.md`, agent workflow, `CLAUDE.md`, coding standards, current status snapshot, decision log, multi-tenancy, security model, RBAC, data model, settings hierarchy, SLA and service-calendar contracts. Inspected all 19 changed paths, full current label repository/controllers, relevant identity-scope predicates, and the changed/new integration and unit tests. Special focus: source conservation, actor and customer reach, current membership checks, label family hidden-copy propagation, lock ordering, insert-select result shapes, deletes/event payloads, stale snapshots, and the canonical member role fixture.

## Commands and evidence

Read-only commands run in the frozen worktree:

- `git status --short --branch`
- `git rev-parse HEAD`
- `git diff --stat <base>...HEAD`
- `git diff --name-only <base>...HEAD`
- targeted `git diff --unified=...` for label repository/controllers and changed tests
- `rg` searches for repository statements, reach conditions, fixtures, and affected call sites
- `git diff --check <base>...HEAD`
- `git diff --name-status 5bb7687a86f1e775c164e2dcc3e581ae394f8f6b..HEAD`

No tests, build, PostgreSQL, Docker, browser, Git/ref mutation, or hosted action was run by this reviewer. I did not rely on the author’s runtime result as my test execution. Packet evidence records the author/operator’s separate focused run at 11/11 files and 117/117 tests; it remains attributed to that operator.

## Findings

No blocking ordinary correctness issue found.

- The 19 changed source/test paths shown in the packet are exactly the current feature diff against accepted base. The merge has no conflict-resolution delta. Against the other composition parent, only four unrelated pre-existing realtime paths differ; the label/SLA/calendar source is conserved from that parent. This supports the packet’s source-conservation claim for the current 19-path integration.
- Actor-facing label lookups, lists, locks, delete/update, and inserts include `currentLabelReach` or a current workspace/project reach predicate in the SQL statement. Project-bound content requires current project reach and a non-deleted project. Archived projects remain visible, as the existing route test now asserts. Workspace definitions require staff workspace reach. Customer identity can reach organisation-bound project labels through the repository, while the public staff route continues to return 401; the changed reach test checks both behaviors.
- Task bootstrap reads return only task ID, project ID, and workspace ID and require current project reach. Project workspace resolution after the task/project locks is a minimal scope fact, not content. It is followed by live-project checks and a same-workspace comparison before writes.
- The two `INSERT ... SELECT ... ON CONFLICT DO NOTHING` helpers include source workspace/task plus current reach in the `SELECT`; they return the row only after a reach-scoped lookup. Conflict paths remain idempotent and do not return another workspace’s row.
- Update/delete snapshots are revalidated under locks. Workspace-family propagation intentionally includes hidden project copies, but its internal enumeration returns only label/task/project identifiers; it locks rows in deterministic order and mutates only IDs selected for the locked same-workspace/name family. Advisory locks serialize the family operations before row locks.
- `deleteLabelsByIds` still uses full-row `RETURNING` for the task deletion event payload. The direct endpoint returns only the requested workspace definition, and the hidden-copy rows are consumed by the existing event publication flow. I found no direct-response disclosure or authority bypass introduced by this change. This is a non-blocking residual for the separately open producer/output-scope review; it should not be treated as covered by a blanket internal-helper exemption.
- The final test fixture now proves the missing canonical member-role case denies first, installs the canonical system role payload, re-resolves identity, asserts the member grant and zero project grants, and has a workspace-definition-only positive case. The public customer 401, cross-workspace negative, hidden-project negative, archived-project positive, stale membership, and exact insertion/query behavior are represented in current tests. The prior removed query-builder mirror tests are not counted as current coverage.
- Service-calendar and SLA edits are limited to awaiting/materializing existing repository queries; inspected call sites and the native-promise test additions match that contract.

## Limits and residual risk

This is source review only from my context. I did not run tests or independently inspect the runtime harness. The actual current focused PostgreSQL result and its authentic adverse-history are recorded in the packet/operator evidence, not by me. The structural query checker remains unwired as stated in the packet. Browser verification is blocked/not applicable to this API-only change: **BROWSER VERIFICATION: BLOCKED (no UI changed; no screen opened).**

The remaining full-row `RETURNING` from family deletion deserves the pending N1 producer/output-scope disposition before treating the wider repository boundary objective as complete. No blanket exemption is justified by this review.


---

## Authentic report: query786-6b-ordinary-c-model-erratum-luna.md

Source SHA-256: `a9b760f64390cc900ff47c1da2a423a4f68fe8ae4e445989c259e8e200d8ab15`. Original bytes follow.

# Query786 reviewer C — model provenance erratum

This erratum corrects only the model label in `query786-6b-ordinary-c-luna.md`. The original report is preserved unchanged.

- **Correct assigned model:** GPT-6 Luna, dispatched explicitly as `gpt-6-luna`.
- The original report's wording “GPT-6.1 Luna” was an unsupported variant label and should not be used as provenance.
- **Served-model fingerprint:** unavailable to this reviewer context; no more specific served variant is asserted.
- **Review scope and verdict:** unchanged. The ordinary review remains clear at exact candidate `6b4bc0d141db8b128afb7eb5855b5bd8e7bf7133`, with the same non-blocking residual and limits recorded in the original report.


---

## Authentic report: query786-6b4bc0d-focused-pg-result-luna.md

Source SHA-256: `c2413c17e0e9d2e0764187ca575430aea81b486c41fa20bee26fbebf068d5302`. Original bytes follow.

# Query 786 focused PG18 runtime result (Luna)

Date: 2026-10-16

## Candidate and provenance

- Exact candidate SHA: `6b4bc0d141db8b128afb7eb5855b5bd8e7bf7133` on `codex/786-label-await-scope-repair-luna`.
- Worktree: `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`; clean at preflight and post-cleanup.
- Composition parents: `5bb7687a86f1e775c164e2dcc3e581ae394f8f6b` and accepted `f77f89d9a6eb862cbf9d601c7868ca009b04d5e1` (PR #805). Candidate verified to retain author label repository source and the canonical role fixture correction.
- One canonical Vitest invocation selected 11 existing integration files: label-repository, label-lock-order, label, label-detach, label-bulk-rename-race, label-workspace-cascade-task-delete-race, repository-awaited-results, sla-policy, service-calendar, service-calendar-usage-delete, project-reach-reads.
- Actual result: 11/11 files passed, 117/117 tests passed. Native exit code 0, not timed out, 37.139 seconds, 600-second bound; `CI` absent in child.
- Unique evidence directory: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query786-runtime-6b4bc0d/` (directory 0700; evidence files 0600).

## Container and cleanup evidence

The unique owned PostgreSQL 18 container `query786-6b4bc0d-pg` had exact ID `faa1f2e9a4261dad9045d7bf63d73d12f380f29598be6d1b6ef73f064c1380bf` and matching task/run/revision labels. Inspect validated `/var/lib/postgresql` tmpfs configuration, no overlapping conflicting mount, and exactly one dynamically assigned loopback port binding. Container `/proc/mounts` showed exact mountpoint `/var/lib/postgresql` with fstype `tmpfs`; readiness passed before tests.

Pre/post inventories matched exactly: containers 23, volumes 109, networks 7, with no added or missing IDs. Cleanup stopped the exact owned ID with return code 0 after capturing logs and precleanup inspect; temporary `test.env` was removed. The full native Vitest output and receipts are retained privately. The execution-copy operator differs from validated attempt 3 only in evidence base directory, SHA, and unique container name; exact diff and both SHA-256 values are saved in `operator-configuration-only.diff` and provenance is visible in `run-focused-tests.py`.

## Prior evidence and review status

The 10f209b9 116/117 adverse run and earlier 95/108 adverse run remain preserved unchanged; setup-only attempts remain correctly classified as zero tests. This successful run verifies the fixture correction and selected behavior only at this candidate. Any prior “approved” wording refers to root implementation authorization, not independent source clearance. The candidate still requires the three fresh ordinary GPT-6 Luna reviews and a full independent GPT-6 Sol security review on the exact frozen SHA. No source changes, rerun, build, browser, push, or PR action occurred in this task.


---

## Authentic report: query786-accepted799-ordinary-luna.md

Source SHA-256: `e2be88ffa013d3a36f989884b8dc246ade054c47c884032a66d67c9560adfb12`. Original bytes follow.

# Query786 composition with accepted #799 main — independent ordinary review

- **Verdict:** CLEAR for the bounded accepted-main composition at exact head `40fe67d7412400f41f91184e5fd67f5feee3a50cb`.
- **Base / parents:** current reviewed source `e31b292f14a2701db9b950dc69ac344208293f7a`; actual protected accepted main `f5d8f51c1d502b58af2e7b6b9cf01a6e01f7680e`. The candidate has those two exact parents.
- **Independence/model:** Fresh GPT-6 Luna ordinary-review context assigned for this bounded composition confirmation. I did not author, direct, advise on, or remediate either parent or candidate. No child context was used. Exact served-model build was not exposed.
- **Scope:** Verify that all 19 label/query source and test blobs retained from e31 are unchanged, all other candidate tree entries (including modes) equal accepted main, and inspect actual #799 attachment integration and its changed approval fixture seams against the retained source reviews. This retains the full e31 source panel and security clearance; it is not a fresh whole-main review or whole-#799/#580 review.

## Evidence checked

Read repository AGENTS instructions, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, active mission, current-cleared e31 packet/custody, exact full e31 GPT-6.1 Sol report, focused PG result, e31 event ordinary delta report, accepted #799 composition review, and the applicable attachment source review note. The e31 Sol report clears its exact 19-path source scope and dispositions the former hidden-row deletion/event-content blocker. Its runtime attribution is the operator's 11 files/117 tests/37.605-second PG18 run, not my execution.

Independently verified the candidate SHA/worktree, both exact parents, and tree composition. The 19 source-own blobs match their e31 custody values. Comparing recursive tree entries including file modes, every path outside those 19 source-owned paths matches accepted main. `identity-scope.repository.ts`, database executor, and schema are unchanged from e31. No conflict resolution appears in the composed diff. `git diff --check` against accepted main passes and the worktree is clean.

Inspected the actual attachment diff across its 16 paths, with particular attention to `apps/api/src/attachment/repository.ts`, authorization-reach/controller seams, `tests/api-integration/attachment.test.ts`, intake conversion/duplicate-reach tests, and `tests/api-integration/helpers/approval-fixtures.ts`. The accepted composition preserves the e31 label repository, its awaited SLA/calendar results, label tests, route behavior, identity predicate/executor/schema, and the event repair unchanged. The attachment repository extraction consistently materializes its reads and retains the current identity/project/workspace reach predicates at content-access call sites. The acceptance-fixture change obtains and validates the canonical global customer role (including null workspace scope and exact built-in rank/capabilities/system marker), then grants organisation membership to an existing customer person; `addCustomer` uses the same helper. This supports the attachment intake customer-membership cases and does not alter production authorization code. The project-reach reader test itself is unchanged by this composition; its customer assertion remains an explicit organisation-bound project read and a denied staff route.

## Findings and limits

No blocking or non-blocking defect found in the bounded composition seams. In particular, the label source repair is not overwritten by accepted main; the attachment extraction does not modify the identity-scope predicate/executor/schema; and the shared approval fixture change preserves a canonical role and explicit organisation membership rather than introducing a project or instance-admin grant.

No tests, typecheck, build, PostgreSQL, Docker, browser, CI, Git/ref/GitHub mutation, or runtime action was performed in this review. Existing e31 runtime and review results remain attributed to their actual operators/reviewers and their exact source. The acceptance-fixture seam was inspected statically; this report does not claim its integration tests were run on the composed head. Browser verification: **BLOCKED** (API-only composition; no UI changed and no browser run authorized). This verdict confirms only the exact composition above. It does not grant merge authorization, satisfy the following fresh full Sol confirmation, claim hosted/image acceptance, close global N1/checker wiring, or accept #799/#580 as features.


---

## Authentic report: query786-accepted799-ordinary-sha-erratum-luna.md

Source SHA-256: `8ae4fcfc91ea22c4903ad8d310e5cb095ceb87a635e1940e4e8d2fb5d14b0293`. Original bytes follow.

# Query786 accepted-main ordinary review — SHA transcription erratum

**Erratum to** `query786-accepted799-ordinary-luna.md` (original SHA-256 `e2be88ffa013d3a36f989884b8dc246ade054c47c884032a66d67c9560adfb12`). The original file is preserved unchanged. Its verdict header and concluding message transcribed the candidate as `40fe67d7412400f41f91184e5fd67f5feee3a50cb` (41 characters), which is invalid. This was a transcription error only.

The actual reviewed target was the checked-out `HEAD`, whose native `git rev-parse HEAD` output is exactly `40fe67d7412400f41f91184e5fd67f5eee3a50cb` (40 characters). I verified the original review commands and composition inspection were run in `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`, where `HEAD` was the valid target below; the report's SHA field was typed incorrectly afterward. Therefore the **CLEAR verdict binds to actual candidate `40fe67d7412400f41f91184e5fd67f5eee3a50cb` only**.

## Fresh identity and composition recheck

Literal native outputs from this erratum check:

```text
$ git rev-parse HEAD
40fe67d7412400f41f91184e5fd67f5eee3a50cb
$ git status --short
<empty>
$ git show -s --format='commit=%H%nparent=%P%ntree=%T' HEAD
commit=40fe67d7412400f41f91184e5fd67f5eee3a50cb
parent=e31b292f14a2701db9b950dc69ac344208293f7a f5d8f51c1d502b58af2e7b6b9cf01a6e01f7680e
tree=b6af3ef07cacc0e60cf2a746283891b72d2660db
$ git diff --check f5d8f51c1d502b58af2e7b6b9cf01a6e01f7680e HEAD
<empty; exit 0>
```

A fresh read-only tree comparison used `git ls-tree -r -z` on actual `HEAD` and accepted main `f5d8f51c1d502b58af2e7b6b9cf01a6e01f7680e`, and compared the 19 source-owned paths to their exact blob IDs in the e31 custody/composition records. Native comparison summary:

```text
own paths 19 own blob mismatches 0 []
outside-own paths compared with accepted main 3360 mismatches including modes 0 []
all-source-own-blobs-match True
all-other-tree-entries-match-main True
worktree status ''
```

Thus the candidate has the intended two parents; all 19 e31-owned blobs remain exact; all other tracked tree entries, including modes, match accepted main; the worktree is clean; and the accepted-main diff check is clean. This confirms the original bounded ordinary review's target identity and composition result. No source, ref, GitHub, test, build, runtime or deployment action was taken. This erratum corrects the report/final-message transcription and does not expand the ordinary review scope, replace either retained source review, or substitute for the separate Sol composition confirmation.


---

## Authentic report: query786-canonical-workspace-role-test-luna.md

Source SHA-256: `87ee92d6a38466bf5c7b4c033dcf020c5423638a14e0e7b1c1d6c3c75f022636`. Original bytes follow.

# Query 786 canonical workspace role fixture correction (Luna author report)

Date: 2026-10-16

## Candidate

- Worktree: `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`
- Branch: `codex/786-label-await-scope-repair-luna`
- Prior candidate/runtime: `10f209b9a309861ce70223f0639d6ae6e2727f80`
- Current candidate: `5bb7687a86f1e775c164e2dcc3e581ae394f8f6b`
- Commit: `test(api): seed canonical label workspace role`
- One-file delta: `tests/api-integration/label-repository.test.ts` only. Worktree clean after commit.

## Exact behavioral fixture correction

The preceding authorized PG18 run reported 116/117 passing; the sole failure had manually added a `workspaceUserTable` role `member` to the target workspace without a corresponding canonical system `workspaceRoleTable` member row. The fixture helper's ordinary creation path seeds `defaultRolePayloads[role]` as a system role, while the current-workspace reach predicate requires that canonical role for a non-owner legacy membership.

The existing test now keeps a concrete deny control for that incomplete membership: it resolves identity before the role exists, confirms no canonical member role row exists, and expects the workspace list to return no labels. It then inserts the canonical `member` system role using existing `defaultRolePayloads.member`, re-resolves identity, asserts exactly the expected workspace/member grant and zero project grants, and proceeds with the workspace-definition-positive/task-copy-hidden checks. This is test-only; no predicate, shared fixture helper, schema, or capability was changed.

## Checks

- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json` — passed.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json` — passed.
- `pnpm exec biome check tests/api-integration/label-repository.test.ts` — passed after import ordering correction.
- `git diff --check` — passed.
- No PG/runtime invocation on `5bb7687a`; the earlier 116/117 adverse evidence remains unchanged. No rerun is authorized yet.

The previous full test output and receipts remain at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query786-runtime-10f209b9/`; the previous runtime report remains unchanged at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query786-10f209b9-focused-pg-result-luna.md`. Root's implementation authorization is not independent review clearance. Root should inspect this exact one-file delta and decide whether to authorize the next focused PG18 run.


---

## Authentic report: query786-current-recovery-author-luna.md

Source SHA-256: `56fda088eef97e73011cf57365ddd066489729cca05aad561a50c2b3c5a299fe`. Original bytes follow.

# #786 label/SLA/calendar recovery — author handoff

## Candidate and provenance

Prepared in isolated worktree `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`, branch `codex/786-label-await-scope-repair-luna`, based directly on accepted `origin/main` `8c3456be02d6e81c76ed2b7fc35fa7b29850a0d4`. Current local candidate is commit `3e54e1a87e84ce4e0263bf94de61c9fbe301331a` (`fix(api): scope label content queries to current identity`). Worktree was clean after commit. Original #786 worktree `q580b5/Ticketing.v2` at `7500e06c8fab34bb61d4d00151d4e4af74b7a4b6` and the primary checkout were not changed. No push or PR was made.

The source seed is the 15-path useful delta described in the preserved-source report: eight label controllers, new label repository, name-lock shim, SLA/calendar repositories and three direct integration tests from original #786 (`2f87c275` plus its `7500e06c` lock-order test). I omitted the inherited executor, executor tests and branch-copied standards doc. I added the route identity handoff and adjusted relevant existing tests because the current identity SQL contract requires that repair. Exact candidate diff has 19 files:

- Label source: `apps/api/src/label/index.ts`, `label/repository.ts`, `label/label-name-lock.ts`, and eight controller files (assign, create, delete, get, get-by-task, get-by-workspace, unassign, update).
- Awaited-result normalization: `apps/api/src/service-calendar/repository.ts`, `apps/api/src/sla-policy/repository.ts`.
- Tests: new `tests/api-integration/label-repository.test.ts`, `label-lock-order.test.ts`, `repository-awaited-results.test.ts`, plus adapted `tests/api-integration/project-reach-reads.test.ts`, `tests/api/label/assign-and-unassign-label.test.ts`, `tests/api/label/delete-label.test.ts`.

## Contract repair

Route handlers now resolve the authenticated credential identity through the accepted `resolveRequestIdentity` entry point, including API-key and impersonation facts, and pass it into label controllers. Content reads use accepted `currentWorkspaceReachPredicate` / `currentProjectReachPredicate` in the repository SQL. Workspace definitions remain visible with current workspace reach; task-bound labels require current reach to the linked project and the project workspace must match the label workspace. Workspace lists no longer use caller-precomputed project IDs as the repository scope source. Task assignment/create bootstrap reads are narrowly limited to IDs and use SQL current project reach.

The single-row select/lock/delete/update results are constrained by current reach in their SQL. Inserts use `INSERT … SELECT` with current project/workspace reach and return only the new ID; a subsequent identity-scoped select supplies the actor-visible full row. Family scans now return only label/task/project identifiers for the internal propagation work. The all-copy rename/delete operations retain their workspace/name boundary, including copies on hidden projects; task-copy enumeration is not filtered to actor project reach. Advisory lock namespace 4007, sorted unique family names, family-before-row ordering, `(taskId,labelId)` ordering, same transaction/executor, DTO results, caller status masking and existing event publication paths are preserved.

SLA/calendar changes normalize the already-awaited repository query builders into async functions with awaited return values. The existing awaited-result test covers the six helper reads. The accepted SLA-1/current-calendar decision and existing predicates/call sites were retained; no SLA policy or calendar behavior was expanded.

## Verification actually performed

- `pnpm install --frozen-lockfile` completed from the existing lockfile (1244 packages reused; no lockfile edits).
- Built only the workspace type dependencies needed for API typechecking: `@taskdesk/permissions`, `@taskdesk/domain`, `@taskdesk/email`.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json` passed.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json` passed.
- Scoped Biome check/write on the 18 changed source/test files passed; commit hook rechecked 19 changed files and passed.
- `git diff --check` passed.

No test suite, PostgreSQL, Docker, browser or application runtime was run. The Postgres integration tests are written/typed but remain unexecuted pending the conductor’s shared test window. The historical hosted #786 run is not evidence for this candidate.

## Review and remaining evidence

This candidate changes authorization semantics for label content SQL. I authored and directed its repair and am not an independent reviewer. It needs three fresh ordinary GPT-6 Luna reviews sized to the cross-controller/repository/test coupling, followed by a full independent GPT-6 Sol security review of the actual final SHA; no earlier #786 ordinary report or this handoff substitutes for those reviews. Root’s planned test window should run the direct repository Postgres matrix and original lock/concurrency/label cascade regressions before reviewers use execution evidence.

The new direct repository cases cover foreign-workspace exclusion, workspace-only visibility of definitions with task copies omitted, current project reach filtering, stale resolved identity after project-membership revocation, and family propagation retaining hidden copies. They are compiled but unexecuted. Reviewers should specifically validate the PostgreSQL shape of `INSERT … SELECT` aliases/default columns, transaction behavior on conflict, lock order under the added reach subqueries, and that hidden-copy delete events still use the existing project-audience path without exposing those rows in a workspace-list response. No unresolved spec/decision-log gap was found for the defined workspace-family collateral behavior; no owner question is being raised by this handoff.


---

## Authentic report: query786-current-scope-contract-addendum-luna.md

Source SHA-256: `02a00a0ba1fc86d589126fbd80e66462b2d1a81db44fd11ee3041b5066f3752c`. Original bytes follow.

# #786 preserved-source recovery — current scope-contract addendum

Read-only addendum to `query786-preserved-source-recovery-plan-luna.md`. It corrects the prior report’s classification of the label repository. It does not authorize implementation, review, or merge.

## Evidence boundary

I inspected retained worktree `/Users/heinthura/.codex/worktrees/q580b5/Ticketing.v2`, branch `codex/query-ownership-580-b5`, at exact head `7500e06c8fab34bb61d4d00151d4e4af74b7a4b6`; its status was clean. The slice’s last commit only adds `label-lock-order.test.ts` (175 lines), parent `2f87c275faef88585314a616ca5f85194d60e36d`; it is not a complete description of the slice. The authority baseline for this audit is accepted `main` `8c3456be02d6e81c76ed2b7fc35fa7b29850a0d4`. No code, ref, worktree, PR, runtime, or test was changed/run. Prior author assertions and old branch notes are not current live evidence.

Accepted main’s decision log settles the tenant query convention: cross-organisation content reads take resolved identity and apply current caller reach in SQL; query-location/executor checks do not replace it. The accepted multi-tenancy and security-model documents state the same rule and say an ID only narrows scope. Consequently, middleware reach checks and precomputed project-ID lists are not exceptions. This is also the substance of the prior #785/#799 blockers: caller prechecks or caller-provided IDs do not make an ID-only content query scoped. I withdraw the prior report’s characterization of these guards/predicates as adequate and its suggestion that only lightweight Sol confirmation would fit.

## Export-by-export contract classification

`apps/api/src/label/repository.ts` at #786 head has these groups:

- **Actor-facing label content (must be identity/current-reach scoped in SQL):** `findLabelById` returns a full row by label ID; `findLabelsByTaskId` returns full rows by task ID; `listLabelsByWorkspaceId` returns full rows using a caller-precomputed reachable-project-ID array; `lockLabelRow` selects a full row by ID; `deleteLabelById` returns the deleted full row; `findTaskLabelByName` and `findWorkspaceLabelByName` return full conflict rows; `insertTaskLabelOnConflictDoNothing`, `insertWorkspaceLabelOnConflictDoNothing`, and `updateLabelById` return full write rows. Any actor-visible response/event derived from those results is content too. A route middleware check does not discharge the repository contract.
- **Minimal scope/bootstrap/consistency facts:** `findLabelSnapshot` selects only task/workspace/name to derive family lock keys; `findTaskWithWorkspace` and `findTaskInWorkspace` select task/project/workspace identifiers; `findProjectWorkspaceId` and `findProjectWorkspaces` return workspace consistency IDs. These are not full label-content reads, but must remain narrowly minimal and be called only for their documented control purpose. If a future caller exposes them or turns them into content, identity/current-reach scope applies. In particular, a workspace/task ID argument alone is not a substitute identity.
- **Internal family mutation/concurrency facts:** `lockWorkspaceLabelNames` acquires sorted/deduplicated advisory locks; `listTaskLabelCopiesWithTask` discovers full matching copies plus task/project facts; `listTaskLabelCopyTaskIds` and `lockTaskLabelCopies` enumerate/lock copy IDs; `updateLabelsByIds`/`deleteLabelsByIds` mutate the family. Keep these internal and transaction-bound. Preserve the namespace, sorted unique names, family-before-row ordering, `(taskId,id)` copy-row ordering, same transaction/executor, and all-copy mutation behavior. The list-with-task helper deserves special scrutiny because it includes full label fields even though its use is family propagation, not an actor list.

## Caller contracts and bounded structural repair

The label routes currently establish workspace/task/label reach and capabilities in middleware, but handlers/repository calls still use ID-only content reads or feed a precomputed `reachableProjectIds` list. The repair must thread the resolved request identity (including the established `userId`, API-key, and impersonation context) through the actor-facing handler and repository boundary, then put current reach predicates in the same SQL statement that reads or returns content. Use accepted main’s `resolveRequestIdentity` and identity-scope repository helpers (`currentProjectReachPredicate` and `currentWorkspaceReachPredicate`) as the existing vocabulary, rather than adding a new capability or identity wrapper.

For task-bound label content, scope through the task/project join with current project reach. For workspace label definitions, use current workspace reach. For a workspace list, keep workspace-level definitions visible under workspace reach while filtering task-bound copies in SQL to currently reachable projects; do not depend on a stale/precomputed project-ID list. For single-row reads and `UPDATE/DELETE … RETURNING`, apply the same identity/reach scope to the content-bearing statement. Preserve the current label route’s not-found masking and existing capability decisions.

This is an actor-content SQL authority repair, not permission to change the family operation’s meaning. Workspace-label rename/delete currently propagates to all same-name task copies in the workspace, including copies attached to projects hidden from the actor’s project list. The accepted RBAC rules distinguish workspace-level label definitions from task-bound labels and authorize the former via workspace membership plus label permission; WI-8 governs label edits through work-item update on the project. Preserve that documented workspace-family collateral behavior and transaction/lock ordering. Do not filter the mutation family to reachable projects, which would leave partial copies. Conversely, do not return hidden-project content to an actor as a new list/response. Keep family scans/IDs internal; review any emitted events against existing event payload contracts so propagation does not create a new disclosure. The inspected accepted decision log contains no decision authorizing broader project content or changing this family behavior, so there is no owner question to raise before a bounded implementation.

The concrete next author action is: make one narrow label-repository/controller change that threads resolved identity into the actor-content methods above and scopes each content read/write-returning SQL with current workspace/project reach, while retaining internal unfiltered family-copy enumeration solely for the existing workspace-level propagation transaction. Add focused direct-repository Postgres regressions for current reach and hidden-project family preservation. Do not transplant the old cumulative docs, executor/checker framework, or unaccepted workflow imports.

## Review and verification implications

This actual repair changes tenancy/authorization semantics for content-bearing SQL in label controllers and repositories; it is not the “security-scope file but no authority change” case. Given API/controller plus repository coupling, current reach semantics, and transactional family mutations, plan three fresh independent ordinary GPT-6 Luna reviews and a full independent GPT-6 Sol security review on the eventual exact candidate SHA. If the eventual diff is demonstrably smaller, the orchestrator can size the ordinary panel to actual coupling under the repository’s review table; the Sol pass remains required. The author and this diagnostic reviewer are not independent reviewers of the resulting implementation.

Meaningful focused verification should directly exercise repository SQL against Postgres: same-workspace reachable vs unreachable project labels; foreign workspace/org; stale identity after reach revocation; authorized workspace-level definitions when no projects are reachable; each ID-only and DML-returning content path; not-found behavior; and preservation of all-copy workspace-family propagation, stable lock order, same transaction, and rollback. Middleware-only tests cannot establish the SQL contract. No such checks were run in this read-only audit.


---

## Authentic report: query786-current-source-repair-proposal-luna.md

Source SHA-256: `a23021c7065dfbd1ec96d53be48e959fd00efdf29e1613dad3bc8299f442426d`. Original bytes follow.

# Query #786 bounded source-repair proposal — no edits or runtime

Candidate reviewed: `ffe63ec3a2cff5b78b37d02c2034807e47a2b411`. Attempt 3 remains the sole PG18 execution; its 5/11 files, 13 failed/95 passed tests and full raw output remain unchanged. Attempts 1–2 were setup-only and ran no tests. This report proposes a bounded repair only; no source, refs, tests, or runtime were changed here.

## Failure classification

**1. SQL alias defect in two actor-content lookup helpers.** `findTaskLabelByName` and `findWorkspaceLabelByName` use Drizzle relational `executor.query.labelTable.findFirst({ where })`, while `currentLabelReach` and `currentWorkspaceReachPredicate` contain nested SQL expressions over the physical `labelTable`. PostgreSQL’s runtime SQL shows a FROM alias `labelTable` but the correlated predicate emits `label.workspace_id`, causing `42P01` in label content lookup. The alias bug is evidenced by the full PG18 traces in `query786-runtime-ffe63ec3-attempt3/vitest.full.log`. A narrow structural repair is to use the ordinary select builder consistently in both helpers (`select().from(labelTable).where(predicate).limit(1)` and return the awaited first row), as the other label repository content queries already do. Do not add alias literals or special-case the predicate fragment. This addresses create/attach paths that resolve the written/existing label after the scoped `INSERT…SELECT`, while retaining the same row shape, identity predicate, current reach, transaction, conflict target and event conditions.

**2. Soft-deleted project liveness regression in task-bound list reads.** `currentLabelReach`’s task branch correlates task to project and checks current project reach, but does not exclude `projectTable.deletedAt`. The `project-reach-reads.test.ts` fixture soft-deletes the hidden project and expects its task label to disappear even for `sees_all`; the actual run showed that label still present. Existing `get-project.ts` and `get-projects.ts` expressly treat `deletedAt` as gone in ordinary use, independently from `archivedAt`. The bounded repair is to add `isNull(projectTable.deletedAt)` to the project branch inside `currentLabelReach`. Do not add an `archivedAt` filter: ordinary project/task reads retain archived projects, and project archive is an independent reversible state.

**3. Workspace-definition expectation for a customer is a fixture-helper mismatch, not an authorization gap.** In `project-reach-reads.test.ts`, `assertLabels` always expects the workspace-level “Workspace definition.” The customer test uses that helper after calling the direct controller/repository with a customer identity whose organisation reaches one project. The canonical `currentWorkspaceReachPredicate` explicitly returns false for non-staff, while `currentProjectReachPredicate` grants the organisation’s own project. The test also proves the public staff-workspace route is 401 for this customer. Root’s policy/fixture audit classifies the unconditional workspace-definition assertion as an obsolete precomputed-ID/helper expectation. Change only that customer-specific assertion to require its visible project’s task-bound label, exclude the hidden-project task label, and exclude the workspace definition. Keep the public route’s 401 assertion and do not widen workspace reach or change the general helper for staff callers.

**4. Awaited repository results.** The new repository functions are declared `async`; this means returned Drizzle thenables are assimilated, but the new #580 contract test verifies native Promise/awaited row semantics explicitly. Functions returning query builders include `findProjectWorkspaces`, `findLabelsByTaskId`, `listTaskLabelCopiesWithTask`, `listTaskLabelCopyTaskIds`, `lockTaskLabelCopies`, `deleteLabelsByIds`, and `updateLabelsByIds`; `listLabelsByWorkspaceId` already explicitly awaits. `findTaskLabelByName`/`findWorkspaceLabelByName` should return an awaited row after conversion to the normal select builder. Add the label functions’ native-Promise and resolved-array assertions to the existing `repository-awaited-results.test.ts`, matching its existing SLA/calendar cases; preserve each function’s existing array, optional-row, or mutation result contract. Do not change controller transaction boundaries merely to rewrap thenables: their existing call sites await the repository helpers, and async transaction callbacks assimilate their returned promises.

## Audit of current identity predicates and preserved internals

In `apps/api/src/label/repository.ts`, actor-content scope is applied through `currentLabelReach(identity, executor)` for `findTaskLabelByName`, `findLabelById`, `findLabelsByTaskId`, `listLabelsByWorkspaceId`, `findLabelSnapshot`, `lockLabelRow`, `deleteLabelById`, and `updateLabelById`. The task-creation `INSERT…SELECT` uses `currentProjectReachPredicate`; the workspace-definition `INSERT…SELECT` uses `currentWorkspaceReachPredicate`. `currentLabelReach` uses workspace reach for null-task definitions and current project reach for task copies. The two relational `findFirst` calls are the demonstrated alias-risk shapes. The ordinary `select/from` reads, scoped `INSERT…SELECT`s, and `UPDATE/DELETE … RETURNING` require runtime confirmation but are not implicated by the alias exception as generated in attempt 3.

The helpers without actor identity are internal or bootstrap facts: `findProjectWorkspaceId` and `findProjectWorkspaces` run after caller/task checks and transaction locks; `listTaskLabelCopiesWithTask`, `listTaskLabelCopyTaskIds`, `lockTaskLabelCopies`, `deleteLabelsByIds`, and `updateLabelsByIds` support the documented all-copy family mutation, including hidden-project copies. They must retain their narrow IDs/columns, workspace/name scope, row and task lock order, and same transaction. Do not apply a caller reach filter to these helpers; that would leave hidden copies behind. No new global projection or hidden content exposure is proposed.

## Bounded change and verification proposal

Change only `apps/api/src/label/repository.ts`, `tests/api-integration/project-reach-reads.test.ts`, `tests/api-integration/label-repository.test.ts` if needed for direct row shape, and `tests/api-integration/repository-awaited-results.test.ts`. Keep controllers’ lock/family/event/error flow unchanged. Add/retain tests for: both name lookups through ordinary select builders under real identity predicates; customer sees only its organisation-bound task label and no workspace definition while public route remains 401; soft-deleted project label excluded for `sees_all`; archived-but-not-deleted project’s task label remains readable; native-Promise/resolved-array contracts; existing family lock order, same-name mutation, hidden-copy collateral propagation, conflict/idempotency, and awaited-result coverage. Then rerun the exact existing 11-file focused PostgreSQL matrix once on the resulting reviewed candidate, not a source-mutated continuation of the current evidence. Preserve exact SHA and raw outcome.

The unresolved review classification is root-owned. The proposed repository SQL changes preserve the intended current identity rules and add only the existing deleted-project liveness exclusion; they do not grant new authority. No question to the owner is identified by this evidence. Root should set the review tier and authorize source edits/runtime separately after reading this proposal.

Private source receipts reviewed: candidate `apps/api/src/label/repository.ts`, `apps/api/src/database/repositories/identity-scope.repository.ts`, `apps/api/src/project/controllers/get-project.ts`, `apps/api/src/project/controllers/get-projects.ts`, `tests/api-integration/project-reach-reads.test.ts`, `tests/api-integration/label-repository.test.ts`, `tests/api-integration/repository-awaited-results.test.ts`, and the complete attempt-3 native log.


---

## Authentic report: query786-delete-event-content-repair-luna.md

Source SHA-256: `67bc87175a5f7fc45299f738cd5db5759db650d890ecb2d328eb3e8c0836d3f1`. Original bytes follow.

# Query 786 cascade delete event content minimization (Luna author report)

Date: 2026-10-16

## Candidate and provenance

- Worktree: `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`
- Branch: `codex/786-label-await-scope-repair-luna`
- Parent candidate: passing focused PG18 composition `6b4bc0d141db8b128afb7eb5855b5bd8e7bf7133`
- Current commit: `6cefb2c4d5e979e0298d9773247c350677a209b3` (`fix(api): omit label content from cascade events`)
- Worktree clean after commit. No PG, browser, build, push, PR, or source edits during/after a runtime window.

## Caller and event audit

- Sole production caller of `deleteLabelsByIds` is `apps/api/src/label/controllers/delete-label.ts`; test callers are the focused repository integration case and controller unit test.
- It runs after the same workspace-name advisory lock, task-row/project liveness locks, and `lockTaskLabelCopies`; deletion remains in the same transaction. The workspace definition is still deleted through identity-scoped `deleteLabelById`; family copy IDs are collected by the same unfiltered internal family query, so hidden-project copies still participate in the family mutation.
- The consumer maps each deleted copy's `taskId` to the already-locked task and its `projectId`. `deleteLabelsByIds` now returns only `{ taskId }`, the minimum fact needed to preserve one `task.label_deleted` invalidation per actually deleted task copy.
- The producer retains event key `task.label_deleted` and its existing `task`, `projectId`, `taskId`, `userId`, and `type` fields; it removes only the full `label` row. The WebSocket consumer in `apps/api/src/ws/index.ts` is the only production subscriber found: its generic task-event handler selects the existing label event key as `TASK_LABEL_UPDATED` and uses `projectId`/`taskId` for the existing project broadcast. It does not read label content; its code and wire shape are unchanged. The integration race test subscriber reads taskId only.
- The authoritative event catalog `docs/01-architecture/events.md` explicitly records `task.label_deleted` as having no declared target TaskDesk event. I did not invent a canonical payload or event schema.

## Regression coverage

- `tests/api-integration/label-repository.test.ts`: the direct PostgreSQL repository case now removes the actor's project membership for one family task, confirms the copy is hidden by `findLabelById`, then verifies the internal family list/lock still includes both copies. It renames one copy and deletes both family copies; it asserts the DELETE RETURNING rows expose exactly `taskId`, both task IDs are represented, both family rows are gone, and the other-name and foreign-workspace labels remain.
- `tests/api/label/delete-label.test.ts`: the existing producer assertions now expect the exact event payload without `label` for both projects/tasks. Its select mock models current predicate construction (internal `{ one }` subqueries do not consume the queued outer-row fixture), allowing the unit behavior to exercise the actual controller path.

## Checks

- Production TypeScript: passed.
- Test TypeScript: passed.
- Scoped Biome on the four changed files: passed.
- `git diff --check`: passed.
- Focused controller unit file: 2/2 passed (Vitest 4.1.11; 0.432s).
- No PostgreSQL execution on `6cefb2c4`; the direct integration regression is authored but awaits exact-head source review and root authorization for a focused PG18 window.
- The successful preceding focused PG18 run remains preserved unchanged at `6b4bc0d` (11/11 files, 117/117 tests). The earlier 10f209b9 116/117 and ffe63ec3 95/108 adverse runs remain unchanged.

## Review status and next step

The prior full GPT-6 Sol review blocked the `6b4bc0d` source on this label-content producer. This commit addresses that producer mechanism, but the author is not an independent reviewer and no review clearance is claimed. Per root direction, request one fresh strong ordinary Luna delta review, then a fresh full GPT-6 Sol review on the exact frozen candidate; preserve the three prior ordinary reviews as prior-head evidence rather than treating them as current clearance. Root may then decide whether to authorize the single focused PG18 window for the new SHA. No further runtime activation is authorized by this report.


---

## Authentic report: query786-e31-current-cleared-source-packet.md

Source SHA-256: `47d94b332fcf27cbaca773493f25408fa61db29aa997d03757408db9cfa78148`. Original bytes follow.

# Query786 cleared source: current custody and limits

Exact clean source `e31b292f14a2701db9b950dc69ac344208293f7a`, accepted base `f77f89d9a6eb862cbf9d601c7868ca009b04d5e1`. Full source/test change is 19 paths: 13 production source paths and six test paths. Machine receipt query786-e31-cleared-source-custody.json records every source blob and retained report digest. This packet records evidence, not an independent review.

Three independent Luna ordinary reviews at6b remain the full-panel baseline, with authentic B scope/C assigned-model errata. The later full Sol BLOCK at6b superseded ordinary non-blocking interpretations of full-row deletion results. Structural repair6ce narrowed hidden-copy DELETE RETURNING to taskId only and removed label content from existing deletion events; test-onlye31 restored the positive rename/color readback and nonempty membership-revocation assertion. Fresh strong independent Luna delta review at e31 is CLEAR; fresh FULL independent explicitly assigned GPT-6.1 Sol review of all19 paths at e31 is CLEAR. Both reports have been read fully by root. No security exemption, event/schema invention or all-copy propagation narrowing is accepted.

Current operator PG evidence:11 files117/117 native exit0,37.605s. Root read report/raw summaries/native JSON/exact owned inventories. Fixture PG18 parent tmpfs verified including /proc mount, dynamic127 binding/readiness; exact owned PG removed and baseline23containers109volumes7networks preserved. Reviewer did not execute this runtime; attribution remains explicit. Adverse setup/query/fixture runs and old exported-builder seam remain authentic historical records, not passes.

No push/Ready/hosted checks/image/merge/stage claim. Compose only actual newly accepted main when available, preserving all own source blobs and all other paths from actual main; obtain appropriate fresh ordinary and security import confirmation at that new exact head, retaining full e31 review. Publish authentic own note additively with exact machine-readable reviewed-head binding; verify every publication commit, not merely final tree. Global N1 and checker wiring remain open. Do not ask again for the accepted WF-9 all-workspace-project rule or WF authoring shape-only decision.


---

## Authentic report: query786-e31-event-delta-ordinary-luna.md

Source SHA-256: `9737985d34e0b89b5e54b3f7afcbc4f3315fd0a6820b8f17b800bc748fc7edf1`. Original bytes follow.

# Query786 e31 event-repair ordinary delta review

- **Model:** GPT-6 Luna (assigned fresh strong ordinary delta-review context)
- **Context:** `/root/query786_e31_event_delta_ordinary_luna`
- **Candidate:** `e31b292f14a2701db9b950dc69ac344208293f7a`
- **Base:** `f77f89d9a6eb862cbf9d601c7868ca009b04d5e1`
- **Prior panel/security head:** `6b4bc0d141db8b128afb7eb5855b5bd8e7bf7133`
- **Exact delta commits:** `6cefb2c4d5e979e0298d9773247c350677a209b3` and `e31b292f14a2701db9b950dc69ac344208293f7a`
- **Verdict:** CLEAR for this delta's ordinary review; prior-head S1 event-content blocker is structurally resolved at this exact source head. No additional blocking ordinary finding.
- **Independence:** Fresh context; I did not author, direct, advise, or remediate either delta. Prior review and author reports were read as evidence, and the source/contract/call paths were independently checked. This delta pass retains the three earlier ordinary reviews; it is not a replacement full-panel review or security review.

## Scope and inspection

Verified clean worktree and exact HEAD in `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`. Read the full current review packet, full prior GPT-6 Sol report, all three prior ordinary reports and their scope/model errata, and the event-repair and conservation author reports. Inspected the actual four-path delta against `6b4bc0d`, its full source diff, the current delete controller/repository/test implementations, the event catalogue, all `task.label_deleted` references, the sole production WebSocket subscriber, and the applicable query-ownership and security-model contract text. Also read the relevant integration test setup/assertions. No author conclusion was treated as a substitute for source inspection.

Read-only/cheap commands run: `pwd`, `git status --short --branch`, `git rev-parse HEAD`, `git show -s --format='%H%n%P%n%s' HEAD`, `git diff --stat <base>..HEAD`, `git diff --name-only <base>..HEAD`, `git diff <prior-head>..HEAD -- <four delta paths>`, targeted `rg`, `sed -n`, and `git diff --check` against both the accepted base and prior panel head. Diff check passed; HEAD is exact and the worktree is clean. No tests, PostgreSQL, Docker, browser, build, Git/ref/source/GitHub mutation, or child agent was used.

## Findings

**Prior S1 is closed for the reviewed producer path.** `deleteLabelsByIds` now uses `.returning({ taskId: labelTable.taskId })`, so deleted hidden copies no longer place label content, timestamps, or other row fields in the controller's event path. `deleteLabel` uses that identifier only to locate an already locked task and derive its project ID, then publishes the unchanged `task.label_deleted` key and the existing `task`, `projectId`, `taskId`, `userId`, and `type` fields, with no `label`. The only production subscriber is the generic task event handler in `apps/api/src/ws/index.ts`; it maps the event to `TASK_LABEL_UPDATED`, broadcasts the existing project/task invalidation, and does not consume label content. The event catalogue continues to state that `task.label_deleted` has no declared TaskDesk event; this delta does not invent a canonical payload or schema.

Family behavior remains intact by direct source inspection: the workspace/name family scan and lock still select hidden project copies, deletion stays in the transaction after the existing locks, and emitted invalidations are generated from actually deleted task-copy rows. The updated integration regression removes one project's membership, asserts that actor-facing lookup cannot see that copy, confirms the family selection and lock still find it, updates and reads back the visible copy's renamed name/color before deletion, deletes both family rows, asserts exact `taskId`-only returned objects for both task IDs, and verifies the other-name and foreign-workspace rows remain. It does not apply actor reach to the intentional family mutation.

The controller unit test asserts exact event payloads with no `label` for both affected tasks. Its new `db.select` mock detects a selection carrying `one` as the nested reach subquery and otherwise consumes queued outer rows. This is a tailored unit mock, so it does not independently prove Drizzle query execution or the hidden membership behavior; the direct integration case supplies the latter, but that regression was not run on `e31b` by this reviewer or the author report. I found no assertion weakening, skipped/focused test, query-builder export, widened authority, or forged result use in the inspected delta.

One trivial documentation nit in changed source is corrected by the final blob: the repository header remains grammatically coherent after removal of its duplicate sentence. No finding.

## Evidence limits

The author reports production TypeScript, test TypeScript, scoped Biome, and `git diff --check` passed; the controller unit file passed 2/2 on the preceding `6cefb2c` head. Those are attributed author checks, not this review's execution. The prior focused PostgreSQL result (11/11 files, 117/117) is from `6b4bc0d`, before these exact-head changes. The new direct PostgreSQL regression has not run on `e31b`; an exact-head focused PG run and then a fresh full GPT-6 Sol review are still required by the handoff. Browser verification: **BLOCKED** (API-only delta; no UI changed and no browser run authorized). The structural query checker remains unwired; this report does not claim it is satisfied or claim whole-#580 closure. This verdict applies only to the four-path delta at `e31b292f14a2701db9b950dc69ac344208293f7a`; it is not approval of a future head, hosted CI, image/boot, merge, or phase completion.


---

## Authentic report: query786-e31-full-security-61-sol.md

Source SHA-256: `aab30372afd8872f1f44335c05e112c146ae3079c37832f6c281f33bab2a8420`. Original bytes follow.

# Query786 — full independent current security review

**Model:** GPT-6.1 Sol
**Reviewed head:** e31b292f14a2701db9b950dc69ac344208293f7a
**Comparison base:** f77f89d9a6eb862cbf9d601c7868ca009b04d5e1
**Previous panel/security head:** 6b4bc0d141db8b128afb7eb5855b5bd8e7bf7133
**Dispatch/context:** Fresh explicitly assigned GPT-6.1 Sol full security reviewer, `/root/query786_e31_full_security_sol`. A served-model fingerprint beyond the assigned platform identity is unavailable. I did not author, direct, advise on, remediate, or ordinarily review this candidate. No children were used.
**Verdict:** CLEAR for this full 19-path security review at the exact reviewed head. Prior security blocker S1 is independently dispositioned as resolved. No additional blocking or non-blocking finding identified in the reviewed change. This is neither merge authorization nor blanket closure of the query-ownership program.

## S1 disposition

The previous full security report correctly blocked the old head for returning hidden-copy label content from `deleteLabelsByIds` without identity/current reach. Ordinary reviewers' earlier non-blocking classifications did not supersede that security blocker. I independently inspected the current source and exact repair delta rather than assuming the old panel had cleared it.

The current helper awaits `DELETE ... WHERE id IN (...) RETURNING task_id`, projected as exactly `{ taskId }`. The family operation still deletes all selected same-workspace/name copies, including copies whose projects the initiating actor cannot reach. Its result contains no label name, colour, timestamps, full label row, or other hidden content. The controller maps the returned task IDs to already locked tasks to obtain their project IDs. Its `task.label_deleted` publication now carries only the existing task/project identifiers, actor ID and type; it no longer includes `label`, for either the direct task-label or family-delete branch. The endpoint still returns only the identity-scoped requested label. An internal intermediate property named `label` now holds only the minimal taskId fact for hidden copies; it does not restore hidden content.

I searched the production event references and read the sole current subscriber in `ws/index.ts`. It maps this event to `TASK_LABEL_UPDATED` using projectId/taskId and does not consume label content. Its source and wire invalidation shape are unchanged. The event catalogue records this inherited key as having no declared TaskDesk target event; this repair does not invent a new event schema or use that catalogue gap to exempt a content-returning query.

The new direct repository regression removes exactly one real project membership, proves the second copy is no longer actor-visible, proves internal family selection/locking still includes both copies, positively reads back the first copy's name/colour update before deletion, asserts both deleted task IDs and exact taskId-only object keys, and confirms other-name/foreign-workspace rows survive. The controller unit assertions check the complete published payloads without `label` for both affected tasks. Its query mock is tailored to distinguish nested reach subqueries from outer selections; it is not treated as proof of SQL execution. The actual current-head PostgreSQL operator result supplies the separately attributed runtime evidence for the direct repository case.

This resolves this producer's content-returning mechanism without actor-filtering intentional family propagation or accepting a new internal-helper exception. Global N1 and the unwired structural checker remain separately open.

## Full current scope assessment

Inspected all 19 changed paths: eight label controllers, label router, label repository and name-lock shim; the SLA/calendar repository changes; four integration test paths; and two API mock test paths. Inspected current request identity resolution, SQL reach predicates, permission gates, executor ownership, task/project lock helper, event bus and WS consumer. Consulted canonical AGENTS, active mission, workflow/provider adapter, current status/decision entries, coding/query ownership, multi-tenancy/security/RBAC, label policy, settings/work-item/calendar/SLA contracts and ADR 0009. Read the historical packet, three earlier ordinary reviews with B scope/C model errata, adverse full security report, two repair author reports, fresh ordinary delta review and current PG result as evidence, not substitute conclusions. Current source wins over historical packets and report wording.

- All eight router handlers resolve the authenticated request credential identity and thread it to actor-facing label repository calls. The resolver carries actual stored key permissions, enabled state and ownerUserId and rejects missing/disabled/mismatched-owner key facts. Existing route middleware retains workspace permission checks and key narrowing. Reach does not grant label authority, owner authority or an instance-admin permission bypass.
- Actor-facing label content reads, locks and single-row writes use current SQL workspace/project reach. Project-copy reach correlates the label workspace to its task project and excludes deleted projects. Archived project reads remain permitted. Staff workspace definitions and project-bound content use separate branches; customers receive organisation-bound project content only through direct repository use and do not receive staff workspace definitions. The public staff-route customer denial remains asserted.
- Task/workspace insert-select statements require current reach in their source predicate and check workspace consistency. Inserts return only the inserted ID then fetch content through scoped queries on the same executor. Name lookups use ordinary select/from composition; no exported query-builder seam remains. Every label repository result is awaited/materialized. The minimal project/workspace bootstrap helpers supply IDs used after task resolution/locks, rather than content responses.
- Family scans and locks intentionally return narrow IDs across hidden same-workspace/name copies. Update propagation returns no hidden content. The initiating definition is identity-scoped and middleware-authorized. Selected copy IDs remain inside the caller-owned transaction, under the same family/task/project/copy locks. No new cross-workspace family mutation path was found.
- The advisory namespace remains 4007, names are sorted and deduplicated, and family locks precede row locks. Task locks use sorted task IDs, project locks sort/deduplicate internally, and copy locks order by task ID then label ID. Locked source snapshots are checked for family/name/assignment changes; no new inversion or transaction escape was identified. Events retain post-commit project/task audiences. The inherited in-memory emitter is not a new durable delivery guarantee.
- The six SLA/calendar helper changes only await the existing statements. Projections, filters and caller consumption remain unchanged. Callers await/materialize arrays and do not compose builder-only clauses. This review does not certify unrelated pre-existing SLA/work-item query producers as globally identity-scoped merely because these six helpers now materialize results.
- Tests retain the missing-canonical-role deny case, seed the canonical system member role for the definition-only positive case, and assert the real member grant with zero project grants. Foreign-workspace, stale membership, hidden customer/project, archived read, idempotency, deterministic locks and held-row locks remain meaningful. Removed builder-mirror tests are not counted as current coverage. No test skip/focus, authority expansion, new dependency/schema/capability/route/environment variable or gate exception was introduced by this candidate.

## Commands and evidence limits

Read-only commands actually used: `cat`, `sed -n`, `rg`/`rg --files`, `head`, `wc -l`, `git status --short`, `git rev-parse HEAD`, `git diff --stat`, full/targeted `git diff` against the accepted base and previous panel head, and `git diff --check` against the accepted base. HEAD was verified as the stated candidate, the worktree was clean at inspection and final verification, and the whitespace check passed. Some combined outputs were truncated; current full source paths and important contracts were read separately. An initially guessed settings filename did not exist; the actual `settings-hierarchy.md` was subsequently found and read. A temporary contract concatenation outside the repository was used only for reading. The only persistent output mutation is this private report.

No tests, PostgreSQL, Docker, build, browser, source/ref/GitHub mutations or runtime activation were performed by this reviewer. The operator's current-head `query786-e31b292f-focused-pg-result-luna.md` records 11/11 files, 117/117 tests, native exit 0, 37.605 seconds, CI absent, isolated PG18 tmpfs/loopback proof and exact owned cleanup. That is operator evidence, not my independent execution; I did not independently validate the harness, raw JSON or Docker inventories. The conductor reports inspecting those raw receipts separately. Earlier adverse runs remain historical and are not converted into passing evidence. The ordinary delta report predates the new PG run, so its statement that current PG was pending is historical, not a present failure.

**BROWSER VERIFICATION: BLOCKED** — no UI changed and browser execution was not authorized for this review. No current hosted CI, image build/boot, signed artifact, SIT workflow, protected merge, whole #580 closure or stage/phase-finalizer acceptance is claimed. The structural checker remains unwired; no global N1 disposition or blanket producer exception is granted. This verdict applies to this exact source head and full scoped change only, never to future source changes.


---

## Authentic report: query786-e31b292f-focused-pg-result-luna.md

Source SHA-256: `daa45534fa6edc39a55ab6274282a4dd39cf380e932a0d378227b5352abd6218`. Original bytes follow.

# Query 786 focused PG18 runtime result (Luna)

Date: 2026-10-16

## Candidate and invocation

- Exact candidate: `e31b292f14a2701db9b950dc69ac344208293f7a` on `codex/786-label-await-scope-repair-luna`.
- Worktree: `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`; exact SHA and clean status were verified before activation; still clean after cleanup.
- One canonical Vitest invocation over the authorized 11 existing integration files: label-repository, label-lock-order, label, label-detach, label-bulk-rename-race, label-workspace-cascade-task-delete-race, repository-awaited-results, sla-policy, service-calendar, service-calendar-usage-delete, project-reach-reads.
- Actual result: 11/11 files passed, 117/117 tests passed. Native return code 0; 600-second bound not reached; duration 37.605s; `CI` absent.
- Unique evidence directory: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query786-runtime-e31b292f/` (directory 0700; evidence files 0600).

## Runtime isolation and cleanup

Owned PG18 container `query786-e31b292f-pg`, exact ID `efa6592a2e2c6e1d4a437b9e96f7cf447d7c06ea78b09bc0a41d3f41ba808459`, carried the exact task/run/revision labels. Inspect verified `/var/lib/postgresql` tmpfs config, no conflicting overlapping mount, and exactly one dynamically assigned loopback binding. Container `/proc/mounts` independently proved mountpoint `/var/lib/postgresql` uses `tmpfs`; readiness passed before Vitest.

Pre/post inventories matched: 23 containers, 109 volumes, 7 networks; no additions or missing IDs. Cleanup stopped the exact owned ID with return code 0 after preserving logs and inspect evidence; temporary `test.env` is absent. Raw full Vitest log and receipts are preserved privately. The execution-copy operator is the validated runner with only evidence base directory, candidate SHA, and unique container name changed; exact config diff and runner hashes are stored in the evidence directory.

## Review status

This run verifies the strengthened direct repository regression and selected 11-file integration behavior at this SHA. Earlier adverse runs at `ffe63ec3` and `10f209b9`, and successful prior-head run at `6b4bc0d`, remain preserved unchanged. This report is runtime evidence only, not independent review clearance. Fresh full GPT-6 Sol security review on the current exact candidate remains pending after the runtime result; no source changes, rerun, build, browser, push, or PR action occurred.


---

## Authentic report: query786-event-conservation-followup-luna.md

Source SHA-256: `cd619e22f9e1791e2611c3a307281ea7fcbd1ed175b3a73d9a60038cce9e3c72`. Original bytes follow.

# Query 786 event repair regression-conservation follow-up (Luna)

Date: 2026-10-16

## Candidate

- Worktree: `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`
- Branch: `codex/786-label-await-scope-repair-luna`
- Prior event repair: `6cefb2c4d5e979e0298d9773247c350677a209b3`
- Follow-up commit: `e31b292f14a2701db9b950dc69ac344208293f7a` (`test(api): assert family update before delete`)
- Exact delta: one integration test file only, `tests/api-integration/label-repository.test.ts`; clean after commit.

## Conservation strengthening

The prior test-only adjustment changed the rename-then-delete case to delete both copies, unintentionally removing its positive readback assertion for the earlier family update. This follow-up restores that contract check: after `updateLabelsByIds` it reads the still-visible first copy through `findLabelById` and asserts `name: Renamed` and `color: #abc` before deleting both family rows.

The hidden-copy setup now captures `DELETE membership ... RETURNING id` and asserts exactly one project membership was removed before confirming the copy is hidden. The same test continues to assert internal family selection/locking sees both copies, minimal taskId-only deletion output, both copies removed, and the different-name and foreign-workspace labels retained. No test case count or production code changed.

## Checks and execution status

- Production TypeScript passed.
- Test TypeScript passed.
- Scoped Biome passed.
- `git diff --check` passed.
- No PostgreSQL, browser, build, push, or PR action occurred on `e31b292f`.
- The preceding event-repair controller unit invocation on `6cefb2c4` passed 2/2. It does not validate this new PG assertion; that awaits root review and a new explicit runtime grant.
- Prior runtime evidence on `6b4bc0d` (11/11 files, 117/117 tests) remains unchanged. No current-head PG claim is made.

This report and the previous author report are implementation evidence only, not independent review. No further test window is authorized here.


---

## Authentic report: query786-ffe63ec3-focused-pg-attempt2-result-luna.md

Source SHA-256: `0337e5ebfa44d6c51121c535d2b7486182889e27671082db9cf9f8b7ce02b00d`. Original bytes follow.

# Query #786 focused PostgreSQL attempt 2 — setup validation stopped before Vitest

Exact candidate: `ffe63ec3a2cff5b78b37d02c2034807e47a2b411`, clean before and after. The 11 requested test paths were verified in the runner before container creation, but Vitest was not launched. No test results or counts are available. This attempt is separate from and leaves attempt 1 unchanged.

## Runtime setup

Created PostgreSQL 18 Alpine container `a02c85792d0c6e7dcca496d5bc6b16e91fbfe7f608022853163403f99f102261` with `--rm`, exact task/revision/run labels, tmpfs `/var/lib/postgresql:size=1g`, and `127.0.0.1` dynamic port publication. Docker inspect recorded:

- `HostConfig.Tmpfs` contains `/var/lib/postgresql: size=1g`.
- `HostConfig.PortBindings` requests `127.0.0.1` and a dynamically assigned port; runtime mapping was `127.0.0.1:32793`.
- The container state was running.
- Docker inspect’s `Mounts` array was empty in this engine response.

The runner had a pre-test assertion requiring a `Mounts` entry of type `tmpfs`. That assertion failed on the empty array despite `HostConfig.Tmpfs` and the loopback mapping being present. Readiness was therefore not checked, no database URL or credential file was written, and Vitest did not start. This was an overstrict runner validation failure; it is not evidence of a PostgreSQL startup failure. The captured container log is empty, consistent with the container still running when the assertion failed; no startup error text was observed.

## Cleanup and evidence

After the failed validation, the runner rechecked the exact container task/revision/run labels and stopped only that container ID. `--rm` removed it. Final inventories matched baseline exactly: 23 containers, 109 volumes, 7 networks; no added or missing IDs. The worktree remains clean at the exact candidate SHA.

Private mode-0600 runner and receipts are in `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query786-runtime-ffe63ec3-attempt2/`. They include the runner source, inspect JSON, logs (empty), setup assertion error, cleanup receipt, and before/pretest/after inventory receipts. No test output exists because no test process ran. No additional PG attempt was started.


---

## Authentic report: query786-ffe63ec3-focused-pg-attempt3-result-luna.md

Source SHA-256: `04186089d6b3ae039a809e21d444fa5df3c96ae3718e3d35d87cd1f1a92919c3`. Original bytes follow.

# Query #786 focused PostgreSQL attempt 3 — exact candidate runtime result

Candidate: `ffe63ec3a2cff5b78b37d02c2034807e47a2b411` on `codex/786-label-await-scope-repair-luna`. The worktree was clean before and after the one authorized Vitest invocation; HEAD stayed on this exact SHA.

## Result

The corrected operator established PostgreSQL 18 successfully and ran the requested 11 integration files once. Native Vitest child exit code was **1**, with no timeout; 5/11 files failed and 6/11 passed, with 13 failed and 95 passed tests (108 total). Vitest duration was 36.10 seconds. The full, unmodified native output is `query786-runtime-ffe63ec3-attempt3/vitest.full.log` (mode 0600); exact argv, cwd, return code, start/end UTC, duration, timeout and CI state are in `vitest-result.json`.

Failed tests were:

- `label-detach.test.ts`: five attach/detach HTTP cases failed; expected 200 but received 500.
- `label-lock-order.test.ts`: one lock-order case failed with PostgreSQL `42P01`; the generated SQL references `label.workspace_id` although the FROM alias is `labelTable`.
- `label-repository.test.ts`: four cases failed with the same `42P01` alias mismatch (`label.workspace_id` versus alias `labelTable`).
- `label.test.ts`: one create-label HTTP case failed; expected 200 but received 500.
- `project-reach-reads.test.ts`: two assertions failed, one expected a workspace definition in visible rows and one expected the soft-deleted project label to be absent.

These are recorded observations from this run; the full traces are retained for diagnosis. No source fix or rerun was performed.

## Database and ownership evidence

The owned `postgres:18-alpine` container ID was `fa0acc52365ec4ff64b1865cf77b5473e71d301ced7ded57d7ee3dd4602d0d91`, labeled with task/run `query786-ffe63ec3-attempt3-pg` and revision `ffe63ec3a2cff5b78b37d02c2034807e47a2b411`. Docker inspect recorded `/var/lib/postgresql:size=1g` in `HostConfig.Tmpfs`, an empty `Mounts` array, and one dynamic loopback binding at `127.0.0.1:32794`. The private full container `/proc/mounts` receipt proves `/var/lib/postgresql` has fstype `tmpfs`. PostgreSQL readiness passed on the second probe (`/var/run/postgresql:5432 - accepting connections`) before Vitest began.

`CI` was absent from the child environment. The temporary credential file was mode 0600 and removed after the run; no credential was printed. Full Vitest output, PostgreSQL logs, mount proof, inspect data, readiness, invocation and inventories are mode 0600 in `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query786-runtime-ffe63ec3-attempt3/`.

Cleanup rechecked the exact task/revision/run labels, stopped only the owned container ID, and confirmed `--rm` removed it. Final inventories exactly matched baseline: 23 containers, 109 volumes, and 7 networks, with no added or missing IDs. No browser, build, push, PR, or other test invocation was performed.

The earlier two attempts were setup-only and ran no tests. This result is the sole focused PG18 test run for candidate `ffe63ec3`.


---

## Authentic report: query786-insert-selection-preflight-correction-luna.md

Source SHA-256: `5d9d5c8b66cd58e5772bb907fc9d8185e6ad2d3dfae11f346c40269d215ab915`. Original bytes follow.

# #786 label insert-select projection correction

**Result:** corrected the two actor-scoped label `INSERT … SELECT` projections after the conductor’s preflight identified the Drizzle 0.45.2 full-column requirement. This is a one-file follow-up to the local recovery candidate; no PG/runtime test was run.

## Exact source

Base candidate: `3e54e1a87e84ce4e0263bf94de61c9fbe301331a`.
Follow-up commit: `ffe63ec3a2cff5b78b37d02c2034807e47a2b411` on `codex/786-label-await-scope-repair-luna`, in the existing isolated worktree `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`. Worktree is clean after commit. Only `apps/api/src/label/repository.ts` changed.

The repository schema order is `id, name, color, createdAt, updatedAt, taskId, workspaceId`. Both projections now select all seven fields in that order. `id` is supplied with the schema’s CUID2 app default (`createId()`); both timestamps use SQL `now()`, matching the schema’s insert defaults; task/workspace values are sourced as before. The task path still selects from the matching task/project and applies `currentProjectReachPredicate(identity, ...)` plus same-workspace equality. The definition path still selects from the target workspace and applies `currentWorkspaceReachPredicate(identity, ...)`. Both original `ON CONFLICT` targets and ID-only `RETURNING` are unchanged. The later full-row select remains identity-scoped and uses the same transaction executor.

## Drizzle SQL probe

The private, mode-0600 probe source is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query786-insert-select-probe.ts`. It constructs both actual insert-query variants with installed Drizzle 0.45.2 and `.toSQL()` without connecting to PostgreSQL or executing SQL. Assertions checked target column order, server timestamp expressions, conflict clauses, and current reach predicate presence.

The generated task statement begins:

```sql
insert into "label" ("id", "name", "color", "created_at", "updated_at", "task_id", "workspace_id")
select $1 as "id", $2 as "name", $3 as "color", now() as "created_at", now() as "updated_at", $4 as "task_id", $5 as "workspace_id"
from "task" inner join "project" on ...
where (... current project reach predicates ...)
limit $22 on conflict ("task_id","name") do nothing returning "id"
```

The generated workspace-definition statement begins:

```sql
insert into "label" ("id", "name", "color", "created_at", "updated_at", "task_id", "workspace_id")
select $1 as "id", $2 as "name", $3 as "color", now() as "created_at", now() as "updated_at", null as "task_id", $4 as "workspace_id"
from "workspace"
where (... current workspace reach predicates ...)
limit $15 on conflict ("workspace_id","name") where "label"."task_id" is null do nothing returning "id"
```

The task SQL included the current membership/role and active-admin branches from `currentProjectReachPredicate`; workspace SQL included its current admin and membership/role reach branches from `currentWorkspaceReachPredicate`. All assertion checks passed. Probe parameter values used probe fixtures only; no DB was contacted.

## Verification

- Private Drizzle `.toSQL()` probe above passed for both statements.
- Scoped Biome check passed.
- API application TypeScript check passed.
- API test TypeScript check passed.
- `git diff --check` passed.
- No Postgres, integration test, runtime, browser, Docker, push, or PR operation occurred.

The candidate still awaits the conductor’s focused Postgres window and independent review. This correction does not replace review or acceptance.


---

## Authentic report: query786-preserved-source-recovery-plan-luna.md

Source SHA-256: `7d954e9852c6d70c1cdd96db00d5802828023478bcbeb869c52f069b3ffafbae`. Original bytes follow.

# Read-only recovery plan: existing #786 / #580 batch 5 source

**Result:** the useful existing slice is recoverable; do not merge #786's cumulative branch wholesale. This is a source/provenance plan, not independent review or approval for a future composed head.

## Exact provenance and live state

- Retained worktree: `/Users/heinthura/.codex/worktrees/q580b/Ticketing.v2`, clean at inspection. Branch `codex/query-ownership-580-b5`, exact head `7500e06c8fab34bb61d4d00151d4e4af74b7a4b6`.
- GitHub #786 is OPEN and draft at that exact head, still based on `main` `9bb28099a69d1e599e1d7451ebdf6225e380546c`. Current accepted main is `8c3456be02d6e81c76ed2b7fc35fa7b29850a0d4` (also confirmed by GitHub's current `main` ref). The branch is stale against that accepted head.
- Relevant commit provenance: #786 carries `39fd2f9e` and `c4477744` as its #764/batch-0 ancestry, then label/query move `2f87c275faef88585314a616ca5f85194d60e36d`, then the latest test-only commit `7500e06c` (175-line `label-lock-order.test.ts`). Thus `7500e06c` is not the entire slice and the two ordinary reports below do not cover the latest commit.
- The #786 diff has 19 files: 15 useful label/SLA/calendar source+test files, plus inherited `apps/api/src/database/executor.ts`, two executor tests, and `docs/04-engineering/coding-standards.md`. Avoid carrying those four inherited paths. In particular, current accepted main already has the `Executor` API (`Executor`, `Transaction`, `executorOrDefault`); its exact file differs from the PR branch only in explanatory comments. Use the accepted file and accepted current coding standard.
- #805 is OPEN at `32d2ecbe3642696f7ebc116c87085f0e5f37d4bc`; its four files (app index and legacy WebSocket integration/review material) do not overlap this slice. Do not use it as accepted composition. #799 is also OPEN and its file list includes executor/docs plus attachment files, not label, SLA-policy, or calendar repositories; keep its unaccepted shared-contract changes out.

## Unique source to preserve

Against both authentic PR base `9bb28099a69d1e599e1d7451ebdf6225e380546c` and accepted main `8c3456be02d6e81c76ed2b7fc35fa7b29850a0d4`, the relevant application/test source is absent from accepted main and remains a unique #786 delta. `git diff 9bb..8c` changed only the standards documents among the selected label/SLA/calendar paths; the underlying feature implementations are unchanged there. The bounded set is:

1. `apps/api/src/label/repository.ts` and the eight `label/controllers/*.ts` conversions (assign, create, delete, get, get-by-task, get-by-workspace, unassign, update), plus `label/label-name-lock.ts` as a re-export shim.
2. Awaited result conversions in `apps/api/src/service-calendar/repository.ts` (`getCalendarWorkspace`) and `apps/api/src/sla-policy/repository.ts` (five read functions: work-item SLA source, pinned version, current calendar, goals, policy workspace).
3. Tests: `label-repository.test.ts`, `label-lock-order.test.ts`, and `repository-awaited-results.test.ts`.

The transformation keeps SQL in the named repository, transaction openers in controllers, and transactional statements on the supplied `Executor`. The reviewed source comparison found query predicates/columns/conflict targets and error mapping carried over, with transaction boundaries and event publication at their original call sites. Workspace label listing still receives identity-derived `reachableProjectIds` and filters task-bound labels in SQL; task-id lookup for assignment keeps `workspace_id` in the predicate. Label-id and task-id prechecks remain behind the unchanged route chain: `workspaceAccess.fromLabel/fromTaskId`, `requireLabelRowTaskReach`, `requireBodyTaskReach`, capability/permission checks, and the separate reach-filtered workspace-list path. The repository move did not add a route, policy, schema, event, dependency, or migration.

The family advisory lock remains namespace 4007 and takes unique names in sort order before row locks. The controller order (family lock then the existing label/task/project ordering), the same-name copy filter, and ordered `(task_id,id)` copy row locks remain intact. The latest test commit adds deterministic checks for sorted/deduplicated family keys, held label/copy row locks, and copy ordering; it addresses ordinary review A's earlier non-blocking test-coverage observation. The two ordinary reports are for `2f87c275`, before that test-only delta.

The SLA/calendar changes normalize only return behavior. They preserve the existing workspace predicates and callers' `await`/destructuring. The added test covers the six named read helpers and confirms native Promise + resolved empty arrays for missing ids.

## Existing evidence and limits

- Two private independent ordinary reports exist at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/786-ordinary-a-sonnet.md` and `.../786-ordinary-b-sonnet.md`. Both are Claude Sonnet 5.5 and APPROVE at exact `2f87c275...`, each reports no blocking findings. A noted three-property lock test gap was addressed by `7500e06c`; B's additional Executor/tenant-shape and current-doc alignment notes are addressed only insofar as source semantics were reviewed, and its report explicitly asks to rebase/update to final #764/current docs. Neither report is an exact-head review of `7500e06c`.
- GitHub checks on exact #786 head `7500e06c...` (run 38746920231 / 38746920358) are green except `pull request template + security review` (failed). Hosted PostgreSQL18 log records **207 files / 2,941 tests passed**. This is actual hosted execution for the branch head, not accepted-main-composition runtime evidence. The PR body separately claims targeted CI=true 10 files / 94 tests, API unit 120 files / 859, permissions 16 files / 107, typecheck/Biome/route-policy; treat those as author assertions. The private ordinary reports recorded targeted runs at `2f87c275` (A: 9 files/64; B: 8 files/60); those are distinct head/scope reports, not current-head proof.
- The latest candidate has no submitted GitHub reviews (`gh api .../pulls/786/reviews` returned none). The PR body still says ordinary and security reviews pending. No independent Sol security report for #786 was found. The existing ordinary reports do not authorize acceptance. No test was run during this read-only audit.

## One concrete author action after root selects the actual accepted base

Preserve #786 and its evidence in place. The #786 source owner should make a new isolated selective composition from the then-current **actually accepted** `main`, taking only the 15 paths above from `2f87c275` plus `7500e06c`; omit executor files/tests and branch copies of workflow/standards docs. Use the target's current `Executor` and coding-standard contract, then resolve any source-context drift rather than bringing old cumulative history. Do not begin that composition on #805's unaccepted head.

Before that composed candidate can advance, close one precise risk-sized review/evidence gap: since the existing two independent Sonnet APPROVEs cover `2f87c275`, obtain a fresh ordinary review of the `7500e06c` lock-test delta/current composed source and an independent Sol confirmation. This is security-scope because eight changed files are under `apps/api/src/**/controllers/**`; if the Sol reviewer confirms the move did not change authority or gate semantics, the required Sol depth is the lightweight confirmation row, not a new full authority redesign review. The ordinary source panel already exists for the earlier source delta; any current-head review must name the actual composition SHA and the exact delta it checks.

Run focused tests on the actual composed source (not before composition): `label-repository`, `label-lock-order`, existing label controller/detach tests, bulk-rename and workspace-cascade/task-delete race tests, `repository-awaited-results`, plus SLA-policy/calendar evaluation suites. Keep the cross-workspace matrix explicit: nonexistent and foreign task ids return the same masked outcome on label assignment; workspace label listing yields definitions only for empty reach and only task copies in reachable projects; foreign workspace rows are absent; family rename/update/delete/copy-lock operations retain transaction ordering; every touched SLA/calendar helper resolves rows (never a builder). The hosted 207/2,941 result is prior-branch evidence and cannot replace these composition-bound results or current required checks.

No new owner decision is needed: WI-8 and the current query-ownership rules specify the relevant contract, and the implementation is a query relocation/return-shape normalization. No blanket identity wrapper, fresh migration, new query framework, or feature scope is warranted.


---

## Authentic report: query786-source-repair-author-luna.md

Source SHA-256: `cb7105ebf4d0d7ce3c680e8cec6475223bc731e5f2d59d66990a499fbef14db1`. Original bytes follow.

# Query #786 bounded source repair — author Luna

Candidate: `2a855f7cdf5d53457185eeca019ecdce74071ada`, commit `fix(api): keep label reach queries alias-safe`, based on reviewed candidate `ffe63ec3a2cff5b78b37d02c2034807e47a2b411`. The worktree is clean. No PG runtime, full integration invocation, build, browser, push, or PR action occurred during this repair.

## Source changes

`apps/api/src/label/repository.ts` now uses ordinary `select().from(labelTable).where(...).limit(1)` query builders for both task-label-name and workspace-label-name resolution. The shared identity predicates remain attached to the builders; no alias-specific SQL string was introduced. The task-project branch of `currentLabelReach` now requires `project.deletedAt IS NULL`, preserving the independent archived-project read behavior. Query functions that return Drizzle statements explicitly await/materialize their results; existing result shapes are unchanged.

The customer case in `project-reach-reads.test.ts` now expects exactly the organization-visible project task label and therefore excludes both the hidden project's label and the workspace definition. The public-route 401 assertion remains. The existing soft-deleted-project negative remains and a reachable archived-project positive was added. `label-repository.test.ts` now exercises both corrected name lookups with positive current-reach and foreign-workspace negatives. `repository-awaited-results.test.ts` includes native-Promise/resolved-array checks for the label list helpers and awaited optional-row checks for both name helpers. `tests/api/label/repository-query.test.ts` performs actual Drizzle PostgreSQL SQL generation without connecting to a database; it verifies both query forms use the unaliased physical label table and that current workspace/project membership predicates are present, including the deleted-project filter.

Output-shape audit: task/workspace insert statements still return only inserted `id` before the scoped row lookup; task/workspace bootstrap helpers keep their minimal `id/projectId/workspaceId` or `id/workspaceId` facts; the label snapshot stays `taskId/workspaceId/name`; task-copy family scans remain minimal (`labelId/taskId/projectId`, task IDs, or label IDs). `lockLabelRow`, `findLabelById`, and identity-scoped delete continue to return a full label row where callers need the canonical row or event payload. `deleteLabelsByIds` still uses full-row `returning()` because workspace-family deletion builds `task.label_deleted` events from each deleted label. No copy-family reach filter, lock order, namespace, transaction boundary, mutation scope, or event behavior changed.

## Checks

- Offline generated-SQL unit test: 1 file, 2/2 tests passed, no database connection.
- API source typecheck and API test typecheck both passed.
- Scoped Biome check passed on all five changed source/test files.
- `git diff --check` passed; commit hook’s scoped Biome check passed.
- No PG execution was performed; the recorded 5-file/13-test failure on the prior SHA remains adverse evidence and was not rerun or relabeled.

Checker note before future `check:queries` wiring: the current root `package.json` has no `check:queries` script, while `scripts/ci/test-all.mjs` lists it. The 2026-10-15 D1–D4 decision says the enforced gate is enabled only by its final batch. This candidate neither adds nor claims that checker, baseline, or gate wiring; resolve that existing final-batch contract at its owner before enabling the gate.

The bounded delta is ready for root’s exact-head review. Root owns the review tier and any subsequent one-window focused PG authorization. Independent review and security clearance remain outstanding.


---

## Authentic report: query786-source-repair-followup-luna.md

Source SHA-256: `de70412da6d11d4d86ee4261dafdea56bc83d7ea2158a019e5908e1214dd8b92`. Original bytes follow.

# Query 786 source repair follow-up (Luna author report)

Date: 2026-10-16

## Candidate and provenance

- Worktree: `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna`
- Branch: `codex/786-label-await-scope-repair-luna`
- Base: accepted main `8c3456be02d6e81c76ed2b7fc35fa7b29850a0d4`
- Prior implementation commit: `2a855f7cdf5d53457185eeca019ecdce74071ada`
- Follow-up commit: `10f209b9a309861ce70223f0639d6ae6e2727f80` (`fix(api): keep label lookup queries awaited`)
- Worktree is clean after commit. No push, PR, source mutation in the preserved `q580b5` worktree, or ref/history rewrite.

## Follow-up delta

Removed the two new public `build*LabelByNameQuery` exports and inlined awaited select/from/where/limit queries in `findTaskLabelByName` and `findWorkspaceLabelByName` in `apps/api/src/label/repository.ts`. Deleted `tests/api/label/repository-query.test.ts`, whose only purpose was to expose and inspect query builders. This restores the #580 contract against unawaited/composable repository query builders and leaves behavior covered through existing repository/API integration tests. No production test seam was added.

The base-to-candidate source includes the previously approved identity-scoped label content reads/DML, current project/workspace reach, deleted-project liveness predicate (while retaining archived-project reach), customer direct repository fixture correction with public-route 401 retained, explicit awaited/materialized results, plus existing SLA/calendar awaited-result normalization. Family mutation lock/order/transaction/event/copy semantics remain preserved. The removed test is not represented as current coverage.

## Checks and runtime evidence

On the final candidate, these completed successfully:

- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json`
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json`
- `pnpm exec biome check apps/api/src/label/repository.ts tests/api-integration/label-repository.test.ts tests/api-integration/project-reach-reads.test.ts tests/api-integration/repository-awaited-results.test.ts`
- `git diff --check`

No PG/runtime/test invocation was run for `10f209b9`; focused runtime remains pending root review and a new explicit run authorization. The last authorized focused PG18 run was on earlier SHA `ffe63ec3a2cff5b78b37d02c2034807e47a2b411`: 11 files, 108 tests, 95 passed and 13 failed across 5 failed files / 6 passed files. The concrete RQB alias defect and project-reach fixture/liveness failures from that earlier candidate were addressed in subsequent source changes, but those are not yet runtime-verified at the current SHA. The two earlier setup-only attempts ran zero tests and are not test failures. Original full log and report remain unchanged at the previously recorded private paths.

## Review status and remaining gate

This is security-sensitive identity and repository SQL scope work with meaningful structural repair; it requires the previously specified three fresh ordinary GPT-6 Luna reviews and a full independent GPT-6 Sol security review on the final frozen candidate. Author checks above are not review evidence. No approval/merge claim is made. Next action: root reviews this exact source delta and decides whether to authorize the single focused 11-file PG18 runtime window; do not start another DB window before that authorization.

The `check:queries` CI wiring question remains governed by the dated D1-D4 decision and is not modified here. This report does not assert checker status beyond the established checkout finding that the script is referenced by `scripts/ci/test-all.mjs` but absent from root `package.json`.


---

## Authentic report: query786-accepted799-security-61-sol.md

Source SHA-256: `938f83eace904391a2f052069af6807990ddb0ae278d9acd90469b85d4aa73bf`. Original bytes follow.

# Query786 — accepted799 security composition confirmation

**Model:** GPT-6.1 Sol
**Reviewed head:** 40fe67d7412400f41f91184e5fd67f5eee3a50cb
**Comparison base / accepted main:** f5d8f51c1d502b58af2e7b6b9cf01a6e01f7680e
**Previous full-reviewed source / first parent:** e31b292f14a2701db9b950dc69ac344208293f7a
**Verdict:** CLEAR for this bounded accepted-main import/security composition confirmation. No blocking or nonblocking composition finding identified. This preserves the prior FULL e31 security review with its original source, scope and attribution; it is not a new full-main or whole-attachment review.

## Independence and provenance

Fresh context `/root/query786_accepted799_security_sol`, explicitly assigned GPT-6.1 Sol by the conductor for security confirmation after ordinary composition review. The platform identifies this assistant as GPT-6; an independently inspectable served variant/version fingerprint is not exposed. The model label records the explicit assignment, not a measured provider fingerprint. I did not author, direct, advise on, remediate, or ordinarily review this candidate, either parent, or their source repairs. No child agents used.

The actual candidate SHA above has exactly 40 characters. I read the original accepted799 ordinary report fully and its authentic SHA erratum fully. The original report contains an invalid 41-character transcription; it is preserved. The separate erratum explicitly rebinds its CLEAR verdict to the actual checked-out 40-character head, with fresh native identity/tree checks. I independently verified that actual head rather than adopting the original typo.

## Independent composition verification

Read the repository AGENTS, workflow, CLAUDE provider adapter, active mission, query-ownership/materialization/executor standards, attachment contract, relevant intake IQ-5a/IQ-9, portal CP-16 and multi-tenancy query-scoping contracts. Read the complete private e31 cleared-source packet/custody, FULL e31 Sol report, accepted799 composition proof, original ordinary report and mandatory erratum. Read the retained attachment FULL04bc and accepted805 composition security evidence as historical evidence, not as a substitute for current source inspection.

Native HEAD is `40fe67d7412400f41f91184e5fd67f5eee3a50cb`; its two exact parents are the e31 source and accepted-main base recorded above. Worktree `/Users/heinthura/.codex/worktrees/786-label-await-scope-repair-luna` is clean. Independently enumerated complete recursive Git trees using Python subprocess `git ls-tree -r -z`, comparing mode/type/blob entries. All 19 source-owned paths match e31 exactly. All 3360 other paths in the candidate/base union match accepted main exactly. No resolution content is present. `git diff --check` against accepted main passes. These comparisons include modes and missing/additional entries, not just net blob hashes.

Additionally confirmed that the identity SQL helper, shared executor, database schema, task/project live-lock helper, caller-identity resolver and WebSocket consumer are unchanged from e31. The first-parent import is precisely the 16-path accepted attachment source/test/note unit. No UI file or web API consumer is changed by this composition.

## Actual security seams inspected

Inspected current attachment repository content/reach/completion methods, route identity threading and response mapping, download controller, completion rollback diff, both reach middleware and approval fixture diff. The attachment production code neither replaces nor changes the retained label repository/controllers, awaited SLA/calendar helpers or label tests. Both feature units use the same unchanged SQL reach predicates and executor contract, with their own statement construction and caller transaction handles. No altered shared contract, authority source, escaping builder or transaction crossover was found at this composition seam.

Work-item attachment content uses resolved staff identity and current project reach correlated through the persisted attachment/work-item/project relation. Submission content independently binds the direct and accepted-transfer arms to the persisted submission/requester and exact persisted work-item link; staff transfer content also requires current project reach. The completion full-row lookup rejects absent/noncustomer or mismatched-requester identities, and its correlated EXISTS arms require persisted requester/workspace and either direct parent or exact accepted persisted transfer. The minimized reach lookup is separate from the content read. Route handlers resolve the request credential identity; stored key scope and owner-capability ceiling remain in the unchanged resolver and middleware capability decision. Rollback cleanup retains only the authorized final key captured after scoped locked admission, without an unscoped postrollback storage-locator reread. DTO mapping excludes objectKey. These accepted attachment mechanisms do not introduce a new label or task/event consumer path.

The fixture change selects the canonical global organisation customer role with null workspace, system marker, exact compiled rank/capabilities and validates it before use. It grants explicit organisation membership with seesAll false to existing customer-side fixture people; addCustomer uses the same helper. It does not grant project or instance authority or alter production identity code. I inspected the current completion/content regression matrix: real resolved distinct requester identities, direct and exact accepted-transfer positive controls, separately hidden attachment, null/missing/foreign/duplicate/nonaccepted/forged-link denials. The atomic-conversion fixture explicitly admits the requester and grants staff project read authority; its rollback assertions capture the real randomized finalize target and require unauthorized completion to cause no extra cleanup. These are static test-source observations, not execution results. The unchanged project-reach label test continues to use separate direct repository customer visibility and staff-route denial semantics.

The label deletion helper still returns exactly taskId for family copies, and current deletion events carry task/project identifiers without label content. The unchanged WS consumer consumes the task/project invalidation shape. The previous full e31 report independently resolved old S1; this composition introduces no new evidence warranting reopening it. Its clearance does not close global N1 or the unwired structural checker.

## Commands, evidence and limits

Actually executed read-only `pwd`, `cat`, `sed -n`, `rg`, `ls`, `head`, `tail`, `git status --porcelain`, `git show -s`, `git rev-parse HEAD`, `git diff --stat`, `git diff --name-only`, targeted `git diff`, `git diff --check`, and Python subprocess tree comparisons with `git ls-tree -r -z`. Some combined outputs were truncated; important current repository methods, matrix and response contracts were subsequently read in bounded ranges. A guessed data-access contract filename was absent; actual coding-standards and multi-tenancy contracts were read instead. No source/ref/GitHub mutation, tests, PostgreSQL, Docker, browser, build, services or runtime action was performed. The only persistent mutation is this unique private report, created exclusively with mode 0600.

The e31 packet/full report attributes 11 files/117 tests, native exit 0 and 37.605 seconds to the operator's source-bound PG18 run. I did not reproduce it or independently validate its raw runtime inventories. Accepted799 main/runtime acceptance claims remain their original operators' evidence; they are not new execution at this composed head. No typecheck, API integration, image, browser or hosted-CI pass is claimed by this static review.

AT-7 immediate deletion without requester-approved pending action remains separately UNWAIVED; this does not accept the complete attachment feature. No merge authorization/readiness, publication, old-PR history replacement, whole #580/global N1 closure, checker wiring, stage/finalizer, image/release or SIT acceptance is granted. BROWSER VERIFICATION: BLOCKED — outside this read-only API composition review. Future source changes require their applicable review. The proposed focused replacement PR publication does not change this source target and is outside my actions.


---

## Current exact-source publication binding

**Reviewed head:** `40fe67d7412400f41f91184e5fd67f5eee3a50cb`

Current source normally composes full-reviewed e31 with protected accepted799 mainf5d8f51c1d502b58af2e7b6b9cf01a6e01f7680e. Nineteen own source/test blobs are unchanged; every other recursive tree entry/mode equals main. Three6b ordinary reviews plus current e31 strong delta and full independent Sol clearance retain exact scopes; fresh40fe ordinary import review with authentic SHA erratum and independent GPT-6.1 Sol import confirmation are CLEAR. The original ordinary report's invalid41-character SHA is preserved solely as an authentic transcription error; its unchanged separate erratum and independent security check bind to the actual40-character head above.

This publication adds only this regular review note after the reviewed source; it cannot supply its own independent approval. Operator e31 PG117/117 and actual owned cleanup remain e31 evidence, not new40fe execution. Original Sonnet2f87 reports and failed/blocked attempts are retained as historical evidence, never current acceptance. The original cumulativePR786/7500 branch is preserved; this selective recovery is a focused replacement and does not import unrelated unaccepted stacked history. Close the predecessor only after its unique source is accepted/proven equivalent with evidence.

Current hosted tests/counts, image build/boot/migrations/health/isolation/cleanup and normal protected merge remain pending. No gate waiver, checker wiring, global N1, whole580/feature/stage/finalizer/release/SIT/restore acceptance follows. AT-7 and separate Carrier791/798 performance findings remain undisposed.
