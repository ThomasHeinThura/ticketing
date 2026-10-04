# Independent ordinary bulk review — P0 native project reach and lifecycle seams

- **Reviewer:** fresh GPT-6 Luna context; independent of candidate author/fixer and prior reviewers. No candidate code authored, directed, or remediated in this context.
- **Exact candidate:** `ea13d3d39750a367725cc1c6297885ce402d4744`
- **Comparison:** `ca6f6aef28447a0837aeb9347791e54e51108e9c`
- **Checkout:** `/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2`; clean at start and end, HEAD exact at both checks.
- **Changed scope:** 45 files; 1,990 insertions / 187 deletions. Main source reviewed: `has-project-reach.ts`, workspace access/reach middleware, all opted-in REST router files, application route guards, native WebSocket authorization/revocation and Redis adapter, HTTP/realtime lifecycle logging. Also reviewed RBAC/observability contracts, added persisted reach and realtime/logging regressions, CI visual scope assertions and snapshot changes. Historical `ca6` A/B/C and `787` delta reports were treated only as history, not clearance.

## Review focus and observations

1. **Reach versus capability:** `has-project-reach.ts` derives reach through `reaches(identity, persistedFacts)` and independently asks `can(identity, capability, scope, target)`. Per `docs/01-architecture/rbac.md` canonical Reach and route-policy rules, workspace membership by itself does not reach a project; project membership and scoped `sees_all` do. `reach.kind === "all"` grants instance-admin reach, not workspace capability. The route's registered policy supplies the capability and scope. I found no implementation path that turns a shadow observer result into reach or changes the declared capability.
2. **Route coverage and liveness:** the reviewed route changes pass `requireProjectReach` only on project/work-item-scoped reads; the middleware validates the typed persisted project/workspace tuple before evaluating policy. Work-item and attachment guards preserve masked `404` for unreachable resources and existing liveness filters. Capability failures remain `403`. No caller-supplied workspace id is used as project reach evidence.
3. **Persisted actor coverage:** the new PostgreSQL test constructs persisted ordinary workspace-only, direct project, `sees_all`, limited-capability, empty-capability and global-admin actors and reads real project/task/work-item/attachment targets. It asserts denial/allow and shadow agreement. The global-admin actor has global reach but no target workspace capability and is correctly expected to receive `403`; this matches the RBAC split. This integration test was inspected but not run in this review due to the explicit no-PostgreSQL constraint.
4. **Realtime/lifecycle:** native subscriptions load current project/work-item facts, require both project reach and workspace work-item-read capability, and reauthorize against a fresh credential/identity on timer and invalidation. Invalidation narrows candidates by user/workspace/project and re-checks topics. Errors are emitted via closed finite logging events without serializing error objects. I found no issue in the reviewed lifecycle failure paths.
5. **Shadow semantics:** the RBAC contract says native-denial evidence is legacy-side only and policy reach is computed independently. The new facts passed to the evaluator are loaded from the selected persisted row; absent hierarchy/team fields are explicitly empty because the current schema lacks them. This is consistent with the written contract and does not manufacture reach.

## Checks run in this review

- API bounded unit tests: 4 files, **24 tests passed** (`broadcast`, `node-server-safe-logging`, `user-broadcast-redis-failure`, observability logger).
- Permissions evaluator unit test: 1 file, **60 tests passed**.
- `scripts/ci/check-visual-scope.test.mjs`: **153 tests passed**.
- `git diff --check ca6... ea13...`: passed.
- One initial Vitest invocation used package-local paths that the configured include did not discover (0 tests); corrected to repository test paths and ran the tests above. No evidence is attributed to the failed invocation.
- No PostgreSQL, Docker, browser, server, install, or full-build commands were run.

## Findings

- **Blocking:** none found in inspected source/spec and bounded checks.
- **Non-blocking:** none.

## Residual acceptance state

Source-correctness verdict is **clear for this ordinary review**. This is not candidate/phase acceptance: the required independent GPT-6 Sol security review remains outstanding for the security-scope reach/authorization changes. As supplied in the assignment and current status snapshot, final hosted Linux and current-image proofs remain pending; there are zero clean traffic-date buckets. Those are pending gates/evidence, not waivers or review findings. The author-reported full affected PostgreSQL 18/18, web 3/3, types/token 422, pinned Linux G8 7 screens/142 stories, and unchanged native Darwin canonical 22/22 including 100 writes/200 PASS are recorded as author-reported only and were not independently rerun here. CI remains authoritative; no gate is waived.

## Final verification

At report completion, `git rev-parse HEAD` returned `ea13d3d39750a367725cc1c6297885ce402d4744`; `git status --porcelain=v1` was empty. No source files were modified.
