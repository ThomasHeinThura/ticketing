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

| Trigger | Fires on |
| --- | --- |
| `work_item.created` | Creation, including from intake acceptance |
| `work_item.transitioned` | A state change |
| `work_item.field_changed` | A named field changing |
| `work_item.assigned` | Assignment change |
| `work_item.commented` | A new comment, filterable by visibility |
| `sla.at_risk` / `sla.breached` | SLA edge |
| `approval.decided` | An approval decision |
| `submission.received` | A new submission |
| `schedule` | A cron expression, evaluated against a filter |

## Conditions

Field comparisons using the same grammar as filters: type, state, state group, priority,
assignee, requester, label, organisation, project, age, custom field, SLA state, comment
visibility, actor role.

- `AU-1` Conditions combine with AND. An OR is expressed by writing two rules — which is
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

- `AU-2` Automations run **after** the triggering change is committed, from the event bus.
  They never block the request.
- `AU-3` An automation acts as a **system actor** with an explicit effective role,
  configured per rule. It cannot exceed that role. This prevents "the automation can do
  anything" — which is how privilege escalation happens through configuration.
- `AU-4` Every action taken writes an activity entry attributed to the automation by name,
  never to a person.
- `AU-5` **Loop protection.** An automation's own changes do not re-trigger it. A chain of
  automations is capped at depth 5, after which the chain is abandoned and an error is
  recorded and surfaced.
- `AU-6` Rules are ordered and run in order. A rule may be marked "stop processing further
  rules".
- `AU-7` A failing action does not abort the remaining actions in the rule. Each result is
  recorded.
- `AU-8` Every execution writes a run record: trigger, matched or not, each action's
  outcome. Retained 30 days.

## Testing before enabling

- `AU-9` A rule can be **dry-run** against recent history: "this rule would have fired 47
  times in the last 7 days, on these items."
- `AU-10` New rules default to disabled. Enabling is a deliberate act.

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
