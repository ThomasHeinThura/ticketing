# Notifications

- **Phase:** P4 (in-app inbox in P1)
- **Status:** ⬜
- **Feature flag:** always on; channels are plugins
- **Depends on:** plugin architecture, background jobs

## Purpose

Tell people what they need to know, through the channel they want, without becoming noise
they learn to ignore.

The failure mode is over-notification. A product that emails on every change trains people
to filter it, and then the one message that mattered is missed too.

## Channels

Every channel is a `notify.*` plugin, configured in God Mode. An administrator decides
which exist on this instance; each user decides which they use.

| Channel | Notes |
| --- | --- |
| **In-app** | Always on. Cannot be disabled |
| **Email** | SMTP plugin |
| **Webhook** | Generic signed JSON POST |
| **Slack / Teams / Discord** | Incoming webhook |
| **ntfy / Gotify** | Self-hosted push |

## Events

| Event | Default recipients |
| --- | --- |
| `work_item.assigned` | The new assignee |
| `work_item.unassigned` | The previous assignee |
| `work_item.mentioned` | The mentioned person |
| `work_item.commented` | Watchers, assignee, requester (public comments only for customers) |
| `work_item.transitioned` | Watchers, assignee, requester |
| `work_item.due_soon` | Assignee |
| `work_item.overdue` | Assignee, then the escalation path |
| `sla.at_risk` | Assignee, project leads |
| `sla.breached` | Assignee, project leads, then the escalation path |
| `approval.requested` | The approver |
| `approval.decided` | The requester, watchers |
| `approval.expiring` | The approver |
| `submission.received` | The triage queue owners |
| `submission.replied` | Whoever last handled it |
| `prerequisite.overdue` | The prerequisite's owner |
| `mention.in_comment` | The mentioned person |

## Preferences

Three levels, resolved most-specific-first.

1. **Per event, per channel** — "email me about assignments, not about comments".
2. **Per workspace** — "everything from Contoso Support, nothing from Internal IT".
3. **Per project** — an override within a workspace.

- `NO-1` Sensible defaults on account creation: in-app for everything, email for
  assignment, mention, approval and SLA breach only.
- `NO-2` Every notification email carries a working one-click link to the exact preference
  that produced it. Not to a preferences page — to *that setting*.
- `NO-3` A user may set quiet hours; non-urgent notifications queue until they end.
  SLA breach and approval expiry ignore quiet hours.
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
- `NO-11` Duplicate suppression: the same event to the same person through the same
  channel within five minutes is collapsed.

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
- `NO-17` Read notifications are purged after 90 days.

## Customer notifications

- `NO-18` Customers are notified about their own requests only.
- `NO-19` Never about internal comments, internal activity or staff assignment changes.
- `NO-20` Notification content is customer-facing language throughout, with no internal
  terminology and no staff names.
- `NO-21` Customers have the same preference control as staff, over the smaller set of
  events that apply to them.

## Permissions

Notifications are always scoped to the recipient. There is no capability to read someone
else's notifications, and no administrative override — an administrator investigating a
delivery problem uses the audit log and the outbox, not another person's inbox.

## Screens

Inbox; notification preferences under profile settings; per-workspace notification rules;
God Mode channel configuration with a test send.

## API

```
GET   /api/notifications                    (self)
POST  /api/notifications/{id}/read          (self)
POST  /api/notifications/read-all           (self)
GET   /api/notification-preferences         (self)
PATCH /api/notification-preferences         (self)
POST  /api/instance/notify/{channel}/test   instance:admin
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Recipient loses reach before delivery | Suppressed at delivery time, not just at creation |
| Recipient's account is deleted | Outbox rows for them are dropped |
| Channel disabled after queueing | Queued messages are dropped with a log line |
| SMTP down for hours | Retries with backoff; God Mode shows the backlog |
| 500 watchers on one work item | Fan-out is chunked; digests are strongly encouraged |
| Mentioned person cannot see the work item | Not notified; the mentioner is warned at composition |
| Same event, two channels | Delivered to both. Not deduplicated across channels |

## Testing

Unit: preference resolution across the three levels; duplicate suppression; quiet-hours
bypass rules.

Integration: notification and outbox rows written in the same transaction as the change;
outbox retry and dead-lettering; a customer never receives an internal-comment
notification.

E2E: assign a work item and see the in-app notification arrive live; change a preference
from an email link and confirm it took effect.

## Related

- [Background jobs](../01-architecture/background-jobs.md) · [Realtime](../01-architecture/realtime.md)
- [Plugin architecture](../01-architecture/plugin-architecture.md)
