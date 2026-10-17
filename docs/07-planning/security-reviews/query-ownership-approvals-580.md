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
