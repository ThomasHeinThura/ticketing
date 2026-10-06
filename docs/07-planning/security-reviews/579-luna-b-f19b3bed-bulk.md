# Independent web review — Luna B

**Verdict: CHANGES REQUESTED**

- **Reviewed head:** `f19b3bed6bc2e60d71906423b985fadb089da212`
- **Comparison base:** `8ddb9de8d4d242a0832f6f91e12872300480a905`
- **Independence:** Fresh GPT-6 Luna reviewer context. I did not author, direct, or fix this candidate. Historical review notes and the author’s evidence were treated as context, not as my verification.
- **Scope:** Web product delta for task detail/properties/editors, command-palette startup, board/card/DnD, list/query/realtime subscriptions, on-intent mounting, date formatting, route URL state, and associated UI tests. Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, SDLC/coding guidance, dated status and recent decision-log context, work-item/views/search specs, realtime contract, and UX quality gates.

## Checks performed

- Confirmed `HEAD` is the requested exact SHA; working tree was clean before and after review.
- Ran focused web Vitest: task-details sheet, task properties sidebar, kanban task card, native work-item realtime, date formatting, and route URL tests: **6 files / 22 tests passed**.
- Inspected the current DnD sensor/card event wiring and the tests that assert keyboard behavior. Inspected query keys and invalidation against the realtime spec, responsive property mounting, lazy detail mounting, editor save paths, date formatter cache keys, and authored browser evidence summaries in `status.md`.
- Did **not** run full web tests, builds, typecheck, G11, Docker/image proof, browser runs, API/PG checks, or broad CI. The dedicated actor’s current-source image/traffic proof was left undisturbed. I did not inspect private auth logs or print secrets.

## Blocking finding

### B1 — No regression assertion covers the required keyboard drag sequence

**Location:** `apps/web/src/components/kanban-board/index.tsx:180-191`; `apps/web/src/components/kanban-board/task-card.test.tsx:156-205`.

The changed board now supplies a default `KeyboardSensor`, while task-card tests cover only Enter/open, selection, and keyboard context-menu keys. There is no board-level assertion for Space lift, arrow movement, Space drop, Escape cancellation, or live-region announcements. Repository search also found no E2E test exercising keyboard board drag. This candidate restructures sortable card rendering and moves the card’s sortable listeners onto an outer wrapper while the keyboard-focusable role/tabIndex attributes are on the nested card, so the missing coverage leaves the interaction seam itself unverified.

**Contract:** `docs/03-features/views.md` `VW-14` requires focus-card → Space lift → arrows → Space drop, Escape cancel, and live-region announcements; its Testing section explicitly requires keyboard-only board drag E2E. The general component checks in SDLC also require keyboard-operability tests. Author browser smoke evidence verifies property selections and visible card 200, but does not claim this sequence.

**Reproduction/evidence:** `rg -n 'keyboard.*drag|Space.*(lift|drop)|Arrow.*move|Escape.*cancel|live region|drag.*keyboard' apps/web/src apps/web/e2e tests docs/03-features/views.md` returns the contract text only. The focused `task-card.test.tsx` suite verifies Shift+F10 and ContextMenu-key behavior, not sortable keyboard operation; the DnD sensor is configured at `index.tsx:190`.

**Requested resolution:** Add a real board interaction regression test that exercises the full required keyboard sequence through the actual DnD context/card wiring and asserts its accessible announcements, including Escape cancellation. Keep browser proof distinct from authored control-click smoke evidence. This finding is about an unverified required interaction; I did not infer that the default dnd-kit sensor is itself defective.

## Non-blocking findings

None.

## Disposition

The selected focused tests pass, and inspection did not identify a separate source correctness defect in the reviewed query invalidation, member lookup, date locale cache, or responsive property-control mechanisms. I cannot clear the board interaction obligation without the specific keyboard DnD regression proof above. No future hosted timing, clean-date, cutover, or phase-finalizer proof was treated as a code blocker.
