# P2 approval continuity and withdrawal — source review record

## Complete approval browser test placement correction

**Reviewed head:** `12cac9c19522a47493d3ca6c5727872d70dc2ec1`

Fresh independent ordinary Luna and full bounded Sol are CLEAR on this two-file batch fromb499ad3b. The actual withdrawal interaction journey moves from the visual-only suite into ordinary E2E; API request/response, refresh, withdrawn status, absent button and screenshot assertions remain. The static visual fixture and15cases/14active routes are preserved. Both reviewers verify ordinary test discovery; retained author Chromium1/1 passes, with exact configs/logs/source/build/screenshot hashes retained privately. No reviewer reruns the browser merely for comfort. No runtime/checker/schema/dependency/baseline changes or gate waiver. Current hosted CI, OpenAPI versioning, G11, liveAPI/image and P2 acceptance remain separate.

### Independent ordinary report (verbatim)

# Independent ordinary review: P2 browser test scope correction

- **Reviewer:** GPT-6 Luna, fresh independent context; did not author, direct, or remediate the candidate.
- **Verdict:** CLEAR — no blocking or non-blocking findings.
- **Reviewed head:** `12cac9c19522a47493d3ca6c5727872d70dc2ec1`
- **Base:** `b499ad3b4ff418a074f5fbf7742b1abeecb2b9c7`
- **Scope:** `apps/web/e2e/visual.spec.ts`, `apps/web/e2e/approval-withdrawal.spec.ts`; P2 approval contract and Playwright/G8 placement.

## Review

The correction is limited to the two stated E2E files. The static G8 helper now returns an empty approval list for the work-item detail screenshot fixture. Its API fixtures remain static; its named screenshot cases, visible-route assertions, viewport/theme cases, and screenshot assertions are preserved. No screenshot baseline, inventory, checker, config, runtime, schema, or dependency changes are present in the candidate diff.

The moved ordinary browser case preserves the prior journey and assertions: install the authenticated API fixture, open `/agent/work-items/HELP-7`, observe the pending approval, click **Withdraw request**, wait for the withdrawal response and assert HTTP 200, assert the withdrawn state, assert the withdrawal button is absent, and retain an output screenshot. The fixture holds mutable approval state and changes it only for the matching POST withdrawal endpoint. It provides the CSRF token and cookie on the CSRF endpoint, within the local `**/api/**` mock. This is mocked-API browser evidence, not live API acceptance.

The default Playwright config points to `./e2e` and ignores only the two visual specs, so the new spec is included in the ordinary suite. It is not a screenshot-only test: it drives the visible button, observes the HTTP response, and checks updated UI state. The captured screenshot agrees with the assertions.

`apps/web/e2e/**` is in the repository’s security-scope path list. This change does not alter authorization, the checker, or the core gate criteria. It does correct which suite owns the test, restoring G8’s constrained static fixture and placing the interaction in ordinary E2E. Apply the bounded scope-correction review tier: one ordinary review and the required independent GPT-6 Sol pass. No core authority or gate-rule redesign was found.

## Checks and evidence inspected

- `pnpm check:visual-scope` — PASS: 15 screenshot cases, 14 active inventory route rows mapped (125 route rows total).
- `pnpm --filter @taskdesk/web exec playwright test --config playwright.config.ts --list e2e/approval-withdrawal.spec.ts` — PASS: exactly 1 test in 1 file is discovered by the ordinary config.
- `pnpm exec biome check apps/web/e2e/visual.spec.ts apps/web/e2e/approval-withdrawal.spec.ts` — PASS.
- `git diff --check b499ad3b4ff418a074f5fbf7742b1abeecb2b9c7 12cac9c19522a47493d3ca6c5727872d70dc2ec1` — PASS.
- Inspected retained author browser output: Chromium, 1 test passed. Inspected its `approval-withdrawn.png`; the withdrawn approval is visible and no withdrawal control is present. No duplicate browser run was performed.
- Checkout was clean at the reviewed SHA.

Retained implementation evidence is in `/Users/heinthura/.codex/taskdesk-evidence/2026-10-07/postp0-visual-scope-full-batch/summary.md` and its listed raw logs/artifacts. This review does not claim hosted/live-API acceptance, full CI green, or phase acceptance. The earlier full CI result remains red as reported by the orchestrator; API-version, G11, and other tracked residuals remain separate.

### Independent full security report (verbatim)

# Independent GPT-6 Sol security review: P2 browser test scope correction

- **Reviewer:** GPT-6 Sol, fresh independent context. I did not author, direct, or remediate this candidate.
- **Exact candidate SHA:** `12cac9c19522a47493d3ca6c5727872d70dc2ec1`
- **Base:** `b499ad3b4ff418a074f5fbf7742b1abeecb2b9c7`
- **Verdict:** CLEAR for this bounded security-scope correction. No blocking or non-blocking findings in the reviewed diff.
- **Risk tier:** `apps/web/e2e/**` is explicitly security scope in `docs/04-engineering/ci-cd.md`. The correction changes which required browser suite owns one existing interaction test, a narrow gate pass/fail case. The ordinary GPT-6 Luna report at this SHA is CLEAR; this is the separate required full GPT-6 Sol pass.

## Scope and reasoning

The candidate changes only `apps/web/e2e/visual.spec.ts` and adds `apps/web/e2e/approval-withdrawal.spec.ts`. I compared the test and fixture to the parent commit. The ordinary case preserves the same route, pending-approval visibility check, visible withdrawal-button click, withdrawal-response HTTP 200 assertion, withdrawn-state check, absent-button check, and output screenshot. The new mutable fixture updates approval state only on a `POST` to the specific withdrawal path; the subsequent approvals GET returns that state, so the UI checks exercise query refresh. The fixture supplies a session and a CSRF token plus cookie for the mock browser flow. These are deterministic intercepted API responses; the test does not establish backend permission, CSRF enforcement, or live API acceptance, and does not claim to.

The visual fixture now always returns an empty approval list for the work-item detail screenshot. No named G8 screenshot case, screenshot assertion, route assertion, viewport/theme case, or baseline was removed or changed. The ordinary Playwright config discovers the new spec and ignores only the two visual specs; the G8 config matches `visual.spec.ts`. There is no `test.skip`, hidden ignored coverage, synthetic HTML in place of the app, policy change, checker change, configuration change, or security-gate bypass in the candidate diff.

## Checks actually performed

- Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, and the `docs/04-engineering/ci-cd.md` browser/security-scope sections; inspected the ordinary Luna report and retained author evidence.
- Inspected `git diff` from base to exact head, both Playwright configs, the withdrawal mutation/fetcher, and the resulting browser screenshot. The screenshot shows the withdrawn approval and no withdrawal control.
- `pnpm check:visual-scope` — PASS: 15 screenshot cases, 14 active inventory route rows mapped, 125 route rows total. Storybook story coverage is checked at runtime by that checker.
- `pnpm --filter @taskdesk/web exec playwright test --config playwright.config.ts --list e2e/approval-withdrawal.spec.ts` — PASS: exactly one ordinary E2E test in one file discovered.
- `pnpm exec biome check apps/web/e2e/visual.spec.ts apps/web/e2e/approval-withdrawal.spec.ts` — PASS: two files.
- `git diff --check b499ad3b4ff418a074f5fbf7742b1abeecb2b9c7 12cac9c19522a47493d3ca6c5727872d70dc2ec1` — PASS; working tree clean at reviewed head.
- Inspected the author's retained scoped Chromium log: one test passed against a locally built preview, using a temporary port-only Playwright config retained in private evidence. I did not rerun the browser case.

The exact source hashes match the implementation record: `visual.spec.ts` `54955f00c59dd5f824be3d5a92158f79c7e3799f899c2f31fea4e9de90875fc8`; `approval-withdrawal.spec.ts` `a21eb0cc5c1b61d1bf1ddfc7bfe7fbc5040b9f5a133cfa77736d2f546560b827`.

## Limits

This verdict covers only this frozen test-placement diff. It does not clear hosted CI, OpenAPI, G11, the container image/health gate, live API acceptance, or P2 stage acceptance. Those residuals remain independently gated.

---

## Completed positive-fixture and approved SDK delta

**Reviewed head:** `38f96f3b34ebda03b9314abfb238cd4e829137c3`

Fresh independent Luna ordinary review and full bounded Sol pass are CLEAR on the complete five-file delta fromc89c11c0. Runtime permissions and test assertions are unchanged; positive fixtures now provide the exact registered scopes their operations require. Both existing SDK users require^1.31.0, resolving1.32.1. Author matching fixture source passed2files20native tests before lock refresh; the redundant later acquisition was cancelled and is not counted. MCP7files31/build/types/dependency gates/audit pass as separately reported author evidence; audit retains one LOW advisory. Independent checks are described verbatim below. No OpenAPI/G8/G11, full CI/image/provider or phase acceptance waiver is claimed.

### Independent ordinary report (verbatim)

# Independent ordinary review — P2 fixture and MCP SDK delta

- **Reviewer:** GPT-6 Luna, fresh independent context; did not author, direct, or remediate this batch.
- **Candidate SHA:** `38f96f3b34ebda03b9314abfb238cd4e829137c3`
- **Base SHA:** `c89c11c01a0b55214d453cdf598b6ff640f3af38`
- **Scope:** the exact five changed files: `apps/api/package.json`, `packages/mcp/package.json`, `pnpm-lock.yaml`, `tests/api-integration/api-key-bearer.test.ts`, and `tests/api-integration/work-item-activity-wiring.test.ts`.
- **Verdict:** CLEAR for this bounded ordinary-review scope. No blocking or non-blocking findings.

## What I checked

- Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/04-engineering/sdlc.md`, `docs/04-engineering/coding-standards.md`, the API-key/MCP contract in `docs/03-features/webhooks-and-api-keys.md` and `docs/03-features/mcp-server.md`, and the relevant RBAC/API-key rules in `docs/01-architecture/rbac.md` and `docs/01-architecture/auth-and-identity.md`. Checked the current decision-log entries on AK-9 and the recorded notification self-write boundary.
- Inspected the full five-file diff against the stated base and the exact candidate tree. The changes are limited to explicit test fixture scopes and the approved SDK range/lock refresh; runtime source and permission evaluator/policy code are unchanged.
- Confirmed the activity fixtures grant only `work_item:create`, `work_item:update`, and `work_item:set_priority`. The API-key create/update tests then assert `actorType: api_key`, the key owner's identity as `actorId` in both activity row and event, and the API-key create event's `source: api`. The existing session-source assertion remains present.
- Confirmed the bearer-auth fixture uses only `project:read`, matching the read route it exercises.
- Inspected adjacent negative/security coverage: `api-key-self-mutations.test.ts` still asserts the nine protected personal-key self-writes return `403 session_required`; the API-key permission rekey test still asserts a key missing the canonical capability gets `403` before migration; capability/role denials remain unchanged. No negative assertion was deleted or weakened by this diff.
- Confirmed both workspace importers and the corresponding lock snapshots now specify `^1.31.0` and resolve to the single `@modelcontextprotocol/sdk@1.32.1` entry, with a pinned integrity value and its exact dependency snapshot. `creem`'s lock dependency points to the same version. No `1.30.0` SDK package/snapshot remains. This matches the approved floor supplied for this batch and is a deterministic lockfile resolution.
- `git diff --check BASE...CANDIDATE` passed; worktree was clean at review.

## Tests and reproductions

I did not rerun tests: this is a fixture/dependency-lock delta, and the supplied run record says the author ran both native test files (20 tests passed) before the lock refresh. I inspected the affected assertions and neighboring denials directly. I did not run PostgreSQL/Testcontainers, Docker, network-dependent dependency tooling, or full feature tests; no concrete risk in this five-file diff justified duplicating them.

## Residual gates

This report clears only the bounded ordinary Luna review. The required independent current-head GPT-6 Sol confirmation remains outstanding. The known OpenAPI `user_deactivation` enum/version and G8/G11 red integration residuals remain open and are neither assessed nor waived by this review.

### Independent security report (verbatim)

# P2 API-key fixtures and MCP SDK floor — independent GPT-6 Sol security review

**Reviewed head:** 38f96f3b34ebda03b9314abfb238cd4e829137c3

- Comparison base: `c89c11c01a0b55214d453cdf598b6ff640f3af38`; the candidate worktree HEAD was verified equal to the reviewed head and clean.
- Independence: fresh GPT-6 Sol context; I did not author, direct, or remediate this candidate.
- Scope: exact five-file delta in `apps/api/package.json`, `packages/mcp/package.json`, `pnpm-lock.yaml`, `tests/api-integration/api-key-bearer.test.ts`, and `tests/api-integration/work-item-activity-wiring.test.ts`.
- Classification: bounded security-scope dependency and authorization-test-fixture correction. The candidate alters no API-key parser, evaluator, route policy, or production authorization source. A strong ordinary Luna review and one full bounded Sol pass are appropriate. This report does not re-review the unchanged approvals feature.

## Security assessment

**CLEAR — no blocking or non-blocking findings in this bounded security delta.** The fresh independent GPT-6 Luna ordinary review `p2-fixture-sdk-delta-luna-38f96f3b.md` is also CLEAR on this exact head. I read its verdict and scope after completing my independent source inspection. The required ordinary-then-Sol review order is satisfied for this frozen five-file delta.

The bearer test now stores `{project:[read]}` for its project-list success case. The activity test helper now stores `{work_item:[create,update,set_priority]}` for its three API-key create/update cases, including the priority update. These are positive fixtures: the patch changes no assertion, expected status, unknown-token rejection, malformed-header rejection, or negative scope test. The stored JSON shape is consumed by `verify-api-key.ts`, copied to request context by `authenticate-api-request.ts`, and checked by the unchanged `require-api-key-permission-scope.ts` predicate. A missing or invalid map still grants no scope; the key scope still narrows the caller's current role. Work-item PATCH still requires `work_item:update` plus `work_item:set_priority` when priority is supplied. The related approvals lifecycle test retains wrong-scope 403/no-side-effect assertions in the unchanged base.

Both manifests raise the existing `@modelcontextprotocol/sdk` floor from `^1.30.0` to `^1.31.0`. The lockfile resolves both importers and its `creem` edge to **1.32.1** with one matching package/snapshot entry. No SDK imports or MCP tool/server code changed. I inspected the actual runtime imports in `packages/mcp/src/server.ts` and `cli.ts`; the MCP TypeScript build compiles them against the installed graph. This confirms compatibility at build level, not a full behavioral certification of the third-party SDK.

## Checks actually run and source binding

- `git diff --check c89c11c0..38f96f3b`: passed.
- `pnpm --filter @taskdesk/mcp build`: passed (`tsc -p tsconfig.json`). A following `pnpm --filter @taskdesk/mcp typecheck` reported `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` because this package has no `typecheck` script; it is not a failed TypeScript build.
- I inspected the exact diff, key verification/scope predicate, caller route capability seam, test cases, MCP runtime imports, and lockfile graph. No PostgreSQL, Docker, browser, or network check was run in this review.
- The author reports native/API-key focused tests and MCP tests/build/dependency checks on this head; those are author evidence, not checks I ran. The Luna report independently inspected the affected assertions and neighboring denials and cites the author's two-file, 20-test pass before the SDK lock refresh; neither Luna nor I reran those native tests after the lock refresh. I do not recast these counts as my independent test results.

## Residual / merge boundary

The inherited OpenAPI enum, G8/G11, full CI, deployment/browser, and stage-finalizer obligations remain outside this delta review. No gate is waived. This verdict is source-bound to the 40-character head above; a changed head requires delta review at its actual risk tier. Only the top-level orchestrator may evaluate merge readiness.

---

**Reviewed head:** `d5b2842ece9263bd3ffe6719be445092d9947ddc`

This is a source-bound review record for the isolated P2 checkpoint. It does not claim full integration CI, live browser/API acceptance, protected merge, provider acceptance or P2 completion. The original product source is unchanged by this review-only descendant.

## Independent review lineage

Three fresh independent Luna contexts reviewed the complete thirteen-file API/frontend batch at `7ba6fa25fe89448fd2c38334a4f6509b26591742` against `f4789aefd3c3d08595642414dda63770d8973f64`. All ordinary verdicts were clear in their recorded scopes. The independent full Sol pass found B1: an authorized withdrawal retry against a terminal approval returned403 rather than the documented409. Its original blocked verdict remains unchanged.

The six-file structural remediation separates actor authorization from pending actionability. DTO `canWithdraw` remains false for terminal states; unauthorized callers receive403 without state disclosure, while the locked service returns409 for authorized terminal retries. A strong independent Luna delta and full independent Sol security delta clear exact `d5b2842ece9263bd3ffe6719be445092d9947ddc`. Neither reviewer authored or remediated the source.

## Actual proof and residuals

The author and independent reviewers separately passed the updated isolated PostgreSQL lifecycle test (one file/one comprehensive test), including all four terminal states and requester/session-admin/scoped-admin-key versus unauthorized/narrow-key outcomes, state/effect preservation and no terminal-state disclosure. Independent delta reviewers passed the domain suite (one file/79 tests). Ordinary UI review passed three files/16 tests, types, OpenAPI230 operations and both web builds. Exact commands/counts remain in the unchanged reports.

The actual built-UI browser journey uses mocked API routes; no live browser/API integration is inferred. Two ordinary reviewers' local database authentication failures happened before assertions and are not test passes. One generic contract run found four inherited pending-action `user_deactivation` differences versus origin/main; that integration residual is not waived or cleared by this source review. The pretransaction authority-fact TOCTOU remains documented, with no serializable claim. Approver-picker/new-request semantics remain outside this completed existing-request slice. P0 closure is independent.

## Original artifacts

- [p2-7ba6fa25-luna-a.md](586-p2-7ba6fa25-luna-a.md) — original reviewer bytes, SHA256 `4e5fc9e4cfaba7212c1c61f91a72f2056153185adcb8e9f913d59fdcc6ef9930`.
- [p2-7ba6fa25-luna-b.md](586-p2-7ba6fa25-luna-b.md) — original reviewer bytes, SHA256 `1a78cd751cdf5e049de24ada19255e816c05df9bc2b189fee596861af8f06a69`.
- [p2-7ba6fa25-luna-c.md](586-p2-7ba6fa25-luna-c.md) — original reviewer bytes, SHA256 `35d5ff95a0a2a79a9174a3eaa744e42784460e2a086a700d1e7dd3d56d963e50`.
- [p2-7ba6fa25-sol-security.md](586-p2-7ba6fa25-sol-security.md) — original reviewer bytes, SHA256 `4e2b45ace60d506e9da007998e56f192f2a95ab559dfc45a088c451b22abd390`.
- [p2-d5b2842e-luna-delta.md](586-p2-d5b2842e-luna-delta.md) — original reviewer bytes, SHA256 `8fdf8cc5a669cdc30ad48269037af9ad8c4827c5718e656b7d5276e89f7dfc90`.
- [p2-d5b2842e-sol-security-delta.md](586-p2-d5b2842e-sol-security-delta.md) — original reviewer bytes, SHA256 `d8e6be3083542d700d7c07ef2667cc73b9e9add0a070bfeb2ae4320262e1c301`.
