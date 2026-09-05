# Views and layouts

- **Phase:** P1
- **Status:** ⬜
- **Feature flag:** per layout — `feature.calendar`, `feature.gantt`
- **Depends on:** work items, states

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

| Layout | Best for | Phase |
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
- `VW-2` Layout choice is remembered per project per user, and the URL always wins.
- `VW-3` Every layout supports multi-select and the same bulk action bar.
- `VW-4` Every layout opens the detail side pane on selection, and the pane's route is
  addressable.
- `VW-5` Every layout receives WebSocket updates and reflects other people's changes live.
- `VW-6` Every layout honours the comfortable/compact density preference.
- `VW-7` Empty, loading and error states are designed per layout — a board skeleton has
  columns, a table skeleton has rows.

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
- `VW-23` Export the current view to CSV, respecting filters and column choice.
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

- `VW-31` Filters available: state, state group, type, assignee, requester, priority,
  label, cycle, module, epic, due date range, created date range, SLA state, watcher,
  organisation, any custom field.
- `VW-32` `@me` is a first-class value for assignee, requester and watcher, so a saved
  view can be personal without being per-person.
- `VW-33` Filters combine with AND by default; an advanced editor exposes OR and nesting.
- `VW-34` The active filter is always visible as removable chips. A view that is filtered
  must never look unfiltered — that is how people conclude their data is missing.

## Saving

Any filter plus layout plus grouping plus columns can be saved as a view. See
[search and saved views](search-and-saved-views.md).

## Permissions

Reading a view requires `work_item:read` and reach on the project. Each action within a
layout requires its own capability — drag-to-transition needs `work_item:transition`, and
where the actor lacks it, cards are not draggable and the reason is available on hover.

## API

All layouts read from `POST /api/work-items/search` with the structured filter. Layout is
purely presentational and never reaches the server, except that the table's chosen columns
determine which fields are requested.

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

## Out of scope

- Backlog ranking → [work-items.md](work-items.md)
- Cycle and module views → [agile.md](agile.md)

## Testing

Unit: filter grammar compilation; grouping; rank arithmetic.

Integration: search returns only items within reach; an illegal drag-transition is
refused with a reason.

E2E: switch layout and confirm filters persist; keyboard-only board drag; two browser
contexts see each other's drag.

Performance: board with 200 items under 500 ms; table with 500 rows under 500 ms; no
dropped frames during drag.

## Open questions

None.

## Related

- [Work items](work-items.md) · [Search and saved views](search-and-saved-views.md)
