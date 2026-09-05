# Automations

- **Phase:** P4
- **Status:** ⬜
- **Feature flag:** `feature.automations`
- **Depends on:** workflows, notifications, webhooks

## Purpose

Do the repetitive thing automatically. Route new incidents to the right team, escalate on
breach, close resolved items after a week of silence, notify a channel when a change is
approved.

## Design stance

Jira's automation builder is powerful and enormous. Ours should cover **ninety per cent of
real cases with twenty per cent of the concepts**, and be comprehensible to a service desk
manager rather than only to an integrator.

That means: one trigger, a flat list of conditions, a flat list of actions. No branching,
no loops, no variables, no sub-flows. Anything needing those is a webhook to a real
automation tool, which people already have.

## Shape

```
WHEN   a work item is created
IF     type is Incident
AND    priority is Urgent
THEN   assign to the on-call queue
AND    add label "escalated"
AND    post to Slack #incidents
```

## Triggers

Every trigger except `schedule` is a domain event from the **canonical catalogue** in
[events.md](../01-architecture/events.md) — the column marked **A** there is the exhaustive
list of what may appear in this picker. This document does not maintain its own list.

| Trigger | Fires on |
| --- | --- |
| `work_item.created` | Creation, including from intake acceptance |
| `work_item.transitioned` | A state change |
| `work_item.updated` with a field condition | A named field changing — shown in the picker as "a field changes", resolved to `work_item.updated` + a condition on `changes[].field` when saved |
| `work_item.assigned` | Assignment change |
| `work_item.commented` | A new comment, filterable by visibility |
| `work_item.escalated` | A priority escalation |
| `sla.at_risk` / `sla.breached` | SLA edge |
| `approval.decided` | An approval decision |
| `submission.received` | A new submission |
| `schedule` | A cron expression, evaluated against a filter — a scheduler entry, not an event |

## Conditions

Field comparisons using the same grammar as filters: type, state, state group, priority,
assignee, requester, label, organisation, project, age, custom field, SLA state, comment
visibility, actor role.

- `AM-1` Conditions combine with AND. An OR is expressed by writing two rules — which is
  simpler to read than nested logic, and reads better in a list.

## Actions

| Action | Notes |
| --- | --- |
| Transition state | Must be legal for the automation's effective role |
| Assign | Must be on the project roster |
| Set a field | Priority, due date, custom field |
| Add or remove a label | |
| Add a watcher | |
| Post a comment | Public or internal, with placeholders |
| Send a notification | To a person, a team or a channel |
| Call a webhook | Uses a configured webhook |
| Create a linked work item | For example, a follow-up task on resolution |
| Request an approval | |

## Behaviour

- `AM-2` Automations run **after** the triggering change is committed, from the event bus.
  They never block the request.
- `AM-3` An automation acts as a **system actor** with an explicit effective role,
  configured per rule. It cannot exceed that role. This prevents "the automation can do
  anything" — which is how privilege escalation happens through configuration.
- `AM-4` Every action taken writes an activity entry attributed to the automation by name,
  never to a person.
- `AM-5` **Loop protection.** An automation's own changes do not re-trigger it. A chain of
  automations is capped at depth 5, after which the chain is abandoned and an error is
  recorded and surfaced.
- `AM-6` Rules are ordered and run in order. A rule may be marked "stop processing further
  rules".
- `AM-7` A failing action does not abort the remaining actions in the rule. Each result is
  recorded.
- `AM-8` Every execution writes a run record: trigger, matched or not, each action's
  outcome. Retained 30 days.

## Testing before enabling

- `AM-9` A rule can be **dry-run** against recent history: "this rule would have fired 47
  times in the last 7 days, on these items."
- `AM-10` New rules default to disabled. Enabling is a deliberate act.
- `AM-11` **Placeholder expansion respects the destination's visibility.** A placeholder
  that references an internal-only custom field, an internal note, or a staff-only value
  (an assignee's email, an internal SLA breach note) is **refused at save time** when the
  action's destination is customer-visible — a public comment, a notification to a
  customer, a webhook whose owner lacks reach — with the offending field named; the same
  check runs at execution, so a field made internal *after* the rule was saved is redacted
  rather than leaked. The dry-run's validation panel lists every placeholder and its
  visibility. `AM-3` governs what an action *may do*; `AM-11` governs what it may *say*.
- `AM-12` "Call a webhook" delivers only what the webhook's owner may see — `WH-14` in
  [webhooks-and-api-keys.md](webhooks-and-api-keys.md) — evaluated against the rule's
  `effective_role_id`, never against the rule author's own reach.
- `AM-13` **There is no delete action.** The action vocabulary above contains no delete,
  purge or archive-and-purge action, for P4 and every earlier phase — an automation cannot
  destroy data ([pending-actions.md](../01-architecture/pending-actions.md)). Any later
  automation-delete capability needs its own feature specification with blast-radius
  control, dry-run behaviour, explicit human approval, audit requirements and a security
  review before it is scheduled.

A rule that silently starts changing hundreds of work items is the worst possible outcome,
and the dry-run is the guard.

## Scope

Rules are per project by default, or per workspace with `workspace:manage_settings`.
A workspace rule may be restricted to certain projects.

## Permissions

| Action | Capability |
| --- | --- |
| See rules | `project:read` |
| Create, edit, delete project rules | `project:manage_settings` |
| Create workspace rules | `workspace:manage_settings` |
| Set a rule's effective role | Only to a role at or below your own rank |

That last constraint is the important one.

## Screens

Rule list with enabled state, last run, and fire count. Rule editor as three stacked
sections — trigger, conditions, actions — in plain language. Run history per rule with
per-action outcomes.

## API

```
GET    /api/projects/{key}/automations         project:read
POST   /api/projects/{key}/automations         project:manage_settings
PATCH  /api/automations/{id}                   project:manage_settings
DELETE /api/automations/{id}                   project:manage_settings
POST   /api/automations/{id}/dry-run           project:manage_settings
POST   /api/automations/{id}/enable            project:manage_settings
GET    /api/automations/{id}/runs              project:read
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Rule tries an illegal transition | Action fails and is recorded with the reason; other actions continue |
| Rule assigns someone off the roster | Action fails and is recorded |
| Two rules set the same field to different values | Both run in order; the last wins. The run history makes it visible |
| Rule references a deleted label or state | The rule is auto-disabled and flagged |
| Scheduled rule matching 10,000 items | Chunked, rate-limited, with a per-run cap of 500 and a warning |
| Rule's effective role loses a capability | Actions needing it start failing and are recorded. The rule is flagged |
| Recursive rule pair | Depth cap at 5, chain abandoned, error surfaced on both rules |

## Out of scope

- Branching, loops and variables — use a webhook to a real automation platform
- Automations acting across workspaces
- Machine-learned routing

## Testing

Unit: condition evaluation; loop and depth protection; effective-role clamping.

Integration: an automation cannot exceed its effective role even when configured to try;
a failed action does not abort the rule; dry-run mutates nothing.

E2E: create a rule, dry-run it, enable it, trigger it, inspect the run history.

## Related

- [Workflows](workflows.md) · [Notifications](notifications.md)
- [Webhooks and API keys](webhooks-and-api-keys.md)
