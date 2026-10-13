# PR #710 security review record: project states, position sort, transition state names and strict capability flags

PR #710 is the first of four successors that re-author historical PR #512 onto current `main`. It adds:
- `GET /api/projects/{projectId}/states`: project reach first, then strict `project:read`; returns active states in position order.
- `sort=position` on the work-item list, with an id tie-break and a validated numeric(20,10) cursor.
- `toStateName` on transition offers.
- The `transitionTasks`, `rankTasks` and `manageProjectSettings` flags in `/api/capabilities`, computed with strict canonical checks, never the legacy map.
- Spec updates in `work-items.md`, `views.md`, `api-design.md`, `workflows.md` and `rbac.md`.

It is security-scope because it adds a policy-registry route, changes capabilities and policy files, and changes list SQL.

Authorship: a Claude Sonnet 5.5 lane implemented it. The conductor (Claude Opus 5.5) made the merges of `main` and the wording commit `cdc121ab`. The reviewers below are fresh, independent contexts that did not author, direct or remediate the change.

## Review chain

- Ordinary review A by Claude Sonnet 5.5 (route correctness): APPROVE at `224cc555`. Five behaviour mutations each fail a test.
- Ordinary review B by Claude Sonnet 5.5 (unit accounting, consumers, rbac fit, docs): APPROVE at `224cc555`. A delta APPROVE at `cdc121ab` verified every recommended doc edit against the code.
- Security review by Claude Opus 5.5: CLEAR at `224cc555`.
  - Probes: the states route across tenants and roles; about 35 hostile cursors, all returning 400; cross-workspace cursor replay; `toStateName` scope; flag strictness.
  - It also found F1, a separate pre-existing work-item write-route project-reach defect, which is owned by a separate fix.
- Security rebind by the same context: BLOCK at `a51f4910`. The new customer test framed `rankTasks: true` as the intended contract.
- Light security rebind: CLEAR at `cdc121ab`. The test is reworded to pin today's value; the assertions are unchanged.
- Light security rebind by the same context: CLEAR at `5061424a`. A test-only commit derives the all-false capability-map check from the schema. Three mutations each fail 3 of 13.
- Full security rebind by the same context: CLEAR at `69c3e903`. The commit merges `main` `f0964fd5` (#705), whose capability conflicts were resolved by hand. Each hunk is a pure union, the `Promise.all` order is mutation-checked, and the registry, matrix and runtime agree for all four new items.
- Light security rebind by the same context: CLEAR at `e913694f`. It is a clean merge of `main` `9a8e84cf` (#688, web only). The tree equals `git merge-tree`, and nothing under `apps/api` or the API test and contract paths changed.

**Reviewed head:** `224cc555aa30bfcecbcb4a2439c3703ba1dd637f`
**Reviewed head:** `a51f49107d7d870e6ae73e67d5afb53b90ab0875`
**Reviewed head:** `cdc121abf2790cd8324cd0101ad4b6d016acaa3a`
**Reviewed head:** `5061424a1087d54d6c2061dd3f06fc459bea1913`
**Reviewed head:** `69c3e903ca91c7682227034adb0f367a46172a0a`
**Reviewed head:** `e913694fefddf4d6b1bc6e2f462dce1e5e327ae0`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `710-ordinary-a-sonnet.md` | Ordinary review A (53344c8f..224cc555) | Claude Sonnet 5.5 | `224cc555` | APPROVE | `5e342b837fe2ae5a74d331eb56f71071bd8cabae918b879a4419c35e11f340a8` |
| 2 | `710-ordinary-b-sonnet.md` | Ordinary review B (53344c8f..224cc555) | Claude Sonnet 5.5 | `224cc555` | APPROVE | `b946f33d54c03e23a66e917b79f50d39f51752c87ef698f6be46a2b839e8d0cf` |
| 3 | `710-security-opus.md` | Security review (53344c8f..224cc555) | Claude Opus 5.5 | `224cc555` | CLEAR | `a23aef252ade2d127287aadb047c2aca3bae7a1d6b5a21ccc426fbdf7419ca5e` |
| 4 | `710-rebind-security-opus.md` | Security rebind (224cc555..a51f4910) | Claude Opus 5.5 | `a51f4910` | BLOCK | `d5cdfb8776378f2538327c15f3db3a0d6286183147801701729299843ab82008` |
| 5 | `710-cdc1-security-rebind-opus.md` | Security rebind (a51f4910..cdc121ab) | Claude Opus 5.5 | `cdc121ab` | CLEAR | `b38eff4c57c285bb77b5db1e20de3c9ac644102dab8cba6bd1fa5ce48f23460b` |
| 6 | `710-cdc1-ordinary-b-sonnet.md` | Ordinary delta review B (224cc555..cdc121ab) | Claude Sonnet 5.5 | `cdc121ab` | APPROVE | `b79c43d141d80d2efd4b2fcef0c1cbed7cfd5a05c66f52f2c662ec85a389f1e8` |
| 7 | `../2026-10-14/710-5061-security-rebind-opus.md` | Security rebind (cdc121ab..5061424a) | Claude Opus 5.5 | `5061424a` | CLEAR | `14806183cf855ba53682b6d5ae414917dfd84fd5d91e1e824664a6f64e359285` |
| 8 | `../2026-10-14/710-69c3-security-rebind-opus.md` | Security rebind (5061424a..69c3e903) | Claude Opus 5.5 | `69c3e903` | CLEAR | `20f02c392752208544ae8b8eb1e0c46b40c3a85d6fc5de4cb662f2badf175ccc` |
| 9 | `../2026-10-14/710-e913-security-rebind-opus.md` | Security rebind (69c3e903..e913694f) | Claude Opus 5.5 | `e913694f` | CLEAR | `3bc9154d93ec7ff691298e4514e2f8e129ab9bf8ebd84684cd90ac7d8975adc9` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/710-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 5e342b837fe2ae5a74d331eb56f71071bd8cabae918b879a4419c35e11f340a8) -->
# PR #710 ordinary review A (Claude Sonnet 5.5)

Model: Claude Sonnet 5.5 (fresh context, did not author or direct the change).
**Reviewed head:** 224cc555aa30bfcecbcb4a2439c3703ba1dd637f
Base: origin/main 53344c8f (diff taken against it)
Scratch copy: detached worktree at the head, removed afterwards. No Docker containers created or removed. No push, comment or merge.

## Files examined
apps/api/src/project/{index,policy,response}.ts, project/controllers/list-project-states.ts; apps/api/src/index.ts (mount); apps/api/src/work-item/list-query.ts, response.ts, workflow-transition-context.ts, controllers/list-work-item-transitions.ts; apps/api/src/capabilities/{controllers/get-capabilities,policy,response}.ts; utils/require-workspace-capability.ts (strict path); tests: project.test.ts, capabilities-scope.test.ts, work-item-list-sort-pagination.test.ts, work-item-transition.test.ts; matrix.fixture.json and openapi.json diffs; impl notes; rbac.md role table; work-items.md WI-9/11/12; views.md VW-10.

## Commands and results
- pnpm install --frozen-lockfile: ok.
- `CI=true vitest run --config vitest.integration.config.ts --no-file-parallelism` on the 4 touched integration files: 4 files, 92 tests passed.
- check:openapi: ok (281 operations). check:route-policy: ok (turbo 5/5, permissions 14 files / 88 tests inside). check:policy: ok. test:permissions: 14 files / 88 tests passed.
- Mutations (each reverted by git checkout; scratch tree clean):
  1. position tie-break `id desc`: 3 tests fail (order, cursor walk, project scope).
  2. rankTasks computed from manage_settings: 2 failures (lead, member).
  3. drop `archivedAt` filter in states: 1 failure.
  4. toStateName replaced by a constant: 1 failure (transition offers).
  5. position cursor regex disabled: 1 failure (malformed cursor 400s).
  Note: swapping rankTasks for transition alone is an equivalent mutant (both are held by the same roles), so no test can or should catch it.

## Findings
1. States route: correct. `fromProject(requireProjectReach)` (404) then `requireWorkspaceCapability("project:read")` (strict, 403). Policy registered in project/policy.ts, matrix row added, route-policy gate green. Controller 404s a soft-deleted project, filters `archived_at is null` on the concrete state, orders by position then id, and joins template for name/group, so a state whose template is archived is still returned while the concrete state is active (as the description says). It returns id, template id, name, group, position, isDefault only. That is workflow structure already visible to anyone who can read the project's board. No new disclosure.
2. sort=position: correct. Cursor regex `^-?(0|[1-9]\d{0,9})(\.\d{1,10})?$` matches the numeric(20,10) range (10 integer digits, 10 decimals), rejects null, number type, exponent, NaN, leading zeros, whitespace. Value is a bound parameter (no interpolation), compared against numeric so no cast risk; no SQL injection path. Tie-break `id asc` in both directions, and the cursor condition uses the explicit OR expansion with `id > cursor.id` (list-query.ts:~356), so equal positions paginate gaplessly. The DB also has a NaN check constraint. Tests cover asc/desc, ties, walk both directions, 10 malformed cursors, cross-sort replay.
3. toStateName: correct. Names come from `ctx.templateNames`, built from state_template rows filtered by the item's workspaceId, keyed by the transition's toStateTemplateId. The transition list is already the workflow's own edges, so no cross-workflow state leaks. Fallback to the template id is non-blocking cosmetic.
4. Flags: strict via assertCallerHasCapability (API-key scope intersected, malformed or duplicate membership fail closed). Values match rbac.md: owner/admin/manager all true; lead and member transition+rank true, manage_settings false; viewer all false. CAPABILITY_CHECKS legacy map is not in the diff (unchanged). Test expectations are hand-written from rbac.md.
5. Tests are non-vacuous (mutations above).
6. Scope: 18 files, all under apps/api and tests/; no web code, no comment/composer code.

### Non-blocking
- N1 (apps/api/src/capabilities/controllers/get-capabilities.ts, new rankTasks check): the built-in `customer` role holds `work_item:rank` in packages/permissions roles.ts (rbac.md role table line 408), so a customer-role workspace member would receive `rankTasks: true`. rbac.md restricts that to their own backlog, and the flag has no customer test row. The implementer noted it. Suggest a one-line caveat in the web follow-up or a test pinning the intended value.
- N2: no spec text added for `GET /api/projects/{projectId}/states` (impl notes say the contract lives in the decision log 2026-10-03). Worth a views.md/work-items.md route-table row in a docs follow-up.
- N3: the position-cursor "unknown sort already 400" caveat in the impl notes is accurate; the regex is covered by mutation 5 above.

## Residual risk
Web consumers not exercised (out of scope). I did not run the full integration suite, only the four touched files plus gates. Security-scope (capabilities, policy) still requires the Sol review at this exact head. Cursor behaviour under concurrent rank rewrites was reasoned, not tested.

## Verdict
APPROVE
<!-- END REPORT (sha256 5e342b837fe2ae5a74d331eb56f71071bd8cabae918b879a4419c35e11f340a8) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/710-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 b946f33d54c03e23a66e917b79f50d39f51752c87ef698f6be46a2b839e8d0cf) -->
# PR #710 ordinary review B (alignment, completeness, downstream fit)

- Model: Claude Sonnet 5.5, fresh independent context (reviewer B; did not author or direct the PR)
- **Reviewed head:** 224cc555aa30bfcecbcb4a2439c3703ba1dd637f
- Base: origin/main 53344c8fb9ab815e9229ce39b5d4f932996d0e60
- Scratch worktree /Users/heinthura/.codex/worktrees/review-710-b (detached at the head), removed after the run. No edits, pushes, comments or merges.

## Files examined
apps/api/src: capabilities/{controllers/get-capabilities.ts,policy.ts,response.ts}, project/{index.ts,policy.ts,response.ts,controllers/list-project-states.ts}, work-item/{list-query.ts,response.ts,workflow-transition-context.ts,controllers/list-work-item-transitions.ts}, index.ts; tests/api-integration/{capabilities-scope,project,work-item-list-sort-pagination,work-item-transition}.test.ts (diffs); tests/permissions/matrix.fixture.json and tests/api-contract/openapi.json (generated, gate-checked). #512 head (refs/remotes/pr/512) files: list-project-states.ts, response.ts, list-query.ts, get-project-states.ts, use-get-project-states.ts, use-get-board-work-items.ts, get-work-item-transitions.ts, work-item-board.tsx, use-workspace-permission.ts. #705 head (FETCH_HEAD of pull/705) capabilities diffs. Docs: rbac.md (role table lines 400-408), work-items.md, views.md, workflows.md, api-design.md. Delta report /Users/heinthura/.codex/taskdesk-evidence/2026-10-13/delta-609-512-sonnet.md lines 105-200.

## Commands run (in the scratch worktree)
| Command | Result |
|---|---|
| pnpm install --frozen-lockfile | ok |
| pnpm --filter @taskdesk/api test | 118 files, 840 tests passed |
| pnpm check:openapi | "matches the API (281 operations)", exit 0 |
| pnpm check:route-policy | 5 of 5 turbo tasks successful (it runs the permissions suite), exit 0 |
| test:permissions (via the route-policy turbo run) | 14 files, 88 tests passed |
| pnpm typecheck | 9 of 9 tasks successful (cached) |
| git merge-tree HEAD with #705 head | conflicts, see below |
| Not run: DB integration suites (project, capabilities-scope, sort-pagination, transition). Relied on CI for them. | |

## Unit table (delta plan, PR 1 "API and contract batch")
| Plan unit | Status | Location |
|---|---|---|
| GET /api/projects/{projectId}/states | Present | project/controllers/list-project-states.ts; project/index.ts (route listProjectStates, router `projectStates`); mounted in apps/api/src/index.ts (`/projects`, added to AppType and the route list) |
| projectStateSchema | Present, identical to #512 | project/response.ts |
| Policy and policy-registry for /states | Present | project/policy.ts (project:read, scope project, reach required); registry picks it up via the project policies (route-policy gate green) |
| sort=position plus cursor validation | Present (list endpoint only) | work-item/list-query.ts (enum, ORDER BY, cursor decode regex, primaryValueForCursor); schema.ts consumes the enum |
| toStateName on transition offers | Present | list-work-item-transitions.ts, response.ts (workItemTransitionOfferSchema), workflow-transition-context.ts (`templateNames`) |
| Capability flags transitionTasks, rankTasks, manageProjectSettings | Present, strict canonical | capabilities/controllers/get-capabilities.ts, response.ts, policy.ts comment |
| createInternalComments | Not in PR, correct: already on main (optional in response.ts) | n/a |
| Tests: project states, capabilities-scope, position sort, transition, matrix, OpenAPI | Present | tests/api-integration/{project,capabilities-scope,work-item-list-sort-pagination,work-item-transition}.test.ts; matrix.fixture.json; openapi.json |
| Hierarchy tree pagination, calendar UI, CA-2 (defaultCommentVisibility on PUT project), board/rank/bulk web | Correctly absent (PRs 2-4 or separate slices) | none |
| Slip-in from PRs 2-4 | None found. The diff is API-only plus tests and generated files (18 files). | |

Delta improvements over #512: a soft-deleted or other-workspace project is 404 (not an empty list), and reach is required via workspaceAccess.fromProject.

## Contract and consumer fit
- States response is byte-identical to the shape #512's web consumed (fetcher `client.projects[":projectId"].states.$get`, hook key ["projects", id, "states"], board `ProjectState` type). Ordering is position then id. PR 3 can reuse it unchanged. Note state.position is an integer while work_item.position is a numeric string; #512's board already handles that (comparePosition on strings).
- Position cursor: board used getWorkItems(projectId, "position", "asc", {cursor, limit 200}) and hasMore/nextCursor. Server supports it; decode regex bounds numeric(20,10).
- toStateName: #512 renders offer.toStateName in the transition picker; matches. Capability helpers #512 used (canTransitionTasks, canRankTasks, canManageProjectSettings) map 1:1 to the response keys. Main's use-workspace-permission.ts has `CapabilityMap = Record<keyof EMPTY_CAPABILITIES, boolean>` and does not enumerate the new keys, so PR 2 must add them to EMPTY_CAPABILITIES (or the optional type) and add the helpers. No web typecheck breakage from this PR (extra response keys are harmless).
- No naming or shape mismatch found.

## Capability flags versus rbac.md (role table, lines 400-408)
Expected per rbac.md and as asserted by the PR's hand-written STRICT_FLAGS test (not derived from BUILT_IN_ROLES):
| Role | transitionTasks | rankTasks | manageProjectSettings | rbac.md basis |
|---|---|---|---|---|
| owner | true | true | true | every capability |
| admin | true | true | true | owner minus delete/transfer |
| manager | true | true | true | project:manage_settings, all work_item:* |
| lead | true | true | false | has transition and rank, no project:manage_settings |
| member | true | true | false | has transition and rank, no manage_settings |
| viewer | false | false | false | read-only |
| customer | false | true (per rbac.md: customer holds work_item:rank, not transition) | false | line 408 |
The PR tests owner, admin, manager, lead, member and viewer plus a viewer with forged legacy statements. The customer row is untested (see finding 2). All six tested rows match rbac.md.

## Conflict with #705
`git merge-tree` shows content conflicts in: apps/api/src/capabilities/controllers/get-capabilities.ts, capabilities/response.ts, project/policy.ts, tests/api-contract/openapi.json and tests/api-integration/capabilities-scope.test.ts (matrix.fixture.json and index files merge or regenerate). The conflicts are mechanical: both sides append one more flag to the same type, Promise.all list, return object, zod schema and test file; resolution is to keep both, and widen `hasCanonicalCapability`'s union to include "project:create" plus the three #710 capabilities. project/policy.ts: both add route entries near the same location, keep both. openapi.json and matrix.fixture.json must be regenerated after the merge, not hand-merged. use-workspace-permission.ts is touched only by #705 (no conflict now; PR 2 will touch the same file and should follow #705's pattern). Whichever lands second must rerun check:openapi and test:permissions.

## Docs (no docs are changed by the PR)
Recommended exact edits, all non-blocking and fit for this PR or the follow-up docs batch:
1. docs/03-features/work-items.md API block (around line 190-206): add `GET /api/projects/{projectId}/states   project:read   — active concrete states, including empty board columns, in project order (VW-8)` and `GET /api/work-items/{key}/transitions   work_item:read   — legal offers, each carrying toStateName`; add after the `/rank` line a note that `sort=position` is supported on the list endpoint.
2. docs/03-features/views.md route table (line ~218-228): add rows for `GET /api/projects/{projectId}/states` (project:read, VW-8) and `GET /api/work-items/{key}/transitions` (work_item:read, VW-9); mention that the transition and rank controls read `transitionTasks`/`rankTasks` from `/api/capabilities`.
3. docs/01-architecture/api-design.md: add `GET /api/projects/{projectId}/states` to the route list near line 610; document `toStateName` and the `sort=position` list sort field (the structured search at line 734 intentionally keeps key/title/priority/dueDate; the example at line 647 lists `created_at|due_date`, which is stale versus the shipped camelCase fields).
4. docs/03-features/workflows.md line 228: add that each offer carries `toStateName` so the UI never joins template names itself.
5. docs/01-architecture/rbac.md: no capability-flag list exists; add one short sentence (route policies section) that `/api/capabilities` flags `transitionTasks`, `rankTasks`, `manageProjectSettings` are strict canonical checks for `work_item:transition`, `work_item:rank`, `project:manage_settings`.

## Findings
1. Non-blocking, list-query.ts:24-31 and search/query.ts:165: `sort=position` exists only on the list endpoint; structured search still rejects it. The delta plan said "List/search". Board (#512) uses the list endpoint, so no consumer needs it. Confirm that is intended, record it in the PR body or api-design.md.
2. Non-blocking, get-capabilities.ts (rankTasks): rbac.md grants `work_item:rank` to `customer`, so `rankTasks` would be true for a customer if that role can reach /api/capabilities. Web board is agent-side and customer is portal-only, so low impact, but the customer row is untested; add one test or a comment stating the expected value.
3. Non-blocking, list-work-item-transitions.ts:155-157: `toStateName` falls back to the template id if the name is missing. The FK makes the fallback unreachable in practice; if kept, a user would see an id as a label. Prefer asserting presence or a clear label.
4. Non-blocking, docs: the five doc edits above are missing from the PR.
5. Non-blocking, process: expected merge conflicts with #705; whichever merges second needs a regeneration of openapi.json and the matrix fixture.
No blocking findings.

## Residual risk
- DB integration suites were not run locally; only CI evidence covers the SQL position cursor behaviour (parameter typing of the string cursor against numeric(20,10)) and the 404/reach behaviour of /states.
- Web typecheck was cached; I did not exercise the Hono client type for `client.projects[":projectId"].states` (AppType includes projectStatesApi, and #512 used the same call shape).
- Security tier (GPT-6 Sol) is separate and outside this review; this PR touches capabilities and policy files.

## Verdict
APPROVE
<!-- END REPORT (sha256 b946f33d54c03e23a66e917b79f50d39f51752c87ef698f6be46a2b839e8d0cf) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/710-security-opus.md; Claude Opus 5.5; sha256 a23aef252ade2d127287aadb047c2aca3bae7a1d6b5a21ccc426fbdf7419ca5e) -->
# PR #710 security review (states route, position sort, transition names, strict flags)

**Model:** Claude Opus 5.5. Fresh, independent context. I did not author, direct or remediate this change.
**Role:** independent security review requested by the orchestrator. It does not replace the GPT-6 Sol gate (CLAUDE.md).

**Reviewed head:** 224cc555aa30bfcecbcb4a2439c3703ba1dd637f
**Merge base:** 53344c8fb9ab815e9229ce39b5d4f932996d0e60 (= origin/main). `git ls-remote` at review time gave refs/heads/main = 53344c8f and refs/pull/710/head = 224cc555. Diff reviewed as `git diff 53344c8f 224cc555`.
**Scratch copy:** detached worktree /Users/heinthura/.codex/worktrees/review-710-sec at the head. Removed afterwards. No push, comment or merge. The author worktree was not modified.

## Surfaces examined

- `apps/api/src/project/{index,policy,response}.ts`, `project/controllers/list-project-states.ts`, and the `/projects` mount in `apps/api/src/index.ts`.
- `apps/api/src/utils/workspace-access-middleware.ts` (`fromProject`, `requireProjectReach`, the reachable-workspace predicate), `utils/has-project-reach.ts` (`projectReadDecision`), `utils/require-workspace-capability.ts` (strict path, API-key intersection, genuine-row check).
- The host routing guard and portal allow-list in `index.ts`: the new route has no portal marker, so the portal host denies it.
- `apps/api/src/work-item/list-query.ts`: the position branch of decode, order and cursor condition. Also `controllers/list-work-items.ts` (the scope filters are AND-ed with the parenthesised cursor clause).
- `work-item/workflow-transition-context.ts`, `controllers/list-work-item-transitions.ts`, and `response.ts`.
- `capabilities/controllers/get-capabilities.ts`, `policy.ts`, `response.ts`, and the `capabilities/index.ts` middleware (`requireSessionOnly` + `fromQuery`).
- The rank route (`work-item/index.ts:555-590`, `controllers/rank-work-item.ts`) and `require-work-item-reach.ts`.
- `packages/permissions/src/roles.ts` (customer capabilities). `tests/permissions/matrix.fixture.json` rows for the states, rank and PATCH routes.
- Prior evidence: 710-ordinary-a-sonnet.md, 710-ordinary-b-sonnet.md and wi-api-successor-impl-sonnet.md.

## Tests and probes run (at 224cc555)

- `pnpm install --frozen-lockfile` and `turbo build --filter=@taskdesk/api^...`: ok.
- Touched integration files, `CI=true` and serialized (Testcontainers Postgres 18): project, capabilities-scope, work-item-list-sort-pagination and work-item-transition. **4 files / 92 tests passed.**
- `pnpm test:permissions`: **14 files / 88 tests passed.**
- `pnpm check:openapi`: ok (281 operations). `pnpm check:route-policy`: ok (5/5 tasks; permissions 14 files / 88 tests inside).
- Probe suite `710-security-opus-probes.test.ts` (saved beside this report): **5/5 passed.** Raw output is in `710-security-opus-probes-output.txt`.

### S1: `GET /api/projects/{projectId}/states`

| Caller | Status | Body |
| --- | --- | --- |
| member with project role (baseline) | 200 | states |
| admin of another workspace | 404 | `Project not found` |
| same caller, random missing id | 404 | `Project not found` (byte-identical, so no existence oracle) |
| instance admin, not a member | 403 | `Insufficient permissions` (matches matrix: instance_admin inReach 403) |
| viewer, no project role / with project role | 404 / 200 | |
| customer-role member, no project role / with project role | 404 / 403 | no state names |
| customer portal session, agent host | 401 | |
| customer portal session, portal host; agent session, portal host | 404 | host guard |
| API key `{project:[read]}` / `{task:[read]}` / null scope, owned by member | 403 / 403 / 403 | no state names |
| other-workspace admin's key `{project:[read]}` | 404 | |
| key on the portal host | 404 | |
| archived project | 200 | read-only, same as other project reads |
| soft-deleted project | 404 | |
| NUL id / 5000-char id | 400 / 404 | |

The scoped API key getting 403 is the known fail-closed divergence for `requireProjectReach` routes (integration-execution-queue.md:381). It is not new here.

### S2: position cursor (`sort=position`)

These hostile cursors all returned **400** and none returned 500:

- `NaN`, `Infinity`, `-Infinity`, `+1`, `" 1"`, `"1 "` and `"1\n"`;
- Arabic-Indic and full-width digits, `-`, `1e-5`, `1E5` and `0x10`;
- a 29-digit value and `-12345678901`;
- array, object, boolean and JSON-number (1e400 becomes null) values;
- a 65-char id, a NUL id and a numeric id;
- a position cursor with the wrong dir, and key, title and dueDate cursors;
- `[1,2]`, `null`, `"position"`, `{` and a 200 KB junk cursor;
- raw non-base64 input.

Boundary-valid values (±9999999999.9999999999, -0, 0 and -0.0000000001) returned 200 in both directions, with only project A rows. A real `nextCursor` minted in workspace B's project, replayed against project A, returned 200 with only A's rows; the cursor's id and value carry no authority. A's member using B's cursor on B's project got 404. The value is a bound parameter compared against `numeric(20,10)`, and the cursor clause is wrapped in parentheses, so the scope `AND` holds.

### S3: `/api/capabilities` flags

- The customer-role member gets 200 with `transitionTasks:false`, `rankTasks:true`, `manageProjectSettings:false`.
- Some callers get **403** "You don't have access to this workspace" before any flag is computed:
  - a `lead` backed by a non-system (custom) row;
  - role string `constructor`;
  - a caller asking about a foreign workspace.
- A customer portal session gets 401. An owner's API key gets 403 because the route is session-only. So the flags never need key intersection, and the code applies it anyway.
- The flags are booleans about the caller's own authority in a workspace they already belong to. They disclose nothing about other workspaces.

### S4/S5: rank route and the #708 class (pre-existing routes, not in this diff)

| Caller (same workspace) | `GET /work-items/{key}` | `POST /work-items/{key}/rank` |
| --- | --- | --- |
| customer-role, **no** project role | 404 | **200** (row re-ranked; key, position and version returned) |
| plain member, **no** project role | 404 | **200** |
| customer-role with project role | – | **200** |
| viewer with project role | – | 403 |
| foreign-workspace member | – | 404 |
| customer portal session (agent / portal host) | – | 401 / 404 |

A plain member with **no** project role also got **200** on `PATCH /api/work-items/{key}` with `If-Match: 1`. The title was changed, and the response returned the full work-item row, which the same caller gets 404 for on GET.

## Findings

**F1 (non-blocking for #710; pre-existing, high severity; needs a new issue now).** This is the #708 class on work-item write routes: the runtime gate is weaker than the declared policy and matrix.

- **Where:** `work-item/index.ts:567` (rank) and `:432` (PATCH) use `requireWorkItemReach()` without `requireProjectReach`. The same applies to the other bare `requireWorkItemReach()` routes at :501, :542, :601, :640, :688, :712, :802, :843 and :912; I did not probe those.
- **What it means:** reach is resolved at workspace level only. Then `requireWorkspaceCapability` checks the flat workspace role.
- **What the declared policy says:**
  - The policies (`work-item/policy.ts:117`, `:265`) declare `reach: "required"` on `work_item` scope.
  - `tests/permissions/matrix.fixture.json:5905` and `:8455` declare `outOfReach: 404 not_found` for member.
  - The matrix also declares `customer inReach: 403 forbidden` for rank.
- **What the runtime does:**
  - A same-workspace member without project reach can update and rank items in projects they cannot read.
  - The PATCH response discloses the full row.
  - A customer-role member can rank any item in the workspace.
  - The guessable `{slug}-{n}` key gives an existence answer (200 vs 404) for out-of-reach projects.
- **Why it is not blocking:** #710 does not touch these routes, and nothing it adds widens them.
- **Recommendation:** file a security issue and remediate under the normal workflow. Also add a matrix-vs-runtime test for the write routes, the out-of-reach column specifically. The same "add the structural guard" altitude as #708 applies.

**F2 (non-blocking).** For customer-role members, `rankTasks:true` (`get-capabilities.ts:71`) agrees with the current runtime of the rank route but **disagrees with the declared matrix** (customer inReach 403) and with rbac.md's "own backlog" restriction (WI-13 is not enforced; `rank-work-item.ts` says so).

- The flag grants nothing, and the server is the gate.
- When F1/WI-13 is fixed, the flag must be derived from the same predicate the fixed route uses. Otherwise the UI will advertise ranking the server refuses.
- A test row pinning the customer value would catch that drift.

**F3 (non-blocking, informational).** The states route serves archived (not deleted) projects (`list-project-states.ts:20,47` filter only `deletedAt`). This is consistent with the other project read routes, and the caller needs project reach and `project:read`.

**F4 (non-blocking, informational).** `toStateName` (`list-work-item-transitions.ts:155-157`) resolves names from `state_template` rows filtered by the item's own `workspaceId`. It labels only transitions that already passed `legalTransitions`, `filterOfferableForType` and project-state resolution, behind `requireWorkItemReach(..., {requireProjectReach:true})` + `work_item:read`.

- No name from another workspace or an unreachable workflow can appear.
- The fallback to the raw template id reveals nothing new; the id was already in the offer.

### Legacy-gate audit of the routes this PR touches

| Route | Runtime gate | Declared | Agrees? |
| --- | --- | --- | --- |
| `GET /api/projects/{projectId}/states` (new) | `fromProject(requireProjectReach)` (canonical `project:read` + reach, 404/403) and then strict `requireWorkspaceCapability("project:read")` | project:read, project scope, reach required | **Yes.** Every matrix cell probed matched, including instance_admin 403 and customer 403/404. |
| `GET /api/projects/{projectId}/work-items` (sort=position added) | `fromProject(requireProjectReach)` | work_item:read, reach required | Yes. Unchanged gate. |
| `GET /api/work-items/{key}/transitions` (`toStateName` added) | `requireWorkItemReach(requireProjectReach)` | work_item:read, reach required | Yes. Unchanged gate. |
| `GET /api/capabilities` (3 flags added) | session-only + exact membership; new flags use the strict `assertCallerHasCapability` | self, membership, sessionOnly | Yes. The new flags never read the legacy statement map. The older legacy-derived flags are unchanged (#708 scope). |

## Residual risk / not checked

- I did not probe the other bare `requireWorkItemReach()` write routes individually (see F1), or POST transition by an out-of-reach member.
- Web consumers of the new flags and `toStateName` were not exercised.
- I did not run the full integration suite, only the 4 touched files, my probes and the gates.
- I reasoned about concurrent rank rewrites during a cursor walk but did not test them.
- The positive API-key path for the states route cannot be shown (known 403 divergence).

## Verdict

**CLEAR** for PR #710 at 224cc555aa30bfcecbcb4a2439c3703ba1dd637f. The PR introduces no new grant, leak or 500 path.

F1 is a separate, pre-existing, high-severity authorization defect found during this review. It should be filed and scheduled immediately; it does not block this candidate. This review does not replace the required GPT-6 Sol review at this exact head.

**Head moved during review:** at the end of this review, `git ls-remote` gave refs/pull/710/head = 14d723ebff4cf3056a543489623ca575c8688335. Two commits were added on top: bec14c9f (docs) and 14d723eb (test: pin the customer role's strict capability flags). This CLEAR binds only to 224cc555. 14d723eb needs an exact-head rebind before any gate counts this review.

Docker: only Testcontainers containers (Postgres plus Ryuk), which exit on their own. Nothing was removed by hand. The `taskdesk-*` containers were untouched.
<!-- END REPORT (sha256 a23aef252ade2d127287aadb047c2aca3bae7a1d6b5a21ccc426fbdf7419ca5e) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/710-rebind-security-opus.md; Claude Opus 5.5; sha256 d5cdfb8776378f2538327c15f3db3a0d6286183147801701729299843ab82008) -->
# PR #710 security rebind (224cc555 to a51f4910)

**Model:** Claude Opus 5.5. Fresh, independent context. I did not author, direct or remediate this change. My previous report, 710-security-opus.md, gave CLEAR at 224cc555.
**Role:** security rebind requested by the orchestrator. It does not replace the GPT-6 Sol gate (CLAUDE.md).

**Reviewed head:** a51f49107d7d870e6ae73e67d5afb53b90ab0875
**Previous reviewed head:** 224cc555aa30bfcecbcb4a2439c3703ba1dd637f
**Main:** ee499594a90896fbb6edb61850b3f4e5001c5266

## Identity checks

- `git ls-remote origin` gave refs/heads/codex/work-items-api-successor = refs/pull/710/head = a51f4910, and refs/heads/main = ee499594. I checked at the start and again at the end. Main has not moved past ee499594.
- a51f4910 has parents 14d723eb and ee499594.
- Its tree is 4a508912c85a24231e1459392b1a0bd4f7d18838. `git merge-tree --write-tree 14d723eb ee499594` gives the **same tree**, so the merge is clean and adds nothing of its own.
- `git diff 14d723eb a51f4910` and `git diff 53344c8f ee499594` both show the same 12-file #707 e2e-redaction change set (397+/18-). None of it touches #710's surfaces.
- Delta under review: `git diff 224cc555 14d723eb`. That is 5 docs files (11+/5-) and capabilities-scope.test.ts (+35). No runtime code changed.

## Runs (scratch worktree at a51f4910, removed afterwards)

- `pnpm install --frozen-lockfile` and `turbo build --filter=@taskdesk/api^...`: ok.
- capabilities-scope.test.ts, `CI=true` and serialized: **21/21 passed.**
- `check:openapi`: ok (281 operations). `check:route-policy`: exit 0.
- Mutations of `get-capabilities.ts`, running only the new customer test. Each was reverted, and the tree was clean afterwards.
  - M1: `rankTasks` computed from `work_item:transition`. **The test fails.**
  - M2: `transitionTasks` computed from `work_item:rank`. **The test fails.**
  - M3: `manageProjectSettings` computed from `work_item:rank`. **The test fails.**
- So the test is non-vacuous. It also kills the rank/transition swap that ordinary review A called an equivalent mutant: only the customer role holds one of the two capabilities without the other.
- Docker: only the Testcontainers Postgres and Ryuk containers, which exit on their own. Nothing was removed by hand, and the `taskdesk-*` containers were untouched.

## Docs accuracy (bec14c9f)

| File | Claim | Against code |
| --- | --- | --- |
| api-design.md | Adds `GET /projects/{projectId}/states` and `GET /work-items/{key}/transitions` (with `toStateName`). List sort becomes `key\|position\|title\|priority\|dueDate`, with `dir=asc\|desc`, list route only. | Accurate. `WORK_ITEM_SORT_FIELDS` (list-query.ts:24-30) and `dir` (schema.ts:371-372) match. Search's sort allow-list (search/query.ts:165) excludes `position`, which matches "list route only". |
| work-items.md | The same three rows, with `project:read` for states and `work_item:read` for transitions. Search "does not accept" position. | Accurate. Matches the policies and search/query.ts. |
| views.md | States route: `project:read`, project reach required. Transitions: `work_item:read`. Rank row says "shown from the `rankTasks` flag". | Accurate as a description of the gates. It makes no claim about customers. |
| workflows.md | Each offer carries `toStateName`. | Accurate (list-work-item-transitions.ts:155-157). |
| rbac.md | The three flags are strict canonical checks "intersected with API-key scope", never legacy. | Accurate about the code. Minor (non-blocking): `/api/capabilities` is session-only, so the key intersection never applies in practice. Suggested wording: "...strict canonical checks for ... (the route is session-only), never derived from the legacy statement map." |

None of the docs states that a customer's `rankTasks: true` is the intended contract.

## Finding

**R1 (blocking, test text only).** The new test at `tests/api-integration/capabilities-scope.test.ts:213-219` presents the customer's `rankTasks: true` as the intended contract. It also claims a security property that does not hold today.

- **The title:** "... rankTasks true (own backlog) ..."
- **The comment:**
  - It says the "own backlog" limit "is reach at the work-item route, not part of the capability."
  - My probes at 224cc555 (710-security-opus.md, S4, finding F1) show the opposite: a customer-role member with **no** project role got 200 on `POST /api/work-items/{key}/rank`. WI-13 is not enforced (`rank-work-item.ts` says so).
  - The matrix declares `customer inReach: 403 forbidden` for that route (matrix.fixture.json:8455).
- **Why it blocks:** the F1 fix lane could read this test as the agreed contract and keep, or "fix", the wrong behaviour.
- **Suggested replacement title:** "pins the customer role's strict flags as computed today: rankTasks true, transition and settings false"
- **Suggested replacement comment:**
  ```
  // Pins TODAY's value, not the intended contract. The built-in `customer` role holds
  // `work_item:rank` (rbac.md role table) but neither `work_item:transition` nor
  // `project:manage_settings`, so the strict check reports rankTasks true. This matches
  // the rank route's current runtime, which does NOT yet enforce rbac.md's "own backlog"
  // limit (WI-13) and lets a customer-role member rank without project reach; the
  // permission matrix declares customer -> 403 on POST /api/work-items/{key}/rank.
  // When the work-item write-route reach fix (F1 of the #710 security review) lands,
  // derive this flag from the same predicate the fixed route uses and update this row.
  ```
- The assertion values can stay, because they pin the real current output. Only the framing must change.

## Residual risk

- F1, the write-route reach defect, is pre-existing and is now owned by a separate fix lane. It is not re-tested here.
- No runtime code changed since 224cc555, so the S1-S5 probes from the previous report still apply to this head's runtime surface. I did not re-run them.
- I did not re-run the full touched-file integration set, test:permissions, or the web side.

## Verdict

**BLOCK** at a51f49107d7d870e6ae73e67d5afb53b90ab0875. The only reason is R1, the test title and comment.

- Runtime, docs and merge are otherwise clean.
- A change that only rewords that test title and comment (and optionally the rbac.md sentence) can be rebound with a light pass: diff check, the capabilities-scope file, and the merge-tree check if main moves.
- This review does not replace the required GPT-6 Sol review at the exact head.
<!-- END REPORT (sha256 d5cdfb8776378f2538327c15f3db3a0d6286183147801701729299843ab82008) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/710-cdc1-security-rebind-opus.md; Claude Opus 5.5; sha256 b38eff4c57c285bb77b5db1e20de3c9ac644102dab8cba6bd1fa5ce48f23460b) -->
# PR #710 security rebind (a51f4910 to cdc121ab)

**Model:** Claude Opus 5.5. Fresh, independent context. I did not author, direct or remediate this change. My earlier reports are 710-security-opus.md (CLEAR at 224cc555) and 710-rebind-security-opus.md (BLOCK at a51f4910 on R1, test wording).
**Role:** a light security rebind requested by the orchestrator. It does not replace the GPT-6 Sol gate (CLAUDE.md).

**Reviewed head:** cdc121abf2790cd8324cd0101ad4b6d016acaa3a
**Previous reviewed head:** a51f49107d7d870e6ae73e67d5afb53b90ab0875
**Main:** ee499594a90896fbb6edb61850b3f4e5001c5266

## Identity checks

- `git ls-remote origin`, before and after the run:
  - refs/heads/codex/work-items-api-successor = refs/pull/710/head = cdc121ab.
  - refs/heads/main = ee499594, so main has not moved.
- cdc121ab has a single parent, a51f4910. It is one ordinary commit, "test(capabilities): frame the customer rankTasks row as today's value, not the contract".

## Diff check (`git diff a51f4910 cdc121ab`: 2 files, 10+/7-)

- **tests/api-integration/capabilities-scope.test.ts:**
  - The test title and comment change only. The title is now "pins the customer role's strict flags as computed today ...".
  - The comment is my suggested R1 text, with the F1 reference shortened to "the work-item write-route reach fix".
  - It now says plainly that it pins today's value, not the contract. It also says WI-13 is not enforced, that the matrix declares customer → 403, and that the row must be updated when the reach fix lands.
  - The setup, request and assertions are byte-identical. So the non-vacuity shown by mutations M1-M3 at a51f4910 still holds.
- **docs/01-architecture/rbac.md:**
  - Removes "(intersected with API-key scope)".
  - Adds "The capabilities route is session-only, so API keys never read these flags."
  - This is accurate: the route uses `requireSessionOnly()` and the policy sets `sessionOnly: true`. My earlier probe got 403 for an owner's API key.
- No runtime code, policy, matrix or OpenAPI file changed.

## Run (scratch worktree at cdc121ab, removed afterwards)

- `pnpm install --frozen-lockfile` and `turbo build --filter=@taskdesk/api^...`: ok.
- capabilities-scope.test.ts, `CI=true` and serialized: **21/21 passed.** The scratch tree was clean afterwards.
- Docker: only the Testcontainers Postgres and Ryuk containers, which exit on their own. Nothing was removed by hand, and the `taskdesk-*` containers were untouched.

## Findings

- **R1 is resolved.**
- No new findings.
- F1, the pre-existing write-route reach defect, stays with the separate fix lane. It is not part of this candidate.

## Residual risk

- The runtime surface is unchanged since 224cc555. The S1-S5 probes in 710-security-opus.md were not re-run.
- I re-ran only the capabilities-scope file. The other touched integration files, test:permissions, check:openapi and check:route-policy last ran at 224cc555/a51f4910, and nothing they cover has changed since.

## Verdict

**CLEAR** at cdc121abf2790cd8324cd0101ad4b6d016acaa3a. This review does not replace the required GPT-6 Sol review at this exact head.
<!-- END REPORT (sha256 b38eff4c57c285bb77b5db1e20de3c9ac644102dab8cba6bd1fa5ce48f23460b) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/710-cdc1-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 b79c43d141d80d2efd4b2fcef0c1cbed7cfd5a05c66f52f2c662ec85a389f1e8) -->
# PR #710 delta ordinary review B (224cc555..cdc121ab)

- Model: Claude Sonnet 5.5, fresh independent context (reviewer B)
- **Reviewed head:** cdc121abf2790cd8324cd0101ad4b6d016acaa3a
- Prior reviewed head: 224cc555aa30bfcecbcb4a2439c3703ba1dd637f (my APPROVE)
- Scratch worktree /Users/heinthura/.codex/worktrees/review-710-b2, removed afterwards. No Docker containers created by me.

## Files examined
Delta for docs/01-architecture/{api-design,rbac}.md, docs/03-features/{views,work-items,workflows}.md, tests/api-integration/capabilities-scope.test.ts. The #707 merge (e2e files, error-fix-loop.md, security review note) is out of this delta's scope; no apps/api source changed beyond what I reviewed before (apps/ diff is #707's web e2e helpers only).

## Commands run
| Command | Result |
|---|---|
| node scripts/ci/check-reviews.mjs --spec docs/03-features/{views,work-items,workflows}.md, docs/01-architecture/{rbac,api-design}.md | each: every spec named in this change has an empty review section (pass) |
| pnpm check:vocabulary | pass (111 table declarations registered) |
| pnpm check:openapi | matches the API (281 operations) |
| CI=true vitest run --config vitest.integration.config.ts ../../tests/api-integration/capabilities-scope.test.ts | 1 file, 21 tests passed |

## Doc accuracy and completeness
- api-design.md: states route and transitions route added; sort line now `key|position|title|priority|dueDate` with `dir=asc|desc`. Verified against list-query.ts (WORK_ITEM_SORT_FIELDS) and schema.ts:371-372 (`sort`, `dir` params). The old `created_at|due_date`/`order` wording was wrong and is now fixed.
- work-items.md: sort list, states route (project:read), transitions route (work_item:read, toStateName), and "structured search does not accept it" all match code (search/query.ts:165 allows key/title/priority/dueDate only).
- views.md: states and transitions rows match the route policies; flag mentions (`transitionTasks`, `rankTasks`) match the capabilities response.
- workflows.md: toStateName sentence matches list-work-item-transitions.ts.
- rbac.md: the flags are strict canonical checks (get-capabilities.ts), and "capabilities route is session-only" matches capabilities/policy.ts `sessionOnly: true`.
- All five of my recommended edits are applied. Nothing claims beyond the code.

## Test non-vacuity
The new customer row inserts a system customer role row with empty legacy permissions, so any legacy-map derivation would yield false, then asserts exact equality to {transitionTasks:false, rankTasks:true, manageProjectSettings:false}. Those values differ per field, so a flag swap, a constant true, or a constant false each fails it. It passes against real code. The title and comment now state it pins today's value, not the intended contract. The comment's claim that the matrix declares customer 403 on the rank route and that the route ignores WI-13 reach is about route behaviour outside this PR; I did not re-verify the runtime claim (matrix customer entry for POST /api/work-items/{key}/rank printed above in the run, see residual risk).

## Findings
None blocking. Non-blocking: the test comment asserts rank-route runtime behaviour (no WI-13 limit enforced) that this PR does not test; keep it accurate when the reach fix lands (the comment already says to update the row).

## Residual risk
Only capabilities-scope was run as integration; other integration suites rely on CI. Security-tier Sol review is separate.

## Verdict
APPROVE
<!-- END REPORT (sha256 b79c43d141d80d2efd4b2fcef0c1cbed7cfd5a05c66f52f2c662ec85a389f1e8) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/../2026-10-14/710-5061-security-rebind-opus.md; Claude Opus 5.5; sha256 14806183cf855ba53682b6d5ae414917dfd84fd5d91e1e824664a6f64e359285) -->
# PR #710 security rebind (cdc121ab to 5061424a)

**Model:** Claude Opus 5.5. Fresh, independent context. I did not author, direct or remediate this change. My previous CLEAR was at cdc121ab (2026-10-13/710-cdc1-security-rebind-opus.md).
**Role:** a light exact-head security rebind requested by the orchestrator. It does not replace the GPT-6 Sol gate (CLAUDE.md).

**Reviewed head:** 5061424a1087d54d6c2061dd3f06fc459bea1913
**Previous reviewed head:** cdc121abf2790cd8324cd0101ad4b6d016acaa3a
**Main:** ee499594a90896fbb6edb61850b3f4e5001c5266

## Identity checks

- `git ls-remote origin`, before and after the run:
  - refs/heads/codex/work-items-api-successor = refs/pull/710/head = 5061424a.
  - refs/heads/main = ee499594, so main has not moved.
- The chain is single-parent: 5061424a, then d1f057c3, then cdc121ab.
- `git diff --name-only cdc121ab d1f057c3` shows only `docs/07-planning/security-reviews/710-work-items-api-successor.md` (review note, +493). This is a docs-only commit; I did not audit its prose.
- `git diff d1f057c3 5061424a` shows only `tests/api-integration/multi-role-membership-remediation.test.ts` (15+/1-). No runtime, policy, matrix, OpenAPI or other test file changed.

## The change

`expectAllFalseCapabilityMap` used to assert `Object.keys(...).toHaveLength(21)` and then that all values are false. It now does three things:

1. It asserts that every required (non-optional) key of `capabilitiesResponseSchema.shape` is present.
2. It asserts that every returned key is a key of that schema.
3. It keeps the existing all-false assertion.

The schema import comes from `apps/api/src/capabilities/response.ts`, which is the same object the route's OpenAPI response uses.

## Runs (scratch worktree at 5061424a, removed afterwards; the tree was clean after each revert)

- `pnpm install --frozen-lockfile` and `turbo build --filter=@taskdesk/api^...`: ok.
- multi-role-membership-remediation.test.ts, `CI=true` and serialized: **13/13 passed.**
- Mutations of `get-capabilities.ts`. Each was reverted with `git checkout`.

| Mutation | Result | Where it fails |
| --- | --- | --- |
| M1: `rankTasks: true` forced | **3 failed** / 10 passed | the all-false assertion |
| M2: `rankTasks` dropped from the map | **3 failed** | helper line 57: required-flag presence (`arrayContaining`) |
| M3: an extra key `probeExtraKey: false` added | **3 failed** | helper line 64: key outside the schema |

The same three tests fail every time (lines 242, 262 and 445), and they are the helper's callers.

- So the helper still guards what it did: all-false, no missing flag, no stray key. It also no longer needs a hand-kept count.
- Docker: only the Testcontainers Postgres and Ryuk containers, which exit on their own. Nothing was removed by hand, and the `taskdesk-*` containers were untouched.

## Findings

**None blocking.**

**N1 (informational):** optional schema keys (`createPublicComments`, `createInternalComments`) are no longer required to be present.

- The old count of 21 implicitly pinned them.
- When they are present, they must still be false and inside the schema.
- That matches the schema's own contract, so it weakens nothing the API promises.

## Residual risk

- I did not audit the prose of the d1f057c3 review note.
- I re-ran only the changed test file, plus the mutations.
- The runtime surface is unchanged since cdc121ab, where it was CLEAR.

## Verdict

**CLEAR** at 5061424a1087d54d6c2061dd3f06fc459bea1913. This review does not replace the required GPT-6 Sol review at this exact head.
<!-- END REPORT (sha256 14806183cf855ba53682b6d5ae414917dfd84fd5d91e1e824664a6f64e359285) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/../2026-10-14/710-69c3-security-rebind-opus.md; Claude Opus 5.5; sha256 20f02c392752208544ae8b8eb1e0c46b40c3a85d6fc5de4cb662f2badf175ccc) -->
# PR #710 security rebind (5061424a to 69c3e903, conflicted merge of main f0964fd5)

**Model:** Claude Opus 5.5. Fresh, independent context. I did not author, direct or remediate this change, or resolve the merge. My previous CLEAR was at 5061424a (710-5061-security-rebind-opus.md).
**Role:** a full exact-head security rebind requested by the orchestrator. It does not replace the GPT-6 Sol gate (CLAUDE.md).

**Reviewed head:** 69c3e903ca91c7682227034adb0f367a46172a0a
**Previous reviewed head:** 5061424a1087d54d6c2061dd3f06fc459bea1913
**Main:** f0964fd5d0b63634e2d51e440713cfc1571956f1
**Merge base of the two sides:** ee499594a90896fbb6edb61850b3f4e5001c5266

## Identity checks

- `git ls-remote origin`, before and after the run:
  - refs/heads/codex/work-items-api-successor = refs/pull/710/head = 69c3e903.
  - refs/heads/main = f0964fd5, so main has not moved.
- The chain:
  - b4fff8df has parent 5061424a, and `git diff --name-only` shows only `docs/07-planning/security-reviews/710-work-items-api-successor.md`. I did not audit that prose.
  - 69c3e903 has parents b4fff8df and f0964fd5.
- `git merge-tree --write-tree 5061424a f0964fd5` reports conflicts in exactly 5 files: get-capabilities.ts, capabilities/response.ts, project/policy.ts, capabilities-scope.test.ts and openapi.json.
- `git diff <merge-tree output> 69c3e903 --name-only` lists those 5 files plus the review note from b4fff8df.
- **So every auto-merged file is byte-identical to git's own result, and hand edits exist only in the conflicted files.**

## Union check on the conflicted files

For each file, I compared the sorted set of changed lines on each side against what the merge applied:

- the main side: `ee499594..f0964fd5` against `b4fff8df..69c3e903`;
- the #710 side: `ee499594..b4fff8df` against `f0964fd5..69c3e903`.

| File | Main side applied exactly | #710 side applied exactly |
| --- | --- | --- |
| capabilities/response.ts | yes (hashes equal) | yes |
| project/policy.ts | yes | yes |
| capabilities-scope.test.ts | yes | yes |
| get-capabilities.ts | line sets differ only where both sides edited the same lines; inspected below | as left |
| openapi.json | regenerated; see below | regenerated |

- **get-capabilities.ts** (full file inspected at 69c3e903):
  - The type adds `transitionTasks`, `rankTasks`, `manageProjectSettings` (#710) and `bindProjectOrganisation` (#705).
  - The destructure order is `results, manageServiceCalendars, shareSavedViews, manageWorkspaceSettings, transitionTasks, rankTasks, manageProjectSettings, bindProjectOrganisation`.
  - The call order is `Promise.all(entries…), hasServiceCalendarManageCapability, saved_view:share, workspace:manage_settings, work_item:transition, work_item:rank, project:manage_settings, project:create`.
  - **The two orders match one to one.**
  - The return object lists the same eight fields. The `hasCanonicalCapability` union is the six capabilities.
  - #705's `bindProjectOrganisation = project:create` is unchanged from f0964fd5, and #710's three checks are unchanged from 5061424a. No semantic change to either side.
- **openapi.json:**
  - `pnpm check:openapi` reports that it matches the API (282 operations, which is 281 + #705's route).
  - Running `pnpm openapi:write` on the scratch tree produced **no diff**, so the committed file is exactly the generated one.

## Policy registry and matrix

- Registry, project/policy.ts:
  - `GET /api/projects/{projectId}/states`: `project:read`, project scope, row source, reach required.
  - `GET /api/project/organisations`: `project:create`, workspace scope, request source, reach required.
- Matrix (`tests/permissions/matrix.fixture.json`), inReach per role:

| Route | instance_admin | owner | admin | manager | lead | member | viewer | customer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| states | 403 | allow | allow | allow | allow | allow | allow | 403 |
| organisations | 403 | allow | allow | allow | 403 | 403 | 403 | 403 |

- Runtime gates:
  - The states route uses `fromProject(requireProjectReach)` and then strict `requireWorkspaceCapability("project:read")`.
  - The organisations route uses `fromQuery()` and then strict `requireWorkspaceCapability("project:create")` (project/index.ts:179-185).
  - Both agree with the matrix. My S1 probes, re-run at this head, confirm the states row.
- Flags: compiled `BUILT_IN_ROLES` (expanded) gives `project:create` to owner/admin/manager only. So `bindProjectOrganisation` agrees with the organisations route's matrix row, and the three #710 flags agree with the role table (as in my earlier reports).
- `test:permissions`: 14 files / 88 tests passed. `check:route-policy`: exit 0. So the registry, the generated matrix and route coverage are consistent.

## Runs (scratch worktree at 69c3e903, removed afterwards)

- `pnpm install --frozen-lockfile`, `turbo build --filter=@taskdesk/api^...`, and `tsc --noEmit` for apps/api: ok.
- Integration (`CI=true`, serialized), **7 files / 131 tests passed**:
  - capabilities-scope, multi-role-membership-remediation, project-organisation-binding, project, work-item-list-sort-pagination and work-item-transition;
  - **plus my original #710 probe suite (S1-S5)**, re-run unchanged at this head.
- **Promise.all order mutations.** Each swapped two adjacent call entries without touching the destructure, ran capabilities-scope + project-organisation-binding + multi-role (54 tests), then was reverted. The tree was clean afterwards.

| Swap (calls) | Result |
| --- | --- |
| transition with rank | **1 failed** (the customer row) |
| rank with project:manage_settings | **3 failed** |
| workspace:manage_settings with transition | **2 failed** |
| transition with project:create | **3 failed** |
| project:manage_settings with project:create | 54 passed: **an equivalent mutant**. Every built-in role holds both or neither (owner/admin/manager 1/1, all others 0/0), so no built-in-role test can tell them apart. |
| saved_view:share with project:create | 54 passed: **survives; a coverage gap (N2)**. `lead` holds `saved_view:share` but not `project:create`, but no test asserts both flags for `lead`. |

- I verified by inspection that the merge's order is correct, so neither surviving swap exists at 69c3e903.
- Docker: only Testcontainers Postgres and Ryuk, which exit on their own. Nothing was removed by hand, and the `taskdesk-*` containers were untouched.

## Findings

**N1 (non-blocking; a stale comment inherited from main/#705, not introduced by the merge).** The comment at `apps/api/src/project/policy.ts:87-90` (69c3e903) says the organisations route uses:

> "Same gate as the create itself: `workspaceAccess.fromQuery()` then `requireWorkspacePermission({ project: ["create"] })`"

That is wrong twice over:

- The route actually uses the strict `requireWorkspaceCapability("project:create")` (project/index.ts:185), whose own comment explains why.
- It is **not** the same gate as `POST /api/project`, which still uses the legacy `requireWorkspacePermission({ project: ["create"] })` (index.ts:149, the #708 defect that lets members create).

The comment understates the real gate, so no runtime risk follows. It does misstate the gate, though, and invites someone to "align" the route back to the legacy check.

Suggested wording:

```
// List the customer organisations a new project may serve (create-project selector).
// workspaceAccess.fromQuery() then the STRICT requireWorkspaceCapability("project:create")
// (owner/admin/manager per the matrix) -- deliberately not the legacy
// requireWorkspacePermission that POST /api/project still uses (#708). Registered ahead of
// GET /api/project/{id} in the router so "organisations" is never read as a project id.
```

It can be fixed here or in a main follow-up. The merge kept #705's text verbatim, which was correct for a union.

**N2 (non-blocking; a test coverage gap).**

- A swap of `shareSavedViews` and `bindProjectOrganisation` would go undetected.
- Suggestion: extend capabilities-scope's per-role `STRICT_FLAGS` table to assert every strict/canonical flag per role (`shareSavedViews`, `manageWorkspaceSettings`, `manageServiceCalendars`, `bindProjectOrganisation`, plus the three #710 flags), including `lead` and `customer`.
- The `project:manage_settings`/`project:create` swap is equivalent for built-in roles, so no test is needed for it.

F1, the pre-existing work-item write-route reach defect, stays with its separate fix lane.

## Residual risk

- I did not audit the review-note prose (b4fff8df).
- I did not run the full integration suite or the web suites; #705's web pieces arrive from main unchanged.
- N2's gap means future reordering in `get-capabilities.ts` is only partly protected by tests.

## Verdict

**CLEAR** at 69c3e903ca91c7682227034adb0f367a46172a0a.

- The merge is a faithful union with no semantic change to either side.
- The destructuring matches the call order.
- The registry, matrix and runtime agree for both new routes and all four new flags.
- N1 and N2 are non-blocking.
- This review does not replace the required GPT-6 Sol review at this exact head.
<!-- END REPORT (sha256 20f02c392752208544ae8b8eb1e0c46b40c3a85d6fc5de4cb662f2badf175ccc) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/../2026-10-14/710-e913-security-rebind-opus.md; Claude Opus 5.5; sha256 3bc9154d93ec7ff691298e4514e2f8e129ab9bf8ebd84684cd90ac7d8975adc9) -->
# PR #710 security rebind (69c3e903 to e913694f)

**Model:** Claude Opus 5.5. Fresh, independent context. I did not author, direct or remediate this change, or the merge. My previous CLEAR was at 69c3e903 (710-69c3-security-rebind-opus.md).
**Role:** a light exact-head security rebind requested by the orchestrator. It does not replace the GPT-6 Sol gate (CLAUDE.md).

**Reviewed head:** e913694fefddf4d6b1bc6e2f462dce1e5e327ae0
**Previous reviewed head:** 69c3e903ca91c7682227034adb0f367a46172a0a
**Main:** 9a8e84cf68fc802bac84e68bcc3051e65172b5ba
**Merge base of the two sides:** f0964fd5d0b63634e2d51e440713cfc1571956f1

## Checks

1. **Main and head.** `git ls-remote origin`:
   - refs/heads/main = 9a8e84cf, so main is still at the stated commit.
   - refs/heads/codex/work-items-api-successor = refs/pull/710/head = e913694f.
2. **Chain.**
   - 6e24eaaf has a single parent, 69c3e903. `git diff --name-only` shows only `docs/07-planning/security-reviews/710-work-items-api-successor.md`. I did not audit that prose.
   - e913694f has parents 6e24eaaf and 9a8e84cf.
3. **Merge tree.**
   - e913694f's tree is bc1155f28672e5a33c6c163b9ca0b1b416300681.
   - `git merge-tree --write-tree 6e24eaaf 9a8e84cf` gives bc1155f28672e5a33c6c163b9ca0b1b416300681. **They are equal**, so this is a clean merge with no hand edits.
   - Also, the full patch `git diff f0964fd5 9a8e84cf` and the full patch `git diff 6e24eaaf e913694f` have the same SHA-1 (ee786642f443…). So the merge brings exactly #688's change set and nothing else.
4. **Security-relevant paths.**
   - `git diff --stat 69c3e903 e913694f -- apps/api tests/api-integration tests/permissions tests/api-contract` is **empty**.
   - Everything that changed since 69c3e903: 33 files under `apps/web/`, `packages/ui/src/styles/pairs.json` (the colour-contrast data), and the review note.
   - No API runtime, route policy, permission matrix, OpenAPI contract or integration test changed. So every gate and probe result from the 69c3e903 review still applies to this head's API surface.

## Runs

- None needed beyond the git checks above. The API-side tree is byte-identical to 69c3e903, where 7 files / 131 integration tests, test:permissions (88), check:route-policy, check:openapi (282) and the mutation checks passed.
- I created no scratch worktree and no containers.

## Findings

- No new findings.
- N1 (stale organisations-policy comment) and N2 (gap in the strict-flag test table) from 710-69c3-security-rebind-opus.md are still open. Both are non-blocking.
- F1, the pre-existing write-route reach defect, stays with its separate fix lane.

## Residual risk

- I did not review #688's web changes or the review-note prose. They are outside this security rebind's API scope; #688 had its own review on main.

## Verdict

**CLEAR** at e913694fefddf4d6b1bc6e2f462dce1e5e327ae0. This review does not replace the required GPT-6 Sol review at this exact head.
<!-- END REPORT (sha256 3bc9154d93ec7ff691298e4514e2f8e129ab9bf8ebd84684cd90ac7d8975adc9) -->
