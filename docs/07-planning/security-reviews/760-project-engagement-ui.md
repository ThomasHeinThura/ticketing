# PR #760 security review record: project engagement controls (#716)

PR #760 closes #716 (M6). Project settings → General gains engagement kind, support level, service calendar and RAG health controls. Kind, support level and calendar need `project:update` and `project:manage_settings`, matching the server rule from #767 (#766). Health needs `project:update`. The customer-organisation binding is never sent. `apps/web/e2e/**` is security-scope.

A Claude Sonnet 5.5 lane implemented the change. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review C by Claude Sonnet 5.5: APPROVE at `c3778662`, delta APPROVE at `64ddd44e` (gating aligned with #767; 403 path tested), mechanical APPROVE at `cef5c8c4`.
- Ordinary review D by Claude Sonnet 5.5: APPROVE at `c3778662`, delta APPROVE at `64ddd44e`, mechanical APPROVE at `cef5c8c4`.
- Security review by Claude Opus 5.5: CLEAR at `64ddd44e` (gating matches the server rule, organisation binding never sent, 403 handling, all 6 mutations caught); mechanical rebind CLEAR at `cef5c8c4`, a clean merge of `main` `9bb28099`, where the server rule is now on `main`.

**Reviewed head:** `64ddd44e2f1a7e28a4dfceac91f6d6061c313236`
**Reviewed head:** `cef5c8c40e6da0b4cda64209816427db9c51c557`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `760-ordinary-c-sonnet.md` | Ordinary review C (main..cef5c8c4) | Claude Sonnet 5.5 | `cef5c8c4` | APPROVE | `5e226bbac979c93dc9327c2b8019a0126d3c4f13df1b38c6b4be0650c7bd325b` |
| 2 | `760-ordinary-d-sonnet.md` | Ordinary review D (main..cef5c8c4) | Claude Sonnet 5.5 | `cef5c8c4` | APPROVE | `43b927bba2d2a61f257899fe68c83f24786049c880929da0fce177192bdcc479` |
| 3 | `760-security-opus.md` | Security review and rebind (main..cef5c8c4) | Claude Opus 5.5 | `cef5c8c4` | CLEAR | `61299eb396541881a7087c9e6b88ff5066561e926bbce651aa9342f13ec0ca6b` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/760-ordinary-c-sonnet.md; Claude Sonnet 5.5; sha256 5e226bbac979c93dc9327c2b8019a0126d3c4f13df1b38c6b4be0650c7bd325b) -->
# PR #760 ordinary review C (project engagement controls, web, #716)

**Reviewed head:** c377866243997818d3c6853c8277e60161bdc576
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Base compared: main d159704b (merge-base equals origin/main at review time). Comparison reference: #589 (origin/codex/bulk-integration-20261006) and docs/03-features/projects-and-engagements.md PR-9. Read-only review in a scratch detached worktree (removed afterwards).

## Checks and commands

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | exit 0 |
| `pnpm turbo typecheck` | exit 0, 9/9 tasks |
| `vitest run` in apps/web (full suite) | 188 files, 1045 tests passed (22 new in 2 files, matches PR body) |
| `biome ci` on touched web/i18n/e2e/pairs paths | clean (one size warning: pairs.json 2.5 MiB over the 1 MiB biome limit, not processed) |
| `node apps/web/scripts/check-ui-boundaries.mjs` | OK (186 ui files, 765 web files) |
| `pnpm check:i18n` | all locales in sync with en-US |
| `pnpm check:ui`, `pnpm check:vocabulary` | pass |
| `pnpm check:tokens` (builds web, then contrast) | exit 0, "418 declared, source-grounded pairs meet thresholds in light/dark built CSS" |
| Playwright `e2e/project-managed-service.spec.ts` (port 4178 was free) | 7 passed, 0 failed |
| Mutation x4 on client logic | 3 killed (drop support-level rule, drop 403 mapping, drop null on calendar payload); 1 survived (see N2) |

## Parity against the server and #589

- Client validation (`validateEngagement`) is exactly `assertManagedServiceConfiguration` in apps/api/src/project/index.ts: managed_service needs a non-empty support level and calendar id; `project` never errors. Unknown or empty server values are narrowed to unset rather than trusted.
- Payload: all three fields are sent with explicit nulls for cleared values. Server reads `undefined` as "unchanged" and null as "clear", and `updateProjectBody` allows `supportLevel` and `serviceCalendarId` nullable optional, so this is accepted. A plain rename (general form) omits the fields and the server keeps current values (`body.kind ?? current.kind`). Preserved.
- Status handling: 403 maps to forbidden (and refreshes the capability cache), 404 notFound, 422 containing "PR-9" maps to managedServiceIncomplete, other 422 to calendarInvalid (server messages `PR-9: ...` and `service_calendar_must_belong_to_workspace` verified), anything else generic. Mapping is by status, server text is never echoed.
- Authorization: gating on `canUpdateProjects` matches `requireWorkspacePermission({ project: ["update"] })` on both the PUT and `PATCH /health` routes. Read-only state disables all controls and removes Save; a unit test and the e2e cover it.
- Organisation binding: `organisationId` is never in the payload or the UI; a unit test asserts it. Server PUT does not accept it, consistent with the creation-only rule.
- Design departure from #589 (acceptable): #589 inlined the controls in general.tsx and saved them via the main form; #760 extracts `ProjectEngagementSettings` with its own explicit Save and immediate health save. Health failure revert is equivalent (pendingHealth cleared in `finally`, value falls back to `project.health`).
- packages/ui primitives only (Alert, Button, Select*, Skeleton); no bespoke primitives, ui-boundaries check passes. Every `settings:projectGeneral.engagement.*` key the component uses (including the health and failure sub-keys) exists in en-US and `check:i18n` reports all locale files in sync (non-English carry English text; disclosed in the PR body).
- pairs.json: not hand-waved. The manifest is verified against live source contexts by `check-contrast.mjs`; I deleted one of the new occurrences from a scratch copy and the checker failed with "occurrence contract omits a live source context", then restored it. The committed additions (section text, the calendar-hint paragraph, `AlertDescription` muted text, the Select popup chain) pass with the real built CSS in light and dark.

## Findings

Blocking: none.

Non-blocking:
- N1. `useGetProject` `enabled` is tightened from `!!id` to `!!id && !!workspaceId`. This is a shared hook (8 callers). The fetcher ignores workspaceId, so a caller that previously passed an empty string would now never fetch. All callers I inspected pass a route-derived workspaceId, but the change is not mentioned in the PR body.
- N2. A 403 on the project save (PUT) path does not have a test that the capability cache is refreshed: removing `refreshCapabilities()` from `handleSave` survived the unit and e2e tests. The health path is tested.
- N3. Disclosed in the PR "Not done" and confirmed: a user with `project:update` but without `sla_policy:read` cannot list calendars, so cannot pick a new one (the existing one is preserved and shown as "Saved calendar (not in the loaded list)"). Needs an API change, tracked separately.
- N4. Kind switched back to `project` still sends the previously set support level and calendar (server accepts; DB has no constraint against it). Matches #589 behaviour.
- N5. The component keeps its own draft and does not reset when the project refetches from another edit; no version precondition (disclosed).

## Residual risk

Real API and database were not exercised (e2e mocks the network edge); the managed-service integration test on the server side is unchanged. Visual/theme evidence is the author's screenshots, not re-captured.

**Verdict:** APPROVE

---

## Delta review: c3778662 to 64ddd44e

**Reviewed head:** 64ddd44e2f1a7e28a4dfceac91f6d6061c313236
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed with `gh pr view 760`. Delta over c3778662 in web source: 3 files (+170/-11) plus the new i18n notice key in all locales (main was merged; its first parent is main 84df21ea).

| Check | Result |
| --- | --- |
| `pnpm turbo typecheck` | exit 0, 9/9 |
| apps/web full `vitest run` | 188 files, 1050 tests passed (was 1045) |
| `check:i18n`, `biome ci` on touched paths | pass / clean |
| Playwright `project-managed-service.spec.ts` (scratch config on 4193, fixture port patched in scratch only, reverted) | 9 passed, including the two new specs (no manage_settings; 403 on save) |
| Mutation: remove `refreshCapabilities()` from the save-403 branch (my earlier surviving mutant) | now killed (1 test fails) |
| Mutation: remove the draft reset on 403 | killed |
| Mutation: drop the `canManageProjectSettings()` gate | killed |

What changed and my verification:
- Gating: kind, support level, service calendar and the Save button now need `project:update` AND `canManageProjectSettings()` (the hook from main, `can.manageProjectSettings === true`); health stays on `project:update` only. A user with update but not manage_settings sees a new info notice (`manageSettingsRequired`, present in all locales) and can still set health (e2e covers that); a user without update keeps the earlier read-only notice and nothing is sent.
- 403 on save: the unsaved draft and validation state are cleared (controls show what is saved) and the capability map is refreshed; the translated "forbidden" message stays. This closes my earlier N2.
- Note: on this base the server's `PUT /api/project/{id}` still requires `project:manage_settings` only for `defaultCommentVisibility` (apps/api/src/project/index.ts ~957); gating of kind/supportLevel/serviceCalendarId lives in #767, which is not in this head. The client gate is therefore currently stricter than the server, which is safe, and matches #767 once it lands; the commit message references #766.
- Shared `useGetProject` `enabled: !!id && !!workspaceId` (unchanged in this delta, rechecked as asked): all 8 production callers pass a required `workspaceId: string` taken from a route param or typed prop (`project-layout`, `task-details-sheet-body`, `task-relations`, `default-comment-visibility-setting`, `task-properties-sidebar`, `task-details-content`, the task route, and this component). The two callers that pass `id: ""` when a project is already provided stay disabled exactly as before. No caller can regress. Closes my earlier N1.

Remaining non-blocking notes from the first review (N3 calendar list needs `sla_policy:read`, N4, N5) are unchanged.

**Verdict:** APPROVE

---

## Mechanical check: merge of main 9bb28099 (#767 merged)

**Reviewed head:** cef5c8c40e6da0b4cda64209816427db9c51c557
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate). Mechanical check only: no tests were re-run.

- `gh pr view 760` head equals cef5c8c40e6da0b4cda64209816427db9c51c557. Parents: 64ddd44e2f1a7e28a4dfceac91f6d6061c313236 (the previously reviewed head) and 9bb28099a69d1e599e1d7451ebdf6225e380546c (main).
- `git merge-tree --write-tree 64ddd44e2f1a7e28a4dfceac91f6d6061c313236 9bb28099` prints the same tree as the new head's tree: the merge is clean, with no hand edits or conflict resolution.
- Merge base with main is 1455ed80. Main brought 11 files; the diff from the old head to the new head is exactly that file list. None of them is also changed on the PR side since the merge base (overlap: 0 files).
- Main's files that matter here: `apps/api/src/project/index.ts`, `apps/api/src/project/policy.ts`, `tests/api-integration/project-engagement-manage-settings.test.ts`, `tests/api-contract/openapi.json`, rbac.md and the projects spec, plus #763's two web test files and release workflow/docs. I read the server diff: `PUT /api/project/{id}` now requires the strict `project:manage_settings` (intersected with API-key scope) when the body sends `kind`, `supportLevel`, `serviceCalendarId` or `defaultCommentVisibility`, baseline stays `project:update`, and health stays on `project:update`; it also writes only the engagement fields the caller sent. That is exactly the rule the UI gate in my delta review assumed (engagement controls need update AND manage_settings, health needs update), so the earlier note that the client gate was stricter than the server no longer applies. The component always sends all three engagement fields on save, which the new server rule accepts for a caller holding manage_settings.
**Verdict:** APPROVE
<!-- END REPORT (sha256 5e226bbac979c93dc9327c2b8019a0126d3c4f13df1b38c6b4be0650c7bd325b) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/760-ordinary-d-sonnet.md; Claude Sonnet 5.5; sha256 43b927bba2d2a61f257899fe68c83f24786049c880929da0fce177192bdcc479) -->
# #760 ordinary review D (architecture / contracts / consistency)

**Reviewed head:** c377866243997818d3c6853c8277e60161bdc576
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** origin/main d159704be626136e728df7ddef0381dc37cf7756 (read-only scratch worktree at the exact head)

Scope: #716 engagement controls (kind, support level, service calendar, RAG health) on project settings General. 30 files, web + i18n only, no API change.

## Commands run (in the worktree at the head)
- `pnpm install --frozen-lockfile --prefer-offline` ok; `pnpm turbo typecheck` 9/9 tasks successful.
- `pnpm exec vitest run src/components/project` (apps/web): 5 files, 32 tests passed.
- `pnpm check:i18n`: all 19 locale files in sync with en-US, exit 0.
- `pnpm check:ui` and `check:ui:raw-elements`: 0 unlisted, 0 raw JSX elements. `check-tokens.mjs` exit 0. `check-contrast.mjs`: 418 declared pairs meet thresholds, exit 0 (pairs.json additions are the generated manifest rows for the new component, consistent with that check).
- `biome check` on the touched web dirs: clean.
- Playwright NOT run (per instruction); I read `apps/web/e2e/project-managed-service.spec.ts` instead: 7 tests (persist across reload, explicit nulls, PR-9 client refusal, server 422, read-only without project:update, 403 on health, keyboard Tab order).

## Checks against the specs
- PR-9 (projects-and-engagements.md): client validation in `project-engagement-form.ts` mirrors `assertManagedServiceConfiguration` (managed_service needs support level and calendar), 422 is mapped by status/`PR-9` substring to a translated message, server text is never echoed. Omitted vs explicit null semantics match the server (`undefined` = unchanged). OK.
- Holds #705/#706: no organisation field is rendered or sent (unit test "never renders or sends the customer organisation binding"). The binding stays creation-only. OK.
- G6 four states: loading skeleton (`aria-busy`), error with retry, empty (no calendars message), partial (calendar list failed while project loaded, saved calendar not in page still displayed and preserved). Covered by tests. OK.
- G1/G2/G3: only `@taskdesk/ui` primitives, semantic tokens (`text-destructive`, `text-muted-foreground`); gates pass.
- G5: no new screen or URL (a section inside an existing route). G4/keyboard: labels bound by `htmlFor` to trigger ids, `aria-invalid`/`aria-describedby` on error, `role="alert"` messages, Tab order tested in e2e. No axe run on this section was added (existing @a11y suite not extended); I did not verify it covers settings General.
- i18n: en-US gets the keys with a full `schema.json` entry; the 15 non-English locales get the English strings. This is NOT a deviation: the recent merged web features (`659d87ba` board, `a1aedb93` selection mode, `032bf283`) did the same in de-DE, and `check:i18n` only enforces key parity. pl-PL gets the keys in a different position (additive only) which is fine for the same check.
- Shared-hook change: `useGetProject` now `enabled: !!id && !!workspaceId`. All 9 call sites I grepped pass a workspace id; low risk. `updateProject` now throws `HttpError` (a subclass of Error with the same message), so existing `error.message` consumers still work.

## Findings
1. NON-BLOCKING (contract/granularity, worth a recorded decision): permission gate vocabulary. The new section gates all controls on legacy `canUpdateProjects()` (`project:update`) and says so in its doc comment, which is truthful to what the server enforces today for `PUT /api/project/{id}` kind/supportLevel/serviceCalendarId and `PATCH .../health`. But the spec table ("Edit settings = project:manage_settings") and rbac.md ("SLA and calendar assignment" under `project:manage_settings`, which `lead` does not hold) say kind/support-level/calendar belong to the stricter capability; only health is `project:update` by spec. The recorded granularity gap in `apps/api/src/project/policy.ts` names archive/unarchive/reorder (and column/workflow-rule), and the PUT comment records only `defaultCommentVisibility`. Kind, support level and calendar via PUT are therefore an unrecorded instance of the same gap, and this PR makes it user-reachable by a `lead`. The sibling `DefaultCommentVisibilitySetting` on the same page already uses the strict `canManageProjectSettings()`. Suggest: add the gap (kind/support/calendar on PUT) to the policy.ts note or decision log, and when the server tightens, split the gate per control (health keeps `canUpdateProjects`). Not blocking because the UI cannot grant anything the server does not already allow, and the server remains the authority.
2. NON-BLOCKING: the calendar picker lists `GET /api/service-calendars`, which requires `sla_policy:read`, and only the first page (default limit 50, no load-more or search). A caller with `project:update` but without `sla_policy:read` sees "Could not load service calendars" plus a Retry that can never succeed (permanent 403 presented as transient), and a workspace with more than 50 calendars cannot select a later one. A saved calendar is preserved by the unlisted-item fallback, so nothing is lost. Suggest classifying 403 on the list distinctly in a follow-up.
3. NON-BLOCKING (UX consistency): Health commits immediately on change while the other three fields use Save/Discard; there is no cue why. It is defensible (separate endpoint, per spec) but a one-line helper text or grouping would avoid surprise. Also the form uses raw `<label>`/`<p>` where `Field`/`Label` exist in `packages/ui`; the sibling component does the same and the raw-element gate passes, so this is precedent, not a regression.
4. NON-BLOCKING: `handleSave` sends `icon: project.icon ?? "Layout"`, so saving engagement settings on a project with a null icon also writes a default icon. Minor side effect.
5. NON-BLOCKING: `classifyEngagementFailure` distinguishes the 422 variants by `message.includes("PR-9")` on the raw response text; stable today (spec says the 422 names PR-9) but coupled to server wording. The unit test pins it.
6. INFO: screen-inventory lists "Project - SLA & calendar" as its own P2 route (`/settings/sla`); this PR puts calendar assignment on General. The inventory row remains accurate (it concerns calendar definitions/SLA, not assignment) but a later reader may want a note.

## Residual risk / not checked
Not run: Playwright e2e, visual regression, axe. Did not verify behaviour against a live API (unit tests mock fetchers; e2e mocks routes per the spec I read).

**Verdict:** APPROVE

---

## Delta review: c3778662 -> 64ddd44e (rbac finding addressed)

**Reviewed head:** 64ddd44e2f1a7e28a4dfceac91f6d6061c313236
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Delta in product code is one component (`project-engagement-settings.tsx`, +39/-10), its unit and e2e tests, and the new i18n key; the rest of the diff against c3778662 is merged-in main (compose, deploy, docs), not #760 work. Commands: `pnpm turbo typecheck` 9/9, `check:i18n` all locales in sync, `vitest run src/components/project src/hooks`: 33 files, 168 tests passed. Playwright not run.

- Gate split is correct and matches the spec table: kind, support level and service calendar need `canUpdateProjects() && canManageProjectSettings()` (strict `project:manage_settings`, same hook the sibling comment-visibility setting uses); health stays on `project:update`. Save/Discard render only with the engagement gate, so a lead with update-only can still set health and sees no dead Save button.
- Read-only UX: two distinct info notices (no update at all: everything disabled; update without manage_settings: a message naming the missing permission and saying health can still be set) plus disabled controls. Clear and honest. Minor: the notices are not tied to the disabled fields with `aria-describedby`, so a screen-reader user hears them only if they read the section in order; non-blocking. The strict-capability sibling hides itself entirely while this one renders read-only; both defensible.
- 403 handling: a forbidden save now drops the unsaved draft and refreshes the capability map, so the controls snap back to saved values and then follow the server. Good; the failure message is shown (translated, no server text).
- Server dependency: in this tree the PUT route still enforces only `project:update` for these fields (the strict check exists only for `defaultCommentVisibility`); the #766/#767 server rule is not in 64ddd44e. The UI is therefore stricter than the server until that lands, which is the safe direction (no capability is offered that the server would refuse; a lead is merely hidden from controls the server would still accept). Merge order is not a correctness risk; after the server rule lands a stale-capability 403 is handled as above.
- Shared `useGetProject` (`enabled: !!id && !!workspaceId`): all 9 call sites pass `workspaceId` (settings pages, project layout, task details sheet/content/sidebar/relations, task route, comment-visibility setting). The only behaviour change is that a caller whose workspace id is not yet known no longer fires a request with an empty workspace (previously a doomed fetch); it stays in the pending state until the id arrives. No caller relies on the old behaviour; the engagement component also treats "permissions still checking and no project" as loading. Low risk.
- Findings from the first review that remain open (all non-blocking, unchanged): calendar list needs `sla_policy:read` and shows only the first page; permanent 403 on that list is shown as retryable; health commits on change while other fields use Save.

**Verdict:** APPROVE

---

## Mechanical check after main moved to 9bb28099a69d1e599e1d7451ebdf6225e380546c

**Reviewed head:** cef5c8c40e6da0b4cda64209816427db9c51c557
**Model / context:** Claude Sonnet 5.5, fresh independent context (mechanical verification only; no code re-review)

- `gh pr view` head = cef5c8c40e6da0b4cda64209816427db9c51c557 (confirmed).
- Parents: first = 64ddd44e (previously reviewed head), second = 9bb28099a69d1e599e1d7451ebdf6225e380546c (equals origin/main, ancestor of origin/main).
- `git merge-tree --write-tree <p1> <p2>` = 1a7fa7b964810ba36283ae2a2a25aac8ffcd4eca, identical to the merge commit's tree: clean merge, no manual conflict resolution or extra edits.
- Overlap between files changed on the PR side and on the main side since the merge base: none (11 files changed on main).
- Tests not re-run (no PR-side change between the reviewed head and this one).

**Verdict:** APPROVE (unchanged from the prior review of 64ddd44e; for a PR with no prior review of mine, this is a mechanical check only)
<!-- END REPORT (sha256 43b927bba2d2a61f257899fe68c83f24786049c880929da0fce177192bdcc479) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/760-security-opus.md; Claude Opus 5.5; sha256 61299eb396541881a7087c9e6b88ff5066561e926bbce651aa9342f13ec0ca6b) -->
# PR #760 (#716 project engagement) — security review

**Reviewed head:** 64ddd44e2f1a7e28a4dfceac91f6d6061c313236
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context
**Comparison base:** merge-base 1455ed80d87806c7c5e22c34e5f0f07c72782289 (origin/main at review time 9297362b5f2dd1f17da935c8051c1562b473638a)
**Server rule compared against:** PR #767 head d6f3dfbfcbd867c38e946ff9fdd6bb3df345f999 (`codex/engagement-manage-settings-766`)
**Role:** independent security reviewer; did not author, direct or remediate this change. Read-only (scratch detached worktrees, removed afterwards).

Heads confirmed with `gh pr view 760/767 --json headRefOid`: 64ddd44e... and d6f3dfbf...; both OPEN, MERGEABLE.

## Surfaces examined

- `apps/web/src/components/project/project-engagement-settings.tsx` (gating, save, health, 403 handling)
- `apps/web/src/components/project/project-engagement-form.ts` (payload, validation, failure classification)
- `apps/web/src/fetchers/project/update-project.ts`, `update-health.ts`
- `apps/web/src/hooks/queries/project/use-get-project.ts` (`enabled` change) and all 8 callers
- `apps/web/src/hooks/use-workspace-permission.ts` (`canUpdateProjects`, `canManageProjectSettings`)
- route `dashboard/settings/projects/$projectId/general.tsx` (mount point)
- `apps/web/e2e/project-managed-service.spec.ts` (security-scope path)
- #767 diff: `apps/api/src/project/index.ts`, `policy.ts`

## Checks and conclusions

1. **UI gating matches #767.** On the server, `PUT /api/project/{id}` needs `project:update` (route baseline). It also needs strict `project:manage_settings` when the body carries `kind`, `supportLevel`, `serviceCalendarId` or `defaultCommentVisibility`. `PATCH /health` stays on `project:update`. In the UI, `canEditHealth = canUpdateProjects()` and `canEditEngagement = canEditHealth && canManageProjectSettings()`. `manageProjectSettings` is read strictly (`=== true`) from `/api/capabilities`, never inferred. These match.
2. **Engagement fields only when intended.** `updateProject` adds `kind`/`supportLevel`/`serviceCalendarId` only when defined. The existing general rename form does not set them, so a plain rename does not trip the strict check. The engagement save always sends all three (explicit null clears), so it is offered only to callers with both capabilities.
3. **Organisation binding never sent.** `buildEngagementPayload` returns exactly the three fields, and no organisation control is rendered. A unit test asserts that no organisation key is ever sent or rendered.
4. **403 handling.** Failures are classified by status (`forbidden`/`notFound`/PR-9 422/`calendarInvalid`/`generic`) and shown as translated messages; server text is not echoed. On 403 the unsaved draft is dropped (save) or the value reverts (health), and the workspace capability query is invalidated.
5. **`useGetProject` `enabled: !!id && !!workspaceId`.** This prevents a fetch cached under `["projects", undefined, id]`. That is security-neutral to positive, since the cache key no longer collides across workspaces. All 8 callers pass a real `workspaceId` (props or route params).

## Commands run (real results)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | exit 0 |
| `pnpm turbo typecheck --concurrency=2` | exit 0, 9/9 tasks |
| `vitest run project-engagement-form.test.ts project-engagement-settings.test.tsx` | exit 0, 2 files / 27 tests passed |
| `pnpm turbo build --filter=@taskdesk/web` | exit 0, 5/5 tasks |
| `playwright test e2e/project-managed-service.spec.ts` (scratch config, port 4393, uncommitted) | exit 0, 9 passed |

## Mutation testing (each reverted; worktree confirmed clean after each)

| Mutation | Test outcome |
| --- | --- |
| M1 drop `manage_settings` from engagement gating | killed — 1 failed / 18 |
| M2 health editable without `project:update` | killed — 3 failed / 18 |
| M3 add an `organisationId` to the engagement payload | killed — 3 failed / 27 (form + settings) |
| M4 keep the stale draft after a 403 | killed — 1 failed / 18 |
| M5 `manage_settings` alone enables engagement (no `project:update`) | killed — 2 failed / 18 |
| M6 echo server text for a 403 | killed — 3 failed / 27 |

## Findings

**Blocking:** none.

**Non-blocking:**

- **NB-1 (data integrity, not authority):** the engagement save is a full `PUT` that resends `name`, `slug`, `description` and `icon` from the cached project. A concurrent rename made elsewhere between load and save could be overwritten with the cached values. It needs `project:update`, which the caller already has, so it grants nothing new. #767 already narrowed the engagement-field write-back on the server side.
- **NB-2:** no test pins the `useGetProject` `enabled` change. It is low risk, but a regression test would stop the undefined-workspace cache key from coming back.

## Residual risk / not checked

- This PR depends on #767 for server enforcement of the strict rule. Until #767 merges, `main` accepts engagement fields with `project:update` alone, so the UI is stricter than the server. Merge order (#767 first, or together) matters for the claim "server enforces"; it does not affect this PR's own correctness.
- #767 itself was not re-reviewed here (it has its own security note).
- e2e is mock-only; no full suites (load control).

**Verdict:** CLEAR

---

## Mechanical rebind after main moved to 9bb28099 (#767 merged)

**Reviewed head:** cef5c8c40e6da0b4cda64209816427db9c51c557

**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context (the same context that wrote the #760/#768/#769 security reports)
**Main:** 9bb28099a69d1e599e1d7451ebdf6225e380546c (#767 merged: `PUT /api/project/{id}` engagement fields need `project:manage_settings`, plus docs, tests and the review note)
**Previous reviewed head:** 64ddd44e2f1a7e28a4dfceac91f6d6061c313236

Method (read-only, no checkout of the working tree): `git fetch`, `gh pr view --json headRefOid` (confirmed OPEN, MERGEABLE).
- **Parents:** `git log -1 --format=%P <new>` = `64ddd44e2f1a7e28a4dfceac91f6d6061c313236 9bb28099a69d1e599e1d7451ebdf6225e380546c`, which is the previous head plus the new main. It is a plain "Merge remote-tracking branch 'origin/main'" commit.
- **Merge-tree equality:** `git merge-tree --write-tree 64ddd44e2f1a7e28a4dfceac91f6d6061c313236 9bb28099a69d1e599e1d7451ebdf6225e380546c` = 1a7fa7b964810ba36283ae2a2a25aac8ffcd4eca, which equals `<new>^{tree}` = 1a7fa7b964810ba36283ae2a2a25aac8ffcd4eca. The merge adds nothing beyond a clean, conflict-free merge.
- **Overlap:** the files the PR changes (from its old merge base) do not intersect the files main changed since that base (empty intersection). `git diff <old> <new> -- <PR files>` is empty, so the PR's own content is byte-identical.
- **Interaction:** main brought `apps/api/src/project/{index,policy}.ts`, rbac/feature docs, the OpenAPI contract and `project-engagement-manage-settings.test.ts`. `git diff d6f3dfbf 9bb28099 -- apps/api tests/api-integration` is empty, so the server rule on main is byte-identical to the #767 head this review compared against.
- **UI gating vs server rule, now on main:**
  - The server requires `project:update` (route baseline) plus strict `project:manage_settings` whenever the body carries `kind`, `supportLevel`, `serviceCalendarId` or `defaultCommentVisibility`. Health (`PATCH /health`) stays on `project:update`.
  - The UI has `canEditHealth = canUpdateProjects()` and `canEditEngagement = canEditHealth && canManageProjectSettings()`. It sends the engagement fields only from the engagement save, and the plain rename form omits them.
  - They agree. The earlier residual ("UI stricter than server until #767 merges") is now closed.
- No new code to test; the previous runs and mutation results stand for identical PR content.

**Verdict:** CLEAR
<!-- END REPORT (sha256 61299eb396541881a7087c9e6b88ff5066561e926bbce651aa9342f13ec0ca6b) -->
