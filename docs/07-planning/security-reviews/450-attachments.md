# PR #450 — work-item attachments (issue #28)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (direct analysis, real Bash/git
access)
**Session:** subagent `a09b492411733453e`

**Reviewed head:** `743a55e7a534063251c77a1db5d56d1670f3f01c` (pre-fix)

**Verdict: NOT CLEAR.** Found and live-reproduced a real HIGH-severity magic-byte
fail-open gap: `magic-bytes.ts`'s default for any MIME type with no registered signature
was `return true` (accept), and 15 of the 24 allowed extensions (including every
Office/legacy-Office/RTF/OpenDocument/TIFF format) had no signature registered at all —
a Windows PE executable declared as `malware.doc`/`.tiff`/`.rtf`/`.odt` etc. passed the
check and was recorded as a "ready" attachment. Also found: a MEDIUM —
`complete-attachment.ts` never re-validated the actual stored object size against
`instance_setting.attachment_max_bytes`, contradicting `storage/s3.ts`'s own comment that
the presigned PUT has no `content-length-range` condition, so an oversized upload could
land as "ready" uncapped; and two LOW findings — `data-model.md`'s own "Indexing" section
for `attachment` names a `(workspace_id, state)` composite and an `(organisation_id)`
partial index, neither of which existed in the migration as originally written.

## Fix applied after review

Commit `37f7a4d` (worktree `agent-a2a22c58604708016`, branch `feat/28-attachments`):
added real signatures for TIFF, legacy OLE-based doc/xls/ppt (shared header), RTF, and
OpenDocument (zip-based); flipped the default from fail-open to fail-closed, keeping an
explicit named `NO_SIGNATURE_CHECK_MIME_TYPES` allowlist for the disclosed plain-text
exception (`text/plain`, `text/csv`, `text/markdown`, `application/json`); added the
size recheck in `complete-attachment.ts`; added the two missing indexes via migration
0074.

**Follow-up fix, same day, by the orchestrating session:** commit `0a6b1d6` — the
fail-closed flip left `image/heic`/`image/heif` (both on the allowed-extensions list)
with no signature and not on the no-check allowlist, a real functional regression for
legitimate uploads of those types. Added the ISO-BMFF `ftyp` box check at its fixed
offset (4) — the same "confirms the container family, not the exact subtype" heuristic
already accepted for the zip-based Office/OpenDocument formats — rather than reopening a
fail-open exception. New unit test added (`HEIC_HEADER` real-bytes-pass / garbage-
rejected, both MIME aliases, folded into the disguised-executable regression list).

The branch was then merged forward past `main`'s advance with #432's hierarchy routes
(commit `ccb8058`, genuine two-parent merge) — the only conflict was the GENERATED
`tests/permissions/matrix.fixture.json`, regenerated via `REGEN_MATRIX=1`, not
hand-edited. A stale `@taskdesk/domain` build artifact caused one transient `tsc` error
unrelated to this PR (missing `validateReparent` export, correctly present in source,
resolved by rebuilding the package) — not a real regression, confirmed and fixed.

## Security review

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a15b177e354ac7ba1`

**Reviewed head:** `811c5175c804b09a7cf7872dee5bec2b31b394f7`

**Verdict: BLOCKING.** Four problems, live-verified against the real `createApp()`, a real
Postgres database on `td-lane-pg`, the real `filesystem` driver, and a throwaway MinIO
container for the S3 path.

**B1 (HIGH):** the declared `contentType`, not the extension, gated the magic-byte check —
declaring any of the 4 no-signature-check plain-text types skipped the byte check
entirely regardless of the actual file extension (six reproduced bypass shapes, including
a PE executable declared `malware.doc` + `text/plain`).

**B2 (HIGH):** the presigned upload URL kept accepting writes after `complete` had already
validated and marked the row `ready` — a second PUT silently replaced the checked bytes
for as long as the URL's TTL lasted (reproduced on both filesystem, which opens with
`O_TRUNC`, and S3/MinIO).

**B3 (MEDIUM, DoS):** `complete` read the entire object into memory before checking size;
nothing bounds a raw S3 PUT's size.

**B4 (MEDIUM):** `GET /api/work-items/{key}/attachments` had no permission check at all,
despite its own policy declaring `work_item:read`.

Six non-blocking LOW findings (L1-L6) also recorded: unsigned filesystem-download
filename parameter, S3 not pinning Content-Type, `S3_KEY_PREFIX` breaking attachments
entirely, deleted/abandoned uploads counting toward per-item limits, `complete`'s UPDATE
lacking a `WHERE state='pending'` guard, control characters in filenames.

Migrations (0073/0074) re-confirmed additive and existing-row-safe. Full suites
reproduced: integration 105/1363, unit 61/503, permissions 13/83 — all green. `tsc
--noEmit` clean, `check-openapi.mjs` clean, 143 operations.

B1-B4 required before merge. A fresh Opus delta pass required on the fix.

---

## Security review — Opus delta 2 (2026-09-27)

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a689169c36912e279` (a first attempt, session `ac7f2b286031f9922`,
was interrupted mid-review by a safety classifier and produced no verdict — discarded,
not counted as a review round)

**Reviewed head:** `f28b503329e7745ca9f1f7058c930ca4de5ba721`

**Verdict: BLOCKING.** B1, B3 and B4 fixes hold up in live tests. **B2 is not closed** —
the replay it was meant to guard against still works, through a timing gap, on both
storage drivers. Reproduced live: a PE executable ended up served as a `ready`
`image/png` attachment.

**N1 (HIGH, filesystem): B2 still open through an upload request already in progress.**
The upload writer (`writeStreamToFile`) opens the pending path with
`O_WRONLY|O_CREAT|O_TRUNC`. A rename (the B2 fix) moves the file but does not close file
handles already open on it — an upload already in flight when `complete` runs keeps
writing into the file that is now the served one. Reproduced step by step, no timing luck
needed: a slow PUT opens the pending file and stalls; a fast PUT with real PNG bytes
completes and gets renamed to final; the stalled PUT's PE bytes then land at position 0 of
the RENAMED (final) file. Both PUTs return success; the served download starts `MZ`.

**N2 (HIGH, S3/MinIO): B2 still open through a race between the check and the copy.**
`complete` checks the object at the pending key (HEAD + ranged GET), then runs a separate
`CopyObject` of that same key — the presigned PUT can still write in between. Reproduced
by racing 6 malicious PUTs with 0-14ms start delays against `complete`: one landed inside
the gap, and the resulting `ready`, `image/png`-declared object starts with a PE header.
Also exposes B3's size limit through the same gap (S3 presigned PUTs have no size bound;
demonstrated a 300MB raw PUT accepted).

**Fix direction (one structural change for both):** check the bytes that will actually be
served, at the FINAL location, after the move — never at the pending location. S3:
`CopyObject` to the final key first, then HEAD + ranged GET the final key (no presigned
URL can write there); delete on failure. Filesystem: either make the writer publish
atomically (write to a unique `O_EXCL` temp file, rename onto the final key, so no
request ever holds a handle on a live served file) or have `complete` copy (not rename) to
a new file and check the copy.

**Verified clean:** B1 (all 6 bypass shapes plus new adversarial ones — mixed case,
charset suffix, whitespace, multi-value contentType — all correctly rejected at presign;
legitimate combinations accepted; extension table covers all 25 allowed extensions, not
24 as briefed). B3 (size checked before any body read; 300MB object on both drivers
returns 400 with no memory growth; MinIO ranged GET confirmed genuinely ranged over the
wire). B4 (list/single/download all correctly gated by role in a 3-role matrix).

**Non-blocking:** N3 (LOW) — a crash between the storage move and the DB update leaves
orphaned/inconsistent state (no transaction spans both); N4 (LOW) — a replay PUT after
`complete` leaves an orphan object at the pending key on both drivers, uncleaned. L5
confirmed closed; L1-L4/L6 unchanged, not made worse.

Full suites reproduced: integration 105/1366, unit 61/509, permissions 13/83 — all green.
`tsc --noEmit` clean, `check-openapi.mjs` clean, 143 operations, no drift.

B2 (via N1+N2) is required before merge. A fresh Opus delta pass is required on the fix.

## Fix applied after round 2 (commit `638e776`)

**N1 (filesystem):** `writeStreamToFile` no longer opens the pending path directly with
`O_TRUNC`. It writes to a uniquely-named temp file (`O_CREAT|O_EXCL`), and only `rename()`s
that temp file onto the destination once the write has fully completed and the handle is
closed — no in-flight upload ever holds a live handle on a path `complete` will later move.

**N2 (both drivers), the structural fix:** `complete-attachment.ts` reordered so
`finalizeStorageObject` (move pending → final) runs BEFORE the size check and magic-byte
sniff, which now read only the FINAL key, never the pending one. A stray/racing PUT after
this still lands somewhere — the now-vacated pending key, never the final one — the
accepted, non-blocking N4 finding (an orphan object, not a served one). On any check
failure the final object is deleted; if the row loses its `state='pending'` race, the
final object it already created is now also cleaned up (a new, natural corollary of
finalizing earlier).

New regression tests: an N1 test (a slow, controllable-stream PUT racing a fast PUT
against the same presigned key, with `complete` in between — fails on pre-fix code,
served bytes are the malicious ones; passes on the fix, served bytes are the original);
an N2 test exercising the real `completeAttachment` controller and S3 driver code path
with only the AWS SDK client replaced by an in-memory fake (no MinIO harness exists in
this repo's suite), with a one-shot hook firing exactly in the gap the review described.
Both reproduced fail-then-pass (`git stash` the fix, confirm failure; restore, confirm
pass).

Independently spot-checked by the orchestrating session: both new test files pass
(2 files, 11 tests) on a fresh isolated database.

Full suites reproduced by the fixing lane: unit 61 files/509 tests, permissions 13/83,
integration 106 files/1368 tests — all green (one earlier run showed 4 unrelated false
failures from the lane's own overlapping concurrent test invocation against the same
database — a deadlock during TRUNCATE, not a real defect — a clean solo re-run confirmed
0 failures). `tsc --noEmit` clean on all three tsconfigs. `check-openapi.mjs` clean, 143
operations, no drift. B1/B3/B4 re-confirmed unaffected.

N3/N4 remain open, non-blocking, unchanged — not required for this round.

A fresh Opus delta pass is required on this fix.

---

## Security review — Opus delta 3 (2026-09-28)

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a88d77c82377184da`

**Reviewed head:** `24406bbb1e14360a0f287259010175e900e57ca5` (merge of `1535bfe` with
`origin/main`, past PR #451)

**Verdict: BLOCKING.** The merge introduced no error (application code, migration
renumbering, shared-file splices, routes/policies from both PRs all confirmed live —
full suites 61/509 unit, 13/83 permissions, 110/1397 integration, all green, `tsc`/
`check-openapi.mjs` clean at 155 operations). N1 and N2 are genuinely closed — in every
race on both drivers, the object served as `ready` was always the one that was checked.

**N5 (MEDIUM, blocking, introduced by the N1/N2 fix itself): a losing concurrent
`complete` call deletes the winning call's already-checked final object.** Both
`toFinalAttachmentObjectKey` calls on the same attachment derive the SAME deterministic
final key, so two concurrent `complete` attempts both write to (and, on failure, both
try to clean up) the identical destination. Reproduced on real MinIO: 2-3 concurrent
`complete` calls, 30/30 runs ended with the row `ready` but the final object MISSING —
a permanently broken attachment, no attacker required (an ordinary client retry or
double-click triggers it; also reachable by any workspace member via the list route's
own visibility into pending attachments). A related, narrower problem with the same
cause: the row DELETE on a failed check has no `state='pending'` guard, so a losing call
whose OWN check fails can delete a row a winning call already marked `ready` (seen 2/30
times in mixed race runs).

**Fix direction, validated by the reviewer on a scratch copy (30/30 held on both drivers,
then reverted):** give each `complete` ATTEMPT its own unique final key (not
deterministic from the pending key alone), so concurrent attempts never collide on the
same destination; add `state='pending'` to both row-DELETE calls. One existing test
hard-codes the old deterministic key shape and will need updating.

Full suites reproduced: unit 61/509, permissions 13/83, integration 110 files/1397
tests — all green. `tsc --noEmit` clean, `check-openapi.mjs` clean, 155 operations, no
drift. B1/B3/B4 re-confirmed unaffected. N3/N4 unchanged, not made worse (N4 gains one
new orphan shape — a crashed-mid-write filesystem temp file — still non-blocking).

N5 is required before merge. A fresh Opus delta pass is required on the fix.

## Fix applied after round 3 (commit `089dbe4`)

**Root cause confirmed:** `toFinalAttachmentObjectKey` was a pure, deterministic function
of the pending key alone — two concurrent `complete` calls on the same attachment always
derived the identical final key. On S3, `CopyObject` doesn't consume its source, so both
concurrent copies could land at that one destination; whichever call lost the DB-level
`state='pending'` race then deleted "its own" final object, which was actually the
winner's. On filesystem, plain `rename()` already made this specific data-loss impossible
(a source can only move once) — confirmed by the fix's own filesystem regression test
passing even before the fix, consistent with this being an S3/MinIO-specific bug.

**Fix:** each CALL to `toFinalAttachmentObjectKey` now appends a fresh random token into
the final filename (`.../final/<token>-<original-filename>`), not a fixed transform of
the pending key — two concurrent attempts on the same attachment now always get distinct
destination keys, so neither's cleanup can ever touch the other's object. Applied via the
shared driver-agnostic helper (`storage/shared.ts`), so both filesystem and S3 drivers get
it automatically. Also added the `state='pending'` guard to both previously-unconditional
row-DELETE calls in `complete-attachment.ts` (size-check and magic-byte-check failure
branches), matching the guard the `ready` UPDATE already had.

New regression test file (`attachment-concurrent-complete.test.ts`): 3 concurrent
`complete` calls race on the same attachment via an S3 fake client's own "copy barrier"
(forcing all 3 copies to succeed before any delete runs, rather than relying on timing
luck) — exactly 1 of 3 wins (200), the other 2 get 409, and the winner's object survives
with byte-for-byte correct content. Fail-then-pass reproduced: reverting just the two fix
files reproduces the exact reported bug (`AssertionError: expected undefined to be
defined` — the winning object genuinely gone).

Independently spot-checked by the orchestrating session: both fix diffs read and
confirmed correct; the new test file passes (1 file, 2 tests) on a fresh isolated
database.

Full suites reproduced by the fixing lane: unit 61 files/510 tests, permissions 13/83,
integration 111 files/1399 tests — all green. `tsc --noEmit` clean on all three
tsconfigs. `check-openapi.mjs` clean, 155 operations, no drift. B1-B4/N1/N2/L5
re-confirmed unaffected.

N3/N4 remain open, non-blocking, unchanged — out of scope for this round.

A fresh Opus delta pass is required on this fix.

## Round 6: independent Opus delta review at `fafc27c` — CLEAR WITH FINDINGS

**Reviewed head:** `fafc27c075e5af26893257badb9fb4604ae98bcc`

Fresh independent context (Opus 5.5), did not author, direct or fix any of this PR.
Verified live against a throwaway MinIO container plus the real AWS SDK (no fake),
across forced (copy-barrier) and natural races at N=2/3/5/10/20. N5 reproduced on the
pre-fix code (every race scenario failed), then shown fixed (150 race runs, exactly one
winner each time, byte-for-byte correct). B1–B4 re-checked live and still hold. The
`state='pending'` guard covers all three attachment-lifecycle row writes in
`complete-attachment.ts`. Fail-then-pass reproduced independently on both the committed
test and the reviewer's own MinIO harness. Full suites: unit 61/510, permissions 13/83,
integration 111 files/1399 (1398 pass, 1 fails — see below). `tsc --noEmit` and
`check-openapi.mjs` both clean.

**Findings (none blocking):**
- **R6-1 (LOW, missing test):** the `state='pending'` guard on the two row DELETEs had
  no committed regression test; removing it, the reviewer's MinIO harness caught a
  winner's row being deleted by a loser's own cleanup (20/20 runs without the guard).
  **Fixed after this round** — see "R6-1 test added" below.
- **R6-2 (LOW, pre-existing, not introduced by this PR):** `delete-attachment.ts`'s
  UPDATE has no `state <> 'deleted'` guard — concurrent deletes all return 200 and can
  double-write the `attachment.deleted` activity row. No data loss, no security impact.
  Filed as a follow-up issue rather than fixed in this PR (out of this PR's diff).
- **R6-3 (LOW, cosmetic):** the 409 message on a since-deleted row still reads
  `already "pending", not "pending"` — a 404 would be more accurate. No behavior or
  security impact; left as disclosed, not fixed, to avoid re-touching reviewed code for
  a message string.
- Unrelated to this PR: `work-item-unassign.test.ts` is flaky against Postgres 18 (an
  audit-row read with no `ORDER BY`, sensitive to which index the planner picks) —
  pre-existing on `main`, not in this PR's diff. Filed as a follow-up issue.

## R6-1 test added (commit `d0f6c79`, test-only)

**Reviewed head:** `d0f6c796f5daae37d3a7e40f16a3b9ff1cd7ef30`

New test in `attachment-concurrent-complete.test.ts`'s S3 suite, following the
reviewer's own suggested shape: one racer's copy snapshots valid PNG bytes, the pending
object is then swapped to garbage bytes before the other racer's own copy snapshots it,
so exactly one racer fails its magic-byte check. A deterministic delete-gate (poll the
row until the winner has committed `ready`, rather than relying on incidental timing)
reproduces the exact ordering the guard exists for.

Fail-then-pass confirmed directly by the orchestrating session: with the `state`
guard temporarily removed from the magic-byte-check DELETE in
`complete-attachment.ts`, the test failed (`expected undefined to be 'ready'` — the
winner's row gone); restored, the test passes, and the full attachment integration
suite (14 tests across 3 files) passes solo on a fresh isolated database.

This is a test-only diff against the reviewed head (`fafc27c` → `d0f6c79`, zero
application-code change — confirmed via `git diff --stat`), so per the precedent
already established for PR #451's own migration-guard-test follow-up, this is a
**mechanical reconfirmation, not a fresh Opus round**: the round 6 verdict above
(CLEAR WITH FINDINGS) still applies at `d0f6c79`, with R6-1 now closed.

**Status: CLEAR WITH FINDINGS, merge-ready.** R6-2 and the unrelated flaky test are
tracked as follow-up issues; R6-3 is disclosed and accepted.

## Mechanical reconfirmation after merging `main` (commit `9f876bd`)

**Reviewed head:** `9f876bdfe23a15762352b47942208121705894cf`

`main` had moved two commits ahead since this branch's own merge-base (`90388ef`, the
#451 merge already covered by round 6): `359bc7e` and its merge commit `0d86d05`,
together touching only `docs/07-planning/decision-log.md` (PR #453 — one dated entry
recording Thomas's decision on the unrelated `GET /api/invitation/{id}` route, issue
#8). `git log --oneline origin/feat/28-attachments..origin/main` confirmed exactly
these two commits, both docs-only, before merging. The `state = 'pending'` up-to-date
requirement on this repo's ruleset (`strict_required_status_checks_policy`) requires
this branch be current with `main` before its required checks count, hence the merge.

The security-review STALE detector (`check-pr-template.mjs`/`security-review-note.mjs`)
correctly flags any merge-into-branch commit against its `main` parent, since that
diff always includes the branch's own full accumulated change — that is by design, not
a new finding here (see that file's own doc comment). This entry is the orchestrator's
mechanical reconfirmation, per the same precedent already used for #451's own
post-#443 main-merge: `main`'s two new commits are verified docs-only above, so
nothing new needs Opus's eyes. The round 6 verdict (CLEAR WITH FINDINGS) still applies
at `9f876bd`.

## Round 7: independent Opus review at `0174829` — CLEAR WITH FINDINGS

**Reviewed head:** `017482980f31604e6b27fe3293d0cd7b5205142b`

Since round 6's `9f876bd`: `main` was merged past PR #440 (issue #8's own six-round
Opus-reviewed route-classification-guard fix, already fully independent of this PR —
verified here only for its INTEGRATION effect on this PR's own attachment routes, not
re-reviewed from scratch), and a new CI-gate mechanism was added: a reviewed
Redocly-lint-finding allowlist (`scripts/ci/redocly-approved-findings.json` +
supporting functions in `scripts/ci/test-contract.mjs`), closing a real, permanent
`operation-2xx-response` false positive on `GET /attachments/{id}` (redirect-only by
design, AT-5/AT-6 — see the decision log's 2026-09-28 entry). A separate ordinary
review (`pal-reviewer`, fell back to a direct Sonnet read-through) ran on just the
allowlist mechanism and returned CLEAR with three low/nit findings, all also caught
independently by this round.

Fresh independent context (Opus 5.5), did not author, direct or fix any of this PR.
Verified live: built a synthetic base commit to prove "an entry already on
`origin/main` approves nothing" beyond the unit test's own coverage; ran adversarial
parse probes against the allowlist file (extra/missing keys, `__proto__` as a key,
string/float `pr`, whitespace-only fields, duplicates, `null`, nested arrays, an
object instead of an array, an empty file) — all correctly rejected. Confirmed the
security-path classifier already covers the new allowlist file through `scripts/ci/**`
(future edits need the Opus pass same as this one did). Confirmed no attachment code
changed since round 6, no new middleware reaches attachment routes, and live-probed
all 5 routes with the real `createApp()` (spied on `policyRegistry.get` and the
guard's own error log) — each looked up only its own declared policy key, no foreign
or sibling key, no guard refusal. Full suites: unit 62 files/512, permissions 13/83,
integration 112 files/1418 — all green (the pre-existing, already-filed #455 flake did
not even reproduce in this run). `tsc --noEmit` clean on all three tsconfigs.
`node --test scripts/ci/test-contract.test.mjs`: 50/50. `pnpm test:contract`: exit 0.

**Findings (none blocking):**
- **F1 (LOW):** the new allowlist's `(rule, pointer)` binding (no per-finding
  fingerprint) means one entry approves every problem at that exact location,
  whatever its message — harmless today (`operation-2xx-response` fires at most once
  per operation) but worth tightening before a second entry is ever added. **Disclosed
  after this round** as a code comment on `partitionApprovedRedoclyFindings` (commit
  `93558ec`) rather than fixed now — no second entry exists yet to motivate the extra
  binding precision.
- **F2 (nit):** `operation` is a label never cross-checked against `pointer`; `pr`
  accepts 0/negative; a duplicate JSON key resolves last-wins; the NUL-joined identity
  string has a theoretical collision for a rule containing an escaped NUL. All four
  already exist in the pre-existing `parseApprovedBreaks`/oasdiff-allowlist code this
  mechanism mirrors — not new, not blocking.
- **F3 (test gap, non-blocking):** the "base entry approves nothing" unit test copies
  `main()`'s own filtering logic inline rather than exercising `main()` itself — a
  regression there wouldn't be caught by that unit test alone. Same pre-existing
  pattern as the equivalent oasdiff-allowlist test (Opus's own words: not unique to
  this addition). This round's own live `pnpm test:contract` run covers the real path
  at this exact head. Left as disclosed, not restructured, given the pre-existing
  precedent and this PR's already-long review history.
- **F4 (docs, non-blocking):** `ci-cd.md` didn't document the new allowlist file, only
  the security-path glob covered it. **Fixed after this round** (commit `a2c5458`).

## Mechanical reconfirmation after Opus F1/F4 follow-ups (commits `a2c5458`, `93558ec`)

**Reviewed head:** `93558ecdb6e96b21874b4876a325b315417f4214`

Two commits landed after round 7's reviewed head, both exactly the non-blocking,
disclosed follow-ups that review itself recommended: a documentation addition to
`ci-cd.md` (F4) and a code-comment-only disclosure in `test-contract.mjs` (F1) — zero
behavior change in either (confirmed via `git diff --stat 0174829 HEAD`: `ci-cd.md`
+11 lines, `test-contract.mjs` +9 lines, both prose/comments only; re-ran
`node --test scripts/ci/test-contract.test.mjs`, still 50/50). Per the same precedent
used for every other docs/comment-only follow-up this PR has had, this is a mechanical
reconfirmation, not a fresh Opus round: round 7's verdict (CLEAR WITH FINDINGS) still
applies at `93558ec`, with F1 and F4 now closed and F2/F3 disclosed as pre-existing,
non-blocking, deferred.

**Status: CLEAR WITH FINDINGS, merge-ready.**
