# P0 residual work route and board author evidence

Source checkpoint: 658e766732d3d285e0c9cb9a705ce1aefcab75ca
Base: 00d6175a4e0b61bbe149b5c530949bb96f7d0a48
Branch: codex/p0-lcp-board-00d
Worktree: /Users/heinthura/.codex/worktrees/p0-board-lcp-00d/Ticketing.v2

## Changes

- Work route loads its server-capability-gated create trigger as a separate component chunk. Project slug lookup, localized heading, capability source, action, and create dialog preload/click behavior are retained.
- Board cards combine selection/focus selectors into one shallow-compared store subscription per card. The selected/focused visual behavior and sortable props are unchanged.
- The delete confirmation is split from the task-card module and loaded only when requested; both Kanban and legacy list callers remain, with accessible localized suspense status.
- Updated one existing contrast occurrence chain to follow the confirmation component move. No ratio, category, token, or surface fields changed.

## Checks

- pnpm check:tokens: passed; both agent and portal builds succeeded; contrast gate reports 228 declared source-grounded pairs in light and dark.
- pnpm --filter @taskdesk/web typecheck: passed after building existing permissions/domain/email workspace outputs.
- Focused Vitest: work-item-create-trigger + task-card, 2 files / 7 tests passed.
- Biome on seven touched TypeScript files and git diff --check: passed.
- Production-preview browser: work-item create-dialog journey, 3/3; board keyboard context-menu/delete-cancel, 1/1; existing work-list/board interaction proof, 2/2 (500 rows/1,000 links and geometry/keyboard at 200% zoom; 200 cards and 50 drag writes).
- Scoped performance tests: work-list LCP median 2336ms (samples 2336, 3192, 2280; <2500ms); 200-card board render median 280.1ms (278.6, 280.8, 280.1; <500ms). The 3192ms LCP sample largest element was the visible realtime-outage message; the other samples largest element was the localized heading. No outage content was hidden or substituted.

## Limits

These are author checks on the exact source tree. They do not establish a controlled before/after causal comparison or current hosted G11 acceptance. Existing 500-row, 200-card, drag, keyboard, and permission fixtures/thresholds were not changed.

## Built manifest bytes retained from author worktree

- agent manifest SHA256: `f1a0c62606b7aecfc8b64b12b7f21725b2748b671367b01029e56f75b31e6c89`.
- portal manifest SHA256: `06f3b04506b2a1d9fd6e81147e17d275e7317a8d9d4be8a41a1750e548f3a2fe`.
