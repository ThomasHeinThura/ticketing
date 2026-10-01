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
