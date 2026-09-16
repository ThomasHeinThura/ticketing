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

---

# Delta review — `main` merged into the branch (fifth Opus pass)

**Reviewed head:** `3ea2316fc5f3667be115c2f7d89505d9b9c1b468`
**Previously reviewed head:** `95875c4e8a5355913bf937602356700521699944` (the pass above)
**Merge-base of the two parents:** `e6f6401b36f7ac56be14a06da511df8ee980ac33`

**Verdict: CLEAR.** No new CRITICAL, HIGH, or MEDIUM finding. The clearance recorded above
carries forward to the new head. Merge.

**Why this pass exists.** The branch had to merge `origin/main` to satisfy `protect-main`'s
`strict_required_status_checks_policy: true` (a branch must be up to date before merging).
That merge landed commits outside `docs/07-planning/security-reviews/`, so
`security-review-note.mjs`'s rule 3 correctly declared the note above STALE. That is the
gate working, not a false positive: rule 3 is stated over **landed commits**, not the net
tree (GPT-F5), precisely so that a reviewer cannot clear a range by eyeballing two endpoints.
This pass therefore walks the range commit by commit rather than diffing the endpoints.

**Reviewer independence.** A fresh Opus context that authored, directed and remediated no
part of this change, in its own isolated detached worktree, removed afterward. It formed its
own judgment on the range and re-derived the load-bearing claims from source rather than
deferring to the passes above.

---

## The range, walked commit by commit

`95875c4e8..3ea2316fc` is **five** commits, not the four a net-tree reading suggests — the
branch's own note commit is in the range too:

| Commit | Author | Paths it contributed | Verdict |
| --- | --- | --- | --- |
| `17343ea` | Claude Code | `docs/07-planning/security-reviews/89-checklist-genuineness-hardening.md` (added) | Review-artefact-only — the note recording the pass above |
| `4418e70` | Thomas | `apps/api/src/index.ts`, `tests/api/index.test.ts`, `docs/.../144-static-file-serving.md` | PR #144, separately reviewed and cleared; no CI-gate surface |
| `9d57ce0` | Thomas | `docs/07-planning/status.md` | Prose only |
| `580be16` | Thomas | `docs/07-planning/status.md` | Prose only |
| `3ea2316` | Claude Code | the merge itself | Trivially clean — see below |

**No commit in the range touches `scripts/` at all.** Established at commit granularity with
`git show --name-status -m` per commit, not inferred from the endpoint diff — so the
revert-and-differently-reintroduce shape rule 3 exists to catch is not merely absent from the
net tree, it is absent from the history.

---

## What was established by demonstration

| Claim | Evidence |
| --- | --- |
| **Every file the four-round review examined is byte-identical at the new head** | `git diff 95875c4e8 3ea2316fc -- scripts/` is empty, and blob-hash comparison at both endpoints confirms it file by file: `pr-body.mjs` `f9c6ffd`, `pr-body.test.mjs` `d44f0ec`, `check-pr-template.mjs` `100c81a`, `security-review-note.mjs` `63a23ea`, `head-binding.mjs` `c7f2df6`, `head-binding.test.mjs` `68d5581`, `stale-review-note.test.mjs` `c9de640` — identical on both sides |
| **The merge commit smuggled nothing in under cover of conflict resolution** | Recomputed the merge independently with `git merge-tree --write-tree 17343ea 580be16` → tree `133075324a62d1ad8a81a4ab69375872fc7cf139`, which is **exactly** `3ea2316fc^{tree}`. The merge is therefore the trivially clean one: no hand-made resolution, no opportunity for a hand-edited hunk. `git diff` against each parent confirms the same from the other direction — parent-1 diff is exactly `main`'s side, parent-2 diff is exactly the branch's side |
| **Nothing in the range touches the dependency graph or the gate's own runner** | `git log --name-only` over the range filtered to `package.json`, `**/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/`, `scripts/` returns nothing. PR #144 uses `@hono/node-server/serve-static`, a subpath of an already-installed dependency — verified as a real absence of a manifest change, not taken from the PR body |
| **PR #144 cannot affect how PR bodies, checklists, or CI gates are read or trusted** | Read the full diff. It adds static-asset serving to the **runtime** Hono app in `apps/api/src/index.ts`; the gate machinery is CI-time Node tooling under `scripts/ci/` that parses PR body text in Actions. No shared module, no shared input, no import path between them. Its static root is `/app/public` or `apps/web/dist` (the built SPA bundle) — never the repository root — so neither `scripts/ci/` nor `docs/07-planning/security-reviews/` becomes web-reachable, and #144's own LOW symlink note would require a symlink planted inside the built bundle to matter |
| **Both `status.md` commits are prose only** | Read both diffs in full. `9d57ce0` bumps the snapshot SHA and marks the static-serving UAT row CLOSED; `580be16` records issue #146 as DECISION REQUIRED. Neither contains a code block, a config change, or anything a tool consumes — `status.md` is not machine-read by any gate |
| **Issue #146 remains genuinely outside this PR's internal consistency** | Re-derived from source rather than deferring to the pass above: `sections()` is defined at `pr-body.mjs:388` and, with comment lines excluded, is called from exactly three upstream entrypoints — `check-pr-template.mjs:178`, `check-reviews.mjs:111`, `template-scope.mjs:85` — and **never from inside `pr-body.mjs`**. The functions this PR hardens take `raw` as a parameter, so #146 cannot reach them |
| **Tests, independently run at the new head** | `node --test 'scripts/ci/**/*.test.mjs'` → **381 pass, 0 fail, 62 suites**, matching the expected counts exactly. `node --test scripts/ci/lib/pr-body.test.mjs` → 112/112. Run in a detached worktree at `3ea2316fc`; the first attempt's failures were a missing `node_modules` in the fresh worktree (`tsc ENOENT`), resolved by linking the installed dependencies, not by changing any code |

---

## On issue #146 and this PR's merge — a note, not a finding

`580be16` added a line to `status.md` saying #146 needs Thomas's decision "before further
work on `scripts/ci/lib/pr-body.mjs` continues." Read plainly, that gates **further work on
the file**, not the merge of work already finished and reviewed — PR #89 is the pass that
*found* #146, and it neither introduces nor worsens it (the defect is confirmed live on
`main`). Recorded here so the sequencing question is visible to whoever merges rather than
silently resolved by a reviewer; it is a scope call, not a security finding, and not one this
review would waive either way.

---

## Findings — none

No new CRITICAL, HIGH, or MEDIUM finding in `95875c4e8..3ea2316fc`. The range contains no
change to any reviewed file, no dependency change, no gate-machinery change, and a merge
commit proven to be the trivially clean one. The verdict recorded for `95875c4e8` stands
unchanged at `3ea2316fc`.

**What this pass did not do.** It did not re-run the four rounds of adversarial parser
probing above — the files are byte-identical, so that work is not invalidated and repeating
it would prove nothing new. It did not review PR #144 on its own merits (already separately
cleared at `8dd79e4`, note on file), and it did not verify anything against a real
`docker build`/`docker run` cycle, which `status.md` already tracks as outstanding.
