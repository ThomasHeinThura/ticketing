# Security review — #290 uniform 404 for out-of-reach rows, #285 S1–S4, #288 NUL helper (PR #307)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `0ca150d7e55ba0252be85e09f60d26d913cf51ed`
**Reviewed SHA:** `0ca150d7e55ba0252be85e09f60d26d913cf51ed` (confirmed via `gh pr view 307 --json headRefOid`)
**PR code:** last changed at `91718f8`. `0ca150d` is a merge of `main` (`6061a9d`). `git merge-tree --write-tree 91718f8 6061a9d` reproduces its tree exactly (`7017433b…`), so the merge carries no hand-edits.
**Branch:** `fix/290-uniform-404`
**Pull request:** #307
**Date:** 2026-09-23

## Surfaces examined

- `apps/api/src/utils/workspace-access-middleware.ts` (whole file)
- `apps/api/src/utils/validate-workspace-access.ts`, `utils/reject-nul-byte.ts`, `utils/require-workspace-permission.ts`, `utils/is-instance-admin.ts`
- `apps/api/src/task/controllers/bulk-update-tasks.ts` (and `origin/main`'s version), `task/controllers/require-task-permission.ts`, and the `bulkUpdateTasksRoute` registration and handler in `task/index.ts`
- `apps/api/src/task-relation/index.ts` (`scopeToSourceTask`, `scopeToRelation`) and `task-relation/controllers/create-task-relation.ts`
- The NUL guards in `label/controllers/{create-label,assign-label-to-task}.ts`, `workflow-rule/controllers/upsert-workflow-rule.ts` and `task/controllers/{move-task,update-task-assignee}.ts`
- The route-declaration diffs in the 11 touched `*/index.ts` files. I filtered them for any change outside `responses`. The only one is `workspaceId: c.get("workspaceId")` at `task/index.ts:556`.
- Every `validateWorkspaceAccess(` caller under `apps/api/src`, every file that throws `HTTPException(403`, and `utils/require-invitation-workspace-access.ts`
- `docs/01-architecture/api-design.md:233` (the 404 row), `docs/03-features/work-items.md` WI-25, and the decision-log entry of 2026-09-08, "The instance-admin bypass is not blessed on S4 mutation routes"

---

## Verdict

**CHANGES NEEDED. One finding is BLOCKING (S1). It is small, and either of two changes clears it.**

The #290 fix is correct and structural.

- **Single-row lookups.** For all 8 `lookup` helpers and for `fromProject`, an other-tenant id now gets the same status, body and headers as a nonexistent id. I checked this live and by mutation.
- **The bulk mixed-id oracle.** It is closed. `[own, foreign]` and `[own, nonexistent]` return byte-identical 200s, and the foreign row is untouched.
- **task-relation.** Both bespoke scopes are closed.
- **Remapping.** Only an `HTTPException` 403 is turned into a 404. A DB error is never swallowed.
- **Same-tenant callers.** One who lacks the capability still gets 403.
- **#285's S1–S4** are each closed (details in "#285 S1–S4" below).

**Why it is blocking.** When the bulk controller's own membership check was deleted, a new power went with it. An instance admin who is **not a member** of a workspace can now bulk-mutate that workspace's tasks, including deleting them. On `main` that request is refused with 403. The pull request says no authority changed. This is an authority change that nobody recorded (S1).

The other findings are pre-existing instances of the same oracle class outside #290's literal scope, a timing residue, and leftover NUL-to-500 paths. None is introduced by this PR.

| # | Severity | Summary |
| --- | --- | --- |
| S1 | **BLOCKING** | Deleting `bulk-update-tasks.ts`'s membership check lets a non-member instance admin bulk update or delete any workspace's tasks. `main` returns 403 and this PR returns 200. The PR says no authority changed, and nothing records the change. |
| S2 | NON-BLOCKING | The same existence oracle, pre-existing, in three controllers this PR edits. The bulk `addLabel`/`removeLabel` `value` leaks label ids. `PUT /api/label/{id}/task` leaks task ids. `PUT /api/task/move/{id}` leaks project ids. |
| S3 | NON-BLOCKING | The same oracle in bespoke scopes outside the middleware. `GET /api/asset/{id}` answers 403 vs 404, and `/api/ws/{projectId}` answers 403 vs 401. These are follow-ups. |
| S4 | NON-BLOCKING | A timing residue. An other-tenant id costs two extra queries: median 1.50 ms vs 0.71 ms in-process. `lookupMany` scales with the number of distinct foreign workspaces. |
| S5 | NON-BLOCKING | A NUL still returns 500 in four places in the task router, which this PR touches: create `userId`, import `tasks[].userId`, list `?assigneeId=`, and bulk `addLabel`/`removeLabel` `value`. |
| S6 | NON-BLOCKING | The bulk controller trusts `c.get("workspaceId")` without a guard. Today it is always set. |

---

## What I probed

Live probes ran as a temporary integration test file, deleted afterwards, on the private DB
`pr307_opus_probe_test`. Caller A is a `member` of workspace A only, unless stated otherwise. B is
another tenant.

### 1. Existence oracles through the middleware: closed

| Request | Other tenant | Nonexistent |
| --- | --- | --- |
| `GET /api/task/{id}` (`fromTask`) | 404 `Task not found` | 404 `Task not found` |
| `GET /api/task/tasks/{projectId}` (`fromProject`) | 400 `Workspace ID could not be determined` | same 400 |
| `PATCH /api/task/bulk` `[foreign]` / `[nonexistent]` | 404 `No tasks found` | 404 `No tasks found` |
| `PATCH /api/task/bulk` `[own, foreign]` / `[own, nonexistent]` (`updatePriority`) | 200 `{"success":true,"updatedCount":1}` | identical 200 |
| `PATCH /api/task/bulk` `[ownInDeletedProject, foreign]` / `[…, nonexistent]` | 404 `No tasks found` | 404 `No tasks found` |
| `POST /api/task-relation`, foreign vs nonexistent `sourceTaskId` | 404 `Source task not found` | same |
| `POST /api/task-relation`, foreign vs nonexistent `targetTaskId` | 404 `Target task not found` | same |
| `DELETE /api/task-relation/{id}` | 404 `Task relation not found` | same |
| `PUT /api/workflow-rule/{projectId}`, foreign vs nonexistent `columnId` | 400 `Column does not belong…` | same |
| `POST /api/label`, foreign vs nonexistent `taskId` | 404 `Task not found` | same |
| `PUT /api/task/assignee/{id}`, foreign vs nonexistent `userId` | 403 `Assignee is not a member…` | same |

- **Headers.** They were compared in full, minus `date`, and are identical in every pair. Content types were identical as well: `text/plain` for the errors, JSON for the 200s.
- **Bulk side effect.** After the `[own, foreign]` update, the foreign task's `priority` was still `medium`. `updatedCount` is the same in both cases.
- **Mutation checks** on the unit file `tests/api/utils/workspace-access-middleware.test.ts`, whose baseline is 32/32:
  - Replacing the 403 guard in the `lookup` branch (`workspace-access-middleware.ts:200-202`) with an unconditional rethrow makes **11** tests fail: the 8 per-helper #290 cases, the two body-id cases, and the `fromProject` case.
  - Re-adding `{ type: "query", key: "workspaceId" }` to `fromTask` makes the S1 case `fromTask: no id + ?workspaceId=<mine>` fail, and **only** that case. That is exactly what #285's S1 asked for.
  - The source was restored afterwards, and `git status` was clean.

### 2. Fail-open: none found

- **What gets remapped.** Both remaps only remap `error instanceof HTTPException && status === 403` (`:200-213` and `:257-263`). Anything else is rethrown.
- **DB errors.** A raw `pg` error from `validateWorkspaceAccess` is not an `HTTPException`, so it propagates to the global handler as a 500. It is never turned into a 404 and never treated as "reachable".
- **`lookupMany`'s own query** (`:227-234`) is not wrapped at all. A DB error there is a 500. It does not become an empty result, so it cannot pretend that no tasks were found.
- **`accessChecked`** is set only after a successful `validateWorkspaceAccess` (`:198`, `:284`). The generic check at `:299-301` still runs for `fromQuery`, `fromBody` and `fromParam`.
- **`fromProject` on 403** resets `workspaceId = null`, then hits the post-loop 400 (`:294-298`). `next()` is never reached.
- **The 403s that get remapped** are "You don't have access to this workspace" and "Invalid API key for this workspace". Both are about the caller's own credential or membership, so a 404 for them reveals nothing stored.
- **Same-tenant callers.** A `viewer` in workspace A gets **403** `Insufficient permissions` on bulk `delete`, on `DELETE /api/task/{id}` and on `POST /api/task-relation`. That is the capability check, so 403 is still reachable where it should be.
- **The bulk controller and `c.get("workspaceId")`.** `bulkUpdateTasks(` has exactly one caller, `task/index.ts:551`. That route's middleware array (`:112-116`) begins with `workspaceAccess.fromTasks()`, and the only exit from that middleware that reaches `next()` sets `workspaceId` (`:303`). No other router imports the controller. A future re-mount without `fromTasks()` would pass `undefined` into `eq(projectTable.workspaceId, …)`, which matches no row and so fails closed as a 404. That leans on the ORM, though, so see S6.

### 3. The bulk update's semantics

- **Dropping unreachable ids** gives the same observable result that `main` already gave for nonexistent ids and for ids under a soft-deleted project: they are silently skipped, and `updatedCount` reports only what was touched. No legitimate caller loses anything they could previously do, **except** the instance-admin case in S1.
- **Other shapes checked live:**
  - An own task in a deleted project, plus a live own task: 200 with `updatedCount: 1`.
  - Tasks in deleted projects only: 404.
  - A caller who is genuinely a member of two workspaces: still 400 "must belong to the same workspace", pinned by the PR's own test.
- **Spec.** `rbac.md` and `api-design.md` have no bulk-specific rule. `work-items.md` WI-25 ("47 of 50 succeeding reports 3 failures with reasons") governs the future `POST /api/work-items/bulk`, not the inherited `PATCH /api/task/bulk`. The 200 with a partial `updatedCount` is consistent with the current contract, and it is acceptable security-wise, because a "skipped" id reads the same whether it is foreign or nonexistent. **Forward note for WI-25:** a per-item failure reason must also be the same for "not found" and "out of reach". Otherwise that endpoint reopens this oracle, one item at a time.

### 4. The rest of the repository: other bespoke scopes

- **Callers of `validateWorkspaceAccess(`.**
  - `task-relation/index.ts:77` and `:117`: fixed here.
  - `work-item/require-work-item-reach.ts:98`: already remaps, since #261 F2.
  - `utils/authorize-asset-access.ts:21`: **not remapped**, see S3.
  - `index.ts:910` (`/api/ws/:projectId`): **not remapped**, see S3.
- **`HTTPException(403` throwers.**
  - `require-workspace-capability`, `require-workspace-permission` and `require-workspace-role-authority` are the capability 403s, which are correct.
  - `require-workspace-membership` handles workspace-id-selected routes. There is no row lookup, so it is the same shape as `fromParam`.
  - `assert-assignable-user` gives the same 403 for foreign and nonexistent users (live, see the table above).
  - `invitation/index.ts:181,207` (`NotInvitationRecipientError`) and `notification-preferences/service.ts:132` return 403 after a row lookup. Invitation ids are bearer tokens, and their existence is already public through `GET /api/invitation/public/:id`, so no new bit leaks there.
- **`require-invitation-workspace-access.ts:47`** sets `workspaceId` from the invitation row without a reach check, so the following capability check answers 403 where a nonexistent invitation gets 404. It has the same low value as the invitation note above. It belongs to the S3 follow-up and is not a separate finding.

---

## S1: A non-member instance admin can now bulk-mutate any workspace's tasks (BLOCKING)

**Where:** `apps/api/src/task/controllers/bulk-update-tasks.ts`. The PR deletes `main`'s
`workspace_member` lookup and its 403 "You don't have access to this workspace"
(`origin/main:…/bulk-update-tasks.ts:78-94`). It now relies only on
`workspaceAccess.fromTasks()` (`validateWorkspaceAccess`, whose `user.role === "admin"`
short-circuit is at `validate-workspace-access.ts:39-41`) and on `requireBulkTaskPermission`, whose
`hasWorkspacePermission` has the `isInstanceAdmin` short-circuit at
`require-workspace-permission.ts:96-98`.

**Reproduction (live).** Caller: a user with `user.role = 'admin'`, who is a member of an unrelated
workspace only. Request: `PATCH /api/task/bulk {"taskIds":["<B's task>"],"operation":"delete"}`.

- With `main`'s `bulk-update-tasks.ts` swapped in: **403** `You don't have access to this workspace`, and B's task survives.
- At `0ca150d`: **200** `{"success":true,"updatedCount":1}`, and B's task is **deleted**.

**Context.** The same admin can already delete B's tasks one at a time. `DELETE /api/task/{id}`
returned 200 in the same probe, because the singular routes never carried the extra check. So the
new power is narrow, and it matches the rest of the task surface. But:

- It is an authority change on a destructive route. It ships inside a PR that says "no capability, scope, or `scopeSource` changed" and "no mutation path changed".
- The 2026-09-08 decision-log entry rejects "an instance admin can reach the data anyway" as a reason to widen instance-admin mutation authority by side effect. That entry is scoped to the S4 workspace routes, but the reasoning is the same.
- Per `CLAUDE.md`, a change to authority has to be recorded before dependent code merges.

**Either of these clears it:**

1. **Restore the membership check in the controller**, keyed on the already-resolved `workspaceId`. This is one `select` against `workspaceUserTable` for `(userId, workspaceId)`, with the same 403. It cannot reintroduce the oracle. For a non-admin, the middleware has already proved membership, so the check never fires. For an admin, the workspace is reachable by definition, so a 403 there reveals nothing about another tenant. Add a test with a non-member instance admin that expects 403.
2. **Or keep the widening deliberately.** Record it in the decision log (it aligns bulk with the singular task routes), correct the PR body's "no authority change" claims, and add a test that pins the new 200, so the change is intentional and visible.

## S2: The same oracle, pre-existing, in controllers this PR edits (NON-BLOCKING)

These predate the PR and are outside #290's "every `from*` helper" done-when. But they are the
identical class, and they sit in files this PR edits for S4. Caller: workspace-A **admin**, so the
capability check passes. All three were reproduced live.

| Route, field | Foreign id | Nonexistent id | Where |
| --- | --- | --- | --- |
| `PATCH /api/task/bulk` `addLabel`, `value` (label id) | 400 `Label and tasks must belong to the same workspace` | 404 `Label not found` | `bulk-update-tasks.ts:220-233` |
| `PATCH /api/task/bulk` `removeLabel`, `value` | 200 `updatedCount: 0` | 404 `Label not found` | `bulk-update-tasks.ts:272-279` |
| `PUT /api/label/{id}/task`, body `taskId` | 400 `Label and task must belong to the same workspace` | 404 `Task not found` | `label/controllers/assign-label-to-task.ts:31-51` |
| `PUT /api/task/move/{id}`, body `destinationProjectId` | 400 `Tasks can only be moved within the same workspace` | 404 `Project not found` | `task/controllers/move-task.ts:121-146` |

**Fix:** scope each lookup to the caller's resolved `workspaceId` in the query itself, as
`create-task-relation.ts` already does for `targetTaskId`, so that a foreign row simply "is not
found". I recommend folding these into this PR's next round, since it is already touching all three
files. Otherwise, one follow-up issue.

## S3: The same oracle in bespoke scopes outside the middleware (NON-BLOCKING, follow-up)

- **`GET /api/asset/{id}`**: another tenant's asset gets **403** "You don't have access to this workspace", and a nonexistent asset gets **404** "Asset not found". The lookup is at `apps/api/src/index.ts:743-763` and the reach check at `:766` → `utils/authorize-asset-access.ts:21`. Live.
- **`GET /api/ws/{projectId}`**: another tenant's project gets **403**, and a nonexistent project gets **401** "Unauthorized". The code is at `apps/api/src/index.ts:900-910`. Live, with upgrade headers.
- **Invitation-scoped routes** (`require-invitation-workspace-access.ts:47`) behave as noted in section 4. The value is low.

**Severity:** the same class and bit as #290. The ids are cuid2, so an attacker needs an id they
already hold, for example from before they were removed from a workspace. These are not in #290's
scope, which is `workspace-access-middleware.ts`'s helpers. **Fix:** open one follow-up issue that
applies the "catch the 403, rethrow the resource's own not-found" pattern to both sites. The ws
route should also answer the same status for "unknown project".

## S4: Timing residue (NON-BLOCKING, follow-up)

**Where:** the `lookup` branch (`workspace-access-middleware.ts:192-215`) and `lookupMany`
(`:250-266`).

- **Single lookups.** A nonexistent id stops after one query. A foreign id runs `validateWorkspaceAccess` as well, which costs two more queries (the user's role, then membership), or three with an API key. Measured in-process against the local DB, 300 interleaved samples of `GET /api/task/{id}`: median **1.50 ms** for a foreign id vs **0.71 ms** for a nonexistent one.
- **Bulk.** `lookupMany` adds that cost once per distinct foreign workspace, so timing can also reveal how many distinct tenants a list of ids spans.
- **The class.** `require-work-item-reach.ts` (#261 F2) has the same shape, so this residue is class-wide and not a regression.

**Fix (follow-up):** do the reach check inside the row query, joining `workspace_member` on
`(workspace_id, user_id)` with the instance-admin case folded in, so that "not found" and "out of
reach" run the same query and return the same null.

## S5: NUL still returns 500 in the task router (NON-BLOCKING, pre-existing)

Live, as a member of workspace A, with the value `"\u0000x"`:

- `POST /api/task/{projectId}` body `userId` → **500**
- `POST /api/task/import/{projectId}` body `tasks[].userId` → **500**
- `GET /api/task/tasks/{projectId}?assigneeId=` → **500**
- `PATCH /api/task/bulk` `addLabel` `value` → **500**. `removeLabel` takes the same path.

For comparison, the guarded bulk `updateAssignee` `value` path returns 403 before it queries, and a
NUL `status` returns a 400. No `pg` detail leaks in any of the 500 envelopes (`{"message":"Internal
Server Error"}`). The PR's "Not done" discloses that the sweep is partial. This lists the obvious
remainder in a router this PR touches. **Fix:** a follow-up, or a zod-level NUL refinement on
`z.string()` id fields, which would close the class instead of the instances.

## S6: The bulk controller trusts `c.get("workspaceId")` without a guard (NON-BLOCKING, hardening)

**Where:** `task/index.ts:556` passes `c.get("workspaceId")` straight through, and
`bulk-update-tasks.ts:71` uses it in `eq(...)`. Today the value is always set (section 2). Add
`if (!workspaceId) throw new HTTPException(500, …)` in the handler, so that a future re-mount
without `fromTasks()` fails loudly rather than depending on how the ORM treats `undefined`.

**Also noted.** Not a finding against this PR: `task-relation/index.ts:77,117` call
`validateWorkspaceAccess(userId, workspaceId)` without `apiKeyId`, so the API-key-enabled check
does not run on those two scopes. This predates the PR, and the global API-key authentication
still runs.

---

## #285 S1–S4: each one closed

- **S1: closed.** `tests/api/utils/workspace-access-middleware.test.ts:282-323` adds one no-id + `?workspaceId=<mine>` case per helper, expecting 400 with no lookup and no handler. Mutation-checked above: re-adding the `query` source to `fromTask` fails exactly that case. The earlier over-claiming comment at `:200-205` is now accurate for the #256 block, and the S1 block carries its own accurate comment.
- **S2: closed.** `workspace-access-middleware.ts:49-60` and `:176-183` now say the other-tenant 403 was the remaining oracle and that #290 closes it. `tests/api-integration/task.test.ts:490-491` says the same thing.
- **S3: closed.** For example, `label/index.ts:37-43` now declares 400 for NUL only and 404 `Task not found`. Every 403 kept on the 36 routes is a capability 403, for example `task-relation`'s "Missing task:update permission". `check:openapi` passes (106 operations), and the `openapi.json` diff is response-level only.
- **S4: closed for the named fields.** `task-relation/index.ts:64` (`sourceTaskId`, before `workspaceIdOfTask`) and `create-task-relation.ts:29` (`targetTaskId`, before any query). Also `create-label.ts:20`, `assign-label-to-task.ts:19`, `upsert-workflow-rule.ts:23`, `move-task.ts:108` (before the destination lookup at `:121`; the query at `:94` uses the path id the middleware already guarded) and `update-task-assignee.ts:27` (before the first query at `:30`). Every guard sits before its query. The remainder is S5.
- **#288: closed.** `hasNulByte` is gone from `apps/api/src`; the only remaining mentions are historical comments. Every source type calls `rejectNulByte(…, "Workspace/resource id")` before any DB access (`:142`, `:150`, `:156`, `:173`, `:224`). For `lookupMany`, every string id is checked before the single query.

---

## Verification run

At `0ca150d`, after `pnpm install --frozen-lockfile` and
`pnpm turbo build --filter=@taskdesk/permissions --filter=@taskdesk/email`:

- **Unit** (`apps/api`, `vitest.config.ts`): **52 files, 368 tests, all passed**.
- **Permissions** (`vitest.permissions.config.ts`): **10 files, 80 tests, all passed**.
- **`check:openapi`**: `tests/api-contract/openapi.json matches the API (106 operations)`.
- **`node --test 'scripts/ci/**/*.test.mjs'`**: **88 suites, 495 tests, 495 pass, 0 fail**.
- **Integration** (private DB `pr307_opus_test` on td-lane-pg, fresh): **75 files, 1037 tests, all passed**. The first attempt was stopped and rerun from scratch, because a probe mutation had overlapped it.
- **Live probes and mutations** are as described above. The probe file and every source mutation were removed or restored afterwards, and `git status` showed only this note.

## What I did not do

- I did not `docker build`. This PR changes nothing that affects the image's boot path.
- I did not audit every `z.string()` body field repo-wide for NUL. I covered only the routers this PR touches (S5).
- I did not measure timing over a real network. S4's numbers are in-process.
- I did not approve, comment on, or merge the PR. I committed only this note.
