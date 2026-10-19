# Auth directory security-review scope — issue #816

**Reviewed head:** `2f8681dc3d7184f62f9c8ea2a908adc67e996910`

The additive canonical `apps/api/src/auth/**` declaration closes the observed nested-auth matcher gap while preserving `auth*` and every former scope. The strong independent Luna review's initial regression-completeness finding is retained below, followed by the test-only correction, the same independent reviewer's exact-head delta disposition and a separate fresh full GPT-6.1 Sol security review. Their authentic scopes and commands are preserved.

Actual author verification at this source: 14 focused gate tests passed with zero failed or skipped, plus syntax and diff checks. This does not establish full CI or acceptance of a later composition. The source and reports still require composition with the then-current accepted main, applicable exact-head confirmation, current required CI and the protected PR flow. No review tier, waiver, note binding, runtime authority or source inventory is relaxed. PR #815 received manual independent ordinary/Sol reviews despite the earlier automated scope omission; no unreviewed-source claim is made.

The first author's two private EVID files were atomically relocated to the conductor's private evidence directory with original bytes and inodes preserved; canonical copies are byte-identical. No Git exclusion was added and no authentic report was rewritten. Historical relative artifact paths in the first report retain their original provenance; the conductor retains their exact transfer/relocation receipts.

## Authentic report: auth-directory-security-scope-author-luna.md

# Author evidence — #816 auth directory security-review scope

**Author model:** GPT-6 Luna
**Source:** `65c8cc93a952c672281ea2a7b12e5e48a5369905` on `codex/auth-directory-security-scope`
**Base:** `b78fd6853a890c6e2b10d17be18885e3b1612b2d`

Changed `docs/04-engineering/ci-cd.md` to explicitly cover `apps/api/src/auth/**` while retaining `apps/api/src/auth*`. Extended the existing security-scope shrink probe to verify the source-file pattern, nested auth coverage, merge-base/HEAD union retention after same-diff narrowing, and actual checker rejection when security review evidence is absent.

## Verification

- `node --test scripts/ci/probes/security-scope-shrink.test.mjs` — 5 tests passed, 0 failed. Full output: `EVID/auth-directory-security-scope-probe.log`.
- `node --check scripts/ci/probes/security-scope-shrink.test.mjs` — passed.
- `git diff --check` — passed before commit.

No full CI, image, database, browser, or product build was run; the assigned local verification window was limited to the focused gate probe and syntax/diff checks.

## Authentic report: auth-directory-security-scope-65c8-ordinary-luna.md

# Independent ordinary review — #816 auth directory security-review scope

**Reviewer:** GPT-6 Luna, fresh independent context; did not author, direct, or remediate this candidate.
**Candidate SHA:** `65c8cc93a952c672281ea2a7b12e5e48a5369905`
**Base SHA:** `b78fd6853a890c6e2b10d17be18885e3b1612b2d`
**Verdict:** REQUEST CHANGES — one blocking test-coverage finding.

I inspected the complete two-file candidate diff, the governing repository workflow and security-scope description, issue #816, the source matcher/parser, the changed shrink probe, the canonical scope unit tests, the checker path, and the author’s retained test log. The worktree was at the exact candidate SHA. The only extra worktree content was the provided untracked `EVID/` author evidence; I did not alter source files.

The documentation change correctly adds `apps/api/src/auth/**` while retaining `apps/api/src/auth*`. `globToRegExp` treats `*` as a segment wildcard, so this adds the missing nested-directory coverage and preserves auth root-file coverage. The production gate uses the union of merge-base and HEAD scopes, reports removed globs, and fails closed when baseline scope cannot be parsed. I found no change to accepted reviewer tiers, exact-head note binding, waiver behavior, or gate authority.

## Blocking finding

**The regression does not protect the canonical scope declaration or independently demonstrate nested-auth-only enforcement.** The new probe copies `apps/api/src/auth/**` into its synthetic `FULL_LIST`; that fixture is independent of `docs/04-engineering/ci-cd.md`. The canonical `scripts/ci/lib/security-paths.test.mjs` has no nested-auth representative in `MUST_REQUIRE_REVIEW`, and its retained-globs assertion checks `apps/api/src/auth*` only. Consequently, removing `apps/api/src/auth/**` from canonical `ci-cd.md` leaves both the new probe’s expected synthetic list and the canonical scope unit tests passing, while the real parser stops matching `apps/api/src/auth/repository.ts`.

I confirmed this read-only with the real parser: the candidate canonical document matches `apps/api/src/auth/repository.ts`; a counterfactual source string with the new glob removed parses successfully and does not match it. The new scratch end-to-end case also changes `ci-cd.md` while narrowing scope. Since `docs/04-engineering/ci-cd.md` is itself in scope and the case removes a glob, its checker rejection does not isolate the behavior of a nested-auth-only change. Add a regression bound to canonical parsed scope (and preferably an isolated scratch checker scenario where only a nested auth file changes) so the test fails if the canonical glob disappears.

## Commands and evidence

- `node --test scripts/ci/probes/security-scope-shrink.test.mjs scripts/ci/lib/security-paths.test.mjs` — **12 passed, 0 failed, 0 skipped**, about 2.3 seconds. This confirms the present tests pass; it does not close the finding above.
- Read-only parser counterfactual: candidate canonical scope matched nested auth; canonical source with `apps/api/src/auth/**` removed did not.
- `git diff --check b78fd6853a890c6e2b10d17be18885e3b1612b2d..65c8cc93a952c672281ea2a7b12e5e48a5369905` — passed.
- The author’s retained focused-probe log reports 5/5 passed and `node --check` passed.
- No full CI, image, database, browser, product build, compile or broad test run was performed.

The issue is limited to regression completeness; the additive documentation change and union-scope implementation appear sound by inspection. Re-review the exact changed head after the canonical/isolated coverage is added.

## Authentic report: auth-directory-security-scope-regression-author-luna.md

# Author evidence — #816 canonical nested-auth regression

**Author model:** GPT-6 Luna
**Source:** `2f8681dc3d7184f62f9c8ea2a908adc67e996910` on `codex/auth-directory-security-scope`
**Prior candidate:** `65c8cc93a952c672281ea2a7b12e5e48a5369905`
**Base:** `b78fd6853a890c6e2b10d17be18885e3b1612b2d`

This test-only delta addresses the independent ordinary review finding. The canonical parsed-scope test now requires both `apps/api/src/auth/repository.ts` and `apps/api/src/auth/step-up-service.ts`, checks that the retained `apps/api/src/auth.ts` remains covered, and verifies through a read-only counterfactual parse that removing the canonical `apps/api/src/auth/**` token loses nested coverage. The existing shrink probe now also runs the real checker against the repository's canonical `ci-cd.md` with only those two nested auth source paths changed; the checker rejects a body missing security-review evidence. The existing synthetic union shrink scenario remains in place.

## Verification

- `node --test scripts/ci/probes/security-scope-shrink.test.mjs scripts/ci/lib/security-paths.test.mjs` — 14 passed, 0 failed, 0 skipped. Full log: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/auth-directory-security-scope-regression-testlog.log`.
- `node --check scripts/ci/lib/security-paths.test.mjs` and `node --check scripts/ci/probes/security-scope-shrink.test.mjs` — passed.
- `git diff --check` — passed before commit; `git diff HEAD^ --check` — passed after commit.

No full CI, image, database, browser, product build, compile, or broad test run was performed. The earlier independent report and original author artifacts were left unchanged.

## Authentic report: auth-directory-security-scope-2f86-ordinary-luna.md

# Independent ordinary delta review — #816 auth directory security-review scope

**Reviewer:** GPT-6 Luna, same fresh reviewer context as the prior review; this is a delta review, not a new independent context. I authored neither the candidate nor its remediation.
**Exact candidate SHA:** `2f8681dc3d7184f62f9c8ea2a908adc67e996910`
**Prior reviewed SHA:** `65c8cc93a952c672281ea2a7b12e5e48a5369905`
**Base SHA:** `b78fd6853a890c6e2b10d17be18885e3b1612b2d`
**Verdict:** APPROVE DELTA — prior blocking regression-coverage finding is closed; no new blocking findings in the delta. This is not a new full ordinary-review panel or a security review.

## Review scope and provenance

I inspected the exact two-file delta from `65c8cc93a952c672281ea2a7b12e5e48a5369905` to `2f8681dc3d7184f62f9c8ea2a908adc67e996910`: `scripts/ci/lib/security-paths.test.mjs` and `scripts/ci/probes/security-scope-shrink.test.mjs`. I also read the author’s retained report and exact focused-test log. I did not run tests, probes, or other runtime checks, per assignment. The worktree was clean at the reviewed head; I made no source edits. My original report for the earlier candidate remains unchanged.

## Finding disposition

The prior finding required the regression to protect the canonical `ci-cd.md` declaration and demonstrate that a nested-auth-only diff reaches the actual checker. Both are now covered.

The canonical unit test obtains `ciCdPath`, parses the actual document through `readSecurityReviewPaths`, and asserts coverage of both `apps/api/src/auth/repository.ts` and `apps/api/src/auth/step-up-service.ts`, while retaining coverage for `apps/api/src/auth.ts`. Its read-only counterfactual removes the adjacent canonical `auth/**` token, reparses the result, and asserts that both nested paths lose coverage. The `assert.notEqual` makes a change to the declaration layout fail visibly instead of silently skipping the counterfactual.

The new scratch scenario installs the canonical `ci-cd.md` and its baseline, then changes only those two nested auth source paths. It verifies the exact changed-path set, verifies the real union matcher covers the two nested paths and the auth root file, and runs the shipped PR-template checker with a complete body lacking security-review evidence. It requires the checker to report the security-review section failure and not report that no scope path was touched. The changed files are ordinary `.ts` modules without a Hono router declaration, so the checker’s route fallback does not explain the rejection. This isolates the canonical auth-directory glob’s effect. The earlier synthetic same-diff narrowing case remains, preserving the merge-base/HEAD union regression.

I found no new blocking issue in these two test changes. The synthetic fixture remains in the separate union-shrink test, where it serves its stated scenario; the new isolated case is specifically bound to the canonical document.

## Author-provided verification and limits

The author’s retained focused log reports **14 passed, 0 failed, 0 skipped** for `node --test scripts/ci/probes/security-scope-shrink.test.mjs scripts/ci/lib/security-paths.test.mjs`; syntax checks and diff checks also reportedly passed. I inspected the log but did not rerun those commands. No full CI, image, database, browser, product build, compile, or broad test run is claimed by this review. The original full candidate’s author evidence and this review cover the pre-composition branch state; the later composition onto accepted #815/main must receive its own exact-head review and current acceptance checks.

## Authentic report: auth-directory-security-scope-2f86-security-61-sol.md

# Independent full security review — #816 auth directory security-review scope

**Model:** GPT-6.1 Sol
**Role:** fresh independent full Sol-tier security reviewer.
**Context:** `/root/auth_directory_security_scope_2f86_security_sol`; dispatcher reports explicit spawn selection `model=gpt-6.1-sol`, `reasoning_effort=high`, `fork_turns=none`. The platform exposes no backend fingerprint in this context; that selection is provenance, not a separate backend attestation.
**Reviewed head:** 2f8681dc3d7184f62f9c8ea2a908adc67e996910
**Comparison base:** b78fd6853a890c6e2b10d17be18885e3b1612b2d
**Verdict:** APPROVE — no blocking or non-blocking security findings in the complete bounded three-file candidate.

I did not author, direct, or remediate the candidate or its regression repair. This is a full review of the narrow CI/security-gate fix, performed after the strong ordinary review's blocking regression finding was independently closed at this exact head. It is not a lightweight confirmation, an ordinary panel, a merge authorization, or acceptance of a future composition.

## Scope and independently checked invariants

I read the complete diff against the base, all three affected files, the production scope parser/matcher and union reader, the checker security-review branch, the scratch-repository harness and complete-body fixture, the governing AGENTS/workflow/CLAUDE/CI policy, issue #816, both ordinary review reports, both author reports, and the retained focused-test log. The worktree was clean at the reviewed SHA. Live `git ls-remote` independently confirmed that both the candidate branch and accepted `main` still pointed at the named candidate and base during this review. No PR yet existed for this branch in the live branch-filtered query.

1. **The declaration closes the actual nested-auth gap without removing old scope.** `docs/04-engineering/ci-cd.md:318` adds only `apps/api/src/auth/**`. The existing `apps/api/src/auth*` remains; `apps/api/src/index.ts` moves to its own parser-safe line. Inspection of the authoritative block and its tokenizer gives 44 globs, consisting of the previous 43 plus the directory glob. The matcher translates single `*` to `[^/]*` and terminal `**` to `.*`, anchored to the whole path. Thus root `auth.ts` remains covered and actual nested `auth/repository.ts`, `auth/step-up-service.ts`, and deeper descendants gain coverage. I independently listed the repository's auth files and confirmed both named regression targets really exist. No application, policy, dependency, or other prior control path is dropped.

2. **The canonical regression now fails when the authoritative fix disappears.** `scripts/ci/lib/security-paths.test.mjs:73` adds both nested real paths to mandatory representatives; its retained-glob assertion also requires the new directory glob. The new test at line 148 reads the actual canonical document and uses the production reader/parser/matcher. Its counterfactual removes the canonical directory token, requires that the source changed, and requires both nested files to lose coverage while the canonical document covers them. `auth.ts` coverage is explicitly retained. Formatting drift causes an assertion failure rather than silently skipping the counterfactual. This directly addresses the prior synthetic-fixture blind spot.

3. **The real checker rejection isolates nested-auth-only scope.** `scripts/ci/probes/security-scope-shrink.test.mjs:140` installs the actual checker sources, actual canonical scope, template and decision log before recording its synthetic base. Its candidate then changes only the two nested auth files; the exact sorted changed-path assertion excludes ci-cd, CI machinery, and other independently protected paths. The source strings are simple exports with neither Hono nor apiRouter declarations, so route fallback cannot explain the security requirement. The fixture has the security section/model but deliberately lacks its committed review note. The test requires exit 1, a security-review diagnostic, and absence of the no-security-path warning. This meaningfully tests missing review evidence through the shipped checker, rather than relying on a parser assertion alone.

4. **Same-diff narrowing cannot erase the merge-base protection.** The distinct test at line 190 removes only `auth/**` from a synthetic HEAD declaration while changing a nested auth source. It explicitly requires current nested coverage false, previous coverage true, union coverage true, root-auth coverage true, and the exact removed-glob list. Although ci-cd itself is also a protected change in that scenario, those independent predicate assertions demonstrate union retention; the separate canonical auth-only scenario supplies isolated end-to-end enforcement. Production `readSecurityReviewScope` still unions baseline/current lists, flags removed globs, and fails closed for unavailable or unparseable baseline scope. The matcher and union implementation are unchanged by the candidate.

5. **No reviewer-tier, note-binding, waiver, or gate-authority weakening.** The only executable gate input changed is the additive path declaration. The diff does not change accepted review models, baseline model selection, security-note SHA binding, PR-head agreement, evidence reuse, waiver verification, required-check applicability, workflow authority, or branch protection. The existing checker still requires a permitted model and committed current-head review note when the scope matches. This review neither upgrades a historical test or review to a later head nor treats the earlier #815 automated scope gap as evidence that #815 lacked its separately recorded reviews.

## Ordinary finding disposition

The original ordinary report on `65c8cc93a952c672281ea2a7b12e5e48a5369905` requested changes for missing canonical/isolated regression coverage. Its same independent review context subsequently approved the two-file regression delta at `2f8681dc3d7184f62f9c8ea2a908adc67e996910`, explicitly closing that finding. I independently verified the repaired assertions and harness path in the source as described above. No unresolved finding from those reports remains in this candidate's bounded scope.

## Commands, retained verification, and limits

I ran read-only Git/source/evidence commands only: `pwd`, `git status --short` / `--porcelain=v1`, `git rev-parse HEAD`, complete `git diff --stat` / `--name-status` / `--numstat` / `--no-ext-diff` comparisons against the named base, `git log -3 --format=fuller`, `git for-each-ref`, `git ls-remote origin` for the two exact branches, `rg` / `rg --files`, `cat`, `sed`, and `nl`. Read-only GitHub queries were `gh pr list --state open`, `gh issue view 816`, and the exact branch's all-state `gh pr list` query. No source edit or GitHub mutation was made.

The retained author log `auth-directory-security-scope-regression-testlog.log` reports **14 tests in 2 suites: 14 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo**, including the canonical dependency test, isolated real-checker rejection, and union-narrowing case. The author report binds that log to this reviewed head and separately reports syntax/diff checks passed. I inspected the full log and its source-bound report; I did not rerun or independently reproduce those tests. The earlier ordinary review's 12-test execution belongs only to its earlier head and is not promoted to this one.

Per the conductor's shared-runtime restriction, I ran no tests, probes, parser execution, native API, compiler, analyzer, PostgreSQL, Docker, browser, build, or CI. This source security verdict plus inspected author evidence does not claim current required CI, deployability, runtime/SIT acceptance, phase closure, or a signed release. Any later composition onto accepted #815/main changes the candidate and needs the applicable exact-head composition review and fresh required checks before acceptance. Future publication of this authentic report must preserve its provenance and verdict under the repository's review-record rules.
