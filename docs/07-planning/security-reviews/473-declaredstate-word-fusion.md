# Security review — declaredState()/meaningfulLines() word-boundary fix (#473, sibling of #152/#153)

**Reviewer (final):** Opus, fresh independent context commissioned by the orchestrating
session (via the `Agent` tool, `model: opus`, subagent id `a7ed178b0f88b3f2f` for the delta
confirmation; subagent id `aa901604ef3a7d059` for the first full round). Did not author,
direct, or remediate this change — every code edit in this pull request was made directly
by the orchestrating Claude Sonnet 5 session (see `## Implemented by` on the PR).
**Reviewed head:** `2361b3fe1e0acbc1cf81d1290b341731d2560c1c`
**Pull request:** #479 (closes #473), branch `fix/473-declaredstate-word-fusion`
**Date:** 2026-09-28

## Scope

`scripts/ci/lib/pr-body.mjs`, `scripts/ci/check-pr-template.mjs`, and their test files
(`scripts/ci/lib/pr-body.test.mjs`, `scripts/ci/probes/screens-opened-state.test.mjs`) —
all in `ci-cd.md`'s `scripts/ci/**` security-review-scope entry. No other path is touched
by this pull request, at any reviewed head.

## What the pull request does

PR #470 (already merged to `main`) fixed GitHub issues #152/#153 in `contentOf()`'s
by-hand deletion (not masking) of U+3000 IDEOGRAPHIC SPACE and its silent deletion of
Unicode bidi control characters, for the one caller (`check-reviews.mjs`'s Spec-field
extraction) that reused `contentOf`'s aggressively-stripped text for word-boundary-
sensitive parsing. #470's own mandatory Opus security review found and explicitly deferred
a sibling exposure (finding 4 of that review's round 1, tracked as this issue): `pr-body.mjs`'s
`declaredState()`/`meaningfulLines()` — feeding `check-pr-template.mjs`'s `## Screens opened`
n/a/blocked detection (AGENTS.md do-not 18) — apply the identical `INVISIBLE`-deletion
behaviour by hand, and `declaredState()`'s own `NOT_APPLICABLE_OPENER`
(`/^(?:n\s*\/\s*a|not\s+applicable)\b/i`) has the exact same dependency on a real word
boundary between "not" and "applicable" that #152 was about.

**Concretely:** an author writing `"not　applicable — nothing visual"` (U+3000 between
the words, routine from CJK input methods) previously got `meaningfulLines()` to delete
(not mask) the separator, fusing the two words into "notapplicable" — which the opener
regex never matches — so the section's declared state read as `"provided"` (a real
answer) instead of `"not-applicable"`. Since `apps/web/**` being touched makes an n/a state
a required failure, this bug meant the check would incorrectly PASS (exit 0) on an honest
n/a claim, treating it as though real screen evidence had been documented. The #153-class
render/parse mismatch applies too, independently confirmed by direct testing during
review (see round 1, below): a genuine Trojan-Source construction (U+202E RIGHT-TO-LEFT
OVERRIDE wrapping a reversed "not applicable", rendering as "not applicable" to a human on
GitHub while parsing, once the invisible override is silently deleted, as the literal
reversed string "elbacilppa ton" — not recognised by the opener regex, read as state
"provided") passes silently on pre-fix `main` (exit 0) and is correctly rejected on this
branch (exit 1).

**The fix** reuses #470's exact established pattern rather than re-deriving one:
`meaningfulLines()` now masks `WORD_SEPARATING_BLANKS` (U+3000, U+2800 — the same
`Default_Ignorable_Code_Point`-based two-character set #470 established) to a real space
instead of deleting them, and throws the same, reused `BidiControlCharacterError` on any
standard bidi control character, checked on the comment-stripped text before the
scaffolding-line filters — identical ordering rationale to #470's `wordBoundaryContentOf`.
`declaredState()`/`effectivelyNotApplicable()` propagate the error naturally.
`check-pr-template.mjs`'s one call site now catches it and reports an ordinary template
failure, without early-returning (every other template section still gets checked, unlike
`check-reviews.mjs`'s single-purpose early return).

## Review history

### Round 1 — ordinary review, `pal-reviewer` (Sonnet fallback — `pal-mcp` unreachable
this round), at `c72d7c4432d28595ba696bee168495f961347204`

**Verdict: CLEAR WITH NON-BLOCKING FINDINGS.** `pal-mcp`/9Router was completely
unreachable (four distinct tool calls, including a zero-parameter `listmodels`, all failed
identically) — the fallback to a fresh Sonnet context was used and recorded, per
CLAUDE.md's tier-substitution rule. Verified the fix pattern reuse directly against the
pre-#470 checkout available to it (confirmed `INVISIBLE` already lists U+2800/U+3000
literally, confirmed the mask-before-delete ordering is load-bearing), traced every
`declaredState`/`meaningfulLines`/`effectivelyNotApplicable` call site in `scripts/` (one
production call site, in `check-pr-template.mjs`, exactly the one this PR guards), and
confirmed the null-guard logic has no remaining unguarded `declared.state` access.

Non-blocking findings:
1. Architectural: `contentOf`, `wordBoundaryContentOf` (#470), and `meaningfulLines`
   (this PR) are now three independent by-hand reimplementations of "which characters
   count as invisible, and how" — recommended a shared low-level helper as a follow-up,
   not required for this PR.
2. Flagged `BIDI_CONTROL_CHARS`'s possible `g`/sticky-flag `lastIndex`-persistence risk
   for the Opus pass to check directly — **resolved below: no such flag exists.**
3. Trivial: `screens-opened-state.test.mjs` defines its own local `chr` helper duplicating
   `pr-body.test.mjs`'s — not blocking.

### Round 2 — Opus, at `c72d7c4432d28595ba696bee168495f961347204`

**Verdict: CLEAR WITH NON-BLOCKING FINDINGS.** Had real repo access and ran the actual
suites (179/179 pass at this head, the two files in scope). Ran a genuine Trojan-Source
probe (U+202E + reversed letters rendering as "not applicable" but parsing as ordinary
text) and confirmed `main` exits 0 (silently passes — the real gap) while the candidate
exits 1 (correctly rejects) — the exploit closed end-to-end, not just theoretically.

Three findings:
- **N1 (fixed in round 3).** The bidi-control-character regression test in
  `screens-opened-state.test.mjs` used an input (`n/a <RLO>— no UI`) that `main` ALSO
  already rejects with exit 1 (INVISIBLE silently deletes the bidi char, leaving
  "n/a — no UI", recognised as not-applicable, and apps/web-touched forbids n/a
  regardless) — so only the message-match half of the assertion was meaningful. Using the
  actual exploit input (U+202E + reversed text) would make it a true fail-before/pass-
  after test on the exit code itself.
- **N2 (fixed in round 3).** The bidi error message string was duplicated verbatim
  between `wordBoundaryContentOf` and `meaningfulLines`; a shared constant would prevent
  drift.
- **N3 (disclosed, not fixed).** A new doc comment contains a raw U+3000 character (not a
  bidi character, harmless, `contentOf`'s own existing doc comment already does the same
  thing) — worth knowing, not fixing.

### Round 3 (delta, final) — Opus, at `2361b3fe1e0acbc1cf81d1290b341731d2560c1c`

**Verdict: CLEAR.** Independently re-tested N1 by checking out `origin/main`'s pre-#473
`pr-body.mjs`/`check-pr-template.mjs` into the worktree and confirming the exact
Trojan-Source input (RLO + reversed "not applicable" + PDF) passes silently on old code
(exit 0) and correctly fails on the candidate (exit 1, "bidi control character" message) —
genuine fail-before/pass-after, independently reproduced rather than trusted from the
commit message. Confirmed N2 as a pure mechanical extraction: the new
`BIDI_CONTROL_CHARACTER_MESSAGE` constant is character-for-character identical to what it
replaced, both call sites otherwise unchanged. Confirmed N3 inert: U+3000 is ordinary
(non-bidi) whitespace, already precedented in the file's own existing doc comments.
Confirmed `BIDI_CONTROL_CHARS` carries no `g`/sticky flag by reading its actual
definition — round 1's `lastIndex`-persistence concern does not apply. 179/179 tests pass
across both source files. No new findings.

## Authorship

Same pre-existing local `.git/config` mismatch as #470 (`user.name = "Codex GPT-6"`,
present before this session, not something this session's tooling may change): every
commit on this branch is stamped with that author name regardless of who wrote the code.
Every line of every diff in this pull request was written directly by the orchestrating
Claude Sonnet 5 session's own `Edit`/`Write` tool calls — no `pal-mcp`/`coder`-chain call
was used for any implementation step, only for the ordinary review recorded above.
`## Implemented by` on the PR names the real author, per the repository's own
commit-identity-mismatch remedy (decision log, 2026-09-23).

## Independence

Every review round above was either a fresh Opus subagent (`Agent` tool, `model: opus`) or
the `pal-reviewer` subagent (Sonnet fallback this round, `pal-mcp` unreachable, recorded
per CLAUDE.md's tier-substitution rule), neither of which authored, directed, or
remediated any part of this change — every fix was applied directly by the orchestrating
session in response to a finding.

## Verdict

**CLEAR at `2361b3fe1e0acbc1cf81d1290b341731d2560c1c`.** Certified final by the mandatory
Opus security review (round 3, delta), following a full first round (round 2) and an
ordinary review (round 1). Both non-blocking findings that warranted a fix (N1, N2) are
fixed and independently reverified; the one disclosed-not-fixed finding (N3) is confirmed
inert. No network-reachable surface, authority change, or gate-semantics change is
introduced by this pull request — it is a CI-script parsing fix, reusing an
already-established, already-reviewed pattern for one sibling function family.

---

## Mechanical reconfirmation after merging main past PR #475 and PR #476 (c2d540e5)

**Confirmed by:** the orchestrating session, directly — not a fresh Opus pass.

**Why this needed more than a disjoint-file check:** PR #476 (issue #474's `<!-->` empty-
comment fix, merged `11f328e1`) also touches `scripts/ci/lib/pr-body.mjs` and
`scripts/ci/lib/pr-body.test.mjs` — the same two files this PR changes. This is a real
content overlap, not just two branches touching unrelated files.

**Verified beyond a diff check:** in a fresh worktree at this branch's post-update head
(`c2d540e5`), with `node_modules` symlinked read-only from the shared checkout, ran
`node --test scripts/ci/lib/pr-body.test.mjs scripts/ci/probes/screens-opened-state.test.mjs`:
**185/185 pass, 0 fail.** This includes both PR #476's own `<!-->`/`<!--->` regression tests
and this PR's own bidi/word-fusion regression tests, confirmed via direct grep that both
`stripComments`' complete-empty-comment handling (PR #476) and `wordBoundaryContentOf`'s
`BidiControlCharacterError` (this PR) are present in the merged file — both fixes coexist
and function together, not one silently overwriting the other.

**PR #475 is also in this branch's history** (`bbdc027e`, disjoint — touches only
`scripts/ci/check-reviews.mjs` and its own test file, confirmed via `git show --stat`
earlier in this reconfirmation pass).

**Verdict:** the Opus clearance at `2361b3fe` remains valid at `c2d540e5`.

**Reviewed head:** `c2d540e59c9612721d406471e561bc7290ab3662`
