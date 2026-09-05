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
| Multi-organisation | ✅ organisation plugin — orgs, members, teams, invitations |
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
apply within seconds without a restart. In multi-replica deployments a Valkey pub/sub
message triggers the rebuild on every replica.

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
will be a locked-out user.

### Per-portal binding

`portal_scope` on each provider row makes the common enterprise pattern trivial:

| Provider | Scope | Effect |
| --- | --- | --- |
| Entra ID | `agent` | Staff sign in with corporate SSO |
| Email OTP | `customer` | Customers get a code, no password to manage |
| Password | `both` | Break-glass and small deployments |

The login screen for each portal renders only the providers scoped to it.

## Sessions

- HTTP-only, `Secure`, `SameSite=Lax` cookies. **No tokens in browser storage, ever.**
- Cookie name and domain differ per portal, so an agent session and a customer session
  cannot be confused for one another.
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

Resolution is cached in Valkey for a few seconds, keyed by user id, and invalidated
explicitly on any membership or role change.

## Multi-factor authentication

- TOTP and backup codes via better-auth's two-factor plugin. Passkeys as a second option.
- Configurable in God Mode: **optional**, **required for staff**, **required for a
  specific role**, or **required for everyone**.
- When an external IdP already enforces MFA, an administrator can mark that provider as
  "MFA satisfied upstream" so users are not challenged twice.
- Enrolment is enforced at login: a user who must have MFA and does not is routed to
  enrolment before anything else.

## API keys and machine access

- better-auth `apiKey` plugin. Keys are hashed; only a prefix is stored in the clear for
  identification.
- A key carries a role and an explicit capability subset — it can never exceed its
  owner's authority.
- Optional expiry, optional IP allowlist, per-key rate limit.
- Used by the MCP server, importers and outbound integrations.

## Invitations

1. A staff member with `member:invite` invites an email into an organisation with a role.
2. A token is generated; only its SHA-256 hash is stored. Default expiry 14 days.
3. The invitee follows the link and completes sign-up via **any enabled provider for that
   portal** — password, OTP or SSO.
4. On acceptance, the directory record is created with the invitation's side, organisation
   and role. The invitation is consumed.

Invitations never grant instance-admin. That is deliberate and hard-coded.

## Break-glass

`TASKDESK_BOOTSTRAP_ADMIN_EMAIL` creates the first instance administrator on an empty
database, and only on an empty database. After that it is ignored.

If every administrator is locked out, recovery is a documented CLI command executed
against the database directly, which writes an audit row. See the
[runbook](../05-operations/runbook.md).

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
