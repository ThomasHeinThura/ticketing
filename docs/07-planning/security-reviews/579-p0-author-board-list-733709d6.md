# Board, list, and LCP author evidence

- Source base: `b58c965426752f19a25d287bfb9000c678b0dd98`
- Branch: `codex/p0-board-list-lcp-structural-20261005`
- Worktree: `/Users/heinthura/.codex/worktrees/p0-board-list-lcp-structural-20261005/Ticketing.v2`
- Run time: 2026-10-05 02:08 UTC
- Scope: app-shell project navigation, work-item list and Kanban board selection/focus render paths.

## Changes

- `AppSidebar` loads `NavProjects` through a local React lazy boundary. Its temporary loading state uses the existing `SidebarGroup`, `SidebarMenu`, and `SidebarMenuSkeleton` primitives.
- `KanbanBoard` and `ListView` subscribe only to stable bulk-selection actions and obtain keyboard focus on shortcut activation. Each board card/list row selects its own selected/focused boolean from the store.
- `setAvailableTasks`, `setFocusedTask`, and `clearFocus` return the existing state for no-op updates, preserving order and focus behavior while avoiding redundant store notifications.

No row/card was removed, hidden, virtualized, or collapsed. No interaction threshold or test workload changed.

## Validation

- `pnpm --filter @taskdesk/web build:agent` — passed. The emitted manifest marks `src/components/nav-projects.tsx` as dynamic entry `assets/nav-projects-CM5o32K7.js`.
- `pnpm --filter @taskdesk/web typecheck` — passed after building existing workspace dependencies (`@taskdesk/permissions`, `@taskdesk/domain`, `@taskdesk/email`).
- Focused Vitest: 5 files, 11 tests passed (`task-card`, board column, list task row, bulk-selection store).
- Biome on all 11 changed files and `git diff --check` — passed.
- Playwright exact selector dry-list: 6 tests.
- Playwright scoped run: 6/6 passed, command:
  `pnpm --filter @taskdesk/web exec playwright test --config playwright.perf.config.ts e2e/performance.bench.ts --grep 'G11: (work-list render, 500 rows|work-list LCP|board render, 200 tasks|board drag p95 frame time|board context menu supports keyboard and delete cancel|500-row list remains reachable at 200% zoom)' --workers=1`
  - 500-row list render median: 187.5 ms (samples 252.1, 179.1, 187.5)
  - work-list LCP median: 2324 ms (samples 2328, 2324, 2320)
  - 200-card board render median: 280.7 ms (samples 280.7, 272.9, 291.3)
  - board drag p95: 16.8 ms in each sample
  - board context-menu keyboard and delete-cancel check: passed
  - 500-row list reachability at 200% zoom: passed

Screens opened by the scoped tests: `/agent/projects/WLP/work?layout=list` at normal and 200% zoom, and the seeded project board route for the 200-card render, drag, and keyboard context-menu checks. Playwright did not retain screenshots because the run passed.

## Limits

These are scoped local measurements on this built source. They are not the full canonical G11 suite, hosted acceptance, or a controlled before/after causal comparison. The LCP number meets the 2500 ms bound locally; the integrated hosted run remains authoritative. The list/board fixtures retained all 500 rows, 200 cards, and the existing drag write set.


## Diagnostic trace provenance correction

The hosted b58 diagnostic used for the initial LCP trace is the exact file at:
`/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-performance-takeover-500c491b/hosted-b58c9654-diagnostic/initial-page-profile.json`

- Real path: same as the path above.
- Profile file SHA-256: `d279b57c47cbf0f7ddd6e215fa5c5a0518ecf1a859a9392b9a39187c1794df45`.
- Embedded capture commit: `ece16acb2ed16a3a1462b0b6d91bcad5286b773e`; embedded selected-source digest: `a7142f5e98708395c33598f3d398707e50af96ee9730c83fde4d326c055eada7`; selected-source file count: 959; working-tree changes: none; manifest SHA-256: `cd7722b2107e54761ea225931b8931c4d56c77f8e4f8510e9b40e12119e52361`.
- Independently recomputed the diagnostic's selected-source hashing procedure against `b58c965426752f19a25d287bfb9000c678b0dd98`: 959 files and the same digest `a7142f5e98708395c33598f3d398707e50af96ee9730c83fde4d326c055eada7`. Thus the profile capture commit label differs, but the measured web/UI source set exactly matches b58.
- The observed initial work-list LCP entry in this profile is 2696 ms. It is evidence from the b58-aligned capture, not from the older 866 profile. The older file is separately located at `hosted-866438a6-diagnostic/initial-page-profile.json`, SHA-256 `947d927528551288ac81978c44a2c6b20b60267f68fa08a94c6379ecf081d041`; it records commit `f642f0a7d6058e0c523f729939053d335c76b4d3`, 956 selected files, and digest `b461e7ed7e0b879d8e32954124b8f0c14169242610fdf1e984f871c40cb43cd8`. It is a distinct older diagnostic and is not the b58 source attribution.
- The 733709d6 scoped performance run is separate evidence measured on that commit's built source; it is not a rerun of the hosted b58 diagnostic. No before/after causal equivalence is claimed.

- The same b58-aligned profile's `board navigation to all 200 cards rendered` window ran from 16.5 ms to 678.2 ms, i.e. 661.7 ms (rounded 662 ms). These two diagnostic observations, LCP 2696 ms and board 662 ms, both come from the b58 profile above. The separate hosted G11 assertion in `hosted-b58c9654-g11.log` records its board-render median as 629.0 ms; do not conflate those measurements.
