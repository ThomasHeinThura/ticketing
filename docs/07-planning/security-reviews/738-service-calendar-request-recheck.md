# PR #738 security review record: service-calendar delete rechecks references at request time (CAL-9, #717)

PR #738 closes #717. It adds integration tests for service-calendar usage and deletion (CAL-9 and CAL-14), ported from #589 and extended. It also fixes a CAL-9 gap: `DELETE /api/service-calendars/{id}` now runs the shared `assertCalendarUnused` check at request time, after authorization and the requester-identity check. An in-use calendar returns 409 `service_calendar_in_use`, and no pending action or audit row is written. The approval-time recheck, which runs under a row lock in the delete transaction, is unchanged.

A Claude Sonnet 5.5 lane implemented the change. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: APPROVE at `b92b943c`. Five of six mutants were caught. The two test gaps it found were closed at `71fa7325`.
- Ordinary review B by Claude Sonnet 5.5 (spec, port fidelity, concurrency): APPROVE at `71fa7325`. The full serialized suite passed apart from one unrelated test-reset deadlock flake.
- Security review by Claude Opus 5.5: CLEAR at `eea7cd8a`, which is `71fa7325` cleanly merged with `main` `1f1abe7c`. It found no existence or usage oracle (outsiders get 404 and viewers get 403 before 409), no write before the check, and an atomic approval. Five mutations were all caught.

**Reviewed head:** `eea7cd8a700881cba6ad8e3ea91c1475b2d531e6`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `738-ordinary-a-sonnet.md` | Ordinary review A (82aecead..b92b943c) | Claude Sonnet 5.5 | `b92b943c` | APPROVE | `12033eb469d09125c5dcb10127f26900d8abff748915a49d28c06a28dc75c43f` |
| 2 | `738-ordinary-b-sonnet.md` | Ordinary review B (82aecead..71fa7325) | Claude Sonnet 5.5 | `71fa7325` | APPROVE | `e97554b3abbfa8fc4a8599d702f70edb7c8acebd1ef49f469de9185f43e1605c` |
| 3 | `738-security-opus.md` | Security review (1f1abe7c..eea7cd8a) | Claude Opus 5.5 | `eea7cd8a` | CLEAR | `4abc793dec8d1067b9af6c577d498fcc758841ec77949034756329423ce6b73d` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/738-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 12033eb469d09125c5dcb10127f26900d8abff748915a49d28c06a28dc75c43f) -->
# PR #738 ordinary review A (Claude Sonnet 5.5)

**Reviewed head:** b92b943cb98983c450f0f9e05972cf6c4da6dcf3
**Base:** 82aecead4c32861c3b2321af4abf7fcd1dc14731 (main)
**Model:** Claude Sonnet 5.5, fresh independent context (did not author/direct/remediate)
Scratch worktree at exact head (removed afterwards); private Postgres container rev738-pg (removed by exact id 07c4d182cf08).

## Diff examined
apps/api/src/pending-action/deletion-targets.ts (+export, param widened to Pick<db,"select">),
apps/api/src/service-calendar/index.ts (+8, request-time call), tests/api-integration/service-calendar-usage-delete.test.ts (+608).

## 1 Spec
CAL-9 ("both request and approval recheck references") and CAL-14 (audit failure still commits, test 6) are matched.
The same helper is used at request and approval, so "in use" has one definition (projects + SLA policy versions).
The OpenAPI DELETE route already documents 409. No doc change needed.

## 2 Ordering / leakage
Handler order: auth/role middleware, requester identity, assertCalendarUnused, createPendingAction.
The helper is workspace-scoped (workspaceId from request context).
Probe test (scratch, discarded) of an in-use calendar in workspace A:
- outsider admin in workspace B: 404 "Service calendar not found", the same body as a random non-existent UUID. No 409 leak.
- viewer in the calendar's own workspace, calendar in use: 403, not 409.
Gap: the committed outsider test uses an UNREFERENCED calendar and accepts [403,404], so it does not pin the in-use 404-vs-409 leak case. See N1.

## 3 No side effects on 409
The test asserts 0 pending_action rows, 0 audit rows with entityType pending_action, and the calendar still present.
No event assertion, but the check precedes createPendingAction, and mutation M2 (check moved after create) is caught.

## 4 Tests / mutations (new file, 8 tests)
Baseline 8/8 pass. Mutations, each reverted:
- M1 request-time check disabled: 2 fail (project test, SLA test).
- M2 check moved after createPendingAction: 2 fail.
- M3 policy-version query dropped from the helper: 1 fail (SLA test).
- M4 409 -> 400 in the helper: 3 fail.
- M5 project query matches any non-null serviceCalendarId (calendar filter dropped): SURVIVES (8 pass). See N2.
- M6 approval-time call removed: 1 fail (approval recheck test).
The `version_changed` assertion matches main: deletion-targets.ts sets `reason: "version_changed"` in eager invalidation (lines ~276 and ~693). The test passes against it. The assertion is legitimate, not weakened.

## 5 Runs (exit codes)
- Integration: service-calendar + pending-action files, 8 files / 127 tests passed, exit 0.
- check:openapi: exit 0 (282 operations).
- check:route-policy: exit 0.
- lint:ci: exit 0 (208 pre-existing warnings, 0 errors).
- typecheck: exit 0 (9/9 tasks).
- test:permissions: exit 0 (15 files / 95 tests in the api package).

## Findings
- N1 (non-blocking): add a committed test where an outsider in another workspace DELETEs an in-use calendar and expects exactly 404. Also tighten [403,404] to the real status. Behaviour is correct today; only the regression pin is missing.
- N2 (non-blocking): no test has a project referencing a DIFFERENT calendar while deleting an unused one. M5 survives, so an over-broad "in use" query would pass. Suggest one extra assertion in the unused-request test.
- N3 (non-blocking, informational): the request-time check is not locked, so a reference added between request and approval is caught only by the approval recheck. This is by design and tested.
- N4 (process): the change touches pending-action/deletion-targets.ts, which is likely security-scope. The Sol review is required.
No blocking findings.

## Verdict
APPROVE (ordinary review A, no blocking findings; N1/N2 test-hardening recommended). Security-scope Sol review still required.
<!-- END REPORT (sha256 12033eb469d09125c5dcb10127f26900d8abff748915a49d28c06a28dc75c43f) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/738-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 e97554b3abbfa8fc4a8599d702f70edb7c8acebd1ef49f469de9185f43e1605c) -->
# PR #738 ordinary review B (spec / pending-action design / whole system)

**Reviewed head:** 71fa732506854825a48adb3c29f1d3c106215f86
**Base:** main 82aecead4c32861c3b2321af4abf7fcd1dc14731
**Model:** Claude Sonnet 5.5 (fresh context; did not author, direct or remediate; reviewer A report not read)

## Diff scope
3 files, +712/-2: `apps/api/src/pending-action/deletion-targets.ts` (export assertCalendarUnused, param widened to `Pick<typeof db,"select">`), `apps/api/src/service-calendar/index.ts` (DELETE route calls it before createPendingAction), new `tests/api-integration/service-calendar-usage-delete.test.ts`.

## 1. Request-time check vs other deletion targets
- Only two pending-action deletion targets exist on this head: `service_calendar` and `saved_view` (approval-contract.ts; `user` deactivation uses a separate path). Projects, request types and SLA policies are NOT pending-action deletion targets, so there is no sibling pattern to be inconsistent with. saved_view has no inbound references, so no CAL-9 analogue.
- Route placement is right: after requester identity check, before createPendingAction, nothing written on 409. Outsider case stays 404 because reach resolution runs first (test pins exactly 404, no `service_calendar_in_use` leak).
- Single shared definition of "in use" (project.service_calendar_id + sla_policy_version.calendar_id, workspace scoped) used by request and approval: no drift. Reading via `db` outside a tx at request time is fine (advisory; approval is authoritative).

## 2. Port from #589 (2350397b)
Diffed #589's `service-calendar-usage-delete.test.ts` against this head: all 6 original tests retained, nothing removed or weakened. Changes:
- Request-time rejection test renamed "CAL-9: ..." and strengthened (session row added, asserts zero pending_action audit rows).
- Version-change test: `pending_action_target_changed` -> `pending_action_not_pending` at approval, plus new assertion `invalidationReason === "version_changed"`. Faithful to main: `service-calendar/repository.ts` runs PATCH inside `withWorkspaceDeletionAccessLifecycle`, which invalidates pending deletions eagerly, so approval sees a non-pending row. Net stricter (reason asserted). The approval-time `targetVersions` branch is now effectively unreachable by test (implementer mutant M3 survived); defense in depth only.
- 4 new tests: credential/role/workspace scoping, SLA-policy-version reference, other-calendar-does-not-block, outsider 404. CAL-14 deletion audit-failure test unchanged and passing (spec CAL-14 text covers create/update; that coverage is in service-calendar.test.ts, passing).

## 3. Concurrency
- Reference added between request and approval: covered by approval recheck + test.
- Reference added during approval: approval tx takes `SELECT ... FOR UPDATE` on the service_calendar row, then assertCalendarUnused and DELETE in the same tx. Both referencing tables have composite FKs to service_calendar(workspace_id,id) `ON DELETE restrict` (drizzle 0088 sla_policy_version, 0113 project). A concurrent insert/update setting a reference takes FOR KEY SHARE on the calendar row, which conflicts with FOR UPDATE, so it blocks until approval commits and then fails the FK; if it committed first, the post-lock read (READ COMMITTED) sees it and returns 409. The FK is the final backstop, so no dangling reference is possible. The approval check is transactional with the delete. Residual: a FK RESTRICT firing mid-approval would surface as a raw constraint error rather than `service_calendar_in_use` (very narrow; no test).

## 4. Runs (scratch worktree at exact head, `pnpm install --frozen-lockfile --offline`, private Postgres 18 container `cal738_test` on 127.0.0.1:55438, stopped by exact id, started with --rm; worktree removed)
- Integration subset (service-calendar-usage-delete, service-calendar, all pending-action*): 8 files / 129 tests passed.
- Full serialized integration suite `CI=true` (Testcontainers Postgres 18, fileParallelism false): 193 files; 192 passed, 1 failed; 2567 tests passed, 1 failed (2568). Failure: `authorization-boundaries.test.ts > every assignee write path is workspace scoped > refuses a non-member through the bulk assignee operation`, in beforeEach `resetTestDatabase` TRUNCATE: Postgres `deadlock detected` (40P01), not an assertion; files untouched by this PR. Isolated rerun of that file with CI=true: 21/21 pass. Treated as a harness flake; I did not rerun the whole suite a second time.
- `pnpm lint:ci`: exit 0 (biome 2292 files, 208 warnings, 0 errors).
- `pnpm typecheck`: 9/9 tasks successful.

## Findings
- Blocking: none.
- Non-blocking: (a) reset-harness TRUNCATE deadlock flake in full run; (b) FK-restrict race would surface as raw error instead of 409; (c) approval-time version check is unreachable by tests given eager invalidation.

## Same-class follow-ups (not for this PR)
- Projects, request types, SLA policies are not pending-action deletion targets on this head; if they gain approvals, each needs the same request-time plus approval-time recheck with a shared predicate. Nothing to fix now.
- Consider mapping FK violation (23503) on the approval DELETE to `service_calendar_in_use`, with a concurrency test.
- Investigate TRUNCATE deadlock in `tests/api-integration/helpers/database.ts` resetTestDatabase.

## Verdict
APPROVE (ordinary reviewer B): no blocking findings at 71fa732506854825a48adb3c29f1d3c106215f86. The change touches pending-action code, so the required exact-head GPT-6 Sol security review still applies.
<!-- END REPORT (sha256 e97554b3abbfa8fc4a8599d702f70edb7c8acebd1ef49f469de9185f43e1605c) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/738-security-opus.md; Claude Opus 5.5; sha256 4abc793dec8d1067b9af6c577d498fcc758841ec77949034756329423ce6b73d) -->
# PR #738 security review: Claude Opus 5.5

**PR:** #738 "fix(api): service-calendar delete rechecks references at request time (CAL-9, #717)"
**Reviewed head:** eea7cd8a700881cba6ad8e3ea91c1475b2d531e6
**Base:** main 1f1abe7ca145d9a9749c869d4a4b94f4eb4d2537
**Model:** Claude Opus 5.5 (claude-opus-5-5)
**Role:** independent security reviewer. I did not author, direct or remediate this change.
**Date:** 2026-10-14

Note: CLAUDE.md names GPT-6 Sol as the mandatory security-scope gate. This review was requested from Opus 5.5 by the conductor. Whether it satisfies that gate is the orchestrator's call, not this report's.

## Head and merge verification

- `gh pr view 738 --json headRefOid` returns `eea7cd8a700881cba6ad8e3ea91c1475b2d531e6`. Mergeable: MERGEABLE.
- The head is a merge commit with parents 71fa7325 (the reviewed branch tip) and 1f1abe7c (main).
- `git merge-tree --write-tree 1f1abe7c 71fa7325` gives tree `872d5861df34889146bc25cd5e66d3cfcda510c6`. That equals `HEAD^{tree}`, so the merge is pure and has no conflict edits.
- Main moved from the branch merge-base 82aecead to 1f1abe7c (PR #733, owner/admin sees_all). That is 21 files: a migration, workspace member controllers, `workspace-admin-reach.ts`, a boot hook in `index.ts`, docs and tests. None of them touch `service-calendar/`, `pending-action/`, `sla_policy`/`project.service_calendar_id`, or the capability middleware used by this route. #733 changes which users count as admins, which is upstream of this route's authorization. It does not interact with the new check.
- `git diff 1f1abe7c HEAD` has 3 files and +712/−2 lines:
  - `apps/api/src/pending-action/deletion-targets.ts`: `assertCalendarUnused` is exported. Its parameter type is widened from `PendingActionTransaction` to `Pick<typeof db, "select">`. Its body is unchanged.
  - `apps/api/src/service-calendar/index.ts`: imports and one call in the DELETE handler.
  - `tests/api-integration/service-calendar-usage-delete.test.ts`: new file, 10 tests.

## Surfaces examined

- `service-calendar/index.ts`:
  - the `calendarReach` middleware;
  - the `deleteCalendarRoute` middleware chain and handler;
  - the usage and preview routes, for comparison.
- `pending-action/deletion-targets.ts`:
  - the service-calendar approval executor (about lines 240–360);
  - `assertCalendarUnused`;
  - the remaining callers.
- `pending-action/service.ts`: `requirePendingActionRequesterIdentity`.
- `permissions/resolve-identity.ts`: `resolveIdentity`, checked for writes. It has none.
- Migrations 0082, 0088 and 0113, for FK definitions on `service_calendar`.
- The new test file, in full for the security-relevant cases.
- Prior reviews `738-ordinary-a-sonnet.md` and `738-ordinary-b-sonnet.md`, for their findings only.

## Security questions

### 1. Existence and usage oracle

- **Outsider (another workspace).** `calendarReach` runs first in the middleware chain. It loads the calendar's workspace by id. A missing row gives 404. A workspace-access failure (403) is rewritten to 404 "Service calendar not found". This happens before the capability middleware and the handler, so an outsider can never reach `assertCalendarUnused`. The pinned test "an outsider gets 404, never 409, for an in-use calendar in another workspace" asserts:
  - exactly 404;
  - the body does not contain `service_calendar_in_use`;
  - zero pending actions and zero pending-action audit rows;
  - the calendar still exists.

  It passes.
- **Same workspace, no `sla_policy:manage`.** `requireApiKeyPermissionScope({sla_policy:["manage"]})` and `requireWorkspaceCapability("sla_policy:manage")` are route middleware, so they run before the handler. The committed 403 tests (read-only key, viewer) use unused calendars, so on their own they do not prove 403 comes before 409. I wrote an ad-hoc probe (not committed). It used:
  - a viewer DELETE on an **in-use** calendar in its own workspace;
  - a `sla_policy:read`-only API key DELETE on an **in-use** calendar.

  Both returned 403 and neither body contained `service_calendar_in_use`. An unknown id with the read key gave 404. No pending action was created. Separately, any same-workspace caller with `sla_policy:read` can already see usage counts via `GET …/usage`, so a 409 would reveal nothing new to a manager.
- **Cross-workspace usage.** Both reference queries filter on `workspaceId = c.get("workspaceId")`. That value comes from the calendar row (`workspaceIdSource: "row"`), not from the caller. The FKs are composite `(workspace_id, calendar_id)`, so references cannot cross workspaces.

### 2. Ordering and atomicity

- Handler order:
  1. requester identity (read-only `resolveIdentity`; 401 if absent);
  2. `assertCalendarUnused(db, …)`, which only runs SELECTs;
  3. `createPendingAction`.

  There is no write before the check. Mutation M4 (moving the check after `createPendingAction`) is caught by the zero-pending-action assertions.
- The request-time check is not locked, so there is a TOCTOU window between check and approval. That is acceptable because it is advisory. The authority is the approval-time recheck, which runs inside the approval transaction:
  1. `SELECT … FROM service_calendar WHERE id = $1 FOR UPDATE`;
  2. checks for workspace equality, `targetVersions` and required access (invalidation paths);
  3. `assertCalendarUnused(tx, …)`;
  4. `DELETE … WHERE id AND workspace_id AND version`;
  5. the pending-action state update.

  `project_workspace_service_calendar_fk` (0113) and `sla_policy_version_workspace_calendar_fk` (0088) are both `ON DELETE restrict`. A concurrent inserting transaction takes `FOR KEY SHARE` on the parent row, which conflicts with `FOR UPDATE`. Either the recheck sees the committed reference, or the restrict FK rejects the delete. A dangling reference is not reachable. The one edge left was already noted by reviewer B: an FK violation would surface as a raw error, not a 409. That is non-blocking and fails closed.

### 3. Pending-action integrity

- `saved_view` deletion and the other deletion targets are untouched. The only change in `deletion-targets.ts` is `export` plus the widened parameter type, and the function body is byte-identical.
- `assertCalendarUnused` has exactly two callers: the approval executor (under tx and lock) and the DELETE handler (behind `calendarReach` and the manage-capability middleware). It is a pure read predicate that throws 409. It performs no mutation and grants nothing, so calling it elsewhere cannot skip authorization. The worst case is an existence/usage oracle if a future caller invoked it before a reach check. Today no such caller exists.
- The widened type `Pick<typeof db,"select">` accepts both `db` and a transaction. It does not let a caller pass anything that can write through this function.

### 4. Tests

Commands were run in a scratch worktree at the exact head, against a private `postgres:18-alpine` container (`opus738_test`, port 55738) that I created.

| Command | Result |
| --- | --- |
| `vitest run --config vitest.integration.config.ts` with `service-calendar-usage-delete`, `service-calendar`, `pending-action-*` (5 files), `pending-actions-*` (2 files) | **8 files, 129 tests passed** |
| `pnpm test:permissions` (root turbo; builds workspace packages first) | **15 files, 95 tests passed**, 5/5 turbo tasks |
| `gitleaks git --log-opts=82aecead..HEAD --redact` | no leaks |
| `gitleaks git --log-opts=1f1abe7c..HEAD --redact` (3 commits) | no leaks |
| `gitleaks dir` on each of the 3 changed files | no leaks |

Running `vitest.permissions.config.ts` directly in `apps/api` first failed with "Failed to resolve entry for package @taskdesk/email". That is an environment issue: the workspace packages were not built. The root `pnpm test:permissions` builds them and passes.

Mutations, each run against `service-calendar-usage-delete.test.ts` and reverted after:

| # | Mutation | Result |
| --- | --- | --- |
| M1 | Remove the request-time `assertCalendarUnused` call | **killed**: 3 failures (project in-use, SLA-version in-use, different-calendar `blocked` 409) |
| M2 | Drop `policyReference` from the in-use predicate | **killed**: the SLA policy version test fails |
| M3 | Replace `eq(serviceCalendarId, calendarId)` with `isNotNull(serviceCalendarId)` (over-broad) | **killed**: the "project bound to a different calendar" test fails |
| M4 | Move the check after `createPendingAction` | **killed**: 2 failures (zero-pending-action assertions) |
| M5 | Remove the approval-time `assertCalendarUnused` | **killed**: the approval-recheck/replacement test fails |

All five mutations were killed, so the tests are non-vacuous. Reviewer A's earlier findings N1 (outsider 404 pin) and N2 (different-calendar case) are now covered by committed tests.

Probe (written, run, then discarded): same-workspace viewer and read-only key on an **in-use** calendar. Both got 403, with no `service_calendar_in_use` in the body. Unknown id gave 404. 1 test passed.

### 5. The merge

The merge is pure (the tree equals the merge-tree). Nothing from main touches this route, `calendarReach`, the capability middleware, or pending-action code. See the head and merge verification above.

## Findings

- **Blocking:** none.
- **NB-1 (non-blocking, test hardening).** No committed test proves 403-before-409 for a same-workspace caller without manage on an *in-use* calendar. The existing 403 cases use unused calendars. Ordering is structurally guaranteed by route middleware and my probe confirmed it. Suggest adding an in-use reference to the viewer/read-key cases in "scopes deletion requests by credential, role and workspace".
- **NB-2 (non-blocking, test hygiene).** That same test still asserts `expect([403, 404]).toContain(outsiderDelete.status)`. It is now redundant with the exact-404 pin, but it should be tightened to `toBe(404)` so it cannot hide a regression to 403.
- **NB-3 (non-blocking, informational; already raised by reviewer B).** On approval, a reference inserted concurrently could in principle surface as an FK-restrict error instead of a clean 409. This fails closed: no deletion and no dangling reference.
- **NB-4 (non-blocking, design note).** `assertCalendarUnused` is now exported and does no reach check of its own. Any future caller must run it only after workspace reach and authorization, or it becomes a usage oracle. A one-line note in its doc comment would make that explicit.

## Residual risk / not checked

- I did not run the full integration suite, the e2e, visual or OpenAPI contract jobs, or an image build. GitHub checks were still pending, apart from GitGuardian (SUCCESS), when I verified the head.
- I did not execute a real concurrent-transaction race test. The lock and FK reasoning comes from code and schema reading.
- I relied on the ordinary reviews for non-security correctness of the UI/docs surfaces. This PR has none.

## Cleanup

The scratch worktree is removed and pruned. The temporary ref `refs/remotes/origin/pr-738` is deleted. Postgres container `cb1723aaade0742136672f0c09cef6a4c03a4715021fc70453314ceff4100a1f` was removed by exact ID. The main checkout was not modified.

**Verdict:** CLEAR
<!-- END REPORT (sha256 4abc793dec8d1067b9af6c577d498fcc758841ec77949034756329423ce6b73d) -->
