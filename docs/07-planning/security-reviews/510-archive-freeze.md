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

## Exact-head merged-main security addendum — 2026-10-01

**Model:** GPT-6 Sol
**Reviewed head:** `183c25ee8e7b4bb1c80fbdfdbb12f0beba43eaa8`
**Comparison:** prior reviewed source `8b5307794d5fd1308f49b4985d33ce8e34a45014`;
merged main `991d3cf55251ff5383e30589c28051adf282e2ac`.
**Verdict:** CLEAR for #510's security integration delta and legacy archive-freeze scope.

Fresh independent reviewer context; the reviewer did not author, direct, or remediate the
candidate. The legacy write, archive, assignment and project-liveness source paths are
unchanged from the prior reviewed source. The reviewer inspected pending-action and outbox
schema, migrations and service interactions plus identity-helper call sites; no production
caller connects these additions to legacy writes or authority. No new finding arose in
#510's scope.

The existing #515 pending-action resolver omission of `project.archived_at` was
independently confirmed. It has no production caller and is unchanged by #510; correction
and regression coverage remain required before #428 wiring.

`git diff --check 8b530779..183c25ee` passed. No local API or integration tests ran because
the reviewer's dependency tree was absent. Live exact-head GitHub checks showed build,
unit/component, static, OpenAPI, domain coverage, route policy and permission matrix, G4,
G8 and CodeQL passing; Postgres integration remained pending and template/security review
failed while this note was stale. G11 was not enabled. This is no gate waiver or merge
recommendation.

Review: https://github.com/ThomasHeinThura/ticketing/pull/510#issuecomment-5919084285
