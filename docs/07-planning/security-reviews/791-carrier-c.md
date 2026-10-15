# PR #791 — Carrier C independent review records

## Provenance and source

Thomas designated replacement conductor Codex `/root` for the existing #589 continuation on 2026-10-15. Original source/composition and Claude component evidence are retained. This note publishes authentic independent reports unchanged; it does not relabel original model identities or turn started/interrupted work into approval.

Initial carrier: `9ccdeed432c73c3c8d139df3ccd2698713096fd7`; original accepted product base: `9bb28099a69d1e599e1d7451ebdf6225e380546c`. Final reviewed source: `7a99905d63a3b52c42aebf4d6e35d1104976696f`. Current main `a07df32424185559a079002144f91df17d004798` adds only separately reviewed status/queue records; product, dependencies, tests and gate inputs are unchanged from the original base. Carrier retains all eleven frozen component heads and #768 through #769.

Dispatch metadata: ordinary reviewers `/root/carrier_conservation`, `/root/carrier_behavior`, `/root/carrier_ui` selected `gpt-6-luna`, `fork_turns=none`; security reviewer `/root/carrier_security` selected `gpt-6-sol`, `fork_turns=none`. Separate authors `/root/carrier_visual_repair` and `/root/erasure_race_repair` selected `gpt-6-luna`; neither supplied independent approval. Reports retain any runtime model introspection limitation literally; the dispatch selectors are provenance, not invented runtime version labels. The conductor authored no independent review.

The retained Claude handover says Carrier C ordinary/security attempts stopped before writing reports. Those interrupted attempts supply no approval. One Codex follow-up dispatch initially hit the thread-capacity limit before starting and was retried after a slot opened; no report/approval is attributed to that failed dispatch.

## Disposition and verification boundaries

- Missing #778 visual project-state fixture: restored faithfully at `5893afed`; independently closed by A/C.
- Sol S1 customer-project/erasure race: production repair `439394d5`; regression strengthened at test-only `7a99905d`. Real PostgreSQL focused suite passed 27/27; separate creation-side and erasure-side anchor-removal controls failed at intended wait gates, then source was restored. A/C close their test blockers; independent Sol closes S1 at final reviewed source. Raw reports below retain earlier adverse verdicts.
- Original remote `9ccdeed4` hosted browser 123/123, G11 22/22 and unit 12 tasks passed; G8 failed missing fixture and draft template/security was pending. Those checks are not final-candidate statuses. Full current-head required checks remain mandatory.
- Pinned Linux source `7a99905d` application visuals passed 24/24 before update and 24/24 afterward with no PNG byte change. Update-mode acquisition exited 1 because its expected changed-snapshot set was empty. A shell summary pipeline incorrectly recorded zero despite its expectation mismatch; that wrapper defect was preserved/corrected separately and is not a visual-pass claim. Raw Playwright JSON/pass counts and unchanged source/snapshot hashes are the evidence. No baseline or tolerance is changed by this PR.
- Shipping image built at product source `439394d5`: `sha256:584882a1df497db227aed8ac55d56b7271d92c710dcbc2cf728b724dacdca5d9`. Isolated PostgreSQL18 migration exit0/125 history rows, runtime UID10001, live/ready200, no published ports, exact owned cleanup. `439394d5..7a99905d` changes only an integration test; image/product/build/dependency inputs are conserved. Earlier operator probe path error404 remains recorded, not called a product failure or pass.
- GitGuardian38240567 is independently identified below as the negative parser literal `never-in-url`, not a credential. Its external status is not forged or waived. #783/#784 authority fixes are excluded from this carrier and remain a prerequisite for the final combined release.
- This note grants no release/SIT/restore/final audit acceptance, issue closure, phase completion, gate waiver or production authority.

## Authentic reports

### Ordinary A initial — blocker retained

Source evidence file: `carrier-ordinary-a-luna.md`; SHA-256 `bff3a26102a7f68dc9bb4a89d5a1d9ade69ce5eda47f6bea7b8a6ad314cba1e1`. Report bytes follow unchanged.

# Carrier C source-conservation / composition review A

**Candidate:** `codex/carrier-2026-10-15-c` at `9ccdeed432c73c3c8d139df3ccd2698713096fd7`  
**Base:** `main` / `9bb28099a69d1e599e1d7451ebdf6225e380546c`  
**Reviewer context:** fresh read-only reviewer; did not author, direct, or remediate the candidate.  
**Model:** GPT-6 (runtime label available to this context; exact Luna submodel label was not exposed). Ordinary-review tier; the conductor should record the platform's model label accurately.  
**Scope:** source conservation and composition of #772, #760, #769 (including dependency #768), #775, #771, #780, #774, #779, #782, #781, #778; merge conflict resolutions; main preservation; final import-order delta. This does not substitute for the independent Sol security review.

## Verdict: REQUEST CHANGES

### Blocking finding — #778 board visual fixture was dropped during conflict resolution

The #778 PR head `17a684093de96ae8d063722ca864d0cd91745dbd` includes an API fixture branch in `apps/web/e2e/visual.spec.ts` for `/api/projects/visual-project/states`. It returns the three states Backlog, In progress, and Done. The merged candidate `9ccdeed` has no handler for that endpoint. The fixture initializes unmatched API bodies to `[]` (`let body: unknown = []`), while the board obtains its columns from `useGetProjectStates(project.id)` and the merged visual test still expects the `In progress` heading and the work item. The board visual case therefore has no state columns in the composed fixture and cannot satisfy its assertion.

The carrier's #778 merge commit is `5afc7db1cc233d85112ef25b34d2b32d18160545`. `git merge-tree --write-tree` reports conflicts in exactly `apps/web/e2e/visual-screens.json` and `apps/web/e2e/visual.spec.ts`. The final screen manifest preserves the Saved Views entries and adds the board entry. The `visual.spec.ts` resolution retained all three tests but omitted #778's states fixture; this is a source-conservation defect, not merely missing browser evidence. Restore the fixture in the owning resolution, then verify the visual test on the repaired exact candidate.

## Composition evidence

The first-parent chain from the requested base contains the eleven requested merge commits in this order: #772 `2efddad6`, #760 `1ccb0a89`, #769 `d977ad55`, #775 `ccf3f616`, #771 `4d618c46`, #780 `32140ce6`, #774 `3aca565e`, #779 `60d3a471`, #782 `a0674405`, #781 `dfc3c6e1`, and #778 `5afc7db1`; then the one-line import-order commit `9ccdeed4`. Every merge's first parent is the previous carrier commit, beginning at the exact requested base. Each merge's second parent is the corresponding PR head listed in the fetched open-PR inventory. `git merge-base --is-ancestor` confirms base preservation. `gh pr view` confirms #768 head `91b37b462786f8250ce5bd2d003c9d16394cd3ee` and #769 head `472bf9fb24283b40161a3ed455c82615d9102afd`; #768 is an ancestor of #769's integrated head.

For the first two merges (#772, #760), `git merge-tree --write-tree` equals the merge commit tree. For #769, #775, and #771, the only conflict path is `packages/ui/src/styles/pairs.json`; all other paths equal the automatic merge tree. Prior exact-head carrier A2 evidence (`carrier-a2-ordinary-d-sonnet.md`) records a structural union check for those resolutions. I verified that the final `pairs.json` blob is byte-identical to the reviewed #771 integration head (`29f01a854c9f544022a9f6fbad562eaeed042653`) and ran `pnpm check:tokens` to completion: 418 declared, source-grounded pairs pass in both built themes.

The #778 merge adds its board inventory row, Linux screenshot, tests, and spec entry while preserving the saved-view visual entries. Its two-file conflict is where the states fixture was lost. The final delta `5afc7db1..9ccdeed4` changes only import ordering in `apps/api/src/user/controllers/delete-account-data.ts`; `pnpm exec biome check apps/api/src/user/controllers/delete-account-data.ts` passes.

## Commands and evidence

- `git status --short --branch`; `git rev-parse HEAD`; `git diff --stat <base>...<head>` — frozen clean worktree and exact requested head.
- `git log --first-parent --format='%H %P %s' <base>..<head>` — chain and parent relationships.
- `gh pr list --state open --json number,headRefOid,title`; `gh pr view 768/769 --json number,headRefOid,title` — live PR heads.
- `git merge-base --is-ancestor <base> <head>`; `git merge-base --is-ancestor <768-head> <769-head>` — main and dependency conservation.
- For each merge: `git merge-tree --write-tree <first-parent> <second-parent>` and `git diff --name-only <auto-tree> <merge-commit>` — conflict-resolution paths.
- `git rev-parse <#771-integration>:packages/ui/src/styles/pairs.json HEAD:packages/ui/src/styles/pairs.json`; `pnpm check:tokens` — manifest identity and token/contrast verification.
- `git show <#778-head>:apps/web/e2e/visual.spec.ts`, `sed`/`rg` on candidate fixture, `get-project-states.ts`, and `work-item-board-view.tsx` — confirmed lost API fixture and board dependency.
- `git diff <#778-merge> <candidate> --stat`; `pnpm exec biome check apps/api/src/user/controllers/delete-account-data.ts` — final delta and import ordering.
- `git diff --check <base> <head>` — clean.

## Limits and non-blocking notes

No full unit suite, Playwright/browser, Docker, or PostgreSQL run was performed. The specific #778 visual failure is concluded from its route stub, the default unmatched response, the board's state-query dependency, and the test's required heading; it was not reproduced in a browser. Previous authentic per-PR/carrier reports were consulted as leads and re-checked against the frozen candidate where noted. `check:tokens` builds both application variants as part of its contrast check. The worktree remains clean.

### Ordinary B initial

Source evidence file: `carrier-ordinary-b-luna.md`; SHA-256 `d79686d3dd04eb4fb808f84bcd237a2f1506ec21812c46a32e72aab45a4a43e3`. Report bytes follow unchanged.

# Independent ordinary review B — carrier API behavior and composition

**Reviewed head:** `9ccdeed432c73c3c8d139df3ccd2698713096fd7`
**Comparison base:** `9bb28099a69d1e599e1d7451ebdf6225e380546c` (`origin/main`; the local `main` ref is stale at `8ddb9de8d4d242a0832f6f91e12872300480a905`)
**Model / context:** GPT-6, fresh independent reviewer context; did not author, direct or remediate the candidate.
**Scope:** API behavior and regression composition for #772 query notification scheduling, #774 failed Intake claim rollback, #779 RT-6 skipped-assignee behavior, #781 IdP-member erasure locking/transactions, and shared integration seams. Read-only.

## Source and contract review

Confirmed the exact carrier HEAD and the frozen base above. `git status --short` was clean. The candidate includes #772's actual current approval commit `62607601` (rather than the stale #763 point), and #774, #779, and #781 changes are present in the merge sequence.

Read the carrier `AGENTS.md`, `CLAUDE.md`, `docs/04-engineering/agent-workflow.md`, `docs/07-planning/active-mission.md`, Intake and request-type feature specs, the relevant data-model authority, decision-log entry for the 2026-10-15 erasure/Intake/RT-6 decisions, and the existing review reports in the private evidence directory. No additional ADR was cited by these feature contracts.

The source matches the settled behavior:

- Query notifications use one shared TanStack scheduler configured in production and unit-test setup. The focused test checks the notification runs before a zero-delay timer while still executing. This changes observer delivery timing app-wide but leaves cache writes synchronous and batching intact.
- Intake acceptance takes the submission claim inside the same transaction as conversion. Its claim audit is deferred until validation and conversion writes succeed, then appended immediately before the accepted audit. A failed conversion therefore rolls back the claim and its audit; successful acceptance records both. The helper's standalone claim route still commits the claim and audit together.
- RT-6 reads the pinned snapshot assignee and only assigns an active staff person with project-scope membership in the selected destination. Otherwise it leaves the item unassigned and records the specified skip reason only in `submission.accepted` audit metadata; the outbox payload is unchanged.
- Erasure derives membership and grant checks from the same dependent-row predicates as workspace deletion, checks other access before taking locks, then locks `person`, `membership_grant`, and `membership` in the writer order with a bounded transaction-local lock timeout. It rechecks under lock before deletion. Refusals precede credential invalidation and deletes; 55P03 maps to a retryable 409.

## Composition checks and findings

No blocking interaction was found among the selected units. In particular, #774 and #779 touch separate portions of the same acceptance path: the skip metadata is attached to the accepted audit, while the deferred claim audit is emitted just before it. Both remain inside the conversion transaction, preserving rollback on any later failure. The Intake API behavior aligns with IQ-16a and RT-6 as amended.

The erasure access predicate and deletion helper remain coupled through `workspaceDependentPredicates`; the current lock/recheck sequence closes the race between checking access and deleting a workspace. Refused requests do not acquire the broad table lock. The carrier also contains the #782 role-dependent cleanup updates; inspection found no mismatch between the shared predicates used for refusal and the helper's deletion semantics.

**Blocking findings:** none.

**Non-blocking residuals:** the erasure lock is intentionally instance-wide for writes to the three identity tables during a passing sole-member workspace erasure, bounded to lock acquisition by three seconds; sustained writer contention can surface as the documented retryable 409. The query scheduler's global observer timing and browser-frame performance remain runtime concerns; no browser/G11 bench was run in this takeover review. Existing component reports note the `lock_timeout` prior-setting restoration and race/rollback cases; this review verified current source but did not rerun PostgreSQL-backed integration suites.

## Commands and tests actually run

- `git status --short --branch`, `git rev-parse HEAD`, `git rev-parse main`, and `git show` for both requested SHAs.
- `git diff --stat` and targeted `git diff` against the requested frozen base.
- `pnpm --filter @taskdesk/web exec vitest run src/query-client/index.test.ts src/test/setup-scheduler.test.ts src/lib/saved-view-query.test.ts` — **3 files, 40 tests passed**.
- `pnpm --filter @taskdesk/api exec vitest run ../../tests/api/user/account-deletion.test.ts` — **1 file, 13 tests passed**.

No PostgreSQL integration, browser, Docker, or full-suite run was performed; this respects the conductor's shared-resource constraint. Prior authentic component reports were treated as historical evidence only and were not substituted for current-source verification.

**Verdict: APPROVE** for the assigned ordinary API behavior/regression-composition scope.

### Ordinary C initial — blocker retained

Source evidence file: `carrier-ordinary-c-luna.md`; SHA-256 `b397495623c1142a4745edf253164fe1089c686400ff27e926e782c518fd2b3c`. Report bytes follow unchanged.

# Independent ordinary review C — carrier UI/API integration

**Candidate:** draft PR #791, Carrier C  
**Reviewed source HEAD:** `9ccdeed432c73c3c8d139df3ccd2698713096fd7`  
**Comparison base:** `9bb28099a69d1e599e1d7451ebdf6225e380546c`  
**Model / context:** GPT-6, fresh independent reviewer context; the session exposes no Luna/Sol or version suffix, so this report does not claim one. I did not author, direct, or remediate the candidate.  
**Method:** read-only review of the frozen commit objects in `/Users/heinthura/.codex/worktrees/carrier1/Ticketing.v2`. The worktree was clean at initial inspection. A later external change appeared in the working copy of `apps/web/e2e/visual.spec.ts`; I did not make or include it and continued against `HEAD` with `git show`. Product source paths remained identical to `HEAD`.

## Scope

Combined UI/API integration for #760 engagement controls, #769/#768 saved views and structured work list, #771 authentication/SCIM UI, #775 realtime-unavailable status, and #778 board states. Checked URL registration and query state, navigation and viewer-scoped query keys, current session/permission hooks, identity DTO and step-up call shapes, work-item search response handling, board/list rendering, current tests, and visual fixture/baseline wiring. I read the carrier's AGENTS.md, CLAUDE.md, active mission, agent workflow/model policy and the feature contracts for projects/engagements, saved views/work items and realtime, plus the component review records in the evidence directory. Those earlier records remain evidence for their original heads and scopes; they do not substitute for this exact-head composition check.

## Current-head assessment

The inspected URL and query wiring is coherent across the composed features:

- `routes.ts` registers the saved-view, identity-connection and structured work-list state. Work-list filters, editor mode, selected columns, sort and layout round-trip through the URL. Saved-view routes carry workspace/scope/layout and query state; the detail screen distinguishes the stored definition, a modified URL definition and a complete shareable snapshot. Invalid/out-of-reach view reads do not expose the view definition, while a complete URL snapshot is run through the current viewer's work-item search path.
- Saved-view list/count/pin/detail queries include viewer identity in their keys. The navigation sidebar defers its optional pinned-view reads until after first paint. Filtered work-item search uses a separate key below the existing `work-items/projectId` invalidation prefix, scopes requests to workspace and project, and retains cursor pagination. Unfiltered list behavior keeps the prior key shape.
- Identity connection DTOs, operation bindings, step-up header use, config-version writes, SCIM request variants and the client-secret/token handling align with the accepted API contracts I inspected. The instance-admin signal suppresses UI reads/forms for non-admins; server refusals still remain authoritative. Project engagement controls keep the stricter `project:update` plus `project:manage_settings` check, while health remains on `project:update`.
- The realtime notice is only shown for `unavailable`; it does not mislabel `connecting` as an outage. The board's title/priority redaction rendering and focus-clearing logic are present. Existing focused tests cover the associated behavior.

## Findings

### Blocking

1. **The #778 visual fixture is incomplete at the frozen candidate.** In `HEAD:apps/web/e2e/visual.spec.ts`, the `/api/projects/visual-project/states` response branch present at #778's reviewed source `c982e78f` has been removed. The fixture's generic default response is `[]`. The retained `work-item board screen @visual` case still requires the “In progress” heading and the synthetic work-item title, while the committed `work-item-board-linux.png` shows the three state columns and card. With no state rows, the current candidate fixture cannot produce that screen; this case cannot establish the committed visual baseline and its assertions are expected to fail. This is the known carrier blocker assigned to another lane; I independently confirmed its current-head impact and make no repair recommendation here. Path: `apps/web/e2e/visual.spec.ts` (the deleted fixture branch is in the diff `c982e78f..HEAD`; board case remains near line 1077).

No other blocking behavior was found in my assigned scope.

### Non-blocking

- `useProjectWebSocket` returns before resetting status when `projectId` or the session user id is absent. A still-mounted consumer can retain a prior `live`/`unavailable` value until a valid effect run; the previously reviewed layout lifecycle makes this uncommon. This matches the residual already recorded in the #775 component review.
- This review did not open the composed screens in a browser. The carrier PR body accurately marks combined screen verification as blocked; component screenshots and mocked journeys remain scoped to their original candidate heads.

## Commands and counts

- `git status --short`, `git rev-parse HEAD`, `git diff --stat <base>...HEAD`, targeted source diffs and `git show` comparisons for the board fixture — source HEAD matched the requested frozen SHA; initial worktree was clean.
- `pnpm --filter @taskdesk/web exec vitest run` with the 31 focused test files spanning nav, engagement, saved-view, identity, search/list/board, hooks, URL parsing, and feature routes — **31 files passed, 488 tests passed** (exit 0).
- `pnpm turbo typecheck --filter=@taskdesk/web` — **5/5 tasks successful**, exit 0 (4 dependency tasks were cached).
- Did not run Playwright, screenshot comparison, full web suite, API integration/Postgres, Docker or full CI. The focused checks do not close the combined-browser, visual, or runtime acceptance gates.

## Verdict

**REQUEST CHANGES** for the visual-fixture blocker above. The source behavior covered by my focused unit/route checks passed; no combined browser or visual acceptance is established at this head.

### Ordinary A visual-fixture delta

Source evidence file: `carrier-ordinary-a-delta-luna.md`; SHA-256 `06af3136f1fe105e0090f4db5268033873a7fe1f8345084b843a4e6a12ec9d6e`. Report bytes follow unchanged.

# Carrier C ordinary review A — source-conservation repair delta

**Reviewed delta:** `9ccdeed432c73c3c8d139df3ccd2698713096fd7..5893afeda2a8750a81ccb351b7c70882eaaa5531`  
**Reviewed candidate:** `codex/carrier-2026-10-15-c` at `5893afeda2a8750a81ccb351b7c70882eaaa5531`  
**Base:** `main` / `9bb28099a69d1e599e1d7451ebdf6225e380546c`  
**Model / context:** GPT-6 Luna per explicit dispatch metadata (`gpt-6-luna`, `fork_turns=none`); fresh independent delta-review context. This reviewer did not author, direct, or remediate the repair.  
**Review type:** bounded delta review closing the blocking #778 source-conservation finding from `carrier-ordinary-a-luna.md`; unchanged carrier composition findings are incorporated by reference to that preserved report, not re-reviewed.

## Verdict: APPROVE DELTA

The delta adds only the missing `GET /api/projects/visual-project/states` fixture to `apps/web/e2e/visual.spec.ts`. It returns the same three project states (Backlog, In progress, Done) as the original #778 PR head `17a684093de96ae8d063722ca864d0cd91745dbd`. The addition sits before the existing project work-items fixture. It restores the source omitted by the #778 conflict resolution without changing screenshot expectations, baseline images, tolerances, or the screen manifest.

This closes the blocking source-conservation finding: unmatched API routes default to `[]`; the board obtains columns from the project-states endpoint; and the existing `work-item board screen @visual` assertion expects the In progress column. The exact #778 fixture source is now present at the repaired candidate.

## Verification

- `git rev-parse HEAD` confirmed `5893afeda2a8750a81ccb351b7c70882eaaa5531`.
- `git show --stat` and `git diff --name-status 9ccdeed4 5893afed` confirm one changed file only: `apps/web/e2e/visual.spec.ts`, +27 lines.
- Compared the fixture at #778 PR head `17a684093de96ae8d063722ca864d0cd91745dbd` with the repaired head using `git show ... | rg -n -A28 -B1 'api/projects/visual-project/states'`; route, response object, and ordering are restored faithfully.
- `pnpm exec biome check apps/web/e2e/visual.spec.ts`: pass.
- `git diff --check 9bb28099 5893afed`: pass.
- `pnpm --filter @taskdesk/web exec playwright test --config playwright.visual.config.ts --grep @visual --list`: 24 tests in 1 file, including `work-item board screen @visual`.

## Limits

No browser/Playwright test execution was performed; only test discovery (`--list`) was run. This review closes the source-conservation defect and confirms the affected test is discoverable, but does not claim visual runtime success. All findings and limits from the original exact-head composition review remain as recorded there; this delta makes no claim about full-suite or browser acceptance.

### Ordinary C visual-fixture delta

Source evidence file: `carrier-ordinary-c-delta-luna.md`; SHA-256 `34e2d9234283eba7fcf6645ee09f2077c586b84480fcb2564879aa95d301c136`. Report bytes follow unchanged.

# Independent ordinary review C — visual fixture repair delta

**Candidate:** draft PR #791, Carrier C  
**Prior reviewed head:** `9ccdeed432c73c3c8d139df3ccd2698713096fd7`  
**Frozen final source:** `5893afeda2a8750a81ccb351b7c70882eaaa5531`  
**Comparison:** `9ccdeed..5893afed`  
**Dispatch metadata (conductor):** `gpt-6-luna`, `fork_turns=none`.  
**Runtime identity as exposed in this review session:** GPT-6 without a Luna/Sol or version suffix. The dispatch metadata and the surfaced runtime label are recorded separately.  
**Independence:** fresh review context; did not author, direct or remediate the repair.  
**Method:** read-only bounded delta inspection. No test or browser rerun.

## Delta examined

`git diff --numstat 9ccdeed..5893afed` reports exactly `27  0  apps/web/e2e/visual.spec.ts`. The only added block restores the `/api/projects/visual-project/states` fixture response with the original three synthetic states: Backlog, In progress and Done. It matches the state rows previously present at the #778 reviewed source. No application source, visual assertion, manifest entry or screenshot changed.

The committed board baseline blob is identical at both heads: `4ca71d0f6d16e0e026e7414e5e2dbbe4483c44b2`. The existing `work-item board screen @visual` assertion remains in place and still checks the In progress heading, the synthetic work-item title and realtime-unavailable notice before comparing the screenshot.

## Finding disposition

**Prior blocking finding B1 (missing project-states fixture): CLOSED at source level.** The current final source again supplies the three states needed by the existing board visual case. This is a source/diff closure only; I did not run the browser case, screenshot comparison, or any test on `5893afed`. Therefore this report makes no claim that the visual test passes at the final source.

No new finding in this bounded delta.

## Commands and limits

- `git diff --stat`, `git diff --name-status`, `git diff --numstat` for the exact two SHAs.
- `git show <sha>:apps/web/e2e/visual.spec.ts` around the fixture branch at both source heads.
- `git rev-parse <sha>:apps/web/e2e/visual.spec.ts-snapshots/work-item-board-linux.png` at each head; hashes match.
- No source changes made by this reviewer. No tests, Playwright/browser, Docker, Postgres or full review rerun.

## Verdict

**APPROVE DELTA.** The source-level blocker is closed for `5893afed`; composed browser/visual verification remains outstanding.

### Independent Sol initial — S1 blocker retained

Source evidence file: `carrier-security-sol.md`; SHA-256 `2d3cc7f5b51727003938419e4531a5e9b463e8be863d948d908ffc68818ca3c6`. Report bytes follow unchanged.

# Independent Sol-tier security review — Carrier C

**Verdict: REQUEST CHANGES.** One blocking erasure race remains at the exact reviewed source. No candidate files were changed.

**Reviewed head:** `5893afeda2a8750a81ccb351b7c70882eaaa5531` in `/Users/heinthura/.codex/worktrees/carrier1/Ticketing.v2`.
**Comparison base:** `9bb28099a69d1e599e1d7451ebdf6225e380546c` (`origin/main` for this carrier). The local `main` ref was stale at `8ddb9de8d4d242a0832f6f91e12872300480a905`.
**Candidate:** draft PR #791. At this review's initial live read, its remote head was still `9ccdeed432c73c3c8d139df3ccd2698713096fd7`, one commit behind the local reviewed head. Remote CI conclusions shown for that older SHA cannot validate this source.
**Model / context:** Fresh independent security-review context, platform dispatch selected `gpt-6-sol` (`fork_turns=none`); runtime identity exposed to the reviewer was generic GPT-6 without a Sol/version suffix. Dispatch metadata and runtime label are separate provenance facts. I did not author, direct, remediate, approve, or merge this candidate.

## Blocking finding S1 — customer project binding can race sole-owner erasure

`deleteAccountDataInTransaction` checks whether other customers can reach any project in a workspace, then takes a `SHARE ROW EXCLUSIVE` table lock on only `person`, `membership_grant`, and `membership`, and checks again (`apps/api/src/user/controllers/delete-account-data.ts:159-185, 271-311`). It later deletes the workspace (`:329-331`). A customer-serving project is another way to grant customer reach under RBAC Reach step 6, but the guard never locks `project` or a shared project-creation anchor.

The native project-create path can insert a `project` with `organisationId` after that second check (`apps/api/src/project/controllers/create-project.ts:152-166, 185-210`). Its advisory lock namespace `1524` is different from the erasure's workspace role-assignment locks. Crucially, this path explicitly supports a creator with no provisioned staff `person` row (`:185-188`); when `creator` is null, it skips the grant write (`:236-244`). Thus the project create can avoid writes to all three identity tables held by erasure. A sole legacy owner with no staff person can race their own erasure request while another active customer person already belongs to the organisation. If the new project commits after the post-lock access check but before the workspace delete, the erasure can remove a workspace that now serves another person. The transaction's `READ COMMITTED` access query does not reserve the absence of such a project, and the table lock does not cover that write. Depending on FK/delete interleaving, a database conflict may also abort one request; the current code does not establish the required no-loss guarantee for the committed-create ordering.

This violates Thomas's 2026-10-15 #734 decision: if anyone else has access, erasure must return `409` and nobody else loses access silently. The existing `workspace-delete-role-dependents` integration tests cover identity-row races and a pre-existing customer project, but do not cover concurrent customer-project creation after erasure's second read. **This is a source/lock-order finding, not a PostgreSQL reproduction**; the shared runtime window prohibited a new database run. It needs a corrected serialization invariant and a real concurrent regression test, then fresh review of the changed exact head. I made no design or repair change.

## Other security observations

- The Intake acceptance claim and conversion now share a transaction. The deferred claim audit is appended immediately before `submission.accepted` after validation and conversion writes, so an exception rolls back both; an ineligible snapshotted assignee is omitted from the item and recorded in acceptance audit metadata. The route supplies project reach, and the repository checks the destination's workspace/organisation and reach before conversion. I found no new authorization or audit-order blocker in the composed source.
- Identity/SCIM writes in the new UI request an operation-bound step-up proof and pass the single-use token as a header. The connection editor clears submitted client secrets from its draft and mutation state after the write settles. The SCIM bearer is displayed once in component state; the mutation strips the bearer from its retained result and invalidates the shared-version reads. Server authorization and CAS remain the authority; UI state alone does not grant access. I found no additional blocker by inspection in these paths.
- Saved-view URL execution and structured work-list filters run through the current viewer's work-item search request. The UI's permission and instance-admin signals only gate display. I found no source path in this carrier that promotes a URL, saved-view record, IdP claim, or API-key scope into authority by itself. These are source observations, not browser or database proofs.
- `#783`/`#784` API-key follow-up fixes are **not** in this carrier. The carrier's documentation describes the current AK-3 decision and evidence; this review does not claim those later issues fixed.
- GitGuardian incident **38240567** points to `password: "never-in-url"` at `apps/web/src/lib/routes.test.ts:666`. This is a literal negative fixture proving the identity URL parser drops password and token query keys (the assertion at `:669` expects only `{tab: "scim"}`). It is not an authentication credential. The external failing GitGuardian status still needs its own recorded disposition; this review does not waive a machine gate.

## Evidence, commands and limits

Read the candidate's `AGENTS.md`, `CLAUDE.md`, `agent-workflow.md`, active mission, relevant identity/Intake/project/RBAC feature contracts, the newest 2026-10-15 owner decision, source diff from the stated base, changed erasure/Intake/identity/saved-view/work-list code and focused tests. Read ordinary carrier A/B/C reports and A/C fixture delta reports as evidence for their own heads/scopes, without substituting their verdicts for this independent pass. Reviewed the final +27 visual-fixture delta; it only restores the mocked project-states response and does not affect the security finding.

Commands run on this reviewer source:

- `git status --short --branch`, `git rev-parse HEAD`, `git rev-parse main`, `git diff --stat`, `git diff --name-only`, targeted `git diff`/`rg`/`sed`/`nl`, and `git diff --check 9bb28099... 5893afed...` (exit 0). Worktree remained clean.
- `gh pr view 791 --json headRefOid,baseRefOid,mergeable,statusCheckRollup,reviews` (remote head was the earlier SHA; no remote verdict reused for current source).
- `pnpm --filter @taskdesk/web exec vitest run src/fetchers/god-mode/identity-connections.test.ts src/fetchers/god-mode/identity-step-up.test.ts src/components/god-mode/scim-panel.test.tsx src/lib/routes.test.ts`: **4 files, 69 tests passed**.
- `pnpm --filter @taskdesk/api exec vitest run ../../tests/api/user/account-deletion.test.ts`: **1 file, 13 tests passed**.

No PostgreSQL integration, browser/Playwright, Docker, full unit suite, or current-SHA remote checks were run. The focused passing tests do not cover S1 or establish acceptance of the combined image. The ordinary reports also record remaining combined browser/visual verification limits. This review is **not approval** to merge.

### Ordinary A erasure delta — test blockers retained

Source evidence file: `carrier-ordinary-a-erasure-delta-luna.md`; SHA-256 `8deae1d5c59b0f4351fde40a4f8bca9f068c3144c7f4c170417abb83131fcb28`. Report bytes follow unchanged.

# Carrier C #734 erasure delta — ordinary review A

**Model/provenance:** GPT-6 Luna-tier, fresh review context independent of the repair author. Platform dispatch selected `gpt-6-luna`; runtime identity is not independently exposed here. The review was bounded to immutable Git objects, not the dirty/mutable worktree state. No source was edited.

**Candidate/base/delta:** exact candidate `439394d5dccfb4507de95ed54eed0f5ac15848b0`, parent `5893afeda2a8750a81ccb351b7c70882eaaa5531`; carrier base remains `9bb28099a69d1e599e1d7451ebdf6225e380546c`. This is a four-file, 106-insertion/8-deletion delta: project creation lock helper, project-create integration, account-erasure integration, and one API-integration regression. The unchanged Carrier C source-conservation/composition review is covered by my earlier `carrier-ordinary-a-luna.md` and repair review by `carrier-ordinary-a-delta-luna.md`; this report does not repeat those unchanged checks.

## Source finding

The production source delta addresses the identified race coherently. Project creation preserves namespace 1524 and uses the same workspace-keyed transaction advisory lock already used by project reorder. Account erasure, only when it plans to delete workspaces, sorts the IDs and acquires those same locks before locking `person`, `membership_grant`, and `membership`; it then repeats the “other access” query before deleting. Its 3000 ms local lock timeout covers both the shared advisory locks and table locks, maps lock-not-available to the existing conflict response, and is reset after acquisition; transaction failure rolls the transaction back. The lock in project creation is taken before optional creator-person lookup and project insert, so a project creator with no staff person still participates. If create commits first, the erasure waits and its recheck observes the customer project; if erasure locks first, create waits and cannot insert into the deleted workspace. I found no production ordering defect in the inspected delta.

The helper extracts the same advisory-lock SQL previously inline in project creation; reorder retains the same namespace and key. The order in account erasure is deterministic for multiple workspaces. Inspection of the exact create path confirms the lock is in the transaction containing validation, project insert, and related rows, not only in an outer route wrapper.

## Blocking regression-test finding

The new integration test does not exercise the production project-creation path. Its concurrent writer manually takes namespace 1524 and directly inserts `projectTable`, so it would continue to coordinate with erasure even if production `createProjectRow` omitted `lockProjectCreation`. It also does not invoke the production customer-organisation validation. The comment says it follows the path, but this is a hand-built approximation and cannot prove the production call site or its no-staff-person behavior.

The test then starts erasure, sleeps for 500 ms, releases the writer, and only checks the final rejection/state. It never asserts that erasure was waiting before release. If the erasure task had not reached the lock before release, it could observe the committed project afterward and pass without demonstrating the lock ordering. The sleep is therefore not a deterministic synchronization point. These are concrete gaps in the only new regression and block approval of this candidate delta as complete, even though the production-source implementation itself clears the reported mechanism.

## Verification and limits

Read the exact object diffs with `git diff --no-ext-diff --unified=80 5893afed..439394d5`, inspected exact candidate files via `git show 439394d5:<path>`, checked changed paths with `git diff --name-status`, and ran `git diff --check 5893afed..439394d5` (clean). The frozen candidate commit is timestamped `2026-10-15T21:25:39+06:30`. No API integration/PostgreSQL test, build, browser, Docker, or migration test was run; the author holds the heavy-test window and review instructions prohibit it. The worktree had uncommitted edits to the two changed files during inspection, so all conclusions above are bound specifically to the requested frozen Git object, not those live file contents.

## Verdict: REQUEST CHANGES for candidate `439394d5`

The production shared-lock source delta is acceptable by inspection for the reported no-staff-person race. The included regression remains bypassable and nondeterministic, so this exact candidate does not yet demonstrate that production creation and erasure serialize correctly. No security review, carrier-wide approval, or merge authorization is implied. A later test-only correction should receive a brief exact-delta review; the unchanged carrier review scope need not be repeated.

### Ordinary B erasure delta

Source evidence file: `carrier-ordinary-b-erasure-delta-luna.md`; SHA-256 `d735b242a91cc9f3e43b3ce90400c18ccba9e2d6d63d9baf50b135b62240115c`. Report bytes follow unchanged.

# Independent ordinary B delta review — #734 project creation / erasure race

**Reviewed candidate:** `439394d5dccfb4507de95ed54eed0f5ac15848b0`
**Delta base:** `5893afeda2a8750a81ccb351b7c70882eaaa5531`
**Original carrier base:** `9bb28099a69d1e599e1d7451ebdf6225e380546c`
**Assigned tier/model selector:** GPT-6 Luna. **Runtime-visible identity:** GPT-6; this context did not expose a more specific Luna/version label, so I do not claim one.
**Independence:** fresh reviewer context; did not author, direct, or remediate this delta. Read-only.
**Scope:** correctness, concurrency, tenant reach, lock order, timeout behavior, and regression-test quality for the 4-file delta only. The prior ordinary B approval at `9ccdeed432c73c3c8d139df3ccd2698713096fd7` stands for unchanged source.

## Delta examined

The exact delta changes four files: adds `apps/api/src/project/project-creation-lock.ts`, routes native project creation through that shared helper, acquires the helper's namespace-1524 advisory lock in account erasure before identity-table locks, and adds one PostgreSQL race regression in `workspace-delete-role-dependents.test.ts`. The diff is 106 insertions and 8 deletions.

The source closes the reported race. The initial customer-access check still runs before acquiring any broad lock, so a refused erasure does not acquire the project lock or identity-table locks. For an erasure that passes, it sets the existing transaction-local 3-second `lock_timeout`, acquires the project-creation lock once for each to-be-deleted workspace in sorted order, then obtains the existing `person`, `membership_grant`, `membership` table locks and reruns the access check before deletion. A customer project inserted by a writer that acquired the anchor first commits before erasure obtains it and is visible to the recheck. If erasure obtains the anchor first, a later project creation cannot insert until erasure finishes. Timeout during either anchor acquisition or table-lock acquisition follows the existing SQLSTATE 55P03 to retryable 409 path; failure aborts the transaction, so the transaction-local timeout and acquired xact locks are released.

I checked the lock-order interaction with creator identity. Native project creation takes the shared anchor before `lockCreatorPerson`; erasure takes the same anchor before the identity-table locks. Thus a creator that can proceed to the person/grant writes already owns the anchor, and erasure waits before taking those table locks. If erasure owns the anchor first, project creation cannot reach those writes. The active-customer-organisation `FOR SHARE` check in `createProjectRow` occurs before the anchor in the current source; it does not create a reverse wait on the erasure path, which does not lock or delete that organisation row. Project creation still depends on the workspace FK if the workspace is removed before it can insert.

The workspace IDs are sorted before multi-workspace locking; native creation takes one workspace anchor, and project reorder uses the same namespace/key. The helper preserves namespace 1524 and the exact `(namespace, hashtext(workspaceId))` key used by existing project-ordering writes. No cross-tenant path was found: every acquisition is keyed by the target workspace, and the access recheck uses the workspace's own served projects and active customer people.

## Regression evidence and residuals

The new PostgreSQL test holds the namespace-1524 lock, inserts a customer-serving project with `createdBy: null`, starts real `deleteAccountData`, then releases the writer and expects erasure to refuse while preserving the workspace and project. The no-staff-person case is relevant because project creation can introduce customer reach without a person/grant write. The author preserved a negative-control patch and reports that removing the erasure anchor makes this test fail because erasure succeeds; the evidence is consistent with the defect path I reviewed.

Two non-blocking test-quality limitations remain. The test duplicates the advisory-lock SQL instead of calling the new shared helper or the project-creation entry point, so it proves erasure serialization against the anchor but would not detect a future removal of the helper call from native creation without source review. It also uses a 500 ms sleep after starting erasure rather than observing that the erasure backend is actually blocked on the advisory lock. The recorded negative control shows it caught the defect in the run performed, but a heavily loaded runner could release the writer before erasure reaches its access check. Existing integration tests in this repository use `pg_stat_activity`/`pg_locks` wait helpers for deterministic lock-race synchronization; using that pattern would make the regression more robust.

No blocking correctness or lock-order finding.

## Commands actually run

- `git rev-parse HEAD`, `git status --short --branch`, `git rev-parse <original base>`.
- `git diff --stat 5893afed..439394d5dccfb4507de95ed54eed0f5ac15848b0` and `git diff --name-status` for the exact delta.
- Read the exact diff, current create-project path, erasure lock/recheck path, workspace role lock ordering, and all namespace-1524 callers found by `rg`.
- Read the private author evidence `erasure-race-repair-luna.md`, `erasure-race-repair.patch`, `erasure-race-repair.files.txt`, and `erasure-race-negative-control.patch`. These are cited as prior evidence, not as tests I ran.
- `git diff --check 5893afed..439394d5dccfb4507de95ed54eed0f5ac15848b0` — passed.
- `pnpm --filter @taskdesk/api typecheck` — passed (exit 0; API TypeScript configs listed in command output).

I did not run PostgreSQL integration, Docker, browser, or broad suites because the conductor reserved the shared runtime window. The author's reported focused PostgreSQL run is 1 file / 27 tests passed, and its negative control is 1 failed / 26 skipped as expected; I did not independently reproduce those runs.

**Verdict: APPROVE** for this bounded delta, with the two test-quality limitations recorded above as non-blocking.

### Ordinary C erasure delta — test blockers retained

Source evidence file: `carrier-ordinary-c-erasure-delta-luna.md`; SHA-256 `f70b9cecf11ec42ea43126c6575d8195bad5851f4038ccf4d55b3e4727050b39`. Report bytes follow unchanged.

# Independent ordinary C delta review — customer-project/account-erasure race

**Candidate:** draft PR #791, Carrier C  
**Reviewed source:** `439394d5dccfb4507de95ed54eed0f5ac15848b0`  
**Comparison base:** `5893afeda2a8750a81ccb351b7c70882eaaa5531`  
**Delta:** four files, +106/-8. Exact changed-file list: `apps/api/src/project/project-creation-lock.ts`, `apps/api/src/project/controllers/create-project.ts`, `apps/api/src/user/controllers/delete-account-data.ts`, `tests/api-integration/workspace-delete-role-dependents.test.ts`.  
**Model route / dispatch provenance:** `gpt-6-luna`, `fork_turns=none` (conductor dispatch metadata).  
**Independence:** fresh context; did not author, direct or remediate.  
**Method:** read-only inspection of the exact base and candidate objects; no source changes.

## Scope and contract checked

Reviewed customer-serving project creation against the #734 erasure contract and project reach rules, including the existing project-creation/order lock, optional creator-person path, erasure's initial refusal and protected recheck, bounded lock timeout, refusal rollback, and sorted workspace lock acquisition. Read the repository testing rule (`docs/04-engineering/testing-strategy.md`, rule 5: “No `sleep()`. Wait for a condition.”) and the corresponding error-fix-loop anti-pattern.

The product-code change is coherent by inspection. Project creation and erasure now share namespace 1524 through one helper. Erasure retains the cheap access refusal before taking new locks, sets the existing three-second local timeout over anchor/table-lock acquisition, locks each target workspace in sorted order, catches lock-unavailable through the existing busy/409 path, restores the prior timeout after successful acquisition, and repeats the access check before invalidation/deletion. A project creator without a staff person can still produce `created_by = NULL`; this is why the erasure guard must cover the project write itself rather than relying only on identity table locks. I found no product-code ordering or timeout defect in this bounded delta.

## Blocking findings

1. **The new concurrency regression uses a prohibited fixed delay and is not deterministic.** In `tests/api-integration/workspace-delete-role-dependents.test.ts`, it starts `deleteAccountData`, waits `setTimeout(500)`, then releases the project writer. The repository explicitly forbids sleeps and says to wait for a condition. This delay does not prove that erasure reached or queued on the advisory lock before the writer is released. Under a slow or heavily loaded runner, the delay can expire before the erasure request progresses; after the writer commits, even a missing erasure lock could see the committed project in its subsequent check and satisfy the expected refusal. The reported one-run negative control is useful evidence, but does not make this scheduling assumption deterministic.

2. **The regression does not exercise the actual project-creation lock call.** Its simulated writer issues the literal `pg_advisory_xact_lock(1524, hashtext(workspaceId))` directly and manually inserts the project. It does not invoke `createProjectRow` or the creation endpoint. Consequently, removing `lockProjectCreation(tx, workspaceId)` from `create-project.ts` would not change what the simulated writer does, and the new test would still exercise the lock because the test itself acquires it. The test covers erasure's side of the handshake but does not guard that the real project-creation path continues to participate in it. The actual current source call is present at `create-project.ts`; this is a regression-coverage gap, not a claim that this candidate currently omits the lock.

## Non-blocking observations

- The test does assert the customer is active, tied to the served organisation, signed in, and has no staff person; it holds the project transaction open across erasure and asserts refusal plus retained workspace/project. Its core scenario and outcome are relevant and non-vacuous for erasure's side.
- The acquired advisory locks are sorted by workspace id. This avoids inconsistent order if the plan includes several workspaces. Existing fast refusal remains before lock acquisition, and the lock timeout is scoped to acquisitions rather than later deletes.
- The author report records an exact PostgreSQL integration run of 1 file/27 tests passing and a negative control of 1 failed/26 skipped, with the intended refusal assertion failing. I inspected that report and the preserved negative-control patch; I did not rerun those PostgreSQL checks because this review had no Docker/PostgreSQL window.

## Commands run and limits

- `git diff --stat`, `git diff --name-status`, `git diff` on the four listed paths, and source inspection at the exact base/candidate SHAs.
- `pnpm --filter @taskdesk/api typecheck` — exit 0; the package script ran its five TypeScript project checks.
- `pnpm exec biome check` on the four changed files — exit 0, 4 files checked.
- No PostgreSQL integration suite, Docker/image, browser, broad suite, or application runtime was run by this reviewer. Author-run PostgreSQL counts above are not represented as my test execution.

## Verdict

**REQUEST CHANGES** for the two regression-test gaps. Product locking behavior is consistent by source inspection, but the concurrency regression must wait on a real condition and cover the actual creation-side participation before this delta clears ordinary review.

### Ordinary A final regression delta

Source evidence file: `carrier-ordinary-a-test-delta-luna.md`; SHA-256 `ed53cb6faf4e3b686c42dffe13b1b51244a146c68f110efc816ef8fbd0193c0e`. Report bytes follow unchanged.

# Carrier C #734 erasure regression test delta — ordinary review A

**Model/provenance:** independent GPT-6 Luna-tier review context, separate from the test author and earlier repair author. Platform dispatch selected `gpt-6-luna`; runtime identity is not independently exposed here.

**Exact source/base:** final reviewed head `7a99905d63a3b52c42aebf4d6e35d1104976696f`; this test-only delta is based on production repair `439394d5dccfb4507de95ed54eed0f5ac15848b0`, which is based on `5893afeda2a8750a81ccb351b7c70882eaaa5531`. Carrier base remains `9bb28099a69d1e599e1d7451ebdf6225e380546c`. The delta changes only `tests/api-integration/workspace-delete-role-dependents.test.ts` (79 insertions, 38 deletions). The two production source commits are unchanged by this test delta.

## Verdict: APPROVE current #734 erasure source/test delta

This closes both blockers from my review of `439394d5`. The regression now calls the real exported `createProject` path with a creator user id that has no `person` row; it no longer manually inserts the project. It takes a separate blocker transaction on the production `lockProjectCreation` helper, then polls PostgreSQL `pg_locks` for a waiter on the exact workspace advisory lock before starting `deleteAccountData`, and waits for two ungranted waiters before releasing. Its bounded condition loop replaces the prior fixed 500 ms sleep and establishes that both production paths are queued before unblocking. The final assertions check that project creation succeeds, account erasure rejects with the “Other people still have access” conflict, and the workspace and project remain.

The PostgreSQL lock identity filter is consistent with the two-integer advisory-lock call in source: namespace/class id 1524, the workspace `hashtext` value as object id, and `objsubid = 2`. The wait predicate uses `count >= expected`, so an additional matching lock waiter would not make the test fail spuriously. A five-second deadline bounds unsuccessful polling, and the `finally` releases and awaits the blocker before observing operation outcomes.

The author’s retained validation report states that both negative controls were applied as temporary mutations and restored: removing the create helper caused the one-waiter timeout, and removing the erasure helper caused the two-waiter timeout. This is relevant detection evidence, not a substitute for my source inspection. The same author report records final PostgreSQL integration execution at 1 file / 27 tests passed, targeted execution at 1 passed / 26 skipped, API typecheck, Biome, and diff checks passing. I did not rerun PostgreSQL, integration, typecheck, browser, Docker, or migration checks; that database test window was held by the author, and my task was read-only.

**What I checked:** inspected `git diff --no-ext-diff --unified=60 439394d5..7a99905d` and exact candidate test/source with `git show`; confirmed the delta path set is only the one integration-test file; confirmed production source is unchanged at the current head; ran `git diff --check 439394d5..7a99905d` (clean); read `takeover/erasure-race-regression-correction-luna.md`, `.patch`, and `.files.txt`. My verdict is bounded to this test-only correction plus the previously reviewed production source delta, not a new full carrier composition review.

The prior implementation finding that remains fixed is the shared namespace-1524/workspace lock in the production project-create and erasure paths, with deterministic erasure lock ordering and guarded access recheck, as reviewed in `carrier-ordinary-a-erasure-delta-luna.md`. No product-wide, security, phase-finalizer, or merge approval is implied by this ordinary review.

### Ordinary C final regression delta

Source evidence file: `carrier-ordinary-c-test-delta-luna.md`; SHA-256 `bdc207cfc9b3b84ebdc1f36bbb701b386090c358ea1883f5c5b682780342f0d1`. Report bytes follow unchanged.

# Independent ordinary C test-delta review — #734 erasure race

**Candidate:** draft PR #791, Carrier C  
**Exact base:** `439394d5dccfb4507de95ed54eed0f5ac15848b0`  
**Exact reviewed head:** `7a99905d63a3b52c42aebf4d6e35d1104976696f`  
**Delta:** `439394d5..7a99905d`, one file: `tests/api-integration/workspace-delete-role-dependents.test.ts` (+79/-38).  
**Model / dispatch metadata:** `gpt-6-luna`, `fork_turns=none` (conductor dispatch metadata; runtime identity exposes no additional version detail).  
**Independence:** fresh review context; did not author, direct or remediate this correction.  
**Worktree:** exact head; `git status --short` clean.

## Review and disposition

This review is limited to the test-only correction. Existing review of the production delta at `439394d5` is reused; no production code changed here.

Both blockers from the prior review are closed:

1. **Fixed-delay synchronization:** the former 500 ms sleep is removed. A helper polls PostgreSQL `pg_locks` for ungranted advisory-lock requests on the exact workspace key, with a five-second deadline. The test waits until the real create path is one waiter and until erasure is a second waiter before releasing its blocker. This follows `docs/04-engineering/testing-strategy.md` rule 5 (“No `sleep()`. Wait for a condition.”) and replaces the scheduling assumption with observed database state.
2. **Synthetic writer bypassed creation path:** the handwritten lock-and-insert transaction is replaced with the exported `createProject` call. The fixture explicitly confirms its creator has no `person` row, preserving the #734 customer-project case. A separate transaction obtains the shared `lockProjectCreation` anchor and stays open until both queued requests are observed. The test then verifies creation fulfills, erasure is rejected with the expected access conflict, and the workspace/project remain.

The two reported negative controls each remove one side of the shared lock handshake and fail at the expected waiter threshold: removing the create-side helper fails waiting for waiter 1; removing the erasure-side loop fails waiting for waiter 2. This is strong non-vacuity evidence. These control runs and the final integration run are from the correction author’s evidence, not runs performed by this reviewer.

One small non-blocking maintenance point: the condition loop issues repeated database queries without a polling interval. A short bounded backoff could reduce query churn on a slow runner, though this does not reintroduce a correctness sleep and is not a blocker. The five-second deadline is explicit and the blocker is released in `finally`.

## Commands and evidence

Reviewer-run, read-only checks:

- `git status --short` — clean.
- `git rev-parse HEAD` — `7a99905d63a3b52c42aebf4d6e35d1104976696f`.
- `git diff --stat 439394d5..7a99905d` — one test file, +79/-38.
- `git diff --check 439394d5..7a99905d` — pass.
- Inspected exact diff and test source, plus `docs/04-engineering/testing-strategy.md` rule 5.

Author-reported validation, separately attributed (from `erasure-race-regression-correction-luna.md`): final integration test **1 file / 27 tests passed** on isolated CI Testcontainers PostgreSQL; each negative control **1 failed / 26 skipped** at the intended lock-wait assertion; targeted positive test, Biome, API typecheck (five project checks), and diff checks pass.

I did not rerun integration/PostgreSQL, Docker/image, browser, typecheck, or broader suites. Production behavior review is reused from the prior exact product candidate, not repeated here.

## Verdict

**APPROVE DELTA.** Both previously identified test blockers are closed by this bounded test-only correction. No new blocking finding in the delta. Full-candidate acceptance still depends on the other required review and CI gates.

### Independent Sol final source review

Source evidence file: `carrier-security-delta-sol.md`; SHA-256 `2a088308f97b47aa98ff5dbab8c59be65f1d5e0078840881fca540e0ccd318e9`. Report bytes follow unchanged.

# Independent Sol-tier security review — Carrier C final source and #734 repair

**Verdict: APPROVE security review** for the exact local candidate source `7a99905d63a3b52c42aebf4d6e35d1104976696f`. This closes blocker S1 from `carrier-security-sol.md` by source inspection plus the separately run regression and negative-control evidence described below. It is not an approval of remaining CI, browser, review-publication, or merge gates.

**Candidate:** draft PR #791, local branch `codex/carrier-2026-10-15-c`.
**Exact reviewed head:** `7a99905d63a3b52c42aebf4d6e35d1104976696f`.
**Original carrier base:** `9bb28099a69d1e599e1d7451ebdf6225e380546c`.
**Current live-main comparison:** `a07df324` differs from the original base only in `docs/07-planning/status.md` and `docs/07-planning/integration-execution-queue.md`; no product source changed on main between those points. The candidate still descends from the original base.
**Security delta:** `5893afeda2a8750a81ccb351b7c70882eaaa5531..7a99905d63a3b52c42aebf4d6e35d1104976696f`, with production repair at `439394d5dccfb4507de95ed54eed0f5ac15848b0` and test-only correction at `7a99905d`. Changed paths: `apps/api/src/project/controllers/create-project.ts`, `apps/api/src/project/project-creation-lock.ts`, `apps/api/src/user/controllers/delete-account-data.ts`, and `tests/api-integration/workspace-delete-role-dependents.test.ts`.
**Model / context:** Platform dispatch selected `gpt-6-sol`, `fork_turns=none`; the runtime label exposed to this reviewer is generic GPT-6 with no independently exposed Sol/version suffix. This security reviewer remains independent of the candidate author and repair contexts; it is the same reviewer context that recorded the original S1 finding. I did not author, direct, design, remediate, or merge the candidate.

## S1 disposition — closed at this head

The original S1 path was customer-project creation after erasure's final access query. A customer-serving project grants customer reach without requiring an identity-table write when the creator has no staff `person` row, so the prior identity-table lock did not serialize it.

The repair shares the already-existing project ordering advisory key `(1524, hashtext(workspaceId))` through `lockProjectCreation`. The native `createProjectRow` transaction takes this lock before looking up its optional creator person and before inserting the project. An erasure that plans to delete a workspace first runs its cheap access refusal, then takes this same workspace lock (sorted by workspace id if several), then locks `person`, `membership_grant`, and `membership`, and then repeats the access query before credential invalidation or deletion. A creator that wins the shared lock commits the customer project before erasure's protected recheck, which then sees the customer's reach and refuses with 409. If erasure wins, creation cannot insert while erasure holds the lock; the deleted workspace cannot become a new project's valid FK target afterward. The creator's no-person path participates because its lock precedes the optional person lookup. The same transaction-local three-second `lock_timeout` covers both advisory and table-lock acquisition; SQLSTATE 55P03 maps to the existing retryable 409, and a thrown refusal rolls back all prior transactional work. The previous `person -> membership_grant -> membership` table-lock order is retained after the project anchor. I found no reversed lock order with project creation or reorder in the inspected call sites.

The final integration regression exercises the real exported `createProject` with an explicitly unprovisioned creator, while an independent transaction holds the shared anchor. It polls PostgreSQL `pg_locks` for one ungranted waiter from creation, starts real `deleteAccountData`, then observes two ungranted waiters on the exact `(1524, hashtext(workspaceId))` key before releasing. It asserts creation succeeds, erasure refuses for other access, and both workspace and project remain. This closes the earlier ordinary-review objections that the initial regression used a synthetic insert and a fixed delay. The author's preserved report records a final **1-file/27-test passing PostgreSQL integration run** and two temporary negative controls, each **1 failed/26 skipped** at the expected waiter threshold when one production anchor was removed. I inspected the final source, test and ordinary A/B/C delta reports; these database runs are attributed to the author, not claimed as my own execution.

## Current-head composition security audit

I rechecked that the carrier contains no further security change outside the four-path delta and assessed the unchanged composed paths against the original `5893afed` security review and current source. The Intake accept claim and conversion remain in one transaction; claim and accepted audit order is preserved, and a failed conversion rolls back the claim. Destination selection checks workspace, organisation and caller project reach, while the skipped default-assignee reason is audit metadata, not a new grant. No finding reopened there.

Identity connection and SCIM administration still bind a fresh step-up proof to each operation/body/version and send the proof in a header. Client-secret drafts are cleared after the write, and a newly rotated SCIM bearer is displayed in component state only once; mutation results exclude that bearer. Current server authority and CAS remain decisive if the UI is stale. The instance-admin signal and saved-view/work-list URL state gate presentation and search inputs, not authority. Saved-view URL execution uses the current viewer's work-item search boundary and project clause. I found no new path for cross-tenant reach, IdP claims, token display, or URL state to grant authority in the combined source.

The carrier contains no fix for separate `#783`/`#784` API-key work; no such completion is claimed. The earlier GitGuardian incident 38240567 still points at `password: "never-in-url"` in `apps/web/src/lib/routes.test.ts`, a negative URL-parser fixture that verifies password/token query keys are discarded. It is not a credential; an external failing required status still needs its own disposition and cannot be waived by this report.

**Blocking findings at `7a99905d`: none in this security-review scope.** Residual operational limits are the exact-head remote checks, independent report publication, and full combined acceptance gates. At initial live read during this pass, PR #791 still pointed to the older `9ccdeed432c73c3c8d139df3ccd2698713096fd7`; its check rollup is not evidence for this reviewed head.

## Reviewer-run evidence and limits

- `git status --short --branch` and `git rev-parse HEAD`: clean local worktree at the exact reviewed head, three commits ahead of remote at initial read.
- `git show --stat 5893afed..7a99905d`, `git diff` for the production and test deltas, and `git diff --check 9bb28099... 7a99905d...`: four changed delta paths; whitespace check passed.
- `git diff --name-only 9bb28099... a07df324`: only queue and status records changed on main. `git merge-base --is-ancestor 9bb28099... 7a99905d...`: passed.
- `rg`, `sed`, and exact-source inspection of the project creation/reorder lock callers, erasure lock/recheck, concurrent regression, Intake claim/audit, identity/SCIM secret and step-up handling, saved-view/work-item search, decision log #734, and ordinary A/B/C repair and final-test reports.
- `pnpm --filter @taskdesk/api typecheck`: completed successfully, all five configured TypeScript project checks. `git diff --check` passed.
- The prior independent security pass at `5893afed` ran **4 web test files/69 tests** and **1 API unit file/13 tests**, all passing at that earlier source. This pass did not rerun or relabel them as tests on `7a99905d`.

I did not run PostgreSQL integration, Docker/image, browser/Playwright, or the full CI matrix in this reviewer window. The author's final PostgreSQL count and negative controls, and the conductor's reported image/runtime and visual checks, remain separately attributed evidence; I did not reproduce them. This report approves the security source at the exact local head only. It does not say the remote PR is merge-ready while its head or required checks differ.

## Final binding

**Reviewed head:** `7a99905d63a3b52c42aebf4d6e35d1104976696f`

The final independent Sol report above approves this exact source and closes S1. Only this PR’s additive review-record publication may follow under the per-commit review-record rule. All current required checks and normal protection remain mandatory.

## Strict current-main composition — additive authentic delta records

Protected main requires the candidate to include its latest head. Automatic merge `d8fc639f7cb276cc35f54c51c94d3215560412fb` imports accepted #792 records from `a07df324`; only status/queue change relative to the preceding carrier. Product/test/build/dependency/gate inputs remain identical to independently approved `7a99905d`. No additional main merge will be made while final carrier checks run. Earlier remote CI attempts remain source-labelled, including normal concurrency cancellations.

### carrier-records-main-composition-luna.md

SHA-256 `bf60652e4f29cffe2e374d4845960864a1c31344ac035da19982998d6e9bbab4`; authentic report bytes follow unchanged.

# Carrier C current-main composition review

**Model/provenance:** independent GPT-6 Luna-tier composition review. Platform dispatch selected `gpt-6-luna`; runtime identity is not independently exposed here. This is a narrow parent/tree compatibility review; it is not a repeated product review, a security review, or merge authorization.

**Exact candidate:** merge commit `d8fc639f7cb276cc35f54c51c94d3215560412fb`, with parents `3ee463ff18cf2c122242d1e68c32c5aae1708a40` (Carrier C at `7a99905d63a3b52c42aebf4d6e35d1104976696f` plus the published carrier review record) and `a07df32424185559a079002144f91df17d004798` (merged records PR #792, parent `9bb28099a69d1e599e1d7451ebdf6225e380546c`). Live `origin/main` is `a07df324...`; `gh pr view 792` reports merged at `2026-10-15T15:06:33Z`. Live PR #791 remains open and still points at `3ee463ff...`; the reviewed composition commit is local/unpushed at review time.

## Verdict: APPROVE this current-main composition delta

The records parent adds only 55 lines to `docs/07-planning/status.md` and `docs/07-planning/integration-execution-queue.md` relative to the original base. The merge tree differs from the Carrier C review-record parent by exactly those two files (+55 lines). No shipping source, tests, dependencies, configuration, gate inputs, or component manifests changed when bringing current main into the reviewed carrier. The review note already present in the carrier parent is retained unchanged.

I independently checked the exact two-parent commit and its composition. `git merge-tree --write-tree 3ee463ff a07df324` returned tree `c71d2978ee9e07dcc501d3ebebdaaf026b37c441`, identical to `d8fc639f^{tree}`; there are no conflicts. The merge commit preserves both exact parents. The imported main history from `9bb28099` to `a07df324` is limited to the same two records files. The local carrier branch is clean at `d8fc639f`.

Prior-review reuse is authentic and bound to the reviewed product source. The published `docs/07-planning/security-reviews/791-carrier-c.md` contains the initial A/B/C reviews, the visual repair and delta reviews, the #734 production and test-delta review records, and the final independent Sol security report. It preserves the original A and C visual-fixture requests for changes, their exact repair deltas, the later A test-gap request, and the test-only closure at `7a99905d`; it does not erase the history of findings. I computed SHA-256 for the retained source evidence reports and matched every listed digest for A/B/C initial reports, the A/C visual deltas, original Sol S1 report, A/B/C erasure deltas, A/C erasure test deltas, and final Sol delta report. The published text also records each exact reviewed SHA, scope, verdict, model/dispatch provenance, and test attribution. My own ordinary A test-delta report at `7a99905d` is included with its exact matching digest `ed53cb6f...0193c0e`; the final Sol report is likewise preserved with matching digest.

This composition reuses prior approvals only for exact source `7a99905d`; the merge changes no product/test source after that point. The newer current-main commit contributes records only, which resolves the strict required-status-check base freshness concern without reopening the feature/security review. It does not make stale PR #791 checks current: the PR head is still `3ee463ff` on live GitHub and the composed `d8fc639f` head must be published and all required checks rerun on its exact SHA. No CI, build, browser, PostgreSQL, or Docker check was run in this composition review.

**Commands/checks:** `git show -s` for candidate and both parents; `git ls-remote origin refs/heads/main`; `gh pr view 792` and `gh pr view 791`; `git diff --name-status 9bb28099..a07df324`, `7a99905d..d8fc639f`, and `3ee463ff..d8fc639f`; `git merge-tree --write-tree 3ee463ff a07df324`; `git diff --check 3ee463ff..d8fc639f`; SHA-256 comparison of retained prior ordinary/Sol reports against their published review-record digests. The product-source comparison was not rerun because it is unchanged from the already-reviewed exact `7a99905d` head.

**Limits:** this approves only the records-only current-main composition at exact local merge commit `d8fc639f`. Live #791 still points at its pre-composition head, current exact-head checks are outstanding, and the repository's protected merge gates remain mandatory. This is not approval to merge or a substitute for final exact-head CI/security evidence.

### carrier-security-records-main-delta-sol.md

SHA-256 `027391ef04e26e0d6866e823136879cf605479bd980e112c79c9addce8aa453e`; authentic report bytes follow unchanged.

# Independent Sol-tier confirmation — Carrier C accepted-main records composition

**Verdict: APPROVE lightweight security confirmation** for exact local head `d8fc639f7cb276cc35f54c51c94d3215560412fb`. The approved Carrier C product and test source at `7a99905d63a3b52c42aebf4d6e35d1104976696f` is unchanged. This is a records/main-composition confirmation; the full source security approval and S1 closure remain in the preserved `carrier-security-delta-sol.md` report at their original reviewed head. No new authority or gate pass/fail semantics were introduced.

**Head and parents:** `d8fc639f7cb276cc35f54c51c94d3215560412fb` is a merge of first parent `3ee463ff18cf2c122242d1e68c32c5aae1708a40` (Carrier C's authentic review-note publication over approved `7a99905d`) and second parent `a07df32424185559a079002144f91df17d004798` (accepted main records checkpoint). The carrier's original product base was `9bb28099a69d1e599e1d7451ebdf6225e380546c`.

**Model / independence:** Platform dispatch selected `gpt-6-sol`, `fork_turns=none`; runtime-visible identity is generic GPT-6 with no Sol/version suffix exposed. I am the same independent security-review context that identified S1 and approved its repaired source; I did not author, direct, design, remediate, or merge this candidate. I inspected immutable commit/diff evidence and made no candidate edit.

## Delta and evidence disposition

- Against the merge's **first parent** `3ee463ff`, the merge adds only 27 lines to `docs/07-planning/integration-execution-queue.md` and 28 lines to `docs/07-planning/status.md`. There are no conflicts or deletions in that delta. These are dated takeover checkpoints describing task state, earlier review findings, evidence and next actions. They do not set a new mission, decision, capability, route policy, review tier, waiver, security model, check algorithm, or gate exception. They are not consumed as pass/fail input by the checked CI scripts. The explicit references to S1, older CI, image and GitGuardian are labelled historical snapshots, not current-head approvals.
- Against the previously approved `7a99905d`, the full tree difference also includes `docs/07-planning/security-reviews/791-carrier-c.md`, added by the preceding `3ee463ff` note-publication commit. That file publishes the initial adverse and final approving Sol reports, preserving earlier ordinary adverse and clearance reports. I byte-compared both Sol sections in the committed note with their restricted evidence originals; each matched exactly, and the note's recorded SHA-256 values match those originals. It ends with `**Reviewed head:**` for `7a99905d`, accurately binding that earlier source review. It does not forge an approval of `d8fc639f`.
- `git diff --quiet 7a99905d d8fc639f` over application, packages, tests, build/dependency files, CI/control paths, feature/architecture/engineering/operations contracts and decision log returned zero (identical). The accepted-main advance from `9bb28099` to `a07df324` likewise changes only status and queue. Thus the earlier security review's code/contract inputs are unchanged and its S1 closure remains valid for this composition. No new full review of unchanged product source is needed.
- Review-record publication and accepted records still change the commit graph: the prior `7a99905d` binding alone does not claim that required current-head checks pass. A separate authentic note line for `d8fc639f` may record this confirmation; required GitHub statuses must run and pass on the final exact pushed head under strict main protection. This report grants no gate waiver or merge authority.

**Blocking security findings:** none for this records/main delta. `#783`/`#784` remain separate API-key work and are not claimed fixed. GitGuardian incident 38240567 remains the negative URL-parser fixture `never-in-url`; this report does not dispose of its external machine status.

## Commands and limits

- `git status --short --branch`, `git rev-parse HEAD`, `git show --no-patch --format='%H %P %s' HEAD`, and `git show --format= --name-status 3ee463ff`: confirmed the clean worktree, exact merge parents, and one-file review-record publication.
- `git diff --name-status`, `--numstat`, and source inspection for `3ee463ff..d8fc639f`: two records files, +55/-0; `git diff --check` for this first-parent merge delta passed.
- `git diff --name-status 7a99905d..d8fc639f`: the same two records plus the one review note. `git diff --check` on this wider range reported trailing spaces in the added review note's Markdown hard-break lines; this is inherited verbatim review text, not a security finding or new merge conflict. No source change was made to normalize those bytes.
- `git diff --name-only 9bb28099..a07df324`: status and queue only. `rg` of CI scripts confirmed status references are explanatory/test fixtures, with `status.md` explicitly listed as a path that must not require a routine security review.
- Independently extracted both published Sol sections from `791-carrier-c.md` and compared them byte for byte to `carrier-security-sol.md` and `carrier-security-delta-sol.md`: both equal; their recorded SHA-256 digests matched.

No tests, PostgreSQL, browser, Docker, or remote CI were run for this records-only merge confirmation. Existing test/image/browser results remain bound to their documented source heads. The GitHub PR head/status check must be read again after the planned additive note and push; this report does not assert remote merge readiness.

**Reviewed head:** `d8fc639f7cb276cc35f54c51c94d3215560412fb`

The independent ordinary composition review and Sol confirmation approve that exact automatic merge. Publication after it is restricted to this PR’s additive authentic own review records; every required GitHub status must be green on the actual final publication commit.
