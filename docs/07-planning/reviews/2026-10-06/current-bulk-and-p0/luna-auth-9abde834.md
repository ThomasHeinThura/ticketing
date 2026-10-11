# Independent ordinary authorization review — PR #589 auth delta

- Candidate: `9abde83428283df0f630fb3dc1e0774bd50e84e3`
- Reviewed delta: `c2fd8153676baecc958c089988f60ab156b26aff..9abde83428283df0f630fb3dc1e0774bd50e84e3`
- Worktree: `/Users/heinthura/.codex/worktrees/bulk-integration/Ticketing.v2`
- Independence: fresh ordinary reviewer context; I did not author or remediate this candidate. My earlier independent review was of the original provider/auth head, not this remediation.
- Scope: complete six-file auth-related delta and its calling paths; AK-9, RBAC/API-key intersection and portal/session contracts; focused API unit test. No source edits. No SQL, Docker, browser or performance work.

## Verdict

**BLOCK — one credible authorization finding remains in a legacy permission path.** The new canonical capability guard correctly intersects role grants with the API key's exact resource/action scope, including self-target fallback, and fails closed for missing or malformed scope. But authenticated API keys with a null scope still bypass the older `requireWorkspacePermission` scope check and inherit the user's full role on routes using that guard. This directly contradicts AK-9's read-only-by-default rule and RBAC's `current owner RBAC ∩ key capability subset` contract. The candidate should not clear ordinary authorization review until the null-scope behavior is fail-closed or the supported credential contract proves such keys cannot authenticate.

### Program finding (also blocking for authorization clearance)

- **[P1] Null API-key scope bypasses legacy authorization scope enforcement.** `verify-api-key.ts:13-14,57` maps a persisted SQL `NULL` scope to `permissions: null`. `require-workspace-permission.ts:95-97,240-245` only rejects when `apiKey?.permissions` is truthy; with `null`, it proceeds to `hasWorkspacePermission` and authorizes from the current membership role. Concrete affected mutation routes include project creation/update/delete (`apps/api/src/project/index.ts`, `requireWorkspacePermission({ project: ... })`), task-relation create/delete (`apps/api/src/task-relation/index.ts`, `work_item:update`), workspace/member/invitation mutations (`apps/api/src/workspace/index.ts` and `apps/api/src/invitation/index.ts`). For an authenticated key whose persisted `permissions` is SQL NULL, the verifier returns a present API-key object with `permissions: null`; the legacy middleware conditional is skipped, then membership-role statements authorize. This is a source-level reproduction; I did not run DB-backed requests. AK-9 requires every personal key to be read-only by default with writes explicitly opted in, and RBAC defines effective key authority as the owner's current RBAC intersected with the key capability subset. The separate `require-api-key-permission-scope.ts` helper correctly rejects null/missing, but is wired only to service-calendar/SLA routes, so it does not close these legacy paths. The new `apiKeyHasCapability()` correctly rejects null/missing on the canonical capability paths; this parallel legacy gap remains reachable on the composed candidate and is a concrete program finding that must stay open for the structural legacy/canonical authorization remediation.

## Delta checks

- `apiKeyHasCapability()` distinguishes absent API key (session path, allowed through to role check) from present key (must contain exact `resource:action`); `null`, undefined scope, missing resource/action, and malformed capability strings deny.
- `assertCallerHasCapability()` performs scope rejection before resolving role; the role check remains freshly read and fail-closed.
- `assertCallerHasCapabilityOrSelf()` intersects each branch independently: ordinary capability needs its exact key scope and role grant; self fallback needs `isSelfTarget`, the self capability in the key scope, and the role grant. A key scoped only to `work_item:update` can use the documented self assignment path but cannot gain `work_item:assign` through self-target status alone.
- The capability middleware passes the authenticated key. The manual callers updated in this delta also pass it for priority, assignment, bulk assignment/delete, unassignment, asset `workspace:read`, and service-calendar capability introspection. I found no omitted call among the changed direct callers.
- The strict-runtime integration delta adds a positive scoped self-assignment case. The inherited remediation packet reports its negative missing-scope/state-preservation probe on the prior change; I did not rerun integration because this lane is explicitly barred from SQL/container resources.
- The WebSocket fixture now performs its no-cookie request before installing the session mock, so that 401 is genuinely unauthenticated. Portal-mismatched and unbound sessions returning 401 at request authentication match `auth-and-identity.md`; the authenticated wrong-origin/boundary checks remain separate.

## Verification

- Exact candidate resolved to `9abde83428283df0f630fb3dc1e0774bd50e84e3`; worktree was clean at review start.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/utils/require-workspace-capability.test.ts` — **1 file, 20 tests passed**.
- No integration, native SQL, browser, container, or performance suites were run. This review does not clear the three preserved SQL failures or other panel findings.

## Non-blocking / retained context

- The delta fixes the stated canonical capability-path API-key intersection, but the legacy null-scope bypass above needs resolution before authorization clearance. This report does not reopen previous provider/domain findings or imply they passed.
- No conclusion is made about the remaining full PR gates, hosted CI, human spec approval, or merge readiness.
