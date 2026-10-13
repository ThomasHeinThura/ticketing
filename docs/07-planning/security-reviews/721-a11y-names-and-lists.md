# PR #721 security review record: accessible names and list roles on project views, settings and mobile nav

PR #721 fixes the axe critical and serious defects from issue #695.

**Fixes:**
- the dnd-kit live region and instructions move out of the sidebar list;
- project settings and workflow Select triggers are named through `aria-labelledby` (visible label plus value);
- workflow rows become `ul`/`li`;
- delete, column-name and icon buttons are named;
- the mobile header navigation trigger is named.

**Coverage:** `apps/web/e2e/project-views-a11y.spec.ts` adds mock-backed `@a11y` axe coverage for those screens. A `pairs.json` path rename follows the `ul`/`li` change.

**Why security-scope:** the e2e spec and the gate manifest.

**Authors:** a Claude Sonnet 5.5 lane implemented it. The conductor (Claude Opus 5.5) made the merge of `main`. The reviewers below are fresh, independent contexts that did not author, direct or remediate the change.

## Review chain

- Ordinary review by Claude Sonnet 5.5: APPROVE at `981ec002`. Reverting each source fix makes its spec fail.
- Ordinary delta review by the same context: APPROVE at `dbfea5b3`. Label-in-name is now satisfied via `aria-labelledby`, and the column-name label is stable.
- Security review by Claude Opus 5.5: CLEAR at `dbfea5b3`. The e2e spec is mock-only, the redaction guard passes 15/15, `pairs.json` is a path rename only, there is no unsafe rendering, and the dnd-kit live region is scoped to its drag context.

**Reviewed head:** `981ec00230acac2daebc4c8a56570c4d3c3d8b0e`
**Reviewed head:** `dbfea5b32770a8fd8524529092d985d8bc9e3133`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `721-ordinary-sonnet.md` | Ordinary review (66565b2c..981ec002) | Claude Sonnet 5.5 | `981ec002` | APPROVE | `1398bb22eae8905443f88bdd2076862be1e781bcb63c37f23365e4be913ade4c` |
| 2 | `721-dbfe-ordinary-sonnet.md` | Ordinary delta review (981ec002..dbfea5b3) | Claude Sonnet 5.5 | `dbfea5b3` | APPROVE | `c37bdb69c7cbbb432afdfc71ae88324ec113c4ac6a5a6fa5d09d88ddfe18da0d` |
| 3 | `721-security-opus.md` | Security review (66565b2c..dbfea5b3) | Claude Opus 5.5 | `dbfea5b3` | CLEAR | `624b73a8debcb329baf8b8f9947bfe375c0654722ecf51cfef22bbece9c49a29` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/721-ordinary-sonnet.md; Claude Sonnet 5.5; sha256 1398bb22eae8905443f88bdd2076862be1e781bcb63c37f23365e4be913ade4c) -->
# PR #721 ordinary review (issue #695)

Model: Claude Sonnet 5.5 (fresh independent context; did not author or direct the change)
Reviewed head: 981ec00230acac2daebc4c8a56570c4d3c3d8b0e
Base: origin/main 66565b2c2eade2378b5a1d1fd518054b2e298238 (merge base equals it)
Branch: codex/a11y-names-and-lists. Scratch worktree review-721 (detached, since removed).

## Files examined
apps/web/src/components/nav-projects-sortable.tsx (+test), common/header/mobile-project-nav.tsx (+test), project/column-editor.tsx (+test), project/workflow-editor.tsx (+test), routes/agent/_layout/_authenticated/dashboard/settings/projects.tsx, src/test/en-translation.ts, e2e/project-views-a11y.spec.ts, i18n/en-US, de-DE, ja-JP spot check plus check:i18n for all 19 catalogs and schema.json, packages/ui/src/styles/pairs.json diff, .github/workflows/ci-full.yml (a11y job), apps/web/playwright.config.ts.

## Commands and results
- pnpm install --frozen-lockfile: ok
- pnpm check:tokens (builds, then check:contrast): pass, 418 pairs
- pnpm check:i18n: all 19 locales in sync
- pnpm check:ui: pass
- pnpm check:visual-scope: pass (19 screenshot cases)
- pnpm typecheck: 9/9 successful (turbo cache hit on same content)
- pnpm test:a11y: ui stories 154 passed; playwright 8 passed (1 existing + 7 new)
- web vitest, full: 164 files / 763 tests pass; touched files (5 files, 7 tests) pass
- Revert experiment (rebuild with build:agent, then run the spec, once per reverted source file):
  - nav-projects-sortable.tsx reverted: board, backlog, calendar, gantt fail (4)
  - mobile-project-nav.tsx reverted: 200% zoom spec fails
  - column-editor.tsx reverted: workflow spec fails
  - workflow-editor.tsx reverted: workflow spec fails
  - settings projects.tsx reverted: general and workflow specs fail
  - Every fix is covered by at least one spec and every spec fails without its fix. Baseline 7/7 passes.
- pairs.json: parses as valid JSON; 60 changed lines are all the div/div/div to div/ul/li path rewrite for column-editor; check:tokens and contrast pass. 8 remaining div[0]/div[0]/div[0] ids are the new-column row, which was not converted (correct).
- Not run: the G8 visual spec itself (baselines are Linux). Reasoned from CSS instead.

## Assessment of the specific questions
1. Correctness
   - dnd-kit `accessibility.container = document.body`: DndContext portals HiddenText (instructions) and the live region into the body. aria-describedby ids resolve document-wide, so announcements still work. The unit test asserts the live region exists in body and not inside the ul. App is a client SPA (vite, no SSR render of this component), so reading document.body at render is safe.
   - Select trigger names: aria-label overrides the content-derived name. Visible text is the selected value (e.g. column name), which is not in the accessible name. Strictly this is a WCAG 2.5.3 gap (see finding N1). It matches how the sibling rows are already labelled and is the standard remedy for axe button-name.
   - ul/li workflow rows: draggable, onDragStart/Over/End handlers and the drag-preview clone logic are unchanged; refs and types changed from HTMLDivElement to HTMLLIElement consistently. Biome-ignore comment correctly removed. Keyboard behaviour is unchanged (row itself was never focusable; inner controls are).
   - Mobile nav trigger: icon-only (Menu icon), no visible text, so aria-label "Project navigation" cannot conflict with visible content.
2. No visual change: `ul` gets Tailwind v4 preflight reset (list-style none, margin 0, padding 0); `li` keeps `flex`, which overrides display:list-item, so no markers. `space-y-1` on the ul spaces li children the same as on the div. Same classes and structure. No findings. No G8 baseline should change.
3. Tests: non-vacuous, per the revert experiment. They run in CI: ci-full.yml a11y job runs `pnpm build` then `pnpm test:a11y`, and playwright serves the built preview (so local runs need a rebuild after source changes; this is existing behaviour). Unit tests: 6 new, pass.
4. i18n: all 19 catalogs in sync, schema.json updated, translations look sensible (de, ja spot-checked).

## Findings
- N1 (non-blocking): apps/web/src/components/project/workflow-editor.tsx:103 and settings projects.tsx:121. The Select trigger aria-label does not contain the visible selected value, so speech-control users saying the visible value will not match the name (WCAG 2.5.3 label in name). The pattern is consistent with the existing codebase. Optional follow-up: include the current value in the label or use aria-labelledby with the visible row label plus the value.
- N2 (non-blocking): apps/web/src/components/project/column-editor.tsx:288. The name input is uncontrolled (defaultValue) but its aria-label embeds col.name, so after an in-place edit the name is stale until refetch. Minor.
- N3 (non-blocking): apps/web/e2e/project-views-a11y.spec.ts, workflow readiness wait uses `[role="listitem"], [data-slot="input"]`. The first alternative no longer matches the li elements (the explicit role was removed); the input alternative still makes the wait meaningful, so the spec is not vacuous. Could be simplified to `ul > li`.
- N4 (non-blocking, scope): the icon-grid buttons use aria-label of the raw lucide icon name (column-editor.tsx:275, :409), which is not localized. Acceptable for a technical identifier.

No blocking findings.

## Residual risk
- Visual spec not run locally (Linux baselines); argument is CSS reasoning only.
- axe covers only the mocked fixture state; real data with unusual states (empty columns, long names) not scanned.
- Native drag-and-drop on li was not exercised in a browser (handlers unchanged in the diff).
- dnd-kit screen-reader announcements verified structurally (live region in body), not with an actual screen reader.

## Verdict
APPROVE
<!-- END REPORT (sha256 1398bb22eae8905443f88bdd2076862be1e781bcb63c37f23365e4be913ade4c) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/721-dbfe-ordinary-sonnet.md; Claude Sonnet 5.5; sha256 c37bdb69c7cbbb432afdfc71ae88324ec113c4ac6a5a6fa5d09d88ddfe18da0d) -->
# PR #721 delta ordinary review, 981ec002..dbfea5b3

Model: Claude Sonnet 5.5 (fresh independent context)
Reviewed head: dbfea5b32770a8fd8524529092d985d8bc9e3133
Base of delta: 981ec00230acac2daebc4c8a56570c4d3c3d8b0e (previous review, see 721-ordinary-sonnet.md)
Scratch worktree review-721b, detached, since removed.

## Files examined
apps/web/src/components/project/workflow-editor.tsx (+test), column-editor.tsx (+test), routes/.../settings/projects.tsx, e2e/project-views-a11y.spec.ts, i18n catalogs and schema.json (key removal).

## Commands and results
- pnpm build (VITE_API_URL=""): ok
- pnpm test:a11y: ui stories 154 passed; Playwright 8 passed (all 7 new specs, including the new combobox-name assertion on settings General)
- web vitest touched dirs (project, nav-projects-sortable, common/header): 5 files, 8 tests pass
- check:i18n: in sync; check:tokens + contrast: pass; check:visual-scope: pass; typecheck: 9/9 (turbo cache)
- grep: no remaining reference to targetColumnAria in i18n or apps/web/src

## aria-labelledby wiring
- Workflow rule selects: each trigger is labelledby `{sectionId} {rowId}-event {rowId}-value`. sectionId = useId prefix + integrationType; rowId = prefix + integrationType + eventType, so ids are unique across the 2 sections x 5 events (the unit test asserts 10 distinct aria-labelledby values). The value id is on SelectValue and resolves, since the combobox names in the unit test and e2e include the value. Names read well: "GitHub Branch Push Select column..." and "Gitea PR Merged Backlog". Placeholder state is announced as the name's tail, which is acceptable.
- Settings project select: labelId and valueId from two useId calls, label is the visible SidebarGroupLabel, value is the visible span. Name is "Project <name>"; the e2e asserts it. WCAG 2.5.3 is now satisfied for both (visible label and value are in the name).
- useId output (colons or guillemets depending on React version) is valid in an IDREF list.
- The workflow-editor.tsx diff is large only due to re-indentation from `=> (` to a block body; logic is unchanged.

## "Column name" label with many columns
- column-editor.tsx:288, `aria-label="Column name"` (stable, no {{name}} interpolation). Fixes the stale-name issue (N2).
- Adequate: the input is a text field, so its current value (the column name) is read after the label, and each input sits in its own list item, so list navigation gives position ("item 3 of 8"). A repeated identical label is therefore not ambiguous in practice.
- Optional, non-blocking improvement: associate the row via a visually-hidden or visible row label with aria-labelledby, or label the li, so form-field lists show distinct names. Not required for axe or the WCAG criteria in scope.

## Findings
- None blocking.
- NB1 (non-blocking, optional): repeated identical "Column name" labels, see above (column-editor.tsx:288).
- NB2 (non-blocking, process): the N2 test cannot show a fail-before; the implementer explains this in the impl notes. Acceptable: it asserts the name is unchanged after an edit, a real regression guard for the interpolation.
- Earlier N4 (raw lucide icon names) left as is; still non-blocking.

## Residual risk
Visual spec not run locally (Linux baselines); this delta changes no classes or structure, only ids and ARIA attributes. No real screen-reader pass.

## Verdict
APPROVE
<!-- END REPORT (sha256 c37bdb69c7cbbb432afdfc71ae88324ec113c4ac6a5a6fa5d09d88ddfe18da0d) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/721-security-opus.md; Claude Opus 5.5; sha256 624b73a8debcb329baf8b8f9947bfe375c0654722ecf51cfef22bbece9c49a29) -->
# PR #721 security-scope review (issue #695 accessibility fixes)

- **Model / context:** Claude Opus 5.5 (claude-opus-5-5), a fresh independent reviewer context. This context did not author, direct or remediate the change.
- **Reviewed head:** dbfea5b32770a8fd8524529092d985d8bc9e3133
- **Merge base / comparison base:** 66565b2c2eade2378b5a1d1fd518054b2e298238 (origin/main)
- **Head confirmation:** `git ls-remote origin` returned `refs/pull/721/head = dbfea5b32770a8fd8524529092d985d8bc9e3133` and `refs/heads/main = 66565b2c2eade2378b5a1d1fd518054b2e298238`. `git merge-base` of the two is 66565b2c. The GitHub API returned the same head and base SHAs. The PR is open.
- **Why this is security-scope:** it adds `apps/web/e2e/project-views-a11y.spec.ts` (path `apps/web/e2e/**`) and changes the `packages/ui/src/styles/pairs.json` gate manifest.
- **Workspace:** a detached scratch worktree at `/Users/heinthura/.codex/worktrees/review-721-sec` on the exact head. Dependencies came from `pnpm install --frozen-lockfile`. The worktree was removed after the review. No containers were created.

## Surfaces examined

The full diff from 66565b2c to dbfea5b3 covers 32 files (+703/-142). I read these:

- `apps/web/e2e/project-views-a11y.spec.ts` (new).
- The helpers it imports: `apps/web/e2e/helpers/g11-performance-fixture.ts` (session and route handler) and `versioned-task-fixture.ts` (imports only).
- `apps/web/playwright.config.ts`.
- `.github/workflows/ci-full.yml` (the a11y job and its artifact upload).
- `apps/web/src/test/e2e-secret-redaction.test.ts`.
- `packages/ui/src/styles/pairs.json`, checked mechanically line by line against the base.
- `apps/web/src/components/nav-projects-sortable.tsx` (dnd-kit `accessibility.container`).
- `apps/web/src/components/project/column-editor.tsx` and `workflow-editor.tsx`.
- `apps/web/src/routes/agent/_layout/_authenticated/dashboard/settings/projects.tsx`.
- `apps/web/src/components/common/header/mobile-project-nav.tsx`.
- `apps/web/src/test/en-translation.ts`.
- All 19 locale catalogs and `i18n/schema.json`.
- `apps/web/src/lib/i18n/index.ts` (interpolation escaping).

Prior reviews, read but not relied on:

- `721-ordinary-sonnet.md` (head 981ec002).
- `721-dbfe-ordinary-sonnet.md` (head dbfea5b3).
- `a11y-695-impl-sonnet.md`.

## Checks

### 1. E2E spec

**Mock-only.** `mountProjectAdminApp` calls `installPerformanceApiFixture`. That fixture routes `**/api/**` and the project WebSocket through `page.route` and `page.routeWebSocket`. The spec then adds its own handlers for capabilities, pending invitations, notifications and workflow rules. All of them answer with static JSON. The only server is the local Vite preview on 127.0.0.1:4178, and no backend or Testcontainers run.

**No real credentials.** The session values are the fixture's fake ones: token `"g11"`, CSRF `"g11-performance-csrf-token"` and the email `g11@example.test`. The spec runs with the default `authenticated = true`, so it never fills a sign-in form. The spec has no `.fill(` call at all. Its only file read is `axe-core/axe.min.js` from `node_modules`, which it injects with `addScriptTag`.

**Redaction guard.**

- The spec inherits the config defaults: `trace: "retain-on-failure"`, with video and screenshots off.
- I grepped the spec and both helpers for every guard marker: `password`, `otpauth://`, `I saved these codes`, `Verify and enable`, `#enrollment-code` and `mfa-csrf-app-fixture`. There were 0 hits.
- The guard therefore does not flag this spec. The verbose run confirms it: the 13 flagged specs are the existing journey specs, and `project-views-a11y.spec.ts` is not among them.
- This is correct. The spec renders no secret, so it does not need `trace/video/screenshot: "off"`.
- The guard's non-vacuity case passes.

**Uploads.** The CI a11y job uploads `apps/web/test-results/` as `playwright-a11y`. On failure, this spec's trace would hold only mock fixture data and fake tokens. The axe violation output is capped at 160 characters of node HTML from the same mock DOM. Nothing sensitive is uploaded.

### 2. pairs.json

- I took the base and head files with `git show`. Both have 51,704 lines.
- difflib finds 60 changed lines. All are paired one-for-one replacements, with no insertions or deletions.
- Each changed line equals its base line after one substitution: `div[0]/div[0]/div[0]/` becomes `div[0]/ul[0]/li[0]/`. That covers the `ColumnEditor` ids, the declared-pair id list and the `jsx:` chain entries. The check found 0 mismatches.
- No `threshold`, `category`, `surfaceContext`, `backdropLayers` or pair count changed. No threshold was weakened.
- `check:contrast` still reports 418 declared pairs meeting thresholds.
- The rename matches the real markup change in `column-editor.tsx:208`, where the rows' `div` became `ul` and each row `div role=listitem` became `li`.

### 3. Translated labels and accessible names

**No unsafe HTML.**

- The diff adds no `dangerouslySetInnerHTML`, `innerHTML` (beyond a test-only `document.body.innerHTML = ""` reset) or `<Trans>`. None of the touched components contain any either.
- I grepped the added i18n values for `<`, `>`, `&`, `script` and `href`. None were found.
- All new strings reach the DOM only as React attribute values (`aria-label`) or text children. React escapes both.
- The i18n config sets `escapeValue: false` (`apps/web/src/lib/i18n/index.ts:86`). That is safe here, for the same reason as the existing `markDoneAria` key: interpolated values never reach an HTML sink.

**Data sources for accessible names.**

- `deleteAria` interpolates `col.name` (`column-editor.tsx:341`). That is the column name already shown in the same row's input.
- `aria-labelledby` targets are local ids from `useId()`: the section heading, the event label and the visible `SelectValue` (`workflow-editor.tsx:110`), and the group label and visible project name (`projects.tsx:126`). They point only at elements the user already sees.
- Icon buttons use `aria-label={iconName}` (`column-editor.tsx:275`, `:407`). These are static lucide icon names.
- No new data is fetched, and no identifier hidden from the user is exposed.

### 4. dnd-kit live region

- `nav-projects-sortable.tsx:133` sets `accessibility={{ container: document.body }}`. dnd-kit then portals its hidden instructions and its `role="status"` live region into `body`, instead of rendering them inside the sidebar `<ul>`.
- The portal belongs to this `DndContext` instance. It mounts and unmounts with the component, so it does not persist across route changes. Each `DndContext` gets its own unique ids, and the kanban board's separate context is unchanged.
- The region announces only this context's drag events: pick-up, move, drop and cancel of the current user's own drag.
- No data crosses views. Moving the container changes where the region sits in the DOM, not what it says.

## Tests run (on the exact head, scratch worktree)

| Command | Result |
| --- | --- |
| `pnpm --filter @taskdesk/web exec vitest run src/test/e2e-secret-redaction.test.ts` | 1 file, 15/15 pass. The verbose list shows 13 flagged specs; `project-views-a11y.spec.ts` is not flagged. |
| `pnpm build` | turbo 6/6 tasks successful |
| `pnpm test:a11y` | UI stories axe: 1 file, 154/154 pass. Playwright `@a11y`: 8/8 pass, 7 of them from the new spec (board, backlog, calendar, gantt, settings general, settings workflow, board at 200% zoom). |
| `pnpm check:tokens` | pass; `check:contrast`: 418 pairs meet thresholds in light and dark |
| `pnpm typecheck` | turbo 9/9 tasks successful |
| `vitest run` (project, nav-projects-sortable, common/header) | 5 files, 8/8 pass |
| `pnpm check:i18n` | all locales in sync with en-US |
| pairs.json mechanical line-pair diff | 60 changed lines, 0 non-rename differences |

## Findings

- **NB1 (non-blocking, pre-existing):** `apps/web/src/components/nav-projects-sortable.tsx:133`. The sortable project list uses dnd-kit's default announcements. These read the raw draggable id (the project id), not the project name. The kanban board uses custom announcements at `kanban-board/index.tsx:402`. This is not a leak: the ids belong to projects in the user's own sidebar and already appear in URLs, and only the user's own drag is announced. This PR does not introduce it. Localized announcements that use the project name would be an a11y quality follow-up.
- **NB2 (non-blocking, informational):** `apps/web/src/lib/i18n/index.ts:86`, `escapeValue: false`. Safe for this PR, because every interpolated value (`deleteAria` `{{name}}`) goes to a React-escaped attribute. Any future use of these keys with an HTML sink would need its own review.

There are no blocking findings.

## Residual risk / not checked

- I did not run the full web unit suite or the full Playwright suite. I ran the suites listed above.
- I did not run the a11y job in CI on this head; I relied on the local run.
- I did not inspect the dnd-kit library source beyond its documented `accessibility.container` behaviour.
- No image build or deploy was done. The change is web UI markup and ARIA only, with no server, auth, migration or dependency change. `pnpm-lock.yaml` is untouched.
- The visual impact of `div` to `ul`/`li` was not re-verified by G8 visual regression in this review.

## Verdict

**CLEAR.** dbfea5b32770a8fd8524529092d985d8bc9e3133 has no blocking security findings.
<!-- END REPORT (sha256 624b73a8debcb329baf8b8f9947bfe375c0654722ecf51cfef22bbece9c49a29) -->
