# SLA

- **Stage:** P2
- **Status:** ⬜
- **Feature flag:** `feature.sla`
- **Depends on:** service calendars, request types, work item types

## Purpose

Answer, for any work item: **when is this due, and are we going to make it?**

The commitment is expressed in *covered time* — hours the service is actually contracted
to be responding — not wall-clock time. A 4-hour resolution target on an 8×5 service,
raised at 16:00 on a Friday, is due at 12:00 on Monday.

## The central decision

**SLA state is never stored. It is computed on read from stored facts.**

See [ADR 0009](../01-architecture/adr/0009-lazy-sla-evaluation.md) for the full argument.
The consequences you need to know while implementing:

- Changing a policy or a calendar needs no backfill.
- A missed scan delays a *notification*, never the *truth*.
- There is one implementation, in `packages/domain/src/sla/`, used by the API, the UI,
  reports and the scan job alike.

## Concepts

| Concept | Meaning |
| --- | --- |
| **SLA policy** | A named, versioned set of goals, bound to a service calendar |
| **Goal** | (metric × work item type × priority) → target minutes |
| **Metric** | `first_response` or `resolution` |
| **Covered time** | Elapsed time counted only inside calendar windows, excluding holidays and pauses |
| **State** | `none` · `ok` · `at_risk` · `breached` · `met` · `missed` |
| **Pause** | An interval that does not consume the clock |

## States

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

## Data

`sla_policy`, `sla_policy_version`, `sla_goal`, `sla_pause`, `service_calendar`, and
`work_item_sla_cache` — the last used **only** so `sla-scan` can detect an edge and fire
an event once, and for list filtering. It is never the answer to "what is the state?"

## Behaviour

**Resolution of which policy applies**

- `SLA-1` Order: work item type override → request type → project → workspace default.
  First match wins.
- `SLA-2` If no policy resolves, state is `none`.
- `SLA-3` The **published version effective at `work_item.sla_started_at`** is pinned when
  the work item is created or accepted. That instant is the direct work item's creation
  time, or the original submission's `submitted_at` on acceptance (ADR 0009). The selected
  version is stored on the work item; later policy binding or publication changes never
  rewrite the version used by an existing item.

**Computation**

- `SLA-4` `dueAt` = the instant at which `target_minutes` of covered time have elapsed
  since `sla_started_at` (copied from the accepted submission's `submitted_at`, otherwise the
  work item's `created_at` — [data-model.md](../01-architecture/data-model.md)), per the
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
- `SLA-9` Reopening a completed item resumes the resolution clock from where it stopped —
  it does not restart.

**Pausing**

- `SLA-10` Pausing is a **workflow transition effect**, not a policy property: the
  transition into "Waiting on customer" carries `pause_sla`, the transition out carries
  `resume_sla` — the vocabulary in [workflows.md](workflows.md) `WF-19`. A policy declares
  goals and thresholds only. *(Corrected 2026-09-05: the first draft put the pausing-state
  list on the policy, which cannot reference states and duplicated the workflow's effects.)*
- `SLA-11` `pause_sla` opens an `sla_pause` row (reason `waiting_customer`) per metric;
  `resume_sla` closes it. Entering a `completed`-group state opens one with reason
  `resolved` (`WF-17`) and reopening closes it (`WF-18`). At most one open row per
  `(work_item, metric, reason kind)`; a manual pause while an automatic one is open returns
  409, and an automatic close never closes a manual pause.
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
  `sla.breached` ([events.md](../01-architecture/events.md)).

**Display**

- `SLA-18` List surfaces show a compact badge: colour, icon and remaining time.
- `SLA-19` Detail shows a bar with consumed proportion, the at-risk marker, the due
  instant in the viewer's timezone, and the calendar's name.
- `SLA-20` Colour is never the only signal — see [accessibility](../02-design/accessibility.md).
- `SLA-21` Customers see their own SLA state and due time, never the policy internals.

## Permissions

| Action | Capability |
| --- | --- |
| See SLA state on a work item | `work_item:read` |
| Read policies | `sla_policy:read` |
| Create, edit, publish a policy | `sla_policy:manage` |
| Manage service calendars | `sla_policy:manage` |
| Pause or resume manually | `work_item:update` |

## Screens

Policy list, policy editor (goal matrix by type × priority), calendar editor, SLA badge
and bar primitives, SLA columns in list and table, SLA reports.

The goal editor is a matrix, not a list of forms — service desk managers think in a grid
of "for this type at this priority, this long", and giving them anything else makes
authoring miserable.

## API

```
GET   /api/sla-policies?workspaceId=…          sla_policy:read
POST  /api/sla-policies?workspaceId=…          sla_policy:manage
GET   /api/sla-policies/{id}                   sla_policy:read
PATCH /api/sla-policies/{id}                   sla_policy:manage
POST  /api/sla-policies/{id}/publish           sla_policy:manage
GET   /api/work-items/{key}/sla                work_item:read
POST  /api/work-items/{key}/sla/pause          work_item:update
POST  /api/work-items/{key}/sla/resume         work_item:update
```

### Selected policy-authoring contract

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
  policy change. The audit action identifiers are proposed as `sla_policy.created`,
  `sla_policy.updated`, and `sla_policy.published`; they must be added to the audit action
  catalogue before implementation. Audit snapshots contain policy/version ids, changed
  field names, and safe scalar configuration, never raw request bodies. If the audit write
  fails, the mutation still commits and AU-14 records the bounded failure signal and
  notifies current instance administrators after commit. No SLA-policy domain event is
  emitted by this slice; the canonical event catalogue currently defines only SLA outcome
  events, and no policy-configuration event is needed for the documented lazy evaluation.
- There is no direct policy `DELETE` route in this slice. The existing edge-case statement
  that a policy in use cannot be deleted remains a required rule for a future deletion
  operation; it does not authorize an unlisted endpoint.

## Edge cases

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

## Out of scope

- Calendar definition → [service-calendars.md](service-calendars.md)
- Escalation path membership → [projects-and-engagements.md](projects-and-engagements.md)
- SLA reporting → [reports-and-dashboards.md](reports-and-dashboards.md)

## Testing

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

## Open questions

- Policy deletion and policy-binding management routes are outside this slice. The canonical nullable same-workspace binding columns on request type, project, work-item type and workspace are read by the SLA-1 resolver; no binding-management route is introduced here.
- CAL-8 is resolved by the selected contract above: policy versions pin the calendar ID,
  while calendar definitions remain live. Calendar edits affect evaluations that resolve
  that ID; they do not rewrite policy versions.

## Related

- [ADR 0009](../01-architecture/adr/0009-lazy-sla-evaluation.md)
- [Service calendars](service-calendars.md) · [Background jobs](../01-architecture/background-jobs.md)
