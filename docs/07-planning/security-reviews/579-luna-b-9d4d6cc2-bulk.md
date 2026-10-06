# Independent ordinary review B — P0 rendering/evidence delta

## Verdict

**Request changes — one blocking source-occurrence metadata inconsistency.** I found no application behavior blocker in the inspected UI changes. The `pairs.json` occurrence records have new component IDs while their corresponding `occurrenceIds` arrays still contain the old IDs. This breaks the requested occurrence-context refresh and makes the declared source occurrence index disagree with its detail records.

## Exact source and independence

- Candidate SHA: `9d4d6cc2d198833b5fc6be919b4890f62a2d9da4`
- Reviewed baseline: `94ecb0fe9d6577c2bb4c6d5b540b803be5ccfc98`
- Baseline review-artifact descendant: `df74702dd93a6bf1da5e1dd5807576bd8c58035e`
- Worktree: `/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2`
- HEAD at start and end: candidate SHA above; working tree clean at both checks.
- Independence: fresh reviewer context; I did not author, direct, or remediate this candidate and made no source changes.

## Scope checked

I inspected the complete baseline-to-candidate diff: 19 files, comprising the breadcrumb picker, board task reuse/card wrapper, task label controls/sidebar, relation picker/status metadata, work-item list partial-failure/link handling, component tests, planning notes, and `packages/ui/src/styles/pairs.json`. The source diff from `94ecb0fe` contains no API, domain, permissions, contract, lockfile, or image-source changes. I also checked the relevant hooks, fetchers, query invalidation paths, route click delegation, and the linked work-item/relation feature contracts.

Behavior checked by inspection included picker activation/freshness, relation task rows and column status/icon mapping, label query sharing and mutation cache updates, board flattened-task reuse, task-card empty-label spacing, work-item partial diagnostics, detail URLs, modified-click behavior, focus prefetch, and delegated click navigation.

## Checks actually run

- `pnpm --filter @taskdesk/web exec vitest run src/components/common/header/task-crumb-select.test.tsx src/components/kanban-board/task-card.test.tsx src/components/task/task-labels-section.test.tsx src/components/task/task-properties-sidebar.test.tsx src/components/task/task-relations.test.tsx src/components/work-item/work-item-list.test.tsx src/components/work-item/work-item-list-project-switch.test.tsx` — **7 files, 24 tests passed**.
- `pnpm check:tokens` — passed token check and built both web entries; contrast gate reported **422 declared source-grounded pairs meet thresholds in light/dark built CSS**.
- No full performance suite, browser session, Docker build, PostgreSQL suite, or full typecheck was run for this review.

## Blocking finding

### B1 — stale `occurrenceIds` for moved component occurrences

The updated detail records correctly identify the extracted/moved nodes under `TaskLabelsSection` and `TaskCrumbOptions`, but the aggregate `occurrenceIds` entries still name the former component paths. For example, pair 15 retains the old `TaskPropertiesSidebar` occurrence at [pairs.json:4878](/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2/packages/ui/src/styles/pairs.json:4878), while its detail list contains the new `TaskLabelsSection` ID at [pairs.json:5278](/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2/packages/ui/src/styles/pairs.json:5278). The same mismatch occurs for pair records 15, 16, 69, and 70. Breadcrumb records 35–38 retain `TaskCrumbSelect` in `occurrenceIds` (for example [pairs.json:13518](/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2/packages/ui/src/styles/pairs.json:13518)) while their detail occurrence is now `TaskCrumbOptions` (for example [pairs.json:13620](/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2/packages/ui/src/styles/pairs.json:13620)).

Reproduction: parse the candidate `pairs.json`; for those eight pair records, compare the set of `occurrenceIds` to the set of `occurrences[*].id`. Each has one former ID in the summary and one new ID in the detail list. `pnpm check:tokens` passes because it verifies contrast declarations and built CSS, but it does not verify this index/detail consistency.

The packet names only four changed pair entries. Direct comparison against `df74702` finds eight records with changed occurrence IDs (15, 16, 35–38, 69, 70), plus four records whose occurrence-detail ordering changed only (165, 167, 175, 176). All 422 top-level records retained their colors, category, minimum ratio, themes, and other threshold fields. This is metadata-only, but it is within the specific source-occurrence preservation claim and should be reconciled before clearance.

## Non-blocking observations and evidence limitations

- The UI test run passed, but these component tests do not exercise the real browser primitives’ keyboard interaction or the complete rendered screen. No regression was apparent in the source paths inspected; browser evidence remains separate.
- The author’s canonical local G11 log is at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-04/p0-perf-ea6a-author/g11.log`. Its `base-sha.txt` is `ea6a63672c70459bb3a7a91b829e913d2f295829`; the log is from the `p0-g11-hosted-headroom-ea` worktree and records a 22-test passing run. The recorded medians include list 216.4 ms, LCP 2,112 ms (samples 4,204 / 2,112 / 2,112 with the permitted retry set), state 75.1 ms, assignment 75.9 ms, board 291.2 ms, and drag p95 16.8 ms. The log and status explicitly say this run began on frozen EA plus a web/pairs working snapshot, not clean EA or the final candidate. The pre-run tracked diff omitted then-untracked label-section files; author attestation says the committed files match. This evidence therefore does not establish an exact-candidate clean G11 run.
- Hosted acceptance remains unresolved on the latest retained source `3b6fa114`: **18/22**, with list 540.7/500 ms, state 319/200 ms, assignment 285.3/200 ms, and board 721.2/500 ms over budget. LCP 2,488/2,500 ms and drag p95 16.7/20 ms pass. The earlier 94ecb0fe hosted 22/22 and df74702 hosted 20/22 are retained historical results; none substitutes for a passing current hosted candidate. Local 22/22 does not clear hosted acceptance.
- This review is not the required current-head Sol confirmation or the P0 phase finalizer. No P0 completion or acceptance claim follows from this verdict.
