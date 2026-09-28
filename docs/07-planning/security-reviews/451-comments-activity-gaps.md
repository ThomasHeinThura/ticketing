# PR #451 — comments and canned-response routes (issue #27)

## Ordinary review (first pass, bug-finding)

**Model:** Claude Sonnet 5, fresh independent context
**Session:** subagent `a2da21125185e2fee`

**Verdict: NOT CLEAR.** `require-comment-reach.ts` never joined to `work_item`→`project`
to check `project.deletedAt IS NULL` (unlike the analogous `require-work-item-reach.ts`),
letting a workspace member edit/delete comments on a soft-deleted project's work items —
the same class of gap PR #433 already fixed for bulk work-item operations.

## Fix applied after review

Commit `bff331b` (worktree `/tmp/lane-27-build`, branch `feat/27-comments-activity-gaps`):
added the `commentTable`→`workItemTable`→`projectTable` join with
`isNull(projectTable.deletedAt)`, plus a regression test in
`tests/api-integration/work-item-comment.test.ts` (soft-delete a project, assert
PATCH/DELETE on its comments 404, assert the row is byte-for-byte unchanged — proven
fail-then-pass). The branch was then rebased/merged onto `main` past #432's hierarchy
routes (merge commit `d219c03`, auto-merged cleanly), and the permissions matrix fixture
regenerated for real (commit `b74a622`).

## Security review

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a0a8230f5ce9123d9`

**Reviewed head:** `b74a6225077e8068dd0b68ecfc8035e1273e190f`

**Verdict: CLEAR WITH FINDINGS on security grounds.** Live-verified the rename migration
(0073 `comment`→`task_comment`, 0074 new `comment`/`comment_version`/`canned_response`
tables) against a scratch database with pre-existing rows — all 3 rows survived
byte-for-byte, every renamed constraint/index/FK confirmed present with no `_1` collision
suffix, re-applying is a no-op. Live-verified the soft-deleted-project comment-freeze fix
(commit `bff331b`): PATCH/DELETE on a soft-deleted project's comments now 404, row
unchanged, no `comment_version` row written; fail-then-pass reproduced by reverting just
that file. Live-verified tenant scoping across canned responses and comments — cross-
tenant reads/writes correctly 403/404. Verified the merge with PR #432 preserved every
route and policy entry from both sides.

**Findings, none blocking on security:**
- MEDIUM — comments can still be written on a soft-deleted WORK ITEM itself (not just a
  soft-deleted project) — `require-work-item-reach.ts`/`require-comment-reach.ts` both
  check `project.deletedAt` but neither checks `workItemTable.deletedAt`, matching an
  existing, pre-PR gap pattern in this codebase (`update-work-item.ts`/`set-parent.ts`
  don't guard it either) — recommend a follow-up issue, not a blocker.
- LOW — `delete-comment.ts` returns the already-deleted row before its permission check,
  an ordering issue.
- LOW — raw DB rows reach the response (`deletedBy` leaks despite `comment-response.ts`
  omitting it from the schema).
- LOW — `{ body: null }` accepted on comment create.
- LOW — no committed migration-guard test for 0073's constraint renames (only verified by
  hand). **Closed** by a follow-up commit — see below.

**Merge gates not met at this head (process, not security):** `check:vocabulary` failed
(`task_comment` undocumented), `gate checkers + red probes` failed (hardcoded published-
event-key count stale, 29 vs the real 30), `unit + component` failed (a schema-drift test
timed out in CI at its 5s default, ~0.86s locally — flake, not a real regression), and the
PR-template gate itself (expected, pending this record). **All four closed** by the
orchestrating session, commit `56585f8`: documented `task_comment` in `data-model.md`
following the `task_activity`/migration-0066 precedent; bumped the event-key count 29→30;
pruned a stale, unrelated `workspace_role` baseline entry (`check:vocabulary --prune`);
bumped the schema-drift test's timeout to 20s with a `ponytail:` comment naming the
ceiling. Full suites re-verified clean after (permissions 13/83, `check:events` 30 keys,
`check:vocabulary` 66 tables, `node --test scripts/ci/**/*.test.mjs` 788/788).

Full suites reproduced by Opus at `b74a622`: integration 106 files/1375 tests, permissions
13/83, comment + canned-response suites 3 files/23 tests — all green. `tsc --noEmit` clean
on all three tsconfigs. `check-openapi.mjs` clean, 143 operations, no drift.

## Ordinary review (second pass, post-fix, post-gate-closure)

**Model:** Claude Sonnet 5, fresh independent context (direct reading, no `pal-mcp` — the
PR's authorship couldn't be confirmed independent of `coder`'s panel from the task
context available, so the prescribed Sonnet fallback was used instead, per this project's
own rule)
**Session:** subagent `a170cebd57718a45f` (`pal-reviewer` agent, ordinary-review tier)

**Reviewed head:** `56585f841ef64e064e9f6d78cc3b28cab1887e2a`

**Verdict: APPROVE WITH NOTES.** Confirmed all 5 of Opus's non-blocking findings
independently by reading source. Confirmed spec/doc alignment against
`docs/03-features/comments-and-activity.md` (CA-1, CA-4, CA-6/CA-7, CA-11, CA-17, CA-18,
CA-19, CA-20) and `docs/01-architecture/rbac.md` — all check out. Confirmed the four
mechanical gate fixes are each internally consistent with their stated reason.

**One finding sharpened beyond Opus's LOW rating:** `delete-comment.ts`'s idempotent early
return happens BEFORE the capability check, and — since no `GET /api/comments/{id}` route
exists yet (deferred to #23) — this early return is currently the ONLY per-id comment read
path. Any workspace member who can reach the comment (via `requireCommentReach`'s
workspace-membership check) can retrieve an already-deleted comment's tombstone metadata
(`deletedBy`, `deletedAt`, `authorId`, `workItemId`) via a repeated `DELETE` call, with
*zero* `comment:*` capability required. Body is already null by then (low blast radius),
but it is a real capability-check bypass for metadata, not just an ordering nit. Still
non-blocking (matches Opus's own severity judgment), worth prioritising in whatever
follow-up closes the LOW findings.

**One new finding:** the `{ body: null }` gap Opus found in `comment-schema.ts` has the
identical root cause in `canned-response/schema.ts` — `POST /api/canned-responses` also
accepts `body: null` via the same `z.unknown().refine(!containsNulByte)` pattern with no
null-rejection.

**One pre-existing, out-of-scope doc-drift noted:** `comments-and-activity.md`'s CA-11
promises a 422 validation contract with field-level `errors[]`, but this codebase's
`apiRouter`'s `defaultHook` throws a plain-text 400 for every Zod failure, codebase-wide —
this PR correctly follows the actual implementation convention; the spec text is what's
stale (not this PR's concern to fix).

**Minor test-coverage gaps (non-blocking):** `canned-response.test.ts` only tests 403 for
non-admin `POST`, not `PATCH`/`DELETE`; no direct test of the 10,000-node cap (only the
256KiB byte cap is exercised); no test isolating "has `comment:create` but not
`comment:create_internal`" attempting an internal post.

## Re-confirmation after a test-only addition (2026-09-27)

**Reviewed head:** `7c96193905a8b10461185ed85b9965a6632dcb91`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. `git diff 56585f841ef64e064e9f6d78cc3b28cab1887e2a..7c96193905a8b10461185ed85b9965a6632dcb91`
touches exactly one file — a NEW test, `tests/api-integration/task-comment-table.test.ts`
— zero application/migration/schema files changed. Mirrors
`work-item-activity-table.test.ts`'s migration-0066 guard describe (the ordinary review's
own suggested, template-ready fix for its LOW finding #5): asserts no `comment_`-prefixed
catalog object survives on `task_comment`, the new `comment` table's own primary key has
no `_1` collision suffix, and `task_comment`'s indexes/FKs carry the `task_comment_`
prefix. Verified live against a fresh scratch database migrated through 0073+0074: 3/3
pass. Full integration suite re-verified after: 107 files, 1378 tests, all green.

Nothing blocking remains. Clear to merge pending final CI confirmation on this head.

---

## Independent verification after a second, substantive branch update (2026-09-28)

**Reviewed head:** `76491fb2591aa7ff23466e67aedbfe6f920496af`
**Reviewer:** Opus 5.5, fresh independent context (subagent `a03177945f3cb1059`) — a
genuine independent pass, not a self-declared mechanical reconfirmation, because this
merge was NOT a no-op: `main` had advanced past PR #443 (workflow persistence), which
independently generated its own migrations numbered `0073`/`0074`, colliding with this
branch's own `0073_rename_comment_to_task_comment.sql`/
`0074_comment_and_canned_response_tables.sql`. The orchestrating session resolved this by
renumbering this branch's two migrations to `0074`/`0075` and manually reconstructing the
cumulative snapshot chain (main's own workflow tables plus this branch's own rename/new
tables) — a process that surfaced and required fixing two real mistakes along the way (a
migration file corrupted by an unredirected git-error message, and a stale phantom
journal entry from an earlier failed attempt) before landing on the final, verified state.

**Verdict: CLEAR WITH FINDINGS.** The merge and the hand-fixes introduced no error.
Confirmed live: the feature's own application code has an EMPTY diff from the last-
reviewed head (`7c96193`) across every file this PR touches. Confirmed PR #443's own
content survived whole (git's own three-way merge result on every shared file matches
what was committed, byte-for-byte, on six shared files — none were hand-edited despite
having no conflict markers). Confirmed the migration renumbering and snapshot
reconstruction are sound: applied 0000-0075 fresh via BOTH the real app migration path
(`TASKDESK_ROLE=migrate tsx src/index.ts`) and plain `drizzle-orm` `migrate()` — both
succeed and produce an identical schema; `drizzle-kit generate` confirms no drift; a
table-by-table `pg_dump` comparison confirms only the expected tables differ between
main/reviewed-head/merge-head. Re-ran the existing-row test AT THE NEW POSITION: 3 real
`comment` rows inserted after main's own 0073, migrated through 0074/0075, survived
byte-for-byte under `task_comment` with every constraint/index correctly renamed (no `_1`
collision suffix).

Full suites reproduced: unit 60 files/494 tests, permissions 13/83, integration 108
files/1386 tests — all green. `tsc --noEmit` clean on all three tsconfigs.
`check-openapi.mjs` clean, 148 operations, no drift.

**One cosmetic, non-blocking finding (F1):** because the renamed migration files were
kept byte-identical to their already-reviewed originals, a few in-file comments and one
test's `describe` title now say the wrong migration number (e.g. the rename SQL's own
comment still says "migration 0074" for what is now 0075). Left as-is deliberately —
editing the SQL file's own comment would change reviewed bytes for a purely cosmetic fix;
worth a follow-up docs pass, not a merge blocker.

Clear to merge.
