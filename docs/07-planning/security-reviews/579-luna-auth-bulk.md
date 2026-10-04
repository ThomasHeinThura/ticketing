# Independent ordinary review — P0 PR #579 auth domain

- **Candidate:** `add896ebbce5c827d30f89d80fed5e48c87b3552`
- **Base:** `8ddb9de8d4d242a0832f6f91e12872300480a905`
- **Reviewer context:** fresh independent GPT-6 Luna review context, task lane `/root/p0_bulk_auth_review`; did not author, direct, or remediate the candidate.
- **Scope:** auth/session portal and Host/Origin behavior; CSRF token issuer, client retry and redirect behavior; TOTP/backup-code enrollment, enforcement and reset; step-up challenge/proof issuance and consumption; WebSocket Host/Origin checks.
- **Verdict:** **No confirmed blocking source-level finding in the assigned slice from inspection.** This is not an approval of the candidate or a claim that the assigned runtime/browser acceptance passed.

## Files and evidence checked

Read the required root instructions and workflow/model guidance, the newest `status.md` context, the current decision log, `docs/01-architecture/auth-and-identity.md`, `docs/01-architecture/pending-actions.md`, the PR #573 WebSocket contract/review note, and the auth-related code/tests below.

Production files inspected:

- `apps/api/src/auth.ts`
- `apps/api/src/auth/csrf-token-api.ts`
- `apps/api/src/auth/factor-status-api.ts`
- `apps/api/src/auth/factor-status-policy.ts`
- `apps/api/src/auth/local-factor-policy.ts`
- `apps/api/src/auth/local-factor-service.ts`
- `apps/api/src/auth/step-up-api.ts`
- `apps/api/src/auth/step-up-service.ts`
- `apps/api/src/instance/local-factor-policy.ts`
- `apps/api/src/instance/reset-mfa.ts`
- `apps/api/src/utils/authenticate-api-request.ts`
- `apps/api/src/utils/csrf-protection.ts`
- `apps/api/src/utils/request-origin.ts`
- `apps/api/src/ws/origin-policy.ts`
- relevant auth guard and WebSocket handler sections in `apps/api/src/index.ts`
- `packages/libs/src/hono.ts`

Challenge tests/source inspected (not executed):

- `tests/api-integration/csrf-protection.test.ts`
- `tests/api-integration/local-factor-policy.test.ts`
- `tests/api-integration/local-factor-policy-concurrency.test.ts`
- `tests/api/request-origin.test.ts`
- `tests/api/ws/origin-policy.test.ts`
- `apps/web/e2e/mfa-csrf-journey.spec.ts`

## Checks actually run

- Verified checkout `HEAD` equals the candidate SHA above; working tree was clean at start.
- Attempted the focused command with the supplied Node 24 runtime: `pnpm exec vitest run tests/api/request-origin.test.ts tests/api/ws/origin-policy.test.ts tests/api/auth/local-factor-policy.test.ts tests/api-integration/csrf-protection.test.ts tests/api-integration/local-factor-policy.test.ts --reporter=dot`.
- **The command did not run:** `pnpm` returned `Command "vitest" not found` (exit 254). Dependencies were not installed. No test, build, database, listener, or browser execution is claimed by this review.
- The reported full Node 24 unit/integration and E2E results in the evidence packet are author evidence on their stated source SHAs and are not reviewer-run results.

## Findings

None confirmed in the inspected implementation slice.

The inspected boundaries are internally consistent by source: the CSRF token is MACed, short-lived and bound to session plus configured agent origin; cookie-session unsafe requests require the expected Origin/Referer and matching double-submit token; client retries are restricted to recognized CSRF error bodies and unsafe requests disable redirect following; local-factor protected API/WS paths fail closed when factor policy cannot be loaded and deny required-but-unenrolled agent sessions; factor disable and backup-code regeneration are blocked through Better Auth; step-up challenge creation and proof use per-session/operation advisory locking, persisted nonce/token digests, challenge/expiry checks, and row-locked state transitions; reset consumes operation-bound proof and revokes target sessions and API keys in one transaction; WS session upgrades require matching configured Host, stored portal, and exact Origin.

Evidence anchors include `apps/api/src/utils/csrf-protection.ts:30-79,214-258`, `packages/libs/src/hono.ts:116-194`, `apps/api/src/auth.ts:608-650,706-765`, `apps/api/src/index.ts:166-181,1060-1086,1240-1426`, `apps/api/src/auth/step-up-service.ts:94-159,342-439`, `apps/api/src/auth/step-up-api.ts:232-430`, `apps/api/src/instance/reset-mfa.ts:59-146`, and `apps/api/src/ws/origin-policy.ts:29-75`.

## Residuals / limits

- Exact-candidate focused unit/integration tests and browser journey were not run because Vitest is absent in this checkout; installation was outside this read-only review task.
- The assigned checks need a live listener/runtime challenge for raw duplicate Host behavior and actual WebSocket upgrade ordering; this review only inspected source and existing tests. In particular, WS handlers use `c.req.header("Host")` with `checkWebSocketOrigin`, while the general HTTP/2 Host/authority parser is in `utils/request-origin.ts`; the current tests do not establish raw duplicate-Host behavior at the listener.
- This assignment is ordinary review only. The candidate still requires the independent GPT-6 Sol security review for its security-scope changes, exact-head CI/gate evidence, and all stage acceptance obligations. This report does not close P0 or claim phase-finalizer, browser, deployment, soak, or human review acceptance.
