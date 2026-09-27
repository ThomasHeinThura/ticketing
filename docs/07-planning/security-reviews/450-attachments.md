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

**Model:** PENDING — Opus, mandatory (this PR adds a migration and new permission-gated
routes)
**Session:** PENDING
