# PR #418 — regex-vs-division disambiguation in strip-code-comments.mjs (issue #143)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (fell back from `pal-mcp` — genuinely
unreachable, two calls timed out after 300s)
**Session:** subagent `aeb8f56a451171dbe`
**Verdict: findings, corrected.** Flagged one HIGH concern (claimed tests absent) that was
a false alarm from reading the wrong checkout (no git access); verified directly against
the real PR head that all 5 tests are genuinely present. Kept one real finding: `of` is a
contextual keyword, not reserved, and collides with real identifiers.

**Reviewed head:** `b83c0cfd137627c6151b5054a323e4e0c6ebda14`

## Security review

**Model:** Opus 5.5 (three passes)
**Session:** `a08cc97fc9cd8349f` (pass 1), `a794db1bc51ffc40b` (pass 2, delta),
`ac89706e905ad30f5` (pass 3, final confirmation)

**Reviewed head:** `b83c0cfd137627c6151b5054a323e4e0c6ebda14`

**Pass 1 verdict: BLOCKING.** Confirmed the core #143 fix correct and `check:skips`
genuinely exposed. Found the `of`-collision finding was real AND broader: every keyword in
`REGEX_ALLOWED_KEYWORDS` is also a legal property name (`mod.default`, `o.in`), unhandled
by the first fix — and traced the damage as potentially worse than #143's original bug
(a misread regex whose "closing" `/` lands inside a string/template can hide code across
multiple lines, not just one).

**Reviewed head:** `97622f039d303490f67125b9ce402706eb4818f0`

**Pass 2 verdict: CLEAR WITH FINDINGS (all Low/informational).** Delta-review of the `of`
removal + `.`/`?.` property-access exemption. Ran the old and new scanner over all 1,350
tracked source files — exactly one line differs, a real bug newly caught correctly,
nothing newly hidden. Found 4 minor items: (A) doc comment overclaimed whitespace-skipping
behavior the code doesn't have; (B) stale keyword-list mention in the header; (C) a weak
test that didn't actually exercise what it claimed; (D, the one substantive item) private
class fields (`this.#default`, `this.#in`) have the same collision the `.` check didn't
cover, since `#` sits between the dot and the word.

**Reviewed head:** `764800c120166b3a63b485471893b83042da5e23`

**Pass 3 verdict: CLEAR.** Final confirmation of the private-field (`#`) fix plus findings
A/B/C. Confirmed the `#` check is sound (only looks at the character immediately before
the word; `#` only ever precedes a private name in valid JS, never over-suppresses).
Re-ran the corpus-wide comparison: still exactly one line differs, still a correct catch,
nothing newly hidden. Confirmed `of` genuinely removed, not just relocated. Full test
suite: 664/664 (with `node_modules` linked; the 6 "failures" elsewhere are a fresh-worktree
environment artifact). No further findings — three remaining items (non-strict-mode
`await`/`yield` as identifiers, non-ASCII identifiers ending in a keyword, whitespace
between `.` and a property name) are all informational: none occur in this repository's
actual ESM/TS source.

**Filed as a follow-up, correctly out of scope:** #421 (switch to the TypeScript compiler's
real tokenizer — third review-found gap in this exact hand-rolled scanner).

**Surfaces examined across all three passes:** `scripts/ci/lib/strip-code-comments.mjs` in
full, its full test file, `scripts/ci/check-skips.mjs` (confirmed live consumer),
`scripts/ci/check-events.mjs` and a probe test (confirmed same-scanner consumers, not
independently re-audited beyond the corpus-wide output comparison).
