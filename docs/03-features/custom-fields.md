# Custom fields

- **Phase:** P4
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
| `select` | One of a defined list |
| `multi_select` | Several of a defined list |
| `user` / `multi_user` | Directory reference, scoped to the project roster |
| `url` | Validated, rendered as a link |
| `email` | Validated |

Deliberately **not** supported in v2: formula and rollup fields. They are a small language
with evaluation order, error handling and performance characteristics, and they are the
kind of feature that is easy to start and impossible to finish. Recorded as a candidate
for a later phase.

## Data

`custom_field_section`, `custom_field`, `custom_field_type_visibility`,
`custom_field_value`. See [data model](../01-architecture/data-model.md).

Values are stored in a separate table keyed by entity, not as columns, so adding a field
is data rather than a migration.

## Behaviour

- `CF-1` A field belongs to a workspace and to one section.
- `CF-2` Visibility and requiredness are declared per work item type.
- `CF-3` A field not applicable to a type is absent from the form — not disabled, absent.
- `CF-4` A required field blocks creation and blocks any workflow transition into a
  `started` or `completed` state group if empty.
- `CF-5` Fields support a default value.
- `CF-6` Fields support conditional visibility: show only when another field has a given
  value.
- `CF-7` Select options carry a stable key and an editable label, so renaming an option
  does not orphan existing values.
- `CF-8` Deleting a field soft-deletes it. Values are retained and restorable for 30 days,
  after which they are purged.
- `CF-9` Changing a field's format is refused. Create a new field and migrate.
- `CF-10` Fields are filterable, sortable and available as table columns.
- `CF-11` Fields may be marked customer-visible, in which case they appear on the portal
  request detail and can be collected by a request type form.

## Entities that support custom fields

Work items in P4. Projects and people in P5.

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

```
GET    /api/custom-fields                      workspace:read
POST   /api/custom-fields                      custom_field:manage
PATCH  /api/custom-fields/{id}                 custom_field:manage
DELETE /api/custom-fields/{id}                 custom_field:manage
POST   /api/custom-fields/reorder              custom_field:manage
GET    /api/custom-field-sections              workspace:read
POST   /api/custom-field-sections              custom_field:manage
```

Field values travel inside the work item payload, not as a separate endpoint, so a form
save is one request.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Field made required while items are empty | Existing items keep the gap; the requirement applies on the next edit or transition. A report lists non-compliant items |
| Select option removed while in use | Refused. The option must be migrated first, and the editor shows how many items hold it |
| Field deleted then restored | Values return |
| Conditional field whose controller is deleted | Publish validation refuses the deletion |
| 100 fields on one type | Allowed, warned about, sections collapse. The interface degrades gracefully but the warning is honest |
| User-format field referencing someone off the roster | Value retained, rendered as "(not on this project)" |
| Import supplies an unknown select option | The import reports it rather than silently creating one |

## Testing

Unit: per-type visibility resolution; conditional evaluation; required-field gating on
transition.

Integration: values scoped by entity permission; option removal refused while in use;
soft-delete and restore round-trip.

E2E: define a field, make it required for one type, confirm the form changes for that type
only and that the transition is blocked when empty.

## Related

- [Work items](work-items.md) · [Request types](request-types-and-catalogue.md)
- [Settings hierarchy](settings-hierarchy.md)
