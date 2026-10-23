# Configuration

This maintained contract registers bootstrap environment names for `check:env` and preserves the runtime configuration scope. Customer settings belong in persisted administration, without rebuilding the shipping image. A listed setting is a requirement, not evidence that its UI or backend is complete; see [status](../status.md).

## Bootstrap environment variables

### Required

| Variable | Purpose |
| --- | --- |
| `TASKDESK_DATABASE_URL` | Serving connection: a non-superuser application role that owns no tables and has only its required DML grants. The inherited connection resolver can derive it from `POSTGRES_*`; production supplies the split application credential. |
| `TASKDESK_ENCRYPTION_KEY` | Plugin-secret encryption key; generate 32 random bytes, encoded as 64 hex characters. Losing it makes stored encrypted secrets unreadable. |
| `TASKDESK_AUTH_SECRET` | Session-signing secret; generate 32 random bytes, encoded as 64 hex characters. Rotation invalidates sessions. |
| `TASKDESK_AGENT_URL` | Public agent origin. |
| `TASKDESK_PORTAL_URL` | Public portal origin on a separate hostname and cookie scope. |

### Optional

| Variable | Default | Purpose |
| --- | --- | --- |
| `TASKDESK_MIGRATION_DATABASE_URL` | Application URL fallback for the migration process only | Owner/DDL connection. Set only on `TASKDESK_ROLE=migrate`, never on serving or job processes. Run migrations and role/grant setup before starting the application role. |
| `TASKDESK_PORT` | `5173` | HTTP bind port. |
| `TASKDESK_VALKEY_URL` | unset | Shared coordination connection required by the multiple-replica contract. |
| `TASKDESK_ROLE` | `all` | `web`, `jobs`, `all` or `migrate`; migration exits after setup without serving HTTP. |
| `TASKDESK_ENCRYPTION_KEY_PREVIOUS` | unset | Previous key during staged re-encryption. Retain both keys until every encrypted row has moved. |
| `TASKDESK_TRUST_PROXY` | `1` | Exact trusted reverse-proxy hop count; `0` uses the socket address. Measure the deployed topology. Expose the application through the trusted proxy network only. |
| `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` | unset | Headless first-administrator setup. Normal empty-database setup uses the one-time setup page and token. |
| `NODE_ENV` | `production` | Development permits HTTP webhook targets; production must be explicit. |
| `DISABLE_WORKSPACE_CREATION` | unset | Literal `true` restricts workspace creation to instance administrators; current authority is read from the database at request time. |
| `TASKDESK_STORAGE_DRIVER` | `filesystem` | Interim `filesystem` or `s3` bootstrap selection. Invalid values fail startup. Do not switch existing bytes between backends without a migration plan; deletion cannot clean up a backend that is no longer selected. |
| `TASKDESK_STORAGE_FILESYSTEM_ROOT` | `/app/data/attachments` | Writable filesystem-storage root; mount persistent storage for durable bytes. |
| `TASKDESK_POLICY_SHADOW` | `off` | Interim `on`/`off` policy comparison. Records disagreements without changing responses; invalid values fail startup. |
| `TASKDESK_POLICY_ENFORCE` | empty | Exact comma-separated registry source paths. Reject unknown, duplicate, empty or whitespace-padded members; the task source must be last after all other sources. Requires separately verified policy cutover evidence. |

The storage and policy switches are bounded bootstrap compatibility, not permission to add customer-specific environment configuration. Environment names that remain in `scripts/ci/env-baseline.json` are inherited migration debt; that baseline only shrinks.

### Postgres container

| Variable | Purpose |
| --- | --- |
| `POSTGRES_DB` · `POSTGRES_USER` · `POSTGRES_PASSWORD` | Standard PostgreSQL image bootstrap values. They do not authorize serving as the owner or superuser. |

### Test process variables

| Variable | Purpose |
| --- | --- |
| `TZ` | Test-harness timezone override for UTC-date regressions, restored after each test; no application/customer setting. |

### Variables the application does not read

These names configure deployment tooling or an external client. Registering them here does not authorize application reads.

| Variable | Read by | Purpose |
| --- | --- | --- |
| `DOMAIN` | Compose, at file-parse time | Base domain for proxy host rules. |
| `TASKDESK_AGENT_HOST` · `TASKDESK_PORTAL_HOST` · `TASKDESK_FILES_HOST` | Compose, at file-parse time | Explicit proxy hostnames; empty values derive agent/portal/files hosts from the domain. Files applies when the storage profile needs it. |
| `TASKDESK_IMAGE_TAG` · `TASKDESK_IMAGE_DIGEST` | Compose | Shipping image selection and digest-pinned rollback. |
| `TASKDESK_HSTS_PRELOAD` | Compose, into the Traefik headers middleware | Explicit opt-in to HSTS subdomains/preload commitments. |
| `TASKDESK_LOCAL_HTTP_PORT` · `TASKDESK_LOCAL_HTTPS_PORT` | Compose, `deploy/compose.traefik.yml` (`local` mode only) | Local proxy listener ports, default 80/443; verify availability before starting. |
| `TASKDESK_API_URL` · `TASKDESK_API_KEY` | `@taskdesk/mcp`, on the user's own machine | External MCP client's instance URL and scoped API credential; the API server reads neither name. |

## Runtime configuration

| Area | Required persisted configuration |
| --- | --- |
| General | Instance name, locale, timezone, date/number formats, audit retention, `notification_retention_days` (default 90), notification/deleted-item retention, support email, terms/privacy URLs. |
| Branding | Product name, light/dark logos, favicon, accent, login background and footer links. Only the named theme overrides are allowed; validate accent contrast before saving. |
| Authentication | Per-provider type/name, agent/customer/both scope, discovery/endpoints, client ID/encrypted secret, scopes, claim mappings, side/organisation/role JIT mapping, group-to-role mapping, domain restrictions, enabled state and upstream-MFA setting. Instance MFA/password policy, idle/absolute session lifetime and concurrent-session limit. Planned settings do not imply current enforcement; identity claims never grant instance administrator or unrestricted reach. |
| Organisations | Name/key, email domains, internal flag, calendar, default SLA policy, request catalogue, portal access, identity-provider binding and quotas. |
| Storage | `filesystem`, `s3` or `azure-blob`; endpoint/public endpoint, region, bucket, encrypted credentials, path style, maximum file size, maximum files per work item and allowed extensions. Fresh installs use filesystem storage on a durable volume; backend migration must preserve existing bytes. |
| Notifications | SMTP host/port/TLS/encrypted credentials/from/reply-to, webhook defaults, default user preferences and digest cadence. Additional notification providers remain separately tracked features. |
| Features | Existing registered `feature.*` identifiers, enabled state and instance lock; keep the identifier catalogue authoritative rather than inventing flags here. |
| Jobs | Schedule, enabled state, last run and manual trigger for registered jobs. |
| Observability | Per-module log levels and a hash-only metrics bearer token in persisted administration; no new application environment name. Verify actual metrics serving/enforcement separately. |
| Optional AI | Provider, endpoint, encrypted API key, model and permitted features; off by default. |

Feature flags inherit project → workspace → instance → built-in default; an instance feature lock prevents lower-scope override. Other settings use their defined scopes, with the more specific value winning where an override is permitted. Show the effective value's source in the interface.

Encrypt plugin secrets with AES-256-GCM. Reads return a masked value, never the secret; writes accept a replacement or explicit unchanged sentinel. Audit changed keys without values. Rotate incrementally with old and new keys readable until re-encryption finishes, then remove the previous key. A crash must be resumable.

Configuration is backed-up data: `instance_setting`, `instance_branding`, `instance_plugin_config` and `instance_feature_flag` must survive a restore. Configuration export excludes secrets; importing or reproducing a configuration requires re-entering those secrets. These statements define required behavior, not restore or export acceptance evidence.

## Source installer integrity

The maintained source SHA-256 for `install.sh` is `ab4e319e2ea267ebab4b7c63f61944a98c86d0544f77e49b9dce86a19891fb4c`. Refresh it with an intentional installer change. The installer regression checks the actual source bytes; release archives and deployed images still require their own verified checksums and source identity.
