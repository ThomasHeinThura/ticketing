# Workflows

- **Phase:** P2
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
| **Version** | An immutable published snapshot. Editing creates a new draft |
| **Transition** | from-state → to-state, optionally restricted to a role |
| **Note policy** | Whether a transition requires a note: `none`, `optional`, `required` |
| **Guard** | A condition that must hold for a transition to be offered |

## Data

`workflow`, `workflow_version`, `workflow_transition`. See
[data model](../01-architecture/data-model.md).

## Behaviour

**Structure**

- `WF-1` A workflow belongs to a workspace and is attached to one or more work item types.
- `WF-2` A version contains a set of transitions. States themselves belong to the project.
- `WF-3` A transition is `(from_state, to_state, role_id?)`. A null `role_id` means all
  roles.
- `WF-4` If no transition matches `(current_state, target_state, any of the actor's
  roles)`, the transition is illegal and returns 409.
- `WF-5` A transition from the special `*` source means "from any state" — used for
  Cancel.

**Versioning**

- `WF-6` A published version is immutable. Editing produces a new draft.
- `WF-7` Publishing a draft makes it active for new transitions. In-flight work items are
  not migrated; they simply follow the active version from that point.
- `WF-8` `activity` records which version was active for each transition, so history
  remains interpretable after a change.
- `WF-9` If a work item is in a state that the new version has no outbound transition
  from, it is *stuck*. The editor detects this before publishing and lists affected items.

**Notes**

- `WF-10` `note_policy: required` blocks the transition until a note is supplied.
- `WF-11` `note_visibility` decides whether that note becomes a public or internal
  comment. A resolution note is usually public; a rejection reason is usually internal.
- `WF-12` The note is stored as a comment, so it appears in the activity stream where
  people actually look.

**Guards and gates**

- `WF-13` `requires_approval` blocks the transition until an approval is granted. See
  [approvals](approvals.md).
- `WF-14` `requires_cab` blocks until a CAB approval is granted. Change work items only.
- `WF-15` A guard may require: all children closed; no blocking relations open; a
  required custom field populated; assignee present.
- `WF-16` Guards are evaluated server-side and the reason for a blocked transition is
  returned in the problem detail so the UI can explain it.

**Effects**

- `WF-17` Entering a `completed` state sets `resolved_at` and stops the resolution SLA.
- `WF-18` Leaving a `completed` state clears `resolved_at` and resumes the SLA clock from
  where it stopped, not from zero.
- `WF-19` A transition may set the assignee — for example, moving to "Waiting on customer"
  can unassign.
- `WF-20` A transition emits `work_item.transitioned` for automations, webhooks and
  notifications.

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

Before publishing, a validation panel reports: unreachable states, states with no outbound
transition, work items that would become stuck, and roles with no legal transition at all.

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
| State deleted from a project | Refused while any work item is in it |
| Workflow reassigned to a different type | Allowed. Existing items keep their state; illegal states are reported |
| Circular guard — A requires B closed, B requires A closed | Both blocked. The validation panel detects the cycle before publishing |
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
- Each guard type, satisfied and unsatisfied.
- Note policy enforcement, all three values.
- Reopen resumes rather than restarts the SLA clock.
- Version selection and stuck-item detection.

Integration: a transition without permission returns 409 with the reason; a transition
with a required note but no note returns 422.

E2E: a member cannot see the Resolve option; a lead can; a blocked transition shows its
reason; a required note is captured and appears as a comment.

## Open questions

None.

## Related

- [Work items](work-items.md) · [Approvals](approvals.md) · [SLA](sla.md)
- [ADR 0011 — one generic lifecycle engine](../01-architecture/adr/0011-ticket-lifecycle-engine.md) —
  why this is the only state-and-transition mechanism in the product, for every category of
  work item, and why state names carry no meaning in code beyond their `group`
