# Approval query ownership recovery — #580

Current composition source `88b7807378447cc74e584a37a48f277ddc1c34c8` against accepted main `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`: 15 owned source/test paths. Three independent ordinary contexts cover the full recovery plus repair deltas; fresh independent FULL security review covers all15 at f7fb4cb6f8038deeb257709f776553023456c3d8. Current composition has separate ordinary and independent Sol confirmations. All15 owned mode/blob entries and31 imported accepted-main entries are conserved, with no overlap. Whole-tree equality with f7fb is FALSE: the 31-path accepted task/reset import is real. The original ordinary report's inaccurate equality statement is explicitly withdrawn by its separate authentic correction below. Both reports remain unchanged.

Scope: canonical actual request identity/key/impersonation propagation; current SQL project/private requester-or-participant reach; narrowly related own approval metadata after lost reach; session-only current-admin withdrawal; full16-column INSERTSELECT/default/UTC/expiry-codec preservation; required returned rows; transaction-local decision/withdrawal/transition closure and exact notification cleanup; existing bounded reminder scan. No new schema, route, capability, dependency or general producer exception. Private null-requester facts remain restricted, customer reach uses project organisation, and genuine fixtures preserve denial/no-write and exact expiry oracles.

Actual root focused PostgreSQL atf7fb: 14 functional files91/91/native0/49.485s, both real gate and scan timezone wrappers, exact expiry ISO/epoch checks, raw159565bytes SHA256156161bd66aa9f1bff0a04dd3bdf7687d0884e319c4a8fcd40bfccc136e0d1d3. Exact owned cleanup restored23containers109volumes7networks unchanged. Priorb27e run failed15 of89 tests/eight of14files/native1/47.91s (raw167529bytes SHAace179d3df30f538a05c48512ba55655a14279c75be08754d5c103b9235aa783); its initial source clearance, runtime BLOCKED follow-up and repaired-source clearance are retained below. This is not a current composed full-suite/image/browser proof; all current exact-publication gates remain mandatory.

A private planning addendum was accidentally overwritten during recovery. Its authentic22335byte original was restored exactly from retained root-session output, hashc406f98c0cdde8567b7d65c6e2bcb64a2bbce9dccefe3a5feafc5a5602672826. The overwritten version and recovery receipt remain restricted; the restored authentic planning artifact remains in restricted evidence; it is not reconstructed or relabelled as review approval. Author/planning reports are not independent reviews.

Residual: GM-9 general impersonation-decision refusal/double-audit remains unestablished; native issuance is refused and no instance issuance route exists. This slice grants no impersonation feature compliance or activation. Other disclosed approval/workflow/notification limits and prior source remain preserved. No whole#580, stage, signed-release or SIT claim.

Dispatch provenance: root explicitly selected GPT-6 Luna for implementation/ordinary contexts and GPT-6.1 Sol (`fork_turns=none`, high reasoning) for full/current security contexts. A verified served-model/runtime fingerprint is unavailable; original reports retain their actual limitations. Root composed/published and is not an independent reviewer. Every blocked/adverse/corrective review below remains at its actual scope. The composition Sol lane's earlier usage-limit attempt produced no approval; its resumed completed report is retained.

## Evidence file

`query789-existing-source-current-main-recovery-plan-luna.md`

# #789 approval query-ownership recovery plan (read-only)

**Prepared:** 2026-10-17
**Worktree inspected:** `/Users/heinthura/.codex/worktrees/query773-current-luna`
**Accepted baseline:** `c022915a8768b96b460c798feafafd7d48214d5c` (`origin/main` in this checkout)
**Current composition:** `d7f628fa89cedc25d610f93c5bd49ce6ae9c2df9`
**Preserved #789 source:** `726009749120255600b98ddfd320f74eb92e1055` in `/Users/heinthura/.codex/worktrees/q580b8/Ticketing.v2` (clean at inspection)
**Scope:** the four original paths only: `apps/api/src/approval/reminder-scan.ts`, `apps/api/src/approval/repository.ts`, `apps/api/src/approval/service.ts`, `tests/api-integration/approval-repository.test.ts`.

## Finding

The accepted `main` and the current `d7f628f` composition are identical on all four paths. Compared with them, preserved #789 source adds back approval write/query helpers in `repository.ts`, routes service and reminder-scan statements through those helpers, and adds `approval-repository.test.ts`. This is a recovery of existing #789 work, but the historical helpers alone do not meet the current request-authority contract: several receive only an ID/workspace ID and rely on caller-side reach preflight. Preserve their transaction, predicate, row-return and workflow semantics while making request-path repository statements bind the resolved identity and current reach/authorization as required by the accepted contract.

Current `repository.ts` already owns `selectDueApprovalRows` and `withDueApprovalRows`; it orders due rows, limits the batch, locks only approval rows with `FOR UPDATE SKIP LOCKED`, and processes state/event writes in the same transaction. Current request workflows preflight identity/reach, then lock by workspace/item or approval ID. That preflight is not a substitute for identity-aware reach in the request SQL predicate under the current query contract.

## Statement and caller map

| Current statement / source operation | Current caller and contract | Recovery location and authority requirement |
| --- | --- | --- |
| `INSERT approval` (`service.ts`, create request) | `createApproval`; opens one transaction after policy/capability/reach and approver checks; locks the live item, validates transition, inserts a pending approval; DB clock stamps `created_at` and default expiry after the item lock; returned full row supplies the expiry used by subsequent event/outbox work. | Restore `insertPendingApproval(executor, input)` in `approval/repository.ts`. Pass resolved identity and the already-derived target/item facts. The insert remains anchored to the locked item, and the target/lock query must bind current reach in SQL, not trust only the earlier `hasWorkItemReach` check. Preserve `RETURNING *`, the DB-clock expressions, and same transaction with outbox/audit/notification work. Capability checks (`approval:request` / `approval:request_cab`), staff/CAB and approver eligibility remain the existing service/policy checks; the repository change must not add or widen a capability. |
| `UPDATE approval` to `approved`/`rejected` (`service.ts`, decide) | `decideApproval`; current identity/reach and route capability are checked, then same transaction locks item and approval, evaluates named-approver/self-approval/note/state rules, updates only pending row, writes activity, outbox notifications and audit. | Restore `recordApprovalDecision(executor, input)` in `repository.ts`; carry resolved identity plus approval/item/workspace scope. Statement must retain ID + workspace + pending guards and add a current same-item reach/identity predicate (or rely on an identity-aware locked approval read in the same transaction if the repo contract and implementation prove that predicate authority cannot change across the retained lock order). Preserve returned full updated row and all downstream ordering/transaction behavior. Do not replace AP-7/AP-8 or route capabilities with reach alone. |
| `UPDATE approval` to `withdrawn` (`service.ts`, requester/admin withdraw) | `withdrawApproval`; current admin route rechecks session-only active instance-admin under lock; otherwise domain decision requires actual requester; activity/outbox/audit follows the update. | Restore `recordApprovalWithdrawal(executor, input)` in `repository.ts`. Bind resolved identity, current item reach and the actual allowed principal (requester or the existing verified admin path), keeping ID/workspace/pending predicates. Admin exception is only the already-existing dedicated route with a session credential and fresh active-admin check; do not generalize to arbitrary system/internal callers. Preserve return rows and same transaction/event ordering. |
| Due-approval `SELECT` with joined work item/workspace, UTC due tests, order, limit, `FOR UPDATE SKIP LOCKED` (`repository.ts`) | `reminder-scan.ts` calls `withDueApprovalRows` in batches under existing `reminder-scan` job lease. This is the existing bounded trusted job producer, not a request identity. | Keep `selectDueApprovalRows` / `withDueApprovalRows` in the repository. Retain the exact candidate predicates, DB clock behavior, join scope, row ordering, max batch/run caps, approval-only row locks and one transaction per batch. Do not create a general “internal producer” bypass or a caller-selectable unscoped helper. |
| `UPDATE approval` to `expired` (`reminder-scan.ts`) | Only after the bounded due-row lock; then emits `approval.expired` outbox notification and audit in the same transaction. | Restore `expirePendingApproval(executor, { id, workspaceId, decidedAt })` (or an equally narrow job-only repository operation). Keep ID + anchored workspace + pending predicates and `{id}` return. It is intentionally usable only from this reminder scan callback; it is not a general producer exception. |
| `UPDATE approval.reminder_50_sent_at` / `reminder_90_sent_at` (`reminder-scan.ts`) | Only after the same due-row lock and domain calculation; enqueue expiring notification after successful stamp. | Restore `markApprovalReminderSent(executor, ...)` with the existing enum choice, ID/workspace/pending predicates, `{id}` return, and transaction ordering. No notification is enqueued when no row updated. |
| `UPDATE approval` closing pending rows for a consumed transition (`service.ts`) | `closePendingApprovalsOnTransition` runs from the existing work-item transition transaction after its work-item lock and activity transition write. It uses `expired`, returns id/kind/approver, deletes inbox rows, writes `approval.closed` audit entries, and emits no `approval.expired` event. | Put the statement in a narrow `closePendingApprovalsForTransition(executor, {workspaceId, workItemId, transitionId})` repo helper. Preserve exact scope and `RETURNING` fields. Keep service orchestration for person/workspace lookups, notification deletion, audit and event behavior routed through named repository helpers. This operation is bounded to the existing transaction caller and exact transition context; it does not justify a blanket producer exemption. |
| `SELECT person.id WHERE person.user_id=actorId` (`service.ts`, transition closure) | Used to map the existing transition actor user ID to person ID for approval audit rows. | Restore `findPersonIdByUserId(executor, userId)` in repository; keep optional/no-actor behavior and same transaction. It is a scoped key lookup from a known actor, not a reach-bearing resource read. |
| `SELECT workspace.organisation_id WHERE workspace.id=workspaceId` (`service.ts`, transition closure) | Supplies org scope for `approval.closed` audit entries. | Restore `findWorkspaceOrganisationId(executor, workspaceId)` in repository, called with the same transition scope/transaction; preserve undefined behavior. |
| `DELETE notification WHERE resource_type='approval' AND resource_id IN(closed IDs)` (`service.ts`) | Removes inbox rows for approvals closed by transition, before audit loop completes. | Restore `deleteApprovalNotifications(executor, approvalIds)` in repository. Keep exact resource type and IDs from the statement's returned closure rows; same transaction. |

Existing approval reads (`loadApprovalTargetByKey`, `loadApprovalTargetByApprovalId`, `loadApprovalAddressing`, `listApprovalRows`, `lockLiveWorkItem`, `lockApproval`, feature/approver/CAB/transition facts and `hasWorkItemReach`) already live in `repository.ts`. The current implementation of `lockLiveWorkItem` and `lockApproval` is ID/workspace scoped only; recovery must upgrade the request-path lock/read API to take `ResolvedIdentity` and apply the canonical current reach predicate in the statement. Reuse `currentProjectReachPredicate` from `apps/api/src/database/repositories/identity-scope.repository.ts` where its exact project/organisation semantics match. Approval visibility also has the existing private-item requester/participant rule in `hasWorkItemReach`; do not silently replace it with project reach alone. Reconcile that rule in the SQL-bound request read/lock before deciding it is covered.

For caller statements that write/return approval rows, the accepted rules require both repository ownership and current caller reach in the statement predicate where the operation can cross organisations. Bind the resolved identity and authorized target; a caller-supplied workspace/project ID is only a narrowing value. Keep existing capability and domain checks as independent authority checks. A write predicate must not weaken the checks for requester vs named approver, customer vs staff, CAB membership, self-approval, private requester/participants, or admin-withdraw. No new capability, feature flag, identity kind, generic producer mode, or route is needed.

## Current contract and decision check

- `docs/01-architecture/monorepo-layout.md` on accepted `main` says `repository.ts` is the only place feature-table select/insert/update statements may appear and says cross-organisation reads use scoped repository functions taking resolved identity; supplied IDs must be checked against identity and included in the statement predicate.
- `docs/01-architecture/multi-tenancy.md` and `security-model.md` say reach is derived from the resolved identity and applied in the query predicate; repository location alone does not prove scoping.
- `docs/04-engineering/coding-standards.md` in the inspected composition spells out #580 repository locations, transaction handles, `Executor`, awaited returned rows, and no generic DB-directory allowlist. The 2026-10-15 decision-log entry is newest and records D1–D4 as conductor implementation decisions under the existing contract, with `check:queries` wired only in the final batch. It explicitly says those choices do not replace identity-derived reach and do not claim the checker proves predicates. The entry's note that full text is proposed in #764 is older evidence; current accepted `main` file contents take precedence for this composition.
- Approval behavior is already specified by `docs/03-features/approvals.md` AP-1–AP-13 and the 2026-10-10 approval entries in `decision-log.md`; transition closure, expiry, notifications and audit outcomes are already determined. The newest decision log has no new unresolved approval behavior that requires Thomas. The remaining work is implementation against existing authority; the narrow private-item SQL reach mapping is an implementation question to resolve from existing predicates/tests, not permission to invent a new policy.

No owner decision is currently evidenced as missing for this recovery. If the existing canonical SQL predicates cannot express the current approval private-item reach rule without changing policy, stop only that implementation path and present the exact rule conflict for owner decision; do not add a shortcut or broaden access.

## Smallest complete candidate boundary

The historical net source delta is the four listed paths. A complete current-contract repair likely needs those same four paths: repository helpers and identity-aware predicates; service/job calls and transaction orchestration; regression tests. Avoid `transition-work-item.ts` changes unless inspection during implementation proves its existing executor/identity context cannot be passed through the current `closePendingApprovalsOnTransition` seam. Do not edit specs/contracts to bless the historical workspace-only predicates. Do not enable `check:queries` early; it is the final #580 batch gate.

## Required verification when this becomes an authorized implementation task

No tests, typecheck, build, browser run or other verification was run for this read-only task. For the eventual source candidate, preserve and run the focused real-PostgreSQL integration test in `tests/api-integration/approval-repository.test.ts` plus approval integration coverage. Ensure it proves (a) wrong workspace and lost current identity reach do not mutate/read rows even when the service preflight is stale, (b) only pending rows transition and concurrent decisions/withdrawals/reminder scans behave under locks, (c) transition close touches only the exact workspace/work item/transition and deletes only those approval inbox rows, (d) 50/90 reminders and expiry preserve DB UTC boundaries, returned rows, outbox/audit ordering and rollback atomicity, and (e) current approval capabilities, private-item requester/participant reach, named approver, requester withdrawal, session-only admin withdrawal and API-key scope remain enforced. Then run the API integration suite/count required by the active queue; no test claim is made here.

## Commands actually run and limits

Read-only inspection commands in the designated worktree included: `git status --short --branch`, `git rev-parse`, `git show -s`, `git diff --stat`/`--name-status`/path-limited diff across the exact source, accepted and current SHAs; `git merge-base --is-ancestor`; `sed` on AGENTS/workflow/CLAUDE/mission/queue/status/approval and query-contract docs; and `rg` over approval SQL, callers, decision log, identity-scope and repository/executor files. No source or shared-doc file was edited. No tests, typecheck, PostgreSQL, Docker, build, browser, inventory-heavy command, GitHub mutation, commit, push or PR operation was run. The requested output is this private file, mode `0600`; the worktree and preserved source worktree remain unchanged.


## Evidence file

`query789-current-recovery-author-luna.md`

# Query 789 current-main recovery author report

Date: 2026-10-17

## Source identity and scope

- Current isolated worktree: `/Users/heinthura/.codex/worktrees/query789-current-luna`
- Branch: `codex/query789-current-main-luna`
- Base/current HEAD: `c022915a8768b96b460c798feafafd7d48214d5c` (working tree changes are uncommitted)
- Preserved original #789 source worktree: `/Users/heinthura/.codex/worktrees/q580b8/Ticketing.v2`, source SHA `726009749120255600b98ddfd320f74eb92e1055` (read-only)
- Original source had four unique files: approval `reminder-scan.ts`, `repository.ts`, `service.ts`, and `tests/api-integration/approval-repository.test.ts`.

Implemented the authorized recovery plus current-scope completion in nine source paths:

1. `apps/api/src/approval/repository.ts`
2. `apps/api/src/approval/service.ts`
3. `apps/api/src/approval/reminder-scan.ts`
4. `apps/api/src/approval/evidence.ts`
5. `apps/api/src/approval/index.ts`
6. `apps/api/src/work-item/index.ts`
7. `apps/api/src/work-item/controllers/transition-work-item.ts`
8. `apps/api/src/work-item/controllers/list-work-item-transitions.ts`
9. `tests/api-integration/approval-repository.test.ts` (restored from preserved original source and extended)

Identity/signature fixture prerequisites, all preserving existing test assertions, are in:

- `tests/api-integration/work-item-transition.test.ts`
- `tests/api-integration/approval-tenant-checks.test.ts`
- `tests/api-integration/approval-closure-and-clock.test.ts`
- `tests/api-integration/approval-feature-flag.test.ts`

## Recovery behavior

The approval request reads and writes now use the canonical current request identity and repeat current project/workspace reach plus private-item requester-or-exact-participant visibility in the same resource SQL statement. Supplied IDs narrow results only. The own-approval metadata path is restricted to the exact addressed approval relation and existing requester/named-approver relationship. Session-only admin withdrawal still requires an active current admin fact in the SQL predicate; no caller-supplied boolean alone grants the branch.

The approval INSERT uses a conditional `INSERT ... SELECT` with the existing full approval columns/default clock expressions. Decision, withdrawal, transition closure, and due reminder writes are repository methods with explicit executor/transaction context. The named reminder scan remains the only caller of due-job write helpers; scan lease, due ordering, `SKIP LOCKED`, UTC clock handling, transaction behavior, event/outbox/audit/notification ordering, and transition closure semantics were retained. The transition HTTP route and transition-list route resolve and thread the actual request identity. No schema, route, capability, dependency, event, or general internal-producer exception was added.

## Checks actually run

- `pnpm --filter @taskdesk/domain build` — passed (existing package declaration prerequisite).
- `pnpm --filter @taskdesk/permissions build` — passed (existing package declaration prerequisite).
- `pnpm --filter @taskdesk/email build` — passed (existing package declaration prerequisite; inspected existing package build script first; no dependency or lockfile change).
- `pnpm --filter @taskdesk/api typecheck` — final run passed after fixture identity adaptation. An earlier run found missing required identities in the five direct calls in `approval-feature-flag.test.ts`; those calls now use the actual fixture user through `resolveRequestIdentity` and retain all expectations. The first run also exposed two source typing issues (Drizzle INSERT-SELECT aliases and an obsolete `state` input), both corrected. A subsequent run was blocked by absent email declarations until the authorized existing email package build completed.
- `pnpm exec biome check` on the 13 changed source/test files listed above — passed.
- `git diff --check` — passed.
- `rg -n "\.(select|insert|update|delete|execute)\(" apps/api/src/approval/reminder-scan.ts apps/api/src/approval/service.ts` — no direct SQL statements remain in the service or scanner; writes are delegated to repository helpers.

No unit/integration test, database/PG, Docker, build, browser, or full-inventory command was run. Those runtime checks remain with the parent verification lane. No commit, push, PR, review, or shared-document edit was made. Package build generated declarations only; changes remain ignored/uncommitted outside the listed source/test diff.


## Evidence file

`query789-expiry-codec-addendum-luna.md`

# Query 789 expiry codec addendum

Date: 2026-10-17

This addendum supplements, and does not alter, `query789-current-recovery-author-luna.md`.

A final pre-freeze source inspection found that the explicit expiry passed to the approval INSERT-SELECT used a raw interpolated `Date`. Since `approval.expires_at` is `timestamp without time zone`, that bypassed Drizzle's destination-column Date encoder. The SQL now wraps the value with `sql.param(input.expiresAt, schema.approvalTable.expiresAt)` before embedding and aliasing it, preserving the existing destination codec. The DB-clock-derived fallback remains unchanged.

Added one exact instant regression to `tests/api-integration/helpers/approval-single-use-suite.ts`, which is consumed by both existing `approval-gate-ahead-utc.test.ts` (Asia/Yangon) and `approval-gate-behind-utc.test.ts` (America/New_York). It posts an explicit expiry 42 days plus 234 milliseconds ahead (within the existing 90-day contract), then asserts HTTP success, exact returned ISO string, and exact persisted epoch milliseconds. It does not change either wrapper timezone or add a new wrapper. Runtime execution remains owned by the parent verification lane.

Audited all application `.insert(...).select(...)` sites: the other two are the existing label INSERT-SELECTs, whose bound values are strings/null and whose timestamps are SQL `now()` expressions. Approval expiry was the only raw JS `Date` in this set.

Checks after this correction:

- `pnpm --filter @taskdesk/api typecheck` — passed.
- Scoped `pnpm exec biome check` over all 14 changed source/test paths — passed.
- `git diff --check` — passed.
- No unit/integration/PG/database runtime test was run.

One intermediate typecheck caught that Drizzle `Param` has no `.as()` method; the value was then embedded in `sql\`${sql.param(...)}\`` and the final typecheck passed. The first draft of the fixture also initially used a date outside the 90-day request policy and missed importing the established request helper; both were corrected before the final static checks. These were source/typecheck corrections, not runtime test attempts.


## Evidence file

`query789-b27e-full-ordinary-a-luna.md`

# Query 789 full ordinary A review — current candidate

Date: 2026-10-17

## Identity, independence, and scope

- Candidate worktree: `/Users/heinthura/.codex/worktrees/query789-current-luna`
- Exact base: `c022915a8768b96b460c798feafafd7d48214d5c`
- Exact candidate HEAD: `b27e6c9bfa7d136ba06db8b6dd36595df49ea36b`
- Dispatch provenance: parent session assigned this fresh independent ordinary A review in the task message. No model selector or serving-runtime attestation was supplied to this context. Runtime fingerprint is unavailable; I identify the requested reviewer tier and do not claim an independently verifiable model/runtime fingerprint.
- Independence: I did not author, direct, or remediate this candidate. Author recovery and codec reports were treated as claims and rechecked against source. I made no source, fixture, shared-document, or Git mutation.

I read the accepted `AGENTS.md`, `docs/07-planning/active-mission.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/04-engineering/coding-standards.md` query-ownership contract, approvals feature spec, relevant query ownership/current identity contracts, and prior approval review records. I inspected all 14 changed paths in the base-to-head diff and relevant approval schema, identity predicates, executor and service call sites.

Changed paths reviewed: `apps/api/src/approval/{evidence.ts,index.ts,reminder-scan.ts,repository.ts,service.ts}`; `apps/api/src/work-item/controllers/{list-work-item-transitions.ts,transition-work-item.ts}`; `apps/api/src/work-item/index.ts`; `tests/api-integration/{approval-closure-and-clock.test.ts,approval-feature-flag.test.ts,approval-repository.test.ts,approval-tenant-checks.test.ts,work-item-transition.test.ts}`; and `tests/api-integration/helpers/approval-single-use-suite.ts`.

## Source-bound findings

**Verdict: CLEAR — no blocking source finding in ordinary review A.**

- The recovered approval INSERT-SELECT explicitly supplies all 16 current `approval` columns. It takes `workspace_id` and `work_item_id` from the selected, locked work item; uses pending/NULL defaults matching the schema; uses the DB UTC clock for `created_at` and default expiry; and wraps explicit `expiresAt` with the destination timestamp column codec. I found no omitted required field or changed nullable/default behavior. The new exact-instant test is a relevant regression, though it was not run in this review.
- Request reads and writes in the changed repository are constrained in SQL by current project reach, live work item/project state, and exact requester-or-participant visibility for private items. Caller workspace/work-item IDs narrow queries alongside those predicates. Lost-reach metadata exceptions are limited to an approval row related by exact requester or named approver identity; generic work-item lookup still fails closed. Decision writes additionally require current reach, pending state, and `approver_id = identity.personId`. Requester withdrawal requires exact requester identity and current reach; the admin exception requires session credential and current database-backed instance-admin predicate.
- The approval evidence and route handlers resolve the request identity with the actual API key and impersonation marker. Work-item transition and transition-list routes now thread that same resolved identity into approval queries. API-key capability ceilings remain supplied to the canonical resolver. The admin withdrawal route retains its session-only boundary and repeats current admin authority in SQL; a boolean option alone cannot grant it.
- SQL moved from approval service/job orchestration into repository methods accepting the transaction handle; query results are awaited. The reminder scan retains bounded selection, DB UTC comparisons, ordering, `SKIP LOCKED`, and transaction sequencing. Transition closure remains narrow to the supplied work item/workspace/transition and pending state, with the same transaction-local notification cleanup.
- The recovered source portion was compared with original #789 source commit `726009749120255600b98ddfd320f74eb92e1055`; the original due-scan helpers and core behavior are present under the new repository names, with the intended current-scope changes. No apparent loss of the original approval repository test intent was found; the new tests cover current reach/private participants, lost-reach own metadata, and explicit timestamp precision.
- Fixture/call-site adjustments pass actual identities to newly scoped repository APIs; the feature flag fixture resolves its real fixture user, and the transition race test resolves the creator identity. No synthetic identity or relaxed assertion was introduced in the inspected hunks.

## Commands and limits

Read-only commands actually run in this review: `pwd`, `git status --short`, `git rev-parse HEAD`, `git diff --stat`, `git diff --name-only`, scoped `git diff --unified=...` for all changed files and original recovery files, `rg`, and source reads with `cat`/`sed`/`nl`. Initial `git status --short` was empty. No tests, PostgreSQL, Docker, browser, build, install, mutation, commit, push, PR operation, or live GitHub check was run. Parent's focused PostgreSQL lane remains separate and is not evidence in this report.

Residual: this is a source-bound ordinary A review only. Runtime behavior, exact-head test results, hosted checks, and the separately required security review remain outstanding to their respective owners. No merge authorization is implied.


## Evidence file

`query789-b27e-runtime-findings-ordinary-a-luna.md`

# Query 789 runtime failure source diagnosis — ordinary A follow-up

Date: 2026-10-17

## Scope and provenance

- Exact candidate inspected: `b27e6c9bfa7d136ba06db8b6dd36595df49ea36b` (base remains `c022915a8768b96b460c798feafafd7d48214d5c`).
- Runtime evidence inspected read-only: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query789-runtime-b27e6c9b/vitest.full.log`, SHA-256 `ace179d3df30f538a05c48512ba55655a14279c75be08754d5c103b9235aa783`.
- The log reports 1 native run, 47.91s, 14 files (6 pass / 8 fail), 89 tests (74 pass / 15 fail); parent reports cleanup 23/109 with 7 unchanged. I did not run or alter the test environment.
- This is a fresh bounded source diagnosis of the supplied failures, not a rewrite of my earlier ordinary A source report. I read the failure blocks and traced them to candidate source and authoritative contracts. No source edit, test, database action, build, or remediation was performed. Model/runtime fingerprint remains unavailable in this context; no independent serving-version claim is made.

## Findings

**Verdict for this exact candidate after the supplied runtime evidence: BLOCKED.** One product-source defect is confirmed; several other failures are caused by fixture assumptions that conflict with current contracts, and must not be “fixed” by weakening the current reach predicates. Parent should keep this SHA unapproved.

### Blocking product-source defect: private work items with a null requester lose their visibility set

In both `loadApprovalTargetByKey` and `loadApprovalTargetByApprovalId`, the source sets `visibleToPersonIds` only when `customerVisibility === "private" && requesterId` (`apps/api/src/approval/repository.ts:615-618` and `:760-763`). When the requester is null, it sets `visibleToPersonIds` to null even if the row is private. The pure evaluator defines null as “no private-person restriction” (`packages/permissions/src/evaluator.ts:353-363`). That makes a private item created without `requester_id` look reachable to any identity which has project reach; participant membership is then not the controlling visibility set.

The source and test evidence line up: the request-time gate-semantics case gets 200 rather than its expected 422 when the non-approver is not a participant; lifecycle reports `approverReachLost: false` after removing the approver participant; and tenant check 6 reaches the deeper SQL lock denial and returns 404 rather than the handler's 403 lost-reach refusal. In `requestWorkItemScope`, SQL does correctly require requester identity or exact participant for private items (`repository.ts:22-51`), so a fresh scoped read/write query remains denied. The defect is the post-query `ProjectReachFacts` used to evaluate another identity and to report current approver reach; its null representation drops the private boundary. This is a source blocker independent of the invalid stale-identity assertion in the new repository test.

### Source/fixture mismatch: customer organisation is read from two different rows

The current reach contract says the customer's reach is the organisation on the **project** row (`docs/01-architecture/multi-tenancy.md` “A project … references the customer organisation it serves”; `docs/01-architecture/rbac.md` reach/customer text; `ProjectReachFacts` comment in `packages/permissions/src/evaluator.ts:329-345`). The SQL predicate uses `project.organisation_id` (`repository.ts:54-67`). Both approval target loaders instead populate `ApprovalTarget.organisationId` / `reachFacts.organisationId` from `workspace.organisation_id` (`repository.ts:591-592`, `:720-724`, then `:619-634` / `:764-779`). That is the wrong fact for customer project reach and for `hasPortalApprovalDecideCapability`, which evaluates the target organisation.

The customer test fixtures call `ensureCustomerOrg`, which changes only `workspace.organisation_id` (`tests/api-integration/helpers/approval-fixtures.ts:377-399`); the shared approval tenant's `createProjectFixture` inserts a project without `organisationId` (`tests/api-integration/helpers/approval-fixtures.ts:45-55`, `tests/api-integration/helpers/fixtures.ts:149-170`). Thus project organisation is null while workspace organisation is the customer organisation. The SQL customer reach predicate correctly refuses that project under the written contract, yielding the observed 404s. These failures are fixture/contract mismatch at the request boundary, while using workspace organisation in the returned target is a separate source correctness defect that would persist after fixtures represented the contract correctly. Do not change the SQL customer reach predicate to workspace organisation to make the current fixtures pass: that would authorize customer access to an internal/null-organisation project contrary to the authoritative project-row contract.

This mismatch explains the customer-related failures: closure-and-clock customer read and helper target load; closure-and-clock customer approval decision; gate-semantics customer CAB request; the four customer portal decision cases (named approver, other customer, CAB kind, rejection without note); and strict-enforcement portal decision. They fail at target lookup / portal evidence with 404 before the intended authorization or decision-status assertion.

### Fixture failures: new scoped helper calls omit the contractually required project reach

`approval-feature-flag.test.ts` now supplies an identity made from `createWorkspaceMember({ role: "owner" })` and a project from `createProjectFixture`, but does not grant project membership or explicit workspace `sees_all`. The repository deliberately scopes workspace/project flag rows by `requestWorkItemProjectScope` (`repository.ts:70-85`, `:656-689`). The test's workspace flag is therefore outside the supplied identity's current project reach and omitted; instance precedence is returned. Current policy says workspace membership alone does not add project reach (`docs/01-architecture/rbac.md`, project reach section). This is an identity-fixture defect, not evidence that the scoped flag query should read another project.

The new private target test's requester-positive assertion has the same kind of fixture mismatch: it creates the item through the staff project route but does not establish that this person is the work item's persisted requester or a participant. It adds the **approver** as participant, then expects the requester to pass the private scope (`tests/api-integration/approval-repository.test.ts:32-46`). The SQL predicate correctly requires `work_item.requester_id = identity.personId` or a participant row (`repository.ts:22-51`); the HTTP actor who created the item is not by itself a requester fact.

### Invalid oracle: a resolved identity object is reused after changing membership rows

The new repository “lost reach” test resolves `approver`, deletes that person's `membership` rows, then calls the pure `hasWorkItemReach(approver, ownTarget)` using the pre-delete identity snapshot (`approval-repository.test.ts:52-68`). `hasWorkItemReach` delegates to pure `reaches(identity, target.reachFacts)` (`repository.ts:1243-1249`); it does not reload or mutate identity. The direct query path in the same test, `loadApprovalTargetByKey`, does use a current SQL reach predicate and is expected to reject. Reusing the old resolved value cannot assert a fresh request's reach. This is a fixture/oracle defect, not a source finding that merits making the pure evaluator perform I/O.

## Failure accounting from the exact log

The 15 failures reduce to the four diagnoses above:

- Private-null-requester source defect: gate-semantics approver reach at request time; lifecycle `approverReachLost`; tenant-checks current approver reach response. These are the most direct behavior mismatches; the exact null-requester conditional is confirmed in both target builders.
- Project/workspace organisation mismatch and customer fixtures: 9 customer-target/portal failures named in the customer-mismatch section. They all report target/work-item/approval 404 before the expected customer behavior.
- Feature-flag current-reach fixture: one failure, expected workspace false but instance true.
- Repository test assumptions: one requester-positive private-reach failure and one stale identity assertion.

No claim is made that these classifications substitute for a corrected exact-head runtime run. The key source defect is blocking even if all fixture-only failures are corrected.

## Actual work in this follow-up

Read-only commands: `shasum -a 256` for the supplied log; `git rev-parse HEAD`; `git status --short`; source reads/line-number reads of the failing tests, approval repository/service, project reach evaluator, approval fixture builders, and authoritative tenancy/RBAC/feature contracts; `rg` over the log and source. No tests or PostgreSQL commands were run in this context. No repair design or implementation was provided, so I remain eligible to review a future remediation candidate as an independent context, subject to dispatch and exact-head requirements.


## Evidence file

`query789-b27e-repair-author-luna.md`

# Query 789 b27e runtime repair author report

Date: 2026-10-17

## Candidate and scope

- Repair base: `b27e6c9bfa7d136ba06db8b6dd36595df49ea36b`.
- Original recovery base: `c022915a8768b96b460c798feafafd7d48214d5c`.
- Worktree: `/Users/heinthura/.codex/worktrees/query789-current-luna`; branch `codex/query789-current-main-luna`.
- Diagnosis evidence read: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query789-b27e-runtime-findings-ordinary-a-luna.md` and `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query789-b27e-focused-pg-failure-receipt.json`. No runtime log was run or altered here.

This repair changed exactly four existing paths:

1. `apps/api/src/approval/repository.ts`
2. `tests/api-integration/approval-feature-flag.test.ts`
3. `tests/api-integration/approval-repository.test.ts`
4. `tests/api-integration/helpers/approval-fixtures.ts`

## Corrections

Both approval target loaders now populate private `visibleToPersonIds` even when `requester_id` is null. The set is then exact participants (or empty), so a private target with no requester and no participants cannot become project-wide through `null`'s “no restriction” evaluator meaning. With participants, only those exact people pass the pure reach fact; exact own-approval metadata lookup remains available while its `hasWorkItemReach` result is false after participation loss.

Target `organisationId`/`ProjectReachFacts.organisationId` now comes from `project.organisation_id` in both target loaders, matching current SQL reach and portal capability contracts. Workspace joins were removed where they existed only to supply the wrong organisation fact. Nullable internal-project organisation facts are represented as `string | null`; existing capability calls receive `undefined` when no organisation is associated.

Fixtures now set both workspace and project organisation anchors for customer tenants. The project-reach feature-flag test grants the fixture user actual project reach. The earlier private requester positive case persists `requester_id` explicitly. The lost-reach test resolves a fresh identity after current membership rows are removed. Added repository regressions prove private-null-requester behavior with no participant, exact participant, exact own-approval metadata, and reach loss; another proves a customer cannot use a workspace organisation anchor when the project organisation is null.

No SQL customer reach predicate was broadened. No new policy, capability, exception, route, schema, dependency, event, or general query path was introduced.

## Checks actually run

- `pnpm --filter @taskdesk/api typecheck` — passed on final repair sources. An earlier typecheck found that two existing capability input types accept omitted organisation as `undefined`, not explicit `null`; calls now map null to undefined. Final typecheck passed.
- `pnpm exec biome check` across the 15 authorized current source/test paths — passed.
- `git diff --check` — passed.
- No unit/integration/PG/database runtime test, Docker/image build, browser test, or broader build was run; the parent owns runtime verification.
- No previous report was modified. This report was created exclusively with mode `0600`.


## Evidence file

`query789-f7fb-ordinary-a-delta-luna.md`

# Query 789 remediation delta review — ordinary A

Date: 2026-10-17

## Identity, independence, and exact scope

- Delta base: `b27e6c9bfa7d136ba06db8b6dd36595df49ea36b`
- Exact candidate HEAD: `f7fb4cb6f8038deeb257709f776553023456c3d8`
- Original accepted recovery base: `c022915a8768b96b460c798feafafd7d48214d5c`
- Worktree: `/Users/heinthura/.codex/worktrees/query789-current-luna`; initial `git status --short` was empty.
- Dispatch provenance: root assigned this fresh strong ordinary A remediation-delta review. No model selector or serving-runtime attestation was provided; a runtime fingerprint is unavailable here, so no independently verified model/runtime claim is made.
- Independence: I did not author, direct, or remediate the candidate or its fixes. I read the author report as claims, then checked each item against the exact diff and governing contracts. This is not a repeat full review.

Delta paths reviewed: `apps/api/src/approval/repository.ts`, `tests/api-integration/approval-feature-flag.test.ts`, `tests/api-integration/approval-repository.test.ts`, and `tests/api-integration/helpers/approval-fixtures.ts`.

## Delta verdict: CLEAR

I found no blocking source or oracle defect in this bounded delta. The fixes address the findings in my prior runtime follow-up and do not broaden the current SQL reach predicates.

- **Private item, null requester:** Both key and approval-ID target loaders now represent every private item with a non-null `visibleToPersonIds` array. The array comprises the persisted requester when present plus exact work-item participants; when neither exists it is empty, so `reaches()` refuses everyone (its `null` meaning remains “no visibility restriction”). This closes the defect for both general target lookup and own-approval metadata lookup. New tests cover private/no-requester/no-participant denial for requester and approver, addressed metadata with no reach, exact participant allow, and participant removal with metadata retained and pure reach false. Existing SQL `requestWorkItemVisibility` still uses exact requester/participant predicates.
- **Project organisation fact:** Both target loaders now select `project.organisation_id`, matching `currentProjectReachPredicate`, `ProjectReachFacts` documentation, customer project reach in RBAC, and the organisation scope used by portal capability checks. The target type correctly permits `null` for an internal project; calls that need an optional organisation map null to `undefined`, and service audit/outbox scope fields can retain null for internal projects. The workspace join was removed only where it previously supplied the wrong organisation fact.
- **Customer fixtures and negative oracle:** `ensureCustomerOrg` now associates the fixture's project as well as its workspace with the customer organisation, matching `multi-tenancy.md` and `customer-portal.md` (project references the customer organisation it serves). The new repository test then clears only the project organisation while leaving the workspace anchor, and expects customer lookup to return 404. It tests the denied alternative directly without weakening SQL scope.
- **Feature flag reach:** The flag precedence test now grants the caller an actual project membership before resolving the identity. That is the required persisted fact for the repository's project-scoped reach filter; it does not add unrelated authority beyond `project:read`.
- **Requester fixture fact:** The private requester/participant positive test now persists `requester_id` to the fixture requester before asserting that person's private reach. This tests the documented persisted requester relation instead of assuming that the staff member who created an internal item is automatically its requester.
- **Fresh identity and own-row exception:** The lost-membership test resolves a new identity after deleting the project's membership, then verifies that current generic target lookup remains 404, the exact addressed approver can still obtain own approval metadata, pure reach remains false, and own-row listing remains limited to the approval. This avoids using a stale resolved-identity snapshot as evidence of current reach while retaining the AP own-approval metadata behavior.

The new regression tests are meaningful contract checks: they distinguish project organisation from workspace organisation, null private visibility from unrestricted visibility, exact participants from unrelated project members, and related metadata access from current reach. No new authority, exception, query path, capability, schema object, route, or dependency appears in the delta.

## Commands and limits

Read-only commands actually run: `git rev-parse HEAD`, `git status --short`, `git diff --stat`, `git diff --name-only`, `git diff --unified=4` over the four delta paths, plus `cat`, `sed`, `nl`, and `rg` source/contract reads. I did not run tests, PostgreSQL, Docker, builds, install, or mutate source. Root's focused PostgreSQL verification is separate and is not evidence in this report.

This clears only the exact remediation delta at `f7fb4cb6f8038deeb257709f776553023456c3d8` at ordinary A. The earlier full A report and the subsequent `b27e` runtime BLOCKED follow-up remain unchanged historical evidence. Exact-head runtime verification, ordinary B/C and the required fresh full GPT-6 Sol review remain outstanding; this report is not merge authorization.


## Evidence file

`query789-f7fb-full-ordinary-b-luna.md`

# TaskDesk #789 — fresh independent ordinary B full source review

- Candidate: `f7fb4cb6f8038deeb257709f776553023456c3d8`
- Comparison base: `c022915a8768b96b460c798feafafd7d48214d5c`
- Repository: `/Users/heinthura/.codex/worktrees/query789-current-luna`
- Review role: Ordinary reviewer B, full source review; fresh context independent of author and fixer.
- Model provenance: This lane was assigned GPT-6 Luna by the conductor. The model route exposed to this context identifies GPT-6, but does not expose a served-model fingerprint or a Luna-specific spawn record; I cannot attest to either.
- Independence: I did not author, direct, or remediate this candidate. No source, shared record, or runtime state was changed by this review.
- Review method: Source-only inspection of all 15 changed paths and relevant callers, contracts, policies, schema and tests. No tests, build, PostgreSQL, Docker, browser, install, push, PR, or merge operation was run by this reviewer.

## Exact checks and scope

Commands run in the candidate worktree:
- `pwd && git status --short --branch && git rev-parse HEAD && git rev-parse c022915a8768b96b460c798feafafd7d48214d5c && git diff --name-only c022915a8768b96b460c798feafafd7d48214d5c..HEAD`
- `git diff --stat c022915a8768b96b460c798feafafd7d48214d5c..HEAD`
- `git diff --unified=80 ...` and `git diff --unified=10 ...` over all 15 changed paths.
- Read `AGENTS.md`, active mission, agent workflow, coding standards, approvals spec, RBAC, data model, decision log, work-item reach middleware/policy, canonical identity resolver and identity-scope repository.
- Read relevant integration tests and callees for approval request/decision/withdrawal, transition gates/closure, inbox metadata and reminder scanning.

Exact changed paths:
- `apps/api/src/approval/evidence.ts`
- `apps/api/src/approval/index.ts`
- `apps/api/src/approval/reminder-scan.ts`
- `apps/api/src/approval/repository.ts`
- `apps/api/src/approval/service.ts`
- `apps/api/src/work-item/controllers/list-work-item-transitions.ts`
- `apps/api/src/work-item/controllers/transition-work-item.ts`
- `apps/api/src/work-item/index.ts`
- `tests/api-integration/approval-closure-and-clock.test.ts`
- `tests/api-integration/approval-feature-flag.test.ts`
- `tests/api-integration/approval-repository.test.ts`
- `tests/api-integration/approval-tenant-checks.test.ts`
- `tests/api-integration/helpers/approval-fixtures.ts`
- `tests/api-integration/helpers/approval-single-use-suite.ts`
- `tests/api-integration/work-item-transition.test.ts`

## Verdict

**CLEAR — no blocking or non-blocking candidate findings identified by this source review.**

The new approval SQL derives tenant and project scope from the joined work item/project and the anchored approval workspace, and resolves authority through the canonical request identity (including key capability subset and impersonation credential classification). The `INSERT … SELECT` pins the workspace from the locked item; all inserted columns are explicitly projected, and the explicit `expiresAt` parameter uses the approval column encoder. I found no nullable/default projection mismatch in that insert.

Decision and withdrawal lock the live work item before locking the approval and use scoped compare-and-set updates. Transition approval reads and closure use the same caller scope and transaction as the state/audit/outbox writes; closure deletes notification rows only for approvals actually returned by its scoped update. The scanner retains bounded batches, expiry ordering, `SKIP LOCKED` on approval rows only, and UTC wall-clock comparisons. Its row state update and corresponding event/audit or reminder marker/event remain in the same transaction. The inbox paths retain requester/approver-only exposure and return display metadata without email addresses.

I checked the private-visibility question against the governing implementation and contract. `packages/permissions/src/evaluator.ts` applies `visibleToPersonIds` before all reach branches; AP-3 requires current work-item reach; existing approval tests intentionally reject a private-item CAB approver outside the requester/participant set and keep an addressed approver's row while marking reach loss. The new SQL mirrors that behavior. I therefore do not count the proposed staff-private filter as a finding or infer a broader staff bypass from CP-16 wording.

## Runtime evidence boundary

The conductor separately reported a focused PostgreSQL result for this exact source head (14 functional files, 91/91 tests, native count 0, receipt `query789-f7fb-focused-pg-success-receipt.json`). I did not run or inspect that runtime receipt, so it is not this reviewer's test result or an independent runtime claim. This source review does not constitute security review or merge authority.

## Residuals

No candidate-specific source residual identified. No claim is made about browser, image/container, hosted checks, or security-review acceptance.


## Evidence file

`query789-f7fb-full-ordinary-c-luna.md`

# TaskDesk #789 — full ordinary C review

- **Candidate:** `f7fb4cb6f8038deeb257709f776553023456c3d8`
- **Comparison base:** `c022915a8768b96b460c798feafafd7d48214d5c`
- **Worktree:** `/Users/heinthura/.codex/worktrees/query789-current-luna`
- **Review role:** Fresh independent ordinary C, full-source review. I did not author, direct, or remediate this candidate.
- **Requested model route:** GPT-6 Luna, explicitly selected by the conductor. This serving context does not expose the runtime fingerprint or a Luna-specific served-model attestation; I cannot independently verify either and do not claim one.
- **Checkout:** exact requested HEAD; `git status --short` was empty at the start. No candidate source, shared review record, or runtime state was changed.

## Scope and method

I reviewed all 15 paths in the base-to-head diff, plus the route middleware, canonical identity resolver, project reach predicate, relevant permission/data model contracts, approval schema/API DTO, service callers, and existing integration tests. I read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/07-planning/active-mission.md`, `docs/04-engineering/coding-standards.md` query-ownership rules, approvals, RBAC, data-model, multi-tenancy, customer-portal and API-key specs, and relevant query-ownership/approval review records.

Changed paths:

- `apps/api/src/approval/evidence.ts`
- `apps/api/src/approval/index.ts`
- `apps/api/src/approval/reminder-scan.ts`
- `apps/api/src/approval/repository.ts`
- `apps/api/src/approval/service.ts`
- `apps/api/src/work-item/controllers/list-work-item-transitions.ts`
- `apps/api/src/work-item/controllers/transition-work-item.ts`
- `apps/api/src/work-item/index.ts`
- `tests/api-integration/approval-closure-and-clock.test.ts`
- `tests/api-integration/approval-feature-flag.test.ts`
- `tests/api-integration/approval-repository.test.ts`
- `tests/api-integration/approval-tenant-checks.test.ts`
- `tests/api-integration/helpers/approval-fixtures.ts`
- `tests/api-integration/helpers/approval-single-use-suite.ts`
- `tests/api-integration/work-item-transition.test.ts`

Read-only commands actually run included:

- `pwd`, `git status --short`, `git rev-parse HEAD`
- `git diff --stat c022915a8768b96b460c798feafafd7d48214d5c..f7fb4cb6f8038deeb257709f776553023456c3d8`
- `git diff --name-status c022915a8768b96b460c798feafafd7d48214d5c f7fb4cb6f8038deeb257709f776553023456c3d8`
- `git diff --no-ext-diff --unified=60 ...` over approval evidence/routes/services and work-item handlers
- `git diff --no-ext-diff --unified=20 ...` over `approval/repository.ts`
- `git diff --no-ext-diff --unified=12 ...` over reminder scan, transition list, and changed integration fixtures/tests
- `git diff --no-ext-diff --unified=15 ...` over the repository and tenant integration tests
- `git diff --check c022915a8768b96b460c798feafafd7d48214d5c f7fb4cb6f8038deeb257709f776553023456c3d8`
- targeted `rg` call-site searches and `cat`/`sed` reads of contracts and callers

I did not run tests, PostgreSQL, Docker, browser, build, install, push, PR, or merge operations. The existing exact-head PostgreSQL receipt and earlier failure evidence were read as separately produced evidence only, not as my test result or a replacement for source review.

## Verdict

**CLEAR — I found no blocking or non-blocking source finding across the full changed scope.**

The request identity at approval evidence and handler boundaries is now built from the authenticated user, actual API-key object and impersonation marker through `resolveRequestIdentity`. API-key capability ceilings and impersonation credential classification therefore remain part of the identity used by repository scope. Work-item transition and transition-list routes pass the same resolved identity to approval gate reads and closure.

Repository statements consistently derive project/workspace relationships from joined persisted rows. The request scope applies current project reach, live item/project predicates and exact requester/participant visibility for private work items. Identifiers supplied by handlers remain additional predicates rather than proof of reach. Approval-ID loading deliberately retains own requester/named-approver metadata after reach loss; the normal work-item-key lookup remains 404, formatting derives `approverReachLost` from current reach, and decision/transition writes require current reach. Admin withdrawal's exception is restricted to a session identity and a current database-backed instance-admin predicate; transaction-time locking and the scoped compare-and-set preserve that boundary. I found no route path where a guessed ID can expose another tenant's approval or alter it without the required identity predicates.

The changed insert projects the approval row from the selected work item, anchors workspace from that row, explicitly provides the persisted fields, and uses the timestamp-without-zone column codec for caller-supplied expiry instants. Decision and withdrawal lock the live item before the approval and update only a still-pending row under the applicable caller predicates. Transition gate reads and pending-approval closure use the same resolved identity in the transition transaction; notifications are deleted only for rows returned by the scoped closure update. Reminder scanning keeps the bounded batch, UTC comparisons, pending-state conditional writes, row locking, and event/audit/marker transaction sequence while moving its statements behind repository functions. I found no DTO/schema or response-field change that breaks existing approval consumers.

The changed regression oracles cover current project and private participant reach, lost-reach own metadata versus generic lookup denial, project organisation for customer reach, tenant predicates, feature flag resolution with a real project grant, and explicit expiry-instant persistence in multiple database-zone suites. The fixture changes align persisted project organisation and requester facts with those tests. I found no weakened assertion, invented capability, schema/route addition, or dependency change.

## Blockers, residuals, and evidence boundary

No candidate-specific blocker or non-blocking source finding. No test or runtime result is claimed by this reviewer. The focused PostgreSQL receipt at `query789-f7fb-focused-pg-success-receipt.json` reports 14/14 files and 91/91 tests for this source, with native return code 0 and cleanup counts unchanged; it is conductor-produced evidence, not independently reproduced here. The prior `b27e` failure receipt remains adverse history and is not overwritten by this report. Hosted checks, browser evidence, shipped image/container acceptance, and the required independent Sol security review remain separate gates; this ordinary review grants no merge authority.


## Evidence file

`query789-f7fb-full-security-61-sol.md`

# TaskDesk #789 — independent full security source review

Date: 2026-10-17

**Reviewed head:** f7fb4cb6f8038deeb257709f776553023456c3d8

- **Comparison base:** `c022915a8768b96b460c798feafafd7d48214d5c`.
- **Worktree:** `/Users/heinthura/.codex/worktrees/query789-current-luna`.
- **Role:** fresh independent FULL security reviewer, after the required ordinary panel was reported clear. I did not author, direct, or remediate this candidate. The source stayed frozen and clean throughout my review.
- **Requested model/dispatch provenance:** the conductor explicitly requested `gpt-6.1-sol`, `fork_turns=none`, `reasoning_effort=high` for this fresh lane `/root/query789_f7fb_full_security_sol`. Those requested arguments are dispatch provenance. This context has no independently verifiable served-model fingerprint or runtime attestation; I do not manufacture one or claim that I independently inspected the parent spawn invocation.
- **Method:** source-only full review of all 15 complete current changed files, the base-to-head changes, and needed contracts/callees. No tests, PostgreSQL, Docker, browser, build, install, source/ref/shared-record edit, push, PR or merge action was performed by me. This external evidence file is the only file I created.

## Verdict

**CLEAR — no candidate-specific blocking or non-blocking security finding identified.**

This verdict covers the exact 15-path candidate below against its stated base. It is not a whole-#580 finding, phase finalizer, runtime acceptance, hosted-check approval, release/SIT claim, gate waiver or merge authorization. Later accepted-main composition must be assessed against its actual source inputs; no CI is inherited by this report.

## Complete changed-file scope

1. `apps/api/src/approval/evidence.ts`
2. `apps/api/src/approval/index.ts`
3. `apps/api/src/approval/reminder-scan.ts`
4. `apps/api/src/approval/repository.ts`
5. `apps/api/src/approval/service.ts`
6. `apps/api/src/work-item/controllers/list-work-item-transitions.ts`
7. `apps/api/src/work-item/controllers/transition-work-item.ts`
8. `apps/api/src/work-item/index.ts`
9. `tests/api-integration/approval-closure-and-clock.test.ts`
10. `tests/api-integration/approval-feature-flag.test.ts`
11. `tests/api-integration/approval-repository.test.ts`
12. `tests/api-integration/approval-tenant-checks.test.ts`
13. `tests/api-integration/helpers/approval-fixtures.ts`
14. `tests/api-integration/helpers/approval-single-use-suite.ts`
15. `tests/api-integration/work-item-transition.test.ts`

## Contracts and paths traced

I read the accepted operating guide and active mission, agent workflow/model/review rules, provider adapter, coding standards/query-ownership and UTC timestamp rules, and CI/CD security scope. Product references included approvals AP-1–AP-21 and its edge cases/residuals; workflow WF rules; RBAC reach/authority, project overrides, key ceiling, private visibility and session-only contracts; multi-tenancy; customer portal CP-16; API-key AK-3/AK-9 and the project-role ceiling decision; the relevant god-mode impersonation rules; security-model query scoping; the authoritative approval/work-item/participant schema and data-model entries; and applicable decision-log entries. Review/author reports were treated as evidence and claims, not policy or approval of my verdict.

I traced the mounted approval and work-item routers and policy registration, row evidence, canonical `resolveRequestIdentity`/`resolveIdentity`, `currentProjectReachPredicate`/`currentInstanceAdminPredicate`, `can`/`authorityFor`/`reaches`, work-item reach and capability middleware, strict-policy evaluation, session-only middleware, workflow context/role resolution, domain approval decisions and gate evaluation, transaction executor, database clocks, scheduler lease repository, activity/audit/outbox seams, notification fanout and approval recipient/read predicates. No new route, capability, schema, dependency or general producer exemption appears in the candidate.

## Security analysis

**Query ownership and tenancy.** Service and reminder-scan statements move into the approval repository; transaction-bound writes keep the supplied transaction. Key lookup, approval locks, transition reads, transition lookup and conditional writes anchor the work item to its persisted project, and approvals to `(workspace_id, work_item_id)`. Handler-supplied workspace/item IDs are additional predicates. The new request scope composes current canonical project membership or workspace `sees_all`/current instance-admin reach, live item/project conditions, and exact private requester/participant visibility. Staff project grants are reread in SQL, so an earlier resolved membership alone cannot make those resource statements succeed after that membership is removed. Customer reach uses the project's customer organisation, including denial for a null internal-project organisation. Private items with a null requester produce an empty or exact-participant visibility set, never null/unrestricted visibility. This matches the existing evaluator, which applies private visibility before all reach branches.

**Read exception and disclosure.** Approval-ID and own addressed-list queries retain only the existing exact requester/named-approver relation when normal reach is lost. The inbox endpoints still request addressed-only, pending-only rows, and portal output further requires customer kind. This approval-context exception does not make generic work-item-key lookup succeed and does not authorize a decision or requester withdrawal. Mutation paths require current work-item scope again. `responseRow` explicitly projects approval context and display names, without email, user ID, key data or participant arrays. Customer work-item approval output stays limited to addressed/requester rows. Unrelated foreign IDs are masked by the same not-found path.

**Credential and authority boundaries.** Approval evidence/handlers and transition/list handlers carry the authenticated key object and session impersonation marker into the canonical request identity. Key scope parsing remains fail-closed for absent/malformed scope; `can` intersects the stored subset with the owner's current applicable authority, with project grants overriding workspace grants. Request/customer/CAB predicates remain enforced by the route, service and domain layers. Named approver, no self-approval, final pending-only action, rejection note and CAB membership gates remain intact. Admin withdrawal is explicitly opted into only on its dedicated route, rejects key/impersonation credentials through session-only middleware, and repeats a current database-backed instance-admin predicate in target/lock/update paths. A caller-supplied opt-in boolean alone grants no admin authority. It grants no admin decision path.

**INSERT … SELECT.** I compared the complete 16-field projection with `approvalTable` in schema order: id, workspace, work item, transition, kind, requester, approver, pending state, created time, expiry, both reminder stamps, decided time and note. Workspace/item come from the scoped persisted row. Nullable lifecycle fields are explicit SQL NULLs; no omitted/default projection shifts the selection. Caller-supplied expiry uses `sql.param(input.expiresAt, schema.approvalTable.expiresAt)` inside the aliased SQL expression, retaining the timestamp-without-zone column encoder. The fallback expiry and creation stamp use the UTC database wall clock. Transition eligibility remains anchored to the item's type/workflow/current active version, and all values remain bound parameters.

**Mutation and event atomicity.** Request/decide/withdrawal keep the parent work-item lock before the approval lock or insert; decision and withdrawal retain scoped pending-state compare-and-set updates. Failed admission or an empty update cannot fall through to activity, audit or notification production. Gate reads lock the approval rows in the same transition transaction after the parent lock. Single use still derives from the matching durable transition activity and database-clock ordering. Pending closure updates only the same workspace/item/transition, deletes inbox rows only for returned closed IDs, and audits each closure in the same transaction without manufacturing an expiry event. The surrounding transition's state/guard/effect checks, refusal before mutation for held effects, audit/activity/durable event writes and post-commit publications remain in their existing sequence.

**Scan concurrency and clocks.** The named internal scan keeps its lease, 100-row batches, 1,000-row cap, expiry/id ordering and `FOR UPDATE SKIP LOCKED OF approval`. It selects pending rows against `clock_timestamp() AT TIME ZONE 'UTC'`, preserving UTC wall-clock comparisons for timestamp-without-zone columns. Expiry/reminder conditional writes use the same transaction as the corresponding outbox/fanout/audit work; unchanged rows produce no event. The extracted due-job helpers have only the intended scan caller. Reminder markers and locked row processing preserve idempotency; this is not a new request-access exception.

**Regression oracles.** The changed tests distinguish project organisation from workspace attribution, null private requester from unrestricted visibility, exact participants from other members, generic lookup denial from retained own approval metadata, real project reach for flag resolution, and exact ISO/epoch persistence of explicit expiry under both existing gate timezone wrappers. Fixture changes persist those actual relationships. Existing tenant, named-approver/finality, same-transaction closure, consumed approval, held-effect and concurrent transition guard assertions remain present; I found no weakened assertion or skipped/focused test introduced here.

## Existing limits, not candidate findings

- General GM-9 impersonation-decision refusal and double-audit are not established by this change. The normal and portal decide handlers do not independently reject an `impersonation` identity, and the generic capability evaluator does not implement that action-specific ban. This is an existing disclosed approval residual, not newly enabled behavior: native auth `/admin/*` endpoints (including impersonation issuance) are refused, and I found no mounted instance impersonation issuance route. The candidate correctly preserves the credential kind and excludes it from the session-only admin-withdrawal exception. A later impersonation implementation must satisfy GM-9 before issuance is enabled; this review must not be cited as that proof.
- Resolved identities/capabilities are per-request facts; this review does not claim serializable, instantaneous revocation of every authority fact during an already-running transaction. The candidate does add current SQL resource-reach checks; the documented key/identity next-call ceiling remains the governing claim.
- Pre-existing single-use dependence on durable activity, unavailable external notification channels, and other approvals/workflow residuals remain outside this query-ownership acceptance claim. No broad feature-completion claim is made.

## Commands and evidence actually checked

Read-only commands I executed in the candidate worktree included:

- `pwd`, `git status --short`, `git rev-parse HEAD`.
- `git diff --stat c022915a8768b96b460c798feafafd7d48214d5c...f7fb4cb6f8038deeb257709f776553023456c3d8`.
- `git diff --name-only c022915a8768b96b460c798feafafd7d48214d5c f7fb4cb6f8038deeb257709f776553023456c3d8`.
- `git diff c022915a8768b96b460c798feafafd7d48214d5c f7fb4cb6f8038deeb257709f776553023456c3d8 --` for the approval service/routes and work-item route file, plus `git diff --unified=5` for the approval repository/scan.
- `git diff --check c022915a8768b96b460c798feafafd7d48214d5c f7fb4cb6f8038deeb257709f776553023456c3d8` — exit 0.
- `wc -l`, targeted `rg`/`rg --files`, `cat`, `sed -n` ranges and `head`/`tail` to read all 15 complete files and the contracts/callees described above. Two exploratory reads used nonexistent filenames and were corrected; no execution result is inferred from them.
- Read existing ordinary A full/runtime/delta claims, B/C full reports, author recovery/expiry/repair reports and retained runtime receipts/log summaries. No report was modified.
- A read-only Python hash check over `query789-runtime-f7fb4cb6/vitest.full.log` independently confirmed 159,565 bytes and SHA-256 `156161bd66aa9f1bff0a04dd3bdf7687d0884e319c4a8fcd40bfccc136e0d1d3`, exactly matching the conductor receipt. I read the invocation/result wrapper and log footer: 14 functional files and 91 tests passed; wrapper return code 0 and elapsed wall time 49.485s (Vitest's own footer duration 48.18s). The invocation includes both real gate timezone wrappers and both scan timezone wrappers. These are inspected conductor-produced results, not tests I ran.

The retained `b27e6c9bfa7d136ba06db8b6dd36595df49ea36b` failure receipt reports 6/14 files and 74/89 tests passed, 15 failures, native return code 1. It remains adverse history and is not erased or called a pass. The later exact-head receipt reports unchanged cleanup inventories: 23 containers, 109 volumes and 7 networks, with zero additions or removals. I did not independently run Docker to recount them.

No test/reproduction was executed by this reviewer. Browser verification, shipped image build/boot/health, full hosted checks, release and integrated SIT acceptance remain separate conductor-owned gates. Final source inspection still showed HEAD `f7fb4cb6f8038deeb257709f776553023456c3d8` and empty `git status --short`.


## Evidence file

`accepted809-dual-composition-ordinary-luna.md`

# Accepted #809 dual composition — ordinary review

**Role/model:** Fresh independent ordinary reviewer, requested GPT-6 Luna route. I did not author, direct, or remediate either candidate. The review context exposes no served-model/version fingerprint, so none is asserted.
**Review date:** 2026-10-17
**Assignment:** Bounded composition and conservation check for the exact accepted-main merges listed below. This is not a restart of either complete source review.
**Operating scope:** Integration Freeze and SIT Consolidation; existing integration work only. Reviewed repository workflow, active mission, the query-ownership contract in `docs/04-engineering/coding-standards.md`, and the retained #580 task query scope. No feature scope was added.

## Candidate #773

- **Exact head:** `8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe`
- **Parents:** `55bc6954e3bfa343a521de9d96d15291f98aea6e` + accepted `main` `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`
- **Tree:** `d89adff97b4617f461c1f532fe6ee8c735e7c2da`, identical to prior source `55bc6954e3bfa343a521de9d96d15291f98aea6e`.
- **Worktree:** `/Users/heinthura/.codex/worktrees/query773-current-luna`, clean at inspection.
- **Prior full source security review:** `d7f628fa89cedc25d610f93c5bd49ce6ae9c2df9`, GPT-6.1 Sol, CLEAR over all 40 paths; its exact review and limits are in `query773-d7f6-full-security-61-sol.md`. The supplied full ordinary coverage and bounded follow-up reports also clear their stated scopes.
- **Composition checks:** exact head, parents, tree and clean status match `query773-post-accepted809-composition-proof.json`. Compared every recorded path/mode/blob from the pre-composition source proof against the candidate: **40/40 preserved**. `git diff --quiet 55bc... HEAD` succeeds, confirming no candidate source-tree delta from the already-reviewed composition. The accepted-main base is an ancestor through `894d7775b384794f1387114b2dd197673391d2cc`; accepted-main's two later commits are the notification-order fixture and review-note updates. The candidate's unchanged tree retains its existing source/test content and reviewed transaction/query seams. The composition proof reports no incoming path or overlap requiring a source conflict resolution.
- **Verdict: CLEAR for the #773 accepted-main composition.** No blocking or non-blocking composition finding identified. This only confirms the exact merge composition and conservation of the already-cleared 40-path source; it does not claim #580 completion, runtime/hosted acceptance, or general release readiness.

## Candidate #789

- **Exact head:** `88b7807378447cc74e584a37a48f277ddc1c34c8`
- **Parents:** `f7fb4cb6f8038deeb257709f776553023456c3d8` + accepted `main` `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`
- **Tree:** `831661ef18bd836b31538cff1bdbcf07693281bf`, identical to prior source `f7fb4cb6f8038deeb257709f776553023456c3d8`.
- **Worktree:** `/Users/heinthura/.codex/worktrees/query789-current-luna`, clean at inspection.
- **Prior full source security review:** `f7fb4cb6f8038deeb257709f776553023456c3d8`, GPT-6.1 Sol, CLEAR over all 15 paths; see `query789-f7fb-full-security-61-sol.md`. Three supplied independent ordinary reports clear their stated source scopes.
- **Composition checks:** exact head, parents, tree and clean status match `query789-post-accepted809-composition-proof.json`. Compared every recorded prior-source path/mode/blob against the candidate: **15/15 preserved**. Independently compared each of the 31 imported accepted-main paths against the exact accepted-main parent: **31/31 preserved**, with no overlap reported. The approval/work-item caller seams were included in the supplied source reviews; this composition changes no source tree blob from that reviewed head. Runtime evidence previously recorded at the source head is not promoted here into current hosted/full-suite/image/browser acceptance.
- **Verdict: CLEAR for the #789 accepted-main composition.** No blocking or non-blocking composition finding identified. This does not claim full hosted acceptance, or that the future full-hosted/runtime predicate has been met.

## Commands and limits

Read-only commands used: `git status --short --branch`; `git rev-parse HEAD`, `HEAD^{tree}` and parent SHAs; `git merge-base` / ancestry checks; `git diff --quiet` for source-tree equality; `git diff --name-status` for accepted-main deltas; `git ls-tree` comparisons for recorded mode/blob conservation; and `cat`, `sed`, `rg` to inspect the four proof records, active mission, query-ownership contract and relevant prior review verdicts. The #789 accepted-main path check covered all 31 recorded imported paths. No tests, build, install, PostgreSQL, Docker, browser, CI, GitHub mutation, source/ref/shared-record edit, push, PR or merge operation was performed. Neither candidate worktree was modified. The main checkout had pre-existing unrelated dirty files and was not used as a candidate checkout.

These are two separate composition verdicts. They do not approve either entire #580 feature, assert a full-hosted future runtime, clear any dependency outside the explicitly referenced exact reviewed source, or replace the requested fresh Sol composition/security confirmation.


## Evidence file

`accepted809-dual-composition-ordinary-correction-luna.md`

# Accepted #809 dual composition review — factual correction

**Purpose:** Correct and refine the exact-tree and imported-delta statements in `accepted809-dual-composition-ordinary-luna.md`. The original report is retained unchanged. This is a fresh, bounded ordinary composition review of the upstream import; it does not repeat the full #789 source review.

**Role/model:** Independent ordinary reviewer, requested GPT-6 Luna route; no served-model fingerprint is exposed. I did not author, direct or remediate either candidate. Review date: 2026-10-17.

## #789 correction and verified delta

The original report incorrectly stated that candidate `88b7807378447cc74e584a37a48f277ddc1c34c8` had the same whole-tree hash as prior source `f7fb4cb6f8038deeb257709f776553023456c3d8` and that composition changed no tree blobs. That statement is false and is withdrawn.

Direct Git inspection gives:

- Prior source tree at `f7fb4cb6f8038deeb257709f776553023456c3d8`: `6724a21f3396040c544b5325566d7af38515e1fc`.
- Composed candidate tree at `88b7807378447cc74e584a37a48f277ddc1c34c8`: `831661ef18bd836b31538cff1bdbcf07693281bf`.
- `git diff --name-status f7fb... 88b...` reports **31 changed paths** (6,413 insertions, 801 deletions). These are accepted-main imports; the source change is real and must not be described as tree-equal.
- Independently compared all 15 recorded #789-owned mode/blob entries from the pre-composition proof with the candidate tree: **15/15 preserved**.
- Compared every imported path against accepted-main parent `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`: **31/31 imported blobs preserved**. The prior proof and direct path-set comparison show no same-path overlap between those imports and the 15 #789-owned paths.
- Exact candidate parents remain `f7fb4cb6f8038deeb257709f776553023456c3d8` and accepted `main` `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`; worktree was clean on recheck.

### Bounded imported seam check

The 31-path delta is the existing task query-ownership batch: legacy `apps/api/src/task/**` repository/controller code, its query review record, and related task/reset integration fixtures. It does not change any of the 15 approval/work-item-owned paths. I checked the imported task repository and its concrete callers against the approval/work-item boundary, without rereading the full approval implementation:

- The imported legacy repository is expressed over `schema.taskTable`; the unchanged approval repository is expressed over `schema.workItemTable` and `schema.approvalTable`.
- Targeted searches found no imports from `apps/api/src/approval/**` or `apps/api/src/work-item/**` into the imported legacy task module/repository. The approval route/service continues to call its own work-item and approval repository helpers. The imported task routes continue to call their legacy task repository.
- The imported `tests/api-integration/helpers/database.ts` reset change is shared by approval integration tests. It retains the catalog-derived all-public-table reset and full `TRUNCATE ... RESTART IDENTITY CASCADE`; its new NOWAIT lock/retry wrapper is the test-only contention seam. The API integration Vitest config sets `fileParallelism: false` and `maxWorkers: 1`, consistent with the helper's all-table reset model. I did not run this suite, so no current-composition test result is claimed.
- The changed task/approval fixture files do not overlap by path. I found no source call-contract change crossing from the imported legacy task repository into approval decisions, approval closure, or native work-item transitions.

**Corrected #789 verdict: CLEAR for this bounded 31-path upstream composition delta.** No blocker or non-blocking incompatibility was identified by the path/blob and caller-seam inspection. This reuses the supplied exact-head ordinary and Sol reviews for the 15 owned approval/work-item paths only; it does not extend their findings to the imported paths. The imported changes' prior source reviews remain their evidence. No full-hosted/full-suite/image/browser or future runtime-predicate claim is made. The previously stated separate composition verdict remains CLEAR, now on this accurate bounded basis.

## #773 wording correction

Candidate `8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe` really is tree-equal to parent `55bc6954e3bfa343a521de9d96d15291f98aea6e`: both tree hashes are `d89adff97b4617f461c1f532fe6ee8c735e7c2da`, and `git diff --name-status 55bc... 8a...` is empty. The earlier description of the incoming content as two later commits was inaccurate: commits `435a4895f7f769d8fa713b167ab3273129aec017` and `894d7775b384794f1387114b2dd197673391d2cc` are already ancestors of `55bc`. The final merge adds the exact accepted-main parent metadata; it does not introduce a new tree delta from the already-composed `55bc` source. This correction does not change the separate #773 CLEAR verdict.

## Commands, boundaries and independence

Read-only checks used: `git rev-parse <sha>^{tree}`, `git diff --name-status` and `--stat` between exact source/candidate and recorded parents, `git merge-base --is-ancestor` for #773 ancestry, `git status --short --branch`, `rg` for task/approval/work-item imports and schema-table use, and `sed`/`rg` to inspect the integration test concurrency settings and reset helper. No tests, build, install, PostgreSQL, Docker, browser, CI, GitHub mutation, source/ref/shared-record edit, push or merge was performed. Both candidates remained clean and frozen. This report is written to a new path with exclusive creation and mode 0600.


## Evidence file

`accepted809-dual-composition-security-61-sol.md`

# Accepted #809 dual composition — independent bounded security confirmation

**Role/context:** Fresh independent security reviewer, `/root/accepted809_dual_composition_security_sol`. I did not author, direct or remediate either candidate. I performed no material repair design. No child agent was spawned.
**Requested dispatch provenance:** conductor-requested `gpt-6.1-sol`, `fork_turns=none`, `reasoning_effort=high`. Those are requested routing attributes, not independently attested serving metadata. The context identifies itself generically as GPT-6; an independently verifiable served-model/version fingerprint is unavailable. I do not assert one or claim to have inspected the parent spawn invocation.
**Attempt history:** The conductor reports that the earlier attempt in this lane hit a usage limit before producing a report or verdict, and explicitly requested continuation on these same frozen heads. That failed attempt supplied no approval. This completed report records the resumed inspection; it does not erase the failed dispatch.
**Review method:** Two separate bounded accepted-main composition/security confirmations after ordinary clearance, not new full-source reviews of the unchanged 40/15 owned paths.

## Instructions, evidence and ordinary prerequisite

Read the applicable accepted AGENTS, active mission, workflow review/evidence-reuse rules, provider adapter, coding/query-ownership contract, CI security scope, RBAC reach and security-model rules, current identity-scope implementation, and current candidate status/decision context. The primary checkout is old and has unrelated dirty files; initial orientation there was read-only and it was never treated as a candidate. Candidate guide blobs were independently verified equal to accepted `main@5a26ca75e60c7232ab8280a13e599fcbe4fd3518`. Integration Freeze and SIT Consolidation authorizes this existing-work composition scope.

Read both `accepted809-dual-composition-ordinary-luna.md` and its separately retained `accepted809-dual-composition-ordinary-correction-luna.md`. The original #789 whole-tree equality/no-source-delta statement is false, explicitly withdrawn, and excluded from this security reasoning. The correction provides separate CLEAR verdicts on the accurate bounded bases. I independently checked its factual claims rather than treating its conclusion as proof.

Read the four `query{773,789}-{pre,post}-accepted809-composition-proof.json` records, both prior full security reports, and the relevant accepted #809 review record, including its full-source and later notification-fixture/composition confirmations. Read `809-protected-acceptance.json`: accepted main is the normal protected #809 merge of publication `894d7775b384794f1387114b2dd197673391d2cc`, source `435a4895f7f769d8fa713b167ab3273129aec017`. Its recorded 18 contexts, 222 files/3,283 PostgreSQL tests/5 tasks, 22 G11 and 63 browser tests remain accepted-#809 evidence only. I did not re-execute or reauthenticate those runs and do not transfer them to these candidates.

## #773 — metadata-only final composition

**Reviewed head:** `8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe`

- **Worktree:** `/Users/heinthura/.codex/worktrees/query773-current-luna`.
- **Immediate comparison/source parent:** `55bc6954e3bfa343a521de9d96d15291f98aea6e`.
- **Other exact parent / accepted main:** `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`.
- **Both source-parent and candidate tree:** `d89adff97b4617f461c1f532fe6ee8c735e7c2da`.
- **Prior full source-security baseline:** `d7f628fa89cedc25d610f93c5bd49ce6ae9c2df9` against `bb298c181c213e695c5a8e857679536d355df8aa`, recorded in `query773-d7f6-full-security-61-sol.md` by fresh requested GPT-6.1 Sol context `/root/query773_d7f6_full_security_sol`, unavailable verified serving fingerprint. Its full 40-path scope and limits remain its own; this report does not relabel that work as newly performed.

Direct Git checks confirmed the exact parents, clean worktree, identical immediate-parent tree, zero incoming paths, and all **40/40 owned mode/blob entries** identical both to the proof inventory and to d7f. Candidate-minus-accepted-main is exactly those 40 owned paths. No extra candidate-only file appeared.

Inspected the intervening commit graph, not merely endpoint trees. Parent 55bc is the normal merge of d7f with publication 894d. Both 435a and 894d are already ancestors of 55bc. Accepted merge 5a26 is not itself an ancestor of 55bc, but has the identical tree to publication 894d; the final merge records that accepted parent without changing the already-composed source tree. Thus the final 8a merge is metadata-only; the earlier d7f-to-55bc composition did carry the accepted notification assertion fixture and own task-review-note update (two paths, 194 insertions/28 deletions).

I checked that actual fixture delta: sorting copies and deep equality retain exact IDs, row multiplicity/cardinality and per-row isRead state; no permission oracle is removed. Its accepted independent confirmation at 435a remains limited to that test repair. For the runtime coupling, targeted reads of create/move, required activity insertion, delete/storage cleanup and task-number claims still thread the same identity and transaction executor into task repository calls. Required activity insertion throws on refused admission, create/move history stays inside the transaction and events follow commit; claim allocation still throws on no admitted project result. Storage selection/deletion still uses the supplied transaction/current reach. No executor, schema, canonical identity predicate/resolver, event-index or notification-fanout blob changed from d7f. This is seam inspection and conservation, not a repeat full 40-file audit.

**Separate verdict: CLEAR for the bounded #773 accepted-main composition at 8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe.** Blocking findings: none. New non-blocking findings: none.

Retained residual: external object deletion and database metadata/commit are not a cross-system atomic transaction. A later DB failure/reach refusal can leave metadata for a deleted object; failed object deletion preserves its row. The prior full review discloses this limitation, and no new recovery guarantee or whole-#580 conversion is claimed.

## #789 — real disjoint accepted-main import

**Reviewed head:** `88b7807378447cc74e584a37a48f277ddc1c34c8`

- **Worktree:** `/Users/heinthura/.codex/worktrees/query789-current-luna`.
- **Immediate comparison/source parent:** `f7fb4cb6f8038deeb257709f776553023456c3d8`.
- **Other exact parent / accepted main:** `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`.
- **Prior tree:** `6724a21f3396040c544b5325566d7af38515e1fc`.
- **Composed tree:** `831661ef18bd836b31538cff1bdbcf07693281bf`.
- **Prior full source-security baseline:** f7fb against `c022915a8768b96b460c798feafafd7d48214d5c`, `query789-f7fb-full-security-61-sol.md`, fresh requested GPT-6.1 Sol context `/root/query789_f7fb_full_security_sol`, requested fork none/high with unavailable verified serving fingerprint. It covers all 15 owned approval/work-item paths only. Its full scope is retained, not silently extended to the 31 imports.

Direct Git checks confirmed the exact parents and clean worktree. This is a **real 31-path delta, 6,413 insertions/801 deletions**, not metadata-only and not tree-equal. Compared every own mode/blob: **15/15 preserved** against f7fb and the proof inventory. Compared every actual imported path with accepted parent 5a26: **31/31 preserved**. The actual incoming path list equals the proof list, with no same-path overlap. Candidate-minus-accepted-main is exactly the 15 owned paths. The import therefore contains no local conflict-resolution mutation or unaccounted candidate-only path.

The imported task module remains the legacy `taskTable` surface; the conserved approval repository binds `approvalTable` to native `workItemTable`. Targeted source/import inspection found no new direct task-repository dependency in approval service or native transition callers and no approval/native-work-item repository import into the changed legacy task module. Approval service still calls its own repository; the native transition explicitly calls approval lock/closure helpers. Both repositories compose the same current canonical project-reach helper, whose blob is unchanged from f7fb. The inspected shared executor/schema, request-identity resolver, caller-identity helper, event-index, notification fanout, native work-item activity/context and integration-config blobs likewise remain unchanged. This supports the bounded lack of new authority/caller-contract coupling; it does not independently re-audit all accepted task-source behavior.

The shared runtime-test seam is the imported database-reset helper. I inspected its complete current implementation and test configuration: non-test URL guard remains; public base-table names come from the catalog and are quoted; all-table NOWAIT ACCESS EXCLUSIVE locking and TRUNCATE RESTART IDENTITY CASCADE stay in one transaction. Only lock-statement SQLSTATE 55P03 is wrapped for bounded retry; rollback releases partial locks; unrelated errors propagate. Retry does not wrap approval/product actions. Integration configuration remains fileParallelism false/maxWorkers 1. No test was run here, so these source observations do not establish current composed-suite behavior or prove the cause of any historical reset reader.

**Separate verdict: CLEAR for the bounded #789 accepted-main composition at 88b7807378447cc74e584a37a48f277ddc1c34c8.** Blocking findings: none. New non-blocking findings: none.

Retained residuals: prior GM-9 general impersonation-decision refusal/double-audit remains unestablished; this composition is not that compliance proof or authorization to enable impersonation issuance. Existing per-request authority/next-call revocation limits, durable-activity single-use dependence and notification-channel limitations remain at their original scope. The retained f7fb focused PostgreSQL 14-file/91-test result is source-only evidence; it is not a result on this composed head.

## Commands actually performed and limits

Read-only commands included `pwd`; `git status --short/--porcelain`; `git rev-parse`; `git show -s --format=%H %P %T`; `git log --format=%H %P %s <full-source>..HEAD`; `git merge-base --is-ancestor`; `git diff --name-only/--name-status/--stat/--shortstat/--check` over the exact source, composed and accepted parents; `git ls-tree`; `rg`, `cat`, `sed`, `head`, `ls`; live read-only `gh pr list --state open --json number,headRefOid,title` and `gh issue list --state open --limit 30 --json number,title`. Git diff checks for immediate source-to-candidate comparisons exited 0. The live PR inventory still referred to historical published #773/#789 heads, not these local successors; none of those hosted checks is attributed to these candidates.

A read-only Python subprocess script independently enumerated actual incoming paths, compared every recorded own mode/blob at the full baseline and final head, compared every actual incoming mode/blob to accepted main, checked exact net-own sets and overlap, printed trees/parents, and checked ancestry. A second script compared named shared seam blobs and listed intervening commits. A final pre-write assertion again verified both exact heads and clean worktrees.

Some exploratory multi-file read outputs were truncated; relevant conclusions were checked with bounded reads or direct Git comparisons. An initial nonexistent `.claude/active-mission.md` read was corrected to canonical `docs/07-planning/active-mission.md` in the candidate worktrees. No conclusion depends on an unseen truncated source range.

No tests/reproductions, PostgreSQL, Docker, browser, build, install, CI action, source/ref/shared-record modification, push, PR write, merge or publication was performed. The only created file is this requested private report, using O_EXCL and mode 0600. Both candidates stayed frozen and clean.

These separate security confirmations complete only the assigned bounded composition review. They do not reuse required CI, establish full composed runtime/image/browser acceptance, accept the entire #580 program, close a stage or residual finding, waive any gate, or authorize merge/release/SIT acceptance. Preserve earlier full/delta reviews and adverse evidence at their actual model, source and scope.

**Completed at:** 2026-10-17T01:50:56.825951+00:00


## Current composition binding

The reports above retain their stated full/delta scopes and unchanged verdicts. Current composition source is bound here; only publication in this candidate's own new regular review note follows. All required exact-head hosted/runtime/image gates remain outstanding.

**Reviewed head:** `88b7807378447cc74e584a37a48f277ddc1c34c8`


## Bounded repair and accepted #813 composition — 2026-10-17T03:07:41.382530+00:00

Prior reports retain their original source, scope and verdict. All dispatched review reports, adverse findings and authentic corrections are preserved below. New current security verdict is CLEAR at `24711f617d5e1134e36d83e3afadd85e206f0afa`; this is source review, not hosted/runtime/image or merge acceptance. No gate waiver.

Old d65 full run failed222/223files3288/3289tests; intermediate0d600 then failed one of78 focused tests because invalid body preempted the capability denial. Its original ordinary CLEAR report incorrectly assumed validation order and is retained as superseded adverse history. Final5fa supplies schema-valid bodies only to new404/403 denial probes, retaining original400 positive validation case. Actual5fa focused6files78/native0/29.931s, raw153217bytes SHA2568555382dec678d2b16641d2e1d4813d956834a568c0c85fac9debe0c3f159ebe, exact owned cleanup23/109/7 unchanged/private environment removed. This is selected-table snapshot coverage, not all-database no-write or current full runtime acceptance. Accepted813 composition conserves all18own and exact3incoming entries.


### Authentic report — query812-project-reach-failure-repair-author-luna.md

# TaskDesk #812 project-reach failure diagnosis and fixture repair — author report

Date: 2026-10-17

## Candidate and scope

- Worktree: `/Users/heinthura/.codex/worktrees/query789-current-luna`
- Branch: `codex/query789-current-main-luna`
- Accepted baseline: `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`
- Repair base / exact pre-repair head: `d65c498cc9983cc89d11a670f90ee062ae99c310`
- Repair commit / exact candidate head: `0d6003df5a6f805bb3a5ccea85bc950e2ea187e7`
- Diff: two existing integration-fixture paths, 39 insertions; no application source, permissions, schema, routes, dependencies, control-plane records, or reports changed.

## Diagnosis

The sole #812 full-PostgreSQL failure was the existing generic project-reach fixture's expected success for `POST /api/work-items/{key}/approvals`. The recorded request returned 404 `Work item not found` where the generic route case expected 400 from the intentionally empty request payload. This was a fixture defect, not a product SQL reach defect.

`tests/api-integration/helpers/reach-world.ts:createItem()` creates the item through the staff project route with only type and title. The native create INSERT does not set `requester_id`; the persisted column is therefore null. `customer_visibility` has the schema's safe default `private`. The approval request target scope composes current project reach with private visibility. For private rows, `requestWorkItemVisibility()` permits only the persisted requester or an exact `request_participant` row. The projectMember used by the generic positive case had project membership and capabilities, but neither privacy fact, so the target lookup correctly returned 404 before request/business validation. Changing the predicate, loosening null requester behavior, changing private defaults, or replacing expected 404/400 would violate the retained privacy contract.

## Bounded repair

The approval case's fixture preparation now persists explicit participant facts for three actors on the private item: (1) the capable project member, (2) a project reader without `approval:request`, and (3) an outsider without project membership. The existing positive project-member case still reaches the handler's later empty-payload 400. An approval-specific regression asserts that participation alone leaves the outsider at 404 and the reachable reader without request capability at 403, with no tracked writes after either refusal. The shared snapshot now counts approval rows so denial-side-effect checks cover the relevant mutation table.

This preserves the conjunction: project reach AND private requester/participant visibility AND the required approval capability. The fixture does not make the item organisation-visible and no SQL predicate changed.

## Whole-class/caller audit

I inspected all current `loadApprovalTargetByKey()` call sites and the approval request service path. The other approval integration tenant fixture explicitly changes its generated item to `customer_visibility = organisation`; repository tests that exercise private reach set requester/participant facts directly, including null-requester and exact-participant cases. Within `tests/api-integration/helpers/reach-world.ts`, the approval route was the only route invoking the approval target loader's private visibility predicate; the remaining item write routes use their own reach handlers. The fault class is therefore confined to this generic project-reach approval route setup, not a repeated product caller defect.

Review context read: `docs/07-planning/security-reviews/query-ownership-approvals-580.md`; retained evidence `query789-b27e-repair-author-luna.md`, `query789-f7fb-full-security-61-sol.md`, and `accepted809-dual-composition-security-61-sol.md`. The accepted contract explicitly preserves current SQL project/private requester-or-participant reach and the existing null-requester rule. The report and source-review records were not edited.

## Checks and limits

- `pnpm exec biome check tests/api-integration/helpers/reach-world.ts tests/api-integration/work-item-project-reach.test.ts` — passed; Biome emitted three pre-existing `noUndeclaredEnvVars` warnings on the test's existing storage environment-variable setup.
- `git diff --check d65c498cc9983cc89d11a670f90ee062ae99c310..HEAD` — passed.
- `pnpm --filter @taskdesk/api typecheck` — passed (API source, permissions, API tests, RLS prototype and approval E2E TypeScript projects).
- No test, PostgreSQL, Docker, browser, build, or full-suite command was run. The #812 full run remains adverse evidence on the prior candidate. Focused runtime verification of this candidate is pending with the parent verification lane.
- No push, PR, source composition, or merge was performed. The worktree is clean after the commit.


### Authentic report — query812-0d600-fixture-ordinary-luna.md

# TaskDesk #812 exact-head ordinary review — approval reach fixture repair

Date: 2026-10-17

## Identity, independence, and scope

- Role/model: GPT-6 Luna, independent ordinary reviewer.
- Worktree: `/Users/heinthura/.codex/worktrees/query789-current-luna`.
- Comparison base: `d65c498cc9983cc89d11a670f90ee062ae99c310`.
- Exact candidate HEAD: `0d6003df5a6f805bb3a5ccea85bc950e2ea187e7`.
- Independence: I did not author, direct, or remediate this delta. I inspected its complete two-file diff and rechecked the author diagnosis against the existing SQL, permission evaluator, fixtures, specifications, prior review record, and recorded full-PostgreSQL failure.
- Changed paths: `tests/api-integration/helpers/reach-world.ts`; `tests/api-integration/work-item-project-reach.test.ts`. The exact diff is 39 insertions and no application source, permissions, schema, route, dependency, or policy changes.

## Verdict

**CLEAR for the ordinary source review of this exact delta.** The fixture repair accurately supplies private-item participant facts while preserving the independent project-reach and capability checks. No blocking or non-blocking source finding identified. The focused PostgreSQL rerun remains pending and is not covered by this verdict.

## Evidence and findings

The recorded prior full run fails once in `work-item-project-reach.test.ts`: the approval route's positive project-member case expected 400 from its empty body but got 404 `Work item not found`. The supplied log has SHA-256 `045ebc99f89e0363f12a69f4febb158fcf5134f8c2e85d0812f0fef509c1cbfa`; its tail records 222/223 files and 3288/3289 tests passing, with the failure at the expected-status assertion. The diagnosis is consistent with the source: the generic `createItem` path does not set `requester_id`; the database default is private; and `requestWorkItemScope` composes `currentProjectReachPredicate` with `requestWorkItemVisibility`. For private items, the SQL visibility clause allows the requester or an exact `request_participant` row. The loaded participant IDs then also populate `visibleToPersonIds`, and `reaches()` enforces that private-person set.

The fixture now inserts participant rows for the positive project member, a project reader with only `project:read` and `work_item:read`, and a lead without project membership. This lets the original positive case reach request-body validation (expected 400) while exercising the other two axes: the participating outsider remains 404 because current project reach fails, and the participating reader remains 403 because `approval:request` is absent. This matches `CP-16`, the RBAC separation of reach and authority, and the route handler's order: target lookup/reach, then `approval:request`, then body processing. No assertion status or product predicate was changed.

The new denial case compares the before/after fixture snapshot after each refusal. The snapshot's added approval-row count makes approval inserts observable alongside existing work-item, comment, watcher, attachment, and activity observations. These fixture additions are isolated to the approval route's `prepare` callback; other route fixture setup is untouched. Existing approval repository and tenant tests already exercise private requester/participant rules, including the null-requester case. I found no parallel generic fixture caller of this private-scoped approval target path needing the same setup.

The exact diff contains no SQL, predicate, permission, status-code, or feature-flag change. It does not make the item organisation-visible or use project membership as a substitute for private visibility. The three identities are explicitly participants, so the denial assertions test that participant status alone grants neither project reach nor approval authority.

## Commands and limits

Read-only commands run: `pwd`, `git status --short`, `git rev-parse HEAD`, `git rev-parse HEAD^`, `git diff --stat HEAD^ HEAD`, `git diff --name-status HEAD^ HEAD`, scoped `git diff HEAD^ HEAD -- <two changed paths>`, `rg` over approval SQL callers, permission definitions and tests, `sed` reads of the relevant source/contracts/review notes, and `shasum -a 256` plus bounded `tail -n 90` of the recorded failure log. The worktree was clean at inspection. I did not run tests, PostgreSQL, Docker, browser, build, install, or a heavy inventory command; did not mutate the source worktree or GitHub; and did not commit, push, or open a PR.

Residual: runtime behavior on `0d6003df5a6f805bb3a5ccea85bc950e2ea187e7` still needs the parent's focused real-PostgreSQL verification. This ordinary review does not replace any required Sol security review or exact-head CI evidence.


### Authentic report — query812-fixture-runtime-repair-luna.md

# TaskDesk #812 approval denial fixture repair — author report

Date: 2026-10-17

## Candidate and scope

- Worktree: `/Users/heinthura/.codex/worktrees/query789-current-luna`
- Branch: `codex/query789-current-main-luna`
- Pre-repair head: `0d6003df5a6f805bb3a5ccea85bc950e2ea187e7`
- Exact candidate head: `5fa659555d237ef29e24b6872676bc4ba7355a02`
- Commit: `5fa65955 test(api): reach approval authorization checks`
- Changed path: `tests/api-integration/work-item-project-reach.test.ts` only.
- No production source, permissions, schema, route, dependencies, control-plane files, or prior evidence records changed. No push or PR was made.

## Diagnosis and repair

The inherited test supplied `{}` to `POST /api/work-items/{key}/approvals` for every actor. OpenAPI/Zod request validation requires a nonempty `transitionId`, `kind` of `customer` or `cab`, and a nonempty `approverId`; therefore the expected reader 403 was preempted by 400 validation, before route handler authorization. The handler order is target load/project reach, then `approval:request`, then body processing. The reader fixture has project reach but only `project:read` and `work_item:read`, so a schema-valid request reaches the expected capability denial. A participating outsider with the same body reaches the 404 project-reach denial.

The approval-specific regression now uses a schema-valid body for the outsider and reader requests. The generic route call remains `{}`, preserving the project-member validation expectation of 400. The prior assertions remain 404 for the participating outsider and 403 for the participating reader; snapshot equality remains checked after both denials. No expected status was relaxed and no authority behavior changed.

## Checks and limits

- `pnpm exec biome check tests/api-integration/work-item-project-reach.test.ts` — passed; three existing `noUndeclaredEnvVars` warnings refer to the test's pre-existing storage environment-variable setup.
- `git diff --check` — passed before commit.
- `git status --short --branch` after commit — clean worktree; branch is two commits ahead of its origin tracking ref (the earlier `0d6003d` commit plus this repair).
- No test, PostgreSQL, runtime, install, Docker, browser, build, or heavy command was run. Focused real-PostgreSQL verification remains with the parent lane.
- The original full-runner failure log and prior author/reviewer reports were read and left unchanged.


### Authentic report — query811812-runtime-repairs-ordinary-luna.md

# Independent ordinary review — #811 and #812 bounded runtime repairs

Reviewer: GPT-6 Luna, fresh independent review context; did not author, direct, or remediate either candidate. Review was read-only and scoped to the two exact source heads, relevant feature/policy material, cited author/prior-review reports, and the existing #812 focused runtime receipt.

## #811 — time-entry post-admission disappearance

- **Exact candidate head:** `7671c1c700b31ae4d7c821d61d5791362d8d29cf`
- **Comparison base:** `e30eb752eedf09bc8fcfa9a54c856a7771ff3cf4`
- **Worktree:** `/Users/heinthura/.codex/worktrees/query773-current-luna`
- **Scope:** `apps/api/src/time-entry/controllers/get-time-entry.ts`; `tests/api/time-entry/get-time-entry.test.ts`.
- **Verdict: CLEAR for this bounded repair.**

The route in `apps/api/src/time-entry/index.ts` applies `workspaceAccess.fromTimeEntry` before calling the controller, and declares 404 for the concealed missing/unreachable case. The controller then performs another reach-scoped `findTimeEntryById` call. If that second read returns no row after middleware admission, the new `HTTPException(404)` keeps the route in its declared concealed response class instead of allowing an undefined result to become an empty success response. The regression directly covers the controller's absent-second-read behavior and the ordinary present-row behavior. The mock does not reproduce database concurrency itself; it does assert the exact post-admission observation whose response behavior is being repaired.

No blocking or non-blocking source findings. No tests or commands were run by this reviewer. I read the author report's statement that formatting/checks passed; that is author evidence, not independently reproduced here. No integration/runtime, PostgreSQL, Docker, build, or browser verification was performed in this review.

## #812 — approval project-reach fixture repair

- **Exact candidate head:** `5fa659555d237ef29e24b6872676bc4ba7355a02`
- **Comparison base for the accumulated bounded repair:** `d65c498cc9983cc89d11a670f90ee062ae99c310`
- **Worktree:** `/Users/heinthura/.codex/worktrees/query789-current-luna`
- **Cumulative changed paths:** `tests/api-integration/helpers/reach-world.ts`; `tests/api-integration/work-item-project-reach.test.ts`.
- **Verdict: CLEAR for this bounded fixture repair.**

The #812 reports and diff show the fixture now gives the private item explicit requester/participant visibility facts for the capable project member, reachable reader, and outsider. The approval-specific requests use nonempty `transitionId`, `kind`, and `approverId`, satisfying the request schema so the checks can reach the handler. The assertions preserve outsider 404 and reachable-reader 403, while the generic empty-body case still covers validation 400. This is consistent with `docs/03-features/approvals.md`'s requirement that a request be on an in-reach work item and with the existing private-item visibility contract described in the author diagnosis. Counting approval rows in the snapshot strengthens the no-approval-write assertion.

I inspected the retained focused runtime evidence at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query812-runtime-5fa659/`: its receipt binds to this exact SHA; Vitest reports 6 files and 78 tests passed, and the run status says `test-complete`, with final container inventory showing no container/volume/network count delta. This confirms the focused evidence exists and is bound to the candidate; I did not execute or independently reproduce the run. The fixture snapshot is a selected-table snapshot, so its equality supports the asserted tracked-table side-effect check and should not be read as a complete database-wide write audit.

No blocking or non-blocking source findings. No tests or commands were run by this reviewer. No new runtime, PostgreSQL, Docker, build, or browser verification was performed. Prior full-run findings on earlier heads and prior ordinary/Sol reviews are not replaced by this bounded repair review.

## Review limits and independence

These are separate verdicts on the exact heads above. I inspected the diffs against their stated bases, relevant route wiring and feature contracts, and the supplied reports/receipt. I did not inspect live GitHub state, run tests, evaluate CI, review unrelated candidate changes, or grant merge/security/phase-finalizer approval. Any required GPT-6 Sol security review remains a separate gate where applicable.


### Authentic report — accepted813-three-compositions-ordinary-luna.md

# Independent ordinary review — accepted #813 composition confirmations

Reviewer: GPT-6 Luna, fresh independent context. I did not author, direct, or remediate the candidates. This is a read-only composition review of three exact current heads. It is not a replacement for the earlier full source reviews, security reviews, CI, image verification, or acceptance gates.

## #811 time-entry candidate composed with accepted #813

- **Exact current head:** `c3329e7d195c63a6e46caebdd2f306b4dc9ba1a4`
- **First parent / previously reviewed source:** `7671c1c700b31ae4d7c821d61d5791362d8d29cf`
- **Second parent / accepted #813 main:** `130508ef24f6442a59dbccaf305712891c8b3fbb`
- **Verdict: CLEAR for this bounded composition.**

I verified the worktree HEAD and both parents. The first-parent diff contains exactly three accepted-main paths: `apps/api/src/auth/repository.ts`, `tests/api-integration/local-factor-policy.test.ts`, and the step-up query-ownership review note. Each candidate-owned path from the supplied composition proof (42 paths) remains blob-identical to the reviewed source parent; each of the three incoming blobs is identical to accepted #813 main. The accepted and own path sets do not overlap. The proof records successful normal `--no-ff` merge and no conflict resolution; I independently confirmed the resulting tree relationships and exact three-path diff. The added source/test concerns existing step-up active-session read behavior, disjoint from the time-entry controller and regression. The accepted test covers deleted-session preflight denial and non-agent session denial during operation and pending-action issuance; the incoming repository changes materialize session query results while retaining callers' first-row semantics, as recorded in the accepted review note.

No composition finding. This verdict confirms source conservation and lack of a cross-path composition conflict; it does not redo the #811 concealment review or evaluate exact-head hosted/runtime gates. I ran no tests or other commands beyond read-only Git/source/evidence inspection.

## #812 approval candidate composed with accepted #813

- **Exact current head:** `24711f617d5e1134e36d83e3afadd85e206f0afa`
- **First parent / previously reviewed source:** `5fa659555d237ef29e24b6872676bc4ba7355a02`
- **Second parent / accepted #813 main:** `130508ef24f6442a59dbccaf305712891c8b3fbb`
- **Verdict: CLEAR for this bounded composition.**

I verified the worktree HEAD and both parents. The first-parent diff contains exactly the same three accepted-main paths listed above. All 18 candidate-owned paths from the proof remain blob-identical to the reviewed source parent; all three incoming blobs match accepted #813 main. The accepted and own path sets do not overlap. The merge proof records a normal merge with no conflict resolution, and the exact resulting diff confirms only those three incoming paths. The existing #812 approval request fixture repair and its reader/outsider assertions remain unchanged; the incoming session-query source and tests are disjoint from approval reach fixtures. No contract or source interaction was found in this bounded composition check.

No composition finding. This does not redo the #812 fixture/runtime review or replace any required security/exact-head gate. I ran no tests or runtime checks.

## #580 operation-proof persistence candidate composed with accepted #813

- **Exact current head:** `dcf4071f79c7046cab343e51acadc2e9983b9e09`
- **First parent / fully reviewed source:** `7f4f0a2865e9ff1006f88edab264f4c9d3031324`
- **Second parent / accepted #813 main:** `130508ef24f6442a59dbccaf305712891c8b3fbb`
- **Tree at both first parent and current head:** `d15260509b29f187945946c64a8ebf785db622e3`
- **Verdict: CLEAR for metadata-only composition; prior source review verdicts remain applicable.**

I verified the exact parents and tree ids. The merge commit's tree is identical to its first parent's tree, and `git diff`/`diff-tree` show no path or blob changes. Thus the accepted-main merge adds parent metadata only; there is no new source delta to re-review. The operation-proof source review remains the prior two ordinary CLEAR reviews and full GPT-6.1 Sol CLEAR at exact source `7f4f0a28…`, with their stated comparison base `433ea7769d1b8440046cfe7ba39acc23e029489c`.

I read the original reports and both authentic wording corrections, plus the full Sol report. The retained precision is: the attempt-limit error is thrown inside the transaction callback, so the original ordinary-A “transaction completed” statement is withdrawn; the audit-failure test exercises savepoint/failure handling followed by successful mutation and does not prove outer proof-plus-mutation rollback; and `local-factor-policy-concurrency.test.ts` covers policy-write/role-deletion serialization, not operation-proof races. Those coverage limits remain. The ordinary-B image wording correction also remains controlling: this `apps/api` source requires the separate image build, boot, migration, and health checks; the focused PostgreSQL run does not satisfy them. This metadata review claims none of those gates.

No new source finding or changed-source review round is indicated by this metadata-only merge. No tests, image, container, browser, or hosted checks were run here; no GitHub/ref mutation, commit, or push was performed.

## Independence and limits

I independently read the two composition proof receipts, inspected the actual worktrees/HEADs/parents/trees and first-parent diffs, verified source/incoming blob conservation for #811 and #812, checked their path-set intersections, and read the cited #580 ordinary/security reports and authentic corrections. No source or evidence reports were modified. These verdicts are limited to current-head composition and metadata confirmation. They do not claim exact-head CI, deployment/image acceptance, merge readiness beyond the already completed normal composition, #580 completion, or a phase finalizer.


### Authentic report — accepted813-four-candidates-security-61-sol.md

# Accepted #813 — four independent exact-head security verdicts

**Model / role:** GPT-6.1 Sol, fresh independent security reviewer context `/root/accepted813_four_candidates_security_sol`.
**Dispatch provenance:** The conductor supplied the actual tool-request arguments `model="gpt-6.1-sol"`, `reasoning_effort="high"`, `fork_turns="none"`. This is requested/accepted route provenance, not an independently measured serving attestation. The served provider/model/build fingerprint is unavailable to this context and is not invented.
**Independence:** I did not author, direct, plan, or remediate any of the four candidates. No child agent was spawned. I reviewed after reading the applicable current ordinary CLEAR reports and their authentic corrections. Their conclusions were claims to verify, not substitutes for source inspection.
**Method:** Four separate bounded source/composition security reviews. Earlier full-source review coverage remains attributed to its original reviewer, exact source and limits; this report neither restarts those full scopes nor silently claims to have re-audited them.
**Evidence root (E):** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover`.

## Separate verdicts

| Candidate | Exact reviewed head | Verdict and depth |
| --- | --- | --- |
| A — #811, activity/relations/time-entry recovery | `c3329e7d195c63a6e46caebdd2f306b4dc9ba1a4` | **CLEAR** — full security inspection of the bounded post-admission 404 repair, plus bounded accepted-#813 composition confirmation |
| B — #812, approval recovery | `24711f617d5e1134e36d83e3afadd85e206f0afa` | **CLEAR** — bounded fixture-security and accepted-#813 composition confirmation |
| C — #580 operation-proof persistence | `dcf4071f79c7046cab343e51acadc2e9983b9e09` | **CLEAR** — lightweight metadata-only confirmation retaining the prior full two-path security review |
| D — #803 records | `6f990aae91590ef79db60c6433fa425b2390424e` | **CLEAR** — bounded new dated-fact, preservation and composition security confirmation retaining the prior full normative review |

**Blocking findings:** none in any of these four assigned deltas.
**New non-blocking security findings:** none in any of these four assigned deltas.
These are source security verdicts only. They are not current required-CI passes, image acceptance, permission to merge, whole-#580 acceptance, a phase finalizer, or release/SIT/mission completion.

## A — #811 at c3329e7d

**Reviewed head:** c3329e7d195c63a6e46caebdd2f306b4dc9ba1a4

- Worktree: `/Users/heinthura/.codex/worktrees/query773-current-luna`.
- Bounded repair base/publication: `e30eb752eedf09bc8fcfa9a54c856a7771ff3cf4`.
- Repair/source parent: `7671c1c700b31ae4d7c821d61d5791362d8d29cf`.
- Other exact parent: accepted #813 `130508ef24f6442a59dbccaf305712891c8b3fbb`.
- Current tree: `713a5c84844c0beda52b18d25054ea3d0acbf826`.
- Retained full-source baseline: `d7f628fa89cedc25d610f93c5bd49ce6ae9c2df9`, full 40-path review `query773-d7f6-full-security-61-sol.md`, followed by accepted-#809 composition confirmation at `8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe` in `accepted809-dual-composition-security-61-sol.md`.

I inspected the complete two-path repair: `apps/api/src/time-entry/controllers/get-time-entry.ts` and the new `tests/api/time-entry/get-time-entry.test.ts`. The controller still uses the authenticated resolved identity and exact id in the same reach-scoped repository read. It now awaits that read, throws `HTTPException(404, { message: "Time entry not found" })` for no row, and returns the unchanged row otherwise. There is no unscoped retry, stale middleware-row fallback, new disclosure, or widened authority.

The mounted GET route already declares concealed 404 and applies `workspaceAccess.fromTimeEntry` with project reach plus `time_entry:read_any` enforcement. The second repository lookup composes the entry id, its task/project relationship, deleted-project exclusion and current canonical project-reach predicate. A missing row or a current reach refusal observed at that read therefore takes the declared 404 path, instead of being serialized as an empty success. Query exceptions still propagate; the new guard does not turn an execution error into a row or retry through weaker scope. This is closure of the reported post-admission undefined-result defect, not a claim of serializable instantaneous revocation throughout a request.

The two controller tests directly cover undefined second-read rejection and returning the present row, with exact identity/id forwarding. They model the post-admission observation; they do not reproduce real database concurrency or constitute a complete HTTP denial journey. `query811-7671-static-unit-receipt.json` records root's exact-7671 one-file/two-test run and API typecheck, both exit 0. I inspected that receipt, did not run them, and do not transfer old e30 full-suite passes to c332.

Direct Git comparison independently confirms all 42 owned mode/blob entries remain identical to 7671, all three incoming entries match accepted 1305, the owned/incoming sets are disjoint, and the first-parent diff contains exactly those three incoming paths. Relative to the prior full 40-path baseline, only the reviewed time-entry controller, authentic own-note publication, and new regression differ among the current owned paths; the unchanged full-source coverage is retained. The incoming auth source/test seam is assessed below.

**Separate A verdict: CLEAR.** The reported undefined-result concealment defect is closed in source at this exact head. Prior storage cross-system atomicity and legacy/native-feature coverage limits remain as disclosed in the full review; this repair adds no new recovery guarantee.

## B — #812 at 24711f61

**Reviewed head:** 24711f617d5e1134e36d83e3afadd85e206f0afa

- Worktree: `/Users/heinthura/.codex/worktrees/query789-current-luna`.
- Accumulated fixture-repair base/publication: `d65c498cc9983cc89d11a670f90ee062ae99c310`.
- Repair/source parent: `5fa659555d237ef29e24b6872676bc4ba7355a02`, following `0d6003df5a6f805bb3a5ccea85bc950e2ea187e7`.
- Other exact parent: accepted #813 `130508ef24f6442a59dbccaf305712891c8b3fbb`.
- Current tree: `7c04eb0f21b20464517df20e5fbf817eed5498fc`.
- Retained full-source baseline: `f7fb4cb6f8038deeb257709f776553023456c3d8`, full 15-path review `query789-f7fb-full-security-61-sol.md`, followed by the real disjoint accepted-#809 import confirmation at `88b7807378447cc74e584a37a48f277ddc1c34c8` in `accepted809-dual-composition-security-61-sol.md`.

I inspected the complete accumulated two-fixture-path delta in `tests/api-integration/helpers/reach-world.ts` and `tests/api-integration/work-item-project-reach.test.ts`. It changes no application source, schema, policy, capability, product status behavior or feature flag. The approval route's preparation adds exact private-item participant facts for the capable project member, reachable reader and project outsider. It does not change the item to a broader visibility class or grant either negative actor additional project authority.

Source inspection confirms the preserved conjunction: approval SQL applies current project reach AND private requester/exact-participant visibility, while route/handler checks separately require `approval:request`. The staff middleware does project reach before body validation; the handler then resolves the scoped target and enforces the capability. The new negative body contains nonempty `transitionId`, customer `kind`, and nonempty `approverId`, satisfying the actual strict request schema. Its dummy downstream identifiers do not mask the tested denials because the outsider fails project reach and the reachable reader fails capability before approval creation/transition eligibility. Participation therefore cannot replace project reach or authority: the tests retain outsider 404 and reachable-reader 403. The original empty-body positive/validation case still expects 400.

The earlier `query812-0d600-fixture-ordinary-luna.md` incorrectly treated the empty negative body as reaching the handler. Its authentic report remains intact and is not authoritative for the final repair. I read the final `query811812-runtime-repairs-ordinary-luna.md` and independently checked the schema/order above. The added approval count strengthens the existing snapshot against approval insertion. Snapshot equality remains a selected set of work-item rows and table counts, not a complete database-wide write audit or proof against every possible equal-count mutation.

I inspected root's `query812-runtime-5fa659` result/invocation, runtime and exact-id cleanup receipts, final inventory comparison, and raw-log summary. It binds to 5fa, native exit 0/no timeout, 29.931 seconds, six files/78 tests passed. The independently recomputed raw-log size/hash are 153,217 bytes / `8555382dec678d2b16641d2e1d4813d956834a568c0c85fac9debe0c3f159ebe`. Saved cleanup records 23 containers/109 volumes/seven networks unchanged; the private environment file is absent. These are inspected root-owned receipts, not a new runtime execution or live Docker-state observation. They are focused evidence on 5fa, not a full runtime result at 247.

Direct Git checks independently preserve all 18 owned entries from 5fa and all three incoming entries from accepted 1305, with no same-path overlap and exactly the three-path first-parent import. All 15 original full-review-owned source/test entries are unchanged except their designated own review note; the two fixture paths are the newly inspected repair. The prior #789 whole-tree-equivalence error was already explicitly withdrawn in its authentic composition correction; I do not revive it.

**Separate B verdict: CLEAR.** No authority regression or weakened permission oracle appears in this fixture repair or composition. Existing GM-9 impersonation-decision/double-audit, per-request authority/revocation, durable-activity single-use and notification limitations retain their original disclosed scope; this verdict does not certify them closed.

## Shared accepted-#813 import in A, B and D

The exact incoming paths are `apps/api/src/auth/repository.ts`, `tests/api-integration/local-factor-policy.test.ts`, and `docs/07-planning/security-reviews/query-ownership-step-up-session-580.md`. I read the actual production/test diff, the retained full security report in that note, and surrounding consumers. The production change only makes the two existing session selects async/materialized. All three consumers retain first-row destructuring and no-row rejection. Exact session/user/agent-portal/expiry predicates, the supplied transaction executor, UTC-wall-clock expiry expression, row lock and limit remain. No array-truthiness bypass or global-connection fallback is introduced. The accepted regression covers deleted-session HTTP preflight plus non-agent-session denial during operation and pending-action issuance, with the authentication verifier uncalled.

These imports are blob-identical to accepted 1305; A's time-entry controller and B's approval fixtures do not alter the auth callers or session query contract. I examined the intervening commit graph as well as endpoint trees; the authentic intermediate 455 defect and later 7d301 repair remain in the accepted history and review record. They are not hidden by a net-tree comparison. Accepted-#813 clearance remains source-bound to its prior reviewers and acceptance evidence, not a new full auth audit performed here.

## C — operation-proof persistence at dcf4071f

**Reviewed head:** dcf4071f79c7046cab343e51acadc2e9983b9e09

- Worktree: `/Users/heinthura/.codex/worktrees/remaining580-operation-proof-persistence-author-luna`.
- First parent / fully reviewed source: `7f4f0a2865e9ff1006f88edab264f4c9d3031324`.
- Other exact parent: accepted #813 `130508ef24f6442a59dbccaf305712891c8b3fbb`.
- Both first-parent and current tree: `d15260509b29f187945946c64a8ebf785db622e3`.
- Prior full-source comparison base: `433ea7769d1b8440046cfe7ba39acc23e029489c`; full two-path security report `operation7f4-full-security-61-sol.md`.

I verified the exact parents, complete tree equality, empty first-parent path diff and both owned mode/blob entries. The source already contains accepted #813's publication; this normal merge adds accepted-parent metadata without changing source. The intervening graph introduces accepted merge1305 and the final metadata composition, not an unreviewed reverted source experiment. There is no new lifecycle source delta requiring another full two-file audit.

I read the two original ordinary reports, both authentic wording corrections, the full independent security report and the current ordinary composition confirmation. The retained full review covers the three awaited repository lifecycle batches using the exact caller transaction and materialized rows, with existing operation/session/person/route/version/hash/state/expiry bindings and rollback seams. Its analysis stays attributed to source7f4 and its original reviewer. The earlier dependent-base caveat is resolved only as to the accepted-parent composition established here, not as to current candidate CI/image acceptance.

I independently inspected the exact-7f4 result/invocation/runtime records and raw footer: four files/159 tests, native exit 0/no timeout, 67.76 seconds. Raw log is 362,634 bytes / SHA-256 `4cf595ead210ed81d84984d0046fec479c3a0f175e6794b10d66543ac7e32cd2`; saved cleanup comparison is unchanged 23/109/7, private environment absent. The run's four files are local-factor policy, policy concurrency, and the two identity non-UTC wrappers. Role/policy concurrency is not an operation-proof race test. The audit-savepoint-failure case followed by a successful protected mutation is not an outer proof-plus-mutation rollback test. Canonicalization unit coverage was inspected previously but was not one of those executed files. The attempt-limit throw is inside its transaction callback. Those precise coverage corrections remain controlling.

**Separate C verdict: CLEAR for lightweight metadata-only composition.** Prior full source clearance remains valid for what it actually covered; no duplicate full-audit claim or new runtime claim is made. Shipping image build, boot, migration and health proof remain mandatory for the candidate and are not supplied by this focused PostgreSQL evidence.

## D — records #803 at 6f990aae

**Reviewed head:** 6f990aae91590ef79db60c6433fa425b2390424e

- Worktree: `/Users/heinthura/.codex/worktrees/takeover-status-20261016`.
- Previously published records base: `9d7d01eb6434122bd257e5b268b111a4fd20b9f8`.
- Normal accepted-#813 merge: `24893ab7662b13d9c9d7b0ba868528cd97dfc0ff`, parents 9d7 and `130508ef24f6442a59dbccaf305712891c8b3fbb`.
- Dated-record commit: `402558cc003a3a36b2c9f5c2e4ca94851056bb99`, single parent24893ab7.
- Current one-line correction: 6f990aae, single parent402558cc; current tree `2236c04f1e65f4256f451431cf7b9ea98c2b328e`.
- Retained full normative review: source `a92e2798d6eb28f6f1ee58821473b8a65dc7fec0` against accepted `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`, `records803-a92-full-ordinary-luna.md` and `records803-a92-full-security-61-sol.md`.

I read the full new status/queue/decision-log diff, preservation and timestamp proofs, current ordinary blocked report and authentic CLEAR correction, and prior full normative reviews. I independently compared raw Git objects: all 1,326,849 old status bytes and 225,676 old queue bytes remain exact suffixes; all 662,278 old decision-log bytes remain an exact prefix, with the proof's original hashes matching. The normal merge imports exactly the same three accepted paths assessed above, whose current blobs match1305. The API-design and CI/CD normative files are exactly blob-identical to reviewed a92 (respectively `73e4a93c4b3d6aa757cc20b58bf5cdc540c15364` and `4a54d988498bf4bdfdc16c20a576fba146fd93f5`). No new release classification, erasure entitlement, reviewer authority, retry policy, exception or waiver is introduced by the dated records.

The retained normative scope still requires live GitHub prerelease classification, fail-closed uncertainty and exact independently reviewed finding fingerprints. The erasure summary stays bound to the authenticated deletion subject's current persisted memberships and member/owner safety counts, with joined workspace names only for the existing conflict message. No other-member identity disclosure or general reach exemption follows. Those are conserved prior contracts, not product implementation approved here.

The new accepted-#813 facts match the supplied protected-acceptance/readiness and run receipts: normal merge02:55:50Z, accepted1305/publication433, exact publication/synthetic tree, 18 completed successful contexts, PostgreSQL222files/3284tests/five tasks, browser63/G1122 and the stated medians, final unit12/API121files872tests/web186files1023tests, and the candidate shipping-image record125migrations/UID10001/health200/nohostports/owned isolation/cleanup. I independently matched raw PG and final-unit log byte counts/hashes and their suite footers. I did not reauthenticate hosted jobs or rerun image verification. These remain accepted-813 facts at the snapshot cutoff, not current passes for records6f990 or the other three candidates.

The sole 402 ordinary blocker is closed: the current snapshot uses job117282971158 completion02:42:53Z, matching `813-pg-success-receipt.json`. Raw Vitest summary02:42:50.559Z is a distinct timestamp. The ordinary report's mistaken second-parent description for402 is explicitly corrected by its authentic addendum; actual Git metadata agrees with that correction.

The new A/B/C paragraphs retain adverse runs and required new gates honestly. Carrier addendum6/frozen5 and earlier main5a references are historical source-bound observations, not claims of present Carrier readiness or current accepted main. Old dated text remains immutable. The remaining held performance, owner decisions/deferrals, final signed artifact, exact-digest SIT, nonempty-attachment backup/usable isolated restore, final audit and phase obligations remain open. I did not audit every old snapshot or current Carrier implementation.

**Separate D verdict: CLEAR.** No dated-fact, authority inflation, provenance-erasure or composition security blocker remains in the assigned current records delta.

## Actual checks, preserved coverage and limits

I read the supplied user instructions, then reloaded the actual accepted guide/mission/workflow/provider-adapter versions from candidate worktrees and verified their blobs equal accepted1305 in all four worktrees. Relevant specialist reads covered the current CI security-path list and review/evidence-reuse rules, query-ownership/results/executor and UTC rules, approval reach/authority/private visibility, legacy time-entry routing/repository scope, PA-15 and session step-up contracts, and the conserved release/erasure standards. Read the newest dated record and decision context. No open product question was invented.

Read-only checks actually performed: `pwd`; bounded `cat`, `sed`, `rg`, `head`, `tail`, `ls`; exact `git status`, `log`, `show`, `rev-parse`, `diff`, `ls-tree`; read-only Python subprocess/pathlib/json/hashlib for parent/tree/path/mode/blob conservation, old-byte preservation and saved-log verification. `git diff --check` exits0 for A:e30..c332, B:d65..247, C:7f4..dcf, D:9d7..6f990. Final pre-report assertions confirm all four exact heads and clean candidate worktrees.

Some initial combined reads exceeded tool output limits; relevant guide, source and prior-report ranges were subsequently read separately or verified directly against Git objects. Two initially guessed specialist-document paths were absent and corrected to `docs/01-architecture/pending-actions.md` and `docs/01-architecture/api-design.md`. No conclusion relies on unseen truncated text or absent-file output.

**No tests/reproductions, typecheck, install, build, PostgreSQL, Docker, browser, live inventory, CI action, GitHub/ref mutation, source/shared-document edit, commit, push, merge or delegation was performed by this reviewer.** No live GitHub state was queried; the assignment froze exact local heads and authorized source/actual saved-receipt inspection. Current remote readiness must still be established by the conductor. The only new file is this authentic external report, exclusively created with mode0600.

Earlier full reviews remain at their real scope: A40 paths, B15 paths and its real earlier import, C2 paths, and D's full normative/records candidate. The 21 A and13 B authentic-publication report sets and their earlier publication proofs are preserved, not claimed newly re-verified byte-for-byte by this bounded review. `accepted813-next-hosted-count-expectations.json` is explicitly expectations only, not an executed result or pass. Old811 green CI never accepts the repaired source. No required GitHub check is reused. No existing source-review report becomes runtime/SIT evidence or supplies a gate waiver.

**Completed at:** 2026-10-17T03:06:39.911519+00:00

## Reviewer precision addendum before delivery

The B paragraph saying the original 15 entries are unchanged “except their designated own review note” should read precisely: **all 15 original full-review-owned source/test paths are unchanged; the designated own review note is an additional publication path outside those original 15, and the two fixture paths are the newly reviewed repair.** This clarifies the original inventory and changes no finding, source comparison or verdict. The full text above is retained.


## Current exact source binding

All reports retain their stated scopes. Only this candidate's own regular review note is added/appended after the independently reviewed source. Exact-publication full hosted/image gates remain outstanding.

**Reviewed head:** `24711f617d5e1134e36d83e3afadd85e206f0afa`


## Structural customer-audience repair and accepted814 composition — 2026-10-17

This appendix supersedes readiness assertions only for current source5f21e468818d7d171eaf0cce50edb9bdb3354c5b on acceptedmaine848f3bd05bec95c8af657c29923a6413a11c63f. All earlier report bytes and adverse findings remain unchanged. Author reports are not independent reviews. The initial staff/private-customer restriction, three stale privacy-as-project-revocation fixtures and fullSol e829 cross-identity P1 all remain preserved below. Structural5548 retains persisted audience regardless of loader and checks the actual subject identity; two independent ordinary contexts and fullSol clear that application repair. Test-only8de corrects globaladmin403 assumptions and adds actual nonadmin session/key404/no-write. Separate current ordinary and fresh independent GPT-6.1 Sol bounded confirmation clear5f21, preserving prior full-source audit coverage and the admin403 isolation caveat. No new capability, route, schema or dependency.

Root actual focused PostgreSQL:6c76/79native1;814b78/79native1;5548 94/95native1. Current5f21 eightfiles95/95/native0/40.872seconds, raw200496bytes SHA256b8314d5fc6600a164f4bb255a43f6601f5f6ce06c651b38a6224aca755e5f76a. Exactownedcleanup23containers109volumes7networksunchanged. Selected denial table snapshots are not database-wide audits. Current composition matches all3396mode/type/blobentries as acceptedmain+20ownpaths; three incoming814paths unchanged. Old78c full223/3291/5 and browser/image results do not accept this source. New publication requires full hosted, image, browser/performance and newest protected checks. No source/CI/SIT/stage/mission completion or waiver is claimed. Some earlier commits used configured Thomas author metadata; actualGPT6Luna authorship is disclosed, and history is preserved.


### Preserved report `query812-5548-cross-identity-ordinary-a-luna.md`

# PR812 5548 cross-identity audience repair — ordinary confirmation A

**Requested model:** GPT-6 Luna. **Reviewer context:** reused independent context from prior bounded reviews; did not author, direct, or remediate the candidate.

**Reviewed head:** `5548dfde601fdbaf6ac614316eb8a3c3b26220f2`
**Parent:** `e829205e7c212e7fcaecceed0e0365816b14d847`
**Verdict:** APPROVE the bounded structural repair by static inspection. Exact-head PostgreSQL verification remains pending the orchestrator run.

## Checks performed

Inspected the net two-path delta, including the structural change at `6ce634a60c2c38c962f9c897db0304787b1a9c74` and assertion follow-up in 5548; read the author report and the full e829 Sol finding. Traced both `ApprovalTarget` constructors, every `reachFacts`/`visibleToPersonIds` use and approval consumer, including `createApproval`, `formatApproval`, inbox/list paths, decide and withdraw checks. Read canonical identity resolution for side admission and checked AP-3, CP-16, and neighboring staff/customer reach patterns. No tests, analyzers, typecheck, install, build, database, Docker, browser, CI, Git refs, or source edits were performed in this reviewer context.

The e829 blocker was real and exposed by a cross-identity call: staff loaded an `ApprovalTarget` with `visibleToPersonIds: null`, then `createApproval` reused it to test a different proposed customer approver; `formatApproval` similarly evaluated the named approver using the viewer-loaded target. The new invariant stores requester/participant audience facts on private targets independently of the loader. `hasWorkItemReach` then drops only those audience facts for the identity currently being evaluated when that identity is staff; customer evaluation keeps the persisted list. Thus a same-organisation nonparticipant customer fails AP-3 even when a staff requester loaded the target, while an actual customer participant can pass. On participant removal, staff list computation and the customer’s own addressed inbox evaluate that customer against the same actual private audience and report reach loss; the customer decision remains independently reach-checked.

I verified by `rg` that these are the only two target constructors, `hasWorkItemReach` is the only direct reach-facts consumer, and all approval reach decisions route through it. The data flow is identity-stable at the evaluation boundary. This does not grant capability: route/service capability checks remain separate, including key capability-subset gates. The SQL staff visibility exception remains confined to the visibility component and ANDed with current project reach and item/project liveness; anchored workspace joins/filters remain. Side is admitted only from canonical `person.side` values `staff` or `customer`; unknown values cause identity resolution to return null. No request-controlled side or new authority source is introduced.

The added end-to-end test statically preserves and asserts the key counterexamples: nonparticipant customer request returns 422 and leaves approval/outbox/audit/notification rows unchanged; participant request succeeds; after participant removal, staff list and customer portal inbox mark reach lost, customer decision returns 403 while pending state remains, and the AP-15 transition remains blocked.

## Limits

The prior exact-814 PostgreSQL evidence remains adverse at 78/79, and is not evidence for e829 or 5548. The orchestrator reported an exact-5548 focused PostgreSQL run running when this report was prepared; no result was available here, so I claim no runtime pass. This is a bounded ordinary confirmation of the new cross-identity invariant, not a fresh full-source audit, Sol review, or runtime/merge clearance.


### Preserved report `query812-5548-cross-identity-ordinary-b-luna.md`

# PR812 cross-identity audience repair — ordinary review B

- **Candidate:** `5548dfde601fdbaf6ac614316eb8a3c3b26220f2`
- **Previous review head:** `e829205e7c212e7fcaecceed0e0365816b14d847`
- **Reviewer:** GPT-6 Luna, same independent ordinary B context; this is the first ordinary review of the new structural repair, not a repeat review of an unchanged candidate.
- **Scope:** exact two-path delta plus every approval `reachFacts` construction/consumer/call site, cross-identity approval creation and formatting, customer approval lookup/decision path, SQL staff reach/liveness scope, and the added end-to-end test sequence.
- **Verdict:** No blocking ordinary-review finding on source inspection. The e829 full Sol P1 is addressed structurally in the inspected code; exact-head runtime remains pending.

## Finding disposition and invariant

The e829 P1 is addressed by preserving requester/participant audience facts in both target loaders regardless of who loaded the target, then applying those facts according to the identity actually being checked in `hasWorkItemReach`: staff evaluation clears only `visibleToPersonIds` and checks canonical staff project reach; customer evaluation passes the persisted audience list into `reaches`. This fixes the cross-identity case in approval creation, where a staff-loaded target is checked against a different, proposed customer approver, and in staff formatting, where the named customer approver's current reach is evaluated against the staff viewer's target.

I searched all approval references to `reachFacts`. Both target loaders are the only constructors; `hasWorkItemReach` is the only direct consumer. Its call sites include the create-time proposed-approver check in `service.ts`, current-user action checks, and `index.ts` formatting of a named approver against a target loaded for the viewer. The updated evaluator behavior addresses these distinct identity roles. No other approval code reads the private audience list directly, and the internal target facts are not serialized by the response formatter.

The SQL staff visibility exception remains narrow to the private-visibility component and is still conjoined with `currentProjectReachPredicate`, item/project liveness, archive state, and workspace/project anchoring. The loader carries the current project organisation. Customer lookup still uses the requester/participant predicate, and `hasWorkItemReach` additionally checks the same persisted audience list for a customer. Staff reach revocation still relies on the real canonical project membership fix and its exact 404/403 tests from e829.

## Regression coverage inspected

The new request path builds actual same-organisation customer identities: a private requester, an actual participant approver, and a same-org colleague who is not a participant. A real authenticated staff request to address the colleague expects 422 and snapshots approval rows, `approval.requested` outbox events, audit events, and notifications before/after to ensure no request side effects. The subsequent request to the actual participant expects 200/pending.

After deleting only the participant's row, the test checks both the staff work-item approval list and the named customer's portal inbox report `approverReachLost: true`; the named customer's portal decision returns 403 and the approval remains pending. The AP-15 transition remains blocked. Existing requester/participant lookup, customer colleague 404, staff private-item success, generic key 404 after staff project membership revocation, own-approval metadata, and workspace/project/organisation reach checks remain in the test file.

The portal calls use `portalRequest`, which sets the customer portal host/session, and all the request/decision cases hit the real app handlers. The test fixtures create distinct customers and scope the participant deletion to this work item and the named approver.

## Checks and limits

- `git diff --check` passed for the e829-to-5548 delta.
- Source/diff/search inspection only. No tests, compiler/analyzer, install, typecheck, build, PostgreSQL, container, Docker, browser, PR/CI, or ref mutation was performed.
- Root's 8-file exact-head PostgreSQL run was reported running at assignment time; this review does not claim its result. Earlier adverse runtime receipts for 6c and 814 and the e829 Sol finding remain attached to their exact heads and are not reclassified as current-head evidence.
- This is ordinary review B, not independent GPT-6 Sol security clearance, runtime acceptance, merge approval, or phase completion.


### Preserved report `query812-5548-cross-identity-security-61-sol.md`

# PR812 5548 — independent security recheck of the cross-identity audience repair

**Reviewed head:** 5548dfde601fdbaf6ac614316eb8a3c3b26220f2

**Delta base:** `e829205e7c212e7fcaecceed0e0365816b14d847`.
**Full candidate comparison base:** accepted main `130508ef24f6442a59dbccaf305712891c8b3fbb`.
**Prior report retained:** `query812-e829-full-customer-boundary-security-61-sol.md`, authentic BLOCKED verdict on e829. It is not edited, withdrawn, or relabelled as a pass.

**Reviewer/context:** GPT-6.1 Sol requested, same independent security context `/root/query812_e829_full_customer_boundary_security_sol` reused for this changed candidate and disposition of my P1. Requested dispatch provenance remains `gpt-6.1-sol`, `fork_turns=none`, `reasoning_effort=high`; an independently verifiable serving model/version/build fingerprint is unavailable. I did not author, direct, or remediate the candidate, and did not spawn another agent. Source counterexamples and acceptance invariants in my earlier finding were review work, not a patch or implementation design.

## Verdict

**CLEAR for the current structural security delta; e829 P1 is closed on 5548 by source inspection. No new blocking or non-blocking product-security finding was identified.**

**Runtime validation remains BLOCKED:** the conductor's actual exact-5548 PostgreSQL run failed: eight files, 95 tests, 94 passed and one failed, native exit1. The successful new cross-identity regression does not make that run green. This source verdict neither waives the failed test nor authorizes merge, feature/stage completion, release or SIT acceptance.

## Scope and evidence continuity

This is the complete current security delta recheck, retaining the actual full20-path e829-vs1305 source audit and its stated limits. I inspected every intervening commit, the exact current two-path diff and all connected current constructors/consumers:

- `6ce634a60c2c38c962f9c897db0304787b1a9c74`: structural application repair and regression extension.
- `5548dfde601fdbaf6ac614316eb8a3c3b26220f2`: one additional no-write assertion.
- Changed paths: `apps/api/src/approval/repository.ts` and `tests/api-integration/approval-repository.test.ts`; net100 additions/six deletions.

Actual Git history shows a linear e829→6ce→5548 chain and only those two changed paths. The other18 paths of the prior full audit remain unchanged. The combined source coverage remains the original eight application paths, eleven tests/helpers and historical note; I do not claim a new line-by-line full reread of all unchanged files. The original15-path historical source reviews, composition confirmations and19 authentic published reports retain their real sources and limits. My prior independent verification of their bytes/hashes and unedited note embedding remains historical preservation evidence, not runtime proof or newly manufactured reviewer independence.

Read the current author report and both exact5548 ordinary CLEAR reports. I independently checked their core claims against the actual code. Neither those reports nor the conductor's packet sets product behavior.

## P1 disposition — stable persisted audience, evaluation for the actual identity

Both `loadApprovalTargetByKey` and `loadApprovalTargetByApprovalId` now retain the private requester/participant ID list without conditioning that stored fact on the loading identity. Private items with no requester retain an exact participant list or an empty list, never unrestricted null visibility. Organisation-visible items retain null, as before.

`hasWorkItemReach(identity, target)` is the single direct approval consumer of `target.reachFacts`. It creates a new shallow fact object with `visibleToPersonIds: null` only when the identity actually being evaluated has `side === 'staff'`; otherwise it passes the persisted audience facts unchanged. It does not mutate the target or its stored audience. Consequently one staff evaluation cannot strip the facts needed by a later customer evaluation. The exact-staff condition also avoids an implicit unknown-side bypass. Canonical `resolveIdentity` admits only persisted `staff` or `customer` side values and returns null for an unknown side (`resolve-identity.ts:690-695`). No caller supplies side from the request body.

I searched every approval `ApprovalTarget`, `reachFacts`, `visibleToPersonIds` and `hasWorkItemReach` reference. The two loaders are the only constructors and the helper is the only direct reach-facts consumer. In particular:

- `createApproval` still loads for the staff requester, but evaluates the separately resolved proposed customer approver through the common helper. A same-org nonparticipant now fails the private-person test before the pure evaluator's organisation branch. An actual requester or participant retains the allowed customer path. Staff requesting/listing on a private request keep their own canonical project reach without needing customer participation.
- `formatApproval` resolves the named approver and evaluates that person's identity against the preserved audience even when the viewer is staff. Removing a customer's participant row therefore produces `approverReachLost: true` in staff views and that customer's own addressed inbox.
- Customer decision admission still checks actual current reach, then takes current scoped locks and a pending conditional update; the own-addressed metadata exception remains separate from permission to decide. Requester withdrawal likewise uses the actual acting identity and capability, while its dedicated admin exception stays session-only.
- Existing SQL request visibility remains exact-staff-only and ANDed with current project reach plus item/project liveness; tenant/workspace joins, generic key lookup denial after staff reach revocation and the metadata-only approval exception remain unchanged. The repair does not weaken SQL resource scope.

API-key and authority behavior is unchanged by this delta. The request adapter preserves key kind, owner and subset; `can` keeps project-role authority and stored-key-subset intersection with fail-closed missing subset. The staff-specific privacy projection affects reach only, not capabilities, requester/named-approver eligibility, CAB membership, or the session-only admin withdrawal restriction. No new route, grant, capability, schema, dependency or generic access exception appears.

This closes the actual P1 mechanism rather than special-casing the original caller or fixture. The P1 closure is independent of the separate runtime discrepancy below.

## Regression inspection

The new case uses actual same-organisation customer requester, customer participant and nonparticipant colleague identities, authenticated staff requests and real handlers. It expects422 for the nonparticipant and compares complete selected approval rows plus `approval.requested` outbox, audit and notification rows before/after. It then expects200/pending for the participant, verifies reachable status in the staff view, deletes only that customer's participant row, and expects reach loss in both staff list and the customer's portal inbox. The portal decision expects403 and pending state; AP-15 remains blocked. `portalRequest` supplies the customer host and customer session, and `runTransition` restores the staff requester session.

Existing direct requester/participant allowance, customer colleague404, null-requester private denial, project-organisation scoping, ordinary staff access and real staff membership-revocation checks remain. These are meaningful counterexamples for the cross-identity mechanism. The snapshots are selected approval/request-event tables, not a claim of a universal database-wide write audit.

## Exact-head adverse runtime and diagnosis

I read the conductor-produced `query812-runtime-5548df/candidate-check.txt`, invocation, result wrapper, inventory-diff receipt and raw log. Candidate check binds clean source5548 and the eight selected files. Invocation covers work-item project reach, approval repository, tenant checks, feature flag, both gate timezone wrappers, gate semantics and lifecycle. The wrapper reports start03:54:36.465234UTC/end03:55:17.906776UTC,41.441seconds, no timeout, native returncode1. Raw footer: seven files passed/one failed;94 tests passed/one failed. All source counterexamples in the updated repository test passed within the seven successful files.

I independently hashed the raw log:188,880bytes, SHA-256 `9273ea7b63ad84397610e9eb1b3410b27fbb8d4310ec677e483a0b3211f05aae`, matching the conductor's supplied digest. The saved inventory comparison reports23containers/109volumes/seven networks unchanged; I did not independently query Docker.

The failure is `tests/api-integration/approval-lifecycle.test.ts:649`: `adminKeyWithdrawal.status` was403, expected404. I inspected the setup, actual route, canonical identity, current SQL scope and withdrawal rules before classifying it:

- Despite its variable name, this call addresses the ordinary requester route `/api/approvals/{id}/withdraw`, not the dedicated admin route.
- The fixture explicitly changes its staff user's `user.role` to `admin`. Canonical identity resolution assigns a current instance admin `reach.kind = 'all'` (`resolve-identity.ts:543-570`), including a key credential. RBAC reach step1 is global instance-admin reach; lack of membership in the target workspace does not remove that reach. The current SQL instance-admin predicate checks the actual current staff/admin/active/not-banned facts. Thus the fixture comment saying this owner has no reach in that workspace is false for the identity it creates.
- The staff identity's ordinary reach is no longer accidentally suppressed by CP-16 participation. Reach does not grant withdrawal authority: this key lacks `approval:request` and is not the approval requester, and the ordinary route does not opt into the session-only admin exception. A403 denial is consistent with the actual authority setup; I found no new product-security grant in this result.
- The later ordinary-route404 assertions for a scoped admin key at672 and an admin session at709 use the same promoted-admin/no-target-workspace premise. They had not run after the first failure, so I do not report their actual results or count them as additional observed failures. They are related fixture assumptions for the owning lane to assess. The dedicated admin key call remains a separate session-only403 case.

The current run remains adverse until the genuine fixture/contract mismatch is resolved and the required verification is rerun. This report does not change test expectations, supply a gate waiver, assert a universal status oracle, or call unexecuted later checks passed. Earlier6c and814 adverse results and the old78c223-file/3,291-test/five-task result remain bound to their actual sources; none accepts5548.

## Actual reviewer actions and limits

Read-only `git status`, `git rev-parse`, `git log`, `git show`, exact diffs/stat/name lists, `rg`, `cat`, `sed`, numbered source reads and Python byte/hash inspection only. Current head was5548 and short status empty at final source check. I inspected the unknown-side fail-closed branch, pure evaluator/key clamp, current SQL composition, all affected cross-identity consumers and the complete new test sequence. One exploratory identity-test filename did not exist and supplied no evidence.

No tests/reproductions, analyzer/compiler, typecheck, install, build, PostgreSQL execution or DB mutation, Docker/container action, browser, CI/GitHub/ref action, source/shared-document edit, commit, push, merge or delegation was performed by me. This external report is the sole new file for this follow-up, created with `O_EXCL` and mode0600. Earlier report remains intact. Existing disclosed impersonation/per-request revocation/single-use residuals remain at their prior scope. This source security clearance is not a full passing test result, hosted-check approval, image acceptance, integrated SIT proof, phase finalizer or mission-completion claim.

**Completed at:** 2026-10-17T03:57:46.369014+00:00


### Preserved report `query812-5f21-admin-fixture-composition-ordinary-luna.md`

# PR812 admin-reach fixture repair and accepted-main composition — ordinary review

- **Candidate:** `5f21e468818d7d171eaf0cce50edb9bdb3354c5b`
- **Relevant own-source parent:** `8de39e83e7bb9b3a1e3bb76946240866a0f6eedc`
- **Accepted main parent (#814):** `e848f3bd05bec95c8af657c29923a6413a11c63f`
- **Reviewer:** GPT-6 Luna, reused independent ordinary-review context; no authorship, direction, or remediation of the reviewed changes.
- **Scope:** the 8de→candidate lifecycle fixture delta, exact admin/session/key/reach/write semantics, the accepted-main merge composition and retained exact-head runtime receipt.
- **Verdict:** No blocking finding in this bounded review. The corrected 404 and 403 oracles match the actual global-reach versus authority contract, the dedicated admin route remains session-only, and the accepted #814 import is intact.

## Admin and not-found oracle

Canonical identity resolution derives `reach.kind = "all"` and `instance:admin` authority from the current persisted admin role for an active staff person; the API-key credential path retains that owner's global reach while its capability subset remains clamped. The RBAC contract explicitly says this global reach does not imply workspace/project capabilities. Accordingly, no target workspace membership does not make a current instance admin an out-of-reach caller.

The ordinary requester withdrawal route has `approval:request` policy, requires row reach, and invokes `withdrawApprovalForIdentity(... allowInstanceAdmin: false)`. `canWithdrawApproval` opts into its admin exception only when that flag is true and the credential is a session. The domain relation is `requestedBy === actingPersonId || isInstanceAdmin`; the ordinary route passes false, so an admin who is not the actual requester is not authorized there. The dedicated route first checks current instance-admin session state, passes `allowInstanceAdmin: true`, and rejects API keys via its session-only route policy. These checks support the repaired behavior:

- A real non-admin in another workspace, including a key scoped to `approval:request`, receives 404 through the ordinary route because neither session nor key has current target reach. The row remains pending and withdrawal event/audit counts do not change.
- A global admin session or admin-owned API key on the ordinary requester route has global reach, so the target is not treated as missing; the route correctly answers 403. State and withdrawal event/audit counts remain unchanged.
- An API key is still refused on the dedicated admin endpoint, even when its stored key scope names `approval:request`. The session admin succeeds on that endpoint and the later test checks its audit trail/withdrawal state.

The earlier 404 expectations incorrectly treated workspace absence as no reach for a global admin. The added separate non-admin session and key cases retain the intended cross-workspace 404 oracle. The route and domain still separate reach from requester relation and capability.

**Coverage note, not a product finding:** the instance-admin identity used in these 403 cases has no target project capability grant; `instance_admin` itself carries `instance:*`, and a key's `approval:request` scope cannot exceed the owner's authority. Thus the ordinary-route 403 for an admin does not independently isolate the requester-relation check from the route's `approval:request` capability denial. The code explicitly passes `allowInstanceAdmin: false`, `evaluateApprovalWithdrawalDecision` enforces the requester relation, and its domain tests cover a non-requester refusal. If a future API regression test needs to isolate the relation at the handler boundary, it can give the nonrequester admin a target-project `approval:request` role and a matching key scope, while retaining the expected 403 and separate dedicated-route session/key cases. I do not treat this limitation as blocking this test-oracle correction.

## Accepted #814 composition verification

The merge commit has parents `8de39e83…` and accepted main `e848f3bd…`. I independently parsed tracked Git trees (`git ls-tree -r`) for the own-source parent, accepted main, and candidate, then overlaid the proof's 20 own paths on accepted main. The result exactly matched the candidate for all mode/type/blob entries: accepted-main tree 3,394 entries; own-source tree 3,395; candidate 3,396; exact overlay `true`. The accepted #814 proof records 20 own paths, three incoming paths, 3,396 entries, no overlap/resolution, and the same exact-overlay result. The incoming auth repository, step-up service, and operation-proof security note equal accepted main. `git diff --name-status e848f3bd..5f21e468` contains only the 20 own approval paths; `git diff --name-status 8de39e83..5f21e468` contains only the three accepted #814 paths. No approval source was lost and the incoming #814 source is unchanged from accepted main. This confirms composition only; I did not conduct a new review of #814's auth implementation.

## Exact-head runtime receipt inspected

The retained `query812-runtime-5f21e4` evidence binds SHA `5f21e468…`, clean source and eight verified paths. Its PostgreSQL integration invocation completed without timeout at native return code 0: eight files passed, 95 tests passed, 40.872 seconds. The raw log SHA-256 is `b8314d5fc6600a164f4bb255a43f6601f5f6ce06c651b38a6224aca755e5f76a`, matching root's stated receipt; final inventory receipt reports no container/volume/network additions or removals. This is the selected eight-file PostgreSQL evidence only, not full CI, build, browser, image, or release acceptance. I inspected retained evidence; I did not run tests or inspect Docker independently.

## Checks and limits

- `git diff --check e848f3bd..5f21e468` passed; final `git status` was clean.
- Read-only diff/source/report/receipt inspection and a read-only mode/type/blob-tree comparison only.
- No tests, compiler/analyzer, install, typecheck, build, database, container, Docker, browser, CI/GitHub/ref mutation, source edit, or commit was performed by this reviewer.
- This bounded ordinary confirmation does not replace the retained ordinary/Sol reviews for the cross-identity application repair, the accepted #814 gates, or broader CI and deployment acceptance.


### Preserved report `query812-5f21-current-security-61-sol.md`

# PR812 current-head security delta and accepted-main composition confirmation

**Reviewed head:** 5f21e468818d7d171eaf0cce50edb9bdb3354c5b

**Own-source delta base:** `5548dfde601fdbaf6ac614316eb8a3c3b26220f2`.
**Own-source parent:** `8de39e83e7bb9b3a1e3bb76946240866a0f6eedc`.
**Accepted-main merge parent:** `e848f3bd05bec95c8af657c29923a6413a11c63f` (#814, supplied accepted state).
**Earlier full-audit comparison base:** `130508ef24f6442a59dbccaf305712891c8b3fbb`.

**Reviewer/context:** fresh independent security context `/root/query812_5f21_current_security_sol`. I did not author, direct or remediate this candidate and spawned no agent. I am not the prior e829/5548 security reviewer. The conductor provided the invocation provenance `model=gpt-6.1-sol`, `reasoning_effort=high`, `fork_turns=none`; I cannot independently inspect the parent's invocation or a serving-model build fingerprint. This report records the requested GPT-6.1 Sol security role, without inventing additional model telemetry.

## Verdict

**CLEAR for this bounded current-head security delta and composition confirmation. No new blocking or non-blocking product-security finding identified.**

The e829 P1 remains closed by the structural repair reviewed on 5548. Current approval source preserves immutable-in-use private audience facts and evaluates the actual identity. The subsequent own-source change is test-only, correcting global-admin reach assumptions while retaining real non-admin cross-workspace denials. Accepted #814 is composed unchanged, with no approval overlap or resolution.

This is not a new full audit of every unchanged candidate line. I read the authentic earlier full source audit `query812-e829-full-customer-boundary-security-61-sol.md` (BLOCKED) and its follow-up `query812-5548-cross-identity-security-61-sol.md` (structural source CLEAR, then adverse runtime). Their actual eight application paths, eleven tests/helpers and historical note coverage, findings, original identities and limits remain retained at their original SHAs. I independently inspected the current connected security mechanisms described below. I do not relabel those reports as my own work or make their old runtime results current.

## Inspected delta and current invariants

`5548dfde..8de39e83` changes only `tests/api-integration/approval-lifecycle.test.ts` (52 additions, seven deletions). I read the entire actual diff and surrounding test setup, key helper, effect counter and member fixture. The three ordinary-route admin expectations change from404 to403; the additional separate ordinary non-admin session/key cases retain404 and check pending state plus unchanged selected withdrawal event/audit counts. The admin denial cases also check pending state and event/audit counts. These snapshots are selected effects, not a database-wide no-write audit.

I inspected current `apps/api/src/approval/{repository,service,index,evidence,policy}.ts`, `apps/api/src/database/repositories/identity-scope.repository.ts`, relevant `apps/api/src/permissions/resolve-identity.ts`, `packages/permissions/src/evaluator.ts`, `apps/api/src/utils/require-session-only.ts`, `packages/domain/src/approvals/{approvals.ts,approvals.test.ts}`, the cross-identity regression in `tests/api-integration/approval-repository.test.ts`, `tests/api-integration/helpers/fixtures.ts`, and the AP-3/AP-6/AP-7, CP-16 and RBAC instance-admin contracts.

- Both target loaders retain the persisted private requester/participant ID audience regardless of the loading identity; private items without a requester retain a participant list or empty list, not unrestricted null. `hasWorkItemReach` passes a new shallow projection with null audience only for the identity actually evaluated whose side is exactly staff. It never assigns into the target or strips facts required by a later customer check. Unknown persisted side fails identity resolution closed.
- Creation resolves the proposed approver independently and checks that identity against the retained target facts. Staff formatting likewise evaluates the named approver, not the viewer. A same-org customer nonparticipant remains outside private reach; a removed participant becomes reach-lost even in staff views. The unchanged regression checks422 and selected no-write rows for the nonparticipant, participant success, staff/customer reach-loss flags, portal403/pending and an unsatisfied transition gate. I inspected these assertions; I did not execute them.
- Staff privacy exemption remains local to the customer audience component. SQL scope still requires current canonical project reach and live item/project facts, with approval/work-item workspace anchoring. Current staff instance admins have global reach from persisted admin authority; staff without target reach do not gain it merely because customer participation is irrelevant to staff. Reach is separate from capability and actor relation.
- The ordinary withdrawal route declares `approval:request`, publishes anchored evidence, and passes `allowInstanceAdmin:false`. The domain relation remains actual requester or an explicit admin exception; the ordinary path does not opt into that exception. API keys still need their owner's applicable authority intersected with their stored subset, and missing key-subset facts fail closed. An admin-owned key's scope cannot manufacture owner project authority.
- The dedicated admin route retains both `sessionOnly:true` policy and executable `requireSessionOnly()` middleware, which refuses API keys and impersonation. It checks current instance-admin state, resolves the session identity and alone opts into the admin withdrawal path. Repository admin scope and helper opt-in remain session-only. Approval deciding is not granted by this withdrawal exception.

The revised403 oracles agree with the actual global-reach identity setup: absence of target workspace membership does not make an instance admin globally out of reach. The new ordinary non-admin user is created in a distinct workspace without promotion and receives neither target project reach nor an own-approval metadata relation; its session and scoped-key404 checks retain that intended boundary.

**Coverage residual, not a new product finding:** the admin403 calls lack a target project `approval:request` grant. Their denial alone does not isolate the requester-relation condition from capability denial. The current ordinary handler explicitly disables the exception and the domain tests cover nonrequester refusal. I agree with the ordinary report's limited conclusion and do not claim these integration assertions independently prove every denial layer.

## Accepted-main composition

I independently read the actual parent SHAs and compared Git tracked trees including mode/type/blob entries, using the20 own paths named in `812-accepted814-composition-proof.json`. Accepted main has3,394 entries, the own parent3,395 and candidate3,396. Overlaying those exact20 own-parent paths onto accepted main exactly equals the candidate. Every own path equals the own parent; each incoming path equals accepted main. The actual diffs contain only the20 own paths against accepted main and only the three incoming paths against the own parent:

- `apps/api/src/auth/repository.ts`
- `apps/api/src/auth/step-up-service.ts`
- `docs/07-planning/security-reviews/query-ownership-operation-proof-580.md`

I inspected the incoming diff's location and relevant purpose; this confirmation does not independently reaudit #814's operation-proof implementation or replace its accepted reviews. No approval source is changed by that merge. Current `git diff --check e848f3bd..HEAD` passed and final inspected head/status were the exact reviewed SHA and clean.

## Retained exact-head runtime evidence

I read `812-5f21e4-focused-pg-success-receipt.json` and `query812-runtime-5f21e4/{candidate-check.txt,vitest-invocation.txt,vitest-result.json,docker-inventory-final-diff.json}` plus the raw log footer. Candidate check binds clean5f21 source and eight verified paths. The selected PostgreSQL integration invocation covers project reach, approval repository, tenant checks, feature flag, both timezone wrappers, gate semantics and lifecycle. The wrapper reports start2026-10-17T04:02:22.960493UTC/end04:03:03.833175UTC,40.872seconds, no timeout and native returncode0. The raw footer reports eight files and95 tests passed.

I independently hashed the200,496-byte raw `vitest.full.log`: SHA-256 `b8314d5fc6600a164f4bb255a43f6601f5f6ce06c651b38a6224aca755e5f76a`, matching the receipt. Saved inventory comparison reports23containers/109volumes/seven networks unchanged; I did not independently query Docker. The prior5548 adverse result stays adverse and source-bound; the new retained run supplies the passing evidence for these eight files on5f21 only.

## Actions and limits

Only read-only local Git, source/report/receipt reads, searches and a read-only Python tree/hash comparison were performed. Exploratory reads using incorrect identity/receipt paths and an unmatched policy glob failed and supplied no evidence; the correct paths were then inspected. No tests or reproduction, compiler/analyzer, install, typecheck, build, PostgreSQL execution or database mutation, Docker/container action, browser, CI/GitHub/ref action, source/shared-document edit, commit, push, merge or delegation was performed by me. This external report is the sole new file, created exclusively with `O_EXCL` and mode0600.

Existing disclosed impersonation, per-request revocation and single-use residuals remain at their prior scope; none is newly claimed solved. This security confirmation is not whole-CI approval, image build/boot acceptance, browser or integrated SIT proof, merge authorization, phase finalization, stage completion or mission closure. Required hosted checks must be green on their actual exact candidate; no gate is waived.

**Completed at:** 2026-10-17T04:09:19.424731+00:00


### Preserved report `query812-6c-customer-boundary-ordinary-a-luna.md`

# PR812 6c customer boundary — ordinary review A

**Requested model:** GPT-6 Luna. **Context:** fresh independent reviewer; fork mode none. **Independence:** did not author, direct, or remediate the candidate.

**Reviewed head:** `6c032badc5abcc911c9fd5dda6396b12aeac4330`
**Base:** `78c3b49efa500022be04e337c0164b3128d0eb74`
**Verdict:** APPROVE — no blocking or non-blocking findings in the reviewed delta.

## Scope and checks performed

Inspected the exact four-path diff and the complete approval-scope helper plus its relevant repository callers: `lockLiveWorkItem`, `lockApproval`, `insertApprovalForRequest`, decision/withdrawal updates, approval target lookups, `listApprovalRows`, and transition-gate approval reads. Read the author report, CP-16 in the customer portal spec, the RBAC private-item reach rule, and `currentProjectReachPredicate`. Static inspection only; no tests, analyzer, install, typecheck, build, Docker, browser, GitHub/CI actions, or edits were performed.

The changed predicate returns SQL true for `side === "staff"` only at the requester/participant visibility component. Its parent `requestWorkItemScope` still conjuncts current project reach, deleted/archived item checks, and deleted-project check. Its callers retain workspace/id anchors where the row is approval-scoped; key lookup retains the unique item key and project join. The current project reach predicate admits staff by current canonical instance-admin, direct project membership, or workspace `sees_all` facts and does not grant customer reach. Route capability checks remain outside this helper. No changed code trusts request-supplied identity side or alters identity resolution.

Customer coverage retains a real requester, explicitly added participant, and same-organisation colleague: requester and participant can read a private request; the colleague receives 404. The newly added positive staff API case has no staff participant and exercises listing plus creation, while asserting a pending approval continues to block the AP-15 transition. The reach fixture removes artificial staff participants; its denied-path valid body exercises out-of-reach 404, reachable-but-incapable 403, and no writes.

## Limits

This is a focused ordinary review of the new customer/staff boundary delta, not a fresh audit of all 18 paths or a substitute for the required independent GPT-6 Sol security review. Runtime behavior and test results were not independently verified in this reviewer context.


### Preserved report `query812-6c-customer-boundary-ordinary-b-luna.md`

# PR812 customer-boundary repair — independent ordinary review B

- **Candidate:** `6c032badc5abcc911c9fd5dda6396b12aeac4330`
- **Parent:** `78c3b49efa500022be04e337c0164b3128d0eb74`
- **Reviewer:** GPT-6 Luna, fresh independent context; did not author, direct, or remediate the candidate.
- **Scope checked:** exact four-path delta in `apps/api/src/approval/repository.ts`, `tests/api-integration/approval-repository.test.ts`, `tests/api-integration/helpers/reach-world.ts`, and `tests/api-integration/work-item-project-reach.test.ts`; read the approval and CP-16/RBAC contracts and author report as context.
- **Verdict:** Changes requested. Root-owned focused PostgreSQL integration run on this exact SHA found three failures, including a production behavior defect in the candidate path. I inspected the relevant source and failure sites; I did not run tests.

## Findings

**P1 — staff private-item API reads and requests still fail the in-memory reach check.** The SQL predicate change allows a reachable staff identity to load a private work item, but both `loadApprovalTargetByKey` (`repository.ts:613-622`) and `loadApprovalTargetByApprovalId` (`:760-769`) still populate `reachFacts.visibleToPersonIds` from the customer requester and participants for every identity. `hasWorkItemReach` delegates to `reaches`, which rejects any identity not present in that list before checking its project reach (`packages/permissions/src/evaluator.ts:353-363`). For a staff member with valid current project reach who is neither the customer requester nor a participant, the route therefore still returns 404 after the target loads. This blocks the intended staff approval list/create behavior on private customer requests and also affects other approval paths that call `hasWorkItemReach` for that target. The candidate's exact-head PostgreSQL run reproduced it: new list case fails expected 200/actual 404, the staff reach expectation fails (`approval-repository.test.ts:177`), and the existing reader capability case receives 404 instead of 403 (`work-item-project-reach.test.ts:163`). Keep CP-16 private filtering for customer identities while constructing the target's reach facts, and preserve project reach for all identities.

**P2 — restore the exact generic-lookup denial assertion after project reach is removed.** In the prior test at the parent SHA, after deleting the approver's request-participant row, the test asserted that `loadApprovalTargetByKey(currentApprover, tenant.key)` returns 404. The candidate removes that assertion. The replacement checks `hasWorkItemReach(...) === false` only after fetching the approval through `loadApprovalTargetByApprovalId`, whose query intentionally permits the named approver to load their own approval metadata after reach loss. It therefore does not prove that the ordinary work-item-key path still applies `currentProjectReachPredicate` after staff private-item filtering was bypassed.

The new implementation is correctly structured on inspection: `requestWorkItemScope` still conjuncts `currentProjectReachPredicate`, visibility, and deleted/archive checks; only private visibility returns true for staff. Still, the removed test was a meaningful guard against moving the staff bypass outward and accidentally bypassing project reach too. Restore the 404 assertion after deleting membership (and before the own-approval metadata lookup) to retain this specific invariant.

Evidence: prior assertion at parent `tests/api-integration/approval-repository.test.ts:135-137`; candidate sequence at `:194-208`; changed helper at `apps/api/src/approval/repository.ts:30-69`.

## Other security checks by inspection

- The SQL staff-only bypass is narrow to `identity.side === "staff"`; current project reach, tenant/workspace linkage, soft-delete/archive predicates, and capability checks remain conjunctive. Customer SQL visibility remains requester-or-participant-only.
- The new integration case uses a real private customer request and no staff participant; it intends to check staff list/create and confirms the AP-15 transition remains blocked both before and after a pending request. It does not claim an approved transition.
- Reach/capability no-write and customer colleague-denial cases remain represented in the changed tests. The reach-world adjustment supplies an actual transition identifier to make handler-level denial cases valid; its normal empty-body case remains for schema validation.

## Verification limits

- Read-only source and diff review only; `git diff --check` passed. Root ran the focused PostgreSQL suite; I inspected its reported three failing assertions and the source paths they exercise, without rerunning it.
- No compiler/analyzer, install, typecheck, build, container, Docker, browser, PR, CI, or ref mutation performed.
- This is an ordinary review of the bounded four-path delta. It is not the required independent GPT-6 Sol security review, exact-head runtime evidence, or final merge approval.


### Preserved report `query812-814b-customer-boundary-ordinary-a-luna.md`

# PR812 current-head customer boundary — ordinary confirmation A

**Requested model:** GPT-6 Luna. **Reviewer context:** same fresh independent context as the earlier 6c review, reused for this bounded exact-head follow-up; no author/fixer role and no material authorship, direction, or remediation.

**Reviewed head:** `814b2391b946662c46848918320a53cfcda34295`
**Parent:** `6c032badc5abcc911c9fd5dda6396b12aeac4330`
**Verdict:** APPROVE the bounded repair by static inspection; exact-head PostgreSQL result remains pending the orchestrator run.

## Scope and checks actually performed

Compared the exact two-path follow-up to 6c and the net repair to `78c3b49efa500022be04e337c0164b3128d0eb74`; read ordinary review B, the 6c author/fixer report, and the current author report. Traced both target constructors (`loadApprovalTargetByKey`, `loadApprovalTargetByApprovalId`) through `hasWorkItemReach` to `reaches`, inspected all current approval call sites, and rechecked the composing SQL scope and `currentProjectReachPredicate`. Inspected the staff-positive/private-customer test, customer requester/participant/colleague cases, lost-reach test, and the reach/capability/no-write case. No tests, analyzers, build, typecheck, database, CI, browser, or ref mutations were performed in this reviewer context.

## Review of prior adverse result and fixes

My prior 6c approval missed a real defect: although SQL let reachable staff load a private item, both target constructors still populated CP-16 `visibleToPersonIds` for staff. `reaches` applies that list before its staff project-reach branches, so a non-requester/non-participant staff member failed the in-memory check. The 814 diff conditions that private-person list on `identity.side === "customer"` in both constructors. Customer private visibility remains requester/participant constrained; staff reach now follows the project facts and current reach. The second prior finding is also closed: after deleting project membership, the test again asserts generic key lookup returns 404 before it separately checks own-approval metadata after reach loss.

The staff SQL bypass is still local to `requestWorkItemVisibility` and remains conjuncted by `requestWorkItemScope` with `currentProjectReachPredicate`, deleted/archived item checks, and deleted-project check. Approval joins retain the `(work_item_id, workspace_id)` relationship and relevant queries constrain workspace IDs. The change does not alter `ResolvedIdentity`, accept a side from input, or change route capability checks. Staff positive coverage has no staff participant, calls list and create, and confirms AP-15 remains blocked with a pending approval. Customer denial and out-of-reach/insufficient-capability no-write cases remain represented.

## Runtime evidence and limits

The reported exact-6c focused PostgreSQL result was 6 files / 79 tests / 76 passed / 3 failed; ordinary review B inspected the three failure sites. The orchestrator reported a new focused PG run on 814 is running; no result was available to this reviewer while writing this report, so no exact-head pass is claimed. This is a bounded ordinary confirmation of the 814 customer-boundary repair, not a fresh audit of the full 18-path scope and not the required independent GPT-6 Sol review.


### Preserved report `query812-814b-customer-boundary-ordinary-b-luna.md`

# PR812 reach-facts repair — ordinary review B, exact head 814b

- **Candidate:** `814b2391b946662c46848918320a53cfcda34295`
- **Previous reviewed head:** `6c032badc5abcc911c9fd5dda6396b12aeac4330`
- **Reviewer:** GPT-6 Luna, independent of author and fixer. This continues the same independent review context; it is not a newly spawned reviewer.
- **Scope:** the exact two-path delta and its connected authorization flow in the four-path PR812 change; inspected `requestWorkItemVisibility`, both target builders, `hasWorkItemReach`/`reaches`, approval list/create and ID-based callers, and the restored membership-loss test.
- **Verdict:** The prior P1 and P2 findings are closed by this delta. No new blocking finding from source review.

## Findings disposition

- **Prior P1 closed:** Both target builders now set `visibleToPersonIds` only when the identity is a customer and the work item is private. Consequently the shared `reaches()` check applies CP-16 requester/participant visibility to customers while staff reach continues through the project reach facts. The SQL `requestWorkItemVisibility` staff bypass is still confined to that predicate; `requestWorkItemScope` continues to conjunct it with `currentProjectReachPredicate` and the live/deleted/archive filters. Staff list/create handlers still call `hasWorkItemReach` before their capability and service operations, so the fix does not skip the shared reach check.
- **Prior P2 closed:** The test again asserts generic key lookup returns 404 after deleting the staff approver's project membership, before it loads the approver's own approval metadata. It also verifies that the metadata lookup remains available while `hasWorkItemReach` is false.
- **Customer boundary retained:** Customer identities still receive the requester/participant ID list from both target builders. The SQL target lookup retains the matching private requester/participant predicate, and current project/customer-organisation reach remains required. This preserves same-organisation colleague 404 behavior, including private items without a requester.
- **Tenant and authority checks retained:** Staff current project reach remains in SQL and is rechecked through target reach facts. Route capability checks, key capability ceilings, and approval requester/approver-specific metadata branches are outside this delta and remain in their existing paths.

## Checks and limits

- `git diff --check` passed for the `6c032bad..814b239` delta.
- No test, compiler/analyzer, install, typecheck, build, PostgreSQL, container, Docker, browser, PR/CI, or ref mutation was performed. Root's exact-head PostgreSQL run was reported as still running when this review was assigned; its result is not claimed here.
- This review closes the prior ordinary B findings for the current two-path delta. It is not the required independent GPT-6 Sol review, runtime evidence, or merge approval.


### Preserved report `query812-814b-existing-revocation-fixture-assessment-luna.md`

# PR812 814b review follow-up — existing staff reach-loss fixtures

- **Candidate assessed:** `814b2391b946662c46848918320a53cfcda34295`
- **Reviewer:** GPT-6 Luna, the same independent ordinary B context; this is a bounded follow-up, not a new review clearance.
- **Evidence:** Root reports the exact-head focused PostgreSQL run produced 78/79 passing assertions plus one native failure. The failed existing `approval-tenant-checks.test.ts` check 6 returned 200 where its assertion expects 403. I inspected that fixture and the connected approval fixture/search results; I did not run the suite.
- **Disposition:** The failing assertion is a valid reach-revocation invariant, but its current fixture does not revoke staff project reach. Keep the 403/pending oracle and repair the fixture to remove the real project membership. Do not treat the current suite as green or clear this candidate based on the old assertion alone.

## Assessment

In `approval-tenant-checks.test.ts:261-272`, the comment says “Lost membership/reach,” but the fixture only changes `work_item.customer_visibility` from `organisation` to `private`, decides, then changes it back. The approver created by `buildTenant` is a staff member with a project-scoped `membershipTable` grant (`approval-fixtures.ts` around 235-251). Under CP-16, requester/participant visibility is the customer-side boundary. A staff member who keeps current project reach remains entitled to the private request, so the new 200 is consistent with the intended contract. The fixture must revoke and then restore the approver's actual project membership/role (or otherwise remove every current reach path), while preserving the existing expected 403 and pending approval state. Restore reach before the later expiry/concurrency assertions.

The same mechanism appears in at least two further approval fixtures and needs a whole-approval audit before any substitute assertions are accepted:

- `approval-gate-semantics.test.ts:171-186` makes the item private and says the CAB approver “cannot see this private item”; `buildTenant` gives that staff approver current project reach. If the test intends an out-of-reach approver, remove the actual project reach while preserving CAB membership and capabilities, then keep the expected request refusal/no-row result.
- `approval-lifecycle.test.ts:433-466` removes the staff approver's request-participant row from a private item and expects `approverReachLost` plus a 403. That row removal no longer revokes staff project reach. Revoke actual project membership there too, keep the reach-lost/list/403 assertions, and restore membership before the test's later re-add/decision path as required by its scenario.

A repository-wide search of approval integration tests found these as the other explicit private/reach cases, plus `approval-repository.test.ts` where private customer requester/participant access is intentional. That makes these the concrete known scope for the repair; the whole audit should search all `tests/api-integration/approval-*.test.ts`, `tests/api-integration/helpers/approval-fixtures.ts`, and approval-related repository tests for mutations of `customerVisibility`, request-participant changes, and comments describing staff reach loss. Keep customer-side CP-16 tests that are truly about customer requester/participant scope unchanged. For every staff reach denial or loss case, assert against the canonical project/workspace reach grant, not customer privacy or participant rows.

The SQL staff bypass remains correctly conjoined with `currentProjectReachPredicate`, and the two post-query reach-facts sites correctly omit customer-private IDs for staff. This review follow-up does not identify a new production defect in 814b; it identifies stale tests whose oracle encoded customer privacy as staff reach. The exact-head runtime run remains red until the fixture set and focused suite are repaired and re-run.

## Limits

- Read-only inspection and `rg` across approval integration fixtures; no source or test edits and no tests rerun.
- The previously delivered ordinary B report for 814b is preserved. This follow-up does not replace independent GPT-6 Sol security review, runtime evidence, or merge approval.


### Preserved report `query812-admin-reach-fixture-repair-author-luna.md`

# PR812 admin reach fixture repair — author report

- Candidate commit: `8de39e83` (the exact SHA is the current branch HEAD recorded alongside this report).
- Branch: `codex/query789-current-main-luna`; no push performed.
- Changed file: `tests/api-integration/approval-lifecycle.test.ts` only. Application source is unchanged.

## Repair

The lifecycle test had treated a global instance admin as out of reach merely because the admin had no membership in the target workspace. Canonical identity resolution grants global reach to a current instance admin, while the ordinary requester withdrawal route still requires the requester's capability/relation. The test now expects 403 on those ordinary routes and checks that the request remains pending with unchanged withdrawal event and audit counts. The key without `approval:request` is also expected to fail 403. The scoped API key remains denied with 403 on the session-only `/api/admin` route; the session admin remains allowed on that dedicated route.

The test now creates a non-instance-admin in a separate workspace and verifies that both their session and scoped API key receive 404 for a target approval outside their reach. It checks pending state and unchanged withdrawal event/audit counts after those denials.

## Verification and limits

- `git diff --check`: passed.
- Commit pre-commit formatting hook: passed (`Checked 1 file; no fixes applied`). The first commit attempt identified formatting; it was corrected before the successful commit.
- Tests, database integration, analyzers, typecheck, build, browser: not run, per delegated scope; root owns integration verification.
- No claims of independent review or test-suite success.

Exact candidate SHA: `8de39e83e7bb9b3a1e3bb76946240866a0f6eedc`.


### Preserved report `query812-cross-identity-audience-structural-repair-author-luna.md`

# PR812 cross-identity audience repair — author report

**Role:** Author / fixer (not eligible to review or approve this change)
**Branch:** `codex/query789-current-main-luna`
**Starting head:** `e829205e7c212e7fcaecceed0e0365816b14d847`
**Structural fix commit:** `6ce634a60c2c38c962f9c897db0304787b1a9c74`
**Regression assertion follow-up:** `5548dfde601fdbaf6ac614316eb8a3c3b26220f2`
**Final source head:** `5548dfde601fdbaf6ac614316eb8a3c3b26220f2`
**Commit identity:** `Codex (GPT-6 Luna) <agent@taskdesk.local>` (task-local identity matching repository history)

## Structural invariant and consumer audit

The two `ApprovalTarget` loaders (`loadApprovalTargetByKey` and `loadApprovalTargetByApprovalId`) now always retain persisted `visibleToPersonIds` for private work items, independent of the identity that loaded the target. The common `hasWorkItemReach(identity, target)` boundary applies customer audience facts only when evaluating a customer identity; staff reach remains governed by the already-conjoined current project/workspace authority facts. No target facts are mutated or projected differently for the loader.

Audited every approval `reachFacts` reference. The two loaders are the only constructors, and `hasWorkItemReach` is the only direct consumer. Its call sites are approval service create/decide/withdraw paths, approval index list/create/decide paths, and `formatApproval`'s named-approver status computation. Thus a staff-loaded target is evaluated against a proposed customer approver's actual customer identity and preserved requester/participant audience. The staff SQL exception remains in the private visibility component of the SQL scope, conjunctive with current project reach, workspace anchoring, and liveness predicates.

## Regression coverage

Extended `approval-repository.test.ts` to exercise the cross-identity vector end to end:

- Staff requests an approval for a same-organisation customer who is neither requester nor participant: 422, with approval rows, request outbox events, audit events and notifications unchanged.
- Staff requests approval for the actual customer participant: 200; staff sees the named approver as currently reachable.
- After removing that customer's participant row, both the staff approval list and the customer's own portal inbox report `approverReachLost: true`; the customer's decision is denied with 403 and the approval stays pending.
- Existing private requester and participant lookup, customer colleague denial, staff/private success, no-reach 404, AP-15 pending gate, and workspace/project/organisation-denial coverage remain in place.

The named approver's own addressed metadata remains visible through the existing inbox exception while current reach is reported accurately; that exception does not make the customer eligible for a new approval request or to decide after reach loss.

## Files

- `apps/api/src/approval/repository.ts`
- `tests/api-integration/approval-repository.test.ts`

## Checks and limits

- `git diff --check`: passed before commits.
- Normal pre-commit Biome hooks passed on the changed files; no fixes applied on successful commits.
- No tests, PostgreSQL, other analyzers, typecheck, install, build, container, database, or browser checks run, per assignment. Orchestrator owns exact-head verification.
- No push, CI dispatch, PR, merge, or history rewrite.
- The full independent Sol report on e829 remains unmodified and retained. The prior 814 run remains adverse (78/79); neither is evidence for this new head. This source requires fresh exact-head runtime verification and independent review.


### Preserved report `query812-customer-audience-reach-facts-repair-author-luna.md`

# PR812 customer-audience reach-facts repair — author report

**Role:** Author / fixer (not eligible to review or approve this change)
**Branch:** `codex/query789-current-main-luna`
**Starting head:** `6c032badc5abcc911c9fd5dda6396b12aeac4330`
**New commit:** `814b2391b946662c46848918320a53cfcda34295`
**Commit identity:** `Codex (GPT-6 Luna) <agent@taskdesk.local>` (task-local Git identity, matching existing repository commit history). The preceding `6c032bad` commit retained its existing Thomas author metadata; it was not rewritten.

## Change

Both approval target builders now add `visibleToPersonIds` only for customer identities on private work items. The existing staff-only SQL visibility bypass remains inside the existing conjunctive project-reach/liveness/tenant scope. Customer visibility facts continue to enforce requester/participant-only reach. Restored the generic work-item-key 404 assertion after staff project membership removal, while preserving the own-approval metadata path.

## Files

- `apps/api/src/approval/repository.ts`
- `tests/api-integration/approval-repository.test.ts`

## Checks and limits

- `git diff --check`: passed.
- Normal commit pre-hook ran Biome on the two changed files: passed, no fixes applied.
- No tests, PostgreSQL, other analyzers, typecheck, install, build, container, or browser checks run; orchestrator owns those.
- No push, PR, CI dispatch, merge, or history rewrite.

The orchestrator's focused PostgreSQL run on prior source `6c032bad` reported 6 files, 79 tests, 76 passed and 3 failed. This commit addresses the ordinary-review P1 reach-facts failure and P2 generic-lookup assertion gap; exact-head PostgreSQL verification and fresh independent ordinary/security reviews remain outstanding.


### Preserved report `query812-customer-audience-repair-author-luna.md`

# PR812 customer-audience repair — author report

**Role:** Author / fixer (not eligible to review or approve this change)
**Branch:** `codex/query789-current-main-luna`
**Base:** `78c3b49efa500022be04e337c0164b3128d0eb74`
**Committed source:** `6c032badc5abcc911c9fd5dda6396b12aeac4330`
**Starting source snapshot:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query812-source.dK3UNd` (directory mode 0700; files mode 0600)

## Change

`requestWorkItemVisibility` now applies the exact requester/participant private visibility rule only to customer identities. Staff approval reads and requests still require the existing current project reach predicate and retain tenant, liveness, capability, and approval semantics.

The integration fixture no longer adds staff as request participants to make the approval route pass. Its valid denied-path request now uses existing transition/person IDs and CAB-shaped data. Repository integration coverage uses actual customer-side requester, participant, and colleague fixtures; it verifies customer colleague 404, requester/participant access, reachable staff approval list/create on a private request without staff participation, and the existing AP-15 gated transition remains blocked before and after a pending request. Existing reach/capability/no-write and invalid-body cases are retained.

## Files

- `apps/api/src/approval/repository.ts`
- `tests/api-integration/helpers/reach-world.ts`
- `tests/api-integration/work-item-project-reach.test.ts`
- `tests/api-integration/approval-repository.test.ts`

## Checks and limits

- `git diff --check`: passed before commit.
- Normal commit pre-hook ran Biome on the four changed files; formatting passed on the successful attempt. It emitted three warnings for the existing `TASKDESK_STORAGE_FILESYSTEM_ROOT` / `TASKDESK_STORAGE_DRIVER` undeclared Turborepo environment entries in `work-item-project-reach.test.ts`.
- Integration tests, other analyzers, typecheck, install, build, database/container/browser checks: not run, per assignment; orchestrator owns verification.
- No push, PR, merge, or review claim.

## Coverage limits

The positive API case verifies staff list/read and approval creation and verifies AP-15 remains enforced with a pending approval. It does not exercise customer approval decision or an approved transition; existing approval lifecycle/gate suites own those behaviors. Exact-head real PostgreSQL verification and independent ordinary/security reviews remain outstanding.


### Preserved report `query812-e829-full-customer-boundary-security-61-sol.md`

# PR812 e829 — fresh full independent security review

**Reviewed head:** e829205e7c212e7fcaecceed0e0365816b14d847

**Comparison base:** `130508ef24f6442a59dbccaf305712891c8b3fbb` (accepted main supplied for this review).

**Role/context:** Fresh independent FULL security reviewer, `/root/query812_e829_full_customer_boundary_security_sol`. I did not author, direct, or remediate this candidate, and spawned no child agent. The conductor supplied the review packet and ordinary reports; their claims were checked against source, not treated as authority for my verdict.

**Requested model/dispatch provenance:** `gpt-6.1-sol`, `fork_turns=none`, `reasoning_effort=high`, as supplied by the conductor. These are requested routing attributes. An independently verifiable served-model/version/build fingerprint is unavailable in this context; I do not invent one or claim to have inspected the parent's actual spawn invocation.

**Method:** Read-only full security source review across the actual 20-path base-to-head scope, including the new customer/staff boundary and fixture repair. I inspected every changed path's actual diff and the current relevant implementation, fixtures, contracts and callees. This is not a claim to have reread every unchanged line of the large work-item router. No tests or runtime reproduction were executed by this reviewer.

## Verdict

**BLOCKED — one P1 security finding on the exact e829 source.**

The staff SQL visibility exception is correctly local to customer privacy and retains current project reach. However, the accompanying in-memory target projection is viewer-dependent and is subsequently reused to authorize a different person. That creates a private-customer audience bypass at approval creation and an incorrect reach-loss flag in staff views. This candidate must not be cleared on the basis of its ordinary fixture confirmations or older runtime results.

## P1 — a staff-loaded target loses the customer audience constraint before another customer's reach is checked

**Locations:** `apps/api/src/approval/repository.ts:613-627` and `:760-774`; cross-identity consumers `apps/api/src/approval/service.ts:113-118` and `apps/api/src/approval/index.ts:107-114`; pure reach evaluation `packages/permissions/src/evaluator.ts:353-378`.

Both target loaders now construct `reachFacts.visibleToPersonIds` only when the identity used to load the target is a customer. A staff loader therefore returns `visibleToPersonIds: null` even for a private request with a persisted requester and exact participant audience. `hasWorkItemReach` simply calls `reaches(identity, target.reachFacts)`; it does not recover the omitted audience from `target.isPrivate`, nor reload it for the evaluated identity.

Those facts are not used only for the loading identity:

1. `createApproval` loads the target using the requesting staff identity, then resolves the proposed approver and checks `hasWorkItemReach(approverIdentity, target)`. For a customer approver in the project's customer organisation who is neither the private request's requester nor a participant, the target has no visibility constraint, so `reaches` takes its organisation branch and returns true. The insertion later rechecks the requesting staff's SQL resource scope, not that customer's private audience. With otherwise valid references, feature configuration and permissions, source tracing therefore predicts that the request persists instead of the AP-3 422/no-row refusal. I did not execute this vector.
2. The resulting approval is addressed to that customer. The intentional own-addressed approval exception in `listApprovalsForPerson` and `loadApprovalTargetByApprovalId` preserves their approval metadata even without ordinary reach. `responseRow` includes the work-item key and title and approval context. Wrongly admitting that customer at creation can thus expose private request metadata to someone who never had CP-16 reach; the existing lost-reach metadata exception is not a grant to create such an approval in the first place.
3. `formatApproval` checks the named approver's current identity using the target loaded for the viewer. When a staff viewer lists a pending customer approval after that customer's participant row was removed, the staff projection still has a null audience. The same-org customer still appears in reach, so the staff response incorrectly reports `approverReachLost: false`. The customer's own view/decision loads a customer-scoped target and refuses the decision, making the staff flag inconsistent with the actual current boundary.

**Contract:** approvals AP-3 requires the proposed approver to have work-item reach and refuses an out-of-reach submission. CP-16 and RBAC's private-request rule constrain customers to the requester and explicit participants even inside their own organisation. The approvals edge-case table requires lost reach to be flagged from current canonical work-item reach. Staff may have their own normal project reach without being a customer participant; that fact cannot widen a different customer's audience.

**Structural invariant exposed by the counterexamples:** persisted requester/participant audience facts must remain available independently of who loaded a target. A reach decision for a person must use that person's side and current reach together with those actual audience facts. A staff projection cannot serve as proof that a different customer has private-request reach. This is a finding and acceptance invariant, not implementation authorship or a remediation patch.

**Coverage gap:** the added positive staff/private integration case explicitly adds its proposed customer approver as a participant, so it cannot catch the forbidden same-org nonparticipant case. The new direct customer colleague lookup test checks a target loaded by that same customer, which also misses cross-identity reuse. The e829 staff membership-revocation repairs exercise real staff reach but do not establish the customer audience invariant above.

**Finding status:** open and blocking. No additional distinct blocking or non-blocking security finding was identified in the remaining reviewed scope.

## Actual 20-path scope

Application paths (8):

- `apps/api/src/approval/evidence.ts`
- `apps/api/src/approval/index.ts`
- `apps/api/src/approval/reminder-scan.ts`
- `apps/api/src/approval/repository.ts`
- `apps/api/src/approval/service.ts`
- `apps/api/src/work-item/controllers/list-work-item-transitions.ts`
- `apps/api/src/work-item/controllers/transition-work-item.ts`
- `apps/api/src/work-item/index.ts`

Tests/helpers (11):

- `tests/api-integration/approval-closure-and-clock.test.ts`
- `tests/api-integration/approval-feature-flag.test.ts`
- `tests/api-integration/approval-gate-semantics.test.ts`
- `tests/api-integration/approval-lifecycle.test.ts`
- `tests/api-integration/approval-repository.test.ts`
- `tests/api-integration/approval-tenant-checks.test.ts`
- `tests/api-integration/helpers/approval-fixtures.ts`
- `tests/api-integration/helpers/approval-single-use-suite.ts`
- `tests/api-integration/helpers/reach-world.ts`
- `tests/api-integration/work-item-project-reach.test.ts`
- `tests/api-integration/work-item-transition.test.ts`

Historical publication path (1):

- `docs/07-planning/security-reviews/query-ownership-approvals-580.md`

The actual base-to-head stat was 20 files, 2,227 insertions and 296 deletions. The historical note does not exist in the accepted comparison base; it is an added path there, not an existing accepted-base note that I can claim has a preserved prefix. Its current bytes are exactly the earlier publication78c bytes, as checked below.

## Other security checks and prior finding dispositions

**Staff SQL and tenant/liveness boundaries.** `requestWorkItemVisibility` returns true for staff only inside the private-audience component. `requestWorkItemScope` still ANDs it with `currentProjectReachPredicate`, live/unarchived item and live project checks. Key lookup remains unique-key scoped; approval queries retain the work-item/workspace pair and project join. SQL resource predicates use current canonical memberships, workspace sees-all and current instance-admin evidence. Customer project organisation is read from the project, not the workspace attribution. Direct customer lookups still constrain private requester/participant scope, including null-requester items. Those correct checks do not repair the cross-identity finding.

**Approval metadata and action separation.** Exact named-approver/requester relations remain the intentional own-approval metadata exception. Generic work-item-key lookup still requires ordinary current project/customer reach. Decision and requester-withdrawal mutations do not use that metadata exception as authority: they retain normal reach, applicable capabilities, named approver/requester, pending/finality, no self-approval and rejection-note rules. The dedicated admin withdrawal exception remains session-only, opt-in, current-instance-admin-backed and separate from deciding. API keys and impersonation cannot obtain that session-only exception.

**Identity and capability flow.** Approval evidence/handlers and transition handlers pass authenticated key and impersonation facts to the shared canonical identity adapter. The adapter checks key owner/enabled facts and supplies the exact stored capability subset; `can` retains the owner authority intersection, project role override and missing-key-scope fail-closed behavior. No request body supplies identity side. No new route, policy kind, schema, capability, dependency or generalized grant appears in this diff.

**Transactions and workflow gate.** Extracted inserts/updates keep the provided transaction executor. Parent work-item locks precede approval locks/writes; conditional decision/withdrawal updates remain scope- and pending-bound. Denial precedes activity/audit/event work. Transition reads and locked reads keep current resource scope and the single-use counting clause; matching transition ID, approved state, CAB kind and any/all policy remain domain gate inputs. Pending closure affects the same workspace/item/transition, removes inbox rows only for returned closed IDs and audits closure in the same transaction. No approval metadata exception supplies a workflow gate pass. AP-15 remains enforced with no approval and a merely pending approval in the added staff case.

**Clocks and bounded scan.** The insert-select projection retains schema order, bound values, explicit null lifecycle fields, UTC database creation/default-expiry expressions and column-encoded explicit expiry. The scan retains lease, bounded batch/run size, pending selection, UTC wall-clock comparisons, approval-only SKIP LOCKED, and same-transaction state/outbox/audit work. The extracted helpers retain id/workspace/pending predicates and unchanged-row no-event behavior. I did not execute timezone, concurrency or reminder tests.

**e829 fixture repair.** I inspected the exact membership capture/delete/restore helpers and all three replaced scenarios. Capture filters exact person, project scope and project id, fails if missing, deletes only the selected row id and restores the complete same row. Their tested staff approvers hold the relevant direct project membership; unrelated CAB membership and roles are retained. The tenant scenario retains 403/pending and restores reach before expiry/concurrent decisions. Gate semantics retains 422/no approval rows. Lifecycle retains reach-lost/403 and restores membership before later success. These are legitimate staff authority revocation repairs; making a private customer item does not itself revoke staff project reach. They do not close P1.

## Retained evidence, actual checks and limits

I read AGENTS, the active mission, agent workflow/model/evidence rules, CLAUDE provider adapter, latest status and decision context, approvals AP rules/edge cases, CP-16, RBAC reach/private/customer/key boundaries, security model and query-ownership contracts. I read the current author, ordinary A/B and fixture-assessment reports for 6c,814 and e829, the original full f7fb security report, the accepted-main composition evidence and relevant historical note sections. Earlier reports retain their actual scope; this report does not relabel an original 15-path review or a bounded composition review as a current full review.

Read-only commands included `pwd`, `git status --short`, `git rev-parse HEAD`, actual base-to-head and78c-to-e829 diffs/stat, `rg`/`rg --files`, `cat`, `sed` and numbered source ranges. I read the canonical scope/identity/evaluator/executor/clock code and traced the affected route, service, target and workflow call sites. An exploratory schema-path lookup did not exist; it supplied no evidence. An initial attempted accepted-base note read failed because that note is absent there, then I correctly compared with its actual78c publication.

A read-only Python byte/hash check independently verified all19 artifacts in `812-accepted813-publication-proof.json`: every byte count/hash matched and every authentic report body was embedded unedited in the current note. Current note bytes143,870 and SHA-256 `5d30194d922f8b2ca1415a901d28cc0411369109ba9431f23ce84769aa8ce732` matched the proof and the exact78c publication. Hashes/embedding verify preservation, not reviewer independence by themselves.

I inspected the retained adverse receipts: exact6c reports6files/79tests,76passed/3failed, native exit1; exact814 reports6files/79tests,78passed/1failed, native exit1. The latter records the three earlier failures fixed and one stale staff-revocation fixture failure. Those are adverse results on their stated sources, not passes. The conductor confirmed that no exact-e829 PostgreSQL run had occurred when this report was completed. I therefore claim no e829 runtime result. In particular, the old78c full PostgreSQL223files/3,291tests/five tasks remains old78c evidence and is not current-e829 proof.

**No tests/reproductions, analyzer/compiler, typecheck, install, build, PostgreSQL, DB mutation, Docker/container action, browser, CI/GitHub/ref action, source/shared-document edit, commit, push, merge or delegation was performed by this reviewer.** The only new file is this external report, exclusively created using `O_EXCL` with mode0600. Final source inspection showed exact head e829 and empty short status. This verdict is not runtime/image/browser acceptance, current CI clearance, a gate waiver, merge permission, feature/stage completion, release/SIT acceptance or mission closure. Existing disclosed impersonation and per-request revocation/single-use residuals retain their prior scope; none is newly claimed solved.

**Completed at:** 2026-10-17T03:51:24.251454+00:00


### Preserved report `query812-e829-staff-revocation-ordinary-a-luna.md`

# PR812 e829 staff revocation fixture repair — ordinary confirmation A

**Requested model:** GPT-6 Luna. **Reviewer context:** reused independent context from the prior bounded reviews; not the author/fixer and did not materially author, direct, or remediate the candidate.

**Reviewed head:** `e829205e7c212e7fcaecceed0e0365816b14d847`
**Parent:** `814b2391b946662c46848918320a53cfcda34295`
**Verdict:** APPROVE the bounded fixture repair by static inspection. Exact-head runtime verification remains pending the orchestrator run.

## Checks performed

Read the e829 author report and prior 814b fixture assessment; inspected the exact four-path diff, the 814 adverse PG receipt, the membership fixture helper, and the three replaced approval test setups and their surrounding assertions. Confirmed the prior receipt reports 78/79 passed with one failure, and separately retains the three earlier 6c-specific failures as fixed on 814. No tests, analyzers, typecheck, build, DB, Docker, browser, CI, or source/ref changes were performed in this reviewer context.

`revokeProjectMembership` selects a membership by the exact person, `scope = project`, and project scope ID, fails if absent, deletes by that row ID, and returns the complete persisted row. `restoreProjectMembership` reinserts that same complete row. It does not delete or rewrite other project/workspace memberships, role rows, CAB team membership, or capabilities. The inspected fixtures create one direct project membership for the affected approver and do not create a workspace `membershipTable` `seesAll` grant, so removing the captured row removes the tested current project reach while retaining CAB membership/capability data.

All three scenarios preserve their intended denial or lifecycle checks: tenant check 6 keeps 403 and pending state, then restores reach before expiry and concurrent-decision checks; request-time reach keeps 422 and zero approval rows, restoring reach afterward; lifecycle reach-loss retains the private item/customer participant semantics and `approverReachLost`, 403, then restores the exact project row and participant before its later successful decision. No negative assertion was weakened or removed. The customer privacy fixtures are unchanged.

## Limits

The prior exact-814 receipt is adverse (one failure); it is not green evidence for 814, and no exact-e829 runtime result was available to this reviewer. This review covers only the four changed fixture/test paths, not a new full-source audit or the required GPT-6 Sol review.


### Preserved report `query812-e829-staff-revocation-ordinary-b-luna.md`

# PR812 staff revocation-fixture repair — ordinary review B

- **Candidate:** `e829205e7c212e7fcaecceed0e0365816b14d847`
- **Base for this bounded review:** `814b2391b946662c46848918320a53cfcda34295`
- **Reviewer:** GPT-6 Luna, same independent ordinary B context. The author did not author, direct, or remediate this review.
- **Scope:** exact four-file fixture delta; checked the helper's project-scope/person filters and exact-row deletion/restoration, plus each HTTP request/assertion sequence and the before/after project membership state.
- **Verdict:** No blocking finding in this fixture repair. It correctly preserves the 403/422, pending/no-write, reach-lost, expiry/concurrency, and later-success oracles while using actual canonical staff project reach revocation.

## Review notes

`revokeProjectMembership(personId, projectId)` selects only the matching `membershipTable` row with `scope = 'project'` and the exact project id, fails loudly if the fixture is missing that grant, deletes by the selected row id, and returns the full row. `restoreProjectMembership` reinserts that exact row, retaining its role id, `seesAll`, and other stored values. The helpers therefore remove the actual reach grant that `currentProjectReachPredicate` uses and restore it for subsequent test phases. The approval fixture's approver is an ordinary staff identity with this project membership; it has no instance-admin or owning-team alternate reach path in these scenarios.

The adjusted paths exercise real HTTP handlers with authenticated sessions:

- `approval-tenant-checks.test.ts` revokes the named approver's project membership, expects 403 and a still-pending approval, restores the membership, then runs the existing expiry and concurrent-decision checks.
- `approval-gate-semantics.test.ts` leaves the CAB role/team setup in place, revokes only the approver's project reach, and expects the existing 422 plus zero approval rows; it restores the membership afterward.
- `approval-lifecycle.test.ts` retains the private customer request and participant removal, adds actual project membership revocation for the loss phase, and retains `approverReachLost`, 403, and pending-state checks. It restores the exact membership and re-adds participation before the intended successful decision.

This resolves the stale-fixture concern identified in the previous follow-up. The exact-head runtime suite result was still pending at review time. The earlier 814b run (78/79 with one stale-fixture failure) remains adverse evidence for 814b; this report does not claim the new head passed runtime tests. The 814b application-code fixes remain unchanged.

## Checks and limits

- `git diff --check` passed on the four-file delta.
- Read-only diff and caller/fixture inspection only. No tests, analyzer/compiler, typecheck, install, build, PostgreSQL, container, Docker, browser, CI/PR, or ref mutation was performed.
- This is ordinary review B of the bounded fixture delta. It is not the required independent GPT-6 Sol security review, exact-head runtime evidence, or merge approval.


### Preserved report `query812-staff-revocation-fixture-structural-repair-author-luna.md`

# PR812 staff reach-loss fixture repair — author report

**Role:** Author / fixer (not eligible to review or approve this change)
**Branch:** `codex/query789-current-main-luna`
**Starting head:** `814b2391b946662c46848918320a53cfcda34295`
**New commit:** `e829205e7c212e7fcaecceed0e0365816b14d847`
**Commit identity:** `Codex (GPT-6 Luna) <agent@taskdesk.local>` (task-local Git identity matching existing repository history)

## Audit and mapped cases

Audited approval integration files and `helpers/approval-fixtures.ts` for private visibility changes, request-participant changes, membership changes, and staff reach-loss claims.

- `approval-tenant-checks.test.ts`, check 6: replaced the false “private visibility means lost membership” setup with actual revocation of the named approver's project membership. Kept 403 and pending-state assertions; restored the exact captured membership before expiry and concurrent-decision cases.
- `approval-gate-semantics.test.ts`, request-time approver-reach case: removed customer-private/participant manipulation and revoked the CAB approver's actual project membership. Kept the 422 and no-approval-row assertions; restored the captured membership.
- `approval-lifecycle.test.ts`, reach-lost approver flow: retained its private item, participant removal, `approverReachLost`, 403, and later successful-decision assertions; additionally revoked canonical project membership for the negative phase and restored that exact row before re-adding participation and deciding.
- `approval-repository.test.ts`: confirmed its CP-16 denials use actual customer identities; its staff no-reach case already deletes the actual project membership and retains generic key 404 plus own-approval metadata behavior.
- Remaining approval fixture search hits set visibility to `organisation` as setup/reset, or keep customer requester/participant behavior; no further stale staff-private-as-revocation case was identified.

Added `revokeProjectMembership` / `restoreProjectMembership` helpers that capture and restore the exact existing project membership row. No permission model or product behavior changed in this batch.

## Files

- `tests/api-integration/helpers/approval-fixtures.ts`
- `tests/api-integration/approval-tenant-checks.test.ts`
- `tests/api-integration/approval-gate-semantics.test.ts`
- `tests/api-integration/approval-lifecycle.test.ts`

## Checks and limits

- `git diff --check`: passed.
- Normal commit pre-hook Biome check on all four changed files: passed, no fixes applied.
- No tests, PostgreSQL, other analyzers, typecheck, install, build, container or browser checks run; the orchestrator owns runtime verification.
- No push, CI dispatch, PR, merge, or history rewrite.

Root's focused PostgreSQL evidence on prior `814b2391` was 6 files / 79 tests, 78 passed and one failed. The suite must be rerun on this exact new head. Existing customer privacy, approval pending, expiry, concurrent-winner, no-write and own-metadata oracles are retained; no assertion was weakened or removed.


## Current exact source binding

Each preserved report retains its actual source, provenance and scope. Current5f21 application source is frozen; this publication appends only its own regular100644 review note. Full hosted/image and final-body checks remain mandatory.

**Reviewed head:** `5f21e468818d7d171eaf0cce50edb9bdb3354c5b`
