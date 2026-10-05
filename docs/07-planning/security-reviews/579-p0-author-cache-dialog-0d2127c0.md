# P0 author evidence: cache reconciliation and create dialog

## Source

- Author checkpoint: `0d2127c0861cacb495261c70654553d91bb9cad1`
- Branch: `codex/p0-performance-structural-finish-20261005`
- Parent: `866438a6a1c2f3fd422bf1b2ff61911ba4f44621`
- Scope: overlapping legacy task status/assignee optimistic writes and create-dialog header ownership.
- No endpoint, workload, timeout, performance budget, dependency, or test-coverage changes.

## Changes

- Added a per-query-client, per-task-field pending-write ledger. Successful writes advance the confirmed field value by mutation version; failed writes reveal the newest remaining pending value or the last confirmed value. Cache updates patch only the field(s), preserving the latest full task and unrelated fields.
- Updated the status and assignee mutation hooks to use the shared reconciliation path. Network requests and invalidation behavior remain in place.
- Added regressions for overlapping status writes failing in both settlement orders, older success followed by newer failure, and overlapping assignee writes failing in reverse order. The all-failure case verifies the inactive task cache returns to its confirmed status without relying on an inactive-query refetch, while retaining newer task metadata and version.
- Removed the lazy form's duplicate dialog title and description; the route-owned dialog shell remains the single accessible owner. Added an exact-one title/description browser assertion after form load.
- Applied the required Biome formatting to the existing create-dialog E2E spec.

## Verification on this source

All commands ran against the source tree represented by the author checkpoint before commit; the resulting committed tree is identical.

- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/components/work-item/create-work-item-dialog.test.tsx src/hooks/mutations/task/use-update-task-optimistic.test.tsx` — 2 files, 21 tests passed.
- `pnpm --filter @taskdesk/web typecheck` — passed.
- `pnpm exec biome ci --diagnostic-level=error` on the six changed source/test files — passed.
- `pnpm check:tokens` — passed; production agent and portal builds completed, and all 228 declared source-grounded contrast pairs met thresholds in light and dark built CSS.
- `pnpm --filter @taskdesk/web exec playwright test --config playwright.config.ts e2e/work-item-create-dialog.spec.ts` — 3/3 passed.
- `git diff --check` — passed.

The Playwright run opened `/agent/projects/WLP/work?layout=list` at 1280×720, loaded the 500-row fixture, opened the create dialog, checked one title and one description, captured the dialog, closed and reopened it with Escape/keyboard, tested delayed list/wrapper/form loading, and tested failed preload recovery. Screenshot: `apps/web/test-results/work-item-create-dialog-wo-3f99c-s-independently-of-the-list/create-work-item-dialog.png` (local ignored test output). The complete E2E output is in the private evidence log below.

Private mode-0600 raw logs:

- `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-performance-takeover-500c491b/current-remediation/focused-vitest.log`
- `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-performance-takeover-500c491b/current-remediation/typecheck-866.log`
- `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-performance-takeover-500c491b/current-remediation/biome-866.log`
- `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-performance-takeover-500c491b/current-remediation/token-contrast-866.log`
- `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p0-performance-takeover-500c491b/current-remediation/create-dialog-e2e-866.log`

## Retained findings and limits

The prior hosted run on `866438a6` remains historical evidence: G11 was 20/22, with LCP 2608 ms against 2500 ms and board render 640.1 ms against 500 ms failing. The separate same-field overlap finding showed two failed writes could leave the first optimistic value in an inactive task cache. The dialog finding showed the lazy form duplicated the visible accessible title and description. This checkpoint adds source-level fixes and regressions for the latter two findings; it makes no claim about hosted performance, canonical G11 acceptance, or the remaining LCP/board results.

No performance result is attributed to this checkpoint. The downloaded `hosted-866438a6-diagnostic/initial-page-profile.json` names source commit `f642f0a7d6058e0c523f729939053d335c76b4d3`, so it was not treated as a source-aligned profile for 866 or this checkpoint. The next integrated hosted run and any acceptance decision belong to the orchestrating session.
