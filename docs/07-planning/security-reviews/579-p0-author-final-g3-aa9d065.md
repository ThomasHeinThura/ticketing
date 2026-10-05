# P0 final G3 author evidence — aa9d065 composition

This note records the final contrast-inventory alignment and scoped verification on the composed source. It is author evidence, not independent review or phase clearance.

## Source and change

- Composed baseline: `aa9d065689c5ea730db1ab504201119fffd4fa0d`.
- Author change: `packages/ui/src/styles/pairs.json`, pair 6 (`sidebar-accent-foreground` / sidebar). The composed JSX moved the direct DragOverlay occurrence into `apps/web/src/components/nav-projects-sortable.tsx`; the source-grounded occurrence records now match all four live occurrences and caller surfaces. Pair colors, thresholds, closed-record schema, occurrence detail, and ordered unique summary behavior remain unchanged.
- Pair manifest SHA-256: `ef1f69a6a94789ed5051a18e211ecf5b0f70bf6d684dc86275e3516c453d5ec8`.
- Pair-only diff SHA-256: `7a900bbce660ff2333387ed3d08fc71dff9c630cfd00c524653255a109aabae1`.
- Final contrast scan: 228 declared pairs passed against light and dark built CSS.

## Verification

- `pnpm check:tokens`: passed, including token and source-grounded contrast checks and agent/portal builds.
- Built manifest SHA-256: agent `f82e099338f4521de2c17d14d921ea5d3bae83c93c064d1c7d20b89e7f348ebc`; portal `06f3b04506b2a1d9fd6e81147e17d275e7317a8d9d4be8a41a1750e548f3a2fe`.
- Scoped Playwright: 6/6 passed across four specs: create dialog lifecycle/loading/reload recovery; board status/assignee writes, create focus restoration and keyboard drag; mutation version freshness; 500-row list geometry, terminal-row keyboard reachability and 200% zoom.
- The 500-row probe preserved table height at 21,552 px before and after the intrinsic-size probe; `WLP-500` remained visible and keyboard focused. At 200% zoom the first/last rows measured 86/85 px and table height 43,104 px.
- Captured screens: `apps/web/test-results/work-item-create-dialog-wo-3f99c-s-independently-of-the-list/create-work-item-dialog.png`, `apps/web/test-results/task-properties-version-fr-8fa03--an-open-start-date-control/fresh-start-date.png`, and `apps/web/test-results/work-item-list-layout-all--ac108-y-and-keyboard-reachability/work-item-list-content-visible-last-row.png`.

Private full-output logs (2026-10-05):

- `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-final-g3-aa9d065/check-tokens-final.log`
- `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-final-g3-aa9d065/scoped-browser-final.log`
- `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-final-g3-aa9d065/check-tokens-integrated.log` — initial build attempt failed because workspace symlinks resolved `@taskdesk/ui` into an unrelated reviewer checkout; after `pnpm install --frozen-lockfile --offline`, all workspace links resolved to this root source and the integrated check passed. No tracked dependency or lockfile change.
- `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-final-g3-aa9d065/workspace-link-refresh.log`

No canonical performance rerun or performance claim is made here.
