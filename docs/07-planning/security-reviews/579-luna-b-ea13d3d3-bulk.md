# Independent ordinary bulk review — GPT-6 Luna

- **Reviewed head:** `ea13d3d39750a367725cc1c6297885ce402d4744`
- **Comparison base:** `ca6f6aef28447a0837aeb9347791e54e51108e9c`
- **Independence:** Fresh reviewer context. I did not author, direct, or remediate this candidate. Historical ca6 A/B/C and 787 delta reviews were not used as current clearance.
- **Worktree:** `/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2`; clean at start and end; HEAD matched the reviewed SHA at both points.
- **Verdict:** **CLEAR — no blocking or non-blocking findings identified in reviewed scope.** This is ordinary review only; it does not waive or claim CI, hosted-image, security-review, or phase-finalizer gates.

## Scope inspected

Reviewed the candidate diff and applicable written contracts, focusing on:

- Frontend performance/UI batch: `apps/web/src/components/activity/comment-input.tsx` and its regression test; task relation/subtask memo boundaries; kanban column layout containment; fixed table layout and six proportional columns in `work-item-list.tsx`.
- G8 control change: `scripts/ci/check-visual-scope.mjs` and its test requiring one real-runtime Playwright worker.
- Cross-surface spotcheck: project reach evaluation and its middleware wiring in `apps/api/src/utils/has-project-reach.ts`, `workspace-access-middleware.ts`, `work-item/require-work-item-reach.ts`, attachment reach, affected route declarations, and `tests/api-integration/project-reach-guard.test.ts`.
- Safe API/realtime logging spotcheck: lifecycle helpers, API startup/shutdown and request error call sites, realtime failure helper, websocket initialization/broadcast paths, and observability contract changes.
- Relevant contracts: `docs/02-design/ux-quality-gates.md` (G8/G11), `docs/03-features/views.md`, `docs/03-features/comments-and-activity.md`, the current RBAC and observability architecture docs, and the dated status/decision entries.

## Checks I ran

- `git diff --check ca6f6aef28447a0837aeb9347791e54e51108e9c ea13d3d39750a367725cc1c6297885ce402d4744` — passed.
- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/components/activity/comment-input.test.tsx` — **1 file / 1 test passed**. This verifies parent activity rerenders do not rerender/unmount the editor and preserve its draft.
- `node --test scripts/ci/check-visual-scope.test.mjs` — **153 tests passed, 0 failed, 0 skipped**. Includes the new worker-count mutation rejection.
- Read-only source/spec review; no source edits, installs, browser/server/database/Docker runs, or external messages.

## Findings

None. The editor memo boundary retains local draft state for unchanged `taskId`; relation/subtask memoization is over stable scalar props; containment is scoped to each column's card stack; the six fixed column proportions sum to 100% and use the table's fixed layout. The new G8 assertion checks the base Playwright config's actual worker setting, with a regression test that changes it to 2 and expects rejection.

In the API spotcheck, project-read enforcement is opt-in at registered project-scoped read call sites, derives identity and policy from the route registry, and preserves the distinct unreachable (404) and insufficient-capability (403) outcomes. The examined lifecycle/realtime catches use finite no-argument safe log helpers and do not serialize exception payloads. No authority expansion or unsafe error payload path was apparent in the reviewed diff.

## Evidence and residuals

The supplied author evidence is recorded as author evidence, not reviewer-run acceptance: affected PostgreSQL suites **2 files / 18 tests**, focused web **3/3**, types/token **422**, G8 pinned Linux **7 screens / 142 stories**, and unchanged canonical native Darwin G11 **22/22**, including 100 versioned writes returning 200. Native timings are directional only. Final hosted Linux and current-image evidence remain pending, and there are zero clean traffic dates. I did not rerun PostgreSQL, browser/G8 runtime, G11, a full build, or image/hosted jobs, per the bounded-review constraints.

This report does not disposition prior historical findings on behalf of their authors. Independent verification of the current source batch, required GPT-6 Sol security review, required hosted CI/image checks, and later phase finalizer remain separate gates as applicable.
