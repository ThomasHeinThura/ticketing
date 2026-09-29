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
  The signed, single-purpose token binds `purpose: notification_pref`, the recipient,
  `event_kind`, channel, scope and optional `scope_id`, and expires after 30 days. Opening
  the link never changes a preference: `GET` validates it and opens the authenticated
  preference screen preselected to that setting; a change takes effect only after the
  recipient explicitly saves while authenticated as that person.
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
- `NO-11` Duplicate suppression: for notifications, compute `outbox.dedupe_key` from
  `event_kind + resource_type + resource_id + person_id + channel`. At drain time, suppress
  a new row when a matching notification delivery succeeded in the previous five minutes.
  Retries of that same outbox row use its retry state and do not count as a duplicate. The
  channel is part of the key, so the same event may still reach the person over two
  different channels. The key and drain behavior are defined in
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
  retention period (90 days by default; configurable in God Mode).

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

| Action | Policy |
| --- | --- |
| Read, clear, or change read state for own notifications | Authenticated self; recipient id is taken from the session |
| Create an integration notification for self | Authenticated self; recipient id is taken from the session |
| Read or change own notification preferences | Authenticated self; workspace/project scopes are validated against reach |
| Configure or test instance notification plugins | `instance:manage_plugins` |
| Inspect, requeue, or discard external deliveries | `instance:admin` |

## Screens

Notifications inbox at `/agent/notifications`; scoped preferences under
`/agent/settings/profile/notifications` and portal `/portal/account`; God Mode channel
configuration at `/agent/god-mode/notifications`;
delivery operations at `/agent/god-mode/deliveries`. Workspace and project choices are
per-person preference scopes on the profile screen, not administrator-managed rule screens.

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
POST   /api/instance/plugins/{id}/test                        instance:manage_plugins
GET    /api/instance/deliveries                               instance:admin
POST   /api/instance/deliveries/{id}/requeue                  instance:admin
DELETE /api/instance/deliveries/{id}                          instance:admin
```

The mark-unread route is a target route required by `NO-15`; it must use the same recipient
and task-reach checks as mark-read. Project preference overrides use the same per-person
scope model and are target routes; both are not yet implemented.

## Data

The canonical fields and constraints are in
[data-model.md §11](../01-architecture/data-model.md#11-automations-notifications-integrations-audit):
`notification`, scoped `notification_preference`, and `outbox` with `dedupe_key`. Event keys
and notification fan-out flags are in [events.md](../01-architecture/events.md). Delivery
retry and digest scheduling are in [background-jobs.md](../01-architecture/background-jobs.md).

## Edge cases

| Case | Behaviour |
| --- | --- |
| Recipient loses reach before delivery | Suppressed at delivery time, not just at creation |
| Task is unreachable, deleted, or in a deleted project | Omitted from inbox; read-all leaves it unread; individual mark-read returns not found |
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
`NO-20`.

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
