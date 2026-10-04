# Independent ordinary review — P0 bulk candidate

- **Candidate:** `1bc20f3492e84a1fb6ddb8e52a7b7ad340653657`
- **HEAD verification:** exact match.
- **Working tree:** clean at start of review. No source edits made.
- **Reviewer:** fresh independent GPT-6 Luna context; did not author, direct, or remediate this candidate.
- **Verdict:** **BLOCK** — one actionable UI correctness regression is present.

## Scope checked

Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the newest status and decision-log entries, `docs/03-features/views.md`, and the relevant work-items contract. Inspected the composed source relative to `01f258c6`, including the task/detail query selectors, property controls and popovers, sortable task-card handlers, smoke/performance tests, and shadow-evaluation provenance changes. The earlier independent BLOCK on `01f258c6` remains a historical verdict; this report neither replaces nor conflates it with current-head evidence.

## Finding

### B1 — Due-date calendar keeps a stale start-date constraint

**Evidence:** `apps/web/src/components/task/task-properties-controls.tsx:178-221` memoizes `dueDateControl` with dependencies `[taskId, dueDate, status, columns, compact, translate]`. The memo captures `latestTask` from `taskRef.current`, but does not depend on `startDate`. `TaskDueDatePopover` reads `task.startDate` at `apps/web/src/components/task/task-due-date-popover.tsx:60-66` to disable calendar dates before the start date.

If a realtime/refetch update changes only `startDate`, React preserves the memoized due-date element and its old `task` prop. The open or subsequently opened due-date calendar therefore constrains selectable dates using the prior start date. This can permit a date before the current start date or wrongly disable dates after the start date was moved earlier. `taskRef` only supplies the latest object to the mutation callback; it does not update the calendar's captured `task` used for `selected` and `disabled` props.

**Action:** include the current start date in the due-date control memo boundary (and add a regression that rerenders with changed `startDate` while `dueDate` is unchanged, asserting the calendar constraint refreshes).

## Checks actually run

- `git rev-parse HEAD`; `git status --short`: exact SHA and clean initial tree.
- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/components/task/task-properties-controls.test.tsx src/components/task/task-details-content.test.ts src/lib/performance-profile-intervals.test.ts src/components/kanban-board/task-card.test.tsx` — **4 files, 10 tests passed**.
- `pnpm exec tsc --noEmit -p apps/web/tsconfig.json` — passed, exit 0.
- No browser, full E2E, container, image, performance benchmark, or PostgreSQL run was performed. Author smoke/browser evidence was not treated as reviewer evidence.

Two attempted workspace checks unexpectedly invoked Turbo dependency builds (agent web build started). They were interrupted; neither is counted as a pass. `check:tokens` reported its token check passed before Turbo output began, but the combined command did not complete, so contrast/pair validation is **unknown** in this review. No reliable final post-attempt cleanliness check was obtained before report creation; no tracked file edits were made.

## Limits and historical evidence

No claim is made that current source passes canonical G11, the 100 drag-write budget, the three-date observation window, production browser verification, or security review. Current test counts recorded by the author in `status.md` are not reviewer-run results. The `01f258c6` BLOCK remains source-bound historical evidence and is not downgraded or erased here.
