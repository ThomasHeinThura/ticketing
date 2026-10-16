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


---

# Current notification composition source clearance

**Reviewed head:** `d193f6836ad596ce68cd26c241020d7e03dc27ae`

Earlier sections are preserved source-bound history, including adverse verdicts and pending states at their original heads. This section records current source clearance, not merge acceptance. Original ordinary C's full report is repeated unchanged with the original reviewer's appended factual clarification: its surviving #780 finding is a merge-order prerequisite, not another technical source defect. No prerequisite is waived.

Current source preserves the whole notification/audit/workflow/scheduler/preference extraction and accepted maine9df. The later instance-resource family guard, serving-project organisation facts and meaningful direct/bulk customer regressions correct the preserved adverse security/test findings. Two independent ordinary reviews and a full independent Sol cleared the delivery-only extraction; successive strong independent deltas clear the project/test repair and precise persisted-JSON/HTTP type boundary. The final fresh independent FULL Sol context clears this exact whole composition. The conductor explicitly dispatched Luna for implementation/ordinary and Sol for security; the reports retain original runtime introspection statements. Design/adjudication contexts are not counted as independent approvers of their own designs.

Actual independent current checks include API typecheck, four focused unit files/56 tests, Biome and source diff checks. Actual structural analyzer7b on36 changed production files reports zero findings; this is a bounded branch scope, not a whole-program progress count, tenant theorem or claim that #580 is finished. The separate broad scan in the ordinary record is diagnostic-instance evidence on this partial stack and is not added to other batches. New PostgreSQL regressions remain UNRUN locally; current complete hosted CI, image build/boot/migrations/health and accepted #764/#780 composition remain prerequisites. No outbound/identity activation, release/SIT/recovery, issue or phase completion is claimed.

Sixteen subsequent authentic report versions follow the original seventeen records. The repeated C version includes its factual clarification; every original adverse report remains.

---

Subsequent preserved record 1: `580-notification-b4-composition-c-luna.md`; SHA-256 `52dcbb38f0f7cd36befafb91dd8895907a62c3215abf17f5d31cbaee0ccd335d`; 8688 original bytes.

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

## Factual scope clarification — 2026-10-16

The `CHANGES REQUIRED` verdict and C1 classify a **merge-order prerequisite**, not a source-code correction required at this head. My technical source review for the assigned notification/audit/workflow/scheduler composition is clear of blocking implementation findings. C1 does not prevent a separate fresh full Sol security inspection from proceeding on this exact head; that reviewer should account for the authentic #780 decision record in unaccepted carrier #791 and retain the accepted-main/composition prerequisite for any later merge. The original verdict and finding remain unchanged, and this clarification does not waive or satisfy any gate.


---

Subsequent preserved record 2: `580-notification-security-current-sol.md`; SHA-256 `1efed08b53466f82e8afe875c5eb33fe347d5cb5a1857be6b8e56c2311b7912c`; 6958 original bytes.

# #580 / #785 notification composition — independent full security review

**Verdict: CHANGES REQUIRED.** The current candidate retains an instance-resource inbox disclosure after administrator revocation, and a newly authored PostgreSQL regression has an assertion that contradicts the established 50-row list contract. The product head must be repaired and independently reviewed at the resulting exact head. The #780 decision provenance remains a separate merge-order prerequisite; this review does not clear it.

- **Reviewed product head:** `e3df4d7f77c4ab6907016244f5f804f045e70a39`.
- **Comparison base:** accepted-main `e9df2294fa580fd2885343bbef0cec28e81ead4c`.
- **Checkout head during review:** `e85a63b6a3ad90bb29346abb2ce7121ff184511f`. The sole intervening commit added `docs/07-planning/security-reviews/query-ownership-notifications-580.md` as mode `100644`; it changed no product source or tests. I inspected `git log -m --raw --no-renames e3df4d7..HEAD` and a clean worktree. This verdict covers the product tree at `e3df4d7`, not later source.
- **Independence and provenance:** Fresh reviewer context dispatched by `/root` with `fork_turns=none` for a full GPT-6 Sol security review. I did not author, direct, or remediate this candidate. The platform identifies this context as GPT-6 but exposes no runtime introspection of its exact Sol/Luna variant; the dispatch label is provenance, not independent model attestation.

## Blocking findings

### S1 — Instance-resource security alert survives loss of instance-admin authority

`docs/03-features/notifications.md` § Permissions requires every `resource_type = 'instance'` row to be returned only while the recipient has current `instance:admin` authority and is active staff. `apps/api/src/instance/users/index.ts:753` inserts an instance-resource row of `type = 'security_alert'` for each admin when an instance-admin grant occurs; other admins' `eventData` includes the affected user id. The inbox instead excludes and rechecks only `type = 'audit_write_failed'`: `apps/api/src/notification/inbox.repository.ts:205` filters that type for list/bulk, and line 306 checks that type for mark-one. `readableNativeRows` passes every non-work-item/comment row through unchanged. Thus an admin who later loses authority can list this previously issued instance row, mark it read, and bulk mutate it under their own user id. A key request without `instance:admin` can likewise list it. The row is self-scoped, so this is not a cross-user inbox read, but it violates the explicit current-authority condition and can disclose admin-operation metadata after revocation.

This type-only gate predates the extraction; the current candidate rewrites all four inbox paths and retains the gap. Repair the discriminator-level instance gate in the transactional selection and mark-one authorization. Preserve the operational `audit_write_failed` rule, and add a regression with a real `resourceType: 'instance', type: 'security_alert'` row across list, mark-one, read-all, clear-all, revoked admin, and API-key clamp. Do not treat only this notification type as the entire instance-resource class.

### S2 — New 105-row list assertion is deterministically false

`tests/api-integration/notification-task-reach.test.ts:248` inserts 105 alerts for an active admin, then expects `getNotifications(...)` to return 105. `apps/api/src/notification/inbox.repository.ts:354-375` stops after 50 visible rows. The prior list contract also used `limit(50)`. A PostgreSQL execution reaching this assertion must fail regardless of ordering. Keep the 105-row fixture and its read-all/clear-all assertions to prove bulk traversal; assert the list's 50-row cap separately. The new PostgreSQL regressions were authored but not executed, so this is an inspection-based deterministic finding, not a claimed observed test failure.

## Other reviewed security paths

I traced the candidate's notification, notification-preference, audit, workflow, and scheduler source against the accepted-main diff, approved notification/RBAC/work-item/comment/audit/workflow/background-job contracts, the full composition ordinary reports, and the authentic #780 D1–D4 record visible in the still-open PR diff. The native `work_item`/`comment` path requires own recipient, matching active person identity, supported resource/event pairing, live item/comment/project/workspace, customer visibility and private participants, then canonical `reaches` and `can(work_item:read)` on the same resolved identity. The list resolves the actual key subset and filters native rows before its 50-result cap; mark-one and bulk operations use repeatable-read snapshots, guarded row writes, bounded 40001 retries and keyset pages. Legacy task and approval SQL restrictions remain on all paths. I found no further blocker in those changed paths by source inspection.

The fan-out extraction still uses the producer's transaction for parent, inbox and child writes, locks recipients and preserves distinct-person and conflict behavior. Audit append still performs advisory lock, head read, database-clock read, hash construction and insert on one transaction handle; the chain verifier retains its lossless UTC time projection. Workflow publication/version statements preserve the existing caller transaction and filters; scheduler lease UTC clock, reminder idempotency and legal-hold predicates were relocated without an identified changed decision. Preference extraction preserves self/workspace/project predicates, encrypted-secret handling and public-destination validation; it adds no outbound activation. This assessment does not clear the separately documented notification pre-wiring gates for other resource discriminators, send-time delivery, digest or adapters.

## Checks, prerequisites and limits

- Independently ran `git diff --check e9df2294 e3df4d7 -- apps/api tests`: passed.
- Independently ran `pnpm --filter @taskdesk/api typecheck`: passed across its configured TypeScript projects.
- Inspected source, tests, changed-path diff, current Git ancestry and PR #780 diff. I did not run PostgreSQL integration, Docker/image/health, browser or SIT. No such result is inferred from earlier CI on PR #785's older remote head `8fa653b2f60d1a516ba59877feaceedd747eac0b`.
- PR #780 remains open at `4d7e2d0170e855b830a5f6ee98e1886871cac6b7`; its D1–D4 decision entry is authentic but not in this candidate's accepted-main ancestry. Ordinary composition C's original `CHANGES REQUIRED` merge-order verdict remains intact. #764 and #780 acceptance, fresh exact-head required checks, image/runtime proof and any SIT/release acceptance remain pending. No waiver, producer activation, #580 completion, or merge approval is given.

**Disposition:** Changes required at this product head. Preserve both findings and this adverse report when preparing one bounded repair; a new source SHA requires current-head review at the applicable tier.


---

Subsequent preserved record 3: `580-notification-instance-family-repair-luna.md`; SHA-256 `e02de07ba937fc10c63c21a1292a72c3f80baa4bcf4a073e4b4662cbfb458788`; 3695 original bytes.

# #580 instance-resource notification authorization repair — author handoff

**Candidate:** `e9381299ec2e37ab35fa31d5104d15ab577b47bf` (`fix(notification): gate all instance resource alerts`)

**Worktree / branch:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, `codex/query-ownership-580-b4`. Parent is `e85a63b6a3ad90bb29346abb2ce7121ff184511f`; that head adds only the retained #580 composition review note over the previously reviewed product commit `e3df4d7f77c4ab6907016244f5f804f045e70a39`. The product history and all earlier review reports are preserved. Tree is clean after commit. No push or PR change was made.

## Findings addressed

The current inbox discriminator is now structural: `requiresInstanceAdmin()` returns true for every row whose `resourceType` is `instance`, while preserving the existing gate for all legacy `audit_write_failed` rows (`apps/api/src/notification/inbox.repository.ts:162-169`). Single-row mark-read evaluates that predicate and canonical staff/`instance:admin` authority in the operation transaction (`:319-326`). List and both bulk operations share the candidate-page filter; for a non-admin it excludes `resourceType = 'instance'` and `type = 'audit_write_failed'` before keyset paging or mutation (`:201-222`). The resource predicate explicitly includes `resourceType IS NULL` so ordinary null-resource notifications retain their previous visibility under SQL three-valued logic. The actual identity and API-key subset are still resolved within the transaction by the preceding e3 implementation.

Added a real producer-shaped `resourceType: 'instance', type: 'security_alert'` fixture and regression coverage for active-admin list/mark/read-all/clear-all, API-key clamp, foreign-admin recipient denial, then loss of admin authority across list/mark/read-all/clear-all (`tests/api-integration/notification-task-reach.test.ts:124-141,230-300`). The existing 105-row fixture and all read-all/clear-all checks remain; its list assertion now expects the established 50-row response cap (`:330-356`). No producer, event mapping, capability, schema, or activation path changed.

## Validation and limits

- `pnpm --filter api typecheck` — passed.
- Biome formatting and check — no errors; five pre-existing unused-variable warnings remain in `work-item-comment.test.ts`.
- `git diff --check` — passed.
- PostgreSQL integration, Docker, browser, and checker scans were not run; the owner has not authorized database use. The new database regressions are authored but unexecuted. This handoff makes no runtime pass claim.
- The known query-checker fragment-classification issue remains a separate residual; no checker proof is claimed here.

## Review provenance retained

The full Sol adverse report remains unchanged at `580-notification-security-current-sol.md`; both findings were CHANGES REQUIRED at e3/e85 and are addressed by this candidate, pending independent review. Earlier reports and the prior `580-notification-instance-snapshot-repair-luna.md` remain untouched.

Composition C's clarification in `580-notification-b4-composition-c-luna.md:46` is also retained: its CHANGES REQUIRED/C1 is a #780 merge-order prerequisite, not a source-code correction; its technical source review was clear, and C1 does not prevent a separate fresh Sol source review. The authentic #780 decision remains in unaccepted carrier #791, so the merge prerequisite remains open and is not waived or satisfied by this source repair.

Fresh ordinary delta review and a different-context full Sol review remain required at this exact candidate head. No #580/#764/#780 acceptance, completion, merge readiness, or held-producer activation is claimed.


---

Subsequent preserved record 4: `580-notification-instance-family-ordinary-luna.md`; SHA-256 `a9a7f43165e5f18817c7dbb5cdb473699d57377119622b766809e54e73612404`; 4367 original bytes.

# #580 instance-resource notification authorization repair — ordinary delta review

**Reviewed head:** `e9381299ec2e37ab35fa31d5104d15ab577b47bf`  
**Comparison base:** `e3df4d7f77c4ab6907016244f5f804f045e70a39`  
**Changed product paths:** `apps/api/src/notification/inbox.repository.ts`; `tests/api-integration/notification-task-reach.test.ts`  
**Independence:** Fresh review context; I did not author, direct, or remediate this candidate.  
**Model:** GPT-6, as identified by this runtime. The runtime does not expose a Luna/Sol variant, so I cannot attest the requested Luna variant specifically.  
**Verdict:** **CLEAR for the bounded source delta.** I found no blocking or non-blocking source defect in the reviewed repair.

## What I checked

- Read the repository workflow and operating guide, the notifications feature contract, the relevant API design statement that inbox reads and mutations require current resource reach, the current producer code, the previous full Sol findings, the author handoff, and the complete product diff from the stated base.
- Verified the producer at `apps/api/src/instance/users/index.ts` writes `type: "security_alert"`, `resourceType: "instance"`, and `resourceId: "singleton"`; its title/content/eventData match the new fixture. Verified the audit failure producer retains the legacy `type: "audit_write_failed"` discriminator and also uses `resourceType: "instance"`.
- S1 is closed structurally: `requiresInstanceAdmin()` recognizes the entire `resourceType === "instance"` family and retains the legacy `audit_write_failed` condition. Single-row mark-read checks that predicate against the canonical staff identity and `instance:admin` evaluator inside the same repeatable-read transaction. Listing and both bulk operations exclude both the instance resource family and legacy audit-failure shape in candidate SQL before pagination or mutation when the identity lacks authority. Authorized identities continue to see/process both classes.
- S2 is closed: the 105-row admin fixture remains for bulk traversal, while its list expectation is 50, matching the existing response cap and loop bound. Bulk read and clear assertions still verify all 105 rows.
- Checked the SQL null case against the schema: `notification.type` is `NOT NULL`, and the unauthorized-row resource predicate explicitly accepts `resource_type IS NULL` (`IS NULL OR <> 'instance'`). Therefore ordinary null-resource rows do not get lost through SQL three-valued logic. The legacy type predicate also cannot drop a row due to a null type.
- Reviewed the new regression for producer-shaped instance/security-alert records across admin list/single-read/bulk-read/bulk-delete, API-key capability clamp, foreign-recipient isolation, and loss of admin authority with preservation across all four operations. This is source/assertion inspection only; the database-backed regression was not run.
- Confirmed the change does not alter routes, response/error mapping, identity resolution, API-key clamp, resource producer activation, transaction isolation, pagination order, or candidate page cursor advancement. The product delta is confined to the two stated paths.

## Checks actually run

- `git diff --check e3df4d7f77c4ab6907016244f5f804f045e70a39..e9381299ec2e37ab35fa31d5104d15ab577b47bf -- apps/api/src/notification/inbox.repository.ts tests/api-integration/notification-task-reach.test.ts` — passed.
- Verified exact `HEAD` and comparison base with `git rev-parse` before report preparation.
- Read-only source and regression-assertion inspection as described above. I did not run tests, typecheck, Biome, PostgreSQL, Docker/image, browser, or runtime checks in this review context. Author-reported typecheck/Biome results are not independently claimed here.

## Findings and limits

No blocking or non-blocking findings in this bounded delta. The prior Sol S1 and S2 findings are closed by the source and retained regression assertions. PostgreSQL execution remains necessary to establish runtime behavior. This verdict does not satisfy or waive #764/#780 merge prerequisites, composition review, the required current-head full Sol review, CI, deployability, browser evidence, or any #580 completion/merge acceptance. The requested Luna model variant was not introspectable in this context; the recorded identity is GPT-6 as actually exposed.


---

Subsequent preserved record 5: `580-notification-family-security-current-sol.md`; SHA-256 `c061be8f2b70dc23ae1fd8822813d62dbeef3e707642ddc3ed6dd7a3ff7ec4a9`; 6617 original bytes.

# #580 / #785 notification composition — independent current-head full security review

**Verdict: CHANGES REQUIRED.** The structural instance-resource repair closes the prior S1 and S2 source findings, but the current composition passes the workspace organisation into the canonical customer reach evaluator for native work-item and comment inbox rows. A customer-serving project's organisation is a distinct persisted binding, so valid customer notifications can be hidden. This candidate needs a bounded repair and current-head independent review. This is source inspection, not PostgreSQL runtime acceptance.

- **Reviewed head:** `e9381299ec2e37ab35fa31d5104d15ab577b47bf` (clean worktree at inspection).
- **Comparison base:** accepted `main` `e9df2294fa580fd2885343bbef0cec28e81ead4c`; focused repair base `e3df4d7f77c4ab6907016244f5f804f045e70a39` (intervening `e85a63b6` is a retained review note).
- **Role and independence:** fresh independent full security review context dispatched by `/root` with `fork_turns=none`, labelled GPT-6 Sol by the dispatch. I did not author, direct, or remediate this candidate. The runtime reports GPT-6 but does not expose the exact Sol/Luna variant for independent attestation; the dispatch tier and runtime identity are stated separately.

## Blocking finding

### S3 — Native inbox batch loader uses workspace organisation instead of the project's customer binding

`apps/api/src/notification/repository.ts:85,120` selects `schema.workspaceTable.organisationId` for both work-item and comment batch resources. `readableNativeRows` then sends those facts through `canReadNativeInboxCandidate`, which calls canonical `reaches(identity, { organisationId: resource.organisationId, ... })` in `native-inbox-reach.ts:40-61`. For a customer, `reaches` accepts the resource only if that id equals the customer's organisation (`packages/permissions/src/evaluator.ts:372-378`). But the approved project contract binds a customer-serving project at `project.organisation_id` while its workspace belongs to the internal organisation (`docs/03-features/projects-and-engagements.md:101-109`). The existing single-resource notification resolver reads `p.organisation_id` in `repository.ts:217`, and strict route policy reads `project.organisation_id` in `strict-policy-enforcement.ts:341`.

Concrete path: put a customer-serving project for organisation C under the required internal workspace I, issue a supported `work_item` or public `comment` notification to an active customer in C, and list or mark it. The batch facts supply I; the customer's canonical reach contains C, so list omits the row, direct mark returns 404, and read-all/clear-all leave it unchanged even though the customer still reaches the referenced item. The CA-12 integration fixture already demonstrates that project/customer binding can differ from the workspace (`work-item-comment.test.ts:1433-1482`), but it checks notification creation, not inbox read. The new native inbox tests in `notification-task-reach.test.ts` cover staff identity for native rows and therefore do not catch this case. This is a current-reach authorization decision made from the wrong tenant attribute. In the normal invariant it over-suppresses; the review makes no claim of an observed cross-tenant disclosure.

Repair both batch projections to use `schema.projectTable.organisationId`, then test an actual customer session/identity on a customer-serving project in an internal workspace for both `work_item` and public `comment` rows across list, direct mark and bulk behavior. Keep the foreign customer and private/internal audience denials in the same regression.

## Prior findings and reviewed boundaries

- **Prior S1 closed in source:** `requiresInstanceAdmin` now covers all `resourceType === "instance"` rows plus legacy `type === "audit_write_failed"`; mark-one rechecks current active staff and `instance:admin` inside the transaction. List and both bulk operations exclude that complete family in candidate SQL before paging and mutation when authority is absent, including a null-safe resource predicate. The new fixture matches the actual `instance/security_alert` producer shape and covers active admin, revocation, API-key clamp, foreign recipient, and all four operations. PostgreSQL execution remains pending.
- **Prior S2 closed in source:** the 105-row fixture retains bulk read/clear verification while the list assertion now expects the established cap of 50.
- Traced self-scoped recipient selection, native person binding and event mapping, live item/comment/project/workspace lookup, public/internal comment audience, private participant restriction, canonical `reaches` plus `can(work_item:read)`, API-key capability subset, and keyset paging before the 50-row result limit. Single and bulk writes stay in repeatable-read transactions with guarded row updates and bounded 40001 retry. The new S3 finding is in that native resource-fact projection.
- Reviewed the accepted-main composition's notification fan-out, preferences, audit, scheduler, workflow and executor ownership paths against the existing independent ordinary and prior full security reports. No additional source blocker was identified in those paths. Fan-out remains in the producer transaction, audit append keeps lock/head/clock/hash/insert on its handle, and no held outbound activation is introduced. The source-only review does not close the documented pre-wiring gates for other resource types, delivery/digest/adapters or #580 completion.

## Checks and limits

- Independently verified `HEAD`, ancestry and clean worktree. `git diff --check e9df2294fa580fd2885343bbef0cec28e81ead4c..HEAD -- apps/api tests` passed.
- Read the accepted mission/workflow, notification and project-binding specifications, the product diff and current source, actual producer and integration fixtures, prior adverse full Sol report and fresh ordinary repair review. I did not run PostgreSQL, Docker/image/health, browser, SIT or CI; no pass is inferred from author or older remote-head checks. I did not edit product source.
- #764 and #780 remain unaccepted merge prerequisites. The #780 D1–D4 decision provenance is in a separate unaccepted carrier and is not supplied by this review. The candidate is not merge-ready; this report grants no gate waiver, producer activation, runtime acceptance, or stage completion.

**Disposition:** CHANGES REQUIRED for S3 at this exact head. Preserve this finding and prior adverse reports; independently review the repair and run the pending database-backed regressions before asserting runtime behavior.


---

Subsequent preserved record 6: `580-notification-project-binding-repair-luna.md`; SHA-256 `7f66d61e06c71b18ee7dd3ba7748a33ca8701161a6d0ad8d524b4edc370f0222`; 2986 original bytes.

# #580 / #785 notification project-binding repair — implementation handoff

**Result:** source repair committed; independent current-head review and PostgreSQL execution remain outstanding.

- **Branch:** `codex/query-ownership-580-b4`
- **Parent reviewed head:** `e9381299ec2e37ab35fa31d5104d15ab577b47bf`
- **Repair commit / exact candidate head:** `3f93514ebf9f90d0878e299676e7989da3704d3c`
- **Worktree:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`
- **Commit scope:** 2 files, 222 insertions, 2 deletions; clean worktree after commit. No push or PR action performed.

## Change

The work-item and comment projections in `findCurrentNotificationResources` now use the joined `project.organisation_id`. This matches the canonical single-resource notification resolver and the approved customer-serving project binding: workspace organisation I is internal, while a project beneath that workspace may serve customer organisation C.

One database-backed API integration case now creates that I/C split and actual customer and foreign-customer identities/sessions. Across nine planted inbox rows it covers customer listing of a work item and public comment, direct mark, bulk read and clear, and denial of foreign-customer, internal-comment and private-item rows under list/direct/bulk operations. Existing instance-resource family, API-key clamp, transaction and paging guards were left untouched.

## Verification

- `pnpm --filter @taskdesk/api typecheck` — passed across API, permission, test, RLS prototype and approvals E2E TypeScript projects.
- `pnpm exec biome check apps/api/src/notification/repository.ts tests/api-integration/work-item-comment.test.ts` — no errors; five existing unused-variable warnings elsewhere in `work-item-comment.test.ts`.
- `git diff --check` — passed before commit.
- PostgreSQL integration case — **not run**. This lane was assigned with no Docker/PG runtime available; no database behavior is claimed from source/typechecking alone.
- No browser, Docker image, CI or hosted status checks were run.

## Model provenance and residuals

The prior adverse report identifies its reviewer dispatch as GPT-6 Sol, while explicitly noting runtime telemetry exposed only GPT-6 and could not attest the Sol variant. For this implementation lane, the task dispatch did not include explicit model-selection arguments. The active system reports Codex/GPT-6; the exact Luna/Sol variant is not exposed here, so no Luna label is asserted. This is implementation evidence, not independent review evidence.

The repair requires a fresh independent review at exact head `3f93514ebf9f90d0878e299676e7989da3704d3c`, and the new PG integration case still needs execution in an available test database. The prior full Sol finding remains preserved at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/580-notification-family-security-current-sol.md`; the root/conductor owns any review-note publication and further acceptance steps.


---

Subsequent preserved record 7: `580-notification-project-binding-ordinary-luna.md`; SHA-256 `f71e1e4762de297f75e454479092dde9282fda5c8baca7bdf1353f1e55409bf7`; 4482 original bytes.

# #580 / #785 notification project-binding repair — ordinary review

**Verdict: CHANGES REQUIRED.** The two query projections correctly switch native work-item and comment reach facts to the serving project's organisation, and the new fixture establishes the intended customer/project/workspace split. The positive direct-mark assertion is not behaviorally verified, and the internal-comment denial is not checked after either bulk mutation. These leave required operation coverage unproven.

- **Reviewed head:** `3f93514ebf9f90d0878e299676e7989da3704d3c`
- **Comparison base:** `e9381299ec2e37ab35fa31d5104d15ab577b47bf`
- **Worktree:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, branch `codex/query-ownership-580-b4`; clean at inspection.
- **Role and independence:** Fresh ordinary-review context dispatched by `/root`; I did not author, direct, or remediate this change. The task dispatch specified a strong Luna-tier ordinary review. Runtime telemetry available in this context identifies Codex/GPT-6 but does not expose the exact Luna variant or spawn arguments, so I do not claim those as runtime-observed facts.

## Scope and findings

The product delta is limited to `apps/api/src/notification/repository.ts` and `tests/api-integration/work-item-comment.test.ts`. Both native resource queries now select `schema.projectTable.organisationId` from their existing project join. That is consistent with the approved creation-time binding in `docs/03-features/projects-and-engagements.md` and the existing canonical notification resolver; the workspace is internal while a customer-serving project may be bound to a customer organisation.

The new integration case creates two actual customer organisations and identities, verifies the workspace organisation differs from the serving organisation, binds the project to the serving organisation, sets organisation visibility, and creates real public and internal comments. It exercises the authenticated customer notification list, direct mark route, read-all and clear-all routes, plus foreign-customer and private-resource denial paths. The repository change is narrow and matches the reported S3 source defect.

### Blocking test-coverage findings

1. **Positive direct mark does not assert the mutation.** At test lines 753–760 the customer direct-mark response is checked only for status 200, then read-all runs before the database state is inspected at lines 761–771. A handler that returns 200 without marking the row would still pass because read-all can set it afterward. Read the row immediately after the direct request and assert `isRead === true` before invoking read-all; separately leave read-all to prove its own effect.

2. **Internal-comment retention is not verified through either bulk operation.** `customerInternal` is asserted absent from list, but remains present during read-all and clear-all. The post-read assertions cover only the reachable item/public-comment rows, and the post-clear assertion covers only newly planted reachable rows. A regression that lets bulk read or clear mutate the internal-comment notification would pass. Assert that `customerInternal` remains unread after read-all and exists after clear-all (and, if desired, directly mark it and assert 404) so both bulk paths prove the audience denial.

These are test-oracle gaps in the specifically requested positive direct-mark and internal-denial/bulk coverage. PostgreSQL integration execution remains necessary before runtime behavior is accepted.

## Checks and limits

- `git diff --check e9381299ec2e37ab35fa31d5104d15ab577b47bf...HEAD -- apps/api/src/notification/repository.ts tests/api-integration/work-item-comment.test.ts` — passed.
- `pnpm exec biome check apps/api/src/notification/repository.ts tests/api-integration/work-item-comment.test.ts` — no errors; five existing unused-variable warnings elsewhere in the test file (lines 1022, 1095, 1288, 1417, 1891); none points into the added case.
- `pnpm --filter @taskdesk/api typecheck` — passed (five TypeScript project configurations). PostgreSQL integration was not run. No Docker/image, browser, SIT or hosted CI check was run.
- No product files were edited. The prior adverse full Sol report and implementation handoff remain preserved at their assigned evidence paths.

**Disposition:** CHANGES REQUIRED for the test-oracle gaps above. This review does not grant runtime acceptance, merge readiness, gate waiver, or stage completion.


---

Subsequent preserved record 8: `580-notification-project-binding-test-repair-luna.md`; SHA-256 `968a581320fafa5804a492ea1c9ee6a8f652545ab42af4e22d41335fd1d314f7`; 1706 original bytes.

# #580 notification project-binding test-oracle repair

**Result:** requested assertion gaps fixed and committed. The database-backed regression has not been executed.

- **Branch:** `codex/query-ownership-580-b4`
- **Base:** `3f93514ebf9f90d0878e299676e7989da3704d3c`
- **Commit / exact current head:** `7e97f08265a57fa804bbd63d4d032b410d62e127`
- **Commit scope:** test-only; one file, 43 insertions and 2 deletions. The project organisation projections are unchanged. Worktree clean after commit.

The customer regression now reads persisted `isRead` immediately after direct marking of both the work-item and public-comment notifications, before read-all runs. A separate fresh public-comment notification proves read-all changes its state. The internal-comment notification is checked unread after read-all and is required to remain present and unread after clear-all.

**Validation:** `pnpm --filter @taskdesk/api typecheck` passed. Targeted Biome check had no errors and retained five existing unused-variable warnings outside the added case. `git diff --check` passed. PostgreSQL integration was not run because no Docker/PG runtime is available; no runtime pass is claimed. No Docker, browser, CI, push, PR, or review-note action was performed.

This author context was instructed by `/root` to make the bounded test fix. The system identifies the runtime as Codex/GPT-6; no explicit Luna/Sol model arguments were available in this repair dispatch, and exact variant is not attested. This is implementation evidence, not an independent review. The original review report remains at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/580-notification-project-binding-ordinary-luna.md`.


---

Subsequent preserved record 9: `580-notification-project-binding-current-ordinary-luna.md`; SHA-256 `a63b3f033e02e7f372969f2137e51300b1adb54950a82a40ec609bfe47dec843`; 5179 original bytes.

# #580 / #785 notification project-binding repair and delivery composition — ordinary review

**Verdict: CLEAR for the assigned native inbox authorization repair, its repaired integration-test oracle, and the exact reviewed delivery extraction composition.** The earlier positive direct-mark and internal-comment bulk-operation oracle gaps are closed. The current source retains the project's customer organisation in both native notification resource projections. The delivery files at this merge head are byte-identical to their separately reviewed parent. PostgreSQL behavior and whole-batch query ownership completion remain unverified.

- **Reviewed head:** `00244aad514335ada83dca90d912f5ae49a1f398`
- **Parents:** test repair `7e97f08265a57fa804bbd63d4d032b410d62e127`; delivery extraction `29d795dd5a1672d3527dd525c9d94bd4786fc5bc`.
- **Comparison base:** `e9381299ec2e37ab35fa31d5104d15ab577b47bf`.
- **Worktree:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, branch `codex/query-ownership-580-b4`; exact head and clean status confirmed.
- **Role and independence:** Fresh ordinary-review context assigned by `/root`; I did not author, direct, or remediate these changes. The assignment requested a strong ordinary review. Runtime identity exposes Codex/GPT-6 but not the precise Luna variant or dispatch arguments, so I do not claim a more specific runtime-observed model label.

## Review

The S3 fix remains present in `apps/api/src/notification/repository.ts`: both work-item and comment batch-resource selects use the joined `project.organisationId`. Current content hash matches the repaired branch parent exactly. This follows the approved project binding contract: a project may serve a customer organisation while residing in a workspace belonging to the internal organisation.

The test repair closes both findings from my first review. It checks the persisted `isRead` value for direct mark of the work-item notification and the public-comment notification immediately after each direct request, before read-all can mask a failed direct write. It plants a separate reachable comment notice to verify read-all independently. It checks the internal-comment notice remains unread after read-all, then remains present and unread after clear-all; the clear assertion also proves the newly planted reachable rows were deleted. Foreign-customer list/direct/bulk denials and private-resource list/direct/bulk denials retain explicit row-state assertions. The fixture uses distinct real database organisation/person/user rows, asserts workspace/customer organisation separation, creates live comments through the API, and calls the notification routes under authenticated customer sessions. I found no vacuous fixture or assertion in these repaired oracles.

The delivery composition is exactly conserved: both `delivery.repository.ts` and `delivery.ts` blob ids at `00244a…` equal their blobs at separately reviewed `29d795dd…`. The merge has exactly the expected two parents and tree recorded in the supplied composition proof. `origin/main` is an ancestor. I checked the delivery extraction reports and their authorization analysis: the task recipient reach checks and provider-time rechecks remain in the service; workspace lookup retains its recipient reach predicate; notification/user/preference reads remain keyed to the recipient. The extraction introduces no transaction handle, provider wiring, outbound activation, or new authority path. This current merge adds no delivery-code delta beyond the already-reviewed extraction.

## Checks and scope limits

- Exact head, parents, tree, clean worktree and changed path list checked. `git diff --check e9381299ec2e37ab35fa31d5104d15ab577b47bf..HEAD` passed.
- `pnpm exec biome check` on the notification repository, delivery service/repository, and integration test completed with no errors. It reports five pre-existing unused-variable warnings elsewhere in `work-item-comment.test.ts`; none is in the added test.
- Focused delivery/ownership unit tests passed: **2 files / 6 tests** (`delivery-ssrf.test.ts` and `query-ownership-repository.test.ts`). These do not execute PostgreSQL predicates.
- `pnpm --filter @taskdesk/api typecheck` completed successfully across all five TypeScript project configurations.
- PostgreSQL integration, Docker/image/health, browser, hosted CI and SIT were not run. No database/runtime acceptance is claimed.
- The separately supplied current-head scoped-checker result reports 3 unresolved exported repository shapes in `audit/repository.ts`, `notification/inbox.repository.ts`, and `workflow/repository.ts`. These are existing typing/query-ownership residuals outside this two-file delivery composition and the S3 binding repair; I did not introduce casts or expand review scope to claim the batch query gate clean. #580 batch completion remains unclaimed.

**Disposition:** CLEAR for this exact repair and two-file delivery composition, subject to the explicit runtime and scoped-checker residuals above. This report does not claim PostgreSQL acceptance, whole-batch query ownership completion, outbound activation, merge readiness, or stage completion.


---

Subsequent preserved record 10: `580-notification-delivery-query-extraction-luna.md`; SHA-256 `a3a487bdaedf34bec36c5a8f0c71b4f6fbe1fbb758d901fc072abde80edea525`; 4685 original bytes.

# #580 notification delivery query extraction — author record

- **Base:** `e9381299ec2e37ab35fa31d5104d15ab577b47bf`
- **Head:** `29d795dd5a1672d3527dd525c9d94bd4786fc5bc`
- **Branch:** `codex/query-ownership-580-notification-delivery`
- **Worktree:** `/Users/heinthura/.codex/worktrees/580-notification-delivery-query-extraction/Ticketing.v2`
- **Commit:** `29d795dd5a1672d3527dd525c9d94bd4786fc5bc` (`refactor(api): extract notification delivery queries`)
- **Scope:** Exactly `apps/api/src/notification-preferences/delivery.ts` and new `apps/api/src/notification-preferences/delivery.repository.ts`.
- **Stack dependency:** Exact supplied base is the unaccepted #785 composition including its native-auth repair. This is an explicit source dependency; no standalone PR, push, merge, or acceptance is claimed. Native-auth source was frozen for this work.

## Change

Moved the six existing Drizzle reads and the workspace reach SQL predicate out of `delivery.ts` into named async functions in `delivery.repository.ts`: notification lookup, task context, reachable workspace context, user projection, user preference, and workspace rule with selected projects. Existing joins, predicates, projections, ordering/limit, relation loading, return shapes, call order, and orchestration remain as they were. Repository functions await statements and return materialized rows; no transaction was present or introduced. Delivery content, error codes/messages, enum values, credential handling, provider hooks, timing, redaction, and SSRF behavior were left unchanged. The application module now calls the repository boundary and contains no Drizzle imports or statement construction.

## Verification

- `pnpm install --frozen-lockfile` — passed; no lockfile or dependency change.
- Built existing workspace prerequisites: `@taskdesk/domain`, `@taskdesk/permissions`, and `@taskdesk/email` — passed.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json` — passed after prerequisite workspace builds. The first attempt before those builds failed with unresolved workspace package exports; no source correction was needed for that setup failure.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/notification-preferences/delivery-ssrf.test.ts` — **1 file / 4 tests passed**.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/permissions/query-ownership-repository.test.ts` — **1 file / 2 tests passed**.
- `pnpm exec biome check apps/api/src/notification-preferences/delivery.ts apps/api/src/notification-preferences/delivery.repository.ts` — passed.
- Targeted structural checker, imported from the reviewed checker source at `/Users/heinthura/.codex/worktrees/query-checker-580/scripts/ci/check-queries.mjs` (source `7b5c54279095f0384e71964adc5bf31f979d8829`), TypeScript-resolved on exactly the two changed files: **2 files, zero findings**. This is targeted checker evidence only; it does not activate or claim the repository `check:queries` command.
- `git diff HEAD^ HEAD --check` — passed; worktree clean after commit.

The initial focused Vitest attempt before building workspace packages failed during module resolution for `@taskdesk/email` and ran zero tests. It was rerun after prerequisite builds and passed as recorded above. An initial API typecheck similarly failed on unresolved `@taskdesk/*` exports and passed after those builds.

## Not run

No PostgreSQL integration, Docker/image build, browser flow, full test suite, push, PR, merge, notification feature acceptance, or stage acceptance. The interactive checks require external/runtime setups and are outside this bounded source-conversion task. The existing `check:queries` package command remains unwired at the supplied base; the reviewed checker was run only through its two-file typed API as described above.

## Preserved semantic residuals

This work only relocates query ownership. The pre-existing `deliverNotification` path still uses the legacy `notification` row and per-user preference/rule model, handles only `task` and `workspace` context mappings (other resource types resolve to null), retains its existing task and workspace reach behavior, and contains email/ntfy/Gotify/webhook provider hooks. It has not been converted to the durable `notification_delivery` worker protocol or enabled as an outbound producer/worker. The Notifications spec's pre-wiring gates and outbound activation holds remain open; this change does not claim to close them. No legacy identity, reach, quiet-hours, destination, title/header, attempt, reservation, deadline, retry, or channel behavior was repaired or newly activated.


---

Subsequent preserved record 11: `580-notification-delivery-ordinary-a-luna.md`; SHA-256 `fabf67d7a37a294fa2db259d5f2dff257cf9022f858b4f760aa30fef7806fd78`; 3582 original bytes.

# Ordinary review A — notification delivery query extraction

- **Verdict:** CLEAR for the two-file extraction delta; no blocking delta finding.
- **Reviewed head:** `29d795dd5a1672d3527dd525c9d94bd4786fc5bc`
- **Comparison base:** `e9381299ec2e37ab35fa31d5104d15ab577b47bf`
- **Scope:** complete diff of `apps/api/src/notification-preferences/delivery.ts` and new `apps/api/src/notification-preferences/delivery.repository.ts`.
- **Independence:** fresh reviewer context; did not author, direct, or remediate the candidate.
- **Model identity/provenance:** GPT-6 session. The runtime did not expose a Luna/Sol variant or model-dispatch arguments to this context; I do not claim a more specific dispatch label.

## Review

The delta moves six existing selects/findFirst calls into `delivery.repository.ts`. The caller still supplies the same notification id, recipient user id, resource id, and resolved workspace id; the service retains the same ordering and conditionals. The task path checks `userCanReachTask(notification.userId, resourceId)` before loading context and repeats the reach check before building/sending the payload and in the task-provider `canSend` callback. The workspace query retains its `reachableWorkspacePredicate(workspaceTable.id, userId)`. User, preference, and workspace-rule lookup predicates remain keyed to the notification recipient; selected-project filtering is unchanged. No `actualExecutor`/transaction handle was present in the old query path, and this extraction introduces none; all six repository methods await their query and return materialized results rather than a query builder.

Provider dispatch and surrounding behavior are unchanged: the 15-second fetch timeout and manual redirect policy, public-destination check, notification payload projection, current task-reach rechecks, preference secret decryption, channel enablement, and email/ntfy/Gotify/webhook calls remain in the service with the same gates. The extraction adds no provider call, activation, secret handling, timing change, or result-shape change. This verdict does not authorize any inherited held outbound activation.

One pre-existing scoping limitation remains visible: `findDeliveryTaskContext(resourceId)` itself selects task/project/workspace context by task id without a recipient or tenant predicate. The service's preceding recipient reach check is unchanged from the base, so this is not a semantic regression introduced by the extraction. It should be assessed as a separate query-scoping correction if the owning lane addresses it; this report does not treat the known base-head inbox project/organisation issue as a candidate finding.

## Checks actually run

- `git rev-parse HEAD` — exact head matched the assigned SHA.
- `git diff --name-status` and complete two-file diff — only the assigned files changed (`delivery.repository.ts` added; `delivery.ts` modified).
- `git diff --check e9381299ec2e37ab35fa31d5104d15ab577b47bf..29d795dd5a1672d3527dd525c9d94bd4786fc5bc` — passed.
- `pnpm --filter @taskdesk/api typecheck` — completed successfully (all five configured TypeScript projects).
- No unit/integration, provider, browser, Docker, or PostgreSQL runtime tests were run.

## Residuals

This is a bounded source and typecheck review of an unaccepted stacked base. It does not establish runtime delivery behavior, provider acceptance, integrated behavior on accepted `main`, or authorize the held outbound activation. The repository has an independently tracked base-head workspace/inbox reach issue; it is outside this delta verdict.


---

Subsequent preserved record 12: `580-notification-delivery-ordinary-b-luna.md`; SHA-256 `5c9dd5718e293268b0382964adaef99e575c43e4427b7079e0a72539143b79bf`; 3432 original bytes.

# Independent ordinary review — notification delivery query extraction

**Verdict:** CLEAR for this bounded extraction, with a non-blocking coverage note.

**Reviewer identity:** Codex GPT-6 family; exact serving variant is not exposed in this context. Independent ordinary reviewer B; I did not author, direct, or remediate the change.

**Exact source:** `29d795dd5a1672d3527dd525c9d94bd4786fc5bc`
**Comparison base:** `e9381299ec2e37ab35fa31d5104d15ab577b47bf`
**Scope:** `apps/api/src/notification-preferences/delivery.ts` and new `apps/api/src/notification-preferences/delivery.repository.ts`. No other source files differ in this comparison.

## Review

The diff moves six reads, without changing their Drizzle structure or caller order: notification by id; task context via task→project→workspace inner joins and the same id predicate/limit; workspace context with the same workspace id plus `reachableWorkspacePredicate`; user projection of email/name/locale; user preference by user id; and workspace rule by user/workspace ids with `selectedProjects`. Projections, joins, predicates, eager relation, and `limit(1)` are preserved. Each extracted helper is an awaited direct return of the corresponding database call, so returned row shapes and empty-result behavior are unchanged. No transaction boundary or error handling changed.

The repository owns these six SQL reads; `delivery.ts` retains orchestration and behavior: task reach checks both before context lookup and before sending, unresolved resources fail closed, preference secrets still pass through `decryptSecret`, destination guards remain in the senders, payload construction and channel gating remain in place, and provider dispatch still occurs from `deliverNotification`. I found no change to scheduler/worker registration or activation. The existing integration suites `notification-task-reach.test.ts` and `notification-workspace-reach.test.ts` import `deliverNotification`, so they exercise the query path at runtime when run with their database fixture.

This extraction does not implement or authorize external notification activation; the feature spec continues to hold outbound activation. It also does not change the attempt/lease state machine or transaction protocol specified elsewhere. No acceptance or activation claim follows from this review.

## Checks actually run

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/notification-preferences/delivery-ssrf.test.ts` — PASS, 1 file / 4 tests. This exercises the delivery entrypoint and guards for the three outbound senders, but mocks persistence; it is not evidence of SQL predicate behavior.
- `pnpm --filter @taskdesk/api typecheck` — completed with exit 0, including API, permissions, test, RLS-prototype and approvals E2E TypeScript projects.
- `git diff --check <base>...<head>` — PASS. Worktree clean at the exact head.

## Residuals

The moved repository queries have no new direct unit tests at this head. Existing real-database task/workspace reach integration suites are the relevant behavioral coverage, but were not run in this review. The SSRF unit test alone cannot detect a future predicate/projection drift. The broader #580 structural `check:queries` gate remains planned and unwired per the current queue; this review makes no claim about checker completion. No blocking correctness issue was found in the exact two-file delta.


---

Subsequent preserved record 13: `580-notification-delivery-security-sol.md`; SHA-256 `7bce0d572f1ec95bded545c8da1758c61497813333b0e441375a1ab5470b4659`; 4814 original bytes.

# Independent security review — notification delivery query extraction

- **Verdict:** CLEAR for the exact two-file extraction delta. No blocking delta finding. This is not notification delivery acceptance or outbound activation.
- **Candidate:** `29d795dd5a1672d3527dd525c9d94bd4786fc5bc` on `codex/query-ownership-580-notification-delivery`.
- **Base:** `e9381299ec2e37ab35fa31d5104d15ab577b47bf` (unaccepted stacked source).
- **Scope:** `apps/api/src/notification-preferences/delivery.ts` and added `apps/api/src/notification-preferences/delivery.repository.ts` only. `git diff --stat` showed 2 files; the worktree was clean at the assigned head.
- **Independence:** Fresh reviewer context. I did not author, direct, or remediate this candidate. I read the author record and both independent ordinary review reports, then independently inspected the complete diff, caller, reach helpers, provider code, and focused checks.
- **Model provenance:** Dispatched by the conductor as the required full GPT-6 Sol security reviewer. This runtime identifies the GPT-6 family but exposes no independently verifiable serving-variant/dispatch metadata to this context; I cannot attest the Sol suffix from runtime introspection.

## Security analysis

All six relocated reads retain their selected columns/relations, joins, predicates, ordering (none added), `limit(1)` where present, and result shapes: notification by id; task context by task id and task/project/workspace joins; workspace context by resource id plus `reachableWorkspacePredicate` for the notification recipient; user projection and preference by that same recipient; and workspace rule by recipient plus resolved workspace with `selectedProjects` loaded. The SQL-reach helper moved with its original arguments. Each repository function awaits its database expression and returns materialized data, not a query builder. No `actualExecutor`, transaction handle, or caller-supplied authority context existed on this path at the base, and the extraction introduces none. The service calls the helpers at the old points with the same arguments, maintaining error propagation and short-circuit order.

For task resources, `userCanReachTask(notification.userId, notification.resourceId)` still runs before task context loading, again before payload construction, and through `canSendToTask` before each provider call (and the email authorize hook). The task-context helper itself still lacks a recipient predicate, an inherited limitation mitigated at the service boundary, not a new authorization improvement. Workspace context retains its in-query recipient reach predicate. Unknown/missing resource mappings still return without delivery. The service still uses the notification recipient for user, preference, and workspace-rule reads; selected-project filtering is unchanged.

The extraction does not touch decrypted preference fields, provider enablement, HMAC signing, outbound public-destination assertions, the 15-second fetch timeout, `redirect: "manual"`, provider calls, response/error handling, or payload construction. No scheduler, worker, controller, route, or outbound-admission wiring changed. Existing behavior such as the legacy event-data webhook payload and direct provider hooks remains held by the Notifications pre-wiring/activation boundary and is not approved by this review.

## Checks run at the exact head

- `git rev-parse HEAD`, `git diff --stat`, complete two-file diff, `git status --porcelain`, and `git diff --check <base> <head>`: assigned head and clean worktree; diff check passed.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/notification-preferences/delivery-ssrf.test.ts tests/api/permissions/query-ownership-repository.test.ts`: **2 files, 6 tests passed**.
- `pnpm --filter @taskdesk/api typecheck`: **passed**, all five configured TypeScript projects.
- `pnpm exec biome check apps/api/src/notification-preferences/delivery.ts apps/api/src/notification-preferences/delivery.repository.ts`: **passed**, 2 files, no fixes.

## Limits and residuals

No PostgreSQL integration, browser, Docker, image boot, full suite, or provider runtime was run in this read-only review. The SSRF unit test mocks persistence, so it cannot establish SQL reach behavior; existing real-database notification task/workspace reach suites were not run here. The structural `check:queries` gate is not wired on this base. The separate inherited native inbox S3 workspace-versus-project-organisation issue belongs to another worktree and is not cleared by this verdict. Existing legacy identity, preference, recipient, reach, quiet-hours, reservation, deadline, retry, payload, and provider pre-wiring residuals remain held. No acceptance, activation, merge readiness, or phase completion is inferred.


---

Subsequent preserved record 14: `580-notification-json-boundaries-repair-luna.md`; SHA-256 `c99fbe42e3e0a1502cd95708dca40ee5896af35d5e2394cb812e2f12c5334bea`; 4312 original bytes.

# Notification/audit/workflow JSON boundary repair

- **Branch:** `codex/query-ownership-580-b4`
- **Starting HEAD:** `00244aad514335ada83dca90d912f5ae49a1f398`
- **Committed HEAD:** `d193f6836ad596ce68cd26c241020d7e03dc27ae`
- **Commit:** `fix(api): type persisted repository JSON boundaries`
- **Files:** `apps/api/src/audit/repository.ts`, `apps/api/src/notification/inbox.repository.ts`, `apps/api/src/notification/index.ts`, `apps/api/src/workflow/repository.ts`
- **Production scope:** 4 changed production files; query checker evaluated the unchanged evidence scope of 36 production files.

## Change and rationale

The repository exports had unresolved TypeScript value shapes because Drizzle models JSONB as `unknown`; `AuditLogChainRow` also had an open string index signature. Audit list rows now expose only their persisted `before`/`after` leaves as `JsonValue | null`, and the chain row is an exact-field type alias. Notification rows similarly narrow only `eventData` to `JsonValue | null`. Workflow tree, transition-list, and transition-insert outputs all narrow persisted non-null `guards`/`effects` leaves to `JsonValue`; the code does not claim these JSON values satisfy the workflow domain unions.

The JSONB type boundary is based on repository evidence: both application `Pool` constructions in `apps/api/src/database/index.ts` omit custom type parsers; node-postgres `pg-types` registers JSONB OID 3802 with `JSON.parse`; Drizzle's JSONB column mapper passes the parsed value through unchanged. The mapper functions preserve all values and row fields. Query predicates, projections, ordering, transaction/executor use, locking, and result ordering remain unchanged. The route file adds type-only annotations for list/create/direct-mark payloads against the existing notification table row shape. This addresses OpenAPI/Hono route inference recursion while preserving the current `eventData: z.unknown()` HTTP contract and runtime values.

## Validation actually run

- `pnpm --filter api typecheck` — passed (all configured API, permission, tests, RLS prototype, and approvals TypeScript projects).
- `pnpm exec biome check apps/api/src/audit/repository.ts apps/api/src/notification/inbox.repository.ts apps/api/src/notification/index.ts apps/api/src/workflow/repository.ts` — passed, 4 files.
- `git diff --check` — passed before commit.
- Focused existing unit tests: `pnpm --filter api exec vitest run --config vitest.config.ts ../../tests/api/notification-current-eligibility.test.ts ../../tests/api/notification-resource-mapping.test.ts` — 2 files, 48 tests passed.
- Current external query checker source `7b5c54279095f0384e71964adc5bf31f979d8829`, run over all 36 paths in `580-notification-scoped-checker-00244aad.json` — **3 initial findings, 0 final findings**.
- No PostgreSQL/Docker runtime was available. Database-backed integration tests were not run and are not represented as passing.
- No browser, push, PR, or merge action was performed.

## Iteration and residuals

An initial implementation that directly propagated recursive `JsonValue` through the notification route caused `TS2589` at `apps/api/src/notification/index.ts:110`. The repository mapping itself cleared the inbox repository finding but prevented API typecheck. The authorized type-only route transport annotation resolved that compile boundary without casts or runtime transformations. Workflow inspection also found raw JSONB transition outputs in `listVersionTransitions` and `insertWorkflowTransitions`; both now use the same leaf materializer as the workflow tree. An earlier checker run while notification typechecking failed reported those diagnostics; the final 36-file run is clean.

Residual limitation: no live PostgreSQL execution verified the driver behavior or database query results in this environment. The parser basis above is static inspection of the actual configured pool and installed pg/Drizzle JSONB implementation. Integration coverage remains necessary in an environment with PostgreSQL.

## Model dispatch and runtime

This was dispatched as the GPT-6 Luna bounded repair lane. The execution environment did not expose an independently inspectable underlying model/version identifier, so runtime model identity is not claimed beyond that orchestration dispatch label.


---

Subsequent preserved record 15: `580-notification-json-boundaries-ordinary-luna.md`; SHA-256 `0cd78ab5105224e115b979051ac514209bc2c959b206146c87d0d87a8f11428c`; 5245 original bytes.

# #580 notification/audit/workflow JSON boundary repair — ordinary review

**Verdict: CLEAR for the bounded four-file type repair at the exact head.** The changes narrow only persisted JSONB leaves after materialization, remove the unsafe open index signature from the audit chain row, and add a type-only notification transport boundary to contain compiler recursion. Inspection found no query, authorization, transaction, locking, error, or runtime payload-shape change. PostgreSQL integration remains unverified.

- **Reviewed head:** `d193f6836ad596ce68cd26c241020d7e03dc27ae`
- **Comparison base:** `00244aad514335ada83dca90d912f5ae49a1f398`
- **Worktree:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, branch `codex/query-ownership-580-b4`; clean at exact head.
- **Files:** `apps/api/src/audit/repository.ts`, `apps/api/src/notification/inbox.repository.ts`, `apps/api/src/notification/index.ts`, `apps/api/src/workflow/repository.ts` only.
- **Role and independence:** Fresh ordinary-review context assigned by `/root`; I did not author, direct, or remediate the repair. The assignment called for strong ordinary review. Runtime identifies Codex/GPT-6 but does not expose the precise Luna variant or spawn arguments, so I do not claim those as runtime-observed facts.

## Review

The audit list materializer copies each returned row and narrows only nullable `before`/`after` JSONB values to `JsonValue | null`. Its chain-row type is now an exact alias containing the SQL projection fields, with no arbitrary string index signature. The SQL projection, aliases, ordering, filters, limits, append-chain statements, transaction handle, advisory lock, and call order are unchanged.

The inbox materializer similarly copies notification rows and narrows only `eventData` to `JsonValue | null`. It is applied to direct-mark output, list output, and inserted notification output. It preserves undefined/no-row behavior, SQL-null and JSON-null values, field values, page order and nested page metadata. The transaction retries, identity resolution, customer project reach, native-resource policy, instance-admin checks, recipient predicates and guarded updates are unchanged. No authorization decision uses the narrowed type to grant reach.

Workflow materialization copies the workflow tree, versions and transitions in their existing order, narrowing only non-null JSONB `guards` and `effects` leaves to `JsonValue`. The same materializer is used for transition-list and insert-returning rows. It does not cast the values to workflow guard/effect unions or validate/transform their contents. Queries, selected relations, executor choice, transaction boundaries, inserts, and row order remain unchanged.

The fourth file uses a type-only schema import and a compile-time `NotificationTransportRow` for the list, create, and direct-mark route responses. The route continues returning the exact same values through `c.json`; the OpenAPI `eventData: z.unknown()` response contract is unchanged. The import is erased, and the response assignments introduce no parsing, field filtering, defaults, or runtime validation. The author’s TS2589 iteration is documented in its implementation report; current typecheck passes with this bounded transport annotation.

I verified the JSON materialization premise against the configured code and installed packages: both application `Pool` constructors in `apps/api/src/database/index.ts` set no custom type parser, and no API `setTypeParser` override is present. Installed `pg-types@2.2.0` registers OIDs 114 and 3802 with `JSON.parse`; installed Drizzle `0.45.2` JSONB mapper parses string fallback values and otherwise returns the driver-decoded value unchanged. JSONB therefore supplies parsed JSON values (including JSON `null`), while SQL NULL remains `null`; the casts preserve rather than transform those values. PostgreSQL runtime verification was unavailable and is not claimed.

## Checks and limits

- Exact head, parent, changed paths and clean worktree confirmed. `git diff --check 00244aad514335ada83dca90d912f5ae49a1f398..HEAD` passed.
- `pnpm --filter @taskdesk/api typecheck` passed across all five configured TypeScript projects.
- Targeted notification unit tests passed: **2 files / 48 tests** (`notification-current-eligibility.test.ts` and `notification-resource-mapping.test.ts`).
- Biome passed on all four changed files with no fixes.
- I independently ran the current query-ownership analyzer over the existing explicit **36-file** scope using checker source `7b5c54279095f0384e71964adc5bf31f979d8829`; result: **zero findings**. A separate unscoped invocation examined the entire API tree and emitted 4,629 known out-of-scope baseline findings; that broad result is not the bounded 36-file check and is not treated as a candidate-specific failure or clean result.
- No PostgreSQL integration, Docker/image/health, browser, hosted CI or SIT run. No source files were edited.

**Disposition:** CLEAR for this bounded type-boundary repair. The current 36-file scoped query check is clear, but this is not a PostgreSQL/runtime result, whole-program query-ownership theorem, notification delivery acceptance, outbound activation, merge readiness, or stage completion.


---

Subsequent preserved record 16: `580-notification-composition-security-current-sol.md`; SHA-256 `808d2bddbe97d0165c8f7e6b086137e062ea78aa61c304e63199708dd8744f9a`; 7443 original bytes.

# #580 / #785 notification composition — independent current-head security review

**Verdict: CLEAR for the frozen composed source at `d193f6836ad596ce68cd26c241020d7e03dc27ae`.** I found no remaining blocking source-security finding in the reviewed notification, audit, workflow, scheduler and preference extraction. This is a full current-composition source review after ordinary repair clearance, not PostgreSQL execution, image/runtime acceptance, a merge authorization, or #580/stage completion.

- **Reviewed head:** `d193f6836ad596ce68cd26c241020d7e03dc27ae`, clean local branch `codex/query-ownership-580-b4`, worktree `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`.
- **Comparison base:** accepted main `e9df2294fa580fd2885343bbef0cec28e81ead4c`, verified as ancestor. The final four-file type-boundary delta has base `00244aad514335ada83dca90d912f5ae49a1f398`.
- **Role and independence:** Fresh context dispatched by `/root` for the **full GPT-6 Sol security-review role** with no inherited author turns. I did not author, direct, or remediate this candidate, or perform its ordinary reviews. Runtime introspection here does not expose a independently verifiable serving variant/version; “GPT-6 Sol” describes the recorded dispatch, not a model identity inferred from introspection.
- **Sources:** Current AGENTS.md, active mission, agent-workflow.md, CLAUDE.md, notification/project customer-binding/RBAC and multi-tenancy contracts; accepted-main and candidate diffs; source routes, policies, repositories, producers, tests; earlier adverse Sol reports and current independent ordinary/delta clearance records. I separately inspected the authentic #780 D1–D4 conductor-decision entry in unaccepted carrier #791. Reading it does not make it accepted-main authority.

## Security assessment

**Inbox authority.** All candidate pages and mutations select by the authenticated `userId`; there is no recipient override. Native `work_item`/`comment` rows additionally require a non-null `personId` equal to the currently resolved identity, a supported event/resource mapping, current live item/comment/project/workspace facts, a public comment for a customer, the private-item requester/participant audience where applicable, canonical `reaches(...)`, and canonical `can(..., work_item:read, ...)`. Both native resource projections use `project.organisationId`, consistent with customer-serving projects in internal workspaces; the old workspace-organisation error is absent. Customer rows fail closed for internal comments, foreign customer organisation, private-audience loss, tombstones/bodyless comments and missing resource facts. An API-key list passes the actual authenticated key and capability subset into identity resolution; mutation routes are session-only. Legacy task and approval SQL reach restrictions remain composed. The native list authorizes stable `(created_at,id)` candidate pages before the 50-visible-row cap, while bulk read/clear traverse all pages.

**Current instance authority and writes.** `resourceType === "instance"` and legacy `type === "audit_write_failed"` both require a currently active staff identity with canonical `instance:admin`. List and both bulk operations exclude that full family in candidate SQL before paging or writing when authority is absent. Direct mark rechecks it inside the operation transaction. Native lookup, instance authority and guarded same-recipient/resource writes run under one repeatable-read operation; `40001` retries the whole operation at most twice in fresh transactions. The authorization snapshot guarantee does not assert stronger ordering against a concurrent revocation than the specified repeatable-read boundary.

**Producer and persistence seams.** The active comment-mention producer enqueues event/fanout on its mutation transaction; approval producers remain on their existing path. Fanout passes the same transaction handle to recipient locking, inbox insert and delivery-child insert; actor exclusion, recipient dedupe, active-person/login and channel preference checks remain. Audit append still opens/uses one transaction and executor for global advisory lock, chain-head read, database clock sample, canonical hash and insert in that order; chain verification retains `seq` ordering and lossless UTC microsecond text. Workflow create/publish handle flow and scheduler lease/reminder/cleanup predicates are preserved in named repositories. Preference extraction keeps recipient-keyed reads, membership/project filtering, encrypted-secret handling and destination validation. The separate two-file delivery extraction preserves its recipient reach checks and provider path without activating a new adapter or worker.

**Final type-boundary delta.** The four changed files copy decoded JSONB result objects, narrowing only persisted `eventData`, audit `before`/`after` and workflow `guards`/`effects` TypeScript leaves. The audit chain type loses an open index signature. Notification route annotations use a type-only schema import; the route still returns the same `c.json` values and the OpenAPI `eventData` declaration remains unknown. I found no changed SQL predicate, transaction, lock, response schema, runtime validation, query authorization or producer wiring in that final commit. The configured API Pool has no custom JSONB parser; this is still source/type evidence, not a database execution result.

## Checks and evidence limits

At the frozen local head, `pnpm --filter @taskdesk/api typecheck` passed all five configured TypeScript projects; focused Vitest passed **4 files / 56 tests** (`notification-current-eligibility`, `notification-resource-mapping`, `delivery-ssrf`, `database-executor`); Biome passed the final four source files. `git diff --check` over the **product source/tests** passed. Full-tree diff check reports inherited trailing whitespace in append-only #764/#580 review records; I did not rewrite those records or count that as a new product-source finding. The local worktree remained clean. I inspected the live PR #785 state: its remote head was still `8fa653b2f60d1a516ba59877feaceedd747eac0b`, not this reviewed local head, and its then-visible checks are not current-head evidence.

I did **not** run the new PostgreSQL-backed inbox authorization and interleaving regressions, Docker/image/health, browser, hosted exact-head CI, provider I/O or SIT. Docker/PostgreSQL was unavailable to this read-only review assignment; author and older-head results do not prove these current runtime cases. The prior adverse security reports at `e3df4d7f` and `e9381299` remain valid history rather than being overwritten by this clearance. The ordinary A/B/C composition records, C's factual clarification, project-binding repair review, delivery A/B/full-Sol records and final JSON-boundary ordinary review remain separate evidence.

**Residual acceptance prerequisites:** #764 and the authentic #780 D1–D4 decision provenance must reach accepted main in the correct composition order; the candidate must be published and receive every required exact-head hosted check, real PostgreSQL regressions, and image boot/health evidence before any merge claim. Other notification resource types, digest/adapters and outbound/provider/identity activation remain behind their documented pre-wiring gates. This review grants no waiver, producer activation, #580 completion, stage closure or release/SIT claim.



## Customer privacy, canonical admission and public-transition correction

**Reviewed head:** `c84df2f56030c375bba4ac9b7af8832852bce2c1`

Historical e561 PostgreSQL remains FAILED206files/2947tests,3failed. The repaired source fixes native customer organisation-scope authority, legal agent-host denial and exact post-clear hidden IDs; requires genuine current canonical customer membership in the shared resolver and portal admission; rejects forbidden customer event families; admits documented public transitions. Current actual customer external work-item/comment delivery remains fail-closed at the work-item-scope authority check, before destination resolution. The mocked eligibility test is not provider/delivery evidence. No new route, capability, schema, producer or outbound activation is authorized.

Three fresh independent ordinary contexts inspected shared-auth source5fd and found its sole remaining transition over-denial. All three independently cleared that bounded correction and accepted-main composition at exactc84; shared membership/auth files remained byte-unchanged from their full inspections. Fresh independent full security context `/root/notification_structural_security_current` was explicitly spawned `model:gpt-6-sol`, `fork_turns:none`, after those clearances; it did not author/direct/remediate or advise the repair and gives full source CLEAR. Its actual focused units3files114tests passed. AuthorAPI120files866tests/typecheck/Biome passed; permissions106/107 with one git-baseline timeout is NOT a full pass. Raw reports retain model runtime introspection limits and every adverse finding.

Current main import contains only800's real-editor unit and own note, byte-equal acceptedmaind93; all other paths equal6a76 source. Query-checker zero applies only to two new pure modules, not all changed sources or whole580; existing all-tree and auth-repository findings remain pending actual composition/conversion. The final auth seam inventory is advisory only, preserves its author's appended factual clarification, and is no merge/acceptance approval. Real PostgreSQL membership revocation/restore and persisted mutation oracles remain UNRUN on this source. Current hosted CI/image/764/780 and all feature holds remain. Publication changes only this own note.

---

### Authentic record: notification-hosted-failure-adjudication-sol.md

# #785 hosted PostgreSQL notification failure adjudication (read only)

**Disposition:** Published candidate `e561411f8852d9e9ff3cd949e83c6618da05f7ed` is **red**. The hosted integration job reports 206 files (204 passed, 2 failed), 2,947 tests (2,944 passed, 3 failed), and five tasks (four passed, one failed). These are three assertions in two files, with three distinct causes below. The previous Sol source review cleared `d193f6836ad596ce68cd26c241020d7e03dc27ae`; it expressly did not run PostgreSQL. Its source-clear verdict is not an exact-publication runtime pass. The publication is one commit after that source (`git show --format='%H %P' --no-patch HEAD`).

**Provenance and checks:** I inspected the local clean checkout at the publication SHA; current `AGENTS.md`, active mission, agent workflow, `CLAUDE.md`, notification/comment/customer-portal specs, RBAC/API design, ADR 0004, canonical evaluator, notification inbox repositories/routes, authentication host guard, and exact test fixtures. I read the private raw hosted log only for the three Vitest assertion summaries and final counts. I did not print SQL, query parameters, fixture records or secrets, execute tests, use PostgreSQL/Docker/browser, edit product source, or push. This is an advisory on the failed published head, not a review or approval of any future repair.

## 1. Hidden alerts after clear: stale test expectation, not evidence of a bulk bug

`tests/api-integration/notification-task-reach.test.ts:302-328` plants 105 hidden `audit_write_failed` rows and one reachable legacy task row. The list correctly sees only the task row (:314-315). It then calls `markAllNotificationsAsRead` **and `clearNotifications`** (:316-317), but expects 106 stored rows and the visible task id still present (:325, :327). The hosted failure is exactly 105 rows at :325. `clearNotifications` calls `deleteReadableNotifications` (`apps/api/src/notification/controllers/clear-notifications.ts:3-5`); `bulkMutation` deletes only allowed rows across pages (`apps/api/src/notification/inbox.repository.ts:276-310`). Its candidate query excludes instance/audit alerts before paging when `canReadInstanceAlerts` is false (:186-200, :244-252). The specified clear behaviour removes reachable rows, while inaccessible rows remain hidden; D10 additionally preserves their unread state (`docs/07-planning/decision-log.md:489-495`; `notifications.md:343-349`). Thus 105 surviving hidden rows is consistent with the contract; the test's own subsequent task-id assertion would also fail once :325 is corrected. **Classification: invalid post-clear assertions in the test**, conditional on the observed 105 being the 105 planted hidden rows. The current failed assertion alone does not prove each surviving id, so the repair should assert the exact hidden-id set and absent visible id, plus all hidden rows unread. Keep the separate admin block's >100-row read/clear assertions (:330-356); no broadening bulk writes or weakening the hidden-alert boundary.

## 2. Customer private-audience test: source authorization mismatch

`tests/api-integration/work-item-comment.test.ts:524-641` creates a serving customer organisation, assigns the project to it (:559-562), sets a private work item with a requester and explicit participant (:564-575), and plants native work-item/public-comment/internal-comment notifications for each customer (:603-632). The repository list for the requester returns `[]` at :639 in hosted PostgreSQL. The resource loader uses **`project.organisationId`**, not workspace organisation, for both work items and comments (`apps/api/src/notification/repository.ts:78-123, :180-213`) and computes private visibility as requester plus participants (:36-44). The native predicate enforces matching notification person, live resource, customer-public comment, and `reaches(...)`, then additionally calls `can(identity, 'work_item:read', 'work_item', ...)` for everyone (`apps/api/src/notification/native-inbox-reach.ts:26-62`). That last call necessarily rejects the customer: `resolveIdentity` gives customer only an **organisation-scope** role (`apps/api/src/permissions/resolve-identity.ts:385-430`), while `GRANT_SCOPES_FOR.work_item` accepts only instance/workspace/project grants (`packages/permissions/src/evaluator.ts:128-144`). Adding `organisationId` to the target cannot fix this deliberate scope exclusion. The organisation customer reach itself is explicitly supported by `reaches` (:353-377). **Classification: source failure in the customer branch, exposed by a valid fixture**. It affects customer native inbox read and, because the same predicate gates them, direct and bulk mutations. No evidence here that staff native checks fail.

Bounded repair: branch explicitly on a *resolved customer portal identity*, retain self/person binding, supported kind, live-parent, serving-project organisation, private requester/participant audience and public-comment checks, and apply the documented customer `own_request`/current-reach rule rather than a staff `work_item` capability policy. Retain the canonical `can(work_item:read)` check for staff. Add/keep PostgreSQL assertions for requester, participant, same-organisation nonparticipant, foreign organisation, internal comment, and read/clear side effects. Do not widen `GRANT_SCOPES_FOR.work_item` globally or grant customers staff/project authority (`rbac.md`; `customer-portal.md:121-129, :218-245`; `notifications.md:343-357`).

## 3. Customer 401 at `/api/notification`: invalid route/host fixture; portal inbox contract unresolved

`tests/api-integration/work-item-comment.test.ts:655-748` plants an organisation-visible item in a serving project, then mocks a **customer portal** session but requests `/api/notification` with no host header (:746-748). In tests, an absent host resolves to the **agent** origin (`apps/api/src/auth.ts:1221-1243`). Host-selected authentication therefore asks the agent Better Auth instance for that mocked customer session; the session portal does not match the selected host (`apps/api/src/utils/authenticate-api-request.ts:15-29`), producing the hosted 401 before the inbox handler runs. The agent inbox route is mounted at `/api/notification` (`apps/api/src/index.ts:1510`; `apps/api/src/notification/index.ts:113-133`). A portal host does not simply solve this: the portal host guard admits only registered portal-policy routes (`apps/api/src/index.ts:725-737`), and ADR 0004 requires a separately reviewed narrow `/api/portal/*` router (`docs/01-architecture/adr/0004-two-portals-two-origins.md:29-57`). The customer-portal route table names portal notification **preferences**, not a portal inbox (`docs/03-features/customer-portal.md:228-245, :299-301`). `notifications.md:390-395, :412-432` calls inbox access authenticated self and lists `/api/notification`, but does not resolve this conflict into an explicit customer portal inbox route. **Classification: invalid HTTP test fixture plus an underspecified customer HTTP surface; 401 is consistent with the host/session boundary, not proof that serving-project organisation lookup failed.**

Bounded repair: test the serving-project organisation reach through the inbox repository with distinct customer organisation and workspace organisation, as B1 does, after fixing item 2. Keep the agent-host customer-session rejection as a separate negative assertion. Do not allow `/api/notification` through the portal guard, spoof an agent session for a customer, or add a portal inbox route solely to make this test pass. If the intended product behavior includes customer HTTP inbox and read mutations, the owner must settle its explicit `/api/portal/*` route, policy, response and mutation contract in the spec, then implement and review that separate surface. The present corpus supports customer current-reach eligibility for notifications, but not this test's cross-origin invocation.

**Gate implication:** This hosted integration result stays failed at `e561411f8852d9e9ff3cd949e83c6618da05f7ed`. A repaired publication needs focused real PostgreSQL reproduction and the required exact-head hosted checks and independent reviews. This note neither approves a future authored repair nor changes instance-admin, staff, private audience, bulk pagination, or no-write-on-inaccessible-row requirements.


---

### Authentic record: notification-hosted-fixture-inventory-luna.md

# Notification hosted fixture inventory — GPT-6 Luna

**Inspection only.** Checkout: `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, HEAD `e561411f8852d9e9ff3cd949e83c6618da05f7ed`. The same assertions are present in reviewed source `d193` (checked with `git show`; no candidate edits observed). Read the actual PostgreSQL test log only for failure summaries and assertion frames; no SQL, parameters, or fixture payloads are reproduced here. Log reports 2 failing files, 3 failed of 2,947 tests (2,944 passed).

## Failure matrix

| Failure | Observed result | Contract and source evidence | Fixture/expectation evidence | Assessment and bounded repair |
|---|---|---|---|---|
| `notification-task-reach.test.ts:325`, “filters hidden alerts before paging…” | After bulk mark-read and clear, hidden owner has 105 rows; assertion expects 106. Log confirms actual array size 105. | `apps/api/src/notification/inbox.repository.ts:276-303` paginates candidates, resolves current identity/reach and deletes only allowed rows for clear mode. `notifications.md:346-349` says current reach applies to inbox mutations; `:379-380` says instance alerts disappear from access when admin authority is absent and cannot be changed by caller-chosen id. | At `tests/api-integration/notification-task-reach.test.ts:302-328`, fixture has 105 `audit_write_failed` instance alerts (hidden to this non-admin), plus one old reachable task notification. The test calls `markAllNotificationsAsRead` and `clearNotifications`, then expects 106 retained rows and explicitly expects the reachable task row still present. Later the same test expects an authorized admin clear to leave zero rows (`:330-356`). | The reached task notification is eligible for clear and should be deleted; the 105 unauthorized instance alerts should remain unread. The tested implementation matches the reach contract. Correct the post-clear expectations to 105 retained, zero read, all alert IDs retained and the visible task ID absent. Preserve the admin >100-row bulk-read/clear assertions. This changes only inconsistent test expectations, not the authorization or bulk code. |
| `work-item-comment.test.ts:639`, B1 “customer comment visibility and private-item audience” | `listVisibleNotificationRows` returns no visible rows; the requester’s work-item notice is absent. Log frames only assert line 639; no payload data used. | `customer-portal.md:218-226` says a usable portal identity is a customer-side person with built-in `customer` role on an organisation-scoped membership, in an organisation with `portal_access=true`. `data-model.md:131-135` describes person and membership semantics. `notifications.md:343-349` requires recipient identity/current reach. The inbox resolves identity via `resolveIdentity` at `inbox.repository.ts:142-168`, then checks customer visibility and reach at `native-inbox-reach.ts:21-62`. | `addCustomerIdentity` in `work-item-comment.test.ts:91-115` creates only user and customer-side person; it does not admit the person via organisation membership. The B1 test creates organisations at `:526-549` without setting `portalAccess`, calls that helper for requester, participant, nonparticipant and foreign customer (`:550-553`), then expects requester and participant reach (`:633-642`). | The fixture is not a canonically admitted portal identity and does not establish portal access. Use the canonical admitted-customer fixture pattern (or add an appropriately scoped helper) that sets `organisation.portal_access=true` and creates the built-in organisation-scope customer membership for each person. Keep assertions distinguishing requester/participant from same-org nonparticipant/foreign and public/internal comment; do not weaken expected reach. |
| `work-item-comment.test.ts:748`, S3 “serving project organisation…” | Portal list returns 401 where test expects 200. Log reports only status and assertion frame. | Same portal admission requirements above; `resolveIdentity` also returns no customer identity for inactive/deleted/portal-disabled orgs (documented in its source comments at `apps/api/src/permissions/resolve-identity.ts:166-185`). This route’s runtime customer admission/auth path is separate from native reach. | `makeCustomerOrganisation` at `work-item-comment.test.ts:657-670` sets key/name/isInternal only; does not enable portal access or create customer membership. `addCustomerIdentity` at `:91-115` creates a person without membership. S3 then updates the project’s serving organisation (`:681-683`), plants rows and makes a customer portal request (`:746-748`). | The test intends to exercise customer reach through the project’s serving organisation, but its session identity is inadmissible under the approved portal contract. Make both serving and foreign organisations portal-enabled and admit each customer using the canonical organisation-scoped customer membership fixture. Retain its central assertion that project organisation, not workspace organisation, determines resource reach, plus internal-comment and foreign-org exclusions. Do not change production auth to accept an unadmitted person. |

## Scope notes

- The tests and implementation are unchanged from reviewed source `d193`; these failures are reproducible observations on exact candidate `e561411f8852d9e9ff3cd949e83c6618da05f7ed`, not a delta from that review.
- The first case points to a stale assertion pair: the test itself invokes clear-all, while expecting the reachable row to survive. The 105 hidden admin alerts are precisely the rows expected to remain.
- The two customer cases share a fixture-contract gap. The customer fixture helper currently creates a bare customer person, not an admitted portal principal. The intended visibility assertions remain valid once the fixture models the approved admission shape.
- No production-code repair is supported by this inventory. In particular, do not loosen instance-admin reach or customer admission to make the tests pass.
- No edits, test runs, database operations, Docker operations, browser operations, commits, or pushes were performed for this inventory.


---

### Authentic record: notification-hosted-fixture-reconciliation-luna.md

# Notification hosted failure reconciliation and bounded repair plan — GPT-6 Luna

**Read-only reconciliation.** Exact checkout: `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, HEAD `e561411f8852d9e9ff3cd949e83c6618da05f7ed`. This supplements the earlier `notification-hosted-fixture-inventory-luna.md`; that report remains unchanged. I reviewed the independent `notification-hosted-failure-adjudication-sol.md` and verified the claims below against source and approved feature/RBAC documents. No tests, database, Docker, or browser were used; no repository source was edited.

## Corrected failure matrix

| Failure | Correct disposition | Evidence and bounded repair |
|---|---|---|
| `notification-task-reach.test.ts:325` | Stale post-clear assertions; bulk reach code behaves consistently with the specified clear operation. | The test plants 105 inaccessible instance alerts plus one reachable old task notice, then marks all readable rows and clears readable rows. `clear-notifications.ts:3-5` calls `deleteReadableNotifications`; `inbox.repository.ts:276-310` deletes only rows admitted by current reach and admin checks. Expect the exact 105 hidden alert IDs to remain unread and the visible task ID to be absent. Keep the separate admin >100 read/clear assertions intact. Do not change production bulk logic. |
| `work-item-comment.test.ts:639` B1 | **Production source authorization mismatch**, not the fixture defect claimed in the prior report. | Resource loading uses `project.organisation_id` (`notification/repository.ts:78-123, 180-213`); private audience is requester plus participants (`:36-44`). `canReadNativeInboxCandidate` binds the candidate person to the resolved identity, checks supported kind/resource and public comment, calls current `reaches`, then always calls `can(identity, 'work_item:read', 'work_item', ...)` (`native-inbox-reach.ts:21-62`). For the canonical customer grant, the evaluator deliberately excludes organisation grants from work-item scope (`packages/permissions/src/evaluator.ts:131-144`); `resolveIdentity.ts:408-430` synthesizes the built-in `BUILT_IN_ROLES.customer` grant at the customer's organisation. Thus a correctly resolved customer fails this last staff-shaped capability check. The customer role includes `work_item:read` (`roles.ts:196-204`), and organisation-scope `can(work_item:read, 'organisation', { organisationId })` is supported by the evaluator's organisation grant-scope table and is already used for customer approval delivery eligibility (`current-eligibility.ts:216-220`). |
| `work-item-comment.test.ts:748` S3 | Invalid cross-origin HTTP invocation plus an unresolved customer inbox route; 401 is consistent with host/session policy. | With no host header, request origin selection defaults to agent (`auth.ts:1221-1243`); the mocked customer session is rejected by host/portal matching (`authenticate-api-request.ts:15-29`). `/api/notification` is the agent inbox (`index.ts:113-133`); portal-origin requests admit only registered portal-policy routes (`apps/api/src/index.ts:725-737`). The customer portal route contract lists preferences, not an inbox (`customer-portal.md:228-245, 299-301`), while notifications do not define a separate portal inbox route. Replace S3's customer HTTP success expectation with a repository-level serving-project-organisation reach assertion, and retain an explicit negative assertion that the customer session cannot use the agent-host inbox. Do not add a portal route, relax the host guard, or spoof an agent session. Any intended customer HTTP inbox requires an owner-approved route/policy/response/mutation contract first. |

## Customer predicate shape for the bounded source repair

`own_request` is a portal **policy predicate**, not a capability; there is no `own_request:read` capability to invent. Preserve the current self-binding, supported event/resource mapping, live resource/workspace/project checks, customer-public comment requirement, current customer reach against the **serving project's organisation**, and private requester/participant set. For a customer, require the built-in customer `work_item:read` authority at organisation scope with the resolved resource organisation, using canonical `can(identity, 'work_item:read', 'organisation', { organisationId })`, and enforce the repository's equivalent of `own_request`: private rows only for requester/participants; organisation-visible rows only for a customer whose resolved organisation matches the serving project. For staff, keep canonical `can(identity, 'work_item:read', 'work_item', { ... })` unchanged. Do not widen `GRANT_SCOPES_FOR`, use project/workspace staff grants for customers, or let resource organisation alone substitute for customer capability.

The semantic precedent is `current-eligibility.ts:203-227`: current resource reach is checked separately, then customer approval read authority is evaluated against its organisation while other recipients use work-item scope. Apply only the authority-scope distinction needed for customer native inbox reads; preserve all existing eligibility gates.

## Fixture contract correction

The earlier report's assertion that all customer fixtures are invalid was too broad. `organisationTable.portalAccess` is `DEFAULT true NOT NULL` (`apps/api/src/database/schema.ts:1681-1685`), so the B1/S3 organisation insert that omits the value is portal-enabled by schema default; omission alone does not explain either failure. Current `resolveIdentity` constructs the exact immutable `BUILT_IN_ROLES.customer` organisation grant from an active customer-side person and organisation facts (`resolve-identity.ts:385-430`); it does not read a `membership` row for that role. The feature spec does describe organisation-scoped membership as the customer admission record (`customer-portal.md:218-226`, `data-model.md:131-135`), so future fixtures should use the canonical admitted-customer helper where one is available. But the absence of such a row is not the observed B1 authorization failure under the current resolver, and should not be “fixed” by changing auth behavior inside this bounded repair. The real customer API 401 is the agent-host mismatch described above.

## Planned files and verification cases

- `apps/api/src/notification/native-inbox-reach.ts`: structural split of staff work-item authority from customer organisation authority while retaining self, resource validity, current reach, project organisation, private requester/participant and public-comment checks.
- `tests/api-integration/work-item-comment.test.ts`: keep B1 expectations for requester and participant; deny same-organisation nonparticipant and foreign customer; deny internal comments; assert read/clear mutations affect reachable rows only. Rewrite S3 to assert serving-project organisation behavior through `listVisibleNotificationRows`; separately assert a customer session at the agent-host `/api/notification` is rejected. No portal inbox is added.
- `tests/api-integration/notification-task-reach.test.ts`: update only the post-clear expectation to exact hidden ID set, all unread, and reachable visible row absent. Preserve the admin pagination and bulk mutation block.
- Preserve meaningful API-key coverage: exercise a staff key's current capability subset on native inbox reach (a subset with `work_item:read` admits the reachable row; a subset without it does not), and verify a customer API-key credential remains refused by the actual `resolveIdentity` path (`resolve-identity.ts:366-393`). Keep key subset clamping; do not derive key authority from the owner's broader identity.

This report is a plan, not approval or evidence of a repaired head. The previous published PostgreSQL result remains red at `e561411f8852d9e9ff3cd949e83c6618da05f7ed`. No repairs or tests have been performed.


---

### Authentic record: notification-hosted-failure-repair-luna.md

# Notification hosted-failure bounded repair — GPT-6 Luna

## Result

Implemented and committed the bounded repair on the original frozen worktree. Commit `2a38ea309a861157f4768d3b04b00c85a42e9159` (`fix(notification): honor customer organisation read authority`), parent `e561411f8852d9e9ff3cd949e83c6618da05f7ed`, branch `codex/query-ownership-580-b4`. Worktree is clean. Commit is local only; no push or PR was made. The initial adverse reports were preserved unchanged.

## Changes

- `apps/api/src/notification/native-inbox-reach.ts`: after the existing person/resource checks and current reach evaluation, customer identities now require canonical `work_item:read` at the serving project's organisation scope. The customer-private audience and public-comment gates remain in place. Staff still require canonical `work_item:read` at work-item scope. No evaluator, role, host, route or policy changes.
- `tests/api/notification/native-inbox-reach.test.ts`: added pure predicate coverage for built-in customer organisation authority, serving-organisation mismatch and missing organisation, requester/participant/private audience, nonparticipant denial, internal-comment denial, null identity, missing resource, unsupported event, person mismatch, staff access, and staff key-subset allow/deny.
- `tests/api-integration/work-item-comment.test.ts`: customer fixtures now use an active customer person, active portal-enabled organisation, the exact `BUILT_IN_ROLES.customer` organisation role and an organisation-scoped membership. B1 retains requester/participant, same-org nonparticipant, foreign-org and public/internal comment checks; direct positive and private-audience-denied mutations are immediately reread. S3 checks serving-project organisation through the repository and retains an agent-host customer-session `401`; it makes no customer HTTP inbox-success assertion or new route claim. Repository-level direct/bulk read and clear side effects are reread immediately. Missing resources and inactive customer organisations remain denied. Staff API-key checks now prove both an exact `work_item:read` subset allows rows and an empty subset denies them.
- `tests/api-integration/notification-task-reach.test.ts`: after clear-all, asserts the exact 105 hidden alert IDs remain unread and the reachable visible notification is absent. The authorized admin >100-row read and clear assertions are unchanged.

The existing actual-loader customer API-key refusal case remains in `tests/api-integration/resolve-identity.test.ts:567-584`; the pure identity resolver refusal also ran in the focused unit command. The customer role remains built in and organisation-scoped; no capability was invented.

## Verification

- Focused Vitest: `tests/api/notification/native-inbox-reach.test.ts` and `tests/api/permissions/resolve-identity.test.ts` — **2 files, 58 tests passed**. These are unit tests; the PostgreSQL integration files were not run.
- `pnpm --filter @taskdesk/api typecheck` — **passed** across API, permissions, tests, RLS prototype and approvals E2E TypeScript projects.
- Biome on the four changed TypeScript files — **no errors**; reports five existing unused-variable warnings elsewhere in `work-item-comment.test.ts`.
- Exact typed query-ownership checker source `7b5c54279095f0384e71964adc5bf31f979d8829` on the only changed API source file — **1 file, zero findings**. Its source blob was verified against that exact checker commit; this does not claim the repository `check:queries` command is wired.
- `git diff --check` — passed before commit; commit hook completed with only the five Biome warnings above.

## Not verified

PostgreSQL integration, browser, Docker/image, full test suite and hosted CI were not run, as directed. In particular, the three original hosted failures have not yet been proven fixed under PostgreSQL. This is not an independent review or approval; the source repair is security-coupled and requires two fresh ordinary reviews plus a separate fresh Sol security review before any merge eligibility.

## Preserved evidence

The original read-only inventory `notification-hosted-fixture-inventory-luna.md`, independent adjudication `notification-hosted-failure-adjudication-sol.md`, and reconciliation plan `notification-hosted-fixture-reconciliation-luna.md` remain unchanged. The 2026-10-15 hosted log was not reread during implementation.


---

### Authentic record: notification-hosted-repair-ordinary-a-luna.md

# Notification hosted repair — independent ordinary review A

**Verdict: BLOCKED**

**Model:** GPT-6 (platform did not expose a Luna/Sol variant or version in this reviewer context)
**Role:** Fresh independent ordinary reviewer A; this context did not author, direct, or remediate the candidate.
**Reviewed head:** `2a38ea309a861157f4768d3b04b00c85a42e9159`
**Comparison base:** `e561411f8852d9e9ff3cd949e83c6618da05f7ed`
**Scope:** Complete four-file product/test delta for the hosted notification reach repair; composed native inbox authorization, customer organization reach, comment visibility/private audience, staff authority/API-key clamping, and read/mutate behavior. Read AGENTS.md, agent-workflow.md, CLAUDE.md, active mission, notifications spec, RBAC, and relevant event catalogue. Reviewed prior hosted evidence as advisory and rechecked the candidate against source/spec. No source, PR, prior note, push, or merge was changed.

## Checks actually performed

- Inspected the entire four-file diff against the exact base and traced native reach evaluation through inbox list/read/bulk/clear paths, current resource resolution, identity resolution, and send-time eligibility.
- Read the authoritative notifications contract (`NO-18` through `NO-21`, permissions and resource mapping) and event catalogue recipient rule for `work_item.assigned`.
- Ran `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/notification/native-inbox-reach.test.ts`: **1 file, 4 tests passed**.
- Ran `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json`: **passed**.
- Did not run PostgreSQL integration, Docker, or browser checks, per assignment limits. The cited hosted PostgreSQL result is prior-run evidence, not reproduced here.

## Blocking finding

**Customer inbox authorization allows a staff-assignment event despite the customer notification contract.** In `apps/api/src/notification/native-inbox-reach.ts:45-63`, the customer branch checks customer-visible resource, current serving-organisation reach, and organisation-scoped `work_item:read`, but it does not restrict the event kind to events eligible for customer notification. The new integration fixture then inserts a customer `work_item.assigned` row and explicitly expects it in the customer inbox at `tests/api-integration/work-item-comment.test.ts:838-842,873-880`. The notification spec says `NO-19`: “Never about internal comments, internal activity or staff assignment changes”; the event catalogue defines `work_item.assigned` as an assignee-change event. This makes the customer authorization helper accept precisely a forbidden notification class if such a row exists (including a stale or incorrectly materialized row), and the test locks that behavior in. Require a customer-safe event-kind check at the read boundary (and align the fixture to an allowed customer event), or document a spec-authorized reason that assignment notices are safe for customers. Until resolved, the candidate does not establish the required customer privacy boundary.

## Other reviewed behavior

The new organization-level capability check is appropriately combined with `reaches` and uses the serving project's organization; it fails closed for a missing organization and preserves private requester/participant reach. Customer comment visibility and missing-resource checks are exercised. Staff retains work-item-scoped authority and API-key capability subset clamping. The route assertion verifies the customer session is rejected on the agent-host API. The focused unit suite passes.

## Limits / residuals

No PostgreSQL, browser, Docker, full API integration or hosted acceptance run was performed in this review context. The hosted run and fixture reconciliation reports were treated as evidence leads only, not as this review's tests or verdict.


---

### Authentic record: notification-hosted-repair-ordinary-b-luna.md

# Notification hosted repair — independent ordinary review B

- **Verdict:** BLOCKED
- **Reviewed head:** `2a38ea309a861157f4768d3b04b00c85a42e9159`
- **Comparison base:** `e561411f8852d9e9ff3cd949e83c6618da05f7ed`
- **Independence/provenance:** Fresh reviewer context assigned as ordinary reviewer B; did not author, direct, or remediate this candidate. Model identity exposed to this context: GPT-6; no more specific version string was exposed. Read-only review of the clean frozen worktree `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`.
- **Scope:** All four changed files; customer inbox authority, customer reach/private audience/comment visibility, key clamp, direct and bulk mutation test oracles, hosted-failure test repair.

## Blocking finding

**Customer notification read authority is granted from `person.side`, without the canonical organisation membership required by the product spec.** The changed `canReadNativeInboxCandidate` now passes customer identities through `can(identity, "work_item:read", "organisation", { organisationId: resource.organisationId })` ([native-inbox-reach.ts](/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2/apps/api/src/notification/native-inbox-reach.ts:57)). In the actual loader, `resolveIdentityFromFacts` returns `null` for an inactive person or inactive/deleted/portal-disabled organisation, but otherwise synthesizes the built-in customer `RoleGrant` directly from `person.side` and `person.organisationId`; it does not require or inspect an organisation-scope membership ([resolve-identity.ts](/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2/apps/api/src/permissions/resolve-identity.ts:408)). Thus an active customer-side person whose customer-role membership has been removed still satisfies the new capability check and can read, mark, bulk-mark and clear reachable notifications.

That conflicts with the current product contract: customer portal access is granted by a customer-side person **holding the built-in customer role on an organisation-scoped membership**, created by invitation/JIT/SCIM ([customer-portal.md](/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2/docs/03-features/customer-portal.md:219)); the data model calls this membership how a customer-side person holds the role ([data-model.md](/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2/docs/01-architecture/data-model.md:134)). The new fixture creates that role and membership in `addCustomerIdentity`, but the actual customer branch of the resolver explicitly ignores scoped memberships and builds its own grant. Therefore the fixture does not prove that canonical membership is required. Add a negative integration oracle that deletes/revokes the customer membership while leaving the person and organisation active and portal-enabled, then proves inbox list/read/bulk-read/clear deny it; the production authority path must make that oracle pass. The same correction may require aligning the shared customer identity resolver with the authoritative spec, rather than relying on fixture rows the resolver ignores.

## Checks and evidence

- Read repository `AGENTS.md`, active mission, `docs/04-engineering/agent-workflow.md`, provider adapter, relevant notifications/customer-portal/RBAC/data-model specs, decision-log search hits, the exact candidate diff, and the supplied adjudication/reconciliation/repair evidence. The supplied evidence was treated as context and rechecked against the frozen source.
- `git rev-parse HEAD` matched the assigned SHA; worktree was clean. `git diff --check <base> <head>` passed.
- `pnpm --filter @taskdesk/api typecheck` passed (API, permission, test, RLS-prototype and approvals E2E TypeScript projects).
- Biome on the four changed files reported no errors and five existing unused-variable warnings in `work-item-comment.test.ts`.
- Focused Vitest could not run: `pnpm exec vitest run tests/api/notification/native-inbox-reach.test.ts tests/api/permissions/resolve-identity.test.ts` returned `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "vitest" not found`. I did not install dependencies or alter the worktree.
- Per assignment, PostgreSQL integration, hosted CI, Docker, and browser checks were not run. The recorded 206-file/2,947-test hosted run and its three failures remain runtime evidence; this review does not claim the PG failures fixed or acceptance passed.

## Other reviewed behavior

The changed predicate preserves customer-private requester/participant filtering through `reaches(...visibleToPersonIds)`, rejects internal comments via `customerVisible`, fails closed for missing resources/event/person mismatch, and leaves staff work-item capability evaluation and `can()` key-subset clamping intact. Pure tests cover staff key allow/deny. The updated hidden-alert bulk oracle now compares the exact 105 retained alert IDs and checks the reachable row is absent; that is materially stronger than the prior row-count-only assertion. Customer direct/bulk mutation assertions reread persisted state, though their positive/negative authority fixtures currently inherit the membership defect above. The S3 `401` is correctly only an agent-host refusal; the repository-level assertions do not pretend it proves customer-host HTTP success.

## Runtime limits

No PostgreSQL integration, Docker/container boot, browser, or hosted CI validation was performed in this review. The ordinary code review is blocked by the membership-authority finding; this report is not security review or runtime acceptance.


---

### Authentic record: notification-customer-privacy-adjudication-sol.md

# #785 notification customer privacy adjudication — read only

**Frozen candidate:** `2a38ea309a861157f4768d3b04b00c85a42e9159` (base `e561411f8852d9e9ff3cd949e83c6618da05f7ed`). **Judgment: both ordinary findings are valid blockers for this candidate.** Neither is disposed by the earlier hosted-failure advisory, by a green focused unit test, or by calling the resolver's known gap accepted. This is a critical contract adjudication and a repair plan, not an independent review or approval of an authored successor.

**Provenance and limits.** Fresh read-only context; no authorship or remediation of the candidate. Read the frozen worktree's AGENTS.md, active mission, agent workflow, CLAUDE.md, current notifications, customer portal, RBAC, data-model and event contracts, recent decision log, both ordinary reports and the prior Sol hosted-failure advisory. Rechecked source, fixture, loader, portal admission, recipient and inbox paths at the exact SHA. `git rev-parse HEAD` matched; worktree was clean; `git diff --check` against the stated base had no output. No PostgreSQL, Docker, browser, push, source edit, or test execution was performed here. The ordinary reviewers' test results are their own evidence, not tests reproduced in this context.

## A. Customer staff-assignment notice — blocker on this candidate

`docs/03-features/notifications.md` NO-18–NO-20 prohibits customer notices for staff assignment changes, internal comments and internal activity; its default-recipient table names the **new assignee** for `work_item.assigned`. `docs/01-architecture/events.md` identifies that key as an assignee change. The general resource mapping at notifications.md § Permissions includes `work_item.assigned` for **staff** reach; it is not a customer event grant. `apps/api/src/notification/resource-contract.ts` likewise checks that a resource/event pair is mapped, not that a customer may receive it.

At `apps/api/src/notification/native-inbox-reach.ts:45-61`, the new customer branch checks live resource visibility, audience/reach and organisation capability but lacks event audience eligibility. Thus a planted or stale `work_item.assigned` row becomes readable and mutable. `tests/api-integration/work-item-comment.test.ts:838-880,936-959` explicitly asserts that forbidden row is listed, read and cleared. This is a concrete NO-19 violation, regardless of whether the normal event producer currently selects only staff. A read boundary must defend persisted rows independently of producer correctness. `work_item.unassigned` has the same staff-assignment class. An event kind can be supported globally and still forbidden to customers.

**Bounded repair:** add an event-audience eligibility rule at the shared native notification decision seam, before list/pagination and every direct or bulk mutation decision. It must allow a customer only when the existing event's recipient rule actually permits a customer **and** the concrete event is customer-visible; unknown kinds fail closed. Preserve the existing serving-project organisation, private requester/participant, live-parent and public-comment checks. `work_item.assigned` and `work_item.unassigned` must fail for customers; an internal comment must fail even with an otherwise eligible event key. A public comment or mention is a valid positive fixture only when the event's actual customer-recipient rule and resource audience are met. Do not reinterpret `customerVisible` on a work item as permission to reveal every event about it. Prefer a single reusable event-audience predicate shared by native inbox and producer/send-time eligibility, derived from existing recipient rules; `current-eligibility.ts` does not presently provide that predicate and its resource mapping alone cannot be reused as one. No new enum, capability or route is needed merely to fix the read seam.

Test through `tests/api/notification/native-inbox-reach.test.ts` and `tests/api-integration/work-item-comment.test.ts`: a current customer with a valid organisation membership can list/read/bulk-read/clear a permitted public event, while planted assigned, unassigned and internal-comment rows never appear, are not directly marked read, remain unread after bulk read, and remain stored after clear. Keep staff assignment access positive. Check counts/pagination after filtering and current reach after project or visibility changes. The positive oracle at lines 838/873 and clear oracle at 936 must be replaced, not preserved.

## B. Customer membership bypass — blocker on this candidate and a shared pre-existing gap

The authoritative portal contract (`docs/03-features/customer-portal.md:218-225`, `docs/01-architecture/data-model.md:134`) requires an active customer-side person **holding the built-in customer role in a persisted organisation-scoped membership** on their organisation. `apps/api/src/auth/repository.ts:385-423` checks such a row for portal admission through `hasCustomerPortalIdentity` (`auth.ts:260-263,958`). This confirms that the requirement is implemented at sign-in, not merely aspirational. It does not ensure an already-issued session or repository call retains that grant after revocation.

`apps/api/src/permissions/resolve-identity.ts:393-430` instead grants the built-in customer role and organisation reach solely from active `person.side` and organisation facts. The loader **does** fetch joined `membership`/`role` facts (`:742-827`), but the customer branch returns before examining them. Its historic KNOWN GAP 5 is a description of missing implementation, not a waiver or a later Thomas decision superseding the portal contract. The new `native-inbox-reach.ts:57-61` `can(..., 'work_item:read', 'organisation', ...)` consequently succeeds for a customer after membership removal. The fixture's inserted role/membership is a false assurance because removing it changes no resolver result. `inbox.repository.ts` calls the resolver for list (`:383-438`), direct mark (`:333-381`), bulk mark and clear (`:276-321`), so all these newly positive **native work-item/comment** paths inherit the bypass. The customer-agent-host 401 assertion only proves host/session rejection at that HTTP edge; it does not exercise repository authorization or establish a customer HTTP inbox route.

**Minimum dependency repair:** fix the shared `resolveIdentityFromFacts` customer branch and its already bounded loader inputs so customer identity/authority/reach exist only when exactly the own-organisation, scope-consistent, genuine built-in customer role membership is present. Continue ignoring workspace memberships and instance-admin bits for customers. Validate the persisted role's organisation scope, null workspace owner, system provenance and expected role key against existing role/membership facts; use the compiled-in built-in capabilities once the persisted grant is proved, or another explicitly spec-consistent role validation. Fail closed for missing, wrong-organisation, wrong-role, malformed or ambiguous membership. Reuse the existing joined scoped-role facts; a broad redesign of staff reach, grant ledger, portal policy, or new migration is not required for this defect. Align the portal admission predicate with that same authoritative test as feasible, so sign-in and subsequent reads cannot disagree. Remove/update KNOWN GAP 5 and unit tests that currently assert side alone grants the role. The resolver is shared, so inspect its customer callers and run its existing regression suites as part of the repair.

A notification-only membership query could mask this specific inbox symptom but leave `resolveIdentity` minting customer authority after revocation at other callers (including approval eligibility and mention recipient resolution). It is not a sound final repair for the shared contract. The candidate's new customer native read path is the reason this previously known gap now blocks this candidate; prior acceptance of unrelated work did not approve this behavior.

Add a meaningful PostgreSQL oracle: create an active, portal-enabled organisation and customer with a real customer role/membership, positive public eligible notification and forbidden planted rows; remove/revoke the effective membership **without** deactivating person or organisation, then verify `resolveIdentity` is null, `listVisibleNotificationRows` omits the native row, `markOwnReadableNotificationRead` returns no row and leaves `isRead=false`, `markReadableNotificationsRead` leaves it unread, and `deleteReadableNotifications` leaves it stored. Where a public portal action exists, also verify an existing session is refused on its next request. Restore the membership and prove positive reach returns. The direct/bulk mutation checks must reread persisted rows. Add pure resolver tests for no membership, wrong organisation, non-system or wrong role, ambiguity, valid member, and customer workspace-role isolation. Guard any other inbox resource types separately according to their own contract; a null native identity must never be treated as generic self authority.

## Boundary and gate implications

The supported repair remains an integration-freeze acceptance/security fix under the active mission. It does not authorize `/api/notification` on the portal host, a new `/api/portal/*` inbox route, or outbound activation. The existing agent-host 401 is a correct negative host-boundary oracle. Customer HTTP inbox behavior beyond the already specified portal preferences remains an owner/spec decision if product work later needs it; neither finding needs that decision to be fixed at the repository and identity seams.

A successor that changes `resolve-identity.ts` is security-scope and shared authorization behavior; classify its review tier from the actual delta. Run focused resolver and inbox tests, real PostgreSQL privacy/revocation integration, the required API/permission checks, and exact-head hosted CI and independent reviews. Preserve this blocked verdict on `2a38ea3`; no advisory or reviewer here can preapprove the successor.


---

### Authentic record: customer-membership-fixture-audit-luna.md

# Customer membership fixture dependency audit — read-only

**Purpose.** Inventory identity-resolution unit/integration fixtures that encode customer admission as `person.side = customer` or use a malformed organisation role, for the change requiring canonical own-organisation membership. This is a bounded advisory inventory, not an implementation review or approval.

**Contract checked.** `docs/03-features/customer-portal.md` § Permissions (around lines 218–225) says portal access requires an active customer-side person holding the built-in `customer` role on an organisation-scoped membership. `docs/01-architecture/data-model.md` §2 describes that membership as how a customer holds the role. Existing canonical built-in values come from `packages/permissions/src/roles.ts` (`scope: organisation`, rank 10, compiled capabilities). The in-progress `apps/api/src/permissions/customer-membership.ts` predicate additionally checks one own-organisation row, existing scope, `seesAll=false`, role key/scope, null workspace owner, system provenance and valid rank/capability shape.

## Fixtures needing alignment

| File and lines | Existing positive use | Why affected / minimal fixture action |
| --- | --- | --- |
| `tests/api/permissions/resolve-identity.test.ts:695–717` | Pure customer session expects customer authority and own-organisation reach with only `CUSTOMER_PERSON`. | Missing `scopedRoleMemberships`. Supply the canonical `CUSTOMER_MEMBERSHIP` fact. The in-progress table at 719–731 deliberately tests fail-closed missing, wrong organisation, non-system, wrong role, malformed capabilities and ambiguity; retain those negatives. |
| `tests/api/permissions/resolve-identity.test.ts:734–772` | Customer workspace-membership isolation and instance-admin isolation positives. | Both also currently omit the customer membership fact; add it while retaining the hostile workspace/admin facts. Otherwise they only assert a null result, not customer isolation. |
| `tests/api-integration/helpers/approval-fixtures.ts:378–424, 427–456` | Shared `addCustomer` fixture used by positive customer approval/inbox/portal tests. | It constructs `scope=organisation`, `key=customer`, rank 0, custom/default capabilities and no `isSystem`; canonical role rank is 10 and system provenance is required. Use/reuse the canonical built-in role and persist an own-org membership. Tests using it include `approval-closure-and-clock.test.ts:296–344, 346–360` and `approval-strict-enforcement.test.ts:101–127`. Preserve the intentional capability-removal assertion at 353–359 as a test of a transformed identity, not a fixture grant. |
| `tests/api-integration/project-reach-reads.test.ts:647–690` | “customer whose organisation is bound to a project” uses `callerReach` and expects the project's id. | The fixture creates a random `customer-${uuid}` role, rank 0, non-system, capabilities `work_item:read`, then attaches it to an org membership. That cannot prove built-in customer admission. Use the canonical customer role/member helper and keep the project's organisation binding/reach assertion. |
| `tests/api-integration/portal-identity-boundary.test.ts:67–75` (and admitted case at 80+) | Portal-auth boundary test seeds the admitted role. | Role has key customer but rank 0, empty caps and no `isSystem`; this is malformed under the shared canonical predicate. Seed canonical role metadata for the admitted positive. Keep `customer(..., false)` as the no-membership negative. |

## Canonical insertion helper and current in-progress work

`tests/api-integration/work-item-comment.test.ts:97–188` has a useful local `addCustomerIdentity` insertion pattern: it ensures a role row, verifies its built-in capabilities, creates a customer person and own-organisation membership. It is the closest existing positive helper to reuse or move into a shared API-integration fixture module. Harden its lookup to validate `isSystem`, built-in rank and scope/workspace ownership as well as key/capabilities; its current lookup does not select provenance/rank and can reuse a conflicting same-key role.

At audit time, the author had already changed the loader fixture in `tests/api-integration/resolve-identity.test.ts:34–93` to insert an org membership and query a system customer role, and had added a pure negative-case matrix to `tests/api/permissions/resolve-identity.test.ts:719–731`. Those are visible uncommitted author changes; do not edit them. The loader helper's reuse query should also check expected rank and canonical capabilities (currently it filters key/scope/null-workspace/system and selects only id).

## Keep these cases negative or outside this dependency

- `tests/api/permissions/resolve-identity.test.ts:719–731`: membership rejection controls should remain negative.
- `tests/api-integration/portal-identity-boundary.test.ts`: stranger with a customer person but no membership must remain refused.
- `tests/api-integration/strict-runtime-enforcement.test.ts:123–145, 784+`: bare customer person is only a requester/participant for a visibility fixture; this test does not use it as a resolved identity or positive customer session.
- Schema/placeholder rows in `tests/api-integration/p1-identity-schema-seed.test.ts` are not positive resolver assertions. Do not mechanically add memberships to all `side: customer` rows.
- Unit fixtures such as `tests/api/notification/native-inbox-reach.test.ts` construct `ResolvedIdentity` directly to test that seam; they bypass `resolveIdentity` intentionally. Keep them distinct from resolver admission tests.
- Work-item comment integration's local `addCustomerIdentity` is already the canonical positive shape (subject to the lookup hardening above).

## Shared call sites explaining fixture impact

Customer `resolveIdentity` calls are shared by `apps/api/src/approval/repository.ts:181`, `apps/api/src/work-item/mention-access.ts:74`, `apps/api/src/notification/inbox.repository.ts:148`, `apps/api/src/notification/current-eligibility.ts:165`, and `apps/api/src/notification/recipient-resolvers.ts:47, 162, 227`. A membership gate therefore changes admission at approval and mention/notification recipient paths as well as native inbox reads. This inventory is limited to fixtures that directly exercise those resolved customer identities or customer portal admission.

**Method limits.** Read-only file and source inspection in the assigned worktree; no tests, database, Docker, browser, source edits, commits or pushes were run. The author was actively editing shared worktree files during the audit, so cited “current in-progress” observations are time-bound; the remaining fixture findings refer to the checked-out source at their cited paths unless identified above as author edits.


---

### Authentic record: notification-customer-privacy-structural-repair-luna.md

# Customer notification and identity structural repair — GPT-6 Luna

## Result

Implemented on the frozen q580-b4 source at base `2a38ea309a861157f4768d3b04b00c85a42e9159`. This is a local candidate only; no review or approval is claimed. Original hosted log and adverse inventory/adjudication/reconciliation reports were not changed or reread. No PostgreSQL, Docker, or browser work was performed.

## Contract and repair

The customer event audience uses the existing recipient and privacy contracts in `docs/03-features/notifications.md` (recipient table, NO-18/NO-19, resource mapping) and `docs/01-architecture/events.md` (EV-5; public/internal comment semantics). Public comments and comment mentions are admitted only when the current comment is customer-visible and existing person/resource/project checks pass. A direct description mention is admitted only for the visible work item and its mentioned person. This retains the existing exact-recipient checks.

The five already-supported approval event keys (`approval.requested`, `.decided`, `.expiring`, `.expired`, `.withdrawn`) remain eligible at the shared audience gate. Existing current eligibility still binds the event to the current addressed approver or requester and rechecks approval visibility and reach. The existing approval notification behavior was not removed.

The shared customer gate denies assignment/unassignment, state transitions, escalation, due/overdue reminders, SLA events, internal comments, and unknown customer event families. These are outside customer recipient rules and NO-19 excludes staff assignment/internal activity. Staff audience and staff assignment notifications retain their prior path. This candidate does not claim complete NO-18 enforcement or a customer inbox HTTP success surface.

Customer admission now requires the exact existing built-in customer role on one own-organisation membership, with canonical scope, role provenance and built-in role facts. Identity construction uses compiled-in customer capabilities; persisted grants, workspace memberships, instance grants, or API keys do not create customer authority. Portal admission uses the same pure predicate and fails closed on missing, inactive, malformed, foreign, or ambiguous organisation membership. No role/capability, schema, migration, route, global evaluator, or host behavior was added.

## Changed files

- `apps/api/src/notification/customer-event-audience.ts` (new): shared customer event audience predicate.
- `apps/api/src/notification/native-inbox-reach.ts`, `current-eligibility.ts`: apply the shared predicate before inbox reach or delivery preference handling.
- `apps/api/src/permissions/customer-membership.ts` (new), `resolve-identity.ts`: canonical membership fact predicate and fail-closed customer identity resolution.
- `apps/api/src/auth.ts`, `apps/api/src/auth/repository.ts`: portal admission checks canonical person, organisation, membership, and role facts. The repository accessor materializes its result.
- `tests/api/notification/native-inbox-reach.test.ts`, `tests/api/notification-current-eligibility.test.ts`, `tests/api/permissions/resolve-identity.test.ts`: audience, existing staff-key subset, and identity predicate coverage.
- `tests/api-integration/helpers/approval-fixtures.ts`, `portal-identity-boundary.test.ts`, `project-reach-reads.test.ts`, `resolve-identity.test.ts`, `work-item-comment.test.ts`: canonical customer fixtures and membership-revocation/restore oracle. S3 retains the agent-host customer-session 401 and repository-level serving-organisation check; it adds no customer inbox HTTP-success claim. The oracle verifies identity/list denial, no-write and unread state, stored rows after clear, then restore. It was written but not run because PostgreSQL was explicitly out of scope.

## Verification

- API unit suite: **120 files, 865 tests passed**.
- `pnpm --filter @taskdesk/api typecheck`: passed across API, permissions, tests, RLS prototype, and approvals E2E TypeScript projects.
- Biome on all 15 changed TypeScript files: **no errors**. It reports five unused-variable warnings in `work-item-comment.test.ts`; four are unrelated existing test destructures, and one is the existing customer-mention case destructure.
- `git diff --check`: passed.
- Reviewed query-ownership checker source `7b5c54279095f0384e71964adc5bf31f979d8829` on the two new pure predicate modules: **2 files, zero findings**. Its all-source scan yields 4,629 existing baseline findings; the seven changed production source files likewise contain inline queries outside its repository-only policy. The changed auth repository file produces two other exported-query findings at file scope. These are checker scope limitations/findings, not represented as a clean full checker run.
- `pnpm test:permissions`: **15/16 files and 106/107 tests passed**; the sole failure was the unrelated `git-baseline.test.ts` no-merge-base case timing out. Relevant notification/reach permission tests passed.

## Limits

No API integration/PostgreSQL tests, Docker/image checks, browser verification, hosted tests, or production evidence were run. The membership revocation/restore and forbidden-event side-effect cases are authored integration oracles, not runtime evidence. The original three hosted failures have not been demonstrated fixed against PostgreSQL. This security-coupled candidate requires three fresh ordinary reviews and a separate fresh full GPT-6 Sol security review at its exact committed head; this report is not either review.

## Commit

Committed locally as `5fd2aeace13f64bccd7cb8b7ef0a29551db4c7b9` (`fix(notifications): enforce customer audience and identity`) on `codex/query-ownership-580-b4`. The worktree is clean. No push or PR action was performed.


---

### Authentic record: notification-structural-ordinary-a-luna.md

# #785 customer notification structural repair — ordinary review A

**Verdict: BLOCKED** at exact candidate `5fd2aeace13f64bccd7cb8b7ef0a29551db4c7b9` (comparison base `e561411f8852d9e9ff3cd949e83c6618da05f7ed`). One blocking contract mismatch remains: the new shared customer event predicate rejects every `work_item.transitioned` notification, including a public state change on the customer's own request. The documented internal-activity rule does not justify that blanket denial.

## Independence and scope

Fresh ordinary reviewer context; I did not author, direct, or remediate this candidate. I verified the clean worktree and exact HEAD. I read the current repository instructions and workflow, the notifications, events, RBAC, data-model, customer-portal, comments/activity, work-items and workflow contracts; the previous adverse adjudication and author handoff; and the changed event-audience, current-eligibility, native-inbox reach, membership resolver, auth, and tests. I reviewed the production list, direct-read, bulk-read and clear seams. I did not modify repository source, publish, commit, push, run PostgreSQL, Docker, or browser checks.

## Blocking finding: public transitions on a customer's own request are denied

`apps/api/src/notification/customer-event-audience.ts` admits customer work-item events only when they are `work_item.mentioned`; all other work-item event kinds return false. The comment in that predicate treats all work-item events other than direct mentions as non-customer-facing. `native-inbox-reach.ts` applies this before returning a native inbox row, and `current-eligibility.ts` applies it before send-time eligibility. The tests explicitly assert that `work_item.transitioned` is denied.

That suppression conflicts with the written contract. `notifications.md`'s default recipients table names watchers, assignee and requester for `work_item.transitioned`; `NO-18` limits customer notifications to their own requests, which includes the request's requester as a declared recipient. `NO-19` excludes internal comments, internal activity and staff assignment changes. But `comments-and-activity.md` `CA-7` specifically classifies a state-change `transitioned` activity as **public**. The customer portal exposes request status and specifies customer-facing state terminology (`CP-5`), and `events.md` `EV-5` requires a customer-safe projection rather than declaring status events categorically internal. Therefore a transition on a customer-visible own request cannot be rejected merely as internal activity. The candidate over-denies that class on both inbox access and current delivery eligibility.

The production event recipient resolver currently lacks a transition-specific customer fan-out, and no transition-specific customer notification title/body projection was found in the changed source. That means positive runtime evidence for this path is absent; it does not make the blanket denial consistent with the declared default-recipient and public-activity contracts. The missing projection details remain a contract/implementation gap to resolve before calling this candidate clear.

## Other reviewed areas

The two prior blockers are materially addressed in source: the shared event gate denies assigned/unassigned and internal-comment events for customers while preserving staff behavior and supported approvals; the shared identity resolver now requires one canonical own-organisation built-in customer membership and portal admission uses the same predicate. The native predicate is applied by the list path before visible pagination, direct mark-read, and bulk read/clear; revocation tests check no-write/store retention and restoration. The tests are meaningful source-level oracles for those decisions, but the PostgreSQL revocation and side-effect oracle was not executed here.

I found no additional blocker in the current-membership predicate by source inspection. Staff capability checks, API-key read-subset clamping, customer private requester/participant filtering, public-comment filtering, and unknown-event fail-closed behavior remain represented in the reviewed code/tests.

## Verification and limits

- `pnpm --filter @taskdesk/api exec vitest run tests/api/notification/native-inbox-reach.test.ts tests/api/notification-current-eligibility.test.ts tests/api/permissions/resolve-identity.test.ts` — **3 files, 113 tests passed** at the exact candidate SHA. These unit tests pass while asserting the blocking transition denial.
- `git diff --check e561411f8852d9e9ff3cd949e83c6618da05f7ed...HEAD` — passed.
- No PostgreSQL integration, full permission suite, hosted checks, Docker/image, browser, or runtime verification was performed. The prior hosted PostgreSQL red result remains red; no historical PG evidence clears this candidate.

This ordinary review does not approve the candidate, clear its prior hosted failure, or substitute for the other required ordinary reviews or fresh Sol security review.


---

### Authentic record: notification-structural-ordinary-b-luna.md

# #785 customer notification structural repair — ordinary review B

**Verdict: BLOCKED** at exact candidate `5fd2aeace13f64bccd7cb8b7ef0a29551db4c7b9` (comparison base `e561411f8852d9e9ff3cd949e83c6618da05f7ed`). The candidate's customer event predicate suppresses public state-transition notices, contrary to the documented event, notification-recipient and activity contracts.

## Independence and scope

Fresh ordinary reviewer context; I did not author, direct, or remediate this candidate. I verified `HEAD` equals the assigned SHA and the worktree is clean. I read the repository operating instructions, active status/decision context, notification, portal, RBAC, data-model and event contracts, the prior adjudication and repair report, and inspected all 16 changed files, with particular attention to customer membership resolution/admission and current/list/direct/bulk/clear notification reach. I independently compared the changed predicate with the authored integration oracle. No source or PR was changed and no commit or push was made.

## Blocking finding: public state transitions are categorically denied

`apps/api/src/notification/customer-event-audience.ts:27-29` admits only `work_item.mentioned` for customer work-item resources. Its comment classifies all other work-item events as assignment or internal activity. Consequently `work_item.transitioned` is rejected by both `native-inbox-reach.ts` and `current-eligibility.ts` before current recipient reach/preferences can make it eligible; the unit suite also asserts this denial.

That blanket rule conflicts with the checked-in contracts. `docs/03-features/notifications.md:45` lists the requester alongside watchers and assignee as a default recipient for `work_item.transitioned`; NO-18 limits customers to their own requests, which includes an eligible requester's own request. NO-19 excludes internal comments, internal activity and assignment changes, but `docs/03-features/comments-and-activity.md:76` explicitly classifies a state-change `transitioned` activity as public. The event catalogue includes `work_item.transitioned` in its notification column and EV-5 requires a customer-safe projection rather than excluding transitions (`docs/01-architecture/events.md:66,257-260`). Thus this candidate suppresses a public state change for the documented customer recipient class. The check must retain event-specific privacy and recipient restrictions while allowing a customer-safe transition on the customer's own request; current resource visibility alone is insufficient to establish that own-request relation.

I do not infer that a complete customer transition delivery path exists: current recipient resolution/projection does not establish positive transition fan-out, and the assigned task explicitly limits runtime evidence. The defect is the new shared predicate's categorical denial against the extant product contract, not a claim of end-to-end delivery acceptance.

## Other reviewed areas

By source inspection, the shared canonical membership predicate is used by both `resolveIdentityFromFacts` and `hasCustomerPortalIdentity`. It checks one own-organisation membership, scope existence, no `seesAll`, the genuine system customer role's key/scope/workspace/rank/capability values, and refuses missing, malformed, foreign or ambiguous organisation rows. The customer branch continues to ignore workspace memberships, instance-admin status and persisted customer capabilities; key credentials fail closed. The loader supplies joined role/scope facts. I found no additional blocker in that predicate.

The customer event gate blocks assigned/unassigned and internal comments while preserving the five supported approval event keys. Private requester/participant reach and public-comment visibility remain checked separately; staff checks and API-key capability clamping remain intact. The new PostgreSQL revocation/restore, list/direct/bulk/clear, and stored-row assertions are authored integration oracles only; they were not executed here. No actual PostgreSQL evidence is claimed.

## Verification and limits

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/permissions/resolve-identity.test.ts ../../tests/api/notification/native-inbox-reach.test.ts ../../tests/api/notification-current-eligibility.test.ts` — **3 files, 113 tests passed** at the exact candidate SHA. Passing tests include the transition-denial assertion that this review finds inconsistent with the spec.
- `pnpm --filter @taskdesk/api typecheck` — passed (API, permissions, tests, RLS prototype and approvals E2E TypeScript projects).
- `git diff --check e561411f8852d9e9ff3cd949e83c6618da05f7ed...HEAD` — passed.
- No PostgreSQL integration, full permission suite, Docker/image, browser, hosted check, or runtime verification was run. Author-reported full API units, Biome and permission-suite timeout are not represented as reproduced evidence here. Prior hosted PostgreSQL failures remain unresolved by this review.

This review does not clear the candidate, the prior hosted failure, the separate required GPT-6 Sol review, or the remaining ordinary review tier.


---

### Authentic record: notification-structural-ordinary-c-luna.md

# Ordinary review C — customer notification eligibility structural repair

**Model:** GPT-6 Luna (fresh ordinary reviewer context)
**Role:** Third independent ordinary panel review for broad shared auth/permission/notification coupling
**Reviewed head:** `5fd2aeace13f64bccd7cb8b7ef0a29551db4c7b9`
**Comparison base:** `e561411f8852d9e9ff3cd949e83c6618da05f7ed`
**Source:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, branch `codex/query-ownership-580-b4`; clean worktree at review start and end
**Independence:** Fresh reviewer context; did not author, direct, or remediate this candidate. No candidate edits made.

## Verdict

**BLOCKED.** One blocking spec mismatch independently confirmed. I found no additional blocker in the changed identity, membership, current-resource resolution, or recipient-coupling paths after inspection.

## Blocking finding

`apps/api/src/notification/customer-event-audience.ts` denies every customer `work_item.transitioned` event. `tests/api/notification/native-inbox-reach.test.ts` now explicitly expects that denial. The notification contract lists watchers, assignee, and requester as default recipients for `work_item.transitioned`; `NO-18` limits customer notifications to their own requests, and `NO-19` excludes internal activity and staff assignment changes. A lifecycle transition is a canonical public event (`events.md`, emitted through the lifecycle engine), not an internal comment/activity or assignment event. The new rule therefore suppresses an explicitly declared customer-recipient event for the customer's own request. The gate is used both by send-time current eligibility and inbox reach, so the suppression is not limited to one delivery surface.

Relevant sources inspected: `docs/03-features/notifications.md` event table and `NO-18`–`NO-21`; `docs/01-architecture/events.md` work-item event catalogue; `apps/api/src/notification/customer-event-audience.ts`; `apps/api/src/notification/current-eligibility.ts`; `apps/api/src/notification/native-inbox-reach.ts`; and the new negative test in `tests/api/notification/native-inbox-reach.test.ts`.

## Other coupled paths checked

- Canonical customer admission in `resolve-identity.ts` is derived from exactly one own-organisation membership backed by the compiled built-in customer role; persisted capabilities are not used as grants. The added check rejects stale/mismatched/duplicate organisation membership evidence and does not derive customer permissions from workspace/instance grants.
- The portal auth query now collects all membership scopes and role facts before applying the same canonical membership check. The query still filters inactive/placeholder people and suspended, disabled, or deleted organisations. The resolver and portal-admission path use the same helper.
- Current notification eligibility resolves the resource and scope again, applies customer event eligibility, current reach, capability authority, and (for approvals) the addressed requester/approver relation. The approval recipient resolver currently writes staff inbox rows only, consistent with its portal-approval contract; customer approval admission was not broadened by this patch.
- The customer event guard also rejects customer assignment/unassignment and internal comments, and admits only direct mentions, public comments, and the enumerated approval events. I did not identify another new authority or cross-tenant leak in those paths.
- `resolveMentionEventRecipient` was inspected as the insertion-time path; no finding is reported from it because this candidate does not modify it and the existing path's mention/comment constraints need a separate evidence-backed reproduction to establish a customer-visible violation.

## Checks and limits

- Verified exact HEAD and base SHAs; confirmed `git status --porcelain=v1` empty.
- Read repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, notification/event/customer-portal/RBAC contracts, changed production diff, and relevant tests.
- Attempted `pnpm exec vitest run tests/api/notification/native-inbox-reach.test.ts tests/api/permissions/resolve-identity.test.ts`; it could not start because `vitest` is not installed in this checkout (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`, command not found). No PostgreSQL-backed integration tests, full suite, Docker, or browser verification were run.
- This is a code/spec review only. It does not claim runtime or full-suite validation. Existing integration evidence cited by the author was not independently rerun or reused as a pass for this SHA.


---

### Authentic record: notification-public-transition-repair-luna.md

# Public customer transition notification reach repair — GPT-6 Luna

## Result

Applied the bounded delta on frozen base `5fd2aeace13f64bccd7cb8b7ef0a29551db4c7b9`. The existing customer membership/identity repair is byte-unchanged. No PostgreSQL, Docker, browser, HTTP route, event producer, or outbound channel work was performed.

## Contract and delta

The existing contracts establish the supported case: `docs/03-features/notifications.md` lists `work_item.transitioned` recipients as watchers, assignee, requester and NO-18 restricts a customer to their own requests; `docs/03-features/comments-and-activity.md` CA-7 marks state-transition activity public; `docs/03-features/customer-portal.md` CP-5 requires customer-facing terminology; `docs/01-architecture/events.md` EV-5 requires a safe projection. Therefore the shared audience predicate now admits a customer-visible `work_item.transitioned` event. Existing customer identity, customerVisible, serving-organisation/project/current reach, and private requester/participant checks remain in place. Assignment and unassignment, internal comments, unrelated internal activity, unknown events, and non-customer-visible resources remain denied. Staff behavior is unchanged.

Current notification eligibility reaches preference and current-reach checks for a supported transition but still returns `destination_unresolved` when only a staff URL is available. That pre-existing customer projection gap remains fail-closed. This change does not claim a delivery or transition-producer implementation.

## Changed files

- `apps/api/src/notification/customer-event-audience.ts`: include the documented public transition event in the customer audience.
- `tests/api/notification/native-inbox-reach.test.ts`: positive requester transition and negative non-customer-visible transition checks, through existing current reach and org capability.
- `tests/api/notification-current-eligibility.test.ts`: customer-visible transition reaches current checks and fails closed at the absent customer projection/destination seam.
- `tests/api-integration/work-item-comment.test.ts`: PostgreSQL-authored inbox list, direct read, bulk read, and clear cases for public transitions; immediate persisted rereads; keeps assignment/unassignment and internal-comment denials. The planted transition example uses customer-safe request wording and checks the listed projection. Existing agent-host customer-session 401 remains. This integration oracle was not executed.

## Verification and limits

- Full API unit suite: **120 files, 866 tests passed**.
- Focused native inbox/current eligibility unit tests: **2 files, 54 tests passed**.
- `pnpm --filter @taskdesk/api typecheck`: passed.
- Biome on all four changed TypeScript files: no errors; five existing unused-variable warnings remain in the surrounding integration test.
- `git diff --check`: passed.
- Reviewed query ownership checker source `7b5c54279095f0384e71964adc5bf31f979d8829` on the one changed pure production module: **1 file, zero findings**.
- PostgreSQL integration, Docker/image, browser, and hosted checks were not run. The authored PostgreSQL cases are not runtime proof. No customer inbox HTTP success route or transition producer/projection delivery is claimed. This is not an independent review; the bounded candidate requires the assigned fresh review panel and a separate fresh full GPT-6 Sol review at its exact commit.

## Commit

`6a76cf72923b3466d7b2a4cdbae18af6fe8d08be` (`fix(notifications): allow public customer transitions`) on `codex/query-ownership-580-b4`. Local commit only; no push or PR. The worktree is clean.


---

### Authentic record: notification-public-transition-ordinary-a-luna.md

# #785 public customer transition repair — ordinary A delta attestation

**Verdict: CLEAR for the bounded transition repair at exact composed head `c84df2f56030c375bba4ac9b7af8832852bce2c1`, relative to prior source `6a76cf72923b3466d7b2a4cdbae18af6fe8d08be`.** The prior ordinary A blocker at `5fd2aeace13f64bccd7cb8b7ef0a29551db4c7b9` is resolved: `work_item.transitioned` is admitted for customer-visible work items and remains subject to current customer reach, serving-project organisation authority and the existing private requester/participant audience. This attestation is limited to that delta and composition; it does not replace the remaining ordinary reviews or required Sol review.

## Provenance and scope

This is the same ordinary reviewer A context returning for an exact-head delta attestation; I did not author, direct, or remediate the candidate source. I verified `HEAD` and its parents, inspected the transition source/test delta from `5fd2aeac`, the author’s repair report, current notification/customer/activity contracts and the composed tree. I separately verified the accepted-main imports against `d93c0967ecc7b1a1d721ff25202737cd72430a0d` and the remaining product tree against `6a76cf72`. The earlier adverse report remains unchanged; this delta attestation does not rewrite that history.

## Delta assessment

`customer-event-audience.ts` now admits `work_item.transitioned` alongside direct work-item mentions after the shared `customerVisible` guard. It retains denial of assignment/unassignment, staff/internal activity, internal comments and unknown events. The production native-inbox path continues to bind the notification to its recipient, use current customer identity, current serving-project reach, organisation-scoped `work_item:read`, and the resource's requester/participant visibility set. The current delivery eligibility path applies the same customer event gate and reach checks. It reaches the existing preference check but fails closed with `destination_unresolved` because the customer projection has no established destination; no customer delivery is claimed.

The tests add a positive customer transition read on a customer-visible request, a negative read when customer visibility is false, and a current-eligibility case proving that a transition reaches current reach/preference checks but cannot cross the unresolved customer destination seam. PostgreSQL-authored integration assertions cover list content, direct read, bulk read, clear, and post-revocation no-write retention. The integration tests use planted, customer-worded inbox rows; they verify the read/mutation audience boundary, not an event producer or actual delivery implementation.

Composition check: HEAD is a two-parent commit with `6a76cf72` as first parent and accepted main `d93c0967` as second parent. The only imported files are `apps/web/src/components/task/task-description.test.tsx` and `docs/07-planning/security-reviews/776-task-description-editor-teardown.md`; both are byte-equal to accepted main. All remaining product paths are byte-equal to the prior `6a76cf72` source. The candidate does not alter the customer membership/auth repair or introduce a portal inbox route, event producer, customer delivery destination, or outbound channel behavior.

## Verification and limits

- Focused exact-head unit run: `pnpm --filter @taskdesk/api exec vitest run tests/api/notification/native-inbox-reach.test.ts tests/api/notification-current-eligibility.test.ts` — **2 files, 54 tests passed**.
- `git diff --exit-code d93c0967ecc7b1a1d721ff25202737cd72430a0d HEAD -- <two imported paths>` — passed; imported paths are byte-equal to accepted main.
- `git diff --exit-code 6a76cf72923b3466d7b2a4cdbae18af6fe8d08be HEAD -- apps/api/src apps/permissions tests/api tests/api-integration` — passed; there is no additional API/permission/test delta from the authored source.
- No PostgreSQL integration, hosted CI, full API suite, image/Docker, browser, or runtime check was run. Authored PostgreSQL cases remain unexecuted. The hosted PG failure on the earlier publication is not cleared by this delta attestation.

The 5fd ordinary A report remains adverse for its source. This report clears only its public-transition over-denial on the composed `c84df2f` source; it is not a full candidate approval, runtime acceptance, merge authorization, or a substitute for fresh independent security review.


---

### Authentic record: notification-public-transition-ordinary-b-luna.md

# #785 public customer transition repair — ordinary review B follow-up

**Verdict: CLEAR for the prior transition blocker** at exact candidate `c84df2f56030c375bba4ac9b7af8832852bce2c1`, compared with prior reviewed candidate `5fd2aeace13f64bccd7cb8b7ef0a29551db4c7b9` and transition repair commit `6a76cf72923b3466d7b2a4cdbae18af6fe8d08be`.

## Independence and scope

This is a follow-up from the ordinary B context that reviewed `5fd2aeace13f64bccd7cb8b7ef0a29551db4c7b9`; I did not author, direct, or remediate either candidate. I verified exact `HEAD`, clean status, the exact source/test diff, the authored repair handoff, and the supplied main-import conservation record. I assessed the sole blocker in my prior report against the existing notification, customer-portal, comments/activity and event contracts. No repository changes, PR actions, commits, pushes, PostgreSQL, Docker, browser or runtime work were performed.

## Prior blocker resolved

The prior report found `isCustomerEligibleNotificationEvent` rejected every `work_item.transitioned`, despite the documented requester-recipient rule, public state-transition activity and EV-5 customer-safe projection requirement. At this head, the shared predicate admits `work_item.transitioned` for a customer-visible `work_item` resource. The native inbox unit oracle confirms a current customer with serving-organisation capability and current reach can read the transition, and denies it when `customerVisible` is false. Current delivery eligibility reaches the preference/current-reach checks and then fails closed with `destination_unresolved` because this path has no customer destination. The customer transition title/body used by the authored integration oracle is customer-facing.

The same predicate continues to deny `work_item.assigned`, `work_item.unassigned`, other listed internal/staff activity, internal comments, and unsupported events. Existing current serving-organisation, project, recipient, private requester/participant, and membership checks remain in force. This resolves the categorical-denial blocker without establishing a new transition producer, customer inbox HTTP route, outbound activation, or delivery acceptance.

## Source conservation and verification

- Exact `HEAD`: `c84df2f56030c375bba4ac9b7af8832852bce2c1`; worktree clean.
- Compared with `5fd2aeace13f64bccd7cb8b7ef0a29551db4c7b9`, the only API production change is the shared customer event predicate. The authored integration delta adds public-transition list/read/bulk/clear assertions and preserves assignment/unassignment/internal-comment negatives. Auth, customer membership, identity resolution, and other production paths are unchanged.
- Compared with repair commit `6a76cf72923b3466d7b2a4cdbae18af6fe8d08be`, no `apps/api` path changed. The supplied `notification-editor-main-conservation.json` records the two accepted-main imports as byte-equal to main and all other paths byte-equal to the repair source.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/notification/native-inbox-reach.test.ts ../../tests/api/notification-current-eligibility.test.ts` — **2 files, 54 tests passed** at exact head.
- `git diff --check` on the transition production and test delta — passed.
- No PostgreSQL integration was run. In particular, membership revocation/restore and the new persisted list/direct/bulk/clear integration cases remain authored oracles, not database evidence. No hosted, Docker/image, browser or runtime verification is claimed. API typecheck and the full API unit suite were not rerun because the author reports them on `6a76cf7`, and no API production files changed between that commit and this head.

This follow-up clears the prior transition blocker only. It does not replace the other independent ordinary review, full GPT-6 Sol security review, hosted PostgreSQL acceptance, or any other required exact-head gate. The earlier adverse report remains unchanged.


---

### Authentic record: notification-public-transition-ordinary-c-luna.md

# Ordinary review C — public customer transition notification repair

**Model:** GPT-6 Luna (fresh ordinary reviewer context)
**Role:** Third independent ordinary panel review of the exact repair/composition head
**Reviewed head:** `c84df2f56030c375bba4ac9b7af8832852bce2c1`
**Previously blocked head:** `5fd2aeace13f64bccd7cb8b7ef0a29551db4c7b9`
**Repair source:** `6a76cf72923b3466d7b2a4cdbae18af6fe8d08be`
**Accepted main imported:** `d93c0967ecc7b1a1d721ff25202737cd72430a0d`
**Independence:** Fresh ordinary-review context. Did not author, direct, or remediate these changes. No source edits made. Prior adverse note `notification-structural-ordinary-c-luna.md` is preserved.

## Verdict

**CLEAR for the prior blocking finding.** The exact repair admits customer-visible `work_item.transitioned` on a work-item resource while preserving the existing customer visibility and read gates. This closes my prior spec mismatch: customer transitions for their own requests are now allowed under the documented default recipient rule and CA-7's public activity contract. Assignment/unassignment, internal comments and unrelated work-item activity remain denied.

## Exact delta and composition

- Confirmed HEAD is `c84df2f56030c375bba4ac9b7af8832852bce2c1`, clean worktree, and `5fd2aeace13f64bccd7cb8b7ef0a29551db4c7b9` is an ancestor.
- The repair commit changes the audience predicate and adds focused unit/integration cases. The composition commit adds exactly two paths from accepted main: `apps/web/src/components/task/task-description.test.tsx` and `docs/07-planning/security-reviews/776-task-description-editor-teardown.md`. Both are byte-equal to `d93c0967ecc7b1a1d721ff25202737cd72430a0d`.
- Confirmed notification repair files at the current head are byte-equal to repair source `6a76cf72923b3466d7b2a4cdbae18af6fe8d08be`; all changed auth and customer-membership source remains byte-unchanged from the previously reviewed `5fd2...` candidate.
- Independently inspected the conservation JSON in the evidence directory and confirmed its claimed changed-path sets against Git.

## Checks actually run

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/notification/native-inbox-reach.test.ts ../../tests/api/notification-current-eligibility.test.ts` — **2 files, 54 tests passed**.
- `pnpm --filter @taskdesk/permissions exec vitest run --config vitest.config.ts src/scope.test.ts -t 'N13'` — **1 passed, 26 skipped**. This confirms the permission-scope behavior cited under residual limits.
- Verified clean worktree and ancestry. `git diff --check` reports one trailing blank line in the imported, byte-equal main security review note; this is not introduced by the notification repair and was not edited.

## Residual limit

The new current-eligibility test mocks `can()` to true. The production `evaluateCurrentNotificationReachAndPreference` still checks customer work-item reads using `can(identity, "work_item:read", "work_item", ...)`; the canonical customer grant is organisation-scoped, and the permission evaluator refuses an organisation grant for project/work-item policy scope (confirmed by the focused N13 test and the existing native-inbox-reach implementation's organisation-scope handling). Therefore the test's `destination_unresolved` result is only the result after a mocked authority pass; with the real customer evaluator, the external-delivery path is suppressed earlier as `read_authority_lost`. This predates the bounded repair and is outside the reported outbound-delivery claim. No customer inbox HTTP route, event producer, PostgreSQL integration runtime, provider delivery, Docker, or browser behavior is claimed or was executed.

The candidate therefore clears the reviewed inbox audience blocker, while customer external notification delivery remains unproven and currently fails closed at the existing authority-scope check.


---

### Authentic record: notification-structural-security-current-sol.md

# #785 notification customer privacy structural repair — independent security review

**Verdict: CLEAR for source security at exact head `c84df2f56030c375bba4ac9b7af8832852bce2c1`.** I found no blocking new authority or customer-data disclosure in the composed candidate. This is a full security review of the implementation after ordinary A/B/C clearance, not PostgreSQL execution, outbound-delivery acceptance, an exact-head CI result, or merge authorization.

**Provenance and independence.** Sol-tier reviewer context `/root/notification_structural_security_current`, dispatched fresh by `/root` with no inherited author turns and no authorship, direction, remediation or ordinary-review role. The parent assignment specified a full Sol review; this context has no independent runtime model-version introspection, so the parent must record its actual spawn model in the publication provenance. Reviewed clean worktree `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2` at the SHA above. Comparison source is `e561411f8852d9e9ff3cd949e83c6618da05f7ed`, with accepted main `d93c0967ecc7b1a1d721ff25202737cd72430a0d` composed before the final repair. Read the current AGENTS.md, active mission, agent workflow, CLAUDE.md, notification/customer-portal/RBAC/data-model/events/comments contracts, recent notification decision, repair and adverse review records, source, tests and composition evidence. This review did not edit repository source or publish, commit, push or merge.

## Source assessment

- `customer-event-audience.ts` is a shared, closed customer event rule for both native inbox and current delivery eligibility. It requires current customer visibility. Public comments/mentions and direct work-item mentions remain eligible; all five already supported approval keys remain eligible for their separately checked addressee/requester relationship; public `work_item.transitioned` is allowed under the documented requester recipient and CA-7 public-state activity rule. Assignment/unassignment, internal comments and unrelated/unknown work-item events are rejected for customers. Staff event classes are unchanged.
- Native inbox pages, direct read, bulk read and clear select the authenticated user's rows; native work-item/comment rows additionally require the row's `personId` to equal a currently resolved identity, supported resource/event pairing, a live current resource, the serving project's organisation, private requester/participant audience when the request is private, current reach and read authority. The comment repository uses the comment's *current* visibility and excludes deleted/bodyless comments. The customer branch checks `work_item:read` at organisation scope, which is where its genuine built-in role is granted. A foreign-organisation item, lost membership, internal comment, forbidden stale event, or deleted resource therefore cannot become a native inbox response or direct/bulk mutation through the changed path. Mutations recheck within repeatable-read transactions and bind the same recipient/resource row before writing. This is source-level reasoning; the PostgreSQL oracle below has not run.
- `resolveIdentityFromFacts` now issues customer reach and compiled built-in capabilities only after one own-organisation membership with a genuine built-in customer role, matching scope, rank, capability list and system provenance. The loader supplies current membership/role/scope facts; workspace memberships, instance-admin bits and API keys do not create customer-side authority. Portal admission uses the same canonical predicate and checks active, non-placeholder person and active, portal-enabled, nondeleted organisation. Missing, foreign, duplicate, malformed or revoked organisation membership fails closed. Staff membership handling and key-capability clamping were not changed by this repair.
- Approval delivery still checks the current addressed approver or requester and approval state, visibility, reach and approver validity. The native inbox change does not add an approval resource reader. Customer external delivery for `work_item`/`comment` remains fail closed in production: `current-eligibility.ts` still asks `can(work_item:read, work_item)` for those resources, while the customer's canonical grant is organisation-scoped, yielding `read_authority_lost` with the real evaluator. The new eligibility unit mock passes that check and reaches `destination_unresolved`; that mock is not evidence of actual provider delivery. The historical outbound path is held, and this candidate neither activates a customer destination nor adds a portal HTTP inbox or an event producer.
- The final composition imports only `apps/web/src/components/task/task-description.test.tsx` and its #776 security note byte-for-byte from accepted main `d93c0967`; all other paths are byte-equal to `6a76cf72`. These imports do not alter notification authority. `git diff --check 6a76cf72..HEAD` flags the pre-existing trailing blank line in the accepted-main #776 note; it is not a new notification-source defect.

## Checks and limits

I ran focused Vitest at the reviewed head: **3 files, 114 tests passed** (`native-inbox-reach`, `notification-current-eligibility`, `resolve-identity`). The author reported API unit **120 files / 866 tests**, API typecheck and changed-file Biome pass on the repair source; those are author evidence, not reruns in this context. The permission suite's unrelated `git-baseline.test.ts` timeout left **15/16 files and 106/107 tests** passing in author evidence, not a full pass. The query-ownership checker was scoped to the new pure modules with zero findings; its all-tree baseline and changed-auth-repository findings remain and are not a whole-tree green result.

The PostgreSQL integration cases are authored but **not executed** here or on this head: positive public comment/mention/transition, foreign and private audience, direct and bulk read, clear, immediate persisted rereads after membership revocation/restoration, and retention of forbidden stale-event rows. The older hosted PostgreSQL run at `e561411f` failed three tests, so it cannot clear this candidate. I ran no PostgreSQL, Docker/image/health, browser, provider I/O, SIT or hosted exact-head checks. This verdict clears source-security review only; the conductor still needs the required exact-head runtime and CI gates before any merge or acceptance claim. It grants no waiver and does not claim #580, a stage, outbound notification delivery or portal inbox complete.


---

### Authentic record: notification-reach-auth-seam-inventory-luna.md

# #580 notification/reach/auth seam integration inventory

**Classification:** read-only integration readiness packet; advisory, not an independent review or approval.
**Inspected:** 2026-10-16, worktree `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`.
**Base:** `d93c0967ecc7b1a1d721ff25202737cd72430a0d` (accepted-main descendant visible locally).
**Notification/auth candidate:** `c84df2f56030c375bba4ac9b7af8832852bce2c1` (`codex/query-ownership-580-b4`; parent `6a76cf72923b3466d7b2a4cdbae18af6fe8d08be`).
**Reach/query candidate:** `67b934a94e93c8a1348c3a01ea57a7a190d9aad9` (`codex/query-ownership-580-b6`; parent `e49e88c97b96ba16293aab9f35e684e1446bfd18`).
The task payload's abbreviated/malformed SHA strings were resolved against local refs to these exact full commits. Do not treat either branch tip as accepted main.

## Contract anchors

Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the current #580 contract `docs/07-planning/security-reviews/query-ownership-notifications-580.md`, and the reach contract `docs/07-planning/security-reviews/query-ownership-reach-580.md`. The #580 D1–D4 provenance is the conductor implementation decision recorded on the still-unaccepted #780/#791 line per existing review records; this checkout's accepted-main decision log does not itself establish that provenance. Its presence in a candidate or carrier is not acceptance. Source query extraction must preserve existing authority decisions at the helper/service boundary; repository functions own query execution and return the queried facts/rows. Customer admission remains the canonical customer membership predicate plus compiled-in customer grant, and portal admission uses the same canonical predicate. Do not treat a repository extraction as authority to change these semantics.

## Diff and composition facts

`git diff --name-only base..785` reports 65 changed paths; `base..790` reports 33. `git merge-tree base 785 790` was run read-only. It reported no “changed in both” conflict markers. This establishes only mechanical three-way mergeability; it does not establish semantic integration or acceptance.

Common changed paths are `apps/api/src/database/executor.ts`, `docs/01-architecture/{monorepo-layout,multi-tenancy,security-model,tech-stack}.md`, `docs/04-engineering/{ci-cd,coding-standards}.md`, `docs/07-planning/security-reviews/764-query-ownership.md`, `tests/api-integration/database-executor.test.ts`, and `tests/api/database-executor.test.ts`. These are shared prerequisite/contract artifacts and must be byte/meaning checked in the eventual composition; do not land duplicate copies or overwrite D1–D4 documentation. The executor and its tests appear as additions on both branches from the common base and should converge to one identical copy.

No product source path changed by both diffs. In particular, 785's `apps/api/src/auth.ts`, `apps/api/src/auth/repository.ts`, `apps/api/src/permissions/resolve-identity.ts`, and `apps/api/src/permissions/customer-membership.ts` do not overlap 790's moved auth/reach helper sources. No auth source conflict was reported by merge-tree. This is a favorable composition seam, not a whole-#580 green finding.

## Concrete seam map

- **785 `apps/api/src/auth/repository.ts:getCustomerPortalIdentityRow(userId)`** changes the projection to include person/org state, membership scope/`seesAll`, role identity/scope/system/rank/capabilities; removes the organisation-scope and built-in-customer-role join filters and `.limit(1)`, returning all candidate joined membership rows. This is necessary input to canonical admission validation. Keep this full row set and do not reintroduce a permissive first-row choice.
- **785 `apps/api/src/auth.ts:hasCustomerPortalIdentity(userId)`** checks the first row's customer/person/org active/non-placeholder/portal/deletion facts, checks all returned rows bind to the same person and organisation, then calls `hasCanonicalCustomerMembership` over mapped membership/role facts. Preserve the all-row consistency check and predicate call.
- **785 `apps/api/src/permissions/resolve-identity.ts:resolveIdentityFromFacts`** now denies customer-side identity unless `hasCanonicalCustomerMembership(person.organisationId, facts.scopedRoleMemberships ?? [])`; customer capabilities still come from compiled-in `BUILT_IN_ROLES.customer`. The resolver query projection/mapping adds `roleIsSystem`, needed by the predicate. Preserve separation between membership admission and grant construction.
- **790 `apps/api/src/utils/access-lookups.repository.ts`** becomes the query owner for principal/session/API-key/workspace role and assorted reach facts. It exports `findUserRole`, `findActiveApiKeyByHash`, `findApiKeyOwnerStatus`, `listWorkspaceMembershipRows`, `findMembershipRole`, role/permission lookup helpers, among others. **790 `apps/api/src/utils/customer-principal.repository.ts`** owns the legacy `findWorkspaceMemberRole` and `findPersonSide` queries used by `isCustomerPrincipal`; these remain distinct from 785's stronger portal/customer admission predicate. Do not conflate the legacy “is customer principal” helper with portal authorization.
- **790 `apps/api/src/utils/workspace-member-roles.ts`** delegates row reads to `access-lookups.repository.ts` while retaining duplicate/ambiguity and genuine-built-in-role interpretation. **790 `apps/api/src/workspace/workspace-admin-reach.repository.ts`** owns workspace admin reach lookup/mutation queries. These helpers are a potential indirect dependency for query caller correctness, not a competing customer admission implementation.
- **Executor seam:** 785 notification repositories and 790 auth/reach repositories may need transaction executors. Preserve executor propagation exactly; database executor identity and transaction-scoped behavior must not be replaced by default `db` use in moved calls.

## Conservation requirements and regressions for protected composition

1. Carry both full diffs from the same accepted base or the explicitly reviewed successor; do not substitute either cumulative branch head wholesale.
2. Retain 785's complete customer membership facts, all-row same-person/same-organisation check, active/portal/non-placeholder gates, canonical predicate, and compiled-in grant. Retain 790's original query projections, predicates, limits, result shape, query ordering where meaningful, and `Executor` usage. Keep policy/decision documents canonical and deduplicated.
3. Add/retain integration regressions proving: a canonical organisation customer membership admits; missing/wrong-scope/wrong-role/non-system or ambiguous/multiple conflicting memberships deny; a mixed customer+staff/workspace grant cannot elevate customer identity; a role with forged persisted capabilities cannot change the compiled-in grant; cross-organisation/person rows deny; inactive/placeholder person and inactive/deleted/non-portal organisation deny. Exercise both portal preflight (`hasCustomerPortalIdentity`) and resolver mapping so they cannot diverge.
4. Retain 790 repository tests for exact query result mapping and caller behavior, including API-key active/expiry/owner-state checks, workspace membership/role ambiguity and assignability/reach denials. Run executor-using paths inside a transaction test where the contract calls for the supplied executor.
5. Inspect all exported repository functions/callers together. The existing notes say the 785 source checker found 3 initial findings and 0 final on its 36-file set, and records residual auth-repository export-builder findings; those are bounded checker observations, not blanket clearance of the combined path. Resolve/record the two auth-repository export-builder residuals at the eventual integration SHA. Re-run the required scoped query checker against the final combined file set and check exact source coverage before claiming that seam done.
6. If API-key attachment clamps intersect notification identity construction, preserve the 790 key/capability subset through 785's `resolveIdentity` call and verify no repository extraction drops it. Treat this as an external dependency to inspect; these two diffs do not show a shared product-source path there.

## Holds / limits

This packet did not edit files/refs/index, run tests, start PostgreSQL/Docker/browser, inspect hosted CI, or evaluate the entire program. Worktree remained at `c84df2f56030c375bba4ac9b7af8832852bce2c1` with the pre-existing branch status `ahead 7`, no working-tree changes. No protected composition, PR, commit, push, merge, independent-review verdict, gate waiver, activation, or #580 completion is authorized or implied. Exact-head checks, ordinary/Sol review requirements, accepted D1–D4 provenance/order, PostgreSQL/runtime evidence, and other recorded residuals remain separate gates.

## Clarification appended 2026-10-16

The task-provided full candidate IDs `c84df2f56030c375bba4ac9b7af8832852bce2c1` and `67b934a94e93c8a1348c3a01ea57a7a190d9aad9` are valid. My initial exploratory `git show` command mistyped those IDs; the earlier sentence attributing malformed IDs to the task payload is incorrect and should be disregarded. The verified candidate IDs above are unchanged.

The earlier phrase “No product source path changed by both diffs” was too broad. The narrower verified finding is: no **auth-function** source path is shared between the candidates, while `apps/api/src/database/executor.ts` is shared production source. `git rev-parse <candidate>:apps/api/src/database/executor.ts` returned blob `46ba36ee97ce4bbc71d787c27a999c4dc8021039` for each candidate, confirming byte-identical content. The path is absent at the stated common base, so the composition must retain one copy of this shared addition. This is a factual overlap clarification only; it is not clearance of executor semantics or integration.


## Full PostgreSQL failure repair and current independent reviews

**Reviewed head:** `af2d812a4569b21ca631abd732e1b7be9ee675e1`

The published d17 full PostgreSQL run failed five files and five tests of206files/2947tests; that result remains adverse. The five-test-file repair preserves canonical customer authority, permitted positive reads and JIT session admission, forbidden notification event privacy, and scoped denial/no-write oracles. Production authority bytes remain unchanged from reviewed c84. Accepted main f781 imports only the accepted records. Two fresh ordinary contexts clear the corrected delta; a fresh independent Sol context clears its full bounded security scope.

Ten authentic report versions follow, including the original incorrect portal-access diagnosis and its explicit correction, both ordinary BLOCKED attempts, and current clearances. Reports are reproduced unchanged. The first advisory is superseded on customer search by its follow-up; portal_access defaults true and is not the root cause. The failure advisers do not approve their proposed repairs. No PostgreSQL, image, outbound delivery, feature, carrier or mission acceptance follows from source review.

### Record 1

# #785 current PostgreSQL failure adjudication — read only

**Disposition:** PR #785 candidate `d17d389721a38999c50eb98861b9560b8dd01cd2` is red. Hosted PostgreSQL job `116743355171`, run `38829075711`, reports **206 files, five failed; 2,947 tests, 2,942 passed and five failed**. The preceding source-security verdict applied to `c84df2f56030c375bba4ac9b7af8832852bce2c1` and did not run PostgreSQL. The current commit is its direct child, so that source verdict and ordinary reviews cannot turn this runtime failure green. Accepted-main source for the composition was `d93c0967ecc7b1a1d721ff25202737cd72430a0d`.

**Provenance and independence:** Fresh Sol-tier read-only failure-adjudication context `/root/notification_current_pg_adjudication_sol`, assigned by `/root` with no authorship, direction or remediation of this candidate; actual model/version must be taken from the parent's spawn record, not inferred from this note. This is a diagnosis of observed failures, **not** independent approval of a repair I advise. The worktree `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2` was clean at the exact candidate head. I read AGENTS.md, CLAUDE.md, agent workflow, active mission, current decision log, RBAC, customer portal, notification, assignment, identity-provisioning and socket contracts, relevant source and five test fixtures. I consulted earlier hosted/privacy/current-security advisories as context and rechecked claims against source. I used `gh pr view 785 --json ...`, `git status`, `git rev-parse`, `git show --no-patch`, `rg`, and bounded `sed`/Python extraction of only failure headers and assertions from private raw log `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/785-pg-d17d3897.log`. I did not print SQL, fixture payloads or secrets, run tests or PostgreSQL/Docker/browser, edit product source, commit, push or change PR state. The observed results below come from hosted CI, not local reproduction.

## Failure findings

1. **`project-reach-reads.test.ts:724` — malformed positive fixture, with a genuine positive behavior to retain.** Hosted `assertSearch` expected `true`, got `false` for visible task content. This test creates a genuine system customer role and own-organisation membership, binds the visible project to that organisation, then drives `callerReach` and workspace-level filtered readers. But its organisation insertion at lines 649–654 does not set `portalAccess: true`; the new `resolveIdentityFromFacts` customer branch (`apps/api/src/permissions/resolve-identity.ts:393–415`) refuses a portal-disabled organisation. The failing assertion is therefore downstream of an invalid admission premise, not evidence to loosen project reach. Set this fixture's customer organisation active, noninternal and portal-enabled, retain the canonical role/membership, and assert a resolved customer identity and exactly one reachable bound project before checking labels/search/projects. Keep hidden-project/foreign and count tests. A real customer whose organisation is active and portal-enabled **must** still get this positive read; removing the positive would lose coverage.

2. **`work-item-assignable.test.ts:619` — stale status oracle, correct fail-closed result.** Hosted got `404` versus expected `403`. L4 converts a workspace member to `person.side=customer`, points them to the internal organisation and gives them a project-scope role, with no own-organisation canonical customer membership. Such a person has no resolved customer authority/reach. The route declares project reach required before its `work_item:read` capability (`apps/api/src/work-item/policy.ts:131–135`); RBAC's project-scoped rule says no reach yields the same `404` as missing, while in-reach/no-capability yields `403` (`docs/01-architecture/rbac.md:558–565`). The response leaks no roster. Update L4 to assert `404` **and** compare it to a missing-project response, while keeping a valid in-reach, no-capability fixture that asserts `403` separately. Do not manufacture customer project authority merely to preserve `403`.

3. **`work-item-comment.test.ts:753` — stale forbidden-event oracle, with a valid positive comment oracle immediately after it.** Hosted visible ids omitted the first planted id; the assertion at :753 expects `notifications[0]`, a `work_item.assigned` row. NO-19 explicitly forbids customer staff-assignment notifications. The current shared customer-event predicate (`apps/api/src/notification/customer-event-audience.ts`) rejects that event and admits eligible public `work_item.mentioned` comment rows. In the observed array, the public-mention id was present; the failure is at the assignment assertion before the public assertion. Replace the requester/participant assignment positives with exclusion and direct/bulk read/clear preservation checks. Preserve public-mention inclusion for requester and participant, internal-comment exclusion, same-organisation nonparticipant exclusion and foreign exclusion. Later `requesterItemId` read assertions at :769–781 also currently expect the forbidden assignment row to mutate; retarget positive mutation to the permitted public row and prove the assignment row remains unread/stored. Keep existing later transition/public-comment positives and private audience/membership revocation tests. Never widen the audience rule to make this fixture pass.

4. **`ws-project-reach.test.ts:624` — malformed positive fixture, while both socket denials remain required.** Hosted threw `customer identity not resolved` before comparing reach. The fixture at :582–611 creates an organisation without `portalAccess: true`, changes a workspace member's person to customer, and leaves only a workspace membership. The canonical resolver correctly refuses it; neither side nor a workspace membership is a customer grant. Create an active, portal-enabled customer organisation and genuine system built-in customer role with exactly one own-organisation membership; remove or ignore the stale workspace grant according to the test's intended shape. Then verify `reaches` follows the **project** organisation rather than workspace organisation, while both legacy and native sockets still deny customer `project:read` identically. Retain invalid-grant and revoked-membership negative cases as separate assertions; no portal websocket admission is implied.

5. **`identity/oidc-jit-login.test.ts:295/312` — malformed seeded default role, exposing a useful admission integration seam.** Hosted reached `expectJitIdentity`'s final sessions assertion: expected a customer session, got `[]`. Earlier assertions in that helper already found the JIT identity, `jit_default` grant and effective membership. The customer seed at :157–166 inserts `scope=organisation`, `key=customer`, but `rank: 0`, `capabilities: []` and default non-system provenance, while the built-in customer role is `rank: 10`, seven exact compiled capabilities and `isSystem: true` (`packages/permissions/src/roles.ts:196–204,263–270`). OIDC JIT accepts the id/scope/key and writes its grant, but the post-session `hasCustomerPortalIdentity` canonical check (`apps/api/src/auth.ts:261–286,990–999`) deletes the session. Repair the **fixture** by seeding the genuine built-in role shape, preferably through an existing canonical seed path. Then run the real PostgreSQL first-login test to prove actual customer JIT creates person/account/identity/provenance/effective membership **and retains a usable portal session**. Add/keep a separate tampered-role case proving session denial and no authority. This failure alone does not prove production JIT fails with a canonical role; neither does the redirect prove successful admission. Do not remove the post-login check or accept arbitrary role rows.

## Minimal coherent repair and gate

The five observed failures point to **four fixture/oracle corrections across five tests**, not to evidence for a new capability, route, schema or outbound notification activation. Use the one canonical customer setup (active, external, portal-enabled organisation; active non-placeholder customer person; exactly one own-organisation membership with the genuine system customer role and exact compiled role shape) in the positive reach, socket and OIDC fixtures. Where an intentionally invalid customer shape is the subject, assert the contract's denial at the correct layer. In the B1 notification test, preserve the current event audience and change its positive mutation target to the allowed public notification. Source changes should be limited to test fixtures and assertions unless a corrected, canonical positive case still fails in real PostgreSQL; any such failure requires a separate source diagnosis and fresh review.

Re-run these five focused PostgreSQL files, especially real first-login session retention, exact project-org reach, public/private audience and mutation preservation. Then rerun the full hosted PostgreSQL job and all required exact-head checks/reviews before publication or merge. Preserve existing membership-revocation, private audience, foreign organisation, forbidden-event, API-key, and staff denial cases. The currently failed candidate cannot merge. This advisory does not waive any gate, certify source behavior beyond the traced cases, or preapprove the repaired candidate.


### Record 2

# #785 customer legacy-search positive — read-only follow-up

**Judgment at `d17d389721a38999c50eb98861b9560b8dd01cd2`:** The failing customer `globalSearch` positive in `tests/api-integration/project-reach-reads.test.ts:718–727` is an invalid **controller-level** oracle. It does not establish a production customer-search defect. The customer identity and project reach are already valid: `organisation.portal_access` defaults to `true` in the schema. Explicitly setting it in a fixture may aid clarity, but **cannot** make this legacy controller return the expected task/comment/project results. This finding corrects item 1 and the broad “four fixture/oracle corrections” conclusion in my earlier `notification-current-pg-adjudication-sol.md`; that immutable first report should be read with this follow-up. The other four findings remain separate.

**Provenance and limits:** Fresh read-only follow-up by the same Sol-tier adjudication context `/root/notification_current_pg_adjudication_sol`, requested by `/root` after the controller's earlier return was identified. The actual model/version is in the parent's spawn provenance. I inspected the clean exact-head worktree, `apps/api/src/search/controllers/global-search.ts`, route/policy, `caller-reach.ts`, direct label/project controllers, the five-file test context, `docs/01-architecture/rbac.md`, `docs/03-features/customer-portal.md` and work-item permissions, and the accepted #740 source history (`0c17da39`). Commands were bounded `sed`, `rg`, `git log`, `git show` and `git status`; no source edits, tests, database, Docker, browser, push or PR state changes. This is neither a source-security review nor advance approval of a repair.

## Causal trace and contract

- The customer fixture creates an own-organisation genuine built-in role/membership and binds the visible project to that organisation (`project-reach-reads.test.ts:639–699`). Although it omits `portalAccess`, the schema and migration default it to `true` (`apps/api/src/database/schema.ts:1684`; migration `0052`). The hosted run passes the exact visible-project `reachableProjectIds` assertion at :711 and fails later at `assertSearch` :724. **My earlier report incorrectly treated the omitted field as false and identified it as the cause.** The customer reach setup is a valid positive. Keeping `portalAccess: true` explicitly would document the premise but does not repair the failure.
- Independently, `globalSearch` selects `workspace_user` rows for the supplied user and returns `{ results: [], totalCount: 0 }` when none exist **before it invokes `reachableProjectIds`** (`apps/api/src/search/controllers/global-search.ts:139–164`). The fixture intentionally creates no workspace-user row. Adding one to force the test green would misrepresent customer admission and weaken the portal-only boundary. Removing that early return for customers would be a product/authority change, not a fixture correction.
- The actual `GET /api/search` route is guarded by `workspaceAccess.fromQuery()` and `workspace:read` (`apps/api/src/search/index.ts:26–38`, `policy.ts:60–66`). The built-in customer role has no `workspace:read`; the customer portal API is the separate `/api/portal/*` surface. RBAC explicitly says customers get `403` on agent item-scoped work-item/legacy task routes, and `POST /api/work-items/search` gets `403` for a customer (`rbac.md:467–474`). The customer portal's listed reads use `own_request` and `own_organisation`, not an agent legacy global-search endpoint (`customer-portal.md:218–260`). Thus neither the direct call's positive legacy result nor an HTTP 200 from agent search is a supported customer promise.
- RBAC's “workspace-level lists and search return only what the caller reaches” (#740, `rbac.md:606–615`) is a **filtering bound on authorized callers**. Its mention of customer organisation as a reach source does not grant `workspace:read`, create a workspace-user row, or override the portal-only rule. The direct `callerReach.reachableProjectIds([workspaceId])` positive is meaningful for the shared project-organisation reach predicate. The direct `getLabelsByWorkspaceId` and `getProjects` calls with that set are meaningful SQL filtering tests, but their direct invocation does not establish that a customer can use the guarded agent routes.

## Precise legitimate oracle without widening customer authority

Keep the already valid customer positive fixture and assert: (1) current `callerReach.reachableProjectIds` is **exactly** the bound visible project id, not the hidden project; (2) direct label/project list functions given that exact set include only visible project-bound rows and preserve their count/rollup privacy invariants; (3) a missing or revoked organisation membership collapses reach to `[]` in a separate negative control. For `globalSearch`, retain its substantive positive and hidden-row/count assertions under a **real workspace-member staff caller with actual project reach**, which this same test file already exercises through HTTP for staff. A focused direct-controller test may pass that staff user and its own `callerReach` callback to prove the SQL path receives the reachable set and filters before paging. Do not claim that staff result proves a customer search route. If the customer case continues to call `globalSearch` directly, its contract-consistent result with no workspace-user row is zero, and the customer-specific project-reach proof belongs to the reach/list seams above. Also keep an HTTP customer-agent-search denial assertion if desired, using the correct host/session setup; it must not be turned into a 200.

No open product decision is needed to fix this test without new scope. If an actual **customer legacy global-search** experience is desired, the owner must first decide and document a portal-specific route, result visibility/redaction and policy; that is outside this integration repair. Do not add workspace membership, grant customer `workspace:read`, remove the controller's workspace-user bound or expose legacy task/activity shapes to the portal to satisfy this oracle.

**Next safe action:** Repair only this customer's positive test split as above, keep the other four PostgreSQL repairs running independently, then run focused real PostgreSQL and the exact-head hosted job. The current failed result and review gates remain in force.


### Record 3

# Notification hosted PostgreSQL failure inventory

Candidate: `d17d389721a38999c50eb98861b9560b8dd01cd2` in `q580-b4`.
Hosted run: job `116743355171`, run `38829075711`; 206 files, 2,947 tests, five failed (2,942 passed). The raw runner log remains private; this report excludes SQL, parameters, and fixture payloads.

| Failure | Source/runtime evidence | Contract-aligned fixture/oracle repair |
|---|---|---|
| `project-reach-reads.test.ts` customer-bound project case | Test inserts a customer person and canonical customer role/membership, but its organization omits `portalAccess: true`. The canonical fixture must be admitted. Direct controller `globalSearch` additionally requires workspace reach, while the customer portal contract is own-request access; that assertion’s intended scope is unresolved and is held unchanged. | Set active/external/portal-enabled canonical organization; assert resolved customer identity and exact project-org reach. Do not add workspace identity or alter/drop global-search assertions until adjudicated. |
| `work-item-assignable.test.ts` L4 | Fixture changes a staff person into customer and grants only project membership; customer has no canonical own-organization membership, so missing/invalid project admission returns 404. Existing same-workspace project-reached/no-capability case separately asserts 403. | Expect the indistinguishable 404 and compare with missing-project response; keep separate 403 case intact. |
| `work-item-comment.test.ts` B1 | The failing expected notification is planted `work_item.assigned` at index 0, excluded by NO-19. The eligible public mention is index 1; private/internal comment and foreign/nonparticipant rows remain negative controls. | Exclude assignment from requester/participant list, retarget positive direct-read to the public mention; preserve assignment unread and stored through direct/bulk/clear; retain private, internal, foreign, and nonparticipant negatives. |
| `ws-project-reach.test.ts` customer case | Side is changed on a workspace staff person without canonical customer membership; organization also lacks portal admission. The project’s organisation differs from the workspace organisation, which is the intended reach distinction. | Use an active external portal-enabled org and exact built-in customer role/own-org membership; keep workspace membership as an ignored fact. Preserve both legacy/native `project:read` denials. |
| `identity/oidc-jit-login.test.ts` customer JIT | Seeded role is rank 0, empty-capability, non-system rather than exact `BUILT_IN_ROLES.customer` provenance. Session admission therefore fails despite the test expecting a usable customer portal identity. | Seed built-in rank/capabilities/system provenance, retain first-login grant and session assertions, add meaningful tampered-role refusal if absent. |

The inventory distinguishes stale fixtures/oracles from product contract. No assertion was removed to obtain a green run. The project `globalSearch` scope remains pending; no customer workspace grant or portal route is inferred.

## Adjudication correction

The initial row for the project-reach customer fixture was corrected after Sol verified `organisation.portalAccess` defaults to `TRUE` (`apps/api/src/database/schema.ts:1684`). Its omitted value was not the cause. The hosted failure there was the direct legacy search controller's empty result because this customer fixture has no `workspace_user`; the customer portal contract does not grant workspace search. The repair keeps resolved customer identity and exact organization/project reach plus direct label/project positives, moves the hidden-row/search-count oracle to the real staff project-reach user, and asserts the customer portal cookie is refused by agent `GET /api/search`. No customer workspace membership or capability was added.


### Record 4

# Hosted notification fixture/oracle repair

Base: `d17d389721a38999c50eb98861b9560b8dd01cd2`; hosted run `38829075711` (206 files / 2,947 tests / 5 failures, 2,942 pass). Raw PG log is private and not reproduced here. This candidate changes test fixtures/oracles only; no production source, policy, role, route, or schema changed.

## Exact scope

- `tests/api-integration/project-reach-reads.test.ts`: customer fixture explicitly declares active/external/portal-enabled org; asserts resolved customer identity and exact own-organization reach; keeps customer label/project positives; agent search is denied to customer portal session. Legacy generic search's visible/hidden rows and count remain asserted with the real staff project-reach principal and its own `callerReach` result. This is consistent with legacy `GET /api/search` requiring workspace authority; no customer workspace grant is invented. `portalAccess` defaults true (`apps/api/src/database/schema.ts:1684`), so explicit true is clarity, not root-cause repair.
- `tests/api-integration/work-item-assignable.test.ts`: invalid project-only customer grant gets 404 matching missing-project body; existing valid-in-reach/no-capability 403 test remains untouched.
- `tests/api-integration/work-item-comment.test.ts`: B1 assignment notification excluded from requester/participant visibility; public mention remains positive and private/internal/foreign/nonparticipant cases remain negative. Direct read, bulk read, and clear are checked with immediate persisted rereads proving the assignment remains unread and stored.
- `tests/api-integration/ws-project-reach.test.ts`: canonical built-in customer role provenance plus own-organization membership and portal-enabled organization; project organization vs workspace organization distinction retained; both socket `project:read` negatives remain.
- `tests/api-integration/identity/oidc-jit-login.test.ts`: JIT role uses `BUILT_IN_ROLES.customer` rank/capabilities and system/noneditable provenance; positive customer portal session cookie remains asserted; a tampered-role denial checks no portal session cookie/row.

## Contract scope and limits

The source's current hosted result fails the five test files above; this repair only aligns fixtures/oracles with canonical admission, NO-19's exclusion of staff assignment notifications, missing-project indistinguishability, and workspace-scoped search authority. It does not claim a green hosted rerun. No local PostgreSQL, Docker, or browser test was run, as instructed. The direct/list/bulk side-effect checks are authored as integration regressions but await the hosted PostgreSQL runner.

## Validation

- `pnpm typecheck` — passed (9 packages).
- Scoped `pnpm exec biome check` — passed with five existing unrelated `noUnusedVariables` warnings in `work-item-comment.test.ts`; no formatting/import errors.
- `git diff --check` — passed.

Committed local candidate: `509ee11f34664c39a521e85b7bb7d558a86537b0` (`test: align hosted notification fixtures with contracts`). Worktree is clean; no push or PR was performed.


### Record 5

# #785 hosted PostgreSQL fixture repair — independent ordinary review A

- **Verdict:** BLOCKED for the test-only repair composed at exact head `6a3057c86a59c2609dbaaafe48db7104b40c9e11` by the unscoped OIDC negative session assertion below. Other changed assertions and fixtures align with the traced contracts and observed failure causes. This does not establish that the PostgreSQL suite passes on this head.
- **Comparison base:** `d17d389721a38999c50eb98861b9560b8dd01cd2` (the failed hosted candidate; repair commit `509ee11f34664c39a521e85b7bb7d558a86537b0` is an ancestor of the reviewed head).
- **Independence/provenance:** Fresh reviewer context assigned by `/root` as ordinary reviewer A; I did not author, direct, or remediate the candidate. Dispatch requested the GPT-6 Luna ordinary-review tier. Runtime identity exposed to this context: GPT-6; no more specific version string was exposed, so the requested tier is not presented as independently verified runtime identity.
- **Source/worktree:** assigned worktree `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2` was clean at the requested exact head `6a3057c86a59c2609dbaaafe48db7104b40c9e11`. The intervening merge from accepted main adds only the three conductor-record files; the repair commit's five test files are unchanged. I inspected the exact candidate object and the composed head.

## Review findings

### Blocking finding

**The tampered-role OIDC negative can pass or fail because of an unrelated customer session.** In `tests/api-integration/identity/oidc-jit-login.test.ts`, the new denial case queries `sessionTable.findFirst({ where: eq(sessionTable.portal, "customer") })` and expects `undefined`. That checks the whole database rather than the attempted JIT subject/connection. A surviving customer session for an unrelated user would make the assertion fail even if tampered admission correctly created no session; conversely, the empty database assertion does not pair the denial with a meaningful unrelated-session survival control. Scope the absence assertion to the JIT attempt's user or connection (using the created external identity/user association as appropriate) and retain/create a distinct unrelated customer-session control whose row survives the denied attempt. Until this test establishes both properties, the candidate is blocked at ordinary review.

### Other reviewed behavior

- **Customer project reach and search:** The customer fixture now has an active, external, portal-enabled organisation, the canonical built-in customer role shape and one own-organisation membership. It asserts a resolved customer identity and exact reach to the one bound project, retaining the positive label/project filtering checks. The legacy customer `globalSearch` positive is removed: that controller requires a workspace-user row, and `GET /api/search` requires staff workspace authority. The substantive visible/hidden/count search oracle remains under a real project-reach staff caller. The customer request still asserts denial on the customer portal session. This follows the corrected Sol adjudication; explicit `portalAccess: true` is fixture clarity because the schema defaults it true.
- **Assignable roster:** The no-canonical-customer-grant case now expects 404 and compares the response body with a missing-project request. This matches the project-reach-before-capability contract. The separate valid-in-reach/no-capability 403 case is outside the changed lines and remains intact.
- **Customer notification audience and mutation:** Requester/participant assignment rows are now excluded per NO-19, while the public-comment mention remains a positive and internal, nonparticipant and foreign rows remain negative. Positive direct read still mutates the permitted mention; the forbidden assignment row is checked after direct read, bulk read and clear, with persisted rereads proving it remains unread and stored. This preserves both audience and mutation coverage without broadening customer visibility.
- **Socket reach:** The customer fixture now creates an active portal-enabled organisation and a genuine built-in customer role with an own-organisation membership. It binds only the serving project to that organisation while the workspace keeps its operating organisation; the existing legacy and native `project:read` denials remain. The extra workspace grant inherited from the staff fixture does not create customer reach: the resolved customer reach branch in `reaches()` consults the organisation ids and the project's organisation id.
- **OIDC JIT:** The positive customer seed now matches `BUILT_IN_ROLES.customer`, including rank, exact capabilities and system/noneditable provenance. The successful callback asserts the portal session row through `expectJitIdentity` and the returned portal-cookie name. The tampered built-in-role case asserts an identity error, no portal cookie, and no customer session row. These exercise both canonical admission and denial without changing auth code. The positive test does not make a follow-up request using the cookie; its evidence is the callback-issued cookie plus matching persisted session, not an independently exercised authenticated portal request.

The reviewed contracts include `docs/03-features/notifications.md` NO-18/19, the RBAC project-reach and socket rules, customer portal identity scope, and identity provisioning IP-9/IP-10. I cross-checked the candidate against the authentic fixture-repair and two customer-search adjudication records, including the later correction that the customer search failure was a controller-level oracle issue. Those records informed review but did not substitute for checking the actual diff and source.

## Checks and limits

- `git show`, ancestry check, and `git diff` — exact repair commit and composed `6a3057c86a59c2609dbaaafe48db7104b40c9e11` inspected; five test files plus three accepted-main conductor-record files since the failed hosted base.
- `git diff --check d17d389721a38999c50eb98861b9560b8dd01cd2 509ee11f34664c39a521e85b7bb7d558a86537b0` — passed. Checking through composed head also reports trailing whitespace and an added EOF blank line in the imported `takeover-checkpoint-20261016.md`; these are in the accepted-main review record and are outside the notification test delta.
- I did not rerun typecheck or Biome. The fixture-repair report records them as passing on the candidate; that is author evidence, not a rerun in this review.
- I did not run focused tests, PostgreSQL, Docker, or browser checks. The assigned environment reported PostgreSQL/Docker/browser unavailable, and these changed files are PostgreSQL integration tests. The hosted parent result remains **206 files / 2,947 tests: 2,942 passed, 5 failed**; it is evidence for why the repair was made, not a result for this candidate.

This ordinary review covers only the test-only delta at the exact head and remains blocked by the finding above. It is not a hosted rerun, security review, merge authorization, or acceptance claim.


### Record 6

# Ordinary review B — hosted notification fixture repair

**Verdict: BLOCKING FINDING.** Do not advance this candidate to the Sol gate until the newly added OIDC negative assertion is scoped to the tested JIT connection/user. The five-file repair otherwise follows the adjudicated contracts by inspection. No changes were made.

## Provenance

- Review role: fresh independent ordinary review, context `/root/notification_pg_repair_ordinary_b` (assigned without inherited author turns).
- Model selector: GPT-6 Luna (ordinary-review tier assigned by conductor). No model-runtime/version metadata was exposed to this reviewer beyond that selector.
- Exact reviewed source: `6a3057c86a59c2609dbaaafe48db7104b40c9e11`.
- Candidate under review: `509ee11f34664c39a521e85b7bb7d558a86537b0`; base `d17d389721a38999c50eb98861b9560b8dd01cd2`.
- Worktree: `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`.
- Candidate diff contains only the five assigned test files; no product source changes. Worktree remained clean.

## Finding

`tests/api-integration/identity/oidc-jit-login.test.ts` adds a tampered-customer-role refusal assertion that checks `sessionTable.findFirst({ where: portal = "customer" })` is undefined. That predicate is global to the test database and is not tied to `jit-tampered-customer-role-connection`, its identity, or its user. Other tests in the full integration suite create customer portal sessions, so this can fail based on test ordering or shared database contents even when the attempted JIT login correctly creates no session. It also does not prove that this attempted login created no session: an unrelated row can satisfy it. Filter by the connection/user of this attempt (or snapshot/query the exact identity-associated user) and retain the cookie refusal assertion. This is a blocker because the candidate's authored negative control is not isolated and cannot reliably establish its claimed invariant.

## Scope reviewed

- Compared the complete candidate diff against its base and verified the only changed paths are the five assigned integration tests.
- Read the notification, RBAC, API-design and customer-portal contracts, plus the supplied fixture inventory and Sol correction adjudication.
- Confirmed the search change preserves a genuine customer identity and exact organisation reach, denies customer access to agent search, and retains search hidden-row/count assertions through a real project-reached staff principal. It does not invent workspace membership or customer `workspace:read`.
- Confirmed the assignable test compares the invalid customer grant response to a missing-project response; the separate reached/no-capability 403 test remains.
- Confirmed the notification test switches the positive recipient oracle from the excluded assignment event to public mention and checks assignment persistence/unread state after direct, bulk and clear operations. Private/internal/foreign/nonparticipant negatives remain in the surrounding test.
- Confirmed the websocket customer fixture adds built-in customer role provenance and own-organisation membership while keeping project-organisation distinct from workspace organisation and retaining both socket denials.
- Confirmed OIDC fixture uses `BUILT_IN_ROLES.customer` values and adds a positive portal cookie check. The tampered-role refusal is semantically aligned, subject to the global-session query blocker above.

## Validation

- `git diff --check 509ee11f^ 509ee11f` — passed.
- `pnpm typecheck` — passed, 9 packages (Turbo reported all 9 cached).
- No PostgreSQL integration test, hosted runner, Docker or browser run was performed, consistent with the bounded review assignment. Prior hosted failure remains the base evidence: 206 files / 2,947 tests, five failures (2,942 passing); this review does not establish a green rerun.

## Non-blocking observations and limits

- The explicit `portalAccess: true` in the customer reach fixture documents the premise; the Sol adjudication correctly notes the schema default is already true and this is not itself a repair.
- Typecheck and source inspection cannot establish runtime test isolation or hosted PostgreSQL behavior. The exact-head hosted rerun is still required after the blocker is fixed.
- No independent security verdict is supplied here; the fresh Sol pass remains a separate required gate.


### Record 7

# Scoped OIDC customer-session denial regression

Candidate base: `6a3057c86a59c2609dbaaafe48db7104b40c9e11` (ordinary reviews A and B identified the same sole blocker). Candidate commit: pending at report creation.

The only source file changed is `tests/api-integration/identity/oidc-jit-login.test.ts`; no product/auth source changed. The tampered-role negative now has a non-vacuous, identity-scoped control:

1. Sign in a distinct, canonical customer JIT identity and retain its legitimate customer session as the unrelated-session control.
2. Sign in the target canonical customer connection and assert its created identity matches that exact connection and `SUBJECT`.
3. Delete only the target identity user's session and reread to confirm the starting state.
4. Tamper that connection's configured customer role and retry sign-in. Assert identity-error redirect, validator invocation, no portal session cookie, and continued exact connection+subject identity association.
5. Query customer sessions by portal and the exact target identity user; require none. Separately reread the unrelated customer's portal session and require it survives.

This covers the refused retry's subject/user without relying on a database-global “no customer sessions” assertion. It preserves the other legitimate session as a control and makes no product-behavior change.

Validation: scoped Biome passed; `pnpm typecheck` passed (9 packages); `git diff --check` passed. No PostgreSQL integration test, Docker, or browser was run. The negative test awaits the hosted PostgreSQL runner and the independent ordinary/Sol reviews.

Committed locally as `af2d812a4569b21ca631abd732e1b7be9ee675e1` (`test: scope tampered OIDC session denial`). Worktree is clean; no push.


### Record 8

# #785 OIDC session-oracle repair — independent ordinary review A delta

- **Verdict:** CLEAR for the bounded OIDC test delta at exact head `af2d812a4569b21ca631abd732e1b7be9ee675e1`. It resolves my previous blocked finding about the database-wide customer-session absence assertion. This verdict covers only this delta and relies on my prior review of the other four test files; it does not establish PostgreSQL pass or merge readiness.
- **Comparison base:** `6a3057c86a59c2609dbaaafe48db7104b40c9e11`.
- **Independence/provenance:** Fresh reviewer context assigned by `/root` for this exact delta as ordinary reviewer A. I did not author, direct or remediate it. Dispatch requested the GPT-6 Luna ordinary-review tier. Runtime identity exposed to this context: GPT-6; no more specific version string was exposed, so requested tier is not presented as independently verified runtime identity.
- **Source/worktree:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2` was clean at the exact reviewed head. Diff is limited to `tests/api-integration/identity/oidc-jit-login.test.ts`.

## Delta assessment

The negative case now starts with two distinct successful JIT admissions for the same validated subject on separate customer connections: the intended target connection and an unrelated valid connection. `expectJitIdentity` verifies each connection's own canonical customer identity, grant, membership and session row; the test also asserts their user ids differ. This establishes a real unrelated customer session before the denial path.

For the target, the test records the exact external identity by both connection id and subject, confirms a user id exists, and confirms it differs from the unrelated user. It removes sessions only for that target user and verifies the target has no session before tampering. It then changes only the target connection's configured customer role, retries that same connection and subject, and asserts token validation ran, the exact target identity remains associated with the same user, the response is an identity error, no portal cookie is issued, and no customer session exists for that target user. Finally, it verifies the separate unrelated user's customer session still exists. The exact connection-plus-subject and user-scoped predicates prevent a wrong-subject or empty-database result from satisfying the absence check; the surviving unrelated session proves the retry did not globally clear customer sessions.

The test intentionally exercises a successful first JIT admission followed by a tampered-role return-login attempt. It does not claim that a fresh first-login attempt under an already-tampered role is covered by this particular case; the separate existing tampered first-login scenario remains in the file and continues to test that path. The prior OIDC positive case still asserts a callback-issued portal cookie; this delta's target first-admission helper verifies the matching persisted portal session before the retry.

The previous ordinary A report at `notification-pg-repair-ordinary-a-luna.md` remains an immutable record of its earlier BLOCKED verdict at `6a3057c8`. This delta closes that finding; it does not rewrite the historical report. My earlier review of the other four repair files remains the basis for their coverage.

## Checks and limits

- `git show --stat` and exact `git diff 6a3057c86a59c2609dbaaafe48db7104b40c9e11 af2d812a4569b21ca631abd732e1b7be9ee675e1` — one test file changed; reviewed all 107 added/removed lines in context.
- `git diff --check 6a3057c86a59c2609dbaaafe48db7104b40c9e11 af2d812a4569b21ca631abd732e1b7be9ee675e1` — passed.
- Author evidence reports typecheck and Biome passed; I did not rerun them.
- No focused tests or PostgreSQL were run. This is a PostgreSQL integration-test file and PostgreSQL/Docker are unavailable in the assigned environment. The hosted result for the earlier source remains 206 files / 2,947 tests with five failures; this delta has no hosted rerun evidence.

This is an ordinary source review of the exact test delta, not runtime verification, a security review, merge authorization, or acceptance of #785.


### Record 9

# Ordinary review B delta — scoped OIDC session denial oracle

**Verdict: CLEAR for this delta.** The prior blocker is repaired in the reviewed delta. No new blocking or non-blocking findings.

## Provenance

- Role: fresh independent ordinary reviewer B, context `/root/notification_pg_repair_ordinary_b`.
- Model selector: GPT-6 Luna (ordinary tier); runtime/version metadata beyond the selector was not exposed.
- Exact source HEAD: `af2d812a4569b21ca631abd732e1b7be9ee675e1`.
- Delta base: `6a3057c86a59c2609dbaaafe48db7104b40c9e11` (the earlier review source). The corrected candidate commit is `af2d812a4569b21ca631abd732e1b7be9ee675e1`; original candidate/base remain `509ee11f34664c39a521e85b7bb7d558a86537b0` / `d17d389721a38999c50eb98861b9560b8dd01cd2`.
- Worktree: `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`; clean at review.
- Reviewed only the OIDC test delta plus the external-identity uniqueness definition needed to validate its scope. No files changed.

## Delta finding review

The prior global customer-session lookup is replaced with an identity-scoped check and a live unrelated-session control:

- A separate customer connection is successfully signed in first; `expectJitIdentity` verifies its customer session, and its external identity/user id are retained.
- The target connection is successfully signed in before tampering. `expectJitIdentity` verifies the positive login; the test then selects the exact target connection plus `SUBJECT`, requires a nonempty user id, and confirms that id differs from the unrelated user's id.
- It deletes and rereads sessions only for the target user's id, leaving the unrelated customer's session intact.
- After mutating only the target configured role and retrying, it verifies the ID-token validator was reached, the exact target connection/subject identity still belongs to the expected user, no portal cookie was returned, no customer session exists for the target user, and the unrelated user's customer session remains.

The subject selector is non-vacuous: the mocked validator supplies the fixed nonempty `SUBJECT`, and the test first proves the successful target login created its external identity under the exact connection and subject. Schema uniqueness is `(identity_connection_id, subject)`, so the same test subject under the distinct unrelated connection is valid. The retry is tied to the existing target identity, and the unrelated session control demonstrates the test does not depend on global session-table emptiness or delete unrelated records.

## Validation and limits

- `git diff --check af2d812a^ af2d812a` — passed.
- Author's recorded validation in the supplied session note: scoped Biome, `pnpm typecheck` (9 packages), and `git diff --check` passed.
- No PostgreSQL integration run, hosted runner, Docker, or browser was run. Runtime behavior still awaits the exact-head hosted PostgreSQL run.
- This clears only the OIDC session-oracle delta. The prior review's findings on all five original test files remain part of the candidate and are not re-reviewed here. This is not the separate Sol security verdict.


### Record 10

# #785 PostgreSQL fixture/oracle repair — independent security review

**Verdict: CLEAR for the bounded source-security delta at exact head `af2d812a4569b21ca631abd732e1b7be9ee675e1`.** No blocking or non-blocking security finding in the five revised integration tests or their conservation against the previously reviewed implementation. This is not a PostgreSQL pass, exact-head CI result, merge authorization, or runtime acceptance.

**Reviewed head:** `af2d812a4569b21ca631abd732e1b7be9ee675e1`  
**Comparison base:** `c84df2f56030c375bba4ac9b7af8832852bce2c1` for the full post-security-review delta; `d17d389721a38999c50eb98861b9560b8dd01cd2` for the failed hosted candidate.  
**Role and independence:** Fresh `/root/notification_pg_repair_security_sol` context, assigned by `/root` for a full Sol-tier security review after the ordinary A/B delta findings were independently cleared. I did not author, direct, advise, remediate, or perform an ordinary review of this candidate. The two earlier Sol adjudication notes were diagnosis, including a corrected customer-search diagnosis; I treated them as evidence to challenge against source, not as approvals.  
**Model provenance:** Parent dispatch selected `gpt-6-sol` for this context. The runtime exposed no independently verifiable model/version attestation here; that selector is recorded as provenance, not as a claimed runtime measurement.  
**Worktree:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, clean at the reviewed head.

## Scope and assessment

`git diff c84df2..af2d812 -- apps packages` is empty. The candidate's implementation is byte-unchanged from the earlier full independent security review at `c84df2`; the intervening accepted-main import adds three queue/status/review-record files, with conservation recorded in `notification-records-main-conservation.json`. The security-bearing delta is limited to five PostgreSQL integration test files (`project-reach-reads`, `work-item-assignable`, `work-item-comment`, `ws-project-reach`, `identity/oidc-jit-login`). I inspected their complete diff and relevant surrounding fixtures, policy/source, and canonical RBAC, customer portal, notification, project, identity and socket contracts. The prior `notification-structural-security-current-sol.md` source verdict remains applicable to unchanged implementation, within its explicit limits.

- **Customer project reach and search.** The positive fixture has an active, external, portal-enabled organisation, a genuine built-in customer role, an own-organisation membership and an assertion that `resolveIdentity` returns the exact organisation reach. The bound project remains the sole reachable project; direct label/project SQL checks retain the visible positive and hidden/count exclusions. Customer agent-search access is asserted denied through a customer portal session. The legacy `globalSearch` positive and hidden-row/count oracle now run under an actual staff workspace member with its own `callerReach`; the controller first requires `workspace_user`, and the route requires `workspace:read`. No fake customer workspace grant or customer legacy-search promise was added. The explicit `portalAccess: true` documents the fixture; schema default is already true, so it is not asserted as the cause of the original search failure.
- **Assignable roster.** The intentionally invalid customer grant now returns 404 with the same body as a missing project, matching reach-before-capability privacy. The valid in-reach/no-capability 403 branch is retained in `project-scoped-reach.test.ts` for this route (the prior ordinary note's implication that it was in the changed file was imprecise). The production policy still declares project reach and `work_item:read`.
- **NO-19 customer inbox.** Staff-assignment rows are excluded for requester and participant; the public mention remains a positive while internal, nonparticipant and foreign rows remain negative. The permitted mention mutates on direct read. The forbidden assignment remains unread and stored after direct read, bulk read and clear, proven by separate persisted rereads. The test therefore does not make a forbidden notification eligible to satisfy its original oracle.
- **Sockets.** The repaired customer fixture supplies an active portal-enabled organisation, the exact built-in customer role and an own-organisation membership. The serving project's organisation differs from the workspace's operating organisation. The `reaches` positive for the serving project and negative for the other project are retained, while both legacy and native `project:read` socket authorization deny the customer on both projects. The inherited workspace membership does not grant customer authority in the canonical resolver.
- **OIDC JIT.** The customer seed uses exact compiled role rank/capabilities and system/noneditable provenance; the positive first login verifies identity, grant, membership, stored customer portal session and returned portal cookie. The tampered-role retry begins after successful admission of a distinct unrelated customer and the target. It binds the attempted identity to exact connection plus subject, verifies different user IDs, deletes only the target user's prior session, mutates only the target configured role, and confirms token validation, identity-error redirect, no portal cookie, no target customer session, and survival of the unrelated customer session. This is a non-vacuous return-login denial; it does not claim a full browser-authenticated follow-up request or a new first-login-under-tamper case.

The existing structural checks for current customer membership, role provenance, event audience, private/foreign reach, API-key/customer separation and source-authority checks were not removed by this test delta. The previous full source review's held customer external-delivery path remains held: real `current-eligibility.ts` still reaches `read_authority_lost` for customer work-item/comment delivery, and this change does not create portal HTTP inbox or outbound delivery acceptance.

## Checks and limits

I ran `git status --porcelain`, `git rev-parse HEAD`, `git diff c84df2..af2d812` (five tests plus accepted records), `git diff c84df2..af2d812 -- apps packages` (empty), `git diff --check c84df2..af2d812 -- tests/api-integration` (passed), `git merge-base --is-ancestor c84df2 af2d812` (passed), and bounded `rg`/`sed` source and contract inspection. I read both initial ordinary BLOCKED records and both current CLEAR delta dispositions; their adverse finding is preserved in the record. I did not rerun typecheck or Biome; the author reports both passing. I ran no PostgreSQL, Docker, browser, focused integration tests, provider I/O or SIT in this context.

Live `gh pr view 785` still reports PR head `d17d389721a38999c50eb98861b9560b8dd01cd2`, whose hosted PostgreSQL run failed **5 of 2,947 tests across 206 files** (2,942 passed), and whose current PR checks include failed PostgreSQL and review-template jobs. That result is the repair's input, not a result on `af2d812`. The repaired exact head needs publication to PR #785, real focused/full hosted PostgreSQL execution and all required current-head checks and recorded review before merge. No waiver or stage/source-runtime acceptance is implied by this verdict.




## Canonical role reuse and isolated OIDC fixtures — 2026-10-16

**Reviewed head:** `e9b169fcd19db369dcf4ae3e2356674ad3a8afd2`

The last published d9ffe9eb full PostgreSQL run38836478088/job116766653137 failed one of2948tests across206files (2947passed): its new tampered-role case attempted a second globally unique canonical customer role. The previous five failing cases passed in that run; the full suite did not. Current fixture repairs validate and reuse the global built-in role, use coherent subject/account oracles and reset the token-validator implementation before every test. The retirement regression binds initial and denied attempts to the same principal and original grant. All production apps/packages bytes remain conserved from c84; accepted main d603 is included. Current source has retained five-file ordinary coverage, one strong current role-fixture ordinary delta and independent Sol clearance after two authentic blocked attempts. Seven raw records below include author handoffs and blocked versions; they are not seven approvals. Source clearance does not prove PostgreSQL execution; new exact-publication hosted CI remains pending. Image and #764 remain prerequisites. No role authority, schema, capability, provider activation or owner hold changes.

Platform dispatch provenance: ordinary role selected `model=gpt-6-luna`, security role `model=gpt-6-sol`, fresh `fork_turns=none` contexts; serving-version introspection is unavailable and not fabricated. Root composed/published and is not an independent reviewer.

### Record 1

# Shared built-in customer-role fixture repair

Reviewed source/candidate base: `d9ffe9ebe7b3c5dff06f7365ba081f02f5a53996`. Hosted job `116766653137` had 2,948 tests across 206 files: 2,947 passed and one failed in the OIDC JIT integration test. The sole new failure was the second customer fixture inserting another `(scope=organisation, workspace_id=NULL, key=customer)` role, violating the schema's unique `role_scope_workspace_key_unique` constraint. No raw SQL, parameters, or fixture payloads are reproduced here.

Only `tests/api-integration/identity/oidc-jit-login.test.ts` changed. Its local `ensureCanonicalCustomerRole()` reuses the single exact global built-in customer role after validating scope, null workspace, key, rank, capabilities, `isSystem`, and `isEditable`. It throws on ambiguity or a noncanonical existing row and never repairs/overwrites a tampered role. The JIT test creates separate customer organisations, connections, creators, emails, and subjects while both connections reference the same global built-in role. It asserts both role IDs are shared.

The new test preserves a real first-login positive for the target subject, deletes only its session, tampers the shared role, retries the same connection/subject, and verifies no new customer session/cookie for that exact identity. A second genuine customer session remains persisted as an unrelated-survival control; the test explicitly does not claim it remains usable after shared role tampering. No production uniqueness, auth behavior, migrations, or unrelated sessions are changed.

Validation: `pnpm typecheck` passed (9 packages); scoped Biome passed; `git diff --check` passed. Local PostgreSQL, Docker, and browser were not run. The repaired hosted regression awaits the next runner and independent reviews.

Committed locally as `0152e22b` (`test: reuse canonical customer role fixture`); worktree is clean and nothing was pushed.


### Record 2

# Ordinary review — shared canonical customer-role fixture delta

**Verdict: CLEAR for the bounded fixture delta.** The added helper and revised OIDC fixtures address the hosted unique-role collision without mutating or disguising a noncanonical/tampered role. No new blocking or non-blocking findings.

## Provenance

- Role: fresh independent ordinary reviewer, context `/root/notification_pg_repair_ordinary_b`.
- Model selector: GPT-6 Luna; runtime/version metadata beyond selector was not exposed.
- Exact reviewed source HEAD: `d66831a1f9a175e3c1a9b850a0e0ad6205a74801`.
- Fixture delta isolated against prior candidate `d9ffe9ebe7b3c5dff06f7365ba081f02f5a53996`; implementation commit reported by author: `0152e22b25b1e7eb34403285e72516a44e6cf8a4`.
- HEAD is a merge of that candidate and accepted `main` (`780d603`); per assignment, only the OIDC fixture delta was reviewed. The accepted main imports are covered by the supplied conservation proof, not this review.
- Worktree: `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`; clean. No files edited.

## Review evidence

- Inspected the full test delta from `d9ffe9ebe7b3c5dff06f7365ba081f02f5a53996` to the current source, the helper in context, the role uniqueness index, and the fixed OIDC test setup.
- Confirmed the database unique index is on `(scope, COALESCE(workspace_id, ''), key)`, so multiple global organisation/customer rows with null workspace and key `customer` do conflict as reported.
- `ensureCanonicalCustomerRole()` selects the single global organisation/customer role (limit 2), throws on ambiguity, validates the canonical role fields (scope, null workspace, key, rank, exact capabilities, system and noneditable flags), and only inserts the canonical row when absent. It does not update or repair a malformed row. The test then verifies both connections reuse the same role id.
- The unrelated and target connections have distinct seeded organisations, creator identities/emails, and OIDC subjects. The unrelated customer is admitted before target setup; the target is admitted before tampering. The test establishes the target identity by exact connection and subject, deletes only that target user's session, mutates the shared role, and retries the same connection/subject. It checks the persisted identity association, validator invocation, missing portal cookie, and absence of a customer session for only the target user. It separately confirms the unrelated session row survives. The comment accurately limits this control to persistence and does not claim continued usability while the shared role is tampered.
- No update to the role after tampering is present, so failure cannot be hidden by restoring or replacing the tampered state before the retry.

## Validation and limits

- `git diff --check d9ffe9ebe7b3c5dff06f7365ba081f02f5a53996 d66831a1f9a175e3c1a9b850a0e0ad6205a74801` — passed.
- Author-recorded checks in the supplied repair note: `pnpm typecheck` (9 packages), scoped Biome, and `git diff --check` passed.
- No local PostgreSQL integration run, hosted rerun, Docker, or browser was performed. The reported hosted failure was 1 of 2,948 tests across 206 files, with the other 2,947 passing; this review does not establish a runtime pass. A fresh exact-head hosted PostgreSQL result remains necessary.
- This is a focused review of the shared-role fixture delta. It does not replace prior A/B review coverage of the five-test candidate, nor the separate required Sol pass for this security-scope test change.


### Record 3

# #785 shared global customer-role fixture — independent security review

**Verdict: BLOCKED at exact source head `d66831a1f9a175e3c1a9b850a0e0ad6205a74801`.** The shared-role fixture matches the database's global uniqueness rule and does not repair a tampered role, but its new target-subject mock makes the positive-login oracle fail before the tampered-role denial can run. This candidate has no valid PostgreSQL regression proof yet.

**Reviewed head:** `d66831a1f9a175e3c1a9b850a0e0ad6205a74801`  
**Comparison base:** `d9ffe9ebe7b3c5dff06f7365ba081f02f5a53996` for the current fixture repair; `c84df2f56030c375bba4ac9b7af8832852bce2c1` and `af2d812a4569b21ca631abd732e1b7be9ee675e1` for retained source and five-test review coverage.  
**Role and independence:** fresh `/root/notification_global_role_security_sol` context assigned a bounded full security review by `/root`. I did not author, direct, remediate or ordinarily review this candidate. I made no source or Git changes.  
**Model provenance:** parent dispatch selected GPT-6 Sol. This context has no independent runtime/version attestation beyond that selector; the selector is provenance, not a measured model claim.  
**Worktree:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, initially clean at the reviewed head. PR #785's published head was still `d9ffe9ebe7b3c5dff06f7365ba081f02f5a53996` when checked; the local repair is not a published exact-head CI result.

## Blocking finding

`tests/api-integration/identity/oidc-jit-login.test.ts:394-411` changes the target token mock to return `oid: attemptedSubject` (`jit-tampered-customer-subject`), then calls `expectJitIdentity()` immediately after the first successful target login. That helper still requires `subject: SUBJECT` and `identityAccountId(ISSUER, SUBJECT)` at lines 284-305, where `SUBJECT` is `jit-first-login-subject`. The successful login necessarily persists the new target subject. Thus the assertion at line 286 fails before the test removes the target session, tampers the role, or asserts the retry denial at lines 423-475. The negative security regression is unexecuted by this test. This is a deterministic source-level finding; I did not run PostgreSQL and do not claim an observed runner failure for the repaired head. The expected remedy is to make the positive helper assert the actual subject of each fixture while keeping the distinct target subject and exact retry binding; the author must choose and implement it, then obtain independent review of the changed head.

## Confirmed bounds

- The actual index in `apps/api/src/database/schema.ts:2149-2153` and migration `0052` is unique on `(scope, COALESCE(workspace_id, ''), key)`. Two null-workspace `organisation/customer` roles conflict. The new `ensureCanonicalCustomerRole()` selects that exact global key, checks at most two matches, validates scope, null workspace, key, rank, exact capability array, system and noneditable flags, and inserts only when absent. It does not overwrite a noncanonical row. Both connections explicitly assert the same role ID. The shared role means the unrelated session can only be claimed to persist after tampering, not to retain usable authority; the test comment correctly limits this claim.
- The two fixtures use distinct organisation IDs, creator IDs/emails and connection IDs. The unrelated login uses the original subject; the target mock supplies a distinct subject. After the broken assertion, the intended path deletes only the target user's session, retains the exact `(connection, subject)` identity, checks no new target cookie/session, and checks that the unrelated session row remains. These are source intentions, not runtime results at this head.
- `git diff c84df2..d66831a1 -- apps packages` is empty; no production notification, role, authentication or migration source changed since the prior full source-security review. `git diff 0152e22b..d66831a1 -- tests/api-integration/identity/oidc-jit-login.test.ts` is empty. The three other imported files (`.gitleaksignore`, decision log, #780 review note) are byte-equal to accepted main `d603c068` by direct diff. The supplied conservation JSON agrees. Prior full source and five-test Sol clearances remain evidence for their unchanged scopes, not approval of this broken added fixture.
- The independent ordinary fixture review recorded CLEAR, but did not identify the helper's fixed-subject assertion. Its verdict does not resolve this blocking security-review finding.

## Checks and limits

I read AGENTS.md, active mission, agent workflow, CLAUDE.md, the RBAC/data-model/identity contracts, the entire changed fixture and diff, actual role index, prior Sol notes, ordinary fixture review, and central conservation record. I ran `git rev-parse HEAD`, `git show 0152e22b`, scoped `git diff`/`rg`/`sed` inspection, `gh pr list --state open`, and the source/import equality commands above. `git diff --check d9ffe9eb d66831a1` reported a trailing blank line in the byte-for-byte accepted-main #780 review note; this does not affect the fixture finding. No local or hosted PostgreSQL, Docker, browser, provider I/O, SIT, typecheck or unit test was run in this context. The previously published `d9ffe9eb` PostgreSQL result failed one of 2,948 tests, at the old duplicate-role insert; it does not prove this repair passes. No waiver, merge authorization or runtime acceptance is implied.


### Record 4

# Coherent OIDC expected-principal oracle

Base: `d66831a1f9a175e3c1a9b850a0e0ad6205a74801`; the fresh Sol review found the target custom subject (`jit-tampered-customer-subject`) was minted by the token mock while `expectJitIdentity` still hardcoded `SUBJECT`, so the positive login assertion failed before the tampered-role retry ran.

Only `tests/api-integration/identity/oidc-jit-login.test.ts` changed. `expectJitIdentity` now accepts an `expectedSubject` (defaulting to the standard subject for existing callers) and uses that one value for both persisted `externalIdentity.subject` and `identityAccountId(ISSUER, expectedSubject)`. The tampered-role test passes its same `attemptedSubject` variable both to the mocked token provider and this helper; subsequent identity/session queries use it too. Thus the control proves the intended distinct subject successfully provisions the intended connection before deleting its user session and exercising the denied retry.

The validated global built-in role helper and all repeated fixture invariants are unchanged. No production source changed.

Validation: scoped `pnpm exec biome check --write tests/api-integration/identity/oidc-jit-login.test.ts` passed; `pnpm typecheck` passed (9 packages); `git diff --check` passed. No PostgreSQL, Docker, or browser run. The integration test still awaits the hosted PostgreSQL regression run and independent Sol delta review.

Committed locally as `7135900e3f4a95c7466857783e3ff2c9590cb1ac` (`test: align OIDC identity oracle with fixture subject`). Worktree is clean; no push.


### Record 5

# #785 shared customer-role and OIDC subject fixture — independent security delta review

**Verdict: BLOCKED at exact head `7135900e3f4a95c7466857783e3ff2c9590cb1ac`.** The prior fixed-subject positive-oracle blocker is repaired, and the global customer-role fixture still follows the actual unique index. One test-isolation defect remains: its custom token implementation survives into the following test and changes which identity that test creates, so the admission-failure grant-retirement oracle cannot exercise the intended existing principal.

**Reviewed head:** `7135900e3f4a95c7466857783e3ff2c9590cb1ac`  
**Comparison base:** `d66831a1f9a175e3c1a9b850a0e0ad6205a74801` for this 12-line repair; `d9ffe9ebe7b3c5dff06f7365ba081f02f5a53996` for the shared-role fixture; `c84df2f56030c375bba4ac9b7af8832852bce2c1` and `af2d812a4569b21ca631abd732e1b7be9ee675e1` for earlier unchanged implementation and five-test review scopes.  
**Role and independence:** `/root/notification_global_role_security_sol`, the independent reviewer who reported the earlier `d66831a1` blocker. I did not author, implement, direct or remediate the new patch; the prior report identified the mismatched invariant. No source, Git, PR or runtime state was changed in this review.  
**Model provenance:** parent dispatch selected GPT-6 Sol. Runtime/version metadata beyond the selector is not exposed to this context, so this is selector provenance rather than an independently measured model attestation.  
**Worktree:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, clean at the reviewed head. The candidate remained local/unpushed as handed off; no exact-head hosted result is claimed.

## Blocking finding: a custom OIDC principal leaks into the next test

In `tests/api-integration/identity/oidc-jit-login.test.ts`, the tampered-customer test changes the module mock of `validateEntraIdToken` at lines 395-409 to emit `attemptedSubject = "jit-tampered-customer-subject"`. It clears only call history at line 447. The file's `beforeEach` at line 73 calls `vi.clearAllMocks()`, which likewise clears call state but leaves the mock implementation. The common integration setup's `afterEach` calls `vi.restoreAllMocks()`, but the imported validator is a module-level `vi.fn(...)` rather than a `vi.spyOn` spy. In installed Vitest 4.1.11, `restoreAllMocks()` traverses only spy restorers, while `clearAllMocks()` calls `mockClear()` on registered mocks; neither resets this `vi.fn` to its original implementation. A direct no-PostgreSQL probe of the installed `@vitest/spy` returned `override` after both calls.

The immediately following `"denies mixed native/projected view admission and retires the OIDC grant on failed admission"` test (line 491 onward) makes its first `signIn` before overriding the validator. That first login therefore creates/grants the prior test's `attemptedSubject`. Its later denial mock at lines 578-594 emits the original `SUBJECT = "jit-first-login-subject"` with `roles: []`. Production `signInAdmittedIdentity` resolves `existing` by exact connection, issuer and subject (`apps/api/src/identity/oidc-login.ts:590-603`) and retires grants on admission failure only when that exact identity exists (`:617-645`). The denial here targets an identity that the test did not initially create, so its expected `revocationReason: "admission_failed"`/`revokedAt` on the initial person's grant is not supported by the exercised path. Subsequent SCIM cases may also inherit mock state unless a later override happens to restore equivalent default claims. The violated invariant is per-test restoration of the baseline validator claims before each first login; this report does not prescribe implementation mechanics.

## Cleared parts of the bounded delta

- The new `expectedSubject` argument defaults to `SUBJECT` for earlier helper callers and is used for both `externalIdentity.subject` and `identityAccountId(ISSUER, expectedSubject)`. The tampered-customer positive login passes the same `attemptedSubject` used by its token mock and exact later identity query. This resolves the earlier source-level mismatch; the prior BLOCKED report remains unchanged as historical evidence.
- The role seed selects the one `(organisation, null workspace, customer)` key, validates rank, exact capabilities, system/noneditable flags and scope, and throws on ambiguity/noncanonical state without repair. The schema's `role_scope_workspace_key_unique` index uses `COALESCE(workspace_id, '')`, so the two customer connections must reuse that role. They keep separate organisations, creators, emails, connections and subjects. The intended target session removal and role tamper bind the exact target identity; unrelated session persistence is claimed only as persistence, not usable authority after shared-role corruption.
- `git diff d66831a1..7135900e` touches only this test file. `git diff c84df2..7135900e -- apps packages` and `git diff d66831a1..7135900e -- apps packages` are empty. Previous source-security and five-file test reviews retain their original coverage but do not clear this new fixture behavior.

## Checks and limits

I inspected the complete changed helper/test, every `validateEntraIdToken` mock mutation in this file, both test hooks and the Vitest integration config, the installed `@vitest/spy` implementation, the exact production identity lookup/admission-failure branch, the actual role unique index, the prior BLOCKED report and the author's repair note. `git diff --check d66831a1 7135900e` passed. A direct Node probe against installed `@vitest/spy` demonstrated that a `vi.fn` override remains after `restoreAllMocks()` and `clearAllMocks()`. I ran no PostgreSQL, Docker, browser, provider I/O, SIT, typecheck or full Vitest test. This is a deterministic source-level failure path, not an observed hosted test result. The previous published `d9ffe9eb` PostgreSQL run failed one of 2,948 tests for the duplicate-role fixture; it is not evidence on this head. No waiver, merge authorization or runtime acceptance is implied.


### Record 6

# OIDC validator fixture isolation repair

Base: `7135900e3f4a95c7466857783e3ff2c9590cb1ac`. The Sol report `notification-global-role-subject-security-sol.md` found that a per-test custom `vi.fn` implementation survived `clearAllMocks()` and setup `restoreAllMocks()`, leaking the tampered test's target principal into the following admission-retirement test.

Only `tests/api-integration/identity/oidc-jit-login.test.ts` changed; canonical global-role reuse and all production files remain untouched.

## Isolation and principal invariants

- `resetEntraTokenValidatorMock()` installs the file's canonical subject/email/app-role implementation from the file-level `beforeEach` after `vi.clearAllMocks()`. This resets the implementation for every test while allowing each test's later explicit `mockImplementation` overrides to control that test.
- Added a focused fixture-isolation regression after the custom-subject test. It directly asserts the next test's baseline validator principal has the canonical subject/email and `TaskDesk.User` claim. It uses existing Vitest mocking only and no new dependency.
- Audited all `validateEntraIdToken` mutation sites in this file: module mock default, per-test baseline reset, target custom-subject mock and intra-test call-history clear, plus two explicit admission-retention mocks (deny claims then restored claims). No `mockImplementationOnce` exists. The `mockClear()` in the target test still only clears call history immediately before its retry; the next test boundary explicitly restores implementation.
- Admission-retention test now binds one `connectionId` and the canonical `SUBJECT`/account identity through initial success, denial, and restoration. It asserts `expectJitIdentity` before denial, which checks exact persisted subject and account ID; after denial it rereads that same connection identity/account and asserts the original `jit_default` grant was retired with `admission_failed`. This prevents the target subject leaking into the test from silently defeating the intended existing-principal revocation path.
- The repeated customer connection fixtures continue sharing one validated global built-in role; distinct organization, creator, email, connection, and subject controls remain intact. The unrelated customer session is still asserted to persist only, without claiming current authority after the shared role is tampered.

## Validation and limits

- Scoped `pnpm exec biome check tests/api-integration/identity/oidc-jit-login.test.ts` — passed, 1 file.
- `pnpm typecheck` — passed, 9 packages.
- `git diff --check` — passed.
- No PostgreSQL integration test, hosted runner, Docker, or browser was run. Runtime execution of the regression and hosted test counts remain pending the parent runner.

Committed locally as `e9b169fc` (`test: reset OIDC fixture principal between tests`). Worktree is clean; no push.


### Record 7

# #785 OIDC fixture isolation repair — independent security delta review

**Verdict: CLEAR for the bounded source-security delta at exact head `e9b169fcd19db369dcf4ae3e2356674ad3a8afd2`.** I found no remaining blocking or non-blocking finding in the reviewed OIDC fixture. The earlier fixed-subject and cross-test mock-leakage blockers are resolved in source. This is not a PostgreSQL test pass, exact-head CI result, merge authorization or runtime acceptance.

**Reviewed head:** `e9b169fcd19db369dcf4ae3e2356674ad3a8afd2`  
**Comparison base:** `7135900e3f4a95c7466857783e3ff2c9590cb1ac` for the current repair; `d9ffe9ebe7b3c5dff06f7365ba081f02f5a53996` for the published failing fixture; `c84df2f56030c375bba4ac9b7af8832852bce2c1` and `af2d812a4569b21ca631abd732e1b7be9ee675e1` for the retained production and five-test review scopes.  
**Role and independence:** `/root/notification_global_role_security_sol`, an independent security-review context. I reported two earlier candidate blockers and reviewed this author's later delta; I did not author, implement, direct or remediate any of these commits. The prior blocked reports remain unchanged.  
**Model provenance:** parent dispatch selected GPT-6 Sol. The context exposes no independent runtime/version attestation beyond the selector, so I record the selector rather than claiming a measured model identity.  
**Worktree and publication:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, clean at this local head. At review time PR #785 still pointed to `d9ffe9ebe7b3c5dff06f7365ba081f02f5a53996` with a failed PostgreSQL check and review-template check; this local head had no hosted result.

## Assessment

- **Per-test validator isolation.** The module mock has baseline subject `SUBJECT`, email, `acct: 0` and `TaskDesk.User` claims. The file-level `beforeEach` now reinstalls that same baseline implementation after clearing call history, before any login. This closes the gap left by `tests/api-integration/setup.ts`'s `afterEach vi.restoreAllMocks()`: the validator is a module-level `vi.fn`, and installed Vitest 4.1.11 does not restore that implementation through spy restoration. The added adjacent regression directly checks the baseline subject, email and app role after the preceding custom-subject test. I audited all three in-test validator overrides: the tampered customer keeps its distinct subject through positive admission, call-history clear and same-subject retry; the admission-retention test uses the baseline principal for initial admission, then overrides only roles to deny and restores baseline-equivalent claims for its final login. There is no `mockImplementationOnce` or unaccounted validator mutation in this file. Every later test receives the baseline again through `beforeEach`.
- **Non-vacuous principal and grant oracle.** `expectJitIdentity` uses one expected subject for both persisted external identity and account ID. The tampered customer test binds its target by exact connection plus distinct subject, confirms successful first admission and a real target session, deletes only that user's session, corrupts the shared role and retries the same connection/subject. It checks an identity-error redirect, validator invocation, no new target portal cookie/session, and persistence of an unrelated customer's session row. It does not claim the unrelated session retains usable authority under the corrupted global role.
- **Admission-retention successor.** Before denial, this test now calls `expectJitIdentity` to establish the canonical `SUBJECT`, account ID, default grant, membership and session on one `connectionId`. Its denial mock keeps that same subject and removes the required app role. Production `signInAdmittedIdentity` resolves the existing identity by exact connection, issuer and subject, and retires that identity's OIDC grants on admission failure. The test rereads the same connection identity after denial, checks stable ID/user/issuer/subject and account ID, and asserts its original person's `jit_default` grant has `admission_failed` revocation. The later restoration mock uses the same principal and required role. This closes the previous cross-test false-principal path.
- **Global customer role and conservation.** The role fixture reuses one exact `(organisation, null workspace, customer)` row under the real `role_scope_workspace_key_unique` index, validates rank/capabilities/system/noneditable fields and throws on ambiguity or noncanonical state without repair. Distinct customer organisations, creators, emails, connections and subjects remain. The current delta changes only `tests/api-integration/identity/oidc-jit-login.test.ts`; `apps/**` and `packages/**` are byte-unchanged from the earlier full source-security review at `c84df2`. The three other intervening imports remain byte-equal to accepted main `d603c068`. The prior strong ordinary fixture review and earlier five-test ordinary/Sol review scopes remain separate evidence; this verdict covers the later structural fixture delta only.

## Checks and limits

I read the complete 12-test OIDC file, its current diff, both hook layers, the Vitest integration config, the installed mock behavior, the production exact-subject admission branch, the schema unique index, the relevant RBAC and identity contracts, the two previous blocked reports and the author's repair handoff. I ran `git rev-parse HEAD`, `git status --porcelain` (clean), `git diff --name-status 7135900e..e9b169fc` (one test file), `git diff --exit-code c84df2..e9b169fc -- apps packages` (empty), accepted-main import equality checks, `git merge-base --is-ancestor c84df2 e9b169fc` (passed), and `git diff --check 7135900e e9b169fc` (passed). The author reports scoped Biome (one file) and `pnpm typecheck` (nine packages) passed; those are not reruns in this context. **Zero PostgreSQL tests were run on this head here**, despite 12 cases being defined in the file. I ran no Docker, browser, provider I/O or SIT. The old published `d9ffe9eb` PostgreSQL run passed 2,947 of 2,948 tests across 206 files and failed the duplicate-role setup; it cannot clear `e9b169fc`. The conductor still needs authentic publication and green required checks, including full hosted PostgreSQL on the exact published SHA, before any merge or acceptance claim. No gate is waived.



## Repeat-login canonical Customer role admission repair — 2026-10-16

**Reviewed head:** `ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e`

Actual prior publication33312e30 full PostgreSQL run38840868896/job116780393239 FAILED206files/2949tests:205files2948tests passed; tampered-role retry returned success / instead of identity_error. Its new session/cookie assertions were not reached. Read-only independent Sol identified a production repeat-login admission gap, not another fixture-only issue. The fix enforces the existing canonical persisted Customer role shape in common IdP validation and rejects invalid enabled customer JIT defaults on repeat admission after reconciling only the affected identity/connection grants, before issuing a new session. Agent policy is preserved. Tests retain canonical positives and individual OIDC/SCIM corruption negatives, same-principal retired grant/no-new-session assertions, and unrelated persisted grant/session controls; their integration execution remains pending.

Two NEW fresh independent ordinary contexts and a NEW fresh full independent Sol clear ded9; the fixture-only change-altitude exception is not used for these production authentication semantics. Ordinary B independently ran121APIunitfiles/872tests; author also passed permissions16files107tests and typecheck. Sol performed source/closure/session checks without claiming test execution. Five raw records below include non-approving adjudication and author handoff, not five approvals. B's original dated2026-10-16 report was copied byteexact to central evidence with SHA256 origin receipt before publication. One author handoff calls116780393239 a run; it is the job ID in actual run38840868896, preserved authentically rather than rewritten.

New publication requires real full hosted PostgreSQL and exact-head/image gates; prior failures stay adverse. #780 is accepted, #764 remains a prerequisite. Existing CI-helper802 is independently reviewed and in normal hosted acceptance; current product source is genuinely changed to test the discovered security defect, not an unchanged rerun. Future accepted-main composition requires its own conservation/current-head validation. No new schema, capability, route, provider activation or owner-hold change. Root directed composition and is not an independent reviewer. Platform selectors for the new ordinary contexts are gpt-6-luna, security gpt-6-sol, all fresh fork_turns=none; no introspected serving version is fabricated.

### Record 1

# #785 tampered Customer role: hosted runtime adjudication

**Role:** bounded, read-only critical adjudication; no approval, remediation, or independent security review.  
**Source:** frozen publication `33312e305296c35d84eeb5eec0e78ed40e9bd5fd`; source `e9b169fcd19db369dcf4ae3e2356674ad3a8afd2`; production `c84df2f56030c375bba4ac9b7af8832852bce2c1`.  
**Runtime evidence:** hosted PostgreSQL 18 job `116780393239`, raw mode-600 log `785-pg-33312e30.log`. The integration command exited 1. Its one failure among 206 files/2,949 tests was `tests/api-integration/identity/oidc-jit-login.test.ts:470`: expected the callback location to contain `identity_error`, received `/`. The other 205 files and 2,948 tests passed. Log timestamps show the assertion at 2026-10-16 03:00:28 UTC; the supplied job result records completion at 03:00:31 UTC. The private log was inspected only by targeted result lines, not copied wholesale.

## Contract

`docs/03-features/identity-provisioning.md` IP-3 says customer connections use **only the canonical Customer organisation role**. IP-27 requires an existing canonical TaskDesk role ID as `default_role_id` and Entra subject admission at every login, including repeat login, before session issuance. `docs/03-features/customer-portal.md` § Permissions admits a customer-side person with the built-in Customer role on an organisation membership. `docs/01-architecture/rbac.md` § The customer role is special makes it a distinct portal actor. The concrete built-in definition in `packages/permissions/src/roles.ts` has organisation scope, rank 10, `isEditable: false`, and the defined Customer capability list. `apps/api/src/permissions/customer-membership.ts` requires the live membership's role to retain system status, rank, and exact capabilities before request identity resolution; its resulting capabilities are compiled in.

## Observed mechanism

The test first signs in an unrelated customer on a different connection and organisation, then signs in the target subject successfully on its own connection. Both connections intentionally reference one global canonical Customer role. It removes **only** the target user's session, updates that role row to rank 0, empty capabilities, `isSystem: false`, and `isEditable: true`, then retries the same connection and subject. It stops at the first negative assertion, so the runtime log does not itself report the subsequent cookie/session and unrelated-session assertions.

This is not explained by the fixture accidentally tampering a different role or repeating an unrelated subject. `seedCustomer` reuses the role by global `(scope, null workspace, key)` and the test asserts matching role IDs and distinct users. The validator mock retains the target subject across both target logins. `signIn` creates a new `createApp()` for each attempt, but `createApp()` is route/middleware construction; it does not seed `role` rows. The boot seed found in `apps/api/src/index.ts` is `seedDefaultWorkspaceRoles()` and changes the distinct `workspace_role` table. There is no evidence here of a Customer-role repair between tamper and retry.

The code path explains the successful `/` redirect. On repeat login, `signInAdmittedIdentity` finds the existing external identity and skips the first-person default-role block in `apps/api/src/identity/oidc-login.ts`. It subsequently reads the configured JIT role and calls `validateOidcMappingRole` to decide whether to keep its `jit_default` grant. That function delegates to `validateIdpMappingRole` in `apps/api/src/identity/repository.ts`. The Customer branch checks active organisation, role scope, nonnegative rank, safe capability composition, null workspace and key `customer`. It does **not** compare canonical Customer rank/capabilities or check `isSystem`/`isEditable`. Rank 0 and an empty array pass those checks. The grant is kept; sign-in returns `denied: false`, creates and binds a Better Auth session, and the callback redirects Customer traffic to `/`. There is no request-identity resolution before session creation. The separate `hasCanonicalCustomerMembership` gate would reject the tampered role on a subsequent portal API request, but it does not enforce the IP-27 login-admission boundary.

**Verdict:** production admission defect, not a fixture-only failure. The repeat-login OIDC role validator accepts a noncanonical persisted Customer role; login reports success despite the role being unusable under the request identity resolver. The visible `/` confirms the success branch. The failure at line 470 prevents a direct hosted assertion of the actual cookie, new session row, or unrelated session persistence after retry; those remain to be verified by the repair run. No independent security approval is conferred by this adjudication.

## Bounded repair criterion for the fixer

For a Customer connection, validate the persisted role against the **genuine canonical built-in Customer shape** at every place a configured default or mapping role is accepted or reconciled, including repeat OIDC login, before any new session is issued. Preserve the accepted first-login and SCIM paths, the exact connection/subject binding, and grant-source isolation. The tampered-role retry must yield the existing generic identity failure, no new target portal cookie/session, and leave the unrelated previously persisted session untouched. The test should observe the tampered row after the update and again after the retry if needed to rule out fixture repair, while retaining its positive sign-ins and all post-denial assertions. Do not change the expectation to allow login, suppress the positive flows, relax admission, or disable the test. A fresh independent security context must review the eventual changed exact head after ordinary review.

**Limits:** No code or test was changed; no database, Docker, or browser runtime was invoked here. This packet is source/log adjudication on the specified frozen SHA, not a new reproduction or a review verdict for a future fix.


### Record 2

# #785 tampered Customer role repeat-login repair

**Role:** fixer handoff; no independent review or runtime approval.  
**Source:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, commit `ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e`.  
**Base:** `33312e305296c35d84eeb5eec0e78ed40e9bd5fd`.  
**Prior adverse evidence:** hosted PostgreSQL run `116780393239`, frozen on base, reported 206 files / 2,949 tests, 2,948 passing and the target repeated OIDC customer login returning `/` instead of `identity_error`. Original raw log and Sol adjudication remain preserved; no prior report was altered.

## Contract and repair

The source adjudication cites identity-provisioning IP-3 (customer connections use only the canonical Customer organisation role) and IP-27 (subject admission also applies on repeat login before session issuance), plus the Customer portal permission contract and the compiled built-in role in `packages/permissions/src/roles.ts`.

`apps/api/src/identity/repository.ts` now makes the common IdP mapping/default predicate compare customer roles against `BUILT_IN_ROLES.customer`: organisation scope, global/null workspace, canonical key, system row, noneditable row, exact rank, and exact ordered capability list. This predicate serves OIDC defaults and mappings, SCIM mappings, and connection reference validation. Existing agent role checks are unchanged.

`apps/api/src/identity/oidc-login.ts` now locks the configured JIT default role while reconciling a repeat sign-in. When a customer connection has JIT enabled and the configured default fails the shared role predicate, reconciliation retires only that identity connection's invalid JIT grant as `mapping_changed`, projects the membership change, and returns the existing generic denied result before a new session is issued. First-login validation still fails before creating the identity when its default role is invalid. The lock uses the existing transaction and role-lock path.

The existing OIDC retry regression retains its successful unrelated-customer and target first sign-ins. It now rereads the tampered role both before and after the retry; asserts the failed retry leaves the target without a customer cookie/session; asserts the target JIT grant is retired; and checks the other connection's grant and previously stored session remain. Mapping-role tests now seed the real canonical role and individually reject wrong rank, capabilities, system status, and editability through both OIDC and SCIM predicates. The OIDC mapping-admin integration fixture was updated to use the canonical persisted role; its corruption cases remain intact.

## Validation

Passed on `ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e`:

- `pnpm --filter @taskdesk/api test:unit` — 121 files, 872 tests passed.
- `pnpm --filter @taskdesk/api test:permissions` — 16 files, 107 tests passed.
- `pnpm --filter @taskdesk/api typecheck` — all five configured TypeScript projects passed.
- `pnpm exec biome ci` on the five changed files — no errors; it reports three existing optional-chain warnings in unchanged lines of `oidc-login.ts`.
- `git diff --check` — passed before commit.

No PostgreSQL integration run, Docker, browser, push, or publication was performed. The focused role-predicate and OIDC retry tests are integration tests and therefore remain unexecuted locally; the hosted PostgreSQL rerun is required before claiming runtime repair. The production changes are security-sensitive authentication semantics and need the ordinary reviewer count and a fresh full independent Sol review chosen by the conductor.

## Changed files

- `apps/api/src/identity/repository.ts`
- `apps/api/src/identity/oidc-login.ts`
- `tests/api-integration/identity/mapping-role-guards.test.ts`
- `tests/api-integration/identity/oidc-group-mapping-admin.test.ts`
- `tests/api-integration/identity/oidc-jit-login.test.ts`


### Record 3

# #785 tampered Customer role repeat-login repair — ordinary review A

**Role:** fresh independent ordinary reviewer A. This context did not author, direct, or remediate the candidate. It is not a security review or runtime approval.  
**Model label:** GPT-6 Luna (selected by assignment; serving model/version was not independently introspected).  
**Reviewed head:** \`ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e\`  
**Comparison base:** \`33312e305296c35d84eeb5eec0e78ed40e9bd5fd\`  
**Accepted-main ancestor supplied by assignment:** \`d603...\` (not independently refreshed against GitHub in this read-only task).  
**Verdict:** CLEAR for the bounded ordinary review scope. No blocking or non-blocking findings.

## Scope checked

Read the repository instructions (\`AGENTS.md\`, \`docs/04-engineering/agent-workflow.md\`, \`CLAUDE.md\`), the owning \`IP-3\` and \`IP-27\` rules in \`docs/03-features/identity-provisioning.md\`, and the exact five-file diff. Traced the common \`validateIdpMappingRole\` predicate and \`validateOidcMappingRole\` wrapper, first-login default-role validation, repeat-login role reconciliation and session-issuance boundary, \`lockScimGrantClosure\` lock acquisition, \`lockOidcDefaultRole\`, and the existing OIDC denial/session path. Inspected the focused changes in \`mapping-role-guards.test.ts\`, \`oidc-group-mapping-admin.test.ts\`, and \`oidc-jit-login.test.ts\`. Used the prior private runtime adjudication and author handoff only to understand the reported failure and claimed validation; neither was treated as review evidence for this candidate.

## Findings

The shared customer-role predicate now checks the complete built-in Customer shape: organisation scope, null workspace, canonical key, system status, non-editable status, exact built-in rank and exact ordered capability list. This closes the repeat-login gap in the common predicate while keeping customer admission scoped to the configured organisation. The existing connection and issuer/tenant/client checks plus immutable subject lookup remain in place. The signed Entra admission decision still occurs before \`signInAdmittedIdentity\`; no callback email or group claim selects the customer organisation or subject.

On repeat sign-in, the configured JIT default is now selected with the role row lock before it is validated and reconciled. \`lockScimGrantClosure\` already includes the observed configured role in its sorted role-lock set before acquiring connection, mapping, external-identity and grant locks, so the new call reuses a role lock already acquired in the documented IP-22 order. Reconciliation remains in the same transaction as role validation and grant retirement/projection. A customer JIT-enabled identity whose persisted default role is no longer canonical is marked denied after reconciliation; the callback follows the existing generic failure path before creating a portal session. The grant loop is constrained to the current person, connection, external identity, and OIDC/JIT source kinds. Direct grants, SCIM grants, and other-connection grants are not selected for retirement. Post-commit invalidation occurs only when the affected grant projection changed.

The regression preserves positive first sign-ins for a separate customer connection and the target connection, verifies the target and unrelated connections share the global role as expected, asserts the role remains tampered before and after retry, checks no target customer cookie/session is issued, checks the target JIT grant is retired, and checks the other customer's stored session and grant remain. The test comment accurately limits the latter claim to persistence: both connections use the same global role, so tampering that role does not establish that the unrelated session retains usable authorization. This is a suitable failure oracle for the requested no-global-session-deletion property.

The mapping-role tests now use the true canonical persisted customer role and cover tampered rank, capabilities, system status and editability through both OIDC and SCIM shared validation. The mapping-admin fixture update is consistent with the stronger common predicate. I found no tenant escape, identity-subject substitution, source-isolation regression, lock-order inversion, or newly issued session path in the reviewed delta.

## Validation evidence and limits

No tests or runtime commands were run by this reviewer. The author handoff reports, on this exact head, API unit tests at 121 files / 872 tests, permissions tests at 16 files / 107 tests, API typecheck across five TypeScript projects, Biome on the changed files and \`git diff --check\` as passing. I did not independently verify those outputs. The handoff reports that the focused PostgreSQL integration tests were not run; the prior hosted PostgreSQL failure is on the base and is not evidence that this repair passes. No Docker or browser verification was performed.

This ordinary review covers the bounded production-authentication fix only. Because the candidate changes security-sensitive authentication semantics, it still requires the separate current-head GPT-6 Sol security pass and required hosted integration evidence. This report does not clear either gate.



### Record 4

# #785 repeat Customer admission repair — ordinary review B

**Role:** Fresh independent ordinary code review; did not author, direct, or remediate the candidate.  
**Model provenance:** Selected GPT-6 Luna context per review assignment. Runtime model attestation is unavailable in this session; the model label records the assigned tier, not an independently observed runtime identifier.  
**Candidate:** `ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e`  
**Base:** `33312e305296c35d84eeb5eec0e78ed40e9bd5fd`  
**Scope:** Full five-file candidate delta, emphasizing shared validator callers and fixtures, positive agent/customer behavior, negative canonical Customer-role fields, repeat OIDC JIT reconciliation, mapping-admin and SCIM caller behavior, and grant/session isolation.

## Verdict

**CLEAR — no blocking findings.** The changed predicate enforces the persisted canonical Customer shape at every caller using the shared IdP mapping/default validator. Repeat OIDC login locks the configured JIT role, revalidates it, retires only invalid active OIDC grants tied to the current person/connection/external identity, reconciles membership projection, and denies before issuing a new session when a customer JIT default is invalid.

The customer retry fixture preserves its unrelated-customer and target first-login positives. It verifies the corrupted role remains corrupted through retry, the target gets no portal cookie/session, its JIT grant is retired, and the unrelated connection's session and grant remain. The predicate tests cover canonical rank, capability list, system status, and editability, through both OIDC and SCIM; they also preserve positive controls for agent and customer mappings. The mapping-admin fixture now uses a valid persisted canonical Customer role, consistent with the contract.

## Review evidence

Read the repository agent workflow, provider guide, status and decision log, the identity-provisioning/customer-portal/RBAC contracts, both supplied adjudication/fixer reports, the full five-file diff, and relevant caller/query implementations.

Commands run on the frozen worktree:

- `git diff --find-renames 33312e305296c35d84eeb5eec0e78ed40e9bd5fd ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e -- <five changed files>` — inspected.
- `git diff --check 33312e305296c35d84eeb5eec0e78ed40e9bd5fd ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e` — passed.
- `pnpm --filter @taskdesk/api test:unit` — 121 files, 872 tests passed.
- `rg` searches of validator, role-default, and grant-list callsites — traced OIDC, connection-admin, group-mapping, and SCIM paths.

## Findings and limits

No blocking or non-blocking code findings. The five-file PostgreSQL integration tests, including the new retry and canonical-role assertions, were not run in this review; the supplied fixer report also says they remain unexecuted locally. The earlier hosted run belongs to the old base and records the original defect, so it is not evidence that this candidate passes integration. No Docker, browser, or hosted runtime verification was performed. This ordinary review does not substitute for the required independent GPT-6 Sol security review.


### Record 5

# #785 repeat Customer admission repair — independent security review

**Role:** Fresh, full Sol-tier security reviewer. This context did not author, direct, remediate, or run the prior adjudication of this candidate.  
**Model provenance:** GPT-6 Sol selected by the parent spawn assignment with `fork_turns=none`; no independent platform version attestation is available.  
**Reviewed head:** ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e  
**Comparison base:** 33312e305296c35d84eeb5eec0e78ed40e9bd5fd  
**Accepted-main ancestor:** d603c068 (ancestor relationship checked locally).  
**Verdict:** CLEAR for the exact-head source security review. No blocking or non-blocking findings. This is not integration, image, or runtime acceptance.

## Scope and evidence

I read AGENTS.md, the active mission, agent-workflow.md, CLAUDE.md, the IP-2/IP-3/IP-22/IP-27 identity-provisioning contract, the Customer portal permission contract, the built-in Customer role, the prior hosted-failure adjudication, the author handoff, and both independent ordinary CLEAR reports. I independently inspected the complete five-file diff and traced the surrounding OIDC callback, transaction, grant-closure locks, first and repeat login, SCIM/shared-role validation, membership projection, native authorization invalidation, Customer request identity resolver, and session/cookie creation. The prior reports were context, not a substitute for source inspection.

The common IdP role predicate checks the active customer organisation, exact organisation scope, null workspace, built-in Customer key, system status, noneditable status, rank, and the exact ordered built-in capability list. Customer roles cannot be supplied from IdP claims. The agent branch still enforces its workspace, role ceiling, and forbidden-capability checks; the new Customer comparison does not relax it. Connection save, OIDC default/mapping reconciliation, and SCIM mapping callers use the shared predicate.

The selected Entra connection, issuer, tenant, client and immutable subject remain bound before the repeat-login transaction. Signed app-role and account-type admission is rechecked under the current connection configuration before person/grant reconciliation. The closure includes the observed configured default role in its sorted role-lock set; the new repeat-path `lockOidcDefaultRole` reuses that lock before validation. A concurrent configuration change is caught by the connection version check and retried. Invalid Customer default state retires only active JIT grants of this current person, connection and external identity, projects affected memberships, and returns a denied result. Native authorization invalidation follows a changed projection; the callback takes its generic failure branch before Better Auth session creation or portal session-cookie issuance. Other-connection and direct/SCIM grant sources are outside this OIDC retirement selection. The unchanged request resolver independently compiles Customer capabilities from the built-in role after its live membership check.

The regression keeps the unrelated and target successful initial sign-ins, proves their global role ID is shared, observes the tampered persisted row before and after retry, checks generic denial and token validation, absence of a new target portal cookie/session, target JIT retirement, and persistence of the other connection's grant/session. The separate role-predicate test seeds a canonical role and varies rank, capabilities, system status, and editability individually through OIDC and SCIM validators; the mapping-admin fixture is updated to the same canonical shape. Its unrelated-session assertion proves persistence, not usable authorization after the globally shared role was tampered.

## Checks actually run and limits

I ran `git diff --check` on the exact base/head (pass), inspected the exact five-file diff, checked the worktree was clean and its HEAD matched the reviewed SHA, and verified d603c068 is an ancestor. I did not run tests, PostgreSQL, Docker, browser, or hosted CI. The author reports API unit 121 files/872 tests and permissions 16 files/107 tests on this SHA; ordinary reviewer B independently ran API unit 121/872. Those are their evidence, not tests run in this security context. The prior hosted PostgreSQL job was on the base and failed 1 of 2,949 tests; it does not verify this repair.

The newly changed PostgreSQL integration cases remain unexecuted in the supplied evidence. A real current-head hosted PostgreSQL run, image/runtime proof, and all required exact-head GitHub checks are still necessary before merge. No runtime success is asserted here.



## Canonical fixture restoration and accepted image-tooling import — 2026-10-16

**Reviewed head:** `4381fdb21b3a532bdb569c7f80f158e787031c54`

Actual prior9053 full PostgreSQL run38847096830/job116799987492 FAILED206 files/2,950 tests:205 files/2,949 tests passed; all12 OIDC-JIT cases passed, including the repaired tampered-role login denial. The sole new failure was mapping-admin legal proof issuance after restoring Customer capabilities to an empty list. The compiled canonical Customer role has rank10 and seven nonempty capabilities, so preflight correctly rejected that still-invalid baseline422. No denial expectation or production guard is relaxed. The test now shares one compiled canonical Customer fixture helper between initial seed and restoration and asserts persisted canonical fields before minting the legal proof. All corruption/read/write denial, no-side-effect and proof-issued/unconsumed assertions remain.

Production apps/packages remain byte-identical to full-reviewed ded9; that two-ordinary-plus-fresh-full-Sol auth clearance retains its scope. Current ordinary B and current independent Sol clear the narrower fixture repair and accepted-main composition at4381. Root diagnosis and author handoff are non-approving records. Four raw records are appended unchanged below; they are not four approvals. B's dated16 original was copied byteexact with location/SHA256 receipt. Source changes outside the fixture are the accepted main09dd5acf image tooling imports: five paths exact main plus ci-cd documentation composing accepted image text with the exact two pre-existing #580 planned-not-wired hunks. The initial all-blob-equality assertion rejected that composed document; explicit retained-hunk equality then verified it. No source history was rewritten.

This current source includes the accepted real shipping-image helper; new exact-publication full CI must produce its own application image, migrations, non-root, network/health/cleanup artifact and actual PostgreSQL result. Earlier main802 image proof is not transferred to this product. #764 remains a prerequisite, #780 is accepted; provider/owner holds are unchanged. No runtime acceptance, feature/phase closure, signed release or laptop SIT is claimed. Root directed repair/composition and is not independent. Original selectors: ordinary gpt-6-luna, Sol gpt-6-sol, fresh fork_turns=none; serving-version introspection remains unavailable.

### Record 1

# Mapping-administration canonical baseline restoration — conductor diagnosis

This is root/conductor diagnosis and repair direction, not independent review or approval.

Published head: `9053bce29757315258b631e485df7e27c75b962b`; production source `ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e`.

Actual full PostgreSQL run38847096830/job116799987492 completed FAILURE04:04:21UTC:206 files/2,950 tests,205 files/2,949 tests passed. The repeat-login tampered-role regression passed. The sole failure is `oidc-group-mapping-admin.test.ts` capability-corruption test: `issueProof` at226 expected200 and got422, called at457.

The test intentionally corrupts Customer capabilities to instance:admin after minting a legal enable proof; it correctly observes read503, write422 and proof left issued/unconsumed. At451 it then attempts to restore the role with capabilities:[] before minting an edit proof. The compiled canonical Customer definition has rank10 and seven nonempty capabilities (packages/permissions/src/roles.ts:196,263). The new reviewed shared role predicate therefore correctly rejects that still-noncanonical empty-capability baseline, making step-up preflight422. The test never reaches its later malformed-object corruption case.

Repair criterion: restore the actual canonical compiled Customer fixture before each legal proof issuance, using one fixture definition/helper shared by initial seed and valid restoration; verify its persisted canonical shape non-vacuously. Audit all restore sites in this file and affected fixture builders, preserving intentional invalid-role and agent cases. Retain all read/write rejection, proof-issued/unconsumed, no-write and valid-positive assertions. Do not change expected challenge200 to422 or relax production validation. Production source must remain byte-identical to reviewed ded9. Then current ordinary test delta and independent Sol confirmation, authentic evidence publication and real current-head PostgreSQL are still required.


### Record 2

# #785 canonical Customer fixture restoration

**Role:** bounded test-fixture repair; no independent review or runtime approval.  
**Source:** `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, commit `4381fdb21b3a532bdb569c7f80f158e787031c54`.  
**Base:** merged worktree head `9a4fcea94e16ed579fed00ec279bc6a550e1afac`.  
**Hosted evidence prompting this repair:** full PostgreSQL job `116799987492`, published head `9053`, 206 files / 2,950 tests with 2,949 passing and one failure at `oidc-group-mapping-admin.test.ts:457` (`issueProof` expected 200, got 422). The tampered-role repeat-login test passed on that run. Existing raw evidence and root adjudication were left untouched.

## Change

The integration test had correctly corrupted the persisted built-in Customer role, confirmed read/write denial and unconsumed proof, then “restored” only `capabilities: []`. The built-in role has rank 10 and a nonempty canonical capability list, so the role was still invalid before the intended legal edit proof was minted.

In the single affected file, `canonicalCustomerRoleValues()` now supplies scope, null workspace, key, rank, exact compiled capabilities, system status, and noneditable status. The initial seed and the one valid restoration both use this same definition. Immediately after restoration and before `issueProof`, `expectCanonicalCustomerRole()` rereads and checks every canonical role field. Intentional invalid-role mutations and the assertions for read denial, write denial, issued-but-unconsumed proof, no create side effects, unchanged mapping, grant, config version, and provisioning-event rows remain unchanged.

## Validation

On `4381fdb21b3a532bdb569c7f80f158e787031c54`:

- `pnpm exec biome check --write tests/api-integration/identity/oidc-group-mapping-admin.test.ts` — passed, no changes needed.
- `pnpm --filter @taskdesk/api typecheck` — all five configured TypeScript projects passed.
- `git diff --check` — passed before commit.
- Worktree clean after commit.

No unit or integration tests were run for this fixture-only change; in particular no PostgreSQL, Docker, or browser runtime was invoked. The hosted PostgreSQL rerun is still needed to prove the test result. No production code changed, no push was made, and no review note was edited.


### Record 3

# #785 canonical Customer role restoration — ordinary delta confirmation

**Role:** Fresh independent ordinary review of the narrow current delta; did not author, direct, or remediate it.  
**Model provenance:** GPT-6 Luna tier was assigned. Runtime model attestation is unavailable here; the report does not claim verified runtime model identity.  
**Candidate:** `4381fdb21b3a532bdb569c7f80f158e787031c54`  
**Comparison base:** `9053bce2` (the candidate's first parent before the accepted-main merge and fixture repair).  
**Previously reviewed production fix:** `ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e`  
**Scope:** Full current delta, production-tree equality to the reviewed fix, and the Customer role setup/restoration invariant in the changed fixture.

## Verdict

**CLEAR for the current delta; no findings.** The production tree under `apps/api` and `packages` is byte-identical to the previously reviewed production fix. Relative to that fix, the only code/test change is `tests/api-integration/identity/oidc-group-mapping-admin.test.ts`.

The fixture now gets role scope, key, rank, and capabilities from `BUILT_IN_ROLES.customer`, and supplies the required canonical system/noneditable flags and global workspace. Both initial seed and restoration use the same helper. Before issuing a valid step-up proof after the negative malformed-role cases, it reads back and asserts the complete persisted canonical shape. This addresses the hosted failure caused by restoring `capabilities: []` and then attempting a legal proof: that row is now correctly rejected by the production validator. Existing corruption cases and their expected refusal/step-up non-consumption assertions remain.

The current tree also contains the merge of accepted main commit `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`, including its shipping-image CI work. I inspected the full comparison diff: those workflow/script/spec changes are imported from that accepted-main merge; the scoped new code delta over the prior reviewed production fix remains the one integration fixture. No production or permission package semantics changed in this candidate.

## Checks and evidence

- `git diff --quiet ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e 4381fdb21b3a532bdb569c7f80f158e787031c54 -- apps/api packages` — passed; no production-tree delta.
- `pnpm exec biome check tests/api-integration/identity/oidc-group-mapping-admin.test.ts` — passed; one file checked.
- `git diff --check 9053bce2 4381fdb21b3a532bdb569c7f80f158e787031c54 -- tests/api-integration/identity/oidc-group-mapping-admin.test.ts` — passed.
- Reviewed the complete current diff against `9053bce2`, the fixture diff, and the assertions around canonical restoration and step-up proof issuance.

The conductor's supplied run summary reports PostgreSQL job `116799987492` on publication `9053`: 2,949 of 2,950 tests passed; all 12 OIDC JIT tests passed, and the sole failure was the mapping-admin restoration/proof case this fixture change addresses. I did not inspect the raw hosted log directly. The PostgreSQL suite has not yet been rerun on `4381fdb21b3a532bdb569c7f80f158e787031c54`; this report does not claim current-candidate integration success. No local PostgreSQL, Docker, or browser run was performed.

This confirms only the narrow fixture delta. The prior ordinary and full Sol reviews of the unchanged production fix remain separate evidence; the current hosted image proof and PostgreSQL rerun are still pending.


### Record 4

# #785 canonical Customer fixture restoration — current-head security delta confirmation

**Role:** Fresh independent GPT-6 Sol security reviewer, `fork_turns=none`. I did not author, direct, remediate, or adjudicate this delta. The conductor, adjudicator, fixer, and ordinary reviewer are separate contexts and are not counted as this review. No platform model-version attestation was available.  
**Reviewed head:** 4381fdb21b3a532bdb569c7f80f158e787031c54  
**Comparison:** production-auth review head ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e; published prior hosted-run head 9053bce29757315258b631e485df7e27c75b962b; accepted-main import 09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6.  
**Verdict:** CLEAR for the exact-head security delta. No blocking or non-blocking findings in this candidate-specific delta. The original full Sol review of unchanged production authentication source remains separate and unchanged. This does not clear current-head runtime or GitHub gates.

## Scope and findings

I read the prior full security report, prior two ordinary reports, the hosted-failure diagnosis, the fixer handoff, the current ordinary delta CLEAR, the owning IP-2/IP-3/IP-22/IP-27 and Customer portal contracts, and the complete current bounded diff. I independently inspected the prior hosted PostgreSQL log's failure summary and OIDC JIT result lines, the changed mapping-admin test around both legal proof steps and all intentional corruption cases, the compiled Customer definition, and the accepted-main CI/documentation import.

`git diff --quiet ded9... 4381... -- apps/api packages` passed: the production API and permission/package trees are byte-identical to the full-reviewed ded9 source. Thus selected Entra connection/immutable subject binding, admission, role locking, own-source grant retirement/projection, denial before session creation, and Customer request authority remain exactly within the original full review's source coverage. Relative to 9053, the only changed source or test file is `tests/api-integration/identity/oidc-group-mapping-admin.test.ts`.

The new `canonicalCustomerRoleValues()` uses the compiled Customer scope, key, rank and exact capability list, plus global/null workspace, system and noneditable fields. Both initial seed and restoration use it. Before the second legal `issueProof`, the test reads back and checks those persisted fields. The test still corrupts capabilities to `instance:admin` and checks mapping read 503, update 422 and an issued/unconsumed proof; it then restores the valid role, issues the legal edit proof, corrupts capabilities again, and retains the later negative and no-side-effect assertions. The repair does not change the expected 200 proof, suppress denial, or modify production validation. It directly addresses the prior test's restoration to `capabilities: []`, which remained invalid under the canonical role predicate.

The prior hosted log `785-pg-9053bce2.log` reports 206 files/2,950 tests, 205 files/2,949 passing, all 12 OIDC JIT tests passing (including tampered Customer repeat denial), and one mapping-admin failure: `issueProof` expected 200 but received 422 at the old line 457. Those results belong to 9053, not 4381.

The accepted-main merge brought the shipping-image workflow, script, script tests, and associated documentation. The five identified files compare byte-identically to accepted main 09dd on the current head. `ci-cd.md` is a composed file retaining the existing #580 planned-not-wired text while importing the accepted image-proof documentation. No candidate-specific CI authority or image-proof pass/fail semantics were newly changed by the fixture repair; the imported helper already had its own accepted-main review. The prior query-ownership review record also remains part of this branch history.

## Checks actually run and limits

I checked exact HEAD and a clean worktree; inspected the current diff and relevant test/contract source; verified production-tree equality and accepted-main equality for the five imported files; ran `git diff --check` limited to the candidate's source/test delta (pass); and inspected the prior hosted log's targeted result lines. I did not run unit, PostgreSQL, Docker, browser, or hosted CI tests. The fixer reports five-project API typecheck and Biome pass; the ordinary reviewer reports Biome one-file pass. Those are their checks, not mine.

A whole-range `git diff --check 9053...4381...` reports trailing whitespace in the already accepted imported `hosted-image-proof-20261016.md` review record; the candidate-specific fixture diff passes. This is not a finding against the fixture repair or a claim that the entire imported range is whitespace-clean.

The corrected mapping-admin test and full PostgreSQL suite have not yet run on 4381 in evidence reviewed here. The current-head hosted PostgreSQL rerun, actual shipping-image proof, and required exact-head GitHub checks must pass before merge. No new runtime acceptance is asserted.



## Accepted #764 main import - 2026-10-16

**Reviewed head:** `966e1ba2c0f28b58fb1db3008cb0995c1048a90a`

Author handoff and independent import reviews follow unchanged. Author handoffs are not approvals; earlier reviews retain their actual source scopes.

### Author handoff

`notification-accepted764-main-composition-luna.md`

SHA-256 `59b97dfd02b8133ffa242cc33519a14293df17ea1c031177cab43504804e8015`

# #785 accepted #764/main composition handoff

## Result

**COMPOSED LOCALLY; no push, PR action, runtime, or heavy test was performed.** The bounded #785 candidate is a normal merge of the refreshed accepted main into the existing branch. No unresolved semantic choice was encountered.

## Exact history

- Worktree: `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`
- Branch: `codex/query-ownership-580-b4`
- Before: clean at `6b244fbbcd4e058374cb1036f2f22694aa6a678d`
- Refreshed `origin/main`: `3d1894ba2b28fd4d9ba40baecd96fc61a92a8c8e`
- Composition: `966e1ba2c0f28b58fb1db3008cb0995c1048a90a`
- Parents, in order: `6b244fbbcd4e058374cb1036f2f22694aa6a678d`, `3d1894ba2b28fd4d9ba40baecd96fc61a92a8c8e`
- Worktree is clean. The accepted main is an ancestor of the composition. The branch is local and ahead of its prior tracking ref; it was not pushed.

## Composition and provenance

The merge was run with `git merge --no-commit --no-ff origin/main`; Git reported no conflicts. A normal two-parent merge commit was then created. `git diff-tree -r --name-status HEAD^1 HEAD` identifies the incoming main delta as exactly eight paths:

1. `docs/01-architecture/monorepo-layout.md`
2. `docs/01-architecture/multi-tenancy.md`
3. `docs/01-architecture/security-model.md`
4. `docs/03-features/webhooks-and-api-keys.md`
5. `docs/04-engineering/coding-standards.md`
6. `docs/07-planning/reviews/2026-09-05/features-governance-design.md`
7. `docs/07-planning/security-reviews/764-query-ownership.md`
8. `docs/07-planning/security-reviews/782-webhooks-review-disposition.md`

The seven incoming files other than the 764 review note have blobs exactly matching accepted main. The 764 review note also matches accepted main exactly. Thus the note retains the accepted #764 resolved-identity conformance material and its original review records without author edits. Durable contract docs (`monorepo-layout.md`, `multi-tenancy.md`, `security-model.md`, and `coding-standards.md`) match current accepted main. Their rule requires the resolved identity and derives caller reach in the predicate; any narrower workspace/project ID is checked against that identity. `forIdentity(identity)` is described as an accepted illustration/convention, without claiming a universal fluent API/type. The historical notification review note remains byte-identical to its pre-merge 6b blob, preserving raw adverse and positive records; historical review text was not rewritten.

The candidate source/tests were not altered by the merge: `git diff --quiet 6b244fbb... HEAD -- apps/api packages tests` exited 0. Production API/packages are byte-identical to reviewed production source `ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e`; the canonical Customer fixture remains byte-identical to `4381fdb21b3a532bdb569c7f80f158e787031c54`. The preserved note records the two original ordinary production reviews and full Sol review, plus the fixture delta's strong ordinary and full Sol confirmation. The private canonical own-note proof identifies the original `+114/-0`, mode `100644` append and its exact publication provenance; that append is unchanged here.

## Checks and limits

- Refreshed `origin/main` and verified it was exactly `3d1894ba2b28fd4d9ba40baecd96fc61a92a8c8e` before merging.
- Verified merge parents, clean status, main ancestry, incoming path list, accepted-main blob equality, candidate source/test conservation, reviewed production equality, fixture equality, and resolved contract document equality.
- Staged `git diff --check` excluding two imported authentic review records emitted no findings; those raw review-note bytes were preserved as accepted evidence.
- No tests, PostgreSQL, Docker, browser, CI, PR/body/comment, push, or runtime action was run. Existing full 206-file/2,950-test and image results at 6b remain historical evidence, not new-head acceptance. Current hosted checks and any later required acceptance remain outstanding.


### Independent ordinary review

`notification-accepted764-main-ordinary-luna.md`

SHA-256 `2dd61700b80ee9885198f48d4adf0a25923bcf31754c1e29ab543ba60e2f7bb2`

# #785 accepted #764/main import — ordinary review

**Reviewed head:** `966e1ba2c0f28b58fb1db3008cb0995c1048a90a`  
**Compared parents:** first `6b244fbbcd4e058374cb1036f2f22694aa6a678d`; accepted-main second parent `3d1894ba2b28fd4d9ba40baecd96fc61a92a8c8e`  
**Role:** Fresh ordinary-review context for the bounded accepted-main import. I did not author, direct, or remediate this merge. GPT-6 Luna was the assigned ordinary tier; this runtime does not expose a separate serving-version attestation.  
**Scope:** Exact merge history, imported-path identity, preservation of the previously reviewed #785 production/test source, and whether the accepted import introduces a semantic conflict, authority change, or gate pass/fail change.

## Verdict

**CLEAR for the bounded accepted-main import; no blocking findings.** The exact two-parent merge imports eight documentation paths byte-for-byte from accepted main. It leaves the #785 application, package, test, and notification-review-note bytes unchanged from the reviewed first parent. The current accepted resolved-identity contract is preserved; the superseded explicit-tenant wording from the older branch is not present in the four canonical contract documents. This is an import confirmation, not a new full production review, current runtime acceptance, hosted CI result, or merge authorization.

## Evidence and checks

- `HEAD` is the requested merge commit with exactly the stated parents. The worktree was clean. Accepted main is the second parent and is an ancestor.
- `git diff-tree -r --name-status HEAD^1 HEAD` lists exactly these eight incoming paths: `docs/01-architecture/monorepo-layout.md`, `multi-tenancy.md`, `security-model.md`, `docs/03-features/webhooks-and-api-keys.md`, `docs/04-engineering/coding-standards.md`, `docs/07-planning/reviews/2026-09-05/features-governance-design.md`, `docs/07-planning/security-reviews/764-query-ownership.md`, and `782-webhooks-review-disposition.md`. I compared each merge-result blob with the same path at accepted-main parent `3d1894ba`; all eight match exactly.
- `git diff --quiet 6b244fbb..966e1ba -- apps/api packages tests docs/07-planning/security-reviews/query-ownership-notifications-580.md` exited 0. Thus this merge did not change the production source, package tree, test tree, or the existing notification/query-ownership review record.
- `apps/api` and `packages` at the reviewed head compare byte-for-byte with the production fix reviewed at `ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e`. The canonical customer-role fixture in `tests/api-integration/helpers/approval-fixtures.ts` matches its restoration at `4381fdb21b3a532bdb569c7f80f158e787031c54`. The preserved review record binds two ordinary production reviews and a full Sol review to `ded9b7e`; the fixture-only restoration has its separate strong ordinary and full Sol review at `4381fdb`. I rely on those reports only for their unchanged source scopes; I do not characterize this as a fresh full review panel.
- The four canonical identity/query documents in the import exactly match accepted main. They require cross-organisation repository reads to take resolved identity and derive caller reach in the statement predicate; any additional workspace/project ID must be checked against that identity and included as a narrower predicate. `forIdentity(identity)` is an illustration/convention, not a claim of a universal implemented wrapper or type guarantee. The decision-log summary of the accepted tenant-scoping convention says the same. The branch's older wording that treated explicit tenant IDs as alternative authoritative scope and said the identity convention was replaced is superseded and is not present in these current documents.
- The imported webhook/API-key specification and its review disposition also match accepted main exactly. The spec distinguishes existing storage from unimplemented feature tables/extensions, marks named feature tests as planned rather than passing, and says the #724 implementation remains proposed/pending. The preserved Sol report's self-read precision caveat remains visible: target stored-read-capability wording is not proof of current runtime enforcement. I found no new identity authority, API-key write grant, feature acceptance, route change, or gate activation in this import. `.github` and `scripts/ci` are unchanged from the first parent.
- `git diff --check` on the six imported documents outside the two authentic review records exited 0. The two imported review records retain raw historical report whitespace from accepted main; I did not normalize or claim the full imported diff is whitespace-clean.

## Findings and limits

**Blocking findings:** none.

**Non-blocking:** the two imported authentic review records contain preserved Markdown trailing spaces/final blank-line formatting. Their blobs are identical to accepted main; this has no semantic effect and was left intact.

No tests, PostgreSQL, Docker, browser, hosted CI, or live PR action was run. The 6b runtime/image and hosted results remain historical evidence bound to their original heads. This review does not assert exact-head CI or runtime acceptance for `966e1ba`, does not claim #580 completion or checker activation, and does not replace the separately required fresh Sol import confirmation.


### Independent security review

`notification-accepted764-main-security-sol.md`

SHA-256 `d152a5a1e5e4b7132950ec72adf98924d843fa4621fe8b636feec46f1f7b4f15`

# #785 accepted #764/main import — independent security confirmation

**Reviewed head:** `966e1ba2c0f28b58fb1db3008cb0995c1048a90a`  
**Comparison:** first parent `6b244fbbcd4e058374cb1036f2f22694aa6a678d`; accepted-main second parent `3d1894ba2b28fd4d9ba40baecd96fc61a92a8c8e`  
**Role and independence:** Fresh, read-only Sol-tier security reviewer context dispatched for this bounded import confirmation. I did not author, direct, remediate, or ordinarily review this merge. The parent selected `gpt-6-sol` with `fork_turns=none`; the runtime provides no separate serving-version attestation.  
**Verdict:** **CLEAR for this exact-head accepted-main import.** No blocking or non-blocking security finding. This is a lightweight import confirmation, not a new full review of the production changes or current-head runtime acceptance.

## Actual scope and checks

I read AGENTS.md, agent-workflow.md, CLAUDE.md, active-mission.md, the current decision-log query-ownership entry, the takeover HANDOVER, the two current ordinary/composition reports, and the preserved production and fixture ordinary/Sol reports in `query-ownership-notifications-580.md`. I inspected the first-parent documentation diff, including the resolved-identity query contract and webhook/API-key spec/disposition. I checked `HEAD`, clean worktree, exact two parents, accepted-main ancestry, first-parent changed-path list, and all eight incoming blob IDs against accepted main. Every imported blob is byte-identical to accepted main.

`git diff --quiet 6b244fbb..966e1ba -- apps/api packages tests .github scripts/ci docs/07-planning/security-reviews/query-ownership-notifications-580.md` exited 0. The merge changes none of those paths. `apps/api` and `packages` at this head are byte-identical to the full-reviewed production-auth head `ded9b7e93e6b5bd3b054d1b9d2362f4561faa58e`; the canonical Customer helper at `tests/api-integration/helpers/approval-fixtures.ts` is byte-identical to its reviewed restoration at `4381fdb21b3a532bdb569c7f80f158e787031c54`. The original two ordinary plus full Sol production reviews, and the fixture strong ordinary plus full Sol delta review, retain only their original source scopes. I did not convert them into a new full production panel.

The incoming eight paths are documentation only: `monorepo-layout.md`, `multi-tenancy.md`, `security-model.md`, `webhooks-and-api-keys.md`, `coding-standards.md`, the features-governance design register, and the #764 and #782 security-review records. The four canonical query/identity documents now require a cross-organisation repository read to derive caller reach from resolved identity in the SQL predicate. A workspace/project ID can narrow the query only after validation against that identity; `forIdentity(identity)` remains an illustration, not a claimed universal implemented wrapper. This agrees with the current decision-log entry. The older first-parent wording allowing an explicit tenant ID as alternative authoritative scope is absent from the merged result. This changes written guidance relative to the older branch, but imports the already accepted contract and neither grants runtime authority nor weakens the rule.

The imported webhook/API-key material marks absent feature tables/extensions and named tests as pending; it does not assert feature implementation or activate routes, providers, key authority, or a review gate. The accepted #764/#782 review records are preserved verbatim. No `.github`, `scripts/ci`, package manifest, schema, policy, route or test byte changes occur in this import. The CI security-scope path list in `ci-cd.md` has no newly changed path in this first-parent import, and no gate pass/fail semantics change. `git diff --check` on the full first-parent diff reports inherited trailing Markdown spaces in the two accepted review records; these are byte-identical to accepted main and have no security effect.

## Limits and disposition

No tests, PostgreSQL, Docker, browser, hosted CI, GitHub review mutation, push, or runtime acceptance ran in this context. The 6b PostgreSQL 206-file/2,950-test and image proofs are historical evidence for 6b, not acceptance for `966e1ba`. Current exact-head hosted checks, image/runtime proof and the normal protected PR gates remain the conductor's work. This report does not claim #580 completion, `check:queries` activation, stage closure, a gate waiver, or merge authorization.



## Accepted identity-clock main composition - current source reviews

**Reviewed head:** `a560cc081a583795aec871f0ddbefdf582914471`

This normal accepted-main composition has two independent ordinary reviews and a full independent security review. Source clearance is not current runtime, image, hosted-check, integrated SIT or merge acceptance. Existing authentic records remain unchanged. The non-UTC OIDC binding coverage gap is retained below.


### Composition author

`notification-accepted795-main-composition-luna.md`

SHA-256 `e5a4e481638f1c7b6785dcee8b6faa918a3e88e2d25d821c87cd20bcbfd251e5`

# #785 accepted #795/main composition handoff

## Result

**COMPOSED LOCALLY.** Accepted main was merged normally into the existing #785 publication. The two overlapping authentication files auto-merged into a small, reviewable join; I inspected the exact hunks and surrounding lock flows and found no unresolved semantic choice. No push, PR action, CI, PostgreSQL, Docker, browser, image build, or full suite was run.

## Exact history

- Worktree: `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`
- Branch: `codex/query-ownership-580-b4`
- Before: clean at `fae77b205d0df4c4502cfd32350d29b7b08946d8`
- Refreshed `origin/main`: `81781ab244cc1e6c9fac667f309de17a1e494caa`
- Composition: `a560cc081a583795aec871f0ddbefdf582914471`
- Parents, in order: `fae77b205d0df4c4502cfd32350d29b7b08946d8`, `81781ab244cc1e6c9fac667f309de17a1e494caa`
- The accepted main is an ancestor of the composition. Worktree is clean; branch is local and ahead of its tracking ref, and was not pushed.

## Net diff and provenance

The normal merge used `git merge --no-commit --no-ff origin/main`. Git reported no conflicts. The first-parent merge delta contains exactly these ten accepted-main paths:

1. `.gitleaksignore`
2. `apps/api/src/auth/repository.ts`
3. `apps/api/src/identity/oidc-login.ts`
4. `apps/api/src/instance/users/repository.ts`
5. `apps/api/src/pending-action/service.ts`
6. `apps/api/src/work-item/controllers/create-comment.ts`
7. `docs/07-planning/decision-log.md`
8. `docs/07-planning/security-reviews/identity-timezones-631.md`
9. `tests/api-integration/identity-clock-ahead-of-utc.test.ts`
10. `tests/api-integration/identity-clock-behind-utc.test.ts`

The eight non-overlapping paths match `81781ab` byte-for-byte, including both 67-test non-UTC PostgreSQL wrappers, the accepted #795 review note, decision record, and scanner fingerprints. The durable #764 resolved-identity contract documents also match accepted main byte-for-byte. The notification own-note prefix is unchanged from `fae77b2`; all historical positive and adverse reports remain intact.

The two overlapping files are `auth/repository.ts` and `identity/oidc-login.ts`. Comparing the merge against the #785 first parent shows only the #795 UTC-clock correction in these files: import/use `dbNowUtc()` for `lockActiveStepUpSession`, `bindOidcSessionProvenance`, and `bindTwoFactorOidcSession`. The existing transaction and lock order in those functions is unchanged. The accepted #795 changes in the other three API files are exact matches to main. The `ded9b7e9` production-auth/query-ownership source remains intact with those five accepted #795 API-file deltas layered on it. The canonical Customer role-restoration fixture remains byte-identical to `4381fdb21b3a532bdb569c7f80f158e787031c54`.

The source/test diff from `ded9b7e9` is limited to the five #795 API files above, the two #795 timezone wrappers, and the already reviewed #785 fixture repair. Thus the repository extractions, notification guards, canonical customer admission, and existing locks from the #785 candidate are conserved. The authenticated OIDC flow still takes connection and external-identity locks before updating the session; only the expiry comparison changed. Step-up still uses the same `FOR UPDATE` session query; only its timestamp expression changed. No new authority, route, capability, migration, dependency, environment variable, or gate semantics were introduced.

## Validation

- Refreshed and verified `origin/main`, exact merge parents, clean status, ancestry, incoming path list, non-overlap byte equality, accepted #764 contract equality, notification note conservation, fixture equality, and exact `ded9b7e9` plus #795/fixture source-test delta.
- `pnpm --filter @taskdesk/api typecheck` passed all five configured TypeScript projects.
- Scoped `git diff --check` over the five API files and two timezone tests passed.
- The commit hook reported three Biome `useOptionalChain` warnings at existing OIDC guard expressions (then lines 531, 581, 929); it made no changes and the merge commit succeeded. No lint fix was applied as part of this composition.
- No tests were run. The #785 full PostgreSQL 206-file / 2,950-test pass and its image proof remain bound to `fae77b2`, not this new head. The #795 run evidence is bound to its own accepted source/publication; neither is represented as a fresh runtime result for `a560cc0`.

The current authentication join is a new composition delta. The conductor should classify its review tier at the exact head; this handoff is not independent review or acceptance.


### Independent ordinary review A

`notification-accepted795-main-ordinary-a-luna.md`

SHA-256 `2fba2d18c1945c34bc19c4682cb0764cf0ab641fda8a12d14fb7cc394752f930`

# #785 accepted #795/main composition — independent ordinary review A

**Reviewed head:** `a560cc081a583795aec871f0ddbefdf582914471`  
**Comparison base:** `fae77b205d0df4c4502cfd32350d29b7b08946d8`  
**Accepted-main parent:** `81781ab244cc1e6c9fac667f309de17a1e494caa`  
**Role and independence:** Fresh independent ordinary reviewer A, assigned GPT-6 Luna tier. I did not author, direct, or remediate this composition. The platform does not expose a serving-model/version attestation in this context; GPT-6 Luna records the explicitly assigned role.  
**Verdict:** **CLEAR for the bounded authentication composition delta; no blocking findings.** One non-blocking regression-coverage gap is recorded below. This does not assert current-head PostgreSQL, image, runtime, hosted CI, or merge acceptance.

## Scope checked

Read repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the active mission, current status and decision log, `docs/03-features/identity-provisioning.md` (IP-3 and IP-27), and the session provenance contract in `docs/01-architecture/auth-and-identity.md`. Inspected the exact merge and focused source diffs for `apps/api/src/auth/repository.ts`, `apps/api/src/identity/oidc-login.ts`, `apps/api/src/utils/db-time.ts`, and the two imported timezone wrappers. Traced `lockActiveStepUpSession`, `bindOidcSessionProvenance`, and `bindTwoFactorOidcSession`, including their current transactions and source-lock calls. Confirmed the canonical Customer predicate, OIDC JIT admission implementation, and its retry regression test are unchanged from the prior reviewed source.

I read the composition handoff, prior #785 repeat-admission ordinary A/B and full Sol reports, the canonical Customer fixture repair reports, and the #631 ordinary and composition reports. The older hosted #785 failure remains adverse evidence on its original predecessor SHA; it was not treated as a result for this head. Prior clear verdicts remain scoped to their reviewed SHAs and source paths.

## Review findings

The auth-file merge delta is limited to importing `dbNowUtc()` and replacing three bare `now()` expiry comparisons: `lockActiveStepUpSession`, `bindOidcSessionProvenance`, and `bindTwoFactorOidcSession`. The helper returns `(now() AT TIME ZONE 'UTC')`, a `timestamp without time zone`, matching the session column's documented UTC-wall-clock representation. That avoids PostgreSQL session-TimeZone coercion while keeping the database clock as the source of time.

No transaction, row-lock, or failure-path logic changed. The step-up session query retains its `FOR UPDATE` and the exact user, portal, and session predicates. OIDC provenance binding still locks the enabled connection before the matching external identity and only then updates an unbound, matching, unexpired session. Two-factor binding still consumes the verification marker in the same transaction, validates its recorded connection/portal/user tuple, rechecks the enabled connection and external identity, and returns `invalid` when the session update matches no active row. This preserves the connection-disable serialization and fail-closed behavior. The merge does not modify canonical Customer admission, repeat-login reconciliation, source-scoped grant retirement, or session issuance; `apps/api/src/identity/repository.ts` and the OIDC JIT regression fixture compare unchanged to the first parent.

**Non-blocking coverage note:** the new ahead/behind-UTC wrappers import `work-item-comment`, `instance-users-guards`, `instance-users`, and `session-freshness` tests. They do not import `identity-connection-admin.test.ts`, which contains direct tests for `bindOidcSessionProvenance` and `bindTwoFactorOidcSession`. Therefore these wrappers do not directly assert those two binding paths under a non-UTC PostgreSQL session, although the source-level type/convention is correct and the existing identity-connection tests remain in the ordinary suite. Consider adding focused timezone coverage if these call sites need an explicit regression oracle.

**Blocking findings:** none.  
**Residual acceptance limits:** exact-head hosted checks and real PostgreSQL execution remain necessary. The earlier failure and later #785 success evidence belong only to their recorded SHAs.

## Checks actually run

- Verified `HEAD` is exactly `a560cc081a583795aec871f0ddbefdf582914471`; checkout is clean.
- Inspected exact two-parent metadata and the merge delta against first parent.
- `git diff --check fae77b205d0df4c4502cfd32350d29b7b08946d8 HEAD` for the focused auth/timezone files — passed.
- `git diff --quiet fae77b205d0df4c4502cfd32350d29b7b08946d8 HEAD -- apps/api/src/identity/repository.ts tests/api-integration/identity/oidc-jit-login.test.ts tests/api-integration/identity/mapping-role-guards.test.ts` — passed; these reviewed #785 inputs are unchanged.
- No tests, typecheck, lint, PostgreSQL, Docker, browser, image build, provider I/O, CI, or PR action was run in this review context.


### Independent ordinary review B

`notification-accepted795-main-ordinary-b-luna.md`

SHA-256 `f5db04407fea72fe19e6f4e8ac38e73ed630b15f09aec52df33264a65445d0f9`

# Notification accepted #795 main composition — independent ordinary review B

**Reviewed head:** `a560cc081a583795aec871f0ddbefdf582914471`

**Verdict: CLEAR for the bounded accepted-main composition and conservation scope.** I found no blocking defect in the merge or the reviewed notification/customer-admission safeguards.

## Reviewer and scope

- **Model selector:** GPT-6 Luna. No platform-reported runtime version is attested here.
- **Role and independence:** Fresh independent ordinary reviewer B; I did not author, direct, or remediate this candidate. Review was read-only.
- **Parents:** `fae77b205d0df4c4502cfd32350d29b7b08946d8` and accepted main `81781ab244cc1e6c9fac667f309de17a1e494caa`.
- **Scope:** exact merge composition; conservation of the #785 notification repository extraction, fail-closed notification authorization, canonical customer admission, and fixtures; the #795 UTC clock fixes and non-UTC coverage; retention of accepted #764 resolved-identity tenant scoping.
- **Guidance read:** repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, current `docs/07-planning/status.md` and decision log, `docs/03-features/notifications.md`, customer portal and multi-tenancy contracts, plus the #580 and #631 security-review records.

## Checks and assessment

The candidate is the expected two-parent merge; both supplied parents are ancestors. The merge-parent delta contains ten paths. Eight are byte-identical to accepted main: `.gitleaksignore`, `apps/api/src/instance/users/repository.ts`, `apps/api/src/pending-action/service.ts`, `apps/api/src/work-item/controllers/create-comment.ts`, `docs/07-planning/decision-log.md`, the #631 review note, and both timezone integration wrappers. The remaining two paths, `apps/api/src/auth/repository.ts` and `apps/api/src/identity/oidc-login.ts`, deliberately join accepted-main changes with the #631 UTC wall-clock correction. I inspected both parent-relative diffs: the admitted-customer query now returns all persisted membership/role facts for canonical validation, and the OIDC changes retain main's default-role locking and customer JIT denial behavior while using `dbNowUtc()` for both session-expiry comparisons.

The first-parent diff is limited to those ten merge paths, so the notification implementation and fixtures are conserved through this merge. I inspected the notification audience gates and their focused tests. Customer eligibility requires a supported event and customer-visible resource; assignment/unassignment, internal comments and other staff-only activity fail closed before preferences/provider projection. Native inbox checks also require the recipient person match, current resource, current reach and canonical `work_item:read`; customer authority is checked at the serving organisation. The tests exercise public/private audiences, requester/participant versus nonparticipant, foreign organisation, staff-only event denials, absent resource/identity, unknown event, and post-revocation behavior.

The canonical-customer admission safeguard is present in the shared resolver: it refuses missing, ambiguous, wrong-organisation, non-system, wrong-role or malformed-capability membership facts and constructs capabilities only from the compiled built-in role. The #785 integration oracle in `work-item-comment.test.ts` removes the admitted organisation membership while person and organisation remain active, then verifies `resolveIdentity` becomes null, inbox list is empty, direct mark leaves the row unread, bulk read leaves rows unread, and clear retains them; restoring the membership restores access. The shared customer fixture now writes the actual built-in customer role and own-organisation membership and validates its rank, capabilities, system provenance and workspace binding. `portal-identity-boundary.test.ts` also checks that portal access is refused after membership revocation.

The #795 wrappers set Node and PostgreSQL session time zones before dynamically importing the suites, assert both are non-UTC, and run comment, user-guard, user-directory and session-freshness suites under Yangon and New York. The joined auth files use the same UTC wall-clock helper for expiry predicates. The wrappers and the other eight exact imports match accepted-main blobs.

The accepted #764 tenant contract remains in `multi-tenancy.md` and the related coding/layout guidance: cross-organisation repository reads take resolved identity, constrain any supplied tenant identifier against it, and apply reach in the query predicate. The contract explicitly treats `forIdentity(identity)` as an illustration, not a universal implemented wrapper. The merge introduces no identity-provider authority grant or route/gate change.

**Checks actually run:** exact parent/ancestor checks; merge-parent path and Git blob comparisons; source and fixture inspection; `git diff --check fae77b20 a560cc08`. No test, PostgreSQL, build/image, browser, hosted CI or remote PR check was run.

## Findings and residuals

- **Blocking:** none.
- **Non-blocking:** `git diff --check` reports one new blank line at EOF in the accepted-main-imported `docs/07-planning/security-reviews/identity-timezones-631.md` (line 548). The file is byte-identical to accepted main; this is a whitespace-only cleanliness issue and does not alter the preserved review evidence or product behavior.
- Runtime behavior of the timezone wrappers and integration oracles was inspected but not executed here. Exact-head tests, image/boot/health, hosted checks, browser verification, and the separate required Sol review remain outside this ordinary review.

**Conclusion:** CLEAR for this bounded composition review at exact head `a560cc081a583795aec871f0ddbefdf582914471`.


### Independent full security review

`notification-accepted795-main-security-sol.md`

SHA-256 `32db427ea5d282cc730998ace7ce15adb7ccc1f18c4a01d378e5ab3da3b30e3e`

# #785 accepted #795/main composition — independent full security review

**Reviewed head:** `a560cc081a583795aec871f0ddbefdf582914471`  
**Comparison base:** first parent `fae77b205d0df4c4502cfd32350d29b7b08946d8`; accepted-main second parent `81781ab244cc1e6c9fac667f309de17a1e494caa`  
**Role and provenance:** Fresh independent full security reviewer; parent assignment explicitly selected `gpt-6-sol` with a fresh context. I did not author, direct, remediate, or adjudicate this composition or its prior candidates. No separate serving-model/version attestation is available here.  
**Verdict:** **CLEAR for the exact-head source security review.** No blocking findings. The coverage and runtime limits below remain; this verdict does not attest PostgreSQL, image, browser, hosted CI, or merge readiness on this head.

## Scope and security assessment

I read `AGENTS.md`, `agent-workflow.md`, `CLAUDE.md`, current status/decision records, the identity-provisioning IP-2/IP-3/IP-7/IP-22/IP-27/IP-28 contracts, the native OIDC session-provenance contract, and the notifications customer-audience/reach contract. I independently inspected both parent-relative diffs and the current `auth.ts`, auth repository, OIDC callback/repository, customer-membership and resolved-identity code, notification current eligibility and native inbox reach. I read the composition and both ordinary CLEAR reports and the earlier full Sol repeat-admission and canonical-fixture reports as context; none substitutes for this review or supplies current-head runtime evidence.

The ten first-parent paths are the accepted #795 import. Eight are byte-identical to accepted main, including its two non-UTC integration wrappers. The two overlapping authentication files retain the #785 customer admission and OIDC reconciliation changes, then add the #795 `dbNowUtc()` expression in exactly three `session.expires_at` predicates: step-up's `lockActiveStepUpSession`, direct OIDC `bindOidcSessionProvenance`, and `bindTwoFactorOidcSession`. The session column is a UTC-wall-clock `timestamp without time zone`; `(now() AT TIME ZONE 'UTC')` gives the same SQL type and UTC convention, avoiding a database session-TimeZone shift. No new clock source, exception path, transaction boundary, identity selector, or authority grant appears in the join.

The step-up query still binds the exact session and user, requires the agent portal, and locks the unexpired row before proof use. Both OIDC provenance paths still lock the enabled connection and matching external identity before updating only an unbound session for that user and portal. The two-factor path consumes the signed challenge marker in its transaction, verifies its connection/portal/user tuple, and returns `invalid` when no live session can be bound; the caller deletes the newly created session. The direct path likewise deletes an unbound session on failure before a cookie is emitted. Connection disable and provenance binding remain serialized by the connection row lock.

For the substantive #785 authority path preserved in this head, the callback validates the protocol token before reading claims, binds the selected connection and immutable subject, and rechecks signed Entra admission under the current connection configuration in the grant transaction. The closure includes the proposed default role, and repeat login takes the default-role lock before the common role predicate. A customer default is eligible only when its persisted role is the canonical system Customer role with the exact rank and ordered compiled capabilities in the active bound organisation. An invalid default denies customer JIT repeat login; current-identity OIDC/JIT grants alone are retired and projected before returning denial, with no new Better Auth session/cookie. Direct, SCIM, and other-connection grant sources are outside that retirement selection. The request resolver and portal session gate independently require the live own-organisation canonical membership; resulting Customer authority comes from the compiled role, and inbox read/send paths re-evaluate current identity, recipient, event audience, resource reach, and capability. I found no path in this join for IdP data to grant staff or instance authority or for stale notification reach to become customer-visible.

## Findings and residuals

**Blocking findings:** none.

**Non-blocking coverage gap:** the accepted #795 ahead/behind-UTC wrappers exercise session freshness, comments and user-directory suites, but do not directly import the existing identity-connection tests for either OIDC provenance-binding function under a non-UTC PostgreSQL session. Source and SQL-type inspection support the correction; this review does not claim that those two paths have a non-UTC integration result on this head.

**Non-blocking record hygiene:** whole first-parent `git diff --check` reports the accepted-main-imported blank line at EOF in `identity-timezones-631.md:548`. Its blob matches accepted main. The focused source/test diff check passes.

**Acceptance limits:** no current-head PostgreSQL test, shipping image/boot/health proof, browser workflow, or required GitHub status checks were run or inferred here. Historical adverse and passing runs remain attached to their recorded SHAs. The exact candidate must satisfy its normal current-head gates before merge.

## Checks actually run

- Confirmed clean checkout at exact reviewed SHA and both exact merge parents.
- Compared all eight non-overlapping imported paths against accepted main (`git diff --quiet HEAD^2 HEAD -- <eight paths>`: pass) and the notification, identity-repository, canonical-membership and JIT-test paths against the first parent (`git diff --quiet HEAD^1 HEAD -- <paths>`: pass).
- Inspected the complete focused auth-file joins and traced the relevant transaction, role lock, source-scoped retirement, session-creation, portal-identity and notification predicates in current source.
- Ran `git diff --check HEAD^1 HEAD` (one accepted review-note EOF blank line, identified above) and a scoped source/test `git diff --check` (pass).
- Ran `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/permissions/resolve-identity.test.ts ../../tests/api/notification/native-inbox-reach.test.ts`: **2 files, 65 tests passed** on this checkout.
- Did not run PostgreSQL integration, full unit suite, typecheck, lint, Docker, browser, CI, or PR actions in this reviewer context. The author's typecheck and older runtime results are separately sourced evidence, not checks I ran.



---

## Current corrected SQL scope and accepted-main composition — 2026-10-16

**Reviewed head:** `472ca631db2faf0b34945da221675720e3e2e503`

The conductor retains every authentic adverse report, owner-answer receipt, source-author handoff and current clearance below, verbatim. Original e533 broad CLEAR was subsequently qualified by the independent query-scope adjudication and is not candidate-wide clearance. The first 665 ordinary A ancestor/team allegation was withdrawn in its separate factual adjudication against current schema/loader; its original BLOCK is retained. Later b4c ordinary A initially reviewed only the last role-ID change; that narrow report is not full structural coverage. The same independent context completed the full structural scope and identified the legacy duplicate-membership blocker. Full structural ordinary B cleared. The final independent Sol pass first verified the duplicate correction, then cleared the complete combined source at472 and explicitly closed the remaining ordinary tier under the accepted change-altitude rule. No extra reviewer count or waiver is invented.

Explicit fresh dispatch provenance: three ordinary3dc/665 contexts and the two b4c structural-delta contexts used `gpt-6-luna`, fork_turns `none`; followup factual/completion records remain the SAME context and do not add reviewer counts. Final `/root/notification472_full_security_sol` used `gpt-6.1-sol`, fork_turns `none`, independent of author/fixer/advisers. Sol architecture advisers materially directed the fix and are not its security reviewers. The conductor does not self-review. Authentic reports retain their actual model-introspection limits.

Owner WF-9 requires access to EVERY project in the workflow workspace, including empty and archived projects, otherwise generic refusal without hidden project/item details. WF-19 permits unknown assignee IDs at shape-only authoring; execution eligibility is unchanged. Owning spec and append-only decisions were committed before dependent implementation. The shared named repository predicate now mirrors scoped-role admission and unambiguous legacy workspace membership, while all relevant metadata/content/effect statements apply resolved identity, actual executor and current SQL reach. No new relation, schema, permission, provider or activation is introduced.

The current base is accepted main1a34e5792ee9c42b15004b032e3c5410e5def44e (#796); both shared identity repository changes were conserved. #798 remains UNACCEPTED and is not imported. Its separate real required-G11 task-state270.8ms failure is held; current/other-source green cannot dispose it. No current publication CI, complete PostgreSQL, image or browser acceptance is inferred from prior runs. check:queries remains unwired; this is partial580. Final Sol N1 is a non-blocking HELD-PRODUCER residual: key-addressed native work_item notification facts versus id-only owner SQL; no active producer found. Resolve it before any such producer wiring; no claim that key form or the whole notification feature works.

Evidence custody correction: the first public-safe B+C author handoff7149 was temporarily overwritten by a later report filename reuse; both authentic reports were preserved, and the first was mechanically recovered from two identical prior file-read tool outputs with its recorded hash verified before restoration. The later30091 report has its own filename. Only the labelled public-safe erratum/receipt are transported; no raw transcript, credential-bearing original incremental report or PG setup is published.

---

Retained evidence file — notification-current-query-scope-adjudication-sol.md

# #785 current query-scope adjudication — independent bounded Sol follow-up

**Source reviewed:** `a560cc081a583795aec871f0ddbefdf582914471`  
**Publication checkout:** `e533a9875e47399247b740b53f6fd192fa43ec9d` (only the notification review-record path changed from the source head; `apps/api`, packages, tests and the governing architecture/engineering documents compare unchanged)  
**Role:** Fresh bounded follow-up by the independent full Sol reviewer of the source head; no product authorship, direction or remediation. This adjudicates a concrete question raised after the original report, not another general review.  
**Original report preserved:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/notification-accepted795-main-security-sol.md`, SHA-256 `32db427ea5d282cc730998ace7ce15adb7ccc1f18c4a01d378e5ab3da3b30e3e`. No edit to that report.  
**Verdict:** **CONFIRMED BLOCKER for current #785/#580 source acceptance under the accepted resolved-identity query contract.** The earlier full report's bounded authentication-join assessment remains its own finding, but its broad exact-head CLEAR cannot be used as current candidate security clearance. Hold merge even if later CI turns green, pending a reviewed correction of this contract class on a new exact head. I do not claim a demonstrated HTTP disclosure or a defect in the middleware's current decision.

## Accepted rule and why these reads are in scope

`docs/04-engineering/coding-standards.md` (Repositories own queries; Query ownership/Tenant scoping), `docs/01-architecture/multi-tenancy.md` (Query scoping), `docs/01-architecture/security-model.md` (§5), and `monorepo-layout.md` require a repository query **that can return cross-organisation data** to take the resolved identity and apply the caller's reach in its SQL predicate. A supplied workspace/project ID is an additional narrowing term, not authoritative scope. The accepted D1–D4 decision covers query location, executor/transaction plumbing, raw SQL and the dev/seed exception; it expressly preserves this tenant-scoping rule. `check:queries` is still a planned location gate, not an exception to the semantic rule or a proof of its satisfaction. I found no documented rule that exempts a row-content repository because its controller ran middleware first, or that exempts an all-reaching administrator from passing resolved authority to the repository.

`workflow.workspace_id` references `workspace.id`, whose `organisation_id` is non-null. Today's supported workspace-creation route makes internal workspaces, but the schema has no internal-only workflow/workspace constraint, and the accepted rule is about what a query can return, not a promise about what one current writer usually inserts. Workflow list/detail are explicitly actor-facing read routes in `workflows.md`; their outputs include workflow content, versions and transitions. At minimum, both repository functions below are in the rule's scope. I did not infer that every workflow helper, startup query or repository in the tree is defective.

## Concrete source trace

1. `apps/api/src/workflow/repository.ts:30-38` builds `queryWorkflowTree(id)` with only `workflow.id = id`, loading versions and transitions. Exported `findWorkflowTree(id)` at lines 101-106 returns that content. `listWorkflowsInWorkspace(workspaceId)` at lines 109-114 selects workflow rows with only `workflow.workspace_id = workspaceId`. Neither accepts a `ResolvedIdentity`; neither query predicate applies caller reach. The repository header at lines 18-22 explicitly says the moved queries leave workspace/role/person ownership checks in controllers. That describes the existing behavior, but it cannot create an exception to the accepted repository contract.
2. `workflow/index.ts:40-43,87-90` wires `workspaceAccess` followed by `requireWorkspaceCapability('workflow:read')`. For row-addressed detail, `workspace-access-middleware.ts`'s `workflow` lookup has an ID-and-caller-reach predicate and returns the workspace ID or null; missing and unreachable are masked as 404. The capability middleware then checks the caller's workspace role. The list route checks its requested workspace before calling the repository. The controllers merely forward `id` or `workspaceId`; handlers at `workflow/index.ts:190-193,212-215` serialize repository results. This is a substantial current HTTP guard and I found no direct bypass in these bounded routes. It does **not** put the resolved identity or reach in the later repository statements. The shadow policy's resolved identity is comparison/telemetry, not the caller-scope parameter of these queries.
3. The same contract class is clear without the internal-workspace nuance in `apps/api/src/audit/repository.ts:97-105`: `listInstanceAuditRows(query)` selects global audit rows under action/time filters only, no resolved identity or admin-reach predicate. `audit/controllers/list-instance-audit.ts:20-28` correctly invokes `isInstanceAdmin(c)` before calling it; `audit-trail.md` AU-11 authorizes instance administrators to see everything. That establishes the current HTTP boundary, not repository-level compliance. `listWorkspaceAuditRows(workspaceId, reach, query)` at `audit/repository.ts:164-190` similarly accepts a workspace ID and precomputed project IDs/`all`, without resolved identity; its controller computes reach and relies on middleware first. These are bounded representatives, not a whole-repository inventory or a claim that AU-11's intended global visibility is wrong.

The accepted-main workflow controllers already had the same ID-only reads. The #785 extraction moved them into `workflow/repository.ts` without adding SQL reach; it did not create a newly demonstrated HTTP leak. That preservation of old behavior does not exempt the candidate from the now-accepted semantic query contract. The issue is that the repository boundary itself can be invoked with arbitrary IDs (or a global audit query) and returns row content with no caller-bound SQL reach. A future caller mistake or an authorization change between the first lookup and the second query would not be contained by these statements. I have not measured or demonstrated such a race here.

## Scope, action and checks

This finding covers the identity-less **actor-facing row-content read** shape demonstrated by workflow list/detail and instance/workspace audit reads. It does not prescribe a particular API signature, alter AU-11, require a literal fluent `forIdentity` wrapper, or assert that identity/bootstrap existence probes have the same status without reviewing their purpose. A bounded source correction should make these repository reads consume resolved caller authority and enforce its reach in the statement predicate, preserve the current route denials and intended administrator reach, and receive fresh independent review/tests on the new exact head. The conductor should decide the implementation lane and broader #580 sweep; this note is read-only adjudication.

I confirmed clean checkout at publication `e533a987`, source/contract equality to `a560cc0`, the original report digest, accepted rule text, workflow schema/repository/router/controllers/middleware/capability path, bounded audit repository/controller paths and AU-11. I compared accepted-main workflow controllers to see that the ID-only behavior predates extraction. I ran no tests, PostgreSQL, Docker, browser, CI, source edit, commit, push or PR action in this follow-up. The earlier 2-file/65-unit result belongs to the original source review and does not test this contract.

---

Retained evidence file — notification-query-scope-correction-final-luna.md

# #785 query-scope correction — author handoff

Access: mode 0600. This is a public-safe derivative of the private attempt record: it omits database URLs, credentials, and SQL parameters. The original `notification-query-scope-correction-luna.md` remains immutable and credential-bearing; do not copy or publish it.

## Frozen source

Worktree: `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`  
Branch: `codex/query-ownership-580-b4`  
Final HEAD: `3dc8b113780a069ab2454737d92ca0cbd37bf095`  
Tree: `f56834a0c48786c67d16c467f5c444a60062a643`  
Working tree: clean at handoff.  
Diff SHA-256 from accepted-#784 merge base `4723801e6d7eadedca5dff87c66bf2fd7ca2b3a3`: `1761519eff1220baa8a83456b4044b52c5d2e3403b03dc7fe9aabbfc81daf0d0`.

Commit sequence in this lane: `fea1bc7b1a59693314eb9fa8c71da58652cd776a` records the WF-9 owner decision; `09fbf1490693bc4b2c85627fa1fe5bf450626c14` implements scoped workflow/audit reads; `3dc8b113780a069ab2454737d92ca0cbd37bf095` adds the workflow-manage API-key validation/publish regression. Accepted #784 was brought in earlier by normal merge `4723801e6d7eadedca5dff87c66bf2fd7ca2b3a3`, parents `3600738b3b25e506a2e7d54dc19fd3f21f235e66` and `1f2ea00404e41e108fad437c2b87caa3bbf56298`.

Lane changes after that accepted-main merge: `apps/api/src/audit/controllers/list-instance-audit.ts`, `apps/api/src/audit/controllers/list-workspace-audit.ts`, `apps/api/src/audit/repository.ts`, workflow create/get/list/publish/validate controllers, `apps/api/src/workflow/index.ts`, `apps/api/src/workflow/repository.ts`, the focused audit/workflow integration tests, `docs/03-features/workflows.md`, and the appended `docs/07-planning/decision-log.md` entry. No schema, route, capability, dependency, environment, or feature change was introduced.

## Owner decisions recorded before dependent implementation

Thomas's WF-9 access answer: “Require access to every adopting project (Recommended): otherwise return a generic refusal without project or item details.” WF-9 adoption-set answer: “Every project in the workspace, including empty and archived projects (Recommended).” The latter is sourced to `call_be4fae73c6c54175992e413270fc6f0c item0`; the exact response is also preserved in `workflow-wf9-adoption-owner-decision-20261016.json`. The receipt records `2026-10-16T08:04:55.495441+00:00`; no more precise receipt time is claimed.

The WF-9 code now checks every project row in the workflow workspace, including empty and archived projects. Before returning any project/item validation details or publishing, a scalar SQL refusal query checks for an inaccessible project and returns the generic “Workflow project access required” response without IDs, counts, or names. SQL project/workspace predicates are derived from `ResolvedIdentity`; IDs further narrow the result. Validation and publication return no hidden project data and a refusal leaves `activeVersionId`, `publishedAt`, and `publishedBy` unchanged.

WF-19 remains shape-only during authoring: the global person-existence preflight is removed, so an unknown literal assignee ID can be saved. Execution-time active project-roster eligibility and whole-transition refusal remain authoritative. Held `set_field`, transaction ordering, audit ordering, and existing workflow mutation behavior were preserved.

Workflow reads (`findWorkflowTree`, workspace list, version and reference reads, WF-9 per-project reads) and actor-facing audit reads now take `ResolvedIdentity` and apply reach predicates in SQL. Existing route admissions and instance-admin/AU-11 behavior remain intact. API-key identity uses the already accepted #784 canonical stored-scope/owner clamp; no unaccepted #783/#784 source was imported independently.

## Verification

- `pnpm --filter api typecheck`: exit 0, including the API-key WF-9 regression changes.
- `git diff --check` on authored commit deltas: clean. The normal commit hook completed successfully. Biome reported pre-existing `noNonNullAssertion` warnings in the broad integration-test file, but no blocking diagnostics; no skips or disabled assertions were added.
- Focused PostgreSQL 18 workflow run before the error-body assertion correction: exit 1, 1 failed / 2 passed / 10 skipped. The defect was test-only: Hono emits the refusal body as plain text, while that assertion tried JSON parsing. The test was corrected to assert exact plain text; no source behavior changed to make the test pass.
- Focused PostgreSQL 18 rerun: `workflow.test.ts`, 3 passed / 10 skipped / 13 total. Covered all-project positive validation/publication, hidden empty+archived project generic refusal/no publication effects, and WF-19 unknown-ID authoring.
- Combined focused PostgreSQL 18 run across `workflow.test.ts`, `audit-read.test.ts`, and `notification-scheduler-workflow-audit-repositories.test.ts`: 3 files passed; 9 passed / 29 skipped / 38 total. Included API-key instance audit scope, API-key workspace audit scope, workflow-key list/detail, direct repository foreign-project filtering, and workflow/audit repository predicates.
- Final focused PostgreSQL 18 API-key run after adding the positive key path: `workflow.test.ts`, 1 passed / 12 skipped / 13 total. A `workflow:manage` API key with its owner's explicit reach over every project successfully validated and published a version covering the empty and archived projects. The test preserved no raw key in output.
- Final focused PostgreSQL 18 reach/denial run: 2 files passed and 1 file had no matching tests; 6 passed / 32 skipped / 38 total across three requested files. Covered direct workflow-repository current-workspace listing and foreign-workspace exclusion, route cross-workspace 404, insufficient workflow-manage denial, direct instance-audit repository authority denial, notification repository reach filtering, and WF-19 unknown-ID authoring.
- No full suite, hosted CI, build, browser, SIT, or release check was run. Focused tests select cases by Vitest name pattern and do not imply the skipped cases passed.

Raw private logs and receipts are retained under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/`: `queryscope-wf9-focused-run.log` (failed assertion; SHA-256 `16d13fc652045c762ca55b0ede16b87835879fb491046dcf7a39af2ae483b58e`), `queryscope-wf9-focused-rerun.log` (pass; SHA-256 `5a6728a96b3ee3cf4bb5a35d8d250f812541ad3ea843305345f29147a2af9fcf`), `queryscope-accepted784-plus-wf9-focused-run.log` (pass; SHA-256 `274543d1fbb4966ac7e0315256abcd9b51cbd512d8bf4683a5f39da848229de4`), `queryscope-wf9c-key-positive.exit` (exit 0; tool output recorded one test passed and 12 skipped), and `queryscope-wf9d-reach-denials.log` (pass; its exit file and the Docker receipt/inventories are alongside it). The initial PostgreSQL 18 mount-path startup failure is preserved in `queryscope-wf9-first-attempt-container.log` and its owned-resource receipt. These files remain private.

The isolated PostgreSQL instances used unique lane-owned container/network/volume names and loopback-only random ports. Exact container mount receipts were captured before cleanup. Docker events directly tied anonymous volume `1b4b291d1202850f4a6112ab84bbc859ae7607c7f4e869eb4e9a8462216904d7` to failed container `d432f1eac8d81d3f28a791d0127bfd1f42af03fe04b246cb727bd7c1c6b0ec22`, mounted at `/var/lib/postgresql`, then unmounted. A `docker ps -a --filter volume=<that exact ID>` check found no current container user; only that proven-owned unused volume was removed. Before/after container, network, and volume inventories match for both test windows. Event, inspect, mount, and inventory records are mode 0600. No existing UI/SIT/application resource was reused or removed.

## Review handoff

This is an author report, not a review or clearance. No independent review note was written or appended. Root can now assign three fresh ordinary reviews and a fresh full GPT-6 Sol review against exact HEAD `3dc8b113780a069ab2454737d92ca0cbd37bf095`. The earlier adverse/qualified #785 records remain unchanged. Historical broad suite counts or proof from an older candidate do not establish current-head acceptance.

---

Retained evidence file — notification-3dc-ordinary-a-luna.md

# #785/#580 query-scope correction — ordinary review A

**Role:** Fresh independent ordinary reviewer (1 of 3). I did not author, direct, or remediate this candidate. This review is limited to exact source `3dc8b113780a069ab2454737d92ca0cbd37bf095`, tree `f56834a0c48786c67d16c467f5c444a60062a643`, branch `codex/query-ownership-580-b4`, compared with accepted main `1f2ea00404e41e108fad437c2b87caa3bbf56298` and the candidate's accepted #784 merge.

**Model:** GPT-6 (this independent reviewer context; no more specific platform model/version attestation is available in this report).

**Verdict: CLEAR for ordinary review A.** I found no blocking correctness or contract issue in the reviewed source. This is one of the required three ordinary reviews, not security clearance, CI approval, merge approval, or feature/stage/SIT acceptance.

## What I checked

- Confirmed the worktree is clean and HEAD/tree match the assigned frozen source.
- Read the repository instructions, workflow, coding standards, query ownership rule, workflow and audit feature contracts, the two specified owner decision records, the public-safe author handoff, and the prior Sol query-scope adjudication. I did not read the credential-bearing private incremental report.
- Inspected the actual candidate diff and the workflow/audit repository and controller paths. Workflow detail/list/version/reference/project reads consistently accept `ResolvedIdentity`; their SQL predicates bind workflow workspace scope and, for projects, project reach. The detail tree's nested versions/transitions are only loaded after the scoped workflow row qualifies. IDs further narrow scoped queries.
- Confirmed the WF-9 implementation adopts every project in the workflow workspace, including empty and archived rows. The preflight checks for an inaccessible project and returns only a scalar generic refusal before exposing project/item validation data or publishing. The publish transaction and route continue to use the same resolved identity for transition reads. WF-19 remains shape-only at authoring, as decided.
- Checked actor-facing audit list queries. Instance audit returns rows only when the resolved identity has staff `all` reach; the route still applies the instance-admin gate and stored API-key capability check. Workspace audit applies workspace reach and the documented AU-10 row rule (non-project rows, project memberships, or `sees_all` scoped to that workspace) in SQL. Portal/customer identities fail closed. Read audit writes remain after the read query.
- Reviewed workflow/audit regression coverage for API-key scope, cross-workspace masking, reachable and unreachable WF-9 project sets, no publication effects on refusal, instance authority, workspace `sees_all`, and foreign-workspace repository filtering.
- Confirmed the accepted #784 API-key canonical stored-scope/owner clamp is used by request identity resolution and is not replaced with an unaccepted branch. Reviewed the executor call shape in the touched workflow transaction operations and the existing UTC clock/auth predecessor paths at source level; this candidate does not alter those accepted contracts.
- `git diff 4723801e6d7eadedca5dff87c66bf2fd7ca2b3a3..HEAD --check` is clean.

## Findings

No blocking findings. No non-blocking finding requiring a code change.

## Not checked

I ran no tests, PostgreSQL, Docker, browser, build, full suite, hosted CI, source edit, commit, push, or PR action. Test results in the author handoff are source-bound claims I inspected for relevance; they are not runs performed by this reviewer. I did not enumerate every repository in the 67-path cumulative source; the review's primary scope was the query-scope correction, workflow/audit actor-facing reads, accepted predecessor preservation, and directly adjacent regression coverage. A fresh full Sol security review remains required after all three ordinary reviews clear.

---

Retained evidence file — notification-3dc-ordinary-b-luna.md

# #785 / #580 exact-head ordinary review — B (2 of 3)

**Reviewed source:** `3dc8b113780a069ab2454737d92ca0cbd37bf095`  
**Tree:** `f56834a0c48786c67d16c467f5c444a60062a643`  
**Comparison base:** accepted base `1f2ea00404e41e108fad437c2b87caa3bbf56298`  
**Role:** fresh independent ordinary reviewer B; I did not author, direct, or remediate the candidate.  
**Model:** GPT-6 (the runtime did not expose a Luna/Sol alias or serving-version attestation); assigned ordinary B by the conductor.  
**Verdict:** **BLOCKED — one concrete WF-9 consistency finding.** This is not security clearance. The prior Sol adjudication of earlier head `a560cc0` is not a verdict on this head; I reviewed current source and the settled owner decisions.

## Scope checked

Confirmed the checkout HEAD/tree and clean working tree. Read repository instructions, workflow and coding standards, query ownership contract, data model, workflow spec, the public-safe author handoff, prior Sol adjudication, and both direct owner-decision records. Reviewed the complete net file list/stat (67 paths; 9,010 insertions and 1,302 deletions) and concentrated source inspection on the workflow repository/controllers/router and regression tests, audit repository/controller reads, and the #785 changed notification inbox/reach/repository paths. The notification review was bounded source inspection, not an exhaustive re-review of all inherited #784 notification behavior.

The settled WF-9 decisions are unambiguous: adopting set is every project in the workspace, including empty and archived; caller must reach all of them or receive a generic refusal without project/item details. WF-19 authoring is payload-shape-only for `set_assignee`; execution checks active project roster and refuses the whole transition. No product decision is reopened here.

At this head, the new workflow reads accept `ResolvedIdentity` and place identity-derived predicates in SQL; actor-facing audit reads were similarly moved to repositories and now consume identity. The workflow router still applies existing workspace access and capability middleware. WF-9 enumerates all project rows without an archive or work-item filter, checks for any unreachable project with a scalar result before returning details, and uses the same generic 403 text for validate and publish. Validation gathers project defaults, active concrete states, and live item state templates; project results can expose data only after the complete-reach refusal. The new tests cover a workflow-scoped API key with positive access to empty and archived projects, generic refusal when an archived project is hidden, and no publication stamps/active-version change after refusal. The unknown-person authoring test saves the literal ID. `publishWorkflowVersion` does the complete-reach check before opening its write transaction, then stamps and activates on the transaction handle; the existing effects and publication order are otherwise preserved.

The concrete SQL reach helper in `workflow/repository.ts` covers instance-wide `all`, organisation reach, workspace `sees_all`, and direct project membership. It does not encode the RBAC spec's inherited ancestor-project or owner-team reach. That can conservatively deny a caller who has those grants; I did not find an overexposure from this omission in the reviewed paths. Whether the existing `ResolvedIdentity` facts are sufficient to implement those SQL predicates on this route needs a contract-level solution and is not treated as a demonstrated leak.

## Blocking finding — WF-9 complete-reach check and publication are not atomic

`hasCompleteWorkflowProjectReach` in `apps/api/src/workflow/repository.ts` first confirms a visible workflow and then runs a separate query for an unreachable project. `validateWorkflowVersion` calls this helper and subsequently performs additional independent queries to list the adopting projects, defaults, states, and items. `publishWorkflowVersion` calls the helper outside `db.transaction`, then starts a separate transaction for `stampVersionPublished` and `setActiveWorkflowVersion`.

A concurrent project creation in the workflow workspace after the complete-reach query can therefore be absent from validation's later project list or from the publishing authorization decision. A concurrent reach revocation can similarly make the caller no longer satisfy the all-project requirement before publication. There is no shared snapshot, lock, or in-transaction recheck tying the all-project predicate to the result/publish effects. This violates the settled requirement that validation/publishing cover every workspace project and must not operate on a reachable subset. The publishing denial test proves the static hidden-project case but cannot prove this race-safe property.

Keep validation's access oracle and all detail reads on one consistent transaction snapshot, and make publication's complete-reach decision and publication writes share a transaction/serialization strategy that also handles concurrent project-set changes. The precise locking mechanism is an implementation choice; the invariant must be tested with meaningful concurrency coverage. Do not return hidden IDs/counts while handling the race.

## Checks and limits

- Source and docs inspection only; no tests, PostgreSQL, Docker, browser, build, typecheck, CI, source/reference discovery, or edits were run.
- `git diff --check` was run on accepted-base-to-head. It reports trailing whitespace and a final blank line in the already-present `docs/07-planning/security-reviews/query-ownership-notifications-580.md`; I made no change to that file. These whitespace diagnostics do not alter this review verdict.
- No suite counts are claimed. Test cases were read, not executed.
- No raw credentials, raw URLs, SQL parameters, or incremental report were copied into this note.

**Residuals:** broad notification behavior was reviewed at the source-path level only; no runtime proof was performed. The prior Sol adjudication on `a560cc0` raised broader identity-less actor-facing reads; this head changes the workflow and audit paths to accept identity, but this ordinary note does not supersede or close a security-tier adjudication. No candidate clearance is granted.

---

Retained evidence file — notification-3dc-ordinary-c-luna.md

# #785 ordinary review C — exact head 3dc8b113780a069ab2454737d92ca0cbd37bf095

**Model:** GPT-6 Luna (assigned reviewer role; model/version as reported in this context)
**Role:** Fresh independent ordinary reviewer C of 3 required.
**Independence:** I did not author, direct, or remediate this candidate. I reviewed the frozen worktree at `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, HEAD `3dc8b113780a069ab2454737d92ca0cbd37bf095`, tree `f56834a0c48786c67d16c467f5c444a60062a643`, against accepted base `1f2ea00404e41e108fad437c2b87caa3bbf56298`.

## Verdict

**BLOCK.** The frozen candidate contains a concrete current-reach omission in notification inbox reads and mutations: only native `work_item`/`comment`, legacy `task`, `approval`, and two instance-alert forms receive resource-specific authorization. Other registered resource classes are accepted as recipient-only rows, contrary to the notification contract. This can expose stale resource content after reach or authority is revoked and also lets bulk operations act on such rows. Ordinary review C does not clear this source.

## Blocking finding

`apps/api/src/notification/inbox.repository.ts` `readableNativeRows` returns `true` for every row whose resource type is not `work_item` or `comment` (including `identity_connection`, `webhook`, `api_key`, `automation`, `pending_action`, `project`, `workspace`, `person`, and unknown types). `selectCandidatePage` adds SQL reach only for legacy `task` and approval; its self-user predicate does not establish current resource reach. `listVisibleNotificationRows` therefore returns these other row contents based only on `user_id`, while `markOwnReadableNotificationRead` likewise permits one-row mutation except for `instance`/`audit_write_failed`, and `bulkMutation` treats them as readable for mark-all and clear-all.

The feature contract in `docs/03-features/notifications.md` § Permissions says list, read and mutation operations apply current reach to each referenced resource, missing/unknown mappings fail closed, and specifically requires current `instance:admin` for `identity_connection` rows. The implementation has no such check for `identity_connection`; it is guarded only when `resourceType === 'instance'` or `type === 'audit_write_failed'`. A recipient whose instance authority or resource reach was revoked can still receive the stored title/body/eventData for an older row. This is a content-read issue, not merely an inaccurate count. The task/workspace compatibility behavior in the repository comment does not supply the missing checks for the other registered mappings.

**Suggested bounded correction:** have every registered resource class resolve current owning facts and apply its documented current reach/authority before returning or mutating the candidate. Reject unknown/missing resource mappings. Preserve self-recipient scoping and the established native work-item/comment policy. Add integration regressions for at least one revocable instance-authority row (`identity_connection`) across list, direct mark-read, mark-all and clear-all, plus a non-instance resource whose reach is revoked; test unknown discriminator fail-closed. These tests should seed the persisted row directly so they exercise reads of historical rows, not only creation eligibility.

## Review scope and checks

Read repository instructions and the relevant query-ownership, multi-tenancy, RBAC, audit-trail, notification, background-job and workflow contracts. Inspected the net diff and source for notification identity/reach handling, actor-facing workflow repository predicates, AU-10/AU-11 audit SQL and route gates, workflow validation/publication and WF-9/WF-19. Verified the supplied owner decisions: all workspace projects including empty and archived are in the adopting set; inaccessible adoption returns a generic refusal; WF-19 authoring checks shape only. The workflow paths appear aligned with those decisions at source level. Audit SQL preserves AU-10 per-workspace project membership/`sees_all` and non-project rows, and AU-11's global source predicate requires staff identity with global reach while the route retains `instance:read_audit` key-scope enforcement. The audit append-chain scan remains global for integrity verification, not an actor-facing read. No separate blocker found in those bounded source paths.

No tests, PostgreSQL, Docker, browser, build, typecheck, CI, CLI cases, or full suite were run, per assignment. No raw URLs, credentials, SQL parameters or private run logs were accessed or included. The private author handoff's focused PostgreSQL counts are reported only as prior-head author evidence and were not treated as independent reproduction or proof for this review. No source/ref/PR edits were made.

## Residuals / not done

This is ordinary review C only. The ordinary panel is not complete until all required independent reviews clear, and a fresh full GPT-6 Sol review remains required after ordinary clearance. No approval, merge, SIT, or stage-completion claim is made. I did not audit every repository or run the full acceptance graph; the finding above is sufficient to block this candidate.

---

Retained evidence file — notification-wf9-consistency-reach-advice-sol.md

# WF-9 consistency and canonical reach — bounded architecture advice

Provenance: GPT-6 adviser context `/root/notification_wf9_consistency_reach_advice_sol`; platform exposes no more specific serving-version attestation here. Source inspected: frozen `3dc8b113780a069ab2454737d92ca0cbd37bf095`, worktree q580-b4, accepted comparison base `1f2ea00404e41e108fad437c2b87caa3bbf56298`. This is design advice, not independent review, security clearance, or disposition of the eventual implementation. This context directs the proposed repair and cannot independently review it.

## Actual findings

B identifies a real mixed-snapshot defect. The two queries inside hasCompleteWorkflowProjectReach use shared db; validate then independently reads templates, transitions, projects, defaults, states and live items. Publish checks reach before opening its transaction. A single Executor passed only to the write calls does not bind either preflight to those effects. Default READ COMMITTED transactions would still give each statement a fresh snapshot and do not fix the validate sequence.

B's ancestor/owner-team suggestion is not a demonstrated current implementation bug. The canonical rbac.md Reach list includes those eventual grants, but its explicit current-schema qualification at lines 245–248 says neither relation exists and they remain unavailable until their own schema and loader. The actual projectTable has neither parentId nor ownerTeamId; strict-policy-enforcement.ts supplies ancestorProjectIds: [] and ownerTeamId: null. The pure evaluator supports supplied typed facts, and canonical identity loads team IDs, but team membership alone is not project ownership. Do not fabricate those facts or import unaccepted #790. Future implementation of those relations belongs to their own schema/loader work.

A second parity concern worth checking during the bounded fix: workflow projectReach tests raw membershipTable existence, whereas resolveIdentity accepts only scope-consistent, well-anchored joined role rows. A malformed membership with an absent/wrong-scope/foreign-workspace role must not become project reach merely because a row exists. Use canonical loaded membership IDs or SQL with exactly its accepted validity rules; do not silently create a new grant interpretation. This is source-derived risk, not a runtime reproduction performed here.

## Bounded structural plan

Use existing service/controller db.transaction orchestration and repository-owned SQL; extend the affected repository functions with optional final Executor and executorOrDefault, or required first Executor where transaction-only. Thread the same handle through every awaited read, including workflow/version existence, complete-reach oracle, reference sets, project enumeration and details, and through publish stamps/activation/returned transitions. Avoid a new abstraction pretending to enforce scope automatically. Subquery builders using db must not accidentally execute separately; all actual statements must execute on tx.

Validate should use one explicit REPEATABLE READ transaction snapshot (read-only if convenient), materialize its entire result inside the callback, and return only after success. SERIALIZABLE is also valid but is unnecessary merely to obtain a consistent read-only snapshot. Every project in the workspace, including empty and archived rows, remains the adopting set. Keep the scalar generic refusal before materializing detail payloads; never return hidden identifiers or counts.

Publish should perform its version lookup, complete-reach predicate, writes and response reads inside one explicit SERIALIZABLE transaction, with bounded whole-transaction retry on PostgreSQL 40001. The existing inbox repository demonstrates isolation configuration and bounded retry; reuse the established error-unwrapping approach rather than inventing a global transaction framework. Retries must rerun all reads and reconstruct the response; never retry only the final update. Serialize concurrent publication of the same workflow with its existing workflow row lock if needed for the existing mutation contract; row locking only the current project rows cannot cover a newly inserted project phantom. An advisory workspace lock would work only if every project creator/reach mutator participates; adding a unilateral lock here establishes no such invariant and is not the bounded recommendation.

A SERIALIZABLE predicate read covers the entire adopting-project set and participating persisted reach reads as a serializable database operation. It does not necessarily abort an overlapping insert/revoke: PostgreSQL may legally serialize publish before that other transaction. An empty project set needs no special row-lock surrogate when the predicate is read at SERIALIZABLE isolation. Do not assert that every concurrent project insertion must be refused or that revocation committed before publish's wall-clock commit must always win.

Choose and document the identity epoch explicitly within this local operation. Request admission already resolves a canonical identity and capability clamp; it is not inherently a promise of instant in-flight revocation. For the strongest simple snapshot invariant, reload the same authenticated principal through existing resolveIdentity(input, tx) inside the operation snapshot, retaining the accepted credential kind and stored API-key clamp; this function already supports an executor. Pass this local canonical identity to all WF-9 queries. Do not rebuild a key identity as a session, widen its capabilities, or rewrite identity semantics globally. If retaining admission identity instead, the invariant must honestly say request-admitted reach plus snapshot-consistent resource facts; persisted membership predicates must not inconsistently use a later epoch while sees_all/all use the earlier one. The local reload is preferable because it also sees revocations committed before the snapshot begins. Credential authentication itself remains the established admission boundary; do not claim this local repair adds a fresh key/session validation system.

## Contract and ordering limits

The owner records settle every workspace project and generic refusal, not immediate cancellation of admitted requests. RBAC says role/key changes apply on the next call. A coherent operation snapshot and SERIALIZABLE publish order satisfy ordinary concurrent-operation semantics: an overlap can be ordered before or after the mutation. They do not promise that no detail response can arrive after a simultaneous revoke, nor that a concurrent newly created project retroactively invalidates an earlier publish. A stronger commit-time revocation barrier would require a shared lock protocol across all grant changes, project creation, account/organisation/key changes and publication; that is larger authority machinery and not justified by the supplied decisions. No new Thomas decision is necessary for standard snapshot/serial ordering. If someone requires the stronger guarantee, record that as a separate real contract question before designing it.

## Meaningful PostgreSQL regression plan (not executed)

Use the actual PG integration harness and two real connections with explicit barriers, not sleeps. A test seam/spy may pause after a real repository query returns; it must delegate to the real query and never inject an allow/deny predicate or fake identity. Keep fixtures in the lane's private test database and retain exact suite/file counts.

For a deterministic pre-fix validate failure: begin with caller reaching all projects; pause immediately after the real all-project oracle. On the second connection commit a newly created project plus a legitimate direct grant for this caller and a distinguishing default/state/item fixture. Resume. Old code exposes a project set from after the oracle alongside older graph facts (alternatively revoke a previously reachable project's membership and observe silent omission). Assert the result is wholly the earlier snapshot or a wholly retried later snapshot, never a mixture/subset. A particularly strong variant atomically swaps caller reach between two projects so there is no database snapshot at which complete reach holds; the old helper/detail sequence can still produce partial output. A hidden-project insertion alone followed by old reachable-only enumeration may yield a result indistinguishable from legal earlier snapshot semantics, so that test alone is insufficient proof of failure.

For publish test the actual transaction boundary: pause before the first real in-transaction publication write, commit hidden-project creation or direct-grant revocation on connection B, then resume. The old preflight can admit publication despite its write transaction observing the later inaccessible project. This demonstrates the transaction-boundary defect, but publication success alone is NOT an externally invalid serial history: the overlapping operation could still be ordered before creation. Require evidence of the mixed transaction snapshots or construct an actual serialization cycle; do not label this simple overlap an instant-revocation failure. With the fix, a transaction started after that committed mutation must refuse generically with unchanged publishedAt/publishedBy/activeVersionId; a transaction whose snapshot already precedes it may succeed and serialize first. Capture backend transaction/snapshot evidence via test instrumentation so the assertion does not confuse callback entry with the first snapshot-producing statement. Add a genuine SSI conflict schedule if retry handling is introduced, verifying whole-operation retry or safe exhaustion and no partial publication. Do not demand an abort from a single read/write dependency: SSI permits that schedule. Prove a mutation committed before the operation's first snapshot is visible and refused; separately accept either serial outcome for true overlap. These tests distinguish actual SQL isolation from mocks and avoid inventing instant revocation semantics.

Canonical parity matrix should exercise real resolveIdentity plus actual workflow SQL: instance all, valid workspace sees_all (including owner/admin persisted grant), direct valid project membership, ordinary workspace membership with no project grant denied, foreign workspace denied, customer/portal denied, and API-key capability narrowing unchanged. Add malformed scoped role/membership fixtures if raw-row parity is repaired. Test zero projects, empty projects and archived projects. Ancestor and owner-team cases presently assert no inferred grant from a team membership or nonexistent relation; pure evaluator tests already verify hypothetical supplied ancestor/owner-team facts. There can be no honest PG positive hierarchy/ownership integration case without schema that this task forbids adding.

## Evidence and limits

Read repository instructions/workflow/provider adapter/active mission, coding SQL/Executor standard, WF-9/WF-19, RBAC and actual project schema, evaluator, canonical identity loader/request adapter, workflow controllers/repository, existing transaction/lock patterns, ordinary A CLEAR and B BLOCK reports, public-safe final author handoff, and both owner-decision JSONs. Did not open credential-bearing incremental report or raw test logs. C's separate mapping finding is outside this advice and is being independently adjudicated. The author handoff's test counts remain source-bound claims, not tests performed by this context. Held set_field and WF-19 shape-only authoring/active-project-roster execution must remain unchanged. No source/spec/log edits, tests, PG, Docker, browser, build, CI, commit, push or PR work performed. Only this mode-0600 private advice artifact was written. Root alone collects the complete review set and authorizes the batched implementation. No waiver, phase completion or SIT claim.

---

Retained evidence file — notification-resource-scope-advice-sol.md

# Notification closed resource-policy advice — bounded Sol architecture analysis

Source: 3dc8b113780a069ab2454737d92ca0cbd37bf095, clean frozen source at /Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2; comparison accepted base 1f2ea00404e41e108fad437c2b87caa3bbf56298. The assignment's trailing /baseaccepted1f was not a directory; source HEAD was verified at the parent worktree.

Role: read-only security architecture advice for existing #785/#580 acceptance, not an independent review of a future implementation. This context materially directs the proposed correction and cannot supply its independent clearance. No stage/SIT closure or source approval.

## Finding and scope distinction

C's blocker is confirmed by source inspection. inbox.repository.ts taskNotificationReadable and approvalNotificationReadable explicitly admit every other discriminator. readableNativeRows returns true for non-native rows. selectCandidatePage selects the entire notification before native evaluation. list additionally tests allowed-set membership only for native rows. Direct mark-read resolves authority only for native and instance/audit alerts; bulk changes use the permissive allowed set. Recipient identity alone cannot authorize historical resource content or effects after reach loss.

This is not merely hypothetical future identity_connection fanout: notification/index.ts has a current legacy workspace.created subscriber writing resourceType workspace and the stored workspace name. Creation checks only task reach in controllers/create-notification.ts. A historical workspace row survives workspace authority/reach revocation, and all four inbox operations admit it. Source establishes this path; no HTTP or PostgreSQL reproduction was run. identity_connection is an explicit spec mapping but I did not find a current producer using it; do not describe that particular event's production disclosure as demonstrated. Fanout's RESOURCE_TYPES allows the broad vocabulary but is not proof that each class has a working resolver. resource-contract.ts and current-eligibility canonicalBinding currently support only work_item/comment/approval/workspace. Unsupported send-time mappings already suppress; this must not be converted into authorization.

The prior Sol adjudication establishes caller-bound SQL as an accepted contract, independently of whether a guarded HTTP path currently leaks. The same distinction applies here: preventing serialization in JS is necessary but insufficient where notification content has already been loaded by an unscoped SQL query.

## Bounded structural invariant

One closed resource-policy decision must govern list, direct read/mark, read-all and clear-all, with no default recipient-only branch. A row is eligible only when (1) its user recipient equals the authenticated caller, (2) its discriminator plus event/operational kind and canonical resource binding is registered, (3) owning resources exist and satisfy live/deletion rules, and (4) the resolved identity has the documented current reach, capability and recipient relationship. Unknown discriminator, missing ID, unmapped kind, malformed binding or unavailable policy implementation yields false. Admin status never permits somebody else's inbox.

Apply the invariant in the SQL statement before fetching title/content/body/eventData and in each UPDATE/DELETE predicate, rather than fetching content and filtering it afterward. A bounded metadata/fact query may precede this to evaluate canonical can()/reaches() where SQL reproduction would risk semantic drift; it must fetch only the minimum identifiers/facts, take the resolved identity and executor, apply caller reach, and the later content/effect statement must bind the authorized row/resource tuple and its current owning-resource predicates. Merely caching allowed notification IDs after a recipient-only content query does not meet the contract. Avoid a generic forIdentity framework: use a notification-local closed predicate/dispatch with correlated EXISTS, current canonical identity and existing query patterns. Do not duplicate a growing list of negative exclusions.

Resolve identity with the existing transaction-aware resolveIdentity adapter, including stored API-key scope/owner clamp where the route permits keys. Reuse existing can/reaches semantics, role scope tier/capability expansion and customer membership loader; never infer authority from a recipient ID, stored project ID, user.role alone, or identity-provider claims. Native facts in notification/repository.ts already resolve ID/key, comment ownership, project organisation, deletion/archive state, private requester/participants and comment customer visibility; preserve these facts and native-inbox-reach's different customer organisation versus staff work-item authority scopes. Retain the accepted customer event audience/status-transition policy; do not categorically suppress public state transitions.

Keep keyset paging and apply the visible result limit after authorization, with unknown/hidden rows consuming no response count. Direct hidden/missing rows retain indistinguishable not-found; findOwnNotificationType is an internal narrow metadata probe, not authority or content permission. Preserve session-only notification writes and existing API-key read scope rather than inventing notification capabilities.

## Mapping and implementation boundary

| Resource | Existing authoritative rule | Frozen implementation / bounded disposition |
| --- | --- | --- |
| task (legacy compatibility) | Existing work_item:read authority and current project reach; owner D10 preserves hidden rows unread | Existing correlated task predicate. Preserve supported legacy type mappings explicitly; not a wildcard compatibility exemption. |
| work_item | Live item/project; current reach + work_item:read; customer organisation authority and visibility/event audience | Existing native loader/evaluator. Move protection ahead of content SQL and share effect guard without weakening it. |
| comment | Live visible comment and owning live item/project; NO-19, customer/public/private policy | Existing native loader/evaluator; preserve body-not-null and ownership checks. |
| approval | Current anchored work item/project and approval visibility; customer only addressed/raised | Existing approval correlated SQL currently staff-only; do not silently expand customer exposure or use send-time state eligibility as inbox retention policy. Preserve current supported staff path; explicit held customer path fails closed pending its owning implementation. |
| workspace | Current workspace reach / workspace:read, owning row live | Existing current writer and send-time workspace loader/can check. Concrete correction, not new feature. Handle explicit legacy workspace_created mapping and native workspace.created. |
| instance | singleton operational AU-14, current active staff instance:admin; own inbox | Existing guard, preserve and bind inside shared SQL policy. Existing admin-grant security_alert also uses instance/singleton: it needs its explicitly documented operational-kind mapping, not an audit-only assumption. |
| person | Own private account security notice; closed safe payload | Spec rule exists, but reset-mfa currently writes NULL discriminator/ID, while grant-admin uses instance. Do not exempt every NULL row. See compatibility issue below. |
| identity_connection | Current instance:admin, live connection; safe projection without provider/person data | Explicit spec rule, no current notification producer established here. Either implement narrow existing connection fact policy or hold unsupported rows false; no new activation. |
| project | budget.threshold_reached resolves budgetId -> current budget.project_id; live budget/project, project:read, current manager only | No resource-contract/send-time implementation. Do not assume payload projectId or invent manager fallback. Unsupported mapping false until canonical facts can be supplied. |
| webhook | Current webhook:manage reach or creator ownership, event recipient rule | Future feature documented in webhooks-and-api-keys.md; unsupported policy false rather than new webhook schema/feature. |
| api_key | Current owner identity, owner-only event | P4 key extension/service-key model is not current Better Auth storage. Do not invent mapping or treat referenceId as every key kind's owner. Unsupported false. |
| automation | Current project/automation reach AND creator ownership | Spec exists; unimplemented notification mapping false, no new automation subsystem. |
| pending_action | Requester ownership; requested api/mcp origins only, executed failure only | Owning architecture/pending-actions and decision-log already settle requester self-read and revocation. Use canonical requester facts if supported; otherwise false. No MCP permission or new service-key policy. |
| submission | Current requester/org customer-visible portal policy; staff triage queue | Explicit spec, unmapped current eligibility; hold false instead of designing intake visibility here. |
| prerequisite | Current project reach through prerequisite owner | Explicit spec, unmapped current eligibility; hold false if no existing canonical resource facts. |
| unknown/null/missing | Fail closed, no recipient-only fallback | Must fail false on every read/effect path, including bulk. |

Fail-closed support status must be explicit and tested for every vocabulary class. It is acceptable for an unimplemented product class to have no positive path; it is not acceptable to claim that class is implemented or to authorize it by recipient alone. Do not hide a currently supported workspace/native path merely to get tests green.

## Compatibility issue and actual owner uncertainty

D10 (2026-10-10 decision log) already settles read-all: hidden rows stay untouched and unread; restoration can reveal them unread. No owner question is needed for that. The 2026-10-07 notification self-write decision already settles session-only mutations. AK-7 and MCP decisions already distinguish service-key ownership and prohibit service MCP keys; do not reopen them or invent an owner substitution.

One discovered mismatch deserves a bounded owner/spec trace before finalizing compatibility: reset-mfa inserts security_alert with null resource binding although notifications.md defines private security_alert as person. The contract provides the destination rule, so a future writer correction to canonical person binding is not a new permission. However, authorizing existing null-bound rows using only type=security_alert would create an undocumented compatibility exception; do not do that silently. Default is hide malformed historical rows. If preservation of these historical private notices is an acceptance requirement, root should locate an existing explicit compatibility decision or obtain a precise owner decision before a migration/backfill/legacy exception. The admin-grant notice is independently instance-scoped today and contains a target userId for other admins: do not remap it wholesale into private person notices. No new owner-only product gap is needed to close the demonstrated workspace/unknown/resource-policy omission.

## Regression plan and preservation

Use actual PostgreSQL historical notification inserts, then change current owner/resource/reach facts and invoke the repository plus supported HTTP operations. Matrix all mapped classes: positive current supported paths; denied/unavailable paths for intentionally held classes; unknown/null/missing IDs; wrong event/kind pairing; foreign recipient; deleted owner resource. For each denied row prove list omission, direct not-found, no isRead/readAt alteration and no deletion by read-all/clear-all. Restore reach and prove retained hidden rows reappear unread per D10. Cover native staff/customers, private participants, internal comments, customer organisation/portal/active state revocation, role downgrade with reach retained, sees_all without read authority, and key subset versus owner capability ceiling on permitted reads. Include >100 candidate rows / 50 visible boundary so hidden rows cannot truncate visible results. Specifically regress current legacy workspace loss and historical identity_connection admin loss; the latter validates the guard even without a current producer. Exercise supported person/instance closed kinds separately.

Use the existing inbox repeatable-read/retry transaction and its executor for identity/facts/predicates/content/effects; preserve bindSameRow protection and do not perform fact queries through the global connection. Predicate subquery builders may use existing Drizzle correlated EXISTS style, but actual execution stays on tx. A repeatable-read snapshot is not itself a concurrency lock or proof against concurrent revocation; retain existing canonical lock ordering and use established identity/resource mutation serialization where the acceptance contract requires it, rather than announcing a new revocation guarantee. Do not change event/outbox fanout/dedupe, operational audit failure transaction separation, or audit/event ordering as a side effect. Denied mutations produce no notification effect or new business audit/event effects. WF-9 atomicity B is intentionally outside this advice.

## Evidence and limits

Read instructions, newest status/decision entries and targeted notification/D10/key/MCP decisions, governing query contract, notification mapping/acceptance sections, canonical private C blocker and author-safe handoff and prior Sol adjudication. Traced inbox, task/approval predicates, native reach and fact loaders, current eligibility/resource contract, fanout allowlist/writer, legacy workspace subscriber, generic creation path, and reset-MFA/admin-grant writers; checked owning automation and key/webhook policy text and canonical identity loader. No source/spec/log edits, tests, database, Docker, browser, build, CI, push or PR action. This is source-level advice, not a reproduction or future review. No credential-bearing incremental record, raw URLs or SQL parameters were read or copied.

---

Retained evidence file — notification-query-scope-bc-remediation-luna.md

# Notification query-scope B+C remediation — author handoff (private, public-safe)

Date: 2026-10-16 (Asia/Yangon)
Worktree: `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`
Branch: `codex/query-ownership-580-b4`

## Source state

This is an author handoff for the uncommitted remediation; it is not an acceptance, review, or merge claim. HEAD remains `3dc8b113780a069ab2454737d92ca0cbd37bf095` (tree `f56834a0c48786c67d16c467f5c444a60062a643`). The working diff SHA-256 is `5120590b196b68972adb38b828911ad987d7ff3ebd2ab063839624b21cd05264`.

Eight intended modified paths:

- `apps/api/src/instance/reset-mfa.ts`
- `apps/api/src/notification/inbox.repository.ts`
- `apps/api/src/workflow/controllers/publish-workflow-version.ts`
- `apps/api/src/workflow/controllers/validate-workflow-version.ts`
- `apps/api/src/workflow/index.ts`
- `apps/api/src/workflow/repository.ts`
- `tests/api-integration/notification-task-reach.test.ts`
- `tests/api-integration/workflow.test.ts`

No commit or source freeze has been made. The accepted #632 main import is still pending; the shared `identity/repository.ts` prospective delta was not imported. No push, PR, CI, full suite, build, browser run, or review note was created by this lane.

## Implemented scope

WF-9 validation resolves the existing request credential inside one `REPEATABLE READ` transaction and uses its executor for validation reads, including the complete adopting-project set. WF-9 publishing resolves identity, reads version/reach, and applies the state change plus response read in one `SERIALIZABLE` transaction, retrying the whole operation on serialization failure with a bounded retry count. The project-reach query validates canonical scoped role/project/workspace alignment and rejects malformed capability JSON instead of treating raw membership rows as reach.

Notification inbox list/direct/read-all/clear-all now use a closed resource policy before fetching content or mutating rows. Unsupported or incomplete mappings fail closed. Workspace-created notices require current workspace reach; MFA reset notices bind to the target person; historical unbound rows remain hidden and unchanged. Current owner predicates are repeated on content/effect queries. Existing native resource policy, key capability clamp, private-person behavior, instance-admin operational notices, and visible-page filtering remain covered by focused tests.

No new table, capability, permission, feature, route, dependency, or unsupported producer mapping was added. Inaccessible projects in WF-9 produce the generic refusal; the all-project reach question was resolved by Thomas to include every workspace project, including empty and archived projects.

## Verification

Passed:

- `pnpm --filter api typecheck` — exit 0.
- `git diff --check` — exit 0.
- Direct Vitest command from the API package against exactly `../../tests/api-integration/workflow.test.ts` and `../../tests/api-integration/notification-task-reach.test.ts` with `vitest.integration.config.ts` — 2 files, 32/32 tests passed, exit 0 (`focused-tests-9.log`).
- The malformed cross-scope role regression alone — 1 passed, 15 skipped by explicit test-name selection, exit 0 (`focused-tests-8.log`).
- The two concurrency regressions alone — 2 passed, 13 skipped by explicit test-name selection, exit 0 (`focused-tests-6.log`).

The concurrency cases use PostgreSQL: validation completes against one snapshot while a direct membership revocation commits between the reach read and the next validation read; publication encounters a real serializable project-insert SSI cycle, retries the complete transaction, then returns generic refusal with no publication effects. This verifies allowed serialization ordering, not an instant revocation barrier.

Preserved adverse/incomplete attempts:

- `focused-tests-1`: an initially incorrect package-script invocation started a broader integration run; interrupted with SIGINT, exit 130. It is recorded as incomplete, not a suite failure or pass.
- `focused-tests-2` and `focused-tests-3`: the new workspace reach regression exposed a real pre-fix failure; the implementation was corrected. `focused-tests-4` passed that case; `focused-tests-5` then passed the 29-test two-file selection before subsequent regressions were added.
- `focused-tests-7`: malformed-role test used an incorrect test database port and failed PostgreSQL password authentication. This is a harness connection error, not a product regression. The corrected connection in `focused-tests-8` passed.

Raw logs, exit codes, the initial incomplete invocation, and the corrected runs are preserved under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/notification-query-scope-bc-runtime/`. `evidence-sha256.txt` indexes key logs, exits, and the source diff. The private raw evidence includes connection setup details and must remain private; this handoff intentionally omits URLs, passwords, and SQL parameters.

## Owned runtime cleanup and heavy-window release

The temporary PostgreSQL 18 test resources have been reconciled and removed. Before cleanup, saved Docker inspect receipts identified both uniquely named containers with label `taskdesk.owner=notification-query-scope-bc`; the running test container mounted only `q580b4-notifbc-data2`, and the stopped failed attempt directly showed the anonymous volume `0790b17de154de80e8a238df29485a6c28b1f1d050a0a10a1a9b7017383ed166` mounted at `/var/lib/postgresql/data`. That anonymous volume also carried Docker's anonymous-volume label. The event query for it was empty; ownership is based on the direct container mount receipt, not inferred from creation time.

Only the two named test containers, their three directly owned volumes (including the directly mounted anonymous volume), and the labeled `q580b4-notifbc-net` network were removed. Exact-name post-cleanup checks found none of those resources. Before/after full inventory snapshots and per-resource receipts are in the private runtime directory. Other pre-existing containers, volumes, networks, and SIT resources were not touched. The local heavy PostgreSQL window is released.

## Remaining gate

Await root's notice of the actual protected acceptance of #632, then perform only the authorized normal main composition and revalidate the resulting source. This author handoff does not claim final-head tests, ordinary review clearance, Sol clearance, CI, or acceptance.

---

Retained evidence file — notification-query-scope-bc-final-composition-luna.md

# Notification query-scope B+C composition handoff (private, public-safe)

Date: 2026-10-16 (Asia/Yangon)
Worktree: `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`
Branch: `codex/query-ownership-580-b4`

## Exact composition

The local author commit is `cf4c408a2e8fb1e3303e30a0a154e8dd779c55ef` (`fix(api): enforce notification and workflow query scope`), parent `3dc8b113780a069ab2454737d92ca0cbd37bf095`. It contains the eight-file B+C remediation and recorded owner decisions already present in the worktree. The normal merge commit is `665453964cf269d863d15db3bfdc7f9121b952d3`, with parents in order:

1. `cf4c408a2e8fb1e3303e30a0a154e8dd779c55ef`
2. accepted protected-main commit `1a34e5792ee9c42b15004b032e3c5410e5def44e` (#796), whose tree is `f31cf2945b9b6afeff31c755c0ed9fbeddb953af`.

The merged tree is `d5c52118140121be0244d457e9c3c9528fc164e1`. It is a clean local freeze for the current review handoff; it has not been pushed. The 68 paths in the branch-versus-accepted-main net comparison are listed at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/notification-query-scope-composed-net-paths.txt` (SHA-256 `554027fe032ab94181a2cb738d7b2bbdc2fd1db3a773237c2491d54dd8090350`); the matching stat is in `notification-query-scope-composed-net-stat.txt` (SHA-256 `a21fc5eb7d6983fb158b9d1a5a37ad1503a7f3a8c11a7800275f935bd5370eb4`).

The merge was a normal `--no-ff` merge of fetched `origin/main` at the exact accepted SHA. Git reported one content-level auto-merge in `apps/api/src/identity/repository.ts`; it did not report a conflict. That file retains both distinct changes: #785’s built-in customer-role exact-definition validation at `validateIdpMappingRole` (~line 898) and #632’s `revokedUserId` return in `transitionPersonLifecycleInTransaction` (~line 2711). The #632 files `apps/api/src/identity/scim-lifecycle.ts`, `apps/api/src/identity/scim-protocol.ts`, `tests/api-integration/legacy-ws-revocation.test.ts`, and `docs/07-planning/security-reviews/legacy-revocation-632.md` compare byte-for-byte to accepted `origin/main` at this merge. All other accepted-main content is conserved by the exact second parent; no manual “ours/theirs” resolution or policy choice was used.

## Post-composition checks

- `pnpm --filter api typecheck` — exit 0 on merge head.
- `pnpm exec biome check` on the eight remediation files — exit 0 on merge head.
- `git status --short` — clean.
- `git diff --check HEAD^1..HEAD` reports trailing whitespace in four lines and an extra blank EOF in the accepted #632 security review report (`docs/07-planning/security-reviews/legacy-revocation-632.md`). These bytes are part of the accepted second parent and were preserved unchanged; no unrelated review record was edited to silence this check.

Focused PostgreSQL results remain those recorded before the local formatting commit and before the #632 merge. Exact selected files were `tests/api-integration/workflow.test.ts` and `tests/api-integration/notification-task-reach.test.ts`: 2 files, 32/32 tests passed, plus the malformed cross-scope role case passed separately and the two concurrency cases passed separately. The original raw attempts and connection setup are preserved privately in `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/notification-query-scope-bc-runtime/`; the earlier credential-bearing incremental report remains private and unchanged. The source at the successful 32-test run was semantically the same remediation as `cf4c408a`; before that commit, Biome formatted the eight files, removed one unused destructured test variable, simplified a null guard to an equivalent optional chain, and replaced a non-null assertion with a null-filtered workspace-ID list. No PostgreSQL rerun was done after those style/type refinements or the independent #632 merge. Do not describe the 32 tests as run on merge SHA `6654539`.

No full suite, build, CI, browser verification, independent review, Sol review, push, PR, release, or publication was done by this author lane. The dedicated PostgreSQL runtime resources were cleaned up and the local heavy-test window was released, as recorded in the preceding handoff. Root may later compose another accepted-main commit; if so, this SHA is not the final publication base and the appropriate current-head confirmation/review cycle remains required.

---

Retained evidence file — notification-665-ordinary-a-luna.md

# #785 corrected composition — ordinary review A

**Reviewed source:** `665453964cf269d863d15db3bfdc7f9121b952d3`  
**Tree:** `d5c52118140121be0244d457e9c3c9528fc164e1`  
**Branch:** `codex/query-ownership-580-b4`  
**Comparison:** accepted main `1a34e5792ee9c42b15004b032e3c5410e5def44e`; candidate source parent `cf4c408a2e8fb1e3303e30a0a154e8dd779c55ef`.  
**Role:** Fresh independent ordinary reviewer A of the corrected broad #785 candidate. I did not author, direct, advise on, or remediate this candidate.  
**Model:** GPT-6 (the runtime did not expose a more specific Luna/Sol alias or serving-version attestation); assigned ordinary reviewer A by the conductor.

## Verdict

**BLOCK — WF-9 SQL reach omits two reach paths granted by the canonical evaluator.** A caller with valid current reach through an ancestor project or a project-owning team is treated as lacking access. When such a project is in the workflow workspace's adopting set, validation and publication return the generic access refusal despite the caller meeting the repository's own project-reach contract. This is a concrete correctness/availability defect in the current candidate. The earlier B/C findings appear structurally addressed in this composition, but this finding prevents ordinary clearance.

## Finding

`apps/api/src/workflow/repository.ts` `projectReach` handles instance-wide reach, organisation reach, workspace `sees_all`, and a direct `membership` row at the candidate project. It does not implement the other current reach cases in `packages/permissions/src/evaluator.ts` `reaches`: membership in an ancestor project and membership in the team owning the project. The evaluator's source comments define both as project reach; `ResolvedIdentity` carries the relevant memberships/team IDs. `hasCompleteWorkflowProjectReach` uses this SQL predicate to decide whether *every* workspace project is accessible, so one project reached only through either supported path causes the generic WF-9 refusal. The same predicate is also used when listing adopting projects.

This is under-authorization rather than disclosure: the current query fails closed. It nevertheless contradicts the canonical reach contract and blocks complete validation/publication for authorized users. Add SQL equivalents for ancestor-project membership and owner-team membership, preserving current workspace/project scope constraints and the malformed-role fail-closed checks; add PostgreSQL regression cases for both paths, including a hidden project reachable only through each path.

## Scope and evidence

I inspected the exact clean worktree and verified HEAD/tree, accepted-main comparison base, 68-path net diff, and merge composition. I read repository instructions, agent workflow, CLAUDE provider notes, active mission, workflow and notification contracts, the public-safe author handoffs for the original and B+C-corrected candidate, prior ordinary A/B/C records, and the actual SQL/repository/controller/test source. I did not read the credential-bearing private correction report.

Source reviewed included `workflow/repository.ts` reach predicates and adopting-project queries; the WF-9 validate/publish controllers and transaction retry; the PostgreSQL concurrency regression in `workflow.test.ts`; `notification/inbox.repository.ts`, `native-inbox-reach.ts`, candidate identity resolution, current resource resolution, API-key capability subset handling, and malformed-role/API-key regression coverage. The candidate's workflow publisher now performs full reach validation and writes in one serializable transaction with bounded full-operation retries. Inbox content reads and mutations resolve current identity and use a closed resource policy within repeatable-read transactions; the current-page/content/effect queries are bound to the candidate row and current ownership. These changes address the earlier reported validation/publish snapshot and notification recipient-only content issues at source level.

The B/C handoff reports 32 focused PostgreSQL tests and separate malformed-role/concurrency cases on the pre-format, pre-merge candidate; I treated those as author-reported prior-head evidence, not tests run on this exact merge head.

Commands run: `git status --short`, `git rev-parse HEAD`, `git show --stat`, `git diff --stat`, `git diff --name-only`, targeted `rg`/`sed` source inspection, and `git rev-parse HEAD^{tree}`. The worktree was clean. No tests, PostgreSQL, Docker, build, browser, CI, typecheck, edits, commit, push, or PR action was performed.

## Not done / residuals

This is one ordinary review only, not security clearance, CI approval, merge approval, or acceptance. No full independent audit of all inherited 68-path behavior was performed. The fresh full GPT-6 Sol security review remains required after the ordinary panel clears.

---

Retained evidence file — notification-665-ordinary-a-reach-adjudication-luna.md

# #785 corrected composition — ordinary A reach-finding adjudication

**Source adjudicated:** `665453964cf269d863d15db3bfdc7f9121b952d3`  
**Tree:** `d5c52118140121be0244d457e9c3c9528fc164e1`  
**Reviewer:** same independent ordinary reviewer A context as `notification-665-ordinary-a-luna.md`. This is a factual correction to that review, not a new reviewer, additional review count, or waiver.  
**Model:** GPT-6; no more specific runtime model/version attestation was exposed.

## Corrected verdict

**CLEAR for ordinary review A.** I withdraw the sole BLOCK finding in my original note. I alleged that current users can reach a workflow project through ancestor-project or owner-team relations omitted by the workflow SQL predicate. The owning RBAC contract and current schema/identity loader show those relations are not currently representable as project reach facts. There is no legitimate persisted current identity/path that can exercise the alleged omission in this candidate.

This correction does not change the exact-head source or any source file. The original review note remains byte-for-byte unchanged (SHA-256 at adjudication: `e1fff5cccfa02b117d502d1067094d14e3a9769def7a4bd49f0c02abf30b7afb`) as a trace of the first verdict; this document is its explicit correction. I identified no other blocking finding in my bounded A review. This is not security clearance, CI approval, merge approval, or acceptance.

## Evidence

- `docs/01-architecture/rbac.md` lines 245–248 explicitly states that project ancestors and owner-team relations are not represented in the current project schema and remain unavailable until their schema and loader exist. The canonical Reach steps 4–5 at lines 529–537 describe those as future relations (`parent_id`, `owner_team_id`), not facts presently available to callers.
- `apps/api/src/database/schema.ts` `projectTable` (lines 411–477) has neither `parentId`/`parent_id` nor `ownerTeamId`/`owner_team_id`. A nearby schema comment at lines 765 onward explicitly records project ownership as outside the current schema slice. The `parentId` fields found elsewhere belong to `workItemTable`; they do not encode project hierarchy.
- `apps/api/src/permissions/strict-policy-enforcement.ts` lines 338–346 constructs current `ProjectReachFacts` with `ancestorProjectIds: []` and `ownerTeamId: null` before calling canonical `reaches()`. So even the current application path supplying these facts to the evaluator cannot grant either relation.
- `apps/api/src/permissions/resolve-identity.ts` lines 793–845 loads team membership rows and passes their team IDs into identity resolution, but has no project-to-owner-team relation to associate one of those memberships with a project. Team membership alone is not owner-team project reach.
- The bounded architecture advice `notification-wf9-consistency-reach-advice-sol.md`, “Actual findings,” independently describes the same source-based disposition and says not to fabricate facts or import unaccepted #790. I verified the underlying schema and loader directly rather than relying only on the advice.

Therefore `projectReach`'s omission of ancestor and owner-team checks is not a defect against the *current* persisted implementation contract. Adding/importing either relationship to clear this review would be out of scope and would invent a new current authority path. My original inference incorrectly treated documented eventual canonical evaluator cases as live persisted cases.

## Commands and limits

Read the cited RBAC, project schema, strict reach construction, identity loader and the cited Sol advice; used targeted `rg` and numbered `sed` inspection; checked the original note hash. No tests, PostgreSQL, Docker, build, browser, CI, edits to source, commit, push, or PR action was performed. Only this mode-0600 adjudication note was written.

---

Retained evidence file — notification-665-ordinary-b-luna.md

# #785 / #580 exact-head ordinary review — B

**Reviewed candidate:** `665453964cf269d863d15db3bfdc7f9121b952d3`  
**Tree:** `d5c52118140121be0244d457e9c3c9528fc164e1`  
**Parents:** `cf4c408a2e8fb1e3303e30a0a154e8dd779c55ef` and accepted-main `1a34e5792ee9c42b15004b032e3c5410e5def44e`  
**Role/provenance:** Fresh independent ordinary reviewer B, assigned GPT-6 Luna tier. I did not author, direct, advise, or remediate this candidate. The runtime does not expose a more specific serving-model attestation.  
**Verdict:** **BLOCK — workspace audit SQL can treat malformed, non-canonical membership rows as project reach.** This is a source-level query-scope defect in the exact candidate. It is not a finding that the external HTTP route currently bypasses its workspace capability middleware.

## Scope and checks

I read the repository operating instructions, active mission, workflow, adapter, and accepted #580 contract. I checked the exact merge parents and tree, the candidate changes in notification inbox authorization, WF-9 validation/publication, notification writer binding, canonical customer membership and OIDC role validation, plus the accepted-main #632 lifecycle result composed into `identity/repository.ts`. I inspected the current audit route middleware, audit repository predicates, schema constraints, identity loader and its scoped-membership validation, the relevant notification contract, and the focused regression-test inventory.

The inbox correction has a closed resource-type allowlist; current identity, event-kind and recipient checks run before content materialization, while current-owner predicates guard content/effects. Workspace-created rows now check current workspace reach, person-bound MFA notices require the current person, and unknown/unbound rows fail closed. Session-only direct/bulk mutation routes remain session-only. The WF-9 validator reloads request identity in a repeatable-read transaction and threads that executor through its reads; publication reloads identity, checks complete project reach, writes, and rereads in one serializable transaction with bounded whole-transaction retry. The workflow project predicate rejects cross-scope/malformed role facts while retaining only facts the current loader recognizes; I did not infer ancestor or owner-team relations absent from current schema/loader.

The customer identity query now returns the membership/role facts needed by the canonical-customer predicate; that predicate requires the exact own-organisation system Customer role and refuses ambiguous organisation memberships. The OIDC customer mapping validation checks the same built-in role definition, and repeat JIT reconciliation takes the role lock before validating it. The #632 `revokedUserId` result is added to the lifecycle transaction result without changing the transaction's grant selection or commit ordering. No widening of instance or customer authority was found in these bounded paths.

No tests, PostgreSQL, Docker, build, browser, CI, push, PR, or source edits were performed in this review context. I did not read the credential-bearing correction-attempt report or raw runtime logs. Prior author/reviewer test counts were treated as reported evidence, not independently reproduced. Existing focused test inventory covers normal project audit reach and ordinary `sees_all`, but no malformed scoped-role audit case was found.

## Blocking finding — audit reach trusts raw memberships

In `apps/api/src/audit/repository.ts`, `listWorkspaceAuditRows` constructs `projectMembership` from `membership.personId`, `scope = 'project'`, and a project/workspace join (lines 188–205). It does not join or validate the assigned role's scope, workspace anchor, key, or safe capability shape. `workspaceSeesAll` (lines 207–218) accepts any raw workspace membership with `seesAll = true`, without checking its role or scope anchoring. `workspaceIdentityReach` (lines 148–174) likewise has an alternative raw `membership` existence check.

The canonical loader in `apps/api/src/permissions/resolve-identity.ts` only admits scoped membership rows after role/scope consistency, a real scope anchor, nonempty role id/key, safe rank, and string-array capabilities are checked (around lines 497–524). The `membership` table has only a foreign key to `role.id` and a uniqueness key on person/scope/scope_id; it has no composite constraint enforcing that the membership scope, scope id, and role scope/workspace agree (`apps/api/src/database/schema.ts:2157` onward). Thus a malformed project membership whose role belongs to another scope/workspace is ignored by the resolved identity but still satisfies this audit SQL's project reach term. A malformed workspace `sees_all` row can similarly activate the all-project term. The result can include project audit rows not supported by the supplied canonical identity. The route's `workspaceAccess`, membership, and `workspace:manage_settings` checks remain in front of the repository, but they do not make these repository predicates consistent with the accepted identity/query-scope contract; this finding does not claim a demonstrated route bypass.

The bounded correction should make these audit reach terms match the current loader's accepted, well-anchored role facts (and preserve the existing instance-admin / per-workspace `sees_all` semantics). Add a PostgreSQL regression that plants cross-scope and foreign-workspace role assignments with direct project and `sees_all` membership rows, then proves the repository does not return the protected project audit row; retain positive valid project and `sees_all` cases.

## Other observations and limits

I found no additional blocking source finding in the inspected notification inbox correction, WF-9 transaction boundaries, customer-membership mapping, OIDC composition, or #632 result composition. The existing query implementation intentionally does not invent unsupported ancestor/owner-team reach; the current RBAC loader has no such facts. Unsupported notification classes remain excluded by the closed inbox policy; I found no new producer activation in this candidate.

This is ordinary review B only. It does not clear the ordinary panel, provide the required fresh full Sol review, or establish current-head runtime, image, browser, CI, merge, release, or SIT acceptance.

---

Retained evidence file — notification-665-ordinary-c-luna.md

# #785 ordinary review C — exact composed head 665453964cf269d863d15db3bfdc7f9121b952d3

**Model:** GPT-6 Luna (assigned ordinary-review tier; this report is from the current independent reviewer context)
**Role:** Fresh independent ordinary reviewer C of 3.
**Independence:** I did not author, direct, advise, or remediate this candidate. I reviewed the clean frozen worktree `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`, exact HEAD `665453964cf269d863d15db3bfdc7f9121b952d3`, tree `d5c52118140121be0244d457e9c3c9528fc164e1`, parents `cf4c408a2e8fb1e3303e30a0a154e8dd779c55ef` and accepted-main `1a34e5792ee9c42b15004b032e3c5410e5def44e`.

## Verdict

**BLOCK.** The remediation closes the recipient-only resource-type fallback and performs current reach decisions before serializing notification content, but its cross-organisation resource-fact queries do not apply the resolved caller's reach in SQL. The subsequent content and mutation statements also lack those caller-reach predicates. This leaves the candidate short of the accepted repository query-scope contract and the expressly assigned structural invariant.

## Blocking finding — current reach is checked after unscoped resource reads, and is absent from content/effect SQL

`listVisibleNotificationRows`, direct mark-read and bulk read/clear all call `readableNativeRows` after `selectCandidatePage`. For native work-item/comment rows, `findCurrentNotificationResources` selects work-item/comment ownership facts, organisation/workspace/project identifiers, requester and visibility facts, and private-participant rows using only candidate resource ids and deletion/live predicates (`apps/api/src/notification/repository.ts:78-147,149-166`). It takes the transaction executor but no `ResolvedIdentity`, and the SQL has no caller-reach predicate. For workspace rows, `inbox.repository.ts:255-263` likewise reads workspace id and organisation id by candidate IDs alone; reach and `workspace:read` are checked only afterward in JavaScript (`:297-324`). Thus a caller-owned historical/malformed notification can cause these repositories to load cross-organisation resource facts before deciding that caller cannot reach them.

The later content query `fetchAllowedRows` selects the full notification row, including title/content/body/eventData, with only `bindSameRow` plus `currentOwnerPredicate` (`inbox.repository.ts:494-524`). Those predicates establish row binding and owner-resource existence/live status; for workspace/person/instance and native work-item/comment they do not apply the resolved caller's reach/capability. Bulk UPDATE/DELETE use the same row/owner predicate (`:542-558`), and direct mark-read uses it again (`:631-642`). Candidate SQL applies caller reach only for legacy task and approval (`:369-374`); native and workspace reach is applied outside the statement predicate. The `repeatable read` snapshot keeps the prior JavaScript decision and later statements on one snapshot, but it does not satisfy the accepted query contract that a repository query returning cross-organisation data take resolved identity and apply caller reach in its statement predicate.

This is a structural contract blocker, not a reproduced HTTP disclosure: the JavaScript evaluator currently makes the canonical reach/capability decisions before content is returned, and this review did not run an HTTP or PostgreSQL reproduction. A bounded metadata/fact preflight is acceptable under the prior Sol architecture advice only when it takes the resolved identity/executor and applies reach there; these fact loaders currently do not. The correction should keep the minimal facts needed for canonical `can`/`reaches` evaluation, but scope those fact queries with caller reach and make content/effect statements bind the authorized identity/resource tuple and current owner predicates. Carry the same rule through list, direct read, read-all and clear-all.

## Confirmed improvements and scoped review

- `registeredNotificationResource` is a positive closed discriminator for task, approval, work_item, comment, workspace, instance and person; unknown/null resource rows are excluded. Per-type checks reject missing IDs and unsupported type/kind combinations instead of reverting to recipient-only access.
- Legacy task/approval reach remains in candidate SQL. Native work-item/comment policy preserves resolved identity, key capability clamp, staff work-item reach, customer organisation authority, customer-eligible event/status handling, participant/private visibility and comment visibility through `canReadNativeInboxCandidate`.
- Workspace-created rows require a current workspace, explicit current workspace reach and `workspace:read`. Instance alerts require current staff `instance:admin` and the closed operational kinds. MFA-reset notices bind `personId` and `resourceId` to the caller's current person; the writer now supplies that binding. The old unbound person notice is hidden.
- Content is fetched only after JavaScript policy filtering; visible-page count is applied after authorization, and keyset pagination advances by the candidate page, so denied candidates do not consume the 50 visible-row limit. Bulk effects preserve same-row binding and current-owner existence. D10's hidden rows remain unread and can reappear after reach restoration; the added integration cases exercise unknown/unbound rows and workspace reach loss/restoration.
- WF-9's complete-project refusal checks the full workspace project set (including empty/archived rows) before validation/publication; the all-project query carries `projectReach`, and publication now repeats identity/reach reads and writes in a serializable retry transaction. WF-19 authoring remains shape-only per the supplied owner decision. I found no additional blocker in this bounded source check of those paths.

## Review scope and checks

Read `AGENTS.md`, the active mission, agent workflow/model policy, notification permissions and resource mapping, D10, query-ownership/tenant-scope contract, native reach/identity loaders, notification inbox/resource repositories, relevant integration tests, WF-9/WF-19 repository/controller changes, and the canonical private prior C/Sol/advice records. Verified clean worktree and exact HEAD/tree/parents. `git diff --check` for the notification inbox/resource, reset-MFA and notification reach-test paths from `3dc8b113780a069ab2454737d92ca0cbd37bf095` through the composed head exited 0. No tests, PostgreSQL, Docker, browser, build, typecheck, CI or other heavy commands were run, per assignment. No source edits, commit, push, PR action, credential-bearing evidence access or external messaging occurred.

The earlier 32 focused PostgreSQL tests described in the author handoff are prior author evidence and were not rerun on this composed SHA; they do not close this review finding. This is ordinary review C only. The ordinary panel remains uncleared; the required fresh full GPT-6 Sol security review must follow ordinary clearance. No approval, merge, SIT, or stage-completion claim is made.

---

Retained evidence file — notification-30091-bc-remediation-luna.md

# Notification query-scope B+C remediation — author handoff

Status: local author change committed and frozen for review; not pushed or published. This is an author handoff, not an independent review, merge approval, or security clearance.

## Exact source

- Branch: `codex/query-ownership-580-b4`
- Commit: `30091facb07e567872e2487cc3f85ac42670e1c8`
- Parent: `665453964cf269d863d15db3bfdc7f9121b952d3`
- Tree: `8a3e656d58a941e7cbee736e85b2b7731aaaa0bd`
- Subject: `fix(api): bind notification and audit queries to current reach`
- Working tree: clean immediately after commit.
- Changed paths: `apps/api/src/database/identity-scope-predicates.ts`, `apps/api/src/audit/repository.ts`, `apps/api/src/workflow/repository.ts`, `apps/api/src/notification/{approval-reach.repository.ts,inbox.repository.ts,repository.ts,task-reach.repository.ts}`, `tests/api-integration/{audit-read.test.ts,notification-task-reach.test.ts,work-item-comment.test.ts}`.

The batch addresses ordinary findings B and C from the 665 review. Finding A's ancestor/team concern was withdrawn by the separate adjudication; both original A records remain preserved. No ancestor/team relation, #790 import, schema, dependency, permission class, or unsupported resource feature was added.

## Structural correction

`identity-scope-predicates.ts` centralizes SQL reach from the current `ResolvedIdentity` and the actual query `Executor`. Its canonical scoped-role predicate checks scope equality, supported project/workspace scope, workspace anchor, nonempty role key, bounded rank, and JSONB capability-array shape. Project reach applies current direct project membership or current workspace `seesAll` membership, including those role-validity anchors; workspace reach uses current scoped membership and the resolved legacy workspace grant. The compiled `owner` role remains the documented exception because it has no `workspace_role` row; other legacy grants still require their current `is_system` role row. Current instance-admin reach is rechecked against current staff user/person state.

Audit and workflow actor-facing repository reads now apply these predicates in SQL. Notification plural resource-fact reads receive the identity and transaction executor and scope project-backed facts before returning them. Inbox list, direct read, read-all and clear-all pass the transaction executor and identity through task/approval/workspace fact predicates; same-row owner/resource checks and current project/workspace reach are repeated in content/mutation SQL. Content and effect queries remain narrowed by recipient/resource tuple and the same current reach predicate; capability policy remains evaluated by the existing canonical notification policy before content access, within the existing transaction flow. No caller-provided broad boolean or precomputed ID list substitutes for the repository reach predicate.

Existing key credential subset/owner clamp, native/customer behavior, instance-private/person binding, D10 hidden-row unread behavior, visible-before-pagination ordering, transaction/executor/lock and audit/outbox ordering remain in the touched paths.

## Verification

Commands were run from `apps/api` for Vitest and from the repository root for Biome/diff checks. Integration commands used the unique isolated PG18 test container documented below; credential-bearing environment values are intentionally omitted here.

- `pnpm exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/workflow.test.ts ../../tests/api-integration/notification-task-reach.test.ts` — **33 passed** on the final committed source (workflow + notification task reach).
- `pnpm exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/audit-read.test.ts` — **14 passed**.
- `pnpm exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/work-item-comment.test.ts -t 'scopes native fact reads, content and inbox mutations'` — **1 passed, 34 explicitly unselected**.
- Earlier focused checks on the same source batch: malformed project/`seesAll` audit roles **1 passed**; foreign misanchored workspace notification role **1 passed**; native fact/inbox scope test before the last owner-helper correction **1 passed**. The native test was rerun after that correction as listed above.
- `pnpm --filter api typecheck` — exit 0.
- `pnpm exec biome check` on the 10 changed source/test files — no formatting or errors; it reports five unused-variable warnings in pre-existing portions of `work-item-comment.test.ts`.
- `git diff --check` — passed.

Adverse attempts are retained, not represented as passing evidence. The first combined workflow+notification run had **6 failed / 27 passed**; all six were the new helper omitting the compiled `owner` exception, which was then restored explicitly and the full two-file selection passed 33/33. A subsequent invocation inherited a stale database URL and failed authentication before tests ran (**33 setup failures**, no test assertions executed); the corrected invocation explicitly targeted the owned test container and passed. The initial audit focused attempt failed because its new fixtures used unregistered audit action names; fixtures were changed to the existing registered action, and the rerun passed. The successful native regression emits existing realtime-delivery failure warnings while its HTTP assertions pass; that warning is preserved in the raw log.

No full suite, CI, build, browser check, or performance capture was run for this batch. Review and current-head hosted checks remain outstanding.

## Private runtime evidence and cleanup

Raw commands/logs, including the credential-bearing runtime setup file, remain private under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/notification-query-scope-bc-round2-runtime/` with directory mode 0700 and files mode 0600. Do not copy raw environment values or connection URLs into public records.

The only PG18 resources removed were the directly owned container `q580b4-bc2-pg` (ID `4564a089c682dd0fea55271f2ca7d991149bc8c4b789eb8bf7d3c67bbcf006b4`), network `q580b4-bc2-net` (ID `57603fd87138a05b6a003b7554aef3fa55f1c97209274ba432278b9cb2deb80a`), and named volume `q580b4-bc2-data`. The retained container inspect receipt directly binds that named volume to this container at `/var/lib/postgresql`; the volume and network carry the unique `taskdesk.owner=notification-query-scope-bc-round2` label. Their exact cleanup commands each exited 0. Port 57831 had no listener after cleanup; before cleanup the listener was OrbStack's forwarding process for this container. Test worker processes had exited before cleanup.

A bounded Docker volume-event query for the relevant attempt window returned no matching retained events. I did not remove or claim ownership of any other/anonymous volume; in particular, any volume without a direct container/mount ownership receipt remains untouched. Before/after Docker inventories and inspect receipts are preserved in the private runtime directory. Cleanup inventory hash manifests: `cleanup-before.sha256` SHA-256 `ca030175ee1f49d73dcddaf26624a3b3e6f2ae31458cabc6fbb2e84ea4e4fca7`; `cleanup-after.sha256` SHA-256 `890953f1ca0d40b777e7599581e00010efbf726e68598472ec9126fa97ed12db`.

Raw key log hashes retained:

- First combined failure: `workflow-notification-full.log`, SHA-256 `8ef605a34d19ae663323cd6b1981e785a2f600ce5598157ab6e8f714eb893853`.
- Stale-URL setup failure: `workflow-notification-full-3.log`, SHA-256 `a06eb444fc45c3f223697dc6af3280657a1b9ebaf74c0b95e7fe4d16f055e8d1`.
- Final combined pass: `workflow-notification-full-4.log`, SHA-256 `28a9c744e651fab2ba05ecd7727ed046824e44d3a35ebc4c1c25682932bc545d`.
- Audit suite pass: `audit-full.log`, SHA-256 `0004ff5a92b487de852ea5ad3e5044b16c27f7cb77c8db2e447b6fbb60125e50`.
- Final native fact/inbox pass: `native-focused-final.log`, SHA-256 `2a961214f054ccd6c44e9e2307eef1547ef34f708d4ac1fbc5faa879f7bb9fec`.
- Typecheck: `typecheck-2.log`, SHA-256 `b29bd52d7c5d63af77d7788c7d19d39746f1d9aab3fe7246f9bf27524159516b`.


---

Retained evidence file — notification-fc71b78-repository-placement-luna.md

# Identity reach helper repository placement — author handoff

This is a bounded path-only author correction to the B+C remediation. No authority semantics changed. It is not an independent review or clearance.

## Exact source

- Branch: `codex/query-ownership-580-b4`
- Commit: `fc71b7847c7d2acab6965c1fd4b4c5d272b7f239`
- Parent: `30091facb07e567872e2487cc3f85ac42670e1c8`
- Tree: `e2e8b8f12bd07b2905df7d26cd167cf0ea8082b4`
- Subject: `refactor(api): place identity reach predicates in repository`
- Worktree clean after commit.

The helper moved from `apps/api/src/database/identity-scope-predicates.ts` to the named repository module `apps/api/src/database/repositories/identity-scope.repository.ts`, consistent with coding-standards.md 132–145 and 166–167: SQL fragment helpers live in repository modules. Imports were updated in audit, workflow, notification inbox, notification resource, and notification task-reach repositories. No tests, schema, dependencies, or other source paths changed.

## Content comparison

Compared the exact helper body from parent commit `30091fac` with the new file after separating the top import block. The function/comment body is byte-identical:

- Old body SHA-256: `22990220065a3e5c47fd757c1ce1ab96aed00f3cccc3e36638dc60bbfca5b353`
- New body SHA-256: `22990220065a3e5c47fd757c1ce1ab96aed00f3cccc3e36638dc60bbfca5b353`

Only import paths changed (`./executor`, `./index`, `./schema` to repository-relative paths); Biome also sorted the moved module's imports. No predicate expression, function signature, comment, query behavior, or capability mapping changed. Git recognized the move as a 98% rename.

## Checks and inherited runtime evidence

- `pnpm --filter api typecheck` — passed.
- `pnpm exec biome check` on the moved repository and five importing repository modules — passed, no fixes needed after import organization.
- `git diff --check` — passed.
- No PostgreSQL or other runtime test was repeated: this commit only relocates an identical helper body and changes import specifiers. Existing focused runtime evidence remains bound to parent `30091fac`: workflow+notification 33/33, audit 14/14, and native fact/content/inbox scope 1 passed with 34 explicitly unselected. Those counts are inherited evidence, not newly run at `fc71b78`.

The prior source and evidence reports remain preserved under their existing filenames; this placement handoff uses a new unique filename. No push, CI, review-note append, or publication was performed. The local heavy runtime window remains released from the prior cleanup.

---

Retained evidence file — notification-b4c27984-roleid-admission-luna.md

# Scoped role ID admission parity — author handoff

This is the final bounded correction to the shared reach predicate, addressing the loader parity omission found before fresh review. It is an author handoff, not an independent review or clearance.

## Exact source

- Branch: codex/query-ownership-580-b4
- Commit: b4c279849053aecd414136d71c63461198ed1951
- Parent: fc71b7847c7d2acab6965c1fd4b4c5d272b7f239
- Tree: acb0d7bf99bad1107003a1e3e68774c7723aa0db
- Subject: fix(api): reject empty scoped role identifiers
- Worktree clean after commit.

## Correction and admission parity

canonicalScopedRoleMembership now receives roleTable.id and requires a nonempty ID in the shared SQL predicate. All callers in project direct reach, workspace seesAll reach, workspace reach, and notification task reach pass the current joined role ID. This matches resolveIdentity's scoped membership loader, which explicitly rejects !row.roleId.

I checked the whole scoped-role admission branch against the helper before completing the change. The SQL helper covers supported project/workspace scope, equality between membership and role scope, nonempty role ID and role key, int32 rank bounds (equivalent for the database integer column to the loader's safe-integer check), capability JSON array containing only strings, and role workspace anchor equality with the actual outer workspace/project workspace. Outer project/workspace rows establish scope existence; organization/customer reach follows the existing organization path and is not admitted by this project/workspace helper. No additional loader rejection or anchor was missing. No new schema or rule was introduced.

The focused PostgreSQL regression extends the existing malformed-role matrix with a representable empty text primary key, a valid role key/rank/capability array, and a project membership referencing it. The repository audit query omits that project from reach. The same test retains a valid direct project role and asserts it remains visible, giving a positive control.

## Verification

- pnpm --filter api typecheck — passed.
- pnpm exec biome check on the changed repository helper, task reach repository, and audit test — passed.
- git diff --check — passed.
- Focused PG18 invocation from apps/api: pnpm exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/audit-read.test.ts -t 'rejects malformed project and sees_all role anchors' — 1 passed, 13 explicitly unselected, exit 0.
- No full suite or other PG test was run. The earlier B+C results (33 workflow/notification, 14 audit, and 1 selected native scope regression) remain evidence from 30091fac, not new runs at this head.

## Runtime cleanup

A unique PG18 container q580-roleid-pg, network q580-roleid-net, and named volume q580-roleid-data used the unique label taskdesk.owner=notification-roleid-regression-fc71. The retained container inspect directly shows the named volume mounted at /var/lib/postgresql; the volume and network carry the same unique owner label. The three exact cleanup commands each exited 0, and port 57832 is clear. No unknown or anonymous volume was touched. Before/after inventories and receipts are private under /Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/notification-roleid-regression-fc71-runtime/; cleanup hash manifests are cleanup-before.sha256 (SHA-256 0238fd7c6350fad1fbb174e089bf776eb7f40d445c17bb3e53631356212d91ce) and cleanup-after.sha256 (SHA-256 ddcb529f7b8350ab699c000b499afcb46524390d502ced79cd57e54e9c8a0dab). The raw integration log SHA-256 is 975f15d14444fcca41618551cdfc15274c77fa197d74e181fbe29156996bf75e.

Credential-bearing setup values remain only in the private runtime directory; this handoff omits them. The local heavy runtime window is released. No push, review-note append, CI, or publication was performed.

---

Retained evidence file — notification-b4c-scope-delta-a-luna.md

# #785 shared scoped-role admission — ordinary delta review A

**Reviewed candidate:** `b4c279849053aecd414136d71c63461198ed1951`  
**Tree:** `acb0d7bf99bad1107003a1e3e68774c7723aa0db`  
**Parent:** `fc71b7847c7d2acab6965c1fd4b4c5d272b7f239`  
**Comparison baseline:** previously reviewed `665453964cf269d863d15db3bfdc7f9121b952d3`; accepted main `1a34e5792ee9c42b15004b032e3c5410e5def44e`.  
**Role and independence:** Fresh independent ordinary delta reviewer A. I did not author, direct, advise on, or remediate this change.  
**Model:** GPT-6; runtime did not expose a more specific Luna/Sol alias or serving-version attestation.

## Verdict

**CLEAR for the bounded role-ID admission delta.** The change restores parity with `resolveIdentity` by rejecting empty persisted role IDs in the shared scoped-role SQL predicate, consistently across audit, workflow, notification inbox/resource, and legacy task-reach query paths. I found no blocking issue in this delta.

## What I checked

I verified exact HEAD/tree/parent and clean worktree, and compared the candidate with both the prior reviewed head and immediate parent. The total candidate delta from the prior reviewed head is 10 paths (893 additions, 216 deletions); this review focused on the final shared role-admission correction and its interactions, relying on the prior ordinary A/B/C notes and explicit A reach adjudication for unchanged coverage. The only immediate-parent changes are 40 additions across the shared predicate, task reach caller, and audit integration regression.

I read the repository workflow and operating guidance, RBAC reach/identity-loader rules, notification pre-wiring query-scope contract, the prior ordinary reviews, the B+C remediation handoff, the helper-placement handoff, the role-ID correction handoff, and the explicit correction withdrawing ordinary A's prior ancestor/owner-team finding. I inspected `resolve-identity.ts` admission checks and every caller of `canonicalScopedRoleMembership`.

The shared SQL predicate now receives the joined role primary key and requires `length(roleId) > 0`. That matches the loader's explicit `!row.roleId` rejection; non-null alone would not match because the text primary key can represent an empty string. All three callers in `identity-scope.repository.ts` pass `roleTable.id`; all four legacy task-reach call sites pass `schema.roleTable.id`. The existing scope equality, supported project/workspace scope, scope-to-workspace anchor, non-empty key, database-integer rank domain, and JSONB string-array checks remain intact. The project reach helper's `NULL` organisation argument in workflow remains harmless for staff (staff branch does not use it); customer access is organization-scoped and separately handled in the shared helper.

The added PostgreSQL audit regression creates an empty-ID project role with otherwise valid key/rank/capabilities, binds it to a project membership, and asserts that project's audit rows are excluded. The same test retains a positive valid project membership assertion. Existing foreign-workspace, cross-scope, malformed capability/key, misanchored `sees_all`, notification, WF-9, key-subset, and customer-boundary behavior was checked by source inspection against the prior notes and unchanged diff; I found no authority widening or new role-grant semantics. The withdrawn A reach concern is explicitly adjudicated against the current schema and loader, so I did not treat future ancestor/team facts as present callers.

## Checks and limits

Commands: `git status --short`, exact HEAD/tree/parent inspection, `git diff --stat`, `git diff --check` from the prior reviewed head, targeted `git diff`, `rg`, and source/document inspection. Worktree was clean; `git diff --check` passed. I did not run tests, PostgreSQL, Docker, build, browser, typecheck, CI, or heavy checks. The reported focused database results and typecheck/Biome results are author evidence on their stated source heads, not runs by this reviewer on `b4c27984`.

This is ordinary delta review A only. It does not provide the second ordinary delta verdict, GPT-6 Sol security clearance, exact-head CI, image/runtime/browser acceptance, merge approval, or stage completion.

---

Retained evidence file — notification-b4c-scope-delta-a-completion-luna.md

# #785 structural B+C correction — ordinary delta review A completion

**Reviewed candidate:** `b4c279849053aecd414136d71c63461198ed1951`  
**Tree:** `acb0d7bf99bad1107003a1e3e68774c7723aa0db`  
**Comparison base:** previously reviewed `665453964cf269d863d15db3bfdc7f9121b952d3`  
**Accepted main:** `1a34e5792ee9c42b15004b032e3c5410e5def44e`  
**Role and independence:** Fresh independent ordinary reviewer A for the full structural B+C delta. I did not author, direct, advise on, or remediate the candidate.  
**Model:** GPT-6; the runtime did not expose a more specific Luna/Sol alias or serving-version attestation.

## Verdict

**BLOCK — `currentWorkspaceReachPredicate` does not preserve the canonical unambiguous legacy-membership rule.** A stale resolved identity can continue to authorize workspace reach through one matching `workspace_member` row even when a second row has since made that user's membership ambiguous. The full B+C candidate therefore does not yet establish current canonical workspace reach for all shared-helper consumers.

## Blocking finding — legacy workspace reach accepts duplicate membership rows

`resolveIdentity` only emits legacy workspace authority when `resolveMembershipRoleFrom` determines that the user's workspace membership is unambiguous; its mapper documents that `rows` must contain exactly one row. The `workspace_member` schema has ordinary indexes but no uniqueness constraint on `(workspace_id, user_id)`, so duplicate rows are representable.

In `apps/api/src/database/repositories/identity-scope.repository.ts`, `currentWorkspaceReachPredicate` builds `legacyRoleChecks` from the passed identity's workspace authority and accepts `EXISTS` of a `workspace_member` row matching user, workspace and role. For non-owner roles it additionally requires a same-workspace `workspace_role` row with `is_system = true`; owner remains the documented compiled-role exception. The predicate does not reject a second `workspace_member` row for that user/workspace. If the identity was resolved while the single membership was valid, then a duplicate is inserted or changes before the reach statement, this SQL still returns true via the matching row. That differs from the loader's current fail-closed ambiguity rule and from the task notification's `legacyWorkspaceRoleCanRead`, which explicitly has a `NOT EXISTS` duplicate-row guard. This is a source-level stale-identity/current-query consistency finding; I did not run an HTTP or database reproduction.

The affected shared workspace predicate is used for audit workspace reads, workflow workspace reads and WF-9 checks, inbox workspace notice facts/content/effects, and notification resource composition that relies on those workspace checks. Add the same per-user/per-workspace duplicate exclusion to the shared legacy branch, preserving the explicit owner exception and genuine `is_system` requirement for other built-ins; add a regression proving a formerly valid resolved identity no longer passes after a second membership row is present. Do not remove the separate project-scoped membership path, whose own canonical table and loader rules differ.

## Full structural scope inspected

I reviewed the complete ten-path candidate delta from the prior exact head (893 additions, 216 deletions), with unchanged behavior relying only on the earlier A/B/C records and the explicit adjudication withdrawing A's alleged ancestor/owner-team finding. The newly added B+C structure was inspected directly rather than treated as cleared by those prior findings.

- **Shared role admission and reach:** `identity-scope.repository.ts` now validates scoped role scope equality, project/workspace scope, role ID/key non-emptiness, workspace anchor and string-array JSON capabilities, and checks current active staff/admin state. The empty role-ID delta matches the loader's explicit rejection, and all call sites pass the joined role ID. Direct project and workspace `sees_all` membership use the actual project/workspace anchors. Customer project reach is limited to the identity's organization. The compiled legacy `owner` exception and same-workspace genuine `is_system` checks for other built-in legacy roles are preserved, subject to the duplicate-row finding above. No new grant source or authority widening was found in these paths.
- **Audit:** `listInstanceAuditRows` rechecks current instance-admin state in SQL; workspace audit rows require current workspace reach and project rows require current project reach through correlated project facts. The malformed direct project and `sees_all` roles are screened by shared canonical admission. The unrelated-project predicate cannot treat a foreign workspace project as reachable in the requested workspace.
- **Workflow:** workspace-scoped workflow queries consistently thread the selected executor to workspace reach; project reach applies the current shared project predicate. Adopting-project reads and the complete-project check use scoped predicates. The complete check retains the workspace project set, including empty/archived projects, and publication's transaction/retry changes remain in place. The earlier ancestor/team concern is withdrawn by the explicit adjudication and the current project schema/loader, so I do not count it as a finding.
- **Notification task and approval:** query executors now flow through task and approval reach subqueries. Task project/workspace role admission uses the shared canonical helper; the legacy workspace task branch has its own duplicate membership exclusion. The key capability clamp remains a separate gate and is preserved.
- **Native notification fact reads:** work-item/comment fact queries take resolved identity and transaction executor and apply current project reach in SQL before returning ownership, requester, visibility and participant-fact IDs. Participant reads are limited to work items already returned by those scoped fact queries.
- **Inbox content and effects:** workspace facts are reach-filtered before JavaScript policy evaluation. The subsequent content query and direct/bulk read/delete statements rebind the same candidate row and repeat current-owner/reach predicates for task, approval, workspace, work-item, comment, person and instance resources. Native work-item/comment content/effect SQL rechecks current project reach and liveness; task effects carry the credential capability clamp; instance effects recheck current administrator state; person notices bind to the current user's person. The canonical per-kind capability/private-visibility policy still runs before materialization inside the repeatable-read transaction. I found no B/C regression in candidate-row binding, visible-before-pagination, unknown-resource closure, D10 retention, or transaction/executor use.

I also read the repository workflow and operating guide, the query-scope/notification contract, relevant RBAC and notification feature sections, the prior ordinary A/B/C notes, the A reach adjudication, and the B+C/helper-placement/role-ID author handoffs. Author-reported tests were not treated as my exact-head runtime evidence.

## Checks and limits

Commands: exact `git` HEAD/tree/parent and status inspection; `git diff --stat`, targeted diff and `git diff --check` from the prior reviewed head; `rg`, `sed`, and direct source/schema/contract inspection. The worktree was clean and `git diff --check` passed. No tests, PostgreSQL, Docker, build, browser, typecheck, CI, source edit, commit, push, or PR action was performed. The report is mode 0600.

This is the full ordinary delta A review and one blocking finding. It does not clear ordinary review B, provide GPT-6 Sol security clearance, establish exact-head CI or runtime/browser acceptance, or authorize merge or completion.

---

Retained evidence file — notification-b4c-scope-delta-b-luna.md

# #785 / #580 exact-head ordinary review — DELTA B

**Reviewed candidate:** `b4c279849053aecd414136d71c63461198ed1951`  
**Tree:** `acb0d7bf99bad1107003a1e3e68774c7723aa0db`  
**Comparison:** prior B-reviewed head `665453964cf269d863d15db3bfdc7f9121b952d3`; accepted-main base `1a34e5792ee9c42b15004b032e3c5410e5def44e`  
**Role/provenance:** Fresh independent ordinary reviewer B, GPT-6 Luna tier. I did not author, direct, advise, or remediate this candidate. The serving model/version is not exposed beyond the assigned tier.  
**Verdict:** **CLEAR for ordinary review B at this exact head.** No blocking or non-blocking source finding remains in the checked scope.

## Independence and scope

I reviewed the exact clean checkout at `/Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2`. I read `AGENTS.md`, the agent workflow, operating guide, status and decision log, the owning notification/workflow/audit specs, and the prior B and C reports plus the author handoffs for the 30091 structural batch and the b4c role-ID correction. I did not read credential-bearing setup or raw runtime logs.

I re-reviewed the ten-file B+C implementation and integration seams: canonical scoped-role SQL admission, audit/workflow reach, notification list/direct-read/read-all/clear-all, resource facts/content/effects, customer/native visibility, notification type/resource allowlists, identity and transaction threading, and the malformed-role and inbox regression coverage. The earlier B finding on malformed raw audit memberships is addressed by the shared role-validity predicate and regression. The earlier C finding on unscoped facts/content/effects is addressed by passing the resolved identity and active executor through the resource and inbox paths, with reach included in the SQL resource/content/mutation predicates before protected facts are returned or actions are applied. I verified the final b4c delta adds the nonempty `role.id` condition and threads the joined role ID through all predicate call sites, matching the loader's explicit `!row.roleId` rejection. Existing role-scope, role-key, rank, JSON capability shape, workspace-anchor, and documented legacy owner exception checks remain present.

Current notification recipient visibility checks continue to enforce customer public-comment rules and private-work-item requester/participant visibility after current resource reach. D10's hidden-row unread behavior and visible-before-50-row pagination remain intact. WF-9 reads use the transaction executor where supplied and require complete project reach; I found no new ancestor, owner-team, or other unsupported relationship invented by this change. The SQL reach helper derives authority from the current database facts plus the resolved identity; I found no caller-supplied allow boolean or precomputed-ID list that substitutes for this predicate in the repaired native paths.

## Checks and findings

Read-only checks performed:

- `git status --short --branch`, `git rev-parse HEAD`, `git rev-parse HEAD^{tree}`, `git diff --stat` and `git diff --name-status` confirmed exact head/tree, clean working tree, and the expected ten changed paths.
- Inspected the candidate diff from `665453964cf269d863d15db3bfdc7f9121b952d3` and the relevant final source/spec/test paths.
- `git diff --check 665453964cf269d863d15db3bfdc7f9121b952d3..HEAD` exited 0.

No tests, PostgreSQL, Docker, build, browser, CI, push, PR action, or source edits were performed, per assignment. Author-reported PostgreSQL and typecheck results were not independently reproduced; they remain evidence from their reported source heads only. No full suite, image, browser, current-hosted-check, security-review, or acceptance result is inferred.

I found no remaining blocker in this ordinary B scope. This is not the required full fresh Sol security review, does not clear the other ordinary delta reviewer, and does not establish merge or stage acceptance.

---

Retained evidence file — notification-472ca631-legacy-membership-ambiguity-luna.md

# Legacy workspace membership ambiguity guard — author handoff

This is a bounded author remediation for the remaining A finding from the current B+C review. It is not an independent review or clearance. Preserve the prior A BLOCK and B CLEAR assessment; fresh exact-head review is still required.

## Exact source

- Branch: codex/query-ownership-580-b4
- Commit: 472ca631db2faf0b34945da221675720e3e2e503
- Parent: b4c279849053aecd414136d71c63461198ed1951
- Tree: 91c043df4b57898d46f69123fb72637c8411ffb9
- Subject: fix(api): fail closed on duplicate legacy memberships
- Worktree clean after commit.

## Structural correction and loader cardinality audit

The legacy branch of currentWorkspaceReachPredicate now requires that the matching workspace_member row be the sole row for the resolved user and workspace. It uses a correlated anti-duplicate check against the current workspace_member row while preserving the existing current workspace ID, user ID, resolved role key, compiled owner exception, and genuine is_system role-row requirement for other built-in roles. The project-scoped membership path is unchanged.

I compared this branch with resolveIdentity: workspace memberships are loaded as raw memberRows and grouped by workspace; resolveMembershipRoleFrom accepts only exactly one row. The current workspace_member schema has workspace/user indexes and a single-value role check, but no unique workspace/user constraint. Historical migration 0007 drops the earlier workspace_member_workspace_id_user_id_unique constraint, so duplicate rows are representable and the runtime predicate must reject them.

Other relevant join multiplicity was checked: person.userId has its own partial unique index (0053); workspace_role has a unique (workspace_id, role) constraint (0051); scoped role joins use role.id primary key and scope joins use their scope-table primary keys. Those joins cannot multiply one stored role/membership fact. The resolver's membership query intentionally returns all legacy workspace_member rows, which is the cardinality this fix now mirrors. No schema, dependency, relationship, feature, or new authority rule was added.

## Regression and checks

The focused integration regression resolves a valid identity, confirms one workflow is visible, inserts a second workspace_member row, then confirms repository listing refuses it. The parameterized cases cover both a duplicate with the same role and an additional different role; each retains the pre-insertion valid positive control.

- Focused PG18 command from apps/api: pnpm exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/workflow.test.ts -t 'refuses legacy workspace reach after a duplicate' — 2 passed, 16 explicitly unselected, exit 0.
- pnpm --filter api typecheck — passed.
- Scoped Biome on the changed repository helper and workflow test — passed.
- git diff --check — passed.
- No full suite was run. No claim is made that previous 33/14/1 tests were rerun at this source head.

## Private runtime evidence and cleanup

The one focused PG18 run used container q580-dup-pg (ID b93d82bbc3d9e13524b33864faf5c41bcc73ad931232ee7bdc5a8ca10984ef46), network q580-dup-net (ID a1add56ae43dda5b9ec702abc15378ffe069be27b7eeef61040e25792c5fa7ab), and named volume q580-dup-data. Each carries the unique taskdesk.owner=notification-legacy-duplicate-b4 label. The retained container inspect directly binds the named volume at /var/lib/postgresql. The exact container, network, and volume removal commands each exited 0; port 57833 is clear. No unknown or anonymous resource was touched.

Private inventories, receipts, raw output, and credential-bearing setup file remain under /Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/notification-legacy-duplicate-b4-runtime/. Cleanup manifest hashes: cleanup-before.sha256 ebde42a21c640755b562606be7a2f6923423fb9504ea07a02d3d791e3fe67bae; cleanup-after.sha256 40a89ac21128da2358eea55be3469146dee7298d5f424008e16e0c76108afc92. Raw focused log SHA-256: dc576e088f2798def131fb2d2e4a308d788ef023db2dd8573faa2f40757c3679. The local heavy runtime window is released.

No push, CI, own-note append, or publication was performed.

---

Retained evidence file — notification472-full-security-61-sol.md

# #785 / #580 — full independent security review

**Reviewed head:** 472ca631db2faf0b34945da221675720e3e2e503  
**Tree:** 91c043df4b57898d46f69123fb72637c8411ffb9  
**Comparison base:** accepted main 1a34e5792ee9c42b15004b032e3c5410e5def44e (verified ancestor).  
**Context:** /root/notification472_full_security_sol, fresh independent full security reviewer. I did not author, direct, advise on, or remediate the candidate or perform its ordinary reviews.  
**Model/provenance:** dispatched by the conductor for GPT-6.1 Sol full security review. The runtime does not provide this context with a separately verifiable serving-version attestation; the dispatch identity is recorded without inventing one.  
**Checkout:** /Users/heinthura/.codex/worktrees/q580-b4/Ticketing.v2, clean at the exact reviewed head.

## Verdict and ordinary-tier disposition

**CLEAR for the full combined source-security scope, with the non-blocking held-producer residual below. No blocking security finding remains in the inspected candidate.** This is source clearance, not merge readiness or runtime acceptance.

I first independently checked the complete 472ca631 delta against b4c279849053aecd414136d71c63461198ed1951: 21 added helper lines and 44 added integration-test lines. The correlated anti-duplicate predicate excludes every other workspace_member row for the same user/workspace while retaining the matching current row, current role key, compiled owner exception, and genuine is_system requirement for other legacy built-ins. This now matches resolveMembershipRoleFrom's exactly-one-row admission. Scoped project membership and valid scoped workspace membership remain separate authority sources; ambiguity in the legacy table does not incorrectly revoke an independently valid scoped grant.

The regression is parameterized over identical-role and different-role duplicates. Both resolve the identity while one valid membership exists, prove the workflow is visible, insert the second row, then require the repository to return no workflow using that previously resolved identity. These are non-vacuous positive/negative controls. I did not execute their PostgreSQL assertions.

**A's sole remaining duplicate-membership blocker is CLOSED by independent source inspection.** I read full structural ordinary A's BLOCK, ordinary B's CLEAR, the earlier 665 A/B/C records, A's explicit ancestor/team withdrawal, and the 30091/fc71/b4c/472 author handoffs. The shared structural helper already exists, and this correction is a narrower instance of the same canonical-admission class. Under agent-workflow.md's change-altitude rule, this clean required full security pass closes the remaining ordinary source tier; it does not manufacture another ordinary reviewer or treat the earlier narrow role-ID-only review as a complete panel. The conductor still owns provenance/accounting and the remaining gates.

## Full security assessment

I inspected the combined 69-path comparison (including the long append-only own review note and integration tests), with direct source review across auth/customer identity and OIDC, canonical reach, audit, workflows, inbox, fanout, scheduler, preferences and delivery. I read AGENTS, the mission, workflow/review policy, CLAUDE, accepted SQL ownership/tenant-scoping rules, RBAC, notification/WF-9/WF-19 contracts, and material adverse review records. Historical broad CLEAR was not used to override the later query-scope adjudication.

**Canonical authority and SQL reach.** The shared repository helper validates supported scope and scope equality, nonempty role ID/key, workspace anchor, integer rank and string-array capability shape before admitting scoped membership. Actual project/workspace rows anchor scope existence. Current staff instance-admin SQL binds user and person, active staff state and the banned flag. Direct project and workspace sees_all paths do not invent ancestor/owner-team relations absent from the current schema/loader; RBAC explicitly excludes those until implemented. Workspace legacy reach now rejects ambiguity as above. Audit actor-facing queries and workflow reads receive resolved identity and compose these current SQL predicates rather than treating requested IDs or JavaScript allow flags as authority.

**Authentication, customer admission, keys and lifecycle composition.** Customer identity requires exactly one own-organisation membership backed by the genuine system Customer role and exact compiled rank/capabilities; capabilities are still compiled, not trusted from persisted rows. Workspace/instance memberships cannot promote the customer. Portal admission and canonical resolution use the shared admission check. OIDC customer-role validation additionally requires noneditable built-in provenance; repeat JIT reconciliation locks the default role and denies invalid customer JIT admission. No IdP path grants instance administrator or sees_all. The accepted API-key owner/current-role clamp remains in place: native reads use the resolved credential/subset; legacy task reads retain the separate key task-read clamp. Inbox mutation routes remain session-only. The accepted lifecycle result retains revokedUserId, and its invalidation/outer-commit contract is preserved; this candidate does not replace accepted identity changes with an older branch copy.

**All four inbox operations.** Candidate selection is bound to the authenticated recipient and a positive closed resource discriminator. Native item/comment fact queries take identity and the actual transaction executor and apply current project reach before returning protected resource facts. Workspace fact reads apply current workspace reach. Participant facts are restricted to the already-scoped returned private items. Canonical policy then enforces person binding, current work-item authority, customer serving-project organisation, NO-19 event audience, public comments and private requester/participant visibility. Content and direct/bulk effects repeat same-row recipient/resource binding and current owner/reach in SQL using that executor; unsupported rows fail closed. Instance notices remain a closed singleton operational family behind current administrator authority, and private MFA notices bind the current person/user. Denied rows do not consume the 50-visible-result cap; keyset pagination advances over candidate pages. Read-all/clear traverse pages and leave hidden rows stored/unread under D10. Repeatable-read operations resolve identity and policy in one snapshot, with bounded whole-operation serialization retries; no stronger concurrent-revocation ordering is claimed.

**Workflows and transaction seams.** WF-9 examines every workspace project, including empty and archived projects. The scalar complete-reach refusal reveals no hidden IDs/counts. Validation uses one repeatable-read identity/read snapshot, and publication reloads identity, checks complete reach, writes and rereads in a serializable transaction with bounded full retries. WF-19 remains shape-only authoring for literal assignee IDs; execution eligibility is not broadened. Held set_field remains rejected. Route capability admission remains separate from SQL reach.

**Audit, scheduler, fanout and preferences.** Audit append preserves the same executor, advisory chain lock, head read, single database clock sample, canonical hash and insert order; verification preserves seq order and UTC microsecond text. Instance audit SQL rechecks current administrator facts while its route retains the narrower read_audit key capability gate. Workspace audit is unconditionally workspace-bound and correlates each project row to that workspace and current canonical reach. Scheduler lease ownership/expiry, reminder dedupe and legal-hold cleanup predicates retain their extraction behavior and accepted UTC clock convention. Fanout retains the producer transaction through person locking, inbox/outbox/delivery inserts, self exclusion and idempotency. Preference/delivery relocation preserves recipient-keyed rules, selected-project ownership validation, encrypted secrets and destination checks. Existing shared-helper and pre-wiring residuals are not converted into claims of universal query compliance, provider safety, or notification completion. No held outbound producer/worker was activated.

## Non-blocking held-producer finding

**N1 — key-addressed native work-item rows are accepted by fact resolution but not by final owner SQL.** notifications.md's resource mapping permits a work-item id/key. repository.ts:103–105 loads either and maps both to the same canonical facts, but inbox.repository.ts:515 requires work_item.id = notification.resource_id in currentOwnerPredicate. A valid key-addressed work-item row therefore passes fact/policy preflight and is then omitted from content, direct read and bulk effects. This is a fail-closed availability gap, not a demonstrated disclosure.

I found no active native work_item notification producer in the current resolver/producer paths: the existing native mention producer emits comment IDs, approvals emit approval IDs, and workspace fanout remains held. This gap predates the final structural/472 delta and concerns the held work_item producer contract, so it does not block this query-ownership/security integration. It must remain an explicit pre-wiring residual; this review does not authorize wiring that producer or claim its key form works. No database reproduction was run for N1.

## Commands, evidence and limits

Actual commands: pwd/cat/sed/rg/nl source and contract reads; git status, rev-parse HEAD and HEAD^{tree}, merge-base --is-ancestor, combined and delta diff/stat/numstat and source/test diff --check; gh pr list --state open and gh pr view 785; the focused unit command below. One initial evidence-filename read used the wrong adjudication suffix and returned missing-file; I corrected it and read the authentic -luna.md record. One broad evidence filename search traversed package-cache filenames and was replaced by exact record reads. Neither failure was treated as evidence of source behavior.

- pnpm exec vitest run --config vitest.config.ts ../../tests/api/notification/native-inbox-reach.test.ts ../../tests/api/permissions/resolve-identity.test.ts, from apps/api: **2 files / 65 tests passed**, exit 0. These are cheap pure unit checks, not SQL or full-suite proof.
- git diff --check for the final two-file delta and the combined apps/api/tests paths: passed.
- Exact-head/tree and clean worktree verified. Live #785 still points to e533a9875e47399247b740b53f6fd192fa43ec9d, so its hosted state is not evidence for this local candidate. #798 remained open; it was not imported or treated as accepted authority.
- Author evidence remains source-bound: 33 workflow/task-reach, 14 audit and 1 native PostgreSQL case at 30091; one empty-role case at b4c; two duplicate cases at 472. I did not rerun those counts or claim a full current PostgreSQL pass. Author typecheck/Biome receipts are not my reruns.

No PostgreSQL, Docker, build, browser, full suite, hosted CI execution, provider I/O, source edits, commit, push, publication or PR mutation was performed. Credential-bearing correction/setup/raw runtime evidence was not opened or copied. This private report is mode 0600. Required exact-head CI, image build/boot/health and applicable runtime/browser gates remain with the conductor. No merge, SIT, whole-580, stage-completion or waiver claim is made.

---

Retained evidence file — workflow-query-scope-owner-decisions-20261016.json

{
  "recordedAt": "2026-10-16T07:02:28.412672+00:00",
  "source": "Thomas direct user-message reply in this conductor session",
  "requestCall": "call_582546f57dbd436ab10d43e1ca364923",
  "exactReceiptSecondAttested": false,
  "decisions": [
    {
      "questionItem": 0,
      "rule": "WF-9",
      "answer": "Require access to every adopting project (Recommended): otherwise return a generic refusal without project or item details."
    },
    {
      "questionItem": 1,
      "rule": "WF-19",
      "answer": "Check shape only when authoring (Recommended); enforce person eligibility at execution, allowing unknown IDs to be saved."
    }
  ],
  "scope": "Owning workflow spec and bounded acceptance correction; not a gate waiver or new roadmap authorization"
}

---

Retained evidence file — workflow-wf9-adoption-owner-decision-20261016.json

{
  "recordedAt": "2026-10-16T08:04:55.495441+00:00",
  "exactReceiptSecondAttested": false,
  "source": "Thomas direct conductor chat response to request_user_input_async call_be4fae73c6c54175992e413270fc6f0c item0",
  "question": "One definition is still missing for your WF-9 decision: types belong to the workspace, with no project–type adoption table. Should “every adopting project” include empty projects, or only projects that already contain a work item of a workflow-bound type? The current code uses the latter.",
  "answer": "Every project in the workspace, including empty and archived projects (Recommended).",
  "relatedEarlierDecisions": "workflow-query-scope-owner-decisions-20261016.json",
  "scope": "WF-9 validate and publish adopting-project set; earlier all-project-access generic-refusal rule remains; WF-19 authoring shape-only/execution active-roster decision remains",
  "isGateWaiver": false,
  "implementationReviewCIAndSITStillRequired": true
}

---

Retained evidence file — notification-bc-report-filename-erratum.md

# Notification B+C handoff filename preservation correction

The author reused `notification-query-scope-bc-remediation-luna.md` for the later 30091 source handoff. The conductor caught the mismatch against the already recorded first report hash. The later report was preserved byte-for-byte separately as `notification-30091-bc-remediation-luna.md` (SHA-256 `9b2559092d839a04990066b735479858523cb365424133e72af67a7508552d45`).

The first report was mechanically recovered from the conductor's prior file-read tool output, with two identical matches, and verified against its original recorded SHA-256 `7149b0c633cbd4e2416be372023020b0918c483f689e98bf7bed09130b5c45db` before restoring its original filename. A separate recovered copy and private recovery receipt remain. No report was reconstructed from memory or rewritten; no raw transcript or credential-bearing runtime setup is published.

Both authentic reports are retained with their actual source scopes. This correction changes no source, test result, review verdict or gate.

---

Retained evidence file — notification-bc-report-preservation-recovery.json

{
  "time": "2026-10-16T09:23:49.375024+00:00",
  "originalReport": "notification-query-scope-bc-remediation-luna.md",
  "originalSha256": "7149b0c633cbd4e2416be372023020b0918c483f689e98bf7bed09130b5c45db",
  "newReport": "notification-30091-bc-remediation-luna.md",
  "newSha256": "9b2559092d839a04990066b735479858523cb365424133e72af67a7508552d45",
  "recoveryCopy": "notification-first-bc-remediation-recovered-7149b0c6.md",
  "recoveryMethod": "mechanically extracted exact original file content from prior conductor tool output in private session JSONL; two identical matches; recorded original SHA-256 verified before restoration",
  "rawTranscriptPublished": false,
  "sourceChanged": false
}
