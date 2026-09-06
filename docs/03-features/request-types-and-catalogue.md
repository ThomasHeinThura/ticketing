# Request types and catalogue

- **Stage:** P2
- **Status:** ⬜
- **Feature flag:** `feature.intake`
- **Depends on:** work item types, workflows, SLA, custom fields

## Purpose

Give customers a small, comprehensible menu of things they can ask for — instead of a
blank "describe your problem" box that produces unusable tickets.

A request type is a template: a name customers understand, a form that collects what the
team actually needs, and a mapping onto the internal work item type, workflow and SLA
policy that staff use.

This is Jira Service Management's best idea and the thing that most improves ticket
quality.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Request type** | Customer-facing template. "Report a printer fault" |
| **Group** | A heading in the catalogue. "Hardware", "Access", "New work" |
| **Form** | The fields shown to the customer, defined by a schema |
| **Catalogue** | The set of request types visible to a given customer |
| **Version** | An immutable snapshot of a form, so old submissions remain interpretable |

## Data

`request_type`, `request_type_version`. The form schema is JSONB.

```jsonc
{
  "fields": [
    { "key": "summary", "type": "text", "label": "What's wrong?", "required": true },
    { "key": "location", "type": "select", "label": "Where?",
      "options": ["Ward 3", "Reception", "Theatre 1"], "required": true },
    { "key": "asset", "type": "text", "label": "Asset tag", "help": "On the sticker" },
    { "key": "impact", "type": "select", "label": "Who is affected?",
      "options": ["Just me", "My team", "Everyone"], "required": true,
      "mapsTo": { "field": "priority",
                  "map": { "Just me": "low", "My team": "medium", "Everyone": "high" } } },
    { "key": "attachments", "type": "file", "label": "Photos", "multiple": true }
  ]
}
```

## Behaviour

**Definition**

- `RT-1` A request type maps to exactly one work item type, which supplies the workflow.
- `RT-2` It may override the SLA policy inherited from the project.
- `RT-3` A form field either maps to a native field (`mapsTo`), maps to a custom field, or
  is stored in `submission.form_data` and rendered into the work item description.
- `RT-4` `mapsTo` may translate values, as in the impact-to-priority example. This is how
  you avoid asking customers to choose a priority, which they always get wrong.
- `RT-5` Fields support conditional visibility: show this field only when that field has
  this value.
- `RT-6` Publishing creates an immutable version. Submissions record which version they
  used, so a form change never makes an old submission uninterpretable.

**Catalogue**

- `RT-7` A request type is visible in the portal only if `customer_visible` and its group
  is enabled for the customer's organisation.
- `RT-8` Per-organisation catalogues are a subset — one customer sees eight request types,
  another sees three.
- `RT-9` Ordering within a group is manual. Groups are ordered manually.
- `RT-10` The catalogue is searchable, and searching also matches knowledge base articles
  — see below.

**Deflection**

- `RT-11` As a customer types a summary, matching published KB articles are offered:
  "This might help: *Resetting your VPN password*".
- `RT-12` Opening an article records a deflection candidate. If the customer then abandons
  the form, it counts as a deflection in reporting.
- `RT-13` Deflection is never coercive. There is no "are you sure you still want to raise
  this?" step. It offers help and gets out of the way.

**Submission**

- `RT-14` Submitting creates a `submission` with reference `SUB-n`, not a work item.
  Triage turns it into one. See [intake queue](intake-queue.md).
- `RT-15` A request type may be marked **auto-accept**, in which case a work item is
  created immediately and the submission is closed. Used for well-understood, high-volume
  requests.
- `RT-16` Drafts are persisted per request type per version, so a half-completed form
  survives a closed tab. Cleared on successful submission.

## Permissions

| Action | Capability |
| --- | --- |
| See the catalogue | Portal session, plus organisation visibility |
| Submit | Portal session |
| Create, edit, publish a request type | `request_type:manage` |
| Assign a catalogue to an organisation | `request_type:manage` |

## Screens

**Agent** — request type list; request type editor with a drag-to-arrange form builder,
a live preview of the customer's view, and version history.

**Portal** — catalogue grouped with icons and one-line descriptions; the request form;
a confirmation showing the reference.

The form builder's live preview is not optional polish. Someone authoring a form must see
exactly what a customer will see, or they will author something unusable.

## API

```
GET    /api/request-types                        request_type:manage
POST   /api/request-types                        request_type:manage
PATCH  /api/request-types/{id}                   request_type:manage
POST   /api/request-types/{id}/publish           request_type:manage
GET    /api/portal/catalogue                     (portal session)
GET    /api/portal/catalogue/{key}               (portal session)
POST   /api/portal/submissions                   (portal session)
GET    /api/portal/deflection?q=…                (portal session)
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Request type deleted with open submissions | Refused. Must be unpublished first, which hides it from the catalogue but leaves existing submissions intact |
| Form field removed in a new version | Old submissions render against their own version and still show the value |
| Required field added in a new version | Applies only to new submissions |
| Customer's organisation has no catalogue entries | The portal shows an explanatory empty state with the support email, not a blank page |
| Conditional field whose controlling field is removed | Validation at publish rejects it |
| `mapsTo` a custom field that is later deleted | Publish validation rejects it; an already-published version stores the raw value |
| Very long option lists | The select becomes a searchable combobox above 10 options |

## Out of scope

- What happens after submission → [intake-queue.md](intake-queue.md)
- Custom field definitions → [custom-fields.md](custom-fields.md)
- KB article authoring → [knowledge-base.md](knowledge-base.md)

## Testing

Unit: form schema validation; conditional visibility evaluation; `mapsTo` translation.

Integration: a submission against version 1 renders correctly after version 2 is
published; a non-visible request type cannot be submitted even with a crafted request.

E2E: browse catalogue, see deflection suggestions, complete a conditional form, submit,
see the reference; draft survives reload.

## Open questions

None.

## Related

- [Intake queue](intake-queue.md) · [Customer portal](customer-portal.md) · [SLA](sla.md)
