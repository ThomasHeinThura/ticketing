# Pre-merge security review — PR #129 (governance reset: merge delegation, model tiers, UAT priority)

**Reviewed head:** `324dcc6f5e0ba806d31d17e2c0d36eb107e28a44`
**Base:** `origin/main` = `8110e3bca7bb30d72e7aee79826ee50973d82d06`

**Verdict: CLEAR FOR MERGE.** Zero blocking findings outstanding at the reviewed head. Two
prior blocking rounds on earlier heads of this same candidate, both closed by remediation
this reviewer then independently re-verified — recorded below rather than collapsed, since
the reversals are the reusable part of this record, not an embarrassment to tidy away.

**Status of the gate.** This review ran before merge and closes the mandatory independent
Opus security review for the head named above, and for that head only. A later commit
touching anything outside `docs/07-planning/security-reviews/` voids it. No waiver was
sought or used on this candidate; none is authorized for it — see the finding this review
itself produced, below.

**Reviewer independence.** A fresh Opus context, spawned explicitly via the `Agent` tool
with an explicit model pin, that authored no part of the change under review, no part of
its remediation, and no part of the two Sonnet ordinary reviews that ran alongside it. It
made no edit, commit, push, or merge — only PR comments recording its findings.

**Why this candidate is in security scope at all.** The first commit (`AGENTS.md`,
`CLAUDE.md`, decision-log, CHANGELOG) touched no path on `ci-cd.md`'s security-review-scope
list. The second commit — reconciling `docs/04-engineering/agent-workflow.md`,
`docs/04-engineering/ci-cd.md` and `.github/CODEOWNERS` with the same change, after two
independent Sonnet reviews found those files still contradicting it — put `.github/**` and
`ci-cd.md` itself in scope. That reclassification was caught by a Sonnet reviewer's re-check
before this Opus review ever ran, which is the scope-can't-see-itself control working as
designed.

---

## Round 1 — head `ec994e5605c9222eaa56b266f48a80a134e7469b`: BLOCKED

**B1 (blocking).** The gate-waiver mechanism (`scripts/ci/lib/gate-waiver.mjs`) mechanically
verifies a waiver was *declared* in the required form — bound to one decision-log entry, one
gate, one PR, one follow-up issue — but has always explicitly not verified *who* authorized
it, because agents commit through the same repository identity Thomas does. Until this PR,
the real compensating control was informal but genuine: Thomas was the one clicking merge,
so he was the last human able to catch a fabricated or premature waiver citation before it
landed. This PR delegates merge execution to the orchestrating Claude session once required
gates are green, which silently removed that check for any candidate that cites a waiver —
a self-referential gap in the delegation's own design, in the same document class (CI/gate
machinery) the 2026-09-08 decision-log entry already flagged as needing extra scrutiny for
exactly this reason.

**M1 (non-blocking).** `docs/04-engineering/agent-workflow.md`'s new self-review-guard
sentence read two ways: one reading forbade the exact orchestrator-spawns-independent-Opus-
subagent pattern this whole policy prescribes and this review itself is an instance of.

**M2 (non-blocking, not fixed in this PR).** Reviewer independence and tier are asserted
through strings the merging agent itself writes into the PR body (`## Reviewed by`,
`## Security review`); nothing mechanically verifies the named model actually ran, or that
the session was genuinely independent. Tracked as
[#130](https://github.com/ThomasHeinThura/ticketing/issues/130) — a harder problem than
this PR's scope, not solved here.

**Remediation (commit `986ca3a`):** `AGENTS.md` and `CLAUDE.md`'s merge-delegation sections
now explicitly exclude any candidate whose `## Gates` table cites a waived gate — that
always needs Thomas's own action to merge, never the orchestrator alone. `ci-cd.md`'s
waiver paragraph and `gate-waiver.mjs`'s doc comment updated to stop asserting a check that
no longer exists by default (comment-only in the `.mjs` file, verified with `node --check`).
`agent-workflow.md`'s guard reworded to state plainly that the constraint is on the spawned
subagent's freshness, not on who is allowed to spawn it.

## Round 2 — head `c386ae1b5b0f7ed3462ad8d36d5750a7c31ba08e`: BLOCKED (residual)

Re-review of the round-1 remediation confirmed B1 and M1 closed for the mechanism itself —
the exclusion is well-anchored (`check-pr-template.mjs` restricts the `## Gates` cell to
`pass|n/a|waived`, so an agent cannot hedge past the token the rule keys on) and the
security-review gate remains structurally un-waivable. But `.github/pull_request_template.md`
— the file an agent actually reads while filling in the `## Gates` cell — still said *"it
cannot verify who approved it, so that part is still Thomas's at the merge button."* One of
five files carrying that phrase, missed by the round-1 sweep.

**Remediation (commit `324dcc6`):** replaced the stale sentence with a pointer to the
`AGENTS.md` exclusion rule, and added a sentence stating that marking a gate `n/a` when it
actually applies is reviewed the same as fabricating a waiver — closing, by documentation
rather than new tooling, the sibling gap this round also flagged informationally (the
exclusion keys on the literal token `waived`; an `n/a` used dishonestly would sidestep it
mechanically, though it remains reviewable the same way everything else in this PR is).

## Round 3 — head `324dcc6f5e0ba806d31d17e2c0d36eb107e28a44`: CLEAR

Verified directly, not accepted on report:

- **Delta scope.** `git diff c386ae1 324dcc6` is exactly one file, one hunk, +6/−3, entirely
  inside `.github/pull_request_template.md` between `## Gates` and `## Checklists`.
  Branch-vs-`main` is 9 files, matching `gh pr diff --name-only` exactly — nothing smuggled
  outside the claimed scope across all three rounds.
- **Replacement text.** Every claim in the new sentence checked against the actual
  mechanism: CI verifies the binding (true), cannot verify authorship (true, and no longer
  paired with a remedy that doesn't exist), the exclusion matches `AGENTS.md` and
  `CLAUDE.md` in substance, and the cross-reference link resolves.
- **No remaining stale claim.** Five files still contain the phrase this review chased:
  `AGENTS.md`, `CLAUDE.md`, `ci-cd.md`, `gate-waiver.mjs`, `decision-log.md`. Read all five
  directly — every occurrence is past-tense, explicitly describing the control as removed
  and dated 2026-09-15. Correct handling of a superseded control being kept as history, not
  a leftover contradiction.
- **No mechanical regression.** The template-completeness checker reads this file to catch
  section deletion; the edit adds and removes no heading, all nine `##` sections intact.
  Every test touching the template or waiver machinery run at this exact head:
  **103 passed, 0 failed** (`gate-waiver-binding` 13, `screens-opened-state` 9,
  `security-paths` 7, `pr-body` 68, `ci-cd-gates` 6).

---

## Findings — none blocking, one tracked

| # | Finding | Status |
| --- | --- | --- |
| B1 | Waiver-authorship check silently lost when merge delegated | **Fixed**, commit `986ca3a` |
| M1 | Self-review-guard wording ambiguous, one reading forbids the intended pattern | **Fixed**, commit `986ca3a` |
| M2 | Reviewer identity / waiver authorship is self-reported, not mechanically verified | **Tracked**, [#130](https://github.com/ThomasHeinThura/ticketing/issues/130), not fixed here |
| B1-residual | `.github/pull_request_template.md` missed by the B1 sweep | **Fixed**, commit `324dcc6` |
| — | `n/a` marking used dishonestly is the same class of gap as B1, mechanically unguarded | Documented (this PR), not mechanically closed — same scope boundary as M2 |

## What this review does not claim

This review clears the governance-file content of this PR against the threat model of "does
this delegation create a mergeable-without-a-human path for a fabricated waiver, a
downgraded reviewer, or self-approval" — it found one real instance of the first and closed
it. It does not claim the broader reviewer-identity problem (#130) is solved, does not claim
`status.md`'s staleness is fixed (explicitly out of this PR's scope, disclosed in the PR
body), and does not extend to any work this PR's new policy will later authorize — each of
those candidates gets its own review at its own exact head, same as always.
