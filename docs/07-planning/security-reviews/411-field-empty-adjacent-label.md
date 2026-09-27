# PR #411 — `field()` adjacent-blank-label bug (issue #409)

## Ordinary review

**Model:** pal-mcp (`coder` failover chain), via the `pal-reviewer` subagent
**Session:** pal-reviewer subagent `afd736bddb1fd6653`
**Verdict: APPROVE**, at head `5e3342ff438eb842102d3d1d03945cf97f74bfc4`.

**Reviewed head:** `5e3342ff438eb842102d3d1d03945cf97f74bfc4`

Independently verified the 2026-09-27 full-unsuspension decision-log entry before proceeding.
Hand-traced the `\s*` → `[ \t]*` narrowing for both LF and CRLF field bodies — correctly
stops the whitespace-eating at the line terminator in both cases. Confirmed the capture
group `(.*)$` is untouched, so issue #150 (multi-line-value truncation) is unaffected.
Confirmed via grep every real caller of `field()` (`check-reviews.mjs`'s `Spec` field,
`check-pr-template.mjs`'s Model/Session/Security-review fields) routes through this one
shared function. Noted independent prior art: `security-review-note.mjs`'s `ATTESTATION`
regex already uses the identical same-line-only whitespace pattern.

One low-severity, non-blocking note: could not read the actual new test file directly (no
branch access from its environment) and suggests explicit CRLF/tab/trailing-padding test
cases as a coverage nice-to-have — the regex logic itself handles all of these correctly by
construction.

## Security review

**Model:** Opus 5.5
**Session:** subagent `a6b94ea1f493d6d04`
**Verdict: CLEAR WITH FINDINGS**, at head `5e3342ff438eb842102d3d1d03945cf97f74bfc4`.

**Reviewed head:** `5e3342ff438eb842102d3d1d03945cf97f74bfc4`

Confirmed the fix closes the described gap for every field the checkers rely on — ran both
the old and new `field()` against this PR's own real body and the real
`.github/pull_request_template.md`; the old code returned `"**Session:**"` for a blank
`## Reviewed by` Model field (non-empty, so the "must be filled in" check would have
silently passed an unreviewed PR). Ran `node --test scripts/ci/lib/pr-body.test.mjs`
directly: 126/126 pass at this head; the same suite against the pre-fix code has exactly 5
failures, all the new empty-detection tests, confirming they are real regression tests.
Confirmed issue #150 is unaffected (the capture group is untouched) and that
`security-review-note.mjs`'s `ATTESTATION` regex does not have this same bug (already
same-line-only).

**Findings (all non-blocking):**

1. **Informational.** 8 already-merged PRs (#306, #307, #313, #321, #322, #323, #336, #350)
   passed the old "filled in" check only because of this exact bug (session value written
   on the paragraph below the label instead of the same line); their reviews were real,
   just not in the expected format. Going forward, `**Session:**` needs its value on the
   same line or the checker now correctly rejects it. Recommend a follow-up issue tracking
   this as a documentation/process note, not a re-review of those 8 PRs' actual content.
2. **Low.** A new test's comment describes the bug backwards (says Model was the non-empty
   one; it was Session).
3. **Low.** The "distinctness" test compares hardcoded strings rather than exercising the
   real comparison function in `check-pr-template.mjs`.
4. **Low, pre-existing, not introduced by this PR.** `## Implemented by`'s own Model/Session
   aren't required non-empty by the checker, and `field()` doesn't strip zero-width/invisible
   characters the way `contentOf()` does (same class of gap as #409, deliberate-only).

**Surfaces examined:** `scripts/ci/lib/pr-body.mjs`'s `field()` and its full test file;
`scripts/ci/lib/security-review-note.mjs`'s `ATTESTATION` regex (checked for the same bug
class — not present); `scripts/ci/check-reviews.mjs`'s `Spec` field caller; CI's live run at
this SHA.

**What was not checked:** the full repo `pnpm test`/lint/typecheck; `check-pr-template.mjs`
end to end locally (relied on the CI log at this SHA instead); `sections()`/`stripComments()`
beyond how `field()` uses them.

---

## Lightweight re-confirmation after branch update, round 2 (2026-09-27)

**Reviewed head:** `6cedb28be14f1e89ad33c9e48ddf6b5f0637d5cd`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. Empty diff on `scripts/ci/lib/pr-body.mjs` and
`scripts/ci/lib/pr-body.test.mjs` between the last reviewed head
(`5e3342ff438eb842102d3d1d03945cf97f74bfc4`) and this one — the intervening commits bring in
#404's already-reviewed unique-violation fix and #408's already-reviewed keyboard-shortcuts
fix, zero overlap with this PR's own files.
