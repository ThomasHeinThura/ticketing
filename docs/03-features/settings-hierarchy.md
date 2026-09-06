# Settings hierarchy

- **Stage:** P4 (individual screens land with their features, from P1)
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** RBAC, plugin architecture

## Purpose

Four levels of settings, each owning a clear set of decisions, with predictable
inheritance.

The failure mode is settings that could plausibly live at two levels, so nobody knows
where to look. Every setting below appears at exactly one level. Structure taken from
Plane, which does this well. Rewritten 2026-09-05 after the
[planning review](../07-planning/review-2026-09-05.md) found the document contradicting its
own thesis twice.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Level** | Instance, workspace, project, profile |
| **Inheritance** | Only feature flags cross the instance → workspace boundary; a project inherits a small named set from its workspace |
| **Lock** | An instance flag that lower levels may not override |

## Data

`instance_setting`, `instance_feature_flag`, `workspace_feature_flag`,
`project_feature_flag`, `terminology_override`, `user_preference`, `audit_log` — see
[data model](../01-architecture/data-model.md).

## The levels

```
Instance          the deployment    → God Mode           instance:admin
   └── Workspace  the organisation  → Workspace settings  workspace:manage_settings
        └── Project  the engagement → Project settings    project:manage_settings
Profile           the person        → Profile settings    self
```

## Instance — God Mode

Everything that varies between *deployments*. Full detail in [God Mode](god-mode.md):
Health · General (incl. terminology) · Branding · Authentication · Organisations · Storage ·
Notification channels · Deliveries · Feature flags · Jobs · Plugins · Observability ·
MCP usage · Audit · Import · Users.

## Workspace

Everything that varies between *organisations using this deployment*. **This table is the
list**; [information-architecture.md](../02-design/information-architecture.md) and the
[screen inventory](../02-design/screen-inventory.md) follow it.

| Screen | Owns |
| --- | --- |
| General | Name, slug, logo, default project template, time-entry backdating limit, KB review step |
| Terminology | Workspace-level overrides of the instance's nouns — [ADR 0012](../01-architecture/adr/0012-terminology-overlay.md), rules `GM-T1`–`GM-T6` in [god-mode.md](god-mode.md) |
| Members | Who is in this workspace, and their role |
| Teams | Team definition, membership, leads, capacity, CAB flag — [teams.md](teams.md) |
| **Roles** | Create and edit roles — [roles UI](roles-and-permissions-ui.md) |
| Work item types | Types, icons, categories, `is_epic` / `is_change`, their workflows, their default SLA |
| States | The workspace's states and groups ([ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md)) |
| Workflows | State machines, transitions, guards, effects |
| SLA policies | Goals by type and priority; the workspace default policy |
| Service calendars | Cover windows and holidays |
| Request types | The customer-facing catalogue and per-organisation assignment |
| Custom fields | Fields and sections |
| Labels | The shared label vocabulary |
| Canned responses | Shared snippets with placeholders |
| Estimates | Point, category or time scales |
| Rates · Time activities · Cost types | [time-and-cost.md](time-and-cost.md) |
| Automations | Workspace-scope rules, optionally restricted to projects |
| Webhooks | Outbound integrations, delivery history |
| Import | Import runs |
| Danger zone | Transfer ownership, delete workspace |

## Project

Everything that varies between *engagements*.

| Screen | Owns |
| --- | --- |
| General | Name, key, icon, kind, dates, customer organisation, manager, owning team, health, default assignee, default billable, default comment visibility, cycle rollover policy |
| Members | The project roster and per-project role overrides |
| States | Which workspace states this project enables, their order, and its default |
| Labels | Project-only labels, in addition to workspace labels |
| SLA & calendar | Which policy and calendar apply (override the workspace) |
| **Features** | Per-project feature toggles |
| Automations | Rules scoped to this project |
| Budget | Planned amounts by period — [time-and-cost.md](time-and-cost.md) |
| Danger zone | Archive, delete |

## Profile

Everything that varies between *people*. Stored in `user_preference`.

| Screen | Owns |
| --- | --- |
| General | Name, avatar, job title, locale, timezone |
| Appearance | Theme, density, sidebar behaviour, default layouts — the keys `theme`, `density`, `sidebar`, `layout.<projectId>` |
| Notifications | Per-event, per-channel, per-workspace/project preferences, digest, quiet hours |
| Security | Password, MFA, passkeys, active sessions |
| API keys | Personal keys and agent configuration |

## Inheritance

- `ST-1` Feature flags resolve **project → workspace → instance → built-in default**, over
  `project_feature_flag`, `workspace_feature_flag`, `instance_feature_flag`.
- `ST-2` An instance flag marked `locked` cannot be overridden below; a write to a lower
  level for a locked flag returns 409. This is how editions are sold from one image.
- `ST-3` **Exactly these project settings inherit from the workspace, and nothing else
  does:** SLA policy (`workspace.default_sla_policy_id`), service calendar, and the
  enabled state set. An organisation's "project defaults" in God Mode are **copied onto a
  new project at creation**, never consulted afterwards — they are a template, not a level.
- `ST-4` Where a project overrides an inherited setting, the interface says so: "Inherited
  from workspace (Standard Support). Override ▾". A setting showing an inherited value with
  no indication that it is inherited is how people conclude the product is ignoring them.

## Behaviour

- `ST-5` Every settings screen shows who last changed it and when.
- `ST-6` Every settings screen has a History affordance: `GET /api/audit?entity_type=…&entity_id=…`,
  where the entity is the row the screen edits (`workspace`, `project`, `role`, `workflow`,
  …) and the capability is the screen's own.
- `ST-7` Changes take effect immediately. Where that has wide consequences — a role change,
  a workflow publish — the save dialog states the blast radius; every such `PATCH` supports
  `?dryRun=true` returning `{ affected: { people, workItems, projects } }`.
- `ST-8` Destructive settings live in a visually distinct "Danger zone" and require typing
  the name of the thing.
- `ST-9` Settings screens are ordinary routes with ordinary URLs, deep-linkable, so
  documentation and support conversations can point at them.
- `ST-10` **Moving a project between workspaces** remaps workspace-scoped configuration by
  `key`: labels, work item types, workflows, states, SLA policies and custom fields with a
  matching key in the destination are re-pointed; anything without a match is reported and
  the move is **refused** until the operator resolves it (create the missing item, or
  clear the values). No silent nulling.

## Permissions

| Action | Capability |
| --- | --- |
| Instance settings | `instance:admin` (and the narrower `instance:manage_*` where named in [god-mode.md](god-mode.md)) |
| Workspace settings | `workspace:manage_settings`; roles need `workspace:manage_roles`; members `workspace:manage_members`; danger zone `workspace:update` / `workspace:delete` |
| Project settings | `project:manage_settings`; members `project:manage_members`; danger zone `project:archive` / `project:delete` |
| Profile settings | `authenticated + self` |
| Read resolved flags | any authenticated session, for its own reach |

## Screens

Settings uses a two-column shell: a navigation rail on the left, content on the right,
following kaneo's `settings-layout`. Consistent across all four levels, so moving between
them requires no relearning. Rows in the [screen inventory](../02-design/screen-inventory.md).

## API

```
GET/PATCH /api/instance/settings                       instance:admin                 instance
GET/PATCH /api/workspaces/{id}/settings                workspace:manage_settings      workspace
GET/PATCH /api/workspaces/{id}/features                workspace:manage_settings      workspace
DELETE    /api/workspaces/{id}                         workspace:delete  E            workspace — the danger zone; → 202 pending action (typed exact name + step-up), refused while the workspace has active projects ([pending-actions.md](../01-architecture/pending-actions.md))
GET/PATCH /api/projects/{projectId}/settings           project:manage_settings        project
GET/PATCH /api/projects/{projectId}/features           project:manage_settings        project
GET/PATCH /api/me/settings                             self (kind 2 — the caller's own `user_preference` rows)
GET       /api/features/resolved?project=…             self (kind 2) — resolved for the caller's reach
GET       /api/audit?entity_type=&entity_id=           the entity's read capability (kind 1, chosen by `entity_type` from the registry)
```

`GET /features/resolved` returns the fully resolved flag set for a context, so the client
never re-implements the resolution order.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Feature disabled at instance while a project uses it | Data retained and hidden; the API returns 404 for its routes; re-enabling restores everything |
| Locked flag written at a lower level | 409 naming the lock |
| Workspace deleted with active projects | Refused. Projects must be archived or moved first |
| Project moved between workspaces | `ST-10` |
| Two administrators editing one screen | Optimistic concurrency, 409, with a diff |
| Setting removed in a release | Migration drops it and audits the change |

## Out of scope

- The content of each settings screen → its owning feature spec
- Instance-level screens → [god-mode.md](god-mode.md)

## Testing

`flag-resolution.spec.ts` (`ST-1`, `ST-2`), `locked-flag-cannot-be-overridden.spec.ts`
(`ST-2`), `inheritance-indicator.spec.ts` (`ST-3`, `ST-4`), `settings-history.spec.ts`
(`ST-6`), `dry-run-blast-radius.spec.ts` (`ST-7`), `project-move-refuses-unmapped.spec.ts`
(`ST-10`). Integration: each settings route requires its capability; a locked instance flag
cannot be overridden through a crafted request.

## Open questions

None.

## Related

- [God Mode](god-mode.md) · [Roles and permissions UI](roles-and-permissions-ui.md) · [Teams](teams.md)
- [Plugin architecture](../01-architecture/plugin-architecture.md)
