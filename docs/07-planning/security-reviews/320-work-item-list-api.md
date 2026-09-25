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

---

## Delta review — fix for S1–S3

**Reviewer:** Opus 5.5, the same fresh context as the first pass. Did not author, direct, or remediate the fix.
**Reviewed head:** `b6e3454caa1598ce1a1be0010078f410557db444`
**Date:** 2026-09-23

### Head verification

- `gh pr view 320 --json headRefOid` → `b6e3454caa1598ce1a1be0010078f410557db444`.
- `b6e3454` is a merge with parents `1e8ad6f` (the fix) and `dd067e2` (`origin/main`, #325). `git diff 1e8ad6f b6e3454` touches only `docs/07-planning/status.md`.
- `git diff 482c261 b6e3454` touches nothing in `apps/api/src/utils`, `packages/`, `tests/permissions`, `apps/web`, `work-item/index.ts` or `work-item/response.ts`. This review note from the first pass is unchanged. So authz, the matrix and the web client are unchanged since the first pass.
- The fix touches `list-query.ts`, `controllers/list-work-items.ts`, `schema.ts`, the new `date-bounds.ts`, and `work-item-list-sort-pagination.test.ts`.

### What I probed

Two private DBs on td-lane-pg, both dropped afterwards: `pr320_opus_delta_test` for the suites and `pr320_opus_delta_probe_test` for the probes. The scratch probe file (`tests/api-integration/zz-opus-delta-320.test.ts`) ran over real HTTP through `createApp()` and is not committed.

1. **Suites at this head.** All green:
   - API unit: **55 files, 441 tests**.
   - `test:permissions`: **10 files, 80 tests**.
   - Integration: **80 files, 1115 tests**.
   - Web: **63 files, 278 tests**.
   - `node --test 'scripts/ci/**/*.test.mjs'`: **495 tests, 88 suites, 0 fail**.
2. **S1 walks.** For every sort field × both directions × `limit` 1, 2 and 3, I compared a cursor walk against the unpaged `limit=200` order, requiring identical order, no duplicates and termination.
   - (a) A mixed set of 9 items: due dates exactly `1900-01-01T00:00:00.000Z` and `9999-12-31T23:59:59.999Z`, three identical mid dates, and four nulls; title and priority ties; `limit=1` crossing from the non-null bucket into the null one. **All 24 walks passed.**
   - (b) Every row with a null due date and an identical title. **All 24 walks passed.**
   - My original repro (`dueDate asc`, `limit=1`, three nulls) now terminates with each row exactly once.
   - The lane's second fix is also correct. The `id` tie-break is now always `id > cursor.id`, which matches `ORDER BY …, id ASC` in both directions.
3. **The OR-expansion. Values are parameterised, but the expression is not parenthesised, and it escapes the tenant scope.** See **D0**.
   - Every value is a drizzle-bound parameter (`$n`). The operator and `asc`/`desc` are fixed fragments chosen by an enum branch. There is no string interpolation.
   - But `nonDueDateCursorCondition` (`list-query.ts:331`) and `dueDateCursorCondition` (`list-query.ts:366`) each return a bare `A or B`, with no outer parentheses. Drizzle's `and()` joins its arguments with ` and ` and does **not** wrap each one.
   - Rendered through `PgDialect.sqlToQuery` from the real functions:
     ```
     ("work_item"."project_id" = $1 and ("work_item"."number" > $2) or ("work_item"."number" = $3 and "work_item"."id" > $4))
     ("work_item"."project_id" = $1 and (case when "work_item"."due_date" is null then 1 else 0 end = 1) or (case ... = 0 and (...)))
     ```
   - Because SQL `AND` binds tighter than `OR`, the second branch runs **without** the `project_id`/`workspace_id`/`archived_at`/`deleted_at` conditions.
   - The cursor is still bound to sort and direction: a cursor for `key/asc` sent with `dir=desc` gives 400, as does `isNull: true` on a non-`dueDate` sort.
   - A forged `isNull: true` with `v: null` on `dueDate` narrows to the null bucket after that id (200). A forged `isNull: false` with `v: null` gives 400. A forged `isNull` can only skip rows in the caller's own walk. I originally concluded it can't widen, because the clause is ANDed onto the project and workspace scope. **That is wrong. See D0.**
   - SQL-injection strings in `v` and `id` returned 200 with 0 rows, as before.
4. **S2, re-running my wrong-type probes.** Every original case is now **400** with a `cursor: …` message:
   - `key`: `v` = `"abc"`, `2^40`, `1.5`, `1e400`;
   - `priority`: `"zzz"`, `0`, and `-1` on `asc`;
   - `title`: `v` = `5`, and a NUL inside `v`;
   - `dueDate`: `"not-a-date"`, `"NaN"`, `"-infinity"`, `1e20`, `1899-12-31T23:59:59.999Z`, `+010000-…`;
   - a NUL in `id`, `id` longer than 64 characters, `isNull` missing or a string, an array payload.

   **Residual:** `Date.parse` is laxer than Postgres. See **D1**.
5. **S3.** An item pointed by direct SQL at a person in another organisation and workspace: the string `Secret Foreign Person` appears **nowhere** in the response, including with `assignee=<that person id>`. The row still comes back, with `assigneeId` set and `assigneeName: null`.
   - A same-workspace colleague resolves to their name. After their `workspace_member` row is deleted, they resolve to `null`, even though they are still a member of another workspace.
   - The web list renders `assigneeId` set with `assigneeName` null as "(inactive)", which matches `work-items.md:201` ("Assignee leaves … shown as '(inactive)'. Not silently unassigned").
   - **Residual:** a duplicate `workspace_member` row fans out the join. See **D2**.
6. **Performance.** 100,000 live items in one project, half of them assigned. I ran `EXPLAIN ANALYZE` on the old and new query shapes over the same data, `limit 201`:
   - `title`/`priority`/`dueDate` first page: old shape about 76 ms, new about 95–107 ms. The added `workspace_member` join costs about 25%. The new `dueDate` ORDER BY is no worse than the old `coalesce`.
   - `key` first page: 1.1 ms in both.
   - **`key` deep page: old 0.7 ms, new 24 ms at number 50,000 and 38 ms at 99,000.** See **D3**.
   - `count(*)`: 28 ms, unchanged.

### Delta findings

**D0 — BLOCKING (a cross-tenant leak, introduced by this fix). A cursor page returns work items from any project in any workspace, including archived and deleted ones.**

- **Where:**
  - `apps/api/src/work-item/list-query.ts:331` returns `sql\`(${primary} ${op} ${cursor.v}) or (${primary} = ${cursor.v} and id > ${cursor.id})\``.
  - `list-query.ts:366` has the same shape for `dueDate`: `(isNull = 1) or (isNull = 0 and (...))`.
  - Both are pushed into `pageConditions` and combined with `.where(and(...pageConditions))` at `controllers/list-work-items.ts:213`. Drizzle's `and()` does not parenthesise its children, so the SQL becomes `project_id = $1 AND workspace_id = $2 AND archived_at IS NULL AND deleted_at IS NULL AND (X) OR (Y)`.
  - `(Y)` is evaluated against **every row in `work_item`**.
- **The cursor needs no forging. An ordinary "next page" leaks.**
- **Minimal live repro** (real HTTP through `createApp()`, two unrelated workspaces):
  1. The victim, a member of workspace V, creates two items: "VICTIM SECRET TITLE dated" (due 2027-06-01) and "VICTIM SECRET TITLE key1".
  2. The attacker, a member of an unrelated workspace A only, creates three items in their own project.
  3. The attacker calls `GET /api/projects/<A project>/work-items?sort=<s>&dir=<d>&limit=1` and follows the returned `nextCursor` unchanged with `limit=50`.

  Results:

  | sort/dir | page 2 titles | victim data leaked |
  | --- | --- | --- |
  | `dueDate/asc` | mine-2, mine-3, **VICTIM SECRET TITLE dated** | yes. The `isNull = 1` branch matches every null-due row in the instance, and the date branch every later-dated row |
  | `key/asc` | **VICTIM SECRET TITLE dated**, mine-2, mine-3 | yes. `number = v AND id > …` matches another project's item with the same number |
  | `priority/asc` | **VICTIM SECRET TITLE key1**, mine-1, **VICTIM SECRET TITLE dated**, mine-3 | yes |
  | `dueDate/desc`, `key/desc`, `title/asc` | own rows only | not with this data, but the same shape |

- The leaked rows carry full `work_item` columns (title, description, key, ids) plus resolved `stateName`. A forged cursor makes it trivial to enumerate the whole instance, e.g. `dueDate` with `isNull: false` and the `isNull = 1` branch, or `key` with `v` set to any number and `id: ""`.
- `meta.total` is unaffected, because the count query has no cursor clause.
- The first-pass code used a single row-value comparison with no top-level `OR`, so **this regression was introduced by the S1 fix.** The PR's own cross-project replay test didn't catch it because of how the fixture data happened to fall, not because the mechanism holds.
- **Fix:**
  - Parenthesise both returned expressions, e.g. `sql\`((...) or (...))\``. Better, build them with drizzle's `or()`/`and()` helpers, which do wrap.
  - Add a regression test with **two workspaces**, where the victim has a null due date and a colliding `number`, walking every sort and direction with `limit=1` and asserting that no foreign id appears.
  - The existing replay test should also be made deterministic.

**S1 — CLOSED** for walk correctness, for every value the API can write, but the fix itself introduced D0. **S2 — CLOSED** for every probe in the first pass. **S3 — CLOSED.**

**D1 — NON-BLOCKING. A forged `dueDate` cursor can still give a 500 through date strings that `Date.parse` accepts and Postgres rejects.**
- `list-query.ts:287` validates with `Date.parse`.
- These values give **500** with the generic body, with no leak:
  - `"2026"` (year only);
  - `"2026-02-31T00:00:00Z"`, a rollover that `Date.parse` normalises but `::timestamp` rejects;
  - `new Date().toString()` output.
- `"Thu, 01 Jan 2026 00:00:00 GMT"`, `"1/2/2026"` and `"2026-01-01T05:00:00+05:00"` are accepted (200). For the last one, `::timestamp` drops the offset. That only distorts the forger's own walk.
- Only a hand-forged cursor reaches this; the server itself only emits `toISOString()` output.
- **Fix:** require `new Date(v).toISOString() === v`, i.e. exactly the form the server emits.

**D2 — NON-BLOCKING. The new `workspace_member` LEFT JOIN (`controllers/list-work-items.ts:206`) can duplicate a work item in `data`.**
- `workspace_member` has no unique `(workspace_id, user_id)`; #88 closed the reachable path, but no constraint exists.
- With two membership rows for the assignee, the page returned the same item twice, `total: 2` against 3 rows in `data`, and `limit` counted the duplicate.
- A `limit=1` walk happened to dedupe itself, because `id > cursor.id` skips the twin.
- Only corrupt or legacy data triggers it.
- **Fix:** replace the join with `exists (select 1 from workspace_member …)`, which cannot fan out.

**D3 — NON-BLOCKING (performance). The OR-expansion lost the index range condition on `key` deep pages.**
- The old row-value compare `(number, id) > (v, id)` gave `Index Cond: number >= v`.
- `number > v OR (number = v AND id > …)` is applied only as a filter after `work_item_project_number_unique` scans from the start of the project. Cost is now linear in page depth: 24–38 ms at 50k–99k versus 0.7 ms.
- A full walk of a 100k-item project at `limit=200` costs about 10 s of database time in total, versus about 0.35 s.
- Still bounded to one project and to authenticated `work_item:read` callers, so acceptable for P1.
- **Fix:** add the redundant leading bound `number >= v AND (…)`, and likewise `due_date >= v`/`<=` inside the non-null `dueDate` branch, so the planner keeps the range.

**D4 — NON-BLOCKING (latent). Sub-millisecond due dates still break the `dueDate` walk.**
- The cursor stores `toISOString()`, which is millisecond precision. Postgres `timestamp` keeps microseconds.
- With four rows at `2026-10-01 12:00:00.123456` written by direct SQL, `asc`/`limit=1` returned **the same row for all 200 pages**, and `desc` returned **1 of the 4 rows** and stopped.
- The API itself can't write such a value: `workItemDateTime` transforms to a JS `Date`, which truncates to milliseconds, and it is the only writer of `work_item.due_date`. So this is latent, for a future importer, SQL backfill or `now()`-based writer.
- **Fix:** compare and sort on `date_trunc('milliseconds', due_date)`, or add a CHECK constraint `due_date = date_trunc('milliseconds', due_date)`.

### Delta verdict

**CHANGES NEEDED** at `b6e3454caa1598ce1a1be0010078f410557db444`, for **D0**, a BLOCKING cross-tenant disclosure.
- Any authenticated workspace member who follows an unmodified `nextCursor` can read other workspaces' work items, including archived and deleted ones.
- The fix is a pair of parentheses plus a two-workspace regression test.
- S1, S2 and S3 are otherwise correctly fixed.
- D1–D4 are non-blocking. D1 and D3 can go in the same fix-up.
- After the fix, a narrow delta pass is needed on `list-query.ts` and its test, with the rendered SQL checked.

## Re-review after D0 fix (Opus 5.5)

**Reviewer:** Opus 5.5, a fresh, independent context. I did not author, direct or remediate the fix, and I am not the ordinary reviewer. This pass follows decision-log PR #366: every clearance is redone at the new head.
**Reviewed head:** `2403374b80b8b0bd3518d60ece1740715d509ef2`
**Date:** 2026-09-24

### Head verification

- `git fetch origin pull/320/head` → `2403374b80b8b0bd3518d60ece1740715d509ef2`. `origin/feat/310-work-item-list-api` is the same SHA.
- First-parent chain since the delta review:
  - `d6c0243`, the delta note;
  - `ace3a85`, a merge of `origin/main` at `3c31081`;
  - `92d8989`, the D0 fix and its test;
  - `2403374`, the regenerated `openapi.json`.
- The only change to `list-query.ts` since `b6e3454` is `92d8989`'s outer parentheses and comments.

### What I probed

One private DB, `op320_test` on td-lane-pg, dropped afterwards. My scratch probe (`tests/api-integration/zz-opus-320b.test.ts`) ran over real HTTP through `createApp()`. It is not committed.

**1. D0: the code fix is correct and complete.**
- Both cursor functions now return one parenthesised term:
  - `nonDueDateCursorCondition` → `((primary op v) or (primary = v and id > cid))`;
  - `dueDateCursorCondition`, real-date branch → `((isNull = 1) or (isNull = 0 and ((due op d) or (due = d and id > cid))))`;
  - its null-bucket branch → `(isNull = 1 and id > cid)`.
- `primary` is a column or a `CASE … END`, so it is atomic. The parentheses balance.
- I grepped every `sql` fragment in `list-query.ts` and `controllers/list-work-items.ts`. The only other raw fragments are:
  - `sql\`false\`` for `assignee=me`;
  - `count(*)::int`;
  - the ORDER BY terms;
  - the `CASE` expressions.
- No other raw `or` sits inside `and()`. There is no free-text search filter. The state, priority, `due_before` and assignee filters are all drizzle `inArray`/`lt`/`eq`/`isNull`.
- **The original live repro, rerun.** Victim workspace V holds:
  - an item due 2027-06-01;
  - an item due 1900-01-01;
  - a null-due item;
  - number collisions with the attacker's items;
  - an archived item and a deleted item.

  Attacker workspace A holds three items (one dated, one with a null priority) and one archived item of its own. For each of the 4 sorts × 2 directions, the attacker fetched `limit=1` and followed `nextCursor` unchanged with `limit=50`, then did a full `limit=1` walk.
  - Every page contained only the attacker's own live rows. The string `VICTIM` never appeared in any body.
  - Every walk returned exactly the attacker's 3 live items, with no duplicates.
- **Forged cursors.** I sent 116 forged cursors across both directions:
  - `key`: `v` ∈ {−2³¹, 0, 1, 2, 3, 2³¹−1}, × `id` ∈ {`"0"`, `"~~~~"`, a victim id};
  - `title`: `"\u0001"`, `"A"`, `"VICTIM"`, 500×`"￿"`;
  - `priority`: every rank from −1 to 6;
  - `dueDate`: `isNull: true` with `id` ∈ {`"0"`, `"~"`, the victim's null-due id}, and `isNull: false` with `v` ∈ {1900-01-01, 2026-10-01, 2027-06-01, 9999-12-31T23:59:59.999Z};
  - mismatched `isNull`/`v` pairs, and SQL-injection strings in `v` and `id`.

  Results:
  - 92 returned 200, and **every row belonged to the attacker's own project**, never archived or deleted.
  - 24 returned 400: the out-of-domain priority ranks, mismatched `isNull`, string `v` for `key`, and 500×`￿`.
  - None returned 500. None leaked.
- **Negative control.** With `list-query.ts` reverted to `92d8989^`, the same probe fails with `VICTIM` in the body.

**2. The regression test is only half real. See D5.**
- If both functions are reverted to unparenthesised, `#320 security review D0: cursor OR-clause scope escape (BLOCKING)` goes **red**: "expected … length of 5 but got 8". I restored the file afterwards.
- If only `nonDueDateCursorCondition` is reverted, the test goes **red**.
- If only `dueDateCursorCondition` is reverted, the test stays **green: 8 of 8 runs**. My probe goes red on the same revert.

**3. The merge `ace3a85` is correct.**
- `git show --remerge-diff ace3a85` shows conflict resolutions only.
- `response.ts` keeps both sides: #310's `workItemListItemSchema`/`workItemPageSchema`/`workItemListResponseSchema`, and main's `workItemTypeSchema`/`workItemTypeListSchema`.
- All 18 locale files have a byte-identical resolution (same hunk hash). Each keeps both the PR's `list.assigneeInactive` and main's `create.*` block.
- For `response.ts` and `de-DE.json`: diff(merge-base → PR parent) equals diff(main parent → merge), and diff(merge-base → main) equals diff(PR parent → merge). Nothing was dropped from either side.
- Every `i18n/*.json` file parses.
- `openapi.json` was regenerated in `2403374`, and `check:openapi` matches (107 operations).

**4. D1–D4 are unchanged and still non-blocking.**
- D1: `Date.parse` is still the only date validation.
- D2: the `workspace_member` LEFT JOIN is still present.
- D3: there is still no leading range bound.
- D4: there is still no millisecond truncation.
- `92d8989` changed none of them, and it added no new surface.

**5. Contract gate (`oasdiff` 1.32.1, the pinned binary, SHA-256 verified).**
- Against the merged base `3c31081`, `oasdiff breaking --fail-on WARN` gives exactly one error:
  ```
  1 changes: 1 error, 0 warning, 0 info
  error	[response-body-type-changed] at tests/api-contract/openapi.json
  	in API GET /projects/{projectId}/work-items
  		the response's body `type` changed from `array<object>` to `object` for status `200`
  ```
- **It masks nothing.** Once the body type changes, `oasdiff` stops comparing the item schema, so I compared it directly. The old array `items` and the new `data.items`:
  - no property was removed or changed, and no previously required property became optional;
  - three required properties were added: `stateName`, `stateCategory` and `assigneeName`;
  - `page`/`meta` were added.
- Every other path, and every other method on this path, is byte-identical. The GET's response codes (200/400/401/403/404) are unchanged.
- In `components`, the only change is three **added** schemas (`WorkItemListResponse`, `WorkItemListItem`, `WorkItemPage`). The top-level document is otherwise identical.
- `oasdiff changelog` lists the same one error plus 12 infos: 8 new optional query parameters, 3 added required response properties, and `api-version-not-bumped`.
- **Against current `origin/main` (`c0bd99d`), `pnpm test:contract` gives 2 errors.** The second is `api-path-removed-without-deprecation GET /projects/{projectId}/assignable`. It appears only because #362 merged to main after this branch's last main merge. It is not a change this PR makes. See **CI** below.

**6. Suites at this head.** All green:
- Integration (`work-item-list-sort-pagination`, `work-item-create-read-list`, `existence-oracle-317`, `permissions-shadow-mode`): **4 files, 82 tests**.
- API unit: **58 files, 488 tests**.
- `test:permissions`: **10 files, 80 tests**.
- `check:openapi`: pass, 107 operations.

**CI at `2403374`.**
- CodeQL and both Analyze jobs passed.
- **The main CI workflow has not run.** GitHub reports the PR as `CONFLICTING` with `origin/main` (#362 landed at `c0bd99d`), and there are no build or test checks for this SHA.
- **GitGuardian failed** with "Generic Password" in `charts/taskdesk/values.yaml:245` at commit `ace3a85`. That line is `passwordKey: postgres_uri`, a Secret key *name* with no value. It came from main's `db27fd5` (#308) through the merge. The PR did not introduce it, and it is a false positive, but the check is red and has to be resolved or marked in GitGuardian.

### Findings

**D0 — CLOSED in code.** Verified live for every sort and direction, and with 116 forged cursors.

**D5 — BLOCKING (test only). The D0 regression test does not guard `dueDateCursorCondition`.**
- In the unparenthesised form `scope AND (isNull = 1) OR (isNull = 0 AND (…))`, the branch that escapes the scope is the **real-date** branch. The null-bucket branch stays scoped.
- The test's victim workspace has **no dated item**. Its only non-archived victim item is null-due, and the archived and deleted ones are null-due too. So the escaped branch never matches a victim row.
- The test comment says the null-due item exercises "the escaped null-bucket branch". That is backwards.
- Proven above: with only the `dueDate` parentheses removed, the test stays green in 8 of 8 runs.
- Half of a BLOCKING cross-tenant fix therefore has no regression guard. The next refactor of `dueDateCursorCondition` could reopen the leak silently.
- **Fix:**
  - Add at least one live victim item dated **after** every attacker date, e.g. `2027-06-01`, which catches `asc`. Add one dated **before** every attacker date, e.g. `1900-01-01`, which catches `desc`. Ideally also give the archived and deleted victim rows due dates.
  - Correct the comment.
  - Prove red by reverting **only** `dueDateCursorCondition`'s outer parentheses, and record that in the commit.

**D1–D4 — unchanged, NON-BLOCKING,** as recorded in the delta review.

**Process, not a code finding.** The branch must merge `origin/main` again (#362), regenerate `openapi.json`, and get a green CI run. GitGuardian's false positive on main's `values.yaml` must be cleared. Each of these changes the SHA, so this clearance has to be redone at that head.

### Verdict

**CHANGES NEEDED** at `2403374b80b8b0bd3518d60ece1740715d509ef2`, for **D5** (test only).
- **The D0 leak itself is fixed**: the code at this head does not leak across tenants through any real or forged cursor I could build.
- The merge resolution is correct.
- The contract break is exactly #310's intentional envelope and masks nothing.
- The next pass can be narrow:
  - the D5 test change, proven red against a `dueDate`-only revert;
  - the main merge, checked with `--remerge-diff`;
  - `oasdiff` against the new base;
  - a green CI run at the exact head.

## Final review (Opus 5.5)

**Reviewer:** Opus 5.5, a fresh, independent context, the same reviewer as the D0 re-review. I did not author, direct or remediate any of this PR's code or tests, and I am not the ordinary reviewer.
**Reviewed head:** `16f75ebff72632b4b71d0c67d89d76a0964f96e5`
**Date:** 2026-09-25

### Head verification

- `git fetch origin pull/320/head` → `16f75ebff72632b4b71d0c67d89d76a0964f96e5`. `origin/feat/310-work-item-list-api` is the same SHA.
- `origin/main` (`6b0d861`) is an ancestor of this head.
- First-parent chain since `2403374`:
  - `f26c885`, my re-review note;
  - `e7efd48`, the D5 test fix;
  - `c0b4666`, a merge of main (#362);
  - `1bf3865`, a merge of main (#367, #331 and others);
  - `16f75eb`, the allowlist entry.
- `list-query.ts`, `controllers/list-work-items.ts`, `work-item/schema.ts` and `database/schema.ts` are byte-identical to `2403374`.
- Compared with `origin/main`, the PR's server-side footprint is:
  - `list-query.ts`, `list-work-items.ts`, `date-bounds.ts`, `schema.ts`, `response.ts` and `index.ts`;
  - `openapi.json` and the allowlist.
- The list route's middleware (`workspaceAccess.fromProject` plus `requireWorkspaceCapability("work_item:read")`) is unchanged from main.

### What I checked

Private DB `opf320_test` on td-lane-pg, dropped afterwards. The scratch probe is not committed.

**1. D5 is closed. I verified it myself.**
- With only `dueDateCursorCondition`'s outer parentheses removed, the D0 test is **red in 3 of 3 runs** ("length of 5 but got 7").
- With only `nonDueDateCursorCondition`'s parentheses removed, it is **red in 3 of 3 runs** (7 and 8).
- With both restored, it is **green**.
- `e7efd48` adds victim items dated `2027-06-01` and `1900-01-01`. It also dates the archived and deleted victim rows, and corrects the "escaped null-bucket branch" comment.
- **Nit, non-blocking:** the new comment still says the null-bucket clause `(isNullExpr = 1 and id > cursor.id)` could escape. That clause has no `or` and was always parenthesised, so it cannot. The comment is inaccurate; the test is correct.

**2. D0 is still closed. I reran the live repro and the forged cursors at this head.**
- The data was the same as in my re-review: victim items due 2027-06-01 and 1900-01-01, a null-due item, colliding numbers, and an archived and a deleted item; plus an archived item in the attacker's own project.
- 4 sorts × 2 directions, `limit=1`, following `nextCursor` with `limit=50`, plus full `limit=1` walks: only the attacker's 3 live rows every time, and `VICTIM` never appeared.
- 116 forged cursors: **92 returned 200 with only the attacker's own live rows, 24 returned 400, 0 returned 500, and none leaked.**
- With `list-query.ts` reverted to `92d8989^`, the probe goes red with `VICTIM` in the body.

**3. The allowlist entry is exact and minimal.**
- Pinned `oasdiff` 1.32.1 (SHA-256 verified), `breaking --fail-on WARN --format json origin/main:… HEAD:…`, gives exactly one finding:
  ```
  [{"id":"response-body-type-changed","text":"the response's body `type` changed from `array<object>` to `object` for status `200`","level":3,"operation":"GET","operationId":"listWorkItems","path":"/projects/{projectId}/work-items","section":"paths","fingerprint":"3bb2531394ee"}]
  ```
- The entry's `operation`, `rule` and `fingerprint` match that finding exactly: `GET /projects/{projectId}/work-items`, `response-body-type-changed`, `3bb2531394ee`.
- `origin/main`'s allowlist is `[]`, so this is a new entry. It is the file's only entry.
- It has exactly the six keys `parseApprovedBreaks` requires: `operation`, `rule`, `fingerprint`, `pr`, `reason`, `decision`.
- `partitionApprovedBreaks` matches on the full (operation, rule, fingerprint) triple and fails on any unused entry. So this entry cannot cover any other finding, and it is the minimum approval.
- `pnpm test:contract` prints `approved break: response-body-type-changed GET /projects/{projectId}/work-items` and `oasdiff: no unapproved breaking API changes against origin/main (1 approved).`, and exits 0.
- **It masks nothing. I compared the specs directly against `origin/main`:**
  - The old array `items` against the new `data.items`: no property was removed or changed, and no previously required property was dropped. Three required properties were added: `stateName`, `stateCategory` and `assigneeName`.
  - Every existing query parameter was kept. The 8 new ones are all optional.
  - The response codes (200/400/401/403/404) are unchanged.
  - Every other path, and every other method on this path, is byte-identical. The only change in the GET's metadata is `description`.
  - In `components`, the only change is three **added** schemas. The top-level document is otherwise identical.

**4. Both merges are correct.**
- `c0b4666`: `--remerge-diff` shows one conflict hunk, the import list in `work-item/index.ts`.
  - The resolution keeps main's `assignablePeopleSchema` and the PR's `workItemListResponseSchema`, and drops `workItemListSchema`, which the PR had already replaced and which `index.ts` no longer uses.
  - For `index.ts`, `response.ts` and `openapi.json`: diff(merge-base → PR parent) equals diff(main parent → merge), and diff(merge-base → main) equals diff(PR parent → merge). Nothing was dropped from either side.
- `1bf3865`: the `--remerge-diff` is empty, so it is a clean merge with no manual edits.
- `check:openapi` matches (108 operations).

**5. D1–D4 are unchanged and still non-blocking.** The code they concern is byte-identical to `2403374`, and nothing new was added to the surface.

**6. Suites at this head.** All green:
- Integration, list files (`work-item-list-sort-pagination`, `work-item-create-read-list`, `existence-oracle-317`, `permissions-shadow-mode`): **4 files, 82 tests**.
- Integration, full: **88 files, 1212 tests**.
- API unit: **58 files, 488 tests**.
- `test:permissions`: **10 files, 80 tests**.
- `node --test 'scripts/ci/**/*.test.mjs'`: **543 tests, 89 suites, 0 fail**.
- `check:openapi`: pass, 108 operations.
- `test:contract`: pass, 1 approved break.

**CI at `16f75eb`.**
- The PR is `MERGEABLE`.
- 14 of the 15 required checks passed, including:
  - `integration - Postgres 18`;
  - `contract - OpenAPI drift`;
  - `route policy coverage + permission matrix`;
  - `gate checkers + red probes`;
  - `supply chain - secret scan`.
- The one required check still failing is `pull request template + security review`, for two reasons:
  - this note was stale at `2403374`, which this section fixes because a note-only commit follows the reviewed head;
  - the PR body's "Opus security review completed" checklist box is unticked. That box belongs to the orchestrator.
- Two checks are failing but not required:
  - `GitGuardian Security Checks`: the same false positive as before. `charts/taskdesk/values.yaml:245` `passwordKey: postgres_uri` is a Secret key name brought in from main's #308. The PR did not introduce it.
  - `github-advanced-security`: the Copilot autofind agent job, which also failed at `2403374`. It is not a code-scanning alert; CodeQL reports no new alerts.

### Verdict

**APPROVED** at `16f75ebff72632b4b71d0c67d89d76a0964f96e5`.
- D0 is closed, and the regression test now guards both cursor functions (D5 closed).
- S1–S3 remain closed.
- D1–D4 remain non-blocking follow-ups.
- The only contract break is #310's intentional envelope. It is approved by one exact, minimal allowlist entry that masks nothing.
- This clearance covers this head plus note-only commits. Any other commit needs a fresh delta review.

## Merge-head attestation (Opus 5.5) — after #364 merged

**Reviewed head:** `2dae509e907542bc1a894a87b1a1fe2c5f09c389`

This is a fresh Opus 5.5 context, 2026-09-25. It attests the `gh pr update-branch` merge of
`main` at `d6a9643ffcbcf4d2359dab5ba6e590340aeb59c5` (#364, the audit writer and the event-key
registry in `apps/api/src/{audit,events}`) into `d545db6`. `d545db6` is the Opus note over the
final-reviewed code head `16f75eb`, and it changed only this file. `6b0d861..d6a9643` is that
one merge.

- **Parents:** exactly (`d545db6`, `d6a9643`). `git show --remerge-diff` is empty, so the
  merge was clean with no manual resolution. It is the only commit not on `main`.
- **PR change unchanged:** `git diff 6b0d861 d545db6` and `git diff d6a9643 2dae509` are
  byte-identical (same sha256), and no file overlaps with #364.
- **Interaction with #364:** none. The list route is read-only: it emits no event and writes
  no audit row.
- **Allowlist:** `scripts/ci/openapi-approved-breaks.json` on `main@d6a9643` is still `[]`.
  At `2dae509` it holds exactly one entry: `GET /projects/{projectId}/work-items`,
  `response-body-type-changed`, fingerprint `3bb2531394ee`, pr 320. So it is new relative to
  `origin/main`.
- **Commands at `2dae509`** (packages built first; private DB `att320_test`, dropped
  afterwards):
  - `pnpm check:openapi`: "matches the API (108 operations)".
  - `pnpm test:contract` exits 0. Redocly reports 16 findings, the same 16 as `origin/main`.
    oasdiff 1.32.1 was verified and reports "approved break: response-body-type-changed GET
    /projects/{projectId}/work-items" and "no unapproved breaking API changes against
    origin/main (1 approved)".
  - `apps/api test:unit` passes 59 files / 490 tests.
  - `tests/api-integration/work-item-list-sort-pagination.test.ts` passes 1 / 32.

**Verdict at `2dae509e907542bc1a894a87b1a1fe2c5f09c389`: CLEAR.** The final review's findings
carry over unchanged.
