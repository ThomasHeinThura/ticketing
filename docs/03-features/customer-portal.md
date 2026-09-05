# Customer portal

- **Phase:** P3
- **Status:** ⬜
- **Feature flag:** `feature.customer_portal`
- **Depends on:** request types, intake, approvals, RBAC

## Purpose

Give customers a place to raise requests, watch progress, approve things and find answers
— so that status updates stop being a manual email round trip.

## The standard being set

v1's portal was described in its own documentation as *"a shell, not a working product"*
that *"showed fixture data, ignored routes, no real data binding"*, and had to be rebuilt
from scratch.

In v2 the portal is built from the **same `packages/ui` primitives** as the agent
workspace and held to the **same [UX quality gates](../02-design/ux-quality-gates.md)**.
It is smaller because customers need less, never because it received less attention.

It must also be genuinely good on a phone. That is where customers will use it.

## Boundaries

| | |
| --- | --- |
| Origin | `portal.<domain>` — separate from the agent origin |
| Session | Separate cookie, scoped to that host |
| Identity | Whichever providers are scoped to `customer` in God Mode |
| Bundle | Contains no agent or God Mode code — asserted at build |
| API | `/api/portal/*` — a narrow, separately reviewed router |

See [ADR 0004](../01-architecture/adr/0004-two-portals-two-origins.md).

## Screens

| Screen | Purpose |
| --- | --- |
| **Home** | Open requests, anything waiting on them, recent activity |
| **My requests** | Everything they have raised, filterable by status |
| **Request detail** | Conversation, status, SLA due time, attachments, actions |
| **New request** | The catalogue, grouped, with deflection suggestions |
| **Request form** | The chosen request type's form |
| **Approvals** | Decisions waiting on them |
| **Projects** | Their engagements — progress, milestones, key contacts |
| **Knowledge base** | Published articles for their organisation — **P5**, behind `feature.knowledge_base`; the portal ships without it in P3 |
| **Account** | Name and job title. Email, organisation and role are server-owned |

## What a customer may do

Modelled on Jira Service Management, which has the right instincts here.

| May | May not |
| --- | --- |
| Raise requests from their catalogue | Assign work to anyone |
| Comment publicly | See or write internal comments |
| Attach files | See staff-internal attachments |
| Re-rank **their own** backlog | Re-rank anyone else's |
| **Escalate** priority (medium → urgent) | **De-escalate** priority |
| Approve requests addressed to them | Approve a request they raised |
| Read published articles for their organisation | See any other organisation, ever |
| Rate a resolution | See SLA policy internals — only their own due time |
| Update their own name and job title | Change their email, organisation or role |
| Reopen a resolved request within a window | Delete anything |
| **Withdraw** their own request before it is triaged | Withdraw one already accepted as a work item |

These are enforced in `packages/domain`, independent of capabilities, so they cannot be
misconfigured away through the role editor.

## Behaviour

- `CP-1` Reach is fixed to the customer's own organisation and cannot be widened by any
  role.
- `CP-2` A request for another organisation's record returns **404**, never 403.
- `CP-3` Internal comments are filtered server-side in the portal router. Never in the
  client.
- `CP-4` The **assignee** is never exposed in any portal response shape — the customer sees
  the team, not the individual. *(v1's deliberate choice, and a good one — it prevents
  customers routing around the process by emailing a named engineer.)* Named staff **do**
  appear where they act publicly: the author of a public comment, the approver on an
  approval decision (`AP-17`), and the project's designated key contacts. The rule is
  precise: *assignee hidden; public actors named.* A test asserts `assignee` is absent
  from every portal response schema.
- `CP-5` Terminology is customer-facing throughout: "request", not "work item";
  "In progress", not a state group name; "your team", not "assignee". The default English
  nouns are exactly the [terminology overlay](../01-architecture/adr/0012-terminology-overlay.md)'s
  default override for the `customer` scope — an instance that renames "request" to "case"
  changes the portal too, with no separate configuration.
- `CP-6` SLA is shown as a due time and a plain-language state — "Response due by 2pm
  today" — never as a percentage or a policy name.
- `CP-7` Escalating priority writes an activity entry and notifies the team.
  De-escalation is not offered and is refused by the API.
- `CP-8` Reopening a resolved request is allowed within a configurable window (default
  14 days) and resumes the SLA clock rather than restarting it.
- `CP-9` A satisfaction rating is offered on resolution — a simple scale plus an optional
  comment — once per request, and it can be changed within the reopen window.
- `CP-10` A submission's durable page keeps the same URL after it becomes a work item, so
  a bookmarked link never breaks and the customer never learns that a conversion happened.
- `CP-15` A customer may **withdraw their own submission** at any point before it is
  triaged — raised in error, no longer needed, or superseded by another request. Withdrawal
  is a submission status (`withdrawn`), not a deletion: it remains visible in "My requests"
  for their own reference, and a triager sees why it is no longer in the queue. Once a
  submission is accepted into a work item, withdrawal is no longer offered — the customer's
  own recourse from that point on is `CP-7` (escalate) or a public comment, the same as any
  other in-flight request. This is the complete self-service lifecycle a customer holds
  over their own request: raise it (`request-types-and-catalogue.md`), withdraw it before
  it is picked up, comment on it, escalate its priority, approve what is addressed to them,
  reopen it within the window, and rate the resolution.

## Onboarding

- `CP-11` Access is by invitation. A staff member with `member:invite` invites an email
  into a customer organisation with the customer role.
- `CP-12` The invitee accepts and signs up through any provider scoped to the customer
  portal — password, email OTP, magic link or SSO.
- `CP-13` An invitation cannot grant a staff role or `instance:admin`.
- `CP-14` A first-time customer sees a brief, dismissible orientation — where to raise a
  request, where to find status — not a modal wall.

## Permissions

Portal access is granted by holding a role with `scope = customer` in an organisation with
portal access enabled. The customer role is off the main rank ladder — see
[RBAC](../01-architecture/rbac.md).

## API

A separate router, deliberately narrow. **Every route carries policy kind 3** from
[RBAC](../01-architecture/rbac.md) — `{ portal: 'customer', predicate }` — where the
predicate is one of `own_request` (requester or participant; colleagues only when
`customer_visibility = 'organisation'`), `own_organisation`, `addressed_approval`,
`own_submission`. The predicate is written after each route; `self` means the caller's own
person row. Nothing here is "(portal session)" — that is authentication, not a policy.

```
GET  /api/portal/me                                        self
GET  /api/portal/home                                      own_organisation
GET  /api/portal/requests                                  own_organisation (filtered by visibility)
GET  /api/portal/requests/{ref}                            own_request
POST /api/portal/requests/{ref}/comments                   own_request
POST /api/portal/requests/{ref}/attachments/presign        own_request
POST /api/portal/requests/{ref}/escalate                   own_request
POST /api/portal/requests/{ref}/reopen                     own_request   (WF-21, system-actor transition)
POST /api/portal/requests/{ref}/rate                       own_request
POST /api/portal/requests/{ref}/participants               own_request   (requester only)
POST /api/portal/requests/rank                             own_organisation
GET  /api/portal/catalogue                                 own_organisation
POST /api/portal/submissions                               own_organisation
GET  /api/portal/submissions/{ref}                         own_submission
POST /api/portal/submissions/{ref}/messages                own_submission
POST /api/portal/submissions/{ref}/withdraw                own_submission (requester only)
GET  /api/portal/approvals                                 addressed_approval
POST /api/portal/approvals/{id}/decide                     addressed_approval
GET  /api/portal/projects                                  own_organisation
GET  /api/portal/projects/{key}                            own_organisation
GET  /api/portal/kb                                        own_organisation  (P5)
GET  /api/portal/kb/{id}                                   own_organisation  (P5)
GET  /api/portal/kb/deflection?q=                          own_organisation  (P5)
PATCH /api/portal/account                                  self
```

The former list, kept for the diff only:

```
GET  /api/portal/me
GET  /api/portal/home
GET  /api/portal/requests
GET  /api/portal/requests/{ref}
POST /api/portal/requests/{ref}/comments
POST /api/portal/requests/{ref}/attachments/presign
POST /api/portal/requests/{ref}/escalate
POST /api/portal/requests/{ref}/reopen
POST /api/portal/requests/{ref}/rate
POST /api/portal/requests/rank
GET  /api/portal/catalogue
POST /api/portal/submissions
GET  /api/portal/submissions/{ref}
POST /api/portal/submissions/{ref}/messages
POST /api/portal/submissions/{ref}/withdraw
GET  /api/portal/approvals
POST /api/portal/approvals/{id}/decide
GET  /api/portal/projects
GET  /api/portal/projects/{key}
GET  /api/portal/kb
GET  /api/portal/kb/{id}
PATCH /api/portal/account
```

Every one of these is reviewed as a set, because the whole surface is small enough to hold
in your head — which is the point of not reusing the agent handlers.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Customer's organisation is suspended | Sessions invalidated; sign-in shows a message with the support email |
| Customer session hits the agent origin | Rejected at the callback and on every request; audited |
| Work item moved to a project the customer cannot see | It disappears from their list. The bookmarked URL returns 404 |
| Portal disabled by feature flag | The origin returns a maintenance page, not a broken app |
| Customer has no requests and no catalogue | Home shows an explanatory empty state with the support email |
| Attachment marked staff-internal | Absent from the portal response entirely. Not hidden client-side |
| Customer replies to a closed request | Reopens it if within the window; otherwise creates a linked new request |
| Customer withdraws a submission already being triaged | Refused with a clear message once a triager has started acting on it — see [intake queue](intake-queue.md) |

## Out of scope

- Catalogue definition → [request-types-and-catalogue.md](request-types-and-catalogue.md)
- Triage → [intake-queue.md](intake-queue.md)

## Testing

Security E2E — these are the tests that would have caught v1's defects:

- `portal-cross-tenant.spec.ts` — customer A cannot reach customer B's request by URL
- `portal-no-internal-comments.spec.ts` — internal comments absent from every response
- `portal-cannot-deescalate.spec.ts`
- `portal-cannot-self-approve.spec.ts`
- `portal-session-rejected-on-agent-origin.spec.ts`
- `portal-bundle-purity.spec.ts` — no agent module in the portal graph

UX E2E: full journey on a 375 px viewport — sign in, browse catalogue, submit, reply,
approve, rate.

## Open questions

- **Per-request visibility inside a customer organisation** *(raised in the 2026-09-05
  review; decide before P3 starts — Thomas).* Reach is the whole organisation
  ([RBAC](../01-architecture/rbac.md)), but "My requests" is defined as *what this person
  raised*. Nothing says whether Alice at Customer A can see Bob's request at Customer A.
  Jira Service Management makes this a per-request choice — private, or shared with the
  organisation — with a portal-level default. **Recommended:** add `customer_visibility:
  private | organisation` on `submission` and `work_item`, chosen by the requester at
  submission time, defaulted per organisation in God Mode (default `organisation` — a
  customer's colleagues usually *want* to see the printer ticket already exists), with a
  request type able to force `private` (HR, access, anything sensitive). Adds one column,
  one form control, one God Mode default, and one negative test: a private request is 404
  to a colleague, exactly as a cross-organisation one is.

## Related

- [ADR 0004](../01-architecture/adr/0004-two-portals-two-origins.md)
- [RBAC](../01-architecture/rbac.md) · [Approvals](approvals.md)
