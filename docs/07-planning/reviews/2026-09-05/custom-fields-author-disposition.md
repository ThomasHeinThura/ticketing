# Custom-fields review disposition candidate

**Purpose:** map the findings in `features-governance-design.md` §4 to the current
normative authorities before an independent readiness check. This is an author disposition
candidate, not a reviewer verdict. The original findings and the section's `not-ready`
verdict remain unchanged until a fresh independent context verifies the exact updated
sources.

## Source set

- `docs/03-features/custom-fields.md`
- `docs/03-features/request-types-and-catalogue.md` RT-3/IQ-8 mapping dependency
- `docs/01-architecture/data-model.md` §5
- `docs/01-architecture/api-design.md` §Workspace context and query authorization
- `docs/02-design/screen-inventory.md`

## Finding map

| Original §4 finding | Candidate normative resolution | Independent disposition |
| --- | --- | --- |
| CF-6 conditional visibility has no stored shape or evaluation rules | `custom-fields.md` CF-6 now specifies the single-level `{field_key, op, value?}` grammar, closed operators, nonconditional controller, shared evaluator and server-authoritative requiredness. `data-model.md` already lists `visibility_condition jsonb`; request-type `showIf` uses the same shape. | Pending; do not implement custom-field runtime until verified |
| CF-11 customer-visible flag is absent | `data-model.md` lists `customer_visible`; CF-11 keeps customer exposure limited to configured visible values and request-type collection. | Pending |
| CF-8 restore window/route/storage is absent | Model lists `deleted_at`; CF-8 defines confirmed pending-action deletion, 30-day restore/purge, and restore route. | Pending |
| Entity applicability is absent | Model lists `entity_type`; feature spec constrains P4 to `work_item` and forbids runtime writes for reserved later-stage entity values. Type visibility is work-item-only. | Pending |
| Field editor help text has no column | Model lists `help_text`; field editor names it. | Pending |
| CRUD/section/visibility/report routes are incomplete | Feature API table now gives exact methods, paths, capability, scope source and behaviors for field CRUD/restore/reorder, section CRUD/reorder, type-visibility replacement and a non-compliance report. | Pending; route implementation is separate work |
| Workspace-less reads have no workspace resolution | `api-design.md` already defines `X-Workspace-Id` or GET `?workspace=`, membership validation before policy, absent `400`, nonmember `404`. Feature API rows bind request-scope routes to that contract. | Pending |
| Screen inventory omits editor | `screen-inventory.md` contains the workspace field-list route and `/agent/settings/custom-fields/{id}` editor route. The section manager is an in-route section of the field-list screen, matching its existing inventory row. | Pending; the historical finding is stale against the current inventory |
| No Open questions / Out of scope section | `custom-fields.md` now has both sections: formulas/rollups, later entity kinds and saved-view implementation are explicitly out of scope; open questions are `None` for the P4 work-item-only contract. | Pending |
| CF-4 does not state cancellation behavior | CF-4 now explicitly exempts the `cancelled` state group. | Pending |
| “Publish validation” is used for field deletion | The conditional-controller edge now states deletion is refused while active dependent fields exist and describes the bounded response. | Pending |
| CF-10 lacks saved-view query key linkage | CF-10 now names `cf.<key>` and links to `search-and-saved-views.md`; its reach/filter inference constraint is explicit. | Pending |
| RT-3 does not specify the custom-field target representation needed by this dependency | `request-types-and-catalogue.md` now defines `mapsTo.field = "cf.<key>"`, workspace binding, required publish checks, immutable key pinning, and atomic refusal at acceptance if the definition becomes invalid. `custom-fields.md` states that the key is immutable and workspace-unique. | Pending; `data-model.md` key uniqueness annotation requires coordination with its current owner |

## Verification boundary

The schema table in `data-model.md` already lists `entity_type`, `visibility_condition`,
`help_text`, `customer_visible`, and `deleted_at`, and the retention table includes the
30-day purge window. The API design already defines workspace context. Those source facts
resolve the historical documentation omissions; they do not mean the corresponding API,
database runtime schema, retention job, UI, or tests have been implemented. The screen
inventory has separate list and editor routes as noted above. The feature spec names
planned test files and does not report them as existing.

The data-model owner has been asked to record the immutable workspace-unique key constraint
and default-false customer visibility contract. That binding remains pending until the
owner's data-model checkpoint is frozen. No reviewer or author has cleared the historical
`not-ready` verdict in this packet.

## Intake dependency boundary

The only P2 custom-field dependency is work-item definition lookup, published type-visibility
and conditional validation, customer-visibility for catalogue forms, and atomic custom-value
writes during acceptance. The canonical RT-3/IQ-8 mapping contract remains authoritative.
This packet does not authorize unrelated custom-field management UI or imply that any
custom-field runtime has been implemented. Until independent readiness clears §4, no
custom-field code, migration, API route, or acceptance path that persists custom-field
values may be claimed complete.
