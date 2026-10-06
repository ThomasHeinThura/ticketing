# Ordinary review A — P0 complete findings delta

- **Reviewer:** fresh independent GPT-6 Luna context; did not author, direct, or remediate this candidate.
- **Exact candidate:** 01f258c6761ed935a16ace80695c597078519a11
- **Comparison:** complete auth/permissions/provenance/introspection delta 4650d31c against bulk-reviewed f19b3bed6bc2e60d71906423b985fadb089da212a; historical full Sol source 64d3ce895e952879d81c444f4276b730781c312a; accepted main 8ddb9de8d4d242a0832f6f91e12872300480a905.
- **Verdict: BLOCK.** One material shadow-parity blocker remains. This does not claim a runtime authorization bypass or a production acceptance failure.

## Scope and checks

Read repository instructions (AGENTS.md, docs/04-engineering/agent-workflow.md, CLAUDE.md), status/decision log, RBAC and security model, route policy/evaluator contracts, and the current implementations for capability introspection, strict-policy evaluation, shadow evaluation/middleware, native workspace access, and asset access. Inspected the complete 4650d31c auth-related diff, current API/OpenAPI response, and the web capability-query consumer.

Reviewer-run focused checks:

- packages/permissions: evaluator fail-closed and registry suites — **2 files, 66 tests passed**.
- tests/api/permissions/shadow-evaluation.test.ts with the API Vitest config — **1 file, 35 tests passed**.

One initial attempt used the wrong test root and found no files; it did not run a test and is not counted. No database, container, full build, browser, or G11 proof was started. Author-provided checks and historical failures are not reviewer-run and are not represented as such here.

## Blocking finding

### B1 — Native negative-reach evidence can force a false policy denial and hide a real disagreement

**Evidence:** [workspace-access-middleware.ts](/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2/apps/api/src/utils/workspace-access-middleware.ts:262) creates the typed observer anchor only after the native existence-plus-reach query returns no row. The observer query uses NOT reachableWorkspacePredicate(...); that predicate is instance-admin reach or direct workspace membership. It then records the same resource/id as nativeReachDenialEvidence (lines 284–290). In buildShadowPolicySide, a matching task/work-item evidence object is treated as sufficient to set the **new policy side's** inReach to false ([shadow-evaluation.ts:305](</Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2/apps/api/src/permissions/shadow-evaluation.ts:305>)).

That is not independent canonical reach evidence. It imports the legacy reach result into the policy evaluator. The documented canonical reaches() check grants project/work-item reach from direct project membership, ancestor-project membership, and owning-team membership in addition to workspace membership and instance-wide reach ([evaluator.ts:379](</Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2/packages/permissions/src/evaluator.ts:379>)). A user with one of those project/team grants but no workspace_member row is excluded by the legacy SQL predicate, yet can pass canonical project reach when the authoritative project facts are present. The observer evidence then hard-codes false before that policy result can be compared, recording denial agreement (or a capability denial) rather than exposing legacy-deny/policy-allow. This defeats the purpose of parity evidence for precisely the reach dimensions omitted by the legacy predicate.

**Source-based reproduction:** for an active task in workspace W, take an authenticated identity with reach.kind = membership, no workspace membership for W, and a persisted project membership for the task’s project (or membership in its persisted owning team). The primary query’s reachableWorkspacePredicate is false, so the observer query’s NOT branch returns the live task anchor and records legacy denied. The canonical reaches(identity, projectFacts) returns true through the project/team branch. Passing the emitted matching { resource: task, id } into buildShadowPolicySide sets inReach=false at lines 305–312, so that canonical allow is suppressed. The focused suite’s current observer test asserts exactly this unconditional inReach=false behavior for the matching anchor; it does not test an identity whose independent canonical reach is true.

**Required disposition:** do not use the negated legacy predicate as a policy-side inReach answer. For this case, keep shadow outcome unevaluated unless independent persisted facts sufficient to run the canonical policy reach evaluator are loaded; alternatively compare a separately represented native-reach fact without feeding it into evaluatePolicy. Preserve masked response and bounded observer behavior. Add regression coverage for project membership, ancestor membership, and team-owned-project reach so the old-deny/new-allow case cannot be collapsed into agreement.

This finding is about shadow accuracy, not whether the native read should currently allow the request. No claim is made about the pending clean-date/cutover acceptance window.

## Non-blocking observations

- **Capability response/OpenAPI migration:** /api/capabilities removes the previous 409 malformed-role response and documents a 200 all-false map for a member with an unknown/malformed role. The generated OpenAPI contract removes the 409/schema in step with the runtime route. The web consumer continues to consume the same 16 booleans and defaults false while loading/errors; it has no special 409 branch. The updated contract is internally consistent with the stated desired behavior. The checked integration scope test covers nonmembers and workspace scoping; the unknown-role end-to-end assertion is in the shadow-mode integration file rather than the standalone capability-scope file.
- **Self-policy membership:** registry validation admits workspaceMembership only as literal true on a self policy, and both strict and shadow evaluators query the exact caller/workspace persisted membership joined to an extant workspace, limit to two, and require exactly one row. A global instance-admin role does not itself satisfy this condition. Unknown role strings remain separate from membership: the route can return its own false map while the normal permission checker refuses missing/ambiguous/unknown role authority.
- **Observer bounds and response preservation:** the typed anchor is sourced from route middleware configuration rather than path parsing; lookup is gated by shadow mode, GET, and an exactly matched row-scoped capability policy. Observer query errors are caught without replacing native response behavior. The direct task observer currently supplies no project/team facts, which reinforces B1: those missing facts must remain unknown, not be replaced with the legacy negative.
- **Read-only asset observer:** the asset branch performs its own typed id/project join and identical native reach negation after the main query fails. It sets workspace row evidence but does not emit nativeReachDenialEvidence; this avoids the same forced-negative shortcut. No scope mismatch was demonstrated in the checked route contract.

## Limits and workspace integrity

No live PostgreSQL reproduction was run because dedicated runtime proof is owned separately. The blocker is established by the current source predicates, canonical evaluator branches, and the focused pure evaluator behavior, not by a speculative race. I did not inspect private runtime logs or disclose secrets/authentication artifacts. Full canonical CI, image/traffic proof, hosted shadow cleanliness, clean UTC-date evidence, Sol security review, and phase finalizer remain outside this ordinary review.

The source checkout remains unchanged: HEAD is still 01f258c6761ed935a16ace80695c597078519a11, git status --porcelain is empty, and git diff --quiet succeeds.
