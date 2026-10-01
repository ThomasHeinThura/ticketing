# PR #531 — independent full GPT-6 Sol security review

**Reviewed head:** `fe278d571463b4ff698d7c3b9679a38a8c97f49b`
**Base:** `c891e9bcd4abf9b77b4916561d9bc5ca367065e5`
**Reviewer:** fresh GPT-6 Sol context. I did not author, direct, or remediate this candidate. This is the per-PR security review, not the P0 phase finalizer.
**Verdict:** **CLEAR for the reviewed code; no blocking security finding.** This does not authorize merge while the PR-template/security-review check is red or any other required gate is unresolved.

## Scope and inspection

I reviewed the complete seven-path base-to-head change: `apps/api/package.json`, `apps/api/tsconfig.rls-prototype.json`, `apps/api/vitest.rls-prototype.config.ts`, `tests/rls-prototype/README.md`, `tests/rls-prototype/global-setup.ts`, `tests/rls-prototype/rls-prototype.test.ts`, and `docs/07-planning/rls-prototype-results.md`. I read the multi-tenancy specification and the authoritative CI security-scope list. I also traced the app's `createApp`, auth-session helper, work-item list controller, and current route comparison through the test. Both fresh independent Luna ordinary reviews were CLEAR at this exact head; I inspected their evidence but made my own assessment and reran the focused experiment.

This candidate changes a test-only RLS prototype and includes the dedicated TypeScript project in the normal API typecheck. It adds no production RLS policy, migration, API route, runtime connection wrapper, role grant, or authentication behavior. The Vitest config and `apps/api/package.json` are security-scope paths, so the full Sol pass is appropriate even though the policy SQL runs only in the disposable database.

## Tests and evidence actually checked

- `pnpm --filter @taskdesk/api exec vitest run --silent=false --reporter=verbose --config vitest.rls-prototype.config.ts` on this exact head: **1 test file, 1 test passed**. It started its own PostgreSQL 18 Testcontainer, migrated it, seeded 1,200 work items, 1,201 comments, and 1,202 attachments, and exited successfully.
- `pnpm --filter @taskdesk/api typecheck`: **passed**; its command includes `tsconfig.rls-prototype.json` after the API, permissions, and normal tests configs.
- `git diff --check` reported only the intentional Markdown hard-line-break spaces in the report's run-date line. The worktree remained clean.
- `gh pr checks 531` at this review's read-only snapshot: hosted integration - Postgres 18, unit + component, gate checkers + red probes, build, static, route-policy/permission matrix, and the other completed checks were green. `pull request template + security review` was **red**; `NOT ENABLED - performance budgets (G11)` was reported skipped. Exact-head checks and PR metadata still need orchestration before merge.
- I did not run the full local `pnpm test` suite. The candidate's prior local run and root's clean-main reproduction recorded eight host-local baseline failures (four API storage path and four web localStorage tests); the exact-head hosted unit and integration checks above passed. I did not call those local failures green or waive them.

## Security assessment

**Database and host isolation.** The dedicated global setup creates a fresh `postgres:18-alpine` Testcontainer and supplies its connection URI. The test creates the owner pool from that URI. Before dynamically importing the API/auth/database modules, it rewrites the application URL to that same container with the disposable `taskdesk_rls_probe` credentials; the test asserts the app pool's `current_user` and `current_database()` are `taskdesk_rls_probe` and `taskdesk_rls_prototype`. The owner operations that create roles, apply migrations, insert fixture rows, toggle RLS, and temporarily bypass FK triggers target the owner pool in that disposable database. The FK bypass is `SET LOCAL` inside one transaction. The probe and baseline credentials have read-only table grants; the app probe role is non-owner, non-superuser, and `NOBYPASSRLS`. Pools are closed and the prior app URL/auth-secret environment values restored in teardown. The global setup stops the container. No developer/UAT/production URL is used on this supported test path.

**Tenant boundary.** The policies derive tenant organisation from `workspace.organisation_id`, not the attachment's denormalized organisation column. The comment policy also checks that its work-item parent shares the comment workspace. The attachment policy checks work-item/comment parent workspace and fails closed for `submission_id` parents, which this prototype explicitly leaves out. Unset and empty GUC scopes return zero work items; a single reused backend loses scope after both commit and rollback. The test also proves a SQL-capable holder of the probe role can set the GUC to a different tenant and see those rows. The report therefore correctly treats RLS as a backstop requiring trusted application scope derivation, not an independent identity boundary.

**Actual application comparison.** The test uses `createApp().app.request` with the repository's session mock and real seeded staff persons/workspace memberships while prototype RLS is disabled for those baseline requests. It pages every work-item route response: the customer-A workspace staff actor's 600 actual IDs match the 600 RLS A-scope IDs, and the explicit internal/A/B staff actor's 1,200 actual IDs match the multi-organisation RLS set. One item in each of four projects exercises actual activity and attachment routes. Attachment samples agree. The activity route returns one deliberately malformed comment that the RLS parent-workspace policy rejects. The test and report expose that disagreement; ordinary composite FK enforcement prevents insertion of the invalid row. The fixture is limited to internal staff actors, does not exercise a customer principal or project-level `sees_all`, and does not claim a production wrapper or real PgBouncer behavior.

**Measurement interpretation.** Direct-SQL timing queries are separate from the app-route comparison. They use alternating warmed 40-pair samples and `EXPLAIN`; the committed numbers are explicitly one small local sample, not a production forecast. The baseline role has `BYPASSRLS` and the probe role is `NOBYPASSRLS`, both non-owner/non-superuser. No adoption decision is smuggled into the report.

## Findings and remaining limits

- **Blocking security findings:** none.
- **Non-blocking documentation accuracy:** the emitted `measurementLimits` string says `1,202 work items total`; the fixture and report correctly show **1,200 work items** and **1,202 attachments**. Correct this on a future evidence refresh or if another candidate change already moves the head. It does not alter the measured rows, access checks, or the written report's fixture count.
- **Residual adoption work:** test a real PgBouncer/transaction wrapper and trusted GUC binding, make an explicit role/permission design, assess realistic distributions and submission attachments, and reconcile attachment organisation attribution before any production RLS rollout. These are correctly outside this test-only PR and are not waivers.
- **Process gate:** update the PR's review metadata with the exact-head independent reviews and full Sol security evidence, then rerun the red template/security-review check. Recheck all required contexts on the exact SHA. This review alone is not a phase finalizer and does not clear the red check.

No source edits, commit, push, or merge were made by this reviewer.

## Ordinary review record

Two independent GPT-6 Luna contexts cleared the same source head `fe278d571463b4ff698d7c3b9679a38a8c97f49b`: `/root/p0_531_luna_evidence1` and `/root/p0_531_luna_evidence2`. Both independently reran the disposable PostgreSQL 18 RLS suite (1 file/1 test) and API typecheck; the first also reran full workspace typecheck (9/9). Reports are recorded in PR comments 5924805913 and 5924825303. Neither reviewer authored or remediated the candidate. This follow-on commit only records review evidence.


## Main branding/storage integration

# PR #531 main-integration delta review

- **Reviewer:** GPT-6 Luna, fresh independent context; did not author, direct, or remediate the candidate.
- **Exact candidate:** `dfd9f219759787af0b6d2db0f6d20d4ef03f8f07`; GitHub head matches.
- **Previously reviewed source:** `fe278d571463b4ff698d7c3b9679a38a8c97f49b` (two recorded ordinary reviews; both CLEAR with documented limits).
- **Base:** `main` / `cefaec8bc6c37eb6ecd938153de06d290c60c5f2`.
- **Verdict:** **CLEAR for the main-integration delta.**

## Evidence inspected

The candidate merges current main (`cefaec8`) into the reviewed branch and adds the already recorded exact-head security review note commits. `git diff --quiet fe278d5..dfd9f21` over the RLS prototype implementation, dedicated Vitest/typecheck configuration, README and results report returned 0: the reviewed prototype source is unchanged. The integrated main delta consists of #532 branding assets/baseline and #533 canonical filesystem-root code/tests/review notes; it has no path overlap with the RLS prototype. Merge base with current main is exactly `cefaec8`; PR files/head were confirmed on GitHub.

The two prior reviews cover the unchanged prototype, including the real Hono/Postgres Testcontainer reproduction and typechecks. They recorded the bounded actor/sampling limitations and a host-specific local `test:ci-scripts` failure; those observations remain as recorded, not rerun or waived here. **No tests were run for this integration delta** because no prototype source changed and the orchestrator's G11 diagnostic quiet window is active. Hosted integration remains in progress. PR-template/security-review is currently failing; the required security review/status gates remain separate from this ordinary delta verdict.

No code findings in the integration delta. This is not a merge-readiness determination.

# PR #531 — independent GPT-6 Sol security review of main integration

- **Exact candidate:** `dfd9f219759787af0b6d2db0f6d20d4ef03f8f07`.
- **Comparison base:** `cefaec8bc6c37eb6ecd938153de06d290c60c5f2` (the candidate's second parent and current PR base at review time).
- **Earlier fully reviewed source:** `fe278d571463b4ff698d7c3b9679a38a8c97f49b`; two independent GPT-6 Luna ordinary reviews and a full independent GPT-6 Sol security review were recorded for that source.
- **Reviewer:** fresh independent GPT-6 Sol context. I did not author, direct, or remediate either candidate. This is a per-PR exact-head delta confirmation, not a P0 phase finalizer.
- **Verdict:** **CLEAR for this exact main-integration delta.** No blocking or non-blocking security finding in the integration. This does not clear a red required check or authorize merge by itself.

## Inspection and composition

I checked the GitHub PR head, files and check snapshot; both parents of the merge commit; the first-parent delta from `57dd75b0` (branch review-note head) to this merge; the second-parent net diff from `cefaec8` to this candidate; the prior full Sol and two Luna reports; the fresh ordinary main-delta review; the CI security-scope list; and the RLS prototype's application-read and policy test surfaces. The branch-only commits after the full Sol source review (`4cd994f`, `57dd75b`) add and correct its review note; the merge commit imports `main` without modifying reviewed prototype source. `git diff --quiet fe278d5 dfd9f21 --` over all seven originally reviewed prototype/config/report paths returned **0**. The candidate-to-main net diff consists of those original paths plus the security-review note; no main storage or branding implementation change is reintroduced as a PR change.

The integrated main changes are #532 branding assets and visual baseline, and #535 filesystem-root canonicalization plus its storage test/review notes. The latter resolves the configured storage root with `fsp.realpath` before object path and containment checks. The RLS prototype imports and exercises application work-item/activity/attachment-list reads and isolated PostgreSQL policy SQL; it does not change production storage, and main's filesystem change does not alter its database role, GUC, policy, tenant fixture, or authentication setup. I found no cross-change path or authority conflict. This is an independent composition check, not a replacement for the original full Sol review.

## Verification and limits

No local tests or builds were run in this delta pass, honoring the orchestrator's active G11 diagnostic quiet window. The earlier full Sol pass ran the isolated RLS Vitest test (**1 file/1 passed**) and API typecheck; the earlier Luna reports contain their own recorded runs and limitations. At this review's GitHub snapshot, the exact-head integration, unit/component, build, route-policy, G8 and other completed checks were green; **pull request template + security review was red** and G11 was listed as not enabled. I did not waive either. The original prototype's bounded actor/sampling coverage and lack of production RLS policy remain the original residuals. Any later head or base change needs a new exact-head review decision.


## Post-#537 JSDOM test integration

# PR #531 post-#537 main integration delta

- **Reviewer:** GPT-6 Luna, fresh independent context; did not author, direct, or remediate this candidate.
- **Current exact candidate:** `77793a70c59fd8a319d85e69c11a9869d2d1a47d` (GitHub head confirmed).
- **Previously reviewed candidate:** `dfd9f219759787af0b6d2db0f6d20d4ef03f8f07`.
- **Current main/base:** `5d8024cfeaec4f4448665b4e9fce9eb5e1ba2113`; current candidate merge-base equals this SHA.
- **Verdict:** **CLEAR for the post-#537 integration delta.**

## Evidence

The first-parent history shows `77793a70` merges current main. Comparing old to current candidate produces exactly the three files from merged PR #537: `apps/web/src/test/setup.ts`, `apps/web/src/test/jsdom-local-storage.ts`, and `apps/web/src/test/jsdom-local-storage.test.ts`. Comparing the RLS PR's eight source/report paths between `dfd9f21` and `77793a7` with `git diff --quiet` returned 0: all previously reviewed RLS prototype content is byte-identical. The main-relative candidate diff still contains only the eight PR #531 paths. No overlapping files or merge-resolution changes were introduced.

No tests were run for this source-identical main import. The previous ordinary review reproductions and their documented limits remain tied to unchanged source; this delta review does not claim those checks were rerun or change any outstanding hosted/security gate. No code findings in the delta; not a merge-readiness determination.

# PR #531 — independent GPT-6 Sol security review of post-#537 main integration

**Reviewed head:** `77793a70c59fd8a319d85e69c11a9869d2d1a47d`
**Current main/base:** `5d8024cfeaec4f4448665b4e9fce9eb5e1ba2113`
**Prior fully reviewed candidate:** `dfd9f219759787af0b6d2db0f6d20d4ef03f8f07`
**Reviewer:** fresh independent GPT-6 Sol context; I did not author, direct, or remediate the candidate. This is a per-PR exact-head integration confirmation, not the P0 phase finalizer.
**Verdict:** **CLEAR for the post-#537 integration delta.** No blocking or non-blocking security finding in this delta. This is not a merge-readiness verdict.

## Evidence and security composition

I checked the live GitHub head/base/files/check snapshot, the merge commit's two parents, the old-to-new first-parent diff, the current-main-to-head net diff, the fresh independent Luna delta report, and the previously recorded full Luna/Sol reviews. The second parent and merge base are exactly current main. The first-parent delta imports only #537's three `apps/web/src/test/` files: `setup.ts`, `jsdom-local-storage.ts`, and `jsdom-local-storage.test.ts`. The main-relative net diff still comprises only the eight PR #531 paths. `git diff --quiet dfd9f21 77793a7 --` over all eight PR paths returned 0, confirming byte-identical reviewed candidate content and no merge resolution in it.

I inspected all three imported files. They install JSDOM's browser `localStorage` into the web Vitest test window and test that behavior under a shadowing host global. They change neither production web code nor the API's RLS prototype runner. The RLS prototype config uses `environment: "node"` and its own global setup; it does not load `apps/web/src/test/setup.ts`. They do not alter the RLS policy SQL, tenant fixtures, application-read comparisons, API package/typecheck configuration, auth, storage or route authority. The security conclusions of the earlier full Sol review and the previous main-integration Sol review remain applicable to unchanged source; I independently checked the new composition rather than treating those reports as a substitute for this exact-head assessment.

## Tests and residuals

**No local tests or builds were run for this source-identical integration delta.** Earlier focused RLS and typecheck runs remain recorded in the prior full Sol review; I do not claim to have rerun them. At my GitHub snapshot, integration was still in progress and `pull request template + security review` was red; other completed required checks shown were green, while G11 was reported not enabled. All required gates remain the orchestrator's responsibility. The original prototype's limited actor/sampling scope and lack of production RLS enforcement remain unchanged residuals. A later head or base change requires a fresh exact-head decision.


# PR #531 exact-head main-import confirmation

- **Reviewer:** independent GPT-6 Luna context; I did not author, direct, or remediate the RLS prototype.
- **Exact candidate:** `869ac469e91a64d220a825ee4cc37927002aec2e`.
- **First parent:** `dc8fc213a847de2ad9898c8eda182e146e5296bf` (prior reviewed candidate `77793a70c59fd8a319d85e69c11a9869d2d1a47d`).
- **Second parent/base:** `bb881f5e622b7a165b4cbeaa961379ade0bf2078` (current main supplied by orchestration; the merge commit's second parent).
- **Verdict:** **CLEAR for the #538 main-import delta only.** No finding in the imported probes or their interaction with the unchanged RLS prototype. This is not a full RLS re-review or merge-readiness decision.

## Actual changes inspected

`git show --raw --format=fuller HEAD` confirms a two-parent merge commit with the parents above. The complete first-parent diff contains exactly three paths:

1. `scripts/ci/probes/repo-root-cwd.test.mjs`: canonicalizes expected repository roots with `realpathSync`; adds a symlink-parent caller-root case and adjusts expected canonical paths.
2. `scripts/ci/probes/test-contract-root.test.mjs`: canonicalizes the expected caller root and script-root comparison for the approved-breaks path.
3. `docs/07-planning/security-reviews/538-canonical-probe-roots.md`: records #538 review evidence.

I inspected the complete diffs and the imported review note. These are CI probe test changes; they exercise canonical caller-root resolution, symlink aliases, and the approved-breaks path. They do not modify checker implementation, allowlist contents, exception policy, or thresholds.

The candidate-to-main net diff is exactly the eight PR #531 paths: `apps/api/package.json`, the dedicated RLS Vitest and TypeScript configs, the RLS results and review documents, and the three `tests/rls-prototype` files. No #538 probe file is in that net diff.

## RLS identity and interaction

`git diff --quiet fe278d571463b4ff698d7c3b9679a38a8c97f49b HEAD -- <seven RLS source/config/result paths>` returned 0. The same comparison from `77793a70c59fd8a319d85e69c11a9869d2d1a47d` returned 0. The seven paths were the API package script/typecheck entry, dedicated Vitest config, dedicated TypeScript config, results report, and the three prototype test/support files. The review note itself is naturally excluded from source identity. Thus the imported main delta does not change reviewed RLS source bytes.

I inspected the dedicated Vitest configuration: it uses Node, explicitly includes only `../../tests/rls-prototype/**/*.test.ts`, has its own global setup, serializes execution, and disables coverage. The imported `scripts/ci/probes/*.test.mjs` files are outside that include and use Node's `node:test` APIs. The API typecheck change is unchanged from the reviewed source. Root `pnpm test:contract` invokes `scripts/ci/test-contract.mjs`; the imported probe files are separate security probes, and do not alter that checker or its allowlist. Search results show no RLS references in the root CI checker/probe system and no root-checker wiring of the dedicated RLS Vitest config.

The prior committed #531 evidence records two independent ordinary reviews and the full Sol security review of source head `fe278d5`, plus prior exact-head integration reviews through `77793a7`. This pass checked the new exact-head composition rather than treating those records as a substitute.

## Execution and gates

**No tests or builds were run for this source-identical import delta.** The byte-identity and path/config inspection show no interaction that would make rerunning the dedicated RLS suite informative for this delta; I make no new execution claim. The previous review note's recorded test results remain attributed to those prior reviewers. This report does not update GitHub review metadata, clear CI checks, or claim that required gates are green.

No source changes were made. The worktree remained clean at inspection.


# PR #531 — independent GPT-6 Sol security confirmation of #538 main import

**Reviewed head:** `869ac469e91a64d220a825ee4cc37927002aec2e`
**Current main/base:** `bb881f5e622b7a165b4cbeaa961379ade0bf2078`
**Reviewer and independence:** Fresh independent GPT-6 Sol context. I did not author, direct, or remediate this candidate or the imported #538 work. This is an exact-head per-PR integration confirmation, not a P0 phase finalizer.
**Verdict:** **CLEAR for the #538 main-import delta.** No blocking or non-blocking security finding in its composition with the unchanged RLS prototype. This is not a merge-readiness verdict.

## Exact history and composition

I verified GitHub's exact PR head/base and files, and inspected the complete commit path and both parents of the current merge. First parent `dc8fc213a847de2ad9898c8eda182e146e5296bf` is the PR #531 branch after a review-note-only commit on previously reviewed `77793a70c59fd8a319d85e69c11a9869d2d1a47d`; second parent is current main `bb881f5e622b7a165b4cbeaa961379ade0bf2078`, also the merge base. The first-parent import is exactly three paths: `scripts/ci/probes/repo-root-cwd.test.mjs`, `scripts/ci/probes/test-contract-root.test.mjs`, and `docs/07-planning/security-reviews/538-canonical-probe-roots.md`. The extra branch-only change since `77793a7` is to PR #531's review note, not the RLS source. The current-main-to-head net diff remains exactly the eight PR #531 paths; no #538 probe is reintroduced by this PR.

I inspected the imported probe diff and the fresh independent Luna delta report. The probes canonicalize expected temporary checkout roots with `realpathSync` and add a real symlink-parent caller-root case. They still demand that `repoRoot` and the approved-breaks path follow the caller checkout, not the script checkout. They alter no checker implementation, allowlist, route/permission policy, exception, or threshold. The probe files are in the repository's security-review scope and received their own full per-PR reviews before #538 merged; this pass independently checks their composition with #531.

`git diff --quiet fe278d571463b4ff698d7c3b9679a38a8c97f49b 869ac469e91a64d220a825ee4cc37927002aec2e --` across all seven original RLS source/config/results/support paths returned 0. The same comparison from `77793a7` across those paths returned 0. The API package typecheck entry, dedicated TypeScript/Vitest configs, PostgreSQL setup, prototype SQL, application-read comparisons and report are byte-identical to the earlier fully reviewed source. The dedicated Vitest config uses `environment: "node"`, includes only `tests/rls-prototype/**/*.test.ts`, has its own global setup, and runs one worker; it cannot discover the imported `.mjs` CI probes. The root `test:ci-scripts` command runs those probes separately, while `test:contract` calls unchanged checker implementation. I found no new RLS policy, tenant, credential, test-runner or gate interaction from this import.

## Verification and limits

**No local tests or builds were run in this bounded delta pass.** Source identity, disjoint paths and explicit runner includes make a redundant full RLS rerun unnecessary for assessing the import. The prior full security review recorded its own focused RLS test and API typecheck; those are prior evidence, not this reviewer's executions. Root separately reports an API package image build and isolated boot/live/ready HTTP 200 for `dc8fc213` source; I did not run or independently verify those operations here, and the newly imported probes do not ship in that image.

`git diff --check` on the current base-to-head diff reports only the pre-existing intentional Markdown hard-line-break whitespace in the RLS results report. At my GitHub snapshot for this exact head, `pull request template + security review` and G8 were red; integration, gate probes and unit/component were in progress; other completed checks shown were green, and G11 was listed as not enabled. These remain separate required gates. The prototype's prior bounded actor/sampling coverage and absence of production RLS enforcement remain its documented limitations. A later head/base change needs a fresh exact-head decision.

## Shipping package image verification

Root built `taskdesk:pr531-dc8f` from reviewed source plus recorded notes at `dc8fc213a847de2ad9898c8eda182e146e5296bf`; image ID `sha256:e5ca1d9e38298601fa78a167f4fa3d387ee4af3745d2db43ed411584f95f09ba`. The API package manifest is copied into the runtime image, so this build/boot evidence is required even though the added RLS runner is test-only. The disposable PostgreSQL 18/Valkey fixture booted healthy at loopback port 5532; `/api/public/health/live` and `/api/public/health/ready` both returned HTTP 200 with `status: ok`. Logs are `/private/tmp/pr531-dc8f-docker-build.log` and `/private/tmp/pr531-dc8f-smoke-boot.log`. The later main import contains only the independently reviewed CI probes and their note; it changes no shipping source. No production RLS adoption or phase completion is claimed.
