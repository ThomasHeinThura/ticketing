# 0003 — better-auth primary, identity providers as runtime plugins

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

## Context

TaskDesk v1 used two identity providers, wired in at deploy time: Microsoft Entra ID for
staff and Keycloak for customers. Both were configured through environment variables and
a generated Keycloak realm file. Consequences:

- Standing up an environment required minting Keycloak clients first — documented as one
  of the two "deploy traps" in v1's handover notes.
- Changing an identity provider meant editing environment variables and redeploying.
- Keycloak was a **hard dependency**: nothing worked without it, even for a small
  deployment that wanted email and password.

For v2 there is an additional, commercial requirement: **the same image must be sellable
to customers with different identity landscapes**. Customer A uses Entra. Customer B runs
Keycloak. Customer C wants nothing but email OTP. None of them may need a different build.

kaneo already uses [better-auth](https://better-auth.com), which provides sessions,
organisations, MFA, magic links, email OTP, passkeys, API keys, impersonation and a
`genericOAuth` plugin for arbitrary OIDC — all TypeScript-native with a Drizzle adapter.

## Decision

**better-auth is the primary authentication layer. Every identity provider is a runtime
plugin, configured in God Mode, stored in the database.**

- The product works **out of the box with zero configuration** using email and password,
  plus optional TOTP.
- Any number of OIDC providers can be added at runtime through the UI. Entra and Keycloak
  are **presets** over the generic OIDC plugin — pre-filled endpoint patterns and
  friendlier field labels — not special code paths.
- Each provider instance carries a `portal_scope` of `agent`, `customer` or `both`, so
  "Entra for staff, email OTP for customers" is a UI choice, not an architecture.
- Each provider carries just-in-time provisioning rules: which side, which organisation,
  which role a first-time user receives, and optional group-claim to role mapping.
- Every provider has a **Test connection** action that performs a real discovery and token
  exchange dry-run before it goes live.
- **Keycloak is not a dependency.** It is one option among many.

Critically, **authentication is separated from identity resolution**. Once better-auth
establishes a `userId`, everything about what that person may see and do is resolved from
the database on every request. Token claims never carry authority.

## Consequences

### Positive

- **Zero-configuration first run.** `docker compose up`, sign in, configure the rest in
  the UI. v1 required Keycloak to be working before anything else could be.
- **One image, any customer.** The commercial requirement is met structurally.
- **Adding a provider is a plugin file**, and God Mode renders its settings form from its
  Zod schema automatically. No bespoke admin UI per provider.
- **Keycloak becomes optional**, removing a heavyweight JVM service (2.5 GB of the 11 GB
  v1 production budget) from deployments that do not need it.
- Revocation is immediate, because authority is resolved from the database, not a token.
- MFA, magic links, passkeys and API keys come with the library rather than being built.

### Negative

- **better-auth is a younger project than Keycloak.** We are dependent on a smaller
  ecosystem for a security-critical component. Mitigated by: it is open source and in our
  stack, so we can read and patch it; and by keeping the OIDC surface generic so
  migrating away is a plugin swap, not a rewrite.
- **Runtime provider reconfiguration is genuinely fiddly.** better-auth is configured at
  construction, so we must rebuild the auth instance when configuration changes and swap
  it behind a stable reference, with a Valkey message to trigger the rebuild on every
  replica. This is the most delicate code in the auth layer and needs careful tests.
- **SAML is not covered** by better-auth today. Enterprises that require SAML rather than
  OIDC are unserved until we add a SAML plugin (Phase 5) or point them at Keycloak as an
  OIDC-fronting broker — which, pleasingly, the plugin model already supports.
- **A misconfigured provider can lock everyone out.** Mitigated by: `auth.password` cannot
  be removed; the Test action; and a documented CLI break-glass.

### Neutral

- Keycloak remains fully supported and is still the right answer for deployments that
  need LDAP federation, SAML brokering or complex identity flows. It is simply no longer
  compulsory.
- Entra ID is configured as an OIDC provider like any other, which is all it ever needed
  to be.

## Alternatives considered

**Keycloak as the sole IdP, as in v1.** Rejected. It makes a heavyweight service
mandatory for every deployment, it cannot be configured from our UI, and it makes the
zero-configuration first run impossible.

**Environment-variable configuration of providers, as in v1.** Rejected. It forces a
redeploy for a settings change and makes the "sell the same image" requirement
impossible.

**Auth.js / NextAuth.** Rejected. Weaker organisation, MFA and API-key stories, and it is
oriented around Next.js, which the application is not.

**Build our own OIDC layer.** Rejected. Authentication is exactly the wrong place to be
original.

**Keycloak for customers, better-auth for staff — permanently split.** Rejected as an
*architecture*, though it remains perfectly configurable as a *deployment choice*. That is
the point: it should be a setting, not a design.

## Related

- [Auth and identity](../auth-and-identity.md)
- [Plugin architecture](../plugin-architecture.md)
- [ADR 0006 — plugin registry](0006-plugin-registry.md)
