# Independent ordinary review C — P2 approval flag continuity and withdrawal

- **Reviewer:** GPT-6 Luna, fresh independent context C; not author, fixer, or directing implementation.
- **Candidate:** `7ba6fa25fe89448fd2c38334a4f6509b26591742`
- **Comparison:** `f4789aefd3c3d08595642414dda63770d8973f64..7ba6fa25fe89448fd2c38334a4f6509b26591742`
- **Checkout:** `/Users/heinthura/.codex/worktrees/p2-approval-flag-continuity-20261007/Ticketing.v2`; HEAD matched candidate; clean working tree before review.
- **Verdict:** **CLEAR** for the reviewed contract/integration scope. No blocking or non-blocking findings.

## Scope and evidence inspected

Read the canonical repository instructions, agent workflow and model policy, current status checkpoint, P2 ledger, newest decision-log entries, approvals feature contract, and relevant existing permissions/identity code. Reviewed all 13 paths in the complete comparison, with detailed attention to the API handlers/repository/schema, OpenAPI delta, feature spec and integration additions; also inspected the withdrawal UI/fetcher/mutation and visual fixture/test changes. Confirmed that the project/workspace/instance flag hierarchy and its built-in false default remain authoritative, and that the approved 2026-10-06 continuity decision only blocks new requests while leaving existing approval operations/reminders governed by current permissions and reach.

The new `canWithdraw` affordance is computed from the domain pending/requester-or-admin predicate, current canonical work-item reach, current `approval:request` authority, and API-key capability ceiling. The withdrawal handler uses the same helper before dispatching to the service, and the service re-evaluates the pending-state transition under its row lock. Session instance-admin withdrawal remains available without requester reach; API-key withdrawal requires the frozen `approval:request` scope, consistent with the spec's capability-ceiling statement. The affordance does not grant decision authority. Staff work-item visibility remains behind `work_item:read`; customer work-item visibility remains restricted to addressed/requester rows. The personal and portal approval lists are addressed-approver lists, so requester withdrawal is correctly surfaced on work-item detail rather than by broadening those endpoints.

New-request creation still checks the effective approvals flag and request/request-CAB permissions. Read/list, decision, withdrawal, reminder scan, and workflow transition enforcement do not consult the flag, preserving existing approvals and gate requirements while disabled. The withdrawal event/audit path remains in the existing transactional service boundary. Workflow gate semantics are not changed by this candidate; the surrounding API continues to require matching transition identity and CAB kind as applicable. Approver-picker route/candidate behavior remains a separate unresolved contract question and is not represented as implemented or approved here.

The new `canWithdraw` field is present in the runtime Zod response schema and the checked-in OpenAPI baseline for approval response sites. UI affordance is gated by server `canWithdraw` plus pending state; errors retain a reload affordance. The visual browser fixture mocks CSRF, approval-list and withdrawal responses, so it demonstrates the built UI interaction only and is not real-API browser evidence.

## Checks actually run

- `git diff --check f4789aefd3c3d08595642414dda63770d8973f64..HEAD` — passed.
- `pnpm check:openapi` — passed; baseline matches API, 230 operations.
- Focused `approval-lifecycle.test.ts` via the API Vitest integration config — **blocked before assertions**: PostgreSQL authentication failed for user `postgres` (`28P01`). The test file reports one test; zero assertions completed. Cleanup then hit the same database authentication failure. No database state was changed by this run.
- No broad suite or browser run performed; reviewer B owns UI tests and author browser evidence is mocked API.

## Findings and residuals

No candidate finding. Residual acceptance evidence remains separate: successful PostgreSQL integration execution, the required independent Sol security pass, exact-head hosted checks and required browser/runtime evidence. Approver-picker contract/source is explicitly still pending; this review does not close that question or claim P2 acceptance, human design review, or phase completion.
