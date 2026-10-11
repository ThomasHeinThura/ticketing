# Frozen S7 selected integration review evidence

**Reviewed head:** `bb4eef55a22865f70377ddd26e1efd2c73ef85ea`

Root transport record. All reports below are authentic and unedited, including historical BLOCK verdicts, narrow closures, factual corrections and any explicit disclaimer that a report does not satisfy the fresh ordinary count. No historical report is relabelled to current source. Latest manager-authority repair at aad has three fresh independent ordinary clear verdicts then full independent Sol CLEAR; bb current documentation composition has separate ordinary then security confirmation. Dispatch selectors and fork_turns=none are recorded as tool provenance; generic platform identities do not independently attest the serving variant. Source-owned holds remain in force. Full exact-head Any, integration, permissions, built primary journey, image/non-root health and hosted CI remain pending; this note grants no stage acceptance.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110888357
SHA-256: `b604681c5874fbe0b437d5e0ed21b50bfaf9cb676964bc4801105311987af7f5`

# S7 frozen selected integration — ordinary reviewer A

**Verdict: CLEAR (static source review).** I found no blocking defect in the reviewed source. This verdict is an ordinary review only; it does not satisfy the separate Sol security review, runtime/browser/image acceptance, or any stage claim.

**Requested reviewer selector:** GPT-6 Luna, ordinary reviewer A. **Identity limitation:** this platform context exposes only the generic GPT-6 identity; I cannot independently attest that the serving variant was Luna. The review is recorded under the requested selector with that caveat, not as verified Luna provenance.

**Exact candidate:** `c844d643d189b5525787fb692286ad718ef78cc4`

**Comparison base:** accepted main `521b886fc06b50fee63f203d90e761bf1330c602`.

**Author checkpoint:** `dd35145e2cd2959b5f1045b148dc1138adaf26d8`.

**Independence:** fresh ordinary-review context; I did not author, direct, or remediate this candidate. I read the required repository operating material and owning pending-action, service-calendar, SLA, saved-view/search specs, then reviewed the full base-to-head changed-path inventory and the relevant implementation and integration-test hunks. The diff is 99 paths, approximately 16,670 insertions and 397 deletions. The checkout was clean at the reviewed SHA.

## Coverage and assessment

I reviewed the candidate as a selected integration against accepted main, including all 99 changed paths, the new calendar/SLA/search/view API and repository modules, the domain calendar/SLA changes, policy registration/fixtures, docs, primary journey, and the S6 pending-action/identity changes. I also separately inspected the post-checkpoint S7 commits and merge parents. The S7 sequence after the author checkpoint is `4cea6602`, `985181c1`, `6cf2e3a8`, `1e4d9bb7`, `262d57d1`, `cc67a5fd`, followed by merge `c844d643`; the merge has parents `cc67a5fd` and accepted main `521b886`. The merge retains the S7 first-parent tree and composes the accepted-main parent; I found no dropped S7 hunk in the final tree. The intervening accepted-main commit `05b2a77` and its ancestors remain present through the second parent.

For PA-9, the new before/after helper evaluates the stored route against current identity, stored scope, target version, and original credential ceiling while the pending-action lifecycle gate is held. The helper terminalizes only an allowed-to-denied transition, maps reach/capability/version/scope failures to the registered invalidation reasons, and uses the existing conditional transition/event/audit path. Native workspace member removal, leave, role change, ownership transfer, role permission replacement, and workspace deletion use the lifecycle wrapper. Configured OIDC/SCIM grant and projection writers capture before and after state in their transactions, including connection/JIT/rank changes, OIDC mapping changes, SCIM administration/group writes, and OIDC sign-in projection. Direct/native surviving access is re-evaluated rather than inferred from the changed row alone.

Calendar and saved-view deletion requests bind a single target, workspace, route, canonical payload and current version. Approval locks the pending action before the requester and target, verifies a live approving session, expiry, route/payload/hash/scope/version, re-evaluates required access, and performs the deletion with outbox events and audit failure accounting in the same transaction. Calendar approval also rechecks live references. Saved-view deletion verifies current team reach, removes pins, and audits the deleted view. The real middleware retains the existing native admission checks; this candidate does not silently broaden route admission to projected-only identities.

The changed integration coverage includes real-route workspace reach removal/restoration, native capability loss/restoration, retained effective access, projected manager capability loss for a non-owner view, key scope narrowing, target version changes, requester/session credential binding, expiry/replay behavior, deletion reference races, and decision audit/outbox assertions. The final source review found those tests materially address the requested loss/retention cases; I did not execute tests because the conductor has the full API/permission run in progress and this reviewer was assigned read-only source review.

## Findings

No blocking or non-blocking code findings from this static review.

## Residuals and limits

- The requested Luna model selector is not attested by the platform-visible model identity, as stated above.
- Projected-only identities still cannot pass the legacy native `requireWorkspaceCapability` admission middleware on calendar/view routes. This is an existing authority seam, not silently changed here; the separate projected-authority design material is not approval to widen it.
- This review ran no tests, database, build, browser, Docker, CI, GitHub action, or source mutation. Conductor-owned validation and an independent fresh Sol security review remain outstanding.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110888616
SHA-256: `2584a414645e5a09a26d65b4583b3ba90fd01f45ba4883b77db586d8c0bcb1e9`

# S7 frozen integration — ordinary review B

- **Verdict:** BLOCK
- **Reviewer role/model:** Independent ordinary reviewer B, GPT-6 Luna tier. The task assigned the Luna tier; this platform runtime does not expose an independently verifiable model/version selector, so this records the assigned tier rather than claiming a runtime model identifier.
- **Candidate:** `codex/s7-selected-integration`, exact head `c844d643d189b5525787fb692286ad718ef78cc4`
- **Comparison base:** accepted main `521b886fc06b50fee63f203d90e761bf1330c602` (merge-base equals comparison base).
- **Scope:** Reviewed the complete 99-path candidate manifest (16,670 additions / 397 deletions), with focused semantic tracing of calendar/DST arithmetic and persistence/versioning; SLA binding/evaluation and work-item facts; structured search validation, SQL scoping, cursor behavior; saved-view visibility/team policy, count/run, and pending deletion; route/policy/schema registration and contracts. Read required AGENTS/workflow/CLAUDE/DoD/mission/status/decision records and owning specs before source review. This is an ordinary review, not the required Sol security review and not stage or integration acceptance.
- **Working tree:** Candidate worktree was clean. No source edits, DB/container/browser/build/GitHub mutations, or tests were performed. Checks were read-only source/spec inspection and git identity/status checks.

## Blocking findings

1. **SLA pauses are discarded by the only new evaluation endpoint.** `get-work-item-sla.ts` supplies `pauses: []` for every work item (line 22), so the domain evaluator cannot honor any automatic or manual pause. The transition implementation explicitly makes `pause_sla`/`resume_sla` no-ops because `sla_pause` is absent, and only writes/clears `resolved_at` for completion/reopen (`transition-work-item.ts:221-227,314-324`). This contradicts the current SLA contract: SLA-10/11/12 require workflow pause effects, resolution pauses, and subtracting paused covered time; the spec explicitly says automatic workflow pause/resume remains available while manual D1 is held. An item paused while waiting on a customer therefore continues consuming time and can be reported breached incorrectly. Implement the approved automatic pause/resume persistence/read path or keep the endpoint from claiming current SLA evaluation until that contract is implemented. The relevant source comments disclose the omission but do not satisfy the approved behavior.

2. **First-response SLA can never stop on a qualifying comment.** The new evaluator reads `work_item.first_response_at`, but `create-comment.ts:33-34` explicitly leaves it unset. SLA-7 requires the first public comment by a staff member other than the requester to set this fact; internal comments must not count. As a result, first-response metrics keep running and eventually report breach/miss even after a valid staff response. Add the specified atomic first-response write in the comment transaction (with requester/staff/public conditions), plus regression coverage, before calling the SLA endpoint complete.

3. **Saved-view team-lead edit and owner-departure contracts are not implemented.** `team_member` in the runtime schema has no `is_lead` field (`apps/api/src/database/schema.ts:314-330`), and `assert-can-edit-view.ts:17-20` explicitly limits non-owner editing to `workspace:manage_settings`. The feature contract SV-17 grants team leads edit authority; the Edge cases section also requires transferring shared-view ownership when its owner leaves (team lead, else workspace). The current candidate cannot enforce the first rule and the inspected update/deletion paths do not establish the second. This is a concrete spec gap in an implemented saved-view surface, not covered by the current schema/policy tests. Resolve through an already-approved team-lead/owner-lifecycle contract or record the accepted limitation in the owning spec before claiming the feature complete; do not invent a new team field or behavior during this freeze.

## Areas inspected without another confirmed blocker

- Calendar timezone conversion uses `Intl`/IANA data and the domain code clips windows against actual offset segments; repository updates/imports lock rows and compare the optional version inside the transaction. CAL-8 expressly makes the current calendar definition live for all pinned policy versions, so live lookup is consistent with that decision.
- SLA policy edits/publish lock the policy row and increment its version once; published policy versions select by effective instant, and referenced calendar/type IDs are workspace-scoped. Calendar deletion rechecks project and all policy-version references after locking the target; FK restrictions also backstop concurrent reference creation. Event/catalogue behavior inspected for the changed resources.
- Structured-search AST validation bounds depth, group size, leaves, token text, values and sort count; SQL is built from whitelisted expressions and parameters. Search constrains work items to the requested workspace and currently reachable projects, then reapplies saved-view project scope. Cursor binds actor/workspace/query/limit/sort. I did not reproduce a cross-tenant result leak in the inspected paths.
- Saved-view reads/runs/counts apply visibility and current work-item reach. Team targets are checked against the view workspace on create/update; delete is pending-action based and approved deletion rechecks the target. Those controls do not remedy the team-lead/lifecycle gaps above.

## Residuals and exact evidence limits

- No unit/integration/e2e suite was run in this review; no test-pass claim is made. Parent handoff notes separately identify primary-journey run failures and its final 1/1 result; those are not full-suite proof and were not treated as such.
- This review does not establish the separate source-conservation claim `dd35145..c844` or that accepted main contains only the `ntfy` fixture from that interval; the supplied short SHA did not resolve as a commit in the candidate repository when checked. The conductor must retain its separate verified conservation receipt.
- The approved D1 manual-pause hold and F3 canonical POST export hold remain exclusions per assignment; the pre-existing legacy GET export matrix was not changed in this review.
- No browser/runtime, image, integration, permissions, or CI result is attributed to this reviewer. No stage-completion or integrated-slice acceptance is claimed.

**Conclusion:** BLOCK at exact `c844d643d189b5525787fb692286ad718ef78cc4` for the three contract gaps above. Remediation changes the candidate SHA and requires review of the changed exact head at the applicable ordinary/security tiers.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110888849
SHA-256: `c5eecffbd289334eb6742c74dbad4f79e57972fca1db6ea8219b26da4426d556`

# S7 selected integration — ordinary review C

- **Candidate:** `c844d643d189b5525787fb692286ad718ef78cc4`
- **Base:** `521b886fc06b50fee63f203d90e761bf1330c602`
- **Source:** `/private/tmp/claude-501/s7-selected`
- **Reviewer:** GPT-6 Luna, fresh independent reviewer context C
- **Independence:** I did not author, direct, or remediate this candidate and did not rely on reviewers A or B. I reviewed the exact 99-path base-to-head diff and the source checkout reports the requested SHA.
- **Verdict:** **BLOCK** — one implementation correctness issue and one unresolved PA-9 credential-expiry contract case need resolution before this candidate is clear.

## Scope and checks

Reviewed repository workflow/control docs and current feature contracts, then traced the candidate's API, policy, repository, domain, identity, and pending-action paths. Focus areas included saved-view audience/reach, structured-search scoping and field access, project SLA-version selection/evaluation, calendar/policy versioning, deletion target version and scope checks, PA lifecycle serialization, authority before/after snapshots, and explicit credential revocation. `git diff --check BASE..HEAD` passed. I did not run tests or DB/browser/build checks; no runtime result is inferred. I did not edit candidate files.

## Findings

### F1 — Work-item SLA read discards persisted pause intervals

`apps/api/src/work-item/controllers/get-work-item-sla.ts` constructs the SLA facts with `pauses: []` unconditionally. The evaluator therefore computes elapsed covered time as if no pause ever occurred, even though the canonical contract requires `SLA-11` to persist pause intervals and `SLA-12` to subtract paused intervals. The canonical schema and domain types define `sla_pause`, and SLA-11/12 require its intervals to affect evaluation. The current workflow transition executor still treats pause/resume as no-ops, so this candidate does not provide an application path that creates those rows; however the newly added endpoint silently reports an unpaused SLA and would misstate due time, consumed time, and state whenever canonical pause rows exist. This is an incomplete vertical slice against the published SLA behavior. Implement the pause facts and writer contract, or explicitly keep the evaluation endpoint withheld until that contract is implemented; add regression coverage for open and closed intervals.

**Severity:** blocking correctness finding for the newly added SLA endpoint.

### F2 — API-key natural expiry is treated as revocation during PA-9 re-evaluation, with no authoritative rule/test

`apps/api/src/pending-action/required-access.ts` accepts `existingPendingAction: true` to exempt a naturally expired session from credential failure, matching PA-9's explicit statement that ordinary session expiry alone is not revocation. The API-key branch still rejects `expiresAt <= now` regardless of that option. Workspace authority before/after snapshots and deletion approval re-evaluate existing actions through this function, so an API key reaching its configured expiry can make a pending action terminal with `credential_revoked`, despite no disable/revoke operation. PA-9 explicitly names disabling/revoking an API key, but does not state whether natural API-key expiry alone is terminal; the candidate's choice is not covered by a test. Clarify the API-key-expiry rule in the authoritative PA-9 contract and test it. If expiry alone is nonterminal, exempt it for existing actions while retaining the expiry check at action creation and the explicit revocation hooks.

**Severity:** blocking spec/behavior ambiguity in a security-sensitive lifecycle path; do not infer equivalence from the session rule without recording the decision.

## Positive checks / residual limits

- Saved-view search executes under the viewer's current identity, project reach, and field policy; a project-scoped view adds a mandatory SQL scope. Count and run both use that access path.
- Pending-action target version/scope checks are performed in the same transaction as approval, and calendar deletion checks live project and SLA-version references before deleting. Workspace access invalidation snapshots only the targeted pending deletions and applies only allowed→denied transitions.
- The identity and workspace writers inspected take the pending-action lifecycle gate before snapshots/mutations and re-evaluate after the mutation in the same transaction. I saw no finding in this sample that restores access to an already-invalidated action.
- This review does not establish integration-suite results, browser evidence, container deployability, independent review A/B verdicts, the required Sol security review, or stage acceptance. Generic platform caveat: I cannot certify absence of every defect from a static review; the findings above are concrete and reproducible from the code paths described.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110889092
SHA-256: `9fe736e592da6bd25f80131e7222bc0354385345871d870a1bb1703b88f03b8c`

# S7 focused remediation — ordinary reviewer A

- **Verdict:** BLOCK
- **Candidate:** `b7925812cc409c5253c2e36c35ba08a381b78fa3`
- **Comparison base:** accepted `main` `2ecff903eb9e6a74f2d6a5eb03a54849b36afa45` (merge-base verified).
- **Prior frozen source:** `c844d643d189b5525787fb692286ad718ef78cc4`.
- **Requested reviewer/model:** ordinary reviewer A, GPT-6 Luna. The runtime exposed only the generic GPT-6 identity, so I cannot independently attest that the serving variant was Luna; this report records the assigned tier with that provenance limitation.
- **Independence:** fresh review context. I did not author, direct, or remediate the candidate. I did not rely on the design-triage Sol packet as approval evidence.
- **Working tree:** exact requested HEAD, clean. No source or report other than this assigned review report was edited.

## Scope and checks

Read the repository's `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, current status and decision log, and the owning pending-action, SLA, workflow, saved-view, team, and identity authority contracts. Compared the exact candidate with accepted `main`, inspected the complete changed-path inventory, and traced the new pause/resume and first-response writes, expired-key extension adapter path, approval DTO dispatch, and the existing PA-9 target-access/lifecycle implementation. Rechecked the prior B/C blockers against current code and the approved owner decisions. Inspected current access-writer and runtime receipts as author evidence, then independently checked relevant source and tests. `git diff --check 2ecff903eb9e6a74f2d6a5eb03a54849b36afa45..HEAD` passed.

Per the assignment, I ran no tests, database, server, image, browser, or CI command. The author's focused receipts report 139 passing tests across seven complete API-integration files, plus two separately recorded focused lock-observation cases; those receipts do not establish my execution or full current-candidate acceptance. The preserved original full run remains 177 files / 2,161 tests with 6 failed files / 15 failed tests. The report does not treat the author's 139 tests as full acceptance.

## Blocking finding

**Conflicting SLA effects on one transition resolve by array order.** `effectSchema` accepts both `pause_sla` and `resume_sla` as members of the same unconstrained effects array (`apps/api/src/workflow/schema.ts:42-43,68-80`). Workflow-version validation does not reject a transition containing both (`create-workflow-version.ts:121-140`). In the executor, each effect overwrites the same `waitingCustomerEffect` variable (`transition-work-item.ts:337-340`), so the final stored order silently chooses whether to open or close the automatic pause. Reordering an otherwise identical effects array changes the resulting SLA facts; a transition can therefore both claim to pause and resume while doing only one.

Reject the conflicting pair during workflow validation (and retain a regression for both orders), or define an explicit deterministic combined behavior in the owning contract. The current candidate has no regression for this malformed-but-schema-valid input. This is a bounded acceptance defect in the newly wired SLA lifecycle behavior.

## Prior findings and invariant review

- **Prior B — SLA pause facts:** addressed in the reviewed source. `get-work-item-sla.ts` now reads the persisted pause rows; transition execution opens one `waiting_customer` row per metric and only closes matching open automatic rows. Duplicate open rows map the registered uniqueness violation to 409, and the transaction includes the transition mutation. The new tests cover pause rows, selective resume, duplicate-pause rollback, and a persisted interval affecting due time. Manual routes and resolved-pause continuity remain explicitly held in the decision/spec text.
- **Prior B — first response:** addressed. A public comment locks the work item, and sets `first_response_at` once only for a staff-side author distinct from the requester. The added route test covers requester, internal, then qualifying public comments. No source blocker found in the inspected path.
- **Prior B — team-lead editing/owner transfer:** properly held by the accepted owner decision and reflected in saved-view/team specs and service guide. Existing owner/workspace-manager behavior remains represented; no team schema was invented.
- **Prior C — natural API-key expiry:** the extension path locks the pending-action lifecycle gate before locking/updating the key, detects an expired-before/future-after expiry, and invalidates bound pending actions using `credential_revoked` inside the same transaction. The new test exercises extension after expiry and checks the durable invalidation. Ordinary session expiry remains separately exempted.
- **PA-9 access and serialization:** inspected the current evaluator and workspace invalidation helper. Route admission remains the existing native membership/capability gate; the evaluator's required access can incorporate projected grants, and the source does not widen route admission to projected-only users. The before/after wrapper takes the lifecycle gate before the affected membership/role mutation, then terminalizes only allowed-to-denied outcomes. Calendar/view approval continues to recheck canonical tuple, payload/hash, target scope/version, current identity and original API-key ceiling within the target transaction. Existing tests and the author matrix provide real route-created native/projected loss and retained-access cases, including the foreign-view additional capability loss, restoration non-revival, event/audit persistence, and serialized competing operations. I found no separate blocker in this bounded source review.
- **Permission denial map:** the modified assertion still checks every capability value is false and updates only the expected map length to 19; it does not weaken the denial assertion.

## Residuals and limits

This verdict is an ordinary source review, not the required third ordinary panel verdict, the independent GPT-6 Sol security review, CI, full API acceptance, browser/image verification, deployability evidence, or stage completion. The generic runtime model identity prevents me from certifying the requested Luna variant. No issue here authorizes bypassing the new finding or the remaining acceptance gates.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110889324
SHA-256: `8b9405f5011da6800419bb1243c961f803ee0aa16d04ac86d845b19cd05a8ab0`

# S7 selected remediation — ordinary reviewer B

- **Verdict:** BLOCK
- **Requested reviewer tier:** GPT-6 Luna, fresh independent ordinary reviewer B. The execution surface does not expose a model/version selector or independently verifiable runtime model identity; this report records the dispatched Luna tier and does not claim runtime provenance.
- **Exact candidate:** `b7925812cc409c5253c2e36c35ba08a381b78fa3`
- **Comparison base:** accepted `main` `2ecff903eb9e6a74f2d6a5eb03a54849b36afa45` (the current-base merge is `13651b4ba788796446cbf3345079e758664de4bb`; it adds only the two decision-log commits since shared ancestor `521b886fc06b50fee63f203d90e761bf1330c602`).
- **Previous reviewed candidate:** `c844d643d189b5525787fb692286ad718ef78cc4`.
- **Independence:** Fresh reviewer context. I did not author, direct, or remediate this candidate and did not rely on another reviewer during inspection.
- **Source:** `/private/tmp/claude-501/s7-selected`, HEAD verified at the exact candidate SHA. Tracked tree was clean.

## Scope and evidence

I read the repository operating guide, workflow and model policy, the current dated status/decision records, and the SLA, workflows, saved-view, team, pending-action and service-operations contracts. I reviewed the complete current-base diff manifest (109 paths; 26,175 additions / 3,954 deletions), using the frozen broad reviews A/B/C at `c844d643` for the existing 99-path implementation baseline, then independently inspecting the full 21-path remediation/current-main delta and tracing the changed runtime paths. The current delta is 9,583 insertions / 3,595 deletions, mostly generated OpenAPI regeneration.

Checks performed: exact SHA and clean status; diff/path/stat inspection; static source/spec tracing for automatic SLA pauses, first-response facts, pause-aware SLA evaluation and calendar arithmetic, approval credential invalidation, saved-view held behavior, route/policy exposure and OpenAPI export/manual-pause surface; `git diff --check c844d643..b7925812` passed. I did not run tests, a database, server, browser, image, CI, or GitHub mutations. No runtime acceptance is inferred.

## Blocking findings

1. **A transition carrying both SLA effects silently drops one authored effect.** `workflow/schema.ts` accepts an arbitrary ordered effect array; `resolveEffects` preserves all entries and their order, and its tests explicitly cover a transition containing both `pause_sla` and `resume_sla`. The new executor collapses these entries into the single `waitingCustomerEffect` scalar (`transition-work-item.ts`, around lines 321–343): whichever effect appears last overwrites the earlier one. Thus `[pause_sla, resume_sla]` only resumes and creates no pause history; the reverse order only opens pauses and does not resume. The owning WF-19 contract does not forbid this pair or define a conflict rule. Preserve ordered execution or make the combination invalid under an explicit contract; silently discarding an accepted effect is not a defined behavior.

2. **The accepted SLA-9 reopen promise still contradicts the held implementation.** `sla.md` SLA-9 still says reopening resumes the resolution clock “from where it stopped.” `transition-work-item.ts` still clears `resolved_at` on reopen and the evaluator then computes from the original `startedAt` with no completed-period pause (`packages/domain/src/sla/sla.ts`, `computeMetricState`). This causes elapsed covered time from the already-completed period to count again after reopen, rather than resuming from the stopped amount. The edited WF-18 now says resolved-pause continuity is held, so the owner-authorized release hold and the still-active SLA-9 contract conflict. The direct owner decision freezes completed/reopen/resume semantics without authorizing a guessed replacement. Reconcile the owning SLA-9 claim with that hold or obtain a documented decision before this slice can claim coherent SLA behavior.

## Prior finding dispositions

- Frozen ordinary B finding 1 (SLA reader supplied no pause facts): **resolved**. `get-work-item-sla.ts` now loads persisted `sla_pause` rows; the domain evaluator subtracts pauses from covered business-calendar time. The existing policy integration test now proves a persisted resolution pause shifts due time by one covered hour. Author checkpoint reports focused 139/139 tests, but this reviewer did not execute them and this is not full-suite evidence.
- Frozen ordinary B finding 2 (qualifying first response never persisted): **resolved by inspection**. `create-comment.ts` locks the work item, inserts the comment, and sets `first_response_at` to the persisted comment timestamp only for a public comment by a staff-side person other than the requester, in the same transaction. Internal/requester comments do not count. New integration cases are present; not run here.
- Frozen ordinary B finding 3 (team-lead edit and shared-view owner transfer): **held by explicit owner decision**, not implemented or represented as complete. The accepted decision-log entry and owning team/saved-view specs and guide preserve existing owner/workspace-manager access behavior and state the release hold. No new team schema or transfer rule was invented.
- Frozen ordinary C key-expiry finding: **decision settled and implementation addressed by inspection**. The accepted decision says natural expiry is terminal; the API-key expiry-extension writer invalidates actions before extending an already-expired key. A focused regression is present; not run here.

## Broader review notes and limits

- The current OpenAPI artifact represents 250 operations. I found no `POST /work-items/export` and no manual SLA pause/resume route. Existing `work_item:export` vocabulary and legacy `GET /api/task/export/{projectId}` remain. No held manual endpoint or new export route is carried into this candidate.
- Current SLA facts read the live calendar through the pinned SLA version and use `computeSlaState`; pause subtraction uses the calendar's covered-time arithmetic, including timezone/holiday windows.
- Review A's earlier no-finding verdict remains scoped to its previous SHA; B/C's previous blockers cannot be cleared by that earlier verdict. The owner-held team/view behaviors and API-key-expiry decision are reflected in the current docs/decision log.
- The author checkpoint reports seven complete focused integration files (139/139), API typecheck, scoped Biome, OpenAPI check (250 operations), and `git diff --check`. I inspected that report but did not independently run those checks. The original full API run remains failed evidence (6 files / 15 tests failing among 177 files / 2,161 tests); focused results do not replace root's exact-source full run.
- No image build, browser evidence, runtime/database acceptance, full-suite acceptance, or exact-head GPT-6 Sol security review is established here. This review is ordinary only and is not a security approval or phase finalizer.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110889516
SHA-256: `614f45aac7541a087c68e9591a37b3052065058926958a15471e03b5f0f76171`

# S7 ordered-effects remediation — ordinary reviewer A delta

- **Technical verdict:** CLEAR for the prior ordered-effect finding.
- **Candidate:** `3b61d495f74bcf1265b39da1e791ad1102fb5227`.
- **Accepted main:** `12c09aaca85250c03223df1ed191275c0d3cdd74`.
- **Prior blocked candidate / delta base:** `b7925812cc409c5253c2e36c35ba08a381b78fa3`.
- **Composition:** `9030cfe3c0db2d28882e5196d849b60e4a7c2afd` merges accepted main with parent `12c09aaca85250c03223df1ed191275c0d3cdd74`; its per-parent diff adds only `docs/07-planning/integration-execution-queue.md` and `docs/07-planning/status.md`. The following product commit is `3b61d495f74bcf1265b39da1e791ad1102fb5227`.
- **Model actually exposed:** generic GPT-6 identity. I cannot attest that this runtime was GPT-6 Luna.
- **Independence limitation:** this is the same reviewer agent/context that authored the prior BLOCK report at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/s7-remediation-ordinary-a-luna.md`. I did not author or edit the remediation source, but my earlier finding materially directed this repair. This delta report records the technical disposition and must not be counted as a fresh independent reviewer context.
- **Checkout:** requested worktree was clean at the exact candidate; no product source was edited.

## Scope and checks

Read the ordered-effects handoff and hold plan, checked its baseline reproduction log, reviewed the raw/per-parent changes from b792 through the records merge and product fix, and traced the modified executor, the full new API regressions, the existing duplicate-pause rollback test, domain effect-order assertions, strict-runtime enforcement fixture, SLA spec and service guide. Inspected the zero-length pause interval handling in the SLA evaluator. `git diff --check` passed from both b792 and the product-parent source.

I ran no tests or database/runtime commands because the conductor owns the current validation window. The handoff reports: exact b792 baseline reproductions failed both new ordered-effect assertions (pause→resume persisted zero rows; resume→pause returned 409) and the strict-runtime fixture failed on its missing registered policy paths; after repair, the two complete files passed 29/29, the domain workflow file 173/173, and scoped checks passed. These are author receipts, not tests I ran. The existing full b792 integration failure remains preserved and is not converted into a pass claim.

## Finding disposition

The prior finding is **closed in source**. The executor now collects `pause_sla` and `resume_sla` in their authored order and executes each in that same order inside the existing work-item transaction. It preserves both effects rather than choosing a winner or rejecting a pair that the existing WF-19 contract allows. Thus pause→resume from an unpaused item writes and closes both metric rows; resume→pause closes existing open automatic rows and opens one new row per metric.

The regressions exercise both orders through real workflow and transition routes. They inspect state and persisted rows; the pause→resume case accepts equal start/end timestamps (`endedAt >= startedAt`). The SLA evaluator filters zero-length intervals (`end > start`), so an immediately closed pause contributes no negative or double-subtracted covered time. The existing duplicate-pause test remains unchanged: a conflicting open row still maps to 409, and transaction rollback prevents the earlier state write and any preceding effect writes from committing.

The domain `resolveEffects` implementation and its ordered-array behavior are unchanged. The added domain edit only narrows a stale test title; its assertion is unchanged. The workflow still emits the transition through the existing single transition event/audit path; the executor adds no per-effect event or audit. No route, policy, permission, schema, migration, or new dependency was introduced.

## Other delta dispositions and residuals

The strict-runtime test fixture now includes the five registered policy sources that were missing at b792 and keeps `apps/api/src/task/policy.ts` last, satisfying the enforcement parser's full-source requirement. SLA-9 and the service guide now explicitly state that correct reopened-resolution continuity is not guaranteed while the accepted resolved-pause hold remains. No D1 manual pause/resume route, resolved-pause continuity, or completion/reopen runtime behavior was added.

I found no remaining blocker in this bounded delta. This is not a fresh independent ordinary review because of the context limitation above, and it is not the required Sol security review, full integration acceptance, browser/image verification, or stage-completion review. The conductor's exact-head checks and another genuinely fresh reviewer remain necessary.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110889729
SHA-256: `ebfb5b1aaeea35e3f28a495298149687b2b1c643526572a03e9e95089961c288`

# S7 ordered-effects remediation — ordinary reviewer B

- **Verdict:** CLEAR for the remediation delta from the previously reviewed blocked head; this is not overall S7 acceptance or security clearance.
- **Requested reviewer tier:** GPT-6 Luna, fresh independent ordinary reviewer B. The runtime does not expose a selectable or independently verifiable model/version identifier; this report records the assigned Luna tier without claiming runtime model provenance.
- **Exact candidate:** `3b61d495f74bcf1265b39da1e791ad1102fb5227`
- **Previous blocked candidate:** `b7925812cc409c5253c2e36c35ba08a381b78fa3`
- **Accepted-main comparison base:** `2ecff903eb9e6a74f2d6a5eb03a54849b36afa45`
- **Candidate worktree:** `/Users/heinthura/.codex/worktrees/s7-ordered-effects-remediation/Ticketing.v2`; HEAD verified at the candidate SHA and `git status --short` was empty.
- **Independence:** Fresh context. I did not author, direct, or remediate this candidate.

## Commit and diff coverage

I traced each intervening commit and its parents. `9030cfe3c0db2d28882e5196d849b60e4a7c2afd` is a normal two-parent merge (`b7925812` and accepted `main` `12c09aaca85250c03223df1ed191275c0d3cdd74`). Its delta from the accepted-main parent contains only `docs/07-planning/integration-execution-queue.md` and `docs/07-planning/status.md` record updates. Product commit `3b61d495` changes six paths: the transition executor, transition integration tests, strict-runtime test fixture, SLA feature contract, service-operations guide, and a domain-test title. The full candidate remains a 109-path S7 slice against accepted `main`; I treated the prior frozen A/B/C reviews and my prior exact `b7925812` review as baseline evidence and reviewed this entire intervening delta.

Commands/checks I ran: `git rev-parse HEAD`; `git status --short`; `git show --no-patch --format=fuller` for the merge and product commits; parent-specific `git diff --stat` for both merge parents; `git diff --stat` and `git diff --name-status` from `b7925812`/accepted base; full source/test/doc diff inspection for `9030cfe3..3b61d495`; `git diff --check b7925812..3b61d495` (passed); and targeted `sed`/`rg` inspection of the decision log, owning contracts, workflow-policy registry, and enforcement fixture. I ran no tests, database commands, server, browser, image, CI, or GitHub mutations.

## Disposition of the prior findings

1. **Ordered `pause_sla` / `resume_sla` execution — resolved.** The executor now collects these effects in an ordered array and executes each inside the existing transaction. `pause` followed by `resume` inserts then closes the two metric rows, with timestamp ordering checked by the new regression. `resume` followed by `pause` closes existing `waiting_customer` rows before inserting the next open rows. The tests cover both orders. A duplicate pause still reaches the unique constraint and existing 409 mapper; the unchanged regression verifies the full state transition rolls back. I found no bypass of that rollback boundary in the delta.
2. **SLA-9 reopened-resolution ambiguity — accurately held and disclosed.** SLA-9 now distinguishes the intended future rule from this release's behavior and explicitly says correct reopened metrics are not guaranteed while pause continuity is held. The service-operations guide gives the same limitation. WF-18 and SLA-11 continue to hold resolved pause continuity; runtime code still clears `resolved_at` on reopen. This documentation does not imply the held behavior shipped or invent a replacement. D1's manual pause/resume and completed/reopen continuity remain unavailable.
3. **Strict runtime enforcement fixture — complete without weakening.** Against the `b7925812` fixture, three feature sources were actually absent: `service-calendar/policy.ts`, `sla-policy/policy.ts`, and `view/policy.ts`. The candidate inserts those three before the already-present attachment/workflow entries and leaves `task/policy.ts` last, satisfying the enforcement parser. All current registered feature policy sources are represented; the gate assertions and runtime enforcement behavior were not relaxed, skipped, or filtered. The handoff's description of five sources as missing at b792 overstates the delta: attachment and workflow were already in that exact baseline fixture.
4. **Owner holds and PA-9 expiry — preserved.** Current accepted decision-log text records the Thomas/PR #651 holds for team-lead editing and automatic shared-view ownership transfer, preserves existing owner/workspace-manager access, and makes natural API-key expiry terminal as `credential_revoked` even if the key is later extended. The ordinary-session-expiry exception remains. The candidate's docs do not reopen those decisions.

## Author-provided validation and limits

I inspected, but did not independently execute, the supplied handoff and receipts. They report the focused baseline reproductions at b792 (`pause→resume` left zero rows and `resume→pause` returned 409), patched relevant API files at 29/29, the domain workflow file at 173/173, `pnpm check:openapi` at 250 operations, route-policy suite at 14 files / 88 tests, and scoped Biome plus `git diff --check`. Receipts also report `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:permissions` exiting 0 on `3b61d495`; `pnpm test` records the configured workspace unit suites. These are author/root evidence, not checks run by this reviewer. Root retains the isolated full API integration run and exact-source acceptance.

No browser journey, image build/boot, deployment, full current-source API integration verdict, exact-head GPT-6 Sol security review, or stage-finalizer result is established by this review. The prior b792 full integration failure remains preserved evidence and is not converted to passing by the focused author results.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110890010
SHA-256: `38ca0dab1041b5b394aa82d3837baae6d9fb710ccb47e345034c3a490785f7d0`

# S7 selected integration — ordinary reviewer C (broad)

- **Verdict:** **BLOCK** on the exact candidate below. The remediation closes the previously reviewed ordered-pause defect, but the saved-view deletion access path still conflicts with the current owner/team-view contract; the transition executor also accepts an authored effect it silently drops.
- **Requested tier:** fresh ordinary GPT-6 Luna-tier reviewer C.
- **Model as exposed:** GPT-6. This platform context does not expose or independently attest the serving Luna variant; I do not claim a verified GPT-6 Luna runtime label.
- **Exact candidate:** `3b61d495f74bcf1265b39da1e791ad1102fb5227`.
- **Accepted comparison base:** `12c09aaca85250c03223df1ed191275c0d3cdd74`.
- **Checkout:** `/Users/heinthura/.codex/worktrees/s7-ordered-effects-remediation/Ticketing.v2`; `HEAD` matched candidate and working tree was clean.
- **Independence:** fresh reviewer context; I did not author, direct, or remediate this candidate. I read prior review records only to reconcile their earlier findings against current source and decisions; the findings below were traced independently to the exact candidate.

## Scope and checks

The complete base-to-head manifest is 111 paths (26,326 insertions / 3,957 deletions). I reviewed its changed-path inventory and traced the integration-critical service-calendar, SLA, structured-search/saved-view, transition, and pending-action authority paths against the accepted feature contracts, data model, pending-action contract, and owner decisions. The S7 source spans service calendars and SLA policies, work-item SLA facts and transition/comment writers, structured search and saved-view visibility/edit/delete, plus pending-action target execution and workspace/credential invalidation.

Commands/checks run: `git status --short`, `git rev-parse HEAD`, `git diff --stat` and `git diff --name-status` from the accepted base, `git show -s --format='%H%n%P%n%s'` for the product commit, `git merge-base --is-ancestor` for the base, and `git diff --check <base>..<candidate>` (passed). I ran no tests, database/runtime commands, server, browser, build, Docker, CI, or GitHub mutations; I made no repository-source edits. Author/root receipts were not counted as checks run by me.

## Blocking findings

### 1. Team-view deletion denies the preserved owner/manager access path after team membership is lost

For `DELETE /api/views/{id}`, `evaluateWorkspaceDeletionAccess` requires current membership in the view's audience team at `apps/api/src/pending-action/required-access.ts:456-471` before it evaluates the route capability or its later owner/workspace-manager condition at lines 485-505. Thus the original owner of a team view (and a workspace manager) who is no longer a member of that team cannot request or approve deletion, despite remaining in the workspace. The same owner remains able to read the team view through `getView`'s explicit `createdBy` branch and to edit it through `assertCanEditView`'s owner branch. The latest owner decision holds automatic ownership transfer and team-lead editing while preserving existing owner/workspace-manager access; the updated saved-view contract retains that rule and lists deletion as `workspace:manage_settings` or owner with `saved_view:create` (`docs/03-features/search-and-saved-views.md:144-145`).

The extra team-membership gate is therefore stricter than the current owner/manager policy on the destructive lifecycle path. It can strand a retained view after an owner leaves or is removed from its team, with no owner-transfer behavior authorized for this release. Reconcile the target-reach rule with the held ownership-transfer decision and ensure a still-authorized owner/manager can complete the existing pending-action flow. I did not run a DB reproduction; this is a direct source-path and contract contradiction.

### 2. Published `set_field` workflow effects are silently ignored

The current workflow contract lists `set_field { field, value }` among the available WF-19 effects (`docs/03-features/workflows.md:143-150`), and `apps/api/src/workflow/schema.ts` accepts that shape. The transition executor collects no `set_field` effect and explicitly drops it at `apps/api/src/work-item/controllers/transition-work-item.ts:327-342`. A workflow can therefore persist and execute a transition successfully while silently omitting an authored side effect. The adjacent comment says no custom-field value store exists, but the accepted data model and runtime migration schema already define `custom_field_value` for work items (`docs/01-architecture/data-model.md:357`; `apps/api/src/database/migration-schema.ts:190-245`).

This remains a contract gap even if the intended field namespace or validation rules need owner/spec clarification: WF-19 presently promises execution, while the route does nothing. Do not clear the workflow integration until the existing contract is implemented or the owning contract and authoring validation are reconciled so an unsupported effect cannot be accepted and silently discarded.

## Prior-finding dispositions I independently checked

- **Ordered automatic pauses:** closed in source for the reviewed issue. The executor now retains `pause_sla`/`resume_sla` array order and processes each inside the work-item transaction; the candidate adds both ordered real-route regressions. The existing unique-row conflict still fails the outer transaction. I did not execute those tests.
- **SLA pause reads and first-response fact:** the current SLA handler loads `sla_pause` rows, and the public-comment writer sets `first_response_at` only for the first public comment by a staff person other than the requester. The original B/C findings on `pauses: []` and the unset response fact are addressed in source.
- **Held reopen/manual pause behavior:** current SLA and workflow docs preserve D1's hold and do not claim correct completed/reopened metric continuity. This is not a new finding.
- **Saved-view team-lead/ownership transfer:** the current spec records Thomas's hold, and edit code retains owner/workspace-manager behavior. My first finding is the separate mismatch where pending deletion imposes an additional team-membership requirement.
- **Natural API-key expiry:** the accepted decision now makes expiry terminal and forbids revival after extension. The current evaluator rejects an expired key, approval maps a credential failure to terminal `credential_revoked`, and the expiry-extension adapter invalidates before updating the key. C's former ambiguity is resolved by the accepted decision and current code path; I did not run it.
- **Strict-runtime fixture count:** comparing its baseline with current fixture confirms three absent sources at b792 (`service-calendar/policy.ts`, `sla-policy/policy.ts`, `view/policy.ts`); attachment and workflow sources were already present there. The author handoff's “five missing” statement overstates what was absent, as ordinary reviewer B also noted.

## Other limits and residuals

The new saved-view route metadata still declares `saved_view:create` as its primary capability and repeats it in `orOwner` (`apps/api/src/view/policy.ts:104-112`), while the owning API contract states `workspace:manage_settings` or the owner's `saved_view:create`. The runtime pending-action helper adds a workspace-manager/owner check, which prevents the route metadata from being a faithful account of effective authority; keep the policy registry, route declaration and runtime gate aligned as part of remediation. The ordinary review does not satisfy the required exact-head GPT-6 Sol security review for pending-action/auth authority. No current-source full integration result, browser verification, image/runtime result, or stage-finalizer result is established by this reviewer.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110890199
SHA-256: `418afa3fee03c36b3608e6d848936ca5fa0e4ebcc081197e2e9e612ca95b9d21`

# S7 saved-view deletion reach delta review

## Status

**CLEAR for the narrow team-view deletion reach defect at this delta.** The fix restores pending-action deletion for the row owner and workspace manager after they leave the shared team, while retaining the team/workspace integrity check and masking an unrelated workspace member as 404. This is not a broad S7 integration approval, does not close the separate authored WF-19 `set_field` blocker, and does not claim runtime acceptance.

## Candidate and review independence

- Exact candidate: `8bf3a06770882054bbd116c9caf7e938f483d88e`
- Compared delta base: `3b61d495f74bcf1265b39da1e791ad1102fb5227`
- Accepted integration base: `12c09aaca85250c03223df1ed191275c0d3cdd74`
- Worktree: `/Users/heinthura/.codex/worktrees/s7-teamview-delete-owner/Ticketing.v2`
- Raw delta manifest: one commit, `8bf3a067 fix: preserve saved view owner deletion access`; two changed paths: `apps/api/src/pending-action/required-access.ts` and `tests/api-integration/view.test.ts`.
- This is a fresh independent review of the delta, not a review of the implementation. I did not author, direct, or remediate it.
- Requested selector/tier: GPT-6 Luna. The task interface did not expose a verifiable Luna-specific model selector; this report records the requested tier and does not claim platform attestation of the exact serving model.

## Scope and checks actually performed

Reviewed the complete delta, current surrounding pending-action authorization and invalidation code, saved-view route policy and direct edit guard, the owning saved-view requirements and decision-log entry, and built-in role capability definitions. Commands run:

- `git rev-parse HEAD`
- `git diff --check 3b61d495f74bcf1265b39da1e791ad1102fb5227..8bf3a06770882054bbd116c9caf7e938f483d88e`
- `git log --oneline 3b61d495f74bcf1265b39da1e791ad1102fb5227..8bf3a06770882054bbd116c9caf7e938f483d88e`
- `git diff --name-status 3b61d495f74bcf1265b39da1e791ad1102fb5227..8bf3a06770882054bbd116c9caf7e938f483d88e`
- `git diff 3b61d495f74bcf1265b39da1e791ad1102fb5227 8bf3a06770882054bbd116c9caf7e938f483d88e -- apps/api/src/pending-action/required-access.ts tests/api-integration/view.test.ts`
- targeted `sed`/`rg` reads of `required-access.ts`, `deletion-targets.ts`, `view/policy.ts`, `view/assert-can-edit-view.ts`, `view/index.ts`, `packages/permissions/src/roles.ts`, capability definitions, `docs/03-features/search-and-saved-views.md`, and `docs/07-planning/decision-log.md`.

No tests or database/browser/heavy suites were run. The author's focused/full view, typecheck, route-policy and OpenAPI counts remain author-provided receipts, not independent executions in this review.

## Findings and disposition

1. **Prior blocker: team-view owner/workspace-manager pending deletion after leaving the team — RESOLVED for the reviewed behavior.** The evaluator first verifies that the referenced team exists in the target workspace, then allows a caller outside its current membership only when they are the saved view's creator or can exercise `workspace:manage_settings`. All other nonmembers still receive the reach/404 denial. The change remains inside the existing specialized `DELETE /api/views/{id}` pending-action evaluator; it does not introduce a route, capability, table, or broader policy.

   The route policy and existing post-policy guard remain in force after this reach exception. The saved-view delete policy still requires `saved_view:create` and declares its existing owner predicate; policy evaluation also still requires workspace reach, target scope/version consistency, and the existing credential identity checks. The final guard still prevents a nonowner from deleting unless they have `workspace:manage_settings`. Built-in `manager` has both `workspace:manage_settings` and `saved_view:create`; built-in `owner` has every non-instance capability. The new integration coverage creates a manager with the built-in manager role and verifies deletion request plus approval/execution outside the team, an owner who leaves the team and verifies retained read plus request/approval/execution, and a workspace-only member who receives 404 with no pending action. Existing manager-hidden read/pin/count behavior remains asserted.

2. **Unauthorized team reach and cross-workspace audience integrity — PASS by inspection.** The exception is limited to the same saved-view owner or workspace manager and does not bypass team existence or team-to-workspace matching. A caller who is neither remains denied. No team-lead editing, ownership transfer, or team-membership authorization was added. This matches the owner decision holding team-lead editing and automatic ownership transfer and the feature spec's preserved owner/workspace-manager rules.

3. **Target/version/capability/credential and pending-action terminal behavior — no delta regression found.** The unchanged evaluator still locks/loads the saved-view row, checks workspace scope and captured version, executes the same route-policy evaluation, and applies the manager-or-owner guard. The surrounding saved-view approval code still maps lost credential to terminal `credential_revoked`, lost reach to `reach_lost`, and removed capability to `capability_removed`; natural session expiry remains treated as reauthentication rather than explicit credential revocation, while explicit revoke/disable and natural API-key expiration retain the established terminal invalidation path. The delta changes only the team audience reach predicate and does not weaken those checks. This is static inspection, not a newly executed lifecycle test.

4. **Earlier WF-19 authored `set_field` effect finding — OPEN / WAITING, not reviewed or cleared here.** This code/test delta does not touch workflow transition effect execution. The prior ordinary review's blocker remains subject to the recorded owner/spec decision path; this report provides no approval to implement, waive, or close it.

## Residuals and limits

The registry and route middleware continue to require `saved_view:create` for deletion, including the `orOwner` declaration. That is existing behavior and is consistent with the direct route's declared policy and built-in owner/manager role grants; this delta does not broaden it. A hypothetical editable custom role that retains `workspace:manage_settings` but removes `saved_view:create` would not pass the route's existing capability middleware/policy. I found no evidence in this delta that custom-role capability narrowing is newly introduced or that this implementation changes that contract, so it is not a delta blocker; the documented manager guarantee is verified for the built-in role. No schema/migration/dependency/route-registry changes occur.

This is a narrow static delta review. It is not full integration, concurrency, DB, browser, source-origin, or release acceptance, and author-reported test results do not substitute for the deferred coherent-batch runtime acceptance.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110890397
SHA-256: `de701efc7605b59722a40fcc8c3346040962cfcaee41f072a91cd338a3d4f52d`

# S7 WF-19 `set_field` disposition review

## Status

**BLOCKED: stored-transition refusal is not consistently enforced at the workflow-version boundary.** Authoring rejection and the selected-transition no-mutation guard are implemented. However, WF-22 calls a version with an unavailable/unknown authored effect invalid, and the new domain validator reports a whole version containing `set_field` invalid while the transition endpoint does not consult version validity and only refuses when the requested matched transition itself contains `set_field`. A mixed legacy version can therefore be invalid in the validation contract while still allowing its other transitions to execute. The implementation needs a consistent, explicit interpretation of this boundary before this blocker can close.

## Candidate and independence

- Exact candidate: `b9e44651a9edff5bc3cf46d07969b5cd5dd9cad1`
- Parent/delta base: `8bf3a06770882054bbd116c9caf7e938f483d88e`
- Accepted integration base: `12c09aaca85250c03223df1ed191275c0d3cdd74`
- Worktree: `/Users/heinthura/.codex/worktrees/s7-teamview-delete-owner/Ticketing.v2`
- Raw delta manifest: one commit, `b9e44651 fix: reject held workflow field effects`; 12 changed paths: `apps/api/src/work-item/controllers/transition-work-item.ts`, `apps/api/src/work-item/index.ts`, `apps/api/src/work-item/response.ts`, `apps/api/src/workflow/schema.ts`, `apps/site/content/service-operations.md`, `docs/03-features/workflows.md`, `packages/domain/src/workflow/types.ts`, `packages/domain/src/workflow/workflow.test.ts`, `packages/domain/src/workflow/workflow.ts`, `tests/api-contract/openapi.json`, `tests/api-integration/work-item-transition.test.ts`, and `tests/api-integration/workflow.test.ts`.
- This is a fresh independent review of the candidate disposition, not an authoring/remediation pass. My prior saved-view team-delete delta CLEAR remains source-bound to `8bf3...` and is unaffected by this review.
- Requested tier/selector: GPT-6 Luna. The task interface identifies the requested Luna lane but does not provide a verifiable serving-model selector; I do not claim platform attestation of the exact model identity.

## Owner decision and contract reviewed

The direct owner answer in `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/workflow-set-field-owner-decision.json` authorizes holding `set_field`, rejecting it during authoring, and rejecting execution of already-stored transitions containing it without changing the work item. It explicitly forbids guessing a field namespace. The candidate follows those terms at the request and selected-transition levels.

The owning workflow spec's existing WF-22 semantics say an authored effect outside the available WF-19 vocabulary makes the **workflow version invalid**. The candidate now additionally says held `set_field` is rejected during authoring and fails closed if found in a previously stored transition. These statements leave open whether a legacy version containing one held transition remains executable through other edges. That cannot be inferred from the owner answer's narrower stored-transition wording.

## Scope and checks actually performed

Read the complete delta and surrounding execution, workflow creation/validation, response schema, WF-19/WF-22 requirements, and focused tests. Commands run:

- `git rev-parse HEAD`
- `git status --short`
- `git log --oneline 8bf3a06770882054bbd116c9caf7e938f483d88e..b9e44651a9edff5bc3cf46d07969b5cd5dd9cad1`
- `git diff --name-status 8bf3a06770882054bbd116c9caf7e938f483d88e..b9e44651a9edff5bc3cf46d07969b5cd5dd9cad1`
- `git diff 8bf3a06770882054bbd116c9caf7e938f483d88e b9e44651a9edff5bc3cf46d07969b5cd5dd9cad1 -- [changed source/spec/test paths]`
- `git diff --check 8bf3a06770882054bbd116c9caf7e938f483d88e..b9e44651a9edff5bc3cf46d07969b5cd5dd9cad1`
- Targeted `sed`/`rg` reads of transition matching/execution, workflow creation and version-validation controller, workflow domain validator, workflow schemas/responses, WF-19/WF-22 spec, and integration/domain tests.

No test suite, database, browser, or heavy runtime check was run. The newly added integration/domain test assertions and the generated OpenAPI change were inspected but not executed or independently regenerated.

## Findings

1. **BLOCKER — whole-version validity and selected-edge execution disagree.** `validateWorkflowVersion` iterates every transition in the version and returns invalid if any stored transition has `set_field`. This is consistent with WF-22's version-invalid language. `transitionWorkItem`, however, does not call that validator or otherwise reject an invalid active version. It first finds the requested legal transition and only then checks `match.effects.some(kind === "set_field")`. Consequently, if a historical active version contains both a held `set_field` edge and an unrelated available edge, that available edge can still run even though the same version is reported invalid. The added integration test uses a single transition containing `set_field`, so it proves no mutation for that selected edge but does not establish mixed-version behavior.

   This is not a request to infer extra semantics. The owner answer directly says to reject stored transitions containing `set_field`; WF-22 independently defines invalidity at the version level. Either execution must enforce the version-level invalidity consistently, or the owning WF-22/spec decision must explicitly scope legacy `set_field` rejection to the selected edge and explain why version validation marks the version invalid. Until one contract is selected and tested, the candidate's behavior is ambiguous/inconsistent.

2. **Authoring rejection — PASS by inspection.** `authorableEffectSchema` omits `set_field` while response `effectSchema` retains the historical shape. Create-version body parsing rejects new authoring before persistence. The new integration test checks 400 and that no workflow-version row is created. This preserves round-trip recognition of old rows and does not invent the missing field namespace.

3. **No partial effect/work-item mutation on the selected held edge — PASS by control-flow inspection; test added, not run.** The held-effect guard occurs after matching a legal transition but before target resolution, effect preparation, and the database mutation transaction. It throws the established 422 blocked response with an empty `blockedBy` and explanatory message. The added integration test seeds other mutating effects (assignment, SLA pause, schedule, approval) and asserts unchanged work-item/SLA/schedule/approval/activity/event state. This is appropriately stronger than merely checking the state column; the assertions have not been executed in this review.

4. **WF-22 treatment of other unsupported/automatic kinds — no new issue found.** `validateWorkflowVersion` still rejects effects outside the available authorable set and automatic `resolve_sla`/`reopen_sla`; held `set_field` gets a specific rejection. Workflow creation validates all supplied transitions before inserting a version. The response schema recognizes old `set_field`, while the request schema does not accept it. The OpenAPI diff appears scoped to request-side authorability and transition response documentation; it was not regenerated here.

## Disposition and residuals

The owner decision itself is sufficient authorization for the narrow hold/reject behavior; no further owner decision is needed to reject the selected stored edge. But the candidate is not clear because it leaves WF-22's version-level invalidity inconsistent with runtime execution for other edges in a legacy mixed version. Preserve this blocker pending a coherent contract and regression coverage for a version containing both held and supported transitions. Do not use this report to claim complete S7 acceptance or close unrelated pending findings.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110890597
SHA-256: `55b2f7fefe5db15c4a5a81dbe92afac64f8c16676c1e315f2d80c8867809dab9`

# S7 refusal cross-package ordinary review

- **Verdict:** PASS — no blocking or non-blocking findings in the assigned scope.
- **Candidate:** `b9e44651a9edff5bc3cf46d07969b5cd5dd9cad1`
- **Comparison base:** `3b61d495f74bcf1265b39da1e791ad1102fb5227` (includes the prior `8bf3a06770882054bbd116c9caf7e938f483d88e` owner-authorized work plus this remediation).
- **Source:** `/Users/heinthura/.codex/worktrees/s7-teamview-delete-owner/Ticketing.v2`
- **Reviewer identity:** GPT-6 (platform-visible label; this context exposes no GPT-6 Luna selector or more specific model version).
- **Role and independence:** fresh independent ordinary reviewer context, assigned by the conductor; did not author, direct, or remediate the candidate. Review was limited to the named cross-package refusal and team-view deletion remediation. This is not whole-S7 acceptance, a security review, or a phase finalizer.

## Checked

Read the repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/07-planning/active-mission.md`, workflow and saved-view specs, the complete candidate diff, and the named owner decision receipts and `set-field-owner-handoff.md`. Traced stored workflow loading, transition matching, effect evaluation, transition response mapping, authoring schemas, pending-action request/approval access checks, route policy, and regression assertions.

The owner receipt authorizes holding `set_field` for this release, rejecting new workflow authoring and refusing execution of a stored matching transition before work-item mutation, without inventing field semantics or a new response contract. The candidate implements this coherently across domain types/validation, API authoring schemas, transition execution, API contract documentation and `docs/03-features/workflows.md`. The historical `Effect` shape remains recognizable, while the separate authorable union omits `set_field`. `validateWorkflowVersion` rejects the held kind for authored/validated versions. For an already stored version, `transitionWorkItem` checks the selected matching edge before effects are resolved and before opening the transaction; it returns the existing 422 blocked-transition response shape (`message`, empty `blockedBy`) without a new reason code. This selected-transition refusal follows the explicit owner decision and WF-22; invalidating every other transition in that stored workflow version would be broader than the stated execution refusal.

The team-view delete adjustment is scoped to approval-time saved-view reach in `evaluateWorkspaceDeletionAccess`: when a team audience exists in the same workspace, a creator who has left the team or a workspace manager retains the deletion path; other non-members remain masked as 404. The evaluator still applies the declared `saved_view:create` plus `orOwner` policy and the additional creator/workspace-manager ceiling. Workspace match, team existence/workspace, target-version checks, credential checks, and pending-action approval/recheck flow remain in force. Existing route policy and pending-action semantics are unchanged. Regression coverage checks a workspace member without the elevated permission remains 404, a workspace manager can request and approve deletion, and a view owner can still read/request/approve deletion after leaving the team. These changes do not introduce a team contract or new capability/schema/route/UI.

## Verification

- `pnpm --filter @taskdesk/domain exec vitest run src/workflow/workflow.test.ts` — passed, 1 file / 173 tests.
- `git diff --check 3b61d495f74bcf1265b39da1e791ad1102fb5227..HEAD` — passed.
- Read the author’s retained evidence for the scoped API regressions, API/domain typechecks, OpenAPI, and route-policy checks, including their counts and prior failed attempts. I did not independently rerun API integration tests or use a database window.
- No product files changed during this review. Worktree status was clean at review end.

## Residual scope

This verdict does not establish runtime/browser acceptance, full S7 acceptance, security-review clearance, or stage completion. Those remain outside this review assignment.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110890850
SHA-256: `74ad1bea272c3b91832f2b125c68c7fe6423865dba25cc9275e8472cbd8c55b5`

# Supplemental disposition — WF-22 mixed historical workflow claim

- **Disposition:** No blocking contract mismatch established for the exact claim reviewed.
- **Candidate:** `b9e44651a9edff5bc3cf46d07969b5cd5dd9cad1`
- **Base:** `3b61d495f74bcf1265b39da1e791ad1102fb5227`
- **Reviewer:** GPT-6 (platform-visible label; this context exposes no GPT-6 Luna selector/version), same fresh independent reviewer context as the original cross-package review. This is a supplement; the original report remains unedited.
- **Scope:** Whether version-level `validateWorkflowVersion` rejection of a held effect on any edge conflicts with selected-edge-only refusal during execution of a pre-existing stored version.

## Evidence and disposition

The claim is factually accurate about the code paths: `validateWorkflowVersion` adds an error for a transition containing `set_field`, so a version submitted to `create-workflow-version.ts` is rejected as a whole. The work-item transition path loads persisted rows without revalidation (`workflow-transition-context.ts` explicitly says validation is at write time), then `transitionWorkItem` refuses when the selected matching transition contains `set_field`. As a result, another selected edge in the same already-stored version can execute if that edge has no held effect.

The governing text distinguishes those cases. WF-22 says an authored effect outside the available vocabulary makes the authored workflow version invalid; it separately says the held `set_field` shape is rejected during authoring and fails closed if found in a previously stored transition. WF-19 and the held-effect note say a previously stored transition containing it is refused before work-item state/effect change. The direct owner answer likewise authorizes rejection of “execution of already stored transitions containing it,” with no field semantics. None of these statements says that encountering one held effect in historical JSON disables every other edge in that already-stored version. The owner-approved distinction is therefore coherent: version-level invalidity blocks authoring/persistence of new invalid versions; runtime compatibility preserves the historical shape but blocks execution of the selected edge containing it.

This conclusion depends on “invalid workflow version” in WF-22 applying to authoring/validation, rather than silently imposing a new global runtime disablement for already-stored versions. That reading is grounded in the separate WF-22 historical-transition clause, the owner question’s transition-level wording, and the implementation comment that validation is performed at write time. If the product intends historical stored versions to become wholly unusable whenever any edge contains a held effect, that would be a broader behavior than the direct owner decision currently records and needs an explicit spec/owner decision; it is not established by the reviewed text.

## Checks

Read the direct owner decision receipt, WF-19/WF-22, the version validator, its create-version call site, stored transition loader, and execution guard. No tests were run; the question was resolved by contract and call-path inspection. No source files were edited.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110891103
SHA-256: `261be1b3681f9ad54c9aec965d41502f4dad5a9e2b7222a5fdf2b090e1301c36`

# S7 WF-19 mixed-version blocker closure review

## Status

**CLEAR for the previously reported WF-22 mixed-version execution blocker.** The owner explicitly settled the boundary: reject newly authored versions containing `set_field`; in a historical mixed version refuse only the selected `set_field` edge; supported siblings remain usable. The current spec, guide, controller documentation, and mixed-version regression test now state or exercise that distinction. The earlier BLOCK report is preserved unchanged as the historical finding; this report closes that finding only at the new exact candidate.

## Candidate, lineage, and independence

- Exact candidate reviewed: `cfe36aa4f3071855770b25693ee44bce2bf8a4d3`
- Parent/delta base: `3dba48821d52ba5e04a13ad654a184f2aa42b648`
- Accepted base: `12c09aaca85250c03223df1ed191275c0d3cdd74`
- Worktree: `/Users/heinthura/.codex/worktrees/s7-teamview-delete-owner/Ticketing.v2`
- Delta commits: one commit, `cfe36aa4 docs: clarify held workflow effect scope`.
- Delta manifest: `apps/api/src/work-item/controllers/transition-work-item.ts`, `apps/site/content/service-operations.md`, `docs/03-features/workflows.md`, and `tests/api-integration/work-item-transition.test.ts`.
- The earlier implementation commit `b9e44651a9edff5bc3cf46d07969b5cd5dd9cad1` is an ancestor and remains intact. The accepted-base-to-candidate history also includes the existing S7 integration/decision composition; this review is scoped to the prior WF-22 blocker and checks the relevant implementation and regression path, not a fresh broad S7 review.
- Fresh independent review; I did not author, direct, or remediate this candidate. The earlier review report remains available at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/E/s7-set-field-blocker-closure-luna.md` and is not edited by this closure report.
- Requested review selector: GPT-6 Luna. The task interface does not expose a verifiable model-serving selector, so this records the requested Luna lane without claiming platform attestation of the exact serving model.

## Owner decision and scope

The exact owner receipt is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/workflow-mixed-version-owner-decision.json`: **“Refuse only transitions containing set_field”**, with new authored versions rejected, supported historical siblings usable, and no field namespace/value semantics introduced. This resolves the previously open interpretation without broadening the held-effect contract.

## Checks actually performed

Read the exact owner decision and author handoff, candidate delta and history, controller selection/refusal order, workflow request/response/domain effect schemas and validator, updated WF-19/WF-22 text, site guide, and focused integration test. Commands run:

- `git rev-parse HEAD`
- `git status --short`
- `git log --oneline --reverse 12c09aaca85250c03223df1ed191275c0d3cdd74..cfe36aa4f3071855770b25693ee44bce2bf8a4d3`
- `git log --oneline --decorate 3dba48821d52ba5e04a13ad654a184f2aa42b648..cfe36aa4f3071855770b25693ee44bce2bf8a4d3`
- `git diff --name-status 3dba48821d52ba5e04a13ad654a184f2aa42b648..cfe36aa4f3071855770b25693ee44bce2bf8a4d3`
- `git diff 3dba48821d52ba5e04a13ad654a184f2aa42b648 cfe36aa4f3071855770b25693ee44bce2bf8a4d3 -- [four changed paths]`
- `git diff --check 3dba48821d52ba5e04a13ad654a184f2aa42b648..cfe36aa4f3071855770b25693ee44bce2bf8a4d3`
- Targeted `rg`/`sed` reads of the workflow code, specs, and tests.

No tests, DB, browser, or heavy runtime checks were executed by this reviewer. The handoff's earlier API/domain test outputs are author-supplied receipts and are not counted here as independent executions.

## Findings and disposition

1. **Prior BLOCK: invalid-whole-version versus selected-edge refusal — RESOLVED by owner choice and clarified behavior.** `workflow-mixed-version-owner-decision.json` directly chooses supported sibling usability. The existing executor checks the selected matched transition's effects and returns 422 before effect preparation or mutation when that edge carries `set_field`; it does not globally disable sibling edges. The previous report accurately identified this behavior/spec question at `b9e44651`; the answer and current source/spec evidence now settle it.

2. **The mixed-version integration regression covers both halves — PASS by source inspection; not rerun here.** Its fixture writes a historical version directly into the tables, including one transition with `set_field` plus `clear_assignee`, `pause_sla`, and `schedule_transition`, and a supported sibling edge from the same state. It asserts 422 for the held edge and no work-item state/version/assignee change, no SLA pause or scheduled row, unchanged approval states, no transition activity/audit/event. It then selects the sibling and asserts 200, the expected state/version change, preserved assignee, and the transition event. This directly exercises selected-edge refusal and supported-sibling usability without routing the legacy row through current authoring validation.

3. **New-authoring rejection and no invented semantics — PASS, preserved from parent.** The earlier candidate's authorable request schema excludes `set_field`; the stored/response schema still recognizes its historical JSON shape, and domain validation rejects new versions containing it. No field namespace, value contract, schema, migration, or dependency was added in this clarification delta.

4. **WF-19/WF-22 and guide — CLEAR with a small wording residual.** WF-19 now distinguishes version validation of newly authored versions from runtime handling of historical mixed versions: only selecting the held edge is refused and supported siblings remain usable. The service-operations guide and controller comment say the same. WF-22 still states the general whole-version invalidity rule for authored effects outside the available vocabulary and separately says held `set_field` is rejected during authoring and fails closed in stored transitions. Read together with the explicit WF-19 legacy-mixed rule and the settled owner receipt, this is coherent: version validation rejects the held kind, while runtime execution of an already-stored mixed version only blocks its held selected edge. For maximum clarity, WF-22 could restate that selected-edge exception, but it is nonblocking on this candidate because WF-19 now explicitly defines it and the owner chose it.

5. **Stale controller rationale — RESOLVED.** The controller comment now correctly says the field namespace and value rules have not been defined instead of claiming the sole reason was a missing custom-field value store.

## Limits

This closes only the WF-22 mixed-version blocker at `cfe36aa4...`. It does not clear other S7 findings, establish full S7 integration acceptance, or replace deferred current-head runtime acceptance. No browser, primary image, full API, permissions, or full S7 suite was run here.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110891324
SHA-256: `938606a1cd169862995f325e2d3b626fc9becacb9a95847099b225beaa169e71`

# S7 held-effect delta — third ordinary Luna review

- **Model / role:** GPT-6 Luna, independent ordinary cross-package reviewer.
- **Candidate:** `cfe36aa4f3071855770b25693ee44bce2bf8a4d3`.
- **Comparison base:** `3b61d495f74bcf1265b39da1e791ad1102fb5227`.
- **Checkout:** `/Users/heinthura/.codex/worktrees/s7-teamview-delete-owner/Ticketing.v2`.
- **Independence:** Fresh reviewer context; did not author, direct, or remediate this batch. Root selector/conductor is separate. No other reviewer report was used as a substitute for source inspection.
- **Scope:** All intervening commits, including `8bf3a067` (saved-view owner reach), `b9e44651` (held set_field authoring/execution), `0978d77e` (owner decision record), `3dba4882` (main merge), and `cfe36aa4` (mixed-version scope clarification); API/domain/spec/OpenAPI/tests plus pending-action reach guard. This is a bounded candidate review, not whole-S7 acceptance or a phase finalizer.

## Verdict

**PASS — no blocking or non-blocking findings.** The candidate implements the recorded owner boundary without introducing field semantics or namespace assumptions. The saved-view reach exception is narrowly evaluated for an existing owner or workspace manager during approved deletion; it does not make the view visible through ordinary view operations or grant team membership.

## Checks

- Read repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, workflow WF-19/WF-22 spec, and the three supplied owner decision records.
- Compared the exact candidate against the exact base and inspected the changed API schemas/controllers, domain validation/types, pending-action reach evaluation, workflow spec, OpenAPI delta, and integration/domain regression changes.
- `pnpm --filter @taskdesk/domain test` — **PASS**, 19 files / 666 tests. This was a bounded package suite, not the repository suite.
- No API/database integration tests, browser checks, build, image, or deployment were run.

## Review notes

- `authorableEffectSchema` excludes `set_field`, while stored-response `effectSchema` retains its typed shape. Domain version validation rejects the held kind (and unknown/automatic kinds remain rejected). This aligns with the owner’s “reject new version” choice.
- Execution checks the selected matched edge for `set_field` and throws `TransitionBlockedError` before transaction work begins. The route maps that error to the existing 422 `{ message, blockedBy }` response; the new held-effect refusal uses an empty `blockedBy` array and adds no new reason code. Supported sibling edges remain matchable and executable. The regression exercises a held edge carrying clear-assignee, SLA-pause, schedule, and approval data, verifies no work-item version/state/assignee, pause, schedule, approval, activity, audit, or event mutation, and then executes the supported sibling. The test does not assert exact 422 message/blockedBy contents; source mapping and response schema were inspected and are consistent.
- Mixed historical response recognition preserves `set_field`’s field/value shape. The docs now distinguish current authoring from recognizing historical JSON and explicitly scope refusal to the selected held edge.
- The saved-view deletion exception first validates the shared team still exists in the target workspace, then permits the former-team owner or a workspace manager to proceed to the existing policy and owner/manage-settings checks. Non-owner/non-manager outsiders still fail reach, and downstream credential, target version/scope, capability, ownership, and confirmation/pending-action gates remain in place. The integration additions cover a workspace manager’s hidden list/get/run/count/pin reach with approved deletion, refusal for an ordinary workspace member, and owner access/deletion after leaving the team.

## Residuals

The full API integration behavior and current hosted CI remain outside this review’s evidence. This verdict applies only to the exact candidate and scoped code above; it does not claim S7 acceptance, security-review completion, or phase completion.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110891492
SHA-256: `c06ae3a383a1157acbd1510c2498bdc1f7bec4891378614e71f8494bf7bebb71`

# S7 current-head security review — coherent selected slice

- **Verdict: BLOCKED** on one authorization-contract finding below. This is a source security review, not S7 acceptance, runtime proof, a stage finalizer, or merge authorization.
- **Reviewed head:** `cfe36aa4f3071855770b25693ee44bce2bf8a4d3`.
- **Accepted integration base:** `0978d77e73c66c0ab56b45806ad51f8e2aef6271`.
- **Selected original source:** `b7925812cc409c5253c2e36c35ba08a381b78fa3`, verified as an ancestor. The intervening branch history preserves the original source and adds `9030cfe3` (accepted records merge), `3b61d495` (ordered SLA effects), `8bf3a067` (saved-view owner delete reach), `b9e44651` (held field effect), `3dba4882` (accepted main merge, parent `0978d77e`), and `cfe36aa4` (mixed-version clarification). The accepted-base diff is 116 files, 26,798 insertions and 4,006 deletions, including 12,452 lines of OpenAPI fixture churn; this is not a claim that every line was independently executed.
- **Reviewer independence:** Fresh, read-only reviewer context; I did not author, direct, or remediate this candidate, and did not merge or delegate it. The assignment requested a full Sol-tier review. Platform-visible identity says GPT-6 family but exposes no independently verifiable serving variant, so this report does **not** attest a specific GPT-6 Sol binary/model. The selector/conductor must decide whether its platform metadata satisfies the Sol-tier gate.

## Blocking finding — saved-view workspace manager authority is narrowed by the route policy

`docs/03-features/search-and-saved-views.md` says PATCH and DELETE of a view are permitted for `workspace:manage_settings` **or** the row owner with `saved_view:create` (API table, lines 144–145); Thomas's held-team decision explicitly preserves existing workspace-manager editing and owner access. The implemented route middleware requires `saved_view:create` before either operation (`apps/api/src/view/index.ts:165-168,259-262`). The declared route policy uses `saved_view:create` as its primary capability and also on the owner branch (`apps/api/src/view/policy.ts:91-113`). The pending-action request/approval evaluator applies that same primary policy (`apps/api/src/pending-action/required-access.ts:342-369,489-503`) before its later `workspace:manage_settings` check. `workspace:manage_settings` implies only `workspace:read` (`packages/permissions/src/capabilities.ts:116-121`). A concrete permitted identity shape is a built-in manager using an API key scoped to `workspace:manage_settings` but not `saved_view:create`: the role holds both grants, but API-key authority is an intersection with stored key scope (`apps/api/src/utils/require-api-key-permission-scope.ts`), so this manager gets 403 before creating a deletion request despite the spec's manager branch. A pending request made with a wider key and then narrowed to retain only `workspace:manage_settings` is invalidated as `capability_removed` by the same evaluator (`apps/api/src/pending-action/credential-invalidation.ts:829-855`), though manager authority is still present through the retained key scope. Built-in manager sessions have both grants, masking this case in current tests. The documented future custom workspace role with `manage_settings` alone would also be denied, but this review does **not** claim that the current legacy custom-role writer makes that role executable: `require-workspace-capability.ts` explicitly says it recognizes built-in workspace roles only. This is a denial of documented authority and a registry/runtime/matrix mismatch, not a cross-tenant escalation. Reconcile the exact documented OR across route admission, edit guard, PA request/approval and key-scope loss handling without widening view read/run/pin or team membership; cover the bounded API-key scenario in regression evidence and re-review the repaired exact head.

## Checked mechanisms and limits

- Read `AGENTS.md`, active mission, agent workflow, `CLAUDE.md`, CI security-scope/model policy, owning SLA/calendar/search/views/workflow/pending-action and RBAC contracts, ADR 0009, current decision log, and the four original owner-response receipts. The owner responses keep ordinary session expiry recoverable, explicit revocation and key expiry terminal, team-lead edit/automatic transfer held, and only a selected historical `set_field` edge refused.
- Compared the exact base and branch ancestry; inspected route policies and middleware, permission evaluator and capability implication, PA9 request/approval/credential/access-loss paths, native/OIDC/SCIM lifecycle ordering, view reach and query execution, search project filtering, workflow held-edge ordering, calendar/SLA repository scopes, and tenant composite migrations. `git diff --check 0978d77e...cfe36aa4` passed. No source files were changed.
- The new calendar, SLA, saved-view, and search paths use workspace/target scope checks; the saved-view team FK is composite on `(workspace_id, shared_with_team_id)`, and work-item search filters results to project IDs resolved through current identity and project-read checks. I did not identify a second demonstrable cross-tenant leak in the inspected paths. This is bounded source inspection, not a database concurrency proof.
- PA creation and both new deletion approvals acquire the pending-action lifecycle gate before target/credential reads; approval locks the action and target, verifies request payload/hash, exact target scope/version, requester session, original key status and permissions, and reevaluates current route policy. The explicit credential writer invalidates in the same transaction, and expiry extension after natural key expiry invalidates before updating the key. Workspace authority writers capture access before and reevaluate after mutation under the same lifecycle gate. I did not run a concurrent database reproduction; source reasoning remains the evidence.
- Loss of `saved_view:create` by an owner who has no `workspace:manage_settings` correctly denies the owner branch, subject to the PA9 terminal access-loss rule. Loss of `saved_view:create` while `workspace:manage_settings` remains should leave the manager branch available under the published OR contract, but current route/policy/key-writer evaluation denies it as described above. Loss of both grants denies; restoration must not revive a genuinely invalidated action. These are distinct cases, and the current built-in role matrix alone cannot distinguish them.
- Historical workflow `set_field` is retained only for response recognition. New authoring rejects it, and the selected historical edge is refused before mutation while supported siblings remain executable. Ordered pause/resume effects run in their authored sequence. This matches the recorded owner holds in the inspected code; D1 reopen/manual SLA continuity and F3 export remain held.
- Existing ordinary reports and prior integration receipts were read as **prior-source evidence only**. I ran no API/database integration test, browser journey, full suite, container/image, health check, hosted CI, or stage finalizer on this head. The older full integration result and the current root-owned verification are not converted into current-head success by this report.

**Disposition:** The current candidate is blocked for security-review gate purposes until the saved-view policy mismatch is repaired and independently reviewed on the resulting exact head. Even after that, full current-head test/CI/runtime gates and model provenance remain separate requirements.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110891685
SHA-256: `c67c0d5058ec94ac4757fdfec1b73f07b1db1080c3f79e2b17cce066cf9ad771`

# S7 saved-view manager-or-owner repair — ordinary review A

- **Candidate:** `aad14ff02c193353fdd85d4a63e83518b43f0e42`
- **Comparison base:** `cfe36aa4f3071855770b25693ee44bce2bf8a4d3`
- **Independence:** Fresh read-only reviewer context. I did not author, direct, or remediate this change. No source files were edited.
- **Model selector:** GPT-6 Luna was explicitly selected for this review. The runtime exposes no verifiable serving-variant metadata, so I cannot independently attest which exact model variant served it.
- **Verdict:** **PASS WITH NON-BLOCKING TEST GAP** for this bounded ordinary review. I found no remaining authorization mismatch in the inspected paths. This does not clear the separate required GPT-6 Sol security review or full acceptance gates.

## Review

The prior Sol report identified a real documented-policy mismatch: the spec grants PATCH/DELETE to `workspace:manage_settings` OR the row owner with `saved_view:create`, while admission and pending-action evaluation effectively required the create capability. The candidate makes the policy's primary branch `workspace:manage_settings` and retains `saved_view:create` as the `orOwner` branch for both PATCH and DELETE.

The route admission helper uses workspace and creator facts populated by `workspaceAccess.fromSavedView()`, resolves the caller person, and calls the shared OR authorization helper. That helper checks each branch as a conjunction of role capability and credential scope. The owner predicate alone grants nothing. PATCH rechecks the same helper against the locked persisted row inside the transaction, closing the middleware-to-write race. Workspace visibility promotion still has its separate `workspace:manage_settings` check, and team audience changes still require `saved_view:share` plus target-team membership.

Pending-action request/approval access evaluates the same registry policy against current identity and key scope. Its extra non-owner check is consistent: a non-owner must have manager authority; an owner can pass through either policy branch. The deletion executor verifies the registered manager primary branch plus exact owner-branch predicate/capability before proceeding, and reevaluates current access before deletion. The existing PA lifecycle makes a lost required branch invalidate the action; restoration cannot revive an already terminal `invalidated` row. The author’s added API case exercises narrowing a key from both branches to manager-only and confirms the request remains pending and executes. Existing saved-view integration coverage also exercises terminal role-loss invalidation and non-revival after role restoration, though that case uses a session credential.

Team-view masking remains in place: an inaccessible nonmember of a team view receives the established masked 404 on a denied edit attempt. Read, run, count, pin, and team membership admission were not widened by the changed middleware. The capability registry and role definitions are unchanged; `builtInRoleHasCapability` rejects custom role slugs, so the helper does not create custom-role widening.

## Checks actually run

- `git diff --check cfe36aa4f3071855770b25693ee44bce2bf8a4d3 aad14ff02c193353fdd85d4a63e83518b43f0e42` — passed.
- `pnpm check:route-policy` — passed.
- `pnpm --filter @taskdesk/permissions exec vitest run src/evaluator.test.ts src/scope.test.ts` — 2 files, 87 tests passed.
- `pnpm test:permissions` — 14 files, 88 tests passed; route coverage, matrix and route-policy coverage included.
- I did not run DB/API integration, migration, browser, container, or hosted CI checks. The author’s handoff reports its own focused API and file-level DB test results; those are author evidence, not tests run by this reviewer.

## Non-blocking follow-up

The changed integration tests cover owner-only PATCH admission and manager-only PATCH/DELETE plus manager-branch retention after key narrowing. They do not directly exercise a saved-view deletion requested by an API key with only `saved_view:create`, followed by loss of that grant (and optionally restoration), nor the case where both branches are removed. Source tracing and existing generic terminal-invalidation coverage support the intended terminal behavior, so this is not a blocker to this ordinary review; a targeted regression would make the new route-specific branch semantics more explicit.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110891905
SHA-256: `31d496f3d3d89bc353ebf1efe2ec929ca58657496ba345f95820cdbe24db300d`

# S7 saved-view manager-or-owner repair — ordinary review B

- **Candidate:** `aad14ff02c193353fdd85d4a63e83518b43f0e42`
- **Comparison base:** `cfe36aa4f3071855770b25693ee44bce2bf8a4d3`
- **Independence:** Fresh, read-only reviewer context. I did not author, direct, or remediate the candidate. No source files were edited.
- **Model dispatch / serving:** This review was assigned as GPT-6 Luna. The execution surface does not expose a verifiable serving-variant identity, so I cannot independently attest that the actual serving model was GPT-6 Luna. The conductor must decide whether dispatch metadata satisfies the Luna review tier.
- **Verdict:** **PASS WITH NON-BLOCKING TEST GAP** for ordinary review. The manager-or-owner authorization repair is coherent across the inspected runtime and pending-action paths. This is not security-review clearance or merge authorization.

## Review

The prior Sol blocker matches the documented contract: PATCH and DELETE admit `workspace:manage_settings` OR row owner with `saved_view:create`. The repair declares manager capability as the route policy's primary branch and owner/create as its `orOwner` branch. Admission uses persisted row facts from the saved-view workspace lookup; the shared helper checks both capability and API-key scope for each branch and requires unambiguous workspace membership. PATCH repeats authorization against its locked row in the update transaction. Team audience promotion still has separate `saved_view:share` and target-team membership checks.

Pending-action request/approval reevaluates the registry's OR policy with the current identity and credential scope. The extra non-owner manager check is consistent with the documented alternatives. The executor verifies the exact manager-primary / owner-create policy and rechecks access against the locked target. Key narrowing that retains `workspace:manage_settings` therefore remains authorized even when `saved_view:create` is removed; the new integration case executes the request after narrowing. Losing the only qualifying owner/create branch invalidates access; if every qualifying branch is lost, the saved-view role-loss integration case establishes terminal `invalidated` state and verifies role restoration does not revive it. Read/run/count/pin routes and team membership are outside the changed admission middleware. The changed permission fixture correctly changes member/lead in-reach edits from allow to 403 under the documented policy.

The new integration file directly covers manager-only PATCH/DELETE, owner/create PATCH, and owner deletion with a key narrowed to manager-only followed by approval. Existing cases cover owner-only key loss at approval and role-based capability loss with restoration. A focused API-key case that removes both branches and then restores the key scope is absent; the evaluator's terminal transition and the role restoration case make this a non-blocking, route-specific test gap.

## Checks run

- `git diff --check cfe36aa4f3071855770b25693ee44bce2bf8a4d3 aad14ff02c193353fdd85d4a63e83518b43f0e42` — passed.
- Actual database-backed integration file: `pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts tests/api-integration/view.test.ts` — **1 file, 31 tests passed** against the assigned retained database. Raw output is preserved at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/s7-view-independent-db-b-luna.log`; exit receipt is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/s7-view-independent-db-b-luna.exit`.
- No source files were changed. I did not run broader suites, browser checks, image/runtime checks, or hosted CI.

## Findings

- **Blocking:** None found in the inspected manager/owner route-policy and pending-action semantics.
- **Non-blocking:** Add a targeted API-key regression that removes both manager and owner/create authority and confirms invalidation remains terminal after that key scope is restored. Existing generic role-restoration evidence and current evaluator behavior cover the terminal invariant, so this does not block ordinary clearance.

**Disposition:** Ordinary review B passes with the noted test gap. Independent GPT-6 Sol security review remains required at this exact candidate SHA, with model provenance resolved by the conductor.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110892144
SHA-256: `2bd6d3c3babbb84b50f2de68f94e240711aa6078cb4891e32b4dfd76c0377306`

# S7 saved-view manager authority repair — ordinary review C

- **Verdict: CLEAR** for the bounded cross-package authority repair reviewed below. This is ordinary review only; it does not clear the separate Sol security review, current-head integration/runtime/CI gates, protected acceptance, or any S7/stage completion claim.
- **Reviewed source:** `aad14ff02c193353fdd85d4a63e83518b43f0e42` compared with `cfe36aa4f3071855770b25693ee44bce2bf8a4d3`.
- **Dispatch selector:** GPT-6 Luna, explicitly selected by the conductor for this review. Platform-visible identity does not provide independently verifiable serving-variant attestation; this report does not claim such attestation.
- **Independence:** Fresh reviewer context. I did not author, direct, or remediate this candidate. The author's handoff and earlier Sol report were treated as claims to verify against source, not as review conclusions.

## Scope checked

Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the saved-view feature spec, pending-action architecture, and the provided prior Sol report. Inspected the exact candidate diff and traced the new `assertCallerHasCapabilityOrOwner` helper and saved-view edit middleware through all callers; workspace row resolution and reach; both route declarations and policy registry entries; `PATCH`'s locked-row transaction; pending-action request-time required-access and deletion approval policy checks; permission evaluator identity/key clamping; team-view access and response masking; and the changed permission matrix. Confirmed `assertCallerHasCapabilityOrOwner` has one production caller, `assertCanEditView`, which is used by the edit admission middleware and again inside the locked update transaction.

## Findings

No blocking or non-blocking findings in the bounded source scope.

The implementation now expresses the documented conjunction consistently: either `workspace:manage_settings`, or a persisted row owner holding `saved_view:create`. The route registry declares the manager capability as the primary branch and the owner/create pair as `orOwner`; strict-policy context receives persisted `createdBy` from the reach-filtered saved-view lookup. The shared helper applies the same branch shape and intersects each required capability with API-key scope. The update controller repeats the check against the row locked inside its transaction.

For deletion, the route admission uses the same helper, the pending-action evaluator recognizes the exact manager-primary/owner-secondary policy, and approval re-evaluates current access from the locked target. Thus a key retaining only `workspace:manage_settings` continues to satisfy the manager branch, while loss of the owner's `saved_view:create` without manager authority still denies the owner branch. The deletion executor's expected-policy guard was updated to the matching primary capability. Existing target workspace/version/payload and team-view reach checks remain present in the inspected paths.

The team-view admission helper preserves the established 404 for callers denied authority who are not members of the target team. Workspace managers can still satisfy the explicitly preserved workspace-manager branch. The changed permission-matrix expectations for member/lead are consistent with the route-level primary-or-owner conjunction; this is a denial correction and does not grant new authority. No new capability or custom-role admission was added; current built-in-only helper behavior preserves the stated custom-role hold.

## Verification and limits

- `git diff --check cfe36aa4f3071855770b25693ee44bce2bf8a4d3 aad14ff02c193353fdd85d4a63e83518b43f0e42` — passed.
- Attempted lightweight static permission tests with `pnpm exec vitest run tests/permissions/route-policy.test.ts tests/permissions/permission-matrix.test.ts`; the checkout has no installed `vitest` executable (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`). I did not install dependencies.
- No database/runtime/browser/full-suite test was run; the database window is owned by another reviewer. Author-supplied test logs were not treated as independently reproduced evidence.

**Disposition:** Ordinary review C clears this exact source for its assigned cross-package authority scope. Separate required review tiers and exact-head acceptance gates remain outstanding.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110892358
SHA-256: `0b38e8fd9846ec723a698823c99fd21a4391b828c5765315fae0ae780d6a5962`

# S7 saved-view manager authority repair — independent security review

- **Verdict: CLEAR** for the exact reviewed security-scope candidate. No blocking security finding was found in the inspected authority and pending-action paths. This is a full per-candidate security pass, not the S7 phase finalizer, runtime acceptance, hosted CI, or merge authorization.
- **Reviewed head:** `aad14ff02c193353fdd85d4a63e83518b43f0e42`.
- **Comparison source:** `cfe36aa4f3071855770b25693ee44bce2bf8a4d3`, the previous Sol security-review blocker. The repair is one commit and changes 12 files. The checkout was clean and `HEAD` matched the reviewed SHA.
- **Role and provenance:** Fresh independent security reviewer context, dispatched with explicit `gpt-6-sol` selector and `fork_turns=none` by the conductor. I did not author, direct, remediate, delegate, or merge this candidate. Platform-visible identity does not independently attest the serving model variant, so this note records selector provenance and leaves model-attestation acceptance to the conductor.

## Security reasoning

The prior blocker was a real disagreement with `search-and-saved-views.md`: PATCH and DELETE permit `workspace:manage_settings` **or** persisted row ownership **and** `saved_view:create`. The former route gate always demanded `saved_view:create`, so a built-in manager's API key scoped only to `workspace:manage_settings` was denied. The repair changes both registry policies to manager-primary/owner-create, and its new shared authorization helper checks each branch as role grant intersected with the API-key's exact stored capability scope. Owner identity alone grants nothing; ambiguous membership and nongenuine built-in-role backing remain fail-closed. The helper is called only from saved-view edit admission and the locked PATCH row check. I found no custom-role, projected-legacy, or unrelated route admission expansion.

`workspaceAccess.fromSavedView()` supplies `workspaceId` and `createdBy` from the reach-filtered persisted view row. Both route middleware entries use those facts; strict policy enforcement reads the same `policyRowFacts`. PATCH rechecks the row and both capability branches inside its update transaction, then applies the existing additional `saved_view:share` plus same-workspace team-membership gate for audience changes, and `workspace:manage_settings` for workspace publication. The new middleware retains the established masked 404 for a denied, nonmember team-view editor. The manager branch can edit regardless of team membership, as the documented workspace-manager alternative requires. GET/list/run/count/pin gates and their work-item reach checks were not changed by this commit.

DELETE admission uses the same OR check. Pending-action request and approval accept only the exact registered manager-primary/owner-create policy, re-read the locked saved-view target, compare its workspace and version, recheck team-view reach, and evaluate the current requester identity and original key's stored scope. The approval executor separately rejects a changed policy or payload, requires the requester’s live agent session, and deletes the locked exact target. A manager-only key therefore remains authorized after its owner-create scope is removed; an owner-only key remains authorized through its create branch; loss of every qualifying branch denies. The credential update path evaluates access before and after scope mutation under the pending-action lifecycle transaction and invalidates only an allowed-to-denied transition. Workspace authority writes use the same before/after pattern. An invalidated action is terminal because invalidation updates only `state = pending` and approval refuses any state other than pending; restoration cannot revive it. Existing explicit revocation, natural key expiry, requester deactivation, scope/version changes, and session-only approval behavior remain in place in the inspected paths.

## Evidence and residuals

- Read current `AGENTS.md`, active mission, agent workflow/model policy, `CLAUDE.md`, saved-view spec, RBAC and pending-action contracts, CI security-review requirements, the prior full Sol blocker, and all three current-head ordinary review reports. Traced the complete 12-file `cfe36aa4..aad14ff0` delta and surrounding runtime/evaluator/credential code rather than adopting those reports' conclusions. `git diff --check cfe36aa4f3071855770b25693ee44bce2bf8a4d3 aad14ff02c193353fdd85d4a63e83518b43f0e42` passed. No source was edited.
- Ordinary review A independently passed route-policy and permission checks (14 files/88 tests); ordinary review B independently ran the actual PostgreSQL-backed saved-view integration file (1 file/31 tests passed; raw log and exit receipt in the same evidence directory). These remain their reviewers' exact-head evidence, not tests I ran. This checkout has no installed `vitest` executable, and the conductor owned the shared database/full-suite window; I ran no DB, browser, image, health, or hosted checks.
- **Non-blocking test gap:** No focused API-key integration case removes *both* manager and owner-create branches and then restores the key scope to prove terminal invalidation specifically for this OR route. The existing owner-only key test demonstrates capability-loss invalidation at approval; a session role-loss test demonstrates terminal non-revival; the current credential writer and pending-action state guard support the both-branches conclusion by source inspection. Adding the focused key writer regression would improve coverage, but I found no source mechanism that reopens an invalidated action or treats a surviving manager branch as lost.
- This review does not claim whole-S7 source coverage, stage closure, current-head hosted CI, or runtime deployment proof. A later product-source change requires a fresh exact-head security disposition.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110892530
SHA-256: `c66246500eddfde71403fe1c50992c36ef8ff5c4d99f91142180369e6bc14b8b`

# S7 saved-view authority repair — accepted-main composition review

- **Verdict: CLEAR** for the bounded composition delta from `aad14ff02c193353fdd85d4a63e83518b43f0e42` to `bb4eef55a22865f70377ddd26e1efd2c73ef85ea`. This is a factual ordinary composition check, not a new source review, security clearance, runtime/CI acceptance, merge authorization, or stage claim.
- **Independence:** Fresh read-only context; I did not author, direct, or remediate the candidate or its composition. Prior reports and the conductor's receipt were checked against Git objects and repository content.
- **Model provenance:** GPT-6 Luna was the explicit review selector; the platform does not expose independent serving-variant attestation.

## Git composition checked

`bb4eef55a22865f70377ddd26e1efd2c73ef85ea` is a two-parent merge with first parent `aad14ff02c193353fdd85d4a63e83518b43f0e42` and second parent accepted main `0aa0be2eae80e781754bc7fe0468d8cda1113c99`. The accepted-main parent is an ancestor of the merge. `git log --first-parent aad..bb` contains only the composition merge itself; there are no intervening first-parent commits to account for.

The merge's first-parent tree delta is exactly three documentation files: 12 added lines in `decision-log.md`, 14 in `integration-execution-queue.md`, and 14 in `status.md` (40 additions, no deletions). The raw first-parent diff confirms those paths and modes. No product source, tests, API contracts, configuration, or migration file changes between `aad` and `bb`.

Compared each of the twelve product/test paths changed by `cfe36aa4f3071855770b25693ee44bce2bf8a4d3..aad` by blob ID at `aad` and `bb`. All twelve match exactly, including the new `require-saved-view-edit-access.ts` blob `0977f06398140efe18eae1938746d155ae201dbd`; the other eleven hashes are recorded by the direct Git check. The verified blob IDs at both `aad` and `bb` are: `deletion-targets.ts` `6d42a2db92affedb50d98551831487f5d95f3cd5`; `required-access.ts` `fd7d781e62b41a953cb141ccf8890da7fc7db2e7`; `require-workspace-capability.ts` `ee27bfc68d34908a5010ceea7a6c670adff06616`; `workspace-access-middleware.ts` `bc1d28fb2224bc7057aae2baf2389fba2b81d6fd`; `assert-can-edit-view.ts` `d3b56555ca9a2ff0341994fea8527c57c02e85c5`; `assert-can-share-view.ts` `6fccf40ab0ad8c57f560c9088a69d13fb4c9495c`; `update-view.ts` `19c492907fa7a2f9ba5243dc3caa33009a0db970`; `index.ts` `0365c9c8407636a4d8cf0c593dcd2da184d2870d`; `policy.ts` `fc0f0a60530f6846d8c67af0df891109ee6b45bd`; `require-saved-view-edit-access.ts` `0977f06398140efe18eae1938746d155ae201dbd`; `view.test.ts` `c0a27b33d3e5cd54ffc0f72f3bb7e196f8e3c65a`; and `matrix.fixture.json` `26c9a9b57861e01c4c824f6186181c541899e1ff`. This confirms the authority repair is byte-for-byte conserved through the normal accepted-main merge.

## Documentation/runtime boundary

The added decision-log entry distinguishes rejecting newly authored `set_field` versions from refusing only a selected historical transition that contains `set_field`. That matches the existing feature spec's WF-19 text at `docs/03-features/workflows.md:155-160`. The existing transition runtime checks the selected, already-authorized `match.effects` for `set_field` and throws before state resolution or effect processing (`apps/api/src/work-item/controllers/transition-work-item.ts`); it does not reject supported sibling transitions merely because another historical edge contains the held effect. The authoring/version-validation path still rejects a version containing `set_field` (`packages/domain/src/workflow/workflow.ts`). The mixed-version decision and existing runtime/spec boundary therefore agree. The composition changes none of those files.

The status and queue text imported by this merge is a dated checkpoint (14:32/14:33 UTC) and records the then-current blockers; it makes no claim that the later authority repair or review was complete at those timestamps. The new owner decision is recorded separately at the head. No durable acceptance or stage completion is implied.

## Verification and correction

- `git rev-list --parents`, `git show --no-patch`, first-parent log, raw diff, per-file blob comparisons, and feature/runtime source inspection were used.
- The prior review's failed command was specifically `pnpm exec vitest run ...` from the repository root, which returned `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` because that invocation could not resolve `vitest`. This evidence does **not** establish that Vitest is absent from the entire checkout; the API-package exec command worked for another reviewer, who recorded the saved-view file result as 31/31. I did not rerun tests because this was a docs-only first-parent composition delta and runtime/database work was out of scope.
- No source or repository files were edited; report is written outside the checkout.

**Disposition:** The accepted-main composition preserves every reviewed authority-repair blob and has no product delta on the reviewed first-parent path. The documentary mixed-version boundary matches the existing spec and runtime. Separate exact-head hosted/runtime and other acceptance gates remain as recorded by the conductor.

---

Authentic publication: https://github.com/ThomasHeinThura/ticketing/pull/658#issuecomment-6110892723
SHA-256: `33c1cec164ae609dc906b8084eda8b5f5e18396e89f0a2fdcbe3f7864cc66151`

# S7 saved-view authority repair — accepted-main composition security confirmation

- **Verdict: CLEAR** for the exact `aad14ff` → `bb4eef55` composition. This is a current-head security confirmation that the already reviewed authority code was preserved, not a new whole-S7 security review, runtime acceptance, phase finalizer, hosted CI result, or merge authorization.
- **Reviewed head:** `bb4eef55a22865f70377ddd26e1efd2c73ef85ea`.
- **Prior full security-reviewed source:** `aad14ff02c193353fdd85d4a63e83518b43f0e42`; its authentic full independent report is `s7-manager-authority-security-sol.md`. The prior blocked `cfe36aa4f3071855770b25693ee44bce2bf8a4d3` report retains its historical BLOCK verdict and is not relabelled.
- **Reviewer provenance and independence:** The conductor assigned this security follow-up with explicit GPT-6 Sol selector; this is the same independent, read-only reviewer context that produced the `aad14ff` full security pass. I did not author, direct, remediate, or merge either source. The platform does not independently expose the serving variant, so selector provenance is stated without claiming binary attestation.

## Git and authority comparison

`bb4eef55` is a normal two-parent merge: first parent `aad14ff`, second parent accepted main `0aa0be2eae80e781754bc7fe0468d8cda1113c99`. `git rev-list --first-parent aad..bb` contains only this merge. On the accepted-main side, the intervening history from shared ancestor `0978d77e` comprises the two documentation source commits `02fc46ec` (status/queue checkpoint) and `ac11e494` (owner workflow decision), their branch/main merges `bf0b16a1` and `75c71d38`, and protected PR merges `411c802c` and `0aa0be2e`. The final main-side tree delta from the ancestor is limited to the same three planning documents. The second parent is an ancestor of `bb4eef55`.

The exact first-parent tree delta is **40 additions, zero deletions**: 12 lines in `docs/07-planning/decision-log.md`, 14 in `docs/07-planning/integration-execution-queue.md`, and 14 in `docs/07-planning/status.md`. `git diff --quiet aad..bb -- apps packages tests .github scripts docs/01-architecture docs/03-features docs/04-engineering` returned 0, and `git diff --check aad..bb` passed. I independently compared the Git blob IDs of all twelve paths in the `cfe36aa4..aad14ff` authority-repair diff at `aad14ff` and `bb4eef55`; every pair matched. Thus route admission, registry policy, locked PATCH recheck, pending-action request/approval, credential-loss handling, permission fixture, and the 31-test integration file are byte-for-byte unchanged at this head. There is no new product or security-control delta to alter the prior full security verdict.

The added owner decision concerns only historical workflow versions with a held `set_field` effect. It preserves rejection of newly authored versions containing that effect and permits supported sibling transitions in a historical mixed version. The current feature spec says exactly this (`docs/03-features/workflows.md`), the version validator rejects `set_field` authoring (`packages/domain/src/workflow/workflow.ts`), and the transition executor checks the selected edge's effects and rejects `set_field` before work-item state/effect mutation (`apps/api/src/work-item/controllers/transition-work-item.ts`). The decision does not grant capability, create a field namespace, or change runtime code. The appended queue/status entries are dated earlier checkpoints describing then-open S7 blockers; they are historical records, not current-head gate claims.

## Evidence and limits

I inspected the exact merge parents, first-parent and main-side intervening commits, both parent tree comparisons, the full three-file first-parent diff, all twelve repaired-path blob pairs, the workflow spec/validator/executor boundary, and the prior full Sol and current composition ordinary notes. The ordinary composition review independently reached CLEAR and recorded its own Git checks. The conductor's JSON receipt agrees with the direct 12/14/14 line counts; I treated it as evidence to verify, not authority. No repository source was edited and no DB, browser, image, full suite, or hosted CI check was run for this documentation-only composition.

The prior full security report's non-blocking focused API-key both-branches-loss-and-restoration test gap remains unchanged. Exact-head GitHub required checks and the rest of the conductor's acceptance gates remain separate.
