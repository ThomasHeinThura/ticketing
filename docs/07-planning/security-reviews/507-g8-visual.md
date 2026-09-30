# Security review — G8 visual regression gate (#507)

**Reviewer:** GPT-6 Sol, fresh independent context. The reviewer did not author or remediate the candidate.
**Reviewed head:** `da5e2987168aad43a1165585b72503c9a5cfa995`
**Pull request:** #507, `test(ui): enforce G8 visual route coverage`
**Base:** `6a93fb3b75f7aa90bcff127ccf545eb5b3ad1670`
**Date:** 2026-09-30

## Scope

Reviewed `.github/workflows/ci-full.yml`, `scripts/ci/check-visual-scope.mjs` and its probes, Playwright route and Storybook screenshot specs/configuration, the visual screen manifest, package scripts, G8 decision/spec text, `docs/04-engineering/ci-cd.md`, and the active `protect-main` ruleset (ID `22365005`).

## Review

**Verdict: BLOCK G8 enforcement claim pending the live ruleset update.** No additional concrete source-code bypass was found in the reviewed candidate.

**Blocking finding:** `docs/04-engineering/ci-cd.md` says `visual regression (G8)` is required, but active ruleset `protect-main` omits that status from its required checks. The candidate's visual job passes, but its failure or skip would not itself prevent a merge. The ruleset must require the exact `visual regression (G8)` status before this PR can claim that G8 is enforced at merge.

The workflow implementation and scope checker do not currently show a matcher/checker bypass. The G8 scope check covers the two active routes in the 122-row inventory and the browser suite covers route and exported Storybook cases. The review did not individually approve the baseline images. No GitHub settings were changed during review.

## Evidence

- `gh api repos/ThomasHeinThura/ticketing/rulesets/22365005` — active strict `protect-main` ruleset; its 16 required contexts omit `visual regression (G8)`.
- Current-head visual regression CI — pass: scope check, 3 route screenshot cases, and 137 Storybook story cases.
- Current-head gate-checkers CI — 955/955 tests passed.
- Current-head Postgres integration CI — passed.
- `git diff --check` — clean.
- The required PR-template/security-review and dependency-audit checks were red when reviewed; they remain separate merge blockers.

## Required follow-up

Keep the PR blocked until the active repository ruleset requires `visual regression (G8)`, then rerun and verify protected checks. This note does not claim the live ruleset was changed or that the candidate is merge-ready.
