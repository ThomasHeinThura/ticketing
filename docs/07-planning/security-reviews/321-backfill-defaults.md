# Security review — boot-time backfill of default work-item types, state templates and project states (#316)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `c33be43263d446cf118825148617b9beb4cacc5b`
**Reviewed SHA:** `c33be43263d446cf118825148617b9beb4cacc5b` (confirmed via `gh pr view 321 --json headRefOid` before starting)
**Pull request:** #321 (closes #316)
**Date:** 2026-09-23


## Surfaces examined

- `apps/api/src/utils/backfill-workspace-project-defaults.ts` (new, whole file)
- `apps/api/src/utils/seed-workspace-defaults.ts` (split into `seedDefaultWorkItemTypes` / `seedDefaultStateTemplates`; `seedWorkspaceDefaults` now calls both with the same `dbOrTx`)
- `apps/api/src/utils/seed-project-states.ts` (unchanged; its template lookup is scoped by the `workspaceId` argument at `:55`)
- `apps/api/src/index.ts` `runStartupTasks()` (the new call at `:1022`, after `seedInternalOrganisationAndStaffPersons`)
- `apps/api/src/project/controllers/create-project.ts:61-67` and `reorder-projects.ts:19-25`, the only other takers of advisory key `1524`
- `apps/api/src/workspace/controllers/create-workspace.ts` (`seedWorkspaceDefaults(workspace.id, tx)` at `:195`, unchanged behaviour) and `delete-workspace.ts` (hard delete, no advisory lock, cascades)
- `apps/api/src/database/schema.ts`: `workItemTypeTable`, `stateTemplateTable`, `stateTable` (FKs, `unique(workspace_id, key)`, `state_project_default_unique`, `state_template_id` `ON DELETE RESTRICT`), `projectTable.deletedAt`
- Every non-test writer of `work_item_type`, `state_template` and `state` under `apps/api/src` (there are none besides the seed helpers; `create-work-item.ts` only reads)
- PR #308 (`origin/fix/296-db-role-split` at `b2a72f8`): `apps/api/src/index.ts` `runMigrationStep` / `runApiBootTasks`, `database/index.ts` (default `db` proxy), `database/ensure-application-role.ts` and `append-only-tables.ts`
- `tests/api-integration/backfill-workspace-project-defaults.test.ts`
- `docs/07-planning/security-reviews/313-seed-defaults.md` (S1, S2)

## What I probed

Private DB `pr321_opus_test` on td-lane-pg, dropped afterwards. Probe test files were scratch and are not committed.

1. **Suites at this head.**
   - Integration: **79 files, 1082 tests, all passed.**
   - API unit: **54 files, 412 tests, all passed.**
   - `test:permissions`: **10 files, 80 tests, all passed.**
   - `node --test 'scripts/ci/**/*.test.mjs'`: **495 tests, 88 suites, 0 fail.**
2. **Tenancy.**
   - Every write is keyed by an id read from the row being backfilled, never by caller input. Workspace inserts use `workspace.id` from the candidate query (`backfill-workspace-project-defaults.ts:211,215`). Project states use `project.id` and `project.workspaceId` from the same `project` row (`:265-268`, `:298`).
   - `seedProjectStates` scopes its template lookup by that `workspaceId` and `archived_at IS NULL` (`seed-project-states.ts:53-58`). #313 S1 (no composite FK on `state.state_template_id`) therefore stays unexploitable on this path.
   - Live probe: two legacy workspaces A and B, each with its own active templates, each with a legacy project. A third workspace C had only archived templates, a custom type and a legacy project. After the backfill, A's and B's projects had 5 states each and exactly 1 default each, and **every** `state → state_template.workspace_id` equalled the project's own `workspace_id`. C's project got **0** states and did not borrow A's or B's templates (`skippedNoActiveTemplate = 1`). C's archived templates still count as "has templates", so none were re-added, and its one custom type was left alone.
   - Soft-deleted projects are excluded (`:271`). Workspaces have no soft delete. `delete-workspace.ts` is a hard delete with cascades.
   - Concurrent workspace delete, probed live: I deleted legacy workspace D inside a transaction held open with `pg_sleep(0.4)` while two backfills ran. D's backfill failed on the FK, was caught, rolled back and logged. The delete committed, and **0** rows were left for D. A row can't land in a vanished workspace, because the FK `KEY SHARE` check either waits for the delete and then fails, or commits first and is cascaded away.
3. **Customised data.**
   - The guard is per kind and per scope. Types are seeded only if the workspace has zero `work_item_type` rows, and templates only if it has zero `state_template` rows (archived rows included). Both checks and both inserts run in one transaction per workspace (`:195-220`). States are seeded only if the project has zero `state` rows, archived included (`seed-project-states.ts:41-48`), and that runs under the advisory lock.
   - `onConflictDoNothing` can't place a default row beside a customer row. It only fires when the zero-rows check has already passed, and a same-key customer row would make that check fail. The conflict target is `(workspace_id, key)`, so it can't collide across workspaces either.
   - Check-then-insert window (READ COMMITTED): a concurrent customer insert of that kind could slip between the check and the insert. No route writes `work_item_type`, `state_template` or `state` today (I grepped every non-test writer under `apps/api/src`; only the seed helpers write them), so this is not reachable.
   - Deliberately deleting every default: probed live. I deleted all 9 types from a backfilled workspace, and the next boot re-added all 9. See S1.
4. **Locks and transactions.**
   - The lock expression is textually identical to `create-project.ts:67` and `reorder-projects.ts:24`: `pg_advisory_xact_lock(1524, hashtext(<workspaceId as text param>))`. It is taken first in its own transaction (`:295-297`), in the same order as both other takers. The workspace transaction takes no advisory lock at all.
   - No lock cycle exists. The only other `1524` takers acquire it first and then row locks. `create-workspace.ts` touches only its new workspace, never a legacy one. `delete-workspace.ts` takes no advisory lock and only waits on FK `KEY SHARE`.
   - Live probe: 2 concurrent backfills, 10 concurrent real `POST /api/project` in the same legacy workspace (15 legacy projects), and the workspace delete above all ran in parallel. Everything finished in 519 ms with no deadlock, and all 10 creates returned 200. All 25 projects ended with exactly 5 states, exactly 1 default, and templates from their own workspace only.
   - Lock hold time is bounded per project: one lock, three statements (existence check, template read, one multi-row insert), then commit. It is never held across items.
5. **Boot.**
   - There is no chunking, but the work is bounded. Two id-only candidate queries each load `O(workspaces)` or `O(projects)` ids. Each item runs a short transaction serially. A large legacy DB costs one boot of `O(N)` round trips, once. After that, steady state is two anti-join queries plus a count, served by `work_item_type_workspaceId_idx`, `state_template_workspaceId_idx` and `state_projectId_idx`.
   - No user-writable value (workspace name, slug, project name) is read or logged, and every SQL value is a bound parameter. Log lines carry only server-generated ids, integer counts, and `error.name` or `typeof` (`:157-160`), never `error.message`. I confirmed this in the probe-4 capture: the line was `failed to seed defaults for workspace <id>: Error`.
   - Only the candidate queries sit outside `try`. A DB outage there fails boot, which is correct.
6. **PR #308 (`fix/296-db-role-split` at `b2a72f8`, not merged).**
   - The backfill needs only `SELECT`/`INSERT` on `workspace`, `project`, `work_item_type`, `state_template` and `state`, plus `pg_advisory_xact_lock`, which needs no grant. Under #308 the app role gets `SELECT, INSERT, UPDATE, DELETE` on every table outside `APPEND_ONLY_TABLES` (`activity`, `audit_log`), and none of these five are in that list. It uses the default `db` export, which on #308 is the app-connection proxy. Nothing here needs owner rights.
   - A trial merge of `c33be43` with `origin/fix/296-db-role-split` is textually clean. Git places the call in **`runApiBootTasks()`**, right after `seedInternalOrganisationAndStaffPersons()` and before `ensureSetupToken()`. **That is the correct placement.** It must not go in `runMigrationStep()`, which runs on the owner connection in a one-shot process whose environment may not carry the app URL the default `db` resolves. Whoever merges second should confirm the call sits in `runApiBootTasks()` and fix the "Runs once per boot, from `runStartupTasks()`" wording in the doc comment (`:39`).

## Findings

**S1 — NON-BLOCKING, handoff to #314 (the P4 seam).** The per-kind "zero rows" guard reads a workspace with zero types, or zero templates, or a project with zero states, as "legacy". It re-seeds that on **every** boot (probe 3: all 9 deleted types came back). Today no product path can reach zero: no route deletes any of the three kinds, and #314's acceptance says "archive, never delete" for templates and types, "never delete, if referenced" for states, and "exactly one default" per project. Archived rows still count as rows, so they don't trigger a re-seed (probe 2). The guard is therefore consistent with #316's "never touch a customised workspace" rule and with rule 5 as the seam is currently specified. The residual risk is latent. If #314, or a later change, allows hard-deleting a kind down to zero, a boot would silently undo an admin's configuration, contradicting rule 5. #314 must keep the "never reach zero rows" invariant, or retire this backfill or make it one-shot (for example, an `instance_setting` marker) in the same change. `apps/api/src/utils/backfill-workspace-project-defaults.ts:163-187`, `:236-274`.

**S2 — NON-BLOCKING, observability.** `error.name` is `"Error"` for the Drizzle-wrapped query error (probe-4 capture), so the failure line tells an operator nothing about the cause. The SQLSTATE (`error.cause.code`, for example `23503`) is a fixed code with no row data and would be safe to add. `backfill-workspace-project-defaults.ts:157`.

**S3 — NON-BLOCKING, informational.** Under concurrent replicas, `typesSeeded` and `templatesSeeded` count attempts, including inserts that `onConflictDoNothing` turned into no-ops. In probe 4, both concurrent runs reported `typesSeeded: 1` for the same workspace. This affects the summary line only, not the data. `:225-226`.

**S4 — NON-BLOCKING, carried over from #313 S2, now satisfied on this path.** `seedProjectStates` still has no DB constraint behind its check-then-insert. The backfill takes the identical `1524` lock, so it is safe. The `unique(project_id, state_template_id)` defence in depth is still worth adding when `schema.ts` is next open (after #308).

## Verdict

**CLEAR WITH FINDINGS at `c33be43263d446cf118825148617b9beb4cacc5b`.** There are no blocking findings.
- **Tenancy.** The backfill writes only into the workspace or project it read, and links states only to templates in the project's own workspace.
- **Customised data.** It never adds a kind alongside rows of that kind that already exist.
- **Locks.** It serializes project seeding under the same lock as live creates, with no lock cycle.
- **Logging.** It logs no user data.
- **App role.** It needs only app-role privileges, so after #308 it belongs in `runApiBootTasks()`.
