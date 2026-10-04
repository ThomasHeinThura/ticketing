# Independent ordinary review — P0 final bulk delta, auth/security slice

- **Candidate:** `19a9bcbad8c0cc8b2af65fa4f6aa5606de37f855`
- **Base:** `8ddb9de8d4d242a0832f6f91e12872300480a905`
- **Original reviewed candidate:** `add896ebbce5c827d30f89d80fed5e48c87b3552`
- **Reviewer:** fresh independent GPT-6 Luna context; did not author, direct, or remediate this candidate.
- **Checkout:** `codex/p0-bulk-integration`, clean at review start; HEAD verified exactly matches candidate.
- **Review shape:** one final integrated bulk-delta review after implementation; not a small-fix panel.
- **Verdict:** **Changes requested — one blocking audit-completeness finding.** This is a scoped ordinary review verdict, not security clearance, acceptance, or P0 completion.

## Scope inspected

Read the required repository workflow and model guidance, latest status checkpoint, newest decision-log entries, original auth review, auth/identity and security-model contracts, pending-action and realtime contracts, relevant audit-trail clauses, and the scoped source/tests.

Inspected auth/session portal and CSRF request plumbing; local-factor policy lookup and route enforcement; Better Auth factor hooks; step-up challenge/proof issuance, exact binding, expiry, verifier and consumption; MFA reset durable effects; metrics-token proof consumption; and WebSocket Host/Origin guard wiring. Principal files: `apps/api/src/auth/{auth.ts,csrf-token-api.ts,factor-status-api.ts,factor-status-policy.ts,local-factor-policy.ts,local-factor-service.ts,step-up-api.ts,step-up-service.ts}`, `apps/api/src/utils/csrf-protection.ts`, `apps/api/src/index.ts`, `apps/api/src/instance/{local-factor-policy.ts,reset-mfa.ts,observability/metrics-token-rotation.ts}`, `packages/libs/src/hono.ts`, plus the listed focused tests.

## Checks actually run

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/auth/portal-cookie-boundary.test.ts tests/api/auth/local-factor-policy.test.ts --reporter=dot` — exit 0; **2 files, 4 tests passed**.
- `CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/csrf-protection.test.ts ../../tests/api-integration/local-factor-policy.test.ts ../../tests/api-integration/local-factor-policy-concurrency.test.ts --reporter=dot` — exit 0; **3 files, 9 tests passed**. This used the CI/Testcontainers isolated PostgreSQL harness. Covered CSRF protection, factor policy API/enrollment and reset, step-up attempts, and role deletion/policy-write concurrency.

No full suite, browser journey, listener/raw duplicate-Host test, build, or deployment was run. The auth report on the original candidate claimed no confirmed source-level blocker, but its focused test command did not execute; its verdict is not approval of this head. No secrets were copied into this record.

## Blocking finding

### F1 — Step-up use and denial are not audited

`docs/03-features/audit-trail.md` § “What is audited” requires authentication and denials regardless of outcome; its audit action catalogue explicitly requires `auth.step_up_issued`, `auth.step_up_consumed`, and `auth.step_up_denied`, recording the fixed binding/operation and route without proof material. The action keys are registered in `apps/api/src/audit/actions.ts`, but source search finds no caller for either `auth.step_up_consumed` or `auth.step_up_denied`.

`apps/api/src/auth/step-up-api.ts` appends `auth.step_up_issued` only after successful proof (around lines 404–427). Failed password/factor/nonce proof returns `step_up_unavailable` without a denied audit record. `apps/api/src/auth/step-up-service.ts` atomically changes the proof row from issued to consumed (around lines 245–264), but does not audit that transition. The two protected consumers—`apps/api/src/instance/reset-mfa.ts` and `apps/api/src/instance/observability/metrics-token-rotation.ts`—consume the proof in the same transaction as their mutation, but only audit the domain mutation afterward; neither emits `auth.step_up_consumed`.

This leaves successful use and failed attempts of a security-sensitive re-authentication control absent from the audit trail, contrary to the explicit audit contract. Add the appropriate audit records transactionally with consumption where feasible, and record denial without storing proof, nonce, token, hashes or submitted request bodies. Regression tests should assert both successful consumption and rejected proof audit outcomes. **Blocking.**

## Other inspected guarantees

Source inspection found the challenge/proof binding includes fixed operation and route plus version or reset target/note; nonce and proof are canonical 32-byte base64url values; digests are stored; challenge and token expiry use database time; session/person/portal are rechecked; challenges are serialized/rate-bounded per session and operation; proof rows are locked and consumed once in the operation transaction. Reset locks the target user, revokes sessions and API keys, deletes factor material, commits a durable in-app notice, and attempts email only after SMTP availability is checked; audit failure is signaled without rolling back the reset. Role-policy mutation and role deletion use matching lock ordering, and the required-role lookup fails closed. Focused tests corroborate selected cases but are not substitutes for those source checks.

## Surfaces not checked

No complete P0 test matrix, app browser journey, live Node listener/WebSocket raw-header behavior, exact-hosted CI state, image/boot proof, current-head G11, or Sol security review. This report does not disposition UI/runtime/web findings assigned to other scopes and does not establish protected acceptance or stage completion.
