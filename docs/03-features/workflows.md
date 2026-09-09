# Workflows

- **Stage:** P2
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** states, work item types, RBAC

## Purpose

Control how work items move between states: which transitions are legal, who may make
them, what must be recorded, and what must be approved first.

A state change is **never a plain field update**. It goes through the workflow engine, so
the rules are in one place and cannot be bypassed by a `PATCH`.

## The distinctive idea

**Transitions are legal per role.** A member may move Open → In Progress. Only a lead may
move In Progress → Resolved. This comes from OpenProject's type × role × status model and
is materially more expressive than a single state machine per type.

Jira has this and charges for it. Plane and kaneo do not have it at all.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Workflow** | A named state machine, attached to a work item type |
| **State template** | A workspace-level lifecycle position (`state_template`) a workflow's transitions reference |
| **State** | A project's own concrete lifecycle position (`state`), mapped to exactly one state template |
| **Version** | An immutable published snapshot. Editing creates a new draft |
| **Transition** | from-state-template → to-state-template, optionally restricted to a role |
| **Note policy** | Whether a transition requires a note: `none`, `optional`, `required` |
| **Guard** | A condition that must hold for a transition to be offered |

## Data

`workflow`, `workflow_version`, `workflow_transition`, `state_template`, `state`,
`scheduled_transition`. See [data model](../01-architecture/data-model.md).

## Behaviour

**Structure**

- `WF-1` A workflow belongs to a workspace and is attached to one or more work item types.
  Its transitions reference **workspace-level state templates** (`state_template`),
  never a project's concrete state directly — see `WF-2`.
- `WF-2` A version contains a set of transitions **between state templates**
  (`state_template`) — the workspace-level lifecycle-position catalogue. Each
  **project** owns its own concrete **states** (`state`), each mapped to exactly one
  template via `state.state_template_id`; `work_item.state_id` always points at a
  project's concrete row, never at a template — see
  [ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md). This is how one
  workflow serves every project that adopts it without making a project's concrete
  states workspace-global: the workflow graph is shared data, each project's occupancy
  of it is not. A project may not create a concrete state for a template with no
  outbound transition anywhere in the workflows its types use; the validation panel
  refuses it (`WF-9`).

  **How a transition resolves to a project's state.** A transition names *templates*;
  legality is decided by comparing the actor's role and the work item's current template
  (via its concrete `state.state_template_id`) against `from_state_template_id` (null
  matches any, `WF-5`) and the role restriction. Once a transition is legal for this
  actor, its `to_state_template_id` is resolved against *this work item's own project*:
  the `state` row where `project_id` matches and `state_template_id =
  to_state_template_id` and `archived_at is null`. If no such row exists, the transition
  is not available in this project — it is filtered out of `GET /transitions`, and a
  stale attempt is refused with the same **409** as "no matching transition" (`WF-4`).
  `work_item.state_id` is updated to the resolved concrete row, never to the template.
  The validation panel (see Screens, below) runs this same resolution for every project
  using the workflow before a publish, which is how it finds work items that would
  become stuck (`WF-9`) and projects that could not reach a template the graph requires.
- `WF-3` A transition is `(from_state_template, to_state_template, role_id?)`. A null
  `role_id` means all roles.
- `WF-4` Without `work_item:transition` the request is **403**, naming the capability.
  With it, if no transition matches `(current_state's template, target template, any of
  the actor's roles)` **or** the target template has no concrete state in this project,
  the transition is illegal and returns **409** with the reason. The two are never
  conflated — "you may not" and "not from here" are different errors.
- `WF-5` A null `from_state_template_id` means "from any state template" — used for
  Cancel.

**Versioning**

- `WF-6` A published version is immutable. Editing produces a new draft.
- `WF-7` Publishing a draft makes it active for new transitions. In-flight work items are
  not migrated; they simply follow the active version from that point. *(Deliberately
  the opposite of [sla.md](sla.md) `SLA-3`, which pins the policy version effective at
  creation: a workflow is an internal process definition the organisation may
  legitimately tighten going forward, while an SLA is a commitment already made to a
  requester and must not move under them after the fact.)*
- `WF-8` `activity` records which version was active for each transition, so history
  remains interpretable after a change.
- `WF-9` If a work item's concrete state maps to a template that the new version has no
  outbound transition from, it is *stuck*. The editor detects this before publishing —
  checking every project whose work item types use this workflow, not just one — and
  lists affected items.

**Notes**

- `WF-10` `note_policy: required` blocks the transition until a note is supplied.
- `WF-11` `note_visibility` decides whether that note becomes a public or internal
  comment. A resolution note is usually public; a rejection reason is usually internal.
- `WF-12` The note is stored as a comment with `comment.activity_id` set to this
  transition's `activity` row, so the activity stream renders the note and the
  transition as one entry rather than two unrelated rows.

**Guards and gates**

- `WF-13` `requires_approval` blocks the transition until an approval **raised against
  this transition** (`approval.transition_id`) is `approved`; `approval_policy` (`any` |
  `all`) says how many. An approval raised for another gate never satisfies this one. See
  [approvals](approvals.md).
- `WF-14` `requires_cab` blocks until a CAB approval is granted. Only offered on types with
  `work_item_type.is_change = true` — never matched by a type's name.
- `WF-15` **Guards** — a closed vocabulary, stored as `workflow_transition.guards jsonb`:
  a JSON array, each element shaped `{ "type": "<guard-type>", ...fields }`. The five
  recognised types: `children_closed` (`{ "type": "children_closed" }`),
  `no_open_blockers` (`{ "type": "no_open_blockers" }`), `assignee_present`
  (`{ "type": "assignee_present" }`), `field_required` (`{ "type": "field_required",
  "field": "<key>" }` — a native column, `cf.<key>`, or a satellite such as
  `change.rollback_plan`), and `change_risk_at_most` (`{ "type": "change_risk_at_most",
  "level": "low"|"medium"|"high" }`). All guards on a transition must pass (logical AND).
  **"Closed" and "open"** resolve exactly as [data-model.md](../01-architecture/data-model.md)
  §4 defines them: a work item's `state` row carries no `group` of its own, so a guard
  evaluates its concrete state's mapped `state_template.group` (joined through
  `state.state_template_id`) — "closed" means that group is `completed` or `cancelled`;
  "open" means anything else. Never a state name, and never a bare `state.group` column.
- `WF-16` Guards are evaluated server-side and the reason for a blocked transition is
  returned in the problem detail as a reason code `guard.<type>` (e.g.
  `guard.children_closed`) so the UI can explain it. A guard object whose `type` is not
  one of the five above — written by a newer build, a hand edit, or a downgrade — **fails
  closed**: the transition is treated as blocked, with reason code `guard.unrecognized`,
  never silently skipped and never treated as satisfied.

**Effects** — a closed vocabulary, stored as `workflow_transition.effects jsonb`. This is
the **only** place lifecycle side-effects are defined; `sla.md` and `assignment.md` cite it.

- `WF-17` Entering a `completed`-group state sets `resolved_at` and writes an `sla_pause`
  row with reason `resolved` for every metric — which is how the clock "stops" in a model
  where SLA state is never stored.
- `WF-18` Leaving a `completed`-group state clears `resolved_at` and closes that
  `sla_pause` row, so the clock resumes from where it stopped, not from zero.
- `WF-19` Effects available on any transition: `set_assignee { personId | 'default' }`,
  `clear_assignee`, `pause_sla`, `resume_sla` (an open `waiting_customer` pause),
  `set_field { field, value }`, and `schedule_transition { after_minutes,
  to_state_template_id }` — `to_state_template_id` is resolved immediately, against the
  work item's own project (the same resolution `WF-2` specifies for the transition
  itself), to a concrete `state` row and stored as such. Each pending instance is a
  `scheduled_transition` row — `work_item_id`, `from_state_id`, `to_state_id` (both
  concrete, project rows), `due_at`, `state`; `reminder-scan` fires due rows — executing
  the already-resolved concrete transition, no further template lookup — and cancels a
  row whose item has already left `from_state_id`
  ([data-model.md](../01-architecture/data-model.md)) — the "pending until" pattern,
  fired by the scheduler and cancelled if the item leaves the state first.
- `WF-20` A transition emits `work_item.transitioned` ([events.md](../01-architecture/events.md))
  for automations, webhooks and notifications, in the same transaction as the change.
- `WF-21` A customer-initiated reopen ([customer-portal.md](customer-portal.md) `CP-8`, a
  reply to a closed request, an upload to a resolved request) is executed as a **system
  actor** through the workflow's transition marked `is_reopen` (`workflow_transition.is_reopen`,
  at most one per workflow version); if the active version has
  none, the action is accepted, the item stays resolved, and a flagged activity row asks
  staff to look. One mechanism for all three call sites.

## The state select

The UI offers **only the transitions legal for this actor, from this state, right now**.
Illegal ones are not shown greyed out — they are absent, because a greyed-out option
invites the question "why can't I?" without answering it.

Where a transition is blocked by a guard rather than by role, it *is* shown, disabled, with
the reason: "Blocked — 2 sub-tasks are still open."

That distinction matters. "You may not" and "not yet" are different messages.

## Permissions

| Action | Capability |
| --- | --- |
| Transition a work item | `work_item:transition` **and** a matching transition for one of the actor's roles |
| Read workflows | `workflow:read` |
| Create, edit, publish | `workflow:manage` |

## Screens

**Workflow list** — name, attached types, active version, draft indicator.

**Workflow editor** — a node-and-edge diagram of states and transitions. Selecting an edge
opens a panel for its role restriction, note policy, approval requirement and guards.

Before publishing, a validation panel reports: unreachable state templates, templates
with no outbound transition, work items in any adopting project that would become stuck
(`WF-9`), a project that has no concrete state for a template the graph requires it to
reach, and roles with no legal transition at all.

## API

```
GET   /api/workflows                          workflow:read
POST  /api/workflows                          workflow:manage
GET   /api/workflows/{id}                     workflow:read
POST  /api/workflows/{id}/versions            workflow:manage
POST  /api/workflows/{id}/versions/{n}/validate  workflow:manage
POST  /api/workflows/{id}/versions/{n}/publish   workflow:manage
GET   /api/work-items/{key}/transitions       work_item:read
POST  /api/work-items/{key}/transition        work_item:transition
```

`GET /transitions` returns exactly what this actor may do now, with reasons for anything
blocked. The UI never computes legality client-side.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Actor holds two roles with different transitions | The union applies |
| Project's concrete state archived | Refused while any work item in that project is in it |
| Workspace state template archived | Refused while any project has an unarchived concrete state mapped to it |
| Workflow reassigned to a different type | Allowed. Existing items keep their state; illegal states are reported |
| Two related items each require the other's blockers closed (`no_open_blockers` on both, via a `blocks` relation each way) | Not a workflow-graph cycle — no guard type in `WF-15` references another item or state by id, so a workflow's own definition has nothing a static pre-publish check could detect. This is a property of the `work_item_relation` graph at runtime, resolved the same way any blocking deadlock is: someone removes or completes one side of the relation. *(Corrected 2026-09-09: retires an earlier, unbuildable phrasing — "A requires B closed, B requires A closed", claimed to be caught by a validation-panel cycle check — that presupposed a guard type naming another workflow state, which this vocabulary does not define and which was deliberately not invented merely to satisfy that phrasing. Flagged to Thomas as a spec correction rather than a new mechanism.)* |
| Bulk transition where some items are illegal | Per-item: legal ones succeed, illegal ones reported with reasons |
| Approval expires while pending | The transition remains blocked. A new approval must be requested |
| Note required but the actor lacks comment permission | Refused with an explanatory error, not a silent failure |

## Out of scope

- Automations that trigger *on* a transition → [automations.md](automations.md)
- Approval mechanics → [approvals.md](approvals.md)

## Testing

Unit tests in `packages/domain/src/workflow/`:

- Legality for every (from, to, role) combination in a seeded workflow.
- Union of transitions for multi-role actors.
- Each guard type, satisfied and unsatisfied, plus an unrecognized guard `type` failing
  closed with `guard.unrecognized`.
- Note policy enforcement, all three values.
- Reopen resumes rather than restarts the SLA clock.
- Version selection and stuck-item detection, across every project adopting the workflow.
- A transition's target template with no concrete state in the acting work item's
  project is excluded from the offered set and refused with the same 409 as no matching
  transition.

Integration: a transition without `work_item:transition` returns **403** naming the
capability; a transition with the capability but no legal edge returns **409** with the
reason; a transition with a required note but no note returns 422; every guard type
returns its `guard.<type>` reason code.

Named tests: `wf-4-403-vs-409.spec.ts`, `wf-13-approval-gate-matches-transition.spec.ts`,
`wf-16-guard-unrecognized-fails-closed.spec.ts` (the fail-closed behaviour for an
unrecognized guard `type` is `WF-16`'s rule, not `WF-15`'s — `WF-15` only defines the guard
vocabulary),
`wf-17-completed-writes-sla-pause.spec.ts`, `wf-19-effects-vocabulary.spec.ts`,
`wf-21-customer-reopen-system-actor.spec.ts`.

E2E: a member cannot see the Resolve option; a lead can; a blocked transition shows its
reason; a required note is captured and appears as a comment.

## Open questions

None.

## Related

- [Work items](work-items.md) · [Approvals](approvals.md) · [SLA](sla.md)
- [ADR 0011 — one generic lifecycle engine](../01-architecture/adr/0011-ticket-lifecycle-engine.md) —
  why this is the only state-and-transition mechanism in the product, for every category of
  work item, and why state names carry no meaning in code beyond their `group`
