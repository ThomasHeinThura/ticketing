# Independent ordinary authority delta review

- Candidate: `d2092ea94f220e303ef5ff50e43961b593893512`
- Accepted base: `3096cb044bdf6ae98488bfc385f532fa6386343a`
- Previous authority review head: `d7254c47d3a0bf1c243d3c490ab98eae8a98832c` (history only)
- Model: GPT-6 Luna
- Independence: fresh reviewer context; did not author, direct, or remediate this candidate.
- Scope: exact `d725..d209` delta, focused on instance person-deactivation PA-8 expiry; SCIM deprovisioning outbox/audit; registered plugin assertions; accepted-main index behavior preservation (redacted logging, asset legacy-shadow observation, native WebSocket API-key owner/enabled refresh fields); and remaining `main..candidate` API registration/host/OpenAPI/migration integration.
- Inspected: required repo operating guides/status/decision records; pending-action, identity-provisioning, event and attachment contracts; previous authority report; exact source and migration diff; scheduler and lifecycle transaction implementations; API index composition; corresponding integration tests and author evidence packets.
- Tests/reproductions: none run by this reviewer. The assigned environment has no DB authorization; no DEV/default/shared/test.env or dead-container DB was used. Root reports full units already running, so no duplicate suite was started. Author evidence is identified as author evidence, not independent execution. This verdict is based on source/contract inspection.
- Verdict: **CLEAR for this ordinary authority delta.**

## Findings

No blocking authority defect found in the reviewed delta.

1. PA-8 now selects workspace-scoped actions and only the registered null-scope shape `(action = user_deactivation, target_type = person)`. It re-reads the row under lock, additionally requires null project and organisation scope, transitions only a due pending row, and writes `pending_action.decided` plus the audit record using the row's actual scope. Unsupported nullable-scope actions remain pending and degrade the worker. The new tests cover the registered instance action and unsupported branch. This matches `pending-actions.md` PA-8 and the instance-scope event contract.
2. SCIM `active=false` now writes `identity.deprovisioned` with source `scim`, connection/person ids and lifecycle counts, in the same transaction as person/credential/grant changes, external-identity update, and provisioning history. It uses instance scope as required by `events.md`; audit failure uses the existing savepoint/failure reporting pattern. `DELETE /Users/{id}` and active-state writes share this wrapper. The integration test asserts event payload/scope and audit row.
3. The plugin-test adjustment includes the already-registered P3 `taskdesk-identity-oidc` plugin in the expected pending additions and preserves the exact-list guard. No plugin authority/allowlist was loosened by this delta.
4. Accepted-main `index.ts` behavior has been restored for safe structured logging (no raw exception serialization in the touched handlers/lifecycle paths), asset-route legacy `workspace:read` shadow observation, and WebSocket API-key enabled/owner freshness fields. Inspection confirms these are retained alongside the composed Users, identity connection, SCIM, service-calendar and SLA routers. SCIM is admitted only on the agent origin and documented with its own bearer scheme in the composed OpenAPI document. Migration startup uses the dedicated membership-provenance cutover runner. The author preservation packet is at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p4-aa68-logging-preservation/evidence.md`; it is not treated as review clearance.
5. The forward 0112 migration and schema changes establish the corresponding same-workspace composite SLA foreign keys. This review found no authority expansion in those constraints; schema-specific clearance remains the responsibility of the separate schema reviewer.

## Residuals and boundaries

- Outbox **insertion** is implemented and reviewed. No outbox delivery/drain worker exists, so event fanout/delivery is unverified and is not claimed.
- No database integration tests, browser journeys, full suites, image build, hosted CI, deployment, merge, or phase-finalizer verification were performed by this reviewer. The author packet at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p4-person-deactivation-b58/436d45ff-author-evidence/evidence.md` records author-run evidence and its stated counts; it is not independent evidence.
- This is an ordinary authority delta verdict only. The candidate still requires the separately mandated fresh exact-head GPT-6 Sol security review and all applicable exact-head CI/review gates.
