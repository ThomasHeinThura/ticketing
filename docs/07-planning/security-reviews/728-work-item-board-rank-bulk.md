# PR #728 security review record: work-item board, rank and bulk assign (#512 successor 3)

PR #728 adds the agent work-item board (`layout=board`), ranking by drag or by Move up/down, state changes by drag or select, and bulk assignment on the list and the board. It is web only, with no API code.

The controls are gated on the strict `rankTasks`, `transitionTasks` and `assignTasks` capability flags, and the server enforces every write.

The `apps/web/e2e/**` path is security-scope because of one updated G8 baseline, `work-item-list-linux.png`. It was captured with the pinned linux/amd64 Playwright image.

A Claude Sonnet 5.5 lane implemented the change over four rounds. The conductor (Claude Opus 5.5) merged `main`, captured the baseline and directed the rounds. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review A by Claude Sonnet 5.5 (behaviour, tests, mutations): APPROVE at `d6782600`, then delta APPROVE at `f38a6a0d`, `5c599046` and `7dc214b0`.
- Ordinary review B by Claude Sonnet 5.5 (spec, real browser, axe, G8, bundle): REQUEST CHANGES at `f38a6a0d` (B1), delta APPROVE at `5c599046` with B2 and B3 still open, and delta APPROVE at `7dc214b0` with B2 and B3 verified in Chromium.
- Security review by Claude Opus 5.5: CLEAR at `7dc214b0`. It checked the e2e baseline's provenance and hash, server enforcement, leakage and portal bundle purity.
- Mechanical security rebind at `ab6483c9`: CLEAR. This head merges `main` `f0f85e86` (#712). The tree equals the merge-tree. The rank, assign, transition and bulk routes now enforce project reach, and this PR already handles the resulting 404s.

**Reviewed head:** `7dc214b074c058811e4e3babb5d25b3b927b7bb4`
**Reviewed head:** `ab6483c9ce86517f5b641e6b236e164778415a80`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `512s3-ordinary-a-sonnet.md` | Ordinary review A (417944ca..d6782600) | Claude Sonnet 5.5 | `d6782600` | APPROVE | `cf5969323f745e9748cc899be533852570d1639a42d7114559512a83d9524f3c` |
| 2 | `512s3-f38a-ordinary-delta-a-sonnet.md` | Ordinary delta review A (d6782600..f38a6a0d) | Claude Sonnet 5.5 | `f38a6a0d` | APPROVE | `cf3b0587e9b7817c53328821d7fcbb9cad7ae9fd95534840ee20a2b61aaf1a58` |
| 3 | `728-ordinary-b-sonnet.md` | Ordinary review B (417944ca..f38a6a0d) | Claude Sonnet 5.5 | `f38a6a0d` | REQUEST CHANGES | `e0cc307728f8bfddbe405079aec87a12c66ff3e884c76748dd64d601160a1bbe` |
| 4 | `512s3-5c59-ordinary-delta-a-sonnet.md` | Ordinary delta review A (f38a6a0d..5c599046) | Claude Sonnet 5.5 | `5c599046` | APPROVE | `5af8edd5e4bd4b9bcd9ae6e295f1e78869a0346596fdf8fcb3ce564fb077454a` |
| 5 | `728-5c59-ordinary-delta-b-sonnet.md` | Ordinary delta review B (f38a6a0d..5c599046) | Claude Sonnet 5.5 | `5c599046` | APPROVE | `5cfdab6bde8476159c1df4eafa07e9187ebd1f62063f8824f815fdf0387c68e9` |
| 6 | `512s3-7dc2-ordinary-delta-a-sonnet.md` | Ordinary delta review A (5c599046..7dc214b0) | Claude Sonnet 5.5 | `7dc214b0` | APPROVE | `f3340a755bbdde6f9343c7a0c89f98d9a2170f83396623c7c580eb31628ee27b` |
| 7 | `728-7dc2-ordinary-delta-b-sonnet.md` | Ordinary delta review B (5c599046..7dc214b0) | Claude Sonnet 5.5 | `7dc214b0` | APPROVE | `bee45800a1aabe98979bf8ee798bddfd090c642e2eb4e9c367e8bce00fae43c5` |
| 8 | `728-security-opus.md` | Security review (aefb6888..7dc214b0) | Claude Opus 5.5 | `7dc214b0` | CLEAR | `0e80fa2922b97c5953f0c5a8fc44f2bf28fb4ae18d10f34bc686519c2c2908c7` |
| 9 | `728-ab64-security-rebind-opus.md` | Mechanical security rebind (7dc214b0..ab6483c9) | Claude Opus 5.5 | `ab6483c9` | CLEAR | `19855c5b10ce419064d7bd11169b8ed9a2d4b656aa2052e7c8e94fd559e11821` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/512s3-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 cf5969323f745e9748cc899be533852570d1639a42d7114559512a83d9524f3c) -->
# #512 successor 3 (board, rank, bulk assign): ordinary review A

**Reviewer model:** Claude Sonnet 5.5 (fresh independent context; did not author, direct or remediate)
**Reviewed head:** d67826002ee9d191a8996ba4c039d4dca8d765e2
**Base:** origin/main 417944ca57844d02de1590fbed82633a476f4665
Angle: behaviour and tests. Scratch worktree at the exact head, removed afterwards. No Docker.

## Commands (scratch worktree, `pnpm install --frozen-lockfile --offline` exit 0)
- apps/web `npx vitest run`: first run exit 1 (7 files failed to resolve unbuilt workspace packages `@taskdesk/domain`, `@taskdesk/permissions`; environmental, not in the diff). After `pnpm --filter @taskdesk/domain --filter @taskdesk/permissions build` (exit 0): **exit 0, 172 files, 879 tests passed**.
- `pnpm --filter @taskdesk/web typecheck`: exit 0.
- `pnpm lint:ci`: exit 0 (196 warnings, 0 errors).
- `pnpm check:i18n`: exit 0 (19 locales in sync).
- `node scripts/ci/check-ui.mjs --raw-elements`: exit 0 (0 raw JSX elements).
- `pnpm check:tokens`: exit 0 (418 pairs meet thresholds).
- `pnpm check:visual-scope`: exit 0 (19 cases, 18 routes mapped).

## Mutation testing (18 mutants applied by me, file restored each time; 17 killed, 1 survived)
Killed: route canRank without the loading guard; route canTransition forced true; route bulk gate forced true; hook rank falling back to updateTasks; hook transition loose truthy via updateTasks; Move buttons ignoring canRank; Change state ignoring canTransition; cross-column canTransition guard removed; same-column drop ignoring canRank; rankNeighbours before/after swapped; bulk releasing all selected keys; selection prune removed; rank failure without refetch; busy guard removed; transition sent toStateId instead of toStateTemplateId; 409 classified unknown; `offer.available` check removed in drop.
**Survived:** the Change-state select listing unavailable edges (`transitions.data?.filter(available)` replaced with `transitions.data`). See N1.

## Behaviour review
- Board: columns from `useGetProjectStates`; cards from `sort=position` infinite query; client re-sorts with a string-safe comparator. Neighbour semantics match the API (`beforeId` = item before the slot, `afterId` = item after; verified in `apps/api/src/work-item/controllers/rank-work-item.ts`; both sent so the midpoint is used). Drag and Move up/down share `rankNeighbours`. Cross-column drop reads GET transitions, requires `available`, posts `toStateTemplateId`, then a best-effort rank in the target. Only offered edges are used.
- 404/409/422/400/403/500 each map to a distinct message, an alert (`role=alert`) or polite status, and a refetch (`["work-items", projectId]`, which prefixes the board key). No optimistic cache write exists, so nothing is left wrong after a failure.
- Concurrency: `busyRef` serialises drag and keyboard moves (tested, including a drop during an in-flight move).
- Bulk: whole-request error keeps the full selection; success releases only `response.succeeded`; failures listed per item; "not found" localised. Selection is pruned in work.tsx when keys leave the loaded set.
- Capabilities: strict `=== true` for `transitionTasks`/`rankTasks`/`assignTasks`, all false while `isCheckingPermissions`; no `updateTasks` gating in the new code.
- Port fidelity: #512 board/bulk/fetchers/hooks all present; improvements (two-neighbour rank, keyboard alternative, announcements, partial release) are deliberate. No comment/composer code leaked (0 hits; no comment files in the diff).

## Findings
**Blocking:** none.

**Non-blocking**
- N1 (test gap): `work-item-board.test.tsx` "offers only available edges" asserts `queryByRole("option", {name: "Hidden"})` is null immediately after opening the select, before the listbox renders, so it passes vacuously (mutant survived). Production code is correct. Fix: assert after `findByRole("option", {name: "Done"})`.
- N2: the select-based Change state (`BoardCard.move`) does not take `busyRef` or raise board `busy`; a drag-drop can start while a select transition is in flight. Low risk (server rechecks, board refetches).
- N3: `board.failure.invalid` (400) text is rank-specific ("position wasn't saved") but is also shown for a 400 from transition. Wording only.
- N4: no explicit assertion that `onAssigned` is not called on a whole-request bulk failure. Minor.
- N5: a cross-column drop ranks against loaded cards only (unloaded pages ignored). Acceptable.

## Not checked
Playwright/browser run, bundle-size and bundle-purity gates, openapi/policy checks, Sol security scope, real browser drag-and-drop (jsdom events only), non-English locale quality, the appended contrast-manifest occurrences beyond `check:tokens` passing.

**Verdict:** APPROVE
<!-- END REPORT (sha256 cf5969323f745e9748cc899be533852570d1639a42d7114559512a83d9524f3c) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/512s3-f38a-ordinary-delta-a-sonnet.md; Claude Sonnet 5.5; sha256 cf3b0587e9b7817c53328821d7fcbb9cad7ae9fd95534840ee20a2b61aaf1a58) -->
# #512 successor 3 / PR #728: exact-head delta review A (round 2)

**Reviewer model:** Claude Sonnet 5.5 (same reviewer as my APPROVE at d6782600; I did not author or remediate)
**Reviewed head:** f38a6a0d5133af6b6c8db5da3babd4c911b88318
**Delta base:** d67826002ee9d191a8996ba4c039d4dca8d765e2 (my prior APPROVE). Commits: 0331945e (G8 baseline), f38a6a0d (round 2).
Scratch worktree at the exact head, removed afterwards. No Docker.

## PNG (0331945e)
Viewed `apps/web/e2e/visual.spec.ts-snapshots/work-item-list-linux.png` before and after. The only visible difference is the added "List" and "Board" toggle buttons left of "Create work item". Heading, live-updates banner, table, row and colours are identical. Pass.

## Fix verification (f38a6a0d: board.tsx, board test, i18n x19 + schema)
- **N1 fixed.** The test now awaits `findByRole("option", {name: "Done"})` before asserting "Hidden" is absent. My surviving mutant (`transitions.data` unfiltered) is now KILLED (1 failure).
- **N2 fixed.** The select transition now runs through `runMove` (`transitionFromSelect`), sharing `busyRef`/`busy` with drag and rank. BoardCard no longer calls the API itself. Two new tests (drag ignored during select transition; select button disabled and no transition during rank). Mutant "select transition bypasses guard" KILLED (6 failures).
- **N3 fixed.** `describeFailure(..., kind)` maps a transition 400 to the new `board.failure.transitionInvalid` ("The state change for {{key}} was not valid..."), used on the drag path and the select path; rank 400 keeps the old wording. New tests for drag and select. Mutant "transition 400 uses rank wording" KILLED (2 failures). The new key is in all 19 locales and schema.json (en text in non-English locales, as is the repo pattern).
- **N4 NOT addressed.** The delta touches no bulk-assign toolbar test file (`git diff --stat -- '*bulk*'` is empty), so the `onAssigned`-not-called-on-whole-request-failure assertion was not added. It was a minor non-blocking item; I do not block on it.
- Behavioural check of the refactor: success closes the select, failure keeps it open with the choice cleared, both refetch (`["work-items", projectId]` and the transitions key); the card's `isMoving` still disables the button. No regression found.

## Commands (all at f38a6a0d)
- apps/web `npx vitest run`: exit 0, 172 files, 883 tests passed (workspace packages domain/permissions built first, as before).
- `pnpm --filter @taskdesk/web typecheck`: exit 0 on two reruns. One earlier run, immediately after vitest, printed only "Exit status 1" and I could not reproduce it (no errors on rerun; likely transient). Flagging for transparency.
- `pnpm check:i18n`: exit 0.
- `node scripts/ci/check-ui.mjs --raw-elements`: exit 0 (0 raw elements).
- `pnpm check:tokens`: exit 0 (418 pairs).

## Findings
Blocking: none. Non-blocking: N4 above still open (test-only, minor).

## Not checked
lint:ci, check:visual-scope, Playwright re-capture of the baseline (only inspected the PNG), Sol security scope, real-browser drag.

**Verdict:** APPROVE
<!-- END REPORT (sha256 cf3b0587e9b7817c53328821d7fcbb9cad7ae9fd95534840ee20a2b61aaf1a58) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/728-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 e0cc307728f8bfddbe405079aec87a12c66ff3e884c76748dd64d601160a1bbe) -->
# PR #728 ordinary review B (alignment, UI, accessibility, #512 accounting)

**Reviewed head:** f38a6a0d5133af6b6c8db5da3babd4c911b88318
**Base:** origin/main 417944ca57844d02de1590fbed82633a476f4665
**Model / context:** Claude Sonnet 5.5, fresh independent ordinary-reviewer-B context. I did not author, direct or remediate this change. I did not read reviewer A's report.
**Method:** scratch worktree `/Users/heinthura/.codex/wt-728-b` at the exact head (removed afterwards). Frozen offline install, built domain, permissions and email workspace packages. No Docker.

## Commands (exit codes and counts)

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm lint:ci` (biome ci .) | 0 | 2262 files, 196 warnings, 1 info, 0 errors |
| `pnpm --filter @taskdesk/web typecheck` | 0 | clean. The first run failed only because `@taskdesk/email` was not built in the scratch tree (environmental); after building it, exit 0 |
| `pnpm --filter @taskdesk/web exec vitest run` (full) | 0 | 172 files, 883 tests passed |
| `pnpm check:i18n` | 0 | all 19 locales in sync with en-US |
| `pnpm check:tokens` (tokens + contrast) | 0 | 418 declared, source-grounded pairs meet thresholds |
| `node scripts/ci/check-ui.mjs --raw-elements` | 0 | 0 raw JSX elements, 0 unlisted imports |
| `pnpm check:visual-scope` | 0 | G8 scope passed: 19 screenshot cases, 18 active inventory route rows mapped |
| `pnpm check:inventory` | 0 | |
| `VITE_API_URL="" pnpm --filter @taskdesk/web build` | 0 | |
| `pnpm check:bundle-size` | 0 | agent initial 230.9 KB gzip of 350; work-list route graph 307.6 KB of 350; portal 163.7 KB of 200 |
| `pnpm check:bundle-purity` | 0 | G12 portal graph clean |
| Playwright throwaway spec (Chromium, mocked backend, preview server on 4178) | 0 | 14 tests passed (spec deleted after) |

## 1. Spec alignment

- Board columns are the active project states in project order, including empty ones (VW-8). A cross-column drop calls `GET transitions`, then `POST transition` (VW-9, WI-9, WI-26). A same-column drop or Move up/down calls `POST rank` with both neighbours (VW-10, WI-11). Confirmed in a real browser: a drag within a column sent `beforeId` only when at the end; a drag across columns sent transition then rank.
- Capability gating: Move buttons need `rankTasks`, Change state needs `transitionTasks`, and the bulk bar and checkboxes need `assignTasks`. All are strict `=== true` and false while permissions load. A read-only user got 0 move/state buttons, 0 checkboxes and 0 draggable cards. Matches rbac.md (`work_item:rank`, `work_item:transition`, `work_item:assign`).
- Bulk: only assign is built, which matches the API's actual scope (`bulk-work-items.ts` supports assign and delete). Per-item partial failure is shown (WI-25), "not found" is localised and reveals nothing more (WI-25 no-existence-leak), and only succeeded keys are released from the selection. Verified in the browser: 1 assigned, 2 failed, selection left at the 2 failed keys.
- Excluded correctly: bulk delete (destructive, WI-23 needs a typed count, no #512 counterpart), bulk state/priority/label (no API), the composer and comments (D9, #606), journey detail (#722), service calendars (#513).
- #512 accounting: #512's `work-item-board.tsx`, `bulk-assign-toolbar.tsx`, rank and bulk fetchers, board query hook and states hook are all ported. #512's board visual baselines (`work-item-board-linux/darwin.png`) and `work-item-journey.spec.ts` are intentionally not carried (hand-built fixtures for a different base). Nothing approved for board, rank or bulk is missing.
- VW-11 (virtualise above 50), VW-12 (WIP limits), VW-13 (grouping), VW-2 (per-user layout memory) and VW-14's literal Space-lift are not built. They are declared known gaps. VW-14's intent (full keyboard path with live announcements) is met by Move up/down plus Change state, see section 2.

## 2. Real browser (Chromium, mocked backend)

Screens opened (files `728-screen-*.png` in this directory): populated board light and dark, the bulk-assignee select open (light and dark), the state select open (light and dark), after-rank, after-drag, rank-error alert, loading skeleton, load error with Retry, empty columns, no states, read-only, list with checkboxes, list bulk bar with partial result, 7-state board, mobile (390 px) board with bulk bar, mobile list.

- States: loading skeleton, error alert with Retry, empty columns ("No work items in this state."), no-states Empty, populated: all render sensibly.
- Keyboard-only rank: 7 Tab presses reach "Move down: WLP-1 in Backlog". Enter moves it and the live region says "WLP-1 moved to position 2 of 3 in Backlog." Focus stays on the same control. At the bottom (Move down disabled) focus falls back to Move up, and the next Enter moves up again. Rank calls sent both neighbours. A 409 rank gives a `role=alert` "changed in the meantime ... board was refreshed".
- Accessible names: no duplicate names among buttons, links, checkboxes and comboboxes. Each button carries the card key and the state. Visible text ("Move up") is contained in the accessible name.
- Headings: h1 then one h2 per column, columns are fieldsets labelled by the h2.
- axe-core 4.13 (injected from packages/ui's dependency) in light (rgb 255) and dark (theme set through the persisted `user-preferences` store, not emulation): **0 critical, 0 serious** on every board state, the open selects, the list and bulk bar, and mobile. Only moderate `region` and `landmark-one-main` (page shell, not new code).
- Real mouse drag in Chromium works (`dragTo`): same-column reorder and cross-column transition both announced "WLP-4 moved to Done."

## Findings

**B1. BLOCKING (user-visible, primary flow): the bulk assignee select shows the raw person id after a choice.** In `bulk-assign-toolbar.tsx` the `<SelectValue>` has only a placeholder and no children, so after choosing "Ada Lovelace" the trigger displays the item value (`p1` in the mock, a UUID in production). Screenshot: `728-screen-list-bulk-partial.png`. The user cannot see who they are about to assign 2+ items to, and a screen reader announces the id. The board's own state select already does this right (`<SelectValue>{chosen?.toStateName}</SelectValue>`). Fix: render the chosen person's name (`people.data?.find(...)`) as children. Add a test asserting the trigger text after selection (current tests miss it).

**B2. Non-blocking: board layout does not fill the page width and leaks to page overflow on narrow screens.** With 3 states the board and header are content-sized (about 950 px of 1280; error state about 560 px), unlike the list. At 390 px `documentElement.scrollWidth` is 674, the header's "Create work item" button is clipped and the page scrolls horizontally (the 7-state desktop case is fine, the board scrolls internally). Likely a missing `w-full min-w-0` on the route wrapper or board root. mobile-320 is not yet an enabled gate, so non-blocking, but visible.

**B3. Non-blocking: focus is lost after "Change state" Move.** After the select-based transition the card leaves its column and the panel closes; `document.activeElement` is `BODY`. The rank buttons restore focus, the state flow does not. Suggest moving focus to the moved card's link or the live region owner after the board refetches.

**B4. Non-blocking: 404 handling deviates from the decision-log entry.** The 2026-10-13 entry says a 404 from any work-item mutation shows the not-found state. The board shows an inline "no longer available to you" alert and refetches. This is a reasonable adaptation (a board has other items) and is documented in the implementer notes (judgment call 3), but the conductor should record it, since the log is the higher authority. Reversal is trivial.

**B5. Non-blocking: board is a live, toggle-reachable screen while its inventory row is ⬜ and it has no G8 case.** Consistent with the stated rule (`check:visual-scope` passes, 18 mapped rows) and with the implementer's judgment, but the follow-up (successor 4 or a G8 PR) should flip the row to 🟡 with a `work-item-board-linux.png` baseline. #512 had one.

**B6. Non-blocking, minor:** Card checkbox is top-aligned slightly above the key text baseline; the column "select all" checkbox has no indeterminate state; `<li draggable>` inside `list-none` loses list semantics in Safari/VoiceOver; the List/Board toggle's pressed state is a subtle fill difference in dark mode (it does expose `aria-pressed`).

## 3. G8
Only `work-item-list-linux.png` changed (26336 to 28343 bytes, commit 0331945e, single file). The image shows exactly one change, the List/Board toggle left of Create. `pnpm check:visual-scope` passes. The board row is "not started" in `docs/02-design/screen-inventory.md` (line 53), so no board baseline is required today, consistent. I could not regenerate the pinned linux/amd64 image (no Docker), so pixel-exactness of the baseline against the pinned pipeline is unverified by me.

## 4. Bundle
Budgets pass (numbers above). Board, bulk bar and realtime are lazy chunks. G12 portal purity clean.

## What I did not check
- Pinned-image G8 regeneration and the full Playwright visual suite.
- A real API (all browser checks are against a mocked backend that mirrors the API's response shapes; rank midpoint maths were mocked).
- Screen readers (NVDA/VoiceOver); announcements were checked by reading the live region's DOM text only.
- Realtime (WebSocket) updates on the board, Firefox/WebKit, the 200-per-page and `hasMore` load-more path with real data, and performance (G11) of the board.
- API controllers beyond reading the bulk and transition shapes.

**Verdict:** REQUEST CHANGES (B1 only; B2 to B6 non-blocking)
<!-- END REPORT (sha256 e0cc307728f8bfddbe405079aec87a12c66ff3e884c76748dd64d601160a1bbe) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/512s3-5c59-ordinary-delta-a-sonnet.md; Claude Sonnet 5.5; sha256 5af8edd5e4bd4b9bcd9ae6e295f1e78869a0346596fdf8fcb3ce564fb077454a) -->
# #512 successor 3 / PR #728: exact-head delta review A (round 3)

**Reviewer model:** Claude Sonnet 5.5 (same reviewer as prior APPROVEs; not author)
**Reviewed head:** 5c5990460068ebd01f934285962f9e9d4685b919
**Delta base:** f38a6a0d5133af6b6c8db5da3babd4c911b88318 (my prior APPROVE). One commit, 5 files under apps/web. Scratch worktree, removed afterwards. No Docker.

## Fix verification (each mutated by me, test file run, file restored)
- **B1 bulk assignee name:** `SelectValue` now renders `chosenPerson.name` (or the unnamed label). New test asserts the trigger shows "Riley" and not "p1". Mutants: children dropped -> KILLED; name replaced by personId -> KILLED.
- **B3 focus after Move:** `changeStateRef` on the card's Change state button, focused after `onTransition` resolves (success or failure). New test focuses Move, clicks, and expects the toggle focused. Mutants: focus call removed -> KILLED; ref detached -> KILLED. On failure the select stays open and focus goes to the toggle; acceptable.
- **B2 layout:** `w-full min-w-0` on the board root; in work.tsx the wrapper and header get `w-full min-w-0` / `flex-wrap` only when `layout === "board"`. Visual only, not testable in jsdom, so no mutation. Not covered by a test (expected).
- **List path unchanged:** with `layout === "list"` both class strings are byte-identical to before ("flex h-full flex-col gap-4 overflow-y-auto p-6" and "flex items-center justify-between gap-3"). The G8 list baseline is unaffected. No list component touched.
- **Earlier findings still hold:** the N1-N3 fixes are untouched (board tests still pass, including the busy-guard and transition-400 tests). N4 (no `onAssigned`-not-called assertion on whole-request bulk failure) remains open, non-blocking.

## Commands (at 5c599046)
- apps/web `npx vitest run`: exit 0, 172 files, 885 tests passed (domain/permissions built first).
- `pnpm --filter @taskdesk/web typecheck`: exit 0 after building `@taskdesk/email`. Without that build it exits 1 with TS2307 "Cannot find module '@taskdesk/email'" from apps/api files; environmental (unbuilt workspace package), not in the diff. This also explains the unreproducible failure I noted last round.
- `pnpm check:i18n`: exit 0.
- `node scripts/ci/check-ui.mjs --raw-elements`: exit 0 (0 raw elements).

## Findings
Blocking: none. Non-blocking: N4 still open.

## Not checked
lint:ci, check:tokens, check:visual-scope, Playwright/visual re-capture, real-browser layout of B2, Sol security scope.

**Verdict:** APPROVE
<!-- END REPORT (sha256 5af8edd5e4bd4b9bcd9ae6e295f1e78869a0346596fdf8fcb3ce564fb077454a) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/728-5c59-ordinary-delta-b-sonnet.md; Claude Sonnet 5.5; sha256 5cfdab6bde8476159c1df4eafa07e9187ebd1f62063f8824f815fdf0387c68e9) -->
# PR #728 exact-head delta review B (f38a6a0d to 5c599046)

**Reviewed head:** 5c5990460068ebd01f934285962f9e9d4685b919
**Previous head reviewed:** f38a6a0d5133af6b6c8db5da3babd4c911b88318 (REQUEST CHANGES on B1)
**Model / context:** Claude Sonnet 5.5, ordinary reviewer B (same reviewer as the earlier round; I did not author or remediate).
Delta is 5 files, +50/-4: `bulk-assign-toolbar.tsx(+test)`, `work-item-board.tsx(+test)`, route `work.tsx`. Scratch worktree at the exact head, removed afterwards.

## Gates (scratch worktree at 5c599046)
| Command | Exit | Result |
| --- | --- | --- |
| `pnpm --filter @taskdesk/web typecheck` | 0 | clean |
| `pnpm --filter @taskdesk/web exec vitest run` | 0 | 172 files, 885 tests passed |
| `pnpm check:i18n` | 0 | in sync |
| `node scripts/ci/check-ui.mjs --raw-elements` | 0 | |
| `pnpm check:tokens` | 0 | |
| `pnpm check:visual-scope` | 0 | |
| `VITE_API_URL="" pnpm --filter @taskdesk/web build` | 0 | (for the browser probe) |

## Browser probe (Chromium, mocked backend, light and dark)
- **B1 resolved.** After choosing a person the trigger reads "Ada Lovelace" (light and dark). A person with no name reads "Unnamed person". No raw id shown. Screenshots `728-5c59-screen-bulk-name-{light,dark}.png`.
- **List unchanged.** The route change is `layout === "board" ? " w-full min-w-0" : ""` and `layout === "board" ? " flex-wrap" : ""`, so for the list the className strings are byte-identical to before. Measured in the browser: wrapper `flex h-full flex-col gap-4 overflow-y-auto p-6`, header `flex items-center justify-between gap-3`, toggle fieldset `m-0 flex min-w-0 items-center gap-1 border-0 p-0`. The list component and panel are untouched in this delta. The 0331945e G8 list baseline still applies.
- **B2 partly resolved.** At 1280 px the 3-state board is now 1232 px wide (was about 950). At 390 px the header wraps and Create work item is on screen (left 148, right 297). **But the page still scrolls horizontally at 390 px**: `documentElement.scrollWidth` is 674, `window.scrollX` reaches 284 after a wheel scroll. All containers measure 390 wide. Bisecting shows the cause is absolutely positioned elements inside the board's `overflow-x-auto` scroller (the checkbox indicator spans `absolute -inset-px` and an `sr-only` span) whose containing block is outside the scroller, so they escape its clipping and extend the root scroll area. Hiding the scroller drops the root to 390. A `relative` on the scroller (or board root) should fix it. This also affects wide boards on desktop (7 states at 1280 px gave root scrollWidth 1890 in my first round; I wrongly dismissed that as clipped). Note `w-full min-w-0` alone cannot fix this.
- **B3 not resolved in the real browser.** After a select-based Move that succeeds, the card changes column and remounts, so the ref'd button of the old instance is gone; `document.activeElement` is still `BODY`. The new unit test passes because its mock does not move the card. The fix only helps when the item stays in place. Suggest focusing the moved card's link or Change state button by key after the refetch, the way rank restores focus.

## Findings
- B1: resolved (was blocking).
- B2: non-blocking, still open (page-level horizontal scroll, cause above).
- B3: non-blocking, still open (focus lost on a successful cross-column Move).
- B4 to B6 from the earlier round are unchanged (B4 is a decision-log note for the conductor; B5 is the board inventory row and baseline for the follow-up).

## Not checked
Pinned-image G8 regeneration, real API, screen readers, other browsers.

**Verdict:** APPROVE (the one blocking finding is fixed and verified; B2 and B3 remain as non-blocking follow-ups, the delta does not regress anything)
<!-- END REPORT (sha256 5cfdab6bde8476159c1df4eafa07e9187ebd1f62063f8824f815fdf0387c68e9) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/512s3-7dc2-ordinary-delta-a-sonnet.md; Claude Sonnet 5.5; sha256 f3340a755bbdde6f9343c7a0c89f98d9a2170f83396623c7c580eb31628ee27b) -->
# #512 successor 3 / PR #728: exact-head delta review A (merge of main aefb6888 / #722)

**Reviewer model:** Claude Sonnet 5.5 (same reviewer as prior APPROVEs; not author)
**Reviewed head:** 7dc214b074c058811e4e3babb5d25b3b927b7bb4
**Delta base:** 5c599046 (my prior APPROVE) merged with aefb6888 (#722). Scratch worktree, removed afterwards. No Docker.

## Non-merge content
`git merge-tree --write-tree 5c599046 aefb6888` conflicts (i18n x19, pairs.json), so I diffed `apps/` against its tree: only `work-item-board.tsx` and its test differ (conflict files are the i18n/pairs resolutions, checked below).
- **B2:** `relative` added to the board root and the columns row. Visual only, untested (jsdom).
- **B3:** focus now restored by item key after the refetch: `pendingFocus = {key, direction:"state"}` set in `transitionFromSelect`, consumed in the existing `workItems` effect, which queries `[data-change-state-button="KEY"]`. This replaces the per-card ref, which was lost when the card remounted in another column. The test now re-renders the card into the Done column during the transition and asserts the toggle inside Done holds focus. Mutants: pendingFocus not set -> KILLED; state branch removed -> KILLED; data attribute dropped -> KILLED; wrong key selector -> KILLED. Non-vacuous.
- Minor, non-blocking (N6): if `runMove` is refused (busy), `pendingFocus` stays set and a later unrelated `workItems` change would pull focus to that toggle. Unlikely (the Move button is disabled while busy).

## Combined behaviour with #722
- Shared fetchers `rank/transition/get-transitions/get-assignable-people/bulk-assign` are byte-identical to main aside from the files this PR adds (rank, bulk-assign); `transition-work-item`, `get-work-item-transitions`, `get-assignable-people` show no diff vs main. `HttpError` status still reaches `classifyWorkItemWriteError`.
- `use-workspace-permission.ts` has no diff vs main; `canTransitionTasks`/`canRankTasks`/`canManageProjectSettings`/`canBindProjectOrganisation` each appear once, all strict `=== true`; the `CapabilityMap` fields appear once. No `updateTasks` gating.
- No duplicate keys: all 19 i18n files and `pairs.json` parse with a duplicate-key-rejecting loader; no conflict markers; `git ls-files -u` empty.
- Earlier findings: N1-N3 and B1 fixes still hold (their tests pass in the full run); N4 (no `onAssigned`-not-called assertion on whole-request bulk failure) still open, non-blocking.

## Commands (at 7dc214b0; email, domain, permissions built first, exit 0)
- apps/web `npx vitest run`: exit 0, 174 files, 936 tests passed.
- `pnpm --filter @taskdesk/web typecheck`: exit 0.
- `pnpm lint:ci`: exit 0 (196 warnings, 0 errors).
- `pnpm check:i18n`: exit 0 (all locales in sync).

## Not checked
check:tokens/contrast after the pairs.json merge, check-ui, visual-scope, Playwright, real-browser B2 layout, Sol security scope.

## Findings
Blocking: none. Non-blocking: N4 (open), N6 (new, minor).

**Verdict:** APPROVE
<!-- END REPORT (sha256 f3340a755bbdde6f9343c7a0c89f98d9a2170f83396623c7c580eb31628ee27b) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/728-7dc2-ordinary-delta-b-sonnet.md; Claude Sonnet 5.5; sha256 bee45800a1aabe98979bf8ee798bddfd090c642e2eb4e9c367e8bce00fae43c5) -->
# PR #728 exact-head delta review B (merge of main aefb6888 into 5c599046)

**Reviewed head:** 7dc214b074c058811e4e3babb5d25b3b927b7bb4
**Parents:** 5c5990460068ebd01f934285962f9e9d4685b919 and aefb6888f3d45ad3439c69133ac644f738a70a4a (main, includes #722)
**Model / context:** Claude Sonnet 5.5, ordinary reviewer B (not author). Scratch worktree at the exact head, removed afterwards.

## 1. Non-merge content
`git diff $(git merge-tree --write-tree 5c599046 aefb6888) 7dc214b0` (the merge-tree is the conflicted tree) touches only:
- `work-item-board.tsx` and its test: B2 and B3 (below).
- `i18n/*.json` (19 locales), `i18n/schema.json`, `packages/ui/src/styles/pairs.json`: conflict resolutions.
No other file differs from the plain merge, so no hidden source change.

- **B2 code:** `relative` added to the board root and to the `overflow-x-auto` scroller. Nothing else.
- **B3 code:** `FocusTarget` gains a `"state"` direction. `transitionFromSelect` sets `pendingFocus = {key, "state"}` before the write; the existing post-refetch effect focuses `[data-change-state-button="<key>"]` by item key. The old per-card ref is removed. The test now rerenders the card into Done and asserts the toggle there has focus and sits inside the Done column (non-vacuous).
- **No #722 content lost:** for en-US, de-DE and ja-JP, every key (leaf path) from both 5c599046 and aefb6888 is present in the merge (0 missing) and with identical values (0 value differences vs either side); en/de have 2504 leaf keys, ja 2496. `check:i18n` is green for all locales. `pairs.json` has 418 entries on both parents and on the merge, and `check:tokens` reports "418 declared, source-grounded pairs meet thresholds".

## Gates (scratch worktree at 7dc214b0)
| Command | Exit | Result |
| --- | --- | --- |
| `pnpm --filter @taskdesk/web typecheck` | 0 | clean |
| `pnpm --filter @taskdesk/web exec vitest run` | 0 | 174 files, 936 tests passed |
| `pnpm check:i18n` | 0 | |
| `node scripts/ci/check-ui.mjs --raw-elements` | 0 | |
| `pnpm check:tokens` | 0 | 418 pairs |
| `pnpm check:visual-scope` | 0 | |
| build (`VITE_API_URL=""`) | 0 | |
| Playwright probe (Chromium, mocked backend; spec deleted) | 0 | 8 tests passed |

## 2. Browser probe
- **B2 fixed.** 390 px, 3 states, with a bulk selection: document `scrollWidth` 390 = `clientWidth` 390; the board scroller is 928 wide in 342 and scrolls internally (`scrollLeft` reached 200); page `scrollX` stays 0 after a wheel scroll; Create work item is on screen (148 to 297). 1280 px, 7 states: document 1280 = 1280; scroller 2144 in 1232 scrolls internally (`scrollLeft` 400), page `scrollX` 0. 1280 px, 3 states: board 1232 wide, no overflow.
- **B3 fixed.** After the select Move, the active element is the "Change state of WLP-4" button, inside the WLP-4 card in the Done column (the card's new column). On a failed move (409) focus stays on the select control and is not stolen.
- **B1 holds.** Trigger reads "Ada Lovelace" (light and dark).
- **List unchanged.** Wrapper `flex h-full flex-col gap-4 overflow-y-auto p-6`, header `flex items-center justify-between gap-3`, toggle `m-0 flex min-w-0 items-center gap-1 border-0 p-0`, identical to earlier heads. The list component files are not in the non-merge delta, so the 0331945e G8 list baseline still applies (`check:visual-scope` green).
- **axe 4.13:** 0 critical, 0 serious on the board (light, dark, 390 px) and the list; only the moderate page-shell `region` and `landmark-one-main`. Screenshots: `728-7dc2-screen-*.png`.

## Findings (all non-blocking)
- N1: `pendingFocus` is set before `runMove`. If the move is skipped (another write is in flight) or fails with an unchanged refetch (so `workItems` keeps its reference and the effect does not run), the stale target stays set and could pull focus to that card's Change state button on a later data update (for example the 30 s poll). I did not observe a steal in the failure probe, but the window exists. The same pattern already exists for rank. Cheap fix: clear `pendingFocus` in a `finally` after `runMove` when the result is an error or undefined.
- B4 to B6 from the first round are unchanged (decision-log note on the 404 adaptation, board inventory row and baseline in a follow-up, minor visual items).

## Not checked
Pinned-image G8 regeneration, a real API, screen readers, other browsers, and #722's own screens beyond the merge not dropping its keys.

**Verdict:** APPROVE
<!-- END REPORT (sha256 bee45800a1aabe98979bf8ee798bddfd090c642e2eb4e9c367e8bce00fae43c5) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/728-security-opus.md; Claude Opus 5.5; sha256 0e80fa2922b97c5953f0c5a8fc44f2bf28fb4ae18d10f34bc686519c2c2908c7) -->
# PR #728 security review: work-item board, rank and bulk assign (#512 successor 3/4)

**Reviewed head:** 7dc214b074c058811e4e3babb5d25b3b927b7bb4
**Base:** origin/main aefb6888f3d45ad3439c69133ac644f738a70a4a (`git merge-base HEAD aefb6888` = aefb6888, so the base is the merge base)
**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). This is an independent context. It did not author, direct or remediate the PR.
**Depth:** lightweight but genuine. The PR is security-scope only because of the `apps/web/e2e/**` snapshot path. Otherwise it is web only.
**Date:** 2026-10-14

## Head verification

- `gh pr view 728 --json headRefOid` returned 7dc214b074c058811e4e3babb5d25b3b927b7bb4, and baseRefOid returned aefb6888f3d45ad3439c69133ac644f738a70a4a.
- I reviewed in a scratch detached worktree at the exact head. I did not touch the main checkout or any other worktree. The scratch worktree was removed afterwards.
- The changed files are 49 in total: web components, fetchers, hooks, routes and tests, plus `i18n/*`, `packages/ui/src/styles/pairs.json` and one e2e PNG. There are no `apps/api/**`, migration, CI or dependency changes.

## Surfaces examined

- `apps/web/e2e/visual.spec.ts-snapshots/work-item-list-linux.png`, the image and its PNG chunks.
- G8 evidence in `512s3-linux-baseline-v11-d6782600/`: `host-steps.tsv`, `container-steps.tsv`, `cleanup-summary.txt`, the container, volume and image diffs, `missing-preexisting-image-ids.txt`, `copyback-hashes*.sha256`, `target-snapshot-hashes.sha256`, the changed, new and removed snapshot path lists, the pre- and post-update summaries, `params.env` and `local-image-inspect.json`.
- Fetchers: `get-project-states.ts`, `bulk-assign-work-items.ts`, `rank-work-item.ts`, `get-work-items.ts` (diff), and the existing `get-assignable-people.ts` and `transition-work-item.ts` as called.
- Hooks: `use-get-project-states.ts`, `use-get-board-work-items.ts`, `use-get-work-items.ts` (diff), `use-get-assignable-people.ts` and `use-workspace-permission.ts`.
- Components and routes: `work-item-board.tsx`, `bulk-assign-toolbar.tsx`, `work-item-list.tsx`, `work-items-panel.tsx`, `routes/.../projects/$projectKey/work.tsx` and `lib/routes.ts`.
- API at this head, read only:
  - `apps/api/src/project/index.ts`: `listProjectStatesRoute`.
  - `apps/api/src/work-item/index.ts`: list, assignable, rank, bulk, transition and transitions routes, and the bulk handler.
  - `work-item/controllers/bulk-work-items.ts` and `assign-work-item.ts`.
  - `capabilities/capability-checks.ts` and `response.ts`.
- PR #712 (open, head ef1780c1): its file list and body, to establish what it covers.

## Commands and results

| Command | Result |
| --- | --- |
| `gh pr view 728 --json headRefOid,baseRefOid,files` | Head and base as stated. 49 files. |
| `git diff --name-only aefb6888...HEAD -- apps/web/e2e` | Only `apps/web/e2e/visual.spec.ts-snapshots/work-item-list-linux.png` |
| `shasum -a 256` on the committed PNG | `fff9a8b3af4436380a3a842713877ee740912a065d19026435d3b26fda0d63de` |
| `copyback-hashes.sha256`, `copyback-hashes-worktree.sha256`, `target-snapshot-hashes.sha256` | All three record `fff9a8b3…0d63de` for that path. **Match.** |
| `host-steps.tsv` | 13 steps, all exit 0 |
| `container-steps.tsv` | 20 steps, all exit 0. These include `visual_update_one_snapshot`, `visual_post_update_all_pass` and `visual_scope_guard_after_generation`. |
| `cleanup-summary.txt` | container-diff 0 bytes, volume-diff 0 bytes, image-diff 0 bytes, missing-images 0 |
| pre/post visual summaries | Before: 18/19 passed, and the failing set equals the expected one (`work-item list screen @visual`). After: 19/19 passed. Changed paths are exactly the one PNG. No new or removed snapshots. |
| `local-image-inspect.json` | `mcr.microsoft.com/playwright:v1.63.0-noble` at digest `sha256:bc6ab0d6…c054c7`, the pinned-image machinery (v11 runner) |
| PNG chunk walk (`python3 -I`) | IHDR, IDAT×8, IEND only. No tEXt, iTXt, zTXt or eXIf metadata. |
| Visual inspection of the PNG | 1280×720 fixture screen: "Help Desk · Work items", the List/Board toggle, one fixture row (HELP-7, "Customer cannot reset their password", Unassigned) and the realtime-unavailable banner. **Nothing sensitive.** |
| `pnpm install --frozen-lockfile --prefer-offline` | ok |
| `pnpm turbo run build --filter='@taskdesk/web^...'` | 4/4 successful |
| `pnpm --filter @taskdesk/web build` (agent and portal) | exit 0 |
| `pnpm check:bundle-purity` | exit 0. Output: "G12 portal bundle graph is clean (1 entry, static and dynamic imports checked)." |
| `grep` of `dist/portal` for `work-item-board`, `bulk-assign`, `work-items/bulk`, `bulkAssign`, `rankWorkItem` | No hits. The board and bulk chunks are present only in `dist/agent`. |
| `gitleaks git --log-opts=aefb6888..7dc214b0 --redact` (8.30.1) | 4 non-merge commits scanned, no leaks found |
| `gitleaks stdin --redact < (git diff aefb6888...7dc214b0)` | 231,526 bytes scanned, no leaks found |
| Diff grep for `dangerouslySetInnerHTML`, `innerHTML`, `localStorage`, `sessionStorage`, `window.open`, `eval(`, `postMessage`, `credentials`, `Authorization`, raw `fetch(` | No hits. The only hit was `href={routes.workItemDetail.build(...)}`, which goes through the encoded route builder. |

## Answers

### 1. The e2e path

- The PNG is the only file under `apps/web/e2e/**`.
- It came from the pinned Playwright image through the v11 machinery. Every host and container step exited 0. The cleanup summary shows no container, volume or image diff, and no pre-existing image is missing.
- The committed sha256 equals the recorded copy-back and target hashes.
- The image is a fixture screen with no metadata chunks, and it contains nothing sensitive.
- Note: the capture ran at candidate `d6782600`. Commits `f38a6a0d`, `5c599046` and the main merge `7dc214b0` came after it, and the PNG was not recaptured. This is a G8 correctness question for the CI visual job, not a security one. See Residual risk.

### 2. No UI-only security

- **Rank.** `POST /work-items/{key}/rank` runs `requireWorkItemReach()` and `requireWorkspaceCapability("work_item:rank")`. The server validates `beforeId` and `afterId` against the same project and state.
- **Transition.** `POST /work-items/{key}/transition` runs `requireWorkItemReach()` and `work_item:transition`. Legality comes from `GET .../transitions`, and the UI never computes it.
- **Bulk assign.** The handler calls `validateWorkspaceAccess` and then `assertCallerHasCapability(workspaceId, …, "work_item:assign")`. For each item, `assignWorkItem` re-filters on `workspaceId`, skips archived or deleted items and projects, and checks that the assignee is on the item's project roster. Per-item failures are returned rather than trusted from the client.
- **What the fetchers send.** All use the shared `@taskdesk/libs` Hono client, which carries the session cookie.
  - Rank sends `{beforeId?, afterId?}`.
  - Bulk sends `{workspaceId, workItemKeys, assigneeId, operation:"assign"}`.
  - There are no capability or role claims in any body.
  - `workspaceId` comes from `project.workspaceId`. The server re-checks membership and capability in that workspace, and the per-item workspace filter is a load-bearing invariant that is documented in the handler.
- **Capability gates.**
  - `canTransitionTasks()` returns `can.transitionTasks === true` and `canRankTasks()` returns `can.rankTasks === true`. Both read strict `/api/capabilities` flags, and both fail closed when a key is absent.
  - `canAssignTasks()` maps to `assignTasks`, which is `{ work_item: ["assign"] }` server-side, the same capability the bulk route enforces.
  - None of these are inferred from `updateTasks`.
  - Every gate is also and-ed with `!isCheckingPermissions`.

### 3. Leakage

- **Project states.** `GET /projects/{projectId}/states` runs `workspaceAccess.fromProject(…, { requireProjectReach: true })` and the strict `project:read`. An out-of-reach project returns 404.
- **Work items.** `GET /projects/{projectId}/work-items` (used for both list and board, with cursor and limit=200) runs `workspaceAccess.fromProject(…, { requireProjectReach: true })`. The new `cursor` and `limit` params only page within that project.
- **Assignable people.** `GET /projects/{projectId}/assignable` runs `fromProject` with `requireProjectReach: true`. The server filters the result:
  - a caller with `work_item:assign` gets the active project roster;
  - a caller with reach only gets themselves;
  - anyone else gets an empty list.
  So the bulk-assign people list is **project-scoped**, and the client never widens it.
- **Query keys.** These are keyed by `projectId` (`["projects", id, "states" | "assignable"]` and `["work-items", id, "board", …]`), so the cache does not mix data across projects.

### 4. Portal bundle purity

The build passes. The G12 check (`check-bundle-purity.mjs`) is clean. No board or bulk code or endpoint string appears in `dist/portal`.

### 5. Secrets

gitleaks reported no leaks, in both commit mode and diff mode.

## Findings

**Blocking:** none.

**Non-blocking:**

- **N1 (pre-existing server gap, not introduced here; tracked by #712).**
  - At this head, the bulk route (`middleware: []`) and `assignWorkItem` check workspace membership, capability, item liveness and assignee roster.
  - They do **not** check the actor's *project reach* for each item.
  - Rank and transition use `requireWorkItemReach()` without `requireProjectReach: true`.
  - So a workspace member who holds `work_item:assign`, `rank` or `transition`, but has no reach to a restricted project, could act on an item there by key through the raw API.
  - #728 adds no new API surface. It calls only existing routes, and its UI only offers keys the caller already listed under reach-gated routes. It does not widen this gap.
  - Open PR #712 (head ef1780c1) explicitly adds `work-item/bulk-reach.ts`, per-item reach for bulk, and changes to `rank-work-item.ts` and `require-work-item-reach.ts`.
  - The rollout risk is that #728 makes these routes easier to discover. It does not create the exposure. Recommendation: land #712 promptly. It does not need to block #728.
- **N2 (UI only, no security impact).**
  - The bulk-result UI shows server-supplied `failure.reason` strings verbatim, except "not found", which it maps to a localized "gone" message.
  - They are rendered as React text, so there is no XSS.
  - Server reasons are fixed messages, and "not found" and "out of reach" are deliberately merged (`WI-25`), so this does not reveal whether an item exists.

## Residual risk / not checked

- I did not run Docker or re-capture the PNG. Integrity rests on the evidence hashes, which match the committed blob, and on the step logs. The capture was at `d6782600`, before later web commits (`f38a6a0d`, `5c599046`) and the main merge. The G8 CI job at head was still `in_progress` when I reviewed (CI - full run 38485342190), so whether the snapshot is still valid at head depends on that job.
- I did not run the web unit or component suites, or API integration tests. I relied on two Sonnet APPROVE reports at this head: `512s3-7dc2-ordinary-delta-a-sonnet.md` and `728-7dc2-ordinary-delta-b-sonnet.md`.
- I did not exhaustively review `pairs.json` or the i18n strings beyond the gitleaks pass and the diff grep.
- Server-side reach for rank, transition and bulk is complete only once #712 merges (N1).
- I did not check how API keys behave with the board. The board is session-only UI.

**Verdict:** CLEAR
<!-- END REPORT (sha256 0e80fa2922b97c5953f0c5a8fc44f2bf28fb4ae18d10f34bc686519c2c2908c7) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/728-ab64-security-rebind-opus.md; Claude Opus 5.5; sha256 19855c5b10ce419064d7bd11169b8ed9a2d4b656aa2052e7c8e94fd559e11821) -->
# PR #728 — security exact-head rebind (mechanical merge of main #712)

**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). This is a fresh, independent context. I did not author, direct or remediate #728 or #712. The prior CLEAR was by a separate Opus reviewer: `728-security-opus.md`.
**Reviewed head:** ab6483c9ce86517f5b641e6b236e164778415a80
**Prior CLEAR head:** 7dc214b074c058811e4e3babb5d25b3b927b7bb4
**Main merged in:** f0f85e865898280421a48520c33dab935483b508 (merge of #712)
**Method:** read-only. A blobless bare clone in the scratchpad. No tests were run.

## Commands and outputs
```
$ git ls-remote origin refs/heads/main refs/pull/728/head   (at the start and again at the end)
f0f85e865898280421a48520c33dab935483b508 refs/heads/main
ab6483c9ce86517f5b641e6b236e164778415a80 refs/pull/728/head
$ git rev-list --parents -n1 ab6483c9 -> ab6483c9... 7dc214b074c058811e4e3babb5d25b3b927b7bb4 f0f85e865898280421a48520c33dab935483b508
$ git rev-parse ab6483c9^{tree}                  -> 02004f41fe0bc36b26676e77bc2497fa317fff9a
$ git merge-tree --write-tree 7dc214b0 f0f85e86 -> 02004f41fe0bc36b26676e77bc2497fa317fff9a  (identical)
$ git merge-base 7dc214b0 f0f85e86 -> aefb6888
$ git diff --name-only 7dc214b0 ab6483c9  vs  git diff --name-only aefb6888 f0f85e86 -> 69 files, IDENTICAL
$ comm -12 (#728 own files: f0f85e86...ab6483c9) (#712 delta) -> empty
```
#728's own files are all web: components, fetchers, hooks, routes, i18n, `pairs.json` and one visual snapshot.

## Interaction review: N1 of the prior report is closed in the combined tree
1. **Rank, assign, unassign and transition.**
   - `apps/api/src/work-item/index.ts`:
     - `POST /work-items/{key}/rank` (line 594)
     - `POST` and `DELETE /work-items/{key}/assign` (lines 527 and 826)
     - `POST /work-items/{key}/transition` (line 868)

     each use `requireWorkItemReach("key", { deferApiKeyCapability: true })`.
   - In `require-work-item-reach.ts`, `projectReach = options.requireProjectReach !== false` (line 96). PROJECT reach is therefore the default, and none of these routes opts out. An unreachable item answers 404, the same answer a missing one gets.
2. **Bulk.**
   - `POST /work-items/bulk` keeps `middleware: []`.
   - The handler builds `workItemBulkAuthoriser(...)` (index.ts:1426, `bulk-reach.ts`) from `callerReach`.
   - `bulk-work-items.ts` calls `authorise(key)` for each item before `runOne`. `not_found` gives the item failure "Work item not found", and `forbidden` gives "Insufficient permissions". Unreachable and missing items share one reason (WI-25).
3. **Guard.** These routes are in the `work_item`/`reach: required` set that `tests/permissions/work-item-reach-guard.test.ts` enforces. #728 changes no API, policy or guard file.

## #728's web handling of the new 404s is already in place
- **Board** (`work-item-board.tsx`).
  - Both the rank/move path and `transitionFromSelect` catch errors, `await refreshBoard()` (a refetch), then set an error notice.
  - The notice renders as `<Alert variant="error" role="alert" data-testid="work-item-board-error">`.
  - `classifyWorkItemWriteError` (`lib/work-item-board.ts`) maps 404 to `"gone"` by status alone, not by message text.
- **Bulk** (`bulk-assign-toolbar.tsx`).
  - `onAssigned` receives only the keys the server confirmed, so failed items, including "not found" from per-item reach, stay selected.
  - A whole-request refusal (400/403/404/409/422) keeps the entire selection.
  - "not found" failure reasons are mapped to the localized "gone" text.
- No web change is required by the combined tree.

## CI (observed)
- `pull request template + security review` was FAILURE. I expect it to clear once a note recording this head is committed.
- 14 other checks were still running when I checked.

## Findings
- Blocking: none.
- N1 from `728-security-opus.md` is resolved by #712 in the combined tree.

## Residual risk / not checked
- No tests were run, by instruction. Hosted CI at ab6483c9 is the gate.
- I did not re-review #728's own web semantics, which were CLEARed at 7dc214b0.

**Verdict:** CLEAR
<!-- END REPORT (sha256 19855c5b10ce419064d7bd11169b8ed9a2d4b656aa2052e7c8e94fd559e11821) -->
