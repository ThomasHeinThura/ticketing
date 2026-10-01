# PR #529 — independent GPT-6 Sol security review

**Reviewed head:** `2c0bd18684d4e05fefdab751ae346409fb8ba3a9`

- **Base:** `c891e9bcd4abf9b77b4916561d9bc5ca367065e5` (`main` at PR inspection).
- **Reviewer and independence:** Fresh GPT-6 Sol context. I did not author, direct, or remediate this candidate. I changed no repository source.
- **Verdict:** **CLEAR — no blocking security finding at the exact reviewed code head.** This is the per-PR security review, not the P1 phase finalizer and not final merge clearance.
- **Security scope and risk:** Full pass required by `docs/04-engineering/ci-cd.md`: migration, database schema, API router/controller/policy, and app entrypoint paths are in the authoritative scope. The change adds a versioned write endpoint and concurrency enforcement across task writers; I treated authority, tenant reach, key scope, and race behavior as security-relevant.

## Scope and findings

1. **Route and authority.** `PUT /api/v2/task/{id}` is mounted at `/api/v2/task`, has a `work_item:update` row/reach policy entry, and runs the same `workspaceAccess.fromTask()`, `requireWorkspacePermission(work_item:update)`, and conditional assignee-permission middleware as the legacy full PUT. The source-row workspace lookup is reach-filtered before capability evaluation; missing or foreign task IDs resolve to the same 404. The API-key permission subset is checked by `requireWorkspacePermission`. The PostgreSQL regression covers viewer denial, foreign task 404, and a read-only key's 403. I found no new authorization bypass or client-supplied workspace fallback.
2. **Precondition and side effects.** V2 requires a positive, quoted, PostgreSQL-int-bounded `If-Match`; legacy PUT accepts omission for compatibility but strictly validates and checks any supplied header. Full PUT acquires the task row lock and checks the committed version inside the same transaction before validation or update. Conflict throws out of the transaction, returns 409 with asserted/current versions, and does not reach post-commit event publication or asset cleanup. The tested status and assignee races force the competing request to wait on the task row and verify that stale full PUT leaves the winning row and task-update event count unchanged.
3. **Version completeness.** Migration `0079_task_version.sql` adds `task.version integer NOT NULL DEFAULT 1`; Drizzle schema and migration journal/snapshot agree. Every `UPDATE taskTable` call in the API source now advances `version` with database-side `version + 1`: full update, narrow title/description/priority/status/assignee/due-date, bulk status/priority/assignee/due-date, move, and runtime column migration. The assignee no-op returns the existing row without a persisted write. The updates use the task lock or an atomic SQL increment; no read-modify-write version value is sent from JavaScript. GET/list/board/relation/export and both task-search result paths project the stored version; their schemas expose it. The shared search-result schema is optional because non-task result types do not carry a task version.
4. **First-party callers.** The web full-task fetcher sends its task snapshot version in a quoted v2 header. The MCP helper refuses a missing/noninteger existing-task version; tool registration sends it as the v2 header and removes it from the body. Neither client silently retries a 409. The remaining unversioned legacy route is an explicit, dated compatibility decision in WI-7a and the decision log. Its unversioned third-party overwrite risk is retained and disclosed, not claimed solved by this change.
5. **Locking.** The full PUT's task-first lock order matches the narrow writers and move path. The move path retains its sorted project-lock sequence; this candidate only adds an atomic version increment to its task update. I found no new lock inversion or cross-tenant move path from this delta. I did not exhaustively stress all possible concurrent operation pairs.

## Verification actually performed

- Checked GitHub PR #529's exact head and base; inspected the complete changed-path list and relevant migration, router, policy, controller, DTO, web, MCP, and test diffs against the base.
- Read AGENTS/workflow/CLAUDE, current status and decision log, WI-7a, the data model and API versioning contract, and the authoritative security-path scope. Inspected the three ordinary-review records at this head; all report clear within their stated scopes.
- Ran `CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/task-update-concurrency.test.ts ../../tests/api-integration/authorization-boundaries.test.ts` against the test PostgreSQL setup: **2 files, 25 tests passed**. This includes the four WI-7a integration cases. I did not run the full suite or browser/image verification in this review.
- At the last live GitHub check, PR head was still `2c0bd18684d4e05fefdab751ae346409fb8ba3a9`. Most completed checks were green; `integration - Postgres 18` was still in progress and `pull request template + security review` was red pending recorded review evidence. Recheck all required checks at merge time.

## Nonblocking residuals

- The intentionally unversioned third-party legacy PUT remains able to overwrite a newer task snapshot during its migration window. This is an explicit compatibility choice, not a claim of universal concurrency safety.
- The inherited task API permits priority changes under `work_item:update`, including the narrow priority route; the new v2 full PUT preserves exactly the legacy full PUT's effective authority. The target work-item WI-8 capability split is separate future migration work. This review found no newly granted authority in PR #529, but it does not certify the inherited task API as fully aligned with that target model.
- `SearchResult.version` is optional in the shared OpenAPI object even for `type: "task"`; runtime task branches and PostgreSQL regression require the value. A discriminated contract could express the conditional type more precisely later.

**No blocking findings.** This record does not waive CI, ordinary review, browser evidence, image boot/health, or the phase finalizer.

## Review links and note-only continuation

- [Independent Sol security review](https://github.com/ThomasHeinThura/ticketing/pull/529#issuecomment-5924640835).
- [Independent Luna atomic/writer review continuation](https://github.com/ThomasHeinThura/ticketing/pull/529#issuecomment-5924640428).
- [Independent Luna client/DTO review continuation](https://github.com/ThomasHeinThura/ticketing/pull/529#issuecomment-5924581673).
- [Independent Luna full third review continuation](https://github.com/ThomasHeinThura/ticketing/pull/529#issuecomment-5924536698).

Every commit after reviewed source head `2c0bd18684d4e05fefdab751ae346409fb8ba3a9`
is restricted to this security review artifact. Source or test changes require a fresh
exact-head review at the applicable tier. CI and image build/boot/health are checked
separately on the final merge candidate; this note does not waive any gate.


# PR #529 — independent GPT-6 Sol security delta review

**Reviewed head:** `0b91f7871780632218f93e627554670e91a58f2d`

- **Prior full security-reviewed code head:** `2c0bd18684d4e05fefdab751ae346409fb8ba3a9` (full review at `/private/tmp/pr529-2c0b-sol-security.md`).
- **Base:** `c891e9bcd4abf9b77b4916561d9bc5ca367065e5`.
- **Reviewer and independence:** Fresh independent GPT-6 Sol security delta context. I did not author, direct, or remediate the transport fix; I made no source edits, commits, pushes, or merges.
- **Verdict:** **CLEAR — no blocking security finding in the delta at this exact source head.** The prior full-review verdict applies to unchanged source. This delta verdict is not final merge clearance or a phase finalizer.

## Exact delta and security effect

Between the prior reviewed code head and this head, `efe8f67c` committed the earlier security-review note only. The implementation commit changes `packages/libs/src/hono.ts` and adds `packages/libs/src/hono.test.ts`; no API router, policy, controller, schema, web fetcher, or MCP tool changed. The existing committed note still declares only the prior reviewed head and must receive a note-only exact-head continuation before its CI gate can clear.

The old transport spread `init.headers` into an object. When Hono supplied a `Headers` instance, that spread yielded no header entries and dropped the web fetcher's quoted `If-Match`, causing the required v2 endpoint to answer 400. The new adapter constructs `new Headers(init?.headers)`, sets its existing JSON content type and window-id defaults, and passes that `Headers` object to `fetchImpl`. This preserves the standard `HeadersInit` forms, including the Hono instance, and also preserves caller-supplied authorization or API-key headers rather than silently removing them. `Headers` normalizes names and rejects invalid header syntax; the adapter does not synthesize or elevate a credential. Existing `credentials: "include"` and fetch-error translation remain in place. The client → adapter → actual `Request` regression asserts URL, quoted `if-match`, JSON content type, and window id. I found no new trust-boundary bypass or header injection path from this change.

The v2 server still requires the strictly parsed positive quoted version and checks it under the task row lock; a stale version still returns 409 without a write or event. The web fetcher still sends the snapshot version and has no silent conflict retry. The transport fix makes that existing precondition reach the server; it does not weaken it. MCP's separate transport is unchanged.

## Verification actually performed

- Verified the clean worktree and GitHub PR #529 both pointed at exact head `0b91f7871780632218f93e627554670e91a58f2d`, and inspected the complete delta plus the prior full security report and current independent Luna delta report (`/private/tmp/pr529-0b91-luna-transport-delta.md`, clear).
- Ran `pnpm --filter @taskdesk/libs test`: **2 files, 5 tests passed**, including the new Hono → production adapter → constructed `Request` regression.
- Ran `pnpm --filter @taskdesk/libs typecheck`: passed. Ran `git diff --check 2c0bd18684d4e05fefdab751ae346409fb8ba3a9..0b91f7871780632218f93e627554670e91a58f2d`: clean.
- Confirmed the API task update, route policy, web fetcher, and MCP tool have no source delta from the prior full-reviewed head. The earlier real-PostgreSQL security/concurrency run (2 files, 25 tests) belongs to that unchanged head; I did not rerun it here.

## Residuals and gates

- The new test uses an injected fetch and standards `Request` construction. It does not prove a browser/server round trip. The orchestrator's rebuilt-image browser verification is a separate pending gate.
- The prior review's documented unversioned third-party legacy overwrite risk, inherited task priority authority behavior, and shared search schema typing precision remain unchanged.
- At the last live GitHub inspection, the PR-template/security-review check was red because the committed note lacked this new reviewed head; other checks were pending at this SHA. Recheck exact-head CI and record this delta in a note-only commit before considering merge.

**No blocking findings in the transport delta.**


## Transport delta ordinary review and browser evidence

Fresh independent GPT-6 Luna `/root/p1_529_luna_clients_review` cleared exact source `0b91f7871780632218f93e627554670e91a58f2d`, independently running libs 2 files/5 tests and typecheck. The preceding three-reviewer panel and full Sol pass at `2c0bd18684d4e05fefdab751ae346409fb8ba3a9` cover unchanged code.

Root built `taskdesk:pr529-0b91` image `sha256:db96023085aa8b45c2deb38744dc2f74a85c7648cbcd83e8e1e10df9d8119647`, booted the disposable fixture, and verified root/live/ready HTTP 200. Actual Chrome board drag To Do to In Progress changed the persisted task from revision 1 to 2 and survived reload. Evidence: `/private/tmp/pr529-chrome-board-persisted.jpg`, 1440×758 CSS pixels at original 125% zoom. The previously observed missing-header blocker is resolved; no legacy universal protection or phase completion is claimed.

This follow-on commit records only this review note.


## UI recovery review continuation

The earlier note-only continuation statements above describe their historical candidates. The later UI recovery changes and normal main integration are reviewed by the following independent records; the final current-source Sol record binds this continuation. No earlier reviewer is represented as having reviewed a newer SHA.

# PR #529 — independent GPT-6 Luna recovery-delta review

**Reviewed head:** `8a718acd8acb0d8818e4209b23816e58883ecebd`

- **Prior implementation head:** `0b91f7871780632218f93e627554670e91a58f2d`; prior API concurrency, transport, and required Sol reviews remain applicable to unchanged paths.
- **Delta inspected:** full delta through the current head, with special focus on failed-write board recovery, every first-party full-task mutation caller, error ownership, URL/query effects, localization data, and the prior `52f79021` findings.
- **Reviewer and independence:** Fresh independent GPT-6 Luna context. I did not author, direct, or remediate this candidate. No repository changes, commits, or pushes.
- **Verdict:** **CLEAR — prior blocking recovery and duplicate-toast findings are fixed.** One nonblocking localization observation remains below. This review does not replace the required Sol security pass or remaining PR gates.

## Prior findings rechecked

1. **Absent authoritative task:** `restoreTaskUpdate` now removes the failed optimistic task when a refreshed authoritative project has no such row, after checking the current row still matches the failed write snapshot. The new regression covers this case. This closes the prior case where deleted or cross-project moved tasks remained as phantom rows.
2. **Transport error double-toast:** the fetcher wraps rejected transport/decoding failures in `TaskUpdateError`, and the four async caller catch blocks suppress hook-owned `TaskUpdateError` feedback. The hook emits one localized error toast, while `retry: false` prevents replaying a stale full-task write. The new test asserts one hook toast and one fetch attempt.
3. **Other callers / board recovery:** all `useUpdateTask` call sites were enumerated. Callback-style `mutate` users rely on the hook feedback; async callers either handle success locally and suppress this hook-owned error, or propagate it. Board/backlog refresh effects defer replacing Zustand state while a full update for that project is pending. Recovery is task-scoped and guarded against overwriting a later local edit to that task.

## Nonblocking localization observation

All 18 non-English locale files contain the English source value for `tasks:update.conflict`. The key/schema shape is complete, and `pnpm check:i18n` passes for all 18 locales. The authoritative i18n spec defines the required gate as `en-US` completeness, while `pnpm i18n:report` separately identifies values byte-identical to English as untranslated; it does not make translation of every locale a required gate. I therefore do not treat this as a blocker, but the new conflict message will appear in English for users of those locales until translated.

## Verification performed

- Read repository instructions/workflow, current status and decision log, WI-7a and the pending prior recovery review. Inspected the complete `0b91f787..8a718acd` delta and enumerated all full-task mutation callers.
- Ran `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/hooks/mutations/task/use-update-task.test.tsx src/fetchers/task/update-task.test.ts`: **2 files, 6 tests passed**.
- Ran `pnpm check:i18n`: all 18 non-English locale files were in sync with `en-US`.
- Ran `pnpm i18n:report`: it exits nonzero on the repository's existing missing/unused/dynamic/untranslated catalogue findings and reports `tasks:update.conflict` untranslated in the non-English locales. This is a report, not the specified `check:i18n` gate.
- Did not run typecheck, build, browser, or image checks in this review.

No blocking finding in the reviewed recovery delta. Exact-head CI, image/browser evidence, and the required independent Sol review remain separate gates.

# PR #529 — independent GPT-6 Luna recovery-delta review

**Reviewed head:** `8a718acd8acb0d8818e4209b23816e58883ecebd`

- **Prior reviewed implementation head:** `0b91f7871780632218f93e627554670e91a58f2d`; original API/concurrency review and the separate transport review remain applicable to unchanged implementation paths.
- **Delta inspected:** complete `0b91..8a718` diff, including current-main integration and the UI failure-recovery changes from `52f79021` and `8a718acd`. I inspected the full recovery helper/hook, routes, all `useUpdateTask` callers, fetcher error conversion, tests, WI-7a and the committed security note.
- **Reviewer and independence:** Fresh independent GPT-6 Luna context. I did not author, direct, or remediate this candidate. No source edits, commits, pushes, or merges.
- **Verdict:** **CLEAR — no blocking correctness finding in the recovery delta at this exact SHA.** This is one independent ordinary review of the current delta; it does not replace the required GPT-6 Sol review or other merge gates.

## Recovery and race review

- `restoreTaskUpdate` only changes a task when the current row still matches the failed mutation snapshot, including version and all full-write fields. It preserves edits to other rows and leaves a newer same-task edit untouched. Restored tasks are reinserted in their authoritative column/planned/archived location relative to surviving neighbors. If the refreshed project no longer contains the row, it removes the failed optimistic row, covering deletion and movement out of the project.
- The query-client-scoped scheduler coalesces refreshes by project and collects per-task recoveries. It waits until no full-task mutation for that project is pending before refetching and checks again after the awaited invalidation. If another task mutation overlaps the refresh, its later settlement schedules another pass; pending writes are not overwritten by the scheduled project refresh. When recoveries exist, reconciliation is task-scoped and keeps unrelated local rows intact; an empty recovery set uses the refreshed project as the store snapshot.
- For overlapping full updates on one task, the ownership guard prevents an older failed mutation from rolling back a newer row. A later settlement reschedules the coalesced refresh; the final refresh reads the active query cache after invalidation. I found no path in this helper that silently retries a 409 or rewrites server data.
- `updateTask` preserves HTTP status in `TaskUpdateError`; transport and response decoding exceptions are converted to status 0. The mutation disables retries and emits one translated hook toast. The four `mutateAsync` callers that previously duplicated transport-error toasts now suppress all `TaskUpdateError` instances; non-mutation errors retain their local feedback. The tested failure path asserts exactly one toast.
- The task-version precondition and server-side locking/authority protections are unchanged from the already reviewed API source. WI-7a's intended v2 `If-Match` behavior remains consistent with this client recovery behavior.

## Verification performed

- Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, current `status.md`, newest decision-log entries, `docs/03-features/work-items.md` WI-7a, and `docs/07-planning/security-reviews/529-task-update-concurrency.md` including its transport continuation.
- Verified `gh pr view 529` reported exact head `8a718acd8acb0d8818e4209b23816e58883ecebd`.
- Ran `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/hooks/mutations/task/use-update-task.test.tsx src/fetchers/task/update-task.test.ts`: **2 files, 6 tests passed**. These include stale conflict recovery, preserving unrelated edits and newer same-task edits, absent authoritative rows, and one toast on a transport-shaped failure.
- Ran `git diff --check 0b91f7871780632218f93e627554670e91a58f2d..HEAD`; it reports trailing whitespace in the unrelated merged-main security-review artifacts `docs/07-planning/security-reviews/532-brand-placeholders.md` and `535-storage-root-alias.md`. No whitespace issue was found in the recovery source. No files were changed.
- Inspected the live failed `pull request template + security review` check (`gh run view 36818673378 --job 110229267718 --log-failed`). It fails on PR-template/security-review declarations and unchecked completion items (including pending Sol review, browser evidence, and required checks), not on this recovery implementation. Those are candidate-level readiness blockers and remain required to close; this code review does not waive them.

## Findings

No blocking or non-blocking implementation findings in the reviewed recovery delta.

This review does not claim full browser verification or overall merge readiness. At inspection, GitHub reported the required Postgres integration job still in progress and the PR-template/security-review job red. Recheck CI and all independent review records on the exact merge candidate.

# PR #529 — independent GPT-6 Luna ordinary review

**Reviewed head:** `f8750d27a834b1e3522e185005d6f5cfc5e0a6c2`

- **Base:** `main` at `5d8024cfeaec4f4448665b4e9fce9eb5e1ba2113`.
- **Reviewer and independence:** Fresh independent GPT-6 Luna review context. I did not author, direct, or remediate this candidate. I made no repository source changes, commits, or pushes.
- **Verdict:** **CLEAR — no blocking finding in the candidate delta.** This is the third independent ordinary review requested for the UI recovery delta. It is not a GPT-6 Sol security review, a phase finalizer, or overall merge clearance.

## Scope reviewed

- Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, P1 status, the current decision log, WI-7a in `docs/03-features/work-items.md`, and the committed PR #529 concurrency/Sol review note.
- Compared `0b91f7871780632218f93e627554670e91a58f2d..f8750d27a834b1e3522e185005d6f5cfc5e0a6c2`, separating the task-update recovery work from unrelated changes brought in through current `main`. Read both independent recovery reviews at `/private/tmp/pr529-8a71-luna-recovery1.md` and `/private/tmp/pr529-8a71-luna-recovery2.md`, then rechecked the reviewed implementation and tests directly.
- Reviewed the intervening `52f79021` and `8a718acd` recovery commits, all `useUpdateTask` call sites, first-party async error handling, board/backlog store hydration guards, scheduled query refresh and task-scoped reconciliation, plus the three-file JSDOM localStorage addition from current `main`.
- Confirmed the current GitHub PR head is exactly `f8750d27a834b1e3522e185005d6f5cfc5e0a6c2`.
- The versioned API contract, row locking/version increments, Hono header transport, and MCP/web precondition construction were already independently reviewed at their relevant source heads and by the committed Sol pass. No new change in this UI recovery work weakens that contract: there is no stale-write retry, and the mutation disables retries.

## Findings

No blocking or non-blocking implementation findings.

The recovery helper only restores a task when the current row still matches the failed write snapshot, including its version and full-write fields. A newer same-task local edit is left alone; unrelated rows are preserved. If the refreshed authoritative project no longer contains the task, the matching optimistic row is removed. Reinserted rows use the authoritative column/planned/archived location and surviving neighbors.

The project refresh is coalesced per query client and project. Board/backlog hydration avoids replacing the store while a full-task mutation is pending. A refresh that encounters another pending mutation is rescheduled by that mutation's settlement; after invalidation, the helper checks pending state again before reconciling. Recovery remains scoped to the failed task when recovery records exist, avoiding replacement of unrelated local rows.

The mutation reports 409 conflicts distinctly, converts transport/response failures into `TaskUpdateError`, disables retry, and emits one hook-owned error toast. Async caller catch blocks suppress duplicate feedback for this error type; task-card success feedback now occurs only after the awaited mutation succeeds. The JSDOM helper explicitly restores the jsdom window's storage object when the host global shadows browser storage, and its regression verifies shared functional storage.

## Verification performed

- Ran `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/hooks/mutations/task/use-update-task.test.tsx src/fetchers/task/update-task.test.ts`: **2 files, 6 tests passed**.
- `gh pr view 529 --json headRefOid` returned the reviewed exact head above.
- `git diff --check 0b91f787..HEAD` reports trailing whitespace only in unrelated merged-main review-note files `docs/07-planning/security-reviews/532-brand-placeholders.md` and `535-storage-root-alias.md`; no whitespace issue was reported in the recovery implementation. I did not edit those files.
- I did not run typecheck, full web tests, browser verification, or image boot/health checks. Those remain separate candidate gates.

No merge-readiness claim is made. Exact-head CI, applicable browser/image evidence, and all required review records remain to be confirmed by the orchestrating session.

# PR #529 — independent full GPT-6 Sol security review of current candidate

**Reviewed head:** `f8750d27a834b1e3522e185005d6f5cfc5e0a6c2`
**Current main/base:** `5d8024cfeaec4f4448665b4e9fce9eb5e1ba2113`
**Reviewer and independence:** Fresh independent GPT-6 Sol context. I did not author, direct, or remediate this candidate; I made no source edits, commits, pushes, or merges. This is the required per-PR security review at the current exact head, not a P1 phase finalizer or overall merge clearance.
**Verdict:** **CLEAR — no blocking or non-blocking security finding in the current candidate.** The compatibility residuals below remain explicit.

## Scope and source lineage

I read AGENTS/workflow/CLAUDE, the authoritative security-scope list, WI-7a and its dated legacy contract, the committed PR #529 security note, the earlier full Sol review at `2c0bd18684d4e05fefdab751ae346409fb8ba3a9`, the transport Sol continuation at `0b91f7871780632218f93e627554670e91a58f2d`, both independent ordinary recovery reviews at `8a718acd8acb0d8818e4209b23816e58883ecebd`, and the independent ordinary current-head review at `f8750d27`. The first two ordinary reviewers did **not** review the newer SHA; their reviewed API/UI bytes are unchanged. I independently examined the current GitHub head/base/files/check snapshot, commit/merge history through the current head, the complete `0b91..f875` recovery and main-integration delta, and the current-main-to-head candidate file list.

I verified byte identity with `git diff --quiet`: migration, schema, API task/search/relation/router/policy/controller, MCP, contract and integration-test paths from `2c0bd186..f875` (exit 0); Hono transport and test from `0b91f787..f875` (exit 0); recovery fetcher/hook/helper/board/backlog paths from `8a718acd..f875` (exit 0). The final merge's second parent and merge base are current main. Its first-parent import adds only PR #537's three web Vitest JSDOM localStorage setup/helper/test files. Their code loads in web test setup, not production routes, API integration tests, or the Node CI probes. There is no merge resolution in reviewed candidate source.

## Security assessment

- **Version and authority:** `0079_task_version.sql` adds a non-null integer version initialized to 1. The v2 full-task PUT has an explicit `work_item:update` policy and the same task reach, workspace capability, and conditional assignee-permission middleware as the legacy route. `If-Match` must be a quoted positive version; the controller locks the task row, checks the committed version before validation/update, and raises 409 with asserted/current versions on mismatch. The rejected transaction cannot reach post-commit task events or asset cleanup. Foreign task reach still resolves as 404; denied capability or API-key scope remains denied. I found no new tenant or credential authority path.
- **All writers and reads:** The reviewed task-row writers use database-side `version + 1`, including full, narrow, bulk, move and column migration paths. Task GET/list/relation/export/search response paths expose stored versions for first-party snapshots. I rechecked the current writer/response inventory against the unchanged source and the prior full security review; I did not identify a versionless persisted task-row update in this candidate.
- **Transport and client:** The Hono adapter preserves the supplied `HeadersInit`, including quoted `If-Match`, while retaining JSON/window headers and credential mode. The web fetcher sends its task snapshot version to v2. It converts HTTP 409 and transport/decoding failures into recognizable errors; the mutation has `retry: false` and does not replay a stale full write. The MCP version precondition/transport remains unchanged from the earlier reviewed source.
- **Recovery under overlap:** `restoreTaskUpdate` checks the failed optimistic task snapshot before changing store state, preserves a newer same-task edit and unrelated rows, and removes a failed optimistic row when the authoritative project no longer contains it. Project refreshes are coalesced by query client/project and held while a full-task mutation is pending; board/backlog hydration uses the same guard. After invalidation, pending state is checked again before task-scoped reconciliation. This changes local UI recovery only; it never converts 409 into server-side overwrite or client retry. Hook-owned toast handling avoids duplicate feedback from async callers.
- **Main composition:** PR #537's JSDOM helper restores browser localStorage only in Vitest setup. It affects focused web test execution but neither the API's version/permission semantics nor browser production behavior. Main's earlier storage-root and branding changes have no path or authority overlap with the candidate's version/recovery code.

## Verification actually performed

- `CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/task-update-concurrency.test.ts ../../tests/api-integration/authorization-boundaries.test.ts`: **2 files, 25 tests passed** on this head, including stale-write 409/no winning-row overwrite and authorization boundary cases.
- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/hooks/mutations/task/use-update-task.test.tsx src/fetchers/task/update-task.test.ts src/test/jsdom-local-storage.test.ts`: **3 files, 7 tests passed** on this head, covering conflict recovery, absent authoritative rows, single transport failure toast/no retry, and JSDOM setup behavior.
- `pnpm --filter @taskdesk/libs test`: **2 files, 5 tests passed**, including Hono header preservation through a constructed request.
- `git diff --check main..head` reported no candidate whitespace issue. I did not run a full local suite, typecheck, browser interaction, image build/boot, or every concurrency interleaving. The orchestrator's Docker work and hosted gates are separate evidence, not my executions.

## Residuals and gate state

The released legacy `PUT /api/task/{id}` still permits an omitted `If-Match` for the dated compatibility window. Such unversioned third-party requests can overwrite newer task state; this is the documented WI-7a decision and is **not** fixed by v2. The inherited priority capability behavior and shared search result's optional-version typing remain the earlier recorded nonblocking residuals. The non-English conflict-message values remain English source text pending translation; the ordinary review reports that the required i18n shape gate passes.

At the live snapshot for this exact head, hosted PostgreSQL integration was still in progress and `pull request template + security review` was red; other completed checks shown were green, with G11 reported not enabled. No check is waived here. The orchestrator must record this actual review and independently verify all exact-head required gates, image/boot/health and browser evidence before merge. A later candidate SHA needs a fresh exact-head review decision.


## Current-main continuation — 2026-10-01

**Reviewed head:** `295185a60862bf321e1c3c6d5607313fe684c6b8`

The following independent reports bind this source candidate. The subsequent commit records only this note; no reviewer is represented as having inspected a later SHA. Corrected ordinary comparison scopes supersede the earlier report wording.



### pr529-2951-luna-main-delta-corrected

# PR 529 exact-head main-import delta — GPT-6 Luna

> **Supersedes** `/private/tmp/pr529-2951-luna-main-delta.md` to correct comparison scopes and path counts. The verdict and byte-identity result are unchanged.

- **Reviewed head:** `295185a60862bf321e1c3c6d5607313fe684c6b8`
- **Previously reviewed source head:** `f8750d27a834b1e3522e185005d6f5cfc5e0a6c2`; prior full Sol report read at `/private/tmp/pr529-f875-sol-security.md`.
- **Reviewer:** GPT-6 Luna, independent exact-head delta context; no authorship, direction, or remediation.
- **Verdict:** **CLEAR for the main-import delta only.** This is not a new full panel review, phase finalizer, or merge-readiness decision.

## History and source identity

The candidate merge has first parent `918a939ede71efa0730fbfe8aa9169f03a7118cd` and second parent/current main `c27b2ee771eba19f193a0d20cfc1048e9c6d21a9`.

Comparison scopes are distinct:

- First-parent import (`918a...2951`): **11 paths**, comprising PR #531's 8 RLS prototype/config/evidence paths and PR #538's 2 CI probes plus review note.
- Prior reviewed candidate to integrated candidate (`f875...2951`): **12 paths**, the above 11 imports plus PR #529's updated review note.
- Current-main-relative candidate (`origin/main...HEAD`): **87 paths**, the full PR #529 feature/source/test diff and its review note. It is inaccurate to describe this as 12 paths or as having no production changes.

`git diff --quiet f8750d27 295185a --` over API task/versioning source, Drizzle schema/migrations, web, shared libs, and MCP returned **0**. This establishes that the previously reviewed PR #529 implementation is byte-identical through the main import. The feature's production changes remain part of the current-main-relative candidate; the import delta itself adds none.

The #531 API package change appends `tsconfig.rls-prototype.json` to the API `typecheck` script. Its dedicated config includes only the isolated `tests/rls-prototype` files. The dedicated Vitest global setup starts PostgreSQL Testcontainers, and the prototype applies temporary RLS policies only to that disposable migrated database. No production RLS setting, migration, schema, API route, task-version writer, browser client, MCP behavior, or shared contract was introduced by the import. The #538 probes test canonical repository-root selection and approved-breaks path resolution; they do not overlap task-update source or alter the API contract.

## Verification and limits

No tests, builds, or image checks were run for this source-identical import, consistent with the active quiet window. Existing source-head reviews and their exact test evidence remain applicable to unchanged PR #529 code. The orchestrator separately reports the combined hosted PostgreSQL run passed 124 files/1,561 tests and the current image is live/ready; those are not my executions. Review-note publication and current exact-candidate gates remain separate requirements.


### pr529-2951-sol-main-delta

# PR #529 — independent GPT-6 Sol security confirmation of current-main import

**Reviewed head:** `295185a60862bf321e1c3c6d5607313fe684c6b8`
**Current main/base:** `c27b2ee771eba19f193a0d20cfc1048e9c6d21a9`
**Prior full security-reviewed source:** `f8750d27a834b1e3522e185005d6f5cfc5e0a6c2`
**Reviewer and independence:** Fresh independent GPT-6 Sol context. I did not author, direct, or remediate this candidate or the imported main changes. This is a per-PR exact-head delta confirmation, not a P1 phase finalizer.
**Verdict:** **CLEAR for the current-main integration delta.** No blocking or non-blocking security finding in the import. This is not overall merge clearance.

## Exact history and scope

I verified the live GitHub head/base and PR file list, the prior full Sol report, the fresh independent Luna delta report, both parents of the current merge and its full first-parent/current-main diffs. The merge's first parent is `918a939ede71efa0730fbfe8aa9169f03a7118cd`, which differs from the full-reviewed `f8750d27` only by PR #529's review-note commit. The second parent and merge base are current main `c27b2ee7`. The **first-parent import has 11 paths**: PR #531's eight RLS prototype/config/results/review paths and PR #538's two CI probe files plus review note. The current-main-to-head **net PR diff has 87 paths**, all PR #529's own previously reviewed candidate/review material; imported RLS/probe files are part of main and do not appear in that net diff.

`git diff --quiet f8750d27 295185a --` over the migration/schema, API task/router/policy/search/relation and version-writer code, Hono transport, MCP code, web task fetcher/recovery, and focused concurrency test paths returned 0. I also inspected the imported API package change: it appends `tsconfig.rls-prototype.json` to the normal API typecheck command. The dedicated RLS Vitest config includes only `tests/rls-prototype/**/*.test.ts`, has a separate disposable PostgreSQL Testcontainer setup, and changes no runtime API policy, migration, auth, task version, HTTP header, or web recovery semantics. PR #538's Node CI probes assert canonical caller-root/approved-breaks paths; they do not change checker implementation or authority. I found no combined path by which either test-only import changes task-update authorization, `If-Match` enforcement, database version increments, no-409-retry behavior, or cache recovery.

## Verification and limits

**No local tests or builds were run for this source-identical import delta.** The prior full Sol review's current-source focused runs (API 2 files/25, web 3 files/7, libs 2 files/5) remain prior evidence, not my execution in this pass. The orchestrator separately reports current-head API typecheck and RLS 1/1, hosted PostgreSQL 124 files/1,561 tests, and image boot/live/ready HTTP 200; I did not perform or independently verify those operations. The previous legacy unversioned PUT overwrite risk, inherited priority authority behavior, and optional task-search version typing remain the documented residuals. Required exact-head checks and PR evidence remain the orchestrator's separate gate; no gate is waived here. A later head or base change needs another exact-head decision.


### Orchestrator image and integration evidence

Shipping image `taskdesk:pr529-295185a6`, image ID `sha256:bd93ebe2789ff737ff148ba5595faf25cf026589027206a1cb4494b712645d02`, built with revision `295185a60862bf321e1c3c6d5607313fe684c6b8`. The isolated PostgreSQL 18/Valkey stack booted healthy and both `/api/public/health/live` and `/api/public/health/ready` returned 200. Full hosted PostgreSQL integration at this source passed 124 files/1,561 tests. Build/boot logs: `/private/tmp/pr529-2951-docker-build.log` and `/private/tmp/pr529-2951-smoke-boot.log`; hosted log `/private/tmp/pr529-2951-pg-hosted.log`.

The current API typecheck and isolated RLS prototype (1 file/1 test) passed. Chrome reload at 1440×758 preserved CV-1 in In Review with the concurrent title and October 8 due date; screenshot `/private/tmp/pr529-2951-current-image.png`. Earlier source-identical conflict, panel, date, backlog/create, Gantt and list browser evidence remains separately recorded.

Every required check must be green on the final note-only candidate before protected merge. No stage completion or gate waiver is claimed.
