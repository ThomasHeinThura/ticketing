# PR #712 security review record: enforce declared project reach on item-scoped routes

PR #712 aligns item-scoped routes with the project reach their policies and the permission matrix already declare.

**Middleware.** `requireWorkItemReach()` now defaults to project reach. Opting out requires a stated reason.

**Routes now enforcing project reach:**
- every work-item route that names an item;
- attachment-by-id;
- the approval-request POST (reach is resolved before body validation);
- 21 legacy task-keyed routes;
- work-item comments by id.

**Gates tightened:**
- Bulk actions apply per-item reach plus the operation's capability, through a shared `caller-reach` helper.
- Task relations require reach to both ends, and listings omit relations to unreachable items.
- Search refuses customer principals.
- Activity-comment API keys fail closed.
- Customer capability flags match the routes.

**Out-of-reach behaviour.** Callers get the same 404 as a missing item, with nothing written and no row returned.

**Structural guard.** Every policy with work-item scope and `reach: required` must carry project reach, or a reasoned opt-out, and must appear in a behavioural test table.

**Follow-ups.** The remaining project-scoped and task-bulk routes are tracked in #720. The API-key model question is #724.

A Claude Sonnet 5.5 lane implemented the change. The conductor (Claude Opus 5.5) made the merges of `main`. The reviewers below are fresh, independent contexts that did not author, direct or remediate it. The originating finding is F1 of the #710 security review (`710-security-opus.md`, private).

## Review chain

- Ordinary review A by Claude Sonnet 5.5: APPROVE at `96d0ee26`. It found same-class gaps F1–F5, which round 2 closed. Delta APPROVE at `6be2c97d` and at `edd4f91a`, both with probes and mutations.
- Ordinary review B by Claude Sonnet 5.5 (design, guard, fixtures): APPROVE at `6be2c97d`. Two full runs, a guard bypass attempt, and 56 fixture files audited.
- Security review by Claude Opus 5.5: CLEAR at `aec692e9`, with a full serialized suite and strict-mode probes. It raised F1 (task relations exposed hidden items), F2 (bulk capability), F3 (activity-comment keys), F5 (behavioural-table guard) and F7 (customer flags). Round 3 closed them.
- Security rebind: CLEAR at `edd4f91a`. Round 3 was verified, and two test gaps (N2) and a leader-lock order dependence (N4) were raised.
- Light security rebind: CLEAR at `7b97d249`. The N2 rows pin the mutations, and the N4 setup no longer depends on test order.
- Mechanical security rebind at `510df528`: CLEAR. The merge tree is identical to `git merge-tree` of `7b97d249` and `28481af5` (#721), and no API or test path changed.
- Mechanical security rebind at `eb660151`: CLEAR. This head merges `main` `417944ca` (#726). Its tree equals the merge-tree of `dc41b2a3` with `417944ca`, the changed files are exactly #726's, and there is no interaction with this PR's paths.

**Reviewed head:** `aec692e94d681ca3aae1172f88615c42c1597f6b`
**Reviewed head:** `edd4f91a85a9edd220ecc249febb0ab3f79da8b9`
**Reviewed head:** `7b97d24923043fc6823ec7c462107afd18c21fcf`
**Reviewed head:** `510df528d067d8a447ee31ac84a74395b97ee37b`
**Reviewed head:** `eb6601511153430c444b8c814b85c4b5965ff30c`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `712-ordinary-a-sonnet.md` | Ordinary review A (ee499594..96d0ee26) | Claude Sonnet 5.5 | `96d0ee26` | APPROVE | `7888ef455da58cb32eed6ac35f5bcde7f7cf64bc8afd382e6b36c52d86f84d42` |
| 2 | `712-6be2-ordinary-a-sonnet.md` | Ordinary delta review A (96d0ee26..6be2c97d) | Claude Sonnet 5.5 | `6be2c97d` | APPROVE | `25e95d1db2bbc43e1d832fdc535d62f8d5de5bba5a3edb8cd7a723e272325e3c` |
| 3 | `712-ordinary-b-sonnet.md` | Ordinary review B (f0964fd5..6be2c97d) | Claude Sonnet 5.5 | `6be2c97d` | APPROVE | `cbc346aad1ac62e141b0fcf76fec55743d73315ff1fcd27e55538e49097e08f9` |
| 4 | `712-security-opus.md` | Security review (66565b2c..aec692e9) | Claude Opus 5.5 | `aec692e9` | CLEAR | `1dd837cb8bf6723a19cfc50f2bfb7ed45a9dc31dfb5e82fc4b095239586e6295` |
| 5 | `712-edd4-ordinary-a-sonnet.md` | Ordinary delta review A (aec692e9..edd4f91a) | Claude Sonnet 5.5 | `edd4f91a` | APPROVE | `a93c645c6ee1cca3d4343e74701541f22aea84d7ccd6e6a30239186de08d14b5` |
| 6 | `712-edd4-security-rebind-opus.md` | Security rebind (aec692e9..edd4f91a) | Claude Opus 5.5 | `edd4f91a` | CLEAR | `65d3b4a7a7c274232f7f86e92f40263b3b25812e178cadbfa18102df9baea8a3` |
| 7 | `712-7b97-security-rebind-opus.md` | Security rebind (edd4f91a..7b97d249) | Claude Opus 5.5 | `7b97d249` | CLEAR | `ce8f30e514a2c4a082b7129e84a948a262935e47cb58b08e9f8ab94bbc5f7c49` |
| 8 | `712-510d-security-rebind-opus.md` | Mechanical security rebind (7b97d249..510df528) | Claude Opus 5.5 | `510df528` | CLEAR | `7703fe57ef1a32f48026a8c6f1be6527af6fd5368b3b6882426371360d77a487` |
| 9 | `712-eb66-security-rebind-opus.md` | Mechanical security rebind (dc41b2a3..eb660151) | Claude Opus 5.5 | `eb660151` | CLEAR | `2ce401440990e9832ff5ee278fe0b8dd816d1f40ab8e8c3a8f30cfbd29634271` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/712-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 7888ef455da58cb32eed6ac35f5bcde7f7cf64bc8afd382e6b36c52d86f84d42) -->
# PR #712 ordinary review A (project reach on item-scoped work-item routes)

**Model:** Claude Sonnet 5.5, reviewer A. Fresh, independent context. I did not author, direct or remediate this change.
**Reviewed head:** 96d0ee26e46551b647aa7d7c8a82a3f400fafa41
**Base:** origin/main ee499594 (the head merges it). Diff read as `git diff ee499594 96d0ee26` (31 files, +1151/-184).
**Scratch copy:** detached worktree /Users/heinthura/.codex/worktrees/review-712-a at the head; removed afterwards. Author worktree untouched. No push, comment or merge. No exploit detail is in any public place.

## Files examined
- src: `work-item/require-work-item-reach.ts`, `work-item/index.ts`, `work-item/bulk-reach.ts`, `controllers/bulk-work-items.ts`, `controllers/rank-work-item.ts`, `work-item/comment-versions.ts`, `attachment/index.ts`, `attachment/require-attachment-reach.ts`, `utils/has-project-reach.ts`, `utils/require-workspace-permission.ts`, `utils/require-api-key-permission-scope.ts`, `approval/index.ts`, `comment/`, `task/`, `task-relation/`, `label/`, `time-entry/`, `activity/` route headers.
- tests: `tests/permissions/work-item-reach-guard.test.ts`, `tests/permissions/matrix.fixture.json` (work-item, attachment, approval, search rows), `tests/api-integration/work-item-project-reach.test.ts`, `helpers/fixtures.ts`, and the diff of the ~20 touched integration files (assign, unassign, hierarchy, transition, comment, attachment-*, etc.).
- prior evidence: 710-security-opus.md (F1), wi-reach-fix-impl-sonnet.md.

## Commands run (all at 96d0ee26 in the scratch copy)
| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile`; `turbo build --filter=@taskdesk/api^...` | ok |
| `pnpm test:permissions` | 15 files / 94 tests passed |
| `pnpm check:route-policy` | ok (5/5 tasks; permissions 94 tests inside) |
| `pnpm check:openapi` | ok, 280 operations |
| `work-item-project-reach.test.ts` (CI=true, serialized) | 37/37 passed |
| Broad serialized integration, CI=true: approval-, attachment, capabilities-scope, comment, task-comment, task-relation, work-item-*, global-search, portal-identity, intake-attachment | **50 files / 831 tests passed** |
| My probe suite `712-ordinary-a-sonnet-probes.test.ts` (saved beside this report, not added to the branch) | 40 tests; every assertion held (details below) |
| Guard mutation 1: delete `requireWorkItemReach` from the rank route | guard FAILS: "no requireWorkItemReach() and no reasoned exemption" |
| Guard mutation 2: rank opt-out with an empty reason | guard FAILS: "workspace-only reach without a stated reason" |
Sources were restored after each mutation (git status clean apart from my probe file). Docker: only Testcontainers containers, which exit by themselves. I removed none by hand and did not touch `taskdesk-*`.

## Findings against the checks

**1. Default reach (PASS for every route through the middleware).**
Probed all 12 write routes (PATCH, assign, unassign, DELETE item, rank, parent set and detach, watch, unwatch, transition, comment create, attachment presign) and 7 GET routes (item, sla, activity, tree, transitions, attachments list, mention-candidates):
- Out-of-project-reach callers (lead, member and admin with no project role) get 404, write nothing and see no row.
- A reachable caller holding only `project:read` + `work_item:read` gets 403 and nothing is written. The exception is watch/unwatch, which are 200 by design because they gate on `work_item:read`.
- For each write route the out-of-reach response is byte-identical to the response for a nonexistent key, so there is no existence oracle.
- The matrix is respected: customer with a project role gets 403, customer without gets 404.
Item routes that still lack project reach are listed under F1-F4 below.

**2. Bulk (PASS).** Member in project: item succeeds, `NOPE-1` fails "Work item not found". Outsider admin: both keys fail with the identical reason, nothing changes. Outsider-owned API key: same. Customer with project role: 403.

**3. Assign/unassign (PASS).** With `project:read, work_item:read, work_item:update` only:
- assign to self: 200
- assign to another person: 403
- unassign own assignment: 200
- unassign someone else's assignment: 403
A read-only role assigning itself: 403. The handlers still apply the predicates.

**4. Customer 403 (PASS, with a caveat).** The customer-principal 403 on GETs matches the matrix (customer inReach 403 on every item route). Customers read items through the portal routes, which do not use this middleware, so no legitimate agent-side customer flow is lost. Caveat: F4 (search and list drift).

**5. API-key decision (SOUND, verified by running it).** For each write route I used keys on a member who holds full project caps:

| Key scope | Result on every write route |
| --- | --- |
| `{work_item:[read], project:[read]}` | refused 403 |
| `{project:[read]}` | refused 403 |
| null | refused 403 |
| empty `{}` | refused 403 |
| full scope | 200 (positive control) |

The refusals come from the downstream gate ("Insufficient API key scope" via requireWorkspaceCapability or the legacy permission gate; "Insufficient permissions" from the assign/unassign handlers). No data changed on any refusal. The one exception is watch/unwatch: a read-scoped key can watch, which matches the `work_item:read` gate. An outsider-owned key with a full scope gets 404 on every route, so reach is enforced for keys as the PR intends. Reversal (dropping `deferApiKeyCapability`) would fail closed 403.

**6. Fixtures (PASS).**
- The grants are the minimum for the actors; the grant helpers give `viewer` read-only (`project:read, work_item:read`), so the viewer 403s are kept.
- The AS-5 roster negative tests use persons built outside the grant helper and delete or move their membership, so they are not weakened.
- `onConflictDoNothing` on membership inserts only avoids duplicate rosters.
- The transition role-gate test now updates the existing role's capabilities rather than adding a new membership; its 409 -> 200 assertions are unchanged.
- hierarchy: the viewer's explicit `["work_item:read"]` grant is replaced by the helper's read-only grant, which is a superset (adds `project:read`).
No negative assertion was removed.

**7. Structural guard (PASS, non-vacuous)** per mutations 1 and 2 above. Limits are noted under F5.

**8. Runs.** All green as tabled.

## Findings (classification, location)

**F1 (non-blocking, pre-existing, should be tracked before #708 is called closed).**
`DELETE /api/attachments/{id}` and `POST /api/attachments/{id}/complete` still use `requireAttachmentReach()` in workspace-only mode (`apps/api/src/attachment/index.ts:129`, `:173`; project reach is opt-in at `require-attachment-reach.ts:121`). The matrix declares outOfReach 404 for both. Probe: an uploader whose project membership was removed got 200 on DELETE (response carries the attachment row) and a 409 "already deleted" on complete, instead of 404. The blast radius is small because only the uploader can do this. Only the GET download uses project reach. The structural guard does not cover `/attachments/{id}`.

**F2 (non-blocking, pre-existing).** `POST /api/work-items/{key}/approvals` (`approval/index.ts:187`): with a malformed body, an out-of-reach caller gets 400 for a real key but 404 for a missing key. That is an existence oracle on guessable keys. With a valid body it is 404 for both, and GET is 404. The `approvalWorkItemEvidence()` middleware (see `approval/index.ts:169`, `:187`) does not decide reach, so request validation runs first. The allow-list reason in the guard ("reviewed under the approval lane") is not yet true for this ordering. Customers get 404 where the matrix says in-reach 403; this is cosmetic.

**F3 (non-blocking, pre-existing, informational).** The legacy task-keyed routes (`/api/task/{id}` writes, `/api/comment/{id}` PUT and DELETE, `/api/task-relation` POST and DELETE, labels, time-entry, `activity` POST and PUT) use `workspaceAccess.fromTask*()` without project reach for writes, while their reads mostly have it. They were not examined for exposure here. The row-matching matrix cases are not driven by the new guard. Confirm whether they are in the remaining #708 scope.

**F4 (non-blocking, pre-existing).** `POST /api/work-items/search` (`work-item/index.ts:269`): the matrix declares customer inReach 403, but a customer-role member with a project role gets 200 with item rows including the title. Outsiders correctly get an empty result. Item 4 of this PR makes the customer rule explicit on item routes, so search is now the outlier. `GET /api/projects/{id}/work-items` returned 404 for the same customer, which is safe.

**F5 (non-blocking, hardening).**
- The guard checks the marker symbol, not behaviour. It covers only `/api/work-items/{key}` `work_item`/`reach: required` routes, so bulk, attachments by id and comment-by-id are outside it. The behavioural integration file covers 12 routes plus bulk, but not the 8 GET routes (my probe did) and not the "reachable but missing capability gives 403" case or the API-key case. I recommend adding the 403 case and a key case to `work-item-project-reach.test.ts`.
- `isCustomerPrincipal` (`require-work-item-reach.ts:85`) runs two extra queries on every item request and the person lookup is not scoped by workspace or ordered. Low risk, minor cost.

No blocking findings.

## Residual risk
- Bulk with a scoped API key: I only probed reach, not key-scope enforcement in the bulk handler.
- Instance-admin and impersonation credentials were not probed.
- Realtime and websocket paths were not examined beyond the existing `node-server-websocket` fixture change, which passes.
- Image build, boot and health checks were not run. No Sol security review is implied: this change touches permission code, which is security scope, so the exact-head GPT-6 Sol gate still applies.
- Full 186-file integration suite was not run, only the 50 relevant files.

## Verdict
**APPROVE** at 96d0ee26e46551b647aa7d7c8a82a3f400fafa41 for this ordinary review. F1-F5 are non-blocking follow-ups. This does not replace the required GPT-6 Sol security review.
<!-- END REPORT (sha256 7888ef455da58cb32eed6ac35f5bcde7f7cf64bc8afd382e6b36c52d86f84d42) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/712-6be2-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 25e95d1db2bbc43e1d832fdc535d62f8d5de5bba5a3edb8cd7a723e272325e3c) -->
# PR #712 delta ordinary review A (96d0ee26..6be2c97d)

**Model:** Claude Sonnet 5.5, reviewer A. Fresh, independent context. I did not author, direct or remediate this change.
**Reviewed head:** 6be2c97d10e0bb539b7275c0f8c78f39479a5103
**Base / delta from:** 96d0ee26e46551b647aa7d7c8a82a3f400fafa41 (my earlier review head). The head also merges origin/main f0964fd5 (#705); I read the merge's #705 content only as it touches reach code.
**Scratch copy:** detached worktree /Users/heinthura/.codex/worktrees/review-712-a2; removed afterwards. No push, comment or merge. Author worktree untouched. No exploit detail in any public place.

## Files examined
`utils/reach-mark.ts`, `utils/is-customer-principal.ts`, `utils/assert-work-item-project-reach.ts`, `utils/workspace-access-middleware.ts` (diff), `work-item/require-work-item-reach.ts`, `work-item/require-comment-reach.ts`, `work-item/index.ts` (search refusal), `attachment/index.ts` and `require-attachment-reach.ts`, `approval/index.ts`, `task/index.ts` and `task/policy.ts`, tests `work-item-project-reach.test.ts`, `-credentials.test.ts`, `legacy-task-project-reach.test.ts`, `helpers/reach-world.ts`, `work-item-reach-guard.test.ts`; the portal host allow-list (`index.ts:328`, `:718`) and the portal-marked policies. Implementer round-2 notes.

## Commands run (at 6be2c97d)
| Command | Result |
| --- | --- |
| install; `turbo build --filter=@taskdesk/api^...` | ok |
| `pnpm test:permissions` | 15 files / 94 tests passed |
| `pnpm check:route-policy` | ok (5/5 tasks) |
| `pnpm check:openapi` | ok, 281 operations |
| Serialized integration, CI=true: approval-, attachment, capabilities-scope, comment, task-, work-item-, global-search, portal-identity, intake-attachment, project-, multi-role, move-task, label-, nul-byte, authorization-boundaries, workspace-rbac | **82 files / 1294 tests passed** |
| My round-1 probes re-run (saved as `712-6be2-ordinary-a-sonnet-probe1.test.ts`), updated to expect the fixes | 41/41 passed |
| Probe 2 (`...-probe2.test.ts`): legacy bulk, project-scope create, F2 oracle | observations below |
| Mutation A: attachment DELETE changed to a reasoned workspace-only opt-out | 3 tests fail (outsider 404, customer, outsider-owned key) |
| Mutation B: reach removed from legacy `PUT /api/task/priority/{id}` | guard FAILS ("workspace-only reach without a stated reason", route named); `legacy-task-project-reach` 3 tests fail too |
Sources restored after each mutation; the tree was clean. Docker: only Testcontainers containers; I removed none and did not touch `taskdesk-*`.

## Fix verification
- **F1 PASS.** Uploader who lost project access now gets 404 on DELETE and complete (was 200/409). Customers 403, outsider-owned key 404, enforced by the new tests (mutation A).
- **F2 PASS for staff.** Malformed-body POST /approvals: outsider admin and member get 404 for both real and missing keys (was 400 vs 404). Residual see N2.
- **F3 PASS for the 21 declared rows.** Outsider gets 404 with the resource's own not-found text; customers 403; key rules per the tests. Spot probes: outsider GET/PUT priority on a legacy task 404. Guard mutation B proves coverage.
- **F4 PASS.** Customer with a project role gets 403 from search; outsiders get an empty page; members unchanged.
- **F5 PASS.** The new files cover reachable-without-capability 403 and read-scoped, unscoped and outsider-owned keys per route. The guard now iterates every registry policy with work_item scope and reach required.
- **Comment PATCH/DELETE by id.** Reach added with keys failing closed (controllers never check key scope). Author with only `update_own` still passes via the branch capability; covered by the tests that passed.

## Customer-facing flows
No customer-facing flow breaks. None of the newly refused routes is portal-marked (portal policy markers exist only on `/portal/*` attachment, intake and approval rows), so customers cannot reach them on the portal host anyway. Portal submission attachments, intake messages, portal approvals and `GET /approvals` (customers read addressed approvals there; deliberately left allowing them) are unchanged, and the portal and intake integration suites pass.

## Findings

**N1 (non-blocking for this PR, but must be filed; same defect class, not correctly out of scope).** Legacy `PATCH /api/task/bulk` (`task/index.ts:~106`, middleware `workspaceAccess.fromTasks()`; policy declares `workspace` scope, `task/policy.ts`) still ignores project reach. Probe: a same-workspace admin with no project role bulk-updated a task's priority in an unreachable project (200, `updatedCount: 1`, row changed), while `GET /api/task/{id}` and `PUT /api/task/priority/{id}` for the same caller and task return 404. The `delete`, assignee and label operations share the route. A member-role caller got 403 from the legacy bulk permission gate, so the exposure is admin/owner-class roles, as in the original F1. This is a bypass of the very routes round 2 fixed. Because the policy row is workspace-scope, neither the guard nor the matrix catches it. Recommend per-task reach in the bulk path (as `bulk-reach.ts` does for work items) or re-declaring the policy. It does not block this PR since the declared contract is unchanged, but #708 / F3 must not be called closed.

**N2 (non-blocking, low).** `POST /work-items/{key}/approvals` skips reach for customer-side persons (`approval/index.ts` `approvalRequestReach`): a customer-side person with a malformed body gets 400 for a real key vs 404 for a missing key (existence oracle). A workspace-role `customer` that is not customer-side goes through reach and gets 403 only when in reach. Practical exposure is low: the route is not portal-marked and portal sessions are refused on the agent host.

**N3 (non-blocking, disclosed by the implementer; I confirmed it).** Project-scope routes still use workspace reach: `POST /api/projects/{id}/work-items` by a same-workspace admin with no project role returned 200 (created an item in an unreachable project). `PATCH`/`PUT /api/projects/{id}` returned 404 for the same caller. Needs its own PR, as the notes say.

**N4 (non-blocking, policy question).** Labels and time entries stay workspace-scoped, as declared. `PUT /label/{id}/task` and `POST /time-entry` act on a specific task under that declaration, so an out-of-project caller can still attach a label or log time to a task. Not probed by me. Correctly out of scope for this PR's matrix claim, but the declaration deserves a decision.

**N5 (non-blocking, disclosed).** Legacy `PUT/DELETE /activity/comment` keep `deferApiKeyCapability` while the controller checks authorship only, so a read-scoped key owned by the comment's author can still edit or delete it when strict enforcement is off. Pre-existing; the strict clamp covers it when on. Deferral is acceptable for this PR.

**N6 (informational).** `isCustomerPrincipal` adds two queries per guarded request, and the person lookup is not workspace-scoped; unchanged from round 1.

No blocking findings.

## Out-of-scope confirmation
- Labels, time entries: workspace-scoped by declaration (N4).
- Project-scope routes: workspace reach, disclosed (N3). Reads and updates that I probed 404; create does not.
- Activity-comment key deferral: pre-existing and bounded (N5).
- Legacy task bulk is NOT correctly out of scope in effect (N1).

## Residual risk
Impersonation and instance-admin credentials not probed. Strict key enforcement mode not exercised. Label/time-entry writes not probed. Image build and boot not run. I ran 82 relevant integration files, not the full 188. This review does not replace the exact-head GPT-6 Sol security review (security-scope paths changed).

## Verdict
**APPROVE** at 6be2c97d10e0bb539b7275c0f8c78f39479a5103, with N1 to be filed before the class is declared closed.
<!-- END REPORT (sha256 25e95d1db2bbc43e1d832fdc535d62f8d5de5bba5a3edb8cd7a723e272325e3c) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/712-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 cbc346aad1ac62e141b0fcf76fec55743d73315ff1fcd27e55538e49097e08f9) -->
# PR #712 ordinary review B (design, structure, maintainability, fixture regression)

- Model: Claude Sonnet 5.5 (`claude-sonnet-5-5`), fresh independent context, reviewer B. Did not author, direct or remediate the change.
- **Reviewed head:** 6be2c97d10e0bb539b7275c0f8c78f39479a5103
- Base: origin/main f0964fd5d0b63634e2d51e440713cfc1571956f1 (merge base equals it)
- Scratch checkout: detached worktree at the exact head, removed afterwards. Branch not edited, nothing pushed or commented.
- Scope: design, structure, maintainability and fixture regression risk. Route-by-route behaviour was reviewer A's and was not redone.

## Files examined

Source: `apps/api/src/work-item/require-work-item-reach.ts`, `attachment/require-attachment-reach.ts`, `utils/reach-mark.ts`, `utils/assert-work-item-project-reach.ts`, `utils/is-customer-principal.ts`, `utils/has-project-reach.ts`, `utils/workspace-access-middleware.ts`, `approval/index.ts`, `task-relation/index.ts`, `activity/index.ts`, `comment/index.ts`, `task/index.ts` (diff), `work-item/index.ts` (search middleware, call sites).
Tests: `tests/permissions/work-item-reach-guard.test.ts`, `tests/api-integration/helpers/fixtures.ts`, `helpers/reach-world.ts`, and the diffs of these changed files: work-item-comment, work-item-transition, work-item-assign, work-item-unassign, task-update-concurrency, work-item-list-sort-pagination, authorization-boundaries, nul-byte-param-sweep, node-server-websocket, project-soft-delete-freeze, project-archive-freeze-legacy, workspace-rbac (12 files sampled). Grep over all 56 changed files for removed assertions, removed test declarations and new skips.
Docs read: `docs/01-architecture/rbac.md`, `docs/01-architecture/api-design.md`, `docs/04-engineering/testing-strategy.md`. The PR changes no docs.
Registry probes (temporary test files in the scratch copy, deleted): count of policies by scope and reach, the work-item routes without a guard row, behavioural-test coverage of the guard's route set.

## Commands run (all on the exact head, scratch copy)

| Command | Result |
| --- | --- |
| `pnpm test:permissions` | 15 files, 94 tests passed |
| `pnpm check:route-policy` | passed (5/5 tasks) |
| `pnpm typecheck --force` | 9/9 tasks successful, no TS errors |
| `pnpm lint:ci` | exit 0 (208 warnings, 1 info, none new errors) |
| Full integration, `CI=true`, serialized (maxWorkers 1, fileParallelism off, Testcontainers Postgres 18) | Run 3: **189 files / 2464 tests passed**. Runs 1 and 2 each had one intermittent infrastructure failure, see F5 |
| Guard mutation A: new `POST /api/work-items/{key}/mut-newroute` with a work_item/required policy and no middleware | guard failed: "no requireWorkItemReach() and no reasoned exemption" |
| Guard mutation B: existing route opted out with a blank reason | guard failed: "workspace-only reach without a stated reason" |

Mutations were reverted with `git checkout`. Containers: only the Testcontainers Postgres and ryuk instances my runs started (the `taskdesk-*` containers were not touched).

## Findings

### Middleware design (focus 1)

The default is project reach, and opting out requires a reason that the guard checks. That is hard to misuse by accident. The type is a union, so `requireProjectReach: false` without `workspaceReachOnlyReason` is a compile error as well as a guard failure. The mark is a `Symbol.for` property on the middleware function, set at construction, so it cannot drift from the config the middleware actually runs. The 404 on out-of-reach, 403 for in-reach without capability, customer 403 and `deferApiKeyCapability` semantics are consistent across `requireWorkItemReach`, `requireAttachmentReach`, `workspaceAccess.*` and `assertWorkItemProjectReach`.

**F1 (non-blocking). The mark is self-attested in four hand-built places.** `search` (`work-item/index.ts:276-293`), `approvalRequestReach` (`approval/index.ts:~176-187`), and `scopeToSourceTask` and `scopeToRelation` (`task-relation/index.ts:~202-207`) each attach the symbol with a literal `{ projectReach: true }` through a copy-pasted `Object.assign`. Nothing ties the claim to what the function does. `approvalRequestReach` claims project reach but skips it for customer-side callers and hands them to the handler. The search entry honestly states workspace-only with a reason. The guard cannot detect a wrapper that claims true and does not enforce it. Behavioural tests (`work-item-project-reach*.test.ts`, `legacy-task-project-reach.test.ts`) are what backstop that. Suggest a single `markReach(fn, mark)` helper in `utils/reach-mark.ts` instead of four open-coded symbol assignments, so a future change to the mark shape has one edit point.

**F2 (non-blocking, nit). Option type accepts no-op flags on the opt-out branch.** `WorkItemReachOptions` (`require-work-item-reach.ts:64-87`) allows `deferApiKeyCapability` and `deferCapability` together with `requireProjectReach: false`, where they do nothing. Also two consecutive JSDoc blocks sit above the type (lines 18-54 and 55-63): the original long `requireWorkItemReach` doc is now detached from the function it describes (function at line 91 has no doc). Move the long block to the function.

**F3 (non-blocking, nit). Opt-out through the middleware is unused.** The only workspace-only entry today is the hand-built search mark. `requireWorkItemReach(..., { requireProjectReach: false, ... })` has no real caller; its only exercise is the guard's unit cases. That is fine as an extension point, but it means the "reasoned opt-out" path of the real middleware factories is covered only by the synthetic test.

**F4 (non-blocking, performance). Per-request overhead.** Every reach-checked request now also runs `isCustomerPrincipal` (one or two extra queries, `utils/is-customer-principal.ts`) plus a second workspace lookup in `assertWorkItemProjectReach`, and task-relation reads the source task twice. Acceptable for correctness; worth noting if the work-item hot path is perf-gated (G11 headroom is thin per #711). Not measured.

### Structural guard (focus 2)

The guard iterates every registry entry that is a capability policy with `scope === "work_item"` and `reach === "required"`: 57 routes. A route in that set missing from the router, or lacking a mark, or opted out without a reason, fails (both mutations above). Stale and contradictory exemptions fail. The pure `findReachProblems` has its own negative unit tests, so it is not vacuous, and the real-router test pins 12 named routes and a floor of 50. The three allow-listed rows (`GET /api/work-items/{key}/approvals`, `POST /api/approvals/{id}/decide`, `POST /api/approvals/{id}/withdraw`) carry specific reasons and are reasonable: the approval domain resolves reach through row evidence and decides named-approver predicates in the handler.

**F6 (non-blocking, scope limit). The guard follows the declared policy, not the real surface.** A route is only checked if its registry row says `work_item` scope. Routes that address a work item or task but are declared workspace or project scope are invisible to it. From the registry on this head:
- workspace/required and addressing a task: `PATCH /api/task/bulk` (declared "no single resource"), `POST /api/work-items/bulk` (this PR adds `bulk-reach.ts`, so it is handled in the handler), `GET/PUT/DELETE /api/label/task/{taskId}` and `/api/label/{id}/task`, `GET /api/time-entry/task/{taskId}`, `PUT /api/time-entry/{id}`, `GET /api/asset/{id}`.
- project/required with item-ish paths: `POST /api/projects/{projectId}/work-items`, `GET /api/projects/{projectId}/work-items`, `POST /api/task/{projectId}`, `POST /api/task/import/{projectId}`, `GET /api/task/tasks/{projectId}`, `GET /api/task/export/{projectId}`.
Also, a mark on any handler in the chain satisfies the guard, so a route could carry a project-scope `workspaceAccess.fromProject(..., { requireProjectReach: true })` mark and pass without resolving the item's own row; the guard checks presence of a claim, not that it addresses the work item. These are guard-design limits, not defects in this PR, and the PR text says item-scoped only.

### Fixtures (focus 3)

Sampled 12 changed test files in full diff. Findings:
- No test deleted, renamed or skipped: zero removed `it(`/`describe(` lines, zero added `.skip`/`.todo`/`.only`, and zero removed `expect`/status/`toBe` lines across the 56 changed files. Every modified file's assertions are byte-identical to base. The added bulk is new files (`reach-world.ts`, three reach test files, the guard) and `grantProject*` calls.
- Each grant I sampled is needed: the route now requires project reach plus the registered capability, and the fixture previously relied on workspace-only reach. Replacing `grantProjectRole(["project:read","work_item:read"])` with the wider set is required because item write routes now check the write capability at project level.
- The deliberate negative cases are handled: `work-item-comment` drops the helper-given membership for the out-of-reach actor and re-inserts a specific one (`work-item-comment.test.ts:~366-410`); the AS-5 "not on roster" test uses a person with no user and no membership; viewers get read-only, so viewer 403s remain real.
- The `onConflictDoNothing()` additions in `addPersonOnRoster`, `rosterPersonOnProject`, `makeAssigneePerson` and the transition test only avoid a duplicate when the new helper already created the membership. In the transition test the role is rewritten explicitly. I found no case where a negative assertion now passes for a different reason.

**F7 (non-blocking). The blanket fixture grant is wider than the role it stands for.** `WORK_ITEM_PROJECT_CAPABILITIES` (`helpers/fixtures.ts`, ~line 265) includes `work_item:delete`, `work_item:assign`, `work_item:transition`, `work_item:rank`, `comment:update_any` and `comment:delete_any`, and `grantProjectAccessForWorkspaceRole` / `grantProjectAccessToWorkspaceMembers` give it to every non-viewer, including `member`. In real rbac `member` does not hold assign or `comment:*_any`. Consequence: in the legacy-fixture tests the project-capability layer never refuses a member, so tests such as `work-item-assign` "a member assigning SOMEONE ELSE is refused 403" are now refused only by the legacy workspace gate, not by project authority, and a future move to the strict gate would not be exercised there. The per-route in-reach-without-capability 403 is covered by the new matrix-driven tests (`work-item-project-reach-credentials.test.ts`, `legacy-task-project-reach.test.ts`), so there is no coverage hole, but the fixture hides a source of truth. Recommend role-faithful sets (member, lead, admin) keyed on the role string, or at least a comment on the helper.

**F8 (non-blocking, nit). A few grants look unneeded.** `authorization-boundaries.test.ts:~188-191` adds the grant inside "the removed public project route" test, which calls a deleted route and cannot depend on project reach. It reads like mechanical insertion. Harmless but noise.

### Spec and docs (focus 4)

None of this PR's contract is documented. Recommended exact edits (orchestrator-owned control-plane and spec files, so recommendations only):
1. `docs/04-engineering/testing-strategy.md`, after the `matrix.test.ts` paragraph (around line 125): add an entry for `work-item-reach-guard.test.ts` ("fails any item-scoped `reach: required` route whose middleware does not resolve project reach, or opts out without a stated reason"), and state plainly that `matrix.test.ts` checks the declared policy and fixture, not the middleware, which is why this defect passed it. The current text says the reach pass proves "the same call succeeds or 404".
2. `docs/01-architecture/rbac.md`, section "The customer role is special" (after the table, ~line 460): add "On the agent API, customers receive `403` on every item-scoped work-item and legacy task route even inside reach; portal routes are their only surface. `POST /api/work-items/search` answers `403` to a customer principal."
3. `docs/01-architecture/rbac.md`, Reach section (~line 500, near "The 404 is constant-shape"): add "Item-scoped routes resolve project reach by default; an out-of-reach item answers the same `404` as a missing one, and in-reach without the capability answers `403`. Workspace-only reach is an explicit opt-out that must state its reason and is checked by `work-item-reach-guard.test.ts`."
4. `docs/01-architecture/api-design.md`, search v1 section (~line 689-697): append the customer `403` sentence, and fix the status table row for 403 (line 864) to mention customers on agent routes.
5. Fix a wrong cross-reference: `tests/permissions/work-item-reach-guard.test.ts:20` cites "#708". #708 is "Legacy permission gate lets workspace members create projects", a different defect. (non-blocking, **F9**)
6. `docs/07-planning/decision-log.md`: append an entry (orchestrator) recording the reach-by-default convention and the follow-up scope.

### Same-class gaps (focus 5)

Confirmed real and not covered here: `PATCH /api/task/bulk` still ignores project reach for admin-tier callers (reviewer A probed it; the policy is declared workspace scope with a "no single resource" exemption, so neither the guard nor the matrix sees it). `POST /api/projects/{id}/work-items` and the other project-scope routes listed under F6 are likewise declared at project scope and untouched. Labels and time entries stay workspace-scoped by declaration.

**F10 (non-blocking, process). Deferral is not yet recorded anywhere durable.** The PR is a draft whose body is "Draft: body to follow."; `gh` search found no open issue for task-bulk, project-scope item routes, or label/time-entry reach (only #205, soft-deleted one-hop resources, is adjacent). The code comments and tests do not mark these as deferred either. A follow-up is needed: please file one issue (task bulk plus project-scope item routes plus the label/time-entry/asset policy decision) and cite it in the PR's `## Not done` section so the gap is tracked and the class "item-scoped" is not read as closed.

### Test and CI stability

**F5 (non-blocking, but watch). Two intermittent failures in full serialized runs, neither reproducible, both outside changed behaviour.**
- Run 1: `workspace-rbac.test.ts > allows a member to create a project` failed with `deadlock detected` inside `resetTestDatabase` TRUNCATE (`helpers/database.ts:128-132`); the file passed 49/49 twice in isolation.
- Run 2: `leader-lock.test.ts` (unmodified) failed at `ensureTestDatabaseMigrated` with "Applied membership cutover has an incomplete grant projection: 1 membership row(s) have no grant" (`migrate-membership-provenance.ts:507`). The cause is state left by whichever file ran just before it (vitest reorders by prior results). `grantProjectRole` (unchanged helper) inserts `membership` rows without grant rows, and this PR makes roughly 20 more files do that, so the chance that a file ends its run with an ungranted membership row has risen. Run 3, the same head with no extra load, passed 189/189 files, 2464/2464 tests. I did not reproduce the failure on the base, so I cannot say it is new, only that exposure is wider. If it appears in CI, the fix is for the `grantProject*` helpers (or `resetTestDatabase` in an `afterAll`) to leave no ungranted rows.

## Residual risk

- Behaviour of individual routes, impersonation and instance-admin credentials, strict key-enforcement mode, and label/time-entry writes were not probed (reviewer A's lane).
- The image build and container boot were not run.
- I did not run the integration suite on the base for the flake comparison.
- Typecheck was run with `--force`; lint warnings (208) were not compared to base.
- This review does not replace the exact-head GPT-6 Sol security review (auth and permissions paths changed).

## Verdict

**APPROVE**, with the non-blocking items above. No blocking defect found: the structural guard demonstrably catches both a forgotten and a silently opted-out route, no assertion or test was weakened, no test was removed or skipped, and the full serialized suite is green at the exact head (3rd run, 189 files / 2464 tests). Before merge I recommend: fill the PR body including a `## Not done` that names the task-bulk and project-scope routes, file the follow-up issue (F10), and correct the #708 citation (F9). Docs edits above go with the orchestrator's control-plane pass.
<!-- END REPORT (sha256 cbc346aad1ac62e141b0fcf76fec55743d73315ff1fcd27e55538e49097e08f9) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/712-security-opus.md; Claude Opus 5.5; sha256 1dd837cb8bf6723a19cfc50f2bfb7ed45a9dc31dfb5e82fc4b095239586e6295) -->
# PR #712 security review (project reach on item-scoped work-item, attachment, approval, search and legacy task routes)

**Model:** Claude Opus 5.5 (`claude-opus-5-5`). Fresh, independent context. I did not author, direct or remediate this change.
**Role:** independent security review requested by the orchestrator. It does not replace the GPT-6 Sol gate (CLAUDE.md).

**Reviewed head:** aec692e94d681ca3aae1172f88615c42c1597f6b
**Merge base:** 66565b2c2eade2378b5a1d1fd518054b2e298238 (= origin/main). `git ls-remote` at review time: refs/heads/main = 66565b2c, refs/heads/codex/work-item-write-project-reach = aec692e9. The head is a merge commit: parent 1 = 1143b399 (branch), parent 2 = 66565b2c (main, #710). Diff reviewed as `git diff 66565b2c aec692e9` (59 files, +2530/-255).
**Scratch copies:** detached worktrees `/Users/heinthura/.codex/worktrees/review-712-sec` (full suite) and `review-712-sec-mut` (mutations and probes), both at the head. Both removed afterwards. No push, comment or merge. The author worktree was not modified. Docker: only containers created by my Testcontainers runs were removed, by exact ID; the `taskdesk-*` containers were not touched.

## Surfaces examined

- Reach middleware: `work-item/require-work-item-reach.ts`, `attachment/require-attachment-reach.ts`, `work-item/require-comment-reach.ts`, `utils/workspace-access-middleware.ts` (diff, reach block, customer refusal, not-found text), `utils/assert-work-item-project-reach.ts`, `utils/reach-mark.ts`, `utils/is-customer-principal.ts`, `utils/has-project-reach.ts` (`resolveCallerIdentity`, `projectReadDecision`, the new `orSelfTarget`/`orOwner` branch acceptance).
- Downstream key-aware gates for every `deferApiKeyCapability` route: `utils/require-workspace-capability.ts` (`requireWorkspaceCapability`, `assertCallerHasCapability`, `...OrSelf`, `...OrOwner`), `utils/require-workspace-permission.ts`, `utils/require-api-key-permission-scope.ts`, `work-item/controllers/create-comment.ts`. `permissions/resolve-identity.ts` (key clamp, instance-admin reach `all`, customer branch). `utils/validate-workspace-access.ts` (instance-admin bypass).
- Routes: `work-item/index.ts` (all item routes, bulk, search refusal), `work-item/bulk-reach.ts`, `work-item/controllers/bulk-work-items.ts`, `rank-work-item.ts`, `attachment/index.ts`, `approval/index.ts`, `task/index.ts`, `comment/index.ts`, `activity/index.ts`, `task-relation/index.ts` and its controllers (`create-task-relation.ts`, `get-task-relations.ts`).
- `capabilities/controllers/get-capabilities.ts` and `tests/api-integration/capabilities-scope.test.ts` (the #710 customer pin). `packages/permissions/src/roles.ts` (customer capabilities).
- Guard: `tests/permissions/work-item-reach-guard.test.ts`. Tests: `helpers/reach-world.ts`, `helpers/fixtures.ts` (new grant helpers), `work-item-project-reach*.test.ts`, `legacy-task-project-reach.test.ts`.
- Fixture diffs spot-checked (8 files): work-item-assign, work-item-unassign, attachment, comment, workspace-rbac, task-update-concurrency, work-item-transition, project-soft-delete-freeze. Plus a grep over every changed integration file for removed `expect`/status/`it(`/`describe(` lines and added `.skip`/`.only`/`.todo`.
- Prior evidence: 710-security-opus.md (F1, F2), 712-ordinary-a-sonnet.md, 712-6be2-ordinary-a-sonnet.md, 712-ordinary-b-sonnet.md, wi-reach-fix-impl-sonnet.md.

## Tests and probes run (all at aec692e9)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile`; `turbo build --filter=@taskdesk/api^...` | ok |
| Full integration suite, `CI=true`, serialized (`fileParallelism:false`, `maxWorkers:1`, Testcontainers Postgres) | **189 files / 2491 tests passed**, exit 0, 754 s (first run, no flakes) |
| `pnpm test:permissions` | 15 files / 94 tests passed |
| `pnpm check:route-policy` | ok (5/5 tasks) |
| `pnpm check:openapi` | ok, 282 operations |
| Probe file `712-security-opus-probes.test.ts` (saved beside this report) | 11/11 passed; observations in `712-security-opus-probes-output.txt` |
| Strict-mode probe file `712-security-opus-strict-probes.test.ts` (`TASKDESK_POLICY_ENFORCE` = every policy file, same list as `strict-runtime-enforcement.test.ts`) | 2/2 passed; observations prefixed `STRICT` in the same output file |
| Guard mutations M1-M5 and behavioural re-runs | see "Guard" below |

Raw logs: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/712-sec-work/`.

### 1. Is the class closed on the in-scope routes?

Out-of-reach caller = same-workspace admin with no project membership (`outsiderAdmin`).

| Route class | Out of reach | Missing id | Byte-identical | Write |
| --- | --- | --- | --- | --- |
| `PATCH /work-items/{key}` | 404 `Work item not found` | same | yes | none |
| `POST /work-items/{key}/approvals`, malformed body | 404 | 404 | yes | none |
| `DELETE /attachments/{id}` | 404 `Attachment not found` | same | yes | none |
| `PATCH /comments/{id}` | 404 `Comment not found` | same | yes | none |
| `PUT /task/priority/{id}` (legacy) | 404 `Task not found` | same | yes | none |
| `DELETE /task/{id}` (legacy) | 404 `Task not found` | same | yes | none |
| `DELETE /task-relation/{id}` | 404 `Task relation not found` | same | yes | none |
| `POST /work-items/bulk` (delete, real + missing key) | per-item `Work item not found` for both | | yes | none |

The rest of the route table (12 work-item routes, attachment complete, comment DELETE, 21 legacy routes) is covered per route by the PR's own tables, which pass in the full run. The M4/M5 mutations show that those tables fail when reach is weakened.

- **Reachable without capability:** `readerLead` (workspace lead, project read-only) gets 403 on PATCH, rank, DELETE, assign and the legacy write. The PR tables cover this per route.
- **Customers:**
  - customer-role member without a project role: 404;
  - with a project role: 403 on item routes, search and bulk;
  - both match the matrix.
  - A customer-side person on a customer-portal session gets 401 on the agent host.
- **Search:** customer 403; outsider 200 with no foreign title; project member 200 with the title.

### 2. Credentials

- **API keys.** I traced every `deferApiKeyCapability` route to its next gate. Each one intersects the key scope, with one exception:
  - Work-item routes: `requireWorkspaceCapability` or the handler's `assertCallerHasCapability*` with `c.get("apiKey")`.
  - Attachment, legacy task, legacy comment, activity create/comment and task-relation: `requireWorkspacePermission`, which calls `apiKeyHasPermissionScope` first.
  - **The exception** is `PUT`/`DELETE /api/activity/comment` (`activity/index.ts:113`, `:142`). There is no downstream gate there (see F3).
  - Outsider-owned full-scope key: 404. Read-scoped and unscoped keys of a capable member: 403. All are pinned by the PR tables.
  - Author keys on `PATCH /comments/{id}` (read-scoped or full): 403. That route fails closed for every key by design (F6).
- **Impersonation.** Impersonating the outsider admin gives 404 on PATCH and on the legacy write, and nothing is written. Impersonating the project member gives 200. Reach follows the impersonated user.
- **Instance admin.**
  - Not a workspace member: 403 on PATCH, rank, GET, legacy PUT and legacy GET, by session and by full-scope key, with nothing written. The matrix declares 403 for instance_admin. Instance reach is `all` (resolve-identity KNOWN GAP 4), so 403 rather than 404 is expected.
  - Also a workspace `member` with no project role: 200 on PATCH, rank and GET, and the legacy GET returns the task. This follows rbac.md Reach step 1 (instance admin has global reach) and is not a defect of this PR. It is noted under residual risk.
- **Strict enforcement on** (`STRICT S1`):
  - outsiders: 404;
  - readerLead: 403;
  - customer with a role: 403; customer without one: 404;
  - outsider full key: 404;
  - member read-scoped key: 403 `Insufficient API key scope`;
  - member update-scoped key: 200;
  - author read-scoped key on `PUT`/`DELETE /activity/comment`: **403**; the comment is unchanged.
  - The strict layer closes F3.

### 3. Activity comments (the claimed residual)

Confirmed with strict enforcement off. A read-scoped key (`task/work_item/project: read`) owned by the comment's author got **200** on `PUT /api/activity/comment`, and the content changed. It then got **200** on `DELETE`. With strict enforcement on, both return 403. See F3 for the classification.

### 4. Guard

- **M1** (`POST /work-items/{key}/rank` → `requireProjectReach:false`, no reason): the guard **fails** and names the route.
- **M2** (`DELETE /attachments/{id}`, same mutation): the guard **fails**.
- **M3** (`PUT /task/status/{id}` → `requireProjectReach:false`): the guard **fails**.
- **M4** (rank → reasoned opt-out `workspaceReachOnlyReason:"mutation M4"`):
  - The guard **passes**, by design.
  - The behavioural tables fail: 4 tests in `work-item-project-reach*` (outsider 404, customer, reader 403, outsider key).
- **M5** (enforcement disabled inside `requireWorkItemReach`, mark left as `projectReach:true`):
  - The guard **passes**.
  - `work-item-project-reach*` fails: **48 of 102 tests**.

So yes, the guard can be satisfied by a marker without real enforcement. `markReach` is exported and self-attested. Search, the approval wrapper and the two task-relation scopers set their mark by hand. The guard proves declaration, not behaviour. The behavioural tables are what catch a lying mark. M4 and M5 show that they do for the work-item middleware. For the hand-marked wrappers, the backstop is the legacy table, the approval rows and the search test. See F5.

### 5. Fixture grants

- No `expect`, status, `it(` or `describe(` line was removed in any changed integration file, and no `.skip`/`.only`/`.todo` was added.
- The 8 sampled files change only setup: they add `grantWorkItemProjectAccess` / `grantProjectAccessForWorkspaceRole` / `grantProjectAccessToWorkspaceMembers`, and add `onConflictDoNothing()` on roster rows.
- The `onConflictDoNothing()` rows in work-item-assign and work-item-unassign are assignee-roster roles with no capabilities. When the helper already created a membership, the broader helper role wins. That only matters if that person is also the refused caller. I found no such negative test.
  - In work-item-transition the role's capabilities are rewritten explicitly.
- Viewers get read-only, so viewer 403s remain real.
- `grantProjectAccessToWorkspaceMembers` also gives `customer` members the full item set. The isCustomerPrincipal refusal still produces the 403, so customer negatives stay meaningful.
- I agree with ordinary review B's F7: the blanket set is wider than the `member` role. Project-capability refusals are therefore exercised in the dedicated tables, not in the legacy files. No negative test was weakened into passing for a different reason.

### 6. Merge with #710

- The merge commit only brings #710 into the branch.
- The rank route now uses the default project reach plus `deferApiKeyCapability` and refuses customer principals.
- The #710 states route and the capability flags are unaffected. `capabilities-scope.test.ts` still pins customer `rankTasks:true` and passes in the full run.
- Probe P9: a customer-role member with a project role gets `/api/capabilities` → `rankTasks:true` and `createPublicComments:true`, while `POST /rank` → 403.
- The mismatch fails closed: the server refuses. So it is not a security defect. It is a UI-contract defect: the UI advertises an action the server always refuses. See F7 for the recommendation.

## Findings

**F1 (non-blocking for #712; pre-existing; medium; file now).** Task relations ignore the **target** task's project reach.

- **What the probe showed (P6):**
  - A project member who reaches only project A linked an A task to a task in project B, which they cannot reach (`GET /api/task/{B-task}` → 404). The response was **200** and the relation row was written.
  - A missing target gives 404 `Target task not found`, so this is also an existence oracle.
  - `GET /api/task-relation/{A-task}` then returned the B task's summary (title, status, priority, number, assignee name).
  - The read leak does not need the attacker to create anything. Any cross-project relation created by someone who reaches both projects exposes the hidden side to everyone who reaches only the other side.
- **Where:**
  - `task-relation/controllers/create-task-relation.ts:63-82` checks only that the target is in the same workspace.
  - `task-relation/controllers/get-task-relations.ts:48-68` filters linked tasks by workspace only.
  - The new reach (`task-relation/index.ts:99`, `:156`) covers the source task only.
- **Why non-blocking:**
  - It existed before this PR, with weaker preconditions (any workspace member).
  - The PR does not widen it.
  - Task ids are cuid2, so the write half needs a known id.
- **Fix:** check target reach in create (404 with the missing-target text), and drop or redact out-of-reach linked tasks in GET. Add this to #720, or a new security issue, before the class is called closed.

**F2 (non-blocking; pre-existing for bulk; medium).** `POST /api/work-items/bulk` checks per-item **reach** but not the item-level **project capability** that the single-item routes now enforce.

- **What the probe showed (P10):**
  - `readerLead` (workspace `lead`, project role with only `project:read`/`work_item:read`) gets 403 on single `DELETE /work-items/{key}` and on `POST .../assign`.
  - The same caller got **200** from bulk `assign` and bulk `delete` on the same project, and both writes landed.
  - A workspace admin with a read-only project role behaves the same way.
- **Where:**
  - `work-item/bulk-reach.ts:48-55` returns `reaches(...)` only.
  - The capability is the workspace-role check at `work-item/index.ts:1404-1409`.
- **The comment is wrong:** the doc comment at `controllers/bulk-work-items.ts:85-89` claims the same answer a single-item call gets. That is inaccurate.
- **Why non-blocking:** before this PR, bulk had no reach check at all, so the PR strictly narrows it. The bulk policy is declared at workspace scope.
- **Fix:** evaluate `can(identity, op capability, "work_item", target)` per item, as `projectReadDecision` does, or at least correct the comment and track the gap under #720.

**F3 (non-blocking; pre-existing; low-medium; follow-up).** Legacy `PUT`/`DELETE /api/activity/comment` (`activity/index.ts:113`, `:142`) defer key capability to a controller that checks authorship only.

- The residual is confirmed: an author-owned read-scoped key edits and deletes the comment when strict enforcement is off. Strict enforcement closes it (403).
- **Not blocking:**
  - It is pre-existing; before this PR the routes had workspace reach only and no key check.
  - The PR adds project reach and does not widen it.
  - The impact is bounded to the key owner's own comments.
- **Cheap fix** (either one would do):
  - drop `deferApiKeyCapability` on these two routes, so keys fail closed as on `PATCH /comments/{id}`;
  - add a key-scope check for `comment:update_own` / `comment:delete_own`.
- It could be done in this PR, but it is not required. If it is deferred, the deferral should be tracked as an issue (it is not in #720's list as I read it).

**F4 (non-blocking; low; confirms ordinary A's N2).** `POST /work-items/{key}/approvals` skips reach for customer-side persons (`approval/index.ts:178`).

- Constructed state, a customer-side person on an agent-portal session: malformed body gives 400 (validation text) for a real key and 404 for a missing key, which is an existence oracle.
- On the real customer-portal session the agent host answers 401 for both. Practical exposure is low.

**F5 (non-blocking; design limit).** The guard checks self-attested marks. It does not check what the middleware does, which middleware it is on, or the order.

- `markReach` (`utils/reach-mark.ts`) lets any wrapper claim `projectReach:true`.
- `approvalRequestReach` claims it while skipping customer-side callers (F4).
- The scopers in `task-relation/index.ts:199-200` claim it while not covering the target (F1).
- M5 shows that the behavioural tables are the real backstop for the main middleware.
- **Suggestion:** have the guard additionally assert that every route in its set appears in a behavioural table (a route-key list exported from `reach-world.ts` and the legacy test), so a hand-marked route without a behavioural row fails.

**F6 (informational).** `PATCH`/`DELETE /comments/{id}` now refuse every API key, including a full-scope key owned by the author (403). This fails closed and is intended (the controllers never checked key scope). It is a behaviour change for integrations that edited comments by key. It should be noted in the PR body.

**F7 (non-blocking; recommendation).** The customer `rankTasks` (and `createPublicComments`) flags are true while the agent routes refuse customers.

- **Recommendation:** do it in this PR, since it is small and the #710 test comment asks for it at this point.
  - Return `rankTasks:false` (and the comment flags false) for `isCustomerPrincipal`, which is the predicate the fixed routes use.
  - Update the pin in `capabilities-scope.test.ts:213`.
- If it is deferred, track it with #720. It is not a security defect.

**F8 (informational; pre-existing).** Under strict enforcement, `POST /api/work-items/bulk` answers 500 for the callers I tried (outsider admin, readerLead). It does the same on base 66565b2c (probe S2 run against base source). It fails closed. It is not from this PR, but strict mode cannot be turned on for the work-item policy file without fixing it.

No blocking finding.

## Residual risk

- **Instance admin.** An instance admin who is also a workspace member reaches every project in that workspace (rbac.md Reach step 1). This is by design, but it means "project membership" is not a boundary for those accounts.
- **Out of scope here, as filed:**
  - project-scope routes (#720), including `POST /projects/{id}/work-items` (workspace reach only when strict is off);
  - legacy `PATCH /task/bulk` (#720);
  - labels and time entries (#720);
  - the legacy create-project gate (#708).
- **Not probed:**
  - realtime/websocket fan-out of item events to out-of-reach members;
  - attachment download URLs already minted before reach was lost;
  - label and time-entry writes.
- **Not run:** image build and container boot.
- This review does not replace the exact-head GPT-6 Sol security review.

## Verdict

**CLEAR** at aec692e94d681ca3aae1172f88615c42c1597f6b.

- **What holds:** on every route in the guard's set I probed, and in the PR's own tables:
  - out-of-reach callers get a 404 byte-identical to a missing id, with no write and no row;
  - reachable callers without the capability get 403;
  - customers get the matrix answer;
  - every deferred key route except the two activity-comment routes has a key-aware downstream gate;
  - impersonation follows the impersonated user;
  - strict enforcement agrees.
- **The guard** catches a removed or unreasoned opt-out for each class. Its marker-only blind spot is backstopped by the behavioural tables.
- **Before calling the class closed:** F1 and F2 are same-class, pre-existing gaps that this PR does not widen. They should be filed (or added to #720) before the class is called closed. F3 and F7 are cheap and could land here.
<!-- END REPORT (sha256 1dd837cb8bf6723a19cfc50f2bfb7ed45a9dc31dfb5e82fc4b095239586e6295) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/712-edd4-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 a93c645c6ee1cca3d4343e74701541f22aea84d7ccd6e6a30239186de08d14b5) -->
# PR #712 delta ordinary review A, round 3 (aec692e9..edd4f91a)

**Model:** Claude Sonnet 5.5, reviewer A. Fresh, independent context. I did not author, direct or remediate this change.
**Reviewed head:** edd4f91a85a9edd220ecc249febb0ab3f79da8b9
**Base / delta from:** aec692e9 (one commit: edd4f91a "apply per-row reach and capability to multi-row routes"). The earlier reviewed head was 6be2c97d.
**Scratch copy:** detached worktree /Users/heinthura/.codex/worktrees/review-712-a3; removed afterwards. No push, comment or merge. Author worktree untouched.

## Files examined
`utils/caller-reach.ts`, `work-item/bulk-reach.ts`, `controllers/bulk-work-items.ts`, `work-item/index.ts` (bulk handler), `task-relation/index.ts` and its create/list controllers, `activity/index.ts`, `capabilities/controllers/get-capabilities.ts`, `tests/permissions/work-item-reach-guard.test.ts`, `tests/api-integration/helpers/reach-route-keys.ts`, `work-item-project-reach-reads.test.ts`, `legacy-task-project-reach.test.ts`, the changed rows in `capabilities-scope` and `strict-runtime-enforcement`, and the web consumers.

## Commands run (at edd4f91a)
| Command | Result |
| --- | --- |
| install; `turbo build --filter=@taskdesk/api^...` | ok |
| `pnpm test:permissions` | 15 files / 95 tests passed |
| `pnpm check:route-policy` | ok (5/5 tasks) |
| `pnpm check:openapi` | ok, 282 operations |
| Serialized integration, CI=true: approval-, attachment, capabilities-scope, comment, task-, work-item-, global-search, portal-identity, intake-attachment, project-, multi-role, move-task, label-, nul-byte, authorization-boundaries, workspace-rbac, strict-runtime, activity, legacy | **84 files / 1354 tests passed** |
| Round-1 and round-2 probes re-run | 43/43 pass; see N1/N3 status below |
| New round-3 probe (relations and bulk; my own, 2 tests) | all assertions held, details below |
| Mutation 1: drop `GET /api/work-items/{key}/sla` from `READ_ROUTE_KEYS` | CAUGHT: guard fails ("marked but no behavioural test row") and the reads table test fails |
| Mutation 2: relation list stops filtering unreachable tasks | CAUGHT: `legacy-task-project-reach` "listing relations omits a related task..." fails |
| Mutation 3: bulk per-item capability check removed | CAUGHT: "applies the operation's project capability per item" fails |
Sources restored after each mutation; tree clean. Docker: only Testcontainers containers; I removed none and did not touch `taskdesk-*`.

## Verification of the round-3 items
**F1 task relations (PASS).** Member of project A only, relation A to hidden B:
- list: the hidden task and its relation are absent (title not in the body); a same-project relation is still listed;
- create A to hidden B: 404 "Target task not found", byte-identical to a nonexistent target id;
- delete a relation whose far end is hidden: 404 "Task relation not found", row still present;
- a read-only lead: create 403, delete 403; an outsider: list 404;
- a member who holds update on both projects: create 200, list includes B, delete 200.
RH-4's hidden-relation count is not implemented, as stated.

**F2 bulk (PASS).**
- Read-only lead: assign and delete both report "Insufficient permissions" for the real key and "Work item not found" for a missing key.
- Outsider admin: the real and missing keys fail with the identical "Work item not found".
- Member of the project: delete succeeds.
- A key scoped `work_item:[read,assign]`: delete is refused 403 "Insufficient API key scope" (workspace gate first); assign succeeds. `callerReach.can()` returns true for keys by design, and the downstream gate decided correctly in both cases.

**F3 activity-comment keys (behaviour change, acceptable).** `PUT/DELETE /api/activity/comment` no longer defer key capability, so every key now gets 403, even a fully scoped key owned by the comment's author (before: 200 for an in-scope key). The only integration that relied on it is `strict-runtime-enforcement.test.ts`, updated to expect 403; no other suite depends on it (grep of `activity/comment` finds only that file, `comment.test.ts` and the reach tests, all passing). Consistent with `PATCH /comments/{id}`. Worth a release note: key-based clients lose edit/delete of legacy activity comments. Session callers are unaffected.

**F7 flags (PASS, no web consumer breaks).** Grep of `apps/web/src`: `rankTasks` has no non-test consumer. `createPublicComments` is read only by `use-workspace-permission.ts` (`canCreatePublicComments`), used in `work-item-activity.tsx:173` to offer the "public" visibility. For a customer principal the UI now omits "public", matching the 403 the server gives. The hook tests mock the flag, so they are unaffected. The flags use the same `isCustomerPrincipal` predicate as the routes.

**F5 guard (PASS, non-vacuous).** Mutation 1 shows both the permissions guard and the table-equality integration test fail when a route is removed from a table list. The coverage check also flags stale rows and accepts reasoned exemptions (its unit test passes).

## Findings
**N1 (open, unchanged, non-blocking for this PR but must be filed).** Legacy `PATCH /api/task/bulk` (`workspaceAccess.fromTasks()`, workspace-scope policy) still ignores project reach: a same-workspace admin with no project role bulk-updated a task's priority in an unreachable project (200, row changed). Single-task GET and PUT return 404 for the same caller. Round 3 fixed bulk for work items and relation ends but not this legacy sibling. A member-role caller is stopped (403). Same defect class as the original F1.

**N3 (open, disclosed).** `POST /api/projects/{id}/work-items` by a same-workspace admin with no project role returns 200; project PATCH/PUT return 404. Needs its own PR.

**N7 (non-blocking, informational).** Bulk and relation capability checks pass `true` for API keys inside `callerReach.can()`; correctness relies on each caller's downstream key-aware gate. I verified this for bulk (both operations) by probe and for relation create and delete via the existing key rows, but the "key returns true" contract is not machine-enforced. Consider a comment or test row in the helper's own tests.

**N8 (non-blocking, informational).** The relation list now runs one reach decision per distinct related task (organisation lookups are cached per workspace in `callerReach`). A task with a very large relation fan-out costs one query-set per related task. No test pins a bound.

No blocking findings. N2, N4 and N6 from my earlier report are unchanged and not re-examined.

## Residual risk
Impersonation and instance-admin credentials not probed. Strict key enforcement mode not exercised beyond `strict-runtime-enforcement`. My round-3 probe file was deleted with the scratch worktree (not saved); the cases are those listed under F1 and F2 above and are covered in part by the new tests. Image build and boot not run. I ran 84 relevant integration files, not the full 190. This review does not replace the exact-head GPT-6 Sol security review.

## Verdict
**APPROVE** at edd4f91a85a9edd220ecc249febb0ab3f79da8b9. N1 remains the one same-class gap to file before the class is declared closed.
<!-- END REPORT (sha256 a93c645c6ee1cca3d4343e74701541f22aea84d7ccd6e6a30239186de08d14b5) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/712-edd4-security-rebind-opus.md; Claude Opus 5.5; sha256 65d3b4a7a7c274232f7f86e92f40263b3b25812e178cadbfa18102df9baea8a3) -->
# PR #712 security rebind at edd4f91a (round 3: F1, F2, F3, F5, F7)

**Model:** Claude Opus 5.5 (`claude-opus-5-5`). Fresh, independent context. I did not author, direct or remediate this change. My earlier CLEAR at aec692e9 is in `712-security-opus.md`; this report is a new rebind.
**Role:** independent security review requested by the orchestrator. It does not replace the GPT-6 Sol gate.

**Reviewed head:** edd4f91a85a9edd220ecc249febb0ab3f79da8b9
**Merge base:** 66565b2c2eade2378b5a1d1fd518054b2e298238. At review time `git ls-remote` gave refs/heads/main = 66565b2c (unchanged) and refs/heads/codex/work-item-write-project-reach = edd4f91a.
**Delta reviewed:** `git diff aec692e9 edd4f91a`. One commit, 17 files, +778/-146. The rest of the head was already reviewed at aec692e9 and is unchanged.
**Scratch copy:** detached worktree `/Users/heinthura/.codex/worktrees/review-712-edd4` at the head, removed afterwards. No push, comment or merge. The author worktree was not modified. Docker: only containers created by my runs were removed, by exact ID; the `taskdesk-*` containers were not touched.

## Surfaces examined

- **New helper:** `apps/api/src/utils/caller-reach.ts`.
- **Source delta:**
  - bulk: `work-item/bulk-reach.ts`, `work-item/controllers/bulk-work-items.ts`, `work-item/index.ts` (bulk handler);
  - task relations: `task-relation/index.ts`, `task-relation/controllers/create-task-relation.ts`, `get-task-relations.ts`;
  - activity comments: `activity/index.ts`;
  - capability flags: `capabilities/controllers/get-capabilities.ts`.
- **Test delta:**
  - `tests/api-integration/helpers/reach-route-keys.ts`, `helpers/reach-world.ts`;
  - `work-item-project-reach-reads.test.ts`, `work-item-project-reach.test.ts`, `legacy-task-project-reach.test.ts`;
  - `capabilities-scope.test.ts`, `strict-runtime-enforcement.test.ts`;
  - `tests/permissions/work-item-reach-guard.test.ts`.
- **Compared against:** `utils/has-project-reach.ts` (`resolveCallerIdentity`, `hasProjectReadCapability`, `projectReadDecision`), `utils/assert-work-item-project-reach.ts`, `utils/require-workspace-capability.ts`, `utils/require-workspace-permission.ts`.
- **Key issuance:** the API-key plugin config (`auth.ts:489`) and `@better-auth/api-key` 1.6.26. Line 737 of its `dist/index.mjs` refuses `permissions` from a client request with `SERVER_ONLY_PROPERTY`, and no `defaultPermissions` is configured. User-minted keys are therefore unscoped.

## Tests and probes (all at edd4f91a)

| Command | Result |
| --- | --- |
| install, `turbo build --filter=@taskdesk/api^...` | ok |
| Full integration suite, `CI=true`, serialized | Run twice. Both runs: **189/190 files, 2520 passed, 6 skipped (2526)**. The 6 skipped are all `leader-lock.test.ts`, whose `beforeAll` failed in setup (N4). Run alone, `leader-lock` passes 6/6. CI `integration - Postgres 18` is green at this head. |
| `pnpm test:permissions` | 15 files / 95 tests passed |
| `pnpm check:route-policy` | ok (5/5) |
| `pnpm check:openapi` | ok, 282 operations |
| Earlier probes, re-run (`712-edd4-security-rebind-opus-probes.test.ts`, P1-P10, plus new P12-P15) | all passed. Observations are in `712-edd4-security-rebind-opus-probes-output.txt` |
| Strict-mode probes (`712-edd4-security-rebind-opus-strict-probes.test.ts`) | passed |
| Mutations K1, K1b, K2, C1, G1-G4 | see below |

Raw logs: `712-edd4-work/`.

### Round-3 items

**F1, task relations: closed.**
- A project member creating a relation to a task in a project they cannot reach now gets **404 `Target task not found`**. The text is byte-identical to a missing target (P6, P13). No row is written.
- A target the caller can read but cannot update also gets the same 404 (P15).
- A cross-project relation created earlier by the owner: the member's `GET /task-relation/{task}` leaves it out entirely (no title, no id; P13). `DELETE` gives 404 `Task relation not found` (P13).
- A member key scoped to update links a visible target (200). It gets 404 for a hidden target and for a missing one. A read-scoped key gets 403 `Insufficient API key scope`.

**F2, bulk: closed.**
- A workspace admin or lead with a read-only project role now gets a per-item `Insufficient permissions` for bulk delete and bulk assign. Nothing is written (P10).
- An outsider's items and missing keys both report `Work item not found` (P2).
- Customers get 403.
- A read-scoped key owned by a capable member gets 403 `Insufficient API key scope` (P14).

**F3, activity comments: closed.**
- A read-scoped key owned by the author gets **403** on `PUT` and `DELETE /activity/comment`, and the content is unchanged. This holds with strict enforcement both off (P5) and on.
- The strict test's in-scope key case was changed from 200 to 403. That is a positive case becoming fail-closed, not a weakened negative. Integrations can no longer edit legacy activity comments by key. That is an intended behaviour change and belongs in the PR body.

**F7, customer flags: closed.** A customer with a project role gets `rankTasks:false` and `createPublicComments:false`, and `POST /rank` gives 403 (P9). The flag uses `isCustomerPrincipal`, the predicate the routes use.

**Earlier probes re-run:**
- P1: out-of-reach answers are byte-identical to a missing id on all 7 route classes.
- P3: instance-admin answers are unchanged.
- P4: impersonation is unchanged.
- P8: search unchanged (customer 403, outsider sees nothing).
- P7: unchanged; this is F4, a low existence oracle that was not in the round-3 scope.

**Strict mode:**
- outsider: 404;
- readerLead: 403;
- customer with a role: 403; without one: 404;
- read-scoped keys: 403;
- update-scoped member key: 200.
- Strict bulk still gives 500. That is F8; it also happens on main.

### `caller-reach.ts` against the single-item middleware

- **Same functions:** the identity comes from `resolveCallerIdentity`, which the single-item path also uses through `projectReadDecision`. Reach uses `reaches()`. Capability uses `hasProjectReadCapability(identity, cap, "work_item", facts)`, the function `evaluateProjectRead` calls.
- **Same facts:** the facts have the same shape (project, workspace, organisation from the workspace row, the row id as `workItemId`, no ancestors, no owner team). It fails closed with no identity.
- **Differences, all stricter or neutral:**
  - It does not accept the `orSelfTarget`/`orOwner` branch capabilities that `projectReadDecision` accepts. Bulk assign therefore needs `work_item:assign` itself, which is stricter than the single assign route's self-branch.
  - It has no customer-principal check. Customers are still refused before this point: by the bulk workspace gate (they hold neither delete nor assign), and by `assertWorkItemProjectReach` / `fromTaskId` on the source task for relations.

### The API-key "allowed" path (`can()` returns true for keys)

- **Bulk:** the key-aware gate is `assertCallerHasCapability(..., capabilityCredential(c.get("apiKey")))` at `work-item/index.ts:1404-1409`. It runs before the authoriser.
- **Relations:** the key-aware gate is `requireWorkspacePermission({ work_item: ["update"] })` at `task-relation/index.ts:233` (POST) and `:261` (DELETE). It sits in route middleware, ahead of the handler.

| Mutation | What changed | Result |
| --- | --- | --- |
| **K1** | bulk gate removed | 2 tests fail (a session test and my probe). The gate is load-bearing. |
| **K1b** | bulk gate keeps sessions but ignores the key (`capabilityCredential(undefined)`) | **Survives the PR suite:** work-item-bulk, work-item-project-reach*, strict-runtime and api-key files, 167/167 pass. My P14 shows the effect: a read-scoped key bulk-deletes (200, row deleted); at the real head it gets 403. See N2. |
| **K2** | relation POST gate removed | legacy-task-project-reach fails its "read-scoped or unscoped API key is refused" test. Caught. |
| **C1** | `callerReach.can` always true for sessions | Only the bulk capability test fails. Relation create to a reachable read-only target survives the suite: 200 under the mutant, 404 at the head (P15). See N2. |

### Guard coverage requirement

**Not vacuous.** The guard requires every route in its set (and every behavioural row) to be on a list in `reach-route-keys.ts`. Each integration table asserts that it equals its list exactly. So a marked route with no behavioural row fails one of the two.

| Mutation | What changed | Result |
| --- | --- | --- |
| G0 | none (baseline) | 7/7 pass |
| G1 | rank removed from `ITEM_WRITE_ROUTE_KEYS` | guard fails: "POST /api/work-items/{key}/rank: marked but no behavioural test row" |
| G2 | `GET /api/task-relation/{taskId}` removed from `READ_ROUTE_KEYS` | guard fails |
| G3 | search removed from `OTHER_COVERED_ROUTE_KEYS` | guard fails |
| G4 | rank row deleted from the integration table, list left alone | `work-item-project-reach` fails "the table covers exactly the item write routes the guard requires" |

The pure `findCoverageProblems` also has its own negative unit cases. One limit remains: `OTHER_COVERED_ROUTE_KEYS` (search) is not tied to an equality assertion in its test file. It is one route, and it is backstopped by the credentials test.

## Findings

No blocking finding.

**N1 (non-blocking; low-medium; pre-existing in design; file).** On every `deferApiKeyCapability` route and on bulk, an API key's authority is **key scope ∩ workspace role**. Project role is not part of it.

- **Probe P12, strict enforcement off:** `readerLead` (workspace lead, project role read-only) has a full-scope key. With it, PATCH gives 200, rank 200, DELETE 200 and bulk delete 200. The same user's session gets 403.
- **Code:**
  - `caller-reach.ts`: `if (credentialIsKey) return true`;
  - `require-work-item-reach.ts`: the `deferApiKeyCapability && apiKey` branch;
  - downstream, `assertCallerHasCapability` / `requireWorkspacePermission` read the workspace role only.
- **Bounds:**
  - Strict enforcement closes it (a full key gets 403 Forbidden).
  - A user cannot mint a scoped key. The API-key plugin refuses `permissions` from clients and no default permissions are configured, so self-minted keys are unscoped and refused everywhere.
  - Exposure is limited to operator-issued scoped keys whose owner has a project role narrower than their workspace role.
  - Reach is still enforced: keys owned by outsiders get 404.
- **Assessment:** this is the documented trade-off of `deferApiKeyCapability`. The implementer notes flag it as an orchestrator decision ("keys carry no canonical capability subset"). It is not a regression against main. Fixing it needs key capability subsets in `resolveIdentity`.
- **Recommendation:** record the decision and its reversal path, and track it with #720 or the key-capability work.

**N2 (non-blocking; test gap).** Two of the new protections are correct at the head but are not pinned by the PR suite:

1. **Bulk key scope (K1b survives).** Add a bulk row: a read-scoped key owned by a capable member, expecting 403 with nothing written.
2. **Relation create needs `work_item:update` on the target (C1 survives on relations).** Add a row: target reachable but read-only, expecting 404 `Target task not found` with nothing written.

**N3 (informational).** The bulk failure reason is `Insufficient permissions` for an item the caller can reach and `Work item not found` otherwise. The caller can already read reachable items, so the reason difference reveals nothing they cannot see.

**N4 (non-blocking; test harness, not security).** In both of my full serialized runs, `leader-lock.test.ts` failed in `beforeAll`.

- **Error:** `ensureTestDatabaseMigrated` → `migrate-membership-provenance.ts:507` reports "Applied membership cutover has an incomplete grant projection: 2 membership row(s) have no grant".
- **Cause:** state left by an earlier file. `grantProjectRole` inserts `membership` rows without grants, and round 3 adds more such fixtures (the new reads table). Ordinary review B (F5) saw the same error intermittently at 6be2c97d. At aec692e9 my full run was green.
- **Isolated and in CI:** the file passes alone (6/6), and the CI integration job is green at edd4f91a.
- **Risk:** it now reproduces locally in 2 of 2 runs, so a serialized CI run could start failing on it.
- **Fix:** make the `grantProjectRole` helpers also write the grant projection, or have `resetTestDatabase`/`afterAll` clear ungranted rows.

**Carried over, unchanged:** F4 (approval existence oracle for customer-side persons on an agent-portal session; low), F6 (comment-by-id keys fail closed; now also legacy activity comments) and F8 (strict-mode bulk returns 500, also on main).

## Residual risk

- **N1:** operator-issued scoped keys held by an owner whose project role is narrower than their workspace role, with strict enforcement off.
- **#720 scope:** project-scope routes, legacy `PATCH /task/bulk`, labels and time entries. Not rechecked here.
- **Not probed:** realtime fan-out, and attachment URLs issued before reach was lost.
- **Not run:** image build and container boot.
- This review does not replace the exact-head GPT-6 Sol security review.

## Verdict

**CLEAR** at edd4f91a85a9edd220ecc249febb0ab3f79da8b9.

- F1, F2, F3, F5 and F7 are closed at the head; probes and mutations confirm each one.
- `caller-reach.ts` uses the single-item identity, reach and capability predicates.
- The key "allowed" path defers to key-aware gates that are present and load-bearing.
- The guard's behavioural-table requirement fails when a list entry or a table row is removed.
- Recommended before or alongside merge:
  - add the two N2 test rows;
  - record N1 as an orchestrator decision with a tracked follow-up.
<!-- END REPORT (sha256 65d3b4a7a7c274232f7f86e92f40263b3b25812e178cadbfa18102df9baea8a3) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/712-7b97-security-rebind-opus.md; Claude Opus 5.5; sha256 ce8f30e514a2c4a082b7129e84a948a262935e47cb58b08e9f8ab94bbc5f7c49) -->
# PR #712 light security rebind at 7b97d249 (N2 test rows, N4 harness fix)

**Model:** Claude Opus 5.5 (`claude-opus-5-5`). Fresh, independent context. I did not author, direct or remediate this change. My earlier CLEARs are `712-security-opus.md` (aec692e9) and `712-edd4-security-rebind-opus.md` (edd4f91a).
**Role:** independent security review requested by the orchestrator. It does not replace the GPT-6 Sol gate.

**Reviewed head:** 7b97d24923043fc6823ec7c462107afd18c21fcf
**Merge base with the PR's own base:** 66565b2c2eade2378b5a1d1fd518054b2e298238
**Delta reviewed:** `git diff edd4f91a 7b97d249`. One commit, 3 files, +59/-2, all under `tests/`.
**Scratch copy:** detached worktree `/Users/heinthura/.codex/worktrees/review-712-7b97`, removed afterwards. No push, comment or merge. Docker: my Testcontainers runs were reaped by ryuk, so I removed nothing. Two Testcontainers containers that appeared afterwards (session 9d577e0ba3c8, created 22:16 UTC) belong to a concurrent lane (`review-726-a` vitest run) and were left alone. The `taskdesk-*` containers were not touched.

## Main has moved: this item is false as stated

- `git ls-remote` at review time gives `refs/heads/main` = **28481af5826035d702f705ea599858f27634a84b**, not 66565b2c. Main now also contains #721 (`66565b2c..28481af5`, 5 commits: a11y names and lists).
- GitHub reports `mergeStateStatus: BEHIND`.
- **What #721 touches:** only `apps/web/`, `i18n/`, `packages/ui/` and `docs/`. There is no overlap with any file this PR changes, and nothing under `apps/api` or `tests/`. `git merge-tree --write-tree 7b97d249 28481af5` merges cleanly.
- **Effect on the security conclusion:** #721 cannot affect it.
- **Effect on the merge:** the head that merges is not the tree that was tested and reviewed against current main. If branch protection requires an up-to-date branch, the update merge creates a new head. Under exact-head discipline, that head needs its own CI, plus a mechanical rebind showing the merge brought in only #721's files.

## Delta checks

### Test-only

`git diff --name-only edd4f91a 7b97d249` lists 3 files, all under `tests/api-integration/`:

| File | Change |
| --- | --- |
| `leader-lock.test.ts` | setup only |
| `legacy-task-project-reach.test.ts` | +1 test, +1 import |
| `work-item-project-reach-credentials.test.ts` | +1 describe with 1 test |

There are 0 non-test files. No assertion was removed or changed.

### N2 row 1: bulk key scope

`work-item-project-reach-credentials.test.ts`, describe `POST /api/work-items/bulk`:
- Keys owned by the capable `projectMember`: a read-scoped key (`project:read`, `work_item:read`) and an unscoped key (`null`).
- Both `delete` and `assign` are sent.
- It expects 403 every time and an unchanged snapshot.

### N2 row 2: relation target that is reachable but read-only

`legacy-task-project-reach.test.ts`:
- The caller is a workspace admin with full item authority on the source project and a read-only project role (`project:read`, `work_item:read`) on the target's project.
- It expects 404 and an unchanged `task_relation` table.

### Mutations reproduced

| Run | What changed | Result |
| --- | --- | --- |
| Baseline | none: credentials, legacy and leader-lock files | **3 files / 166 tests passed** |
| **K1b** | the bulk handler's key-aware gate ignores the key (`capabilityCredential(undefined)` at the `assertCallerHasCapability` call in `work-item/index.ts`); credentials and work-item-bulk files run | **exactly the new row fails**: "refuses a read-scoped API key owned by a capable project member and writes nothing" (1 failed / 61 passed). At edd4f91a this same mutant passed 167/167. |
| **C1** | `callerReach().can()` always returns true (`|| true` in `utils/caller-reach.ts`) | the new relation row fails ("creating a relation to a target the caller reaches but may only read answers 404 and writes nothing"). So does the existing bulk per-item capability test, as expected: the mutant covers sessions too. 2 failed / 161 passed. At edd4f91a the relation half of C1 survived. |

Sources were restored after each mutation, and the tree was clean.

Both gaps from N2 in my edd4 report are now pinned.

### N4: leader-lock setup

- **What changed:** `beforeAll` now calls `resetTestDatabase()` instead of `ensureTestDatabaseMigrated()`. The test's own assertions are unchanged: the diff touches only the import and the `beforeAll` body.
- **What the replacement does:** `resetTestDatabase` (`helpers/database.ts`) truncates every public table and then calls `ensureTestDatabaseMigrated()`. That is the same setup most integration files use. The migration still runs.
- **Does it weaken a check?** No. The membership-cutover guard that tripped is a migration precondition, not something leader-lock tests. The guard has its own coverage in `membership-projection-repair.test.ts`, which is unchanged. Starting from an empty database removes the order dependence and does not hide a product defect.
- **Remaining harness concern (non-blocking):** `grantProjectRole` still leaves ungranted `membership` rows. Any future file that calls only `ensureTestDatabaseMigrated()` will hit the same error.

### Full suite

Full serialized integration suite (`CI=true`) at 7b97d249: one run: **188/190 files, 2526/2528 tests**, exit 1.

- **`leader-lock.test.ts` passed in the full run.** This confirms N4 is fixed; at edd4f91a it failed in 2 of 2 runs.
- **Two unrelated intermittent failures**, both in files this delta does not touch. Run together in isolation, both files pass (2 files, 75/75):
  1. `workspace-rbac.test.ts` "allows a member to create a project": `resetTestDatabase`'s TRUNCATE failed with `deadlock detected` (40P01, `helpers/database.ts:130`). This is the same harness intermittent that ordinary review B recorded at 6be2c97d.
  2. `node-server-websocket.test.ts` "rejects session upgrades before 101 ...": one boundary case answered **403 instead of the expected 401**. The upgrade was still refused before 101, so no access was granted; it is a status-code mismatch, not an authorisation bypass. This file is not touched by #712's delta, and it passes in isolation.
- The coordinator reports two green full runs (190 files, 2528 tests). CI `integration - Postgres 18` was in progress at review time.
- **Recommendation:** confirm the CI integration job at this head before merge. If the websocket 403/401 case recurs, file it as a flaky test.

## Findings

- No blocking finding in the delta.
- **M1, process, non-blocking for security:** main moved to 28481af5 (above). The candidate is BEHIND. Any update merge creates a new exact head, which needs CI and a mechanical rebind before merge.

## Residual risk

These are unchanged from the edd4 report:
- N1: API keys use key scope combined with the workspace role, not the project role. Bounded by strict enforcement and by keys being operator-issued. It needs a recorded decision.
- F4: low approval existence oracle.
- F6: comment edits by key now fail closed.
- F8: bulk returns 500 under strict enforcement, as on main.
- #720 scope.

Not run: image build and container boot. This review does not replace the exact-head GPT-6 Sol security review.

## Verdict

**CLEAR** at 7b97d24923043fc6823ec7c462107afd18c21fcf.

- The delta is test-only.
- The two new rows pin exactly the gaps found at edd4f91a: K1b and C1 now fail on them.
- The leader-lock change removes the order dependence without weakening any assertion.
- Main is **not** 66565b2c; it is 28481af5. If the branch is updated before merge, the new head needs its own CI and a mechanical rebind.
<!-- END REPORT (sha256 ce8f30e514a2c4a082b7129e84a948a262935e47cb58b08e9f8ab94bbc5f7c49) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/712-510d-security-rebind-opus.md; Claude Opus 5.5; sha256 7703fe57ef1a32f48026a8c6f1be6527af6fd5368b3b6882426371360d77a487) -->
# PR #712 mechanical security rebind at 510df528 (merge of main 28481af5 / #721)

**Model:** Claude Opus 5.5 (`claude-opus-5-5`). Fresh, independent context. I did not author, direct or remediate this change. Prior CLEARs: `712-security-opus.md` (aec692e9), `712-edd4-security-rebind-opus.md` (edd4f91a) and `712-7b97-security-rebind-opus.md` (7b97d249).
**Role:** independent security review requested by the orchestrator. It does not replace the GPT-6 Sol gate.

**Reviewed head:** 510df528d067d8a447ee31ac84a74395b97ee37b
**Parents:** 7b97d24923043fc6823ec7c462107afd18c21fcf (my CLEAR head) and 28481af5826035d702f705ea599858f27634a84b (origin/main, #721).
**Main at review time:** `git ls-remote` (2026-10-13T22:31Z) gives refs/heads/main = 28481af5 and refs/heads/codex/work-item-write-project-reach = 510df528.
**Method:** git object comparison only, in the author worktree's object store (read-only; no checkout, no file modified). No tests were run, as the coordinator specified for a mechanical rebind. No worktree was created and no Docker was used.

## Checks

| Check | Result |
| --- | --- |
| Head parents are exactly 7b97d249 and 28481af5 | yes (`git rev-parse 510df528^1 ^2`) |
| Head tree equals `git merge-tree --write-tree 7b97d249 28481af5` | yes: both are `7957067f9620160e639793cce94c355f012d41ec` |
| Files changed under `apps/api`, `tests/api-integration`, `tests/permissions` or `tests/api-contract` relative to 7b97d249 | **0** |
| Files changed relative to 7b97d249 that #721 (`66565b2c..28481af5`) did not change | **none**: 33 files changed, all 33 in #721's own file set (`apps/web/`, `i18n/`, `packages/ui/`, `docs/`) |
| Main is still 28481af5 | yes |

Because the head tree is byte-identical to a clean three-way merge of the two parents, the merge commit introduces no content of its own. Every API, permission, contract and integration-test file is byte-identical to 7b97d249, where the security review, mutations and probes were run.

## Findings

No new finding. Everything from my 7b97d249 report carries over unchanged:
- N1: an API key's authority uses the owner's workspace role, not their project role. This needs a recorded orchestrator decision.
- F4: a low-risk approval existence oracle.
- F6: comment edits by key now fail closed.
- F8: bulk returns 500 under strict enforcement, as it also does on main.
- The routes deferred to #720.
- The intermittent `workspace-rbac` reset deadlock and the `node-server-websocket` 403/401 case. Neither file is in #712's delta.

## Residual risk

- #721's own web/i18n/ui changes were reviewed under #721, not here.
- No tests were run at this head. CI at 510df528 must be green before merge. It is the gate for the combined tree.
- This review does not replace the exact-head GPT-6 Sol security review.

## Verdict

**CLEAR** at 510df528d067d8a447ee31ac84a74395b97ee37b.

- It is a clean merge of origin/main 28481af5 into the reviewed 7b97d249.
- No security-relevant path changed.
- Main is still 28481af5.
<!-- END REPORT (sha256 7703fe57ef1a32f48026a8c6f1be6527af6fd5368b3b6882426371360d77a487) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/712-eb66-security-rebind-opus.md; Claude Opus 5.5; sha256 2ce401440990e9832ff5ee278fe0b8dd816d1f40ab8e8c3a8f30cfbd29634271) -->
# PR #712 — security exact-head rebind (mechanical merge of main #726)

**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). This is a fresh, independent context. I did not author, direct or remediate #712 or #726.
**Reviewed head:** eb6601511153430c444b8c814b85c4b5965ff30c
**Prior CLEAR head:** dc41b2a3e2e3366aa57cf0d73280d6ddd81a9ce6 (510df528, security CLEAR, plus the review-note commit)
**Main merged in:** 417944ca57844d02de1590fbed82633a476f4665 (merge of #726, CA-2 project default comment visibility; first parent 28481af5)
**Method:** read-only. A blobless bare clone in the scratchpad. No worktree was modified. No test suites were run, and no Docker was used.

## Commands and outputs

```
$ git ls-remote origin refs/heads/main refs/pull/712/head        (at the start and again at the end)
417944ca57844d02de1590fbed82633a476f4665  refs/heads/main
eb6601511153430c444b8c814b85c4b5965ff30c  refs/pull/712/head
$ gh pr view 712 --json headRefOid  -> eb6601511153430c444b8c814b85c4b5965ff30c (codex/work-item-write-project-reach)

$ git rev-list --parents -n1 eb660151
eb6601511153430c444b8c814b85c4b5965ff30c dc41b2a3e2e3366aa57cf0d73280d6ddd81a9ce6 417944ca57844d02de1590fbed82633a476f4665

$ git rev-parse eb660151^{tree}                       -> 85526422792737a8b3e22780e74778367a098ae1
$ git merge-tree --write-tree dc41b2a3 417944ca      -> 85526422792737a8b3e22780e74778367a098ae1   (identical)

$ git merge-base dc41b2a3 417944ca                   -> 28481af5826035d702f705ea599858f27634a84b
$ git diff --name-only dc41b2a3 eb660151  vs  git diff --name-only 28481af5 417944ca
35 files each; diff of the two lists is empty -> IDENTICAL
$ comm -12 (#712 files vs main, 417944ca...eb660151) (#726 files)  -> empty (no path overlap)
```

## Semantic interaction review (read at eb660151)

1. **PUT /api/project/{id}: route reach and policy are unaffected by #712's middleware.**
   - The route still uses `workspaceAccess.fromProject()` with no options, followed by `requireWorkspacePermission({ project: ["update"] })`.
   - #712's `ReachOptions`/`deferApiKeyCapability` changes leave `requireProjectReach` and `deferApiKeyCapability` undefined for this route. The new 404 message selection, the deferred API-key branch and the customer-principal 403 all sit inside `if (config.requireProjectReach)`, so none of them runs on this route.
   - The `WORK_ITEM_REACH_MARK` symbol attached to the middleware is metadata that only the test reads. It changes nothing at runtime.
   - #726's handler-level STRICT `assertCallerHasCapability(..., "project:manage_settings", capabilityCredential(apiKey))` runs after body validation and before any read or write. Nothing #712 changed sits in that path.
2. **Policy maps.** #726 changed only a comment in `apps/api/src/project/policy.ts`. The entry is still `"PUT /api/project/{id}": { capability: "project:update", scope: "project", scopeSource: "row", reach: "required" }`. #712 touches no `policy.ts` file, so its policy maps cannot collide with #726's.
3. **`tests/permissions/work-item-reach-guard.test.ts`.** The guard set is the registry entries with `scope === "work_item" && reach === "required"`. #726 adds no work-item-scoped policy, because its only route is `scope: "project"`. The guard set, the marker check and the behavioural-coverage cross-check (`reach-route-keys.ts`) therefore keep the same inputs and the same expectations. The guard's non-vacuous negative cases are untouched.
4. **Shared imports.** #726's `project/schema.ts` imports `commentVisibility` from `apps/api/src/work-item/comment-schema.ts`. #712 does not modify that file, and it is present at the reviewed head.
5. The web-side #726 files (settings page, composer, the permission hook and i18n) don't overlap any #712 path. #712 changes only the API, tests and docs.

## Hosted CI at eb660151 (observed; this is not a substitute for the gate)
- 18 checks SUCCESS.
- Integration (Postgres 18), the e2e redirect check and the performance budgets were IN_PROGRESS.
- `pull request template + security review` was FAILURE. I expect that to be the exact-head review-note check: it should clear once a note recording this head is committed. The orchestrator must confirm every required check is green at the final head before merging.

## Findings
- Blocking: none.
- Non-blocking: none.

## Residual risk / not checked
- I ran no test suites, by instruction. Hosted CI at the candidate head is the gate.
- I did not re-review #712's own semantics; that was CLEARed at 510df528. This review covers only the merge delta and its interaction with #726.
- If a further commit, such as a review-note commit, changes the head, a new exact-head confirmation is needed.

**Verdict:** CLEAR
<!-- END REPORT (sha256 2ce401440990e9832ff5ee278fe0b8dd816d1f40ab8e8c3a8f30cfbd29634271) -->
