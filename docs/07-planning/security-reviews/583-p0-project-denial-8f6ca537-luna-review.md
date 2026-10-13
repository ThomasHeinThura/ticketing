# Independent ordinary delta review — PR #583

**Reviewed head:** `8f6ca5375171eb0740fae7d4eecfe56deaef2c0b`  
**Base:** `d479a72a3dd3f4f48473e62d5d933ad83c94fa2c`  
**Review scope:** current delta only; not the P0 phase finalizer or full-stage acceptance.  
**Independence:** fresh reviewer context; did not author, direct, or remediate this candidate.  
**Verdict:** **CLEARED — no blocking findings in this delta.**

## Candidate and live state

The checkout resolves to the exact requested head. The delta contains 8 modified files: six API route/middleware files, the generated OpenAPI contract, and `tests/api-integration/project-reach-guard.test.ts`. No whitespace errors were found by `git diff --check`.

Live GitHub PR #583 is open and its head matches the reviewed SHA. At inspection, the integration/Postgres 18 and other full-suite jobs were still in progress; the fast `contract - OpenAPI drift` job and `route policy coverage + permission matrix` were successful. The fast `pull request template + security review` check was failing at that snapshot. I did not treat CI as complete or infer why that check failed.

## Governing contract checked

- `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, and the OpenAI operating guidance in `CLAUDE.md`.
- `docs/07-planning/decision-log.md`, 2026-10-04, “Preserve canonical project reach when repairing native project reads”: ordinary workspace membership alone is not project reach; no policy-scope broadening; reached users still need the declared capability; denied reach stays masked with 404.
- `docs/01-architecture/rbac.md` Reach and the separation between reach and authority.
- `docs/01-architecture/api-design.md` masking behavior and `docs/04-engineering/testing-strategy.md` API reach/capability test expectations.

## Findings

### Blocking

None.

### Non-blocking

None.

## Delta assessment

The shared `workspaceAccessMiddleware` change is narrowly conditional on `requireProjectReach`: when a project lookup has no row after its existing reachable-workspace predicate, that project read now returns 404 “Project not found.” For a resolved row, it still calls `projectReadDecision`; unreachable is 404 and insufficient capability is 403. The delta does not change the reach predicate, add membership/reach, alter a policy registration, or move a policy to workspace scope. Mutation routes without the read flag retain the existing unresolved-project 400 path. The changed API route declarations are GET reads, and the changed OpenAPI responses match the resulting masked status behavior.

The new integration case iterates the 11 `PROJECT_READ_ROUTES` entries. For each it requests an existing foreign project and a valid random missing project (22 valid-ID requests total), expecting 404 and the same exact body, “Project not found”; it sends an encoded NUL-bearing ID to all 11 and expects 400. It snapshots audit-log and outbox counts around these requests and asserts no count changes. Existing test setup also exercises the route capability checks and shadow agreement before this new masked-404 section. Source inspection confirms no grant or capability predicate change in this delta.

OpenAPI drift validation passed locally: `pnpm check:openapi` reported that `tests/api-contract/openapi.json` matches all 173 operations. `git diff --check` passed. The API fast CI route-policy and permission-matrix job was green when queried.

## Test limitation

I attempted the focused integration test `project-reach-guard.test.ts` through the API Vitest integration config. It reached the test but failed during database setup with PostgreSQL authentication error for user `postgres`; the configured local database credentials are unavailable in this worktree. This is an environment limitation, not a test assertion failure. GitHub’s Postgres 18 integration job was still running when checked, so its result remains the authoritative pending evidence.

## Files inspected

- `apps/api/src/utils/workspace-access-middleware.ts`
- `apps/api/src/column/index.ts`
- `apps/api/src/project/index.ts`
- `apps/api/src/task/index.ts`
- `apps/api/src/work-item/index.ts`
- `apps/api/src/workflow-rule/index.ts`
- `tests/api-integration/project-reach-guard.test.ts`
- `tests/api-contract/openapi.json`

This review clears only the ordinary delta review tier for this exact head. It does not certify required Sol review, CI completion, protected merge readiness, or P0 completion.

## Evidence-path correction

This review was initially written to the author packet path by mistake, replacing its prior contents. I searched the dated evidence directory and the broader TaskDesk evidence tree; no retained copy or backup of the original author packet was found. The original bytes are therefore not recoverable from the evidence available to this reviewer. This file is the preserved review, not a reconstruction of the author packet. The local focused integration test failed at PostgreSQL authentication during setup and is **not** test clearance.
