> ## ⚠ Read this first — this is a PLAN written against an OLDER `main`
>
> **Baseline:** `955f8d4d`, the tip of `main` on 2026-09-06. **`main` has moved since**, and
> as of 2026-09-09 it is `d4510a2` with nine more pull requests merged. Statements below of
> the form "X does not exist on `main`" or "PR #N is open and unmerged" were **true when
> written and are not true now.**
>
> **What changed under this plan** (see [`../lane-prep/README.md`](README.md) for the full
> reconciliation):
>
> - `packages/domain` **now exists** (PR #69) — service calendars, 59 tests.
> - `packages/ui` **now exists** (PR #63) — the first primitive slice.
> - **CI exists on `main`** (PR #19): the `check:*` gates, `test:all`, the OpenAPI baseline,
>   and eleven required status checks on the `protect-main` ruleset.
> - Retrofit **S0, S2 and S4 have merged** (PRs #65, #67). S1 was already merged (#57).
> - Issue **#7 is complete and closed.**
>
> **What has NOT changed, and is the reason this plan is still the right starting point:**
> **Throttle 1 is still shut.** Its condition 2 requires issue #6 through retrofit **S10**;
> S3 and S5–S11 have not started. Every "do not write code yet" instruction below still
> stands, unchanged.
>
> This file is committed **as the research artifact it is** — deliberately not rewritten,
> because rewriting a dated plan to look current is how a snapshot starts lying. Trust its
> reasoning, its spec citations and its dependency analysis; re-verify every claim about
> what is or is not on `main` against `main`.

---

# P3 identity/portal — preparation plan

**Prepared by:** Sonnet 5 prep agent, workspace `/tmp/claude-1000/prep-p3`, branch
`feat/p3-prep` @ `955f8d4d` (= `origin/main` at prep time).
**Scope:** issue #38 (customer portal) and #39 (identity connections and SCIM
provisioning). Not implementing. This is the plan implementation starts from the hour
Throttle 1 opens.
**Constraint honoured throughout:** P3 identity internals — OIDC claims normalisation, SCIM
payload mapping, connection configuration, provisioning state transitions — **before**
`/scim/v2/*` routes are exposed (CLAUDE.md, workstream table).

---

## 0. Where P3 actually sits right now — read from the code, not just the docs

**Throttle 1 (the gate that must open before this lane may write any code) is not open.**
Of its five conditions (CLAUDE.md §3.2):

1. #5 complete — ✅.
2. **#6 the ISSUE complete** — ❌. #6's deletion slice merged (PR #16), but #6 also requires
   the `organization()` retrofit to run through **S10**. Verified against
   `docs/07-planning/retrofits/organization-plugin-retrofit.md`: only **S0 and S1** are
   done. S2 (native reads, PR #65) and S4 (native writes, PR #67) are **open, unmerged**
   PRs — per this task's own briefing, do not build on their code. S3, S5–S9, S10 do not
   exist yet even as branches.
3. #7 complete — merged as PR #21 (`packages/permissions`, evaluator, route-coverage gate)
   but `pnpm test:permissions` running in CI depends on #19 (open, no CI exists on `main`).
4. Route-policy coverage **executing in CI** — ❌, no workflow files on `main` (#19 open).
5. An unclassified route failing CI, demonstrated — ❌, same reason.

**So P3 cannot start even its internals-only slice under the letter of Throttle 1** — but
Throttle 1 gates when P3 *code* may be *merged and built in parallel with other lanes*, not
whether a *pure, dependency-free* internals module can be designed and unit-tested in
isolation ahead of that. Section 2 below states precisely which pieces can be written
**now** (pure functions, no DB, no route, no auth-context dependency) versus which must wait
behind specific steps/issues. Read `docs/07-planning/status.md`'s **BLOCKED** section first
every session — it is currently: #8 blocked on the retrofit; #17 blocked (session
revocation for removed MCP OAuth flows) with no stated resolution date.

**A schema gap the retrofit plan itself flags and no open issue owns.** Both
`customer-portal.md` and `identity-provisioning.md` are written entirely against the
**target** data model — `organisation`, `person` (with `.side`, `.active`,
`.is_placeholder`), and a scope-polymorphic `membership` (`scope ∈ {organisation, workspace,
project}`). The retrofit plan's own finding **D7** (`organization-plugin-retrofit.md:286`)
states plainly: *"None of `organisation`, `person`, `membership` exist in the schema... a
sweep for `organisation` returns zero hits."* Finding D9 adds that today **`workspace` is
the only tenancy boundary** — there is no separate customer-organisation concept at all.
Section 3.2 of the retrofit plan explicitly disclaims building any of this: *"No
`organisation` or `person` table, no scoped `membership` — that is the later phase (finding
D7)."* **This later phase has no issue number.** I searched all 43 open issues (#6–#66) by
title and body; none is titled or scoped as "organisation/person/membership split" or
similar. It is not S0–S11 (those steps explicitly land on the *existing* `workspace` /
`workspace_member` tables per D9's "consequence for sequencing"). **This is the single
largest scheduling gap in the plan and is flagged as a question for Thomas in §8.**

---

## 1. Internals-before-routes decomposition

Each block below names the pure core (input/output types, no I/O), the impure edge that
wraps it, and what must be GREEN before any `/scim/v2/*` route (or, for the portal, the
`/api/portal/*` router) is wired up. All rule ids (`IP-n`, `CP-n`) are quoted from
`docs/03-features/identity-provisioning.md` and `docs/03-features/customer-portal.md` as
they stand on `main` today — both specs' `## Open questions` sections read **"None"**
(verified by reading the files directly, not inferred).

### 1.1 OIDC claims normalisation (`IP-26`, `IP-27`, `IP-28`, `IP-9`)

- **Pure core.** A function `normaliseEntraClaims(idToken: VerifiedIdToken, connection:
  IdentityConnectionConfig) -> NormalisedIdentity | ClaimRejection`.
  - Input type: the **already cryptographically verified** ID token claim set (`iss`,
    `tid`, `oid`, optional `email`, `preferred_username`, `upn`, optional `groups` /
    `_claim_names`/`_claim_sources`) plus the connection's stored `tenant_id` and
    `domain_bindings`. Signature/`iss`/`aud`/`exp`/PKCE/`state`/`nonce` verification
    (`IP-7`) is the **impure edge** (network call to the discovery document, crypto) and is
    explicitly *not* part of this pure core — the core receives only a verified,
    already-typed claim bag.
  - Output type: a discriminated union —
    `{ subject: { oid, tid }, addressUsed: 'email'|'preferred_username'|'upn', address,
    groupObjectIds: string[] | 'overage' }` or a typed rejection (`no_email_verified_claim`
    is explicitly *not* a rejection reason for Entra — `IP-9` says `email_verified` is
    required "only of providers that emit that claim", and Entra emits none) —
    `tenant_mismatch`, `issuer_mismatch`, `no_usable_address`, `domain_bound_elsewhere`.
  - Behaviour rules this function alone must encode and unit-test, **with no database or
    network dependency**: `IP-26` (tenant-specific issuer, refuse `/common`/`/organizations`
    at *save* time — a separate connection-config validator, see 1.3), `IP-27` (subject
    precedence `oid`+`tid`; address precedence `email → preferred_username → upn`; fail
    closed with no invented address), `IP-28` (groups claim carries **object ids**, never
    names; overage ⇒ ignore claim, do not call Graph — this repo's reference restriction and
    `IP-23` both forbid a `memberOf` lookup).
  - **Impure edge**: the domain-binding lookup (`IP-9`) is a DB read keyed on the resolved
    connection, and the JIT/link decision (`IP-10`, `IP-18`, `IP-19`, `IP-30`) is a DB
    read+write. Both stay outside this function.
  - **Must be green before any route**: unit tests for every branch above, run with **fixture
    ID token claim sets**, no HTTP, no DB — this is exactly the corpus's own recommendation
    for "pure functions in `packages/domain`... before any HTTP endpoint exists" (CLAUDE.md
    §3, stated for P2 but the same discipline is what "identity internals" names for P3).

### 1.2 SCIM payload mapping (`IP-13`, `IP-14`, `IP-17`, `IP-31`, `IP-20`–`IP-22`)

- **Pure core.** Two directions:
  - `parseScimUser(body: unknown) -> ScimUserResource | ScimValidationError` — strict schema
    validation (`IP-14`): unknown attributes rejected, oversized bodies rejected, but with
    the **named, closed set** of tolerated Entra deviations from `IP-31` (case-insensitive
    `op`, string `"True"`/`"False"` coerced for `active`, the enterprise-extension schema
    URN ignored unless explicitly mapped) — and this tolerance list must not silently grow;
    it is exactly three items, named in the spec, and a fourth requires a spec change first.
  - `mapScimAttributesToPerson(resource: ScimUserResource, connection:
    ScimConnectionConfig) -> PersonPatch | ForbiddenAttributeError` — `IP-4`: any attribute
    that would set `organisation_id`, `workspace_id`, a role, a capability or a portal scope
    from the payload is a typed rejection (`400 forbidden_attribute`), never a silent drop.
    This is the single function every negative "SCIM cannot set its own scope" test in §4
    below calls.
  - `applyScimPatchOps(current: PersonRecord, ops: PatchOp[]) -> PersonPatch |
    PatchRejection` — SCIM `PATCH` path-expression evaluation (`IP-13`), again refusing any
    op that touches a forbidden attribute (`IP-9` / `IP-17`: only name, email snapshot,
    `userName`, job title, locale are ever permitted).
  - `mapExternalGroupToRole(externalGroupId: string, mapping: ScimGroupMapping[]) ->
    { roleId, scope } | 'unmapped'` — `IP-20`–`IP-22`: an unmapped group is opaque and
    grants nothing; a mapped group never targets a role above `max_role_rank` or granting
    `instance:admin`/`sees_all` — this is a **type-level** guarantee this function's return
    type should make impossible to construct wrong (the mapping table itself is
    constrained by the DB `CHECK` in `data-model.md:136`, but the pure function should not
    trust the DB alone — defence in depth given #66's lesson about fallback-to-broader).
  - **Impure edge**: loading the `scim_connection`/`scim_group_mapping` rows, the
    uniqueness check for `409 scimType: "uniqueness"` on same-connection duplicate create
    (`IP-32`), writing `provisioning_event` rows, the actual `ListResponse` pagination over
    a live query (`IP-13`, tests 19–20).
  - **Must be green before any route**: schema validation golden tests against real Entra
    provisioning-service payload samples (create, patch-active-false, patch-profile,
    filter-by-userName) — the spec says these are hand-written protocol code, "only for `eq`
    on `userName` and `externalId`" (`IP-13`), so the filter parser's limited grammar is
    itself something to golden-test before it is wired to a route.

### 1.3 Connection configuration (`IP-1`–`IP-6`, `IP-26`, data model `identity_connection`)

- **Pure core.** `validateConnectionConfig(input: ConnectionDraft) -> ValidConnectionConfig
  | ConfigValidationError[]`:
  - `IP-1`: `portal_scope` is exactly `agent` or `customer`; a `customer` connection must
    carry exactly one `organisation_id`; `agent` must carry none. Enforced today partly by
    a DB `CHECK` (`data-model.md:133`, "`organisation_id` null iff... CHECK set iff
    `portal_scope = 'customer'`") — the pure validator should refuse the same shape before
    it ever reaches the DB, so the error is a typed `400`, not a constraint-violation `500`.
  - `IP-26`: refuse `/common` and `/organizations` Entra authorities **at save**, by
    inspecting the discovery document's `issuer` template — this is the one place the pure
    core needs a *value already fetched* (the discovery document), so the function takes
    the fetched document as an argument rather than fetching it itself; fetching is the
    impure edge.
  - `IP-2`/`IP-3`: `max_role_rank` and the customer-connection restriction to the single
    `customer` role are validated here — **this function is exactly where issue #66
    matters**: if a rank/authority ceiling is ever expressed by walking `hasWorkspacePermission`-style
    role resolution instead of a stored, explicit `max_role_rank` column comparison, it
    inherits #66's fail-open-on-missing-row bug. The identity-provisioning spec already
    avoids this by keying the ceiling to a **column**, not a permission-function call — this
    plan makes that avoidance explicit and testable: `validateConnectionConfig` must never
    call `hasWorkspacePermission` or any function with the same fallback shape.
  - **Impure edge**: persisting the row, the elevated-action step-up flow (`IP-6`), the
    audit write.
  - **Must be green before any route**: property-style tests that no `ValidConnectionConfig`
    can be constructed with `portal_scope: 'customer'` and no `organisation_id`, or with
    `portal_scope: 'agent'` and a non-null `organisation_id`, or with a `/common` issuer.

### 1.4 Provisioning state transitions (`IP-15`, `IP-16`, `IP-19`, `IP-30`, `IP-32`)

- **Pure core.** A small state machine over `external_identity` + `person`:
  `decideProvisioningTransition(event: ProvisioningEvent, current: ExternalIdentityState |
  'none') -> Transition`.
  - States worth naming explicitly (not in the data model as an enum today — a
    modelling decision this plan proposes, not a registered identifier yet): *none →
    provisioned (jit|scim|invite) → active ⇄ deactivated*, plus the *placeholder → claimed*
    side-path (`IP-30`) which is a **different** entry point (never via SSO) and a **linking**
    decision, not a provisioning one — the pure core should keep these as two separate
    return-type branches so a caller cannot accidentally satisfy the "claim" path from an
    SSO event.
  - `IP-15` deactivation is the transition with the widest blast radius: it must yield a
    **command list**, not perform effects — `{ setPersonActive: false, revokeSessions:
    true, revokeApiKeys: true, revokeMcpKeys: true, endMemberships: policy dependent,
    writeProvisioningEvent }` — so the impure executor is a thin, auditable interpreter and
    the ordering/completeness is unit-testable without a database.
  - `IP-16` reactivation must be provably incapable of restoring a role the connection
    cannot currently grant — it re-derives from current group mappings, never from
    history. Model this as: the reactivation command **never** carries a role/membership
    payload of its own; membership re-derivation is a **separate**, subsequent call into
    the group-mapping function from §1.2, not something reactivation does inline. That
    separation is itself a testable structural property.
  - `IP-32` (retry-tolerant create) is a pure decision over `(existing_row_lookup_result,
    incoming externalId/userName)` → `create | 409_uniqueness | ...`; the actual lookup is
    impure.
  - **Impure edge**: session table writes, API-key table writes, membership table writes,
    the actual "next request re-validates against the session table" mechanism (already
    true by construction — `session.cookieCache` is disabled per #16 — so deactivation's
    session-revoke command has no synchronous-propagation problem to design around, only a
    "did we call it" one).
  - **Must be green before any route**: a table-driven test enumerating every
    `(event, current state)` pair in the spec's edge-case table (identity-provisioning.md
    "Edge cases" + tests 10, 11, 18, 23) and asserting the exact command list, with **no**
    database.

### What must exist and be tested before `/scim/v2/*` is exposed — summary

All four pure cores above, unit-tested against fixtures (Entra sample payloads for 1.2,
sample ID tokens for 1.1), **plus**:
- The connection/SCIM-connection persistence layer (impure edge of 1.3) — so a route has
  something to resolve a bearer token against.
- `provisioning_event` writes wired end-to-end for every branch (audit story, `IP-24`).
- The negative-test families in §4 passing **against the pure functions directly** (most of
  them do not need a live route to prove — they are exactly the kind of test that should
  fail red the moment someone drops a check from `normaliseEntraClaims` or
  `mapScimAttributesToPerson`, before a route ever exists to hide the regression behind an
  HTTP status code).

Only once those are green does wiring `/scim/v2/Users` etc. become "plumbing a
well-tested pure core into Hono," which is the point of the ordering CLAUDE.md specifies.

---

## 2. Dependency order — retrofit steps and gating issues

| P3 piece | Blocked behind | Why |
| --- | --- | --- |
| OIDC claims normalisation (1.1) | **Nothing schema-shaped** — pure function, fixture-driven. Can be written and unit-tested **today**, in a branch, without merging anything. | No DB/session dependency in the pure core. |
| SCIM payload mapping (1.2) | Same — pure function, Entra fixture-driven. Can start **today**. | Same. |
| Connection configuration validator (1.3) | Same **pure validator** can start today; the **persistence** half needs `identity_connection`/`scim_connection` tables, which already exist in `data-model.md` but are **not yet migrated on `main`** (no migration number claimed for them — confirm before writing a migration; the retrofit plan is at migration 0050 next-free as of `955f8d4d`). | Table not yet created; check `apps/api/src/database/migrations/` at implementation time for the actual next-free number, it will have moved. |
| Provisioning state machine (1.4) | Pure decision core: today. Persistence/executor: needs `external_identity`, `person` — **and `person` does not exist on `main` at all** (§0 finding). | `person`/`organisation`/`membership` split — **unowned, unscheduled** (§0). This is the hardest real dependency, not any single retrofit step. |
| Any route wiring (`/scim/v2/*`, `/api/portal/*`, `/api/instance/identity-connections`) | **Throttle 1** (all five conditions) **and** #7's route-coverage gate actually running in CI (needs #19 merged) **and** the `organisation`/`person`/`membership` schema landed. | Explicit project rule: routes do not exist without a policy, and the policy registry's CI enforcement is what makes that real, not aspirational. |
| Portal session boundary, `/api/portal/*` predicates | Same as above, **plus** S8a (native active-workspace handling) if the portal's organisation resolution reuses any workspace-scoped session field — needs confirming at implementation time whether `person.organisation_id` supersedes or coexists with `session.active_organization_id`. | Not yet decided in any doc I found — flag in §8. |
| `hasWorkspacePermission`-style authorization for **agent-connection** JIT role grants (`IP-3`, `max_role_rank`) | **#66, OPEN.** Any P3 code path that resolves "does this connection's configured role exceed the ceiling" by walking compiled role statements instead of an explicit stored `max_role_rank` comparison inherits #66's fail-open-on-missing-row bug (admin diverges 16/16). | §1.3 above already designs around this by keying to a column, not a permission call — but this must be enforced in code review, not assumed. |
| Native role writes generally (S7) | **Explicitly blocked by #66** per the issue itself ("S7 is blocked until this is resolved"). P3's own group→role mapping editor is a **write to `scim_group_mapping`**, not to `workspace_role` — so it does not directly depend on S7's route existing, but it **does** depend on the role rows S7 will eventually let administrators edit being trustworthy, i.e. on #66's "missing/deleted role row never restores broader compiled permissions" fix landing before any group mapping can be safely evaluated against a role that might vanish mid-flight. | Direct code dependency: none. Trust dependency: yes — flag as a review-time check, not a hard blocker for writing the mapping *editor*, only for *trusting its result* in production. |
| Everything route-shaped | **S10** (organization() unmounted) is the point at which "the retrofit has run through S10" (Throttle 1 condition 2) is literally true. S2–S9 are all still open work; S3 and S4 are mid-flight as unmerged PRs #65/#67 which this lane must not read or build on. | Direct quote from the task briefing and confirmed against the retrofit doc's own step table. |

**Net dependency chain, shortest path:**
```
pure cores (1.1–1.4)          — can start now, zero blockers
        │
persistence for identity_*    — needs identity_connection/scim_connection tables migrated
tables (no person/org dep)    — (these tables have NO FK to organisation/person other than
                                  identity_connection.organisation_id, which does need
                                  organisation to exist — see below)
        │
organisation/person/membership — UNSCHEDULED, no owning issue (§0) — hard blocker for
split                            identity_connection.organisation_id, external_identity.person_id,
                                  membership rows, and the entire customer-portal reach model
        │
retrofit S2–S10                — Throttle 1 condition 2
        │
#19 merged (CI exists)         — Throttle 1 conditions 4 and 5
        │
route wiring for /scim/v2/*    — the actual internals-before-routes boundary
and /api/portal/*
```

---

## 3. Acceptance criteria per issue

Quoted from the issues and the specs — nothing invented.

**#38 (customer portal), from the issue body:** *"Done when all portal-origin/session/API-
boundary, request/catalogue/approval/project/account, visibility, priority,
satisfaction/reopen, onboarding and named-test obligations pass with applicable
security/UX gates, and the feature index can mark Customer portal shipped."* Concretely,
from `customer-portal.md`:
- All `CP-1`…`CP-18` behaviour rules hold (reach fixed to own org; 404 not 403; internal
  comments server-filtered; assignee never exposed but public actors named; escalate-only
  priority; SLA shown as plain language; reopen within window resumes not restarts the SLA
  clock via `WF-21`; satisfaction rating once per request; durable submission→work-item URL;
  withdraw before triage; invitation onboarding; per-org `customer_visibility`; org SSO;
  home-realm-discovery login with no enumeration).
- Every route in the API table carries its kind-3 policy (`portal: 'customer', predicate:
  …`) — 22 routes, each with a named predicate, not "(portal session)".
- The six named security E2E specs pass: `portal-cross-tenant.spec.ts`,
  `portal-no-internal-comments.spec.ts`, `portal-cannot-deescalate.spec.ts`,
  `portal-cannot-self-approve.spec.ts`, `portal-session-rejected-on-agent-origin.spec.ts`,
  `portal-bundle-purity.spec.ts`.
- UX E2E: full journey at 375px viewport.

**#39 (identity/SCIM), from the issue body:** *"Done when agent/customer Entra OIDC,
organisation-bound identity, SCIM users/groups/deprovisioning, session/key revocation, God
Mode identity configuration and all named tests pass, including the stage gate requirement
that all 17 SCIM/Entra acceptance tests pass against a real Microsoft Entra test tenant."*
**Note the discrepancy**: the issue says **17**; the current spec's Testing section lists
**25** named tests (`01`…`25`) and its own prose says *"Twenty-five acceptance tests. Eight
were added when `IP-26`…`IP-32` and the placeholder rule were written."* The issue text
predates that expansion and was never updated. **This is a finding, not a decision to
resolve myself** — flagged in §8 for Thomas: does the stage gate require all 25 against the
real tenant, or only the original subset the issue names? Concretely from the spec:
- All `IP-1`…`IP-33` behaviour rules.
- The 25 named tests in `tests/api-integration/identity/`, run against a mock IdP on every
  PR and against a **real Microsoft Entra test tenant before the P3 identity gate closes**
  (spec's own words, citing `phases.md` and `security-model.md`).
- God Mode screens: Authentication list, connection editor with SCIM panel, Organisation →
  Identity detail screen.

---

## 4. Threat surface — for the Opus reviewer

*(Written for the reader who opens this section first.)*

SCIM is an inbound, privileged, tenant-scoped provisioning API. The customer portal is
authenticated surface exposed directly to external customers. Both must fail closed on
every ambiguous input, and neither may leak tenant existence through timing, error shape,
or status code. Below: what must never be reachable, what must never be inferable, and the
negative test for each.

### 4.1 Cross-tenant reachability — what must never be reachable

| Must never happen | Mechanism that prevents it | Negative test |
| --- | --- | --- |
| A SCIM bearer token for connection A touches organisation B's people | `IP-12`: the token determines the connection, therefore the organisation, portal scope, allowed resource types and mappings — **never** anything in the request body or path | `04-scim-token-cannot-touch-other-organisation.test.ts` (already named in the spec) |
| A SCIM payload sets its own `organisation_id`, `workspace_id`, role or capability | `IP-4`: refused `400 forbidden_attribute`, **not ignored** — silently ignoring would be worse than refusing, because a client that assumes its value was honoured proceeds on a false premise | `09-scim-patch-cannot-alter-tenant-reach-authority.test.ts`; also unit-test §1.2's `mapScimAttributesToPerson` directly with every forbidden field individually, not only in combination |
| A customer connection creates a staff-side person, an instance admin, or grants above the single `customer` role | `IP-2` | `06-customer-connection-cannot-create-staff-or-authority.test.ts`, `07-scim-create-scoped-person.test.ts` |
| An agent connection grants `instance:admin`, `sees_all`, or a role above its configured `max_role_rank` | `IP-3` + §1.3's validator keeping the ceiling a stored column, never a live permission-function call (the #66 lesson) | `13-nothing-grants-instance-admin-automatically.test.ts` |
| A group mapping grants `instance:admin` or `sees_all` | `IP-21`: **impossible**, not merely elevated — the mapping editor does not offer it and the server refuses it. This is stronger than "elevated + audited"; verify the pure function's return type cannot represent the forbidden target (§1.2) | `12-group-maps-only-to-permitted-role-and-scope.test.ts` |
| A customer portal session reaches another organisation's request, submission, project, or approval by guessing an id | `CP-1`, `CP-2`: reach fixed to own org, **404 not 403** | `portal-cross-tenant.spec.ts` + IDOR fuzz substituting another tenant's id at every scope source (`idor-fuzz.test.ts` pattern from rbac.md, extended to portal routes) |
| A portal session issued through one organisation's SSO connection authenticates on the agent origin, or vice versa | `IP-8`: session carries `session.portal`, unusable cross-host; `CP-*` edge case "Customer session hits the agent origin → rejected at callback and every request, audited" | `portal-session-rejected-on-agent-origin.spec.ts`, `03-portal-isolation-both-directions.test.ts` |
| A token asserting `@contoso.com` from an Entra tenant that is not the one bound to the connection is honoured | `IP-26` (tenant-specific issuer, `/common`/`/organizations` refused at save) + `IP-9`/`IP-27` domain binding checked against precedence-resolved address | `05-no-user-controlled-tenant-selection.test.ts` |
| A same-email second IdP silently links to an existing account across connections/organisations | `IP-18` (no auto-link on email; SCIM create matching another connection's person → `409`, logged, does not adopt) | `16-same-email-second-idp-does-not-autolink.test.ts` |
| A colleague inside the *same* customer organisation reads a `private`-visibility request/submission they are not a participant on | `CP-16`: `customer_visibility` predicate inside the portal reach check | Negative test the earlier review demanded and the spec's own recommendation adopted — confirm a named test exists in the final `customer-portal.md` Testing section at implementation time; as read today the six named E2E specs do not individually name a private-visibility test — **gap to close before merge**, flagged in §7 |

### 4.2 What must not be inferable from error responses / timing

| Must not be inferable | Control | Negative test |
| --- | --- | --- |
| Whether an email domain belongs to a customer organisation on this instance | `IP-29`/`CP-18`: home-realm discovery, **no enumeration** — bound and unbound domains return the same body, status **and timing class** | A test asserting response equality (body, status, timing bucket) for a bound vs. unbound domain — named in the spec as the constant-shape requirement; confirm a concrete `*.test.ts` exists for it (not only prose) at implementation time |
| Whether a resource exists but is out of reach vs. genuinely absent | `CP-2` and rbac.md's global 404-vs-403 rule; `constant-shape-404.test.ts` pattern | Extend the existing constant-shape-404 test suite to every portal and SCIM-adjacent route, not only agent-side ones |
| Whether a SCIM `userName`/`externalId` already exists on *another* connection (as opposed to same-connection retry) | `IP-18`'s `409` is a **deliberate, logged** disclosure to the *administrator* (via provisioning event), never to the calling IdP as a distinguishing response shape from a same-connection `409` — confirm the two 409 paths (`IP-18` cross-connection vs `IP-32` same-connection uniqueness) are not distinguishable by an external caller who only sees the SCIM response, only by an internal reviewer of the provisioning event log | No named test found for this specific distinction — **flagged as a gap in §7** |
| Whether a bearer token is wrong vs. revoked vs. belongs to a disabled connection | `IP-12`, edge case "Token used after rotation → 401", "Connection disabled → 403 connection_disabled" — these are **two different codes**, which is itself information (disabled vs. simply-wrong) but the spec treats that as acceptable since connection state is administrator-visible information, not tenant-existence information | `21-scim-bad-token-401.test.ts`, `23-connection-disable-revokes-sessions.test.ts` |

### 4.3 Structural risks this plan inherits from the auth-surface retrofit

- **#66 (open):** any P3 code that leans on `hasWorkspacePermission`'s current fallback
  behaviour inherits a fail-open-to-broader-authority bug. P3's own design (§1.3) avoids
  calling that function for the `max_role_rank` ceiling — this must be checked in review,
  not assumed, because it is exactly the kind of thing that regresses silently if someone
  "simplifies" the validator later to reuse the shared permission evaluator.
- **CSRF/Origin exemption for SCIM** (already resolved on `main`, verified in
  `security-model.md:222`): SCIM bearer-token requests are correctly exempted from the
  Origin/double-submit check. Confirm at implementation time that the actual SCIM route
  middleware honours this (it is a documented rule today, not yet code).
- **Elevated-action session-only conflict** (L2 finding from the pre-p0 review, resolved in
  `rbac.md`'s current "Session-only routes" section): `DELETE
  /api/instance/identity-connections/{id}` is both elevated **and** `sessionOnly: true` —
  i.e. it is **never** reachable via API key or MCP key, full stop, no pending-action path
  for that credential class. This is consistent in the current doc; confirm the connection
  editor's own "delete" affordance in God Mode does not accidentally offer a non-session
  path.
- **Rate limiting / anonymous class**: `IP-14` requires per-connection rate limiting with
  "anonymous-class limits... for failed authentication" — confirm this reuses the existing
  anonymous rate-limit class from `security-model.md` rather than inventing a second one
  (do-not 11 in spirit: don't invent a parallel mechanism for something that has a home).

---

## 5. Identifier registrations owed

**Good news, checked against the actual authoritative documents, not assumed:** every
table, capability, event key, background job and feature flag that the *current* two specs
name **already exists** in its authoritative home:

| Kind | Status |
| --- | --- |
| Tables (`identity_connection`, `scim_connection`, `external_identity`,
  `scim_group_mapping`, `scim_group_member`, `provisioning_event`, `satisfaction_rating`) | ✅ all present in `docs/01-architecture/data-model.md` §2 (identity) and the CSAT table (line 249) |
| Capabilities/policy kinds needed (`instance:admin` + elevated; portal kind-3 predicates
  `own_request`/`own_organisation`/`addressed_approval`/`own_submission`; delegated kind-5
  `scim`) | ✅ all present in `docs/01-architecture/rbac.md` |
| Feature flags/plugin kinds (`feature.customer_portal`, `feature.scim`, `auth.oidc`,
  `auth.entra`) | ✅ present in `docs/01-architecture/plugin-architecture.md` |
| Event keys (`identity.provisioned`, `identity.deprovisioned`,
  `identity.request_denied`, `identity_connection.changed`) | ✅ present in `docs/01-architecture/events.md` |
| Background jobs (`plugin-health` pings OIDC discovery docs; `secrets-rekey` covers
  `identity_connection.client_secret`) | ✅ present in `docs/01-architecture/background-jobs.md` |
| Env vars | None named by either spec — connections are DB rows, per "nothing is
  hardcoded per customer" (AGENTS.md rule 2). Confirm no implementer adds one for
  Entra-test-tenant credentials outside `configuration-reference.md`; those belong in
  **test** configuration, not the app's env surface, and if a test-tenant credential is
  needed for CI it should be a CI secret, not a `TASKDESK_*` env var. |

**What is NOT yet registered and must be, in the same change that introduces it:**
1. The provisioning state-machine's explicit state enum from §1.4 (*none / provisioned /
   active / deactivated / placeholder / claimed*) is a **modelling choice this plan
   proposes**, not something already named in `data-model.md`. If implementation adopts an
   explicit state column (rather than deriving state from `external_identity.active` +
   `person.active` + `person.is_placeholder` as the current schema implies), that column
   and its enum values must be added to `data-model.md` **first, in the same change**
   (do-not 11).
2. Whatever resolves the `organisation`/`person`/`membership` split (§0) will itself
   introduce the first real rows of these three tables — `data-model.md` already documents
   their target shape (§2, lines 106–111), so this is "implement to the existing
   authoritative doc," not "invent and register." No new registration owed there, only
   implementation.

---

## 6. Route-policy obligations

Every route P3 introduces needs a policy entry in the registry (`packages/permissions`,
enforced by the route-coverage test once #19's CI lands). From the specs, by kind:

| Route family | Kind | Why |
| --- | --- | --- |
| `/scim/v2/*` (Users, Groups, ServiceProviderConfig, ResourceTypes, Schemas) | **Kind 5, `delegated: 'scim'`** | Already a named member of the closed `delegated` union in `rbac.md` — no new kind needed, no decision-log entry needed to add it (it is already there). The route-coverage test enumerates Hono's router, and per rbac.md's explanation of kind 5, "a delegated mount is explicitly allowlisted, with the surface behind it unenumerated" — confirm at implementation time that the coverage test's allowlist check for the `scim` mount is written the same way as the existing `better-auth`/`websocket`/`metrics` ones (constructed-config assertion, not a static route list), consistent with how kind 5 is meant to work. |
| `POST/GET/PATCH/DELETE /api/instance/identity-connections*` | **Kind 1**, `{ capability: 'instance:admin', scope: 'instance', scopeSource: 'instance' }`, most with `elevated: true, sessionOnly: true` | Already specified route-by-route in `identity-provisioning.md`'s API section, and cross-checked against `rbac.md`'s elevated-actions table — the two agree (creating/rotating/revoking a connection or SCIM token, and authority-widening group mappings, are elevated; read and non-authority-widening PATCHes are not). |
| `GET /api/instance/organisations/{id}/identity` | **Kind 1**, `instance:admin`, scope `instance` (or `organisation` once that scope exists — see §0) | Spec says this is a view over the same routes filtered by `organisation_id` — one implementation, so one policy declaration, not two. |
| `/api/portal/*` (all 22 routes) | **Kind 3**, `{ portal: 'customer', predicate: … }` | Every route in the customer-portal.md API table already names its predicate (`own_request`, `own_organisation`, `addressed_approval`, `own_submission`, `self`). This is the fix the 2026-09-05 review demanded ("22 routes with no policy") and it is **already applied** in the current spec text — confirmed by reading the file directly, not by trusting the review's stale verdict. |
| `GET /api/portal/me`, `PATCH /api/portal/account` | **Kind 2**, `{ authenticated: true, self: true }` **or** kind 3 `self` predicate | The spec's table lists `self` as a predicate value under kind 3 rather than switching to kind 2 — confirm at implementation time which the registry actually expects; `rbac.md`'s `PortalPredicate` union as quoted does **not** list `'self'` as one of its four values (`own_request \| own_organisation \| addressed_approval \| own_submission`). **This is a real mismatch between `customer-portal.md`'s API table (which writes `self` for `/api/portal/me` and `PATCH /api/portal/account`) and `rbac.md`'s `PortalPredicate` type as written** — flagged as a finding in §7, not resolved here. |

**Explicitly not doing:** nothing from P3 goes into
`tests/permissions/inherited-uncovered.json` — that allowlist is for pre-existing inherited
routes only, and every P3 route is new, so it must carry a real, checked policy from day
one, never an entry in that file (per the task's own hard instruction, restated here so the
implementer sees it in the plan, not only in the prep brief).

---

## 7. Findings — where the spec, as written, does not fully agree with itself or the code

Stated precisely, as findings, per the discipline this task set:

1. **`PortalPredicate` mismatch (rbac.md vs. customer-portal.md).** `rbac.md`'s `Policy`
   type quotes `PortalPredicate = 'own_request' | 'own_organisation' | 'addressed_approval'
   | 'own_submission'` — four values, no `'self'`. `customer-portal.md`'s API table uses
   `self` for `GET /api/portal/me` and `PATCH /api/portal/account`. Either `PortalPredicate`
   needs a fifth value (`'self'`), or those two routes need to be kind 2
   (`{ authenticated: true, self: true }`) instead of kind 3, or `rbac.md`'s union is
   incomplete. This is a **shared-contract file** (`packages/permissions` / route-policy
   types are explicitly listed as orchestrator/contract-owned in CLAUDE.md §5) — P3 cannot
   fix this itself; it needs a small dedicated contract PR, per CLAUDE.md's own rule for
   exactly this situation.
2. **Issue #39's stage-gate test count (17) does not match the spec's current test count
   (25).** The spec was extended (`IP-26`…`IP-32` and the placeholder rule) after the issue
   was written, and the issue body was never updated. Needs a decision: does "all named
   tests pass against a real Entra tenant" mean all 25, or only some subset — and if 25,
   the issue text should be corrected (a control-plane edit, so this plan reports it rather
   than making it).
3. **No named negative test for the `CP-16` private-visibility-within-one-organisation
   case** in the customer-portal.md Testing section's six-item security E2E list, despite
   the earlier review explicitly demanding one and the spec's own behaviour rule requiring
   it. The six named specs cover cross-tenant, internal comments, de-escalation, self-
   approval, cross-origin session, and bundle purity — not "colleague inside the same org
   but wrong `customer_visibility` scope." Recommend adding a seventh named spec
   (`portal-private-visibility-scoped-to-participants.spec.ts`) before implementation
   starts, rather than treating `portal-cross-tenant.spec.ts` as if it covers this — it
   tests a different boundary (organisation, not participant-list).
4. **No named test distinguishing the two `409` paths** (`IP-18` cross-connection vs.
   `IP-32` same-connection uniqueness) as *not externally distinguishable* — worth an
   explicit negative test given how much of this spec's threat model rests on "the response
   does not disclose more than the caller is entitled to."
5. **The organisation/person/membership schema split has no owning issue** (§0) — this is
   the single biggest planning gap for this lane and is restated as the first open question
   for Thomas in §8, not silently assumed to be "someone else's problem already scheduled."
6. **The residual medium/low findings from the 2026-09-05 review of `customer-portal.md`
   that were *not* closed by the later edits** (verified via `git log` — the fixing commits
   `0da8018`/`2f32bed`/`b852b3b` postdate the frozen review at `fb8318e`, and most High
   findings are demonstrably fixed in the current file, but not all): the Permissions
   section is still prose, not the table the spec template requires; rule numbering still
   runs `CP-1`…`CP-10`, `CP-15`, `CP-11`…`CP-14` out of order; the escalation ladder
   ("any strictly increasing change permitted") is stated in `rbac.md`'s customer-role
   table but not restated in `customer-portal.md`'s own `CP-7`; the "linked new request"
   edge case still does not name which request type it uses. None of these are blocking —
   they are polish the implementer should clean up in the same PR that touches those
   sections, not a separate excuse to reopen the spec.

---

## 8. Open questions genuinely needing Thomas

Checked against `decision-log.md` first — none of these appear already decided there.

1. **Who owns and when does the `organisation`/`person`/`membership` schema split land?**
   (§0, §7.5). It is a hard prerequisite for both #38 and #39 and currently has no issue,
   no step in the retrofit's S0–S11 table, and no scheduling slot in `status.md`. Without an
   answer, "P3 waits behind S10" is necessary but not sufficient — P3 also waits behind
   whatever this is, and that has no name yet.
2. **Does the P3 identity stage gate require all 25 named SCIM/Entra acceptance tests
   against the real tenant, or the 17 issue #39 currently names?** (§7.2) — a one-line
   confirmation, plus a control-plane edit to #39's body once answered.
3. **Is `PortalPredicate` missing a `'self'` value, or should `/api/portal/me` and
   `PATCH /api/portal/account` be kind 2 instead of kind 3?** (§7.1) — small contract fix,
   needs the shared-contract-owner path (CLAUDE.md §5), not a P3-lane decision.
4. **Does the portal's organisation resolution reuse `session.active_organization_id`/
   `active_workspace_id` (S8a/S8b's column), or does it resolve purely from
   `person.organisation_id` once that table exists, with no session-column involvement at
   all?** Neither the retrofit plan nor the two P3 specs state this explicitly — worth
   deciding before S8-family work and P3 schema work land in the same window, so one does
   not silently assume the other's shape.

---

## NOT DONE

- Did not read `auth-and-identity.md`, `security-model.md`, `multi-tenancy.md`,
  `auth-runtime-reconfiguration.md`, `god-mode.md`, `pending-actions.md`, or
  `data-protection.md` in full — relied on the quotations of them already embedded in
  `identity-provisioning.md`/`customer-portal.md`/`rbac.md`, which are extensive and
  directly cited, but a full read of those five documents could surface additional
  cross-document mismatches of the kind found in §7. **Uncertain**: whether
  `auth-and-identity.md`'s "protocol floor" section fully agrees with `IP-7`'s restatement
  of it — I did not diff them side by side.
  Update: this specific line was checked against decision-log.md's summary row (line 1216)
  and is consistent; a full side-by-side of the two documents' prose was still not done.
- Did not inspect any actual application code in `apps/api/src` — no `auth.ts`, no
  `require-workspace-permission.ts`, no existing route files. Everything about current
  code behaviour (the #66 fallback, the retrofit's file:line evidence) is taken from the
  issues and the retrofit-plan document's own quoted evidence, not independently re-verified
  against the source in this session. The task's hard boundaries also do not require
  building/running anything, and reading `apps/api/src` was not necessary to answer the
  planning questions asked, but it means any *code-level* surprise (a file moved, a line
  number drifted) is not caught here.
- **Checked, not just flagged:** `apps/api/drizzle/` on this checkout goes up to
  `0049_drop_device_code.sql` — confirms the retrofit plan's "next free number is 0050."
  Grepped every migration file for `identity_connection`, `scim_connection`, and any
  `CREATE TABLE` naming `organisation` or `person` — **zero hits**. None of the identity
  tables, nor `organisation`/`person`/`membership`, exist in any migration on this
  checkout. §0's and §2's claims about the schema gap are verified directly against the
  migration history, not only inferred from the retrofit doc's prose.
- Did not read `docs/03-features/teams.md`, `god-mode.md`'s full identity screens section,
  or `mcp-server.md` in full — only as cross-referenced from rbac.md/identity-provisioning.md.
- Did not check `docs/04-engineering/testing-strategy.md` for how the "real Entra test
  tenant" gate is operationally satisfied (credentials, CI secret plumbing) — relevant to
  open question 2 but not chased down.
- Did not review `docs/07-planning/reviews/2026-09-05/architecture-engineering-ops.md` or
  `feature-gaps-openproject-itsm.md` in depth beyond the grep pass that found no P3-specific
  open findings in them.
- Time/tool budget: did not spawn any Sonnet subagents for this prep task (single-agent
  read-and-plan was sufficient given the scope and the instruction that this agent itself
  may be killed by a stall watchdog — writing incrementally was prioritized over exhaustive
  parallel research).
