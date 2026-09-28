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

---

## Mechanical reconfirmation after merging main past PR #470/#472 (620fdb1d)

**Confirmed by:** the orchestrating session, directly — not a fresh Opus pass.

**Why this needed more than the usual disjoint-file check:** `main` advanced to `593df130`
(PR #470, issues #152/#153) and `8446252a` (PR #472, docs) while this branch was open.
Unlike prior reconfirmations this session, PR #470's own diff **does** touch
`scripts/ci/check-reviews.mjs` — the same file this PR changes — so this is not a case of
disjoint files; it is two real, independent changes to the same file that a 3-way merge
combined automatically (no manual conflict resolution was needed, and none was done).

**Verified beyond a diff check:** rather than argue disjointness, ran the actual merged code.
In a fresh worktree at the merge commit `620fdb1d`, with `node_modules` symlinked read-only
from the shared checkout, ran `node --test scripts/ci/check-reviews.test.mjs
scripts/ci/probes/md-token-scan-performance.test.mjs scripts/ci/probes/spec-na-detection.test.mjs`:
**22/22 pass, 0 fail** — this includes both PR #470's own issue #152/#153 regression tests
(the U+3000 word-fusion case and the U+202E bidi-override case, both still passing against
the merged code) and this PR's own linear-scan regression test. Confirmed via direct grep
that the merged file contains both `wordBoundaryContentOf` (PR #470's import, used by the
Spec-field opener check) and `mdTokens` (this PR's rewrite, used at both of `MD_TOKEN`'s
former call sites) — both fixes are present and functioning together, not one silently
overwriting the other.

**Verdict:** the Opus clearance at `86f19081` remains valid at `620fdb1d`. This is a stronger
basis than the usual disjoint-file argument: it's a real, passing test run of the actual
merged code, not an inference from which files changed.

**Reviewed head:** `620fdb1d0d0d3d3dab6c2a1f32c3ff8d2a7bf93f`
