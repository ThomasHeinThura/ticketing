# PR #787 security review record: carrier A (#772, #760, #769 with #768, #775)

PR #787 merges four fully reviewed pull requests at their exact reviewed heads onto main 9bb28099: #772 (bbca3326, not security-scope), #760 (15e791ec), #769 (5092bf22, containing #768 at 91b37b46) and #775 (7c6e1476). Each component's own security record is in the tree: 760-project-engagement-ui.md, 769-saved-views-and-structured-work-list.md and 775-realtime-unavailable.md. This record covers the carrier itself. Two merges reproduce git merge-tree exactly. Two conflicted only in the generated contrast manifest packages/ui/src/styles/pairs.json, which was resolved as a structural three-way union per pair.

The conductor (Claude Opus 5.5) built the carrier. The reviewers below are fresh, independent contexts.

## Review chain

- Carrier mechanical review C by Claude Sonnet 5.5: APPROVE at fdb79d9c (parents and second parents match the PR heads, merge-tree equality for #772/#760, an independent three-way check of pairs.json, check:tokens and static gates).
- Carrier mechanical review D by Claude Sonnet 5.5: APPROVE at fdb79d9c (independent union check with 0 errors, no behavioural conflicts between components, targeted web run of 131 files and 989 tests).
- Carrier security rebind by Claude Opus 5.5: CLEAR at fdb79d9c (no security file hand-edited, cross-component interactions checked, 305 targeted tests plus 152 with the real microtask scheduler forced on).

**Reviewed head:** `fdb79d9cc9ad5ac5172c27976094e59f9c2582b6`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `carrier-a-ordinary-c-sonnet.md` | Carrier mechanical review C (9bb28099..fdb79d9c) | Claude Sonnet 5.5 | `fdb79d9c` | APPROVE | `829fac36f942d02f4a17a99f5802155db7d10185e448f4da6bf7459d74fa5dd1` |
| 2 | `carrier-a-ordinary-d-sonnet.md` | Carrier mechanical review D (9bb28099..fdb79d9c) | Claude Sonnet 5.5 | `fdb79d9c` | APPROVE | `0909e116f06d53142ef9ac49b8f8b9fbe85194e3a07c66f8a9cc6a5615596c8f` |
| 3 | `carrier-a-security-opus.md` | Carrier security rebind (9bb28099..fdb79d9c) | Claude Opus 5.5 | `fdb79d9c` | CLEAR | `6f459ac1e0fa483f4374bef4b1f958a58a05ee771145ab146fc9b149b57ef971` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/carrier-a-ordinary-c-sonnet.md; Claude Sonnet 5.5; sha256 829fac36f942d02f4a17a99f5802155db7d10185e448f4da6bf7459d74fa5dd1) -->
# Carrier branch codex/carrier-2026-10-15-a, ordinary review C (mechanical)

**Reviewed head:** fdb79d9cc9ad5ac5172c27976094e59f9c2582b6
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate). Mechanical review of the carrier construction and static gates; I did not re-review the content of the four PRs and did not run web unit or e2e suites.

## 1. First-parent chain and parents

`git rev-parse origin/codex/carrier-2026-10-15-a` equals the head. `git log --first-parent 9bb28099..fdb79d9c` shows exactly four merge commits on top of main 9bb28099 (which is an ancestor):

| Merge | First parent | Second parent | `gh pr view N --json headRefOid` |
| --- | --- | --- | --- |
| 4f052541 | 9bb28099 (main) | bbca3326 | #772 bbca33266efe8c4c061143c2f57ca35e32b31bf6, equal |
| 5941ed1f | 4f052541 | 15e791ec | #760 15e791ec453e7f2019286048ac092da0c49f6dbe, equal |
| d2c0dcee | 5941ed1f | 5092bf22 | #769 5092bf222917fcb13149a7138216fd9674b8d545, equal |
| fdb79d9c | d2c0dcee | 7c6e1476 | #775 7c6e147606881265e4e67a7242ba31e7484d74f3, equal |

Order matches the stated order (#772, #760, #769, #775).

## 2. Clean merges reproduce merge-tree exactly

- 4f052541: `git merge-tree --write-tree 9bb28099 bbca3326` exits 0, tree adc251d4..., equal to the merge commit's tree.
- 5941ed1f: `git merge-tree --write-tree 4f052541 15e791ec` exits 0, tree dc0545a9..., equal to the merge commit's tree.

## 3. Conflicted merges (#769, #775)

- d2c0dcee and fdb79d9c: `merge-tree --write-tree --name-only` exits 1 with exactly one conflicted path, `packages/ui/src/styles/pairs.json`. `git diff --name-only <merge-tree tree> <merge commit tree>` lists only `packages/ui/src/styles/pairs.json` in both cases, so every other path in each merge commit equals merge-tree's auto-merged result.
- Independent verification of pairs.json (my own script, not the author's resolver; merge base for both is main 9bb28099; for each merge ours = previous carrier tip, theirs = PR head):
  - Entry set: 418 entries in base, ours, theirs and result; entries identified by every field except `occurrences`/`occurrenceIds`; result entry keys equal ours union theirs (none lost, none invented) for both merges.
  - Occurrences (identity = whole occurrence object, since several occurrences share an `id` with different `chain` contexts): the result equals the three-way set merge, i.e. (ours union theirs) minus any base occurrence that either side removed or replaced, with 0 entries differing, 0 missing and 0 invented, for both merges. A plain "union" would resurrect 20 stale base occurrences in each merge (a side changed their chain or removed them); the resolver correctly does not, which is the right semantics, and base occurrence ids that disappeared (6 per merge) are ones a side removed, not lost by the merge.
  - `occurrenceIds` equals the first-seen distinct list of the result's `occurrences` ids in every entry (0 violations) for both merges; no entry carries duplicate identical occurrences.
  - Order: per-entry occurrence order is not simply "ours then theirs-new" in 20 (#769) and 16 (#775) entries, because replaced items are repositioned; order is not asserted by the gate, only ids first-seen consistency, which holds.
- Live-source proof: `pnpm check:tokens` at the head (builds web, then contrast): exit 0, "check:contrast: 418 declared, source-grounded pairs meet thresholds in light/dark built CSS". The checker validates the manifest against live source contexts (a missing or stale occurrence fails it), so the resolved file is correct for the merged source, not just self-consistent.

## 4. Static gates at the head (scratch worktree, frozen install)

| Check | Result |
| --- | --- |
| `pnpm turbo typecheck` | exit 0, 9/9 |
| `pnpm check:i18n` | exit 0 |
| `pnpm check:ui` | exit 0 |
| `pnpm check:visual-scope` | exit 0 |
| `pnpm check:vocabulary` | exit 0 |
| `pnpm check:tokens` | exit 0 (above) |

## Findings

Blocking: none.

Non-blocking:
- N1. The carrier's pairs.json resolution is a three-way set merge, not a pure union; the PR description or decision-log invariant note should say "union minus occurrences either side removed or replaced", otherwise a future reader may re-add the 20 stale occurrences.
- N2. This check did not re-run the web unit suite, e2e specs or baselines on the combined tree; interactions between the four PRs (for example #769's reuse of #768's search wiring alongside #775's layout changes) rest on `check:tokens`, typecheck and the per-PR reviews. The exact-head CI run should cover them.

**Verdict:** APPROVE
<!-- END REPORT (sha256 829fac36f942d02f4a17a99f5802155db7d10185e448f4da6bf7459d74fa5dd1) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/carrier-a-ordinary-d-sonnet.md; Claude Sonnet 5.5; sha256 0909e116f06d53142ef9ac49b8f8b9fbe85194e3a07c66f8a9cc6a5615596c8f) -->
# Carrier A (`codex/carrier-2026-10-15-a`) mechanical and interaction review D

**Reviewed head:** fdb79d9cc9ad5ac5172c27976094e59f9c2582b6
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate; reviewer C's report not read)
**Base:** main 9bb28099a69d1e599e1d7451ebdf6225e380546c; scratch worktree at the exact head.

## Parents and PR heads (current `gh pr view` heads fetched)
First-parent chain from main: `4f052541` (#772) -> `5941ed1f` (#760) -> `d2c0dcee` (#769) -> `fdb79d9c` (#775). Second parents: #772 `bbca3326` (PR head bbca33266efe...), #760 `15e791ec` (PR head 15e791ec453e...), #769 `5092bf22` (PR head 5092bf222917...), #775 `7c6e1476` (PR head 7c6e147606881265...). All four equal the PRs' current heads. First parent of each merge is the previous carrier commit (and of the first, main 9bb28099).

## merge-tree equality
- #772 merge `4f052541`: `merge-tree --write-tree` = tree adc251d4..., identical to the commit's tree; no conflicts.
- #760 merge `5941ed1f`: tree dc0545a9..., identical; no conflicts.
- #769 merge `d2c0dcee`: one conflict, `packages/ui/src/styles/pairs.json`; every other file's content in the merge tree equals the auto-merge result (`git diff --name-only <auto-tree> <merge>` lists only `pairs.json`).
- #775 merge `fdb79d9c`: one conflict, `pairs.json`; again `pairs.json` is the only file that differs from the auto-merge. So pairs.json is the only hand-resolved file in both.

## pairs.json resolution (structural check, script run over both merges)
Method: parse the manifest (a list of 418 entries); entry identity = all fields except `occurrences`/`occurrenceIds`; occurrence identity = its full JSON (note: the same `id` legitimately appears more than once in an entry with different chains, so id alone is not unique). Expected = (A union B) minus whatever either side removed relative to the merge base, per entry and per occurrence. Results for both merges: **0 errors**: entry key set equal (418 = 418, none lost or invented); per entry, occurrence set equals the expected union (no lost, no invented, no resurrected removed occurrence); `occurrenceIds` equals the first-seen distinct ids of that entry's `occurrences` in every entry. Occurrence totals: #769 merge 3340 (sides 3284 and 3320, base-relative removals accounted for); #775 merge 3344 (3340 and 3268). Independent corroboration: `check-contrast.mjs` builds the app from this head and passes "418 declared, source-grounded pairs meet thresholds", which would fail on a lost or invented pair.

## Commands
- `pnpm install --frozen-lockfile --prefer-offline`; `pnpm turbo typecheck` 9/9 successful.
- `check:i18n`: all locale files in sync; strict JSON parse of all 19 locale files: no duplicate keys (a silent last-key-wins merge would hide as parity-passing); `check:ui` clean; `check-tokens` ok; `check:inventory` ok (55 generated routes, 20 inventory routes); `check-contrast` 418 pairs ok.
- `check-bundle-size`: agent 233.1 KB / 350; **work-list route graph 282.2 KB / 350** (15 assets; #769 alone measured 281.6, so #772/#760/#775 add 0.6 KB there); portal 165.0 / 200.
- Targeted web unit run (apps/web): `src/query-client src/components/project src/components/saved-view src/components/nav-main.test.tsx src/components/common src/components/work-item src/hooks src/fetchers src/lib src/routes/agent/_layout/_authenticated/agent`: **131 files, 989 tests passed**. No full suite, no Playwright.

## Semantic interactions between the four (shared files and behaviour)
- Files touched by more than one PR: only the 19 `i18n/*.json` files (#760 and #769) and `pairs.json` (#760, #769, #775). No overlap in `use-workspace-permission.ts` (#769 only; #760 uses the existing `canManageProjectSettings`), `routes.ts` (#769 only), `query-client/index.ts` (#772 only), project hooks (`use-get-project.ts` #760 only; `use-project-websocket.ts` #775 only).
- i18n: #760 adds `settings:projectGeneral.engagement.*`; #769 adds the new `savedViews` namespace, `navigation:sidebar.savedViews` and `workItems` keys; disjoint key paths, auto-merge is correct, parity and duplicate-key checks pass.
- #772 sets `notifyManager.setScheduler(queueMicrotask)` globally (module side effect in `query-client/index.ts`, loaded by `main.tsx`). It only changes when TanStack notifies observers (microtask instead of `setTimeout(0)`), so the new infinite-query and mutation flows in #768/#769 and the invalidation-driven refetches from #775's websocket hook behave the same, just a frame sooner. It also applies to `use-service-calendars`/`use-sla-*` which import `shouldRetryQuery` from the same module; no semantic change there. I looked for a case that compiles but conflicts and found none; the only theoretical interaction is test timing for suites that import the real query client, and the run above passed. Not covered: no browser run of the combined build.
- #775 `RealtimeUnavailableNotice` renders in `ProjectLayout`, which also calls `useGetProject({ id, workspaceId })`; #760's stricter `enabled` (needs `workspaceId`) is satisfied there. The saved-view and agent-work routes do not render `ProjectLayout`, so the notice and the new nav do not overlap.
- Bundle: the notice component sits in the dashboard project layout, not the `/agent` work-list graph; the 0.6 KB growth is the carrier delta, well inside budget.

## Findings
None blocking. INFO: typecheck was a full turbo cache hit (identical inputs to an earlier run), which is valid but means this run did not recompile; the targeted tests and the contrast/bundle build did compile this exact tree.

**Verdict:** APPROVE
<!-- END REPORT (sha256 0909e116f06d53142ef9ac49b8f8b9fbe85194e3a07c66f8a9cc6a5615596c8f) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/carrier-a-security-opus.md; Claude Opus 5.5; sha256 6f459ac1e0fa483f4374bef4b1f958a58a05ee771145ab146fc9b149b57ef971) -->
# Carrier A security rebind: codex/carrier-2026-10-15-a

**Reviewed head:** fdb79d9cc9ad5ac5172c27976094e59f9c2582b6
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context
**Base (main):** 9bb28099a69d1e599e1d7451ebdf6225e380546c
**Contents:** #772 bbca3326 (not security-scope), #760 15e791ec, #769 5092bf22 (contains #768), #775 7c6e1476. Precedent: #749 absorbing #747.

Method: read-only. Fresh clone in a scratch directory under $TMPDIR/opus-carrier (removed afterwards). Nothing pushed, commented, approved or merged.

## 1. Parents and note binding

First-parent chain: 9bb28099 -> 4f052541 (#772) -> 5941ed1f (#760) -> d2c0dcee (#769) -> fdb79d9c (#775).

| PR | Second parent in carrier | `gh pr view --json headRefOid` (OPEN) | Match |
| --- | --- | --- | --- |
| #772 | bbca33266efe8c4c061143c2f57ca35e32b31bf6 | bbca33266efe8c4c061143c2f57ca35e32b31bf6 | yes |
| #760 | 15e791ec453e7f2019286048ac092da0c49f6dbe | 15e791ec453e7f2019286048ac092da0c49f6dbe | yes |
| #769 | 5092bf222917fcb13149a7138216fd9674b8d545 | 5092bf222917fcb13149a7138216fd9674b8d545 | yes |
| #775 | 7c6e147606881265e4e67a7242ba31e7484d74f3 | 7c6e147606881265e4e67a7242ba31e7484d74f3 | yes |

Note binding. Each note's last `Reviewed head` (verdict CLEAR) is the head's single parent. Each PR head is one note-only commit on top of that parent. A note cannot name the commit that adds it, so this is the usual pattern:
- #760: note binds cef5c8c4; `15e791ec^` = cef5c8c4; `git diff --stat cef5c8c4 15e791ec` changes only `760-project-engagement-ui.md` (+287).
- #769: note binds 0f72a0a7; `5092bf22^` = 0f72a0a7; the diff changes only `769-saved-views-and-structured-work-list.md` (+456). #768 is contained at 91b37b46, also recorded in the note.
- #775: note binds d68ec9e2; `7c6e1476^` = d68ec9e2; the diff changes only `775-realtime-unavailable.md` (+207).
- #772 changes `apps/web/src/query-client/index.{ts,test.ts}` only. That is not a security-scope path under `docs/04-engineering/ci-cd.md`, so no security note is needed.

## 2. Merge reproduction

`git merge-tree --write-tree <p1> <p2>` compared with the actual merge tree:
- 4f052541 (#772): adc251d4 = adc251d4. Exact match.
- 5941ed1f (#760): dc0545a9 = dc0545a9. Exact match.
- d2c0dcee (#769): auto 88b6383b vs actual 68fa278a. The only difference is `packages/ui/src/styles/pairs.json` (+118/-76).
- fdb79d9c (#775): auto a178505a vs actual b3440ad2. The only difference is `packages/ui/src/styles/pairs.json` (+44/-40).

Faithfulness of the manifest union. A scratch script (`python3 -I`) splits every entry into atoms: the entry body without occurrences, plus each `occurrences` record and each `occurrenceIds` id. It then checks R == (O ∪ T) − ((B−O) ∪ (B−T)) against the merge base:
- d2c0dcee: entries 418/418/418/418; atoms B 5796, O 5830, T 5892, R 5926; R == expected: True; missing 0; extra 0; duplicate entry keys 0.
- fdb79d9c: atoms B 5796, O 5926, T 5800, R 5930; R == expected: True; missing 0; extra 0; duplicate entry keys 0.
- `pnpm run check:tokens`: exit 0. `check:contrast` reports "418 declared, source-grounded pairs meet thresholds in light/dark built CSS". This includes the checker's occurrenceIds/occurrences projection-order validation.

No security-relevant file was hand-edited:
- Carrier vs main: 96 files. That is 75 PR-owned files, 20 i18n files and pairs.json. There are no `apps/api`, migration, `.github`, `scripts/ci`, lockfile or package.json changes.
- For each PR, `git diff <PR head> fdb79d9c -- <PR files except i18n/pairs.json>` is 0 lines (#772 2 files, #760 10, #769 53, #775 10). Every PR-owned file is byte-identical to its reviewed head.
- Only i18n and pairs.json are shared between PRs. i18n was merged cleanly by git; a scratch key check over 19 locales finds 0 keys from any PR head lost or changed.

## 3. Cross-component interactions in the combined tree

- **#760 manage_settings vs #767 on main:**
  - The web UI shows `canEditHealth = canUpdateProjects()` and `canEditEngagement = canEditHealth && canManageProjectSettings()`. `canManageProjectSettings` is `=== true`, so it fails closed while capabilities load.
  - The server on main (`apps/api/src/project/index.ts`, `policy.ts`) still needs strict `project:manage_settings` for `kind`, `supportLevel`, `serviceCalendarId` and `defaultCommentVisibility` on PUT. The carrier does not modify `apps/api`.
  - The fetcher sends engagement fields only when defined. UI and server agree, and authority stays on the server.
- **Shared `use-workspace-permission.ts`, `routes.ts`, `nav-main.tsx`:**
  - Only #769 touches them. #760 and #775 change none of them, so there is no overlapping edit.
  - #769 adds `shareSavedViews` / `manageWorkspaceSettings`, defaulting to false. It also adds bounded, total URL parsers (`parseSavedViewUrlSearch`; ids ≤200 chars; enumerated scope/layout).
  - Saved-view list and count query keys include the viewer id (SV-20/SV-22), so there is no cross-user cache reuse.
- **#772 scheduler (`notifyManager.setScheduler(queueMicrotask)`) vs #769/#768 and #775:**
  - It changes only when batched observer notifications are delivered, not what they carry. Each render reads one atomic observer snapshot (`data`/`isError`/`status`).
  - The permission gating (fail-closed on missing capability), the SV-19 fallback (403/404 only; mutation-tested in the #769 note) and the #775 hook (`invalidateQueries` on socket events; 1008 terminal stop driven by its own `useState`) do not depend on a macrotask gap.
  - Default unit tests do not import `query-client/index.ts`, so they would not exercise the production scheduler. I therefore re-ran the interaction tests with an extra scratch setup file that installs the microtask scheduler. A marker confirmed it loaded in all 12 files. All passed (see below). I found no ordering assumption that changes.

## Commands (scratch clone; real counts)

- `git clone` + `git fetch origin codex/carrier-2026-10-15-a`: HEAD = fdb79d9cc9ad5ac5172c27976094e59f9c2582b6.
- `pnpm install --frozen-lockfile --prefer-offline`: exit 0.
- `pnpm turbo typecheck --concurrency=2`: exit 0, 9/9 tasks.
- `pnpm run check:tokens` (check-tokens + check-contrast): exit 0, 418 pairs.
- `vitest run` on 19 targeted files: exit 0, 19 files, 305 tests passed. Files: query-client index; use-workspace-permission; use-project-websocket (+status); realtime-unavailable-notice; project-engagement-form/settings; saved-view audience-fields/detail; fetchers/saved-views; saved-view-query; routes; work-item-list-search; work-item-filter; nav-main; views route; work-structured-filter route; use-get-work-items; work-items-panel.
- `vitest run` with the production microtask scheduler forced (scratch config, deleted afterwards) on the 12 hook/component interaction files: exit 0, 12 files, 152 tests passed. The marker was written 12 times.
- Not run: e2e, API integration and full suites (load control). The scratch config and setup files were removed, and the clone's `git status` was clean afterwards.

## Findings

**Blocking:** none.

**Non-blocking:**
- NB-1: the four security notes bind the parent of each PR head, not the head itself. Each head is a single note-only commit, which I verified above. This is consistent with the established pattern. It is recorded for transparency.
- NB-2: the #772 scheduler is a module-level side effect that unit tests do not load by default. Hook tests therefore run under TanStack's setTimeout scheduler unless a test opts in. This is a coverage gap, not a defect; this review covered it with the forced-scheduler run.

## Residual risk / not checked

- The browser-level behaviour of the combined tree (e2e) was not run. Each PR's own e2e evidence stands for byte-identical content.
- The server-side saved-view and realtime enforcement was not re-reviewed. It is unchanged by this carrier.
- The pairs.json union was checked structurally and by the contrast gate. The manifest is CI data and carries no authority.

**Verdict:** CLEAR
<!-- END REPORT (sha256 6f459ac1e0fa483f4374bef4b1f958a58a05ee771145ab146fc9b149b57ef971) -->
