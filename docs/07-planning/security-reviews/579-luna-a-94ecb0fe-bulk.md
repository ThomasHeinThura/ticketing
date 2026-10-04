# GPT-6 Luna ordinary bulk review — reviewer A

- **Candidate:** `94ecb0fe9d6577c2bb4c6d5b540b803be5ccfc98`
- **Comparison:** `ea13d3d39750a367725cc1c6297885ce402d4744`
- **Independence:** Fresh independent reviewer context. I did not author, direct, or remediate this candidate.
- **Worktree:** `/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2`; verified clean and at the exact candidate SHA at start and end.
- **Verdict:** **No blocking or non-blocking source findings in the inspected scope.** This is a source-correctness review verdict only, not merge or P0 acceptance clearance.

## Scope inspected

Focused on the complete project/work-item read authority path and the final candidate delta resolving the prior C report:

- `apps/api/src/utils/has-project-reach.ts`, project-read handling in `workspace-access-middleware.ts` and `require-work-item-reach.ts`.
- All changed API route registrations for project/work-item/resource GETs; native topic authorization in `apps/api/src/ws/native-work-item-realtime.ts`.
- `tests/api-integration/project-reach-guard.test.ts`, the changed shadow agreement and persisted actor cases in `permissions-shadow-mode.test.ts`, and related fixture changes.
- RBAC and realtime contracts in `docs/01-architecture/rbac.md` and `realtime.md`; work-item read requirements in `docs/03-features/work-items.md`.
- Reviewed the candidate's focused rendering changes in the board and task-detail paths for apparent data-flow/regression issues. The rest of the non-authority candidate files were not exhaustively audited in this report.

## Review assessment

The final delta removes the second workspace-role `work_item:read` check on project-scoped reads and native project/work-item topics. The persisted target decision selects the registered policy capability and evaluates it with canonical `can()` plus `reaches()`. This addresses the historical C finding: a real project role granting the selected capability can now satisfy the read policy even when the workspace role lacks it. `validateWorkspaceAccess` remains, so the change retains active workspace membership/API-key validation as well as target reach and capability checks.

This is consistent with `rbac.md`'s explicit rule that project-scope authority overrides workspace authority for that project. The evaluator enforces that selection; it does not union a conflicting workspace grant with a project override. `instance:admin` is evaluated as its own tier and the evaluator clamps instance capabilities out of workspace/project role grants. I found no path in the inspected middleware that uses identity-provider or customer-supplied role data to mint `instance:admin` or `sees_all`.

API-key handling retains the independent stored key capability clamp in `can()` and an additional legacy permission-subset check in native realtime. Missing/disabled key identity fails closed through resolution/validation. The selected project read capability does not silently widen a key beyond its stored subset.

The shadow path resolves identity and reads persisted project/workspace facts, evaluates the registered capability and reach independently, and records a tally for agreement without fabricating an event. The updated test covers an active workspace member with a custom workspace role having no read capability plus a persisted granting project role; the expected successful native response and agreement tally exercise the previously missing direction. Negative plain-member, limited project-role, empty project-role, instance-admin-only, and API-key fail-closed cases are retained in the focused fixture/test set described by the candidate evidence. The review did not execute these database-backed cases.

The removal of the later workspace-only guard is confined to routes opting into `requireProjectReach`; workspace-scoped routes and all create/write paths retain their existing checks. Resource liveness/privacy/archive guards remain in their pre-handler lookup path. Native realtime still validates the stored topic resource/project, applies capability and reach, validates workspace access/key constraints, refreshes identity/revocation, and rechecks containment before fan-out in the inspected code.

The focused UI changes appear internally consistent: board users are shared from the route and assignees are selected per rendered card; task activity ownership/querying is isolated from the detail parent. I found no obvious stale prop or changed mutation path in the inspected diff. No browser evidence was produced by this review.

## Checks performed

- `git status --short`, `git rev-parse HEAD`, and candidate diff/stat: clean worktree; exact requested HEAD.
- Read the required agent workflow/operating guidance and current status/decision context, then the applicable RBAC, realtime, and work-item contracts.
- `pnpm --filter @taskdesk/permissions test -- --run`: **13 test files passed, 265 tests passed**, exit 0. This is a pure package suite and does not exercise database-backed route integration.
- Rechecked `git status --short` and `git rev-parse HEAD` at end: clean, exact candidate unchanged.

## Findings and residuals

- **Blocking source findings:** none in inspected scope.
- **Non-blocking source findings:** none in inspected scope.
- The candidate's database-backed API tests, affected full integration run, hosted Linux full integration/G8/G11, current image/runtime verification, and browser evidence were not independently run here. Their author-reported counts are not converted into reviewer evidence or aggregate passes.
- Full affected PostgreSQL evidence is reported as 2 files / 18 tests by the author; hosted full integration remains pending. The local full run's 11 fixture failures and subsequent six-file/133-test correction remain historical author evidence, not a full-suite pass.
- Native Darwin G11 22/22 with 100 writes and pinned Linux visual 7 screens / 142 stories are author evidence, not hosted acceptance. Final hosted Linux and current-image checks remain pending; clean traffic-date count remains zero.
- Ordinary review clearance requires the remaining independent reviewers at the exact candidate SHA. Required independent GPT-6 Sol security review and applicable CI checks are separate gates. This report waives none of them and does not claim merge readiness or phase completion.
