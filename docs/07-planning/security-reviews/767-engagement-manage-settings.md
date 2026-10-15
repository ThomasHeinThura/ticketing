# PR #767 security review record: engagement fields require project:manage_settings (#766)

PR #767 closes #766. `PUT /api/project/{id}` now requires the strict canonical `project:manage_settings` capability, intersected with API-key scope, whenever `kind`, `supportLevel` or `serviceCalendarId` is sent, including an explicit `null`. This extends the existing CA-2 check and runs before any read or write. After the security review, the handler writes only the engagement fields that were sent; PR-9 is still validated against the stored and sent values. Health stays on `project:update`.

A Claude Sonnet 5.5 lane implemented the change; the conductor (Claude Opus 5.5) added the review-driven deltas. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: APPROVE at `0388ac69`; a surviving `supportLevel` null mutation was closed by a test at `361d3110`; APPROVE at `361d3110`, `f0106a19` and the main merge `4a59f9f0`.
- Ordinary review B by Claude Sonnet 5.5: APPROVE at `0388ac69`, `361d3110`, `f0106a19` and `4a59f9f0`.
- Security review by Claude Opus 5.5: CLEAR at `361d3110`. Its non-blocking finding 2 (a plain update wrote stored engagement values back, a lost-update path around the new gate) and finding 4 (rbac.md prose) were fixed at `f0106a19`, which is CLEAR on delta review. The create path (#708 class) remains a recorded follow-up.
- Mechanical security rebind by Claude Opus 5.5: CLEAR at `4a59f9f0`, a clean merge of `main` `8ed5fef2` (docs only).

**Reviewed head:** `361d3110fd164f09160ea96ef6d48da4a49b56b3`
**Reviewed head:** `f0106a1990e637d5003d420ad5bf33cd5867a780`
**Reviewed head:** `4a59f9f05d1c003643151e153f266d63d6590c66`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `767-ordinary-a-sonnet.md` | Ordinary review A (main..4a59f9f0) | Claude Sonnet 5.5 | `4a59f9f0` | APPROVE | `63fbaf574d4910b3738059ac40e8848daac163ff41328d2a653bdbe794344f95` |
| 2 | `767-ordinary-b-sonnet.md` | Ordinary review B (main..4a59f9f0) | Claude Sonnet 5.5 | `4a59f9f0` | APPROVE | `ce48551046b0d891a7457c5cc7c4e96fc028ce842432d76140dde40883ad1ea9` |
| 3 | `767-security-opus.md` | Security review, delta and rebind (main..4a59f9f0) | Claude Opus 5.5 | `4a59f9f0` | CLEAR | `0a6e4bc3999d3e240c9478e3a04b43dc14e4ef9588ad953bceaaf86e88d67a0f` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/767-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 63fbaf574d4910b3738059ac40e8848daac163ff41328d2a653bdbe794344f95) -->
# PR #767 ordinary review A (PUT /api/project/{id}: engagement fields need strict project:manage_settings)

**Reviewed head:** 0388ac698b445e3b17b563a6af94ae1117e1b59f
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed live. Scratch worktree `$TMPDIR/rvA-767` at the exact head, removed afterwards. Security-scope (authorization) change: this ordinary review does not replace the required Sol review.

## What changed
`apps/api/src/project/index.ts`: the CA-2 `assertCallerHasCapability(workspaceId, userId, "project:manage_settings", capabilityCredential(apiKey))` block now also fires when `kind`, `supportLevel` or `serviceCalendarId` is `!== undefined`; route description/403 text updated. `policy.ts` comment, projects-and-engagements.md paragraph, openapi.json (2 strings), new 323-line test file.

## Checks
- Condition: `!== undefined`, so an explicit `null` (clearing supportLevel or serviceCalendarId) counts as "sent" and needs the capability, which is correct since it changes SLA-relevant state. `updateProjectBody` has no defaults on these fields (`kind` is `.optional()` with no default on update; the `default("project")` is on the create body only), so a name/icon/slug/description-only PUT does not trip the check. No web client or package references these fields, so no existing caller silently starts sending them.
- Ordering: the check runs before the `db.select` of the current project and before any validation/write (`assertManagedServiceConfiguration`, `assertProjectCalendar`, `updateProjectCtrl`). The tests assert nothing is written on 403.
- API-key intersection: reuses `capabilityCredential(c.get("apiKey"))`, same helper as CA-2; the key-scope tests cover key with only project:update (denied for engagement fields, plain update allowed), key with manage_settings (allowed), and a key's manage_settings not widening a lead-like role.
- Health and name-only updates: PATCH /health route untouched (still project:update); the test "keeps health on project:update" and the plain-update key test cover it.
- openapi.json: diff is exactly two `description` strings (operation description and 403 description); no schema/parameter change.
- Docs vs rbac.md: the text says kind/supportLevel/calendar are "SLA and calendar assignment" requiring strict manage_settings, health stays on project:update, create requires project:create; consistent with the code comment's citation of rbac.md. I did not find a contradicting statement; the code comment's quoted phrase should be confirmed against rbac.md by the reviewer who owns that spec (I did not diff rbac.md; it is not part of this PR).

## Commands (exact head, CI=true Testcontainers)
- Integration: project-engagement-manage-settings, project-default-comment-visibility, project-managed-service, plus project.test.ts: Test Files 4 passed, Tests 46 passed (46). (New file alone: 9 tests.)
- `pnpm run test:permissions` (apps/api): Test Files 16 passed, Tests 107 passed.
- `pnpm run typecheck` (apps/api, all tsc projects): exit 0. `biome ci` on the changed source and test: clean.

## Mutations (each reverted; worktree clean afterwards)
- Drop `supportLevel` from the condition: 3 tests fail.
- Replace `serviceCalendarId` clause with `false`: 2 fail.
- Drop `kind`: 3 fail.
- Wrong capability (`project:update`): 3 fail.
- `supportLevel != null` (null treated as not sent): survived, 9/9 pass. (My first null mutation, `(x ?? undefined) !== undefined`, was semantically equivalent and also survived; discounted.)

## Findings
Blocking: none.
Non-blocking:
1. Test gap: explicit `supportLevel: null` is not covered; only `serviceCalendarId: null` is (test around line 185). A one-line addition would kill the surviving mutation.
2. The route still reads `project:update` middleware first, so a caller lacking project:update gets the baseline 403 before the capability check; that is the intended layering.

## Residual risk
Required GPT-6 Sol security review is separate. Sending an unchanged `kind` (a no-op value) still requires manage_settings, which is stricter than necessary but consistent with CA-2's "sent" semantics and documented.

**Verdict:** APPROVE

---
# Delta review (0388ac69 -> 361d3110)

**Reviewed head:** 361d3110fd164f09160ea96ef6d48da4a49b56b3
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Live head confirmed. `git diff --stat 0388ac69 361d3110`: one file, tests/api-integration/project-engagement-manage-settings.test.ts (+12/-6); no source, docs or openapi change. The explicit-null case now loops over `serviceCalendarId: null` and `supportLevel: null`, asserting 403 and that engagement fields are unchanged (`expectEngagementUnchanged`) for each.
- `CI=true` run of the file: Tests 9 passed (9).
- Previously surviving mutation (`body.supportLevel != null ||`) now fails 2 tests (member and lead engagement-field denial cases); reverted, worktree clean.
My non-blocking finding 1 is resolved. No new findings.

**Verdict:** APPROVE

---
# Delta review 2 (361d3110 -> f0106a19)

**Reviewed head:** f0106a1990e637d5003d420ad5bf33cd5867a780
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Live head confirmed. Diff: `project/index.ts` (+10/-1), rbac.md sentence, test file (+49/-1).
- Handler: PR-9 validation (`assertManagedServiceConfiguration`, `assertProjectCalendar`) still runs on the merged `configuration`; the write now passes only the SENT fields (`body.kind`, `body.supportLevel`, `body.serviceCalendarId`, `body.defaultCommentVisibility`). `updateProjectCtrl` already spreads each engagement field only when `!== undefined`, and `null` still passes through (clearing), so a plain rename no longer writes the merged stored values and cannot revert a concurrent manage_settings change. The strict-capability gate and ordering are unchanged. Sent-field behaviour is unchanged (a sent value is written as before).
- rbac.md: sentence now lists defaultCommentVisibility, kind, supportLevel, serviceCalendarId (#766) for the handler-level check; consistent with the code (long line, cosmetic).
- New test: spies `pg` `Client.prototype.query`, collects `UPDATE "project"` statements for a lead's plain rename, asserts the SET clause (text before WHERE, so RETURNING is excluded) has none of `"kind"`, `"support_level"`, `"service_calendar_id"`, and asserts at least one statement was captured (non-vacuous guard).
- `CI=true` project integration files (engagement-manage-settings, default-comment-visibility, managed-service, project.test.ts): Test Files 4 passed, Tests 47 passed (47). `pnpm run test:permissions`: 16 files / 107 tests passed. API typecheck exit 0.
- Reverting the handler to pass `configuration`: the new test fails (Tests 1 failed | 46 passed); restored, worktree clean.
Findings: none blocking.

**Verdict:** APPROVE

---
# Delta review 3 (f0106a19 -> 4a59f9f0, merge of main)

**Reviewed head:** 4a59f9f05d1c003643151e153f266d63d6590c66
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Mechanical check only. Live head confirmed.
- Parents: `^1` = f0106a1990e637d5003d420ad5bf33cd5867a780 (my approved head), `^2` = 8ed5fef24f2e43aa09ac721e3c6faedda9c45030 (main, #756).
- `git merge-tree --write-tree f0106a19 8ed5fef2` = c1ca0c3e811c5e661f50d2c6c90d784f38c69bdf, identical to the merge commit's tree (clean merge, no extra content).
- No file overlap between the PR side and main since the merge-base; diff f0106a19..4a59f9f0 is exactly main's five control-plane docs (environments, active-mission, decision-log, queue, ledger). The #767 code, tests, rbac.md and openapi are unchanged from the head I approved.
Findings: none.

**Verdict:** APPROVE
<!-- END REPORT (sha256 63fbaf574d4910b3738059ac40e8848daac163ff41328d2a653bdbe794344f95) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/767-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 ce48551046b0d891a7457c5cc7c4e96fc028ce842432d76140dde40883ad1ea9) -->
# Ordinary review B, PR #767 (architecture, contracts, whole-system consistency)

**Reviewed head:** 0388ac698b445e3b17b563a6af94ae1117e1b59f
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** origin/main d159704be626136e728df7ddef0381dc37cf7756
**Method:** scratch detached worktree at the exact head (removed afterwards); read-only. Reviewer A's report was not read.

## Commands and counts
- `gh pr view 767 --json headRefOid` = head above. Files: project/index.ts, project/policy.ts, projects-and-engagements.md, tests/api-contract/openapi.json, new tests/api-integration/project-engagement-manage-settings.test.ts.
- `CI=true vitest run --config vitest.integration.config.ts ../../tests/api-integration/project-engagement-manage-settings.test.ts`: 1 file, **9 tests passed**, 0 failed.
- Same run plus neighbouring suites (project-managed-service, project-creator-lead, service-calendar-usage-delete): 4 files, **43 tests passed**, 0 failed (no regression for existing engagement callers).
- `pnpm test:permissions` (apps/api; workspace packages built first, an environment step): 16 files, **107 tests passed**, exit 0.
- `node scripts/ci/check-openapi.mjs`: "matches the API (284 operations)", exit 0.

## Consistency with the contracts
- rbac.md Projects group: `project:manage_settings` (baseline `project:update`) covers "Project states, features, labels, SLA and calendar assignment, automations". `kind`, `supportLevel` and `serviceCalendarId` drive SLA/engagement computation, so classing them as SLA and calendar assignment is a faithful reading. projects-and-engagements.md already lists "Edit settings" as `project:manage_settings` for the new `/api/projects/{projectId}` PATCH, so the spec direction agrees with this change.
- Role effect (from the rbac.md role table): holders of `project:manage_settings` are owner, admin (every capability) and manager. Lead, member, viewer and the project-scope `project-lead` role do not hold it. So after this PR a lead (and a project creator who holds only `project-lead`) can no longer set or clear kind, supportLevel or serviceCalendarId through PUT; owner, admin and manager lose nothing. Nobody gains. The doc paragraph says exactly this ("for example a lead gets 403 and nothing is written") and the tests cover member and lead refusal and owner/admin/manager success.
- CA-2 precedent: identical mechanism (handler-level `assertCallerHasCapability` after reach and body validation, before any read or write; API key scope intersected). Extending the same `if` keeps one check site; explicit `null` counts as "sent", which is right because null clears. A caller that omits all four fields is not asked, so plain rename keeps working for `project:update` holders (tested, including with an API key).
- policy.ts header and the route description and 403 text and openapi.json are updated together and `check:openapi` passes. The declared baseline stays `project:update`, so route-policy coverage is unchanged.
- Health stays on `project:update` (PATCH /health), matching the spec table line for health; tested.

## Project create path left unchanged: acceptable?
Create uses the legacy `requireWorkspacePermission({project:["create"]})`, which admits `member` (the code's own comment says so), and the handler only applies the strict `project:create` check when `organisationId` is set. So a member can still create a project with `kind: managed_service`, a support level and a calendar. That is an asymmetry (create sets what update now forbids), but: (a) it is a pre-existing legacy-vs-matrix gap (#708) rather than one this PR opens; (b) the same set (owner, admin, manager) holds both `project:create` and `project:manage_settings` in the matrix, so closing it later is a one-line strict check keyed on engagement fields; (c) the issue scope is update. Acceptable for this PR, but record it: non-blocking follow-up so the gap does not get lost.

## Impact on #760 (head c3778662)
- `apps/web/src/components/project/project-engagement-settings.tsx` gates every control on `canUpdateProjects()` (legacy `project:update`; its own test is named "without project:update every control is disabled"). Its header comment also says both writes need `project:update` server-side. After #767 a lead sees enabled kind, support-level and calendar controls and gets 403 on save (the component handles a 403 by refreshing the capability map, so it degrades, but the UX is wrong and the e2e spec for managed service likely uses an owner).
- The needed web change: gate kind, supportLevel and calendar on `canManageProjectSettings()` (already exists, strict, used by `default-comment-visibility-setting.tsx`) and keep the health control on `canUpdateProjects()`; update the comment and component test. This is a required coordinated change for #760, not a defect in #767. It also means #760 should not merge ahead of or without that gating adjustment once #767 is in (ordering: either order is safe for security because the server enforces, but UX is wrong until #760 is adapted).
- Fetcher update-project.ts already sends engagement fields only when set, so a plain rename from the general settings page remains unaffected.

## Findings
**Blocking:** none for #767.
**Non-blocking:**
1. Follow-up: strict check on create when `kind`, `supportLevel` or `serviceCalendarId` is sent (see above).
2. Required follow-up in #760: use `canManageProjectSettings` for the three engagement controls (see above).
3. Test header and the API-key fixture name still say "default comment visibility" in the copied helper (`name: "default comment visibility scope test key"`); cosmetic.

## Residual risk
Role matrix read from rbac.md, and the integration tests derive "lead-like" by rewriting the legacy permission map rather than using only canonical roles; they still exercise the real strict checker. #760's UI was inspected by source only, not run.

**Verdict:** APPROVE

---
## Delta review (0388ac69 to 361d3110)

**Reviewed head:** 361d3110fd164f09160ea96ef6d48da4a49b56b3
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

- `git diff 0388ac69 361d3110`: one file, tests/api-integration/project-engagement-manage-settings.test.ts (+12/-6). Test-only: the single `serviceCalendarId: null` denial becomes a loop over `serviceCalendarId: null` and `supportLevel: null`, each asserting 403 and that engagement columns are unchanged. No source, docs or openapi change.
- `CI=true vitest run --config vitest.integration.config.ts ../../tests/api-integration/project-engagement-manage-settings.test.ts`: 1 file, 9 tests passed, 0 failed.
- The added case strengthens the "explicit null counts as sent" property I noted as correct in the first review. Earlier findings unchanged.

**Verdict:** APPROVE

---
## Delta review (361d3110 to f0106a19)

**Reviewed head:** f0106a1990e637d5003d420ad5bf33cd5867a780
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

- Diff: index.ts (+11/-2 in the update handler), rbac.md (one sentence), the new test file (+50).
- Behaviour: the handler still builds `configuration` (stored values merged with sent values) and runs `assertManagedServiceConfiguration` and `assertProjectCalendar` on it, so PR-9 validation sees stored kind/calendar. It now passes the controller only `{kind, supportLevel, serviceCalendarId, defaultCommentVisibility}` as sent (undefined when omitted). I read `controllers/update-project.ts`: each engagement column is spread into `.set()` only when `!== undefined`, and explicit `null` still writes null. So a supportLevel-only update validates against stored kind and calendar and writes only `support_level`; a plain rename writes none of the engagement columns. This closes the lost-update path (a project:update rename no longer rewrites a value read before a concurrent manage_settings change).
- Residual (pre-existing, now narrower): validation reads the stored values before the transaction, so a concurrent change between that read and the write could in theory pair a sent field with a different stored value; the DB CHECK `project_managed_service_complete` (managed_service requires support_level and service_calendar_id) still rejects an invalid combination at write time, so no invalid state can persist.
- Docs: the rbac.md sentence now names defaultCommentVisibility, kind, supportLevel and serviceCalendarId (#766) and is accurate against the handler. (Style only: the line is long.)
- Tests: `CI=true vitest run --config vitest.integration.config.ts ../../tests/api-integration/project-engagement-manage-settings.test.ts`: 1 file, **10 tests passed**, 0 failed (new SQL-level case asserts the rename UPDATE's SET clause, before WHERE, contains none of "kind", "support_level", "service_calendar_id", and that at least one project UPDATE was seen so it is not vacuous). With `project-managed-service.test.ts`: 2 files, 12 tests passed.
- A supportLevel-only partial update has no dedicated test in the new file; behaviour is established from the code read above and the existing managed-service suite passing. Non-blocking suggestion: add one case.

**Verdict:** APPROVE

---
## Delta review (f0106a19 to 4a59f9f0, merge of main)

**Reviewed head:** 4a59f9f05d1c003643151e153f266d63d6590c66
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

- Live head confirmed by `gh pr view`. Parents: f0106a1990e637d5003d420ad5bf33cd5867a780 (my approved head) and 8ed5fef24f2e43aa09ac721e3c6faedda9c45030 (main, #756 docs).
- `git merge-tree --write-tree f0106a19 8ed5fef2` gives tree c1ca0c3e811c5e661f50d2c6c90d784f38c69bdf, identical to the tree of 4a59f9f0: clean merge, no hand edits.
- No file overlap between #767's changes (index.ts, policy.ts, rbac.md, projects-and-engagements.md, openapi.json, the new test) and main's side (#756 docs: environments.md, active-mission.md, decision-log.md, integration-execution-queue.md, pr-disposition-ledger.md). No file differs between f0106a19 and 4a59f9f0 outside main's side, so #767's content is unchanged from what I approved.

**Verdict:** APPROVE
<!-- END REPORT (sha256 ce48551046b0d891a7457c5cc7c4e96fc028ce842432d76140dde40883ad1ea9) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/767-security-opus.md; Claude Opus 5.5; sha256 0a6e4bc3999d3e240c9478e3a04b43dc14e4ef9588ad953bceaaf86e88d67a0f) -->
# PR #767 (closes #766) — independent security review

**Reviewed head:** 361d3110fd164f09160ea96ef6d48da4a49b56b3
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context

Did not author, direct or remediate this change. Read-only: no pushes, comments, approvals or merges.

## Comparison base
- `gh pr view 767 --json headRefOid` = 361d3110fd164f09160ea96ef6d48da4a49b56b3 (confirmed live).
- Merge base = origin/main = d159704be626136e728df7ddef0381dc37cf7756.
- Diff: 5 files, +353/-7 (`apps/api/src/project/index.ts`, `apps/api/src/project/policy.ts`,
  `docs/03-features/projects-and-engagements.md`, `tests/api-contract/openapi.json`,
  new `tests/api-integration/project-engagement-manage-settings.test.ts`).
- Scratch detached worktree at the exact head; removed afterwards.

## Surfaces examined
- `PUT /api/project/{id}` handler and route definition (`apps/api/src/project/index.ts`).
- `updateProjectBody` (`apps/api/src/project/schema.ts`): `z.object` (unknown keys stripped);
  `kind` optional, `supportLevel` and `serviceCalendarId` nullable+optional.
- `update-project.ts` controller: writes the three columns only from the handler's `configuration`.
- `assertCallerHasCapability` / `capabilityCredential` (`utils/require-workspace-capability.ts`) and
  `apiKeyHasCapabilityScope` / `apiKeyScopeSatisfies` (`utils/require-api-key-permission-scope.ts`).
- Reach middleware `workspaceAccess.fromProject(..., requireProjectReach, deferApiKeyCapability)`
  (`utils/workspace-access-middleware.ts`).
- Every writer of `project.kind/support_level/service_calendar_id`: grep over `apps/` and `packages/`
  for drizzle `update(projectTable)` / `insert(projectTable)` and raw SQL.
- `docs/01-architecture/rbac.md` capability rows and role matrix; `packages/permissions/src/roles.ts`;
  legacy map `packages/permissions/src/legacy-better-auth-access-control.ts`.
- Ordinary reviews 767-ordinary-{a,b}-sonnet.md read as context only; claims re-verified.

## Analysis
- **Condition.** The check fires when any of `defaultCommentVisibility`, `kind`, `supportLevel`,
  `serviceCalendarId` is `!== undefined`. Explicit `null` is treated as sent, which is correct
  because `null` clears level/calendar. Unknown or alias keys cannot reach the columns: zod strips
  them, and the controller writes only from `configuration`.
- **Ordering.** Route middleware (reach, then legacy `project:update`) runs first. In the handler the
  strict check runs after body validation and before the `current` select, the PR-9 and calendar
  validation (422), and the write transaction. So a denied caller gets no 422 signal about calendar
  ids and nothing is written.
- **Reach before 403.** Out-of-reach callers get a 404 from the middleware before the handler runs.
  The new 403 therefore cannot reveal that a project exists.
- **Capability semantics.** Strict canonical `BUILT_IN_ROLES` check with fail-closed membership
  resolution and no instance-admin bypass. For an API key, the key scope is checked first
  (`Insufficient API key scope`). A null, non-object, array or malformed `permissions` value yields
  false (deny). A key scope cannot widen a role without the capability; this is tested.
- **Other writers.** The only writers of the three columns are `createProject` (POST, gated by
  `project:create`) and `updateProject` (this route). Other `projectTable` updates (archive,
  unarchive, delete, reorder, number claims, health) do not set these columns. No bulk, import,
  template or admin path writes them.
- **Docs/OpenAPI.** Route description, 403 text and the contract snapshot match behaviour. The feature
  doc is accurate. rbac.md maps "SLA and calendar assignment" to `project:manage_settings`, which
  matches the implementation.

## Commands (real results)
| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | exit 0 |
| `pnpm turbo typecheck` | exit 0, 9/9 tasks successful |
| `CI=true vitest run --config vitest.integration.config.ts` on project-engagement-manage-settings, project-default-comment-visibility, project-managed-service, project-scoped-reach | exit 0; 4 files, 172 tests passed |
| `pnpm test:permissions` | exit 0; 16 files, 107 tests passed (5/5 turbo tasks) |

## Mutations (run against the new #766 file plus the CA-2 file, 29 tests; each reverted, worktree clean afterwards)
| Mutation | Result |
| --- | --- |
| m1: `serviceCalendarId` clause replaced with `false` | exit 1, 2 failed |
| m2: `kind` clause removed | exit 1, 3 failed |
| m3: API key ignored (`capabilityCredential(undefined)`, so key scope cannot narrow) | exit 1, 2 failed (both files) |
| m4: explicit null treated as not sent (`!= null` for supportLevel/serviceCalendarId) | exit 1, 2 failed |
| m5: check moved after the write | exit 1, 9 failed |
| m6: check moved after the `current` read but before validation and write | exit 0, survived (expected: a side-effect-free select after reach was already decided; no observable difference) |

Docker: only Testcontainers created by these runs, auto-removed. No other container was touched.

## Findings
**Blocking:** none.

**Non-blocking:**
1. Create path (pre-existing, outside #766's scope). `POST /api/project` accepts the three fields under
   the legacy `project:create` statement map. rbac.md assigns "Create a project or managed service"
   to `project:create`, so this is consistent with the matrix. However, the legacy seeded `member`
   statements include `project: ["create", ...]` while the canonical `member` role does not hold
   `project:create`. This is the #708 class (legacy map grants more than rbac.md). It affects create
   generally, not just the engagement fields. Track it with #708 / the ordinary reviewer's follow-up;
   it does not affect this PR's verdict.
2. Lost-update window (pre-existing). The handler reads `current` outside the write transaction and,
   for a plain update, writes the stored kind/level/calendar back unchanged. A concurrent manage_settings
   change between that read and the write could be reverted by a caller who holds only
   `project:update`. Narrow timing window, and not introduced here. A follow-up could write
   engagement columns only when they were sent, or re-read inside the transaction.
3. Test coverage. There is no explicit case for an out-of-reach caller sending engagement fields
   (404 vs 403). The guarantee is structural (route middleware runs before the handler), and
   `project-scoped-reach.test.ts` covers the PUT route's reach generally. The API-key fixture name
   still says "default comment visibility" (cosmetic).
4. The rbac.md prose near the #720 paragraph still names only `defaultCommentVisibility` as the
   handler-level `project:manage_settings` check on `PUT /api/project/{id}`. Docs follow-up only.

## Residual risk / not checked
- No end-to-end UI run of the settings screens (#760 consumer); a lead's UI may still show controls
  that now answer 403.
- Custom (non-built-in) roles always fail the strict check by design until the capability migration;
  not re-verified beyond reading the code.
- No image build or deploy check (API handler change only; no packaging surface touched).

**Verdict:** CLEAR

---

# Security delta review (361d3110 -> f0106a19)

**Reviewed head:** f0106a1990e637d5003d420ad5bf33cd5867a780
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), same independent reviewer context as above (did not author, direct or remediate)

## Comparison base
- `gh pr view 767 --json headRefOid` = f0106a1990e637d5003d420ad5bf33cd5867a780 (confirmed live).
- `git log 361d3110..f0106a19`: one commit. Diff: 3 files, +61/-4
  (`apps/api/src/project/index.ts`, `docs/01-architecture/rbac.md`,
  `tests/api-integration/project-engagement-manage-settings.test.ts`).
- Fresh detached worktree at the exact head; removed afterwards.

## Surfaces examined
- **Write set.** `updateProjectCtrl` now receives `{ kind: body.kind, supportLevel: body.supportLevel,
  serviceCalendarId: body.serviceCalendarId, defaultCommentVisibility: body.defaultCommentVisibility }`.
  The controller spreads each column only when `!== undefined`, so:
  - an omitted field is not written;
  - an explicit `null` (which already passed the strict check) is written as `null`.
  The merged `configuration` is now used only for `assertManagedServiceConfiguration` (PR-9) and
  `assertProjectCalendar`.
- **Write-back paths.** `updateProjectCtrl` has one call site (index.ts:1016). It is the only update
  writer of these columns; the earlier sweep is unchanged by this delta. No path writes stored
  values back any more.
- **Ordering.** The strict `project:manage_settings` block is unchanged and still runs before the
  `current` select, the PR-9/calendar validation and the write transaction. Reach (404) still runs
  in middleware before the handler.
- **Validation under concurrency.** PR-9 validation uses a merged view read outside the transaction.
  The database CHECK (`kind <> 'managed_service' OR (support_level IS NOT NULL AND
  service_calendar_id IS NOT NULL)`) still enforces integrity if a concurrent change races.
  This is not an authorization concern.
- **rbac.md.** The #720 paragraph now names all four fields for the handler-level check. That matches
  the code. Finding 4 is resolved.
- **New test.** It spies on `pg` `Client.prototype.query`, asserts at least one `UPDATE "project"` was
  captured (non-vacuous), and checks that the SET clause omits the three columns.

## Commands (real results)
| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | exit 0 |
| `pnpm turbo typecheck` | exit 0, 9/9 tasks |
| `CI=true vitest run --config vitest.integration.config.ts` on project-engagement-manage-settings, project-default-comment-visibility, project-managed-service | exit 0; 3 files, 32 tests passed |
| `pnpm test:permissions` | exit 0; 16 files, 107 tests passed (5/5 turbo tasks) |

## Mutations (each reverted; worktree clean afterwards)
| Mutation | Result |
| --- | --- |
| m7: write the merged `configuration.kind` back | exit 1; 1 failed / 31 passed (the new SET-clause test) |
| m8: write the merged `configuration.serviceCalendarId` back | exit 1; 1 failed / 31 passed (same test) |

Docker: only Testcontainers created by these runs, auto-removed. No other container was touched.

## Findings
**Blocking:** none.

**Non-blocking:**
- Findings 2 and 4 from the first pass are resolved.
- Findings 1 (create path, #708 class) and 3 (no explicit out-of-reach engagement-field test; cosmetic
  fixture name) still stand as previously classified.

## Residual risk
- The new test relies on drizzle issuing the UPDATE through `pg.Client.prototype.query`. If the driver
  changes, the `statements.length > 0` guard fails loudly rather than passing vacuously.
- No UI or deploy check (API handler change only).

**Verdict:** CLEAR

---

# Mechanical rebind (f0106a19 -> 4a59f9f0)

**Reviewed head:** 4a59f9f05d1c003643151e153f266d63d6590c66
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), same independent reviewer context as above (did not author, direct or remediate)

- `gh pr view 767 --json headRefOid` = 4a59f9f05d1c003643151e153f266d63d6590c66 (confirmed live).
- `git rev-list --parents -n1 4a59f9f0`: parents are f0106a1990e637d5003d420ad5bf33cd5867a780 (the
  CLEAR head) and 8ed5fef24f2e43aa09ac721e3c6faedda9c45030. The latter is the current `origin/main`.
- `git merge-tree --write-tree f0106a19 8ed5fef2` exited 0 with tree
  c1ca0c3e811c5e661f50d2c6c90d784f38c69bdf. That equals `4a59f9f0^{tree}`, so it is a clean merge
  with no manual edits.
- `git diff --stat f0106a19 4a59f9f0`: 5 files, +66/-1, all docs:
  - `docs/05-operations/environments.md`
  - `docs/07-planning/active-mission.md`
  - `docs/07-planning/decision-log.md`
  - `docs/07-planning/integration-execution-queue.md`
  - `docs/07-planning/pr-disposition-ledger.md`
- No overlap with the PR's 6 files (`apps/api/src/project/{index,policy}.ts`, `rbac.md`,
  `projects-and-engagements.md`, `openapi.json`, the new integration test). No code, test,
  contract or security-scope path changed.
- Tests were not re-run; a docs-only clean merge cannot change the reviewed behaviour.

**Verdict:** CLEAR
<!-- END REPORT (sha256 0a6e4bc3999d3e240c9478e3a04b43dc14e4ef9588ad953bceaaf86e88d67a0f) -->
