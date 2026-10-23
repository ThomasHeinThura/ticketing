# Event contracts

Current event identifiers remain product contracts. Register native keys in the Catalogue
and implementation registry together. Published compatibility keys remain explicitly listed
until their callers migrate; do not invent additional compatibility keys.

## Envelope

Every event, internally, is:

```ts
interface DomainEvent<K extends EventKey, P> {
  id: string;               // evt_…, unique; the idempotency key for every consumer
  kind: K;                  // one of the keys below
  occurredAt: string;       // ISO 8601, UTC
  actor: { type: 'person' | 'automation' | 'system' | 'api_key'; id: string | null; name: string };
  scope:
    | { organisationId?: string; workspaceId: string; projectId?: string }
    | {};
  payload: P;               // per kind, below; always carries the entity's key and url
  causationId: string | null;   // the event that caused this one, if any
  depth: number;                // automation chain depth — AM-5 caps it at 5
  originAutomationId: string | null;  // set when an automation's action produced this event
}
```

The webhook envelope in [webhooks-and-api-keys.md](feature-contracts-p4.md#webhooks-and-api-keys)
is a projection of this: `id`, `event` (= `kind`), `occurredAt`, `instance`, `actor`,
`data` (= `payload`). The internal-only fields (`causationId`, `depth`,
`originAutomationId`) are never sent outward.

Instance-scoped envelopes use an empty `scope`. Only `pending_action.requested`,
`pending_action.decided`, `pending_action.executed`, and `identity.deprovisioned` may use it;
all other event keys require a workspace scope. This lets person deactivation and its
approval lifecycle remain instance-scoped even when the target has no workspace
memberships. Instance-scoped events are not visible to workspace-scoped consumers.

`actor.type` is the reason [`activity`](data-model.md) and [`audit_log`](data-model.md)
carry `actor_type`: an automation acting, a scheduled job acting and an API key acting are
distinguishable from a person, in the event, in the activity stream and in the audit trail.

## Catalogue

| Key | Emitted when | A | W | N | Payload, beyond key + url |
| --- | --- | :-: | :-: | :-: | --- |
| `work_item.created` | A work item is created, including from intake acceptance | ✅ | ✅ | — | `typeId`, `stateId`, `requesterId`, `source: portal\|agent\|api\|automation\|import` |
| `work_item.updated` | Any field other than state or assignee changes | ✅ | ✅ | — | `changes: [{ field, from, to, visibility: public\|internal }]`. Automations expose this as "a named field changed" — a **condition on `changes[].field`**, not a separate event. A customer or webhook consumer must drop an `internal` entry, the same way `work_item.commented`'s `visibility` works — `NO-19` |
| `work_item.transitioned` | State changes through the lifecycle engine | ✅ | ✅ | ✅ | `fromStateId`, `toStateId`, `workflowVersion`, `note?` |
| `work_item.assigned` | Assignee set or changed | ✅ | ✅ | ✅ | `assigneeId`, `previousAssigneeId` (null when newly assigned) |
| `work_item.unassigned` | Assignee cleared | — | ✅ | ✅ | `previousAssigneeId` |
| `work_item.commented` | A comment is added | ✅ | ✅ | ✅ | `commentId`, `visibility: public\|internal`. A customer never receives an `internal` fan-out — `NO-19` |
| `work_item.mentioned` | A person is @mentioned in a description **or** a comment | — | — | ✅ | `mentionedPersonId`, `commentId?`. *(Replaces the former duplicate `mention.in_comment`.)* |
| `work_item.escalated` | Priority is raised via the escalate action (customer or staff) | ✅ | ✅ | ✅ | `fromPriority`, `toPriority`. The row the Escalations report counts |
| `work_item.due_soon` | The reminders job finds a due date within the configured window | — | — | ✅ | `dueDate`, `hoursRemaining` |
| `work_item.overdue` | The reminders job finds a due date passed and the item open | — | ✅ | ✅ | `dueDate`, `hoursOverdue` |
| `work_item.deleted` | Soft-deleted | — | ✅ | — | `deletedBy` |
| `work_item.unblocked` | Its last open `blocked_by` relation closes or is removed ([relations-and-hierarchy.md](../contracts.md) `RH-18`) | — | ✅ | ✅ | `formerBlockerId` |
| Key | Emitted when | A | W | N | Payload |
| --- | --- | :-: | :-: | :-: | --- |
| `sla.at_risk` | `sla-scan` ([background-jobs.md](background-jobs.md)) finds an **open** goal ≥ 75 % consumed | ✅ | ✅ | ✅ | `metric`, `dueAt`, `consumedPct` |
| `sla.breached` | `sla-scan` finds an **open** goal past due | ✅ | ✅ | ✅ | `metric`, `dueAt`, `breachedByMinutes` |
| `sla.met` | The **transition into a `completed`-group state** (`WF-17`) finds the goal satisfied before its due time. Not `sla-scan` — an item that has just met its goal has `resolved_at` set and is outside the scan's candidate set | — | ✅ | — | `metric`, `metAt`, `marginMinutes` |
| `sla.missed` | The same transition finds the goal already past its due time — "closed after target" ([sla.md](../features.md)). The `missed` half of the pair `sla.met` completes; without it the sixth SLA state fires nothing | — | ✅ | — | `metric`, `dueAt`, `missedByMinutes` |
| Key | Emitted when | A | W | N | Payload |
| --- | --- | :-: | :-: | :-: | --- |
| `service_calendar.created` | A calendar is created; its event envelope is inserted into `outbox` in the same transaction | — | — | — | `calendarId`, `workspaceId`, `name`, `url` |
| `service_calendar.updated` | A calendar is updated; its event envelope is inserted into `outbox` in the same transaction | — | — | — | `calendarId`, `workspaceId`, `name`, `changedFields: [name\|timezone\|windows\|holidays]`, `url` |
| `service_calendar.deleted` | A service calendar is deleted after its pending-action approval rechecks that no project, SLA version, or work item references it; the event envelope is inserted into `outbox` in the same transaction | — | — | — | `calendarId`, `workspaceId`, `name`, `url` |
| Key | Emitted when | A | W | N | Payload |
| --- | --- | :-: | :-: | :-: | --- |
| `approval.requested` | An approval is created | — | ✅ | ✅ | `approvalId`, `approverId`, `kind`, `expiresAt` |
| `approval.decided` | Approved or rejected | ✅ | ✅ | ✅ | `approvalId`, `decision`, `note?` |
| `approval.expiring` | `reminder-scan` reaches 50 % / 90 % of the window | — | — | ✅ | `approvalId`, `expiresAt`, `pctElapsed` |
| `approval.expired` | `reminder-scan` passes `expiresAt` undecided | — | ✅ | ✅ | `approvalId` |
| `approval.withdrawn` | The requester withdraws an undecided approval (`AP-6`) — a fifth `approval.state`, not a decision, so it is not folded into `approval.decided` | — | ✅ | ✅ (the approver) | `approvalId`, `withdrawnBy`, `reason?` |
| Key | Emitted when | A | W | N | Payload |
| --- | --- | :-: | :-: | :-: | --- |
| `submission.received` | A submission is created | ✅ | ✅ | ✅ | `ref`, `requestTypeId`, `organisationId` |
| `submission.replied` | Either side posts to the submission thread | — | — | ✅ | `ref`, `by: customer\|staff` |
| `submission.accepted` | Triage converts it to a work item | — | ✅ | ✅ | `ref`, `workItemKey` |
| `submission.declined` | Triage declines, with a reason | — | ✅ | ✅ | `ref`, `reason` |
| `submission.withdrawn` | The customer withdraws before triage (`CP-15`) | — | ✅ | ✅ | `ref` |
| Key | Emitted when | A | W | N | Payload |
| --- | --- | :-: | :-: | :-: | --- |
| `project.created` | A project or managed service is created | — | ✅ | — | `key`, `kind` |
| `project.archived` | Archived | — | ✅ | — | `key` |
| `prerequisite.overdue` | The reminders job finds a blocking prerequisite past due | — | ✅ | ✅ | `prerequisiteId`, `dueDate` |
| `budget.threshold_reached` | Actual + committed crosses 75 % or 90 % of planned | — | ✅ | ✅ | `budgetId`, `threshold`, `currency` |
| Key | Emitted when | A | W | N | Payload |
| --- | --- | :-: | :-: | :-: | --- |
| `saved_view.created` | A saved view is created (search-and-saved-views.md SV-14) | — | — | — | `savedViewId`, `workspaceId`, `visibility` |
| `saved_view.updated` | A saved view's name, visibility, sharing, layout or query changes | — | — | — | `savedViewId`, `workspaceId` |
| `saved_view.deleted` | A saved view is deleted | — | — | — | `savedViewId`, `workspaceId` |
| `saved_view.pinned` | A person pins or unpins a view to their sidebar (SV-20) | — | — | — | `savedViewId`, `workspaceId`, `pinned` |
| Key | Emitted when | A | W | N | Payload, beyond key + url |
| --- | --- | :-: | :-: | :-: | --- |
| `workspace.created` | A workspace is created | — | — | ✅ | `workspaceId`, `workspaceName`, `ownerId`; a workspace-scoped domain event does not imply that an external subscription already exists |
| Key | Emitted when | A | W | N | Payload |
| --- | --- | :-: | :-: | :-: | --- |
| `webhook.auto_disabled` | A webhook fails continuously for 24 h (`WH-7`) | — | — | ✅ | `webhookId`, `lastError` |
| `api_key.auto_disabled` | A key exceeds its burst threshold (MCP edge case) | — | — | ✅ | `apiKeyId`, `reason` |
| `pending_action.requested` | A deletion, God Mode user-deactivation, or destructive MCP call was requested and is awaiting human approval (`PA-2`) | — | — | ✅ (the requester, when `origin` is `api` or `mcp`) | `key` (= `pendingActionId`), `url` (`/agent/settings/profile/pending-actions/{id}`), `pendingActionId`, `action`, `origin`, `targetType`, `targetCount`, `expiresAt` |
| `pending_action.decided` | Approved, denied, cancelled, expired or invalidated (`PA-6`–`PA-9`) | — | ✅ | — | `key` (= `pendingActionId`), `url` (`/agent/settings/profile/pending-actions/{id}`), `pendingActionId`, `outcome: approved\|denied\|cancelled\|expired\|invalidated`, `invalidationReason?` (present when outcome is `invalidated`; the stored PA-9 reason) |
| `pending_action.executed` | The approved action ran, or failed (`PA-6` step 5) | ✅ | ✅ | ✅ (on failure, the requester) | `pendingActionId`, `action`, `targetIds`, `outcome: executed\|failed`, `error?` |
| `identity.provisioned` | SCIM or JIT created or reactivated a person (`IP-10`, `IP-16`, `IP-19`) | — | ✅ | — | `identityConnectionId`, `personId`, `via: scim\|jit`, `organisationId?` |
| `identity.deprovisioned` | SCIM `active=false` / `DELETE /Users/{id}`, or the God Mode user-deactivation pending action deactivated a person (`IP-15`) | — | ✅ | ✅ (instance administrators) | `source: scim\|god_mode`, `identityConnectionId?`, `personId`, `sessionsRevoked`, `keysRevoked`, `membershipsEnded`, and, **God Mode source only**, `organisationId`, `externalIdentityIds[]`, `previousState`, `resultingAction` (the SCIM emitter does not send these); connection and external identity ids are present only when supplied by the originating provider |
| `identity.request_denied` | A SCIM or OIDC request was refused — forbidden attribute, cross-organisation, failed auth (`IP-4`, `IP-14`, `IP-18`) | — | — | ✅ (instance administrators) | `identityConnectionId`, `reason`, `resource?` |
| `identity_connection.changed` | A connection or its SCIM settings changed; a token was rotated or revoked (`IP-6`) | — | ✅ | ✅ (instance administrators) | `identityConnectionId`, `changes[]` (keys only, never values) |
| `import.chunk_completed` | An `import-run` job finished one chunk ([background-jobs.md](background-jobs.md)); a progress frame on the `instance` WebSocket topic, never delivered outward | — | — | — | `importRunId`, `chunk`, `chunks`, `rowsDone`, `rowsTotal` |
| `automation.run_failed` | An automation action throws | — | — | ✅ | `automationId`, `runId`, `error` |

## Inherited compatibility vocabulary

These inherited publishers remain supported migration inputs, not a second permanent model.
The first column alone registers emitted identifiers. Other columns explain existing scope.

| Emitted key | Target TaskDesk key | Compatibility status | Migration owner / stage |
| --- | --- | --- | --- |
| `comment.created` | `work_item.commented` | Compatible — "A comment is added" matches. Payload gap: no `visibility: public\|internal` | P1 |
| `comment.deleted` | *(none declared)* | Comment deletion has no target-model event; only creation (`work_item.commented`) is catalogued | P1 |
| `comment.updated` | *(none declared)* | Comment editing has no target-model event at all | P1 |
| `notification.created` | *(none — not a domain event)* | Internal plumbing: fires after any notification row is inserted, purely to push it over the realtime channel. Not one of this catalogue's domain events and not expected to become one | P1 |
| `task-relation.created` | *(none declared)* | `work_item_relation` exists in [data-model.md](data-model.md), but no relation event is catalogued yet | P1 |
| `task-relation.deleted` | *(none declared)* | Same as above | P1 |
| `task-relation.refresh` | *(none — not a domain event)* | A client cache-invalidation signal ("re-fetch this project's relations"), not a semantic event even in the inherited model | P1 |
| `task.assignee_changed` | `work_item.assigned` | Direct rename — "Assignee set or changed" | P1 |
| `task.created` | `work_item.created` | Direct rename | P1 |
| `task.deleted` | `work_item.deleted` | Direct rename in name, not yet in behaviour — inherited does a hard delete; the target is "Soft-deleted" | P1 |
| `task.description_changed` | `work_item.updated` (`changes[].field = "description"`) | Folds — the target has no separate description-changed key by design | P1 |
| `task.due_date_changed` | `work_item.updated` (`changes[].field = "dueDate"`) | Folds. Distinct from `work_item.due_soon` / `work_item.overdue`, which are the reminders job's output, not an edit to the field | P1 |
| `task.label_assigned` | *(none declared)* | Label assignment has no catalogued event; `work_item.updated`'s `changes[].field` model is a scalar from/to, not an established fit for a multi-value label add | P1 |
| `task.label_created` | *(none declared)* | The workspace `label` table's own lifecycle has no catalogued event, unlike `project.created` / `project.archived` | P1 |
| `task.label_deleted` | *(none declared)* | Same as above | P1 |
| `task.label_unassigned` | *(none declared)* | Same reasoning as `task.label_assigned` | P1 |
| `task.moved` | *(none — no single equivalent)* | Compound: reassigns `projectId` **and** implicitly changes state/column together. The target model splits these (`work_item.updated` for a field, `work_item.transitioned` for state) and has no combined event for "moved" | P1 |
| `task.priority_changed` | `work_item.updated` (`changes[].field = "priority"`) | Folds — a plain edit, not `work_item.escalated`, which is specifically the escalate action | P1 |
| `task.status_changed` | `work_item.transitioned` | Direct rename — "State changes through the lifecycle engine" | P1 |
| `task.title_changed` | `work_item.updated` (`changes[].field = "title"`) | Folds | P1 |
| `task.unassigned` | `work_item.unassigned` | Direct rename — "Assignee cleared" | P1 |
| `task.updated` | `work_item.updated` | Compatible, generic catch-all fired alongside the specific keys above. Payload gap: inherited sends raw current field values; the target expects structured `changes: [{ field, from, to }]` | P1 |
| `time-entry.created` | *(none declared)* | `time_entry` exists in [data-model.md](data-model.md), but no time-entry event is catalogued yet | P1 |

## Not events

- **`schedule`** — the automation trigger "a cron expression, evaluated against a filter"
  is a *scheduler entry*, not a domain event: the `automation-schedule` job
  ([background-jobs.md](background-jobs.md)) evaluates the filter and invokes the rule
  directly. It appears in the automations trigger picker and nowhere in this catalogue.
- **`work_item.field_changed`** — not a key; it is `work_item.updated` with a condition on
  `changes[].field`. Kept as the automation picker's label, resolved to `work_item.updated`
  when the rule is saved.


## Rules

- `EV-1` Exactly one event-envelope row is written to `outbox` **in the same transaction**
  as the change that caused it. Notification fan-out also writes, in that transaction, one
  inbox row per distinct eligible person and one `notification_delivery` child per eligible
  person/external channel; a digest candidate and its `notification_digest` membership are
  materialized atomically too. There is no fire-and-forget path — see
  [data model](data-model.md).
- `EV-2` The envelope `id` (`outbox.event_id`) remains the idempotency key for event
  consumers. Its value is identical in the envelope, parent row, webhook event reference,
  automation run and notification source. One event may fan out to many distinct
  `notification_delivery.id` values, each identifying one recipient/channel attempt unit;
  the child id is not an event id and never replaces it. Unique `(event_id, person_id)` on
  event-derived inbox rows and `(event_id, recipient_person_id, channel)` on delivery
  children make materialization/replay idempotent. Re-draining a parent must not duplicate
  a notification, automation run, or webhook side effect. Parent event-consumer completion
  is distinct from any individual notification provider success. **No-consumer decision
  (review F26):** while no parent consumer is registered (webhook and automation runtimes
  not built yet), `outbox-drain` marks every claimed parent `delivered`, including historical
  pending rows. This is intentional: those events have no side effects to run, and they are
  **not replayed** to consumers added later. A P4 consumer sees only events claimed after
  its registration point; it must backfill from the source tables if it needs earlier state.
- `EV-3` `depth` increments on every event an automation's action produces; a rule does not
  fire on an event whose `originAutomationId` is itself (`AM-5`), and nothing fires past
  `depth = 5`.
- `EV-4` Adding a key is additive and needs a decision-log entry; renaming or removing one
  is a breaking change under [api-design.md](safety-and-runtime.md#api-design-versioning)'s versioning policy, because
  `webhook.events[]` and `notification_preference.event_kind` store the key.
- `EV-5` A customer-facing fan-out (a notification to a `customer`-side person) never
  carries internal comment content, staff names on internal activity, or SLA policy
  internals — the projection for customers is the portal's, per
  [customer-portal.md](feature-contracts-p3.md#customer-portal).


## Enforcement

`check:events` reads only first-column keys in the two sections above and scans API publishers.
The native registry test reconciles Catalogue keys in both directions. Prose field names,
retired names and examples do not register events. The checker refuses unresolved call shapes;
its existing source-extraction limits are documented in its implementation.
