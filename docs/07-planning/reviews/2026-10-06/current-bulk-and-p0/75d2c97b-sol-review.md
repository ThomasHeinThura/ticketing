# Independent GPT-6 Sol security/correctness review — P0 native CPU ordering

- **PR:** [#587](https://github.com/ThomasHeinThura/ticketing/pull/587)
- **Reviewer:** fresh independent GPT-6 Sol context. I did not author, direct, or remediate this candidate.
- **Reviewed head:** `75d2c97b6670e31cba41a82671e8cc7881cfc987`; GitHub PR head matched during review.
- **Comparison base:** `08842235047a3ab2714427edce80331b94558150` for the complete six-file diagnostic delta; the native-ordering repair was also compared directly with the earlier `e3ac04596499bd59772403bb4e0534b40dc1ac88` Sol-cleared head.
- **Tier:** required full independent Sol pass for a security-scope `apps/web/e2e/**` diagnostic. This pass addresses the newly observed native negative-delta class at the current exact head. It is separate from the P0 finalizer and other stacked PR reviews.

## Checks actually performed

- Read repository agent/workflow, SDLC/coding, status and decision guidance, the diagnostic testing contract, the earlier `e3ac` Sol report, all six files in the diagnostic delta, and the focused `e3ac..75d2` patch. `git diff --check 08842235..HEAD` passed.
- Verified against the pinned [native V8 profile generator](https://chromium.googlesource.com/v8/v8/+/cb5dfb7d734c416a7e6536c853f9be9f3eac587e/src/profiler/profile-generator.cc): each `timeDelta` is the signed microsecond difference between successive serialized sample timestamps (initially from profile start); `endTime` uses a different clock domain and should not repair sample timing. Negative deltas are therefore possible without malformed profile data.
- Ran focused web Vitest: **3 files, 26 tests passed** (`performance-cpu-profile-capture`, `performance-profile-attribution`, `performance-profile-intervals`). Web typecheck passed. Biome checked five diagnostic code/test files with no fixes. The worktree remained clean.
- Inspected the author-provided private local native artifact by reading its parsed fields: schema 7, one retained/complete profile, zero omissions, 161 sampled chunks, 2,058 nodes, 5,698 clipped samples, 45 top frames, three negative deltas in the recorded diagnostic chunk (`-24` to `-7` microseconds). All emitted clipped sample durations were positive, and their sum matched the reported union coverage, about 2.19 seconds. This is **local evidence only**, not a hosted G11 result or independent browser reproduction.

## Assessment

- **Timestamp reconstruction:** safe signed integer deltas are added in stream order, preserving the sample ID attached to each reconstructed timestamp. The final sort orders timestamp/node pairs before adjacent nonnegative intervals are derived. The retained total is bounded by the latest timestamp after profile start; sorting cannot create overlapping intervals or inflate the union of one profile. The explicit negative-delta regression checks sample ownership, chronological starts, nonnegative durations and a 254-microsecond total. Fractional, nonnumeric, nonfinite and unsafe deltas, or unsafe cumulative timestamps, drop the profile.
- **Bounds and omission:** the existing 32-profile, per-profile and capture-wide node/sample limits run before new arrays are built. A malformed admitted profile clears nodes and samples immediately and ignores later chunks for its key. Temporary per-chunk timestamp and negative-delta arrays remain within the same 100,000-sample per-profile / 200,000-sample capture bounds. Fixed rejection counters and numeric ordering diagnostics add no raw trace strings.
- **Trace boundary and identity:** the initial `Profile` timestamp is joined by PID/source/ID despite differing marker and chunk TIDs. The final `endTime` is not used as a sample-clock substitute. Intervals are clipped to the calibrated recorder span; prefix/suffix coverage is reported rather than invented. No timing threshold, fixture, retry rule or canonical G11 gate is changed.
- **Source maps and privacy:** the prior map digest and emitted-asset binding, unmapped-segment behavior, numeric coordinate checks, bounded acyclic caller ancestry and sanitization path remain intact. The new status fields serialize only fixed keys, capped counts, signed numeric summaries and nulls. Raw function labels, URL paths, map source/name strings and trace arguments are not added to the emitted artifact.

## Findings and limits

**No blocking finding in the reviewed six-file diagnostic delta.** One non-blocking clarity issue remains: `deltaOrderingDiagnostics` is overwritten when another negative-delta chunk is seen, so its `negativeCount` and extrema describe the last such chunk, not the full capture. The field/documentation should say that explicitly or aggregate it if a later consumer needs capture-wide counts. It does not affect sample reconstruction, attribution, privacy or acceptance thresholds.

The serialized `attributionMethod.cpuProfileClock` prose still says deltas accumulate in stream order but omits the new timestamp sort. That statement is true, but the schema-7 artifact would be clearer if it matched the expanded testing-strategy explanation. This is non-blocking metadata wording.

I did not run Docker, SQL, a browser capture, performance budgets, or the full PR suite. At review time GitHub still reported a failed `pull request template + security review` check and other checks in progress. This review does not clear those gates, hosted G11, strict cutover, P0 completion or merge.

## Verdict

**CLEAR for the six-file native CPU diagnostic/security-scope delta at the exact reviewed head**, subject to all separate required PR gates and stacked-change reviews. The native negative-delta defect class is addressed structurally without relaxing capture bounds or timing acceptance.

**Reviewed head:** 75d2c97b6670e31cba41a82671e8cc7881cfc987
