# Ordinary review A — P0 bulk candidate

- **Reviewer:** fresh independent GPT-6 Luna context; did not author, direct, or remediate this candidate.
- **Exact candidate:** `1bc20f3492e84a1fb6ddb8e52a7b7ad340653657`.
- **Checkout:** `git rev-parse HEAD` matched the exact candidate; `git status --porcelain=v1` was empty at start and end. No source or repository file was edited. This report is outside the checkout at the requested private path.
- **Verdict: CLEAR.** No blocking or non-blocking source findings identified in the checked scope. This is this reviewer’s ordinary-review disposition only; it does not clear other required reviewers, security review, CI, runtime acceptance, or phase gates.

## Scope checked

Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, current `status.md`, newest relevant `decision-log.md` entries, `docs/01-architecture/rbac.md` (including route policies and native-read shadow evidence), and the applicable identity/reach contracts. Inspected current capability-introspection route/policy, `workspace-access-middleware.ts` typed loader and observer branches, `shadow-context.ts`, `shadow-middleware.ts`, `shadow-evaluation.ts`, `resolve-identity.ts`, and `packages/permissions/src/evaluator.ts`.

Inspected the preserved `docs/07-planning/security-reviews/579-luna-a-01f258c6-bulk.md` without changing its wording. Its disclosed comparison-SHA transcription typo does not alter the exact candidate SHA it records. Its B1 was genuine on that source: the native negative-reach result was copied into policy `inReach`. Current source removes that shortcut. I kept that historical BLOCK distinct from this exact-head verdict.

Inspected current regression coverage in `tests/api/permissions/shadow-evaluation.test.ts`, the relevant new cases in `tests/api-integration/permissions-shadow-mode.test.ts`, `tests/api-integration/capabilities-scope.test.ts`, and the existing `tests/api-integration/multi-role-membership-remediation.test.ts` migration-0050 recovery scenarios. The integration cases include persisted project-membership denial-vs-policy-allow evidence with a preserved native 404, no-reach workspace-member policy denial, persisted foreign-row disagreement, missing/deleted/observer-error unknown outcomes, shadow-off observer-query suppression, malformed-role self-introspection with an all-false map, and bulk multi-role authority evidence.

## Reviewer-run commands and counts

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/permissions/shadow-evaluation.test.ts` — **1 file, 37 tests passed**.
- `pnpm --filter @taskdesk/permissions exec vitest run --config vitest.config.ts src/evaluator.fail-closed.test.ts src/registry.test.ts` — **2 files, 66 tests passed**.
- Two initial invocations used `pnpm exec vitest` at the workspace root / package config paths and failed before test collection with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "vitest" not found`. These were command-resolution mistakes, not test failures; the corrected package-filtered commands above ran successfully.

No PostgreSQL-backed integration tests, full E2E, containers, image/build, or hosted traffic were run. The shared heavy window was not released. Thus the migration-0050 integration tests and new database-backed observer cases were inspected but are not counted as reviewer-run results. Author-reported test counts in `status.md` were not represented as my own.

## Authority/reach disposition

- **Observer evidence is separate from policy reach.** The typed observer lookup is gated by shadow mode, GET, exact matched registered row-scoped capability policy, and route middleware’s typed resource/id. It applies the negation of the same native reach predicate only in the observer query. On a proven live row it sets legacy denied and exposes persisted scope facts; it does not write `nativeReachDenialEvidence` or feed that result to policy reach. A repository-wide search found no current-source `nativeReachDenialEvidence` reference in application, package, or test code.
- **Canonical reach is independently evaluated.** For project/work-item rows, `buildShadowPolicySide` requires matching typed project/workspace facts and calls `reaches(identity, projectReachFacts)`. The loader’s `currentProjectReachFacts` currently supplies actual project/workspace/organisation identifiers and explicitly empty ancestor / null owner-team facts. The RBAC contract states those relations are absent from the current schema and must remain unavailable until implemented; there is no inference from native denial, HTTP status, URL, or caller input. Customer work-item reach remains unevaluated when required private visibility facts are absent.
- **Allowed and observer rows:** normal typed lookups carry row-derived project facts into shadow context; observer-only project/task/time-entry/activity/comment/column paths do likewise where their persisted joins establish project and workspace scope. Other resource types without project reach facts do not gain fabricated facts. Identity loading reads persisted workspace memberships and scoped project/workspace/organisation memberships joined to roles/scope owners, plus team memberships constrained to a current workspace membership. Role mapping retains validated role/capability authority separately from reach. `reaches()` handles instance-wide reach, workspace reach, project membership, ancestor membership, owning-team membership, and customer organisation reach according to supplied facts.
- **Native masked outcomes and comparison:** observer lookup cannot alter the native handler result. A proven denied live row allows the testable project-membership counterfactual to remain `legacy_deny_policy_allow`; evidence is recorded rather than forced into agreement. Missing/inactive/ambiguous/unavailable observer facts are not transformed into authoritative absence for policy evaluation: they leave scope/reach unavailable or record an evaluator error/unevaluated outcome. Observer exceptions are caught without changing the original masked response.
- **Self-introspection:** `/api/capabilities` is a session-only self policy requiring exactly one persisted membership joined to an extant workspace. Instance-admin global reach alone does not satisfy the membership condition. An unambiguous member with an unknown/malformed role receives an all-false map; the ordinary permission/write path continues rejecting malformed role authority. Missing or duplicate membership remains denied. The current tests explicitly cover the malformed-role all-false behavior and persisted direct-project disagreement.
- **No strict activation or clean-date claim:** neither this review nor the status evidence is treated as strict-mode acceptance or as a clean UTC date.

## Findings

### Blocking

None identified on exact candidate `1bc20f3492e84a1fb6ddb8e52a7b7ad340653657` in the checked source scope.

### Non-blocking

None.

## Limitations

This is source review plus 103 reviewer-run pure tests across three files. Database execution of the newly added observer fixtures and multi-role migration recovery was not independently rerun because the user restricted PostgreSQL/heavy shared-window work. The current source contract and pure reach/parity tests support the disposition, but this report makes no claim that those unrun integration paths passed in this review. No strict-mode, clean-date, browser, full E2E, container, build, hosted G11, or production acceptance claim is made.
