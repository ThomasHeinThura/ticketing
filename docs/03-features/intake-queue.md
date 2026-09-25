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
version it was made against, plus `claimed_by`/`claimed_at` (`IQ-16a`), `customer_visibility`
and `work_item_id` (set on acceptance) — [data-model.md](../01-architecture/data-model.md).

## Behaviour

**Arrival**

- `IQ-1` A submission is created by the portal, or by an inbound email (see Out of scope —
  inbound email is a roadmap candidate, not scheduled). Creation by a non-portal API client
  is **not offered**: no customer-facing API credential exists in this architecture
  ([webhooks-and-api-keys.md](webhooks-and-api-keys.md)'s API keys are workspace/staff-scoped
  only), and inventing one is a separate, larger decision this spec does not make.
- `IQ-2` It gets a reference `SUB-n`. `n` comes from `submission.number`, an instance-wide
  counter — never a primary key, never reused — the same convention as `work_item.number`
  ([data-model.md](../01-architecture/data-model.md)).
- `IQ-3` A submission has a **durable page** the customer can return to at any time,
  linkable, surviving sign-out. *(v1 got this right and it matters — customers bookmark
  it.)* The mechanism is an ordinary portal session, not a bearer token in the URL: the
  route requires `{ portal: 'customer', predicate: 'own_submission' }`
  ([rbac.md](../01-architecture/rbac.md) kind 3), and "durable" means the URL itself never
  changes (`IQ-11`) and stays valid across sign-out/sign-in cycles for that requester —
  not that `SUB-n` alone is a credential. Knowing a reference grants nothing without a
  session scoped to it.
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
- `IQ-9` Attachments transfer to the work item, preserving customer visibility
  (`attachment.submission_id` before acceptance, `attachment.work_item_id` after —
  [data-model.md](../01-architecture/data-model.md)).
- `IQ-10` The submission thread transfers to the work item as public comments, **preserving
  each message's original `created_at`** (not the moment of transfer), so the conversation
  is not lost and so `SLA-7`'s `first_response_at` — set from the earliest public staff
  comment — is computed correctly even when the actual first response was a
  pre-acceptance clarification message.
- `IQ-11` The customer's portal view switches from the submission page to the work item,
  keeping the same URL. They should never have to learn that a conversion happened.

**Clarification**

- `IQ-12` Asking for clarification posts a message to the submission thread and notifies
  the customer.
- `IQ-13` The customer replies on the submission page. Status returns to `new`.
- `IQ-14` The first-response SLA clock, if the request type has one, is measured against
  the point of **submission**, not acceptance: on acceptance, `work_item.sla_started_at` is
  copied from the submission's `created_at` (`SLA-4` — [sla.md](sla.md)), and `dueAt` is
  computed backdated from that instant. There is no separate pre-acceptance clock or cache
  row on the submission itself — the SLA engine only measures a `work_item`, and none
  exists until acceptance, so covered time between submission and acceptance is counted
  retroactively the moment the work item is created. **This means a team can be in breach,
  or already `at_risk`, at the instant they accept a long-clarifying submission** — the
  clock was always running from `created_at`, acceptance just makes it visible. Stops at
  the first public comment by a staff member (`SLA-7`) — including a clarification
  request, which is posted as one.
- `IQ-15` A submission in `clarifying` for longer than `instance_setting.clarification_window_days`
  (default 14 — [data-model.md](../01-architecture/data-model.md)) is auto-declined with a
  message, and the customer may reopen it. Only this auto-decline is reopenable by the customer; a staff decline (`IQ-16`) is final for the customer (decision log, 2026-09-25). Enforced by `reminder-scan`
  ([background-jobs.md](../01-architecture/background-jobs.md)), which runs every 15
  minutes.

**Declining and duplicates**

- `IQ-16` Declining requires a reason, which is shown to the customer verbatim. There is
  no silent decline.
- `IQ-16a` The customer may withdraw their own submission at any time while it is `new` or
  `clarifying`. The moment a triager takes any action on it — a queue claim, a message, or
  starting acceptance — withdrawal is refused; from then on the submission is the triage
  team's to dispose of. A withdrawn submission is retained (not deleted), visible to the
  customer as a record and to staff in the queue, filterable out by default. **Enforcement:**
  `submission.claimed_by`/`claimed_at` ([data-model.md](../01-architecture/data-model.md))
  are set the moment any of the three triggering actions happens — an explicit
  `POST /api/submissions/{ref}/claim` (see API below), the first `POST .../messages`, or a
  `POST .../accept` attempt — whichever happens first, all under a conditional write
  (`WHERE claimed_by IS NULL`) so a race between a claim and a customer withdrawal is
  resolved the same way as the accept race in the edge cases below: whichever commits
  first wins. `POST .../withdraw` is refused with `409` once `claimed_by` is set.
- `IQ-17` Merging as duplicate links the submission to an existing work item and adds the
  customer as a watcher on it, so they still get updates.
- `IQ-18` Duplicate suggestions are offered by trigram similarity
  (`similarity(work_item.title, :query) > 0.3` — pg_trgm's own default threshold, over the
  `gin (title gin_trgm_ops)` index already in [data-model.md](../01-architecture/data-model.md))
  over work items created in the same organisation in the last 90 days. Suggestions only —
  the decision is human.

**Queues**

- `IQ-19` A queue over submissions *and* work items is **two saved views presented
  together**, not one document — `saved_view.query.entity` is `submission | work_item`
  (among others), each with its own field whitelist
  ([api-design.md](../01-architecture/api-design.md)). "Queue" is the UI grouping of the
  two, owned by a team.
- `IQ-20` A queue may be shared with a team or kept private.
- `IQ-21` Every queue has a URL, including its filters. *(v1's triage filters were not
  addressable, which made "look at this queue" an unshareable instruction.)*

## Permissions

| Action | Capability |
| --- | --- |
| See the intake queue | `intake:triage` |
| Claim, accept, decline, merge | `intake:triage` |
| Ask for clarification | `intake:triage` |
| Manage queues | `intake:triage` |
| See own submission | `{ portal: 'customer', predicate: 'own_submission' }` — [rbac.md](../01-architecture/rbac.md) kind 3 |
| Withdraw own submission (before triage starts) | `{ portal: 'customer', predicate: 'own_submission' }` |

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
POST   /api/submissions/{ref}/claim            intake:triage   (sets claimed_by/claimed_at, IQ-16a)
POST   /api/submissions/{ref}/accept           intake:triage
POST   /api/submissions/{ref}/decline          intake:triage
POST   /api/submissions/{ref}/duplicate        intake:triage
POST   /api/submissions/{ref}/messages         intake:triage
GET    /api/submissions/{ref}/duplicates       intake:triage
GET    /api/portal/submissions                 { portal: 'customer', predicate: 'own_organisation' } — filtered to the caller's own submissions
GET    /api/portal/submissions/{ref}           { portal: 'customer', predicate: 'own_submission' }
POST   /api/portal/submissions/{ref}/messages  { portal: 'customer', predicate: 'own_submission' }
POST   /api/portal/submissions/{ref}/withdraw  { portal: 'customer', predicate: 'own_submission' }   (requester only)
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
| Customer returns to the durable submission page after it was **declined** | The page shows the decline reason verbatim (`IQ-16`); the URL does not change and does not redirect |
| Customer returns to the durable submission page after it was **withdrawn** | The page shows the withdrawn status as a record (`IQ-16a`); the URL does not change and does not redirect |
| `SUB-n` alone, with no session | `404` — a reference is not a credential; the portal predicate `own_submission` requires an authenticated session scoped to that submission |

## Out of scope

- Form definition → [request-types-and-catalogue.md](request-types-and-catalogue.md)
- Automated triage rules → [automations.md](automations.md)
- Inbound email parsing — **a candidate, not scheduled**; see the "candidates, not
  commitments" table in [roadmap.md](../07-planning/roadmap.md). `IQ-1` names email as a
  source so the data model does not preclude it, not because it is planned for a stage.
  *(Corrected 2026-09-05 — this line previously said "Stage 5", contradicting the roadmap.)*
- Submission creation by a non-portal API client — **not offered.** An earlier draft of
  `IQ-1` named this as a source; removed 2026-09-23 because no customer-facing API
  credential exists anywhere in this architecture to authenticate it, and designing one
  (scope, issuance, revocation) is a decision this spec does not make. Revisit if a real
  integration need appears.

## Testing

Unit: field mapping from form data to work item; duplicate similarity scoring.

Integration: acceptance transfers attachments and thread atomically, preserving each
message's original `created_at`; a rollback on attachment failure leaves no partial work
item; concurrent acceptance yields one work item; `IQ-3` a request for `GET
/api/portal/submissions/{ref}` with `SUB-n` alone and no session, or a session belonging to
a different organisation, is refused — a reference grants no access by itself; `IQ-16a` a
claim, a message and an accept attempt racing a withdrawal each resolve to exactly one
winner, with the loser's action refused rather than silently accepted.

E2E: submit from the portal, triage, accept, and confirm the customer's URL now shows the
work item without them navigating; decline with a reason and confirm the customer sees it.

## Open questions

None.

## Related

- [Request types](request-types-and-catalogue.md) · [Customer portal](customer-portal.md)
- [Search and saved views](search-and-saved-views.md)
