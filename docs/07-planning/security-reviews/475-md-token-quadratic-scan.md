# Security review — #475: `check-reviews.mjs` `.md`-token extraction made linear (#154)

**Reviewed head:** `86f19081321ab64882af9a380d2b6356e5a26cc7`
**Reviewer:** Opus 5.5, a fresh independent subagent context (a76c5da99fc64f902)
commissioned by the implementing session. It did not author, direct or fix this change.
**Surfaces examined:** `scripts/ci/check-reviews.mjs` (security-review scope per `ci-cd.md`,
the CI/gate-machinery entry): the new `mdTokens()`, its two call sites in `fieldOpener()` and
`specsNamedIn()`, and the edited comments in `main()`. Also the new
`scripts/ci/probes/md-token-scan-performance.test.mjs`.
**Verdict:** CLEAR WITH FINDINGS. Nothing blocking. One Low, two Info.

## What was checked

The reviewer worked from the pasted diff only. It did not clone the repository. It did run the
pasted `mdTokens()` next to the old regex in a scratch Node 24.20 script outside the
repository.

- **Gate semantics unchanged.** `mdTokens()` returns the same matches as
  `/[a-z0-9-]+\.md/gi` with `matchAll`: same `index`, same `[0]` text, same order. The
  lowercasing afterwards is unchanged. So the do-not-15 gate checks exactly the specs it
  checked before.
  - Why they agree: the regex can only match at the start of a maximal run of allowed
    characters. A shorter prefix can never be followed by `.`. After a match both versions
    continue from its end (`i += 3`), so back-to-back tokens like `foo.mdbar.md` behave the
    same.
  - Case-insensitivity: without the `u` flag, the regex's `i` flag never lets a non-ASCII
    character match an ASCII one (`ſ`, `ı`, `İ`, the Kelvin sign). The reviewer checked every
    code point from U+0080 to U+10FFFF. None lowercases to `.`, `m` or `d`, so the
    `.toLowerCase()` suffix check accepts nothing the regex rejects.
  - Differential tests, zero mismatches: every string up to length 8 over
    `{a, -, ., m, D, _}` (2,015,539 strings), and 2,000,000 random strings up to length 20
    including `İ`, the Kelvin sign, `ſ`, `ı`, `é`, a surrogate pair, a lone surrogate,
    newline, backtick and `/`.
  - Extracted names still cannot contain `/` or `.`, so no path traversal, as before.
- **Linear time confirmed.** `mdTokens`: 0.21 ms at 60k characters, 0.34 ms at 120k,
  0.79 ms at 240k, 1.57 ms at 480k. Old regex: 303 ms at 15k, 1185 ms at 30k, 4329 ms at
  60k, about 4x per doubling, which matches #148's measurement. Other shapes (`a.`, `a.m`,
  `a.md` giving 60k matches, `-`, each repeated) finish in 15 ms or less and match the regex.
- **Security angle.** Removing a super-linear regex from a script that reads an untrusted
  PR body is a strict improvement. No new injection path. The output is still only
  compared against review-document heading names.
- **The PR's evidence is plausible.** The PR reports ~17.9 s with the fix reverted at 120k,
  which fits the reviewer's own regex numbers scaled up. Against ~200 ms with the fix, the
  4000 ms budget has roughly 20x headroom on both sides, so the test is neither flaky nor
  vacuous.

## Findings

- **F1 (Low, test strength):** the perf test's filename assertions only prove extraction if
  the checker prints the names it extracted, not the raw Spec field. Optional follow-up
  suggested: a fixture with an open review section, asserting that the checker fails.
  **Resolved by source inspection (implementing session):** `check-reviews.mjs` writes to
  stdout only through `finish()` (`scripts/ci/lib/repo.mjs`): the ok line, failures (which
  print the review-document heading, not the Spec field), and one warning,
  `spec(s) named in this change: <sorted extracted names>`. The raw Spec field is never
  echoed, so the current assertions do prove extraction. No code change made.
- **F2 (Info):** confirm that no other reference to `MD_TOKEN` survives. **Resolved:** a grep
  of `scripts/` at this head finds `MD_TOKEN` only in comments and a test-name string, with no
  code reference left. A missed one would have raised a `ReferenceError` and failed CI
  anyway.
- **F3 (Info):** the timing test covers one input shape. The other regexes on the same path
  (opener detection, `withOpenerWordMasked`, `field()`'s Spec extraction, `specSections`)
  are outside this diff and were not checked for their own worst cases. Not something this PR
  needs to fix. Recorded as not checked.

## Not done

The reviewer did not check the rest of `check-reviews.mjs`, `scratch-repo.mjs`, or the 18
existing `spec-na-detection.test.mjs` tests (it took the author's word that they pass). It
also did not check real CI results for this SHA, branch protection, or the PR's `## Gates`
table.

This review covers this head only. A later commit outside
`docs/07-planning/security-reviews/` voids it.
