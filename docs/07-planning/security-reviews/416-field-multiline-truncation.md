# PR #416 — field() multi-line capture (issue #150)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (fell back from `pal-mcp` — a
`relevant_files` call returned zero embedded content and a follow-up with content pasted
inline timed out after 300s)
**Session:** subagent `ab40462af41846b87`
**Verdict: APPROVE**, at head `3a57074d97695e51f6e50c91e5f2b3a81102ba6b`.

**Reviewed head:** `3a57074d97695e51f6e50c91e5f2b3a81102ba6b`

Hand-traced the original multi-line regex, confirmed #409's fix unweakened, confirmed no
new call site added.

## Security review

**Model:** Opus 5.5 (four passes total)
**Session:** `ac16c593ae04ee25a` (pass 1), `a0273d37b76c6d09d` (pass 2, delta),
`a4e3a002b7021625e` (pass 3, delta), `a883fa1b873f5434b` (pass 4, final confirmation)

**Reviewed head:** `3a57074d97695e51f6e50c91e5f2b3a81102ba6b`

**Pass 1 verdict: BLOCKING.** Found a reopened #409 variant (empty label followed by
blank-line-then-prose, a `### ` sub-heading, or bare-CR line endings all read as filled).

**Reviewed head:** `ae12e940e433513f7841439a103fc63c897472c6`

**Pass 2 verdict: BLOCKING.** Delta-review of the round-1 fix (boundary extended to also
stop at a blank line and any-level heading, plus CR normalization). Found the extended
boundary was still incomplete — a plain continuation line, a blockquote, a list item, a
thematic break, and a code fence immediately after an empty label (no blank line) all
still read as filled, and critically, a genuinely filled `Session` value with a trailing
note on the very next line could defeat the "reviewer must differ from author" self-review
check. Recommended a structural fix instead of another boundary: only `check-reviews.mjs`'s
`Spec` field needs multi-line capture (safe to over-capture there); the five
security-sensitive `check-pr-template.mjs` calls should get a mode that discards
everything past the first line break unconditionally.

**Reviewed head:** `02f36844f32e5eee9262255b9fbad76e477a176f`

**Pass 3 verdict: CLEAR WITH FINDINGS (Medium, non-blocking).** Confirmed the structural
fix (`{ firstLine: true }` for the five security-sensitive calls, default multi-line only
for `Spec`) genuinely closes the bug class — ran a 600,000+case differential fuzz between
old and new `field()` behavior and a 300,000+case fuzz of the `Spec` caller's real logic,
finding zero divergence and zero cases where fewer files get checked. One finding: the
safe mode was opt-in (`firstLine: true`) rather than the default, so a misspelled option or
a future call omitting it would silently fall back to the unsafe mode.

**Reviewed head:** `08cc5a9e419891b1d38ba9d778730d99d206abe0`

**Pass 4 verdict: CLEAR.** Delta-review of the default-flip (single-line is now the
default with no options; `{ multiLine: true }` is the explicit opt-in). Confirmed the
underlying regex logic in both branches is byte-for-byte identical to what pass 3 already
fuzz-tested — only the branch-selection condition changed. Confirmed all 5
security-sensitive calls pass no options, confirmed `Spec` passes `{ multiLine: true }`
explicitly, confirmed passing `{}` behaves identically to omitting the argument, confirmed
no typo can reach the unsafe mode. Full test suite: 678/678. No further findings.

**Surfaces examined across all four passes:** `scripts/ci/lib/pr-body.mjs`'s `field()` in
full, `scripts/ci/check-pr-template.mjs`'s five call sites, `scripts/ci/check-reviews.mjs`'s
one call site, the full `pr-body.test.mjs` test file.

**Note on process:** this PR went through four Opus passes because each of the first three
found a real, security-relevant gap in the mechanism that detects an unreviewed or
self-reviewed PR — not because of unnecessary re-litigation. Each finding was closed with
a real fix and independent re-verification before proceeding, per this project's own
standard for a mechanism this sensitive.
