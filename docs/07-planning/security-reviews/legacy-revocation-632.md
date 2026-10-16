# Issue #632 — SCIM deactivation and legacy socket evidence

**Reviewed head:** `3e9021c2555abdde0de150d07f0309e6f74df3d9`

The four-file source/test fix is unchanged from `e8b57d2214221243d64c995470fc63a274348c10`. Two original independent ordinary reviews and a full security pass cover that source; fresh ordinary and full independent Sol composition reviews bind the accepted-main merge above. Source, author tests and runtime limits retain their actual attribution. No real Redis rerun, new exact-head CI, shipping-image runtime proof, release, SIT acceptance or issue closure is claimed here.

---

## Retained evidence file — 632-impl-sonnet.md

Origin SHA-256: `8ac6fcc8cc06ef9fd7a83c754bee4c4f4aad7f8cf72df7edf0dc2162977c9dfb`.

# #632 — legacy WebSocket disclosure after access revocation (Claude Sonnet 5.5)

Branch `codex/legacy-ws-revocation-632` from origin/main `9297362b`.

## Verification of current main (source + tests)
- Both legacy sockets DO recheck (apps/api/src/index.ts `/ws/user` ~1683, `/ws/:projectId` ~1779 via `createLegacyConnectionAuthorization`): the upgrade request's own credential is re-authenticated (session or key, banned, portal, owner) and, for project sockets, project reach/capability. User sockets use reuseMs 0 (fresh lookup per delivery); project sockets reuse a pass for 1.5s; both recheck at the 60s floor and immediately on an `identity.invalidate` announcement (`reauthorizeLegacyConnections`, also over the cross-instance control channel).
- Existing coverage (main): tests/api-integration/node-server-websocket.test.ts `it.each` user|project x ban|deactivate|revoke-session (~line 1645, unannounced DB writes), API key disable (~1720), membership removal (~1792); ws-project-reach.test.ts "an unannounced revocation closes within the reuse window; an announced one closes at once" (~788) and lost project reach (~389); tests/api/ws/user-broadcast-redis-failure.test.ts.
- Which production revocation paths announce (grep of `invalidateNativeAuthorization`): Better Auth session delete hook (auth.ts:612), instance suspend / sign-out / reset-mfa, admin person deactivation (pending-action service), connection disable, TOTP enrolment, workspace/project changes. NOT announced: SCIM deactivation (PATCH/PUT/DELETE /scim/v2/Users/{id}), which deletes the person's sessions and disables keys inside its transaction.

## Reproduction (new tests/api-integration/legacy-ws-revocation.test.ts, real cookies, real node listener)
Announced real paths (member sign-out, administrator sign-out-everywhere, administrator suspend) x user|project: an IDLE socket closes 1008 with no event published and nothing is delivered afterwards — pass on current main (6 tests). Unannounced raw ban/deactivate/session deletion on the user socket: found at the very next delivery (pass).
SCIM deactivation (PATCH, PUT, DELETE) x user|project: sessions are gone but the idle socket stays open (FAILS on main, 6 tests). A project socket in that state still delivers inside the 1.5s reuse window; both sockets otherwise close only at the next delivery after that or at the 60s floor. This is the leak (bounded, but a hard account-level revocation was left unannounced).

## Fix
`transitionPersonLifecycleInTransaction` returns `revokedUserId`; `setScimIdentityActiveInTransaction` passes it up; SCIM PATCH, PUT, DELETE and `setScimIdentityActive` announce `invalidateNativeAuthorization({userId})` after commit (`announceScimDeactivation`). No new permission model; same mechanism as the other announced paths.

## Results
New file 13/13 pass (6 fail without the fix). Neighbours pass: scim-admin, ws-project-reach, node-server-websocket (4 files, 70 tests). API unit 119/855; typecheck; test:permissions; check:route-policy; check:openapi pass.

## Not covered / residual
- A SCIM membership/grant change that removes only PROJECT reach (not the account) remains unannounced: bounded by the 1.5s reuse window on project sockets (#748 decision).
- Redis cross-instance delivery of the new announcement uses the existing control channel (covered by existing adapter tests); not re-run against real Redis here.

---

## Retained evidence file — 632-ordinary-a-luna.md

Origin SHA-256: `1d18692931af954ecb63e914cea9e54bf80ac602b4d92aa2d7276172c189d12e`.

# #632 ordinary review A — SCIM deactivation invalidates legacy WebSockets

**Verdict: PASS, no blocking findings.** This review covers the exact diff from `9297362b5f2dd1f17da935c8051c1562b473638a` to `e8b57d2214221243d64c995470fc63a274348c10` (branch `codex/legacy-ws-revocation-632`). The candidate changes three identity files and adds one API integration test.

## Reviewer and method

- **Review role:** ordinary independent reviewer A; fresh context, independent of the implementation author, and did not author, direct, or remediate this candidate.
- **Model provenance:** dispatched explicitly with `model=gpt-6-luna` (confirmed by the orchestrator). The literal served backend/model identity is not introspectable from inside this runtime.
- **Comparison:** exact base and head above, resolved with `git rev-parse`; reviewed candidate content using `git diff`, `git show`, and `git grep` against those object ids. No candidate checkout or mutable worktree source was used.
- **Commands run:** exact-object `git diff --stat`, `git diff --name-status`, targeted `git diff --no-ext-diff --unified=14`, `git show` of the SCIM lifecycle/protocol code, new listener test, person-lifecycle transition, invalidation helper, and governing identity contract; `git grep` for every SCIM lifecycle and authorization invalidation call site; and `git diff --check` for this base/head pair. The whitespace check passed. I did not run tests, typecheck, lint, PostgreSQL, browser, or Docker.
- The current repository checkout had unrelated dirty files; I did not alter or use them as candidate source.

## Review

The new `revokedUserId` comes from the shared person lifecycle transition only when the SCIM action is a deactivation of a person with a local user. It is returned through the source wrapper and through SCIM PATCH, PUT, and DELETE paths, then announced only after the enclosing `db.transaction()` resolves. The announcement reuses `invalidateNativeAuthorization({ userId })`; it adds no capability, event key, authorization rule, schema, or new revocation model. The existing control-channel consumer reauthorizes both native and legacy connections, while publish failures retain the established 60-second recovery bound.

The branch covers the standalone SCIM active-state wrapper and all protocol mutation surfaces. PATCH/PUT only carry an id when `active` actually transitions; DELETE uses the same shared transaction wrapper. Reactivation produces no revocation announcement. The change preserves IP-15's person-wide deactivation semantics, including sessions and keys revoked in the transaction and historical records retained. It does not widen into SCIM group-only reach loss, consistent with the separately documented #748 bound.

The new test opens WebSockets against a real Node listener with the real session cookie, primes user and project sockets, then checks idle closure after member sign-out, administrator sign-out-everywhere, administrator suspend, and each SCIM PATCH/PUT/DELETE deactivation. It verifies session rows are gone and that no later event is delivered. It also retains next-delivery coverage for unannounced raw ban/person/session changes on the user socket. This directly exercises the former SCIM announcement gap and the idle-socket behavior.

## Evidence and limits

The implementation evidence at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/632-impl-sonnet.md` reports 13/13 new listener tests passing, with 6 failing before the fix, plus the SCIM-admin, project-reach, and Node WebSocket neighbors (70 tests), typecheck, API unit tests, permission check, route-policy, and OpenAPI checks. These are author-reported results; I did not independently rerun them. The evidence also says the cross-instance Redis control-channel path was not exercised against real Redis in this change; existing adapter tests are cited there.

No blocking correctness issue found in the bounded diff. The remaining project-only reach case is explicitly bounded by the existing 1.5-second reuse window and is outside this change. These identity/authorization files are security-scope: this ordinary review does not replace the required independent GPT-6 Sol security pass.

---

## Retained evidence file — 632-ordinary-b-luna.md

Origin SHA-256: `b8608583cbc2e9bccb54daa1622d9d27549f77c686ee90dabb0290f5a09148c4`.

# #632 ordinary review B — GPT-6 Luna

**Model selector:** `gpt-6-luna`, `fork_turns=none` (fresh reviewer context)
**Role:** independent ordinary reviewer B
**Candidate:** `codex/legacy-ws-revocation-632`, head `e8b57d2214221243d64c995470fc63a274348c10`
**Base:** `9297362b5f2dd1f17da935c8051c1562b473638a`
**Verdict:** CLEAR

## Independence and scope

I did not author, direct, or remediate this change. I inspected exact Git objects, not the changing shared checkout. Scope checked: all four changed files and the complete new listener test; person lifecycle result propagation; all SCIM active-state call sites and their transaction boundaries; existing WebSocket invalidation and legacy authorization code; IP-15 deactivation contract and active mission/workflow; implementation evidence at `~/.codex/taskdesk-evidence/2026-10-15/632-impl-sonnet.md` as a claim list only.

## Findings

No blocking or non-blocking defect found in the bounded change. The shared person lifecycle returns a user id only for an inactive transition with a linked user. Each affected SCIM wrapper carries that value out of its outer transaction and calls `announceScimDeactivation` only after successful commit: standalone `setScimIdentityActive`, SCIM PATCH/PUT update flows, and the PATCH active-state helper used by DELETE. No announcement is emitted when no state changed or the transaction returns false/throws. The helper targets only that user through the existing private `identity.invalidate` mechanism; no permission or access model changes.

The invalidation reaches both native and legacy connection handlers. The legacy authorization helper forces a fresh check for control messages, bypassing the 1.5-second project-delivery reuse; failed authorization closes with policy code 1008. The 60-second refresh and delivery-triggered recheck remain recovery paths. Thus SCIM account deactivation gets immediate socket reauthorization after commit; project-only membership/grant changes retain their separately documented bounded behavior.

The new tests use a real Node HTTP/WebSocket listener, actual session cookies, actual SCIM PATCH/PUT/DELETE and administration sign-out/suspension endpoints, and both user and project socket routes. They prime delivery, leave sockets idle during revocation, require the close, then publish and assert no subsequent message. The extra unannounced-write case exercises the expected delivery-triggered fallback. The source sequencing is sufficient to rule out premature announcement on rollback by inspection; the new test file itself does not inject a transaction rollback.

## Evidence and limitations

- Inspected `git diff base head`, exact-head SCIM transaction paths and realtime authorization source; `git diff --check base head` passed.
- No tests, PostgreSQL, Redis, Docker, or browser runtime were run in this review because the shared carrier test window is reserved. The implementation report's results are not represented as my runs.
- Residual: cross-instance Redis delivery was not re-exercised against a live Redis service here; existing adapter tests and the established control channel are relied on. If control delivery is lost, existing refresh/delivery recovery applies. Membership-only reach-loss announcements are outside this SCIM account-revocation fix.

## Verdict

CLEAR for ordinary review B at the exact candidate SHA above. This is ordinary review only; the identity security-scope path still requires the separately assigned security review. This report does not imply stage completion.

---

## Retained evidence file — 632-security-sol.md

Origin SHA-256: `43d47f0ae47f3bb3533bfa65c9ed44c96d9e5532bd9cfa6238deb29656fe7780`.

# #632 independent security review — SCIM revocation of legacy sockets

**Verdict: CLEAR for this exact candidate.** No blocking or non-blocking finding in the bounded change.

## Identity, independence, and source

- **Role:** fresh independent full security reviewer. I did not author, direct, or remediate this candidate, and did not conduct either ordinary review.
- **Model provenance:** orchestrator dispatched this context with selector `gpt-6-sol`, `fork_turns=none`; the served backend identity is not introspectable from inside this runtime. This report claims the dispatch, not an independently measured backend version.
- **Branch:** `codex/legacy-ws-revocation-632`.
- **Reviewed base:** `9297362b5f2dd1f17da935c8051c1562b473638a`.
- **Reviewed head:** `e8b57d2214221243d64c995470fc63a274348c10`.
- **Source:** exact Git objects via `git diff`, `git show`, and `git grep`; no mutable carrier source was used.

## Security analysis

I inspected all four changed files, including the complete new real-listener test; every SCIM active-state call site; the person lifecycle transition and IP-15 contract; the legacy connection authorization, native invalidation, in-memory and Redis control-channel paths; and the author and two independent ordinary-review records. The shared lifecycle returns `revokedUserId` only when an inactive person with a linked user has sessions and keys revoked inside its transaction. `setScimIdentityActive`, SCIM DELETE, and both SCIM PUT/PATCH profile transactions propagate that id out of the **outer** `db.transaction()` and call `announceScimDeactivation` after successful commit. False returns and thrown/rolled-back transactions cannot publish this new message. Reactivation does not publish a revocation. The announcement targets that user's sockets only and uses the existing private `identity.invalidate` channel; it creates no new capability or public event.

The existing control-channel consumer passes the message to both native and legacy handlers. Legacy `/ws/user` and `/ws/{projectId}` connections are matched by user id and receive `check(undefined, { fresh: true })`, which bypasses the project's 1.5-second passing-lookup reuse. Each socket's ordered queue prevents a later delivery check from overtaking that fresh check; denial closes with 1008 and removes the connection. Authorization rechecks the original credential and person state. The same message schema is accepted by Redis; the in-memory listener tests exercise local behavior. The 60-second floor and delivery checks remain recovery paths if a control message is lost.

The new test uses real cookies and Node WebSocket upgrade paths. It primes both socket types, then checks idle close and no later delivery after actual sign-out, administrative sign-out/suspension, and SCIM PATCH/PUT/DELETE. It checks deleted session rows and the unannounced raw-write delivery fallback. The test does not inject an outer-transaction rollback or run multiple processes with Redis; rollback ordering is established by source inspection.

## Commands and limits

I resolved both exact object IDs; ran `git diff --stat`, targeted exact-object `git diff`, `git show` for changed source/test and realtime/identity neighbors, `git grep` for SCIM lifecycle call sites, and `git diff --check 9297362b5f2dd1f17da935c8051c1562b473638a e8b57d2214221243d64c995470fc63a274348c10` (pass). I read the governing workflow, CI security-scope list, IP-15 and realtime/reach contracts, and all supplied review records. I ran **0 tests** and **0** PostgreSQL, Redis, Docker, or browser checks because the carrier regression author held the runtime window. The separate Claude Sonnet 5.5 implementation record reports 13/13 new listener tests passing, with six SCIM cases failing before the fix, and 70 tests in four neighboring files passing; it also reports typecheck, permissions, route-policy, and OpenAPI checks. These are author evidence, not my executions. Both ordinary Luna reports are clear at this exact head.

Cross-instance Redis delivery of this specific new announcement was not exercised live. The existing channel implementation was inspected, and message loss retains the documented refresh/delivery bound. SCIM project-only reach loss remains the separately accepted 1.5-second case, outside this person-wide deactivation fix. Required hosted status checks on the final exact candidate and composition onto current `main` remain separate; this verdict makes no merge, issue-closure, or stage claim.

---

## Retained evidence file — 632-main-composition-luna.md

Origin SHA-256: `7d0be5090776b062fb86e30b156d18724d26065b0b94eff5291be00aa6b22acd`.

# #632 current-main composition review — GPT-6 Luna

**Verdict: CLEAR for composition at this exact head.** No blocking or non-blocking finding.

## Identity and reviewed source

- **Role:** fresh independent ordinary reviewer of the current-main composition; I did not author, direct, or remediate the candidate.
- **Model selector:** `gpt-6-luna` (as assigned by the orchestrator); the served backend identity is not independently introspectable here.
- **Branch:** `codex/legacy-ws-revocation-632`.
- **Exact candidate head:** `3e9021c2555abdde0de150d07f0309e6f74df3d9`.
- **First parent:** `e8b57d2214221243d64c995470fc63a274348c10` (the previously reviewed #632 source).
- **Second parent / current GitHub `main`:** `e9df2294fa580fd2885343bbef0cec28e81ead4c`. Verified both with `git rev-parse origin/main` and `gh api repos/ThomasHeinThura/ticketing/commits/main --jq .sha`.
- **Worktree:** `/Users/heinthura/.codex/worktrees/legacy-revocation-632/Ticketing.v2`; clean at review time.

## Commands and comparison

I ran `git status --short --branch`, `git rev-parse HEAD`, `git show -s --format=... HEAD`, `git log --graph --oneline --decorate --all -35`, `git diff --stat e9df2294...HEAD`, `git diff --stat e8b57d22...HEAD`, targeted `git diff` over the four changed files and the accepted-main project files, `git diff --check e9df2294...HEAD`, and the GitHub main-SHA query above. I read the repository workflow, active identity feature contract, relevant SCIM and WebSocket source, the two prior ordinary reports, the prior security report, and the implementation evidence. I ran no tests, typecheck, PostgreSQL, Redis, Docker, or browser checks; this review stayed read-only and respected the reserved runtime window.

The graph is a normal merge with the expected two parents. Against current `main`, the candidate adds only:

- `apps/api/src/identity/repository.ts`
- `apps/api/src/identity/scim-lifecycle.ts`
- `apps/api/src/identity/scim-protocol.ts`
- `tests/api-integration/legacy-ws-revocation.test.ts`

The diff is 382 insertions and 3 deletions. The nine-file difference from the first parent consists of the accepted current-main changes, including #767 project engagement settings authorization, its tests and contract updates, and its queue/status records. The candidate contains those main files unchanged from its second parent. `git diff --check` passed.

## Review findings

The integration preserves the reviewed #632 behavior. The lifecycle transition returns the linked user id only on person deactivation; SCIM wrapper and protocol paths carry it out of the transaction and announce after commit through the existing private `identity.invalidate` control path. `reauthorizeLegacyConnections` matches the user id across user and project sockets, and calls the ordered legacy check with `fresh: true`. That bypasses the existing 1.5-second project delivery reuse, while user sockets continue to recheck each delivery. Neither the authorization helper nor the legacy socket routes changed in the accepted-main merge.

The accepted-main #767 change tightens `PUT /api/project/{id}` engagement-field writes by requiring `project:manage_settings` after project reach is established. Its diff is limited to the project update handler/policy and project/RBAC/API contract and regression coverage. The shared `authorizeProjectSocketRead` predicate, project reach resolution, `legacy-project-reach.ts`, and socket reauthorization machinery are unchanged. I found no cross-boundary interaction that weakens socket authorization or changes SCIM deactivation behavior.

Prior ordinary reports and the full security report clear the original source at `e8b57d2214221243d64c995470fc63a274348c10` against `9297362b5f2dd1f17da935c8051c1562b473638a`. I treated those reports as provenance and rechecked the current exact merge graph and source diffs; they are not relabelled as reviews of this composition. The implementation report's runtime results remain author-reported, not my executions.

## Limits

This is an ordinary current-main composition review. It does not supply the separately required fresh full GPT-6 Sol composition pass, exact-head CI, runtime/image verification, PR approval, merge, issue closure, or stage-completion evidence. The existing cross-instance Redis limitation remains as stated in the original reports.

---

## Retained evidence file — 632-main-composition-sol.md

Origin SHA-256: `757f5a8e1521b7097f610c4b4e31a1e494f47fdb1be1d1163b81baed6409ed6e`.

# #632 current-main composition — independent full security review

**Verdict: CLEAR at exact head `3e9021c2555abdde0de150d07f0309e6f74df3d9`.** No blocking or non-blocking security finding in this composition.

## Identity and scope

- Role: fresh independent **full** Sol-tier security reviewer of the current-main composition. I did not author, direct, remediate, or perform the ordinary review of this candidate.
- Model provenance: the conductor dispatched this context as GPT-6 Sol for this bounded review. The served backend/version is not independently introspectable inside this runtime; this is the dispatch identity, not a measurement of backend internals.
- Branch/worktree: `codex/legacy-ws-revocation-632`, `/Users/heinthura/.codex/worktrees/legacy-revocation-632/Ticketing.v2`.
- Merge head `3e9021c2555abdde0de150d07f0309e6f74df3d9`, parents `e8b57d2214221243d64c995470fc63a274348c10` (previous #632 source) and `e9df2294fa580fd2885343bbef0cec28e81ead4c` (accepted main imported by this merge). I resolved the objects and verified the second parent is the merge base against that main object. I did not query GitHub's current main ref.
- Against the imported main object, the exact candidate changes only `apps/api/src/identity/repository.ts`, `scim-lifecycle.ts`, `scim-protocol.ts`, and `tests/api-integration/legacy-ws-revocation.test.ts`: 382 insertions, 3 deletions. The first-parent-to-head delta imports nine accepted-main files, chiefly the #767 project engagement settings authorization and its tests/specs, without changing #632's four files.

## Full composition security analysis

I inspected the complete candidate diff and the real-listener regression test; the shared IP-15 person lifecycle transition; all changed SCIM deactivation call sites; legacy and native socket invalidation, project-read authorization, ordered per-socket checks, the in-memory and Redis control-channel schemas; the accepted-main project route/policy diff; and the governing IP-15, realtime, RBAC, active-mission, workflow and CI security-review contracts. The earlier #632 ordinary/security verdicts and current-main ordinary verdict were read as provenance, not relabelled as this review.

The shared transition sets `revokedUserId` only for person-wide deactivation with a linked user. It deletes that user's sessions and disables personal keys in the same transaction that marks the person inactive and retires grants. Standalone `setScimIdentityActive`, the SCIM DELETE helper, and SCIM PUT/PATCH propagate the id out of their **outer** transaction and announce only after it resolves. A false/no-change return or thrown/rolled-back transaction does not reach the new announcement; reactivation carries null. The intervening pending-action audit-failure reporter has a bounded notifier that catches its own database failures, so it does not turn an audit alert failure into a missed revocation announcement.

`announceScimDeactivation` sends a user-targeted `identity.invalidate` on the existing private control channel. The consumer routes that same message to native subscriptions and both legacy `/api/ws/user` and `/api/ws/{projectId}` connections. Legacy reauthorization matches the user id and enqueues `check(undefined, { fresh: true })`; the ordered check forces a database authority read, bypasses the project socket's 1.5-second passing-lookup reuse, and closes a denied connection with 1008. The user socket retains its per-delivery fresh check. Redis accepts the same control schema and channel, while an absent adapter falls back to direct local checks. Publication failure or message loss retains the documented 60-second refresh/delivery recovery path.

The accepted-main #767 delta adds `project:manage_settings` for engagement-field writes after project reach and constrains those writes to supplied fields. It does not alter `authorizeProjectSocketRead`, the `project:read` capability, the socket reach predicate, the legacy credential recheck, the control message, or its delivery path. No new way to subscribe or keep a revoked socket follows from this import. Project-only reach loss without a person-wide SCIM deactivation remains the separately accepted #748 1.5-second case; this review does not broaden that seam.

## Commands, evidence and limits

Read-only commands included `git status --short --branch`, `git rev-parse`, `git show -s`, `git merge-base`, exact-object `git diff --stat/--name-status/--numstat`, targeted `git diff` of both parent comparisons, `rg` call-site searches, `sed`/`cat` source and contract reads, and `git diff --check e9df2294fa580fd2885343bbef0cec28e81ead4c..HEAD` (pass). The worktree was clean when checked. I ran **zero tests** and no typecheck, PostgreSQL, Redis, Docker, browser, or image checks; the checker owns the active runtime window. The separate implementation report at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/632-impl-sonnet.md` reports 13/13 new listener tests passing (six SCIM cases failed before the fix) and 70 neighboring tests passing; those are author results, not my executions. The new suite exercises real Node listeners/cookies and SCIM PATCH/PUT/DELETE for both legacy socket types, but does not inject outer rollback or run a real multi-process Redis path. Post-commit ordering and Redis message compatibility above are source findings, not fresh runtime proof.

This verdict is the required independent full security review of the **current composition**. It does not claim exact-head hosted CI, PR approval, image/boot/SIT acceptance, merge, issue closure, or stage completion. The previous full security report remains bound to `e8b57d2214221243d64c995470fc63a274348c10` against `9297362b5f2dd1f17da935c8051c1562b473638a` and is not represented as a review of this merge head.


---

## Accepted-main composition review — 2026-10-16

**Reviewed head:** `c9a52ca0f5c3174195f8516efdb88d64fc9d82d5`

Current source normally imports accepted main `1f2ea00404e41e108fad437c2b87caa3bbf56298`. All five unique #632 source/test/note blobs remain identical to prior publication `d20dc4f576f942015335fe28cd0f9619b581903e`; all accepted imports and the shared project-socket authority interaction were checked directly. Original two ordinary reviews and full Sol source/composition reviews remain attributed to their original heads. A fresh ordinary import context and a fresh full GPT-6.1 Sol security context CLEAR this exact composition. The full current security review checks the accepted API-key evaluator and SCIM invalidation join; it is not merely a no-overlap confirmation.

The conductor explicitly dispatched the current preparation/ordinary contexts with `gpt-6-luna`, and the independent security context with `gpt-6.1-sol`, all reviewers with `fork_turns:none`. The raw reports retain actual model-introspection limits; no report is relabelled. The conductor composes and publishes and is not a reviewer. Earlier missing workspace declaration failures and their existing-dependency build correction are preserved below; current API typecheck passes.

These five records are reproduced unchanged. The ordinary report cites earlier API #784 source-review runtime limits; those are historical. The pair actually passed all18 checks, PG209files/3,135tests and image125migrations/UID10001 before accepted main1f2ea004. Those API results do not establish runtime results for this #632 candidate. Current #632 full hosted checks, image proof, deployed journeys and real multiprocess Redis proof remain separate and pending. Both Carrier performance findings remain open. No release, SIT, issue or stage completion is claimed.

## Authentic record — realtime632-accepted795-main-preparation-luna.md

Origin SHA-256 `fb4e8e580ed719a8ecfd669162ab195b064a7e6fe65a25d366ed60ca78f37ee0`; 6169 original bytes.

# #796 / #632 accepted-main local preparation

Prepared 2026-10-16. This is local composition evidence only; it is not current-head review, runtime acceptance, or issue closure.

## Source and guard checks

- Worktree: `/Users/heinthura/.codex/worktrees/legacy-revocation-632/Ticketing.v2`
- Branch: `codex/legacy-ws-revocation-632`
- Pre-merge HEAD: `d20dc4f576f942015335fe28cd0f9619b581903e`; clean before mutation.
- Its first-parent chain preserved: `e8b57d2214221243d64c995470fc63a274348c10` (original #632 source), `3e9021c2555abdde0de150d07f0309e6f74df3d9` (reviewed composition with accepted `e9df2294fa580fd2885343bbef0cec28e81ead4c`), and `d20dc4f576f942015335fe28cd0f9619b581903e` (own security-review publication).
- Live GitHub `refs/heads/main`, `origin/main`, and the explicitly accepted target all agreed at `81781ab244cc1e6c9fac667f309de17a1e494caa` when checked. PR #796 remained open at head `d20dc4f576f942015335fe28cd0f9619b581903e`; its stored PR base SHA was older (`e9df2294...`). The primary checkout's local `main` is a separate old checkout and was not touched.

## Composition

Local merge completed without conflicts. New HEAD: `bd74c19e3cbad8b3137a97549d85a0995c50ef90`.

- First parent: `d20dc4f576f942015335fe28cd0f9619b581903e`
- Second parent: `81781ab244cc1e6c9fac667f309de17a1e494caa`
- Subject: `Merge commit '81781ab244cc1e6c9fac667f309de17a1e494caa' into codex/legacy-ws-revocation-632`
- Branch is locally ahead of `origin/codex/legacy-ws-revocation-632`; nothing was pushed.

The merge result's 34 first-parent delta paths are the accepted-main import: `.github/workflows/ci-full.yml`, `.gitleaksignore`, `apps/api/src/auth/repository.ts`, `apps/api/src/database/executor.ts`, `apps/api/src/identity/oidc-login.ts`, `apps/api/src/instance/users/repository.ts`, `apps/api/src/pending-action/service.ts`, `apps/api/src/work-item/controllers/create-comment.ts`, `apps/web/src/components/task/task-description.test.tsx`, `docs/01-architecture/{monorepo-layout,multi-tenancy,security-model,tech-stack}.md`, `docs/03-features/webhooks-and-api-keys.md`, `docs/04-engineering/{ci-cd,coding-standards,definition-of-done}.md`, `docs/07-planning/decision-log.md`, `docs/07-planning/integration-execution-queue.md`, `docs/07-planning/reviews/2026-09-05/features-governance-design.md`, accepted-main security review records `764-query-ownership.md`, `776-task-description-editor-teardown.md`, `780-owner-conductor-decisions.md`, `782-webhooks-review-disposition.md`, `hosted-image-proof-20261016.md`, `identity-timezones-631.md`, `takeover-checkpoint-20261016.md`, `docs/07-planning/status.md`, `scripts/ci/run-shipping-image-smoke{,.test.mjs}`, `tests/api-integration/database-executor.test.ts`, `tests/api-integration/identity-clock-{ahead-of-utc,behind-utc}.test.ts`, and `tests/api/database-executor.test.ts`.

No #784, #785, or #803 source paths were brought in by this merge. The imported queue/status/log text records their state, including that #784's live CI repair is still pending; this is records, not product-source import. `.gitleaksignore` and `decision-log.md` were additive, conflict-free accepted-main content. No semantic conflict needed adjudication.

## #632 conservation

These required unique blobs match exactly between pre-merge `d20dc4f5` and merged `bd74c19e`:

| Path | Blob at both heads |
| --- | --- |
| `apps/api/src/identity/repository.ts` | `d72a0a93fd47521f201fde8f9bf08802985455a4` |
| `apps/api/src/identity/scim-lifecycle.ts` | `05e6e43b34247c72ebca636b1c0f1d567ad7239a` |
| `apps/api/src/identity/scim-protocol.ts` | `551c70e468169358e1cb1c363b77902dd5e429b9` |
| `tests/api-integration/legacy-ws-revocation.test.ts` | `5568cc91ed845b45f81044f574e655e07d2a604a` |
| `docs/07-planning/security-reviews/legacy-revocation-632.md` | `032861f87ec4a2289c02ab808a8068b3dcfa6209` |

The original source, reviewed composition, and own-note publication commits remain in first-parent history. The 632 note and all its retained ordinary/full-Sol reports, source-bound test and six-mutant evidence, and adverse runs are byte-preserved; the note still attributes reviews to their original exact source. No route/revocation/proof weakening, source edit, contract, dependency, environment variable, or flag was added.

## Checks and limits

- `git status --short` after merge and frozen install: clean; install artifacts are ignored.
- `git diff --check HEAD^1 HEAD` reported trailing whitespace and blank-at-EOF warnings only in accepted-main imported review records (including `764-query-ownership.md`, `776-task-description-editor-teardown.md`, `780-owner-conductor-decisions.md`, `782-webhooks-review-disposition.md`, `hosted-image-proof-20261016.md`, `identity-timezones-631.md`, and `takeover-checkpoint-20261016.md`). No 632 file was implicated. These imported historical records were preserved exactly.
- Initial API typecheck could not start because the worktree lacked `node_modules`. `pnpm install --frozen-lockfile` succeeded without lockfile change. Retried `pnpm --filter api run typecheck`; it failed because workspace declaration outputs for `@taskdesk/permissions`, `@taskdesk/domain`, and `@taskdesk/email` were unavailable, with cascading implicit-any errors. No package build was attempted.
- No tests, full suite, PostgreSQL/Docker, browser, image build, CI rerun, push, PR edit, or merge-to-main was performed.
- Existing PR check data was bound to old `d20dc4f5`; it is not evidence on `bd74c19e`. At the old head the template/security-review check was red. This preparation creates no current review or acceptance claim.

## Residuals and next dependency

This is only local preparation. The conductor's sequencing requires the current API-key #784 repair/CI to land before this branch's final accepted-main import/freeze. Then re-import the resulting exact accepted `main` into this branch and obtain the review depth required for the new exact candidate (security scope remains present), followed by current-source runtime/image and remaining acceptance. Preserve the previous-source evidence but do not reuse it as current-head approval. No new multiprocess Redis acceptance claim is made.


## Authentic record — realtime632-api-typecheck-prerequisites-luna.md

Origin SHA-256 `f3a38bff8e12c371ab7edb5be9b6b3138371dfe73e8f688275a21bc3d409a646`; 2638 original bytes.

# #796 / #632 API typecheck prerequisite receipt

This follow-up only prepared existing workspace declarations and ran the API typecheck. It did not change source, dependencies, lockfiles, or candidate history.

## Exact source and worktree

- Worktree: `/Users/heinthura/.codex/worktrees/legacy-revocation-632/Ticketing.v2`
- Branch: `codex/legacy-ws-revocation-632`
- Exact source HEAD: `bd74c19e3cbad8b3137a97549d85a0995c50ef90`
- Tracked worktree state: clean before and after; dependency output is under ignored `dist/`.
- Frozen dependency installation had already completed in the prior preparation (`pnpm install --frozen-lockfile`, lockfile unchanged).

## Failure sequence retained

1. `pnpm --filter api run typecheck` before install exited **1**: `sh: tsc: command not found`, `spawn ENOENT`; pnpm reported the local package tree lacked `node_modules`.
2. `pnpm install --frozen-lockfile` completed successfully with the existing lockfile and no dependency/lockfile edit.
3. `pnpm --filter api run typecheck` after install but before package builds exited **1**. `tsc` could not resolve workspace declarations for `@taskdesk/permissions`, `@taskdesk/domain`, and `@taskdesk/email`; those unresolved imports caused cascading implicit-any diagnostics. This is the original failure recorded in the prior prep handoff.

## Minimal build and successful retry

Command: `pnpm exec turbo run build --filter=@taskdesk/api^...`

Exit: **0**. Turbo selected workspace dependency builds for `@taskdesk/domain`, `@taskdesk/email`, and `@taskdesk/permissions` (plus the declaration-only config package in scope). Result: **3 successful build tasks, 3 cached**, no tests executed. The restored output trees contained 132 files under `packages/domain/dist`, 33 under `packages/email/dist`, and 42 under `packages/permissions/dist`.

Command: `pnpm --filter api run typecheck`

Exit: **0**. This ran all five configured TypeScript commands:

- `tsc --noEmit -p tsconfig.json`
- `tsc --noEmit -p tsconfig.permissions.json`
- `tsc --noEmit -p tsconfig.tests.json`
- `tsc --noEmit -p tsconfig.rls-prototype.json`
- `tsc --noEmit -p ../../tests/e2e/tsconfig.approvals.json`

## Scope and next dependency

Only existing direct workspace build prerequisites were produced; no app build, test suite, PostgreSQL/Docker, image, browser, push, or publication was run. Candidate remains exactly `bd74c19e3cbad8b3137a97549d85a0995c50ef90`. This typecheck does not satisfy current-head review/runtime acceptance. Wait for the API #784 repair to land on accepted `main` before the eventual final composition and freeze; this follow-up made no such import.


## Authentic record — realtime632-accepted784-main-composition-luna.md

Origin SHA-256 `02c7f01f2bd55c56fbb42a812319573e1c4ee7e9b36d8f925e0c4f275603dab9`; 5637 original bytes.

# #796 / #632 accepted #784 main composition

Local composition receipt only. No current-head independent review or runtime acceptance is claimed.

## Exact source and accepted target

- Worktree: `/Users/heinthura/.codex/worktrees/legacy-revocation-632/Ticketing.v2`
- Branch: `codex/legacy-ws-revocation-632`
- Pre-import source: `bd74c19e3cbad8b3137a97549d85a0995c50ef90`, clean.
- `gh api repos/ThomasHeinThura/ticketing/git/ref/heads/main --jq '.object.sha'` returned `1f2ea00404e41e108fad437c2b87caa3bbf56298`.
- `gh pr view 784` returned `MERGED`, merge time `2026-10-16T07:55:21Z`, merge commit `1f2ea00404e41e108fad437c2b87caa3bbf56298`, source head `016978fc362d5c2e3e88a4d909013c53f2bc1885`.
- `git fetch origin main` succeeded; `FETCH_HEAD` was `1f2ea00404e41e108fad437c2b87caa3bbf56298`.
- `git rev-parse 016978fc362d5c2e3e88a4d909013c53f2bc1885^{tree}` and `git rev-parse 1f2ea00404e41e108fad437c2b87caa3bbf56298^{tree}` both returned `7734b48fd3ce44ff232cb9c818edfa83f87be3e5`.

## Overlap inspection

The merge base of pre-import source and accepted main is `81781ab244cc1e6c9fac667f309de17a1e494caa`. Path-set intersection between changes from that base on each side was empty.

A tip-to-tip comparison misleadingly lists the three SCIM identity files plus the #632 test and note as differing because they are #632-only additions from the common base. Direct blob checks showed the accepted #784 tree has exactly the same blob as the common base for each SCIM identity file:

| Path | `81781ab` base and accepted `1f2ea004` | #632 pre-merge `bd74c19` |
| --- | --- | --- |
| `apps/api/src/identity/repository.ts` | `19affff2102d8c3b7dccedd91d98cc50eafd0da9` | `d72a0a93fd47521f201fde8f9bf08802985455a4` |
| `apps/api/src/identity/scim-lifecycle.ts` | `a946e3c78b6e409f1018ad0cc26d219e2a438c3f` | `05e6e43b34247c72ebca636b1c0f1d567ad7239a` |
| `apps/api/src/identity/scim-protocol.ts` | `f0baa1e6564aa48b87caa792341213a7bf8319e0` | `551c70e468169358e1cb1c363b77902dd5e429b9` |

The accepted #784 source delta changes project/key reach paths and their tests; it adds no SCIM lifecycle/revocation implementation. No behavior-changing overlap or manual conflict resolution was needed.

## Composition result and conservation

Normal local merge succeeded without conflicts:

- New HEAD: `c9a52ca0f5c3174195f8516efdb88d64fc9d82d5`
- First parent: `bd74c19e3cbad8b3137a97549d85a0995c50ef90`
- Second parent: `1f2ea00404e41e108fad437c2b87caa3bbf56298`
- Subject: `Merge commit '1f2ea00404e41e108fad437c2b87caa3bbf56298' into codex/legacy-ws-revocation-632`

All five unique #632 blobs remained exact across pre- and post-merge heads:

| Path | Blob at both heads |
| --- | --- |
| `apps/api/src/identity/repository.ts` | `d72a0a93fd47521f201fde8f9bf08802985455a4` |
| `apps/api/src/identity/scim-lifecycle.ts` | `05e6e43b34247c72ebca636b1c0f1d567ad7239a` |
| `apps/api/src/identity/scim-protocol.ts` | `551c70e468169358e1cb1c363b77902dd5e429b9` |
| `tests/api-integration/legacy-ws-revocation.test.ts` | `5568cc91ed845b45f81044f574e655e07d2a604a` |
| `docs/07-planning/security-reviews/legacy-revocation-632.md` | `032861f87ec4a2289c02ab808a8068b3dcfa6209` |

The accepted-main import delta is exactly these 16 paths: `apps/api/src/attachment/require-attachment-reach.ts`, `apps/api/src/project/index.ts`, `apps/api/src/utils/assert-work-item-project-reach.ts`, `apps/api/src/utils/caller-reach.ts`, `apps/api/src/utils/has-project-reach.ts`, `apps/api/src/utils/workspace-access-middleware.ts`, `apps/api/src/work-item/require-work-item-reach.ts`, `docs/07-planning/security-reviews/784-api-key-project-authority.md`, `tests/api-integration/api-key-project-capabilities.test.ts`, `tests/api-integration/api-key-project-role-clamp-strict.test.ts`, `tests/api-integration/api-key-project-role-clamp.test.ts`, `tests/api-integration/project-default-comment-visibility.test.ts`, `tests/api-integration/project-engagement-manage-settings.test.ts`, `tests/api-integration/strict-runtime-enforcement.test.ts`, `tests/api-integration/task-update-concurrency.test.ts`, and `tests/api/utils/require-api-key-permission-scope.test.ts`. No #785 or #803 product paths were imported. No status, queue or decision-log edits were made by this composition.

## Commands and results

- `git fetch origin main` — exit 0; fetched accepted `1f2ea004...`.
- `git merge --no-ff --no-edit 1f2ea00404e41e108fad437c2b87caa3bbf56298` — exit 0; `ort` merge, no conflicts.
- `pnpm --filter api run typecheck` — exit 0 at `c9a52ca0...`; all five configured `tsc --noEmit` projects passed (`tsconfig.json`, `tsconfig.permissions.json`, `tsconfig.tests.json`, `tsconfig.rls-prototype.json`, and `tests/e2e/tsconfig.approvals.json`). Existing workspace declarations had been built in the previous bounded preparation.
- `git diff --check HEAD^1 HEAD` — exit 2 with 85 output lines, all trailing-space warnings in the imported immutable `docs/07-planning/security-reviews/784-api-key-project-authority.md`; no #632 path was flagged. File preserved byte-for-byte from accepted main.
- Final `git status --short --branch`: clean; branch remains local and ahead of its remote. No push or review-note append.

No tests, PostgreSQL/Docker, browser, image/build, full suite, CI rerun, publication, or merge-to-main was performed. #632 review/evidence is preserved unchanged and remains historical-source evidence only. Root owns fresh independent import review and full current-source/image acceptance. This branch is now locally composed on accepted #784 main; do not freeze it against a newer main if the conductor advances the accepted base before review.


## Authentic record — realtime632-c9-import-ordinary-luna.md

Origin SHA-256 `8a8e90974798f632f5262f8aecec8728161224218995e9be0fc34db57e1245ff`; 6451 original bytes.

# #796 / #632 accepted-main import — independent ordinary review

**Verdict: CLEAR for the local accepted-main import at `c9a52ca0f5c3174195f8516efdb88d64fc9d82d5`.** No blocking or non-blocking finding in the reviewed import and its interaction with #632. This report is ordinary source review only; the required fresh Sol confirmation, current hosted checks, and current runtime/image evidence remain separate.

## Identity, source and independence

- **Role:** fresh independent ordinary reviewer; I did not author, direct, or remediate the source or either import.
- **Model provenance:** assigned by the conductor as an ordinary GPT-6 Luna-tier review. The runtime does not expose a finer independently verifiable served-model/version identifier.
- **Worktree / branch:** `/Users/heinthura/.codex/worktrees/legacy-revocation-632/Ticketing.v2`, `codex/legacy-ws-revocation-632`.
- **Exact reviewed head:** `c9a52ca0f5c3174195f8516efdb88d64fc9d82d5`, clean at review time.
- **Parents:** first parent `bd74c19e3cbad8b3137a97549d85a0995c50ef90`; second parent accepted main `1f2ea00404e41e108fad437c2b87caa3bbf56298`.
- **Lineage:** `d20dc4f576f942015335fe28cd0f9619b581903e` → merge `bd74c19e` importing accepted `81781ab244cc1e6c9fac667f309de17a1e494caa` (#795), then `c9a52ca0` importing accepted `1f2ea004` (#784). Both main commits are ancestors of the reviewed head; the tree/source-parent metadata agrees with the recorded preparation receipts.

## Checks and source scope

I read `AGENTS.md`, the active mission, agent workflow, `CLAUDE.md`, the identity-provisioning contract (including IP-15/IP-22), auth and RBAC contracts, the retained #632 original reports and exact source, and both requested private accepted-main preparation/composition receipts. I inspected exact Git parents, both import deltas, the SCIM lifecycle and protocol call sites, legacy socket reauthorization, the shared project-socket authorization evaluator, and the #784 source/review record.

Read-only Git checks confirmed:

- `bd74c19e` is a normal merge with parents `d20dc4f5` and accepted main `81781ab2`; its import delta consists of the 34 paths in the preparation receipt.
- `c9a52ca0` is a normal merge with parents `bd74c19e` and accepted main `1f2ea004`; its import delta is the recorded 16 #784 paths. No source-join conflict was manually resolved. The imported status/queue/decision content is absent from this second import delta.
- All five required #632-only blobs match exactly between `d20dc4f5` and `c9a52ca0`: `apps/api/src/identity/repository.ts` (`d72a0a93…`), `scim-lifecycle.ts` (`05e6e43b…`), `scim-protocol.ts` (`551c70e4…`), `tests/api-integration/legacy-ws-revocation.test.ts` (`5568cc91…`), and `docs/07-planning/security-reviews/legacy-revocation-632.md` (`032861f8…`).
- The #632 original implementation remains in history as `e8b57d2214221243d64c995470fc63a274348c10`; the reviewed `3e9021c2…` composition and `d20dc4f5…` report-publication commit remain on the first-parent lineage. Their reviews remain attributed to their original exact source.
- `git status --porcelain` was empty. No tests, typecheck, PostgreSQL, Redis, Docker, browser, image build, CI, or hosted-runtime checks were run in this review.

## Interaction assessment

There is one real, focused semantic join: #784 changes `evaluateProjectRead`/`has-project-reach`, and that evaluator is also used by `authorizeProjectSocketRead` for legacy project-socket upgrade and reauthorization. The import therefore changes the current project/API-key authority calculation used when a live project socket is rechecked. I followed this through the imported helper and socket call graph rather than treating the shared file as unrelated.

The accepted #784 implementation computes a key's project capability as current owner authority intersected with the stored key scope; missing/malformed scope fails closed. The #632 change sends the existing user-targeted invalidation only after the outer SCIM transaction commits. That reaches the existing legacy reauthorization loop, which performs a fresh check for matching user and project sockets. IP-15's transaction also revokes the user's sessions and API-key rows and sets the person inactive; the fresh identity check therefore refuses the deactivated account. The imported evaluator does not alter the invalidation target, ordering, transaction boundary, or recovery floor. I found no path by which the #784 import preserves access after SCIM person deactivation or weakens the accepted project/key authority ceiling.

#795's imported UTC-time and transaction-related changes do not modify the #632 SCIM lifecycle files, the invalidation channel, or the socket authorization path. No behavioral join requiring a manual merge decision was present. The focused shared-evaluator interaction is security-scope, so the assigned fresh Sol confirmation must explicitly cover it. The accepted #784 review record includes an earlier main-composition blocker about project-settings authority and records its project-target-authority repair and independent ordinary/full-Sol clearance before accepted main; I verified the imported source uses that repaired project-facts path. I did not treat that prior review as review of this #632 composition.

## Evidence limits and residuals

The preserved #632 implementation evidence reports the new real-listener integration file at **13/13 passing**, with the six SCIM-deactivation cases failing against the pre-fix behavior, plus 70 tests in four neighboring files and the named static checks. These remain author-reported historical results; I did not rerun them, mutate source, or independently reproduce PostgreSQL outcomes. The retained #632 reports explicitly leave real multi-process Redis delivery unrerun and note no injected outer-transaction rollback case. No current hosted PostgreSQL/image/runtime proof is established here. The newer #784 accepted-main report also records PostgreSQL regressions as not locally rerun and complete current hosted/image acceptance as pending; those limits remain.

**Verdict: CLEAR** for this bounded ordinary accepted-main import review at exact head `c9a52ca0f5c3174195f8516efdb88d64fc9d82d5`. The focused project-socket authority interaction requires the separately assigned fresh Sol confirmation. This report does not claim current runtime acceptance, exact-head CI, PR approval, merge, issue closure, or stage completion.


## Authentic record — realtime632-c9-full-security-61-sol.md

Origin SHA-256 `1950740d1bb4bdd86cfb74edf745f1b8e9def2f82af342242c8b93e7267d7a5d`; 10301 original bytes.

# #796 / #632 — independent full security review of accepted-main composition

**Model:** GPT-6.1 Sol  
**Reviewed head:** c9a52ca0f5c3174195f8516efdb88d64fc9d82d5  
**Comparison base:** accepted main 1f2ea00404e41e108fad437c2b87caa3bbf56298  
**Verdict:** CLEAR — no blocking or non-blocking security defect found in this exact composition.

## Identity and independence

I am the fresh independent full security reviewer context `/root/realtime632_c9_full_security_sol`. I did not author, direct, remediate, or advise the candidate, its imports, or its ordinary review. The conductor assigned this run explicitly as GPT-6.1 Sol; that is the reported dispatch identity, not a claim that I independently introspected the serving backend/version. The runtime exposes no independently verifiable finer backend identity. This report is not relabelled GPT-6 Sol. The accepted workflow model block permits GPT-6.1 Sol. This context fills the security-review role only.

## Source and checks actually performed

I read the repository instructions, active mission, workflow/model and review requirements, CLAUDE provider adapter, IP-15 deactivation contract, relevant RBAC/evaluator contract and implementation, the retained original #632 ordinary/full-security and 3e9021c2 composition reports, the two accepted-main preparation receipts, the current c9 ordinary report, and the accepted #784 security report and final readiness receipt. Historical verdicts were provenance and leads; I checked the combined current call graph directly.

Read-only Git/source commands included rev-parse, show parents, diff/stat/name-only, merge-base ancestry, exact blob comparison via Python/subprocess, rg, sed, cat, and status. I inspected all three changed identity files and the complete new listener test, the legacy routes and ordered authorization helper, native credential refresh/topic reauthorization, the shared project socket authorization, identity resolver, stored key verification and permission projection, canonical can/authorityFor evaluation, and both in-memory and Redis control adapters. No candidate source, PR, branch, or review publication was edited.

The local HEAD is exactly c9a52ca0f5c3174195f8516efdb88d64fc9d82d5, with parents bd74c19e3cbad8b3137a97549d85a0995c50ef90 and accepted 1f2ea00404e41e108fad437c2b87caa3bbf56298. The latter is an ancestor. The 16 first-parent import paths are the accepted #784 paths recorded in the composition receipt; net against accepted main is exactly the five #632-only paths. All five blobs match d20dc4f576f942015335fe28cd0f9619b581903e exactly:

- repository.ts: d72a0a93fd47521f201fde8f9bf08802985455a4
- scim-lifecycle.ts: 05e6e43b34247c72ebca636b1c0f1d567ad7239a
- scim-protocol.ts: 551c70e468169358e1cb1c363b77902dd5e429b9
- legacy-ws-revocation.test.ts: 5568cc91ed845b45f81044f574e655e07d2a604a
- legacy-revocation-632.md: 032861f87ec4a2289c02ab808a8068b3dcfa6209

Unaccepted #785 e533a9875e47399247b740b53f6fd192fa43ec9d and live #803 head 0fddd1d6edeaedb6e5de2d58f694e26d91485955 are not ancestors (both ancestry commands returned 1). The actual five-path net tree and accepted-parent import contain no extra unaccepted source. `git diff --check 1f2ea004 HEAD` produced no findings. Worktree status was clean.

Read-only GitHub queries confirmed #784 is MERGED at 1f2ea004 on 2026-10-16T07:55:21Z. #796 was still OPEN on remote d20dc4f5 at query time; this report reviews the local c9 candidate, not that older remote SHA. The #784 final protected-readiness receipt records all 18 required checks successful, PostgreSQL 209 files / 3135 tests, and the shipping image proof records 125 migrations, UID 10001 and healthy 200 live/ready. These are accepted-producer evidence, not executions by me. Older #784 reports describing hosted/image work as pending are historical and do not describe its current accepted state.

## Full composition security assessment

There is a real shared authority join: imported #784 changes evaluateProjectRead in has-project-reach, and authorizeProjectSocketRead calls it for legacy project upgrade/reauthorization and native project subscriptions. I traced this join rather than treating disjoint changed paths as proof of independence.

The socket builds its identity with the key's stored permissions projected through apiKeyCapabilitySubset. The identity loader supplies current owner facts; missing/inactive person, banned owner, missing/disabled key facts, and owner mismatch refuse identity. Canonical can first requires current target-scoped owner authority, including project-role override, and then intersects the key subset; missing or malformed key scope has no capability. The project socket consumes decision.capable and decision.reachable, never the new ownerCapable-only/defer helpers. It additionally requires stored work_item:read because the project stream carries work-item events. Thus the new owner-only view cannot widen socket authority. The evaluator's extra ownerCapable calculation does not replace the actual capable result.

Target reach remains based on the project's own persisted workspace and customer organisation, excludes archived/deleted projects and unreachable workspaces, and uses project:read on that target. Hidden, missing and denied projects are refused. No new instance capability, sees_all grant, customer key permission or identity-provider-derived administrator authority is introduced. Native work-item topic authorization still uses its existing separate path; this candidate does not change that path's target construction, and this review makes no claim to redesign it.

Legacy user and project connections retain the original upgrade request credential, and their authorize callbacks rerun authenticateApiRequest and local-factor enforcement. Key requests rerun verifyApiKey against enabled/unexpired persisted key and current active/unbanned owner, then replace the context's key permissions. Cookie requests rerun host/portal-specific Better Auth session lookup; IP-15 deletes every session and cookie caching is disabled by the established contract. Both legacy callbacks verify the same user and agent portal; project sockets then run the shared reach/capability evaluator. Native reauthorization similarly refreshes credentials before reevaluating topics. A previously sufficient stored scope or cached passing project lookup therefore cannot preserve a revoked credential across the forced fresh check.

The #632 lifecycle result carries the linked user id only for deactivation. IP-15 sets the person inactive, deletes sessions, disables keys and retires/reprojects grants in the same transaction. The standalone lifecycle wrapper, SCIM DELETE active-state helper, and PUT/PATCH profile paths all propagate that id out of their OUTER transaction/retry result before announcing. Exceptions/rollback never reach announcement; false/no-change results do not announce, and activation yields null. PUT/PATCH do not publish between the inner lifecycle change and subsequent profile/provisioning writes. The intervening pending-action audit failure notifier catches its bounded database notification failures, preserving the announcement path.

The announcement contains only the server-derived user id on the existing private identity.invalidate control channel. Native invalidation matches credential user ids; legacy invalidation checks all matching user/project connections with fresh:true, bypassing the 1.5-second project delivery reuse. Ordered per-socket checks fail closed and close with 1008; user delivery has no reuse window. The Redis adapter validates the control schema and delivers the same message to local native and legacy handlers on each subscriber. The in-memory adapter and no-adapter local fallback match that shape. This establishes source compatibility, not live multiprocess delivery. Publish failure/message loss retains the established 60-second refresh and delivery-triggered recovery; publication completion is not a distributed acknowledgement barrier. No stronger instantaneous distributed guarantee is claimed.

#795's imported database/UTC-time and auth repository work does not rewrite the three SCIM lifecycle blobs, project authority decision, or invalidation mechanism. The accepted-main additions do not move the new announcement into the transaction or skip the live credential checks. No composition bypass of revoked sessions/keys, inactive owners, stored key subset, or target project reach was found.

## Tests, residuals and verdict

I ran zero tests, typechecks, PostgreSQL, Redis, Docker, browsers, image builds, full suites or CI jobs. This was a full independent security SOURCE review, within the conductor's runtime restrictions. The preserved original author evidence reports 13/13 new real-listener tests passing (six SCIM cases fail without the fix) plus 70 neighboring tests; those are historical author runs, not current-c9 runtime proof. The new test source uses real cookies/listeners and actual PATCH/PUT/DELETE, primes delivery, waits idle for policy closure and verifies no later delivery. It does not inject outer rollback or cover real multiprocess Redis propagation. The rollback conclusion above is from source sequencing.

**Blocking findings:** none.  
**Non-blocking findings:** none in this bounded composition.  
**Residuals:** current #632 exact-head CI and shipping-image/runtime gates remain unrun; fresh PostgreSQL/runtime acceptance belongs to the conductor's next verification window. Real multiprocess Redis proof remains absent. Project-only unannounced grant loss retains the separately accepted bounded 1.5-second project reuse behavior; it is not person-wide SCIM deactivation. Existing accepted #784 explanatory-comment/historical-note whitespace observations are not new authority defects in this composition.

**CLEAR** for the full independent security source review of c9a52ca0f5c3174195f8516efdb88d64fc9d82d5 against accepted 1f2ea00404e41e108fad437c2b87caa3bbf56298. This is fresh current-composition review, not a relabelling of original e8 or 3e source reviews. It does not assert PR approval, current runtime acceptance, merge, issue closure, stage completion, SIT acceptance or multiprocess proof. Root alone publishes and merges after all actual current gates pass.

