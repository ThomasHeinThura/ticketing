# PR #742 security review record: reach-filter workspace lists and search; reach on view create and submission accept (#740, #741)

PR #742 closes #740 and #741, the remaining same-class reach gaps after #712 and #730.

**Read routes filtered by reach in SQL.** These now return only rows from projects the caller can reach. Pages, ranking and counts never include hidden rows.
- the workspace label list;
- search (tasks, projects, comments and activity);
- the project list;
- saved views, listed or fetched by id;
- submission duplicate suggestions.

**Saved-view routes by id.** Get, PATCH, delete request, pin, run and count answer out-of-reach exactly as missing, through the shared `fromSavedView()`.

**Write routes.** Each answers an unreachable target exactly as a missing one.
- View create returns 400.
- Submission accept returns 422. The submission stays claimed afterwards, and stuck claims are tracked in #743.
- Duplicate link returns 404.

**Accepted submissions.** One shared helper decides every staff exposure of the converted work item: its id, its comments, and its attachment list and download.

**Guards.** These are derived from the policy registry and the real router. They cover every workspace-scope GET and every staff `/api/submissions` route.

A Claude Sonnet 5.5 lane implemented the change over four rounds. Round 4 changed altitude to a single submission-linked rule. The reviewers below are fresh, independent contexts. Follow-ups are #743 and #745.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: REQUEST CHANGES at `a0802b6d`, because the saved-view list exposed project-scoped views. Delta APPROVE at `2a090115`.
- Ordinary review B by Claude Sonnet 5.5: REQUEST CHANGES at `2a090115`, because the submission detail exposed the linked work item. REQUEST CHANGES again at `11c76a60`, because the submission attachments did the same. Delta APPROVE at `8e4ddd48` after the round-4 altitude change and an independent audit of the submission routes.
- Security review by Claude Opus 5.5: CLEAR at `8e4ddd48`. Out-of-reach answers are byte-identical to missing ones, the SQL filters are parameterised, `sees_all` and customers are scoped correctly, and all 10 mutations were caught. The project socket's reach is filed as #745.
- Security rebind at `691c1a9e`: CLEAR. A pure merge of `main` `16234794` (#735, #719). Both guards stay green on the merged tree.

**Reviewed head:** `8e4ddd485f15533f6ddcdf8051cbf01a140c7f96`
**Reviewed head:** `691c1a9e0be742fa3702416e9df1e4ce7df08c72`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `740-741-ordinary-a-sonnet.md` | Ordinary review A (6389d6e7..a0802b6d) | Claude Sonnet 5.5 | `a0802b6d` | REQUEST CHANGES | `4fbce1843ab42ca79826781ccf82dbd3a7e93f3104337a71d60a200a7bf1c65e` |
| 2 | `742-2a09-ordinary-delta-a-sonnet.md` | Ordinary delta review A (a0802b6d..2a090115) | Claude Sonnet 5.5 | `2a090115` | APPROVE | `4597b763d6991533f3bc4a3326e8900661f90b3a92e1bf7e1649250e0ae3a0b2` |
| 3 | `742-ordinary-b-sonnet.md` | Ordinary review B (a31bdde3..2a090115) | Claude Sonnet 5.5 | `2a090115` | REQUEST CHANGES | `4bfbb3d444820e9499379eb6694980dfad5db2a54181affbd7e08a84e76eabbf` |
| 4 | `742-11c7-ordinary-delta-b-sonnet.md` | Ordinary delta review B (2a090115..11c76a60) | Claude Sonnet 5.5 | `11c76a60` | REQUEST CHANGES | `048580d666d59108067b95d183860ab3bb9ea642d6659c69fa157c736f6c2717` |
| 5 | `742-8e4d-ordinary-delta-b-sonnet.md` | Ordinary delta review B (11c76a60..8e4ddd48) | Claude Sonnet 5.5 | `8e4ddd48` | APPROVE | `e918f0190ea92a192922f1fbb0a253e935d78c0799479697775aa8156a6eb05c` |
| 6 | `742-security-opus.md` | Security review (2e03855e..8e4ddd48) | Claude Opus 5.5 | `8e4ddd48` | CLEAR | `10597158aeb0374b95cf695f22f7cac08cd5e1520186a29862d44d9fcaf47826` |
| 7 | `742-691c-security-rebind-opus.md` | Security rebind (8e4ddd48..691c1a9e) | Claude Opus 5.5 | `691c1a9e` | CLEAR | `fe2e3940098cb29ffdd3c7bc794ebe1e33117a217ff850442981826f8595436d` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/740-741-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 4fbce1843ab42ca79826781ccf82dbd3a7e93f3104337a71d60a200a7bf1c65e) -->
# Ordinary review A: PR #742 (#740, #741)

**Reviewed head:** a0802b6dc3f59711cb7b6eb651df7732f850016d
**Base:** main 6389d6e7f245434fadb44f677d629bceaa4aca12
**Model/context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate).
Scratch worktree at the exact head (removed); private Postgres container rvA-740-pg (id 754e2bd61c61, removed by exact id). Main checkout untouched.

## Verdict
**CHANGES REQUESTED (one blocking finding F1; everything in the issue's named scope is sound).**
The three named reads and two named writes are correct and well tested. The blocking item is an unsound guard exemption (`GET /api/views`) that still leaks a hidden project's id, view name and query to a reachless member.

## Commands and counts (all at the exact head, serialized)
| Command | Result |
| --- | --- |
| integration (new + changed): project-reach-reads, project-reach-writes, project-list, project-reorder, global-search-soft-delete, intake-atomic-conversion, project-organisation-binding (+ one more matching file) | 8 files, 108 tests passed |
| `pnpm test:permissions` | exit 0; 16 files, 106 tests |
| `pnpm check:route-policy` | exit 0 |
| `pnpm check:openapi` | exit 0 |
| `pnpm lint:ci` | exit 0 |
| `pnpm typecheck` | exit 0 |
| unit tests/api/task/bulk-update-tasks.test.ts | 2 passed |
Logs: 740-741-ordinary-a-*.log in this folder. (First attempt at running the guard via bare vitest failed to resolve `@taskdesk/email` because packages were not built; `pnpm test:permissions` builds them. Not a code issue.)

## Reviewer B's #730 probe re-run against this head
Probe: 730-4921-b-probe.test.ts, extended (740-741-ordinary-a-probe.test.ts, output 740-741-ordinary-a-probe-output.json).
- Reachless member: workspace label list no longer contains the task-bound label (`leaksTaskBound false`); search returns 0 results / totalCount 0 for type all, tasks, projects, comments, activities, short id `P-1`, and `projectId=` filter naming the hidden project; project list returns 0 (was 1).
- Owner (sees_all): label, task and project (n=1) still visible.
- Note: B's original `leaksTask:true` is a probe artefact for search (`searchQuery` echoes the query); I re-checked on the `results` array: no leak.
Leaks are gone.

## 1. Reads
- Reach is applied in SQL for every search query (short id, tasks, projects, comments, activity) through one `workspaceFilter` (`project.id IN reachable`, or `false` when empty). Page, ranking, `totalCount` are built from filtered rows only. Workspace-type hits stay (members already know their workspace).
- Label list: definitions (no task) always listed; task-bound labels only if the task's project is reachable (subquery). Project list and its rollup statistics both restricted; empty set returns early.
- Same decision source as the single-row middleware (`reaches()`, project's own organisation_id; ancestors/ownerTeam false in both, so list and item routes agree).
- Customers: `reaches` step 6 compares against the project's organisation. Only a "customer with no org reach" row is driven; a positive org-bound customer is not (mutant M6 survives, below). Practically customers are not workspace members of these staff routes, so low risk.
- Performance: `reachableProjectIds` is one query per request (all live projects of the workspace(s), filtered in JS), then passed as an IN list. No N+1. Indexes exist: `project_workspaceId_position_idx`, `task_projectId_idx`, `label_task_id_idx`, `label_workspace_id_idx`, `task_activity_task_id_idx`. Non-blocking: the IN list grows with project count (bind-parameter ceiling 65535; fine at realistic sizes), and sees_all/instance admin could skip the list entirely. Search ILIKE '%q%' is pre-existing.
- Product note (decision, not a defect): a plain admin or a project creator no longer lists projects they do not reach (the PR had to give three suites a sees_all member for this). Consistent with rbac.md ("creating a project does not grant reach") but is a visible behaviour change; the orchestrator should confirm it is intended for the UI.

## 2. Writes
- `POST /api/views` project scope: unreachable same-workspace project, foreign-tenant project and missing id all return the identical 400 body, row count unchanged (test compares bytes for 4 outsiders). Correct.
- `POST /api/submissions/{ref}/accept`: unreachable project returns the identical 422 as missing/foreign org; no work item created. The reach callback runs inside the transaction but uses the pre-resolved identity and the project row it already holds (no extra DB connection, no pool-deadlock risk).
- Claim persistence: the claim commits before validation (IQ-16a, pre-existing), so in both the missing and unreachable case the submission stays claimed by the caller. Because the response is the same, no new oracle. Assessment: acceptable for this PR, but it is a stuck-claim risk (F3): there is no release/unclaim route, `POST /claim` is open to any `intake:triage` holder regardless of reach, and another triager's accept then gets 409 "claimed by another triager". A reach-limited triager can therefore park a submission that only others can accept. Pre-existing mechanism, slightly easier to reach now. Recommend a follow-up (claim release/reassign, or claim scoped to reach). Non-blocking.

## 3. Guard (15 exemptions)
Derivation from the policy registry (GET, workspace scope, only `{workspaceId}` param) gives 18 candidates = 3 declared + 15 exempt; negative cases and stale/contradictory checks are present and non-vacuous.
Sound: canned-responses, project/organisations, service-calendars, sla-policies, views/team-audiences, workflows (top-level rows carry no projectId), workspace row, invitations, members, roles, work-item-types, `workspaces/{id}/audit` (verified reach-filtered in the audit reader).
- `GET /api/submissions`: exemption is right. I read `listSubmissions` and the route mapper: the response has no work item id, no project id/name/key/title (ref, summary from the form, state, claim, request type ref, requester, organisation). The reason text is inaccurate ("carries an opaque work item id at most"; it carries none) and the "follow-up" it cites is unnecessary. Non-blocking nit: fix the wording.
- `GET /api/request-types`: exposes `defaultProjectId` (id only) behind `request_type:read`. Acceptable, but the reason should say so (non-blocking).
- **F1 (BLOCKING): `GET /api/views` is wrongly exempted.** `listSavedViewsForWorkspace` returns whole rows for workspace/team-visible views, including `scopeId` (project id), `name` and `query`. Probe (740-741-ordinary-a-probe2.test.ts, output -probe2-output.json): owner creates a project and a workspace-visible project-scoped view; a reachless member lists views and receives it (`leaksProjectId true`, `leaksName true`). The stated reason ("running a view filters by reach") does not cover the definition leaking. Fix: drop project-scoped views whose project is outside `reachableProjectIds` in the SQL (and declare `requireReachFilteredList`), or fix and cite a filed follow-up if the orchestrator decides it is out of #740's scope; at minimum the exemption text must not claim soundness. Note single `GET /api/views/{id}` has the same shape (not enumerated by the guard).
- **F2 (non-blocking, follow-up; guard gap): the derivation only sees routes whose sole path parameter is `workspaceId`.** Workspace-scoped sub-collections with `{id}`/`{ref}` are not enumerated. Concrete instance by code reading (not probed): `GET /api/submissions/{ref}/duplicates` (`suggestDuplicateWorkItems`) returns work item id, key and title from any project of the submission's organisation to a triager, with no project reach filter. Also worth a look: `GET /api/service-calendars/{id}/usage`, `GET /api/workflows/{id}`. Outside the three routes #740 names, so not blocking, but file an issue.

## 4. Test changes (sees_all in three suites)
project-list, project-reorder, global-search-soft-delete now build their member with `createSeesAllWorkspaceMember` (role as before, plus a workspace-scoped sees_all membership whose role has only `workspace:read`). Those suites assert list contents, ordering and soft-delete behaviour, not authorization; none asserts a 403/404. The new grant adds reach, no capability beyond what a member already has. Faithful, not a weakening; plain-member reach behaviour is covered by project-reach-reads. Direct `acceptSubmission` callers pass `async () => true`, which matches the old unrestricted behaviour; the bulk-update mock gained `reachableProjectIds`.

## 5. Mutations (each restored via git checkout; worktree clean after each)
| # | Mutation | Result |
| --- | --- | --- |
| M1 | label list: drop task-bound reach condition | KILLED (7 failed) |
| M2 | search: drop reach clause from workspaceFilter | KILLED (9 failed) |
| M3 | project list: drop reachFilter in findMany | KILLED (3 failed) |
| M4 | views create: skip reach check | KILLED (2 failed) |
| M5 | accept: ignore canReachProject | KILLED (3 failed) |
| M6 | reachableProjectIds: pass organisationId null (customer reach dropped) | SURVIVED (64 passed): no positive customer-org test (non-blocking gap) |
| M7 | reachableProjectIds: include soft-deleted projects | KILLED (1 failed) |
| M8 | guard: label route loses requireReachFilteredList | KILLED (guard 1 failed) |
| M9 | guard: delete the GET /api/views exemption | KILLED (guard 1 failed; shows the guard does list views as a candidate) |
| M10 | search: reachable computed over all accessible workspaces instead of the requested one | SURVIVED, equivalent (outer eq(workspaceId) still applies) |
| M11 | guard: views create loses requireReachContext | KILLED (1 failed) |
| M12 | guard: list middleware drops reachFilteredList flag | KILLED (2 failed) |

## Findings summary
- F1 BLOCKING: `GET /api/views` exemption unsound; leaks project id, view name and query (probed).
- F2 non-blocking: guard derivation misses workspace-scoped sub-collections; `GET /api/submissions/{ref}/duplicates` leaks work item key/title across reach (code-read).
- F3 non-blocking: stuck-claim risk after a failed accept; no release route.
- F4 non-blocking: no positive customer-organisation reach test (M6).
- F5 non-blocking: `reachableProjectIds` loads all projects and passes a large IN list; consider a sees_all shortcut.
- F6 non-blocking nits: inaccurate `GET /api/submissions` exemption text; request-types `defaultProjectId` note.
- F7 decision for the orchestrator: plain admins and project creators no longer list their projects without sees_all or membership.

Verdict: CHANGES REQUESTED (F1). With F1 fixed or explicitly deferred by the orchestrator with a corrected exemption reason, and the Sol security review at the final head, I see no other blocker.
<!-- END REPORT (sha256 4fbce1843ab42ca79826781ccf82dbd3a7e93f3104337a71d60a200a7bf1c65e) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/742-2a09-ordinary-delta-a-sonnet.md; Claude Sonnet 5.5; sha256 4597b763d6991533f3bc4a3326e8900661f90b3a92e1bf7e1649250e0ae3a0b2) -->
# Ordinary delta review A: PR #742 round 2

**Reviewed head:** 2a090115c9c00f8ba20464d2c9f636be9d00ef5e
**Prior reviewed head:** a0802b6dc3f59711cb7b6eb651df7732f850016d (CHANGES REQUESTED, F1 blocking)
**Model/context:** Claude Sonnet 5.5, fresh independent context (did not author or remediate). Scratch worktree and private Postgres (rvA-742-pg, bc08e194f1e4) removed afterwards. The delta also contains the merge of main a31bdde3 (web/i18n files); I reviewed only the api, guard and test delta.

## Verdict
**APPROVED for the ordinary tier**, with non-blocking findings (N-1 below should be fixed or ticketed). F1 and F2 are fixed, F4 closed, exemption text fixed.

## Runs
| Command | Result |
| --- | --- |
| integration: project-reach-reads/writes, view, intake-*, duplicate files (pattern run) | 18 files, 373 tests passed |
| `pnpm test:permissions` | exit 0; 16 files, 106 tests |
| `pnpm check:route-policy` | exit 0 |
Logs: 742-2a09-ordinary-delta-a-*.log. (I did not re-run lint/typecheck/openapi; the implementer reports exit 0 and the delta in api code is small.)

## F1 re-probe (`GET /api/views`)
Probe 742-2a09-ordinary-delta-a-probe3.test.ts (output -probe3-output.json). Owner creates a workspace-visible project-scoped view.
- Reachless member: list returns 0 rows with no leak (was: project id, name, query); `GET /api/views/{id}` returns 404 with a body byte-identical to a missing id. Owner still sees and gets it. Fixed.

## Residual the implementer flagged: PATCH, pin, count by a reachless member (probed)
| Call (reachless member, hidden view id) | Result | Missing id |
| --- | --- | --- |
| PATCH | 403 "Insufficient permissions" (no content, no change; needs manage_settings or ownership) | 404 |
| POST pin | 200, adds the id to the member's own pinned list; audit row and event carry the hidden project id | 404 |
| GET count | 200 `{"count":0}` | 404 |
No content leaks (name, query, project id are not returned; list stays filtered; pinned id is inert because the list filters it). What remains is a **view-id existence oracle** (200/403 vs 404) and a pin write side effect. Ids are 24-char random strings and no longer enumerable via the list, so exploitation needs a leaked id. Non-blocking (N-1): move the reach check into the shared `getView` controller (used by pin) and the count/PATCH lookups so all four answer 404 like a missing view, matching the "answered exactly as missing" principle the PR states. The `GET /api/views/{id}/count` exemption wording ("returns a number, never a row") is true but hides the oracle.
Workspace admin role in the probe also reaches the project (list/get 200), so I could not drive a manage_settings-without-reach caller; PATCH by such a caller would return the full view row (name, query, scopeId). Not probed; worth including in the N-1 fix.

## F2 (duplicates)
Suggestions now restricted by `reachableProjectIds` in SQL (empty set returns []); the link route (`POST /submissions/{ref}/duplicate`) answers an out-of-reach target with the same 404 as a missing item, same point as the org check, and declares `requireReachContext`. Mutations N4, N5 killed. Fixed.

## Guard: 11 new exemptions (26 total) and the generalised derivation
Candidates are now every workspace-scope GET. A route passes if it declares `reachFilteredList` OR any `projectReach` mark, else needs a reasoned exemption.
- Sound: invitation/{id}, request-types/{id} (default project id only), service-calendars/{id}, /preview, sla-policies/{id}, workflows/{id} (definition and transitions; the project-bearing validation schema is not a GET route in the registry), submissions/{ref}/attachments and /{id}, service-calendars/{id}/usage (reference counts only).
- Inaccurate wording (non-blocking N-2): `GET /api/submissions/{ref}` says "no project or work item fields", but the detail returns an opaque `workItemId` (no project, key or title; unusable without work-item reach). Fix the text.
- `GET /api/views/{id}/count`: see N-1 (oracle).
- Weakening note (non-blocking N-3): the check now accepts any `projectReach` mark as "declared", so a LIST route that carries only a single-row or `requireReachContext` mark would pass without filtering. Every list route in this family has behavioural rows, but the structural guard is weaker for lists than before. Consider requiring `reachFilteredList` when the route has no `{id}`-style path parameter.
- Derivation is generic and non-vacuous (negative unit cases updated; the singleRow case now expects pass, deliberately).

## F4 / M6
Positive customer test added; M6 (customer organisation dropped in `reachableProjectIds`) now KILLED (1 failed). The test drives the shared decision source and the three queries, since customers are refused on staff routes (403); acceptable.

## Mutations (restored via git checkout after each; worktree clean)
| # | Mutation | Result |
| --- | --- | --- |
| M6 | customer org dropped | KILLED (1) |
| N1 | views list reach filter neutralised | KILLED (6) |
| N2 | view get out-of-reach 404 removed | KILLED (5) |
| N3 | projectScopeInReach: empty set returns everything | KILLED (4) |
| N4 | duplicate suggestions reach filter removed | KILLED (2) |
| N5 | duplicate-link reach check removed | KILLED (1) |
| N6 | views list loses requireReachFilteredList | KILLED (guard 1) |
| N7 | delete the views/{id}/count exemption | KILLED (guard 1) |
| N8 | duplicates route loses requireReachFilteredList | KILLED (guard 1) |

## Findings
- N-1 non-blocking: pin/count/PATCH on a hidden project-scoped view answer 200/200/403 instead of 404 (existence oracle; pin write side effect).
- N-2 non-blocking: `GET /api/submissions/{ref}` exemption text omits the opaque `workItemId`.
- N-3 non-blocking: guard accepts any `projectReach` mark for list routes.
- Carried from round 1 (still open, non-blocking): stuck-claim after a failed accept (no release route); no sees_all fast path in `reachableProjectIds`.

Verdict: APPROVED (ordinary tier) at 2a090115c9c00f8ba20464d2c9f636be9d00ef5e. Security-scope Sol review still required.
<!-- END REPORT (sha256 4597b763d6991533f3bc4a3326e8900661f90b3a92e1bf7e1649250e0ae3a0b2) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/742-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 4bfbb3d444820e9499379eb6694980dfad5db2a54181affbd7e08a84e76eabbf) -->
# PR #742 ordinary review B (design, whole system, product impact)

**Reviewed head:** 2a090115c9c00f8ba20464d2c9f636be9d00ef5e
**Base:** main a31bdde3fde0d31b77bf7452f97abab7b8ce63fc
**Model:** Claude Sonnet 5.5 (fresh independent context; did not author, direct or remediate; reviewer A's report not read)
Scratch worktree at the exact head (removed afterwards). Testcontainers Postgres (CI=true); no container of mine left.

## Commands and counts
| Command | Result |
| --- | --- |
| `CI=true vitest run --config vitest.integration.config.ts` (full, serialized) | 199 files, 2830 tests: 198 files / 2829 tests passed, 1 failed |
| the 1 failure: `boot-orchestration-success.test.ts` | "Metrics listener failed to bind on 9464": another process on this host (pid 94710, not mine) held port 9464. Re-run alone after the port freed: 1 file, 1 test passed. Environmental, unrelated to the diff |
| `pnpm test:permissions` | 16 files, 106 tests passed |
| `pnpm check:route-policy` | exit 0 |
| `pnpm check:openapi` | exit 0, 282 operations match |
| `pnpm lint:ci` | exit 0 (Found 210 warnings, 1 info; no errors) |
| `pnpm typecheck` | exit 0, 9/9 tasks (FULL TURBO cache replay for identical inputs) |
| web vitest | not run: the PR touches no file under apps/web or packages/ui |

## Guard experiment (negative test)
Added a new `GET /api/canned-responses/probe` (workspace:read, workspace scope) with no declaration.
- With the route only: the guard stayed green, because the registry has no policy for it. The route-coverage and matrix tests are what stop an unregistered route.
- With the route and a policy entry: guard failed with `GET /api/canned-responses/probe: a workspace-level list/search with no reach-filtering declaration and no reasoned exemption` (plus the matrix rows). Confirmed. Changes reverted.
- Read all 26 `LIST_REACH_EXEMPT` entries. 25 are sound (config, definitions, own-attachments, counts). One is false, see F1.
- The candidate set is only GETs whose policy scope is `workspace`. 82 other GETs (self, instance, portal, public, delegated) are outside it by design. Listed in `742-ordinary-b-nonworkspace-gets.tsv`. Of interest: `GET /api/notification`, `GET /api/me/approvals` (self scope) and the `/api/ws/{projectId}` WebSocket (workspace-level reach only). Not part of #740; see N5.

## Performance (500-project workspace, 20 tasks each, 10,000 tasks)
Probe `742-ordinary-b-perf-probe.test.ts`, output `742-ordinary-b-perf-output.txt` (median of 7, ms):
| Caller | /api/project | /api/search | label list | /api/views |
| --- | --- | --- | --- | --- |
| member reaching 5 projects | 7.7 | 7.3 | 6.4 | 6.4 |
| sees_all (502 ids in the IN list) | 13.8 | 24.9 | 6.5 | 6.4 |
Controller alone: `getProjects` with no filter 5.2, with a 502-id IN list 8.3. `reachableProjectIds` is one indexed SELECT plus an in-memory `reaches()` per project. Acceptable at this size. A sees_all or instance-admin fast path would drop the IN list and ~3-10 ms, but is optional. `GET /api/views/{id}` builds the whole workspace reach set to check one project; a single `reaches()` would be cheaper (non-blocking, N3).

## Design consistency
One decision source: `callerReach().reachableProjectIds`, the same `reaches()` as the single-row middleware. Applied per route as: label list `task_id IN (SELECT id FROM task WHERE project_id IN reach)` or null; search `project.id IN reach` shared by all five sub-queries; project list `id IN reach` plus rollups; views `scope<>'project' OR scope_id IN reach`; duplicates `project.id IN reach`. Four SQL spellings, one set. `requireReachFilteredList` is not a no-op decoy (the handler's `listReachOf(c)` 500s without it). `getProjects` takes the set as a required argument.

## Product impact (web)
No web file changed. Findings from reading the consumers (`useGetProjects`: projects page, nav, project switcher, create-task modal, task move popover, triage, settings/projects; search; labels):
- Lists simply shrink; no crash path found. A `$projectKey` or project route for a hidden project 404s through the single-row middleware.
- Empty state: a member with no project reach sees "No projects yet" / "There are no projects in this workspace yet. Ask an admin to create one." (`workspace:projects.emptyTitle`, `emptyDescriptionReadOnly`). That is wrong when projects exist but are not reachable. Non-blocking (N1).
- Creator lockout: a manager (has `project:create`, no `sees_all`, not owner/admin) creates a project, the modal navigates to its board, and the creator has no reach (rbac.md: creation grants no membership). Result: the new project is absent from their list and its board answers 404. Documented as intended, but it is a real confusing flow. Non-blocking, needs a product decision (N2).
- Triage destination picker: a request type whose `defaultProjectId` is a project the triager cannot reach shows an empty-looking select (the id is not in the filtered list) and Accept posts that default, which now answers the generic 422 "Destination project is unavailable for this organisation". Non-blocking (N4).
- Saved views list and `GET /api/views/{id}` hide project-scoped views of unreachable projects; the web index page just lists fewer.

## Spec and docs
- `rbac.md` was updated, but it is incomplete and slightly wrong: it says "Two writes name their target project" while the code has three (`POST /api/submissions/{ref}/duplicate` also carries `requireReachContext`), and it does not mention the saved-view list/get filtering or the duplicates suggestion filtering (round 2). Non-blocking (N6).
- `search-and-saved-views.md`: SV-3 already says search is scoped to reach, so search now matches. The views section (`GET /api/views`, `GET /api/views/{id}`, `POST /api/views`) says "every view the actor can reach" and was not updated for project-scoped views. `intake-queue.md` and `api-design.md` were not updated for accept destination reach, duplicates filtering, or the decision below (N6).
- The orchestrator decision in the implementer notes (out-of-reach accept answers 422 after the claim commits, not 404) is not in the decision log; it needs an entry (control-plane owner).

## Findings

### F1 BLOCKING (small): guard exemption is false; staff submission detail discloses a work item id and public comment text across project reach
`LIST_REACH_EXEMPT["GET /api/submissions/{ref}"]` says "no project or work item fields", and `GET /api/submissions` says no work item id (list is correct: its schema `pick`s without `workItemId`). The detail route is not: `toStaffSubmission` returns `workItemId`, and `findSubmission` for an `accepted` submission appends the converted work item's public comments as `messages` (`apps/api/src/intake/repository.ts` ~1375-1410), with no reach check.
Reproduced (probe `742-ordinary-b-intake-probe.test.ts`): triager accepts into project P; a `manager` in the same workspace with `intake:triage` and no reach to P calls `GET /api/submissions/{ref}`. Result: 200, body contains the work item id and the public comment text, while `GET /api/work-items/{key}` for the same caller is 404 and `GET /api/project` is `[]`. This is a pre-existing mechanism, but #742 attests it as reach-safe and ships the guard that would stop anyone looking at it again. Fix options: (a) for an accepted submission, include `workItemId` and the transferred comments only when the caller reaches the work item's project (answer as if not converted); or (b) at least correct the exemption text and file a tracked follow-up with the owner's acceptance. Because of the public repo, put the reproduction in the private review record, not in the issue text. (No exploit detail is given here beyond what is needed to locate it.)

### Non-blocking
- N1 Empty-state wording for a member with no reachable project (see above).
- N2 Creator lockout for roles with `project:create` but no `sees_all` (manager); needs a product decision (grant creator membership, or show the project to its creator, or say so in the UI).
- N3 `GET /api/views/{id}` computes the full reach set to test one project; use a single `reaches()`. sees_all/admin could skip the IN list entirely.
- N4 Triage default project the triager cannot reach: blank select and a generic 422 on Accept.
- N5 Out of the guard's candidate set and not part of #740: self-scoped `GET /api/notification` and `GET /api/me/approvals`, and the `/api/ws/{projectId}` socket (workspace reach only, per index.ts ~1728). Track separately if not already (#632/#570 cover realtime partly). Not verified at runtime.
- N6 Docs drift described above (`rbac.md` "two writes", views/intake/api-design specs, decision-log entry for the 422 choice).
- N7 `GET /api/views/{id}/count` on a view of an unreachable project returns a number (200) while `GET /api/views/{id}` is 404: a small existence signal; the exemption reasoning ("returns a number, never a row") is acceptable but note the asymmetry.
- Residuals accepted by the implementer and unchanged: #743 stuck claim after a failed accept (now also reachable via an out-of-reach destination); PATCH/pin on a hidden view.

## Evidence files (all under /Users/heinthura/.codex/taskdesk-evidence/2026-10-14/)
`742-ordinary-b-integration.log`, `-boot-rerun.log`, `-permissions.log`, `-check:route-policy.log`, `-check:openapi.log`, `-lint:ci.log`, `-typecheck.log`, `-guard-negative.log`, `-nonworkspace-gets.tsv`, `-perf-probe.test.ts`, `-perf-output.txt`, `-intake-probe.test.ts`, `-intake-probe-output.txt` (all prefixed `742-ordinary-b`).

## Verdict
**CHANGES REQUESTED at 2a090115c9c00f8ba20464d2c9f636be9d00ef5e: one small blocking finding (F1, false guard attestation plus a demonstrated cross-reach disclosure on staff submission detail). Everything else is non-blocking. Gates are otherwise green (full integration clean apart from a host port collision that passes on rerun).**
<!-- END REPORT (sha256 4bfbb3d444820e9499379eb6694980dfad5db2a54181affbd7e08a84e76eabbf) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/742-11c7-ordinary-delta-b-sonnet.md; Claude Sonnet 5.5; sha256 048580d666d59108067b95d183860ab3bb9ea642d6659c69fa157c736f6c2717) -->
# PR #742 exact-head delta review B (Claude Sonnet 5.5)

**Reviewed head:** 11c76a60d3953a91f47daadcb5c2ee06098eac1d
**Delta base:** 2a090115c9c00f8ba20464d2c9f636be9d00ef5e (my earlier CHANGES REQUESTED, finding F1)
**Model:** Claude Sonnet 5.5, fresh context, not the author. Scratch worktree and Testcontainers Postgres (CI=true), both removed.
The delta includes a merge of main (#736: select.tsx, e2e specs, a security-review file). The PR's own change is commit 11c76a60 (13 files); the web and ui changes are not part of it.

## Runs
| Command | Result |
| --- | --- |
| integration: project-reach-reads, project-reach-writes, view, intake-staff-response-shape, intake-reach-negative, intake-attachment-duplicate-reach, intake-triage-negative, intake-atomic-conversion, plus my probe | 9 files, 116 tests passed |
| `pnpm test:permissions` | 16 files, 106 tests passed |
| `pnpm check:route-policy` | exit 0 |
| `pnpm check:reviews` | exit 0 |

## F1 (staff submission detail): FIXED
Re-ran my probe: manager with `intake:triage` and no reach, accepted submission, public comment on the work item. Detail now returns 200 with `workItemId` null and no comment text (before: both present). The false exemption is replaced by `requireReachContext` on the route, and `GET /api/submissions/{ref}` is in the body-target guard family. Code check: `findSubmission` resolves the work item's project, hides id and carried-over comments when unreachable or when the work item is gone; portal callers pass no callback and are unchanged.

## Saved-view routes: OK
`workspaceAccess.fromSavedView()` now resolves scope and scopeId and answers 404 "Saved view not found" for a project-scoped view whose project is unreachable or deleted, before the capability gate. All six by-id routes use that lookup (get, PATCH, DELETE, pin, run, count; checked in view/index.ts). The test covers a workspace admin holding manage_settings without reach (reads test ~584), a plain member and a member of another project, plus API keys and "nothing written" assertions. `savedView` is now project-bearing in the derived guard. My N3 (single project check on get) is done.

## Docs and decision log: accurate, with one gap
- Decision log: one new entry at the top (newest first), additions only, names the 422-after-claim choice, consequences, #743 and a reversal path. Matches the code.
- `rbac.md` (three writes, view and intake reads), `search-and-saved-views.md` SV-22, `intake-queue.md` IQ-5a and `api-design.md` match the code, except for the attachments gap below (IQ-5a and rbac.md describe the staff detail as reach-gated, which is true only for the detail route).

## New finding F2 (same class as F1), BLOCKING by the same standard as F1
`LIST_REACH_EXEMPT["GET /api/submissions/{ref}/attachments"]` (and `.../{id}`) says "the submission's own attachments; submissions are not project-bound until accepted". For an ACCEPTED submission the staff list also selects every attachment of the converted work item (`apps/api/src/attachment/index.ts` staffSubmissionListRoute, parents include `submissionWorkItemId`, no `customerVisible` filter), and the download route serves them. Confirmed with the probe: the same manager without reach to the project lists an INTERNAL (not customer-visible) attachment filename and metadata through `GET /api/submissions/{ref}/attachments` (200), while the work item itself is 404 and the project list is empty. Pre-existing; the exemption text is false. Fix options: gate the work-item parent of the staff list and staff download by reach to the work item's project (answer as for an unconverted submission), and drop the exemption for a declaration; or correct the exemption and track a follow-up with the owner's acceptance. Reproduction belongs in the private record only.

## Earlier non-blocking points
- Creator lockout: Thomas decided the creator gets project-lead on create, in separate work. No longer a finding for this PR.
- Empty-state copy ("No projects yet / ask an admin to create one" for a member with no reachable project): unchanged, still open, non-blocking.
- Triage destination picker with an unreachable default project (blank select, generic 422): unchanged, still open, non-blocking.
- N5 (notification, me/approvals, `/api/ws/{projectId}`): not part of this PR; unchanged.

## Verdict
**CHANGES REQUESTED at 11c76a60d3953a91f47daadcb5c2ee06098eac1d: F1 and the saved-view finding are closed and verified; one blocking finding remains (F2, staff submission attachments list/download for an accepted submission, same class as F1, with a false exemption). Everything else is non-blocking.**
<!-- END REPORT (sha256 048580d666d59108067b95d183860ab3bb9ea642d6659c69fa157c736f6c2717) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/742-8e4d-ordinary-delta-b-sonnet.md; Claude Sonnet 5.5; sha256 e918f0190ea92a192922f1fbb0a253e935d78c0799479697775aa8156a6eb05c) -->
# PR #742 exact-head delta review B (Claude Sonnet 5.5)

**Reviewed head:** 8e4ddd485f15533f6ddcdf8051cbf01a140c7f96
**Delta base:** 11c76a60d3953a91f47daadcb5c2ee06098eac1d (my CHANGES REQUESTED on F2)
**Model:** Claude Sonnet 5.5, fresh context, not the author. Scratch worktree and Testcontainers Postgres (CI=true), both removed.

## Runs
| Command | Result |
| --- | --- |
| integration: project-reach-reads, project-reach-writes, view, intake-* (staff-response-shape, reach-negative, attachment-duplicate-reach, triage-negative, atomic-conversion, portal-response-shape, triage-actor), attachment*, plus my probe | 16 files, 148 tests passed |
| `pnpm test:permissions` | 16 files, 107 tests passed |
| `pnpm check:route-policy` | exit 0 |

## F2: FIXED
Re-ran my probe (manager with `intake:triage`, no reach, accepted submission, an internal attachment on the converted item). Staff attachment list now returns 200 without the internal attachment; detail still returns no workItemId or comment text; the work item stays 404. Code: `requireSubmissionAttachmentReach` computes `linkedWorkItemId` through `reachableLinkedWorkItemId` for the staff modes and uses it for the list parent, the download's accepted-work-item check and the portal_complete branch (portal modes pass `row.submission.workItemId` unchanged). An out-of-reach caller's download of a work-item attachment fails the "attached to submission or accepted work item" test and answers 404. The helper fails closed (missing item or project returns null).

## Independent audit of submission routes and `submission.work_item_id` readers
Searched apps/api/src for every reader of `submissionTable` and `workItemId` on a submission. Readers: `intake/repository.ts` (accept, duplicate, `findSubmission` staff and portal, `findPortalSubmission`, `postSubmissionMessage`, decline, withdraw, list), `attachment/require-submission-attachment-reach.ts`, the two submission attachment controllers (presign, complete: requester-scoped, portal), and the attachment routes. I agree with the implementer's table:
- Staff exposures of linked work-item data: detail and attachment list/download only; all now go through the helper. Accept and duplicate write or link under a reach check; duplicates suggestions are reach-filtered (earlier rounds).
- `postSubmissionMessage`: the branch that reads the work item (and its projectId, key, comment insert) runs only for `actorType "customer"` on an accepted submission, reached from the portal route; the triager branch returns the message only. A second accept or duplicate on a non-open submission answers 409 with no work item data. Claim, decline and the queue return no work item data (list schema omits it).
- `notification/fanout.ts` only registers the "submission" event class; no staff-facing reader of the linked item found. Webhook delivery is admin-configured and out of scope, as the implementer says.
No missed route found. The table is complete and correct.

## Portal requester view: unchanged
The portal paths do not call the helper: `findSubmission` takes the reach argument only from the staff detail route, and the attachment middleware keeps `row.submission.workItemId` for `portal_*` modes. The test covers it (customer-visible only, internal never). The portal attachment mode now carries a "workspace-only with reason" mark; the guard prefix check (`/api/submissions`) does not match `/api/portal/submissions`, so no conflict.

## Guard bypass attempts
- Undeclared staff route under `/api/submissions`: fails by design (the negative unit test; pattern also seen in the earlier list experiment).
- A new `GET /api/submissions/{ref}/leak` that declares `requireReachContext` but reads the submission with no helper: the project-reach guard PASSES (only the matrix fixture rows failed, 2 tests, because the new route is not in the fixture). So the guard proves declaration, not use, as the code comments already say; the behavioural tests are what prove enforcement. A new route also needs no behavioural row in family 5. Non-blocking residual (N8): consider requiring a behavioural row per staff submission route, or an assertion that the staff detail/attachment handlers call the helper.
- The prefix regex only matches `/api/submissions`; a staff route elsewhere that dereferences `submission.work_item_id` is not covered. None exists today (audit above). Same residual.
- Exemptions are free text; the four entries are accurate.

## Earlier non-blocking points (unchanged, no web files in this delta)
Empty-state copy for a member with no reachable project, and the triage picker with an unreachable default project, remain open and non-blocking. Notification, `me/approvals` and the project WebSocket remain outside this PR.

## Verdict
**APPROVE (ordinary review B) at 8e4ddd485f15533f6ddcdf8051cbf01a140c7f96: F2 is fixed and verified, the audit finds no further exposure of a submission's converted work item, the portal view is unchanged, and the gates I ran are green. N8 and the open web points are non-blocking. This is an ordinary review and does not replace the GPT-6 Sol security review required for this security-scope PR.**
<!-- END REPORT (sha256 e918f0190ea92a192922f1fbb0a253e935d78c0799479697775aa8156a6eb05c) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/742-security-opus.md; Claude Opus 5.5; sha256 10597158aeb0374b95cf695f22f7cac08cd5e1520186a29862d44d9fcaf47826) -->
# PR #742 independent security review (Claude Opus 5.5)

**Reviewed head:** 8e4ddd485f15533f6ddcdf8051cbf01a140c7f96
**Base:** merge base 2e03855edbee5dcab9045e93fd2e06177bd66ea9 (main is now f4f5bf78fed1eeb8845d828b4d7e2c5cf096359a; PR reports MERGEABLE)
**Model:** Claude Opus 5.5 (claude-opus-5-5), fresh context. I did not author, direct or remediate this PR.
**Role note:** CLAUDE.md names GPT-6 Sol as the mandatory security gate. This review is the Opus 5.5 security pass the orchestrator asked for. It does not replace a GPT-6 Sol review if branch policy requires one.

Environment: a scratch worktree, detached at the exact head, removed afterwards. A private Testcontainers Postgres 18 (`CI=true`), reaped by its own teardown. I left no containers behind. The two containers present at the end (`511debddd7b1`, `001ed76056c4`) belong to another lane's vitest run (`review-creator-a`), so I did not touch them. The main checkout is unmodified.

## Surfaces examined

- `utils/caller-reach.ts`: `reachableProjectIds` and the new `organisationId` fast path in `facts()`.
- `utils/reach-filtered-list.ts`, `utils/reach-mark.ts`.
- `utils/workspace-access-middleware.ts`: `assertSavedViewProjectReach` and the saved-view lookup.
- Label list, project list and statistics, `global-search.ts` (all five arms).
- View: list, create, repository (`projectScopeInReach`) and the by-id routes.
- Intake:
  - accept (`convertSubmissionInTransaction` ordering, lock, and the auto-accept default);
  - duplicate link;
  - duplicate suggestions;
  - `findSubmission` staff path;
  - `submission-linked-work-item.ts`;
  - `require-submission-attachment-reach.ts`;
  - the `GET /api/submissions` list payload.
- `tests/permissions/project-reach-guard.test.ts` and `helpers/project-reach-route-keys.ts`.
- `project-reach-reads.test.ts` and `project-reach-writes.test.ts`.
- Out-of-scope surfaces:
  - `notification/get-notifications.ts`, `task-reach.ts`, `approval-reach.ts`, `fanout.ts`;
  - `approval/index.ts` (`listMyApprovals`);
  - the `/api/ws/{projectId}` upgrade in `index.ts`;
  - `ws/broadcast-adapter.ts`.
- `packages/permissions` `reaches()`, and how `rbac.md` step 6 handles customers.

## Commands and results

| Command | Result |
| --- | --- |
| `CI=true vitest --config vitest.integration.config.ts project-reach-reads project-reach-writes intake- attachment view` | 17 files, 180 tests passed (`742-security-opus-integration.log`) |
| `vitest --config vitest.permissions.config.ts` (`test:permissions`, uncached) | 16 files, 107 tests passed (`742-security-opus-permissions.log`) |
| `TURBO_FORCE=true pnpm check:route-policy` | exit 0, 0 cached, 107 permission tests passed (`742-security-opus-route-policy.log`) |
| `gitleaks git --log-opts=2e03855e..HEAD --redact` | 5 commits, no leaks (`742-security-opus-gitleaks.log`) |
| Own probe `742-security-opus-probe.test.ts` (5 tests) | all passed; output in `742-security-opus-probe-output.txt` |
| 10 mutations (`742-security-opus-mutations.log`) | 10/10 killed |

### Mutations (each reverted with `git checkout` before the next)

| # | Mutation | Result |
| --- | --- | --- |
| M1 | Search: drop the reach clause from `workspaceFilter` | killed (10 failed) |
| M2 | Search: an empty reach set fails open (`sql\`false\`` becomes `undefined`) | killed (5 failed) |
| M3 | Labels: drop the task-bound reach filter | killed (8 failed) |
| M4 | `fromSavedView()`: drop `savedViewScopeReach` | killed (11 failed) |
| M5 | Views list: drop `projectScopeInReach` | killed (6 failed) |
| M6 | Accept: ignore `canReachProject` | killed (3 failed) |
| M7 | `reachableLinkedWorkItemId` always returns the id | killed (3 failed) |
| M8 | Duplicate suggestions: drop the reach `IN` | killed (2 failed) |
| M9 | `reachableProjectIds` returns every live project | killed (26 failed) |
| M10 | View create: skip the reach check | killed (2 failed) |

## Answers to the security questions

### 1. Completeness

Every changed workspace-level read and write is reach-filtered in SQL, or decided before any write. The guard's candidate set is every workspace-scope GET in the real registry, and each one is either declared or exempted with a reason.

I checked these exemptions:

- **`GET /api/submissions`:** the payload carries no `workItemId`. I verified the handler mapping. The implementer's earlier note claiming an opaque id was stale.
- **`GET /api/request-types`:** exposes a default project id only.

Outside the guard (self-scope, delegated):

- **`GET /api/notification`.** Probe P5: rows of type `task` for an unreachable task are omitted. Rows of type `comment` are returned with no current-reach check at all, even for a nonexistent comment. A mention row's body names the work item key. This goes against `notifications.md` § Permissions ("Inbox list ... apply current reach filtering"). It needs earlier legitimate reach: the fan-out resolver checks reach at creation, so the leak is staleness after reach is revoked. It is pre-existing and untouched by this PR, and #633 already tracks it ("extend inbox current-reach checks beyond legacy task rows"). **Follow-up (#633), non-blocking.**
- **`GET /api/me/approvals`.** No reach filter, by design. `approvals.md` line 192 says a named approver who loses reach keeps seeing the pending approval, flagged `approverReachLost`. This is not a defect. **No action.**
- **`/api/ws/{projectId}`.** At upgrade and re-authorisation it checks workspace reach only (`reachableWorkspacePredicate`), not project reach. A same-workspace member without project reach can subscribe. The legacy project broadcast carries only `type`, `projectId` and task ids, which are invalidation signals with no content. That is a low-grade activity and id signal. It is pre-existing. #632 covers revocation, not project reach at upgrade. **Follow-up: file a new issue, with the details kept in a private record (public repo). Non-blocking.**
- **Webhooks.** Configured by admins under `webhook:manage`, and outside this route family (#337, #47). **Follow-up, non-blocking.**

### 2. Oracles

Out-of-reach answers match missing ones byte for byte:

- **Saved view by id:** all six routes, for both API key and session (probe P3, plus the existing session table). Status and body identical. No writes, audit rows or pending actions are created (existing test).
- **View create:** 400 with an identical body for both session (existing test) and API key (probe P4).
- **Accept:** 422 with an identical message. The reach check sits in the same predicate as a missing or foreign project, before the type and version checks, so the error ordering gives nothing away. Both cases leave the claim committed (#743), so the claim state does not separate them either.
- **Duplicate link:** 404.
- **Search:** `totalCount` is `results.length` after SQL filtering. A probe naming a hidden `projectId` returns `{"results":[],"totalCount":0}`.
- **Project list:** with `includeArchived=true` on an archived hidden project, it returns `[]`.

Customers are refused by capability on these staff routes. Tests drive the decision source directly, and it limits a customer to their organisation's projects.

Side observation, outside this PR: a private, workspace-scoped view of another user answers 404 on GET but 403 to an API key on PATCH and DELETE. A workspace admin's session PATCH returns 200, which the edit policy allows (`workspace:manage_settings`). This is a small existence signal on cuid ids, not project data. Non-blocking.

### 3. SQL filter correctness

- **Construction:** everything goes through drizzle `inArray`/`eq` parameters plus a literal `sql\`false\``. Nothing is interpolated.
- **Empty sets:** each route has explicit handling:
  - labels: definitions only;
  - projects: an early `[]`;
  - search: `false`;
  - views: `scope <> 'project'`;
  - duplicates: an early `[]`.
- **`sees_all`:** scoped to the workspace that granted it.
- **Instance admin:** sees every project, label and search hit with no membership (probe P1).
- **Customers:** limited to `project.organisation_id`, as `rbac.md` step 6 requires.
- **One inconsistency (pre-existing, non-blocking):** single-row lookups in `workspace-access-middleware.ts` still pass `workspace.organisation_id`, which is always the internal organisation. So single-row reach is stricter for customers than list reach. It fails closed and leaks nothing.
- **Scale:** a single-workspace IN list is bounded by project quotas (default 200 per organisation). Cross-workspace search with no `workspaceId` grows with membership. That is acceptable, and noted.

### 4. The guard

It proves a route declares reach, not that the route uses it. Reviewer B demonstrated that bypass. The backstop is adequate for this PR:

- the behavioural tables fail on every mutation I made to the use sites (10/10 killed);
- `listReachOf()` throws 500 when the middleware is missing, so the route fails closed;
- the route-key tables are checked against the guard's sets.

The residual is a new route that declares reach but never applies it. It would pass the guard and need a behavioural row. **Non-blocking (Reviewer B's N8).**

### 5. Mutations

10 performed, all killed (see above).

### 6. Runs

All green (see above).

## Findings

**Blocking:** none.

**Non-blocking:**

| # | Finding | Status |
| --- | --- | --- |
| N1 | Inbox `comment`-type rows are not filtered by current reach | Pre-existing; #633 |
| N2 | `/api/ws/{projectId}` checks workspace reach only | Pre-existing; low content; file a private-detail follow-up |
| N3 | Single-row customer reach uses the workspace's organisation while lists use the project's | Pre-existing; fails closed |
| N4 | The guard proves declaration, not use | Covered by behavioural tables; same as Reviewer B's N8 |
| N5 | Private-view 403/404 asymmetry for API-key PATCH/DELETE | Pre-existing; outside project reach |
| N6 | Accept leaves a stuck claim on an unreachable destination | #743 |

## Residual risk / not checked

- I did not run the full integration suite, only the reach, intake, attachment and view files plus the probes.
- I did not boot the container image.
- I did not open a real WebSocket.
- I did not test webhooks at runtime.
- I did not exercise performance at large project counts.
- Docs drift, if any remains, was not re-audited.

**Verdict:** CLEAR
<!-- END REPORT (sha256 10597158aeb0374b95cf695f22f7cac08cd5e1520186a29862d44d9fcaf47826) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/742-691c-security-rebind-opus.md; Claude Opus 5.5; sha256 fe2e3940098cb29ffdd3c7bc794ebe1e33117a217ff850442981826f8595436d) -->
# PR #742 exact-head security rebind (Claude Opus 5.5)

**Reviewed head:** 691c1a9e0be742fa3702416e9df1e4ce7df08c72
**Prior CLEAR head:** 8e4ddd485f15533f6ddcdf8051cbf01a140c7f96 (`742-security-opus.md`)
**Main:** 16234794f54df11891b17f0132f0107e8848fff0. `git ls-remote origin refs/heads/main` confirms main is still there.
**Model:** Claude Opus 5.5 (claude-opus-5-5), the same independent context as the prior review. Not the author.

## Structural checks

| Check | Result |
| --- | --- |
| PR head per `gh pr view 742` | 691c1a9e0be742fa3702416e9df1e4ce7df08c72 |
| Parents of the head | 8e4ddd48... and 16234794... (a clean two-parent merge) |
| `git merge-tree --write-tree 8e4ddd48 16234794` | tree e177974bab7f5033452b2285798213c833eba611 |
| Head tree | e177974bab7f5033452b2285798213c833eba611 (equal: no manual resolution, no extra content) |
| `git diff --name-only 8e4ddd48 691c1a9e` compared with `git diff --name-only 2e03855e 16234794` | identical: 39 files, the #719 and #735 sets |

## Interaction with #742's guards

- **#719 `GET/PATCH /api/me/settings`.** Policy scope `self` (`authenticated + self`, `exempt: no_person_parameter`). These routes are outside the guard's two candidate families:
  - workspace-scope GETs;
  - staff `/api/submissions` routes.

  The PATCH confirms reach for every project a layout key names. The GET returns only the caller's own stored rows. Non-blocking note: those rows can still name a project id the caller has since lost reach to. It is their own data and only an opaque id.
- **#735 unassign route.** The middleware is unchanged: `requireWorkItemReach("key", { deferApiKeyCapability: true })`. It carries project reach, and the work-item reach guard passes.

## Runs on the merged tree (scratch worktree at 691c1a9e, removed afterwards)

| Command | Result |
| --- | --- |
| `vitest --config vitest.permissions.config.ts` (`test:permissions`), after dependency packages were built | 16 files, 107 tests passed (`742-691c-rebind-permissions.log`). `project-reach-guard` (12 tests) and `work-item-reach-guard` (7) are green. |
| `TURBO_FORCE=true pnpm check:route-policy` | exit 0, 0 cached; 16 files, 107 tests (`742-691c-rebind-route-policy.log`) |

The first direct permissions run failed in 5 files only because `@taskdesk/email` was not yet built in the fresh worktree (`742-691c-rebind-permissions-prebuild.log`). The same suite passed once the route-policy gate had built the packages. This is an environment failure, not a code one.

No integration suite was re-run, and no Postgres container was created for this rebind. The merge content outside #742's own files is exactly main's.

## Findings

Blocking: none. Non-blocking: the `/api/me/settings` GET note above. Prior findings N1 to N6 are unchanged.

**Verdict:** CLEAR
<!-- END REPORT (sha256 fe2e3940098cb29ffdd3c7bc794ebe1e33117a217ff850442981826f8595436d) -->
