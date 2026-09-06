# Intake queue

- **Stage:** P2
- **Status:** ⬜
- **Feature flag:** `feature.intake`
- **Depends on:** request types, work items, notifications

## Purpose

The gap between "a customer asked for something" and "the team committed to doing it".

A submission is not yet a work item. It has not been read, categorised, sized or accepted.
Turning every submission into a work item immediately pollutes the backlog with
duplicates, misfiled requests and things that turn out to be questions.

Intake is where a human — or an automation — makes that judgement.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Submission** | A raw customer request. Reference `SUB-n` |
| **Triage** | Deciding what a submission becomes |
| **Clarification** | Asking the customer for more before deciding |
| **Acceptance** | Converting a submission into a work item |

## Statuses

| Status | Meaning |
| --- | --- |
| `new` | Received, not yet looked at |
| `clarifying` | Waiting on the customer |
| `accepted` | Converted to a work item |
| `declined` | Rejected, with a reason given to the customer |
| `duplicate` | Merged into an existing work item |
| `withdrawn` | The customer cancelled it themselves, before triage started |

## Data

`submission`, `submission_message`. A submission holds `form_data` and the request type
version it was made against.

## Behaviour

**Arrival**

- `IQ-1` A submission is created by the portal, by an inbound email, or by an API client.
- `IQ-2` It gets a reference `SUB-n`, unique per instance, shown to the customer.
- `IQ-3` A submission has a **durable page** the customer can return to at any time,
  linkable, surviving sign-out. *(v1 got this right and it matters — customers bookmark
  it.)*
- `IQ-4` A request type marked auto-accept skips intake entirely.

**Triage**

- `IQ-5` The queue shows: reference, customer, organisation, request type, summary, age,
  and any suggested duplicates.
- `IQ-6` Triage actions are: **Accept**, **Decline**, **Merge as duplicate**,
  **Ask for clarification**.
- `IQ-7` Accepting requires choosing the project and confirming the work item type. Both
  are pre-filled from the request type; the pre-fill is a suggestion, not a decision.
- `IQ-8` On acceptance, form data is mapped onto native and custom fields per the request
  type's `mapsTo` rules, and anything unmapped is rendered into the description under a
  clear heading.
- `IQ-9` Attachments transfer to the work item, preserving customer visibility.
- `IQ-10` The submission thread transfers to the work item as public comments, so the
  conversation is not lost.
- `IQ-11` The customer's portal view switches from the submission page to the work item,
  keeping the same URL. They should never have to learn that a conversion happened.

**Clarification**

- `IQ-12` Asking for clarification posts a message to the submission thread and notifies
  the customer.
- `IQ-13` The customer replies on the submission page. Status returns to `new`.
- `IQ-14` The first-response SLA clock, if the request type has one, starts at submission
  and stops at the first staff message — including a clarification request.
- `IQ-15` A submission in `clarifying` for longer than a configurable period (default 14
  days) is auto-declined with a message, and the customer may reopen it.

**Declining and duplicates**

- `IQ-16` Declining requires a reason, which is shown to the customer verbatim. There is
  no silent decline.
- `IQ-16a` The customer may withdraw their own submission at any time while it is `new` or
  `clarifying`. The moment a triager takes any action on it — a queue claim, a message, or
  starting acceptance — withdrawal is refused; from then on the submission is the triage
  team's to dispose of. A withdrawn submission is retained (not deleted), visible to the
  customer as a record and to staff in the queue, filterable out by default.
- `IQ-17` Merging as duplicate links the submission to an existing work item and adds the
  customer as a watcher on it, so they still get updates.
- `IQ-18` Duplicate suggestions are offered by text similarity over recent work items in
  the same organisation. Suggestions only — the decision is human.

**Queues**

- `IQ-19` Queues are saved filters over submissions and unassigned work items, owned by a
  team.
- `IQ-20` A queue may be shared with a team or kept private.
- `IQ-21` Every queue has a URL, including its filters. *(v1's triage filters were not
  addressable, which made "look at this queue" an unshareable instruction.)*

## Permissions

| Action | Capability |
| --- | --- |
| See the intake queue | `intake:triage` |
| Accept, decline, merge | `intake:triage` |
| Ask for clarification | `intake:triage` |
| Manage queues | `intake:triage` |
| See own submission | Portal session, own organisation |
| Withdraw own submission (before triage starts) | Portal session, own organisation |

## Screens

**Agent** — intake queue list; submission detail with form data, thread, attachments and
duplicate suggestions; accept dialog; decline dialog; queue management.

**Portal** — submission confirmation; durable submission page with the thread; reply box.

The submission detail should let a triager decide without leaving the screen. Everything
needed — what was asked, by whom, what similar work exists — is visible at once. This is
the one screen where density is a feature.

## API

```
GET    /api/submissions                        intake:triage
GET    /api/submissions/{ref}                  intake:triage
POST   /api/submissions/{ref}/accept           intake:triage
POST   /api/submissions/{ref}/decline          intake:triage
POST   /api/submissions/{ref}/duplicate        intake:triage
POST   /api/submissions/{ref}/messages         intake:triage
GET    /api/submissions/{ref}/duplicates       intake:triage
GET    /api/portal/submissions                 (portal session)
GET    /api/portal/submissions/{ref}           (portal session)
POST   /api/portal/submissions/{ref}/messages  (portal session)
POST   /api/portal/submissions/{ref}/withdraw  (portal session)
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Customer replies after acceptance | The reply lands as a public comment on the work item |
| Accepted into a project the customer cannot see | Refused. The project must serve their organisation |
| Two triagers accept simultaneously | Optimistic concurrency: the second gets 409 and is shown the work item the first created |
| Submission with no request type (inbound email) | Goes to a default "Uncategorised" type; triage assigns the real one |
| Attachment fails to transfer on acceptance | Acceptance rolls back. Better to retry than to lose the file |
| Customer account deleted with an open submission | Submission retained, requester tombstoned |
| Very large form data | Rendered into the description with a collapsible section |
| Customer withdraws the instant a triager starts accepting it | Optimistic concurrency: whichever commits first wins; the loser sees a clear message rather than a generic error |

## Out of scope

- Form definition → [request-types-and-catalogue.md](request-types-and-catalogue.md)
- Automated triage rules → [automations.md](automations.md)
- Inbound email parsing — **a candidate, not scheduled**; see the "candidates, not
  commitments" table in [roadmap.md](../07-planning/roadmap.md). `IQ-1` names email as a
  source so the data model does not preclude it, not because it is planned for a stage.
  *(Corrected 2026-09-05 — this line previously said "Stage 5", contradicting the roadmap.)*

## Testing

Unit: field mapping from form data to work item; duplicate similarity scoring.

Integration: acceptance transfers attachments and thread atomically; a rollback on
attachment failure leaves no partial work item; concurrent acceptance yields one work item.

E2E: submit from the portal, triage, accept, and confirm the customer's URL now shows the
work item without them navigating; decline with a reason and confirm the customer sees it.

## Open questions

None.

## Related

- [Request types](request-types-and-catalogue.md) · [Customer portal](customer-portal.md)
- [Search and saved views](search-and-saved-views.md)
