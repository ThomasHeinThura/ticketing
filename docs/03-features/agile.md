# Cycles, modules and estimates

- **Phase:** P5
- **Status:** ⬜
- **Feature flags:** `feature.cycles`, `feature.modules`, `feature.estimates`
- **Depends on:** work items, projects

## Purpose

Agile planning for delivery projects. Taken from Plane, which models this cleanly.

All three are **off by default** and enabled per project. A support queue should never see
a burndown chart, and a managed service has no cycles at all.

---

## Cycles

A time-boxed period of work. Sprint, iteration, week — the name is configurable per
workspace.

- `CY-1` A cycle belongs to a project and has a name, a start date and an end date.
- `CY-2` Cycles may not overlap within a project. Overlapping sprints are a planning
  smell, and permitting them makes every velocity number meaningless.
- `CY-3` Status is derived from dates: `upcoming`, `active`, `completed`. It is not stored
  and cannot be set by hand.
- `CY-4` A work item belongs to at most one cycle.
- `CY-5` Adding to a cycle is drag-and-drop from the backlog, or bulk from any list.
- `CY-6` On completion, incomplete items are handled per the project's setting: move to the
  next cycle, move to the backlog, or leave in place. The choice is presented at
  completion, with the default pre-selected.
- `CY-7` A cycle shows: scope in points or count, completed, in progress, not started, a
  burndown, and scope changes since start.
- `CY-8` **Scope change is tracked and displayed.** Items added after the cycle started are
  marked. Silent scope creep is the thing sprint tracking exists to reveal.
- `CY-9` Velocity is the mean completed points over the last three completed cycles, and is
  shown as "insufficient data" until three exist. Never extrapolated from one.

## Modules

A grouping of work by feature or theme, independent of time. OpenProject calls these
versions; Jira calls them components; Plane calls them modules.

- `MO-1` A module belongs to a project and has a name, a lead, an optional target date and
  a status.
- `MO-2` A work item may belong to at most one module.
- `MO-3` Modules and cycles are orthogonal. An item can be in a cycle and a module.
- `MO-4` A module shows progress, remaining work and, where a target date exists, whether
  the current rate will meet it — expressed as a range, not a false-precision date.

## Estimates

- `ES-1` A project uses at most one estimate system, chosen from three:

  | System | Values |
  | --- | --- |
  | `points` | Fibonacci by default, editable: 1, 2, 3, 5, 8, 13, 21 |
  | `categories` | Named sizes: XS, S, M, L, XL |
  | `time` | Durations: 1h, 2h, 4h, 1d, 2d, 1w |

- `ES-2` Points are **stored as a reference to an estimate point row**, not as a raw
  number, so renaming or rescaling the system does not rewrite history.
- `ES-3` Changing a project's estimate system is allowed. Existing estimates map where an
  equivalent exists and are cleared where none does, with a preview of what will be lost
  before confirming.
- `ES-4` A parent's estimate rolls up from its children when the parent has none of its
  own. Where both exist, the parent's own estimate is shown with the roll-up beside it,
  because a discrepancy is information.
- `ES-5` Estimates are optional per work item. Reports say how much of a cycle is
  unestimated rather than treating unestimated as zero.

## Permissions

| Action | Capability |
| --- | --- |
| See cycles and modules | `project:read` |
| Create, edit, delete | `project:manage_settings` |
| Add or remove work items | `work_item:update` |
| Configure the estimate system | `project:manage_settings` |
| Set an estimate | `work_item:update` |

## Screens

Cycles list; cycle detail with board, burndown and scope-change log; modules list; module
detail; estimate configuration under project settings; the estimate control on the work
item.

The cycle detail is a normal work surface with a burndown above it — not a separate,
lesser board. People plan and execute in the same place.

## API

```
GET    /api/projects/{key}/cycles              project:read
POST   /api/projects/{key}/cycles              project:manage_settings
GET    /api/cycles/{id}                        project:read
PATCH  /api/cycles/{id}                        project:manage_settings
POST   /api/cycles/{id}/complete               project:manage_settings
POST   /api/cycles/{id}/work-items             work_item:update
GET    /api/cycles/{id}/burndown               project:read
GET    /api/projects/{key}/modules             project:read
POST   /api/projects/{key}/modules             project:manage_settings
GET    /api/projects/{key}/estimates           project:read
PATCH  /api/projects/{key}/estimates           project:manage_settings
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Cycle created overlapping another | Refused, with the conflicting cycle named |
| Work item moved to another project while in a cycle | Removed from the cycle; the user is warned first |
| Cycle completed with everything incomplete | Allowed. Burndown records it honestly |
| Estimate system changed mid-cycle | Warned; the burndown notes the discontinuity rather than pretending it did not happen |
| Cycle with no work items | Burndown shows "no scope" |
| Feature disabled while cycles exist | Cycles hidden, data retained, restored on re-enable |
| Item added to a cycle after it ended | Allowed for backfill, marked as retrospective |

## Out of scope

- Cross-project cycles — a cycle belongs to one project
- Capacity-based sprint planning → [time-and-cost.md](time-and-cost.md)
- Automatic sprint rollover

## Testing

Unit: overlap detection; status derivation from dates; burndown arithmetic including scope
change; velocity requiring three cycles; estimate roll-up.

Integration: cycle completion moves items per the chosen policy; estimate system change
preview matches the result.

E2E: create a cycle, drag items in, complete it, confirm the burndown and scope-change log.

## Related

- [Work items](work-items.md) · [Views](views.md) · [Reports](reports-and-dashboards.md)
