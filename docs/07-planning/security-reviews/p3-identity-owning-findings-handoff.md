# P3 identity owning findings: author contract handoff

**Authoring status (2026-10-04):** This maps the historical security review's numbered
findings [81–82](../reviews/2026-09-05/security.md) to written controls and required
implementation evidence. The independent ordinary and Sol contract reviews of exact head
`09ace3548ed15fa886ef7a5634571da94948fde6` found no specification blockers; the owner has
therefore dispositioned both findings as **specified to begin implementation only**. This is
not a runtime finding closure, ADR approval, test result, or phase acceptance. Both findings
remain open for independent verification of the implemented exact head. PR
[#544](https://github.com/ThomasHeinThura/ticketing/pull/544) is merged; its older design
reviews do not prove the runtime.

**Review provenance:** Reviewer A's exact-delta report and Reviewer B's complete two-commit
report are private under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-03/p3-scim-owner-contract/`.
The fresh independent Sol execution record identifies the reviewed source, full-contract
scope and verdict: no specification blockers; sufficiently specified to begin implementation.
The CLI overwrote the reviewer's 34-line report with its final response, so the execution
transcript and final verdict are retained, but detailed reviewer prose is not. No prose is
reconstructed or claimed. Those reviews did not run runtime tests, builds, migrations, browser
checks, or real-Entra verification.

| Owning finding | Normative contract selected | Required independent verification |
| --- | --- | --- |
| 81 — email-domain JIT and group authority | [IP-9/IP-27/IP-28](../../03-features/identity-provisioning.md): typed domain routes to a selected connection only; persisted connection selects portal and organisation; signed exact Entra app role and `acct=0` admit every login; immutable `oid` binds identity; callback email is metadata/deny-only. Group ids are immutable connection-bound UUIDs mapped to existing constrained roles, reconciled on each validated login; no `instance:admin`, `sees_all` or side movement. [ADR 0015](../../01-architecture/adr/0015-membership-grant-provenance.md) preserves independent source history and one effective role. | Real Entra and PostgreSQL tests 02/04/05/06/12/13/15/16/23: two providers claiming the same domain cannot switch the selected connection or gain foreign scope; repeat-login admission loss retires only same-identity OIDC/JIT grants; invalid token/configuration makes no grant mutation; complete/missing/overage groups and opposite-source re-enable respect provenance. Verify route elevation/audit for mapping administration, session-only PA-15 proof and no secret/raw-claim audit payload. |
| 82 — CSRF and OIDC protocol floor | [Security model](../../01-architecture/security-model.md#sessions-csrf-and-step-up) owns no state-changing GET, exact Origin/Referer and session-bound signed double-submit for unsafe cookie requests, host-only CSRF cookie, and negative security E2E. [Auth and identity](../../01-architecture/auth-and-identity.md#what-every-authoidc-plugin-must-do--the-protocol-floor) and IP-7 require PKCE S256, single-use session/portal/connection-bound state, nonce, exact issuer/audience/redirect and token validation before claim use. | Browser negative E2E refuses unsafe GET and missing/foreign/null/duplicate Origin or Referer and absent/mismatched/expired/cross-session CSRF token, including elevated paths; API-key exemption only for an actually resolved key. OIDC tests 03/05/15 refuse PKCE, state, nonce, origin/portal/connection replay and never create session/grant on failure. Test against the configured real Entra tenant before the P3 gate. |

## Bounded runtime handoff

1. Implement the proposed ADR-0015 schema and one shared IP-22 transaction/projection
   writer, including every parent, direct-grant, role, connection, JIT/OIDC and SCIM path.
   The read-only inventory/classifier now exists at
   `apps/api/scripts/preflight-membership-provenance.ts` and
   `apps/api/src/identity/membership-provenance-preflight.ts`; it classifies only an exact,
   internally consistent SCIM chain and leaves all other rows unresolved. It rejects
   implicit database fallbacks and writes its report create-only with mode 0600. The pure
   owner-record validator checks exact unresolved-row coverage, matching digest, source
   discriminator shape, duplicate decisions, grant scope binding, and per-row evidence
   references/rationale. The custom startup and `db:migrate` runner now blocks parent
   writers, validates a current admin and direct-grant target before DDL, then runs
   migrations 0087–0090 plus backfill/projection/constraints in one transaction. It refuses
   duplicate projection keys and unsupported external-source claims; no persistent cutover
   has run. This is implementation evidence only, not runtime acceptance. Do not classify
   null `derived_from` as direct by default.
2. Implement selected-connection OIDC protocol and Entra admission **before** JIT or session
   issue, then source-scoped group/JIT reconciliation under IP-22 locks. Implement SCIM
   token scope, user lifecycle and group evidence with the same writer. Make authority
   projection one-role, fail-closed on distinct-role highest-rank ties; never union grants.
3. Implement connection and group-mapping God Mode routes, including existing
   `PATCH /api/instance/identity-connections/{id}/scim`. All SCIM PATCH variants share
   `instance:admin`, session-only elevation, `scim_admin_update`, canonical body hash,
   parent CAS, secret-safe DTO, and atomic proof consumption. Add the closed
   `attribute_mapping` variant and profile-only SCIM user mapping. Expose its editor only
   after the strict route/proof/read projection work; do not allow arbitrary path syntax.
4. Run the 25 named P3 integration tests with the specified subcases, real isolated
   PostgreSQL concurrency/migration rollback and a real Microsoft Entra test tenant;
   run browser security negatives and the actual God Mode/portal journeys. Capture
   migration inventory outcomes and source-bound counts. Apply ordinary and independent
   Sol security reviews to the frozen exact candidate, then GitHub required checks.

**Boundary:** The contract-writing batch changed documentation only. It did not implement a
schema, migration, route, editor, test, or real-provider behavior. Ambiguous legacy data still
needs actual owner-approved per-row reconciliation; P4 human ADR/spec/H1–H6 review is deferred,
not waived. These remain runtime and acceptance obligations for the implementation batch.
