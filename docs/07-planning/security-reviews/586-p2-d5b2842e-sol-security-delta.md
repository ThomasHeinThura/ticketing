# Independent GPT-6 Sol security delta review — P2 approval withdrawal

**Reviewer:** GPT-6 Sol, fresh independent context. I did not author, direct, or remediate either candidate.  
**Reviewed head:** d5b2842ece9263bd3ffe6719be445092d9947ddc  
**Comparison base:** 7ba6fa25fe89448fd2c38334a4f6509b26591742  
**Scope:** The complete six-file remediation delta in approval route, repository, service, domain evaluator/tests and lifecycle integration test, plus adjacent callers and the original exact-head Sol report.  
**Verdict:** **CLEAR for this bounded security delta.** Original B1 is resolved at this head. No new blocking or non-blocking candidate findings. This is not a new bulk panel, P2 finalizer, merge clearance for unrelated gates, or phase acceptance.

## B1 disposition and security trace

- The domain helper now returns separate `authorized` and `actionable` facts. `authorized` means requester or instance admin; `actionable` additionally requires pending state. The existing `evaluateApprovalWithdrawal` wrapper preserves its caller-visible reason contract.
- `canWithdrawApproval` adds the current API-key `approval:request` ceiling, current work-item reach and current role capability to the domain actor authorization. Keys without the scope remain unauthorized, including keys owned by an instance admin. The admin exception remains limited to the actor and key-ceiling rules. No grant or permission vocabulary was added.
- The response uses `actionable` only for `canWithdraw`. A terminal approval therefore reports false even to its authorized requester/admin. The POST route uses `authorized` and returns 403 before revealing terminal state to a nonrequester or narrow key. An authorized caller reaches the service, which locks the live work item and approval row and returns 409 if that row is terminal. The service repeats actor authorization under the row lock and performs no mutation on either refusal. Thus the original 403-for-authorized-terminal regression is fixed without restoring the older terminal-state disclosure to unauthorized callers.
- Successful withdrawal still updates state and writes notification outbox and audit in one transaction. The remediation changes no DTO shape, feature-flag resolution, decision path, UI, schema, dependency or route policy. The original flag-off continuity, key-ceiling and DTO privacy conclusions remain applicable to this unchanged source.
- All production callers of `evaluateApprovalWithdrawalDecision`, `evaluateApprovalWithdrawal`, `canWithdrawApproval` and `withdrawApproval` were enumerated. There is no other HTTP caller bypassing the route precheck. The service's locked authorization check covers actor identity; the route-level current reach/role/key facts are still pretransaction facts, as before this delta.

## Verification actually run

- Exact clean checkout HEAD matched `d5b2842ece9263bd3ffe6719be445092d9947ddc`; `git diff --check 7ba6fa25fe89448fd2c38334a4f6509b26591742..HEAD` passed.
- `env -u TASKDESK_DATABASE_URL CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts tests/api-integration/approval-lifecycle.test.ts` passed: **1 file / 1 test** with isolated Testcontainers PostgreSQL. The new assertions cover all four terminal states; requester, instance-admin session and correctly scoped admin key get 409; a nonrequester and narrow requester key get 403 without terminal-state text; `canWithdraw` is false; terminal rows and withdrawal audit/outbox counts do not change.
- `pnpm --filter @taskdesk/domain exec vitest run src/approvals/approvals.test.ts` passed: **1 file / 79 tests**, including the new actor/state split.
- Read the independent GPT-6 Luna delta note at this SHA. Its PG **1/1** and domain **1/79** are separate corroborating runs, not counted as my executions.

## Residuals

The route resolves current reach, role and key facts before entering the service transaction, and they are not serializably reloaded under its lock. This pre-existing current-authority TOCTOU window remains open; no new race was introduced by this status/precedence correction, and this review makes no serializable revalidation claim. The original Sol report for `7ba6fa25` remains BLOCKED historical evidence and is not relabeled. Broad CI, browser, image/runtime and hosted acceptance were not rerun here. The generic contract-gate pending-action enum residual and mocked-API browser evidence are unchanged. This delta pass does not establish P2 completion.
