# P2 approval continuity and withdrawal — source review record

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
