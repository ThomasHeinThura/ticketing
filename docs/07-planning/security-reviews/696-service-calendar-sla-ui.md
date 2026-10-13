# PR #696 security review record: service calendar and SLA policy settings UI

PR #696 ports the missing web UI from historical #513 onto current `main`. It adds the service-calendar list and editor, holiday import and calendar deletion through the pending-action flow, and the SLA policy list and editor, with its i18n, specs and four Linux G8 baselines. It changes no API, domain or migration code: `main` already serves every route it calls. It is security-scope because it adds `apps/web/e2e/**` specs (including two persisted real-runtime specs), PNG baselines, and `packages/ui/src/styles/pairs.json` entries. #513's held request-type and feature-flag runtime (D5) is not included.

Who made each change:
- **The UI and its fixes:** a Claude Sonnet 5.5 implementation lane.
- **The Linux baselines:** Sonnet evidence lanes using the v11 pinned-image machinery.
- **The two merges of `main` and the redaction fix (`2245d85f`):** the conductor (Claude Opus 5.5).

The reviewers below are fresh, independent contexts that did not author, direct or remediate the change.

## Review chain

- Ordinary review A by Claude Sonnet 5.5 (API contract fit and behaviour): REQUEST CHANGES at `e32de23d` for one reason only, a `pairs.json` merge conflict with `main`. It then gave a delta APPROVE at `42ed9164` (merge resolution verified id by id) and a delta APPROVE at `2245d85f`.
- Ordinary review B by Claude Sonnet 5.5 (completeness, UI, accessibility, gates, #513 absorption): REQUEST CHANGES at `42ed9164` with three blockers: a raw file input, shrink-wrapped page shells, and mis-laid card headers. After the fixes and baseline regeneration it gave a delta APPROVE at `ecd485c5`, re-measuring the widths and loading visibility in the built app.
- Security review by Claude Opus 5.5: CLEAR at `371ccac6`. It ran six integration probes: a non-manager writing, cross-workspace access, missing CSRF, a stale If-Match, deletion of an in-use calendar, and hostile iCalendar files. Its finding N1 was that the persisted specs could print the fixture sign-up password in a failure snapshot.
- Security rebind by the same Opus context: CLEAR at `2245d85f`. It reproduced both the leak without the hook and its redaction with the hook.
- Second security rebind by the same Opus context: CLEAR at `3a0f1f82`. That commit merges `main` `bf23f525` (#698). Non-conflict files equal git's own merge. `pairs.json` and the 19 i18n catalogs are the exact union of both parents. Nothing from #698 touches the #696 surfaces.

**Reviewed head:** `e32de23d6e042427218e55197eb55858a86c768a`
**Reviewed head:** `42ed91645599759080e026f15fd386cba3030a02`
**Reviewed head:** `ecd485c5828a9c242aff731d5a70e66e23a7f107`
**Reviewed head:** `371ccac6ebc4f38d4960406a497246e3db77bb17`
**Reviewed head:** `2245d85fa8ad5bf76533ad5d2aaf44f03b2d1086`
**Reviewed head:** `3a0f1f825d14b082a764556343f77c3a2daeaa61`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `696-ordinary-a-sonnet.md` | Ordinary review A (64b70f93..e32de23d) | Claude Sonnet 5.5 | `e32de23d` | REQUEST CHANGES | `0949dff760a79fb8ecb87320526921443974fe8d2875e90a2d5c7aa39a3960e2` |
| 2 | `696-42ed-ordinary-a-sonnet.md` | Ordinary delta review A (e32de23d..42ed9164) | Claude Sonnet 5.5 | `42ed9164` | APPROVE | `e540f9936cb208f5e31ad34041f3d330822a87a1c7b91c2db86a9521d6e6ed40` |
| 3 | `696-ordinary-b-sonnet.md` | Ordinary review B (a0992497..42ed9164) | Claude Sonnet 5.5 | `42ed9164` | REQUEST CHANGES | `89bb516c56fa0073c918ec50662ad25e3fbe653a9dcef52c8513064bd39a3b16` |
| 4 | `696-ecd4-ordinary-b-sonnet.md` | Ordinary delta review B (42ed9164..ecd485c5) | Claude Sonnet 5.5 | `ecd485c5` | APPROVE | `f5ea4bb3e49001cce1895fd20e2f35d707dcfe7d953c9d88c874d73a878d994c` |
| 5 | `696-security-opus.md` | Security review (af663a0c..371ccac6) | Claude Opus 5.5 | `371ccac6` | CLEAR | `097d7301cb5a5cdd1259cc939f30774a646c80d1708a0064a85272200d21aa78` |
| 6 | `696-2245-ordinary-a-sonnet.md` | Ordinary delta review A (42ed9164..2245d85f) | Claude Sonnet 5.5 | `2245d85f` | APPROVE | `cab2e59e6f6acfef1c7a188015d3a540e892f6d9af43c354597e31f4b0ea5aac` |
| 7 | `696-2245-security-rebind-opus.md` | Security rebind (371ccac6..2245d85f) | Claude Opus 5.5 | `2245d85f` | CLEAR | `05afdb9a87437b5442f6f5ab745c79e954d118eb19b6e7a518629e64ce461ff3` |
| 8 | `696-3a0f-security-rebind-opus.md` | Security rebind (2245d85f..3a0f1f82) | Claude Opus 5.5 | `3a0f1f82` | CLEAR | `70c5b90a1098107f83dfb4a570102f9ca4a59924f2ea6d4a4670050184042b1c` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/696-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 0949dff760a79fb8ecb87320526921443974fe8d2875e90a2d5c7aa39a3960e2) -->
# PR #696 ordinary review A (API contract fit and behaviour correctness)

Model: Claude Sonnet 5.5 (reviewer A, fresh context, did not author or direct the change).
**Reviewed head:** e32de23d6e042427218e55197eb55858a86c768a
Base: merge-base 468ab265 (branch is behind). origin/main at review time a0992497d68206b517a7f452f04fbbbbb3cc6f54.
Scratch copy: detached worktree at e32de23d (removed afterwards). No docker containers started. Original worktree not modified.

## Files examined
fetchers/service-calendar.ts, fetchers/sla-policy.ts; all service-calendar and sla-policy mutation/query hooks; hooks/use-service-calendar-editor.ts (+test); use-workspace-permission.ts; query-client/index.ts; calendar-usage-card.tsx (+test); service-calendar-editor-view.tsx; sla-policy-editor.tsx; routes/lib/routes.ts; apps/web/e2e/service-calendar.spec.ts; docs service-calendars.md (CAL-8/CAL-9) and sla.md diffs. API side read: apps/api/src/service-calendar/index.ts, sla-policy/index.ts route definitions, capabilities/get-capabilities.ts, index.ts onError. react-hook-form 7.84.0 reset() source.

## Commands and results (on e32de23d, scratch copy)
- pnpm install --frozen-lockfile: ok.
- pnpm typecheck: 9/9 successful.
- pnpm check:route-policy: 5/5 tasks successful.
- pnpm test:permissions: 14 files, 88 tests passed.
- pnpm check:i18n: all 18 locales in sync.
- web vitest full: 144 files, 608 tests passed.
- pnpm build:agent then playwright (mock-backed) service-calendar.spec.ts + sla-policy.spec.ts: 12 passed.
- Mutation M1 (RESET_KEEP_FIELD_REFS = {}): vitest 144/608 still PASS (not caught); mock-backed e2e FAILS 3 of 11 (toHaveValue on Name/Timezone, editor visibility). Reverted.
- Mutation M2 (delete button not disabled when in use): 2 vitest failures in calendar-usage-card.test.tsx (blocked while referenced; blocked when usage failed to load). Reverted.
- Mutation M3 (drop If-Match header in updateServiceCalendar): 1 vitest failure, "sends the loaded version in If-Match". Reverted.
- Not run: persisted (Testcontainers) specs; check:visual-scope (G8 baselines evidenced separately by the baseline report).
- git merge-tree against current main a0992497: ONE content conflict, packages/ui/src/styles/pairs.json (everything else auto-merges).

## Findings

1. Contracts (pass). No diff to apps/api, packages/domain, migrations or tests/api-contract/openapi.json vs merge-base, so fetchers bind to unchanged main routes. Paths, query (workspaceId, cursor, limit=50), If-Match quoted version on PATCH, holidays/import and SLA PATCH/publish all match route definitions. 409 body {message, assertedVersion, currentVersion} handled (calendar: typed conflict error with refresh/keep/reload flow; SLA: banner + reload). DELETE: 202 body parsed; 409/403/404 text or JSON message surfaced. 404 hiding (403 mapped to 404 by calendarReach) falls to the generic error path. Main defines no 412; 422 only on SLA create/update/publish.
2. Capability gating (pass). Client uses /api/capabilities manageServiceCalendars, computed server-side by an exact sla_policy:manage check that mirrors the write routes; target-scoped to the row's workspaceId. Readers get a read-only notice; the server still enforces.
3. Deletion and usage (pass). DELETE goes through createPendingAction (202), the UI navigates to main's existing pending-actions/$id page (route exists in routeTree), no direct delete. Button disabled while any usage count > 0, while usage is loading or errored (fail closed), and hidden without manage. Timezone-change dialog shows live counts, informational, confirm still required, and degrades with an explicit message if usage fails; matches CAL-8 text. Covered by unit and mock e2e.
4. No new semantics / no held D5 code (pass). Diff has no request-type, intake, portal, triage or feature-flag runtime files; no such additions in code or i18n. Spec edits only describe implemented UI and remove stale "usage blocked / deletion unavailable" claims.
5. keepFieldsRef (correct). reset(values, { keepFieldsRef: true }) is a supported option in react-hook-form 7.84.0; with it reset() writes values to the mounted fields via setValue instead of dropping _fields, which fixes the blank inputs under the React Compiler. The hydration effect is gated on !loading so fields are mounted. Coverage is by mock-backed e2e only (verified by mutation); no unit test would catch a regression (see N1).

### Blocking
- B1 (merge-readiness, not code): branch conflicts with current main in packages/ui/src/styles/pairs.json (both sides extended the occurrence contracts). Needs a rebase/merge and re-verification of check:tokens, then the exact-head review/gate evidence (including the four G8 baselines) must be re-bound to the new head. I rate this blocking only because the candidate cannot merge as-is; I found no defect in the code at e32de23d.

### Non-blocking
- N1 apps/web/src/hooks/use-service-calendar-editor.ts:41-46: the keepFieldsRef fix has no vitest coverage (jsdom, no compiler); only the e2e protects it. Consider a comment-linked unit or keep the e2e as the guard.
- N2 apps/web/src/components/sla-policy/sla-policy-editor.tsx:212-214, 233-235: all SLA save/publish failures except 409 map to one generic toast, so 422 (invalid calendar, incomplete goal matrix on publish) and 404 give no reason.
- N3 sla-policy-editor.tsx:108-110, 413: calendar select loads only the first page (limit 50); calendars beyond 50 are not selectable, and a policy pinned to a calendar beyond the page renders an empty select.
- N4 service-calendar-editor-view.tsx timezone dialog: usage query refetches on mount only, so counts can be stale when the dialog opens late in a session; informational only per CAL-8.
- N5 hooks/use-service-calendar-editor.ts persist(): create/update error toast shows the raw server text for non-409 errors (HTTPException plain text, acceptable), but not localized.

## Residual risk
Persisted Testcontainers specs and Linux visual comparisons were not run by me. Other register()+reset() forms on main may share the React Compiler issue (implementer noted, not audited). Findings assume no API change between merge-base and a0992497 beyond what the merge-tree shows.

## Verdict
REQUEST CHANGES (only for B1, the conflict with current main and the resulting head re-bind). The code at e32de23d is otherwise approvable: contracts correct, deletion and usage handling correct, no held D5 code, tests non-vacuous except the noted keepFieldsRef unit gap.
<!-- END REPORT (sha256 0949dff760a79fb8ecb87320526921443974fe8d2875e90a2d5c7aa39a3960e2) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/696-42ed-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 e540f9936cb208f5e31ad34041f3d330822a87a1c7b91c2db86a9521d6e6ed40) -->
# PR #696 delta ordinary review A: e32de23d..42ed9164 (merge of main)

Model: Claude Sonnet 5.5 (reviewer A, fresh context, not the author of the merge).
**Reviewed head:** 42ed91645599759080e026f15fd386cba3030a02
Parents: e32de23d6e042427218e55197eb55858a86c768a (first), a0992497d68206b517a7f452f04fbbbbb3cc6f54 (origin/main).
Scratch worktree at 42ed9164, removed afterwards. No containers started.

## Resolution correctness
- Every file except packages/ui/src/styles/pairs.json is byte-identical to git's own three-way auto-merge tree (git merge-tree --write-tree origin/main e32de23d, tree 337ecdf9); `git diff --name-only <that tree> 42ed9164` lists only pairs.json. No hand edits elsewhere.
- pairs.json, scripted comparison of base 468ab265, parent A, parent B and the merge (418 entries each; entries are not uniquely keyed, so I compared (occurrenceId, entry scalar tuple) pairs):
  - ids: base 2372, A 2440, B 2378, merge 2446 = 2372 + 68 (A-only) + 6 (B-only).
  - 0 parent ids missing from the merge; 0 invented ids; 0 ids that either side had removed vs base are kept (neither side removed any); entry order equals parent A.
  - Entry scalar fields (fg, bg, category, backdrop, classes, surfaceContext, themes, usage, minRatio) match a parent for every id.
  - 4 occurrence records differ from both parents: the shared Select component occurrences (select.tsx SelectPopup x2, SelectValue x2). Their `chain` first caller changed from portal/catalogue.tsx:PortalCatalogue to sla-policy-editor.tsx:SlaPolicyEditor. This is the expected effect of the new SLA editor Select becoming the first-seen caller, not a loss: check-contrast.mjs validates each occurrence chain against source (line ~679) and passes.
- `pnpm check:tokens` on 42ed9164: exit 0, "418 declared, source-grounded pairs meet thresholds".

## Other commands on 42ed9164
- pnpm typecheck: 9/9 successful.
- pnpm check:i18n: in sync. pnpm check:visual-scope: passed, 19 cases, 18 active rows.
- web vitest full: 147 files, 625 tests passed (matches the conductor).
- Mock-backed browser specs service-calendar + sla-policy: 12 passed on a fresh agent build.

## Do main's changes plausibly alter the four new G8 baselines?
Changes between the parents that touch rendering: #692 density effect moved to app root (UserPreferencesEffects, only adds html.compact-mode when the preference is set; the visual spec does not seed preferences, default is off), ThemeProvider followSystemWhenUnset (portal-only opt-in, agent default false; Playwright is colorScheme light with a fixed theme), session guard in _authenticated.tsx (changes only the failure path; success path renders identically), motion.css additions, #690 work-item activity/list and API comment changes (not on these screens), #687 i18n and tests.
- motion.css: the new rules sit inside `@media (prefers-reduced-motion: reduce)` and the Playwright config sets reducedMotion: "reduce" with animations: "disabled" in visual.spec. They drop `scale` and non-shadow transitions on [data-slot="button"] and on positioners. At rest (no hover/press/open popup) this should be pixel-neutral for the four screens (buttons, no open select/menu). Residual likelihood of a diff: low. If CI G8 shows one it would most likely be a sub-pixel change on a Button caused by transition-property reset; the earlier baselines already existed for other button-bearing screens on main with this CSS.
- Verdict on this point: no likely diff; CI G8 job is authoritative and I did not regenerate Linux screenshots.

## Findings
- Blocking: none.
- Non-blocking: the four previously noted non-blocking items (SLA 422/404 generic toasts, SLA calendar select limited to 50, usage counts not refetched when the timezone dialog opens, keepFieldsRef guarded only by browser specs) are unchanged by the merge.

## Residual risk
Linux visual comparison, persisted Testcontainers specs and full CI not run by me.

## Verdict
APPROVE (delta). B1 from the earlier report is resolved: conflict resolved without loss, no non-conflicting file altered by hand, token check and test counts re-verified at 42ed9164.
<!-- END REPORT (sha256 e540f9936cb208f5e31ad34041f3d330822a87a1c7b91c2db86a9521d6e6ed40) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/696-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 89bb516c56fa0073c918ec50662ad25e3fbe653a9dcef52c8513064bd39a3b16) -->
# PR #696 ordinary review B (completeness, UI quality, accessibility, specs, gates)

Model: Claude Sonnet 5.5 (reviewer B, fresh context; did not author, direct or remediate the change).
**Reviewed head:** 42ed91645599759080e026f15fd386cba3030a02
Base: origin/main a0992497d68206b517a7f452f04fbbbbb3cc6f54 (the head merges it; first parent e32de23d). #513 source: refs/remotes/pr/513 (a319442f), merge-base with main 4102e618.
Scratch copy: detached worktree /Users/heinthura/.codex/worktrees/review-696-b at 42ed9164 (removed afterwards). No docker containers started. Original worktree not modified. Reviewer A's reports were read, not redone.

## Files examined
Impl report, baseline acquisition report, #513 section of reconcile-586-513-sonnet.md, reports 696-ordinary-a / 696-42ed-ordinary-a. Source: routes calendars.tsx, sla-policies.tsx, workspace.tsx diff; service-calendar-editor-view.tsx, calendar-summary-card.tsx, sla-policy-summary-card.tsx, sla-policy-editor.tsx, holiday-import-panel.tsx; packages/ui card.tsx (CardHeader); docs diffs (screen-inventory.md, service-calendars.md, sla.md); visual-screens.json diff; i18n catalogs; the four G8 PNGs; ci-fast.yml; docs/01-architecture/i18n.md; every file in `git diff 4102e618 pr/513` under apps/web, packages/ui, i18n, docs/02-design, docs/03-features (87 non-i18n files, each compared to 42ed9164).

## Commands and results (at 42ed9164, scratch copy)
- pnpm install --frozen-lockfile: ok. pnpm build: 6/6 tasks. pnpm build:agent: ok.
- pnpm check:bundle-size: pass (agent 230.1/350 KB gz, work-list graph 298.5/350, portal 163.7/200).
- pnpm check:route-policy: pass (5/5). pnpm test:permissions: pass (5/5 turbo tasks).
- pnpm check:tokens (tokens + contrast): pass, 418 pairs.
- pnpm check:visual-scope: pass (19 cases, 18 active rows). pnpm check:inventory: pass. pnpm check:i18n: 18 locales in sync. pnpm check:vocabulary: pass. pnpm check:ui: pass.
- **pnpm check:ui:raw-elements: FAIL (exit 1), 1 problem: apps/web/src/components/service-calendar/holiday-import-panel.tsx:125 raw `<input type="file">`.** This is the only problem repo-wide, so main passes and the PR introduces it. CI runs it in ci-fast.yml `registers` job (lines 199-201). Neither the implementer nor reviewer A ran it.
- apps/web scripts/check-ui-boundaries.mjs: OK.
- web vitest, touched files (components/service-calendar, fetchers/service-calendar, use-service-calendar-editor, routes.test, service-calendar-form, mutations/service-calendar, use-workspace-permission): 7 files, 58 tests pass.
- pnpm lint:ci: 196 warnings, 1 info, same as reported baseline; none in touched files. The single "error" is apps/web/test-results/.last-run.json, a gitignored artifact of my own Playwright run (removed); not a finding.
- Throwaway Playwright probe (untracked, deleted) with mock routes against the built agent app, axe-core 4.13.0 from packages/ui, light and dark, 1280x800:
  - axe, ready states of calendar list, calendar editor, calendar new, SLA list, SLA editor, SLA new: no serious/critical violations in either scheme (color-contrast clean). Moderate only: heading-order on calendar editor (#calendar-day-mon h3 under h1) and SLA editor (h3 goal section under h1).
  - axe, error states (API 500): editors report moderate page-has-heading-one (error branch has no h1).
  - Measured `main` and skeleton geometry, see B2.
- Not run: persisted Testcontainers specs, Linux visual comparison (CI G8), full CI, manual keyboard walkthrough (controls are native or Base UI primitives; labelled-control review was by source).

## Findings

### Blocking
- **B1 raw-element gate fails.** holiday-import-panel.tsx:125 uses a raw `<input type="file">`. `pnpm check:ui:raw-elements` exits 1 and the ci-fast `registers` job runs it. Fix: use the shared @taskdesk/ui Input (type=file) or add an immediately preceding `// ui-exempt: <reason>` comment (native file picker has no primitive). Re-run the gate; no baseline impact.
- **B2 page shells shrink-wrap in the flex layout; loading state invisible, SLA pages narrow, error alerts cramped.** Every new `<main className="flex h-full flex-col gap-N overflow-y-auto p-6">` lacks `w-full`/`flex-1` (calendars.tsx:74, sla-policies.tsx:68, service-calendar-editor-view.tsx:55,67,99, sla-policy-editor.tsx:260,272,302). The existing #670 r3 precedent in `pending-actions/$id.test.tsx:139-147` and `pending-actions.tsx:45` shows the same class and uses `w-full`. Measured in the built app (1280 wide viewport, mock API):
  - Calendar editor loading: main 48 px, skeleton 0x48 px (invisible). SLA editor loading: main 48 px, skeleton 0x48 px (invisible). So "loading" is nominally present but not visible for both editors. The e2e asserts it with `toBeAttached` (service-calendar.spec.ts:761) instead of `toBeVisible`, which hides it.
  - SLA list ready: main 665 px; SLA editor ready: 767 px; calendar list 1253 (only because a long info alert forces width). Content width depends on content, not the shell.
  - Error states: calendar editor main 510 px, SLA editor 275 px (alert wraps in a ~230 px column).
  - Fix: add `w-full` (as pending-actions does) and replace `toBeAttached` with `toBeVisible`. This changes the SLA list/editor and likely calendar editor/list captures, so the four G8 baselines must be regenerated through the Linux machinery and the G13 skeleton-shift assertion rechecked.
- **B3 summary cards render a mis-laid header, and the baselines freeze it.** calendar-summary-card.tsx:34 and sla-policy-summary-card.tsx:24 pass `flex-row items-center justify-between` to CardHeader, but CardHeader (packages/ui/src/components/card.tsx:123) is `grid ... auto-rows-min grid-rows-[auto_auto]`; `flex-row` without `flex` does not change display. Effects visible in the committed PNGs: in service-calendar-list-linux.png "40 h/week / Manual holidays: 0" sits under the title, not at the card's right edge, and the footer line is indented 8 px left of the title (x=41 vs 49); in sla-policy-list-linux.png the "Active version 1" badge floats mid-card. The baseline-acquisition report called the narrow SLA column "app layout, not a capture fault", which is B2. Fix: add `flex` to both CardHeader classNames (or `grid-cols-[1fr_auto]`), then regenerate baselines together with B2.

### Non-blocking
- N1 SLA goal inputs have an ambiguous accessible name. sla-policy-editor.tsx:~505-540 (input at :534): each of the 8 inputs per type is labelled only "Low/Medium/High/Urgent"; the metric heading (h4) and type section (aria-label) are not programmatically tied to the control, so a screen-reader forms list reads 8 inputs named "Low", etc. Suggest `aria-labelledby="<metric heading id> <priority label id>"` or a fieldset/legend per metric. Also causes axe heading-order (h3/h4 under h1 with no h2) in the SLA editor; same for calendar editor day headings.
- N2 Error branches of both editors (service-calendar-editor-view.tsx:72-88, sla-policy-editor.tsx error branch) have no `<h1>`; axe page-has-heading-one (moderate).
- N3 SLA editor ignores calendar-query failure and empty list. sla-policy-editor.tsx:108 reads only `isLoading`; if calendars fail to load or none exist, the Service calendar select is silently empty with no message or link to create one (four-state gap: calendars error/empty). Types error is handled (typesError). Reviewer A's N3 (50-calendar cap) compounds this.
- N4 List pages render the Previous/Next nav in the empty state (calendars.tsx nav block, same in sla-policies.tsx) with both buttons permanently disabled; harmless but noise. Skip when the list is empty and there is no cursor.
- N5 use-workspace-permission.test.tsx was not updated. #513 added manageServiceCalendars/row-scoped cases there; #696 adds `canManageServiceCalendars` (the only gate for all four screens) with no unit test (grep for ServiceCalendar in that test file: none). The existing key-set test still passes. Coverage rests on e2e.
- N6 i18n (see section below): English text in 17 non-English locales for 217 keys; consistent with recent intake precedent, not documented as a rule. Recommend a tracked follow-up, not a block.
- N7 Reviewer A's non-blocking items (SLA 422/404 generic toasts, 50-item calendar select, stale usage in timezone dialog, keepFieldsRef only e2e-guarded) stand; I did not re-verify them.
- N8 Workspace settings links (workspace.tsx) navigate to `/agent/settings/...`, which render outside the workspace settings sidebar layout (acknowledged by the impl report). Users lose the settings sidebar and have only the in-page "back" link to the list. Acceptable for now; note for the P4 settings IA work.

## UI quality summary (four screens)
- Settings patterns: header (h1 + description + primary action), notice Alerts, Card summary cards, cursor pagination via URL param, read-only notice for readers: consistent with pending-actions and request-types pages. Primitives from @taskdesk/ui only (check:ui, check:tokens pass) except B1.
- States: calendar list loading (role=status, labelled skeleton) / empty (Empty + create CTA, cursor reset) / error (Alert, Retry, Reset) / ready: all four. Calendar editor: loading (invisible, B2), error (Retry + back, no h1), conflict (409 flow), ready, read-only (fieldset disabled + legend). SLA list: same four as calendar list. SLA editor: loading (invisible, B2), error, conflict, ready, read-only; calendars error/empty not handled (N3).
- Keyboard and labels: every Field has a label with htmlFor, checkbox in Label with aria-label, Save outside the form via `form=` attribute, all icons aria-hidden, links have focus-visible ring. Only N1 weakens naming.

## i18n convention (question 3)
- docs/01-architecture/i18n.md gate: "en-US complete"; check:i18n checks key parity only. No document requires translated values.
- Recent practice is mixed. Comparing each commit's new de-DE keys with en-US: 985b1125 (intake retry/withdraw etc.) and e961c120 (intake keys missing from every locale) added English text to the non-English files (9 of 9 and 31 of 34 identical to en); b1993d30 and #673 density keys were translated (0 of 5 identical). #692 and #690 added no new-locale text of this size to compare.
- In #696, 153 of 153 serviceCalendars keys and 64 of 64 slaPolicies keys are identical to en-US in de-DE and ja-JP (as in #513). Verdict: accepted by precedent (intake lane) and allowed by the gate, so non-blocking. Recommend a single follow-up issue to translate the new namespaces, and a documented rule in i18n.md so this stops being implicit.

## Specs and inventory
- service-calendars.md: the edits match the code (usage card, request deletion as pending action only, timezone confirmation shows live counts, list has no counts because /usage is per calendar). Permission row for Delete is accurate. Stale "usage blocked by #437 / deletion unavailable" text removed in all three places I found. No inaccuracy found.
- sla.md: the "Implemented" note is accurate and explicitly lists what is not implemented (badge/bar primitives, columns, reports).
- screen-inventory.md: three rows moved to 🟡 and one new row (Service calendar editor) at 🟡; P2 15 to 16, total 138 to 139; check:inventory passes. Rows are honest ("in progress"). Recommendation: keep them 🟡 after merge. The 2026-10-10 sign-off rule (screen-inventory.md ~17-24) says ✅ requires the owner's screen sign-off; also the persisted real-runtime specs, Linux G8 comparison and (after B2/B3) corrected layouts are not yet evidenced. Move to ✅ only in a later sign-off PR.
- No held D5 content: no request-type, intake, portal, triage, feature-flag runtime or god-mode/features code or i18n added (verified by file list and keys).

## G8 baselines (question 5)
All four PNGs (1280x720, dark) are real, non-empty, correct-data screens: Support coverage calendar list (one card, tools notice), calendar editor (details, weekly cover Monday 09:00-17:00, coverage preview 40 h/week and 1,736 h, usage card starting at the fold), SLA list (Priority support, Active version 1), SLA editor (Policy configuration, Goal matrix start). They match the visual-screens.json cases and inventory routes (check:visual-scope passes). Caveats: they capture only the ready state (no loading/empty/error), which is consistent with how the other 15 cases work; they currently encode the B2 narrow-column and B3 header layout defects, so they must be regenerated after the fix. The SLA editor capture shows only the first row of the goal matrix (viewport crop).

## #513 absorption table
Disposition key: main = already on main; #696 = ported/adapted here; held D5 = decision-log D5 hold (not to be ported); skipped = justified; UNACCOUNTED = no disposition recorded.

| #513 unit | Location | Notes |
| --- | --- | --- |
| routes settings/calendars.tsx, calendars/$id.tsx, sla-policies/$id.tsx | #696 (byte-identical to #513) | |
| routes settings/sla-policies.tsx | #696 (adapted) | permission-call adaptation |
| components/service-calendar/* (9 files) | #696; 7 byte-identical, editor-view adapted, plus new calendar-usage-card (+test) | usage and deletion are main-only API additions |
| components/sla-policy/* (2 files) | #696; summary-card identical, editor adapted | |
| fetchers service-calendar (+test), sla-policy | #696 (sla-policy identical; service-calendar adds usage and deletion) | contracts unchanged on main |
| hooks queries/mutations service-calendar, sla-policy (13 files + pagination test) | #696 (identical), plus usage query and deletion mutation | |
| use-service-calendar-editor (+test), service-calendar-form (+test) | #696 (editor adapted: keepFieldsRef, usage; form identical) | |
| lib/routes.ts (+test), generated-route-metadata, routeTree.agent.gen | #696 (calendar/SLA builders only; generated files regenerated) | |
| query-client/index.ts | #696 (shouldRetryQuery extracted) | |
| use-workspace-permission.ts | #696 adapted (manageServiceCalendars only) | #513's `workspaceIdOverride`, manageRequestTypes, triageIntake not taken; main has target-scoped reads |
| use-workspace-permission.test.tsx | NOT PORTED | gap, N5 |
| dashboard/settings/workspace.tsx | #696 adapted (two links) | request-type/triage links skipped (held / #598) |
| i18n 18 locales + schema | #696 for serviceCalendars and slaPolicies only | portal, requestTypes, intakeTriage, common.modals skipped (held / on main) |
| e2e service-calendar.spec, sla-policy.spec | #696 (service-calendar adapted; sla-policy identical) | |
| e2e service-calendar-persisted, sla-policy-persisted | #696 (identical) | not run locally (Testcontainers); need CI |
| e2e visual.spec.ts, visual-screens.json | #696 (4 cases merged) | |
| 4 *-linux.png baselines | #696 re-acquired on Linux (not copied) | must be regenerated after B2/B3 |
| docs screen-inventory.md, service-calendars.md, sla.md | #696 adapted | |
| apps/web package.json `@taskdesk/domain` | main | already present |
| request-type components/fetchers/hooks/routes (request-type-fields, request-type.ts, use-request-types, settings/request-types.tsx, request-types/$id.tsx) | held D5 (main has #598 intake request-types screen instead) | |
| god-mode/features.tsx, workspace-switcher "Feature availability" link | held D5 (feature-flag runtime) | |
| agent/triage.tsx, submissions/$ref.tsx, portal/index, catalogue.$key, submissions, submissions.$ref, routeTree.portal.gen | held D5 / #598 canonical | |
| e2e portal-intake.spec.ts, playwright.portal.config.ts, `test:e2e:portal` script | held D5 | |
| docs: attachments, audit-trail, custom-fields, god-mode, identity-provisioning, intake-queue, projects-and-engagements, request-types-and-catalogue, settings-hierarchy | skipped (held feature specs; main specs are authoritative) | |
| **create-project-modal.tsx organisation select, create-project.ts and use-create-project.ts `organisationId`, get-customer-organisations.ts, use-customer-organisations.ts (and the API side `apps/api/src/project` organisationId, +schema/response/policy)** | **UNACCOUNTED** | Not on main (no `organisationId` in project create web or API), not in the impl report's skip list, not calendar/SLA. Likely tied to request-catalogue customer visibility (D5-adjacent), but nobody has recorded a disposition. |

Can #513 close as absorbed? For the calendar and SLA authoring UI: yes, once B1-B3 are fixed and merged, with the persisted specs green in CI. For the whole of #513: not as "absorbed" without recording the disposition of the project customer-organisation selector and its API half. Recommend closing #513 as "superseded: calendar/SLA UI absorbed by #696; request-type and portal remainder held by D5 and #598; project customer-organisation selector tracked in a new issue (or explicitly held)".

## Residual risk
Persisted (Testcontainers) specs and the Linux G8 comparison were not run by me; CI is authoritative. After B2/B3 the baselines change, so the existing "Reviewed head" evidence for the baselines (baseline report on 9fcb77ae) and reviewer A's APPROVE on 42ed9164 need re-binding to the fix head. I did not exercise keyboard order interactively or the mutation paths again (reviewer A did). The axe run used mock data with 1 calendar and 1 policy; axe does not exercise open dialogs or the timezone confirmation. The raw-element finding was found by the CI-equivalent script; I did not confirm the CI job itself (not run on GitHub).

## Verdict
REQUEST CHANGES. B1 (a failing required CI gate, one-line fix), B2 (invisible loading state in both editors, content-dependent page widths, cramped error alerts) and B3 (mis-laid card headers frozen into the G8 baselines) are blocking; B2 and B3 require the four Linux baselines to be reacquired and the review evidence re-bound to the new head. Everything else (contracts, specs, inventory honesty, token/route-policy/permission/bundle gates, i18n parity, absence of held D5 content) is sound.
<!-- END REPORT (sha256 89bb516c56fa0073c918ec50662ad25e3fbe653a9dcef52c8513064bd39a3b16) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/696-ecd4-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 f5ea4bb3e49001cce1895fd20e2f35d707dcfe7d953c9d88c874d73a878d994c) -->
# PR #696 ordinary review B, delta 42ed9164..ecd485c5 (re-review of B1-B3)

Model: Claude Sonnet 5.5 (reviewer B, fresh context, did not author or direct the change).
**Reviewed head:** ecd485c5828a9c242aff731d5a70e66e23a7f107
Base for this delta: 42ed91645599759080e026f15fd386cba3030a02 (my earlier reviewed head; report 696-ordinary-b-sonnet.md). Commits: 94cc10ab (fix), ecd485c5 (baselines). Underlying main base a0992497.
Scratch copy: detached worktree /Users/heinthura/.codex/worktrees/review-696-b2 at ecd485c5 (removed afterwards). No docker containers started. Original worktree not modified.

## Files examined
Diff 42ed9164..ecd485c5 for calendars.tsx, sla-policies.tsx, service-calendar-editor-view.tsx, sla-policy-editor.tsx, both summary cards, holiday-import-panel.tsx, service-calendar.spec.ts, use-workspace-permission.test.tsx, i18n delta, pairs.json stat; the three regenerated PNGs plus reading the unchanged editor PNG logic; 696-94cc-baseline-report.md.

## Commands and results (ecd485c5, scratch copy)
- pnpm install --frozen-lockfile, pnpm build (6/6): ok.
- pnpm check:ui: pass. **pnpm check:ui:raw-elements: pass, 0 raw JSX elements** (was exit 1).
- pnpm check:tokens: pass (418 pairs). check:visual-scope: pass (19 cases). check:i18n: 18 locales in sync. check:inventory: pass. check:bundle-size: pass (230.1/350, 298.6/350, 163.7/200 KB gz). check:route-policy: pass. test:permissions: pass.
- Web vitest (components/service-calendar, components/sla-policy, fetchers/service-calendar, editor hook, routes, use-workspace-permission, mutations, form lib): 7 files, 59 tests pass (was 58; +1 canManageServiceCalendars test).
- pnpm lint:ci: 196 warnings, 1 info (unchanged baseline); no error after removing my own test-results artifact.
- Playwright probe (untracked throwaway spec, deleted) against the built agent app, mock API, 1280x800, same method as the first review:
  - Loading states (API delayed): calendar list main 1280, skeleton 1232x64; calendar editor main 1280, skeleton 821x48; SLA list main 1280, skeleton 1232x64; SLA editor main 1280, skeleton 821x48. Before: editors 48 px main and 0x48 skeleton.
  - Ready widths: all four mains 1280 (before: SLA list 665, SLA editor 767).
  - Error states (API 500): all four mains 1280 with a role=alert (before 510 and 275 for the editors).
  - SLA goal input accessible names (aria-labelledby resolved): "Incident | First response | Low", "... | Medium", "... | High" (before: "Low" only).
  - SLA new with zero calendars: shows "No service calendars exist yet. Create a calendar" link (before: silent empty select).
  - axe 4.13.0, six ready states, light and dark: no serious or critical violations. Only moderate heading-order remains on calendar editor (#calendar-day-mon) and SLA editor (#sla-type-t1, h3 under h1 with no h2). The earlier moderate page-has-heading-one on editor error states was not re-measured in this run (the error probe checked width and role=alert only).
- Not run: persisted Testcontainers specs, Linux visual regeneration (taken from the baseline report), full CI, interactive keyboard walkthrough.

## B1-B3 status
- B1 raw `<input type="file">`: fixed. holiday-import-panel.tsx now uses the `@taskdesk/ui` Input with `Label htmlFor="holiday-import-file"`; check:ui:raw-elements passes. (The prior aria-label on the input is retained; the visible Label also names it.)
- B2 shell shrink-wrap and invisible loading: fixed. All six `<main>` shells in calendars.tsx, sla-policies.tsx, service-calendar-editor-view.tsx and sla-policy-editor.tsx are `w-full min-w-0`. Measurements above confirm. The e2e assertion is now `toBeVisible` plus a width greater than 300 px (service-calendar.spec.ts), a real guard. Note: it covers the calendar editor only; the SLA editor loading state has no equivalent assertion (non-blocking, see N-new-1).
- B3 card headers: fixed. Both summary cards use CardHeader with CardAction; the regenerated PNGs show the metric and the badge right-aligned in the title row.

## New PNGs
- service-calendar-list-linux.png (new f96df7f0...): full-width shell (New calendar button at the right edge x~1255), card title/timezone left, "40 h/week / Manual holidays: 0" right-aligned in the title row. Correct, real content. Minor remaining nit: the footer "Open a calendar to see where it is used." is still inset about 8 px left of the title (x=41 vs 49), because CardContent padding differs from CardHeader; cosmetic, non-blocking.
- sla-policy-list-linux.png (new b28a70fa...): full width, "Active version 1" badge right of the title, description below, pagination at the edges. Correct.
- sla-policy-editor-linux.png (new e1ac2ffb...): both cards span the full width, two-column fields, goal grid spreads to four columns (Low/Medium/High/Urgent). Correct, real content.
- service-calendar-editor-linux.png (unchanged): consistent. I measured the calendar editor's ready main at 1280 px both before and after the fix (its content grid already filled the viewport), and the visual case captures only the ready state, so the w-full change does not alter it. The baseline lane's pre-update probe also showed that test still passing. The unchanged baseline is therefore expected, not a missed update. Its loading and error states are not part of any G8 capture.
- check:visual-scope passes; the three updated cases match visual-screens.json.

## Findings
Blocking: none.
Non-blocking:
- N-new-1: the new width/visibility guard exists only for the calendar editor; the SLA editor and both list loading states have no `toBeVisible` plus width assertion, so a regression of B2 there would only be caught by G8 (and G8 captures ready states only). Consider mirroring the assertion in sla-policy.spec.ts.
- N-new-2: remaining moderate axe heading-order on both editors (h3 section headings under h1) and, from the earlier review, no h1 in editor error branches (not re-measured). Cosmetic accessibility polish for a later pass.
- N-new-3: calendar list card footer 8 px inset (above).
- Earlier non-blocking items N4 (empty-state pagination nav), N6 (English-only locales), N8 (settings sidebar context) and reviewer A's items are unchanged and still non-blocking. N1 (goal input names), N3 (SLA calendars error/empty) and N5 (permission unit test) are resolved by this delta.

## Residual risk
Linux baseline correctness rests on the baseline lane's v11 pinned-image machinery and my visual reading of the three PNGs; CI G8 is authoritative. Persisted real-runtime specs still need CI. Reviewer A's APPROVE and the baseline reports are bound to older heads; the exact-head evidence needs re-binding to ecd485c5 (code review of this delta by A, and any required security-scope review, since apps/web/e2e/** and the PNGs are in security-scope paths).

## Verdict
APPROVE (delta 42ed9164..ecd485c5). B1, B2 and B3 are genuinely fixed and independently re-measured; all gates I ran pass at this head.
<!-- END REPORT (sha256 f5ea4bb3e49001cce1895fd20e2f35d707dcfe7d953c9d88c874d73a878d994c) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/696-security-opus.md; Claude Opus 5.5; sha256 097d7301cb5a5cdd1259cc939f30774a646c80d1708a0064a85272200d21aa78) -->
# PR #696 security review: service calendar and SLA policy settings UI

Model: Claude Opus 5.5 (claude-opus-5-5). Fresh independent context. I did not author, direct or remediate this change.
Role: independent security reviewer at the orchestrator's request. Under CLAUDE.md this is not the GPT-6 Sol gate and does not replace it.

**Reviewed head:** 371ccac6ebc4f38d4960406a497246e3db77bb17

- Merge base with origin/main: af663a0cd65e872c2b368d69e29392e89acfbad3. 371ccac6 is a merge of origin/main into the branch, so the merge base is main's tip.
- Parents: ecd485c5828a9c242aff731d5a70e66e23a7f107 (branch) and af663a0cd65e872c2b368d69e29392e89acfbad3 (main).
- Limitation: `git fetch` and `gh` failed on this host with a TLS/credential error. I could not check the live PR head or main's current tip on GitHub. The local worktree HEAD is 371ccac6, and the last-fetched origin/main is af663a0c.
- Scratch copy: a detached worktree at /Users/heinthura/.codex/worktrees/review-696-sec (371ccac6). It was removed afterwards.
- The original worktree is unmodified: HEAD is 371ccac6 and the status is clean.

## Surfaces examined
- **Scope of the diff** (`git diff --stat af663a0c 371ccac6`). It touches 80 files, all under `apps/web/**`, `i18n/**`, `docs/**` and `packages/ui/src/styles/pairs.json`. Nothing changes under `apps/api`, `packages/permissions`, `packages/domain`, migrations, CI or lockfiles. The PR changes no API code.
- **Server routes on main:**
  - `apps/api/src/service-calendar/{index,policy,schema,repository}.ts`
  - `apps/api/src/sla-policy/policy.ts`
  - The pending-action creation and approval path: `apps/api/src/pending-action/service.ts` and `deletion-targets.ts`, including `assertCalendarUnused`
  - The iCalendar parser: `packages/domain/src/calendar/holiday-import.ts`
- **Client:**
  - `apps/web/src/fetchers/{service-calendar,sla-policy}.ts`, which use `client` from `@taskdesk/libs` (the CSRF-issuing Hono client in `packages/libs/src/hono.ts`)
  - `holiday-import-panel.tsx` and `calendar-usage-card.tsx`
  - `use-workspace-permission.ts` (adds `manageServiceCalendars` from server `/api/capabilities`)
  - `query-client/index.ts` (a pure refactor of the retry function)
  - I grepped the changed web sources for `dangerouslySetInnerHTML`, `innerHTML`, raw `fetch`, `<Trans`, `eval` and storage APIs. There are none.
- **E2E:**
  - `service-calendar{,-persisted}.spec.ts`, `sla-policy{,-persisted}.spec.ts` and `visual.spec.ts`
  - The fixture `tests/e2e/helpers/mfa-csrf-app-fixture.ts`
  - The #686 guard: `apps/web/src/test/e2e-secret-redaction.test.ts` and `e2e/helpers/redact-secret-error-context.ts`
- **The four new Linux PNGs.** I checked their chunks and looked at the content.
- **`pairs.json`**: a structured diff against the merge base.
- **The merge tree.**

## Tests and reproductions (scratch copy at 371ccac6)
Setup: `pnpm install --frozen-lockfile` and `pnpm build`. Both passed. I rebuilt with `VITE_API_URL=""` to match CI for the persisted e2e run.

### Merge cleanliness
`git merge-tree --write-tree ecd485c5 af663a0c` gives `31ff0d00ad83773afed8de054d76d4f056dd3a57`. This is identical to `371ccac6^{tree}`, so the merge is clean with no hand edits.

### pairs.json against the merge base (scripted)
- Entries: 418 at the base and 418 at the head.
- No entry's scalar fields (fg, bg, category, minRatio, themes, usage, backdrop, classes, surfaceContext) were changed or removed.
- `minRatio` values are {3, 4.5} on both sides, so no threshold was weakened.
- occurrenceIds: 869 at the base and 901 at the head. None were removed. 32 were added, all from the new service-calendar and sla-policy files.
- `occurrences` records: 3090 at the base and 3186 at the head. None were removed and 96 were added.
- Two shared ids (`field.tsx` FieldLabel and FieldError) gained extra `--color-card` pair memberships at 4.5. This adds coverage and removes none.
- `pnpm check:tokens` passed: "418 declared, source-grounded pairs meet thresholds".

### Static gates
| Gate | Result |
| --- | --- |
| `check:route-policy` | pass |
| `check:ui:raw-elements` | pass, 0 raw JSX elements |
| `check:visual-scope` | pass, 19 cases |
| `check:policy` | pass |
| `test:permissions` | 14 files, 88 tests pass |
| Web vitest, full | 147 files, 626 tests pass |
| #686 redaction guard (`e2e-secret-redaction.test.ts`) | pass |
| Existing main suites `service-calendar.test.ts` and `sla-policy.test.ts` (CI=true, Testcontainers) | 2 files, 24 tests pass |

### Server enforcement probe
- Method: a throwaway integration file run with CI=true, serialized (`maxWorkers: 1`) against a Testcontainers Postgres. Mutations used real cookie sessions and the production CSRF issuer (`csrfRequest`). The file was deleted with the scratch worktree. **6 of 6 passed.**
- **P1, member and viewer (sla_policy:read only) in their own workspace:**
  - Read: 200.
  - Every write returned 403: calendar POST, PATCH, holiday import and DELETE, and SLA policy POST, PATCH and publish.
  - Calendar name and holidays are unchanged, there are 0 pending actions, and there is still 1 calendar.
- **P2, admin of workspace B against workspace A's calendar and policy:**
  - GET, preview and usage returned 404, and the A-scoped list returned 403.
  - SLA GET returned 404 and the A-scoped SLA list returned 403.
  - PATCH, import and DELETE returned 404, and POST into A returned 403.
  - SLA PATCH and publish returned 404.
  - A B-scoped SLA policy that names A's calendar returned 422.
  - No state changed.
- **P3, deleting a referenced calendar:**
  - Two calendars were tested: one referenced by a project and one referenced by an SLA policy draft version. `/usage` reports the references correctly.
  - `DELETE` returns **202** (a pending action is created) for both.
  - Approving each returns **409 `service_calendar_in_use`**. The action stays `pending` and both calendars remain.
  - An unreferenced calendar's DELETE returns 202 and the row stays until approval.
  - A second DELETE on the same calendar returns 409.
- **P4, hostile iCalendar input** to `POST /holidays/import` (admin). All rejections returned 400 in under 25 ms.
  - Over 256 KiB.
  - An 8 KiB+ unfolded line.
  - 20,000 fold continuations.
  - Nested VEVENT/VALARM.
  - 5,000 nested BEGIN lines.
  - `RRULE:FREQ=DAILY;COUNT=1000000000` and `RRULE:FREQ=SECONDLY;UNTIL=9999...`. RRULE is an unsupported property.
  - 1,001 events.
  - A DTEND span of thousands of years.
  - LF-only line endings.
  - Raw 0xFF 0xFE 0xC3 bytes in the JSON body.
  - An 8 MiB `ics` string (400 at the 256 KiB check after JSON parse, 22 ms).
  - **Exception:** a lone UTF-16 surrogate (`\ud800`) in SUMMARY returns **500**, with no state change (see N2).
  - A SUMMARY of `<img src=x onerror=alert(1)>` is accepted and stored as plain data. The client renders it as a React text node (see below).
- **P5, CSRF and concurrency:**
  - A cookie-session PATCH with a same-origin Origin but no CSRF token returns 403 `csrf_token_missing`.
  - A stale `If-Match` returns 409.

### E2E with Playwright (Chromium)
- Mock specs `service-calendar.spec.ts` and `sla-policy.spec.ts`: 12 passed.
- Persisted specs:
  - With the default local build, both failed at sign-up with "Failed to fetch". The cause was my build's API base URL, not the candidate.
  - After a CI-equivalent `VITE_API_URL=""` rebuild, **both passed** (9.6 s and 8.6 s).
  - The persisted calendar spec imports through the real UI against a CSRF-enforcing API and reads the result back from PostgreSQL. This confirms that the browser client sends the CSRF token on the import mutation.
  - `test-results/` then held only the two intentional success screenshots. There were no traces or video.

### Secrets
- `gitleaks dir` over every added or modified non-PNG file in the diff: no leaks found.
- The new e2e files contain only static mock placeholders (`e2e-csrf-token`, `session-token-e2e`).
- Persisted specs use the fixture's random `randomBytes(36)` password, a random `@example.test` email, a random auth secret and a per-run Testcontainers Postgres.
- The PNGs contain only IHDR, IDAT and IEND chunks (1280x720) and show mock calendar and SLA UI.

### Docker hygiene
- My runs created only Testcontainers Ryuk and Postgres containers. Their Ryuk reapers removed them: 981b976e8c32, 1f1d22c81d1b and 8029c1394366 are gone.
- I removed no containers by hand.
- Two Testcontainers containers present at the end (session 89a8ae38ab99) belong to another lane's concurrent `vitest` run (`project...`). I did not touch them.
- The `taskdesk-*` compose containers were not touched.

## Client-side checks
- **Holiday import (`holiday-import-panel.tsx`):**
  - `file.size > 256 * 1024` is rejected before reading (line 80).
  - It decodes with `TextDecoder("utf-8", { fatal: true })` (line 81), so non-UTF-8 files are refused in the browser.
  - It caps the preview at 1,000 events.
  - Preview names and server errors are rendered as React text (`<li>{name}</li>` at line 153, and `<AlertDescription>{error}</AlertDescription>`). There is no HTML sink.
  - The client limits mirror the server's `HOLIDAY_IMPORT_LIMITS`. The server is authoritative regardless.
- **`canManageServiceCalendars`** reads `manageServiceCalendars` from the server's `/api/capabilities`, which already exists on main. It defaults to false and is used only to hide or disable controls. P1 confirms the server refuses those writes independently.
- **Mutations:** every mutation (create, update, import, delete request, SLA create, update and publish) goes through `client` from `@taskdesk/libs`. No raw fetch exists. `If-Match` is sent on PATCH, import and publish.
- **Deletion request:** the client navigates to `routes.pendingAction.path` with the returned `pendingActionId`. It does not follow a server-supplied `approveUrl`.

## Findings

### Blocking
None.

### Non-blocking

**N1. The persisted specs do not redact the Playwright failure snapshot.**
- Locations: `apps/web/e2e/service-calendar-persisted.spec.ts:4,15` and `apps/web/e2e/sla-policy-persisted.spec.ts:4,15`.
- Both specs turn trace, video and screenshot off, but they do not call `redactSecretErrorContext` in `afterEach`.
- I reproduced that Playwright's aria snapshot (used for `error-context.md`) prints `<input type="password">` values in clear: `textbox "Password": <value>`.
- So a failure while the sign-up form is filled would write the fixture's password into `error-context.md`, which `ci-full.yml` uploads with `apps/web/test-results/`. My first local run, misconfigured, failed at exactly that point.
- The #686 guard passes because these specs show no MFA markers. The value is a random, single-run credential for a throwaway Testcontainers instance, so the exposure has no practical value.
- Recommendation: add the `afterEach(redactSecretErrorContext)` line to both specs. Separately, consider widening the #686 marker set to include `new-password` fills.

**N2. A lone UTF-16 surrogate in the holiday import returns 500.** This is pre-existing in main's API, not in this PR.
- Location: `apps/api/src/service-calendar/index.ts:400`, with the parser at `packages/domain/src/calendar/holiday-import.ts:200`.
- `{"ics": "...SUMMARY:\ud800..."}` returns 500. State is unchanged.
- The `TextDecoder(fatal)` check runs on a re-encoded JS string, so it can never fail. Lone surrogates pass the parser and are then most likely rejected when written as JSONB.
- The web client cannot produce this, because it decodes the file with fatal UTF-8. Only API callers with `sla_policy:manage` can reach it.
- Recommendation: a robustness fix on main (reject non-well-formed strings with 400). It is outside this PR.

**N3. No request-body size cap before JSON parsing.** This is pre-existing on main, not in this PR.
- Location: `importHolidayBody.ics` is `z.string().min(1)` with no max (`apps/api/src/service-calendar/schema.ts:87`). No body-limit middleware exists in `apps/api/src`, and none exists in `deploy/traefik/dynamic/middlewares.yml`.
- The 256 KiB bound is applied only after the whole JSON body is parsed. An 8 MiB body was parsed and then refused in 22 ms.
- This applies to every JSON route, not just this one. It requires an authenticated manager.
- Recommendation: a platform-level body limit, tracked on main.

**N4. A DELETE on a referenced calendar is accepted as a pending action.**
- Location: `apps/api/src/service-calendar/index.ts:306,479`.
- The OpenAPI 409 text, "Calendar is in use or already has a pending deletion", suggests a request-time refusal for an in-use calendar. In practice the in-use check runs only at approval (`deletion-targets.ts:1084`, 409 `service_calendar_in_use`), and the action stays `pending`.
- CAL-9's safety property holds: nothing referenced is deleted. The UI also disables the button while usage counts are non-zero, or still loading.
- This is a contract and UX discrepancy, not a security defect.

**N5. The mock browser specs do not assert the CSRF header on mutations.**
- Real CSRF enforcement is covered by the persisted calendar spec and by my P5 probe, so this is a test-depth note only.

## Residual risk / not checked
- Live GitHub state was not checked (TLS failure on this host): PR head, required checks, and main moving past af663a0c. Before merge, re-verify that `gh pr view 696` reports head 371ccac6 and that main has not moved.
- I did not regenerate or compare the Linux G8 visuals. CI G8 is authoritative.
- I did not review the approval page UI itself, which is on main and unchanged.
- API-key-credential deletion and approval paths were not probed in this run. The existing main suite covers API-key scope narrowing.
- An SLA policy write with a stale `If-Match` was probed only for the calendar PATCH. For SLA I read the If-Match plumbing in the code but did not probe it.

## Verdict
**CLEAR.**
- The PR is web, i18n, docs and test only.
- Every write it drives is enforced server-side by capability, reach and workspace scope, CSRF and If-Match. Deletion goes only through the pending-action flow, with in-use refusal at approval.
- The holiday-import parser on main is bounded against size, line, nesting, recurrence and event-count abuse. The client renders file content as text only.
- `pairs.json` is strictly additive, with no threshold changed.
- The merge 371ccac6 is tree-identical to git's own merge.
- N1 is a cheap hardening that should be added to this PR or a follow-up. N2 and N3 are pre-existing main issues that should be filed separately.
<!-- END REPORT (sha256 097d7301cb5a5cdd1259cc939f30774a646c80d1708a0064a85272200d21aa78) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/696-2245-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 cab2e59e6f6acfef1c7a188015d3a540e892f6d9af43c354597e31f4b0ea5aac) -->
# PR #696 delta ordinary review A: 42ed9164..2245d85f

Model: Claude Sonnet 5.5 (reviewer A, fresh context, no authorship of these commits).
**Reviewed head:** 2245d85fa8ad5bf76533ad5d2aaf44f03b2d1086
Delta base: 42ed91645599759080e026f15fd386cba3030a02. Commits: 94cc10ab (fixes), ecd485c5 (3 baselines), 371ccac6 (merge of origin/main af663a0c), 2245d85f (redaction hooks).
Scratch worktree at 2245d85f, removed afterwards. No containers started by me; taskdesk-* compose containers untouched.

## 94cc10ab: no contract or fetcher change
Touched: calendar and SLA route/editor/summary-card components (shell sizing classes w-full min-w-0, card header and file-input layout), sla-policy-editor.tsx, use-workspace-permission.test.tsx, service-calendar.spec.ts, i18n (3 new keys per locale + schema), pairs.json. No file under fetchers/, hooks/queries, hooks/mutations, lib/routes.ts or apps/api changed. If-Match, cursor, 409/422/404 handling and capability gating from my earlier review are therefore untouched.

## New SLA calendar-select states (sla-policy-editor.tsx)
- calendarsError from useServiceCalendars drives a role="alert" FieldError; a settled empty list (not loading, data empty) shows copy plus a link to /agent/settings/calendars/new (routes.serviceCalendarEditor, id "new"). Logic and keys (calendarsError, calendarsEmpty, calendarsCreate) are correct and present in all 18 locales.
- Goal inputs gain aria-labelledby (type, metric, priority label ids) which are all defined on the elements; no behavioural change.
- Non-blocking N6 (new): when the workspace is still resolving (query disabled, isLoading false, data undefined), a brand-new policy editor can briefly show "No service calendars exist yet" with the create link. Cosmetic and transient; consider also requiring workspace?.id.
- Non-blocking N7: the error and empty states have no unit or browser test (no test references the new strings). Behaviour verified by reading only.

## canManageServiceCalendars test
use-workspace-permission.test.tsx new case asserts true for the active workspace and false for a target-scoped workspace-2 from /api/capabilities. Mutation (hook returns false always) makes it fail, so it is non-vacuous.

## Merge 371ccac6
`git diff` of the merge against git's own three-way auto-merge (merge-tree af663a0c + ecd485c5) is empty: clean, no hand edits. The merged main commits are docs only (views.md, review note), so no runtime effect.

## Persisted spec edits (2245d85f)
Both specs import the existing helper apps/web/e2e/helpers/redact-secret-error-context.ts and add `test.afterEach(({ page: _page }, testInfo) => { redactSecretErrorContext(testInfo); })`, the exact pattern used by mfa-csrf-journey.spec.ts and instance-users-journey.spec.ts, alongside the existing trace/video/screenshot off. The repository guard apps/web/src/test/e2e-secret-redaction.test.ts discovers rendering specs and asserts this pattern; it passes. The helper only rewrites errorContext on test errors; no test logic changed.

## Baselines (ecd485c5)
Three PNGs regenerated (calendar list, SLA editor, SLA list); not inspected pixel-wise by me. CI G8 is authoritative.

## Commands on 2245d85f
- pnpm typecheck: 9/9. pnpm check:i18n: in sync. pnpm check:tokens: 418 pairs pass.
- Touched vitest (permission, e2e-secret-redaction, service-calendar components, fetchers, routes): 20 files, 101 tests passed.
- Web vitest full: 147 files, 626 tests passed.
- Mock-backed service-calendar + sla-policy browser specs on a fresh agent build: 12 passed (including the new width assertion on the editor loading shell).

## Findings
Blocking: none. Non-blocking: N6, N7 above; earlier non-blocking items unchanged.

## Residual risk
Persisted Testcontainers specs, Linux screenshot comparison and CI not run by me.

## Verdict
APPROVE (delta).
<!-- END REPORT (sha256 cab2e59e6f6acfef1c7a188015d3a540e892f6d9af43c354597e31f4b0ea5aac) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/696-2245-security-rebind-opus.md; Claude Opus 5.5; sha256 05afdb9a87437b5442f6f5ab745c79e954d118eb19b6e7a518629e64ce461ff3) -->
# PR #696 security rebind: N1 redaction fix

Model: Claude Opus 5.5 (claude-opus-5-5). This is the same independent reviewer context that wrote 696-security-opus.md. I did not author, direct or remediate this commit.
Role: an independent security re-review at the orchestrator's request. It is not the GPT-6 Sol gate and does not replace it.

**Reviewed head:** 2245d85fa8ad5bf76533ad5d2aaf44f03b2d1086

- Previously cleared head: 371ccac6ebc4f38d4960406a497246e3db77bb17 (report 696-security-opus.md).
- Merge base with origin/main: af663a0cd65e872c2b368d69e29392e89acfbad3.
- Scratch copy: a detached worktree at /Users/heinthura/.codex/worktrees/review-696-sec2 (2245d85f). It was removed afterwards.

## Live state (fetch retried, succeeded)
- `git fetch origin` exited 0 this time.
- `git ls-remote origin`:
  - `refs/heads/main` is af663a0cd65e872c2b368d69e29392e89acfbad3. **Main has not moved.**
  - `refs/pull/696/head` is 2245d85fa8ad5bf76533ad5d2aaf44f03b2d1086. This matches the candidate.

## Delta
- 2245d85f has a single parent, 371ccac6.
- Commit subject: "test(e2e): redact failure snapshots in the persisted calendar and SLA specs".
- `git diff --stat 371ccac6 2245d85f` shows 2 files, 12 insertions and 0 deletions:
  - `apps/web/e2e/service-calendar-persisted.spec.ts` (+6)
  - `apps/web/e2e/sla-policy-persisted.spec.ts` (+6)
- Each spec adds three things:
  - `import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";`
  - A comment.
  - `test.afterEach(({ page: _page }, testInfo) => { redactSecretErrorContext(testInfo); });`, placed after the unchanged `test.use({ trace: "off", video: "off", screenshot: "off" })`.
- No other change. Every surface cleared at 371ccac6 is byte-identical.

## Reproduction (scratch copy at 2245d85f)
Setup: `pnpm install --frozen-lockfile` and `pnpm build` passed.

1. **Real persisted specs with the hook, deliberately failing at sign-up.**
   - I built with the default local API URL, the same misconfiguration that failed my earlier run.
   - Both specs fail at `toHaveURL(/onboarding/)` after the password has been filled.
   - Both `error-context.md` files contain "Page snapshot omitted because this workflow displays authentication secrets."
   - The only "password" matches are the spec's own source lines (the variable name `password`). No value appears.
2. **Control: the same failure with the 371ccac6 spec, with no hook.**
   - I restored the file afterwards.
   - `error-context.md` contained the page snapshot with the full name, email and the **fixture's sign-up password in clear text** under `textbox "Password"`.
   - This confirms N1 was real in the actual failure mode.
   - The value was a single-run random credential for a destroyed Testcontainers instance. It is deliberately not reproduced here, and the artifact was deleted.
3. **Sentinel probe: a throwaway spec, deleted afterwards.** The spec fills a password `<input type="password">` with a known sentinel, then fails.
   - With the same `afterEach` hook: the snapshot is omitted. The sentinel appears only in the spec source excerpt, where it was written as a literal.
   - Without the hook: `- textbox "Password": <sentinel>` appears.
4. **Guard test:** `apps/web/src/test/e2e-secret-redaction.test.ts` passed, 4/4.
   - The guard keys on MFA markers, so it does not require these two specs to redact.
   - Both specs now match the guard's two regexes anyway. That compliance is voluntary, not machine-enforced.

## Hygiene
- Docker:
  - Each persisted-spec run used Testcontainers (Ryuk and Postgres). The Ryuk reapers removed them.
  - No Testcontainers containers remain.
  - I removed no containers by hand. The `taskdesk-*` containers were not touched.
- Port 4178 was briefly held by another reviewer lane (`review-696-a3`). I waited for it to free up rather than interfering.
- `test-results/` and the probe spec were deleted with the scratch worktree.
- The original worktree is clean at 2245d85f.

## Findings
**Blocking:** none.

**Non-blocking:**
- **N1: resolved.** Verified by reproduction above.
- **N1a, new.** The #686 guard still would not catch a future persisted spec that fills a password without redacting, because its markers are MFA-only. Suggested follow-up: add `new-password` / `type="password"` fills (or use of `withMfaCsrfApp`) to the guard's marker set.
- **N2–N5:** unchanged from 696-security-opus.md. N2 and N3 are pre-existing on main; N4 and N5 are contract and test-depth notes. None is affected by this delta.

## Residual risk
- I did not re-run the full suite on 2245d85f. The delta is test-only, in two e2e spec headers.
- I did not re-run the passing persisted run with CI-equivalent `VITE_API_URL=""`. That passed at 371ccac6, and the delta adds only an `afterEach`, which runs after the test body.

## Verdict
**CLEAR** at 2245d85fa8ad5bf76533ad5d2aaf44f03b2d1086.
<!-- END REPORT (sha256 05afdb9a87437b5442f6f5ab745c79e954d118eb19b6e7a518629e64ce461ff3) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/696-3a0f-security-rebind-opus.md; Claude Opus 5.5; sha256 70c5b90a1098107f83dfb4a570102f9ca4a59924f2ea6d4a4670050184042b1c) -->
# PR #696 security rebind: review note and merge of main bf23f525 (#698)

Model: Claude Opus 5.5 (claude-opus-5-5). This is the same independent reviewer context that wrote 696-security-opus.md and 696-2245-security-rebind-opus.md. I did not author, direct or remediate these commits.
Role: an independent security re-review at the orchestrator's request. It is not the GPT-6 Sol gate and does not replace it.

**Reviewed head:** 3a0f1f825d14b082a764556343f77c3a2daeaa61

- Previously cleared head: 2245d85fa8ad5bf76533ad5d2aaf44f03b2d1086.
- Parents of 3a0f1f82:
  - fd9c12f1dae7fe187605db6ad9fac7419055823c (branch: the review note, on top of 2245d85f)
  - bf23f525e047d986780d724340044f94d865b77c (origin/main, the merge of #698)
- Merge base of the two parents: af663a0cd65e872c2b368d69e29392e89acfbad3. The new merge base with main is bf23f525.

## Live state
- `git fetch` succeeded.
- `git ls-remote origin` was run at the start and again at the end of the review. Both times:
  - `refs/heads/main` was bf23f525e047d986780d724340044f94d865b77c. **Main is still bf23f525.**
  - `refs/pull/696/head` was 3a0f1f825d14b082a764556343f77c3a2daeaa61. This matches the candidate.

## fd9c12f1 (the note)
- It adds only `docs/07-planning/security-reviews/696-service-calendar-sla-ui.md` (+594 lines).
- gitleaks `dir` on a copy found no leaks.
- It does not contain the disposable fixture password from my N1 reproduction. I searched for that password's prefix and found 0 matches.

## Merge correctness
- `git merge-tree --write-tree fd9c12f1 bf23f525` gives tree 048b23e0, with a single conflicted path: `packages/ui/src/styles/pairs.json`.
- `git diff --name-only 048b23e0 3a0f1f82` lists only `packages/ui/src/styles/pairs.json`. **Every non-conflict file equals git's own merge.**
- Files changed on both sides relative to af663a0c: the 18 locale files, `i18n/schema.json` and `pairs.json`. Git auto-merged the i18n files.
- I checked i18n with a scripted three-way comparison of flattened keys for all 19 JSON files. **There are 0 mismatches** against the expected merge: each key is taken from the side that changed it, and no key is lost or invented.
  - For en-US, #696 changed 220 keys and #698 changed 27, with 0 overlapping.
  - For schema.json, #696 changed 513 paths and #698 changed 63, with 0 overlapping.
- `pnpm i18n:schema` on the merge head left the worktree clean, so the schema regeneration is a no-op. `check:i18n` reports all locales in sync.
- I checked pairs.json with a per-entry three-way script over the base, both parents and the head:
  - There are 418 entries in all four. The scalar fields of every entry (fg, bg, category, minRatio, themes, usage, backdrop, classes, surfaceContext) equal the base in both parents and in the head.
  - For occurrenceIds and for the full `occurrences` records (including `chain`), the head equals the exact union of both parents' additions: **0 invented, 0 missing**.
  - Neither parent removed anything. There are 2,512 occurrenceIds and 3,198 occurrences in the head.
  - minRatio values are {3, 4.5} and identical per entry to the base. **No threshold changed.**
  - `check:tokens` passed: "418 declared, source-grounded pairs meet thresholds".

## Interaction between #698 and the #696 surfaces
- #698's files (af663a0c..bf23f525) are:
  - the work-item approvals component, its test, and the work-item-detail integration
  - `fetchers/approval/*` and the approval query and mutation hooks
  - `e2e/approval-withdrawal.spec.ts`
  - the `work-item-detail-linux.png` baseline
  - its own review note, i18n and pairs.json
- None of these is also changed by #696. That includes routes, route metadata, query-client, use-workspace-permission, the `@taskdesk/libs` client, visual-screens.json, the playwright config and fixtures. #698 changes no `apps/api` code.
- **i18n:** the key sets are disjoint (see above).
- **E2E:**
  - `approval-withdrawal.spec.ts` is mock-only (`page.route("**/api/**")`). It opens no ports and does not use Testcontainers or `withMfaCsrfApp`.
  - All specs share the config's single preview server on 4178 with `workers: 1`.
  - The #696 persisted specs use the fixture's dynamically allocated ports, so there is no collision.
- **The work-item-detail baseline:** #696 changes no `packages/ui` component, and #698's baseline comes from main. G8 in CI is authoritative.

## Tests on the merge head (scratch worktree at 3a0f1f82, removed afterwards)
- `pnpm install --frozen-lockfile` and `VITE_API_URL="" pnpm build` passed.
- Static gates, all exit 0:
  - `check:tokens`
  - `check:i18n`
  - `check:visual-scope` (19 cases)
  - `check:ui:raw-elements` (0 raw elements)
  - `check:route-policy`
- Web vitest, full: **149 files, 649 tests passed.**
- #686 redaction guard: 4/4 passed.
- **Playwright, together in one run:** `service-calendar.spec.ts`, `sla-policy.spec.ts` and `approval-withdrawal.spec.ts` all passed (15 tests).
- **Persisted specs, first run:** both failed at sign-up ("Failed to fetch"). This is the same symptom as my earlier misconfigured local build.
  - Their `error-context.md` files again showed "Page snapshot omitted". This incidentally confirms the N1 redaction on the merged head.
- **Persisted specs, after a forced full rebuild** (`VITE_API_URL="" pnpm build --force`): the persisted specs and `approval-withdrawal.spec.ts` ran together, and **5 of 5 passed**.
  - I attribute the first failure to a stale local build artifact. Only the forced rebuild cleared it. This is not a candidate defect.
  - CI builds from clean.

## Hygiene
- Docker:
  - The only containers I created were Testcontainers Ryuk and Postgres for the persisted specs.
  - The Ryuk reaper removes them. At the end, only my Ryuk (session e64af8160290) remained, and it reaps itself.
  - I removed no containers by hand. The `taskdesk-*` containers were not touched.
- The original worktree is clean at 3a0f1f82.

## Findings
**Blocking:** none.

**Non-blocking:** unchanged from earlier reports.
- **N1:** resolved.
- **N1a:** the #686 guard markers are MFA-only. Suggested follow-up: extend them to password fills.
- **N2 and N3:** pre-existing on main. They are unchanged by #698, which touches no API code.
- **N4 and N5:** contract and test-depth notes, unchanged.

No new findings from the merge.

## Residual risk
- I did not compare the Linux G8 visuals for the merged tree, including #698's work-item-detail baseline. CI is authoritative.
- I did not re-run the API integration probes. The merge brings in no `apps/api` changes, so main's server behaviour for the #696 routes is as probed at 371ccac6.

## Verdict
**CLEAR** at 3a0f1f825d14b082a764556343f77c3a2daeaa61.
<!-- END REPORT (sha256 70c5b90a1098107f83dfb4a570102f9ca4a59924f2ea6d4a4670050184042b1c) -->
