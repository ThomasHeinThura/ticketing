# Notifications

- **Stage:** P4 (in-app inbox in P1)
- **Status:** ⬜
- **Feature flag:** always on; channels are plugins
- **Depends on:** plugin architecture, background jobs

## Purpose

Tell people what they need to know, through the channel they want, without becoming noise
they learn to ignore.

The failure mode is over-notification. A product that emails on every change trains people
to filter it, and then the one message that mattered is missed too.

## Channels

External channels are `notify.*` plugins, configured in God Mode. The `in_app` channel is
the built-in exception: it is always on and is not a plugin. An administrator decides
which external channels exist on this instance; each person decides which they use.

| Channel | Notes |
| --- | --- |
| **In-app** | Always on. Cannot be disabled |
| **Email** | SMTP plugin — core; sign-in codes and invitations depend on it |
| **Webhook** | Generic signed JSON POST — core, P4 |
| **Microsoft Teams → Slack → Telegram → Viber** | **Future, in that priority order** (decided 2026-09-05; not in the three-to-four-month scope). kaneo's inherited Slack/Discord/Telegram routers are removed at fork |
| **Discord / ntfy / Gotify** | Future, unprioritised |

## Events

The event keys are the **N** column of the canonical catalogue in
[events.md](../01-architecture/events.md) — this document owns only the **default
recipients** per event, never the list of events itself. `notification_preference.event_kind`
stores these keys. `work_item.mentioned` covers mentions in descriptions and comments alike;
there is no separate `mention.in_comment` event. Escalation timing and stakeholder order
follow [SLA-17](sla.md#behaviour), with the stop conditions specified by `NO-22` below.

| Event | Default recipients |
| --- | --- |
| `work_item.assigned` | The new assignee |
| `work_item.unassigned` | The previous assignee |
| `work_item.mentioned` | The mentioned person |
| `work_item.commented` | Watchers, assignee, requester (public comments only for customers — `NO-19`) |
| `work_item.transitioned` | Watchers, assignee, requester |
| `work_item.escalated` | Assignee, project leads |
| `work_item.due_soon` | Assignee |
| `work_item.overdue` | Assignee, then the escalation path (walked per `NO-22`) |
| `sla.at_risk` | Assignee, project leads |
| `sla.breached` | Assignee, project leads, then the escalation path |
| `approval.requested` | The approver |
| `approval.decided` | The requester, watchers |
| `approval.expiring` | The approver |
| `approval.expired` | The requester |
| `submission.received` | The triage queue owners |
| `submission.replied` | Whoever last handled it |
| `submission.accepted` | The requester |
| `submission.declined` | The requester, with the reason verbatim |
| `submission.withdrawn` | The triage queue owners |
| `prerequisite.overdue` | The prerequisite's owner |
| `budget.threshold_reached` | The project manager (`project.manager_id`) only, as required by [TC-18](time-and-cost.md#budgets); if no current manager can be resolved, do not substitute another recipient |
| `work_item.unblocked` | The assignee of the formerly blocked work item, as required by [RH-18](relations-and-hierarchy.md#blocking-behaviour) |
| `workspace.created` | The new workspace's owner |
| `pending_action.requested` | The requester, only when the event origin is `api` or `mcp`; no notification is sent for `web` origin |
| `approval.withdrawn` | The approver |
| `pending_action.executed` | The requester, on failure only |
| `identity.deprovisioned` | Instance administrators |
| `identity.request_denied` | Instance administrators |
| `identity_connection.changed` | Instance administrators |
| `webhook.auto_disabled` | The webhook's creator, plus holders of `webhook:manage` |
| `api_key.auto_disabled` | The key's owner |
| `automation.run_failed` | The rule's creator |

- `NO-22` **Escalation path.** Where a recipient list ends "then the escalation path", use
  the project's `stakeholder` rows ordered by `escalation_order`, as specified by
  [SLA-17](sla.md#behaviour). Notify the first immediately; notify each next stakeholder
  after the previous one's `escalation_wait_minutes` elapses while the work item remains in
  the triggering condition. A state change, assignment change, or staff comment stops the
  walk. A scheduled job advances it, so restarts do not lose a step.

## Preferences

Preferences are per person and resolve most-specific-first across three scopes. Within a
scope, each event can be configured per channel.

1. **Global** — per event and channel, for example "email me about assignments, not about
   comments".
2. **Workspace** — overrides global choices for one workspace.
3. **Project** — overrides workspace or global choices for one project.

`notification_preference.scope` is `global`, `workspace`, or `project`; `scope_id` is null
for global preferences and the corresponding workspace or project id otherwise. Its
`channel` is `in_app` or the configured plugin id (for example `notify.email`). The schema,
unique key, digest values, and per-person quiet-hours fields are defined in
[data-model.md](../01-architecture/data-model.md#11-automations-notifications-integrations-audit).

- `NO-1` Sensible defaults on account creation: in-app for everything, email for
  assignment, mention, approval and SLA breach only.
- `NO-2` Every notification email carries a link to the exact preference that produced it.
  The signed, single-purpose token binds `purpose: notification_pref`, its `audience`
  (`agent` or `customer`), the recipient, `event_kind`, channel, scope and optional
  `scope_id`, and expires after 30 days. Staff
  links open `/agent/settings/profile/notifications#preference_token={token}` and customer
  links open `/portal/account#preference_token={token}`. Opening the link never changes a
  preference.

  The landing page reads the fragment and immediately removes it from the address bar. It
  submits the signed token in a JSON body to the matching origin-specific public handoff
  route below **before any authentication redirect**. That route validates signature,
  purpose and expiry, stores only the verified selector in
  `notification_preference_handoff`, and sets a ten-minute
  `__Host-tdk_notification_preference_handoff` cookie with `Path=/`, no `Domain`, and
  `HttpOnly; Secure; SameSite=Lax`; its value is only an opaque random handoff handle. The
  raw signed token is not persisted. The handle is not an authentication credential and
  reveals no recipient or preference data. The browser must never put the signed token in
  browser storage, a query string, sign-in return URL, referrer, analytics event or
  application log. The public POST returns the same generic accepted response for valid
  and invalid tokens and does not read or change a preference.

  After authentication, the page calls the matching agent or portal handoff GET below.
  Each route requires that audience's session and matches its audience and person id to
  the stored token claims before returning the bound event, channel and scope with
  `Cache-Control: no-store`. The GET is read-only: it leaves the handoff row and cookie
  unchanged. A token with the wrong audience is rejected by the public handoff
  route and cannot be resolved through the other portal.
  The page preselects the setting, and the recipient may explicitly save it. A recipient
  mismatch returns the same generic not-found result without revealing token or preference
  details; the short-lived handoff remains available after the person signs out and signs
  in as the recipient. Invalid, expired or wrong-purpose tokens show a generic
  invalid-or-expired-link message. Only the recipient's
  explicit authenticated save changes a preference; the email-link flow never does.

- `NO-3` A person may set quiet hours. At each external-delivery drain, evaluate the
  recipient's current quiet-hours setting and defer non-urgent delivery until the next
  allowed time; preference changes therefore apply immediately. In-app notifications still
  arrive live. SLA breach and approval expiry ignore quiet hours.
- `NO-4` You are never notified about your own action.

## Digests

- `NO-5` Low-priority external notification candidates may be assigned to an hourly or daily
  digest from the recipient's effective event-time preference. A candidate is assigned once
  when its event transaction commits; later preference, timezone, or scope changes apply to
  future events and do not move existing candidates.
- `NO-6` A digest is one bounded summary message for one recipient, channel, tenant scope
  and closed time window. It links to authenticated in-app resources; it is not a wall of
  forwarded notifications. The group seals after its window closes, and its membership and
  canonical provider payload are fixed for that attempt.
- `NO-7` Urgent events — SLA breach, approval expiring, direct mention — bypass digests and
  have no `digest_id`.

Hourly windows span one local top-of-hour to the next; daily windows span one local midnight
to the next. Resolve the zone from `person.quiet_hours_timezone`, falling back to
`instance_setting.timezone`; store the resolved zone and UTC boundaries so DST changes are
unambiguous. A notification mutation creates the parent event, one inbox row per distinct
eligible person, and each external child candidate in the same transaction. Digest children
also attach to the matching collecting `notification_digest` group in that transaction.
The partition is recipient, channel, workspace, optional organisation, cadence and exact
window; it cannot mix recipients, providers or tenant scopes. The database wall clock decides
whether a target window is still open. If the window ended or the group was sealed while the
writer waited, it attaches the child to the next eligible window. A row lock serializes
membership insertion against sealing.

After the window ends, `outbox-drain` seals the group from `collecting` to `pending` and
freezes membership before any provider call. Before sending it rechecks current recipient
reach, enabled channel preference, and quiet hours. Lost reach or a disabled channel
suppresses that child. Quiet hours defer the whole group to the next allowed time. If no
eligible members remain, suppress the children and group without a provider call. The
summary is deterministic and bounded (for example, finite event-kind counts plus an
authenticated inbox link); it contains only a projection safe for that recipient. Unknown
resource mappings fail closed. For each dedupe tuple, order members by
`(created_at, id)`: suppress a later member within five minutes of an earlier included
candidate, while retaining distinct events outside that interval.

One group lease fences its provider call. Acquire reservations for the remaining dedupe
tuple keys in canonical key order, one per key, owned by a deterministic representative
child id. If any key is owned by another live reservation, release reservations acquired
for this call and the group lease, defer until that lease expires, and do not increment
attempts. Keep and renew the group lease and every member reservation through the provider
call; use a 30-second absolute deadline, renew every 15 seconds, and expire leases 60 seconds
after each post-lock PostgreSQL wall-clock sample. In one fenced pre-provider transaction,
revalidate the current unexpired group and reservation tokens, persist the canonical payload
hash, and increment the group's existing `attempts` exactly once after membership,
eligibility, dedupe and all reservations are accepted. Commit that transaction before calling
the adapter; provider I/O never runs inside a database transaction. Providers that support
idempotency receive
`(digest id, payload_hash)`. A retry with the same content reuses that identity. If reach or
eligible content changes, rebuild the safe summary and hash; an ambiguous earlier aggregate
may therefore be sent again, which is part of the at-least-once boundary.

Success is one transaction conditional on the current, unexpired group token and every held
reservation token. It marks only included children delivered with one completion clock
sample, marks members failing current checks suppressed, marks the group delivered, and
releases reservations. Definite failure leaves included children pending and releases
reservations and the group lease; it does not increment attempts again. A deadline or process
crash is ambiguous: stop renewal, keep reservations until expiry, and retry the same group no
earlier than both group and member lease expiry. The durable pre-provider increment already
accounts for that authorized attempt, including a crash before provider I/O or after provider
acceptance but before completion commits. Child attempts remain zero because children are not
sent independently. Six durable group attempt authorizations are the cap; recovery after an
expired sixth attempt marks the group and its remaining pending children dead under the safe
recovery fence and cannot authorize a seventh call. A stale group or reservation token cannot
authorize provider I/O or commit success after takeover.

## Delivery

- `NO-8` In the originating mutation transaction, write the business change, its single
  `outbox` event envelope, one `notification` inbox row for each distinct eligible person,
  and one `notification_delivery` child per eligible person and enabled external channel.
  Event-derived inbox and delivery uniqueness makes retries/replays idempotent. Digest
  preference candidates attach to their group in that same transaction. All these rows
  commit together or none do. Build recipients from the event's declared recipient rules,
  deduplicate overlaps (such as watcher, assignee and requester), exclude the actor, and
  apply customer-side visibility plus current resource reach before creating any inbox or
  delivery row. A persistence failure rolls back the business change.
- `NO-9` `outbox-drain` processes event consumers and external notification children with
  retry and exponential backoff. Immediately before provider I/O, after eligibility,
  membership, dedupe and reservation checks succeed, one fenced transaction durably
  increments the existing attempt counter for exactly one authorized provider attempt. The
  transaction commits before I/O; provider calls never run inside it. A notification child
  dead-letters after six durable attempt authorizations and is visible in God Mode; a digest
  uses its group's six-attempt limit. One child's state never stands in for another's. A
  contention defer, quiet-hours defer, suppression, or failed reservation claim consumes no
  attempt; lease renewal and post-outcome handling never increment or refund one. Backoff is
  selected using the already-incremented durable attempt number.
- `NO-10` Provider delivery failure never fails the originating request. Failure to persist
  the event, inbox, child or digest membership in the mutation transaction does roll back
  the business mutation, so the system cannot silently lose the notification candidate.
- `NO-11` For each external candidate, compute `notification_delivery.dedupe_key` as
  `notification:v1:` plus lowercase hex SHA-256 over domain tag
  `taskdesk:notification-dedupe:v1`, a zero byte, then `event_kind`, `resource_type`,
  `resource_id`, `person_id`, and `channel` in that order. Encode each value as exact
  UTF-8 bytes prefixed by its byte length as an unsigned 32-bit big-endian integer. Do not
  trim, case-fold, or Unicode-normalize. The stable delivery identity is the child `id`;
  `event_id` remains the source `DomainEvent.id`. One event can therefore create many
  independently leased recipient/channel children.

  Before recent-success lookup, atomically acquire the unique `outbox_dedupe_reservation`
  for `(recipient_person_id, channel, dedupe_key)`. Its 32-byte `reservation_key` is SHA-256
  over domain tag `taskdesk:outbox-dedupe-reservation:v1`, a zero byte, then the tuple values
  encoded with the same exact UTF-8 and unsigned 32-bit big-endian length-prefix rule. Store
  the tuple and enforce its uniqueness; a digest conflict whose tuple differs fails closed.
  Acquire a missing or expired key with a fresh random token and expiry 60 seconds after that
  operation's post-lock PostgreSQL wall-clock sample. A live key may only be renewed by the
  same `owner_delivery_id` and current token, preserving the token. Even a second worker
  presenting the same child id cannot rotate a live token. A different delivery's live key
  defers this child until lease expiry without incrementing attempts. Row-level
  `FOR UPDATE SKIP LOCKED` alone does not serialize different rows with the same tuple.

  Lease comparisons and writes use one PostgreSQL wall-clock sample after every reservation
  row-lock wait. The recent-success query is a separate post-acquisition statement with its
  own sample and cutoff `delivered_at >= sample - interval '5 minutes'`; never use
  transaction-start `now()` or a timestamp sampled before a lock wait. This is the required
  wall-clock behaviour; the current `dbNowUtc()` implementation uses transaction-start time
  and must be changed or bypassed for this protocol.

  After acquisition, suppress only when a **different delivery id** with the same recipient,
  channel and dedupe key has a committed `delivered_at` within five minutes. The retry of
  the same delivery id is excluded. Recheck current preference and resource reach immediately
  before sending; lost reach or a disabled channel suppresses the candidate without calling
  a provider, while quiet hours defer it to the next allowed time under `NO-3`. Newly
  enabled channels do not receive old events without an explicit replay contract. The
  Do not send the event envelope or internal resource content verbatim. Build a projection
  safe for the recipient only after the reach check; missing or unknown resource mappings
  fail closed. The candidate's event-time snapshot determines who and which channels were
  materialized; send time determines whether that candidate is still eligible. Never infer current authority
  from the stored recipient id, and fail closed for an unknown or missing resource mapping.

  The adapter has a 30-second absolute deadline including connection setup and response wait;
  retries do not reset it. Request cancellation and stop awaiting at the deadline even if
  the adapter ignores cancellation. Renew the reservation every 15 seconds to 60 seconds
  from the renewal's post-lock database wall-clock sample. Before calling the adapter, one
  fenced pre-provider transaction verifies eligibility and the unexpired owner/token
  reservation, then durably increments this child's existing `attempts` exactly once. It
  commits before I/O. A failed fence or transaction means no provider call and no consumed
  attempt. Success means the worker atomically marks this child delivered, sets `delivered_at`
  from the completion sample, and releases its reservation while the same delivery id/token
  still own an unexpired lease. A definite failure schedules the standard backoff using the
  already-durable attempt number and releases its lease; outcome handling does not increment
  again. Deadline, crash or unknown response is ambiguous: the pre-provider increment already
  consumed the attempt, so keep the reservation until expiry, stop renewal, and do not retry
  before expiry. A crash after authorization but before I/O still consumes that slot; this
  deliberate tradeoff bounds actual calls to at most six while allowing fewer calls than
  authorized slots. After six authorizations, mark this child dead; expiry or recovery of an
  ambiguous sixth attempt cannot authorize a seventh. A stale token cannot authorize I/O,
  complete, or release a new owner's lease.

  If a provider accepted before the process crashed, hung, or lost the response before the
  database commit, that external effect cannot be rolled back; a later retry can send again.
  Delivery is at-least-once, not exactly-once. A provider idempotency header may use the
  stable child id where supported, but correctness does not depend on provider support. Keep
  the one parent `outbox.event_id = DomainEvent.id`; child `id` is the per-delivery identity.

  Acceptance cases: a crash after the durable increment but before adapter I/O consumes one
  attempt; provider acceptance followed by a process crash before completion also consumes
  exactly that one attempt and remains at-least-once; repeated lease expiry/recovery after the
  sixth authorization ends dead without a seventh provider call for both direct children and
  digest groups. A failed pre-provider transaction rolls back without consuming an attempt.
  Contention, quiet-hours deferral, suppression, duplicate-reservation claim failure and lease
  renewal consume none. A worker whose owner/token fence is expired or stale cannot proceed to
  provider I/O. Digest member child counters stay zero and all frozen pending members become
  terminal with the group's sixth-attempt dead-letter transition.

The event envelope's processing state never means that a particular notification provider
succeeded. Notification children and digest groups own provider status and retention
independently. A parent replay must not create another inbox row or delivery child, and its
worker completion must be separate from child provider success. Webhook attempts remain
recorded per target in `webhook_delivery`.

v1's notifications were fire-and-forget, so failures were invisible. The event envelope plus
durable delivery children make candidate creation and provider outcomes inspectable.

## In-app inbox

- `NO-12` A bell in the topbar with an unread count.
- `NO-13` The inbox is a screen, not only a dropdown, with filters for unread, mentions
  and assignments.
- `NO-14` Every notification deep-links to the exact thing — the comment, not the work
  item.
- `NO-15` Mark one read, mark all read, and mark unread again.
- `NO-16` Arrives live over WebSocket. No polling.
- `NO-17` Read notifications are purged after the instance's configured notification
  retention period (90 days by default; configurable in God Mode). The daily
  `session-cleanup` job deletes only rows whose `read_at` is set and older than
  `instance_setting.notification_retention_days`; unread notifications are retained.

  **Acceptance:** with retention configured to 30 days, cleanup purges a notification read
  more than 30 days ago and retains an unread notification older than 30 days. A separate
  default-setting case verifies 90 days. Changing the configured value changes the cutoff on
  the next cleanup run; it never makes unread rows eligible.

## Customer notifications

- `NO-18` Customers are notified about their own requests only.
- `NO-19` Never about internal comments, internal activity or staff assignment changes.
- `NO-20` Notification content is customer-facing language throughout, with no internal
  terminology and no staff names.
- `NO-21` Customers have the same preference controls as staff for the smaller set of
  events that apply to them. In the portal, those controls live under `/portal/account`.

## Permissions

Notifications are always scoped to the recipient. There is no capability to read someone
else's notifications, and no administrative override — an administrator investigating a
delivery problem uses the audit log and the outbox, not another person's inbox.
Inbox list, read, and mutation operations also apply current reach filtering to each
notification's referenced resource. Unreachable or deleted resources are omitted before
pagination/counts; direct access to their notification returns not found. Workspace and
project preference routes validate the selected scope against the recipient's current reach.

`notification.resource_type` is a closed discriminator. Its supported event classes and
reach sources are:

| `resource_type` | Event class / event keys | Resource id and current reach source |
| --- | --- | --- |
| `work_item` | `work_item.assigned`, `work_item.unassigned`, `work_item.mentioned` without `commentId`, `work_item.transitioned`, `work_item.escalated`, `work_item.due_soon`, `work_item.overdue`, `work_item.unblocked`, `sla.at_risk`, `sla.breached` | Work-item id/key from the event envelope; for `work_item.unblocked`, this is the formerly blocked item, while `formerBlockerId` identifies the blocker only. Recheck current work-item and project reach under the [work-item read policy](work-items.md#permissions). |
| `comment` | `work_item.commented`; `work_item.mentioned` when payload has `commentId` | Comment id; require a live comment visible to the recipient, resolve its owning work item, then apply current work-item/project reach ([comments policy](comments-and-activity.md#permissions), `NO-19`). A description mention without `commentId` uses `work_item`. |
| `approval` | `approval.requested`, `approval.decided`, `approval.expiring`, `approval.expired`, `approval.withdrawn` | Approval id; resolve its work item and apply current work-item reach plus approval visibility. Customers may see only approvals addressed to them or raised by them ([approvals permissions](approvals.md#permissions)). |
| `submission` | `submission.received`, `submission.replied`, `submission.accepted`, `submission.declined`, `submission.withdrawn` | Submission id (resolve canonical `ref` where that is the event payload); apply current requester/organisation visibility and portal policy. Staff reach follows the triage queue; customer reach is limited to the requester's organisation and customer-visible submissions ([customer-portal permissions](customer-portal.md#permissions)). |
| `prerequisite` | `prerequisite.overdue` | Prerequisite id; resolve its project and apply current project reach ([project permissions](projects-and-engagements.md#permissions)). |
| `project` | `budget.threshold_reached` | Resolve the event's `budgetId` to the current `budget` row, then take that row's `project_id` as the notification resource id. Require the budget and project to exist and the recipient to retain current `project:read` reach. The only recipient is that project's `manager_id` per TC-18; missing budget/project, manager, or reach fails closed with no fallback recipient. |
| `workspace` | `workspace.created` | Workspace id; apply the recipient's current workspace reach. |
| `webhook` | `webhook.auto_disabled` | Webhook id; require current `webhook:manage` reach or creator ownership, matching the event recipient rule. |
| `api_key` | `api_key.auto_disabled` | API-key id; require current owner identity; only the key owner is a recipient. |
| `automation` | `automation.run_failed` | Automation id; require current automation/project reach and creator ownership, matching the event recipient rule. |
| `pending_action` | `pending_action.requested`, `pending_action.executed` | Pending-action id; require requester ownership. `requested` is supported only for `api`/`mcp` origins and `executed` only on failure; an unresolved requester fails closed. |
| `identity_connection` | `identity.deprovisioned`, `identity.request_denied`, `identity_connection.changed` | Identity-connection id from the event payload; require current `instance:admin`. Do not expose identity-provider payloads or person data in the notification. |
| `instance` | `audit_write_failed` (instance operational notification type; not a domain-event key) | The fixed id `singleton`; the current instance-admin capability is rechecked on every list/read operation. Payload contains only the closed audit operation and occurrence time. |
| `person` | `security_alert` (private account-security notice; not a domain-event key) | The affected user's own notification row; read only by that user. Payload is a closed kind with no credentials, factor material, or administrator note. |

`audit_write_failed` is the AU-14 operational notification. It is inserted only after the
failed audit append's savepoint/transaction has rolled back, in a separate transaction, for
each user who is an active staff person and currently has `user.role = 'admin'` (the current
instance-admin authority source). It is not written through the workspace-required outbox
and does not create a workspace. A failed notification insert is logged/counted and retried
by the caller's bounded retry path; it never changes the already-successful business
mutation. Instance-resource notification rows are returned only while the recipient still
has current instance-admin authority and an active staff person; losing or revoking that
authority hides the row immediately. They cannot be cleared or read through a caller-chosen
user id. The event has no external email delivery in this batch.

These mappings name supported event classes; they do not grant permission. The event's
recipient rule and current resource reach must both pass. Set the discriminator and id from
the canonical event payload mapping. Missing or unknown `resource_type`, missing or deleted
resources, and event kinds without a mapping fail closed: do not create or return the
notification. Never fall back to recipient-only visibility. The budget event carries only
`budgetId`, so implementations must resolve its project through the budget row; they must not
assume a `projectId` is present in the event payload.

| Action | Policy |
| --- | --- |
| Read, clear, or change read state for own notifications | Authenticated self; recipient id is taken from the session |
| Create an integration notification for self | Authenticated self; recipient id is taken from the session |
| Read or change staff member's own notification preferences | Agent session; recipient id is taken from the session; workspace/project scopes are validated against reach |
| Read or change customer's own notification preferences | Customer portal session; recipient id is taken from the session; customer-eligible global preferences only |
| Start an email-link handoff | Public, origin-specific endpoint; validates one-purpose signed token and stores a short-lived server-side handoff; no preference mutation |
| Resolve an email-link handoff | Matching agent or customer portal session; handoff recipient must equal session person; returns only its bound selector |
| Configure or test instance notification plugins | `instance:manage_plugins` |
| Inspect, requeue, or discard external deliveries | `instance:admin` |

## Screens

Notifications inbox at `/agent/notifications`; staff scoped preferences under
`/agent/settings/profile/notifications` and customer global preferences under
`/portal/account`; the email-link fragment is exchanged for a server-side handoff before
authentication, so neither page stores the signed token; God Mode channel
configuration at `/agent/god-mode/notifications`;
delivery operations at `/agent/god-mode/deliveries`. Workspace and project choices are
per-person preference scopes on the staff profile screen, not administrator-managed rule
screens.

## API

```
GET    /api/notification                                      (self)
POST   /api/notification                                      (self; integration notification; browser session only)
PATCH  /api/notification/{id}/read                           (self; browser session only)
PATCH  /api/notification/read-all                             (self; browser session only)
PATCH  /api/notification/{id}/unread                          (self; target route for NO-15)
DELETE /api/notification/clear-all                            (self; browser session only)
GET    /api/notification-preferences                         (self)
PUT    /api/notification-preferences                         (self; browser session only)
PUT    /api/notification-preferences/workspaces/{workspaceId} (self; workspace reach checked; browser session only)
DELETE /api/notification-preferences/workspaces/{workspaceId} (self; workspace reach checked; browser session only)
PUT    /api/notification-preferences/projects/{projectId}    (self; project reach checked)
DELETE /api/notification-preferences/projects/{projectId}    (self; project reach checked)
POST   /api/public/agent/notification-preference-handoffs     (public; signed token body; short-lived server-side handoff only)
GET    /api/notification-preferences/email-link-handoff       (agent self; matching recipient; read-only selector)
POST   /api/public/portal/notification-preference-handoffs    (public; signed token body; short-lived server-side handoff only)
GET    /api/portal/notification-preferences/email-link-handoff (portal self; matching recipient; read-only selector)
GET    /api/portal/notification-preferences                   (portal self; customer-eligible global preferences)
PUT    /api/portal/notification-preferences                   (portal self; customer-eligible global preferences)
POST   /api/instance/plugins/{id}/test                        instance:manage_plugins
GET    /api/instance/deliveries                               instance:admin
POST   /api/instance/deliveries/{id}/requeue                  instance:admin
DELETE /api/instance/deliveries/{id}                          instance:admin
```

The browser-session restriction on agent-side self writes is an AK-9 key-eligibility rule:
`self` limits the affected person but is not an API-key write capability. Reads remain
self-scoped and follow the key's stored read-capability subset. See `webhooks-and-api-keys.md`
AK-9 and the 2026-10-06 decision-log entry. Portal routes retain their separate customer
session contract.

The mark-unread route is a target route required by `NO-15`; it must use the same recipient
and task-reach checks as mark-read. Project preference overrides use the same per-person
scope model and are target routes; both are not yet implemented.

The two public handoff routes are target routes required by `NO-2`. Each accepts the signed
token in the JSON body, validates its signature, purpose, expiry and audience, stores only
its selector in `notification_preference_handoff`, and sets the opaque handle cookie. The
agent endpoint accepts only `audience: agent`; the portal endpoint accepts only
`audience: customer`. Require `Origin` to equal the configured application origin on every
request; when a session cookie is present, also require the CSRF double-submit token.
Rate-limit by source IP. Never log or echo the token. Valid and invalid token submissions
return the same generic `202` response with `Cache-Control: no-store`; only a valid token
sets the cookie and creates a handoff row. The matching authenticated agent or portal GET
route requires the corresponding session and matching audience and person id, then returns
only the bound selector with `Cache-Control: no-store`. The GET leaves the row and cookie
unchanged. A mismatch reveals no recipient or preference data; signing in as the
recipient within the handoff's ten-minute life can complete it. Invalid, expired,
wrong-purpose, wrong-audience and mismatch cases are generic. None of these routes changes
a preference; only the explicit authenticated `PUT` does.

The portal preference routes are distinct from the agent routes as required by
[api-design.md](../01-architecture/api-design.md#why-apiportal-is-separate). They use the
customer session and support only global preferences for events whose existing recipient
rules allow customer-side people, further restricted by `NO-18`–`NO-20` and `EV-5`. They do
not accept agent sessions, workspace/project scopes or staff-only event keys. Portal writes
cannot add a customer as a recipient or broaden notification visibility.

## Data

The canonical fields and constraints are in
[data-model.md §11](../01-architecture/data-model.md#11-automations-notifications-integrations-audit):
`notification`, scoped `notification_preference`, short-lived
`notification_preference_handoff`, the one-row-per-event `outbox` envelope,
`notification_delivery` children, `notification_digest` groups, and
`outbox_dedupe_reservation`. Event keys and notification fan-out flags are in
[events.md](../01-architecture/events.md). Delivery, sealing, retention and handoff cleanup
are in [background-jobs.md](../01-architecture/background-jobs.md).

## Edge cases

| Case | Behaviour |
| --- | --- |
| Recipient loses reach before delivery | Suppressed at delivery time, not just at creation |
| Task is unreachable, deleted, or in a deleted project | Omitted from inbox; read-all leaves it unread; individual mark-read returns not found |
| Another notification email link is opened before the handoff completes | The newest valid handoff replaces the browser's pending handoff cookie; reopening the earlier email starts its handoff again |
| Recipient's account is deleted | Their notification delivery children, digest groups and recipient-keyed reservations are deleted with the person; the event parent is eligible only after no retained child references it |
| Channel disabled after queueing | Queued children are marked suppressed when the channel is disabled |
| SMTP down for hours | Retries with backoff; God Mode shows the backlog |
| 500 watchers on one work item | The originating transaction atomically materializes all candidate children and digest membership; digest groups bound provider sends |
| Mentioned person cannot see the work item | Not notified; the mentioner is warned at composition |
| Same event, two channels | Delivered to both. Not deduplicated across channels |

## Testing

The existing focused notification test,
`tests/api/notification-preferences/delivery-ssrf.test.ts`, covers outbound destination
guards only. It does not cover preference resolution, notification reach, delivery
transactionality, retries, deduplication, quiet hours, or customer privacy. Those remain
acceptance work. Add `tests/api-integration/notification-task-reach.test.ts` for hidden-task
list/read/read-all/create/delivery reach; `tests/api-integration/notification-preferences.test.ts`
for scoped preference resolution, event/inbox/child transactionality, retries, deduplication,
digest sealing, reach and quiet hours; and
`tests/api-integration/customer-notification-privacy.test.ts` for `NO-19` and `NO-20`. The
preferences integration suite proves one event for two recipients and two external channels
creates exactly one parent, two inbox rows and four distinct children; replay creates no
duplicates, and one child result does not alter another. It must also include a concurrent
two-replica case: two
different pending rows share one recipient/channel/key and are claimed with `SKIP LOCKED`;
only one worker acquires the reservation and calls the provider, then commits
`delivered_at`; the other defers, acquires after release, observes that committed success,
and marks its row suppressed without a second provider call. Also cover active-lease deferral,
known-failure release/retry, and crashed-worker lease expiry with a stale-token commit
rejected. The reach suite includes, for every listed `resource_type`, a reachable recipient
and an unreachable or deleted resource; specifically cover comments and approvals through
their owning work item, submission requester/organisation reach, budgetId-to-project
resolution with manager-only audience, work_item.unblocked delivery to the blocked item's
assignee, project, workspace, and administrator/owner reach. For budget notifications,
prove budget managers and default assignees who are not the project manager receive nothing,
and missing budget/project/manager or lost project reach fails closed. For unblocked
notifications, prove the event envelope's item is the formerly blocked work item and no
recipient is invented when it has no assignee. Prove unreachable rows are omitted before
counts, direct access returns not found, and unknown, missing, or unmapped types are neither
created nor returned. Cover `pending_action.requested` for API and MCP origins to the named
requester, no notification for web origin, and fail-closed behavior when the requester cannot
be resolved; never substitute an administrator or event actor. It also includes configured-
30-day read-purge/unread-retained, 90-day-default, and legal-hold cases: person hold retains
that person's old read notifications, organisation hold retains notifications referencing
that organisation even for a staff recipient, and unheld rows remain eligible. Cases described
in `NO-17` also verify that unread notifications remain. Test a normal adapter success before
the deadline, a hung adapter that ignores abort and is no longer awaited at 30 seconds,
periodic lease renewal while active, no early release on timeout, initial acquire and expired
takeover both set expiry to 60 seconds after their operation's post-lock PostgreSQL
wall-clock sample, reclaim only after expiry, a fresh takeover token, and stale-token success
rejection. A second worker presenting the **same** delivery id while its reservation is live
must fail acquisition when presenting a fresh token and leave the first worker's token valid
for renewal and completion. A lock-delayed timing case must hold the reservation lock across
the lease expiry and across the five-minute success cutoff: after the lock is released, the
operation must use a fresh post-lock DB wall-clock sample, take over a logically expired
lease before daily cleanup physically deletes its row, and not suppress a success that is now
older than five minutes. Separately assert that daily `session-cleanup` physically deletes
expired rows and person/organisation hard-delete cascades remove every matching reservation
row and recipient-person identifier. Under open person or organisation holds, expired
reservation rows remain logically reclaimable and are still physically deleted by daily
cleanup. A provider-accepted-but-uncommitted crash must assert
at-least-once residual behavior rather than exactly-once delivery.

Add `tests/api-integration/notification-preference-link-handoff.test.ts` for expired and
wrong-purpose tokens, token redaction, audience mismatch, same-origin handoff cookies, auth
redirects, portal separation, recipient mismatch with no selector disclosure, repeatable
read-only matching resolution before expiry, and proof that the handoff never mutates a
preference.

Browser acceptance remains pending. Add `tests/e2e/notifications-inbox.spec.ts` for an
assignment arriving live in the inbox, and for opening an email preference link, verifying
that GET makes no change, then authenticating and explicitly saving the selected setting.

## Out of scope

- Workspace-admin-managed notification rules. Workspace and project preferences belong to
  each recipient.
- Future channels not listed as core in [plugin-architecture.md](../01-architecture/plugin-architecture.md#notify--notification-channels).

## Open questions

None. The prior draft's `work_item.unblocked` recipient gap is resolved by `RH-18`: it targets
the assignee of the formerly blocked work item. The initial direct-child outbox worker now
implements reservation fencing, retries, deadlines, and attempt limits behind injected
eligibility and provider seams. A transactional fan-out producer seam and a
`workspace.created` owner resolver exist, but are not wired to mutation producers. Other
canonical event-specific recipient/reach resolution is not implemented. This does not
complete Notifications: digest grouping/delivery, scheduler registration, the concrete
`notify.*` adapter registry, and the quiet-hours and destination contracts remain pending.
Send-time reach and preference evaluation exists in `current-eligibility.ts` and never
authorizes a send while quiet hours or the destination are unresolved. See
[background jobs](../01-architecture/background-jobs.md#outbox-delivery) for the implemented
worker boundary. Browser acceptance remains pending.

**Pre-wiring gates (must close before any producer or worker calls this runtime).** (1) The
inbox read paths (list, read, read-all, clear-all) apply current reach only to
`resource_type = 'task'` rows; extend the predicate to every registered fan-out resource type
(`work_item`, `comment`, `workspace`, `instance` and the rest), failing closed for unknown
types, and keep `instance` rows behind the instance-admin gate. (2) `approval` is excluded from
fan-out until the approvals slice lands its recipient and reach code. (3) The legacy
workspace delivery path checks reach once, with no banned/deactivated check and no recheck at
send time; move it to the identity-based `workspace:read` check. (4) `fanout.ts` has no
tests; add recipient, preference, digest-hook and self-exclusion coverage. (5) The reach
facts omit ancestor projects and the owner team, which only over-suppresses. (6) The
`notify.*` adapter must strip CR/LF and control characters from titles before using them in
a subject or header. The scheduler loop must also tolerate rows backed off for
`destination_unresolved`, `quiet_hours_unresolved`, `evaluator_error` and
`reservation_contention` (30 s, no attempt consumed). (7) A permanently failing evaluator is retried every 30 s forever (logged only as a
closed `jobs.failure` event); an age- or count-based dead-letter for `evaluator_error` is a
design change to be decided before wiring. (8) `notification_delivery` timestamp columns
default to `now()`, which a database session ahead of or behind UTC stores as local wall
clock; every writer must set UTC explicitly (fan-out does) until a migration changes the
defaults.

## Related

- [Background jobs](../01-architecture/background-jobs.md) · [Realtime](../01-architecture/realtime.md)
- [Plugin architecture](../01-architecture/plugin-architecture.md)
