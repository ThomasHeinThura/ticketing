# Independent GPT-6 Luna ordinary review B

- **Candidate:** `ca6f6aef28447a0837aeb9347791e54e51108e9c`
- **Repository:** `/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2`
- **Independence:** Fresh reviewer context. I did not author, direct, or remediate this candidate.
- **Verdict:** **Source review clear; no blocking or non-blocking source findings. Hosted acceptance is not clear.** This is an ordinary source-review verdict only, not the required Sol security review, merge approval, or phase claim.

## Scope reviewed

Reviewed the complete substantive frontend/performance/cache/E2E/settings corrective delta from `a435657e747b8c12ceb5784e1c991a70a175c51c` to the exact candidate, plus the relevant query-key, project-store, board, observability, native realtime authorization, Redis control-channel, migration-shape, and test seams. Reviewed `packet.md`, `AGENTS.md`, `agent-workflow.md`, `CLAUDE.md`, current `status.md`, newest `decision-log.md`, SDLC, coding standards, and the relevant source.

## Findings

None.

## Checks and evidence

- Verified `HEAD` equals the requested candidate SHA and the worktree was clean before and after review.
- Ran from `apps/web`: `pnpm exec vitest run --config vitest.config.ts src/hooks/mutations/task/invalidate-task-field-queries.test.ts src/hooks/use-task-filters-with-labels-support.test.tsx` — **2 files, 8 tests passed**.
- Ran from `apps/web`: `pnpm typecheck` — both configured TypeScript projects passed.
- Read-only live GitHub check for PR #579 confirms the exact requested head. At review time, `performance - budgets (G11)` and `integration - Postgres 18` were `IN_PROGRESS`. `visual regression (G8)`, `gate checkers + red probes`, `CodeQL`, `GitGuardian Security Checks`, and `pull request template + security review` were `FAILURE`; other listed checks were successful. These are factual current hosted gate states and do not establish source defects by themselves.
- Per the packet, the new candidate has **no hosted G11 result yet**. The prior a435 hosted G11 failure remains historical evidence, not a result for this SHA. The packet's local browser/G11 evidence is author-scoped and is not hosted acceptance.
- The packet states the 422 contrast-pair source comparison was already validated; I did not invent or claim independent contrast evidence.

## Source assessment

The targeted task-field invalidation preserves notifications and the changed task's activity query, invalidates affected project completion totals on status changes, keeps assignment changes from invalidating completion stats, and finds reverse relation projections by embedded endpoint IDs. Unknown in-flight relation/project/task/notification/activity reads are cancelled before the invalidation/refetch path, so a pre-mutation response cannot repopulate those projections as fresh. Existing query-key definitions match the helper's predicates.

The board chooses query data only when its project ID matches the active route, while same-project store data takes precedence to retain optimistic edits. The filter hook returns the original project and task arrays when filters/search are inactive, and `memo(KanbanBoard)` plus stable unfiltered project identity preserves the board lifecycle across unrelated parent renders. The board renders from the guarded project source; the store effect remains the existing synchronization mechanism.

The reviewed E2E config sets one worker and zero retries. Test files and assertions remain present; the corrective journey waits for and asserts signup response success. The new `realtime` module is included in the API schema/default/equality/logger, settings UI and settings journey. The forward DB constraint accepts the additional module while preserving the existing six-module shape. No removed test, retry, performance threshold, workload, or canonical write-count change was found in this delta. The packet's stated obligations remain 500 rows, 200 cards, 100 canonical writes, keyboard/overlay/zoom coverage, and unchanged budgets; author local scoped runs are not represented here as my browser verification.

## Limits

No source or Git mutation, PostgreSQL, Docker, browser, build, Turbo, broad suite, or hosted workflow execution was performed. I did not independently reproduce the packet's local browser timings, 100-write performance journey, 200-card responsive smoke, full E2E count, contrast measurement, or image/runtime proof. Exact-head hosted acceptance is still blocked by the live checks listed above and must be judged from their eventual results and required independent review artifacts.
