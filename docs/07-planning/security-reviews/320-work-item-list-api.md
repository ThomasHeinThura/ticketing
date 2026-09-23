# Security review — work-item list sort, cursor pagination, filters and name resolution (#310)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `d8e58396114c6941f3d150bfcb4ae3f15c2fbdac`
**Pull request:** #320 (closes #310)
**Date:** 2026-09-23


## Head verification

- `gh pr view 320 --json headRefOid` → `d8e58396114c6941f3d150bfcb4ae3f15c2fbdac`.
- `d8e5839` is a merge with parents `81234a2` (last code commit on the branch) and `b126c51` (current `origin/main`, #321).
- `git diff 81234a2 d8e5839` is byte-identical to `git diff b126c51^ b126c51`: the merge brings in exactly #321's five files and nothing else. It does not touch any file this PR changes.

## Surfaces examined

- `apps/api/src/work-item/list-query.ts`: the whole file. Sort allowlist, `primaryExpression`, `workItemOrderBy`, cursor encode and decode, `workItemCursorCondition`, `primaryValueForCursor`.
- `apps/api/src/work-item/controllers/list-work-items.ts`: the whole file. Filter building, `assignee=me`, the joins for state, state template, person and user, the page query, and the `count(*)`.
- `apps/api/src/work-item/schema.ts` (`listWorkItemsQuery`, `MIN_/MAX_WORK_ITEM_INSTANT_MS`), `response.ts` (`workItemListItemSchema`, `workItemListResponseSchema`), and `index.ts` (the `listWorkItemsRoute` middleware and handler).
- `apps/api/src/index.ts` `onError`: a non-`HTTPException` error becomes a bare `{"message":"Internal Server Error"}` 500, and no driver text reaches the wire.
- `apps/api/src/utils/require-workspace-capability.ts` and `workspace-access-middleware.ts` on `main`. `git diff origin/main HEAD -- apps/api/src/utils packages tests/permissions apps/api/src/work-item/policy.ts apps/api/src/work-item/require-work-item-reach.ts` is empty, so authz is byte-identical to `main`.
- `apps/api/src/database/schema.ts`: `personTable`, `stateTable`, `workItemTable`. Checked FKs, indexes and `work_item_priority_allowed`.
- `tests/permissions/matrix.fixture.json` entry for `GET /api/projects/{projectId}/work-items`, which is unchanged.
- `apps/web/src/hooks/queries/work-item/use-get-work-items.ts`, `fetchers/work-item/get-work-items.ts`, `components/user-avatar.tsx` (sign-out calls `queryClient.clear()`), `lib/http-error.ts` (a 401 does a full `location.replace`), and `query-client/index.ts` (no persister).
- `tests/api-integration/work-item-list-sort-pagination.test.ts`.
- `docs/01-architecture/api-design.md:107-134`, `rbac.md` (roles table, "The customer role is special", reach and the constant-shape 404), `work-items.md:201`, and issue #310.

## What I probed

Private DB `pr320_opus_test` on td-lane-pg. I dropped it afterwards. The probe file was scratch (`tests/api-integration/zz-opus-probe-320.test.ts`), real HTTP through `createApp()`, and is not committed.

1. **Suites at this head.** All green:
   - API unit: **54 files, 412 tests**.
   - `test:permissions`: **10 files, 80 tests**.
   - Integration: **80 files, 1106 tests**. That is 1095 plus #321's backfill suite.
   - Web: **63 files, 278 tests**.
   - `node --test 'scripts/ci/**/*.test.mjs'`: **495 tests, 88 suites, 0 fail**.
2. **SQL injection through the cursor.** Every cursor-derived value (`v`, `id`) and every sentinel reaches Postgres as a bound parameter through drizzle's `sql` template. The only literal SQL fragments are fixed strings: `>`/`<`, `asc`/`desc`, and the `CASE` arms. A cursor carrying `v: "') OR 1=1 --"` and `id: "' OR '1'='1"` returned **200 with 0 rows**, and did not widen the result. A `__proto__` key in the payload was inert (200, the normal rows). No injection path found.
3. **Cursor forgery against project scope.** The cursor is unsigned base64url JSON. Its keyset clause is only ever ANDed onto `project_id = ? AND workspace_id = ? AND archived_at IS NULL AND deleted_at IS NULL`, so no forged value can widen the set. `v: -1` returned exactly the project's own 3 rows. Replaying a cursor across projects is also covered by the PR's own test. Signing the cursor would add nothing to confidentiality, because every field in it is a value the caller already received.
4. **Cursor type confusion.** See **S2**. Wrong-typed or out-of-range values give a **500** with the generic body:
   - `key` with `v: "abc"`, `2^40`, `1.5`, or `1e400` (JSON Infinity);
   - `priority` with a string `v`;
   - `dueDate` with `v: "not-a-date"`, `"NaN"`, or `1e20`;
   - a NUL inside the decoded `v` or `id`. The raw-string NUL guard sees only the base64 text.

   In every case no driver message, SQL or stack trace leaked. `-infinity` as a `dueDate` value was accepted (200), which is harmless.
5. **Name disclosure (`stateName`, `assigneeName`).**
   - `stateName`/`stateCategory` come through `state → state_template`. `work_item(project_id, state_id)` is composite-FK'd to `state(project_id, id)`, so a row's state is always the project's own.
   - `assigneeName` comes through `person.id → user.name` with **no scoping of its own**, and `work_item.assignee_id` is a plain FK to `person.id` (`schema.ts:1713`). With direct SQL, I pointed an item at a person in a different organisation whose user belongs to a different workspace. The list returned that foreign user's name (`"Secret Foreign Person"`). **No live API path writes `work_item.assignee_id` today** (WI-10 is unbuilt; `grep` finds only the legacy `task` table's writers). So this is latent, not exploitable. See **S3**.
   - A deactivated person (`active = false`) still resolves to their name, and the client renders the name rather than "(inactive)". That is a product question about `work-items.md:201`, not disclosure: the caller could see the same assignee before.
6. **Filter and count oracles.**
   - `assignee=<foreign personId not assigned here>` and `assignee=<nonexistent id>` both return `200, total 0`.
   - `state=<another tenant's real state id>` and `state=nope` return byte-identical bodies.
   - `meta.total` uses the same project-scoped filter set as the page, without the cursor clause.
   - Sort keys are only fields already present in the response, so ordering reveals nothing new.
   - No existence oracle found.
7. **`assignee=me`.** It resolves only `person.user_id = <session userId>`. That is globally unique through `person_user_unique`, so it can never select another user's person. With two people assigned in one project, it returned only the caller's item. A caller with no person row gets an always-false condition (`sql` false). `ME` (upper case) is treated as a literal id and matches nothing.
8. **Reach, live at this head.**
   - viewer: **200**, same as `main`.
   - non-member owner of another workspace: **400**.
   - unknown project: **400**.
   - unknown role string `guest`: **403**.
   - The 400 is #307's `fromProject` answer on `main` (`workspace-access-middleware.ts` on `origin/main`, "fromProject has always answered the generic 400"). The PR changes only the test expectation, not reach.
   - A portal customer (a person with `side = customer` and no `workspace_member` row) is a non-member here and gets the same 400.
   - A `workspace_member` row whose role is literally `customer` gets **200**. See **S4**. It is pre-existing and unchanged by this PR.
9. **Input bounds.**
   - `limit` rejects 0, 201, a blank value and a duplicated `limit` with 400. `1e2` and `0x10` coerce to 100 and 16, which is harmless.
   - `cursor` is capped at 2048 characters.
   - 3000 comma-separated `state` ids and a 5000-character `assignee` both returned 200 quickly. They are one bound array or scalar, and the HTTP server's URL/header limit bounds them in production.
10. **Cost (DoS judgement).** I seeded **100,000** live items into one project and ran `EXPLAIN ANALYZE` on the route's query shape with `limit 201`:
    - `key`: index scan on `work_item_project_number_unique`, **0.7 ms**.
    - `title`, `priority`, `dueDate`: parallel seq scan plus top-N heapsort, **47–51 ms**. No index covers `(project_id, <expr>)`.
    - `count(*)`: seq scan, **24 ms**.

    Worst case is about 75 ms of database time per request at 100k items in a single project. The caller must be an authenticated member holding `work_item:read`, and the cost is bounded by one project's size. **Judgement: acceptable for P1.** No cap or estimate is required now. If projects are expected to exceed about 10^6 items, or the route gets a public or portal twin, add `(project_id, due_date)`/`(project_id, priority)` indexes, or switch `meta.total` to an estimate, which `api-design.md` already permits, and put the route behind the general rate limiter.
11. **Keyset correctness walk.** See **S1**. Walking `sort=dueDate&dir=asc&limit=1` over 3 items with no due date returned **the same item on every page, forever, with `hasMore: true`** (6 of 6 pages were `n3`). `dir=desc` walked correctly.
12. **Web client.**
    - The query key is `["work-items", projectId, sort, dir]`, and `placeholderData` reuses data only when `previousQuery.queryKey[1] === projectId`.
    - Sign-out calls `queryClient.clear()`. A 401 forces a full navigation (`location.replace`), which drops the in-memory cache. There is no query persister.
    - I found no path that shows one user's or project's rows under another context.
    - The positional `queryKey[1]` comparison is a fragility, which the ordinary reviewer already noted, not a leak.
    - The screen fetches only the first page (50 items) and doesn't yet render `hasMore`. That is functional, not security.

## Findings

**S1 — BLOCKING (correctness, not confidentiality). The `dueDate` ascending cursor never advances past rows with no due date.**
- `list-query.ts:81-85` orders null due dates by the SQL sentinel `9999-12-31T23:59:59.999Z`.
- `primaryValueForCursor` (`list-query.ts:224-229`) writes `9999-12-31T00:00:00.000Z` into the cursor for the same row.
- Every null-due row, including ones already returned, compares `>` the cursor. So page 2 restarts the null-due run from its first id. With more than `limit` such rows, `nextCursor` is identical on every page, and a client that follows it loops forever.
- Reproduced live: 6 of 6 pages returned the same row.
- This is not reachable from today's web screen, which never sends a cursor. But the route is a documented public API contract, and any "load more", export, or API consumer would spin and hammer the server.
- A related issue is in the comment at `list-query.ts:58-61`: it says the sentinels are "far outside" the accepted range, but they are exactly `MIN_/MAX_WORK_ITEM_INSTANT_MS` (`schema.ts:139-140`), which are inclusive. A real row at either bound ties with the null rows. The keyset stays consistent, but the stated invariant is false.
- **Fix:**
  - Derive both the SQL sentinel and the cursor sentinel from one shared constant.
  - Better, encode "null" in the cursor explicitly: order by `(due_date IS NULL, due_date, id)`.
  - Add a regression test that walks `dueDate` in both directions with `limit=1` over two or more null-due rows. The existing walk test covers only `priority`.

**S2 — NON-BLOCKING. A forged cursor with a wrong-typed value gives a 500, not the documented 400.**
- `decodeWorkItemCursor` (`list-query.ts:155-161`) checks only that `v` is a string or a number and that `id` is a non-empty string.
- `workItemCursorCondition` (`:190-192`) then binds it against an `integer`/`CASE int`/`timestamp` expression. `22P02`/`22003`/`22007`/NUL errors escape as generic 500s.
- No information leaks, since the body is the constant `Internal Server Error`. But the route description (`index.ts`) and the `schema.ts` comment promise "never a 500".
- It also turns malformed input into 5xx noise in monitoring.
- **Fix:** validate `v` per sort field: a safe int32 for `key`; one of `{-1,1,2,3,4,5}` for `priority`; an ISO instant inside the accepted range (or the sentinel) for `dueDate`; a string for `title`. Reject NUL in the decoded `v` and `id`.

**S3 — NON-BLOCKING (latent). The `assigneeName` join is not tenant-scoped, and neither is `work_item.assignee_id`.**
- `list-work-items.ts:184-185` joins `person` and `user` on id alone.
- `work_item.assignee_id` → `person.id` (`schema.ts:1713`) is a plain single-column FK, unlike `state_id`/`type_id`/`parent_id`, which are composite-scoped.
- If any future write path (WI-10 assignment, import, bulk update) ever lets `assignee_id` point outside the workspace's roster, this route would print a foreign person's real name to every viewer. That is new disclosure: before this PR only the opaque id was exposed.
- Not exploitable at this head, because no route writes `work_item.assignee_id`.
- **Recommendation:** make WI-10's acceptance criteria require roster validation of the assignee, and/or scope the join, e.g. only resolve a name when the person holds `workspace_member` in this workspace. Otherwise return `null`.

**S4 — NON-BLOCKING, pre-existing, not introduced here. A `workspace_member.role` of `customer` passes `requireWorkspaceCapability("work_item:read")`.**
- `builtInRoleHasCapability` (`require-workspace-capability.ts:194`) accepts any `BUILT_IN_ROLES` key, including the organisation-scoped `customer` and the instance-scoped `instance_admin`.
- So a member row literally named `customer` gets **200** on this route, while the permission-matrix fixture says customer → 403.
- The same answer holds on `main`: the file is unchanged by this PR.
- Only a workspace owner can create such a row, and it grants no more than `viewer`, so there is no privilege escalation.
- But the runtime check and the matrix disagree. This is the live-middleware twin of #315's S1, which was fixed only in `resolve-identity.ts`.
- **Recommendation:** a separate issue to apply the same `scope === "workspace"` filter in `builtInRoleHasCapability`, and to reserve `customer`/`instance_admin` in `create-workspace-role.ts`.

## Verdict

**CHANGES NEEDED** at `d8e58396114c6941f3d150bfcb4ae3f15c2fbdac`, for S1 only.
- On the security axes this change is sound. Reach and authz are byte-identical to `main`, there is no injection, and there is no cross-project or cross-tenant widening. There is also no existence oracle through filters, count, sort or cursor, and no client-side cross-context leak.
- S1 is a reproducible defect in the pagination contract this PR introduces, and its fix is small.
- S2 is recommended in the same fix-up; it's cheap and adjacent to S1.
- S3 and S4 should be tracked, not fixed here.

A re-review after the fix can be a narrow delta pass on `list-query.ts` and its tests.
