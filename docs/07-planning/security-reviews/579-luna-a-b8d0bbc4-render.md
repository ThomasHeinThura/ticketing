# Independent ordinary review A — P0 rendering and freshness batch

## Candidate and independence

- **Reviewed head:** `b8d0bbc48087128189a4e58dfe4813f78f344f7d`
- **Full comparison:** `3404c83aee957b05fac849d1c6b4eaa1f903e80a..b8d0bbc48087128189a4e58dfe4813f78f344f7d`
- **Correction comparison:** `c135595b8984e70ad6ee81833d87c9b572fa6243..b8d0bbc48087128189a4e58dfe4813f78f344f7d`
- **Reviewer/model:** fresh independent GPT-6 Luna context. I did not author, direct, or remediate this candidate.
- **Verdict:** **PASS** for this ordinary review. No blocking findings.

## Scope and evidence reviewed

Reviewed the complete web and documentation delta, including `task-card.tsx`, `task-move-popover.tsx`, `task-properties-controls.tsx` and its tests, `task-properties-sidebar.tsx` and its tests, `use-get-projects.ts`, the new version-freshness E2E, and the new `status.md` / `decision-log.md` facts. Read the required agent workflow, P0 status and decision entries, `docs/03-features/work-items.md` WI-7/WI-7a, and the relevant API implementation and client fetcher. Confirmed the frozen root worktree was clean at the exact candidate SHA.

Traced all `TaskPropertiesSidebar`, `TaskPropertiesControls`, `TaskMovePopover`, and `useGetProjects` application call sites. The full page and details sheet do not pass a task prop into the sidebar today. The sidebar still accepts an optional supplied `Task`; controls use that as fallback when the cache has no full task, while the shared `['task', id]` cache remains the mutation authority when populated, consistent with the new decision entry. The controls' unselected `useGetTask` observer receives full task data, so omitted-field and version-only cache updates change its observed data and refresh `taskRef`. Popover write handlers read that shared ref when mutating. The start-date payload therefore retains the latest full title, description, project and version.

The actual client uses `client.v2.task[":id"].$put` and sends quoted `If-Match` from `task.version`. The v2 route requires a valid header, locks the task, compares the asserted version, and returns the route's version-conflict response on mismatch. The legacy route's optional-header behavior is separate and unchanged. The E2E fixture models the v2 version check and asserts the version-2 write returns 200 and advances to 3; it does not claim PostgreSQL or hosted acceptance.

For board rendering, inspected the whole `TaskCard` change and installed dnd-kit sortable transition derivation. The new style is omitted only when there is no transform and no active drag; active transform/drag states retain transform, transition fallback, opacity, touch action and z-index behavior. Empty task-item stats and pull-request link arrays use stable empty values. I found no concrete drag, cancel, drop, keyboard or move-eligibility regression. `useGetProjects` retains its query key/function and adds an observer-level selector; its other callers continue using the existing two-argument API.

## Checks and counts

- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/components/task/task-properties-controls.freshness.test.tsx src/components/task/task-properties-controls.test.tsx src/components/task/task-properties-sidebar.test.tsx` — **3 files / 9 tests passed** on the frozen head.
- `git diff --check 3404c83..b8d0bbc` — reports three trailing-space lines in the retained historical Luna A report, used as Markdown hard breaks. No application source/test whitespace issue found.
- Inspected the retained author report `/Users/heinthura/.codex/taskdesk-evidence/2026-10-04/p0-version-freshness-c135/report.md` and its screenshot `fresh-start-date.png`. The screenshot shows the updated description and Oct 12 start date. The report attributes a built Chromium fixture run **1/1** at 1280×900, including `If-Match: "2"`, HTTP 200 and fixture version 3. I did not rerun the browser because the packet reserves the browser slot for P3.
- Did not run broad UI/API/performance suites, builds, database checks, or image checks; they are not needed for this focused review and are owned by the stated acceptance gates.

## Findings and residuals

No blocking correctness finding in the reviewed candidate. The original c135 stale mutation snapshot is corrected by the reactive full-task observer, while the sidebar display observer remains narrow. The two original c135 request-changes reports remain preserved as historical findings and are not rewritten or treated as independent review of b8.

Non-blocking cleanliness note: the full comparison's `git diff --check` returns 2 solely because the preserved Luna A report has intentional two-space Markdown line breaks on its reviewed-head, base, and reviewer lines.

Performance and delivery remain separate acceptance evidence: the packet/status record the prior hosted G11 result as 19/22, so corrected hosted G11 acceptance is still open. This review does not clear current exact-head CI, image build/boot, the required current-head GPT-6 Sol review, or the P0 phase finalizer.
