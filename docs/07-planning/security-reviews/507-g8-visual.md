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

## 2026-09-30 · Current source review after G8 bypass remediation

**Reviewer:** GPT-6 Sol, fresh independent context; read-only review.
**Reviewed head:** `5cf25ffc54b0f5a17d66146aebb5d82fd48f9608`
**Base:** `6a93fb3b75f7aa90bcff127ccf545eb5b3ad1670`
**Source verdict:** CLEAR. The reviewer found no remaining concrete source bypass at this head.
**Merge verdict:** BLOCKED by the live ruleset omission below and failing required checks.

The review followed the earlier blocked heads through the current exact source head. The checker now binds the complete G8 visual job and its workflow root environment, the app and Storybook launch configurations, and Storybook's full source glob and rendering configuration. Red probes reject computed config overrides, empty shards, early exits, fake servers, narrowed Storybook discovery, inserted job steps, changed working directories, and workflow-wide `BASH_ENV`. Two independent GPT-6 Luna reviewers also cleared the final delta at this head. The Sol reviewer did not author or remediate it.

**Evidence at the reviewed source head:** Node 24 focused G8 checker tests passed 146/146; the full CI-script suite passed 997/997; Biome on the changed checker and probes and `git diff --check` passed. `pnpm lint` and `pnpm typecheck` passed earlier in this source series, with no app or package source changes afterward. GitHub's `visual regression (G8)`, `gate checkers + red probes`, and `unit + component` jobs passed on the reviewed source head. The visual check covers three route screenshots and the exported Storybook stories through the pinned discovery configuration. The reviewer inspected the source and probes; the reviewer did not rerun the browser suite locally or individually approve baseline images.

**External blocker:** Active `protect-main` ruleset `22365005` still omits `visual regression (G8)` from required contexts. The PR-template/security-review check was failing on the stale PR body and note, and dependency audit was failing on the default-branch dependency graph at the time of this review. No ruleset, deployment, DNS, or production setting was changed. Keep #507 draft and unmerged until those controls are resolved and all exact-head checks are green.

## 2026-10-01 · Exact-head delta review

**Reviewer:** GPT-6 Sol, fresh independent context; read-only review.
**Reviewed head:** `751f5925677ad7a19b0c0e1c62f5b38f5e28ce87`
**Base:** `1727b69a6c07b6a1276d2b414b43e23c5adbefdf` (`main`)
**Source verdict:** CLEAR. No additional concrete source bypass was found at this head.
**Merge-enforcement verdict:** BLOCKED pending the active `protect-main` ruleset update and exact-head required checks.

The reviewer examined the full G8 gate path, including the CI visual job and root environment; package script chain; Playwright route, base, and Storybook configs and specs; inventory and manifest mapping; screenshot checks; Storybook source discovery; checker and adversarial probes; G8 spec and 2026-10-01 decision. The review included all changes since `5cf25ffc54b0f5a17d66146aebb5d82fd48f9608`, including the fail-closed inventory parser change, the #519 dependency/workflow merge, and the G8 scope documentation update. The #519 dependency changes are in the base, and the exact-head dependency audit passes. The reviewer found the active-route contract and checker aligned. Future not-started route rows activate with implementation.

**Checks run by reviewer:** `node --test scripts/ci/check-visual-scope.test.mjs` — 148/148 passed, zero skipped; `pnpm check:visual-scope` — passed (3 route screenshot cases, 2 active route rows mapped, 122 route rows total); `git diff --check 1727b69a...HEAD` — passed. The exact-head GitHub visual job passed. The reviewer did not rerun the full browser suite locally or individually approve all baseline image pixels.

**Blocking findings at review time:**

1. Active strict `protect-main` ruleset `22365005` requires 16 contexts but omits the exact `visual regression (G8)` context. Add that context and verify it is required and green on the final candidate head.
2. `pull request template + security review` was red because the committed note's newest usable review head was still `5cf25ffc...`; six later landed commits changed paths outside review notes. This note-only exact-head addendum addresses that evidence gap, but the check must pass on the resulting final head.
3. Postgres integration was still running during review. Verify all required checks on the final exact SHA.

**Nonblocking finding:** The documented sign-in route/inventory naming mismatch remains; the `/auth/sign-in` screenshot still runs, and the mismatch does not affect the two active inventory route mappings.

The reviewer changed no code, ruleset, or production setting and did not merge. The active ruleset remains a separate merge blocker.
