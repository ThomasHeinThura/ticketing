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
