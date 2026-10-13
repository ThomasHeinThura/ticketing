# PR #544 identity trust contracts — security review record

## Current reviewed head

- **Reviewed head:** `7011e83e816334c2afe69a8cad590ede9de0184e`
- **Accepted comparison base:** `917c93ade0a41f84d054c1d30451408b5f227881`
- **Pull request:** [#544](https://github.com/ThomasHeinThura/ticketing/pull/544), OPEN and draft when checked.
- **Risk:** Full security review. The candidate changes proposed identity, grant-provenance, tenant-reach, and concurrency contracts across 16 documents. It changes no runtime source or migration.

## Required GPT-6 Sol review

- **Reviewer/context:** GPT-6 Sol, fresh independent full security-review context; the reviewer states they did not author, direct, or remediate the candidate. Prior review C and the architecture-direction packet were evidence, not independent clearance.
- **GitHub record:** review ID `5384417558`, submitted as **COMMENTED** on exact head `7011e83e816334c2afe69a8cad590ede9de0184e`.
- **Verdict:** **CLEAR** for the proposed documentation security contract at this exact head. No blocking or non-blocking design finding in reviewed scope. This is not a GitHub approval, ADR approval, H1/Thomas spec read, implementation acceptance, owning finding 81/82 closure, P3 completion, or waiver of any gate.
- **Source report:** `/private/tmp/pr544-7011-sol-security-review.md`.

## Ordinary-review history and tier disposition

At structural head `f4d15630dc0597dea02083fcbd7eb927732dbbeb`, three independent GPT-6 Luna full ordinary reviews recorded:

| Reviewer | GitHub review | Verdict | Finding |
| --- | ---: | --- | --- |
| A | `5384028067` | CLEAR | No blocking finding. |
| B | `5384167858` | CLEAR | No blocking finding. |
| C | `5384199769` | BLOCK | Narrow omission in the shared `valid_now`/projection-commit invariant: parent person, organisation, and workspace validity was not included in the lock/recheck closure. |

The `7011e83e` delta extends that existing shared mechanism and aligns dependent documents. GPT-6 Sol explicitly found the known validity-class defect repaired and found no new defect class, authority source, trust boundary, gate semantic, table, event key, or separate writer algorithm. Under the repeated-same-class altitude rule in `AGENTS.md`, this clean required Sol review closes the ordinary tier for exact head `7011e83e816334c2afe69a8cad590ede9de0184e`; it does not relabel review C as clear or fabricate a three-review panel at the current head. No additional Luna round was added as a comfort panel.

## Reviewed security contract

- **Parent validity, locking, and races:** `valid_now` requires an active, non-deleted person owner; a valid customer organisation including `portal_access`; or a staff workspace with its unique active internal owner. The shared lock order begins with affected organisation, workspace, and person rows, then role, connection, mapping/SCIM connection, external identity, projection key, and mutated grant/history. Participating lifecycle, identity, mapping, role, and direct-grant writers pre-discover the closure, acquire locks in order, reread under READ COMMITTED, and roll back/retry the whole transaction if references or dependencies expand. The contract covers uncreated JIT subjects via existing anchors/uniqueness and retries serialization, deadlock, and relevant FK/uniqueness conflicts. Audit locks remain after authority locks. Database interleaving tests remain planned evidence.
- **Lifecycle:** Parent invalidation retires affected external grants with existing `mapping_changed` reason and recomputes the one-role projection atomically. Customer `portal_access=false` denies portal access and revokes customer sessions on next request; separately recorded direct provenance is unusable through the closed portal. Restore/reopen does not revive external grants without fresh same-source evidence. Global SCIM `active=false` remains the person-wide exception: all external grants retire, direct grants follow `end_memberships`/`keep_memberships`, retained direct rows are dormant while inactive, and linked SCIM group history/effective pointers repair or revoke atomically. No parent/source writer may leave stale active grants or a stale winner.
- **Authority selection:** An active valid direct grant alone wins. Otherwise the highest valid external role rank wins without capability union; an equal-rank tie between different roles yields no effective external membership. Source precedence breaks ties only for the same role ID. Role rank/capability/ceiling edits sweep referencing holders and reproject even without retirement, reject externally forbidden authority, and keep live sessions distinct from cached authority. Source-scoped retirement preserves independent direct, SCIM, OIDC, JIT, and other-connection grants. External paths cannot grant `instance:admin` or `sees_all`.
- **Entra admission and OIDC:** Every validated Entra login checks exact tenant issuer, `tid`, audience, immutable `oid`, configured app role, and signed `acct=0`, including existing JIT-disabled identities. Invalid tokens/configuration mutate no grants; a valid negative admission retires only that identity's OIDC/JIT evidence. PKCE S256, single-use state bound to connection/portal/organisation, nonce, and callback origin remain required. Email is not an auto-link key.
- **Domain disclosure and routing:** Typed-domain routing can disclose the SSO binding and selected identity provider's public destination. It is not authentication, organisation selection, or a claim of full-flow non-enumeration. Callback domain is deny-only and cannot change persisted scope.
- **Mapping administration and PA-15:** OIDC mapping GET/POST/PATCH are server-scoped, strict, and mask foreign IDs. Both writes require session-only, operation-bound PA-15 proof and config-version CAS. The separate SCIM administration PATCH remains unavailable with `403 step_up_unavailable` until issue #561 specifies its strict DTO, parent-version CAS, and dedicated operation binding. No proof key or permission is inferred.
- **Migration:** Proposed ADR-0015 remains **Proposed**. Every legacy membership requires durable read-only classification before DDL. Nullable `derived_from` is ambiguous and does not prove direct provenance. Any unknown row stops the whole migration pending owner-approved reconciliation; DDL, backfill, projection, and constraints must roll back together.

## Checks and evidence recorded by the Sol reviewer

- Verified live PR head/base, open draft state, and prior review records with `gh`.
- `git diff --check 917c93ade0a41f84d054c1d30451408b5f227881..7011e83e816334c2afe69a8cad590ede9de0184e` — passed.
- `pnpm check:vocabulary` — passed; 73 table declarations registered, with inherited-baseline notes emitted.
- `pnpm check:reviews` — passed for four named feature specs; this does not close owning findings 81/82.
- Exact-base/head identity-test inventory comparison — 25 named tests (`01`–`25`) on each side, unchanged.
- Newly introduced relative Markdown links across the 16 changed files — no new missing target.
- The Sol reviewer inspected the live PR checks at review time: protected-route E2E and PostgreSQL integration were pending; visual regression G8, PR-template/security review, and GitGuardian were red; G11 was skipped because it was not enabled. These are time-sensitive observations, not merge clearance.
- No runtime code, migration, browser, real-Entra, CSRF, concurrency, or implementation test was run by the reviewer.

## Remaining work and limits

- All **25 named P3 tests are planned, not executed**; they still require implementation and the specified real Microsoft Entra test-tenant acceptance. Parent-race and portal-lifecycle cases are planned subcases, not test evidence.
- Owning security review findings **81 and 82 remain open** pending owner verification. Thomas's finished-spec read/H1 and P3 acceptance remain open.
- Runtime implementation, migration review/execution, real-Entra and browser acceptance remain open. ADR-0015 has not been approved.
- The separate SCIM administration PATCH is fail-closed/unavailable pending issue **#561**'s strict DTO, parent-version CAS, and operation-bound PA-15 contract.
- This note records the independent Sol verdict only. It does not assert overall PR readiness or current CI status.

**Reviewed head:** `7011e83e816334c2afe69a8cad590ede9de0184e`

## Later P3 contract-owner disposition — 2026-10-04

The separate P3 SCIM/identity contract batch was independently reviewed at exact head
`09ace3548ed15fa886ef7a5634571da94948fde6`. Ordinary reviewers A and B recorded CLEAR for
their respective exact-delta and whole two-commit scopes. A fresh independent GPT-6 Sol found
no specification blockers and concluded the owner controls for findings 81–82 are sufficiently
specified to begin implementation. The owner has recorded only that specification-level
disposition in the historical finding register and the current P3 owning-findings handoff.

This later disposition does not rewrite this review's exact-head scope or its contemporaneous
statement that runtime implementation and findings 81–82 verification remained open. It does
not close those security findings, approve ADR-0015, claim that the 25 named tests ran, or
complete P3. Detailed Sol prose was not retained: its report file was overwritten by the CLI's
final response; the exact-source execution record preserves the scope, model, verdict and
limitation. See the private evidence directory named in the P3 owning-findings handoff.
