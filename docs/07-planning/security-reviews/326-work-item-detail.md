# Security review — work-item detail page and resolved display fields on `GET /api/work-items/{key}` (#23)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `66ac8282973515d86873ec109c1ffc9bfad36960`
**Pull request:** #326 (part of #23)
**Date:** 2026-09-23
**Verdict:** CLEAR WITH FINDINGS. No security finding blocks. The merge is still blocked by gate
items outside this review (see "Gates").

## Head verification

- `gh pr view 326 --json headRefOid` returned `66ac8282973515d86873ec109c1ffc9bfad36960`. Branch
  `feat/23-work-item-detail-page`, `MERGEABLE`.
- The merge base with `origin/main` is `dd067e21`. `origin/main` is now `33ce9ec` (#322), which
  this branch does not contain. `git merge-tree` against `origin/main` is clean. #322 changes
  `require-workspace-capability.ts`, `schema.ts` and two work-item integration test files. It does
  not change any file this PR changes.
- Reviewed commits: `3399423`, `798ca1b`, `21ee2f8`, `2d957af`, `66ac828`. This note's own commit
  only adds this file.

## Surfaces examined

- `apps/api/src/work-item/controllers/get-work-item.ts`: the whole file. The new single query and
  its joins (state, state_template, person, user, workspace_member), the workspace re-check and
  the `assigneeName` gate.
- `apps/api/src/work-item/index.ts`: `getWorkItemRoute`. Its middleware (`requireWorkItemReach()`,
  `requireWorkspaceCapability("work_item:read")`) is unchanged. Only the 200 schema changes.
- `apps/api/src/work-item/response.ts` (`workItemDetailSchema`) and the `tests/api-contract/openapi.json`
  delta.
- `apps/api/src/work-item/require-work-item-reach.ts`, which is unchanged: the NUL guard, the
  soft-deleted-project filter and the 403 → 404 remap.
- `apps/api/src/database/schema.ts`: `state_template`, `state`, `work_item`. Checked the composite
  FKs and the global unique `work_item.key`/`project.slug`.
- `apps/api/src/utils/seed-project-states.ts`. This is the only writer of `state.state_template_id`.
- Web: `routes/.../agent/work-items/$key.tsx`, `components/work-item/work-item-detail.tsx`,
  `fetchers/work-item/get-work-item.ts`, `hooks/queries/work-item/use-get-work-item.ts`,
  `types/work-item/index.ts` (`parseWorkItemDetailRow`, `extractDescription`), `lib/routes.ts`.
- `tests/api-integration/work-item-detail.test.ts`.
- `docs/01-architecture/rbac.md` (roles table, customer section), `docs/03-features/work-items.md`
  (WI-20/21, permissions, screens), `security-reviews/307-uniform-404.md`, and PR #320's note
  (`320-work-item-list-api.md` on `feat/310-work-item-list-api`), which covers S3, D0 and D2.

## What I probed

I used a private database, `pr326_opus_test` on td-lane-pg, and dropped it afterwards. The probe file
was scratch (`tests/api-integration/zz-opus-probe-326.test.ts`). It sent real HTTP through
`createApp()` and is not committed.

1. **Suites at this head.** All green:
   - API unit: **54 files, 412 tests**.
   - `test:permissions`: **10 files, 80 tests**. I ran it with no `apps/web/dist` on disk.
   - Integration: **80 files, 1086 tests**.
   - Web: **64 files, 306 tests**.
   - `check:openapi`: matches, **106 operations**.
   - `node --test 'scripts/ci/**/*.test.mjs'`: **495 tests, 88 suites, 0 fail**.
2. **Reach on `GET /api/work-items/{key}`.** I compared the full status, body and headers, minus
   `date`:
   - The owning member got 200.
   - A `viewer` got 200, and the body was byte-identical to the member's.
   - The owner of another workspace, using a valid foreign key, got 404 `Work item not found`. This
     was **byte-identical** to an unknown key under the same slug, and to `NOPE-1`.
   - An authenticated user with no workspace at all got the same 404 for both a foreign key and an
     unknown key.
   - An anonymous caller got 401.
   - A soft-deleted project gave the owner a 404 that was byte-identical to the missing-key 404.
   - A soft-deleted item gave a foreign caller the same 404 as an unknown key.
   - For the owner, an archived or soft-deleted item still returns **200**. This is pre-existing
     behaviour (see S2).
   - #290's property holds, and this PR does not weaken it.
3. **Mutation checks.** I restored the source after each one, and `git status` was clean afterwards.
   - I removed the 403 → 404 remap in `require-work-item-reach.ts`. Exactly two reach tests went red:
     `work-item-create-read-list` ("404s (not 403) … not a member") and `work-item-update`
     ("cross-workspace 404").
   - I replaced `row.assigneeIsWorkspaceMember ? row.assigneeName : null` with `row.assigneeName`.
     Exactly one test went red: `work-item-detail` "a foreign assignee's real name never resolves".
4. **New response fields and join scoping.** The only new fields are `stateName`, `stateCategory` and
   `assigneeName`. There is no requester, reporter, type or project-name resolution.
   - **Assignee.** I wrote the assignee by direct SQL as a person whose user is a `member` of *another*
     workspace. The response had `assigneeName: null`, and the name appeared nowhere in the body. This
     is **not** #320's unscoped assignee-name pattern: the name is gated on a `workspace_member` row
     in the *work item's* workspace (`get-work-item.ts:77-83`, `:101`).
   - **Duplicate memberships.** Two `workspace_member` rows for the same assignee returned one row,
     with the right id and the name. The join can fan out (#320 D2), but `.limit(1)` makes that
     harmless here.
   - **State.** `work_item(project_id, state_id)` is composite-FK'd to `state`. A cross-project
     `state_id` write was refused with `23503`. But `state.state_template_id` is a plain FK. I pointed
     the item's state at another workspace's template by direct SQL, and the response returned that
     foreign template's name. This path is latent (see S1).
   - **No OR expansion.** The query has one `eq(key)` WHERE and no `or()`/raw `sql` fragment, so
     #320's D0 pattern (an unparenthesised `OR` escaping the tenant scope) cannot occur here.
   - **Workspace re-check.** The controller re-checks `row.workItem.workspaceId !== workspaceId`
     (`:88`) as defence in depth over the middleware.
   - **Hidden fields.** `rbac.md` defines no per-field redaction for agent-side roles. No hidden field
     becomes visible. The response still carries the full row (32 keys, including
     `customerVisibility`, `serviceId`, `slaStartedAt` and `firstResponseAt`), as it did before this
     PR (S3).
5. **Key handling.** The key is never parsed. It is one bound `eq(work_item.key, $1)`, and
   `work_item.key` has a global unique index. I created projects with slugs `ab-12` and `ab` in the
   same workspace:
   - `ab-12-1` returned 200, and only its own item.
   - `ab-1`, `ab-121`, `AB-12-1` and `ab-12-01` returned 404.
   - `%00` and `ab-12-1%00` returned **400** `Invalid work item key`.
   - `%25`, `ab-12-%25`, `_b-12-1` and `ab-12-_` returned 404, so LIKE wildcards are inert.
   - `' OR 1=1--`, `ab-12-1' OR '1'='1` and `; DROP TABLE work_item;--` returned 404.
   - A 10,000-character key, an RTL override, a truncated UTF-8 escape, `..%2F..%2Fetc`, `%0A` and a
     literal `\x00` all returned 404.
   - **No 500 anywhere.**
6. **Web.**
   - Nothing uses `dangerouslySetInnerHTML`, `innerHTML` or a markdown renderer. The description is
     reduced to plain text by `extractDescription` and rendered as a React text node in
     `whitespace-pre-wrap`. The title, key, state, assignee and project name are all text nodes.
   - The project link is a router `Link` built from `project.slug` in the caller's own projects
     list.
   - The query key is `["work-items", "detail", key]`. `key` is instance-unique, so there is no
     cross-project collision.
   - It uses no `placeholderData` or `keepPreviousData`, so no row from a previous key can render
     under a new one.
   - Sign-out calls `queryClient.clear()`, and a 401 does a full `location.replace`. There is no
     persister.
   - A 404 renders one "doesn't exist, or you don't have access" state, which keeps the uniform
     answer.
   - #320's cross-project cache bleed pattern is not present.

## Findings

**S1 — NON-BLOCKING (latent). `stateName`/`stateCategory` resolve through an unscoped
`state.state_template_id` FK.**
- Where: `get-work-item.ts:55-58`, and `schema.ts:1463`, which is a plain FK to `state_template.id`.
  Nothing in the schema requires the template to belong to the project's workspace.
- Reproduced by direct SQL: another workspace's template name ("FOREIGN SECRET STATE") appeared in the
  response.
- Not reachable through any API today. The only writer, `seed-project-states.ts`, selects templates
  `WHERE workspace_id = <project's workspace>`.
- The disclosure is a state label, which is low sensitivity.
- The same join exists in #320's list route. #320's note said "a row's state is always the
  project's own". That is true of `state`, but not of `state_template`.
- **Recommendation:** add `eq(stateTemplateTable.workspaceId, workItemTable.workspaceId)` to the join
  condition. This keeps the INNER JOIN semantics, because a mismatched template would be corrupt
  data. Also add a composite FK, or a trigger, that pins `state_template.workspace_id` to the state's
  project workspace before any template-editing or state-editing route lands. Do both in #320 and
  here, so the two resolutions stay identical.

**S2 — NON-BLOCKING, pre-existing. The detail read returns archived and soft-deleted items (200,
full body) to in-reach callers, and the page gives no indication.**
- `main`'s `getWorkItemByKey` did not filter them either.
- WI-21 excludes them only from "the default list/board/search filters", so a direct read by key is
  defensible.
- Nothing sets `archived_at`/`deleted_at` today.
- **Recommendation:** when the delete/archive slice lands, decide explicitly whether a deleted item's
  detail stays readable during the 30-day window. If it does, render a "deleted"/"archived" banner.

**S3 — NON-BLOCKING, pre-existing. The 200 body still carries the full `work_item` row (32 keys), of
which the declared `WorkItemDetail` schema describes 25 (`WorkItem`'s 22 plus the 3 new fields).**
- The PR states this.
- It is not a disclosure today, because every agent-side role that can reach this route may read the
  whole row.
- A future portal or customer twin must not reuse this controller. The customer rules in `rbac.md`
  are behavioural, and a whole-row return is the wrong shape for them.

**S4 — NON-BLOCKING, pre-existing, fixed on `main` since this branch's base.** At this head, a
`workspace_member` whose role is literally `customer` gets 200 on this route. This is #320's S4.
- #322 (`33ce9ec`, now on `main`) reworks `builtInRoleHasCapability` and reserves the built-in names.
- This PR does not touch that file.
- Re-confirm after the branch takes `main`.

The four non-blocking pre-existing and latent notes above do not require a change in this PR. S1
should be tracked, jointly with #320.

## Gates (checked at this head; not security findings, but each blocks the merge)

- **CI:** every required check is green except **"pull request template + security review"
  (FAILURE)**. `node scripts/ci/check-pr-template.mjs --body` reports 4 problems:
  1. and 2. The `## Security review` section has no Opus model or session, and does not link this
     note. The orchestrator fills these in from this note.
  3. **There are two independent-review checkboxes.** The PR body's "Any change" list adds
     `- [x] **Independent review completed and recorded**` (body line 124), which is not in
     `definition-of-done.md`'s "Any change" list. Remove it, and leave the Backend change item as
     the only one.
  4. The Opus box in "Backend change" is unticked. This review closes it.
- **Ordinary independent review:** the comments record three ordinary rounds (at `21ee2f8`, `2d957af`
  and `66ac828`) and one alignment check (at `2d957af`), each with its full SHA. **None names the
  reviewer's model.** `## Reviewed by` says only "fresh, independent reviewer contexts". I cannot
  verify that the reviewer was a different agent from DeepSeek, or what tier it ran at. The
  orchestrator must record the model for at least the review at the final code head.
- **`## Implemented by` vs commit author:** the body names DeepSeek V4.1 Flash (Copilot). All five
  commits are authored `Claude Code <noreply@anthropic.com>`. This is **unreconciled**. The
  orchestrator's own 16:29 comment already says the PR won't merge until attestation and commits
  agree, per the 2026-09-23 decision-log entry (#336).
- **Branch behind `main`:** this branch does not contain #322. If it is updated after this note, the
  code head changes. The merge is clean and touches no file in this diff, but the reviewed-head
  binding then needs an explicit exact-head re-confirmation: either a delta note appended here that
  names the new 40-character SHA, or an update to the branch before this note is linked.

## Verdict

**CLEAR WITH FINDINGS** at `66ac8282973515d86873ec109c1ffc9bfad36960`.

- Reach and authz are byte-identical to `main`. Foreign and nonexistent keys give identical answers.
  The new name resolution is scoped to the item's own workspace, and a mutation check proves it.
- Every value is bound as a parameter. There is no `OR` expansion. Malformed keys give 400 or 404,
  never 500.
- The web page renders only text and has no cross-key or cross-user cache path.
- S1–S4 are non-blocking. The gate items listed above must be resolved before the orchestrator
  merges.

## Merge-head attestation (Opus 5.5)

**Reviewed head:** `177f465c69cff695a8cc3f91b082b5c50df76cdb`

This is a fresh Opus 5.5 context, 2026-09-24, with `main` at
`8f545c3c1ae8ee3d5ac9b22d830ff52ab1fce918`. The last Opus review was CLEAR WITH FINDINGS at
`66ac828`.

**Commits from `66ac828` to `177f465` that are not on `main`:**
- `a948b32`: this note only.
- `177f465`: merge of `main@8f545c3`. `git show --remerge-diff` is empty, so no manual
  resolution.

There is no non-merge code commit. `git diff dd067e2 a948b32` and `git diff 8f545c3 177f465`
are byte-identical (same sha256), and no file overlaps with `main`.

**#338 existence-oracle check:** `GET /api/work-items/{key}` still answers identically for
a foreign key and a missing one.
- `requireWorkItemReach` 404s a missing or soft-deleted key with "Work item not found".
- It catches any 403 from `validateWorkspaceAccess` and rethrows the same
  `HTTPException(404, "Work item not found")`. That is broader than #338's message-specific
  catch, so it is at least as uniform.
- The controller's own re-check throws the same 404.
- A temporary integration probe, not committed, compared three cases from a stranger's
  session: an existing foreign key, `{slug}-999999` and `nosuchslug-1`. Status,
  `content-type`, the set of header names and the body were all equal. 1 / 1 passed.
- Timing still differs by one `validateWorkspaceAccess` query. That is the known #317 timing
  residue S1, already open, and it is not new here.

**Other interaction:** #354 added shadow markers to `requireWorkItemReach` only; the legacy
decision is unchanged. The `assigneeName` workspace-member gating is unaffected by #334 and
#322.

**Tests at `177f465`** (packages built first; private DB `opus_p1_test`, dropped afterwards):

| Suite | Result |
| --- | --- |
| `@taskdesk/permissions` | 13 files / 261 tests pass |
| `apps/api test:permissions` | 10 / 80 pass |
| `apps/api test:unit` | 58 / 488 pass |
| Integration: `work-item-*` (9 files, including `work-item-detail`), `existence-oracle-317`, `permissions-shadow-mode` | 11 files / 470 tests pass |
| `pnpm --filter @taskdesk/web test -- <3 changed test files>` (vitest ran the whole web suite) | 64 files / 306 tests pass |

**CI at `177f465`: a required check fails on a real interaction with #355.**
`contract - OpenAPI drift` fails. #355 added the `oasdiff breaking --fail-on WARN` step
after this PR's last review; at `66ac828` the context passed without that step.
- The PR changes the 200 schema of `GET /work-items/{key}` from `WorkItem` to
  `WorkItemDetail`, which is `allOf: [WorkItem, {stateName, stateCategory, assigneeName}]`.
- oasdiff compares `allOf` branches one at a time. It reports
  `response-required-property-removed` WARNs for every `WorkItem` field (`stateId`,
  `title`, `typeId`, `updatedAt`, `version`, `workspaceId`, …).
- Nothing is actually removed: the change is additive. But the required gate fails, so this
  head is **not merge-ready**.
- The fix belongs to the lane. Either emit a flattened schema, not the `allOf` from
  `.extend()` on a registered schema, or change the gate. A gate change is under
  `scripts/ci/**` and needs its own review. Either way it is a new commit and needs a
  delta review.

Other CI: `pull request template + security review` failed on the STALE binding, which is
expected and cleared by this note. GitGuardian (not required) re-reports incident 37541345,
the `values.yaml` key-name false positive from #308, via this merge commit.

**Verdict at `177f465c69cff695a8cc3f91b082b5c50df76cdb`: security CLEAR, not merge-ready**
until `contract - OpenAPI drift` is green. The earlier findings carry over unchanged.
