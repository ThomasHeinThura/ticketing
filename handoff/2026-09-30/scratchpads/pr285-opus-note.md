# Security review — #256 remove `?workspaceId=` fallback, #281 NUL sweep (PR #285)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `cde46561399a9a5b1b2f0762fe40dcba68f5c3c3`
**Reviewed SHA:** `cde46561399a9a5b1b2f0762fe40dcba68f5c3c3` (confirmed via `gh pr view 285 --json headRefOid`)
**PR commit:** `e57fc5e` (the rest of the range is `main` merges)
**Branch:** `fix/256-no-query-fallback`
**Pull request:** #285
**Date:** 2026-09-23

## Surfaces examined

- `apps/api/src/utils/workspace-access-middleware.ts`: the whole file. That covers the source loop, `lookupWorkspaceId`, and every `workspaceAccess.from*` factory.
- `apps/api/src/utils/reject-nul-byte.ts` (new).
- Its six call sites: `apps/api/src/index.ts` (`/invitation/public/:id`, `/asset/{id}`, `/ws/:projectId`), `task/controllers/require-task-permission.ts`, `utils/require-invitation-workspace-access.ts`, and `task-relation/index.ts`.
- `apps/api/src/{column,comment,label,task,time-entry}/policy.ts` (comment edits).
- `apps/api/src/work-item/{response.ts,controllers/get-work-item.ts}`, `tests/api-contract/openapi.json`.
- The route registrations for all 36 call sites of the 8 helpers: `task`, `label`, `comment`, `time-entry`, `activity`, `column`, `workflow-rule`, `task-relation`, and `external-link` `index.ts`.
- Every `c.req.param(` and `c.req.query(` read under `apps/api/src`.
- New and changed tests: `tests/api/utils/workspace-access-middleware.test.ts`, `tests/api/task/require-task-permission.test.ts`, `tests/api-integration/{task,label,comment,workspace-invitation-writes,nul-byte-param-sweep}.test.ts`.

---

## Verdict

**CLEAR WITH FINDINGS. Nothing is blocking.**

The fallback in #256 is gone on every path I could find, and it is closed twice over. Each of the 8
helpers now lists one `lookup` source. On top of that, a new generic throw in the `lookup` branch
answers any failed row lookup, for any resource except `project`, with a 404 before the loop can
reach another source. No other `from*` helper, custom scope middleware or controller reads a
caller-supplied `?workspaceId=` for these resources. The 404 change adds no new oracle: an
out-of-reach caller learns the same one bit as before, and that bit is already tracked as #290. The
`rejectNulByte` placements do not change auth ordering. The `policy.ts` edits are comment-only. The
findings are one test-accuracy gap (S1), two misleading comments (S2), stale OpenAPI status
declarations (S3), and a NUL-to-500 gap in a JSON body that this PR did not cause and #281 did not
name (S4).

| # | Severity | Summary |
| --- | --- | --- |
| S1 | NON-BLOCKING | The per-helper "mutation-checked" tests do not pin the source-list removal. Restoring a `query` source leaves every test green. |
| S2 | NON-BLOCKING | Two comments say the 404 removes the existence oracle. It does not (other tenant 403, nonexistent 404, #290). |
| S3 | NON-BLOCKING | The route `responses` for the 36 call sites still declare an unknown id as 400, and most declare no 404. The OpenAPI contract is now wrong. |
| S4 | NON-BLOCKING | A NUL in `POST /api/task-relation` `sourceTaskId`/`targetTaskId` still returns 500. This predates the PR and is outside #281's raw-param list. |

---

## What I probed

### 1. Is the fallback really gone? Yes.

- **Source lists.** `workspace-access-middleware.ts:386-444` lists every factory. `fromQuery`, `fromBody` and `fromParam` take a single request source by design (`scopeSource: "request"`). `fromProject` is `[lookup:project]`, `fromTasks` is `[lookupMany:task]`, and all 8 #256 helpers are `[lookup:<resource>]`. No factory still combines a `lookup` with a `query`.
- **Direct `workspaceAccessMiddleware({...})` construction outside the file:** none (grep under `apps/api/src`).
- **The 36 registrations.** A grep for `workspaceAccess.from(Task|TaskId|Label|TimeEntry|Activity|Comment|Column|WorkflowRule)` outside `policy.ts` returns exactly 36: task 12, label 6, activity 5, comment 4, time-entry 4, column 2, and one each in workflow-rule, task-relation and external-link. That matches the PR table.
- **Controllers reading `?workspaceId=`.** Every `c.req.query(` under `apps/api/src` was checked. The only one outside the middleware is `index.ts:909` (`windowId`, which does no scoping). `c.req.valid("query")` appears only in `task/index.ts:548` (bulk filters), `project/index.ts:242` (`includeArchived`) and `search/index.ts:33`, and none of these sits behind one of the 8 helpers. No route that uses one of the 8 also scopes from the query string.
- **Custom scope middleware.** `task-relation/index.ts` `scopeToSourceTask` and `scopeToRelation`, `require-work-item-reach.ts` and `require-invitation-workspace-access.ts` all resolve the workspace from the row. None has a query fallback.
- **The "id absent" path.** When the path or body has no id, the `lookup` branch does nothing, and the loop now ends at the generic 400 `Workspace ID could not be determined` (`:194-198`). Before this PR it fell through to `?workspaceId=`. Live: `POST /api/time-entry?workspaceId=<mine>` with no `taskId` now returns 400 from the middleware, where `main` passed the middleware and let zod reject the body. This path is covered **only** by the source-list removal, not by the new 404 throw. See S1.

### 2. Does the 404 change create an oracle? No new one.

Live, on the private DB, with caller A as a member of workspace A only. The `main` column was
produced by swapping in `main`'s middleware file:

| Request | `main` | this PR |
| --- | --- | --- |
| `GET /api/task/<B's task>` | 403 | 403 |
| `GET /api/task/<B's task>?workspaceId=<A>` | 403 | 403 |
| `GET /api/task/nope` | 400 | 404 |
| `GET /api/task/nope?workspaceId=<B>` | 403 | 404 |
| `GET /api/task/%00x` | 400 (NUL) | 400 (NUL) |
| anonymous `GET /api/task/nope` | 401 | 401 |

- Other tenant versus nonexistent was already distinguishable (403 vs 400). It still is (403 vs 404). That is #290, not a new bit.
- The PR does remove one small oddity: on `main`, a nonexistent id with a foreign `?workspaceId=` gave 403. Now it gives a flat 404.
- The NUL 400 versus the unknown-id 404 depends only on the caller's own input. It reveals nothing stored.
- `fromProject` still gives 400 for an unknown id (the `resource !== "project"` guard at `:152`). That is unchanged, and #202's tests still pass.
- The 404 is thrown before `validateWorkspaceAccess`, so no authority decision is ever made against a workspace the caller supplied.
- A transient DB error still fails closed with 503 (`:365-381`). It never degrades to null, and so never to a 404 or a fallback.

### 3. The `index.ts` sites: no change to auth ordering.

- **`GET /api/asset/{id}`** (`index.ts:733-738`) is registered below the app-wide auth guard. Anonymous requests get 401 for both a NUL id and a normal id (live), so the NUL check is never reached before auth.
- **`GET /api/ws/:projectId`** (`index.ts:890-895`): the check sits after `authenticateApiRequest`. Anonymous requests get 401 for both NUL and normal ids (live).
- **`GET /api/invitation/public/:id`** (`index.ts:374-382`) is public by design. A NUL gives 400, where `main` gave 500. An unknown id gives 200 `{"valid":false}`, unchanged. The new 400 depends only on the caller's own input, and it removes a 500. No new signal.
- **`requireTaskAssigneePermission`** runs after `workspaceAccess.fromTask()`, which already rejects a NUL `id`, so this check is defence in depth and unreachable through the route. **`scopeToRelation`**'s check comes after `requireUserId`. **`requireInvitationWorkspaceAccess`**'s check comes after its empty-id 400. All are fine.
- The remaining raw `c.req.param(` reads are `task/index.ts:582`, which sits behind `fromProject`'s NUL check, and `require-work-item-reach.ts:50`, which has its own check. The raw-param sweep is complete.

### 4. Policy files: comment-only.

`git diff origin/main...cde4656 -- 'apps/api/src/*/policy.ts'`, filtered to lines that are not
`//` or ` *` comments, is empty. No `capability`, `scope`, `scopeSource` or key changed.

### 5. Everything else in the diff

- `work-item/response.ts` adds `startDate` and `dueDate` as `nullableResponseTimestamp`. The handlers already returned both, so this is documentation only and `openapi.json` matches. No new field is exposed.
- `get-work-item.ts` is a comment fix.
- `RESOURCE_NOT_FOUND_MESSAGE` is a closed record keyed by the `lookup` resource union minus `project`. The guard excludes `project`, so the index is always defined.

---

## S1: The per-helper tests do not pin the source-list removal (NON-BLOCKING)

**Where:** `tests/api/utils/workspace-access-middleware.test.ts:185-209`. The comment at `:188`
says: "Mutation-checked: restoring the removed `{ type: "query", key: "workspaceId" }` source to
any one of these factories makes its own case here fail".

**Reproduction:**
- **M1:** add `{ type: "query", key: "workspaceId" }` back to `fromTask` only, then run `vitest run ../../tests/api/utils/workspace-access-middleware.test.ts`. Result: **13/13 pass**.
- **M2:** disable only the new throw (`if (false && !workspaceId && ...)` at `:152`). Result: **9 of 13 fail**.

So the tests pin the generic 404 throw, not the source-list change. With the id present, the
throw stops the loop before any second source is read.

**Impact:** low. The two layers each close the id-present case on their own. But the id-absent case
depends only on the source-list removal (section 1, last bullet), and M1 shows no test fails if that
removal is undone. The ordinary review's "mutation-checked 2 helpers" was presumably M2-shaped. The
comment also overstates what the tests prove.

**What would close it:** in the unit test, add one case per helper that sends no id at all (no path
id, no body id) plus `?workspaceId=workspace-mine`, and expect 400 with the handler never reached.
That case fails under M1. Then correct the `:188` comment.

## S2: Comments claim the existence oracle is closed (NON-BLOCKING)

**Where:**
- `apps/api/src/utils/workspace-access-middleware.ts:157-158`: "a nonexistent id is indistinguishable from one that belongs to someone else -- no existence oracle".
- `tests/api-integration/task.test.ts:485`: "closing the existence-oracle gap the fallback created".

**Reproduction:** section 2's table. Another tenant's task gives 403 and a nonexistent one gives
404, so the two are still distinguishable. #290 tracks this.

**Impact:** the security comments say something false, and a later reader could close #290 on the
strength of them. Reword both to say this matches the controllers' own 404s, and that the
other-tenant 403 remains (#290).

## S3: OpenAPI status declarations are stale (NON-BLOCKING)

**Where:** for example `label/index.ts:37-41` (`GET /api/label/task/{taskId}` declares 400 "Unknown
task, or its workspace could not be determined" and 403, with no 404),
`time-entry/index.ts:31-34, 49-52`, `comment/index.ts:33-36, 108-111`,
`activity/index.ts:35-38`, `task-relation/index.ts:114-117`,
`external-link/index.ts:26-29`, `task/index.ts:170-173, 304-307`, and
`workflow-rule/index.ts:87-90`. The "Invalid body, or unknown <x>" 400 entries on the write routes
have the same problem.

**Reproduction:** `GET /api/task/nope` returns 404 (section 2), but the route declares an unknown
task as 400. `openapi.json` did not change for these routes.

**Impact:** documentation and client-contract only. The runtime is correct. Fix it in a follow-up:
move "unknown <x>" to a declared 404 on the 36 routes and regenerate the contract.

## S4: A NUL in the task-relation body still returns 500 (NON-BLOCKING, predates this PR)

**Where:**
- `apps/api/src/task-relation/index.ts:53-62`: `scopeToSourceTask` sends body `sourceTaskId` straight into `workspaceIdOfTask`, with no NUL check.
- `task-relation/controllers/create-task-relation.ts:60`: `targetTaskId` does the same.

**Reproduction (live, both `main` and `cde4656`):** as a workspace member, send
`POST /api/task-relation` with `{"sourceTaskId":"\u0000x","targetTaskId":"<own task>","relationType":"blocks"}`.
The response is **500** `{"message":"Internal Server Error"}`. Swapping in `"targetTaskId":"\u0000x"`
also gives 500. No `pg` detail leaks in the envelope.

**Impact:** a 500 instead of a 400, with no auth or data effect. Body ids were outside #281's
raw-param list, and this PR's sweep is complete for raw params. I recommend a follow-up issue: apply
`rejectNulByte` in `scopeToSourceTask`, or add a zod NUL refinement to `createTaskRelationBody`.
More broadly, `z.string()` body and param fields that reach queries without a `workspaceAccess.*`
guard ahead of them are the remaining surface.

---

## Verification run

- `pnpm install --frozen-lockfile`, then `pnpm turbo build --filter=@taskdesk/permissions --filter=@taskdesk/email`.
- **Full integration suite** on the private DB `pr285_opus_test` (td-lane-pg, `127.0.0.1:55440`), at `cde4656`: **72 files, 963/963 passed**.
- **Unit test** `tests/api/utils/workspace-access-middleware.test.ts`: 13/13 at the head. Mutations M1 and M2 as in S1. The source was restored afterwards and `git status` confirmed clean.
- **Live probes** (a temporary integration test file, since deleted) for sections 2 and 3 and for S4, run against the head and against `main`'s middleware.

## What I did not do

- I did not run the unit, permissions or contract suites beyond the one middleware unit file. CI covers those.
- I did not audit NUL handling on `c.req.valid("param")` and body fields repo-wide, beyond the task-relation instance in S4.
- I did not push, comment, commit or merge.
