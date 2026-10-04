# Custom-fields review disposition and readiness record

**Purpose:** preserve the findings in `features-governance-design.md` §4, map each to the
current normative authorities, and record independent readiness evidence. The original
findings and 2026-09-05 `not-ready` verdict remain historical evidence; the latest current
contract disposition is below.

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
| RT-3 does not specify the custom-field target representation needed by this dependency | `request-types-and-catalogue.md` defines `mapsTo.field = "cf.<key>"`, workspace binding, required publish checks, immutable key pinning, and atomic refusal at acceptance if the definition becomes invalid. `custom-fields.md` states that the key is immutable and workspace-unique. | Pending independent recheck |

## Verification boundary

The schema table in `data-model.md` lists the canonical model, and the API design defines
workspace context. These source facts resolved the historical contract omissions. The
current P2 implementation scope is recorded below; the broader custom-field management API,
editor UI, retention job, and full P4 test set remain unimplemented.

The data-model records the immutable workspace-unique key constraint and default-false
customer visibility contract. The historical `not-ready` verdict is not erased; current
contract clearance is recorded separately below.

## Independent readiness delta — 2026-10-04

The fresh GPT-6 Luna readiness review of `83be1d64032bda676a56444ffcb0ce1f4ef7c094`
confirmed all 12 original findings were resolved and identified three additional contract
gaps. Its report is
`/Users/heinthura/.codex/taskdesk-evidence/2026-10-04/custom-field-owning-readiness-83be1d64/review-report.md`.
The following author corrections address those findings and the review's bounded
observations; this is not the independent recheck. The prior 12 dispositions remain
preserved.

| Delta finding | Author contract correction | Disposition |
| --- | --- | --- |
| Requiredness had both a global `custom_field.is_required` and a per-type matrix value | Removed `is_required` from the canonical field row. `custom_field_type_visibility.required` is now explicitly the only requiredness authority for a work-item type. | Cleared by independent readiness review below |
| CF-5 did not define default application or ordering | Defaults materialize once at work-item creation, including intake conversion, only for omitted active/applicable/visible fields; explicit null stays empty. Unconditional defaults resolve before single-level conditions and dependent defaults. They are validated at save and revalidated against current options/roster at materialization; failure aborts creation. They never affect existing reads/edits or submission answers. Portal-form defaults, if separately specified, belong to the immutable request-form version. | Cleared by independent readiness review below |
| Accepted JSON value shapes were incomplete | `custom-fields.md` defines exact accepted JSON for all formats: safe integers; canonical decimal strings with at most 18 digits and 6 fractional places; exact currency object and runtime-supported uppercase code; year-bounded Gregorian dates; offset-bearing RFC 3339 instants with millisecond precision stored as UTC; booleans; active option keys; active `person.id` values on the current project roster with duplicate rejection; bounded plain text; HTTP(S) URLs; and existing invitation-email validation. Invalid input receives a generic 400 with no coercion or truncation, and writes are atomic. | Cleared by independent readiness review below |
| Compliance route lacked exact type input and response | The route row names `workItemTypeId`, cursor and limit inputs; its response is a cursor page of one row per in-reach item with missing required field keys and a reach-filtered total. The selected type must belong to the request workspace. | Cleared by independent readiness review below |
| Fixed-vs-configurable deleted-item retention wording differed | CF-8 and the data-model now use configured deleted-item retention, with a 30-day default, matching the global retention table and God Mode configuration contract. | Cleared by independent readiness review below |
| Format/default tests were not named | The feature spec names planned format/default test files and the added pure domain suite exercises each canonical format, boundaries, null versus omission, default precedence, and hidden/nonapplicable definitions. The P2 acceptance dependency now has `tests/api-integration/intake-custom-field-mapping.test.ts` for mapped/default value writes and atomic refusal after deletion of a pinned definition. | Spec gap cleared; P2 focused runtime proof: 2/2 PostgreSQL integration tests |

### Independent owning-readiness clearance — 2026-10-04

A fresh independent GPT-6 Luna reviewed exact source SHA
`efe21b6defdb5464cc89df0785e106d5e0563bbe` and returned **READY**, confirming all 12
original findings and the three contract gaps above are resolved. The complete report is
`/Users/heinthura/.codex/taskdesk-evidence/2026-10-04/custom-field-owning-readiness-efe21b6d/review-report.md`.
This is a contract-readiness verdict only: it authorizes implementation and does not claim
that the custom-field API, editor UI, or runtime tests are complete. The historical
2026-09-05 `not-ready` verdict and finding text in
`features-governance-design.md` remain unchanged as historical evidence; current owning §4
status is cleared by the exact independent review above.

This current READY disposition supersedes the pending author-status cells in the original
finding map and in the 2026-10-04 author-correction table. The independent report explicitly
confirmed all 12 original findings and the three contract gaps resolved; no current owning
§4 contract finding remains active. Runtime/API/UI completion is not implied by readiness.

## Intake dependency boundary

The only P2 custom-field dependency is work-item definition lookup, published type-visibility
and conditional validation, customer-visibility for catalogue forms, and atomic custom-value
writes during acceptance. The canonical RT-3/IQ-8 mapping contract remains authoritative.
This packet authorizes the bounded RT-3/IQ-8 dependency: persisted definitions and
type-visibility, server validation/default resolution, and atomic value writes during
submission acceptance. It does not claim the unrelated custom-field management API/editor,
ordinary work-item value editing, compliance report, deletion/restore job, or full P4 feature
is implemented.
