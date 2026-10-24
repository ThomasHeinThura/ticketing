# P3 feature contracts

These are maintained product requirements, not completion evidence. [Requirement index](../requirements-index.json) retains every original numbered definition and its provenance; [status](../status.md) records implementation and verification separately. Numbered definitions below retain their original wording, including any embedded historical implementation commentary; such commentary is not a current status claim. Standalone historical status, review history and implementation reports are omitted.

Use the original Kaneo composition, components and interactions for every specified screen. Current Thomas decisions and explicit maintained [integration contracts](../contracts.md) take precedence over older alternatives without dropping requirement IDs. Test sections describe required invariants and journeys, not tests claimed to exist or pass. API/schema discrepancies remain work to resolve, not permission to rewrite the requirement to match code.

OIDC and SCIM share the existing scope/capability model. Provider claims cannot grant instance administration or unrestricted reach; source-specific grant provenance, retirement and valid-current projection remain mandatory. The 25 named identity acceptance cases below remain requirements, including real Entra interoperability; this reference supplies no external acceptance evidence.

## Features

- [customer-portal](#customer-portal)
- [identity-provisioning](#identity-provisioning)

<a id="customer-portal"></a>
## Customer portal

- **Primary phase:** P3
- **Feature flag:** `feature.customer_portal`
- **Depends on:** request types, intake, approvals, RBAC

<a id="customer-portal-purpose"></a>
### Purpose
**One customer, one organisation.** Every portal person belongs to exactly one customer
organisation and sees only its requests. A person contracted to two customer organisations
holds a separate account in each — a recorded limitation, not a gap
([multi-tenancy.md](#pending-01-architecturemulti-tenancy-identity-across-tenants)).

Give customers a place to raise requests, watch progress, approve things and find answers
— so that status updates stop being a manual email round trip.

<a id="customer-portal-the-standard-being-set"></a>
### The standard being set

v1's portal was described in its own documentation as *"a shell, not a working product"*
that *"showed fixture data, ignored routes, no real data binding"*, and had to be rebuilt
from scratch.

In v2 the portal is built from the **same `packages/ui` primitives** as the agent
workspace and held to the **same [UX quality gates](#pending-02-designux-quality-gates)**.
It is smaller because customers need less, never because it received less attention.

It must also be genuinely good on a phone. That is where customers will use it.

<a id="customer-portal-boundaries"></a>
### Boundaries

| | |
| --- | --- |
| Origin | `portal.<domain>` — separate from the agent origin |
| Session | Separate cookie, scoped to that host |
| Identity | Whichever providers are scoped to `customer` in God Mode — **never listed on the login page**; typed-domain routing and its limited disclosure follow `CP-18`/`IP-29` |
| Bundle | Contains no agent or God Mode code — asserted at build |
| API | `/api/portal/*` — a narrow, separately reviewed router |

See [ADR 0004](#pending-01-architectureadr0004-two-portals-two-origins).

<a id="customer-portal-screens"></a>
### Screens

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

<a id="customer-portal-what-a-customer-may-do"></a>
### What a customer may do

Modelled on Jira Service Management, which has the right instincts here.

| May | May not |
| --- | --- |
| Raise requests from their catalogue | Assign work to anyone |
| Comment publicly | See or write internal comments |
| Attach files | See staff-internal attachments |
| Re-rank **their own** backlog | Re-rank anyone else's |
| **Escalate** priority — any strictly increasing change | **De-escalate** — any decrease is refused with 403 |
| Approve requests addressed to them | Approve a request they raised |
| Read published articles for their organisation | See any other organisation, ever |
| Rate a resolution | See SLA policy internals — only their own due time |
| Update their own name and job title | Change their email, organisation or role |
| Reopen a resolved request within a window | Delete anything |
| **Withdraw** their own request before it is triaged | Withdraw one already accepted as a work item |

These are enforced in `packages/domain`, independent of capabilities, so they cannot be
misconfigured away through the role editor.

<a id="customer-portal-behaviour"></a>
### Behaviour

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
  nouns are exactly the [terminology overlay](#pending-01-architectureadr0012-terminology-overlay)'s
  default override for the `customer` scope — an instance that renames "request" to "case"
  changes the portal too, with no separate configuration.
- `CP-6` SLA is shown as a due time and a plain-language state — "Response due by 2pm
  today" — never as a percentage or a policy name.
- `CP-7` Any strictly increasing priority change is permitted; any decrease is refused with
  403 (`portal-cannot-deescalate.spec.ts`). Escalating priority writes an activity entry and
  notifies the team. De-escalation is not offered by the UI and is refused by the API
  regardless.
- `CP-8` Reopening a resolved request is allowed within `instance_setting.reopen_window_days`
  (default 14 days) and resumes the SLA clock rather than restarting it, executed as a
  system actor through the workflow's `is_reopen` transition (`WF-21`,
  [workflows.md](feature-contracts-p2.md#workflows)) — one mechanism shared with the reopen-on-upload case in
  `attachments.md`.
- `CP-9` A satisfaction rating is offered on resolution — a simple scale plus an optional
  comment — once per request, and it can be changed within
  `instance_setting.reopen_window_days`.
- `CP-10` A submission's durable page keeps the same URL after it becomes a work item, so
  a bookmarked link never breaks and the customer never learns that a conversion happened.

<a id="customer-portal-onboarding"></a>
### Onboarding

- `CP-11` Access is by invitation. A staff member with `member:invite` invites an email
  into a customer organisation with the customer role.
- `CP-12` The invitee accepts and signs up through any provider scoped to the customer
  portal — password, email OTP, magic link or SSO.
- `CP-13` An invitation cannot grant a staff role or `instance:admin`.
- `CP-20` **Customer invitations reuse the invitation record with a customer scope** (decided 23 Oct). A customer-scope invitation names exactly one customer organisation and the `customer` role; it is created only by a caller holding `member:invite` with reach to that organisation, over a session (never an API key or MCP key, matching the existing invitation routes). The staff invitation flow and its `/agent/invite` accept route are unchanged. `Contract-new`
- `CP-21` Role is validated twice. At write, a customer-scope invitation whose role is anything other than `customer`, or that names a staff or custom role, `instance:admin`, a team or a workspace-level grant, is refused 422 and nothing is stored. At accept, the stored role and scope are re-read inside the accept transaction and refused if they are no longer a customer-scope invitation to a live organisation, so a row edited, imported or migrated into a staff role cannot be accepted. A staff-scope invitation cannot be accepted on the portal host and a customer-scope invitation cannot be accepted on the agent host; either returns the same generic not-found. `Contract-new`
- `CP-22` Expiry, resend and revoke. A customer invitation expires after the existing invitation lifetime unless an instance setting overrides it; an expired, accepted or revoked invitation cannot be accepted and the accept page shows one generic "invitation no longer valid" notice that does not say which. Resend issues a fresh accept credential, invalidates the previous one and extends expiry; revoke (the existing `DELETE /api/invitation/{id}` path, same `member:invite` policy) invalidates the credential immediately. An invitation to an address that already has an active membership in that organisation is refused at write. `Contract-new`
- `CP-23` The accept credential is unguessable, single-use, and stored hash-only; the invitation id alone never grants acceptance. The agent surface lists customer invitations for an organisation with status (pending, accepted, revoked, expired) but never shows the credential after creation. `Contract-new`
- `CP-24` **Accept flow on the portal host root.** The email link opens `/invite/{id}` on the portal host (screens.md; the legacy `/portal/invite` listing is stale). The page uses the sign-in/up methods of providers scoped to `customer` (`CP-12`): the invitee signs up or signs in, and acceptance succeeds only when the verified address of the resulting customer-portal session equals the invitation email. Acceptance creates the customer person (if none), the organisation membership with the `customer` role and the requested reach, in one transaction with marking the invitation accepted; a second concurrent accept affects exactly one row. An address mismatch, wrong portal, or any non-valid state returns the same generic failure copy. Acceptance never signs the visitor into the agent host and never creates an agent session. `Contract-new`
- `CP-25` Audit and events. Create, resend, revoke, accept and every refusal (role refused at write, role refused at accept, expired, address mismatch, wrong portal) write an audit row in the existing audit vocabulary naming actor, organisation and invitation id, never the credential or the invitee address in cleartext beyond what the existing invitation audit already stores. Refusals by an anonymous visitor are audited with request metadata only. `Contract-new`
- `CP-26` Rate limits. Create is limited per inviter and per organisation, resend has a per-invitation cooldown, and anonymous accept/lookup attempts fall under the anonymous limit class (`IP-29`); a limited response is the same shape as any other failure on that page. Exact values are instance configuration, not hard-coded. `Contract-new`
- `CP-14` A first-time customer sees a brief, dismissible orientation — where to raise a
  request, where to find status — not a modal wall.
- `CP-16` **Request visibility inside a customer organisation** (decided 2026-09-05). Every
  submission and work item carries `customer_visibility`: **`private`** — visible only to
  the requester and explicitly added participants; **`organisation`** — visible to permitted
  colleagues in the same customer organisation. Default `organisation`, set per organisation
  in God Mode (`organisation.default_customer_visibility`) and chosen by the requester at
  submission time. A **request type may force `private`**; sensitive types — HR, finance,
  legal, personal data, access requests, security-sensitive workflows — should. A colleague
  outside the allowed scope receives the **same constant-shape 404** as a user from another
  organisation ([rbac.md](permissions.md#reach)). Attachments stay requester-only: an organisation colleague or participant reads the request, its public messages and status but not its files, and the portal projection carries `canViewAttachments`/`canUpload` (true only for the requester) so the UI hides them instead of erroring.
- `CP-17` **Organisation SSO.** A customer organisation may have its own identity
  connection — Microsoft Entra first — bound to that organisation and to the customer
  portal only ([identity-provisioning.md](feature-contracts-p3.md#identity-provisioning) `IP-1`, `IP-2`). Its
  people sign in with their own SSO and land only in their organisation; its SCIM
  deactivates them when they leave. Instance administrators configure it (God Mode →
  Organisations → *org* → Identity); customers cannot configure their own IdP in the first
  release (`IP-5`). Invitation (`CP-11`) remains the path for organisations without SSO.
- `CP-18` **The login page does not publish a provider list.** It asks for an email address
  and may use its typed domain to route login initiation to a configured customer OIDC flow.
  The complete bound and unbound flows are intentionally distinguishable and may disclose
  that a supplied domain has an SSO binding and the IdP's public redirect destination. The
  limited disclosure and prohibited inventory/account disclosures are defined once in
  [identity-provisioning.md](feature-contracts-p3.md#identity-provisioning) `IP-29`; state scope and callback
  collision behavior follow `IP-9`. The agent login page may list its instance-level
  providers ([auth-and-identity.md](#pending-01-architectureauth-and-identity-per-portal-binding)).

  **Frozen-release local sign-in scope (Thomas, 2026-10-12):** `/sign-in` asks for email
  first, then password. The email step stays local; it does not discover or list providers,
  identities or typed-domain SSO bindings. Submit through the existing portal-scoped auth
  endpoints for an already admitted active customer, under the stored customer-scope
  password-provider admission checks. Complete any existing TOTP or backup-code challenge
  through those existing portal endpoints before treating sign-in as successful. Credentials,
  customer admission and password-provider availability failures share one generic UI
  failure. Successful sign-in goes to `/catalogue`; this release does not add a continuation
  redirect contract. The page does not create or admit accounts. Public registration,
  invitation acceptance and typed-domain SSO discovery/routing remain unavailable under
  their existing contract holds. This bounded local method does not claim the complete
  CP-18/IP-29 SSO flow, change portal cookie/session/Host/Origin authority, add an endpoint
  or enable a provider by default.
- `CP-27` **Typed-domain route.** The portal sign-in email step may call one anonymous route, `POST /api/portal/sign-in/home-realm`, admitted on the portal host only. It reads the **domain part only** of the typed address, resolves at most one customer connection through `domain_bindings` (`IP-9`), and returns either "start this organisation's OIDC flow" (the existing initiation path with single-use state per `IP-9`) or "continue with local methods". It never returns a list, an organisation name, a connection id, discovery configuration or claim mapping. Anything else, including a malformed address, returns the "continue with local methods" shape. `Contract-new`
- `CP-28` **No account enumeration.** The local part of the address is discarded: it is not looked up, stored, logged or audited, and the response never depends on whether a person or account exists for the address. The route performs no write and creates no person, membership or session. Disclosure is limited to what [ADR 0014](design-and-decisions.md#0014-limited-home-realm-disclosure) accepts (whether the domain has an SSO binding and the IdP's public redirect destination); no stronger non-enumeration claim is made and none is tested. Anonymous rate limits apply to the route. `Contract-new`
- `CP-29` **Failure copy.** Every SSO failure on the portal (callback error, collision denial under `IP-9`, JIT refusal, inactive person, state expired or replayed) shows one generic localized notice with a way back to the sign-in page; it does not say which check failed, whether an account exists, or which organisation was selected. Detail goes to the audit trail. `Contract-new`
- `CP-15` A customer may **withdraw their own submission** at any point before it is
  triaged — raised in error, no longer needed, or superseded by another request. Withdrawal
  is a submission status (`withdrawn`), not a deletion: it remains visible in "My requests"
  for their own reference, and a triager sees why it is no longer in the queue. Once a
  submission is accepted into a work item, withdrawal is no longer offered — the customer's
  own recourse from that point on is `CP-7` (escalate) or a public comment, the same as any
  other in-flight request. This is the complete self-service lifecycle a customer holds
  over their own request: raise it (`request-types-and-catalogue.md`), withdraw it before
  it is picked up, comment on it, escalate its priority, approve what is addressed to them,
  reopen it within the window, and rate the resolution. *(Numbered `CP-15` for citation
  stability — `events.md`, `decision-log.md` and `status.md` already cite it by that number
  — and placed here, last, rather than renumbered: the 2026-09-05 review flagged the
  original mid-`CP-1`…`CP-10` placement as a citation hazard because it read as if inserted
  into the sequence unannounced; appending it after the highest-numbered rule makes it
  legible as exactly that — a later addition — without invalidating every existing
  citation.)*
- `CP-19` **Before portal identity exists, the portal origin is disabled and isolated.**
  In P0, `GET` and `HEAD /` serve a localized unavailable notice built with
  `packages/ui`; the page has no login form, provider list, session probe, external
  redirect or credential submission. Every `/api` path and websocket upgrade on the
  portal origin returns the same generic 404 before auth, session/API-key resolution,
  database, audit, event or websocket handling, except plain `GET` and `HEAD` requests
  for exactly `/api/health`, `/api/public/health/live` and
  `/api/public/health/ready`. Those existing health handlers remain independent of which
  origin received the request. Once the two-instance identity boundary is configured, the
  portal host admits only its exact Better Auth sign-in/session/OIDC endpoints and the
  registered `kind: portal` API policies. The agent API stays unreachable there, with one narrow exception: the signed filesystem-driver
  routes `PUT /api/storage/filesystem-attachment-upload` and `GET /api/storage/filesystem-download`
  are admitted on the portal host only when the signed `key` is a portal submission attachment
  object (`workspace/<id>/submission/<id>/attachment/<id>/<file>`), because presign mints the URL on the
  requesting origin; the HMAC token still binds the exact key, size ceiling and expiry, and
  work-item/agent keys stay denied. Every
  websocket upgrade on the portal host remains denied until its own reviewed policy exists.
  A syntactically valid unknown Host is accepted only for these exact `GET`/`HEAD` health
  requests, preserving loopback Docker and deploy readiness probes; malformed, missing,
  duplicate, or upgraded authorities are rejected, and `HEAD` returns the matching status
  and headers without a body. The portal serves files only from its own output root; a
  missing asset is 404; the registered portal client routes (the portal route tree, e.g.
  `/sign-in`, `/catalogue`, `/submissions/:ref`) serve the portal's own `index.html` shell
  for `GET`/`HEAD` so a customer can open, reload or bookmark them; every other
  extensionless portal path is 404; and it never falls back to agent files or the
  agent SPA. If the selected output root or its `index.html` is missing, that origin
  returns 503. The request authority selects one configured origin only after strict
  validation: exactly one raw Host (or a consistent HTTP/2 `:authority` and Host),
  normalized using the configured public scheme and its default port. DNS names are
  case- and IDNA-normalized; malformed authorities and unknown hosts are rejected.
  Forwarded headers and the backend transport scheme do not select the application.
  Host selection and portal-path denial run before CORS, compression, auth, API, static,
  SPA or websocket handling. The agent origin keeps its existing URLs and behavior.
  P3 may replace the disabled outcome only after the independently reviewed per-host
  auth instances, host-only cookies, portal session checks, callback/provider binding
  and explicit portal API policy exist. Enabling `feature.customer_portal` alone never
  exposes agent handlers on the portal origin. This interim contract adds no customer
  identity, API permission, capability, database field, environment variable or feature
  flag. See [ADR 0004](#pending-01-architectureadr0004-two-portals-two-origins) and the
  [P0 acceptance matrix](#pending-07-planningphases-p0-two-entry-host-and-static-acceptance).

<a id="customer-portal-permissions"></a>
### Permissions

Portal access is granted by being a **customer-side person** (`person.side = 'customer'`)
holding the built-in `customer` role on an **organisation-scoped membership**
(`membership.scope = 'organisation'`, [data-model.md](data-model.md) §2)
in an organisation whose `organisation.portal_access` is true
([data-model.md](data-model.md) §2 — the column that closes the portal to
one organisation's people without deactivating the organisation itself). That membership is
created by invitation
(`CP-11`), JIT provisioning or SCIM (`CP-17`). The customer role is off the main rank
ladder — see [RBAC](permissions.md).

One row per portal action, each a [RBAC](permissions.md) policy kind 3
(`{ portal: 'customer', predicate }`):

| Action | Predicate | Route |
| --- | --- | --- |
| View own profile | `self` | `GET /api/portal/me` |
| Update own name and job title | `self` | `PATCH /api/portal/account` |
| Read own customer-eligible notification preferences (`NO-21`) | `self` | `GET /api/portal/notification-preferences` |
| Update own customer-eligible global notification preferences (`NO-21`) | `self` | `PUT /api/portal/notification-preferences` |
| Resolve own notification email-link handoff (`NO-2`) | `self` | `GET /api/portal/notification-preferences/email-link-handoff` |
| View home dashboard | `own_organisation` | `GET /api/portal/home` |
| List own organisation's requests | `own_organisation` | `GET /api/portal/requests` |
| View one request | `own_request` | `GET /api/portal/requests/{ref}` |
| Comment on a request | `own_request` | `POST /api/portal/requests/{ref}/comments` |
| Presign an attachment upload | `own_request` | `POST /api/portal/requests/{ref}/attachments/presign` |
| Escalate priority (`CP-7`) | `own_request` | `POST /api/portal/requests/{ref}/escalate` *(served as `POST /api/portal/submissions/{ref}/escalate-priority`, predicate `own_submission`, requester only, body `{ priority }`)* |
| Reopen a resolved request (`CP-8`, `WF-21`) | `own_request` | `POST /api/portal/requests/{ref}/reopen` *(served as `POST /api/portal/submissions/{ref}/reopen`; also reopens an auto-declined submission, `IQ-15`)* |
| Rate a resolution (`CP-9`) | `own_request` | `POST /api/portal/requests/{ref}/rate` *(served as `POST /api/portal/submissions/{ref}/satisfaction`, body `{ rating 1..5, comment? }`)* |
| Add a participant — requester only | `own_request` | `POST /api/portal/requests/{ref}/participants` |
| Re-rank own backlog | `own_organisation` | `POST /api/portal/requests/rank` |
| Browse the catalogue | `own_organisation` | `GET /api/portal/catalogue` |
| Submit a new request | `own_organisation` | `POST /api/portal/submissions` |
| View a submission | `own_submission` | `GET /api/portal/submissions/{ref}` |
| Message on a submission | `own_submission` | `POST /api/portal/submissions/{ref}/messages` |
| Withdraw a submission (`CP-15`) — requester only | `own_submission` | `POST /api/portal/submissions/{ref}/withdraw` |
| List approvals addressed to them | `addressed_approval` | `GET /api/portal/approvals` |
| Decide an approval | `addressed_approval` | `POST /api/portal/approvals/{id}/decide` |
| View projects | `own_organisation` | `GET /api/portal/projects` |
| View one project | `own_organisation` | `GET /api/portal/projects/{key}` |
| Browse the knowledge base — **P5** | `own_organisation` | `GET /api/portal/kb` |
| Read one article — **P5** | `own_organisation` | `GET /api/portal/kb/{id}` |
| Deflection search while raising a request — **P5** | `own_organisation` | `GET /api/portal/kb/deflection?q=` |

`self` is the caller's own person row — the portal-scoped counterpart of policy kind 2's
`(self)` used on `/api/me/*`, added to `PortalPredicate` in
[rbac.md](permissions.md) for exactly these two routes.

<a id="customer-portal-api"></a>
### API

A separate router, deliberately narrow. **Every route carries policy kind 3** from
[RBAC](permissions.md) — `{ portal: 'customer', predicate }` — where the
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
GET  /api/portal/notification-preferences                  self
PUT  /api/portal/notification-preferences                  self
GET  /api/portal/notification-preferences/email-link-handoff self
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

<a id="customer-portal-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Customer's organisation is suspended, or `organisation.portal_access` is set false | Every session of that organisation's customer-side people is invalidated — in effect on their next request, per [auth-and-identity.md § Sessions](#pending-01-architectureauth-and-identity-sessions) — and sign-in shows a message with the support email. Under [IP-22](feature-contracts-p3.md#identity-provisioning), this lifecycle also retires affected external identity grants with the existing `mapping_changed` reason and reprojects them atomically; direct grant provenance is retained, but portal denial still blocks access. Reopening alone does not restore external grants. |
| Customer session hits the agent origin | Rejected at the callback and on every request; audited |
| Work item moved to a project the customer cannot see | It disappears from their list. The bookmarked URL returns 404 |
| Portal disabled by feature flag | The origin returns a maintenance page, not a broken app |
| Customer has no requests and no catalogue | Home shows an explanatory empty state with the support email |
| Attachment marked staff-internal | Absent from the portal response entirely. Not hidden client-side |
| Customer replies to a closed request | Reopens it if within the window; otherwise creates a linked new request, using the original's request type |
| Customer withdraws a submission already being triaged | Refused with a clear message once a triager has started acting on it — see [intake queue](feature-contracts-p2.md#intake-queue) |

<a id="customer-portal-out-of-scope"></a>
### Out of scope

- Catalogue definition → [request-types-and-catalogue.md](feature-contracts-p2.md#request-types-and-catalogue)
- Triage → [intake-queue.md](feature-contracts-p2.md#intake-queue)

<a id="customer-portal-testing"></a>
### Testing

Security E2E — these are the tests that would have caught v1's defects:

- `portal-cross-tenant.spec.ts` — customer A cannot reach customer B's request by URL
- `portal-visibility-scope.spec.ts` — a colleague in the **same** customer organisation
  cannot reach a request or submission whose `customer_visibility` is `private` and who is
  not the requester or an explicitly added participant (`CP-16`, [data-model.md](data-model.md)
  `work_item.customer_visibility` / `submission.customer_visibility`) — the boundary
  `portal-cross-tenant.spec.ts` does not cover, since that test is about organisation, not
  participant-list, scope
- `portal-no-internal-comments.spec.ts` — internal comments absent from every response
- `portal-cannot-deescalate.spec.ts`
- `portal-cannot-self-approve.spec.ts`
- `portal-session-rejected-on-agent-origin.spec.ts`
- `portal-bundle-purity.spec.ts` — no agent module in the portal graph

UX E2E: full journey on a 375 px viewport — sign in, browse catalogue, submit, reply,
approve, rate.

<a id="customer-portal-open-questions"></a>
### Open questions

`CP-11`/`CP-12` still need a normative adapter contract between the legacy workspace
invitation API and organisation-scoped customer admission. Until the customer admission
transaction, token lifecycle, provider binding, route policy and audit/event vocabulary are
specified, invitation acceptance and public customer registration remain unavailable. See
the [P3 portal admission adapter proposal](#pending-07-planningp3-portal-admission-contract-proposal).
The provider table and `portal_scope` semantics are defined by
[data-model.md](data-model.md) and
[auth-runtime-reconfiguration.md](#pending-01-architectureauth-runtime-reconfiguration); the
P3 implementation adds the Drizzle table/migration and reloadable, portal-scoped auth pair.
Customer local sign-in is enabled only by stored customer-scope provider rows and remains
closed without an already admitted active customer identity. Account creation and invitation
acceptance remain closed until `CP-20`..`CP-26` are implemented and verified. CP-18/IP-29 also need an
exact email-first discovery route contract before the UI can route typed domains to
organisation SSO without inventing a public endpoint.
Per-request visibility was decided 2026-09-05 (`CP-16`); organisation SSO is specified by
`CP-17` and `IP-29`.

<a id="customer-portal-related"></a>
### Related

- [ADR 0004](#pending-01-architectureadr0004-two-portals-two-origins)
- [RBAC](permissions.md) · [Approvals](feature-contracts-p2.md#approvals)

<a id="identity-provisioning"></a>
## Identity connections and SCIM provisioning — Microsoft Entra first

- **Primary phase:** P3 (data model, security rules and acceptance tests fixed in P0; identity,
  membership, RBAC, audit and revocation infrastructure proven in P1/P2; operational
  hardening in P4)
- **Feature flag:** `feature.scim` (the SCIM endpoint; default on once P3 ships — a
  connection must also be enabled). OIDC sign-in is part of authentication and is not
  flag-gated.
- **Depends on:** [auth-and-identity.md](#pending-01-architectureauth-and-identity),
  [RBAC](permissions.md), [customer-portal.md](feature-contracts-p3.md#customer-portal),
  [god-mode.md](feature-contracts-p4.md#god-mode), [audit-trail.md](feature-contracts-p2.md#audit-trail)
- **Decided:** 2026-09-05, Thomas — SCIM is **core delivery**, not a candidate

<a id="identity-provisioning-purpose"></a>
### Purpose

TaskDesk authenticates with Microsoft Entra and is multi-organisation: internal staff and
external customer organisations both need safe **joiner / mover / leaver** handling. OIDC
answers "who is this, right now, at login". SCIM answers "create this person before they
first sign in, update them, and — the security-relevant half — **disable them the moment
the directory does**". Without SCIM, offboarding depends on someone remembering.

| | OIDC | SCIM |
| --- | --- | --- |
| When | At login | Whenever the directory changes |
| Does | Authenticates; establishes identity; issues a TaskDesk session | Creates, updates, activates/deactivates local records; optionally synchronises groups for controlled role mapping |
| Direction | User's browser ↔ IdP ↔ TaskDesk | IdP → TaskDesk (inbound, privileged) |

<a id="identity-provisioning-concepts"></a>
### Concepts

| Term | Meaning |
| --- | --- |
| **Identity connection** | One configured external identity source: provider type (Entra first), portal scope (`agent` or `customer`), and — for customer connections — exactly one organisation |
| **SCIM connection** | The inbound provisioning channel attached to one identity connection; owns the hashed bearer token, allowed resources and mappings |
| **External identity** | The durable link between a local person and an external identity: `issuer` + immutable `subject` (+ SCIM `externalId`), **never email alone** |
| **Group mapping** | An allowlisted external group → one existing TaskDesk role, inside the connection's organisation and portal scope; OIDC and SCIM mappings keep separate provenance |
| **Membership grant** | One active or historical source-specific reason a person has one role in a scope; grants project to one effective `membership` and are never capability-unioned |
| **Provisioning event** | The ledger of everything SCIM/OIDC provisioning did, denied or failed |

<a id="identity-provisioning-identity-architecture--what-taskdesk-stores-what-entra-owns"></a>
### Identity architecture — what TaskDesk stores, what Entra owns

TaskDesk stores and is authoritative for: `user`, `person`, `organisation`, memberships
(organisation / workspace / project), roles and capabilities, `external_identity`,
`identity_connection`, `scim_connection`, `scim_group_mapping`, `oidc_group_mapping`,
`membership_grant`, sessions, API/MCP key ownership, and the audit history. Entra remains the source of authentication, user
lifecycle, directory attributes and (where enabled) group membership. TaskDesk never
stores an external user's password.

**Identity key.** An external identity is identified by `(identity_connection_id, issuer,
subject)` and, for SCIM-created records, `externalId`. The organisation binding and the
portal scope are properties of the *connection*, resolved server-side. Email is an
attribute that may change; it is never the sole key and never a linking key on its own
(`IP-18`).

**Where connections live.** OIDC connections are `identity_connection` rows with typed
columns (the organisation FK and the SCIM link cannot live in a generic `config jsonb`).
The `auth.*` plugin *kinds* (`auth.oidc` and its presets `auth.entra`, `auth.keycloak`, …)
are still registered in the plugin registry and provide the protocol implementation; their configured
*instances* are `identity_connection` rows rather than `instance_plugin_config` rows. Non-OIDC
authentication (`auth.password`, `auth.email-otp`, `auth.magic-link`) stays in
`instance_plugin_config`. The auth reconfiguration mechanism
([auth-runtime-reconfiguration.md](#pending-01-architectureauth-runtime-reconfiguration))
watches both.

<a id="identity-provisioning-data"></a>
### Data

[data-model.md](data-model.md) §2: `identity_connection`,
`scim_connection`, `external_identity`, `scim_group_mapping`, `oidc_group_mapping`,
`scim_group_member`, `membership_grant`, effective `membership`, and `provisioning_event`.
The provenance-ledger/effective-membership contract is proposed in
[ADR 0015](#pending-01-architectureadr0015-membership-grant-provenance). Its recommended
implementation is authorized for the P3 batch; Thomas's integrated P4 design approval
has not been granted. These are target contracts, not implemented tables.
`person.active`, `session`, and `api_key.disabled_at` are the columns de-provisioning writes.

<a id="identity-provisioning-behaviour"></a>
### Behaviour

<a id="identity-provisioning-connections-and-scope"></a>
#### Connections and scope

- `IP-1` An identity connection has a **portal scope** of exactly `agent` or `customer`.
  An `agent` connection has no organisation; a `customer` connection is bound to **exactly
  one** customer organisation. A connection can never serve both portals — `both` is not a
  value ([ADR 0003](#pending-01-architectureadr0003-better-auth-primary),
  [plugin-architecture.md](features.md)).
- `IP-2` A `customer` connection may create or manage **only customer-side people of its
  own organisation**, holding **only the customer role** (until a customer-role model is
  separately specified). It can never: create staff-side users; create instance
  administrators; grant `owner`, `admin`, `manager`, `lead` or any staff role; grant
  `sees_all`; add anyone to another organisation; grant arbitrary capabilities; touch agent
  routes or God Mode; create API keys, MCP keys, webhooks, automations or integrations.
- `IP-3` An `agent` connection may create, update and deactivate **staff-side** people,
  create or update workspace memberships, and apply only **approved staff-side roles** up
  to the connection's configured `max_role_rank`. A group mapping may target only an
  existing workspace with `deleted_at IS NULL` whose `organisation_id` names the unique
  active, non-deleted `organisation.is_internal = true`. The instance administrator
  explicitly selects this workspace in God Mode. On mapping create, target change, enable,
  and grant reconciliation, the server resolves and rechecks the workspace and owning
  organisation, current staff role, rank and capabilities under the connection ceiling;
  missing/deleted/customer-owned workspaces and an inactive/deleted internal organisation
  are refused. An agent connection has `organisation_id = NULL`; its `portal_scope` and the
  validated mapping provide the scope. IdP claims, email and other provider data never
  select a workspace. Admin selection configures one target; it grants no reach by itself
  and is not a provider-controlled connection allowlist. It can never grant
  `instance:admin`, grant `sees_all`, grant a role above `max_role_rank`, or let a group
  *name* alone create capabilities. A decrease to an enabled agent connection's
  `max_role_rank` is an immediate grant-policy transition: in the same configuration
  transaction, retire this connection's active `jit_default`, `oidc_group`, and
  `scim_group` grants whose current role rank exceeds the new ceiling, recompute each
  affected effective membership, and publish authority-cache invalidation after commit.
  Direct and other-connection grants are never retired. Existing sessions for the still-
  enabled connection are not revoked; the authority-cache/session distinction remains as
  described in `IP-22`. Lowered-ceiling mappings and JIT defaults remain visible but
  ineligible until corrected; a later ceiling increase never revives retired grants without
  fresh evidence from their own source. Rank guardrails and elevated-action rules in
  [RBAC](permissions.md) apply to what a connection is configured to grant.
  An agent connection's nullable `default_workspace_id` is the sole target for its JIT
  default grant. When agent JIT is enabled, it must reference an active workspace in the
  active internal organisation, and `default_role_id` must be scoped to that exact
  workspace and satisfy the connection's rank/capability ceiling. The server never selects
  a workspace from IdP data or from an arbitrary first/oldest workspace. Customer
  connections keep `default_workspace_id` null and use only the canonical Customer
  organisation role. A valid configured target may remain dormant when JIT is disabled or
  its role is above a subsequently lowered ceiling; it grants nothing until made eligible
  by an audited config change.
- `IP-4` **All scope is resolved from the connection**, never from the request. A SCIM or
  OIDC payload supplying `organisation_id`, `workspace_id`, a role, a capability or a portal
  scope is rejected `400 forbidden_attribute` — it is not ignored, it is refused, and the
  denial is a provisioning event.
- `IP-5` Configuring any connection — agent or customer — is an **instance administrator**
  action in God Mode. In the first release, customer organisations **cannot** configure
  their own issuer, SCIM token, role mapping, integration credentials, staff access or
  cross-organisation access. Customer self-service IdP setup is a later feature with its own
  spec, security review, validation workflow and approval model.
- `IP-6` Creating or changing a connection and rotating or revoking a SCIM token are
  **elevated, audited** actions. Connection creation and configuration use distinct,
  session-only PA-15 operations: create binds the fixed collection route, initial version
  `1` and the complete canonical strict body; configuration binds the fixed item route,
  immutable connection id, current positive `configVersion` and complete canonical strict
  body. The connection id, provider, portal scope, customer organisation, tenant, issuer and
  derived redirect URI cannot be changed after creation. Disable is `enabled:false` in the
  configuration CAS and retires only this connection's external sources and tagged
  sessions. Create starts disabled. Client-secret plaintext is accepted only on a strict
  write, encrypted using the existing per-connection AES-GCM helper, and never returned,
  logged or written to audit/event detail. Connection delete remains the separate typed-name
  pending action. The superseding operation decision is recorded in
  [decision-log.md](#pending-07-planningdecision-log); it replaces the older api-design sentence
  that classified connection PATCH as ordinary. Every OIDC group-mapping create, edit, enable or disable
  is also elevated and audited, using the fixed route policies and operation-bound step-up
  in [api-design.md](#pending-01-architectureapi-design-oidc-group-mapping-administration).
  Every write through the existing `PATCH /api/instance/identity-connections/{id}/scim`
  administration route is unconditionally `instance:admin`, elevated and `sessionOnly`,
  including settings, lifecycle, mapping, display-only and customer changes. This route-wide
  policy covers the prior conditional triggers without body-selected elevation. The strict
  DTO, exact permitted settings/mapping writes, shared parent-version CAS and dedicated
  `scim_admin_update` PA-15 binding are specified in
  [api-design.md](#pending-01-architectureapi-design-scim-administration-patch--issue-561-owner-contract).
  The same route has one closed `attribute_mapping` replacement variant for profile-only
  values, as specified in that API contract. Its mounted strict route enforces the
  registered session-only PA-15 operation and fails closed if proof is unavailable. OIDC
  mapping writes remain unconditionally elevated with separate operation bindings.

  The same settings variant may replace the closed `matchAttributes` list used by
  `GET /Users` equality filters. It uses the same parent `configVersion` compare-and-set,
  elevation and audit path; omission preserves the stored list. The v1 default is
  `externalId`, `userName` in that order. This setting controls only which profile
  attributes this connection may query. It never changes identity matching, linking,
  membership, role, or authorization behavior.
  Mapping to `instance:admin` or `sees_all` is not elevated — it is **impossible**: the
  mapping editor does not offer it and the server refuses it.

  SCIM token rotation and revocation use separate PA-15 operations,
  `scim_token_rotate` and `scim_token_revoke`, each bound to its exact route, connection id
  and positive expected parent `configVersion`. Both disable the SCIM child and increment
  the parent version exactly once; rotation invalidates the previous bearer immediately and
  returns a new 32-byte bearer once, while revocation returns no secret. Re-enable is a
  later authenticated settings write after updating the upstream bearer. Stale CAS preserves
  the proof for retry and changes nothing; raw token material is excluded from audit, events,
  logs and read DTOs. Full request and response semantics are in
  [api-design.md](#pending-01-architectureapi-design-scim-token-rotation-and-revocation--pa-15-operations).

<a id="identity-provisioning-oidc-login"></a>
#### OIDC login

- `IP-7` Every connection enforces the protocol floor in
  [auth-and-identity.md](#pending-01-architectureauth-and-identity-what-every-authoidc-plugin-must-do--the-protocol-floor):
  PKCE `S256`; single-use random `state` bound to the initiating session and portal; the
  server-side state context binds the selected connection id, portal and persisted
  organisation id; `nonce` validated; exact redirect-URI match; ID-token signature, `iss`,
  `aud`, `exp` validated before any claim is read. A callback must consume and honor that
  context; no callback claim may replace its connection or scope. Any failure ⇒ sign-in
  fails, audited.
- `IP-8` A customer connection's callback is accepted **only on the portal origin**, an
  agent connection's only on the agent origin; the resulting session carries the matching
  `session.portal` and is unusable on the other host.
- `IP-9` **Home-realm routing is separate from identity admission and organisation scope.**
  At unauthenticated customer-login initiation, the visitor's typed email domain may resolve
  one configured customer connection through `domain_bindings` and route the browser to
  initiate that connection's OIDC flow. This chooses only which configured login flow to
  start; it proves neither address ownership nor permission to sign in, and creates no
  person or membership. The server binds the selected connection id, its `customer` portal
  and its persisted `organisation_id` into the single-use OIDC `state` described by `IP-7`.
  After callback and authenticated admission, that state and the selected connection are
  authoritative: callback email-like claims and domains cannot change/reselect the
  connection, portal or organisation, create an organisation, or link identities by email.
  The durable subject still resolves only under the selected connection; same-connection
  SCIM subject matching follows `IP-19`, while cross-connection email linking remains
  forbidden by `IP-18`. A token whose
  validated email-like claim has a domain bound to another connection may be refused **after
  token validation**; this collision check is deny-only. Neither a matching nor an unbound
  callback domain admits a subject. An unbound typed domain may fall through to existing
  non-SSO methods under `IP-29`; the complete unauthenticated flow has the limited
  domain-specific disclosure defined there. It never guesses or creates an organisation.
  The selected connection's persisted `organisation_id` alone supplies customer scope
  ([multi-tenancy.md](workspace-boundaries.md),
  [security-model.md](#pending-01-architecturesecurity-model-identity-provisioning-and-account-linking)).
  New-person JIT in the first release is available only on Microsoft Entra connections and
  requires the subject-admission predicate in `IP-27`; other provider JIT stays disabled
  until its own rule is approved. Email-like claims remain contact/display metadata and never
  prove address ownership, grant JIT, change scope or link an account.
- `IP-10` JIT provisioning (create on first login) is a per-connection policy, off by
  default for customer connections when SCIM is enabled — the directory, not the login,
  creates people. When both are on, the first login **links** to the SCIM-created record by
  `subject`/`externalId`; it never creates a duplicate. Its permitted default role is a
  separate `jit_default` grant source, never a direct grant or OIDC group grant.
- `IP-26` **The issuer must be a specific tenant.** A connection stores the *resolved,
  tenant-specific* issuer from its discovery document. Entra's `/common` and
  `/organizations` authorities are **refused at save**, with an explanation: their discovery
  documents return an `issuer` containing a `{tenantid}` template, so an equality check
  fails and a naive substitution would accept a token from *any* Entra tenant. Every ID
  token must match both the stored `iss` **and** `identity_connection.tenant_id` through its
  `tid` claim; either mismatch fails sign-in, audited. This is the rule
  `05-no-user-controlled-tenant-selection.test.ts` asserts.
- `IP-27` **Entra admission is checked at every login, including repeat login, whether or
  not JIT is enabled.** Every Entra connection must store one exact, nonempty
  `required_entra_app_role` in its existing `identity_connection.jit_policy` at creation and
  configuration save, and before enable; changing `jit_policy.enabled` cannot remove or
  bypass this admission setting. The closed `jit_policy` object contains exactly
  `enabled: boolean`, `default_role_id: string | null` (an existing canonical TaskDesk role
  id), and `required_entra_app_role: string` (the exact nonempty Entra app-role value).
  Agent JIT additionally requires the connection's `default_workspace_id` and a role scoped
  to that workspace; the target is connection configuration, never an IdP selector.
  Unknown keys and malformed values are refused at save and fail login closed when found in
  persisted configuration. The required app-role value is preserved byte-for-byte; it is not
  a TaskDesk role id, wildcard or selector. A customer connection has only its canonical
  Customer default role. Enabled JIT requires a usable default role under IP-3/IP-10/IP-22;
  a default role left above a subsequently lowered ceiling is retained as dormant policy
  and grants nothing until made eligible again. Reserved non-Entra provider types cannot be
  enabled in this release. Missing or malformed persisted admission configuration
  fails authentication closed and is surfaced as invalid connection health. After the
  protocol floor (`IP-7`) and exact selected-connection `iss`, `tid` and `aud` validation
  (`IP-26`), resolve the immutable `oid` under that connection. Before creating a person or
  membership, and before issuing a session for an existing identity, require the signed ID
  token's `roles` claim to contain the exact configured app-role value and its `acct` claim
  to equal `0`. This applies to existing invite- or SCIM-provisioned identities on a
  JIT-disabled connection as well as JIT-created identities. The Entra app registration
  must assign the app role and request the signed optional `acct` claim. This value is an
  IdP admission signal only; it is never a TaskDesk role, capability, organisation,
  workspace, portal scope, `instance:admin` or `sees_all` authority source.

  Missing, malformed or nonmatching role; missing or malformed `acct`; and `acct=1`
  (guest) fail closed and record the existing denied provisioning event/audit as applicable.
  A failed check on a valid, protocol-validated token denies a new session and atomically
  retires only that external identity's OIDC and JIT grants (`admission_failed`); it does
  not touch direct, SCIM or other-connection grants. An invalid or unverified token, or
  invalid server-side admission configuration, is not evidence of upstream removal and
  mutates no grant. JIT remains a separate creation switch: `enabled = false` forbids JIT
  person/default-grant creation but does not waive login admission. Upstream app-role
  deassignment is observed at that identity's next validated login; it does not revoke an
  already-issued session by itself. A disabled connection follows the separate immediate
  connection-disable revocation contract. The app-role assignment and `acct=0` establish
  subject admission only, never TaskDesk authority.

  The durable subject is `oid` with `tid`. `email` → `preferred_username` → `upn` supplies
  contact/display metadata only: it never proves address ownership, grants JIT, chooses an
  organisation or portal, or links an account (`IP-18`). If no valid address is available,
  JIT may fail the existing person-profile data requirement; that is not an authorization
  check. A domain collision may deny under `IP-9`, but a matching domain is never sufficient
  for admission. Generic and other provider JIT remains disabled until its own admission
  rule is approved. The first-release Entra JIT rule rejects guests, including a missing or
  malformed `acct`; it does not create a guest-login or alternate account-linking path.

  The first-release `claim_mapping` is a closed profile-only object:
  `{ "version": 1, "displayName": "name" }`. A missing/null value means this exact
  default; malformed non-null data fails login closed and must be repaired through strict
  connection configuration. The signed `oid` and `tid` remain the fixed subject selectors,
  and email metadata remains the fixed `email` → `preferred_username` → `upn` precedence
  above. The profile map cannot select identity, email, tenant, portal, organisation, role,
  capability or reach; no arbitrary claim path is accepted. A missing/invalid optional name
  is omitted rather than synthesized from email or username.
- `IP-29` **The portal login page has a limited domain-specific SSO disclosure.** See
  [ADR 0014](#pending-01-architectureadr0014-limited-home-realm-disclosure) for the rationale
  and alternatives. It does
  not list customer organisations or connections. A visitor supplies an email address;
  its domain may select one configured customer SSO connection for login initiation. A
  bound domain may lead to that connection's IdP; an unbound domain follows available
  non-SSO methods. These complete unauthenticated flows are intentionally distinguishable:
  an observer who submits a domain may infer that it has an SSO binding and see the IdP's
  public redirect destination, including its public host or tenant path. TaskDesk does not
  publish an organisation or connection inventory, organisation names, connection ids,
  discovery configuration, claim mappings, secrets, or whether a TaskDesk user account
  exists. Anonymous rate limits apply; they reduce bulk probing but do not hide
  this domain-specific disclosure. Identical initial response body, status, or timing is
  not a non-enumeration guarantee for the full flow. `IP-9` governs connection/state
  binding and `IP-27` governs JIT admission; typed or callback email domains do not grant access or
  change scope. The agent login page may list its instance-level providers
  ([customer-portal.md](feature-contracts-p3.md#customer-portal) `CP-18`,
  [auth-and-identity.md](#pending-01-architectureauth-and-identity-per-portal-binding)).

- `IP-35` The typed-domain route of `CP-27` is the only unauthenticated home-realm entry point. Its state binding follows `IP-9`, its disclosure follows `IP-29` and ADR 0014, and its audit rows carry the selected connection id server-side only. A typed address never grants admission, creates a person or changes scope, and the route is closed while no customer connection with a domain binding is enabled (it then returns the "continue with local methods" shape). `Contract-new`

<a id="identity-provisioning-scim-endpoint"></a>
#### SCIM endpoint

**The SCIM 2.0 server is ours.** better-auth has no SCIM plugin, so the schemas, the
`PATCH` path expressions, `ListResponse`, the SCIM error bodies and the filter parser are
hand-written protocol code; only the credential check reuses the platform.


- `IP-11` One SCIM 2.0 endpoint family on the agent origin: `/scim/v2/Users`,
  `/scim/v2/Users/{id}`, `/scim/v2/Groups`, `/scim/v2/Groups/{id}`,
  `/scim/v2/ServiceProviderConfig`, `/scim/v2/ResourceTypes`, `/scim/v2/Schemas`.
  Media type `application/scim+json`. HTTPS only.
- `IP-12` Authentication is a **bearer token per SCIM connection**: shown once at creation,
  stored as a hash, rotatable and revocable. **Rotation invalidates the old token
  immediately** — there is no grace window; the God Mode flow rotates, shows the new token
  once, and tells the administrator to update Entra before re-enabling. The token
  determines the connection, therefore the organisation, portal scope, allowed resource
  types and allowed mappings. Raw token values never appear in logs, responses, exports or
  audit detail.
- `IP-13` Required for Entra interoperability, and the whole first-release surface: `POST
  /Users`; `GET /Users?filter=userName eq "…"` (and `externalId`, plus configured match
  attributes) returning a correct `ListResponse`; `GET /Users/{id}`; `PATCH /Users/{id}`
  (`active`, profile attributes); `PUT /Users/{id}`; `GET /Users` with `startIndex`/`count`
  pagination; `POST`, `PUT`, `PATCH`, `GET` and `DELETE` for `/Groups` and `/Groups/{id}`;
  `ServiceProviderConfig`, `ResourceTypes`, `Schemas`. Group writes are full same-connection
  directory reconciliations; `DELETE` is soft deactivation, and a mapping grants only from
  a successful authenticated membership reconciliation. **`/Bulk` is not
  implemented** unless Entra interoperability testing proves it necessary. `DELETE /Users/{id}`
  is accepted and treated as `active=false` (`IP-15`) — SCIM de-provisioning is never a
  hard delete.
- **User filter contract (v1):** `filter` accepts one case-insensitive attribute name,
  the `eq` operator, and one quoted string value; compound filters and other operators
  return SCIM `400 invalidFilter`. String equality follows the core SCIM `caseExact`
  characteristic; all supported v1 User attributes are case-insensitive. Attribute names
  and the `eq` operator are case-insensitive. `scim_connection.match_attributes` is a closed,
  connection-configured list with canonical default `externalId`, `userName`; those two
  are mandatory in every valid stored list. The only additional v1
  names are `displayName`, `name.formatted`, `title`, and `preferredLanguage`. An
  additional name must be explicitly present in the connection's list, otherwise the
  filter returns `400 invalidFilter`.

  Matching remains inside the authenticated connection and `provisioned_via = 'scim'`.
  `externalId` and `userName` use that connection's external-identity snapshots;
  `displayName` and `name.formatted` both compare the same `person.display_name` value
  emitted by the current profile projection; `title` compares `person.job_title`; and
  `preferredLanguage` compares `person.locale`, which the current projection emits as
  `preferredLanguage`. The person profile values are the same profile fields already
  exposed for the matched same-connection SCIM identity; filters do not perform identity
  lookup or link people across connections. `emails.value` is deliberately unsupported:
  the bounded stored snapshot contains only the selected primary email, and cannot truthfully
  implement SCIM's any-email-value match. `locale` is also unsupported because the response
  profile emits `preferredLanguage`, not `locale`. Unknown, malformed, or unsupported
  filters fail closed; invalid persisted configuration returns `503` rather than silently
  reverting to a broader filter set.
- `IP-14` Schemas are validated **strictly**: unknown attributes, forbidden attributes
  (`IP-4`) and oversized bodies are rejected with SCIM error responses. Requests are
  rate-limited per connection (anonymous-class limits apply to failed authentication).
- `IP-15` **Deactivation** (`active=false`, or `DELETE`): set `person.active = false`; revoke
  every session — which takes effect on that person's **very next request**, because
  `session.cookieCache` is disabled and every request is validated against the `session`
  table ([auth-and-identity.md § Sessions](#pending-01-architectureauth-and-identity-sessions)); revoke every currently issued personal API key; retire every external
  `membership_grant` for the person, including explicitly linked identities on other
  connections. With `lifecycle_policy = end_memberships` (the default), also retire direct
  grants and remove all effective memberships. With `keep_memberships`, retain only direct
  grants and their effective rows as dormant while `person.active = false`; external grants
  never remain latent. Reactivation cannot restore retired grants. **Preserve** authored work
  items, comments, approvals, activity and audit rows, attributed to a deactivated/former
  member; write a provisioning event with source, organisation, external identity, previous
  state and resulting action. Local user deletion and anonymisation remain the separate
  elevated administrative process in [data-protection.md](#pending-05-operationsdata-protection).
  The person-wide state/credential/grant transition is one shared IP-22 transaction seam:
  it takes the person id, the caller's documented direct-membership lifecycle policy and
  a closed, server-owned caller context; it locks and revalidates the complete
  person grant closure, marks the person inactive, revokes every session and every current
  Better Auth personal API-key row, retires all external grants across linked connections,
  retires direct grants only for `end_memberships`, and reprojects every affected key. It
  preserves historical rows. SCIM context derives `scim_deactivated` for external grants
  and `direct_removed` for direct grants; administrative person-wide deactivation derives
  `person_deactivated` for both. Request fields never choose a retirement reason. A
  source-specific caller remains responsible for changing only its own identity evidence
  and writing its own durable event/audit in the same outer
  transaction; the shared transition does not infer or rewrite another connection's
  external-identity state. The current P3 runtime has no separate `api_key` extension or
  `is_mcp` storage table/column; this batch's credential revocation covers all existing
  Better Auth `apikey` rows. A future extension/MCP credential store must add its person
  revocation to this same lifecycle seam before it can be enabled as an issued credential.
- `IP-16` **Reactivation** (`active=true`) reactivates only the existing linked
  `external_identity`'s person; it never creates a duplicate or restores a revoked grant.
  SCIM grants are re-derived only from current verified SCIM groups/mappings; OIDC grants
  wait for a later validated login on that connection. Direct grants retained by
  `keep_memberships` remain dormant until the person is active. Reactivation uses the same
  locked person lifecycle seam but performs no credential restoration or grant insertion;
  the caller updates only its linked external identity and records its own source event.
- `IP-17` Profile updates (`PATCH`/`PUT`) may change permitted attributes — per-person
  display name, connection-scoped email snapshot, `userName`, job title and locale — and can
  never alter organisation, portal scope, role, reach or capabilities. `person.display_name`
  is the TaskDesk profile display name, independent of the account-wide `user.name`; an
  unlinked SCIM placeholder can therefore retain its own profile without creating a login.
  SCIM reads emit stored `displayName` and do not derive a name from `userName` or email.
  The additive `person.display_name` field is per-person profile data and never changes
  account-wide `user.name`. Existing rows stay NULL; no backfill guesses from account or
  connection snapshots. Deactivation/reactivation preserves the value.
  Existing people without a stored display name remain without one; migration must not guess
  from account or identity snapshots. Deactivation and reactivation preserve the profile and
  connection-scoped snapshots. The version-1 `scim_connection.attribute_mapping` grammar,
  deterministic email selection, mandatory-profile failure, optional-field omission and
  future-write-only behavior are owned by the
  [SCIM administration API contract](#pending-01-architectureapi-design-scim-administration-patch--issue-561-owner-contract).
  Identity and authority selectors are fixed and cannot be mapped. A malformed persisted
  non-null map fails SCIM user writes closed and surfaces configuration health; it does not
  silently fall back to defaults. An administrator must save a valid map under the same
  parent version and operation-bound proof before provisioning resumes.
- `IP-31` **Tolerated Entra deviations.** `IP-14`'s strictness is about *authority*, not
  about spelling, and Entra's provisioning service sends three things a literal-minded
  validator rejects. All three are tolerated, and only these three: `op` values are matched
  **case-insensitively** (`"Replace"`, `"Add"`, `"Remove"`); `active` is accepted as the
  strings `"True"` / `"False"` as well as a JSON boolean, and coerced; and the
  `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User` extension is **ignored, not
  rejected**, unless one of its attributes is explicitly mapped. None of this weakens
  `IP-4`: a forbidden attribute is still refused `400 forbidden_attribute`, whatever its
  case or JSON type.
- `IP-32` **A same-connection duplicate is not something to retry.** Entra's provisioning
  agent retries on 5xx and on timeouts, so `POST /Users` is re-delivered. A create whose
  `externalId` or `userName` already exists **on the same connection** returns the generic
  `409` with `scimType: "uniqueness"` and no resource id. The response body and status are
  identical to IP-18's cross-connection or cross-organisation conflict; only the internal
  provisioning event records which conflict occurred. The agent can reconcile with its
  next list/filter request without receiving another identity's resource id.

<a id="identity-provisioning-linking-and-identity"></a>
#### Linking and identity

- `IP-18` **No automatic linking on email.** A login through connection B for an email that
  exists via connection A is refused with an explanation. Linking requires an authenticated
  session on A and an explicit, audited confirmation. The SCIM path is stricter still: a
  SCIM `POST /Users` whose `userName`/email matches an existing person of a *different*
  connection or organisation is refused `409` and logged — it does not adopt the record.
  Its external response has the same status and body as an IP-32 same-connection duplicate;
  no matching resource id or conflict class is exposed to the caller.
- `IP-19` Within one connection, SCIM create followed by first OIDC login links by
  `subject` (Entra `oid`) and `externalId`; the email snapshot is updated, not matched.
  **Link and activate** (owner decision, decision log 2026-10-10): SCIM `POST /Users` leaves a
  user-less `external_identity` and a placeholder person. When a login presents the same
  connection, issuer and subject as that active identity, the login (in the same transaction
  as the IP-22 grant reconciliation) creates the `user` and `account` row, links them to the
  identity and person, and clears `is_placeholder`; later logins are ordinary. Only that exact
  connection + subject match qualifies: an address owned by another user refuses, the same
  subject on a different connection does not link, and a deprovisioned or inactive identity or
  person is refused and never reactivated by a login.
- `IP-30` **Claiming a placeholder person.** An import may leave a `person` with
  `user_id = null` and `is_placeholder = true` so history has an author
  ([auth-and-identity.md](#pending-01-architectureauth-and-identity-identity-resolution--the-important-rule)).
  A later sign-up may **claim** that row — linked, not duplicated — but only on a path where
  **TaskDesk itself verified the address**: password sign-up with email verification, email
  OTP, or magic link; or an explicit, administrator-confirmed claim. **Never on the SSO
  path by address or any other loose match**, where the address is the IdP's assertion rather
  than our verification, and where for Entra there is no `email_verified` claim to lean on at
  all (`IP-27`). The one SSO link is `IP-19`'s: the user-less identity SCIM created on this
  same connection for exactly this subject, which the login activates; it never reaches an
  import placeholder. Every claim is
  audited. This is not an exception to `IP-18`: `IP-18` forbids linking to another
  *connection's* account, and this links to a row that has no account.

<a id="identity-provisioning-groups"></a>
#### Groups

- `IP-20` SCIM `/Groups` is supported **only for allowlisted group → role mapping**. A
  `scim_group_mapping` row names one external group and **one existing TaskDesk role**
  inside the connection's organisation (customer) or a workspace eligible under `IP-3`
  (agent). The instance administrator selects the agent workspace; each create, target
  change, enable and reconciliation revalidates that it is a non-deleted workspace owned
  by the unique active, non-deleted internal organisation. Provider Groups are stored
  separately from role mappings in connection-scoped `scim_group` rows keyed by the
  provider `externalId`; `displayName` is opaque directory metadata. Membership uses
  `scim_group_directory_member` rows that reference only the same connection's
  `external_identity` ids, never email. Unmapped groups are stored and grant nothing.
  A mapping may predate observation, but creating it grants nothing until an authenticated
  SCIM reconciliation observes the same-connection group membership. Group/member removal
  and deactivation are soft, retain directory history, and use the IP-22 writer to retire
  only grants derived from that SCIM mapping with `scim_group_removed`; no resource is
  hard-deleted. Authorization history remains in the distinct `scim_group_member` table.
- `IP-21` Customer groups map only to customer roles; agent groups map only to approved
  staff roles at or below `max_role_rank`. No group can grant `instance:admin` or
  `sees_all`; no group can create roles or capabilities; no group can add anyone to another
  organisation.
- `IP-22` Owns the shared source-validity and projection invariant for **every
  TaskDesk-controlled write** to connection grant policy, mapping eligibility, role
  eligibility or role priority: at commit, every affected active grant is valid under the
  new committed configuration and every affected effective membership is the one-role
  projection of all remaining valid grants. A policy or role write cannot commit while
  leaving an affected grant or winner stale. Invalid source rows retire append-preservingly;
  priority-only changes still recompute the winner when no source retires. Retired external
  grants return only after fresh matching evidence from their own source. Authorization
  reads use the stored effective projection and current role rows, never token claims or an
  unprojected grant union.

  For external grants, the locked writer's single `valid_now(grant, locked_rows)` predicate
  requires an active person whose owning organisation is active and not deleted; an
  enabled, scope-eligible connection; for `scim_group`, an enabled SCIM child with `groups`
  in `allowed_resources`; a current matching JIT default or enabled same-source mapping;
  an existing role on the correct side/scope that is still the configured/mapped
  role, has no externally forbidden capability, and (for staff) is within the connection's
  current `max_role_rank`; and a live target. A customer target is its active, non-deleted
  organisation with `portal_access=true`. An agent target is a non-deleted workspace owned
  by the unique active, non-deleted internal organisation. These are commit-time parent
  facts, not a cached admission result. External authority always has
  `sees_all = false` and never includes `instance:admin`. Direct grants follow their own
  role rules and are independent of external connection, JIT and mapping state. IP-15's
  global SCIM deactivation remains the explicit person-wide lifecycle exception: under
  `keep_memberships`, retained direct grants/effective rows are dormant and not authorization
  inputs while the person is inactive; under `end_memberships`, direct grants also retire.
  Admission is validated-login evidence, not a claim re-read by an administrative writer;
  IP-27 observes upstream Entra app-role removal at the next validated login. Missing or
  invalid stored role/config/source state fails closed and is not projected.

  Every participating writer uses this one total lock order, sorting ids within each class:
  (1) all affected owning `organisation` rows (including the old and proposed owner if an
  allowed ownership change exists); (2) all affected target `workspace` rows for agent
  external scopes; (3) all affected `person` rows; (4) existing `role` rows; (5)
  `identity_connection` rows; (6) OIDC/SCIM mapping rows and `scim_connection` rows in a
  fixed table-then-id order; (7) `external_identity` rows; (8) stable
  `(person_id, scope, scope_id)` projection keys; then any grant/history rows the transaction
  mutates in deterministic order. A project row is not part of this P3 external-target
  contract. Uncreated JIT people are serialized by their already-existing locked parent
  connection/scope anchors and uniqueness; insert only after revalidating those anchors.
  Existing caller/current-role/config-version and PA-15 proof locks/checks remain at their
  documented points in this order. The audit-chain lock stays at its existing append point
  after authority locks; no later authority lock may be acquired after audit append.

  Pre-discovery is non-authoritative. Acquire the whole candidate set in order before
  changing a parent, person, configuration, role or source row, or inserting a source row
  with foreign keys. Then re-read eligibility, references, versions and the complete
  person→parent→target→role→connection→mapping→identity→grant/history closure under those
  locks. If a new or changed reference/dependency was not covered, roll back and retry from
  the beginning with the expanded sorted set; never fetch a newly found earlier-class lock
  after a later-class lock. A missing/deleted parent fails closed. All person, organisation,
  workspace, role, connection/configuration, mapping, identity, grant, direct-grant and
  projection writers that can affect this closure contend on the same applicable anchors
  before introducing or changing references. This includes lifecycle writers: a grant
  writer cannot commit against a person or target state that a concurrent lifecycle writer
  changed outside the lock set. Revalidate caller authority/rank, CAS/config versions and
  source eligibility under locks. Unique/FK/CAS constraints are conflict detectors, not the
  serialization proof; retry serialization, deadlock (`40P01`) or relevant uniqueness/FK
  conflicts from a fresh closure, with no partial projection. Under READ COMMITTED, fresh
  post-lock reads are required; read-then-lock alone does not close the race. Check
  incidental FK locks during implementation for order reversals. Never hold these locks over
  network IdP calls or post-commit cache publication.

  At commit, every affected active external grant is valid against the committed person,
  owning organisation, target workspace, role, connection, mapping, external identity and
  source state, or is retired append-preservingly in that transaction. Recompute each
  affected effective membership from all remaining valid active grants in that same
  transaction. A stale grant or one-role projection cannot commit because its writer was a
  parent/person writer rather than an identity writer. Direct grants remain independent of
  connection/mapping evidence and keep their precedence, but inactive people and invalid
  parent/target state make them unusable; IP-15 `keep_memberships` direct rows remain
  dormant while the person is inactive. An absent, deleted, ineligible or mismatched parent
  fails closed. This applies to person, organisation and workspace lifecycle, role and
  configuration writes, direct grants, OIDC login, SCIM sync, mapping edits, and projection
  repair. Failed transactions produce no partial grant, projection, event or session issue.

  Parent lifecycle transitions sweep every grant whose current eligibility depends on the
  changed parent and atomically reproject affected keys. Parent invalidation uses the
  existing `mapping_changed` reason for external target-eligibility retirement; global
  person deactivation uses the existing `scim_deactivated` reason where that lifecycle
  applies. Reactivation, workspace restore or organisation restore creates no external
  grant: fresh evidence from that same source is required. In particular, closing customer
  `portal_access` makes customer external grants ineligible and retires them with
  `mapping_changed` in the same transaction as the sweep/reprojection. Retain independent
  direct-grant provenance, but portal access remains denied and customer sessions are
  revoked under the customer-portal lifecycle rule. Reopening portal access alone never
  revives retired external grants.

  In that transaction, retire invalid grants with existing reasons, repair/revoke linked
  `scim_group_member` history and pointers, and recompute every affected projection from
  all valid sources—even with zero retirements. JIT disable or default-role/target change
  retires this connection's old `jit_default` grants with `mapping_changed`; re-enable or a
  changed default creates none until a later validated same-connection OIDC login with
  current IP-27 admission. A proposed JIT target outside the connection/role/scope rules is
  refused. Keep now-ineligible defaults and mappings visible with an ineligibility warning;
  every writer refuses them until corrected. A lowered `max_role_rank` retires only this
  connection's above-ceiling JIT/OIDC/SCIM grants; increasing it revives none. Mapping
  disable/target/role change and scope ineligibility retire only that same mapping/source.
  For permitted role
  rank edits, sweep all referencing connections, retire newly above-ceiling/otherwise
  invalid external grants, and reproject all direct/external holders; rank priority changes
  reproject even without retirement. A resulting capability set must pass RL-3/4/6/7/14
  and external forbidden-capability guards; refuse an edit that makes an externally mapped
  role grant `instance:admin`, `sees_all`, or an impermissible side/scope. A valid capability
  edit changes current authority for all direct and external holders through the current role
  row and invalidates each affected authority cache; it does not need fresh IdP evidence.
  Display-only name/description edits do not change authority. Role scope, side, workspace
  and immutable identity keys remain uneditable under RL-14. Role deletion retains RL-8
  reassignment and existing `ON DELETE RESTRICT` behavior. Connection disable and global
  SCIM deactivation keep their separate session-revocation rules; ordinary role/policy
  changes leave sessions valid.

  Commit source deltas, projection, safe bounded existing provisioning/audit evidence, and
  already-required domain-event/outbox rows atomically under EV-1/AU-14. Reuse existing
  provisioning events `group.mapping_changed` / `connection.changed` as applicable and
  existing audit actions `role.updated` / `identity_connection.changed`; the
  `identity_connection.changed` outbox remains only where its existing contract requires it.
  Add no table, capability, reason or event key. Outbox
  failure rolls back; audit append follows AU-14's nested-savepoint/reporting exception.
  Invalidate authority cache after commit; if invalidation is lost, the documented 30-second
  authority-cache bound applies. This changes current effective authority after invalidation,
  not the validity of a still-live session. The proposed ledger/projection storage choice is
  in [ADR 0015](#pending-01-architectureadr0015-membership-grant-provenance); this
  transition invariant and matrix are owned here. The recommended P3 implementation may
  proceed under the standing authorization; human ADR approval remains deferred to P4.
- `IP-23` Nested-group resolution beyond what Entra sends directly is out of scope.
- `IP-28` **OIDC group grants are re-derived on every validated login through that
  connection.** After `IP-7`/`IP-26` token validation and `IP-27` admission, resolve the
  immutable `(identity_connection_id, subject)` to one `external_identity`. Interpret only
  a complete, well-formed ID-token `groups` array of Entra object-id UUIDs from that same
  validated connection. The editor and login reconciler use one canonicalizer that validates
  and stores/matches the lower-case, hyphenated UUID form. Match each id only to an enabled
  `oidc_group_mapping` owned by that connection, in its fixed portal/organisation and scope
  eligible under `IP-3`, and within its current `max_role_rank`.
  Names are display snapshots; email-like claims and group names never grant access. Use
  the `IP-22` lock order and revalidate source, mapping and role under lock. In one
  transaction, replace only this identity's active OIDC group grants: add newly justified
  grants; retire missing, disabled, changed, or no-longer-eligible mapping grants (using
  the existing `mapping_changed` reason); refresh the permitted JIT default
  grant; recompute affected effective memberships; and write safe provisioning/audit
  evidence. Publish authority-cache invalidation after commit. Issue the new session only
  after commit; failure issues no session and exposes no partial grant set. This login does
  not sweep another external identity's grants, SCIM grants, or direct administrator grants.

  A valid token with `groups` absent or malformed, or with `_claim_names` / `_claim_sources`
  indicating overage, supplies **no OIDC group grants**. Retire this identity's prior OIDC
  group grants and keep only its permitted JIT default and independent valid sources; emit
  the existing provisioning event and an operator-visible God Mode → Health warning for
  overage. Do not keep a previous group set current, query Graph in the first release, or
  let overage preserve privilege. Invalid or unverified tokens are rejected before any
  grant mutation because unauthenticated input is not revocation evidence. A valid token
  that fails current `IP-27` app-role/`acct=0` admission cannot issue a session; atomically
  retire only that identity's OIDC and JIT grants, not unrelated sources.

  The JIT default is its own source and remains only while the connection's JIT policy and
  current admission allow it. A SCIM-created person with JIT disabled cannot acquire a
  default role from a missing group claim. No IdP source grants `instance:admin`, `sees_all`,
  customer-to-staff movement, a role above the connection ceiling, or an out-of-scope
  workspace. Re-enabling an OIDC mapping waits for a later validated OIDC login through
  that connection with complete matching groups and current `IP-27` admission; a SCIM
  update cannot revive or reconcile its grants. Re-enabling a SCIM mapping waits for a later
  authenticated SCIM synchronization; an OIDC login cannot revive or reconcile its grants.
  Neither source resurrects a retired grant row merely because a mapping is enabled.

  An explicitly linked person may have identities on multiple connections. A login through
  connection A reconciles A's OIDC grants only; it neither applies A's groups to B nor
  removes B's grants. B's upstream removals are unobservable until B's own validated login,
  SCIM update, or administrative disable/change. All authorization reads stored effective
  memberships, never token claims. Global SCIM `active=false` is the distinct lifecycle
  exception in `IP-15` and retires all external grants for the inactive person.

- `IP-34` God Mode OIDC group mappings use the connection-scoped GET/POST/PATCH contract
  in [api-design.md](#pending-01-architectureapi-design-oidc-group-mapping-administration).
  The collection read and both writes require `instance:admin` at instance scope; the read
  is explicitly elevation-exempt and each write is elevated, session-only and bound to
  its own PA-15 operation. All bodies are strict. Customer organisation scope resolves
  from the persisted connection. Agent scope is its `portal_scope = 'agent'` plus the
  instance-admin-selected, server-validated workspace mapping: an existing workspace with
  `deleted_at IS NULL` owned by the unique active, non-deleted
  `organisation.is_internal = true`. The server revalidates it on create, target change,
  enable and reconciliation. An agent connection keeps `organisation_id = NULL`; provider
  data never selects workspace scope. The role must already exist on the correct side and
  satisfy the connection's current `max_role_rank` and
  administrator authority guardrails. No request can grant `instance:admin`, `sees_all`,
  arbitrary capabilities, or cross-scope reach. Every mapping mutation compares and
  advances that connection's `config_version` atomically. Disable, role change or target
  change immediately retires only the changed mapping's active OIDC grants and recomputes
  affected effective memberships; re-enable waits for a later validated OIDC login through
  this connection with complete matching groups and current `IP-27` admission. A SCIM update
  cannot revive or reconcile an OIDC mapping's grants; SCIM mappings require a later
  authenticated synchronization that currently proves that group’s membership. Neither
  source resurrects a retired grant row merely because a mapping is enabled. The first
  release has no mapping DELETE, bulk replacement or claim/SCIM write path. Missing
  connections and missing or foreign mapping ids are indistinguishable `404`s. Details of
  the strict DTO, version conflict, proof binding, lock order and error contract are
  specified in the linked API contract.

<a id="identity-provisioning-audit-and-health"></a>
#### Audit and health

- `IP-24` Every configuration change, provisioning event, de-provisioning event, group
  mapping change, token rotation, denied request and failed authentication writes a
  `provisioning_event` row; those that change authority, reach or configuration also write
  `audit_log`. Grant changes record bounded source kind, connection/identity/mapping ids,
  affected scope/role ids and reason; never raw claims or tokens. Grant delta, effective
  projection and these rows commit together. SCIM group directory create, metadata update or
  soft deactivation records `group.directory_changed` with only connection, group and changed
  field identifiers; member additions/removals retain `group.member_added` and
  `group.member_removed`. Directory-change events never masquerade as membership or mapping
  changes. The God Mode identity screens show provisioning status, last sync result and errors
  **without exposing secrets**.
- `IP-25` `plugin-health` pings each enabled connection's discovery document; a connection
  whose IdP is unreachable is flagged in God Mode → Health.

<a id="identity-provisioning-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| View identity connections | `instance:admin` |
| Create, edit, enable, disable, delete a connection | `instance:admin` + elevated; positive `configVersion` CAS on configuration writes |
| Create, rotate, revoke a SCIM token | `instance:admin` + elevated |
| Create, edit, enable or disable an OIDC group mapping | `instance:admin`; always elevated, session-only and operation-bound for POST/PATCH under `IP-34`, including customer, display-snapshot-only and non-authority changes |
| Edit SCIM administration settings or group mappings | `instance:admin`; every PATCH is elevated, session-only and bound to the dedicated `scim_admin_update` PA-15 operation, shared parent version and strict DTO in [api-design.md](#pending-01-architectureapi-design-scim-administration-patch--issue-561-owner-contract); unavailable proof fails closed (`IP-6`) |
| Call `/scim/v2/*` | The SCIM bearer token — `delegated: scim`, organisation and portal from the token |
| Sign in through a connection | Anyone the connection's portal and organisation admit |

<a id="identity-provisioning-screens"></a>
### Screens

| Screen | Route | Notes |
| --- | --- | --- |
| God Mode → Authentication (identity connections, agent scope) | `/agent/god-mode/authentication` | Existing rows; the list becomes "identity connections" |
| Connection editor | `/agent/god-mode/authentication/{id}` | OIDC settings, JIT policy, domain bindings, OIDC object-id group mappings (selection/open state in URL), **SCIM panel** (endpoint URL, token create/rotate/revoke, allowed resources and distinct SCIM mappings, last sync), Test OIDC, Test SCIM |
| God Mode → Organisations → detail → **Identity** | `/agent/god-mode/organisations/{id}/identity` | The customer-organisation connection: enable/disable portal SSO; provider type (Entra first); organisation-bound OIDC settings; SCIM endpoint info; token create/rotate; Test OIDC; Test SCIM; provisioning status and last sync; errors without secrets; the closed profile-only attribute-mapping editor; group mapping (selection/open state in URL); audit history; **unmissable organisation-scope and portal-scope warnings** |

<a id="identity-provisioning-api"></a>
### API

The SCIM group-mapping editor loads selector choices from the connection-bound
`GET /api/instance/identity-connections/{id}/scim/mapping-options` contract in
[api-design.md](#pending-01-architectureapi-design-scim-group-mapping-selector-options).
It pages every eligible target and role, and submits the existing `mapping_create` and
`mapping_update` variants through the shared parent `configVersion` CAS and
`scim_admin_update` PA-15 operation. It never accepts a role, target, scope, or grant
outside the exact `validateScimMappingRole` constraints used by those writes.

The connection event ledger is read through
`GET /api/instance/identity-connections/{id}/events`. It is instance-admin-only and
requires the connection to exist; absent connections use the same `404` response. The
query accepts an optional opaque version-1 cursor and `limit` (default 25, maximum 100),
ordered descending by `(created_at, id)`. The cursor is bound to its connection. The
response contains only `kind`, `outcome`, `actorType`, and `createdAt`, plus
`page.nextCursor` and `page.hasMore`; it does not expose event ids, trace ids, event
`detail`, or a total count. The existing persisted detail remains write-side evidence and
is not part of this read contract. The UI follows the cursor in its registered route query
state and renders only this safe projection.

```
GET    /api/instance/identity-connections                         instance:admin
GET    /api/instance/identity-connections/{id}/events             instance:admin      (safe provisioning events, cursor-paged)
POST   /api/instance/identity-connections                         instance:admin  E
PATCH  /api/instance/identity-connections/{id}                    instance:admin  E
DELETE /api/instance/identity-connections/{id}                    instance:admin  E  (pending action — typed name + step-up)
GET    /api/instance/identity-connections/{id}/oidc-group-mappings instance:admin (read-only; explicit elevation exemption)
POST   /api/instance/identity-connections/{id}/oidc-group-mappings instance:admin E (session-only; PA-15 operation-bound step-up)
PATCH  /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId} instance:admin E (session-only; PA-15 operation-bound step-up)
POST   /api/instance/identity-connections/{id}/test               instance:admin      (audited even unsaved)
POST   /api/instance/identity-connections/{id}/scim               instance:admin  E  (create SCIM connection + first token)
POST   /api/instance/identity-connections/{id}/scim/rotate-token  instance:admin  E
POST   /api/instance/identity-connections/{id}/scim/revoke-token  instance:admin  E
PATCH  /api/instance/identity-connections/{id}/scim               instance:admin  E  (route-wide, session-only, dedicated PA-15 operation; design only until implemented)
POST   /api/instance/identity-connections/{id}/scim/test          instance:admin
GET    /api/instance/identity-connections/{id}/events             instance:admin      (provisioning events, paged)

GET    /api/instance/organisations/{id}/identity                  instance:admin      (the organisation's connection, or none)

/scim/v2/*                                                        delegated: scim    (bearer token → connection)
```

The organisation identity screen is a view over the same `identity-connections` routes
filtered to `organisation_id`; there is one implementation.

<a id="identity-provisioning-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| After token validation, Entra's email-like claim has a domain bound to another connection | Refused `409` by the deny-only collision check; provisioning event `request.denied`; administrator notified. The domain never switches connection or organisation |
| Token used after rotation | `401`; provisioning event `auth.failed`; counted against the anonymous rate class |
| Two connections claim the same organisation | Refused at save — one active customer connection per organisation in the first release |
| Connection disabled or deleted while users have sessions | Disabling or deleting an identity connection **revokes every session issued through that connection immediately**, retires only that connection's external grants, recomputes affected effective memberships, then invalidates authority; direct and other-connection grants remain. New logins are refused; SCIM calls return `403 connection_disabled`. Ordinary configuration edits while enabled do not revoke sessions. An explicit `max_role_rank` decrease immediately retires only that connection's above-ceiling grants and recomputes stored authority; existing sessions remain valid under the cache/session distinction in `IP-22`. |
| Connection deleted | Pending action (typed name + step-up); external identities are kept, marked orphaned; people are **not** deactivated automatically — the administrator chooses |
| Entra sends `active=false` for the last instance administrator | Deactivated like anyone else — break-glass is the CLI, not an exception in SCIM |
| Group mapping disabled, changed, or its role is deleted | Retire grants from that mapping immediately, recompute effective membership, then invalidate authority cache; OIDC re-enable requires later validated same-connection OIDC evidence; SCIM re-enable requires later authenticated same-connection SCIM evidence; opposite-source updates never restore grants |
| Two external grants at the highest rank have different role ids | Fail closed for that scope: no effective membership is materialized until an administrator resolves the mapping conflict; do not choose by role id or union capabilities |
| OIDC groups absent, malformed, or overage on a valid token | Retire only that identity's previous OIDC group grants; retain only permitted JIT default and independent valid grants; warn on overage; no Graph query |
| Entra admission fails for an existing JIT-disabled identity | A valid protocol token missing the exact configured app role or signed `acct=0` denies a new session and retires only that identity's OIDC/JIT grants; invalid/unverified tokens or invalid server configuration mutate no grants; direct/SCIM/other-connection grants remain |
| Enabled agent connection lowers `max_role_rank` below active grants | Retire only that connection's JIT/OIDC/SCIM grants above the new ceiling and recompute effective authority in the config-version transaction; direct/other-connection grants survive; sessions remain valid, with the 30-second cache fallback |
| Concurrent OIDC login and SCIM group removal affect one person/scope | Use IP-22’s total organisation→workspace→person→role→connection→mapping/SCIM-connection→identity→projection→mutated-grant/history order; rediscover/re-read closure under lock and retry the full transaction if it expands; commit source-specific grant deltas and one recomputed effective row atomically |

<a id="identity-provisioning-out-of-scope-first-release"></a>
### Out of scope (first release)
One more rule belongs with these, because it is the reason several of them can be simple:

- `IP-33` **A person belongs to exactly one organisation, and email is not an identity
  key.** The agent portal serves the internal staff organisation; a customer connection
  serves exactly one customer organisation (`IP-1`). A human who is both a staff member and
  a customer contact has **two `person` rows** and may use **the same address for both** —
  they are keyed `(identity_connection_id, subject)` and are never linked, which is `IP-18`
  applied rather than contradicted. Staff who need the customer's view use God Mode
  impersonation, not a second account. A contact at two customer organisations is a
  recorded limitation, not a schema to redesign
  ([multi-tenancy.md](#pending-01-architecturemulti-tenancy-identity-across-tenants)).

SCIM `/Bulk`; generic SCIM for every provider (build standards-based, validate against
Entra, then extend provider by provider — Okta, Keycloak, Google Workspace, generic OIDC
are future); customer self-service IdP configuration; SAML; LDAP; nested-group resolution;
a Microsoft Graph `memberOf` lookup on group-claim overage (`IP-28` ignores the claim
instead); a customer-role model richer than the single customer role.

<a id="identity-provisioning-testing"></a>
### Testing

`tests/api-integration/identity/` — each named for a required acceptance case; exercise local protocol fixtures and **a real Microsoft Entra test tenant before P3 identity acceptance** (the gate is stated in [phases.md](#pending-07-planningphases-p3--portal-and-identity)
and [security-model.md](#pending-01-architecturesecurity-model-testing-security)). Also
listed in [testing-strategy.md](#pending-04-engineeringtesting-strategy).

```
01-agent-oidc-staff-only-agent-portal.test.ts — a validated agent login reconciles only its selected connection
   within agent scope
02-customer-oidc-bound-to-one-organisation.test.ts — a validated customer login reconciles only its selected
   connection and persisted organisation
03-portal-isolation-both-directions.test.ts — login reconciliation cannot cross portals or let callback input switch
   its source
04-scim-token-cannot-touch-other-organisation.test.ts — OIDC/SCIM mappings cannot cross tenant scope
05-no-user-controlled-tenant-selection.test.ts — also rejects JIT for wrong `iss`/`tid`/`aud`,
   missing/malformed `oid`, without this connection's exact required app role, with
   missing/malformed `acct` or `acct=1`, and for an unapproved provider; a role from another
   connection cannot satisfy the selected connection; typed-domain routing binds the
   selected connection, portal and persisted organisation into state, and callback
   email-like claims cannot change them or link by email. It also proves a JIT-disabled
   Entra connection admits an already linked invite/SCIM identity only with the configured
   exact app role and signed `acct=0`, while JIT creation stays disabled; malformed or
   missing server configuration fails closed. Same-connection subject matching
   follows IP-19; a post-validation domain collision may deny but a domain match never
   admits. Browser assertions capture the complete unauthenticated flow for a bound and an
   unbound domain: initial response, headers (including `Location` and cookies), navigation,
   and next screen. They assert the permitted domain-to-SSO-binding/public-IdP-destination
   disclosure and prohibit organisation/connection inventory, names, ids, discovery
   configuration, claim mappings, secrets, and a TaskDesk user-account-existence signal.
   These are planned subcases, not additional acceptance tests; no current test or run is
   claimed. Repeat login on both JIT-enabled and JIT-disabled Entra connections rechecks the
   exact app role and `acct=0`; a valid negative admission retires only this identity's
   OIDC/JIT grants, while an invalid/unverified token or invalid server configuration
   mutates no grant.
06-customer-connection-cannot-create-staff-or-authority.test.ts — external grant writers refuse foreign scope,
   staff-side movement, `instance:admin` and `sees_all`
07-scim-create-scoped-person.test.ts — same- and cross-connection conflicts return the same generic 409; immutable
   subject/externalId resolves within the connection and each SCIM grant has separate source-ledger linkage
08-scim-filter-username-externalid-listresponse.test.ts
09-scim-patch-cannot-alter-tenant-reach-authority.test.ts — mapping and SCIM writes cannot change tenant, reach,
   side or forbidden authority
10-scim-deactivate-revokes-sessions-and-keys-preserves-history.test.ts — retire all external grants globally; direct
   grants follow `end_memberships`/`keep_memberships` without provenance relabeling
11-scim-reactivate-no-duplicate-no-prohibited-roles.test.ts — re-derive from current mappings; never revive revoked
   history or duplicate a person/membership
12-group-maps-only-to-permitted-role-and-scope.test.ts — OIDC object-id and SCIM mappings obey
   scope/rank/forbidden-role guards; two group sources project one role; equal-rank distinct-role conflict fails
   closed; includes PostgreSQL concurrent OIDC login, SCIM removal, connection edits and role edits for one
   person/scope, asserting one effective membership and source-specific final grants; rejects re-enable by the
   opposite source; proves JIT disable/default-role or target change retires only that connection's old JIT grant
   without revoking the session and re-enable waits for fresh same-connection evidence; and proves an enabled
   connection ceiling decrease and role-rank increase/swap across multiple referencing connections retire only
   invalid external grants and recompute the winner even when nothing retires
13-nothing-grants-instance-admin-automatically.test.ts — direct admin/`sees_all` survives group removal; external
   mappings cannot grant either or overwrite a direct role; allowed role-capability edits affect direct and
   external holders after cache invalidation, while forbidden resulting external capabilities are rejected
14-token-rotation-invalidates-old-and-never-leaks.test.ts — token rotation is unchanged and SCIM credentials cannot
   prove OIDC identity
15-oidc-protocol-failures-block-sign-in.test.ts — negative subcases include PKCE mismatch,
   replayed, wrong-portal and expired state, nonce mismatch, and missing/nonmatching Entra
   admission on both JIT-enabled and JIT-disabled identities; these are subcases, not
   additional acceptance tests. Invalid protocol claims do not sweep grants; a valid negative
   admission retires only that identity's OIDC/JIT grants; absent/overage groups on a valid
   admitted token retire only OIDC group grants, leaving permitted JIT and independent grants
16-same-email-second-idp-does-not-autolink.test.ts — explicitly linked connections reconcile and retire only their
   own grants; opposite-source evidence cannot re-enable or reconcile another grant source
17-every-identity-event-is-audited.test.ts — grant add/retire, mapping, role/config transition and denial evidence
   is safe and contains no raw claim list; provisioning/audit/outbox writes share the transaction under AU-14/EV-1,
   with outbox failure rolling back grants/projection and audit failure following its nested-savepoint exception
18-placeholder-claim-requires-local-verification.test.ts — placeholder claim cannot acquire an OIDC grant or bypass
   subject binding
19-scim-discovery-documents.test.ts — discovery behavior is unchanged
20-scim-pagination.test.ts — pagination behavior is unchanged
21-scim-bad-token-401.test.ts — unauthenticated SCIM input causes no grant mutation
22-entra-scim-quirks.test.ts — protocol tolerance does not create grant evidence from malformed/unauthenticated
   input
23-connection-disable-revokes-sessions.test.ts — immediately retire only that connection's external grants and
   sessions, preserving direct/other-source grants; also covers the distinct enabled-connection rank-decrease
   transaction, JIT disable/default-role/target transitions, source-scoped retirement, effective-role
   recomputation after zero or more retirements, cache invalidation, and non-revocation of still-valid sessions
24-oidc-no-autolink-config-read.test.ts — constructed config has no auto-link
25-session-revocation-immediate.test.ts — authority-cache invalidation and session revocation follow their distinct
   documented SLAs; rank/role-priority/capability and JIT policy changes update stored authority without revoking
   the session, outbox rollback leaves prior authority intact, and lost invalidation remains bounded by 30 seconds
```

**All 25 acceptance tests are P3 gate criteria and must pass against a real Microsoft Entra
test tenant.** Eight were added when `IP-26`…`IP-32` and the placeholder
rule were written: 18 asserts `IP-30` (an SSO login never claims a placeholder), 19 the
`ServiceProviderConfig` / `ResourceTypes` / `Schemas` documents Entra reads first, 20
`startIndex`/`count` pagination, 21 `401` on an absent or garbage bearer token (test 14
covers only rotation), 22 `IP-31`'s tolerated deviations together with `IP-4` still
refusing, 23 the edge-case row above, 24 reads the **constructed** better-auth configuration
to prove `accountLinking.enabled` is `false` rather than inferring it from behaviour, and 25
proves a revoked session fails on the next request — the SLA stated in
[auth-and-identity.md § Sessions](#pending-01-architectureauth-and-identity-sessions). The OIDC
reevaluation, grant-provenance, effective-role, SCIM global-deactivation, and concurrency
assertions above are subcases of these same 25 tests. Migration evidence must prove read-only
classification of every legacy membership before any DDL, backfill, constraint, or
projection; null or otherwise ambiguous `derived_from` must stop the whole migration
without partial change. Prove per-row owner-approved reconciliation with source evidence
and row digest, stale-manifest rejection, stable-snapshot cut-over, full transaction rollback
on failure, and successful backfill only after all rows are classified. Duplicate-row migration
rejection and provenance backfill evidence are required when the schema is implemented. This
is planned coverage only; none of these subcases is implemented or claimed as run here.

The OIDC mapping editor contract adds planned subcases to these existing names only: 04
checks same-connection ownership and masked 404 for foreign/missing mapping ids; 09 checks
strict DTO rejection, customer/staff scope and role guards, rank/authority ceilings, and
mapping/configuration stale `configVersion` conflicts; 12 checks mapping create without a grant,
source-only disable/change retirement, source-correct re-enable evidence, direct-role and
equal-rank tie preservation, and login/SCIM concurrency; 13 checks that mappings cannot
mint roles, capabilities, `instance:admin` or `sees_all`, and a ceiling decrease preserves
direct and other-connection grants; 15 checks that only complete
validated OIDC group evidence writes grants, malformed/absent/overage claims retire only
the selected identity's OIDC grants, and no Graph fallback or claim-driven write exists; 16
checks cross-connection isolation; 17 checks safe `group.mapping_changed` and audit
evidence; and 23 checks connection/mapping disable isolation. Tests 05/15 cover all-login
Entra admission for existing JIT-disabled identities and invalid-token no-mutation; tests
12/13/23/25 cover transactional max-rank decrease, source-only grant retirement and
projection, login/SCIM concurrency, cache invalidation,
and the still-valid-session distinction. Tests 12/16 cover opposite-source re-enable
exclusion. Tests 09/12 also cover required route-specific single-use step-up, unsupported
verifier fail-closed behavior, atomic
   version-and-proof consumption, and authority-cache invalidation. Test 12 also rejects a
   customer-owned or deleted workspace before grant creation and proves that a workspace
   that becomes ineligible cannot create a fresh grant at reconciliation; any prior
   mapping-derived grant is retired source-specifically. These remain planned
subcases under tests 04, 09, 12, 13, 15, 16, 17 and 23; the 25 test names are unchanged and
none of this evidence is claimed implemented or run.

The issue #561 SCIM administration DTO and PA-15 contract adds planned tests 09/12
for API-key/MCP/impersonation `403 session_required`, missing
or unavailable proof, wrong OIDC/MFA/metrics operation, wrong connection, changed canonical
body, stale parent version, expiry, replay and concurrent edit; failures make no mutation or
grant change, and stale CAS rolls proof consumption back. Cover all four body variants,
forbidden role/scope, absent `groups`, independent-source preservation, SCIM history
repair and later same-source re-evidence. The 25 named tests remain planned.

The closed profile attribute-map variant adds subcases to tests 08/09/17/22: only the
enumerated version-1 paths are accepted; each map is complete and bound to its own
`scim_admin_update` body/version/proof; API-key and stale/replayed proof fail without
mutation; malformed persisted maps fail provisioning closed; unique-primary versus
ambiguous email selection is deterministic; required fields reject atomically; optional
unmapped fields remain unchanged; a mapping edit changes future SCIM profile writes only
and cannot alter identity, tenant, role, group grant, audit secrecy or current sessions.
These remain planned subcases, not new acceptance-test names or passing claims.

The shared IP-22 invariant adds planned subcases to the same named tests: 12 covers JIT
disable/default-role change and re-enable evidence, stale/expanded lock-set retry (including a
new parent or reference discovered after locking), simultaneous mapping/provider/config edits,
role rank above one of two connection ceilings, rank swap/tie and no-retirement reprojection,
and SCIM pointer/history repair; 12/13/25 cover person deactivation racing OIDC/SCIM grant
writes in both commit orders, inactive-person refusal, customer organisation deactivation and
portal closure, agent owning-organisation/workspace deletion and restore in both orders, direct
grant dormancy/precedence, parent FK/new-reference conflicts and full-closure retry, and no
external-grant resurrection on restore/reopen; 13 covers direct precedence
and role-capability edits; 17 covers transactional existing event/audit/outbox behavior; and
23/25 cover source-only retirement, recomputation, cache timing and the still-live session.
The roles spec RL-9 carries matching planned role-PATCH coverage. These are requirements only;
they add no acceptance-test name and are not implemented or run.

The planned `tests/e2e/security/` negative E2E suite must cover state-changing GET,
cookie-authenticated unsafe requests with a missing or mismatched `Origin`/`Referer`, and
missing or mismatched double-submit tokens before the applicable security gate is claimed.
These remain required security coverage, not a new P3 acceptance test.

Plus the IDOR fuzz and tenant-isolation suites, which cover `/scim/v2/*` like any other
scoped surface.



### Grant-closure shipping precondition

The IP-22 cross-module sweep is mandatory before any role editor or person, workspace, organisation or `portal_access` lifecycle writer can alter IdP-derived authority. Every such writer must retire or reproject the affected external grants with the same current-validity and source-isolation contract; partial coverage in the identity module does not satisfy this precondition.

<a id="identity-provisioning-open-questions"></a>
### Open questions

*(None — the decision document of 2026-09-05 closed them.)*

<a id="identity-provisioning-related"></a>
### Related

- [Auth and identity](#pending-01-architectureauth-and-identity) · [Security model](#pending-01-architecturesecurity-model-scim--an-inbound-privileged-management-api)
- [RBAC](permissions.md) · [Data model](data-model.md) · [God Mode](feature-contracts-p4.md#god-mode) · [Proposed ADR 0015](#pending-01-architectureadr0015-membership-grant-provenance)
- [Customer portal](feature-contracts-p3.md#customer-portal) · [Data protection](#pending-05-operationsdata-protection)

## Pending foundation and decision references

Mappings to existing technical references provide maintained entrypoints; they do not certify full migration of every foundation clause. These linked contracts are not migrated by this feature reference. The rows identify the original contract, not an available archive dependency. Their normative details still require maintained migration; a link here does not close that gap. Current [requirements](../requirements.md) and [alignment](../alignment.md) retain the scope/precedence boundary.

<a id="pending-01-architectureadr0003-better-auth-primary"></a>
- **Pending maintained contract:** `docs/01-architecture/adr/0003-better-auth-primary.md`.
<a id="pending-01-architectureadr0004-two-portals-two-origins"></a>
- **Pending maintained contract:** `docs/01-architecture/adr/0004-two-portals-two-origins.md`.
<a id="pending-01-architectureadr0012-terminology-overlay"></a>
- **Pending maintained contract:** `docs/01-architecture/adr/0012-terminology-overlay.md`.
<a id="pending-01-architectureadr0014-limited-home-realm-disclosure"></a>
- **Pending maintained contract:** `docs/01-architecture/adr/0014-limited-home-realm-disclosure.md`.
<a id="pending-01-architectureadr0015-membership-grant-provenance"></a>
- **Pending maintained contract:** `docs/01-architecture/adr/0015-membership-grant-provenance.md`.
<a id="pending-01-architectureapi-design-oidc-group-mapping-administration"></a>
- **Pending maintained contract:** `docs/01-architecture/api-design.md#oidc-group-mapping-administration`.
<a id="pending-01-architectureapi-design-scim-administration-patch--issue-561-owner-contract"></a>
- **Pending maintained contract:** `docs/01-architecture/api-design.md#scim-administration-patch--issue-561-owner-contract`.
<a id="pending-01-architectureapi-design-scim-group-mapping-selector-options"></a>
- **Pending maintained contract:** `docs/01-architecture/api-design.md#scim-group-mapping-selector-options`.
<a id="pending-01-architectureapi-design-scim-token-rotation-and-revocation--pa-15-operations"></a>
- **Pending maintained contract:** `docs/01-architecture/api-design.md#scim-token-rotation-and-revocation--pa-15-operations`.
<a id="pending-01-architectureauth-and-identity"></a>
- **Pending maintained contract:** `docs/01-architecture/auth-and-identity.md`.
<a id="pending-01-architectureauth-and-identity-identity-resolution--the-important-rule"></a>
- **Pending maintained contract:** `docs/01-architecture/auth-and-identity.md#identity-resolution--the-important-rule`.
<a id="pending-01-architectureauth-and-identity-per-portal-binding"></a>
- **Pending maintained contract:** `docs/01-architecture/auth-and-identity.md#per-portal-binding`.
<a id="pending-01-architectureauth-and-identity-sessions"></a>
- **Pending maintained contract:** `docs/01-architecture/auth-and-identity.md#sessions`.
<a id="pending-01-architectureauth-and-identity-what-every-authoidc-plugin-must-do--the-protocol-floor"></a>
- **Pending maintained contract:** `docs/01-architecture/auth-and-identity.md#what-every-authoidc-plugin-must-do--the-protocol-floor`.
<a id="pending-01-architectureauth-runtime-reconfiguration"></a>
- **Pending maintained contract:** `docs/01-architecture/auth-runtime-reconfiguration.md`.
<a id="pending-01-architecturemulti-tenancy-identity-across-tenants"></a>
- **Pending maintained contract:** `docs/01-architecture/multi-tenancy.md#identity-across-tenants`.
<a id="pending-01-architecturesecurity-model-identity-provisioning-and-account-linking"></a>
- **Pending maintained contract:** `docs/01-architecture/security-model.md#identity-provisioning-and-account-linking`.
<a id="pending-01-architecturesecurity-model-scim--an-inbound-privileged-management-api"></a>
- **Pending maintained contract:** `docs/01-architecture/security-model.md#scim--an-inbound-privileged-management-api`.
<a id="pending-01-architecturesecurity-model-testing-security"></a>
- **Pending maintained contract:** `docs/01-architecture/security-model.md#testing-security`.
<a id="pending-02-designux-quality-gates"></a>
- **Pending maintained contract:** `docs/02-design/ux-quality-gates.md`.
<a id="pending-04-engineeringtesting-strategy"></a>
- **Pending required test-invariant extraction; current test workflow is [testing](../testing.md):** `docs/04-engineering/testing-strategy.md`.
<a id="pending-05-operationsdata-protection"></a>
- **Pending maintained contract:** `docs/05-operations/data-protection.md`.
<a id="pending-07-planningdecision-log"></a>
- **Pending product-decision/scope extraction (historical process is inactive):** `docs/07-planning/decision-log.md`.
<a id="pending-07-planningp3-portal-admission-contract-proposal"></a>
- **Pending product-decision/scope extraction (historical process is inactive):** `docs/07-planning/p3-portal-admission-contract-proposal.md`.
<a id="pending-07-planningphases-p0-two-entry-host-and-static-acceptance"></a>
- **Pending product-decision/scope extraction (historical process is inactive):** `docs/07-planning/phases.md#p0-two-entry-host-and-static-acceptance`.
<a id="pending-07-planningphases-p3--portal-and-identity"></a>
- **Pending product-decision/scope extraction (historical process is inactive):** `docs/07-planning/phases.md#p3--portal-and-identity`.
