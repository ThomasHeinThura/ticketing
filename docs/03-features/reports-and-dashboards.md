# Reports and dashboards

- **Phase:** P5
- **Status:** ⬜
- **Feature flag:** `feature.reports`
- **Depends on:** work items, SLA, time and cost

## Purpose

Answer the question that started this project: **how are we doing?**

Today it requires five exports and a spreadsheet, so it does not happen. It should take
thirty seconds.

## The honesty rule

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

## Three report tiers

Reporting needs cover a spectrum, and one mechanism cannot serve all of it well —
attempting that is exactly what makes a report builder either too rigid or, per
[decision log](../07-planning/decision-log.md)'s stance on the automation rule builder,
too complex. Three tiers, each reusing infrastructure that already exists elsewhere in the
product rather than inventing a fourth:

| Tier | Answers | Precedent | Built from |
| --- | --- | --- | --- |
| **1 — Fixed** | A known question, asked often | MS Planner's built-in charts; Plane's insights | The fourteen canned reports below. Filterable (`RP-7`), never restructured |
| **2 — Selectable (row and column)** | "Show me this data, shaped my way" | MS Planner's grid view; Plane's spreadsheet view | The existing [Table view](views.md) and [saved views](search-and-saved-views.md) — a column chooser plus the structured filter grammar ([API design](../01-architecture/api-design.md)), saved and reused as a report |
| **3 — Customisable** | A genuinely novel question | Azure DevOps Analytics widgets; Jira dashboard gadgets and JQL | A small ad-hoc report builder over the same filter grammar and `saved_view` mechanism, adding grouping, aggregation and a chart-type choice |

**Tier 1 — Fixed reports.** The fourteen reports below. An administrator cannot restructure
one — only filter it (`RP-7`) — because a fixed report's value is that everyone reads the
same shape and trusts it. This tier is unaffected by anything below.

**Tier 2 — Selectable, row-and-column reports.** Not a new subsystem: the
[Table view](views.md) already renders work items as rows and columns via TanStack Table.
What tier 2 adds is treating a saved table configuration — which columns are checked
visible, in which order, filtered and sorted how — as a first-class **report**, listed
alongside the tier 1 reports rather than buried in a project's view switcher. Saving one
writes a `saved_view` with `layout: 'table'`
([data model](../01-architecture/data-model.md)) and a `shared_with_team_id` or
workspace scope, exactly as [search-and-saved-views.md](search-and-saved-views.md) already
specifies. **No new storage, no new engine — a naming and a placement decision**, so a
person building "open items by requester, columns: key, title, age, assignee" gets an MS
Planner-style grid without leaving the reports index.

**Tier 3 — Customisable reports.** A small ad-hoc report builder for the question a fixed
report does not answer and a table cannot summarise: pick an entity (work items, time
entries, SLA events), the structured filter grammar already in
[API design](../01-architecture/api-design.md) narrows it, a **group by** (project,
assignee, type, priority, custom field, week) aggregates it, and a chart type (bar, line,
table, single number) renders it. Saved the same way as tier 2 — a `saved_view`, this time
with `layout: 'chart'` and a `groupBy` / `aggregate` clause in its `query` — so a
custom report is, structurally, a saved search with an aggregation step, not a distinct
report-definition language. This deliberately stops short of Jira's JQL or Azure DevOps'
full Analytics query surface: no joins across entities, no computed/derived fields beyond
what `custom_field` already provides, no scripting. That covers the reporting equivalent
of "90% of cases with 20% of the concepts," the same bar
[automations.md](automations.md) holds itself to, and the same reason a full formula
engine was rejected for custom fields — see
[decision log](../07-planning/decision-log.md).

## The reports

Carried from v1's set, which was well chosen, grouped by the question being asked. All are
**tier 1 — fixed**.

### Promises — are we meeting what we committed?

| Report | Answers |
| --- | --- |
| SLA attainment | What proportion met, by period |
| SLA trend | Is attainment improving or degrading |
| Breach analysis | Which types, priorities and customers breach most |
| At-risk now | What is about to breach, live |

### Customers — who are we failing?

| Report | Answers |
| --- | --- |
| Performance by customer | Volume, attainment, average resolution, worst first |
| Customer volume trend | Is one customer's demand growing |
| Satisfaction | CSAT by customer and by request type |

### Delivery — are we getting through the work?

| Report | Answers |
| --- | --- |
| Throughput | Items completed per week |
| Work mix | Distribution by type and priority |
| Cycle time | Created to resolved, bucketed |
| Ageing | Open items by age bucket |
| Flow | Where items sit longest |

### People — how is the team?

| Report | Answers |
| --- | --- |
| Workload | Open items per person |
| Stale work | Untouched for N days, by person |
| Utilisation | Logged versus available hours |
| Capacity | Team capacity against committed work |

### Leadership — the portfolio

| Report | Answers |
| --- | --- |
| Portfolio health | RAG across every engagement |
| Predictability | Committed versus delivered per cycle |
| Cost to deliver | Actual against budget by project |
| Escalations | Volume and resolution of escalations |

## Behaviour

- `RP-7` Filter by window (7, 30, 60, 90 days, or custom), project, organisation, team,
  type and priority.
- `RP-8` **The full filter state is in the URL.** Sending a colleague a link to what you
  are looking at must work. *(v1's reports were behind nested tabs with no addresses, and
  this was one of the loudest complaints.)*
- `RP-9` Closed periods read from `metric_snapshot`, computed hourly. The current partial
  period is computed live. The boundary is stated.
- `RP-10` Every report exports to CSV, respecting filters and the viewer's reach. Exports
  are audited.
- `RP-11` Every chart has an accessible table equivalent, reachable by keyboard, because a
  chart alone is not readable by a screen reader.
- `RP-12` Drill-down from any number to the underlying list, filtered identically.
  A metric you cannot interrogate is not trustworthy.

## Dashboards

- `RP-13` A dashboard is a grid of widgets, each a report or a single metric.
- `RP-14` Personal dashboards are per user; workspace dashboards require
  `workspace:manage_settings`.
- `RP-15` Widgets are resizable and draggable, and layout persists.
- `RP-16` A sensible default dashboard exists so a new user sees something useful
  immediately rather than an empty grid with an "add widget" button.

## Permissions

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

## Screens

Reports index with category chips and a KPI strip, grouped by tier; report detail with
filters, chart, table and export; **report builder** (tier 3 — pick entity, filter, group
by, aggregate, chart type, with a live preview, the same discipline as the request-type
form builder's live preview); dashboard; dashboard editor.

The index is a directory, not a dashboard. Its job is to get someone to the right report
in one click, whichever tier it belongs to.

## API

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

## Edge cases

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

## Testing

Unit: every aggregation against fixtures with known answers; the minimum-sample rule;
bucket boundaries; tier 3's `groupBy`/`aggregate` clause against the same filter-grammar
fixtures [API design](../01-architecture/api-design.md) already uses for saved views.

Integration — the important ones: report routes require a capability; a customer session
receives 403 on every report route; results are filtered to reach; exports respect reach;
a tier 2 or tier 3 report saved by one person and shared to a team is visible to that team
and invisible outside it, exactly as [search-and-saved-views.md](search-and-saved-views.md)
specifies for saved views generally, because that is what it is.

E2E: `reports-require-capability.spec.ts`, `customer-cannot-read-reports.spec.ts`,
`tier2-table-report-saved-and-reopened.spec.ts`, `tier3-custom-report-builder.spec.ts`,
plus drill-down from a number to a correctly filtered list.

## Related

- [SLA](sla.md) · [Time and cost](time-and-cost.md)
- [Background jobs](../01-architecture/background-jobs.md)
