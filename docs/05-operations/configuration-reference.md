# Configuration reference

Two kinds of configuration, and the distinction is the whole point of the architecture.

| | Bootstrap | Runtime |
| --- | --- | --- |
| Where | Environment variables | God Mode, stored in the database |
| Changing it needs | A restart | Nothing |
| Amount | Five required; one more optional (`TASKDESK_MIGRATION_DATABASE_URL`); eight optional per-process switches; `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` for headless installs; the three `POSTGRES_*` variables are read by the Postgres image only | Everything else |
| Why | Needed *to reach* the configuration | Varies per deployment and per customer |

See [plugin architecture](../01-architecture/plugin-architecture.md) and
[ADR 0006](../01-architecture/adr/0006-plugin-registry.md).

---

## Bootstrap environment variables

### Required

| Variable | Example | Notes |
| --- | --- | --- |
| `TASKDESK_DATABASE_URL` | `postgres://taskdesk_app:…@postgres:5432/taskdesk` | Where configuration lives. The role the API serves every request as — non-superuser, owns no table, DML-only grants (issue #296). Falls back to deriving from `POSTGRES_*` when unset, same as before |
| `TASKDESK_ENCRYPTION_KEY` | 64 hex characters | Decrypts plugin secrets. **Lose this and every configured integration must be reconfigured.** Generate: `openssl rand -hex 32` |
| `TASKDESK_AUTH_SECRET` | 64 hex characters | Session signing. Rotating it signs everyone out |
| `TASKDESK_AGENT_URL` | `https://ticket.example.com` | Public agent origin |
| `TASKDESK_PORTAL_URL` | `https://portal.example.com` | Public portal origin |

**Database roles, split at deploy time, in two separate processes (issue #296):**
`TASKDESK_DATABASE_URL` above is the **application** role — never a Postgres superuser,
never owns anything, and holds only the DML it needs: `SELECT`/`INSERT`/`UPDATE`/`DELETE` on
ordinary tables, `SELECT`/`INSERT` only on append-only tables (`activity`, `audit_log` —
[migrations.md § Append-only tables](../04-engineering/migrations.md#append-only-tables)). No
`TRUNCATE`, no DDL. It is the **only** database credential the long-running API process
(`TASKDESK_ROLE=web`/`jobs`/`all`) ever receives.

The separate **migration/owner** role — `TASKDESK_MIGRATION_DATABASE_URL`, listed in Optional
below — runs Drizzle's `migrate()`, the hand-written pre-migrate schema fixups, and the
role/grant bootstrap (`ensureApplicationRole`) that creates and repairs the application role.
It owns every table. In the shipped Compose stack it is the Postgres image's own init user
(`POSTGRES_USER`), which the official image makes a superuser at cluster init — unavoidable
for this one role.

**As of the independent Opus 5.5 security review of PR #308 (finding S1, BLOCKING), this
credential is used by a genuinely separate, one-shot process, never the long-running one that
serves requests.** Closing a database connection pool does not remove an already-set
environment variable from a running process (`/proc/self/environ` keeps it for the process's
whole life, reachable by any process-level compromise — RCE, a malicious dependency, an
arbitrary file read — regardless of what the application code does with the connection
afterwards), so handing the owner credential to the serving process at boot and merely
"closing the pool" after migrations does not keep it out of that process's reach. Instead:

- `TASKDESK_ROLE=migrate` (a fifth value alongside `all`/`web`/`jobs`) selects a dedicated
  entry point (`runMigrationStep` in `apps/api/src/index.ts`) that runs migrations and the
  role/grant bootstrap against `TASKDESK_MIGRATION_DATABASE_URL`, then exits. It never binds a
  port and never touches `TASKDESK_DATABASE_URL`.
- In the shipped Compose stack, `migrate` is a one-shot service that alone receives
  `TASKDESK_MIGRATION_DATABASE_URL`; the `taskdesk` service `depends_on` it completing
  successfully and never receives that variable at all.
- In the Helm chart, `Job taskdesk-migrate` is a pre-install/pre-upgrade hook that alone
  receives it; the API Deployment(s) never do.
- The serving process refuses to start if it ever finds `TASKDESK_MIGRATION_DATABASE_URL` in
  its own environment anyway (`assertNoMigrationUrlInApiProcess`) — a structural backstop for
  a misconfigured overlay or a hand-run container, not the primary control.

The application never reads any other environment variable to reach the database — no
separate variable for the audit-purge job's own future `taskdesk_maint`-style connection
exists yet (unbuilt scope, tracked on the audit-log work, not this issue).

### Optional

| Variable | Default | Notes |
| --- | --- | --- |
| `TASKDESK_MIGRATION_DATABASE_URL` | falls back to `TASKDESK_DATABASE_URL` | The migration/owner connection (issue #296, above), read only by the `TASKDESK_ROLE=migrate` process. **Only ever set on that process** — the Compose `migrate` service, the Helm `Job taskdesk-migrate` — never on `web`/`jobs`/`all`, which refuse to start if they find it. When unset, `runMigrationStep` falls back to `TASKDESK_DATABASE_URL` for the migrate process only — see "Local development" below for what that means in practice and when it is safe |
| `TASKDESK_PORT` | `5173` | Bind port |
| `TASKDESK_VALKEY_URL` | — | Required for multiple replicas |
| `TASKDESK_ROLE` | `all` | `web` \| `jobs` \| `all` \| `migrate`. `web`/`jobs`/`all` gate the in-process scheduler, so a replica can be dedicated to jobs — the escape hatch in [scaling.md](scaling.md). `migrate` (issue #296, S1) selects a different entry point entirely — `runMigrationStep`, which runs migrations and the database role/grant bootstrap against `TASKDESK_MIGRATION_DATABASE_URL` and exits; it never binds a port and is never a long-running process. Inherently per-process; cannot live in the database |
| `TASKDESK_ENCRYPTION_KEY_PREVIOUS` | — | Set only during key rotation: the old key, readable, while `secrets-rekey` re-encrypts under the new one. Key material — inherently env. See [runbook](runbook.md) |
| `TASKDESK_TRUST_PROXY` | `1` | **Number of trusted reverse-proxy hops**, not a boolean: `1` = Traefik directly in front (the shipped compose); `2` = a load balancer in front of Traefik; `0` = no proxy, use the socket address. The client IP is read from `X-Forwarded-For` at exactly that hop, so a forged header moves no rate-limit bucket and satisfies no API-key IP allowlist. Must be known before the first request can be attributed to an IP. Meaningful only because the application port is **never published** in production — reachable from the proxy network alone ([traefik-and-domains.md](traefik-and-domains.md)). **Measured, never assumed:** the shipped Compose overlays set it, the method and the captured values are in [proxy-topology-evidence.md](proxy-topology-evidence.md), and where a CDN terminates TLS in front of Traefik the answer is `2` |
| `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` | — | **Headless installs only.** The normal first run needs no variable: on an empty database the app serves a one-time **setup page**, unlocked by a token printed in the container log, where the first administrator is created (see [one-line-install.md](one-line-install.md)) |
| `NODE_ENV` | `production` | In `development` only, HTTP webhook targets are permitted (`WH-12`) — there is no separate variable for that |
| `DISABLE_WORKSPACE_CREATION` | — | Set to `"true"` to restrict workspace creation to instance administrators. Inherited from kaneo, where it was the `organization()` plugin's `allowUserToCreateOrganization` callback; the S4 retrofit moves the same gate onto the native `POST /api/workspace` route (`apps/api/src/utils/require-session.ts`). The caller's role is re-read from the database rather than taken from the session, because the first-user bootstrap promotes to instance admin **after** `signUpEmail` has returned, so a session minted at sign-up can still say `role: "user"`. Read at request time, so it needs no restart |
| `TASKDESK_STORAGE_DRIVER` | `filesystem` | `filesystem` \| `s3`. Which task-image-upload storage backend `apps/api/src/storage/index.ts` dispatches to. Bootstrap only because the real Storage plugin config below (God Mode, `storage.filesystem` / `storage.s3` / `storage.azure-blob`, the presign/quota/visibility system) does not exist yet — it is the P1 Attachments feature, currently blocked by its own open spec review. This variable is the narrow, interim bridge for the one storage use case that exists today (task image uploads); it is expected to be superseded, not extended, once God Mode Storage configuration lands. An unrecognized value is a startup-time configuration error, not silently rounded to a default. **Do not flip this on a running deployment without a migration plan:** deleting an asset whose bytes live on the backend you just switched *away* from succeeds as a silent no-op (the DB row is removed; the bytes are never reached), permanently orphaning them on the old backend — there is no cross-driver migration or cleanup tool today |
| `TASKDESK_STORAGE_FILESYSTEM_ROOT` | `/app/data/attachments` | Root directory the `filesystem` driver reads and writes under. The default matches the directory the image itself creates and the `taskdesk-data` named volume mounts at `/app/data` (`Dockerfile`, `compose.yml`) — a fresh install needs no value here at all. Only meaningful when `TASKDESK_STORAGE_DRIVER=filesystem` |

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

### That is the complete list of what the application reads.

If you find yourself wanting to add one, the answer is almost certainly a plugin or a
feature flag. See the rule in
[plugin architecture](../01-architecture/plugin-architecture.md).

kaneo's API reads about eighty environment variables. The five-plus-six rule is therefore a
**migration**, not a rename: every inherited variable has a keep / rename / move-to-God-Mode
/ delete verdict in
[repository-bootstrap.md § 2](../04-engineering/repository-bootstrap.md), and
`deploy/.env.example` is written fresh rather than copied.

### Variables the application does not read

These appear in `deploy/.env` or in a client's own configuration and are named here so that
finding one in the corpus does not look like a breach of the rule above. **None of them is
read by the server process.**

| Variable | Read by | Purpose |
| --- | --- | --- |
| `DOMAIN` | Compose, at file-parse time | Substituted into every Traefik router rule — the `Host(...)` matcher for `ticket.`, `portal.` and, when deployed, `files.` ([traefik-and-domains.md](traefik-and-domains.md)). A wrong value produces a 404 from Traefik, never an application error |
| `TASKDESK_IMAGE_TAG` · `TASKDESK_IMAGE_DIGEST` | Compose | Which image the `taskdesk` service pulls. Rollback is editing the digest here and bringing the service back up ([runbook](runbook.md)) |
| `TASKDESK_HSTS_PRELOAD` | Compose, into the Traefik headers middleware | Opt-in `includeSubDomains; preload` on `Strict-Transport-Security`. Off unless the operator sets it, because both are commitments about someone else's apex domain ([traefik-and-domains.md](traefik-and-domains.md)) |
| `TASKDESK_API_URL` · `TASKDESK_API_KEY` | `@taskdesk/mcp`, on the user's own machine | The MCP client package's own configuration ([mcp-server.md](../03-features/mcp-server.md)). It talks to an instance over HTTP like any other API consumer; the server never reads either name |

The five-plus-six rule governs what the **application** reads. What Compose substitutes into
a YAML file, and what a client package reads on a laptop, are different surfaces with
different blast radii.

---

## Runtime configuration — God Mode

### General

Instance name · default locale · default timezone · date and number format ·
audit retention · notification retention · deleted-item retention · support email ·
terms and privacy URLs

### Branding

Product name · logo (light, dark) · favicon · accent colour · login background ·
footer links

Logo, favicon, login background and accent colour double as a fixed, named set of CSS
variable overrides, applied at render time with no rebuild — enumerated in
[`design-system.md`'s Theming section](../02-design/design-system.md#theming), not an
open-ended custom-variable surface. The accent colour is checked for WCAG AA contrast
before save.

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

Backend (`s3`, `azure-blob`, `filesystem`) · endpoint · **public endpoint** · region ·
bucket · credentials · path style · max file size · max files per work item ·
allowed extensions

**A fresh install is `filesystem`** — attachment bytes on a named volume, no credentials, no
bucket, no third hostname. An administrator moves to `s3` when they want to
([deployment.md](deployment.md) has the Compose profile and the presign constraint).

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

The metrics bearer token is a planned God Mode → Observability setting, never an
environment variable. The current API image does not read the setting or serve `/metrics`;
see [observability.md](../01-architecture/observability.md) for the target contract and
[runbook.md](runbook.md) for the currently usable diagnostics.

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
- **Rotation is operator-staged, then incremental.** The operator sets the new key in
  `TASKDESK_ENCRYPTION_KEY` and moves the old one to `TASKDESK_ENCRYPTION_KEY_PREVIOUS`,
  restarts, and then runs God Mode → Plugins → Rotate secrets. `secrets-rekey` re-encrypts
  **row by row**, stamping each with the new `key_id`; both keys are readable for the whole
  window, so a crash resumes rather than restarts. `rekey-status` reports rows on the new
  `key_id` against the total. When God Mode → Health confirms every row has moved, the
  operator removes `TASKDESK_ENCRYPTION_KEY_PREVIOUS` and restarts once more. The step-by-
  step form is in the [runbook](runbook.md); back up **both** keys while the window is open
  ([backup and restore](backup-and-restore.md)).

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

**Two steps, not one (issue #296, S5 — independent Opus 5.5 review of PR #308).** A single
Postgres superuser URL used for both migrations and serving no longer boots at all: the API's
own `assertApplicationRoleIsNotPrivileged` check refuses to start against a role that is a
superuser or owns a table, and a fresh local Postgres role that ran the migrations is exactly
that. This is deliberate — the check does not carve out an exception for `NODE_ENV !==
"production"`, because a silent exception is exactly the kind of thing that gets copied
into a real deployment's `.env` by accident. The documented path mirrors what Compose and
Helm actually do: run the migration step once (against the local Postgres superuser), then
run the API against a separate, ordinary role.

Both steps below need `TASKDESK_AUTH_SECRET` and `TASKDESK_ENCRYPTION_KEY` — the API fails
closed on either being unset, `TASKDESK_ROLE=migrate` included, since it is the same
`src/index.ts` entry point and both requirements are checked before the role branch. On a
fresh clone with no `.env` yet, generate a value for each once
(`openssl rand -hex 32`) and reuse it across both steps:

```bash
export TASKDESK_AUTH_SECRET=$(openssl rand -hex 32)
export TASKDESK_ENCRYPTION_KEY=$(openssl rand -hex 32)

# 1. One-time (or after a schema change): run migrations and create/repair the local
#    application role, against the local Postgres superuser.
TASKDESK_ROLE=migrate \
TASKDESK_MIGRATION_DATABASE_URL=postgres://taskdesk:taskdesk@localhost:5432/taskdesk \
TASKDESK_DATABASE_URL=postgres://taskdesk_app:taskdesk_app@localhost:5432/taskdesk \
  pnpm --filter @taskdesk/api exec tsx src/index.ts

# 2. Every day after: run the API against the application role the step above created.
#    No TASKDESK_MIGRATION_DATABASE_URL here — it must not be set on this process.
TASKDESK_DATABASE_URL=postgres://taskdesk_app:taskdesk_app@localhost:5432/taskdesk \
  pnpm --filter @taskdesk/api dev
```

(Already have a `deploy/.env` from following [one-line-install.md](one-line-install.md) or an
earlier session? Copy its `TASKDESK_AUTH_SECRET`/`TASKDESK_ENCRYPTION_KEY` values instead of
generating new ones — generating fresh ones invalidates every existing session and
previously-encrypted secret.)

`deploy/.env.example` (used by the Compose stack, where `scripts/deploy.sh` runs both steps
for you via the `migrate` service — see compose.yml):

```bash
TASKDESK_DATABASE_URL=postgres://taskdesk_app:...@localhost:5432/taskdesk
TASKDESK_ENCRYPTION_KEY=<openssl rand -hex 32>
TASKDESK_AUTH_SECRET=<openssl rand -hex 32>
TASKDESK_AGENT_URL=https://ticket.localhost
TASKDESK_PORTAL_URL=https://portal.localhost
TASKDESK_VALKEY_URL=redis://localhost:6379
TASKDESK_BOOTSTRAP_ADMIN_EMAIL=you@example.com
POSTGRES_DB=taskdesk
POSTGRES_USER=taskdesk
POSTGRES_PASSWORD=taskdesk

# Compose-only — substituted into the YAML, never read by the application
# The application (`taskdesk_app`) role's password (issue #296). Compose builds
# TASKDESK_DATABASE_URL from it, and TASKDESK_MIGRATION_DATABASE_URL from
# POSTGRES_USER/POSTGRES_PASSWORD instead. The application itself creates the
# taskdesk_app role and sets this password on it at boot.
TASKDESK_APP_DB_PASSWORD=taskdesk
DOMAIN=localhost
TASKDESK_IMAGE_TAG=v2.0.0
TASKDESK_IMAGE_DIGEST=
TASKDESK_HSTS_PRELOAD=
# empty or absent = off; `1` = on. Compose has no boolean, so ANY non-empty
# value — including `0` — selects the preload middleware. scripts/deploy.sh
# rejects anything that is not empty or `1` rather than let `0` mean "on".
```

Local development uses Mailpit for mail and the `filesystem` storage plugin, both of them
reached through God Mode on first run — exactly as a real deployment would be. SeaweedFS is
there behind `--profile s3` for anyone who wants to exercise the S3 path locally
([deployment.md](deployment.md)).

## Related

- [Plugin architecture](../01-architecture/plugin-architecture.md) · [God Mode](../03-features/god-mode.md)
- [Deployment](deployment.md) · [Proxy topology evidence](proxy-topology-evidence.md) · [Backup and restore](backup-and-restore.md)
