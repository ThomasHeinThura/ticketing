# PR #730 security review record: enforce declared project reach on project-scoped and task-target routes (#720)

PR #730 completes #720, the follow-up to #712. It makes these project-scoped writes enforce the project reach their policies declare:

- project update, archive, unarchive and health;
- milestones, prerequisites, stakeholders and document links;
- columns and workflow rules;
- work-item create, legacy task create and import.

Out-of-reach callers get the same 404 as a missing project, and nothing is written.

**Task bulk.** `PATCH /api/task/bulk` drops unreachable tasks early and decides capability per task through the shared caller-reach helper.

**Task-target actions.** Actions on a specific task's labels, time entries and assets require reach to that task's project. This was a conductor decision, recorded in the PR. Time entries and the label-task GET move to `work_item` scope.

**Guard.** A structural guard covers project-scope and task-target policies.

**Dependency.** The PR depends on #733 (owners and admins hold `sees_all`), which landed first after review found that ordinary owners would otherwise lose project writes.

A Claude Sonnet 5.5 lane implemented the change. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: REQUEST CHANGES at `5402ea36`, because ordinary owners and admins lost project writes. After Thomas's decision and #733, APPROVE at `578b8b7a`, where owners and promoted admins pass every write and members get 404. Delta APPROVE at `df527b8d`.
- Ordinary review B by Claude Sonnet 5.5 (policy, guard, fixtures, 400→404 callers, combined with #733): APPROVE at `4921b6a1`. The full serialized suite passed 2783 tests. Pre-existing read-side gaps are filed as #740.
- Security review by Claude Opus 5.5: BLOCK at `4921b6a1` with B1, a label-route existence oracle. Two older write-route gaps are filed as #741.
- Security delta review by Claude Opus 5.5: CLEAR at `df527b8d`. B1 is closed (identical 404 for missing and unreachable tasks), the original probe was re-run, and no other middleware has the flaw.

**Reviewed head:** `4921b6a190b09663335393af05903faf512f80df`
**Reviewed head:** `df527b8d80320bf018878dd755d140403d955c25`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `730-ordinary-a-sonnet.md` | Ordinary review A (8ea3ce27..5402ea36) | Claude Sonnet 5.5 | `5402ea36` | REQUEST CHANGES | `ddef85c4d4cf85a51157c316a0fd0e0dd3ea8a2fcbeccdcb7b483b09043c3738` |
| 2 | `730-578b-ordinary-a-sonnet.md` | Ordinary re-review A (5402ea36..578b8b7a) | Claude Sonnet 5.5 | `578b8b7a` | APPROVE | `5c41ed8e9f3983c5b736ea67e82647f7bb3028584db7f3743a1b4b693212224c` |
| 3 | `730-ordinary-b-sonnet.md` | Ordinary review B (6015f016..4921b6a1) | Claude Sonnet 5.5 | `4921b6a1` | APPROVE | `bfd8cc5288d92cd4fa997db015d2a49393876603cc4c3274b6073333c9fff772` |
| 4 | `730-security-opus.md` | Security review (6015f016..4921b6a1) | Claude Opus 5.5 | `4921b6a1` | BLOCK | `76d6b77fcb0cf0af5ea5781070ec20e56887126e3bb7d193af74699097607981` |
| 5 | `730-df52-security-delta-opus.md` | Security delta review (4921b6a1..df527b8d) | Claude Opus 5.5 | `df527b8d` | CLEAR | `4067d22b4c06c54a36db47944b65685737ab5448440836433d719cc14a801da5` |
| 6 | `730-df52-ordinary-delta-a-sonnet.md` | Ordinary delta review A (4921b6a1..df527b8d) | Claude Sonnet 5.5 | `df527b8d` | APPROVE | `10f5c310a9f2ebf5cc48801e0a34a0fa18b4257eb6cafce2dd5df75f262b1259` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/730-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 ddef85c4d4cf85a51157c316a0fd0e0dd3ea8a2fcbeccdcb7b483b09043c3738) -->
# PR #730 ordinary review A (correctness, product impact, tests)

**Reviewed head:** 5402ea3657061c6b4a7a8fcabb2eae3bd43978fe
**Base:** 8ea3ce272ce25bf50d599e9e1615d1ce288ede07 (main)
**Model:** Claude Sonnet 5.5 (fresh context; did not author, direct or remediate)

(Incremental notes; final verdict at the bottom once written.)

## 1. Product question (probe results)

Integration probe through real routes (POST /api/workspace, POST /api/project, then writes), run on base and head.

| step | base, ordinary owner | head, ordinary owner | head, instance admin |
| --- | --- | --- | --- |
| create workspace / project | 200 / 200 | 200 / 200 | 200 / 200 |
| GET project | 404 | 404 | 200 |
| PUT project | 200 | 404 | 200 |
| archive / unarchive | 200 / 200 | 404 / 404 | 200 / 200 |
| POST column | 200 | 404 | 200 |
| DELETE project | 200 | 404 | 200 |

Code facts: no production path sets membership.sees_all = true; no API route adds a project membership; JIT/OIDC/SCIM grants are CHECK-constrained to sees_all = false. rbac.md (decision 2026-10-04) says workspace membership alone grants no project reach, and this PR documents that creation grants the creator nothing.

Where the product facts live (head): create-workspace.ts inserts only a legacy `workspace_user` owner row, the three default roles, a default team and its team_member; no `membership` row, no sees_all, no project grant. `callerReach` and the single-row reach path both pass `ancestorProjectIds: []` and `ownerTeamId: null`, so ancestor and owner-team reach are not evaluated on any of these routes (consistent with #712).

## 2. Web client on 404 (non-blocking)

The PR changes no web file. Create work item: the dialog maps 403 -> forbidden, 400 -> invalid, anything else -> generic, so the new 404 shows the generic error toast (it showed "invalid" for the old 400). Project update/delete/archive fetchers throw `Error(responseText)`, so a 404 surfaces as the text "Project not found". No crash, no retry loop. Only a wording regression.

## 3. Route correctness

Read the full source diff (18 api files). Reach is decided before the capability and before any write on every changed route; `deferApiKeyCapability` keeps key scope intersection. Bulk: early drop in `fromTasks(projectReachPerItem)` plus controller re-check plus per-task capability (delete/assign/label:manage/update); unreachable ids become anonymous "Task not found" or 404 "No tasks found". Labels: `requireLabelRowTaskReach` and `requireBodyTaskReach` run before the permission gate, answer the route's own not-found, and are no-ops for workspace label definitions. Assets: identity resolved before the row lookup, one 404 for missing and unreachable (`asset.projectId` is NOT NULL). Time entries: `deferCapability` keeps the legacy gate. rbac.md text (new Reach section and table) matches the code; the policy scope moves to `work_item` match "reach required" and matrix.test passes.

## 4. Tests and mutations

New files are non-vacuous: each route has in-reach success, out-of-reach 404 with a full-table snapshot proving no write, byte-equality with a missing id, session and key cases.
Mutations I ran (own scripts in 730-ordinary-a-work/), against project-scoped-reach + task-target-reach, each restored with git checkout:
- M1 remove bulk per-item capability: KILLED (1 failed)
- M2 remove label detach row reach: KILLED (2 failed)
- M3 asset reach always true: KILLED (2 failed)
- M4 time-entry PUT reach off: KILLED (2 failed)
- M5 column route reach off: KILLED (2 failed)
- M6 bulk middleware early drop off: KILLED (1 failed)
- M7 bulk controller reach filter off: KILLED (1 failed)
- M8 label create body-task reach removed: KILLED (2 failed)
- M9 PUT /api/project/{id} reach off: KILLED (3 failed)
No survivors out of 9.
Guard bypass attempts (permissions suite): G1 strip reach from a project route -> guard FAILS (good). G3 delete a route key from the behavioural key list -> guard FAILS (good). G2 replace a real reach middleware with a decoy `markReach(noop)` -> the static guard PASSES (it is mark-based), but the integration table kills the same behaviour (M8), so the combination holds; the guard alone does not prove a mark is honest. Non-blocking.

## 5. Fixtures

Read every removed line of the ~40 changed test files and fully read the diffs of 8 (document-links, soft-delete-freeze, shadow-mode, task, work-item-create-read-list, workspace-rbac, project-milestones, project-stakeholders). Removals are: grants swapped for the new manage/item grant helpers, unused imports, and the intentional 400 -> 404 assertion changes (the "Workspace ID could not be determined" body checks became 404 + same body as a missing id). No assertion weakened. One intent change: shadow-mode "tracks request-sourced project scope" now expects 404 and an `agree` tally instead of 200 and `legacy_allow_policy_deny`; the test still pins the independent denial, but the legacy-allow/policy-deny divergence generator for this route no longer exists (disclosed by the implementer). Non-blocking.

## 6. Commands and exit codes (head 5402ea36, serialized, CI=true)

| Command | Result | Exit |
| --- | --- | --- |
| `pnpm test:permissions` (and direct vitest permissions config, uncached) | 16 files, 104 tests passed | 0 |
| `pnpm check:route-policy` | pass | 0 |
| `pnpm check:openapi` | matches, 282 operations | 0 |
| `pnpm lint:ci` | 2276 files, 207 warnings, 0 errors | 0 |
| `pnpm typecheck --force` | 9/9 tasks, 0 cached | 0 |
| integration: project-scoped-reach, task-target-reach, permissions-shadow-mode, strict-runtime-enforcement | 4 files, 236 tests passed | 0 |
| full integration suite (`vitest.integration.config.ts`) | 193 files, 2734 tests passed | 0 |
| 9 mutations, 2 guard bypass attempts, creator probe | see sections 1 and 4 | n/a |

Evidence files: /Users/heinthura/.codex/taskdesk-evidence/2026-10-14/730-ordinary-a-work/ (probe test, mutate.sh, logs). Scratch worktrees removed; I created no containers (Testcontainers' own Postgres per run; its ryuk reaper container is the harness's and is left alone).

## Findings

### B1 (BLOCKING unless Thomas explicitly accepts it): ordinary workspace owners and admins lose all project writes, and nothing in the product can restore them

Evidence: section 1 table. Through the real routes, a fresh ordinary owner (not an instance admin) creates a workspace and a project, then on base gets 200 for PUT project, archive, unarchive, add column, delete project; on head every one is 404. The same user already gets 404 on GET project on base, so the project screens were already unusable for them, but writes were the one thing that worked and this PR removes it. The instance admin (first user, setup-token path) is unaffected. Cause: workspace creation writes only a legacy `workspace_user` owner row; no production code path ever sets `membership.sees_all = true` (schema default false; backfills copy false; JIT/OIDC/SCIM grants are CHECK-constrained to false); no API route adds a project membership or project role; project creation grants the creator nothing (rbac.md says so, deliberately). Admins and managers are in the same position as owners. Upgrades: existing owners have no sees_all either, so after merge they lose the same writes; no migration or backfill in the PR addresses it. The PR is consistent with the 2026-10-04 decision (workspace membership alone grants no project reach) and with #712, so this is a product decision rather than a code defect, but the consequence (a deployment whose only way to administer projects is the instance-admin account) is not recorded in the PR or the decision log. Needed before merge, one of: (a) a recorded Thomas decision that non-instance-admin project administration is out of service until a membership or sees_all grant path exists (with the issue for that path, and a release note), or (b) creator/owner reach (for example the creator receives a project role at creation, or workspace owner gets sees_all at workspace creation with a backfill for existing owners), implemented in this or a prior PR. Not a defect in the middleware or tests themselves.

### N1 (non-blocking): wording regression in the web client
Create-work-item on an unknown or unreachable project now shows the generic error instead of the "invalid" one (404 not handled specifically); project settings show the raw text "Project not found". No crash.

### N2 (non-blocking): guard is mark-based
A marked no-op middleware passes `project-reach-guard.test.ts`; the integration tables are what kill it (M8). Acceptable because the guard also forces every route into a behavioural table; worth keeping the table requirement.

### N3 (non-blocking): shadow-mode test intent
"tracks request-sourced project scope" now asserts 404 and an `agree` tally; the legacy-allow/policy-deny divergence for this route can no longer be produced, as the implementer disclosed.

### N4 (non-blocking, pre-existing, disclosed): `PUT /api/project/reorder` and the two #720 comment items remain unaligned; ancestor and owner-team reach are not evaluated by `callerReach` or the single-row path (consistent with #712, fails closed).

## Not checked
- The web UI in a browser (code read only); the Linux CI baseline; the image build and boot; strict-enforcement mode beyond the strict-runtime file; API-key success paths beyond what the new test files assert; the other review roles (security).
- I did not probe a workspace "admin" or "manager" role user end to end; owner is a superset, and the middleware only consults reach, so they cannot do better than owner.

**Verdict:** REQUEST CHANGES
(Only B1, and only until it is either decided or fixed. The code, route coverage, 404 shape, tests, mutations and all 193-file integration run are otherwise clean; if Thomas accepts B1 in the decision log, this review would be APPROVE with N1 to N4 as follow-ups.)
<!-- END REPORT (sha256 ddef85c4d4cf85a51157c316a0fd0e0dd3ea8a2fcbeccdcb7b483b09043c3738) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/730-578b-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 5c41ed8e9f3983c5b736ea67e82647f7bb3028584db7f3743a1b4b693212224c) -->
# PR #730 ordinary re-review A at the post-#733 head

**Reviewed head:** 578b8b7a144c09bb1a25d6d5be306c93ab5ca8c2
**Previous review:** 5402ea3657061c6b4a7a8fcabb2eae3bd43978fe (REQUEST CHANGES on B1)
**Merged main:** 1f1abe7ca145d9a9749c869d4a4b94f4eb4d2537 (includes #728, #732, #733)
**Model:** Claude Sonnet 5.5 (fresh context, did not author the change)

## B1 resolved
Probe `730-578b-ordinary-a-probe.test.ts` (real routes, serialized), at this head:
- Fresh ordinary owner: create project 200, GET 200, PUT 200, column 200, work item 200, milestone 200, archive 200, unarchive 200, delete 200.
- Owner-promoted admin (added as member, then role PATCH to admin): identical, all 200.
- Plain member (no project membership): create project 200 but every project write and read is 404, as intended. A user with no workspace role (my "manager" row: the role name was rejected, 400, so this is a non-member of any project): 403 on create, 404 elsewhere.
- Legacy `POST /api/task/{projectId}` returned 400 for every actor because my probe body is invalid (status "to-do"); it is not a reach result (reach would be 404). The work-item create route covers the create-into-project path (200).
Base of comparison: at 5402ea36 the same owner got 404 on all of these.

## Merge purity
`git merge-tree --write-tree 5402ea36 1f1abe7c` = a94cb3d8786fb2da40ba94089a17b3aa2236fa81 = tree of 578b8b7a. Pure. The diff 5402ea36..578b8b7a under apps/api/src touches only #733's files (workspace-admin-reach.ts, workspace controllers, user/invitation controllers, index.ts); nothing under project, task, label, time-entry, column, workflow-rule, utils or tests/permissions changed. The #720 code is unchanged.

## Runs (serialized, CI=true, exit 0 each)
- `pnpm test:permissions --force`: 16 files, 104 tests passed. (A first direct vitest run in apps/api failed 5 files with "Failed to resolve entry for @taskdesk/email": the unbuilt workspace package in a fresh worktree, not a code issue; the turbo run builds it first and passes.)
- project-scoped-reach, task-target-reach, permissions-shadow-mode, strict-runtime-enforcement: 4 files, 236 tests passed.
- Full integration suite: 196 files, 2773 tests passed (previous head 193 / 2734; the extra 3 files and 39 tests are #733's).

## Earlier non-blocking findings
- N1 web 404 UX (generic toast / raw "Project not found"): still holds; the web diff from main (#728) does not address it.
- N2 guard is mark-based, decoy marks pass the static guard: still holds (guard files unchanged); integration tables remain the backstop.
- N3 shadow-mode test now asserts 404 plus `agree`: still holds, unchanged by the merge. (Note: it still passes, meaning the shadow test's owner has no grant because it uses fixture members, not the route-created owner.)
- N4 `PUT /api/project/reorder` and the two #720 comment items not aligned; ancestor/team reach not evaluated: still hold.

## Not checked
Browser UI, image build/boot, Linux CI baseline, the #733 migration/backfill itself (security reviewer's scope), managers with an explicit custom role.

**Verdict:** APPROVE
<!-- END REPORT (sha256 5c41ed8e9f3983c5b736ea67e82647f7bb3028584db7f3743a1b4b693212224c) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/730-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 bfd8cc5288d92cd4fa997db015d2a49393876603cc4c3274b6073333c9fff772) -->
# PR #730 ordinary review B (design, guard, fixtures, whole system)

**Reviewed head:** 4921b6a190b09663335393af05903faf512f80df
**Base:** main 6015f0163f150dcb7f09e485ad0985a8d890db94 (merge-base of the head; includes #733 `sees_all` for owners and admins)
**Model / role:** Claude Sonnet 5.5, ordinary reviewer B, fresh context. Did not author, direct or remediate. Reviewer A's reports were not read before forming this view.
**Method:** scratch worktree `/Users/heinthura/.codex/worktrees/rv730b` at the exact head (removed afterwards), `pnpm install --frozen-lockfile`, Testcontainers Postgres 18 under `CI=true` (container ids `75d70edb14fe` postgres, `bef77e9817fc` ryuk; both gone after the run, the pre-existing `taskdesk-*` containers were untouched).

## Commands and counts (all on the exact head)

| Command | Result |
| --- | --- |
| `CI=true pnpm test:integration` (apps/api, serialized, full) | exit 0, **197 files, 2783 tests passed** (1082 s). Log: `730-4921-b-integration.log` |
| `CI=true pnpm test:permissions` | exit 0, 16 files / 104 tests (17 / 105 with my temporary inventory probe, which was then deleted). Log: `730-4921-b-permissions.log` |
| `pnpm check:route-policy` | pass (turbo 5/5) |
| `pnpm check:openapi` | pass, 282 operations match |
| `pnpm lint:ci` | exit 0, 208 warnings, 0 errors (implementer saw 207; the head includes a main merge. Warnings in changed files are in `permissions-shadow-mode`, `project-soft-delete-freeze`, `workspace-role-apikey-permission-rekey-backfill`, all pre-existing in kind) |
| `pnpm typecheck --force` | exit 0, 9/9 tasks, 0 cached |
| Probes (integration, DB): my probe + owner-reach-probe + `project-scoped-reach` + `task-target-reach` + `column-create` | 5 files, 190 tests passed. Probe files kept in this folder: `730-4921-b-probe.test.ts`, output `730-4921-b-probe-output.json` |

Note on run integrity: during the full integration run I mutated `apps/api/src/column/index.ts` in the same worktree for about 20 seconds (guard-bypass experiments, restored byte-identical from a backup, `git status` clean). To rule out contamination I re-ran `column-create`, `project-scoped-reach` and `task-target-reach` afterwards; all green.

## 1. Policy declaration changes

- Time entries and `GET /api/label/task/{taskId}` moved to `work_item` scope, still `reach: required`, `scopeSource: row`, same capabilities. This is consistent with `data-model.md` (`TIME_ENTRY` belongs to `WORK_ITEM`; a time entry's reach comes from its task's project) and with `rbac.md`'s scope rules. `matrix.test.ts` is green without regenerating the fixture. Capability decision is deliberately deferred (`deferCapability`) so adding reach does not change who may act. That is a sound, disclosed choice, and it has a clean reversal path.
- Asset stays `scope: workspace` while the route now enforces project reach through `requireAssetProjectReach`. The policy declaration therefore does not describe the project-reach requirement, so the registry/shadow evaluator cannot see it; only the guard's family 2 does. Documented in the policy comment. Non-blocking (see N3).
- Other label routes stay workspace-scoped with a middleware-only reach on task-bound labels. Consistent with the conductor decision ("workspace-level label definitions stay workspace-scoped").
- `rbac.md` Reach section is accurate for the routes it lists. Two small doc drifts: `rbac.md` line ~784 still shows `DELETE /api/time-entries/{id}` as `scope: 'workspace'` in the illustrative registry sample (illustration only), and the sentence "Creating a project does not grant its creator project reach" is now only true for managers/members after #733 (owners and admins get `sees_all`).
- `data-model.md` was not changed and does not need to be for the scope changes. It describes a `label.project_id`, which the code does not have (pre-existing divergence). If a project-scoped label is ever introduced, the label routes need reach on that column.

**Undisclosed same-class residuals found (not in the known list: reorder, approvals POST for customers, bulk 500 under strict mode).** Confirmed by running them with a real owner and a reachless `member` of the same workspace (my probe):

- `GET /api/label/workspace/{workspaceId}` returns every label row of the workspace, including labels bound to tasks in projects the caller cannot reach (name, colour, `taskId`). Probe: `leaksTaskBoundLabel: true`. It contradicts the new `rbac.md` table, which says a label bound to a task needs reach to that task's project.
- `GET /api/search?workspaceId=...` returns a task title from a project the caller cannot reach (`leaksTask: true`). Legacy global search has no project reach.
- `GET /api/project?workspaceId=...` lists the project to a reachless member (n=1) while `GET /api/project/{id}` answers 404.

The issue text scopes #720 to actions on specific tasks and to project-scoped routes, so these do not contradict its acceptance criteria. They are the same defect class, were not disclosed, and the first one is a direct gap against the decision just recorded. Classified non-blocking for this PR; they need an issue (or a disclosed Known gap in the PR body) before the stage claim.

## 2. Structural guard

What I did, against the real router and registry (permissions config):

- Mutation A: replaced `PUT /api/column/{id}`'s `fromColumn("id", {requireProjectReach...})` with a bare `fromColumn("id")`. The guard fails (derived check: resolves a project-bearing row without project reach). Good.
- Mutation B: replaced the reach with a no-op `markReach(..., {projectReach: true})` plus a bare lookup (the decoy). The guard passes, 9/9. Only the behavioural tables (`project-scoped-reach`) catch it. Confirms reviewer A's note.
- A new project-scope policy without `reach` is refused by the registry/type system (reach is mandatory), so it cannot silently slip in. A new project-scope policy with `reach: { exempt: "no_single_resource" }` is excluded from family 1 (it filters on `reach === "required"`), and is only caught by the derived check if its middleware resolves a row through `workspaceAccess.*`. A controller that resolves a project row itself, or a body-sourced `projectId`, is invisible to the guard.
- The derived check does not treat `label` as project-bearing, so a new label route that forgets `requireLabelRowTaskReach` is only caught by the hand-kept `TASK_TARGET_ROUTE_KEYS` list.
- Order is not checked: a capability gate placed before the reach middleware would pass the guard and be caught only by the 404-parity behavioural rows.
- I inventoried every route whose policy scope is project/work_item or whose middleware resolves a project-bearing row and has no project-reach mark. Only four remain: `GET /api/work-items/{key}/approvals`, `POST /api/approvals/{id}/decide`, `POST /api/approvals/{id}/withdraw`, `POST /api/work-items/search`. These are approvals/search, covered elsewhere (approvals customers item is disclosed). Not in #720's list.

Assessment: the guard is a reasonable declaration check plus coverage-set check, with non-vacuous negatives and coverage-set equality with the integration tables, which is what actually proves enforcement. It is not a proof of enforcement, and the PR says so. A stronger structural check is advisable but not required to merge (N1): restrict `projectReach: true` marks to the two sanctioned sources (the `workspaceAccess` factory and an explicit allowlist of hand-written middleware: `requireBodyTaskReach`, `requireLabelRowTaskReach`, `requireAssetProjectReach`, `requireBulkTaskReach`), by having `markReach` accept only registered names or by asserting on the mark's origin. That closes the decoy without a behavioural run.

## 3. Fixtures (about 40 integration files)

Audited by diff (all removed lines, all added assertion lines) across: `permissions-shadow-mode`, `project-document-links`, `project-milestones`, `project-stakeholders`, `work-item-detail`, `work-item-hierarchy`, `work-item-create-read-list`, `nul-byte-param-sweep`, `task`, `workspace-rbac`, `project-soft-delete-freeze`, `project-slug-claim-permanence`, `project-slug-unique`, `project-organisation-binding`, plus `helpers/fixtures.ts`, and the unit tests under `tests/api`.

- No assertion was weakened or removed other than the 400 to 404 changes and the shadow-mode one. Every changed 400 now also asserts byte-equality with an unknown-id response (`task`, `work-item-create-read-list`, `workspace-rbac` x2), which is stronger. The `it` title in `project-document-links` was renamed consistently.
- Setup-only changes: grants (`grantProjectManageAccess`, `grantWorkItemProjectAccess`), import cleanup, `grantProjectRole` made idempotent (union widen). In `nul-byte-param-sweep` and `work-item-detail` the old two-capability grant was replaced by a larger set. That is setup and does not change an assertion, but it makes those fixtures more privileged than before.
- The cross-workspace milestone and document-link tests grant the other workspace's user access in project B; the grant is irrelevant to the assertion (caller is a different user) and harmless.
- `helpers/fixtures.ts` gives every non-viewer the manage set in `grantProjectAccessForWorkspaceRole`. This means ordinary fixtures no longer exercise "in reach, missing project capability". The new tables (`project-scoped-reach`) cover that with a read-only project admin, so coverage is retained.
- **Shadow-mode intent change** (`permissions-shadow-mode`, #324 "denied param workspace scope is checked against a verified row"): status 200 to 404 and the tally `legacy_allow_policy_deny/not_found` to `agree/null`. This is correct for the new behaviour and disclosed, but the test no longer demonstrates what it was written for (the observer disagreeing with an allowed legacy decision when the param workspace is not the row's). It now proves only that the observer agrees with a native deny. It also relies on a fixture owner without `sees_all`, which cannot occur in production after #733 (a real owner would get 200). Non-blocking (N2): retarget the test to a manager/member fixture or another route that still produces a legacy-allow/policy-deny divergence, or record explicitly that the divergence generator is gone.

## 4. 400 to 404 behaviour change

- Searched `apps/web` and `packages/mcp` for dependence on the old status or message. No caller reads "Workspace ID could not be determined". MCP tools (`register.ts`) forward errors and never branch on 400 for the changed routes. The only web consumer is `create-work-item-dialog-form.tsx`, which maps 400 to the "invalid" message and anything else to "generic"; an unreachable or unknown project now shows the generic error. The dialog is only reachable on a project the user already sees, so this is cosmetic (N4). `use-service-calendars.ts` handles a different (workspace) route.
- OpenAPI regenerated: description-only changes; `check:openapi` passes. A stale comment remains in `apps/api/src/workflow-rule/index.ts` line 65 ("a nonexistent project still answers 400, not 404") (N5).
- `api-design.md` line 868 already specifies 404 for "not found or out of reach".
- Move task (`PUT /api/task/move/{id}`) already checks destination reach, so the new project-scoped reach does not leave a cross-project move hole.

## 5. Combined with #733 (owner journey)

Run with real routes only: sign up two users, owner creates the workspace and project, owner adds the second user as `member` via the native membership route.

- Owner (fresh, `sees_all` from #733): project PUT 200, milestone 200, column 200, legacy task create 200, task label create 200, label by task 200, time entry create 200, time entries by task 200, `PATCH /api/task/bulk` 200. The conductor's `owner-reach-probe` also passes (included in the 5-file run). Note: `POST /api/projects/{id}/work-items` returned 400 for the owner in my probe only because my body had no `typeId`; it is not a reach result.
- Member with no project role: 404 on work-item create, legacy create, project PUT, milestone POST, column POST, label by task, label GET, label create on a task, time entry create, time entries by task, bulk update. All as intended.
- The PR no longer strands fresh owners, which was the blocker #733 was meant to unblock.

## Findings

Blocking: none.

Non-blocking:

- N1. Guard accepts a decoy `markReach` (verified by mutation); only the behavioural tables catch it. Tighten with a sanctioned-source allowlist for `projectReach: true` marks. Also not checked: middleware order, label routes in the derived check, controller-resolved project rows.
- N2. Shadow-mode test intent changed (200/legacy_allow_policy_deny to 404/agree) and relies on a fixture owner that cannot exist post-#733. Retarget or record.
- N3. Asset policy is `scope: workspace` while the route requires project reach, so the registry does not describe it. Consider a project-aware scope or an explicit note in `rbac.md` that the policy under-declares.
- N4. Create-work-item dialog now shows the generic error instead of "invalid" for an unknown or unreachable project. Cosmetic.
- N5. Stale comment in `workflow-rule/index.ts` line 65; `rbac.md` sample still shows `time-entries` at workspace scope; "creation does not grant project reach" needs the #733 qualifier.
- N6. Undisclosed read-side residuals of the same class: `GET /api/label/workspace/{id}` (task-bound labels from unreachable projects), `GET /api/search`, `GET /api/project` list. File an issue or list under Known gaps. The label list is the one closest to this PR's own decision.
- N7. Behavioural coverage for the bulk per-item capability mapping uses `work_item:update` for status and priority operations (not `transition` or `set_priority`). Same source as `POST /api/work-items/bulk`, so consistent; flagged only so the owner knows the mapping is coarse.

## Verdict

**VERDICT: APPROVE (ordinary review B), no blocking findings at 4921b6a190b09663335393af05903faf512f80df.** Mandatory GPT-6 Sol/Opus security review on the exact head still required for this security-scope change; this note does not substitute for it. Recommend N6 be filed or disclosed before merge, and N1/N2 considered for this PR or a tracked follow-up.
<!-- END REPORT (sha256 bfd8cc5288d92cd4fa997db015d2a49393876603cc4c3274b6073333c9fff772) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/730-security-opus.md; Claude Opus 5.5; sha256 76d6b77fcb0cf0af5ea5781070ec20e56887126e3bb7d193af74699097607981) -->
# PR #730 security review (independent, exact head)

**PR:** #730 "fix(api): enforce declared project reach on project-scoped and task-target routes (#720)"
**Reviewed head:** 4921b6a190b09663335393af05903faf512f80df
**Base:** main 6015f0163f150dcb7f09e485ad0985a8d890db94 (merge base; includes #733 `sees_all` for owners/admins)
**Model / role:** Claude Opus 5.5 (claude-opus-5-5), independent security reviewer. Did not author, direct or remediate this change. Read the prior ordinary reviews (A, A-578b, B) and the implementer notes before the run.
**Method:** detached scratch worktree at the exact head (removed afterwards); `pnpm install --frozen-lockfile`; private Postgres 18 container `8fabccd03670` with database `opus730_test` (removed by exact id afterwards; the pre-existing `taskdesk-*` containers were not touched). Every run was serialized and its exit code kept.

## Surfaces examined

- `apps/api/src/utils/task-target-reach.ts` (new): `requireBodyTaskReach`, `requireLabelRowTaskReach`, `assertTaskReach`.
- `apps/api/src/utils/workspace-access-middleware.ts`:
  - `projectReachPerItem` for `lookupMany`;
  - `deferCapability`;
  - the `requireProjectReach` block (500 fail-closed, 404 message choice, 403 after reach);
  - the mark `resources`.
- `apps/api/src/utils/caller-reach.ts`, `has-project-reach.ts` (`resolveCallerIdentity`, `projectReadDecision`), `packages/permissions/src/evaluator.ts` `reaches()`, and `apps/api/src/permissions/resolve-identity.ts` (how `sees_all` workspace ids are built).
- `apps/api/src/utils/authorize-asset-access.ts` (`requireAssetProjectReach`) and the asset route in `index.ts`.
- `apps/api/src/task/controllers/bulk-update-tasks.ts`, `task/index.ts` (`requireBulkTaskReach`, bulk route order, create, import).
- Route middleware in the project, column, workflow-rule, work-item, label and time-entry modules, plus their policies.
- Guard: `tests/permissions/project-reach-guard.test.ts`, `reach-guard-lib.ts`.
- Behavioural tables: `project-scoped-reach.test.ts`, `task-target-reach.test.ts`, `helpers/project-reach-world.ts`.
- A full route inventory from the real router and policy registry (`730-4921-security-opus-route-inventory.tsv`). For every write route without a project-reach mark, I checked whether it acts on a project or task.
- Routes not changed by the PR, looking for same-class write gaps: views, intake accept, request types, approvals.

## Commands and results (exact head, serialized)

| Command | Result |
| --- | --- |
| `CI=true pnpm test:permissions --force` | exit 0, 16 files, 104 tests passed |
| `pnpm check:route-policy` | exit 0, turbo 5/5 |
| `vitest --config vitest.integration.config.ts project-scoped-reach task-target-reach permissions-shadow-mode strict-runtime-enforcement` | exit 0, 4 files, 236 tests passed |
| `gitleaks git --log-opts="6015f016..4921b6a1" --redact` | exit 0, the PR's 2 non-merge commits scanned, no leaks |
| `gitleaks dir` (supplementary) | 11 hits, all in pre-existing docs/e2e/test files; none in the 70 files the PR changes |
| My probe `730-4921-security-opus-probe.test.ts` | exit 0; output in `730-4921-security-opus-probe-output.json` |
| My route inventory (temporary permissions test, deleted) | 287 registry entries, output kept as `.tsv` |

### Mutations (6). Each was restored with `git checkout --`, and the tree was clean between runs.

| # | Mutation | Guard (`project-reach-guard`) | Behavioural table | Killed |
| --- | --- | --- | --- | --- |
| M1 | `PUT /api/project/{id}` back to a bare `workspaceAccess.fromProject()` | FAIL (1) | `project-scoped-reach`: 3 failed | yes |
| M2 | Bulk controller ignores `reach.reaches(row)` | pass | `task-target-reach`: 1 failed ("a mixed batch changes only the tasks the caller reaches...") | yes (table only; correct, since the middleware still filters single-id batches) |
| M3 | `assertTaskReach` never denies | pass | `task-target-reach`: 13 failed | yes |
| M4 | Decoy `markReach(no-op, {projectReach:true})` replaces `requireLabelRowTaskReach()` on `DELETE /api/label/{id}` | **pass** (confirms reviewer B's N1) | `task-target-reach`: 2 failed (DELETE /api/label/{id} session and key rows) | yes |
| M5 | Asset project-reach check disabled | pass | `task-target-reach`: 2 failed (GET /api/asset/{id}) | yes |
| M6 | `POST /api/time-entry` loses `requireProjectReach` | FAIL (1) | `task-target-reach`: 2 failed | yes |

## Answers to the security questions

### 1. Completeness

For every route the PR claims, reach is decided in middleware before the handler reads or writes. I checked:

- session callers;
- API keys (reach comes from the key owner's identity; the capability goes to the key-aware gate through `deferApiKeyCapability`, or `can()` returns true for keys);
- impersonation (the same `resolveCallerIdentity` path; I did not probe it separately).

`projectReadDecision` returns `null` (giving a 500) unless the policy is project or work_item scoped with reach required, so a mis-declared route fails closed. The derived guard check finds no project-bearing lookup without project reach.

Using the inventory, I looked at every write route that has no project-reach mark. Beyond the disclosed items (reorder, approvals POST for customers, bulk 500 under strict mode), two pre-existing write routes act on a project the caller may not reach. Neither is touched by this PR. See N1 and N2.

### 2. Oracles

All project-scoped writes give the same result for out-of-reach, cross-tenant and missing ids: a 404 with the body "Project not found". I tested this as a viewer, as a read-only-scoped key and as another workspace's admin (probe P3, P4, P7). The bulk route matches as well (P5, P6).

**One new oracle exists.** It is introduced by this PR and described in B1.

### 3. Bulk

A mixed batch is safe:
- unreachable, cross-tenant and missing ids each return the identical anonymous `{"success":false,"error":"Task not found"}`, with no `taskId`;
- only the reachable task changed (`urgent`), and the unreachable and cross-tenant tasks stayed `medium` (P5);
- a batch made only of unreachable, cross-tenant or missing ids returns the same 404 "No tasks found".

Unreachable rows are dropped before the "same workspace" 400, so that 400 cannot act as an oracle. "Insufficient permissions" is only returned per item for tasks the caller reaches.

### 4. Guard

Confirmed: a decoy mark passes the static guard (M4). It was still caught by the behavioural table. The guard requires a table row for every route in its set, and that table compares the outsider response byte-for-byte with the missing-row response and checks a DB snapshot. That backstop is sufficient for merge. A stronger guard (an allowlist of sanctioned mark factories) is a worthwhile follow-up, not a precondition (N3).

However, the tables compare "missing" only under a caller who holds the capability. That is exactly why B1 got through; see the B1 test requirement.

### 5. Interaction with #733

- `sees_all` reach is built only from the caller's own workspace-scope memberships (`resolve-identity.ts` `seesAllWorkspaceIds`), and `reaches()` applies it only when `project.workspaceId` is in that list.
- Probe P7: another workspace's admin gets the same 404 as for a missing project.
- The tables show lead, member and admin fixture outsiders (none holding `sees_all`) all get 404. My viewer gets 404 everywhere.
- Ordinary reviewers A and B probed real route-created owners and admins with `sees_all` and got 200.

No path grants cross-workspace reach.

## Findings

### Blocking

**B1. New task-id existence oracle (cross-tenant) on `POST /api/label` and `PUT /api/label/{id}/task`.**

`requireBodyTaskReach` runs **before** the route's `requireWorkspacePermission({label: [...]})`. `assertTaskReach` behaves differently by case:
- missing task: returns (no decision);
- existing but unreachable task: 404;
- `loadLiveTaskFacts` does not filter by workspace, so a task in any other tenant counts as existing.

So a caller who lacks the label capability now gets 404 for an existing task anywhere and 403 for a missing one. Callers who lack it include a workspace `viewer`, or any API key whose scope omits the label permission. Measured at this head (probe P1, P3):

| Caller | Same-workspace unreachable task | Other tenant's task | Missing id |
| --- | --- | --- | --- |
| viewer | 404 `Task not found` | 404 `Task not found` | **403** `Insufficient permissions` |
| read-only-scoped key | 404 | 404 | **403** `Insufficient API key scope` |

At the base, both routes ran `fromBody`/`fromLabel` and then the permission gate, so all three cases returned the same 403. The PR therefore introduces the oracle, contradicting its own claim ("same 404 as missing") and the #290/#317 oracle rule.

Exploitability is limited because ids are random cuid2 values: an attacker can confirm an id they already hold but cannot enumerate. It is still a cross-tenant signal on a security-scope PR whose stated purpose is to remove that signal.

**Remediation (small):**
- in `requireBodyTaskReach`, answer the same 404 `notFoundMessage` when the task does not exist; or
- move `requireBodyTaskReach` after the permission gate on both routes.

The first option is preferable. It keeps "reach before capability" and leaves permitted callers' output unchanged, because the controller already returns 404 "Task not found" for a missing task.

**Required regression test:** for both routes, compare `{viewer, narrow-scope key} × {same-workspace unreachable, other-tenant, missing}` and require identical status and body. The existing table measures "missing" only with a capable caller, so it cannot catch this.

### Non-blocking

- **N1 (pre-existing, undisclosed): `POST /api/views` with `scope: "project"`.** `assertScopeBelongsToWorkspace` checks only that the project is in the workspace, not that the caller reaches it. A member can create a project-scoped view on a project they cannot reach. That answers 200, against 400 "scopeId must be a project in this workspace" for a missing id, which is a same-workspace existence oracle. Running the view still filters by reachable projects, so no row data leaks. File as a follow-up.
- **N2 (pre-existing, undisclosed): `POST /api/submissions/{ref}/accept`.** The body `projectId` is checked for workspace, organisation and live state only. A caller with `intake:triage` can create a work item in a project they cannot reach. `rbac.md` describes triage as "within reach". This is the same class as the work-item create that #730 now gates, but the policy is workspace-scoped, so it is outside "declared reach". File as a follow-up. Request-type `defaultProjectId` (admin `request_type:manage`) is a lower-risk relative.
- **N3: the guard is mark-based** (M4). Backstopped by the behavioural tables, so it is fine to merge. Suggested follow-up: an allowlist of the mark-producing factories (`workspaceAccess.*`, `requireWorkItemReach`, the three #720 middlewares, `requireBulkTaskReach`), so a hand-made `markReach` fails the guard.
- **N4: timing class.** On the `workspaceAccess` and `assertTaskReach` paths, a missing row short-circuits before identity resolution, while an out-of-reach row resolves identity and reach (a few extra indexed queries). Only the asset path equalizes this deliberately. This is the same pattern #712 accepted, the variation is small and noisy, and B1's fix does not depend on it. Record it as a residual.
- **N5:** I concur with reviewer B's N2 (shadow-mode test intent), N3 (asset policy under-declares project reach), N5 (stale comments/docs) and N6 (read-side residuals, now filed).

## Residual risk / not checked

- Impersonation was not probed separately. It shares `resolveCallerIdentity`/`reaches()` with sessions.
- Real `sees_all` owners and admins were not re-probed; I relied on A and B's probes plus the code.
- Not run: the full integration suite (B ran it: 197 files, 2783 tests), the image build and boot, and Linux CI.
- The disclosed residuals (`PUT /api/project/reorder`, approvals POST for customers, the bulk 500 under strict mode) were not re-examined beyond confirming they are still unaligned.
- Ancestor-project and owner-team reach are not evaluated by `callerReach` (`ancestorProjectIds: []`, `ownerTeamId: null`). This can only deny more, never grant more.

**Verdict:** BLOCK

Blocked on B1 only. After the B1 fix and its regression test land, a delta review of `task-target-reach.ts`, the label routes and the new test is enough to clear.
<!-- END REPORT (sha256 76d6b77fcb0cf0af5ea5781070ec20e56887126e3bb7d193af74699097607981) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/730-df52-security-delta-opus.md; Claude Opus 5.5; sha256 4067d22b4c06c54a36db47944b65685737ab5448440836433d719cc14a801da5) -->
# PR #730 security delta review (B1 fix)

**Reviewed head:** df527b8d80320bf018878dd755d140403d955c25
**Previous security review:** 4921b6a190b09663335393af05903faf512f80df (BLOCK on B1), `730-security-opus.md`
**Delta base:** 4921b6a1 (main merge base unchanged: 6015f0163f150dcb7f09e485ad0985a8d890db94)
**Model / role:** Claude Opus 5.5 (claude-opus-5-5), independent security reviewer. Did not author, direct or remediate the fix.
**Method:** detached scratch worktree at the exact head; `pnpm install --frozen-lockfile`; private Postgres 18 container `eba6b080118c` with database `opus730d_test`. Both were removed afterwards, the container by exact id. Runs were serialized and their exit codes kept. A `testcontainers-ryuk` container showed briefly in `docker ps` and then exited by itself. I did not start or remove it.

## Delta scope

`git diff 4921b6a1 df527b8d --stat` shows one commit (`df527b8d`) and two files:

- `apps/api/src/utils/task-target-reach.ts` (+6/−3). In `assertTaskReach`, the `if (!task) return;` is removed. Identity is now always resolved, and `!task || !reaches(task)` gives the route's identical 404. Nothing else changed.
- `tests/api-integration/task-target-reach.test.ts` (+101/−4). A new behavioural table for `POST /api/label` and `PUT /api/label/{id}/task`. It covers 2 callers (a viewer, and a key with no label scope) against 3 targets (a same-workspace unreachable task, another tenant's task, a missing id). It requires six identical responses, a 404, and an unchanged DB snapshot.

The delta touches no other source file.

## B1: closed

My original probe (`730-4921-security-opus-probe.test.ts`) was re-run unchanged at this head (exit 0):

| Caller | Same-workspace unreachable | Other tenant | Missing |
| --- | --- | --- | --- |
| viewer, `POST /api/label` | 404 `Task not found` | 404 `Task not found` | 404 `Task not found` |
| viewer, `PUT /api/label/{id}/task` | 404 | 404 | 404 |
| capable outsider admin, `POST /api/label` | 404 | 404 | 404 |
| read-only-scoped key, `POST /api/label` | 404 | 404 | 404 |

At 4921b6a1 the "missing" column was 403. Bodies are byte-identical.

The ordering stays reach (404) before capability (403), consistent with #712. A 403 can now only come for a task the caller reaches, and that task is already visible to them.

**Mutation:** I restored the old `if (!task) return;`. Result: `task-target-reach` failed 2 tests (both new label rows: "2 callers x 3 targets give six identical responses"). The tree was restored by `git checkout`. The new test is not vacuous.

## Same flaw elsewhere?

I checked every reach middleware that resolves an id from the body or a row:

| Middleware / helper | Missing id | Out of reach | Same flaw? |
| --- | --- | --- | --- |
| `workspaceAccess.*` lookups (incl. `lookupMany`) | 404 at lookup | same 404 | no |
| `requireAssetProjectReach` / `loadReachableAsset` | 404 | same 404, one query | no |
| `requireLabelRowTaskReach` (shares `assertTaskReach`) | label missing: 404 from `fromLabel`; bound task gone: now 404 `Label not found` | same 404 | no |
| `requireBulkTaskReach` | no id; per-item results are anonymous | same | no |
| task-relation `scopeToSourceTask` | 404 `Source task not found` before reach | same 404 | no |
| task-relation `scopeToRelation` | relation missing: 404 | same 404 | no |
| `createTaskRelation` target (controller) | `undefined`: 404 | `undefined`: 404 | no |
| `approvalRequestReach` (`requireWorkItemReach`) | 404 | 404 | no (disclosed customer path unchanged) |

## Commands and results (exact head)

| Command | Result |
| --- | --- |
| `vitest (integration) label task-target-reach project-scoped-reach project-reach-guard permissions-shadow-mode strict-runtime-enforcement project-soft-delete-freeze project-archive-freeze-legacy workspace-owner-admin-reach task-relation-workspace-reach` | exit 0, **13 files, 335 tests passed**. The `label` filter covers `label.test`, `label-detach`, `label-bulk-rename-race` and `label-workspace-cascade-task-delete-race`. |
| My probe | exit 0, table above |
| `CI=true pnpm test:permissions --force` | exit 0, 16 files, 104 tests passed |
| `gitleaks git --log-opts="4921b6a1..df527b8d" --redact` | exit 0, no leaks |
| Mutation (old early return restored) | `task-target-reach` exit 1, 2 failed / 45 passed |

## Findings

**Blocking:** none.

**Non-blocking:**

- **D1. Behaviour change on label-row routes.** A label whose bound task no longer resolves as live now answers 404 `Label not found` before the capability gate. This affects `GET`, `PUT` and `DELETE /api/label/{id}` and `DELETE /api/label/{id}/task`. "No longer live" means the task's project is soft-deleted, so `loadLiveTaskFacts` filters it out. Before this fix, such a label went on to the downstream handler.
  - This is fail-closed, and it is identical to a missing label.
  - The soft-delete and archive freeze suites still pass.
  - Recorded so the owner knows that labels from soft-deleted projects can no longer be read or deleted through the id routes.
- The earlier non-blocking items from `730-security-opus.md` still hold:
  - N1: views project scope;
  - N2: intake accept into an unreachable project;
  - N3: the guard is mark-based;
  - N4: the timing class.

  The fix improves N4 for these two routes: identity is now resolved on both the missing and the unreachable path.

## Residual risk / not checked

- Full integration suite, image build and boot, Linux CI.
- Impersonation was not probed separately (shared identity resolver).

**Verdict:** CLEAR
<!-- END REPORT (sha256 4067d22b4c06c54a36db47944b65685737ab5448440836433d719cc14a801da5) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/730-df52-ordinary-delta-a-sonnet.md; Claude Sonnet 5.5; sha256 10f5c310a9f2ebf5cc48801e0a34a0fa18b4257eb6cafce2dd5df75f262b1259) -->
# PR #730 ordinary delta review A (4921b6a1..df527b8d)

**Reviewed head:** df527b8d80320bf018878dd755d140403d955c25
**Delta base:** 4921b6a190b09663335393af05903faf512f80df (main 6015f016 merge, previously approved by B)
**Previous approval:** 578b8b7a144c09bb1a25d6d5be306c93ab5ca8c2
**Model:** Claude Sonnet 5.5 (fresh context)

## Delta
Exactly one commit (df527b8d, parent 4921b6a1), 2 files: apps/api/src/utils/task-target-reach.ts (+6/-3) and tests/api-integration/task-target-reach.test.ts (+101). Source change: in `assertTaskReach`, a missing task no longer returns to the controller; `!task || !reaches(task)` both throw the route's own 404 after identity resolution. Correct and minimal; capable callers are unaffected (an existing, reachable task still passes through, and in-reach success tests for label create/attach pass).

## New table is non-vacuous
Two label routes x (viewer session, key without label capability) x (same-workspace unreachable, other-tenant, missing) = six responses each, all required equal (status and body), 404, with a full-table snapshot proving no write. Mutations (restored with git checkout):
- A revert the fix (missing task returns to controller): KILLED (2 failed)
- B missing task answers a different 404 message: KILLED (4 failed)
- C reach check disabled for existing tasks: KILLED (15 failed)

## Soft-deleted project behaviour (Opus-flagged)
`loadLiveTaskFacts` already excluded soft-deleted projects, so a label bound to a task in a soft-deleted project now answers 404 "Label not found" on label-by-id routes (and "Task not found" for body-task routes). This is consistent with the #202 soft-delete freeze suite (`project-soft-delete-freeze.test.ts`: a soft-deleted project's tasks, columns and rows answer 404 and are unchanged) and with the data-protection 30-day soft-delete model; the middleware's own project lookups filter `deletedAt` the same way. Not a regression; worth a sentence in the PR body only.

## Runs (exit 0)
- label files + task-target-reach (5 files): 66 tests passed.
- `pnpm test:permissions --force`: 16 files, 104 tests passed.
Not run: full integration suite (delta is one helper used only by label routes; the label and reach files cover every caller), browser UI.

**Verdict:** APPROVE
<!-- END REPORT (sha256 10f5c310a9f2ebf5cc48801e0a34a0fa18b4257eb6cafce2dd5df75f262b1259) -->
