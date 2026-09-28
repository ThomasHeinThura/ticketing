# Security review — #347 create-work-item `typeId` cross-tenant existence oracle

**Reviewer:** Opus 5.5, fresh independent context commissioned by the orchestrating session. Did not author, direct, or remediate this change.
**Reviewed head:** `c9d832eefab58361cc68b684625f4bb396c606d5`
**Reviewed SHA:** `c9d832eefab58361cc68b684625f4bb396c606d5` (confirmed with `git rev-parse HEAD` in the branch worktree, clean tree). Two commits on base `732cea274ed8ffca6e2056913fbed4bccafd561e` (`origin/main`, #457): `0004b6d` (fix + test) and `c9d832e` (docs only).
**Branch:** `fix/347-typeid-cross-tenant-message`
**Pull request:** not yet opened at review time
**Date:** 2026-09-28

## Verdict

**CLEAR.** No blocking findings. The fix closes the oracle it targets, the test proves it, and nothing else in the diff changes authority or behaviour.

| # | Severity | Summary |
| --- | --- | --- |
| I1 | INFORMATIONAL | Possible residual timing difference: if the planner uses the `id` PK index, a foreign-workspace id fetches a heap tuple before the `workspace_id` predicate rejects it, while a nonexistent id stops at the index (if it uses the `(workspace_id, id)` unique index, both stop at the index). At most microseconds; same query, zero rows either way. Not worth closing. |
| I2 | INFORMATIONAL | `set-work-item-parent.ts:145` answers 404 for an unknown parent key vs 400 "RH-6" for a same-workspace, different-project parent. The parent lookup is already scoped to the caller's workspace, so this only distinguishes rows the caller can already reach at workspace scope. Not the #347 class; noted only for completeness. |

## Surfaces examined

- `apps/api/src/work-item/controllers/create-work-item.ts` — whole file at the reviewed head, and `origin/main`'s version.
- `apps/api/src/work-item/schema.ts` `createWorkItemBody` — `typeId` validation (`min(1)`, NUL refine) is input-shape only, independent of existence, so it cannot itself distinguish the two cases.
- `apps/api/src/work-item/index.ts` — `createWorkItemRoute` registration (`workspaceAccess.fromProject("projectId")`) and handler.
- `apps/api/src/database/schema.ts:2435-2447` and `apps/api/drizzle/0062_fast_blob.sql:47,49` — the #192 composite FK `work_item(workspace_id, type_id) -> work_item_type(workspace_id, id)` and its `work_item_type_workspace_id_id_unique` target both exist, so the DB backstop is real.
- `tests/api-integration/work-item-create-read-list.test.ts` — the new #347 test and the two adjacent WI-1 tests.
- `docs/07-planning/security-reviews/340-create-work-item-dialog.md` — the one-paragraph S2 closure note (commit `c9d832e`).
- Sweep for the same two-message class: every `workItemTypeTable` reader under `apps/api/src`; every `.<parentId> !== ` comparison under `apps/api/src`; every "does not belong / must belong" rejection message. Read in context: `upsert-workflow-rule.ts`, `reorder-columns.ts`, `create-label.ts`, `assign-label-to-task.ts`, `set-work-item-parent.ts`, `workflow-transition-context.ts`, `workspace-access-middleware.ts:270-305`.

## What I probed

1. **The fix itself.** The type lookup is now one `findFirst` with `id = typeId AND workspace_id = project.workspaceId`, and `!type` is the only rejection branch, with one message. `project.workspaceId` comes from a project row already scoped by `id`, `workspaceId` (the middleware-resolved one) and `deletedAt IS NULL`. Nothing after the lookup reads `type.workspaceId`; the only use of `type` downstream is `typeId: type.id` in the INSERT. The later branches (no default state, key-claim 409) depend only on the project, not on the type, so they cannot re-open a distinguishable answer.
2. **Other `work_item_type` readers.** `list-work-item-types.ts` is scoped by `workspaceId`. `workflow-transition-context.ts:121` looks up by `item.typeId` from a stored `work_item` row (FK-pinned to the same workspace), not by caller input. `validate-workflow-version.ts`, `seed-workspace-defaults.ts`, `backfill-workspace-project-defaults.ts` take no caller-supplied type id. No update path accepts `typeId` (`schema.ts` has it only on create). No other site reopens the oracle.
3. **Same class elsewhere.** `upsert-workflow-rule.ts` and `reorder-columns.ts` already use one scoped query and one message. `create-label.ts` throws the same 404 "Task not found" for both branches. `assign-label-to-task.ts` scopes `taskId` to the label's workspace in SQL (#307 S2); its remaining 400 "same workspace" branch can only fire if the label's workspace changes mid-request, and the label id itself is already reach-checked by `workspaceAccess.fromLabel()`. The bulk-task middleware drops unreachable rows before counting workspaces. No other cross-tenant two-message existence check found.
4. **Test proves the claim.** Ran the full file on a private DB (`opus347_test`): 29/29 pass. Then independently reverted only `create-work-item.ts` to `origin/main` and re-ran: the #347 test fails with `Expected: "Work item type does not belong to the project's workspace" / Received: "Unknown work item type"`, 28 others still pass. Restored; tree clean at the reviewed head. The test compares full response bodies (`.text()`) and statuses for both cases, and asserts zero `work_item` rows for the project after both requests. Headers are not compared, but Hono's `HTTPException` response for the same status and message is the same content-type and length.
5. **Adjacent tests unaffected.** "WI-1: rejects a cross-workspace project/type pairing" asserts `status 400` and that the body does not match `/constraint|violat/i`, plus zero rows; "WI-1: rejects an unknown typeId" asserts `status 400` only. Neither pins the message text, so both still pass (confirmed in the run above), and no coverage is lost.
6. **Stale references.** The only remaining occurrences of the old string "Unknown work item type" are the historical S2 paragraph in the #340 note and the explanatory comment in the new test. No client or other test depends on it.
7. **Typecheck.** `tsc --noEmit -p apps/api/tsconfig.json` exits 0 at the reviewed head.

## What I did not check

- The full integration suite (ran only `work-item-create-read-list.test.ts`), the web package, and CI status on GitHub — the PR was not open yet.
- `docker build` / container boot — the change touches only one controller's query and its message, nothing in the image layout.
- Measured timing of I1; the assessment is from the query shape, not a benchmark.
- Oracle classes outside `apps/api/src` controllers/middleware (e.g. realtime/WebSocket handlers), beyond the grep sweep above.

## Mechanical reconfirmation after merging `main` past PR #452/#421/#400 (commit `eb19b2f`)

**Reviewed head:** `eb19b2f86a70218c55cf63f795fa6a75dd74e2de`

`main` had moved twenty-one commits ahead since this branch's own base: PR #452 (comment
read-side route), PR #421 (CI tokenizer rewrite), and PR #400 (shadow-mode permissions),
touching `apps/api/src/work-item/index.ts`/`policy.ts`/`response.ts`,
`apps/api/src/permissions/**`, `scripts/ci/**`, and generated fixtures
(`tests/api-contract/openapi.json`, `scripts/ci/redocly-approved-findings.json`) — none of
it in `apps/api/src/work-item/controllers/create-work-item.ts`, the one file this PR
changes. `git merge` resolved with no conflicts.

Full solo suites re-run fresh after the merge (isolated database `pr462_merge_test`):
unit 63 files/518 tests, permissions 13 files/83 tests, and this PR's own integration
test (`work-item-create-read-list.test.ts`) 29/29 — all green. `tsc --noEmit` clean. Per
the same precedent used throughout this session for a trivial, disjoint main-merge,
this is a mechanical reconfirmation, not a fresh Opus round: the round above (CLEAR)
still applies at `eb19b2f`.

**Status: CLEAR, merge-ready.**
