# PR #638 — legacy WebSocket reauthorization review evidence

**Reviewed head:** `453fbacb56710aed361cef89dce09c8fbc90ba76`

Conductor transport provenance: three ordinary reviewer contexts were explicitly
spawned with `model="gpt-6-luna", fork_turns="none"`; the separate full security
reviewer was explicitly spawned with `model="gpt-6-sol", fork_turns="none"`.
Each context was fresh and did not author, direct or remediate this candidate.
The reviewers truthfully retain the generic runtime identity when the exact serving
variant was not independently exposed. These are observable platform selectors,
not an invented provider identity. Reviewer output below is transported byte for byte.

Ordinary A and C retain their original mistaken workspace-selector findings and their
own independently written addenda withdrawing those findings at the same source SHA.
No source remediation or reviewer verdict editing occurred between those clarifications.
Their final ordinary verdicts are clear; ordinary B and the full security review are
also clear. The directly signaled invalidation-closure test gap is recorded as a
non-blocking residual by the independent security review. This note does not claim
container/SIT acceptance or a completed stage.

## Authentic report: legacy-ws-luna-a.md

SHA-256 of original report bytes: `16e7af1fcd8d524c0a9e221dabb9bbf85e67b7ee114f27d632c8890f9e0868f7`.

# Independent ordinary review: legacy WebSocket reauthorization

- **Reviewed head:** `453fbacb56710aed361cef89dce09c8fbc90ba76`
- **Comparison base:** `6222eff58e63c5b9be31ae5a8a34ec9fdfc153a4`
- **Code scope:** Full executable and test diff at `10400dbcd3fa43e41f804a67ba514872c4b1e62d` against the comparison base (10 files); the later head adds only the seven-line general lesson in `docs/04-engineering/error-fix-loop.md`.
- **Reviewer independence:** Fresh review context. I did not author, direct, or remediate the candidate. Read-only source and log inspection; no repository edits and no tests/builds/databases/containers/browser runs by this reviewer.
- **Role / model provenance:** Ordinary reviewer, Luna-tier assignment as dispatched. The execution context exposed only the generic GPT-6 runtime identity, not an exact Luna model/version identifier; I cannot independently attest the exact serving variant.
- **Authority checked:** Accepted-base `AGENTS.md`, `docs/04-engineering/agent-workflow.md` review policy, `docs/04-engineering/ci-cd.md` security path list, and `docs/01-architecture/realtime.md` legacy socket requirements.
- **Risk classification:** Security-sensitive auth change (`apps/api/src/index.ts`, `apps/api/src/ws/index.ts`, and `apps/api/src/ws/**`); the required separate GPT-6 Sol security pass remains outstanding.

## Verdict

**REQUEST CHANGES — one blocking contract gap.** Per-event checks do prevent a queued event from being sent after the lookup observes revoked project reach, but workspace-only `identity.invalidate` messages do not trigger immediate reauthorization of existing legacy project sockets. This falls short of the realtime contract's requirement to reauthorize on private identity invalidation signals. The 60-second timer and next-event lookup bound exposure; they do not satisfy immediate invalidation.

## Blocking finding

**[P2] Workspace-only invalidation leaves legacy project sockets connected.** In `apps/api/src/ws/index.ts`, `reauthorizeLegacyConnections` filters project connections only by `target.projectId` and `target.userId`; it never uses `target.workspaceId`. Several workspace-wide authority changes publish `{ workspaceId }` without a user or project id (for example workspace deletion, activation, and ownership transfer in `apps/api/src/workspace/index.ts`). Those messages therefore queue zero legacy reauthorization checks. A project socket affected by that workspace change stays open until its next event or the 60-second refresh floor, despite the private invalidation signal. The per-event authorization callback does re-read project reach before sending and fails closed, so I found no direct post-revocation event disclosure through that route; the defect is delayed revocation/connection termination against the stated immediate-invalidation contract. Resolve the workspace target to affected project sockets (or conservatively reauthorize project sockets on workspace-only invalidations), and cover a workspace-only invalidation case.

## Checks and evidence

- Source inspection confirmed per-connection authorization is serialized, bounded at 64 retained checks, terminal on false/throw/queue overflow, and checks `disposed` before sending. A close/removal disposes the timer and prevents in-flight delivery.
- Source inspection confirmed the legacy route callbacks re-run authentication using the captured request headers, run local-factor enrollment checks, compare the resolved user id, reject banned users, and for project sockets re-read the project's non-deleted row and current workspace reach. API-key verification rechecks enabled/expiry and owner ban/person activity. Lookup errors fail closed.
- Inspected tests assert authorization ordering, no send after denial/disconnect, 60-second idle close, lookup failure, bounded-queue close, real Node/Better Auth session ban/deactivation/session deletion, API-key disablement, and actual membership removal. I did not execute them.
- Parent-supplied evidence (not this reviewer's runs): `node-full-run-2.log` reports 26/26 integration tests passing; `legacy-ws-unit-run-2.log` was supplied as 28 passing unit tests. Parent also reports full lint/typecheck/test/permissions logs passing; those logs were not independently re-run here.
- The supplied earlier `node-new-cases-run-1.log` records 2 ban-case failures, 7 passes, and 17 skipped before the current-user ban guard was added. The later 26/26 run is the relevant post-fix evidence. I inspected these as parent-provided evidence only.
- I did not read or reproduce any secret values present in the evidence directory.

## Non-blocking observations

None beyond the workspace invalidation finding. I found no path in the reviewed diff that sends a queued project event before the live authority lookup, and no lookup failure path that falls open.

## Addendum — correction after exact-source recheck

**Correction, bound to the same reviewed head `453fbacb56710aed361cef89dce09c8fbc90ba76`: withdraw the blocking finding and the “REQUEST CHANGES” verdict above.** I reversed the conditional logic in lines 325–336. For a workspace-only target, `target.projectId` and `target.userId` are absent, so both `if (target... && ...) continue` conditions are false. The function therefore queues `authorization.check()` for every user connection and every project connection, awaits all checks, and immediately reauthorizes legacy project sockets. The reported P2 has no concrete counterexample and is not a defect. The intended conservative all-legacy refresh on a workspace-only invalidation satisfies the immediate invalidation requirement.

**Corrected verdict: PASS for the ordinary review.** No blocking or non-blocking findings remain from this review. The separate required security review remains outstanding. This correction supersedes only the false finding/verdict; the source scope, method limits, provenance disclosures, and parent-supplied test evidence stated above remain unchanged.

## Authentic report: legacy-ws-luna-b.md

SHA-256 of original report bytes: `03ca14b4cd47726894fdff7a2a0458d6233d3fc12926e9a73df2e982fdb8b802`.

# Independent ordinary review B — PR #638 legacy WebSocket reauthorization

- **Review dispatch selector:** GPT-6 Luna (Luna ordinary-review tier).
- **Runtime identity exposed in this context:** GPT-6 Luna; no separate build/version identifier was exposed to me.
- **Role / independence:** Fresh ordinary reviewer context, independent of author/fixer; did not direct or remediate the candidate. This review must not be reused as the required subsequent Sol security review.
- **Exact candidate:** `453fbacb56710aed361cef89dce09c8fbc90ba76`
- **Comparison base:** `6222eff58e63c5b9be31ae5a8a34ec9fdfc153a4`
- **Scope inspected:** Whole 11-file diff: app WebSocket routes, legacy authorization helper, adapter fan-out/control handling, unit and real Node integration coverage, realtime authority documentation, error-fix-loop note. Also read accepted `agent-workflow.md`, `ci-cd.md` security-scope list, active integration-freeze mission, current status checkpoint, and realtime authority contract.
- **Risk:** Security-sensitive authorization repair: `apps/api/src/index.ts` is explicitly in the security-review path list. Ordinary panel size is three for high-coupling integration per the governing workflow; this is reviewer B only. An independent full GPT-6 Sol review remains mandatory after ordinary clearance.

## Findings

**Blocking findings: none found by source review.**

The legacy user and project sockets now gate each local send on a serialized fresh authorization check. The check re-runs `authenticateApiRequest` with the original request headers, checks the resolved user ID and agent session portal, rejects a banned user, and runs `enforceLocalFactorEnrollment`; that helper queries the current person row and denies inactive identities. API-key revalidation uses `verifyApiKey`, which checks enabled/expiry and current owner ban/activity. Project delivery additionally rereads the project and applies `reachableWorkspacePredicate` using the freshly populated key ID. These checks happen before `ws.send`; failures close with policy code 1008 and remove the connection.

The helper's queue serializes authorization and delivery, checks disposal after awaiting the authority lookup, catches lookup/send exceptions fail-closed, and has a 64-check bound. Periodic checks apply to idle connections. Removal disposes the timer. The private identity invalidation subscriber also triggers legacy reauthorization; workspace-only invalidation currently rechecks all legacy connections, which is broader than necessary but fails closed and is not a correctness blocker.

The added helper tests cover revocation without revival, idle refresh, failed lookup, disconnect during an in-flight check, ordered queued delivery after revocation, and queue exhaustion. Real Node + Better Auth integration cases cover user/project sockets after ban, person deactivation, session deletion, API-key disablement, and actual membership removal. The changes retain existing project fan-out/window behavior coverage.

**Non-blocking residual:** the new real-server integration cases directly exercise subsequent events after authority mutation, while the 60-second idle path and stalled queue behavior are asserted at helper level. The focused tests are complementary; I found no concrete gap that blocks this candidate. Control-plane invalidation's legacy effect is wired in source, but the added regressions do not appear to assert a legacy socket closes specifically from an invalidation message without a follow-up event; periodic/per-event enforcement remains present.

## Verification and evidence attribution

- **Reviewer-run:** Read-only source/doc inspection and `git diff --check <base>...<candidate>`; diff check reported no whitespace errors. I did not run tests, builds, database, containers, or browser checks, per the assigned review window.
- **Author/runtime evidence supplied in assignment (not independently rerun or inspected):** `node-full-run-2.log` reported 26/26 PASS; `unit-run-2` reported 5 files / 28 tests PASS; full lint, types, test and permissions reported PASS; full API integration was still running. The earlier `node-new-cases-run-1` had 7 PASS / 2 FAIL / 17 deselected, including the ban case before the explicit ban guard. These are author evidence, not this review's executed checks.

## Verdict

**CLEAR for ordinary-review role B at exact head `453fbacb56710aed361cef89dce09c8fbc90ba76`.** No blocking source findings. This verdict does not clear the ordinary panel by itself, certify author runtime evidence, or satisfy the required independent GPT-6 Sol security review.

## Authentic report: legacy-ws-luna-c.md

SHA-256 of original report bytes: `70ffc92da04a245ba5995f8a6d66587c7b94f112f96bd7d71a272d598173a039`.

# Independent ordinary review C — legacy WebSocket authorization repair (#632 / PR #638)

- **Verdict:** BLOCKED — one bounded contract gap below; no credential bypass or event-after-revocation path was identified in the reviewed project/user fanout implementation.
- **Source:** exact candidate `453fbacb56710aed361cef89dce09c8fbc90ba76`, compared with accepted base `6222eff58e63c5b9be31ae5a8a34ec9fdfc153a4`.
- **Review tier/identity:** ordinary Luna-tier reviewer, review C. Dispatch selector: `gpt-6-luna`; runtime identity exposed to this context: GPT-6, with exact serving variant not exposed. Fresh context; did not author, direct, or remediate this candidate. This is not a Sol/security verdict.
- **Scope:** full 11-file base-to-head diff, with detailed inspection of legacy auth callbacks, serialized queue/disposal, project/user local fanout, Redis control subscription and invalidation publication, the realtime contract and added unit/native-session integration coverage.
- **Checks performed here:** static source/spec/diff inspection and `git diff --check` (clean). No test, build, database, Docker, or browser command was run in this review context. Author evidence was supplied by the conductor as context; I did not independently execute or inspect those runs, so they are not reviewer-run evidence.

## Finding

### B1 — Workspace invalidations do not reauthorize legacy connections

`apps/api/src/ws/index.ts:321-336` selects affected legacy connections using only `target.userId` and `target.projectId`. It never handles `target.workspaceId`. However, `apps/api/src/workspace/index.ts:879,887,1006,1097,1121` publishes workspace-scoped invalidations for membership/role changes, and the new contract at `docs/01-architecture/realtime.md:37-38` says both legacy sockets reauthenticate on private identity invalidation signals. Consequently, a workspace membership/role change does not cause any legacy socket to reauthorize from that signal (a workspace-only target passes through both loops without selecting a connection). Revoked project reach is still checked before the next project event, preventing that event from being sent; an idle affected socket remains open until an event or the 60-second timer. This misses the stated immediate invalidation behavior and can leave stale connections resident.

**Requested correction:** associate each legacy project connection with its workspace (obtained from the authorized project lookup), and match workspace-scoped invalidations to relevant project connections. For the user socket, reauthorize users whose workspace-scoped identity/reach may have changed, or narrow/document the invalidation contract if those signals are not intended to cover it. Add regression coverage that publishes a workspace-only invalidation and observes affected checks while unrelated connections remain unchecked.

## Positive evidence

- The original handshake request's credential headers are reused. Each event check re-runs `authenticateApiRequest` and local-factor enforcement; project delivery also rechecks project existence/deletion and current workspace reach. A mismatch in the resolved user id rejects the connection.
- The per-connection Promise chain orders authorization with delivery. A denial or thrown lookup removes/closes the connection; disposed connections skip queued sends; pending checks are capped and overflow closes the socket. `ws.send` failures are caught by the same fail-closed path.
- Added integration coverage uses real Better Auth sessions for ban, deactivation and session revocation; actual API-key disabling; and actual workspace membership removal. Added unit coverage exercises timer denial, failed lookup, disconnect during in-flight authorization, queue ordering/revocation, and queue exhaustion.
- I found no defect in the reviewed local-versus-Redis fanout distinction: both local and incoming Redis deliveries route through the same local connection authorization path; the Redis origin guard prevents duplicate local echo.

## Residual limits

This is a source review, not an independent runtime reproduction. Existing candidate test results and harness health remain attributable to their original executors. The workspace-invalidation finding blocks ordinary clearance until corrected and reviewed on a new exact head. A fresh independent Sol security review is still required after ordinary reviews clear.

## Addendum — correction after exact-control-flow re-evaluation

**Correction:** B1 above is withdrawn. Its claim that a workspace-only invalidation selects zero legacy connections was incorrect. In `reauthorizeLegacyConnections` at the reviewed exact source (`apps/api/src/ws/index.ts:321-336`), a workspace-only target has neither `target.userId` nor `target.projectId`; both `if (...) continue` guards therefore evaluate false. The function enqueues `authorization.check()` for every user and project connection. The broad refresh is conservative and does reauthorize affected legacy sockets on workspace invalidation. With no source change, the original B1 does not establish a defect.

**Final verdict:** CLEAR for this ordinary review at `453fbacb56710aed361cef89dce09c8fbc90ba76`. No other blocking or non-blocking findings from the reviewed scope. This correction is based on static control-flow inspection only; it is not a new runtime/test result and does not substitute for the required independent Sol security review. Original contents above are preserved as the review history; this addendum supersedes the original verdict/finding.

## Authentic report: legacy-ws-security-sol.md

SHA-256 of original report bytes: `d5f9fc66daf5f63bca14911d236d57e7b44be40bdfa2f33ac1a9d1e5d2829de0`.

# Independent Sol security review — legacy WebSocket reauthorization (#632 / PR #638)

**Reviewed head:** `453fbacb56710aed361cef89dce09c8fbc90ba76`  
**Comparison base:** `6222eff58e63c5b9be31ae5a8a34ec9fdfc153a4`  
**Role and provenance:** Fresh, independent full security review. The parent dispatched this context with selector `gpt-6-sol`; this context exposes the generic GPT-6 identity, but no separate serving-version attestation. I did not author, direct, or remediate the candidate and did not act as an ordinary reviewer.  
**Verdict:** **CLEAR** at this exact head. No blocking security finding identified in the reviewed scope.

## Scope and method

I inspected the complete 11-file base-to-head diff: the 10 executable/test/contract files in commit `10400dbcd3fa43e41f804a67ba514872c4b1e62d`, plus the seven-line engineering lesson in `453fbacb56710aed361cef89dce09c8fbc90ba76`. I traced the legacy user and project route callbacks through `authenticateApiRequest`, `verifyApiKey`, `enforceLocalFactorEnrollment`, `reachableWorkspacePredicate`, the per-socket authorization queue, local and Redis fan-out, private invalidation subscription/publication, and disposal. I inspected governing `AGENTS.md` (provided in the task), `agent-workflow.md`, `ci-cd.md` security scope, active mission, status/decision records, and `realtime.md`. I also inspected the three authentic ordinary-review reports and their addenda. They were inputs to challenge, not substituted for this review.

**Reviewer-executed checks:** read-only source/diff/log inspection and `git diff --check 6222eff58e63c5b9be31ae5a8a34ec9fdfc153a4..453fbacb56710aed361cef89dce09c8fbc90ba76` (clean). I ran no tests, build, database, container, or browser operation in the reserved heavy-test window. This report is stored outside the repository; I made no repository edit.

## Security findings and reasoning

**Blocking findings: none.** Both legacy routes reauthenticate from the original immutable handshake headers before each outbound event. `authenticateApiRequest` refreshes the captured Hono context rather than relying on its handshake values. Session lookup uses Better Auth with cookie cache disabled. The callbacks compare the freshly resolved user ID to the socket's original identity, reject current user bans and non-agent sessions, and call local-factor state loading, which rejects an inactive/missing person for agent sessions. API keys are reverified on each check for enabled status, expiry, owner ban and person activity; the project check uses the fresh key ID. The project callback also queries its live, non-deleted row through current workspace reach. Any false result or thrown lookup closes with policy code 1008 before the queued payload is sent.

Per-socket checks form one Promise chain, preserving event order. A failed check disposes and removes the socket; later queued checks observe disposal. Disposal during an in-flight lookup prevents the subsequent send. Send failures also enter the terminal catch path. At 64 pending checks the socket closes and no queued payload may be delivered. The 60-second timer checks idle sockets and is cleared on disposal. Both local and Redis-origin fan-out call the same authorization path; user Redis origin filtering avoids local echo. The private invalidation subscriber queues legacy checks as well as native checks. For a workspace-only target, neither user nor project selector is present, so both filters are false and **all** legacy sockets are conservatively rechecked. This independently confirms the corrected A/C addenda; their original zero-selection finding is false.

**Non-blocking residual:** The integration cases show denial on a subsequent event after ban, person deactivation, session deletion, key disablement, and membership removal. The 60-second floor, failed lookup, ordering, disposal and queue bound are directly tested at helper level. There is no direct regression that publishes a workspace-only private invalidation and asserts legacy closure *without* a following event. Source wiring proves that path at this head, and per-event authorization prevents a private event from bypassing it, so I do not treat this test gap as a blocking security finding. The broad workspace refresh may impose additional authorization queries on all connected legacy sockets; it is conservative for confidentiality.

## Evidence attribution and limits

I inspected the supplied author logs. `legacy-ws-unit-run-2.log` records 5 files / 28 passing tests. `legacy-ws-runtime/node-full-run-2.log` records 1 file / 26 passing real Node WebSocket tests after the ban guard. The earlier `node-new-cases-run-1.log` had two ban-case failures; it is historical failure evidence, not a passing run. The supplied full lint, typecheck, test, and permissions logs report success (the permissions run records 14 files / 88 tests). Those are **author-executed**, not reviewer-executed. At review time the supplied full API integration log had no final summary; this review does not claim it passed. The seven-line final commit changes a general engineering lesson only; it does not change source, tests, build inputs, or the reviewed realtime authority contract. GitHub's exact-head CI and required publication gates remain the conductor's responsibility.

This clearance addresses the requested repair and the actual authority paths in the reviewed diff. It is not a claim that all pre-existing legacy socket capability semantics or every possible concurrent revoke/send interleaving has been redesigned.


## Accepted-main composition and current-head delta confirmation

**Reviewed head:** `ba01174aa16a125d9c7450e4cb9080ccd50a96b5`

Conductor provenance: /root/review_638_main_records_delta_luna was freshly spawned with model="gpt-6-luna", fork_turns="none" and independently closed the two transport-only separator deletions. /root/review_638_current_delta_sol was freshly spawned with model="gpt-6-sol", fork_turns="none" for the separate lightweight security confirmation. Neither authored, directed or repaired this candidate. The original full source panel remains above; runtime identity and execution limits remain as reported. The original protected merge was refused after accepted main advanced; the normal composition receives this fresh confirmation without a bypass. Authentic original Markdown hard-break bytes remain unchanged.

## Authentic current-delta report: pr638-main-records-delta-luna.md

SHA-256 of original report bytes: `8e619b23d4d5305d7ea6b72fd3283ed4af2f970ee5f88f44e00c8a7ec985583d`.

# Independent ordinary review — #638 accepted-main records delta

**Reviewed head:** `c62989ebf035d0672c9e6413968acec77326673b`  
**Comparison base:** `cdf6b7602d531d3b0cc400b939c305ba0a301368`  
**Merge parents:** first `cdf6b7602d531d3b0cc400b939c305ba0a301368`; second `f8afcbccf1bf741989aa3671939beef3bb1d1e97`.  
**Reviewer context:** `/root/review_638_main_records_delta_luna`, fresh context independent of authorship, direction, and remediation.  
**Model:** assigned to the GPT-6 Luna ordinary-review tier. The execution surface exposes generic GPT-6; I cannot substantiate an unexposed exact serving variant.  
**Scope:** factual and composition review of the merge delta from the accepted #638 records head to its normal merge with accepted-main #639 records.  
**Verdict: CLEAR.** No blocking factual or authority/gate finding. One non-blocking trailing blank line is noted below.

## Checks performed

- Read accepted `AGENTS.md`, `docs/07-planning/active-mission.md`, `docs/04-engineering/agent-workflow.md`, and the authoritative security-scope list in `docs/04-engineering/ci-cd.md`.
- Verified the exact HEAD and both raw merge parents with Git. The base-to-head diff is 160 additions / 0 deletions across exactly four mode-100644 files: `docs/07-planning/integration-execution-queue.md`, `docs/07-planning/status.md`, and two `docs/07-planning/security-reviews/**` records.
- Read the full queue/status delta and the new records. The 06:05 UTC snapshot preserves the prior #601 acceptance and #637 failure separately, keeps #635/#636/#632 work explicitly blocked or pending, and makes no new stage, release, SIT, or feature-acceptance claim. The #594 mapping keeps unique approval work held under S3/S4 and does not treat the historical Sol verdict as approval for #629 or a later candidate.
- Checked the retained #639 preflight and merge receipts and the two published factual-review reports for source SHA `d518556341110cb643252f4dda44080a5012c6da`. The copied reports’ SHA-256 values match their retained originals: Luna A `b7e0eee564fedc614c63281656a4019239222797efb8f85ff31202357b825763`; Luna B `3f8254b142ca3ba0c8ecc431fc32117447a6446a186f91915c7bbb33fecf3fb8`.
- Compared `docs/07-planning/security-reviews/594-outbox-fencing-canonical-binding.md` at original source commit `359d60bd31368cd04cc1aeab3ad5bcfade403f22` and reviewed head. The full file is byte-identical at both: SHA-256 `9e65cce1f866e486d727ace895a1feb5911d3a1e7b4d56d91cbad831c888f313`, 6,499 bytes. Its declared reviewed code head remains `8baeb6223fcb3c822f2b97f98bf41b56040cf511`.
- Confirmed by path inspection and a Git pathspec comparison that the delta changes no application source, route, test, build/deployment input, dependency, CI file, or security-path entry. The changed paths are outside the authoritative CI/CD security-review path list; this review makes no claim about or substitute for any separately assigned Sol confirmation.
- Ran `git diff --check cdf6b7602d531d3b0cc400b939c305ba0a301368 c62989ebf035d0672c9e6413968acec77326673b`. It reports one new blank line at EOF in `delivery-checkpoint-20261011.md:71` (exit 2). The same warning reproduces against the original #639 publication range. This does not alter the record’s meaning or any gate semantics, but contradicts the prior merge-body statement that its diff check passed.

## Findings

**Blocking:** none.

**Non-blocking:** remove the extra blank line at EOF in `docs/07-planning/security-reviews/delivery-checkpoint-20261011.md` when a normal records edit is next made. No fix was made in this review.

No tests, builds, databases, containers, browsers, or product runtime were used. The review checked composition and retained factual evidence; it did not independently re-run #639’s GitHub state queries or #638’s product verification.

## Authentic current-delta report: pr638-main-records-delta-luna-closure.md

SHA-256 of original report bytes: `156b7621f805bc1ada2b76f83a3c581850139d0f0b1a02fc5a3dccea42ccf79e`.

# Independent closing review — #638 records whitespace correction

**Reviewed head:** `ba01174aa16a125d9c7450e4cb9080ccd50a96b5`  
**Comparison base:** `c62989ebf035d0672c9e6413968acec77326673b`  
**Parent:** `c62989ebf035d0672c9e6413968acec77326673b`.  
**Reviewer context:** `/root/review_638_main_records_delta_luna`, continuing the fresh independent ordinary-review context; I did not author, direct, or remediate this correction.  
**Model:** assigned to the GPT-6 Luna ordinary-review tier. The execution surface exposes generic GPT-6; I cannot substantiate an unexposed exact serving variant.  
**Verdict: CLEAR.** The exact-head correction removes only two final blank separator bytes. No report text or factual content changed.

## Checks performed

- Verified HEAD and the single raw parent with Git. The parent-to-head diff is exactly two deletions from mode-100644 planning review records:
  - `docs/07-planning/security-reviews/638-legacy-socket-reauthorization.md`
  - `docs/07-planning/security-reviews/delivery-checkpoint-20261011.md`
- Compared both file blobs at parent and head. Each parent version ends in two LF bytes; each head version ends in one. In both cases, `parent_bytes[:-1] == head_bytes`: exactly the extra final LF was removed and every earlier byte is unchanged.
- Verified that all six retained authentic reports still occur byte-for-byte in their respective head notes. Their source SHA-256 values are: legacy WebSocket Luna A `16e7af1fcd8d524c0a9e221dabb9bbf85e67b7ee114f27d632c8890f9e0868f7`, Luna B `03ca14b4cd47726894fdff7a2a0458d6233d3fc12926e9a73df2e982fdb8b802`, Luna C `70ffc92da04a245ba5995f8a6d66587c7b94f112f96bd7d71a272d598173a039`, legacy WebSocket Sol `d5f9fc66daf5f63bca14911d236d57e7b44be40bdfa2f33ac1a9d1e5d2829de0`, delivery-records Luna A `b7e0eee564fedc614c63281656a4019239222797efb8f85ff31202357b825763`, and delivery-records Luna B `3f8254b142ca3ba0c8ecc431fc32117447a6446a186f91915c7bbb33fecf3fb8`.
- Ran `git diff --check c62989ebf035d0672c9e6413968acec77326673b ba01174aa16a125d9c7450e4cb9080ccd50a96b5` and `git diff --check cdf6b7602d531d3b0cc400b939c305ba0a301368 ba01174aa16a125d9c7450e4cb9080ccd50a96b5`; both passed. The index check also passed.
- Confirmed the delta does not alter application, test, build, deployment, dependency, or CI paths. No tests, builds, databases, containers, browsers, or runtime checks were run.

## Findings

**Blocking:** none.  
**Non-blocking:** none.

This review records only the exact `ba01174…` documentation correction. It does not claim carried exact-head product CI, build, runtime, or SIT evidence.

## Authentic current-delta report: pr638-current-delta-sol.md

SHA-256 of original report bytes: `32dd2b52a3b40660292470719334f7bda10dc633deb2b6537244f4fd52dc65ac`.

# Independent lightweight security confirmation — PR #638 current head

**Reviewed head:** `ba01174aa16a125d9c7450e4cb9080ccd50a96b5`  
**Original full security-reviewed source:** `453fbacb56710aed361cef89dce09c8fbc90ba76`  
**Accepted-main parent brought into the candidate:** `f8afcbccf1bf741989aa3671939beef3bb1d1e97`  
**Role and provenance:** Fresh independent lightweight security review of the post-`453f` delta. The assignment requested a Sol-tier review; this context exposes only generic GPT-6 identity, not a separately attested serving variant or the parent's invocation arguments. I did not author, direct, remediate, or merge this candidate, and did not serve as an ordinary reviewer.  
**Verdict: CLEAR for this exact delta.** No blocking authority, gate-semantic, or security finding identified. The original independent full security report remains bound to `453fbacb56710aed361cef89dce09c8fbc90ba76`; this confirmation establishes its applicability to the unchanged executable source and contract at `ba01174aa16a125d9c7450e4cb9080ccd50a96b5`.

## Scope and checks

I read the accepted `AGENTS.md`, `docs/07-planning/active-mission.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, and the `ci-cd.md` security-scope and review-binding rules from accepted main `f8afcbccf1bf741989aa3671939beef3bb1d1e97`. I inspected the cumulative Git history and five-file delta from `453f` through `cdf6b7602d531d3b0cc400b939c305ba0a301368`, the normal merge `c62989ebf035d0672c9e6413968acec77326673b`, and `ba01174aa16a125d9c7450e4cb9080ccd50a96b5`. The cumulative delta consists of queue/status checkpoint additions and three historical/reviewer notes: 322 additions and no remaining deletions. I read the queue/status additions, the review-note prefaces, the original full Sol report, and the current-delta Luna report and closure. The notes explicitly bind historical verdicts to their original heads and do not declare stage, release, SIT, or runtime acceptance.

I compared Git tree/blob object IDs at `453f` and `ba01174a` for `apps`, `packages`, `tests`, `scripts`, `.github`, `Dockerfile`, `compose.yml`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `docs/01-architecture/realtime.md`, and `docs/04-engineering/error-fix-loop.md`: every pair is identical. Thus the new merge did not change the reviewed executable code, tests, CI machinery, dependency/build inputs, or realtime authority contract in the candidate tree. The changes to queue/status and review notes supply evidence and status only; I found no new rule, authority grant, waived gate, or altered pass/fail condition in their text.

I independently checked all six embedded ordinary/security reports against their retained originals. Each original occurs exactly once, byte for byte, in its respective committed note, and its SHA-256 matches the declared digest: legacy socket A `16e7af1fcd8d524c0a9e221dabb9bbf85e67b7ee114f27d632c8890f9e0868f7`, B `03ca14b4cd47726894fdff7a2a0458d6233d3fc12926e9a73df2e982fdb8b802`, C `70ffc92da04a245ba5995f8a6d66587c7b94f112f96bd7d71a272d598173a039`, full security `d5f9fc66daf5f63bca14911d236d57e7b44be40bdfa2f33ac1a9d1e5d2829de0`, delivery records A `b7e0eee564fedc614c63281656a4019239222797efb8f85ff31202357b825763`, delivery records B `3f8254b142ca3ba0c8ecc431fc32117447a6446a186f91915c7bbb33fecf3fb8`. For both notes touched by `ba01174a`, the parent version ends with two LF bytes and the current version is exactly the parent bytes minus the last LF; report contents are intact.

The cumulative `git diff --check` reports three trailing-space lines in the embedded full security report's Markdown hard breaks. They are authentic original bytes, not a new candidate alteration; the original security report's own source diff check concerned its then-reviewed code delta. I made no source edit. I ran no tests, build, database, container, browser, or runtime operation. Author logs and earlier reviewer reports retain their original attribution; I do not convert them into reviewer-executed or current-head runtime evidence.

## Gate and evidence boundary

The accepted CI/CD rule requires a committed exact-head review declaration when non-note paths land after the previous security-reviewed head. The normal merge brought in planning records, so the earlier committed `**Reviewed head:** 453f…` alone does not establish current-head note freshness under that history rule, even though the executable tree is identical. This external report supplies the fresh independent assessment for `ba01174a`; the conductor must publish it through the required committed-note/PR flow and verify the exact-head status checks. This is a gate-publication step, not a security finding in the reviewed delta.

The original full report's non-blocking absence of a direct workspace-only invalidation closure regression remains as stated. This review does not assert a new reproduction, production/SIT acceptance, or that the historical #594 report approves later notification code.
