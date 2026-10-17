# Activity, relations, time entries and preference query recovery — #580

Current composition source `8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe` against accepted main `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`: 40 owned source/test paths. The full security pass covers all40 at d7f628fa89cedc25d610f93c5bd49ce6ae9c2df9; all owned mode/blob entries are conserved. Three independent ordinary contexts retain their full/delta coverage, including the deterministic activity-order fixture repair. The current accepted-main composition has separate ordinary and independent Sol confirmations. Its final 55bc-to-8a merge is metadata-only, with unchanged tree d89adff97b4617f461c1f532fe6ee8c735e7c2da. This note transports authentic reports verbatim; author reports, root preflight and critical design advice are not independent approval.

Scope: identity-scoped activity/comment/relation/time-entry/preference/storage repositories and real callers, admitted-result checks, complete INSERTSELECT schema/default/codec behavior, and required existing history insertion in the same producer transaction before effects. Seven former duplicate postcommit history listeners are removed without removing their other effects. No route, capability, schema, migration or general internal-producer exception is introduced. Five inherited legacy task lock-helper bodies remain outside this conversion claim.

Root source-bound verification: at880f, four focused PostgreSQL files61/61/native0/22.375s (raw44009bytes SHA256c806fb38051bbdea18ae8ab9bab6d05fb6fc3ddc9fee1f9f1eac5cdbbd1b89bb); atd7f, activity CRUD1file10/10/native0/7.756s (raw9945bytes SHAc502cf8759e11986fc603e16e70e0dce92a8ac63f954f48cf617deafb4e338cb). Owned cleanup returned23containers109volumes7networks unchanged. Earlier99/102 and122/124 failures and ordinary blockers remain below. These are not current full-hosted/runtime/image/browser results. All current exact-publication required checks, shipping-image proof and applicable runtime evidence remain mandatory.

Residuals: external object deletion and database metadata/rollback are not a cross-system atomic operation; this is not a new recovery guarantee. Original #773 and its source remain preserved. No whole#580, phase, signed-release or SIT acceptance is claimed.

Dispatch provenance: root explicitly selected GPT-6 Luna for implementation/ordinary contexts and GPT-6.1 Sol (`fork_turns=none`, high reasoning) for full/current security contexts. A verified served-model/runtime fingerprint is unavailable; original reports retain their actual limitations. Root composed/published and is not an independent reviewer. Every blocked/adverse/corrective review below remains at its actual scope. The composition Sol lane's earlier usage-limit attempt produced no approval; its resumed completed report is retained.

## Evidence file

`query773-existing-source-current-main-recovery-plan-luna.md`

# PR #773 remaining #580 source recovery plan

**Purpose:** bounded, read-only source map and proposed authoring sequence for the remaining portion of selected #580 original PR #773. This is planning evidence, not approval, implementation, review clearance, or merge readiness.

## Source and state verified

- Live GitHub `main` and the accepted base supplied for this handoff both resolve to `c022915a8768b96b460c798feafafd7d48214d5c`.
- Original PR #773 remains open, branch `codex/query-ownership-580-b3`, exact head `b289a288a85114e69ddfb5c9941203ede294fc22`. GitHub currently reports no review decision and no submitted reviews. Its PR-template/security check is failed; other status checks include successful runs, but this is not a gate assessment.
- Current #809 is open on `codex/query-ownership-580-b9-current`, exact head `5511e680c4b2990adcdf37563bd2c7df67119462`, based on accepted `main`. Its review record is an automated Codex comment on stale `8b99d2f6b7b3cefaafb7e5a7e91e390dfa39eecc`, with findings; it is not independent clearance for current #809 or #773.
- The retained #773 source worktree is at `b289a288`; #809 worktree is at `5511e680`. Both are clean at inspection. The primary checkout is dirty and stale; it was not modified. The repository’s evidence reports and decision/status snapshot place #580 in the continuing integration-freeze train, with no broad replacement carrier and no `check:queries` activation until remaining conversions and the structural checker are accepted.
- The 28-path historical #773 diff contains the Executor and documentation tranche already accepted on `main`. The remaining delta relative to accepted `main` is exactly these 22 paths, so only these are in the proposed recovery scope:

```text
apps/api/src/activity/controllers/create-activity.ts
apps/api/src/activity/controllers/create-comment.ts
apps/api/src/activity/controllers/delete-comment.ts
apps/api/src/activity/controllers/get-activities.ts
apps/api/src/activity/controllers/update-comment.ts
apps/api/src/activity/repository.ts
apps/api/src/storage/cleanup-assets.ts
apps/api/src/storage/repository.ts
apps/api/src/task-relation/controllers/create-task-relation.ts
apps/api/src/task-relation/controllers/delete-task-relation.ts
apps/api/src/task-relation/controllers/get-task-relations.ts
apps/api/src/task-relation/index.ts
apps/api/src/task-relation/repository.ts
apps/api/src/time-entry/controllers/create-time-entry.ts
apps/api/src/time-entry/controllers/get-time-entries.ts
apps/api/src/time-entry/controllers/get-time-entry.ts
apps/api/src/time-entry/controllers/update-time-entry.ts
apps/api/src/time-entry/repository.ts
apps/api/src/user-preference/repository.ts
apps/api/src/user-preference/service.ts
tests/api-integration/activity-relation-time-entry-crud.test.ts
tests/api-integration/storage-cleanup-assets.test.ts
```

Do not replay `apps/api/src/database/executor.ts`, `tests/api/database-executor.test.ts`, `tests/api-integration/database-executor.test.ts`, or the already accepted coding-standards / multi-tenancy / monorepo-layout edits from #773.

## Governing contracts and specification status

Accepted `docs/04-engineering/coding-standards.md` § Query ownership (#580) is controlling: named repository modules own statements; service transaction orchestration remains allowed; every statement inside a transaction uses a repository function with the passed Executor; repository functions return awaited results; SQL fragments stay in repository modules. For queries that can return cross-organisation data, pass the **resolved identity** and apply reach in the SQL predicate; extra workspace/project IDs narrow that reach and also appear in the predicate. Query location alone does not establish reach. There is no blanket exception for internal producers.

Accepted `docs/01-architecture/multi-tenancy.md` § Query scoping and `security-model.md` §5 reiterate the same identity/reach requirement and the 404 concealment rule. The Executor convention is `executor` first when required, optional last when a method supports both transactional and shared execution. Do not introduce a new fluent/phantom scoped API or assume one exists.

Relevant specs are `docs/03-features/comments-and-activity.md` (CA-6, CA-7, CA-10, CA-17, CA-18; comment owner is `author_id`; update/delete effects), `relations-and-hierarchy.md` (RH-1–4 and permissions on both relation ends), and `time-and-cost.md` (TC-1–5). Their owning “Open questions” sections are empty. They define product behavior, not an exception to the accepted SQL reach rule. No product-semantic gap requiring a new decision was found in this bounded source map. Where an implementation detail is absent, preserve existing behavior and ask the spec owner before expanding behavior.

## Path and function recovery map

| Path(s) and functions | Existing behavior to conserve | Current-main/query-ownership work needed |
| --- | --- | --- |
| `activity/repository.ts`: `insertTaskActivity`, `insertCommentActivity`, `findProjectWorkspaceId`, `findUserName`, `findOwnComment`, `deleteOwnComment`, `updateOwnCommentContent`, `listTaskActivitiesNewestFirst`; five activity controllers | Comment owner/window predicates and visibility remain; comment create persists activity in a transaction with task lock, then publishes `comment.created` and creates notifications after commit. Edit/delete publish their event after commit. Activity listing retains order and visibility projection. | Keep all SQL in this module; pass the current resolved identity for actor-facing task/comment lookups and enforce current task/project reach in the statement. For writes, retain person/author ownership and existing route capability checks as separate controls. Verify required insert/update/delete result rows before treating a write as admitted or publishing an effect. Preserve the transaction boundary and after-commit effect order. |
| `task-relation/repository.ts`: `findTaskReachRow`, `findRelationEndpoints`, `findTaskInWorkspace`, `listProjectWorkspaces`, `findRelationBetween`, `insertTaskRelation`, `deleteTaskRelationById`, `listRelationsOfTask`, `listTaskSummariesInWorkspace`; three controllers plus `task-relation/index.ts` | Relation stored once; duplicate detection; endpoint locks in deterministic order; project live checks; two-end update authority; hidden/unreachable related task omission; publish create/delete effects only after transaction success. | Make source, target, relation endpoints and related-task summary statements use the already resolved identity and current persisted reach predicates in SQL. Keep 404/hidden-row behavior and RH both-end authority. Verify relation DML result before returning success or publishing. Do not rely solely on preflight `canReachTarget` or caller-side middleware for repository reach. |
| `time-entry/repository.ts`: `insertTimeEntry`, `updateTimeEntryById`, `findTimeEntryById`, `listTimeEntriesWithUserByTask`; four controllers | Existing owner / `read_any` policy and route decisions; task lock and live-project check; create event after successful commit; update transaction and returned response. Date/minutes/activity/billable fields remain as currently validated. | Use resolved identity/current reach for actor-facing entry/list reads and task context in SQL, preserving ownership policy separately. In create/update, use transaction Executor and ensure a missing/refused required mutation result cannot become success; keep `time-entry.created` after commit only. No new TC behavior or timer/cost scope. |
| `user-preference/repository.ts`: `listLiveProjectReachFacts`, `listOwnSettingRows`, `lockOwnSettingsWrites`, `deleteOwnSettingRow`, `listOwnSettingAddresses`, `upsertOwnSettingRow`; `user-preference/service.ts`: `resolveCaller`, `reachableProjectIds`, `readSettings`, `getOwnSettings`, `patchOwnSettings` | Own-person settings only; session identity; stale project layouts stay inert; writes to a layout require project reach; lock and all deletes/upserts remain in one transaction; settings count/size limits stay in force. | Keep person ownership in the SQL predicates and use the resolved identity for project-scoped reach queries, with the canonical current SQL reach predicates rather than an app-only reach check after broad project reads. Retain per-person lock, transaction ordering, and “no write on unreachable layout” behavior. Verify delete/upsert results where the service currently treats them as required. |
| `storage/repository.ts` and `storage/cleanup-assets.ts`: `findTaskDescriptionLike`, `listTaskCommentContentsLike`, `listTaskActivityContentsLike`, `listTaskAssetsByIds`, `deleteAssetsByIds`, `listTaskAssetObjectKeys`, plus `getTaskAssetKeys`, `deleteOrphanedAssets` | Asset reference scan spans task description, comments and activity; cleanup checks references before deleting object keys/rows; object-key reads accept optional Executor; external storage deletion ordering and error handling remain. | Keep SQL under the storage repository and all reference queries scoped to the intended task/asset rows; thread the existing executor where already supported. Confirm actual caller identity and persisted task reach before deciding how actor-originated cleanup meets the identity predicate. Do not invent an “internal cleanup” blanket exception or alter S3/reference deletion semantics. |
| `tests/api-integration/activity-relation-time-entry-crud.test.ts`, `tests/api-integration/storage-cleanup-assets.test.ts` | Existing positive and negative endpoint CRUD, duplicate relation, relationship reach/visibility, time-entry policy, comment lifecycle/effects, scoped asset reference cleanup. | Recover these tests and add focused repository/result/revocation assertions only where needed to prove identity-bound SQL admission and effect ordering. Keep coverage meaningful: real Postgres statements and persisted cross-scope data, not tests that merely mirror function delegation. Existing focused files are the right starting point; no new broad suite is indicated by this map. |

### Shared task-lock seam that must be explicit in the plan

At accepted `main`, `apps/api/src/task/assert-task-project-live.ts` still owns five inline legacy query helpers used across modules: `lockLegacyTaskRowIfPresent`, `lockLegacyTaskRow`, `lockTaskAndAssertProjectLive`, `lockProjectsAndAssertLive`, and `lockProjectAndAssertLiveForTaskNumber`. #809’s exact-head review packet identifies these five bodies as inherited, unchanged from its base, and owned by #773; its scope notes the activity/time-entry/relation producer paths still consume the shared inline task-lock helpers. The #773 activity/time/relation controllers call `lockTaskAndAssertProjectLive`; relation create/delete also call `lockLegacyTaskRow` and `lockProjectsAndAssertLive`. Task routes also consume the helpers, so moving them wholesale risks editing or changing #809-owned task paths.

**Narrow boundary recommendation:** in the future #773 authoring lane, define task-repository-owned equivalents for only the cross-module lock/context operations needed by the #773 callers, delegating to the canonical identity-scoped task repository predicates and preserving lock modes/order and live-project checks. Change only the #773-owned consumers listed above. Leave the legacy helper bodies and all #809 task call sites untouched in that candidate. Do not add a blanket exception, invent a new membership/effect rule, or treat caller preflight as current SQL reach. If one shared-helper cleanup is later needed, give it a separately scoped ownership decision after #809 is accepted; it is not a dependency for replaying the 22-path slice.

The five-function list is not a claim that every function requires migration for these consumers: recover only reachable cross-module operations and retain any function still needed by task-owned routes. Do not relocate functions solely to satisfy a file-location checker if that would weaken authority or create overlapping ownership.

## Source-authentic review and runtime evidence

- **Found:** GitHub confirms #773 exact head `b289a288…` and zero reviews. Thus no authentic independent review of the remaining #773 source at its exact head was found. The PR’s current review decision is empty; a failed PR-template/security check is not review evidence.
- **Found but not applicable:** #809 has a Codex automated review comment on `8b99d2f…`, explicitly with unresolved findings. This is stale relative to `5511e680…`, is not an independent GPT-6 Luna review receipt, and covers #809’s task paths rather than #773’s 22 paths.
- **Found, bounded to other scope:** #809’s retained security-review document says its fresh Sol pass clears the task candidate and specifically leaves the five shared legacy helpers with #773 ownership. It does not clear #773’s changes. Its focused PG result (10 files / 165 tests) is evidence for #809’s exact source and named task/reach regressions only; it does not validate #773.
- **Not found:** any exact-head #773 ordinary review, Sol review, #773-specific PostgreSQL result, or accepted-main composition review. Do not transfer historical green checks/results from other batches.

## Proposed bounded authoring sequence

1. Start from the then-current accepted `main`, after confirming the #809 dependency has landed or explicitly rebasing the plan to its current accepted-main equivalent. Do not author concurrently with #809 in shared task files.
2. Reconcile the 22-path diff against accepted main path by path; replay only the unaccepted runtime/test behavior above. Exclude the already accepted Executor/docs files and preserve the existing 22-path ownership boundary.
3. Before implementation, map each affected caller’s resolved identity source, route policy, existing reach check, query predicate, transaction owner, required mutation result, and post-commit effect. Reuse the task repository’s accepted identity-aware predicates or other canonical predicate helpers; no new generic helper/framework without a concrete need.
4. Extract only the minimal task-lock/context boundary needed by activity, relation and time-entry into the task repository and update those consumers. Preserve stable task/project lock order, existing transaction isolation and error/404 shapes. Keep identity checks, capability checks, owner checks and resource reach distinct.
5. Move/recover each query into its named repository. Keep transaction opening in the same service/controller; route every in-transaction statement through that transaction’s Executor. Return awaited rows/scalars and check required write results before a successful response or side effect.
6. Reconcile the two existing focused PostgreSQL files with source changes: assert both permitted and refused current persisted reach; verify no-write on refusal; verify effects occur only after committed admitted writes; preserve relation hidden-count/omission and cleanup ordering. Add no speculative feature tests.
7. Once a concrete candidate exists, perform the ordinary review tier required by the actual coupling (likely three independent Luna contexts because this crosses several API modules and contracts), then a fresh independent Sol security review because these files include authorization/reach boundaries. Run exact-head applicable checks and browser/runtime evidence only in the authorized implementation/acceptance stage. Recompute review applicability at the actual changed paths and exact SHA.

This plan does not authorize source edits, tests, PR creation, ref changes, commits, pushes, merges, checker activation, or broader #580 work. It does not claim that the recovery is complete or that the PR is approved.

## Inspection limits

Read-only inspection only: required repository guides, accepted contracts/specs, git source/diffs, worktree status, and live PR metadata/review records. No tests, PostgreSQL, Docker, browser, build, compiler, heavy inventory, source/worktree mutation, Git ref mutation, or GitHub mutation were performed. Requested GPT-6 Luna service fingerprint was unavailable to inspect; the runtime/model identity is not asserted beyond the session’s available model label.


## Evidence file

`query773-current-main-author-luna.md`

# #773 current-main recovery author report

Status: bounded author implementation committed; not approval, review, merge, or completion of the whole #773 source tranche.

## Candidate and provenance

- Worktree: `/Users/heinthura/.codex/worktrees/query773-current-luna`
- Branch: `codex/773-current-main-luna`
- Parent accepted-main SHA: `c022915a8768b96b460c798feafafd7d48214d5c`
- Commit: `85af21e2101109069be6182adb694f6006d778f1`
- The original clean source worktree `/Users/heinthura/.codex/worktrees/q580-b3/Ticketing.v2` at `b289a288a85114e69ddfb5c9941203ede294fc22` was preserved. No edits were made to it, the primary checkout, `main`, or #809.
- Initial #773 PR head was verified as `b289a288a85114e69ddfb5c9941203ede294fc22`; no authentic reviews were present on #773 when checked. The historical Codex autocomment was not counted as review. No review of this new candidate has been obtained.
- The plan artifact remains separate and is still planning, not approval: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query773-existing-source-current-main-recovery-plan-luna.md`.

## Source changed

Selected activity controller/repository recovery: `apps/api/src/activity/controllers/{create-activity,create-comment,delete-comment,get-activities,update-comment}.ts` and `apps/api/src/activity/repository.ts`. Activity reads and DML use `ResolvedIdentity` and current persisted project reach; writes use task-then-project locking, result checks, and the existing post-commit event/notification order. Public routes pass identity from the accepted request-identity adapter.

Selected task-relation recovery: `apps/api/src/task-relation/{repository.ts,index.ts,controllers/create-task-relation.ts,controllers/delete-task-relation.ts,controllers/get-task-relations.ts}`. Current reach scopes reads and DML; relation creation rechecks both live/reachable endpoints under stable task-then-project lock ordering, uses target-column parameter encoding for INSERT…SELECT, guards returned rows, and retains post-commit event publication and existing duplicate/self/hidden-endpoint behavior.

Selected time-entry recovery: `apps/api/src/time-entry/{repository.ts,index.ts,controllers/create-time-entry.ts,controllers/get-time-entries.ts,controllers/get-time-entry.ts,controllers/update-time-entry.ts}`. Reads and writes use current reach predicates, writes lock task then live project, INSERT…SELECT uses target-column encoders and checks the returned row, duration validation remains inside the write transaction, and creation effects remain after commit.

Selected preference recovery: `apps/api/src/user-preference/{repository.ts,service.ts}`. Own-row ownership, validation, clearing, per-person advisory locking, row limits, and inert stale layouts remain. Project reach is checked through persisted current identity scope in reads/upserts, using full target-column JSONB/date encoders and a returned-row guard.

Four minimal request identity caller prerequisites were authorized and included: `apps/api/src/activity/index.ts`, `apps/api/src/comment/index.ts`, `apps/api/src/time-entry/index.ts`, and `apps/api/src/user-preference/index.ts`. Each uses `resolveRequestIdentity` with the actual user, API key, and impersonation session facts. Route schemas, middleware, permissions, and policy registration were not changed. For the user-preference route, GET/PATCH policy placement is preserved; no new GET session-only restriction was added.

Authored the selected focused PostgreSQL integration source at `tests/api-integration/activity-relation-time-entry-crud.test.ts`, restoring it from the old #773 source and updating direct comment-repository calls to provide a resolved session identity. It covers activity ordering/content normalization and CRUD, relation duplicate/reverse/self/foreign-endpoint behavior, time-entry ordering and update shape, comment authorship/type predicates, and isolated preference row deletion. It was authored but not run.

## Held storage seam

No storage source or storage tests were changed. In this accepted-main checkout, `apps/api/src/storage/cleanup-assets.ts` still has `deleteOrphanedAssets(oldContent,newContent,{taskId})` and `getTaskAssetKeys(taskId,executor=db)` backed by global `db` reads. Actual callers found:

- Selected `apps/api/src/activity/controllers/update-comment.ts` after commit: `deleteOrphanedAssets(existing.content, content, { taskId: existing.taskId })`.
- Selected `apps/api/src/activity/controllers/delete-comment.ts` after commit: `deleteOrphanedAssets(existing.content, null, { taskId: existing.taskId })`.
- Held task callers: `apps/api/src/task/controllers/update-task.ts:146`, `apps/api/src/task/controllers/update-task-description.ts:45`, and `apps/api/src/task/controllers/delete-task.ts:23` (`getTaskAssetKeys(taskId, tx)`).

The task caller boundary remains unresolved; no internal-producer exception or deletion semantic change was introduced. The activity cleanup calls also remain on the legacy helper until the authorized storage composition/handoff lands. Exact minimum seam is to carry the same resolved request identity and transaction executor through cleanup callers, and make every asset/content-reference probe and deletion decision use that executor/current reach in the required transaction/effect order. Do not treat this report as closure of cleanup-assets.

## Verification

Successful, within the allowed scope:

- Earlier in this worktree: `pnpm install --frozen-lockfile` (exit 0); prerequisite `@taskdesk/permissions`, `@taskdesk/domain`, and `@taskdesk/email` package builds (each exit 0).
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json` after final edits: exit 0.
- Scoped `pnpm exec biome check --write` across all 23 changed source/test files (19 selected recovery paths plus four authorized index caller prerequisites): exit 0; final rerun reported no fixes.
- `git diff --check`: exit 0; clean worktree after commit.
- No PostgreSQL tests, test suites, Docker, browser, build, CI, push, or PR action was run.

The first commit attempt was rejected by the commit-msg hook because the subject lacked a conventional type; no hook was bypassed. Commit `fix(api): scope legacy writes to resolved identity` succeeded with hooks enabled.

## Review/next dependency

This is author work only. It needs fresh independent review at the exact commit SHA and the applicable security review tier before any merge decision. No source-conservation review or root runtime review is claimed here. The cleanup-assets seam remains held. When #810 is accepted/composed, preserve its independent `getComments` SQL identity threading in `apps/api/src/comment/index.ts` together with this commit's three create/update/delete activity-controller identity threads; do not replace the whole route index with either delta alone. The authored PostgreSQL test file has not been executed and must be run in a later authorized review/validation lane.


## Evidence file

`query773-storage-b9-source-dependency-author-luna.md`

# #773 storage / #809 source-dependency author report

Status: bounded stacked-source author work committed; not acceptance of #809, review approval of this candidate, merge readiness, or completion of all #773 work.

## Source ancestry and conservation

- Worktree: `/Users/heinthura/.codex/worktrees/query773-current-luna`
- Branch: `codex/773-current-main-luna`
- Accepted-main base: `c022915a8768b96b460c798feafafd7d48214d5c`
- First #773 author commit: `85af21e2101109069be6182adb694f6006d778f1`, parent accepted main.
- Exact #809 publication imported: `5511e680c4b2990adcdf37563bd2c7df67119462`; live PR #809 was rechecked OPEN on `main`, exact head 5511, `reviewDecision` empty. This is still an unaccepted dependency and was merged only into this isolated #773 branch, never into main.
- Publication parent: `0f8e6aaca3d30fb4a30173669c7e357922ea2e06`; its parents are B9 source `70ab0330dfe2123dbcf49d3d9dfe95a7768c3595` and accepted main `c022915a8768b96b460c798feafafd7d48214d5c`.
- Normal merge commit: `c91e11d7001d85078f897dad82895f5006a565bb`, parents `85af21e2101109069be6182adb694f6006d778f1` and `5511e680c4b2990adcdf37563bd2c7df67119462`. Git reported a clean `ort` merge; no conflict was resolved manually.
- Pre-merge conservation: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query773-pre809-b9-30-entry-conservation-luna.json` (mode 0600) records the clean 85af candidate’s 23 complete mode/blob entries, all 30 B9 source paths, exact source/publication blobs, parent hashes, and publication-note evidence. It records the one expected publication delta from 0f8e to 5511: the task review note gained exactly 85 append-only lines; the original bytes remain an exact prefix. The other 29 source paths matched byte-for-byte and by mode.
- Post-merge conservation before these caller edits: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query773-post809-b9-30-entry-conservation-luna.json` (mode 0600) verifies all 30 paths exactly match the 5511 publication, all 23 prior #773 paths match their pre-merge blobs, and the path sets do not overlap.
- Only after those receipts did the authorized storage caller edits begin. Relative to 5511, exactly three imported task paths changed: `apps/api/src/task/controllers/update-task.ts`, `update-task-description.ts`, and `delete-task.ts`. The other 27 of the 30 publication paths remain unchanged. No other `apps/api/src/task/**` file was edited.

## Storage implementation

Added `apps/api/src/storage/repository.ts` and rewrote `apps/api/src/storage/cleanup-assets.ts` so every database statement requires an explicit `Executor` and `ResolvedIdentity`. Reference and asset reads join the addressed task to its project and use `currentProjectReachPredicate`; asset reads and deletes also correlate the asset’s project/workspace columns to that task’s project. Row deletion repeats task reach in the DELETE predicate. There is no optional executor default or unscoped fallback.

The selected activity callers `apps/api/src/activity/controllers/update-comment.ts` and `delete-comment.ts` retain their existing after-event, fire-and-forget cleanup ordering. They start a cleanup transaction, lock the task then the live project with the same resolved request identity, and pass that transaction executor and identity into cleanup. Database asset deletion still follows successful object deletion; failed object deletion retains its asset row.

The three authorized B9 task callers use the identity already resolved by B9. `update-task.ts` and `update-task-description.ts` retain their post-commit event/notification ordering and fire-and-forget cleanup; their cleanup transaction reacquires the task then project lock before scoped reads, external object deletion, and scoped row deletion. `delete-task.ts` now reads object keys through `(tx, identity, taskId)` while the existing transaction has the locked task/project and before the existing hard delete; its event/relation events still precede post-commit S3 deletion. No B9 mutation predicates, task locks, result guards, or event payloads were edited.

Restored and expanded the selected test source `tests/api-integration/storage-cleanup-assets.test.ts`. It retains the orphan/reference behavior checks, task-only asset filtering, failed-S3 row retention, and explicit transaction-handle visibility. It now resolves and supplies real identity, runs cleanup through a task/project-locked transaction, and adds an authored-not-run PostgreSQL oracle: after deleting persisted project membership while retaining the resolved identity object, cleanup does not call object storage or remove the asset row, and the scoped key query returns no keys.

## Exact final candidate

- Storage author commit: `4304c9616d442da5d07d21c186cf133d1ae19d07`, parent `c91e11d7001d85078f897dad82895f5006a565bb`.
- Changed files in this storage delta: `apps/api/src/storage/repository.ts`, `apps/api/src/storage/cleanup-assets.ts`, the two selected activity cleanup controllers, only the three authorized task controllers listed above, and `tests/api-integration/storage-cleanup-assets.test.ts`.
- The earlier author report at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query773-current-main-author-luna.md` remains unchanged as the actual 85af source-bound report; its storage hold is historical and superseded only by this bounded delta.
- The imported #809 review record and reports remain byte-preserved. Those reviews are bound to their stated earlier #809 source heads/publication; none is a review of 4304 or this combined #773 candidate.

## Verification and limits

- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json` after the storage edits: exit 0.
- Scoped `pnpm exec biome check --write` on the eight changed source/test files: exit 0; final rerun made no fixes.
- `git diff --check`: exit 0; worktree clean after commit.
- No PostgreSQL test, test suite, build, browser, Docker, CI, push, or PR action was run. The storage PostgreSQL tests are authored but not executed.
- The initial commit message attempt for the earlier author commit had been rejected by commitlint and was corrected without bypassing hooks; both commits in this report used conventional messages and hooks.

## Remaining ownership and dependency

The five legacy functions in `apps/api/src/task/assert-task-project-live.ts` remain unchanged and unclaimed here: `lockLegacyTaskRowIfPresent`, `lockLegacyTaskRow`, `lockTaskAndAssertProjectLive`, `lockProjectsAndAssertLive`, and `lockProjectAndAssertLiveForTaskNumber`. This work adds no internal-producer exemption and does not claim the whole #773 tranche complete.

The candidate still depends on #809 remaining unaccepted source until that PR is genuinely accepted and composed on current main. Do not publish or merge this stacked #773 candidate before that dependency is accepted, current main is composed, the combined exact head receives its applicable independent reviews, and required runtime/CI gates run. The future #810 `apps/api/src/comment/index.ts` `getComments` identity-query delta was not composed; when accepted later, preserve it together with this candidate’s existing create/update/delete request-identity threading in that file.


## Evidence file

`query773-4304-root-preflight-findings.md`

# Recovered #773 root preflight findings

Candidate examined: 4304c9616d442da5d07d21c186cf133d1ae19d07 against unaccepted dependency5511e680c4b2990adcdf37563bd2c7df67119462. Authoritative candidate remains source-only, not accepted. Root is the directing conductor, so this is not independent review or approval.

1. Pinned Drizzle0.45.2 PgInsertBuilder.select compares exact schema/projection keys and order. All five partial INSERTSELECT projections (activity2/relation/timeentry/projectprefs) fail before SQL. Independently confirmed by ordinary A. Remediation authorized: complete columns, original CUID/default/null behavior and explicit date/JSON encoders. No raw SQL escape or new framework.
2. relationEndpointReach used an unaliased inner task_relation FROM with outer same-table column arguments. SQL name shadowing lets a reachable inner relation satisfy a predicate intended to correlate an unrelated outer relation. Caller middleware does not replace the required query boundary. Remediation authorized: distinct inner relation aliases, explicit correlation to outer id/source/target, both endpoint predicates on full-row relation list, and real direct repository negative assertions with an own reachable relation present. Existing output filter semantics retained. The author reports a no-connection generated-SQL probe confirming new outer correlations; not independently rerun at this checkpoint.
3. Five legacy shared task lock helpers still have accepted label callers. No global query-conversion claim or removal authorization. Imported B9 source remains unaccepted, and future #810 comment read plumbing must coexist with #773 mutations.

No PostgreSQL test or runtime was executed by this preflight. Actual candidate repair, required independent reviews and focused runtime remain necessary. Root inspected storage/caller transactions, event ordering, relation and time-entry controllers, preferences service and pinned schema/library source. Cross-system object deletion atomicity remains an inherited limitation, not newly solved here.


## Evidence file

`query773-4304-ordinary-a-luna.md`

# #773 recovered candidate ordinary review A

**Model:** GPT-6 Luna
**Role:** Fresh independent ordinary reviewer (review A)
**Independence:** This reviewer context did not author, direct, or remediate the candidate. No author conversation was inherited.
**Reviewed head:** `4304c9616d442da5d07d21c186cf133d1ae19d07`
**Comparison base:** `5511e680c4b2990adcdf37563bd2c7df67119462` (#809 publication; unaccepted dependency, not treated as accepted main)
**Scope:** All 29 paths in the net diff from the stated base to the exact reviewed head, including source, caller identity plumbing, and authored integration tests. Full ordinary correctness, SQL shape/codecs/defaults, current reach, transaction/lock/effect ordering, cleanup safety, and inherited behavior review.

## Verdict

**BLOCKED — one high-severity correctness finding.** The core INSERT…SELECT paths in activity, relation, time-entry, and project preference writes all fail during Drizzle query construction because their selected projections do not have the exact target table columns in schema order. These are ordinary supported write paths, so the feature behavior cannot work as authored. The finding is bounded to the shared construction mechanism and names each affected location below.

## Blocking finding

**B1 — Partial `.insert(table).select(projection)` shapes throw before SQL execution.**

The candidate uses Drizzle `0.45.2`. I inspected the pinned implementation at `node_modules/.pnpm/drizzle-orm@0.45.2_.../node_modules/drizzle-orm/pg-core/query-builders/insert.js`: `PgInsertBuilder.select()` checks `haveSameKeys(this.table[Columns], select._.selectedFields)` and synchronously throws `Insert select error: selected fields are not the same or are in a different order compared to the table definition` when the selected-field keys do not exactly match the table columns. This check occurs while building the query, before a database statement is issued.

The candidate projections are partial in every use below:

- `apps/api/src/activity/repository.ts:110-154`, `insertTaskActivity`: selects taskId/type/userId/content/eventData. `task_activity` also has id, createdAt, updatedAt, externalUserName, externalUserAvatar, externalUrl.
- `apps/api/src/activity/repository.ts:168-209`, `insertCommentActivity`: selects seven named fields, omitting id, createdAt, updatedAt, externalUserAvatar and externalUrl.
- `apps/api/src/task-relation/repository.ts:355-395`, `insertTaskRelation`: selects sourceTaskId/targetTaskId/relationType, while `task_relation` also has id and createdAt.
- `apps/api/src/time-entry/repository.ts:113-154`, `insertTimeEntry`: selects seven fields, while `time_entry` also has createdAt and updatedAt.
- `apps/api/src/user-preference/repository.ts:167-199`, project-scoped `upsertOwnSettingRow`: selects six fields, while `user_preference` also has id and createdAt.

The schema fields/defaults were checked in `apps/api/src/database/schema.ts` at the corresponding table declarations. Defaults do not make a partial object acceptable to this Drizzle API: the complete key-set check precedes construction of the insert base. Consequently task activity and comment inserts, relation creation, time-entry creation, and project layout preference writes throw at construction. Existing `.values(...).onConflictDoUpdate(...)` for global density settings is a different path and does not have this specific defect.

No PostgreSQL or application test was run, per assignment. The failure is established by static inspection of the pinned library implementation and exact projections; it does not depend on a database runtime.

## Other review checks

- Compared the exact candidate against the specified base and inspected all 29 net changed paths. The path set is: `apps/api/src/activity/controllers/{create-activity,create-comment,delete-comment,get-activities,update-comment}.ts`, `apps/api/src/activity/{index.ts,repository.ts}`, `apps/api/src/comment/index.ts`, `apps/api/src/storage/{cleanup-assets.ts,repository.ts}`, `apps/api/src/task-relation/controllers/{create-task-relation,delete-task-relation,get-task-relations}.ts`, `apps/api/src/task-relation/{index.ts,repository.ts}`, `apps/api/src/task/controllers/{delete-task,update-task-description,update-task}.ts`, `apps/api/src/time-entry/controllers/{create-time-entry,get-time-entries,get-time-entry,update-time-entry}.ts`, `apps/api/src/time-entry/{index.ts,repository.ts}`, `apps/api/src/user-preference/{index.ts,repository.ts,service.ts}`, and `tests/api-integration/{activity-relation-time-entry-crud,storage-cleanup-assets}.test.ts`.
- Read `AGENTS.md`, `CLAUDE.md`, `docs/04-engineering/agent-workflow.md`, `docs/04-engineering/coding-standards.md`, the active mission, the comments/activity feature spec, the profile settings section (ST-12–ST-16), storage/attachment architecture, relevant schema declarations, and `resolve-request-identity.ts`.
- Confirmed the four route modules construct request identity from authenticated `userId`, API-key facts, and session `impersonatedBy`; the comment module’s current request identity threading coexists with the candidate’s create/update/delete paths. The #810 comment-read SQL work is not in this base/head comparison and no preservation/acceptance claim is made for it.
- Read scopes generally use `currentProjectReachPredicate` against persisted project/workspace/organisation facts, and relation writes recheck both endpoints. Activity, relation, and time-entry mutation controllers use task-then-project locking, with relation task/project IDs sorted for stable order. Returned-row checks are present at the key scoped INSERT/UPDATE/DELETE paths. These checks do not mitigate B1, since construction fails before they can run.
- User preference reads remain keyed by the resolved identity’s own `personId`; project sets are preflighted and the upsert SELECT repeats persisted reach in its statement. Clears remain own-row-only. The route preserves session-only PATCH placement and GET behavior.
- Storage cleanup passes an explicit executor and identity through current-scope repository queries. Failed object deletions are filtered out before asset-row deletion, preserving metadata for failed deletes. Successful external object deletion occurs before the asset-row delete within the supplied cleanup transaction, so a later database failure can leave a row whose object is gone; this is a residual cross-system atomicity limitation, not a separate candidate-specific blocker from static inspection. Task deletion reads keys within the task/project transaction and deletes objects after the database commit, preserving the existing cleanup/effect direction.
- The selected source continues to use legacy task lock helpers in task controllers for some writes; the candidate does not establish a global conversion and this review does not claim one. Accepted label-family semantics were not changed by the net paths reviewed.
- The two authored PostgreSQL integration files were inspected as source but not run. No suites, typecheck, build, browser, Docker, CI, push, PR, or central-document changes were performed. No remediation was attempted.

## Review limits and dependency state

This is an ordinary review of exact head `4304c9616d442da5d07d21c186cf133d1ae19d07` against comparison base `5511e680c4b2990adcdf37563bd2c7df67119462`. The base is an unaccepted #809 publication. This report makes no claim that #809 is accepted, that this candidate is merge-ready, or that the wider #773 tranche is complete. It is not a security review, runtime verification, or acceptance of the authored integration tests.


## Evidence file

`query773-dml-shape-repair-author-luna.md`

# #773 current-main recovery: DML shape and relation reach repair

**Requested model:** GPT-6 Luna. The served-model fingerprint is unavailable in this environment, so I do not claim a verified fingerprint.

**Author commit:** `33423205b4826d32565da666ec7a2140154a37fe`
**Parent:** `4304c9616d442da5d07d21c186cf133d1ae19d07`
**Branch:** `codex/773-current-main-luna`
**Base/dependency state:** This isolated branch remains stacked on the exact #809 publication `5511e680c4b2990adcdf37563bd2c7df67119462`, which is still unaccepted. No main merge, PR, push, or acceptance claim is made.
**Review context:** The full independent ordinary-review report at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query773-4304-ordinary-a-luna.md` identified B1 at the five INSERT…SELECT construction sites. During the bounded repository repair, the root additionally identified a correlated-subquery issue in task relation endpoint reach. This author report records remediation and static evidence; it is not independent review or runtime acceptance.

## Bounded source change

Only these five paths changed in this commit:

- `apps/api/src/activity/repository.ts`
- `apps/api/src/task-relation/repository.ts`
- `apps/api/src/time-entry/repository.ts`
- `apps/api/src/user-preference/repository.ts`
- `tests/api-integration/activity-relation-time-entry-crud.test.ts`

The existing transaction/executor flow, current persisted-reach predicates, lock order, route policies, event order, returned-row guards, and conflict targets were retained.

Drizzle 0.45.2 requires the INSERT…SELECT selected-field keys to exactly match the destination table columns in schema declaration order. The final projections are:

| Builder | Exact destination key order | Defaults, nulls, and encoders |
| --- | --- | --- |
| `insertTaskActivity` | `id, taskId, type, createdAt, updatedAt, userId, content, eventData, externalUserName, externalUserAvatar, externalSource, externalUrl` | Creates the CUID with `createId()`; uses `now()` for both default timestamps; emits explicit `NULL` for all external fields; uses `sql.param(value, destinationColumn)` for typed text and JSONB values. |
| `insertCommentActivity` | `id, taskId, type, createdAt, updatedAt, userId, content, eventData, externalUserName, externalUserAvatar, externalSource, externalUrl` | Creates a CUID; uses `now()` for both timestamps; emits `NULL` for event data, avatar, and URL when absent; encodes the fixed `comment` type and external strings with their destination columns. |
| `insertTaskRelation` | `id, sourceTaskId, targetTaskId, relationType, createdAt` | Creates a CUID; uses `now()` for the schema default timestamp; relation endpoints come from the admitted, live source/target task rows; relation type is a typed parameter. |
| `insertTimeEntry` | `id, taskId, userId, description, startTime, endTime, duration, createdAt, updatedAt` | Preserves a supplied ID or creates a CUID when undefined; preserves explicit null duration but uses schema default `0` when undefined; uses `now()` for both default timestamps; date, text, and integer values use target-column encoders; absent nullable end time remains `NULL`. |
| Project branch of `upsertOwnSettingRow` | `id, personId, scope, scopeId, key, value, createdAt, updatedAt` | Creates a CUID; uses `now()` for creation time; supplies the existing update timestamp through its timestamp column encoder; the persisted project ID supplies `scopeId`; JSONB `value` is encoded with `sql.param(value, userPreferenceTable.value)`. The global-density `.values()` branch is unchanged. |

This explicitly supplies columns whose defaults would otherwise be skipped by INSERT…SELECT. Timestamp expressions preserve the schema’s database `now()` default semantics. `sql.mapWith()` is not used as a write encoder.

## Relation endpoint correlation

`relationEndpointReach` previously read from the unaliased `task_relation` table while its callers also referenced the outer `task_relation` row. The nested relation ID and endpoint comparisons could bind to the inner row, making them self-comparisons and allowing a different reachable relation to satisfy the existence check. The helper now aliases its inner relation row separately for source and target. Its nested predicates compare that alias to the caller’s actual outer `task_relation.id` and endpoint columns.

`listRelationsOfTask` now applies the same source and target reach predicates in its SQL statement. The controller already removed a relation unless both task summaries were visible; the new SQL restriction preserves that returned result while preventing retrieval of relation rows whose opposite endpoint is outside current reach. No task controller or shared policy was edited.

The test source adds a direct repository regression setup with one own reachable relation and one relation from an own task to a same-workspace task in a project with no grant. It asserts the own relation resolves, the foreign relation resolves to `undefined`, the repository delete returns `undefined`, the list contains only the own relation, and the foreign relation row remains. The test is authored but was not run.

## Static evidence and validation

A source-only construction probe invoked all five repository write functions using the real Drizzle 0.45.2 database/query builders and a stub executor that compiled each resulting INSERT with `.toSQL()` and returned a fake row instead of executing it. The five statements constructed successfully. The probe also printed the schema-derived destination key order recorded above. It made no database connection/query.

A second no-connection probe invoked `listRelationsOfTask` with the real query builder and an executor wrapper that intercepted only top-level thenable resolution to call `.toSQL()`. The generated SQL includes the outer correlations `relation_source_row.id = task_relation.id`, `relation_source_task.id = task_relation.source_task_id`, and the corresponding target-row comparisons. No statement was executed.

Final checks:

- `pnpm exec biome check apps/api/src/activity/repository.ts apps/api/src/task-relation/repository.ts apps/api/src/time-entry/repository.ts apps/api/src/user-preference/repository.ts tests/api-integration/activity-relation-time-entry-crud.test.ts` — exit 0.
- `pnpm --filter api exec tsc --noEmit -p tsconfig.json` — exit 0.
- `git diff --check` before commit — exit 0.
- `pnpm --filter api exec tsc --noEmit -p tsconfig.tests.json` — exit 1, with four errors in untouched `tests/api/time-entry/update-time-entry.test.ts` (lines 88, 122, 151, 181): `identity` is missing from `UpdateTimeEntryParams` arguments. These paths are outside this repair and were not edited.
- No PostgreSQL tests, full tests, build, browser, Docker, CI, push, or PR were run/performed.

During the permitted source-only probe, initial attempts exposed the still-misordered comment fields (event data/external fields and avatar/source order); the projection was corrected and the final five-site probe passed. A root-level `pnpm exec tsx` attempt exited 254 because `tsx` is scoped under the API package; the filtered API invocation was used thereafter. An initial inline probe with top-level `await` exited 1 under the package’s CJS transform; wrapping it in an async IIFE corrected the probe. An initial relation probe attempted `.toSQL()` on the async repository return (a thenable that normally executes); it was replaced with the no-connection executor wrapper described above. The first commit subject was rejected by commitlint for lacking conventional type/scope; the conventional commit below passed.

## Commit and remaining scope

Commit `33423205b4826d32565da666ec7a2140154a37fe` was created normally after the commitlint correction. The worktree is clean at that exact head.

This is a bounded source repair, not completion or acceptance of the #773 tranche. It remains stacked on unaccepted #809. The five inherited legacy helpers in `apps/api/src/task/assert-task-project-live.ts` remain unclaimed and untouched; #810 comment-read work has not been composed. Runtime PostgreSQL evidence and independent review at the repaired exact head remain outstanding.


## Evidence file

`query773-timeentry-unit-fixture-author-luna.md`

# #773 time-entry unit fixture repair

**Requested model:** GPT-6 Luna. The served-model fingerprint is unavailable in this environment; no fingerprint claim is made.
**Commit:** `766d69c7a49e4ff11855dd02ad99bea4e9f9ad60`
**Parent:** `33423205b4826d32565da666ec7a2140154a37fe`
**Worktree/branch:** `/Users/heinthura/.codex/worktrees/query773-current-luna`, `codex/773-current-main-luna`

## Change

Only `tests/api/time-entry/update-time-entry.test.ts` changed. Its prior mock reproduced Drizzle query chains (`select/from/where/for`, transaction `select`, and `update/set/where/returning`) that no longer represented the controller's named repository boundary or current SQL scope. The fixture now mocks `findTimeEntryById`, `lockTaskAndAssertProjectLive`, and `updateTimeEntryById`, passes a transaction marker through the transaction callback, and uses a complete value typed as `ResolvedIdentity` at each of the four controller calls.

The original four behavior oracles remain: preserving end time and recalculating duration when end time is omitted; rejecting a start after the preserved end without updating; rejecting a start after a supplied end without updating; and allowing a forward move on an open entry while retaining null end time/duration. Assertions now additionally verify the resolved identity reaches repository calls and the same transaction handle reaches the lock/update functions.

## Validation

- `pnpm --filter api exec vitest run ../../tests/api/time-entry/update-time-entry.test.ts` — exit 0; 1 test file passed, all 4 tests passed.
- `pnpm --filter api exec tsc --noEmit -p tsconfig.tests.json` — exit 0.
- `pnpm exec biome check tests/api/time-entry/update-time-entry.test.ts` — exit 0; no fixes needed.
- `git diff --check` — exit 0.
- No PostgreSQL, build, browser, Docker, CI, push, PR, or repository publication-note work was performed.

Commit `766d69c7a49e4ff11855dd02ad99bea4e9f9ad60` was created normally. The worktree is clean at that exact head. This is a focused test-fixture repair; it makes no broader #773 completion or acceptance claim. The candidate remains stacked on the unaccepted #809 source dependency.


## Evidence file

`query773-766d-full-ordinary-b-luna.md`

# #773 recovered candidate full ordinary review B

**Requested model:** GPT-6 Luna. The served-model fingerprint is unavailable in this environment; I do not claim a verified fingerprint.
**Role:** Fresh independent ordinary reviewer B.
**Independence:** This context did not author, direct, or remediate the candidate. No author conversation was inherited.
**Exact candidate:** `766d69c7a49e4ff11855dd02ad99bea4e9f9ad60`
**Comparison base:** `5511e680c4b2990adcdf37563bd2c7df67119462`, the unaccepted #809 dependency; this is not treated as accepted-main acceptance.
**Scope:** All 30 net changed paths at the exact candidate, including identity plumbing, SQL repositories, callers, integration fixtures and the revised unit fixture. This is ordinary correctness review only, not the required security review, runtime verification, or acceptance.

## Verdict

**BLOCK — one high-severity behavioral regression.** The event-activity subscriber now refuses to persist an activity row when the project was archived or deleted after the successful task mutation emitted its event. This discards committed history in a race that the previous implementation explicitly handled and that the activity contract says must survive archival.

## Blocking finding

**B1 — A successful task event can be lost when archive/delete wins before the activity subscriber writes.**

`apps/api/src/activity/controllers/create-activity.ts` changes `recordTaskEventActivity` from a direct `taskActivityTable` insert to resolving a fresh identity and calling `insertTaskActivity`. The new repository helper in `apps/api/src/activity/repository.ts` constrains its source task through both `isNull(projectTable.deletedAt)` and `isNull(projectTable.archivedAt)`, and current project reach. If a task mutation commits and emits its event, then the project is archived/deleted before the subscriber's insert, the `INSERT … SELECT` returns no row; the subscriber silently returns `undefined`. This drops the activity corresponding to a mutation that already succeeded.

The removed implementation comment directly documented this race and its required behavior: an internal event subscriber must preserve task history if archive wins between the task transaction and asynchronous event delivery. The comments-and-activity spec also says activity is not edited or deleted when a work item is archived (CA-10). The new live-parent predicate reverses that established behavior. It is distinct from user-facing writes, which correctly need a live project. The internal event subscriber needs to preserve the committed mutation history across this race, consistent with its former implementation and contract.

No PostgreSQL/runtime test was run. The path is established by static inspection of the subscriber and repository predicate plus the prior in-source behavior statement; no timing reproduction is claimed.

## Other checks

- Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the active mission, the comments/activity, relations/hierarchy, time/cost, views, storage/attachment and data-model authorities.
- Confirmed the exact net path set (30): `apps/api/src/activity/controllers/{create-activity,create-comment,delete-comment,get-activities,update-comment}.ts`; `apps/api/src/activity/{index.ts,repository.ts}`; `apps/api/src/comment/index.ts`; `apps/api/src/storage/{cleanup-assets.ts,repository.ts}`; `apps/api/src/task-relation/controllers/{create-task-relation,delete-task-relation,get-task-relations}.ts`; `apps/api/src/task-relation/{index.ts,repository.ts}`; `apps/api/src/task/controllers/{delete-task,update-task-description,update-task}.ts`; `apps/api/src/time-entry/controllers/{create-time-entry,get-time-entries,get-time-entry,update-time-entry}.ts`; `apps/api/src/time-entry/{index.ts,repository.ts}`; `apps/api/src/user-preference/{index.ts,repository.ts,service.ts}`; `tests/api-integration/{activity-relation-time-entry-crud,storage-cleanup-assets}.test.ts`; and `tests/api/time-entry/update-time-entry.test.ts`.
- Reviewed the repaired five INSERT…SELECT projections for schema-order keys, explicit id/default/null values and destination-column parameter encoders; the earlier partial-projection defect is repaired in source. Reviewed the relation endpoint helpers for distinct inner aliases correlated to the caller's outer relation row and both-end reach filtering on relation listing.
- Inspected route identity construction from authenticated user, API-key facts and session impersonation for activity/comment, time-entry and preference request paths; reviewed persisted current-reach statements and transaction executor threading.
- Reviewed relation task/project locking and stable ordering, duplicate/self-relation checks, event-after-commit order, returned-row handling and list shape. Reviewed time-entry query ordering/update behavior and the four existing duration behavior oracles in the changed unit fixture. Reviewed storage cleanup's task-scoped queries, transaction executor plumbing, failed-object-delete metadata preservation and post-delete behavior.
- Storage cleanup still has a cross-system atomicity limitation: object deletion precedes asset-row deletion, so a later database failure can leave metadata for an absent object. This was already described in the prior review and is not the blocker found here.
- The five inherited lock helpers remain outside the claimed scope. The candidate does not establish global conversion, and future #810 comment-read work is not accepted or reviewed by this report.

## Review limits and dependency state

No tests, probes, typecheck, build, PostgreSQL, Docker, browser, CI, push, PR, source edit, or central-document edit was performed. This report makes no claim that #809 is accepted, that this candidate is merge-ready, or that the wider #773 tranche is complete. The separate current-head security review remains required after ordinary blockers are fixed.


## Evidence file

`query773-event-history-contract-assessment-sol.md`

# #773 event-history contract assessment

**Requested model/role:** GPT-6.1 Sol, bounded architecture/contract adviser. The served-model fingerprint is unavailable; this is not a verified fingerprint claim.
**Context:** /root/query773_event_history_contract_sol. Fresh bounded assessment context; no implementation performed. This context now materially directs the proposed design and is NOT eligible to approve its resulting remediation independently.
**Exact inspected head:** 766d69c7a49e4ff11855dd02ad99bea4e9f9ad60 (verified with git rev-parse; clean porcelain).
**Comparison:** 5511e680c4b2990adcdf37563bd2c7df67119462, unaccepted #809 dependency, not accepted-main acceptance.
**Deliverable:** explanation/design advice only; no ordinary/security approval, blocker disposition, gate waiver or merge authorization.

## Conclusion

The archive-only change is technically bounded but is an incomplete repair of the behavioral regression. A separate named subscriber insert which removes ONLY the project's archivedAt/deletedAt predicates while preserving freshly resolved identity and current project reach restores the explicit archive race only when the actor still has reach. It still silently loses a successful mutation's history when membership is revoked or the actor becomes inactive before subscriber execution. That latter behavior is newly introduced by this candidate relative to the inspected base. It should not be described as preservation of established subscriber behavior.

CA-10 literally governs retention and purge, not the timing of insertion. It is insufficient by itself to prove every possible delayed producer must execute after revocation. However CA-6 explicitly calls every field change a journal entry, and the base subscriber deliberately persists events already emitted by successful writes without reauthorizing the actor. Together they establish the required result for these existing human task writes: a successful authorized mutation keeps its journal even if access changes later. The actor's later loss of access is not a second mutation request and does not retroactively undo the first. No new general background-job entitlement follows.

No owner product decision is necessary to preserve that result by making the history part of the already authorized task transaction. There is a concrete implementation path within existing contracts. A conductor may choose that technical repair. The cost is touching the bounded producer family rather than claiming a two-line helper edit fully solves the defect.

## Minimal complete design under existing authorities

1. Insert the existing legacy taskActivityTable row inside the SAME transaction which performs each existing task mutation that currently feeds these seven activity subscribers. Keep SQL in activity/repository.ts and pass the caller's existing Executor first and its existing ResolvedIdentity. Use the already established task/project SQL reach and live predicates. No identity synthesized with credential=session from event userId.
2. The insertion must be awaited and required to return a successful result (or throw). If current reach is lost before the insert statement, fail/roll back the enclosing task transaction, rather than commit a task change and silently omit the journal. Once both commit, subsequent archive/revocation/inactivation does not remove the journal. Existing project locks already protect liveness where these controllers use the task/project locking helpers; preserve their lock order.
3. Keep the current event publication after commit for other subscribers. Remove ONLY these seven history-writing listeners once all their actual producers write the same rows transactionally; otherwise duplicate history results. Do not add an event key, generic internal-producer bypass, synthetic administrator, capability, schema, or job framework.
4. Preserve the existing activity type/eventData mapping exactly in this repair. User-facing createActivity and comments retain current identity, live-parent checks and locks. Activity reads remain current-reach filtered. This advice does not authorize filling unrelated missing journal fields or changing native activity semantics.

This is the smallest complete design I can substantiate which simultaneously preserves committed history and the existing SQL identity boundary without adding a new internal entitlement. It is broader in file count than an archive-only fix but narrow in mechanism: journal persistence moves into the existing successful mutation unit.

### Existing provenance and fields

The trusted provenance is the authenticated controller's resolved identity, its authorized/locked source row, the actual successful mutation result, and the transaction handle—not a bare taskId or event timestamp. The task controllers already receive ResolvedIdentity. create-task.ts and import-tasks.ts emit task.created from returned createdTask; update-task.ts and update-task-status.ts emit task.status_changed after their transactions; update-task-priority.ts, update-task-assignee.ts and update-task-due-date.ts have equivalent successful-returned-row provenance. bulk-update-tasks.ts builds deferred per-item events within its transaction; the matching journal insertion belongs in that item's existing transaction. move-task.ts has source and destination project facts plus movedTask within its transaction; retain destination reach/liveness there.

Required existing row values: taskId from the successful task result; authenticated currentUserId/userId currently used as activity actor (not task.userId, which is assignee); the same type and null content; and the exact current subscriber eventData mapping. task.created uses currentUserId and {} (including import's existing type=create versus ordinary created); moved uses fromProjectId/fromProjectName/toProjectId/toProjectName/oldStatus/newStatus; status uses oldStatus/newStatus; priority uses oldPriority/newPriority; unassigned uses {}; assignee uses newAssigneeId/newAssignee/isSelfAssigned; due date uses normalized oldDueDate/newDueDate. Existing missing optional event values should not be invented by this repair. The separate actor-id distinction is material: created events carry both assignee userId and actor currentUserId.

The existing bus is an in-process EventEmitter. publishEvent adds an AsyncLocalStorage initiatorId and a timestamp; subscribeToEvent launches async listeners and catches/logs their errors. Awaiting publishEvent does NOT await subscriber completion. Neither timestamp nor initiatorId proves persisted tenant scope or carries original credential restrictions. Existing event payloads often include projectId (created spreads createdTask; status/priority/etc include it); moved has fromProjectId/toProjectId. activity/index.ts drops those project anchors at the helper call. Adding those IDs alone to a repository is not sufficient authority under the tenant contract. Passing a previously resolved identity into a later subscriber while bypassing persisted membership checks would likewise not meet current-reach semantics.

## What an asynchronous alternative would require

A non-returning INSERT ... SELECT constrained to task/project event IDs could avoid returning cross-tenant content, but that observation alone does not establish authorization to mutate a tenant after the actor has lost reach. Treating all event bus payloads as a new lifecycle entitlement would be a new trust-boundary decision; an import-only TypeScript helper name is not that authority. A full-row RETURNING helper without identity/current reach plainly contradicts the literal content-returning repository contract. Removing RETURNING is not, by itself, proof that every write is authorized.

If retaining post-commit subscriber persistence is mandatory, the precise unresolved design/owner question is: “May this closed set of legacy successful-task-mutation history subscribers persist the already committed mutation's existing activity payload after its actor loses current identity/reach, solely on trusted server-produced task and committed project provenance, with no content returned to the caller?” The current contracts do not specify that new asynchronous authorization mechanism. This question is unnecessary for the transactional repair above, and must not be broadened to general jobs or producers.

## Authorities and evidence actually read

Read AGENTS.md, agent-workflow.md, CLAUDE.md, active-mission.md; relevant newest and tail decision-log entries; coding-standards query ownership D1-D4; multi-tenancy query scoping; security-model section 5 and the explicit narrow erasure-summary entitlement; comments-and-activity CA-6 through CA-10; the supplied full ordinary B adverse report. Inspected current activity controller/repository and all seven subscribers; base create-activity.ts via git show; events/index.ts; current identity-scope.repository.ts; current update-task.ts and representative producer transaction/publication ranges for create, import, move, bulk and priority, plus an rg inventory of all seven event-name producers. Read the relevant query-ownership notification review excerpts including accepted #785's retained N1: native key-addressed work_item notification producer facts may pass resolution but fail final ID-only SQL. That N1 is a specific held notification availability residual; it grants no legacy-activity or general internal-producer exception. D1-D4 determine query location/Executor handling, not a tenant-authority exemption.

## Limits

Static architectural advice only. No source changes, tests, probes, PostgreSQL, Docker, build, typecheck, browser, GitHub/ref mutation, push, PR or central-document changes. No runtime race reproduction. The complete proposed producer migration has not been implemented or independently reviewed; each actual producer and fixture must receive exact-source implementation validation, including archive, membership revocation, inactive actor, rollback/no-row insertion, import, move, bulk and no-duplicate-history cases. This report makes no accepted-main, #809 acceptance, merge readiness, whole #773/#580, global N1/checker, feature/stage, image or SIT claim.


## Evidence file

`query773-transactional-history-repair-author-luna.md`

# #773 transactional history repair — author evidence

This is bounded author evidence, not an independent review, acceptance, or completion claim. The change remains stacked on an unaccepted #809 source dependency and must not be published or composed into `main` until the root orchestration completes the required acceptance and review process.

## Exact source state

- Branch: `codex/773-current-main-luna`
- Commit: `cf88cbdcc4aad85217ac7997600942fa5c472b68` (`fix(api): write task event history transactionally`)
- Parent: `766d69c7a49e4ff11855dd02ad99bea4e9f9ad60` (the preserved `766d69c7a49e4ff11855dd02ad99bea4e9f9ad60` head)
- Worktree: clean after commit
- Pre-edit preservation: [`query773-766d-pre-event-history-preservation-luna.json`](query773-766d-pre-event-history-preservation-luna.json), mode `0600`; it records 57 mode/blob entries at the clean pre-edit head, the complete base-to-head diff, and the pre-edit producer/subscriber inventory. Verification after edits confirmed the unchanged parent tree still matched all 57 captured entries before edits, and the source delta was exactly the 15 authorized paths below.

## Change and contract

The seven activity history listeners previously resolved a synthetic session identity after a task transaction committed. A revocation, inactivation, archive, or soft-delete between mutation commit and event delivery could therefore leave a successful mutation without its history row. The existing history insert now runs inside each owning task transaction through the existing `Executor`, `ResolvedIdentity`, current project-reach predicate, and live-project predicate. A missing inserted row throws and aborts that transaction. Event publication remains after commit and all event names/payloads and unrelated subscribers remain unchanged. Only the seven activity journal listeners and their now-unused actor-resolution helper were removed.

The activity feed now uses an explicit `select().from(taskActivityTable)` with the existing reach predicate and `createdAt DESC`. This keeps the actual outer table reference in the SQL and returns the complete activity row. A no-database Drizzle construction probe produced:

```sql
select "id", "task_id", "type", "created_at", "updated_at", "user_id", "content", "event_data", "external_user_name", "external_user_avatar", "external_source", "external_url" from "task_activity" where ("task_activity"."task_id" = $1 and exists (select 1 from "task" inner join "project" on "task"."project_id" = "project"."id" where ("task"."id" = "task_activity"."task_id" and "project"."organisation_id" = $2))) order by "task_activity"."created_at" desc
```

The probe used the same explicit outer select, correlated task/project reach predicate, and descending timestamp order as the repository query; it executed no SQL against a database.

## Producer conservation

The inventory found exactly seven old history event keys and 14 producer call sites/branches. Each listed call site now inserts the same history type, actor, null content, and listener-derived event payload inside its existing transaction. Bulk operations preserve the prior omitted `oldStatus`/`oldPriority` properties and date ISO conversion. Event publication remains intact.

| Existing event key | Existing producer call sites |
| --- | --- |
| `task.created` | `apps/api/src/task/controllers/create-task.ts`; `apps/api/src/task/controllers/import-tasks.ts` |
| `task.moved` | `apps/api/src/task/controllers/move-task.ts` |
| `task.status_changed` | `apps/api/src/task/controllers/update-task.ts`; `apps/api/src/task/controllers/update-task-status.ts`; `apps/api/src/task/controllers/bulk-update-tasks.ts` |
| `task.priority_changed` | `apps/api/src/task/controllers/update-task-priority.ts`; `apps/api/src/task/controllers/bulk-update-tasks.ts` |
| `task.assignee_changed` | `apps/api/src/task/controllers/update-task-assignee.ts`; `apps/api/src/task/controllers/bulk-update-tasks.ts` |
| `task.unassigned` | unassignment branch in `apps/api/src/task/controllers/update-task-assignee.ts`; unassignment branch in `apps/api/src/task/controllers/bulk-update-tasks.ts` |
| `task.due_date_changed` | `apps/api/src/task/controllers/update-task-due-date.ts`; `apps/api/src/task/controllers/bulk-update-tasks.ts` |

The existing import controller accepts an optional `currentUserId`; it still omits history when that actor is absent, matching the old listener's explicit missing-actor guard. No synthetic actor was added. The standard update controller likewise writes history only when its existing optional actor value is present. The source inventory found no additional history listener consumer or producer for these seven keys.

## Exact changed paths

- `apps/api/src/activity/controllers/create-activity.ts`
- `apps/api/src/activity/index.ts`
- `apps/api/src/activity/repository.ts`
- `apps/api/src/task/controllers/bulk-update-tasks.ts`
- `apps/api/src/task/controllers/create-task.ts`
- `apps/api/src/task/controllers/import-tasks.ts`
- `apps/api/src/task/controllers/move-task.ts`
- `apps/api/src/task/controllers/update-task-assignee.ts`
- `apps/api/src/task/controllers/update-task-due-date.ts`
- `apps/api/src/task/controllers/update-task-priority.ts`
- `apps/api/src/task/controllers/update-task-status.ts`
- `apps/api/src/task/controllers/update-task.ts`
- `tests/api-integration/activity-relation-time-entry-crud.test.ts`
- `tests/api-integration/project-archive-freeze-legacy.test.ts`
- `tests/api-integration/task-title-activity.test.ts`

The tests now assert exact create/import/status/priority/assignee/unassigned/due-date/move and bulk mappings with one row per producer operation; transaction rollback when the required history insert fails; and persistence after a real committed status change is followed by archive, project-grant revocation, and actor inactivation. The activity fixture now targets the existing `/api/me/settings` route and checks its `{ settings: ... }` response.

## Checks and execution limits

- `pnpm --filter @taskdesk/api typecheck` — exit 0 after fixing one test type-narrowing error. It typechecked the API and its configured API test sources.
- `pnpm exec biome check [15 changed paths]` — exit 0; no fixes required on the final pass.
- `git diff --check` — exit 0.
- Scoped SQL-shape probe via `pnpm --filter @taskdesk/api exec tsx -e ...` — exit 0; generated the correlated outer-table SQL above; no database connection/query.
- A first root-level `pnpm exec tsx -e ...` probe attempt failed because `tsx` is not a root executable. Retried with the API package's pinned executable successfully.
- The first typecheck attempt found `TS2339` on the import-task test union (`task.id`); narrowed the result before reading its ID. The subsequent typecheck exited 0.
- First commit-msg hook rejected the non-conventional subject. The normal commit was then made with the required conventional subject; no hook bypass was used.
- No Vitest/integration test, PostgreSQL, Docker, build, browser, CI, push, PR, or publication command was run here. New/changed PostgreSQL test assertions are authored but unrun by this author lane.

## Preserved pre-repair PG evidence and remaining work

The root-owned pre-repair #773 run remains adverse evidence and was not overwritten: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query773-runtime-766d69c7/vitest.full.log`, SHA-256 `9f2c68fd2c2427680497e34f4322afae8825d4020a9feb8b04746a7999844d56`. It recorded 7/9 files and 99/102 tests passing, with three failed tests across two files: the activity feed returned a non-array/error response in the CRUD test, project-preference test used a nonexistent route, and `comment.test.ts` received HTTP 500 for the same activity feed query problem. This source repair addresses those observed causes, but the runtime result remains unverified until the root schedules its authorized focused PostgreSQL run.

The independent review, required security review where applicable, root runtime verification, and later composition with accepted `main` remain pending. This author report is not an approval or a claim that #773 is complete.


## Evidence file

`query773-0f7-transactional-history-ordinary-b-luna.md`

# #773 transactional history repair — ordinary delta review

**Requested model:** GPT-6 Luna. The served-model fingerprint is unavailable in this environment; no verified fingerprint is claimed.
**Reviewer role:** Fresh ordinary delta reviewer, independent from the author and from the bounded Sol design-adviser context.
**Exact current candidate:** `0f7b0a9603848c1cb10ffcd5ea29a99ca44c5101`
**Current comparison base:** `bb298c181c213e695c5a8e857679536d355df8aa` (unaccepted #809 dependency; not accepted-main acceptance).
**Prior exact head reviewed:** `766d69c7a49e4ff11855dd02ad99bea4e9f9ad60`, where ordinary review B found B1.
**Scope:** Strong review of the complete material history-repair delta from 766d to the current exact candidate: all 15 author paths, all 14 existing history producer branches, the incoming disjoint two-path composition, and the exact 40-path net candidate inventory as preserved in the composition receipt. The prior full 30-path ordinary review remains the coverage for the inherited portion; this report does not claim a new full review of all 40 paths.

## Verdict

**BLOCK — the prior B1 is closed in source, with one new test-oracle finding.** Moving the existing history writes into their owning task transactions closes the archive/revocation/inactivation delivery race without a synthetic session identity. However, the new mapping test selects the first priority and due-date rows from an unordered SQL result even though it creates two rows of each type and expects a particular chronological row. Those assertions depend on row order the query does not promise and can fail under a valid PostgreSQL plan.

## Prior B1 disposition: closed

The prior B1 was that `recordTaskEventActivity` ran after the successful task transaction and its repository insert could return no row if the project was archived/deleted before the asynchronous event subscriber ran, dropping committed history. At the current head:

- All seven activity history listeners are removed from `apps/api/src/activity/index.ts`, and the synthetic `resolveActorIdentity(userId)` path is removed from `apps/api/src/activity/controllers/create-activity.ts` and `apps/api/src/activity/repository.ts`.
- The existing `insertRequiredTaskActivity(executor, identity, values)` wraps the shared current-reach/live-project INSERT…SELECT and throws when it returns no row. Its callers now await it within the same transaction as each successful legacy task mutation. Thus archive, deletion, revocation or inactivation after that commit cannot retroactively remove the row; if persisted reach is lost before the insert within the transaction, the zero-row result aborts the mutation.
- Event publication remains after commit for the other subscribers. I found no remaining `recordTaskEventActivity` call or duplicate activity listener.
- The task/create, import, move, direct status/priority/assignee/unassign/due-date, standard update status branch, and bulk status/priority/assignee/unassign/due-date branches preserve the former listener's actor, type, null content, and eventData mapping. Create and import retain their distinct `created`/`create` type values. Import still skips the history row when its optional actor is missing, as the former listener's guard did. Bulk's omitted old status/priority values remain omitted after JSONB serialization, matching the prior event listener shape. Due-date values retain ISO conversion semantics. No event payload or other post-commit event was removed.
- Existing task/project lock calls remain in the owning transactions; the insertion uses the already supplied executor and resolved request identity. No new lock or changed lock order is introduced by the history insert.
- The test source has producer-count/mapping coverage, a transaction rollback case for an invalid history actor FK, and a trigger-barrier current-reach revocation case on the title producer that asserts task rollback, no history, and no events. The archive test exercises the real status route then archives, revokes the grant, inactivates the actor and confirms the one committed activity remains.

The trigger-barrier revocation test currently exercises the title producer rather than the status producer. The same required helper and transaction boundary is shared, and the status path separately has a rollback assertion when its insert errors. A status-specific AFTER UPDATE revocation barrier would improve local coverage of that producer's placement, but I do not find it necessary as an independent blocker given the existing no-row helper test plus status insert-error rollback test. No runtime assertion is inferred from these authored tests.

## Blocking finding

**B2 — The mapping test assumes an unordered query returns a specific first row.**

In `tests/api-integration/task-title-activity.test.ts`, `taskHistory` is fetched with `SELECT … WHERE task_id = …` and no `ORDER BY`. The test writes both a direct and a bulk `priority_changed` row, then uses `taskHistory.find(({ type }) => type === "priority_changed")` and expects the direct high-priority event (`medium → high`). It similarly writes two `due_date_changed` rows, then uses the first type match and expects the direct date event (`null → 2026-12-01`). PostgreSQL is free to return either row first. The subsequent assertions already use eventData filters for the bulk low-priority and second due-date rows, which is the deterministic pattern to use for the first cases too (or sort with a documented stable key). This is the same invalid-order assumption class as the just-composed #809 fixture correction and can make the new integration test fail despite correct stored event rows.

The specific source assertions are around the `taskHistory.find` calls for `priority_changed` and `due_date_changed`; no database execution was performed by this reviewer.

## Exact scope and composition

The 15 author paths changed from the prior reviewed head are:

- `apps/api/src/activity/controllers/create-activity.ts`
- `apps/api/src/activity/index.ts`
- `apps/api/src/activity/repository.ts`
- `apps/api/src/task/controllers/bulk-update-tasks.ts`
- `apps/api/src/task/controllers/create-task.ts`
- `apps/api/src/task/controllers/import-tasks.ts`
- `apps/api/src/task/controllers/move-task.ts`
- `apps/api/src/task/controllers/update-task-assignee.ts`
- `apps/api/src/task/controllers/update-task-due-date.ts`
- `apps/api/src/task/controllers/update-task-priority.ts`
- `apps/api/src/task/controllers/update-task-status.ts`
- `apps/api/src/task/controllers/update-task.ts`
- `tests/api-integration/activity-relation-time-entry-crud.test.ts`
- `tests/api-integration/project-archive-freeze-legacy.test.ts`
- `tests/api-integration/task-title-activity.test.ts`

The disjoint incoming composition paths are `docs/07-planning/security-reviews/query-ownership-task-580.md` and `tests/api-integration/work-item-comment.test.ts`. I inspected the incoming fixture edit: both actual and expected notification rows are sorted before strict equality, preserving the two-row and per-row read-state assertions. The composition receipt `query773-post-bb298-composition-proof.json` records 40 own path blobs conserved, two incoming paths, no overlap, exact composed HEAD and `notAcceptance: true`. Current net paths against bb298 are 35 API files and these five test files: `tests/api-integration/activity-relation-time-entry-crud.test.ts`, `tests/api-integration/project-archive-freeze-legacy.test.ts`, `tests/api-integration/storage-cleanup-assets.test.ts`, `tests/api-integration/task-title-activity.test.ts`, and `tests/api/time-entry/update-time-entry.test.ts`, for 40 total. The two incoming paths are already part of bb298 and are not counted in this net diff.

## Review limits

Read `AGENTS.md`, `CLAUDE.md`, `docs/04-engineering/agent-workflow.md`, the active mission, the comments/activity and query-ownership authorities, the prior full ordinary B report, the author repair evidence, the independent bounded Sol design-adviser report, the pre-edit preservation manifest, and the exact composition receipt. The adviser report was used as architecture context only and is not counted as approval. No tests, probes, PostgreSQL, builds, Docker, browser, CI, pushes, PR operations, source changes, or central-document edits were performed by this reviewer. This report does not accept #809, clear the security review, or assert runtime behavior, merge readiness, or whole #773 completion.


## Evidence file

`query773-timeentry-archive-mapping-fixture-author-luna.md`

# #773 archived time-entry and mapping-fixture repair — author evidence

This is a bounded author record, not an independent review, acceptance, or PostgreSQL verification. The branch remains stacked on unaccepted #809 source; this commit does not claim that dependency is accepted or that #773 is complete.

## Source identity and scope

- Branch: `codex/773-current-main-luna`
- Base before this batch: `0f7b0a9603848c1cb10ffcd5ea29a99ca44c5101`
- Commit: `880fbac20ecac94040722d057561c5c428fa6ef9`
- Parent: `0f7b0a9603848c1cb10ffcd5ea29a99ca44c5101`
- Worktree: `/Users/heinthura/.codex/worktrees/query773-current-luna`
- Worktree status after commit: clean.
- Only four paths changed:
  - `apps/api/src/time-entry/repository.ts`
  - `apps/api/src/time-entry/controllers/update-time-entry.ts`
  - `tests/api/time-entry/update-time-entry.test.ts`
  - `tests/api-integration/task-title-activity.test.ts`

## Changes and preserved behavior

Time-entry reads retain current-identity project reach and continue excluding deleted projects, while permitting reads for archived projects as required by the archived read-only behavior. Time-entry UPDATE DML still requires a nondeleted, nonarchived project. A new mutation-target query returns only the entry ID and task ID under current identity reach, without returning entry content or suppressing archived/deleted parents. The controller uses those facts to perform the established task-then-project lock/live check inside the transaction; only after that succeeds does it load full entry data through the read-scoped repository function in the same transaction, validate duration, and execute the existing live-scoped UPDATE. Thus archived/deleted mutation requests reach the existing `Task not found` liveness response before duration validation; missing/inaccessible entries retain `Time entry not found`. No route, permission, schema, dependency, lock order, event, or effect behavior was changed.

The existing four time-entry unit cases retain their duration, end-time, open-entry, and no-write assertions while adapting mocks to the mutation-target and transaction-bound read calls. The new mapping integration fixture directly seeds task number 1; it now synchronizes the project allocator counter before invoking the production allocator. Existing history selectors now choose the intended high-priority and first due-date events by their event payloads rather than unspecified SQL result order. The global 11-row/type/cardinality and event payload assertions remain present.

## Checks run

All listed commands ran in the isolated worktree; native exits are recorded.

- `pnpm --filter @taskdesk/api exec vitest run ../../tests/api/time-entry/update-time-entry.test.ts` — exit 0; 1 file, 4 tests passed. This focused unit command was run once.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json` — exit 0.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json` — exit 0.
- `pnpm exec biome check apps/api/src/time-entry/repository.ts apps/api/src/time-entry/controllers/update-time-entry.ts tests/api/time-entry/update-time-entry.test.ts tests/api-integration/task-title-activity.test.ts` — exit 0; 4 files checked.
- `git diff --check` — exit 0.
- Normal commit hook scoped Biome check — exit 0; no fixes applied.

## Not run / remaining evidence

No PostgreSQL, integration/Vitest, full test, build, Docker, browser, CI, push, or PR command was run in this batch. The mapping integration test changes are authored but not executed here.

The parent-owned PostgreSQL run at `0f7b0a9603848c1cb10ffcd5ea29a99ca44c5101` remains adverse evidence: 8/10 files, 122/124 tests, native exit 1, about 38.79 seconds. Raw log: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query773-runtime-0f7b0a96/vitest.full.log`; SHA-256 `af6b17375eed20269c63824c271aee5bebd110ef13703393b3b9a1f4ad102eb6`. Parent authorized the fixes above and plans the appropriate focused PostgreSQL verification; this author run does not resolve those failures.


## Evidence file

`query773-880f-ordinary-a-luna.md`

# #773 recovered candidate ordinary review A — repaired exact head

**Model:** GPT-6 Luna (requested model label; served-model fingerprint unavailable)
**Role:** Strong ordinary review A, current exact head
**Independence:** I did not author, direct, or remediate the source. This is the same reviewer context that reviewed the earlier 4304 head; that earlier report is disclosed and reused only for unchanged inherited source coverage. The newly changed source was independently inspected here. The candidate author used the earlier B1 report as repair input. No independent review of my own work is claimed.
**Reviewed head:** `880fbac20ecac94040722d057561c5c428fa6ef9`
**Comparison base:** `bb298c181c213e695c5a8e857679536d355df8aa` (unaccepted #809 source dependency; not treated as accepted main)
**Net scope:** 40 changed paths from comparison base to exact head. I reviewed the full 29-path source scope previously inspected at 4304 (`query773-4304-ordinary-a-luna.md`) and the complete source/test delta from 4304 through this exact head, including the intervening cumulative transaction-history repair and final time-entry archive-mapping repair. I inspected the complete 40-path net inventory and relevant final diff; this report does not claim a separate fresh line-by-line rereview of unchanged inherited hunks.

## Verdict

**BLOCKED by one repository test-policy violation.** I found no remaining blocking product correctness defect in the reviewed source. One integration test still uses a timed sleep to order rows, directly violating the repository’s “Never sleep()” test rule and leaving the assertion coupled to wall-clock timing. Remove the delay and make the ordering fixture deterministic before treating the candidate as clear.

## Finding

**B1 — Activity ordering test sleeps to manufacture timestamp separation.**

`tests/api-integration/activity-relation-time-entry-crud.test.ts:83` calls `await new Promise((resolve) => setTimeout(resolve, 15))` between two activity writes, then asserts newest-first order. The repository test standard (`docs/04-engineering/coding-standards.md`, Tests) says never to sleep. The delay also relies on scheduler timing to force distinct database timestamps. This is a narrow test-maintenance issue, not a finding that the production ordering query is incorrect. The root’s exact-head PostgreSQL run passed, but a successful run does not remove this explicit test-policy violation.

## Delta review and closed earlier findings

I inspected all changes from 4304 through 880f, including the complete transaction-history change (the intervening `cf88cbd` repair), and the final four-file time-entry/archive-fixture repair. Main review points:

- **DML shape repair:** The five partial Drizzle INSERT…SELECT projections from the prior B1 were expanded to the exact table-column sets and declaration order. I inspected explicit CUIDs, timestamps, null/default values and destination-column encoders in activity, relation, time-entry and project preference inserts. The source no longer has the construction-time mismatch found at 4304. The author’s source-only `.toSQL()` probe is recorded as author evidence; I did not repeat it or execute a test.
- **Relation correlation:** Inner relation aliases are separate for source and target, and each is correlated against the caller’s outer relation ID and endpoint. `listRelationsOfTask`, reads, and deletes apply current reach to both endpoints. Create/delete flows retain sorted task locking followed by sorted live-project locking and recheck reach before DML.
- **Task history:** Seven post-commit activity listeners were removed and the 14 existing producer branches now write their history row through the supplied transaction executor before commit. I traced create, import, move, direct status/priority/assignee/unassign/due-date, the standard status branch, and bulk status/priority/assignee/unassign/due-date. The prior type values (`created` versus `create`), actor, null content, event payload fields, ISO date conversion and omitted undefined bulk old-value fields are preserved. Event publication remains after commit. Required-row failure throws and rolls the mutation back. Import’s missing-actor guard remains. The archive/grant-revocation/user-inactivation test now verifies an already committed status history row survives later project archive and access changes, consistent with CA-10.
- **Time-entry update:** The preliminary query returns only ID/task ID under current identity reach. The controller enters the transaction, locks the task then requires a live project, rereads the full entry through that transaction, validates duration from the transactional row, and updates through the same executor with a live-project predicate. The final change keeps archived-parent reads available while mutation is denied. This matches PR-15’s rule that archiving a project retains data and makes work read-only. I kept that distinct from WI-20, which concerns archiving an individual work item. The test checks archived and soft-deleted project mutation responses before interval validation; it does not infer that project archival equals work-item archival.
- **Fixtures and oracles:** The task allocator fixture synchronizes `lastTaskNumber` after directly seeding task #1. Priority and due-date assertions now identify rows by payload rather than unspecified SELECT order. The time-entry unit fixture now mocks repository boundaries and asserts resolved identity and transaction-handle threading. The 766d report’s three adverse failures and 0f7 report’s two adverse failures remain retained in their original run directories; the corresponding final fixture/history changes address the reported activity-query, settings-route, allocator and event-order causes by source inspection.
- **Unaccepted composition:** The #809 content is still an unaccepted source dependency. This review makes no acceptance, merge-readiness or publication claim. The exact candidate’s net 40 paths are listed below; no inherited label-family global-conversion claim is made. The five legacy task lock helpers remain outside the claimed conversion scope.

## Exact net path inventory checked

The 40 net changed paths from `bb298c181c213e695c5a8e857679536d355df8aa` to the reviewed head are:

- `apps/api/src/activity/controllers/{create-activity,create-comment,delete-comment,get-activities,update-comment}.ts`
- `apps/api/src/activity/{index.ts,repository.ts}`
- `apps/api/src/comment/index.ts`
- `apps/api/src/storage/{cleanup-assets.ts,repository.ts}`
- `apps/api/src/task-relation/controllers/{create-task-relation,delete-task-relation,get-task-relations}.ts`
- `apps/api/src/task-relation/{index.ts,repository.ts}`
- `apps/api/src/task/controllers/{bulk-update-tasks,create-task,delete-task,import-tasks,move-task,update-task-assignee,update-task-description,update-task-due-date,update-task-priority,update-task-status,update-task}.ts`
- `apps/api/src/time-entry/controllers/{create-time-entry,get-time-entries,get-time-entry,update-time-entry}.ts`
- `apps/api/src/time-entry/{index.ts,repository.ts}`
- `apps/api/src/user-preference/{index.ts,repository.ts,service.ts}`
- `tests/api-integration/{activity-relation-time-entry-crud,project-archive-freeze-legacy,storage-cleanup-assets,task-title-activity}.test.ts`
- `tests/api/time-entry/update-time-entry.test.ts`

## Runtime evidence and limits

I read the root-owned exact-head runtime receipt and raw result. The 880f focused PostgreSQL run names four integration files, exited 0, passed 4/4 files and 61/61 tests in 22.375 seconds, and recorded cleanup inventory unchanged at 23 containers, 109 volumes and 7 networks. The run did not include `storage-cleanup-assets.test.ts`, so storage cleanup has no runtime verification in that receipt. The earlier 766d and 0f7 adverse runs remain preserved; they are not overwritten or represented as passes. These are conductor-owned runtime results, not tests run by this reviewer.

This reviewer performed source, documentation and bounded Git/evidence reads only. No tests, SQL probes, PostgreSQL, typecheck, build, browser, Docker, CI, code edits, shared-doc edits, push, PR, or publication action was performed. The residual storage cross-system atomicity noted in the prior review remains: external object deletion may succeed before the metadata delete transaction commits, leaving a row whose object is absent if the later database operation fails; failed object deletion itself still preserves the metadata row. This is a known residual, not a newly found blocker.

Guidance/specs read for this follow-up: `AGENTS.md`, `CLAUDE.md`, `docs/04-engineering/agent-workflow.md`, `docs/04-engineering/coding-standards.md`, the active mission, `docs/03-features/comments-and-activity.md` (CA-10), `docs/03-features/projects-and-engagements.md` (PR-15), `docs/03-features/work-items.md` (WI-20, separately), `docs/03-features/time-and-cost.md`, profile settings ST-12–ST-16, storage architecture, schema declarations, and request-identity resolution.


## Evidence file

`query773-880f-ordinary-b-luna.md`

# Query773 ordinary review B — 880fbac

- Candidate: `880fbac20ecac94040722d057561c5c428fa6ef9`
- Delta base: `0f7b0a9603848c1cb10ffcd5ea29a99ca44c5101`
- Review type: bounded independent ordinary delta follow-up, GPT-6 Luna requested by the orchestrator. Served model fingerprint: unavailable in this context.
- Independence: fresh reviewer context; I did not author, direct, or remediate the four-file delta. Prior reviews of earlier heads are disclosed below and do not substitute for the current delta review.
- Worktree: `/Users/heinthura/.codex/worktrees/query773-current-luna`, clean at the reviewed head.

## Scope actually checked

Read the full four-path delta (`git diff 0f7b0a9..880fbac`):

- `apps/api/src/time-entry/controllers/update-time-entry.ts`
- `apps/api/src/time-entry/repository.ts`
- `tests/api-integration/task-title-activity.test.ts`
- `tests/api/time-entry/update-time-entry.test.ts`

Also inspected the applicable time-and-cost, projects-and-engagements (PR-15), and work-items (WI-20) contracts and relevant repository workflow instructions. This is a bounded delta review, not a rereview of all 40 candidate paths and not security clearance.

## Findings

**Verdict: CLEAR for this ordinary four-file delta by source inspection.** I found no blocking defect in the requested areas.

The earlier B2 issue is closed in the integration oracle. Priority and due-date assertions now select the event by both type and the expected new value in `eventData`, so they no longer rely on whichever duplicate type happens to appear first in an unordered query result. The fixture directly inserts task number 1 and now sets the project allocator's `lastTaskNumber` to 1 before it exercises production task creation; this closes the known fixture/allocator collision. The original mapping assertions remain specific enough to verify the expected old/new fields.

Time-entry mutation now first queries only the scoped mutation target facts (`id`, `taskId`) using the resolved current identity. It then opens a transaction, locks/asserts the reachable task and live project in task-then-project order, rereads the full entry through the transaction, validates against the current row, and performs the scoped update through that same transaction. The final update predicate requires a live project. This avoids loading the full time-entry row before the liveness barrier and ensures the effective preserved end time comes from the transactional reread. The current identity/reach predicates remain in both the preliminary target query and transactional reads/writes. I found no general deleted-content exception: project reads still exclude `deletedAt`; mutations additionally exclude archived projects.

Archived-project child reads are not a defect here. PR-15 explicitly says project archiving makes work read-only while retaining data; WI-20's separate archived work-item behavior does not redefine `project.archived_at`. The mutation path explicitly rejects archived projects, while read queries retain the PR-15 behavior.

The unit tests add coverage for the target lookup and transactional reread, but do not assert mock call ordering directly. The controller's straight-line implementation visibly performs lock before full reread, and I found no ordering flaw in that source. This is a test-strength limitation, not a blocker in the inspected delta.

## Validation and limits

I performed source and cheap Git inspection only; I did not run tests, PostgreSQL, typecheck, build, browser, Docker, or CI. The orchestrator separately reported that its exact-head four-file PostgreSQL run passed 61/61 (native exit 0); that is conductor-reported evidence, not a run by this reviewer.

My earlier review at `766d69c7a49e4ff11855dd02ad99bea4e9f9ad60` found a blocker in the then-current activity-history behavior; my `0f7b0a9603848c1cb10ffcd5ea29a99ca44c5101` delta review confirmed its transactional repair and found B2. Those scoped findings are preserved in their separate reports. This review only confirms the requested subsequent four-file delta. It does not accept the unaccepted dependency, authorize publication, establish whole-candidate security clearance, or claim review of all 40 paths.


## Evidence file

`query773-880f-full-ordinary-c-luna.md`

# #773 recovered candidate full ordinary review C

**Requested model:** GPT-6 Luna. The served-model fingerprint is unavailable in this environment; I do not claim a verified fingerprint.

**Role:** Fresh independent full ordinary review.
**Independence:** I did not author, direct, or remediate this candidate. This is a separate review context. I read the previous review reports and author evidence as retained evidence and to understand known repair history; I independently inspected the pinned source. The report is not a security review or runtime acceptance.
**Reviewed source:** `880fbac20ecac94040722d057561c5c428fa6ef9`.
**Comparison base / unaccepted dependency:** `bb298c181c213e695c5a8e857679536d355df8aa`.
**Net scope:** all 40 changed paths from the comparison base to the reviewed source. The exact source was pinned with `git show 880fbac…:<path>` where the shared worktree changed during this review. A concurrent author edit to `tests/api-integration/activity-relation-time-entry-crud.test.ts` appeared after review began; that unstaged edit is outside this verdict and was not reviewed as candidate source.

## Verdict

**BLOCKED — one test-policy blocker.** The source review found no additional blocking product defect in the inspected API, repository, transaction, reach, task-history, time-entry, settings, relation, or storage paths. The current candidate’s integration test deliberately sleeps to produce ordering and violates the repository’s explicit test standard.

## Finding

**B1 — `tests/api-integration/activity-relation-time-entry-crud.test.ts:83` uses a timed sleep to manufacture timestamp order.** The test waits 15 ms between two real activity POSTs and then asserts newest-first results. `docs/04-engineering/coding-standards.md` § Tests says “Never `sleep()`. Wait for a condition.” Besides violating that rule, 15 ms does not guarantee distinct database timestamps under load or different timestamp precision. Make the fixture’s ordering deterministic while retaining both real POSTs and the feed assertions. This finding applies to the pinned `880fbac` content only; I have not reviewed the uncommitted deterministic-timestamp edit now visible in the shared worktree.

## Full source inspection and disposition

I inspected the full net diff/path inventory and current source at the exact candidate, including the route identity adapters, controller delegation, repository predicates, SQL projections, transaction boundaries, all 14 task-history producer branches, changed tests, and the relevant contracts. The 40 net paths are:

- `apps/api/src/activity/controllers/create-activity.ts`
- `apps/api/src/activity/controllers/create-comment.ts`
- `apps/api/src/activity/controllers/delete-comment.ts`
- `apps/api/src/activity/controllers/get-activities.ts`
- `apps/api/src/activity/controllers/update-comment.ts`
- `apps/api/src/activity/index.ts`
- `apps/api/src/activity/repository.ts`
- `apps/api/src/comment/index.ts`
- `apps/api/src/storage/cleanup-assets.ts`
- `apps/api/src/storage/repository.ts`
- `apps/api/src/task-relation/controllers/create-task-relation.ts`
- `apps/api/src/task-relation/controllers/delete-task-relation.ts`
- `apps/api/src/task-relation/controllers/get-task-relations.ts`
- `apps/api/src/task-relation/index.ts`
- `apps/api/src/task-relation/repository.ts`
- `apps/api/src/task/controllers/bulk-update-tasks.ts`
- `apps/api/src/task/controllers/create-task.ts`
- `apps/api/src/task/controllers/delete-task.ts`
- `apps/api/src/task/controllers/import-tasks.ts`
- `apps/api/src/task/controllers/move-task.ts`
- `apps/api/src/task/controllers/update-task-assignee.ts`
- `apps/api/src/task/controllers/update-task-description.ts`
- `apps/api/src/task/controllers/update-task-due-date.ts`
- `apps/api/src/task/controllers/update-task-priority.ts`
- `apps/api/src/task/controllers/update-task-status.ts`
- `apps/api/src/task/controllers/update-task.ts`
- `apps/api/src/time-entry/controllers/create-time-entry.ts`
- `apps/api/src/time-entry/controllers/get-time-entries.ts`
- `apps/api/src/time-entry/controllers/get-time-entry.ts`
- `apps/api/src/time-entry/controllers/update-time-entry.ts`
- `apps/api/src/time-entry/index.ts`
- `apps/api/src/time-entry/repository.ts`
- `apps/api/src/user-preference/index.ts`
- `apps/api/src/user-preference/repository.ts`
- `apps/api/src/user-preference/service.ts`
- `tests/api-integration/activity-relation-time-entry-crud.test.ts`
- `tests/api-integration/project-archive-freeze-legacy.test.ts`
- `tests/api-integration/storage-cleanup-assets.test.ts`
- `tests/api-integration/task-title-activity.test.ts`
- `tests/api/time-entry/update-time-entry.test.ts`

Review conclusions:

- **Request identity and scope:** Activity, comment, relation, time-entry and preference endpoints pass the identity resolved from the authenticated user, API-key facts, and session impersonation marker into repository operations. Existing permission middleware remains on each route. Preference writes still pass through `requireSessionOnly`; reads and writes key rows to `identity.personId`. Relation mutation continues to require the route’s `work_item:update` checks on both endpoints; the repository independently predicates both endpoint reach on current persisted grants.
- **Repository SQL and DML:** Activity, time-entry, relation, preference and storage statements live in repository modules and accept the supplied `Executor` where they participate in a transaction. I compared the five INSERT…SELECT projections against the exact Drizzle schema declaration order and destination-column encoders/defaults: task activity insert, comment activity insert, task relation insert, time entry insert and project-scoped preference upsert. The projections include all required/defaulted destination columns and explicit null/default values; I found no remaining SQL-shape mismatch. The relation endpoint helper aliases the inner relation/task/project rows and correlates each endpoint to the outer relation row, and list/delete predicates require reach to both ends.
- **Transaction/history conservation:** I traced the seven existing event keys and their 14 producer branches: task creation, import, move, direct/status update, standard update’s status branch, direct and bulk priority, direct and bulk assignment/unassignment, direct and bulk due-date, and bulk status. The inserted history row uses the prior event mapping (`created` vs `create`, actor, null content, payload keys, ISO date conversion and intentionally omitted undefined bulk old values) inside the existing transaction; publication remains post-commit. Insert refusal throws and rolls back the corresponding mutation. I found no extra listener or producer for the removed seven activity subscriptions and no added internal-producer exception. The legacy task lock-helper paths outside the claimed repository conversion were not represented as converted.
- **Storage cleanup:** Description/comment/activity reference checks and asset selection/deletion remain scoped to the same task and current persisted project reach; every database operation uses the provided executor. A failed object deletion leaves its asset row. External object deletion still precedes metadata-row deletion while the caller’s database transaction is open, so a later database rollback can leave an object deleted while its row remains. This cross-system atomicity limitation was already disclosed in the retained author/reviewer evidence; I did not find a new regression or treat it as a separate blocker in this review.
- **Time-entry archive contract:** The preflight query returns only entry ID/task ID. The mutation locks the task then checks the project is live, rereads the full entry through the transaction, computes duration from the transactional row, and performs the current-reach/live-project update through that same transaction. Reads keep time entries on archived projects available; mutations reject archived or deleted projects before interval validation, consistent with PR-15. The project archive rule was kept distinct from individual work-item WI-20. The fixture’s direct task-number insert synchronizes the allocator counter; event assertions select intended rows by payload rather than unordered type-only selection.
- **Settings:** The patch path validates all keys before writes, checks live project reach before SET, keeps stale own-row clearing independent of project reach, serializes each person’s writes, applies clears before the exact 500-row cap calculation, and rechecks project reach in the upsert SELECT. The density `.values()` upsert remains unchanged. The GET projection still filters to caller-owned whitelisted rows and omits unreachable/deleted/archived project layouts.
- **Runtime/test evidence:** I did not run tests, typecheck, SQL probes, PostgreSQL, build, browser, Docker or CI. The root’s receipt and previous reviewer evidence are not evidence of work run by me. The root-provided exact-head PostgreSQL receipt is 4/4 files and 61/61 tests, but does not include `storage-cleanup-assets.test.ts`; this report does not enlarge that runtime claim. The prior 766d and 0f7 adverse runs remain retained and are not overwritten or re-described as passes.

## Guidance and source material read

`AGENTS.md`, `CLAUDE.md`, `docs/07-planning/active-mission.md`, `docs/04-engineering/agent-workflow.md`, `docs/04-engineering/coding-standards.md` (including query ownership, transactions, tests and security), `docs/03-features/time-and-cost.md`, `docs/03-features/comments-and-activity.md`, `docs/03-features/relations-and-hierarchy.md`, `docs/03-features/projects-and-engagements.md` (PR-15), `docs/03-features/work-items.md` (WI-20), `docs/03-features/settings-hierarchy.md` (ST-12–ST-16), `docs/01-architecture/data-model.md`, request-identity resolution, and the three assigned private author reports. The previous ordinary reports were read as retained review history; they do not replace this full current-source review.

## Limits and residuals

The dependency SHA `bb298c181c213e695c5a8e857679536d355df8aa` is unaccepted source and is not treated as accepted `main`. This ordinary verdict does not authorize merging, publishing, dependency acceptance, or completion. Per the exact-head direction from the conductor, any source change after `880fbac` requires a review bound to the new SHA; I have not approved a subsequent test-only delta. No code or shared repository documents were edited.


## Evidence file

`query773-activity-order-fixture-author-luna.md`

# #773 activity ordering fixture repair — author evidence

This is a one-file test-fixture repair, not an independent review or runtime verification.

## Source identity and scope

- Branch: `codex/773-current-main-luna`
- Base: `880fbac20ecac94040722d057561c5c428fa6ef9`
- Commit: `d7f628fa89cedc25d610f93c5bd49ce6ae9c2df9`
- Parent: `880fbac20ecac94040722d057561c5c428fa6ef9`
- Only changed path: `tests/api-integration/activity-relation-time-entry-crud.test.ts`
- Worktree after commit: clean.

## Change

Removed the 15 ms sleep between the two real `POST /api/activity/create` requests. The test now parses both successful responses, asserts each returned ID exists and is distinct, then assigns fixed distinct `createdAt` values to those exact persisted IDs. It verifies both rows and their timestamps are present before calling the existing GET endpoint. The newest-first ordering assertion, blank-line normalization assertion, and `eventData` checks remain intact. No production/API source changed.

## Checks and limits

- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json` — exit 0 (run twice during this bounded edit).
- `pnpm exec biome check tests/api-integration/activity-relation-time-entry-crud.test.ts` — initial invocation found only a formatting issue; after manual formatting, exit 0. The commit hook’s scoped Biome check also exited 0.
- `git diff --check` — exit 0.
- No unit, integration, PostgreSQL, build, browser, Docker, CI, push, or PR command was run. The root is responsible for the authorized focused PostgreSQL run.

This branch remains stacked on the previously unaccepted #809 source dependency. This report and commit make no acceptance or completion claim.


## Evidence file

`query773-d7f6-ordinary-a-luna.md`

# #773 activity-order fixture closure — ordinary review A

**Model:** GPT-6 Luna (requested model label; served-model fingerprint unavailable)
**Role:** Bounded ordinary review A follow-up
**Independence:** I did not author, direct, or remediate this one-file change. This is the same reviewer context as the prior ordinary A reports; the exact new delta was reviewed independently from the author. No independent review of my own work is claimed.
**Reviewed head:** `d7f628fa89cedc25d610f93c5bd49ce6ae9c2df9`
**Comparison base:** `880fbac20ecac94040722d057561c5c428fa6ef9`
**Scope:** Complete one-file delta in `tests/api-integration/activity-relation-time-entry-crud.test.ts` only. This is not a fresh rereview of the inherited 40-path candidate.

## Verdict

**CLEAR for this bounded delta.** Finding B1 from `query773-880f-ordinary-a-luna.md` is closed: the test no longer sleeps and now pins ordering through exact persisted rows with distinct timestamps.

## B1 disposition

The test performs both real `POST /api/activity/create` calls, checks successful statuses, parses both activity IDs, and verifies they are present and distinct. It writes fixed `createdAt` timestamps to those exact IDs, queries the persisted rows by those IDs, and verifies both timestamps before requesting the activity feed. The original newest-first assertion, blank-line normalization assertion, and `eventData` assertions remain. This removes wall-clock timing as the fixture’s ordering mechanism and complies with the repository’s no-sleep test rule.

I inspected the one-file diff and the author report `query773-activity-order-fixture-author-luna.md`. I did not run the author-reported typecheck or Biome checks and did not run tests or PostgreSQL.

## Coverage and limits

The earlier ordinary A reports remain the source for inherited coverage: `query773-4304-ordinary-a-luna.md` covers the 29-path 4304 scope; `query773-880f-ordinary-a-luna.md` reviews the full cumulative 4304→880f delta and records coverage of all 40 net paths against `bb298c181c213e695c5a8e857679536d355df8aa`. This report adds only the exact one-file delta through d7f. It does not claim a fresh review of all 40 paths, whole #580 completion, security review, acceptance of the unaccepted #809 dependency, runtime verification, or merge readiness.

No tests, probes, typecheck, build, PostgreSQL, browser, Docker, CI, source edits, shared-document edits, push, or PR action were performed by this reviewer.


## Evidence file

`query773-d7f6-full-security-61-sol.md`

# #773 recovered successor — independent full security review

**Requested model:** GPT-6.1 Sol. The served-model/version fingerprint is unavailable in this context; no independently verified fingerprint is claimed.
**Role:** Fresh independent FULL security review, not a bounded confirmation, ordinary review, design-adviser approval, or runtime acceptance.
**Reviewer context:** `/root/query773_d7f6_full_security_sol`.
**Independence:** I did not author, direct, or remediate this candidate or its earlier repairs. I independently inspected the source. Prior ordinary/author reports were evidence of history and coverage only; their conclusions did not substitute for source inspection. The earlier Sol design-adviser context is not this context and is ineligible as approval; it is not counted here.
**Reviewed head:** d7f628fa89cedc25d610f93c5bd49ce6ae9c2df9
**Comparison base / unaccepted dependency:** bb298c181c213e695c5a8e857679536d355df8aa (#809 source; not accepted main).
**Worktree:** `/Users/heinthura/.codex/worktrees/query773-current-luna`.
**Freeze:** HEAD matched the requested SHA and `git status --short` was empty at entry and again after source/evidence inspection. The report creation also asserted exact HEAD and a clean worktree. Source was unchanged throughout this review.
**Review time:** 2026-10-16 UTC (host clock; local date 2026-10-17).

## Verdict and findings

**CLEAR for the full 40-path source scope at the exact reviewed head.** No blocking security or correctness finding was identified in this scope. No new non-blocking defect was identified. This is source security clearance only; it is not merge readiness, dependency acceptance, publication authorization, whole-#580 completion, or runtime/SIT acceptance.

Severity: critical 0; high 0; medium 0; new low 0. The inherited storage cross-system atomicity limitation below remains disclosed, not waived or newly repaired by this verdict.

The ordinary A/C sleep finding is independently closed by the current source: both real activity POSTs still run, both successful statuses and distinct nonempty IDs are checked, fixed distinct timestamps are written to exactly those IDs and verified from persisted rows, and the real GET still verifies newest-first content, newline normalization, and both eventData cases. The removed 15 ms sleep is not replaced with another timing assumption. Only this test file changed from 880fbac20ecac94040722d057561c5c428fa6ef9 to the reviewed head.

## Security analysis actually performed

1. **Identity, capabilities and SQL reach.** I traced the activity, comment, relation, time-entry and preference route adapters from authenticated context through `resolveRequestIdentity`, including API-key facts and the session impersonation marker. Existing workspace/project capability middleware remains present. The canonical resolver refuses absent/inactive/banned identities and invalid key-owner facts; the adapters do not synthesize a session identity for event producers. The new cross-organisation data statements use the resolved identity and the current persisted project-reach predicate in the same SQL statement. Extra task/project/workspace IDs narrow those predicates. I examined the canonical scoped-role validity checks, current admin check, direct project grants and workspace sees_all branch used by the imported reach helper. This review does not reapprove the entire unaccepted dependency that supplies that helper or claim that reach predicates replace capability enforcement.

2. **Activity and comment safety.** Task-backed activity reads are correlated to their outer activity row and ordered by createdAt descending. Own-comment reads and DML retain activity ID, author and type=comment predicates; update/delete require a currently reachable live project in their DML as well as the controller's task-then-project locks. The shared comment controller aliases still connect both router families. Returned-row failures are handled. Activity create and comment create use the supplied transaction executor and admitted task rather than trusting a body task ID. Actor name lookup is invoked for the authenticated actor, not a client-selected target person. Existing notification/event publication remains after the comment transaction. The inherited route/capability asymmetries documented in policy files are not represented as a newly completed native comment/portal implementation.

3. **INSERT SELECT construction and encoding.** I compared all five new write projections with the current exact Drizzle schema declaration order: task activity, comment activity, task relation, time entry, and project preference. They contain the full destination column set, explicit generated IDs/default timestamps, nullable external fields, and destination-column `sql.param` encoders for JSONB, dates and other values. Time-entry undefined duration uses the schema default 0 while explicit null is preserved. Project preference conflict targets and partial-index predicates match the declared indexes; the global density values-upsert branch remains intact. No SQL concatenation of request data, new schema, new capability or general internal-producer exception was introduced.

4. **Relations: both endpoints and correlation.** Inner relation/task/project aliases are distinct from the outer relation. Each nested source/target predicate binds to that outer relation ID and endpoint, preventing an unrelated reachable relation from satisfying the check. Read, list and delete predicates require current reach to both ends. Insert derives both endpoints from separately admitted live task/project joins and enforces the same workspace. The controller retains source and target capability checks. Creation/removal lock unique tasks in stable order, then unique live projects in stable order; duplicate/self/missing-target handling and same-workspace enforcement remain. I examined the direct repository foreign-endpoint regression as well as the API shape/oracles.

5. **Transactional task history, all 14 existing producer branches.** I traced create, import, move; direct status and standard-update status; direct priority; direct assignment and unassignment; direct due date; bulk status, priority, assignment, unassignment and due date. All write the former listener mapping through `insertRequiredTaskActivity` inside the owning mutation transaction. Zero-row insertion throws and rolls back the mutation; database insertion errors likewise abort it. The seven duplicate asynchronous history subscribers and synthetic actor-resolution path are gone. The old `created` versus `create` values, actor IDs, null content, payload fields, JSON date conversion, undefined bulk old-value omission and optional import/standard-update actor guards are preserved. Other event publication remains post-commit, including relation refresh. A committed journal row is no longer dependent on later archive, actor activity or grant state. I searched all source references to the seven event keys and found no omitted publisher or remaining duplicate activity subscriber. Existing title behavior was examined as a neighboring transaction/rollback regression, not counted as a changed producer.

6. **Time-entry ordering and archive contract.** The preflight returns only ID/task ID under current reach, including for an archived/deleted parent so the established mutation error can be selected by the live-parent lock. The controller then locks the task and live project, rereads full entry data through the same transaction, validates using the reread preserved end time, and runs the live-project/current-reach UPDATE on that executor. The full-content read excludes deleted projects; mutation also excludes archived projects. The minimal preflight is internal and does not return deleted entry content. Archived-project reads remain available under PR-15's retained-data/read-only rule; this was kept distinct from WI-20's individual work-item archive rule. New unit assertions retain duration/end-time/no-write cases and identity/executor threading. They do not directly assert mock invocation ordering, but the actual controller sequence is explicit and correct.

7. **Storage cleanup.** I traced every changed call site and the complete cleanup/repository path. Cleanup runs from a caller transaction that holds the task/project locks; all database queries use that executor and current reach. Asset selection binds task, project and workspace; reference scans stay on the same task across description, legacy task comments and activity. Returned asset IDs scope deletion. Failed S3 deletion is excluded from metadata deletion and therefore preserves its row. An unreachable task produces no selected assets and no storage deletion. Task deletion obtains object keys on the same transaction handle before deleting the task. No new external cleanup authority or blanket repository exception was added.

8. **Personal settings.** Route writes retain session-only rejection of API keys and impersonation before validation. Reads/writes derive the person ID from resolved identity. The service validates the closed whitelist and all values before writes; stale own-row clearing requires no project reach and remains indistinguishable. Sets preflight live project reach and recheck it in the upsert SELECT. Per-person advisory locking, clears-before-count order, exact row-cap logic and partial-index conflict handling remain. Returned settings filter caller-owned whitelisted values and inaccessible/deleted/archived project layouts. No caller can supply another person's ID through the route.

## Files actually examined

I read the complete current contents of all 35 changed API files and all five changed test files (including unchanged surrounding content in the large legacy archive and title suites), and inspected the comparison inventory and relevant before/after diffs. This is full current 40-path coverage, not reuse of earlier partial reviewer coverage.

- `apps/api/src/activity/controllers/create-activity.ts`
- `apps/api/src/activity/controllers/create-comment.ts`
- `apps/api/src/activity/controllers/delete-comment.ts`
- `apps/api/src/activity/controllers/get-activities.ts`
- `apps/api/src/activity/controllers/update-comment.ts`
- `apps/api/src/activity/index.ts`
- `apps/api/src/activity/repository.ts`
- `apps/api/src/comment/index.ts`
- `apps/api/src/storage/cleanup-assets.ts`
- `apps/api/src/storage/repository.ts`
- `apps/api/src/task-relation/controllers/create-task-relation.ts`
- `apps/api/src/task-relation/controllers/delete-task-relation.ts`
- `apps/api/src/task-relation/controllers/get-task-relations.ts`
- `apps/api/src/task-relation/index.ts`
- `apps/api/src/task-relation/repository.ts`
- `apps/api/src/task/controllers/bulk-update-tasks.ts`
- `apps/api/src/task/controllers/create-task.ts`
- `apps/api/src/task/controllers/delete-task.ts`
- `apps/api/src/task/controllers/import-tasks.ts`
- `apps/api/src/task/controllers/move-task.ts`
- `apps/api/src/task/controllers/update-task-assignee.ts`
- `apps/api/src/task/controllers/update-task-description.ts`
- `apps/api/src/task/controllers/update-task-due-date.ts`
- `apps/api/src/task/controllers/update-task-priority.ts`
- `apps/api/src/task/controllers/update-task-status.ts`
- `apps/api/src/task/controllers/update-task.ts`
- `apps/api/src/time-entry/controllers/create-time-entry.ts`
- `apps/api/src/time-entry/controllers/get-time-entries.ts`
- `apps/api/src/time-entry/controllers/get-time-entry.ts`
- `apps/api/src/time-entry/controllers/update-time-entry.ts`
- `apps/api/src/time-entry/index.ts`
- `apps/api/src/time-entry/repository.ts`
- `apps/api/src/user-preference/index.ts`
- `apps/api/src/user-preference/repository.ts`
- `apps/api/src/user-preference/service.ts`
- `tests/api-integration/activity-relation-time-entry-crud.test.ts`
- `tests/api-integration/project-archive-freeze-legacy.test.ts`
- `tests/api-integration/storage-cleanup-assets.test.ts`
- `tests/api-integration/task-title-activity.test.ts`
- `tests/api/time-entry/update-time-entry.test.ts`

Additional source inspected: `apps/api/src/database/executor.ts`; `apps/api/src/database/repositories/identity-scope.repository.ts`; the relevant task_activity, time_entry, task_relation, asset and user_preference schema declarations; request-identity resolution and relevant canonical resolver admission branches; comment controller reexports; existing task/project lock helpers; session-only enforcement; activity/time-entry/relation/preference policy declarations; and source-wide event-key references. These additional targeted reads do not claim full review of every dependency file.

## Instructions and contracts read

Repository AGENTS.md, CLAUDE.md, active mission, agent workflow, current dated status/queue checkpoint and newest decision-log entries; coding standards/query ownership/transaction/test/security rules; CI/CD security path list; multi-tenancy query scoping and security-model query rules; comments-and-activity (including CA-10), relations-and-hierarchy, time-and-cost, project PR-15, individual work-item WI-20, and settings ST-12–ST-16. The native feature contracts were read with the explicit legacy-table distinction in schema/policy; this refactor is not a claim that their future/native feature scope is complete.

Read retained author reports for DML shape, transactional history, time-entry archive mapping and deterministic ordering. Read the ordinary A 880f report and d7f closure, B history/four-file follow-ups and C full-40 report. Their adverse records remain intact. Their findings were checked against source; the fresh full source pass above provides this security verdict.

## Commands, runtime evidence and limits

This reviewer ran read-only `pwd`, `git status --short`/`--porcelain`, `git rev-parse HEAD`, `git log`, `git diff --stat`/`--name-only`/`--numstat`/`--check`, bounded `git diff` comparisons, `rg`, `wc`, `cat`, `sed`, `tail`, `ls` and UTC clock reads. `git diff --check` for bb298..d7f exited 0. A first shorthand `git diff 880f ...` failed because the prefix was ambiguous (commit and blob); the read-only command was corrected to 880fbac2. Some oversized read outputs were truncated; the affected source ranges were subsequently read in bounded chunks. No source conclusion relies on unseen truncated lines.

Live GitHub reads: `gh pr list --state open`, `gh pr view 773 --json headRefName,headRefOid,mergeable,reviewDecision,statusCheckRollup`, and `gh issue list --state open --limit 30`. At inspection, historical draft #773 remained b289a288a85114e69ddfb5c9941203ede294fc22, not this local successor. Its checks are not current d7f checks. This report does not misattribute them.

No test, PostgreSQL command, SQL probe, typecheck, build, browser, Docker, CI action, source/shared-document edit, push, PR write or publication was performed by this reviewer. The only written artifact is this requested private report, created with mode 0600. No remediation was designed or implemented by this context.

Conductor-owned evidence inspected, not executed by me:

- `query773-runtime-d7f628fa`: exact-head receipt/result, cleanup receipt, raw log footer. Native exit 0; one integration file, 10/10 tests passed. It runs activity-relation-time-entry-crud only. The receipt records unchanged before/after inventory: 23 containers, 109 volumes, 7 networks. Raw log SHA-256 is c502cf8759e11986fc603e16e70e0dce92a8ac63f954f48cf617deafb4e338cb.
- `query773-runtime-880fbac2`: receipt/result and raw footer show native exit 0, four files/61 tests passed. Its inputs are source-bound to 880f; d7f changes only the deterministic test fixture and has its own one-file run above. I do not relabel this as an independently run full current suite.
- Older 766d and 0f7 result files still record native exit 1. Their author/reviewer records retain 99/102 and 122/124 respectively. They are adverse evidence, not passes. The subsequent source repairs and focused successes do not erase those runs.

Neither latest focused run includes storage-cleanup-assets. Storage has authored/source-inspected regressions and retained older-run context, not a newly obtained current-head runtime result from this review. Raw focused logs include realtime.failure diagnostics; their passing assertions do not establish websocket/delivery acceptance. No full integration, browser, image boot, health, signed artifact, SIT workflow or recovery acceptance is claimed here.

## Residuals and acceptance boundary

- **Inherited cross-system storage atomicity:** external object deletion precedes metadata deletion/transaction commit. A subsequent database failure or reach revocation can leave metadata whose object has already gone. Failed object deletion itself preserves metadata. This limitation is present in the retained design and is not a new regression identified here; no distributed-transaction or recovery guarantee is claimed.
- The five inherited task-lock helpers outside named repositories remain outside this batch's claimed conversion. The unchanged legacy comment-read path and other #580 batches are not swept into a whole-program ownership claim.
- The source dependency bb298 remains unaccepted. This verdict neither accepts #809 nor proves accepted-main composition. Required exact-head CI, applicable runtime/image/browser evidence and normal protected acceptance remain conductor-owned gates. Any later non-review-record source change requires the applicable exact-head delta review.

**Final verdict: CLEAR — full independent source security review of d7f628fa89cedc25d610f93c5bd49ce6ae9c2df9 against bb298c181c213e695c5a8e857679536d355df8aa, with the explicit evidence and acceptance limits above.**


## Evidence file

`accepted809-dual-composition-ordinary-luna.md`

# Accepted #809 dual composition — ordinary review

**Role/model:** Fresh independent ordinary reviewer, requested GPT-6 Luna route. I did not author, direct, or remediate either candidate. The review context exposes no served-model/version fingerprint, so none is asserted.
**Review date:** 2026-10-17
**Assignment:** Bounded composition and conservation check for the exact accepted-main merges listed below. This is not a restart of either complete source review.
**Operating scope:** Integration Freeze and SIT Consolidation; existing integration work only. Reviewed repository workflow, active mission, the query-ownership contract in `docs/04-engineering/coding-standards.md`, and the retained #580 task query scope. No feature scope was added.

## Candidate #773

- **Exact head:** `8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe`
- **Parents:** `55bc6954e3bfa343a521de9d96d15291f98aea6e` + accepted `main` `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`
- **Tree:** `d89adff97b4617f461c1f532fe6ee8c735e7c2da`, identical to prior source `55bc6954e3bfa343a521de9d96d15291f98aea6e`.
- **Worktree:** `/Users/heinthura/.codex/worktrees/query773-current-luna`, clean at inspection.
- **Prior full source security review:** `d7f628fa89cedc25d610f93c5bd49ce6ae9c2df9`, GPT-6.1 Sol, CLEAR over all 40 paths; its exact review and limits are in `query773-d7f6-full-security-61-sol.md`. The supplied full ordinary coverage and bounded follow-up reports also clear their stated scopes.
- **Composition checks:** exact head, parents, tree and clean status match `query773-post-accepted809-composition-proof.json`. Compared every recorded path/mode/blob from the pre-composition source proof against the candidate: **40/40 preserved**. `git diff --quiet 55bc... HEAD` succeeds, confirming no candidate source-tree delta from the already-reviewed composition. The accepted-main base is an ancestor through `894d7775b384794f1387114b2dd197673391d2cc`; accepted-main's two later commits are the notification-order fixture and review-note updates. The candidate's unchanged tree retains its existing source/test content and reviewed transaction/query seams. The composition proof reports no incoming path or overlap requiring a source conflict resolution.
- **Verdict: CLEAR for the #773 accepted-main composition.** No blocking or non-blocking composition finding identified. This only confirms the exact merge composition and conservation of the already-cleared 40-path source; it does not claim #580 completion, runtime/hosted acceptance, or general release readiness.

## Candidate #789

- **Exact head:** `88b7807378447cc74e584a37a48f277ddc1c34c8`
- **Parents:** `f7fb4cb6f8038deeb257709f776553023456c3d8` + accepted `main` `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`
- **Tree:** `831661ef18bd836b31538cff1bdbcf07693281bf`, identical to prior source `f7fb4cb6f8038deeb257709f776553023456c3d8`.
- **Worktree:** `/Users/heinthura/.codex/worktrees/query789-current-luna`, clean at inspection.
- **Prior full source security review:** `f7fb4cb6f8038deeb257709f776553023456c3d8`, GPT-6.1 Sol, CLEAR over all 15 paths; see `query789-f7fb-full-security-61-sol.md`. Three supplied independent ordinary reports clear their stated source scopes.
- **Composition checks:** exact head, parents, tree and clean status match `query789-post-accepted809-composition-proof.json`. Compared every recorded prior-source path/mode/blob against the candidate: **15/15 preserved**. Independently compared each of the 31 imported accepted-main paths against the exact accepted-main parent: **31/31 preserved**, with no overlap reported. The approval/work-item caller seams were included in the supplied source reviews; this composition changes no source tree blob from that reviewed head. Runtime evidence previously recorded at the source head is not promoted here into current hosted/full-suite/image/browser acceptance.
- **Verdict: CLEAR for the #789 accepted-main composition.** No blocking or non-blocking composition finding identified. This does not claim full hosted acceptance, or that the future full-hosted/runtime predicate has been met.

## Commands and limits

Read-only commands used: `git status --short --branch`; `git rev-parse HEAD`, `HEAD^{tree}` and parent SHAs; `git merge-base` / ancestry checks; `git diff --quiet` for source-tree equality; `git diff --name-status` for accepted-main deltas; `git ls-tree` comparisons for recorded mode/blob conservation; and `cat`, `sed`, `rg` to inspect the four proof records, active mission, query-ownership contract and relevant prior review verdicts. The #789 accepted-main path check covered all 31 recorded imported paths. No tests, build, install, PostgreSQL, Docker, browser, CI, GitHub mutation, source/ref/shared-record edit, push, PR or merge operation was performed. Neither candidate worktree was modified. The main checkout had pre-existing unrelated dirty files and was not used as a candidate checkout.

These are two separate composition verdicts. They do not approve either entire #580 feature, assert a full-hosted future runtime, clear any dependency outside the explicitly referenced exact reviewed source, or replace the requested fresh Sol composition/security confirmation.


## Evidence file

`accepted809-dual-composition-ordinary-correction-luna.md`

# Accepted #809 dual composition review — factual correction

**Purpose:** Correct and refine the exact-tree and imported-delta statements in `accepted809-dual-composition-ordinary-luna.md`. The original report is retained unchanged. This is a fresh, bounded ordinary composition review of the upstream import; it does not repeat the full #789 source review.

**Role/model:** Independent ordinary reviewer, requested GPT-6 Luna route; no served-model fingerprint is exposed. I did not author, direct or remediate either candidate. Review date: 2026-10-17.

## #789 correction and verified delta

The original report incorrectly stated that candidate `88b7807378447cc74e584a37a48f277ddc1c34c8` had the same whole-tree hash as prior source `f7fb4cb6f8038deeb257709f776553023456c3d8` and that composition changed no tree blobs. That statement is false and is withdrawn.

Direct Git inspection gives:

- Prior source tree at `f7fb4cb6f8038deeb257709f776553023456c3d8`: `6724a21f3396040c544b5325566d7af38515e1fc`.
- Composed candidate tree at `88b7807378447cc74e584a37a48f277ddc1c34c8`: `831661ef18bd836b31538cff1bdbcf07693281bf`.
- `git diff --name-status f7fb... 88b...` reports **31 changed paths** (6,413 insertions, 801 deletions). These are accepted-main imports; the source change is real and must not be described as tree-equal.
- Independently compared all 15 recorded #789-owned mode/blob entries from the pre-composition proof with the candidate tree: **15/15 preserved**.
- Compared every imported path against accepted-main parent `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`: **31/31 imported blobs preserved**. The prior proof and direct path-set comparison show no same-path overlap between those imports and the 15 #789-owned paths.
- Exact candidate parents remain `f7fb4cb6f8038deeb257709f776553023456c3d8` and accepted `main` `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`; worktree was clean on recheck.

### Bounded imported seam check

The 31-path delta is the existing task query-ownership batch: legacy `apps/api/src/task/**` repository/controller code, its query review record, and related task/reset integration fixtures. It does not change any of the 15 approval/work-item-owned paths. I checked the imported task repository and its concrete callers against the approval/work-item boundary, without rereading the full approval implementation:

- The imported legacy repository is expressed over `schema.taskTable`; the unchanged approval repository is expressed over `schema.workItemTable` and `schema.approvalTable`.
- Targeted searches found no imports from `apps/api/src/approval/**` or `apps/api/src/work-item/**` into the imported legacy task module/repository. The approval route/service continues to call its own work-item and approval repository helpers. The imported task routes continue to call their legacy task repository.
- The imported `tests/api-integration/helpers/database.ts` reset change is shared by approval integration tests. It retains the catalog-derived all-public-table reset and full `TRUNCATE ... RESTART IDENTITY CASCADE`; its new NOWAIT lock/retry wrapper is the test-only contention seam. The API integration Vitest config sets `fileParallelism: false` and `maxWorkers: 1`, consistent with the helper's all-table reset model. I did not run this suite, so no current-composition test result is claimed.
- The changed task/approval fixture files do not overlap by path. I found no source call-contract change crossing from the imported legacy task repository into approval decisions, approval closure, or native work-item transitions.

**Corrected #789 verdict: CLEAR for this bounded 31-path upstream composition delta.** No blocker or non-blocking incompatibility was identified by the path/blob and caller-seam inspection. This reuses the supplied exact-head ordinary and Sol reviews for the 15 owned approval/work-item paths only; it does not extend their findings to the imported paths. The imported changes' prior source reviews remain their evidence. No full-hosted/full-suite/image/browser or future runtime-predicate claim is made. The previously stated separate composition verdict remains CLEAR, now on this accurate bounded basis.

## #773 wording correction

Candidate `8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe` really is tree-equal to parent `55bc6954e3bfa343a521de9d96d15291f98aea6e`: both tree hashes are `d89adff97b4617f461c1f532fe6ee8c735e7c2da`, and `git diff --name-status 55bc... 8a...` is empty. The earlier description of the incoming content as two later commits was inaccurate: commits `435a4895f7f769d8fa713b167ab3273129aec017` and `894d7775b384794f1387114b2dd197673391d2cc` are already ancestors of `55bc`. The final merge adds the exact accepted-main parent metadata; it does not introduce a new tree delta from the already-composed `55bc` source. This correction does not change the separate #773 CLEAR verdict.

## Commands, boundaries and independence

Read-only checks used: `git rev-parse <sha>^{tree}`, `git diff --name-status` and `--stat` between exact source/candidate and recorded parents, `git merge-base --is-ancestor` for #773 ancestry, `git status --short --branch`, `rg` for task/approval/work-item imports and schema-table use, and `sed`/`rg` to inspect the integration test concurrency settings and reset helper. No tests, build, install, PostgreSQL, Docker, browser, CI, GitHub mutation, source/ref/shared-record edit, push or merge was performed. Both candidates remained clean and frozen. This report is written to a new path with exclusive creation and mode 0600.


## Evidence file

`accepted809-dual-composition-security-61-sol.md`

# Accepted #809 dual composition — independent bounded security confirmation

**Role/context:** Fresh independent security reviewer, `/root/accepted809_dual_composition_security_sol`. I did not author, direct or remediate either candidate. I performed no material repair design. No child agent was spawned.
**Requested dispatch provenance:** conductor-requested `gpt-6.1-sol`, `fork_turns=none`, `reasoning_effort=high`. Those are requested routing attributes, not independently attested serving metadata. The context identifies itself generically as GPT-6; an independently verifiable served-model/version fingerprint is unavailable. I do not assert one or claim to have inspected the parent spawn invocation.
**Attempt history:** The conductor reports that the earlier attempt in this lane hit a usage limit before producing a report or verdict, and explicitly requested continuation on these same frozen heads. That failed attempt supplied no approval. This completed report records the resumed inspection; it does not erase the failed dispatch.
**Review method:** Two separate bounded accepted-main composition/security confirmations after ordinary clearance, not new full-source reviews of the unchanged 40/15 owned paths.

## Instructions, evidence and ordinary prerequisite

Read the applicable accepted AGENTS, active mission, workflow review/evidence-reuse rules, provider adapter, coding/query-ownership contract, CI security scope, RBAC reach and security-model rules, current identity-scope implementation, and current candidate status/decision context. The primary checkout is old and has unrelated dirty files; initial orientation there was read-only and it was never treated as a candidate. Candidate guide blobs were independently verified equal to accepted `main@5a26ca75e60c7232ab8280a13e599fcbe4fd3518`. Integration Freeze and SIT Consolidation authorizes this existing-work composition scope.

Read both `accepted809-dual-composition-ordinary-luna.md` and its separately retained `accepted809-dual-composition-ordinary-correction-luna.md`. The original #789 whole-tree equality/no-source-delta statement is false, explicitly withdrawn, and excluded from this security reasoning. The correction provides separate CLEAR verdicts on the accurate bounded bases. I independently checked its factual claims rather than treating its conclusion as proof.

Read the four `query{773,789}-{pre,post}-accepted809-composition-proof.json` records, both prior full security reports, and the relevant accepted #809 review record, including its full-source and later notification-fixture/composition confirmations. Read `809-protected-acceptance.json`: accepted main is the normal protected #809 merge of publication `894d7775b384794f1387114b2dd197673391d2cc`, source `435a4895f7f769d8fa713b167ab3273129aec017`. Its recorded 18 contexts, 222 files/3,283 PostgreSQL tests/5 tasks, 22 G11 and 63 browser tests remain accepted-#809 evidence only. I did not re-execute or reauthenticate those runs and do not transfer them to these candidates.

## #773 — metadata-only final composition

**Reviewed head:** `8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe`

- **Worktree:** `/Users/heinthura/.codex/worktrees/query773-current-luna`.
- **Immediate comparison/source parent:** `55bc6954e3bfa343a521de9d96d15291f98aea6e`.
- **Other exact parent / accepted main:** `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`.
- **Both source-parent and candidate tree:** `d89adff97b4617f461c1f532fe6ee8c735e7c2da`.
- **Prior full source-security baseline:** `d7f628fa89cedc25d610f93c5bd49ce6ae9c2df9` against `bb298c181c213e695c5a8e857679536d355df8aa`, recorded in `query773-d7f6-full-security-61-sol.md` by fresh requested GPT-6.1 Sol context `/root/query773_d7f6_full_security_sol`, unavailable verified serving fingerprint. Its full 40-path scope and limits remain its own; this report does not relabel that work as newly performed.

Direct Git checks confirmed the exact parents, clean worktree, identical immediate-parent tree, zero incoming paths, and all **40/40 owned mode/blob entries** identical both to the proof inventory and to d7f. Candidate-minus-accepted-main is exactly those 40 owned paths. No extra candidate-only file appeared.

Inspected the intervening commit graph, not merely endpoint trees. Parent 55bc is the normal merge of d7f with publication 894d. Both 435a and 894d are already ancestors of 55bc. Accepted merge 5a26 is not itself an ancestor of 55bc, but has the identical tree to publication 894d; the final merge records that accepted parent without changing the already-composed source tree. Thus the final 8a merge is metadata-only; the earlier d7f-to-55bc composition did carry the accepted notification assertion fixture and own task-review-note update (two paths, 194 insertions/28 deletions).

I checked that actual fixture delta: sorting copies and deep equality retain exact IDs, row multiplicity/cardinality and per-row isRead state; no permission oracle is removed. Its accepted independent confirmation at 435a remains limited to that test repair. For the runtime coupling, targeted reads of create/move, required activity insertion, delete/storage cleanup and task-number claims still thread the same identity and transaction executor into task repository calls. Required activity insertion throws on refused admission, create/move history stays inside the transaction and events follow commit; claim allocation still throws on no admitted project result. Storage selection/deletion still uses the supplied transaction/current reach. No executor, schema, canonical identity predicate/resolver, event-index or notification-fanout blob changed from d7f. This is seam inspection and conservation, not a repeat full 40-file audit.

**Separate verdict: CLEAR for the bounded #773 accepted-main composition at 8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe.** Blocking findings: none. New non-blocking findings: none.

Retained residual: external object deletion and database metadata/commit are not a cross-system atomic transaction. A later DB failure/reach refusal can leave metadata for a deleted object; failed object deletion preserves its row. The prior full review discloses this limitation, and no new recovery guarantee or whole-#580 conversion is claimed.

## #789 — real disjoint accepted-main import

**Reviewed head:** `88b7807378447cc74e584a37a48f277ddc1c34c8`

- **Worktree:** `/Users/heinthura/.codex/worktrees/query789-current-luna`.
- **Immediate comparison/source parent:** `f7fb4cb6f8038deeb257709f776553023456c3d8`.
- **Other exact parent / accepted main:** `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`.
- **Prior tree:** `6724a21f3396040c544b5325566d7af38515e1fc`.
- **Composed tree:** `831661ef18bd836b31538cff1bdbcf07693281bf`.
- **Prior full source-security baseline:** f7fb against `c022915a8768b96b460c798feafafd7d48214d5c`, `query789-f7fb-full-security-61-sol.md`, fresh requested GPT-6.1 Sol context `/root/query789_f7fb_full_security_sol`, requested fork none/high with unavailable verified serving fingerprint. It covers all 15 owned approval/work-item paths only. Its full scope is retained, not silently extended to the 31 imports.

Direct Git checks confirmed the exact parents and clean worktree. This is a **real 31-path delta, 6,413 insertions/801 deletions**, not metadata-only and not tree-equal. Compared every own mode/blob: **15/15 preserved** against f7fb and the proof inventory. Compared every actual imported path with accepted parent 5a26: **31/31 preserved**. The actual incoming path list equals the proof list, with no same-path overlap. Candidate-minus-accepted-main is exactly the 15 owned paths. The import therefore contains no local conflict-resolution mutation or unaccounted candidate-only path.

The imported task module remains the legacy `taskTable` surface; the conserved approval repository binds `approvalTable` to native `workItemTable`. Targeted source/import inspection found no new direct task-repository dependency in approval service or native transition callers and no approval/native-work-item repository import into the changed legacy task module. Approval service still calls its own repository; the native transition explicitly calls approval lock/closure helpers. Both repositories compose the same current canonical project-reach helper, whose blob is unchanged from f7fb. The inspected shared executor/schema, request-identity resolver, caller-identity helper, event-index, notification fanout, native work-item activity/context and integration-config blobs likewise remain unchanged. This supports the bounded lack of new authority/caller-contract coupling; it does not independently re-audit all accepted task-source behavior.

The shared runtime-test seam is the imported database-reset helper. I inspected its complete current implementation and test configuration: non-test URL guard remains; public base-table names come from the catalog and are quoted; all-table NOWAIT ACCESS EXCLUSIVE locking and TRUNCATE RESTART IDENTITY CASCADE stay in one transaction. Only lock-statement SQLSTATE 55P03 is wrapped for bounded retry; rollback releases partial locks; unrelated errors propagate. Retry does not wrap approval/product actions. Integration configuration remains fileParallelism false/maxWorkers 1. No test was run here, so these source observations do not establish current composed-suite behavior or prove the cause of any historical reset reader.

**Separate verdict: CLEAR for the bounded #789 accepted-main composition at 88b7807378447cc74e584a37a48f277ddc1c34c8.** Blocking findings: none. New non-blocking findings: none.

Retained residuals: prior GM-9 general impersonation-decision refusal/double-audit remains unestablished; this composition is not that compliance proof or authorization to enable impersonation issuance. Existing per-request authority/next-call revocation limits, durable-activity single-use dependence and notification-channel limitations remain at their original scope. The retained f7fb focused PostgreSQL 14-file/91-test result is source-only evidence; it is not a result on this composed head.

## Commands actually performed and limits

Read-only commands included `pwd`; `git status --short/--porcelain`; `git rev-parse`; `git show -s --format=%H %P %T`; `git log --format=%H %P %s <full-source>..HEAD`; `git merge-base --is-ancestor`; `git diff --name-only/--name-status/--stat/--shortstat/--check` over the exact source, composed and accepted parents; `git ls-tree`; `rg`, `cat`, `sed`, `head`, `ls`; live read-only `gh pr list --state open --json number,headRefOid,title` and `gh issue list --state open --limit 30 --json number,title`. Git diff checks for immediate source-to-candidate comparisons exited 0. The live PR inventory still referred to historical published #773/#789 heads, not these local successors; none of those hosted checks is attributed to these candidates.

A read-only Python subprocess script independently enumerated actual incoming paths, compared every recorded own mode/blob at the full baseline and final head, compared every actual incoming mode/blob to accepted main, checked exact net-own sets and overlap, printed trees/parents, and checked ancestry. A second script compared named shared seam blobs and listed intervening commits. A final pre-write assertion again verified both exact heads and clean worktrees.

Some exploratory multi-file read outputs were truncated; relevant conclusions were checked with bounded reads or direct Git comparisons. An initial nonexistent `.claude/active-mission.md` read was corrected to canonical `docs/07-planning/active-mission.md` in the candidate worktrees. No conclusion depends on an unseen truncated source range.

No tests/reproductions, PostgreSQL, Docker, browser, build, install, CI action, source/ref/shared-record modification, push, PR write, merge or publication was performed. The only created file is this requested private report, using O_EXCL and mode 0600. Both candidates stayed frozen and clean.

These separate security confirmations complete only the assigned bounded composition review. They do not reuse required CI, establish full composed runtime/image/browser acceptance, accept the entire #580 program, close a stage or residual finding, waive any gate, or authorize merge/release/SIT acceptance. Preserve earlier full/delta reviews and adverse evidence at their actual model, source and scope.

**Completed at:** 2026-10-17T01:50:56.825951+00:00


## Current composition binding

The reports above retain their stated full/delta scopes and unchanged verdicts. Current composition source is bound here; only publication in this candidate's own new regular review note follows. All required exact-head hosted/runtime/image gates remain outstanding.

**Reviewed head:** `8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe`


## Bounded repair and accepted #813 composition — 2026-10-17T03:07:39.477333+00:00

Prior reports retain their original source, scope and verdict. All dispatched review reports, adverse findings and authentic corrections are preserved below. New current security verdict is CLEAR at `c3329e7d195c63a6e46caebdd2f306b4dc9ba1a4`; this is source review, not hosted/runtime/image or merge acceptance. No gate waiver.

The old e30 full run passed224files3301tests/all5tasks, browser63/G1122 and image proof, but the live post-admission undefined-result finding held merge. Repair7671 adds concealed404; root focused unit1file2/native0 and APItypecheck0. Accepted813 composition imports exactly three accepted entries with all42own entries conserved. Current publication requires new full runtime/image and protected checks; no old pass transfer.


### Authentic report — query811-time-entry-concealment-repair-luna.md

# #811 time-entry concealment repair

Assignment source: root task #811. Worktree: `/Users/heinthura/.codex/worktrees/query773-current-luna`. Base/head before repair: `e30eb752eedf09bc8fcfa9a54c856a7771ff3cf4`. Composed source commit: `8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe`.

## Finding and repair

Confirmed that `GET /api/time-entry/{id}` first admits the row through `workspaceAccess.fromTimeEntry`, then calls `findTimeEntryById` again in `get-time-entry.ts`. If the row disappears between those reads, the controller returned `undefined`, allowing the route to emit an empty 200 despite declaring a concealed 404. The controller now throws `HTTPException(404, { message: "Time entry not found" })` for a missing second read. Added a controller regression for the post-admission disappearance case and a normal present-row case in `tests/api/time-entry/get-time-entry.test.ts`.

## Nearby scope scan

Checked the same single-row GET/controller shape in the nearby workspace-scoped routes. `get-view`, `get-task`, `get-project`, and `get-workspace-detail` already turn a missing second lookup into 404. The remaining nearby routes return list results, for which an empty array matches their response schemas. No analogous repair was indicated in this bounded scan.

## Evidence / limits

`git diff --check` passed before commit. Repository hook formatted/checked the two changed files. No tests, PostgreSQL, Docker/image, browser, install, or heavy checks were run as directed by the orchestrator. This authoring context is not an independent reviewer.

Committed source + regression only as `7671c1c700b31ae4d7c821d61d5791362d8d29cf` (`fix(api): conceal time entry disappearance after reach check`). No push.


### Authentic report — query811812-runtime-repairs-ordinary-luna.md

# Independent ordinary review — #811 and #812 bounded runtime repairs

Reviewer: GPT-6 Luna, fresh independent review context; did not author, direct, or remediate either candidate. Review was read-only and scoped to the two exact source heads, relevant feature/policy material, cited author/prior-review reports, and the existing #812 focused runtime receipt.

## #811 — time-entry post-admission disappearance

- **Exact candidate head:** `7671c1c700b31ae4d7c821d61d5791362d8d29cf`
- **Comparison base:** `e30eb752eedf09bc8fcfa9a54c856a7771ff3cf4`
- **Worktree:** `/Users/heinthura/.codex/worktrees/query773-current-luna`
- **Scope:** `apps/api/src/time-entry/controllers/get-time-entry.ts`; `tests/api/time-entry/get-time-entry.test.ts`.
- **Verdict: CLEAR for this bounded repair.**

The route in `apps/api/src/time-entry/index.ts` applies `workspaceAccess.fromTimeEntry` before calling the controller, and declares 404 for the concealed missing/unreachable case. The controller then performs another reach-scoped `findTimeEntryById` call. If that second read returns no row after middleware admission, the new `HTTPException(404)` keeps the route in its declared concealed response class instead of allowing an undefined result to become an empty success response. The regression directly covers the controller's absent-second-read behavior and the ordinary present-row behavior. The mock does not reproduce database concurrency itself; it does assert the exact post-admission observation whose response behavior is being repaired.

No blocking or non-blocking source findings. No tests or commands were run by this reviewer. I read the author report's statement that formatting/checks passed; that is author evidence, not independently reproduced here. No integration/runtime, PostgreSQL, Docker, build, or browser verification was performed in this review.

## #812 — approval project-reach fixture repair

- **Exact candidate head:** `5fa659555d237ef29e24b6872676bc4ba7355a02`
- **Comparison base for the accumulated bounded repair:** `d65c498cc9983cc89d11a670f90ee062ae99c310`
- **Worktree:** `/Users/heinthura/.codex/worktrees/query789-current-luna`
- **Cumulative changed paths:** `tests/api-integration/helpers/reach-world.ts`; `tests/api-integration/work-item-project-reach.test.ts`.
- **Verdict: CLEAR for this bounded fixture repair.**

The #812 reports and diff show the fixture now gives the private item explicit requester/participant visibility facts for the capable project member, reachable reader, and outsider. The approval-specific requests use nonempty `transitionId`, `kind`, and `approverId`, satisfying the request schema so the checks can reach the handler. The assertions preserve outsider 404 and reachable-reader 403, while the generic empty-body case still covers validation 400. This is consistent with `docs/03-features/approvals.md`'s requirement that a request be on an in-reach work item and with the existing private-item visibility contract described in the author diagnosis. Counting approval rows in the snapshot strengthens the no-approval-write assertion.

I inspected the retained focused runtime evidence at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/query812-runtime-5fa659/`: its receipt binds to this exact SHA; Vitest reports 6 files and 78 tests passed, and the run status says `test-complete`, with final container inventory showing no container/volume/network count delta. This confirms the focused evidence exists and is bound to the candidate; I did not execute or independently reproduce the run. The fixture snapshot is a selected-table snapshot, so its equality supports the asserted tracked-table side-effect check and should not be read as a complete database-wide write audit.

No blocking or non-blocking source findings. No tests or commands were run by this reviewer. No new runtime, PostgreSQL, Docker, build, or browser verification was performed. Prior full-run findings on earlier heads and prior ordinary/Sol reviews are not replaced by this bounded repair review.

## Review limits and independence

These are separate verdicts on the exact heads above. I inspected the diffs against their stated bases, relevant route wiring and feature contracts, and the supplied reports/receipt. I did not inspect live GitHub state, run tests, evaluate CI, review unrelated candidate changes, or grant merge/security/phase-finalizer approval. Any required GPT-6 Sol security review remains a separate gate where applicable.


### Authentic report — accepted813-three-compositions-ordinary-luna.md

# Independent ordinary review — accepted #813 composition confirmations

Reviewer: GPT-6 Luna, fresh independent context. I did not author, direct, or remediate the candidates. This is a read-only composition review of three exact current heads. It is not a replacement for the earlier full source reviews, security reviews, CI, image verification, or acceptance gates.

## #811 time-entry candidate composed with accepted #813

- **Exact current head:** `c3329e7d195c63a6e46caebdd2f306b4dc9ba1a4`
- **First parent / previously reviewed source:** `7671c1c700b31ae4d7c821d61d5791362d8d29cf`
- **Second parent / accepted #813 main:** `130508ef24f6442a59dbccaf305712891c8b3fbb`
- **Verdict: CLEAR for this bounded composition.**

I verified the worktree HEAD and both parents. The first-parent diff contains exactly three accepted-main paths: `apps/api/src/auth/repository.ts`, `tests/api-integration/local-factor-policy.test.ts`, and the step-up query-ownership review note. Each candidate-owned path from the supplied composition proof (42 paths) remains blob-identical to the reviewed source parent; each of the three incoming blobs is identical to accepted #813 main. The accepted and own path sets do not overlap. The proof records successful normal `--no-ff` merge and no conflict resolution; I independently confirmed the resulting tree relationships and exact three-path diff. The added source/test concerns existing step-up active-session read behavior, disjoint from the time-entry controller and regression. The accepted test covers deleted-session preflight denial and non-agent session denial during operation and pending-action issuance; the incoming repository changes materialize session query results while retaining callers' first-row semantics, as recorded in the accepted review note.

No composition finding. This verdict confirms source conservation and lack of a cross-path composition conflict; it does not redo the #811 concealment review or evaluate exact-head hosted/runtime gates. I ran no tests or other commands beyond read-only Git/source/evidence inspection.

## #812 approval candidate composed with accepted #813

- **Exact current head:** `24711f617d5e1134e36d83e3afadd85e206f0afa`
- **First parent / previously reviewed source:** `5fa659555d237ef29e24b6872676bc4ba7355a02`
- **Second parent / accepted #813 main:** `130508ef24f6442a59dbccaf305712891c8b3fbb`
- **Verdict: CLEAR for this bounded composition.**

I verified the worktree HEAD and both parents. The first-parent diff contains exactly the same three accepted-main paths listed above. All 18 candidate-owned paths from the proof remain blob-identical to the reviewed source parent; all three incoming blobs match accepted #813 main. The accepted and own path sets do not overlap. The merge proof records a normal merge with no conflict resolution, and the exact resulting diff confirms only those three incoming paths. The existing #812 approval request fixture repair and its reader/outsider assertions remain unchanged; the incoming session-query source and tests are disjoint from approval reach fixtures. No contract or source interaction was found in this bounded composition check.

No composition finding. This does not redo the #812 fixture/runtime review or replace any required security/exact-head gate. I ran no tests or runtime checks.

## #580 operation-proof persistence candidate composed with accepted #813

- **Exact current head:** `dcf4071f79c7046cab343e51acadc2e9983b9e09`
- **First parent / fully reviewed source:** `7f4f0a2865e9ff1006f88edab264f4c9d3031324`
- **Second parent / accepted #813 main:** `130508ef24f6442a59dbccaf305712891c8b3fbb`
- **Tree at both first parent and current head:** `d15260509b29f187945946c64a8ebf785db622e3`
- **Verdict: CLEAR for metadata-only composition; prior source review verdicts remain applicable.**

I verified the exact parents and tree ids. The merge commit's tree is identical to its first parent's tree, and `git diff`/`diff-tree` show no path or blob changes. Thus the accepted-main merge adds parent metadata only; there is no new source delta to re-review. The operation-proof source review remains the prior two ordinary CLEAR reviews and full GPT-6.1 Sol CLEAR at exact source `7f4f0a28…`, with their stated comparison base `433ea7769d1b8440046cfe7ba39acc23e029489c`.

I read the original reports and both authentic wording corrections, plus the full Sol report. The retained precision is: the attempt-limit error is thrown inside the transaction callback, so the original ordinary-A “transaction completed” statement is withdrawn; the audit-failure test exercises savepoint/failure handling followed by successful mutation and does not prove outer proof-plus-mutation rollback; and `local-factor-policy-concurrency.test.ts` covers policy-write/role-deletion serialization, not operation-proof races. Those coverage limits remain. The ordinary-B image wording correction also remains controlling: this `apps/api` source requires the separate image build, boot, migration, and health checks; the focused PostgreSQL run does not satisfy them. This metadata review claims none of those gates.

No new source finding or changed-source review round is indicated by this metadata-only merge. No tests, image, container, browser, or hosted checks were run here; no GitHub/ref mutation, commit, or push was performed.

## Independence and limits

I independently read the two composition proof receipts, inspected the actual worktrees/HEADs/parents/trees and first-parent diffs, verified source/incoming blob conservation for #811 and #812, checked their path-set intersections, and read the cited #580 ordinary/security reports and authentic corrections. No source or evidence reports were modified. These verdicts are limited to current-head composition and metadata confirmation. They do not claim exact-head CI, deployment/image acceptance, merge readiness beyond the already completed normal composition, #580 completion, or a phase finalizer.


### Authentic report — accepted813-four-candidates-security-61-sol.md

# Accepted #813 — four independent exact-head security verdicts

**Model / role:** GPT-6.1 Sol, fresh independent security reviewer context `/root/accepted813_four_candidates_security_sol`.
**Dispatch provenance:** The conductor supplied the actual tool-request arguments `model="gpt-6.1-sol"`, `reasoning_effort="high"`, `fork_turns="none"`. This is requested/accepted route provenance, not an independently measured serving attestation. The served provider/model/build fingerprint is unavailable to this context and is not invented.
**Independence:** I did not author, direct, plan, or remediate any of the four candidates. No child agent was spawned. I reviewed after reading the applicable current ordinary CLEAR reports and their authentic corrections. Their conclusions were claims to verify, not substitutes for source inspection.
**Method:** Four separate bounded source/composition security reviews. Earlier full-source review coverage remains attributed to its original reviewer, exact source and limits; this report neither restarts those full scopes nor silently claims to have re-audited them.
**Evidence root (E):** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover`.

## Separate verdicts

| Candidate | Exact reviewed head | Verdict and depth |
| --- | --- | --- |
| A — #811, activity/relations/time-entry recovery | `c3329e7d195c63a6e46caebdd2f306b4dc9ba1a4` | **CLEAR** — full security inspection of the bounded post-admission 404 repair, plus bounded accepted-#813 composition confirmation |
| B — #812, approval recovery | `24711f617d5e1134e36d83e3afadd85e206f0afa` | **CLEAR** — bounded fixture-security and accepted-#813 composition confirmation |
| C — #580 operation-proof persistence | `dcf4071f79c7046cab343e51acadc2e9983b9e09` | **CLEAR** — lightweight metadata-only confirmation retaining the prior full two-path security review |
| D — #803 records | `6f990aae91590ef79db60c6433fa425b2390424e` | **CLEAR** — bounded new dated-fact, preservation and composition security confirmation retaining the prior full normative review |

**Blocking findings:** none in any of these four assigned deltas.
**New non-blocking security findings:** none in any of these four assigned deltas.
These are source security verdicts only. They are not current required-CI passes, image acceptance, permission to merge, whole-#580 acceptance, a phase finalizer, or release/SIT/mission completion.

## A — #811 at c3329e7d

**Reviewed head:** c3329e7d195c63a6e46caebdd2f306b4dc9ba1a4

- Worktree: `/Users/heinthura/.codex/worktrees/query773-current-luna`.
- Bounded repair base/publication: `e30eb752eedf09bc8fcfa9a54c856a7771ff3cf4`.
- Repair/source parent: `7671c1c700b31ae4d7c821d61d5791362d8d29cf`.
- Other exact parent: accepted #813 `130508ef24f6442a59dbccaf305712891c8b3fbb`.
- Current tree: `713a5c84844c0beda52b18d25054ea3d0acbf826`.
- Retained full-source baseline: `d7f628fa89cedc25d610f93c5bd49ce6ae9c2df9`, full 40-path review `query773-d7f6-full-security-61-sol.md`, followed by accepted-#809 composition confirmation at `8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe` in `accepted809-dual-composition-security-61-sol.md`.

I inspected the complete two-path repair: `apps/api/src/time-entry/controllers/get-time-entry.ts` and the new `tests/api/time-entry/get-time-entry.test.ts`. The controller still uses the authenticated resolved identity and exact id in the same reach-scoped repository read. It now awaits that read, throws `HTTPException(404, { message: "Time entry not found" })` for no row, and returns the unchanged row otherwise. There is no unscoped retry, stale middleware-row fallback, new disclosure, or widened authority.

The mounted GET route already declares concealed 404 and applies `workspaceAccess.fromTimeEntry` with project reach plus `time_entry:read_any` enforcement. The second repository lookup composes the entry id, its task/project relationship, deleted-project exclusion and current canonical project-reach predicate. A missing row or a current reach refusal observed at that read therefore takes the declared 404 path, instead of being serialized as an empty success. Query exceptions still propagate; the new guard does not turn an execution error into a row or retry through weaker scope. This is closure of the reported post-admission undefined-result defect, not a claim of serializable instantaneous revocation throughout a request.

The two controller tests directly cover undefined second-read rejection and returning the present row, with exact identity/id forwarding. They model the post-admission observation; they do not reproduce real database concurrency or constitute a complete HTTP denial journey. `query811-7671-static-unit-receipt.json` records root's exact-7671 one-file/two-test run and API typecheck, both exit 0. I inspected that receipt, did not run them, and do not transfer old e30 full-suite passes to c332.

Direct Git comparison independently confirms all 42 owned mode/blob entries remain identical to 7671, all three incoming entries match accepted 1305, the owned/incoming sets are disjoint, and the first-parent diff contains exactly those three incoming paths. Relative to the prior full 40-path baseline, only the reviewed time-entry controller, authentic own-note publication, and new regression differ among the current owned paths; the unchanged full-source coverage is retained. The incoming auth source/test seam is assessed below.

**Separate A verdict: CLEAR.** The reported undefined-result concealment defect is closed in source at this exact head. Prior storage cross-system atomicity and legacy/native-feature coverage limits remain as disclosed in the full review; this repair adds no new recovery guarantee.

## B — #812 at 24711f61

**Reviewed head:** 24711f617d5e1134e36d83e3afadd85e206f0afa

- Worktree: `/Users/heinthura/.codex/worktrees/query789-current-luna`.
- Accumulated fixture-repair base/publication: `d65c498cc9983cc89d11a670f90ee062ae99c310`.
- Repair/source parent: `5fa659555d237ef29e24b6872676bc4ba7355a02`, following `0d6003df5a6f805bb3a5ccea85bc950e2ea187e7`.
- Other exact parent: accepted #813 `130508ef24f6442a59dbccaf305712891c8b3fbb`.
- Current tree: `7c04eb0f21b20464517df20e5fbf817eed5498fc`.
- Retained full-source baseline: `f7fb4cb6f8038deeb257709f776553023456c3d8`, full 15-path review `query789-f7fb-full-security-61-sol.md`, followed by the real disjoint accepted-#809 import confirmation at `88b7807378447cc74e584a37a48f277ddc1c34c8` in `accepted809-dual-composition-security-61-sol.md`.

I inspected the complete accumulated two-fixture-path delta in `tests/api-integration/helpers/reach-world.ts` and `tests/api-integration/work-item-project-reach.test.ts`. It changes no application source, schema, policy, capability, product status behavior or feature flag. The approval route's preparation adds exact private-item participant facts for the capable project member, reachable reader and project outsider. It does not change the item to a broader visibility class or grant either negative actor additional project authority.

Source inspection confirms the preserved conjunction: approval SQL applies current project reach AND private requester/exact-participant visibility, while route/handler checks separately require `approval:request`. The staff middleware does project reach before body validation; the handler then resolves the scoped target and enforces the capability. The new negative body contains nonempty `transitionId`, customer `kind`, and nonempty `approverId`, satisfying the actual strict request schema. Its dummy downstream identifiers do not mask the tested denials because the outsider fails project reach and the reachable reader fails capability before approval creation/transition eligibility. Participation therefore cannot replace project reach or authority: the tests retain outsider 404 and reachable-reader 403. The original empty-body positive/validation case still expects 400.

The earlier `query812-0d600-fixture-ordinary-luna.md` incorrectly treated the empty negative body as reaching the handler. Its authentic report remains intact and is not authoritative for the final repair. I read the final `query811812-runtime-repairs-ordinary-luna.md` and independently checked the schema/order above. The added approval count strengthens the existing snapshot against approval insertion. Snapshot equality remains a selected set of work-item rows and table counts, not a complete database-wide write audit or proof against every possible equal-count mutation.

I inspected root's `query812-runtime-5fa659` result/invocation, runtime and exact-id cleanup receipts, final inventory comparison, and raw-log summary. It binds to 5fa, native exit 0/no timeout, 29.931 seconds, six files/78 tests passed. The independently recomputed raw-log size/hash are 153,217 bytes / `8555382dec678d2b16641d2e1d4813d956834a568c0c85fac9debe0c3f159ebe`. Saved cleanup records 23 containers/109 volumes/seven networks unchanged; the private environment file is absent. These are inspected root-owned receipts, not a new runtime execution or live Docker-state observation. They are focused evidence on 5fa, not a full runtime result at 247.

Direct Git checks independently preserve all 18 owned entries from 5fa and all three incoming entries from accepted 1305, with no same-path overlap and exactly the three-path first-parent import. All 15 original full-review-owned source/test entries are unchanged except their designated own review note; the two fixture paths are the newly inspected repair. The prior #789 whole-tree-equivalence error was already explicitly withdrawn in its authentic composition correction; I do not revive it.

**Separate B verdict: CLEAR.** No authority regression or weakened permission oracle appears in this fixture repair or composition. Existing GM-9 impersonation-decision/double-audit, per-request authority/revocation, durable-activity single-use and notification limitations retain their original disclosed scope; this verdict does not certify them closed.

## Shared accepted-#813 import in A, B and D

The exact incoming paths are `apps/api/src/auth/repository.ts`, `tests/api-integration/local-factor-policy.test.ts`, and `docs/07-planning/security-reviews/query-ownership-step-up-session-580.md`. I read the actual production/test diff, the retained full security report in that note, and surrounding consumers. The production change only makes the two existing session selects async/materialized. All three consumers retain first-row destructuring and no-row rejection. Exact session/user/agent-portal/expiry predicates, the supplied transaction executor, UTC-wall-clock expiry expression, row lock and limit remain. No array-truthiness bypass or global-connection fallback is introduced. The accepted regression covers deleted-session HTTP preflight plus non-agent-session denial during operation and pending-action issuance, with the authentication verifier uncalled.

These imports are blob-identical to accepted 1305; A's time-entry controller and B's approval fixtures do not alter the auth callers or session query contract. I examined the intervening commit graph as well as endpoint trees; the authentic intermediate 455 defect and later 7d301 repair remain in the accepted history and review record. They are not hidden by a net-tree comparison. Accepted-#813 clearance remains source-bound to its prior reviewers and acceptance evidence, not a new full auth audit performed here.

## C — operation-proof persistence at dcf4071f

**Reviewed head:** dcf4071f79c7046cab343e51acadc2e9983b9e09

- Worktree: `/Users/heinthura/.codex/worktrees/remaining580-operation-proof-persistence-author-luna`.
- First parent / fully reviewed source: `7f4f0a2865e9ff1006f88edab264f4c9d3031324`.
- Other exact parent: accepted #813 `130508ef24f6442a59dbccaf305712891c8b3fbb`.
- Both first-parent and current tree: `d15260509b29f187945946c64a8ebf785db622e3`.
- Prior full-source comparison base: `433ea7769d1b8440046cfe7ba39acc23e029489c`; full two-path security report `operation7f4-full-security-61-sol.md`.

I verified the exact parents, complete tree equality, empty first-parent path diff and both owned mode/blob entries. The source already contains accepted #813's publication; this normal merge adds accepted-parent metadata without changing source. The intervening graph introduces accepted merge1305 and the final metadata composition, not an unreviewed reverted source experiment. There is no new lifecycle source delta requiring another full two-file audit.

I read the two original ordinary reports, both authentic wording corrections, the full independent security report and the current ordinary composition confirmation. The retained full review covers the three awaited repository lifecycle batches using the exact caller transaction and materialized rows, with existing operation/session/person/route/version/hash/state/expiry bindings and rollback seams. Its analysis stays attributed to source7f4 and its original reviewer. The earlier dependent-base caveat is resolved only as to the accepted-parent composition established here, not as to current candidate CI/image acceptance.

I independently inspected the exact-7f4 result/invocation/runtime records and raw footer: four files/159 tests, native exit 0/no timeout, 67.76 seconds. Raw log is 362,634 bytes / SHA-256 `4cf595ead210ed81d84984d0046fec479c3a0f175e6794b10d66543ac7e32cd2`; saved cleanup comparison is unchanged 23/109/7, private environment absent. The run's four files are local-factor policy, policy concurrency, and the two identity non-UTC wrappers. Role/policy concurrency is not an operation-proof race test. The audit-savepoint-failure case followed by a successful protected mutation is not an outer proof-plus-mutation rollback test. Canonicalization unit coverage was inspected previously but was not one of those executed files. The attempt-limit throw is inside its transaction callback. Those precise coverage corrections remain controlling.

**Separate C verdict: CLEAR for lightweight metadata-only composition.** Prior full source clearance remains valid for what it actually covered; no duplicate full-audit claim or new runtime claim is made. Shipping image build, boot, migration and health proof remain mandatory for the candidate and are not supplied by this focused PostgreSQL evidence.

## D — records #803 at 6f990aae

**Reviewed head:** 6f990aae91590ef79db60c6433fa425b2390424e

- Worktree: `/Users/heinthura/.codex/worktrees/takeover-status-20261016`.
- Previously published records base: `9d7d01eb6434122bd257e5b268b111a4fd20b9f8`.
- Normal accepted-#813 merge: `24893ab7662b13d9c9d7b0ba868528cd97dfc0ff`, parents 9d7 and `130508ef24f6442a59dbccaf305712891c8b3fbb`.
- Dated-record commit: `402558cc003a3a36b2c9f5c2e4ca94851056bb99`, single parent24893ab7.
- Current one-line correction: 6f990aae, single parent402558cc; current tree `2236c04f1e65f4256f451431cf7b9ea98c2b328e`.
- Retained full normative review: source `a92e2798d6eb28f6f1ee58821473b8a65dc7fec0` against accepted `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`, `records803-a92-full-ordinary-luna.md` and `records803-a92-full-security-61-sol.md`.

I read the full new status/queue/decision-log diff, preservation and timestamp proofs, current ordinary blocked report and authentic CLEAR correction, and prior full normative reviews. I independently compared raw Git objects: all 1,326,849 old status bytes and 225,676 old queue bytes remain exact suffixes; all 662,278 old decision-log bytes remain an exact prefix, with the proof's original hashes matching. The normal merge imports exactly the same three accepted paths assessed above, whose current blobs match1305. The API-design and CI/CD normative files are exactly blob-identical to reviewed a92 (respectively `73e4a93c4b3d6aa757cc20b58bf5cdc540c15364` and `4a54d988498bf4bdfdc16c20a576fba146fd93f5`). No new release classification, erasure entitlement, reviewer authority, retry policy, exception or waiver is introduced by the dated records.

The retained normative scope still requires live GitHub prerelease classification, fail-closed uncertainty and exact independently reviewed finding fingerprints. The erasure summary stays bound to the authenticated deletion subject's current persisted memberships and member/owner safety counts, with joined workspace names only for the existing conflict message. No other-member identity disclosure or general reach exemption follows. Those are conserved prior contracts, not product implementation approved here.

The new accepted-#813 facts match the supplied protected-acceptance/readiness and run receipts: normal merge02:55:50Z, accepted1305/publication433, exact publication/synthetic tree, 18 completed successful contexts, PostgreSQL222files/3284tests/five tasks, browser63/G1122 and the stated medians, final unit12/API121files872tests/web186files1023tests, and the candidate shipping-image record125migrations/UID10001/health200/nohostports/owned isolation/cleanup. I independently matched raw PG and final-unit log byte counts/hashes and their suite footers. I did not reauthenticate hosted jobs or rerun image verification. These remain accepted-813 facts at the snapshot cutoff, not current passes for records6f990 or the other three candidates.

The sole 402 ordinary blocker is closed: the current snapshot uses job117282971158 completion02:42:53Z, matching `813-pg-success-receipt.json`. Raw Vitest summary02:42:50.559Z is a distinct timestamp. The ordinary report's mistaken second-parent description for402 is explicitly corrected by its authentic addendum; actual Git metadata agrees with that correction.

The new A/B/C paragraphs retain adverse runs and required new gates honestly. Carrier addendum6/frozen5 and earlier main5a references are historical source-bound observations, not claims of present Carrier readiness or current accepted main. Old dated text remains immutable. The remaining held performance, owner decisions/deferrals, final signed artifact, exact-digest SIT, nonempty-attachment backup/usable isolated restore, final audit and phase obligations remain open. I did not audit every old snapshot or current Carrier implementation.

**Separate D verdict: CLEAR.** No dated-fact, authority inflation, provenance-erasure or composition security blocker remains in the assigned current records delta.

## Actual checks, preserved coverage and limits

I read the supplied user instructions, then reloaded the actual accepted guide/mission/workflow/provider-adapter versions from candidate worktrees and verified their blobs equal accepted1305 in all four worktrees. Relevant specialist reads covered the current CI security-path list and review/evidence-reuse rules, query-ownership/results/executor and UTC rules, approval reach/authority/private visibility, legacy time-entry routing/repository scope, PA-15 and session step-up contracts, and the conserved release/erasure standards. Read the newest dated record and decision context. No open product question was invented.

Read-only checks actually performed: `pwd`; bounded `cat`, `sed`, `rg`, `head`, `tail`, `ls`; exact `git status`, `log`, `show`, `rev-parse`, `diff`, `ls-tree`; read-only Python subprocess/pathlib/json/hashlib for parent/tree/path/mode/blob conservation, old-byte preservation and saved-log verification. `git diff --check` exits0 for A:e30..c332, B:d65..247, C:7f4..dcf, D:9d7..6f990. Final pre-report assertions confirm all four exact heads and clean candidate worktrees.

Some initial combined reads exceeded tool output limits; relevant guide, source and prior-report ranges were subsequently read separately or verified directly against Git objects. Two initially guessed specialist-document paths were absent and corrected to `docs/01-architecture/pending-actions.md` and `docs/01-architecture/api-design.md`. No conclusion relies on unseen truncated text or absent-file output.

**No tests/reproductions, typecheck, install, build, PostgreSQL, Docker, browser, live inventory, CI action, GitHub/ref mutation, source/shared-document edit, commit, push, merge or delegation was performed by this reviewer.** No live GitHub state was queried; the assignment froze exact local heads and authorized source/actual saved-receipt inspection. Current remote readiness must still be established by the conductor. The only new file is this authentic external report, exclusively created with mode0600.

Earlier full reviews remain at their real scope: A40 paths, B15 paths and its real earlier import, C2 paths, and D's full normative/records candidate. The 21 A and13 B authentic-publication report sets and their earlier publication proofs are preserved, not claimed newly re-verified byte-for-byte by this bounded review. `accepted813-next-hosted-count-expectations.json` is explicitly expectations only, not an executed result or pass. Old811 green CI never accepts the repaired source. No required GitHub check is reused. No existing source-review report becomes runtime/SIT evidence or supplies a gate waiver.

**Completed at:** 2026-10-17T03:06:39.911519+00:00

## Reviewer precision addendum before delivery

The B paragraph saying the original 15 entries are unchanged “except their designated own review note” should read precisely: **all 15 original full-review-owned source/test paths are unchanged; the designated own review note is an additional publication path outside those original 15, and the two fixture paths are the newly reviewed repair.** This clarifies the original inventory and changes no finding, source comparison or verdict. The full text above is retained.


## Current exact source binding

All reports retain their stated scopes. Only this candidate's own regular review note is added/appended after the independently reviewed source. Exact-publication full hosted/image gates remain outstanding.

**Reviewed head:** `c3329e7d195c63a6e46caebdd2f306b4dc9ba1a4`
