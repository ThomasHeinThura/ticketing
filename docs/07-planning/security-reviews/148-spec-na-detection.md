# Pre-merge security review — PR #148 (`check:reviews` reads the Spec field's declared state)

**Reviewed head:** `fd8a4290a3d6f557c077686f2a8bf610a7bf8e05`
**Base:** `origin/main` = `580be16d78ea0500d1127b296ecb063eb42c6b71` (merge-base, verified directly)

**Verdict: CLEAR.** No blocking findings. Three informational notes, none requiring a
change before merge, all confirmed to be pre-existing or non-regressive by direct
old-vs-new comparison against the merge-base.

**Status of the gate:** this review closes the mandatory independent Opus security review
for the head named above, **and for that head only.** A later commit touching anything
outside `docs/07-planning/security-reviews/` voids it. No waiver was sought or used; the
PR's `## Gates` table cites no waived gate.

**Reviewer independence.** A fresh Opus context that authored, directed and remediated no
part of this change, working in its own detached worktree and a separate fresh clone at
the resolved head. Eight prior independent Sonnet rounds (ordinary and adversarial)
preceded it. This pass did its own adversarial work and its own mutation testing rather
than re-confirming those rounds' conclusions.

**Classification.** `scripts/ci/**` is in the security-review scope path list
(`docs/04-engineering/ci-cd.md`, line 115) — this is gate machinery, reviewed at the
required tier. No dependency change: `git diff --stat` against the merge-base shows
exactly two files, `scripts/ci/check-reviews.mjs` (+242) and
`scripts/ci/probes/spec-na-detection.test.mjs` (+669). No `package.json`, no lockfile, no
`pnpm-workspace.yaml`.

---

## The property under review

*A spec with real, unresolved review findings must not be silently treated as exempt*
(AGENTS.md do-not 15). The reviewed question was whether an adversarial PR author — not
just an accidental typo — can construct a `**Spec:**` field that defeats it.

## What was established by demonstration

| Claim | Evidence |
| --- | --- |
| **The diff-derived spec path cannot be narrated away** | `main()` seeds `specs` from `changedPaths()` before reading the body, and the `n/a` exemption only ever declines to *add* — it never removes. Confirmed end-to-end, not by reading: a branch that **edits** `docs/03-features/workflows.md`, and separately one that **adds** it, each with a body declaring `**Spec:** n/a — infrastructure only`, both still exit non-zero and name `workflows.md`. This is the unforgeable spine of do-not 15 ("start *building* a feature") and it survived every input constructed below |
| **The `n/a` whole-field exemption is the only reachable bypass class** | Ran a 28-case adversarial matrix through the real pipeline (`contentOf` → `field` → `fieldOpener` → `specsNamedIn`): hyphen/slash/space-glued paths, a combining mark at the boundary, ZWSP inside and after the opener, U+00A0 and tab inside `not applicable`, RLO bidi before and inside, uppercase `N/A`, cosmetic `N / A`, soft hyphen splitting the opener, heavy leading decoration, markdown-link form. **All 17 misses collapse to one mechanism** — a standalone `n/a` opener exempting the field — and every one is equally achievable by writing `n/a` alone with no filename at all. No distinct second bypass class exists |
| **`blocked` is genuinely non-exempting** | `blocked: docs/.../workflows.md`, `blocked-docs/.../workflows.md` and `blocked: DOCS/03-FEATURES/WORKFLOWS.MD` all extract `workflows.md` and are checked. The terse-vs-verbose bypass an earlier round found is closed |
| **Every guard is load-bearing (mutation testing)** | Disabled each mechanism in turn and re-ran the probe: word-continuation → 4 failures; `.md`-overlap → 3; multi-word mask → 1; lower-casing → 1; `codePointAt` → `charCodeAt` → 1. Baseline 18/18 restored after each. The suite is non-vacuous and no guard is decorative |
| **None of the rejected designs is repeated** | Read all 9 commits' diffs. The final code contains no punctuation deny-list, no punctuation allow-list, and no punctuation-adjacency/scan-forward. The only character classes present are `[^\p{L}\p{N}]` (leading-decoration strip), `[\p{L}\p{N}_]` (one code point, word continuation), `[a-z0-9-]` (filename) and `\s`. None enumerates "which separators are safe", which is precisely what each rejected round did |
| **No global-regex `lastIndex` footgun** | `MD_TOKEN` is module-level and carries `/g` — the classic stateful-regex hazard. Verified it is used *only* via `String.prototype.matchAll` (lines 150, 218), which per spec constructs a fresh regex and never advances the original's `lastIndex`. No `.test()`/`.exec()` on it anywhere |
| **No reachable null deref in the mask** | `withOpenerWordMasked` dereferences `gap.index` unguarded. Safe: `isMultiWord` is true only when the `not\s+applicable` alternative matched, which guarantees internal whitespace |
| **Fail-closed on a broken checkout** | `changedFiles()` throws `DiffUnavailableError` rather than returning `[]`, so a shallow clone cannot silently empty the diff-derived spec set |
| **Suites green, independently run** | Fresh clone at the reviewed head: `spec-na-detection.test.mjs` **18/18**; full `scripts/ci` suite **348 tests, 345 pass, 3 fail**. All 3 failures are `typecheck-coverage.test.mjs` spawning `tsc` with `ENOENT` — confirmed by checking that `apps/api/node_modules/.bin/tsc` genuinely does not exist in a clone with no `pnpm install`, not assumed. `biome check` on both changed files: clean |

---

## On the "`n/a` unconditionally exempts once standalone" trade-off

Assessed independently rather than deferring to the stated rationale. **I reach the same
design, for a stronger reason than the one recorded in the PR.**

The PR argues the compound case is structurally indistinguishable from an honest
explanation. That is true but incomplete. The decisive point is that `**Spec:**` is
*entirely author-authored free text*: no parse of it can resist an author who simply
writes `n/a` and names nothing. There is no version of `fieldOpener()` that yields
adversarial resistance through this input. The field path is an honesty-assist for honest
authors; the diff path is the actual control, and it is unaffected.

Given that, hardening `n/a` to never-exempt would buy **zero** adversarial resistance
while re-breaking honest PRs as #144 was broken — a strictly bad trade. The 28-case matrix
confirms the premise empirically: every construction that evades the field check is
equivalent in effect to writing a bare `n/a`.

The asymmetry with `blocked` is correct and should be kept: `blocked` makes no claim that
no spec exists, so continuing to check a named file costs nothing and closes a bypass an
earlier round demonstrated.

## On #150 / #152 and the dependency on `pr-body.mjs`

Assessed as the final check on whether "out of scope" is acceptable here, on evidence
generated for this review rather than on the assertion.

`scripts/ci/lib/pr-body.mjs` is byte-identical to the merge-base (`git diff` against
`580be16` returns zero lines). I reconstructed the merge-base predicate and diffed its
behaviour against the shipped one across the residual cases:

| Case | merge-base | this PR | delta |
| --- | --- | --- | --- |
| #150 — spec on the 2nd line of the field | `[]` | `[]` | same |
| #150 — 2nd line after an `n/a` first line | `[]` | `[]` | same |
| duplicate `**Spec:**` lines (first wins) | `[]` | `[]` | same |
| RLO bidi, reversed path | `[]` | `[]` | same |
| **#152 — U+3000 inside `not applicable`** | `["workflows.md"]` | `["workflows.md"]` | **same** |
| genuine declaration | `["workflows.md"]` | `["workflows.md"]` | same |
| honest `n/a` (the #144 bug) | `["status.md"]` | `[]` | intended fix |

**#152 fails closed here.** Collapsing `not applicable` → `notapplicable` stops the opener
from being recognised at all, so the field stops being exempt and the named spec is *still
checked* — confirmed end-to-end (exit 1). A defect that can only make this gate **stricter**
cannot be a merge blocker for this gate. #150 and the duplicate-field case are
behaviourally identical to the pre-PR code. **Concur: out of scope, and merge need not wait
on them.**

## Findings — three, none blocking

- **INFORMATIONAL / pre-existing** — Trojan-Source-style bidi. `contentOf()` strips the
  whole `\p{Cf}` category (U+202E RLO included), so a field can render one way on GitHub
  and parse another. Verified identical pre- and post-PR (a reversed path yields `[]` in
  both), lives in the untouched `pr-body.mjs`, and affects every checker using
  `contentOf`, not this one. Not introduced here. Worth a follow-up issue alongside
  #150/#152, not a condition of this PR.
- **INFORMATIONAL** — polynomial scan. `MD_TOKEN` (`[a-z0-9-]+\.md`) is O(n²) on a
  no-match run; measured 2.4 s (merge-base, single `exec`) → 4.1 s (this PR, `matchAll`
  over the whole string) on a 60 k-character field. Same complexity class — no nested
  quantifier, so not exponential — a ~1.7× constant, bounded by GitHub's 65,536-character
  body cap, and self-inflicted on the author's own CI run. No action needed.
- **INFORMATIONAL** — accepted extraction quirk, unchanged from pre-PR. A single-word
  opener fused to a bare filename (`n/a-workflows.md`) extracts the corrupted
  `a-workflows.md`, so a spec of that real name would not match. Identical on the
  merge-base (the old first-match `exec` corrupted it the same way), documented in the
  code, and the probe that covers it is honest about keying on what the regex actually
  extracts rather than overclaiming.

None of the three blocks merge.

## What this review did not do

- Did not re-derive the eight prior Sonnet rounds' correctness findings; it confirmed the
  final design independently and mutation-tested it instead.
- Did not review `pr-body.mjs` as a whole — only the specific behaviours this checker
  depends on, which is where #150/#152/the bidi note came from.
- Did not exercise the real GitHub Actions workflow; all runs were the real checker binary
  against synthetic scratch repositories via the probe harness, plus a fresh clone.

---

*Reviewed by a fresh Claude Opus context, 2026-09-16.*

---

# Merge-delta confirmation — `origin/main` merged in

**Reviewed head:** `acaa424b0570fc8518c180ddc9b1ee638706bb35`
**Supersedes the head binding of:** `fd8a4290a3d6f557c077686f2a8bf610a7bf8e05` (the full
review above, which remains valid for its own head)
**Merge commit:** `acaa424` — parents `57306ca` (the note above) and `47d37f3` (`origin/main`)

**Verdict: CLEAR.** Confirmed no-op with respect to the code this PR is about.

## Tier — and why this is the right one

This is a **lightweight confirmation, not a full re-audit**, under the risk-graduated
review tiers adopted 2026-09-16 (`AGENTS.md`, "Review tiers"). It claims only what it
verified: that the merge introduced nothing new into the reviewed surface. It does **not**
re-derive the adversarial analysis, the mutation testing, or the merge-base differential
above — those stand on the full review at `fd8a429`.

That is the correct tier here because this candidate sits in the lightest row: a
security-scope-path change whose **only** delta since its last full review is absorbing
unrelated upstream commits, with the code actually under review provably untouched. The
staleness mechanism in `security-review-note.mjs` fired on the merge, as designed — but it
fires on *any* commit, and what it flagged here is the branch catching up to `main` to
satisfy branch protection ("branches must be up to date"), not a change to
`check-reviews.mjs`.

## What was verified directly

| Claim | Evidence |
| --- | --- |
| **`check-reviews.mjs` is untouched** | `git diff fd8a429 acaa424 -- scripts/ci/check-reviews.mjs` is empty, and the blob hash is identical at both heads (`114788a7fd6a6bd91a617ee3577b5104c134c3d1`). The file this PR exists to change did not move |
| **The four imported functions are byte-identical** | Re-verified here rather than taken on report. `contentOf`, `field`, `sections` and `normaliseHeading` extracted from `scripts/ci/lib/pr-body.mjs` at both heads and diffed: all four empty. This matters because `pr-body.mjs` *did* change substantially in the merge (+802) — but not in the four functions this checker calls |
| **The merge brought only already-reviewed work plus docs** | The 29 commits are PR #89's checklist-genuineness hardening (merged to `main` under its own gates, with its own Opus clearance recorded at `89-checklist-genuineness-hardening.md`, itself included in the delta), PR #149's `status.md` reconciliation, and this PR's own review note. No dependency change: no `package.json`, no lockfile, no `pnpm-workspace.yaml` in the delta |
| **The only non-`scripts/ci`, non-docs files are cosmetic test edits** | `tests/api-integration/authorization-boundaries.test.ts` and `time-entry-duration.test.ts` change exactly one expression shape, `columns.todo?.id ?? null` → `columns.todo.id`, in test fixtures. Test-only, no production path, from PR #89's commit `8c141b1` |
| **Suites green, independently run at this head** | Fresh clone at `acaa424`: `spec-na-detection.test.mjs` **18/18**; full `scripts/ci` suite **399 tests, 396 pass, 3 fail**. The rise from the 348 recorded above is PR #89's new tests arriving with the merge (`head-binding.test.mjs`, `stale-review-note.test.mjs`, and an expanded `pr-body.test.mjs`) — not a change in this PR's own coverage |
| **The 3 failures are the known `tsc` gap, not something new** | All three are in `typecheck-coverage.test.mjs`, all `spawnSync … /node_modules/.bin/tsc ENOENT`. Confirmed by checking that `apps/api/node_modules` does not exist at all in a clone with no `pnpm install` — the same characterisation as the full review, verified again rather than assumed |

## What this confirmation did not do

- Did not re-run the adversarial input matrix, the mutation testing, or the merge-base
  behavioural differential. Those are the full review's work, bound to `fd8a429`, and the
  byte-identity of the reviewed surface is what carries them forward to this head.
- Did not review PR #89's changes to `pr-body.mjs` on their merits. They arrived on `main`
  through their own gates and their own Opus clearance; this pass checked only that they
  do not reach the four functions `check-reviews.mjs` depends on.
- Did not re-check the three informational findings above. Nothing in the merge touches
  the code they describe.

## One operational note, not a finding

`origin/main` moved again after this merge — it is now `6486d50` (PR #151, the
risk-graduated-review-tiers governance change itself). This candidate is therefore once
more behind `main`, and branch protection will require another catch-up merge before it
can land. That is a merge-readiness fact, not a security one, and it does not affect the
verdict for the head named above.

---

*Lightweight delta confirmation by a fresh Claude Opus context, 2026-09-16. A separate
context from the one that produced the full review above, and from anything that authored
or remediated the change.*

---

# Second merge-delta confirmation — `origin/main` (PR #151) merged in

**Reviewed head:** `1403e000d37ee7dbb1623e405de67ce742a7dd39`
**Supersedes the head binding of:** `acaa424b0570fc8518c180ddc9b1ee638706bb35` (the first
confirmation above, which remains valid for its own head)
**Merge commit:** `1403e00` — parents `6a71bba` (the first confirmation's note commit) and
`6486d50` (`origin/main`, PR #151)

**Verdict: CLEAR.** The merge is governance documentation only. Zero code.

## Tier

Same lightest row as the first confirmation, and for the same reason: the only delta since
the last clearance is the branch absorbing upstream commits to satisfy branch protection's
"branches must be up to date". The staleness mechanism fired because a commit landed, not
because the reviewed surface moved. This pass claims only that — it does not re-derive the
adversarial analysis, the mutation testing, or the merge-base differential, which stand on
the full review at `fd8a429`.

## What was verified directly

| Claim | Evidence |
| --- | --- |
| **The merge carries only PR #151's own governance docs** | `git diff 6a71bba 1403e00 --stat` is exactly three files: `AGENTS.md` (+72/-9 region), `CLAUDE.md`, `docs/07-planning/decision-log.md`. PR #151 is the risk-graduated-review-tiers change, documentation only |
| **Nothing under any code or dependency path changed** | `git diff acaa424 1403e00 --name-only -- apps/ packages/ scripts/ '*.json' '*.yaml' '*.lock'` is empty. No `package.json`, no lockfile, no `pnpm-workspace.yaml` |
| **`scripts/ci/` is untouched in its entirety** | `git diff acaa424 1403e00 -- scripts/ci/` is completely empty — not one byte in the whole tree this PR exists to change |
| **`check-reviews.mjs` is byte-identical at all three cleared heads** | Blob hash `114788a7fd6a6bd91a617ee3577b5104c134c3d1` at `fd8a429`, `acaa424` and `1403e00` alike |
| **The four imported functions are untouched** | `scripts/ci/lib/pr-body.mjs` is blob-identical between `acaa424` and this head (`f9c6ffd566a07ebff1bed09a43cff2ef454dea37`), so `contentOf`, `field`, `sections` and `normaliseHeading` cannot have moved. The function-level extraction done in the first confirmation carries forward unchanged |
| **The full diff since the last clearance decomposes with no remainder** | `git diff acaa424 1403e00 --stat` shows four files. Three are PR #151's, above. The fourth is this very review note, added by the first confirmation's own commit `6a71bba` — a review artefact, not a change to the candidate |
| **Probe suite green, independently run at this head** | Fresh clone checked out at `1403e00`: `node --test scripts/ci/probes/spec-na-detection.test.mjs` → **18 tests, 18 pass, 0 fail**. Unchanged from both prior heads |

## What this confirmation did not do

- Did not re-run the adversarial input matrix, the mutation testing, or the merge-base
  behavioural differential. Byte-identity of the reviewed surface is what carries the full
  review at `fd8a429` forward to this head.
- Did not re-run the full `scripts/ci` suite. The three known `tsc ENOENT` failures
  characterised in the first confirmation are a clone-without-`pnpm install` artefact and
  nothing in this merge touches them.
- Did not review PR #151's governance changes on their merits. They reached `main` through
  their own gates; this pass checked only that they are documentation and reach no code.
- Did not re-check the full review's three informational findings. Nothing in the merge
  touches the code they describe.

---

*Second lightweight delta confirmation by a fresh Claude Opus context, 2026-09-16. A
separate context from the one that produced the full review, from the one that produced the
first confirmation, and from anything that authored or remediated the change.*
