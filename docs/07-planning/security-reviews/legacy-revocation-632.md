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
