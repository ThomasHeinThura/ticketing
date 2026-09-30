# PR #510 — project archive freeze security review

**Model:** GPT-6 Sol
**Verdict:** CLEAR for the security delta; prior PR-15 security verdict still holds.
**Reviewed head:** `35d3b452137ef9bf890913828b51d40751e7cc90`
**Reviewed head:** `51c4b976e9bd5083e352f26d6997b4479e1e3255`

Fresh independent GPT-6 Sol context; reviewer did not author or remediate the candidate.
The full PR-15 security review at `51c4b976e9bd5083e352f26d6997b4479e1e3255` found no
blocking security issue. The current delta review confirms that verdict at the new source
head and found no new blocking security finding.

The intervening source commit merges `main` and the P0 G8 visual-regression work. The
delta changes no `apps/api/**`, `tests/api-integration/**`, `tests/api-contract/**`,
`packages/permissions/**`, or `packages/domain/**` path. The review examined the added
visual CI job, root script and manifest wiring, G8 scope checker and probes, and G8 review
note. These changes do not alter project archive, legacy-write, membership, relation, or
permission logic.

The earlier full review covered PR-15 project archive and soft-delete serialization,
transaction-scoped project liveness guards, legacy task write paths, membership locking and
assignment races, relation mutations and project refresh events. The existing regression
in `tests/api-integration/authorization-boundaries.test.ts` exercises two bulk status
updates, asserts both status events, and asserts exactly one project-wide relation refresh.

## Validation at the reviewed source head

- Passed: `pnpm check:visual-scope` (3 screenshot cases; 2 active inventory rows mapped
  out of 122).
- Passed: `node --test scripts/ci/check-visual-scope.test.mjs` (148/148 tests).
- Passed: `git diff --check 51c4b976e9bd5083e352f26d6997b4479e1e3255..35d3b452137ef9bf890913828b51d40751e7cc90`.
- GitHub exact-head Postgres 18 integration, permission matrix/route coverage,
  unit/component, OpenAPI, build, visual-regression (G8), and CodeQL checks passed.
- The `pull request template + security review` check was red while the committed exact-head
  review note and review evidence were pending. This review does not waive that check or
  declare the PR merge-ready.
- G11 performance-budget check was not enabled.

No merge recommendation is made. The broad implementation change still requires its third
independent GPT-6 Luna review, and all enabled required checks must pass on the final
note-only candidate head.
