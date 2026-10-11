# PR #655 current accepted composition — ordinary review C

**Reviewed head:** `f4bf750712cad6a65f4b86d5a238e8c0da825603`
**Reviewer provenance:** Fresh independent ordinary reviewer context dispatched by the root session; selector `gpt-6-luna`, `fork_turns=none`. The reviewer report states the platform exposed only the generic GPT-6 family and does not independently attest the serving variant. No Luna serving-variant claim is made here.
**Original report SHA-256:** `d36daa00ca3e865380a7c2099c08893b2d760ee017389fba6e1a1b8f1408afd5`
**Public original:** https://github.com/ThomasHeinThura/ticketing/pull/655#issuecomment-6111581358

## Original report (verbatim)

# Independent ordinary review — PR #655 current accepted composition

- **Reviewed head:** `f4bf750712cad6a65f4b86d5a238e8c0da825603`
- **Comparison base:** `5abe19bccf0d9c1d61482cb372ea81c40485d4e2` (accepted `main`, #659)
- **Role / independence:** Fresh ordinary reviewer context. I did not author, direct, or remediate this candidate.
- **Reviewer selector:** `gpt-6-luna`, `fork_turns=none` (dispatch provenance). The platform exposes only the generic GPT-6 family in this context; I cannot independently attest the serving variant.
- **Branch:** `codex/mfa-cross-process-barrier`
- **Scope:** Exact current delta and all merge-parent additions, both test fixtures and their oracles, build/import inputs for boot refusal, review-record preservation, and the prior MFA contention-barrier finding.
- **Risk classification:** Test-only composition plus review records. No changed path is in the accepted CI/CD security-scope list, and no runtime authorization, CI gate, or acceptance semantics changed.

## Evidence

- Exact checkout: `git rev-parse HEAD` returned the reviewed head; worktree was clean before review.
- `git diff --raw 5abe19bccf0d9c1d61482cb372ea81c40485d4e2..HEAD` shows only:
  - Added `docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md` (the authentic prior ordinary reports).
  - Modified `tests/api/mfa-csrf-app-fixture.test.ts`.
- The owned MFA fixture and prior review note are byte-identical to their pre-composition blobs (`5efa5d5a…` and `55f94ebe…` respectively); this composition did not rewrite either.
- Inspected the accepted-main commit range from the composition source `46b846c284d2a80ec621e3242d906bcfd673faf5` to the current merge using both `git log -m --raw --no-abbrev --no-renames` and `git log -m --numstat`. This charges merge commits per parent. The accepted #659 changes carried into the branch are exactly 13 decision-log additions, the 139-line approved deadline record, the 198-line role-query composition record, and the boot/refusal test change (123 additions / 18 deletions); #657's earlier accepted role-query product source, test and review record also appears in the merge-parent history. No source change is hidden by relying on only a net-tree diff. The current two-parent merge itself applies those #659 paths plus the preserved MFA fixture and note.
- Read the current MFA fixture and the accepted boot/refusal test. The latter retains the fresh bounded API build, launches a child importing the production `apps/api/dist/index.js` with an invalid policy path, and asserts no spawn error, no signal, nonzero exit, the exact `PolicyEnforcementConfigError`, and absence of the successful-import marker. The successful import marker is emitted only after the import returns. Test bootstrap values are confined to the test child environment. The owner-approved child/outer deadlines are 10s/11s; the 5s build bound and refusal oracles remain. This does not identify or clear the historic unrelated hosted import timeout.
- Confirmed the MFA test's real lock-contention callback is reached before its negative callback-entry assertion, then callback entry is required after release. The child cleanup remains in `finally`; assertions and timeout are retained. The previously reported early-child-exit diagnostic delay remains: the waiting/contention promises are not raced against child completion, so premature exit can be reported only at the outer 20s timeout; cleanup still runs and there is no false-pass path.
- `git diff --check 5abe19bccf0d9c1d61482cb372ea81c40485d4e2..HEAD`: clean.
- Exact focused command run at the reviewed head:
  `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/mfa-csrf-app-fixture.test.ts ../../tests/api/permissions/enforcement-config.test.ts`
  Result: **2 files passed, 18 tests passed**, Vitest 4.1.11, duration 3.83s. This executed the MFA process-contention fixture and the boot test's fresh build plus production-bundle import/refusal oracle. No broader suite, database, image, browser, or performance run was performed.

## Findings

- **Non-blocking reliability / diagnostics (retained):** Race child completion against the MFA test's waiting/contention barriers so an early child or supervisor failure is reported immediately rather than after the outer timeout. This remains a bounded diagnostic delay; it does not invalidate the lock oracle or produce a false pass. It is not a new blocker in this composition.

## Verdict

**Approve with one non-blocking finding.** The accepted-main composition preserves the MFA fixture and prior reports, includes the accepted boot/refusal fixture with its production build/import inputs and negative oracle intact, and passes both focused files at the exact head. This source review and focused run do not clear current required GitHub status checks; those must be green on this exact candidate SHA. The prior G11 observations (calibration throttled spread 0.566 > 0.55 on `46b846c…`, and the earlier 503.7 board observation on `7e709db…`) remain unresolved historical measurements: no changed-candidate rerun, diagnosis, cause fix, or waiver is implied.

