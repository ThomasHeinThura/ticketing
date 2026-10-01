# Security review — deterministic seed preservation snapshots (#554)

**Reviewed head:** `3019982d051595ede5bf992c104e62aba94d4dce`
**Base / current main:** `098274e1d353ce5731c06eaf7fbc72898798ce8d`
**Verdict:** CLEAR for the exact reviewed source; no blocking or non-blocking security findings. This is a source/security verdict, not approval or merge authorization.

## Risk and scope

This is a bounded integration-test gate repair. The only PR diff against current main is `apps/api/scripts/seed-postgres.test.ts`. It makes every multi-row before/after preservation query order by primary key `id` on both reads; the existing complete-row equality checks remain unchanged. The test continues to compare all row fields, IDs, timestamps, counts, and existing error/rollback behavior. It does not change seed implementation or any executable product, authorization, permission, route, schema, migration, dependency, or CI workflow.

The failure being repaired was nondeterministic array order from PostgreSQL, not changed fixture data. Hosted PR #552's PostgreSQL integration run failed at the template array comparison with 1 failure among 1,579 tests. The recorded before/after values, IDs, and timestamps matched; the five rows were returned in different orders. The source fix makes row comparison independent of unspecified query result order while still failing on any field, row, or count difference.

## Independent reviews

A strong independent GPT-6 Luna full review cleared source `0699b50c6ec53f210d85515c966455ebef1a1212` (GitHub COMMENTED review [5379925968](https://github.com/ThomasHeinThura/ticketing/pull/554#pullrequestreview-5379925968)). A separate fresh GPT-6 Sol full security review cleared that same source (GitHub COMMENTED review [5379996053](https://github.com/ThomasHeinThura/ticketing/pull/554#pullrequestreview-5379996053)). Both reviewers were independent of the author and each actually ran the disposable PostgreSQL seed suite: 2 files / 18 tests passed.

After merging accepted `main` for current composition, a fresh GPT-6 Luna delta review cleared exact head `3019982d051595ede5bf992c104e62aba94d4dce` (GitHub COMMENTED review [5380072012](https://github.com/ThomasHeinThura/ticketing/pull/554#pullrequestreview-5380072012)). A further full GPT-6 Sol security review cleared the exact same head (GitHub COMMENTED review [5380087523](https://github.com/ThomasHeinThura/ticketing/pull/554#pullrequestreview-5380087523)). Both verified the exact current-main composition and reported no blocking or non-blocking findings. The Sol context was fresh relative to the author and did not direct or remediate the candidate; it continued its independent full review only to check the later composition delta.

The current-main merge imports exactly four files already accepted on #551: `docs/07-planning/rls-prototype-results.md`, `docs/07-planning/security-reviews/551-rls-pgbouncer-prototype.md`, `tests/rls-prototype/global-setup.ts`, and `tests/rls-prototype/rls-prototype.test.ts`. They are byte-identical to the current-main parent. Against the current-main parent, #554 still changes only `apps/api/scripts/seed-postgres.test.ts`. That file's blob is `ab45c702a65c58338d7e03d935be22d9a5e6186e` at both original reviewed source `0699b50c6ec53f210d85515c966455ebef1a1212` and composition source `3019982d051595ede5bf992c104e62aba94d4dce`; the suite was not rerun for the merge-only composition delta.

## Verification and limits

The author and both original full reviewers ran the dedicated seed suite on the unchanged fixture source; the reported actual result was 2 files / 18 tests passed against disposable PostgreSQL. The author also recorded a scoped Biome check, the API test-project TypeScript check, and `git diff --check` passing. The current-main composition reviewers independently checked the merge parents and file/blob identity; the Luna report records `git diff --check` passing for that delta. No current-composition test rerun is claimed.

This change does not alter runtime behavior or ship in an image. No image build, container boot, deployment, browser verification, or screen evidence is claimed. Required hosted checks and the final PR record remain separate merge gates; this note does not claim they are green.
