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
| Multi-organisation | **Not used.** better-auth's organisation plugin is deliberately off — our own `organisation` / `membership` / `team` / `invitation` tables are the directory, because identity is always resolved from *our* database. better-auth does authentication only |
| MFA | ✅ two-factor plugin — TOTP, backup codes |
| Magic link | ✅ |
| Email OTP | ✅ |
| Passkeys | ✅ |
| Arbitrary OIDC | ✅ genericOAuth — **configurable at runtime** |
| API keys | ✅ apiKey plugin |
| Impersonation | ✅ admin plugin, audited |
| TypeScript-native, Drizzle adapter | ✅ |
| Already in kaneo | ✅ |

Keycloak is **not** a dependency. It is one OIDC provider among many, added through
God Mode if a deployment wants it. That is the difference between "we support Keycloak"
and "we require Keycloak".

## Runtime provider configuration

Providers are `auth.*` plugins (see [Plugin architecture](plugin-architecture.md)),
stored as `instance_plugin_config` rows, edited in God Mode, and **loaded into the
better-auth instance at boot and on change**.

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
God Mode → Authentication → [ Add provider ]

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
    Available on          ( ) Agent  ( ) Portal  (•) Both
    Discovery URL         https://login.microsoftonline.com/{tenant}/v2.0/...
    Client ID             …
    Client secret         •••••••• (encrypted at rest)
    Scopes                openid profile email
    Claim mapping         email → email · name → name · groups → groups
    Auto-provision        [x] create a user on first login
      → assign side       (•) Staff  ( ) Customer  ( ) From claim: …
      → assign org        (•) From email domain  ( ) Fixed: …
      → assign role       Viewer ▾
    Group → role mapping  "TaskDesk-Admins" → Admin      [+ add rule]
    Domain restriction    @contoso.com
    Require MFA           [ ]
    Enabled               [x]

  [ Test connection ]   ← performs a real discovery + token exchange dry-run
  [ Save ]
```

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
- The domain mapping and the account-linking rules below apply **after** the token is
  validated, never to raw claims.

### Per-portal binding

`portal_scope` on each provider row makes the common enterprise pattern trivial:

| Provider | Scope | Effect |
| --- | --- | --- |
| Entra ID | `agent` | Staff sign in with corporate SSO |
| Email OTP | `customer` | Customers get a code, no password to manage |
| Password | `both` | Break-glass and small deployments |

The login screen for each portal renders only the providers scoped to it.

## Sessions

- HTTP-only, `Secure`, `__Host-`-prefixed, `SameSite=Lax` cookies (`Strict` on the
  elevated-action routes). **No tokens in browser storage, ever.** CSRF is *not* left to
  `SameSite`: the full rule — no state-changing GET, `Origin` check on every unsafe
  method, double-submit token — is in [security-model.md](security-model.md#sessions-csrf-and-step-up).
- **One better-auth instance, two cookies.** The cookie is host-only (no `Domain`
  attribute), so `ticket.<domain>` and `portal.<domain>` each hold their own; the cookie
  *prefix* is chosen per request from the request host (`tdk_agent_` / `tdk_portal_`), and
  every `session` row carries `portal` (`agent` | `customer`), set at issue time. The
  portal-boundary middleware compares `session.portal` to the request host — that column
  is the data the check runs on.
- Server-side sessions in Postgres. Revocation is immediate.
- Idle timeout and absolute lifetime configurable in God Mode.
- Session rows record IP, user agent, and `impersonatedBy`.

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
invalidated explicitly on any membership or role change — so in practice revocation is
immediate and 30 s is only the worst case when the invalidation message is lost.

**Placeholder people.** An import may create a `person` with `user_id = null` and
`is_placeholder = true` so history has an author. A placeholder can never be assigned work
or hold a membership. When that email later signs in through any provider, the new `user`
is **linked to the existing placeholder row** (claimed, not duplicated) after the email is
verified; the claim is audited. This is the only path by which a login attaches to a
pre-existing directory record.

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
token expires after one hour or one use. `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` remains as an
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
| Open redirect at callback | Redirect targets restricted to the configured portal origins |
| Secret leakage in API responses | Secrets never serialised; responses use explicit response schemas |

## Related

- [RBAC](rbac.md) · [Multi-tenancy](multi-tenancy.md) · [Security model](security-model.md)
- [ADR 0003 — better-auth primary, pluggable IdP](adr/0003-better-auth-primary.md)
- [God Mode](../03-features/god-mode.md)
