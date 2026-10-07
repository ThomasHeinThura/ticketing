# Independent ordinary authority review

- Candidate: `d7254c47d3a0bf1c243d3c490ab98eae8a98832c`
- Accepted base: `3096cb044bdf6ae98488bfc385f532fa6386343a`
- Model: GPT-6 Luna
- Independence: fresh reviewer context; did not author, direct, or remediate this candidate. Prior `eefce146` authority report treated as historical context only, not current clearance.
- Scope: added/changed API auth, identity/SCIM/admin/provisioning, Users lifecycle, PA-15/person deactivation, session/native-key revocation, route policy/DTO boundaries, outbox/audit integration, and relevant P0 reach/auth/observability seams.
- Inspected: repository instructions and operating guide; current status/decision records; identity, pending-action, event, God Mode, and API contracts; exact `base..candidate` source diff and relevant route, lifecycle, scheduler, outbox and policy code; existing integration tests covering these seams.
- Tests/reproductions: none run. Source inspection directly establishes the two findings below. No database was mutated and no shared runtime was used.
- Verdict: **Changes required; ordinary authority panel does not clear this candidate.**

## Blocking findings

1. **[P1] Instance-scoped person deactivation actions never expire in the scheduled worker.**
   `pending-action-expire.ts:36-45` recognizes expired `workspace_id IS NULL` rows only as unsupported/degraded; its candidate query at lines 64-76 explicitly selects only rows with `workspace_id IS NOT NULL`. The new user-deactivation action is instance-scoped (`workspace_id = NULL`), and PA-8 requires `pending-action-expire` to mark stale rows expired. It can transition only if a requester later calls approve/deny/cancel; abandoned actions remain pending indefinitely, and the worker reports degraded whenever one is overdue. Extend the worker to process the newly authorized instance scope with its audit and outbox transition, or otherwise make the feature's contract and lifecycle complete. Relevant references: `apps/api/src/scheduler/pending-action-expire.ts:36-76`, `docs/01-architecture/pending-actions.md:130-131`, `docs/03-features/god-mode.md:294-301`.

2. **[P1] SCIM person deactivation does not enqueue the contracted `identity.deprovisioned` outbox event.**
   The new common lifecycle transition handles sessions, personal API keys, memberships and projections, but `setScimIdentityActiveInTransaction` then only updates the external identity and inserts a `provisioning_event` (`apps/api/src/identity/scim-lifecycle.ts:46-74`). No `identity.deprovisioned` enqueue exists in the SCIM path (`rg` across `apps/api/src/identity` finds none). The event contract explicitly says SCIM `active=false` and `DELETE /Users/{id}` emit `identity.deprovisioned` with source, connection/person ids and revocation counts (`docs/01-architecture/events.md:144`). The God Mode path inserts it, so the asymmetry is specific to SCIM. Add the SCIM event transactionally with the deactivation and verify rollback/shape in integration coverage. This is a missing durable event, separate from the documented lack of an outbox delivery/fanout worker.

## Non-blocking observations

- The deactivation approval path binds requester ownership through `/api/me/pending-actions/{id}/approve`, requires session-only middleware, locks and re-reads actor/session/target, rechecks current staff/admin state and the registered instance-admin route policy, compares stored payload hash/route/target and current email, then consumes the PA-15 proof in the lifecycle transaction. I found no route-level authority bypass in that path.
- God Mode deactivation emits pending-action decided/executed and identity deprovisioned events with empty instance scope, audit attempts use the documented AU-14 savepoint/failure-reporting behavior, and the DB outbox constraint permits only the declared instance event kinds. Durable insertion is not delivery proof; no fanout claim was checked or made.
- The existing SCIM lifecycle keeps source-specific provisioning history and configured membership policy while delegating person-wide retirement to the shared transition. No additional SCIM grant-authority defect was established by this bounded review.
- No phase, Entra, deployment, or delivery claim is made.

## Additional integrated-gate finding (reported by orchestrator after this panel)

3. **[P1 gate blocker, no standalone authority defect established] Approved OIDC auth plugin construction conflicts with stale plugin-test expectations.** The candidate constructs `taskdesk-identity-oidc` in `apps/api/src/auth.ts`; the canonical auth plugin contract registers it as `added — P3 identity integration` in `docs/01-architecture/auth-and-identity.md:106`, and `BETTER_AUTH_PLUGINS` registers that ID as an approved addition in `packages/permissions/src/better-auth-plugins.ts`. The orchestrator reports the integrated unit run fails two assertions in `packages/permissions/src/better-auth-plugins.test.ts`: the `KEPT` expectation expects additions only `passkey`/`two-factor`, and the explicit current-P0 plugin construction omits the registered identity plugin. This leaves the candidate's integrated unit gate red. Update the tests and construction-stage expectation against the canonical plugin register/spec, preserving the exact plugin-list guard; do not weaken the guard or treat this as unauthorized plugin introduction. This observation is based on the orchestrator's reported run, not a run performed by this reviewer.

### Integrated test evidence received after panel report

Orchestrator reported lint (8 tasks) and typecheck (9 tasks) pass; integrated unit run reaches 6 successful of 12 tasks and then stops at the two `better-auth-plugins.test.ts` failures above. Private complete log: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p4-person-deactivation-b58/d7254c47-integrated-unit.log`. Reviewer-run count remains zero.
