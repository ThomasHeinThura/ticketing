# SLA

- **Phase:** P2
- **Status:** ⬜
- **Feature flag:** `feature.sla`
- **Depends on:** service calendars, request types, work item types

## Purpose

Answer, for any work item: **when is this due, and are we going to make it?**

The commitment is expressed in *covered time* — hours the service is actually contracted
to be responding — not wall-clock time. A 4-hour resolution target on an 8×5 service,
raised at 16:00 on a Friday, is due at 12:00 on Monday.

## The central decision

**SLA state is never stored. It is computed on read from stored facts.**

See [ADR 0009](../01-architecture/adr/0009-lazy-sla-evaluation.md) for the full argument.
The consequences you need to know while implementing:

- Changing a policy or a calendar needs no backfill.
- A missed scan delays a *notification*, never the *truth*.
- There is one implementation, in `packages/domain/src/sla/`, used by the API, the UI,
  reports and the scan job alike.

## Concepts

| Concept | Meaning |
| --- | --- |
| **SLA policy** | A named, versioned set of goals, bound to a service calendar |
| **Goal** | (metric × work item type × priority) → target minutes |
| **Metric** | `first_response` or `resolution` |
| **Covered time** | Elapsed time counted only inside calendar windows, excluding holidays and pauses |
| **State** | `none` · `ok` · `at_risk` · `breached` · `met` · `missed` |
| **Pause** | An interval that does not consume the clock |

## States

| State | Meaning |
| --- | --- |
| `none` | No policy applies. A delivery project with no service commitment |
| `ok` | Open, under 75% of the target consumed |
| `at_risk` | Open, 75%–100% consumed. The threshold is configurable per policy |
| `breached` | Open, over 100% consumed |
| `met` | Closed within target |
| `missed` | Closed after target |

`none` is a first-class answer, not an error. Most delivery work has no SLA and the
interface should say so plainly rather than showing a meaningless zero.

## Data

`sla_policy`, `sla_policy_version`, `sla_goal`, `sla_pause`, `service_calendar`, and
`work_item_sla_cache` — the last used **only** so `sla-scan` can detect an edge and fire
an event once, and for list filtering. It is never the answer to "what is the state?"

## Behaviour

**Resolution of which policy applies**

- `SLA-1` Order: work item type override → request type → project → workspace default.
  First match wins.
- `SLA-2` If no policy resolves, state is `none`.
- `SLA-3` The **version effective at the work item's creation** is used. Changing a policy
  never rewrites whether past work was met.

**Computation**

- `SLA-4` `dueAt` = the instant at which `target_minutes` of covered time have elapsed
  since `sla_started_at` (copied from the accepted submission's `created_at`, otherwise the
  work item's `created_at` — [data-model.md](../01-architecture/data-model.md)), per the
  calendar, skipping pauses.
- `SLA-5` Covered time counts only inside the calendar's weekday windows, in the
  calendar's timezone, excluding holidays.
- `SLA-6` A 24×7 calendar makes covered time equal to wall-clock time.
- `SLA-7` `first_response` stops at the first public comment by a staff member, which sets
  `work_item.first_response_at` — the stored fact the metric is computed from.
- `SLA-8` `resolution` stops when the work item enters a state in the `completed` group.
- `SLA-9` Reopening a completed item resumes the resolution clock from where it stopped —
  it does not restart.

**Pausing**

- `SLA-10` Pausing is a **workflow transition effect**, not a policy property: the
  transition into "Waiting on customer" carries `pause_sla`, the transition out carries
  `resume_sla` — the vocabulary in [workflows.md](workflows.md) `WF-19`. A policy declares
  goals and thresholds only. *(Corrected 2026-09-05: the first draft put the pausing-state
  list on the policy, which cannot reference states and duplicated the workflow's effects.)*
- `SLA-11` `pause_sla` opens an `sla_pause` row (reason `waiting_customer`) per metric;
  `resume_sla` closes it. Entering a `completed`-group state opens one with reason
  `resolved` (`WF-17`) and reopening closes it (`WF-18`). At most one open row per
  `(work_item, metric, reason kind)`; a manual pause while an automatic one is open returns
  409, and an automatic close never closes a manual pause.
- `SLA-12` Paused intervals are subtracted from covered time.
- `SLA-13` The UI shows "Paused — waiting on customer since Tuesday" rather than a
  frozen countdown with no explanation.

**Events**

- `SLA-14` `sla-scan` runs every 5 minutes and compares computed state against
  `work_item_sla_cache`.
- `SLA-15` On a transition into `at_risk`, emit `sla.at_risk`. Into `breached`, emit
  `sla.breached`. Once each, per work item, per metric.
- `SLA-16` Events fan out to notifications, webhooks and the escalation path.
- `SLA-17` Escalation follows the project's stakeholder escalation order, waiting the
  configured interval between levels.
- `SLA-15a` `sla.met` and `sla.missed` are emitted by the **transition into a
  `completed`-group state** (`WF-17`), not by `sla-scan` — an item whose `resolved_at` is
  set is outside the scan's candidate set. `sla-scan` emits only `sla.at_risk` and
  `sla.breached` ([events.md](../01-architecture/events.md)).

**Display**

- `SLA-18` List surfaces show a compact badge: colour, icon and remaining time.
- `SLA-19` Detail shows a bar with consumed proportion, the at-risk marker, the due
  instant in the viewer's timezone, and the calendar's name.
- `SLA-20` Colour is never the only signal — see [accessibility](../02-design/accessibility.md).
- `SLA-21` Customers see their own SLA state and due time, never the policy internals.

## Permissions

| Action | Capability |
| --- | --- |
| See SLA state on a work item | `work_item:read` |
| Read policies | `sla_policy:read` |
| Create, edit, publish a policy | `sla_policy:manage` |
| Manage service calendars | `sla_policy:manage` |
| Pause or resume manually | `work_item:update` |

## Screens

Policy list, policy editor (goal matrix by type × priority), calendar editor, SLA badge
and bar primitives, SLA columns in list and table, SLA reports.

The goal editor is a matrix, not a list of forms — service desk managers think in a grid
of "for this type at this priority, this long", and giving them anything else makes
authoring miserable.

## API

```
GET   /api/sla-policies                        sla_policy:read
POST  /api/sla-policies                        sla_policy:manage
GET   /api/sla-policies/{id}                   sla_policy:read
PATCH /api/sla-policies/{id}                   sla_policy:manage
POST  /api/sla-policies/{id}/publish           sla_policy:manage
GET   /api/work-items/{key}/sla                work_item:read
POST  /api/work-items/{key}/sla/pause          work_item:update
POST  /api/work-items/{key}/sla/resume         work_item:update
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Item created outside covered hours | The clock starts at the next window opening, not at creation |
| Calendar changed while items are open | Recomputed immediately. No backfill needed |
| Priority raised mid-flight | The new goal applies from creation, so remaining time shrinks. This is intended and is why escalation is powerful |
| DST transition inside the window | Handled by evaluating in the calendar's timezone with a real timezone library, never by adding 3600 seconds |
| Holiday added retroactively | Recomputed. Deadlines move later. Warned about at save time |
| Work item moved to a project with a different policy | New policy applies from the move, computed against original creation time. Written to activity |
| Pause never closed | Alerted after 30 days; the item appears in a "stale paused" report |
| Policy deleted while in use | Refused. Must be replaced first |

## Out of scope

- Calendar definition → [service-calendars.md](service-calendars.md)
- Escalation path membership → [projects-and-engagements.md](projects-and-engagements.md)
- SLA reporting → [reports-and-dashboards.md](reports-and-dashboards.md)

## Testing

`packages/domain/src/sla/__tests__/` is the most important test suite in the product.
It must cover:

- Every state transition boundary, to the minute.
- 8×5, 12×5 and 24×7 calendars.
- Creation before, during and after a covered window.
- Weekends, single holidays, consecutive holidays, a holiday inside a pause.
- DST forward and backward transitions, in a timezone that observes them.
- Pauses: single, multiple, adjacent, overlapping (rejected), unclosed.
- Reopen after completion.
- Policy version selection for an item created before a policy change.
- Priority change mid-flight.

Integration: `sla-scan` emits each event exactly once. E2E: badge and bar render the same
values the API reports.

## Open questions

None.

## Related

- [ADR 0009](../01-architecture/adr/0009-lazy-sla-evaluation.md)
- [Service calendars](service-calendars.md) · [Background jobs](../01-architecture/background-jobs.md)
