# Independent ordinary review B — P0 bulk candidate

- **Reviewed head:** `a435657e747b8c12ceb5784e1c991a70a175c51c`
- **Comparison base:** accepted remote main `8ddb9de8d4d242a0832f6f91e12872300480a905`
- **Reviewer:** fresh independent GPT-6 Luna context, ordinary reviewer B
- **Independence:** I did not author, direct, or remediate this candidate. I read the supplied packet for scope/evidence pointers, but formed this verdict from source, required repository instructions/specs, and checks performed in this context. I did not use prior reviewer verdicts as my verdict.
- **Checkout:** HEAD matched the reviewed SHA; working tree was clean before review. It remained clean after review.

## Scope checked

Inspected the accepted-main-to-head relevant frontend, design-system, performance, network/realtime, and CI/browser seams, including:

- Board shared create-modal ownership, selected-column status, modal close/focus restoration, narrow Zustand selectors, and coverage added in the board batch.
- Task due-date/start-date constraint; task query abort signal; optimistic status/assignee update behavior when fetch is idle versus in flight.
- Native work-item WebSocket subscription lifecycle, acknowledgement/outage state, key-only event invalidation, reconnect refetch, and active-query fallback; legacy task socket consumers and separate agent/portal entries.
- G11 workload shape and strict budgets/retry semantics; G8 production-preview command and dual-entry build guard; contrast checker/inventory seams and unchanged 422-pair threshold claims.
- Required specs read: `docs/01-architecture/realtime.md`, `docs/01-architecture/security-model.md`, `docs/01-architecture/rbac.md`, `docs/03-features/work-items.md`, and the repository workflow/status/decision instructions.

## Checks actually run

- `node --test scripts/ci/lib/performance-budget.test.mjs scripts/ci/check-visual-scope.test.mjs` from repository root: **155 tests passed, 0 failed, 0 skipped**. This includes G11 retry/budget semantics and G8 preview/build/config guard cases.
- From `apps/web`, `pnpm exec vitest run --config vitest.config.ts src/components/kanban-board/column/column-header.test.tsx src/hooks/mutations/task/use-update-task-optimistic.test.tsx src/components/task/task-properties-controls.test.tsx`: **3 files passed, 9 tests passed**.
- A first attempt to invoke the root-relative Node tests from `apps/web` used the wrong cwd and did not run; the corrected root-cwd invocation above is the recorded result.
- `git diff --check base...HEAD` reported trailing whitespace in pre-existing committed review-note files; no source finding was derived from that check.

## Findings

### Blocking — hosted G11 board budget is not cleared on this candidate

The retained actual hosted G11 result for the source line before the final board-dialog batch is **504.3 ms** against the unchanged strict **<500 ms** 200-card board-render limit. The final candidate includes a further board optimization, but there is no latest hosted G11 result for `a435657e747b8c12ceb5784e1c991a70a175c51c` establishing that the measured failure is fixed. G11 intentionally retries once only after a failing three-sample median and still requires the median to be strictly below the budget; its pure tests passed. This is an unresolved real acceptance failure, not a source-style concern. The candidate cannot receive a clear ordinary verdict until the exact-head hosted measurement passes with the existing workload/threshold.

### Source review

No additional concrete source-level functional or authority defect was found in the inspected requested surfaces. In particular, the board passes the clicked column ID to one board-owned create dialog and retains the initiating element for guarded focus restoration; due-date selection receives the current `startDate`; field updates avoid cancellation when the query is idle and cancel a real in-flight query before optimistic mutation; native realtime uses the persisted work-item transport with refetch/fallback behavior; and G8 pins built preview with both entries built before screenshots.

## Verdict

**BLOCK.** The known strict board performance threshold failure remains unresolved by exact-head hosted evidence. No threshold relaxation, retry removal, or waiver is supported by this review.

## Limits / not checked

No Docker build/boot, PostgreSQL/integration suite, browser run, web build, broad test suite, Turbo wrapper, hosted CI run, or latest hosted G11 measurement was performed. I did not inspect every one of the candidate's 669 changed files; this review concentrated on the requested accepted-main-to-candidate frontend/design-system/performance/network/realtime client and CI/browser/G8 seams. This is an ordinary review only, not GPT-6 Sol security review or P0 phase finalizer.
