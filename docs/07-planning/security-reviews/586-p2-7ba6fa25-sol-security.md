# Independent GPT-6 Sol security review — P2 approval continuity / withdrawal

**Reviewer:** GPT-6 Sol, fresh independent context; I did not author, direct, or remediate this candidate.  
**Reviewed head:** 7ba6fa25fe89448fd2c38334a4f6509b26591742  
**Comparison base:** f4789aefd3c3d08595642414dda63770d8973f64  
**Scope:** Complete 13-file source delta, with adjacent approval service/domain, identity resolver, canonical permission evaluator, API-key scope helper, workflow approval gate, and current approval contracts/decisions.  
**Verdict:** **BLOCKED for merge at this SHA** by one candidate API-state regression below. The reviewed change did not show an authorization escalation, key-ceiling bypass, DTO privacy leak, or flag-off workflow bypass. This is a per-candidate security review, not a P2 phase finalizer or acceptance.

## Blocking finding

**B1 — Terminal-state withdrawal now returns 403 instead of the documented 409.** In `apps/api/src/approval/index.ts:379-385`, the new route precheck maps every `canWithdrawApproval` refusal to 403. That helper invokes `evaluateApprovalWithdrawal`, which returns `not_pending` for approved, rejected, expired, and withdrawn rows (`repository.ts:609-626`, domain evaluator). Thus a requester or instance admin with otherwise valid withdrawal authority who retries after a decision or withdrawal gets 403. Before this delta, the request reached `withdrawApproval`, which maps `not_pending` to 409 under the locked row (`service.ts:347-355`); the route's OpenAPI declaration still advertises 409 (`index.ts:170`). This changes observable API behavior, conflates terminal state with permission denial, and bypasses the intended locked-state conflict response on normal retries. Preserve authorization precedence: an unauthorized caller should still receive 403 without learning terminal state, while a requester/admin with current reach, role authority, and (for keys) scope should receive 409 for a terminal row. The old service checked `not_pending` before `not_permitted` and could itself expose 409 to a caller who had passed only the coarse route capability check; do not restore that disclosure while repairing this regression. Add both authorized and unauthorized terminal-state retry assertions before refreezing. The one lifecycle integration test passes but does not assert these cases.

## Security trace and findings

- The approved October 6 flag-off rule is retained: create checks the resolved project/workspace/instance flag; existing list, decide, withdraw and reminder paths do not gate on it, and the workflow transition gate still evaluates stored approvals. No picker behavior was introduced.
- The new `canWithdraw` boolean derives from pending state, requester or instance-admin identity, current work-item reach and `approval:request` authority. Non-admin withdrawal uses canonical `can()` and current reach; the instance-admin exception retains AP-7. The POST route reloads target and row and applies the same helper. The service then locks live item and approval row and checks pending/requester-or-admin again. State, outbox event and audit row commit in one transaction. Authorization facts checked before the transaction can change concurrently, an existing TOCTOU residual, so this review does not claim serializable revalidation of reach or roles under lock.
- The candidate projects validated Better Auth resource/action key statements through `apiKeyHasCapabilityScope` onto registered capabilities. The identity mapper refuses disabled, mismatched-owner, banned, inactive and customer key identities; `can()` intersects current role authority with key capabilities. The added admin withdrawal branch explicitly requires a key-held `approval:request` capability. No key scope escalation was found in the changed paths.
- The response adds only `canWithdraw`; the DTO still omits email. Work-item approval listing remains behind current item reach and, for staff, `work_item:read`; customer rows remain addressed/requester filtered. `/api/me/approvals` and portal lists remain addressed-approver lists. Decision notes stay out of activity/outbox metadata in the inspected service.
- The work-item UI uses the server boolean only for a pending-row button. The POST independently rechecks authority; the mutation invalidates approval/work-item queries and errors offer reload. The author browser journey uses a mocked API and proves built-UI interaction only.

## Verification actually run

- Exact HEAD and clean worktree checked before and after review; `git diff --check` passed.
- `env -u TASKDESK_DATABASE_URL CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts tests/api-integration/approval-lifecycle.test.ts` passed: **1 file / 1 test**, real isolated Testcontainers PostgreSQL. This does not cover B1's terminal-state retry.
- Read the three independent ordinary GPT-6 Luna notes at this SHA. A ran the same PG lifecycle **1/1** successfully. B ran changed web Vitest **3 files / 16 tests**, web typecheck, OpenAPI **230 operations**, and builds successfully. B and C's local PG attempts failed setup with `28P01` before assertions and are not counted as passing integration evidence. Their verdicts are clear for their scopes; B1 is independently found here.
- I did not rerun the broad test suite, browser journey, image/runtime checks, or hosted CI.

## Residuals outside this candidate finding

The generic contract gate reports four inherited pending-action `user_deactivation` enum differences versus `origin/main`, outside this 13-file delta; it is not waived. The built-UI mock browser proof is not a live-API browser journey. Port 4178 is occupied by an unrelated worktree and was left untouched. Approver-picker semantics remain unapproved. P0 accepted main `3096cb044bdf6ae98488bfc385f532fa6386343a` and DEV `e26db50e23b2d685c7277c63bc9ee71a8076fcee` were not changed or assessed for phase acceptance here.
