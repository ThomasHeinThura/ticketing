# PR #454 — delete-attachment's soft-delete UPDATE state guard

## Ordinary review

**Model:** `pal-mcp` `coder` failover chain (GPT-6 Luna primary), via the `pal-reviewer`
subagent
**Session:** subagent `a98e4268c9d90d7f4`

**Reviewed head:** `a63c14d3acfcb9fbf7faf4d32f135f1cbff61ae7` (first pass, before the B1
fix below)

**Verdict: BLOCKING.** Independently found the same defect the Opus pass below also
found: guarding the soft-delete UPDATE's WHERE clause on `state = 'ready'` is narrower
than the route's own pre-transaction check (which accepts both `pending` and `ready` --
only `deleted` short-circuits early), so an uploader deleting their own still-`pending`,
never-completed attachment matched that pre-check, then matched zero rows in the guarded
UPDATE, and fell into the `!updated` branch with a wrong 403 ("Only the attachment's own
uploader may delete it") -- a real, user-facing functional regression, not covered by any
existing test. Confirmed the concurrency-race fix itself and its regression test
(`attachment-concurrent-delete.test.ts`) are sound; confirmed `complete-attachment.ts`'s
own precedent guard and its origin in PR #450's L5 finding. Noted this file is in
`ci-cd.md`'s security-review-scope path list and that its own review does not substitute
for the mandatory Opus pass.

This review ran on the pre-B1-fix commit and did not see the fix below or the delta
review that cleared it. Recorded here for the record, not as covering the final head --
the Opus delta review immediately below is what actually clears the code that shipped.

## Security review — Opus, first pass

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a4052d44b3732e63b`

**Reviewed head:** `a63c14d3acfcb9fbf7faf4d32f135f1cbff61ae7`

**Verdict: BLOCKING.**

**B1 (blocking): the uploader can no longer delete their own pending attachment, and gets
a wrong 403**
- Where: `apps/api/src/attachment/controllers/delete-attachment.ts:80`
  (`eq(attachmentTable.state, "ready")`), together with the fallback at lines 112-117.
- Why: the pre-check before the transaction (line 55) only rejects `deleted` -- so both
  `pending` and `ready` pass it. The guarded UPDATE only accepted `ready`, narrower than
  that pre-check. `complete-attachment.ts` guards on `state = 'pending'` because THAT
  matches its own pre-check's expected state -- "mirror `complete-attachment.ts`'s
  pattern" should have meant guarding on "not deleted" here, not "ready".
- What goes wrong: an uploader presigns a file, never completes it (row stays `pending`,
  still shows in the attachment list since that only filters `deleted`). They call
  DELETE. Pre-check passes, the UPDATE (guarded on `ready`) matches zero rows since the
  row is `pending`, the re-check finds `pending` not `deleted`, and the caller gets a
  wrong 403 -- even though they ARE the uploader. No cleanup job exists for stuck pending
  rows, so this is a real, user-facing regression.
- Confirmed live: 200 on pre-fix `81b0686`, 403 on `a63c14d`.
- Fix: change the guard from `eq(attachmentTable.state, "ready")` to
  `ne(attachmentTable.state, "deleted")` -- closes the race identically per both
  interleavings against a concurrent `complete` (guarded on `state = 'pending'`).

Three non-blocking notes, disclosed here per the review, not required for this PR:
(1) the fallback's 403 arguably should be 404 when the row is gone entirely from a racing
`complete`-failure delete -- pre-existing behavior, unchanged by this PR; (2) an existing,
out-of-scope gap where any caller with `work_item:update` can see a deleted attachment's
details via the "already deleted" pre-check ordering; (3) the presign route's per-item
attachment limit counts deleted/pending rows too, so deleting never frees a slot. None of
these three are new to this PR and none block it.

## Fix applied after review (B1)

Commit `bd87e7b7e22c64df266104bb65d61a3f23ce70fc`: widened the guarded UPDATE's WHERE
clause from `eq(attachmentTable.state, "ready")` to `ne(attachmentTable.state,
"deleted")`, matching the pre-transaction check's own two accepted states (`pending` and
`ready`). Added a regression test (`tests/api-integration/attachment.test.ts`, "#454 B1
regression: the uploader can delete their own PENDING (never completed) attachment"),
verified fail-then-pass by temporarily reverting to the old `eq(state, "ready")` guard
(403 instead of 200, reproducing B1 exactly) then restoring the widened guard. Re-ran the
existing five-concurrent-delete race test and the sibling complete/S3-finalize-race tests
against the widened guard -- still exactly one activity row, still passing.

## Security review — Opus delta

**Model:** Opus 5.5, fresh independent context (did not author or orchestrate the fix)
**Session:** subagent `afe61555c052bdb01`

**Reviewed head:** `bd87e7b7e22c64df266104bb65d61a3f23ce70fc`

**Verdict: CLEAR WITH FINDINGS.** Confirmed B1 is closed: the guard is now
`ne(attachmentTable.state, "deleted")`, and the pending-attachment-delete-by-owner
scenario now returns 200/deleted rather than 403. Confirmed the original concurrency-race
protection is not weakened by the widened guard -- five concurrent DELETE calls on one
`ready` attachment still resolve to exactly one activity row and one winner under
Postgres's row-lock/READ COMMITTED semantics, reasoned through both delete-vs-delete and
delete-vs-concurrent-`complete` interleavings, no double-write or inconsistent final state
in either. Confirmed the new pending-delete regression test actually exercises a
presign-only, never-uploaded, never-completed attachment deleted by its own uploader.

**N1 (non-blocking):** `tests/api-integration/attachment-concurrent-delete.test.ts`'s own
header comment (lines 13 and 38 at `bd87e7b`) still described the shipped guard as
`state = 'ready'` -- the B1 fix's superseded first attempt -- instead of the actual
`ne(state, "deleted")` guard that landed. Comment-only, no behavior change; fixed in
commit `1c97fb6e0371fe29f08ad18103ebf9c73f6f48c3`.

**Reviewed head:** `1c97fb6e0371fe29f08ad18103ebf9c73f6f48c3`

The N1 fix above is the only commit landed after the Opus delta review's own
`bd87e7b7e22c64df266104bb65d61a3f23ce70fc` head, and it touches only a doc comment inside
a test file, not any of the guard/authorization logic the delta review examined and
cleared -- so this second `Reviewed head` line extends that same CLEAR WITH FINDINGS
verdict to the actual final code head, rather than re-running the full delta for a
comment-only change.

## Full suite, solo, fresh isolated database (post-N1, at `1c97fb6`)

- `pnpm exec vitest run --config vitest.config.ts` (unit): 512/512 passed, 62 files.
- `pnpm exec vitest run --config vitest.permissions.config.ts`: 83/83 passed, 13 files.
- `pnpm exec vitest run --config vitest.integration.config.ts`: 1420/1420 passed, 113
  files.
- `tsc --noEmit -p tsconfig.json`, `-p tsconfig.permissions.json`, `-p tsconfig.tests.json`:
  all clean.

## Checked elsewhere in the attachment lifecycle

`complete-attachment.ts`'s two guarded deletes and one guarded update already carry a
`state = 'pending'` guard from PR #450's own L5 fix. No other write path in
`apps/api/src` touches `attachment_table` (`presign-attachment.ts` only selects and
inserts a new row; `list-work-item-attachments.ts` and `download-attachment.ts` only
select). No structural guard beyond the two now-guarded UPDATE/DELETE statements is
needed -- this is the same class of bug as PR #450's L5 finding, now closed identically
in both places it occurs.
