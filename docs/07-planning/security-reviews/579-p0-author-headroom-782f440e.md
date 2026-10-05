# P0 headroom author evidence — 782f440e

- **Source commit:** `782f440ebd17638874e570aacf5677eed196e9eb`
- **Branch:** `codex/p0-list-board-render-final-20261005-866438a6`
- **Worktree:** `/Users/heinthura/.codex/worktrees/p0-headroom-866/Ticketing.v2`
- **Parent source:** `866438a6a1c2f3fd422bf1b2ff61911ba4f44621`
- **Evidence timestamp:** 2026-10-05 (local task environment)

## Preserved hosted failure and source attribution

The original hosted G11 failure is retained at:

`/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-performance-takeover-500c491b/hosted-866438a6-g11.log`

Reported result: **20/22**. Board render **640.1/500 ms** and initial LCP **2608/2500 ms** failed; list **490.3/500 ms**, state **195.1/200 ms**, assignment **168/200 ms** passed. Workload and budgets were unchanged. No post-change G11 result or performance acceptance is claimed by this source checkpoint.

The downloaded profile JSON is:

`/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-performance-takeover-500c491b/hosted-866438a6-diagnostic/initial-page-profile.json`

Its embedded commit label was `f642f0a7d6058e0c523f729939053d335c76b4d3`, a merge commit whose first parent is `866438a6a1c2f3fd422bf1b2ff61911ba4f44621`. Git verification showed the two commits have the same tree object (`40b1ec26bf6b7af3de76b220c01e0d6ac1eec41f`) and `git diff f642f0a7 866438a6` is empty. The aligned profile identified Base UI ScrollArea and project-navigation modules in the shared shell; its board window sampled the ScrollArea chunk at about 18.7 ms. This is a measured source target, not a claim that the shell change alone resolves the board's 140 ms overage.

## Changes in this checkpoint

- App `SidebarContent` uses an opt-in native overflow path. The default enhanced ScrollArea behavior remains available and is lazy-loaded.
- Project reorder DnD is extracted to a dynamic child. It mounts only when the existing server-derived `project:update` capability allows reordering. Static project links remain visible while the module loads and for users without that capability. Drag cancellation cleanup, overlay, vertical-only movement, and existing reorder mutation are preserved.
- The board's existing create-task dialog is loaded only after a column's create action. The selected column status is passed through; close still resets the host and restores focus to the initiating button on the next animation frame. No dialog implementation/form, API, permission, budget, or workload was changed.

## Verification

- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/components/nav-projects.test.tsx src/components/kanban-board/create-task-dialog.test.tsx src/components/kanban-board/column/column-header.test.tsx`: **3 files, 5 tests passed**.
- `pnpm --filter @taskdesk/ui exec vitest run --config vitest.config.ts src/components/sidebar.test.tsx`: **1 file, 5 tests passed**.
- `pnpm exec turbo run typecheck --filter=@taskdesk/web...`: **9/9 tasks passed**.
- `pnpm exec biome check` on the 10 changed source/test/story files and `git diff --check`: passed.
- `pnpm --filter @taskdesk/web build:agent`: passed. The generated manifest at `/Users/heinthura/.codex/worktrees/p0-headroom-866/Ticketing.v2/apps/web/dist/agent/.vite/manifest.json` shows `nav-projects-sortable` as a dynamic import from the layout chunk, ScrollArea as a dynamic import from the sidebar chunk, and CreateTaskModal as a dynamic import from the board route. This verifies the eager-graph split only; it is not a browser result.

## Limits

No post-change G11 timing, browser interaction, container/image, or hosted CI proof was run for this checkpoint. Parent-owned serial composition and its integrated browser/performance checks remain necessary. All 500 list rows, all 200 board cards, the 100-write drag workload, permission semantics, keyboard behavior, and thresholds were not reduced or redefined in this change. The existing list-render timing passed on the pre-change hosted source; this checkpoint makes no new list or board timing claim.
