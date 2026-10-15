# PR #775 security review record: live updates unavailable indicator (#751)

PR #775 closes #751. After the legacy project socket stops for a reason the client did not cause (a 1008 connection-limit close, or exhausted retries), the screen shows the "live updates unavailable" indicator that `realtime.md` specifies. It clears on reopen, remount, or a project or session change. Docs now say five sockets per person per API replica and per socket kind. `apps/web/e2e/**` is security-scope.

A Claude Sonnet 5.5 lane implemented the change. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review B by Claude Sonnet 5.5: APPROVE at `e34657b0`.
- Ordinary review C by Claude Sonnet 5.5: APPROVE at `e34657b0` (5 mutations caught); mechanical APPROVE at `d68ec9e2`.
- Ordinary review D by Claude Sonnet 5.5: mechanical APPROVE at `d68ec9e2`.
- Security review by Claude Opus 5.5: CLEAR at `e34657b0` (fixed message only, backoff and attempt cap unchanged, no auth change); mechanical rebind CLEAR at `d68ec9e2` by a separate Opus context.

**Reviewed head:** `e34657b0fb65cc90034b3c0a4a6536ba1b84d710`
**Reviewed head:** `d68ec9e2b465f78ef0201fc581ef5dec660ef849`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `775-ordinary-b-sonnet.md` | Ordinary review B (main..e34657b0) | Claude Sonnet 5.5 | `e34657b0` | APPROVE | `9dc160b8d5a0e0c18c06f3d079c51df9cb549cdec659a5b632f51377cd9d3c79` |
| 2 | `775-ordinary-c-sonnet.md` | Ordinary review C (main..d68ec9e2) | Claude Sonnet 5.5 | `d68ec9e2` | APPROVE | `6fa1620e92e4a7482b63bce554aa0a0adb8ca022f82d77dfa145e5908ac516c3` |
| 3 | `775-ordinary-d-sonnet.md` | Mechanical check D (e34657b0..d68ec9e2) | Claude Sonnet 5.5 | `d68ec9e2` | APPROVE | `83256572fcb587de410e008c88aa38edc7d99b038ba31c87e06182b21b32c7f6` |
| 4 | `775-security-opus.md` | Security review and rebind (main..d68ec9e2) | Claude Opus 5.5 | `d68ec9e2` | CLEAR | `1e5b0dc525841aca3431ca0067d61a754a16d4daab871310bab5aa95a42f575a` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/775-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 9dc160b8d5a0e0c18c06f3d079c51df9cb549cdec659a5b632f51377cd9d3c79) -->
# Ordinary review B, PR #775 (#751: "live updates unavailable" indicator on legacy project pages): realtime contract, UX, a11y, docs

**Reviewed head:** e34657b0fb65cc90034b3c0a4a6536ba1b84d710
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** main c35666c531c4b84c300bac5432fd4dc8dca3ed4f (merge base)
**Method:** scratch detached worktree at the exact head (removed afterwards); read-only. Reviewer C's reports were not read.

## Commands and counts
- `gh pr view 775 --json headRefOid` = head above. 10 files: project-layout.tsx, task-layout.tsx, new realtime-unavailable-notice (+test), use-project-websocket.ts (+status test), e2e spec, pairs.json, realtime.md, scaling.md.
- `CI=true vitest run src/hooks/use-project-websocket src/components/common` (apps/web, targeted): 6 files, **27 tests passed**, 0 failed. `check-tokens` + `check-contrast` exit 0 (418 pairs); `check-policy` exit 0. Playwright not run.

## Contract: realtime.md Fallback
- The spec says that when the socket cannot connect the client polls every 30 s and shows a small "live updates unavailable" indicator. The change implements this for the legacy project socket, using a three-state hook status: `connecting` (pending, no indicator, so no flash on first load), `live` (open), `unavailable` (any close the client did not cause, until it opens again or the hook restarts for another project or session). Cleanup sets a `disposed` flag so unmount or project/session change is not reported as an outage.
- Terminal stops (the `1008` connection-limit close, which the client deliberately does not retry, and retries exhausted) leave the indicator showing; the realtime.md paragraph states this and says plainly that retry after a route change within the same project is not specified. Honest and consistent with the code.
- Polling claim: the user-facing text says the page refreshes every 30 seconds; the legacy `useGetTasks` query polls at 30 s unconditionally, so the sentence is true for those pages (native queries poll only when realtime is not available, which is a different mechanism).
- Wording/semantics difference worth noting (non-blocking): the indicator appears at the first unexpected close, including a brief reconnect after a deploy, not only after retries are exhausted. This matches "until the socket opens again" in the new spec text and is the simpler, more truthful reading, but it is more eager than "cannot connect".

## Consistency with the native screens
Same i18n key (`workItems:detail.realtimeUnavailable`: "Live updates are unavailable. This page refreshes every 30 seconds while open."), same `Alert variant="warning"`, same `role="status"` and same `data-testid="realtime-unavailable"` as the native board, panel and detail screens. A shared `RealtimeUnavailableNotice` component is used for the two legacy layouts (project and task) only; the native screens keep their inline copies (a later dedupe is optional).

## Accessibility
`Alert` with `role="status"` is a polite live region: announced when it appears, not intrusive, not focusable, no keyboard impact; the text is a complete sentence with no reliance on colour (warning variant plus words). It is rendered between the header and the content, so reading order is sensible. Contrast pairs for the new surface were added to pairs.json and `check-contrast` passes. No four-state requirement applies (not a screen).

## Documentation edits
- realtime.md Limits row and scaling.md now say the five-socket cap is per person per API replica and per socket kind. Verified in source: the legacy map `projectConnectionsPerPerson` (ws/index.ts) and the native connection list (native-work-item-realtime.ts) are separate in-process structures, both capped by `MAX_REALTIME_CONNECTIONS_PER_PERSON = 5`, so with N replicas up to 5N of each kind is correct. No other doc states "five sockets per person" unqualified (grep). The new Fallback paragraph is accurate against the hook.
- Style: one scaling.md line became long; cosmetic.

## Findings
**Blocking:** none.
**Non-blocking:** (1) eager indicator on transient reconnects (above); (2) native and legacy notices are separate implementations; (3) the retry-after-route-change gap is documented rather than closed, appropriately, but deserves an issue so it is not lost.

## Residual risk
Real-browser behaviour (the e2e spec for `1008`, healthy socket and no-indicator) not run by me; the hook's unit tests cover the state machine.

**Verdict:** APPROVE
<!-- END REPORT (sha256 9dc160b8d5a0e0c18c06f3d079c51df9cb549cdec659a5b632f51377cd9d3c79) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/775-ordinary-c-sonnet.md; Claude Sonnet 5.5; sha256 6fa1620e92e4a7482b63bce554aa0a0adb8ca022f82d77dfa145e5908ac516c3) -->
# PR #775 ordinary review C (#751: "live updates unavailable" indicator for the legacy project socket)

**Reviewed head:** e34657b0fb65cc90034b3c0a4a6536ba1b84d710
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed with `gh pr view 775`. 10 files: `use-project-websocket.ts` (+ new status test), new `realtime-unavailable-notice.tsx` (+ test), `project-layout.tsx`, `task-layout.tsx`, e2e spec, `realtime.md`, `scaling.md`, `pairs.json`. Targeted runs only. Scratch worktree, removed afterwards.

## Commands

| Check | Result |
| --- | --- |
| install frozen, `pnpm turbo typecheck` | exit 0 |
| Hook + notice unit tests (`src/hooks/use-project-websocket*`, `src/components/common`) | 6 files, 27 tests passed |
| Mutations on the hook (5) | all 5 killed (below) |
| Playwright `legacy-realtime-unavailable.spec.ts` (scratch config on 4194, fixture port patched in scratch only, reverted) | 2 passed |
| Same spec with the connection-limit rule disabled in the hook (rebuilt) | the limit test fails (it would retry), the healthy test passes: the e2e is meaningful |
| `check:i18n`, `check:ui`, `check:tokens` (contrast, source-grounded), `biome ci` on touched paths | pass |

## Hook state machine

- States `connecting` (pending, no indicator), `live` (socket open), `unavailable` (a close or error the client did not cause). The notice renders only for `unavailable`; `connecting` never shows it, so a slow first connect is not reported as an outage.
- No false "unavailable" on normal unmount or navigation: each effect run owns a `disposed` flag set in the cleanup before `ws.close()`; `onclose` returns before touching state or scheduling a retry when disposed, and the reconnect timer is cleared. This also covers project change, session change and React StrictMode's double mount (the discarded socket's late `onclose` is ignored). Mutation removing the guard fails 1 test; removing `disposed = true` fails 1.
- Clears correctly: `onopen` sets `live` (and resets retries); a new project or session re-runs the effect, which resets to `connecting` and gives a terminal-stopped socket its retry; a remount starts fresh. Mutations removing the reset or the `live` transition fail 3 tests each; removing the `unavailable` transition fails 5.
- Terminal stops (connection-limit close 1008/"connection limit", or retries exhausted) keep `unavailable`, which is the documented intent since the page then only polls every 30 s. The server side matches: the legacy socket refuses the sixth connection with that close code (`addConnectionWithinLimit` in apps/api/src/ws/index.ts), and the client's non-retry rule is unchanged.
- Docs accuracy: the per-person limit is a module-level `Map` in each API process for legacy project sockets (`projectConnectionsPerPerson`) and a separate `Set` filtered by user for native sockets, both capped by `MAX_REALTIME_CONNECTIONS_PER_PERSON = 5`; so "per API replica and per socket kind, N replicas allow up to 5N of each" in realtime.md and scaling.md is accurate. The new Fallback paragraph (indicator on an uncaused close, stays on terminal stops, remount or project/session change clears it, no automatic retry of the limit close after a same-project route change) matches the code (the effect depends only on projectId, user id and queryClient).
- Same wording as native screens (`workItems:detail.realtimeUnavailable`), `Alert` from packages/ui, `role="status"`, test id for e2e; both layouts render it.

## Findings

Blocking: none.

Non-blocking:
- N1. Any first uncaused close, including a brief blip or a server restart that reconnects after 1 s, shows the indicator for the backoff period (no debounce). This follows the spec's wording and the unit test "any other close shows the indicator while it backs off", but a short grace period would avoid flicker.
- N2. When `projectId` becomes empty or the session becomes null the effect early-returns without resetting the status, so a stale `live` or `unavailable` could linger until the next effect run; in practice the layouts unmount on sign-out and always have a project id.
- N3. `ProjectLayout` and `TaskLayout` both call the hook; if a task page ever renders both, two sockets (pre-existing) and two notices would appear. I found no route that nests them today.
- N4. The e2e relies on a 3.5 s fixed wait to assert "no retry" (first retry would be at 1 s); fine, only slightly slow.

## Residual risk

Real-browser WebSocket close semantics (for example a proxy that strips upgrades, close code 1006) were exercised only through the mocked `routeWebSocket` and unit-level fake sockets. Full web suite not run (load control).

**Verdict:** APPROVE

---

## Mechanical check: merge of main 9bb28099 (#767 merged)

**Reviewed head:** d68ec9e2b465f78ef0201fc581ef5dec660ef849
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate). Mechanical check only: no tests were re-run.

- `gh pr view 775` head equals d68ec9e2b465f78ef0201fc581ef5dec660ef849. Parents: e34657b0fb65cc90034b3c0a4a6536ba1b84d710 (the previously reviewed head) and 9bb28099a69d1e599e1d7451ebdf6225e380546c (main).
- `git merge-tree --write-tree e34657b0fb65cc90034b3c0a4a6536ba1b84d710 9bb28099` prints the same tree as the new head's tree: the merge is clean, with no hand edits or conflict resolution.
- Merge base with main is c35666c5. Main brought 9 files; the diff from the old head to the new head is exactly that file list. None of them is also changed on the PR side since the merge base (overlap: 0 files).
- Main's files (project api, openapi, rbac, release workflow, docs) are unrelated to the web realtime hook, notice, layouts, e2e spec and realtime/scaling docs this PR changes.
**Verdict:** APPROVE
<!-- END REPORT (sha256 6fa1620e92e4a7482b63bce554aa0a0adb8ca022f82d77dfa145e5908ac516c3) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/775-ordinary-d-sonnet.md; Claude Sonnet 5.5; sha256 83256572fcb587de410e008c88aa38edc7d99b038ba31c87e06182b21b32c7f6) -->
# #775 ordinary review D

(Created by a mechanical-check append; see the review reports for this PR where they exist.)

---

## Mechanical check after main moved to 9bb28099a69d1e599e1d7451ebdf6225e380546c

**Reviewed head:** d68ec9e2b465f78ef0201fc581ef5dec660ef849
**Model / context:** Claude Sonnet 5.5, fresh independent context (mechanical verification only; no code re-review)

- `gh pr view` head = d68ec9e2b465f78ef0201fc581ef5dec660ef849 (confirmed).
- Parents: first = e34657b0 (previously reviewed head), second = 9bb28099a69d1e599e1d7451ebdf6225e380546c (equals origin/main, ancestor of origin/main).
- `git merge-tree --write-tree <p1> <p2>` = 4cc161a8879a6c1e16ae00044ae786a7da6304e8, identical to the merge commit's tree: clean merge, no manual conflict resolution or extra edits.
- Overlap between files changed on the PR side and on the main side since the merge base: none (9 files changed on main).
- Tests not re-run (no PR-side change between the reviewed head and this one).

**Verdict:** APPROVE (unchanged from the prior review of e34657b0; for a PR with no prior review of mine, this is a mechanical check only)
<!-- END REPORT (sha256 83256572fcb587de410e008c88aa38edc7d99b038ba31c87e06182b21b32c7f6) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/775-security-opus.md; Claude Opus 5.5; sha256 1e5b0dc525841aca3431ca0067d61a754a16d4daab871310bab5aa95a42f575a) -->
# #775 security review (#751: legacy socket live-updates-unavailable indicator)

**Reviewed head:** e34657b0fb65cc90034b3c0a4a6536ba1b84d710
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context
**Comparison base:** merge base c35666c531c4b84c300bac5432fd4dc8dca3ed4f
**Role:** sampled security reviewer; did not author, direct or remediate this change. Read-only.

## Surfaces examined
- `apps/web/src/hooks/use-project-websocket.ts` (status state, `disposed` guard, unchanged `reconnectDelay` and URL/auth).
- `apps/web/src/components/common/realtime-unavailable-notice.tsx`, `project-layout.tsx`, `task-layout.tsx`.
- Tests: `use-project-websocket.status.test.tsx`, `use-project-websocket.test.ts`, `realtime-unavailable-notice.test.tsx`, `apps/web/e2e/legacy-realtime-unavailable.spec.ts`.
- Docs: `realtime.md` Fallback/Limits, `scaling.md`; `packages/ui/src/styles/pairs.json` (contrast inventory entries only).

## Analysis
- **Indicator content.** A fixed translated string (`workItems:detail.realtimeUnavailable`) with `role="status"`. It renders no close code, reason, URL, server text or identifiers. Nothing security-relevant is shown.
- **Reconnect cannot be driven into a loop.** `reconnectDelay` is unchanged: exponential 1s to 16s, cap of 5 retries, and a terminal stop on 1008 "connection limit". `setStatus` is not an effect dependency, so status changes cause no reconnect or re-render loop. The new `disposed` flag also stops a stale socket's `onclose` from scheduling a reconnect after a project or session switch. Before, the new effect reset `retriesRef` to 0, which could re-arm a reconnect for the old project, so this tightens behaviour.
- **Socket auth.** No change to `getWsUrl`, credentials, session gating (`session.user.id`) or message handling.
- **Docs.** Restates existing per-replica and per-kind socket limits. Operational, not exploit detail.

## Commands (scratch detached worktree under $TMPDIR/opus-774, removed afterwards)
- `pnpm install --frozen-lockfile --prefer-offline`: exit 0. `pnpm turbo typecheck`: exit 0, 9/9.
- `vitest run` on the 3 hook/notice test files: exit 0, 3 files, 23 tests passed.
- Mutation A: remove `if (disposed) return;` -> status test exit 1, 1 of 9 failed ("closing the socket ourselves ... never reported as an outage"). Killed.
- Mutation B: make the 1008 limit close retryable -> exit 1, 2 of 20 failed (status and reconnectDelay tests). Killed. Source restored.
- `pnpm --filter @taskdesk/web build`: exit 0.
- e2e with a scratch Playwright config (not committed), `legacy-realtime-unavailable.spec.ts`: exit 0, 2 passed. The spec asserts one connection attempt over 3.5 s after a 1008 close, a visible indicator, a usable page, and no indicator on a healthy socket. Port note: a first run on a random port failed 2/2 for environmental reasons: the shared fixture hard-codes CORS for origin 127.0.0.1:4178. The scratch config was re-run on 4178, which was free.

## Findings
- None blocking.

## Residual risk / not checked
- Predates this PR and is unchanged: `retriesRef` resets on every open, so a server that accepts and then closes with a non-1008 code keeps a roughly 1 s reconnect cadence per tab. The server-side per-person limit and the 1008 terminal stop bound the documented case.
- After a 1008 stop, the indicator stays until a remount or a project/session change. Documented as intended.
- Mutation B was checked with unit tests only (no rebuild and e2e rerun).

**Verdict:** CLEAR

---

## Mechanical rebind by a separate Opus context (not the author of the review above)

This section was written by a different Claude Opus 5.5 context from the one that wrote the full review at e34657b0 above. It establishes only that d68ec9e2 is a mechanical rebind of e34657b0.

**Reviewed head:** d68ec9e2b465f78ef0201fc581ef5dec660ef849

**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context (the same context that wrote the #760/#768/#769 security reports)
**Main:** 9bb28099a69d1e599e1d7451ebdf6225e380546c (#767 merged: `PUT /api/project/{id}` engagement fields need `project:manage_settings`, plus docs, tests and the review note)
**Previous reviewed head:** e34657b0fb65cc90034b3c0a4a6536ba1b84d710

Method (read-only, no checkout of the working tree): `git fetch`, `gh pr view --json headRefOid` (confirmed OPEN, MERGEABLE).
- **Parents:** `git log -1 --format=%P <new>` = `e34657b0fb65cc90034b3c0a4a6536ba1b84d710 9bb28099a69d1e599e1d7451ebdf6225e380546c`, which is the previous head plus the new main. It is a plain "Merge remote-tracking branch 'origin/main'" commit.
- **Merge-tree equality:** `git merge-tree --write-tree e34657b0fb65cc90034b3c0a4a6536ba1b84d710 9bb28099a69d1e599e1d7451ebdf6225e380546c` = 4cc161a8879a6c1e16ae00044ae786a7da6304e8, which equals `<new>^{tree}` = 4cc161a8879a6c1e16ae00044ae786a7da6304e8. The merge adds nothing beyond a clean, conflict-free merge.
- **Overlap:** the files the PR changes (from its old merge base) do not intersect the files main changed since that base (empty intersection). `git diff <old> <new> -- <PR files>` is empty, so the PR's own content is byte-identical.
- **Interaction:** main's changes since c35666c5 are the #767 server rule (project API, policy, docs, contract, integration test), the release workflow and a security-review note. The PR's surfaces are the realtime-unavailable notice, `use-project-websocket`, `project-layout.tsx`/`task-layout.tsx` and the e2e spec. `project-layout.tsx` reads the project via `useGetProject` (a GET) and is unaffected by the PUT engagement rule. No interaction.
- **Mechanical rebind:** d68ec9e2 is byte-equivalent to e34657b0 merged with main, with no conflicts and no change to PR content. The full review above (CLEAR at e34657b0) therefore carries to d68ec9e2 unchanged.

**Verdict:** CLEAR
<!-- END REPORT (sha256 1e5b0dc525841aca3431ca0067d61a754a16d4daab871310bab5aa95a42f575a) -->
