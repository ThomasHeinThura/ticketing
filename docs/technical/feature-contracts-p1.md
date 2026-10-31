# P1 feature contracts

These are maintained product requirements, not completion evidence. [Requirement index](../requirements-index.json) retains every original numbered definition and its provenance; [status](../status.md) records implementation and verification separately. Numbered definitions below retain their original wording, including any embedded historical implementation commentary; such commentary is not a current status claim. Standalone historical status, review history and implementation reports are omitted.

Use the original Kaneo composition, components and interactions for every specified screen. Current Thomas decisions and explicit maintained [integration contracts](../contracts.md) take precedence over older alternatives without dropping requirement IDs. Test sections describe required invariants and journeys, not tests claimed to exist or pass. API/schema discrepancies remain work to resolve, not permission to rewrite the requirement to match code.

Current owner decisions take precedence over retained wording: existing Kaneo Calendar/Gantt and their interactions belong in P1; richer planning remains P5. AS-19's unassigned-only default remains, while explicitly confirmed per-holder bulk compare-and-set replacement is permitted by the [canonical bulk contract](../contracts.md#canonical-bulk-integration-wi-2427-as-3). Comment authorship and historical editor/deleter metadata are distinct; follow the [canonical comment contract](../contracts.md#canonical-creation-and-comment-affordances). Original board drag, keyboard movement, animation and rank/transition checks remain required; follow the [default workflow repair](../contracts.md#kaneo-board-interaction-and-default-workflow-repair).

## Features

- [work-items](#work-items)
- [views](#views)
- [projects-and-engagements](#projects-and-engagements)
- [assignment](#assignment)
- [comments-and-activity](#comments-and-activity)
- [attachments](#attachments)
- [relations-and-hierarchy](#relations-and-hierarchy)
- [search-and-saved-views](#search-and-saved-views)

<a id="work-items"></a>
## Work items

- **Primary phase:** P1
- **Feature flag:** always on
- **Depends on:** projects, states, RBAC

<a id="work-items-purpose"></a>
### Purpose

The universal unit of work. A support ticket, a bug, a story, an epic, a change request
and a task are all work items differing only by **type**. One table, one detail screen,
one permission model, one activity stream.

v1 had this right and it is worth restating: separate "ticket" and "task" entities force
duplicated views, duplicated search, duplicated reporting, and an eventual "link a ticket
to a task" feature that nobody enjoys using.

<a id="work-items-concepts"></a>
### Concepts

| Concept | Meaning |
| --- | --- |
| **Work item** | The record |
| **Type** | Determines fields, workflow and SLA policy. Configurable per workspace |
| **Key** | `PROJ-123`. Human-readable, unique per instance, permanent |
| **State** | Position in the type's workflow. Belongs to a state group |
| **Priority** | Urgent / High / Medium / Low |
| **Position** | Fractional rank within a state or backlog, for manual ordering |

<a id="work-items-default-types"></a>
### Default types

Seeded per workspace, all editable.

| Category | Types |
| --- | --- |
| Service | Incident · Service Request · Change · Problem |
| Delivery | Epic · Story · Task · Bug · Sub-task |

A type carries: name, icon, colour, category, its workflow, its default SLA policy,
whether it is an epic, and which custom fields apply.

<a id="work-items-data"></a>
### Data

`work_item`, `work_item_type`, `work_item_key_alias`, `work_item_template`,
`checklist_template`, `checklist_item`, `work_item_relation`, `watcher`, `label`,
`work_item_label`. See [data model](data-model.md).

<a id="work-items-behaviour"></a>
### Behaviour

**Creation**

- `WI-1` Every work item belongs to exactly one project and has exactly one type.
- `WI-2` The key is `{project.key}-{number}`, where `number` comes from
  `project.last_work_item_number` incremented in the same transaction. Never reused, even
  after deletion.
- `WI-3` Title is required, 1–500 characters. Everything else is optional unless a custom
  field is marked required for that type.
- `WI-4` Initial state is the project's own default state (`state.is_default`) — `state`
  carries this directly; `project_state` does not exist, its job folded into the
  project-scoped `state` row itself ([data model](data-model.md) §3,
  `PR-17`). Must be a state the type's workflow can leave — validated when the default is
  set.
- `WI-5` Creating from a `work_item_template` copies title, description, labels, custom
  field values and its linked `checklist_template`'s items, but never assignee or dates.
  Managing templates (create, edit, archive) is a workspace-settings action —
  `workspace:manage_settings` — since `work_item_template` is workspace-scoped; using one
  to create a work item only needs `work_item:create` on the target project.

**Editing**

- `WI-6` Every field change writes an `activity` row with the old and new value.
- `WI-7` Concurrent edits use optimistic concurrency on `version` (`work_item.version`,
  `api-design.md`'s `If-Match` convention). A mismatch returns 409 with both versions so the
  UI can offer a resolution. The one exception is rank: changes go through
  `POST /work-items/{key}/rank` (`WI-11`), are exempt from `If-Match`, and are
  last-write-wins — every other field write is version-checked.
- `WI-7a` Every task response carries an integer `version`; every persisted task-row update
  advances it. First-party full-task writes use `PUT /api/v2/task/{id}` and require
  `If-Match: "<version>"`; the server compares it after locking the task and returns 409 with
  asserted/current versions on mismatch without changing the row or publishing update effects.
  The released `PUT /api/task/{id}` remains compatible during migration: without `If-Match` it
  preserves its prior request behavior, and with a supplied header it strictly validates and
  enforces that version under the same lock. It returns `Deprecation` from 2026-10-01,
  `Sunset` no earlier than 2027-04-01 00:00:00 GMT, and a `successor-version` Link to the v2
  route. Removal requires both the sunset date and two subsequent minor releases, and is never
  automatic. Unversioned third-party legacy requests retain their prior last-write-wins risk
  during migration; this contract protects first-party callers and any version-aware request.
  Narrow status/assignee and task-move routes remain field-scoped and do not require `If-Match`;
  their writes advance the version so an older versioned full-task PUT cannot overwrite them.
  Reordering stays on the existing move/rank path and does not gain a last-write-wins exception
  for other fields.
- `WI-8` Title, description, dates, labels and custom fields may be changed by anyone with
  `work_item:update` on the project. Priority is separate: changing it needs
  `work_item:set_priority`, not `work_item:update` (see the Permissions table below). A
  customer's raise-only path — `work_item:escalate_priority` — is a later slice.
- `WI-9` State changes go through the workflow — see [workflows](feature-contracts-p2.md#workflows). They are
  never a plain field update.
- `WI-10` Assignment follows [assignment rules](feature-contracts-p1.md#assignment).

**Ranking**

- `WI-11` Manual ordering uses fractional positions, so inserting between two items
  changes one row, not many.
- `WI-12` `work_item.position` is `numeric(20,10)`. Positions rebalance in the background
  when the gap between two neighbours falls below `1e-6`: the `position-rebalance` job
  ([background-jobs.md](background-jobs.md)) renumbers the whole
  affected state (or backlog) partition to evenly-spaced values in one transaction.
- `WI-13` Customers may re-rank only work items in their own organisation's backlog.

**Hierarchy**

- `WI-14` A work item may have one parent and any number of children.
- `WI-15` Parent and child must be in the same project. Moving a parent without its
  children **detaches** them (`RH-12`) — the invariant never breaks.
- `WI-16` Cycles are rejected — a work item cannot be its own ancestor.
- `WI-17` Depth is capped at 5 levels.
- `WI-18` Closing a parent does not close its children. Attempting to warns and lists the
  open children.
- `WI-19` A parent shows rolled-up progress over its **whole subtree**: items whose mapped
  `state_template.group in ('completed', 'cancelled')` / total, resolved through each
  item's `state.state_template_id` — `state` itself carries no `group`
  ([data model](data-model.md) §3/§4 — a query needs the join) — defined
  once here; `RH-9` and `RH-14` cite it.

**Deletion and archiving**

- `WI-20` Archiving (`work_item.archived_at`) hides an item from views but preserves it and
  its history.
- `WI-21` Deletion is soft for 30 days (`work_item.deleted_at`), then purged with its
  comments, activity and attachments. `archived_at` and `deleted_at` are independent
  columns: archiving does not start the 30-day purge timer, and an item need not be
  archived before it can be deleted. The default list/board/search filters exclude rows
  where either is set; an explicit filter reveals archived or deleted items.
- `WI-21a` A native realtime deletion hint is emitted only after the approved soft-delete
  transaction commits. Requesting, denying, expiring, cancelling, or invalidating a pending
  deletion emits no `work_item.deleted` hint. Socket delivery follows the key-only
  projection in [realtime.md](#pending-01-architecturerealtime); REST remains authoritative.
- `WI-22` Deleting a parent orphans its children rather than cascading. The user is told.
- `WI-23` Deletion requires `work_item:delete` and goes through a **pending action**
  ([pending-actions.md](#pending-01-architecturepending-actions)): `DELETE` returns `202`,
  the dialog shows key, title, project, requester/portal-visibility impact and the 30-day
  recovery period, and the requesting person approves in the browser. A bulk deletion
  additionally requires the typed affected count. The same applies from the API and from
  MCP — nothing is deleted without the approval, and a model cannot supply it.

**Bulk operations**

- `WI-24` Multi-select supports: change state, assign, set priority, add/remove label,
  archive, delete — and, gated behind `feature.cycles` (P5, [agile.md](feature-contracts-p5.md#agile)), move to
  cycle or module.
- `WI-25` Bulk operations are transactional per item, not per batch: 47 of 50 succeeding
  reports 3 failures with reasons rather than rolling everything back. A failure reason
  must not reveal whether an inaccessible work item exists: "not found" and "out of
  reach" use the same per-item reason.
- `WI-26` Bulk operations respect workflow legality per item — an illegal transition for
  one item does not block the other 49.
- `WI-27` Bulk operations write one audit row per item plus one summary row.

**Watchers**

- `WI-28` Anyone with read access may watch. Watchers receive notifications per their
  preferences.
- `WI-29` Assignee and requester are watchers implicitly (`watcher.source = 'implicit'`)
  and may opt out — opting out sets `watcher.muted`, a suppression flag, rather than
  deleting the row, so an unmute later needs no new implicit watch to be recreated.

<a id="work-items-permissions"></a>
### Permissions

| Action | Capability | Extra rules |
| --- | --- | --- |
| Read | `work_item:read` | Plus reach on the project |
| Create | `work_item:create` | |
| Update fields | `work_item:update` | |
| Change state | `work_item:transition` | Plus workflow legality for the role |
| Assign | `work_item:assign` | Plus [assignment rules](feature-contracts-p1.md#assignment) |
| Set priority | `work_item:set_priority` | |
| Escalate priority only | `work_item:escalate_priority` | The customer capability |
| Re-rank | `work_item:rank` | Customers: own organisation only |
| Delete | `work_item:delete` | Pending action — explicit click; bulk additionally requires the typed count (`WI-23`) |
| Archive | `work_item:update` | |
| Watch / unwatch | `work_item:read` | Deliberate — `WI-28` already lets anyone with read access watch; this is not an omission |
| Manage work item templates | `workspace:manage_settings` | `work_item_template` is workspace-scoped (`WI-5`) |

<a id="work-items-screens"></a>
### Screens

Board, list, table, detail page, detail side pane, create dialog, bulk edit bar.
See [screen inventory](#pending-02-designscreen-inventory).

The detail view follows progressive disclosure strictly: state, assignee, priority and due
date in the header; description and activity in the body; everything else in collapsible
sections. v1's twenty-plus-field header is the specific mistake being avoided.

Editing on the detail page (UI decisions the rules above do not fix; none conflicts with them):

- The edit form sends only the fields the user changed (`WI-8` is a partial `PATCH`), and
  Save is disabled while nothing differs from the values the form was opened with, so an
  empty `PATCH` is never attempted. Reverting a field to its original value is not a change.
- `startDate` and `dueDate` are stored UTC instants. The form edits only the calendar day:
  moving a date keeps its stored UTC time of day, a date set where none existed lands on
  UTC midnight, and an untouched date is never sent. A date is therefore never silently
  rewritten to midnight by an unrelated edit.

<a id="work-items-label-catalogues"></a>
### Label catalogues

`WI-8` labels may come from the workspace catalogue or the item's own project catalogue.
Project settings extends Kaneo's existing settings frame with label create/edit/delete;
work-item properties combines the two catalogues and identifies their scope. Names are
unique within each catalogue, so equal names in separate catalogues remain distinct labels.
Project label mutations require `label:manage` plus current project reach; reading requires
`workspace:read` plus project reach. `GET /api/capabilities` returns the strict
`manageLabels` boolean for `label:manage`; absence fails closed in the project UI.
The inherited workspace/task-label routes do not expose
project catalogue entries. Deletion removes assignments and advances affected work-item
versions with internal activity/events, as workspace catalogue deletion already does.

Typed routes: `GET`/`POST /api/label/project/{projectId}/catalogue` and
`PATCH`/`DELETE /api/label/project/{projectId}/catalogue/{id}`. Each reads its workspace from the
addressed live project, never a client-supplied workspace id. Duplicate creation is
idempotent; rename to another label's name returns conflict. Assignment retains `WI-7`
version checks and cannot select another project's label, even within the same workspace.

<a id="work-items-api"></a>
### API

```
GET    /api/projects/{projectId}/work-items                            work_item:read  — sort=key|position|title|priority|dueDate, dir=asc|desc; sort=position is the board's per-column rank order (WI-11); list endpoint only, structured search does not accept it
GET    /api/projects/{projectId}/states                                project:read  — active concrete states, including empty board columns, in project order (VW-8)
POST   /api/projects/{projectId}/work-items                            work_item:create
POST   /api/work-items/search                                          work_item:read
GET    /api/work-items/{key}                                            work_item:read
PATCH  /api/work-items/{key}                                            work_item:update
DELETE /api/work-items/{key}                                            work_item:delete
GET    /api/work-items/{key}/transitions                                work_item:read  — legal offers for this actor now, each carrying toStateName
POST   /api/work-items/{key}/transition                                 work_item:transition
POST   /api/work-items/{key}/assign                                     work_item:assign
POST   /api/work-items/{key}/rank                                       work_item:rank  — exempt from If-Match, last-write-wins (WI-7)
POST   /api/work-items/{key}/watch                                      work_item:read  — deliberate, see Permissions
DELETE /api/work-items/{key}/watch                                      work_item:read  — deliberate, see Permissions
POST   /api/work-items/bulk                                             work_item:read  (workspace) — then each item is re-checked against its own capability; failures reported per WI-25
GET    /api/work-items/{key}/activity                                   work_item:read
GET    /api/workspace/{workspaceId}/work-item-types                     workspace:read
GET    /api/workspaces/{id}/work-item-templates                        workspace:read
POST   /api/workspaces/{id}/work-item-templates                        workspace:manage_settings
PATCH  /api/workspaces/{id}/work-item-templates/{templateId}            workspace:manage_settings
DELETE /api/workspaces/{id}/work-item-templates/{templateId}           workspace:manage_settings
POST   /api/projects/{projectId}/work-items/from-template/{templateId}  work_item:create
```

<a id="work-items-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Project key renamed | Existing keys keep the old prefix. Renaming is discouraged and warns |
| Moved to another project | Key is retained. A `work_item_key_alias` row redirects the old key so old links work |
| Type changed | Allowed. State maps to the new workflow's default if the current state does not exist there. Written to activity |
| Assignee leaves | Assignment retained and shown as "(inactive)". Not silently unassigned |
| Custom field deleted | Values retained but hidden. Restorable for 30 days |
| Title of 500 characters | Truncated with ellipsis in lists, full in detail and in the tooltip |
| 10,000 items in one project | Board virtualises. List paginates. Table virtualises |
| Two people drag the same card | Last write wins on position; both see the result via WebSocket |

<a id="work-items-out-of-scope"></a>
### Out of scope

- SLA behaviour → [sla.md](feature-contracts-p2.md#sla)
- State transition rules → [workflows.md](feature-contracts-p2.md#workflows)
- Custom field definitions → [custom-fields.md](feature-contracts-p4.md#custom-fields)
- Comments → [comments-and-activity.md](feature-contracts-p1.md#comments-and-activity)

<a id="work-items-testing"></a>
### Testing

**Unit** — key generation and uniqueness; fractional ranking including rebalance;
hierarchy cycle detection; depth cap.

**Integration** — create/update/delete with policy; optimistic concurrency 409; bulk
partial failure; cross-project move with alias.

**E2E** — create from board; drag between columns; open detail from list and from URL;
bulk assign; keyboard-only creation and state change.

**Performance** — board with 200 items renders under 500 ms; table with 500 rows renders
under 500 ms.

<a id="work-items-open-questions"></a>
### Open questions

None.

<a id="work-items-related"></a>
### Related

- [Views](feature-contracts-p1.md#views) · [Workflows](feature-contracts-p2.md#workflows) · [Assignment](feature-contracts-p1.md#assignment)
- [Relations and hierarchy](feature-contracts-p1.md#relations-and-hierarchy)
- [ADR 0011 — one generic lifecycle engine](#pending-01-architectureadr0011-ticket-lifecycle-engine)

<a id="views"></a>
## Views and layouts

- **Primary phase:** P1
- **Feature flag:** per layout — `feature.calendar`, `feature.timeline` (Board, List and Table are always on).
  `feature.timeline` was `feature.gantt`; the UI says Timeline. The flag identifier is owned by
  [plugin-architecture.md](features.md) and is not renamed here.
- **Depends on:** work items, states ([work items](feature-contracts-p1.md#work-items)); the structured filter and saved views
  ([search and saved views](feature-contracts-p1.md#search-and-saved-views)). **Later-phase inputs, each unavailable until
  its stage lands:** SLA state for the `VW-16` badge and the `VW-31` SLA filter (P2,
  [sla.md](feature-contracts-p2.md#sla)); custom fields for `VW-19`/`VW-31` custom-field columns and filters (P4,
  [custom-fields.md](feature-contracts-p4.md#custom-fields)); cycle, module and epic for `VW-27` grouping and the
  `VW-31` filters (P5, [agile.md](feature-contracts-p5.md#agile)); Calendar and Timeline themselves (P5).

<a id="views-purpose"></a>
### Purpose

One set of work, five ways of looking at it. Switching how you look must never change
*what* you are looking at.

v1 had board, backlog, list and sprints as four separate destinations, and moving between
them lost your filters. Here there is one destination — `/work` — with a layout parameter.

```
/agent/projects/{key}/work?layout=board&state=started&assignee=me
                                 ▲            ▲
                            presentation    the actual query
```

<a id="views-layouts"></a>
### Layouts

| Layout | Best for | Stage |
| --- | --- | :-: |
| **Board** | Flow. What is where, what is stuck | P1 |
| **List** | Reading. Grouped, scannable, dense | P1 |
| **Table** | Comparing. Sortable columns, inline edit | P1 |
| **Calendar** | Dates. What is due when | P5 |
| **Timeline** | Sequence. Dependencies and duration | P5 |

Backlog is a separate destination rather than a layout, because it has different semantics
— ranking rather than filtering.

<a id="views-behaviour"></a>
### Behaviour

**Shared across layouts**

- `VW-1` Filter, sort, grouping and search live in the URL and survive a layout switch. The board and timeline grouping is `group` (`assignee` or `priority`; `state` is the default and never written), the calendar range is `calendarView` (`week` or `day`) anchored on `date` (`YYYY-MM-DD`), and `month` still names the month view.
- `VW-2` Layout choice is remembered per project per user, and the URL always wins. See
  [Per-user preferences](feature-contracts-p1.md#views-per-user-preferences).
- `VW-3` Every layout supports multi-select and the same bulk action bar.
- `VW-4` Every layout opens the detail side pane on selection, and the pane's route is
  addressable.
- `VW-5` Every layout receives WebSocket updates and reflects other people's changes live.
- `VW-6` Every layout honours the comfortable/compact density preference.
- `VW-7` Empty, loading and error states are designed per layout — a board skeleton has
  columns, a table skeleton has rows.

<a id="views-per-user-preferences"></a>
#### Per-user preferences

`VW-2` (layout), `VW-6` (density), `VW-15` (collapsed groups), `VW-19` (chosen columns) and
`VW-21` (column widths) are per-user interface preferences, not shared query state, so none
of them lives in `saved_view` (a shared query object). Their authoritative home in the data
model is `user_preference` (`person_id`, `scope`, `scope_id`, `key`, `value jsonb` —
[data model](data-model.md)); no new table is needed.

The contract is that these preferences persist in `user_preference`, so they follow the
person across devices and browsers. The routes, key mapping, whitelist, policy and limits are
specified in [settings-hierarchy.md](feature-contracts-p4.md#settings-hierarchy-profile-settings-routes)
(`GET`/`PATCH /api/me/settings`, `ST-12`–`ST-17`); this section does not repeat them.

- `VW-2` is the settings key `layout.<projectId>` (`board`, `list` or `table` in P1). It reads and
  writes through `GET`/`PATCH /api/me/settings`, keeps `localStorage` as a first-paint cache,
  writes an existing local value to the server once, and always lets the URL layout win.
- `VW-6` is the settings key `density` (`comfortable` or `compact`), one value per person, not
  per project, and is persisted server-side. The `user-preferences` store's `compactMode` flag
  is the first-paint cache.
- If the server is unreachable or rejects a read or write, the cache keeps working and the next
  load reconciles it. The UI never blocks on the route.
- `VW-15` is the settings key `listGroups.<projectId>` (the collapsed group ids, at most 50) and `VW-19` is
  `columns.<projectId>` (the chosen table columns in display order); both approved by the owner and registered with
  their value schemas in the settings whitelist ([`ST-14`](feature-contracts-p4.md#settings-hierarchy-profile-settings-routes)).
  A `columns` URL parameter still wins over the stored choice. Custom-field columns wait for P4.
- `VW-21`: Thomas approved `columnWidths.<projectId>` on 25 October 2026: a map of registered column IDs to integer widths of 64–800 px, at most 100 entries. It uses project-scoped `user_preference` rows and the existing settings API.

**Board**

- `VW-8` Columns map to states. Column order is the state order configured for the project.
- `VW-9` Dragging a card between columns performs a **workflow transition**, not a field
  update. An illegal drop returns the card and explains why.
- `VW-10` Dragging within a column changes rank.
- `VW-11` Cards virtualise above 50 per column.
- `VW-12` Column headers show a count and, optionally, a work-in-progress limit that turns
  amber when exceeded.
- `VW-13` Grouping may be switched from state to assignee, priority, label or custom
  field. Grouping by anything other than state disables drag-to-transition and enables
  drag-to-set-that-field.
  Thomas chose all-label grouping on 25 October: a card appears under every assigned
  label. Dragging between label groups replaces only the source label and preserves
  the others; dropping into `(None)` clears all labels.
- `VW-14` Full keyboard drag: focus a card, `Space` to lift, arrows to move, `Space` to
  drop, `Escape` to cancel, with live-region announcements.

**List**

- `VW-15` Grouped by state by default, with collapsible groups whose state persists (`listGroups.<projectId>`, see above).
- `VW-16` Each row shows key, title, assignee, priority, SLA badge and due date.
- `VW-17` Inline editing of state, assignee and priority without leaving the row.
- `VW-18` Virtualised above 100 rows.

**Table**

- `VW-19` Columns are chosen by the user, including custom fields. The choice persists per
  project per user (`columns.<projectId>`; custom-field columns wait for P4).
- `VW-20` Sortable by any column. Multi-column sort with modifier-click.
- `VW-21` Column widths are draggable and persist.
- `VW-22` Inline editing where the field type allows.
- `VW-23` Export the current view to CSV, respecting filters and column choice,
  through `POST /api/work-items/export` with `work_item:export` — a server-side route with a
  policy, because a bulk-egress path with no declared capability is the class of hole the
  route-coverage test exists to prevent. Exports are audited (`work_item.exported`).
  `work_item:export` is the capability [rbac.md](permissions.md) defines for
  exporting "a view or list"; `report:export` guards report exports and does not apply.
  Per owner decision D1 (2026-10-19; [decision log](#pending-07-planningdecision-log)), the
  response streams CSV (`text/csv; charset=utf-8`) in paginated cursor batches without
  buffering the full dataset in memory, with a hard cap of **10,000 rows** per export (if
  the filtered match count exceeds 10,000, the route returns `422` with code
  `export_limit_exceeded` and the total count so the user narrows their filter), a **30-second**
  query timeout, and a rate limit of **5 exports per minute per user**.
- `VW-24` Virtualised rows and columns.

**Calendar**

- `VW-25` Month, week and day. Items appear on their due date; items with a start date
  span.
- `VW-26` Dragging changes the date, subject to permission.

**Timeline**

- `VW-27` Bars from start to due date, grouped by assignee, module or epic.
- `VW-28` Dependency arrows for `precedes` and `blocks` relations, toggleable — they
  become noise on a dense chart.
- `VW-29` Dragging a bar changes dates; dragging an edge changes duration.
- `VW-30` A form-based date editor is the accessible alternative to dragging.

<a id="views-filtering"></a>
### Filtering

The filter bar composes into the structured filter grammar described in
[API design](#pending-01-architectureapi-design).

- `VW-31` Filters available, by phase. The P1 whitelist, operators and value types are the
  table in [API design](#pending-01-architectureapi-design-work-item-search-v1-post-api-work-itemssearch):
  state group, type, assignee, priority, due date, created date, watcher and project. The
  rest are part of this rule but unavailable until their owning stage — a recognised
  field that is not yet backed returns `422` naming it, never an empty or unfiltered result:
  - **No backing store yet:** label (needs the `work_item_label` join), requester, any
    custom field (`cf.<key>`, P4).
  - **P2:** SLA state — see [SLA filtering](feature-contracts-p1.md#views-sla-filtering).
  - **P5:** cycle, module, epic ([agile.md](feature-contracts-p5.md#agile)).
  - **`organisation`** is not a `work_item` column. It resolves through the project join,
    `work_item.project_id → project.organisation_id` (API design, "Fields are whitelisted per
    entity"); an internal project has a null organisation and matches no organisation value.
- `VW-32` `@me` is a first-class value for assignee, requester and watcher, so a saved
  view can be personal without being per-person.
- `VW-33` Filters combine with AND by default; an advanced editor exposes OR and nesting.
- `VW-34` The active filter is always visible as removable chips. A view that is filtered
  must never look unfiltered — that is how people conclude their data is missing.

<a id="views-sla-filtering"></a>
#### SLA filtering

`VW-16` (the SLA badge on list rows) and the `VW-31` SLA-state filter depend on SLA (P2).
Authoritative SLA state is never stored ([ADR 0009](#pending-01-architectureadr0009-lazy-sla-evaluation),
[sla.md](feature-contracts-p2.md#sla)), so the mechanism is already decided and this spec adopts it:

- **Badge:** computed on read by the shared `packages/domain/src/sla/` function, the same
  one the detail endpoint uses. The computed value always wins.
- **Filter and sort:** `sla.state` and `sla.due_at` compile against `work_item_sla_cache`
  ([data model](data-model.md)), refreshed by `sla-scan` every five
  minutes and therefore **eventually consistent**. A list filtered by SLA can disagree
  with a row's freshly computed badge by up to that interval, and the UI says so beside the
  filter.
- **Unavailable backing:** until the SLA cache and loader are available, search returns `422` naming `sla.state`/`sla.due_at`; it never returns an unfiltered or empty result as a substitute. SLA filtering belongs to P2.

<a id="views-saving"></a>
### Saving

Any filter plus layout plus grouping plus columns can be saved as a view. See
[search and saved views](feature-contracts-p1.md#search-and-saved-views).

<a id="views-data"></a>
### Data

No table is owned here. Views read `work_item` (and its joins) through the search route;
saved configurations are `saved_view` ([search and saved views](feature-contracts-p1.md#search-and-saved-views));
per-user preferences are covered under [Per-user preferences](feature-contracts-p1.md#views-per-user-preferences).

<a id="views-permissions"></a>
### Permissions

Reading a view requires `work_item:read` and reach on the project. Each action within a
layout requires its own capability, as below (capabilities and the routes' policies are
authoritative in [rbac.md](permissions.md) and `apps/api/src/work-item/policy.ts`).
Where the actor lacks the capability, the control is disabled or the card is not draggable, and
the reason is available on hover.

| Action | Rule | Capability | Required route |
| --- | --- | --- | --- |
| Read any layout | `VW-1`, `VW-4` | `work_item:read` plus project reach | `POST /api/work-items/search` |
| Drag card between columns, inline state edit | `VW-9`, `VW-17`, `VW-22` | `work_item:transition` | `POST /api/work-items/{key}/transition` |
| Drag within a column (rank) | `VW-10` | `work_item:rank` | `POST /api/work-items/{key}/rank` |
| Inline assignee edit; drag to an assignee group | `VW-13`, `VW-17` | `work_item:assign` | `POST`/`DELETE /api/work-items/{key}/assign` |
| Inline priority edit; drag to a priority group | `VW-13`, `VW-17` | `work_item:set_priority` (field-level check on the `PATCH`) | `PATCH /api/work-items/{key}` |
| Drag to another label or custom-field group | `VW-13` | `work_item:update` | `PATCH /api/work-items/{key}`; label and custom-field values have no store yet |
| Inline edit of other fields | `VW-22` | `work_item:update` | `PATCH /api/work-items/{key}` |
| Calendar date drag; Timeline bar and edge drag; date editor | `VW-26`, `VW-29`, `VW-30` | `work_item:update` | `PATCH /api/work-items/{key}` (P5) |
| Bulk action bar | `VW-3` | The capability of each operation, checked per item; the route itself declares `work_item:read` | `POST /api/work-items/bulk` |
| Export | `VW-23` | `work_item:export` | `POST /api/work-items/export` |
| Save as a view | Saving | `saved_view:create`; sharing per `SV-15`–`SV-18` | `POST /api/views` |

<a id="views-screens"></a>
### Screens

`/agent/projects/{key}/work?layout=board|list|table|calendar|timeline` — see the
[screen inventory](#pending-02-designscreen-inventory). Board, List and Table are P1; Calendar
and Timeline are P5.

<a id="views-api"></a>
### API

Views add no routes of their own beyond export. Layout and density are presentational and reach
the server only as per-user settings through `GET`/`PATCH /api/me/settings`
([settings-hierarchy.md](feature-contracts-p4.md#settings-hierarchy-profile-settings-routes)); the table's chosen
columns determine which fields are requested.

| Route | Policy | Used for |
| --- | --- | --- |
| `POST /api/work-items/search` | `work_item:read`, workspace from the body, project reach | Every layout's read, with the structured filter ([API design](#pending-01-architectureapi-design-work-item-search-v1-post-api-work-itemssearch)) |
| `GET /api/projects/{projectId}/states` | `project:read`, project reach required | `VW-8`: the board's columns, including empty ones, in project order |
| `GET /api/work-items/{key}/transitions` | `work_item:read` | `VW-9`: the legal offers the transition control shows, each with `toStateName`; the control itself is shown from the `transitionTasks` flag of `/api/capabilities` |
| `POST /api/work-items/{key}/transition` | `work_item:transition` | `VW-9`, `VW-17`, `VW-22` |
| `POST /api/work-items/{key}/rank` | `work_item:rank` | `VW-10` (within-column order is read with `sort=position` on the list route; shown from the `rankTasks` flag) |
| `POST /api/work-items/{key}/assign` | `work_item:assign` (or self-target with `work_item:update`) | `VW-13`, `VW-17` |
| `PATCH /api/work-items/{key}` | `work_item:update`; `priority` also needs `work_item:set_priority` | `VW-13`, `VW-22`, `VW-26`, `VW-29` |
| `POST /api/work-items/bulk` | `work_item:read` at the route, per-operation capability inside | `VW-3` |
| `POST /api/work-items/export` | `work_item:export`, audited `work_item.exported` | `VW-23` (streamed CSV, 10,000-row cap, 30s timeout, 5/min/user rate limit) |

Layout and density use `/api/me/settings` (see above); column and width choices have no route yet.
Saving a view uses the routes in [search and saved views](feature-contracts-p1.md#search-and-saved-views).

<a id="views-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| 10,000 items match | Virtualised. The board shows the first 200 per column with "load more" |
| A state has no items | The column still renders, with an empty affordance and a create button |
| Grouping field is null for some items | An "(None)" group, always last |
| Two people drag the same card simultaneously | Last write wins on rank; both see the result live |
| Filter references a deleted label | Chip shows "(deleted)" and can be removed |
| Layout disabled by feature flag | The switcher hides it; a URL requesting it falls back to board with a toast |
| Very long title | Truncated with ellipsis, full text in tooltip and detail |
| Cross-column drop onto a column with unloaded cards | The card moves to the new state and is ranked against the cards loaded in that column only, so it may not sit at the exact slot among all cards until "Load more" has loaded them or the next rank. A known limit; placing by slot among all cards needs a server-side rule |

<a id="views-out-of-scope"></a>
### Out of scope

- Backlog ranking → [work-items.md](feature-contracts-p1.md#work-items)
- Cycle and module views → [agile.md](feature-contracts-p5.md#agile)

<a id="views-testing"></a>
### Testing

Required coverage is named by invariant below. File names are trace references, not assertions that a test exists or passes.

Unit:

- `VW-1` URL state round-trips through a layout switch — `router-search-codec.test.ts`,
  `project-board-search.test.ts`, `project-layout-navigation.test.ts`.
- `VW-2` "isolates the remembered layout by user and project" and "ignores invalid and
  unavailable storage values" — `project-layout-preference.test.ts`; the URL layout
  beating the remembered one is in the board route test below.
- `VW-6` / `ST-17` "migrates an existing local compact value to the server exactly once",
  "adopts the server value over the local cache", "keeps the local cache and writes nothing
  when the server read fails" and "keeps a failed local change dirty and pushes it instead of
  the stale server value" — `apps/web/src/hooks/use-density-preference.test.tsx`;
  `apps/web/src/lib/user-preference-sync.test.ts`.
- `VW-2` layout migration-once, URL-wins and offline fallback remain required for the web layout wiring.
- `VW-31` "round-trips nested in/OR terms through the canonical AST" and "rejects arbitrary
  entities, unknown fields, and unavailable backing fields" —
  `tests/api/work-item-search-query.test.ts`.
- `VW-31` "organisation resolves through the project join".
- `VW-20`/`VW-10` sort order and rank arithmetic —
  `tests/api-integration/work-item-list-sort-pagination.test.ts`,
  `tests/api-integration/work-item-rank.test.ts` ("WI-11: ranking between two neighbours
  lands strictly in between and bumps version").
- `VW-13` "grouping by a non-state field disables drag-to-transition".

Integration:

- `VW-1`/`VW-31` search returns only items within reach, and an unavailable field is `422` —
  `tests/api-integration/work-item-structured-search.test.ts`.
- `ST-12`–`ST-16` self-only rows, layout reach `404`, whitelist and schema `422`, API-key
  `403 session_required`, upsert idempotence, `413` and row limit — `tests/api-integration/user-preference.test.ts`.
- `VW-9` "an illegal drag-transition is refused with a reason" —
  `tests/api-integration/work-item-transition.test.ts` ("409s when no transition matches the
  requested target from the current state", "GET /transitions returns only the legal edge,
  disabled with a reason when blocked").
- `VW-10` "permissions: a caller without work_item:rank is refused 403" —
  `tests/api-integration/work-item-rank.test.ts`.
- `VW-23` "export without work_item:export is 403" and "export writes work_item.exported" —
  required for `POST /api/work-items/export`.

Required web route cases: `board.test.tsx` ("lets
the URL layout win over the remembered and profile layouts"), `backlog.test.tsx` and
`calendar.test.tsx` for `VW-1`/`VW-2`/`VW-4`.

Realtime: `VW-5` "refreshes active list, detail, and activity queries once per socket event
burst" — `apps/web/src/hooks/use-native-work-item-realtime.test.tsx`.

E2E: `VW-1` switch layout and confirm filters persist; `VW-14` keyboard-only board drag;
`VW-5` two browser contexts see each other's drag.

Performance: board with 200 items under 500 ms; table with 500 rows under 500 ms; no
dropped frames during drag.

<a id="views-open-questions"></a>
### Open questions

*(None — `VW-23` export bound and delivery resolved by owner decision D1 on 2026-10-19; see
[decision log](#pending-07-planningdecision-log).)*

<a id="views-related"></a>
### Related

- [Work items](feature-contracts-p1.md#work-items) · [Search and saved views](feature-contracts-p1.md#search-and-saved-views)

<a id="projects-and-engagements"></a>
## Projects and engagements

- **Primary phase:** P1 (delivery structure in P2)
- **Feature flag:** always on
- **Depends on:** workspaces, RBAC, organisations

<a id="projects-and-engagements-purpose"></a>
### Purpose

The container for work, and the unit at which access, workflow, SLA and reporting are
scoped.

<a id="projects-and-engagements-two-kinds"></a>
### Two kinds

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

<a id="projects-and-engagements-concepts"></a>
### Concepts

| Concept | Meaning |
| --- | --- |
| **Project** | The container. Belongs to a workspace, serves a customer organisation |
| **Parent** | A project may have a parent, forming a hierarchy |
| **Roster** | The people who are members of this project |
| **Stakeholder** | Someone on the escalation path, with or without a login |
| **Milestone** | A dated marker — kick-off, go-live, quarterly review |
| **Prerequisite** | Something that must be true before work can proceed, with an owner |

<a id="projects-and-engagements-data"></a>
### Data

`project`, `project_feature_flag`, `state` (project-scoped; each row maps to a
workspace-scoped `state_template`, `PR-17`), `milestone`, `prerequisite`, `stakeholder`,
`document_link`, `membership` (project-scoped roster rows). See
[data model](data-model.md) for full columns.

<a id="projects-and-engagements-hierarchy"></a>
### Hierarchy

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

<a id="projects-and-engagements-composition-rules"></a>
### Composition rules

From v1. Validated at save. Every rule below is **warning**-only by default — the save
succeeds and the violation appears as a persistent banner on the project overview —
except where marked **blocking**, which refuses the save (`422`) naming the failing rule.
`PR-9` is the one blocking rule: a managed service's SLA cannot be computed at all without
a calendar, which is a technical impossibility rather than a stylistic preference. Every
other rule below already has its blocking/warning behaviour confirmed by the edge-case
table further down.

- `PR-6` **(warning)** A project must have exactly one project manager
  (`project.manager_id → person`; see [data model](data-model.md)).
- `PR-7` **(warning)** A project must have at least one team member.
- `PR-8` **(structural — not a save-time check)** Staff and customer access can never be
  mixed on one project's roster. This needs no validation because it cannot occur: the
  `customer` role is the one system role scoped to `organisation`
  ([rbac.md](permissions.md)); every other built-in role is scoped to
  `workspace` or `project`; and a `membership` row carries exactly one `role_id`. A
  project-scoped `membership` can therefore never hold the `customer` role, and there is
  nothing for this rule to warn about or block.
- `PR-9` **(blocking)** A managed service must have a support level and a service
  calendar. The persisted project row uses `kind = managed_service`; `support_level` is
  the canonical `L1 | L2 | L3` vocabulary from the glossary, and `service_calendar_id`
  must identify a calendar in the same workspace. Create and update reject an incomplete
  managed-service configuration with `422` naming PR-9; PostgreSQL also enforces the
  required fields and workspace binding.

Project configuration and health are available at the existing project detail/update
routes. Health is nullable RAG (`red | amber | green`) and can be read or changed at
`GET /api/project/{id}/health` and `PATCH /api/project/{id}/health`; it is set by a person,
not computed. Project create/update accept `kind`, `supportLevel`, and `serviceCalendarId`. Create
requires `project:create`. On update, sending any of `kind`, `supportLevel` or
`serviceCalendarId` (SLA and calendar assignment) requires the strict `project:manage_settings`
capability (and the API-key scope, for a key), the same as `defaultCommentVisibility`; a
caller holding only `project:update` (for example a lead) gets `403` and nothing is written.
Health stays on `project:update`.

**Customer organisation binding.** `project.organisation_id` is chosen at creation only
(decision log 2026-10-13, "Recovered record: Bind customer-serving projects at creation").
`POST /api/project` accepts an optional `organisationId`: omitted or null leaves the project
internal; otherwise it must name an active, non-deleted, non-internal organisation, and the
workspace must be one of the internal organisation's own. Any other value is refused with one
`422` (`organisation_must_be_an_active_customer_organisation`) that does not say which check
failed. The general update route never accepts the field, so an existing project cannot be
rebound, and existing projects are not backfilled. `GET /api/project/organisations` (gated by
`project:create`) lists the organisations the create-project selector offers. The list is
instance-wide (customer organisations are not tied to a workspace), and both it and a create
that carries an `organisationId` require the strict `project:create` capability, held by
owner, admin and manager only; the legacy member permission does not suffice. Creating an
internal project (no `organisationId`) keeps its existing check. Custom roles cannot bind until the capability migration (#7); the create-project
selector is shown only to callers whose `GET /api/capabilities` response sets
`bindProjectOrganisation`.
- `PR-10` **(warning)** A project must have a start date; an end date is optional.

Rule violations appear as a persistent banner on the project overview rather than blocking
work, because half-configured projects exist in reality and blocking them makes people
work around the tool.

<a id="projects-and-engagements-engagement-structure"></a>
### Engagement structure

Present on both kinds, more used on projects.

**Summary** — objective, in scope, out of scope, success criteria, health (RAG, set by a
person not computed), status note with a timestamp. A lifecycle **status** —
planning, active, on hold, closed — sits beside health (owner decision D1, 31 Oct 2026). It
is information only: archiving and deletion keep their own meaning.

**Contract and hour bank** (owner decision D2, 31 Oct 2026) — at most one per project:
start, end, contracted hours, coverage (9x5, 12x5, 24x7), kickoff status (pending,
scheduled, completed) and kickoff date. Hours used are the billable time entries on the
project dated inside the period. The derived state is, in order: expired (after the end
date), kickoff pending, expiring (30 days or fewer left), active.

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

<a id="projects-and-engagements-behaviour"></a>
### Behaviour

- `PR-13` A project key is 2–8 uppercase characters, unique per instance (enforced by
  `create unique index on project (key)` — [data model](data-model.md)),
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
  out of. See [ADR 0011](#pending-01-architectureadr0011-ticket-lifecycle-engine) and
  [workflows.md](feature-contracts-p2.md#workflows) `WF-2`.
- `PR-18` Feature flags are per project, so a simple project shows a simple interface.
- `PR-20` **Deleting a project is a pending action**
  ([pending-actions.md](#pending-01-architecturepending-actions)): `DELETE /api/projects/{projectId}`
  returns `202`; the dialog shows the affected work items, members, attachments and
  integrations and the 30-day recovery / purge behaviour (`PR-16`); the requester approves
  with the **typed project key + step-up**. The same applies from the API and from MCP; a
  service key cannot request it (`PA-5`). Archiving (`PR-15`) is not a deletion and needs no
  pending action.

<a id="projects-and-engagements-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| See | `project:read` + reach |
| Create | `project:create` |
| Edit settings | `project:manage_settings` — never `parent_id` or `owner_team_id` |
| Manage members; re-parent; change owning team | `project:manage_members` — the two reach-affecting fields (`parent_id`, `owner_team_id`) go through `PATCH /api/projects/{projectId}/ownership`, not the general settings route ([rbac.md](permissions.md)) |
| Manage stakeholders, milestones, prerequisites, document links; set health | `project:update` |
| Archive | `project:archive` |
| Delete | `project:delete` — a **pending action**: typed project key + step-up, approved by the requester in the browser ([pending-actions.md](#pending-01-architecturepending-actions)) |

<a id="projects-and-engagements-screens"></a>
### Screens

Project overview, work surface, plan (milestones and prerequisites), stakeholders, and the
settings group. See [screen inventory](#pending-02-designscreen-inventory).

The overview is the screen a project manager opens every morning. It shows health, current
milestone, blocking prerequisites, SLA state summary, open work by state, and recent
activity — and nothing else.

<a id="projects-and-engagements-api"></a>
### API

```
GET    /api/projects                                          project:read
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
DELETE /api/projects/{projectId}/document-links/{id}          project:update  — no PATCH: a link is add-or-remove only; editing its url or title is remove-then-re-add
GET    /api/projects/{projectId}/health                       project:read
PATCH  /api/projects/{projectId}/health                       project:update
GET    /api/project/{id}/overview                             project:read            — derived counts, current/overdue milestones, facts, effective SLA targets (0213)
PATCH  /api/project/{id}/summary                              project:update          — summary fields and lifecycle status; audited project.summary_updated
GET    /api/project/{id}/contract                             project:read            — contract, derived state, aggregate hour bank (D3); the last five billable entries (date, minutes, item only) only with time_entry:read_any, else [] and recentEntriesVisible=false
PUT    /api/project/{id}/contract                             project:manage_settings — upsert; audited project_contract.set; returns the GET shape under the same time_entry:read_any rule
```

<a id="projects-and-engagements-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Project moved to a different parent | Inherited memberships recalculated; a preview shows who gains and loses access |
| Parent archived with active children | Refused. Children must be archived first |
| Customer organisation changed | Portal visibility changes immediately; strongly warned |
| Key collides | Refused at 409 with a suggestion |
| Project with no members | Allowed; the composition banner says so |
| Managed service with no calendar | Refused — SLA cannot be computed without one |
| 4-level hierarchy with a 5th attempted | Refused with an explanation |

<a id="projects-and-engagements-out-of-scope"></a>
### Out of scope

- Cycles and modules → [agile.md](feature-contracts-p5.md#agile)
- SLA binding → [sla.md](feature-contracts-p2.md#sla)
- Time and budget → [time-and-cost.md](feature-contracts-p5.md#time-and-cost)

<a id="projects-and-engagements-testing"></a>
### Testing

Unit: composition validation; hierarchy depth; inherited membership resolution.

Integration: reach through inherited membership; archiving cascades correctly; a customer
sees only projects serving their organisation.

E2E: create a project, add members, set milestones, observe the composition banner clear
as rules are satisfied.

<a id="projects-and-engagements-open-questions"></a>
### Open questions

None.

<a id="projects-and-engagements-related"></a>
### Related

- [Multi-tenancy](workspace-boundaries.md) · [RBAC](permissions.md)
- [Settings hierarchy](feature-contracts-p4.md#settings-hierarchy)

<a id="assignment"></a>
## Assignment

- **Primary phase:** P1
- **Feature flag:** always on
- **Depends on:** work items, RBAC, projects

<a id="assignment-purpose"></a>
### Purpose

Decide who is doing a piece of work, without letting anyone quietly hand their work to
someone else.

The rules come from v1, which thought about this carefully and got it right.

<a id="assignment-the-model"></a>
### The model

One assignee at a time. Not a list.

Multiple assignees sound helpful and are corrosive: nobody is accountable, notifications
fan out to people who ignore them, and "who is doing this?" stops having an answer.
Collaboration is expressed by watchers, sub-tasks and comments.

<a id="assignment-behaviour"></a>
### Behaviour

**Who may assign whom**

- `AS-1` `work_item:assign` permits assigning to anyone on the project roster. (Held by
  the built-in `lead` and above — see the role matrix in [RBAC](permissions.md).)
- `AS-2` Without `work_item:assign`, `work_item:update` permits assigning or unassigning
  **oneself only** — an ownership predicate on the new assignee, not a role-name check.
  Assigning another person is refused with 403.
- `AS-3` A member picking up work already held by someone else is asked to confirm, and
  the previous holder is notified. *(v1 shipped a reassign button with no confirmation and
  had to fix it.)*
- `AS-4` A customer may never assign. The control does not exist in the portal and the API
  refuses it.
- `AS-5` The assignable list is the **project roster**, not the whole directory.
  Assigning someone who is not on the project is refused with a suggestion to add them.
  Only active people (`person.active = true`) are eligible for any assignment, direct or
  default. Assigning to a deactivated person is refused. *(Generalises the
  "default assignee is inactive" edge case below to every assignment, not only a
  default.)*

**Identity, not display name**

- `AS-6` Assignment stores a person id. Comparisons are by id.

  v1 compared display names, so two people called "J. Smith" could collide. This is called
  out because it is an easy and invisible mistake.

- `AS-7` The assignee is rendered from the directory at read time, so a rename propagates.

**Departed and inactive people**

- `AS-8` If an assignee becomes inactive or leaves the project, the assignment is
  **retained** and displayed as "Jane Smith (inactive)". People are never hard-deleted —
  only deactivated (`person.active = false`, [data-model.md](data-model.md))
  — and `work_item.assignee_id` is `ON DELETE RESTRICT`, so there is no delete path that
  could clear or cascade an assignment out from under a work item. "Departed" means
  deactivated, never gone.
- `AS-9` Work is never silently unassigned. Silent unassignment loses accountability
  exactly when it matters most.
- `AS-10` **P5.** A report lists work assigned to inactive people, so it can be cleaned up
  deliberately — see [reports-and-dashboards.md](feature-contracts-p5.md#reports-and-dashboards). Not a v2 P1
  screen; the person-picker's own "(inactive)" rendering (`AS-8`) is what a P1 user sees
  day to day.

**Defaults and automation**

- `AS-11` A project may set a default assignee, applied to work items created with none.
- `AS-12` A request type may set a default assignee, overriding the project's.
- `AS-13` A workflow transition may set or clear the assignee via the `set_assignee` /
  `clear_assignee` **effects** defined in [workflows.md](feature-contracts-p2.md#workflows) `WF-19` — for
  example, moving to "Waiting on customer" may unassign. This spec defines no effects of
  its own.
- `AS-14` Automations may assign, subject to the same roster constraint.
- `AS-15` Round-robin and load-balanced assignment are **out of scope for v2**. They
  reward gaming and produce worse outcomes than a person looking at a queue.

**Notifications**

- `AS-16` Being assigned notifies the new assignee, per their preferences — emits
  `work_item.assigned` ([events.md](events.md)).
- `AS-17` Being unassigned notifies the previous assignee — emits `work_item.unassigned`
  ([events.md](events.md)).
- `AS-18` Assigning yourself does not notify you. `work_item.assigned` still emits (for
  automations, webhooks and activity) — only the notification fan-out excludes the actor.
  The actor is never notified of their own action, and this covers unassigning yourself
  as well as assigning yourself.

- `AS-19` Assignment and unassignment are conditional on the holder the caller saw
  (optimistic concurrency, #723). Assign already requires it: an unconditional `POST`
  succeeds only while the item is unassigned, and replacing a holder names that holder in
  `expectedCurrentAssigneeId`. Unassign accepts `expectedAssigneeId`; a mismatch is 409 and
  writes nothing. The precondition is optional on unassign so existing API-key and MCP
  callers keep working, but the web detail page always sends it, and on a 409 shows "the
  assignee changed", refreshes, and never retries silently. **Bulk assign needs no
  separate precondition:** it sends no expected holder, so it only ever assigns items that
  are unassigned and reports the rest as per-item failures; it cannot overwrite a holder.

<a id="assignment-permissions"></a>
### Permissions

| Action | Capability | Extra |
| --- | --- | --- |
| Assign to another person | `work_item:assign` | Target must be on the project roster |
| Assign to self | `work_item:update` | Confirmation if taking from someone else |
| Unassign self | `work_item:update` | |
| Unassign another person | `work_item:assign` | |
| Set project default assignee | `project:manage_settings` | |

<a id="assignment-screens"></a>
### Screens

The assignee control appears in the work item header, in list and table rows, in the bulk
action bar, and in the create dialog.

It uses the `person-picker` primitive: avatar, name, role on this project, and current
open work count — because the person assigning usually wants to know who is already
loaded. The count is scoped to the **project's workspace**: it answers "who is loaded"
within the world the caller is working in, never across workspaces whose contents the
caller cannot read (review of PR #362, L1). "Open" means the assigned work item's mapped `state_template.group not in
('completed', 'cancelled')`, resolved through `state.state_template_id`
([ADR 0011](#pending-01-architectureadr0011-ticket-lifecycle-engine)) — never a state name
and never a bare `state.group` column.

Where the actor may only assign themselves, the picker shows a single "Assign to me"
action rather than a disabled list of colleagues. Showing people you cannot choose is
worse than not showing them.

`AS-3` is worded for a member, but the detail page asks for the confirmation on **every**
reassignment of an item that already has a holder, whatever the actor's capability: a
second explicit click, which is dropped if the holder changes in the meantime. Taking work
from someone is the same act for a lead as for a member, and the cost is one click.

<a id="assignment-api"></a>
### API

```
POST   /api/work-items/{key}/assign     work_item:assign · orSelfTarget(body.assigneeId, work_item:update)   — kind 1; the body predicate is in the registry ([rbac.md](permissions.md)), not the handler. An action route, not a `PATCH` — exempt from `If-Match` the same way `POST /work-items/{key}/rank` is (`WI-7`). Conflicts are caught by a conditional write instead: `UPDATE ... WHERE assignee_id IS NULL` (or, for a targeted reassign, `WHERE assignee_id = :expectedCurrentAssigneeId`); zero rows updated means someone else won, and the response is 409 with the row's current `assigneeId`
DELETE /api/work-items/{key}/assign     work_item:assign · orOwner(row.assignee_id === identity.personId, work_item:update)   — optional query `expectedAssigneeId` (the holder the caller saw): if the current holder is anything else, **including nobody**, the response is 409 with the row's current `assigneeId` and nothing is written (`AS-19`). Omitted, the legacy behaviour holds (clears whoever holds it; already-unassigned is a 200 no-op)
GET    /api/projects/{id}/assignable    work_item:read
POST   /api/work-items/bulk/assign      work_item:assign — evaluated per item; partial results reported; above 50 items from an MCP key → 202 (`MC-7`)
```

`GET /assignable` returns the roster with current load, filtered to people the actor may
actually assign to. The client never filters this itself.

<a id="assignment-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Assignee removed from the project | Assignment retained, shown as "(no longer on this project)" |
| Assignee deactivated (`person.active = false`) | Assignment retained, shown as "Jane Smith (inactive)" — `AS-8`. There is no delete path to tombstone against: `work_item.assignee_id` is `ON DELETE RESTRICT` and people are never hard-deleted |
| Bulk assign where some items are outside authority | Per-item: allowed ones succeed, others reported |
| Assigning a work item already assigned to you | No-op, no activity entry, no notification |
| Unassigning an item nobody holds | No-op, no activity entry, no notification -- the answer is "it is already as you asked", not a conflict |
| Two people self-assign simultaneously | The conditional `UPDATE ... WHERE assignee_id IS NULL` lets only one write through; the second gets 409 with the winner's identity, not a version conflict — see the API section |
| Default assignee is inactive when a work item is created | Left unassigned, and the project is flagged in settings |
| Assigning across projects during a move | Assignment cleared if the assignee is not on the destination roster; the user is warned first |

<a id="assignment-out-of-scope"></a>
### Out of scope

- Team capacity and workload planning → [time-and-cost.md](feature-contracts-p5.md#time-and-cost)
- Automated routing rules → [automations.md](feature-contracts-p4.md#automations)
- On-call rotas — not in v2

<a id="assignment-testing"></a>
### Testing

Unit: the `AS-1` to `AS-5` matrix — every role against every assignment target.

Integration: a member cannot assign to a colleague; a customer session cannot assign at
all; assignment to someone off the roster is refused; identity comparison is by id, proven
with two people sharing a display name; two concurrent self-assigns on the same
unassigned item — one 200, one 409 naming the winner.

E2E: self-assign; take work from a colleague and see the confirmation; observe an inactive
assignee rendered as inactive rather than blank.

<a id="assignment-open-questions"></a>
### Open questions

None.

<a id="assignment-related"></a>
### Related

- [Work items](feature-contracts-p1.md#work-items) · [RBAC](permissions.md)
- [Projects and engagements](feature-contracts-p1.md#projects-and-engagements)

<a id="comments-and-activity"></a>
## Comments and activity

- **Primary phase:** P1
- **Feature flag:** always on
- **Depends on:** work items, RBAC

<a id="comments-and-activity-purpose"></a>
### Purpose

One stream showing everything that has happened to a work item — what people said and what
changed — in order.

Separating "comments" from "history" into two tabs is a mistake: the reason a field changed
is usually in a comment three lines above the change, and splitting them destroys that.

<a id="comments-and-activity-data"></a>
### Data

[`data-model.md`](data-model.md) §4 is authoritative for every column.

- `comment` — `work_item_id`, `author_id`, `actor_type`, `body jsonb`, `visibility`
  (`public`\|`internal`), `activity_id` null, `edited_at`, `deleted_at`/`deleted_by` (the
  `CA-18` tombstone).
- `comment_version` — `comment_id`, `number`, `body jsonb`, `edited_by`, `created_at` — the
  edit history `CA-17` renders.
- `activity` — `work_item_id`, `actor_id`, `actor_type`, `verb`, `field`, `old_value`,
  `new_value`, `payload jsonb`, `visibility`, `workflow_version_id` null, `created_at`.
- `canned_response` — `workspace_id`, `name`, `body jsonb`, `visibility_default`,
  `created_by`.
- `project.default_comment_visibility` (`public`\|`internal`, default `internal`) — `CA-2`'s
  per-project default.
- Attachment linkage: `attachment.comment_id` (`CHECK` exactly one of `work_item_id` \|
  `comment_id` \| `submission_id`) is how an image pasted into a comment (`CA-15`) attaches
  to that comment rather than to the work item directly.

<a id="comments-and-activity-the-visibility-rule"></a>
### The visibility rule

**Every comment is either `public` or `internal`.** This is the single most
security-sensitive field in the product.

| | Public | Internal |
| --- | --- | --- |
| Staff see | Yes | Yes |
| Customers see | Yes | **Never** |
| Notifies customer | Yes | No |
| Stops first-response SLA | Yes | No |

- `CA-1` Visibility is chosen explicitly at composition, with the current choice always
  visible. There is no ambiguity about who is about to read what.
- `CA-2` The default is configurable per project — `project.default_comment_visibility`
  ([data-model.md](data-model.md) §3), `public`\|`internal`, seeded
  `internal`. For customer-facing service desks it should default to **internal**, because
  an accidental internal note is embarrassing and an accidental public note can be
  catastrophic.
- `CA-3` Internal comments are filtered **server-side in the portal router**. Never in the
  client, never by a CSS class, never by a conditional render.
- `CA-4` Visibility cannot be changed after posting. A comment sent to a customer has been
  sent. Delete and repost, which leaves a visible tombstone.
- `CA-5` The composer is neutral in both modes: it keeps Kaneo's original composer look
  with no distinct background. Internal mode is shown by the Internal/Public toggle and the
  explanatory sentence beside it. Owner decision, 22 Oct 2026 (warning-tinted composer
  rejected; see `audit.md`, "neutral composer", and roadmap UI-04).

<a id="comments-and-activity-activity"></a>
### Activity

- `CA-6` Every field change writes an `activity` row with the field, old value and new
  value. This is the journal, and it is what makes point-in-time reconstruction possible.
  A plain field edit is recorded as verb `updated` with `field` set to the field name —
  matching [`events.md`](events.md)'s own resolution of the
  automation-picker label `work_item.field_changed` to the real event key
  `work_item.updated` — and its visibility resolves by that field name, per `CA-7`'s table
  below.
- `CA-7` Activity rows have visibility too, decided by this table and nothing else. **An
  unmapped verb or field is `internal`** — adding a field later fails closed.

  | Verb / field | Visibility |
  | --- | --- |
  | `created`, `transitioned` (state change), `priority`, `due_date`, `title`, `description`, `attachment.added` (customer-visible attachment), `reopened`, `resolved`, `escalated` | `public` |
  | `assignee`, `watcher`, `label`, `custom_field` (unless the field is `customer_visible`), `estimate`, `cycle`, `module`, `relation`, `parent`, `time_entry`, `sla_pause`, `approval.decided` (approval decision; the decision note is not copied into activity), `attachment.added` (internal attachment), everything else | `internal` |

  Customers therefore never see staff names as assignees; they do see the named author of a
  public comment or approval decision ([RBAC](permissions.md), customer rules).
- `CA-8` Consecutive changes by the same actor within five minutes are grouped in the UI
  into one entry — "Jane changed priority, due date and 2 labels" — expandable.
- `CA-9` System actions are attributed to the automation or job that made them, never to a
  person.
- `CA-10` Activity is never edited or deleted, including when a work item is archived —
  except when the parent work item is purged at the end of the soft-delete window, or its
  workspace is hard-deleted (the tenant deletion cascade — decision log 2026-09-23,
  "Activity addendum").

<a id="comments-and-activity-composition"></a>
### Composition

- `CA-11` Rich text via Tiptap: bold, italic, lists, links, code, code blocks, tables,
  images, task lists. The serialized `body jsonb` document is capped at **256 KiB** and
  **10,000 nodes**; a comment over either limit is rejected with the standard 422
  validation contract ([api-design.md](#pending-01-architectureapi-design) "Errors" —
  `errors[]` gives field-level detail, `path: "body"`).
- `CA-12` `@mention` a person to notify them and add them as a watcher. The picker and
  preflight are scoped to the addressed work item's workspace and require current
  `work_item:read` plus work-item reach. The preflight is advisory: selected people without
  current reach are warned about, and the comment may still be sent with the mention text
  intact. The write rechecks identity and reach inside the comment transaction. A newly
  mentioned reachable person is added as a watcher only when no watcher row exists; an
  existing watcher's `source` and `muted` state are preserved. A person whose reach changed
  after preflight is not added and receives no mention event. A comment author is not
  notified about their own mention. Each distinct eligible recipient gets one
  `work_item.mentioned` event carrying the mentioned person and comment ids; ordinary
  preference, current-reach and delivery checks still apply. Only a Tiptap `taskdeskMention`
  node identifies a person; text or arbitrary JSON fields do not. Mention notifications on
  comment edits remain unresolved; the behavior is not specified here.
- `CA-13` A customer cannot be mentioned in an internal comment. The picker excludes them.
- `CA-14` `#SUP-123` links a work item inline, rendering key, title and state.
- `CA-15` Pasting or dropping an image uploads it as an attachment and inserts a
  reference. Never base64 into the document.
- `CA-16` Drafts persist per work item per user, surviving a closed tab — stored in
  `localStorage`, and therefore per device: a draft started on one device is not visible
  on another.
- `CA-17` Editing is allowed for 15 minutes by the author. After that window, editing is
  **refused** — a 403 — unless the actor holds `comment:update_any`. Each edit writes a new
  `comment_version (comment_id, number, body, edited_by, created_at)` row
  ([data-model.md](data-model.md) §4); the comment shows "edited" with
  an expandable history read only when opened. History is loaded in bounded cursor pages;
  the activity response does not embed prior bodies, and the composer retains already
  fetched pages while the user asks for earlier versions. History uses the same work-item
  reach and read policy as activity, remains agent-side, and cannot expose a tombstone's
  former body. An edit request that omits `body` is a no-op (owner decision 2026-10-09):
  it runs the same reach, live-parent, membership, ownership and 15-minute-window checks
  as a real edit, then returns the comment unchanged, writing no `comment_version`, no
  `edited_at`, no `updated_at` change and no event. A present `body` (including `null`)
  is validated and written as before.
- `CA-18` Deleting sets `comment.deleted_at` / `deleted_by` and clears the body; the row and
  its activity stay, and the tombstone renders from those two columns — "Comment deleted by
  Jane, 2 March" — never a
  silent gap. The activity route returns `deletedBy` (the deleting actor's id, null on a
  live comment) so the client can name the deleter, who can differ from the author; the
  name is resolved through the same reach-filtered directory as every other actor. Like every deletion it is a pending action approved by the requester — a
  click-level confirmation showing the comment and its work item
  ([pending-actions.md](#pending-01-architecturepending-actions)).
- `CA-11a` Inherited from kaneo and kept inside the Tiptap document: Markdown paste/import
  and export (`turndown`, `react-markdown`), Mermaid diagrams and code highlighting
  (`mermaid`, `shiki`) — sanitised on render, Mermaid rendered client-side only
  ([inherited-features.md](#pending-01-architectureinherited-features)).

<a id="comments-and-activity-canned-responses"></a>
### Canned responses

- `CA-19` A workspace may define reusable snippets with placeholders for requester name,
  work item key and due date — the `canned_response` table
  ([data-model.md](data-model.md) §4). Creating, editing and deleting a
  canned response requires `workspace:manage_settings`
  ([rbac.md](permissions.md)); reading the list to insert one only requires
  `work_item:read` on the work item being commented on. Workspace settings lists the
  library through a separate manager-only route requiring `workspace:manage_settings`,
  so managing snippets does not require creating a work item or broadening composer reads.
- `CA-19a` Template tokens are `{{requester.name}}`, `{{work_item.key}}` and
  `{{work_item.due_date}}` (optional whitespace inside braces). Composer listing resolves
  them against the authorized live work item, using the requester's person display name
  with linked user name as fallback and the due date's UTC `YYYY-MM-DD` calendar value.
  Missing names/dates become empty text; unknown tokens remain literal. No expressions,
  HTML generation or recursive expansion. Only rich-text text content is expanded, including
  tokens spanning adjacent formatted text nodes; attributes, links and embedded-node data
  remain unchanged. Replacement text inherits the token's first text node's formatting.
  Stored templates and manager listings remain unexpanded. The menu may cache template
  names, but insertion fetches fresh authorized context; failed or removed templates preserve
  the existing draft and show a retryable error. Editing/sending is blocked while insertion
  is pending so a late response cannot overwrite new draft edits. A requester is the person linked
  by that work item, including a customer contact without workspace-user membership;
  expansion never performs arbitrary directory lookup or exposes their email.
- `CA-20` Inserted from the composer, then editable before sending. Never sent
  automatically.

<a id="comments-and-activity-permissions"></a>
### Permissions

Ownership is `row.person_id === identity.personId` (the comment's `author_id`), matching
[rbac.md](permissions.md)'s worked `PATCH /api/comments/{id}` example: an
`orOwner` branch grants the `_own` capability only within the 15-minute window, with the
`_any` capability as the unconditional override.

| Action | Capability |
| --- | --- |
| Read public comments | `work_item:read` |
| Read internal comments | `work_item:read` + staff side |
| Post public | `comment:create` |
| Post internal | `comment:create_internal` |
| Edit own within window | `comment:update_own` (owner predicate, `withinMinutes: 15`) |
| Edit anyone's | `comment:update_any` |
| Delete own | `comment:delete_own` (owner predicate) |
| Delete anyone's | `comment:delete_any` |

<a id="comments-and-activity-screens"></a>
### Screens

The activity stream on the work item detail, newest last, with the composer pinned at the
bottom. A filter toggles between "everything", "comments only" and "public only" — the
last being how a staff member checks what the customer has actually seen.

<a id="comments-and-activity-api"></a>
### API

```
GET    /api/work-items/{key}/activity          work_item:read
POST   /api/work-items/{key}/comments          comment:create | comment:create_internal
GET    /api/work-items/{key}/comments/mention-candidates
                                                work_item:read + current work-item reach
POST   /api/work-items/{key}/comments/mention-preflight
                                                work_item:read + current work-item reach
GET    /api/work-items/{key}/comments/{id}/versions
                                                work_item:read + current work-item reach
PATCH  /api/comments/{id}                      comment:update_any, or comment:update_own
                                                (owner, within 15 minutes)
DELETE /api/comments/{id}                      comment:delete_any, or comment:delete_own
                                                (owner)
GET    /api/portal/requests/{ref}/activity     (portal router — public only)
GET    /api/canned-responses/manage            workspace:manage_settings (workspaceId query)
GET    /api/canned-responses                   work_item:read
POST   /api/canned-responses                   workspace:manage_settings
PATCH  /api/canned-responses/{id}              workspace:manage_settings
DELETE /api/canned-responses/{id}              workspace:manage_settings
```

Mention candidates return current workspace staff with their reach status, and return
customer people only for public comments when they are in the work item's visible audience.
Customer people are excluded for internal comments; customers outside the item's visible
audience are not exposed. Preflight accepts a bounded list of person ids and returns
reachable and unreachable ids without distinguishing
unknown, inactive, non-member, or out-of-scope ids. It is advisory, never an authorization
token; create-comment repeats the checks in its write transaction.

Comment-version reads return `{ data, page: { nextCursor, hasMore } }` with no total. `limit`
defaults to 5 and is bounded to 1–10. The opaque cursor binds the work-item key, comment id,
and last `(number, id)` tuple. Pages continue strictly after that tuple in ascending order.
Malformed or mismatched cursors return `400`; the live comment must belong to the path item,
and missing, deleted, archived, or out-of-reach parents return the existing indistinguishable
`404`. Each row contains only its stored version number, body, editor id, and timestamp. The
route is not mounted in the portal router; the portal's public-only activity projection is
unchanged.

The portal endpoint is a separate handler, not the same handler with a filter, so it is
impossible to leak internal content through a forgotten branch.

<a id="comments-and-activity-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Customer mentioned in a public comment | Notified normally |
| Mentioned person later loses reach | Existing mention remains; no further notifications |
| Comment on a soft-deleted work item | Hidden along with the work item, not deleted; both reappear together if the work item is restored within its 30-day soft-delete window. Removed only at purge, at the end of that window ([work-items.md](feature-contracts-p1.md#work-items) `WI-21`) |
| Very long comment | Collapsed above 400 words with "show more" |
| Image in a comment, attachment later deleted | Renders a "image unavailable" placeholder |
| Two people editing one comment | Only the author may edit; no conflict possible |
| Activity for a field the viewer cannot see | Suppressed entirely, not shown as redacted |

<a id="comments-and-activity-out-of-scope"></a>
### Out of scope

- Threaded replies within one comment stream — the stream is flat, ordered by time, per
  `CA-8`'s grouping only.
- Reactions/emoji on comments.
- Rich analytics on canned-response usage — `CA-19`/`CA-20` are the composer affordance
  only.
- Per-organisation or per-customer default comment visibility — `CA-2`'s default is
  per-project only; a finer-grained default is [settings-hierarchy.md](feature-contracts-p4.md#settings-hierarchy)'s
  concern (P4), not this spec's.

<a id="comments-and-activity-testing"></a>
### Testing

Integration — the important ones:

- `portal-never-returns-internal.test.ts` — internal comments absent from every portal
  response, including activity, search and export.
- Visibility cannot be changed after creation.
- A customer cannot be mentioned in an internal comment.

Unit: activity grouping window; mention parsing; work item reference parsing.

E2E: post internal and public comments, sign in as the customer, confirm only the public
one is present in the DOM.

<a id="comments-and-activity-open-questions"></a>
### Open questions

- When an edit adds a mention to a live comment, should the edit emit
  `work_item.mentioned`? No edit-time mention event or delivery is specified by the current
  contract.

<a id="comments-and-activity-related"></a>
### Related

- [Work items](feature-contracts-p1.md#work-items) · [Customer portal](feature-contracts-p3.md#customer-portal)
- [Notifications](feature-contracts-p4.md#notifications) · [Audit trail](feature-contracts-p2.md#audit-trail)

<a id="attachments"></a>
## Attachments

- **Primary phase:** P1
- **Feature flag:** always on
- **Depends on:** storage plugin, work items

<a id="attachments-purpose"></a>
### Purpose

Attach files to work items, comments and submissions. Screenshots, logs, quotes, signed
documents.

Architecture and security: [Storage and attachments](#pending-01-architecturestorage-and-attachments).
This document covers behaviour and interface.

<a id="attachments-data"></a>
### Data

[`data-model.md`](data-model.md) is authoritative for every column.

- `attachment` — `work_item_id` \| `comment_id` \| `submission_id` (`CHECK` exactly one),
  `object_key`, `filename`, `mime_type`, `size`, `state` (`pending`\|`ready`\|`deleted`),
  `customer_visible`, `uploaded_by`, `deleted_at`, plus the denormalised `workspace_id` and
  `organisation_id` the object-key template, the storage quota sum and `attachment-gc`'s
  legal-hold check all need. A partial index on `state = 'pending'` backs the hourly
  cleanup.
- `instance_setting.attachment_max_bytes`, `attachment_max_per_item`,
  `attachment_allowed_extensions text[]` — the God Mode-configurable defaults in the
  [Limits](feature-contracts-p1.md#attachments-limits) table below.

<a id="attachments-behaviour"></a>
### Behaviour

- `AT-1` Files attach to a work item, to a specific comment, or to a submission.
- `AT-2` Upload is direct to object storage via a presigned POST. The API never proxies
  bytes.
- `AT-3` Every attachment carries `customer_visible`. Staff uploads default to **not**
  visible; customer uploads default to visible.
- `AT-4` An attachment on an internal comment is always internal, whatever its own flag
  says.
- `AT-5` Download URLs are presigned with a five-minute lifetime and are issued only after
  a policy check. The bucket is never public, and there is **no anonymous read path**:
  kaneo's `is_public` branch in `authorize-asset-access.ts` is deleted at fork
  ([decision log](#pending-07-planningdecision-log)).
- `AT-6` Every download writes an audit row (`attachment.downloaded` — [audit-trail.md](feature-contracts-p2.md#audit-trail)).
- `AT-7` Deleting is soft; the object is removed the following night by `attachment-gc`,
  so an accidental deletion is recoverable for a day. Like every deletion it is a pending
  action approved by the requester — a click-level confirmation showing the file and its
  parent ([pending-actions.md](#pending-01-architecturepending-actions)); the nightly
  `attachment-gc` and `attachment-pending-cleanup` runs need no second approval (`PA-12`).
- `AT-8` Images render inline as thumbnails with a lightbox. Everything else shows an icon,
  filename, size and uploader.
- `AT-9` PDFs preview in a sandboxed viewer. Office documents download without preview.
  Thomas approved `pdfjs-dist` 6.4.299 on 25 October 2026 for a lazy-loaded sandboxed PDF renderer using existing Kaneo dialogs and controls. Preserve authorized staff/portal attachment reads and the download fallback; record the library license in third-party notices.
  The viewer's CSP and iframe sandboxing follow
  [security-model.md](#pending-01-architecturesecurity-model)'s (§ Transport and headers).

<a id="attachments-upload-experience"></a>
### Upload experience

- `AT-10` Drag and drop anywhere on the work item detail.
- `AT-11` Paste from clipboard, which is how screenshots actually arrive.
- `AT-12` Multiple files at once, each with its own progress bar and its own failure state.
  One failure does not abandon the batch.
- `AT-13` Uploads continue if the user navigates within the app; leaving the app cancels
  them with a warning.
- `AT-14` A rejected file says exactly why — "Executable files aren't allowed",
  "This file is 41 MB; the limit is 25 MB" — never "Upload failed".

<a id="attachments-limits"></a>
### Limits

Defaults, all configurable in God Mode.

| Limit | Setting key | Default |
| --- | --- | --- |
| Per file | `instance_setting.attachment_max_bytes` | 25 MB |
| Files per work item | `instance_setting.attachment_max_per_item` | 100 |
| Total per organisation | `organisation_quota.max_storage_bytes` | 20 GiB |

Allowed extensions are `instance_setting.attachment_allowed_extensions text[]` — images,
documents, text, archives by default. Blocked: executables and scripts. SVG is blocked by
default because it is a script vector; it can be enabled with sanitisation.

<a id="attachments-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| See an attachment | `work_item:read` + visibility |
| Upload (agent) | `attachment:create` on the work item |
| Upload (portal) | `{ portal: 'customer', predicate: 'own_request' }` — [RBAC](permissions.md) policy kind 3 |
| Change visibility | `work_item:update` (staff only) |
| Delete own | `work_item:update` |
| Delete own | `attachment:delete_own` |
| Delete anyone's | `attachment:delete_any` — an attachment capability, not a comment one |

<a id="attachments-screens"></a>
### Screens

Drag-and-drop zone, upload progress list and the thumbnail/icon grid live inline on the
work item detail (no dedicated screen); the lightbox is a modal over that same screen. See
the [screen inventory](#pending-02-designscreen-inventory).

<a id="attachments-api"></a>
### API

```
POST   /api/attachments/presign                work_item:update
POST   /api/attachments/{id}/complete          work_item:update
GET    /api/attachments/{id}                   work_item:read → 302 to presigned URL
PATCH  /api/attachments/{id}                   work_item:update   (visibility, filename)
DELETE /api/attachments/{id}                   work_item:update
GET    /api/work-items/{key}/attachments       work_item:read
POST   /api/portal/requests/{ref}/attachments/presign   { portal: 'customer', predicate: 'own_request' }
```

<a id="attachments-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Upload starts, browser closes | Row stays `pending`; cleaned up after an hour |
| Storage unreachable | Presign fails with a clear message; nothing is created |
| Filename with path separators or nulls | Sanitised for display; the object key is generated regardless |
| Two files with the same name | Both kept. Display disambiguates with the upload time |
| Declared MIME does not match magic bytes | Rejected at `complete`; the object is deleted |
| Attachment on a work item moved to another project | Moves with it |
| Parent project is soft-deleted | Asset/attachment reads and downloads return `404` while the project is soft-deleted (`project.deleted_at IS NULL`); rows and storage objects remain intact during the 30-day restore window ([decision log](#pending-07-planningdecision-log) 2026-10-19 D3 / #205) |
| Customer uploads to a resolved request | Allowed within the reopen window (`instance_setting.reopen_window_days`); reopens the request through the workflow's `is_reopen` (`workflow_transition.is_reopen`) transition as a system actor — `WF-21`, one mechanism shared with `CP-8` |
| Presigned POST conditions | Always pin the exact object key, `content-length-range` up to the limit, and the declared content type — the credential cannot write another key or an unbounded object. The download path serves only `state = 'ready'` rows, never by raw key |
| Malware | **No scanner — a stated, accepted residual risk** (decided 2026-09-05: not built or installed in the current scope; revisit before unknown external users can upload). Mitigated by the allowlist, magic-byte check, separate files origin and `Content-Disposition: attachment`. A *future* `storage.antivirus` plugin (ClamAV or a hosted scanner) would gate `pending → ready`; the plugin id is reserved, nothing else ([roadmap.md](#pending-07-planningroadmap)). Archives (`zip`, `7z`, …) are an instance-configurable allowlist entry because they bypass the extension allowlist for the recipient |

<a id="attachments-out-of-scope"></a>
### Out of scope

- Malware scanning — a stated, accepted residual risk (see the Malware edge case above); a
  future `storage.antivirus` plugin id is reserved in [roadmap.md](#pending-07-planningroadmap).
- Versioning a replaced attachment — a new upload is a new row, never an edit in place.
- In-browser editing (crop, annotate) — out of scope for v2.

<a id="attachments-testing"></a>
### Testing

Integration: presign refuses without permission; a `.png` containing an executable header
is rejected; a non-visible attachment is absent from every portal response; a traversal
filename produces a safe generated key.

E2E: drag and drop, paste a screenshot, download, delete and restore within the window;
upload from the portal on a phone viewport.

<a id="attachments-open-questions"></a>
### Open questions

*(None. The reopen-on-upload mechanism, the `attachment` state machine and the God Mode
setting keys were the open items — all decided above and in
[data-model.md](data-model.md).)*

<a id="attachments-related"></a>
### Related

- [Storage and attachments](#pending-01-architecturestorage-and-attachments)
- [Comments and activity](feature-contracts-p1.md#comments-and-activity)

<a id="relations-and-hierarchy"></a>
## Relations and hierarchy

- **Primary phase:** P1
- **Feature flag:** always on
- **Depends on:** work items

<a id="relations-and-hierarchy-purpose"></a>
### Purpose

Express how pieces of work relate. Two mechanisms, deliberately separate.

**Hierarchy** is containment: this work is *part of* that work. One parent, many children.

**Relations** are typed links between peers: this *blocks* that, this *duplicates* that.
Many to many.

Conflating them — as tools that model "parent" as just another link type do — makes
roll-up progress and tree views impossible to compute reliably. OpenProject separates them
and is right to.

<a id="relations-and-hierarchy-relation-types"></a>
### Relation types

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

<a id="relations-and-hierarchy-data"></a>
### Data

`work_item_relation`, `work_item.parent_id`. See
[data model](data-model.md).

<a id="relations-and-hierarchy-hierarchy"></a>
### Hierarchy

- `RH-5` One parent, any number of children.
- `RH-6` Parent and child must be in the same project.
- `RH-7` Maximum depth 5.
- `RH-8` Cycles are rejected — a work item cannot be its own ancestor, at any distance.
- `RH-9` A parent displays rolled-up progress as defined once in `WI-19` — whole subtree,
  "completed" meaning a child's mapped `state_template.group in ('completed',
  'cancelled')`, resolved through its `state.state_template_id` (`state` itself carries no
  `group` — [data model](data-model.md) §3/§4) — plus rolled-up estimate
  and logged time where those features are enabled. `RH-14` uses the same definition.
- `RH-10` Closing a parent with open children warns and lists them. It does not cascade.
- `RH-11` Deleting a parent orphans its children rather than deleting them. The user is
  told exactly this before confirming.
  Children keep their `parent_id` through the 30-day restore window (the soft-deleted parent still
  holds them, so a restore returns the tree intact) and are orphaned only when the purge removes
  the parent; decided 2026-10-23, no change to the current behaviour.
- `RH-12` Moving a parent between projects offers to move its children too. Declining
  **detaches** the children — they stay in the old project with no parent, and the parent
  link is removed — so `RH-6` always holds. This is stated plainly before confirming.
  Rules as built (`POST /api/v2/work-items/{key}/move`, 2026-10-23): reach plus `work_item:update` on
  the source and reach plus `work_item:create`/`work_item:update` on the target, same workspace only
  (an unreachable or foreign target is the same 404); `If-Match` required; the moved item's own
  parent link is always removed; moving children moves the whole subtree (200 items at most), declining
  detaches only the direct children; each moved item takes a new key and number in the target and the
  old key is kept in `work_item_key_alias` and redirects reads (`308`) only after reach on the moved item;
  states map by state template and a template the target lacks refuses the move (422); project labels
  follow by name or are dropped; an assignee off the target roster, or an item with a requester or
  organisation visibility crossing customer organisations, refuses (422); pending workflow timers
  are discarded; cycle, module and estimate pointers are cleared; positions append to the target column.

<a id="relations-and-hierarchy-epics"></a>
### Epics

- `RH-13` A work item type marked `is_epic` is a hierarchy root: it may have children but
  no parent. `is_epic` is the only type-level parentage constraint — every other type,
  Sub-task included, may appear at any level up to the depth-5 cap (`RH-7`); nothing else
  about a type restricts where it sits in the tree.
- `RH-14` An epic shows aggregate progress across its whole subtree, not just direct
  children.
- `RH-15` Epics are the unit of the epic/initiative roll-up in reporting.

<a id="relations-and-hierarchy-blocking-behaviour"></a>
### Blocking behaviour

- `RH-16` A workflow guard (`no_open_blockers`, [workflows.md](feature-contracts-p2.md#workflows) `WF-15`) may
  require that no `blocked_by` relation points at an open work item — "open" meaning its
  mapped `state_template.group not in ('completed', 'cancelled')`, resolved through
  `state.state_template_id`, never a state name and never a bare `state.group` column.
- `RH-17` A blocked work item shows a badge and lists what is blocking it.
- `RH-18` When the last blocker closes, the assignee of the blocked item is notified via
  the `work_item.unblocked` event ([events.md](events.md)).
- `RH-19` Blocking cycles — A blocks B, B blocks A — are permitted at creation but
  detected and surfaced as a warning on both, because they usually indicate a real
  planning problem rather than a data error.

<a id="relations-and-hierarchy-permissions"></a>
### Permissions

| Action | Capability | Extra rules |
| --- | --- | --- |
| Read relations / tree | `work_item:read` | Reach checked on each end independently — why the hidden-relation count in `RH-4` exists |
| Create / remove a relation | `work_item:update` | Required on **both** work items |
| Set / clear a parent | `work_item:update` | Required on **both** ends, including detach — it mutates the former parent's roll-up too |

<a id="relations-and-hierarchy-screens"></a>
### Screens

A relations section on the work item detail, grouped by type, each entry showing key,
title, state and assignee. An "Add relation" affordance opens a searchable picker with
type selection.

The tree of parent and children renders inline, with the current item highlighted, so the
context is visible without navigating away.

<a id="relations-and-hierarchy-api"></a>
### API

```
GET    /api/work-items/{key}/relations         work_item:read
POST   /api/work-items/{key}/relations         work_item:update (both ends)
DELETE /api/work-items/{key}/relations/{id}    work_item:update (both ends)
POST   /api/work-items/{key}/parent            work_item:update (both ends)
DELETE /api/work-items/{key}/parent            work_item:update (both ends) — detaching mutates the former parent's roll-up too
GET    /api/work-items/{key}/tree               work_item:read
GET    /api/work-items/{key}/children           work_item:read
```

First-party parent attach/detach use `POST`/`DELETE /api/v2/work-items/{key}/parent`,
which require `If-Match: "<work_item.version>"` (WI-7). The
asserted version is checked after locking and validating the live item, before parent
validation, no-op detection or writes. A stale request returns structured 409 with
`assertedVersion` and `currentVersion`, without row/activity/event effects. Missing or
malformed headers return 400. Concurrent selections of the same version cannot both
commit; an already-detached item is a no-op only with its current version.
The existing unversioned parent routes remain compatible: an optional supplied header
is strictly validated and checked under the same lock; omission preserves prior behavior.
Unversioned callers retain their earlier last-write-wins risk. The strict routes share
the same authorization, liveness, hierarchy constraints and controller transactions.

<a id="relations-and-hierarchy-paginated-hierarchy-contract"></a>
#### Paginated hierarchy contract

`GET /api/work-items/{key}/children` independently pages the requested parent's direct
children, ordered by numeric `position ASC, id ASC`. `limit` defaults to 50 and accepts
1–200. The opaque keyset `cursor` binds version, workspace, project, parent id, limit and
last exact decimal position/id; malformed or differently scoped cursors return 400.
A cursor is a continuation, not authority: every request rechecks current project reach,
read permission and API-key ceilings. Missing, archived, deleted and unreachable parents
return the same 404. Children and ancestors exclude archived/deleted rows.

The response contains `parent`, bounded `ancestors` (root to immediate parent), `data`
(direct children with id, key, title, mapped state name/group and `hasChildren`),
`page: { nextCursor, hasMore }`, `meta: { total }` (direct children), and
`progress: { completed, total }` across all live descendants, excluding the parent itself.
Progress is computed in SQL over the complete subtree using WI-19's mapped state groups,
independently of the current page or the legacy tree's 500-node cap. One read snapshot
keeps context, page and totals consistent. No progress percentage is invented for a leaf.
The legacy `/tree` response remains bounded and retains its explicit `truncated` flag;
new inline hierarchy controls use child pages to navigate every branch (#434).

The detail and side-pane URL carries `hierarchy: { itemKey, collapsed?, expanded?, pages? }`.
`expanded` lists disclosed permanent keys; `pages` records each parent's requested page
count, restored by following real cursors on reload. State is scoped to `itemKey` so a
new item never inherits another item's disclosures. The current ancestor path opens by
default. If its next node is outside the loaded sibling page, a labelled current-branch
context appears before paged siblings. That branch stays pinned before the ordered siblings
and is deduplicated when pagination reaches it.
Its mapped state and whole-subtree progress use the real API. A failed extra page preserves
loaded rows and exposes retry; a denied/missing current item discards its cached hierarchy.

<a id="relations-and-hierarchy-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Duplicate relation added twice | Idempotent — no second row, no error |
| Relation to a deleted work item | Hidden while the item is soft-deleted (`WI-21`'s 30-day window), not removed; removed only at purge. Restoring the item within the window restores its relations too |
| Both directions of a directional relation added | The second is recognised as the inverse and rejected as a duplicate |
| Self-relation | Rejected at 422 |
| Parent set to a descendant | Rejected — cycle detection |
| 200 children on one parent | The list paginates; roll-up is computed in SQL |
| Cross-project relation, project later moved to another workspace | Cannot happen: `project.workspace_id` is set at creation and no route changes it — a project never moves between workspaces. Relations only ever cross projects within the workspace they share (`RH-3`) |

<a id="relations-and-hierarchy-out-of-scope"></a>
### Out of scope

- The work item entity, its fields and its own lifecycle rules → [work-items.md](feature-contracts-p1.md#work-items)
- Guard evaluation and the workflow engine that consumes `RH-16` → [workflows.md](feature-contracts-p2.md#workflows)
- Delivery of the `work_item.unblocked` notification (`RH-18`) → [notifications.md](feature-contracts-p4.md#notifications)

<a id="relations-and-hierarchy-testing"></a>
### Testing

Unit: cycle detection at every depth; inverse label rendering; roll-up arithmetic.

Integration: a relation to an out-of-reach item returns a count without identifying
details; creating a relation requires update on both ends.

E2E: build a three-level tree, verify roll-up, close a blocker and see the blocked item's
badge clear.

<a id="relations-and-hierarchy-open-questions"></a>
### Open questions

None.

<a id="relations-and-hierarchy-related"></a>
### Related

- [Work items](feature-contracts-p1.md#work-items) · [Workflows](feature-contracts-p2.md#workflows) · [Agile](feature-contracts-p5.md#agile)


Hierarchy URL replay is bounded to 8,192 characters, 32 disclosure/page entries and three
automatically restored pages per disclosed parent. A crafted page count never drains an
unbounded hierarchy. Further pages remain available through explicit load-more actions;
when restoration stops at the bound, the UI says so. Opening more than 32 branches at once
requires collapsing another branch; every branch remains navigable. These are client replay
limits, not a cap on server totals, hierarchy breadth or manual pagination.

<a id="search-and-saved-views"></a>
## Search and saved views

- **Primary phase:** P1
- **Feature flag:** always on
- **Depends on:** work items, views

<a id="search-and-saved-views-purpose"></a>
### Purpose

Find anything quickly, and keep the queries you run repeatedly.

Two things that look separate but are the same underneath: a saved view **is** a stored
search plus a presentation choice.

<a id="search-and-saved-views-data"></a>
### Data

`saved_view` (`workspace_id`, `created_by`, `scope`/`scope_id` — the query's own context, a workspace or a
project — `visibility`, `shared_with_team_id`, `name`, `query`, `layout`), `user_preference`
(kind 2 — pinned views, `SV-20`). See [data model](data-model.md).

<a id="search-and-saved-views-global-search"></a>
### Global search

- `SV-1` `⌘K` opens the command palette. It searches work items, projects, people, saved
  views, knowledge base articles — and also offers navigation destinations and actions.
  Agent-side only: the portal has no command palette, and `GET /api/search` is not exposed
  through `/api/portal/*` ([rbac.md](permissions.md)).
- `SV-2` Results are grouped by kind, with the best match first, and are keyboard
  navigable throughout.
- `SV-3` Search is scoped to the actor's reach. Out-of-reach records simply do not appear.
- `SV-4` Typing a work item key jumps straight to it.
- `SV-5` Results appear within 100 ms for typical queries. This is a hard requirement — a
  slow palette stops being used, and then the navigation depth becomes a real problem.
- `SV-6` Recent items appear before any query is typed.

<a id="search-and-saved-views-search-backend"></a>
### Search backend

Postgres full-text by default, via a generated `tsvector` column with weighted title and
description.

- `SV-7` Title matches weight above description matches.
- `SV-8` Prefix matching so results update as you type.
- `SV-9` Trigram similarity as a fallback for typos.
- `SV-10` A `search.meilisearch` plugin exists as an option, to be enabled **only** if
  Postgres is measured to be insufficient. Not on principle, not preemptively — "insufficient"
  means `SV-5`'s 100 ms budget is measured missed against the same 10,000-item seeded
  benchmark the E2E test below uses.

<a id="search-and-saved-views-structured-search"></a>
### Structured search

The filter grammar from [API design](#pending-01-architectureapi-design). Available as a
visual builder and, for people who prefer it, a text syntax:

```
assignee:@me state:started due:<7d project:SUP type:incident
priority:>=high created:>2026-01-01 watcher:contains(@me)
```

- `SV-11` The text syntax and visual builder are two lossless renderings of the filter AST.
  Parentheses preserve nested `and`/`or`; adjacent text terms mean `and`; explicit `AND`
  and `OR` are supported. Sort and columns remain in the surrounding query document when
  the user switches filter-editing modes. The canonical text rendering writes every group
  explicitly as `AND(clause,...)` or `OR(clause,...)`, using the existing Boolean operators
  and comma/parenthesis delimiters. This preserves group operator, arity (including one
  child), nesting, and clause order; ordinary infix and parenthesized input remains accepted.
- `SV-12` Field names and operators are whitelisted. The P1 work-item set, value types,
  bounds, parser, scope wrapper, pagination and response contract are defined in
  [API design](#pending-01-architectureapi-design-work-item-search-v1-post-api-work-itemssearch).
  The grammar compiles to parameterised SQL and can never express arbitrary SQL. A
  recognized field that is unavailable in P1 or not readable by the caller returns `422`
  naming that field; invalid shapes and values return `400`.
- `SV-13` `@me` is resolved at query time, so a saved view using it is personal to whoever
  runs it.

P1 implements `work_item` filters only. `sla.state`/`sla.due_at` require the documented
`work_item_sla_cache` table and loader; `cf.<key>` requires the custom-field value store and
visibility loader; `label` requires the `work_item_label` join table. These fields receive
an explicit `422` until those foundations exist. P1 also rejects non-work-item entities and
`groupBy`/`aggregate` with `422`; it does not silently return unfiltered or partial results.
The work-item list carries the text filter in its existing route's `filter` query parameter,
alongside its `layout`, `sort`, and `dir` state, so reloading or sharing the URL reproduces
the same query. The work-item list now provides visual and text filter editing with the same
filter AST, keeps editor mode in the URL, and forwards optional sort/column metadata without
adding defaults when those query properties were absent. Saved-view execution uses the same
search validator, current viewer reach, and field permissions as direct work-item search.

<a id="search-and-saved-views-saved-views"></a>
### Saved views

- `SV-14` A saved view stores: filter, sort, grouping, layout, and chosen columns — the
  `{ entity, filter, sort, groupBy, columns, aggregate }` envelope in `saved_view.query`
  ([api-design.md](#pending-01-architectureapi-design), [data model](data-model.md)).
- `SV-15` Views have three **visibility** levels — **private**, **team**, **workspace**
  (`saved_view.visibility`). This is a separate axis from `scope`/`scope_id`, which is the
  query's own context (a workspace or a project) and is unrelated to who can see the view.
- `SV-16` Private is the default. Sharing is a deliberate act.
- `SV-17` A team view is visible to team members. Team-lead editing is held for a later
  release; this release preserves the current owner and workspace-manager editing rules.
- `SV-18` A workspace view requires `workspace:manage_settings` to create and appears in
  everyone's navigation.
- `SV-19` Every view has a URL that fully encodes it, so it can be shared with someone who
  cannot see the saved view itself. *(v1's saved filters were not addressable, which made
  "look at this queue" an unshareable instruction.)*
- `SV-20` Views can be pinned to the sidebar, per user.
- `SV-22` A view scoped to a project names that project, so it is reachable only by callers who
  reach the project, whatever its visibility. The list omits it, and every route that addresses
  it by id (get, update, delete request, pin, run, count) answers exactly like a missing view
  (404), before any capability gate, and writes nothing. Creating a view with a project scope
  needs reach to that project; an unreachable project gets the same 400 as a missing one.
  Workspace-scoped views are unaffected.
- `SV-21` Duplicating a view is one click, which is how most views actually get made.

<a id="search-and-saved-views-queues"></a>
### Queues

A queue is a saved view over unassigned work and submissions, owned by a team. Used by
triage. See [intake queue](feature-contracts-p2.md#intake-queue).

- `SV-22` A queue shows a live count, which appears as a badge in navigation.
- `SV-23` Counts are cached for 30 seconds, in Valkey when configured. When Valkey is
  absent, the count is computed per request instead of cached — correct, just not fast
  ([api-design.md](#pending-01-architectureapi-design)'s rate-limit note makes the same call).

<a id="search-and-saved-views-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| Search | Any authenticated session; scoped to reach |
| Create a private view | Any authenticated session |
| Create or publish a team view | `saved_view:share` **and** membership in the target team |
| Create a workspace view | `workspace:manage_settings` |
| Edit a shared view | Owner, or `workspace:manage_settings` |

<a id="search-and-saved-views-screens"></a>
### Screens

| Screen | Purpose |
| --- | --- |
| Command palette | `⌘K` overlay — global search, navigation, actions (`SV-1`) |
| Global search results | The full results list, for a query the palette alone can't hold |
| Saved views index | Every view the actor can reach, pinned ones first; create a private view by default or choose team/workspace visibility |
| Saved view | One view, rendered in its stored layout; the editor can change its name, query, visibility, and team audience |

Routes and status in the [screen inventory](#pending-02-designscreen-inventory).

<a id="search-and-saved-views-api"></a>
### API

```
POST /api/work-items/search                    work_item:read
GET  /api/search?q=…&kinds=…                   work_item:read (scope workspace via `X-Workspace-Id`; results reach-filtered)
GET  /api/views                                saved_view:read (scope workspace; each reachable view includes the caller's `isPinned` state, pinned views first)
POST /api/views                                saved_view:create (scope workspace)
GET  /api/views/{id}                           saved_view:read — the view's own workspace; shared-with is part of reach
PATCH /api/views/{id}                          workspace:manage_settings · orOwner(created_by, saved_view:create)
DELETE /api/views/{id}                         workspace:manage_settings · orOwner(created_by, saved_view:create) → 202 pending action
POST /api/views/{id}/pin                       self (kind 2 — the caller's own `user_preference` row)
POST /api/views/{id}/run                       saved_view:read (re-evaluated work-item reach and field permissions)
GET  /api/views/{id}/count                     saved_view:read (cached 30 s)
```

For this release, these PATCH/DELETE admission checks use the caller's native workspace
membership role. A validated projected `membership` does not widen admission to edit
another person's view: a native member with projected manager capabilities receives 403
before a pending action, requested event or requested audit entry is created. Pending-action
approval still evaluates current authority after a request has genuinely passed route
admission. Native manager/owner access and terminal invalidation behavior for actions that
were actually created remain covered by their separate contracts. Any future change to
combine native and projected authority at this route needs an explicit authorization design
and security review.

P1's saved-view screen currently renders the list layout. Other stored layout values remain
round-trippable but show an explicit unsupported-layout state in this screen. A pinned view
appears in agent navigation with its current-viewer work-item count; pinning and count queries
are keyed by viewer identity, and the server rechecks view and work-item permissions before
returning each count. Team-lead editing and shared-view owner transfer are held for a later
release. Existing owner and workspace-manager access remains in force.

<a id="search-and-saved-views-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| View references a deleted label or state | The chip renders "(deleted)" and can be removed. The view still runs |
| Shared view whose owner leaves | Team-lead/workspace ownership transfer is held for a later release; existing owner and workspace-manager access rules remain in force |
| View returns out-of-reach items for a different viewer | Filtered per viewer. Two people running one view legitimately see different results |
| 50,000 matches | Cursor pagination; `meta.total` is an exact count after workspace and project reach |
| Search query with only stop words | Returns recent items with an explanation rather than nothing |
| Non-Latin script query | Handled by the Postgres configuration; tested with CJK and Cyrillic |

<a id="search-and-saved-views-out-of-scope"></a>
### Out of scope

- Grouping, aggregation and chart types over the same filter grammar → tier 2/3 reports,
  [reports-and-dashboards.md](feature-contracts-p5.md#reports-and-dashboards) — a report is a `saved_view` with
  `layout: 'table'|'chart'`, contributing no new policy
- The `search.meilisearch` plugin's own implementation, unless and until `SV-10`'s threshold
  is actually measured missed

<a id="search-and-saved-views-testing"></a>
### Testing

Unit: filter grammar parse and compile, both directions; `@me` resolution.

Integration: search never returns out-of-reach records; a shared view yields per-viewer
results; the grammar cannot express injection.

E2E: palette opens and returns results under 100 ms against a seeded 10,000-item dataset;
save a view, share it, open its URL as another user.

<a id="search-and-saved-views-open-questions"></a>
### Open questions

None.

<a id="search-and-saved-views-related"></a>
### Related

- [Views](feature-contracts-p1.md#views) · [API design](#pending-01-architectureapi-design) · [Intake queue](feature-contracts-p2.md#intake-queue) ·
  [Teams](feature-contracts-p4.md#teams) · [Reports and dashboards](feature-contracts-p5.md#reports-and-dashboards)

## Pending foundation and decision references

Mappings to existing technical references provide maintained entrypoints; they do not certify full migration of every foundation clause. These linked contracts are not migrated by this feature reference. The rows identify the original contract, not an available archive dependency. Their normative details still require maintained migration; a link here does not close that gap. Current [requirements](../requirements.md) and [alignment](../alignment.md) retain the scope/precedence boundary.

<a id="pending-01-architectureadr0009-lazy-sla-evaluation"></a>
- **Pending maintained contract:** `docs/01-architecture/adr/0009-lazy-sla-evaluation.md`.
<a id="pending-01-architectureadr0011-ticket-lifecycle-engine"></a>
- **Pending maintained contract:** `docs/01-architecture/adr/0011-ticket-lifecycle-engine.md`.
<a id="pending-01-architectureapi-design"></a>
- **Pending maintained contract:** `docs/01-architecture/api-design.md`.
<a id="pending-01-architectureapi-design-work-item-search-v1-post-api-work-itemssearch"></a>
- **Pending maintained contract:** `docs/01-architecture/api-design.md#work-item-search-v1-post-api-work-itemssearch`.
<a id="pending-01-architectureinherited-features"></a>
- **Pending maintained contract:** `docs/01-architecture/inherited-features.md`.
<a id="pending-01-architecturepending-actions"></a>
- **Pending maintained contract:** `docs/01-architecture/pending-actions.md`.
<a id="pending-01-architecturerealtime"></a>
- **Pending maintained contract:** `docs/01-architecture/realtime.md`.
<a id="pending-01-architecturesecurity-model"></a>
- **Pending maintained contract:** `docs/01-architecture/security-model.md`.
<a id="pending-01-architecturestorage-and-attachments"></a>
- **Pending maintained contract:** `docs/01-architecture/storage-and-attachments.md`.
<a id="pending-02-designscreen-inventory"></a>
- **Pending maintained contract:** `docs/02-design/screen-inventory.md`.
<a id="pending-07-planningdecision-log"></a>
- **Pending product-decision/scope extraction (historical process is inactive):** `docs/07-planning/decision-log.md`.
<a id="pending-07-planningroadmap"></a>
- **Pending product-decision/scope extraction (historical process is inactive):** `docs/07-planning/roadmap.md`.
