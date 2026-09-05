# Search and saved views

- **Phase:** P1
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** work items, views

## Purpose

Find anything quickly, and keep the queries you run repeatedly.

Two things that look separate but are the same underneath: a saved view **is** a stored
search plus a presentation choice.

## Global search

- `SV-1` `⌘K` opens the command palette. It searches work items, projects, people, saved
  views, knowledge base articles — and also offers navigation destinations and actions.
- `SV-2` Results are grouped by kind, with the best match first, and are keyboard
  navigable throughout.
- `SV-3` Search is scoped to the actor's reach. Out-of-reach records simply do not appear.
- `SV-4` Typing a work item key jumps straight to it.
- `SV-5` Results appear within 100 ms for typical queries. This is a hard requirement — a
  slow palette stops being used, and then the navigation depth becomes a real problem.
- `SV-6` Recent items appear before any query is typed.

## Search backend

Postgres full-text by default, via a generated `tsvector` column with weighted title and
description.

- `SV-7` Title matches weight above description matches.
- `SV-8` Prefix matching so results update as you type.
- `SV-9` Trigram similarity as a fallback for typos.
- `SV-10` A `search.meilisearch` plugin exists as an option, to be enabled **only** if
  Postgres is measured to be insufficient. Not on principle, not preemptively.

## Structured search

The filter grammar from [API design](../01-architecture/api-design.md). Available as a
visual builder and, for people who prefer it, a text syntax:

```
assignee:@me state:started sla:at_risk due:<7d label:urgent
project:SUP type:incident priority:>=high created:>2026-01-01
```

- `SV-11` The text syntax and the visual builder are two renderings of one document.
  Switching between them is lossless.
- `SV-12` Field names are whitelisted. The grammar compiles to parameterised SQL and can
  never express arbitrary SQL.
- `SV-13` `@me` is resolved at query time, so a saved view using it is personal to whoever
  runs it.

## Saved views

- `SV-14` A saved view stores: filter, sort, grouping, layout, and chosen columns.
- `SV-15` Views have three scopes — **private**, **team**, **workspace**.
- `SV-16` Private is the default. Sharing is a deliberate act.
- `SV-17` A team view is visible to team members and editable by the owner and team leads.
- `SV-18` A workspace view requires `workspace:manage_settings` to create and appears in
  everyone's navigation.
- `SV-19` Every view has a URL that fully encodes it, so it can be shared with someone who
  cannot see the saved view itself. *(v1's saved filters were not addressable, which made
  "look at this queue" an unshareable instruction.)*
- `SV-20` Views can be pinned to the sidebar, per user.
- `SV-21` Duplicating a view is one click, which is how most views actually get made.

## Queues

A queue is a saved view over unassigned work and submissions, owned by a team. Used by
triage. See [intake queue](intake-queue.md).

- `SV-22` A queue shows a live count, which appears as a badge in navigation.
- `SV-23` Counts are cached for 30 seconds. A badge that triggers a query on every render
  is how a list page becomes slow.

## Permissions

| Action | Capability |
| --- | --- |
| Search | Any authenticated session; scoped to reach |
| Create a private view | Any authenticated session |
| Create a team view | Team membership |
| Create a workspace view | `workspace:manage_settings` |
| Edit a shared view | Owner, or `workspace:manage_settings` |

## API

```
POST /api/work-items/search                    work_item:read
GET  /api/search?q=…&kinds=…                   (scoped to reach)
GET  /api/views                                (scoped)
POST /api/views                                (per scope)
GET  /api/views/{id}                           (per scope)
PATCH /api/views/{id}                          owner | workspace:manage_settings
DELETE /api/views/{id}                         owner | workspace:manage_settings
POST /api/views/{id}/pin                       (self)
GET  /api/views/{id}/count                     (cached 30s)
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| View references a deleted label or state | The chip renders "(deleted)" and can be removed. The view still runs |
| Shared view whose owner leaves | Ownership transfers to a team lead, or to the workspace |
| View returns out-of-reach items for a different viewer | Filtered per viewer. Two people running one view legitimately see different results |
| 50,000 matches | Cursor pagination; the count is an estimate above 10,000 and says so |
| Search query with only stop words | Returns recent items with an explanation rather than nothing |
| Non-Latin script query | Handled by the Postgres configuration; tested with CJK and Cyrillic |

## Testing

Unit: filter grammar parse and compile, both directions; `@me` resolution.

Integration: search never returns out-of-reach records; a shared view yields per-viewer
results; the grammar cannot express injection.

E2E: palette opens and returns results under 100 ms against a seeded 10,000-item dataset;
save a view, share it, open its URL as another user.

## Related

- [Views](views.md) · [API design](../01-architecture/api-design.md) · [Intake queue](intake-queue.md)
