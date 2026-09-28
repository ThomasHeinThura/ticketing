# Pre-merge security review — PR #457 (issue #442, workflow state-transition execution routes)

**Reviewed head:** `173a153af7cbf4c6d21beb4915ffb73ed7354081`

**Reviewer:** Opus 5.5. A fresh, independent context that did not write, direct or fix any
part of this change. Reviewed in the worktree at the exact head above, which I checked with
`git rev-parse HEAD`. Scope was the full `git diff origin/main...HEAD`: 14 files, +2135.

**Verdict: BLOCKING FINDINGS.** Two blocking findings, both reproduced live against a real
Postgres 18 (`td-lane-pg`, private `opus457_review_test` database). Nine non-blocking
findings. The authorization split (403/409/422), cross-tenant state and role resolution,
race safety between two concurrent transitions, and request validation all checked out
correctly.

This note covers the head above only. Any later commit outside
`docs/07-planning/security-reviews/` voids it and needs a delta review. No waiver was
sought or used.

---

## Blocking

### B1 — Guards are checked on stale reads outside the transaction, so a concurrent write can bypass them

`apps/api/src/work-item/controllers/transition-work-item.ts:170-182` builds the guard
context and runs `offerTransition` from `loadWorkflowTransitionContext` /
`buildGuardContext`. Those are unlocked, pre-transaction reads
(`workflow-transition-context.ts:76-91`, `:294-318`). The conditional write at
`transition-work-item.ts:232-240` then pins **only** `state_id`
(`WHERE id = ? AND state_id = <read state>`). It does not pin `version` or `assignee_id`,
and nothing locks the work item or its children. Any write that changes a guard fact but not
`state_id`, and that lands between the guard check and the `UPDATE`, is invisible to the
transition. The transition then commits even though its guard no longer holds.

**Reproduced (deterministic):**

1. The transition backlog→completed has `guards: [{type: "assignee_present"}]`. The item
   has an assignee.
2. A second transaction sets `assignee_id = NULL`, bumps `version`, and holds its row lock.
3. `POST /transition` runs. Its unlocked read still sees the committed assignee, so the
   guard passes. Its `UPDATE` then blocks on the row lock.
4. The second transaction commits. Postgres re-checks the `UPDATE`'s `WHERE`. `state_id` is
   unchanged, so the row still matches.
5. The result was **200**. The item ended in the completed state with `assignee_id = null`
   and `version = 3`. So the `assignee_present` guard was bypassed. The same thing happens
   with a real concurrent `POST /unassign`.

`children_closed` has the same gap: a child reopened concurrently doesn't touch the parent
row at all. The stale read also has two knock-on effects:

- The assignee activity row's `oldValue` (`:304`) can record the wrong previous holder.
- A `set_assignee`/`clear_assignee` effect silently overwrites a concurrent assign
  (a lost update). `assign-work-item.ts` explicitly guards against this.

**Fix direction:**

- Inside the `db.transaction`, `SELECT ... FOR UPDATE` the work item, then rebuild the guard
  context from that locked row. The alternative is adding
  `eq(workItemTable.version, ctx.workItem.version)` to the `UPDATE`'s `WHERE`, which turns
  any concurrent write into the existing `TransitionConflictError` 409.
- For `children_closed`, read the children inside the transaction with `FOR SHARE`.
- Regression test: the lock-holding-transaction probe described above. Hold the row lock
  while clearing the assignee, fire the transition, then release. Expect 409 (or 422), never
  200.

### B2 — The `set_assignee` effect writes any person id as assignee, skipping AS-5 and tenant checks

`transition-work-item.ts:80-84, 196-197, 225-226` writes `effect.personId` straight into
`work_item.assignee_id`. The only FK on `assignee_id` is to `person.id`
(`database/schema.ts`, `workItemTable.assigneeId`). No check pins that person to this
organisation, workspace or project roster, or requires them to be active. The authoring side
accepts any string too: `workflow/schema.ts:39` is `z.union([z.string(), z.literal("default")])`.
`create-workflow-version.ts:79-94` checks roles and `schedule_transition` targets across
tenants, but never `set_assignee.personId`. The normal assign route enforces AS-5 (project
roster and active) through `evaluateAssigneeEligibility` (`assign-work-item.ts`). This PR is
the first code that turns the stored `personId` into a live assignee write, and that write
does not go through the same rule.

**Reproduced:** I created a person in a **different organisation**, `side: "customer"`,
`active: false`, on no roster, and inserted a transition with
`effects: [{kind: "set_assignee", personId: <that person>}]`. A workspace admin's
`POST /transition` returned **200**, and `assignee_id` became that foreign, deactivated
customer person. Anyone holding `work_item:transition` can trigger it. Normally assigning
needs `work_item:assign` plus the AS-5 check. This one needs neither.

**Fix direction:**

- At execution, run the same roster and active eligibility check `assign-work-item.ts` uses
  for a concrete `personId`. If the person is ineligible, fail closed: skip the effect, or
  refuse the transition, and say so. Don't write the id.
- Also reject any `set_assignee.personId` outside the workspace at authoring time in
  `create-workflow-version.ts`, next to the existing role and template checks. That can land
  here or as a tracked follow-up, but the execution-time check is the one that must land in
  this PR.
- Regression test: a foreign-org person, a deactivated person, and an off-roster person must
  each leave `assignee_id` unchanged.

---

## Non-blocking

- **N1 — The event carries internal note text with no visibility flag.**
  `transition-work-item.ts:346-357` publishes `note: input.note` whatever `noteVisibility`
  is. Live: an `internal` note appears verbatim in the `work_item.transitioned` payload.
  `events.md` marks this event webhook- and notification-deliverable, and `NO-19` requires
  consumers to be able to drop internal content (compare `work_item.commented`'s
  `visibility`). Nothing subscribes to it today, so this is latent. Add `noteVisibility` to
  the payload, or omit `note` when it is internal, before any subscriber lands.
- **N2 — Soft-deleted items can be transitioned.** Live: an item with `deleted_at` set
  returned 200 and moved state. `assign`, `unassign` and `rank` return 404 for the same item.
  This matches the existing `requireWorkItemReach`/PATCH behaviour (`GET` also returns 200),
  so it isn't new in kind. But this PR adds another mutation, event and audit row on a
  trashed item. The #202 project-soft-delete freeze is also not re-checked inside the
  transaction; `update-work-item.ts:122,143-158` does re-check it. Add
  `isNull(workItemTable.deletedAt)` and the `projectNotDeleted` `EXISTS` to the `UPDATE`'s
  `WHERE`.
- **N3 — Two edges to the same target: the first one wins, even if it is blocked.**
  `transition-work-item.ts:151` uses `offerable.find(...)`. Live: edge 1 (guarded,
  `no_open_blockers`) and edge 2 (from any state, no guards) both go to the same template.
  `GET /transitions` lists edge 2 as `available: true`, but `POST` returns 422 citing
  edge 1. This fails closed, but it contradicts the state-select feed. Prefer an available
  match, or accept a `transitionId`.
- **N4 — The audit row is incomplete.** `appendAuditLog` records only `stateId` before and
  after (`:325-335`). An assignee change made by an effect is in `activity` but not in the
  audit row. A `resolved_at` set or clear is in neither. Include both in `before`/`after`.
- **N5 — `resolveActorRoleIds` doesn't filter on `membership.scope`.**
  (`workflow-transition-context.ts:252-271`) It matches `scope_id` against both the project
  id and the workspace id without checking `scope = 'project'` / `'workspace'`. Every id is a
  cuid2, so a collision between id types isn't realistic, and a foreign role couldn't match
  a transition anyway (transition `role_id`s are checked against the workspace when written).
  Still worth adding the `scope` predicate for defence in depth.
- **N6 — Notes are stored even when `notePolicy` is `none`.** Live: stored as a comment.
  This is harmless, but it's worth deciding whether `none` should mean "ignored".
- **N7 — `schedule_transition.afterMinutes` has no upper bound.** (`workflow/schema.ts:51`)
  A huge value makes `new Date(...)` invalid (`:274`), so every transition through that edge
  returns 500. It fails closed and only an admin can author it. Add a `.max()`.
- **N8 — Nothing pins the workflow's workspace.** The loader and the validate route don't
  check `workflow.workspace_id` against the type's or the item's workspace, and
  `work_item_type.workflow_id` is a single-column FK. No API writes `workflow_id` today, and
  state resolution plus the composite `(project_id, state_id)` FK fail closed for transitions
  anyway. But if a cross-link were ever created, `validate`'s `stuckWorkItemKeys` would list
  another workspace's keys to this workspace's admin. This is latent. Add the equality check.
- **N9 — Test gaps.** No concurrency test, no `audit_log` assertion, no guard-blocked (422
  guard) test, and no effect tests (`set_assignee`, `schedule_transition`, `resolved_at`
  clear on reopen).

---

## Verified correct, by live test or reading the code

- **403 gate.** `requireWorkItemReach()` and then
  `requireWorkspaceCapability("work_item:transition")` both run before the handler, and no
  handler path reaches a write without them. A viewer gets 403. A caller outside the
  workspace gets 404, for both POST and GET (the enumeration-safe answer). Policy entries
  match the middleware.
- **409 vs 422.** A wrong role, wrong state, CAB edge on a non-change type, or a target with
  no concrete state all give 409 (`NoMatchingTransitionError`). Guards, approval, CAB-pending
  and a missing required note give 422. A foreign workspace's template id gives 409.
- **Disclosed gaps fail closed, as described.** Approval and CAB always give 422. The
  `no_open_blockers`, `field_required` and `change_risk_at_most` guards always block.
  `pause_sla`, `resume_sla` and `set_field` are no-ops. `'default'` resolves to null.
  `resolved_at` is set on entering `completed` and cleared on leaving it. None of these fail
  open. I confirmed the absent tables against `database/schema.ts`: there is no `approval`,
  `work_item_relation`, `sla_pause`, default-assignee column or change-risk column
  (`task_relation` is the legacy table and isn't used here).
- **Cross-tenant state resolution.** `adoptedStates` is built only from this project's
  non-archived `state` rows, and the composite `(project_id, state_id)` FK backs that up at
  the database. `templateGroups` is scoped to the workspace.
- **Two concurrent transitions.** Deterministic lock test: the stale transition returns 409,
  state is untouched, `version` is not bumped, and it wrote 0 activity rows and 0 audit rows.
  In 8 truly parallel pairs of competing transitions, each pair produced exactly one 200 and
  one 409, with `version = 2`, 1 activity row and 1 audit row per item, and 8 audit rows in
  total.
- **Note validation happens on the request path.** Whitespace-only gives 422 (`hasNote`
  trims it). Over 10,000 characters, a NUL byte, or a non-string gives 400. A NUL in
  `toStateTemplateId` gives 400.
- **Every mutation leaves a trail.** Activity row, `audit_log` row and event are written in
  the transaction or after commit, as appropriate.
- **No internal fields reach the wire.** Responses are built field by field or passed
  through Zod. No `seq`, raw `guards`/`effects` jsonb or `roleId` is exposed. The 422
  `blockedBy` is only `{kind, reasonCode}`.
- **Validate route.** Gated on `workflow:manage` with `fromWorkflow()` reach. It is
  read-only and scoped to the workflow's workspace, apart from the latent N8.

Not checked: the API-key-authenticated caller path (it goes through the same
`resolveActor`/person lookup as its sibling routes), the web client, and the CI failures on
this head (`contract - OpenAPI drift`, `gate checkers + red probes`), which are outside this
review.

---

## Delta review 1 (2026-09-28): `173a153..b48b2a1`, verdict BLOCKING FINDINGS

**Reviewed head:** `b48b2a185b26a69251e1473be2af3d4720be6c79`

**Reviewer:** Opus 5.5, in a fresh, independent context. I did not write, direct or fix any
part of this change or the fix round. The range has two commits: `04f76ec` (the B1/B2/N7 fix
round) and `b48b2a1` (a test-only typing fix that landed while this review was running). I
checked the head with `git rev-parse HEAD` in the PR worktree. The reproductions ran in a
separate, private detached worktree at the same SHA, against a private
`opus457_delta_test` database on `td-lane-pg`.

**Headline:**

- **B2 is CLOSED.**
- **B1 is STILL OPEN.** The `assignee_present` half is fixed. The `children_closed` half,
  which the original B1 named explicitly, can still be bypassed. It was reproduced live and
  the mechanism was confirmed separately in plain SQL.

### D1 (BLOCKING): `children_closed` can still be bypassed, because the children read locks through a join

`transition-work-item.ts:271-288` reads the children with a single query:
`SELECT state.state_template_id FROM work_item JOIN state ... WHERE parent_id = ? AND archived_at IS NULL AND deleted_at IS NULL FOR SHARE`.

Here is what goes wrong under Postgres READ COMMITTED:

1. A child's state change is in flight and not yet committed.
2. The `FOR SHARE` read waits on that child's row lock.
3. Once the change commits, Postgres rechecks the query against the new version of the child
   row (EvalPlanQual), but joins it to the **old** `state` row it already fetched.
4. The join condition `work_item.state_id = state.id` no longer matches, so the reopened child
   is **dropped** from the result instead of being re-joined.
5. `children.every(...)` then runs over the remaining children. If the reopened child was the
   only one, it runs over an empty array and is vacuously true.

The lock fixes the timing. The join throws the result away.

**Reproduced, via the real route:**

1. Parent P has one child C, and C is in a `completed` state. The transition backlog→completed
   has `guards: [{type: "children_closed"}]`.
2. A raw transaction runs `UPDATE work_item SET state_id = <backlog> WHERE id = C` and does not
   commit, so it holds C's row lock.
3. `POST /transition` on P runs, and its `FOR SHARE` read blocks on C.
4. After 300 ms the raw transaction commits.
5. The result was **200**. P ended in `completed` with `resolved_at` set, while its only child
   was open.

The PR's own B1 regression test only covers `assignee_present`, so it passes.

**Mechanism confirmed in plain SQL, two sessions, no application code:**

- The joined `... FOR SHARE` returned **0 rows** after the concurrent update committed.
- The same lock with no join, `SELECT state_id FROM w WHERE parent = ? FOR SHARE`, returned the
  child with its **new** state.

The `archived_at IS NULL` / `deleted_at IS NULL` filters have a smaller version of the same
gap. They are evaluated on the reader's snapshot, so a child whose un-archive or restore is in
flight is never matched and never locked. No route un-archives or restores a work item today,
so this part is latent only.

The unfiltered join also takes `FOR SHARE` on every joined `state` row. That blocks any
concurrent `UPDATE` of those state rows for the length of the transaction, which is harmless
but unintended.

**Fix direction:**

- Lock the children with a **single-table** query whose only predicate is
  `parent_id = <P>`. For example, `SELECT id, state_id, archived_at, deleted_at FROM work_item
  WHERE parent_id = ? FOR SHARE`.
- Then filter out archived and deleted children, and map `state_id` to its template, in a
  second query or in JS.
- After a lock wait, Postgres rechecks only `parent_id` against the new row version, which is
  what we want:
  - a child that was reparented away drops out, correctly;
  - a child reopened concurrently is seen with its new state;
  - a child reparented in concurrently is already serialised by P's `FOR UPDATE`, because the
    parent-cycle trigger's `FOR NO KEY UPDATE` and the FK's `FOR KEY SHARE` on P both conflict
    with it.
- **Regression test:** the probe above. Hold an uncommitted reopen of the only child, fire the
  parent transition, then commit. Expect 422 `guard.children_closed`, never 200.

### D2 (non-blocking, new): the parent transition can deadlock against a reparent inside P's subtree

The fix round added a lock order of parent first (`FOR UPDATE`), then children (`FOR SHARE`).
`set-work-item-parent.ts` locks in the opposite order:

1. It locks the child C (`:106`, `FOR UPDATE`).
2. Its `UPDATE ... parent_id` (`:182`) fires `work_item_reject_parent_cycle`.
3. That trigger walks the new parent's ancestors with `FOR NO KEY UPDATE`.

So moving C from under P to under Q, where Q is also inside P's subtree, locks C → Q → P. A
concurrent transition on P locks P → C. That is an ABBA wait.

**Reproduced deterministically:**

1. P has children C2, C and Q, in that scan order. A third transaction holds C2, so the
   transition is paused after it has locked P.
2. The reparent transaction locks C and then runs `UPDATE work_item SET parent_id = Q`.
3. The third transaction releases C2.
4. Postgres detected the deadlock and aborted the reparent (`40P01`). The transition returned
   200.

Which transaction Postgres aborts depends on timing. When the transition is the victim, it
returns a **500**, because neither route maps `40P01`. Nothing is corrupted, and it needs a
hierarchy edit racing a guarded transition on the same subtree, so this is non-blocking.

Fix direction, pick one:

- when the transition's children must be read, take the same project-scoped
  `pg_advisory_xact_lock(WORK_ITEM_HIERARCHY_LOCK_NAMESPACE, …)` that set-parent takes first
  (`:94`), before locking P;
- or map `40P01` to a 409 "retry".

The first option removes the deadlock rather than reporting it.

Separately, and not new to this PR: the codebase sets no `lock_timeout` or
`statement_timeout` anywhere (`apps/api/src/database/index.ts`). An abandoned lock holder can
stall this route indefinitely, the same as the assign and set-parent routes.

### Confirmed CLOSED or correct, live

**B1, `assignee_present`: CLOSED.** I re-ran the original probe with an uncommitted
`assignee_id = NULL, version = version + 1` held across the request. The result was **422**
`guard.assignee_present`. State, assignee, activity count and audit count were all unchanged.
The guard is now evaluated against the `FOR UPDATE` row (`:255-306`), and the current state is
re-verified from that same row (`:264`).

**B2: CLOSED.** I used the original review's exact target: a person in a different
organisation, `side: "customer"`, `active: false`, on no roster.

- The result was **422** `{kind: "assignee", reasonCode: "assignee.not_on_roster"}`.
- The prior assignee was untouched. State was unchanged, `version` was unchanged, and 0 new
  activity rows, 0 audit rows, 0 comments and 0 events (`transitioned` included) were written.
- An on-roster but deactivated target gave 422 `assignee.not_active`, also with nothing
  applied. That included a supplied note, which was not stored.

**`assign-work-item.ts` refactor: behaviour unchanged.** It runs the same query with the same
`db` executor. The only difference is that it now runs after the `planAssignment` no-op
short-circuit instead of before it, and the no-op path never used its result.
`work-item-assign.test.ts` passed **17/17** and `work-item-unassign.test.ts` passed **8/8**.

**Assignee events and audit: correct in all four cases.** `previousAssigneeId` comes from the
locked row.

| Case | Result |
| --- | --- |
| Reassign X→Y | `work_item.assigned` {assigneeId Y, previousAssigneeId X} |
| Clear Y→null | `work_item.unassigned` {previousAssigneeId Y} |
| Set Y while Y already holds it | no event, no assignee activity or audit |
| Clear while already null | no event |

In each case the `work_item.transitioned` audit row now carries `assigneeId` and `resolvedAt`
in both `before` and `after`, which also addresses N4. First assign (null→X) is covered by the
PR's own test.

**Widened `blockedBy` type.** `workItemBlockReasonSchema` is
`{kind: z.string(), reasonCode: z.string()}` (`response.ts:353`), so `{kind: "assignee", …}`
fits the 422 schema. It serialised as shown above.

**Authoring-time check (`create-workflow-version.ts`): runs as claimed.**

| `set_assignee.personId` | Result |
| --- | --- |
| Nonexistent id | **400** "names a person that does not exist" |
| `'default'` | 200 |
| Existing foreign-organisation, inactive person | 200 (existence only, as disclosed) |
| One real id and one bogus id in the same transition | 400 |

The original review's "reject outside the workspace" ask is deliberately not met. That is
acceptable, because the execution-time check is the authoritative one.

**N7: CLOSED at the point of use.** With `afterMinutes = 2^53-1`, the transition returned 200
and wrote no `scheduled_transition` row, where it previously returned a 500.

### Non-blocking notes on the fix round

- **N10.** Setting the current holder again (`set_assignee` naming the existing assignee, who
  has since been deactivated) refuses the whole transition with 422 `assignee.not_active`. No
  assignee change would actually happen. `assign-work-item.ts` treats the same case as a no-op
  before checking eligibility. This fails closed, but it is inconsistent: consider skipping
  the eligibility check when `assigneeIdPatch === locked.assigneeId`.
- **N11.** The eligibility read (`membership` ⋈ `person`) takes no lock, so a roster removal or
  deactivation that commits mid-transaction is not serialised. `assign-work-item.ts` has the
  same shape, so this is not new in kind.
- **Still open, as disclosed in the PR:** N1 (internal note in the event payload), N2
  (soft-deleted items and the project-freeze check in the `UPDATE`), N3 (first matching edge
  wins), N5 (`membership.scope` predicate), N6 and N8. I re-checked none of them beyond seeing
  that the code is unchanged.

### Tests I ran on this head

| Check | Result |
| --- | --- |
| `pnpm test:permissions` | **13 files / 83 tests passed** |
| `work-item-transition.test.ts` | **11/11** |
| `workflow-validate.test.ts` | **2/2** |
| `work-item-assign.test.ts` | **17/17** |
| `work-item-unassign.test.ts` | **8/8** |
| `workflow.test.ts` | **8/8** (`create-workflow-version.ts` changed) |
| `pnpm run typecheck` (apps/api: `tsconfig.json`, `tsconfig.permissions.json`, `tsconfig.tests.json`) | exit 0 |
| `pnpm test:contract` | exit 0: oasdiff reports no unapproved breaking changes, Redocly shows 17 findings, all from the baseline |
| `check:events` | 31 published event keys, all registered |
| `check-events.test.mjs` | 34/34, so the 30→31 bump is correct |

At `04f76ec`, the CI `static` job failed on a TS2339 in the new B1 test. `b48b2a1` fixes that
by wrapping the promise in `Promise.resolve`. At `b48b2a1` the only failing required check I
saw was "pull request template + security review", which is expected until a review is
recorded.

Not checked:

- the API-key caller path;
- the web client;
- the "Code scanning AI findings" workflow failure;
- a full integration-suite run.

**Verdict: BLOCKING FINDINGS (D1).** B2 is CLOSED. B1 is CLOSED for `assignee_present` but
STILL OPEN for `children_closed`. D1 must be fixed, with its regression test, before merge.
D2, N10 and N11 are non-blocking. Any later commit outside
`docs/07-planning/security-reviews/` voids this note. No waiver was sought or used.
