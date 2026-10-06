# Independent ordinary review B — P0 bulk candidate

- **Reviewer:** fresh independent GPT-6 Luna context; did not author, direct, or remediate this candidate.
- **Reviewed head:** `94ecb0fe9d6577c2bb4c6d5b540b803be5ccfc98`
- **Comparison:** `ea13d3d39750a367725cc1c6297885ce402d4744..94ecb0fe9d6577c2bb4c6d5b540b803be5ccfc98`
- **Worktree:** `/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2`
- **Initial/final state:** exact HEAD verified at start and end; source worktree clean at both checks. No source edits, commits, installs, messages, or agent launches.

## Review scope

Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, its SDLC and coding standards guides, `CLAUDE.md`, the relevant work-item/view contracts, RBAC contract, the latest decision-log entries, and the prior exact-base review C solely to verify its blocker against the new delta. Inspected all 58 changed paths at diff/name level and focused source review of:

- project/work-item read authorization and route policies, shared workspace access middleware, work-item reach middleware, and native work-item topic authorization;
- updated project reach and permission-shadow integration cases, project-role fixture helper, assignment roster tests, and API route middleware removals;
- detail activity query ownership/summary selection, modal metadata query gating and draft regression, board task-card stable props/layout containment, and related task query test;
- visual token-pair changes and G8 checker-relevant docs/config context.

Prior finding C was: project-scoped read capability was conjoined with legacy workspace-role capability, denying a valid project role override. Current source resolves the matched registered project/work-item capability through canonical `resolveIdentity`/`can()` in `projectReadDecision`; route middleware retains `validateWorkspaceAccess` for active workspace membership/API-key reach. The current permission-shadow test now uses an active legacy `member` workspace row with a project `work_item:read` role and expects 200/agreement. `project-reach-guard` adds a custom empty-permission legacy workspace role for the direct-project reader. The affected GETs remove the redundant legacy capability middleware. I found no remaining instance of the prior conjunction in these inspected paths.

No blocking or non-blocking source correctness finding identified in the reviewed delta. This is an ordinary review verdict only; it does not satisfy the separate security review or protected CI gates.

## Checks actually run

- `git status --short` and `git rev-parse HEAD` at start — clean and exact requested head.
- `git diff --stat` / `git diff --name-only` — 58 changed files, 585 insertions, 176 deletions.
- `git diff --check ea13d3d39750a367725cc1c6297885ce402d4744..HEAD` — passed, no whitespace errors.
- `node --test scripts/ci/check-visual-scope.test.mjs` — **153 passed, 0 failed, 0 skipped**.
- `pnpm --filter web exec vitest run src/components/shared/modals/create-task-modal.test.tsx src/hooks/queries/task/use-get-task.test.tsx src/components/kanban-board/task-card.test.tsx` — **3 files passed, 12 tests passed**.
- Final `git rev-parse HEAD`, `git status --porcelain=v1`, and diff check — exact requested head, clean, check passed.

## Supplied implementation evidence and residual limits

The following are source-author supplied facts, not independently rerun here: API affected PG **2 files / 18 tests**, web **3 / 3**, types/token **422**, pinned-Linux G8 **7 screens / 142 stories**, and unchanged canonical native Darwin **22/22 including 100 writes**. The author reports the former API fixture failure batch was remediated as **6 files / 133 / 133**, while final hosted Linux and current-image evidence remain pending. Native Darwin timings are directional only; supplied LCP samples were 2144/2148/4268 ms during a late outage banner, median 2148 ms. Hosted acceptance remains pending and there are **zero clean traffic dates**. I did not run PostgreSQL, Docker, browser/server, full build, or heavy suite checks per instruction. No CI or phase gate is waived or represented as green by this review.

The diff includes the new independent-review-history files and a 7-line agent-workflow evidence-retention instruction; neither introduces source authority or pass/fail gate semantics. Safe API logging changes were spot-checked at the changed call sites; no error payload or credential material is included in this report. Remaining acceptance risk is external/runtime evidence above, plus UI geometry/browser behavior and current-image boot not independently exercised in this bounded review.

## Verdict: CLEAR — ordinary review B

No blocking findings. No non-blocking findings. Exact-head ordinary review only; hosted Linux/current-image acceptance, required independent panel count, GPT-6 Sol security review, required CI, and any phase-finalizer obligation remain governed by repository policy.
