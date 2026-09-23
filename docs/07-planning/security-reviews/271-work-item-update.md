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
