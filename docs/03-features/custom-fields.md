# Custom fields

- **Stage:** P4
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** work item types, RBAC

## Purpose

Capture what a particular organisation needs to know, without a code change.

Every service desk needs fields we cannot anticipate: asset tag, cost centre, affected
site, change risk, contract reference. A product that cannot express them is not usable
by anyone.

## The problem to avoid

Custom fields metastasise. An instance acquires forty of them and every work item form
becomes a wall. This is the single most common way a configurable ticketing system becomes
unpleasant.

OpenProject's answer, which we adopt: **sections** and **per-type visibility**.

- Fields are grouped into named sections.
- Each field declares which work item types it applies to, and whether it is required for
  each.
- A form shows only the sections containing fields relevant to this type, and sections
  collapse.

So an instance with forty fields still shows a change request six of them.

## Field formats

| Format | Notes |
| --- | --- |
| `text` | Single line, max 500 |
| `long_text` | Multi-line, rich text optional |
| `number` | Integer |
| `decimal` | Fixed precision |
| `currency` | Amount plus currency code |
| `date` / `datetime` | Timezone-aware |
| `boolean` | Rendered as a switch |
| `select` | One of a defined list of `{ key, label }` options |
| `multi_select` | Several of a defined list of `{ key, label }` options |
| `user` / `multi_user` | Directory reference, scoped to the project roster |
| `url` | Validated, rendered as a link |
| `email` | Validated |

Deliberately **not** supported in v2: formula and rollup fields. They are a small language
with evaluation order, error handling and performance characteristics, and they are the
kind of feature that is easy to start and impossible to finish. Recorded as a candidate
for a later stage.

## Data

`custom_field_section`, `custom_field`, `custom_field_type_visibility`,
`custom_field_value`. See [data model](../01-architecture/data-model.md). P4 supports
`entity_type = 'work_item'` only. Other entity values reserved in the data model are later
stage scope. Each value write copies `project_id` and `organisation_id` from the
authoritative parent work item in the same transaction. Reads always start from an
authorized parent query; the polymorphic value table is never a standalone reach source.

Values are stored in a separate table keyed by entity, not as columns, so adding a field
is data rather than a migration.

## Behaviour

- `CF-1` A field belongs to a workspace and to one section. Its key is unique and
  immutable within that workspace; an edit may change the display name but never the key.
- `CF-2` Visibility and requiredness are declared per work item type.
- `CF-3` A field not applicable to a type is absent from the form — not disabled, absent.
- `CF-4` A required field blocks creation and blocks any workflow transition into a
  `started` or `completed` state group if empty. `cancelled` is deliberately exempt: an
  incomplete item can always be abandoned.
- `CF-5` Fields support a default value.
- `CF-6` A field may have one `visibility_condition` with the exact shape
  `{ field_key, op, value? }`, where `op` is `eq`, `neq`, `in`, or `is_set` (the same
  vocabulary and JSON value semantics as request-type `showIf`). A controller must be a
  different field on the same work-item type and may not itself be conditional; chained
  conditions are rejected when field definitions or request-type form mappings are
  published. The same pure evaluator is used by agent forms, portal forms and server
  validation. The server is authoritative: absent, hidden or non-applicable fields never
  satisfy requiredness, and submitted values for invisible fields are ignored.
  `eq` and `neq` compare JSON values structurally; `in` requires `value` to be an array
  and matches one member; `is_set` ignores `value` and is true for any non-null value
  except an empty or whitespace-only string. A missing condition, or `null`, means always
  visible.
- `CF-7` Select options carry a stable key and an editable label, so renaming an option
  does not orphan existing values.
- `CF-8` Deleting a field sets `deleted_at` only after the user confirms the pending action
  (`custom_field:manage`, click-level; [pending-actions.md](../01-architecture/pending-actions.md)).
  Values remain retained and inaccessible to forms for 30 days. A manager may restore it
  during that window with `POST /api/custom-fields/{id}/restore`; restore clears
  `deleted_at` and preserves the stable key and values. After 30 days the purge job removes
  the definition and retained values, and restoration is unavailable.
- `CF-9` Changing a field's format is refused. Create a new field and migrate.
- `CF-10` Fields are filterable, sortable and available as table columns through the saved
  view query DSL's `cf.<key>` form ([search-and-saved-views.md](search-and-saved-views.md)).
  Each query applies caller row reach before filtering or computing counts; internal-only
  fields cannot be used by customers as filters or aggregates.
- `CF-11` Fields may be marked customer-visible, in which case they appear on the portal
  request detail and can be collected by a request type form. New fields default to
  `customer_visible = false`; changing the flag does not make a field visible to an
  organisation unless the request type is separately assigned to that organisation.

## Entities that support custom fields

Work items only in P4 (`entity_type = 'work_item'`); `custom_field_type_visibility` is
valid only for work-item fields. Projects and people are P5 scope; time-entry and cycle
values are later-stage scope. Their reserved data-model entity values do not authorize
runtime writes before those stages.

## Permissions

| Action | Capability |
| --- | --- |
| See field values | The capability for the entity |
| Set values | The update capability for the entity |
| Create, edit, delete fields | `custom_field:manage` |
| Reorder sections | `custom_field:manage` |

## Screens

**Field list** — grouped by section, showing format, which types use it, and a usage
count.

**Field editor** — name, key, format, options, default, help text, section, per-type
visibility matrix, conditional rules, customer visibility.

The per-type visibility matrix is a grid of types × (hidden / visible / required). A
manager configuring this thinks in a grid; presenting it as a list of forms makes it
unusable.

**Section manager** — drag to reorder sections and to move fields between them.

## API

| Method and path | Capability | Scope source | Behavior |
| --- | --- | --- | --- |
| `GET /api/custom-fields` | `workspace:read` | request (`X-Workspace-Id` or GET `?workspace=`) | List active work-item fields and type-visibility rows |
| `POST /api/custom-fields` | `custom_field:manage` | request | Create a work-item field; entity type is not client-selectable in P4 |
| `PATCH /api/custom-fields/{id}` | `custom_field:manage` | row | Edit a field without changing its key, format, entity type, or workspace |
| `DELETE /api/custom-fields/{id}` | `custom_field:manage` | row | Start the click-level pending action; values are retained pending confirmation |
| `POST /api/custom-fields/{id}/restore` | `custom_field:manage` | row | Restore a deleted field within 30 days |
| `POST /api/custom-fields/reorder` | `custom_field:manage` | request | Reorder fields within one section; every field must be in the selected workspace and section |
| `GET /api/custom-field-sections` | `workspace:read` | request (`X-Workspace-Id` or GET `?workspace=`) | List sections and active field counts |
| `POST /api/custom-field-sections` | `custom_field:manage` | request | Create a section |
| `PATCH /api/custom-field-sections/{id}` | `custom_field:manage` | row | Rename; workspace is immutable |
| `DELETE /api/custom-field-sections/{id}` | `custom_field:manage` | row | Refuse while active fields remain; empty sections may be deleted |
| `POST /api/custom-field-sections/reorder` | `custom_field:manage` | request | Reorder sections in one workspace |
| `PUT /api/custom-fields/{id}/type-visibility` | `custom_field:manage` | row | Replace the complete work-item-type visibility/requiredness matrix |
| `GET /api/custom-fields/compliance` | `custom_field:manage` | request | List only in-reach work items missing a required field for the requested type |

For every `request` scope route the workspace context contract in
[api-design.md](../01-architecture/api-design.md#workspace-context) applies: the header or
GET query is validated against the caller's membership before policy evaluation; absent
context is `400`, and a nonmember receives indistinguishable `404`. A `row` route resolves
the definition first, derives its workspace from that row, and returns `404` outside the
caller's reach. The compliance route filters through the same authorized work-item scope
before returning references or counts; it cannot reveal out-of-reach items or provide an
internal-field filter oracle.

Field values travel inside the work item payload, not as a separate endpoint, so a form
save is one request.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Field made required while items are empty | Existing items keep the gap; the requirement applies on the next edit or transition. A report lists non-compliant items |
| Select option removed while in use | Refused. The option must be migrated first, and the editor shows how many items hold it |
| Field deleted then restored | Values return |
| Conditional field whose controller is deleted | Deletion is refused while active conditional fields reference it; the response identifies only in-reach field definitions |
| 100 fields on one type | Allowed, warned about, sections collapse. The interface degrades gracefully but the warning is honest |
| User-format field referencing someone off the roster | Value retained, rendered as "(not on this project)" |
| Import supplies an unknown select option | The import reports it rather than silently creating one |

## Testing

Unit: `custom-field-visibility.test.ts` → CF-2, CF-3, CF-6; `custom-field-requiredness.test.ts`
→ CF-4.

Integration: `custom-field-value-reach.test.ts` → CF-11; `custom-field-options.test.ts`
→ CF-7; `custom-field-delete-restore.test.ts` → CF-8; `custom-field-type-visibility.test.ts`
→ CF-2, CF-3, CF-4.

E2E: `custom-field-editor.spec.ts` → CF-1–CF-9, CF-11: define a field, make it required
for one type, confirm the form changes for that type only, and verify that the transition
is blocked when empty.

The request-type/intake dependency test `intake-custom-field-mapping.test.ts` → CF-11,
RT-3, IQ-8 covers a published custom-field mapping whose definition is later deleted: the
queued submission retains its pinned raw form value, but acceptance refuses atomically
rather than dropping or remapping it. These are planned test files; the specification does
not claim that unimplemented custom-field runtime or tests already exist.

## Related

- [Work items](work-items.md) · [Request types](request-types-and-catalogue.md)
- [Settings hierarchy](settings-hierarchy.md)

## Out of scope

- Formula and rollup fields are deferred; their evaluation language and ordering are not
  part of the supported fixed-format value model.
- Custom fields on projects, people, time entries, cycles, or other entities are not P4
  runtime scope.
- Saved-view implementation is owned by
  [search-and-saved-views.md](search-and-saved-views.md); this spec defines only the
  `cf.<key>` field reference it consumes.

## Open questions

None. The P4 work-item-only contract above does not imply later entity types are supported.

## Readiness disposition

The historical `not-ready` review in
[`features-governance-design.md`](../07-planning/reviews/2026-09-05/features-governance-design.md)
has an author disposition candidate in
[`custom-fields-author-disposition.md`](../07-planning/reviews/2026-09-05/custom-fields-author-disposition.md).
That candidate is not independent readiness clearance. The work-item definition,
type-visibility, customer-visibility and value-persistence slice required by request-type
RT-3 / intake IQ-8 remains unimplemented until an independent reviewer verifies the
updated contract and clears the owning review section.
