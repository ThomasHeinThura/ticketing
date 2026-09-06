# Work items

- **Stage:** P1
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** projects, states, RBAC

## Purpose

The universal unit of work. A support ticket, a bug, a story, an epic, a change request
and a task are all work items differing only by **type**. One table, one detail screen,
one permission model, one activity stream.

v1 had this right and it is worth restating: separate "ticket" and "task" entities force
duplicated views, duplicated search, duplicated reporting, and an eventual "link a ticket
to a task" feature that nobody enjoys using.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Work item** | The record |
| **Type** | Determines fields, workflow and SLA policy. Configurable per workspace |
| **Key** | `PROJ-123`. Human-readable, unique per instance, permanent |
| **State** | Position in the type's workflow. Belongs to a state group |
| **Priority** | Urgent / High / Medium / Low |
| **Position** | Fractional rank within a state or backlog, for manual ordering |

## Default types

Seeded per workspace, all editable.

| Category | Types |
| --- | --- |
| Service | Incident · Service Request · Change · Problem |
| Delivery | Epic · Story · Task · Bug · Sub-task |

A type carries: name, icon, colour, category, its workflow, its default SLA policy,
whether it is an epic, and which custom fields apply.

## Data

`work_item`, `work_item_type`, `work_item_relation`, `watcher`, `label`,
`work_item_label`. See [data model](../01-architecture/data-model.md).

## Behaviour

**Creation**

- `WI-1` Every work item belongs to exactly one project and has exactly one type.
- `WI-2` The key is `{project.key}-{number}`, where `number` comes from
  `project.last_work_item_number` incremented in the same transaction. Never reused, even
  after deletion.
- `WI-3` Title is required, 1–500 characters. Everything else is optional unless a custom
  field is marked required for that type.
- `WI-4` Initial state is the project's default state (`project_state.is_default`), which
  must be a state the type's workflow can leave — validated when the default is set.
- `WI-5` Creating from a template copies title, description, labels, custom field values
  and checklist, but never assignee or dates.

**Editing**

- `WI-6` Every field change writes an `activity` row with the old and new value.
- `WI-7` Concurrent edits use optimistic concurrency on `version`. A mismatch returns 409
  with both versions so the UI can offer a resolution.
- `WI-8` Title, description, priority, dates, labels and custom fields may be changed by
  anyone with `work_item:update` on the project.
- `WI-9` State changes go through the workflow — see [workflows](workflows.md). They are
  never a plain field update.
- `WI-10` Assignment follows [assignment rules](assignment.md).

**Ranking**

- `WI-11` Manual ordering uses fractional positions, so inserting between two items
  changes one row, not many.
- `WI-12` Positions rebalance in the background when the gap between neighbours becomes
  too small to bisect.
- `WI-13` Customers may re-rank only work items in their own organisation's backlog.

**Hierarchy**

- `WI-14` A work item may have one parent and any number of children.
- `WI-15` Parent and child must be in the same project. Moving a parent without its
  children **detaches** them (`RH-12`) — the invariant never breaks.
- `WI-16` Cycles are rejected — a work item cannot be its own ancestor.
- `WI-17` Depth is capped at 5 levels.
- `WI-18` Closing a parent does not close its children. Attempting to warns and lists the
  open children.
- `WI-19` A parent shows rolled-up progress over its **whole subtree**: items whose
  `state.group in ('completed', 'cancelled')` / total — defined once here; `RH-9` and
  `RH-14` cite it.

**Deletion and archiving**

- `WI-20` Archiving hides an item from views but preserves it and its history.
- `WI-21` Deletion is soft for 30 days, then purged with its comments, activity and
  attachments.
- `WI-22` Deleting a parent orphans its children rather than cascading. The user is told.
- `WI-23` Deletion requires `work_item:delete` and goes through a **pending action**
  ([pending-actions.md](../01-architecture/pending-actions.md)): `DELETE` returns `202`,
  the dialog shows key, title, project, requester/portal-visibility impact and the 30-day
  recovery period, and the requesting person approves in the browser. A bulk deletion
  additionally requires the typed affected count. The same applies from the API and from
  MCP — nothing is deleted without the approval, and a model cannot supply it.

**Bulk operations**

- `WI-24` Multi-select supports: change state, assign, set priority, add/remove label,
  move to cycle or module, archive, delete.
- `WI-25` Bulk operations are transactional per item, not per batch: 47 of 50 succeeding
  reports 3 failures with reasons rather than rolling everything back.
- `WI-26` Bulk operations respect workflow legality per item — an illegal transition for
  one item does not block the other 49.
- `WI-27` Bulk operations write one audit row per item plus one summary row.

**Watchers**

- `WI-28` Anyone with read access may watch. Watchers receive notifications per their
  preferences.
- `WI-29` Assignee and requester are watchers implicitly and may opt out.

## Permissions

| Action | Capability | Extra rules |
| --- | --- | --- |
| Read | `work_item:read` | Plus reach on the project |
| Create | `work_item:create` | |
| Update fields | `work_item:update` | |
| Change state | `work_item:transition` | Plus workflow legality for the role |
| Assign | `work_item:assign` | Plus [assignment rules](assignment.md) |
| Set priority | `work_item:set_priority` | |
| Escalate priority only | `work_item:escalate_priority` | The customer capability |
| Re-rank | `work_item:rank` | Customers: own organisation only |
| Delete | `work_item:delete` | Pending action — explicit click; bulk additionally requires the typed count (`WI-23`) |
| Archive | `work_item:update` | |

## Screens

Board, list, table, detail page, detail side pane, create dialog, bulk edit bar.
See [screen inventory](../02-design/screen-inventory.md).

The detail view follows progressive disclosure strictly: state, assignee, priority and due
date in the header; description and activity in the body; everything else in collapsible
sections. v1's twenty-plus-field header is the specific mistake being avoided.

## API

```
GET    /api/projects/{projectId}/work-items       work_item:read
POST   /api/projects/{projectId}/work-items       work_item:create
POST   /api/work-items/search                     work_item:read
GET    /api/work-items/{key}                      work_item:read
PATCH  /api/work-items/{key}                      work_item:update
DELETE /api/work-items/{key}                      work_item:delete
POST   /api/work-items/{key}/transition           work_item:transition
POST   /api/work-items/{key}/assign               work_item:assign
POST   /api/work-items/{key}/rank                 work_item:rank
POST   /api/work-items/{key}/watch                work_item:read
DELETE /api/work-items/{key}/watch                work_item:read
POST   /api/work-items/bulk                       work_item:read  (workspace) — then each item is re-checked against its own capability; failures reported per WI-25
GET    /api/work-items/{key}/activity             work_item:read
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Project key renamed | Existing keys keep the old prefix. Renaming is discouraged and warns |
| Moved to another project | Key is retained. A redirect alias is created so old links work |
| Type changed | Allowed. State maps to the new workflow's default if the current state does not exist there. Written to activity |
| Assignee leaves | Assignment retained and shown as "(inactive)". Not silently unassigned |
| Custom field deleted | Values retained but hidden. Restorable for 30 days |
| Title of 500 characters | Truncated with ellipsis in lists, full in detail and in the tooltip |
| 10,000 items in one project | Board virtualises. List paginates. Table virtualises |
| Two people drag the same card | Last write wins on position; both see the result via WebSocket |

## Out of scope

- SLA behaviour → [sla.md](sla.md)
- State transition rules → [workflows.md](workflows.md)
- Custom field definitions → [custom-fields.md](custom-fields.md)
- Comments → [comments-and-activity.md](comments-and-activity.md)

## Testing

**Unit** — key generation and uniqueness; fractional ranking including rebalance;
hierarchy cycle detection; depth cap.

**Integration** — create/update/delete with policy; optimistic concurrency 409; bulk
partial failure; cross-project move with alias.

**E2E** — create from board; drag between columns; open detail from list and from URL;
bulk assign; keyboard-only creation and state change.

**Performance** — board with 200 items renders under 500 ms; table with 500 rows renders
under 500 ms.

## Open questions

None.

## Related

- [Views](views.md) · [Workflows](workflows.md) · [Assignment](assignment.md)
- [Relations and hierarchy](relations-and-hierarchy.md)
- [ADR 0011 — one generic lifecycle engine](../01-architecture/adr/0011-ticket-lifecycle-engine.md)
