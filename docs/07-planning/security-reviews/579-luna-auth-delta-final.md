# Independent ordinary review — P0 auth lifecycle delta

- **Candidate:** `37f8f46685db8dedf92a978692ff96928882c5a0`
- **Reviewed delta:** `19a9bcbad8c0cc8b2af65fa4f6aa5606de37f855..37f8f46685db8dedf92a978692ff96928882c5a0`
- **Source:** `4c826b5`
- **Reviewer:** fresh independent GPT-6 Luna context; did not author, direct, or remediate this candidate.
- **Checkout:** requested root; HEAD verified exact; tracked and untracked working tree clean at start and end.
- **Review shape:** one recheck of the completed implementation batch, including the full audit lifecycle finding; not a tiny-fix panel.
- **Verdict:** **Clear — no blocking or non-blocking findings in the assigned auth delta scope.** This is ordinary review only, not the required fresh GPT-6 Sol security review, acceptance, or phase completion.

## Checks actually run

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/auth/local-factor-policy.test.ts --reporter=dot` — exit 0; **1 file, 2 tests passed**.
- `CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/local-factor-policy.test.ts --reporter=dot` — exit 0; **1 file, 6 tests passed**. This ran through the CI integration/Testcontainers PostgreSQL harness.
- `git diff --check 19a9bcbad8c0cc8b2af65fa4f6aa5606de37f855..HEAD` — exit 2 due only to trailing whitespace on four metadata lines in the separate, unchanged historical runtime/web review records; no source or auth report whitespace issue.
- Verified `git status --short` clean; no tracked changes made.

## Scope inspected

Read `AGENTS.md`, agent workflow, CLAUDE operating guide, current status and decision log; the complete original auth report `579-luna-auth-bulk-final.md`; audit-trail AU-14 and step-up action catalogue; security-model step-up contract; API step-up contract; audit writer/savepoint behavior; the full delta and relevant current lifecycle source/tests.

Inspected shared `step-up-audit` metadata construction and AU-14 handling; challenge issuance/attempt limits and factor/password/nonce proof; exact session/person/operation binding and expiry in step-up service; reset-MFA and metrics-token rotation consumption transactions; mutation rollback/denial paths; actor derivation; and the new Testcontainers coverage. Runtime/web scopes cleared at `19a9bcb` remain historical and were not re-reviewed here.

## Original finding disposition

The prior blocker was the absence of `auth.step_up_consumed` and `auth.step_up_denied` writes. The delta adds one shared helper constrained to fixed operation/route metadata and wires issue, consumption and denial across challenge/proof and both current consumers. Consumption audit append is inside the protected mutation transaction; denial on ordinary failed proof is appended on the durable database path, while mutation-specific denial is recorded after rollback or inside the denial-only transaction. Audit append uses the writer's nested savepoint; failure is caught, increments the `mutation` failure counter, safely logs, and attempts durable administrator notification without changing the auth response or rolling back the protected mutation.

Review found no proof, nonce, token, digest, submitted body, password, or reset verification note in the new step-up audit payload. Keys are existing registered actions; operation and route values are fixed by a closed mapping. No authority or response weakening was found.

The new actual-PostgreSQL tests exercise issued/consumed/denied metadata, bad nonce/factor, wrong binding, expiry, target factor change, replay, challenge limits, and a forced consumed-audit SQL failure. The failed audit case verifies the metrics-token mutation commits, one durable audit-failure notification is produced, and the prior consumed audit row remains the only consumed row. The reset target-change test confirms no phantom consumed audit is committed and the still-valid confirmation can be retried after the protected target condition is restored.

## Findings

None blocking. None non-blocking.

## Scope and limits

No broad API suite, full repository suite, browser, image/runtime proof, hosted check, runtime/web re-review, or GPT-6 Sol pass was run. This verdict clears only the requested ordinary AUTH DELTA review at the exact candidate SHA; the required independent GPT-6 Sol security review follows only after ordinary clearance.
