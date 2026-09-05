# God Mode

- **Phase:** P4 (authentication and organisations land in P3)
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** plugin architecture, RBAC

## Purpose

Configure the entire deployment from the interface. No environment variables, no config
files, no rebuild, no restart.

This is what makes "one image, any customer" real. An administrator receives a running
container and turns it into *their* service desk through this surface alone.

Named after Plane's instance admin, which is the best example of the pattern.

## Access

Requires the `instance:admin` capability, which cannot be granted by a workspace role and
cannot be granted by an invitation. The first instance administrator is created on an
empty database from `TASKDESK_BOOTSTRAP_ADMIN_EMAIL`.

God Mode is a route group inside the agent application — `/agent/god-mode/*` — rather than
a separate application. A separate application means separate authentication, separate
deployment and separate design drift, which is a price without a benefit.

## Sections

### Health — the landing page

What is working and what is not, at a glance. Database, Valkey, storage, mail, each
configured plugin, each scheduled job's last successful run, disk headroom, version and
build SHA.

This is the landing page deliberately. An administrator opening God Mode usually wants to
know whether something is broken.

### General

Instance name, default locale, default timezone, date and number formats, data retention
periods (audit, notifications, deleted items), support email, terms and privacy URLs.

**Terminology**, within General: override the display noun for a fixed set of domain
concepts — work item, project, cycle, epic, request and the rest — per locale, with a live
preview before saving. "Ticket" becomes "Case"; "Cycle" becomes "Sprint". The API and every
stored key are unaffected — only rendered labels change. See
[ADR 0012](../01-architecture/adr/0012-terminology-overlay.md).

### Branding

Product name, logo for light and dark, favicon, accent colour, login background, footer
links, optional custom CSS variable overrides. Served from `/api/public/branding` so the
login page can render before anyone signs in.

### Authentication

The most important screen. See [auth and identity](../01-architecture/auth-and-identity.md).

- Add, edit, enable, disable and delete identity providers.
- Each provider: type, display name, **which portal it serves**, endpoints, credentials,
  claim mapping, just-in-time provisioning rules, group-to-role mapping, domain
  restriction.
- **Test connection** before going live.
- MFA policy: off, optional, required for staff, required for a role, required for
  everyone.
- Session policy: idle timeout, absolute lifetime, concurrent session limit.
- Password policy, when password auth is enabled.

`auth.password` cannot be removed. It is the lock-out prevention.

### Organisations

Tenants. Create, edit, suspend, delete. Per organisation: name, key, email domains,
service calendar, default SLA policy, request catalogue, portal access, quotas, bound
identity provider.

Provisioning a new customer organisation is the operation performed most often, so it is
one screen and one submit.

### Storage

Which object storage backend, its settings, a test write, current usage, and per-file and
per-organisation size limits.

### Notifications

Channels available on this instance: SMTP, generic webhook, Slack, Teams, Discord, ntfy,
Gotify. Each with settings and a test send. Plus the default notification preferences new
users inherit.

### Features

Instance-wide feature flags, with a **lock** switch that prevents workspaces and projects
from overriding. This is how editions are sold from one image.

### Jobs

Every scheduled job: its schedule, last run, duration, outcome, next run. Editable
cadence, an enable/disable switch, and a manual trigger for debugging.

### Plugins

Every configurable plugin in one list, with kind, status, last health check and a link to
its settings. The single answer to "what is this instance actually configured to do?"

This is also where **marketplace licensing** lives, as a `license` plugin like any other —
`license.none` by default, meaning nothing reports usage anywhere. An administrator who
procured through AWS Marketplace enables `license.aws-marketplace` here and nowhere else.
See [ADR 0013](../01-architecture/adr/0013-marketplace-metering-plugin.md).

### Users

Every account on the instance, across organisations. Search, view, suspend, unsuspend,
force sign-out, reset MFA, delete, and **impersonate**.

Impersonation shows a persistent banner, is capped at 30 minutes, is doubly audited, and
cannot target another instance administrator.

### Audit

The instance audit log. Filter by actor, action, entity, date. Export to CSV, which is
itself audited.

### Import

Import runs and their history. See [import strategy](../06-data-import/import-strategy.md).

## Behaviour

- `GM-1` Every change writes an audit row: actor, section, what changed. Secret **values**
  are never recorded, only the fact that a secret changed.
- `GM-2` Elevated actions require re-authentication within the last five minutes:
  changing an identity provider, granting `instance:admin`, rotating the encryption key,
  starting impersonation, exporting all data.
- `GM-3` Configuration changes take effect within seconds without a restart. Where a
  rebuild of an internal component is needed — as for better-auth — it happens
  transparently and is broadcast to every replica.
- `GM-4` Every plugin with a meaningful test implements one, and the UI surfaces the real
  error rather than a generic failure. An administrator must be able to distinguish
  "wrong password" from "cannot reach host".
- `GM-5` Settings forms are generated from each plugin's Zod schema, so a new plugin
  arrives with its administration UI already built.
- `GM-6` Destructive actions require typing the name of the thing being destroyed.

## Screens

Fifteen screens, listed in the [screen inventory](../02-design/screen-inventory.md).

They use the same shell and the same primitives as the rest of the agent application. God
Mode is not a place where the design standard relaxes — it is where an administrator forms
their first impression of whether the product is trustworthy.

## API

```
GET   /api/instance/health                 instance:admin
GET   /api/instance/settings               instance:admin
PATCH /api/instance/settings               instance:admin
GET   /api/instance/branding               instance:admin
GET   /api/public/branding                 public — the login page needs it
GET   /api/instance/plugins                instance:admin
POST  /api/instance/plugins                instance:admin
PATCH /api/instance/plugins/{id}           instance:admin
POST  /api/instance/plugins/{id}/test      instance:admin
GET   /api/instance/organisations          instance:admin
POST  /api/instance/organisations          instance:admin
GET   /api/instance/users                  instance:admin
POST  /api/instance/users/{id}/impersonate instance:admin  + re-auth
GET   /api/instance/jobs                   instance:admin
POST  /api/instance/jobs/{name}/run        instance:admin
GET   /api/instance/audit                  instance:read_audit
GET   /api/instance/features               instance:admin
PATCH /api/instance/features               instance:admin
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Last instance admin removes their own access | Refused. There must always be at least one |
| Every identity provider disabled | Refused. `auth.password` cannot be removed |
| Encryption key rotation interrupted | Transactional. The old key is retained until every secret is re-encrypted |
| Plugin config saved while a job is using it | The job finishes with the old config; the next run uses the new one |
| Two admins editing one plugin | Optimistic concurrency, 409 with a diff |
| Organisation suspended with active sessions | Sessions invalidated immediately |
| Feature flag locked off while a project uses the feature | Existing data is retained and hidden. Re-enabling restores it |

## Out of scope

- Workspace and project settings → [settings-hierarchy.md](settings-hierarchy.md)
- Role editing → [roles-and-permissions-ui.md](roles-and-permissions-ui.md)

## Testing

Integration: every God Mode route requires `instance:admin`; a workspace owner is refused;
elevated actions require fresh authentication; secrets never appear in any response.

E2E: configure an OIDC provider against a test IdP container, test the connection, sign in
through it; disable a feature flag and observe its navigation entry disappear and its API
return 404.

Security: `godmode-requires-instance-admin.spec.ts`,
`secrets-never-serialised.spec.ts`, `impersonation-audited.spec.ts`.

## Open questions

None.

## Related

- [Plugin architecture](../01-architecture/plugin-architecture.md)
- [Auth and identity](../01-architecture/auth-and-identity.md)
- [Configuration reference](../05-operations/configuration-reference.md)
