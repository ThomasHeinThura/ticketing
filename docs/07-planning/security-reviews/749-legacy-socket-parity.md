# PR #749 security review record: legacy and native project sockets share one read-authorization rule (#748)

PR #749 closes #748 and contains PR #747 (#745). Both project sockets, the native `project:{id}` topic and the legacy `/api/ws/{projectId}` socket, now use one rule in `apps/api/src/ws/project-read-authorization.ts`.

**The rule:** the project exists and is neither soft-deleted nor archived; the caller has reach to it; the caller holds `project:read`, clamped by an API key's stored scope; and a key must also hold `work_item:read`. The customer organisation is read from the project row. Every refusal is the same identical 401 or close.

**Also:**
- at most 5 legacy project sockets per person per replica, closed with 1008 "connection limit" above that, with the native socket sharing the constant;
- a passing check is reused for 1.5 s by event deliveries; the 60-second floor and announced invalidations always look again;
- the web hook stops retrying after a 1008 "connection limit" close.

A Claude Sonnet 5.5 lane implemented the change. The reviewers below are fresh, independent contexts. The #747 part has its own record in `747-realtime-project-reach.md`.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: APPROVE at `ce5105a7` (delta from #747 head `4ac27502`). 8 of 10 mutations were caught; the 2 survivors are non-blocking.
- Ordinary review A, delta round by the same reviewer: APPROVE at `43180c29`, which adds the web reconnect stop and closes review gaps.
- Ordinary review B by Claude Sonnet 5.5 (fresh context, full delta): APPROVE at `43180c29` with non-blocking findings, including a single integration flake that did not reproduce in 3 reruns.
- Security review by Claude Opus 5.5: CLEAR at `43180c29`. No blocking findings; six non-blocking notes, including the reuse-window wording and the native `work_item:` topic organisation source, are tracked as follow-ups.
- Security rebind by Claude Opus 5.5: CLEAR at `759fedc4`. This head merges #747's resolved head `876fa7ea`, which contains `main` `d7ab1a71`. `git merge-tree` reproduces the same tree with no conflicts and no hand edits; the only file both sides touched is `rbac.md`, in separate paragraphs. The shared rule still governs both sockets. Permissions (107 tests), API `tsc` and the ws unit tests (72 tests) pass.

**Reviewed head:** `43180c29ca47e386a7057b4ec168284e2f91e8f1`
**Reviewed head:** `759fedc4d979be24c2da842dab7bbd6ff6ca68dc`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `748-ordinary-a-sonnet.md` | Ordinary review A (4ac27502..ce5105a7) | Claude Sonnet 5.5 | `ce5105a7` | APPROVE | `8c4b12bbe7bf1ab08e4ef91228115b8544fb55d25c6eec08bc1d86b97ab2a968` |
| 2 | `749-4318-ordinary-delta-a-sonnet.md` | Ordinary review A, delta (ce5105a7..43180c29) | Claude Sonnet 5.5 | `43180c29` | APPROVE | `f513ddc8ab3f05cf4829c149eccac91a480448843683858f92cd8d9c98906603` |
| 3 | `749-ordinary-b-sonnet.md` | Ordinary review B (4ac27502..43180c29) | Claude Sonnet 5.5 | `43180c29` | APPROVE | `1c3285b5fc7dbd2b1588997de21a65a4ba2a81cb0174feef4221921d89f3fd72` |
| 4 | `749-security-opus.md` | Security review (4ac27502..43180c29) | Claude Opus 5.5 | `43180c29` | CLEAR | `2828a6a578c38c061e69b3efffd4466f3c4d279296bae6e35bde02e2faa0dc4a` |
| 5 | `749-759f-security-rebind-opus.md` | Security rebind (43180c29 + 876fa7ea -> 759fedc4) | Claude Opus 5.5 | `759fedc4` | CLEAR | `b72e7c8636ad4116aaae0a499872daec7017aee34a553db3d539444e573d8f0d` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/748-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 8c4b12bbe7bf1ab08e4ef91228115b8544fb55d25c6eec08bc1d86b97ab2a968) -->
# #748 / PR #749 ordinary review A

**Reviewed head:** ce5105a76b668b81673470a51dd78a5ae6864875
**Delta base:** 4ac27502 (PR #747 head); reviewed delta 4ac27502..ce5105a7 (13 files, +914/-219)
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**PR:** ThomasHeinThura/ticketing#749 (branch codex/legacy-socket-parity)

## Method
Scratch worktree at the exact head (removed afterwards). Private postgres:16 container (removed by exact ID
a67ca98d3125...). Main checkout and other worktrees untouched.

## Commands and counts (all on ce5105a7)
| Command | Result |
| --- | --- |
| vitest integration: ws-project-reach.test.ts + node-server-websocket.test.ts | 2 files, 43 tests pass (17 + 26) |
| vitest unit, apps/api (all) | 118 files / 850 tests pass (one earlier run under load showed 18 files / 1 test failing; a clean rerun was 118/850 green; I could not reproduce, treated as load flake, see N6) |
| vitest unit tests/api/ws | 10 files / 63 tests pass |
| pnpm test:permissions (--force) | 16 files / 104 tests pass |
| pnpm check:route-policy | pass (turbo cached 4 of 5) |
| pnpm lint:ci | 0 errors, 212 warnings, 1 info (pre-existing class) |
| pnpm typecheck (--force) | 9/9 pass, 0 cached |

## Mutation testing (applied to committed code, run, reverted by git checkout)
| # | Mutation | Result |
| --- | --- | --- |
| M1 | drop `decision.capable` in authorizeProjectSocketRead | caught, 5 failures |
| M2 | drop key `work_item:read` requirement | caught (in-scope key test) |
| M3 | limit `>=` to `>` | caught (2 unit tests) |
| M4 | `fresh` ignored by reuse | caught (2 unit tests) |
| M5 | remove archivedAt filter | caught (archived test) |
| M6 | reuse never expires | caught (2 unit tests) |
| M7 | remove deletedAt filter | caught (soft-delete test) |
| M8 | pass `organisationId: null` to evaluateProjectRead inside authorizeProjectSocketRead | SURVIVED (17/17 pass), see N1 |
| M9 | slot never released on removal | caught (release-once test) |
| M10 | impersonation credential built as "session" | SURVIVED (17/17 pass), see N2 |

10 mutations, 8 caught, 2 survived (both non-blocking, below).

## Behaviour changes assessed
1. **Instance admin with no workspace role refused on legacy socket.** Right. rbac.md (Instance scope, ~l.443-446) says
   `instance_admin` global reach is not an implicit grant of workspace capabilities or `project:read`. Native already
   refused; parity is correct and #747's allowance was the inconsistency. Not blocking. FYI for the owner: an instance admin
   who watched a foreign workspace's project live loses that; HTTP reads need the capability too, so this is consistent.
2. **Neither socket admits customers.** Matches the specs: rbac.md customer role holds `work_item:read` but no `project:read`
   ("and nothing else, ever"), is portal-only; customer-portal.md CP-19 denies every websocket upgrade on the portal host;
   realtime.md table says "unavailable in P0; portal edge is denied". The web app uses the legacy project socket only from
   agent-side hooks (use-project-websocket.ts, project-layout), never the portal. Legacy rechecks also require
   `portal === "agent"`. Correct, no owner decision needed. Native `customerVisible: true` on the project topic is now
   unreachable for customers (cosmetic).
3. **Key with null stored scope refused.** Right: matches `apiKeyScopeSatisfies` ("a present key without a complete valid
   scope has no grants") and HTTP behaviour. Not blocking. Worth a release-note line: previously any key opened the legacy
   socket.
4. **Unannounced DB changes noticed within 1.5 s.** Acceptable and documented. Announced changes (identity.invalidate) and the
   60 s floor use `fresh: true`; denials are never cached; user sockets keep reuseMs 0. Authority is not extended beyond the
   window after revocation (M4/M6 proved the tests bind this). Owner should accept the 1.5 s figure knowingly (security-relevant
   trade, previously "next event").
5. **Native socket now accepts a correctly scoped key.** Right and fail-closed: stored scope is intersected with RBAC via
   `apiKeyCapabilitySubset`, plus `work_item:read`. Side effect the implementer did not list: the native `work_item:{key}`
   topic also uses `resolveSocketIdentity` now, so a correctly scoped key is accepted there too (previously always refused).
   Equivalent to HTTP; fine, but worth saying in the PR body.
Equivalence check: `validateWorkspaceAccess` (removed from native) vs `reachableWorkspacePredicate` (now used in the project lookup)
check the same facts (instance admin or membership; key enabled and owned by caller). No loss.

## Connection limit
Per-person counter is a module-level Map in the API process, incremented in addConnection and decremented exactly once on
an actual Set deletion (so the reject-then-onClose double removal cannot underflow; M9 proves it). Counted across projects and
credentials. Check-and-add is synchronous, so no race inside a process.
**Multi-instance:** the count is per API replica, exactly like the native socket's Set. With N replicas a person can hold up
to 5N sockets. Same as native, so parity holds, but docs say "at most five" without "per replica" (N3).

## resolveCallerIdentity (implementer note 5), probed
Confirmed an HTTP bug, pre-existing at the #747 base (not in this delta). In a throwaway integration test (deleted) a
workspace owner with a session and the same owner with an API key scoped `{project:[read], work_item:[read], workspace:[read]}`
requested: `GET /api/project/{id}` session 200, **key 403**; `GET /api/project/{id}/health` session 200, **key 403**.
Cause: `utils/has-project-reach.ts` `resolveCallerIdentity` passes no `apiKey.capabilities`, so `can()` sees empty key
capabilities; routes with `requireProjectReach` and no `deferApiKeyCapability` then return 403 for every key. The fix is the
same capability mapping `resolveSocketIdentity` now has. Recommend a separate issue (N4); this PR does not change it.

## Findings
Blocking: none.

Non-blocking:
- **N1** Test gap: the customer-organisation test calls `findSocketProject` and `reaches()` directly, never through
  `authorizeProjectSocketRead`, and no customer can ever be `capable`, so passing the wrong organisation to `evaluateProjectRead`
  (M8) is unobservable. The org source is correct in code; add a unit that spies the facts or accept it as dead-but-correct.
- **N2** Test gap: nothing asserts the `impersonated` to "impersonation" credential path (M10 survived). Add a test or drop the
  field if no behaviour depends on it.
- **N3** Docs: realtime.md should say the five-socket cap is per API replica (same as native). It also says the recheck costs
  "about seven queries"; the implementer measured 11.
- **N4** Separate issue: `resolveCallerIdentity` key capability bug above (availability, fail-closed, so not a security hole).
- **N5** Client side effect: `use-project-websocket.ts` resets `retriesRef` in `onopen`, and the server accepts then closes the
  6th socket with 1008, so a person with more than five project tabs makes each excess tab reconnect every ~1 s indefinitely,
  each costing an upgrade and a lookup. Native has the same shape. Suggest the hook stop or back off on close code 1008. Owner
  awareness item, not a merge blocker.
- **N6** Native `work_item:{key}` topic still takes its organisation from the workspace row, unlike the project topic (now the
  project row). Customers cannot pass the capability check today so no impact, but the "one rule" claim covers only project
  topics. One earlier unit-suite run showed transient failures (not reproduced); likely load.
- **N7** Reuse deadline uses `Date.now()` (wall clock); a backward clock step stretches the window until the next 60 s fresh
  check. Prefer a monotonic clock. Trivial.

## Owner decisions needed
None blocking. Informational: accept the 1.5 s window (item 4); confirm instance-admin refusal is intended product behaviour
(item 1, matches rbac.md); release-note the null-scope-key refusal (item 3).

## Not checked
Multi-replica behaviour was reasoned from code, not run. Full integration suite not run (only the two ws files). Web client
tests not run. Docker/image deploy not exercised (no packaging change in the delta).

**Verdict: APPROVE (ordinary review A) at ce5105a76b668b81673470a51dd78a5ae6864875, no blocking findings; 7 non-blocking notes. Security-scope GPT-6 Sol review still required per policy.**
<!-- END REPORT (sha256 8c4b12bbe7bf1ab08e4ef91228115b8544fb55d25c6eec08bc1d86b97ab2a968) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/749-4318-ordinary-delta-a-sonnet.md; Claude Sonnet 5.5; sha256 f513ddc8ab3f05cf4829c149eccac91a480448843683858f92cd8d9c98906603) -->
# PR #749 round 2 ordinary delta review A

**Reviewed head:** 43180c29ca47e386a7057b4ec168284e2f91e8f1
**Delta base:** ce5105a76b668b81673470a51dd78a5ae6864875 (my round-1 approval); delta ce5105a7..43180c29, 5 files
**Model / context:** Claude Sonnet 5.5, same reviewer as round 1 (A), scratch worktree at the exact head (removed afterwards). Remote branch head confirmed as 43180c29 via ls-remote.

## Delta
- apps/web hook: terminal on close 1008 + reason "connection limit"; other closes keep 1s..16s backoff, max 5.
- docs: "per API replica (N replicas allow 5N)", "eleven queries".
- tests/api/ws/project-read-authorization.test.ts (5 tests).
- legacy-connection-authorization.ts: reuse window on performance.now().

## Verification
| Check | Result |
| --- | --- |
| Surviving mutant M8 (organisationId: null) | now caught (decision-inputs test) |
| Surviving mutant M10 (impersonation as session) | now caught (credential-kinds test) |
| New mutant: hook ignores close reason | caught ("retries a 1008 that is not the connection limit") |
| New mutant: hook ignores close code | caught ("same reason under another code") |
| New mutant: key capabilities hard-coded to project:read+work_item:read | survives the new unit file only because its fixture key has exactly those perms; the round-1 integration key-scope tests still catch it (M-key-caps was caught there) |
| web vitest use-project-websocket.test.ts | 1 file, 11 tests pass |
| api unit, tests/api/ws | 11 files, 68 tests pass |
| api unit, whole suite | 119 files / 855 tests pass |
| pnpm lint:ci | 0 errors, 212 warnings, 1 info (unchanged) |
| pnpm typecheck --force | 9/9, 0 cached |
Environment note: in a fresh worktree the api unit suite fails to load node-server-safe-logging until workspace packages are built
(`pnpm --filter "@taskdesk/api^..." build`); after the build it is green. This explains the transient failure I saw in round 1; it was not a product defect.

## Hook logic review
- Flow for a sixth tab: upgrade accepted, onopen sets retries to 0, server closes 1008 "connection limit", onclose calls
  reconnectDelay, which returns null, so the hook sets retriesRef to MAX_RETRIES and does not schedule. Reset-on-open can no longer
  loop because the terminal path runs after it and no timer is set. Correct.
- Other 1008 closes (for example "authorization unavailable" after lost access) keep the backoff; a revoked user that is refused at
  upgrade never fires onopen, so the count rises and stops after 5. Correct.
- Effect cleanup sets MAX_RETRIES and clears the timer; a remount or project/session change resets to 0, so a stopped tab recovers
  on navigation or reload. Acceptable.
- The close reason must survive the proxy; it is a standard close-frame field, and the match is exact on both code and reason.
- Clock: performance.now() is monotonic and used consistently for the set and the compare (both sites changed).

## Findings
Blocking: none.
Non-blocking:
- N1 The web tests cover the pure `reconnectDelay` only; the `onclose`/`onopen` wiring that sets `retriesRef` is verified by reading, not
  by a test. Optional hook-level test with a fake WebSocket.
- N2 A tab stopped by the limit stays without live updates until reload even if other tabs close (page still works). Accepted behaviour
  per the code comment; mention in release notes.

Round-1 notes N1, N2, N3 (docs), N5 (client loop) and N7 (clock) are resolved. N4 (resolveCallerIdentity HTTP key 403, pre-existing) and N6 (native
work_item topic org source) remain open as separate items.

**Verdict: APPROVE at 43180c29ca47e386a7057b4ec168284e2f91e8f1, no blocking findings. Security-scope GPT-6 Sol review still required per policy.**
<!-- END REPORT (sha256 f513ddc8ab3f05cf4829c149eccac91a480448843683858f92cd8d9c98906603) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/749-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 1c3285b5fc7dbd2b1588997de21a65a4ba2a81cb0174feef4221921d89f3fd72) -->
# PR #749 ordinary review B (design, docs, web, whole system)

**Reviewed head:** 43180c29ca47e386a7057b4ec168284e2f91e8f1
**Comparison base:** 4ac27502 (PR #747 head); delta = 16 files, +1106/-225
**Model / context:** Claude Sonnet 5.5, fresh independent context; did not author, direct or remediate. Reviewer A's report not read. Implementer notes (748-impl-sonnet.md) read as context only.
**Worktree:** scratch detached worktree at the exact head (removed after). Integration DB: Testcontainers postgres:18-alpine via `CI=true` (harness-owned, stopped by harness; no containers of mine remain; the other postgres containers on the host are not mine and untouched).

## Verdict

**APPROVE with non-blocking findings.** No blocking defect found. One unexplained single-test flake in the full integration run (see N1) that did not reproduce in 3 reruns; recommend the orchestrator watch CI for it.

## Commands and counts

| Command | Result |
| --- | --- |
| `CI=true pnpm test:integration` (apps/api, serialized, full) | 200 files / 2858 tests: **199 files / 2857 passed, 1 failed** (flake, N1) |
| `CI=true vitest run ws-project-reach + node-server-websocket` x3 | 2 files / 43 tests passed, three times in a row |
| `pnpm test:unit` (apps/api) | 119 files / 855 tests pass (first attempt had 18 files failing while `pnpm install` and the integration run were starting concurrently; clean rerun passed, I attribute it to load, not the code) |
| `pnpm test:permissions` | 16 files / 104 tests pass |
| web `vitest run` | 186 files / 1023 tests pass |
| `pnpm lint:ci` | exit 0 (212 warnings, 1 info, pre-existing class; 0 errors) |
| `pnpm typecheck --force` (uncached) | 9/9 tasks successful |
| Scratch hook-wiring test (not committed, deleted with the worktree) | 2/2 pass, see Web |

## 1. Shared rule

Read `ws/project-read-authorization.ts` and both call sites. The legacy wrapper `callerReachesLegacySocketProject` and the native `project:` topic both call `authorizeProjectSocketRead`, so the decision is one function. Order is right: identity resolved before the project lookup (no existence oracle by cost), single `null` refusal, org from the project row.

Behaviour changes, each checked against docs:

- Instance admin without a workspace role is refused. This matches `rbac.md` ("reach is not an implicit grant of `project:read`", line ~443) and the new rbac paragraph. It reverses what #747 allowed on legacy; it is documented in rbac.md, realtime.md and the test-table row. Acceptable and documented. Note it is a user-visible change for instance admins who view projects over HTTP; they get no live updates unless they hold a workspace role. Not a security defect.
- Customers refused: built-in customer role holds no `project:read`; legacy recheck also requires `session.portal === "agent"`. CP-19 (portal origin websocket upgrades return the generic 404 before auth) is untouched and consistent; this PR only affects the agent host. No conflict.
- Key with no stored scope refused: `apiKeyCapabilitySubset` returns `[]` for null permissions, the same fail-closed rule the HTTP layer uses. The old native check (`credential.apiKeyPermissions && !...`) let a null-scope key through, so this is a tightening on native, and a fix for scoped keys which previously had an empty capability list on native (every key refused). Documented ("key's stored scope"). Wording does not literally say "null scope is refused" but follows from "the key must hold".
- Correctly scoped key accepted on native: yes, covered by the integration test (native asked the same question).
- Archived and soft-deleted excluded on both sockets (legacy was missing the archived filter in #747): documented.

Docs vs code: realtime.md and rbac.md match the code (cap, 1.5 s window, "about eleven queries", 1008 on later recheck, 401 pre-upgrade). Test table row matches the tests I saw.

## 2. Web

`reconnectDelay(close, retries)`: `1008` + exact reason `"connection limit"` returns `null`; anything else keeps 1s/2s/4s/8s/16s and gives up at 5. The terminal branch also pins `retriesRef` to MAX_RETRIES. Unit tests cover the exponential schedule, budget exhaustion, 1008 with another reason (still retried), and the same reason under another code (still retried).

The existing tests only cover the pure function, so I wrote a throwaway renderHook test with a fake WebSocket against the real hook (not committed): after open then `1008 "connection limit"`, 120 s of fake time produced no second socket; after a `1006` close a reconnect fired at exactly 1000 ms, and a following `1008 "authorization unavailable"` close reconnected at 2000 ms. The wiring is correct. I did not drive Chromium against a real socket; the above plus the unit tests is the evidence.

Findings:
- N2 (non-blocking, UX): there is no UI state telling the user live updates stopped. `realtime.md` (~line 293) specifies a "live updates unavailable" indicator for the native client, but the legacy hook has none, so a sixth-tab user silently sees a stale board. The implementer's note says the same. Suggest a follow-up issue rather than expanding this PR.
- N3 (non-blocking, edge): navigation inside one tab between board and task routes unmounts one `useProjectWebSocket` and mounts another. The old socket's slot is released when the server processes its close; a fast navigation in a tab that already sits at 5 sockets could see the new socket refused as "connection limit" and, being terminal, stay dead until the next remount or session change. The page and layouts are separate routes (I saw no site mounting two hooks at once), so this needs five live tabs plus fast navigation. Low likelihood; worth knowing.

## 3. Multi-replica

The limit is a per-process `Map` and the native limit is likewise per process, so N replicas allow up to 5N legacy sockets per person. The PR documents this in realtime.md ("per API replica ... 5N"). That is acceptable for the stated deployment model (`deployment.md` Scaling: replicas behind Traefik, Valkey pub/sub for broadcast; no shared counter exists for the native socket either). The limit is a resource guard, not a security boundary.
- N4 (non-blocking, docs): `docs/05-operations/scaling.md` line 125 and `realtime.md` line 257 still say "five sockets per person" with no per-replica qualifier or the legacy/native split (the cap applies per kind: up to 5 legacy + 5 native). Suggest aligning.
- The 1.5 s reuse window and cap logic look right: `fresh: true` on the 60 s floor and on identity invalidations; `performance.now()` monotonic; checks serialized; denial never cached; slot released only when `Set.delete` actually removed the connection (no double release); refused sockets are never registered.

## Findings summary

| # | Class | Item |
| --- | --- | --- |
| N1 | non-blocking, needs watching | Full serialized integration run: `ws-project-reach.test.ts > an archived project is refused ... (#748)` failed once with `Unexpected server response: 404` (thrown by the `open()` helper, so a 404 on an upgrade that should succeed, most likely the origin-policy host-denial 404). The file plus `node-server-websocket` passed 3/3 in isolation (43 tests each). The implementer's own full run was clean. I could not find the cause; my web vitest/typecheck ran for a while concurrently with the suite on the same host. Treat as a possible load-related flake, but the author should confirm CI is green and not just rerun until it is. |
| N2 | non-blocking | No UI state when live updates stop after a connection-limit close |
| N3 | non-blocking | Fast in-tab navigation at 5 sockets can cause a terminal limit close |
| N4 | non-blocking | scaling.md / realtime.md line 257 limit wording lacks per-replica and per-kind qualifier |
| N5 | non-blocking, cosmetic | The new per-replica sentence in realtime.md is one overlong unwrapped line |
| N6 | note | `resolveCallerIdentity` still builds key identities with no capabilities (implementer flagged, not touched); sockets no longer use it. Separate issue. |

## Not checked

- Real-browser (Chromium) run against a live socket.
- Reviewer A's findings.
- Whether the 404 flake appears in GitHub CI.
<!-- END REPORT (sha256 1c3285b5fc7dbd2b1588997de21a65a4ba2a81cb0174feef4221921d89f3fd72) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/749-security-opus.md; Claude Opus 5.5; sha256 2828a6a578c38c061e69b3efffd4466f3c4d279296bae6e35bde02e2faa0dc4a) -->
# PR #749 security review: legacy and native project sockets share one read-authorization rule (#748)

**Reviewed head:** 43180c29ca47e386a7057b4ec168284e2f91e8f1
**Delta base:** 4ac27502 (PR #747 head, already security-CLEAR in `docs/07-planning/security-reviews/747-realtime-project-reach.md`). Delta = 2 commits (ce5105a7, 43180c29), 16 files, +1106/-225.
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context. I did not author, direct or remediate this change. I read the ordinary reviewer B report and the implementer notes only for the flake description and as context. I re-verified every claim I rely on against the source.
**Date:** 2026-10-15

## Head and base verification

- `gh pr view 749 --json headRefOid` returned `43180c29ca47e386a7057b4ec168284e2f91e8f1`, which matches the fetched `refs/pull/749/head`.
- `git merge-base --is-ancestor 4ac27502 43180c29` succeeded. The #747 commits are therefore unchanged ancestors of the candidate.
- The delta does not touch the #747 security-review record.
- The delta intentionally rewrites `legacy-project-reach.ts`, which #747 introduced, so that it delegates to the shared rule.
- **Note for the orchestrator:** GitHub reports the PR as `mergeable: CONFLICTING` against `main`. Any rebase or merge-resolution commit changes the head, and the new head needs exact-head review again.

## Surfaces examined

- `apps/api/src/ws/project-read-authorization.ts` (new; the shared rule)
- `apps/api/src/ws/legacy-project-reach.ts`
- `apps/api/src/ws/legacy-connection-authorization.ts` (the reuse window)
- `apps/api/src/ws/index.ts` (`addConnectionWithinLimit`, slot accounting, fresh rechecks)
- `apps/api/src/ws/limits.ts`
- `apps/api/src/ws/native-work-item-realtime.ts`, both topics
- `apps/api/src/index.ts`: the legacy and native upgrade handlers, `authGuard` and `hostRoutingGuard`
- Supporting code, read for parity:
  - `apps/api/src/utils/require-api-key-permission-scope.ts` (`apiKeyCapabilitySubset`, `apiKeyScopeSatisfies`)
  - `apps/api/src/permissions/resolve-identity.ts` (key clamping, `keyCapabilities`)
  - `packages/permissions/src/evaluator.ts` (`reaches`, the key clamp in `can`)
  - `packages/permissions/src/roles.ts` (customer capabilities)
  - `packages/permissions/src/capabilities.ts` (implications)
  - `reachableWorkspacePredicate` against `validateWorkspaceAccess`
  - `apps/api/src/work-item/native-event.ts` (hint payload)
  - REST project and work-item reach middleware (`projectReadDecision`, `deferApiKeyCapability`)
  - `@hono/node-server` 2.1.3 upgrade path
- `apps/web/src/hooks/use-project-websocket.ts`
- Docs: the `realtime.md` delta
- Tests: `tests/api-integration/ws-project-reach.test.ts`, `tests/api/ws/*`, and the web hook test

## Commands and results

All runs used a scratch detached worktree at the exact head, plus a second scratch worktree at the same head for mutations, so the full run was never exposed to mutated source. Both worktrees were removed afterwards.

The database was a private container I created, `postgres:18-alpine`, id `e753d9506da8c2f402830518d19cf7689bcf733b1902e0d9118e530575540012`, with databases `rev749_test` and `rev749m_test`. I removed it by that exact id afterwards. No other container was touched. The main checkout was not modified; its `git status` is identical before and after.

| Command | Result |
| --- | --- |
| `vitest --config vitest.integration.config.ts ws-project-reach node-server-websocket` | 2 files / 43 tests passed |
| The same `ws-project-reach` file ×6, with 8 `yes` CPU burners running | 17/17 passed each time; no 404 |
| Full `vitest --config vitest.integration.config.ts` (serialized). Ran concurrently with the mutation runs, so the host was loaded | **200 files / 2858 tests passed**, exit 0 |
| `vitest --config vitest.config.ts tests/api/ws` (ws unit files) | 11 files / 72 tests passed |
| `vitest --config vitest.permissions.config.ts` (`test:permissions`) | 16 files / 104 tests passed |
| web `vitest run src/hooks/use-project-websocket.test.ts` | 1 file / 11 tests passed |
| `gitleaks git --log-opts=4ac27502..43180c29` (8.30.1) | 2 commits scanned, no leaks |
| `gitleaks dir apps/api/src/ws` and `gitleaks dir tests/api-integration/ws-project-reach.test.ts` | 0 findings |

### Mutations (my own; each applied alone and reverted)

| # | Mutation | Killed by |
| --- | --- | --- |
| M1 | Drop `isNull(archivedAt)` from `findSocketProject` | 3 integration tests, including the #748 archived test and the native archived tests |
| M2 | Drop the key `work_item:read` stored-scope requirement | Integration test "in-scope key is clamped to its stored scope" |
| M3 | Let `fresh` checks reuse the window | 2 unit tests ("fresh check always looks again", "60-second floor") and 2 integration tests ("announced one closes at once", "stops legacy events after membership removal") |
| M4 | Release a slot on every `removeConnection`, even when nothing was removed (double release) | Unit test "releases a slot exactly once" |
| M5 | Remove the per-person limit | Unit test (limit) and integration test "at most five legacy sockets per person" |
| M6 | Reach-only, dropping `decision.capable` | 6 integration tests: instance admin, key clamp, role lacking `project:read`, customer, unannounced revocation, native capability |
| M7 | Hoist `reusableUntil` to module scope, so the window is shared across connections, users and projects | 3 unit tests and 2 integration tests |
| M8 | Never release a slot (the permanent-lockout leak) | Unit test "releases exactly once" and integration test "at most five" |

All 8 mutations were killed.

Two gaps, both non-blocking:

- The unit file `project-read-authorization.test.ts` alone did not kill M1, M2 or M6. The integration suite did.
- M4 (double release) is caught only by the unit test.

## Security questions

### 1. Native now accepts scoped keys

**Safe.** Native previously built key identities with no `capabilities`, so `keyCapabilities` was `[]` and every key was refused. The old stored-scope test (`apiKeyPermissions && !work_item.read`) would have let a null-scope key through, if the capability step had not already refused it.

Now `resolveSocketIdentity` passes `apiKeyCapabilitySubset(stored scope)`. That function:

- keeps only exact registered `resource:action` pairs;
- returns `[]` for a null or malformed scope.

`can()` then applies owner RBAC ∩ key subset (`evaluator.ts` around line 303). On top of that, the shared rule requires a literal stored `work_item:read`.

The REST equivalents follow the same model:

- The key is owner RBAC narrowed by stored scope, through `apiKeyScopeSatisfies` or the deferred key-capability layer.
- Workspace reach is identical: `reachableWorkspacePredicate` checks the same three facts as `validateWorkspaceAccess`. Those are instance admin or membership, the key belongs to the caller, and the key is enabled.

**`work_item:` topic.** It uses `evaluateProjectRead(..., "work_item:read", "work_item", ...)` over the item's project. Every REST read path also passes `ancestorProjectIds: []` and `ownerTeamId: null`, so per-item reach is the same. There is no separate `comment:read` capability; staff with `work_item:read` read internal comments over REST.

The native hint payload is `{type: kind, topic, eventId, at, payload: {key}}` only, with no comment body and no field values. A key therefore learns nothing over the socket that it could not read over REST with `work_item:read`. Customer-portal connections additionally drop non-`customerVisible` hints.

**Implied capabilities (non-blocking).** Capability implication applies. A key scoped `{project:["update"], work_item:["read"]}` gets `project:read` on the socket, through `project:update ⟹ project:read`. That matches the canonical model in `rbac.md`. However, `realtime.md` says "the key must hold `project:read`", which is literally narrower than the code (finding N2).

### 2. The 1.5 s reuse window

Authority cannot cross users, keys or projects:

- `reusableUntil` is a closure variable of `createLegacyConnectionAuthorization`, one per `ProjectConnection`.
- Each connection is bound to a single `projectId`, `userId` and request context `c`, and therefore a single credential.
- M7 shows the tests catch any hoisting of the window.

Behaviour of the window:

- A refused or failed lookup is never cached; it disposes the connection.
- `fresh` (announced `identity.invalidate` and the 60 s floor) always looks again (M3).
- Checks are serialized, so a fresh check cannot be overtaken by an older lookup.
- `performance.now()` is monotonic.

**How long authority can outlive an unannounced revocation.** The window starts when a passing lookup completes, not when it starts. A lookup that read the database just before an unannounced revocation committed can therefore extend authority to (lookup latency + 1.5 s), plus queue wait. That is slightly longer than the documented "1.5 seconds", by the duration of one lookup of roughly 11 queries (finding N1).

Announced changes are unaffected. Within that bound, deliveries are delayed-detected, never permanently granted. For comparison, the native socket's pre-existing unannounced bound is the 60 s floor, so the legacy socket remains much tighter.

### 3. Connection limit

**No cross-person exhaustion:**

- Slots are keyed by the authenticated `userId`, and are counted only after the upgrade passed `authorizeProjectSocketRead`.
- A refused upgrade never reaches `onOpen`.
- An API key consumes its owner's slots. Only a holder of that owner's key (already a compromise) or an instance admin impersonating the user can consume them.

**No leak:**

- A slot is added only by `addConnection`. It is released only when `Set.delete(conn)` actually removed the connection. That makes the double removal (authorization reject followed by `onClose`) idempotent (M4, M8).
- A socket refused at the limit is never registered, and `onClose` is a no-op because `conn` stays null.
- The counter is per process, so a restart clears it. There is no persistent lockout path.

**Ceiling.** The limit is per replica and per kind: up to 5 legacy plus 5 native sockets per person per replica. This is documented and is a resource guard, not a security boundary.

**Web client.** It stops retrying only on the exact pair 1008 / "connection limit". Any other 1008 reason keeps the backoff. That prevents a reconnect storm.

### 4. Customer organisation source on native

**Cannot widen.** `organisationId` is read only in `reaches()` step 6, for `reach.kind === "organisation"`, meaning customers.

Customers cannot pass either way, for three reasons:

- The built-in customer role (`CUSTOMER_CAPABILITIES`) has no `project:read`, so the `project:` topic refuses customers whichever organisation is used (CP-19, M6).
- The legacy upgrade additionally requires `session.portal === "agent"` on recheck.
- Portal-host upgrades are denied before auth by `hostRoutingGuard`.

For staff, organisation is irrelevant. The change is also more correct: `rbac.md` names the project's customer, while the workspace row names the operating organisation.

**Pre-existing, outside the delta:** the native `work_item:` topic still reads `workspace.organisationId` (finding N3). That reading is narrower for customers, not wider.

### 5. The flaky archived test

**Not reproduced:**

- 6 loaded isolated runs passed.
- 1 loaded full serialized run passed, 200 files / 2858 tests.
- Reviewer B's 3 reruns passed.

**Root cause: not fully established.** I did establish that the 404 cannot come from the #748 authorization logic:

- Every refusal on the legacy path is `HTTPException(401)` from the reach middleware, or `ws.close(1008)` on recheck.
- `authorizeProjectSocketRead` never throws an HTTP status.
- `rejectNulByte` gives 400.
- An authorization race or a stale reuse window would therefore produce a 401 or a 1008 close, never a 404.

The only 404 producers on this upgrade path are:

- `hostRoutingGuard` → `denyByHost`, which applies when the Host does not select the agent origin. That is decided by `TASKDESK_AGENT_URL` captured at `createApp`, which `setup.ts` fixes at `http://localhost:1337`.
- Hono `notFound`. This fires only if `upgradeWebSocket` returns nothing, which requires a missing or non-`websocket` `Upgrade` header.

Both are independent of the database state the test changes. The failing call was `open1`, the first upgrade in the test, which happens before the archive write. That timing further excludes the archived-project code.

**Conclusion:** this is a harness or environment flake in host selection or upgrade handling, not a race in the reviewed code. It is non-blocking, but CI should be watched (finding N4).

### 6. Behaviour changes

All four behaviour changes are tightenings or parity fixes, and I confirmed each against the code:

- An instance admin without a workspace role is refused. `instance_admin` holds only `instance:*`.
- Customers are refused, because they have no `project:read`.
- A null-scope key is refused, because `apiKeyCapabilitySubset` returns `[]`.
- A scoped key is accepted on native, as owner RBAC ∩ scope.

## Findings

| # | Class | Finding |
| --- | --- | --- |
| N1 | non-blocking | The reuse window is measured from lookup completion. Worst-case unannounced staleness is lookup latency + 1.5 s (+ queue), not strictly 1.5 s. Suggest stamping `reusableUntil` from the time before `authorize()`, or wording the docs as "about 1.5 s after the last passing lookup". |
| N2 | non-blocking, docs | `realtime.md` says a key "must hold `project:read`". The code accepts any stored capability that implies it, such as `project:update` or `project:manage_members`, together with literal `work_item:read`. This is consistent with the canonical model, but the docs should say so. |
| N3 | non-blocking, pre-existing, outside delta | The native `work_item:` topic still sources the customer organisation from the workspace row. That is narrower, not wider, than the project-row rule. Align it in a follow-up. |
| N4 | non-blocking, watch | The archived-test 404 flake is not reproduced and is shown to be outside the authorization code: 404 is unreachable from the #748 decision path. Watch CI. If it recurs, capture the `http.request` log line (`route`, `statusClass`) for the failed upgrade. |
| N5 | non-blocking, note | REST `resolveCallerIdentity` still builds key identities with no capabilities. That is reviewer B's N6. As a result, REST routes that do not set `deferApiKeyCapability` (for example `GET /project/{id}`) refuse keys outright, and REST is narrower than the socket for keys. The socket follows the documented rule, and the socket hint (`{kind, key}`) reveals nothing beyond what `work_item:read` REST routes expose. This is not an exposure; it is a REST over-narrowing to track separately. |
| N6 | non-blocking, test depth | The unit file `project-read-authorization.test.ts` does not by itself kill the archived, key-scope or capability mutations. The integration suite does. |

No blocking findings.

## Residual risk / not checked

- Multi-replica behaviour was not exercised. The limit is per process, and invalidation fan-out relies on the Redis control channel; I ran in-memory adapter tests only.
- Native unannounced-revocation latency remains the pre-existing 60 s floor. That is outside the delta.
- No real-browser (Chromium) run of the web hook. I read the code and ran the unit test only.
- `pnpm lint:ci` and `typecheck` were not re-run by me. Reviewer B reports both green.
- GitHub CI status was not inspected beyond `mergeable: CONFLICTING`. Any conflict resolution produces a new head that needs exact-head re-review.

**Verdict:** CLEAR
<!-- END REPORT (sha256 2828a6a578c38c061e69b3efffd4466f3c4d279296bae6e35bde02e2faa0dc4a) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/749-759f-security-rebind-opus.md; Claude Opus 5.5; sha256 b72e7c8636ad4116aaae0a499872daec7017aee34a553db3d539444e573d8f0d) -->
# #749 security rebind — legacy socket parity onto #747 head

**Reviewed head:** 759fedc4d979be24c2da842dab7bbd6ff6ca68dc
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context

- PR: #749 (`codex/legacy-socket-parity`), base `main`
- Prior security-CLEAR head: 43180c29ca47e386a7057b4ec168284e2f91e8f1 (`749-security-opus.md`)
- Merged-in side: #747 head 876fa7ea2e81231c6dd7fca1cd7f39dcf9f28b8a (security-CLEAR; carries main d7ab1a71 = #742)
- Merge base of the two parents: 4ac275021c4f564ab0da23ad98caf7b403935c04
- Review type: mechanical rebind (merge commit), read-only, scratch detached worktree (removed afterwards)

## 1. Head identity
- `git ls-remote origin refs/heads/codex/legacy-socket-parity` = 759fedc4d979be24c2da842dab7bbd6ff6ca68dc
- `gh pr view 749 --json headRefOid` = 759fedc4d979be24c2da842dab7bbd6ff6ca68dc; mergeable MERGEABLE
- origin `main` = d7ab1a7153a47f143b7d40d7e376bd59e1949ac3

## 2. Parents and ancestry
- `git rev-list --parents -n1 759fedc4` -> parents 43180c29 and 876fa7ea, exactly.
- `git merge-base --is-ancestor d7ab1a71 759fedc4` -> true (main is an ancestor).

## 3. Merge-tree equality
- `git merge-tree --write-tree 43180c29 876fa7ea` -> ff96bf81fc845bf3b656b405554b0b4e1b46f83c, exit 0, no conflicts.
- `759fedc4^{tree}` = ff96bf81fc845bf3b656b405554b0b4e1b46f83c. Identical: the merge commit contains no hand resolution.

## 4. File set
- `git diff --name-only 43180c29 759fedc4` equals `git diff --name-only <merge-base> 876fa7ea` (36 files, 3059+/53-).
- The full patch `43180c29..759fedc4` is byte-identical to `<merge-base>..876fa7ea` for every path except `docs/01-architecture/rbac.md`.
- Only file touched by both sides: `docs/01-architecture/rbac.md`. #749 rewrote the "legacy project socket" paragraph (around line 571). #742/#747 inserted new paragraphs (lists/search reach, out-of-path write targets, saved-view and intake reads) after line 603. The hunks don't overlap. The merged text keeps #749's legacy-socket paragraph intact, and its diff against 43180c29 is only #742's insertion.
- The #747/#742 side touches no file under `apps/api/src/ws/`, and doesn't touch `apps/api/src/index.ts`, `apps/api/src/utils/has-project-reach.ts` or `apps/web/src/hooks/use-project-websocket*`. `tests/api-integration/helpers/project-reach-route-keys.ts` is changed only by the #742 side (it adds list/search route keys). `PROJECT_SOCKET_ROUTE_KEYS = ["GET /api/ws/{projectId}"]` is unchanged.

## 5. Semantic interactions
- `apps/api/src/ws/project-read-authorization.ts` (`authorizeProjectSocketRead`) depends on `evaluateProjectRead` (has-project-reach.ts), `resolveIdentity`, `apiKeyCapabilitySubset` and `reachableWorkspacePredicate` (workspace-access-middleware.ts). #742's change to `workspace-access-middleware.ts` only adds the saved-view scope reach (`savedViewScopeReach`, `assertSavedViewProjectReach`, scope/scopeId on the saved-view lookup, and the mark's `projectReach` OR-term). It doesn't modify `reachableWorkspacePredicate`. The other dependencies are unchanged.
- #742's `caller-reach.ts` changes add an optional `organisationId` on `ReachRow` (project's own organisation) and `reachableProjectIds()`. That's the same project-organisation rule (Reach step 6) that #749's socket rule already applies. The socket path doesn't import caller-reach. There's no divergence.
- The legacy route `GET /api/ws/:projectId` (index.ts ~1736) still mounts `requireLegacySocketProjectReach` before `upgradeWebSocket`, and that middleware still decides via `authorizeProjectSocketRead`. The shared rule still governs both sockets after the merge.
- The new `requireReachFilteredList` guard and the reach-mark `reachFilteredList` field apply to workspace-level collection routes. They don't apply to the delegated socket route, and the project-reach guard still passes over the merged route table.

## Commands run (worktree at 759fedc4)
- `pnpm install --frozen-lockfile` (with `--offline`, it failed because one tarball wasn't in the local store; re-run with `--prefer-offline` against the registry, lockfile frozen): OK
- `pnpm test:permissions`: 16 files, 107 tests passed (includes `project-reach-guard.test.ts`, `route-coverage.test.ts`, `work-item-reach-guard.test.ts`)
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p .`: exit 0
- `vitest run ../../tests/api/ws` (from apps/api): 11 files, 72 tests passed (includes `project-read-authorization.test.ts`, `legacy-connection-authorization.test.ts`, `connections.test.ts`)
- Integration tests: not run locally. GitHub's `integration - Postgres 18` check at this head is SUCCESS.

## Findings
- Blocking: none.
- Non-blocking: the GitHub check `pull request template + security review` is FAILURE at this head. Most likely it is only waiting for this head's security review to be recorded in the PR or review note, but I did not confirm the cause. It must be green, with this rebind bound at 759fedc4, before merge. All other required checks are SUCCESS.

## Residual risk
- Integration suites weren't re-run locally (CI ran them green). The merge is clean and tree-identical, and the two sides' code changes are disjoint, so the interaction surface is the one doc file plus the shared helpers checked above.
- No new behavioural review of #742/#747 content. That content is covered by their own security-CLEAR records.

**Verdict:** CLEAR
<!-- END REPORT (sha256 b72e7c8636ad4116aaae0a499872daec7017aee34a553db3d539444e573d8f0d) -->
