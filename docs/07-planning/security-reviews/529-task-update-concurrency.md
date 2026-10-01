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
