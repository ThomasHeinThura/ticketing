# Projects and engagements

- **Stage:** P1 (delivery structure in P2)
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** workspaces, RBAC, organisations

## Purpose

The container for work, and the unit at which access, workflow, SLA and reporting are
scoped.

## Two kinds

v1's most useful structural idea, and worth keeping deliberately.

| | **Project** | **Managed service** |
| --- | --- | --- |
| Duration | Has a start and an end | Runs indefinitely |
| Planning | Backlog, cycles, milestones | No cycles |
| Commitment | Delivery dates | Support level and cover window |
| Typical work | Epics, stories, tasks | Incidents, service requests |
| Health | RAG, set by the PM | RAG, set by the service owner |

They share one table and one work surface. The difference is `kind`, which drives which
tabs appear and which fields are required.

Conflating them produces a product that is bad at both: a support queue with a burndown
chart, or a delivery project with an SLA it can never meet.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Project** | The container. Belongs to a workspace, serves a customer organisation |
| **Parent** | A project may have a parent, forming a hierarchy |
| **Roster** | The people who are members of this project |
| **Stakeholder** | Someone on the escalation path, with or without a login |
| **Milestone** | A dated marker — kick-off, go-live, quarterly review |
| **Prerequisite** | Something that must be true before work can proceed, with an owner |

## Hierarchy

Borrowed from OpenProject.

- `PR-1` A project may have one parent. Depth is capped at 4.
- `PR-2` Members of a parent project are **inherited** by its children, with
  `inherited_from` recording where the membership came from.
- `PR-3` Inherited members can be given a different role on the child, which overrides.
- `PR-4` An inherited membership cannot be removed on the child; it is removed at the
  parent.
- `PR-5` A parent aggregates its descendants' work for reporting, and can display a
  combined board.

This gives portfolio and programme structure without a separate "portfolio" concept.

## Composition rules

From v1. Validated at save, warned about rather than blocked where reasonable.

- `PR-6` A project must have exactly one project manager.
- `PR-7` A project must have at least one team member.
- `PR-8` Staff and customer roles cannot be mixed in the same membership.
- `PR-9` A managed service must have a support level and a service calendar.
- `PR-10` A project must have a start date; an end date is optional but warned about.

Rule violations appear as a persistent banner on the project overview rather than blocking
work, because half-configured projects exist in reality and blocking them makes people
work around the tool.

## Engagement structure

Present on both kinds, more used on projects.

**Summary** — objective, in scope, out of scope, success criteria, health (RAG, set by a
person not computed), status note with a timestamp.

**Milestones** — name, date, reached. The current milestone is derived as the first not
yet reached.

**Prerequisites** — title, owner (us / customer / both), due date, blocking flag,
completed. Counted on the overview.

- `PR-11` A customer cannot tick off a prerequisite. This is deliberate: the point of the
  list is that a named person is chasing it. *(v1's reasoning, and it is sound.)*

**Stakeholders** — a person, a role, an escalation order and a wait interval. Separate
from membership, because someone can be on the escalation path at 2am without having a
login.

- `PR-12` A stakeholder may be stood down without deletion, removing them from counts and
  pickers while preserving history.

**Documents** — links to external systems. Links, never copies, so they cannot go stale.
Customer visibility is off by default.

## Behaviour

- `PR-13` A project key is 2–8 uppercase characters, unique per instance, and becomes the
  prefix of every work item key.
- `PR-14` Renaming a key is allowed but discouraged; existing work items keep the old
  prefix and a warning explains this before confirming.
- `PR-15` Archiving hides a project from navigation and makes its work read-only. Data is
  retained.
- `PR-16` Deletion is soft for 30 days, then purges work items, comments, attachments and
  time entries.
- `PR-17` States are defined once per **workspace** (`state`); each project enables an
  ordered subset with its own default (`project_state`), seeded from the workspace's
  default set on creation and editable thereafter on Project settings → States. A project
  cannot enable a state its types' workflows have no transition out of. See
  [ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md).
- `PR-18` Feature flags are per project, so a simple project shows a simple interface.
- `PR-19` A project serves exactly one customer organisation, which determines who can see
  it in the portal.
- `PR-20` **Deleting a project is a pending action**
  ([pending-actions.md](../01-architecture/pending-actions.md)): `DELETE /api/projects/{key}`
  returns `202`; the dialog shows the affected work items, members, attachments and
  integrations and the 30-day recovery / purge behaviour (`PR-16`); the requester approves
  with the **typed project key + step-up**. The same applies from the API and from MCP; a
  service key cannot request it (`PA-5`). Archiving (`PR-15`) is not a deletion and needs no
  pending action.

## Permissions

| Action | Capability |
| --- | --- |
| See | `project:read` + reach |
| Create | `project:create` |
| Edit settings | `project:manage_settings` |
| Manage members | `workspace:manage_members` |
| Manage stakeholders, milestones, prerequisites | `project:update` |
| Archive | `project:archive` |
| Delete | `project:delete` — a **pending action**: typed project key + step-up, approved by the requester in the browser ([pending-actions.md](../01-architecture/pending-actions.md)) |

## Screens

Project overview, work surface, plan (milestones and prerequisites), stakeholders, and the
settings group. See [screen inventory](../02-design/screen-inventory.md).

The overview is the screen a project manager opens every morning. It shows health, current
milestone, blocking prerequisites, SLA state summary, open work by state, and recent
activity — and nothing else.

## API

```
GET    /api/projects                              project:read
POST   /api/projects                              project:create
GET    /api/projects/{key}                        project:read
PATCH  /api/projects/{key}                        project:manage_settings
POST   /api/projects/{key}/archive                project:archive
DELETE /api/projects/{key}                        project:delete  E  → 202 pending action (typed key + step-up; PR-20)
GET    /api/projects/{key}/members                project:read
POST   /api/projects/{key}/members                workspace:manage_members
GET    /api/projects/{key}/stakeholders           project:read
POST   /api/projects/{key}/stakeholders           project:update
GET    /api/projects/{key}/milestones             project:read
GET    /api/projects/{key}/prerequisites          project:read
GET    /api/projects/{key}/health                 project:read
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Project moved to a different parent | Inherited memberships recalculated; a preview shows who gains and loses access |
| Parent archived with active children | Refused. Children must be archived first |
| Customer organisation changed | Portal visibility changes immediately; strongly warned |
| Key collides | Refused at 409 with a suggestion |
| Project with no members | Allowed; the composition banner says so |
| Managed service with no calendar | Refused — SLA cannot be computed without one |
| 4-level hierarchy with a 5th attempted | Refused with an explanation |

## Out of scope

- Cycles and modules → [agile.md](agile.md)
- SLA binding → [sla.md](sla.md)
- Time and budget → [time-and-cost.md](time-and-cost.md)

## Testing

Unit: composition validation; hierarchy depth; inherited membership resolution.

Integration: reach through inherited membership; archiving cascades correctly; a customer
sees only projects serving their organisation.

E2E: create a project, add members, set milestones, observe the composition banner clear
as rules are satisfied.

## Open questions

None.

## Related

- [Multi-tenancy](../01-architecture/multi-tenancy.md) · [RBAC](../01-architecture/rbac.md)
- [Settings hierarchy](settings-hierarchy.md)
