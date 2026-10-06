# PR #538 — independent GPT-6 Sol security review

**Reviewed head:** `20835eb3afa9cccc1dbabcf2ddd91619bd6baa58`

- Reviewer: GPT-6 Sol, fresh independent context. I did not author, direct, or remediate this candidate.
- Base: `22df407eb14e4bd5d45e4534144aec9ce2b9dfbe`.
- Scope: complete diff in `scripts/ci/probes/repo-root-cwd.test.mjs` and `scripts/ci/probes/test-contract-root.test.mjs`; inspected `scripts/ci/lib/repo.mjs`, `scripts/ci/lib/scratch-repo.mjs`, and `scripts/ci/test-contract.mjs` to verify the underlying authority and allowlist contracts. Both changed files are within the mandatory security-review scope of `docs/04-engineering/ci-cd.md`.
- Classification: bounded CI probe correction. Only test code changes; no checker implementation, allowlist, exception, or gate threshold changes.
- Verdict: **CLEAR**. No blocking or non-blocking findings.

## Security checks

- Caller preference: the existing two-checkout probe still requires `repoRoot` to select the calling checkout, and the new symlink probe creates an actual alias, verifies it differs from the canonical path, requires the canonical caller root, and rejects the script checkout root. `realpathSync` in expected values accounts for macOS `/tmp` versus `/private/tmp` and equivalent canonical aliases without accepting an arbitrary root.
- Fallback and failure: the non-git-cwd probe still requires the script checkout's canonical root. The git-unrunnable and broken-worktree probes still require errors, not a silent fallback.
- Repository provenance: the unrelated real git repository still fails the TaskDesk marker check; a genuine caller checkout carrying the marker still passes. `changedPaths()` remains checked against a change unique to the caller checkout.
- Allowlist authority: `test-contract.mjs` still constructs the approved-breaks path from imported `repoRoot`. Its probe requires the caller checkout path and rejects the script checkout path. The path assertion now uses a canonical expected caller root and does not weaken allowlist contents or approval rules.
- `git diff --check origin/main...HEAD`: passed.
- Independently ran `node --test scripts/ci/probes/repo-root-cwd.test.mjs scripts/ci/probes/test-contract-root.test.mjs`: **9 tests, 9 passed, 0 failed, 0 skipped**, across 2 suites.

Residual: this focused review did not rerun all CI probes or hosted required checks. Those are separate candidate gates; the author's reported full probe run is not presented as my own execution. This is the per-PR security review, not the P0 phase finalizer.


## Ordinary review record

Fresh independent GPT-6 Luna `/root/p0_537_538_luna_review` cleared the same exact source head `20835eb3afa9cccc1dbabcf2ddd91619bd6baa58`, inspecting the complete probe diff and resolver/allowlist invariants and independently running both probe files (9 tests, zero skipped). PR comment 5925067302 records that review. The reviewer did not author or remediate the candidate. This follow-on commit only records the independent security evidence.


## Main storage integration

# PR #538 main-integration delta review

- **Reviewer:** GPT-6 Luna, fresh independent context; did not author, direct, or remediate the candidate.
- **Exact candidate:** `4db7b993338ce7c81c45759d7875c086c2503bfc`; GitHub head matches.
- **Previously reviewed source:** `20835eb3afa9cccc1dbabcf2ddd91619bd6baa58` (strong ordinary review CLEAR).
- **Base:** `main` / `cefaec8bc6c37eb6ecd938153de06d290c60c5f2`.
- **Verdict:** **CLEAR for the main-integration delta.**

## Evidence inspected

The candidate merges current main (`cefaec8`) and adds the recorded #535 storage-root review note. `git diff --quiet 20835eb..4db7b99` over both PR source probes (`scripts/ci/probes/repo-root-cwd.test.mjs`, `scripts/ci/probes/test-contract-root.test.mjs`) returned 0: reviewed source bytes are unchanged. Main's #533 filesystem-root code/test and branding assets do not overlap either probe. Candidate merge base with current main is exactly `cefaec8`; current PR head/files were confirmed on GitHub.

The prior review's focused probe run (9 passed) and diff inspection remain applicable to unchanged source. **No tests were run for this integration delta** because it adds no probe source changes and the orchestrator's G11 diagnostic quiet window is active. Current hosted unit/component, integration and G8 checks are in progress; PR-template/security-review is failing. This is not a merge-readiness determination.

No code findings in the integration delta. The separate required security gate still applies to the security-scope probe paths.

# PR #538 — independent GPT-6 Sol security review of main integration

- **Exact candidate:** `4db7b993338ce7c81c45759d7875c086c2503bfc`.
- **Comparison base:** `cefaec8bc6c37eb6ecd938153de06d290c60c5f2` (the candidate's second parent and current PR base at review time).
- **Earlier fully reviewed source:** `20835eb3afa9cccc1dbabcf2ddd91619bd6baa58`; a strong independent GPT-6 Luna ordinary review and full independent GPT-6 Sol security review were recorded for that source.
- **Reviewer:** fresh independent GPT-6 Sol context. I did not author, direct, or remediate either candidate. This is a per-PR exact-head delta confirmation, not a P0 phase finalizer.
- **Verdict:** **CLEAR for this exact main-integration delta.** No blocking or non-blocking security finding in the integration. This does not clear a red required check or authorize merge by itself.

## Inspection and composition

I checked the GitHub PR head, files and check snapshot; both parents of the merge commit; first-parent delta from `1f2d83f` (branch review-note head) to this merge; second-parent net diff from `cefaec8` to this candidate; the prior full Sol and strong Luna reports; the fresh ordinary main-delta review; the CI security-scope list; and the complete two-probe source diff and its underlying `repoRoot`, scratch-repository and approved-breaks path contracts. The branch-only commit after the full Sol source review (`1f2d83f`) adds its review note. `git diff --quiet 20835eb 4db7b99 --` for both changed probe files returned **0**. The candidate-to-main net diff is the original two probes and the review note. No gate implementation, allowlist or threshold is changed by this integration.

The main merge imports #535's filesystem-root canonicalization and storage test/review note. Those application storage paths are separate from `scripts/ci/lib/repo.mjs` and the two CI probes. The probes' `realpathSync` expectations still demand the caller checkout's canonical root, reject the script checkout, retain failure on an unrunnable git or broken worktree, and use `repoRoot` for the approved-breaks path. Main's application storage change does not change any of those contracts. The earlier #532 branding integration also introduces no probe/checker overlap. I found no cross-change authority or gate-pass/fail conflict. This is an independent composition check, not a replacement for the original full Sol review.

## Verification and limits

No local tests or builds were run in this delta pass, honoring the orchestrator's active G11 diagnostic quiet window. The earlier full Sol pass independently ran both focused probes (**2 suites/9 tests passed**); the strong Luna review and fresh ordinary delta review retain their own recorded evidence. At this review's GitHub snapshot, exact-head gate probes, unit/component, build, G8 and other completed checks were green, integration was still in progress, **pull request template + security review was red**, and G11 was listed as not enabled. I did not waive any gate. The original focused-review residual remains: no full local CI-probe or hosted-gate rerun by this reviewer. Any later head or base change needs a new exact-head review decision.


## Post-#537 JSDOM test integration

# PR #538 post-#537 main integration delta

- **Reviewer:** GPT-6 Luna, fresh independent context; did not author, direct, or remediate this candidate.
- **Current exact candidate:** `074ff21f3f0f4d90b565700b00b08ebc86e59632` (GitHub head confirmed).
- **Previously reviewed candidate:** `4db7b993338ce7c81c45759d7875c086c2503bfc`.
- **Current main/base:** `5d8024cfeaec4f4448665b4e9fce9eb5e1ba2113`; current candidate merge-base equals this SHA.
- **Verdict:** **CLEAR for the post-#537 integration delta.**

## Evidence

The first-parent history shows `074ff21f` merges current main. Comparing old to current candidate produces exactly the three files from merged PR #537: `apps/web/src/test/setup.ts`, `apps/web/src/test/jsdom-local-storage.ts`, and `apps/web/src/test/jsdom-local-storage.test.ts`. Comparing PR #538's two probe source paths and review note between `4db7b99` and `074ff21` with `git diff --quiet` returned 0: all previously reviewed probe content is byte-identical. The main-relative candidate diff still contains only the three PR #538 paths. The JSDOM additions do not overlap the CI probe paths, and no merge-resolution changes were introduced.

No tests were run for this source-identical main import. The prior focused probe review remains applicable to unchanged source; this delta review does not claim tests were rerun or supersede required hosted/security gates. No code findings in the delta; not a merge-readiness determination.

# PR #538 — independent GPT-6 Sol security review of post-#537 main integration

**Reviewed head:** `074ff21f3f0f4d90b565700b00b08ebc86e59632`
**Current main/base:** `5d8024cfeaec4f4448665b4e9fce9eb5e1ba2113`
**Prior fully reviewed candidate:** `4db7b993338ce7c81c45759d7875c086c2503bfc`
**Reviewer:** fresh independent GPT-6 Sol context; I did not author, direct, or remediate the candidate. This is a per-PR exact-head integration confirmation, not the P0 phase finalizer.
**Verdict:** **CLEAR for the post-#537 integration delta.** No blocking or non-blocking security finding in this delta. This is not a merge-readiness verdict.

## Evidence and security composition

I checked the live GitHub head/base/files/check snapshot, the merge commit's two parents, the old-to-new first-parent diff, the current-main-to-head net diff, the fresh independent Luna delta report, and the previously recorded full Luna/Sol reviews. The second parent and merge base are exactly current main. The first-parent delta imports only #537's three `apps/web/src/test/` files: `setup.ts`, `jsdom-local-storage.ts`, and `jsdom-local-storage.test.ts`. The main-relative net diff still comprises only PR #538's two CI probes and recorded review note. `git diff --quiet 4db7b99 074ff21 --` over all three PR paths returned 0, confirming byte-identical reviewed candidate content and no merge resolution in it.

I inspected all three imported files. They install JSDOM's browser `localStorage` into the web Vitest test window and test that behavior under a shadowing host global. They do not load in the Node `node:test` CI probes or change `scripts/ci/lib/repo.mjs`, scratch-repository construction, `test-contract.mjs`, the approved-breaks allowlist, any gate implementation or threshold. The probes still assert the canonical caller checkout rather than the script checkout. The earlier full Sol review and previous main-integration Sol review remain applicable to unchanged source; I independently checked the new composition for this exact head.

## Tests and residuals

**No local tests or builds were run for this source-identical integration delta.** The earlier focused security run of the two probes (9/9 passed) remains recorded in the prior full Sol review; I do not claim to have rerun it. At my GitHub snapshot, integration and G8 were still in progress and `pull request template + security review` was red; other completed required checks shown were green, while G11 was reported not enabled. All required gates remain the orchestrator's responsibility. The earlier focused-review limit (no full local CI-probe rerun by this reviewer) remains. A later head or base change requires a fresh exact-head decision.
