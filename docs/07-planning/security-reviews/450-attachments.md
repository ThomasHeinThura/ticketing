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
