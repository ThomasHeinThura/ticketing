# Security review — contentOf() word-boundary/render-parse fix (#470, closes #152, #153)

**Reviewer:** Opus 5.5, fresh independent context commissioned by the orchestrating
session (via the `Agent` tool, `model: opus`, subagent id `afab9c309989f6cc5`). Did not
author, direct, or remediate this change — every code edit in this pull request was made
directly by the orchestrating Claude Sonnet 5 session (see `## Implemented by` on the PR
and "Authorship," below).
**Reviewed head:** `386f787c2e7c0a66919a2451cc9b56bf8303af6b`
**Pull request:** #470, branch `fix/152-153-contentof-boundary-bugs`
**Date:** 2026-09-28

## Scope

`scripts/ci/lib/pr-body.mjs` and `scripts/ci/check-reviews.mjs` — both in `ci-cd.md`'s
`scripts/ci/**` security-review-scope entry. No other path is touched by this pull
request, at any reviewed head.

## What the pull request does

Fixes GitHub issues #152 and #153: `contentOf()` deletes (not masks) U+3000 IDEOGRAPHIC
SPACE and the whole Unicode `\p{Cf}` format-character category, which is correct for its
own purpose (deciding whether a whole section is blank) but was silently reused by
`check-reviews.mjs`'s word-boundary-sensitive Spec-field opener detection, causing:

- **#152:** a "not applicable" declaration separated by U+3000 (a real word separator CJK
  input methods commit routinely) to be fused into "notapplicable" and go unrecognised,
  so a genuinely-named spec's open review findings were silently never checked
  (AGENTS.md do-not 15).
- **#153:** a bidi control character (e.g. U+202E RIGHT-TO-LEFT OVERRIDE) to be silently
  deleted, letting a pull-request body render one way to a human reviewer and parse a
  different way to the gate — a "Trojan Source"-class mismatch.

The fix adds `wordBoundaryContentOf()`, used only by `check-reviews.mjs`'s one
word-boundary-sensitive call site. `contentOf()` itself, and every other caller relying on
its blankness-stripping behaviour, is unchanged.

## Review history

Five rounds. Kept in full below, per this repository's own convention (see
`346-identity-domain.md`) of recording what was found and corrected rather than smoothing
the history down to only the final answer.

### Round 1 — Opus, at `c189cf9521cd5e2722dc4b1c324a262b5d6f6d25`

**Verdict: CLEAR WITH FINDINGS (non-blocking).** Six findings:

1. **LOW (fixed in round 2).** The bidi-control-character test ran on the text AFTER the
   template-scaffolding line filters, so a bidi character embedded inside an otherwise
   label-only line (`"**No<U+202E>te:**\n**Spec:** n/a"` — the label's own `[^*]+` swallows
   the bidi char, so the whole line still matched the label-only filter and was dropped
   before the bidi test ever saw it) escaped detection, even though GitHub still renders
   that line as part of the same paragraph as the content after it.
2. **LOW, hygiene (fixed in round 2).** The `BIDI_CONTROL_CHARS` regex, and the new test
   files, embedded raw literal bidi control characters directly in tracked source — the
   one thing a fix for issue #153 (Trojan Source) should not itself do, since a raw
   literal renders oddly in every diff viewer, editor and `git blame`.
3. **LOW (fixed in round 2, then corrected twice more — see rounds 3–5).** Only U+3000 was
   masked to a space; the other non-format blank-renderers `INVISIBLE` already lists
   (U+2800, U+3164, U+115F, U+1160, U+FFA0, U+17B4, U+17B5) share the identical
   deletion-fuses-words exposure in principle.
4. **LOW, follow-up (deliberately out of scope for #152/#153).** `declaredState()`/
   `meaningfulLines()` (used by `check-pr-template.mjs`'s `## Screens opened` n/a
   detection) apply the same `INVISIBLE`-based deletion by hand and share the identical
   U+3000-fusion exposure. Tracked as
   [issue #473](https://github.com/ThomasHeinThura/ticketing/issues/473).
5. **INFO (fixed in round 2).** The `check-reviews.mjs` failure message said "the Task
   section's Spec field" when the bidi check actually scans the whole Task section's raw
   text.
6. **INFO, follow-up (pre-existing, not introduced by this PR).** `stripComments()` may
   mishandle a bare `<!-->` as an opener rather than a complete, empty comment, hiding
   real content from the gate while GitHub renders it — not verified against actual
   GitHub rendering by this reviewer. Tracked as
   [issue #474](https://github.com/ThomasHeinThura/ticketing/issues/474), **since
   confirmed exploitable** by a separate investigation dispatched in parallel with this
   PR (full write-up on that issue's thread); queued as its own fix after this PR merges,
   since it touches the same file.

### Round 2 (delta) — Opus, at `e49a9502151fb4a24a954582bd39795f52862ad9`

**Verdict: CLEAR WITH FINDINGS (non-blocking).** Confirmed findings 1, 2, 3 and 5 fixed —
re-derived each independently from the code, confirmed the bidi regex still matches the
same 12 code points after being rebuilt from `String.fromCodePoint`, confirmed zero raw
bidi characters remain in the four touched files, ran the full suite (826 tests, 0 fail).

New finding:

- **N1 (fixed in round 3).** Round 2's generalisation of finding 3 masked *all* of
  `INVISIBLE`'s L6 blank-renderers to a space, including four (U+115F, U+1160, U+17B4,
  U+17B5) the reviewer believed render with no visible width. Masking a genuinely
  zero-width character to a space reopens the exact render/parse mismatch issue #153 is
  about, from the other direction.
- **N2 (cosmetic, not fixed, not security).** `WORD_SEPARATING_BLANKS` used raw literal
  (non-bidi) characters, unlike the codepoint-built `BIDI_CONTROL_CHARS`. Left as-is,
  matching the pre-existing `INVISIBLE` convention it sits next to.

### Round 3 (delta) — Opus, at `ff5d0177de98f6f5d49c3057066e36b79ff17d29`

**Verdict: CLEAR.** Confirmed N1's fix: re-tested U+115F/U+1160/U+17B4/U+17B5 against both
heads, confirmed the new test fails-before/passes-after, confirmed the four
width-rendering characters (U+2800/U+3164/U+FFA0/U+3000) still mask correctly, confirmed
zero bidi control characters anywhere in the four touched files, full suite 827/827.

### Ordinary review — `pal-reviewer` (`pal-mcp`'s `coder` chain, subagent id
`a4a8ca9d07db2ef26`), rounds 1–3

Ran in parallel with the Opus rounds above, on the same three heads. Verdict at each
round: clear, with non-blocking notes. Confirmed the same four fixes independently, from
pasted diff content (it has no `Bash`/git access, per its own operating constraints).

At round 3, it raised a substantive point: the `WORD_SEPARATING_BLANKS` doc comment
asserted U+115F/U+1160/U+17B4/U+17B5 "render with no width" without a citable source — a
fair challenge, since round 3's own Opus pass had hedged the identical claim as
font-dependent and unverified. This led to round 4, below.

### Round 4 (delta) — grounding the split in Unicode data, at
`646c607e633923575be7e91508b0b6b28a69525f`

In response to the sourcing challenge, checked the Unicode Character Database directly
(`unicodedata.category()`) rather than re-asserting the prior claim. This surfaced a real
error, not just a missing citation: U+115F and U+1160 are `General_Category = Lo` (an
ordinary letter category, not a combining mark) — the same category as U+3164, which was
already correctly masked. Switched the split's criterion to `General_Category`
(`Mn`/Nonspacing_Mark excluded, everything else masked), re-adding U+115F/U+1160 to the
masked set.

- **`pal-reviewer` verdict at 646c607e: clear**, validated the `General_Category`-based
  split as a real, citable improvement.
- **Opus delta verdict at 646c607e: CLEAR WITH FINDINGS.** One new finding:
  - **R1 (fixed in round 5).** `General_Category` is the WRONG property for this
    question — it classifies what kind of character something is (letter, mark,
    symbol...), not whether it renders with visible width. `Lo` (U+115F/U+1160's actual
    category) says nothing about rendering. The purpose-built Unicode property is
    `Default_Ignorable_Code_Point`, checked directly with
    `/\p{Default_Ignorable_Code_Point}/u`: `true` for U+3164, U+FFA0, U+115F, U+1160,
    U+17B4, U+17B5; `false` only for U+3000 and U+2800.

### Round 5 (delta, final) — at `386f787c2e7c0a66919a2451cc9b56bf8303af6b`

Fixed R1 exactly as specified: `WORD_SEPARATING_BLANKS` now masks only U+3000 and U+2800
(the two `Default_Ignorable_Code_Point = false` characters). The other six L6 fillers —
including U+3164/U+FFA0, which round 3 had masked based on `East_Asian_Width` before that
criterion was itself superseded — revert to plain deletion via `INVISIBLE`, unchanged from
`contentOf`'s original behaviour. Verified the `Default_Ignorable_Code_Point` truth values
independently (Node's `/\p{Default_Ignorable_Code_Point}/u`) before applying the fix, not
solely on the review's report.

- **`pal-reviewer` verdict at 386f787c: CLEAR, no new finding.** Confirmed
  `Default_Ignorable_Code_Point` is the right property and the truth-value table matches
  its own knowledge — a real conceptual improvement, not just a re-description. It also
  noted explicitly (and correctly) that this was now the fourth round narrowing the same
  six-character mask-vs-delete question (unsourced assertion →
  `General_Category` → `Default_Ignorable_Code_Point`), each a narrower instance of the
  same class of gap rather than a new class — per CLAUDE.md's "stop patching and change
  altitude" guidance, this Opus pass is the closing gate, not another ordinary round.
- **Opus delta verdict at 386f787c: CLEAR. Certified as final.** Re-derived the
  `Default_Ignorable_Code_Point` truth values for all six characters independently (not
  trusting the report), confirmed the regex and tests match, confirmed the N1
  reproduction now correctly fuses every default-ignorable character (no more incorrect
  "n/a" exemption through any of them), confirmed 827/827 tests pass. Noted, non-blocking
  and explicitly not requiring a follow-up: 32 other `Cf` characters are already deleted
  (unchanged, pre-existing `contentOf`/`INVISIBLE` behaviour) elsewhere in the file's
  `\p{Cf}` handling, out of this PR's scope. On its own suggest→confirm role in rounds 4/5
  ("I suggested the fix direction and am now confirming it myself"): this is the same
  suggest → implement (by the Sonnet lane, never the reviewer) → confirm cycle used
  throughout this pull request and this repository generally, not self-approval —
  CLAUDE.md's rule 1 concerns an agent approving its own AUTHORED work, and the reviewer
  authored no code at any point in this history.

## Authorship

This repository's local (non-global) git config, at the `.git/config` level shared by
every worktree, sets `user.name = "Codex GPT-6"` — pre-existing, not set by this session,
and not something this session's own tooling rules permit changing. Every commit on this
branch is stamped with that author name regardless of who actually wrote the code.
Verified directly: every line of every diff in this pull request was written by the
orchestrating Claude Sonnet 5 session via its own `Edit`/`Write` tool calls — no
`pal-mcp`/`coder`-chain call was used for any implementation step, only for the ordinary
review recorded above. `## Implemented by` on the PR names the real author, per this
repository's own commit-identity-mismatch remedy (decision log, 2026-09-23).

## Independence

Every review round above was either a fresh Opus subagent (`Agent` tool, `model: opus`)
or the `pal-reviewer` subagent, neither of which authored, directed, or remediated any
part of this change — every fix was applied directly by the orchestrating session in
response to a finding. The final Opus review pass was never delegated to `pal-mcp`'s
`coder` chain at any point.

## Verdict

**CLEAR at `386f787c2e7c0a66919a2451cc9b56bf8303af6b`.** Certified final by both the
mandatory Opus security review and the ordinary `pal-reviewer` review. Every blocking-
adjacent finding across five rounds is fixed; the two deliberately out-of-scope findings
(4, 6) are tracked as GitHub issues #473 and #474. No network-reachable surface,
authority change, or gate-semantics change is introduced by this pull request — it is a
CI-script parsing fix, narrowly scoped to one function's one caller.

This commit (adding this note) is docs-only. It moves the PR head but changes no code.

---

## Mechanical reconfirmation after merging main past PR #469/#472 (1f9d07d7)

**Confirmed by:** the orchestrating session, directly — not a fresh Opus pass, per the
established practice of self-declaring continued validity when the only intervening commits
are entirely disjoint from the reviewed files.

**What happened:** `main` advanced to `8446252a` (PR #472, docs-only) after `0a5dc368`
(PR #469, Traefik labels) while this branch was open. This branch was then updated with
`main` (merge commit `1f9d07d7`). The mechanical `check:pr-template` STALE detector flags
the merge commit because its own union-of-parent-diffs attribution includes every file that
differs between the merge and EACH parent — which necessarily includes this PR's own
already-reviewed files (they exist in this branch's parent but not in `main`'s parent), not
because any of them changed again.

**Verified directly:**
- `git show 0a5dc368 --stat` touches exactly `deploy/compose.{local,prod,uat}.yml` and
  `docs/05-operations/traefik-and-domains.md`.
- `git show 8446252a --stat` touches exactly `docs/07-planning/status.md`.
- Neither touches `scripts/ci/lib/pr-body.mjs`, `scripts/ci/lib/pr-body.test.mjs`,
  `scripts/ci/check-reviews.mjs`, or `scripts/ci/probes/spec-na-detection.test.mjs` — the
  four files this review's clearance actually covers.

**Verdict:** the Opus clearance at `386f787c` remains valid at `1f9d07d7` and any later
commit whose own diff from `1f9d07d7` stays confined to non-reviewed files.

**Reviewed head:** `1f9d07d7b7c6aee26882913ee9e12cabbe36fde5`
