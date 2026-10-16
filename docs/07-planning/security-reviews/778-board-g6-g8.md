# PR #778 security review record: board G6 states and G8 baseline (#729)

PR #778 closes #729. The board's four G6 states are covered by tests, an unavailable title or priority shows 'Unavailable', and the pending focus target clears on a no-op or failed move. A @visual case and its Linux baseline were captured with the pinned-image machinery; the baseline uses synthetic data only. apps/web/e2e/** is security-scope.

A Claude Sonnet 5.5 lane implemented the change; the conductor captured the baseline. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: REQUEST CHANGES at 2934d64c (two focus tests that could not fail); APPROVE at c982e78f.
- Ordinary review D by Claude Sonnet 5.5: APPROVE at 2934d64c and at the delta c982e78f.
- Security review by Claude Opus 5.5: CLEAR at c982e78f (no security-relevant change; the baseline shows synthetic data only).

**Reviewed head:** `c982e78f2eadd8cd75c5e6123d9c21a784d05b30`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `778-ordinary-a-sonnet.md` | Ordinary review A (main..c982e78f) | Claude Sonnet 5.5 | `c982e78f` | APPROVE | `ef29622c1b406ea2f8b8d2751ded821186ed995a700de634ef1528c100b24359` |
| 2 | `778-ordinary-d-sonnet.md` | Ordinary review D (main..c982e78f) | Claude Sonnet 5.5 | `c982e78f` | APPROVE | `8fc53da8b46000204531e46e001ed945e268baafbfdaa9a3b9764c1ac797acb0` |
| 3 | `778-security-opus.md` | Security review (main..c982e78f) | Claude Opus 5.5 | `c982e78f` | CLEAR | `9698ac1dbbce67e37dcc459ff6d83d1a87c21686e41964d3da55cbbea3c91923` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/778-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 ef29622c1b406ea2f8b8d2751ded821186ed995a700de634ef1528c100b24359) -->
# PR #778 ordinary review A (#729 board G6/G8: states, focus target, Linux baseline, inventory)

**Reviewed head:** 2934d64cbf45ac2ca70c8ced0f9ac20c440ac0df
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed with `gh pr view 778` (branch codex/board-g6-g8-729). 7 files: work-item-board.tsx (+22/-1) and its test (+100), visual.spec.ts, visual-screens.json, the new Linux PNG, screen-inventory.md (board row to in-progress), views.md (+1 edge-case row). Scratch worktree removed afterwards.

## Source change
- `runMove`: new `catch` clears `pendingFocus` and rethrows; existing clear on error/no-op results stays. Correct and minimal.
- `BoardCard`: a failed `title` or `priority` now renders the existing "Unavailable" copy (`workItems:list.unavailable`) instead of a blank title or a wrong "No priority"; this matches the G6 "partial" state and the list's handling. Rendering path otherwise unchanged.
- Comment documenting the cross-column-drop rank limit plus the views.md edge-case row: wording is honest about the limitation (rank against loaded cards only; real fix needs server-side placement); no behaviour change.
- Inventory: "Work - board" from not-started to in-progress. Justified (works with rank/transition/bulk, but no table sibling, filter or baseline claim); `check:inventory` exit 0.

## G6 states and tests
Empty (3 columns each say so), loading (aria-busy skeleton, no columns), error (retry callback), partial (title and priority "Unavailable", no "No priority") all exist and are asserted. Populated is the normal render. The partial test is non-vacuous: removing the title branch or the priority branch each fails it.

## Focus-target clearing: test strength (finding)
Mutation results on `work-item-board.tsx` (each reverted, tree clean):
- Remove the clear on `result.kind === "error"`: 2 tests fail (the failed-move and failed-Change-state tests). Good.
- Remove the new `catch` that clears on a thrown write: 51/51 still pass (survives).
- Remove `|| result.text === ""` (the no-op clear): 51/51 still pass (survives).
Cause for the second: the test "a keyboard move that finds no neighbours (a no-op) leaves no focus target" asserts the move button is `toBeDisabled()`, so no move ever runs; the later "focus stays on WLP-4" assertion would hold with or without the clear. It does not exercise the no-op path it is named for. The first (throw) path has no test at all, since the failed-Change-state test makes the transition reject with an HttpError that the handler turns into an error result, not a throw.

## Baseline (G8)
- Provenance: evidence directory 729-linux-baseline-v11-d5425090 records a pinned Playwright image (`mcr.microsoft.com/playwright:v1.63.0-noble`, digest recorded), Node 24, frozen install, `visual_generate_new_snapshot` then `visual_rerun_target_without_update` (a second run against the generated file without update) both exit 0, `visual_scope_guard_after_generation` exit 0, only one new path (`work-item-board-linux.png`) changed, container and image diffs clean. The committed PNG's SHA-256 (00914d81...) equals the evidence copy-back hash. The generation candidate d5425090 is an ancestor of the PR head, and `git diff d5425090..2934d64c` is only the PNG, so the baseline was produced from the same source.
- Image content (viewed): 1280x720, dark theme, "Help Desk - Work items" header with List/Board/Create, the native amber banner "Live updates are unavailable. This page refreshes every 30 seconds while open.", three columns Backlog 0 / In progress 1 / Done 0, one card (HELP-7, High, Unassigned), empty-state text in the other columns. Fake data only.
- Is the banner acceptable? Yes, with a caveat. The fixture has no websocket, so the board legitimately shows its real degraded-realtime banner; the test deliberately waits for `realtime-unavailable` before the screenshot, making the render deterministic (maxDiffPixels 0, threshold 0, full raster). It is a real, designed UI state, not a harness artefact. Caveat: the baseline then pins the degraded state, so a future change to the banner copy or style will move this baseline, and the screenshot does not show the live-connected header. Acceptable for a first board baseline; a connected-state baseline can be added with a websocket stub later.
- `check:visual-scope` exit 0 (manifest entry, case and baseline all present). I did not re-run the pinned container (no Docker load per instructions); I relied on the evidence directory and verified hash and source equality.

## Commands (exact head, targeted)
- `vitest run` work-item-board test: 51 passed. work-item and agent route directories: 32 files, 299 tests passed.
- `turbo typecheck --filter=@taskdesk/web`: 5/5 successful. check:i18n, check:ui, check:inventory, check:visual-scope, check:skips: exit 0.

## Findings
Blocking:
1. The "no-op leaves no focus target" test is vacuous (button disabled, no move runs) and the new `catch` branch is untested; both mutations survive. Either make the no-op test actually trigger a move that returns the empty-text result (and assert focus is not stolen on a later refetch), add a test where the write promise throws a non-HttpError past the handler for the catch, or drop the claim for the paths not covered. The PR text and 729 notes claim these are tested.
Non-blocking:
2. Baseline pins the "Live updates unavailable" banner (acceptable, see above); consider a connected-state baseline later.
3. Single card in the baseline; no drag/overflow/column-scroll rendering is covered, consistent with the in-progress inventory status.

## Residual risk
Source change is small and correct; the risk is only that two of the focus-clearing paths are guarded by tests that cannot fail.

**Verdict:** REQUEST CHANGES

---
# Delta review (2934d64c -> c982e78f)

**Reviewed head:** c982e78f2eadd8cd75c5e6123d9c21a784d05b30
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Live head confirmed. Delta: one file, `work-item-board.test.tsx` (+84/-16); no source, baseline or doc change.
- The vacuous no-op test is replaced: `rankNeighbours` from `@/lib/work-item-board` is mocked (through `importOriginal`, only when a flag is set) to return `undefined`, so the Move down button is enabled, the click runs the move, it resolves as a no-op (`rankWorkItem` not called), and only then is a later refetch rerender used to prove focus is not stolen. The flag is reset in `finally`.
- New test for the throw path: `rankWorkItem` rejects with a 409 and `invalidateQueries` is spied to reject, so the task rejects past its own handling; the test captures the resulting unhandled rejection (listeners saved and restored), asserts the controls re-enable (guard released) and that a later refetch does not move focus.
- Verification (apps/web, targeted): board test file 52 passed. Mutations (each reverted, tree clean): remove the new `catch` that clears the focus target: 1 fails (the new throw-path test); remove `|| result.text === ""` (no-op clear): 1 fails (the rewritten no-op test); remove the error-result clear (line 167): 3 fail. All three previously-surviving or protected paths are now killed.
Findings: none new. (The unhandled-rejection capture manipulates `process` listeners; it is restored in `finally`, which is acceptable for a test of an escaped error.)

**Verdict:** APPROVE
<!-- END REPORT (sha256 ef29622c1b406ea2f8b8d2751ded821186ed995a700de634ef1528c100b24359) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/778-ordinary-d-sonnet.md; Claude Sonnet 5.5; sha256 8fc53da8b46000204531e46e001ed945e268baafbfdaa9a3b9764c1ac797acb0) -->
# #778 (#729) ordinary review D (architecture / UX)

**Reviewed head:** 2934d64cbf45ac2ca70c8ced0f9ac20c440ac0df
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** merge-base with origin/main (9297362b); 7 files: board component (+23/-5), board tests (+100), views.md note, screen-inventory row, visual spec/screens entry, linux baseline PNG.

## Commands
- `pnpm install --frozen-lockfile --prefer-offline`; `vitest run src/components/work-item/work-item-board src/components/work-item/work-item-board-view` (apps/web): 2 files, **58 tests passed**.
- Mutations (scratch, reverted): M1 remove the new `catch { pendingFocus = undefined; throw }` in `runMove`: **58 pass (survives)**. M2 remove the existing `result.kind === "error" || result.text === ""` focus clearing: 2 tests fail (killed).
- Playwright, visual and axe not run; read `visual.spec.ts` and `visual-screens.json` additions only. Baseline PNG not inspected.

## G6 four states
- Loading: skeleton with `aria-busy="true"` (`work-item-board-loading`), no columns. Empty: every column renders "No work items in this state." (3 columns asserted). Error: `Alert role="alert"` with a Retry that calls `onRetry`, board not rendered. Partial: a card whose `title` or `priority` failed validation renders the translated "Unavailable" instead of a blank or a misleading "No priority" (`BoardCard`, uses `item.unavailableFields`, the same mechanism as the list). All four are now exercised by named tests. Partial is card-field level only: the board has no list-level partial banner (`hasPartialFailure` is not surfaced) and State/Assignee flags from #715 are not rendered on cards; acceptable for G6's "render what you have", noted for follow-up.

## Focus management
- The new tests assert the right behaviour at the observable level: after a failed Change state, or a keyboard move that is a no-op, a later refetch that reorders cards does not pull focus away from where the user put it. The existing clearing in `runMove` (error result or empty text) is what makes those pass (M2 proves it).
- The new `catch` branch in `runMove` clears `pendingFocus` when a task throws past its own handling and rethrows. It is correct in intent, but **no test reaches it** (M1 survives): both tests reject inside the task's own try/catch, which returns an error result. Add a test where the task itself throws (for example a `rankWithin` throwing a non-HTTP error), or drop the branch. Also note the rethrow reaches `void runMove(...)` at the keyboard-rank call site as an unhandled rejection, as before; unchanged behaviour, not a regression.

## Cross-column drop note (views.md)
Accurate against the code: the neighbours (`before`/`after`) come from `itemsByState.get(target.id)`, the loaded pages of the target column, so with unloaded cards the drop is ranked among loaded cards only; the move itself (the transition) is already committed and the code comment says so. The new Edge-cases row states exactly that, the limit and that a true fix needs server-side placement by key. It is the right place (Edge cases table), uses the neutral tone of its neighbours, and the code comment points to it. No spec claim is overstated.

## Inventory row semantics
`Work - board` moves from not started to in progress, matching the legend ("in progress") and the list row, which is already in progress. It is not marked done, consistent with the P1 scope (table layout, saved-view layouts and the above limit remain). A board entry is added to `visual-screens.json` with inventory route, application route, test name and screenshot name in the same shape as the other entries, so the visual-scope check can map it.

## Findings
1. NON-BLOCKING: untested new branch in `runMove` (M1 survives), as above.
2. NON-BLOCKING: no axe/keyboard e2e for the board is added by this PR (only the visual baseline); the board's drag/keyboard paths are covered by unit tests but a board-specific `@a11y` check would make the inventory move stronger before the row goes further.
3. INFO: baseline image and visual spec were not executed or inspected by me.

## Verdict
No blocking findings.

**Verdict:** APPROVE

---

## Delta review: 2934d64c -> c982e78f (focus-clearing tests)

**Reviewed head:** c982e78f2eadd8cd75c5e6123d9c21a784d05b30
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Scope: one file, `work-item-board.test.tsx` (+84/-16); no product code changed (`git diff 2934d64c c982e78f --stat`). `vitest run src/components/work-item/work-item-board.test.tsx`: **52 passed**.

- **No-op path:** the test now mocks `rankNeighbours` to return `undefined` (the stale-column case the board's bounds checks make unreachable from the keyboard), so the "Move down" button is genuinely enabled, clicks it, waits for the guard to release, asserts nothing was written (`rankWorkItem` not called), then moves focus elsewhere and reorders cards through a rerender and asserts focus stays put. The previous version never ran a move at all (its button was disabled). Mutation: change the clearing condition to `result.kind === "error"` only (drop `result.text === ""`): **this test fails** (killed); the other tests are unaffected, so it is the only one guarding that clause. The mock is reset in `finally`, so it cannot leak into later tests.
- **Throw path:** the rank write rejects (409) and the handler's own `invalidateQueries` also rejects, so the task rejects instead of returning an error notice and control reaches `runMove`'s `catch`. The test captures the escaped rejection (asserts it is the "refresh failed" error, so the error is surfaced, not swallowed), asserts the busy guard is released (button enabled again), then reorders cards and asserts focus did not move. Mutation: delete the new `catch` block: **this test fails** (killed), where previously the same mutation survived (my first-review finding is closed). Control mutation: dropping only the `kind === "error"` clause fails the two existing error-path tests, not these two, so each path is guarded by its own test.
- Caveat (non-blocking): the throw-path test temporarily removes and restores Node's `unhandledRejection` listeners to observe the escape (needed because the handler uses `void runMove(...)`); it restores them in `finally`, so it should not affect other tests, but it is a process-global hack that a future runner upgrade could trip over.

**Verdict:** APPROVE
<!-- END REPORT (sha256 8fc53da8b46000204531e46e001ed945e268baafbfdaa9a3b9764c1ac797acb0) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/778-security-opus.md; Claude Opus 5.5; sha256 9698ac1dbbce67e37dcc459ff6d83d1a87c21686e41964d3da55cbbea3c91923) -->
# PR #778 (#729 board G6/G8) security review — board visual case and focus hardening

**Reviewed head:** c982e78f2eadd8cd75c5e6123d9c21a784d05b30
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context
**Comparison base:** merge base c35666c531c4b84c300bac5432fd4dc8dca3ed4f (origin/main at review time 9bb28099a69d1e599e1d7451ebdf6225e380546c; `git merge-tree` against main: clean)
**Role:** did not author, direct or remediate this change. Ordinary reviews A/D read as context only.

## Surfaces examined (all 7 changed files)
- `apps/web/e2e/visual.spec.ts` — new mocked `/api/projects/visual-project/states` fixture and `work-item board screen @visual` test (the security-scope path).
- `apps/web/e2e/visual-screens.json` — one inventory mapping row.
- `apps/web/e2e/visual.spec.ts-snapshots/work-item-board-linux.png` — viewed the image.
- `apps/web/src/components/work-item/work-item-board.tsx` — `catch` that clears `pendingFocus` on a thrown write; comment on ranking against loaded cards; card title/priority show the "unavailable" label when the server lists the field in `unavailableFields`.
- `work-item-board.test.tsx`, `docs/02-design/screen-inventory.md`, `docs/03-features/views.md`.

## Commands
- `pnpm install --frozen-lockfile --prefer-offline` — exit 0. `pnpm turbo typecheck` — exit 0.
- `vitest run src/components/work-item/work-item-board.test.tsx` (apps/web) — 1 file, 52 tests passed, exit 0.
- `pnpm check:visual-scope` — "20 screenshot cases, 19 active inventory route rows mapped", exit 0.
- Did not run Playwright visual locally (Linux baseline; CI renders it). PR checks at this head: 9 success, 13 not yet concluded at review time.

## Findings
- **No security-relevant change.** Web-only. No new network endpoint, no credential handling, no change to API calls, permissions or route guards. The focus change only clears a client-side focus target on failure and rethrows; the error path is unchanged otherwise.
- **Rank code does not change authorization.** Only a comment was added; the `canRank` gate and the rank/move writes are unchanged, and the server remains the authority for every move.
- **Field redaction display is a hardening.** When the server marks `title` or `priority` unavailable the card now shows the neutral label instead of whatever value is present; this cannot reveal more than before.
- **Baseline has no sensitive data.** The screenshot shows synthetic fixture content only (project "Help Desk", item HELP-7 with a generic title, three state names, the realtime-unavailable banner). The e2e fixture adds only synthetic state rows; no tokens, emails or real identifiers.

## Residual risk / not checked
- The visual diff itself was not re-rendered locally; CI is the authority for pixel equality.

**Verdict:** CLEAR
<!-- END REPORT (sha256 9698ac1dbbce67e37dcc459ff6d83d1a87c21686e41964d3da55cbbea3c91923) -->
