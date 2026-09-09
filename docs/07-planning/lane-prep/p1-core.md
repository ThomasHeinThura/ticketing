> ## ⚠ Read this first — this is a PLAN written against an OLDER `main`
>
> **Baseline:** `955f8d4d`, the tip of `main` on 2026-09-06. **`main` has moved since**, and
> as of 2026-09-09 it is `d4510a2` with nine more pull requests merged. Statements below of
> the form "X does not exist on `main`" or "PR #N is open and unmerged" were **true when
> written and are not true now.**
>
> **What changed under this plan** (see [`../lane-prep/README.md`](README.md) for the full
> reconciliation):
>
> - `packages/domain` **now exists** (PR #69) — service calendars, 59 tests.
> - `packages/ui` **now exists** (PR #63) — the first primitive slice.
> - **CI exists on `main`** (PR #19): the `check:*` gates, `test:all`, the OpenAPI baseline,
>   and eleven required status checks on the `protect-main` ruleset.
> - Retrofit **S0, S2 and S4 have merged** (PRs #65, #67). S1 was already merged (#57).
> - Issue **#7 is complete and closed.**
>
> **What has NOT changed, and is the reason this plan is still the right starting point:**
> **Throttle 1 is still shut.** Its condition 2 requires issue #6 through retrofit **S10**,
> and the retrofit has not run that far. Every "do not write code yet" instruction below still
> stands, unchanged. **How many stages have landed is deliberately not stated here** — an
> earlier version said "S3 and S5–S11 have not started", which went stale as stages merged.
> Read [the retrofit stage ledger](../retrofits/organization-plugin-retrofit.md), which is the
> authoritative count.
>
> This file is committed **as the research artifact it is** — deliberately not rewritten,
> because rewriting a dated plan to look current is how a snapshot starts lying. Trust its
> reasoning, its spec citations and its dependency analysis; re-verify every claim about
> what is or is not on `main` against `main`.

---

# P1 Core — Preparation Plan

Prepared by a Sonnet 5 **PREPARATION** agent. No implementation was done. Workspace used for
research: `/tmp/claude-1000/prep-p1`, branch `feat/p1-prep`, at `955f8d4d` (== `origin/main`
at prep time, 2026-09-06/09). This document is the deliverable.

Scope: the eight P1 issues — **#23 work items · #24 views and layouts · #25 projects and
engagements · #26 relations and hierarchy · #27 comments and activity · #28 attachments ·
#29 search and saved views · #30 assignment.**

All eight GitHub issues (fetched via `gh issue view <n> --repo ThomasHeinThura/ticketing`)
are thin "completion gate" issues: each says "source of truth is `docs/03-features/<x>.md`;
PRs are slices; the spec is authoritative; done when the spec's rules/permissions/screens/
API/edge-cases/tests all pass and the Definition of Done gates are green." **There is no
acceptance criterion anywhere except the spec.** So every "acceptance criteria" section
below is the spec, quoted, not invented.

---

## 0. The most important ground-truth finding, read this before anything else

**The application code on `main` is still kaneo's original schema and route tree.**
`apps/api/src/database/schema.ts` exports `taskTable`, `commentTable`, `projectTable`,
`columnTable`, `taskRelationTable`, `assetTable`, `workflowRuleTable` — kaneo's nouns, not
TaskDesk's. There is no `work_item`, `saved_view`, `watcher`, `organisation`, `person`,
`state` (as a workspace-scoped table), `attachment`, or any of the ~90 tables
`docs/01-architecture/data-model.md` describes. The route tree under `apps/api/src/` is
kaneo's (`task/`, `comment/`, `task-relation/`, `search/`, `workflow-rule/`, `column/`), and
`tests/permissions/inherited-uncovered.json` lists their exact routes (`GET /api/task/{id}`,
`POST /api/comment/{taskId}`, `PUT /api/task/status/{id}`, `GET /api/search`, …) as still
unclassified, pending **#8**.

Three packages the target layout in `AGENTS.md` requires **do not exist yet**: `packages/ui`,
`packages/domain`, `packages/plugins-contracts`. That means **#9 (UI extraction) has not
merged.** Nothing in Throttle 1's five conditions requires #9 — but every P1 screen falls
under do-not rule 1 ("No bespoke primitives. Everything comes from `packages/ui`."), so **no
P1 screen work can start until #9 lands**, even though #9 is not a throttle condition. This
is the single most consequential scheduling fact in this plan and it is not stated anywhere
in the P0 working agreement, because P0's agreement is about the *throttle*, not about every
downstream dependency. Flagged as a genuine finding below, not a restatement of something
already decided.

**Consequence for sequencing:** P1's *backend* slice (Drizzle schema/migration, Zod
schemas, repository, route handlers, policy entries, tests) can start the moment Throttle 1
opens. P1's *screen* slice cannot start until `packages/ui` exists, Storybook runs, and the
`apps/web` agent/portal split (#9) has landed — regardless of Throttle 1's state.

**Consequence for #23 specifically:** issue #23 is not "add a work-items feature" onto an
empty slate. It is a **migration**: `task` → `work_item` (renamed, restructured, with a
`type_id`, `work_item_type`, dozens of new columns), `column` → workspace-scoped `state` +
project-scoped `project_state`, plus the net-new tables (`work_item_key_alias`,
`work_item_template`, `checklist_template`/`checklist_item`, `watcher`, `label`/
`work_item_label`). `docs/04-engineering/migrations.md` states the convention precisely:
migrations are **forward-only, additive, generated from `schema.ts`**, and "renaming or
dropping a column that a running replica may still read" is **two-phase** (add new, dual
write, backfill, cut over, drop old — one release apart). Whether the `task`→`work_item`
rename is done as (a) a Drizzle `rename table` in one migration because there is no
zero-downtime requirement pre-launch, or (b) the formal two-phase dance the doc describes
for a *live* system, **is not stated anywhere I could find**. This is a real open question
(§9).

---

## 1. Dependency order

### 1.1 The real edges (not "these are related")

```
                         #23 work items (work_item, work_item_type, state,
                         project_state, watcher, label, work_item_label
                         — the BASE SCHEMA other issues read/write)
                                    │
        ┌───────────────┬──────────┼──────────────┬───────────────┐
        │               │          │               │               │
   #26 relations   #27 comments  #24 views     #30 assignment   #28 attachments
   (needs           and activity (needs        (needs work_item (needs work_item,
   work_item.       (needs        work_item     .assignee_id,    comment — an
   parent_id,       work_item,    rows + state  project roster  attachment is on
   work_item_       comment,      to filter/    = membership)   one of work_item |
   relation)        activity)     group on)                     comment | submission)
        │               │          │               │               │
        └───────┬───────┴──────────┴───────────────┴───────────────┘
                │
           #29 search and saved views
           (needs work_item + state to index; saved_view.query envelope
           reads the SAME filter grammar #24's board/list/table use —
           #24 and #29 should be built by people talking to each other,
           not strictly serialised, but #29's `POST /api/work-items/search`
           is what #24 calls, so the search route's shape must be settled
           before #24's layouts are wired to real data)
```

**Genuine serialisation point #1 — #23 blocks all seven others.** Every one of #24–#30
reads or writes `work_item` rows, `work_item.assignee_id`, `work_item.parent_id`, the
`state`/`project_state` tables, or `comment`/`activity` rows that themselves hang off
`work_item_id`. None of #24–#30 can be more than scaffolding and pure-function unit tests
until #23's schema exists on a branch other work can rebase onto.

**Genuine serialisation point #2 — #27 (comments and activity) blocks #28 (attachments).**
`attachments.md` `AT-4`: "An attachment on an internal comment is always internal, whatever
its own flag says" and `AT-1`: files attach to "a work item, to a specific comment, or to a
submission." The `attachment.comment_id` FK and the internal-visibility inheritance rule
cannot be implemented, let alone tested, before `comment.visibility` exists.

**Genuine serialisation point #3 — #23 and #26 must agree on hierarchy before #24 ships
roll-up.** `work-items.md` `WI-19` and `relations-and-hierarchy.md` `RH-9`/`RH-14` all
define the *same* roll-up rule (whole subtree, `state.group in ('completed','cancelled')`)
and explicitly cite each other. Whichever of #23/#26 lands first should implement the SQL
roll-up query once; the other cites it. Building it twice, slightly differently, is exactly
the "three inconsistent codebases" failure mode CLAUDE.md warns about.

**Everything else can run in parallel** once #23's schema is on a shared branch/rebase
point: #24 (views), #25 (projects and engagements — genuinely independent; only touches
`project`/`membership`/`milestone`/`prerequisite`/`stakeholder`, not `work_item` internals
beyond the FK), #26, #27, #30 have no edges *between* them beyond what is listed above.
**#28 waits on #27.** **#29 is best done last or in lockstep with #24**, because it defines
the filter grammar and the `saved_view.query` envelope that #24's layouts and its own
`POST /api/work-items/search` both depend on — building #24's filter bar against a
not-yet-settled grammar is the kind of rework the "no bespoke primitives" and "one owner per
identifier" rules exist to prevent.

### 1.2 Recommended first slice

**#23 work items, backend-only first** (schema + Zod + repository + routes + policy +
integration tests — no screens, because `packages/ui`/#9 will not have landed yet in most
timelines). This unblocks every other issue's schema work and is the one piece with no
upstream P1 dependency at all. In parallel with #23's backend: **#25 projects and
engagements**, which is genuinely independent of #23 except for the `project_id` FK
`work_item` already carries, and gives a second track of work without contention.

Do **not** start #24's screen work, or any other issue's screen work, until #9 has merged.
If #9 is still outstanding when Throttle 1 opens, the recommended parallel work is: #23
backend, #25 backend, #26 backend (relations only need `work_item.id`/`parent_id` to exist,
not the full column set), and packages/domain-independent pure functions (fractional
ranking arithmetic for #23, cycle-detection for #26) — all of which can be unit-tested with
no UI at all.

---

## 2. Shared-contract collisions — what needs its own small contract PR first

Per `CLAUDE.md` §5, these are not casually modified by a feature agent. For each, which P1
issue needs it changed:

| Shared contract | Touched by | What changes, and why it needs its own PR |
| --- | --- | --- |
| **The `work_item` base schema** | **#23 owns it outright.** | This *is* the contract PR — #23's first PR must be reviewed and merged before #24/#26/#27/#28/#30 can rebase their schema work on it. Recommend #23's schema migration lands as its own small PR, separated from #23's route/screen work, precisely so #24–#30 aren't blocked on #23's entire feature closing. |
| **Organisation/workspace/project schema** | **#25** (adds `manager_id`, `deleted_at` semantics are already in data-model.md — see §0) and, incidentally, **#23** (`work_item.project_id`) | #25 should not need new columns beyond what `data-model.md` already declares (`project.manager_id`, `project.deleted_at` both already present — see §4). If #25's implementation finds a gap, that gap is a contract PR, not an inline change. |
| **Identity/context types** | None of the eight directly — but every route policy in every issue reads `identity.personId`/`identity.organisationId` from `packages/permissions`. | No P1 issue should touch `packages/permissions/src/identity.ts`. If assignment (#30) needs something new off identity (it should not — `AS-6` compares by person id, already available), that is a contract PR. |
| **Plugin contracts** | **#29** (a future `search.meilisearch` plugin — already reserved, not built, `SV-10`), **#28** (a future `storage.antivirus` plugin — already reserved in `plugin-architecture.md` line 151, not built) | Neither is P1 scope. Confirm in each issue's PR description that the plugin id is reserved-only and no plugin code is written. |
| **The API error envelope** | None need changes — RFC 9457 problem+json, the status-code table in `api-design.md`, and the `202`-pending-action shape already cover every P1 mutation (deletes across #23/#25/#27/#28/#29 are all "ordinary record" 202 pending-actions per the table in `api-design.md`). | No contract PR needed unless implementation finds a genuinely new error shape. |
| **The event envelope** | None need the *envelope* changed. Several issues need **new event keys registered** in `events.md` — that is a same-PR addition (do-not 11), not a contract change, since the envelope shape itself is untouched. See §4 per issue. | — |
| **Route-policy types** (`packages/permissions/src/policy.ts`, `PolicyMap`, `scope`/`scopeSource`/`orSelfTarget`/`orOwner`) | None of the eight need the *types* changed — `rbac.md`'s worked examples already show `orSelfTarget` (assignment) and `orOwner` (comment edit-within-window) as existing policy shapes. | If an issue's implementer concludes a new policy shape is needed, that is exactly the "small dedicated contract PR" case — flag it rather than extend `policy.ts` inline from a feature branch. |
| **The migration journal** | **#23** is the first P1 issue to write new migrations (`0050_…` or wherever #16's `0045`–`0049` leave off) | Per `docs/04-engineering/migrations.md`: additive, generated via `pnpm db:generate`, human-reviewed, forward-only. The `task`→`work_item` rename question (§0, §9) should be settled **before** #23's first migration is generated, because it changes whether the migration is one `ALTER TABLE ... RENAME` or a two-phase add/backfill/cutover pair. |

**Net effect:** realistically only **one** genuine "shared-contract PR" is needed before P1
proper starts: **#23's schema migration**, reviewed and merged on its own, small, before its
own route/screen work and before any other P1 issue rebases onto it. Everything else in the
table above is either already-settled (organisation/project schema, identity types, error
envelope, policy types) or a same-PR identifier addition (events, jobs — do-not 11), not a
pre-requisite contract change.

---

## 3–7. Per-issue detail

Each subsection: acceptance criteria (quoted), identifier registrations owed, test plan
(incl. named negative tests), file surfaces (real paths, not guesses), what it must not do.
Findings are checked against the **current** file content (I read every file listed), not
against the stale 2026-09-05 review — see §8 for how that review's findings map onto today.

### #23 — Work items

**Depends on:** nothing upstream in P1. **Blocks:** #24, #26, #27, #28, #29, #30 (all read/
write `work_item`).

**Acceptance criteria** — `docs/03-features/work-items.md`, 29 numbered rules (`WI-1`…
`WI-29`), all quoted in the spec verbatim; highlights genuinely load-bearing for a first
slice:
- `WI-2`: key is `{project.key}-{number}` from `project.last_work_item_number`
  incremented in the same transaction, never reused.
- `WI-7`: optimistic concurrency on `version`; mismatch is `409` with both versions.
- `WI-9`: "State changes go through the workflow... They are never a plain field update."
- `WI-11`/`WI-12`: fractional-position ranking; rebalance "in the background when the gap
  between neighbours becomes too small to bisect" — **no threshold or job name is given
  anywhere in the corpus** (see identifier gap below).
- `WI-19`: rolled-up progress over the "whole subtree" — shared with `RH-9`/`RH-14`.
- `WI-23`: deletion is a **pending action** (202, approval dialog, 30-day window).
- `WI-25`/`WI-26`: bulk ops are transactional per item, not per batch; illegal transitions
  per item don't block the batch.
- **Open questions: None** (the spec's own section — genuinely closed).

**Identifier registrations already done** (checked against current `data-model.md`, not
the stale review): `work_item`, `work_item_type`, `work_item_key_alias`,
`work_item_template`, `checklist_template`/`checklist_item`, `watcher` (with `source`/
`muted`), `work_item.version`, `work_item.deleted_at`/`archived_at` both present and
independent. `events.md` already has `work_item.created/updated/transitioned/assigned/
unassigned/commented/mentioned/escalated/due_soon/overdue/deleted`.

**Identifier registration #23 still owes** (verified gap, not stale):
- **The position-rebalance background job has no name anywhere.** `background-jobs.md`'s
  job table has no rebalance job, and `WI-12` names no threshold or algorithm. This must be
  added to `background-jobs.md` in the same PR that implements it (do-not 11) — pick a name
  (e.g. `position-rebalance`), a threshold, and whether it runs per-project or globally.
- No event key exists for "bulk operation completed" (`WI-27`'s "one summary row" —
  confirm whether that is `audit_log`-only or also needs a notification-worthy event; if
  the former, no registration needed, just say so in the PR).

**Test plan** (from the spec's own Testing section, expanded with the negative tests the
Definition of Done requires):
- Zod request/response schemas for every route in the API table below.
- Unit: key generation and uniqueness under concurrent creates; fractional ranking
  including rebalance; hierarchy cycle detection; depth cap (5).
- Integration (real Postgres): create/update/delete with policy; **optimistic concurrency
  409** with both versions in the body; bulk partial failure (47 of 50 succeed, 3 reported,
  nothing rolled back); cross-project move with alias redirect.
- **Negative tests, one per "must not"**: a `PATCH` without `work_item:update` is 403; a
  transition attempted via `PATCH` on `state_id` directly must be refused (`WI-9` — "never
  a plain field update" is untestable unless there's a test proving the field is not
  independently writable); a customer re-ranking outside their own organisation's backlog
  is refused (`WI-13`); a bulk delete without the typed affected count is refused (`WI-23`);
  a delete request from a service (non-human) API key is refused (`PA-5`, cited by
  `WI-23`'s "a service key cannot request it"); an unauthenticated/out-of-reach read is 404
  not 403.
- One `activity` row and one `audit_log` row per mutation — named test asserting both are
  written for: create, each field update, transition, assign, delete-request,
  delete-approval.
- The domain event for every mutation with an event key above.
- A route-policy entry for every route below, asserted by the (not-yet-merged) route
  coverage test — write the policy now so it is ready the moment #19 merges.

**File surfaces** (real paths, current tree):
- Rename/extend `apps/api/src/database/schema.ts`'s `taskTable` → the new `work_item`
  table plus the net-new tables listed above; new migration(s) under `apps/api/drizzle/`.
- New feature folder `apps/api/src/work-item/` (replacing `apps/api/src/task/`), with
  `policy.ts` exporting a `PolicyMap` (pattern: `apps/api/src/project/policy.ts`,
  `apps/api/src/instance/policy.ts` already show the shape), a repository module, route
  handlers, Zod schemas.
- Wire the new `workItemPolicies` into `apps/api/src/policy-registry.ts` (currently
  imports only `instancePolicies`, `projectPolicies`).
- Remove the corresponding entries from `tests/permissions/inherited-uncovered.json` as
  each old `task/*` route is retired (coordinate with #8 — do not silently leave stale
  entries pointing at deleted routes, and do not silently delete entries that are actually
  #8's job to classify if #23 is not the one retiring that specific route).
- Screens: no work until `packages/ui` exists (§0). Route inventory:
  `/agent/work-items/{key}` (full page + side pane), create dialog — from
  `docs/02-design/screen-inventory.md` lines 58–67.

**What #23 must NOT do:**
- Must not silently pick a `task`→`work_item` migration strategy without recording the
  choice (§9 — genuinely undecided).
- Must not invent a new policy shape or touch `packages/permissions` types inline — the
  `orSelfTarget`/`orOwner` shapes already exist and cover `WI-13`/bulk-per-item re-check.
- Must not implement watch/notify beyond what `notifications.md` (P4, not yet built) — the
  spec correctly scopes `WI-28`/`WI-29` to storage + read-time behaviour, not delivery.
- Must not build cycles/modules bulk actions (`WI-24` lists "move to cycle or module" —
  those are `feature.cycles`/P5-gated per the review's fix, confirm this gating exists in
  the actual implementation, since the current spec text still lists them un-gated in the
  bullet — worth a one-line spec fix in the same PR).

---

### #24 — Views and layouts

**Depends on:** #23 (work_item, state). Loosely coupled to #29 (shares the filter grammar
and `POST /api/work-items/search`).

**Acceptance criteria** — `docs/03-features/views.md`, `VW-1`…`VW-34`. P1 scope is **Board,
List, Table only** — Calendar and Timeline are explicitly P5 in both this spec's own
Layouts table and `plugin-architecture.md`'s `feature.timeline`/`feature.calendar` flags,
so #24's P1 slice is smaller than the full spec. Highlights:
- `VW-9`: dragging between board columns is a workflow transition, never a field update;
  illegal drop returns the card with a reason.
- `VW-14`: full keyboard drag (`Space` lift, arrows, `Space` drop, `Escape` cancel, live
  region).
- `VW-23`: CSV/XLSX export **already has** a capability and route in the current spec text
  (`work_item:export`, `POST /api/work-items/export`, audited as `work_item.exported`) —
  this was an open finding in the stale review and is now closed; confirm the export event
  key exists in `events.md` (it does not yet — see gap below).
- **Open questions: None** (present and empty).

**Identifier registrations still owed:**
- `work_item.exported` is not in `events.md`'s catalogue (checked — absent). #24 must add
  it in the same PR that implements `VW-23`.
- `user_preference` **already exists** in `data-model.md` (`person_id, scope, scope_id,
  key, value jsonb` — "layout per project, density, chosen columns, column widths,
  collapsed groups, pinned views, drafts") — this closes the review's biggest concern for
  this spec (`VW-2`/`VW-6`/`VW-15`/`VW-19`/`VW-21`). No new table needed; #24 just needs to
  use it.

**Genuine remaining gap (verified against current file, not the stale review):** the spec
still has **no `## Data` section** (template requires one) and **no `## Permissions`
table** — reading the current file, permissions are still one prose paragraph ("Reading a
view requires `work_item:read`... drag-to-transition needs `work_item:transition`...")
rather than the per-action table the spec template mandates and the review asked for. This
is a real, currently-open compliance gap against `docs/03-features/README.md`'s own
template rules — small to fix (tabulate what is already stated in prose) but it is not
done today.

**Test plan:**
- Unit: filter grammar compilation; grouping; rank arithmetic.
- Integration: search returns only items within reach; an illegal drag-transition is
  refused **with a reason** (negative test); export without `work_item:export` is 403
  (negative test, since `VW-23` is new-ish and easy to under-police).
- E2E: switch layout, filters persist (`VW-1`); keyboard-only board drag; two browser
  contexts see each other's drag (`VW-5`).
- Performance: board 200 items <500 ms; table 500 rows <500 ms; no dropped frames during
  drag.
- Activity/audit: export writes `work_item.exported`; no other #24 action mutates data
  directly (layouts are read-only presentations over #23's mutations) except inline edits,
  which are `work_item:update`/`transition`/`assign` calls already covered by #23's tests —
  #24 should not duplicate those, only assert the UI calls the right endpoint.

**File surfaces:** `apps/web/src/components/kanban-board/`, `board/`, `list-view/`,
`backlog-list-view/` already exist (kaneo-derived) and are the pre-migration equivalents;
expect a rename/restructure once `packages/ui` primitives exist. No API changes beyond
`POST /api/work-items/export` (new) — everything else reads `POST /api/work-items/search`
(#23/#29). Screens: `/agent/projects/{key}/work?layout=board|list|table` (screen inventory
lines 40-42).

**What #24 must NOT do:** must not build Calendar/Timeline (P5, feature-flagged off); must
not implement collaborative multi-cursor drag (out of scope, no spec); must not persist
per-user preferences anywhere but `user_preference` (do not invent client-only
`localStorage`-only state for things the data model already gives a server-side home to,
since that would silently break "layout persists" across devices — the spec's stated
promise).

---

### #25 — Projects and engagements

**Depends on:** nothing in P1 (only `work_item.project_id` as a foreign reference, which
#23 already owns). Genuinely parallelisable with #23.

**Acceptance criteria** — `docs/03-features/projects-and-engagements.md`, `PR-1`…`PR-20`.
Highlights:
- `PR-6`: exactly one project manager — **`data-model.md` already resolves this**
  (`project.manager_id → person`), closing the stale review's High finding. The spec text
  itself still doesn't cite the column name (`PR-6` just says "must have exactly one
  project manager") — low-severity, worth a one-line cross-reference in the same PR.
- `PR-9`: "a managed service must have a support level and a service calendar" — the
  edge-case table says this is **refused**, i.e. blocking.
- `PR-15`/`PR-16`: archive (read-only) vs. 30-day soft delete are independent —
  `data-model.md` already has both `archived_at` and `deleted_at` on `project`, closing
  that stale finding too.
- `PR-20`: project deletion is a pending action with **typed project key + step-up**.

**Genuine remaining gap (verified):** `PR-6`–`PR-10` are still **not individually marked
blocking or warning**. The section header says "warned about rather than blocked where
reasonable," but the edge-case table contradicts this for `PR-9` ("Managed service with no
calendar → Refused"). `PR-7` is explicitly non-blocking ("Project with no members →
Allowed"). `PR-6`, `PR-8`, `PR-10` are **still ambiguous** — this is exactly the review's
finding and it is **not fixed today**. This is a genuine open item, small to close (one
word per rule).

**Contract mismatch found (new, not in the stale review — verified against current
`rbac.md`):** `projects-and-engagements.md`'s Permissions table and API list both say
**"Manage members → `workspace:manage_members`"** (line 130) and **`POST /api/projects/
{key}/members → workspace:manage_members`** (line 154). But `rbac.md` (the authoritative
capability list, rewritten 2026-09-05) defines **`project:manage_members`** as the real
capability — "Manage the project roster and per-project roles, and the two reach-affecting
fields `parent_id` and `owner_team_id`" — and the `manager` and `lead` role rows in
`rbac.md`'s own matrix are seeded with `project:manage_members`, not
`workspace:manage_members`. **This is a live, current contradiction between two
authoritative documents**, not a stale finding — `projects-and-engagements.md` needs a
one-line fix to cite `project:manage_members` (do-not 15/spec interaction rule: fix the
spec in the same PR that notices it, or raise it now so #25's implementer doesn't have to
rediscover it).

**Identifier registrations:** `project.created`/`project.archived` events already exist.
No `project.deleted` event is registered (checked — absent from `events.md`), though the
pending-action flow presumably emits `pending_action.*` events instead; confirm whether a
dedicated `project.deleted` domain event is needed for automations/webhooks, or whether the
generic pending-action events suffice — worth a one-line decision in the PR rather than a
silent omission.

**Genuine remaining gap:** no `## Data` section (template violation, same as #24; the
review flagged it and it is still absent).

**Test plan:** Unit: composition validation (once blocking/warning is resolved, above);
hierarchy depth (max 4); inherited membership resolution. Integration: reach through
inherited membership; archiving cascades; a customer sees only projects serving their
organisation (**negative test**: a customer session must not see a project whose
`organisation_id` differs from theirs). E2E: create project, add members, observe the
composition banner clear. Negative tests specifically owed: creating a managed service
with no calendar is refused (`PR-9`); a 5th-level-deep project creation is refused
(`PR-1`'s depth cap); deleting a project without the typed key + step-up is refused
(`PR-20`).

**File surfaces:** `apps/api/src/project/` already exists (kaneo-derived, has
`policy.ts` with exactly one route classified so far — `GET /api/project/{id}`). #25 adds
the rest: members, stakeholders, milestones, prerequisites CRUD, health. Screens:
`/agent/projects/{key}` overview, `/agent/projects/{key}/settings/*` (screen inventory
lines 39, 137-145).

**What #25 must NOT do:** must not build cycles/modules (P5); must not build SLA binding
directly (P2, `sla.md` owns `project.sla_policy_id` semantics); must not let "manage
members" default to a workspace-wide capability now that `project:manage_members` is the
documented capability — implementing against the spec's stale `workspace:manage_members`
text would itself become a new contract mismatch.

---

### #26 — Relations and hierarchy

**Depends on:** #23 (`work_item.parent_id`, `work_item_relation`). Feeds #24's roll-up UI
and #27's `RH-18` notification.

**Acceptance criteria** — `docs/03-features/relations-and-hierarchy.md`, `RH-1`…`RH-19`.
Highlights:
- `RH-6`/`RH-12`: same-project parentage is now **internally consistent** in the current
  spec text (declining a cross-project move "detaches" children so `RH-6` "always holds") —
  this closes the stale review's top High finding (a direct self-contradiction). Confirm
  `work-items.md WI-15` still agrees (it does — both cite the same resolution).
- `RH-16`: blocking guard uses `state.group not in ('completed','cancelled')`, not the word
  "open" — already fixed from the stale review's finding.
- `RH-9`/`RH-14`: roll-up is defined **once**, in `WI-19`, and both `RH-9` and `RH-14` cite
  it rather than restating it — the stale review's duplicate-definition finding is closed.

**Genuine remaining gaps (verified, not stale):**
- **No `## Data` section and no `## Open questions` section anywhere in the file.** This is
  the same structural gap the review found, and it is **still true today** — I read the
  full current file and there is no such section. Per `docs/03-features/README.md`: "Open
  questions must be empty before implementation starts" — an absent section cannot be
  verified empty by any mechanical check, which is exactly the problem `check:reviews`
  (not yet on `main`, lands with #19) is meant to police. **This spec cannot pass a literal
  reading of the Definition of Done until the section exists.**
- `RH-18` ("the assignee of the blocked item is notified") still names no event key.
  `events.md` has no `work_item.unblocked` (verified — absent). #26 owes this registration.
- Permissions are still one sentence of prose, not a table (template violation, same
  pattern as #24).

**Test plan:** Unit: cycle detection at every depth; inverse label rendering (`relates` is
symmetric, the rest directional); roll-up arithmetic (shared with #23 — do not
re-implement, call the same function). Integration: a relation to an out-of-reach item
returns a count only, never key/title (`RH-4` — **negative test**: assert the response body
contains no identifying fields); creating a relation requires `work_item:update` on **both**
ends (**negative test**: update-on-one-end-only is refused). E2E: three-level tree, roll-up
correctness, close a blocker and see the badge clear.

**File surfaces:** `apps/api/src/task-relation/` (kaneo-derived) is the pre-migration
route; `tests/permissions/inherited-uncovered.json` lists `GET/POST /api/task-relation*`
as currently unclassified. #26's implementation effectively replaces this folder with
`apps/api/src/work-item/relations.ts` or similar under the new `work-item` feature folder,
plus a `parent`/`tree` route (`GET /api/work-items/{key}/tree`).

**What #26 must NOT do:** must not allow parent/child across projects without the explicit
detach flow (`RH-12`); must not surface a hidden out-of-reach relation's key or title, ever
(`RH-4` — this is the exact class of leak `rbac.md`'s 404-not-403 doctrine exists to
prevent); must not silently cap depth differently from work-items.md's stated 5.

---

### #27 — Comments and activity

**Depends on:** #23 (`work_item`). **Blocks #28** (attachment-on-comment visibility
inheritance needs `comment.visibility` to exist and be tested first).

**Acceptance criteria** — `docs/03-features/comments-and-activity.md`, `CA-1`…`CA-20` plus
`CA-11a`. This is the spec with the most security-sensitive rule in the corpus:
- `CA-3`: "Internal comments are filtered server-side in the portal router. Never in the
  client, never by a CSS class, never by a conditional render."
- `CA-7`: **already has** the exhaustive verb→visibility table the stale review demanded
  ("An unmapped verb or field is `internal`" — fails closed). This closes that finding.
- `CA-17`/`CA-18`: edit window (15 min) and tombstone-on-delete — `comment_version` and the
  `comment.deleted_at`/`deleted_by` tombstone columns **already exist** in `data-model.md`,
  closing that stale finding.
- `CA-19`/`CA-20`: canned responses — `canned_response` table **already exists**, closing
  that stale finding.
- Named test **`portal-never-returns-internal.test.ts`** is specified by name in the spec
  itself — this exact filename must exist in the test suite; it is the single
  highest-value negative test in this issue.

**Genuine remaining gap, newly verified (not in the stale review as such, but a live
contract mismatch today):** the current Permissions table still reads:
```
Edit own within window | comment:create
Edit anyone's          | comment:update_any
Delete anyone's        | comment:delete_any
```
But `rbac.md` (rewritten 2026-09-05) defines **`comment:update_own`** and
**`comment:delete_own`** specifically for this pattern, and its own worked policy example
literally uses this route as its illustration:
```ts
'PATCH /api/comments/{id}': { capability: 'comment:update_any', scope: 'work_item',
  orOwner: { predicate: 'row.person_id === identity.personId',
             capability: 'comment:update_own', withinMinutes: 15 } },
```
`comments-and-activity.md`'s own Permissions table and API section have **not** been
updated to cite `comment:update_own`/`comment:delete_own`, and there is **no "Delete own"
row at all** in the Permissions table. This is a real, current inconsistency between the
feature spec and the authoritative capability registry — #27's implementer should fix the
spec table in the same PR (do-not 15) rather than build against the stale capability name.

**Also still missing (verified):** no `## Data` section, no `## Open questions` section, no
`## Out of scope` section — same structural gap pattern as #24/#26.

**Test plan:** Integration — `portal-never-returns-internal.test.ts` (named in spec);
visibility cannot be changed after creation (**negative test** on `PATCH` attempting to
change `visibility`); a customer cannot be mentioned in an internal comment (`CA-13` —
**negative test**, picker-level and server-level both); an internal comment/activity row is
absent from `GET /api/portal/requests/{ref}/activity` (separate handler, not a filtered
one — assert by code path, not just by output, per `CA-3`'s "never... by a conditional
render"). Unit: activity grouping window (5 min); mention parsing; work-item-reference
(`#SUP-123`) parsing. E2E: post internal + public, sign in as customer, confirm only public
in DOM.

**File surfaces:** `apps/api/src/comment/` and `apps/api/src/activity/` already exist
(kaneo-derived); `tests/permissions/inherited-uncovered.json` lists their current routes
(`POST/PUT/DELETE /api/comment/{...}`, `POST/PUT /api/activity/comment`) as unclassified —
#27 effectively replaces these with the new `comment`/`activity` shape (visibility,
tombstone, versions) under policies keyed to the new routes in the spec's API section.

**What #27 must NOT do:** must not filter internal comments client-side, ever (`CA-3` is
the one rule in this whole plan phrased as an absolute); must not allow visibility to
change post-creation (`CA-4`); must not base64-embed pasted images into the document body
(`CA-15` — must create an attachment and reference it, which is the #27→#28 coupling).

---

### #28 — Attachments

**Depends on:** #23 (`work_item`), **#27 (`comment`, for `AT-1`/`AT-4`)**.

**Acceptance criteria** — `docs/03-features/attachments.md`, `AT-1`…`AT-14`. Highlights:
- `AT-2`: presigned direct upload; API never proxies bytes.
- `AT-5`: presigned download, 5-minute lifetime, **"no anonymous read path": kaneo's
  `is_public` branch in `authorize-asset-access.ts` is deleted at fork.** This references
  `status.md`'s line 933 finding directly — confirm this deletion is tracked under #16/#6,
  not accidentally re-introduced by #28.
- `AT-7`: soft delete, nightly `attachment-gc` — **already named** in `background-jobs.md`
  (`attachment-gc` daily 03:30, `attachment-pending-cleanup` hourly), closing the stale
  review's finding that no job existed. `attachment.state` (`pending`/`ready`/`deleted`)
  **already exists** in `data-model.md`, also closing that finding.
- Reopen-on-upload edge case now cites `WF-21`/`CP-8`/`instance_setting.reopen_window_days`
  concretely — closing the stale review's "unimplementable as written" finding.
- The malware-scanning gap is an **explicit, accepted residual risk**, decided
  2026-09-05, not an open question — do not re-raise it.

**Genuine remaining gaps (verified):**
- No `## Data`, `## Open questions`, `## Screens`, or `## Out of scope` sections — same
  structural gap pattern.
- `AT-6`: "Every download writes an audit row" — no action key is named anywhere
  (`audit_log.action` should be `attachment.download` per the review's suggestion; not
  present in `audit-trail.md`'s action catalogue as far as I checked — worth confirming
  before implementation, since a missing action name is a fail-closed risk for the audit
  gate the whole product exists to satisfy).

**Test plan:** Integration: presign refused without `attachment:create`/portal predicate
(**negative test**); a `.png` containing an executable header is rejected at `complete`
(magic-bytes check, **negative test** — this is explicitly named in the spec); a
non-`customer_visible` attachment is **absent** from every portal response (**negative
test**, same class as `CA-3`'s portal isolation); a path-traversal filename produces a safe
generated object key (**negative test**); presigned POST conditions pin exact object key +
`content-length-range` + content type (**negative test**: attempt to write a different key
with the issued credential must fail). E2E: drag-drop, paste screenshot, download, delete +
restore within window, portal upload on a phone viewport.

**File surfaces:** `apps/api/src/storage/` currently has only `s3.ts` (status.md's #11
prerequisite gap — no filesystem driver yet; not blocking for #28 if deployment targets
S3-compatible storage, but worth noting since local/dev environments may need the
filesystem driver first). No `apps/api/src/attachment/` folder exists yet — kaneo's
equivalent is `apps/api/src/database/schema.ts`'s `assetTable`, with
`GET /api/asset/{id}` listed in `inherited-uncovered.json`. #28 replaces this with the new
`attachment` table/routes.

**What #28 must NOT do:** must not re-introduce any anonymous/public read path (`AT-5`);
must not proxy file bytes through the API (`AT-2`); must not build a virus scanner (`AT-9`'s
sandbox note and the accepted-risk decision both say this is out of scope for now); must
not let an attachment on an internal comment be marked customer-visible (`AT-4`).

---

### #29 — Search and saved views

**Depends on:** #23/#24 (needs `work_item`+`state` to index, and the filter grammar #24
also consumes).

**Acceptance criteria** — `docs/03-features/search-and-saved-views.md`, `SV-1`…`SV-23`.
Highlights:
- `SV-5`: 100 ms hard budget for palette results — a **performance** acceptance criterion,
  not just a nice-to-have; needs a seeded 10,000-item dataset test (named in spec).
- `SV-12`: field names whitelisted; grammar compiles to parameterised SQL, "can never
  express arbitrary SQL" — a security acceptance criterion.
- `SV-15`: saved views have three **scopes** — private/team/workspace. `data-model.md`'s
  `saved_view` **already has** a `visibility` column with exactly these three values,
  closing the stale review's biggest finding for this spec (the scope/visibility axis
  confusion).
- `SV-14`: filter/sort/grouping/layout/columns — `saved_view.query jsonb` **already has**
  the envelope `{ entity, filter, sort, groupBy, columns, aggregate }` per `api-design.md`,
  closing that stale finding.
- The API section in the current spec **already gives every route a capability**
  (`saved_view:read`/`create`/`create → workspace scope`, pin as a `user_preference` write,
  count cached 30s) — closing the stale review's "five routes with no policy" High finding.
- `SV-17` "team leads" — `team_member.is_lead` **already exists**, closing that stale
  finding.

**Genuine remaining gaps (verified):** no `## Data`, `## Open questions`, `## Screens`, or
`## Out of scope` sections — same structural pattern as #24/#26/#27/#28. `SV-9`'s `pg_trgm`
trigram index is not confirmed present in `data-model.md`'s indexing section — worth
checking before implementation (I did not verify this one exhaustively; **mark uncertain**,
would need to re-read `data-model.md`'s `## Indexing` section, lines 367-409, in full).

**Test plan:** Unit: filter grammar parse/compile both directions; `@me` resolution. 
Integration: search never returns out-of-reach records (**negative test**, same 404-not-403
pattern used everywhere in this corpus); a shared view yields per-viewer results (two
identities, one view, different result sets — **named test**); the grammar cannot express
injection (**negative test** — attempt a raw-SQL-shaped filter value and confirm it is
rejected or treated as a literal). E2E: palette <100 ms against 10,000 seeded items; save,
share, open as another user.

**File surfaces:** `apps/api/src/search/` exists (kaneo-derived); `GET /api/search` is
listed in `inherited-uncovered.json` as unclassified. No `saved_view`/`views` folder exists
yet — net new under `apps/api/src/views/` or similar.

**What #29 must NOT do:** must not expose the palette to customers with staff visibility
(`SV-1`'s "people" search must respect rbac.md's customer rules — the spec doesn't fully
resolve whether the palette is agent-only; treat as needing confirmation, not a guess);
must not enable `search.meilisearch` by default (`SV-10` — "only if Postgres is measured to
be insufficient. Not on principle, not preemptively").

---

### #30 — Assignment

**Depends on:** #23 (`work_item.assignee_id`), #25 (project roster = membership).
**P1 scope is explicitly narrower than the full spec** — per the issue body: "The
assignment UI/defaults land in P1; the rule engine ports with `packages/domain` in P2."

**Acceptance criteria** — `docs/03-features/assignment.md`, `AS-1`…`AS-18`. This is the
**best-formed spec in the group** — full template sections present, "Open questions: None"
is genuinely true, and most of the stale review's findings are already closed:
- `AS-13`: workflow-transition assignee effects now cite `workflow_transition.effects`
  and `WF-19` concretely — closing the stale review's "no effects mechanism" High finding.
- `AS-12`: `request_type.default_assignee_id` **already exists** in `data-model.md`,
  closing that stale finding.
- `AS-1`/`AS-2`: now phrased in capability terms (`work_item:assign` /
  `work_item:update` + self-target predicate) rather than role names — closing that stale
  finding. The API section's `orSelfTarget` policy shape matches `rbac.md`'s worked
  example exactly.
- `AS-15`: round-robin explicitly out of scope — **this matches the decision log entry
  "2026-09-05 · Round-robin assignment out of scope" verbatim.** Not an open question.

**Genuine remaining gap (verified, low severity):** the "two people self-assign
simultaneously → optimistic concurrency" edge case still describes concurrency control on
an **action route** (`POST .../assign`), and `api-design.md`'s `## Concurrency` section
scopes `If-Match`/`version` to `PATCH` only, with rank actions as the sole named exception.
Whether the assign action gets an optional `If-Match` or a conditional
`WHERE assignee_id IS NULL` returning 409-with-winner is **not stated** — small, but
genuinely unresolved; pick one in the PR.

**Test plan:** Unit: the `AS-1`–`AS-5` matrix, every role × every assignment target
(**named test**, spec explicitly asks for this shape). Integration: a member cannot assign
to a colleague (**negative test**); a customer session cannot assign at all (**negative
test** — `AS-4`, "the control does not exist in the portal and the API refuses it" — assert
both); assignment to someone off the roster is refused (**negative test**, `AS-5`);
identity comparison is by id, proven with two people sharing a display name (**named
test**, directly citing `AS-6`'s "J. Smith" warning). E2E: self-assign; take work from a
colleague, see the confirmation (`AS-3`); inactive assignee renders as inactive, not blank.

**File surfaces:** no dedicated `assignment` folder — this issue's routes
(`POST/DELETE /api/work-items/{key}/assign`, `GET /api/projects/{id}/assignable`,
`POST /api/work-items/bulk/assign`) live inside the `work-item` feature folder #23 creates.
Coordinate file ownership with #23 explicitly — this is the one issue most likely to
collide with #23 on the same files if not sequenced (#23's routes file and #30's routes
file should be separate modules within `apps/api/src/work-item/` from the start).

**What #30 must NOT do:** must not build round-robin/load-balanced assignment (`AS-15`,
decided); must not build the workflow-effects engine itself (`workflow_transition.effects`
execution is `workflows.md`/P2 scope — #30 only needs to consume `set_assignee`/
`clear_assignee` effects, not implement the effects runner); must not build on-call rotas
(explicitly out of scope).

---

## 8. What the 2026-09-05 review actually still means today

`docs/07-planning/reviews/2026-09-05/features-core-servicedesk.md` reviewed all eight
specs and found **zero** of them "ready" outright — 4 "ready-with-fixes" (#23, #24, #25,
#30) and 4 "not-ready" (#26, #27, #28, #29). **Git history shows the specs were revised at
least twice since** (`docs: apply planning review decisions`, `2f32bed`; `docs: apply
Thomas's confirmed pre-P0 decisions`, `b852b3b`), and cross-checking every High/Medium
finding against the **current** file content (not the review's snapshot) shows **the large
majority of data-model-shaped findings are closed**: `deleted_at` columns, `version`
columns, `work_item_key_alias`, `checklist_template`, `comment_version`,
`canned_response`, `workflow_transition.effects`, `saved_view.visibility`,
`user_preference`, `team_member.is_lead`, `request_type.default_assignee_id` all now exist
in `data-model.md`, and most capability gaps in `rbac.md` are filled.

**What is still genuinely open, verified against today's files, is narrower and more
structural than the original review:**
1. **Four specs (`relations-and-hierarchy.md`, `comments-and-activity.md`,
   `attachments.md`, `search-and-saved-views.md`) still have no `## Open questions`
   section at all** — the exact four the review called "not-ready." An absent section
   cannot be verified empty, so these four cannot honestly be called spec-closed yet.
2. **Six of eight specs (`views.md`, `relations-and-hierarchy.md`,
   `comments-and-activity.md`, `attachments.md`, `search-and-saved-views.md`,
   `projects-and-engagements.md`) have no `## Data` section.**
3. **Two live cross-document contradictions I found fresh** (not in the stale review):
   `projects-and-engagements.md` vs `rbac.md` on `project:manage_members` vs
   `workspace:manage_members` (§ #25); and `comments-and-activity.md` vs `rbac.md` on
   `comment:update_own`/`comment:delete_own` (§ #27).
4. **Two unresolved ambiguities the review named and which are still unresolved**:
   `PR-6`–`PR-10`'s blocking-vs-warning marking (§ #25), and `WI-12`'s unnamed rebalance
   job/threshold (§ #23).

Per the spec interaction rule (`CLAUDE.md` §6), items 1–4 above should be closed — spec
edits, not architecture decisions — **before** each affected issue's implementation starts,
and per the working agreement, "reviewers check it, not the author": whoever picks up
#26/#27/#28/#29 should not be the one who also signs off that their own spec's Open
Questions section is now non-empty-and-then-emptied.

---

## 9. The Throttle 1 dependency — what needs #19, what does not

**Throttle 1's five conditions** (from `status.md`, all currently unmet): #5 done; #6 the
issue complete (S2–S10 of the `organization()` retrofit remain); #7 complete (issue still
open even though #21 merged the registry); route coverage **executing** in CI (needs #19
merged); adding an unclassified route **failing** the build (needs #19 merged + required-
check/ruleset reconciliation after it).

**What P1 can do before #19 merges:**
- Write every route's policy entry in `policy.ts` files, in the exact `PolicyMap` shape
  `rbac.md` documents. This is real, reviewable work — it just cannot be **enforced** by CI
  yet, so a missing policy will not fail a build until #19 lands. Nothing stops writing it
  correctly now.
- All schema/migration work, all Zod schemas, all repository/business logic, all unit
  tests, all integration tests against a real Postgres (`pnpm test:integration` **already
  runs on `main`**, per `AGENTS.md`'s command table — this is not gated by #19).
- `pnpm test:permissions` **already exists on `main`** (via #21/`cc5d7326`) — so the route
  coverage test, permission matrix test and role×route matrix **can be run locally** by
  every P1 PR today, even though nothing forces it in CI yet. **Recommend every P1 PR runs
  `pnpm test:permissions` locally and reports the result in the PR description**, since the
  gate is real code, just not yet a required check.

**What genuinely needs #19 (or the throttle) before it can be *enforced*, not just
written:** nothing in P1's own scope is blocked from *starting* by the throttle — the
throttle governs whether **parallel development across lanes is sanctioned at all** (P0
working agreement §2), not whether any individual gate can run. Once Throttle 1 opens, P1
work is unblocked to begin; #19 merging afterward is what turns the already-written policy
entries and already-passing local `test:permissions` runs into an enforced CI gate. **P1
should not wait for #19** — it should write to the gate's contract now, in the confidence
that #19 will start enforcing it.

---

## 10. Open questions that genuinely need Thomas

Checked against `decision-log.md` (1953 lines, read in full via targeted search) before
listing anything here — several apparent questions turned out to be already decided (round-
robin assignment: decided out of scope, 2026-09-05; RLS backstop scope: decided, P0 only,
on `work_item`/`comment`/`attachment`; multi-currency: decided, never convert). What is
left, genuinely undecided as far as I can find:

1. **The `task`→`work_item` migration strategy** (§0, §2): one-shot rename vs. the
   two-phase add/backfill/cutover `migrations.md` prescribes for a live table. Since there
   is no production data yet (pre-launch), the two-phase dance may be unnecessary
   overhead — but `migrations.md` doesn't carve out a pre-launch exception, and nobody has
   said which applies to #23's very first migration. **Needs a decision before #23's first
   migration PR, not a guess.**
2. **`PR-6`–`PR-10`'s blocking-vs-warning marking** (§ #25) — this is a product-behaviour
   call (does an incomplete project block work or just warn?), not a technical one, and the
   spec's own framing ("warned about rather than blocked where reasonable") contradicts its
   own edge-case table. Small, but it changes tested behaviour, so it should be a decision-
   log entry, not an implementer's guess.
3. **Whether `SV-1`'s command palette is agent-only or has a defined customer-visible
   subset** (§ #29) — the spec says the palette searches "people," and rbac.md is explicit
   that customers must never see staff names; the spec never states whether customers get
   the palette at all. Marked **uncertain** above because I did not exhaustively cross-
   check `customer-portal.md` for whether it already answers this from the portal side —
   worth a targeted re-read before treating it as genuinely open.

Everything else that looked like an open question in the stale 2026-09-05 review turned out
to already be closed in `data-model.md`/`rbac.md`/`events.md`/`background-jobs.md` — see §8.

---

## NOT DONE

- **`data-model.md`'s `## Indexing` section (lines 367-409) was not fully read** — I did
  not verify whether `pg_trgm`/trigram indexing for `SV-9` is present. Would need a direct
  read of that range before treating it as either closed or open.
- **`customer-portal.md` was not read** — relevant to the #29 open question above (whether
  the command palette has portal-side rules already) and to #27's `CA-3` portal-isolation
  pattern (I inferred consistency from `api-design.md`'s `/api/portal/*` note and
  `comments-and-activity.md`'s own text, not from reading `customer-portal.md` directly).
- **`workflows.md` was not read in full** — cited repeatedly (effects vocabulary, `WF-9`,
  `WF-15`, `WF-17`, `WF-18`, `WF-19`, `WF-21`) via `data-model.md` and the other specs'
  cross-references, but I did not open the file itself to confirm those citations are
  mutually consistent from the *workflows.md* side. If workflows.md's own text disagrees
  with what `assignment.md`/`attachments.md`/`relations-and-hierarchy.md` say it says,
  that would be a new finding I have not caught.
- **`docs/01-architecture/multi-tenancy.md`, `pending-actions.md`, `storage-and-
  attachments.md`, `audit-trail.md` were not read directly** — cited via other documents'
  cross-references and `data-model.md`'s inline explanations, treated as reliable but not
  independently verified.
- **`docs/02-design/screen-inventory.md` was only grepped for P1 rows, not read in full** —
  the P1 screen count (33, per `status.md`) was not individually enumerated against all
  eight issues; I pulled the rows that matched obvious keywords, which may have missed
  screens using different terminology (e.g. a bulk-edit bar or a create dialog might be
  listed without the word "work item" in it).
- **`packages/permissions/src/*.ts` was only partially read** (policy.ts referenced via
  rbac.md's worked example and route-coverage.test.ts/registry.ts were not opened) — the
  exact current `PolicyMap`/`createPolicyRegistry` type signatures were not independently
  confirmed against rbac.md's prose description, only cross-referenced.
- **No exhaustive per-rule enumeration was done for every one of the ~180 numbered rules
  across all eight specs against every authoritative doc** — I read every spec in full and
  checked the load-bearing/high-severity findings from the stale review against current
  `data-model.md`/`rbac.md`/`events.md`/`background-jobs.md`, but did not independently
  re-derive every Medium/Low finding from scratch; some Low-severity items from the stale
  review (route parameter naming consistency, a few cosmetic capability names) were not
  individually re-verified and may still be open.
- **`apps/web`'s current component tree was only listed one level deep** — file-surface
  guidance for screens is directional (which kaneo-derived folder is the likely
  pre-migration equivalent), not a guarantee that no other file needs touching.
- **No code was written, no branch was pushed, no dependency was installed, no test was
  run.** Per the task's hard boundaries.
