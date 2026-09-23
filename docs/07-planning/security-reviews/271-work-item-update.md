# Security review — #23 work-item update (`PATCH /api/work-items/{key}`, second slice)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed SHA:** `c80d1948c1e843819953fa375c61fb79084c6b42`
**Branch:** `feat/23-work-item-update`
**Pull request:** #271
**Date:** 2026-09-23

## Surfaces examined

- `apps/api/src/work-item/{controllers/update-work-item.ts,index.ts,policy.ts,response.ts,schema.ts}`
- `apps/api/src/utils/require-workspace-capability.ts` (refactor: `assertCallerHasCapability` extracted)
- Shared dependencies reached: `work-item/require-work-item-reach.ts`, `utils/validate-workspace-access.ts`,
  `utils/require-workspace-permission.ts` (for API-key scoping comparison), `database/schema.ts` (`work_item`),
  `packages/permissions` (`work_item:update` / `work_item:set_priority`), `docs/01-architecture/rbac.md:50-66`,
  `docs/03-features/work-items.md`, issue #202 / PR #204 (soft-delete freeze sweep).
- `tests/api-integration/work-item-update.test.ts`, `tests/permissions/matrix.fixture.json`, `tests/api-contract/openapi.json`.

---

## Verdict

**CHANGES NEEDED — one BLOCKING finding (S1).**

The authorization core of this route is sound, and I tried to break it rather than re-confirm
it: no cross-tenant write, no existence oracle, no mass assignment, no version leak to an
unauthorized caller, and the `require-workspace-capability.ts` refactor is behaviour-preserving
(sections 1–6 below). What blocks is a lifecycle hole: **a soft-deleted project's work items stay
fully editable through this new write route**, contradicting the freeze invariant issue #202 /
PR #204 established and Opus-verified for every route whose subject resolves to a project — and
contradicting this route's own sibling, `POST /api/projects/{projectId}/work-items`, which
already refuses a soft-deleted project. The fix is a one-join change with a regression test.

| # | Severity | Summary |
| --- | --- | --- |
| S1 | **BLOCKING** | `PATCH` edits work items in a soft-deleted project (breaks the #202 freeze) |
| S2 | NON-BLOCKING | Same gap on `GET /api/work-items/{key}` and `GET /api/projects/{id}/work-items` (pre-existing, #261) |
| S3 | NON-BLOCKING | Out-of-range `startDate`/`dueDate` → 500 (new surface in this PR; same class as R1) |
| S4 | NON-BLOCKING | NUL (`\u0000`) in `title`/`description`, or a deeply nested `description` → 500 (pre-existing on create) |
| S5 | NON-BLOCKING | Soft-deleted / archived work item is editable (latent: nothing sets `work_item.deleted_at` yet) |
| S6 | NON-BLOCKING | `assertCallerHasCapability` trusts its `workspaceId` argument and ignores API-key scoping — safe here, a trap for later callers |

---

## S1 — A soft-deleted project's work items remain editable (BLOCKING)

**Where:** `apps/api/src/work-item/require-work-item-reach.ts:55-59` (key lookup with no
project join), consumed by the new route at `apps/api/src/work-item/index.ts:170-173`; the CAS in
`apps/api/src/work-item/controllers/update-work-item.ts:70-80` also has no project condition.

**Invariant broken.** #187 made project delete a soft delete; #202 (closed by PR #204, `d29325a`,
reviewed in `docs/07-planning/security-reviews/202-soft-delete-freeze-sweep.md`) then made
"deleted" mean *frozen* on every route whose subject resolves to a project — the project, its
columns, its tasks (see e.g. `task/index.ts:778-783`: "a task inside a soft-deleted project is
frozen for its project's 30-day recovery window"). `work_item` is the task's P1 successor and
belongs to exactly one project. This PR's own sibling already honours the freeze:
`create-work-item.ts:42` filters `isNull(projectTable.deletedAt)`.

**Reproduction (live, private DB `wi271_opus_test`, head `c80d194`):** a `member` creates work
item K in project P, then `project.deleted_at` is stamped (the column `delete-project.ts:32` sets):

| Request | Result |
| --- | --- |
| `GET /api/project/P` | **404** Project not found (frozen, correct) |
| `POST /api/projects/P/work-items` | **404** Project not found (frozen, correct) |
| `PATCH /api/work-items/K` `If-Match: "1"` `{"title":"edited in deleted project","priority":"urgent"}` | **200** — row now `title="edited in deleted project"`, `priority=urgent`, `version=2` |

**Impact.** Not cross-tenant and no authority escalation (same reach + capability gates). But a
deleted project is supposed to be immutable during its recovery window; anyone who still holds a
key (bookmark, notification link, API script) keeps silently mutating data the owner believes is
deleted and that no list view shows, and the eventual restore (#198) inherits edits nobody could
see. It is the exact lifecycle class #202 was opened and swept to close, re-opened by a new write
path — the kind of regression a sweep cannot catch after the fact.

**What would close it.** In `requireWorkItemReach`, inner-join `project` on
`work_item.project_id = project.id` and require `project.deleted_at IS NULL`, answering 404
(indistinguishable from "not there", consistent with F2). That closes PATCH *and* GET (S2) in one
place. To close the reach→UPDATE race too, add the same condition to the CAS (`AND EXISTS (SELECT
1 FROM project WHERE id = work_item.project_id AND deleted_at IS NULL)`); a zero-row result then
falls through to the existing scoped re-read, which should apply the same condition so it 404s
rather than reporting a 409. Regression test: soft-delete the project, assert PATCH → 404 and
the row unchanged.

---

## S2 — The same gap on the two read routes (NON-BLOCKING, pre-existing from #261)

Same probe, same state: `GET /api/work-items/K` → **200** with the full row;
`GET /api/projects/P/work-items` → **200** with the list (`workspaceAccess.fromProject` +
`list-work-items.ts:17-24` filter `work_item.deleted_at`/`archived_at` but never
`project.deleted_at`). Read-only, same tenant, so not blocking here; the GET half is fixed for free
by S1's reach-middleware fix, the list half needs its own `project.deleted_at` condition. Worth a
follow-up issue if not folded into the S1 fix.

---

## S3 — Out-of-range dates return 500 (NON-BLOCKING, new in this PR)

**Where:** `apps/api/src/work-item/schema.ts` — `startDate`/`dueDate: z.coerce.date().nullable().optional()`.
`work_item.start_date`/`due_date` are Postgres `timestamp` (range 4713 BC – 294276 AD), and a
JS `Date` beyond year 9999 serialises as `+010000-…`, which Postgres rejects. Every one of these
passes validation and then fails in the database:

| `startDate` | Result |
| --- | --- |
| `"-010000-01-01T00:00:00.000Z"` | 500 |
| `"+010000-01-01T00:00:00.000Z"` | 500 |
| `"+275760-09-13T00:00:00.000Z"` | 500 |
| `-8640000000000000` / `8640000000000000` (numbers) | 500 |
| `true` / `0` | **200**, stored as 1970-01-01 (coercion accepts non-date JSON types) |

The transaction rolls back cleanly and the global handler masks the error (`{"message":"Internal
Server Error"}`), so nothing leaks and nothing is half-written. It is precisely the class R1
(`If-Match` overflow) fixed in this same PR — a 500 where the route's contract is 400 — so it
belongs in the same fix: accept an ISO-8601 string only (`z.string().datetime()` → `Date`, or
`z.coerce.date()` with a `.refine` bounding the year to 1–9999). `startDate > dueDate` is also
accepted (200); I found no rule in `work-items.md` requiring ordering, so that is recorded, not a
finding.

---

## S4 — NUL bytes and deep nesting return 500 (NON-BLOCKING, pre-existing on create)

`{"title":"a\u0000b"}`, `{"description":{"t":"a\u0000b"}}` and `{"description":{"a\u0000":1}}`
all → 500 (Postgres `text` and `jsonb` reject `\u0000`). A 200,000-level nested array as
`description` (≈400 KB) → 500. Same clean rollback and masked body as S3. `createWorkItemBody`
has the identical exposure, and #261's F3 (unbounded `description`, no body-size limit) is still
open — this route widens that surface to every editor on every existing item. Recommend a
`.refine` rejecting `\u0000` in `title` and a size/depth bound on `description` (or the global
body limit F3 proposed), done once for both routes.

---

## S5 — Soft-deleted / archived work items are editable (NON-BLOCKING, latent)

With `work_item.deleted_at` stamped directly, `GET` and `PATCH` both return 200 and the edit
lands; same for `archived_at`. Latent: no route sets either column yet (no work-item delete or
archive endpoint exists). `rbac.md:58` puts archive under `work_item:update`, so editing an
archived item may well be intended; editing a soft-deleted one should not be (`WI-21`'s
30-day recovery window, same reasoning as S1). Recorded so the slice that adds work-item delete
also adds `work_item.deleted_at IS NULL` to `requireWorkItemReach` and the CAS.

---

## S6 — `assertCallerHasCapability`'s contract (NON-BLOCKING, hardening)

`apps/api/src/utils/require-workspace-capability.ts` — the extracted helper takes
`workspaceId` as a plain argument. Here it is safe: the handler passes `c.get("workspaceId")`,
which `requireWorkItemReach` sets unconditionally from the row (`require-work-item-reach.ts:75`)
after validating membership, overwriting anything set earlier; there is no `?workspaceId=`
fallback on this path, so issue #256 is **not** inherited. But a future field-level caller that
passes a body- or query-supplied `workspaceId` would check authority in workspace A and write in
workspace B (confused deputy); the helper does verify membership in whatever workspace it is
given, so it cannot grant a non-member anything, but it cannot tell that the id is the one being
written. Suggest one sentence in its doc comment: "`workspaceId` MUST be the row-derived id of the
resource being written, as set by a reach middleware — never request input."

Separately, like the middleware it was extracted from, it never reads `c.get("apiKey")`, whereas
`requireWorkspacePermission` (`require-workspace-permission.ts:89-92, 255-258`) enforces an API
key's own `permissions`. Latent today — nothing in this repository sets `apikey.permissions`
(the create-key dialog/hook send none) — but when scoped keys land (AK-7), every
`requireWorkspaceCapability`/`assertCallerHasCapability` route, this one included, will ignore
the scope. Pre-existing design, not introduced here; worth tracking with the API-key work.

---

## 1. Cross-tenant write and existence oracles — clear

A fresh workspace's `owner` (the strongest out-of-tenant caller) sent seven request variants
against the victim's real key and against a nonexistent key: valid body + correct `If-Match`;
stale `If-Match`; no `If-Match`; invalid body (`title:""`); empty body; `priority` only;
overflowing `If-Match`. **All 14 → `404 {"message":"Work item not found"}`, byte-identical**; the
victim row was unchanged (`title`, `priority`, `version=1`). This works because route
`middleware` (reach, then capability) runs before Hono's header/body validators, so no 400 can
distinguish an existing foreign key. `work_item_key_unique` is a global unique index, the reach
lookup matches `work_item.key` only (never `work_item_key_alias.old_key`), and the CAS and its
re-read are both scoped by the reach-derived `workspace_id`, so even a hypothetical key collision
could not direct the write into a workspace other than the one validated.

## 2. In-tenant callers without authority — clear, no version leak

`viewer` and `customer` in the victim's workspace: the same seven variants → **all 403
"Insufficient permissions"**, including the stale-version one. `currentVersion` is only ever
returned in a 409, which is reachable only after reach + `work_item:update` (+ `set_priority`
when `priority` is sent) have passed — i.e. to a caller who can already `GET` the row and its
`version`. Non-member instance admin: 403 on an existing key, 404 on a nonexistent one — the
same shape `GET /api/work-items/{key}` has had since #261 (the `validateWorkspaceAccess` admin
bypass), not introduced here; an existence signal to an instance operator is not a tenant leak.

## 3. `work_item:set_priority` — clear

Order is correct: route gate (`work_item:update`), then body validation, then the field gate,
then the write — a denied caller writes nothing. `priority: null` is `!== undefined` and so is
gated too. Mutation test: disabling the `if (priority !== undefined)` block makes the F-A
regression test fail (1 failed / 11 passed); restored. The test's `vi.mock` of `BUILT_IN_ROLES`
is genuinely consumed by `builtInRoleHasCapability` (that is why the mutation is caught).

## 4. Mass assignment and body shape — clear

Body `{title, version:999, stateId, workspaceId, projectId, key:"EVIL-1", deletedAt, archivedAt,
assigneeId, customerVisibility:"public", typeId, number}` → 200 with only `title` changed; the row's
`key`, `workspace_id`, `state_id`, `deleted_at`, `archived_at`, `customer_visibility`,
`assignee_id` were untouched and `version` went 1→2 (server-computed `version + 1`, never the
body's). Zod strips unknown keys before `.refine`, and the controller copies an explicit
allow-list. Array body / `null` body → 400; `{"__proto__":{…}}` → 400 (stripped, then "at least
one field"). **CSRF shape:** `content-type: text/plain` with a JSON payload → 400 (Hono's JSON
validator treats a non-JSON content type as an empty body), so a cross-site "simple request"
cannot write.

## 5. `If-Match` parsing — clear

`W/"2"`, `*`, `""`, `"2", "3"`, `0x2`, `2.0`, `-2`, `+2` → 400; `2 `/` 2` are trimmed by the HTTP
layer and behave as `2`; an unbalanced `2"` is accepted as `2` (harmless — digits are all that
reach the query). Overflow → 400 (R1's fix holds). All parameterised through drizzle; no SQL
string building.

## 6. The `require-workspace-capability.ts` refactor — clear

The diff moves the body of the middleware's check verbatim into `assertCallerHasCapability`
(same `workspaceMemberRoles` → `isUnambiguousMembership` → `builtInRoleHasCapability`
predicate, same 403); the middleware keeps its own missing-`workspaceId`/`userId` 403 guard in
front of it. No other file's call to `requireWorkspaceCapability` changed. Behaviour for every
existing caller is identical.

## Verification run

- Private DB `wi271_opus_test` on `td-lane-pg`; `pnpm install --frozen-lockfile` in a detached
  worktree at `c80d194`.
- All six `tests/api-integration/work-item*.test.ts` files: **6 files, 104/104 passed**.
- Throwaway probe file (`tests/api-integration/zz-opus-probe-271.test.ts`, not committed) for
  every table above; mutation test of the priority gate as in §3.

## What I did not do

- Did not run the full integration suite, `test:permissions`, typecheck or lint — the prior
  rounds report them and nothing in my findings depends on them.
- Did not re-audit `work_item_key_alias`/key-claim machinery beyond confirming the reach lookup
  never consults aliases; that surface belongs to #261's reviews.
- Did not test real Postgres-level concurrency beyond the PR's own race test (the CAS is a single
  `UPDATE … WHERE version = $n`; I found nothing to add).
- Did not push, comment on the PR, or commit this note.

---

# Delta-confirmation round (c142f3c)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change
(same reviewer as the round above; the fix round was written by another context).
**Reviewed SHA:** `c142f3c6441ab004b959e86ea90055fcebd9fceb` (confirmed via `gh pr view 271 --json headRefOid`).
**Delta reviewed:** `git diff c80d194 c142f3c`. `c7eb9fe` only adds the round-1 note, and it is
byte-identical to my copy. `c142f3c` touches `require-work-item-reach.ts`,
`controllers/update-work-item.ts`, `controllers/list-work-items.ts`, `schema.ts`, `index.ts`,
`require-workspace-capability.ts` (doc comment only), `openapi.json`, and two integration test files.
**Date:** 2026-09-23

## Verdict

**CLEAR WITH FINDINGS.** The blocking finding S1 is closed, and I proved it through the route and
directly against the controller. S2 and S6 are closed and S4 is closed for request bodies. S3 is
*narrowed but not closed*: new finding T1 gives three inputs that still 500, and T2 gives a range of
years that is accepted but read back wrong. Neither is a tenant or authority issue. Both are
non-blocking but cheap, and worth fixing in this PR since S3's fix claims them. T3 notes that the
new race test does not exercise the guard it is named for.

| Round-1 finding | Delta verdict |
| --- | --- |
| S1 (BLOCKING) | **Closed** |
| S2 | **Closed** |
| S3 | **Partially closed** — see T1, T2 |
| S4 | **Closed for body fields**; the path-param residual is pre-existing (T4) |
| S5 | Unchanged, latent, as recorded |
| S6 | **Closed** (doc comment says both things asked) |

| New | Severity | Summary |
| --- | --- | --- |
| T1 | NON-BLOCKING | Year `0000`, and a UTC offset that pushes a boundary date outside 1–9999, still return 500 |
| T2 | NON-BLOCKING | Years `0001`–`0099` are accepted, stored correctly, but read back as 1950–2049 |
| T3 | NON-BLOCKING | The "soft-deleted AFTER the reach check" test never reaches the CAS guard — removing it leaves 17/17 green |
| T4 | NON-BLOCKING (pre-existing) | NUL in a path parameter or in `typeId` still returns 500/503 |

## S1 — closed

- **The correlation is right.** Rendered SQL (via `.toSQL()`, the same expression):
  `update "work_item" set … where ("work_item"."key" = $3 and EXISTS (SELECT 1 FROM "project" WHERE
  "project"."id" = "work_item"."project_id" AND "project"."deleted_at" IS NULL))`. The subquery is
  tied to the row being updated, never to some other project.
- **The race is closed at the CAS, not only in middleware.** I soft-deleted the project, then
  called `updateWorkItem(key, workspaceId, 1, …)` directly, which skips reach entirely as a request
  would inside the window. Result: **404**, and the row is unchanged. With a stale version, the
  re-read's matching condition also gives **404**, not a 409. Under READ COMMITTED, a project
  delete that commits during the UPDATE orders as edit-then-delete. `delete-project` never locks
  `work_item` rows, so I found no interleaving that writes into a project that was already deleted
  when the statement started.
- **Delete then restore leaves nothing open.** Deleting the project gives GET 404, PATCH 404,
  stale PATCH 404 (no 409, so no version leak) and LIST 404. Clearing `deleted_at` restores
  PATCH 200 and LIST 200. Deleting a *sibling* project in the same workspace does not affect a
  live project's items (PATCH 200).
- **Live-project behaviour is unchanged.** `work_item.project_id` is NOT NULL with a foreign key,
  so the inner join can never drop a live row. Viewer: live GET 200, live PATCH 403. Other-tenant
  owner: live GET/PATCH 404. A deleted-project key and a nonexistent key give the same 404 for
  both callers. `requireWorkItemReach` has only these two callers (`index.ts:148,175`).

## S2 — closed

`listWorkItems` now calls `getProjectWorkspaceId(projectId)`
(`utils/assert-assignable-user.ts:60-82`, `project.deleted_at IS NULL`, else 404). Issue #256's
class does not apply: `workspaceAccess.fromProject` has **no** `?workspaceId=` fallback source
(`workspace-access-middleware.ts:298-301`, lookup only). Live probe: viewer on a deleted project
→ 404, including with `?workspaceId=`. Other-tenant owner on a live project, on a deleted project,
and with `?workspaceId=<own>` → 403 each time, the same as before this PR. A nonexistent project
→ 400, a pre-existing and distinct answer on a cuid2 id, not introduced here. The helper's
returned workspace id is discarded, but the list query is still scoped by both `project_id` and
the middleware's `workspace_id`, so nothing from another tenant can come back.

## S3 — partially closed

Closed: numbers and booleans (`0`, `true`) → 400; the extended-year strings from round 1 → 400;
date-only, missing seconds, space separator, month 13, `:60` seconds, bad offsets and 10-digit
fractions → 400. Valid input still works: `…Z`, `….000Z`, microseconds (truncated to ms), and
`+07:00` offsets (normalised to UTC) all → 200. `apps/web` has no work-item caller yet, so no
shipped client is broken. Responses are unchanged: `workItemSchema` still emits ISO strings, and
create accepts no dates. `openapi.json` swaps `format: date-time` for a `pattern`. That is
correct but loses the typed hint for generated clients, which is cosmetic.

### T1 — three shapes still 500 (NON-BLOCKING)

The regex checks for four digits; it does not check the range 1–9999 that the comment
promises. It also checks the year *as written*, before the offset is applied:

| `startDate` | Result |
| --- | --- |
| `"0000-01-01T00:00:00Z"` | **500** (Postgres has no year 0) |
| `"0001-01-01T00:00:00+14:00"` | **500** (UTC lands in year 0) |
| `"9999-12-31T23:59:59-14:00"` | **500** (UTC lands in year 10000, sent as `+010000-…`) |
| `"9999-12-31T23:59:59.999-23:59"` | **500** |

The rollback is clean and the error is masked, as in round 1. **Fix:** check the parsed `Date`'s
`getUTCFullYear()` inside the existing `.refine`, not the string. That closes all four, and T2
with it.

### T2 — years 1–99 are silently read back wrong (NON-BLOCKING, data integrity)

| Sent | `start_date::text` in DB | PATCH response / later GET |
| --- | --- | --- |
| `0049-06-01T00:00:00Z` | `0049-06-01 00:00:00` | **`2049-06-01`** |
| `0050-06-01T00:00:00Z` | `0050-06-01 00:00:00` | **`1950-06-01`** |
| `0099-06-01T00:00:00Z` | `0099-06-01 00:00:00` | **`1999-06-01`** |
| `0100-06-01T00:00:00Z` | `0100-06-01 00:00:00` | `0100-06-01` (correct) |

The database is right. The read path is wrong: drizzle's `timestamp` (mode `date`) mapper turns
`"0049-06-01 00:00:00"` back into a `Date` through V8's non-ISO parser, which treats two-digit-style
years as 1950–2049. That quirk is pre-existing and affects every `timestamp` column. This PR is
new in *advertising* years 1–99 as valid input on a user-writable field, so a client that sends
one gets back a different date than it sent, including in the 200 response. **Fix:** set the
lower bound well above 99 (for example, UTC year ≥ 1000, or 1900 for a service desk), in the same
`.refine` as T1.

Also noted, not a finding: JS `Date` rolls over impossible calendar dates rather than rejecting
them. `2026-02-31T00:00:00Z` is stored as 2026-03-03, and `T24:00:00Z` as the next day. The
`.refine` could round-trip-compare the date part if strictness is wanted.

## S4 — closed for body fields

A NUL (`\u0000`) in `title`, in a nested `description` value, in a `description` key, or as a bare
`description` string → 400 on update; a NUL in `title` → 400 on create. U+0001 and emoji still
pass (200). The recursive walk throws `RangeError` on a pathologically deep document. That is
still a masked 500, the same as round 1, which recorded it as #261 F3's territory. The process
stays healthy (a GET right after returns 200). No regression.

### T4 — residual NUL paths (NON-BLOCKING, pre-existing, not claimed)

`GET` and `PATCH /api/work-items/%00` → **500** (the reach lookup sends the NUL to Postgres).
`POST /api/projects/{id}/work-items` with a NUL in `typeId` → **500**.
`GET /api/projects/%00/work-items` → **503** "Could not verify workspace access" (the shared
middleware's lookup-error path). None of these is new in this PR or claimed by the fix. Recorded
so the eventual global answer (a NUL-rejecting param/body guard, or #261 F3's body middleware)
covers path parameters too.

## T3 — the race test does not test the race guard (NON-BLOCKING)

`work-item-update.test.ts`, test "S1: a project soft-deleted AFTER the reach check passes still
blocks the CAS write…", sends its second write through the HTTP route. The reach middleware
therefore returns 404 before the transaction runs. **Mutation:** with `projectNotDeleted` removed
from the CAS `WHERE`, `work-item-update.test.ts` still passes **17/17**. The guard works (I proved
that above by calling the controller directly), but nothing would catch its removal. **Fix:** in
that test, call `updateWorkItem(key, workspaceId, version, …)` directly after soft-deleting the
project, and assert 404 plus an unchanged row. Do this for both a current and a stale version, so
the re-read condition is pinned too. That is exactly the probe used above.

## S6 — closed

`require-workspace-capability.ts`'s new doc comment states both contracts: `workspaceId` must be
resolved by the server, never taken from request input, and API-key `permissions` are not
consulted. The code is unchanged.

## Other routes

The only other routes the delta touches are create (it gains the NUL refines, and valid bodies
are unaffected) and list (it gains a 404 for a deleted project, declared in `openapi.json`). No
other route imports the changed schema pieces or `requireWorkItemReach`. No new failure mode
reaches anything outside the work-item router.

## Verification run

- Private DB `wi271_opus2_test` on `td-lane-pg`; worktree detached at `c142f3c`.
- All six `tests/api-integration/work-item*.test.ts` files: **6 files, 112/112 passed**. This
  matches the fix round's claim.
- Throwaway probe file (not committed, now deleted) for every table above. It included direct
  `updateWorkItem` calls for the race and an SQL render of the CAS.
- Mutation test for T3; the file was restored and the worktree is clean apart from this note.

## What I did not do

- Did not re-run the full 641-test suite, `test:permissions`, typecheck or lint.
- Did not force a true two-connection interleaving of project delete against the UPDATE. I
  reasoned about it from READ COMMITTED semantics and the absence of any shared row lock, and
  proved the guard with a sequential direct call.
- Did not push, comment on the PR, or commit this note.
