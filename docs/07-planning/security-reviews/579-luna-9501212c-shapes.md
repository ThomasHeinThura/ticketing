# Independent Luna review — fail-closed contrast manifest shape

## Verdict

**Clear for the complete structural-shape remedy, with one non-blocking documentation whitespace nit.** The Sol finding is resolved: every manifest pair now requires nonempty typed summary/detail arrays and well-shaped detail records before occurrence binding can count as valid. A direct utility/source fallback may still be evaluated after a shape failure, but the accumulated shape failure remains in the returned errors, so that fallback cannot produce a passing result. Repeated detailed contexts sharing one ID remain accepted while the summary is an ordered distinct projection.

## Exact head and independence

- **Reviewed head:** 9501212c5e0c556043c84b40c336fca0b135129e
- Structural-shape implementation: 78bb68247cab4349453754a4839b2d110883b890
- Previous reviewed head: 8c8007f7d2dbb434b15f6560f8c76a08fd7315cc
- Worktree: /Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2
- Start/end HEAD: exact reviewed SHA above; working tree clean at both checks.
- **Model:** GPT-6 Luna.
- **Independence:** fresh review context. I did not author, direct, or remediate the structural-shape remedy. I authored the earlier 9d request-changes finding and the clear 8c bounded remedy verification; both genuine reports remain preserved.

## Complete delta inspected

I reviewed the complete 8c8007f7..9501212c diff, including:

- scripts/ci/check-contrast.mjs
- scripts/ci/check-contrast.test.mjs
- The genuine 8c Luna and Sol review artifacts
- docs/07-planning/status.md and decision-log.md

The only implementation files changed are the checker and its tests. There are no changes to pairs.json, application UI, API, domain, permissions, contracts, migrations, dependencies/lockfile, Docker/image/deployment source, or runtime application code. The previously reviewed 9d UI source and 8c registry correction remain unchanged.

## Structural behavior checked

The validator now requires:

- Nonempty occurrenceIds with nonempty string IDs.
- Nonempty occurrences containing only the six expected detail fields.
- Nonempty string ID and usage, one of the supported surface-context values, valid category, nonempty string paint chain, and string backdrop layers.
- Summary IDs to equal the first-seen ordered distinct detail-ID projection; repeated detailed records are permitted, duplicate summary IDs are rejected.

The occurrenceShapeValid result feeds occurrenceBound, and a shape violation is immediately added to failures. The later utility/source fallback cannot erase that failure. The new malformed-shape test provides source classes and observed pair data that would otherwise satisfy the fallback, and asserts the shape-specific failure for each mutation.

## Checks and reproductions actually run

- node --test scripts/ci/check-contrast.test.mjs — **42 passed, 0 failed, 0 skipped**.
- pnpm exec biome check scripts/ci/check-contrast.mjs scripts/ci/check-contrast.test.mjs — **2 files passed**, no fixes.
- pnpm check:tokens — passed; built agent and portal production entries; built-CSS contrast reported **422 declared source-grounded pairs pass in light and dark**.
- Read-only direct validatePairManifest probe with source classes and observed data held valid: valid row returned 0 failures; missing summary, string summary, missing details, string details, both arrays missing, empty summary, and empty details each returned failures including the shape diagnostic.
- git status --short empty and HEAD exact at final check.
- git diff --check 8c8007f7..9501212c reports one trailing blank line at EOF in the preserved genuine prior report docs/07-planning/security-reviews/579-luna-b-8c8007f7-remedy.md:54. It does not report whitespace in the checker or test changes. I left that review artifact untouched.

## Documentation/evidence accuracy and limits

The dated status describes the 9d4d6cc2 runtime as exact-source author/operator evidence for one partial October 4 bucket, and does not claim three dates, full-day coverage, or 72 hours. It retains the latest hosted 3b6fa114 G11 result as **18/22**, with list 540.7/500 ms, state 319/200 ms, assignment 285.3/200 ms, and board 721.2/500 ms failing. The local dirty-snapshot 22/22 evidence is not promoted to hosted acceptance. These limitations remain accurate in the reviewed delta.

I did not run browser, performance/G11, Docker/runtime, PostgreSQL, full CI, or new traffic acquisition. The correction is limited to a bounded CI manifest pass/fail control, and the assigned regressions plus built-CSS gate cover that change. The required full current-head GPT-6 Sol review and all independent acceptance gates remain separate from this ordinary review; this is not the P0 phase finalizer.

