# Time and cost

- **Stage:** P5
- **Status:** ⬜
- **Feature flags:** `feature.time_tracking`, `feature.cost_tracking`
- **Depends on:** work items, projects, people

## Purpose

Know how long work took, what it cost, and whether that was within budget.

Two separate concerns, deliberately modelled separately — OpenProject's design, and it is
right.

| | Time entry | Cost entry |
| --- | --- | --- |
| Records | Hours worked by a person | Money or units consumed |
| Rate | The person's hourly rate | The cost type's rate |
| Example | 2 hours of engineering | 3 licences, 400 km of travel |

A system that models cost as "hours × rate" cannot express a licence purchase, and a
system that models time as money cannot express unbilled effort.

## Time entries

- `TC-1` A time entry belongs to a work item, a person and a date, and records integer
  **minutes**. Never a float — floating-point hours accumulate rounding errors that
  eventually appear on an invoice.
- `TC-2` An activity type — Development, Support, Meeting, Travel — is required, so time
  can be analysed by kind.
- `TC-3` A `billable` flag defaults from the project's `default_billable` value (default
  `true`; see [project data](../01-architecture/data-model.md#3-projects-and-states)).
- `TC-4` Entries may be logged for a past date up to the workspace's
  `time_entry_backdate_limit_days` setting (default 30 days). Logging beyond that limit
  requires `time_entry:log_backdated`.
- `TC-5` A person edits their own entries with `time_entry:update_own`; editing anyone else's
  requires `time_entry:update_any`. Deleting own and others' entries requires
  `time_entry:delete_own` and `time_entry:delete_any`, respectively.
- `TC-6` A timer is offered — start and stop — and its persisted running state survives a
  page reload. There is at most one running timer per person; the server caps it at 12 hours
  through the stop handler and a sweeper. Manual entry is always available, because most
  people log time at the end of the day.
- `TC-7` Entries roll up to the work item, its parent chain, its cycle, its module and its
  project.

## Rates

- `TC-8` `hourly_rate` is keyed by person, optionally by project, with an
  `effective_from` date.
- `TC-9` The rate applied is the one **effective on the entry's date**, not today's rate.
  Changing a rate never rewrites the cost of work already done.
- `TC-10` A default rate per person applies where no project-specific rate exists.
- `TC-11` Rates are visible only with `time_entry:manage_rates`. Salary information leaking
  through a report is a serious incident, so rate visibility is a distinct capability, not
  bundled with anything else. [Reports](reports-and-dashboards.md#permissions) use the same
  capability for cost and rate data, including exports.

## Cost entries

- `TC-12` A cost type has a name, a unit and a default rate. "Licence" per seat, "Travel"
  per kilometre.
- `TC-13` A cost entry records units, and the rate at entry time is captured on the row so
  later rate changes do not rewrite it.
- `TC-14` Cost entries attach to a work item or directly to a project, with exactly one of
  `work_item_id` and `project_id` set (see [Data](#data)).

## Budgets

- `TC-15` A budget belongs to a project, with a planned amount, a currency and a period.
- `TC-16` Actuals are computed from time entries valued at their effective rates, plus cost
  entries.
- `TC-17` A project shows planned versus actual versus committed, where committed includes
  estimated remaining work valued at current rates.
- `TC-18` When actual plus committed crosses 75% or 90% of planned, emit
  `budget.threshold_reached` with `budgetId`, `threshold`, and `currency` as defined in the
  [event catalogue](../01-architecture/events.md#projects-prerequisites-budgets). Notify only
  the project's `manager_id`; require current `project:read` reach and send no notification
  if the budget, project, manager, or reach cannot be resolved
  ([notification rules](notifications.md#data)).
- `TC-19` Multi-currency is supported by storing the currency per row. A cost type's currency
  is its default; the cost entry captures its currency with its rate. Cross-currency
  aggregation requires an exchange rate table, which is **out of scope for v2**; reports
  group by currency instead of converting.

## Capacity

- `TC-20` `available_hours` records a person's capacity for a period.
- `TC-21` Utilisation is logged time over available hours.
- `TC-22` Capacity is used for reporting, not for automatic assignment.

## Permissions

| Action | Capability |
| --- | --- |
| Log own time | `time_entry:create` |
| See own entries | `time_entry:create` |
| See anyone's entries | `time_entry:read_any` |
| Edit own entries | `time_entry:update_own` |
| Edit anyone's entries | `time_entry:update_any` |
| Delete own entries | `time_entry:delete_own` |
| Delete anyone's entries | `time_entry:delete_any` |
| Log beyond workspace backdating limit | `time_entry:log_backdated` |
| See and manage rates | `time_entry:manage_rates` |
| See budgets | `budget:read` |
| Manage budgets | `budget:manage` |

## Screens

**Timesheet** — a week grid, person by day, with inline entry, keyboard navigation between
cells, and a running total. This is the screen people use daily, and it must be fast to
fill in. A form-per-entry design guarantees nobody logs time.

**Work item time section** — entries on this item, the total, and a quick-add.

**Project budget** — planned, actual, committed, remaining, with a burn chart and a
breakdown by activity and by person.

**Rates** — under workspace settings, gated by capability.

The [screen inventory](../02-design/screen-inventory.md) also registers the project budget,
workspace rates, time activities and cost types screens; their workspace ownership is listed
in [settings hierarchy](settings-hierarchy.md#workspace).

## API

```
GET    /api/time-entries?person=&from=&to=      time_entry:read_any · orOwner(person_id, time_entry:create)   — own entries with `create`, everyone's with `read_any`
POST   /api/time-entries                        time_entry:create
PATCH  /api/time-entries/{id}                   time_entry:update_any · orOwner(person_id, time_entry:update_own)
DELETE /api/time-entries/{id}                   time_entry:delete_any · orOwner(person_id, time_entry:delete_own) → 202 pending action
POST   /api/time-entries/timer/start            time_entry:create
POST   /api/time-entries/timer/stop             time_entry:create
GET    /api/projects/{key}/budget               budget:read
POST   /api/projects/{key}/budgets              budget:manage
GET    /api/rates                               time_entry:manage_rates
POST   /api/rates                               time_entry:manage_rates
GET    /api/projects/{key}/costs                budget:read
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Time logged against a work item later deleted | Retained, reassigned to the project, flagged in reporting |
| Rate added retroactively | Applies to entries on and after its effective date. Actuals recompute; the change is audited |
| Person with no rate | Time is logged; cost shows as unpriced and is counted separately in reports |
| Entry crossing midnight | Split by the client into two dated entries before submission |
| Timer left running overnight | Capped at 12 hours with a prompt on next sign-in asking what actually happened |
| Two currencies in one project | Reported separately, never summed |
| Budget period changed | Actuals recompute for the new period |

## Data

The canonical data model defines `time_entry`, `running_timer`, `time_activity`,
`hourly_rate`, `cost_type`, `cost_entry`, `budget`, and `available_hours` in
[§9 Time and cost](../01-architecture/data-model.md#9-time-and-cost). This feature spec
does not introduce additional tables or columns.

## Out of scope

- Currency conversion
- Invoice generation
- Payroll integration
- Automatic time capture from calendars or commits

## Open questions

- **Committed budget valuation (TC-17):** what value should be shown when remaining work has
  point/category estimates or is unassigned, and which existing rate determines its value?
- **Cross-midnight entries:** what server-side behavior should replace the current
  client-split rule: reject the spanning entry or split it into dated entries?
- **Timer timezone:** should timer dates use the person's timezone with the instance timezone
  as fallback, or use the instance timezone captured at timer start?

## Testing

Unit: effective-rate selection by date; roll-up through a hierarchy; utilisation
arithmetic; minute-based totals with no floating point anywhere.

Integration: rates invisible without `time_entry:manage_rates`, including in every report
and export; own-versus-any entry visibility.

E2E: fill a week in the timesheet grid using only the keyboard; start and stop a timer
across a reload; observe budget thresholds firing.

## Related

- [Reports and dashboards](reports-and-dashboards.md) · [Projects](projects-and-engagements.md)
