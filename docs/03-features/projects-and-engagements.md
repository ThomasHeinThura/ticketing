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

## Data

`project`, `project_feature_flag`, `state` (project-scoped; each row maps to a
workspace-scoped `state_template`, `PR-17`), `milestone`, `prerequisite`, `stakeholder`,
`document_link`, `membership` (project-scoped roster rows). See
[data model](../01-architecture/data-model.md) for full columns.

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

From v1. Validated at save. Every rule below is **warning**-only by default — the save
succeeds and the violation appears as a persistent banner on the project overview —
except where marked **blocking**, which refuses the save (`422`) naming the failing rule.
`PR-9` is the one blocking rule: a managed service's SLA cannot be computed at all without
a calendar, which is a technical impossibility rather than a stylistic preference. Every
other rule below already has its blocking/warning behaviour confirmed by the edge-case
table further down.

- `PR-6` **(warning)** A project must have exactly one project manager
  (`project.manager_id → person`; see [data model](../01-architecture/data-model.md)).
- `PR-7` **(warning)** A project must have at least one team member.
- `PR-8` **(structural — not a save-time check)** Staff and customer access can never be
  mixed on one project's roster. This needs no validation because it cannot occur: the
  `customer` role is the one system role scoped to `organisation`
  ([rbac.md](../01-architecture/rbac.md)); every other built-in role is scoped to
  `workspace` or `project`; and a `membership` row carries exactly one `role_id`. A
  project-scoped `membership` can therefore never hold the `customer` role, and there is
  nothing for this rule to warn about or block.
- `PR-9` **(blocking)** A managed service must have a support level and a service
  calendar.
- `PR-10` **(warning)** A project must have a start date; an end date is optional.

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

- `PR-13` A project key is 2–8 uppercase characters, unique per instance (enforced by
  `create unique index on project (key)` — [data model](../01-architecture/data-model.md)),
  and becomes the prefix of every work item key.
- `PR-14` Renaming a key is allowed but discouraged; existing work items keep the old
  prefix and a warning explains this before confirming.
- `PR-15` Archiving (`project.archived_at`) hides a project from navigation and makes its
  work read-only. Data is retained.
- `PR-16` Deletion is soft for 30 days (`project.deleted_at`), then purges work items,
  comments, attachments and time entries. `archived_at` and `deleted_at` are independent
  columns: archiving does not start the 30-day purge timer, and a project need not be
  archived before it can be deleted. The default project list excludes rows where either
  is set; an explicit filter reveals archived or deleted projects.
- `PR-17` State **templates** are defined once per **workspace** (`state_template`); each
  project owns its own concrete **states** (`state`), each mapped to exactly one
  template, with their own order and default, seeded from the workspace's default
  templates on creation and editable thereafter on Project settings → States. A project
  cannot create a concrete state for a template its types' workflows have no transition
  out of. See [ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md) and
  [workflows.md](workflows.md) `WF-2`.
- `PR-18` Feature flags are per project, so a simple project shows a simple interface.
- `PR-19` A project serves exactly one customer organisation, which determines who can see
  it in the portal. `project.organisation_id` is **nullable**: null means an internal
  project with no customer organisation, and it never appears in the portal — there is no
  organisation for a portal session to match against ([data model](../01-architecture/data-model.md)).
- `PR-20` **Deleting a project is a pending action**
  ([pending-actions.md](../01-architecture/pending-actions.md)): `DELETE /api/projects/{projectId}`
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
| Edit settings | `project:manage_settings` — never `parent_id` or `owner_team_id` |
| Manage members; re-parent; change owning team | `project:manage_members` — the two reach-affecting fields (`parent_id`, `owner_team_id`) go through `PATCH /api/projects/{projectId}/ownership`, not the general settings route ([rbac.md](../01-architecture/rbac.md)) |
| Manage stakeholders, milestones, prerequisites, document links; set health | `project:update` |
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
GET    /api/projects                                          project:read
POST   /api/projects                                          project:create
GET    /api/projects/{projectId}                              project:read
PATCH  /api/projects/{projectId}                              project:manage_settings  — never parent_id or owner_team_id
PATCH  /api/projects/{projectId}/ownership                    project:manage_members   — parent_id and/or owner_team_id only; re-parenting requires it on both the child and the prospective parent
POST   /api/projects/{projectId}/archive                      project:archive
DELETE /api/projects/{projectId}                              project:delete  E  → 202 pending action (typed key + step-up; PR-20)
GET    /api/projects/{projectId}/members                      project:read
POST   /api/projects/{projectId}/members                      project:manage_members
PATCH  /api/projects/{projectId}/members/{personId}           project:manage_members   — role change
DELETE /api/projects/{projectId}/members/{personId}           project:manage_members
GET    /api/projects/{projectId}/stakeholders                 project:read
POST   /api/projects/{projectId}/stakeholders                 project:update
PATCH  /api/projects/{projectId}/stakeholders/{id}            project:update
POST   /api/projects/{projectId}/stakeholders/{id}/stand-down project:update           — PR-12: stood down, never deleted
GET    /api/projects/{projectId}/milestones                   project:read
POST   /api/projects/{projectId}/milestones                   project:update
PATCH  /api/projects/{projectId}/milestones/{id}              project:update
DELETE /api/projects/{projectId}/milestones/{id}              project:update
GET    /api/projects/{projectId}/prerequisites                project:read
POST   /api/projects/{projectId}/prerequisites                project:update
PATCH  /api/projects/{projectId}/prerequisites/{id}           project:update
DELETE /api/projects/{projectId}/prerequisites/{id}           project:update
GET    /api/projects/{projectId}/document-links               project:read
POST   /api/projects/{projectId}/document-links               project:update
DELETE /api/projects/{projectId}/document-links/{id}          project:update
GET    /api/projects/{projectId}/health                       project:read
PATCH  /api/projects/{projectId}/health                       project:update
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
