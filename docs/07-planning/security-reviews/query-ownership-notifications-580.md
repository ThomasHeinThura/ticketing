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


