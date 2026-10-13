# PR #726 security review record: project default comment visibility (CA-2)

PR #726 lets `PUT /api/project/{id}` accept an optional `defaultCommentVisibility` (`public` or `internal`), stored in the existing `default_comment_visibility` column from migration 0083. It changes no migration.

**Capability check.** Sending the field requires the strict `project:manage_settings` capability, with any API-key scope intersected. The handler checks this after body validation and before any read or write. Omitting the field keeps today's update behaviour.

**Web.** The project General settings page shows the control only with the strict `manageProjectSettings` flag. The agent composer preselects the project default from the visibilities the caller may use. Comment create still requires an explicit visibility, and the server checks that visibility on its own; it never uses the default.

A Claude Sonnet 5.5 lane implemented the change. The reviewers below are fresh, independent contexts that did not author, direct or remediate it.

## Review chain

- Ordinary review A by Claude Sonnet 5.5 (handler check, value domain, composer, mutation): APPROVE at `46b45736`.
- Ordinary review B by Claude Sonnet 5.5 (spec alignment, migration, web UX, test quality): APPROVE at `46b45736`.
- Security review by Claude Opus 5.5: CLEAR at `46b45736`, with mutations of the handler check and four non-blocking notes.

**Reviewed head:** `46b457361b5808313fde952ffc8c9dbab7b4c6de`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `726-ordinary-a-sonnet.md` | Ordinary review A (28481af5..46b45736) | Claude Sonnet 5.5 | `46b45736` | APPROVE | `a44596a430e1e5a09758038d2940c18bc7f71b30378c6c28d5ecdfb825183e65` |
| 2 | `726-ordinary-b-sonnet.md` | Ordinary review B (28481af5..46b45736) | Claude Sonnet 5.5 | `46b45736` | APPROVE | `acd735c1b81da4db5dd7ed6ee2b1a166fb5abaeafa0a5a31339c55aae8e7a7f7` |
| 3 | `726-security-opus.md` | Security review (28481af5..46b45736) | Claude Opus 5.5 | `46b45736` | CLEAR | `7dda7a93e873cc7718532ee90e5a15673541c5a2e813184ad35506b666bce33e` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/726-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 a44596a430e1e5a09758038d2940c18bc7f71b30378c6c28d5ecdfb825183e65) -->
# PR #726 ordinary review A (CA-2 project default comment visibility)

Model: Claude Sonnet 5.5 (fresh independent context, reviewer A; did not author or direct the change)
**Reviewed head:** 46b457361b5808313fde952ffc8c9dbab7b4c6de
Base: origin/main 28481af5

## Files examined
apps/api/src/project/{index.ts,policy.ts,schema.ts,response.ts,controllers/update-project.ts}; apps/api/src/work-item/comment-schema.ts (enum); tests/api-integration/project-default-comment-visibility.test.ts; apps/web/src/components/project/default-comment-visibility-setting{,.test}.tsx; apps/web/src/fetchers/project/update-project.ts; apps/web/src/hooks/use-workspace-permission{,.test}.ts(x); settings route general.tsx; work-item-activity.ui.test.tsx and work-item-activity.tsx/work-item-detail.tsx (composer seed); i18n/*.json (all 18 locales + en-US); packages/ui/src/styles/pairs.json; tests/api-contract/openapi.json; impl notes ca2-impl-sonnet.md.
Not re-read in full: the spec docs (CA-2, settings-hierarchy, rbac, #708) were not opened separately; I relied on the code comments and tests citing them.

## Commands run (scratch worktree at exact head, removed afterwards)
- pnpm install --frozen-lockfile: ok
- pnpm check:openapi: pass; pnpm check:route-policy: pass; pnpm check:i18n: all locales in sync
- Integration, CI=true, --no-file-parallelism, new file: 20/20 pass
- Integration filters `project comment capabilities work-item-detail`: 26 files / 256 tests pass
- Mutation: removed the handler's manage_settings check block only: 5 of 20 new tests fail (member and lead 403, customer-side legacy claim 403, key scoped to project:update only, member-owner key). Restored via git checkout; the worktree was clean.
- pnpm test:permissions: 14 files / 88 tests pass
- Web vitest (components/project, work-item-activity.ui, use-workspace-permission): 5 files / 34 tests pass

## Findings against the checklist
1. Handler (index.ts ~line 907-926): check is inside the handler, after body validation (route middleware runs first, then validator), before the first DB read/write, only when `body.defaultCommentVisibility !== undefined`. It uses assertCallerHasCapability with the strict `project:manage_settings` and capabilityCredential(apiKey), so the key scope is intersected. Sending the field with other fields cannot bypass it: the check is on the field's presence, and the test bundles a rename and asserts the name stays unchanged on 403. The omitted-field path is unchanged (tested). No other route writes the column: createProjectBody does not declare the field (zod strips it), and grep shows only update-project.ts sets it. OK.
2. Value domain reuses `commentVisibility` (z.enum public|internal) from work-item/comment-schema. Invalid values ("private", "PUBLIC", "", null, 1, true) return 400 via the shared apiRouter validation hook, matching repo convention; tests assert nothing is written. OK.
3. Composer: the column is returned by get-work-item, work-item-detail.tsx:262 passes it as defaultVisibility, work-item-activity.tsx seeds state from it (lines 169-179, 291-292). New tests cover both defaults and fallback when the caller lacks the capability, plus an API test that the work-item read serves the updated value. OK.
4. Web: component returns null without canManageProjectSettings (strict flag from capabilities); Select disabled when !project, pending, or !canManageProjects (legacy update); save path sends the full body plus the field, invalidates ["projects"] and ["work-items"]; fetcher only includes the field when set, so plain renames still work. i18n keys present in all 19 locale files (en + 18), label/hint translated. pairs.json additions are generated entries for the new component and Select popup caller chain; legitimate, and check:tokens was not re-run by me (impl notes say pass).
5. Tests non-vacuous: mutation above confirmed.

## Non-blocking observations
- N1 default-comment-visibility-setting.tsx:~66-75: no unit test for the "disabled when legacy canManageProjects is false" branch (claimed in the PR). Behaviour is by inspection only.
- N2 default-comment-visibility-setting.tsx:~58: the save re-sends name/slug/description/icon from the cached project, so a concurrent rename elsewhere could be overwritten by a stale cache (last-write-wins). Also a null description becomes "". Low risk; same shape as the existing form.
- N3 The 5 mutation failures do not include the "owner/admin success" cases, as expected (they pass either way). The positive manage_settings holders (owner/admin/manager) are covered by the persistence tests.
- N4 No e2e/browser run of the settings page; route-level mount of the control is untested (acknowledged in impl notes).

## Residual risk
Policy map still declares baseline project:update for the route; the extra check lives in the handler, so the route-policy gate cannot see it. A future refactor that moves validation or drops the block is guarded only by the integration tests. check:tokens/contrast, lint, typecheck, API unit suite and full web vitest were not re-run by me.

## Verdict
APPROVE (no blocking findings). Security-scope: Sol exact-head review still required.
<!-- END REPORT (sha256 a44596a430e1e5a09758038d2940c18bc7f71b30378c6c28d5ecdfb825183e65) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/726-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 acd735c1b81da4db5dd7ed6ee2b1a166fb5abaeafa0a5a31339c55aae8e7a7f7) -->
# PR #726 ordinary review B (Claude Sonnet 5.5)

**Reviewed head:** 46b457361b5808313fde952ffc8c9dbab7b4c6de
**Base:** 28481af5826035d702f705ea599858f27634a84b (origin/main)
**Model:** Claude Sonnet 5.5 (fresh context; did not author, direct or remediate the change)

## Files examined
apps/api/src/project/{index,schema,response,policy}.ts and controllers/update-project.ts; apps/api/src/database/schema.ts (project column); apps/api/drizzle/0083_project_default_comment_visibility.sql (existing, not in diff); work-item get/detail wiring; apps/web components/project/default-comment-visibility-setting.tsx (+test), fetchers/project/update-project.ts, hooks/use-workspace-permission.ts (+test), settings project general.tsx, work-item-activity.ui.test.tsx; i18n/en-US.json (+18 locales via check:i18n); tests/api-contract/openapi.json; tests/api-integration/project-default-comment-visibility.test.ts; docs/03-features/comments-and-activity.md (CA-2), data-model.md line 268, rbac.md (project:manage_settings, capabilities flag line 528); issue #708 body.

## Spec / ADR alignment
- Column `default_comment_visibility`, `public|internal`, default `internal` NOT NULL: matches CA-2 and data-model.md. Column and migration 0083 already exist on main.
- No migration in this diff: nothing to reverse, no accepted migration touched. Existing rows already default `internal`.
- API: optional `defaultCommentVisibility` on PUT /api/project/{id}, enum reused from comment schema; omitted = unchanged. Response exposes it as required enum; OpenAPI regenerated and check:openapi passes.
- Who may change it: handler-level strict `project:manage_settings` (rbac.md: owner/admin/manager) plus API-key scope, checked after body validation and before any read/write. Rationale (legacy `project:update` grants members; #708) is sound. Route policy keeps baseline `project:update`; comment in policy.ts explains the extra check. Web flag `manageProjectSettings` already documented in rbac.md.
- Docs: CA-2 spec and data-model already describe the field; rbac.md already lists the capability. No doc update missing. (Optional: a short status/decision-log note is orchestrator-owned.)

## Web UX
- Control hidden without strict capability; disabled while project loading, while pending, and without legacy manageProjects; labelled via label/htmlFor; i18n keys added in all 19 locales; toasts on success/error; invalidates ["projects"] (covers detail key) and ["work-items"] (item payload carries the default).
- Composer default: work-item-detail passes item.defaultCommentVisibility; activity tests cover both defaults and fallback when the caller lacks public capability.
- Reviewer A's notes: stale cached fields re-sent and null description to "" are non-blocking. The general.tsx autosave already sends `project.description ?? ""` and cached name/slug/icon for unchanged fields, so this is identical to main's behaviour, not a regression; the PUT contract requires all four fields. Only theoretical window: a concurrent edit by another admin between cache load and select change (same race as the existing form; tracked by #526).
- Minor observation (non-blocking, pre-existing): work-item-activity.tsx resets composer visibility when the default prop changes, which could replace an in-progress choice if the default changes while composing.

## Tests
Integration (20 tests) cover seed/default, both values, switch back, omitted field, invalid values (6), member/lead denied, baseline denial, customer role, API key scopes (3), composer default read. Mutation I ran: disabling the controller's write of the field made 6 of 20 fail (non-vacuous). Web tests cover hidden/shown/save payload/invalidations/unchanged/error/disabled. Missing negatives (all minor): no test that a manager-with-key lacking scope... covered; no web test of the success path for a role with manageProjectSettings=true but manageProjects=false (control disabled) -- trivial.

## Commands (scratch worktree at exact head, removed afterwards)
- pnpm install --frozen-lockfile: exit 0
- project-default-comment-visibility integration (CI=true, Testcontainers private DB): 1 file, 20 tests passed, exit 0
- pnpm test:permissions: 14 files / 88 tests passed, exit 0 (turbo partly cache-replayed)
- pnpm check:openapi: exit 0 (282 operations); pnpm check:route-policy: exit 0 (14 files/88 tests); pnpm check:i18n: exit 0
- pnpm lint: exit 0 (8 tasks); pnpm typecheck: exit 0 (9 tasks, 4 cached)
- web vitest (setting test, work-item-activity.ui, use-workspace-permission): 3 files / 30 tests passed, exit 0
- Own scratch Postgres container created and removed by exact id; no other container touched.

## Not checked
Full integration suite and full web suite; browser/visual rendering of the settings page; a11y tooling run; Docker image/boot; the second mutation (web guard) did not apply, so web non-vacuity rests on reading the tests.

## Findings
Blocking: none.
Non-blocking: (1) stale-cache re-send / null->"" (same as main); (2) composer reset on default change (pre-existing).

**Verdict:** APPROVE
<!-- END REPORT (sha256 acd735c1b81da4db5dd7ed6ee2b1a166fb5abaeafa0a5a31339c55aae8e7a7f7) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/726-security-opus.md; Claude Opus 5.5; sha256 7dda7a93e873cc7718532ee90e5a15673541c5a2e813184ad35506b666bce33e) -->
# PR #726 security review (CA-2 project default comment visibility)

**Reviewed head:** 46b457361b5808313fde952ffc8c9dbab7b4c6de
**Base:** origin/main 28481af5826035d702f705ea599858f27634a84b (merge base = base)
**Model:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context; did not author, direct or remediate the change.
**Head verified:** `gh pr view 726 --json headRefOid` = 46b457361b5808313fde952ffc8c9dbab7b4c6de. Scratch worktree, detached at that SHA, created for this review and removed afterwards.

## Files and surfaces examined
- apps/api/src/project/index.ts (updateProjectRoute, middleware chain, handler ~lines 901-975)
- apps/api/src/project/controllers/update-project.ts, schema.ts, response.ts, policy.ts
- apps/api/src/project/controllers/create-project.ts (insert: field not written)
- apps/api/src/utils/require-workspace-capability.ts (assertCallerHasCapability, capabilityCredential)
- apps/api/src/capabilities/controllers/get-capabilities.ts (manageProjectSettings flag)
- apps/api/src/work-item/comment-schema.ts, controllers/create-comment.ts, controllers/get-work-item.ts
- packages/permissions/src/{capabilities,roles}.ts; docs/01-architecture/rbac.md (role matrix, line 528)
- apps/web: default-comment-visibility-setting.tsx, fetchers/project/update-project.ts, hooks/use-workspace-permission.ts, settings general.tsx, work-item-activity.tsx (composer seed), portal routes and apps/api/src/portal-client-routes.ts
- tests/api-integration/project-default-comment-visibility.test.ts
- A repo-wide grep for every writer of `default_comment_visibility` / `defaultCommentVisibility` and every `insert/update(projectTable)`
- The two Sonnet ordinary review notes. I read them and checked their claims against the source.

## Answers to the security questions
1. **Who can change the default without strict `project:manage_settings`?** Nobody, on any path I found.
   - **Only writer.** The only code that writes the column is `update-project.ts`, reached only from `PUT /api/project/{id}`.
     - Project create: `createProjectBody` has no such field, so zod strips it. The insert does not set it, and the column defaults to `internal`.
     - Other routes: no PATCH, bulk, import, admin, SCIM or plugin route writes it.
     - The other `update(projectTable)` sites only touch health, position, deletion, archive and number counters. No raw SQL writes it either.
   - **When the check runs.** The handler checks whenever the field is present, so bundling it with other fields does not avoid the check. A 403 aborts before the transaction, and the test confirms a bundled rename is not written.
   - **Who passes.**
     - Sessions follow the canonical role matrix: owner, admin and manager pass.
     - Lead, member and customer get 403, even when their stored legacy map grants `project:update`.
     - API keys must also carry the `project:manage_settings` scope, which `apiKeyHasCapability` checks first. The key scope cannot widen a member's role.
     - Project-scoped role grants do not raise workspace-role authority, so this fails closed.
   - **No confused deputy.** `workspaceId` comes from `workspaceAccess.fromProject()` (it is read from the project row), not from request input. This matches contract note 1 of `assertCallerHasCapability`.
2. **Ordering and oracle.**
   - The check runs after route middleware (project reach and the legacy `project:update` check) and after body validation. It runs before the handler's first DB read (`current` select) and before any write.
   - A caller without project reach is still answered by the unchanged middleware. The new 403 is only reachable by a caller who has already passed workspace access and `project:update` on that project.
   - So no new 403-vs-404 project-existence oracle is introduced. An invalid value returns 400 before the check, and nothing is written.
3. **Can the default expose an internal comment or flip a customer's comment?**
   - The server never uses the project default when creating a comment. `createCommentBody.visibility` is required with no default (CA-1).
   - `createComment` picks `comment:create` or `comment:create_internal` from the explicit body value, whatever the project default is.
   - In the composer, the default only seeds the selector. The selector is still limited to the visibilities the caller's capability flags allow.
   - The column defaults to `internal`, and the value shown is always the explicit value sent.
   - Portal: no portal route or component imports the setting, the fetcher or the field. The setting is mounted only under `routes/agent/.../settings/projects/$projectId/general.tsx`.
   - The value is also exposed on `GET /api/project/{id}` and on the agent work-item read. That second exposure was already on main and is unchanged here. It is a non-sensitive configuration value.
4. **Web flags vs server checks.** The web flag `manageProjectSettings` is computed by the same `assertCallerHasCapability(..., "project:manage_settings", capabilityCredential(apiKey))` the handler uses, so the UI does not grant anything the server refuses.
   - The UI also disables the control when the legacy `manageProjects` flag is false. That mirrors the route's `project:update` middleware.
   - The server enforces both checks independently, so the UI gating is cosmetic only.
5. **Validation.** The value domain is `z.enum(["public","internal"])`, `.optional()`. `null`, the empty string, a different case, a number, a boolean and unknown strings all get 400 with nothing written (tested). A DB CHECK constraint (migration 0083) backs this up.
6. **Are the tests non-vacuous?** Yes. Two mutations were run (below).

## Tests and reproductions run (scratch worktree at exact head, serialized)
| Command | Result | Exit |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | ok | 0 |
| `CI=true vitest --config vitest.integration.config.ts project-default-comment-visibility` | 1 file, 20/20 passed | 0 |
| **Mutation 1:** handler check disabled (`if (false && ...)`) | 5 failed / 15 passed: member 403, lead 403, customer 403, key scoped to project:update only, member-owner key with manage_settings scope | 1 (expected) |
| **Mutation 2:** handler capability weakened to `project:update` | 2 failed / 18 passed: lead 403, key without manage_settings scope | 1 (expected) |
| Source restored with `git checkout`; clean tree and HEAD re-verified | 46b45736 | 0 |
| `pnpm test:permissions` | 14 files / 88 tests passed | 0 |
| `pnpm check:route-policy` | passed (its permissions suite: 14 files / 88 tests; turbo partly cache-replayed) | 0 |
| `pnpm check:openapi` | matches the API (282 operations) | 0 |
| `CI=true` integration: project.test, project-managed-service, project-reach-guard, capabilities-scope, work-item-comment, comment.test, work-item-detail, intake-portal-response-shape, portal-identity-boundary, project-default-comment-visibility | 10 files / 104 tests passed | 0 |
| Web vitest: default-comment-visibility-setting, work-item-activity.ui, use-workspace-permission | 3 files / 30 tests passed | 0 |

**Postgres.** Every integration run used the harness's own Testcontainers Postgres (`taskdesk_test`, `CI=true`), which the harness stops itself. The only extra container my runs created was the Testcontainers ryuk reaper (9a159c0f4cde), and it exited and removed itself. Before and after container ID lists were compared. No other container, volume or network was touched.

## Findings
**Blocking:** none.

**Non-blocking:**
- **NB1.** The strict check lives in the handler, so the route-policy map and `check:route-policy` only see the `project:update` baseline. Only the integration tests guard regressions (mutations 1 and 2 confirm they do). The same pattern already exists for `work_item:set_priority` and comment visibility. A future structural option is a declarable field-level policy.
- **NB2 (UX, not authorization).** A project set to `public` makes the agent composer start on Public. An agent could then post a customer-visible comment by inattention. CA-2 authorizes this behaviour, the selector stays visible, and the server still requires an explicit value. The column default stays `internal`.
- **NB3.** The settings control re-sends cached name, slug, description and icon. A null description becomes "". The stale-cache last-write-wins race is the same as main's general form, with no authorization impact.
- **NB4.** Caller-without-reach cases (another workspace, a non-member) have no new test specific to this field. They are covered by the unchanged middleware and its existing suites (project-reach-guard passed). The field check cannot run before that middleware.

## Residual risk and what was not checked
- **Not run:** the full integration suite, the full web suite, e2e or browser rendering, lint, typecheck, `check:tokens`, the Docker image build or boot, and a portal bundle build to check its contents. Portal purity rests on source and import inspection.
- I did not audit `apiKeyHasCapability`'s scope mapping or `builtInRoleHasCapability` beyond this use. Both are existing, previously reviewed shared code. The tests exercise both a positive and a negative key scope.
- The composer reset on a default-prop change is pre-existing, and I did not analyse it further.

**Verdict:** CLEAR
<!-- END REPORT (sha256 7dda7a93e873cc7718532ee90e5a15673541c5a2e813184ad35506b666bce33e) -->
