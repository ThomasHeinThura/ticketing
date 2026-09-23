# Security review — work-item `activity` table; kaneo's becomes `task_activity` (migration 0066)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `9bdcfb45a90b5a7f4f851f483a59a87f25bd782e`
**Reviewed SHA:** `9bdcfb45a90b5a7f4f851f483a59a87f25bd782e` (confirmed via `gh pr view 275 --json headRefOid`)
**Branch:** `feat/work-item-activity-table`
**Pull request:** #275
**Date:** 2026-09-23

## Surfaces examined

- `apps/api/drizzle/0066_work_item_activity_table.sql`, `meta/_journal.json`
- `apps/api/src/database/{schema.ts,relations.ts,index.ts}` (`activityTable`, `taskActivityTable`, relations)
- `apps/api/src/work-item/activity.ts` (`resolveVisibility`, `recordWorkItemActivity`, `diffWorkItemFieldChanges`)
- The 17 renamed legacy files, including `search/controllers/global-search.ts`,
  `utils/workspace-access-middleware.ts`, `storage/cleanup-assets.ts`, `activity/**`, `comment/**`
- Every hard-delete path that reaches `work_item`: `workspace/controllers/delete-workspace.ts`,
  `user/controllers/delete-account-data.ts`, `project/controllers/delete-project.ts` (soft), the
  `purge_after` contract for the future #198 purge job
- `packages/mcp/src/tools/register.ts` (HTTP-only; no SQL), `charts/taskdesk/values.yaml`
- Spec: `docs/03-features/comments-and-activity.md` CA-6/CA-7/CA-10, `data-model.md` §4, decision
  log 2026-09-23 "Work-item activity gets its own `activity` table"

---

## Verdict

**CHANGES NEEDED — two BLOCKING findings (S1, S2).**

Tenant integrity of the new table is sound: the composite FK is real and rejects a mismatched
`(workspace_id, work_item_id)` pair at the database, `seq` cannot be caller-supplied, and the
`visibility` CHECK/NOT NULL/default hold under raw SQL. The legacy rename is complete: no
remaining `activityTable` use outside the new writer, no view/function/trigger/policy references
`activity`, typecheck is clean, and search reads only `task_activity`. What blocks is
(S1) the `ON DELETE RESTRICT` choice, which makes every workspace hard delete and every
sole-owner account deletion fail as soon as a single activity row exists, and (S2) a fail-open in
the CA-7 resolver, which returns `public` for any verb that carries a public field name.

| # | Severity | Summary |
| --- | --- | --- |
| S1 | **BLOCKING** | `ON DELETE RESTRICT` breaks workspace delete, account deletion and the future #198 purge |
| S2 | **BLOCKING** | `resolveVisibility` ignores `verb` when `field` is set: `{verb: "custom_field.updated", field: "priority"}` → `public` |
| S3 | NON-BLOCKING | Explicit `visibility` can force `public` onto any row, including `assignee` |
| S4 | NON-BLOCKING | `diffWorkItemFieldChanges` spreads `context`, so a stray `visibility` on it flows into every row |
| S5 | NON-BLOCKING | Migration 0066 hard-fails on Postgres 16/17; the Helm chart still defaults to `postgres:16-alpine` |
| S6 | NON-BLOCKING | `recordWorkItemActivity` returns `seq` via `.returning()`; public rows carry `payload` as-is |
| S7 | NON-BLOCKING / info | Lock profile of the migration; stray-object behaviour |

---

## S1 — `ON DELETE RESTRICT` makes workspaces and accounts undeletable (BLOCKING)

**Where:** `apps/api/drizzle/0066_work_item_activity_table.sql:82`,
`apps/api/src/database/schema.ts:2133-2143`.

**Premise that is false.** The schema comment says "work items are soft-deleted (`deleted_at`),
never hard-deleted, so this should never actually fire". Work items *are* hard-deleted, by
cascade, on every existing tenant-deletion path:

- `workspace/controllers/delete-workspace.ts:37` — `DELETE FROM workspace` → `project`
  (CASCADE) → `work_item` (CASCADE via `project_id` and via `(workspace_id, project_id)`).
- `user/controllers/delete-account-data.ts:75` — account deletion hard-deletes every workspace
  the user solely owns, by the same cascade.
- `project.purge_after` (`delete-project.ts`) exists so the #198 purge job can hard-delete a
  soft-deleted project after 30 days; that delete will cascade into `work_item` too.

No other code path deletes `work_item`, `project` or `workspace` rows (enumerated: every
`.delete(` and raw `DELETE FROM` in `apps/api/src`).

**Reproduction (live, private DB `pr275_opus_test`, head `9bdcfb4`)**, using the PR's own
fixture builders and the real `deleteWorkspace()`:

| Probe | Result |
| --- | --- |
| P1: workspace with one work item, no activity, `deleteWorkspace()` | `ok` |
| P7: workspace with parent + child work items, no activity | `ok` (so main is not already broken) |
| P2: same as P1 plus one `recordWorkItemActivity(..., verb: "created")` row | `update or delete on table "work_item" violates RESTRICT setting of foreign key constraint "activity_workspace_id_work_item_id_work_item_workspace_id_id_fk"`; the work item is still there |
| P3: raw `DELETE FROM project` with one activity row (the #198 purge shape) | same RESTRICT error |

The delete is a single statement, so it fails atomically; nothing is left half-deleted. But it
fails. Once PR #271 writes a `created` row for every new work item, **every workspace that has
ever had a work item can no longer be deleted**, and **every sole owner of such a workspace can
no longer delete their account** (a raw Postgres error through better-auth's delete hook). The
account-deletion path is a data-protection obligation, not a convenience.

**What would close it.** Decide it in this migration, while the table is empty. The simplest
option consistent with the existing design is `ON DELETE CASCADE` on this composite FK (keep
`ON UPDATE NO ACTION`). CA-10's "never edited or deleted" governs a work item's own lifecycle,
which is soft delete; it cannot mean a journal outlives the tenant it belongs to after that tenant
is hard-deleted. If RESTRICT is kept on purpose, every hard-delete path above must delete the
activity rows first, and that must be tested. Either way, add a regression test: workspace
delete with an activity row succeeds (or fails with a handled 409), and fix the schema comment.
The decision log's detail 1 fixes only `ON UPDATE NO ACTION`, so `ON DELETE` is this PR's own
choice, not a recorded decision.

---

## S2 — The CA-7 resolver is fail-open on unmapped verbs (BLOCKING)

**Where:** `apps/api/src/work-item/activity.ts:73-75`.

```ts
if (input.field) {
  return CA7_PUBLIC_FIELDS.has(input.field) ? "public" : "internal";
}
```

When `field` is set, `verb` is never consulted. The module's own comment (lines 47-50) says
public fields apply "when the verb is a plain field change (verb `updated`, …)", and CA-7 says
"an unmapped verb or field is `internal`". The code does not do either.

**Reproduction (live, `resolveVisibility` called directly):**

| Input | Result | Should be |
| --- | --- | --- |
| `{verb: "custom_field.updated", field: "priority"}` | `public` | `internal` (unmapped verb; a custom field whose key happens to be `priority`) |
| `{verb: "deleted", field: "description"}` | `public` | `internal` |
| `{verb: "watcher.added", field: "title"}` | `public` | `internal` |

The realistic path is custom fields. Their keys are configured per workspace, so a field keyed
`priority`, `title`, `description` or `due_date` is plausible. CA-7 makes `custom_field` internal
unless the field is `customer_visible`. Nothing is wired yet, so nothing is leaking today. But
this function is the single place CA-7 is enforced, #271 and #27 build on it, and the portal will
trust it.

**Checked and fail-closed (no finding):** `assignee` → internal; case and spacing variants
(`Priority`, `priority `) → internal; `__proto__`, `constructor`, `toString` as verb or field →
internal (`Set.has`, not an object lookup); an unknown verb with no field → internal; an empty
string `visibility` → falls through to derivation; `visibility: "PUBLIC"` or `null` via raw SQL →
rejected by the CHECK and NOT NULL.

**What would close it.** Only consult `CA7_PUBLIC_FIELDS` when `input.verb === "updated"`.
Anything else with a field is `internal`, unless the verb is in `CA7_PUBLIC_VERBS` and the field
is null. Add the three rows above as regression cases.

---

## S3 — A caller-supplied `visibility` can force `public` on any row (NON-BLOCKING)

**Where:** `activity.ts:70-72`. `{verb: "updated", field: "assignee", visibility: "public"}` →
`public` (probe P4). No HTTP caller can reach this today, since the writer is internal-only. It
should not be possible anyway: CA-7 says visibility is "decided by this table and nothing else".
The override exists for the two conditional rows only (`attachment.added`, `custom_field`).
**Recommend:** always accept `internal` as an override, and accept `public` only when the verb or
field is one of those conditional rows. Never pass a request-body value into it.

## S4 — `diffWorkItemFieldChanges` spreads `context` into each row (NON-BLOCKING)

**Where:** `activity.ts:203-209` (`...context`). TypeScript's excess-property check only applies
to object literals. A caller that passes a wider object (for example, one built by spreading a
loaded row or a request object) carries any `visibility` it has into every emitted row, and S3
then honours it. Probe P5: context with `visibility: "public"`, diffing `assigneeId` → the emitted
row has `visibility: "public"`, resolved `public`. **Recommend:** build rows from the four named
context fields explicitly.

## S5 — Migration 0066 is the first to hard-fail below Postgres 18 (NON-BLOCKING)

**Where:** `0066_work_item_activity_table.sql:51-55`. Postgres 18 is the only version that
catalogues column `NOT NULL` constraints by name. On 16 and 17, `RENAME CONSTRAINT
"activity_id_not_null"` raises `constraint … does not exist`.

**Reproduction:** throwaway `postgres:16-alpine` and `postgres:17-alpine` containers, with the
drizzle migrator run from empty. `origin/main`'s 66 migrations apply cleanly on 16. With this
PR, the run fails on both 16 and 17 with `constraint "activity_id_not_null" for table
"task_activity" does not exist`, and 0 migrations are recorded (the whole run rolls back).

`tech-stack.md` names Postgres 18 as the target, and `compose.yml` and CI use 18. But
`charts/taskdesk/values.yaml:32` still ships `postgres:16-alpine` by default, and managed
external Postgres is often 16 or 17. On those installs this PR takes the app from "migrates" to
"cannot migrate". **Recommend:** either wrap the five `*_not_null` renames in a `DO` block
guarded by `pg_constraint` existence, or record Postgres 18 as a hard minimum and bump the chart
in the same change.

## S6 — `seq` and `payload` exposure hygiene (NON-BLOCKING)

`recordWorkItemActivity` returns `.returning()` with every column, `seq` included, and
`workItem.activities` in the relational API also yields `seq`. The decision log's exception to
"never sequential" rests on `seq` never appearing in an API response. Return an explicit column
list, and have #27's serializer drop `seq`. Separately: visibility is decided per row, not per
field of `payload`, `old_value` or `new_value`. A `created` row is public, so #271 must not put a
full snapshot (assignee, requester) into a `created` row's payload, and #27's portal projection
should allow-list columns.

## S7 — Migration locks and stray objects (info)

Measured on PG 18 inside a transaction: `ALTER TABLE … RENAME` takes `AccessExclusiveLock` on
the legacy table. `ADD CONSTRAINT … UNIQUE` takes `AccessExclusiveLock` plus `ShareLock` on
`work_item` while it builds the index. `ALTER INDEX … RENAME` takes `ShareUpdateExclusiveLock`.
The drizzle migrator runs every pending migration in one transaction, so these locks are held
until commit. The renames are metadata-only, and `work_item` is new and small, so the lock window
is short. It is not zero-downtime, which is acceptable at this stage.

During a rolling deploy, an old pod's legacy `INSERT INTO activity (task_id, type, …)` fails
loudly: the new table has none of those columns and requires `workspace_id`, `work_item_id`,
`actor_type` and `verb`. It does not silently cross-write.

Stray objects: an existing relation named `activity_seq_seq`, `activity_seq_unique`,
`activity_work_item_id_created_at_idx` or `activity_workspaceId_idx` makes the migration fail
and roll back cleanly. Only an unrelated relation already named `activity_pkey` would be silently
suffixed to `activity_pkey1`; the PR's catalog test catches that in CI but not on a customer
database. This is low risk.

`seq` under concurrency: 4 concurrent transactions × 250 rows sharing one `created_at` gave 1000
distinct `seq` values, all unique. Order is deterministic but not commit order, as the decision
log accepts.

---

## 1. Tenant integrity — clear

- `workspace_id` is taken from the caller, but the composite FK pins it. Raw SQL inserting
  workspace B's id against workspace A's work item is rejected by
  `activity_workspace_id_work_item_id_work_item_workspace_id_id_fk` (probe P6). A caller cannot
  misattribute a row. Reach (authorising the work item itself) remains the caller's job; the
  writer does no reach check, by design.
- `ON UPDATE NO ACTION` verified in the catalog (`confdeltype = r`, update = no action).
- The FKs into `work_item` are listed in the catalog, and only `activity` and the pre-existing
  self-referencing `parent_id` are RESTRICT.

## 2. Legacy rename blast radius — clear

- `activityTable` is used only by `work-item/activity.ts`, relations and the barrel export. Every
  legacy reader and writer (create/update/delete comment, get-activities, get-comments,
  global-search, cleanup-assets, workspace-access-middleware lookup, update-task-title) uses
  `taskActivityTable`. `db.query.taskActivityTable` is renamed.
- `tsc --noEmit` passes for `tsconfig.json` and `tsconfig.tests.json`. The new table shares no
  legacy column except `id`/`created_at`, so a missed legacy use would not have compiled.
- Catalog sweep on the migrated DB: no view, function, trigger or policy references `activity`.
  The only triggers (`work_item_claim_key`, `work_item_reject_parent_cycle`) do not touch it.
  After the rename, no constraint or index on `task_activity` is named `activity_`
  (`asset_activityId_idx` is a pre-existing asset index name, cosmetic).
- `global-search.ts` searches `task_activity` only. The new internal-by-default `activity` table
  is not reachable through search. `packages/mcp` calls HTTP routes only and has no SQL.

## Verification run

- PR suites on `pr275_opus_test`: `work-item-activity-table`, `account-deletion`, `comment`,
  `task-title-activity` — 4 files, 36 tests passed.
- Throwaway probe file `tests/api-integration/zz-opus-probe.test.ts` (P1–P7), uncommitted and deleted.
- Raw-SQL probes via `docker exec td-lane-pg psql`; lock probe inside a rolled-back transaction.
- Postgres 16 and 17 migrator runs in throwaway containers, removed afterwards.

## What I did not do

- I did not call `deleteAccountData()` end to end. S1's account-deletion impact follows from it
  issuing the same `DELETE FROM workspace` statement that P2 proves fails.
- I did not review `meta/0066_snapshot.json` line by line (the OpenAPI/drizzle drift checks were
  still pending in CI when I checked).
- No push, comment or merge.

---

# Delta-confirmation round (635fd29)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.

**Reviewed head:** `635fd29afda1621b02d81501fc76240204b3fea3`

**Reviewed SHA:** `635fd29afda1621b02d81501fc76240204b3fea3` (confirmed via `gh pr view 275 --json headRefOid`; `origin/main` is an ancestor).
**Delta reviewed:** `git diff 9bdcfb4 635fd29` — `7ff59e1` (this note, byte-identical to my copy),
`2c43724` (decision-log addendum), `635fd29` (fix round).
**Date:** 2026-09-23

## Verdict

**CHANGES NEEDED — one new BLOCKING finding (D1), a regression introduced by the S2 fix.**
S1, S3, S4, S5 and S6 are closed. S2's reported inputs are closed, but the rewrite opened
the mirror-image fail-open: a public *verb* now makes a row public whatever its `field` is,
including an internal field. At `9bdcfb4` I recorded `{verb: "created", field: "assignee"}` as
`internal`; at `635fd29` it is `public`.

| # | Round-1 finding | Verdict at 635fd29 |
| --- | --- | --- |
| S1 | RESTRICT breaks tenant deletion | **Closed** |
| S2 | field-first fail-open | **Closed for the reported inputs; regression D1 below** |
| S3 | caller can force `public` | **Closed** (D2 and D3 are narrow notes) |
| S4 | `...context` spread | **Closed** |
| S5 | PG16/17 migration failure | **Closed** |
| S6 | `seq` in `.returning()` | **Closed** |
| D1 | **new, BLOCKING** | public verb + internal field → `public` |
| D2 | new, NON-BLOCKING | `visibility: "public"` on an already-public row throws |
| D3 | new, NON-BLOCKING | the conditional-override allow-check is wider than CA-7's two rows |

## D1 — Public verb plus internal field resolves `public` (BLOCKING, regression)

**Where:** `apps/api/src/work-item/activity.ts`, the last line of `resolveVisibility`:
`return CA7_PUBLIC_VERBS.has(input.verb) ? "public" : "internal";`. For any verb other than
`updated`, `field` is now ignored.

**Reproduction (live, head `635fd29`, `resolveVisibility` called directly):**

| Input | 9bdcfb4 | 635fd29 | CA-7 |
| --- | --- | --- | --- |
| `{verb: "created", field: "assignee"}` | internal | **public** | internal (`assignee`) |
| `{verb: "escalated", field: "assignee"}` | internal | **public** | internal |
| `{verb: "resolved", field: "custom_field"}` | internal | **public** | internal unless `customer_visible` |
| `{verb: "transitioned", field: "watcher"}` | internal | **public** | internal |

An escalation that also reassigns, or a resolve that records a resolution custom field, are
realistic shapes for #271, #27 and SLA work to write. CA-7's "customers never see staff names
as assignees" is exactly what this row shape would break. The new test suite asserts the S2
inputs but no public-verb-plus-internal-field case, which is why 672/672 stays green.

**What would close it:** treat `CA7_PUBLIC_VERBS` as public only when `field` is null or
absent, and make every other `(verb, field)` combination outside `updated` internal. Add the
four rows above as regression cases.

## D2 — Asserting `public` on a row CA-7 already makes public throws (NON-BLOCKING)

`{verb: "updated", field: "priority", visibility: "public"}` and `{verb: "created", visibility: "public"}`
both throw. This is fail-loud, not a leak. The throw happens before the insert and inside the
caller's transaction, so the caller's mutation rolls back and the request returns 500. That
only happens if a caller passes a value CA-7 agrees with. Nothing calls this today. No
existing caller has a 500 path, since the writer is not wired into any route. **Recommend:**
honour `public` when the derived visibility is already `public`, and throw only when the
override would *raise* visibility. Also never pass a request-body value into `visibility`.

## D3 — The allow-check is wider than CA-7's two conditional rows (NON-BLOCKING)

`isConditionalPublicOverrideAllowed` is `verb === "attachment.added" || field === "custom_field"`.
So `{verb: "attachment.added", field: "assignee", visibility: "public"}` → `public`, and
`{verb: "deleted", field: "custom_field", visibility: "public"}` → `public`. **Recommend:**
`(verb === "attachment.added" && !field) || (verb === "updated" && field === "custom_field")`.

## S1 — closed

- Migration line 126 and `schema.ts` now use `ON DELETE cascade ON UPDATE no action`. The
  PG18 catalog shows `confdeltype = c`, `confupdtype = a`, and the snapshot matches.
- **Is every work-item hard delete a genuine tenant deletion?** I re-enumerated every
  `.delete(` and raw `DELETE FROM`/`TRUNCATE` in `apps/api/src` at this head. The only
  deletes reaching `work_item` are `delete-workspace.ts:37` and `delete-account-data.ts:75`.
  Both delete a whole workspace, cascading through project to work_item to activity. Nothing
  deletes `work_item` or `project` directly. `delete-project.ts` is an `UPDATE` setting
  `deleted_at`/`purge_after`, so soft delete never hard-deletes and never touches activity.
  `organisation` → `workspace` is `RESTRICT`, so no organisation delete cascades. The only
  future path is #198's purge, which is a genuine hard deletion of an expired project, and
  the addendum names it.
- The new tests go through the real `deleteWorkspace()` and `deleteAccountData()`, and prove
  another workspace's activity survives. They pass here.
- Note, not a finding: neither tenant-delete path checks `legal_hold` today. The addendum
  says legal hold "is the mechanism that stops a deletion". That is true of the design, not
  yet of the code. It is pre-existing and applies to work items themselves, not only to
  activity, so it belongs to #198.

## S5 — closed

The `DO $$ … $$` block is a single statement between breakpoints. Drizzle sends it as one
query, and it runs inside the migrator's single transaction (a `DO` block cannot commit), so
it is still all-or-nothing. `'"task_activity"'::regclass` resolves correctly, since the table
was renamed earlier in the same migration. Every `conname` literal matches the PG18 names, and
every `ALTER` identifier is double-quoted. On PG18 (`pr275_opus_test`), 0 `activity%`-named
constraints remain on `task_activity`. I re-ran it myself on a throwaway `postgres:16-alpine`:
the migrator applies all 67 migrations, with no error. A later pg_upgrade from 16 to 18 would
generate names from the table's current name (`task_activity_*_not_null`), so there is no
collision.

## S3, S4, S6 — closed

- S3: `{verb: "updated", field: "assignee", visibility: "public"}` throws. An unknown value
  such as `"PUBLIC"` falls through to derivation (internal), and the CHECK remains the backstop.
- S4: both `rows.push` sites build the four named fields. The test with a wider context has
  no `visibility` on the emitted row.
- S6: `.returning({...})` lists explicit columns without `seq`, and the runtime test asserts
  its absence. The relational `workItem.activities` helper still yields `seq`, so #27's
  serializer must drop it. The caller obligation on payload snapshots is documented.

## Decision-log addendum (2c43724) — consistent

It is append-only, newest-first, names what it extends, and matches the code. It keeps
"Postgres 18 as hard minimum" as a separate decision, as it should. The `data-model.md` row is
updated in the same change.

## Verification run (this round)

- On `pr275_opus_test` (td-lane-pg, PG18): `work-item-activity-table`, `account-deletion`,
  `comment` and `task-title-activity` plus a throwaway resolver probe — 5 files, 51 tests passed.
- A throwaway PG16 container ran the migrator from empty (67 applied), then was removed.
- Probe files were deleted, and the DB was dropped.

## What I did not do (this round)

- I did not re-run the full 672-test suite; I ran the affected suites only.
- I did not re-run PG17. The block is version-agnostic, and PG16 covers the same branch.
- No push, comment or merge.

---

# Closing round (2cf9852)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.

**Reviewed head:** `2cf9852fadd841a4255fca694863eb7ccd6e075b`

**Reviewed SHA:** `2cf9852fadd841a4255fca694863eb7ccd6e075b` (confirmed via `gh pr view 275 --json headRefOid`; `origin/main` is an ancestor).
**Delta reviewed:** `git diff 635fd29 852ba53` (the redesign) plus the two merge
resolutions, `45ef0e1` (#274; conflict in `decision-log.md` only) and `2cf9852` (#279,
`status.md` only). `24d18ac` is this note, byte-identical to my copy.
**Date:** 2026-09-23

## Verdict

**CLEAR.** D1 is closed by a change of shape, not by one more branch. Visibility is now
decided by membership of a single `(verb, field)` key in two module-private allowlists, and
there is no `if` over `verb` or `field` left to fail open. I found no new class of problem.
S1, S5 and S6 are intact after both merges.

| # | Verdict at 2cf9852 |
| --- | --- |
| S1 | **Closed, intact.** Migration, `schema.ts` and the delete paths are untouched since `635fd29`. The PG18 catalog shows `confdeltype = c`, `confupdtype = a`. |
| S2 | **Closed** (subsumed by the allowlist) |
| S3 | **Closed.** `public` is honoured only for pairs in `PUBLIC_PAIRS ∪ CONDITIONAL_PUBLIC_PAIRS`; everything else throws. |
| S4 | **Closed, intact** |
| S5 | **Closed, intact.** The migration is byte-identical to `635fd29`, which I verified on PG16 last round. 0 `activity%`-named constraints remain on `task_activity` (PG18). |
| S6 | **Closed, intact.** `.returning()` still lists explicit columns without `seq`. A new comment on `relations.ts`'s `activities` puts the `seq`-drop obligation on #27. |
| D1 | **Closed** |
| D2 | **Closed.** A no-op `public` on an already-public pair returns `public`. |
| D3 | **Closed.** The conditional pairs are exactly `(attachment.added, —)` and `(updated, custom_field)`. |

## What I attacked

**Key collisions.** `pairKey` is `${verb}\u0000${field ?? ""}`, and every allowlisted key
contains exactly one `\u0000`. An input with `\u0000` anywhere in `verb` or `field` produces
at least two, so it cannot equal any allowlisted key. It resolves `internal`, or throws on a
`public` override. Postgres `text` also rejects NUL at insert. I probed `created\u0000`,
`updated\u0000priority`, `priority\u0000` and `\u0000priority` with every verb in the matrix,
and none escalated.

`field: ""` is the same key as `null` and `undefined`. So `{created, field: ""}` is `public`,
and `{attachment.added, field: ""}` accepts the conditional override. This is not an
escalation: an empty string names no internal field, and CA-7's public row is the bare verb.
Info only. If you want it strict, normalise `""` to `null` in `recordWorkItemActivity`.

**Prototype keys.** `__proto__`, `constructor`, `hasOwnProperty` and the empty verb all
resolve `internal`. The allowlists are `Set`s, and neither is exported, so no caller can
mutate them. `ReadonlySet` is type-level only, but the module scope is the real guard.

**Override escalation.** I ran an independent 1,470-case probe: 14 verbs × 15 fields
(including `undefined`/`null`/`""`/NUL/prototype names), each with no override, `public`,
`internal`, and the junk values `"PUBLIC"`, `true`, `1` and `"public "`. The results:

- Derived visibility matched my own transcription of CA-7 in every case.
- `public` succeeded only on the nine public pairs and the two conditional pairs; every
  other case threw.
- `internal` always returned `internal`.
- Junk values fell through to derivation.

There were 0 mismatches.

**The test's expected set against CA-7.** `expectedUnconditionalVisibility` has the five bare
verbs and `updated` × {priority, due_date, title, description}. That is CA-7's public row read
through CA-6's rule that a field edit is `updated` plus the field name, with `attachment.added`
correctly moved to the conditional set. Every internal item CA-7 names (`assignee`, `watcher`,
`label`, `custom_field`, `estimate`, `cycle`, `module`, `relation`, `parent`, `time_entry`,
`sla_pause`) appears in the field list, together with unknown and case/space variants. It
imports only `resolveVisibility`, not the sets, so it is a genuine independent oracle.

**Interaction with the `main` merges.** The merges touch no file under `apps/api/src` or
`apps/api/drizzle`. Nothing outside `work-item/activity.ts` imports `recordWorkItemActivity`,
`diffWorkItemFieldChanges` or `resolveVisibility`. `work-item/controllers/*.ts`, including
#271's `update-work-item.ts`, has no reference to `activity`, so the writer is still unwired
and no route has a new 500 path. `main` still ends at migration 0065, so there is no number
clash. The `decision-log.md` resolution deletes no line of `main`'s. It only adds the addendum,
placed newest-first above the entry it extends.

## Verification run (this round)

- On `pr275_opus_test` (td-lane-pg, PG18): `work-item-activity-table`, `account-deletion`,
  `comment`, `task-title-activity` and `work-item-update`, plus the throwaway 1,470-case probe —
  6 files, 344 tests passed. The probe file was deleted, and the DB was dropped.

## What I did not do (this round)

- I did not re-run PG16 or PG17, because the migration is unchanged since the round I did.
- I did not run the full suite.
- No push, comment or merge.
