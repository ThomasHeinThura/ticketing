# Security review — #271 follow-up: input bounds, NUL ids, CAS test (PR #277)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `6e93230d7409519c91cd13721f7583f0f574afd5`
**Reviewed SHA:** `6e93230d7409519c91cd13721f7583f0f574afd5` (confirmed via `gh pr view 277 --json headRefOid`)
**Pull request:** #277
**Date:** 2026-09-23
**Diff reviewed:** `git diff origin/main...6e93230`

## Surfaces examined

- `apps/api/src/utils/workspace-access-middleware.ts` (security scope; backs every
  `workspaceAccess.from*` route) — whole file, every source branch and every helper.
- `apps/api/src/work-item/require-work-item-reach.ts` (NUL key → 400).
- `apps/api/src/work-item/schema.ts` (`workItemDateTime`, `createWorkItemBody.typeId`,
  `projectIdParam`, `workItemKeyParam`).
- Reached, unchanged: `work-item/controllers/update-work-item.ts` (CAS + re-read),
  `work-item/response.ts`, `utils/validate-workspace-access.ts`, Hono's param/query decoding.
- Tests: `tests/api-integration/{work-item-update,work-item-create-read-list,task}.test.ts`,
  `tests/api/utils/workspace-access-middleware.test.ts`; `tests/api-contract/openapi.json`.
- Reference: `docs/07-planning/security-reviews/271-work-item-update.md` (delta round T1–T4),
  issue #256 (open).


## 1. The shared middleware — every source, every helper

Callers enumerated (`grep -rhoE "workspaceAccess\.from[A-Za-z]+\([^)]*\)" apps/api/src`, 38 files,
127 call sites): `fromProject` (31), `fromTask` (16), `fromTaskId` (21), `fromParam` (20),
`fromQuery` (9), `fromLabel` (7), `fromColumn` (4), `fromBody` (4), `fromWorkflowRule` (3),
`fromTasks` (3), `fromComment` (3), `fromActivity` (3), `fromTimeEntry` (2). No file builds its
own `workspaceAccessMiddleware({...})` config. (`get-work-item.ts:9` names a
`workspaceAccess.fromWorkItemKey()` that does not exist — a stale comment only.)

Source shapes: single-source (`query`, `body`, `param`, `lookup:project`, `lookupMany`) and the
eight `[lookup, query:workspaceId]` helpers. The NUL check now sits on **all five** branches
(`query` :85-89, `body` :93-97, `param` :99-103, `lookup` :112-119, `lookupMany` :127-132), and in
each case it runs **before** any database call and before the `break`/fall-through decision.

- **Fall-through on NUL:** closed. A NUL in the lookup id (path param or body) is a 400 at
  :113-119, before `lookupWorkspaceId` and before the loop can reach the `query` source.
  Confirmed through the real route by `task.test.ts` ("T4 follow-up") and in isolation by the
  middleware unit test (`lookedUpIds` stays empty, handler not reached).
- **Percent-decoding:** probed Hono directly (throwaway app, same `c.req.param`/`c.req.query`
  the middleware and handlers use). `%00` and `a%00b` decode to a real U+0000 and are caught.
  `%C0%80`, `%E0%80%80` (overlong NUL) and `%ED%A0%80` (encoded lone surrogate) are **not**
  decoded — Hono's `tryDecode` leaves invalid UTF-8 as the literal `%C0%80` text, which is a
  harmless string to Postgres (lookup misses). `%2500` decodes once to the literal `%00`, not NUL.
  A mixed `%ZZ%00` still decodes the valid `%00` and is caught. The check and the handler see the
  same decoded value, so there is no double-decode gap.
- **Other control characters / U+FFFF / lone surrogates:** Postgres `text` stores U+0001 and
  U+FFFF; `pg` encodes a lone JS surrogate as U+FFFD. None of them makes the query throw, so none
  reaches the 503 path or a fall-through that NUL did not already reach. They behave exactly like
  any other non-existent id.
- **Empty / whitespace:** `""` is `|| null` → absent (unchanged). `" "` (`?workspaceId=+`) is a
  non-empty string → looked up / validated like any id → no row → unchanged behaviour.
- **Repeated query params:** `c.req.query(k)` returns the first value; the check runs on that
  value, and that is also what `c.req.query` in any handler returns. A NUL in a *later* repeat
  is never used by either. A zod `query` validator sees the array and rejects it as a non-string.
- **JSON body types:** number / object / array / null for `workspaceId` or the lookup id →
  `typeof !== "string"` → absent, unchanged by this PR. `lookupMany` filters non-strings before
  the NUL check (unchanged), then rejects any string element containing NUL before its query.
- **Existence oracle:** none new. Every NUL 400 is decided on the input alone, before any
  database read, so it is the same answer for an existing and a non-existing resource. The one
  place where a NUL is only examined *after* a lookup is the `query` fallback in the eight
  `[lookup, query]` helpers (`/task/<id>?workspaceId=%00` is a 400 only when `<id>` resolves to no
  row). That distinguishes "exists" from "does not exist", but the same distinction already
  existed on `main` before this PR (a found-but-foreign id → 403 from `validateWorkspaceAccess`;
  an unfound id with no `workspaceId` → 400 "could not be determined"; with a NUL `workspaceId` →
  a 500), so it is issue #256's class, not a regression.
- **Other raw param reads outside this middleware** that still reach Postgres before validation
  (`task/controllers/require-task-permission.ts:82`, `utils/require-invitation-workspace-access.ts:26`,
  `task-relation/index.ts:74`, `index.ts:374/730/870`) are not touched and not claimed. Where
  they sit behind a `workspaceAccess.from*` guard, the guard now answers the NUL first.

## 2. Behaviour preservation for non-NUL input

The only behavioural change in the middleware is a new `throw` guarded by `hasNulByte(x)`; for
any value without U+0000 each branch assigns exactly what it assigned on `main` (`raw` equals the
old expression on every branch). No source order, fallback, or lookup query changed.

- Full integration suite on private DB `pr277_opus_test` (td-lane-pg): **70 files, 648/648 passed**.
- Unit suite (`vitest.config.ts`, includes the middleware unit test): **49 files, 336/336 passed**.
- **Mutation:** turning the `lookup` NUL check (`workspace-access-middleware.ts:113`) into
  `if (false)` makes `task.test.ts`'s T4 follow-up fail (got 503, expected 400), so the check is
  pinned through a real route.

## 3. Dates

Probed `updateWorkItemBody.safeParse({ startDate })` directly (throwaway unit file, deleted):

| Input | Result |
| --- | --- |
| `1900-01-01T00:00:00Z`, `9999-12-31T23:59:59.999Z`, `2024-02-29…Z` | accepted, exact instant |
| `1899-12-31T23:59:59.999Z`, `1900-01-01T00:30:00+01:00`, `1900-01-01T00:00:00+00:01` | 400 (instant < floor) |
| `1899-12-31T23:30:00-01:00` | accepted as `1900-01-01T00:30Z` — correct, the instant is in range |
| `9999-12-31T23:59:59-00:01`, `9999-12-31T22:00:00-02:00`, `0000-01-01…` | 400 |
| `9999-12-31T23:59:59.9995Z`, `.9999999Z` | accepted as `.999Z` — V8 truncates, never rounds past the ceiling |
| `2026-02-29`, `2026-02-31`, `T24:00:00`, `00:60:00`, month `13`/`00`, day `00` | 400 |
| `23:59:60Z` (leap second) | 400 (V8 returns NaN; Postgres would have rolled it to the next minute, so rejecting is the safe side) |
| `+99:99`, `+24:00` | 400 (NaN); `+23:59`, `-00:00` accepted and bounded on the instant |
| trailing `\n`, embedded NUL, lowercase `z`/`t`, Arabic-Indic digits | 400 (regex has no `m`/`u` flag; `\d` is ASCII only) |

- **DST:** only numeric offsets are accepted, never a zone name, so there is no DST-dependent
  interpretation. The calendar check deliberately uses the written wall-clock digits, and the
  bound uses the resolved instant; both are needed and both are applied.
- **Bypass of the UTC bound:** none found. The bound refine re-parses the same string with the
  same `new Date()` the `.transform` uses, so the checked value is the stored value.
- **Pre-1900 rows written under #271's 1–9999 window:** no regression.
  `update-work-item.ts:63-67` writes only fields that were supplied; untouched `startDate`/`dueDate`
  are neither re-validated nor rewritten, so a PATCH of `title` on such a row still succeeds. The
  old date can still be cleared with `null`. Only re-sending the old value is refused, which is the
  intended new rule. `createWorkItemBody` takes no dates, so create is unaffected.

## 4. The T3 test

`work-item-update.test.ts` "T3 …" calls `updateWorkItem` directly after soft-deleting the project,
with both the current and a stale version, and asserts 404 plus an unchanged row. **Mutations:**
- `projectNotDeleted` commented out of the CAS `WHERE` → T3 fails (19/20 pass).
- `isNull(projectTable.deletedAt)` commented out of the re-read → T3 fails (stale-version path
  would answer 409).

Both guards are now genuinely pinned. The worktree was restored after each mutation (`git diff` empty).

## Findings

### S1 — A unit test now asserts issue #256's fall-through as intended behaviour (NON-BLOCKING)

`tests/api/utils/workspace-access-middleware.test.ts:142`, "a well-formed lookup id still falls
through to ?workspaceId= exactly as before … proving the NUL fix didn't remove the fallback for
the case it's actually meant for". The fallback is not "meant" for anything: #256 (open) is the
defect report for exactly this behaviour (`/task/task-does-not-exist?workspaceId=workspace-mine`
→ 200 with the handler reached). As a regression guard for *this* PR the assertion is fine, but
the wording presents the defect as a contract, and the test will fail when #256 is fixed.
**Fix:** reword the title and comment to "pins current behaviour pending #256; invert when #256
closes". No code change needed.

### S2 — `workItemSchema` does not declare `startDate`/`dueDate` (NON-BLOCKING, pre-existing)

`apps/api/src/work-item/response.ts:3-36` has no `startDate`/`dueDate`, but the handlers return
the raw row (`work-item/index.ts:214-258`, `c.json(updated)`), and this PR's T2 test reads both
fields from the PATCH and GET responses. So the OpenAPI contract under-declares the response,
and the new test depends on an undeclared field. It is not a security issue; it is contract drift
that predates this PR. Add the two nullable timestamps to the schema in a later slice.

### S3 — Stale comment names a helper that does not exist (NON-BLOCKING, cosmetic)

`apps/api/src/work-item/controllers/get-work-item.ts:9` mentions
`workspaceAccess.fromWorkItemKey()`. There is no such helper. The route uses
`requireWorkItemReach`. Worth correcting so a reader auditing the middleware callers is not
sent looking for it.

## Verdict

**CLEAR WITH FINDINGS.** T1, T2, T3 and T4 are closed at this head. The middleware's NUL
handling fails closed on all five source branches, before any lookup and before any fall-through,
with no new existence signal. Behaviour for non-NUL input is unchanged, and the full suites are
green. S1–S3 are non-blocking.

## What I did not do

- Did not run typecheck, lint, `test:permissions`, `docker build`, or the web app's tests. I relied
  on the ordinary review for the web `.toISOString()` sends.
- Did not audit the raw pre-validation param reads outside the shared middleware (listed in §1)
  for NUL 500s. They are outside this PR's claim.
- Did not push, comment, merge or commit. This note is uncommitted in the review worktree.
