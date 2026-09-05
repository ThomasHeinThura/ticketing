# 0006 — Runtime plugin registry over build-time configuration

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

## Context

Two requirements collide.

**Operational:** v1 configured everything through environment variables and generated
files. Changing an SMTP server or an identity provider meant editing `.env` and
redeploying. Standing up a new environment required minting Keycloak clients first — one
of the two documented "deploy traps".

**Commercial:** the same container image must be sellable to any customer. Customer A uses
Entra; B runs Keycloak; C wants email OTP only; D stores files in Azure Blob; E wants
Slack notifications; F wants none. If any of that requires a different build, a different
image tag or a `docker-compose` edit, the product does not scale commercially.

The naive answers — an environment variable per option, or a customer-specific branch —
both fail. The first produces an unmanageable configuration surface and still requires a
restart. The second produces N codebases.

## Decision

**Anything that varies between deployments is a runtime plugin, configured in God Mode,
stored in the database.**

- `packages/plugins-contracts` defines interfaces only: `AuthProvider`, `StorageBackend`,
  `NotificationChannel`, `Importer`, `SearchBackend`, `AiProvider`.
- Implementations ship inside the image and register themselves into a per-kind registry
  at boot.
- Which implementations are **active**, and with what settings, comes from
  `instance_plugin_config` rows. Secrets in that table are encrypted at rest with
  AES-256-GCM and never returned by the API.
- Each plugin declares a **Zod configuration schema**. God Mode renders its settings form
  from that schema, so adding a plugin adds its administration UI automatically.
- Each plugin implements `validate()` and, where meaningful, `test()` — so an
  administrator can prove a configuration works before relying on it.
- A parallel, simpler axis — **feature flags** at instance, workspace and project level —
  switches whole features off so the interface stays small.

Environment variables are reduced to **bootstrap only**: database URL, encryption key,
auth secret, public origins, port, optional Valkey URL, and a first-run admin email.

The rule, stated for reviewers: *if you are writing `if (customer === …)` or
`process.env.SOMETHING_CUSTOMER_SPECIFIC`, stop and add a registry entry.*

## Consequences

### Positive

- **One image, any customer.** The commercial requirement is met structurally rather than
  by discipline.
- **Configuration changes need no redeploy.** An administrator changes SMTP at 09:00 and
  it is live at 09:00.
- **Zero-configuration first run.** The product boots with sensible built-in defaults —
  password auth, filesystem or S3 storage, no notification channels — and everything else
  is configured through the UI.
- **God Mode UI is largely generated**, so plugin authors write a schema, not a form.
- **Test buttons** turn "save and hope" into "save and verify", which is the difference
  between a good administration experience and a support ticket.
- New capabilities arrive as a folder and a registry entry.

### Negative

- **Configuration is now data, so it must be backed up, versioned and audited like data.**
  A database restore that loses plugin configuration is an outage. Mitigated by including
  configuration in backup verification and by auditing every change.
- **Secrets live in the database**, which raises the stakes on `TASKDESK_ENCRYPTION_KEY`
  and on database access. Mitigated by encryption at rest, never serialising secrets, and
  a documented key-rotation procedure.
- **Runtime reconfiguration is genuinely harder to implement** than reading an environment
  variable at boot — particularly for better-auth, which is constructed once and must be
  rebuilt and swapped when providers change, across every replica. This is the most
  delicate code in the system and needs disproportionate test coverage.
- **A misconfiguration can break the running system**, where a bad environment variable
  would at least fail at deploy. Mitigated by `validate()` on save, `test()` before
  enabling, and `auth.password` being non-removable.
- **More indirection.** Reading the code, "where does SMTP come from?" is now a registry
  lookup rather than a constant. Mitigated by keeping the registry small and obvious.

### Neutral

- Feature flags give a tiering mechanism for free: `locked` at instance level lets a
  vendor sell editions without shipping different images.
- Third-party plugins are not supported at launch. The contracts are designed to permit
  them later without redesign.

## Alternatives considered

**Environment variables for everything (v1's approach).** Rejected. Redeploy per change,
unmanageable surface, and impossible to expose in an administration UI.

**A configuration file mounted into the container.** Rejected. Better than environment
variables, but still requires filesystem access and a restart, and still cannot be edited
by a non-technical administrator.

**Customer-specific builds or branches.** Rejected outright. N codebases, N test matrices,
N security-patch applications.

**Compile-time feature flags.** Rejected. Same problem, plus the flags become permanent
because nobody dares remove one.

**Full third-party plugin system with dynamic module loading.** Rejected for now as
premature. It adds sandboxing, versioning and supply-chain problems we do not yet have.
The contracts are shaped so this remains possible.

## Related

- [Plugin architecture](../plugin-architecture.md)
- [ADR 0003 — better-auth primary](0003-better-auth-primary.md)
- [God Mode](../../03-features/god-mode.md)
- [Configuration reference](../../05-operations/configuration-reference.md)
