# Identity connections and SCIM provisioning — Microsoft Entra first

- **Phase:** P3 (data model, security rules and acceptance tests fixed in P0; identity,
  membership, RBAC, audit and revocation infrastructure proven in P1/P2; operational
  hardening in P4)
- **Status:** ⬜
- **Feature flag:** `feature.scim` (the SCIM endpoint; default on once P3 ships — a
  connection must also be enabled). OIDC sign-in is part of authentication and is not
  flag-gated.
- **Depends on:** [auth-and-identity.md](../01-architecture/auth-and-identity.md),
  [RBAC](../01-architecture/rbac.md), [customer-portal.md](customer-portal.md),
  [god-mode.md](god-mode.md), [audit-trail.md](audit-trail.md)
- **Decided:** 2026-09-05, Thomas — SCIM is **core delivery**, not a candidate

## Purpose

TaskDesk authenticates with Microsoft Entra and is multi-organisation: internal staff and
external customer organisations both need safe **joiner / mover / leaver** handling. OIDC
answers "who is this, right now, at login". SCIM answers "create this person before they
first sign in, update them, and — the security-relevant half — **disable them the moment
the directory does**". Without SCIM, offboarding depends on someone remembering.

| | OIDC | SCIM |
| --- | --- | --- |
| When | At login | Whenever the directory changes |
| Does | Authenticates; establishes identity; issues a TaskDesk session | Creates, updates, activates/deactivates local records; optionally synchronises groups for controlled role mapping |
| Direction | User's browser ↔ IdP ↔ TaskDesk | IdP → TaskDesk (inbound, privileged) |

## Concepts

| Term | Meaning |
| --- | --- |
| **Identity connection** | One configured external identity source: provider type (Entra first), portal scope (`agent` or `customer`), and — for customer connections — exactly one organisation |
| **SCIM connection** | The inbound provisioning channel attached to one identity connection; owns the hashed bearer token, allowed resources and mappings |
| **External identity** | The durable link between a local person and an external identity: `issuer` + immutable `subject` (+ SCIM `externalId`), **never email alone** |
| **Group mapping** | An allowlisted external group → one existing TaskDesk role, inside the connection's organisation and portal scope |
| **Provisioning event** | The ledger of everything SCIM/OIDC provisioning did, denied or failed |

## Identity architecture — what TaskDesk stores, what Entra owns

TaskDesk stores and is authoritative for: `user`, `person`, `organisation`, memberships
(organisation / workspace / project), roles and capabilities, `external_identity`,
`identity_connection`, `scim_connection`, `scim_group_mapping`, sessions, API/MCP key
ownership, and the audit history. Entra remains the source of authentication, user
lifecycle, directory attributes and (where enabled) group membership. TaskDesk never
stores an external user's password.

**Identity key.** An external identity is identified by `(identity_connection_id, issuer,
subject)` and, for SCIM-created records, `externalId`. The organisation binding and the
portal scope are properties of the *connection*, resolved server-side. Email is an
attribute that may change; it is never the sole key and never a linking key on its own
(`IP-18`).

**Where connections live.** OIDC connections are `identity_connection` rows with typed
columns (the organisation FK and the SCIM link cannot live in a generic `config jsonb`).
The `auth.*` plugin *kinds* (`auth.oidc` and its presets `auth.entra`, `auth.keycloak`, …)
are still registered in the plugin registry and provide the protocol implementation; their configured
*instances* are `identity_connection` rows rather than `instance_plugin_config` rows. Non-OIDC
authentication (`auth.password`, `auth.email-otp`, `auth.magic-link`) stays in
`instance_plugin_config`. The auth reconfiguration mechanism
([auth-runtime-reconfiguration.md](../01-architecture/auth-runtime-reconfiguration.md))
watches both.

## Data

[data-model.md](../01-architecture/data-model.md) §2: `identity_connection`,
`scim_connection`, `external_identity`, `scim_group_mapping`, `scim_group_member`,
`provisioning_event`. `person.active`, `session`, `api_key.disabled_at` are the columns
de-provisioning writes.

## Behaviour

### Connections and scope

- `IP-1` An identity connection has a **portal scope** of exactly `agent` or `customer`.
  An `agent` connection has no organisation; a `customer` connection is bound to **exactly
  one** customer organisation. A connection can never serve both portals — `both` is not a
  value ([ADR 0004](../01-architecture/adr/0004-two-portals-two-origins.md)).
- `IP-2` A `customer` connection may create or manage **only customer-side people of its
  own organisation**, holding **only the customer role** (until a customer-role model is
  separately specified). It can never: create staff-side users; create instance
  administrators; grant `owner`, `admin`, `manager`, `lead` or any staff role; grant
  `sees_all`; add anyone to another organisation; grant arbitrary capabilities; touch agent
  routes or God Mode; create API keys, MCP keys, webhooks, automations or integrations.
- `IP-3` An `agent` connection may create, update and deactivate **staff-side** people,
  create or update **permitted** workspace memberships, and apply only **approved
  staff-side roles** up to the connection's configured `max_role_rank`. It can never grant
  `instance:admin`, grant `sees_all`, grant a role above `max_role_rank`, or let a group
  *name* alone create capabilities. Rank guardrails and elevated-action rules in
  [RBAC](../01-architecture/rbac.md) apply to what a connection is configured to grant.
- `IP-4` **All scope is resolved from the connection**, never from the request. A SCIM or
  OIDC payload supplying `organisation_id`, `workspace_id`, a role, a capability or a portal
  scope is rejected `400 forbidden_attribute` — it is not ignored, it is refused, and the
  denial is a provisioning event.
- `IP-5` Configuring any connection — agent or customer — is an **instance administrator**
  action in God Mode. In the first release, customer organisations **cannot** configure
  their own issuer, SCIM token, role mapping, integration credentials, staff access or
  cross-organisation access. Customer self-service IdP setup is a later feature with its own
  spec, security review, validation workflow and approval model.
- `IP-6` Creating or changing a connection, rotating or revoking a SCIM token, and any
  group mapping that creates staff access, grants above `member`, changes reach, or grants
  instance authority are **elevated, audited** actions
  ([rbac.md](../01-architecture/rbac.md#elevated-and-audited-actions--the-single-list)).
  Mapping to `instance:admin` or `sees_all` is not elevated — it is **impossible**: the
  mapping editor does not offer it and the server refuses it.

### OIDC login

- `IP-7` Every connection enforces the protocol floor in
  [auth-and-identity.md](../01-architecture/auth-and-identity.md#what-every-authoidc-plugin-must-do--the-protocol-floor):
  PKCE `S256`; single-use random `state` bound to the initiating session **and portal**;
  `nonce` validated; exact redirect-URI match; ID-token signature, `iss`, `aud`, `exp`
  validated before any claim is read. Any failure ⇒ sign-in fails, audited.
- `IP-8` A customer connection's callback is accepted **only on the portal origin**, an
  agent connection's only on the agent origin; the resulting session carries the matching
  `session.portal` and is unusable on the other host.
- `IP-9` Domain-based mapping requires `email_verified = true`, and one email domain is
  bound to one approved connection ([security-model.md](../01-architecture/security-model.md#identity-provisioning-and-account-linking)).
- `IP-10` JIT provisioning (create on first login) is a per-connection policy, off by
  default for customer connections when SCIM is enabled — the directory, not the login,
  creates people. When both are on, the first login **links** to the SCIM-created record by
  `subject`/`externalId`; it never creates a duplicate.

### SCIM endpoint

- `IP-11` One SCIM 2.0 endpoint family on the agent origin: `/scim/v2/Users`,
  `/scim/v2/Users/{id}`, `/scim/v2/Groups`, `/scim/v2/Groups/{id}`,
  `/scim/v2/ServiceProviderConfig`, `/scim/v2/ResourceTypes`, `/scim/v2/Schemas`.
  Media type `application/scim+json`. HTTPS only.
- `IP-12` Authentication is a **bearer token per SCIM connection**: shown once at creation,
  stored as a hash, rotatable and revocable. **Rotation invalidates the old token
  immediately** — there is no grace window; the God Mode flow rotates, shows the new token
  once, and tells the administrator to update Entra before re-enabling. The token
  determines the connection, therefore the organisation, portal scope, allowed resource
  types and allowed mappings. Raw token values never appear in logs, responses, exports or
  audit detail.
- `IP-13` Required for Entra interoperability, and the whole first-release surface: `POST
  /Users`; `GET /Users?filter=userName eq "…"` (and `externalId`, and the configured match
  attributes) returning a correct `ListResponse`; `GET /Users/{id}`; `PATCH /Users/{id}`
  (`active`, profile attributes); `PUT /Users/{id}`; `GET /Users` with `startIndex`/`count`
  pagination; `ServiceProviderConfig`, `ResourceTypes`, `Schemas`. **`/Bulk` is not
  implemented** unless Entra interoperability testing proves it necessary. `DELETE /Users/{id}`
  is accepted and treated as `active=false` (`IP-15`) — SCIM de-provisioning is never a
  hard delete.
- `IP-14` Schemas are validated **strictly**: unknown attributes, forbidden attributes
  (`IP-4`) and oversized bodies are rejected with SCIM error responses. Requests are
  rate-limited per connection (anonymous-class limits apply to failed authentication).
- `IP-15` **Deactivation** (`active=false`, or `DELETE`): set `person.active = false`; revoke
  every session; revoke every personal API key and MCP key; remove or reduce workspace and
  project memberships per the connection's `lifecycle_policy` (default: memberships end);
  **preserve** authored work items, comments, approvals, activity and audit rows, attributed
  to a deactivated/former member; write a provisioning event with source, organisation,
  external identity, previous state and resulting action. Local user deletion and
  anonymisation remain the separate elevated administrative process in
  [data-protection.md](../05-operations/data-protection.md).
- `IP-16` **Reactivation** (`active=true`) reactivates only the existing linked
  `external_identity`'s person; it never creates a duplicate and never restores roles the
  connection is not permitted to grant — memberships are re-derived from current group
  mappings, not restored from history.
- `IP-17` Profile updates (`PATCH`/`PUT`) may change permitted attributes — name, email
  snapshot, `userName`, job title, locale — and can never alter organisation, portal scope,
  role, reach or capabilities.

### Linking and identity

- `IP-18` **No automatic linking on email.** A login through connection B for an email that
  exists via connection A is refused with an explanation. Linking requires an authenticated
  session on A and an explicit, audited confirmation. The SCIM path is stricter still: a
  SCIM `POST /Users` whose `userName`/email matches an existing person of a *different*
  connection or organisation is refused `409` and logged — it does not adopt the record.
- `IP-19` Within one connection, SCIM create followed by first OIDC login links by
  `subject` (Entra `oid`) and `externalId`; the email snapshot is updated, not matched.

### Groups

- `IP-20` SCIM `/Groups` is supported **only for allowlisted group → role mapping**. A
  `scim_group_mapping` row names one external group and **one existing TaskDesk role**
  inside the connection's organisation (customer) or an approved workspace (agent).
  Unmapped groups are stored as opaque names and grant nothing.
- `IP-21` Customer groups map only to customer roles; agent groups map only to approved
  staff roles at or below `max_role_rank`. No group can grant `instance:admin` or
  `sees_all`; no group can create roles or capabilities; no group can add anyone to another
  organisation.
- `IP-22` Group membership changes are symmetric: removal from a mapped group removes the
  membership it derived (`scim_group_member` is the ledger). Memberships granted by an
  administrator directly are **not** touched by group sync.
- `IP-23` Nested-group resolution beyond what Entra sends directly is out of scope.

### Audit and health

- `IP-24` Every configuration change, provisioning event, de-provisioning event, group
  mapping change, token rotation, denied request and failed authentication writes a
  `provisioning_event` row; those that change authority, reach or configuration also write
  `audit_log`. The God Mode identity screens show provisioning status, last sync result and
  errors **without exposing secrets**.
- `IP-25` `plugin-health` pings each enabled connection's discovery document; a connection
  whose IdP is unreachable is flagged in God Mode → Health.

## Permissions

| Action | Capability |
| --- | --- |
| View identity connections | `instance:admin` |
| Create, edit, enable, disable, delete a connection | `instance:admin` + elevated |
| Create, rotate, revoke a SCIM token | `instance:admin` + elevated |
| Edit group mappings | `instance:admin`; elevated when the mapping grants above `member`, staff access or reach |
| Call `/scim/v2/*` | The SCIM bearer token — `delegated: scim`, organisation and portal from the token |
| Sign in through a connection | Anyone the connection's portal and organisation admit |

## Screens

| Screen | Route | Notes |
| --- | --- | --- |
| God Mode → Authentication (identity connections, agent scope) | `/agent/god-mode/authentication` | Existing rows; the list becomes "identity connections" |
| Connection editor | `/agent/god-mode/authentication/{id}` | OIDC settings, JIT policy, domain bindings, **SCIM panel** (endpoint URL, token create/rotate/revoke, allowed resources, mappings, last sync), Test OIDC, Test SCIM |
| God Mode → Organisations → detail → **Identity** | `/agent/god-mode/organisations/{id}/identity` | The customer-organisation connection: enable/disable portal SSO; provider type (Entra first); organisation-bound OIDC settings; SCIM endpoint info; token create/rotate; Test OIDC; Test SCIM; provisioning status and last sync; errors without secrets; attribute mapping; group mapping; audit history; **unmissable organisation-scope and portal-scope warnings** |

## API

```
GET    /api/instance/identity-connections                         instance:admin
POST   /api/instance/identity-connections                         instance:admin  E
PATCH  /api/instance/identity-connections/{id}                    instance:admin  E
DELETE /api/instance/identity-connections/{id}                    instance:admin  E  (pending action — typed name + step-up)
POST   /api/instance/identity-connections/{id}/test               instance:admin      (audited even unsaved)
POST   /api/instance/identity-connections/{id}/scim               instance:admin  E  (create SCIM connection + first token)
POST   /api/instance/identity-connections/{id}/scim/rotate-token  instance:admin  E
POST   /api/instance/identity-connections/{id}/scim/revoke-token  instance:admin  E
PATCH  /api/instance/identity-connections/{id}/scim               instance:admin  E*  (mappings, lifecycle policy, enabled — *E when a mapping grants staff access, a role above member, or reach; IP-6)
POST   /api/instance/identity-connections/{id}/scim/test          instance:admin
GET    /api/instance/identity-connections/{id}/events             instance:admin      (provisioning events, paged)

GET    /api/instance/organisations/{id}/identity                  instance:admin      (the organisation's connection, or none)

/scim/v2/*                                                        delegated: scim    (bearer token → connection)
```

The organisation identity screen is a view over the same `identity-connections` routes
filtered to `organisation_id`; there is one implementation.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Entra sends a user whose email domain is bound to another connection | Refused `409`, provisioning event `request.denied`, administrator notified |
| Token used after rotation | `401`; provisioning event `auth.failed`; counted against the anonymous rate class |
| Two connections claim the same organisation | Refused at save — one active customer connection per organisation in the first release |
| Connection disabled while users have sessions | Sessions stay valid until idle/absolute expiry; new logins refused; SCIM calls `403 connection_disabled` |
| Connection deleted | Pending action (typed name + step-up); external identities are kept, marked orphaned; people are **not** deactivated automatically — the administrator chooses |
| Entra sends `active=false` for the last instance administrator | Deactivated like anyone else — break-glass is the CLI, not an exception in SCIM |
| Group mapped to a role later deleted | Mapping auto-disabled and flagged; derived memberships removed |

## Out of scope (first release)

SCIM `/Bulk`; generic SCIM for every provider (build standards-based, validate against
Entra, then extend provider by provider — Okta, Keycloak, Google Workspace, generic OIDC
are future); customer self-service IdP configuration; SAML; LDAP; nested-group resolution;
a customer-role model richer than the single customer role.

## Testing

`tests/api-integration/identity/` — each named for the acceptance test it implements, run
on every PR against a mock IdP and **against a real Microsoft Entra test tenant before the
P3 identity gate closes** (the gate is stated in [phases.md](../07-planning/phases.md#p3--portal-and-identity)
and [security-model.md](../01-architecture/security-model.md#testing-security)). Also
listed in [testing-strategy.md](../04-engineering/testing-strategy.md).

```
01-agent-oidc-staff-only-agent-portal.test.ts
02-customer-oidc-bound-to-one-organisation.test.ts
03-portal-isolation-both-directions.test.ts
04-scim-token-cannot-touch-other-organisation.test.ts
05-no-user-controlled-tenant-selection.test.ts
06-customer-connection-cannot-create-staff-or-authority.test.ts
07-scim-create-scoped-person.test.ts
08-scim-filter-username-externalid-listresponse.test.ts
09-scim-patch-cannot-alter-tenant-reach-authority.test.ts
10-scim-deactivate-revokes-sessions-and-keys-preserves-history.test.ts
11-scim-reactivate-no-duplicate-no-prohibited-roles.test.ts
12-group-maps-only-to-permitted-role-and-scope.test.ts
13-nothing-grants-instance-admin-automatically.test.ts
14-token-rotation-invalidates-old-and-never-leaks.test.ts
15-oidc-protocol-failures-block-sign-in.test.ts
16-same-email-second-idp-does-not-autolink.test.ts
17-every-identity-event-is-audited.test.ts
```

Plus the IDOR fuzz and tenant-isolation suites, which cover `/scim/v2/*` like any other
scoped surface.

## Open questions

*(None — the decision document of 2026-09-05 closed them.)*

## Related

- [Auth and identity](../01-architecture/auth-and-identity.md) · [Security model](../01-architecture/security-model.md#scim--an-inbound-privileged-management-api)
- [RBAC](../01-architecture/rbac.md) · [Data model](../01-architecture/data-model.md) · [God Mode](god-mode.md)
- [Customer portal](customer-portal.md) · [Data protection](../05-operations/data-protection.md)
