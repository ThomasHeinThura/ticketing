# Security review — create work-item dialog and `GET /api/workspace/{workspaceId}/work-item-types` (PR #340)

**Reviewer:** Opus 5.5, fresh independent context commissioned by the orchestrating session. Did not author, direct, or remediate this change.
**Reviewed head:** `7294ace55966b45662498b02326895d1ba3c62e6`
**Reviewed SHA:** `7294ace55966b45662498b02326895d1ba3c62e6` (confirmed via `gh pr view 340 --json headRefOid` before starting). Two commits on base `dd067e21f77853b35dd79de31e99d258678b92b4`: `03e46f1` (API) and `7294ace` (web). `origin/main` has since moved to `33ce9ec8a926b3dd0dbe8d00b828c69c72861408` (#322). See S1.
**Branch:** `feat/23-create-work-item-dialog`
**Pull request:** #340
**Date:** 2026-09-23

## Verdict

**CHANGES NEEDED.** One finding blocks the merge (S1). It is a test-fixture break, not a security hole. The new route is correctly scoped, has no existence oracle, and leaks nothing it shouldn't. The dialog renders server strings as text only.

- **S1 (BLOCKING, merge-readiness):** once this branch is merged with the current `main`, the PR's own integration test `workspace:read roles (viewer) may read the catalogue` fails. #322 made `requireWorkspaceCapability` grant a built-in role name's capabilities only when a genuine `workspace_role` row with `is_system = true` backs it. This test's `addWorkspaceMember` helper writes only `workspace_member.role`. Integration tests aren't a required CI check, so CI won't catch this.
- **The gates are not met either** (see "Gates"). No independent ordinary review is recorded on the PR, and the `pull request template + security review` check is red. The authorship attestation also doesn't reconcile with the commit identity, and the decision that authorises a non-Claude author (#336) isn't merged yet.

Clearing S1 takes a one-line fixture fix, then a `main` merge, then a short delta confirmation that the only changes are the fixture and the merge. The security findings below don't need to change for that.

## Surfaces examined

- `apps/api/src/work-item/controllers/list-work-item-types.ts` (whole file)
- `apps/api/src/work-item/index.ts`: `listWorkItemTypesRoute` middleware and handler, and the existing `createWorkItemRoute` the dialog calls
- `apps/api/src/work-item/policy.ts`: the new entry, and its sibling entries
- `apps/api/src/work-item/response.ts` (`workItemTypeSchema`) and `schema.ts` (`workspaceIdParam`, `createWorkItemBody`)
- `apps/api/src/utils/workspace-access-middleware.ts`: the `param` source, the post-loop `validateWorkspaceAccess`, and `c.set("workspaceId")`
- `apps/api/src/utils/validate-workspace-access.ts`: API-key ownership, the instance-admin `role === "admin"` early return, and membership
- `apps/api/src/utils/require-workspace-capability.ts`, at this head and at `main` after #322
- `apps/api/src/work-item/controllers/create-work-item.ts` (type and project scoping; unchanged by this PR)
- `apps/api/src/database/schema.ts` `workItemTypeTable`: there is no `archived_at` column, so "exclude archived types" has nothing to act on
- `packages/permissions/src/policy.ts` (`scopeSource`/`reach` semantics), and #323's `buildShadowPolicySide` (branch `feat/8-shadow-mode`)
- `docs/01-architecture/rbac.md` (`workspace:read` holders), and `docs/03-features/work-items.md` (Default types, WI-1/WI-3, the new route-table row)
- Web: `create-work-item-dialog.tsx`, `fetchers/work-item/{create-work-item,get-work-item-types}.ts`, `hooks/queries/work-item/use-get-work-item-types.ts`, `hooks/mutations/work-item/use-create-work-item.ts`, `lib/work-item-description.ts`, the `work.tsx` header change, and `types/work-item-type/index.ts`
- `tests/api-integration/work-item-types.test.ts`, `tests/permissions/matrix.fixture.json` (+1 row), and `tests/api-contract/openapi.json`
- Background: `security-reviews/313-seed-defaults.md` and `307-uniform-404.md` on `main`, and `320-work-item-list-api.md` on `feat/310-work-item-list-api` (the cross-tenant join and OR-scope classes)

## What I probed

I used a private DB, `pr340_opus_test`, on td-lane-pg, and dropped it afterwards. The probe file was scratch: it was deleted and never committed. The worktree's `git status` was clean after every mutation.

### 1. Suites at this head

| Suite | Result |
| --- | --- |
| API integration | 80 files, 1087 tests. In the aggregate run, 1 failed: `task.test.ts` "soft-deleted project (#187)" hit a Postgres **deadlock inside `resetTestDatabase`'s TRUNCATE**. That's harness contention; the diff touches nothing near it. Re-run alone: 12/12 passed. |
| API unit | 54 files, 412/412. One aggregate run showed a single failure while the integration suite was loading the host. A clean re-run passed 412/412. This matches the PR's disclosed `delivery-ssrf` timeout flake. |
| `test:permissions` | 10 files, 80/80. Run with no `apps/web/dist` present. |
| Web (`apps/web` vitest) | 66 files, 292/292. |
| `check:openapi` | Matches the API (107 operations). |
| `node --test 'scripts/ci/**/*.test.mjs'` | 495 tests, 88 suites, 0 failed. |
| **After merging `origin/main` (`33ce9ec`) into this head, in a scratch worktree** | Full integration suite: 81 files, **1 failed / 1112**. The only failure is the viewer case in `work-item-types.test.ts` (S1). `test:permissions`: 80/80. |

### 2. The types route over real HTTP

I started a real `@hono/node-server` on `createApp().fetch` and sent `fetch()` requests to 127.0.0.1. The caller was a member of workspace A; workspace B belongs to someone else. Every type row carried non-null `workflow_id`/`sla_policy_id` sentinels, to detect leaks.

| Probe | Answer |
| --- | --- |
| Own workspace | 200. Only A's rows. Keys are exactly `id, key, name, icon, category, isEpic, isChange`, and no sentinel appears. |
| B's id (exists, out of reach) | 403 `You don't have access to this workspace` |
| A random id (doesn't exist) | 403, **byte-identical** body and the same content-type. No existence oracle. |
| B's path + `?workspaceId=A` | 403. The query string isn't a source for this route. |
| B's path + `X-Workspace-Id: A` | 403. The header isn't a source either. |
| `A%2F..%2FB` in the param | 403. Treated as one opaque id, and no match. |
| Trailing slash, and upper-case `/WORKSPACE/` | 404 from the router, which means no route matched and nothing reached a handler. |
| Instance admin (`user.role = 'admin'`), not a member: B's id vs a random id | Both 403 `Insufficient permissions`, byte-identical. `validateWorkspaceAccess` lets the admin through, and `requireWorkspaceCapability` then refuses a non-member. There's no bypass and no oracle. |
| Anonymous | 401 |
| API key owned by a member of another workspace, used against A | 403. The same key against its owner's own workspace: 200. |
| Role without `workspace:read` (`customer`) | 403 (the PR's test) |

The handler reads `workspaceId` from `c.req.valid("param")`. The middleware authorised the same path param through `c.req.param("workspaceId")`. Both read the same segment, so the authorised id and the queried id can't diverge. The controller has a single `where workspace_id = $1` and no join, so neither the #320 cross-tenant-join class nor the OR-scope class applies.

### 3. Does the declared policy match what the middleware enforces?

- **Capability:** `workspace:read` in both places, and `rbac.md` says the same. Owner, admin, manager, lead, member and viewer hold it; `customer` doesn't.
- **Scope:** `workspace` in both.
- **`scopeSource: "request"`:** correct under `packages/permissions/src/policy.ts`'s definition, because this is a collection route and the id comes from the path. #323's `buildShadowPolicySide` builds `workspaceScopeFromRequest` for exactly this declaration, so the shadow comparison will line up. The sibling `workspace/policy.ts` reads (`/members`, `/invitations`) declare `"row"`, but that's their own rationale, not a conflict here.
- **`reach: "required"`:** reach is membership, which `fromParam` checks.
- **No `sessionOnly`:** consistent with every other `work-item/policy.ts` and `project/policy.ts` entry, and the live route has no `requireSessionOnly()`. So declaration and enforcement agree: API keys may read the catalogue. This is an explanation, not a finding.

### 4. Creating a work item through the dialog

The dialog calls the existing `POST /api/projects/{projectId}/work-items`, which this PR doesn't change. Over real HTTP, as a member of A in A's project:

- **B's real `typeId` → 400, and no `work_item` row is written.**
- I sent `stateId` (B's default state), `workspaceId` (B), `projectId` (B's project), `key: "EVIL-1"`, `number: 999` and `createdBy` in the body alongside a valid A `typeId`. The result was 200, and the row had workspace A, project A, **A's default state**, type A, a server-assigned key, and `number = 1`. Zod strips every smuggled field, and `stateId` isn't accepted at all (WI-4).
- **B's project in the path → 400 `Workspace ID could not be determined`**. That's byte-identical to a random project id.
- **Viewer → 403.**
- The client supplies `typeId`, `title`, `description` and `priority`. All four are validated on the server. `title` and `description` are validated by the existing schema, `typeId` by `create-work-item.ts:67-79`, and `priority` is an enum. The client-side 500-character and required-type checks are only a mirror of those.

### 5. The response

`workItemTypeSchema` and the controller's `select` list the same seven columns. `workflowId`, `slaPolicyId`, `workspaceId`, `createdAt` and `updatedAt` are never selected, which the probe confirmed with sentinels. There is no user data.

### 6. Web

- **HTML rendering:** there's no `dangerouslySetInnerHTML`, `innerHTML` or markdown/HTML renderer anywhere in the diff. `type.name` and every i18n string render as React text children.
- **Description:** `descriptionFromPlainText` builds `{type:"text", text}` nodes. The API stored an `<img onerror>` string I posted as plain JSON text inside a text node. No part of this PR turns it into markup. The rendering side (`task-description.tsx`) is pre-existing and was not reviewed here.
- **Cache keys:** `["work-item-types", workspaceId]` is the correct scope, because types are workspace-level. Keying it by project would be wrong. `["work-items", projectId]` is what the dialog invalidates, and it matches `useGetWorkItems`. Neither hook uses `keepPreviousData` or `placeholderData`, and none is used anywhere under `apps/web/src`. `enabled: !!workspaceId` stops a fetch against `undefined`.
- **UI gating:** the trigger is gated on the legacy `canCreateTasks()` signal, not `work_item:create`. That's UI only; the server is the authority, and the dialog handles a 403. It's disclosed in the code.

### 7. Mutation checks

Each mutation was reverted afterwards, and `git status` was confirmed clean.

| Mutation | Caught? |
| --- | --- |
| Controller: drop `where workspace_id = …` | Yes. The shape/isolation test goes red. |
| Route: drop `requireWorkspaceCapability("workspace:read")` | Yes. The `customer` 403 test goes red. |
| Route: drop `workspaceAccess.fromParam` | Fails closed (3 tests red, and nothing is served). |
| Policy: delete the entry | Yes. 5 `test:permissions` tests go red: route coverage, the baseline trap, and the matrix. |
| Policy: capability → `workspace:manage_settings` | Yes. The matrix goes red. |
| Dialog: invalidate `["work-items","nope"]` | Yes. The create test goes red. |
| Hook: types key reduced to `["work-item-types"]` (no `workspaceId`) | **Survives.** The dialog test mocks the hook (S3). |
| Dialog: render `type.name` through `dangerouslySetInnerHTML` | **Survives.** No test pins text rendering (S3). |

## S1 — The PR's own viewer test fails once merged with `main` (#322) (BLOCKING, merge-readiness)

**Where:** `tests/api-integration/work-item-types.test.ts:51-72` (`addWorkspaceMember`), used at `:131`.

**What happens.** #322 (`33ce9ec`, on `main` after this branch's base) changed `builtInRoleHasCapability` in `apps/api/src/utils/require-workspace-capability.ts`. It now grants a built-in role name's capabilities only when a genuine `workspace_role` row with `is_system = true` backs that name. `addWorkspaceMember` inserts `workspace_member.role = 'viewer'` with no `workspace_role` row. `createWorkspaceMember` seeds the row only for its own `member` role. So on the merged tree the viewer gets 403 and the test fails.

I reproduced this by merging `origin/main` into `7294ace` in a scratch worktree: `Tests 1 failed | 30 passed`.

This is not a product regression. Real workspaces seed genuine rows for every default role (#66, #318), and #322 made the route stricter, not looser. But merging as-is puts a red integration test on `main`, and CI won't show it: there is no integration job among the required checks.

**Fix:** have `addWorkspaceMember` insert a genuine `workspace_role` row (`isSystem: true`) for the role it assigns, the way #322 updated `work-item-create-read-list.test.ts:106-110` and `work-item-update.test.ts:127`. Then merge `main` and re-run `work-item-types.test.ts` on the merged head. A delta check limited to "only the fixture and the merge changed" is enough to re-clear this note.

## S2 — Create answers a foreign `typeId` differently from an unknown one (NON-BLOCKING, pre-existing)

**Where:** `apps/api/src/work-item/controllers/create-work-item.ts:71-79`. This is byte-identical on `main`, and this PR doesn't change it.

For a project the caller can reach, an unknown `typeId` gets 400 `Unknown work item type`. Another workspace's real `typeId` gets 400 `Work item type does not belong to the project's workspace`. That's a cross-tenant existence bit for `work_item_type` ids, the same class #290/#307 closed in the middleware.

**Severity is low.** The ids are cuid2, so an attacker needs an id they already hold, and the answer reveals only existence, never content. The dialog only ever sends ids from the caller's own workspace.

**Fix (follow-up issue):** look up the type with `where id = $typeId and workspace_id = project.workspaceId` and answer one message for both cases. The composite FK from #192 still backs it.

## S3 — Two web properties have no test (NON-BLOCKING)

- `use-get-work-item-types.ts:10`: the workspace-scoped key is correct, but dropping `workspaceId` from it survives every test, because `create-work-item-dialog.test.tsx:27` mocks the hook. If it regressed, a workspace switch would show the previous workspace's types, and the create would then 400 on the server (so nothing unsafe gets written).
- No test asserts that a type name containing markup renders as literal text.

**Fix:** add a hook-level test that asserts two workspace ids produce two cache entries, and add one dialog case with `name: "<img src=x onerror=alert(1)>"` that asserts the text and that no `img` element exists.

## S4 — Priority on create is not gated by `work_item:set_priority` (NON-BLOCKING, pre-existing, recorded)

**Where:** `apps/api/src/work-item/index.ts:276-288` (create handler). PATCH checks `work_item:set_priority` (`:324`), but POST accepts `priority` under `work_item:create` alone.

Every built-in role that holds `work_item:create` also holds `set_priority` (manager, lead and member), so no built-in caller gains anything. A future custom role with `create` but not `set_priority` could still set priority at creation. The dialog's own comment says this and doesn't widen it.

**Fix (follow-up):** apply the same `assertCallerHasCapability(…, "work_item:set_priority")` to create when `priority` is supplied, or record in `work-items.md` that initial priority is part of `create`.

## S5 — The PR body overstates its tests (NON-BLOCKING, record accuracy)

The body lists five tests: "shape+order, empty workspace, unknown vs out-of-reach identical 403, missing permission, unauthenticated". It also cites an instance-admin "integration case". The file actually has: shape/order/isolation, viewer 200, customer 403, the oracle, and NUL → 400. There is no empty-workspace, unauthenticated or instance-admin integration test.

My probes cover those behaviours (401, `[]` for an empty workspace, and admin non-member 403), and the matrix row pins admin 403. So this is a wording correction for the body, not missing security coverage.

## Gates

At `7294ace`, as of this review:

- **Independent ordinary review:** **missing.** The PR has 0 comments and 0 reviews. `## Reviewed by` says the reviews are "running", with no verdict, model or SHA recorded.
- **Attribution:** doesn't reconcile yet.
  - `## Implemented by` names **DeepSeek V4.1 Flash (GitHub Copilot)**.
  - Both commits are authored `Claude Code <noreply@anthropic.com>`, with no trailer.
  - The rule that governs this, PR #336's "Commit identity rule" (a non-Claude author must use its own git identity, or the mismatch is noted on the PR before merge), is itself **unmerged**. So the authority for a non-Claude author isn't in the decision log on `main` yet. `CLAUDE.md` says that must happen before dependent PRs merge.
- **CI:** everything is green except **`pull request template + security review`**. Running `check-pr-template.mjs --body` locally at this head reports 5 problems:
  1. `## Security review` **Model:** doesn't name Opus.
  2. **Note:** doesn't link this file.
  3. There are **two** independent-review checkboxes, in "Any change" and "Backend change", and there must be exactly one.
  4. The first of those is unticked.
  5. The second is unticked.

  Items 1 and 2 are fixed by recording this note. Items 3–5 need a body edit and the ordinary review.
- **Waivers:** none cited.
- **Base:** 1 commit behind `main` (#322). A `main` merge is needed, and it triggers S1.

## Follow-ups to file

- S2: the type-existence oracle in `create-work-item.ts`
- S4: the priority-on-create capability
- The PR's own "Not done" item: the list's State column renders raw ids

---

## Delta review — `7294ace` → `11478fe` (2026-09-24)

**Reviewer:** Opus 5.5, a fresh independent context, commissioned by the orchestrating session. It did not author, direct or remediate any delta commit.
**Reviewed head:** `11478fec9b8ed635d4a3d3fef0f3e6c0837901f6`
**Delta commits:**
- `0bf85da`: web, the empty-types message gate plus tests
- `098e6ba`: merge of `main` at `99a528c`
- `f9b9c3d`: the S1 fixture fix
- `e31a075`: merge of my note commit `1789a18`
- `11478fe`: the S3 tests

All five are authored `Claude Code <noreply@anthropic.com>`.
**Private DB:** `pr340_opus_d_test` on td-lane-pg, dropped afterwards.

### Delta verdict

**CLEAR WITH FINDINGS.**
- S1 and S3 are resolved, and each fix is pinned by a test that goes red when mutated.
- The security-scope code is byte-identical to the head I reviewed.
- Both merges are clean.
- No new security finding.
- S2 and S4 remain non-blocking. They are filed as #347 and #348 (both open).
- Two gate and attestation items for the merging session follow (G1 and G2). They are not code findings, and deciding them isn't this review's call.

### 1. S1: resolved

- `f9b9c3d` makes `addWorkspaceMember` (`tests/api-integration/work-item-types.test.ts`) insert a `workspace_role` row with `isSystem: true` for every role except `owner`. That matches `seed-default-workspace-roles.ts`, where owner never gets a row.
- The viewer assertion is unchanged: `toBe(200)`.
- It also adds a negative control: a member whose role is merely *named* `viewer`, backed by an `isSystem: false` row, gets **403**.
- The `customer` case now also carries a genuine row, so its 403 comes from the missing capability rather than a missing row. That makes the test stronger, not weaker.
- **Mutations:**
  - Helper `isSystem: true → false`: the viewer test goes red.
  - Negative control `isSystem: false → true`: the impostor test goes red.
  - Both were reverted, and `git status` was clean.
- **Against current `main`:** `origin/main` is at `7bebaf6`, 4 commits past the branch's merged `99a528c` (#308, #345, #350, #351). None of them touches a file this PR changes. I merged `7bebaf6` into the head in a scratch worktree:
  - `work-item-types.test.ts` + `work-item-create-read-list.test.ts`: **32/32**
  - `test:permissions`: **80/80**

### 2. S3: resolved

- **Cache key:** `use-get-work-item-types.test.tsx` renders the real hook, backed by a real `QueryClient`, for `ws-a` and then `ws-b`. It asserts the cache holds exactly `[["work-item-types","ws-a"],["work-item-types","ws-b"]]`. **Mutation:** dropping `workspaceId` from the key turns *"keys the cache per workspace…"* red.
- **Markup as text:** the new dialog case selects a type named `<img src=x onerror=alert(1)>`. It asserts the dialog contains no `img` element and that the trigger's text content is the literal string. **Mutation:** rendering `type.name` through `dangerouslySetInnerHTML` turns *"renders a type name containing markup as literal text…"* red.
- Both mutations were reverted, and `git status` was clean.
- `0bf85da`'s one production change only tightens the empty-message condition to `types !== undefined && types.length === 0`. It isn't security-relevant.

### 3. The merges

- **`098e6ba`** (merge of `99a528c`): `git merge-tree --write-tree 0bf85da 99a528c` reproduces its tree exactly (`f5c4b69b…`), so it carries no hand edits.
- **`e31a075`** (merge of `1789a18`): `git merge-tree --write-tree f9b9c3d 1789a18` reproduces its tree exactly (`49155928…`). Its only change against its first parent is the addition of this note file (+183 lines).
- **Security-scope code:** `git diff 7294ace 11478fe -- apps/api/src/work-item` is empty. The PR's own API, policy, matrix and contract diff against the merge base (`99a528c`) is the same 7 files and 249 lines I reviewed. Everything else in `7294ace..11478fe` is `main`'s own content (#322/#318, #336), plus the test and web changes above.

### 4. What `e31a075` did to this note

**Nothing beyond carrying it in.** It is a true two-parent merge of my commit `1789a18`, and `git diff 1789a18 11478fe -- docs/07-planning/security-reviews/340-create-work-item-dialog.md` is empty. The note was byte-identical at `11478fe` before this section was appended.

Everything above the rule is still accurate *as a record of `7294ace`*. The status it recorded has since moved:
- S1 and S3 are fixed.
- S2 and S4 are filed.
- S5 is corrected in the body.
- The base is now `99a528c`.
- #336 has merged.
- Ordinary reviews are now recorded.

### 5. Suites at `11478fe`

| Suite | Result |
| --- | --- |
| API integration | 81 files, **1113/1113** |
| API unit | 55 files, **441/441** |
| `test:permissions` (no `apps/web/dist` present) | 10 files, **80/80** |
| Web | 67 files, **297/297** |
| `check:openapi` | matches (107 operations) |
| `node --test 'scripts/ci/**/*.test.mjs'` | 495 tests, 88 suites, 0 fail |
| `check-pr-template.mjs --body` (current body) | red only for the reason this section clears: no Opus `**Reviewed head:**` line for `11478fe`, and the independent-review box is unticked pending it |

### G1: Is the ordinary review independent by *tool*? (gate question for the merging session)

- `## Implemented by`: **DeepSeek V4.1 Flash (GitHub Copilot)**.
- The ordinary review and its delta: **GitHub Copilot (DeepSeek V4 Pro)**.
- The alignment check: **GitHub Copilot (GPT 5.6 Sol)**.

The rule that landed with #336 on `main` says: "The same agent or tool is never both author and ordinary reviewer." #345 and #351 relax *which model* may review, but #351 says it "does not change reviewer independence". On the attestations as written, author and reviewer share the GitHub Copilot tool, with different models in fresh contexts. Whether that satisfies "agent or tool" is for the merging session to decide against the decision log, or for Thomas. This review doesn't clear or waive it.

### G2: The commit-identity note in the body is inaccurate

The body says commits made after #336 landed "will use the session's own identity". But `f9b9c3d`, `e31a075` and `11478fe` were all made after `99a528c` (#336) was on the branch, and all three are still authored `Claude Code <noreply@anthropic.com>`. That is the identity #336's rule says no lane agent may use.

The rule allows such a mismatch only if it is noted on the PR, and it's only partly noted: the body's own forward-looking claim is contradicted by the log. The body needs a correction so that attestation and commits reconcile. This is a record fix, and nothing in the code depends on it.

## Merge-head attestation (Opus 5.5)

**Reviewed head:** `de9c5d1b5604d42d91d68cf24b87574f80b1a09c`

This is a fresh Opus 5.5 context, 2026-09-24, with `main` at
`8f545c3c1ae8ee3d5ac9b22d830ff52ab1fce918`. The last Opus delta was at code head `11478fe`,
recorded in note `8acbd60`, which changed only this file.

**Commits from `8acbd60` to `de9c5d1` that are not on `main`:** all three are merges, and
there is no non-merge code commit.
- `c610abc`: merge of `main@c4e1810` into `11478fe`
- `01f24b1`: merge of the remote branch, joining `c610abc` and `8acbd60`
- `de9c5d1`: merge of `main@8f545c3`

`git show --remerge-diff` is empty for all three, so none needed a manual resolution. The
PR's own added and removed lines are identical between `git diff 99a528c 8acbd60` and
`git diff 8f545c3 de9c5d1`; only the hunk offsets in `docs/03-features/work-items.md`
differ. That is the one overlapping file, touched by #338, and it auto-merged.

**Interaction with what `main` gained** (#308, #323, #334, #338, #354 and docs changes):
- The new route `GET /api/workspace/{workspaceId}/work-item-types` uses
  `workspaceAccess.fromParam` and `requireWorkspaceCapability("workspace:read")`.
  - At the merged head, `fromParam` still resolves the id from the path, then runs
    `validateWorkspaceAccess`. On a 403 it records the shadow legacy decision (#323/#354
    markers) and rethrows the 403. That matches the route's declared 400/403 responses and
    its `matrix.fixture.json` entry.
  - The controller is a single select scoped by `workspaceId`.
- The existing create and read routes keep `requireWorkItemReach`, which #354 extended with
  shadow markers only. Its legacy decision is unchanged.

**Tests at `de9c5d1`** (packages built first; private DB `opus_p1_test`, dropped afterwards):

| Suite | Result |
| --- | --- |
| `@taskdesk/permissions` | 13 files / 261 tests pass |
| `apps/api test:permissions` | 10 / 80 pass |
| `apps/api test:unit` | 58 / 488 pass |
| Integration: `work-item-*` (9 files, including `work-item-types`), `existence-oracle-317`, `permissions-shadow-mode` | 11 files / 472 tests pass |
| `pnpm --filter @taskdesk/web test -- <5 changed test files>` (vitest ran the whole web suite) | 67 files / 297 tests pass |

**CI at `de9c5d1`:**
- `pull request template + security review` failed on the STALE binding. That is expected,
  and this note clears it.
- GitGuardian (not required) re-reports incident 37541345, `charts/taskdesk/values.yaml:245`
  `passwordKey: postgres_uri`, via the main-merge commit `c610abc`. That line is from #308,
  and this PR does not touch `charts/`. It is a key name, so it is a false positive.
- Every other context was green.

**Verdict at `de9c5d1b5604d42d91d68cf24b87574f80b1a09c`: CLEAR.** The earlier findings carry
over unchanged.
