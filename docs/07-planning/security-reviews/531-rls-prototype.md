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
