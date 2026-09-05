# Settings hierarchy

- **Phase:** P4 (individual screens land with their features)
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** RBAC, plugin architecture

## Purpose

Four levels of settings, each owning a clear set of decisions, with predictable
inheritance.

The failure mode is settings that could plausibly live at two levels, so nobody knows
where to look. Every setting below appears at exactly one level.

Structure taken from Plane, which does this well.

## The levels

```
Instance          the deployment    → God Mode           instance:admin
   └── Workspace  the organisation  → Workspace settings  workspace:manage_settings
        └── Project  the engagement → Project settings    project:manage_settings
Profile           the person        → Profile settings    self
```

## Instance — God Mode

Everything that varies between *deployments*. Full detail in [God Mode](god-mode.md).

General · Branding · Authentication · Organisations · Storage · Notification channels ·
Feature flags · Jobs · Plugins · Users · Audit · Import · Health

## Workspace

Everything that varies between *organisations using this deployment*.

| Screen | Owns |
| --- | --- |
| General | Name, slug, logo, default project template |
| **Terminology** | Override the instance's default nouns for this workspace only — see [ADR 0012](../01-architecture/adr/0012-terminology-overlay.md) |
| Members | Who is in this workspace, and their role |
| Teams | Team definition, membership, capacity |
| **Roles** | Create and edit roles — see [roles UI](roles-and-permissions-ui.md) |
| Work item types | Types, their icons, their workflows, their default SLA |
| Workflows | State machines and transitions |
| SLA policies | Goals by type and priority |
| Service calendars | Cover windows and holidays |
| Request types | The customer-facing catalogue |
| Custom fields | Fields and sections |
| Labels | The shared label vocabulary |
| Estimates | Point, category or time scales |
| Webhooks | Outbound integrations |
| Import | Import runs |
| Danger zone | Transfer ownership, delete workspace |

## Project

Everything that varies between *engagements*.

| Screen | Owns |
| --- | --- |
| General | Name, key, icon, kind, dates, customer organisation, health, default assignee |
| Members | The project roster and per-project role overrides |
| States | This project's states and their order — fully renameable, see [ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md) |
| **Features** | Per-project feature toggles |
| Labels | Project-only labels, in addition to workspace labels |
| Automations | Rules scoped to this project |
| SLA | Which policy and calendar apply |
| Danger zone | Archive, delete |

## Profile

Everything that varies between *people*.

| Screen | Owns |
| --- | --- |
| General | Name, avatar, job title, locale, timezone |
| Appearance | Theme, density, sidebar behaviour, default layouts |
| Notifications | Per-event, per-channel, per-workspace preferences, quiet hours |
| Security | Password, MFA, passkeys, active sessions |
| API keys | Personal keys and agent configuration |

## Inheritance

- `ST-1` Feature flags resolve **project → workspace → instance → built-in default**.
- `ST-2` An instance flag marked `locked` cannot be overridden below. This is how editions
  are sold from one image.
- `ST-3` Nothing else inherits. A workspace does not inherit an SLA policy from the
  instance, because SLA policies are workspace-scoped by definition.
- `ST-4` Where a setting exists at two levels — SLA policy on a workspace and on a project
  — the **more specific wins**, and the interface says so: "Inherited from workspace
  (Standard Support). Override ▾".

That last point matters. A setting showing an inherited value with no indication that it is
inherited is how people conclude the product is ignoring them.

## Behaviour

- `ST-5` Every settings screen shows who last changed it and when.
- `ST-6` Every settings screen has a History affordance showing its audit rows inline.
- `ST-7` Changes take effect immediately. Where that has wide consequences — a role change,
  a workflow publish — the save dialog states the blast radius: "This affects 14 people",
  "This affects 340 open work items".
- `ST-8` Destructive settings live in a visually distinct "Danger zone" at the bottom and
  require typing the name of the thing.
- `ST-9` Settings screens are ordinary routes with ordinary URLs, deep-linkable, so
  documentation and support conversations can point at them.

## Screens

Settings uses a two-column shell: a navigation rail on the left, content on the right,
following kaneo's `settings-layout`. Consistent across all four levels, so moving between
them requires no relearning.

## API

```
GET/PATCH /api/instance/settings              instance:admin
GET/PATCH /api/workspaces/{id}/settings       workspace:manage_settings
GET/PATCH /api/projects/{key}/settings        project:manage_settings
GET/PATCH /api/me/settings                    self
GET       /api/features/resolved?project=…    any authenticated session
```

`GET /features/resolved` returns the fully resolved flag set for a context, so the client
never re-implements the resolution order.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Feature disabled at instance while a project uses it | Data retained and hidden; the API returns 404 for its routes; re-enabling restores everything |
| Workspace deleted with active projects | Refused. Projects must be archived or moved first |
| Project moved between workspaces | Workspace-scoped configuration is remapped where equivalents exist and reported where they do not |
| Two administrators editing one screen | Optimistic concurrency, 409, with a diff |
| Setting removed in a release | Migration drops it and audits the change |

## Testing

Unit: flag resolution across all four levels, including `locked`.

Integration: each settings route requires its capability; a locked instance flag cannot be
overridden through a crafted request.

E2E: change a project feature flag and observe the tab and its route disappear; see the
inheritance indicator and override it.

## Related

- [God Mode](god-mode.md) · [Roles and permissions UI](roles-and-permissions-ui.md)
- [Plugin architecture](../01-architecture/plugin-architecture.md)
