# Independent ordinary review C — P0 bulk candidate

- **Reviewer:** fresh independent GPT-6 Luna context; did not author, direct, or remediate this candidate.
- **Exact reviewed candidate:** `ea13d3d39750a367725cc1c6297885ce402d4744`
- **Comparison:** `ca6f6aef28447a0837aeb9347791e54e51108e9c..ea13d3d39750a367725cc1c6297885ce402d4744`
- **Worktree:** `/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2`
- **Initial/final Git state:** exact HEAD matched at start and end; source worktree clean at both points. No source edits or Git mutations.

## Review scope

Read `AGENTS.md`, the required agent workflow and its SDLC/coding standards references, `CLAUDE.md`, current status and newest decision-log entries. Independently inspected the current candidate's affected authority and runtime mechanisms before reading prior review notes. Reviewed the API source and contracts for:

- REST project/work-item/attachment reach guards, independently recomputed shadow decisions, registered policy scope, and project-role capability evaluation;
- native WebSocket project/work-item topic authorization, refreshed identity and role changes, invalidation targeting, archived-resource checks, and adapter failure behavior;
- forward migration `0087`, journal order, finite HTTP/realtime logging contract and startup/close failure handling;
- visual-scope worker enforcement and related regression test;
- integration fixtures for direct project roles, workspace-only reach, limited capabilities and role revocation.

The current code and contracts inspected include `apps/api/src/utils/has-project-reach.ts`, `workspace-access-middleware.ts`, `work-item/require-work-item-reach.ts`, `attachment/require-attachment-reach.ts`, `ws/native-work-item-realtime.ts`, `ws/index.ts`, `docs/01-architecture/rbac.md` (reach, shadow evidence and authority), `docs/01-architecture/realtime.md`, `docs/01-architecture/observability.md`, and `tests/api-integration/project-reach-guard.test.ts` / `node-server-websocket.test.ts`. Route-policy and OpenAPI declarations appeared unchanged in this delta and consistent with the reviewed source; no missing-route-policy finding identified.

## Checks actually run

- `git status --short --branch`, `git rev-parse HEAD`, and diff-stat/name inspection at the start; exact `HEAD` was `ea13d3d39750a367725cc1c6297885ce402d4744`, and status showed no source changes.
- `node --test scripts/ci/check-visual-scope.test.mjs` — **153 tests passed, 0 failed**. This is a bounded local checker test, not hosted G8 evidence.
- `git diff --check ca6f6aef28447a0837aeb9347791e54e51108e9c..HEAD` — exit 0, no whitespace errors.
- Final `git status --short --branch` and `git rev-parse HEAD` — exact candidate remained at HEAD and clean. The only created artifact is this private report, outside the worktree.

Per instruction, I did not run Docker, PostgreSQL, browser/server, integration suites, or a heavy full build. The supplied author evidence is recorded as supplied rather than as independently reproduced: affected PG **2 files / 18 tests**, web **3 / 3**, types/token **422**, G8 pinned Linux **7 screens / 142 stories**, and unchanged canonical native Darwin **22/22 including 100 writes**. Hosted Linux and current-image checks remain pending; there are zero clean traffic dates. This report grants no CI, hosted, runtime, shadow-date, or phase acceptance.

## Verdict: BLOCK

### Blocking finding — canonical project-role capability is conjoined with the legacy workspace-role capability

The new `projectReadDecision()` evaluates the canonical identity against the route's declared capability and project/work-item scope. However, each affected REST route still runs `requireWorkspaceCapability(...)` after that guard (for example `GET /api/projects/{projectId}/work-items` and `GET /api/work-items/{key}` in `apps/api/src/work-item/index.ts`). That helper calls `assertCallerHasCapability()`, which authorizes solely from the caller's legacy `workspace_member.role` and `BUILT_IN_ROLES`; it does not consume the canonical project membership or its capabilities. The effective predicate is therefore canonical project authorization **AND** legacy workspace-role authorization.

That contradicts `docs/01-architecture/rbac.md`'s Authority rule: roles applicable to the target scope contribute capabilities, and a project role overrides the workspace role for that project. A valid workspace member with a project role granting the route capability, but a legacy workspace role that does not grant it, passes the new canonical decision and is then denied by the legacy check. The project-role grant is not effective. The same conjoined check exists in `authorizeNativeTopic()` (`assertCallerHasCapability(workspaceId, ..., "work_item:read")`) after canonical evaluation, so native subscriptions share the defect.

The new REST integration fixture does not catch this: `addWorkspaceActor(..., "admin")` supplies the direct-project, limited-project and empty-project actors with legacy admin workspace authority. The test separately proves a limited canonical project role lacks `work_item:read`, but it does not prove a project role can grant that capability when the legacy workspace role lacks it. The WebSocket fixture likewise gives the direct and limited actors legacy admin workspace rows. The workspace-only control proves absence of project reach, not project-role override semantics.

This is a behavior defect, not merely missing evidence: the unchanged legacy capability guard is present in the route middleware and its implementation is workspace-role-only, while the documented scope-precedence contract is explicit. The candidate needs a contract-conformant runtime seam and regression fixture with an ordinary/limited legacy workspace role plus a granting project role; an implementation may preserve workspace membership/reach checks while avoiding a second, conflicting authority decision.

## Non-blocking residuals / limits

- Source inspection found the forward `0087` journal entry appended after `0086`; historical migration SQL was not modified in the candidate file list. Migration execution and image boot were not independently checked.
- Safe logging helpers use finite fixed records and no-argument failure calls at the inspected lifecycle/realtime catches. No runtime injected-error test was run here.
- The G8 checker tests pass locally, but this does not replace the stated hosted G8 run. Hosted Linux and current-image checks, and the three actual clean UTC traffic dates, remain pending per supplied status.
- The source-author PG/Web/token/G8/Darwin counts above are packet facts only; they are not this review's test runs.
