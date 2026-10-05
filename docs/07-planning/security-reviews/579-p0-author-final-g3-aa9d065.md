# P0 author evidence — final G3 alignment

## Source and scope

- Composed base: `1357a920b01afd9a1ffaf9abf238dea41eb173a3`.
- Tested snapshot: that base plus the three owned files below; source diff SHA-256 `2b49809fa036e9ffa841d5a245b289ea19fa2530b86bffbeeaf9df4f3d721f08`.
- Owned changes: `scripts/ci/check-contrast.mjs`, `scripts/ci/check-contrast.test.mjs`, and `packages/ui/src/styles/pairs.json`.
- No application behavior, palette values, contrast thresholds, or pair-closure rules changed.

The composed `AppSidebar` lazy-loads `NavProjects` through a named-export adapter (`import(...).then(module => ({ default: module.NavProjects }))`). The scanner now binds only that explicit mapping to its actual implementation and caller ancestry; a regression also verifies that an unsupported extra export mapping remains unresolved. Contrast occurrence records for entries 19 and 25 were refreshed from current source observations, retaining every actual occurrence and first-seen unique ID ordering.

## Verification

- Preserved initial G3 failure: source-context scan reported stale occurrence bindings for entries 1, 6, 19, 25, and 85 plus six unresolved `NavProjects` foreground contexts. Raw log: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-final-g3-1357/contrast-initial.log`.
- Final contrast tests: 50 passed, 0 failed (`node --test scripts/ci/check-contrast.test.mjs`).
- `pnpm check:tokens`: passed; both agent and portal builds completed; 228 declared source-grounded pairs passed in built light and dark CSS.
- Agent manifest SHA-256: `620b8c975d1560aad3a81e64fd9841b3216c5ebf390fca34cef2a4c959738cd0`.
- Portal manifest SHA-256: `06f3b04506b2a1d9fd6e81147e17d275e7317a8d9d4be8a41a1750e548f3a2fe`.
- Web typecheck: passed. Focused optimistic mutation suite: 14 passed.
- Scoped Playwright: 6 passed. Evidence log: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-final-g3-1357/scoped-browser.log`.

## Screens exercised

- `/dashboard/workspace/{workspaceId}/project/{projectId}/task/legacy-task-1`, 1280×900: edit description, open start-date control, select a date, and verify the latest full-task version/If-Match write. Screenshot: `apps/web/test-results/task-properties-version-fr-8fa03--an-open-start-date-control/fresh-start-date.png`.
- Task properties and 200-card board, 1280×900 and 390×844: change status and assignee, open/close keyboard help, open/close the board create dialog, and exercise keyboard drag cancel/drop with the expected full-task write.
- `/agent/projects/WLP/work?layout=list`, 1280×720: open/close/reopen the create dialog with list/wrapper/form loading independently, test failed intent preload recovery, then verify all 500 rows, 1,000 links, last-row keyboard reachability, stable geometry, and 200% zoom. Screenshots: `apps/web/test-results/work-item-create-dialog-wo-3f99c-s-independently-of-the-list/create-work-item-dialog.png` and `apps/web/test-results/work-item-list-layout-all--ac108-y-and-keyboard-reachability/work-item-list-content-visible-last-row.png`.

The separate hosted performance acceptance run was not repeated for this scanner/manifest alignment. All evidence logs are retained in the private evidence directory above; they are diagnostic records, not independent review or stage-clearance claims.
