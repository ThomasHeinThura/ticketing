# Security review — `<!-->`/`<!--->` empty-comment fix (#476, closes #474)

**Reviewer:** Opus 5.5, fresh independent context commissioned by the orchestrating session
(via the `Agent` tool, `model: opus`, subagent id `a1a642c44af5b28bd`). Did not author,
direct, or remediate this change — every code edit in this pull request was made directly
by the orchestrating Claude Sonnet 5 session (see `## Implemented by` on the PR).
**Reviewed head:** `7e20283014e582af3088c3737e023f583304ae81`
**Pull request:** #476, branch `fix/474-strip-comments-empty-comment`
**Base:** `593df1307456c6134fdad8cd064c97874be082fe` (PR #470, merged)
**Date:** 2026-09-28

## Scope

`scripts/ci/lib/pr-body.mjs` and `scripts/ci/lib/pr-body.test.mjs` — both in `ci-cd.md`'s
`scripts/ci/**` security-review-scope entry. No other path is touched by this pull request.

## What the pull request does

Fixes GitHub issue #474: `stripComments()`/`stripCommentsWithPositions()` detected the
4-character opener `<!--` and always scanned forward to the NEXT `-->` anywhere later in
the string. Per the CommonMark/GFM HTML-comment grammar, a bare `<!-->` or `<!--->` is a
COMPLETE, self-closing EMPTY comment on its own — everything after one is ordinary visible
text on GitHub, never comment content.

Confirmed exploitable against a real gate: `sections()` (the `##`-heading variant) and
`headingBlocks()`/`visibleHeadingName()` (the `###`-checklist-block variant) both derive
their own heading-visibility check from this same scan via `survivedRawIndices`. A blank
required section, followed by `<!-->`, then a later genuine heading with an unrelated inner
comment and real prose, got misparsed: the inner comment's own real `-->` was mistaken for
the fake opener's closer, hiding the real heading (never recognised as a section boundary)
while its prose survived the isolated per-section re-strip and folded backward into the
still-open earlier section — reading as filled in, while the real section vanished
entirely. Reproduced directly against both variants before the fix (empirically, not just
reasoned): `sections()` returned only `["screens opened", "gates"]` with `"screens
opened".content` equal to the misfolded "Testing notes" prose; `checklistProblems()`
returned `[]` for a genuinely blank required `### Backend change` block.

The fix: in both `stripComments()` and `stripCommentsWithPositions()`, immediately after
the existing 4-char opener detection, a following `>` or `->` now closes the comment
immediately instead of falling through to the pre-existing `findClose`/`indexOf("-->", i)`
scan. Neither new branch pushes the consumed closing character(s) into the retained output
(or `positions` array), so the existing CodeQL-alert-#4 reconstitution-attack defense —
which re-checks the tail of the retained output after every push — is unregressed.

## Review history

### Ordinary review — Sonnet fresh context (via the `pal-reviewer` subagent), fallback recorded

`pal-mcp`/9Router was unreachable for the entire session (every tool call, including a
bare parameterless `listmodels`, returned `Invalid request parameters`) — per CLAUDE.md's
explicit fallback clause, the review fell back to the subagent's own fresh Sonnet context,
recorded here as required. **Verdict: CLEAR WITH NOTES**, no blocking findings.

Independently re-derived the exact two complete-empty-comment forms (`<!-->`, `<!--->`)
from the WHATWG HTML5 tokenizer's comment-state transitions, confirmed by hand-tracing that
any additional dash before the closing `>` (e.g. `<!---->`, `<!----->`) already contains a
literal `-->` substring and was never broken by the pre-fix scan. Hand-traced the
reconstitution regression test (`stripComments("<!<!-->--")`) character-by-character and
confirmed the reconstituted opener is still caught and fails closed to `""`. Grepped the
whole `scripts/ci/**` tree and confirmed `stripComments()`/`stripCommentsWithPositions()`
are the only two ad-hoc HTML-comment scanners in the tree — no sibling implementation
shares the defect (this repository's own N4 question below, independently answered the
same way twice — see "Follow-ups" below). Confirmed the differential-oracle reference
implementation's two new branches are semantically equivalent to the production fix's.

Noted, non-blocking: could not cross-check the CommonMark/cmark-gfm spec claim against a
live source this session (`apilookup` also unreachable) — reasoned from the HTML5
tokenizer instead, which the author's own doc comment and the separate Opus pass below
both independently corroborate.

### Security review — Opus 5.5, at `7e20283014e582af3088c3737e023f583304ae81`

**Verdict: CLEAR WITH NON-BLOCKING NOTES.** No blocking findings.

Confirmed: the fix is correct and applied identically at both call sites; the
reconstitution defense is unregressed (traced the same mechanism the ordinary review did,
independently); the regression tests fail before the fix and pass after, and the fold-
backward mechanism is exactly as reported — with one precision correction to the author's
own reasoning: the prose that folds backward survives because it sits AFTER the real
(inner, unrelated) closer in both the global and the isolated per-section re-strip passes,
not because "the re-strip starts fresh" (same conclusion, more precise mechanism).
Confirmed the fuzz-oracle update is faithful to the shipped code's branching. Confirmed
`scripts/ci/lib/pr-body.mjs` is correctly in security-review scope, and that the bounded
size of this fix (no authority/gate-semantics redesign) makes one ordinary review plus this
Opus pass the right tier, not the full three-round tier.

Six non-blocking notes (N1–N6), all pre-existing in `pr-body.mjs`'s comment/content model
and not introduced by this PR:

- **N1 (high confidence)** — the same fold-backward mechanism is reachable through other
  `<!--`-shaped openers GitHub does not treat as a comment at all (mid-line, inside a code
  span or fenced block, escaped `\<!--`, inside an indented code block, inside an HTML
  attribute value). Filed as [issue #477](https://github.com/ThomasHeinThura/ticketing/issues/477).
- **N2 (medium confidence)** — the inverse, more dangerous direction: markdown GitHub
  renders as nothing (link reference definitions, processing instructions/`<!DOCTYPE>`/
  `<![CDATA[`, `<script>`/`<style>` elements) that the gate may still count as content,
  which could let a required section pass "not blank" with text a reviewer never actually
  sees. Filed as [issue #478](https://github.com/ThomasHeinThura/ticketing/issues/478).
- **N3 (low)** — the HTML5 `--!>` abrupt-closing form is not special-cased; no concrete
  bypass found in block context. Left as a note for whichever fix addresses N1/N2.
- **N4** — whether any other file in `scripts/ci/**` has its own independent
  comment-stripping logic sharing the same defect. **Answered directly, twice,
  independently** (by this orchestrating session via `grep -rln '<!--' scripts/ci
  --include="*.mjs" | grep -v '\.test\.mjs'`, and separately by the ordinary reviewer's own
  grep): no other file matches. `stripComments()`/`stripCommentsWithPositions()` in this
  one file are the only ad-hoc HTML-comment scanners in the tree. No follow-up issue filed
  — this is a negative finding, not an actionable gap.
- **N5 (cosmetic)** — the new doc comment calls `<!-->` a "complete empty comment"
  unconditionally; precise at block level and under CommonMark 0.31, but under
  CommonMark 0.29/0.30 inline parsing it is literal text (harmless either way, since what
  follows is visible in both readings). Not fixed in this PR; left as a documentation nit.
- **N6 (cosmetic)** — no test asserts the `stripCommentsSteps` counter specifically for the
  two new branches. Not fixed in this PR; the existing linearity/complexity-guard tests
  cover the scanner's overall step-counting behaviour.

## Follow-ups filed

- [#477](https://github.com/ThomasHeinThura/ticketing/issues/477) — N1, other openers
  GitHub doesn't treat as comments.
- [#478](https://github.com/ThomasHeinThura/ticketing/issues/478) — N2, markdown GitHub
  hides that the gate may still count as content.

Both real, plausible follow-on exposures in the same file's comment/content model, neither
blocking this PR — same disposition CLAUDE.md's review-tier guidance calls for: close the
confirmed, scoped finding now; track the newly-surfaced adjacent classes as separate,
properly-scoped work rather than expanding this PR's diff.

## Authorship

Every line of every diff on this branch was written directly by the orchestrating Claude
Sonnet 5 session's own `Edit`/`Write` tool calls. No implementation step used `pal-mcp`.
