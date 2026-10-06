# Independent ordinary bulk review — P0 authority and rendering delta

- **Reviewer/model:** Fresh GPT-6 Luna review context; independent of the author/fixer. I did not author, direct, or remediate this candidate.
- **Exact candidate SHA:** `94ecb0fe9d6577c2bb4c6d5b540b803be5ccfc98`
- **Comparison base:** `ea13d3d39750a367725cc1c6297885ce402d4744`
- **Worktree:** `/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2`
- **Start/end state:** exact HEAD at both checks; source worktree clean at start and end.
- **Verdict:** **CLEAR — no blocking or non-blocking findings identified in the inspected current delta.** Ordinary review only; this does not grant CI, hosted, image, runtime, traffic-date, Sol security-review, or phase-finalizer acceptance.

## Scope inspected

Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the current dated status and newest decision-log entries. Read relevant portions of `docs/01-architecture/rbac.md`, `docs/01-architecture/realtime.md`, `docs/03-features/work-items.md`, and `docs/04-engineering/ci-cd.md`.

Inspected all current delta files at a diff level (58 files; 585 insertions / 176 deletions), with detailed source review of:

- The registered-policy based REST capability decision and target reach across `workspace-access-middleware.ts`, `require-work-item-reach.ts`, all affected routers (project, task, work-item, activity, attachments, comments, columns, task relations, external links, workflow rules), and policy/OpenAPI consistency.
- Native project/work-item topic authorization and its fresh identity/role reauthorization, invalidation, and finite failure behavior.
- Persisted integration actors and controls: empty legacy workspace permissions with real project grant, workspace-only member denial, limited and empty project roles, `sees_all`, global-admin-only authority separation, API-key fail-closed behavior, and customer-side roster denial.
- The migration journal tail and existing `0087_romantic_sway.sql`; no migration or route-policy/OpenAPI declaration changes occur in this comparison delta. Forward ordering is `0086` then `0087`; the reviewed `0087` adds an observability-settings shape check and a step-up operation-route check, without rewriting historical migration prefixes.
- Existing safe HTTP/realtime logging helpers and visual-scope worker/performance assertions; the current delta adds no changes to the visual-scope checker itself. The new agent-workflow paragraph concerns private evidence retention and does not change authority or gate semantics.
- Frontend delta in bulk selection, board/card/drop interactions, task details/activity ownership, closed/unselected query gating, modal behavior and route selection; token pair diff is limited to occurrence bindings, with no token pair/category/threshold change apparent.

Historical ea13 A/B/C and 787-delta review records were read only after independently inspecting the current mechanisms. The prior C blocker is resolved in this head: the current route guards make one canonical registered-policy target-capability decision, and the redundant workspace-role-only read checks have been removed from project-scoped REST reads and native topic authorization. The new fixture exercises the missing positive direction using a real custom workspace role with empty legacy permissions and an explicit project grant; limited/empty project-role negatives remain. The global-admin-without-workspace-authority negative also remains consistent with RBAC's separate reach and authority axes.

## Checks run in this review

- `git diff --check ea13d3d39750a367725cc1c6297885ce402d4744..HEAD` — passed.
- `node --test scripts/ci/check-visual-scope.test.mjs` — **153 tests passed, 0 failed, 0 skipped**. This is a local bounded checker test, not hosted G8 evidence.
- Exact HEAD and clean source status checked before and after inspection/report preparation.

No PostgreSQL, Docker, browser, server, integration, full build, install, or external-message operation was run, as explicitly constrained. Supplied author evidence remains author evidence: affected PG 2 files / 18 tests, focused web 3/3, API/web types and token 422, pinned Linux G8 7 screens / 142 stories, canonical native Darwin G11 22/22 including 100 versioned writes. The offline fixture validator's 40 checks and API-key regression 10/10 are likewise not reviewer-run here. No aggregate full integration pass is claimed: status records the current full local run at 130/136 files and 1,637/1,648 tests, with the six corrected fixture files / 133 tests passing as a separate grouped rerun.

## Findings

- **Blocking:** None found in the inspected current source/spec/delta.
- **Non-blocking:** None.

## Residuals and limits

- Current hosted full integration, final hosted Linux/G8 and current-image runtime proof remain pending per the supplied status. Native Darwin timing is not hosted Linux acceptance; the reported LCP sample includes a late outage-banner sample and is not causal performance proof.
- There are zero clean UTC traffic dates. No date or traffic acceptance is inferred from offline checks or elapsed time.
- Required independent GPT-6 Sol security review, exact-head CI, current image/health/traffic proofs, required shadow-date evidence, and later P0 phase finalizer remain separate gates. No CI gate was waived.
- Route-policy/OpenAPI declarations are unchanged in this delta and appeared consistent with the reviewed source; no declaration coverage finding identified. Migration execution and runtime log injection were not independently exercised.

No source files were changed and no Git mutations were made.
