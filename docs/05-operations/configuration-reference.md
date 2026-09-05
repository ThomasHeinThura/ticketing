# Configuration reference

Two kinds of configuration, and the distinction is the whole point of the architecture.

| | Bootstrap | Runtime |
| --- | --- | --- |
| Where | Environment variables | God Mode, stored in the database |
| Changing it needs | A restart | Nothing |
| Amount | Five required, six optional — the table below is the **only** list | Everything else |
| Why | Needed *to reach* the configuration | Varies per deployment and per customer |

See [plugin architecture](../01-architecture/plugin-architecture.md) and
[ADR 0006](../01-architecture/adr/0006-plugin-registry.md).

---

## Bootstrap environment variables

### Required

| Variable | Example | Notes |
| --- | --- | --- |
| `TASKDESK_DATABASE_URL` | `postgres://taskdesk:…@postgres:5432/taskdesk` | Where configuration lives |
| `TASKDESK_ENCRYPTION_KEY` | 64 hex characters | Decrypts plugin secrets. **Lose this and every configured integration must be reconfigured.** Generate: `openssl rand -hex 32` |
| `TASKDESK_AUTH_SECRET` | 64 hex characters | Session signing. Rotating it signs everyone out |
| `TASKDESK_AGENT_URL` | `https://ticket.example.com` | Public agent origin |
| `TASKDESK_PORTAL_URL` | `https://portal.example.com` | Public portal origin |

### Optional

| Variable | Default | Notes |
| --- | --- | --- |
| `TASKDESK_PORT` | `5173` | Bind port |
| `TASKDESK_VALKEY_URL` | — | Required for multiple replicas |
| `TASKDESK_ROLE` | `all` | `web` \| `jobs` \| `all`. Gates the in-process scheduler, so a replica can be dedicated to jobs — the escape hatch in [scaling.md](scaling.md). Inherently per-process; cannot live in the database |
| `TASKDESK_ENCRYPTION_KEY_PREVIOUS` | — | Set only during key rotation: the old key, readable, while `secrets-rekey` re-encrypts under the new one. Key material — inherently env. See [runbook](runbook.md) |
| `TASKDESK_TRUST_PROXY` | `1` | **Number of trusted reverse-proxy hops**, not a boolean: `1` = Traefik directly in front (the shipped compose); `2` = a load balancer in front of Traefik; `0` = no proxy, use the socket address. The client IP is read from `X-Forwarded-For` at exactly that hop, so a forged header moves no rate-limit bucket and satisfies no API-key IP allowlist. Must be known before the first request can be attributed to an IP. Meaningful only because the application port is **never published** in production — reachable from the proxy network alone ([traefik-and-domains.md](traefik-and-domains.md)) |
| `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` | — | **Headless installs only.** The normal first run needs no variable: on an empty database the app serves a one-time **setup page**, unlocked by a token printed in the container log, where the first administrator is created (see [one-line-install.md](one-line-install.md)) |
| `NODE_ENV` | `production` | In `development` only, HTTP webhook targets are permitted (`WH-12`) — there is no separate variable for that |

**Removed 2026-09-05, moved into the application:** the files/attachment origin (part of the
storage plugin's configuration — `storage.s3` knows its own bucket URL), the log level (God
Mode → Observability), and the development webhook allowlist (a `NODE_ENV=development`
behaviour). The rule is Thomas's: *only what the app needs to reach its own configuration
goes in `.env` — the database, key material, its own public origins, and per-process
operational switches. Everything else is a setting inside the app.*

### Postgres container

| Variable | Notes |
| --- | --- |
| `POSTGRES_DB` · `POSTGRES_USER` · `POSTGRES_PASSWORD` | Standard image variables |

### That is the complete list.

If you find yourself wanting to add one, the answer is almost certainly a plugin or a
feature flag. See the rule in
[plugin architecture](../01-architecture/plugin-architecture.md).

---

## Runtime configuration — God Mode

### General

Instance name · default locale · default timezone · date and number format ·
audit retention · notification retention · deleted-item retention · support email ·
terms and privacy URLs

### Branding

Product name · logo (light, dark) · favicon · accent colour · login background ·
footer links · custom CSS variable overrides

### Authentication

Per provider: type · display name · **portal scope** (agent / customer / both) ·
discovery or endpoint URLs · client id · client secret · scopes · claim mapping ·
JIT provisioning (side, organisation, role) · group-to-role mapping · domain restriction ·
MFA-satisfied-upstream flag · enabled

Instance-wide: MFA policy · session idle timeout · session absolute lifetime ·
concurrent session limit · password policy

### Organisations

Per organisation: name · key · email domains · internal flag · service calendar ·
default SLA policy · request catalogue · portal access · identity provider binding ·
quotas

### Storage

Backend (`s3`, `azure-blob`, `filesystem`) · endpoint · region · bucket · credentials ·
path style · max file size · max files per work item · allowed extensions

### Notifications

Per channel: SMTP host, port, TLS, credentials, from-address, reply-to · webhook defaults ·
further `notify.*` channel endpoints as they are built (Teams → Slack → Telegram → Viber — future scope)

Plus: default preferences for new users, digest cadence

### Features

Every `feature.*` flag with an enabled state and a **lock** switch. The enumeration lives
in exactly one place — [plugin-architecture.md § Feature toggles](../01-architecture/plugin-architecture.md#feature-toggles) —
and is not restated here.

### Jobs

Per job: schedule · enabled · last run · manual trigger

### Observability

Sentry DSN · OTLP endpoint and headers · trace sample rate · metrics bearer token ·
log level per module

### AI (optional, off by default)

Provider · endpoint · API key · model · which features may use it

---

## Precedence

For feature flags:

```
project → workspace → instance → built-in default
```

An instance flag marked `locked` cannot be overridden below.

For everything else, the more specific setting wins, and the interface says where the
inherited value came from.

---

## Secrets

- Plugin secrets are encrypted at rest with AES-256-GCM using
  `TASKDESK_ENCRYPTION_KEY`.
- The API **never returns a secret**. Reads return `"••••••••"`; writes accept either a
  new value or a sentinel meaning "unchanged".
- Every change is audited, recording which keys changed — never the values.
- Rotation is a God Mode operation that re-encrypts everything under a new key in a
  transaction, retaining the old key until it completes.

---

## Backing up configuration

**Configuration is data.** It lives in `instance_setting`, `instance_branding`,
`instance_plugin_config` and `instance_feature_flag`. A database backup includes it; a
restore that loses it is an outage.

Verify configuration presence as part of restore testing. See
[backup and restore](backup-and-restore.md).

An export of non-secret configuration is available from God Mode as JSON, for
documentation and for reproducing an instance's shape elsewhere. Secrets are excluded and
must be re-entered.

---

## Local development

`deploy/.env.example`:

```bash
TASKDESK_DATABASE_URL=postgres://taskdesk:taskdesk@localhost:5432/taskdesk
TASKDESK_ENCRYPTION_KEY=<openssl rand -hex 32>
TASKDESK_AUTH_SECRET=<openssl rand -hex 32>
TASKDESK_AGENT_URL=https://ticket.localhost
TASKDESK_PORTAL_URL=https://portal.localhost
TASKDESK_VALKEY_URL=redis://localhost:6379
TASKDESK_BOOTSTRAP_ADMIN_EMAIL=you@example.com
POSTGRES_DB=taskdesk
POSTGRES_USER=taskdesk
POSTGRES_PASSWORD=taskdesk
```

Local development uses Mailpit for mail and SeaweedFS for storage, both configured through
God Mode on first run — exactly as a real deployment would be.

## Related

- [Plugin architecture](../01-architecture/plugin-architecture.md) · [God Mode](../03-features/god-mode.md)
- [Deployment](deployment.md) · [Backup and restore](backup-and-restore.md)
