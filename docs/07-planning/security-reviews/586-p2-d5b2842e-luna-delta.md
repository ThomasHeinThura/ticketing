# Independent ordinary delta review — P2 approval withdrawal

**Reviewer:** GPT-6 Luna, fresh independent context; I authored neither the original candidate nor this remediation.  
**Reviewed head:** d5b2842ece9263bd3ffe6719be445092d9947ddc  
**Comparison base:** 7ba6fa25fe89448fd2c38334a4f6509b26591742  
**Verdict:** CLEAR for this bounded remediation delta. No blocking or non-blocking findings.

## Scope and inspection

Reviewed all **6 changed files** in the exact delta and read the preserved original Sol blocker at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-07/p2-7ba6fa25-sol-security.md`. Traced all repository callers of `evaluateApprovalWithdrawalDecision`, the compatibility wrapper `evaluateApprovalWithdrawal`, `canWithdrawApproval`, and `withdrawApproval`.

The revised domain result keeps authorization separate from actionability. The repository helper incorporates API-key ceiling, current reach, and capability into authorization, then keeps pending-state actionability separate. The DTO consumes only actionability; the route rejects unauthorized callers before entering service code; the transaction locks the live work item and approval and repeats authority/state evaluation before any write. Thus authorized terminal retries return 409, including the row-lock race where a row becomes terminal after the route precheck. Unauthorized callers and keys without `approval:request` remain 403 without terminal-state disclosure. No alternate caller bypasses the route precheck, and no authority expansion or new race was introduced by this delta. Audit/outbox effects remain after successful mutation and in the same transaction.

## Verification performed

- `env -u TASKDESK_DATABASE_URL CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts tests/api-integration/approval-lifecycle.test.ts` — passed: **1 file / 1 test**, isolated Testcontainers PostgreSQL. The test covers all four terminal states, requester/admin session and scoped-admin-key 409s, nonrequester/narrow-key 403s, response affordance false, no state disclosure, unchanged terminal state, and no extra withdrawal effects.
- `pnpm --filter @taskdesk/domain exec vitest run src/approvals/approvals.test.ts` — passed: **1 file / 79 tests**, including the new authority/actionability split and compatibility reason behavior.
- `git diff --check 7ba6fa25fe89448fd2c38334a4f6509b26591742..HEAD` — passed.
- Confirmed exact HEAD and clean source worktree after verification.
- Scope count: **6 changed files**.

## Residuals

The precheck’s current reach/role/key facts are not reloaded under the transaction lock; this is the same authorization-fact TOCTOU residual documented in the original Sol report and predates this narrow status/precondition fix. I did not rerun browser, build, or broad CI checks; this delta changes no UI, schema, dependency, or route policy. This is one strong ordinary delta review, not a replacement for the required independent GPT-6 Sol review, a phase finalizer, or phase acceptance.
