# P5 feature contracts

These are maintained product requirements, not completion evidence. [Requirement index](../requirements-index.json) retains every original numbered definition and its provenance; [status](../status.md) records implementation and verification separately. Numbered definitions below retain their original wording, including any embedded historical implementation commentary; such commentary is not a current status claim. Standalone historical status, review history and implementation reports are omitted.

Use the original Kaneo composition, components and interactions for every specified screen. Current Thomas decisions and explicit maintained [integration contracts](../contracts.md) take precedence over older alternatives without dropping requirement IDs. Test sections describe required invariants and journeys, not tests claimed to exist or pass. API/schema discrepancies remain work to resolve, not permission to rewrite the requirement to match code.

The settled 20 October rate/timer owner decision takes precedence over older alternatives: rates are snapshotted at entry creation/timer stop; the server splits entries at midnight using profile → workspace → UTC timezone fallback. See [alignment decisions](../alignment.md). Existing Kaneo Calendar/Gantt continuity is P1; additional planning behavior here remains P5. P8/P9 are proposed later groupings, not an automatic expansion of first-release scope.

## Features

- [agile](#agile)
- [time-and-cost](#time-and-cost)
- [reports-and-dashboards](#reports-and-dashboards)
- [knowledge-base](#knowledge-base)
- [project-pages](#project-pages)
- [service-management](#service-management)

<a id="agile"></a>
## Cycles, modules and estimates

- **Primary phase:** P5
- **Feature flags:** `feature.cycles`, `feature.modules`, `feature.estimates`
- **Depends on:** work items, projects

<a id="agile-purpose"></a>
### Purpose

Agile planning for delivery projects. Taken from Plane, which models this cleanly.

All three are **off by default** and enabled per project. A support queue should never see
a burndown chart, and a managed service has no cycles at all.

---

<a id="agile-cycles"></a>
### Cycles

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

<a id="agile-modules"></a>
### Modules

A grouping of work by feature or theme, independent of time. OpenProject calls these
versions; Jira calls them components; Plane calls them modules.

- `MO-1` A module belongs to a project and has a name, a lead, an optional target date and
  a status.
- `MO-2` A work item may belong to at most one module.
- `MO-3` Modules and cycles are orthogonal. An item can be in a cycle and a module.
- `MO-4` A module shows progress, remaining work and, where a target date exists, whether
  the current rate will meet it — expressed as a range, not a false-precision date.

<a id="agile-estimates"></a>
### Estimates

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

<a id="agile-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| See cycles and modules | `project:read` |
| Create, edit, delete | `project:manage_settings` |
| Add or remove work items | `work_item:update` |
| Configure the estimate system | `project:manage_settings` |
| Set an estimate | `work_item:update` |

<a id="agile-screens"></a>
### Screens

Cycles list; cycle detail with board, burndown and scope-change log; modules list; module
detail; estimate configuration under project settings; the estimate control on the work
item.

The cycle detail is a normal work surface with a burndown above it — not a separate,
lesser board. People plan and execute in the same place.

<a id="agile-api"></a>
### API

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

<a id="agile-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Cycle created overlapping another | Refused, with the conflicting cycle named |
| Work item moved to another project while in a cycle | Removed from the cycle; the user is warned first |
| Cycle completed with everything incomplete | Allowed. Burndown records it honestly |
| Estimate system changed mid-cycle | Warned; the burndown notes the discontinuity rather than pretending it did not happen |
| Cycle with no work items | Burndown shows "no scope" |
| Feature disabled while cycles exist | Cycles hidden, data retained, restored on re-enable |
| Item added to a cycle after it ended | Allowed for backfill, marked as retrospective |

<a id="agile-out-of-scope"></a>
### Out of scope

- Cross-project cycles — a cycle belongs to one project
- Capacity-based sprint planning → [time-and-cost.md](feature-contracts-p5.md#time-and-cost)
- Automatic sprint rollover

<a id="agile-testing"></a>
### Testing

Unit: overlap detection; status derivation from dates; burndown arithmetic including scope
change; velocity requiring three cycles; estimate roll-up.

Integration: cycle completion moves items per the chosen policy; estimate system change
preview matches the result.

E2E: create a cycle, drag items in, complete it, confirm the burndown and scope-change log.

<a id="agile-related"></a>
### Related

- [Work items](feature-contracts-p1.md#work-items) · [Views](feature-contracts-p1.md#views) · [Reports](feature-contracts-p5.md#reports-and-dashboards)

<a id="time-and-cost"></a>
## Time and cost

- **Primary phase:** P5
- **Feature flags:** `feature.time_tracking`, `feature.cost_tracking`
- **Depends on:** work items, projects, people

<a id="time-and-cost-purpose"></a>
### Purpose

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

<a id="time-and-cost-time-entries"></a>
### Time entries

- `TC-1` A time entry belongs to a work item, a person and a date, and records integer
  **minutes**. Never a float — floating-point hours accumulate rounding errors that
  eventually appear on an invoice.
- `TC-2` An activity type — Development, Support, Meeting, Travel — is required, so time
  can be analysed by kind.
- `TC-3` A `billable` flag, defaulting from the project.
- `TC-4` Entries may be logged for a past date, up to a configurable limit (default 30
  days). Beyond that requires `time_entry:log_backdated`.
- `TC-5` A person edits their own entries (`time_entry:update_own`). Editing anyone else's
  requires `time_entry:update_any`, which implies `time_entry:read_any`.
- `TC-6` A timer is offered — start, stop, and it survives a page reload — but manual entry
  is always available, because most people log time at the end of the day.
- `TC-7` Entries roll up to the work item, its parent chain, its cycle, its module and its
  project.

<a id="time-and-cost-rates"></a>
### Rates

- `TC-8` `hourly_rate` is keyed by person, optionally by project, with an
  `effective_from` date.
- `TC-9` The rate applied is the one **effective on the entry's date**, not today's rate.
  Changing a rate never rewrites the cost of work already done.
- `TC-10` A default rate per person applies where no project-specific rate exists.
- `TC-11` Rates are visible only with `time_entry:manage_rates`. Salary information leaking
  through a report is a serious incident, so rate visibility is a distinct capability, not
  bundled with anything else.

<a id="time-and-cost-cost-entries"></a>
### Cost entries

- `TC-12` A cost type has a name, a unit and a default rate. "Licence" per seat, "Travel"
  per kilometre.
- `TC-13` A cost entry records units, and the rate at entry time is captured on the row so
  later rate changes do not rewrite it.
- `TC-14` Cost entries attach to a work item or directly to a project.

<a id="time-and-cost-budgets"></a>
### Budgets

- `TC-15` A budget belongs to a project, with a planned amount, a currency and a period.
- `TC-16` Actuals are computed from time entries valued at their effective rates, plus cost
  entries. *Implemented.* Actual = time entries valued at the rate captured on each entry plus
  the cost entries (units x the rate captured on the row) dated in the budget period, in the
  budget's currency. Time and cost entries in another currency are reported separately in
  `otherCurrencies` and never converted (`TC-19`). Entries without a rate are counted in
  `unpricedMinutes`.
- `TC-17` A project shows planned versus actual versus committed, where committed includes
  estimated remaining work valued at current rates. *Implemented (25 Oct decision).* Committed
  covers the project's open leaf work items (backlog, unstarted or started; not deleted or
  archived; no open child) whose stored due date falls in the budget's period. Remaining minutes
  = time-system estimate minus time already logged on the item (never below 0), valued at the
  assignee's effective rate today (the person-and-project rate effective on the assignee's
  current date, else the person's default). `committedByCurrency` totals each rate currency
  separately; `committedMinor` is a scalar only when every in-period task was valued and all are
  in the budget's currency (an empty forecast is 0), otherwise `null`. Items that cannot be
  valued are explicit unknowns in `committedUnknown`, never silently zero: `unscheduled` (no due
  date), `nonTime` (no time estimate), `unassigned` (no assignee), `unrated` (no current rate),
  with the remaining minutes that are known. Committed and the unknown totals are omitted from a
  caller without `time_entry:manage_rates`.
- `TC-18` Thresholds — 75% and 90% — raise notifications to the project manager.
- `TC-19` Multi-currency is supported by storing the currency per row. Cross-currency
  aggregation requires an exchange rate table, which is **out of scope for v2**; reports
  group by currency instead of converting.

<a id="time-and-cost-capacity"></a>
### Capacity

- `TC-20` `available_hours` records a person's capacity for a period.
- `TC-21` Utilisation is logged time over available hours.
- `TC-22` Capacity is used for reporting, not for automatic assignment.

<a id="time-and-cost-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| Log own time | `time_entry:create` |
| See own entries | `time_entry:create` |
| See anyone's entries | `time_entry:read_any` |
| Edit anyone's entries | `time_entry:update_any` |
| Log beyond the backdating window | `time_entry:log_backdated` |
| See and manage rates | `time_entry:manage_rates` |
| See budgets | `budget:read` |
| Manage budgets | `budget:manage` |

<a id="time-and-cost-screens"></a>
### Screens

**Timesheet** — a week grid, person by day, with inline entry, keyboard navigation between
cells, and a running total. This is the screen people use daily, and it must be fast to
fill in. A form-per-entry design guarantees nobody logs time.

**Work item time section** — entries on this item, the total, and a quick-add.

**Project budget** — planned, actual, committed, remaining, with a burn chart and a
breakdown by activity and by person.

**Rates** — under workspace settings, gated by capability.

<a id="time-and-cost-api"></a>
### API

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

<a id="time-and-cost-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Time logged against a work item later deleted | Retained, reassigned to the project, flagged in reporting |
| Rate added retroactively | Applies to entries on and after its effective date. Actuals recompute; the change is audited |
| Person with no rate | Time is logged; cost shows as unpriced and is counted separately in reports |
| Entry crossing midnight | Split by the server into two dated entries at midnight (profile, then workspace, then UTC timezone; owner decision D4, 20 Oct) |
| Timer left running overnight | Capped at 12 hours with a prompt on next sign-in asking what actually happened |
| Two currencies in one project | Reported separately, never summed |
| Budget period changed | Actuals recompute for the new period |

<a id="time-and-cost-out-of-scope"></a>
### Out of scope

- Currency conversion
- Invoice generation
- Payroll integration
- Automatic time capture from calendars or commits

<a id="time-and-cost-testing"></a>
### Testing

Unit: effective-rate selection by date; roll-up through a hierarchy; utilisation
arithmetic; minute-based totals with no floating point anywhere.

Integration: rates invisible without `time_entry:manage_rates`, including in every report
and export; own-versus-any entry visibility.

E2E: fill a week in the timesheet grid using only the keyboard; start and stop a timer
across a reload; observe budget thresholds firing.

<a id="time-and-cost-related"></a>
### Related

- [Reports and dashboards](feature-contracts-p5.md#reports-and-dashboards) · [Projects](feature-contracts-p1.md#projects-and-engagements)

<a id="reports-and-dashboards"></a>
## Reports and dashboards

- **Primary phase:** P5
- **Feature flag:** `feature.reports`
- **Depends on:** work items, SLA, time and cost

<a id="reports-and-dashboards-purpose"></a>
### Purpose

Answer the question that started this project: **how are we doing?**

Today it requires five exports and a spreadsheet, so it does not happen. It should take
thirty seconds.

<a id="reports-and-dashboards-the-honesty-rule"></a>
### The honesty rule

Inherited from v1, which got this right and is worth stating as a rule because it is
constantly tempting to break.

- `RP-1` Insufficient data returns `null` and renders as **"Not enough data (3 of 10
  needed)"**. Never `0%`, never `100%`, never a blank.
- `RP-2` Age and duration are shown as **buckets**, not means. A mean age of 4 days hides
  the ninety-day ticket that is the actual problem.
- `RP-3` Every report states its **scope** — "your projects" versus "all projects" — in
  the report itself, because the same number means different things to different viewers.
- `RP-4` Every report states its **window** and its **as-of time**.
- `RP-5` Empty result sets show "—" with an explanation and a count of what was excluded,
  never a chart of nothing.
- `RP-6` Trend arrows require at least two comparable periods, and say so when they do not
  have them.

A report that flatters is worse than no report, because decisions get made on it.

<a id="reports-and-dashboards-three-report-tiers"></a>
### Three report tiers

Reporting needs cover a spectrum, and one mechanism cannot serve all of it well —
attempting that is exactly what makes a report builder either too rigid or, per
[decision log](#pending-07-planningdecision-log)'s stance on the automation rule builder,
too complex. Three tiers, each reusing infrastructure that already exists elsewhere in the
product rather than inventing a fourth:

| Tier | Answers | Precedent | Built from |
| --- | --- | --- | --- |
| **1 — Fixed** | A known question, asked often | MS Planner's built-in charts; Plane's insights | The twenty canned reports below. Filterable (`RP-7`), never restructured |
| **2 — Selectable (row and column)** | "Show me this data, shaped my way" | MS Planner's grid view; Plane's spreadsheet view | The existing [Table view](feature-contracts-p1.md#views) and [saved views](feature-contracts-p1.md#search-and-saved-views) — a column chooser plus the structured filter grammar ([API design](#pending-01-architectureapi-design)), saved and reused as a report |
| **3 — Customisable** | A genuinely novel question | Azure DevOps Analytics widgets; Jira dashboard gadgets and JQL | A small ad-hoc report builder over the same filter grammar and `saved_view` mechanism, adding grouping, aggregation and a chart-type choice |

**Tier 1 — Fixed reports.** The twenty reports below. An administrator cannot restructure
one — only filter it (`RP-7`) — because a fixed report's value is that everyone reads the
same shape and trusts it. This tier is unaffected by anything below.

**Tier 2 — Selectable, row-and-column reports.** Not a new subsystem: the
[Table view](feature-contracts-p1.md#views) already renders work items as rows and columns via TanStack Table.
What tier 2 adds is treating a saved table configuration — which columns are checked
visible, in which order, filtered and sorted how — as a first-class **report**, listed
alongside the tier 1 reports rather than buried in a project's view switcher. Saving one
writes a `saved_view` with `layout: 'table'`
([data model](data-model.md)) and a `shared_with_team_id` or
workspace scope, exactly as [search-and-saved-views.md](feature-contracts-p1.md#search-and-saved-views) already
specifies. **No new storage, no new engine — a naming and a placement decision**, so a
person building "open items by requester, columns: key, title, age, assignee" gets an MS
Planner-style grid without leaving the reports index.

**Tier 3 — Customisable reports.** A small ad-hoc report builder for the question a fixed
report does not answer and a table cannot summarise: pick an entity (work items, time
entries, SLA events), the structured filter grammar already in
[API design](#pending-01-architectureapi-design) narrows it, a **group by** (project,
assignee, type, priority, custom field, week) aggregates it, and a chart type (bar, line,
table, single number) renders it. Saved the same way as tier 2 — a `saved_view`, this time
with `layout: 'chart'` and a `groupBy` / `aggregate` clause in its `query` — so a
custom report is, structurally, a saved search with an aggregation step, not a distinct
report-definition language. This deliberately stops short of Jira's JQL or Azure DevOps'
full Analytics query surface: no joins across entities, no computed/derived fields beyond
what `custom_field` already provides, no scripting. That covers the reporting equivalent
of "90% of cases with 20% of the concepts," the same bar
[automations.md](feature-contracts-p4.md#automations) holds itself to, and the same reason a full formula
engine was rejected for custom fields — see
[decision log](#pending-07-planningdecision-log).

<a id="reports-and-dashboards-the-reports"></a>
### The reports

Carried from v1's set, which was well chosen, grouped by the question being asked. All are
**tier 1 — fixed**.

<a id="reports-and-dashboards-promises--are-we-meeting-what-we-committed"></a>
#### Promises — are we meeting what we committed?

| Report | Answers |
| --- | --- |
| SLA attainment | What proportion met, by period |
| SLA trend | Is attainment improving or degrading |
| Breach analysis | Which types, priorities and customers breach most |
| At-risk now | What is about to breach, live |

<a id="reports-and-dashboards-customers--who-are-we-failing"></a>
#### Customers — who are we failing?

| Report | Answers |
| --- | --- |
| Performance by customer | Volume, attainment, average resolution, worst first |
| Customer volume trend | Is one customer's demand growing |
| Satisfaction | CSAT by customer and by request type |

<a id="reports-and-dashboards-delivery--are-we-getting-through-the-work"></a>
#### Delivery — are we getting through the work?

| Report | Answers |
| --- | --- |
| Throughput | Items completed per week |
| Work mix | Distribution by type and priority |
| Cycle time | Created to resolved, bucketed |
| Ageing | Open items by age bucket |
| Flow | Where items sit longest |

<a id="reports-and-dashboards-people--how-is-the-team"></a>
#### People — how is the team?

| Report | Answers |
| --- | --- |
| Workload | Open items per person |
| Stale work | Untouched for N days, by person |
| Utilisation | Logged versus available hours |
| Capacity | Team capacity against committed work |

<a id="reports-and-dashboards-leadership--the-portfolio"></a>
#### Leadership — the portfolio

| Report | Answers |
| --- | --- |
| Portfolio health | RAG across every engagement |
| Predictability | Committed versus delivered per cycle |
| Cost to deliver | Actual against budget by project |
| Escalations | Volume and resolution of escalations |

<a id="reports-and-dashboards-behaviour"></a>
### Behaviour

- `RP-7` Filter by window (7, 30, 60, 90 days, or custom), project, organisation, team,
  type and priority.
- `RP-8` **The full filter state is in the URL.** Sending a colleague a link to what you
  are looking at must work. *(v1's reports were behind nested tabs with no addresses, and
  this was one of the loudest complaints.)*
- `RP-9` Closed periods read from `metric_snapshot`, computed hourly. The current partial
  period is computed live. The boundary is stated.
- `RP-10` Every report exports to CSV, respecting filters and the viewer's reach. Exports
  are audited. *Implemented:* a small export is the CSV itself; a large one is queued as a job
  and, when ready, the requester is emailed once a link to the authenticated route
  `GET /api/report-exports/{id}/download` (no signed or public URL: the download needs the
  requester's session or key, with the caps they hold now ANDed with those at request time). The
  email is on by default and honours a stored `report.export_ready` email preference, which the
  preferences screen does not offer yet (so the email has no unsubscribe link). The file
  is written as appended chunks, one per page of 5,000 rows, and streamed back on download. Caps:
  1,000,000 rows, 200 pages and 512 MB; beyond them the export fails with `export_too_large`
  (nothing is emailed). A 500,000-row export is within the caps. Rates follow `TC-11` at project
  scope: a project-filtered report resolves `time_entry:manage_rates` at that project, and a
  workspace-wide report shows no rates while a project role override removes the capability.
- `RP-11` Every chart has an accessible table equivalent, reachable by keyboard, because a
  chart alone is not readable by a screen reader.
- `RP-12` Drill-down from any number to the underlying list, filtered identically.
  A metric you cannot interrogate is not trustworthy.

<a id="reports-and-dashboards-dashboards"></a>
### Dashboards

- `RP-13` A dashboard is a grid of widgets, each a report or a single metric.
- `RP-14` Personal dashboards are per user; workspace dashboards require
  `workspace:manage_settings`.
- `RP-15` Widgets are resizable and draggable, and layout persists.
- `RP-16` A sensible default dashboard exists so a new user sees something useful
  immediately rather than an empty grid with an "add widget" button.

<a id="reports-and-dashboards-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| See reports for your reach | `report:read` |
| See reports across all projects | `report:read_all` |
| Export | `report:export` |
| Create workspace dashboards | `workspace:manage_settings` |
| See cost and rate data | `time_entry:manage_rates` |

- `RP-17` Every report is filtered to the viewer's reach. Two people running the same
  report legitimately see different numbers, and the scope line explains why.
- `RP-18` **Customers see no reports.** *(v1's `/reports/*` had no access control at all,
  so customers could read the entire SLA portfolio across every customer. This is the
  single worst defect it found, and it is why report routes get their own explicit
  negative tests.)*

<a id="reports-and-dashboards-screens"></a>
### Screens

Reports index with category chips and a KPI strip, grouped by tier; report detail with
filters, chart, table and export; **report builder** (tier 3 — pick entity, filter, group
by, aggregate, chart type, with a live preview, the same discipline as the request-type
form builder's live preview); dashboard; dashboard editor.

The index is a directory, not a dashboard. Its job is to get someone to the right report
in one click, whichever tier it belongs to.

<a id="reports-and-dashboards-api"></a>
### API

```
GET  /api/reports                              report:read
GET  /api/reports/{key}?window=&project=…      report:read | report:read_all
POST /api/reports/{key}/export                 report:export
GET  /api/saved-views?layout=table             report:read     (tier 2)
POST /api/saved-views                          report:read     (tier 2 — save a table as a report)
POST /api/reports/custom/preview               report:read     (tier 3 — live preview, not saved)
POST /api/saved-views                          report:read     (tier 3 — layout: 'chart', with groupBy/aggregate)
GET  /api/dashboards                           (scoped)
POST /api/dashboards                           (self | workspace:manage_settings)
GET  /api/dashboards/{id}/widgets/{wid}/data   (per widget's report, any tier)
```

Tiers 2 and 3 both persist through `POST /api/saved-views` — there is one endpoint for
"save a report," not one per tier, because structurally they are the same resource with a
different `layout` and query shape.

<a id="reports-and-dashboards-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Window with no data | "No data in this period", with the total outside it |
| Fewer than the minimum sample | `null`, rendered as "not enough data (n of m)" |
| Project archived mid-window | Included, marked archived |
| SLA policy changed mid-window | Each item evaluated against the policy version effective at its creation. The report notes that a change occurred |
| Export of 500,000 rows | Queued as a job; a download link is emailed when ready |
| Viewer loses reach mid-session | Numbers change on refresh. The scope line explains |
| Two currencies | Grouped, never summed |
| Tier 3 report grouped by a custom field later deleted | Report retained; the group renders "(deleted field)" rather than failing |
| Tier 3 filter references a project the viewer loses reach to mid-session | Silently excluded on refresh, per `RP-17`, same as any other report |

<a id="reports-and-dashboards-testing"></a>
### Testing

Unit: every aggregation against fixtures with known answers; the minimum-sample rule;
bucket boundaries; tier 3's `groupBy`/`aggregate` clause against the same filter-grammar
fixtures [API design](#pending-01-architectureapi-design) already uses for saved views.

Integration — the important ones: report routes require a capability; a customer session
receives 403 on every report route; results are filtered to reach; exports respect reach;
a tier 2 or tier 3 report saved by one person and shared to a team is visible to that team
and invisible outside it, exactly as [search-and-saved-views.md](feature-contracts-p1.md#search-and-saved-views)
specifies for saved views generally, because that is what it is.

E2E: `reports-require-capability.spec.ts`, `customer-cannot-read-reports.spec.ts`,
`tier2-table-report-saved-and-reopened.spec.ts`, `tier3-custom-report-builder.spec.ts`,
plus drill-down from a number to a correctly filtered list.

<a id="reports-and-dashboards-related"></a>
### Related

- [SLA](feature-contracts-p2.md#sla) · [Time and cost](feature-contracts-p5.md#time-and-cost)
- [Background jobs](background-jobs.md)

<a id="knowledge-base"></a>
## Knowledge base

- **Primary phase:** P5
- **Feature flag:** `feature.knowledge_base`
- **Depends on:** request types, search

<a id="knowledge-base-purpose"></a>
### Purpose

Answer questions before they become tickets, and stop staff re-typing the same explanation.

The measure of success is not article count. It is **deflection** — requests that were not
raised because the answer was already there.

<a id="knowledge-base-concepts"></a>
### Concepts

| Concept | Meaning |
| --- | --- |
| **Article** | A titled document with rich text |
| **Category** | A hierarchical grouping |
| **Status** | `draft` · `in_review` · `published` · `archived` |
| **Visibility** | Staff-only, or published to customers |
| **Version** | An immutable snapshot on each publish |

<a id="knowledge-base-behaviour"></a>
### Behaviour

- `KB-1` An article belongs to a workspace and optionally to a project, which scopes who
  sees it.
- `KB-2` `customer_visible` plus `published` are both required for a customer to see it.
  Two conditions, deliberately, so an unfinished customer-facing article cannot leak.
- `KB-3` Publishing creates an immutable version. History is browsable and restorable.
- `KB-4` An optional review step: an author submits, a reviewer publishes. Configurable
  per workspace, off by default.
- `KB-5` Articles are written in Tiptap, with headings, lists, tables, code blocks, images
  and callouts.
- `KB-6` Articles may embed a work item reference, rendering key, title and state live.
- `KB-7` Articles carry an owner and a review date. Overdue reviews are reported, because
  a stale knowledge base is worse than none.

<a id="knowledge-base-deflection"></a>
### Deflection

The whole point.

- `KB-8` As a customer types a request summary, matching published articles are offered
  inline.
- `KB-9` Matching uses the same full-text index as search, weighted to titles.
- `KB-10` Opening an article from the request form records a deflection candidate. If the
  customer then abandons the form, it counts as a deflection.
- `KB-11` Deflection is **never coercive.** No "are you sure you still need help?" step.
  It offers and gets out of the way. Nothing damages trust in a portal faster than being
  made to argue with it.
- `KB-12` Staff see the same suggestions while triaging, so an article can be linked in a
  reply rather than re-typed.

<a id="knowledge-base-discovery"></a>
### Discovery

- `KB-13` Full-text search across title and body, scoped to what the viewer may see.
- `KB-14` Browse by category.
- `KB-15` "Related articles" from shared categories and text similarity.
- `KB-16` Most-viewed and recently-updated lists.
- `KB-17` "Was this helpful?" — a yes/no with an optional comment, feeding a report of
  articles that are read but do not help.

<a id="knowledge-base-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| Read published, customer-visible | Portal session, correct scope |
| Read staff articles | `kb_article:read` |
| Create and edit drafts | `kb_article:write` |
| Publish | `kb_article:publish` |
| Archive | `kb_article:publish` |
| Manage categories | `kb_article:publish` |

<a id="knowledge-base-screens"></a>
### Screens

**Agent** — article list with status, owner and review date; article view with version
history; editor with a live preview of the customer's view; category management; a
deflection report.

**Portal** — search, browse by category, article view, helpfulness prompt.

The editor's customer preview matters for the same reason it does on request forms: an
author must see what a customer will see, including which internal notes are hidden.

<a id="knowledge-base-api"></a>
### API

```
GET    /api/kb/articles                        kb_article:read
POST   /api/kb/articles                        kb_article:write
GET    /api/kb/articles/{id}                   kb_article:read
PATCH  /api/kb/articles/{id}                   kb_article:write
POST   /api/kb/articles/{id}/publish           kb_article:publish
GET    /api/kb/articles/{id}/versions          kb_article:read
GET    /api/kb/search?q=…                      kb_article:read (scope workspace; results reach-filtered)
GET    /api/kb/categories                      kb_article:read
GET    /api/portal/kb                          portal(own_organisation) — kind 3
GET    /api/portal/kb/{id}                     portal(own_organisation) — kind 3
POST   /api/portal/kb/{id}/feedback            (portal session)
GET    /api/kb/deflection?q=…                  kb_article:read           (agent — staff see the same suggestions, KB-12)
GET    /api/portal/kb/deflection?q=…           { portal: 'customer', predicate: 'own_organisation' }
       — two routes sharing one domain function, never one route serving "either session" (ADR 0004)
```

<a id="knowledge-base-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Article unpublished while a customer has it open | Next load returns 404. No mid-read removal |
| Article scoped to a project the customer loses access to | Disappears from their list; the URL returns 404 |
| Image in an article, attachment deleted | Placeholder rendered; the article is flagged for review |
| Two authors editing concurrently | Optimistic concurrency, 409, with a diff |
| Category deleted with articles | Refused. Articles must be moved first |
| Very long article | Auto-generated table of contents from headings |
| Article referencing a deleted work item | Reference renders as "(removed)" |

<a id="knowledge-base-out-of-scope"></a>
### Out of scope

- Multi-language articles — Stage 6 candidate
- AI-generated articles from resolved tickets — Stage 6 candidate, and it needs care
- Public, unauthenticated knowledge base

<a id="knowledge-base-testing"></a>
### Testing

Integration: an unpublished or non-customer-visible article is absent from every portal
response, including search and deflection; project scoping holds.

E2E: write, review, publish; see it appear as a deflection suggestion while raising a
request; abandon the form and confirm the deflection is recorded.

<a id="knowledge-base-related"></a>
### Related

- [Request types](feature-contracts-p2.md#request-types-and-catalogue) · [Customer portal](feature-contracts-p3.md#customer-portal)
- [Search](feature-contracts-p1.md#search-and-saved-views)

<a id="project-pages"></a>
## Project pages

- **Primary phase:** P5
- **Feature flag:** none (project-level availability follows project reach)
- **Depends on:** projects, search, knowledge base editor

<a id="project-pages-purpose"></a>
### Purpose

Staff write long-form project documents (plans, runbooks, meeting notes) next to the work. Pages are **not** the knowledge base: they have no status workflow, no customer visibility and no deflection role.

<a id="project-pages-behaviour"></a>
### Behaviour

- `PG-1` A page belongs to exactly one project, has a title and a rich-text body, an author and timestamps. `Contract-new`
- `PG-2` Pages are staff-only. No page, title, snippet, version or count appears in any portal response, portal search, deflection or notification; a portal session receives the constant-shape 404 on every page route. A page cannot be made customer-visible. `Contract-new`
- `PG-3` The page editor is the knowledge-base Tiptap editor (`KB-5`) configured without KB publish controls: the same component, extensions and toolbar from Kaneo/`packages/ui`, not a second editor. `Contract-new`
- `PG-4` Every successful save creates an immutable version (body, title, author, time). History is browsable and any version restorable; restore writes a new version rather than rewriting history. `Contract-new`
- `PG-5` Saves use optimistic concurrency: a stale save returns 409 with the current version and nothing is written. There is no real-time co-editing, presence or cursor sharing. `Contract-new`
- `PG-6` Pages are included in canonical search as their own entity type for callers with reach to the project, using the same index and reach filter as other entities; they are excluded from every portal and deflection query. `Contract-new`
- `PG-7` Deleting a page goes through the pending-action flow (soft delete, restore window, audit), never a direct destructive route. Deleting a project follows `RH-11`/`PR-16`; its pages follow the project. `Contract-new`
- `PG-8` Create, update, restore and delete write audit rows; the body is not copied into the audit record. `Contract-new`

<a id="project-pages-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| List and read pages and versions | `project:read` (with project reach) |
| Create, edit, restore | `project:update` (with project reach) |
| Request deletion | `project:update`, completed through the pending action |

Customer-role identities hold none of these capabilities.

<a id="project-pages-screens"></a>
### Screens

`/agent/projects/{key}/pages` (list), `/agent/projects/{key}/pages/{id}` (view/edit with history side panel).

<a id="project-pages-api"></a>
### API

```
GET    /api/projects/{projectId}/pages                    project:read
POST   /api/projects/{projectId}/pages                    project:update
GET    /api/projects/{projectId}/pages/{id}               project:read
PATCH  /api/projects/{projectId}/pages/{id}               project:update  (expected version required)
GET    /api/projects/{projectId}/pages/{id}/versions      project:read
POST   /api/projects/{projectId}/pages/{id}/restore       project:update
DELETE /api/projects/{projectId}/pages/{id}               project:update  (creates a pending action)
```

<a id="project-pages-testing"></a>
### Testing

Integration: portal identity gets 404 on every route and finds no page in search; viewer cannot write; stale save is 409; each save adds a version; restore adds a version; delete creates a pending action and the page remains until approved; reach filter holds in search.

E2E: create a page, edit twice, view history, restore, delete and approve.

<a id="project-pages-related"></a>
### Related

- [Knowledge base](#knowledge-base) · [Search](feature-contracts-p1.md#search-and-saved-views)

<a id="service-management"></a>
## Service catalogue, changes and releases

- **Primary phase:** P5
- **Feature flag:** `feature.service_catalogue`
- **Depends on:** work items, workflows, approvals

<a id="service-management-purpose"></a>
### Purpose

The ITIL service management layer: what services we run, what changes we are making to
them, and what we are releasing.

Carried from v1, trimmed to what is actually used. ITIL has thirty-four practices; we
implement three, because the rest are process documents rather than software.

---

<a id="service-management-services"></a>
### Services

A named thing we operate on behalf of customers.

- `SVC-1` A service has a name, description, category, owning team, support level (L1/L2/L3)
  and a service calendar.
- `SVC-2` A service links to documentation, to its projects and to its knowledge base
  articles.
- `SVC-3` A work item may reference the service it affects. This is what makes "which
  service generates the most incidents?" answerable.
- `SVC-4` A service has a status — operational, degraded, outage — set by a person, not
  computed. Computed status from open incidents is appealing and always wrong.
- `SVC-5` Services may depend on other services, forming a graph used to show impact:
  "this change affects 3 services and 2 customers."

Deliberately **not** a full CMDB. Configuration item discovery, asset inventory and
dependency mapping are a separate product, and every ticketing system that has tried to
absorb them has become unpleasant. If a customer needs a CMDB, they have one, and we link
to it.

---

<a id="service-management-changes"></a>
### Changes

A change is a **work item** of a change type, with extra structure. Not a separate entity.

- `CH-1` Change detail carries: risk (low/medium/high), a deployment window, a rollback
  plan, affected services and a freeze override flag.
- `CH-2` A change's workflow requires CAB approval before the transition to Approved.
  See [approvals](feature-contracts-p2.md#approvals).
- `CH-3` Risk drives the approval requirement: low-risk changes may be pre-approved by
  workflow configuration, high-risk always require CAB.
- `CH-4` A **change freeze** is a workspace-level date range during which no change may be
  approved. Overriding requires an explicit flag, a reason, and elevated authority — and
  it is audited prominently.
- `CH-5` The change calendar shows planned windows, freezes and conflicts. Two changes to
  the same service in the same window are flagged.
- `CH-6` A rollback plan is required before a change may be approved. Not a suggestion.

---

<a id="service-management-releases"></a>
### Releases

A grouping of changes deployed together.

- `REL-1` A release has a name, a target service, a planned date, a status and notes.
- `REL-2` Changes are associated with a release.
- `REL-3` A release checklist can be defined per service and is instantiated per release.
- `REL-4` Release notes are generated from the associated changes and are editable before
  publication.
- `REL-5` A release may be published to the customer portal, so customers can see what
  changed. Off by default.

---

<a id="service-management-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| See services | `project:read` |
| Manage services | `service:manage` |
| Set service status | `service:manage` |
| Manage change details | `change:manage` |
| Approve a change | `approval:decide_cab` |
| Manage freezes | `change:manage` |
| Override a freeze | `change:manage` + elevated + audited |
| Manage releases | `release:manage` |

<a id="service-management-screens"></a>
### Screens

Services list and detail with a dependency graph; change calendar; change detail section
on the work item; freeze management; releases list and detail with checklist and notes.

The change calendar is the screen that earns this feature. Everything else is structured
data; the calendar is where someone spots that two teams planned conflicting work on the
same weekend.

<a id="service-management-api"></a>
### API

```
GET    /api/services                           project:read
POST   /api/services                           service:manage
PATCH  /api/services/{id}                      service:manage
POST   /api/services/{id}/status               service:manage
GET    /api/services/{id}/impact               project:read
GET    /api/changes/calendar?from=&to=         project:read
GET    /api/work-items/{key}/change            work_item:read
PATCH  /api/work-items/{key}/change            change:manage
GET    /api/change-freezes                     project:read
POST   /api/change-freezes                     change:manage
GET    /api/releases                           project:read
POST   /api/releases                           release:manage
POST   /api/releases/{id}/notes                release:manage
```

<a id="service-management-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Change approved, then a freeze is declared covering its window | The change is flagged; the window must be moved or the freeze overridden |
| Service deleted with open changes | Refused |
| Circular service dependency | Permitted but flagged; impact analysis stops at the cycle and says so |
| Change window in the past | Allowed, for retrospective recording, and marked as such |
| Release with no changes | Allowed. Notes are empty and say so |
| Freeze override | Requires a reason, elevated authority, and appears in a prominent audit report |

<a id="service-management-out-of-scope"></a>
### Out of scope

- Full CMDB and asset discovery
- Automated deployment — we record changes, we do not perform them
- Problem management as a distinct workflow beyond a problem work item type
- Service level *reporting* → [reports and dashboards](feature-contracts-p5.md#reports-and-dashboards)

<a id="service-management-testing"></a>
### Testing

Unit: freeze conflict detection; impact traversal with cycles; risk-to-approval mapping.

Integration: a change cannot be approved during a freeze without an override; an override
is audited; a rollback plan is required.

E2E: create a change, hit the freeze, override with a reason, observe the audit entry.

<a id="service-management-related"></a>
### Related

- [Approvals](feature-contracts-p2.md#approvals) · [Workflows](feature-contracts-p2.md#workflows) · [Audit trail](feature-contracts-p2.md#audit-trail)

## Pending foundation and decision references

Mappings to existing technical references provide maintained entrypoints; they do not certify full migration of every foundation clause. These linked contracts are not migrated by this feature reference. The rows identify the original contract, not an available archive dependency. Their normative details still require maintained migration; a link here does not close that gap. Current [requirements](../requirements.md) and [alignment](../alignment.md) retain the scope/precedence boundary.

<a id="pending-01-architectureapi-design"></a>
- **Pending maintained contract:** `docs/01-architecture/api-design.md`.
<a id="pending-07-planningdecision-log"></a>
- **Pending product-decision/scope extraction (historical process is inactive):** `docs/07-planning/decision-log.md`.
