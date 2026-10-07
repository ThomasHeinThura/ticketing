# Independent full security review — P1–P4 integrated candidate

**Reviewed head:** 5e611b9d95b5aa120daa21c02373f87273903677

- **Accepted comparison base:** 3096cb044bdf6ae98488bfc385f532fa6386343a
- **Reviewer:** fresh GPT-6 Sol security context. I did not author, direct, or remediate this candidate. This is the per-candidate security review, not a P0–P4 phase finalizer.
- **Verdict:** **CLEAR for the exact reviewed head.** I found no blocking security defect in the inspected composed authority surfaces. This verdict does not claim that CI, protected merge, deployment, phase completion, or actual Entra interoperability has occurred.

## Security inspection and finding disposition

1. **God Mode deactivation and PA-15.** Traced the registered instance-admin route from `apps/api/src/instance/users/index.ts` through `createPendingAction`, `approvePersonDeactivation`, `consumePendingActionProof`, and `transitionPersonLifecycleInTransaction`. Request creation is session-only through `requireGodMode`, and the pending-action service independently requires a staff-side active admin requester, the exact route policy and one person target. Approval locks the action, actor, current agent session, and target; checks current admin authority, payload hash and route/target binding, current account email, and exact typed email before consuming a single-use pending-action/session/person-bound proof. The lifecycle, action state, instance-scoped outbox rows and audit writes share the transaction. The shared lifecycle disables native `apikey` rows by required `reference_id`, deletes sessions, retires the documented grant set and reprojects authority. The issued-key schema requires `reference_id` and the tests seed that native shape. The scheduler's supported instance-action branch was checked against the earlier d725 expiry finding.
2. **SCIM and identity scope.** Inspected dedicated bearer resolution and mutation-time `lockAndVerifyScimMutation`, user create/update/deactivate routes, the SCIM lifecycle wrapper, identity connection/SCIM admin elevation call sites, OIDC session-source binding, membership grant projection and cutover. SCIM requests derive connection/portal/organisation from the token, never accept an application session identity, and recheck token hash, enablement, resource allowlist and scope after locking for writes. The SCIM active=false path now inserts `identity.deprovisioned` and audit with source and lifecycle counts in the outer transaction, resolving the earlier d725 finding. OIDC/SCIM grants retain source-specific provenance; no path inspected grants `instance:admin` from provider claims. The migration runner requires the cutover boundary and owner reconciliation before existing membership authority is classified; it does not silently infer unknown source grants.
3. **Tenant and event persistence.** Checked 0110/0111 outbox constraints plus the runtime event allowlist: instance-scope events require an empty scope and one of the four declared event kinds. Checked 0112 DDL: workspace, project, work-item type and work-item SLA pointers now use workspace-bearing composite foreign keys, resolving the earlier cross-workspace schema finding. Calendar and SLA repository reads/writes are workspace-scoped, and their policy entries are registered. The migration journal and snapshots are unchanged after the already cleared d209 schema review.
4. **Accepted P0 boundary preservation.** Rechecked composed `index.ts` entry points for structured redacted error logging, asset legacy-shadow observation, and WebSocket origin/session-portal checks plus API-key enabled/owner freshness fields. The source retains these alongside the new routers. The latest UI-only d209-to-5e correction contains no API, schema, policy, package, script or workflow implementation change; the exact-head ordinary Luna authority/schema confirmations and UI review are retained separately.
5. **Gate and status claims.** Read the current status/decision-log and the direct Thomas query-stage receipt. The decision defers complete repository query ownership and `check:queries` acceptance to P4 issue #580, without waiving an existing protected check or authorizing a P4 stage claim. Live GitHub read showed #580 open; no review or deployment claim was inferred from that. The prior d725/d209 blocked reports remain historical records, not silently relabeled as passes.

## Checks actually performed

- Confirmed `HEAD` is the 40-character reviewed SHA and the working tree was clean before writing this private report.
- Inspected the accepted-base-to-head changed-file inventory and targeted source, migration, schema, spec, ADR, test and prior independent-review passages listed above.
- `git diff --check 3096cb044bdf6ae98488bfc385f532fa6386343a..5e611b9d95b5aa120daa21c02373f87273903677` passed.
- Queried live open PR and issue lists; this exact candidate was not represented as an already merged or approved PR by that query.
- **No tests, integration database mutations, browser journeys, image build or runtime boot were run by this reviewer.** Root's full-unit 12/12 tasks, 321 files and 2446 tests, current image build, and isolated 113-migration/non-root/health-boot receipts are external evidence, not my reproductions. The three exact-head ordinary Luna reports are independent review evidence, not my checks.

## Non-blocking residuals and limits

- The outbox has durable transactional insertion but no drain/fanout worker in this candidate. Event delivery and recipient notifications are therefore unverified; no delivery claim follows from this verdict.
- Real Microsoft Entra/OIDC/SCIM interoperability was not exercised here. Provider integration remains bounded by the project stage and acceptance plan.
- The full 298-file diff was risk-sampled at the security boundaries named above; this is not a line-by-line assertion about every UI translation, generated snapshot or unrelated work-item behavior. Ordinary UI/schema/authority panels and root acceptance evidence cover their respective scopes.
- P0 #8 observation/cutover/finalizer and P4 #580 query ownership remain open. This review does not satisfy a separate phase-finalizer pass or any future exact-head CI/merge gate.

## Blocking findings

None established on this exact head.
