# Information architecture

How the product is organised, and how someone finds their way around it.

The shape is kaneo's. The additions are the service desk surfaces and God Mode.

## Two applications

| | Agent workspace | Customer portal |
| --- | --- | --- |
| Origin | `ticket.<domain>` | `portal.<domain>` |
| Audience | Staff | Customers |
| Shell | Sidebar + topbar + command palette | Simplified navigation |
| Density | High — this is a working tool | Low — this is an occasional visit |

## Agent navigation

Sidebar, following kaneo's structure: workspace switcher at the top, personal surfaces,
then the project list, then settings at the bottom.

```
┌─ Workspace ▾ ──────────────┐
│                            │
│  Inbox                     │   notifications and mentions
│  My work                   │   assigned · approvals · watching
│  Triage                    │   unassigned and intake
│                            │
│  Projects              +   │
│    ▸ Contoso Support       │
│    ▸ Fabrikam Migration    │
│    ▸ Internal IT           │
│                            │
│  Views                     │   saved views, personal and team
│  Reports                   │
│  Knowledge base            │
│  Service management        │   services · changes · releases
│  Timesheet                 │
│                            │
├────────────────────────────┤
│  Settings                  │
│  God Mode                  │   only with instance:admin
└────────────────────────────┘
```

**Sections respect feature flags.** With `feature.knowledge_base` off, the entry is gone —
not greyed out, gone. A small instance shows a short sidebar; a full one shows everything.
This is Plane's best idea and it is how a feature-rich product avoids feeling heavy.

**No arbitrary cap on entries.** kaneo's shell handles a long list well: sections
collapse, the project list scrolls, and the command palette means nobody has to hunt.
What matters is that every entry earns its place and that flags remove the ones a given
deployment does not use.

## Inside a project

Tabs across the top of the project surface. Which tabs appear depends on the project's
feature flags and its kind — a managed service has no cycles.

```
Overview │ Work │ Backlog │ Cycles │ Modules │ Timeline │ Calendar │ Pages │ Settings
```

`Work` carries a layout switcher rather than being several tabs:

```
[ Board ] [ List ] [ Table ] [ Calendar ] [ Timeline ]        ← layout, in the URL
```

This is deliberate. v1 had four separate work views as separate destinations, and people
lost their filters moving between them. One destination, one filter set, switchable
layout — kaneo's model, and correct.

## Work item detail

Opens as a **side pane** over the list, and is also a **full page** at
`/agent/work-items/{key}`. Both routes exist; the pane is a presentation of the page.

v1's failure here is instructive: tickets were only reachable inside their parent list, so
there was no way to send someone a link to a ticket. Every work item has a permanent,
standalone address.

Layout, following progressive disclosure:

```
SUP-1234  ·  Printer offline in Ward 3                        [⋯]

State ▾   Assignee ▾   Priority ▾   Due ▾            ← the four that always matter
SLA: Resolution — 2h 14m remaining                   ← only if the project has SLAs

Description
Activity ─────────────────────────────────────────
  comments and changes, newest last
  [ Comment ]  ( ) Public  (•) Internal

▸ Details          custom fields, labels, watchers
▸ Relations        parent, children, blocks, relates
▸ Approvals        only if any exist or may be requested
▸ Attachments
▸ Time             only with feature.time_tracking
```

Collapsed sections remember their state per user. The header carries only what a person
needs on every visit.

## Portal navigation

```
Home            open requests, recent activity
My requests     everything they have raised
New request     the catalogue
Approvals       waiting on them
Projects        their engagements, read-mostly
Knowledge base
```

No workspace switcher. No command palette by default. No internal terminology anywhere —
customers see "request", never "work item"; "in progress", never a state group name.

## Settings hierarchy

Three levels, following Plane, with clear ownership at each.

| Level | Path | Owns |
| --- | --- | --- |
| **Profile** | `/agent/settings/profile/*` | Account, appearance, notifications, security, sessions, API keys |
| **Workspace** | `/agent/settings/*` | Members, teams, **roles**, work item types, workflows, SLA policies, service calendars, request types, custom fields, labels, estimates, integrations, webhooks, import |
| **Project** | `/agent/projects/{key}/settings/*` | General, members, states, features, labels, automations, SLA binding, danger zone |
| **Instance** | `/agent/god-mode/*` | Everything about the deployment |

Detail: [Settings hierarchy](../03-features/settings-hierarchy.md).

## God Mode

A route group inside the agent application, gated by `instance:admin` — not a separate
application as it is in Plane, because a separate application means separate auth,
separate deployment and separate design drift.

```
General          instance name, locale, timezone, retention
Branding         name, logos, colours, login background
Authentication   identity providers, MFA policy, session policy
Organisations    tenants, quotas, portal access
Storage          object storage backend
Notifications    channels: SMTP, webhooks (core); more as built
Features         instance-wide feature flags and locks
Jobs             schedules, run history, manual trigger
Plugins          everything configurable, in one list
Audit            the instance audit log
Health           dependency and plugin status
Import           import runs and history
```

## URL scheme

Every screen has an address. Filters, layout, tab and selection are URL state.

```
/agent
/agent/inbox
/agent/my-work?lens=assigned|approvals|watching
/agent/triage?queue={id}
/agent/projects/{key}
/agent/projects/{key}/work?layout=board&state=started&assignee=me
/agent/projects/{key}/backlog
/agent/projects/{key}/cycles/{cycleId}
/agent/work-items/{key}?tab=activity
/agent/views/{viewId}
/agent/reports/{reportKey}?window=30d
/agent/kb/{articleId}
/agent/settings/roles/{roleId}
/agent/projects/{key}/settings/states
/agent/god-mode/authentication

/portal
/portal/requests?status=open
/portal/requests/{ref}
/portal/new?type={requestTypeKey}
/portal/approvals
/portal/projects/{key}
/portal/kb/{articleId}
```

`lib/routes.ts` is the single declaration of these, with a round-trip test asserting that
every route builds and parses. A screen not in the registry does not exist.

## Search

`⌘K` opens the command palette, which does three things at once: navigate to a screen,
run an action, or search work items, projects, people and articles. This is the escape
hatch that makes a large navigation tree survivable.

`/` focuses the in-context search on list surfaces.

## Naming in the interface

| Internal | Agent UI | Portal UI |
| --- | --- | --- |
| Work item | Ticket / Task, per its type | Request |
| Organisation | Customer | *(never shown)* |
| Engagement | Project / Service | Project / Service |
| State | Status | Status |
| Capability | Permission | *(never shown)* |
| Reach | Access | *(never shown)* |

The glossary governs code and documentation. The interface uses the words the audience
uses.

## Related

- [Design principles](design-principles.md) · [Screen inventory](screen-inventory.md)
- [Settings hierarchy](../03-features/settings-hierarchy.md) · [God Mode](../03-features/god-mode.md)
