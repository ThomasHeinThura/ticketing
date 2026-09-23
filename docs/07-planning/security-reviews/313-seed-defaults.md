# Security review — seed default work-item types, state templates and project states (#309)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `2298257f324112363113e267933c6dc2d2c8dd28`
**Reviewed SHA:** `2298257f324112363113e267933c6dc2d2c8dd28` (confirmed via `gh pr view 313 --json headRefOid`, before starting and again on resuming after an interruption; PR code at `525814f`; `2298257` is a clean `main` merge: `git diff 6061a9d 2298257` is exactly the PR's 7 files, and the merge touches none of them)
**Pull request:** #313 (closes #309)
**Date:** 2026-09-23

## Surfaces examined

- `apps/api/src/project/controllers/create-project.ts`: the whole transaction, including advisory lock `1524`, the slug claim, the columns, and the new `seedProjectStates` call at `:125`
- `apps/api/src/workspace/controllers/create-workspace.ts`: the whole transaction, including the new `seedWorkspaceDefaults` call at `:195`
- `apps/api/src/utils/seed-project-states.ts`, `seed-workspace-defaults.ts`, `default-state-templates.ts`, `default-work-item-types.ts`
- `apps/api/src/project/index.ts` (the `createProjectRoute` middleware and handler) and `project/schema.ts` (`createProjectBody`)
- `apps/api/src/utils/workspace-access-middleware.ts` (`fromBody`, `validateWorkspaceAccess` call)
- `apps/api/src/workspace/index.ts` (`createWorkspaceRoute`: `requireSessionOnly()`, `requireWorkspaceCreationAllowed`), `workspace/policy.ts` (`POST /api/workspace`), `utils/require-session.ts`
- `apps/api/src/auth.ts`: the plugin list (`anonymous()` is removed, `:213`) and `rateLimit` (sign-up is 3 per 60 s per IP)
- `apps/api/src/work-item/controllers/create-work-item.ts`, `work-item/require-work-item-reach.ts`, `work-item/index.ts` (the create route middleware), `work-item/policy.ts`
- `packages/permissions/src/roles.ts`: which roles hold `work_item:create` (lead and member, not viewer)
- `apps/api/src/database/schema.ts`: `workItemTypeTable`, `stateTemplateTable`, `stateTable` (FK `ON DELETE RESTRICT` to template, `state_project_default_unique`)
- `workspace/controllers/delete-workspace.ts`, `user/controllers/delete-account-data.ts`: the hard-delete cascade now has to pass through `state → state_template RESTRICT`
- `tests/api-integration/workspace-project-default-seed.test.ts`

## What I probed

Private DB `pr313_opus_test` on td-lane-pg. I dropped it afterwards. The probe files were scratch and are not committed.

1. **Suites at this head.**
   - Integration: **75 files, 1029 tests, all passed.**
   - API unit: **52 files, 349 tests, all passed.**
   - `test:permissions`: **10 files, 80 tests, all passed.**
   - `node --test 'scripts/ci/**/*.test.mjs'`: **495 tests, 88 suites, 0 fail.**
2. **Tenancy of the seeded rows.**
   - `seedProjectStates` reads templates scoped by `workspaceId` and `archived_at IS NULL` (`seed-project-states.ts:55`).
   - That `workspaceId` is `c.get("workspaceId")`, which `workspaceAccess.fromBody()` set only after `validateWorkspaceAccess`. The handler never reads `workspaceId` from the body itself, so the id that was authorized and the id used for seeding can't diverge.
   - The same id is also written as the new project's `workspace_id`, so a project's states can only come from its own workspace's templates.
   - `seedWorkspaceDefaults` writes only `workspace.id` from the row just inserted in the same `tx`.
   - Live checks:
     - (a) A signed-in outsider posting `POST /api/project` with another tenant's `workspaceId` got **403**. The row counts of `work_item_type`, `state_template`, `state`, `project` and `workspace` were unchanged.
     - (b) The outsider's own project got 5 states, and every one joined to a template in the outsider's own workspace only.
3. **Archived templates.** I archived the `unstarted` template, then created a project. It got 4 states and no archived template was adopted. Exactly one default was set, falling back to `backlog` via `ordered[0]` (`:76`).
4. **Who can trigger it.**
   - The PR changes no route, middleware, policy entry or capability.
   - Workspace creation is still session-only (`requireSessionOnly`), refuses API keys and impersonation, and is gated by `DISABLE_WORKSPACE_CREATION`.
   - `anonymous()` is not registered (`auth.ts:213`), so there is no guest user who could create a workspace.
   - Project creation still needs workspace membership plus `project:create`.
   - Amplification is bounded and constant: +14 rows per workspace (9 types, 5 templates) and +5 per project. There are no loops over caller input and no caller-controlled cardinality.
5. **Transactions and locks.**
   - Both seed calls take the enclosing `tx`.
   - I re-verified the project path myself with a mutation. I injected a `throw` after the `state` insert in `seed-project-states.ts` and drove the real `POST /api/project`. It returned **500** and left **0** `project`, `state`, `column` and `project_slug_claim` rows. I then restored the file and confirmed the worktree was clean.
   - Concurrency: I ran 12 parallel project creates in one workspace plus 6 parallel workspace creates by the same user. All 18 returned 200 in 286 ms, with no deadlock. Every project had exactly 5 states and exactly 1 default.
   - Lock ordering: the only other taker of advisory key `1524` is `reorderProjects`, which is unchanged. The new inserts add only FK `KEY SHARE` locks on template rows of the caller's own workspace. There is no writer that updates or deletes `state_template` yet (the editing seam is #314), and workspace delete takes no advisory lock, so no new lock cycle is possible.
6. **Downstream reachability.** `POST /api/projects/{projectId}/work-items` on a seeded project returned:
   - **403** for a `viewer` member (no `work_item:create`)
   - **403** for a non-member (`fromProject` → `validateWorkspaceAccess`)
   - **400** for a `member` passing another workspace's seeded `typeId` (WI-1 check)
   - **200** for a `member` with a same-workspace type. Exactly one `work_item` row existed afterwards.

   Nothing the seed makes reachable bypasses `requireWorkspaceCapability` or the controller's workspace-scoped project and type checks. The work-item-by-key read routes (`require-work-item-reach.ts`) are unchanged and were already covered by the suites.
7. **Delete cascade.** `state.state_template_id` is `ON DELETE RESTRICT`, so I checked that seeding doesn't make workspaces undeletable. `DELETE /api/workspace/{id}` on a workspace with a seeded project returned **200**, both with and without a work item. All five tables were left at 0 rows.

## Findings

**S1 — NON-BLOCKING, defence in depth, pre-existing schema.** No DB constraint pins
`state.state_template_id` to a template in the project's own workspace
(`apps/api/src/database/schema.ts:1463`: a plain FK to `state_template.id`, with no composite
`(workspace_id, id)` FK of the kind #192 added for `work_item`). Today the only writer is
`seedProjectStates`, which is correctly scoped (probe 2), so nothing is exploitable. The future
Project settings → States surface (#314) should either add the composite FK or scope its template
lookup by the project's workspace the same way.

**S2 — NON-BLOCKING, already tracked.** `seedProjectStates`' check-then-insert idempotence
depends on the caller's advisory lock. It is only called from inside `create-project.ts`'s locked
transaction, so it is safe today. The ordinary reviewer already folded this into the backfill
follow-up. A backfill that calls it outside that lock would need its own lock or a unique
constraint.

**S3 — NON-BLOCKING, informational, pre-existing.** There is no per-user cap on workspace
creation beyond the sign-up rate limit and `DISABLE_WORKSPACE_CREATION`. This PR raises the rows
written per create by a small constant (+14), which does not change the abuse picture in any
material way. Instances that don't want self-serve workspaces should set the flag.

## Verdict

**CLEAR WITH FINDINGS at `2298257f324112363113e267933c6dc2d2c8dd28`.** There are no blocking findings.
Seeding writes only into the workspace or project being created, under the same transaction.
It widens no authority. Work-item creation that it newly makes reachable is still refused
for under-privileged members, non-members and cross-workspace types.
