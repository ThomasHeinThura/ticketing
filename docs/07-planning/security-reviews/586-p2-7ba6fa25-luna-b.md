# Independent ordinary review — P2 approval withdrawal/continuity

- **Reviewer:** GPT-6 Luna, fresh independent context B; did not author, direct, or remediate this candidate.
- **Exact candidate:** `7ba6fa25fe89448fd2c38334a4f6509b26591742`
- **Reviewed delta:** `f4789aefd3c3d08595642414dda63770d8973f64..7ba6fa25fe89448fd2c38334a4f6509b26591742` (13 files)
- **Verdict:** **CLEAR for this scoped candidate delta.** No blocking or non-blocking implementation finding identified in the changed code. No P2 phase-completion claim.

## Scope checked

Read repository workflow/model guidance, current approvals contract and data model references, the 2026-10-06 approval continuity and storage/reach decisions, the relevant review notes, and the complete 13-file diff. Traced response formatting and OpenAPI schema, withdrawal authorization/domain evaluator, API-key scope projection through the identity resolver and canonical evaluator, locked state/event/audit behavior, UI query/mutation invalidation/error states, and addressed-approver list behavior.

Key conclusions:

- `canWithdraw` is an affordance derived from the existing AP-6/AP-7 domain rule. For a non-admin requester it additionally requires current work-item reach and `approval:request` under current role authority; for an instance admin it retains the AP-7 exception. API-key identities are clamped to the key's stored scope before the evaluator intersects that ceiling with current authority, including the admin path.
- The POST handler reloads the target and stored approval row and applies `canWithdrawApproval` before service execution. The service locks the live work item and approval row, re-evaluates requester/admin eligibility and pending state, and writes state, outbox event, and audit row in one transaction. The flag-off path does not suppress existing approval reads, withdrawal, or workflow gates.
- `/api/me/approvals` and `/api/portal/approvals` remain addressed-approver lists; requester controls are on work-item detail. No approver-picker or creation behavior was added.
- DTO additions expose only a boolean. No email or additional personal fields were introduced. UI withdrawal is shown only for pending responses with `canWithdraw`; mutation success invalidates approval and work-item queries, while errors explain stale state/permission and offer a reload. Buttons use native accessible semantics; loading and query-error states remain present.

## Verification actually run

- Web Vitest: exact 3 changed test files — **3 files, 16 tests passed**.
- Web typecheck: passed (`tsc` app and node projects).
- `pnpm check:openapi`: passed; committed contract matches **230 operations**.
- `pnpm test:contract`: failed on four OpenAPI breaking changes for `user_deactivation` enum values in pending-action endpoints. Those endpoints/files are outside the reviewed 13-file delta and are inherited from the base branch; this is a branch-level residual, not an approval-delta finding. Redocly reported the same 17 findings as `origin/main`.
- API approval lifecycle integration test: **not exercised**; database setup failed with PostgreSQL password authentication for `postgres` before test behavior ran (teardown also failed on the same credential issue).
- Agent and portal production builds: passed.
- Independent Playwright visual rerun: blocked before tests started because `127.0.0.1:4178` was already served by another worktree (`p4-integration-ci-remediation-1006`). No live API E2E is claimed. The author-reported browser test is a built-UI test with a mocked API, not live API E2E.
- `git diff --check` on the candidate delta: passed. Checkout remained clean; no source edits made.

## Residuals / limits

The branch-level OpenAPI contract failure and unavailable PostgreSQL integration execution remain to be resolved or accounted for by the orchestrator's broader candidate checks. The alternate-port visual rerun was not completed. This review covers the specified 13-file delta only and does not substitute for the required GPT-6 Sol security review or P2 phase finalizer.
