# Configuration reference

Two kinds of configuration, and the distinction is the whole point of the architecture.

| | Bootstrap | Runtime |
| --- | --- | --- |
| Where | Environment variables | God Mode, stored in the database |
| Changing it needs | A restart | Nothing |
| Amount | Eight variables | Everything else |
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
| `TASKDESK_FILES_URL` | — | Separate origin for attachment downloads |
| `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` | — | First run only, on an empty database. Ignored thereafter |
| `TASKDESK_LOG_LEVEL` | `info` | Overridable at runtime in God Mode |
| `TASKDESK_TRUST_PROXY` | `true` | Behind Traefik |
| `NODE_ENV` | `production` | |

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
Slack, Teams, Discord, ntfy, Gotify endpoints

Plus: default preferences for new users, digest cadence

### Features

Every `feature.*` flag with an enabled state and a **lock** switch.

```
feature.cycles           feature.modules          feature.estimates
feature.intake           feature.sla              feature.approvals
feature.time_tracking    feature.cost_tracking    feature.knowledge_base
feature.service_catalogue feature.customer_portal feature.reports
feature.automations      feature.gantt            feature.calendar
feature.pages            feature.mcp
```

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
