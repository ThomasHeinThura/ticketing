# God Mode

- **Phase:** P4 (authentication and organisations land in P3; the audit log in P2)
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** plugin architecture, RBAC

## Purpose

Configure the entire deployment from the interface. No environment variables, no config
files, no rebuild, no restart.

This is what makes "one image, any customer" real. An administrator receives a running
container and turns it into *their* service desk through this surface alone.

Named after Plane's instance admin, which is the best example of the pattern. Rewritten
2026-09-05 after the [planning review](../07-planning/review-2026-09-05.md): the spec had
six numbered rules for fifteen screens, no permissions table, no data section, and a route
list covering a third of the surface.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Instance** | One deployment; God Mode is its administration |
| **Plugin** | A configured implementation of a contract — auth, storage, notify, import, search, ai, license |
| **Feature flag** | An instance-level switch, lockable so lower levels cannot override |
| **Impersonation** | An instance administrator acting as another person, audited twice |

## Data

`instance_setting`, `instance_branding`, `instance_plugin_config`, `instance_feature_flag`,
`terminology_override`, `job_lease`, `backup_run`, `organisation`, `person`, `api_key`,
`audit_log`, `outbox`, `webhook_delivery`, `import_run` — all in the
[data model](../01-architecture/data-model.md). God Mode adds no tables of its own.

## Access

Requires `instance:admin`, which cannot be granted by a workspace role and cannot be
granted by an invitation, and cannot be granted by any identity connection, OIDC claim,
SCIM attribute or group mapping. The first instance administrator is created on the
one-time **setup page** an empty database serves, unlocked by a token printed in the
container log ([auth-and-identity.md](../01-architecture/auth-and-identity.md#break-glass));
`TASKDESK_BOOTSTRAP_ADMIN_EMAIL` exists only for headless installs.

God Mode is a route group inside the agent application — `/agent/god-mode/*` — rather than
a separate application. A separate application means separate authentication, separate
deployment and separate design drift, which is a price without a benefit.

## Sections

**Nineteen screens** — the God Mode rows in the
[screen inventory](../02-design/screen-inventory.md). Sections map one-to-one to rows except
Authentication (list plus connection editor) and Organisations (list, detail, and the
detail's Identity tab).

### Health — the landing page

What is working and what is not, at a glance. Each check reports one of
`ok | degraded | failing | unknown`, thresholds from `instance_setting`:

| Check | `degraded` | `failing` |
| --- | --- | --- |
| Database | pool wait > 100 ms | unreachable |
| Valkey (if configured) | latency > 50 ms | unreachable — the app degrades to in-memory and says so |
| Object storage | test write > 2 s | test write fails |
| Each `notify` / `auth` plugin, and each enabled identity connection (OIDC discovery; SCIM last sync) | last `plugin-health` ping slow; SCIM sync failed once | last ping failed; SCIM token revoked while the connection is enabled |
| Each job | last success older than 2× cadence | older than 3× cadence, or three consecutive failures |
| Backups | no `backup_run` in 24 h | none in 48 h |
| Disk headroom (filesystem storage only) | < 20 % | < 10 % |
| Outbox | pending rising 15 min | dead letters > 0 |
| Version | — | shows version + build SHA; flags when a newer stable exists |

This is the landing page deliberately. An administrator opening God Mode usually wants to
know whether something is broken.

### General

Instance name, default locale, default timezone, date and number formats, retention
periods (audit, notifications, deleted items), support email, terms and privacy URLs, the
reopen and clarification windows, attachment limits, health thresholds, the MCP write
ceiling and API-key burst threshold.

**Terminology**, within General (`instance:manage_terminology`):

- `GM-T1` The overridable term keys are exactly those enumerated in
  [ADR 0012](../01-architecture/adr/0012-terminology-overlay.md) — `work_item`, `project`,
  `cycle`, `module`, `epic`, `request`, `submission`, `service`, `change` — per locale and
  per audience (`agent` | `customer` | `both`).
- `GM-T2` Forms are stored per CLDR plural category (`forms jsonb`); the editor shows the
  categories the chosen locale actually has.
- `GM-T3` Resolution: `work_item_type.name` (when a specific typed item is being named) →
  workspace override → instance override → shipped locale string, with the audience
  selected first. The same rule governs the workspace-level screen in
  [settings-hierarchy.md](settings-hierarchy.md).
- `GM-T4` Saving warns when `one` and `other` are identical, and the live preview
  re-renders a sample screen before save.
- `GM-T5` The default noun is exposed to assistive tech via `title`, never `aria-label`
  ([accessibility.md](../02-design/accessibility.md)).
- `GM-T6` Overrides are served to the browser from `GET /api/public/terminology?locale=`
  with an ETag and invalidated on save; `packages/email` resolves them at send time.

**Config export**: `GET /api/instance/config-export` returns all non-secret configuration
as JSON (elevated). Secrets are excluded and marked as such.

### Branding

Product name, logo for light and dark, favicon, accent colour, login background, footer
links. `css_overrides` is **bounded** to the variables enumerated in
[design-system.md](../02-design/design-system.md); anything else is rejected server-side,
and the submitted accent is contrast-checked against the token pairs before save (a warning,
not a block). Served from `/api/public/branding` so the login page can render before anyone
signs in.

### Authentication — identity connections

The most important screen. See [auth and identity](../01-architecture/auth-and-identity.md),
[identity provisioning](identity-provisioning.md) and
[auth runtime reconfiguration](../01-architecture/auth-runtime-reconfiguration.md).

- Add, edit, enable, disable and delete **identity connections** (OIDC — Microsoft Entra
  first) and the non-OIDC auth plugins (password, OTP, magic link, TOTP, passkey).
- Each connection: provider type, display name, **which portal it serves — agent or
  customer, never both**, issuer/tenant, client id and encrypted secret, redirect URI,
  claim mapping, domain bindings, just-in-time provisioning policy, MFA-upstream mode.
  Customer connections are edited from the organisation's Identity tab (below) — same
  routes, filtered.
- **SCIM panel** per connection: endpoint URL, bearer token create / rotate / revoke
  (shown once; rotation invalidates the old token at once), allowed resources, attribute
  mapping, allowlisted group → role mappings (never `instance:admin`, never `sees_all`),
  lifecycle policy, last sync, last failure without secrets, provisioning event log.
- **Test connection** (OIDC discovery + dry run) and **Test SCIM** before going live; both
  audited even when nothing is saved.
- MFA policy: off, optional, required for staff, required for a role, required for
  everyone.
- Session policy: idle timeout, absolute lifetime, concurrent session limit.
- Password policy, when password auth is enabled.

`auth.password` cannot be removed. It is the lock-out prevention.

### Organisations

Customer organisations. Create, edit, suspend, delete. Per organisation: name, key, email
domains, portal access, quotas, bound identity provider, request catalogue
(`organisation_request_type`), default customer visibility (`private` | `organisation`),
and **project defaults** — a service calendar and an SLA policy that are **copied onto new
projects for that organisation at creation**, never a resolution level of their own
([settings-hierarchy.md](settings-hierarchy.md) `ST-3`).

Provisioning a new customer organisation is the operation performed most often, so it is
one screen and one submit.

**Organisation → Identity** (`/agent/god-mode/organisations/{id}/identity`, P3): the
customer organisation's own identity connection — enable/disable portal SSO; provider type
(Microsoft Entra first); organisation-bound OIDC settings; SCIM endpoint information; SCIM
token create and rotate; Test OIDC; Test SCIM; provisioning status and last sync result;
errors without secrets; controlled attribute mapping; controlled group mapping (customer
roles only); audit history; and **unmissable warnings** that everything on this screen is
bound to this one organisation and to the customer portal only. Instance administrators
only — customers cannot configure their own IdP in the first release
([identity-provisioning.md](identity-provisioning.md) `IP-5`).

### Storage

Which object storage backend, its settings, a test write, current usage, and the
attachment limits.

### Notifications

Channels available on this instance: SMTP and the generic webhook (core). Further
`notify.*` channels — Teams → Slack → Telegram → Viber, then others — appear here as they
are built ([notifications.md](notifications.md); future scope, decided 2026-09-05). Each is
a `notify.*` plugin with settings and a test send through
the generic `POST /api/instance/plugins/{id}/test` route — there is no channel-specific
test route. Plus the default notification preferences new users inherit.

### Deliveries

The outbox: pending, retrying and **dead** deliveries (notifications and webhooks), with
requeue and discard. This is where "SMTP has been down for hours" is visible.

### Features

Instance-wide feature flags, with a **lock** switch that prevents workspaces and projects
from overriding. This is how editions are sold from one image. The flag list is
[plugin-architecture.md § Feature toggles](../01-architecture/plugin-architecture.md#feature-toggles).

### Jobs

Every job in [background-jobs.md](../01-architecture/background-jobs.md): its schedule, last
run, duration, outcome, next run. Editable cadence, an enable/disable switch, and a manual
trigger for debugging — `instance:manage_jobs`, audited.

### Plugins

Every configurable plugin in one list, with kind, status, last health check and a link to
its settings — `instance:manage_plugins`. The single answer to "what is this instance
actually configured to do?" AI (`ai.*`) and marketplace licensing (`license.*`,
[ADR 0013](../01-architecture/adr/0013-marketplace-metering-plugin.md)) are configured here
as plugins; they have no separate section.

### Observability

Sentry DSN, OTLP endpoint and headers, trace sample rate, the `/metrics` bearer token, log
level per module. Runtime settings, not environment variables
([observability.md](../01-architecture/observability.md)).

### MCP usage

Which keys, how many calls, which tools, error rates, auto-disabled keys
([mcp-server.md](mcp-server.md)).

### Users

Every account on the instance, across organisations. Search, view, suspend, unsuspend,
force sign-out, reset MFA, delete (deactivate — people are never hard-deleted), export a
person's data, anonymise a person, and **impersonate**.

### Audit

The instance audit log — filter by actor, action, entity, workspace, date. Export to CSV
(elevated, itself audited). P2, because the audit trail is a P2 feature
([audit-trail.md](audit-trail.md)).

### Import

Import runs and their history. See [import strategy](../06-data-import/import-strategy.md).

## Behaviour

- `GM-1` Every change writes an audit row: actor, section, what changed. Secret **values**
  are never recorded, only the fact that a secret changed.
- `GM-2` Elevated actions require re-authentication within the last five minutes. **The
  list lives in [rbac.md](../01-architecture/rbac.md)** and is not restated here.
- `GM-3` Configuration changes take effect within seconds without a restart. Where a
  rebuild of an internal component is needed — as for better-auth — it happens
  transparently and is propagated to every replica ([auth runtime reconfiguration](../01-architecture/auth-runtime-reconfiguration.md)).
- `GM-4` Every plugin with a meaningful test implements one, and the UI surfaces the real
  error rather than a generic failure. An administrator must be able to distinguish
  "wrong password" from "cannot reach host".
- `GM-5` Settings forms are generated from each plugin's Zod schema, so a new plugin
  arrives with its administration UI already built.
- `GM-6` Destructive actions are **pending actions**
  ([pending-actions.md](../01-architecture/pending-actions.md)): the request returns `202`,
  the server chooses the confirmation level, and for God Mode targets — organisations,
  identity connections, auth plugins, hard purge — that level is **typed exact name +
  step-up**. The client cannot lower it.

**Impersonation**

- `GM-7` Starting impersonation is elevated (`GM-2`), writes an audit row on the
  administrator (`impersonation.started`, target), and issues a session with
  `impersonatedBy` set. The session is capped at **30 minutes**; at the cap it is
  invalidated and the administrator is returned to their own session.
- `GM-8` Every request made during impersonation writes its normal audit row with
  `audit_log.impersonator_id` set — "doubly audited" means exactly this: one row for the
  act, one per action.
- `GM-9` The impersonator may read and may perform ordinary writes as the target. They may
  **not**: decide approvals, **request or approve a deletion** (a pending action —
  [pending-actions.md](../01-architecture/pending-actions.md)), perform any elevated action,
  start a further impersonation, change the target's credentials or MFA, export data, or
  **create anything that outlives the session** — API keys, webhooks, invitations, role or
  membership edits, `sees_all` grants. Each refusal is a 403 naming `impersonation`. The impersonated person is
  **notified** in-app and by email when the session ends, with the start and end times and
  the reason recorded at `GM-7`.
- `GM-10` Another instance administrator can never be impersonated.
- `GM-11` A persistent, unmissable banner shows who is impersonating whom, with an exit
  control that calls `DELETE /api/instance/impersonate` (always allowed) and writes
  `impersonation.ended`.

**Encryption key rotation** — an operator-staged procedure, because the key lives in the
environment, not the database:

- `GM-12` The operator sets `TASKDESK_ENCRYPTION_KEY` to the new key and
  `TASKDESK_ENCRYPTION_KEY_PREVIOUS` to the old one, and restarts. Both keys are readable;
  writes use the new one.
- `GM-13` God Mode → Plugins → **Rotate secrets** (elevated) starts the `secrets-rekey` job,
  which re-encrypts every `instance_plugin_config.secrets` row **and every
  `identity_connection.client_secret`** under the new key and stamps its `key_id`. Progress
  and any failure are visible; the job is resumable.
- `GM-14` When every row carries the new `key_id`, Health says so, and the operator removes
  `TASKDESK_ENCRYPTION_KEY_PREVIOUS`. Full procedure in the [runbook](../05-operations/runbook.md).

## Permissions

| Action | Capability |
| --- | --- |
| Read any God Mode screen | `instance:admin` |
| General, branding, organisations, storage, notifications, features, users, config export | `instance:admin` |
| Plugins — configure, test, enable, disable, rotate secrets | `instance:manage_plugins` (implied by `instance:admin`) |
| Jobs — cadence, enable/disable, trigger | `instance:manage_jobs` |
| Terminology (instance level) | `instance:manage_terminology` |
| Audit — read | `instance:read_audit` |
| Audit — export | `instance:read_audit` + elevated |
| Impersonate | `instance:admin` + elevated, never another instance admin |
| Elevated actions | per the single list in [rbac.md](../01-architecture/rbac.md) |

## Screens

The nineteen God Mode rows in the [screen inventory](../02-design/screen-inventory.md).
They use the same shell and the same primitives as the rest of the agent application. God
Mode is not a place where the design standard relaxes — it is where an administrator forms
their first impression of whether the product is trustworthy.

## API

Every route `scope: instance`; capability as shown; **E** = elevated.

```
GET    /api/instance/health                           instance:admin
GET    /api/instance/settings                         instance:admin
PATCH  /api/instance/settings                         instance:admin
GET    /api/instance/config-export                    instance:admin  E
GET    /api/instance/branding                         instance:admin
PATCH  /api/instance/branding                         instance:admin
GET    /api/public/branding                           public — the login page needs it
GET    /api/public/terminology?locale=                public — the UI needs it before sign-in
GET    /api/instance/terminology                      instance:manage_terminology
PUT    /api/instance/terminology                      instance:manage_terminology
POST   /api/instance/terminology/preview              instance:manage_terminology
GET    /api/instance/plugins                          instance:manage_plugins
POST   /api/instance/plugins                          instance:manage_plugins  (E for auth.*)
PATCH  /api/instance/plugins/{id}                     instance:manage_plugins  (E for auth.*)
DELETE /api/instance/plugins/{id}                     instance:manage_plugins  (E for auth.*; auth.password refused; pending action — typed name + step-up)
POST   /api/instance/plugins/{id}/test                instance:manage_plugins
POST   /api/instance/plugins/rotate-secrets           instance:manage_plugins  E   (starts secrets-rekey)
GET    /api/instance/storage/usage                    instance:admin
GET    /api/instance/organisations                    instance:admin
POST   /api/instance/organisations                    instance:admin
PATCH  /api/instance/organisations/{id}               instance:admin
POST   /api/instance/organisations/{id}/suspend       instance:admin
POST   /api/instance/organisations/{id}/unsuspend     instance:admin
DELETE /api/instance/organisations/{id}               instance:admin  E  (pending action — typed name + step-up)
PUT    /api/instance/organisations/{id}/catalogue     instance:admin
GET    /api/instance/organisations/{id}/identity      instance:admin      (the organisation's identity connection)

GET    /api/instance/identity-connections                         instance:admin
POST   /api/instance/identity-connections                         instance:admin  E
PATCH  /api/instance/identity-connections/{id}                    instance:admin  E
DELETE /api/instance/identity-connections/{id}                    instance:admin  E  (pending action — typed name + step-up)
POST   /api/instance/identity-connections/{id}/test               instance:admin      (audited even unsaved)
POST   /api/instance/identity-connections/{id}/scim               instance:admin  E
PATCH  /api/instance/identity-connections/{id}/scim               instance:admin  E*  (*E when a mapping grants staff access, a role above member, or reach — IP-6)
POST   /api/instance/identity-connections/{id}/scim/rotate-token  instance:admin  E
POST   /api/instance/identity-connections/{id}/scim/revoke-token  instance:admin  E
POST   /api/instance/identity-connections/{id}/scim/test          instance:admin
GET    /api/instance/identity-connections/{id}/events             instance:admin
POST   /api/instance/purge                                        instance:admin  E  (PA-13 — legal hold checked)
GET    /api/instance/users                            instance:admin
POST   /api/instance/users/{id}/suspend               instance:admin
POST   /api/instance/users/{id}/unsuspend             instance:admin
POST   /api/instance/users/{id}/sign-out              instance:admin
POST   /api/instance/users/{id}/reset-mfa             instance:admin  E
POST   /api/instance/users/{id}/grant-admin           instance:admin  E
POST   /api/instance/users/{id}/deactivate            instance:admin
GET    /api/instance/users/{id}/export                instance:admin  E
POST   /api/instance/users/{id}/anonymise             instance:admin  E
POST   /api/instance/users/{id}/impersonate           instance:admin  E
DELETE /api/instance/impersonate                      authenticated + self (always allowed)
GET    /api/instance/features                         instance:admin
PATCH  /api/instance/features                         instance:admin
GET    /api/instance/jobs                             instance:manage_jobs
PATCH  /api/instance/jobs/{name}                      instance:manage_jobs
POST   /api/instance/jobs/{name}/run                  instance:manage_jobs
GET    /api/instance/deliveries                       instance:admin
POST   /api/instance/deliveries/{id}/requeue          instance:admin
DELETE /api/instance/deliveries/{id}                  instance:admin
GET    /api/instance/observability                    instance:admin
PATCH  /api/instance/observability                    instance:admin
GET    /api/instance/mcp/usage                        instance:admin
GET    /api/instance/audit                            instance:read_audit
POST   /api/instance/audit/export                     instance:read_audit  E
GET    /api/instance/backup-runs                      instance:admin
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Last instance admin removes their own access | Refused. There must always be at least one |
| Every identity provider disabled | Refused. `auth.password` cannot be removed |
| Encryption key rotation interrupted | `secrets-rekey` is resumable; rows carry `key_id`, both keys stay readable until Health reports completion |
| Plugin config saved while a job is using it | The job finishes with the old config; the next run uses the new one |
| Two admins editing one plugin | Optimistic concurrency, 409 with a diff |
| Organisation suspended with active sessions | Sessions invalidated immediately |
| Impersonation session reaches 30 minutes | Invalidated; administrator returned to their own session; `impersonation.ended` audited with reason `cap` |
| Feature flag locked off while a project uses the feature | Owned by [settings-hierarchy.md](settings-hierarchy.md) |

## Out of scope

- Workspace and project settings → [settings-hierarchy.md](settings-hierarchy.md)
- Role editing → [roles-and-permissions-ui.md](roles-and-permissions-ui.md)

## Testing

Integration: every God Mode route requires its capability; a workspace owner is refused;
elevated actions require fresh authentication; secrets never appear in any response.

E2E: configure an OIDC provider against a test IdP container, test the connection, sign in
through it; disable a feature flag and observe its navigation entry disappear and its API
return 404.

Security: `godmode-requires-instance-admin.spec.ts`, `secrets-never-serialised.spec.ts`,
`impersonation-audited.spec.ts` (`GM-7`, `GM-8`), `impersonation-forbidden-actions.spec.ts`
(`GM-9`, `GM-10`), `impersonation-cap.spec.ts` (`GM-7` cap), `rekey-resumable.spec.ts`
(`GM-12`–`GM-14`), `terminology-a11y-name.spec.ts` (`GM-T5`).

## Open questions

None.

## Related

- [Plugin architecture](../01-architecture/plugin-architecture.md)
- [Auth and identity](../01-architecture/auth-and-identity.md) · [Auth runtime reconfiguration](../01-architecture/auth-runtime-reconfiguration.md)
- [Configuration reference](../05-operations/configuration-reference.md) · [RBAC](../01-architecture/rbac.md)
