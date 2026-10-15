# Views and layouts

- **Stage:** P1
- **Status:** ⬜
- **Feature flag:** per layout — `feature.calendar`, `feature.timeline` (Board, List and Table are always on).
  `feature.timeline` was `feature.gantt`; the UI says Timeline. The flag identifier is owned by
  [plugin-architecture.md](../01-architecture/plugin-architecture.md) and is not renamed here.
- **Depends on:** work items, states ([work items](work-items.md)); the structured filter and saved views
  ([search and saved views](search-and-saved-views.md)). **Later-phase inputs, each unavailable until
  its stage lands:** SLA state for the `VW-16` badge and the `VW-31` SLA filter (P2,
  [sla.md](sla.md)); custom fields for `VW-19`/`VW-31` custom-field columns and filters (P4,
  [custom-fields.md](custom-fields.md)); cycle, module and epic for `VW-27` grouping and the
  `VW-31` filters (P5, [agile.md](agile.md)); Calendar and Timeline themselves (P5).

## Purpose

One set of work, five ways of looking at it. Switching how you look must never change
*what* you are looking at.

v1 had board, backlog, list and sprints as four separate destinations, and moving between
them lost your filters. Here there is one destination — `/work` — with a layout parameter.

```
/agent/projects/{key}/work?layout=board&state=started&assignee=me
                                 ▲            ▲
                            presentation    the actual query
```

## Layouts

| Layout | Best for | Stage |
| --- | --- | :-: |
| **Board** | Flow. What is where, what is stuck | P1 |
| **List** | Reading. Grouped, scannable, dense | P1 |
| **Table** | Comparing. Sortable columns, inline edit | P1 |
| **Calendar** | Dates. What is due when | P5 |
| **Timeline** | Sequence. Dependencies and duration | P5 |

Backlog is a separate destination rather than a layout, because it has different semantics
— ranking rather than filtering.

## Behaviour

**Shared across layouts**

- `VW-1` Filter, sort, grouping and search live in the URL and survive a layout switch.
- `VW-2` Layout choice is remembered per project per user, and the URL always wins. See
  [Per-user preferences](#per-user-preferences).
- `VW-3` Every layout supports multi-select and the same bulk action bar.
- `VW-4` Every layout opens the detail side pane on selection, and the pane's route is
  addressable.
- `VW-5` Every layout receives WebSocket updates and reflects other people's changes live.
- `VW-6` Every layout honours the comfortable/compact density preference.
- `VW-7` Empty, loading and error states are designed per layout — a board skeleton has
  columns, a table skeleton has rows.

### Per-user preferences

`VW-2` (layout), `VW-6` (density), `VW-15` (collapsed groups), `VW-19` (chosen columns) and
`VW-21` (column widths) are per-user interface preferences, not shared query state, so none
of them lives in `saved_view` (a shared query object). Their authoritative home in the data
model is `user_preference` (`person_id`, `scope`, `scope_id`, `key`, `value jsonb` —
[data model](../01-architecture/data-model.md)); no new table is needed.

The contract is that these preferences persist in `user_preference`, so they follow the
person across devices and browsers. The routes, key mapping, whitelist, policy and limits are
specified in [settings-hierarchy.md](settings-hierarchy.md#profile-settings-routes)
(`GET`/`PATCH /api/me/settings`, `ST-12`–`ST-17`); this section does not repeat them.

- `VW-2` is the settings key `layout.<projectId>` (`board` or `list` in P1). The route exists on
  `main`, but the web read/write of the layout
  (`apps/web/src/lib/project-layout-preference.ts`, PR #688) is **not on `main` yet**. When it
  lands it must read and write through the route, keep `localStorage` only as a first-paint
  cache, write an existing local value to the server once, and still let the URL layout win.
- `VW-6` is the settings key `density` (`comfortable` or `compact`), one value per person, not
  per project, and is persisted server-side. The `user-preferences` store's `compactMode` flag
  is the first-paint cache.
- If the server is unreachable or rejects a read or write, the cache keeps working and the next
  load reconciles it. The UI never blocks on the route.
- `VW-15`, `VW-19` and `VW-21` are not implemented on `main`. Each needs a key and value schema
  added to the whitelist in settings-hierarchy.md before it can persist.

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
- `VW-14` Full keyboard drag: focus a card, `Space` to lift, arrows to move, `Space` to
  drop, `Escape` to cancel, with live-region announcements.

**List**

- `VW-15` Grouped by state by default, with collapsible groups whose state persists.
- `VW-16` Each row shows key, title, assignee, priority, SLA badge and due date.
- `VW-17` Inline editing of state, assignee and priority without leaving the row.
- `VW-18` Virtualised above 100 rows.

**Table**

- `VW-19` Columns are chosen by the user, including custom fields. The choice persists per
  project per user.
- `VW-20` Sortable by any column. Multi-column sort with modifier-click.
- `VW-21` Column widths are draggable and persist.
- `VW-22` Inline editing where the field type allows.
- `VW-23` Export the current view to CSV (or XLSX), respecting filters and column choice,
  through `POST /api/work-items/export` with `work_item:export` — a server-side route with a
  policy, because a bulk-egress path with no declared capability is the class of hole the
  route-coverage test exists to prevent. Exports are audited (`work_item.exported`).
  `work_item:export` is the capability [rbac.md](../01-architecture/rbac.md) defines for
  exporting "a view or list"; `report:export` guards report exports and does not apply.
  **The route does not exist on `main` yet.** Its row bound and delivery contract are an
  open question below, which blocks `VW-23` only.
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

## Filtering

The filter bar composes into the structured filter grammar described in
[API design](../01-architecture/api-design.md).

- `VW-31` Filters available, by phase. The P1 whitelist, operators and value types are the
  table in [API design](../01-architecture/api-design.md#work-item-search-v1-post-api-work-itemssearch):
  state group, type, assignee, priority, due date, created date, watcher and project. The
  rest are part of this rule but unavailable until their owning stage — a recognised
  field that is not yet backed returns `422` naming it, never an empty or unfiltered result:
  - **No backing store yet:** label (needs the `work_item_label` join), requester, any
    custom field (`cf.<key>`, P4).
  - **P2:** SLA state — see [SLA filtering](#sla-filtering).
  - **P5:** cycle, module, epic ([agile.md](agile.md)).
  - **`organisation`** is not a `work_item` column. It resolves through the project join,
    `work_item.project_id → project.organisation_id` (API design, "Fields are whitelisted per
    entity"); an internal project has a null organisation and matches no organisation value.
- `VW-32` `@me` is a first-class value for assignee, requester and watcher, so a saved
  view can be personal without being per-person.
- `VW-33` Filters combine with AND by default; an advanced editor exposes OR and nesting.
- `VW-34` The active filter is always visible as removable chips. A view that is filtered
  must never look unfiltered — that is how people conclude their data is missing.

### SLA filtering

`VW-16` (the SLA badge on list rows) and the `VW-31` SLA-state filter depend on SLA (P2).
Authoritative SLA state is never stored ([ADR 0009](../01-architecture/adr/0009-lazy-sla-evaluation.md),
[sla.md](sla.md)), so the mechanism is already decided and this spec adopts it:

- **Badge:** computed on read by the shared `packages/domain/src/sla/` function, the same
  one the detail endpoint uses. The computed value always wins.
- **Filter and sort:** `sla.state` and `sla.due_at` compile against `work_item_sla_cache`
  ([data model](../01-architecture/data-model.md)), refreshed by `sla-scan` every five
  minutes and therefore **eventually consistent**. A list filtered by SLA can disagree
  with a row's freshly computed badge by up to that interval, and the UI says so beside the
  filter.
- **Today:** the cache table and loader do not exist on `main`, so P1 returns `422` naming
  `sla.state`/`sla.due_at` (API design, Work-item search v1). SLA filtering is not
  available until P2 builds them.

## Saving

Any filter plus layout plus grouping plus columns can be saved as a view. See
[search and saved views](search-and-saved-views.md).

## Data

No table is owned here. Views read `work_item` (and its joins) through the search route;
saved configurations are `saved_view` ([search and saved views](search-and-saved-views.md));
per-user preferences are covered under [Per-user preferences](#per-user-preferences).

## Permissions

Reading a view requires `work_item:read` and reach on the project. Each action within a
layout requires its own capability, as below (capabilities and the routes' policies are
authoritative in [rbac.md](../01-architecture/rbac.md) and `apps/api/src/work-item/policy.ts`).
Where the actor lacks the capability, the control is disabled or the card is not draggable, and
the reason is available on hover.

| Action | Rule | Capability | Route on `main` |
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
| Export | `VW-23` | `work_item:export` | `POST /api/work-items/export` — **not on `main`** |
| Save as a view | Saving | `saved_view:create`; sharing per `SV-15`–`SV-18` | `POST /api/views` |

## Screens

`/agent/projects/{key}/work?layout=board|list|table|calendar|timeline` — see the
[screen inventory](../02-design/screen-inventory.md). Board, List and Table are P1; Calendar
and Timeline are P5.

## API

Views add no routes of their own beyond export. Layout and density are presentational and reach
the server only as per-user settings through `GET`/`PATCH /api/me/settings`
([settings-hierarchy.md](settings-hierarchy.md#profile-settings-routes)); the table's chosen
columns determine which fields are requested.

| Route | Policy | Used for |
| --- | --- | --- |
| `POST /api/work-items/search` | `work_item:read`, workspace from the body, project reach | Every layout's read, with the structured filter ([API design](../01-architecture/api-design.md#work-item-search-v1-post-api-work-itemssearch)) |
| `GET /api/projects/{projectId}/states` | `project:read`, project reach required | `VW-8`: the board's columns, including empty ones, in project order |
| `GET /api/work-items/{key}/transitions` | `work_item:read` | `VW-9`: the legal offers the transition control shows, each with `toStateName`; the control itself is shown from the `transitionTasks` flag of `/api/capabilities` |
| `POST /api/work-items/{key}/transition` | `work_item:transition` | `VW-9`, `VW-17`, `VW-22` |
| `POST /api/work-items/{key}/rank` | `work_item:rank` | `VW-10` (within-column order is read with `sort=position` on the list route; shown from the `rankTasks` flag) |
| `POST /api/work-items/{key}/assign` | `work_item:assign` (or self-target with `work_item:update`) | `VW-13`, `VW-17` |
| `PATCH /api/work-items/{key}` | `work_item:update`; `priority` also needs `work_item:set_priority` | `VW-13`, `VW-22`, `VW-26`, `VW-29` |
| `POST /api/work-items/bulk` | `work_item:read` at the route, per-operation capability inside | `VW-3` |
| `POST /api/work-items/export` | `work_item:export`, audited `work_item.exported` | `VW-23` — **not implemented; see Open questions** |

Layout and density use `/api/me/settings` (see above); column and width choices have no route yet.
Saving a view uses the routes in [search and saved views](search-and-saved-views.md).

## Edge cases

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

## Out of scope

- Backlog ranking → [work-items.md](work-items.md)
- Cycle and module views → [agile.md](agile.md)

## Testing

Each test is named for the rule it proves. Existing tests are cited by file; the rest are
owed by the implementing PR and use the quoted name.

Unit:

- `VW-1` URL state round-trips through a layout switch — `router-search-codec.test.ts`,
  `project-board-search.test.ts`, `project-layout-navigation.test.ts` (PR #688).
- `VW-2` "isolates the remembered layout by user and project" and "ignores invalid and
  unavailable storage values" — `project-layout-preference.test.ts` (PR #688); the URL layout
  beating the remembered one is in the board route test below.
- `VW-6` / `ST-17` "migrates an existing local compact value to the server exactly once",
  "adopts the server value over the local cache", "keeps the local cache and writes nothing
  when the server read fails" and "keeps a failed local change dirty and pushes it instead of
  the stale server value" — `apps/web/src/hooks/use-density-preference.test.tsx`;
  `apps/web/src/lib/user-preference-sync.test.ts`.
- `VW-2` the layout migration-once, URL-wins and offline-fallback tests are owed with the web
  layout wiring (PR #688); the route they call is covered below.
- `VW-31` "round-trips nested in/OR terms through the canonical AST" and "rejects arbitrary
  entities, unknown fields, and unavailable backing fields" —
  `tests/api/work-item-search-query.test.ts`.
- `VW-31` "organisation resolves through the project join" — owed, with the field.
- `VW-20`/`VW-10` sort order and rank arithmetic —
  `tests/api-integration/work-item-list-sort-pagination.test.ts`,
  `tests/api-integration/work-item-rank.test.ts` ("WI-11: ranking between two neighbours
  lands strictly in between and bumps version").
- `VW-13` "grouping by a non-state field disables drag-to-transition" — owed.

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
  owed with the route, once the open question below is settled.

Web route tests (PR #688, branch `codex/nav-url-state-successor`): `board.test.tsx` ("lets
the URL layout win over the remembered and profile layouts"), `backlog.test.tsx` and
`calendar.test.tsx` for `VW-1`/`VW-2`/`VW-4`.

Realtime: `VW-5` "refreshes active list, detail, and activity queries once per socket event
burst" — `apps/web/src/hooks/use-native-work-item-realtime.test.tsx`.

E2E: `VW-1` switch layout and confirm filters persist; `VW-14` keyboard-only board drag;
`VW-5` two browser contexts see each other's drag.

Performance: board with 200 items under 500 ms; table with 500 rows under 500 ms; no
dropped frames during drag.

## Open questions

- **`VW-23` export bound and delivery** — owner: Thomas, before `POST /api/work-items/export`
  is built. The capability (`work_item:export`), the route and the audit action are decided
  above; what is not is how the server bounds a large export: a maximum row count, whether
  the response streams, and any rate or time limit. The route must not accumulate every
  reachable match in memory, so none of these is invented here. **This blocks `VW-23` only.**
  Every other rule in this spec is unaffected.

## Related

- [Work items](work-items.md) · [Search and saved views](search-and-saved-views.md)
