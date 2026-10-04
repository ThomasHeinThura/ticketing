# Independent ordinary review B — P0 rendering and task freshness

## Candidate and independence

- **Reviewed head:** `b8d0bbc48087128189a4e58dfe4813f78f344f7d`
- **Rendering comparison:** `3404c83aee957b05fac849d1c6b4eaa1f903e80a`
- **Freshness correction comparison:** `c135595b8984e70ad6ee81833d87c9b572fa6243`
- **Reviewer:** fresh independent GPT-6 Luna context assigned for review B; did not author, direct, or remediate the candidate.
- **Verdict:** **CLEAR for ordinary review**, with one non-blocking compatibility residual and one E2E waiter-ordering concern below. This does not clear the separate required GPT-6 Sol review, hosted G11 acceptance, or stage finalizer.

## Scope and review performed

Reviewed the complete rendering delta and the composed freshness correction across the 13 changed files, including `TaskCard` idle/active style behavior, move-popover task shape, sidebar summary and move-availability selectors, the complete-task query observer/ref path, test coverage, and the new browser test. Traced `useGetTask`, the description and full-task mutation paths, invalidations, the actual `TaskPropertiesSidebar` consumers, and all `TaskPropertiesControls` callers. Read the required agent workflow, SDLC, coding standards, work-items rules WI-7/WI-7a, views rules VW-9/VW-10/VW-14, G11 requirements, and the prior independent reports.

The complete task observer subscribes to `['task', id]` data without a selector. A cache update that changes only `description`/`version` therefore changes the observer data and rerenders the controls; `taskRef.current` is refreshed on that render. The start-date handler reads that ref, spreads the complete task and updates only `startDate`; the fetcher sends the current version in `If-Match` and retains the latest title/description. The focused test asserts a version 1→2 cache update followed by a date change uses version-2 task data. The browser test covers description PUT → GET refresh → full date PUT with `If-Match: "2"`, retaining the edited description.

For identity, the unit test switches from task/project 1 to task/project 2 and checks the resulting date mutation uses task 2/version 7. The selector retains only the display fields, including both dates, while excluding description/version. Sidebar move eligibility remains selected as a boolean from the existing project query key; the move popover independently fetches destination projects. Search found only two production `TaskPropertiesSidebar` consumers, in the task page and details sheet, and neither supplies its optional `task` prop. `TaskPropertiesControls` has only the sidebar production caller.

`TaskCard` keeps the existing sortable transform, opacity, touch-action, z-index, and fallback transition when dnd-kit supplies a transform or active dragging state; it omits the style object while idle. The keyboard sensor and sortable coordinate getter are unchanged. This delta does not add reduced-motion handling, and the prior inline transition was also unconditional. I found no concrete new keyboard/drag/reduced-motion regression by source inspection. Runtime keyboard/cancel/reduced-motion behavior was not exercised in this review.

## Checks actually run

- `pnpm exec vitest run src/components/task/task-properties-controls.freshness.test.tsx src/components/task/task-properties-controls.test.tsx src/components/task/task-properties-sidebar.test.tsx` from `apps/web`: **3 files passed, 9 tests passed**.
- Read-only diff/call-site/query/mutation/spec inspection described above.
- `git diff --check 3404c83a..b8d0bbc4`: reported trailing spaces on hard-break lines in the two added historical review notes; no source whitespace issue.
- No E2E/browser, production build, broad suite, PG, or performance run by this reviewer. The packet's author browser evidence and other test/build evidence remain attribution, not checks I ran. Latest hosted G11 remains 19/22 as packet states; this review does not close it.

## Findings and residuals

### Non-blocking compatibility residual — supplied task precedence

`TaskPropertiesControls` always enables `useGetTask` when it has an id and chooses `fetchedTask ?? taskForMutation`. If a future caller supplies a full task while the cache contains an older value, the cached task wins synchronously during the refetch; this also means the sidebar's `!providedTask` disable does not disable the child's observer. Before this correction the supplied task took precedence and disabled the sidebar query. However, repository search found no production consumer supplying `TaskPropertiesSidebar.task`, and the work-items/view contracts do not specify precedence for this internal optional prop. I therefore treat this as an unused-prop compatibility residual, not a demonstrated current user-path blocker. If the supplied-task mode is intended to remain supported, it needs a focused test or an explicit source-precedence rule before a caller uses it.

### Non-blocking E2E reliability concern — response waiter registration

In `task-properties-version-freshness.spec.ts`, the test awaits the description PUT response before registering `updatedTaskRead = page.waitForResponse(...)`. The successful mutation invalidates the active task query, so its GET can start immediately and may complete before the waiter is registered. Registering both response waiters before triggering the description commit would remove this race. I did not run this E2E test, so this is a test-ordering concern from inspection, not a reproduced failure.

No blocking correctness finding was identified in the current production callers after the freshness correction.
