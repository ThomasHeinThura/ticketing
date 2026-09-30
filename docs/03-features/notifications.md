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
| `budget.threshold_reached` | Holders of `budget:manage` on the project, plus its default assignee |
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

- `NO-5` Low-priority notifications may be batched into an hourly or daily digest, per
  user preference.
- `NO-6` A digest is one message summarising several events, linked, not a wall of
  forwarded notifications.
- `NO-7` Urgent events — SLA breach, approval expiring, direct mention — bypass digests.

## Delivery

- `NO-8` A notification is written to `notification` (in-app) and, per preference, to
  `outbox` for external delivery, **in the same transaction as the change**.
- `NO-9` `outbox-drain` delivers with retry and exponential backoff. Dead letters after
  six attempts and are visible in God Mode.
- `NO-10` Delivery failure never fails the originating request.
- `NO-11` Duplicate suppression: for notifications, compute `outbox.dedupe_key` as
  `notification:v1:` plus lowercase hex SHA-256 over the domain tag
  `taskdesk:notification-dedupe:v1`, a zero byte, then `event_kind`, `resource_type`,
  `resource_id`, `person_id`, and `channel` in that order. Encode each value as its exact
  UTF-8 bytes prefixed by its byte length as an unsigned 32-bit big-endian integer; do not
  trim, case-fold, or Unicode-normalize values. Store the notification
  recipient in `outbox.recipient_person_id` and the external plugin id in `outbox.channel`.
  Before the recent-success lookup, atomically acquire the unique
  `outbox_dedupe_reservation` keyed by `(recipient_person_id, channel, dedupe_key)`. A
  worker may insert a free key or atomically take over an expired reservation; every such
  acquisition sets a fresh random token. It may renew a live reservation only when the same
  candidate row and current token still own it; renewal preserves that token. Even a second
  worker presenting the same outbox row id cannot reacquire the live lease with a fresh
  token. A different row's active reservation means leave this candidate `pending`, set
  `next_attempt_at` to the lease expiry, and do not increment its delivery attempts.
  Row-level `FOR UPDATE SKIP LOCKED` is not sufficient to serialize different outbox rows
  with the same key.

  The reservation key is the 32-byte SHA-256 digest of the exact tuple
  `(recipient_person_id, channel, dedupe_key)`: hash the domain tag
  `taskdesk:outbox-dedupe-reservation:v1`, a zero byte, then each tuple value encoded as
  exact UTF-8 bytes prefixed by its byte length as an unsigned 32-bit big-endian integer.
  Do not trim, case-fold, or Unicode-normalize. Store the tuple alongside the digest and
  enforce tuple uniqueness; if a digest conflict contains different tuple values, fail
  closed without sending.

  All lease and five-minute-window comparisons use one authoritative PostgreSQL wall-clock
  sample per atomic operation. After any reservation-row lock wait, sample
  `clock_timestamp() AT TIME ZONE 'UTC'` exactly once and reuse it for acquire/takeover,
  renewal, completion predicates and their timestamp writes. The recent-success lookup is a
  separate post-acquisition statement with its own one-time sample and cutoff
  `delivered_at >= sample - interval '5 minutes'`. Do not use transaction-start `now()` or
  a statement timestamp sampled before a lock wait. This follows the `dbNowUtc()` convention;
  its current transaction-start implementation must be updated or replaced with the
  statement-local wall-clock expression during implementation.

  After acquiring the reservation, query for a **different** outbox row with the same three
  fields, `delivered_at >= sample - interval '5 minutes'`, and `id <> candidate.id`. The
  partial index on `(recipient_person_id, channel, dedupe_key, delivered_at desc)` where
  `delivered_at is not null` supports those equality and time-range predicates. If a match
  exists, set the candidate `state = 'suppressed'` without sending or setting its
  `delivered_at`, then release the reservation. Otherwise call the channel adapter with a
  **30-second absolute send deadline** covering connection setup and response wait; retries
  do not reset it. Pass an abort signal at the deadline and stop awaiting the adapter even if
  it ignores cancellation. While the call is active, renew the reservation every **15
  seconds** to an expiry **60 seconds from the renewal's PostgreSQL wall-clock sample**. A
  renewal requires the same owner row and current token and preserves that token. Adapter
  acceptance is considered success only when the worker commits `state = 'delivered'`,
  `delivered_at`, and reservation release in one transaction that still matches its current
  `owner_outbox_id` and unexpired random `lease_token`.

  A definite failed attempt leaves `delivered_at` null, updates the same row's retry state,
  and releases the reservation. A call that reaches its 30-second deadline is **ambiguous**,
  even if cancellation is requested: count the attempt, leave the row pending with its next
  attempt no earlier than the current lease expiry, and stop renewing. Do not release the
  reservation early, because a plugin may have accepted the request before hanging or
  ignoring cancellation. A healthy call completes or times out before the 60-second lease
  expires; a worker crash or hung call stops renewal, and another worker may reclaim only
  after expiry, with a fresh token. The old worker cannot commit success after reclaim. If a
  provider accepted a request but the process crashed, hung, or lost the response before the
  database commit, that external effect cannot be rolled back and a later retry may send
  again. This is at-least-once delivery across that window, not an exactly-once guarantee.
  Provider idempotency may use the stable outbox row id where available, but is not assumed.
  A retry of the same outbox row is still a retry; only a distinct row with a prior committed
  success is suppressed. The channel is part of the key, so the same event may still reach
  the person over two different channels. Fields, index,
  reservation, and drain behavior are defined in
  [data-model.md](../01-architecture/data-model.md#11-automations-notifications-integrations-audit)
  and [background-jobs.md](../01-architecture/background-jobs.md).

v1's notifications were fire-and-forget, so failures were invisible. The outbox is the
correction.

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
| `work_item` | `work_item.assigned`, `work_item.unassigned`, `work_item.mentioned` without `commentId`, `work_item.transitioned`, `work_item.escalated`, `work_item.due_soon`, `work_item.overdue`, `work_item.unblocked`, `sla.at_risk`, `sla.breached` | Work-item id/key; recheck current work-item and project reach under the [work-item read policy](work-items.md#permissions). |
| `comment` | `work_item.commented`; `work_item.mentioned` when payload has `commentId` | Comment id; require a live comment visible to the recipient, resolve its owning work item, then apply current work-item/project reach ([comments policy](comments-and-activity.md#permissions), `NO-19`). A description mention without `commentId` uses `work_item`. |
| `approval` | `approval.requested`, `approval.decided`, `approval.expiring`, `approval.expired`, `approval.withdrawn` | Approval id; resolve its work item and apply current work-item reach plus approval visibility. Customers may see only approvals addressed to them or raised by them ([approvals permissions](approvals.md#permissions)). |
| `submission` | `submission.received`, `submission.replied`, `submission.accepted`, `submission.declined`, `submission.withdrawn` | Submission id (resolve canonical `ref` where that is the event payload); apply current requester/organisation visibility and portal policy. Staff reach follows the triage queue; customer reach is limited to the requester's organisation and customer-visible submissions ([customer-portal permissions](customer-portal.md#permissions)). |
| `prerequisite` | `prerequisite.overdue` | Prerequisite id; resolve its project and apply current project reach ([project permissions](projects-and-engagements.md#permissions)). |
| `project` | `budget.threshold_reached` | Project id; apply current project reach and the event's `budget:manage` recipient rule. |
| `workspace` | `workspace.created` | Workspace id; apply the recipient's current workspace reach. |
| `webhook` | `webhook.auto_disabled` | Webhook id; require current `webhook:manage` reach or creator ownership, matching the event recipient rule. |
| `api_key` | `api_key.auto_disabled` | API-key id; require current owner identity; only the key owner is a recipient. |
| `automation` | `automation.run_failed` | Automation id; require current automation/project reach and creator ownership, matching the event recipient rule. |
| `pending_action` | `pending_action.requested`, `pending_action.executed` | Pending-action id; require requester ownership. Failure notifications are only for the requester. |
| `identity_connection` | `identity.provisioned`, `identity.deprovisioned`, `identity.request_denied`, `identity_connection.changed` | Identity-connection id when present; require current `instance:admin`. Do not expose identity-provider payloads or person data in the notification. |

These mappings name supported event classes; they do not grant permission. The event's
recipient rule and current resource reach must both pass. Set the discriminator and id from
the canonical event payload mapping. Missing or unknown `resource_type`, missing or deleted
resources, and event kinds without a mapping fail closed: do not create or return the
notification. Never fall back to recipient-only visibility.

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
POST   /api/notification                                      (self; integration notification)
PATCH  /api/notification/{id}/read                           (self)
PATCH  /api/notification/read-all                             (self)
PATCH  /api/notification/{id}/unread                          (self; target route for NO-15)
DELETE /api/notification/clear-all                            (self)
GET    /api/notification-preferences                         (self)
PUT    /api/notification-preferences                         (self)
PUT    /api/notification-preferences/workspaces/{workspaceId} (self; workspace reach checked)
DELETE /api/notification-preferences/workspaces/{workspaceId} (self; workspace reach checked)
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
`notification_preference_handoff`, and `outbox` with `dedupe_key`, recipient/channel, and
successful-delivery timestamp. Event keys and
notification fan-out flags are in [events.md](../01-architecture/events.md). Delivery,
handoff cleanup and digest scheduling are in
[background-jobs.md](../01-architecture/background-jobs.md).

## Edge cases

| Case | Behaviour |
| --- | --- |
| Recipient loses reach before delivery | Suppressed at delivery time, not just at creation |
| Task is unreachable, deleted, or in a deleted project | Omitted from inbox; read-all leaves it unread; individual mark-read returns not found |
| Another notification email link is opened before the handoff completes | The newest valid handoff replaces the browser's pending handoff cookie; reopening the earlier email starts its handoff again |
| Recipient's account is deleted | Outbox rows for them are dropped |
| Channel disabled after queueing | Queued messages are dropped with a log line |
| SMTP down for hours | Retries with backoff; God Mode shows the backlog |
| 500 watchers on one work item | Fan-out is chunked; digests are strongly encouraged |
| Mentioned person cannot see the work item | Not notified; the mentioner is warned at composition |
| Same event, two channels | Delivered to both. Not deduplicated across channels |

## Testing

The existing focused notification test,
`tests/api/notification-preferences/delivery-ssrf.test.ts`, covers outbound destination
guards only. It does not cover preference resolution, notification reach, delivery
transactionality, retries, deduplication, quiet hours, or customer privacy. Those remain
acceptance work. Add `tests/api-integration/notification-task-reach.test.ts` for hidden-task
list/read/read-all/create/delivery reach; `tests/api-integration/notification-preferences.test.ts`
for scoped preference resolution, outbox transactionality/retries, deduplication and quiet
hours; and `tests/api-integration/customer-notification-privacy.test.ts` for `NO-19` and
`NO-20`. The preferences integration suite must include a concurrent two-replica case: two
different pending rows share one recipient/channel/key and are claimed with `SKIP LOCKED`;
only one worker acquires the reservation and calls the provider, then commits
`delivered_at`; the other defers, acquires after release, observes that committed success,
and marks its row suppressed without a second provider call. Also cover active-lease deferral,
known-failure release/retry, and crashed-worker lease expiry with a stale-token commit
rejected. The reach suite includes, for every listed `resource_type`, a reachable recipient
and an unreachable or deleted resource; specifically cover comments and approvals through
their owning work item, submission requester/organisation reach, project, workspace, and
administrator/owner reach. It proves unreachable rows are omitted before counts, direct
access returns not found, and unknown, missing, or unmapped types are neither created nor
returned. It also includes configured-30-day read-purge/unread-retained and 90-day-default
cases described in `NO-17`. Test a normal adapter success before the deadline, a hung adapter
that ignores abort and is no longer awaited at 30 seconds, periodic lease renewal while
active, no early release on timeout, reclaim only after expiry, a fresh takeover token, and
stale-token success rejection. A second worker presenting the **same** outbox row id while its reservation is live
must fail acquisition when presenting a fresh token and leave the first worker's token valid
for renewal and completion. A lock-delayed timing case must hold the reservation lock across
the lease expiry and across the five-minute success cutoff: after the lock is released, the
operation must use a fresh post-lock DB wall-clock sample, take over an expired lease, and
not suppress a success that is now older than five minutes. Also assert expired reservation
cleanup and person/organisation hard-delete cascades remove every matching reservation row
and recipient-person identifier. A provider-accepted-but-uncommitted crash must assert
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

None.

## Related

- [Background jobs](../01-architecture/background-jobs.md) · [Realtime](../01-architecture/realtime.md)
- [Plugin architecture](../01-architecture/plugin-architecture.md)
