# Pre-merge security review — PR #164 (`storage.filesystem` driver, `apps/api/src/storage/**`)

**Reviewed head:** `36d186e09f8a40567767e40cb13e0754c8885823`

**Verdict: CLEAR WITH FINDINGS.** No exploitable security defect. Two Opus rounds, plus two
ordinary Sonnet reviews covering the HMAC upload-token mechanism and path-traversal/driver-
wiring in depth. One blocking Medium (missing HTTP-level test coverage for the new route)
and several cheap items were found and fixed; two items were correctly deferred to tracked
follow-up issues rather than fixed in this pull request.

## What this PR adds

A `storage.filesystem` driver so a fresh TaskDesk install has a working task-image-upload
backend with zero S3 configuration. Since a local filesystem has no native "presigned
upload URL" concept, a new route, `PUT /api/storage/filesystem-upload`, is gated by a
short-lived, key-scoped HMAC-SHA256 token — HKDF-derived from `TASKDESK_AUTH_SECRET` — in
place of a session (there is none on a direct PUT; the token is the credential). The route
is registered `public: true`. `TASKDESK_STORAGE_DRIVER` selects between this and the
existing S3 driver.

## Round 1 — ordinary review, token mechanism (Sonnet, head `15009b4`)

**PASS, one required trivial fix.** Deep, adversarial read of the token mint/verify path:
payload construction (explicit-delimiter encoding, not naive concatenation — keys can never
contain the delimiter), constant-time comparison (`crypto.timingSafeEqual` behind a safe
length pre-check), HKDF key isolation (a distinct versioned `info` string, confirmed no
key-reuse with better-auth's own use of the same secret), expiry baked into the signed
payload (can't be extended by tampering), replay (deliberate S3-presigned-URL parity, low
severity), key scoping (the full object key is signed and re-verified, not a prefix or
hash), and error-oracle analysis (distinguishable error messages don't leak signature
information, since the expired-token branch depends only on public information). One
required fix: a literal raw NUL byte embedded directly in source (`assertSafeRelativeKey`)
should have been the `\0` escape sequence, matching this same PR's own care elsewhere. Fixed
before the Opus rounds began.

## Round 2 — ordinary review, path safety and wiring (Sonnet, head `15009b4`)

**PASS, one low-severity finding, one doc nit, both non-blocking.** Held under adversarial
input (percent-encoding, Unicode homoglyphs, Windows-style prefixes, symlink attempts) run
against the real module, not just read. Confirmed `shared.ts`'s extraction from `s3.ts` is
textually identical logic relocated, not rewritten (21/21 existing `s3.test.ts` unchanged).
Confirmed the driver selector re-reads `TASKDESK_STORAGE_DRIVER` per call, correctly
defaulting to `filesystem`. Confirmed `cleanup-assets.ts`'s rewiring is correct and no other
direct `./storage/s3` import was missed. Confirmed the route's `public: true` placement is
consistent with PR #163's H2 fix (public/delegated routes are exempt from the ordering
check by design). Found: a low-severity TOCTOU gap in `getPrivateObject` (re-uses the
un-realpath'd candidate path for read, unlike `deleteObject` which correctly reuses the
resolved path) — within the module's own disclosed threat-model exclusion, not blocking; and
a documentation count nit in `configuration-reference.md`.

## Round 3 — mandatory Opus security review (head `15009b4`)

**CHANGES REQUIRED.** One blocking Medium: **Finding 1** — the new route had zero
HTTP-level test coverage. Every existing negative test called the driver's internal
functions directly, bypassing the actual route — so the `public: true` placement, the Zod
query contract, the HTTP status mapping, and the S3-fallback behavior were all untested at
the layer that actually matters, on the only unauthenticated, mutating, filesystem-writing
endpoint in the product. Also found, non-blocking but fixed in the same pass: **Finding 4**
(post-token errors echoed raw filesystem error messages, including the server's absolute
storage root path) and **Finding 5** (a test-only export had no internal marker). Correctly
deferred to tracked follow-up issues rather than fixed here: **Finding 2** (orphaned bytes
with no GC when finalize never runs — filed as #166) and **Finding 3** (a driver flip
orphans bytes on delete without cleanup — filed as #167, with an operator warning added to
`configuration-reference.md`).

## Round 4 — Opus delta confirmation (head `985ccdf`)

**CLEAR WITH FINDINGS, nothing blocking.** Independently reproduced the original Finding 1
gap and confirmed the new `tests/api-integration/storage-filesystem-upload.test.ts` (7
tests, driving the real app via `createApp()`) genuinely closes it — mutation-tested by
disabling the token check and separately disabling two of the three path-safety layers, and
confirmed the tests catch each. Independently reproduced the original Finding 4 leak against
the pre-fix code (confirmed the raw `EEXIST` message with the absolute path) and confirmed
the fix is correctly scoped — every deliberately-informative `StoragePathError` message
still passes through unchanged; only genuinely unexpected filesystem errors are
genericized. Confirmed Finding 5's marker. Confirmed issues #166/#167 exist and accurately
describe what they defer. Found one new Low, introduced by the Finding 4 fix itself:
**Finding A** — the genericized filesystem errors were being discarded entirely rather than
logged server-side, so an `ENOSPC`/`EACCES`/`EDQUOT` on the storage volume would surface to
nobody. Fixed at `36d186e` (this pull request's current head): logged via `console.error`
before the generic message is thrown, matching this file's own existing logging convention
(readiness checks, asset streaming, authentication failures all follow the identical
pattern). Two further findings were informational, no action needed: the HTTP suite doesn't
duplicate two cases already covered at the unit level (no signal gained from doing so), and
five `noUndeclaredEnvVars` lint warnings match a pre-existing, accepted pattern the `S3_*`
variables already established.

## Independently confirmed at the final head (`36d186e`)

- Storage unit tests: 45/45.
- New HTTP-integration test file: 7/7.
- Full `apps/api` unit suite: 320/320 (47 files).
- Full integration suite: 396/396 (48 files).
- `pnpm test:permissions`: 76/76.
- `pnpm lint` / `pnpm typecheck`: clean.
- `check:env`, `check:skips`, `check:openapi` (102 operations): all green.

## What remains deliberately out of scope

- The `packages/plugins-contracts` `StorageBackend` plugin interface and the full
  Attachments presign/complete/quota/visibility system — that is the P1 Attachments
  feature, currently blocked by its own open spec review. Building it here would be doing
  blocked feature work through the back door of a deployment issue.
- `docker build .` was not run in this review chain — flagged in the pull request's own
  "Not done" section as the orchestrator's pre-merge step, per this project's "before you
  say done" convention for any change touching what ships in the image.

## Status of the gate

This review closes the mandatory independent Opus security review for PR #164
(`apps/api/src/storage/**` is security-review scope per `docs/04-engineering/ci-cd.md`).
Ordinary independent review is also complete — two rounds, covering the token mechanism and
path-safety/wiring separately (see above). No gate is waived. The orchestrating session
verifies this note, the exact head, and every other required check — including a real
`docker build`/container boot — before merging through the protected flow.
