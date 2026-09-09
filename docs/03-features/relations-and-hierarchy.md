# Relations and hierarchy

- **Stage:** P1
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** work items

## Purpose

Express how pieces of work relate. Two mechanisms, deliberately separate.

**Hierarchy** is containment: this work is *part of* that work. One parent, many children.

**Relations** are typed links between peers: this *blocks* that, this *duplicates* that.
Many to many.

Conflating them — as tools that model "parent" as just another link type do — makes
roll-up progress and tree views impossible to compute reliably. OpenProject separates them
and is right to.

## Relation types

| Type | Meaning | Inverse |
| --- | --- | --- |
| `relates` | Loosely connected | `relates` (symmetric) |
| `blocks` | This must complete before that can proceed | `blocked_by` |
| `duplicates` | This is the same request as that | `duplicated_by` |
| `precedes` | This should be scheduled before that | `follows` |
| `requires` | This needs that to exist | `required_by` |

- `RH-1` Every relation is stored once and rendered from both ends with the correct label.
- `RH-2` `relates` is symmetric; the rest are directional.
- `RH-3` Relations may cross projects, within the same workspace.
- `RH-4` A relation to a work item outside the viewer's reach shows as "1 related item you
  cannot see" — the count, never the key or title.

## Data

`work_item_relation`, `work_item.parent_id`. See
[data model](../01-architecture/data-model.md).

## Hierarchy

- `RH-5` One parent, any number of children.
- `RH-6` Parent and child must be in the same project.
- `RH-7` Maximum depth 5.
- `RH-8` Cycles are rejected — a work item cannot be its own ancestor, at any distance.
- `RH-9` A parent displays rolled-up progress as defined once in `WI-19` — whole subtree,
  "completed" meaning a child's mapped `state_template.group in ('completed',
  'cancelled')`, resolved through its `state.state_template_id` (`state` itself carries no
  `group` — [data model](../01-architecture/data-model.md) §3/§4) — plus rolled-up estimate
  and logged time where those features are enabled. `RH-14` uses the same definition.
- `RH-10` Closing a parent with open children warns and lists them. It does not cascade.
- `RH-11` Deleting a parent orphans its children rather than deleting them. The user is
  told exactly this before confirming.
- `RH-12` Moving a parent between projects offers to move its children too. Declining
  **detaches** the children — they stay in the old project with no parent, and the parent
  link is removed — so `RH-6` always holds. This is stated plainly before confirming.

## Epics

- `RH-13` A work item type marked `is_epic` is a hierarchy root: it may have children but
  no parent. `is_epic` is the only type-level parentage constraint — every other type,
  Sub-task included, may appear at any level up to the depth-5 cap (`RH-7`); nothing else
  about a type restricts where it sits in the tree.
- `RH-14` An epic shows aggregate progress across its whole subtree, not just direct
  children.
- `RH-15` Epics are the unit of the epic/initiative roll-up in reporting.

## Blocking behaviour

- `RH-16` A workflow guard (`no_open_blockers`, [workflows.md](workflows.md) `WF-15`) may
  require that no `blocked_by` relation points at an open work item — "open" meaning its
  mapped `state_template.group not in ('completed', 'cancelled')`, resolved through
  `state.state_template_id`, never a state name and never a bare `state.group` column.
- `RH-17` A blocked work item shows a badge and lists what is blocking it.
- `RH-18` When the last blocker closes, the assignee of the blocked item is notified via
  the `work_item.unblocked` event ([events.md](../01-architecture/events.md)).
- `RH-19` Blocking cycles — A blocks B, B blocks A — are permitted at creation but
  detected and surfaced as a warning on both, because they usually indicate a real
  planning problem rather than a data error.

## Permissions

| Action | Capability | Extra rules |
| --- | --- | --- |
| Read relations / tree | `work_item:read` | Reach checked on each end independently — why the hidden-relation count in `RH-4` exists |
| Create / remove a relation | `work_item:update` | Required on **both** work items |
| Set / clear a parent | `work_item:update` | Required on **both** ends, including detach — it mutates the former parent's roll-up too |

## Screens

A relations section on the work item detail, grouped by type, each entry showing key,
title, state and assignee. An "Add relation" affordance opens a searchable picker with
type selection.

The tree of parent and children renders inline, with the current item highlighted, so the
context is visible without navigating away.

## API

```
GET    /api/work-items/{key}/relations         work_item:read
POST   /api/work-items/{key}/relations         work_item:update (both ends)
DELETE /api/work-items/{key}/relations/{id}    work_item:update (both ends)
POST   /api/work-items/{key}/parent            work_item:update (both ends)
DELETE /api/work-items/{key}/parent            work_item:update (both ends) — detaching mutates the former parent's roll-up too
GET    /api/work-items/{key}/tree               work_item:read
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Duplicate relation added twice | Idempotent — no second row, no error |
| Relation to a deleted work item | Hidden while the item is soft-deleted (`WI-21`'s 30-day window), not removed; removed only at purge. Restoring the item within the window restores its relations too |
| Both directions of a directional relation added | The second is recognised as the inverse and rejected as a duplicate |
| Self-relation | Rejected at 422 |
| Parent set to a descendant | Rejected — cycle detection |
| 200 children on one parent | The list paginates; roll-up is computed in SQL |
| Cross-project relation, project later moved to another workspace | Cannot happen: `project.workspace_id` is set at creation and no route changes it — a project never moves between workspaces. Relations only ever cross projects within the workspace they share (`RH-3`) |

## Out of scope

- The work item entity, its fields and its own lifecycle rules → [work-items.md](work-items.md)
- Guard evaluation and the workflow engine that consumes `RH-16` → [workflows.md](workflows.md)
- Delivery of the `work_item.unblocked` notification (`RH-18`) → [notifications.md](notifications.md)

## Testing

Unit: cycle detection at every depth; inverse label rendering; roll-up arithmetic.

Integration: a relation to an out-of-reach item returns a count without identifying
details; creating a relation requires update on both ends.

E2E: build a three-level tree, verify roll-up, close a blocker and see the blocked item's
badge clear.

## Open questions

None.

## Related

- [Work items](work-items.md) · [Workflows](workflows.md) · [Agile](agile.md)
