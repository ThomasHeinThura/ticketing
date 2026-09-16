# Pre-merge security review — PR #89 (checklist/heading genuineness hardening)

**Reviewed head:** `95875c4e8a5355913bf937602356700521699944`
**Base:** `origin/main` = `e6f6401b36f7ac56be14a06da511df8ee980ac33` (merge-base at review time)

**Verdict: CLEAR.** No new CRITICAL, HIGH, or MEDIUM finding. Merge.

**Status of the gate:** this review closes the mandatory independent Opus security review
for the head named above, **and for that head only.** A later commit touching anything
outside `docs/07-planning/security-reviews/` voids it. No waiver was sought or used.

**Reviewer independence.** A fresh Opus context that authored no part of the change, in its
own isolated detached worktree, removed afterward. It is the **fourth** independent Opus
security pass this mechanism has received (rounds 9, 10, 11, and this one), and the first at
this exact head — two small mechanical fixes (the rule-2 duplicate-heading dedup completion,
and the `HEADING_MARKER` trailing-whitespace fix) landed after round 11's reviewed head
(`af55305`) and had not been seen by any Opus pass until this one.

**Classification.** `scripts/ci/lib/pr-body.mjs` and `scripts/ci/lib/pr-body.test.mjs` are in
security-review scope per `docs/04-engineering/ci-cd.md` (CI/gate machinery). No new
dependency, no `package.json`/lockfile change.

---

## What was established by demonstration

| Claim | Evidence |
| --- | --- |
| **Both post-round-11 fixes are correct, complete, and non-vacuous** | Reverted each in isolation and re-ran: reverting `HEADING_MARKER` to `/^###\s+/` produces exactly 1 failure (the harmless-same-line-comment test); reverting rule 2 to `[...present.values()]`/`present.size` produces exactly 1 failure (the rule-2 duplicate-heading test) |
| **Dropping `HEADING_MARKER`'s trailing `\s+` does not reopen round 9's anchoring asymmetry** | Hand-derived: `HEADING_MARKER` is `^`-anchored and the name regex `/^###\s+(.*\S)\s*$/` is `^`-anchored on the same stripped text, so there is no unanchored counterpart anywhere in the heading path (the precise shape of round 9's defect). With `marker[0].length` now the constant 3, the marker span is `[0,4)`, index 3 is guaranteed whitespace by the name regex, and the only exempted region between marker and wording spans is whitespace-only — it cannot carry a visible character into the name. Confirmed empirically across 10 constructed probes (cushioned comment passes; comment abutting the name from either side, a splice inside `###`, a splice inside/manufacturing the name, `####`, `###Name`, and a heading swallowed by its own multi-line comment all correctly rejected as MISSING) |
| **Own adversarial pass found no fifth finding** | ~35 constructed PR bodies, all actually executed. Proved two structural invariants by hand then confirmed them: `genuineBoxLineTexts(body) ⊆ boxes` by construction (`stripComments` and `stripCommentsWithPositions` strip identically; both filters use the same anchored `ANY_BOX`), so `checklistProblems`'s early-continue on an empty `boxes` array can never skip a block rule 3 counts a review item in; and every genuine line contributes exactly 1 to `genuineBoxCount` (anchored match ⇒ `marker.index === 0`, embedded-extra-marker scan covers the entire remainder), so raw/visible/genuine comparisons cannot be gamed by overlapping matches. Tried: duplicate headings with the review item in the discarded earlier block, heading swallowed by a comment, visible orphaned review item, a checkbox smuggled onto a heading line, a second non-genuine review line, CRLF bodies, tab indentation, comments abutting the marker on either side — all fail closed, no seam found between `genuineLineFlags`, `headingBlocks`, `visibleHeadingName`, rule 2, rule 3, and `checklistProblems` |
| **`sections()` (issue #146) confirmed out of reach of this PR's internal consistency** | `sections()` is never called from inside `pr-body.mjs`; its only callers are upstream entrypoints (`check-pr-template.mjs:178`, `check-reviews.mjs:111`, `template-scope.mjs:85`). Both functions under review here take `raw` as a parameter, so this PR does not need to fix it to be internally consistent — correctly left to Thomas's decision per issue #146 |
| **Tests, independently run** | `node --test 'scripts/ci/**/*.test.mjs'` → 381/381 pass, 0 fail, 62 suites. `node --test scripts/ci/lib/pr-body.test.mjs` → 112/112. Both claims in the PR body confirmed accurate, not trusted from the body |

---

## One honest correction to the record (LOW — not a merge blocker)

Round 10's note claimed round 9's fix was a "strict improvement over `main`, no regression."
A 14-case head-vs-main differential sweep found a narrow counterexample: a checkbox placed
after `-->` on a multi-line HTML comment's own closing line —

```
### Phase completion

<!--
hide
--> - [x] Independent security review
```

`main` reports 1 problem ("NO independent-review checkbox"); this head reports 0. This
head is right and `main` was accidentally right for the wrong reason: `main` only rejected
it because of the per-line comment stripping that rounds 1–5 already proved wrong elsewhere
in this same file. GitHub renders that text visibly (HTML-block passthrough per CommonMark),
so nothing is actually hidden from a human reader — same "literal stripped text vs. GitHub's
real rendering" class already recorded as a deliberately-deferred pre-existing gap in round
10's own note. Not worth a twelfth round; recorded here for the trail.

Also re-confirmed **identical on `main` and this head** (so not introduced by this PR, and
squarely inside the same deferred class): backslash-escaped `\[ ]` and `&#91;`-entity
embedded markers, and checkbox-shaped literals inside code fences, 4-space-indented blocks,
`-[x]` with no space, and `<style>` blocks.

---

## Findings — none blocking

No new CRITICAL, HIGH, or MEDIUM finding. The one LOW note above is a correction to a prior
round's record, not a new gap, and is already covered by the same deferred pre-existing-gap
class both round 10 and this PR's "Not done" section already name.

**This PR is judged complete for the scope it claims.** The two structural questions raised
across all eleven-plus rounds — `sections()` (issue #146) and the two round-10 pre-existing
gaps (`ITEM_SEPARATOR`'s narrow dash enumeration; embedded-marker detection reading stripped
text instead of GitHub's rendering) — are correctly left to Thomas as a structural
parser-replacement decision rather than patched incrementally a twelfth time, consistent with
round 11's own explicit recommendation to stop incremental patching once the root cause is
this deep.
