# Security review — seed CI coverage (#546)

**Reviewed head:** `aa1c1f7fef120b6ba48f5cc86896254f6a4e6c55`

**Reviewer:** fresh independent GPT-6 Sol context `/root/seed546_sol_security`.
**Verdict:** PASS; no blocking or non-blocking code findings.
**Published report:** https://github.com/ThomasHeinThura/ticketing/pull/546#issuecomment-5927849327

## Ordinary clearance and attribution

Strong independent GPT-6 Luna context `/root/seed546_luna_review` cleared the same exact source before this Sol pass: https://github.com/ThomasHeinThura/ticketing/pull/546#issuecomment-5927820645. It independently ran 53 focused tests across five files. The Sol reviewer independently ran 47 PostgreSQL tests across four files. These are distinct executions.

Root compiles this artefact from actual reviewer evidence; root is not an independent reviewer. The following report retains its point-in-time pending/red checks. A later note-only commit records this verdict, not stage completion or a gate waiver. All exact-final-candidate required checks and expected suite counts remain merge requirements.

## Full independent Sol report

# PR #546 — independent GPT-6 Sol security review

- **Candidate:** `aa1c1f7fef120b6ba48f5cc86896254f6a4e6c55`
- **Base:** `b311c8cc6ba65906812eeafbf5783d2632dfee53`
- **Independence:** Fresh GPT-6 Sol reviewer context. I did not author, direct, or remediate this candidate. The strong ordinary Luna review was complete before this pass.
- **Risk:** Bounded CI pass/fail coverage change. `apps/api/vitest.config.ts`, `apps/api/vitest.integration.config.ts`, and `docs/04-engineering/ci-cd.md` are in the mandatory security review scope. No production runtime, auth, permission, route, schema, migration, seed implementation, or workflow changed.

## Verdict

**Security review passes for the exact candidate; no blocking or non-blocking code findings.** This is a source/security verdict, not merge approval. The exact-head `pull request template + security review` required check is red and hosted PostgreSQL integration was still in progress when I checked; both remain merge gates.

## What I checked

I reviewed the complete eight-file diff and the canonical CI/testing strategy, seed contract, integration Testcontainers setup, shared database reset guard, seed runner, and ordinary review evidence. The two Vitest config additions make the existing 6 CLI preflight tests discoverable in the fast API suite and the existing 12 seed PostgreSQL tests discoverable in the serial canonical integration suite. No include pattern was removed, no test was skipped or focused, and no timeout or expected assertion was relaxed. Hosted exact-head `unit + component` is already green and its API log shows 67 files/536 tests including `scripts/seed-cli.test.ts` (6 tests); the root independently extracted 12/12 Turbo tasks, including web 80 files/351 tests. The earlier local full-unit ntfy SSRF timeout is not silently reclassified as a pass; hosted CI supplies the exact-head full run.

The seed PostgreSQL file now calls the shared `resetTestDatabase()` before inserting its fixed preservation fixture and again after the suite, and no longer ends the shared pool. The integration runner is serial (`fileParallelism: false`, one worker). In CI, global setup starts PostgreSQL 18 in a Testcontainer before worker setup exports the connection URL; worker setup and `ensureTestDatabaseExists()` reject a database name without `_test` before migration or reset. The reset uses catalog-listed tables and a transaction-scoped replication-role change, then truncates all public tables. This change does not weaken those guards or route the tests to a development/production database. It does not change seed implementation or grant a login, membership, or role.

The shared soft-delete race helper now clears PostgreSQL's transaction-cached statistics snapshot before each `pg_stat_activity` poll; its owner-PID blocker requirement, 5-second deadline, and operation-settled stop remain. The #493 test deliberately records an initial false snapshot, then requires a real blocked `FOR SHARE` check before committing the delete, and still asserts 404 and no event, row/version, or activity side effect. The #295 tests replace timing sleeps with observation of the exact T1 waiting PID and T2 blocking PID. The raw case now waits until T2 holds the root lock before T1's reparent, retains the PostgreSQL `40P01` predicate, and adds diagnostic error text only. The retry case still requires both writers to succeed, a real retry, both committed parents, and exactly one key claim. These changes strengthen evidence of actual contention rather than accepting a false-green interleaving.

## Checks run by this reviewer

- `git diff --check` on base..candidate: passed.
- `CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts scripts/seed-postgres.test.ts ../../tests/api-integration/work-item-update.test.ts ../../tests/api-integration/work-item-parent-write-deadlock-retry.test.ts`: **3 files, 39 tests passed** on a disposable PostgreSQL 18 Testcontainer.
- `CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/work-item-delete.test.ts`: **1 file, 8 tests passed** on a disposable PostgreSQL 18 Testcontainer. This is a consumer of the changed shared lock helper.
- Inspected live PR exact head/base and required check rollup. `unit + component`, `static`, gate probes, and other completed checks were green; `integration - Postgres 18` remained in progress at the last check. I did not run or claim the full suite locally. The author reports its 126 files/1,579 tests passed before the final type-only PID helper edit, with focused affected tests after that edit; hosted exact-head integration remains authoritative.

## Outstanding gates, separate from code findings

The exact-head `pull request template + security review` check fails with 19 reported problems: the PR body names the Sol review as pending, lacks a committed security-review note link, uses descriptive text in gate cells that the parser requires to be exact `pass`/`n/a`/`waived`, lacks the recognized independent-review checkbox, and leaves the local `pnpm test` checkbox unticked. That failure is real and must be resolved through the normal PR body/review-record process, without waiving or hiding the local timeout. A committed review note and updated candidate SHA may require exact-head review of the resulting delta under repository policy. Hosted PostgreSQL integration must finish green at the reviewed candidate SHA before merge.
