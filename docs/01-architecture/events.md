# Domain events — the canonical catalogue

**One list.** Every event the system emits is defined here and nowhere else.
[Automations](../03-features/automations.md) subscribe to it as triggers,
[webhooks](../03-features/webhooks-and-api-keys.md) deliver it outward, and
[notifications](../03-features/notifications.md) fan it out to people. Those three documents
link here; they do not restate the list. `outbox.kind`, `webhook.events[]` and
`notification_preference.event_kind` all draw from the keys below, and a CI test asserts
the enum in `packages/domain/src/events/` equals this table.

Added 2026-09-05 because the three specs had drifted into three incompatible vocabularies —
see [review-2026-09-05.md](../07-planning/review-2026-09-05.md).

## Envelope

Every event, internally, is:

```ts
interface DomainEvent<K extends EventKey, P> {
  id: string;               // evt_…, unique; the idempotency key for every consumer
  kind: K;                  // one of the keys below
  occurredAt: string;       // ISO 8601, UTC
  actor: { type: 'person' | 'automation' | 'system' | 'api_key'; id: string | null; name: string };
  scope: { organisationId?: string; workspaceId: string; projectId?: string };
  payload: P;               // per kind, below; always carries the entity's key and url
  causationId: string | null;   // the event that caused this one, if any
  depth: number;                // automation chain depth — AU-5 caps it at 5
  originAutomationId: string | null;  // set when an automation's action produced this event
}
```

The webhook envelope in [webhooks-and-api-keys.md](../03-features/webhooks-and-api-keys.md)
is a projection of this: `id`, `event` (= `kind`), `occurredAt`, `instance`, `actor`,
`data` (= `payload`). The internal-only fields (`causationId`, `depth`,
`originAutomationId`) are never sent outward.

`actor.type` is the reason [`activity`](data-model.md) and [`audit_log`](data-model.md)
carry `actor_type`: an automation acting, a scheduled job acting and an API key acting are
distinguishable from a person, in the event, in the activity stream and in the audit trail.

## Catalogue

Columns: **A** — available as an automation trigger · **W** — deliverable by webhook ·
**N** — fans out as a notification (default recipients in
[notifications.md](../03-features/notifications.md)).

### Work items

| Key | Emitted when | A | W | N | Payload, beyond key + url |
| --- | --- | :-: | :-: | :-: | --- |
| `work_item.created` | A work item is created, including from intake acceptance | ✅ | ✅ | — | `typeId`, `stateId`, `requesterId`, `source: portal\|agent\|api\|automation\|import` |
| `work_item.updated` | Any field other than state or assignee changes | ✅ | ✅ | — | `changes: [{ field, from, to }]`. Automations expose this as "a named field changed" — a **condition on `changes[].field`**, not a separate event |
| `work_item.transitioned` | State changes through the lifecycle engine | ✅ | ✅ | ✅ | `fromStateId`, `toStateId`, `workflowVersion`, `note?` |
| `work_item.assigned` | Assignee set or changed | ✅ | ✅ | ✅ | `assigneeId`, `previousAssigneeId` (null when newly assigned) |
| `work_item.unassigned` | Assignee cleared | — | ✅ | ✅ | `previousAssigneeId` |
| `work_item.commented` | A comment is added | ✅ | ✅ | ✅ | `commentId`, `visibility: public\|internal`. A customer never receives an `internal` fan-out — `NO-19` |
| `work_item.mentioned` | A person is @mentioned in a description **or** a comment | — | — | ✅ | `mentionedPersonId`, `commentId?`. *(Replaces the former duplicate `mention.in_comment`.)* |
| `work_item.escalated` | Priority is raised via the escalate action (customer or staff) | ✅ | ✅ | ✅ | `fromPriority`, `toPriority`. The row the Escalations report counts |
| `work_item.due_soon` | The reminders job finds a due date within the configured window | — | — | ✅ | `dueDate`, `hoursRemaining` |
| `work_item.overdue` | The reminders job finds a due date passed and the item open | — | ✅ | ✅ | `dueDate`, `hoursOverdue` |
| `work_item.deleted` | Soft-deleted | — | ✅ | — | `deletedBy` |

### SLA

| Key | Emitted when | A | W | N | Payload |
| --- | --- | :-: | :-: | :-: | --- |
| `sla.at_risk` | `sla-scan` finds a goal ≥ 75 % consumed | ✅ | ✅ | ✅ | `metric`, `dueAt`, `consumedPct` |
| `sla.breached` | `sla-scan` finds a goal past due | ✅ | ✅ | ✅ | `metric`, `dueAt`, `breachedByMinutes` |
| `sla.met` | A goal is satisfied before its due time | — | ✅ | — | `metric`, `metAt`, `marginMinutes` |

### Approvals

| Key | Emitted when | A | W | N | Payload |
| --- | --- | :-: | :-: | :-: | --- |
| `approval.requested` | An approval is created | — | ✅ | ✅ | `approvalId`, `approverId`, `kind`, `expiresAt` |
| `approval.decided` | Approved or rejected | ✅ | ✅ | ✅ | `approvalId`, `decision`, `note?` |
| `approval.expiring` | `reminder-scan` reaches 50 % / 90 % of the window | — | — | ✅ | `approvalId`, `expiresAt`, `pctElapsed` |
| `approval.expired` | `reminder-scan` passes `expiresAt` undecided | — | ✅ | ✅ | `approvalId` |

### Intake

| Key | Emitted when | A | W | N | Payload |
| --- | --- | :-: | :-: | :-: | --- |
| `submission.received` | A submission is created | ✅ | ✅ | ✅ | `ref`, `requestTypeId`, `organisationId` |
| `submission.replied` | Either side posts to the submission thread | — | — | ✅ | `ref`, `by: customer\|staff` |
| `submission.accepted` | Triage converts it to a work item | — | ✅ | ✅ | `ref`, `workItemKey` |
| `submission.declined` | Triage declines, with a reason | — | ✅ | ✅ | `ref`, `reason` |
| `submission.withdrawn` | The customer withdraws before triage (`CP-15`) | — | ✅ | ✅ | `ref` |

### Projects, prerequisites, budgets

| Key | Emitted when | A | W | N | Payload |
| --- | --- | :-: | :-: | :-: | --- |
| `project.created` | A project or managed service is created | — | ✅ | — | `key`, `kind` |
| `project.archived` | Archived | — | ✅ | — | `key` |
| `prerequisite.overdue` | The reminders job finds a blocking prerequisite past due | — | ✅ | ✅ | `prerequisiteId`, `dueDate` |
| `budget.threshold_reached` | Actual + committed crosses 75 % or 90 % of planned | — | ✅ | ✅ | `budgetId`, `threshold`, `currency` |

### Platform

| Key | Emitted when | A | W | N | Payload |
| --- | --- | :-: | :-: | :-: | --- |
| `webhook.auto_disabled` | A webhook fails continuously for 24 h (`WH-7`) | — | — | ✅ | `webhookId`, `lastError` |
| `api_key.auto_disabled` | A key exceeds its burst threshold (MCP edge case) | — | — | ✅ | `apiKeyId`, `reason` |
| `automation.run_failed` | An automation action throws | — | — | ✅ | `automationId`, `runId`, `error` |

### Not events

- **`schedule`** — the automation trigger "a cron expression, evaluated against a filter"
  is a *scheduler entry*, not a domain event: the `croner` job evaluates the filter and
  invokes the rule directly. It appears in the automations trigger picker and nowhere in
  this catalogue.
- **`work_item.field_changed`** — not a key; it is `work_item.updated` with a condition on
  `changes[].field`. Kept as the automation picker's label, resolved to `work_item.updated`
  when the rule is saved.

## Rules

- `EV-1` An event is written to `outbox` **in the same transaction** as the change that
  caused it. There is no fire-and-forget path — see [data model](data-model.md).
- `EV-2` Consumers are idempotent on `id`. A retried delivery, a replayed webhook or a
  re-drained outbox row must not produce a second notification, a second automation run,
  or a second webhook side effect.
- `EV-3` `depth` increments on every event an automation's action produces; a rule does not
  fire on an event whose `originAutomationId` is itself (`AU-5`), and nothing fires past
  `depth = 5`.
- `EV-4` Adding a key is additive and needs a decision-log entry; renaming or removing one
  is a breaking change under [api-design.md](api-design.md)'s versioning policy, because
  `webhook.events[]` and `notification_preference.event_kind` store the key.
- `EV-5` A customer-facing fan-out (a notification to a `customer`-side person) never
  carries internal comment content, staff names on internal activity, or SLA policy
  internals — the projection for customers is the portal's, per
  [customer-portal.md](../03-features/customer-portal.md).

## Related

- [Data model](data-model.md) · [Background jobs](background-jobs.md) · [Realtime](realtime.md)
- [Automations](../03-features/automations.md) · [Webhooks and API keys](../03-features/webhooks-and-api-keys.md) · [Notifications](../03-features/notifications.md)
