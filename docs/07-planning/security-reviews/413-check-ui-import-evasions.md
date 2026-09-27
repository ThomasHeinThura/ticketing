# PR #413 — rebuild check-ui.mjs's Radix-import detection on a real parser (issue #255)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (fell back from `pal-mcp` — three
calls, including a trivial connectivity ping, all timed out after 300s)
**Session:** subagent `a12e3040ee1fefcac`
**Verdict: APPROVE**, at head `c651e1198135b34a9c0c07ee1cc991df7656dbe5`.

**Reviewed head:** `c651e1198135b34a9c0c07ee1cc991df7656dbe5`

Verified the AST
rewrite closes the general class behind all 3 named evasions, not just the 3 instances.
Ran `check-ui.mjs` directly against the real repo to empirically settle a low-severity
question about tsconfig coverage for `scripts/**` files: clean exit, no spurious failures.

## Security review

**Model:** Opus 5.5
**Session:** subagent `a87c9c28081f72fac`
**Verdict: CLEAR WITH FINDINGS (F1/F2/F3 fixed in this PR)**, reviewed at head
`c651e1198135b34a9c0c07ee1cc991df7656dbe5`.

Ran 19 extra hand-picked evasion shapes beyond the 3 named in the issue — all correctly
caught; comments/plain strings/unresolved-substitution templates/`declare module`
correctly still ignored. Confirmed removing the two old file exclusions is safe (only 5
files in the repo mention Radix at all, all pass). Confirmed regression tests fail against
main's old regex and pass against the fix. Measured performance: 1.59s, ~314MB peak,
no cross-file diagnostic leakage.

**F1 (low, a genuine regression against main, fixed in this PR, commit
`139e39d8004f159a46a6c2f65c72dcc3239bd3b8`):** a member-call require
(`module.require("radix-ui/slot")`) was missed by the new detection, where the old regex
caught it. Fixed by also accepting a `PropertyAccessExpression` callee named `require`.
Added regression tests for both the fixed case and the still-correctly-uncaught
renamed/reassigned-require accepted limit.
**F2 (cosmetic, fixed):** the failure message read `.messageText`, which this API's
diagnostic objects don't have (confirmed empirically — `.text` is real), producing an
empty `()`. Fixed. `check-deps.mjs` has the same bug, out of scope here.
**F3 (cosmetic, fixed):** two stale comments in `check-tokens.mjs` describing
`check-ui.mjs`'s old regex mechanism, corrected.

Confirmed the whole-repo scan (no root tsconfig.json in this repo) completes cleanly with
no spurious "unparseable file" failures.

**Surfaces examined:** `scripts/ci/check-ui.mjs` in full, its test file,
`check-tokens.mjs`'s two touched comments, `check-deps.mjs` (shared F2 pattern, not fixed
there).

## Lightweight re-confirmation after F1/F2/F3 fix (2026-09-27)

A fresh, independent delta-review of these fixes is being commissioned separately (per
this project's rule that a functional code change cannot be self-certified by the session
that made it) — see the PR's own comments for the actual verdict once recorded.

---

## Independent delta-review of the F1/F2/F3 fix (2026-09-27)

**Reviewed head:** `49e04c116401a8f033dcf06f3b48d90490157588`
**Reviewer:** Opus 5.5, fresh independent context (subagent `a0188a4e4c40e240d`)
**Verdict: CLEAR WITH FINDINGS (none blocking).** Confirmed F1 (member-call require) fixed
by selectively reverting and re-running the new test (fails without, passes with). Confirmed
F2 (`.messageText` -> `.text`) empirically against the real `typescript@7.0.2` diagnostic
shape and by running the checker end to end. Confirmed F3's two comments no longer describe
the old mechanism. Full suite: 653/653. Real checker run: clean, 0 violations.

New findings, all accepted as non-blocking by the reviewer's own assessment: N1 (very low,
contrived) — `new require("x")`/`new module.require("x")` (constructor-call form) still
uncaught, same as `main`'s old regex; not worth holding the PR for. N2 (cosmetic, fixed
below) — a comment said evasions "stay outside the accepted limit" when it meant the
opposite (inside it, still uncaught). N3 (cosmetic, fixed below) — a stray line break. N4
(cosmetic, accepted) — no dedicated regression test for F2's message text; already verified
correct above.

## Mechanical follow-up: N2/N3 comment-only fix (2026-09-27)

**Reviewed head:** `df2c7a2c3a92f02fc53b3583b6b1e301ac0154c3`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR. This is genuinely mechanical, not a self-certified logic review: `git
diff 49e04c1..df2c7a2 -- scripts/ci/check-ui.mjs scripts/ci/check-tokens.mjs` shows every
changed line is a `//` or `*` comment — zero executable statements touched, confirmed by
inspection of the actual diff. Full suite re-run: 653/653, identical count to before the
change, consistent with no behavioral difference.

---

## Lightweight re-confirmation after branch update (2026-09-27)

**Reviewed head:** `969989763194a79dbf040e8db144c0432c4d835b`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. Empty diff on `scripts/ci/check-ui.mjs`,
`scripts/ci/check-ui.test.mjs`, and `scripts/ci/check-tokens.mjs` between the last reviewed
head (`139e39d8004f159a46a6c2f65c72dcc3239bd3b8` reflected via `49e04c1`/`bd88fed`) and this
one — the intervening commit brings in #405's already-reviewed schema-drift fix, zero
overlap with this PR's own files.
