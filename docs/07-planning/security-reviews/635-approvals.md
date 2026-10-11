# PR635 approval review records

Candidate: `c9a32be7ed02f7fd3d6ec0c2d2bc49a7d0ccc4b9`; accepted base `a96e6a4c23d1da35be6a66dc5a043328d884f751`. This record transports authentic reports verbatim; the transporter does not supply any verdict. Historical Sonnet A/B and Opus closures cover source through72207e01. Their original transcripts were checked by fresh ordinary delta reviewer, as recorded below. Later UTC/audit correction is covered by independent GPT-6 Luna `/root/review_635_delta` and GPT-6 Sol `/root/review_635_security`, both spawned explicitly with fork_turns=none, reasoning high. No identity is relabelled.

## Historical ordinary A (verbatim)

Original report SHA-256: `92cde472a9e4aa04379d74cf26d863f402f47a8269334285ee7ebe7829f3142b`

# S3 approvals: independent ordinary review A (spec conformance, fidelity, scope)

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: fresh independent reviewer-A context. No context id is exposed to the agent. The only identifier it holds is the parent scratchpad session 3a9e9ce4-8409-47d4-b1be-1f1544697e70. I did not author, direct or remediate the change.
**Reviewed head:** 2c6ade1051a886f3ef5d0a56efb6a90d248138b0
Base: main 7cf4bc1fe756d1c9008da7c383e4d9afcd147d4e. Commits 1-5 reviewed. Top commit 0ca539e7 (notification delta) ignored, except to confirm that it is the only commit touching `apps/api/src/notification/*`.

Method: static and read-only. No Docker, no test runs, nothing edited. The worktree `/private/tmp/claude-501/s3` is checked out at 0ca539e7, not 2c6ade10. To avoid reading notification-delta code I extracted `git archive 2c6ade10` into a scratch dir and read only that tree. Every diff uses explicit commit ids. I ran no test, so test claims below are "present and plausible by reading", not "executed".

## Verdict

**CLEAR WITH NON-BLOCKING findings.** No blocking findings on spec conformance, fidelity or scope.

- The code at 2c6ade10 conforms to `approvals.md` for everything in S3's frozen scope.
- The two author-flagged "spec conflicts" are resolved correctly by source precedence (section 2).
- The port matches #589 (2350397b) and #603 (9ed99f24) except for documented additions.
- No S4, S6, S7, request-type or other-feature code leaked in.
- The decision log is insert-only, and the three relayed entries are verbatim.

Residuals the Sol reviewer should know about:
- AP-11 and AP-21 notification delivery is absent at this head (held to S4).
- `transition_id`, `requested_by` and `approver_id` have no database backstop.

## 1. Spec conformance (approvals.md)

Legend: IMPL = implemented (file:line at 2c6ade10); TEST = named test; HELD = deliberately out of frozen scope.

| Rule | Status | Evidence |
| --- | --- | --- |
| Flag `feature.approvals`: resolves project, workspace, instance, default; default false; disabled blocks only NEW requests; existing approvals stay listable, readable, decidable, withdrawable and reminded; never bypasses gates | IMPL | `packages/permissions/src/features.ts` (resolver, default false); `approval/repository.ts:265-307` (flag lookup per approval workspace and project); `approval/service.ts:65-74` (the ONLY flag consumer, in create). Decide, withdraw, list and reminder-scan call no flag. The gate reads persisted rows (`transition-work-item.ts` diff). TEST: `approval-feature-flag.test.ts` ("applies project, workspace, instance, lock, then built-in default precedence"); lifecycle test lines 398-428 (flag off: transition still 422 `approval`, approval still visible); `approval-tenant-checks` check 9 |
| AP-1 customer approval requested by staff with `approval:request` within reach | IMPL | `approval/index.ts:358-377` (staff only, reach, capability); `service.ts:85-92` (approver side must be customer). TEST: domain "AP-1" tests; lifecycle wrong-scope request 403 |
| AP-2 CAB only by staff and only on `is_change` type | IMPL | `index.ts:363-388` (`approval:request_cab`); `service.ts:116-124` passes `isChangeType` from `loadApprovalRequestFacts` (`repository.ts:575-620`) to `validateApprovalRequest`. TEST: domain "AP-2" x3 incl. customer-cannot-request-cab. No HTTP-level customer-session CAB test (NB-2) |
| AP-3 approver must have reach; outside reach refused | IMPL | `service.ts:101-111` (422). Picker and "not offered" are a separate pending contract, not approved (decision log 2026-10-06); HELD |
| AP-4 default 7 days from `instance_setting.approval_default_expiry_days`; per-request override; cap 90 | IMPL | `repository.ts:613-619`; `service.ts:113-129`. TEST: domain AP-4 cap and cap+1ms |
| AP-5 multiple pending; gate by policy any/all; only matching `transition_id` counts | IMPL | `transition-work-item.ts` (`isGateSatisfied` with `transitionId`, `policy`); `list-work-item-transitions.ts`. TEST: domain "AP-5 named test" |
| AP-6 requester may withdraw; becomes `withdrawn`, emits `approval.withdrawn` | IMPL | `service.ts:351-443`. TEST: lifecycle (non-requester 403, retries 409, concurrent `[200,409]`) |
| AP-7 only the named approver decides; admin may withdraw (session-only, audited, no step-up, API keys rejected, explicit elevation exemption) | IMPL | `service.ts:251-269` and domain `evaluateApprovalDecision`; `policy.ts` admin route (`sessionOnly`, `elevated:false` + reason); `index.ts:249-267,471-485` (`requireSessionOnly`, `isCurrentInstanceAdmin`) and `service.ts:375-378` (recheck under lock). TEST: lifecycle admin-key 404 and 403, admin on requester route 404, retries |
| AP-8 self-approval refused in the domain | IMPL/TEST | `service.ts:251`; domain AP-8 tests |
| AP-9 reject needs a note | IMPL/TEST | `service.ts:261-265` (422); domain AP-9 tests |
| AP-10 decision final | IMPL | state compare-and-set `service.ts:271-290`; domain "AP-10/AP-14" |
| AP-11 deciding writes activity, notifies requester and watchers, emits `approval.decided` | PARTIAL / HELD | Activity entry: IMPL `service.ts:291-307` (internal; note not copied). Event: IMPL, outbox-only (`service.ts:308-334`). Notification to requester and watchers: NOT IMPLEMENTED at this head, held to S4 (commit 0ca539e7). See NB-1 |
| AP-12 `reminder-scan` expires past `expires_at` | IMPL | `reminder-scan.ts:56-102`; `scheduler/index.ts` registers `reminder-scan` at `*/15 * * * *`. TEST: `reminder-scan-schedule.test.ts`; lifecycle `scanApprovalReminders` |
| AP-13 50% and 90% reminders, idempotent via `reminder_*_sent_at` | IMPL | `reminder-scan.ts:104-146`; `repository.ts:62-77` (sweep predicate). TEST: lifecycle (reminded 1, `reminder50SentAt` set). Delivery of the reminder to the approver: HELD (S4); the event is enqueued |
| AP-14 expired approval does not satisfy a gate | IMPL/TEST | domain `isGateSatisfied`; domain "AP-14"; decide refuses expired with 409 (`service.ts:248-250`) |
| AP-15 `requires_approval` blocks until a matching approval is `approved` | IMPL | `transition-work-item.ts` (rows locked FOR SHARE under the work-item lock). TEST: lifecycle 408-420 (blocked 422) and 979-987 (200 after approval) |
| AP-16 `requires_cab` accepts only `kind=cab` | IMPL/TEST | `transition-work-item.ts` (`kind: "cab"`); domain "AP-16" |
| AP-17 blocked transition reports why (approver, requested, expires) | IMPL (data only) | `work-item/response.ts` adds `pendingApprovals[{approverName, requestedAt, expiresAt}]`; both controllers populate it; actor-scoped for customers in `list-work-item-transitions.ts`. The sentence is UI (S9). No integration assertion on `pendingApprovals` (NB-2) |
| AP-18 rejection does not close the item or unblock | IMPL/TEST | domain "all policy, one rejected (AP-18)"; no code path moves the item |
| AP-19 and AP-20 My Work lens, portal screen, detail section | OUT OF SCOPE | web slice S9. The API surfaces exist: `GET /me/approvals`, `/portal/approvals`, `GET /work-items/{key}/approvals`, `canWithdraw`, `approverReachLost` |
| AP-21 pending approvals in inbox and by email | HELD | S4. `approval-lifecycle.test.ts:355-356` documents "no inbox row" at this head |
| Withdraw as requester (capability `approval:request`, actual requester, current reach, key frozen scope) | IMPL | `repository.ts:718-773` `canWithdrawApproval`. TEST: lifecycle key-scope cases (403) |
| Decide CAB: `approval:decide_cab` AND CAB team membership | IMPL | `index.ts:428-441`; `service.ts:256-258`. TEST: lifecycle `nonCabDecision` 403 |
| See approvals on an item; customers see only theirs | IMPL | `index.ts:326-357` |
| `/me/approvals` and `/portal/approvals` addressed-approver lists | IMPL | `index.ts:486-516` (`addressedOnly`); policy kinds 2 and 3 in `policy.ts` |
| API table incl. `POST /api/admin/approvals/{id}/withdraw` | IMPL | OpenAPI diff vs main adds exactly 8 operations: 7 approval paths (admin withdraw, decide, withdraw, me, portal list, portal decide, work-item GET and POST). The only changed existing operation is `/work-items/{key}/transition`, via `pendingApprovals` |
| Edge: approver leaves or loses reach: pending, flagged, not voided; named approver cannot decide; requester or admin may withdraw | IMPL | `index.ts:93-95` (`approverReachLost`); `service.ts:227-231` (403). TEST: lifecycle 467 (403). Inbox deliberately not reach-filtered (`index.ts:106-123`) |
| Edge: flag disabled at resolved level | IMPL/TEST | see first row |
| Edge: soft-deleted work item hides approvals, restored together | IMPL | `repository.ts:117,232-233,409-411,539-541` filter `deleted_at`. TEST: check 2. NB-5 on the archived filter |
| Edge: two approvals, all policy, one rejected: blocked | TEST | domain AP-18 |
| Edge: approval on an already-completed item: ALLOWED | IMPL | `loadTransitionForWorkItem` (`repository.ts:630-682`) deliberately has no from-state test. TEST: lifecycle requests on a Done item. See section 2 |
| Edge: expiry in the past: 422; approver equals requester: 422 | IMPL | `validateApprovalRequest` (domain); `service.ts:125-129` |
| Edge: gating transition edited in a new workflow version: approval untouched, sits pending | IMPL | no code force-closes; the create-time check uses only the ACTIVE version (`repository.ts:652-661`) |
| v1 defect: email never serialised on an approval | IMPL | `approval/schema.ts` `approvalResponseSchema` has `displayName` only; no email column selected in `repository.ts` projections. No explicit "no email" integration test (NB-2) |
| Testing: named E2E security specs | OUT OF SCOPE | no `*.spec.ts` for the three named specs exist; web and E2E belong to S9. The domain layer carries the named logic tests |

Behaviour not authorised by a spec rule (flagged for the record, none blocking):
- Archived work items are excluded alongside soft-deleted ones (`repository.ts:117,233,410,540`). The spec says only soft-delete. This is inherited from #589 (not in the 2350397b..2c6ade10 diff), so it is fidelity-neutral (NB-5).
- `POST /work-items/{key}/approvals` returns 404 when the flag is off (`service.ts:73`). The spec says only "refused", with no status code (NB-4).
- `createApprovalBody` and `decideApprovalBody` are `.strict()`. This is a documented 0120 addition (check 5).
- The reminder sweep selects all pending approvals regardless of the work item's soft-delete state (`repository.ts:51-77`; no `deleted_at` filter). That is consistent with "hidden, reappear together" and it was not changed.

## 2. The author's two spec-vs-review conflicts

Source precedence (CLAUDE.md): Thomas decision, then accepted spec, then AGENTS, then review recommendations. The 0120 review is a security review whose S3 check list is "binding on slice S3" (`m0120-approval-anchor.md:30`). It is still a review recommendation, not a Thomas decision or a spec. The review itself says at `:374`: "the S3 reviewer must reconcile them with the spec", because it "derived them from the schema and general tenancy rules".

### Check 3, from-state match: author's resolution CORRECT

- Review check 3 (`m0120-approval-anchor.md:316-322`): "require its `from_state_template_id` (or NULL) to match the item's current state."
- Spec edge case (`approvals.md`, Edge cases table): "Approval requested on an already-completed item | Allowed. Some processes approve after the fact".
- Spec edge case on workflow edits: an approval whose transition is no longer offered "sits `pending` until it expires". Approvals are therefore designed to be decoupled from the item's current state.
- Conclusion: the spec outranks the review. Not enforcing the from-state rule is correct. `repository.ts:626-628` documents it, and the other three sub-checks of check 3 (workflow workspace join, active version, gate flag) ARE enforced (`repository.ts:641-678`).
- Residual (non-blocking, NB-3): the deviation is recorded only in a code comment and the author's report. It is not in the ledger, `data-model.md`, the 0120 note or the decision log. The Sol reviewer should be told, and a one-line durable note would be better. No owner decision is needed under the precedence order. The report's "owner decision needed" can be downgraded to "disclose".

### Check 9, "with the flag off, the routes are closed": author's resolution CORRECT

- Review check 9 (`:331`): "With the flag off, the routes are closed."
- Spec `approvals.md` Behaviour: "When disabled, new approval requests are refused ... Existing approvals remain available ... they can be listed, read, decided, withdrawn, and processed by `reminder-scan`."
- Relayed decision log, 2026-10-06 "Preserve existing approvals when the feature flag is disabled": "blocks new approval requests when disabled, but existing approvals remain listable/readable, decidable, withdrawable and eligible for reminders".
- Thomas's 2026-10-10 S3 decision: D5 narrow exception, flag default off, approvals only. It does not alter the continuity rule. It expressly says the relayed entries are "carried unchanged".
- Conclusion: a Thomas-level decision and the accepted spec outrank the review. The code gates creation only (`service.ts:65-74`) and resolves the flag from the loaded item's own workspace and project, which satisfies the "per approval's workspace" half of check 9 (TEST: `check 9`). Correct.

### Author open issue 2, transition id from the client

Spec AP-5 and the API contract carry `transitionId`. The code validates the client id against the server-side active-version, gate and workspace evaluation (`repository.ts:630-682`). That is consistent with the spec. Correct; no change needed.

## 3. Fidelity (main vs HEAD vs 2350397b / 9ed99f24)

Diff of 2350397b vs 2c6ade10 for the approval module:

| File | vs #589 |
| --- | --- |
| `approval/policy.ts` | identical |
| `packages/permissions/src/features.ts` and `features.test.ts` | identical |
| `packages/domain/src/approvals/approvals.ts` | identical |
| `approval/schema.ts` | `.strict()` on both bodies (documented 0120 check 5) |
| `approval/index.ts` | `workspaceId` threading, `formatReachableApprovals`, `loadApprovalTargetByApprovalId(id, identity, {currentInstanceAdmin})` (documented, check 1) |
| `approval/service.ts` | `workspaceId` threading, CAB team check (check 4), insert `workspaceId` from the locked item (check 2), `isActiveInstanceAdmin` from the repository (#603 delta). Notification wiring reverted to `enqueueOutboxEvent` (documented; notification delta is held) |
| `approval/repository.ts` | workspace scoping, `lockLiveWorkItem(tx, ws, id)`, `loadTransitionForWorkItem` workflow joins, placeholder filter, `isActiveInstanceAdmin` (#603) |
| `approval/reminder-scan.ts` | outbox event writer instead of the notification fan-out (documented) |
| `work-item/controllers/*` | match the #589 shape; the diff against 2350397b is main-rebase drift plus workspace args |

- **#603 delta (9ed99f24)** vs 2c6ade10: `isActiveInstanceAdmin` in `approval/repository.ts` is byte-equivalent to #603. The `service.ts` call-site is equivalent. `tests/api/permissions/query-ownership-repository.test.ts` is the #603 file minus the role-seeding half. Verified by diff: it drops two imports (`DEFAULT_ROLE_NAMES`/`defaultRolePayloads`, `listWorkspaceRolesForWorkspace`/`seedDefaultWorkspaceRolesForWorkspace`) and two tests, and renames the describe block. That matches the report's "#603 role-seed half held" claim.
- **Leakage check (changed-file list of 37 files):**
  - No file under `notification/*` (the 5-file notification delta is only in 0ca539e7).
  - No `pending-action/*`, `intake/*`, `request-type/*`, web, MCP or SLA files.
  - `scheduler/index.ts` adds only the `reminder-scan` job; the existing `expirePendingActions` entry is untouched context.
  - `apps/api/src/database/index.ts` adds only `approvalTable`, `requestParticipantTable` and the three feature-flag tables to the `schema` export. `requestParticipantTable` is read for private-item reach inside the approval repository only.
- **D5 exception check:** `FEATURE_FLAGS` in `features.ts` lists all 21 keys of the `plugin-architecture.md` feature-toggle table, plus defaults (`feature.scim` true, `feature.import` true and locked). A grep for `resolveFeatureFlag`, `*FeatureFlagTable`, `isFeatureFlag` and `FEATURE_FLAG*` finds the registry/resolver and the schema/database export, with exactly ONE runtime consumer, `approval/repository.ts` (key `feature.approvals` only). No other flag key is read anywhere else (`feature.cycles` appears only in a comment). The D5 narrow exception is respected. The 21-key registry is the #589 port and equals the plugin-architecture list (NB-6). It must stay so; any later consumer needs its own decision.
- **Docs and generated files:** `tests/api-contract/openapi.json` adds 8 operations, removes none, and adds no schema. It changes one existing operation (`/work-items/{key}/transition`, via `WorkItemTransitionBlockReason.pendingApprovals`). `tests/permissions/matrix.fixture.json` additions are approval route rows.

## 4. Decision log

- `git diff --numstat 7cf4bc1f 2c6ade10 -- docs/07-planning/decision-log.md` is `78 0`: 78 insertions, 0 deletions. **Insert-only.**
- Three entries inserted, in chronological position (after 2026-10-09, before the 2026-10-06 self-writes entry):
  - 2026-10-07 Separate instance-admin approval withdrawal
  - 2026-10-06 Preserve existing approvals when the flag is disabled
  - 2026-10-06 Resolve bounded approvals storage and reach behavior
- **Verbatim check:** a script extracted each entry's body from 2350397b's decision log (through its last `**Recorded:**` line) and tested exact substring presence in the 2c6ade10 log: all three True (1489, 1056 and 1737 characters). The only addition is a trailing `**Reconstruction note:**`.
- **Labelled relayed:** each note reads "RELAYED entry, carried verbatim from the #589 (`2350397b`) decision log for slice S3 ... was not re-verified by the reconstruction worker. Thomas's decision of 2026-10-10 ... confirms it is carried unchanged and keeps its relayed label."
- Cited: #589 and `2350397b`. This matches the 2026-10-10 S3 decision ("carried to main verbatim by S3, citing #589 and keeping their relayed label").
- The original `Recorded: orchestrator, Thomas's explicit approval ...` attribution is preserved untouched. `---` separators were added between entries; #589 had none. This is cosmetic.
- Minor: the entries' own text never contains the word "relayed", so the label lives only in the appended note (NB-7). That satisfies the decision.

## 5. Docs

- **0120 N-1 (person-column residual):**
  - `migration-ledger.md` adds "Residual: `approval.requested_by` and `approval.approver_id`" naming both columns and the S3 check list, and "Residual: re-homing and pre-existing rows" (this also covers N-2 and the review's note that "no preflight needed" covers FK validity only).
  - `data-model.md:413` adds the person-column residual, the `transition_id` residual and `created_at`.
  - Accurate against the review text (`:274-287`).
- **0120 N-3 (ACCESS EXCLUSIVE lock):** runbook section "Upgrading across migration 0120: approval anchor" states the lock on `work_item`, held until the migrator batch commits, with the maintenance-window or `lock_timeout` advice. Accurate.
- **0120 N-4 (orphan preflight):** the runbook carries the read-only `left join work_item` query, which matches the review's suggested query and returns "no rows" as the expected result. It adds remediation (backup, delete, re-run) and explains the `SET NOT NULL` failure mode. Accurate.
- **Identifiers in authority docs:**
  - Event keys `approval.requested`, `decided`, `expiring`, `expired` and `withdrawn`: in `events.md`.
  - Job `reminder-scan`: in `background-jobs.md` (15 min, includes the approval work).
  - Capabilities `approval:request`, `approval:request_cab`, `approval:decide`, `approval:decide_cab` and `instance:admin`: in `rbac.md`.
  - `approval_default_expiry_days`, `approval.created_at`: in `data-model.md`.
  - `feature.approvals`: in `plugin-architecture.md`, edited to describe creation-only scope.
  - Activity verb `approval.decided`: added to `comments-and-activity.md` (internal).
  - `ST-11` (new rule, identical to #589): added to `settings-hierarchy.md`. No ST-11 collision exists.
  - No env var introduced.
- Docs updated consistently with the spec: `approvals.md` carries the flag, admin-withdraw, `canWithdraw` and reach-loss edits from #589.

## Findings

### BLOCKING
None.

### NON-BLOCKING

- **NB-1 (scope disclosure; AP-11 and AP-21 partial).** At 2c6ade10, approval events go to the outbox only. No notification reaches the requester, watchers or approver, no inbox row is written, no email is sent, and no reminder is delivered. This is intentional: the notification delta is held until after S4, and `approval-lifecycle.test.ts:355-356` and check 8 assert the fail-closed state. Requirement: the merge PR body must list AP-11 notification, AP-13 reminder delivery and AP-21 under "Not done / depends on S4", so that "S3 complete" is not claimed against the full spec.
- **NB-2 (test gaps against the spec "Testing" section).** (a) No HTTP-level assertion that blocked-transition responses carry `pendingApprovals` (AP-17 data); the only blocked-transition assertion is `blockedBy[].kind` at `approval-lifecycle.test.ts:415-420`. (b) No integration test that approval responses never contain an email (the spec's explicit integration item); the schema prevents it, but nothing asserts it. (c) No HTTP-level "customer session requesting a CAB approval is refused" test; the route refuses every non-staff requester with 403 (`index.ts:363-364`) and the domain test covers AP-2. Recommend adding these in S3 or logging them for S9/E2E.
- **NB-3 (durable record of the check-3 deviation).** "From-state must match" is intentionally unenforced (correct per spec), but is recorded only at `repository.ts:626-628` and in the author's report (which wrongly calls it an open owner question). Add one sentence to the migration-ledger 0120 residual or the 0120 review note and tell the Sol reviewer.
- **NB-4 (flag-off status code).** `service.ts:73` returns 404 "Approval requests are disabled" after the reach check. The spec says only "refused". 404 on a reachable work item for a disabled feature is unusual (403/409/422 are more conventional) and the OpenAPI responses declare no flag-specific code. No leak, since reach is checked first. A Sol or owner call; not a spec violation.
- **NB-5 (archived filter).** Archived items are hidden from approval reads and locks (`repository.ts:117,233,410,540`) although the spec mentions only soft-delete. Inherited from #589; cosmetic. Worth one spec sentence.
- **NB-6 (D5 registry breadth).** The flag registry holds all 21 keys with defaults, although only `feature.approvals` is consumed. It matches the plugin-architecture table and a contract test compares the two. Keep a guard or a note so no further consumer reads the flag tables without its own decision (D5: "no other feature may read the feature-flag tables without a further decision"). Nothing machine-enforces that today (only grep and convention).
- **NB-7 (relayed label).** The `relayed` label is carried by the appended reconstruction note, not the original text. Acceptable per the decision.
- **NB-8 (test strength, S2-dependent).** `approval-lifecycle.test.ts:747` asserts `expect([403, 503]).toContain(status)` for the inactive-admin withdrawal. The state invariants beside it are still asserted. This is a known placeholder; re-tighten to 403 after S2 lands, and track it so it does not survive.
- **NB-9 (ledger tense).** The new ledger residual paragraphs say the runtime "must" validate the persons and treat columns as immutable. Now that S3 implements this, rephrase to "does" or point to the tests. The immutability static guard (`tests/api/approval/immutable-columns.test.ts`) parses only the first object of a conditional `set()` (the author admits this); the integration test covers the reminder path.

### Facts for the Sol reviewer
- `transition_id`, `requested_by` and `approver_id` have no database backstop (0120 N-1, N-2); only the application checks in `service.ts` and `repository.ts` stand between a forged id and a cross-tenant row.
- Not run by me: any test, typecheck, `check:*` gate or migration replay. The author's counts (API unit 99 files, 712 tests; integration 153 files, 1751 tests; 12 mutation runs) are the author's own and are unverified here.

## Closure at 982f2b97

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
**Reviewed head:** 982f2b9787c1e06a4fff4ab494ed5ace263e3cd7

Static only, no tests run. I checked `git rev-parse HEAD` in `/private/tmp/claude-501/s3`, which equals 982f2b97. The tree has four relevant steps: `3acbded3` (docs), `b51477cd` (remediation), `945a253a` (merge of main b52e38bb) and `982f2b97` (notification commit). Changes that come only from the main merge (S2, S4, P0 records) are not S3's and were not reviewed as S3 changes.

### Verdict

**CLEAR WITH NON-BLOCKING.** No blocking finding.

- Single-use, withdrawn-ignored, expired-ignored, portal decide and strict-mode evidence all conform to `approvals.md` and to the new decision-log entry.
- The decision log is insert-only against b52e38bb.
- Gate (2) of S4's pre-wiring list is genuinely closed, and no gate is weakened.
- Three things need correction or a decision: a stale background-jobs.md gate text (NB-10), an inaccurate "fan-out stays unwired" commit statement (NB-11), and the question of whether S4's pre-wiring rule has been relaxed for gates (3) to (8) (NB-12).

### 1. NB-1 to NB-9

| Item | Status at 982f2b97 |
| --- | --- |
| NB-1 AP-11/13/21 delivery | **Resolved for in-app inbox.** The notification commit makes `approval.*` events write inbox rows for the validated approver, requester and (for a decision) staff watchers (`recipient-resolvers.ts`, `approval-notifications.test.ts`). External channels are still empty (`channels: []`, "stays with the notification worker slice"), so email delivery per preference (AP-21) is **not** done and no worker exists. It must be named under "Not done". |
| NB-2 test gaps | **Resolved.** `approval-gate-semantics.test.ts` covers AP-17 `pendingApprovals` ("a pending approval still blocks, and the block explains who is being waited on"), "approval responses never contain an email address" and "a customer session cannot request a CAB approval". |
| NB-3 check-3 deviation record | **Resolved.** `migration-ledger.md` has a "Recorded deviation from the 0120 checklist (check 3, from-state)" paragraph. It cites the spec edge case and notes that single use bounds ahead-of-time approval. |
| NB-4 flag-off 404 | **Not resolved, not recorded.** `service.ts:73` still returns 404; no doc or decision mentions the status. Observation only, as before. |
| NB-5 archived filter | **Not resolved, not recorded.** `approvals.md` still says nothing about archived items. Observation only. |
| NB-6 flag-table readers | **Not resolved.** No machine guard was added. Observation. |
| NB-7 relayed label | **Accepted as is.** |
| NB-8 `[403, 503]` | **Resolved.** `approval-lifecycle.test.ts` now asserts `toBe(403)`, since S2 has merged. |
| NB-9 ledger tense | **Resolved.** The ledger now says S3 "does" the check and "derives" and "validates", and cites the tests. The immutability guard test was also strengthened ("reads every object literal of a conditional set()"). |

### 2. New behaviour against approvals.md and the decision log

**Single use.**
- Spec: `approvals.md` AP-5 now says that an approval raised before the transition last ran "no longer counts".
- Implementation: `repository.ts` `countingApprovalClause()` hides an approval from the gate when a `transitioned` activity row for the same work item, workspace and `transitionId` is newer than the approval's `created_at`. `transition-work-item.ts:598-604` now records `payload: { transitionId }` on that activity row. The clause is used in both `listApprovalsForWorkItemTransition` and `lockApprovalsForWorkItemTransition`, so the offer list and the locked transition read the same rule.
- Authorised: yes. It matches Thomas's "consumed by the transition it unlocked ... needs a new approval" and the entry's extra sentence ("An approval raised before a transition ran for that work item does not satisfy a later run").
- It needs no new `approval.state` value and no schema change, so `data-model.md` is unaffected.
- Test: "an approved approval is consumed by the transition it unlocked; repeating the transition needs a new approval", plus the `approval-gate-ahead-utc` and `approval-gate-behind-utc` timezone files.
- Judgement point, not an authorisation problem: the rule spends all earlier approvals of that transition, including pending and rejected ones, not only the approved one. That is the natural reading of "needs a new approval" and is documented.

**Withdrawn and expired ignored.**
- Domain: `approvalsMatchingGate` filters on `COUNTING_STATES` (`pending`, `approved`, `rejected`). Hence a withdrawn or expired approval neither blocks an `all` gate nor satisfies any gate.
- The SQL filter in the repository has the same state list. AP-14 is unchanged.
- Tests: "a withdrawn approval is ignored ..." and "an expired approval is ignored as well".
- Authorised: yes, exactly Thomas's option text.

**Customer decide.**
- `approval/index.ts` now evaluates `approval:decide` at organisation scope through `hasPortalApprovalDecideCapability`. `rbac.md` says the `customer` role is organisation-scoped and holds `approval:decide`.
- `approval-portal.test.ts` covers:
  - the addressed customer deciding;
  - another customer of the same organisation refused;
  - a staff session refused;
  - a CAB approval refused;
  - a forged cross-organisation row refused;
  - a rejection needing a note;
  - the list scoped to the caller.
- Authorised: yes. It is a bug fix to make the spec's `POST /api/portal/approvals/{id}/decide` reachable. It adds no new authority beyond rbac.md.
- Note: `/api/approvals/{id}/decide` still evaluates at work-item scope, so customers use the portal route. That matches the spec's API table.

**Strict-mode evidence.**
- New `approval/evidence.ts` middleware publishes workspace (`workspaceIdSource: "row"`), project and work item to strict enforcement, and the `addressed_approval` predicate for the portal routes. It decides nothing itself and returns the same 404 as the handlers, so it reveals no other workspace's approval.
- `approval-strict-enforcement.test.ts` has a test that the approval policy source "is really enforced in this file", so it is not vacuous.
- Authorised: yes. The 2026-10-09 strict-enforcement design needs row evidence for registered policy sources.
- Small point (NB-13): `approvalIdEvidence` returns 401 for an identity that resolves as inactive, while S2's change gives 403 for inactive identities on other routes. The lifecycle test's inactive-admin case passes with 403 only because that route is not behind this middleware. A short check that an inactive session on `/approvals/{id}/*` gets the S2 status would close this.

**Other added behaviour.**
- Admin withdrawal audit rows now carry `via: "admin_route"` and `onBehalfOfPersonId`. This follows AP-7's "audited" and is covered by "an instance-admin withdrawal is marked as such in the audit trail".
- `FOR UPDATE ... OF approval` in the reminder sweep is a lock-scope fix with a test.
- Nothing is added that neither the spec nor a decision authorises.

**Residual risk for Sol.**
- The single-use rule depends on durable `activity` rows. Anything that purges or rewrites activity would reopen spent approvals; I found no purge in the scheduler, but this is unproven by test.
- `createApproval` takes `now` at `service.ts:60`, before it locks the work item. A transition that commits between that moment and the insert could make a brand-new approval look already spent. The window is small and fails closed (the approval would need re-requesting).

### 3. Decision log

- **Insert-only:** `git diff --numstat b52e38bb 982f2b97 -- docs/07-planning/decision-log.md` gives `88 0` (88 additions, 0 deletions). Of these, 78 lines are the three relayed #589 entries from my earlier review and about 10 are the new entry. The diff shows no removed line.
- **Quote accuracy:** the transcript has Thomas's answers at 2026-10-10T13:39:15Z, to an `AskUserQuestion` with two questions. His answers are "Single use (Recommended)" and "Ignore withdrawn (Recommended)".
  - The entry's bullets match the option descriptions: "The approval is consumed when its transition happens. Coming back to that state needs a new approval" and "Withdrawn approvals don't count toward the gate at all. Only pending, approved and rejected ones do, so withdrawing can't block anything."
  - Two parts of the entry are not Thomas's words: "An approval raised before a transition ran for that work item does not satisfy a later run" is the conductor's derivation of single use. "An `expired` approval also does not count (`AP-14`)" comes from the spec.
  - Both are consistent with his choice, but the entry presents them as the decision. Suggest the entry say which sentences are derived.
  - The source line "Thomas, directly to the Claude Opus conductor session, 2026-10-10" is accurate.

### 4. Notification commit (982f2b97) vs S4 pre-wiring gates

The gate lists are in `notifications.md` (line ~582) and `background-jobs.md` (line ~324).

**Closed:**
- **Gate (2), approval fan-out:**
  - recipient resolver `resolveApprovalEventRecipients`: the event's workspace scopes the lookup; the recipients are the validated requester, the approver (who must still be an active CAB member for `cab`) and watchers; customers only if they are the requester or approver;
  - send-time eligibility in `current-eligibility.ts`: workspace match, pending-only for requested and expiring, recipient is addressed, approver still valid, and customer read authority evaluated at organisation scope;
  - the approval entry in `resource-contract.ts` and in fan-out `RESOURCE_TYPES`.
- **The approval part of gate (1):** a new read predicate `approval-reach.ts` is applied on all four inbox paths (list, read, read-all, clear-all). It requires the approval, work item and project to be live, a private item to be visible, the recipient to be addressed and the user to hold staff project reach. It fails closed.
- **Gate (8) for approval writes:** fan-out already sets timestamps with `dbNowUtc()`, and the Asia/Yangon and America/New_York timezone tests cover approvals. The column defaults are unchanged, so this gate is not closed in general.

**Not closed (unchanged):**
- gate (1) for the other resource types;
- gates (3), (4), (5), (6) and (7).
- No weakening found: the only removed text is the "approval is intentionally absent from `RESOURCE_TYPES`" safeguard, replaced by the predicate and resolver above.

**Findings:**
- **NB-10 (doc drift, should fix):** `background-jobs.md` gate (2) still reads "`approval` is excluded from fan-out until the approvals slice lands". Only `notifications.md` was updated. The two copies of the gate list now disagree; fix both in the same PR.
- **NB-11 (inaccurate statement):** the commit message says "Fan-out stays unwired (no producer or worker is added)". But `enqueueNotificationEvent` calls `materializeNotificationFanout`, which writes `notification` inbox rows synchronously in the request transaction. The approval service is now such a producer, and the lifecycle test asserts one inbox row. The correct statement is that no external delivery worker or channel is wired.
- **NB-12 (pre-wiring rule scope, owner or Sol call):** both docs say the gates must close "before any producer or worker calls this runtime". With approvals as the first producer, gates (3), (4), (5), (6) and (7) remain open. They look not to apply to approval rows: channels are `[]` so no `notification_delivery` rows or adapter titles exist for approvals, titles are constants, and no worker exists. But gate (4) ("`fanout.ts` has no tests; add recipient, preference, digest-hook and self-exclusion coverage") is still open, and the new tests cover only approvals. Recommend one sentence in both docs saying which gates are relied on as "not applicable" for the approval-only producer, so the rule is not silently relaxed.
- **NB-14 (resolver and read predicate mismatch):** the resolver writes inbox rows for customer approvers and requesters, but the read predicate requires `person.side = 'staff'`, so customer approval rows are never readable. They fail closed (no leak) and the portal list is the customer surface, so it is consistent with the spec, but it writes unreadable rows. Either skip customer rows in the resolver or document it.
- No gate is weakened; AP-11 and the in-app part of AP-21 are now implemented at this head.

## Final closure at 72207e01

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
**Reviewed head:** 72207e01c7169348981028f00bb80ef6f9b81b24

Static only, no tests run. `git rev-parse HEAD` in `/private/tmp/claude-501/s3` equals 72207e01. I reviewed the single commit 982f2b97..72207e01 (15 files, +558/-21).

### Verdict

**CLEAR WITH NON-BLOCKING.** No blocking finding.

- The third decision is implemented as Thomas chose it.
- `approval.closed` is registered in both authority locations.
- The residual notes in `approvals.md` match the code.
- Two small clarity gaps remain: unmarked derived consequences in the third bullet of the entry (NB-16), and the overloaded meaning of `expired` (NB-15).

### 1. NB-items

| Item | Status at 72207e01 |
| --- | --- |
| NB-10 (`background-jobs.md` gate 2 stale) | **Resolved.** Gate (2) text now equals the `notifications.md` text. |
| NB-12 (first-producer rule) | **Resolved.** Both docs carry an identical "Approvals is the first in-app producer" paragraph. It says gates (3) to (7) do not apply because channels are `[]`, so there are no delivery rows and no adapter, titles are constants and no worker exists. It states honestly that gate (4) is only partly covered. It states that gate (8) holds for approval writes only. It requires the first producer with channels or a worker to close gates (3) to (7). The reasoning matches the code: `channels: []` in `recipient-resolvers.ts`. |
| NB-13 (inactive identity status) | **Resolved.** `evidence.ts` returns 403 for an identity that resolves as inactive. Test: "an inactive identity is refused with 403 on every /approvals/{id}/* route". |
| NB-14 (customer inbox rows) | **Resolved.** The resolver now skips non-staff recipients (`recipient-resolvers.ts`). Test: "no inbox row is written for a customer approver or requester". The `approvals.md` residuals note says customers use the portal list. |
| NB-11 (commit-message wording) | Superseded: the docs now correctly state that the producer writes inbox rows and no worker exists. The old commit message cannot change. |
| NB-1 (email delivery) | Still open and now documented: "No destination for approval deliveries" in the residuals. It must stay on the "Not done" list. |
| NB-4, NB-5, NB-6 | Unchanged observations; not recorded. NB-7 accepted. |

### 2. Decision-log entry

- **Insert-only:** `git diff --numstat b52e38bb 72207e01 -- docs/07-planning/decision-log.md` gives `91 0` (91 additions, 0 deletions). The 3 extra lines relative to the previous head are edits inside the S3 entry, which is itself new relative to main.
- **Third decision, quote accuracy:** the transcript shows the question at 2026-10-10T14:54:58Z and Thomas's answer at 15:01:24Z: "Close them on transition (Recommended)". The option's description reads: "When the transition runs, other pending approvals for it are closed automatically (marked expired/void, audited, removed from inboxes). A new run needs new approvals."
  - The entry's bullet matches this: closed automatically, audited, removed from inboxes, a new run needs new approvals.
  - **NB-16 (clarity):** the third bullet also states "no new state value, no migration", "no longer reminded" and "refused on a later decide (409)". Those are the conductor's implementation consequences, not words of the chosen option. The 409 wording belongs to the option Thomas did not select ("Refuse decisions (409)"). The first two decisions now mark their derived text; the third should do the same. Cheap fix, consistent with the previous round.
  - "marked expired/void" is mapped to the existing `expired` state. That is a reasonable reading but is the conductor's choice and should be named as such.
- **Decisions 1 and 2:** the conductor-derived and spec-derived sentences are now explicitly marked ("Conductor-derived, not Thomas's words" and "From the spec, not a new decision"). Resolved; both bullets match the options Thomas chose ("Single use (Recommended)" and "Ignore withdrawn (Recommended)").
- Source and recorder lines remain accurate.

### 3. `approval.closed` registration and conventions

- **Code:** `apps/api/src/audit/actions.ts` adds `"approval.closed"` to `AUDIT_ONLY_ACTIONS` with a comment citing the owner decision.
- **Doc:** `audit-trail.md` adds a row to the audit-only catalogue table: "A pending approval was closed because a run of its transition consumed approvals ... not a domain event, because no `approval.*` event fits (`approval.expired` means a time-out)". That follows the stated rule that audit-only keys are the ones with no domain event and that a new key is added to the doc first.
- It does not collide: the key is not in `events.md` or the event-key registry. Only the doc, the code set, the service and the test mention it.
- Consistent with convention in the writer call: dotted key, `entityType: "approval"`, `before` and `after` states with a reason and the transition id.
- **NB-15 (docs, non-blocking):** reusing the existing `expired` state means a transition-closed approval has `state = 'expired'` with a future `expires_at`, and AP-12 and `data-model.md` still describe `expired` as "past `expires_at`". The only way to tell a closed approval from a timed-out one is the `approval.closed` audit row. The `approvals.md` AP-5 note says the approval "move[s] to `expired`", but AP-12 and the data-model state description should say that `expired` also covers transition-closed approvals, or the next reader will treat it as a defect.
- **NB-17 (minor):** the closure's `appendAuditLog` call omits `organisationId`, while the other approval audit writes pass it. It is optional in the writer, but the audit rows for one approval will have inconsistent scope fields.
- Behaviour check: `closePendingApprovalsOnTransition` runs inside the transition's own transaction (work item locked), closes only `pending` approvals of the same workspace, work item and transition id, runs only for `requires_approval` or `requires_cab` edges, deletes the matching approval inbox rows, and emits no domain event. The reminder sweep reads only `pending`, so reminders stop. The earlier decide path returns 409 for a non-pending approval. All of that matches the decision and `approvals.md` AP-5.

### 4. `approvals.md` residual notes against the code

| Note | Matches the code? |
| --- | --- |
| Single use is derived, not stored; both sides stamped with the database clock under the work-item lock | Yes. `service.ts` stamps `createdAt` with `dbClockUtc()` inside the transaction after `lockLiveWorkItem`; the transition's `transitioned` activity row uses `createdAt: dbClockUtc()` (`transition-work-item.ts`, `activity.ts` override). This also resolves my earlier residual about `now` being taken before the lock (the lock-wait race test and two clock-skew tests were added). |
| Legacy activity rows have no `transitionId` and never spend an approval; purging activity would reopen spent approvals | Yes. The clause matches `payload ->> 'transitionId'`, so rows without it cannot match. The caveat about purging is honest. |
| Pending approvals block an `all` gate until decided, withdrawn, expired or closed | Yes. `COUNTING_STATES` includes `pending`, and closure is the new exit. |
| Inactive pending approver stays pending and is flagged `approverReachLost` | Yes (`index.ts` `approverReachLost` derivation). |
| Impersonation not distinguished by the approval handlers; plugin not mounted | Plausible: `resolveApprovalIdentityIfActive` sets only `session` or `api_key`, and I found no impersonation plugin mount in `apps/api/src`. |
| Customer approval notifications served by the portal list, no inbox row | Yes (resolver change plus test). |
| No destination for approval deliveries; would back off as `destination_unresolved` | Consistent: recipients carry `channels: []`, and `current-eligibility.ts` returns `destination_unresolved` when no destination resolves. |
| AP-5 paragraph on closing pending approvals | Matches the implementation, including the 409 on a later decide. |

### Residual for the Sol reviewer

- Single use and closure rely on `activity` and `audit_log` rows as the durable record; there is no stored `consumed_at` (the doc names it as the stored alternative).
- A transition-closed approval is indistinguishable from a timed-out one without the audit row (NB-15).
- Closure hard-deletes the matching approval inbox rows in the transition transaction. That is what "removed from inboxes" means here, but it is a delete on a user-visible table, so it is worth one explicit look.


## Historical ordinary B (verbatim)

Original report SHA-256: `3f6ba808ad4dc6590e41fca6645ebc54c4faa2f1809ba8f404156fb2f163ee61`

# S3 approvals - ordinary review B (runtime correctness and test adequacy)

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: not exposed to this subagent (fresh, independent Sonnet subagent context; did not author, direct or remediate the change)
**Reviewed head:** 2c6ade1051a886f3ef5d0a56efb6a90d248138b0
Base: main 7cf4bc1f (`git diff 7cf4bc1f 2c6ade10`: 37 files, +6455/-42; 5 commits 55e02589, f8a0218e, e07dbfc7, 46ff658b, 2c6ade10). The held top commit 0ca539e7 is excluded: the work tree was a `git archive` of 2c6ade10 (the /private/tmp/claude-501/s3 checkout is at 0ca539e7, which I did not use).

## Verdict: APPROVE (no blocking runtime defect found). 6 recommended test additions and 5 non-blocking findings below.

The runtime behaviour I probed is correct: the lifecycle, the double-decide and decide-versus-withdraw races, the cross-workspace 404s, the flag gate and the transition gate all behaved. The weakness is test adequacy. Of the 10 items on the 0120 checklist, 6 have a test that fails when the main enforcing code is removed, but several sub-clauses have no test. The portal routes have no runtime test at all. Details are in the mutation table.

## Setup (all on a git archive export; candidate checkout never touched)
- Export of 2c6ade10 into the scratchpad. `git init` there with a `main` commit of the base tree (7cf4bc1f) plus a `cand` commit, and refs/remotes/origin/main, so the permission baseline and the vocabulary shrink-only ratchet have a merge base.
- node_modules: workspace-level dirs copied with `cp -a`, the root `.pnpm` store symlinked from /private/tmp/claude-501/s3. Packages domain, permissions and email rebuilt with `tsc`.
- One container: `s3-review-b-pg` (postgres:18-alpine, `--rm --tmpfs /var/lib/postgresql`, host port 55461). Private DBs `s3b_test` (full suite), `s3m_test` (mutations), `s3x_test` (probes).

## Commands and counts (all exit 0)
| Command | Result |
| --- | --- |
| typecheck: apps/api 4 tsconfigs (main, permissions, tests, rls-prototype), packages/domain, packages/permissions | clean. Not run: web, ui, mcp, email, libs (the diff touches none of them) |
| unit: apps/api `vitest run` | 99 files, 712 tests passed |
| unit: packages/domain | 18 files, 637 tests passed |
| unit: packages/permissions | 14 files, 267 tests passed |
| `pnpm test:permissions` (turbo) and `pnpm check:route-policy` | api test:permissions: 14 files, 88 tests passed; turbo 5/5 tasks |
| `pnpm check:openapi` | tests/api-contract/openapi.json matches the API (216 operations) |
| `pnpm check:events` | 31 published event keys, 453 source files, all registered |
| `pnpm check:vocabulary` | 111 table declarations registered; 11 inherited baseline notes. Passes only with a merge base (first run without one reports "cannot resolve a merge base", not a defect) |
| `pnpm check:policy` | 8 policy files coherent |
| `biome ci .` | exit 0 (1938 files; 174 warnings, 1 info, all in files outside this diff). `biome check` on the 28 changed .ts/.json files: clean |
| FULL integration suite (`vitest.integration.config.ts`, `TASKDESK_DATABASE_URL=.../s3b_test`) | 153 files, 1751 tests passed |

## 1. Lifecycle, end to end (probed on a private DB with throwaway tests)
Probes were run in a copy of the export (never committed). Outputs:
- Request to decide (approve) to transition: transition 422 before the decision, 200 after approve (P5). Reject then transition stays 422 (P6). Reject without note is 422 (P7).
- Double decide, concurrent (the repo's own tenant check 6): exactly one 200 and one 409, one `approval.decided` outbox row.
- Decide versus withdraw, concurrent, at service level, 15 iterations (P8): every run had exactly one winner (decide wins: ok/409:approved; withdraw wins: 409/ok:withdrawn), exactly 1 outbox event and 1 audit row, and a consistent final state. No deadlock, no double write. Note that the HTTP harness cannot test two different users concurrently, because `mockAuthenticatedSession` is a global mock (my first attempt produced a false 403). The repo's only concurrent test therefore uses one user.
- Non-approver CAB member who holds `approval:decide` and `approval:decide_cab`: 403 `not_named_approver` (P4). Approver whose membership and grants were all deleted: 403 (P3), state stays pending.
- Withdraw by requester, withdraw by instance admin (session-only route), expiry through `scanApprovalReminders`: all covered by approval-lifecycle.test.ts and passing. Admin API key gets 403 on the admin route; a session admin on the requester route gets 404.
- Lock order, read from source: decide, withdraw and create lock the work item row, then the approval row. The scan locks only approval-side rows and uses SKIP LOCKED, so there is no deadlock cycle.
- Is the compare-and-set real? Yes: `where state = 'pending'` is in the UPDATE of decide, withdraw and the scan, and the code returns 409 on zero rows. It is also redundant with the row locks (see the mutation table, D4 to D7).

## 2. The 0120 "Checks S3 must carry" (10 items) and mutation results
Each mutation was applied to a temp copy (`b-mut`) one at a time and reverted, with the three approval integration files (tenant-checks, lifecycle, feature-flag) as the kill set unless noted. KILLED means at least one test failed. SURVIVED means all passed. "Equiv." marks a mutant I judged behaviourally equivalent, because another layer enforces the same thing.

| # | 0120 check | Mutation | Result | Killing test / comment |
| - | - | - | - | - |
| 1 | workspace scoping | 1a `lockApproval` drops workspace filter | KILLED | tenant check 1b (repository-level test, not HTTP) |
| 1 | | 1b `listApprovalRows` drops workspace filter | KILLED | same |
| 1 | | 1c `lockLiveWorkItem` drops workspace filter | KILLED | same |
| 1 | | 1f `listApprovalsForWorkItemTransition` drops workspace filter | KILLED | same |
| 1 | | 1e `loadApprovalTargetByApprovalId`: treat every caller as related (skip reach) | KILLED | tenant checks 1 and 6 |
| 1 | | 1d same function: drop `target.workspaceId !== row.workspaceId` | SURVIVED | Equiv.: the function's own join already ties approval and work item on workspace_id |
| 1 | | 1g `formatReachableApprovals` drops its workspace mismatch guard | SURVIVED | Equiv., same reason |
| 2 | work item by (workspace,id), soft-deleted excluded | 2a drop `deleted_at` filter in `loadApprovalTargetByKey` only | SURVIVED | layer 1 alone |
| 2 | | 2b drop the deleted/archived check in `lockLiveWorkItem` only | SURVIVED | layer 2 alone |
| 2 | | 2c drop BOTH | KILLED | tenant check 2 |
| 2 | | 2d insert `workspaceId` from `target` instead of the locked item | SURVIVED | Equiv. (same value); the body is closed by `.strict()` (5b) |
| 3 | transition tenancy | 3a drop `workflow.workspace_id` join | KILLED | tenant check 3 |
| 3 | | 3b drop active-version binding | KILLED | tenant check 3 |
| 3 | | 3c drop the `requires_approval/requires_cab` filter entirely | KILLED | tenant check 3 |
| 3 | | 3d drop only the `requires_cab` arm of that filter | **SURVIVED** | GAP: no test uses a `requires_cab`-only edge |
| 3 | | 3e drop the type-to-workflow join (any workflow of the same workspace qualifies) | **SURVIVED** | GAP: the test only uses another WORKSPACE's workflow, never a sibling workflow in the same workspace |
| 4 | approver | 4a drop the CAB-team membership check | KILLED | tenant check 4 |
| 4 | | 4b drop active and non-placeholder filters | KILLED | tenant check 4 |
| 4 | | 4c drop the approver-reach check at request time | **SURVIVED** | GAP: the test name says "with reach" but no case asserts it |
| 4 | | 4d drop the kind/side eligibility (customer needs customer side, cab needs staff) | **SURVIVED** | GAP |
| 4 | | 4e drop the "approver has an account (userId)" requirement | **SURVIVED** | GAP |
| 5 | requester | 5a `requestedBy` set from the approver id instead of the session | KILLED | tenant checks 5, 6, 7, 8 |
| 5 | | 5b drop `.strict()` on the create body | KILLED | tenant checks 2 and 5 |
| 6 | decider | D1 decide ignores the acting person (acts as `row.approverId`) | **SURVIVED** | GAP, see finding R-2. The 403 cases are all by capability, not by the "named approver" predicate. P4 shows the real code is correct |
| 6 | | D2 drop expiry check | KILLED | tenant check 6 |
| 6 | | D3 drop the reach re-check at decide | KILLED | tenant check 6 + lifecycle |
| 6 | | D4 drop work-item lock only | SURVIVED | other layers hold |
| 6 | | D5 drop compare-and-set only | SURVIVED | locks hold |
| 6 | | D6 drop both row locks (CAS stays) | SURVIVED | CAS holds |
| 6 | | D7 drop locks AND CAS | KILLED | tenant check 6 concurrent decide |
| 7 | immutability | I1 add `approverId` to the decide UPDATE | KILLED | tests/api/approval/immutable-columns.test.ts |
| 7 | | I2 add `approverId` to the SECOND branch of the reminder-scan ternary `.set(a ? {...} : {...})` | **SURVIVED** | GUARD BYPASS, see finding R-3 |
| 8 | events carry workspace; no notification before S4 | not mutated (see note below) | - | tenant check 8 asserts equality of event.workspace_id with the approval's workspace, and zero `notification_delivery` rows |
| 9 | flag per approval's workspace | F1 drop the creation gate | KILLED | tenant check 9 + lifecycle |
| 9 | | F2 workspace flag lookup ignores `workspace_id` | KILLED | tenant check 9 |
| 9 | | F3 project flag lookup ignores `project_id` | **SURVIVED** | GAP: only one project exists in the resolver test |
| 9 | | F4 built-in default flipped to true | KILLED | feature-flag test + lifecycle |
| 10 | negative tests | covered by the rows above; the HTTP negatives that exist are listed in section 5 | | |

Further mutations (withdraw, admin, transition, expiry, portal):

| Mutation | Result | Comment |
| - | - | - |
| W1 withdraw service drops its authorization re-check | SURVIVED | Equiv. (the route checks `canWithdrawApproval` first; the service re-check is defense in depth) |
| W2 withdraw replaces the under-lock `isActiveInstanceAdmin` re-check with `true` | SURVIVED | GAP: the "authority rechecked under lock" TOCTOU claim has no test (needs a demotion between route check and lock) |
| W3 drop the "actionable" 409 | SURVIVED | Equiv. via CAS |
| W4 drop withdraw CAS only | SURVIVED | Equiv. via the actionable check and locks |
| W5 admin route drops `requireSessionOnly` | KILLED | lifecycle |
| W6 admin route drops `isCurrentInstanceAdmin` | SURVIVED | Equiv., the under-lock recheck plus `canWithdraw` still refuse |
| W7 drop the key `approval:request` scope check in `canWithdrawApproval` | SURVIVED | covered upstream by route policy |
| T1 (first attempt) | invalid mutation, discarded | operator precedence made it a no-op |
| T1b approval gate forced satisfied in `transitionWorkItem` | KILLED | lifecycle (422 before approval) |
| T3 CAB gate forced satisfied | **SURVIVED** | GAP: no test of a `requires_cab` transition |
| T2 drop `FOR SHARE` on the approval rows read by the transition | SURVIVED | the race it guards (decide/withdraw between the gate read and the write) is untested; I could not construct a harmful interleaving since approved is terminal |
| E1 scan never expires | KILLED | lifecycle, tenant 7, 8 |
| E2 scan does not stamp reminder timestamps | KILLED | lifecycle |
| E3 scan expiry UPDATE drops `state='pending'` | SURVIVED | Equiv. (the scan holds the row lock) |
| P1 portal decide drops the "customer kind and addressed to me" check | **SURVIVED** | GAP: no test hits `/api/portal/approvals*` |
| P2 portal decide drops the customer-side requirement | **SURVIVED** | same |
| P3 `/me/approvals` ignores `addressedOnly` | **SURVIVED** | GAP |
| P4 work-item list drops the customer own-rows filter | **SURVIVED** | GAP |

Note on item 8: I did not mutate the event scope because the outbox workspace column has an FK, so most mutations would fail for the wrong reason. Check 8 is an equality assertion on four events; it does not cover `approval.withdrawn` or `approval.expiring`.

### The author's claim about soft-delete and compare-and-set
VERIFIED, with one qualification.
- Soft-delete exclusion: it has two layers (`isNull(deletedAt)` in `loadApprovalTargetByKey`, and `!row.deletedAt && !row.archivedAt` after the lock in `lockLiveWorkItem`). Removing either one alone passes all 14 approval tests (2a, 2b). Removing both fails tenant check 2 (2c).
- Compare-and-set: the row locks (work-item `FOR UPDATE` plus approval `FOR UPDATE`) and the `state='pending'` predicate are independent layers. Removing the work-item lock alone, the CAS alone, or both row locks alone all pass (D4, D5, D6). Removing locks and CAS together fails the concurrent-decide case (D7).
- Qualification: the soft-delete test (check 2) only exercises request creation. Nothing tests a soft-deleted or archived work item on decide, withdraw or the list route, so for those paths "both layers removed" is not observable at all.

## 3. Feature flag
- Default is off: `FEATURE_FLAG_DEFAULTS["feature.approvals"] = false` (F4 killed). Precedence is project, then workspace, then instance, then built-in default, with an instance `locked` override first; the repository resolver test covers all five steps in one test.
- Resolution is per the approval's workspace: the flag is resolved from `target.workspaceId` and `target.projectId` of the loaded work item (F2 killed). Cross-workspace isolation is tested (tenant check 9).
- Creation is gated: F1 killed. With the flag off, creation returns 404, and decide, withdraw, read and the scan still work, exactly as the spec text added in this PR says. The lifecycle test also checks that the workflow gate keeps applying while the flag is off.
- No other feature reads the flag tables: `grep` for `FeatureFlagTable|feature.approvals|resolveFeatureFlag` over apps/api/src, packages/*/src and scripts shows only database/index.ts, database/schema.ts, approval/repository.ts and the permissions package itself.
- Not covered: per-project isolation (F3 survived).

## 4. Findings

None blocking. Recommended before merge (test adequacy):
- **R-1 (recommend, test gap): the portal routes have no runtime test.** `GET /api/portal/approvals` and `POST /api/portal/approvals/{id}/decide` appear only in the permission matrix fixture and the OpenAPI file. Mutations P1 to P4 and 4d all survive, so the customer-kind path (customer-side approver, addressed-approval predicate, customer own-rows filter, `/me/approvals` addressing) is wholly unexercised. This is the path where a customer acts, so it deserves at least: a customer decide succeeds; a non-addressed customer gets 403 or 404; staff on a portal route gets 403; the inbox lists only addressed approvals.
- **R-2 (recommend, test gap): "named approver" is enforced only incidentally in the tests.** D1 survives: nothing proves that a second person who holds `approval:decide`/`approval:decide_cab` (and is a CAB member) is refused. My probe P4 shows the real code refuses with 403 `not_named_approver`, so this is a missing test, not a defect.
- **R-3 (recommend): the immutability static guard has two holes.** (a) `updatedApprovalColumns` reads only the first `{...}` of a `.set(a ? {..} : {..})`, so a forbidden column in the second branch passes (I2 survived; the reminder-scan already uses that shape). (b) The second unit test asserts `.length >= 0`, which cannot fail. The guard's own header says it is "the only machine gate" for check 7 (N-2), so it should parse every object literal in the argument, and also catch `approvalTable` aliases and `.set(variable)`. The runtime test (check 7) only compares the immutable columns across three code paths.
- **R-4 (recommend): `requires_cab` has no test anywhere.** Mutants 3d and T3 survive: no test requests an approval on a `requires_cab`-only transition and none asserts that such a transition stays blocked until a CAB approval exists. Approvals on `requires_approval` edges with kind=cab are the only shape covered.
- **R-5 (recommend): same-workspace sibling workflow (3e) and the approver-reach / account / side checks at request time (4c, 4d, 4e) have no negative test.** The tenant check 4 test name promises "with reach". Check 10 in the checklist ("a cross-workspace transition id", "a cross-organisation or non-member approver") is met for the cross-workspace cases, but not for these.
- **R-6 (recommend): project-level flag isolation (F3) and a withdrawn/expiring event workspace assertion are missing.**

Non-blocking observations on runtime behaviour:
- **O-1: withdraw of an elapsed-but-unscanned approval succeeds (200) and records `withdrawn`, while decide on the same row returns 409 "has expired".** Probe P1: 200, state `withdrawn`. Window is up to the 15-minute scan interval. Harmless to the gate, but the terminal state and the audit trail say "withdrawn" for something that had already expired. Either refuse (409) or mark expired first.
- **O-2: the reminder-scan `SELECT ... FOR UPDATE SKIP LOCKED` joins approval, work_item and workspace without `OF approval`, so it locks all three tables' rows.** I verified on Postgres 18 that while the batch transaction is open, an INSERT of a row that references the locked workspace row (FK `FOR KEY SHARE`) waits (lock timeout after 2 s in my probe). A 100-row batch holds the workspace and work-item row locks for the duration of its audit and outbox writes, and any approval whose work item or workspace row is locked elsewhere is skipped until the next 15-minute run. Suggest `.for("update", { skipLocked: true, of: schema.approvalTable })`. Not a correctness bug; a latency and contention cost that grows with batch size.
- **O-3: the lifecycle test is one 950-line `it(...)`.** A failure anywhere reports the same test name, and later sections do not run after the first failed expectation. Splitting by scenario would make the suite diagnosable. The inactive-admin case accepts `[403, 503]` with an explicit S2 dependency note.
- **O-4: loose assertions.** The "stranger cannot request" case accepts `[403, 404]`. Tenant check 10 only asserts that an UPDATE of `workspace_id` throws (that is the 0120 FK, not S3 behaviour).
- **O-5: the checklist sub-item "its `from_state_template_id` matches the item's current state" is intentionally not enforced** (repository comment: it conflicts with "approve after the fact" in approvals.md and is reported as an open question). I agree with that reading; the conductor should record the decision, because the 0120 record lists it as a binding check.

What I could not verify: the web UI, GPT-6 Sol security semantics, behaviour under real multi-process concurrency (all concurrency here is in one Node process over a pooled Postgres connection set), and the effect of the held notifications commit 0ca539e7.

## Cleanup proof
- Container `s3-review-b-pg` stopped (`--rm` removes it): `docker ps -a | grep -c s3-review-b-pg` printed 0. The other running containers (s4-sec-pg, s4-review-b-pg, taskdesk-*) were not touched.
- Scratch directories removed (the 2c6ade10 export with its node_modules copies and git scaffolding, the mutation copy, the probe copy and probe output); only the check logs (`b-logs/`) and the mutation scripts/outputs (`mut*.py`, `mut*.out`) remain in the scratchpad.
- Candidate checkout /private/tmp/claude-501/s3: `git status --short` empty, HEAD still 0ca539e7aebbff5ab302ebccefb2c0f35e3463ec. No edits, commits or pushes anywhere. The only new file of record is this report.

## Closure at 982f2b97

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: not exposed to this subagent (same independent review context as the section above; I authored none of the change)
**Reviewed head:** 982f2b9787c1e06a4fff4ab494ed5ace263e3cd7
Base for the diff: main b52e38bb (S4). Work was done on a fresh `git archive` export of exactly this head (verified with `git rev-parse HEAD` in /private/tmp/claude-501/s3), with a `main`/`cand` git scaffold for the baseline checks.

### Verdict: APPROVE (ordinary closure). No blocking finding.
All six of my earlier "recommended" test gaps are now either closed by a real test or reduced to a documented, layered case. I found two behaviours worth a decision (C-1, C-2) and four residual test gaps (C-3), all non-blocking. The author's report is accurate on every count I re-checked, and its "survives only when two layers are removed" claims hold.

### Counts (all exit 0, run on the export)
| Check | Result |
| --- | --- |
| typecheck: apps/api 4 configs, domain, permissions | clean |
| unit: apps/api | 105 files, 771 tests passed |
| unit: packages/domain | 18 files, 640 tests passed |
| unit: packages/permissions | 14 files, 267 tests passed |
| `test:permissions` (turbo 5/5) and `check:route-policy` | 14 files, 88 tests passed |
| `check:openapi` | matches, 216 operations |
| `check:events` | 31 event keys, 465 source files, all registered |
| `check:vocabulary` | pass, 111 tables registered; notes: 1 baselined name no longer declared (run `--prune`), 11 inherited |
| `check:policy` | 8 policy files coherent |
| `biome ci .` | exit 0, 175 warnings, 1 info (the author reports the 2 unused-import warnings in the outbox suite; no errors) |
| FULL integration suite (private `c_full_test` DB, postgres:18-alpine) | 165 files, 1967 tests, all passed (this is the run the author skipped after the final test edit) |
| S4 outbox suite, run explicitly per zone | UTC 50, Asia/Yangon 51, America/New_York 51 = 152 tests, 3 files, passed |
| approval single-use TZ files | Asia/Yangon 1/1, America/New_York 1/1; approval-gate-semantics (UTC) 15/15 |

### 1. My earlier gaps, re-checked by mutation on the new head
KILLED = a test fails; SURVIVED = all pass. Kill set: tenant-checks, lifecycle, feature-flag, gate-semantics, portal (plus unit guard test for the guard rows).

| Earlier gap | Mutation | Now | Closed? |
| --- | --- | --- | --- |
| R-1 portal routes untested | portal decide: drop org-scope capability check | SURVIVED | partly: new approval-portal.test.ts (7 tests) kills the work-item-scope variant, but nothing proves a customer WITHOUT `approval:decide` is refused (C-3a) |
| | drop kind/addressed check | SURVIVED | layered with the domain named-approver and CAB-member checks (author's N16): accepted as defense in depth |
| | drop customer-side requirement | SURVIVED | layered: a staff caller still fails the addressed check |
| | `/me` and portal list ignore `addressedOnly` | SURVIVED | open (C-3b) |
| | work-item list drops the customer own-rows filter | SURVIVED | open (C-3b); this one is a read-visibility rule for customers |
| R-2 named approver | domain `not_named_approver` removed | KILLED (new test "a second CAB member who holds approval:decide but is not the named approver cannot decide") | closed |
| | service passes `row.approverId` as acting person | SURVIVED | equivalent: masked by the CAB-member set built from the real caller |
| R-3 immutability guard | add `approverId` to the SECOND ternary branch | KILLED | closed (guard rewritten, 4 tests) |
| | add `approverId` to the decide UPDATE | KILLED | closed |
| R-4 `requires_cab` | drop the `requires_cab` arm of the request filter | KILLED | closed |
| | CAB gate forced satisfied in the transition | KILLED | closed |
| R-5 sibling workflow | drop the type-to-workflow join alone | KILLED | closed (new test) |
| | same plus active-version binding | KILLED | closed |
| approver reach at request | dropped | KILLED | closed |
| approver side/kind | dropped | KILLED | closed |
| approver account (userId) | dropped | SURVIVED | layered: dropping it together with the reach check is KILLED (author's N10b) |
| R-6 project flag isolation | project flag lookup ignores `project_id` | KILLED | closed |
| Soft-delete exclusion | drop the lock-layer check only | SURVIVED | as the author says |
| | drop the key-load layer only | KILLED | now observable alone (the new soft-deleted decide/withdraw/list tests) |
| | drop both | KILLED | closed; decide, withdraw, list and inbox are covered |
| Compare-and-set | drop CAS only / drop both row locks only | SURVIVED / SURVIVED | as the author says |
| | drop locks AND CAS | KILLED | author's two-layer claim verified |
| Reminder-scan lock scope (O-2) | `FOR UPDATE OF approval` | present in the code; the author added a locking test | closed (not mutated by me) |

### 2. Thomas's decisions
Implementation read: `countingApprovalClause()` in repository.ts is applied by BOTH gate readers (`listApprovalsForWorkItemTransition` and `lockApprovalsForWorkItemTransition`). It counts only pending/approved/rejected approvals and excludes any approval for which a `transitioned` activity row with the same `payload.transitionId` and a later `created_at` exists. `transition-work-item.ts` now writes that payload. The domain (`COUNTING_STATES`) applies the same state filter. There is no column and no migration; the PATCH-state path writes a `transitioned` row without a payload, so it does not spend approvals (correct, it is not a workflow edge).

Mutations on the decisions:
| Mutation | Result |
| --- | --- |
| drop the spent filter from both readers / from the lock reader / `created_at <` instead of `>` / stop writing `payload.transitionId` | KILLED (gate-semantics "consumed by the transition it unlocked") |
| drop the spent filter from the offers (list) reader only | SURVIVED: gap, C-3c |
| any transition spends (transition-id match dropped) | SURVIVED: gap, C-3d |
| workspace condition dropped from the NOT EXISTS | SURVIVED: equivalent (work_item_id is unique) |
| withdrawn counted in the SQL filter only / in the domain only | SURVIVED each: layered, the author's claim holds |
| withdrawn counted in BOTH | KILLED ("a withdrawn approval is ignored") |
| expired counted in BOTH | KILLED ("an expired approval is ignored as well") |
| approval `created_at` written as the session-local wall clock | KILLED under Asia/Yangon and under America/New_York; SURVIVES in the UTC suite, as expected, so the two TZ files are non-vacuous |

### 3. Findings
No blocking findings.
- **C-1 (non-blocking, race): an approval request that waits behind a transition can be born spent.** `createApproval` stamps `createdAt = now` at the start of the service call, before it waits for the work-item lock. If a gated transition commits while the request waits, the transition's activity row is later than the approval's `created_at`, so the new approval counts as spent. Probe: hold the work-item lock, start the request, commit a `transitioned` row with the gated `transitionId` and release, then approve and transition. The transition returned 422 although the approval was created and approved after the run. Window is the duration of the lock wait, so rare, but it silently voids an approval. Fix: set `created_at` after the lock is held (or compare a sequence, not wall-clock times).
- **C-2 (non-blocking, decision for Thomas): a pending approval spent by a transition stays `pending` and decidable but no longer counts.** Probe, `any` policy: two approvals A1 and A2; A1 approved; transition runs; go back; A2 is still `pending`, a late approve returns 200, and the gated transition still returns 422. The approver gets a success and nothing happens, and A2 keeps appearing in inboxes and reminders. Either state-change spent pendings at transition time (for example expire or void them), refuse the decision with 409, or document it. Single use by activity row makes this unavoidable without one of those.
- **C-3 (non-blocking, residual test gaps):** (a) no test that a portal customer without `approval:decide` is refused; (b) no test for `/me/approvals` and `/portal/approvals` excluding requester-owned rows, and none for the customer own-rows filter on `GET /work-items/{key}/approvals`; (c) the transition offers list is not tested after consumption; (d) no test that an unrelated transition does not spend an approval.
- **C-4 (carried, author-acknowledged):** withdraw of an elapsed-but-unscanned approval returns 200 while decide returns 409; the lifecycle test is still one long `it`; single use is derived from activity (a `consumed_at` column would be the stronger form).

### 4. Merge and notification commit
- Merge 945a253a: `git diff b52e38bb 945a253a` over `apps/api/src/notification`, `database/repositories`, the S4 outbox suite and the S4 eligibility test is empty, so the merge changes no S4 file. The only conflict file, docs/07-planning/decision-log.md, has 89 added lines against b52e38bb, no deleted lines, and no conflict markers. S4's D10 entry is preserved.
- Commit 982f2b97 is self-contained: new `notification/approval-reach.ts`; additive edits to repository.ts, recipient-resolvers.ts, resource-contract.ts, fanout.ts (approval added to the registered types), the four read controllers (one predicate call each) and `task-reach.ts` (only an export); `current-eligibility.ts` adds the approval binding and the `workspaceId` argument, and its `work_item:read` check moves into a `canRead` variable with unchanged logic for non-approval resources; approval service and reminder scan switch to `enqueueNotificationEvent`. No producer or worker is added. docs/03-features/notifications.md is updated for pre-wiring gate (2).
- S4 tests changed only where the approval fail-closed assertion is superseded: `tests/api/notification-current-eligibility.test.ts` loses exactly the two `approval / approval.requested|decided` fail-closed rows (a 7-test approval describe is added), and the F4 fan-out test in `notification-outbox-suite.ts` now uses an unregistered type for the "no row" case and asserts that `approval` does write a row. strict-runtime-enforcement.test.ts gains the one approval policy line. Nothing else in S4's tests was edited; all 152 outbox tests pass in the three zones.

### Cleanup
- Container `s3-review-b-pg` stopped (`--rm`), `docker ps -a` shows 0 containers by that name; only that container was touched.
- My scratch directories c-export, c-mut and c-probe (export, mutation copy, probe copy) and the probe output are removed; only `c-logs/`, `mutc*.py` and `mutc*.out` of mine remain (other `c-*` entries in the scratchpad belong to other reviewers).
- /private/tmp/claude-501/s3: `git status --short` empty, HEAD 982f2b9787c1e06a4fff4ab494ed5ace263e3cd7. No edits, commits or pushes.

## Final closure at 72207e01

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: not exposed to this subagent (same independent review context as the sections above; I authored none of the change)
**Reviewed head:** 72207e01c7169348981028f00bb80ef6f9b81b24
Fresh `git archive` export of exactly this head (verified with `git rev-parse HEAD` in /private/tmp/claude-501/s3), `main`/`cand` git scaffold on b52e38bb for the baseline checks, one container `s3-review-b-pg` (postgres:18-alpine, `--rm --tmpfs /var/lib/postgresql`, port 55478).

### Verdict: APPROVE (ordinary closure). No blocking finding in this round's commit.
C-1, C-2 and C-3 (a to d) are closed by real tests, and every mutation I re-ran against the new tests is killed. I report one new, non-blocking finding (F-1) that is NOT introduced by this commit: the reminder-scan SQL depends on the database session time zone. It predates this round (the same expressions are in 2c6ade10) and no TZ test covers the scan.

### Counts (all exit 0, on the export)
| Check | Result |
| --- | --- |
| typecheck: apps/api 4 configs, domain, permissions | clean |
| unit: apps/api | 105 files, 771 tests |
| unit: packages/domain | 18 files, 640 tests |
| unit: packages/permissions | 14 files, 267 tests |
| `test:permissions` (turbo 5/5) and `check:route-policy` | 14 files, 88 tests |
| `check:openapi` | matches, 216 operations |
| `check:events` | 31 event keys, 465 source files, all registered |
| `check:vocabulary` | pass, 111 table declarations registered |
| `check:policy` | 8 policy files coherent |
| `biome ci .` | exit 0 (175 warnings, 1 info, no errors) |
| FULL integration suite (private `d_full_test` DB) | 166 files, 1981 tests, all passed |
| approval TZ files, run explicitly | approval-gate-ahead-utc (Asia/Yangon) 2/2, approval-gate-behind-utc (America/New_York) 2/2; approval-gate-semantics (UTC) 15/15; approval-closure-and-clock 12/12 |
| S4 outbox suite per zone | UTC 50, Asia/Yangon 51, America/New_York 51 = 152 tests, passed |

### 1. The C-items and my probes
My probes were throwaway tests in a copy of the export (never committed); results on the new head:
- **C-1 lock-wait race (re-run):** hold the work-item lock, start the request, commit a `transitioned` row stamped with the database clock, release, approve, transition. Create 200, transition after approve 200 (it was 422 at 982f2b97). Same result under Asia/Yangon. The fix reads: `approval.created_at` and the default expiry are stamped by `clock_timestamp()` (new `dbClockUtc()`) after the lock, and the transition's `transitioned` activity row uses the same clock. Test: "an approval request that waits behind a lock holder is not born spent".
- **C-2 spent pendings (re-run):** A1 and A2 pending, A1 approved, transition runs. States are `approved,expired`; the late decide on A2 returns 409; `/me/approvals` shows 0; one `approval.closed` audit row exists for A2 and its inbox rows are gone; the same edge is blocked again (422) until a new approval is approved (then 200). Same under Asia/Yangon. A request with only a rejected approval still returns 422. Test: "closes the other pending approvals of that transition".
- **C-3 a to d:** (a) portal customer without `approval:decide` refused: "a portal customer without approval:decide authority is refused"; (b) `/me` and portal lists exclude requester-owned rows, and the customer own-rows filter: two named tests; (c) offers list after consumption: "the offers list shows the gated edge blocked again after consumption"; (d) unrelated transition: "an unrelated transition neither spends an approval nor closes approvals of another transition". Plus two host-clock-skew tests, an inactive-identity 403 test and a no-customer-inbox-row test.

Mutations on the new tests (kill set: closure-and-clock, gate-semantics, tenant-checks, lifecycle, portal, notifications), all KILLED:
| Mutation | Killing test |
| --- | --- |
| Q1 closure never called | "closes the other pending approvals..." |
| Q2 closure ignores the transition id | "an unrelated transition neither spends..." |
| Q3 closure keeps inbox rows | "closes the other pending approvals..." |
| Q4 closure not audited | same |
| Q5 approval `created_at` on the application clock | lock-wait race and "host clock runs ahead cannot make approvals reusable" |
| Q6 transition activity on the application clock | "host clock runs ahead cannot pre-spend approvals raised afterwards" |
| Q7 spent filter ignores the transition id | "an unrelated transition..." |
| Q8 offers reader unfiltered | "the offers list shows the gated edge blocked again" |
| Q9 portal decide capability always true | "a portal customer without approval:decide authority is refused" |
| Q10 `/me` includes requested rows | "/me/approvals excludes approvals the caller only requested..." |
| Q11 customer own-rows filter removed | "a customer reading a work item's approvals sees only..." |
| Q12 resolver writes customer inbox rows | "no inbox row is written for a customer approver or requester" |

Two caveats on test depth, both disclosed by the author and agreed: the Q9 test strips the grant from a resolved identity and calls the capability function, because a customer without the grant cannot be built over HTTP (the customer grant is built into identity resolution); and the NB-13 line in the evidence middleware is not independently observable because the app-wide guard already answers 403 first.

### 2. Findings
No blocking findings.
- **F-1 (non-blocking, pre-existing, not covered by TZ tests): `reminder-scan` compares `timestamp without time zone` columns with `clock_timestamp()`, which is `timestamptz`.** In `selectDueApprovalRows` the expressions `expires_at <= clock_timestamp()` and the 50% and 90% reminder tests convert the clock to the database SESSION zone, while the columns hold UTC wall clocks (this commit's own writes are explicit UTC). Probe results, scan on one approval:
  - session UTC: approval overdue by 1 h expires (1 scanned, 1 expired); not-yet-due rows are not selected.
  - session Asia/Yangon (ahead): a row due in 1 h is selected (`scanned: 1000`, `expired: 0`): the batch loop re-selects the same unchanged row until `MAX_ROWS_PER_RUN`, so a run performs 1000 transactions and expires or reminds nothing early because the JS check disagrees. Overdue-by-1 h still expires.
  - session America/New_York (behind): an approval overdue by 1 h is NOT expired (`scanned: 0`, state stays `pending`); expiry and reminders lag by the zone offset.
  The code is identical at 2c6ade10, so the C-1 fix neither causes nor cures it; I did not catch it in my first round. Fix: use `(clock_timestamp() AT TIME ZONE 'UTC')` in the due-row SQL (the new `dbClockUtc()` helper fits), and add an approval-scan TZ file to the same pair of zones as the gate TZ suite. Deployments with a UTC database session are unaffected.
- **F-2 (observation, intended by Thomas's decision):** the closure uses the existing `expired` state with `decidedAt` set and no domain event, so the requester gets no notification that their other pending approvals were closed; the audit row `approval.closed` (reason `transition_ran`) is the only record.
- Carried from before and unchanged: withdraw of an elapsed-but-unscanned approval returns 200 while decide returns 409; the lifecycle test is one long `it`; single use is derived from activity (a `consumed_at` column would be the stronger form).

### Cleanup
- Container `s3-review-b-pg` stopped (`--rm`); `docker ps -a` shows 0 by that name; no other container touched.
- My scratch directories (export, mutation copy, probe copy) and probe output removed; `d-logs/`, `mutd*.py`/`mutd*.out` remain in the scratchpad.
- /private/tmp/claude-501/s3: `git status --short` empty, HEAD 72207e01c7169348981028f00bb80ef6f9b81b24. No edits, commits or pushes.


## Historical security Opus (verbatim)

Original report SHA-256: `cc2bf6e9bbed6477d29f23afd7a6f9f2aeeb75ae042cd35d1f7dbb7c7b1496ce`

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:3a9e9ce4-8409-47d4-b1be-1f1544697e70/s3-sec-opus (a fresh subagent context of that session; the platform exposes no separate agent id)
**Reviewed head:** 2c6ade1051a886f3ef5d0a56efb6a90d248138b0
**Verdict:** CLEAR WITH NON-BLOCKING (security). I found no blocking security finding. Cross-tenant isolation, approver authority, self-approval, credential handling and decision integrity all held under HTTP attack on a real database.

Two functional defects need an owner decision before merge. Both fail closed, so neither is a security block:
- **F1.** Customer portal decisions are unusable. Every customer gets 403.
- **F2.** Approval routes return 500 under strict policy enforcement. The strict-runtime commit at the review head is vacuous for approvals.

---

## Scope and provenance

- **Role.** Independent Sol-tier security review of slice S3 (approvals). I did not author, direct or remediate this slice. The model policy at the review head allows a fresh Claude Opus context in the Sol tier (`docs/04-engineering/agent-workflow.md` § Model policy, security-review-models block).
- **Candidate.** Branch `claude/s3-approvals`, worktree `/private/tmp/claude-501/s3`. I reviewed `2c6ade1051a886f3ef5d0a56efb6a90d248138b0` (commits 1–5).
- **Base.** main `7cf4bc1fe756d1c9008da7c383e4d9afcd147d4e`.
- **Held top commit.** `0ca539e7aebbff5ab302ebccefb2c0f35e3463ec` (notification delta). I only checked that it is self-contained. It touches `approval/{service,reminder-scan}.ts`, five `notification/*` files and two approval tests, and nothing else. I did not review it in depth.
- **Source PRs.** #589 `2350397b`, #603 `9ed99f24`.
- **Clean export.** `git archive 2c6ade10` into `scratchpad/s3-sec-export`, with dependency `node_modules` symlinked from the worktree. The vitest aliases resolve `@taskdesk/domain` and `@taskdesk/permissions` to the export's own source. `packages/` is identical between 2c6ade10 and 0ca539e7.
- **Worktree.** Never modified. All mutations ran in the export and were restored. I checked that the three mutated files match `git show 2c6ade10:<file>` byte for byte.
- **Database.** One disposable container, `s3-sec-pg` (postgres:18-alpine, PostgreSQL 18.6, `--rm --tmpfs /var/lib/postgresql`, 127.0.0.1:55477), database `sec_test`.
- **Author's report** (`/private/tmp/claude-501/s3-out.md`). I treated it as untrusted. Where I checked its claims, two are overstated (see F4).

## Authorities checked

- AGENTS.md, including do-not 13. S3 adds no identity-provider path to `instance:admin` or `sees_all`. The admin route reads only `user.role = 'admin'` plus an active staff person.
- rbac.md.
- approvals.md, as edited by this slice. The edits are backed by the three RELAYED entries that Thomas's 2026-10-10 decision confirms.
- Decision log, top entry: Thomas 2026-10-10, D5 narrow exception.
- m0120-approval-anchor.md § "S3 runtime checks" 1–10.

---

## Findings

### F1 — NON-BLOCKING (fails closed; functional defect). The portal decide route refuses every customer, so customer approvals can never be decided

- **Where:** `apps/api/src/approval/index.ts:538-546`. `hasApprovalCapability(identity, "approval:decide", target)` resolves to `can(..., "work_item", ...)` (`apps/api/src/approval/repository.ts:705-716`).
- **Root cause:** `packages/permissions/src/evaluator.ts:138-144` (`GRANT_SCOPES_FOR.work_item = ["instance","workspace","project"]`) never applies an organisation-scope grant, and the customer role is organisation-scoped (rbac.md:408).
- **Reproduction (X9):**
  - Setup: workspace re-homed to customer org X. Customer `cx` in org X has an admitted portal identity (org-scope `customer` role holding `approval:decide`). A staff member creates a customer approval addressed to `cx` (200).
  - `POST /api/portal/approvals/{id}/decide` as `cx` on host `portal.localhost:5174` returns **403 "Insufficient permissions"**. The approval stays `pending`.
  - The staff decide route is not mounted on the portal host (404). A customer session on the agent host gets 401.
  - Result: no path exists by which a customer approver can decide.
- **Security impact:** none. The defect fails closed.
- **Product impact:** customer approvals can never be decided. An item whose `requires_approval` gate depends on one stays blocked until the approval expires. AP-7 and the portal decision screen do not work.
- **Coverage gap:** the S3 tests contain **no portal test at all** (`grep portal tests/api-integration/approval-*.test.ts` finds nothing).
- **Fix direction:** gate the portal route on the `addressed_approval` predicate plus reach, as its policy declares (`policy.ts:57-60`). Alternatively, evaluate `approval:decide` at organisation scope for customers. Add an HTTP portal-decide test.

### F2 — NON-BLOCKING (fails closed; control coverage). Strict enforcement cannot cover approval routes, and the strict-runtime test change is vacuous

- **Where:**
  - `apps/api/src/approval/policy.ts:8-31,53-60` declares `scope: "work_item", scopeSource: "row"` and two portal predicates.
  - No middleware sets `workItemId`, `projectId`, `workspaceIdSource` or `policyScopeResource` for `/api/approvals/{id}/*` or `/work-items/{key}/approvals`, and none sets `portalPredicateSatisfied`.
  - As a result, `strict-policy-enforcement.ts:409-417` and `:546` call `refuse(500)`.
- **Reproduction (X10):**

  | Mode | list | create | decide | withdraw | me | admin withdraw |
  | --- | --- | --- | --- | --- | --- | --- |
  | `TASKDESK_POLICY_ENFORCE=apps/api/src/approval/policy.ts` | 500 | 500 | 500 | 500 | 200 | 200 |
  | Enforcement off | 200 | 200 | 200 | (409, already withdrawn) | 200 | 200 |

- **Commit `2c6ade10`** ("include the approval policy source in strict runtime enforcement"). It only adds the path to the env list in `tests/api-integration/strict-runtime-enforcement.test.ts:30`. That test calls no approval route, so it passes vacuously.
- **Consequence:**
  - `enforcement-config.ts` accepts `task/policy.ts` only when **every** other source is listed. Strict cutover of the task router therefore forces the approval source on and turns these routes into 500s.
  - Until then, approval routes rely on handler checks alone. Those checks held in every attack I ran.
  - Shadow-mode attribution for these routes is likely "failed provenance", which would pollute the P0 "issue-free buckets". I did not verify this.
- **Fix direction:** give the approval routes an evidence-setting middleware that loads the approval's work item and workspace from the row. Add a strict-mode HTTP test per approval route.

### F3 — NON-BLOCKING (spec silence; decision Thomas must make). One approved approval satisfies its gate again and again, and "all" gates can be permanently blocked

- **Where:**
  - `packages/domain/src/approvals/approvals.ts:78-89` (`isGateSatisfied`), used at `transition-work-item.ts:452,458` and `list-work-item-transitions.ts:128,131`.
  - Approvals are never consumed. Every terminal state stays in the matching set.
- **(a) Reuse (X7).**
  - Steps: one CAB approval is approved. The gated edge backlog→done runs (200). An ungated done→backlog edge runs. backlog→done runs **again with the same approval (200)**.
  - Attack: someone with `work_item:transition` obtains a CAB "deploy" approval once, then repeats the gated transition indefinitely after reopening, with no fresh CAB decision.
  - The from-state resolution adds pre-staging on top: request the approval while the item is in any state and use it later. That rule (not enforcing check 3's from-state sub-bullet) is spec-backed: "Approval requested on an already-completed item — Allowed".
  - Neither the spec nor AP-10 says whether an approval is single-use.
- **(b) "all"-policy griefing (X7).**
  - Steps: the gated transition is set to `approval_policy = 'all'`. Approval #1 is created and withdrawn. Approval #2 is created and approved. The transition still returns **422**, with the misleading reason code `approval.pending`.
  - Attack: any member holding `approval:request` (the `member` role has it) can create and withdraw one approval and permanently block an "all"-gated transition on that item. The block lasts until a new workflow version replaces the transition id.
  - AP-14 says that after expiry "A new one must be requested", which implies a new approval can satisfy the gate. Under "all" it cannot.
  - This fails closed (it is not an escalation), but it is an availability and integrity grief by a low-privilege insider.
- **Question for Thomas:** should withdrawn and expired approvals (and superseded rejections) be excluded from "all" matching, and is an approved approval single-use per transition execution? Under do-not 17 this needs a spec answer. Neither case is an authority bypass.

### F4 — NON-BLOCKING (test gaps; overstated author claims). Three runtime checks are not mutation-killed by the S3 HTTP tests

Each mutant was run against the three S3 integration files (14 tests). "Killed" means at least one test failed.

| Mutation | Result | Notes |
| --- | --- | --- |
| M1a: drop workspace filter, `listApprovalRows` | killed | check 1, repository-level test |
| M1b: drop workspace filter, `lockApproval` | killed | check 1 |
| M1f: drop workspace filter, `lockLiveWorkItem` | killed | check 1 |
| M1g: drop the cross-workspace reach gate in `loadApprovalTargetByApprovalId` | killed | 3 tests, HTTP 404 cases |
| **M2: drop the named-approver check** (`approvals.ts:240-242`) | **survives all 14 integration tests** | Killed only by the domain unit test `AP-7` (domain 1 failed / 78). Check 6's "non-approver" HTTP cases are the requester, who is also refused by `self_approval`, and an outsider, refused by reach. The author's claim that approver identity is covered by the same test is not true at HTTP level. My X3 ("other", a fully privileged CAB member in the same workspace who is not named) kills it. |
| M3: drop the transition-workspace join | killed | check 3 |
| M4a/M4b: drop decide/withdraw compare-and-set (`state='pending'` in the UPDATE) | **survive** | Shadowed by the parent-first `lockLiveWorkItem ... FOR UPDATE`, the `lockApproval FOR UPDATE` and the domain `not_pending` re-check under lock. My per-request-session race test (X6, 6 rounds of decide∥withdraw and approve∥reject∥approve) showed exactly one 200, one terminal event and 2 audit rows each round. The compare-and-set is redundant defence in depth. The author reports the same. |
| M5: drop the flag gate | killed | check 9 plus lifecycle |
| M6 (extra): drop the decide-time reach re-check | killed | |
| **M7 (extra): drop the create-time approver reach check** (AP-3; `service.ts`, `!approverIdentity \|\| !hasWorkItemReach(...)`) | **survives all 14** | Check 4's "other organisation's person" is in the same internal organisation and is refused earlier by the CAB-team check. No customer-kind test exists. My X9 (cross-org customer approver → 422 "outside the work item's reach") kills it. |

**Fix:** add a same-workspace non-named-approver HTTP case and a customer-kind cross-org approver case to the S3 security tests.

### F5 — NON-BLOCKING (low). Smaller observations

1. **Impersonation is mislabelled.**
   - `repository.ts:176` resolves every non-key caller as `credential: "session"`. An impersonation session (`session.impersonatedBy`) therefore decides approvals as the impersonated approver: X4 returned 200.
   - The impersonation plugin is not mounted today (`require-session-only.ts` comment), so this is unreachable now.
   - The admin route correctly refuses impersonation (403 `session_required`).
   - Recommend deriving the credential the same way `strict-policy-enforcement.ts:identityFor` does.
2. **Admin withdrawals are indistinguishable from requester withdrawals.**
   - The audit row (`service.ts:416`) records `actorId = admin person` and `workspaceId = approval's workspace` (X5). It does not mark the admin route or the "on behalf of" context. The decision log says "audited", and it is.
   - Not abusable beyond the spec: instance admin is instance-wide by design.
3. **`reminder-scan` locks more than it needs.**
   - It uses `FOR UPDATE SKIP LOCKED` with no `OF` clause (`repository.ts:80`). That locks the joined `work_item` **and `workspace`** rows for the batch transaction. This follows from PostgreSQL semantics; I did not reproduce it.
   - Concurrent FK inserts that take `FOR KEY SHARE` on the workspace row will wait. The scan skips approvals whose workspace row is key-share-locked, which can delay expiry and reminders in busy workspaces.
   - No security impact: decide re-checks `expiresAt` (409), and a pending approval never satisfies a gate.
   - Suggest `FOR UPDATE OF approval SKIP LOCKED`.
4. **Possible timing existence oracle.**
   - For an id in another workspace the server runs 2–3 queries; for an unknown id it runs 1.
   - Status and body are byte-identical (X1, 10 route/identity pairs). Ids are cuid2, so the attacker must already hold the id.
   - Inferred from code; not measured.
5. **CAB membership is checked before the lock.** `index.ts:430` evaluates `isCabTeamMember` before the transaction. A removal racing the decide could slip through. Negligible.

---

## Adversarial results that held (HTTP, real DB, `tests/api-integration/zz-opus-sec-s3.test.ts` in the export)

**Cross-tenant**
- **X1.** A workspace-B owner and a B approver holding every approval capability targeted A's approval id and an unknown id. On decide (approve), decide (reject), withdraw, portal decide and admin withdraw, both ids gave **identical status and body**: 404/404 "Approval not found", or 403 before any lookup on the portal and admin routes. Other results:
  - `/api/me/approvals` returns empty.
  - The A list returns 404.
  - A's `/transitions` returns 404.
  - The approval stays pending.
- **X2.** An A requester tried to attach B data:
  - Posting against B's work-item key: 404.
  - B's gated transition id: 422 "Transition not found".
  - B's approver: 422.
  - B's requester as approver: 422.
  - B's approver after being added to A's workspace (not on A's CAB team, no project reach): 422.
  - Zero approval rows were written.

**Authority**
- **X3.** Requester names self: 422 `self_approval`. Requester (CAB member) decides: 403. A fully privileged CAB member who is not named: 403 `not_named_approver`. Named approver removed from the CAB team: 403 `not_cab_member`. Named approver removed from workspace and project: 403. State stays pending throughout.
- **X4.**
  - Approver API key without the approval scope: decide 403.
  - Requester key without `approval:request`: withdraw 403, create 403.
  - Instance-admin API key on the admin route: 403 `session_required`.
  - Instance-admin impersonation session: 403 `session_required`.
  - Workspace owner who is not an instance admin, on the admin route: 403.
  - Admin key on the requester route: 403.
- **X5.** An instance admin with no membership in the workspace withdrew via the admin route: 200, audit written, `approval.withdrawn` outbox row has `workspace_id` = the approval's workspace. A later decide returns 409.
- **X9.** Cross-org customer approver: 422 (reach). Other-org customer on portal decide: 404, identical to an unknown id. Portal list: empty. Same-org unaddressed customer: 403. Customer on staff create (CAB or customer): 404 (route not on the portal host).

**Integrity**
- **X6.** Races described under F4. Decide after `reminder-scan` expiry: 409.
- **X7.** The approver without `work_item:transition` cannot use the approval to transition (403). An outsider gets 404. The approval does not trigger a transition by itself. **No privilege escalation through the gate.**

**Flag (D5)**
- **X8.** Flag off: create 404, while decide on an existing approval returns 200 (per spec and the 2026-10-06 relayed decision). A project-level `true` override re-enables creation for that project only.
- The flag code reads only the three `*_feature_flag` tables, keyed `feature.approvals`. No other code reads them.
- No route writes the flag tables, so a client cannot set the flag. Enabling it today means a direct database write by the operator.

**Events**
- At this head all approval events go to `outbox` only, with `workspace_id` and `scope.workspaceId` equal to the approval's workspace. Nothing goes to inbox or delivery (the author's check 8 passes, and I confirmed it in X5).
- Event keys and `reminder-scan` are registered in events.md and background-jobs.md.

## Spec-vs-review resolutions

1. **From-state rule not enforced.** This is consistent with approvals.md ("approve after the fact"). The gate still matches on the exact transition id, and the transition can only run from its from-state, so there is no added authority. It does enable pre-staging; see F3(a).
2. **Flag gates creation only.** This is consistent with approvals.md and the 2026-10-06 relayed decision, which Thomas confirmed on 2026-10-10. The 0120 review's "routes closed" is lower authority. There is no exploit: gates are never bypassed and existing rows follow current permissions and reach.

## Commands (summary)

- `git rev-parse 2c6ade10 0ca539e7 HEAD` → `2c6ade1051a886f3ef5d0a56efb6a90d248138b0`, `0ca539e7aebbff5ab302ebccefb2c0f35e3463ec` (HEAD).
- `git diff --stat 7cf4bc1f 2c6ade10` (37 files) and `git diff --stat 2c6ade10 0ca539e7` (9 files).
- `git archive 2c6ade10 | tar -x -C scratchpad/s3-sec-export`, with node_modules symlinks.
- `docker run -d --rm --name s3-sec-pg --tmpfs /var/lib/postgresql -e POSTGRES_PASSWORD=… -p 127.0.0.1:55477:5432 postgres:18-alpine`, then `createdb sec_test`.
  - Port 55433 was taken by `s4-review-b-pg`, so the first `run` failed before start. I touched no other container.
- `env -u CI TASKDESK_DATABASE_URL=…/sec_test npx vitest run --config vitest.integration.config.ts` on:
  - the three S3 files: 3 files, 14 passed;
  - plus mine: 4 files, 24 passed.
- Unit tests:
  - `tests/api/approval/immutable-columns`, `tests/api/permissions/query-ownership-repository`, `tests/api/scheduler/reminder-scan-schedule`: 3 files, 5 passed.
  - `packages/domain src/approvals`: 79 passed.
  - `packages/permissions src/features.test.ts`: 2 passed.
  - `vitest.permissions.config.ts`: 83 passed, 5 failed. All 5 are git-history ratchets (`git-baseline`, `route-coverage`/`better-auth-plugin-list` "shrinking" checks) that fail because the export has no `.git`. Environmental, not a candidate defect.
- Strict probe: same suite with `TASKDESK_POLICY_ENFORCE=apps/api/src/approval/policy.ts` (F2).
- Mutations: `scratchpad/mut/mutate.py` and `run.sh`, 11 mutants, results in F4. Originals restored and verified against `git show 2c6ade10:<file>`.
- My test file SHA-256: `8a3bbceb9b80f4b85298a322553823b0d00d249256ce830dfdfc0a7b62f38f15` (export only; not in the candidate).

## Residual risk

- `transition_id`, `requested_by` and `approver_id` have no database anchor. The runtime checks are present and now mostly mutation-killed. M2 is killed only at the domain layer, and M7 only by my test, not the candidate's (F4).
- F2 means approval routes cannot join strict enforcement, so their safety rests on handler code alone.
- F3 reuse and pre-staging weaken the CAB control's "per change" intent until the spec decides.

## Not checked

- The held commit `0ca539e7` notification fan-out: recipient resolution, preferences and delivery. I confirmed only that it is self-contained.
- Shadow-mode logging and attribution for approval routes.
- Web UI and OpenAPI contract diffs (`tests/api-contract/openapi.json`, +1573 lines), except where they reflect the routes reviewed.
- The full integration suite (153 files), typecheck and biome. I ran only the S3 approval files plus my own.
- Timing measurements (F5.4) and the `reminder-scan` lock-skip behaviour (F5.3). Both are inferred, not reproduced.
- Real better-auth portal login. Sessions were mocked in the repository's test pattern, with an admitted customer identity.
- Delegates: the spec defines none.

---

## Closure at 982f2b97

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:3a9e9ce4-8409-47d4-b1be-1f1544697e70/s3-sec-opus (same fresh review context as above; it did not author, direct or remediate any S3 commit)
**Reviewed head:** 982f2b9787c1e06a4fff4ab494ed5ace263e3cd7
**Verdict:** CLEAR WITH NON-BLOCKING (security). F1, F2, F3 and F4 are closed. Most of F5 is closed. There are no blocking findings.

### What the head is

`982f2b97` is built in three parts:
- Remediation `b51477cd`, on main `7486809f` (S2).
- Merge `945a253a` of main `b52e38bb` (S4).
- The notification commit `982f2b97`.

The authority for the gate changes is the decision log entry Thomas, 2026-10-10, "single-use approvals, withdrawn approvals ignored". I read it at this head. It also states that expired approvals do not count.

Clean export: `git archive 982f2b97` into `scratchpad/s3-final`. The worktree was never modified. I checked all six mutated files byte for byte against `git show 982f2b97:<file>` after restore.

### Per-finding status

**F1 (customer decide): CLOSED.**
- The addressed customer now decides through the portal (200).
- Attacks, all HTTP on the portal host (X11, X9). Each approval stays `pending`:

  | Attack | Result |
  | --- | --- |
  | Approval row forged in the DB, addressed to a customer of another organisation (models a creation-path bug) | 403 |
  | Customer deciding a CAB approval addressed to staff | 403 (404 under strict) |
  | Forged `kind = cab` row addressed to the customer | 403 |
  | Another customer of the same organisation | 403 (404 under strict) |
  | Addressed customer on a private item they cannot see | 403 |
  | Other-organisation customer, by id | 404, the same as an unknown id |
  | Staff session on the portal route | 401 on the portal host, 403 on the agent host |
  | Customer on staff routes | 404 (not mounted on the portal host) |

- Notes:
  - The customer grant is built in (`resolve-identity.ts`, "KNOWN GAP 5"). A database role without `approval:decide` does not remove it. That is the documented design, not a defect of this change.
  - The organisation-scope check (N1 in the mutation table) is redundant with the reach re-check. A customer's built-in grant is scoped to their own organisation, and customer reach requires that same organisation. So no state exists where N1 alone is observable. It is killed only when combined with M6 (my X11).

**F2 (strict mode): CLOSED.**
- `approval/evidence.ts` publishes evidence only from the persisted row: the approval's anchored `workspace_id` and its work item and project. It reads only path params and the session, never the body or query.
- An unreachable or foreign approval id gives a 404 inside the middleware, before strict evaluation. This is the same 404 the handler gives.
- The portal predicate requires all three of: a customer identity, `kind = customer`, and `approverId` equal to the caller.
- I found no way to make the middleware publish another tenant's evidence:
  - `/work-items/{key}` publishes the key's own row. Reach is then enforced by strict policy and by the handler.
  - The middleware ignores the API key when it resolves the identity for lookup. Reach does not depend on the key, and capability is still clamped by strict `identityFor`.
- Under `TASKDESK_POLICY_ENFORCE=apps/api/src/approval/policy.ts` my 13-case suite results:
  - Every route works for the right caller (X10: list 200, create 200, me 200, decide 200, admin withdraw reached).
  - Every cross-tenant, unaddressed or unscoped call is refused (404, or 403 Forbidden).
  - The only difference from enforcement off: unaddressed portal decides are refused as 404 instead of 403.
- The author's `approval-strict-enforcement.test.ts` kills the evidence-predicate mutation (N2b).

**F3 (Thomas 2026-10-10): CLOSED as decided, with residuals.**
- **Single-use.** X7: one approval, run, back, rerun gives **422**. The author's suites pass in UTC, Asia/Yangon and America/New_York. N3 is killed by 3 tests.
- **UTC binding.** Both sides use the application clock and `timestamp without time zone`. Both write JS `Date` values through drizzle, so the stored value is a UTC wall clock regardless of process or session timezone.
  - `approval.created_at` is the `now` taken at the start of `createApproval`.
  - `activity.created_at` comes from `recordWorkItemActivity`'s `new Date()`.
  - Neither row relies on `DEFAULT now()`.
  - The only `transitioned` writer that runs is `transition-work-item.ts`. The diff-activity builder never receives a `stateId`, and no other path changes state.
- **Withdrawn and expired are ignored.**
  - X7: withdrawn + approved under `all` gives **200**.
  - X12: rejected + approved under `any` gives 200.
  - Each layer alone survives; both together are killed (see N4 below).
- Residuals: see N-A and N-B.

**F4 (test gaps): CLOSED.**
- M2 (named-approver check) is now killed at HTTP level: "a second CAB member ... cannot decide".
- M7 (create-time approver reach) is now killed: "the approver's reach on the work item is checked when the request is made".
- M4a and M4b (compare-and-set) still survive. They are shadowed by the parent-first row locks. My X6 races re-ran correctly at this head: one winner, one event and 2 audit rows per round. Redundant defence in depth; accepted.

**F5:**
- **(1) Impersonation: OPEN, NON-BLOCKING.** It is still unreachable because the plugin is not mounted.
  - The approval handlers still resolve `credential: "session"` (`repository.ts:182`), so an impersonated approver's decide returns 200 (X4).
  - The new `resolveRequestIdentity` covers the strict path only.
- **(2) Admin audit marker: CLOSED.** The admin withdrawal audit records `via: admin_route` and `onBehalfOfPersonId`.
- **(3) Reminder-scan locking: CLOSED.** It now uses `FOR UPDATE OF approval SKIP LOCKED`.
- **(4) Timing oracle: unchanged, low.**
- **(5) CAB membership checked before the lock: unchanged** (`index.ts:442`), negligible.

### Notification commit

- **Inbox read predicate** (`approval-reach.ts`) is applied on list, single read, read-all and clear-all.
  - An approval row is readable only if all of these hold:
    - the approval exists under its composite `(workspace_id, work_item_id)` anchor;
    - the work item and project are live;
    - the recipient is the approver, requester or a watcher;
    - private visibility allows the recipient;
    - the recipient is an active staff person with current project reach.
  - X13: a forged inbox row in B's approver's inbox pointing at A's approval:
    - is not listed;
    - single read returns 404;
    - read-all and clear-all leave it untouched (consistent with D10).
  - X13: A's approver loses project membership, and their row disappears.
  - N5 (predicate replaced by "any approval row") is killed by 2 tests.
- **Send-time eligibility.** The recipient resolver and `current-eligibility.ts` both read the approval via `findApprovalNotificationContext(id, event/delivery workspace)` and require an exact workspace match. They also enforce:
  - requested and expiring notices go out only while the approval is `pending`;
  - each event kind goes to its addressed recipient;
  - the approver must still be valid: active, not a placeholder, with an account, and for CAB still on a CAB team in this workspace;
  - reach is checked;
  - customers are notified only as approver or requester, and customer watchers are excluded.
- **`destination_unresolved` and S4's back-off.** This path is unreachable for approvals today. The resolver emits `channels: []`, so no `notification_delivery` row is ever written. A DB count after an approval run: 14 approval inbox rows, **0** delivery rows, 14 approval outbox rows.
  - Hence no starvation and no interaction with the F2 back-off.
  - If channels are ever added, every such delivery would cycle forever at `NOTIFICATION_UNRESOLVED_BACKOFF_MS`, because `staffUrl` is null. Claims are ordered by `next_attempt_at`, so there would be no head-of-line block, but the rows would never finish (N-C).
- **Cross-tenant leakage through the inbox.** None found. Rows exist only for validated persons of the approval's workspace. Reads re-check reach. Titles and bodies are generic and contain no ids or email.

### Mutation set at 982f2b97

Target: the 10 `approval-*` integration files, 51 tests. Domain mutants were also run against `packages/domain` (82 tests).

| Mutant | Result | Killed by / reason |
| --- | --- | --- |
| M1a `listApprovalRows` workspace filter | killed (1) | |
| M1b `lockApproval` workspace filter | killed (1) | |
| M1f `lockLiveWorkItem` workspace filter | killed (1) | |
| M1g by-id reach gate | killed (3) | |
| M2 named-approver check | **killed** (1, HTTP) | now covered at HTTP level |
| M3 transition-workspace join | killed (1) | |
| M4a decide compare-and-set | survives | shadowed by row locks |
| M4b withdraw compare-and-set | survives | shadowed by row locks |
| M5 flag gate | killed (3) | |
| M6 decide reach re-check | killed (2) | |
| M7 create-time approver reach | **killed** (1) | now covered |
| **N1** drop the organisation-scope check | survives | Redundant with the reach re-check (see F1). Killed by my X11 when combined with M6. |
| **N2a** drop the addressed predicate in the handler | survives | Layered: the domain `not_named_approver` check refuses it. |
| **N2b** drop the addressed predicate in the evidence | killed (1, strict test) | |
| N2a+N2b | killed (1) | |
| **N3** drop single-use | killed (3, including both TZ suites) | |
| **N4a** count withdrawn again, repository filter | survives | layered |
| **N4b** count withdrawn again, domain filter | survives in integration | killed by the domain unit test |
| N4a+N4b | killed (1) | |
| **N5** drop the inbox approval-reach predicate | killed (2) | |

My suite (`zz-opus-sec-s3.test.ts`, 13 tests, SHA-256 `dcb562119e916166c6db4557fb48a4e182ceeec67c6190d037933d3e81afdecb`, in the export only) passes at this head, both with enforcement off and with strict on. Under strict, the only failure is my own over-specific 403 assertion where the result is 404.

### New findings (all NON-BLOCKING)

- **N-A — single-use depends on clock agreement between API hosts.**
  - Where: `repository.ts:440-458` (`countingApprovalClause`). It compares the app-clock `activity.created_at` with the app-clock `approval.created_at`.
  - If the host that served `createApproval` runs ahead of the host that runs the transition by Δ, an approval stays unspent until a run occurs more than Δ after its recorded creation.
  - X12 modelled Δ = +60 s: run, back, rerun with the same approval gave **200, 200, 200**, so the approval was reused.
  - With NTP the window is milliseconds and needs a full run, back and rerun inside it. Risk is low, but the guarantee is clock-dependent.
  - The reverse case fails closed. `createApproval` captures `now` before it waits on the work-item lock. A request that overlaps a run of the same transition is stored as created before that run, so it is silently spent: it can be approved but never satisfies the gate. That matches the decision's wording ("raised before"), but it is a usability trap.
  - Fix direction (the author already flags it): a `consumed_by_activity_id` or `consumed_at` column set in the transition transaction, or comparing database `clock_timestamp()` and `activity.seq`, removes both.
- **N-B — legacy-shape `transitioned` rows never spend.**
  - X12: stripping `payload.transitionId` from a run's activity makes the approval reusable.
  - No current writer produces that shape for a gated run. Gated runs were impossible before S3, so existing legacy rows cannot matter.
  - This becomes live only if a future transition writer omits the payload. A machine guard would help, for example an assertion or test that every `transitioned` write carries `transitionId`.
- **N-C — future approval deliveries would never terminate.** Covered above. Not live while `channels: []`.
- **N-D — "all"-policy grief is now bounded, not gone.**
  - A withdrawn approval no longer blocks (fixed).
  - Under Thomas's decision a pending or rejected approval still counts. X12: an undecided extra approval blocks an `all` gate (422) until an instance admin withdraws it (200) or it expires (up to the 90-day cap). After withdrawal the transition passes (200).
  - The requester can withdraw their own, so this is grief only by the requester against others.
  - Under `any` there is no blocking.
  - This is per the decision; I list it only so the residual is visible.

### Commands

- `git rev-parse HEAD` returned `982f2b9787c1e06a4fff4ab494ed5ace263e3cd7`. I also ran `git log`, the diffs `2c6ade10..b51477cd`, `b52e38bb..982f2b97` and `2c6ade10..982f2b97` on the approval files, and read the decision-log entry.
- `git archive 982f2b97 | tar -x -C scratchpad/s3-final`, with `node_modules` symlinked.
- `docker run -d --rm --name s3-sec-pg --tmpfs /var/lib/postgresql -e POSTGRES_PASSWORD=… -p 127.0.0.1:55491:5432 postgres:18-alpine`. Port 55477 was held by `s3-review-b-pg`, which I did not touch. My failed create was removed by name only. The container is now stopped and auto-removed.
- Test runs (`env -u CI TASKDESK_DATABASE_URL=…/sec_test npx vitest run --config vitest.integration.config.ts …`):

  | Suite | Result |
  | --- | --- |
  | `approval-*`, `notification-*`, `strict-runtime-enforcement` | 16 files, 224 passed |
  | My suite, enforcement off | 13 passed |
  | My suite, strict on | 12 passed, plus the one over-specific assertion |
  | `packages/domain` approvals | 82 passed |
  | `tests/api/approval` + `notification-current-eligibility` | 2 files, 51 passed |

- Mutations: `scratchpad/mut2/{mutate.py,run.sh}`, 20 mutants against the S3 files and 4 against my suite. All originals restored and verified.
- DB count: `select count(*)` over approval `notification`, `notification_delivery` and approval `outbox` rows gave 14 | 0 | 14.

### Residual risk

- `transition_id`, `requested_by` and `approver_id` still have no database anchor. The runtime checks are mutation-killed, except the compare-and-set and the redundant organisation-scope check.
- Single-use is derived from timestamps (N-A, N-B), not from an explicit consumption link.
- The impersonation credential is mislabelled on the approval routes (F5(1)). This is latent until impersonation is mounted.
- The 90-day "all"-gate block by a requester-created pending approval (N-D) is decided behaviour.

### Not checked

- Full integration suite (165 files), tsc, biome and openapi checks. I ran only the suites listed.
- The S2/S4 code merged into this head, beyond the approval touch points.
- Real better-auth portal login (sessions were mocked).
- Real multi-host clock skew. It was modelled by shifting `created_at`.
- Timing measurements.

---

## Final closure at 72207e01

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:3a9e9ce4-8409-47d4-b1be-1f1544697e70/s3-sec-opus (same independent review context; it did not author, direct or remediate S3)
**Reviewed head:** 72207e01c7169348981028f00bb80ef6f9b81b24
**Verdict:** CLEAR WITH NON-BLOCKING (security). Lightweight exact-head closure of `git diff 982f2b97..72207e01`. I found no blocking finding.

### Adversarial review of the delta

**1. Close-on-transition abuse.**
- **Where:** `closePendingApprovalsOnTransition` (`service.ts`).
- **When it runs:** only inside `transitionWorkItem`, after the gate is evaluated and only for a gated edge (`requiresApproval || requiresCab`), in the same transaction under the work-item `FOR UPDATE` lock.
- **Who can trigger it:** only someone who can run that gated transition. That means:
  - the route policy `work_item:transition` (the `member` role and above);
  - reach on the item;
  - a gate already satisfied by approved approvals under the transition's policy.
- **Attack surface:** an attacker who wants to wipe other people's pending approvals must first legitimately pass the gate. They can only close approvals that are all of:
  - for that same transition id;
  - on that work item;
  - in that workspace;
  - still pending.

  That is exactly Thomas's decision.
- **Tests:**
  - A viewer cannot transition (403), so a viewer cannot trigger a closure (X14).
  - A run on item B leaves another transition's pending approval and another workspace's pending approval untouched (X14).
  - A run on item 1 leaves item 2's pending approval for the same transition untouched (X15, new).
- **Policy effect:** with an `any` gate, one approved approval lets a transitioner close everyone else's pending approvals for that edge. That is the decided behaviour, not a bypass.

**2. DB clock (N-A): the skew window is removed.**
- The two stamps that are compared are now both `clock_timestamp() AT TIME ZONE 'UTC'` from the single database, and both are taken after the work-item lock:
  - `approval.created_at`, written inside `createApproval`'s transaction after `lockLiveWorkItem`;
  - the transition's `transitioned` activity row, written under the same lock.
- Their order therefore follows lock order, and the API host clocks no longer matter.
- **Test (X14):** I faked the creating host's JS clock 60 s ahead with `vi.useFakeTimers`. Run, back, rerun gave **200, 200, 422**, so the approval was spent. At 982f2b97 the same scenario gave 200 ×3.
- **Also fixed:** the lock-wait race that silently spent a concurrent request. Its `created_at` is now taken after the lock.
- **Remaining theoretical edge:** a backward step of the database host's own clock between two lock holders. Negligible.
- My X12 still shows reuse when `created_at` is written directly to the DB. That is a forged row, not a reachable path.

**3. The `approval.closed` audit row.**
- It is registered in `AUDIT_ONLY_ACTIONS`.
- One row is written per closed approval, in the transition transaction. It records:
  - the approval's workspace and project;
  - `before: pending`;
  - `after: { state: "expired", reason: "transition_ran", transitionId }`.
- **No leakage:** the row carries no person, email or other-tenant data. Inbox rows are deleted by approval id only. No domain event is emitted, which is by design.
- **Consistency nits (non-blocking), seen in X14:**
  - **NB-F1:** `actorId` is the transitioning **user id**, inherited from the transition route's audit convention (`work_item.transitioned` does the same). Every other `approval.*` audit row uses the **person id**, so a query that joins approval audit actors to `person` misses closures.
  - **NB-F2:** `organisationId` is null, while the other `approval.*` rows set it. An organisation-scoped audit read would not show closures.

**4. Other delta items.**
- **NB-13:** an inactive session now gets 403 from the evidence middleware, consistent with the app-wide guard.
- **NB-14:** the resolver writes inbox rows for staff only. Customer approvers are served by the portal list. This is consistent with the read predicate, so there are no dead rows.
- Default expiry is now computed in SQL on the same database clock. A body-supplied `expiresAt` is still validated against the app clock (±skew relative to the 90-day cap). Harmless.

### Findings

- **NEW NB-F3 (test gap):** removing the closure's `workspace_id` / `work_item_id` filter (N8) **survived all 65 author approval tests**. With that mutant, a gated run on one item would close the pending approvals of the same transition on every other item using that workflow version. Transition ids are workspace-bound at create time, so the effect stays inside one workspace.
  - **Code at head:** correct (X15).
  - **Fix:** add a two-item same-transition test, as in my X15, which kills N8.
- **NB-F1 / NB-F2:** as described in item 3.
- **Carried:**
  - F5(1) impersonation is still mislabelled on the approval routes (latent).
  - N-B (legacy-shape activity rows) and N-D (a pending approval can block an `all` gate) are documented in approvals.md "Implementation residuals (S3)".
  - N-C: no delivery rows exist while approval recipients carry no channels.

### Mutations at 72207e01

Target: the `approval-*` integration files, 65 tests.

| Mutant | Result |
| --- | --- |
| N6 drop closure | killed (3) |
| N7 closure ignores transition id | killed (1) |
| **N8 closure ignores workspace and work item** | **survives** the author tests; killed by my X15 |
| N9 `created_at` back on the app clock | killed (1) |
| N10 closure keeps inbox rows | killed (1) |
| N3 drop single-use | killed (6) |
| M2 named-approver check | killed (1) |
| N5 inbox approval-reach predicate | killed (2) |
| N2b evidence addressed-predicate | killed (1) |
| M1g by-id reach gate | killed (3) |
| M3 transition-workspace join | killed (1) |
| M7 create-time approver reach | killed (1) |
| N4a+N4b count withdrawn again | killed (1) |

All originals were restored and verified byte for byte against `git show 72207e01:<file>`.

### Commands

- `git rev-parse HEAD` returned `72207e01c7169348981028f00bb80ef6f9b81b24`. I reviewed `git diff 982f2b97..72207e01` (15 files).
- `git archive 72207e01 | tar -x -C scratchpad/s3-72207`, with `node_modules` symlinked.
- `docker run -d --rm --name s3-sec-pg --tmpfs /var/lib/postgresql -e POSTGRES_PASSWORD=… -p 127.0.0.1:55491:5432 postgres:18-alpine`, then `createdb sec_test`. The container is stopped and auto-removed. No other container was touched.
- `env -u CI TASKDESK_DATABASE_URL=…/sec_test npx vitest run --config vitest.integration.config.ts` over `approval-*`, `notification-*`, `strict-runtime-enforcement` and my suite: **18 files, 253 passed**.
- My suite under `TASKDESK_POLICY_ENFORCE=apps/api/src/approval/policy.ts`: 14 passed and 1 failed. The failure is my own over-specific 403 assertion; strict mode gives the stricter 404.
- My suite: `zz-opus-sec-s3.test.ts`, 15 tests, export only, SHA-256 `0102e824c7fadb2f77c3e951866d43c166f30690a1d62ccd925d6cc49eb32a2a`.
- Mutations: `scratchpad/mut3/{mutate.py,run.sh}`.

### Not checked in this round

- The full integration suite, tsc and biome.
- The docs-only parts of the delta, beyond the decision-log, approvals.md and audit-trail.md entries.


## Current ordinary delta (verbatim)

Original report SHA-256: `43bde428e8ce90065a42dc330727abf8dc680b79688e35e30abd68e59fa9f627`

# PR 635 ordinary review — approval clock delta

**Model:** GPT-6 (fresh independent review subagent; no inherited author/fixer context)
**Role:** Ordinary reviewer, focused on the delta from the previously reviewed S3 source
**Candidate:** `c9a32be7ed02f7fd3d6ec0c2d2bc49a7d0ccc4b9`
**Comparison base:** accepted `origin/main` `a96e6a4c23d1da35be6a66dc5a043328d884f751`
**Worktree:** `/private/tmp/claude-501/s3`, clean at candidate SHA

## Scope and tier

The product delta unique to S3 after its authentic source closures is `72207e01c7169348981028f00bb80ef6f9b81b24..3bfd3cb6348fcc57c0f48493d47e44c77e1e338b`, principally the reminder scan's UTC predicate and the closure audit actor/organisation enrichment, with regression tests and contract/document updates. Candidate `c9a32be7` then merges accepted main `a96e6a4c`; its other product changes are the already-accepted PR #630 auth-admin-route refusal, which I treated as imported accepted-main work, not as new S3 source.

This is a bounded approval correctness fix: the old `clock_timestamp()` predicate implicitly coerced UTC `timestamp without time zone` values through the Postgres session timezone, so expiry/reminder behavior could be early or late. It does not redesign authority, permissions or the gate model. The delta therefore needs one strong Luna-tier ordinary review plus the required current security-tier review for the approval/auth security-scope code. The existing two ordinary closures cover the larger S3 source at 722; they do not cover this clock delta. This review supplies the needed ordinary delta coverage. It does not replace the independent Sol-tier review already assigned to another context.

## Authentic historical coverage and provenance

I traced the original ordinary reports to the source session's subagent transcripts, not just the scratchpad reports:

- `agent-ae6bfa344c77605cb` was prompted as independent ordinary reviewer A (Claude Sonnet, fresh context, static/read-only). Its transcript final message points to `s3-review-a-sonnet.md`; the transcript contains the closure at exact head `72207e01c7169348981028f00bb80ef6f9b81b24`, verdict **CLEAR WITH NON-BLOCKING**. The closure scope was the 982f2b97→72207e01 delta.
- `agent-a48646b852cf016a7` was prompted as independent ordinary reviewer B (Claude Sonnet, fresh context, runtime/test adequacy). Its transcript final message points to `s3-review-b-sonnet.md`; the transcript contains the closure at exact head `72207e01c7169348981028f00bb80ef6f9b81b24`, verdict **APPROVE**. It executed integration/runtime probes on a clean export and recorded the exact SHA.
- `agent-a2c53527c01a4b215` was prompted as independent security reviewer (Claude Opus 5.5). Its transcript final message confirms a **CLEAR WITH NON-BLOCKING (security)** closure at exact head `72207e01c7169348981028f00bb80ef6f9b81b24`.

The report files are in the original session scratchpad at `/private/tmp/claude-501/-Users-heinthura-Documents-Workfolder-Development-Ticketing-v2/3a9e9ce4-8409-47d4-b1be-1f1544697e70/scratchpad/`. The reports' model, scope and verdict agree with their respective source transcripts. Historical findings/residuals remain as recorded there; this review does not rewrite them.

## Review performed

Commands and evidence:

- `git rev-parse HEAD`, `git rev-parse origin/main`, `git log --graph`, `git diff --name-status 72207e01 c9a32be7`, and explicit source diff `git diff 72207e01 3bfd3cb6 -- <changed code/tests/docs>`.
- Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/07-planning/active-mission.md`, `docs/04-engineering/ci-cd.md`, the S3 approval contract and clock helper.
- Read the source test additions for Asia/Yangon and America/New_York, including the shared suite assertions for overdue, halfway, 90%, already-reminded, fresh and idempotent scans.
- Inspected the already-existing full integration receipt `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/s3-clock-repair-full-integration-3bfd3cb6.log`: Vitest reports **168 files and 1,984 tests passed** at 3bfd3cb6. This is existing evidence; I did not rerun the suite or a database probe.
- `git diff --check 72207e01 3bfd3cb6` passed (no output).
- Inspected current GitHub PR #635 metadata. At inspection, `pull request template + security review` was red because the current security review fields were pending; required CI checks were still running. This is a gate status, not a code finding.

No repository files were edited. No tests or DB workloads were started.

## Findings

No blocking or non-blocking correctness finding in the reviewed delta.

The predicate change uses `dbClockUtc()` consistently for expiry and both reminder thresholds. The helper produces `(clock_timestamp() AT TIME ZONE 'UTC')`, matching the schema's UTC `timestamp without time zone` values and avoiding session-zone coercion. The selected `now` remains a single DB clock instant used for state writes, audit/event timestamps and domain threshold decisions, keeping the locked row's scan outcome internally consistent. The two independent-zone integration files configure both Node `TZ` and Postgres `PGOPTIONS` before the suite's first DB operation; their shared assertions distinguish expiration from the 50% and 90% reminder paths and check repeat-scan idempotence.

The closure audit enrichment converts the transition route's user id to the approval audit convention's person id and derives organisation scope from the exact workspace. This is consistent with the caller contract and persisted audit fields. The added regression assertions check actor id/type and organisation/workspace scope. The cross-work-item regression keeps the update anchored by workspace, work item, transition and pending state, and demonstrates another item's same-transition approval remains decidable.

The code and test assertions support the stated behavior. I found no lock-order change, widened update scope, cross-tenant lookup, or event-consumption regression in this delta. The source S3 closures remain valid for the unchanged source, while this exact-head review covers the additional delta.

## Verdict

**CLEAR WITH NON-BLOCKING** for the ordinary review of the 722→3bfd clock/audit delta at candidate `c9a32be7ed02f7fd3d6ec0c2d2bc49a7d0ccc4b9` against accepted main `a96e6a4c23d1da35be6a66dc5a043328d884f751`.

This verdict does not satisfy the separate required security review or current GitHub status checks. The security-tier review and the currently red PR-template/security-review check remain outstanding at the time of inspection.


## Current security delta (verbatim)

Original report SHA-256: `3d20fdfd19b243e3f0ef44d505df1090d7f2d59f7bd471d64c10307207fec841`

# PR #635 independent security review — S3 approval delta

**Model:** GPT-6 Sol (as dispatched for this reviewer role; runtime model identifier is not exposed inside this subagent)
**Role/context:** Fresh independent security reviewer; `fork_turns=none`; no authoring, direction, remediation, delegation, repository edit, GitHub comment, or merge.
**Reviewed head:** c9a32be7ed02f7fd3d6ec0c2d2bc49a7d0ccc4b9
**Comparison base:** accepted `origin/main` a96e6a4c23d1da35be6a66dc5a043328d884f751
**Product delta after earlier S3 closure:** 72207e01c7169348981028f00bb80ef6f9b81b24 → 3bfd3cb6348fcc57c0f48493d47e44c77e1e338b. The candidate merge 3bfd3cb6 → c9a32be7 imports only the already accepted main PR #630 auth-admin-route refusal (four files); I did not claim a new review of #630.

## Verdict

**CLEAR WITH NON-BLOCKING** for the current S3 security delta and its approval/notification integration seams. No new blocking or non-blocking finding in that delta. The previously disclosed S3 residuals remain as disclosed below. This verdict is source/security review, not a claim that required CI or runtime acceptance has completed.

## Scope and findings

I read the accepted `AGENTS.md`, active mission, canonical workflow and CI security scope, the approval and audit feature contracts, the earlier ordinary and Opus review reports, and the actual source and tests. The source change after 722 is nine files: approval reminder predicate, closure audit metadata, two timezone test entry files, shared scan tests, a two-item closure regression and docs. `git diff --check 72207e01..3bfd3cb6` passed. I inspected the 3bfd→c9 merge diff and the Git graph to distinguish imported accepted-main work from S3 changes.

**Reminder clock and expiry.** `approval.created_at` and `expires_at` are UTC wall-clock `timestamp without time zone` values. `selectDueApprovalRows` now compares expiry, 50%, and 90% thresholds with `dbClockUtc()` = `clock_timestamp() AT TIME ZONE 'UTC'`, so PostgreSQL does not reinterpret the stored UTC value under the session timezone. The selected `row.now` remains the database instant used by `isApprovalOverdue`, `dueReminder`, state stamps and expiry event/audit time. Selecting a row shortly before a threshold and processing it just after can produce a due action, which is safe; a threshold crossed just after selection waits for the next scan. The scan locks approval rows with `FOR UPDATE OF approval SKIP LOCKED`, bounds each run and only updates still-pending rows. I found no expanded authority or cross-tenant query in this change. New Asia/Yangon and America/New_York tests set both `TZ` and `PGOPTIONS` before the first database connection; static module imports do occur before those assignments, so this depends on the pool being lazy. The shared test covers overdue with unsent and already-sent reminders, 50%, 90%, fresh rows, and repeat-scan idempotence. These are author tests I inspected, not tests I ran.

**Closure scope and audit.** `closePendingApprovalsOnTransition` still executes inside the successful gated transition transaction after gate evaluation and under the work-item lock. Its update requires the exact workspace, work item, transition, and `pending` state. The new regression uses a second work item with the same transition and verifies its approval remains pending and decidable; this closes the prior Opus N8 test gap. The audit now resolves the transition's user id to the approval audit convention's person id. The apparent unscoped person lookup is safe under the actual `person_user_unique` global partial unique index: one non-null `user_id` can identify only one `person` in the entire database. Organisation id is loaded from the exact workspace id. The audit still records the approval's workspace/project, action `approval.closed`, previous state and transition reason, with no other tenant's personal data. The new assertions check actor id/type and organisation/workspace scope. No closure event is emitted, consistent with the contract that `approval.expired` denotes a timeout.

**Notification and resource isolation seam.** I re-read the current `approval-reach.ts`, recipient resolver, `findApprovalNotificationContext`, and send-time eligibility. Approval lookup joins the approval to its work item on `(workspace_id, work_item_id)`, selects it by approval id and event/delivery workspace, requires live work item and project, and rechecks current reach and recipient identity. Inbox reads require the exact recipient to be requester, approver or watcher, private visibility, active staff identity and project reach. Send-time eligibility requires an exact workspace match and relevant pending state for requested/expiring notices. Approval candidates have `channels: []`, so the S4 `destination_unresolved` back-off remains unreachable for approvals now; adding channels would require new review of delivery behavior. The `approval.closed` inbox delete remains restricted to the ids returned by the scoped closure update. I found no new path for a cross-organisation inbox read or delivery through this delta.

**Single-use and accepted seams.** Approval creation and transition activity retain database UTC clock writes after their shared work-item lock. Counting excludes approvals older than a matching transition's activity row. The delta does not change this mechanism. The earlier full source review and runtime attack tests at 722 remain their own historical evidence; I did not rerun them or relabel the Opus report as Sol. The S4 notification resolver and PR #630 auth-admin refusal were imported from already accepted/reviewed work; this review checked their S3 seams, not their full standalone implementations.

## Earlier coverage and dispositions

The independent Claude Sonnet A and B reports both close on exact 72207e01; A's verdict is `CLEAR WITH NON-BLOCKING`, B's is `APPROVE`. The independent Claude Opus 5.5 security report closes on 72207e01 with `CLEAR WITH NON-BLOCKING (security)`. The ordinary reviewer for this delta at c9a32be7 recorded `CLEAR WITH NON-BLOCKING` in `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/pr635-ordinary-luna.md`. I read these reports as evidence and checked the source locations relevant to their findings. Their authorship/independence provenance is recorded by the ordinary review from original transcripts; I did not personally re-authenticate the raw transcripts.

The earlier Opus closure's NB-F1/NB-F2 audit gaps are addressed by the new actor-person and organisation fields. NB-F3's same-transition cross-item test gap is addressed by the new regression. Its N-A app-host clock skew was fixed at 722 by DB clock writes under the lock; the current scan delta closes the distinct session-timezone comparison defect that Sonnet B identified at 722. The docs now clarify that a transition-closed approval uses `expired` even if `expires_at` is future (earlier NB-15), and the 2026-10-10 decision entry explicitly labels the conductor-derived consequences (earlier NB-16). These dispositions are based on the current source and tests, not on an unperformed mutation run in this review.

## Residuals and evidence limits

Carried from the historical security report, not new findings: single use is derived from timestamped activity carrying `payload.transitionId` rather than an explicit consumption link; legacy-shaped activity does not spend an approval, though no gated transition writer currently emits that shape; approval handlers do not distinguish an impersonated session, while the impersonation plugin is not mounted; a requester-created pending approval can block an `all` gate until decided, withdrawn or expired as Thomas decided; approval notification channels remain empty, so future delivery destinations need review when implemented. The closure of a pending approval is distinguishable from timeout through its `approval.closed` audit row.

I did not start a database, container, CPU-heavy suite or mutation run, because shared resource ownership was not allocated to this reviewer. I inspected the existing full integration receipt at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/s3-clock-repair-full-integration-3bfd3cb6.log`: Vitest reports 168 files and 1,984 tests passed at 3bfd3cb6. That is an existing author/other-session receipt, not a test I ran, and exact-head CI remains separate. The conductor's separately run post-compose zone/closure tests and mutant result were described in the dispatch but no receipt was available in the evidence directory at review time, so I do not count them as my executed checks.

At my GitHub read, PR #635 still pointed to c9a32be7 and accepted base a96e6a4c. The PR-template/security-review check was failing pending publication, and integration, visual and performance checks were in progress. Those gates must be satisfied on the exact head before merge; this review does not waive them.

## Commands actually executed

- `git status --short --branch`, `git rev-parse HEAD a96e6a4c c9a32be7`, `git log --graph --oneline --decorate -10`, `git merge-base a96e6a4c c9a32be7`.
- `git diff --name-status` and `git diff` for `a96e6a4c..c9a32be7`, `72207e01..3bfd3cb6`, and `3bfd3cb6..c9a32be7`; `git diff --check 72207e01..3bfd3cb6` (pass).
- Targeted `rg`, `sed`, and `cat` reads of policy, contracts, approval/notification/work-item/audit source, schema, tests, historic reports, and full-suite receipt.
- `gh pr view 635 --json headRefOid,baseRefOid,mergeable,reviewDecision,statusCheckRollup` (matched reviewed head/base; mergeable, with required checks not yet all green).


