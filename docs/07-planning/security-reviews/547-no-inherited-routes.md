# PR #547 — inherited integration-route gate review evidence

**Reviewed head:** `2751ab71e86e23cd20e9e7a30860a7b92190955e`
**Comparison base:** `494b7e9ac8db200e1c5c599b1b73911684314bbf`

This note records the actual independent ordinary and security reviews of the exact source head, including the accepted #546 main composition. It does not claim that this note's commit was reviewed: only a review-artefact commit is permitted after the attested source head. It does not claim phase completion, a gate waiver, or merge readiness.

## Published independent review evidence

- Original candidate strong GPT-6 Luna review at `828dda2f09c5cbf618aa747f34b80b3503a1de7c`: [review comment](https://github.com/ThomasHeinThura/ticketing/pull/547#issuecomment-5928332224). No blocking or non-blocking findings.
- Current composed-head independent GPT-6 Luna delta review at `2751ab71e86e23cd20e9e7a30860a7b92190955e`: [review comment](https://github.com/ThomasHeinThura/ticketing/pull/547#issuecomment-5928568594). It confirmed the ordinary merge composition preserved the accepted #546 seed CI and the unchanged six-file PR source diff; no blocking findings.
- Independent full GPT-6 Sol security review at exact head `2751ab71e86e23cd20e9e7a30860a7b92190955e`: [review comment](https://github.com/ThomasHeinThura/ticketing/pull/547#issuecomment-5928599664). The reviewer was a fresh context that did not author, direct, or remediate the candidate.

## GPT-6 Sol scope and verdict

**Verdict: PASS — no blocking or non-blocking security findings at the exact reviewed head.** The reviewer examined the complete six-file PR diff:

- `.github/workflows/ci-fast.yml`
- `docs/04-engineering/ci-cd.md`
- `docs/04-engineering/testing-strategy.md`
- `package.json`
- `scripts/ci/test-all.mjs`
- `tests/permissions/no-inherited-integration-routes.test.ts`

This is a bounded CI/security-control change, not a runtime authorization change. The actual constructed Hono router is required and non-empty before its route paths are checked. The constructed better-auth plugin array is required and non-empty before the forbidden IDs are checked. Exact forbidden names remain `octokit` and `@octokit/webhooks`, including package/snapshot mappings and importer aliases; allowed neighboring packages such as `@octokit/core` and `@octokit/types` are not blanket-banned. The existing `better-auth-plugin-list.test.ts` remains the authoritative exact approved-list and shrinking control. The test command is an unconditioned, failure-propagating step inside the existing `route-policy` job, and the enabled `test:all` manifest entry agrees. The change adds no required status context and changes no runtime routes, authorization, schemas, dependencies, or environment configuration.

## Checks actually run by the independent Sol reviewer

- `pnpm test:no-inherited-routes`: **pass, 1 file / 5 tests**; Turbo reported 5/5 tasks successful, with four prerequisite builds cached and the test executed.
- `node --test scripts/ci/probes/workflow-gate-drift.test.mjs`: **pass, 54/54 tests** across four suites, including shipped workflow reconciliation and negative schedule/execution/failure-propagation cases.
- `node scripts/ci/test-all.mjs --list`: **pass, 38 declared gates, new focused gate enabled**. This lists gates; it does not execute all 38.
- `git diff --check 494b7e9ac8db200e1c5c599b1b73911684314bbf..2751ab71e86e23cd20e9e7a30860a7b92190955e`: passed.
- The Sol reviewer checked local and GitHub PR head/base agreement and confirmed the worktree was clean around the review.

The original-head `pnpm test:permissions` result of 14 files / 88 tests belongs to the implementation run, not the independent Sol reviewer. On composed source head, the earlier workflow run `36841277670` was **cancelled** and is not green. Its available logs showed the full permissions suite and focused gate passing, but cancelled required contexts cannot be counted green.

## Hosted checks and limits at note compilation

On the same source head, hosted run `36841339051` completed with only `pull request template + security review` failing; the other listed fast jobs were green, including `static`, `build`, `unit + component`, `route policy coverage + permission matrix`, `contract - OpenAPI drift`, CI reconciliation, and gate probes. The contract job reported 17 Redocly baseline findings with 0 new findings and oasdiff 1.32.1 with 0 unapproved breaking changes. Complementary hosted run `36841277676` completed successfully, including PostgreSQL integration, accessibility, visual regression, and protected-route E2E. These runs are tied to source head `2751ab71e86e23cd20e9e7a30860a7b92190955e`; they predate this note-only commit and do not represent check results for the note commit's new SHA.

The failed PR-template check at the time of those runs was a body/review-evidence issue: exact gate result tokens, the committed note link, and the mandatory completed independent-review checklist record had not yet been fully updated. The PR body and a fresh required check run must be validated after this note is committed. Do not read canceled run `36841277670` as green.

The implementation's earlier macOS `pnpm test:all --stage fast` attempt did not complete its pinned `oasdiff` installer (Linux x64 only); Redocly had 17 baseline findings and 0 new findings. The later hosted Linux OpenAPI result above is separate evidence and does not change that historical outcome. The Sol reviewer did not run the broad permissions, integration, image, browser, or full `test:all` suites. No image/runtime boot, health endpoint, or browser verification is claimed.

## Review attribution

The independent reviewers produced the linked reports and verdicts. This note compiles that evidence; its author is not a reviewer and claims no independent review. The review verdicts do not waive or replace required current-head checks or the P0 phase finalizer.
