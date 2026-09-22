# Mandatory independent security review — PR #223 (close #146: `sections()` no longer lets a comment-hidden or duplicate `##` heading win silently)

**Reviewed head:** `9f4ae0ad3baa05dbbf00fa58e5b15ec3a71abfca`

**Reviewer:** Opus 5 (1M context), fresh independent context — did not author, direct, or
remediate this change. Reviewed at the exact head above in an isolated detached worktree
(`git worktree add --detach … 9f4ae0a`), not against `main` and not against the PR
description's own claims.

**Scope:** `scripts/ci/**` is explicitly security-review scope per
`docs/04-engineering/ci-cd.md` — this file *is* the gate machinery. A defect here makes
every other gate in the repository unenforceable, which is why this review re-derives the
claims rather than confirming them.

**Status: CLEAR WITH FINDINGS (non-blocking).** The fix closes issue #146 as claimed, in
both halves (comment-hidden heading, and genuine duplicate). All three callers fail closed.
No new fail-open path was found. Four non-blocking findings are recorded below; none of
them is a regression introduced by this PR, and three of them are pre-existing gaps this PR
narrows rather than widens.

---

## What was verified, and how

### Diff scope (task item 6)

Merge base with `origin/main`: `cd21e5a7def504af84d1fe2dcea1553c92a96d65`.
`git diff --stat <merge-base> HEAD` is exactly six files:

```
 docs/07-planning/decision-log.md  |  29 +++++++++++
 scripts/ci/check-pr-template.mjs  |  14 ++++-
 scripts/ci/check-reviews.mjs      |  12 ++++-
 scripts/ci/lib/pr-body.mjs        | 106 ++++++++++++++++++++++++++++++++++++--
 scripts/ci/lib/pr-body.test.mjs   |  82 +++++++++++++++++++++++++++++
 scripts/ci/lib/template-scope.mjs |  20 +++++--
```

Nothing outside `scripts/ci/**` and the decision-log entry. **Scope confirmed correct.**
No application source, no schema, no dependency-graph file (`package.json`, lockfiles,
`pnpm-workspace.yaml`) is touched, so the dependency-graph half of security-review scope is
not engaged.

### Tests actually run, not reported (task item 4)

Isolated worktree at `9f4ae0a`, `pnpm install --frozen-lockfile` (clean, pnpm 10.32.1),
node v24.20.0 from `/home/ubuntu/.fnm/node-versions/v24.20.0/installation/bin`:

- `node --test scripts/ci/lib/pr-body.test.mjs` → **117 tests, 117 pass, 0 fail.**
- `node --test 'scripts/ci/**/*.test.mjs'` → **451 tests, 76 suites, 451 pass, 0 fail**
  (26.8s).

Before `pnpm install`, three `typecheck-coverage.test.mjs` tests failed with `spawnSync …
/apps/api/node_modules/.bin/tsc ENOENT` — a missing-dependency artefact of a fresh
worktree, not a defect; all three pass once dependencies are installed. Recorded so the
"448/451" intermediate number is not mistaken later for a real failure.

### Are the new tests genuine regression tests?

Checked rather than assumed. A second detached worktree at the merge base (`cd21e5a`) was
built, and a standalone 21-case adversarial harness was run against **both** the pre-fix and
the post-fix `sections()` (the test file itself cannot simply be replayed at the merge base —
it imports `DuplicateSectionError`, which does not exist there, so the whole file errors at
load and proves nothing). Pre-fix, the #146 shape returns the FAKE model; post-fix it returns
the REAL one. The new tests describe a defect that was genuinely live on `main`.

---

## 1. Is the visibility logic actually correct? (task item 1)

`visibleH2HeadingName` is a faithful, correctly-adapted copy of the already-hardened
`visibleHeadingName` used one level down for `###`:

- **Check 1** — `isRawSpanVisible(survived, lineStart, min(lineStart + 2, lineEnd))` against
  `survivedRawIndices(markdown)`, i.e. the **whole document's** comment structure. Two
  characters, correctly, because the marker is `##` (the `###` version checks three). This is
  the check that catches a heading swallowed by a multi-line comment opened on an earlier
  line — the exact #146 payload.
- **Check 2** — `markerAndWordingGenuine` over the line **stripped in isolation**, catching a
  splice inside `##` itself or between the marker and the name.
- The name is derived from the *stripped* text, not a raw regex capture, so a trailing
  comment cannot be greedily captured as part of the heading name.
- `H2_HEADING_MARKER = /^##(?!#)/` — the negative lookahead is correct and necessary; without
  it a `### Backend change` checklist block heading would become a `##` section boundary.

I independently reasoned about, and then empirically confirmed, the boundary cases where
"first two raw characters visible" could conceivably be insufficient:

- a comment opening **on** the heading line after `##` — the name then falls inside the
  line-isolated strip, `H2_HEADING_LINE`'s `(.*\S)` finds nothing, rejected;
- `##<!--` with the comment closing lines later — line-isolated strip yields bare `##`, no
  `\s+`, rejected;
- `## <!--` with the comment closing lines later — strip yields `## `, no name, rejected;
- a comment opening *before* `##` on an earlier line — chars 0 and 1 are themselves inside
  the comment, so check 1 fires.

There is no shape I could construct in which a comment-hidden `##` heading survives check 1.

### Adversarial payload matrix (task item 5)

21 payloads, run against both heads. `->` is the value the checker would read for
`**Model:**` in the `security review` section.

| # | Payload | Pre-fix | Post-fix | Verdict |
| --- | --- | --- | --- | --- |
| A | #146 original — multi-line comment hiding a duplicate `## Security review` | **FAKE** | REAL | **fixed** |
| B | single-line `<!-- ## Security review` … `-->` duplicate | REAL | REAL | ok |
| C | comment spliced inside the `##` marker (`#<!--x--># …`) | REAL | REAL | ok |
| D | `##<!--x-->Security review` (no whitespace cushion) | REAL | REAL | ok |
| E | `## <!--x-->Security review` (cushion on one side only) | REAL (junk 2nd key) | REAL | ok — rejected, fail-closed |
| F | genuine heading with harmless trailing comment | **junk key** `task <!-- … -->` | `task` | **improved** |
| G | comment cushioned by whitespace on **both** sides | **junk key** | `security review` | **improved** |
| H | `### Backend change` under `## Checklists` | not a boundary | not a boundary | ok |
| I | genuinely visible duplicate, no comment | **FAKE (silent)** | `DuplicateSectionError` | **fixed** |
| J | 3-space-indented duplicate (a real H2 in CommonMark) | REAL | REAL | see **F1** |
| K | setext duplicate (`Security review` / `---`) | REAL | REAL | see **F1** |
| L | duplicate inside a fenced code block | **FAKE (silent)** | `DuplicateSectionError` | **improved** |
| M | zero-width-space homoglyph duplicate | separate keys | separate keys | see **F2** |
| N | `<!-- x -->## Security review` (CommonMark HTML block) | not a boundary | not a boundary | ok |
| O | unterminated `<!--` swallowing every later heading | **FAKE accepted** | sections dropped → required-section failure | **improved** |
| P | comment opens on a genuine heading line, closes after a later heading | junk key | later heading dropped → failure | see **F3** |
| Q | comment closes mid-line, `##` after `-->` | not a boundary | not a boundary | ok |
| R | name spliced mid-word (`## Sec<!--x-->urity review`) | junk 2nd key | rejected | ok — fail-closed |
| S | **CRLF** line endings, #146 shape (offset-accounting) | **FAKE** | REAL | **fixed** |
| T | `## Security review<!--c-->extra` | junk key | rejected | ok — fail-closed |
| U | `#### Security review` | not a boundary | not a boundary | ok |

The CRLF case (S) matters on its own: GitHub delivers PR bodies with `\r\n`, and the new
`offset` accounting in `sections()` (`lineEnd = offset + line.length; offset = lineEnd + 1`)
is only correct because `split("\n")` leaves the `\r` inside `line.length`. Verified live,
not by inspection.

**Rejections that are false negatives (E, R, T) are all in the fail-closed direction** — the
heading is not recognised, so the required section reads as *missing* and the check fails.
They mirror exactly the tradeoff already documented and adversarially settled one level down
for `###`. Costing an author a reword is the correct side of this trade for a gate.

**Performance:** `sections()` now runs `stripCommentsWithPositions` once over the whole
document plus once per line over that line's own slice — linear, not quadratic. Confirmed
against four pathological 65 KB bodies (GitHub's body cap): 0.4–19 ms each. No CI-hang
vector introduced.

---

## 2. Are all three callers fail-closed? (task item 2)

Traced in source and then executed.

`finish()` (`scripts/ci/lib/repo.mjs:139`) sets `process.exitCode = 1` whenever
`failures.length > 0` and never prints `ok`. Every one of the three new `catch` blocks pushes
a `violation(...)` **before** calling `finish`, so `failures` is guaranteed non-empty and the
`ok: "unreachable"` string is genuinely unreachable. Each block rethrows anything that is not
a `DuplicateSectionError`; both scripts end in a top-level `await main()`, so a rethrow
becomes an unhandled rejection and a non-zero exit. There is no bare `catch {}` anywhere on
these paths and no `continue-on-error` on the `pnpm check:reviews` / `pnpm check:pr-template`
steps in `.github/workflows/ci-fast.yml`.

- **`check-pr-template.mjs`** — `present` is declared with `let` and assigned only inside the
  `try`; the `catch` `return`s immediately, so no stale or partial `present` is ever read.
  Executed live against a duplicate-heading body: **exit 1**, message correct.
- **`check-reviews.mjs`** — same shape for `bodySections`; `return`s before
  `bodySections.get(...)`. Executed live: **exit 1**. (It passes no `warnings` to `finish`
  here, unlike the success path — harmless, because nothing pushes a warning before this
  point in `main()`; a consistency nit at most.)
- **`template-scope.mjs` `parseTemplateSections`** — converts `DuplicateSectionError` into
  `TemplateScopeUnavailableError`. I checked the consumer rather than assuming: every throw
  site in `readTemplateScope` funnels into `check-pr-template.mjs:172-177`, which pushes a
  **failure** and exits 1 — it is not a "scope unknown, skip the check" path. Verified live by
  appending a duplicate `## Gates` to the working-tree template: **exit 1**, reported as
  `template requirement scope`, not skipped.

**All three are fail-closed. Confirmed by execution, not by reading.**

---

## 3. Could the fix be turned into a NEW fail-open? (task item 3)

No path found. An attacker who deliberately triggers `DuplicateSectionError` — in the body or
in the template — reaches a `finish()` call with at least one failure, i.e. exit 1. The only
behaviour they can buy is a *louder* failure. The error is a distinct class caught by
`instanceof`, so it cannot be confused with the pre-existing `TemplateScopeUnavailableError`
handling, and the conversion in `parseTemplateSections` preserves the blocking outcome.

One thing worth stating explicitly because it is the shape a future regression would take:
`DuplicateSectionError` is thrown from inside `flush()`, which is a closure over `found`. If a
later change ever moves the `found.has(key)` guard to a "skip the duplicate and keep going"
branch, the fail-closed property disappears silently. The three tests added here (the
`assert.throws` one in particular) are what would catch that.

---

## Findings (all non-blocking)

**F1 — LOW, pre-existing, narrowed not widened: `sections()`'s notion of a `##` boundary
still diverges from CommonMark in three shapes.** A 1–3-space-indented `## X`, a setext
`X` / `---`, and a `## X` inside a fenced code block are all handled differently by the
checker than by GitHub's renderer. I checked each for an exploit direction and found none
that hides anything from a human:

- indented and setext duplicates are *rendered* to the reader, so they cannot hide a fake
  "cleared" section the way #146 could; the checker merges their content into the preceding
  section and `field()` returns the **first** match, i.e. the genuine one;
- the fenced-code duplicate now hard-fails (payload L) where pre-fix it silently won.

This is a real residual gap in the "one visible heading, one section" property the PR's own
doc comment claims, and it deserves a tracked issue — but it is strictly better than the
pre-fix state in every case measured, and nothing here blocks this merge.

**F2 — LOW, concrete one-line hardening: `normaliseHeading` does not strip the `INVISIBLE`
character class this same file already defines.** `pr-body.mjs:356` defines `INVISIBLE`
(zero-width space, format characters, blank-rendering fillers) and `contentOf` applies it;
`normaliseHeading` (line 374) does not. So `## Security review` and `## Security​ review`
render identically to a human but key differently, escaping `DuplicateSectionError`
(payload M). This is **not** a gate defeat — the required-section lookup still resolves to the
genuine heading, so the real section must still be genuinely filled — but a reader skimming
the rendered body could take the second, unchecked block as the record. Adding
`.replace(INVISIBLE, "")` to `normaliseHeading` would convert payload M into the same
fail-closed duplicate error as payload I. Suggested as a follow-up, not required here.

**F3 — LOW, informational asymmetry to be aware of before the next change here.** Heading
detection uses the **whole document's** comment structure (`survived`), while each section's
`.text`/`.content` uses `stripComments` over that section's **own buffer** — which never sees
a `<!--` that opened on the heading line, because the heading line is consumed as the heading
and not buffered. Payload P is the visible consequence: a later genuine `## Gates` is dropped
from the map. Every consequence I could construct is fail-closed (a required section reads as
missing), and the reverse direction — content the checker counts as visible while GitHub hides
it — requires a block-level `<!--` inside the section's own buffer, which `stripComments` does
see. So this is not exploitable today. It is recorded because the two models disagree, and a
future edit to either one could flip the direction without any test noticing.

**F4 — INFO, hygiene: `template-scope.mjs`'s `parseChecklistBlocks` is now the only raw,
non-visibility-aware heading scanner left** (`/^##\s+Checklists\s*$/`, `/^##\s+/`,
`/^###\s+(.*\S)\s*$/`, lines 133–139). It reads the template file rather than the PR body, and
the merge-base **union** in `unionOf` means a PR cannot shrink the required-block list by
truncating the working-tree template, so it is not exploitable in this threat model. Worth
folding into the same visibility treatment when F1 is picked up, so the file does not keep two
notions of "a heading."

**F5 — nit, decision log.** The new entry says "117/117 new tests"; 117 is the whole
`pr-body.test.mjs` suite, of which 4 are new. Harmless in a decision log, and the claim it
supports (the fix is tested and verified fail-against-old / pass-against-new) is one I
independently reproduced.

## The decision-log entry (task item: confirm the record exists)

Confirmed present in the diff, at the **top** of `docs/07-planning/decision-log.md`
(newest-first, append-only respected — it supersedes nothing and rewrites nothing). Dated
2026-09-22, titled "#146's fix direction: continue hardening `pr-body.mjs`, not a parser
rewrite", with Decision / Why / Alternatives / Decided-by sections. It reads coherently and
matches the change actually shipped: hardening the existing pattern, explicitly deferring a
`remark`/`micromark` rewrite, attributed to Thomas on 2026-09-22. I did not evaluate the
product decision itself, only that the record exists as claimed.

## What this review did NOT do

- It did not verify GitHub's renderer behaviour empirically. F1 and F3 rest on CommonMark
  block-structure reasoning, not on a live render of these payloads in a real PR body. The
  conclusion that every divergence is fail-closed or human-visible would survive being wrong
  about GitHub's exact handling of one of those shapes, but the *severity wording* for F1/F3
  would want re-checking if someone later renders them for real.
- It did not review anything outside the diff, and did not re-audit the pre-existing
  `stripComments` / `markerAndWordingGenuine` / `genuineLineFlags` machinery beyond what is
  needed to judge the new caller of it — that mechanism has its own prior reviews
  (`89-checklist-genuineness-hardening.md`).
- It did not merge, did not edit `## Gates`, did not waive anything, and modified no file in
  the repository other than this note.

## Verdict

**CLEAR WITH FINDINGS (non-blocking).**

Issue #146 is genuinely closed, in both halves, at head
`9f4ae0ad3baa05dbbf00fa58e5b15ec3a71abfca`. The visibility logic is correct and I could not
construct a comment-hidden heading that survives it. All three callers fail closed, verified
by execution. No new fail-open path exists. The change is correctly scoped to `scripts/ci/**`
plus the decision-log entry. F1, F2 and F4 are worth one tracked follow-up issue between them;
none of them blocks this merge, and every one of them describes a state strictly better than
what is on `main` today.

---

# Delta review — 2026-09-22, head advanced to `71ed064`

**Reviewed head:** `71ed0648865493955225154b4293ce3d80b7dd49`

**Reviewer:** Opus 5 (1M context), a second fresh independent context. It did not author,
direct, or remediate this change or any of the five commits that landed after
`9f4ae0a`; in particular it did not author `1b0673c`, the decision-log correction examined
below. Verified in its own isolated detached worktree at `71ed064`.

**Why this section exists.** Rule 3 of `scripts/ci/lib/security-review-note.mjs` judges
staleness over *every commit that landed* after the newest attested head, not over the net
tree between the two endpoints — deliberately, because an unreviewed commit plus its revert
cancels out in a net diff (that file's own GPT-F5 bypass). Five commits landed after
`9f4ae0a`, so the note went stale mechanically. This section is the delta review that rule
asks for, and it re-derives the claim rather than accepting it.

## Every landed commit in `9f4ae0a..71ed064`, judged on what it contributed

| Commit | Kind | Paths it contributed |
| --- | --- | --- |
| `665ceb4` | from `main`, PR #224 | `apps/web/src/routes/**` (3 files) |
| `54cfb22` | merge of `main` into the branch | nothing of its own — see below |
| `1b0673c` | branch | `docs/07-planning/decision-log.md` only |
| `fd24988` | branch | `docs/07-planning/security-reviews/146-comment-hidden-heading.md` only |
| `16ff76c` | from `main`, PR #216 | `apps/api/src/**`, `tests/api-contract/openapi.json`, `docs/07-planning/security-reviews/216-openapi-404-declarations.md` |
| `71ed064` | merge of `main` into the branch | nothing of its own — see below |

**Neither merge is an evil merge.** Checked by diffing each merge against *both* parents, not
by trusting the commit message. `git diff 9f4ae0a 54cfb22` is exactly `665ceb4`'s own
diffstat, and `git diff fd24988 71ed064` is exactly `16ff76c`'s own diffstat — so neither
merge commit smuggled in content that is in no parent, and neither dropped a parent's content
during conflict resolution.

## The reviewed surface is byte-identical, proved three ways

1. **Tree object identity.** `git rev-parse 9f4ae0a:scripts/ci` and
   `git rev-parse 71ed064:scripts/ci` are the same object,
   `d799d3d213ba3dc1157e6c3667abf602f39d8b91`. Every file under `scripts/ci/**` is
   bit-for-bit what was reviewed.
2. **Scoped endpoint diff.** `git diff 9f4ae0a 71ed064 -- scripts/ci/` is empty.
3. **Net PR contribution, against the moved merge base.** The merge base with `main` advanced
   from `cd21e5a` to `16ff76c`. `main` itself touched nothing under `scripts/ci/**` across
   that span, and the PR's net contribution (`git diff <merge-base> <head> -- scripts/ci/`) is
   the identical 342-line diff before and after. The code that would land is unchanged.

Also confirmed unchanged across the delta: `.github/**`, every `package.json`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `docs/04-engineering/ci-cd.md` (whose glob list
*defines* security-review scope). So nothing moved the scope boundary, the gate wiring, or
the dependency graph underneath the original review.

## The one in-scope change: `1b0673c`, the decision-log wording fix

Read as a diff, not as a commit message. It is a two-line edit inside the `Why:` paragraph of
the #146 entry, and nothing else:

```diff
-**Why:** the ready fix is low-risk and immediately mergeable (117/117 new tests, 451/451 full
+**Why:** the ready fix is low-risk and immediately mergeable (117/117 `pr-body.test.mjs`,
+of which 4 are new for this fix; 451/451 full
 CI-script suite, verified fail-against-old/pass-against-new), and it applies a pattern this
```

This is exactly finding **F5** above, and the correction is faithful to what I measured: 117
is the whole suite, 4 are new. The decision itself, its `Alternatives`, its `Decided-by`
attribution, and every other entry in the file are untouched. No authority, scope, gate
semantics or product decision changed.

One note on append-only discipline, since this edits an existing entry rather than adding a
new one: the #146 entry does **not** exist on `origin/main` — it is introduced by this same
unmerged PR. Correcting a factual claim in an entry before it first lands is not rewriting
committed decision history, so `CLAUDE.md`'s append-only rule is not engaged here. Had the
entry already been on `main`, this would have needed a superseding entry instead.

## Tests re-run at the new head, not carried over

Run in the isolated worktree at `71ed064` after `pnpm install --frozen-lockfile`, on Node
v24.20.0:

- `node --test scripts/ci/lib/pr-body.test.mjs` — **117 pass, 0 fail** (17 suites).
- `node --test 'scripts/ci/**/*.test.mjs'` — **451 pass, 0 fail** (76 suites, 26.6 s).

Both counts match the PR's claim exactly. Nothing regressed; the two merged-in PRs do not
disturb the CI-script suite.

## What this delta review did NOT do

- It did not re-derive the #146 visibility logic, the adversarial payload matrix, or the
  fail-closed analysis of the three callers. It did not need to: the tree object proves the
  code is the same bytes the original review read at `9f4ae0a`. If that surface had changed
  by even one byte, this section would say so and would not have cleared it.
- It did not review PR #224's `apps/web` change or PR #216's `apps/api` / OpenAPI change on
  their merits. Both merged to `main` through their own gates; this review only confirmed
  they land outside the surface #223's clearance covers.
- It did not merge, did not edit `## Gates`, did not waive anything, and modified no file in
  the repository other than this note.

## Delta verdict

**The original CLEAR WITH FINDINGS (non-blocking) verdict stands unchanged, now at head
`71ed0648865493955225154b4293ce3d80b7dd49`.**

Nothing in the security-review surface this clearance covers changed. The only in-scope edit
is a purely textual correction that this review's own F5 asked for, and it is accurate. The
five intervening commits are two unrelated `main` merges, a review artefact, and that wording
fix. F1, F2 and F4 remain open as follow-ups and still block nothing.

---

## Further sync — 2026-09-22, head advanced to `3664141`

One further main-sync landed after the delta review above (PR #219's calendar-preview
merge — `packages/domain/src/calendar/calendar.ts`, `packages/domain/src/calendar/
preview.test.ts`, no file this review covers). Re-checked directly by the orchestrating
session rather than a third reviewer round, given the merge shares no file with this PR:
`git diff 71ed0648865493955225154b4293ce3d80b7dd49 36641411bc56a2c331f0a3b89de698b1dc50eded
-- scripts/ci/ docs/07-planning/decision-log.md` is empty, and `node --test
scripts/ci/lib/pr-body.test.mjs` re-run clean at the new head: 117/117.

**Reviewed head:** `36641411bc56a2c331f0a3b89de698b1dc50eded`
