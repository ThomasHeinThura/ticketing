# P2 feature contracts

These are maintained product requirements, not completion evidence. [Requirement index](../requirements-index.json) retains every original numbered definition and its provenance; [status](../status.md) records implementation and verification separately. Numbered definitions below retain their original wording, including any embedded historical implementation commentary; such commentary is not a current status claim. Standalone historical status, review history and implementation reports are omitted.

Use the original Kaneo composition, components and interactions for every specified screen. Current Thomas decisions and explicit maintained [integration contracts](../contracts.md) take precedence over older alternatives without dropping requirement IDs. Test sections describe required invariants and journeys, not tests claimed to exist or pass. API/schema discrepancies remain work to resolve, not permission to rewrite the requirement to match code.

SLA results are recomputed authoritatively from policy/calendar/history. A derived cache and scanner do not replace that authority; follow the maintained [integration contracts](../contracts.md). Existing approvals remain actionable when new approval creation is disabled. Calendar country datasets need an explicit supported-country/provenance/version contract; none is invented by this migration.

## Features

- [workflows](#workflows)
- [sla](#sla)
- [service-calendars](#service-calendars)
- [request-types-and-catalogue](#request-types-and-catalogue)
- [intake-queue](#intake-queue)
- [approvals](#approvals)
- [audit-trail](#audit-trail)

<a id="workflows"></a>
## Workflows

- **Primary phase:** P2
- **Feature flag:** always on
- **Depends on:** states, work item types, RBAC

<a id="workflows-purpose"></a>
### Purpose

Control how work items move between states: which transitions are legal, who may make
them, what must be recorded, and what must be approved first.

A state change is **never a plain field update**. It goes through the workflow engine, so
the rules are in one place and cannot be bypassed by a `PATCH`.

<a id="workflows-the-distinctive-idea"></a>
### The distinctive idea

**Transitions are legal per role.** A member may move Open → In Progress. Only a lead may
move In Progress → Resolved. This comes from OpenProject's type × role × status model and
is materially more expressive than a single state machine per type.

Jira has this and charges for it. Plane and kaneo do not have it at all.

<a id="workflows-concepts"></a>
### Concepts

| Concept | Meaning |
| --- | --- |
| **Workflow** | A named state machine, attached to a work item type |
| **State template** | A workspace-level lifecycle position (`state_template`) a workflow's transitions reference |
| **State** | A project's own concrete lifecycle position (`state`), mapped to exactly one state template |
| **Version** | An immutable published snapshot. Editing creates a new draft |
| **Transition** | from-state-template → to-state-template, optionally restricted to a role |
| **Note policy** | Whether a transition requires a note: `none`, `optional`, `required` |
| **Guard** | A condition that must hold for a transition to be offered |

<a id="workflows-data"></a>
### Data

`workflow`, `workflow_version`, `workflow_transition`, `state_template`, `state`,
`scheduled_transition`. See [data model](data-model.md).

<a id="workflows-behaviour"></a>
### Behaviour

**Structure**

- `WF-1` A workflow belongs to a workspace and is attached to one or more work item types.
  Its transitions reference **workspace-level state templates** (`state_template`),
  never a project's concrete state directly — see `WF-2`.
- `WF-2` A version contains a set of transitions **between state templates**
  (`state_template`) — the workspace-level lifecycle-position catalogue. Each
  **project** owns its own concrete **states** (`state`), each mapped to exactly one
  template via `state.state_template_id`; `work_item.state_id` always points at a
  project's concrete row, never at a template — see
  [ADR 0011](#pending-01-architectureadr0011-ticket-lifecycle-engine). This is how one
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
  the opposite of [sla.md](feature-contracts-p2.md#sla) `SLA-3`, which pins the policy version effective at
  creation: a workflow is an internal process definition the organisation may
  legitimately tighten going forward, while an SLA is a commitment already made to a
  requester and must not move under them after the fact.)*
- `WF-8` `activity` records which version was active for each transition, so history
  remains interpretable after a change.
- `WF-9` If a work item's concrete state maps to a template that the new version has no
  outbound transition from, it is *stuck*. The editor detects this before publishing —
  checking every project in the workflow's workspace, including projects with no work
  items and archived projects — and lists affected items. `work_item_type` is workspace-
  scoped and no project-to-type adoption table exists, so WF-9's adopting-project set is
  every project in that workspace. The caller must have access to every project in this
  set for complete validation; otherwise validation returns a generic refusal with no
  project or item details. Publishing applies the same complete-reach requirement and
  must not silently validate or publish against only a reachable subset.

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
  [approvals](feature-contracts-p2.md#approvals).
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
  **"Closed" and "open"** resolve exactly as [data-model.md](data-model.md)
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

- `WF-17` Entering a `completed`-group state sets `resolved_at`. Writing an `sla_pause`
  row with reason `resolved` for every metric is held for a later release.
- `WF-18` Leaving a `completed`-group state clears `resolved_at`. Closing a `resolved`
  `sla_pause` row and continuing its interval is held for a later release.
- `WF-19` Effects available on any transition: `set_assignee { personId | 'default' }`,
  `clear_assignee`, `pause_sla`, `resume_sla` (an open `waiting_customer` pause), and
  `schedule_transition { after_minutes,
  to_state_template_id }` — `to_state_template_id` is resolved immediately, against the
  work item's own project (the same resolution `WF-2` specifies for the transition
  itself), to a concrete `state` row and stored as such. Each pending instance is a
  `scheduled_transition` row — `work_item_id`, `from_state_id`, `to_state_id` (both
  concrete, project rows), `due_at`, `state`; `reminder-scan` fires due rows — executing
  the already-resolved concrete transition, no further template lookup — and cancels a
  row whose item has already left `from_state_id`
  ([data-model.md](data-model.md)) — the "pending until" pattern,
  fired by the scheduler and cancelled if the item leaves the state first.
  When a version holds several edges for the hop's template pair, the scheduled (system) hop applies the most restrictive one: any approval/CAB gate refuses it and every matching edge's guards must hold, regardless of edge order.
  Authoring checks the `set_assignee` payload shape only; an unknown person id may be
  saved. At execution, the selected person must be eligible in the work item's active
  project roster; if not, refuse the complete transition without applying any effect.
- `set_field { field, value }` is held for this release. No field namespace or value
  validation has been defined. The legacy request shape remains documented for wire
  compatibility, but any new version containing it is refused with HTTP 400 before
  database reads or writes; version validation also rejects it as defense in depth. For
  a previously stored mixed version,
  only the selected transition containing `set_field` is refused before any work-item
  state or effect is changed; supported sibling transitions remain usable. Stored rows
  retain the recognized shape so the held effect cannot be silently dropped or
  reinterpreted.
- `WF-20` A transition emits `work_item.transitioned` ([events.md](events.md))
  for automations, webhooks and notifications, in the same transaction as the change.
- `WF-21` A customer-initiated reopen ([customer-portal.md](feature-contracts-p3.md#customer-portal) `CP-8`, a
  reply to a closed request, an upload to a resolved request) is executed as a **system
  actor** through the workflow's transition marked `is_reopen` (`workflow_transition.is_reopen`,
  at most one per workflow version); if the active version has
  none, the action is accepted, the item stays resolved, and a flagged activity row asks
  staff to look. One mechanism for all three call sites.
- `WF-22` An authored transition effect whose `kind` falls outside `WF-19`'s available
  vocabulary makes the workflow version **invalid**. The held `set_field` shape is also
  rejected during authoring and fails closed if found in a previously stored transition.
  `resolve_sla` and `reopen_sla` are the automatic
  `WF-17`/`WF-18` effects and are never authorable — a `workflow_transition.effects` array
  containing either is invalid by name. **Fails closed**, mirroring `WF-16`'s treatment of an
  unrecognised guard `type`: an unknown kind is refused, never ignored and never passed
  through. Thomas's decision, 2026-09-10. The rule exists because `Effect` is a TypeScript
  union and `workflow_transition.effects` is a **jsonb column** — `JSON.parse` yields `any`,
  which satisfies the union with zero type errors, so the compile-time barrier does not reach
  the data. Validation is the only thing that does.

<a id="workflows-the-state-select"></a>
### The state select

The UI offers **only the transitions legal for this actor, from this state, right now**.
Illegal ones are not shown greyed out — they are absent, because a greyed-out option
invites the question "why can't I?" without answering it.

Where a transition is blocked by a guard rather than by role, it *is* shown, disabled, with
the reason: "Blocked — 2 sub-tasks are still open."

That distinction matters. "You may not" and "not yet" are different messages.

<a id="workflows-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| Transition a work item | `work_item:transition` **and** a matching transition for one of the actor's roles |
| Read workflows | `workflow:read` |
| Create, edit, publish | `workflow:manage` |

<a id="workflows-screens"></a>
### Screens

**Workflow list** — name, attached types, active version, draft indicator.

**Workflow editor** — a node-and-edge diagram of states and transitions. Selecting an edge
opens a panel for its role restriction, note policy, approval requirement and guards.

Before publishing, a validation panel reports: unreachable state templates, templates
with no outbound transition, work items in any adopting project that would become stuck
(`WF-9`), a project that has no concrete state for a template the graph requires it to
reach, and roles with no legal transition at all.

<a id="workflows-api"></a>
### API

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
blocked. Each offer carries `toStateName` (the target state's display name), so the UI never
joins template names itself. The UI never computes legality client-side.

<a id="workflows-edge-cases"></a>
### Edge cases

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

<a id="workflows-out-of-scope"></a>
### Out of scope

- Automations that trigger *on* a transition → [automations.md](feature-contracts-p4.md#automations)
- Approval mechanics → [approvals.md](feature-contracts-p2.md#approvals)

<a id="workflows-testing"></a>
### Testing

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

<a id="workflows-open-questions"></a>
### Open questions

None.

<a id="workflows-related"></a>
### Related

- [Work items](feature-contracts-p1.md#work-items) · [Approvals](feature-contracts-p2.md#approvals) · [SLA](feature-contracts-p2.md#sla)
- [ADR 0011 — one generic lifecycle engine](#pending-01-architectureadr0011-ticket-lifecycle-engine) —
  why this is the only state-and-transition mechanism in the product, for every category of
  work item, and why state names carry no meaning in code beyond their `group`

<a id="sla"></a>
## SLA

- **Primary phase:** P2
- **Feature flag:** `feature.sla`
- **Depends on:** service calendars, request types, work item types

<a id="sla-purpose"></a>
### Purpose

Answer, for any work item: **when is this due, and are we going to make it?**

The commitment is expressed in *covered time* — hours the service is actually contracted
to be responding — not wall-clock time. A 4-hour resolution target on an 8×5 service,
raised at 16:00 on a Friday, is due at 12:00 on Monday.

<a id="sla-the-central-decision"></a>
### The central decision

**SLA state is never stored. It is computed on read from stored facts.**

See [ADR 0009](#pending-01-architectureadr0009-lazy-sla-evaluation) for the full argument.
The consequences you need to know while implementing:

- Changing a policy or a calendar needs no backfill.
- A missed scan delays a *notification*, never the *truth*.
- There is one implementation, in `packages/domain/src/sla/`, used by the API, the UI,
  reports and the scan job alike.

<a id="sla-concepts"></a>
### Concepts

| Concept | Meaning |
| --- | --- |
| **SLA policy** | A named, versioned set of goals, bound to a service calendar |
| **Goal** | (metric × work item type × priority) → target minutes |
| **Metric** | `first_response` or `resolution` |
| **Covered time** | Elapsed time counted only inside calendar windows, excluding holidays and pauses |
| **State** | `none` · `ok` · `at_risk` · `breached` · `met` · `missed` |
| **Pause** | An interval that does not consume the clock |

<a id="sla-states"></a>
### States

| State | Meaning |
| --- | --- |
| `none` | No policy applies. A delivery project with no service commitment |
| `ok` | Open, under 75% of the target consumed |
| `at_risk` | Open, 75%–100% consumed. The threshold is configurable per policy |
| `breached` | Open, over 100% consumed |
| `met` | Closed within target |
| `missed` | Closed after target |

`none` is a first-class answer, not an error. Most delivery work has no SLA and the
interface should say so plainly rather than showing a meaningless zero.

<a id="sla-data"></a>
### Data

`sla_policy`, `sla_policy_version`, `sla_goal`, `sla_pause`, `service_calendar`, and
`work_item_sla_cache` — the last used **only** so `sla-scan` can detect an edge and fire
an event once, and for list filtering. It is never the answer to "what is the state?"

<a id="sla-behaviour"></a>
### Behaviour

**Resolution of which policy applies**

- `SLA-1` Order: work item type override → request type → project → workspace default.
  First match wins.
- `SLA-2` If no policy resolves, state is `none`.
- `SLA-3` The **published version effective at `work_item.sla_started_at`** is pinned when
  the work item is created or accepted. That instant is the direct work item's creation
  time, or the original submission's `created_at` on acceptance (ADR 0009). The selected
  version is stored on the work item; later policy binding or publication changes never
  rewrite the version used by an existing item.

**Computation**

- `SLA-4` `dueAt` = the instant at which `target_minutes` of covered time have elapsed
  since `sla_started_at` (copied from the accepted submission's `created_at`, otherwise the
  work item's `created_at` — [data-model.md](data-model.md)), per the
  calendar, skipping pauses.
- `SLA-5` Covered time counts only inside the calendar's weekday windows, in the
  calendar's timezone, excluding holidays.
- `SLA-6` A 24×7 calendar makes covered time equal to wall-clock time.
- `SLA-7` `first_response` stops at the first public comment by a staff member, which sets
  `work_item.first_response_at` — the stored fact the metric is computed from.
  *(Edge cases answered 2026-09-18, resolving the §11 Medium finding: **(a)** on an
  internally-raised item whose requester is themselves staff, the requester's own
  comments never stop the clock — the first responder must be a staff member other than
  the requester, because the metric measures the serving side's response to the asking
  side; **(b)** internal comments — including a workflow transition's note (`WF-12`) —
  never count, in any case: only **public** comments stop the clock.)*
- `SLA-8` `resolution` stops when the work item enters a state in the `completed` group.
- `SLA-9` The intended reopen rule is to continue the resolution clock from the amount
  consumed before completion, not restart it. The resolved-pause continuity needed to
  realize that rule is held under `SLA-11` and `WF-18`; this release does not guarantee or
  claim correct resolution metrics for reopened items.

**Pausing**

- `SLA-10` Pausing is a **workflow transition effect**, not a policy property: the
  transition into "Waiting on customer" carries `pause_sla`, the transition out carries
  `resume_sla` — the vocabulary in [workflows.md](feature-contracts-p2.md#workflows) `WF-19`. A policy declares
  goals and thresholds only. *(Corrected 2026-09-05: the first draft put the pausing-state
  list on the policy, which cannot reference states and duplicated the workflow's effects.)*
- `SLA-11` The currently implemented automatic workflow effects open one `sla_pause` row
  with reason `waiting_customer` per metric and close only matching open
  `waiting_customer` rows. At most one open row per `(work_item, metric)`. A transition
  that tries to open a pause while one is already open returns 409 and rolls back the full
  transition. Manual pause/resume and `resolved`-pause continuity on completion/reopen are
  held for a later release; no manual route is available and these effects are not inferred
  from state-group changes.
- `SLA-12` Paused intervals are subtracted from covered time.
- `SLA-13` The UI shows "Paused — waiting on customer since Tuesday" rather than a
  frozen countdown with no explanation.

**Events**

- `SLA-14` `sla-scan` runs every 5 minutes and compares computed state against
  `work_item_sla_cache`.
- `SLA-15` On a transition into `at_risk`, emit `sla.at_risk`. Into `breached`, emit
  `sla.breached`. Once each, per work item, per metric. *(Clarified 2026-09-18 during the
  P2 domain build: "once each" means per **transition into** the state — the scan fires
  nothing while a state merely persists, but a genuine state change re-fires the edge. A
  breached item can retreat to `at_risk` — pauses lower the consumed proportion — and
  breach again; that second breach is a real `sla.breached`. The cache stores only the
  current state, so this edge reading is the one its shape supports.)*
- `SLA-16` Events fan out to notifications, webhooks and the escalation path.
- `SLA-17` Escalation follows the project's stakeholder escalation order, waiting the
  configured interval between levels. A project with no stakeholders escalates to no one —
  escalation is a no-op (SLA-16's notifications to watchers still fire); it is not an error
  and needs no fallback assignee. *(Answered 2026-09-18, resolving the §11 Low finding.)*
- `SLA-15a` `sla.met` and `sla.missed` are emitted by the **transition into a
  `completed`-group state** (`WF-17`), not by `sla-scan` — an item whose `resolved_at` is
  set is outside the scan's candidate set. `sla-scan` emits only `sla.at_risk` and
  `sla.breached` ([events.md](events.md)).

**Display**

- `SLA-18` List surfaces show a compact badge: colour, icon and remaining time.
- `SLA-19` Detail shows a bar with consumed proportion, the at-risk marker, the due
  instant in the viewer's timezone, and the calendar's name.
- `SLA-20` Colour is never the only signal — see [accessibility](#pending-02-designaccessibility).
- `SLA-21` Customers see their own SLA state and due time, never the policy internals.

<a id="sla-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| See SLA state on a work item | `work_item:read` |
| Read policies | `sla_policy:read` |
| Create, edit, publish a policy | `sla_policy:manage` |
| Manage service calendars | `sla_policy:manage` |

<a id="sla-screens"></a>
### Screens

Policy list, policy editor (goal matrix by type × priority), calendar editor, SLA badge
and bar primitives, SLA columns in list and table, SLA reports.

Policy list/editor routes are `/dashboard/settings/workspace/sla-policies` and `/dashboard/settings/workspace/sla-policies/{id}`. The editor provides a metric-by-priority grid per work-item type, version-checked draft save and publish; calendar list/editor behavior is defined in [service calendars](feature-contracts-p2.md#service-calendars). SLA badge/bar primitives, columns and reports remain requirements regardless of current implementation.

The goal editor is a matrix, not a list of forms — service desk managers think in a grid
of "for this type at this priority, this long", and giving them anything else makes
authoring miserable.

<a id="sla-api"></a>
### API

```
GET   /api/sla-policies?workspaceId=…          sla_policy:read
POST  /api/sla-policies?workspaceId=…          sla_policy:manage
GET   /api/sla-policies/{id}                   sla_policy:read
PATCH /api/sla-policies/{id}                   sla_policy:manage
POST  /api/sla-policies/{id}/publish           sla_policy:manage
GET   /api/work-items/{key}/sla                work_item:read
```

Manual pause and resume routes are unavailable while the D1 pause-continuity decision is on
owner hold. Automatic workflow pause/resume effects remain available under SLA-10 and
SLA-11.

<a id="sla-selected-policy-authoring-contract"></a>
#### Selected policy-authoring contract

This contract is selected for implementation by the orchestrating session; it is not human
P4 approval. It does not define SLA evaluation, work-item binding, project health, or
calendar usage for projects.

- A policy belongs to one explicitly selected workspace. Collection create/list requests
  require reachable `workspaceId` query context; detail/update/publish resolve scope from
  the policy row. JSON bodies cannot override workspace scope. Calendar and work-item-type
  ids must resolve inside that workspace or the request is rejected without revealing
  cross-workspace existence.
- `POST /api/sla-policies?workspaceId=…` creates policy metadata and its first editable
  draft in that reachable workspace. The body is
  `{name, description, calendarId, atRiskThresholdPct, goals}`. The
  `goals` array contains `{metric, workItemTypeId, priority, targetMinutes}` entries.
  Bounds are: `name` 1–120 characters, `description` null or at most 2,000 characters,
  `atRiskThresholdPct` integer 1–99, and `targetMinutes` an integer from 1 through
  2,147,483,647.
  The canonical priority values are `low`, `medium`, `high`, and `urgent`.
- A goal matrix may omit a work-item type entirely, but a published version must include
  at least one type. For each included type, it must contain exactly one goal for every
  `(metric, priority)` pair: both metrics and all four priorities. Drafts may be empty or
  incomplete while they are being edited.
  Duplicate tuples, unknown metrics/priorities, non-positive targets, or cross-workspace
  references are validation failures (`422`). A type omitted from the selected policy version has
  no SLA goal; it does not borrow a lower-precedence policy's goal.
- A newly created policy has no active published version and exactly one editable draft.
  Each version snapshots its own `calendarId` and `atRiskThresholdPct` alongside its goal
  matrix. The calendar ID is pinned; the referenced calendar definition (timezone, windows,
  holidays) remains live and is resolved from `service_calendar` on every evaluation, so a
  calendar edit affects all SLAs that reference it without mutating a published version.
  Draft edits change the pinned ID and policy values; changing policy metadata never changes
  an existing published version's evaluation. The first `PATCH` after publication creates
  a draft by copying the active version's calendar, threshold, and full goal matrix; further
  patches replace the draft configuration. A draft is never used to evaluate a work item.
  There is at most one draft per policy. Its
  monotonically increasing `number` is allocated when the draft is created under the
  policy-row lock, after the highest existing number.
- Published versions are immutable. `POST /api/sla-policies/{id}/publish` validates the
  complete draft, sets `effective_from` from database time, and atomically moves
  `active_version_id` to it.
  Publishing when no draft exists returns `409`; an incomplete draft returns `422` and
  remains editable. The initial publication creates the first active version. The active
  pointer always names the newest published version; historical evaluation selects the
  published version with the greatest `effective_from` not after `sla_started_at`. SLA-3
  evaluates that version's own goals, pinned calendar ID, and threshold. The ID resolves to
  that calendar's current definition at read time (CAL-8); no historical copy of its windows,
  holidays, or timezone is stored in the version. If no version was effective then, the
  result is `none`.
- At creation or acceptance, source precedence is resolved from authoritative rows:
  work-item type override → the request type on the original accepted submission → project
  binding → workspace default. The greatest published `effective_from` not after
  `sla_started_at` is stored as `work_item.sla_policy_version_id`; no applicable version
  stores null. Duplicate submissions never change the original item's request type, start
  instant, or version pin. Existing items without trustworthy source history remain unpinned;
  their version is not guessed from today's mutable bindings.
- `GET /api/work-items/{key}/sla` reads the stored version pin and authoritative work-item
  facts. It loads that version's goals and threshold and resolves its pinned calendar ID to
  the current `service_calendar` row in the same workspace before calling
  `packages/domain`'s pure evaluator. A null pin returns `none`; a missing pinned version or
  referenced calendar is an integrity error, never a fallback. The response omits policy
  internals from customer-reachable work items. Until submission acceptance is implemented,
  this writer contract applies to direct work-item creation; it does not claim intake
  acceptance integration.
- Policy `version` is the optimistic-concurrency token. `GET` returns it and `PATCH` and
  `publish` accept the shared optional `If-Match: "<version>"` precondition. When supplied,
  a mismatch returns `409` with asserted and current versions and makes no change. Every
  successful metadata, draft, or publish change increments it exactly once. The comparison
  and write occur in one transaction under a policy-row lock; publish also promotes the
  version pointer in that transaction.
- `GET /api/sla-policies` takes required `workspaceId` (which must be in caller reach) plus
  the shared `cursor` and `limit`
  collection parameters (default 50, range 1–200), sorted by `(name ASC, id ASC)`. List
  rows include the active published summary and whether a draft exists. Detail returns
  policy metadata, concurrency version, active published version and goals, and draft
  version and goals when present. Draft goal contents are visible only to callers with
  `sla_policy:read` in that workspace.
- Create, patch, and publish each write one audit row in the same transaction as the
  policy change. The audit action identifiers are `sla_policy.created`,
  `sla_policy.updated`, and `sla_policy.published`, recorded in the audit action
  catalogue. Audit snapshots contain policy/version ids, changed
  field names, and safe scalar configuration, never raw request bodies. If the audit write
  fails, the mutation still commits and AU-14 records the bounded failure signal and
  notifies current instance administrators after commit. No SLA-policy domain event is
  emitted by this slice; the canonical event catalogue currently defines only SLA outcome
  events, and no policy-configuration event is needed for the documented lazy evaluation.
- There is no direct policy `DELETE` route in this slice. The existing edge-case statement
  that a policy in use cannot be deleted remains a required rule for a future deletion
  operation; it does not authorize an unlisted endpoint.

<a id="sla-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Item created outside covered hours | The clock starts at the next window opening, not at creation |
| Calendar changed while items are open | Recomputed immediately. No backfill needed |
| Priority raised mid-flight | The new goal applies from creation, so remaining time shrinks. This is intended and is why escalation is powerful |
| DST transition inside the window | Handled by evaluating in the calendar's timezone with a real timezone library, never by adding 3600 seconds |
| Holiday added retroactively | Recomputed. Deadlines move later. Warned about at save time |
| Work item moved to a project with a different policy | *(Corrected 2026-09-18, resolving the §11 review contradiction — the row previously said both "applies from the move" and "against original creation time".)* The policy resolved at the item's creation stays pinned for the item's life (SLA-3); a move records an activity row and changes nothing about the running clock. The new project's policy governs only items created after the move |
| Pause never closed | `reminder-scan` alerts after 30 days of continuous open pause; the item appears in the "stale paused" report the job publishes *(assigned to `reminder-scan` 2026-09-18, resolving the §11 Low finding that named no job)* |
| Policy deleted while in use | Refused. Must be replaced first |

<a id="sla-out-of-scope"></a>
### Out of scope

- Calendar definition → [service-calendars.md](feature-contracts-p2.md#service-calendars)
- Escalation path membership → [projects-and-engagements.md](feature-contracts-p1.md#projects-and-engagements)
- SLA reporting → [reports-and-dashboards.md](feature-contracts-p5.md#reports-and-dashboards)

<a id="sla-testing"></a>
### Testing

`packages/domain/src/sla/__tests__/` is the most important test suite in the product.
It must cover:

- Every state transition boundary, to the minute.
- 8×5, 12×5 and 24×7 calendars.
- Creation before, during and after a covered window.
- Weekends, single holidays, consecutive holidays, a holiday inside a pause.
- DST forward and backward transitions, in a timezone that observes them.
- Pauses: single, multiple, adjacent, overlapping (rejected), unclosed.
- Reopen after completion.
- Policy version selection for an item created before a policy change.
- Priority change mid-flight.

Integration: `sla-scan` emits each event exactly once. E2E: badge and bar render the same
values the API reports.

<a id="sla-open-questions"></a>
### Open questions

- Policy deletion and policy-binding management routes are outside this slice. The canonical nullable same-workspace binding columns on request type, project, work-item type and workspace are read by the SLA-1 resolver; no binding-management route is introduced here.
- CAL-8 is resolved by the selected contract above: policy versions pin the calendar ID,
  while calendar definitions remain live. Calendar edits affect evaluations that resolve
  that ID; they do not rewrite policy versions.

<a id="sla-related"></a>
### Related

- [ADR 0009](#pending-01-architectureadr0009-lazy-sla-evaluation)
- [Service calendars](feature-contracts-p2.md#service-calendars) · [Background jobs](background-jobs.md)

<a id="service-calendars"></a>
## Service calendars

- **Primary phase:** P2
- **Feature flag:** `feature.sla`
- **Depends on:** nothing

<a id="service-calendars-purpose"></a>
### Purpose

Define which hours count. Everything about SLA measurement depends on this: a four-hour
target means four hours of *contracted cover*, not four hours of clock.

A calendar is also how a managed service expresses what it sold — 8×5 business hours,
12×5 extended, or 24×7.

<a id="service-calendars-concepts"></a>
### Concepts

| Concept | Meaning |
| --- | --- |
| **Calendar** | Named set of weekly windows, a timezone, and a holiday list |
| **Window** | A start and end time on a given weekday, e.g. Monday 09:00–17:00 |
| **Holiday** | A date, or a date range, on which no window applies |
| **Cover** | The union of all windows minus holidays |

<a id="service-calendars-presets"></a>
### Presets

Seeded on workspace creation, all editable, all clonable.

| Preset | Windows |
| --- | --- |
| **24×7** | Every day, 00:00–24:00. No holidays |
| **8×5 business hours** | Mon–Fri 09:00–17:00 |
| **12×5 extended** | Mon–Fri 07:00–19:00 |
| **Follow the sun** | Multiple windows per day across regions |

<a id="service-calendars-data"></a>
### Data

`service_calendar` — `workspace_id`, `name`, `timezone`, `windows` jsonb,
`holidays` jsonb, `created_at`, `updated_at`, and `version integer not null default 1`.
The timestamps follow the shared data-model convention; `version` marks calendars as
optimistically concurrent resources.

```jsonc
{
  "windows": {
    "mon": [{ "from": 540, "to": 1020 }],
    "tue": [{ "from": 540, "to": 1020 }],
    "wed": [{ "from": 540, "to": 720 }, { "from": 780, "to": 1020 }],
    "sat": [],
    "sun": []
  },
  "holidays": [
    { "date": "2026-12-25", "name": "Christmas Day" },
    { "from": "2026-12-27", "to": "2026-12-31", "name": "Company shutdown" },
    { "recurs": "annually", "month": 1, "day": 1, "name": "New Year's Day" }
  ]
}
```

`windows[].from`/`.to` are minutes-from-midnight, `0..1440` (`09:00` = `540`, `17:00` =
`1020`) — not `"HH:MM"` strings; see `CAL-3`. Multiple windows per day are supported,
which is how a lunch break or a split shift is expressed. `holidays` takes three shapes —
a single date, an inclusive range, or a `{recurs, month, day}` rule for a date that
repeats every year (`CAL-12`).

<a id="service-calendars-behaviour"></a>
### Behaviour

- `CAL-1` A calendar has exactly one timezone. All windows are interpreted in it.
- `CAL-2` Windows may not overlap within a day. Overlaps are rejected at save.
- `CAL-3` Window boundaries are minutes-from-midnight, `0..1440` (see Data, above). A
  window ending at `1440` means midnight at the end of that day; `1440` never appears as
  a window's `from`. A window may not span midnight; use two windows on consecutive days.
- `CAL-4` A holiday removes all cover for that date, regardless of windows.
- `CAL-5` A calendar with no windows on any day provides zero cover. Allowed, warned
  about at save — the clock never advances, so items measured against it remain `ok`
  indefinitely.
- `CAL-6` Timezone handling uses a real IANA timezone database. DST transitions are
  handled by the library, never by arithmetic on offsets.
- `CAL-7` During a DST spring-forward, an hour that does not exist is skipped. During
  autumn fall-back, the repeated hour is counted once.
- `CAL-8` Changing a calendar takes effect immediately for all SLAs measured against it,
  because SLA state is computed on read. A published SLA policy version immutably pins the
  calendar ID and its own goals/threshold; evaluation resolves that ID to the calendar's
  current definition. Editing a calendar never rewrites a published policy version or
  captures a private copy of calendar windows/holidays/timezone. Changing its timezone
  requires explicit confirmation before save. The usage endpoint returns live project,
  policy-version, current-policy, and work-item references. The count is informational and
  does not replace the explicit timezone confirmation.
- `CAL-9` A calendar in use cannot be deleted. It must be replaced on every policy and
  project referencing it first. The usage screen reports aggregate references without
  exposing project or work-item names to a calendar reader (`GET
  /api/service-calendars/{id}/usage`, below). Deletion requires the existing pending-action
  request and browser approval; both request and approval recheck references.

<a id="service-calendars-holiday-management"></a>
### Holiday management

- `CAL-10` Holidays are entered manually, imported from an `.ics` file, or generated from
  a country preset for a given year (`POST .../holidays/preset`, below). Preset data is a
  versioned dataset bundled with the release — no external service call at request time —
  refreshed each release; per `CAL-11`, it is a starting point, never authority.
- `CAL-11` Country presets are shipped for common jurisdictions and are a starting point,
  not authority — the administrator confirms them.
- `CAL-12` A recurring holiday (every 25 December) is stored as a `{recurs: "annually",
  month, day}` rule (see Data, above) and expanded at read time: `isHoliday` and every
  coverage query check the rule directly against the date in question. Nothing is
  pre-expanded or persisted per year.
- `CAL-13` Adding a holiday retroactively moves deadlines later. Warned about, with a
  count of affected items.
- `CAL-14` Creating or updating a calendar writes one `audit_log` row in the same
  database transaction as the calendar mutation. If the audit insert fails, the calendar
  mutation still commits (`AU-14`). The bounded `mutation` audit-failure metric is
  recorded, and every active instance administrator receives a separate durable
  notification after the calendar transaction commits. Logs and notifications contain no
  raw error or calendar data. Calendar configuration has no secrets; audit before/after
  values contain only the calendar's name, timezone, windows and holidays. The work-item
  `activity` journal does not apply: its authoritative schema requires a `work_item_id`
  composite foreign key, and a calendar has no work item.
- `CAL-15` Calendar responses include `createdAt`, `updatedAt`, and `version`. `PATCH`
  accepts the optional `If-Match: "<version>"` header defined by
  [api-design.md](#pending-01-architectureapi-design-concurrency). When supplied, the
  server compares it while holding the calendar row lock; a mismatch returns `409` with
  the asserted and current versions and performs no mutation. Each successful update
  increments `version` and advances `updated_at`. The editor sends the loaded version and,
  after a `409`, keeps the draft available while offering to reload the latest calendar or
  explicitly resubmit that draft against the latest version.
- `CAL-16` Calendar list requests use the shared cursor collection contract. The default
  page size is 50 and `limit` accepts 1–200. Results sort by `(name ASC, id ASC)` and a
  cursor continues within the requested workspace. Each page returns server-issued
  `previousCursor` and `nextCursor` values for the tuple boundaries; either is null exactly
  when that adjacent page does not exist. `hasMore` is true exactly when `nextCursor` is
  non-null. A malformed, unsupported-version, or cross-workspace cursor returns `400`.
  Every page reports the exact workspace total. The list screen keeps one opaque cursor in
  its URL for Next, Previous, deep links, and browser Back. Pages are not a snapshot: rows
  created, renamed, or deleted while paging may change subsequent pages. If the server
  rejects a cursor with `400`, the error state keeps Retry and, when the URL has a cursor,
  offers the existing Reset action to clear it through registered URL navigation and load
  the first page. This also recovers from a cursor bookmarked in a different workspace.
- `CAL-17` Holiday import accepts only UTF-8 RFC 5545 VCALENDAR version 2.0 with finite,
  all-day VEVENT entries. Physical lines use CRLF endings and folded lines are unfolded
  before parsing. Each event requires a syntactically valid UID and DTSTAMP and a
  DTSTART with `VALUE=DATE`; optional DATE DTEND is exclusive and defaults to the next day.
  Stored ranges are inclusive. SUMMARY is optional RFC TEXT with reserved punctuation
  escaped per RFC 5545.
  Reject timed/TZID values, recurrence and exception properties, DURATION, nested/non-event
  components, malformed or unsupported properties, empty input/event sets, invalid real
  dates and any file with one invalid event. The complete allowlist is VCALENDAR VERSION
  (exactly `2.0`), PRODID (non-empty), optional CALSCALE (exactly `GREGORIAN`); and VEVENT
  UID, DTSTAMP, DTSTART, optional DTEND and optional SUMMARY. Reject all other properties.
  Never fetch URLs or execute file content. Limits:
  256 KiB decoded UTF-8 input, 1,000 events, 8 KiB per unfolded content line, 120 Unicode
  characters per name and 366 covered dates per event. Dates must fit canonical calendar
  bounds (years 1–9998). Import is atomic: no valid subset is committed when any event fails.
  Preserve existing holidays. Normalize names as Unicode NFC after trimming surrounding
  whitespace, with case preserved. Identity is exact canonical shape/date or range plus that
  normalized name; exact identities count as duplicates, while different names on the same
  day remain distinct. Retrying an identical import is a no-op: version, updatedAt, audit, outbox event
  and administrator alert do not change. If-Match is still checked under the row lock before
  returning a no-op. A successful import appends to current holidays under that lock,
  increments version once, and uses the existing calendar-update audit action, event and
  audit-failure semantics.
- A `service_calendar.*` event must be recorded in the durable outbox in the same
  transaction as its calendar mutation (`EV-1`). Create and update now write their
  catalogue event envelopes transactionally. They do not use the post-commit in-memory
  `publishEvent` emitter as a substitute. Approved deletion writes its audit and
  `service_calendar.deleted` event in the same transaction.
- `DELETE /api/service-calendars/{id}` creates a pending action and returns `202` per
  `pending-actions.md` (`PA-1`–`PA-15`); it never deletes the calendar directly. Approval
  rechecks the calendar version and all live project/SLA-version references under lock.

<a id="service-calendars-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| Read | `sla_policy:read` |
| Create, edit | `sla_policy:manage` |
| Delete | `sla_policy:manage`, as a pending-action request only (`PA-1`–`PA-15`); never a direct delete |

Deliberately reused rather than a `service_calendar:*` capability of its own: a calendar
has no independent lifecycle outside the SLA policies that reference it. The feature flag
`feature.sla` is shared with [SLA](feature-contracts-p2.md#sla) for the same reason — a calendar editor is
meaningless with SLA turned off.

<a id="service-calendars-screens"></a>
### Screens

**Calendar list** — name, timezone, weekly cover total and holiday count, with cursor
paging. The list does not show reference counts: `/usage` is per calendar and there is no
batched usage read, so counts appear in the editor instead. The list and editor screens are
specified at `/dashboard/settings/workspace/calendars` and `/dashboard/settings/workspace/calendars/{id}`.

**Calendar editor** — a week grid with draggable window blocks, a timezone selector, and a
holiday list with a year picker and bounded iCalendar file selection, event-name preview and
explicit import confirmation. Beside it, a server-calculated preview for the selected year.
The coverage preview currently reflects the last saved settings; saving is required before it
reflects editor changes. Changing an existing calendar's timezone opens a confirmation
warning that shows the live `/usage` reference counts (informational per `CAL-8`; if they
cannot be loaded the warning says so and confirmation remains available). A usage card
reports project, current-policy, retained-policy-version and work-item reference counts. Its
"Request deletion" action is available to `sla_policy:manage`, is disabled while any
reference exists (`CAL-9`), and when allowed creates the pending action and opens its
browser approval page; the calendar is not deleted until that approval.

The preview matters. Without it, an administrator cannot tell whether they have configured
what they meant, and calendar mistakes are silent and expensive.

<a id="service-calendars-api"></a>
### API

```
GET    /api/service-calendars?workspaceId=…&cursor=<opaque>&limit=50  sla_policy:read
POST   /api/service-calendars                 sla_policy:manage
GET    /api/service-calendars/{id}            sla_policy:read
PATCH  /api/service-calendars/{id}            sla_policy:manage
POST   /api/service-calendars/{id}/holidays/import   sla_policy:manage
POST   /api/service-calendars/{id}/holidays/preset?country={cc}&year={yyyy} sla_policy:manage
GET    /api/service-calendars/{id}/preview?year=2026 sla_policy:read
GET    /api/service-calendars/{id}/usage             sla_policy:read (aggregate counts only)
DELETE /api/service-calendars/{id}                   sla_policy:manage (pending action; no direct deletion)
```

The list response follows the generic collection envelope with calendar navigation edges:
`{data: ServiceCalendar[], page: {previousCursor: string | null, nextCursor: string | null, hasMore: boolean}, meta: {total: number}}`.
Each cursor is opaque, workspace-bound, direction-bound, and encodes a `(name, id)` tuple.
Forward and backward requests both return rows in ascending `(name, id)` order. If a stale
cursor produces an empty page, both cursors are null and the UI offers a return to the first
page. If a cursor is rejected, the error state preserves Retry and offers Reset when a
cursor remains in the URL; Reset clears that URL state and requests the first page.
This operation is new relative to accepted main; there is no previously published GET
response shape to replace in the main-to-PR OpenAPI comparison.

The import request is JSON `{ "ics": string }`; optional `If-Match: "<version>"` uses
CAL-15 concurrency semantics. The response is `{ calendar: ServiceCalendar, importedCount:
integer, duplicateCount: integer }`, with `calendar` using the safe DTO above. Parse and
validate the complete document before mutation; validation failure returns an actionable 400
and changes nothing. The editor offers file selection, preview of names and counts, explicit
confirmation, an all-or-nothing error state, then refreshes calendar and preview after success.
It never presents a successful subset when the server rejects any event. CAL-13 affected-item
counts remain unavailable and must be described as unavailable.

<a id="service-calendars-calendar-persistence-and-deletion-constraints"></a>
#### Calendar persistence and deletion constraints

Create/update transactions include the audit record and durable event envelope. Audit failure is isolated to its savepoint, records the mutation failure metric and notifies current instance administrators after commit while mutation/outbox commit (AU-14). Preview uses shared domain calculations and the last saved calendar definition.

`/usage` returns aggregate counts for project bindings, retained SLA policy versions, the current-version marker and bound work items, without exposing their names/titles. Deletion approval locks the calendar and rechecks references and its version. No direct-delete route is exposed.

Country presets require an authoritative bundled dataset specification naming supported country codes, provenance/version and refresh process. Do not infer a country list, provider or Follow the sun pattern. Feature enforcement uses the shared runtime flag contract; do not introduce an ad-hoc flag mechanism.

<a id="service-calendars-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Customer in a different timezone from the calendar | Deadlines are displayed in the viewer's timezone with the calendar's name shown, so there is no ambiguity |
| Holiday falling on a day with no windows anyway | No effect. Allowed |
| Overlapping holiday ranges | Merged |
| Window of zero length | Rejected |
| Calendar timezone changed | Recomputes everything. Requires explicit confirmation; the confirmation shows the live `/usage` reference counts |
| Leap second | Ignored. Not modelled |
| Country preset for a country with regional holidays | Presets are national only. Regional holidays are added manually |

<a id="service-calendars-out-of-scope"></a>
### Out of scope

- Per-person working hours and capacity → [time-and-cost.md](feature-contracts-p5.md#time-and-cost)
- On-call rotas — not in scope for v2

<a id="service-calendars-testing"></a>
### Testing

Unit tests in `packages/domain/src/calendar/`:

- Covered minutes between two instants for each preset.
- A span crossing a weekend; a span crossing a holiday; a span crossing both.
- Split windows within a day.
- DST forward and backward, in `Europe/London` and `America/New_York`.
- A start instant outside cover — the clock begins at the next opening.
- Year boundaries.
- Zero-cover calendars.
- CAL-17 parser profile, normalization, exclusive DTEND conversion, boundary dates, and
  rejected timed/recurring/unsupported/malformed input and all resource limits.

When the SLA detail read is wired, its browser journey edits a referenced calendar and
observes the open work item's due time change without changing the published policy version.
The API integration test exercises the current database-to-domain evaluation adapter and
proves that the immutable version continues to point at the same calendar ID while the live
calendar definition changes.
The CAL-17 API integration tests cover atomic rejection, duplicate no-op behavior, stale
If-Match ordering, preserved rows, event/audit behavior, and real SQL audit failure. A persisted
browser journey imports a file, verifies the stored response, then rejects a mixed valid/invalid
file and confirms the persisted calendar did not change.

<a id="service-calendars-open-questions"></a>
### Open questions

None for CAL-8: policy versions pin calendar identity and policy configuration, while the
calendar definition remains live and is read at evaluation time. See the selected
cross-feature rule in [SLA](feature-contracts-p2.md#sla-selected-policy-authoring-contract).

<a id="service-calendars-related"></a>
### Related

- [SLA](feature-contracts-p2.md#sla) · [ADR 0009](#pending-01-architectureadr0009-lazy-sla-evaluation)

<a id="request-types-and-catalogue"></a>
## Request types and catalogue

- **Primary phase:** P2
- **Feature flag:** `feature.intake`
- **Depends on:** work item types, workflows, SLA, custom fields

<a id="request-types-and-catalogue-purpose"></a>
### Purpose

Give customers a small, comprehensible menu of things they can ask for — instead of a
blank "describe your problem" box that produces unusable tickets.

A request type is a template: a name customers understand, a form that collects what the
team actually needs, and a mapping onto the internal work item type, workflow and SLA
policy that staff use.

This is Jira Service Management's best idea and the thing that most improves ticket
quality.

<a id="request-types-and-catalogue-concepts"></a>
### Concepts

| Concept | Meaning |
| --- | --- |
| **Request type** | Customer-facing template. "Report a printer fault" |
| **Group** | A heading in the catalogue. "Hardware", "Access", "New work" |
| **Form** | The fields shown to the customer, defined by a schema |
| **Catalogue** | The set of request types visible to a given customer |
| **Version** | An immutable snapshot of a form, so old submissions remain interpretable |

<a id="request-types-and-catalogue-data"></a>
### Data

`request_type`, `request_type_version`, `organisation_request_type` (the per-organisation
catalogue — **no row ⇒ not visible and not submittable**, [data-model.md](data-model.md)),
`deflection_event` (P5, owned by [knowledge-base.md](feature-contracts-p5.md#knowledge-base); see Deflection
below). The form schema is JSONB.

`request_type.key` is an opaque, server-generated CUID2 value, generated independently
from the row's primary key and unique across the instance. It is immutable and is the
stable identifier used by portal catalogue routes. Create and update requests cannot set
or change it; the display name remains editable.

```jsonc
{
  "fields": [
    { "key": "summary", "type": "text", "label": "What's wrong?", "required": true },
    { "key": "location", "type": "select", "label": "Where?",
      "options": ["Ward 3", "Reception", "Theatre 1"], "required": true },
    { "key": "asset", "type": "text", "label": "Asset tag", "help": "On the sticker" },
    { "key": "impact", "type": "select", "label": "Who is affected?",
      "options": ["Just me", "My team", "Everyone"], "required": true,
      "mapsTo": { "field": "priority",
                  "map": { "Just me": "low", "My team": "medium", "Everyone": "high" } } },
    { "key": "asset_details", "type": "text", "label": "Which asset?",
      "showIf": { "field_key": "impact", "op": "eq", "value": "Just me" } },
    { "key": "attachments", "type": "file", "label": "Photos", "multiple": true }
  ]
}
```

`showIf` reuses `custom_field.visibility_condition`'s exact shape
(`{ field_key, op: eq|neq|in|is_set, value }` — [data-model.md](data-model.md))
rather than inventing a second conditional vocabulary for request-type forms. Both the
publish validator and the portal renderer evaluate it against the same field-key namespace
as the form itself.

<a id="request-types-and-catalogue-behaviour"></a>
### Behaviour

**Definition**

- `RT-0` The request-type route key is an immutable opaque instance-unique identifier,
  generated by the server independently from the primary key. It is not derived from the
  editable display name.
- `RT-1` A request type maps to exactly one work item type, which supplies the workflow.
- `RT-2` It may override the SLA policy inherited from the project.
- `RT-3` A form field either maps to a native field (`mapsTo`), maps to a custom field, or
  is stored in `submission.form_data` and rendered into the work item description.
- `RT-4` `mapsTo` may translate values, as in the impact-to-priority example. This is how
  you avoid asking customers to choose a priority, which they always get wrong.
- `RT-5` Fields support conditional visibility: show this field only when that field has
  this value. See the `showIf` example in Data above.
- `RT-6` Publishing creates an immutable snapshot of the form schema, mapped work-item
  type, request-type SLA override and default assignee. Submissions record which version
  they used, so edits to the live request type cannot silently remap a queued submission.
  The selected work-item type still supplies its own workflow; a request type has no
  separate workflow override. Acceptance (owner decision, issue #761):
  - The submission's pinned version supplies the form schema and its field mapping, the
    request-type SLA override and the default assignee. A missing version fails acceptance
    with `409`, and the live request type is never consulted instead.
  - The work-item type and destination project are pre-filled from the snapshot but are the
    triager's choice (`IQ-7`). The chosen type must exist in the same workspace; otherwise
    acceptance fails with `422` and nothing is created.
  - The SLA policy follows `SLA-1` (chosen work-item type, then the snapshotted request-type
    override, then the project, then the workspace default). A policy that is not in the
    workspace fails acceptance with `422` and nothing is created. The database also refuses a
    cross-workspace policy reference in a snapshot.
  - A snapshotted default assignee who is not an active staff member of the destination
    project does not fail acceptance. The work item is created unassigned and the
    `submission.accepted` audit row records `defaultAssigneeSkipped` with the person id and a
    reason (`not_a_project_member`, `inactive` or `not_staff`). No event key is added.
  - Acceptance is atomic, and it never substitutes a mapping from the live request type.

**Catalogue**

- `RT-7` A request type is visible in the portal only if `customer_visible` and an
  `organisation_request_type (organisation_id, request_type_id)` row exists linking it to
  the customer's organisation — [data-model.md](data-model.md). This is
  the per-organisation catalogue: the mapping table, not `request_type.group` (a plain
  display heading, not a visibility control).
- `RT-8` Per-organisation catalogues are a subset — one customer sees eight request types,
  another sees three. `RT-8a` **No `organisation_request_type` row for a given organisation
  and request type ⇒ that request type is invisible in that organisation's catalogue and
  unsubmittable, even by a crafted request naming its key directly.** Deny is the default;
  nothing is visible until explicitly assigned. Catalogue assignment is managed from God
  Mode: `PUT /api/instance/organisations/{id}/catalogue` (`instance:admin` —
  [god-mode.md](feature-contracts-p4.md#god-mode)), not from this spec's own API — an instance administrator
  assigns catalogues to organisations, the same way portal access and quotas are assigned.
- `RT-9` Ordering within a group is manual. Groups are ordered manually.
- `RT-10` The catalogue is searchable. Searching also matches knowledge base articles, but
  that half is **P5-gated behind `feature.knowledge_base`** — [knowledge-base.md](feature-contracts-p5.md#knowledge-base)
  — since KB does not exist until P5; the request-type catalogue search itself is P2.

**Deflection**

This whole section is **P5-gated behind `feature.knowledge_base`** — it has no effect
until [knowledge-base.md](feature-contracts-p5.md#knowledge-base) ships, since there are no articles to offer
before then. Deflection storage (`deflection_event`) and the routes that record a
candidate and an abandonment are owned by `knowledge-base.md` (`KB-10`), not duplicated
here, to avoid two specs each defining the same write path differently.

- `RT-11` As a customer types a summary, matching published KB articles are offered:
  "This might help: *Resetting your VPN password*". Suggestions come from
  `GET /api/portal/kb/deflection?q=…` (see API below).
- `RT-12` Opening an article records a deflection candidate in `deflection_event`
  (`person_id`, `request_type_id`, `kb_article_id`, `query`, `abandoned_at` null —
  [data-model.md](data-model.md)). If the customer then abandons the
  form, `knowledge-base.md`'s recording route sets `abandoned_at`, and it counts as a
  deflection in reporting.
- `RT-13` Deflection is never coercive. There is no "are you sure you still want to raise
  this?" step. It offers help and gets out of the way.

**Submission**

- `RT-14` Submitting creates a `submission` with reference `SUB-n`, not a work item.
  `n` comes from an instance-wide counter (`submission.number` — never reused, never a
  primary key — [data-model.md](data-model.md)), the same convention as
  `work_item.number`. Triage turns it into one. See [intake queue](feature-contracts-p2.md#intake-queue) `IQ-2`.
- `RT-15` A request type may be marked **auto-accept** (`request_type.auto_accept boolean` —
  [data-model.md](data-model.md)), in which case a work item is created
  immediately and the submission is closed. Used for well-understood, high-volume requests.
  Auto-accept requires a pinned default project that is active, in the request type's
  workspace, and serves the submitting organisation. Publishing, submission, and
  acceptance revalidate that binding atomically; the customer never selects a project and
  the server never chooses an arbitrary project (decision log: 2026-10-04 “Bind customer-serving projects at creation” and 2026-10-07
  “Auto-accept actor attribution for intake acceptance”, recovered on 2026-10-13). Manual acceptance remains
  governed by `IQ-7`.
  Every organisation mapping that advertises a published auto-accept request type must
  match that pinned project's single `organisation_id`; a project serving one organisation
  cannot advertise the type to another. Publication validates all configured mappings in
  the same transaction as the request-type/version/project checks. The God Mode catalogue
  assignment writer must serialize against that validation and enforce the same binding
  before changing mappings; its route is specified in `god-mode.md`, not implemented here.
  Its `submission.accepted` audit and outbox event use the `system` actor with no person
  actor id and display name `Request type auto-accept`; the customer remains the requester
  and initiator. Manual acceptance uses the acting staff person's identity and name.
- `RT-16` Drafts are persisted per request type per version, so a half-completed form
  survives a closed tab — stored in `localStorage`, and therefore per device: a draft
  started on one device is not visible on another. Same mechanism as
  [comments-and-activity.md](feature-contracts-p1.md#comments-and-activity) `CA-16`. Cleared on successful
  submission.

<a id="request-types-and-catalogue-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| List/read request types (staff) | `request_type:read` |
| See the catalogue (portal) | `{ portal: 'customer', predicate: 'own_organisation' }` — [rbac.md](permissions.md) kind 3 |
| Submit | `{ portal: 'customer', predicate: 'own_organisation' }` |
| Create, edit, publish, unpublish, delete a request type | `request_type:manage` |
| Assign a catalogue to an organisation | `instance:admin` — via God Mode, not this spec's API ([god-mode.md](feature-contracts-p4.md#god-mode)) |

<a id="request-types-and-catalogue-screens"></a>
### Screens

**Agent** — request type list; request type editor with a drag-to-arrange form builder,
a live preview of the customer's view, and version history.

**Portal** — catalogue grouped with icons and one-line descriptions; the request form;
a confirmation showing the reference.

The form builder's live preview is not optional polish. Someone authoring a form must see
exactly what a customer will see, or they will author something unusable.

<a id="request-types-and-catalogue-api"></a>
### API

```
GET    /api/request-types                        request_type:read
POST   /api/request-types                        request_type:manage
PATCH  /api/request-types/{id}                   request_type:manage
POST   /api/request-types/{id}/publish           request_type:manage
POST   /api/request-types/{id}/unpublish         request_type:manage
DELETE /api/request-types/{id}                   request_type:manage   (refused unless already unpublished — see edge cases)
GET    /api/portal/catalogue                     { portal: 'customer', predicate: 'own_organisation' } — rbac.md kind 3
GET    /api/portal/catalogue/{key}               { portal: 'customer', predicate: 'own_organisation' }
POST   /api/portal/submissions                   { portal: 'customer', predicate: 'own_organisation' }
GET    /api/portal/kb/deflection?q=…             { portal: 'customer', predicate: 'own_organisation' } — P5, owned by knowledge-base.md (KB-10/KB-12)
```

Per-organisation catalogue assignment is a God Mode action, not a route on this router:
`PUT /api/instance/organisations/{id}/catalogue` (`instance:admin` — [god-mode.md](feature-contracts-p4.md#god-mode)).

<a id="request-types-and-catalogue-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Request type deleted with open submissions | Refused. Must be unpublished first, which hides it from the catalogue but leaves existing submissions intact |
| Form field removed in a new version | Old submissions render against their own version and still show the value |
| Required field added in a new version | Applies only to new submissions |
| Customer's organisation has no catalogue entries | The portal shows an explanatory empty state with the support email, not a blank page |
| Conditional field whose controlling field is removed | Validation at publish rejects it |
| `mapsTo` a custom field that is later deleted | Publish validation rejects it; an already-published version stores the raw value |
| Very long option lists | The select becomes a searchable combobox above 10 options |

<a id="request-types-and-catalogue-out-of-scope"></a>
### Out of scope

- What happens after submission → [intake-queue.md](feature-contracts-p2.md#intake-queue)
- Custom field definitions → [custom-fields.md](feature-contracts-p4.md#custom-fields)
- KB article authoring → [knowledge-base.md](feature-contracts-p5.md#knowledge-base)

<a id="request-types-and-catalogue-testing"></a>
### Testing

Unit: form schema validation; conditional visibility evaluation; `mapsTo` translation.

Integration: a submission against version 1 renders correctly after version 2 is
published; `RT-8a` a request type with no `organisation_request_type` row for the caller's
organisation is absent from `GET /api/portal/catalogue` **and** refused (not merely
hidden) by `POST /api/portal/submissions` when submitted directly by key, bypassing the
catalogue UI entirely.

E2E: browse catalogue, see deflection suggestions, complete a conditional form, submit,
see the reference; draft survives reload.

<a id="request-types-and-catalogue-open-questions"></a>
### Open questions

None.

<a id="request-types-and-catalogue-related"></a>
### Related

- [Intake queue](feature-contracts-p2.md#intake-queue) · [Customer portal](feature-contracts-p3.md#customer-portal) · [SLA](feature-contracts-p2.md#sla)

<a id="intake-queue"></a>
## Intake queue

- **Primary phase:** P2
- **Feature flag:** `feature.intake`
- **Depends on:** request types, work items, notifications

<a id="intake-queue-purpose"></a>
### Purpose

The gap between "a customer asked for something" and "the team committed to doing it".

A submission is not yet a work item. It has not been read, categorised, sized or accepted.
Turning every submission into a work item immediately pollutes the backlog with
duplicates, misfiled requests and things that turn out to be questions.

Intake is where a human — or an automation — makes that judgement.

<a id="intake-queue-concepts"></a>
### Concepts

| Concept | Meaning |
| --- | --- |
| **Submission** | A raw customer request. Reference `SUB-n` |
| **Triage** | Deciding what a submission becomes |
| **Clarification** | Asking the customer for more before deciding |
| **Acceptance** | Converting a submission into a work item |

<a id="intake-queue-statuses"></a>
### Statuses

| Status | Meaning |
| --- | --- |
| `new` | Received, not yet looked at |
| `clarifying` | Waiting on the customer |
| `accepted` | Converted to a work item |
| `declined` | Rejected, with a reason given to the customer |
| `duplicate` | Merged into an existing work item |
| `withdrawn` | The customer cancelled it themselves, before triage started |

<a id="intake-queue-data"></a>
### Data

`submission`, `submission_message`. A submission holds `form_data` and the request type
version it was made against, plus `claimed_by`/`claimed_at` (`IQ-16a`), `customer_visibility`
and `work_item_id` (set on acceptance) — [data-model.md](data-model.md).

<a id="intake-queue-behaviour"></a>
### Behaviour

**Arrival**

- `IQ-1` A submission is created by the portal, or by an inbound email (see Out of scope —
  inbound email is a roadmap candidate, not scheduled). Creation by a non-portal API client
  is **not offered**: no customer-facing API credential exists in this architecture
  ([webhooks-and-api-keys.md](feature-contracts-p4.md#webhooks-and-api-keys)'s API keys are workspace/staff-scoped
  only), and inventing one is a separate, larger decision this spec does not make.
- `IQ-2` It gets a reference `SUB-n`. `n` comes from `submission.number`, an instance-wide
  counter — never a primary key, never reused — the same convention as `work_item.number`
  ([data-model.md](data-model.md)).
- `IQ-3` A submission has a **durable page** the customer can return to at any time,
  linkable, surviving sign-out. *(v1 got this right and it matters — customers bookmark
  it.)* The mechanism is an ordinary portal session, not a bearer token in the URL: the
  route requires `{ portal: 'customer', predicate: 'own_submission' }`
  ([rbac.md](permissions.md) kind 3), and "durable" means the URL itself never
  changes (`IQ-11`) and stays valid across sign-out/sign-in cycles for that requester —
  not that `SUB-n` alone is a credential. Knowing a reference grants nothing without a
  session scoped to it.
- `IQ-4` A request type marked auto-accept skips intake entirely. It requires a pinned
  default project that is active, in the request type's workspace, and serves the submitting
  organisation. Publishing, submission, and acceptance revalidate this binding atomically;
  the customer never chooses a project and the server never chooses one arbitrarily
  (decision log: 2026-10-04 “Bind customer-serving projects at creation” and 2026-10-07
  “Auto-accept actor attribution for intake acceptance”, recovered on 2026-10-13). Manual
  acceptance remains governed by `IQ-7`. Its
  `submission.accepted` audit and outbox event use the `system` actor with no person actor
  id and display name `Request type auto-accept`; the customer remains the requester and
  initiator. Manual acceptance uses the acting staff person's identity and name
  ([request-types-and-catalogue.md](feature-contracts-p2.md#request-types-and-catalogue) `RT-15`).

**Triage**

- `IQ-5` The queue shows: reference, customer, organisation, request type, summary, age,
  and any suggested duplicates.
- `IQ-6` Triage actions are: **Accept**, **Decline**, **Merge as duplicate**,
  **Ask for clarification**.
- `IQ-5a` Triage happens within reach. Suggested duplicates name only work items of projects the
  triager reaches. Accepting into, or linking a submission to a work item of, a project outside
  the triager's reach is answered exactly like a missing project or work item (accept: the same
  422 as a missing destination, so no existence signal, and the failed accept leaves no claim
  (`IQ-16a`); link: the same 404). Nothing is converted or linked. For an accepted
  submission, the staff detail shows the work item id and the comments carried over from it only
  to a triager who reaches the work item's project.
- `IQ-7` Accepting requires choosing the project and confirming the work item type. Both
  are pre-filled from the request type; the pre-fill is a suggestion, not a decision.
- `IQ-8` On acceptance, form data is mapped onto native and custom fields per the request
  type's `mapsTo` rules, and anything unmapped is rendered into the description under a
  clear heading.
- `IQ-9` Attachments transfer to the work item, preserving customer visibility
  (`attachment.submission_id` before acceptance, `attachment.work_item_id` after —
  [data-model.md](data-model.md)).
- `IQ-10` The submission thread transfers to the work item as public comments, **preserving
  each message's original `created_at`** (not the moment of transfer), so the conversation
  is not lost and so `SLA-7`'s `first_response_at` — set from the earliest public staff
  comment — is computed correctly even when the actual first response was a
  pre-acceptance clarification message.
- `IQ-11` The customer's portal view switches from the submission page to the work item,
  keeping the same URL. They should never have to learn that a conversion happened.

**Clarification**

- `IQ-12` Asking for clarification posts a message to the submission thread and notifies
  the customer.
- `IQ-13` The customer replies on the submission page. Status returns to `new`.
- `IQ-14` The first-response SLA clock, if the request type has one, is measured against
  the point of **submission**, not acceptance: on acceptance, `work_item.sla_started_at` is
  copied from the submission's `created_at` (`SLA-4` — [sla.md](feature-contracts-p2.md#sla)), and `dueAt` is
  computed backdated from that instant. There is no separate pre-acceptance clock or cache
  row on the submission itself — the SLA engine only measures a `work_item`, and none
  exists until acceptance, so covered time between submission and acceptance is counted
  retroactively the moment the work item is created. **This means a team can be in breach,
  or already `at_risk`, at the instant they accept a long-clarifying submission** — the
  clock was always running from `created_at`, acceptance just makes it visible. Stops at
  the first public comment by a staff member (`SLA-7`) — including a clarification
  request, which is posted as one.
- `IQ-15` A submission in `clarifying` for longer than `instance_setting.clarification_window_days`
  (default 14 — [data-model.md](data-model.md)) is auto-declined with a
  message, and the customer may reopen it. Only this auto-decline is reopenable by the
  customer; a staff decline (`IQ-16`) is final for the customer (decision log,
  2026-09-25). Enforced by `reminder-scan`
  ([background-jobs.md](background-jobs.md)), which runs every 15
  minutes.

**Declining and duplicates**

- `IQ-16` Declining requires a reason, which is shown to the customer verbatim. There is
  no silent decline.
- `IQ-16a` The customer may withdraw their own submission at any time while it is `new` or
  `clarifying`. The moment a triager takes any action on it — a queue claim, a message, or a
  successful acceptance — withdrawal is refused (a failed acceptance leaves no claim); from then on the submission is the triage
  team's to dispose of. A withdrawn submission is retained (not deleted), visible to the
  customer as a record and to staff in the queue, filterable out by default. **Enforcement:**
  `submission.claimed_by`/`claimed_at` ([data-model.md](data-model.md))
  are set the moment any of the three triggering actions happens — an explicit
  `POST /api/submissions/{ref}/claim` (see API below), the first `POST .../messages`, or a
  `POST .../accept` — whichever happens first, all under a conditional write
  (`WHERE claimed_by IS NULL`) so a race between a claim and a customer withdrawal is
  resolved the same way as the accept race in the edge cases below: whichever commits
  first wins. The accept claim is taken in the same transaction as conversion, so an
  accept that fails (for example a missing or unreachable destination project) rolls the
  claim back and leaves the submission unclaimed (owner decision, issue #743). `POST .../withdraw` is refused with `409` once `claimed_by` is set.
- `IQ-17` Merging as duplicate links the submission to an existing work item and adds the
  customer as a watcher on it, so they still get updates.
- `IQ-18` Duplicate suggestions are offered by trigram similarity
  (`similarity(work_item.title, :query) > 0.3` — pg_trgm's own default threshold, over the
  `gin (title gin_trgm_ops)` index already in [data-model.md](data-model.md))
  over work items created in the same organisation in the last 90 days. Suggestions only —
  the decision is human.

**Queues**

- `IQ-19` A queue over submissions *and* work items is **two saved views presented
  together**, not one document — `saved_view.query.entity` is `submission | work_item`
  (among others), each with its own field whitelist
  ([api-design.md](#pending-01-architectureapi-design)). "Queue" is the UI grouping of the
  two, owned by a team.
- `IQ-20` A queue may be shared with a team or kept private.
- `IQ-21` Every queue has a URL, including its filters. *(v1's triage filters were not
  addressable, which made "look at this queue" an unshareable instruction.)*

<a id="intake-queue-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| See the intake queue | `intake:triage` |
| Claim, accept, decline, merge | `intake:triage` |
| Ask for clarification | `intake:triage` |
| Manage queues | `intake:triage` |
| See own submission | `{ portal: 'customer', predicate: 'own_submission' }` — [rbac.md](permissions.md) kind 3 |
| Withdraw own submission (before triage starts) | `{ portal: 'customer', predicate: 'own_submission' }` |

<a id="intake-queue-screens"></a>
### Screens

**Agent** — intake queue list; submission detail with form data, thread, attachments and
duplicate suggestions; accept dialog; decline dialog; queue management.

**Portal** — submission confirmation; durable submission page with the thread; reply box.

The submission detail should let a triager decide without leaving the screen. Everything
needed — what was asked, by whom, what similar work exists — is visible at once. This is
the one screen where density is a feature.

<a id="intake-queue-api"></a>
### API

```
GET    /api/submissions                        intake:triage
GET    /api/submissions/{ref}                  intake:triage
POST   /api/submissions/{ref}/claim            intake:triage   (sets claimed_by/claimed_at, IQ-16a)
POST   /api/submissions/{ref}/accept           intake:triage
POST   /api/submissions/{ref}/decline          intake:triage
POST   /api/submissions/{ref}/duplicate        intake:triage
POST   /api/submissions/{ref}/messages         intake:triage
GET    /api/submissions/{ref}/duplicates       intake:triage
GET    /api/portal/submissions                 { portal: 'customer', predicate: 'own_organisation' } — filtered to the caller's own submissions
GET    /api/portal/submissions/{ref}           { portal: 'customer', predicate: 'own_submission' }
POST   /api/portal/submissions/{ref}/messages  { portal: 'customer', predicate: 'own_submission' }
POST   /api/portal/submissions/{ref}/withdraw  { portal: 'customer', predicate: 'own_submission' }   (requester only)
```

<a id="intake-queue-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Customer replies after acceptance | The reply lands as a public comment on the work item |
| Accepted into a project the customer cannot see | Refused. The project must serve their organisation |
| Two triagers accept simultaneously | Optimistic concurrency: the second gets 409 and is shown the work item the first created |
| Submission with no request type (inbound email) | Goes to a default "Uncategorised" type; triage assigns the real one |
| Attachment fails to transfer on acceptance | Acceptance rolls back. Better to retry than to lose the file |
| Customer account deleted with an open submission | Submission retained, requester tombstoned |
| Very large form data | Rendered into the description with a collapsible section |
| Customer withdraws the instant a triager starts accepting it | Optimistic concurrency: whichever commits first wins; the loser sees a clear message rather than a generic error |
| Customer returns to the durable submission page after it was **declined** | The page shows the decline reason verbatim (`IQ-16`); the URL does not change and does not redirect |
| Customer returns to the durable submission page after it was **withdrawn** | The page shows the withdrawn status as a record (`IQ-16a`); the URL does not change and does not redirect |
| `SUB-n` alone, with no session | `404` — a reference is not a credential; the portal predicate `own_submission` requires an authenticated session scoped to that submission |

<a id="intake-queue-out-of-scope"></a>
### Out of scope

- Form definition → [request-types-and-catalogue.md](feature-contracts-p2.md#request-types-and-catalogue)
- Automated triage rules → [automations.md](feature-contracts-p4.md#automations)
- Inbound email parsing — **a candidate, not scheduled**; see the "candidates, not
  commitments" table in [roadmap.md](#pending-07-planningroadmap). `IQ-1` names email as a
  source so the data model does not preclude it, not because it is planned for a stage.
  *(Corrected 2026-09-05 — this line previously said "Stage 5", contradicting the roadmap.)*
- Submission creation by a non-portal API client — **not offered.** An earlier draft of
  `IQ-1` named this as a source; removed 2026-09-23 because no customer-facing API
  credential exists anywhere in this architecture to authenticate it, and designing one
  (scope, issuance, revocation) is a decision this spec does not make. Revisit if a real
  integration need appears.

<a id="intake-queue-testing"></a>
### Testing

Unit: field mapping from form data to work item; duplicate similarity scoring.

Integration: acceptance transfers attachments and thread atomically, preserving each
message's original `created_at`; a rollback on attachment failure leaves no partial work
item; concurrent acceptance yields one work item; `IQ-3` a request for `GET
/api/portal/submissions/{ref}` with `SUB-n` alone and no session, or a session belonging to
a different organisation, is refused — a reference grants no access by itself; `IQ-16a` a
claim, a message and an accept attempt racing a withdrawal each resolve to exactly one
winner, with the loser's action refused rather than silently accepted.

E2E: submit from the portal, triage, accept, and confirm the customer's URL now shows the
work item without them navigating; decline with a reason and confirm the customer sees it.

<a id="intake-queue-open-questions"></a>
### Open questions

None.

<a id="intake-queue-related"></a>
### Related

- [Request types](feature-contracts-p2.md#request-types-and-catalogue) · [Customer portal](feature-contracts-p3.md#customer-portal)
- [Search and saved views](feature-contracts-p1.md#search-and-saved-views)

<a id="approvals"></a>
## Approvals and CAB

- **Primary phase:** P2
- **Feature flag:** `feature.approvals`
- **Depends on:** workflows, notifications

<a id="approvals-purpose"></a>
### Purpose

Record a decision by a named person, with an expiry, and optionally block a workflow
transition until it is made.

Two kinds, deliberately distinguished:

| Kind | Who decides | Typical use |
| --- | --- | --- |
| **Customer approval** | A customer contact | "Do you accept this quote / this resolution?" |
| **CAB approval** | Internal change advisory board members | "May this change be deployed?" |

They differ in who may request, who may decide, and where they surface. Conflating them
was one of v1's bugs — a customer account could request an internal CAB approval.

<a id="approvals-concepts"></a>
### Concepts

| Concept | Meaning |
| --- | --- |
| **Approval** | A request for a decision, on a work item, from a person, with an expiry |
| **Requester** | Who asked |
| **Approver** | Who must decide |
| **State** | `pending` · `approved` · `rejected` · `expired` · `withdrawn` — the `approval.state` enumeration in [data-model.md §7](data-model.md) |
| **Gate** | A workflow transition that requires an approval before it may be made |

<a id="approvals-data"></a>
### Data

`approval` — the authoritative column list is [data-model.md §7](data-model.md)
(`state`, `transition_id`, `reminder_50_sent_at`, `reminder_90_sent_at` and the rest); this
document does not repeat it. `workflow_transition.approval_policy` (`any`\|`all`,
[data-model.md](data-model.md)) is what `AP-5` reads to decide the gate;
[workflows.md](feature-contracts-p2.md#workflows) owns the transition side of that column.

<a id="approvals-behaviour"></a>
### Behaviour

The `feature.approvals` flag resolves project → workspace → instance → built-in default
([settings hierarchy](feature-contracts-p4.md#settings-hierarchy) ST-1; [plugin architecture](#pending-01-architectureplugin-architecture-feature-toggles)).
Its built-in default remains `false`. When disabled, new approval requests are refused and
the request action is hidden or disabled. Existing approvals remain available under their
existing permissions and current-reach rules: they can be listed, read, decided, withdrawn,
and processed by `reminder-scan`. Disabling the flag never bypasses an approval requirement
on a workflow transition.

**Requesting**

- `AP-1` A customer approval may be requested by staff with `approval:request`, on a work
  item within their reach.
- `AP-2` A CAB approval may be requested **only by staff**, and only on a work item whose
  `work_item_type.is_change` is true ([data-model.md](data-model.md) —
  the same flag `WF-14` uses, never matched by type name). A customer-side account
  attempting it is refused. *(This was a real v1 defect.)*
- `AP-3` The approver must be a person with reach on the work item. Approvers outside
  reach are not offered and are refused if submitted.
- `AP-4` Expiry defaults to 7 days (`instance_setting.approval_default_expiry_days`,
  [data-model.md](data-model.md) — instance-wide, not per-workspace or
  per-request-type), configurable per request, capped at 90 days.
- `AP-5` Multiple approvals may be pending on one work item. The gate is satisfied by the
  policy set on the transition (`workflow_transition.approval_policy`): **any** approver,
  or **all** approvers. Only approvals whose `transition_id` names *that* transition count
  toward it — an approval raised against a different transition, even the same `kind`, on
  the same work item never satisfies this gate.
  Only `pending`, `approved` and `rejected` approvals count. A `withdrawn` or `expired`
  approval is ignored entirely, so withdrawing can never block a gate
  ([decision log](#pending-07-planningdecision-log), 2026-10-10 "single-use approvals,
  withdrawn approvals ignored"). Approvals are **single use**: an approval is consumed by a
  run of its transition, so an approval raised before the transition last ran for this work
  item no longer counts, and repeating the transition needs a new approval.
  When a transition runs it also **closes** the other approvals for that transition that are
  still pending: they move to `expired` (the existing terminal state), are audited as
  `approval.closed`, leave inboxes and reminders, and a later decide is refused with 409.
- `AP-6` The requester may withdraw a pending approval. It becomes `withdrawn` (emitting `approval.withdrawn`), not
  deleted.

**Deciding**

- `AP-7` Only the named approver may decide. Not their manager, not an admin.
  An instance admin may *withdraw* on their behalf through the session-only
  `POST /api/admin/approvals/{id}/withdraw` route, which is audited. This route requires
  current `instance:admin` authority and rejects API keys. It is session-only without
  step-up: withdrawal changes approval state but grants no authority, so its route policy
  carries an explicit elevation exemption. The requester route remains
  available to the actual requester, including scoped API keys that hold
  `approval:request` and have current work-item reach.
- `AP-8` **Nobody may approve a request they raised.** Enforced in the domain layer,
  independent of capabilities.
- `AP-9` A decision requires a note when rejecting. Approving may be noteless.
- `AP-10` A decision is final. Changing your mind means a new approval request.
- `AP-11` Deciding writes an activity entry, notifies the requester and watchers, and
  emits `approval.decided`.

**Expiry**

- `AP-12` `reminder-scan` compares the UTC wall-clock values in `created_at` and `expires_at`
  with the database's UTC wall clock, independent of the database session time zone. It expires
  approvals past `expires_at`, setting status `expired`. `expired`
  also covers a pending approval **closed by a run of its transition** (`AP-5`, owner decision
  2026-10-10): its `expires_at` may then still be in the future; `decided_at` records the closure
  and the audit row `approval.closed` says why.
- `AP-13` A reminder is sent to the approver at 50% and 90% of the window, measured from
  `created_at` to `expires_at` using those stored UTC wall-clock values.
  `reminder_50_sent_at` / `reminder_90_sent_at` record which have already fired, so
  `reminder-scan`'s 15-minute cadence never re-sends one ([background-jobs.md](background-jobs.md)).
- `AP-14` An expired approval does not satisfy a gate. A new one must be requested.

**Gating**

- `AP-15` A workflow transition with `requires_approval` is blocked until a matching
  approval is `approved` — "matching" means `approval.transition_id` equals this
  transition's id, per `AP-5`.
- `AP-16` `requires_cab` behaves identically but only accepts `kind = cab`.
- `AP-17` The blocked transition reports why: "Waiting on approval from Jane Smith,
  requested 2 days ago, expires in 5 days."
- `AP-18` A rejection does not close the work item. It unblocks nothing and the team
  decides what to do. Automations may act on `approval.decided` if a project wants
  rejection to move the item.

**Surfacing**

- `AP-19` "Waiting on my approval" is a lens on My Work for staff, and the Approvals
  screen in the portal for customers.
- `AP-20` The work item detail shows an approvals section whenever any approval exists or
  may be requested.
- `AP-21` Pending approvals appear in the notification inbox and, per preference, by email.

<a id="approvals-the-v1-defects-being-prevented"></a>
### The v1 defects being prevented

Recorded explicitly, because they are easy to reintroduce.

| v1 defect | Prevention here |
| --- | --- |
| A customer-side account could request an internal CAB approval | `AP-2`, enforced in the domain and covered by a named negative test |
| The approver's email address was returned to unauthenticated callers | Response schemas expose an approver's display name and avatar only. Email is never serialised on an approval |
| A requester could approve their own request | `AP-8`, in the domain layer, with a test |

<a id="approvals-permissions"></a>
### Permissions

| Action | Capability | Extra |
| --- | --- | --- |
| Request a customer approval | `approval:request` | Staff only |
| Request a CAB approval | `approval:request_cab` | Staff only, `work_item_type.is_change` only |
| Decide | `approval:decide` | Must be the named approver, and not the requester |
| Decide a CAB approval | `approval:decide_cab` | Must also be a `team_member` of the `team` flagged `is_cab` (`team.is_cab`, [data-model.md](data-model.md)) — capability and membership are both required, not either alone |
| Withdraw as requester | `approval:request` | Actual requester, with current work-item reach; API keys also need the capability in their frozen key scope |
| Withdraw as instance admin | `instance:admin` | Session-only `POST /api/admin/approvals/{id}/withdraw`; audited |
| See approvals on an item | `work_item:read` | Customers see only approvals addressed to them or that they raised |
| List my approvals | `{ authenticated: true, self: true }` | `GET /api/me/approvals` — [rbac.md](permissions.md) policy kind 2, own rows only |
| List portal approvals | `{ portal: 'customer', predicate: 'addressed_approval' }` | `GET /api/portal/approvals` — [rbac.md](permissions.md) policy kind 3, scoped to approvals addressed to the caller |

<a id="approvals-screens"></a>
### Screens

Approvals section on the work item; request dialog; decision dialog; "Waiting on my
approval" lens; portal approvals list; portal decision screen.

The portal decision screen is deliberately minimal: what is being asked, by whom, the
relevant context, when it expires, and two buttons. A customer deciding an approval should
not have to learn the product first.

<a id="approvals-api"></a>
### API

Approval responses include `canWithdraw`, computed for the current caller from AP-6/AP-7,
current work-item reach and authority, and the effective requester `approval:request` scope
(including an API key's frozen capability ceiling). A current instance admin session also
gets the affordance for the session-only admin route. It is an affordance only; each route
rechecks its own authority when called. The work-item detail chooses the admin route for an
instance-admin session and the requester route for other sessions and scoped API keys.
The `/api/me/approvals` and `/api/portal/approvals` lists are addressed-approver lists
(Permissions) and do not list requester-owned approvals.

```
GET    /api/work-items/{key}/approvals        work_item:read
POST   /api/work-items/{key}/approvals        approval:request  (approval:request_cab for kind = cab)
POST   /api/approvals/{id}/decide             approval:decide
POST   /api/approvals/{id}/withdraw           approval:request
POST   /api/admin/approvals/{id}/withdraw     instance:admin (session-only)
GET    /api/me/approvals                      { authenticated: true, self: true }              — rbac.md kind 2
GET    /api/portal/approvals                  { portal: 'customer', predicate: 'addressed_approval' } — rbac.md kind 3
POST   /api/portal/approvals/{id}/decide      approval:decide
```

<a id="approvals-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Approver leaves the organisation | The approval stays pending and is flagged. It must be withdrawn and re-requested |
| Approver loses reach on the work item | Same as above — flagged, not silently voided. The flag is derived from current canonical work-item reach, not stored as an approval state. While reach is lost, the named approver cannot decide; the requester may withdraw under `AP-6`, and an instance admin may withdraw on the requester's behalf under `AP-7`. |
| Approvals feature is disabled at the resolved project/workspace/instance level | New approval requests are refused; existing approvals remain readable and actionable under the existing permission/current-reach rules, reminders continue, and workflow approval gates are never bypassed. |
| Work item soft-deleted with a pending approval | Hidden along with the work item, not deleted; both reappear together if the work item is restored within its 30-day soft-delete window. Removed only at purge, at the end of that window ([work-items.md](feature-contracts-p1.md#work-items) `WI-21`) |
| Two approvals, "all" policy, one rejected | The gate stays blocked. The rejection is visible |
| Approval requested on an already-completed item | Allowed. Some processes approve after the fact |
| Expiry set in the past | Rejected at 422 |
| Approver is also the requester | Rejected at 422 with a clear message |
| The gating transition is edited or removed in a new workflow version while an approval against it is still pending | The approval itself is untouched — `approved`/`rejected`/`pending` is a fact about a decision, not about the workflow. But per `WF-6`/`WF-7`, a published version is immutable and in-flight items simply follow the new active version from that point: if the new version no longer offers a transition whose id matches the approval's `transition_id`, nothing can ever attempt that exact transition again, so the approval can no longer satisfy any gate. It is not force-closed — it sits `pending` until it expires (`AP-12`) or is withdrawn. This is a workflow-editing hazard to call out in the workflow editor, not a defect in approvals |

<a id="approvals-out-of-scope"></a>
### Out of scope

- Which team is the CAB, and its roster management UI → [service-management.md](feature-contracts-p5.md#service-management);
  the membership *rule* itself (`team.is_cab` + `team_member`) is defined above, in
  Permissions, not deferred there
- Which transitions require approval → [workflows.md](feature-contracts-p2.md#workflows)

<a id="approvals-testing"></a>
### Testing

Unit: self-approval rejected; expiry arithmetic; any-versus-all gate satisfaction; two
concurrent approvals of the same `kind` on the same work item, raised against different
transitions, where only the one matching `transition_id` satisfies its own gate.

Integration: a customer session requesting a CAB approval is refused; approval responses
never contain an email address; only the named approver may decide.

E2E, named security tests: `customer-cannot-request-cab.spec.ts`,
`requester-cannot-self-approve.spec.ts`, `approver-email-not-leaked.spec.ts`.

<a id="approvals-open-questions"></a>
### Open questions

None.

<a id="approvals-related"></a>
### Related

- [Workflows](feature-contracts-p2.md#workflows) · [Customer portal](feature-contracts-p3.md#customer-portal) · [Notifications](feature-contracts-p4.md#notifications)

<a id="approvals-approval-execution-constraints"></a>
### Approval execution constraints

Single use is derived from the transition activity row (`payload.transitionId`): an approval created before the latest run for its transition is spent. Both timestamps use the database clock under the work-item lock. Historical activity without `transitionId` cannot spend an approval; purging/rewriting this evidence must not reopen spent approvals. Pending approvals block an `all` gate until decided, withdrawn, expired or closed by a run. An inactive/no-longer-valid pending approver stays pending until withdrawal/expiry and loss of reach is flagged as `approverReachLost`.

Impersonation and notification transport still obey their owning security/delivery contracts. Absence of external destinations must never be reported as delivered.

<a id="audit-trail"></a>
## Audit trail

- **Primary phase:** P2
- **Feature flag:** always on
- **Depends on:** RBAC (`instance:read_audit`, `workspace:manage_settings`, and the
  per-entity read capabilities the entity-history route resolves through). The mechanism
  itself has no other prerequisite — every mutation across every phase is audited
  generically from day one (the Behaviour section below). Two rows in the audit action catalogue name
  later-phase actions (`impersonation.*`, P4 God Mode; `work_item.exported`/
  `report.exported`/`config.exported`/`instance.exported`, P5 reporting) — those entries
  are inert, producing zero rows, until the features that trigger them exist; they are not
  a build-order dependency of this one

<a id="audit-trail-purpose"></a>
### Purpose

Answer, under scrutiny: **who changed what, when, and from where.**

Distinct from application logging, which exists to debug the system. See
[observability](#pending-01-architectureobservability) for the distinction — conflating them
produces an audit trail you cannot rely on and logs full of personal data.

<a id="audit-trail-two-related-mechanisms"></a>
### Two related mechanisms

| | `activity` | `audit_log` |
| --- | --- | --- |
| Scope | Work items | Everything |
| Audience | Users, in the interface | Administrators and auditors |
| Retention | Forever — it is the journal | 12 months, configurable |
| Contains | Field changes, comments, state moves | Every mutation, plus authentication and denials |
| Purpose | Understand the work | Prove what happened |

`activity` is a feature. `audit_log` is a control. Both are append-only.

<a id="audit-trail-what-is-audited"></a>
### What is audited

Every mutation, plus these regardless of outcome:

- Sign-in success and failure, with the provider used
- Sign-out and session revocation
- Impersonation start and end
- Role creation, modification, deletion
- Capability grants and revocations
- Membership changes
- Identity provider configuration changes
- Any plugin configuration change
- Feature flag changes
- Permission denials
- Data exports
- Bulk operations — one row per item plus one summary row
- Organisation creation, suspension, deletion
- Attachment downloads
- Encryption key rotation
- Retention purges — the purge audits itself

<a id="audit-trail-data"></a>
### Data

`audit_log`, `audit_chain_anchor` — see [data model](data-model.md) §11
for both tables' exact columns and § "The audit hash chain" for `row_hash`/`prev_hash`'s
recipe. `activity` (`data-model.md` §4) is the input to point-in-time reconstruction
(`AU-8`) but is a separate table, owned by
[comments-and-activity.md](feature-contracts-p1.md#comments-and-activity) — this spec reads it, never writes
it.

<a id="audit-trail-behaviour"></a>
### Behaviour

- `AU-1` Rows record: actor id, actor IP, user agent, action, entity type, entity id,
  before, after, trace id, timestamp.
- `AU-2` **Secret values are never recorded.** A plugin configuration change records which
  keys changed, never what they changed to. The writer's own best-effort backstop
  (`apps/api/src/audit/audit-writer.ts`'s `assertNoObviousSecret`, not a substitute for
  this rule) refuses to write any key whose normalised segments match `password`,
  `secret`, `token`, `credential`/`credentials`, `pwd`, `passphrase`,
  `authorization`/`authorisation`, or the adjacent pairs `api`+`key`, `private`+`key`,
  `encryption`+`key`, `signing`+`key`, `access`+`token`, `client`+`secret` — this list
  did not previously exist anywhere and is written here, in AU-2 itself, rather than
  left as an undocumented implementation detail (Opus security review of PR #291, S6).
  A key whose last segment is `id`, `at` or `count` is exempt regardless of an earlier
  match (`apiKeyId`, `secretRotatedAt`, `tokenExpiresAt` name metadata about a secret,
  never the secret itself). Segments split on `.` as well as `camelCase`/`snake_case`/
  `kebab-case`, so a dotted plugin-configuration path (`smtp.password`, `auth.password`
  — this rule's own example above) is caught the same way `smtp_password` already was
  (Opus security review of PR #291, delta round). A key whose own name only *implies* a
  secret without naming one (`hasPassword`, `passwordSet`) is refused too, deliberately
  failing closed rather than trying to carve out every such near-miss — this backstop is
  explicitly "not a substitute for this rule" above, and a caller that hits this false
  positive should record the fact as its own differently-named field, not fight the
  backstop. Left as documented, accepted gaps rather than chased further, since any
  fixed list of names can be defeated by picking a different one: Unicode lookalikes (a
  Cyrillic `pаssword`), single-word compounds (`accesstoken`), a digit suffix
  (`password2`), an unlisted name (`bearer`, `cookie`, `otp`), and a secret placed under
  an exempt-suffixed key (`passwordId`) all still bypass it.
- `AU-3` Append-only. No API can update, delete or truncate a row. It is enforced in
  three layers:
  - No endpoint exists that does any of the three.
  - **Grants are the primary control** (decision log, 2026-09-23, "The API connects as a
    non-owner, non-superuser role", PR #308). The API connects as `taskdesk_app`, which is
    not a superuser and owns no table. On `audit_log` and `activity` it holds only
    `INSERT` and `SELECT`. `ensureApplicationRole` re-derives these grants from
    `APPEND_ONLY_TABLES` on every run of the separate one-shot migrate process. The API
    process never receives the owner credential, and refuses to start if it does. The
    API refuses to start if the connected role, or
    any role it can reach through membership or `SET ROLE`, holds any elevated attribute or
    predefined role, or owns any object (`assertApplicationRoleIsNotPrivileged`; the full list is
    in the decision log entry).
  - **Triggers are the second layer**, both from migration `0067`:
    - `audit_log_append_only` (`BEFORE UPDATE OR DELETE ... FOR EACH ROW` /
      `audit_log_reject_mutation()`) raises on every UPDATE or DELETE. It allows one
      carve-out, `AU-7`'s `organisation_id`-to-NULL tombstone. Postgres implements that
      as an `UPDATE` against this table, and the trigger permits it only when the
      referenced organisation row no longer exists, never against a live organisation's
      rows.
    - `audit_log_append_only_truncate` (`BEFORE TRUNCATE ... FOR EACH STATEMENT` /
      `audit_log_reject_truncate()`) raises unconditionally, because a row-level trigger
      never fires for `TRUNCATE`.

  **What remains, stated plainly:** the migration/owner role (`TASKDESK_MIGRATION_DATABASE_URL`)
  is still the postgres image's init user, and so a superuser. Anyone holding that
  credential can disable the triggers and rewrite the table, so it must stay
  operator-only. It reaches only the migrate process, never the serving API. There is no
  single-URL mode for the API: connected as the owner, it refuses to boot. **`activity`**
  rows are also removed by cascade when their work item, project or workspace is deleted
  (migration `0066`, the decided CASCADE). `taskdesk_app` cannot mutate `activity`
  directly, but it can delete the parent row.

  `audit-purge`, run as a separate maintenance role, is the only thing that deletes rows,
  and only the oldest-past-retention range.
- `AU-4` An impersonated action records **both** identities.
- `AU-5` System actions are attributed to the job or automation, never to a person.
- `AU-6` Retention purge deletes rows past the configured age and writes its own audit row
  saying how many.
- `AU-7` Deleting an organisation tombstones its audit rows rather than removing them.
  Deleting an audit trail on request defeats its purpose. The mechanism is
  `audit_log.organisation_id`'s `ON DELETE SET NULL`
  ([data-model.md](data-model.md) §11): the row, its actor, action,
  before/after and hash-chain position all survive untouched — only the organisation link
  is nulled, so a tombstoned row still renders everywhere it did before, minus the
  organisation it can no longer be filtered by. No separate `tombstoned_at` column exists;
  the tombstone *is* the null, and it is permanent — a hard-deleted organisation's id is
  gone, so there is nothing to restore it to.

<a id="audit-trail-point-in-time-reconstruction"></a>
### Point-in-time reconstruction

Because `activity` records old and new values for every field, a work item's state at any
past instant can be reconstructed by replaying from creation.

This gives, for free, the things other tools build separately:

- **Baselines** — "what did this project look like on 1 March?"
- **Change reports** — "what changed between the last two reviews?"
- **Dispute resolution** — "the due date was 14 March when we agreed it, and it was moved
  on the 19th by this person."

Borrowed from OpenProject's journal design.

- `AU-8` Reconstruction is a domain function over activity rows, not a stored snapshot.
- `AU-9` Reconstruction is available for work items in P2, and for projects in P5.

<a id="audit-trail-access"></a>
### Access

- `AU-10` Workspace administrators see audit rows for their workspace, filtered to their project reach: rows that are not project-scoped, plus rows for projects the reader can reach — a project-scoped `membership` for their person, or the per-workspace `sees_all` grant (#319/#334). They never see rows for projects outside their reach (#344; decision log 2026-09-23). Soft-deleting a project freezes its one-hop child routes (`project.deleted_at IS NULL` returning `404` to ordinary callers while preserving underlying rows for the 30-day restore window; decision log 2026-10-19 D3 / #205).
- `AU-11` Instance administrators see everything.
- `AU-12` Customers never see the audit log. They see the public portion of `activity` on
  their own requests.
- `AU-13` Reading the audit log is itself audited, as is exporting it. `audit.read` rows
  are **not** exempt from the retention purge — they are ordinary audited events, subject
  to the same configurable window (12 months by default) as every other row, one row per
  read (no batching, no sampling). This is a volume decision made deliberately, not in
  passing: an administrator working the audit screen for an hour writes a proportionate
  number of `audit.read` rows, which is an acceptable cost for "reading the log is itself
  a reviewable action."
- `AU-14` **If the audit write fails, the mutation still succeeds** — losing a mutation
  because auditing failed is worse than a gap — but the failure is never silent: a safe
  error-level log line and `taskdesk_audit_write_failures_total{operation}` alert, plus a
  durable notification to every current instance administrator. The counter's closed
  `operation` values are `mutation`, `pending_action_decision`, `pending_action_self_read`,
  and `audit_read`. Each failed append increments the counter once. The expiry worker groups
  administrator notifications and its safe log by degraded batch, not by pending-action id;
  each failed append still increments the counter. The current candidate implements the
  durable notification path; integrated runtime and independent review gates remain pending
  ([security-model.md](#pending-01-architecturesecurity-model-audit),
  [observability.md](#pending-01-architectureobservability)).
  Read behavior follows the owning feature contract: audit-log reads remain best-effort,
  while PA-11 pending-action detail reads fail closed and return no summary when their
  `pending_action.viewed` audit append fails ([pending-actions.md](#pending-01-architecturepending-actions)).
- `AU-15` Rows are **hash-chained**: `row_hash` is SHA-256 over the **canonical form defined
  once in data-model.md §11** — the ordered column list (`prev_hash` **included**, as its
  first field, per §11's own "Hash input" list — corrected 2026-09-16: an earlier version
  of this sentence read ambiguously and could be misread as excluding it, which would defeat
  the chain, since an intermediate row's chain pointer could then be altered without
  changing that row's own `row_hash`), RFC 8785 canonical JSON for the `jsonb` columns,
  microsecond UTC ISO-8601 timestamps, lowercase hex; `organisation_id` and every other
  post-hoc-mutable column excluded from that list. Every insert takes
  `pg_advisory_xact_lock` on the audit constant, so the chain is strictly serial per instance
  even with many replicas; the first row chains from the zero hash, and `audit-purge` writes
  an `audit_chain_anchor` row that `audit-verify` starts from. `audit-verify` (on demand,
  and at every restore drill) walks the chain and detects a NAIVE edit — a row altered,
  or deleted, in place while the rest of the chain is left alone — which is the residual
  risk left after `AU-3`'s grants and triggers already refuse an ordinary
  `UPDATE`/`DELETE`/`TRUNCATE`. Stated plainly, not overstated (Opus security review of PR
  #291, S5): the chain is an **unkeyed** SHA-256 with no head anchored outside the
  database itself. An actor able to disable the trigger (the migration/owner credential
  `AU-3` names above) can recompute every row from the point of alteration forward — the
  chain verifies as intact either way, because it only proves internal self-consistency,
  never that the current head matches some independently-held record of an earlier one —
  or delete the newest rows outright, which `audit-verify` also cannot see, since there
  is nothing after the new (shorter) chain's own head to contradict it. Closing this
  needs either an externally-anchored head (checked against a copy the database role
  cannot itself alter — `audit_chain_anchor` narrows the *window* between anchors but
  does not by itself anchor OUTSIDE the database) or a hash keyed with a secret the
  database role does not hold.

<a id="audit-trail-audit-action-catalogue"></a>
### Audit action catalogue

`audit_log.action` is a dotted key. **Where a domain event exists for the mutation, the
audit action is that event's key** from [events.md](events.md) — one
vocabulary, not two (`work_item.transitioned`, `pending_action.requested`,
`identity.deprovisioned`, …). The keys below are **audit-only**: security-relevant things
that are not domain events and so appear nowhere else. This list is the single home for
them; register a new audit-only action in the maintained catalogue before implementation.

| Audit-only action | Written when |
| --- | --- |
| `terminology.changed` | An instance or workspace runtime noun override is saved or removed. Record actor, scope/workspace, audience, term key, locale and non-secret before/after forms; no domain event or automation trigger. |
| `auth.sign_in_succeeded` · `auth.sign_in_failed` · `auth.sign_out` · `auth.session_revoked` | Authentication lifecycle, with the provider used |
| `auth.mfa_enrolled` · `auth.mfa_reset` | Second-factor enrollment and administrator reset (with the required verification note); never record the secret, TOTP, backup codes, or proof |
| `auth.user_suspended` · `auth.user_unsuspended` | God Mode account suspension changes; record target user id, outcome, and whether a finite expiry was set, but never the ban reason text or exact expiry |
| `auth.sessions_revoked` | God Mode force sign-out; one summary row with target user id and count, never session ids, tokens, IP addresses or user agents |
| `auth.instance_admin_granted` | God Mode grant-admin; record actor and target user ids plus `granted` or `already_admin`; never record step-up proof, token, or request body |
| `auth.step_up_issued` · `auth.step_up_consumed` · `auth.step_up_denied` | A single-use step-up confirmation is issued, consumed, or denied; record binding kind and fixed operation key/route where applicable, never proof, nonce, token, hash or request body |
| `impersonation.started` · `impersonation.ended` | `GM-7`, `GM-11` |
| `role.created` · `role.updated` · `role.deleted` · `membership.changed` · `membership.sees_all_granted` | Authority and reach changes |
| `project.reach_changed` | `owner_team_id` or `parent_id` changed ([rbac.md](permissions.md#reach)) |
| `project.restored` | A soft-deleted project is restored inside its 30-day window; record project/workspace ids and whether archive state remains, never project content |
| `request_type.created` · `request_type.updated` · `request_type.published` · `request_type.unpublished` | Request-type lifecycle. Record safe request type/workspace identifiers and a closed changed-field list; never store the form schema, labels, customer answers, or raw request body. Audit-only; no outbox event. |
| `request_type.group_order_updated` | Workspace catalogue group ordering changes. Record the workspace identifier, versions, group counts and closed `groupOrder` changed-field marker; never raw group labels or form data. Audit-only; no outbox event. |
| `submission.claimed` | A triager claims a submission; record submission reference and the actor id. Audit-only; no outbox event. |
| `submission.duplicate` | A triager links a submission to a same-organisation work item; record submission reference and linked work-item id/key. Audit-only; no outbox event. |
| `submission.reopened` | A customer reopens their auto-declined submission (`IQ-15`, `CP-8`); record submission reference and the actor id. Audit-only; no outbox event. |
| `submission.reopen_requested` | A customer asks to reopen a resolved request from the portal (`CP-8`); record work-item id, submission number and the outcome (`reopened` or the refusal reason); the actor is the customer. One row per request that was reopened or newly flagged, none for a repeat press on an already-flagged refusal. Audit-only; no outbox event. |
| `satisfaction.rated` | A customer rates or re-rates a resolution (`CP-9`); record the work-item id, score and whether it was a change; never the comment text. Audit-only; no outbox event. |
| `comment.updated` · `comment.deleted` | Comment edit (`CA-17`) and soft-deletion/tombstone (`CA-18`); creation uses `work_item.commented` ([events.md](events.md)) |
| `invitation.sent` · `invitation.redeemed` · `invitation.revoked` | Invitations |
| `plugin.changed` · `plugin.tested` · `secrets.rekeyed` | Plugin configuration (keys only, never values), a `test()` call even when unsaved, key rotation |
| `feature_flag.changed` | Any level |
| `instance.observability_changed` | Log-level keys or the metrics-token setting changed; record changed key names only, never values, token, hash, or arbitrary before/after documents |
| `instance.local_factor_policy_changed` | Instance local-factor policy changed; record only the selected mode and configured role identifier |
| `permission.denied` | A 403 or an out-of-reach 404 on a scoped route |
| `work_item.exported` · `report.exported` · `attachment.downloaded` · `config.exported` · `instance.exported` | Data leaving through a person's hands |
| `attachment.restored` | An attachment is restored within AT-7's one-day window; record attachment, work-item and workspace ids only, never the filename or storage locator |
| `bulk.performed` | One summary row per bulk operation (plus one per item) |
| `import.run` · `job.triggered` | Run-level import audit; a manual job trigger |
| `identity.placeholder_claimed` | TaskDesk-verified email claims an imported, userless person; fixed method and person/import-run/organisation IDs only, never an email address |
| `identity.linked` | Explicit current-session consent after proof of another connection; person and source/target connection/identity IDs only, never email, subject or tokens. No grants or new sessions. |
| `workspace.project_settings_updated` · `project.settings_updated` | Live project-default/inheritance changes; actor, changed field names, scope IDs and integer versions only. |
| `state_template.created` · `state_template.updated` | Workspace enabled-state vocabulary changes; template/workspace IDs, changed field names and versions only. |
| `job.configuration_changed` | Atomic runtime job cadence/enable configuration change; records the actor, registered job name and old/new configuration version. Audit only; not a published domain event. |
| `instance.delivery.requeued` | Atomic operator retry of a dead event envelope or standalone notification child; records only actor, opaque target, kind, prior state and prior attempt count. Audit only; not a published domain event. |
| `api_key.created` · `api_key.revoked` · `api_key.reattested` · `api_key.ownership_transferred` · `webhook.created` · `webhook.deleted` · `webhook.secret_rotated` | Durable-authority lifecycle |
| `automation.enabled` · `automation.disabled` | Rule state |
| `ai.sent_externally` | A work item's content was sent to an `ai.*` provider |
| `mcp.request` | An MCP request; record API-key id, owner user id and `agentOriginated: true` only, never headers, path/query or body |
| `organisation.created` · `organisation.updated` · `organisation.suspended` · `organisation.unsuspended` · `organisation.deleted` · `organisation.restored` · `legal_hold.placed` · `legal_hold.lifted` | Tenancy lifecycle |
| `audit.read` · `audit.exported` · `audit.purged` | `AU-13`; the purge audits itself |
| `hard_purge.executed` | `PA-13`; record target type/id, removed work-item ids and work-item/comment/attachment/storage-object counts, plus the successful `legalHold: none` and `retention: soft_deleted` checks. Never record work-item or comment content, storage keys, credentials or proof. The pending-action outbox event remains `pending_action.executed`; this audit-only record is written in the purge transaction, so audit failure rolls back the purge. |
| `instance.restored` | A restore completed ([backup-and-restore.md](#pending-05-operationsbackup-and-restore)) |
| `pending_action.viewed` | The one pending-action transition that is not an event (`PA-11`) |
| `sla_policy.created` · `sla_policy.updated` · `sla_policy.published` | SLA policy creation, draft edits and publication |

<a id="audit-trail-permissions"></a>
### Permissions

| Action | Capability |
| --- | --- |
| Read the instance-wide log | `instance:read_audit` (`AU-11`) |
| Read a workspace's log | `workspace:manage_settings` (`AU-10`), reach-filtered to the reader's projects (`AU-10`, #344) |
| Read one entity's history | that entity's own read capability, resolved by `{type}` from the policy registry (kind 1) |
| Export the audit log | `instance:read_audit` **and** step-up re-authentication (`AU-13`, elevated) |
| Reconstruct a work item at an instant | `work_item:read` |
| Customers | never — they see the public portion of `activity` on their own requests only (`AU-12`) |

<a id="audit-trail-screens"></a>
### Screens

**God Mode → Audit** — filterable by actor, action, entity type, entity, date range, and
outcome. Each row expands to show the before/after diff.

**Work item → Activity** — the user-facing journal, already part of the detail view.

**Entity history** — a "History" affordance on roles, workflows, SLA policies and plugin
configurations, showing that entity's audit rows inline. This is where an administrator
actually looks when something has changed unexpectedly, so putting it next to the thing
matters more than the central log.

<a id="audit-trail-api"></a>
### API

```
GET  /api/instance/audit                       instance:read_audit
GET  /api/workspaces/{id}/audit                workspace:manage_settings
GET  /api/audit/entity/{type}/{id}             the entity's read capability (kind 1, chosen by `{type}` from the registry)
POST /api/instance/audit/export                instance:read_audit  E  (elevated — step-up)
GET  /api/work-items/{key}/reconstruct?at=…    work_item:read
```

<a id="audit-trail-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Very large before/after payload | Truncated at 64 KB with a marker; the full diff remains in `activity` for work items |
| Audit write fails | The mutation/read contract is preserved (`AU-14`); safe error-level log and `taskdesk_audit_write_failures_total{operation}` alert, plus a durable notification to every current instance administrator. The expiry worker sends one notification per degraded batch while counting every failed append. Implementation and runtime evidence are recorded separately |
| Clock skew across replicas | Timestamps come from the database, never from the application |
| Actor deleted | Rows retain the id and a tombstoned display name |
| Retention shortened | Applies from the next purge. The change is audited |

<a id="audit-trail-out-of-scope"></a>
### Out of scope

- **A real-time audit stream or SIEM export.** `audit.exported` covers on-demand export;
  a push/webhook feed to an external SIEM is a plugin, if and when one is built
  ([plugin-architecture.md](features.md)) — this spec
  defines the record, not a delivery mechanism beyond it.
- **A UI for editing or annotating an audit row.** Append-only means no such surface
  exists anywhere, by design (`AU-3`).
- **Cross-organisation audit search.** `AU-10`/`AU-11` already draw the reach boundary;
  searching across organisations is out of scope at every reach level, including
  `instance:read_audit`, which is instance-wide but still within one deployment.
- **Retention policy configuration UI** and **the `audit-purge`/`audit-verify` jobs'
  scheduling** → [background-jobs.md](background-jobs.md).
- **Impersonation's own start/end mechanics** → the impersonation feature (P4 God Mode);
  this spec only defines that `impersonation.started`/`impersonation.ended` are audited
  and record both identities (`AU-4`).

<a id="audit-trail-testing"></a>
### Testing

Integration: every mutating route writes an audit row — asserted generically by exercising
the route table and checking the count increases; secrets never appear in any row;
no endpoint can modify or delete a row.

Unit: reconstruction from activity produces the correct state at arbitrary instants,
including across a type change and a project move.

<a id="audit-trail-open-questions"></a>
### Open questions

None.

<a id="audit-trail-related"></a>
### Related

- [Observability](#pending-01-architectureobservability) · [Security model](#pending-01-architecturesecurity-model)
- [Comments and activity](feature-contracts-p1.md#comments-and-activity)

## Pending foundation and decision references

Mappings to existing technical references provide maintained entrypoints; they do not certify full migration of every foundation clause. These linked contracts are not migrated by this feature reference. The rows identify the original contract, not an available archive dependency. Their normative details still require maintained migration; a link here does not close that gap. Current [requirements](../requirements.md) and [alignment](../alignment.md) retain the scope/precedence boundary.

<a id="pending-01-architectureadr0009-lazy-sla-evaluation"></a>
- **Pending maintained contract:** `docs/01-architecture/adr/0009-lazy-sla-evaluation.md`.
<a id="pending-01-architectureadr0011-ticket-lifecycle-engine"></a>
- **Pending maintained contract:** `docs/01-architecture/adr/0011-ticket-lifecycle-engine.md`.
<a id="pending-01-architectureapi-design"></a>
- **Pending maintained contract:** `docs/01-architecture/api-design.md`.
<a id="pending-01-architectureapi-design-concurrency"></a>
- **Pending maintained contract:** `docs/01-architecture/api-design.md#concurrency`.
<a id="pending-01-architectureobservability"></a>
- **Pending maintained contract:** `docs/01-architecture/observability.md`.
<a id="pending-01-architecturepending-actions"></a>
- **Pending maintained contract:** `docs/01-architecture/pending-actions.md`.
<a id="pending-01-architectureplugin-architecture-feature-toggles"></a>
- **Pending maintained contract:** `docs/01-architecture/plugin-architecture.md#feature-toggles`.
<a id="pending-01-architecturesecurity-model"></a>
- **Pending maintained contract:** `docs/01-architecture/security-model.md`.
<a id="pending-01-architecturesecurity-model-audit"></a>
- **Pending maintained contract:** `docs/01-architecture/security-model.md#audit`.
<a id="pending-02-designaccessibility"></a>
- **Pending maintained contract:** `docs/02-design/accessibility.md`.
<a id="pending-05-operationsbackup-and-restore"></a>
- **Pending maintained contract:** `docs/05-operations/backup-and-restore.md`.
<a id="pending-07-planningdecision-log"></a>
- **Pending product-decision/scope extraction (historical process is inactive):** `docs/07-planning/decision-log.md`.
<a id="pending-07-planningroadmap"></a>
- **Pending product-decision/scope extraction (historical process is inactive):** `docs/07-planning/roadmap.md`.
