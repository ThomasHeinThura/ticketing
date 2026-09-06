# Authentication and identity

> **Design goal:** works out of the box with zero configuration, and scales to any
> enterprise identity setup without a code change.

## Layers

```
┌───────────────────────────────────────────────────────────────┐
│ 1. AUTHENTICATION — "who is this?"                            │
│    better-auth. Sessions, MFA, providers.                      │
│    Pluggable: password · magic link · OTP · TOTP · passkey ·   │
│    any number of OIDC providers · social.                      │
└───────────────────────────────────────────────────────────────┘
                              ↓ userId
┌───────────────────────────────────────────────────────────────┐
│ 2. IDENTITY RESOLUTION — "who are they here?"                  │
│    userId → directory record.                                  │
│    side · organisation · memberships · reach · authority.      │
│    ALWAYS from the database. NEVER from a token claim.         │
└───────────────────────────────────────────────────────────────┘
                              ↓ ResolvedIdentity
┌───────────────────────────────────────────────────────────────┐
│ 3. AUTHORIZATION — "may they do this?"                         │
│    packages/permissions. See rbac.md.                          │
└───────────────────────────────────────────────────────────────┘
```

Keeping these separate is what makes the identity provider swappable. The authorization
layer never knows or cares how someone logged in.

## Why better-auth is primary

| Requirement | better-auth |
| --- | --- |
| Works with zero config | ✅ email + password out of the box |
| Multi-organisation | **Not used.** better-auth's organisation plugin is removed at the fork — our own `organisation` / `membership` / `team` / `invitation` tables are the directory, because identity is always resolved from *our* database. better-auth does authentication only |
| MFA | ✅ two-factor plugin — TOTP, backup codes. **Added by us**; kaneo does not enable it |
| Magic link | ✅ inherited |
| Email OTP | ✅ inherited |
| Passkeys | ✅ passkey plugin. **Added by us**, after P0 |
| Arbitrary OIDC | ✅ genericOAuth — **configurable at runtime** |
| API keys | ✅ apiKey plugin |
| Impersonation | ✅ admin plugin — kept **only as a session primitive**; the authority check is ours (see the plugin table) |
| TypeScript-native, Drizzle adapter | ✅ |
| Already in kaneo | ✅ the library. **Not the plugin set** — see the plugin table below |

Keycloak is **not** a dependency. It is one OIDC provider among many, added through
God Mode if a deployment wants it. That is the difference between "we support Keycloak"
and "we require Keycloak".

### The better-auth plugin set — inherited, removed, added

kaneo enables eleven better-auth plugins and enables neither `twoFactor` nor `passkey`.
"Already in kaneo" above is true of the library and false of half the capabilities, in both
directions, so the verdict is written per plugin. The removals are the identity half of the
fork-time removal and disable list in
[decision-log.md](../07-planning/decision-log.md); the doing is
[repository-bootstrap.md](../04-engineering/repository-bootstrap.md) §3 and the verdicts are
registered in [inherited-features.md](inherited-features.md).

| Plugin | Verdict | Note |
| --- | --- | --- |
| `magicLink` | inherited — kept | `auth.magic-link` |
| `emailOTP` | inherited — kept | `auth.email-otp` |
| `genericOAuth` | inherited — kept | the protocol implementation every `auth.oidc` connection is built on |
| `apiKey` | inherited — kept | the credential only; our `api_key` table owns everything else |
| `admin` | inherited — kept **as a session primitive only** | its HTTP routes are **not mounted**, `user.role` is **never read**, and `POST /api/instance/users/{id}/impersonate` ([rbac.md](rbac.md)) does the authority check and sets `impersonatedBy`. Using the plugin's own endpoints would reintroduce the second authority source the identity-resolution rule forbids |
| `openAPI` | inherited — kept | development only |
| `lastLoginMethod` | inherited — kept | |
| `anonymous` | **removed at fork** | guest sign-in, on by default in kaneo. An ephemeral-identity surface does not ship dormant |
| `deviceAuthorization` | **removed at fork** | a device-code grant no v2 spec asks for |
| `bearer` | **removed at fork** | a second token-bearing authentication surface |
| `organization` | **removed at fork — P0 step 1b** | see below |
| `twoFactor` | **added — P0** | TOTP and backup codes |
| `passkey` | **added — later phase** | |

**The organization plugin is kaneo's workspace model, not a dormant feature.** In kaneo it
maps `organizationId → workspaceId` and owns `workspace`, `workspace_member`, `invitation`,
`workspace_role`, `team` and `teamMember` through the adapter schema, with hooks for create,
delete and seat sync. Removing it is therefore a retrofit, done in **P0 step 1b**: our own
`organisation` / `workspace` / `membership` / `role` tables ([data-model.md](data-model.md)
§2) replace `workspace_role` and `team`, our own `invitation` table and the flow below
replace the plugin's, and the whole `/organization/*` route family — including the
`/organization/invite-member` route the invitation flow currently runs on — **disappears from
the router**, which the inherited route-coverage expectation in
[repository-bootstrap.md](../04-engineering/repository-bootstrap.md) accounts for.

Two inherited defaults are disabled rather than removed, and both are load-bearing here:
`account.accountLinking` (see [Placeholder people](#identity-resolution--the-important-rule)
and `IP-18`) and `session.cookieCache` (see [Sessions](#sessions)).

## Runtime provider configuration

Providers are `auth.*` plugins (see [Plugin architecture](plugin-architecture.md)), edited
in God Mode, and **loaded into the better-auth instance at boot and on change**. They live
in two tables, and the difference matters to the reload mechanism:

- **Non-OIDC auth plugins** — `auth.password`, `auth.email-otp`, `auth.magic-link` — are
  `instance_plugin_config` rows.
- **OIDC connections** — every configured instance of `auth.oidc` and its presets
  `auth.entra`, `auth.keycloak`, … — are **`identity_connection` rows**, because the
  organisation FK and the SCIM link cannot live in a generic `config jsonb`
  ([identity-provisioning.md](../03-features/identity-provisioning.md),
  [data-model.md](data-model.md) §2). The plugin *kinds* stay in the plugin registry and
  provide the protocol implementation.

Both tables carry `config_version`, and the reload mechanism watches **both**.

Implementation note: better-auth is configured once at construction. To support runtime
changes we build the auth instance from database configuration and rebuild it when
configuration changes, swapping the handler behind a stable reference. Config changes
apply within seconds without a restart. **The full mechanism — build-validate-swap
ordering, rollback when construction throws, what survives a swap, propagation to
replicas with and without Valkey, and the test list — is designed in
[auth-runtime-reconfiguration.md](auth-runtime-reconfiguration.md).** ADR 0006 calls this
the most delicate code in the system; it is not left to a paragraph.

### The God Mode flow

```
God Mode → Authentication → [ Add connection ]          (agent connections)
God Mode → Organisations → Contoso → Identity → [ Add connection ]   (customer — same form)

  Choose type:
    ┌──────────────────┬──────────────────┬──────────────────┐
    │ Microsoft Entra  │ Keycloak         │ Generic OIDC     │
    ├──────────────────┼──────────────────┼──────────────────┤
    │ Google           │ GitHub           │ GitLab           │
    ├──────────────────┼──────────────────┼──────────────────┤
    │ SAML 2.0 (later) │ LDAP (later)     │                  │
    └──────────────────┴──────────────────┴──────────────────┘

  Form is generated from the plugin's Zod schema:
    Display name          "Contoso Staff SSO"          ← what users see on the button
    Portal                (•) Agent  ( ) Customer      ← exactly one; never both (IP-1)
    Organisation          —  (required when Customer; fixed to one organisation)
    Discovery URL         https://login.microsoftonline.com/<tenant-guid>/v2.0/...
                          ← a specific tenant; /common and /organizations are refused (IP-26)
    Client ID             …
    Client secret         •••••••• (encrypted at rest)
    Scopes                openid profile email
    Claim mapping         identifier: oid + tid (fixed) · email: email → preferred_username
                          → upn · name → name · groups → groups          (IP-27)
    Auto-provision (JIT)  [x] create a person on first login
      → role              Viewer ▾   (≤ this connection's max role rank; customer
                                      connections have exactly one choice: Customer)
    Max role rank         50 (Lead) ▾                     ← agent connections only
    Group → role mapping  1f9a…-c3d2 "TaskDesk-Leads" → Lead   [+ add rule]
                          ← keyed on the group OBJECT ID; the name is a snapshot (IP-28)
    Domain bindings       contoso.com                     ← each domain bound to one connection
    MFA upstream          (•) honour amr/acr claim  ( ) static  ( ) off
    SCIM provisioning     [ ] enable → token, resources, mappings (IP-11…IP-23)
    Enabled               [x]

  [ Test connection ]   ← performs a real discovery + token exchange dry-run
  [ Test SCIM ]
  [ Save ]
```

Two things the form deliberately **cannot** express, because `IP-4` forbids them: **side**
is never chosen — it follows the connection's portal (`agent` ⇒ staff, `customer` ⇒
customer); **organisation** is never derived from a claim or an email domain — a customer
connection is bound to one organisation at creation, an agent connection to the instance.
The same form serves both places it appears: God Mode → Authentication → *Add connection*
(agent) and God Mode → Organisations → *org* → Identity → *Add connection* (customer, with
the organisation pre-filled and locked).

The **Test connection** button is not optional polish. An administrator must be able to
verify a provider before making it live, or the first person to discover it is broken
will be a locked-out user. It is an outbound connection with admin-supplied credentials,
so it goes through the central egress client, is rate-limited, and is **audited even
though nothing is saved** ([security model](security-model.md#input-handling)).

### What every `auth.oidc` plugin must do — the protocol floor

These are properties of the `auth.*` plugin contract, not per-provider options, and the
auth reconfiguration suite asserts each of them against a mock IdP:

- **PKCE with `S256`** on every authorization-code flow, including confidential clients.
- A **`state`** value that is single-use, CSPRNG-generated, bound to the initiating
  session *and* to the portal it was started from, and expired after ten minutes.
- A **`nonce`** in the request, validated in the ID token; the ID token's `iss`, `aud`,
  `exp` and signature (via the discovered JWKS, cached, with key rotation honoured) are
  validated before any claim is read.
- Redirect URIs are exact-match, per portal, and never taken from the request.
- The issuer is the connection's **resolved, tenant-specific** issuer, and — for Entra —
  the token's `tid` must equal the connection's tenant as well as its `iss` (`IP-26`).
- The domain mapping and the account-linking rules below apply **after** the token is
  validated, never to raw claims.

### What Microsoft Entra actually sends — the claim rules

Entra is the one provider in core delivery, and three of its behaviours break a naive OIDC
mapping. The rules are **stated normatively in
[identity-provisioning.md](../03-features/identity-provisioning.md)**, which owns the `IP-n`
numbering; they are named here only so that an implementer reading the protocol floor knows
they exist.

- **The issuer must be a specific tenant** — `IP-26`. `/common` and `/organizations` are
  refused at save; the connection stores the resolved tenant-specific issuer; every ID token
  must match both `iss` and `tid`. `05-no-user-controlled-tenant-selection.test.ts`.
- **The identifier is `oid` + `tid`, and there may be no `email` claim** — `IP-27`. Address
  precedence `email` → `preferred_username` → `upn`; no `email_verified` claim exists at
  all; JIT fails closed rather than inventing an address.
- **The `groups` claim carries object ids, and can go missing** — `IP-28`. Mapping is keyed
  on the group object id with a name snapshot; on overage the claim is ignored, the JIT
  default role is provisioned, and a `provisioning_event` and Health warning are raised. No
  Graph call in the first release.

A domain binding **refuses** a token whose email domain belongs to another connection. It
never *selects* the organisation — that is `identity_connection.organisation_id`, resolved
from the connection ([multi-tenancy.md](multi-tenancy.md)).

### Per-portal binding

`portal_scope` on each provider row makes the common enterprise pattern trivial:

| Provider | Scope | Effect |
| --- | --- | --- |
| Entra ID (our tenant) — identity connection | `agent` | Staff sign in with corporate SSO; SCIM keeps the staff directory in step |
| Entra ID (Contoso's tenant) — identity connection bound to organisation Contoso | `customer` | Contoso's people sign in to the portal with their own SSO and land only in Contoso; Contoso's SCIM deactivates them when they leave |
| Email OTP | `customer` | Other customers get a code, no password to manage |
| Password | `both` | Break-glass and small deployments |

An OIDC identity connection is `agent` **or** `customer`, never both; only non-OIDC auth
plugins may be `both` ([ADR 0003](adr/0003-better-auth-primary.md),
[plugin-architecture.md](plugin-architecture.md)).

**The agent login screen renders the providers scoped to `agent`** — there are few of them,
they belong to the instance, and naming them discloses nothing. **The portal login screen
renders no connection list at all.** Customer connections are per-organisation, so a list
would name every customer organisation to every anonymous visitor. The portal asks for an
email address and resolves the connection server-side from `domain_bindings`
([customer-portal.md](../03-features/customer-portal.md) `CP-18`,
[identity-provisioning.md](../03-features/identity-provisioning.md) `IP-29`).

## Identity architecture — the authoritative model

This document owns the identity model; [identity-provisioning.md](../03-features/identity-provisioning.md)
owns the numbered behavioural rules (`IP-n`) and the acceptance tests; the security model,
RBAC, God Mode and the portal spec link here rather than restating.

**TaskDesk stores and is authoritative for:** `user`, `person`, `organisation`, organisation
/ workspace / project memberships, roles and capabilities, `external_identity`,
`identity_connection`, `scim_connection`, `scim_group_mapping`, sessions, API/MCP key
ownership, audit history ([data-model.md](data-model.md) §2). **Microsoft Entra owns:**
authentication, user lifecycle, directory attributes, and group membership where enabled.
TaskDesk never stores an external user's password.

**Durable identity key:** `(identity_connection, issuer, subject)` and, for SCIM-created
records, `externalId`. Organisation binding and portal scope are properties of the
connection, resolved server-side. **Email is an attribute** — it may change and is never
the sole key or a linking key on its own.

**Two connection shapes, one implementation:**

| | Agent connection | Customer connection |
| --- | --- | --- |
| Portal | `agent` | `customer` |
| Bound to | the instance | exactly **one** customer organisation |
| May create | staff-side people; permitted workspace memberships; approved staff roles ≤ `max_role_rank` | customer-side people of that organisation; the customer role only |
| May never | grant `instance:admin`, `sees_all`, a role above the maximum; let a group *name* create capabilities | create staff, instance admins, workspace/manager/lead roles, `sees_all`, cross-organisation membership, keys, webhooks, automations; reach agent routes or God Mode |
| Configured by | instance administrators, God Mode → Authentication | instance administrators, God Mode → Organisations → *org* → Identity (customer self-service is a later, separately approved feature) |
| SCIM | staff joiner/mover/leaver | that organisation's joiner/mover/leaver |

**Lifecycle and revocation.** Deactivation — from SCIM `active=false`, from God Mode, or
from an administrator — sets `person.active = false`, revokes every session and every
personal API/MCP key, ends memberships per the connection's lifecycle policy, and preserves
authored history attributed to a former member. It is never a hard delete; erasure and
anonymisation are the separate elevated process in
[data-protection.md](../05-operations/data-protection.md). Group→role mappings are
allowlisted, scoped to the connection's organisation and portal, symmetric on removal, and
can never reach `instance:admin` or `sees_all`.

**Where the UI lives.** Agent connections: God Mode → Authentication. Customer connections:
God Mode → Organisations → detail → Identity. Both are views over
`/api/instance/identity-connections/*` ([god-mode.md](../03-features/god-mode.md)).

## SCIM provisioning — summary

OIDC says who someone is at login; SCIM creates, updates and **deactivates** people when
the directory changes, so offboarding does not depend on anyone remembering. Core P3
delivery for Microsoft Entra; endpoint `/scim/v2/*` on the agent origin; bearer token per
connection with immediate-invalidation rotation; strict schemas; scope from the credential,
never the body; `/Bulk` not implemented unless Entra interoperability testing requires it;
tested against a real Entra tenant before the P3 identity gate. Full rules `IP-1`…`IP-32`
and the twenty-five acceptance tests: [identity-provisioning.md](../03-features/identity-provisioning.md).
Security treatment: [security-model.md](security-model.md#scim--an-inbound-privileged-management-api).

**Unlike every other row in the table above, SCIM is not a library capability.** The SCIM
2.0 server is **ours** — better-auth provides no SCIM plugin. Schemas, the filter parser,
`PATCH` path expressions, `ListResponse` and the SCIM error bodies are our own protocol
code; only the credential check reuses the platform. Budget it as such.

## Sessions

- HTTP-only, `Secure`, `__Host-`-prefixed, `SameSite=Lax` cookies (`Strict` on the
  elevated-action routes). **No tokens in browser storage, ever.** CSRF is *not* left to
  `SameSite`: the full rule — no state-changing GET, `Origin` check on every unsafe
  method, double-submit token — is in [security-model.md](security-model.md#sessions-csrf-and-step-up).
- **Two better-auth instances, one per portal origin** (decided 2026-09-06, Claude Code —
  reversible). better-auth derives cookie names from *construction-time* configuration, not
  from the incoming request, so "one instance, a per-request prefix" is not a thing the
  library can do. The holder therefore constructs **two** instances on every reload, one per
  portal, each with its own `baseURL`, its own cookie names, its own `trustedOrigins` (that
  portal's origin only) and its own provider set (the connections scoped to that portal).
  **The request host selects the instance**; everything else about the reload is unchanged
  ([auth-runtime-reconfiguration.md](auth-runtime-reconfiguration.md)).
- **The two cookie names, in full:** `__Host-tdk_agent_session` on `ticket.<domain>` and
  `__Host-tdk_portal_session` on `portal.<domain>`. `__Host-` is a browser-enforced *name*
  prefix, so the name literally begins with it: host-only, no `Domain` attribute, `Path=/`,
  `Secure`. kaneo's `COOKIE_DOMAIN` variable and its cross-subdomain
  `SameSite=None; Partitioned` branch are **removed at the fork** — both are incompatible
  with `__Host-` and with `SameSite=Lax`, and the API is served on each portal's own origin,
  which `/api/portal/*` already implies
  ([decision-log.md](../07-planning/decision-log.md) — environment surface).
- Every `session` row carries `portal` (`agent` | `customer`), set at issue time. The
  portal-boundary middleware compares `session.portal` to the request host — that column
  is the data the check runs on.
- **Server-side sessions in Postgres, and this is the honest revocation SLA.**
  better-auth's `session.cookieCache` is **disabled** at the fork — kaneo enables it for
  five minutes, which serves a session from a signed cookie with no database read. Every
  request that presents a session cookie is validated against the `session` table, so a
  revoked or deleted session fails **on the very next request**. The separate *authority*
  resolution (memberships, roles, `sees_all`) keeps its 30-second Valkey cache with explicit
  invalidation, below. So: a **revoked session** takes effect on the next request; a
  **changed authority** takes effect immediately in the normal case and within 30 s if the
  invalidation message is lost. `IP-15`, the SCIM de-provisioning tests and god-mode.md's
  "organisation suspended" row all cite this paragraph.
- Idle timeout and absolute lifetime configurable in God Mode.
- Session rows record IP, user agent, and `impersonatedBy` — written by our own
  `POST /api/instance/users/{id}/impersonate`, never by better-auth's admin routes.

## Portal boundary

Enforced at two points:

1. **At the OIDC callback** — if a `side = customer` directory record completes a login
   on the agent origin, the callback fails with a clear message and writes an audit row.
   No session is issued.
2. **On every request** — middleware compares the session's portal to the request host.
   Mismatch ⇒ session invalidated, `401`.

This is inherited from v1 and it is correct.

## Identity resolution — the important rule

```ts
// Correct
const identity = await resolveIdentity(session.userId);
//  → { userId, side, organisationId, memberships, reach, authority }

// WRONG — never do this
const role = session.user.role;
const orgs = token.claims.groups;
```

Everything about *what a person is allowed to do* comes from the database, keyed by user
id, on every request. Consequences:

- Revoking access takes effect on the next request, not when a token expires.
- An IdP compromise cannot mint privilege — group claims are only ever inputs to a
  *provisioning* decision, and only at the moment of provisioning.
- RBAC changes are safe to deploy; there are no in-flight tokens carrying stale rules.

Resolution is cached in Valkey for **30 seconds** (the revocation-latency budget, stated
once here and in [scaling.md](../05-operations/scaling.md)), keyed by user id, and
invalidated explicitly on every membership, role, deactivation and connection change — so in
practice an authority change is immediate and 30 s is only the worst case when the
invalidation message is lost. This is the *authority* cache; the *session* SLA is the one
stated under [Sessions](#sessions), and they are different budgets.

**Accounts are never linked automatically.** kaneo ships better-auth with
`account.accountLinking: { enabled: true, trustedProviders: ["github","google","discord",
"custom"] }`, and `"custom"` is precisely the `genericOAuth` provider id every `auth.oidc`
connection is built on — so, as inherited, an OIDC sign-in would silently adopt an existing
account with the same address. At the fork it is set **explicitly** to `enabled: false`. No
claim is made about the library's own defaults, in either direction: the retrofit sets the
value, and `16-same-email-second-idp-does-not-autolink.test.ts` asserts it by reading the
**constructed configuration**, not only the HTTP behaviour (`IP-18`).

**Placeholder people.** An import may create a `person` with `user_id = null` and
`is_placeholder = true` so history has an author. A placeholder can never be assigned work
or hold a membership. A later sign-up may **claim** that row (linked, not duplicated) —
but only on a path where **TaskDesk itself verified the address**: password sign-up with
email verification, email OTP, or magic link; or an explicit, administrator-confirmed
claim. **Never on the SSO path** — an ID token's address is the IdP's assertion, not our
verification, and for Entra there is no `email_verified` claim to lean on at all. Every
claim is audited. The rule in full is `IP-30` in
[identity-provisioning.md](../03-features/identity-provisioning.md), tested by
`18-placeholder-claim-requires-local-verification.test.ts`. This is the only path by which a
login attaches to a pre-existing directory record, and it is not an exception to `IP-18`:
`IP-18` forbids linking to another *connection's* account, and this links to a row that has
no account.

## Multi-factor authentication

- TOTP and backup codes via better-auth's two-factor plugin. Passkeys as a second option.
- Configurable in God Mode: **optional**, **required for staff**, **required for a
  specific role**, or **required for everyone**.
- When an external IdP already enforces MFA, TaskDesk prefers the token's `amr` / `acr`
  claim **per login** and challenges locally when it is absent. A static "MFA satisfied
  upstream" flag exists only for providers that emit neither claim; setting it is an
  elevated, audited change and is shown in the God Mode Health security-posture panel.
- **Resetting someone's second factor** (`POST /api/instance/users/{id}/reset-mfa`) is the
  most socially-engineered path into an MFA-protected account. The screen requires the
  administrator to record *how the requester's identity was verified* (a free-text reason
  is mandatory, stored in the audit row); the affected person is emailed on every address
  on file; and the reset revokes all of their sessions and API keys.
- Enrolment is enforced at login: a user who must have MFA and does not is routed to
  enrolment before anything else.

## API keys and machine access

- better-auth `apiKey` plugin for the credential; our `api_key` extension table
  ([data model](data-model.md) §2) for everything else: capability subset, IP allowlist,
  per-key rate limit, expiry, last-used, `is_mcp`, and the workspace-owned **service key**
  with no person behind it. Keys are hashed; only a prefix is stored in the clear.
- A personal key can never exceed its owner's authority — it is clamped to the owner's
  *current* authority on every request. A **service key is bounded by its creator's
  authority at creation** (you cannot mint a key carrying a capability you do not hold —
  evaluated against the expanded closure, exactly like a role grant), is an **elevated
  action** ([RBAC](rbac.md#elevated-and-audited-actions--the-single-list)), and its exact
  capability set is written to the audit row. On use, a service key is evaluated against
  its own stored subset, so it survives its creator leaving (`AK-7`) without ever having
  been wider than that person was. `service-key-clamp.test.ts` mirrors the personal-key
  clamping test.
- Used by the MCP server, importers and outbound integrations. `feature.mcp` off ⇒ keys
  flagged `is_mcp` are refused with 404.

## Invitations

1. A staff member with `member:invite` invites an email into an organisation with a role.
2. A token (≥ 128 bits, CSPRNG) is generated; only its SHA-256 hash is stored. Default
   expiry **7 days**. Redemption is **bound to the invited email address** — the account
   completing sign-up must verify that address — so an intercepted link is not bearer
   access to a tenant. Pending invitations are revoked when the inviter loses
   `member:invite`.
3. The invitee follows the link and completes sign-up via **any enabled provider for that
   portal** — password, OTP or SSO.
4. On acceptance, the directory record is created with the invitation's side, organisation
   and role. The invitation is consumed.

Invitations never grant instance-admin. That is deliberate and hard-coded.

## Break-glass

**First run needs no environment variable.** On an empty database the application serves a
one-time **setup page** at the agent origin, unlocked by a 32-byte token printed once in
the container log (the pattern Jenkins and Portainer use). It creates the first instance
administrator, enrols MFA, and records completion in `instance_setting.setup_completed_at`
— a durable marker, so the page can never be re-opened by deleting user rows. The setup
token expires after one hour or one use, and **while `setup_completed_at` is null every
container start prints a fresh token and invalidates the previous one** — so an operator who
missed the log line restarts the container rather than hunting for it, and a token scrolled
past in a shared log is already dead ([runbook](../05-operations/runbook.md)). `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` remains as an
optional override for **headless** installs (automation that cannot read a log) and is
ignored once `setup_completed_at` is set.

If every administrator is locked out, recovery is the CLI (`grant-instance-admin`,
[runbook](../05-operations/runbook.md)), which must be run **inside the container**, writes
an audit row with `actor_type = 'system'`, and emails every existing administrator that it
was used. Break-glass is loud by design.

## Threat notes

| Threat | Mitigation |
| --- | --- |
| Stolen session cookie | HTTP-only + Secure + SameSite; short idle timeout; sessions listed and revocable in profile settings |
| IdP compromise | Claims never grant authority directly; role comes from the directory |
| Customer reaching agent surface | Portal boundary at callback and per request; server-side policy on every route |
| Privilege escalation via invite | Invitations cannot grant instance-admin; role bounded by inviter's authority |
| Brute force | Rate limit on auth endpoints; optional CAPTCHA plugin; account lockout configurable |
| Open redirect at callback | Redirect targets restricted by each instance's `trustedOrigins`, which holds **that portal's origin only**; redirect URIs are exact-match and rebuilt from that instance's `baseURL` on every reload |
| Secret leakage in API responses | Secrets never serialised; responses use explicit response schemas |

## Related

- [RBAC](rbac.md) · [Multi-tenancy](multi-tenancy.md) · [Security model](security-model.md)
- [ADR 0003 — better-auth primary, pluggable IdP](adr/0003-better-auth-primary.md)
- [God Mode](../03-features/god-mode.md) · [Identity provisioning — SCIM/Entra](../03-features/identity-provisioning.md)
- [Pending actions](pending-actions.md) · [Data protection](../05-operations/data-protection.md)
