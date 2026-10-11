# Independent GPT-6 Sol security review — P0 CPU profile diagnostic

- **PR:** [#587](https://github.com/ThomasHeinThura/ticketing/pull/587)
- **Reviewer:** fresh independent GPT-6 Sol context; I did not author, direct, or remediate this candidate.
- **Reviewed head:** `e3ac04596499bd59772403bb4e0534b40dc1ac88`
- **Diagnostic comparison base:** `08842235047a3ab2714427edce80331b94558150`; the complete six-file diagnostic delta was inspected, including the repair batch from `d8cd2704` and the final `7b56b44e..e3ac0459` metadata correction.
- **Risk/tier:** bounded CI/performance diagnostic touching `apps/web/e2e/**`, a security-scope path. This is the required full independent Sol pass after the strong Luna repair review. The Luna report at `7b56b44e` remains historically **BLOCKED** on the stale serialized clock statement; this review verifies its exact-head correction. Under the repository's change-altitude rule, the existing structural repair and this clean Sol pass close that finding class without mislabeling the prior Luna verdict.
- **Scope limit:** diagnostic attribution and its evidence only. This is not clearance of other stacked PR #587 product changes, CI, hosted G11, strict cutover, or the P0 phase finalizer.

## Checks performed

- Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, current status/decision records, the CI security-scope list, the diagnostic testing contract, and the prior Luna/Sol diagnostic review trail.
- Verified local `HEAD` and GitHub PR #587 `headRefOid` both equal the reviewed SHA. Read the complete diagnostic diff from `08842235`, the full capture/attribution helpers and serialization path, plus the exact two-file final correction. `git diff --check 08842235..HEAD` passed.
- Independently checked the pinned [V8 profile producer](https://chromium.googlesource.com/v8/v8/+/cb5dfb7d734c416a7e6536c853f9be9f3eac587e/src/profiler/profile-generator.cc): it emits node-only/sample-bearing chunks, optional root fields and parent IDs, computes deltas from the preceding sample (initially profile start), and explicitly anchors them at the initial `Profile` trace event `ts`. Chunk emission may follow later. The current PID/source/ID start join accommodates a different marker TID; cumulative deltas remain keyed by the sampling thread.
- Ran focused Vitest: **3 files, 24 tests passed** (`performance-cpu-profile-capture`, `performance-profile-attribution`, `performance-profile-intervals`). Web typecheck passed. Biome passed on the three diagnostic code files; `git diff --check` passed. No source files were changed by this review.
- Read the author-provided native Chromium probe and its limited claim: one profile/78 chunks had matching PID/source/ID across differing marker/chunk TIDs; cleanup ran in `finally` and raw trace was not persisted. I did not independently run a browser trace or hosted G11 capture. The old `f841` hosted 18/22 result and malformed earlier profiles are pre-fix evidence, not current attribution or acceptance.

## Security/correctness assessment

- **Native capture and bounds:** profile-start identities and accumulated keys are capped at 32; per-profile and capture node/sample limits apply before retention. Malformed/over-limit admitted profiles clear retained arrays/maps and later chunks for that key are ignored. Invalid/overflowing new keys increment fixed counters without growing retained-key state. Node-only, sample-bearing and metadata-only chunks are normalized, including optional root URL/coordinates.
- **Clock and recorder boundary:** the final serialized `cpuProfileClock` and testing-strategy text now accurately describe the code: initial `Profile` timestamp joined by PID/source/ID despite TID differences; ordered `timeDeltas` accumulated across chunks; sample intervals clipped to the calibrated recorder span. Missing anchors omit the affected profile rather than substituting delayed chunk timestamps. Coverage retains uncovered prefixes/suffixes. The 24-test suite covers the cross-TID join, delayed chunks, missing anchors, bounds and map gaps.
- **Source and ancestry trust:** emitted manifest JS and adjacent map digests identify the exact build inputs; map parsing requires version 3 and optional `file` basename match. Lookup honors unmapped spans, and coordinate/index accumulation rejects unsafe integers. Missing/cyclic parent edges are omitted, caller depth is capped, and a top-frame map mismatch cannot produce mapped attribution. Digests bind evidence to bytes; they do not independently prove a performance cause.
- **Privacy:** new emitted CPU frames contain generated asset basenames, bounded numeric IDs/coordinates/times and map indexes/digests. Raw function labels, raw event arguments, profile URLs, source-map source/name strings and source contents are not serialized by this diagnostic path. Output is written with mode `0600`; no raw trace payload is retained by the added capture code.
- **Prior blockers:** the `d8397a23` Sol unmapped-span blocker is fixed by nearest-segment lookup that returns null for an explicit unmapped segment. The `d6c7fcef` Luna clock blocker is fixed structurally. The `7b56b44e` Luna metadata blocker is fixed by the exact `e3ac0459` two-file text correction. Prior verdicts remain unchanged historical records.

## Findings and limits

**No blocking finding in the reviewed diagnostic delta.** No new non-blocking code finding requiring remediation was found.

This review did not run Docker, SQL, browser/performance capture, or the complete PR suite. The exact-head PR check snapshot during review still included a failed `pull request template + security review` check and in-progress checks. Therefore this verdict does not authorize merge or claim usable current hosted CPU frames, G11 acceptance, strict cutover, or stage completion.

## Verdict

**CLEAR for the six-file CPU diagnostic/security-scope delta at the exact reviewed head, subject to the separate required PR gates and stacked-change reviews.** The prior Luna metadata blocker is resolved at this SHA; the structural diagnostic repair and its privacy boundary pass this full Sol review.

**Reviewed head:** e3ac04596499bd59772403bb4e0534b40dc1ac88
