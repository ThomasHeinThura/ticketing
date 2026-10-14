# PR #736 security review record: Select listbox accessible name (#725)

PR #736 fixes #725. The shared Select primitive now names its open listbox, either from explicit `aria-label` / `aria-labelledby` props or from the open trigger. It also adds an `Open` story with a Storybook G8 baseline captured by the pinned image.

Because the listbox now shares its trigger's name, three e2e specs moved from `getByLabel` to role-based Select locators. That selector-only change under `apps/web/e2e/**` makes this pull request security-scope.

A Claude Sonnet 5.5 lane implemented the change. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review A by Claude Sonnet 5.5 (real app, axe, G8): APPROVE at `2574031a` and at `fbd00cd6`. It also mechanically confirmed the merge of `main` at `ad4f0429`.
- Ordinary review B by Claude Sonnet 5.5 (primitive design, mutations): APPROVE at `2574031a` and at `fbd00cd6`. It then gave delta APPROVE at `0be69dd4` for the selector-only e2e commit.
- Security review by Claude Opus 5.5: CLEAR at `0be69dd4`. No e2e journey is weakened, there are no secrets, the DOM-derived name is XSS-safe, and the baseline hash matches.
- Mechanical security rebind at `4eccd322`: CLEAR. This is a pure merge of `main` `1f1abe7c` (#733) and does not interact with this PR's surface.
- Mechanical security rebind at `92ddcc9b`: CLEAR. This is a pure merge of `main` `6015f016` (#738), with no interaction.
- Mechanical security rebind at `64cbf169`: CLEAR. A pure merge of `main` `a31bdde3` (#730, #739), with no file overlap and no Select or i18n-deferral interaction.

**Reviewed head:** `0be69dd4c3b1acb496e3b506af6b48fcb725c0c6`
**Reviewed head:** `4eccd32268c2666fd5af68a05ee587fde55ab746`
**Reviewed head:** `92ddcc9bf21d32f4bf348ac038e215f7d9d01cc9`
**Reviewed head:** `64cbf16949a5c259430c4385bdd778712ae43953`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `736-ordinary-a-sonnet.md` | Ordinary review A (0cc0ae12..2574031a) | Claude Sonnet 5.5 | `2574031a` | APPROVE | `7f98d3fb241ffdf592187ae2eda25f88bb14ebf24cffc42393db55728b9e4404` |
| 2 | `736-ordinary-b-sonnet.md` | Ordinary review B (0cc0ae12..2574031a) | Claude Sonnet 5.5 | `2574031a` | APPROVE | `f6a6638dcd11baa99d8f435a220142284a9d256e1b4f8a965efe31386ca71bec` |
| 3 | `736-fbd0-ordinary-delta-b-sonnet.md` | Ordinary delta review B (2574031a..fbd00cd6) | Claude Sonnet 5.5 | `fbd00cd6` | APPROVE | `5fd1ba462d036ddf1d40e59edb7e727e869719d27b02626fce654dc31ab17332` |
| 4 | `736-fbd0-ordinary-delta-a-sonnet.md` | Ordinary delta review A (2574031a..fbd00cd6) | Claude Sonnet 5.5 | `fbd00cd6` | APPROVE | `b41c1781963a77b6e6bded28ee807144e1c4dd8de639653b71bbdf293178150f` |
| 5 | `736-ad4f-ordinary-merge-confirm-sonnet.md` | Merge confirmation A (fbd00cd6..ad4f0429) | Claude Sonnet 5.5 | `ad4f0429` | CONFIRMED | `f931a7a121b09cb769da4dfc0de2bfed81428933fda31bba115e391789ea664d` |
| 6 | `736-0be6-ordinary-delta-b-sonnet.md` | Ordinary delta review B (ad4f0429..0be69dd4) | Claude Sonnet 5.5 | `0be69dd4` | APPROVE | `7cbeb37646ad677b89bcc8fe2f548641f60697457759fea039478edd1e6c90ae` |
| 7 | `736-security-opus.md` | Security review (82aecead..0be69dd4) | Claude Opus 5.5 | `0be69dd4` | CLEAR | `892ae6604666d1503cfc371812936554df162209247ac2d51e0377fb16b2d9dc` |
| 8 | `736-4ecc-security-rebind-opus.md` | Mechanical security rebind (08ad4a6e..4eccd322) | Claude Opus 5.5 | `4eccd322` | CLEAR | `c5768921c7028851890e7ee3e5d76e734a2626a8cb610660a25fce9f05f35bdc` |
| 9 | `736-92dd-security-rebind-opus.md` | Mechanical security rebind (cd0b612c..92ddcc9b) | Claude Opus 5.5 | `92ddcc9b` | CLEAR | `6238111d5e45945063189a9e662a49e72fa98dd7e85ad994668dd2bdcd6554f8` |
| 10 | `736-64cb-security-rebind-opus.md` | Mechanical security rebind (5f13e088..64cbf169) | Claude Opus 5.5 | `64cbf169` | CLEAR | `3ead9827f6bbab90f7b9f39698c2561e71cb85a960bce1e0a69221d6a8fb0ad0` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/736-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 7f98d3fb241ffdf592187ae2eda25f88bb14ebf24cffc42393db55728b9e4404) -->
# PR #736 ordinary review A (Claude Sonnet 5.5)

**Reviewed head:** 2574031a499ab36ea52c4f540bee915e6f8208c5
**Base:** merge-base 0cc0ae12a8ad2fc46df539fcc29fe5199a5acb7b; current origin/main is 82aecead4c32861c3b2321af4abf7fcd1dc14731 (5 commits ahead of the merge-base; the PR touches only 4 files, all under packages/ui, none changed on main since)
**Model:** Claude Sonnet 5.5, fresh independent context (did not author/direct/remediate). Scratch worktree at the exact head, removed afterwards.

## Commands (all in the scratch worktree)
- pnpm test:a11y: exit 0. ui stories a11y 155 passed; Playwright @a11y 8 passed.
- pnpm --filter @taskdesk/ui test: 61 files, 323 tests passed.
- web vitest run: 177 files, 957 tests passed.
- pnpm typecheck (turbo): 9/9 tasks successful.
- pnpm lint:ci: exit 0, 208 warnings, 1 info, no errors at this head (implementer reported 1 error identical on main; I did not reproduce an error and did not separately run main).
- check:ui exit 0; check:tokens exit 0 (418 contrast pairs); check:visual-scope exit 0 (19 cases, 18 mapped rows).

## Correctness (select.tsx)
Name precedence: explicit aria-label / aria-labelledby on SelectPopup, else trigger aria-labelledby, else trigger aria-label, else text of trigger.labels. Verified by reading and in a browser.
- Multiple Selects: trigger found by aria-controls match, else the single aria-expanded combobox. Only one popup is open at a time, so this is fine. If two expanded comboboxes exist and neither matches aria-controls, no name is derived (safe, not wrong).
- label[for] and wrapping label: both covered through HTMLButtonElement.labels. Confirmed live (journey State/Assignee use label for=).
- SSR/hydration: the popup is portal-mounted only when open and the effect is client-only; no hydration mismatch risk. The list element is held in state (callback ref), so the effect re-runs on every open mount.
- No trigger: name is empty; explicit aria-label is the documented escape hatch.
- Trigger changing while open: the effect depends only on [listElement, disabled], so a trigger label/aria-label change while open is not re-read (stale name until reopen). Unlikely in practice.
- Remaining edge cases (non-blocking, see below).

## Real browser (Chromium, Playwright against built web app, axe-core 4.13 with all default rules, region off; light and dark via emulateMedia + html.dark)
Listbox accessibility-tree name and axe results at the exact head:
- Work-item State select (label for): listbox "State". Light/dark: violations [], aria-input-field-name and aria-hidden-focus not in violations.
- Work-item Assignee select: listbox "Assignee". Same result, both schemes.
- Create-dialog Priority select: listbox "Priority". Same.
- Bulk assignee select (aria-label trigger): listbox "Assign selected work items to". Same.
- Project settings general: first select listbox "Project Performance fixture", second listbox "Default comment visibility". Same.
aria-hidden-focus appears only under axe incomplete (needs review), always the Base UI focus-guard spans (n=4; n=9 inside the create dialog, which also lists the dialog's aria-hidden wrappers). Never a violation.
Before/after on the same flows (reverted select.tsx to merge-base, rebuilt): listbox was an unnamed `listbox` in the accessibility tree; axe still reported no violation in the real app, because a combobox exists on the page and axe exempts the listbox. So in the real app the change is an accessible-name improvement (real screen-reader benefit) rather than an axe-visible fix; the axe violation appears only when the popup is not paired (story/no-trigger case), as the implementer found.

## G8
- The PNG sha256 20e4f3eb...d2be0 matches the conductor's manual-copyback record and the PR file. The PR adds only that one PNG (4 files total); no other baseline changed.
- Opened Storybook (Primitives/Select Open) locally: layout matches the PNG (full-width trigger "Choose priority", popup directly below with group label "Priority", options Low and High). The PNG additionally shows a thick dark focus ring on the popup, a headless-focus state that my interactive capture did not show; the conductor's v11 rerun passed with it, so I treat it as expected. macOS font rendering differs from the linux baseline, so a pixel diff was not attempted.
- check:visual-scope passes.

## Findings
Non-blocking:
1. When the trigger is wrapped inside its label, label.textContent includes the trigger's own visible value text, so the name would read "Priority High" rather than "Priority". Not used by current consumers.
2. Cross-realm: `trigger instanceof HTMLButtonElement` fails for a trigger in another window/iframe document; falls back to no name. Using `"labels" in trigger` would be sturdier.
3. Stale name if the trigger label changes while open (effect deps).
4. Test/story detail: none blocking. The story uses aria-label on the trigger, so the label[for] path is covered only by a jsdom unit test, which is adequate.
Blocking: none.

## #725 recommendation
The issue asked for two things: (a) name the listbox: resolved by this PR; (b) no focusable element in an aria-hidden region: not reproducible as a violation (three of us, at this head and the implementer's, see only axe "needs review" for Base UI focus guards, which are library-internal and cannot be changed without breaking the focus loop). The Open story requirement is met. Recommendation: close #725 with `Fixes` plus a closing comment that states aria-hidden-focus was not reproducible as a violation and that the focus guards appear only as "needs review". Optionally open a separate, low-priority follow-up (or upstream Base UI note) only if Thomas wants the incomplete items tracked; I do not think part of #725 needs to stay open.

## Verdict
APPROVE at 2574031a499ab36ea52c4f540bee915e6f8208c5, no blocking findings. Ordinary review only; the security-scope Sol gate does not apply (packages/ui select + story + PNG).
<!-- END REPORT (sha256 7f98d3fb241ffdf592187ae2eda25f88bb14ebf24cffc42393db55728b9e4404) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/736-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 f6a6638dcd11baa99d8f435a220142284a9d256e1b4f8a965efe31386ca71bec) -->
# PR #736 ordinary review B (code quality / API design)

**Reviewed head:** 2574031a499ab36ea52c4f540bee915e6f8208c5
**Base:** merge base 0cc0ae12
**Model:** Claude Sonnet 5.5 (fresh context; did not author, direct or remediate; reviewer A's report not read)
Scratch worktree at exact head, removed afterwards. No Docker.

## Commands (exit, counts)
- packages/ui vitest: exit 0, 61 files / 323 tests. select.test.tsx alone: 7 passed.
- pnpm test:a11y: exit 0 after a web build existed. Stories 155 passed; Playwright @a11y 8 passed. (The first run in a fresh worktree failed only because apps/web/dist was missing; environmental.)
- pnpm typecheck: exit 0, 9/9 turbo tasks.
- pnpm lint:ci: exit 0, 0 errors, 208 warnings, 1 info. (An earlier "1 error" was only apps/web/test-results/.last-run.json created by my own Playwright run; removed, then clean. The implementer's reported lint error is probably the same artifact.)
- pnpm check:ui 0; check:tokens 0; check:visual-scope 0 (19 screenshot cases).

## Approach assessment
Base UI 1.7.0 SelectList sets only id and role=listbox, with no label wiring. SelectTrigger gets aria-labelledby from Field/Select.Label and aria-controls from the store. There is no supported prop or context that names the list, so SelectPopup forwarding aria-label/aria-labelledby to List is correct. Deriving the name from the trigger by DOM read is workable but not idiomatic. Base UI does not expose its store, so a DOM read is the only route without forking. It is acceptable as a contained workaround. A cheaper variant would set the list's aria-labelledby to the matched trigger's id, which would also follow label changes.

## Findings
1. NON-BLOCKING: the aria-labelledby branch is untested. Mutation M5 (branch removed) leaves 7/7 passing. It is the main Base UI path (Field.Label / Select.Label), so it deserves a test.
2. NON-BLOCKING: the single-expanded-combobox fallback is untested. Mutation M6 leaves 7/7 passing. The fallback can also mislabel when another expanded role=combobox (Combobox/Autocomplete) is on the page while the Select popup is unpaired. This is a narrow edge.
3. NON-BLOCKING: the `disabled` flag is redundant for correctness, because `ariaLabel ?? derived` already gives explicit precedence. M4 (flag forced false) passes. It only skips a DOM read, so consider dropping it or documenting it as an optimisation.
4. NON-BLOCKING: the effect runs once per list element (deps [listElement, disabled]). A label that changes while the popup is open is not re-read. It sets state in useEffect, so the first paint is unnamed, and the unpaired axe window briefly exists. useLayoutEffect, or a plain aria-labelledby=trigger-id, would avoid both. SSR is safe (effects only, popup is portaled) and cleanup is not needed. Multiple instances are fine when aria-controls matches.
5. NON-BLOCKING (public API): explicit aria-label/aria-labelledby on SelectPopup now land on the role=listbox instead of the presentation popup. There is no type change, since the props come from SelectPrimitive.Popup.Props. This is a mild, arguably correct, behavioural change. I found no in-repo consumer relying on the old placement. docs/02-design has no Select usage section; an optional one-liner "popup opened without a trigger needs aria-label on SelectPopup" would help but is not required.
6. NON-BLOCKING: the dead-branch risk is low. Trigger renders a button by default (nativeButton = true), so the `trigger.labels` branch is live. With nativeButton={false} the label-for fallback silently yields no name.
7. Story: Open follows the existing Primitives/Select conventions (render story, defaultOpen, aria-label, no new text-muted-foreground). check:tokens, check:ui and G8 scope pass. The new baseline PNG (9919 bytes, Linux) is present. I did not recompute pixels. Visual diffs are CI-owned.

## Mutation results (select.test.tsx, 7 tests)
- M1 remove label-for branch: killed (3 failures).
- M2 remove aria-label branch: killed (1).
- M3 ignore explicit aria-label: killed (1).
- M4 disabled forced false: SURVIVED (see finding 3).
- M5 remove trigger aria-labelledby branch: SURVIVED (finding 1).
- M6 remove single-trigger fallback: SURVIVED (finding 2).
- M7 effect deps []: killed (4).
The new tests are non-vacuous for the core paths (label-for, aria-label, explicit, axe light/dark).

## Verdict
APPROVE (no blocking findings). Non-blocking follow-ups: add an aria-labelledby test (finding 1) and consider the simpler aria-labelledby=trigger-id derivation.
<!-- END REPORT (sha256 f6a6638dcd11baa99d8f435a220142284a9d256e1b4f8a965efe31386ca71bec) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/736-fbd0-ordinary-delta-b-sonnet.md; Claude Sonnet 5.5; sha256 5fd1ba462d036ddf1d40e59edb7e727e869719d27b02626fce654dc31ab17332) -->
# PR #736 exact-head delta review B (Claude Sonnet 5.5)

**Reviewed head:** fbd00cd63ea0843e9d04361831c11112069cf3a0
Prior approved head: 2574031a499ab36ea52c4f540bee915e6f8208c5. Delta: select.tsx (1 line: useEffect -> useLayoutEffect) and select.test.tsx (+2 tests). Scratch worktree, removed afterwards.

## Verified
- Survivors killed: M5 (remove trigger aria-labelledby branch) now fails 1 of 9; M6 (remove single-trigger fallback) now fails 1 of 9. Baseline select tests 9/9.
- Residual non-blocking: mutating the fallback to `triggers[0]` (dropping the `length === 1` ambiguity guard) still passes 9/9, because the new test has only one expanded trigger. The guard is untested. Previous finding 3 (redundant `disabled` flag) is unchanged and non-blocking.
- SSR: React is 19.2.8, which no longer warns about useLayoutEffect on the server. The repo has no isomorphic layout-effect helper and no SSR/renderToString/hydrateRoot use. The listElement is null on the server, since the popup is portaled and client-only, so the effect is a no-op there anyway. SSR-safe; no warning concern.
- Tests: packages/ui 61 files / 325 tests pass. test:a11y exit 0 (stories 155 passed, Playwright @a11y 8 passed, after a web build existed). typecheck 0 (9/9). lint:ci 0 (0 errors, 208 warnings). check:visual-scope 0 (19 screenshot cases).
- Environmental notes: a fresh worktree needs apps/web/dist for the Playwright part. My runs also left untracked packages/ui/first and apps/web/test-results, which I removed before lint; they are artifacts of the test run, not of the PR.
- No PNG changed in 2574031a..fbd00cd6 (0 png files in the diff).

## Verdict
APPROVE. No blocking findings.
<!-- END REPORT (sha256 5fd1ba462d036ddf1d40e59edb7e727e869719d27b02626fce654dc31ab17332) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/736-fbd0-ordinary-delta-a-sonnet.md; Claude Sonnet 5.5; sha256 b41c1781963a77b6e6bded28ee807144e1c4dd8de639653b71bbdf293178150f) -->
# PR #736 exact-head delta review A (Claude Sonnet 5.5)

**Reviewed head:** fbd00cd63ea0843e9d04361831c11112069cf3a0
Delta base: 2574031a499ab36ea52c4f540bee915e6f8208c5 (my prior approval). Fresh scratch worktree, removed afterwards.

## Delta
`git diff 2574031a..fbd00cd6`: 2 files only. select.test.tsx (+57, two new tests) and select.tsx (1 line: `React.useEffect` -> `React.useLayoutEffect` in useTriggerListboxName). No PNG in the delta (0 png paths), so the G8 baseline is unchanged.

## Review
- useLayoutEffect: same deps and body; it now sets the name before first paint, so the listbox is not unnamed for a frame. The popup is portal-mounted client-side only when open, so there is no SSR use of the layout effect (and React 19 does not warn). The setState in a layout effect causes one synchronous re-render, acceptable. My earlier non-blocking notes (label-wrapping text, cross-realm instanceof, no re-read while open) are unchanged and remain non-blocking.
- New tests (trigger aria-labelledby branch; single-trigger fallback with two Selects) read correctly and pass.

## Runs
- packages/ui tests: 61 files, 325 tests passed (was 323; +2).
- pnpm typecheck: 9/9 tasks successful.
- pnpm lint:ci: exit 0, 208 warnings, 1 info. Note: a first run reported "1 error" only because my own Playwright run had left apps/web/test-results/.last-run.json (a format diff on a generated artifact); after deleting it the exit is 0. It is not a PR defect.

## Real built app (Chromium, axe-core 4.13 all default rules, region off, light and dark)
- State select: listbox "State"; Assignee: listbox "Assignee"; bulk assignee: listbox "Assign selected work items to". Same names in light and dark.
- Violations [] in all six runs; aria-input-field-name and aria-hidden-focus never a violation. aria-hidden-focus appears only under "incomplete" (4 Base UI focus-guard spans), as before.

## Verdict
APPROVE at fbd00cd63ea0843e9d04361831c11112069cf3a0. No blocking findings; no new non-blocking findings.
<!-- END REPORT (sha256 b41c1781963a77b6e6bded28ee807144e1c4dd8de639653b71bbdf293178150f) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/736-ad4f-ordinary-merge-confirm-sonnet.md; Claude Sonnet 5.5; sha256 f931a7a121b09cb769da4dfc0de2bfed81428933fda31bba115e391789ea664d) -->
# PR #736 merge confirmation (Claude Sonnet 5.5, mechanical, no tests run)

**Reviewed head:** ad4f04294bf331cadcfd14463fa9c91472f15899

- Parents: fbd00cd63ea0843e9d04361831c11112069cf3a0, 82aecead4c32861c3b2321af4abf7fcd1dc14731 (exactly as stated, in that order).
- Tree: head tree 83a94c59443978a0d373797c98495f493ce16c7e equals `git merge-tree --write-tree fbd00cd6 82aecead` output 83a94c59443978a0d373797c98495f493ce16c7e. Clean merge, no conflict.
- Files changed relative to fbd00cd6 equal `git diff --name-only 0cc0ae12 82aecead` exactly (6 files: 3 under apps/api/src, docs data-model.md, the 732 security-review note, tests/api-integration/workspace-delete-role-dependents.test.ts). Zero paths under packages/ui, so the approved select.tsx, tests, story and PNG are byte-identical to fbd00cd6.

## Verdict
CONFIRMED. ad4f04294bf331cadcfd14463fa9c91472f15899 is a pure merge of the approved fbd00cd6 with main 82aecead; my approval of fbd00cd6 carries over.
<!-- END REPORT (sha256 f931a7a121b09cb769da4dfc0de2bfed81428933fda31bba115e391789ea664d) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/736-0be6-ordinary-delta-b-sonnet.md; Claude Sonnet 5.5; sha256 7cbeb37646ad677b89bcc8fe2f548641f60697457759fea039478edd1e6c90ae) -->
# PR #736 exact-head delta review B (Claude Sonnet 5.5)

**Reviewed head:** 0be69dd4c3b1acb496e3b506af6b48fcb725c0c6
Delta: 0be69dd4 on top of ad4f0429. Verified `gh pr view 736` headRefOid equals this SHA. Scratch worktree, removed afterwards.

## Selector-only
git diff ad4f0429..HEAD touches 3 e2e files, 5 locator edits, nothing else (no assertion, step, timeout or fixture change):
- mfa-csrf-journey.spec.ts: getByLabel("Default level") and getByLabel("realtime") become getByRole("combobox", { name }).
- performance.bench.ts: getByLabel("Type").click() becomes getByRole("combobox", { name: "Type" }).click().
- work-item-comments-journey.spec.ts: getByLabel("Filter activity") becomes the combobox role, in the .click() and in the toContainText("Public only") assertion. The assertion text is unchanged.

## Same element
The Select trigger is role=combobox and carries the label as its accessible name (Base UI trigger, aria-labelledby or label-for). The pre-change getByLabel matched the trigger plus, now, the named listbox. The role locator keeps the trigger only, so it resolves to exactly the element getByLabel resolved to before this PR. Names are not exact:true, matching getByLabel's substring semantics; I saw no new ambiguity ("realtime", "Type", "Default level", "Filter activity" are each a single combobox on their pages).

## Other label lookups on Selects
grep of getByLabel( across apps/web, tests/, packages/ (*.ts, *.tsx): 64 hits. I checked the non-textbox-looking ones. None is a Select. The names are text inputs (Full name, Workspace name, Policy name, thresholds, Authenticator code, Summary, Preview year, window times, Date). "IANA timezone" is `.fill()`ed, so it is an input. No component test (*.test.tsx) uses getByLabel(Text) for a select-like name. No remaining Select label lookup found. (A future Select name collision would surface the same way, so it is not a regression risk beyond what exists.)

## Hosted CI at this head
- e2e (protected-route redirect job, which runs the browser smoke): PASS; log shows both mfa-csrf-journey tests green, including "changes and restores observability settings". a11y PASS; visual regression (G8) PASS; unit+component, integration, build, static all PASS.
- FAIL performance budgets (G11): single failure "work-list LCP must be strictly below 2500 (got 2517.0)", 21 passed. It is a 0.7% LCP overshoot on the work-list page, unrelated to Select or this PR's locator edits; the create-interaction bench using the edited selector was among the 21 passed. Looks like runner timing noise (slow-class runners are documented in the log); coordinator should rerun, not treat as a code defect.
- FAIL pull request template + security review: process failure, not code. The PR touches 3 e2e files that count as security paths, so the PR body needs **Model:** set to an allowed reviewer ("GPT-6 Sol", "GPT-6.1 Sol" or "Claude Opus 5.5"), a link to the committed security review under docs/07-planning/security-reviews/<pr>-<slug>.md, and a Screens opened section (not "n/a", since apps/web changed). This means GPT-6 Sol security review is now required on this exact head, because the e2e files are security-scope. Also not mine to waive.

## Verdict
APPROVE the delta (code is selector-only and correct). Not merge-ready on gates: Sol security review plus PR body fields outstanding, and the G11 LCP failure needs a rerun.
<!-- END REPORT (sha256 7cbeb37646ad677b89bcc8fe2f548641f60697457759fea039478edd1e6c90ae) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/736-security-opus.md; Claude Opus 5.5; sha256 892ae6604666d1503cfc371812936554df162209247ac2d51e0377fb16b2d9dc) -->
# PR #736 security review — fix(ui): name the open Select listbox from its trigger (#725)

**Reviewed head:** 0be69dd4c3b1acb496e3b506af6b48fcb725c0c6
**Base:** main 82aecead4c32861c3b2321af4abf7fcd1dc14731 (merge base = base; verified with `git merge-base`)
**Model:** Claude Opus 5.5 (claude-opus-5-5)
**Role:** independent security reviewer. I did not author, direct or remediate this PR.
**Date:** 2026-10-14

Head verified with `gh pr view 736 --json headRefOid` and `git fetch origin pull/736/head`. Both return 0be69dd4c3b1acb496e3b506af6b48fcb725c0c6. I reviewed in a detached scratch worktree at that exact head and removed it afterwards.

## Surfaces examined

- `apps/web/e2e/mfa-csrf-journey.spec.ts`. This is the security-scope path. I read the full diff, the `selectOptionThroughControlledPopup` helper (lines 39-60), the whole observability test (lines 260-400) and the redaction prologue (lines 1-12).
- `apps/web/e2e/work-item-comments-journey.spec.ts`: diff and surrounding step (lines 592-608).
- `apps/web/e2e/performance.bench.ts`: diff (line 380).
- The UI targets of every changed locator:
  - `god-mode/observability.tsx`: the triggers use `aria-label="Default level"` and `aria-label={module}`, where `module` is one of http, auth, database, jobs, audit, plugins, realtime.
  - `work-item-activity.tsx`: the trigger uses `aria-label={t("activity:timeline.filterLabel")}`.
  - `create-work-item-dialog-form.tsx`: the Type trigger is named by `FieldLabel htmlFor="create-work-item-type"`.
- `packages/ui/src/components/select.tsx`: the new `useTriggerListboxName` hook and the `SelectPopup` prop routing.
- `packages/ui/src/components/select.test.tsx` and `select.stories.tsx`: diff only.
- `packages/ui/src/components/primitives-select--open--linux.png`, checked against the evidence bundle `725-storybook-baseline-v11-3d09898e/`.
- The commit delta ad4f0429..0be69dd4. It touches only the three e2e files.
- Hosted CI at this head: run 38520002811 (e2e and G11 jobs) and run 38520002806 (template job).

## Commands and results

| Command | Result |
|---|---|
| `gh pr view 736 --json headRefOid,baseRefOid,files,statusCheckRollup` | Head and base match. The PR changes 7 files. |
| `git diff 82aecead...HEAD -- apps/web/e2e packages/ui/src/components/select.tsx` | Reviewed below. The e2e changes are locator-only. |
| `git diff --stat ad4f0429 0be69dd4` | 3 e2e files, +9/-7. Nothing else changed after the last Sonnet merge confirmation. |
| `gitleaks git --log-opts="82aecead..HEAD" --redact -v .` (v8.30.1) | 3 commits scanned, **no leaks found**. |
| `gitleaks dir <copy of the 3 touched e2e files> --redact` | 1 hit: `mfa-csrf-journey.spec.ts:69`, `generic-api-key`. See finding N1. It is not a secret. |
| `gitleaks dir apps/web/e2e --redact` | Same single hit. |
| `git diff --quiet 82aecead HEAD -- apps/web/e2e/helpers` | Unchanged, so the redaction helper is untouched. |
| `shasum -a 256 packages/ui/src/components/primitives-select--open--linux.png` | `20e4f3eb277b180b3fc4f518f6537eda29333f446966bd9c5357f3b53c7d2be0`. This **matches** `manual-copyback.sha256`. |
| `git diff --name-status 82aecead...HEAD` filtered on `png` and `--diff-filter=A` | Exactly one PNG, and it is Added. No existing baseline was modified or deleted. |
| `pnpm install --frozen-lockfile --offline`, then `pnpm exec vitest run` in `packages/ui` (Node v26.10.0, pnpm 10.32.1) | **61 files, 325 tests passed.** |
| Scratch probe test, markup-like `<label>` text: `<img onerror>` and `<script>` | Passed. The text lands verbatim in `aria-label`. No `img` or `script` element is created and the payload flag stays false. Probe file deleted afterwards. |
| Scratch probe test, `<label>` containing `<span hidden>` | `aria-label` = `"Visible HIDDENTEXT"`, while the trigger's own computed name is `"Visible"`. See finding N2. Probe file deleted afterwards. |
| Hosted CI e2e job 115707291513 at 0be69dd4 | `mfa-csrf-journey.spec.ts:63` (MFA and CSRF) passed. `mfa-csrf-journey.spec.ts:260` (observability) passed. `work-item-comments-journey.spec.ts:264` passed. 57 passed in total. |
| Hosted CI G11 job 115707291472 at 0be69dd4 | 21 passed, 1 failed: `work-list LCP` at 2517.0 ms against a 2500 ms budget. The changed `create-work-item click-to-paint` bench passed at a 142.2 ms median against 200 ms. See finding N4. |
| Local e2e run of the touched specs | **Not run.** `withMfaCsrfApp` uses testcontainers (`container.getConnectionUri()`), so it needs Docker, which is outside this review's limits. I relied on hosted CI at the exact head. |

## Q1 — Weakened e2e

**No weakening found. No assertion changed.** Each locator, one by one:

1. **`mfa-csrf-journey` `defaultLevel`**
   - Change: `getByLabel("Default level")` → `getByRole("combobox", { name: "Default level" })`.
   - Target: the old and new locators resolve to the same element, the `SelectTrigger` with `aria-label="Default level"`. Base UI gives it `role="combobox"`.
   - Why the change was needed: while the popup is open, the listbox now also carries `aria-label="Default level"`. `getByLabel` would then match two elements and hit a strict-mode violation. A `role="listbox"` element can never match a combobox role filter.
   - Not vacuous:
     - `selectOptionThroughControlledPopup` still asserts `aria-expanded="true"`, a truthy `aria-controls`, the `listbox` role on the controlled element, and visibility.
     - It asserts the option count is 1 with `exact: true`, then `toHaveText(value)`, `aria-expanded="false"`, and a hidden listbox.
     - The test then checks the server through `readSettings()`: `logLevels.default` equals the changed value, `version` increases, and both values are restored.
   - A locator that hit a different element could not satisfy the trigger-side `aria-expanded` and `aria-controls` assertions and the server-state assertions together.

2. **`mfa-csrf-journey` `realtimeLevel`**
   - Change: `getByLabel("realtime")` → `getByRole("combobox", { name: "realtime" })`.
   - The name match is a case-insensitive substring match, the same as `getByLabel`'s default.
   - On this page the only other combobox names are "Default level" and the other modules, and none of them contains "realtime".
   - If a second match ever appeared, strict mode would fail the test rather than let it pass.
   - The same helper and server assertions apply: `modules.realtime` changes, `version` increases, and the original value is restored.

3. **`work-item-comments-journey` "Filter activity"**
   - Both the click and the post-reload `toContainText("Public only")` now target the trigger. That is what `getByLabel` resolved to before, because the popup is closed after the reload.
   - The behavioural assertions are unchanged: `li[data-visibility="internal"]` count is 0 and `commentRow` is visible.
   - This assertion checks that the internal-comment visibility filter works, and it is untouched.

4. **`performance.bench` "Type"**
   - The trigger is named by `FieldLabel htmlFor`. A role-scoped locator selects the same button.
   - This is a performance bench, not a security assertion, and the bench passed at this head.

The CSRF assertions themselves (lines 213-256) are not in the diff. That covers `csrf_token_missing`, `csrf_token_mismatch`, `csrf_origin_invalid`, the 403 status, and the "version and levels unchanged" checks. The MFA enrolment and challenge steps are not in the diff either. Protected-route specs are untouched.

## Q2 — Secrets

- The git-range gitleaks scan is clean.
- The directory scan has one hit, at `mfa-csrf-journey.spec.ts:69`, which this PR does not change. See N1.
- The redaction guard is intact and unchanged:
  - `test.use({ trace: "off", video: "off", screenshot: "off" })`;
  - `afterEach(redactSecretErrorContext)`;
  - `apps/web/e2e/helpers/` is byte-identical to base.
- The new locator names ("Default level", "realtime", "Filter activity", "Type") are UI labels. They add nothing secret to locator descriptions or failure messages. The PR does not touch the #689/#709 surfaces (assertion messages that echo enrolment secrets in `users-primary-journey`, and the structural guard). Both issues are still OPEN and are not made worse.

## Q3 — Primitive DOM reads

**Cross-origin.** The hook reads only:
- `listElement.ownerDocument`, the listbox's own document;
- the `role`, `aria-haspopup`, `aria-expanded`, `aria-controls`, `aria-labelledby` and `aria-label` attributes of combobox triggers;
- the `textContent` of `HTMLButtonElement.labels`.

None of this can cross a frame or origin boundary. DOM APIs give no cross-origin access, and the hook never walks frames. Nothing is sent over the network.

**XSS.** The derived values go only into React props `aria-label` and `aria-labelledby` on `SelectPrimitive.List`. React writes them with `setAttribute`. There is no `innerHTML` and no `dangerouslySetInnerHTML`. The scratch probe confirmed that markup-like label text stays an inert attribute string. `aria-labelledby` is copied verbatim as an IDREF list from the trigger, which the same app authored. It can point only at elements in the same document. A consumer-supplied `aria-label`/`aria-labelledby` on `SelectPopup` takes priority and turns derivation off.

**Hidden text.** `textContent` includes descendants that are `hidden`, `display:none` or `aria-hidden`. Accessible-name computation excludes them. So a `<label>` with hidden children gives the listbox a longer name than the trigger (N2). The text is same-origin app markup already in the DOM, and no current call site puts hidden content inside a Select label. I found no `sr-only` or hidden text inside a `<label>`/`FieldLabel` paired with a Select. This is an accessibility-fidelity issue, not a security boundary.

## Q4 — Baseline

- `primitives-select--open--linux.png` has SHA-256 `20e4f3eb…7d2be0`. That equals both lines in `manual-copyback.sha256`: the evidence repo copy and the implementer worktree copy.
- It is a 1280×720 RGB PNG and shows the open "Priority" listbox with Low and High.
- It is the only PNG in the diff, and its status is Added. No existing snapshot was changed or removed.
- The evidence note records why the copy-back was manual: the v11 inventory script scans only `apps/web/e2e/visual.spec.ts-snapshots`.
- Hosted `visual regression (G8)` is green at this head.

## Findings

No blocking findings.

- **N1 (non-blocking, pre-existing):** gitleaks `generic-api-key` at `mfa-csrf-journey.spec.ts:69`.
  - The value is the RFC 6238 public test vector `GEZDGNBVGY3TQOJQ…`, which is base32 for `12345678901234567890`. It is used in a self-check of `totpForUri`.
  - The line is identical on base 82aecead, and the PR does not touch it.
  - `.gitleaksignore` only lists a historical fingerprint for this file (commit `69e61dd5…:13`), so a full-directory scan reports it again. The hosted secret-scan and GitGuardian checks are green.
  - Optional cleanup: add a current fingerprint or an inline `gitleaks:allow`.
- **N2 (non-blocking, a11y fidelity):** the `<label>` fallback uses `textContent`, so text that is hidden or `aria-hidden` inside the label reaches the listbox `aria-label`. Reproduced by the probe: "Visible HIDDENTEXT" versus a trigger name of "Visible". Same-origin and not exploitable. Suggested follow-up: build the fallback name with `aria-labelledby` pointing at the label element(s), giving any unlabelled label an `id`. Assistive technology then computes the name with the correct hidden-content rules.
- **N3 (non-blocking, correctness):**
  - The single-trigger fallback (`triggers.length === 1`) matches any expanded `[role=combobox][aria-haspopup=listbox]` in the document, including a non-Select combobox such as an autocomplete. In rare overlap it could name the listbox after an unrelated field.
  - The effect depends only on `[listElement, disabled]`, so a trigger label that changes while the popup is open is not reflected.
  - Both are labelling accuracy only, with no security impact.
- **N4 (process note, not a PR defect):** two required checks are red at this head.
  - `performance - budgets (G11)` fails on `work-list LCP` at 2517.0 ms against a 2500 ms budget. That test does not touch the Select or the changed locator; the changed create-dialog bench passed.
  - `pull request template + security review` is red, presumably until this review is recorded.
  - Neither is a security issue, but either one blocks a merge until it is green, and G11 needs a rerun or its own triage.
- **N5 (process note):** the e2e-only commit 0be69dd4 comes after the last recorded ordinary review, the Sonnet merge confirmation at ad4f0429. This review covers it from the security side. The orchestrator should confirm the ordinary-review tier is satisfied for that 9-line delta.

## Residual risk / not checked

- I did not run the touched e2e specs locally, because the fixture needs Docker via testcontainers. Evidence of them passing is hosted CI job 115707291513 at the exact head.
- I did not re-run the Storybook G8 capture. I checked the baseline only by hash against the evidence bundle and by looking at it, and hosted G8 is green.
- I did not audit Base UI internals beyond the attributes the hook reads.
- I did not re-review the ordinary scope (story and test quality) already covered by the Sonnet reviews.

**Verdict:** CLEAR
<!-- END REPORT (sha256 892ae6604666d1503cfc371812936554df162209247ac2d51e0377fb16b2d9dc) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/736-4ecc-security-rebind-opus.md; Claude Opus 5.5; sha256 c5768921c7028851890e7ee3e5d76e734a2626a8cb610660a25fce9f05f35bdc) -->
# PR #736 security review: exact-head rebind after merging main (#733)

**Reviewed head:** 4eccd32268c2666fd5af68a05ee587fde55ab746
**Prior CLEAR head:** 0be69dd4c3b1acb496e3b506af6b48fcb725c0c6 (`736-security-opus.md`, by a different Opus reviewer)
**Pre-merge head:** 08ad4a6e96b7a818a5541aa0d1d925fc9c0704e1
**Merged main:** 1f1abe7ca145d9a9749c869d4a4b94f4eb4d2537 (#733, owner/admin `sees_all`)
**Previous main:** 82aecead4c32861c3b2321af4abf7fcd1dc14731
**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). This context did not author, direct or remediate #736.

**Scope:** a mechanical rebind only. No tests were run, as the coordinator instructed. This rebind confirms that nothing changed since 0be69dd4 except a documentation commit and a clean merge of main. The substantive security analysis is the prior reviewer's, in `736-security-opus.md`; I did not re-derive it.

## Checks

All checks ran against live git and GitHub.

| Check | Result |
| --- | --- |
| `gh pr view 736` head | `4eccd322…`: matches |
| `origin/main` | `1f1abe7c…`: main is unchanged |
| Parents of 4eccd322 | `08ad4a6e…` and `1f1abe7c…`: matches |
| Tree compared with `git merge-tree --write-tree 08ad4a6e 1f1abe7c` | both `343c1ad7e0022eb5d167d7656d2b72d6332371a0`. The merge is clean and adds no hand edits. |
| `diff --name-only 08ad4a6e..4eccd322` compared with `diff --name-only 82aecead..1f1abe7c` | identical, 21 files |
| 08ad4a6e already contains 82aecead | yes |
| Commits after the prior CLEAR (`0be69dd4..08ad4a6e`) | exactly one, `08ad4a6e docs(security-reviews): record #736 review chain`. Its parent is 0be69dd4 and it adds one file, `docs/07-planning/security-reviews/736-select-listbox-name.md`, with 351 insertions. It is documentation only. |

## Interaction with #736's surface (web, e2e, ui)

The 21-file #733 delta contains only:

- `apps/api/**`: the migration 0123 SQL and meta, `index.ts` boot reconcile, and the workspace, invitation and user controllers, including `workspace-admin-reach.ts`;
- `docs/**`;
- `tests/api-integration/**`.

It contains no file under `apps/web`, `packages/` (including ui) or `tests/e2e`. A path filter for those prefixes returned nothing. There is no file-level overlap with, or interaction with, #736's surface.

**Verdict:** CLEAR
<!-- END REPORT (sha256 c5768921c7028851890e7ee3e5d76e734a2626a8cb610660a25fce9f05f35bdc) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/736-92dd-security-rebind-opus.md; Claude Opus 5.5; sha256 6238111d5e45945063189a9e662a49e72fa98dd7e85ad994668dd2bdcd6554f8) -->
# PR #736 security review: exact-head rebind after merging main (#738)

**Reviewed head:** 92ddcc9bf21d32f4bf348ac038e215f7d9d01cc9
**Prior CLEAR head:** 4eccd32268c2666fd5af68a05ee587fde55ab746 (`736-4ecc-security-rebind-opus.md`; the substantive review is `736-security-opus.md` at 0be69dd4, by a different Opus reviewer)
**Pre-merge head:** cd0b612c210acfc03d7b2c40183db2d2ae2682b7
**Merged main:** 6015f0163f150dcb7f09e485ad0985a8d890db94 (#738, service-calendar delete request-time recheck)
**Previous main:** 1f1abe7ca145d9a9749c869d4a4b94f4eb4d2537
**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). This context did not author, direct or remediate #736.
**Scope:** a mechanical rebind. No tests were run, as the coordinator instructed. The substantive analysis remains the prior reviewer's.

## Checks

All checks ran against live git and GitHub.

| Check | Result |
| --- | --- |
| `gh pr view 736` head | `92ddcc9b…`: matches |
| `origin/main` | `6015f016…`: main is unchanged |
| Parents of 92ddcc9b | `cd0b612c…` and `6015f016…`: matches |
| Tree compared with `git merge-tree --write-tree cd0b612c 6015f016` | both `40aa92ba41f13e9707ab775e852480b7e0e1244c`. The merge is clean and adds no hand edits. |
| `diff --name-only cd0b612c..92ddcc9b` compared with `diff --name-only 1f1abe7c..6015f016` | identical, 4 files |
| cd0b612c already contains 1f1abe7c | yes |
| Commits after the prior CLEAR (`4eccd322..cd0b612c`) | exactly one, `cd0b612c docs(security-reviews): bind the main-merge rebind`. Its parent is 4eccd322 and it changes only `docs/07-planning/security-reviews/736-select-listbox-name.md`, with 42 insertions. It is a note only. |

## Interaction with #736's surface (web, e2e, ui)

The #738 delta contains only:

- `apps/api/src/pending-action/deletion-targets.ts`;
- `apps/api/src/service-calendar/index.ts`;
- one security-review doc;
- `tests/api-integration/service-calendar-usage-delete.test.ts`.

It contains no file under `apps/web`, `packages/` or `tests/e2e`. A path filter for those prefixes returned nothing. There is no overlap or interaction.

**Verdict:** CLEAR
<!-- END REPORT (sha256 6238111d5e45945063189a9e662a49e72fa98dd7e85ad994668dd2bdcd6554f8) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/736-64cb-security-rebind-opus.md; Claude Opus 5.5; sha256 3ead9827f6bbab90f7b9f39698c2561e71cb85a960bce1e0a69221d6a8fb0ad0) -->
# PR #736 security review: exact-head rebind after merging main (#730 and #739)

**Reviewed head:** 64cbf16949a5c259430c4385bdd778712ae43953
**Prior CLEAR head:** 92ddcc9bf21d32f4bf348ac038e215f7d9d01cc9 (`736-92dd-security-rebind-opus.md`; the substantive review is `736-security-opus.md` at 0be69dd4, by a different Opus reviewer)
**Pre-merge head:** 5f13e088c8fb5e206f2da3f82ce25e17a6669aaa
**Merged main:** a31bdde3fde0d31b77bf7452f97abab7b8ce63fc. It contains #730 (6389d6e7) and #739 (a31bdde3).
**Previous main:** 6015f0163f150dcb7f09e485ad0985a8d890db94
**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). This context did not author, direct or remediate #736.
**Scope:** a mechanical rebind plus the #739 interaction. No tests were run, as the coordinator instructed. The substantive analysis remains the prior reviewer's.

## Checks

All checks ran against live git and GitHub.

| Check | Result |
| --- | --- |
| `gh pr view 736` head | `64cbf169…`: matches |
| `origin/main`, confirmed through the GitHub API | `a31bdde3…`: main is unchanged |
| Parents of 64cbf169 | `5f13e088…` and `a31bdde3…`: matches |
| Tree compared with `git merge-tree --write-tree 5f13e088 a31bdde3` | both `9000b55ffb7c61df5aa10b9605babfdec88a30f7`. The merge is clean and adds no hand edits. |
| `diff --name-only 5f13e088..64cbf169` compared with `diff --name-only 6015f016..a31bdde3`, where 6015f016 is the merge base | identical, 111 files |
| Commits after the prior CLEAR (`92ddcc9b..5f13e088`) | exactly one, `5f13e088 docs(security-reviews): bind the main-merge rebind`. Its parent is 92ddcc9b and it changes only `docs/07-planning/security-reviews/736-select-listbox-name.md`. It is a note only. |

## Interaction

**#736 surface.** The `a31bdde3..64cbf169` files are:

- `packages/ui/src/components/select.tsx`, `select.test.tsx` and `select.stories.tsx`, plus a baseline PNG;
- three e2e specs: `mfa-csrf-journey`, `performance.bench` and `work-item-comments-journey`;
- the review note.

None of them is changed by #730 or #739: the file intersection with `6015f016..a31bdde3` is empty.

**#739 (i18n deferral and first-paint guard):**
- #739 does not touch `packages/ui`, so it does not touch the Select primitive.
- The new `apps/web/e2e/work-list-i18n-deferred.spec.ts` uses **no Select**: no `combobox`, `listbox`, `getByLabel` or Select locator. Its only role locators are `heading` (level 1) and `button "Try Again"`.
- Its attribute scan reads `aria-label`, `title`, `placeholder` and `alt` to check for untranslated keys. #736 names the listbox with `aria-labelledby` pointing at existing trigger text and adds no i18n string, so it cannot add a raw key to that scan.
- The Select primitive has no i18n or `useTranslation` dependency. #739's namespace-group loader therefore has nothing to defer in it.
- #736's e2e selector changes (locating by combobox role) are in specs #739 does not modify.

**#730 (API reach):** API-only, so it does not interact with web, ui or e2e.

**Verdict:** CLEAR
<!-- END REPORT (sha256 3ead9827f6bbab90f7b9f39698c2561e71cb85a960bce1e0a69221d6a8fb0ad0) -->
