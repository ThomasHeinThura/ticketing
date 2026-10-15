# #580 notification/query composition — authentic incomplete review record

**Reviewed head:** `e3df4d7f77c4ab6907016244f5f804f045e70a39`

THIS CANDIDATE IS NOT CLEARED FOR MERGE. Current independent ordinary A/B deltas clear the native inbox and transactional instance-alert source repairs. Fresh whole-composition ordinary C finds no additional source defect but records CHANGES REQUIRED for the missing #780 decision provenance/composition order. #764 and the #780 decision held in carrier #791 must reach accepted main before acceptance. Current full Sol security review is PENDING after ordinary/dependency clearance; the Sol design advice below is explicitly not security approval. The earlier preference-only full Sol pass is limited to that two-file source, not the later native authority repair.

The conductor explicitly dispatched ordinary/author contexts as GPT-6 Luna and security/design contexts as GPT-6 Sol; reports retain their actual runtime introspection limits and original labels. Original source/adverse findings, original B approval, separate adjudication, design and successive repairs remain unchanged. The comment notification disclosure predates this extraction on accepted main; approval notifications already had the current-reach predicate. Native work-item/comment rows now use canonical identity, reach and capability checks inside repeatable-read operations before pagination/mutation. All four inbox operations derive current instance-admin authority in that same snapshot, with actual key clamping and own-recipient binding. No held producer or outbound delivery is activated.

API typecheck, Biome and diff checks pass; existing five warnings remain attributed. New real PostgreSQL regressions are authored but UNRUN locally because Docker is unavailable pending owner authorization. Publishing this honest draft permits hosted validation, not merge or release. No image/SIT/recovery/phase/#580 completion is claimed. The whole batch preserves the original audit append, scheduler/workflow and preference query-ownership scope, including accepted-main controls; missing decision provenance remains an explicit blocker.

---

Retained evidence file — 580-notification-preferences-service-luna.md

# #580 notification-preferences service query extraction

Status: bounded source conversion committed; unpushed, pending conductor review and dependency composition.

- Worktree: `/Users/heinthura/.codex/worktrees/query-ownership-580-notification-preferences`
- Branch: `codex/query-ownership-580-notification-preferences`
- Exact head: `d91c66d39ccf9e4b5272ed61135305c676bcea70`
- Base: `629cb54f8f68293de58bc7b98a5e408a9f679427`, the explicit composition of reviewed contract head `0627093df3ef9a7cf6784d242642a22cf887a077` and accepted-main head `e9df2294fa580fd2885343bbef0cec28e81ead4c`. This branch does not include the separate outbox-extraction commit.
- Changed files only: `apps/api/src/notification-preferences/service.ts` and new `apps/api/src/notification-preferences/repository.ts`.

The service previously had 17 statement-construction sites (including `db.query.*.findFirst`). Those are now repository-owned, with explicit user/workspace/project inputs retained. The repository preserves predicates, joins, selected columns, ordering, row shapes, and query order. The reach SQL fragment is still supplied by the existing `reachableWorkspacePredicate` helper, now composed inside the repository; the helper in `utils/workspace-access-middleware.ts` remains a separate unconverted #580 residual and was not edited.

No changes were made to delivery, secrets, schema, policy, routes, response mapping, tests, provider activation, or feature behavior. Service validation, encryption/decryption, masking, URL/destination checks, defaults, and returned DTO construction remain in the service. The workspace-project replacement sequence remains awaited delete followed by awaited conditional insert. All these operations continue to use the shared `db`; inspection found no transaction handle in this service path, so none was invented.

Validation at this source:

- `pnpm install --frozen-lockfile --offline` — passed; 1,244 packages reused from cache, no downloads.
- Built declared API workspace prerequisites: `pnpm --filter @taskdesk/domain build`, `pnpm --filter @taskdesk/permissions build`, and `pnpm --filter @taskdesk/email build` — each passed.
- `pnpm --filter @taskdesk/api typecheck` — completed without diagnostics across configured TypeScript projects.
- `pnpm exec biome check apps/api/src/notification-preferences/service.ts apps/api/src/notification-preferences/repository.ts` — passed.
- `git diff --check` — passed.
- Targeted actual analyzer run from the separate checker worktree over these two files returned `violations: []`.

Test coverage/limits: `tests/api/notification/preferences.test.ts` covers a different `notification/preferences` module and is not evidence for this service. `tests/api-integration/notification-workspace-reach.test.ts` calls this service and covers reachable workspace-rule reads; `tests/api-integration/permissions-shadow-mode.test.ts` also calls its GET path. No direct service unit test for preference/workspace-rule writes was found. I did not add a mirror test for literal query relocation and did not run the PG-dependent tests. Docker/PostgreSQL integration remains blocked by the conductor's Docker-daemon constraint and is not claimed as passed. No integration/runtime test, browser, push, or PR was run.

Merge dependency: the #764 candidate still requires accepted decision provenance; the #780 decision remains in unaccepted carrier #791 according to `docs/07-planning/security-reviews/764-query-ownership.md`. This conversion cannot merge independently before that composition and required candidate review. The outstanding workspace predicate helper also means this is not a complete #580 conversion or checker activation.

---

Retained evidence file — 580-notification-preferences-ordinary-a-luna.md

# #580 notification-preferences service conversion — ordinary review A

**Reviewer:** GPT-6 (fresh independent ordinary-review context)
**Reviewed head:** `d91c66d39ccf9e4b5272ed61135305c676bcea70`
**Comparison base:** `629cb54f8f68293de58bc7b98a5e408a9f679427`
**Scope:** `apps/api/src/notification-preferences/service.ts` and new `apps/api/src/notification-preferences/repository.ts`; bounded query relocation only.
**Independence:** I did not author, direct, or remediate this candidate.

## Verdict

**CLEAR for this bounded source conversion.** I found no behavior-changing query relocation defect. This is not whole-path #580 completion or merge acceptance; the reachable-workspace predicate helper remains a separately assigned residual, and candidate dependencies and remaining gates still apply.

## What I checked

- Read the repository operating workflow, notification feature specification (`NO-1` through `NO-4` and preference behavior), and current #580 decision/status context.
- Compared the complete two-file delta against its stated base and traced every moved statement back to the service.
- Checked user/workspace/project predicates, joins, selected columns, ordering, operation order, and returned row shapes. The membership lookup retains both user and workspace predicates and `limit(1)`; project selection remains workspace-bound; preference and rule lookups remain user-scoped; reachable rules retain user scoping, workspace join, shared reach predicate, and ascending `createdAt`; selected project rows remain keyed by rule id.
- Checked defaults and DTO construction, decryption/masking/redaction, and service-side validation remain in the service. The returned `createdRule?.id` remains optional and is handled by the same existing missing-id error path.
- Checked workspace-project replacement remains an awaited delete followed by an awaited conditional insert. No transaction was added; the author report says this path has no transaction handle, and the conversion keeps the existing shared `db` execution boundary.
- Ran `git diff --check` against the two-file candidate delta: passed. I did not run tests or PostgreSQL/browser verification in this review context.

## Findings

No blocking or non-blocking findings in the reviewed scope.

## Residuals and limits

`reachableWorkspacePredicate` is still imported into the new repository from `utils/workspace-access-middleware.ts`; that helper was explicitly outside this two-file conversion and remains a separate #580 residual. The source conversion does not establish complete query ownership, gate activation, Docker/PostgreSQL integration, browser behavior, dependency composition, or acceptance of the larger #580 work. Author-reported typecheck, formatting, and analyzer results were treated as report data, not independently rerun evidence.

---

Retained evidence file — 580-notification-preferences-ordinary-b-luna.md

# Independent ordinary review B — notification-preferences repository extraction

**Verdict: CLEAR, with the shared reach-predicate helper retained as a separate residual.** I found no blocking or non-blocking defect in the reviewed source delta.

**Reviewed head:** `d91c66d39ccf9e4b5272ed61135305c676bcea70`  
**Comparison base:** `629cb54f8f68293de58bc7b98a5e408a9f679427`  
**Independence:** Fresh reviewer context; did not author, direct, or remediate the change.  
**Model:** GPT-6 (the platform did not expose a Luna/Sol variant).  
**Scope:** `apps/api/src/notification-preferences/service.ts` and new `apps/api/src/notification-preferences/repository.ts`; notification preference reads/writes, query predicates and joins, result ordering and shapes, replacement-write order, secret handling, SSRF validation, and error behavior.

## What I checked

- Compared the full service diff against the base and inspected every repository query. The extracted statements retain the original filters, selected fields, joins, return shapes, and ordering. In particular, reachable workspace rules still use the same `reachableWorkspacePredicate`, user filter, inner join to workspace, and `createdAt` ordering. The selected-project lookup is still gated on nonempty rule results before its `inArray` query.
- Traced the service's awaited operation order. Workspace rule replacement still validates first, reads the prior rule, inserts or updates the rule, awaits deletion of prior project rows, conditionally awaits insertion of selected project rows, and then rereads preferences. Global preference writes still persist before applying the existing active-rule channel cascade and rereading.
- Confirmed query extraction introduces no transaction, changes no route or authority boundary, and leaves response mapping and validation in the service. Existing encryption/decryption, omission-preserving secret inputs, stored ciphertext reuse when a secret is omitted, token masking, URL parsing, public-destination checks, and HTTP error status/messages are unchanged in the diff.
- Kept the `reachableWorkspacePredicate` implementation itself out of this verdict: it remains an unmodified shared helper and a separate #580 residual. `delivery.ts` is also unchanged; the existing #785 work remains outside this review.

## Evidence

- `pnpm --filter @taskdesk/api typecheck` — passed across all configured API TypeScript projects, no diagnostics.
- `git diff --check 629cb54f8f68293de58bc7b98a5e408a9f679427..d91c66d39ccf9e4b5272ed61135305c676bcea70` — passed.
- Source and test inventory inspection found `tests/api-integration/notification-workspace-reach.test.ts` and `tests/api-integration/permissions-shadow-mode.test.ts` exercise the service read path. No direct service unit test for preference/workspace-rule writes was found. I did not run PostgreSQL integration because the Docker daemon is unavailable; no runtime, browser, or acceptance claim is made.

## Findings and residuals

- **Blocking findings:** none.
- **Non-blocking findings:** none in the reviewed delta.
- **Separate residual:** the shared `reachableWorkspacePredicate` helper remains unconverted under #580 and was not modified by this candidate. This review does not claim #580 complete or acceptance, and does not clear held contracts #764/#780.

---

Retained evidence file — 580-notification-preferences-security-sol.md

# #580 notification-preferences service extraction — independent security review

**Verdict: CLEAR for the bounded two-file source delta.** No blocking or non-blocking security finding in this candidate. This does not accept the whole #580 path, the held #764/#780 contracts, or a merge.

- **Candidate:** `d91c66d39ccf9e4b5272ed61135305c676bcea70` (verified `HEAD` before and after review)
- **Comparison base:** `629cb54f8f68293de58bc7b98a5e408a9f679427`
- **Changed paths:** `apps/api/src/notification-preferences/service.ts`; new `apps/api/src/notification-preferences/repository.ts`
- **Review class:** full security review requested for the candidate, following two fresh independent ordinary reviews that report CLEAR at this exact head.
- **Independence:** fresh reviewer context; I did not author, direct, or remediate this candidate. The dispatch requested GPT-6 Sol. This environment identifies me as GPT-6 but exposes no introspection of the Sol/Luna variant, so I cannot independently attest the exact deployed model variant.

## Security assessment

I read the repository operating guides, notification specification and decision/status context, the full two-file diff, the service and repository at the candidate head, the unchanged route, schema, secret and outbound-destination helpers, and the two ordinary reports. I traced all 17 moved statement-construction sites through the service calls.

- **Self/workspace/project boundaries:** the route still supplies the session `userId`; the preference reads and update filter remain keyed by that user. Workspace-rule find and membership retain both `userId` and `workspaceId`. Project selection remains confined to the requested workspace. Reachable rule listing retains the user predicate, workspace inner join, shared reachable-workspace predicate, and `createdAt` ordering. The subsequent selected-project query is limited to IDs of those returned rules and is still skipped for an empty rule set. The response mapping still emits only these reachable rules and their selected project IDs.
- **Writes and ordering:** global preference update/insert still precedes the same active-rule cascade and final reread. Workspace upsert still validates membership and project IDs, checks the global channel prerequisites, finds the self-owned rule, then updates/inserts it, awaits deletion of its selected-project rows, conditionally awaits insertion of replacements, and rereads. Delete still checks membership, finds the self-owned rule, deletes that ID, and rereads. The ID-only repository update/delete helpers are called only after those user/workspace checks in this unchanged service path. All operations use the same imported `db`; no transaction or altered failure/partial-write behavior was introduced.
- **Secrets and destinations:** the service still decrypts existing ciphertext for use, preserves stored ciphertext when secret input is omitted, encrypts supplied secrets before persistence, and returns only configured flags and masked previews. The repository adds no logging or response serialization of secret columns. The existing `new URL` and `assertPublicWebhookDestination` calls remain before any ntfy, Gotify, or webhook configuration write under the same validation conditions. The SSRF helper and delivery-time checks were not changed by this candidate; this review does not attest their overall sufficiency or activate outbound delivery.
- **Materialization and schema:** repository query selections and return shapes match the former inline SQL. The database's user/workspace unique keys and composite workspace-rule/project foreign keys remain unchanged; the extracted functions retain the same await points and optional inserted-rule ID behavior. No policy, router, migration, feature flag, or delivery code changed.

## Checks actually run

- `git diff --check 629cb54f8f68293de58bc7b98a5e408a9f679427 d91c66d39ccf9e4b5272ed61135305c676bcea70` — passed.
- `pnpm --filter @taskdesk/api typecheck` — passed across the command's configured TypeScript projects, exit 0, no diagnostics.
- Read-only source trace and comparison as above. I did not run PostgreSQL integration, Docker/image/health, or browser verification: the conductor's Docker daemon remains blocked pending owner restart. The author's and ordinary reviewers' other checks are source-bound reports, not my independently run checks.

## Residuals and disposition

`reachableWorkspacePredicate` is still imported from `utils/workspace-access-middleware.ts`; its ownership remains a separate #580 residual. `notification-preferences/delivery.ts` is unchanged because #785 owns it. The existing multi-statement workspace-project replacement is not made atomic by this extraction; this candidate preserves the prior sequence and does not invent a transaction. This verdict establishes no whole-path #580 completion, checker activation, #764/#780 acceptance, provider activation, integration/browser proof, exact-image boot, CI gate, or merge readiness.

---

Retained evidence file — 580-notification-b4-composition-luna.md

# #580 notification-preferences / #785 batch composition

Result: clean no-fast-forward composition complete; no source conflict and no post-merge file edits. This is an author handoff, not an independent review or acceptance claim.

- Worktree: `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`
- Branch: `codex/query-ownership-580-b4`
- Pre-merge #785 head verified clean: `8fa653b2f60d1a516ba59877feaceedd747eac0b`
- Incoming reviewed notification-preferences head: `d91c66d39ccf9e4b5272ed61135305c676bcea70`
- Merge result: `1ee06c1e5f1a50532845756fcb0e0e628f10e125`; parents are exactly `8fa653b2f60d1a516ba59877feaceedd747eac0b` and `d91c66d39ccf9e4b5272ed61135305c676bcea70`.
- Incoming d91 ancestry explicitly composes reviewed contract head `0627093df3ef9a7cf6784d242642a22cf887a077` and accepted-main head `e9df2294fa580fd2885343bbef0cec28e81ead4c` through `629cb54f8f68293de58bc7b98a5e408a9f679427`; this is not a branch from the outbox commit.

`git merge --no-ff --no-edit d91c66d39ccf9e4b5272ed61135305c676bcea70` succeeded with no conflict. The merged notification-preferences service and repository files are byte-identical to the incoming d91 versions (`git diff --exit-code d91..HEAD --` those paths succeeds). The merge result keeps both parent histories. Diff accounting:

- Against first parent (8fa #785): 38 paths, 2,836 insertions / 222 deletions; this brings the reviewed 062/e9 composition and two notification-preferences source changes into the existing batch.
- Against second parent (d91): 36 paths, 1,910 insertions / 790 deletions; this preserves the existing #785 logical notification/audit/workflow/scheduler batch.
- Actual source candidate diff against accepted main e9: 48 paths, 2,936 insertions / 963 deletions. It includes the combined #785 batch and the reviewed #580 contract/source composition. The accepted-main project/release/deployment changes arrive through the second parent and are not new changes relative to e9.

Validation on the merge result:

- `pnpm --filter @taskdesk/api typecheck` — exit 0, no diagnostics.
- `pnpm exec biome check <changed TS/TSX/MJS paths from e9..HEAD>` — passed, 39 files checked.
- `git diff --check e9..HEAD -- apps/api tests` — passed.
- Full `git diff --check e9..HEAD` reports trailing whitespace and one blank line at EOF in the inherited append-only `docs/07-planning/security-reviews/764-query-ownership.md`. That authentic reviewer record was preserved unchanged; no doc cleanup was made.
- No API/unit/PG tests, Docker, browser, or runtime checks were run. Relevant expected tests from the #785 batch include `tests/api-integration/notification-scheduler-workflow-audit-repositories.test.ts`, `tests/api-integration/workflow-publish-shape.test.ts`, `tests/api-integration/notification-task-reach.test.ts`, plus executor coverage. PG-dependent tests remain unverified under the current Docker restriction.

Dependencies and limits: #764 acceptance still depends on the #780 decision retained in unaccepted carrier #791, as recorded in the security-review history. This merge does not claim #580, #764 or #780 accepted/complete; no push, PR update, or PR creation was performed. The branch remains ahead of its remote by the pre-existing #785 commits plus this merge.

---

Retained evidence file — 580-notification-b4-composition-a-luna.md

# #580 notification / #785 batch composition — independent ordinary review A

**Verdict: CHANGES REQUIRED.** One blocking inbox authorization defect is present at the composed head.

- **Reviewed head:** `1ee06c1e5f1a50532845756fcb0e0e628f10e125`
- **Comparison base:** accepted-main `e9df2294fa580fd2885343bbef0cec28e81ead4c`; composition parents `8fa653b2f60d1a516ba59877feaceedd747eac0b` and `d91c66d39ccf9e4b5272ed61135305c676bcea70`
- **Independence:** Fresh review context; I did not author, direct, or remediate this candidate.
- **Model provenance:** GPT-6 context; runtime introspection does not expose a Luna/Sol variant or version. I do not claim otherwise.
- **Scope:** Read-only review of the full #785 notification/workflow/audit/scheduler batch and its #580 composition with notification-preferences extraction. I inspected the repository workflow/mission/status, notification/workflow/audit feature contracts, the candidate diff accounting and relevant producer/read-path code. No source changes were made.

## Blocking finding

### B1 — New `work_item` inbox rows bypass current reach checks

`apps/api/src/notification/fanout.ts:60-77` explicitly permits the new `work_item` resource type, and `materializeNotificationFanout` inserts those event-derived rows (`:128-138`). The new event writer is used by the comment/mention producer and approval producers in the composed source. However, `apps/api/src/notification/inbox.repository.ts:19-30` adds current reach only when `resourceType === "task"`; every other type passes this predicate. `approvalNotificationReadable` separately checks only `approval`. Consequently, a `work_item` inbox row written by fan-out is returned by `listVisibleNotificationRows` (`:118-126`) after the recipient loses work-item/project reach. The same omission affects mark-read and clear operations (`:33-55`, `:70-86`). This contradicts the notification contract's explicit rule that list/read/mutation operations recheck current reach and omit unreachable resources before pagination (`docs/03-features/notifications.md:351-357, 382-388`). It also leaves `comment` rows without their specified live-comment visibility and owning-work-item reach check.

This is now on an active producer path, not only a future-wiring residual: `rg` confirms `enqueueNotificationEvent` callers in `apps/api/src/approval/service.ts`, `apps/api/src/approval/reminder-scan.ts`, and `apps/api/src/work-item/controllers/create-comment.ts`. A recipient whose access is revoked can still see the stored notification title/body/resource through their own inbox. Add type-specific fail-closed current-reach predicates for all newly materialized resource types (at minimum `work_item` and `comment`) to every inbox read/mutation statement, and regression cases that revoke reach after fan-out and assert list/mark/clear behavior matches the contract.

## Other checks and limits

- Verified candidate `HEAD` equals the assigned exact SHA and the worktree has no uncommitted changes.
- Read the full notification contract around NO-8 and inbox permission/reach mappings; inspected fan-out and all inbox repository operations/callers. Also inspected the workflow publish implementation and relevant repository extraction shape; no additional independently substantiated finding is included here.
- No tests or runtime checks were run in this review context. Docker/PostgreSQL/browser verification remains unavailable/pending as stated in the handoff; no test or acceptance result is inferred.
- Existing bounded notification-preferences A/B and Sol reports apply only to the two-file preference-service extraction at `d91c66d3`; they do not clear this full composition finding. No #580, #764, #780, release or acceptance status is claimed.

---

Retained evidence file — 580-notification-b4-composition-b-luna.md

# #580 notification / audit / scheduler / workflow composition — ordinary review B

**Verdict: APPROVE the reviewed source composition; no blocking findings.** This is an independent ordinary code review of the exact composed source. It does not grant #764/#780 acceptance, clear dependency items, or establish candidate acceptance.

**Reviewed head:** `1ee06c1e5f1a50532845756fcb0e0e628f10e125`  
**Comparison base:** `629cb54f8f68293de58bc7b98a5e408a9f679427` (accepted-main composition base for the #785 source batch)  
**Composition parents:** `8fa653b2f60d1a516ba59877feaceedd747eac0b` and `d91c66d39ccf9e4b5272ed61135305c676bcea70`  
**Reviewer/context:** GPT-6, fresh independent context, assigned as ordinary reviewer B; I did not author, direct, or remediate this candidate. The platform did not expose a more specific model alias/version or runtime introspection in this context.  
**Source:** isolated worktree `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`; read-only review, no repository edits.

## Scope and evidence

Reviewed the #785 query-ownership conversion in notification inbox/fan-out, audit, scheduler, and workflow paths, plus the composed notification-preferences repository extraction. Read the repository workflow and model policy, active mission/status, workflow, audit, notification, background-job and query-ownership contract records, the author’s composition receipt, changed production files, and added repository-focused integration tests.

Read-only checks:

- Confirmed `HEAD` is the exact reviewed SHA and the worktree has no changes.
- Confirmed both composition parents and that the incoming `d91c66d3` ancestry is present.
- Confirmed the notification-preferences service and repository are byte-identical to the incoming `d91c66d3` source (`git diff --exit-code d91..HEAD -- <paths>`).
- `git diff --check 629cb54..HEAD -- apps/api tests` passed.
- Inspected the exact source changes for transaction handles, SQL predicates, ordering, timestamp expressions, notification resource/reach filters, lease ownership, reminder selection, and workflow transaction propagation.

A targeted API unit-test command was attempted for the existing notification and scheduler unit files using `apps/api/vitest.config.ts`; it did not start because this worktree has no `vitest` executable (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "vitest" not found`). No tests therefore ran in this review. I ran no PostgreSQL integration, Docker, browser, or runtime checks, consistent with the assigned environment restriction. The author’s same-SHA API typecheck and Biome results are author evidence, not results I independently ran.

## Findings

**Blocking:** none.

**Non-blocking:** none identified in the reviewed source composition.

The repository extractions preserve the critical behavior visible in the before/after source: audit append still runs under the caller’s transaction and keeps lock → head → clock → insert ordering; the fan-out repository takes the originating transaction handle for person locking, inbox insertion, and external-delivery insertion; inbox statements compose the same owner, approval-readability, and task-reach predicates; the lease claim/release SQL and UTC helpers are unchanged; the due-date selection and unique reminder insert keep their prior filters; and workflow create/publish transactions pass the transaction handle to each repository statement. Preference service extraction retains its workspace/project predicates, reachable-workspace predicate, encryption handling, and response construction. Composition of the reviewed preferences source is exact.

These checks establish source-level review only. Database predicate and rollback behavior still depend on the unrun PostgreSQL suites; I do not claim runtime or browser behavior from static inspection.

**Residual risk / limits:** The new integration tests directly target important repository predicates and transaction behavior, but were not run because Vitest is unavailable in this worktree and PostgreSQL/Docker verification is explicitly out of scope here. The full candidate also contains accepted-main release/deployment/project-control content; this review did not re-review those unchanged accepted-main facts as new source. No acceptance/dependency clearance, security review, merge readiness, or phase completion is claimed.

---

Retained evidence file — 580-notification-b4-b1-adjudication-luna.md

# #580 notification composition — B1 adverse finding adjudication

**Adjudication: B1 is confirmed for active comment-mention inbox rows. The approval portion is not confirmed. The confirmed reachability defect predates this composition in accepted main, and the composition preserves it.** Because `notifications.md` explicitly makes current-resource reach a pre-wiring gate before producers call this runtime, the current composed repository state remains blocked on that gate even though this query-ownership refactor did not introduce the defect. This is a bounded adjudication of report A's B1, not a replacement for my original ordinary review or an implementation/security review.

**Reviewed head:** `1ee06c1e5f1a50532845756fcb0e0e628f10e125` (unchanged)  
**Accepted-main comparison:** `e9df2294fa580fd2885343bbef0cec28e81ead4c`  
**Reviewer/context:** GPT-6, fresh independent triage context; I did not author, direct, or remediate the candidate or report A. The platform did not expose a more specific model alias/version or runtime introspection.  
**Adverse report adjudicated:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/580-notification-b4-composition-a-luna.md`  
**Source:** read-only isolated worktree `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`.

## Comment-mention path: reachable defect

`apps/api/src/work-item/controllers/create-comment.ts` actively calls `enqueueNotificationEvent` in its comment transaction for each reachable mentioned person. Its `work_item.mentioned` payload includes the inserted `commentId`. `resolveMentionEventRecipient` in `apps/api/src/notification/recipient-resolvers.ts` resolves that id as a `comment` resource, verifies the current workspace/project and organization, resolves the recipient identity, and calls `reaches(...)` before returning a recipient. `materializeNotificationFanout` then inserts the inbox row with `resourceType: "comment"`, `resourceId: commentId`, and the fixed title/body. Thus this is an active producer, not only a resolver stub.

That creation-time check does not protect an already-created row after reach is revoked. All four inbox operations use the shared predicates in `apps/api/src/notification/inbox.repository.ts`: list, single mark-read, mark-all-read, and clear-all. `taskNotificationReadable` requires a current reach predicate only when `resource_type = 'task'`; for `comment`, its `resource_type IS NULL OR resource_type <> 'task'` arm passes. `approvalNotificationReadable` similarly passes every non-approval type. The list query has no comment/work-item join or comment reach predicate. Consequently, after a recipient loses access to the work item/project, their still-present comment-mention row remains listable and may be marked read or cleared. The list response contains the stored notification body (including the work-item key) and comment resource id, so this is a post-revocation resource-disclosure / access-control defect, not merely stale inbox hygiene.

This directly conflicts with `docs/03-features/notifications.md`'s Permissions contract that inbox list/read/mutation operations apply current reach to each referenced resource, and its `comment` mapping requiring a live visible comment followed by current work-item/project reach. It also matches the explicit pre-wiring gate at that document's closing implementation-status section: gate (1) requires all registered resource types to be reach-filtered before any producer calls the runtime; gate (2) says approval is the first in-app producer and expressly leaves gate (1) for other types open. The current code has an active comment producer despite that gate text.

## Approval path: adverse claim not established

Approval producers are active (`approval/service.ts` and `approval/reminder-scan.ts` call the fan-out seam), but their rows use `resource_type = 'approval'`. `approvalNotificationReadable(userId)` routes that discriminator through `reachableApprovalNotificationPredicate`, which requires a matching approval joined to its work item in the same workspace, live work item/project, valid recipient relation (requester, approver or watcher), private-item visibility, an active staff person matching the session user, and current staff project reach. The current predicate is composed into all four inbox operations listed above. The event recipient resolver separately rechecks identity/reach when materializing. I found no parallel approval-row bypass in B1; the predicate may warrant its own spec-focused security review but this report did not identify a concrete gap in it.

The supported `work_item` discriminator has no active fan-out producer in the current application call sites I found. The active comment mention uses `comment` because `commentId` is present. I therefore do not extend the confirmed result to a hypothetical work-item row.

## Origin and scope

Comparing the relevant producers and read paths against accepted main establishes origin precisely:

- `create-comment.ts`, `approval/service.ts`, and `approval/reminder-scan.ts` are unchanged between accepted main `e9df2294` and this candidate.
- Accepted main already had the active comment-mention `enqueueNotificationEvent` call and the same effective inbox filter: current task reach only for `resource_type = 'task'`, plus the separate approval predicate. The candidate moves these reads and predicates into `inbox.repository.ts`; the `approval-reach.ts` rename and query extraction do not add the missing comment predicate or create the producer.
- The defect is therefore pre-existing in accepted main; it is not a behavioral regression caused by the current #580 query-ownership changes. The composed candidate nevertheless carries a state that contradicts the explicit notification pre-wiring gate, so the gate remains unresolved for current repository acceptance.

## Checks and limits

Read-only source checks: confirmed exact `HEAD`; inspected the cited producer, recipient resolver, fan-out materialization, current inbox predicates, approval predicate, and spec; compared relevant producer files with accepted main. No files in the repository were edited.

No runtime/database test was run. The earlier `pnpm exec vitest ...` attempt was issued at the workspace root, where Vitest is not a root executable; the binary is installed under `apps/api/node_modules/.bin/vitest` and `pnpm --filter @taskdesk/api exec vitest --version` reports Vitest 4.1.11. This is a command-scope issue, not a missing installation. A useful regression for the confirmed behavior requires PostgreSQL-backed inbox predicates and a reach-revocation case; PostgreSQL/Docker/browser checks were out of scope here. No repair design is offered in this adjudication.

---

Retained evidence file — 580-notification-b1-repair-scope-luna.md

# #580 notification B1 — bounded repair scope (read-only preparation)

**Candidate preserved:** worktree `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, branch `codex/query-ownership-580-b4`, merge head `1ee06c1e5f1a50532845756fcb0e0e628f10e125`. This inspection made no source changes and ran no tests or runtime services. Keep the candidate and both review reports unchanged while independent reviewer B adjudicates.

## Contract and reported gap

`docs/03-features/notifications.md:344-348` requires current resource reach on inbox list, read, and mutation; inaccessible/deleted rows must be removed before pagination and direct access hidden. The resource mapping at `:356-357` is precise for these two active types: a `work_item` row resolves the current item and rechecks work-item/project reach; a `comment` row resolves a live comment visible to the recipient, then its owning item and current work-item/project reach. `:382-386` says missing/deleted/unmapped resources fail closed, with no recipient-only fallback.

The independent A report (`580-notification-b4-composition-a-luna.md`) identifies the concrete gap in `apps/api/src/notification/inbox.repository.ts`: the existing `taskNotificationReadable` predicate exempts all non-`task` types; it is used by list, mark-all, clear-all, and mark-one. Thus the currently accepted comment fanout can remain visible and mutable after the comment or its parent loses liveness/visibility/reach. `listVisibleNotificationRows` currently joins only legacy `task` to project/workspace; rows are limited to 50 after the incomplete reach filter. Preserve the report verbatim; this note is preparation, not a rebuttal or a resolution of B's adjudication.

## Reach and comment-visibility sources

- Work-item policy: `docs/03-features/work-items.md` Permissions says `Read | work_item:read | Plus reach on the project`. `apps/api/src/work-item/require-work-item-reach.ts` resolves a live item joined to its project, requiring non-deleted/non-archived item and non-deleted project, then validates workspace membership and project reach. `apps/api/src/utils/assert-work-item-project-reach.ts` delegates live facts to `projectReadDecision`; `apps/api/src/utils/has-project-reach.ts` resolves identity and calls the canonical `reaches(identity, facts)`/capability policy. These route helpers take Hono request context and can return HTTP errors; they are not ready-made SQL predicates for a correlated inbox query.
- Comment visibility: `docs/03-features/comments-and-activity.md:35-48` defines public/internal visibility: staff see both; customers see public only and never internal. `:154-166` requires `work_item:read` for public comments and that plus staff side for internal comments. `docs/03-features/notifications.md:357` further requires a live comment and then owning work-item reach; `NO-19` excludes internal comment notifications to customers.
- Route-level comment resolution: `apps/api/src/work-item/require-comment-reach.ts` joins comment → work item → project and filters deleted/archived work items and deleted projects before calling `assertWorkItemProjectReach`. It does not implement a reusable SQL inbox predicate, and its route policy may enforce capabilities that the inbox contract describes as reach. Do not silently equate route middleware with an inbox-query predicate.
- Mention-specific visibility/reach: `apps/api/src/work-item/mention-access.ts` and `apps/api/src/notification/recipient-resolvers.ts` use resolved identity, `reaches(...)`, private-item visible-person facts, and current comment/resource lookup. This establishes the active mention path but is asynchronous application logic, not a statement predicate reusable in list/update/delete.
- The approval implementation (`apps/api/src/notification/approval-reach.repository.ts`) is a useful in-repo example of correlated `exists` predicates, current liveness, recipient identity, private-item audience, and project reach. It is approval-specific and staff-only; copying its semantics for work-item/comment rows would be a contract invention.

A read-only source search did not find a reusable SQL predicate for native `work_item`/`comment` inbox reach. The route/mention helpers above are the available relevant policy sources. Therefore implementation details for an SQL-composable predicate—and how it represents identity/project reach and customer private-item visibility—remain a decision path to settle against the canonical permission helpers/spec before edits, rather than something this preparation note chooses.

## Active producer path and bounded resource types

`apps/api/src/work-item/controllers/create-comment.ts:140-190` classifies mentioned people inside the comment transaction, filters to reachable non-self people, adds watchers, then builds a `work_item.mentioned` event carrying both `workItemId` and `commentId` and calls `enqueueNotificationEvent` with `resolveMentionEventRecipient`.

`apps/api/src/notification/recipient-resolvers.ts:22-87` requires a live current `comment` resource matching the canonical work-item and event scope, checks the mentioned person's resolved identity/current reach (including audience visibility for customer identities), and returns `resourceType: "comment"`, `resourceId: commentId`, constant safe title/body, and `channels: []`. `fanout.ts:51-57,60-77,121-148` persists the event/inbox rows and only creates delivery children for `notify.*` channels. Thus the in-scope active comment mention creates an in-app row, not outbound delivery. `work_item` is an already registered resource type too, but this task is explicitly bounded to the two active types named in B1; leave approvals, workspace, instance, and all other producers/types untouched.

## Minimum repair file/test boundary (for authorization after B adjudication)

- Source candidate: `apps/api/src/notification/inbox.repository.ts` only. The required behavioral coverage must encompass `listVisibleNotificationRows`, `markOwnReadableNotificationRead`, `markReadableNotificationsRead`, and `deleteReadableNotifications`. Preserve self-recipient scoping, current approval predicate, legacy task semantics, response row shape, and pre-limit filtering. Do not change fanout registration, producers, resolver behavior, delivery channels, or public contract.
- Best existing real PostgreSQL integration home: `tests/api-integration/notification-task-reach.test.ts`. It already exercises real database list filtering before the 50-row cap, direct mark-one 404, mark-all, clear-all, and revoked project reach. It can host focused native `work_item` and `comment` visibility/revocation/liveness cases alongside the legacy-task regressions without creating a mirrored test module. Existing `tests/api-integration/work-item-comment.test.ts` is the real comment creation/mention producer home, but is not the inbox read/mutation reach suite. The small `tests/api/notification-preferences/preferences.test.ts` (or similarly named preference tests) is a different service area and is not evidence for this fix.
- A focused integration should prove visible reachable rows remain listable/mutable; after reach revocation or resource liveness/visibility changes, list omits before pagination, mark-one returns the established not-found result, mark-all leaves rows unchanged, and clear-all preserves unreachable rows. The comment cases need at minimum public-vs-internal customer visibility and a deleted/tombstoned comment/parent liveness case, using existing fixtures and canonical identity setup. Do not broaden into notification producer, preference, digest, worker, or outbound-provider tests.

## Ordering/dependency boundary

The same `notifications.md:582-590` labels inbox reach as a pre-wiring gate and says the non-approval resource-type predicate remains open; it separately states approvals are first in-app producer and their slice closes its own approval-specific resolver/send-time/inbox work. This source file also says the outbox runtime is not complete and calls out other later gates. Keep this B1 fix limited to the already active `work_item`/`comment` inbox visibility gap. It does not close all pre-wiring gates, activate held producers, complete notification delivery, or make #580 complete. The candidate also depends on accepted query-ownership contract/source composition and remains subject to the noted #764/#780 integration dependency; do not merge this bounded source repair independently of its owning composition/review flow.

## Evidence and limits

Read-only commands were `sed`/`nl`/`rg` on the candidate tree for the paths cited above and review report A. No source mutation, test execution, database access, Docker, browser, push, or review disposition occurred. B's independent adjudication is still pending; do not implement until the orchestrator authorizes the exact repair boundary and any unresolved policy-predicate choice is settled.

---

Retained evidence file — 580-notification-b1-design-sol.md

# #580 B1 native inbox reach — bounded security design advice

**Source:** frozen composition `1ee06c1e5f1a50532845756fcb0e0e628f10e125` in `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`. **Role:** read-only design advice, not an independent implementation, ordinary-review, or security-review verdict. I did not edit the candidate, execute tests, start a database/browser/container, or change PR state. The existing A finding and separate B adjudication remain the finding record. This advice context has materially directed the repair and cannot independently approve its implementation.

## Recommendation

Use a **native-only, transaction-scoped application authorization filter** backed by the existing `findCurrentNotificationResource` loader and the canonical `resolveIdentity`, `reaches`, and `can` evaluators. It should handle `resource_type IN ('work_item','comment')` on each of the four inbox operations. Preserve the existing SQL task and approval predicates and all other held/legacy resource behavior. Do not copy `projectReachPredicate`: it is a legacy/staff SQL encoding and is not the canonical native/customer policy. Do not introduce a SQL recreation of `can()` or a new framework/schema/capability for this bounded fix.

The per-row native decision, before returning any notification fields or mutating a row, is:

1. Require own `notification.user_id`, a non-null `person_id` equal to the freshly resolved identity's `personId`, non-null `resource_id`, non-null `kind`, and the existing closed resource/event mapping (`isSupportedNotificationResourceEvent`). For native event rows, missing or inconsistent binding fails closed. Do not infer an identity from stored notification content. The list route must pass its *actual credential* into `resolveIdentity`; for an API key pass its authenticated key owner, enabled state, and parsed `apiKeyCapabilitySubset`, so `can()` retains its key clamp. The three mutation routes are session-only already. No session fallback for a key request.
2. Resolve the referenced live item, or the live comment and its owning live item, from persisted rows. The existing `findCurrentNotificationResource` performs this lookup, checks item/project/workspace liveness and comment body, and supplies workspace/project/organisation and private-audience facts. Tighten its comment branch to require `comment.deleted_at IS NULL` as well as a non-null body; a deleted tombstone must never be treated as live even if malformed data retains body. Require comment visibility to be `public` for a customer and allow both registered visibility values for staff. The current resolver exposes `customerVisible` for that purpose. Fail closed if project id or required facts are unavailable; do not use an event payload or URL as the authoritative resource owner.
3. Call `reaches(identity, {projectId, workspaceId, organisationId, visibleToPersonIds})`; apply `visibleToPersonIds` only for the customer side, as the existing mention resolver does. Then call `can(identity, 'work_item:read', 'work_item', {workItemId, workItemProjectId: projectId, projectId, workspaceId})`. Both must pass. This preserves project-role override, customer organisation/private requester-or-participant audience, active/banned person state and API-key capability clamp. `projectReadDecision(c,...)` is tied to the route's Hono policy and cannot evaluate a referenced notification item; call the same pure evaluator functions directly. The current schema has no ancestor-project or owner-team facts; leave those absent rather than inventing a grant. This is the documented over-suppression, not a reason to copy the legacy predicate or allow by workspace membership.

`findCurrentNotificationResource` already checks the `work_item` and `comment` event map and returns private participant facts, but its `comment` query currently checks `body IS NOT NULL`, not `deleted_at`. Review the exact comment tombstone lifecycle during implementation. Avoid making this resolver's change alter send-time behavior silently: an extra liveness check is aligned with its existing `CurrentNotificationResource` contract, but it is a touched security path and belongs in the review/test scope.

## Query and mutation shape

- **List:** Keep recipient and existing task/approval SQL filters. Fetch candidates in deterministic descending `(created_at,id)` keyset pages, with no `LIMIT 50` on the unfiltered native candidates. Resolve identity once per request, authorize native candidates in order (batch/prefetch resource facts if needed), collect 50 visible rows, then stop. Scan until 50 visible or exhaustion; the output order must match the query order. Do not return a hidden row's stored `title`, `body`, `event_data`, id or count. Existing task-derived project/workspace response decoration stays intact. Keyset pagination avoids offset drift while scanning and avoids loading a recipient's whole history just to show 50 rows.
- **Mark one:** Load only the addressed own row inside the operation's transaction; for a native row, authorize it before `UPDATE`. Keep the final update scoped to `(id,user_id)` and the checked discriminator/resource identity, returning 404 on missing, changed, or denied rows. Legacy task/approval branches retain their existing SQL predicates and audit-alert gate.
- **Read all / clear all:** Enumerate every own candidate in bounded keyset chunks inside the operation transaction; retain the existing task/approval SQL predicates; authorize each native candidate before adding its id to a write batch. Update/delete only own, authorized ids, with a row identity/discriminator guard. Do not stop at 50 or allow an unfiltered `UPDATE/DELETE` for native rows. Hidden rows remain unread/present. If any required identity/resource load fails, roll back rather than treating failure as allow. Batch resource lookups to avoid N+1 query behavior on a large inbox.
- **Concurrency:** Put native candidate reads, policy fact reads, and writes in one transaction using one coherent snapshot; recheck row identity in each write and retry serialization failures through a bounded policy. A previously completed reach revocation is denied by the next operation's fresh snapshot. Concurrent revocation and inbox mutation require a defined linearization point (the authorization snapshot); database integration should exercise the critical interleaving. If the project requires the stronger rule that a revocation committed during an in-flight bulk operation must retroactively prevent its write, this approach needs shared locking with every reach-changing writer and should be escalated as a separate concurrency design. The current spec does not state that stronger ordering. Do not claim a two-statement check outside a transaction is atomic.

This recommendation moves more than the single repository file: the list handler must provide the actual credential, and a native decision helper needs the existing loader/evaluator. The shared `inbox.repository.ts` remains the one owner of candidate enumeration and guarded writes. Preserve its public response shape and all legacy branches. A source-scoped correlated SQL predicate would make each write one statement, but recreating role selection, key clamping, customer organisation and private participant reach in SQL duplicates the canonical policy and is a larger authority surface. The current `projectReachPredicate` is not a safe shortcut.

## Concrete implementation and evidence scope

Expected source touch points: `apps/api/src/notification/inbox.repository.ts`; a small native decision helper under `apps/api/src/notification/` (or private to the repository if clean); `apps/api/src/notification/repository.ts` for comment tombstone liveness; `apps/api/src/notification/index.ts` and `controllers/get-notifications.ts` for authenticated credential facts, plus mutation controllers only as needed to route through the transaction. Use existing `resource-contract.ts`, `permissions/resolve-identity.ts`, `packages/permissions` evaluator and `utils/require-api-key-permission-scope.ts`; do not alter their authority semantics. If tests expose a pre-existing loader problem, amend only that loader with a regression.

Real PostgreSQL regressions belong primarily in `tests/api-integration/notification-task-reach.test.ts`, alongside its existing pre-limit, single-read 404, read-all, clear-all, and revocation cases. Cover the matrix below with actual inbox rows, including a real comment mention producer case from `work-item-comment.test.ts` if fixtures allow it:

| Condition after row creation | List | Mark one | Read all / clear all |
| --- | --- | --- | --- |
| Reachable staff item and public/internal live comment | shown | succeeds | changes/removes |
| Project membership or `sees_all` revoked; person deactivated/banned | hidden | 404 | leaves row unchanged |
| Item/project/workspace archived/deleted; comment tombstoned | hidden | 404 | leaves row unchanged |
| Customer, same organisation, public comment, organisation-visible item | shown with `work_item:read` | succeeds | changes/removes |
| Customer, internal comment; wrong organisation; private item without requester/participant relation | hidden | 404 | leaves row unchanged |
| Customer gains/loses private participation after creation | follows current participation | follows current participation | follows current participation |
| API key with/without `work_item:read` subset (list route) | clamped / hidden | session-only route | session-only routes |
| 55 newer hidden native rows before an older reachable row | older row still in 50 | — | hidden rows untouched |
| Missing/unknown kind, mismatched person binding or resource id | hidden | 404 | leaves row unchanged |

Also retain the existing legacy-task and approval tests, verify exact query counts or a bounded upper bound for 100+ rows, and reproduce at least one concurrent revocation/read interleaving if the implementation claims transactional behavior. Run the relevant API integration and permission tests, full repository checks required by Definition of Done, and the image build/boot/health gate for shipped API source. Independent ordinary and fresh Sol security reviews must inspect the new exact head; this report cannot count as either. This repair alone neither closes all notification pre-wiring gates nor activates held producers or establishes #580 completion.

## Policy decision status

No Thomas-only product decision is needed for the bounded behavior: the approved notification, work-item, comment and RBAC specs already specify current reach, customer visibility, private audience, liveness and denial. Transaction/pagination strategy is an implementation choice. The only question to escalate is if a reviewer demands strict cross-transaction revocation ordering beyond the spec's current-reach check; state that requirement precisely before designing global locking.

---

Retained evidence file — 580-notification-b1-repair-luna.md

# #580 notification B1 bounded repair — author handoff

## Result

**Implemented and committed; awaiting fresh review.** The repair adds current canonical work-item/comment reach and visibility checks to inbox list, mark-one, mark-all, and clear-all. It does not close all notification pre-wiring gates or claim #580 complete. No push/PR was made.

## Source

- Worktree: `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`
- Branch: `codex/query-ownership-580-b4`
- Repair commit: `bd5f76d8e7e6a88c34791f94e38ad377ce5c1447`
- Parent: `1ee06c1e5f1a50532845756fcb0e0e628f10e125`
- Worktree is clean after commit. The original merge candidate and review/design reports remain preserved.

## Changed files and behavior

- `apps/api/src/notification/inbox.repository.ts` resolves the recipient's canonical identity inside a repeatable-read transaction, preserving actual API-key capabilities for list requests and the existing session-only mutation boundary. It keyset-pages candidates in stable `(created_at, id)` order. Native `work_item` and `comment` rows are authorized before the first 50 visible list entries are returned and before any update/delete. Bulk mutations scan all pages, not just the list window. Writes recheck recipient/resource discriminator identity. PostgreSQL serialization failures (`40001`) retry the whole operation at most twice with a fresh transaction/snapshot.
- New `apps/api/src/notification/native-inbox-reach.ts` fails closed on absent identity/resource facts, missing/mismatched person binding, missing event kind, unsupported resource/event mapping, and non-live/missing resource facts. It requires canonical `reaches(...)` and `can(..., "work_item:read", "work_item", ...)`; customers must also satisfy public-comment visibility and current private-item requester/participant audience.
- `apps/api/src/notification/repository.ts` batch-loads live native work-item/comment and audience facts per candidate page (not a resource lookup per notification). Item/project/workspace must be live; comments must have `deleted_at IS NULL`, a body and a known visibility. The existing single-resource comment resolver now also rejects tombstones explicitly.
- `apps/api/src/notification/index.ts` and `controllers/get-notifications.ts` pass the authenticated API-key/impersonation facts through to canonical identity resolution; no key request falls back to session authority.
- `tests/api-integration/work-item-comment.test.ts` adds two real PostgreSQL regression cases: (1) the 50-row pre-limit filter, person-binding mismatch, key clamp, tombstone hiding, direct mark-one 404, read-all preservation and clear-all preservation; (2) customer public/internal comment visibility and private-item requester/participant/organisation reach.

Existing SQL filters for legacy task and approval rows remain in place. The existing instance-admin list filter remains SQL-scoped. Other resource types/producers, delivery channels, schema, routes, permissions and response DTOs were not changed. This work does not activate other held producers or alter approval behavior.

## Contract evidence

- `docs/03-features/notifications.md:344-357,382-386`: self-scoped inbox operations apply current resource reach; hidden/deleted resources are filtered before pagination; work-item rows require current item/project reach; comment rows require a live recipient-visible comment then owning item reach; unknown/missing mappings fail closed.
- `docs/03-features/work-items.md` Permissions: `work_item:read` plus project reach.
- `docs/03-features/comments-and-activity.md:35-48,154-166`: staff see both public/internal comments; customers never see internal comments; comment reads require `work_item:read` (plus staff-side for internal).
- `apps/api/src/work-item/controllers/create-comment.ts` plus `apps/api/src/notification/recipient-resolvers.ts`: current comment-mention producer stores comment resource ids and candidate person ids after current mention reach checks.
- `docs/03-features/notifications.md:582-590`: inbox reach is an explicit pre-wiring gate; approval-specific closure is separate. The repair covers only the confirmed active native `work_item`/`comment` gap and does not close the remaining gates.
- The design follows fresh Sol advice in `580-notification-b1-design-sol.md`; that context materially directed the repair and is not an independent reviewer for this commit. Preserve B's adjudication and all prior adverse reports unchanged.

## Verification

- `pnpm --filter @taskdesk/api typecheck` — **PASS, exit 0**; includes API, permissions, API tests, RLS-prototype and approvals e2e TypeScript projects.
- `pnpm exec biome check` on the six changed TS files — **no errors**. It reports five unused-variable warnings in pre-existing, untouched test cases in `work-item-comment.test.ts`.
- `git diff --check` — **PASS** before commit.
- New/affected PostgreSQL integration tests — **NOT RUN**: Docker/PostgreSQL execution was explicitly withheld pending runtime-owner restart authorization. Browser/image/runtime checks were not run. No success is claimed for those checks.
- The current branch does not include the unwired final `check:queries` command in its package scripts; no query-checker result is claimed.

## Next action

A fresh ordinary review panel and separate fresh Sol security review should review exact head `bd5f76d8e7e6a88c34791f94e38ad377ce5c1447`. After the runtime owner authorizes the PostgreSQL window, run the focused `notification-task-reach` neighbors and the two B1 cases in `work-item-comment.test.ts`. Do not push or create a PR until the orchestrator directs it.

---

Retained evidence file — 580-notification-native-ordinary-a-luna.md

# #580 notification native inbox reach — ordinary review A

## Review record

- **Reviewed head:** `bd5f76d8e7e6a88c34791f94e38ad377ce5c1447`
- **Comparison base:** `1ee06c1e5f1a50532845756fcb0e0e628f10e125`
- **Scope:** exact candidate diff (six files); native work-item/comment list, mark-one, read-all and clear-all authorization; identity, recipient/person, resource and comment bindings; private/customer visibility; legacy task/approval preservation; regression changes.
- **Independence:** fresh review context. I did not author, direct, or remediate the candidate. I read the author handoff and prior design advice as source context; neither report is treated as this verdict.
- **Model:** GPT-6, as exposed in this review context; platform did not expose a more specific variant/version. This report does not relabel the context as GPT-6 Luna.
- **Verdict:** **CLEAR — no blocking correctness or authorization finding in the reviewed delta.**

## Findings

No blocking findings.

The implementation follows the governing notification contract: recipient-scoped candidate selection; native resource authorization before applying the visible 50-row limit or performing writes; canonical `resolveIdentity` plus `reaches` and `can(work_item:read)`; and persisted current resource facts rather than event text or client input. The API-key list path carries the authenticated owner's key and exact registered capability subset, so its native authorization remains clamped. Mutation routes are guarded by `requireSessionOnly`, which rejects both API keys and impersonation sessions before the repository is called.

The person binding is checked against the resolved identity, and missing identity, resource, kind, unsupported event mapping, unavailable project facts, deleted/archived item/project/workspace, tombstoned or bodyless comment, and unknown comment visibility fail closed. The comment loader exposes both registered visibilities to staff while customer evaluation requires a public comment and canonical organization reach; a private item's requester/participant set is applied only for customers. The persisted `work_item.id` supplied to the capability evaluator is canonical even when an event's work-item resource reference uses its stable key. The evaluator and identity mapper preserve owner/project-role resolution, API-key clamping, active-person and banned-user refusal, and customer portal/organisation checks. The two bulk operations continue to scan beyond the first visible page and guard writes with the row's recipient and resource discriminator facts. Existing task and approval SQL predicates and held producers are preserved.

The comment tombstone check is also added to the shared single-resource loader. It narrows that loader to the documented live-comment condition and does not alter producer, event, or approval behavior.

## Verification performed

- `git rev-parse HEAD` — `bd5f76d8e7e6a88c34791f94e38ad377ce5c1447`.
- `git rev-parse <base>` — `1ee06c1e5f1a50532845756fcb0e0e628f10e125`.
- `git status --short` — clean at review start and after checks.
- `git diff --check <base>...HEAD` — pass, no output.
- `pnpm exec biome check` on the six changed TypeScript files — no errors; five unused-variable warnings occur in existing untouched test cases in `work-item-comment.test.ts`.
- `pnpm --filter @taskdesk/api typecheck` — pass, exit 0; this includes the API, permissions, API-test, RLS-prototype and approvals E2E TypeScript projects.
- PostgreSQL integration tests — not run; Docker/PostgreSQL was unavailable for this review. Browser and image/runtime checks were not run and are not claimed.

## Residuals

The two new PostgreSQL regressions are authored but unexecuted in this environment. They cover the pre-limit scan, person mismatch, key clamp, tombstone behavior, direct-read 404, read-all/clear-all preservation after lost reach, and public/internal customer comment visibility with private requester/participant/organisation boundaries. The spec's additional active/banned-user and all role-override cases were source-traced through the canonical identity and evaluator implementations, not independently exercised by a database run here. No runtime acceptance is claimed.

This is one ordinary review only. The candidate still requires the rest of its required ordinary panel and a fresh full GPT-6 Sol security review on this exact head. This report does not accept issue #580, any other carrier, image, browser, PostgreSQL, or delivery gate.

---

Retained evidence file — 580-notification-native-ordinary-b-luna.md

# #580 native inbox reach repair — ordinary review B

**Reviewed head:** `bd5f76d8e7e6a88c34791f94e38ad377ce5c1447`  
**Comparison base:** `1ee06c1e5f1a50532845756fcb0e0e628f10e125`  
**Reviewer:** GPT-6 (Codex subagent; exact served variant was not exposed in this context)  
**Role:** fresh independent ordinary reviewer B; I did not author, direct, or remediate this candidate.  
**Scope:** native comment/work-item inbox reach repair, repeatable-read/retry behavior, keyset and bulk paging, guarded writes, bounded resource loading, policy snapshot consistency, and preservation of legacy task/approval/instance-alert behavior.  
**Verdict:** **BLOCKED — two findings.**

## Findings

### B1 — Bulk operations can change instance alerts without current instance-admin authority

`bulkMutation` calls `selectCandidatePage` without `excludeInstanceAlerts`, so the default includes `type = 'audit_write_failed'`. It then treats every non-native row as allowed and updates or deletes it (`inbox.repository.ts:222-242`). The list path explicitly excludes these rows for non-admins (`:197-199`), and the feature contract says the current instance-admin capability is rechecked on every list/read operation and these alerts cannot be cleared or read without that authority (`docs/03-features/notifications.md`, Permissions, instance mapping). Consequently a user who lost admin authority can still mark the alert read or clear it through read-all/clear-all. This violates the instance-alert authority boundary and is a blocker for the requested conservation check, even though the behavior predates this diff.

The bulk operation needs to evaluate current instance-admin authority in its own transaction and exclude unauthorized alerts before writes, with regression coverage for both read-all and clear-all. The evaluator must remain recipient-scoped; no administrative override is appropriate.

### B2 — List's instance-admin decision is outside its transaction snapshot

`getNotifications` calls `isCurrentInstanceAdmin(userId)` before `listVisibleNotificationRows` starts its repeatable-read transaction (`controllers/get-notifications.ts:13-19`; `inbox.repository.ts:328-329`). If admin authority is revoked after that query but before or during inbox selection, the operation can return an instance alert using stale authority. The native work-item/comment checks do use identity and resource facts from the same transaction, but the instance policy does not satisfy the stated same-snapshot requirement.

Move the instance-admin lookup into the list transaction (or otherwise make the policy check use its transaction executor), and cover the authority/revocation ordering. The direct mark-one controller also prechecks this authority outside the repository transaction; the repository write itself does not gate `audit_write_failed` (`controllers/mark-notification-as-read.ts:8-15`, `inbox.repository.ts:276-309`). That path has the same stale-check issue and should use one transactional decision and write.

## Review notes

- The native evaluator fails closed on absent identity/resource facts, recipient-person mismatch, missing resource id/kind, unsupported mapping, missing project/work-item facts, customer-internal comments, and customer audience/reach failures. It uses canonical `reaches` and `can(..., "work_item:read", ...)` checks. API-key capability facts are passed through from the list route and clamped through `apiKeyCapabilitySubset`.
- Candidate ordering is deterministic `(created_at DESC, id DESC)` with a matching keyset cursor. List filtering precedes the 50-row response cap and can continue across candidate pages. Bulk loops until exhaustion, and write predicates bind user/person/resource discriminator/id/kind. Resource facts are loaded in page batches (work-item query, comment query, and conditional participant query), avoiding a per-notification resource lookup.
- The new PostgreSQL tests cover hidden rows ahead of a visible row, person mismatch, a clamped key, tombstoned comments, current project reach revocation, one-row denial, and customer public/internal/private-audience behavior. They do not exercise a bulk inbox spanning more than one 100-row candidate page, serialization retry/rollback, a concurrent reach-revocation ordering, or bounded query counts with 100+ distinct resources. Those are meaningful remaining validation gaps for the new paging/concurrency claims.
- Legacy task and approval SQL predicates remain in the candidate query. There is no regression evidence in these two new cases for preserving task/approval rows across the new paged bulk loop; retain their existing focused coverage when running the required integration suite.

## Checks actually performed

- `git rev-parse HEAD` — exact head matched the assigned candidate.
- Read the repository instructions, notification/work-item/comment/RBAC contracts, required repair/design notes, and the full relevant source diff and new integration-test diff.
- `git diff --check 1ee06c1e5f1a50532845756fcb0e0e628f10e125...bd5f76d8e7e6a88c34791f94e38ad377ce5c1447` — passed.
- `pnpm exec biome check` on the six changed TypeScript files — no errors; five unused-variable warnings are in pre-existing untouched portions of `work-item-comment.test.ts`.
- PostgreSQL integration tests, Docker/image/runtime, browser, typecheck, and concurrency reproductions were not run in this review context.

**Independence and limits:** This is a fresh ordinary review of the exact head. The prior Luna repair and Sol design-only notes were treated as context, not as approval. This verdict does not satisfy the remaining ordinary panel or the required fresh full GPT-6 Sol review.

---

Retained evidence file — 580-notification-instance-snapshot-repair-luna.md

# #580 notification instance-admin snapshot repair — author handoff

**Candidate:** `e3df4d7f77c4ab6907016244f5f804f045e70a39` (`fix(notification): recheck instance admin in inbox transactions`)

**Worktree / branch:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, `codex/query-ownership-580-b4`, based on preserved b4 `bd5f76d8e7e6a88c34791f94e38ad377ce5c1447` (the B1 repair and prior composition history remain ancestors). Clean after commit; branch is ahead of its origin by 61 commits. No push or PR was made.

## Change

Instance-alert access is now computed by `canReadInstanceAlerts()` in `apps/api/src/notification/inbox.repository.ts:155-160` from the current `ResolvedIdentity`: it requires `side === "staff"` and canonical `can(identity, "instance:admin", "instance", {})`. The identity is loaded with `resolveInboxIdentity(tx, ...)` inside the existing repeatable-read inbox transaction. The existing resolver consumes the actual API-key capability subset and fails closed for inactive/unresolved identities.

List filtering derives this decision inside the list transaction and removes unauthorized `audit_write_failed` rows in SQL before keyset paging (`inbox.repository.ts:342-358`). The earlier `isCurrentInstanceAdmin` precheck was removed from `get-notifications.ts`; the controller passes the real credential into the repository. Single-row marking checks the alert type and current identity within the same transaction before updating (`inbox.repository.ts:288-330`); its controller no longer performs a separate type/admin precheck and retains the existing 404 for an unavailable row. Read-all and clear-all use the same identity inside their shared bulk transaction and exclude alerts in the candidate query before paging (`inbox.repository.ts:229-255`). Recipient predicates remain bound to the supplied `userId`; no administrator override was introduced.

Tests add active-admin and foreign-admin behavior, role-loss checks across list/single-read/read-all/clear-all, actual API-key capability clamping, and 105-row hidden/visible list and bulk cases in `tests/api-integration/notification-task-reach.test.ts:142-266`. The existing repository visibility test now makes the member an actual `user.role="admin"` before expecting access, rather than passing a caller-chosen boolean (`tests/api-integration/notification-scheduler-workflow-audit-repositories.test.ts:99-126`). Removed the obsolete boolean at its remaining authorized call sites in `tests/api-integration/work-item-comment.test.ts`.

## Validation

- `pnpm --filter api typecheck` — passed after the final edit.
- `pnpm exec biome format --write` on changed formatted files — passed.
- `pnpm exec biome check` on the six changed source/test files — no errors; reports five existing unused-variable warnings in `work-item-comment.test.ts` at lines 802, 875, 1068, 1197, and 1671.
- `git diff --check` — passed.
- PostgreSQL-backed integration tests were **not run**, as instructed pending owner authorization for database use. No Docker/browser command was run.
- The broad query checker was not run; its fragment classification currently has a separate known repair in progress. This handoff makes no claim about checker proof.
- Serialization retry/fault-injection and query-bound tests were not added. The added integration regressions cover the required authority matrix and paging cases; transaction retry behavior remains existing `inboxTransaction` behavior and was not exercised here.

Fresh ordinary A/B and composition C reviews plus a different-context full Sol security review remain required at this exact head. Preserve prior B1/design/adverse reports unchanged.

---

Retained evidence file — 580-notification-instance-delta-ordinary-a-luna.md

# #580 notification instance-admin snapshot repair — ordinary delta review A

## Review record

- **Reviewed head:** `e3df4d7f77c4ab6907016244f5f804f045e70a39`
- **Comparison base:** `bd5f76d8e7e6a88c34791f94e38ad377ce5c1447`
- **Review coverage:** the complete six-file delta from the prior reviewed B1 head, plus spot-check of the unchanged native inbox identity/reach/key-clamp path needed to establish composition. Source files changed: the inbox list and single-read controllers/repository; test changes in notification repository, notification reach, and comment integration suites.
- **Independence:** independent of this delta's author and repair direction. This context did not author, direct, or remediate the instance-admin repair. The earlier B1 verdict from this same reviewer is prior evidence only; this report evaluates the new delta independently.
- **Model:** GPT-6, as exposed in this review context; no more specific variant/version was exposed. This report does not relabel the context as GPT-6 Luna.
- **Verdict:** **CLEAR — no blocking correctness or authorization finding in this delta.**

## Findings

No blocking findings.

The previous caller-supplied `canReadInstanceAlerts` boolean and controller-level admin lookups are removed. The repository now resolves the caller's identity within the existing repeatable-read transaction and derives alert access from `identity.side === "staff"` plus canonical `can(identity, "instance:admin", "instance", {})`. Per `docs/01-architecture/rbac.md`, `user.role = 'admin'` is the current instance-admin authority source and the resolver projects it into the instance-scope grant. The resolver also refuses inactive or banned identities. The canonical evaluator intersects role authority with a key's frozen capabilities, so a key whose subset lacks `instance:admin` cannot read audit-failure alerts even if its owner is an instance admin.

All four operations apply that decision in the operation's snapshot: list derives it before filtering `audit_write_failed` rows in SQL and before pagination; mark-one checks it inside the same transaction before update; read-all and clear-all derive it once inside their shared transaction and exclude unauthorized alerts from every keyset page before writes. The predicates remain scoped to the caller's `userId`; no administrative override or caller-controlled recipient was added. A previously completed role revocation is therefore visible to the operation's new repeatable-read snapshot and causes the alert to be hidden/preserved. The review does not require a stronger cross-transaction ordering than the documented current-authority snapshot.

The route passes the authenticated API key and its capability subset through the list controller as before; the change removes the controller's separate, non-transactional admin boolean. Native `work_item`/`comment` candidates still use the previously reviewed canonical recipient-person binding, live resource facts, customer visibility/private audience, reach and `work_item:read` decision. Task and approval legacy predicates remain intact.

The new regressions exercise current admin visibility, a foreign admin not seeing another user's alert, lost-admin behavior on all four operations, actual key-subset clamping at the list controller boundary, hidden alerts beyond one page, and authorized read/clear behavior over 100 rows. The API route's extraction of the real `c.get("apiKey")` is source-verified; the key-clamp test itself calls the controller/repository with an authenticated-key-shaped fact rather than sending a raw key through the full HTTP route.

One non-blocking maintenance nit: `findOwnNotificationType` remains exported and used in repository tests, but its JSDoc still says it is used "to hide admin-only alerts". Production single-read handling no longer uses that out-of-transaction lookup. This is documentation drift only; the route uses the new in-transaction check.

## Verification performed

- `git rev-parse HEAD` — `e3df4d7f77c4ab6907016244f5f804f045e70a39`.
- `git rev-parse <base>` — `bd5f76d8e7e6a88c34791f94e38ad377ce5c1447`.
- `git status --short` — clean before and after review checks.
- `git diff --check <base>...HEAD` — pass, no output.
- `pnpm exec biome check` on the six changed TypeScript files — no errors; five unused-variable warnings are in unrelated, unchanged cases of `work-item-comment.test.ts`.
- `pnpm --filter @taskdesk/api typecheck` — pass, exit 0; includes API, permissions, API-test, RLS-prototype, and approvals E2E TypeScript projects.
- PostgreSQL integration tests — not run; Docker/PostgreSQL was unavailable for this review. Browser/image/runtime checks were not run and are not claimed.

## Residuals

The new PostgreSQL regressions remain unexecuted in this environment. No runtime behavior, concurrency schedule, browser result, or image acceptance is claimed. This report clears only ordinary delta review A for the exact head above. The candidate still needs ordinary delta review B, fresh composition review C for the whole current composition, and a different fresh full Sol security review. This report does not accept #580, the broader carrier, or any other acceptance gate.

---

Retained evidence file — 580-notification-instance-delta-ordinary-b-luna.md

# #580 instance-alert snapshot repair — ordinary delta review B

**Reviewed head:** `e3df4d7f77c4ab6907016244f5f804f045e70a39`  
**Delta base:** `bd5f76d8e7e6a88c34791f94e38ad377ce5c1447`  
**Comparison base for the original candidate:** `1ee06c1e5f1a50532845756fcb0e0e628f10e125`  
**Reviewer:** GPT-6 (Codex subagent; exact served variant was not exposed in this context)  
**Role:** fresh independent ordinary delta reviewer B; I did not author, direct, or remediate the repair.  
**Scope:** closure of prior B1/B2 instance-alert findings; current authority, recipient and credential checks across all four inbox operations; changed tests.  
**Verdict:** **CLEAR — prior B1 and B2 are closed on this delta.** No new blocking source finding.

## Finding dispositions

- **B1 closed.** `bulkMutation` now resolves identity inside its repeatable-read operation and excludes `audit_write_failed` rows from both read-all and clear-all unless canonical `can(identity, "instance:admin", "instance", {})` passes for a staff identity (`inbox.repository.ts:229-255`). Thus a role-revoked/non-admin recipient preserves the alert.
- **B2 closed.** List computes instance-alert visibility from identity resolved through the transaction executor before candidate selection (`inbox.repository.ts:342-358`). Mark-one checks the alert against identity in the same transaction as its select and update (`:286-330`). The controller-level list and mark-one prechecks have been removed, eliminating their stale boolean/type decision windows.
- **Recipient and key constraints are preserved.** Selection remains scoped to `notification.user_id = userId`; the staff-side test precedes the canonical instance capability. `resolveInboxIdentity` retains credential kind and API-key capability subset. For session-only mutations, identity is resolved as the session credential. There is no caller-supplied admin boolean or cross-recipient override.

The repeatable-read snapshot is the authorization point. If role revocation commits before the operation's identity query establishes its snapshot, the resolved identity denies access. No broader protocol requiring revocations committed after that snapshot to retroactively cancel an in-flight operation is implied or needed here.

## Test review and remaining validation

The added PostgreSQL regressions exercise current admin visibility, foreign-admin isolation, role-loss preservation across list/mark-one/read-all/clear-all, API-key capability clamping, hidden-alert filtering before list paging, and authorized/unauthorized bulk operations spanning 105 alerts. The repository fixture now grants actual `user.role = "admin"` instead of trusting a caller-supplied visibility boolean. These cases directly address the prior findings and the pagination concern.

The PostgreSQL tests were **not run** in this review; authored test assertions are not execution evidence. The author reports typecheck and formatting checks, but this context independently ran only `git diff --check` (passed) and `pnpm exec biome check` on the six changed TS files (no errors; five existing unused-variable warnings in untouched portions of `work-item-comment.test.ts`). Database-backed integration execution remains a required pre-merge validation gate for these changed authorization paths. Serialization retry/fault injection and a concurrent revocation ordering reproduction remain untested; those are follow-up validation limits, not a new code finding, because the authority and resource checks are structurally within the same transaction snapshot and no stronger post-snapshot revocation ordering is specified.

## Exact checks and limits

- `git rev-parse HEAD` — `e3df4d7f77c4ab6907016244f5f804f045e70a39`.
- Read the exact delta, new integration cases, and author handoff; checked each prior finding against current source.
- `git diff --check bd5f76d8e7e6a88c34791f94e38ad377ce5c1447...e3df4d7f77c4ab6907016244f5f804f045e70a39` — passed.
- `pnpm exec biome check` on the six changed TS files — no errors, five existing warnings as described above.
- No PostgreSQL integration, Docker/image/runtime, browser, or concurrency test was run.

The original blocked report remains unchanged. This delta verdict does not count as ordinary composition C or as the separate fresh full GPT-6 Sol security review; both remain required at the exact head.

---

Retained evidence file — 580-notification-b4-composition-c-luna.md

# #580 notification / #785 batch — independent ordinary composition review C

**Verdict: CHANGES REQUIRED for composition order; no blocking source-code defect found in the reviewed notification/audit/workflow/scheduler composition.** The canonical query-ownership documentation in this candidate depends on a decision that is not in its accepted-main ancestry and remains in an open PR.

- **Reviewed head:** `e3df4d7f77c4ab6907016244f5f804f045e70a39`
- **Comparison base:** accepted-main `e9df2294fa580fd2885343bbef0cec28e81ead4c` (`git merge-base HEAD e9df2294` returns this exact SHA)
- **Composition ancestry:** #785 source parent `8fa653b2f60d1a516ba59877feaceedd747eac0b`; notification-preferences parent `d91c66d39ccf9e4b5272ed61135305c676bcea70`; composition merge `1ee06c1e5f1a50532845756fcb0e0e628f10e125`; native-reach repair `bd5f76d8e7e6a88c34791f94e38ad377ce5c1447`; current instance-alert repair `e3df4d7f77c4ab6907016244f5f804f045e70a39`.
- **Independence:** Fresh review context; I did not author, direct, or remediate this candidate or its repairs.
- **Model provenance:** GPT-6 review context. Platform introspection did not expose a more specific model variant/version, so this report does not claim a Luna or Sol identity.
- **Scope:** Read-only review against accepted main and all candidate parents. Covered the entire composed source diff relevant to the #785 notification, audit, workflow, and scheduler query-ownership batch; the #580 notification-preferences extraction; the two native inbox reach/instance-alert repairs; the changed query-ownership contracts; and conservation of unrelated accepted-main project/release/deployment controls. No source, Git, or PR state was changed.

## Blocking composition finding

### C1 — Canonical query-ownership docs cite an uncomposed conductor decision

`docs/01-architecture/multi-tenancy.md:58-62` states that the prior `forIdentity` contract is replaced and cites the “Conductor implementation decisions” entry in the 2026-10-15 decision log, PR #780. The cited entry is absent from the candidate's `docs/07-planning/decision-log.md` and from every candidate ancestor back to accepted main `e9df2294`. A live read during this review showed PR #780 still **OPEN**, head `4d7e2d0170e855b830a5f6ee98e1886871cac6b7`. The same decision governs D1–D4 in the changed canonical query-ownership contract at `docs/04-engineering/coding-standards.md:126-162`; the candidate also rewrites `multi-tenancy.md`, `security-model.md`, `monorepo-layout.md`, `tech-stack.md` and `ci-cd.md` around that contract.

The cited open PR is evidence that the decision exists, but it is not accepted-main authority or part of this candidate's ancestry. Therefore the candidate cannot yet make this contract canonical relative to its stated base. Compose the authentic #780 decision-log entry onto accepted main before this docs candidate, or defer/reword the canonical contract change so it does not depend on an unmerged authority. This is an integration-order blocker, not a finding that the code's repository functions need to be redesigned.

## Source review

No additional blocking source finding identified.

- **Inbox authorization and reach:** The earlier B1 gap is closed. Event-derived `work_item` and `comment` rows are checked against live resource facts, supported event/resource pairs, recipient person identity, customer visibility/participant scope, current `reaches(...)`, and canonical `can(..., "work_item:read", ...)`. List authorizes candidate pages before applying its response limit; mark-one and both bulk operations recheck inside repeatable-read transactions. Legacy task and approval predicates remain in all four paths. API-key list reads pass the authenticated key and its frozen capability subset into identity resolution; session-only mutation routes remain session-gated.
- **Instance alerts:** The prior list, single-read, and bulk-operation alert gates are all based on identity resolved in each operation transaction and canonical `can(identity, "instance:admin", "instance", {})`; alert filtering remains scoped to the caller's user id. Unauthorized bulk rows are excluded from every keyset page before update/delete. The current source removes the stale controller-side boolean path. The reported B2/current delta closure matches the code I inspected.
- **Fan-out and resource lookup:** Repository extraction keeps inbox/event/delivery writes on the producer transaction handle; recipient rows are locked before writes, deduplicated, and persisted under the existing event/person uniqueness rules. Native lookup batches live item/comment facts and private participants per page, filters deleted/archived parents, and fails closed on unsupported mappings or missing identity/resource facts. Approval and legacy task paths remain separate and retain their established reach predicates.
- **Audit:** The append sequence remains one transaction and one session in lock → head read → database clock → canonical hash → insert order. The extraction passes the same transaction executor to every statement; `project_id` remains stored but outside the accepted hash recipe. Chain verification still reads ordered rows using the lossless UTC timestamp representation.
- **Workflow:** Create/version/transition statements were moved to named repository functions. The create-version transaction passes its transaction handle to the max-number read and inserts; publish still performs the same version/person lookups before the existing transaction and performs publication, activation, and transition reads through that transaction. Validation queries retain their original project/type/state filters. I found no changed transition, publication or response contract.
- **Scheduler:** Lease claim/release SQL, database UTC clock use, due-date reminder filters and conflict-based idempotency are preserved in named repository functions. Session/legal-hold and reservation cleanup SQL remains intact. No lease, job key, channel, or notification activation was added.
- **Preferences:** `notification-preferences/repository.ts` and `service.ts` are byte-identical to the incoming `d91c66d3` versions. The extraction preserves the existing membership/project selection checks, reach-filtered rules, encrypted-secret normalization, webhook destination validation and response shaping; it adds no activation path.
- **Accepted-main conservation:** The candidate's merge base is exactly `e9df2294`; the source diff does not alter Docker/release/deployment or project-control files. Changes outside product source are the query-ownership contract corrections, an approval-reach module rename, and the preserved #764 review record. The candidate does not claim #580/#764/#780 or release/SIT acceptance.

## Checks and limits

- `git rev-parse HEAD` matched the assigned exact head; `git status --short --branch` showed no worktree changes before/after review.
- `git diff --check e9df2294..HEAD -- apps/api tests` passed.
- `pnpm --filter @taskdesk/api typecheck` passed (API, permissions, API-test, RLS-prototype and approvals E2E TypeScript projects).
- Confirmed the two extracted preference source files are identical to their incoming `d91c66d3` versions.
- No PostgreSQL integration tests, Docker/image, browser, or runtime checks were run. The added PostgreSQL regressions remain authored but unexecuted in this review context; no execution or acceptance result is inferred.
- The full documentation `git diff --check` still reports trailing whitespace and a final blank line in the inherited append-only `docs/07-planning/security-reviews/764-query-ownership.md`; the record was preserved and is not part of the product-source check above.

This report is ordinary full-composition review C for the exact head only. It does not count as the separate fresh full Sol security review, clear the #780 composition dependency, accept #580/#764, or establish runtime/browser, release, or stage acceptance.
