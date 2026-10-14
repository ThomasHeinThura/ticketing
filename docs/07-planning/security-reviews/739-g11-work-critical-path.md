# PR #739 security review record: cut the /work critical path for G11 headroom (#711)

PR #739 implements Thomas's 2026-10-14 decision on #711: engineering headroom only, with no change to the G11 gate, budgets or calibration.

**What it does:**
- A direct `/work` visit loads only the `common`, `navigation` and `workItems` i18n namespaces before first paint. The rest load after first contentful paint, through a deterministic Vite plugin, `vite/i18n-namespace-groups.ts`.
- The root route waits for the full catalog before leaving `/work`. It retries once, then falls back to the full locale, and never shows raw keys.
- A build-time guard fails the build if a first-paint module uses a deferred namespace.
- The create dialog is fetched after first paint, and the board route is preloaded.

**Measured gain:** same-machine A/B runs measured work-list LCP about 220–245 ms faster raw and board render about 12–15% faster.

**Why it is security-scope:** `apps/web/vitest.config.ts` registers the plugin.

A Claude Sonnet 5.5 lane implemented the change over three rounds. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: REQUEST CHANGES at `ad160fd3`. Raw i18n keys appeared on navigation, and the tests were vacuous. Delta APPROVE at `d26d110e`, and at `d4a17d64`.
- Ordinary review B by Claude Sonnet 5.5 (architecture, independent A/B reproducing about −234 ms LCP, docs): APPROVE at `d26d110e`. Delta APPROVE at `d4a17d64`, confirming the structural guard follows the real chunk graph.
- Security review by Claude Opus 5.5: CLEAR at `d4a17d64`. No gate or calibration change, a deterministic plugin with no injection path, portal purity intact, and a same-origin fallback only.
- Round 4 fixed hosted `check:deps` without any gate change. The loader tables are now committed placeholder files that the plugin fills at build time. Ordinary delta B: APPROVE at `867ed4f4`. Security delta: CLEAR at `867ed4f4`, finding no gate change, no injection path, deterministic builds and a pure merge of `main` `6389d6e7`.

**Reviewed head:** `d4a17d64e58d142ffdcdce12947fc527667d729b`
**Reviewed head:** `867ed4f43fd8f8fdfeaf8e531fc29fb90853c295`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `739-ordinary-a-sonnet.md` | Ordinary review A (82aecead..ad160fd3) | Claude Sonnet 5.5 | `ad160fd3` | REQUEST CHANGES | `2194263e749e58ed1e7fb89226dd7b30c4824b7f748ccd413b8afc9904bdea2f` |
| 2 | `739-d26d-ordinary-delta-a-sonnet.md` | Ordinary delta review A (ad160fd3..d26d110e) | Claude Sonnet 5.5 | `d26d110e` | APPROVE | `3c4c8f5e7c47c1618feef8fc24824c5720226a3ccf1359d2f54ff577e58d4dbe` |
| 3 | `739-ordinary-b-sonnet.md` | Ordinary review B (1f1abe7c..d26d110e) | Claude Sonnet 5.5 | `d26d110e` | APPROVE | `5ed83c0b60e5320f715c91c508698baf757a638db060add2c8d0c8511fac8413` |
| 4 | `739-d4a1-ordinary-delta-b-sonnet.md` | Ordinary delta review B (d26d110e..d4a17d64) | Claude Sonnet 5.5 | `d4a17d64` | APPROVE | `45667f398116663398ea7821d3ec18743cd445ede463cebc6b3c11a458ae4a4b` |
| 5 | `739-d4a1-ordinary-delta-a-sonnet.md` | Ordinary delta review A (d26d110e..d4a17d64) | Claude Sonnet 5.5 | `d4a17d64` | APPROVE | `ce3009187bd6f9c22aa0aeed594379a6a05f0875c2776c643fd1e2d5250b0b89` |
| 6 | `739-security-opus.md` | Security review (6015f016..d4a17d64) | Claude Opus 5.5 | `d4a17d64` | CLEAR | `55a167c1d85a4d41e81ec7eb6320f6797ac56f7220405eaa641380c040b3ad78` |
| 7 | `739-867e-ordinary-delta-b-sonnet.md` | Ordinary delta review B (d4a17d64..867ed4f4) | Claude Sonnet 5.5 | `867ed4f4` | APPROVE | `d0c6c2688b8d8ee4842298a3de981dec8de1fd7592278fc55be9a31b3f628953` |
| 8 | `739-867e-security-delta-opus.md` | Security delta review (d4a17d64..867ed4f4) | Claude Opus 5.5 | `867ed4f4` | CLEAR | `a55675018580b47f311d658c27c734fb69ed0e684047e5820ed09264dac26ff9` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/739-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 2194263e749e58ed1e7fb89226dd7b30c4824b7f748ccd413b8afc9904bdea2f) -->
# PR #739 ordinary review A (correctness, UX regressions, tests)

**Reviewed head:** ad160fd34daa2fb4baf8c4b7a597b90702e99b0b
**Base:** 82aecead4c32861c3b2321af4abf7fcd1dc14731 (main)
**Model / context:** Claude Sonnet 5.5, fresh independent context. Did not author, direct or remediate the change.
**Method:** scratch detached worktree `/private/tmp/claude-501/wt739` at the exact head (removed afterwards). Main checkout and other worktrees untouched. No Docker. Test runs serialised. Scratch Playwright specs and the proposed-fix patch are saved in `739-ordinary-a-sonnet-repro/` and `739-ordinary-a-sonnet-proposed-fix.patch` (same directory).

## Verdict
**REQUEST CHANGES.** One blocking finding (raw i18n keys on client navigation before the deferred group lands), plus one blocking test gap that is the same defect class. Everything else is green or non-blocking.

## Commands and counts (all at head ad160fd3, clean tree)
| Command | Result |
|---|---|
| web vitest (`vitest run --config vitest.config.ts`) | 179 files / 962 tests pass |
| `pnpm typecheck` (web) | exit 0 |
| `pnpm lint:ci` (`biome ci .`) | **exit 0**: 2297 files, 0 errors, 208 warnings, 1 info |
| `pnpm check:i18n` | pass, all locales in sync with en-US |
| `pnpm check:ui` | pass |
| `pnpm check:tokens` (+ contrast) | pass, 418 pairs |
| `pnpm check:visual-scope` | pass (19 cases) |
| `pnpm check:bundle-size` | pass: agent initial 231.4 KB, work-list graph 276.3 KB (14 assets), portal 164.3 KB |
| `pnpm test:a11y` | ui 154 tests pass; web 8 `@a11y` pass |
| G13 (`playwright.perf.config.ts --grep G13`) | 7/7 pass. Needed the same throwaway `CALIBRATION_FACTOR_MIN` 0.75->0.3 as the implementer (host factor 0.589); reverted, nothing committed |
| Playwright e2e (`playwright.config.ts`, own server) | Runnable (non real-runtime) specs pass: 50 passed incl. create-dialog 5/5, work-item-list-layout, settings-forms-direct-load 3/3, project-views-a11y 7/7, perf fixtures 15/15, service-calendar 11/11, auth-redirect, god-mode-users. 4 specs fail only because they need the Testcontainers real runtime (instance-users-journey, mfa-csrf-journey, realtime, work-item-comments-journey: redirected to a localhost sign-up on a dead harness port). I killed the run after the first two 4-minute Docker timeouts and ran the remaining specs by file. Not caused by this PR. |
| Builds | `vite build --mode agent` and `--mode portal` both succeed (after building workspace packages). Vite dev server serves `virtual:taskdesk-i18n/loaders-slim`, `slim-en-US`, `rest-en-US` correctly. |
| Determinism | Two clean agent builds: 783 non-map files byte-identical (only `.map` files differ, by outDir-relative paths). |

Screens opened (Chromium via Playwright): work list `/agent/projects/WLP/work?layout=list`, work-item detail `/agent/work-items/WLP-1`, create dialog; settings/dashboard URLs return Not Found in the e2e fixture, so only the detail screen could be exercised for the navigation case.

## Findings

### F1 (BLOCKING): raw i18n keys on client navigation before the deferred namespace group lands
Reproduced deterministically in Chromium (`zz-review-rawkeys.spec.ts`): direct-load `/work` with the `rest-en-US-*.js` chunk held, click a row to open the detail page. Detail screen renders literal keys: `timeline.heading`, `timeline.everything`, `timeline.loadFailed`, `timeline.retry`, `timeline.visibilityLabel`, `timeline.internalNotice`, `timeline.send`. After releasing the chunk they resolve (bindI18nStore "added" does re-render), so it is a flash, not permanent, as long as the fetch succeeds.

Why it is real, not theoretical:
- 165 call sites use `useTranslation()` (default ns) and reference other namespaces with `t("tasks:…")`, `t("settings:…")`, `t("activity:…")` etc. (about 2,000 call sites in total). i18next does not suspend or load those namespaces on demand, so any screen other than the 3 slim namespaces shows raw keys until `rest` lands.
- Under the 200 KB/s, 150 ms bench throttle the `rest` chunk finished about 1.6 s after the loader (`loaders-rest` 1973 ms, `rest-en-US` 3624 ms) and only starts after FCP plus idle (up to 2 s idle timeout). In my fixture run the rows became clickable at 3539 ms, about 85 ms before `rest` landed, so the unheld window was too small to catch by hand. With any real API faster than the chunk, or any slow or retried chunk, a click on a row inside that window hits it. The work list to detail click is the main flow.
- If the `rest` fetch fails, `loadGroup` drops the cache entry and rejects, but nothing surfaces it: every non-slim screen then shows raw keys until reload (and `preloadNamespaces` rejects as an unhandled promise).
- Pre-PR behaviour loaded the whole locale before render, so this is a regression, and the implementer lists it as a known gap.

Entry points (verified): the group mode is selected once at module load from `location.pathname` matching `/agent/projects/<key>/work`. Direct loads of sign-in, portal build, settings, deep links and the board get the full catalog (no regression there). Language switching is fine once `rest` is in: scratch vitest in group mode, `changeLanguage("fr-FR")` then `preloadNamespaces` loads all 19 namespaces for fr-FR.

**Smallest fix (prototyped and verified, patch saved):** gate navigation off the work list on the `rest` group, with a root-route `beforeLoad`:

```ts
// apps/web/src/lib/i18n/index.ts
let restLoaded = false;
export function whenAllNamespacesLoaded(): Promise<void> {
  if (!useNamespaceGroups || restLoaded) return Promise.resolve();
  const locale = isSupportedLocale(i18n.language) ? i18n.language : defaultLocale;
  return loadGroup("rest", locale)
    .then((r) => i18n.loadNamespaces(Object.keys(r)))
    .then(() => { restLoaded = true; });
}
// apps/web/src/routes/agent/__root.tsx
beforeLoad: async ({ location }) => {
  if (!WORK_LIST_PATH_PATTERN.test(location.pathname)) await whenAllNamespacesLoaded();
},
```

With this, the same held-chunk scenario shows no raw keys at any sample and the detail page renders after release. Cost: a navigation off the work list waits for `rest` if it has not landed (no extra bytes; it is the same chunk the post-paint load already fetches), and nothing for non-group sessions. Set `restLoaded` also from `preloadNamespaces` (not done in the prototype) to avoid the re-check. A failure path should show the existing root error component rather than raw keys (a rejecting `beforeLoad` does that). I did not run it through the full suite, so the implementer should add the regression test below.

### F2 (BLOCKING with F1, test gap): the i18n split tests are partly vacuous, nothing guards the defect class
Mutations I ran on the new/changed code (vitest `src/lib/i18n` + `src/components/work-item`, 20 files / 211 tests baseline):
| # | Mutation | Result |
|---|---|---|
| M1 | `afterFirstPaint`: skip `whenIdle()` after paint | caught (1 failure) |
| M2 | `afterFirstPaint`: remove the paint-timeout fallback | caught (1 failure) |
| M3 | `splitI18nNamespaces`: put every namespace in `rest` | caught (1 failure) |
| M4 | remove `"workItems"` from `WORK_ROUTE_I18N_NAMESPACES` | **survives** (211/211 pass) |
| M5 | `preloadNamespaces` in group mode no longer defers (`Promise.resolve()` instead of `afterFirstPaint()`) | **survives** (211/211 pass) |
| M6 | widen `WORK_LIST_PATH_PATTERN` to include `/board` | caught |

M4 is the dangerous one: the test "splits a catalog into disjoint groups" asserts `Object.keys(slim)` equals the constant itself (tautology), and the file header claims the test "pins the contents against the catalog", which it does not. Dropping a namespace the first paint needs ships raw keys on the primary screen with all unit tests green. M5 shows `index.ts` group mode (backend routing, deferral, `bindI18nStore`) has no test at all.

Required: a regression test that fails on raw keys. Cheapest: a Playwright spec using the existing `installPerformanceApiFixture`, holding `/assets/rest-*-*.js`, asserting (a) the work list has no key-shaped text, and (b) navigating to the detail screen shows no raw keys (my `zz-review-rawkeys.spec.ts` is a working starting point; it currently fails on the detail case at head). Plus a vitest on `index.ts` group mode (load `slim` before paint, `rest` only after `afterFirstPaint`).

### F3 (non-blocking): create dialog works, but is silent while pending and on failure
`zz-review-dialog.spec.ts`, throttled link and held shell chunk:
- Click or Enter before the chunk lands: no click is lost; the dialog appears when the chunk arrives (second click while pending is harmless; exactly one dialog). Focus lands inside the dialog (Close button / first field), `aria-labelledby` and `aria-describedby` present, Escape closes it and focus returns to the trigger. Under the 200 KB/s throttle, click right after the trigger appears: dialog visible 35 ms later, no raw keys.
- While pending there is no feedback at all (no `aria-busy`, spinner or disabled state), so a click on a very slow link looks dead.
- If the chunk fails, the failure is swallowed (`() => undefined`): no toast or error; and a retry click in the same document also did nothing in Chromium (failed dynamic import is cached by the browser). Same class of risk exists for other lazy chunks, so not blocking, but worth a retry affordance or `window.location` reload prompt later.

### F4 (non-blocking): commit and implementer notes say the trigger no longer preloads, it still does
`work-item-create-trigger.tsx` still calls `preloadWorkItemCreateDialogShell()` in an effect when `canCreate` is true (added in bfa30d0e). Commit ad160fd3 ("warm … after first paint, not at trigger mount") only added the `afterFirstPaint` preload in `work.tsx`, so the dialog still fetches at trigger mount, before the rows paint (my throttle run: shell chunks finished at 2474-2493 ms, rows at 3539 ms). I measured whether this costs LCP: 6 throttled runs each, with and without the trigger preload, median about 3.41-3.42 s both ways (range 3348-3504). No measurable effect, so harmless, but it is dead duplication and contradicts the stated design; remove one of them.

### F5 (non-blocking): portal and agent dists ship dead `slim-*`/`rest-*` chunks
Because `i18n/index.ts` imports the virtual loaders in both modes, the portal build also emits `rest-*-*.js` and `slim-*` chunks for 19 locales that portal never loads (`useNamespaceGroups` is false for portal paths). They are not fetched, `check:bundle-size` passes, portal initial +0.6 KB gzip. Only an image-size nit.

### Items checked and OK
- Plugin: deterministic (above); works in dev mode (virtual modules served, watcher invalidates on JSON change, full reload) and in build; Docker build uses `COPY . .` and `.dockerignore` does not exclude `apps/web/vite` or `i18n/`, and the image runs the same `vite build`; `check:i18n` still validates the unchanged locale JSON (it validates key parity across locales, not key usage; unchanged by this PR).
- `vitest.config.ts` change (security-review path): adds only `i18nNamespaceGroups({ i18nDir })` to the `plugins` array, so Vitest can resolve the `virtual:taskdesk-i18n/*` imports now present in `lib/i18n/index.ts`. No test selection, include/exclude, coverage threshold, environment or setup change. It is the minimal and necessary counterpart to the vite.config.ts plugin registration; no weakening.
- Lint claim: the implementer's "`lint:ci` fails only on untouched files" is **not reproduced**. On a clean worktree at the head, `biome ci .` exits 0. The failures they saw were almost certainly stray untracked files (for example `test-results`, scratch specs); in my own run the only 3 errors appeared when my untracked scratch specs were inside the tree and vanished when I moved them out.
- G11 numbers not re-measured (not in my angle); bundle gate and G13 CLS pass.

## Required before merge
1. Fix F1 (suggested patch above or equivalent) so no non-work-list screen can render before the full catalog is loaded; surface fetch failure instead of raw keys.
2. Add the F2 regression tests so mutation M4 and a held-`rest` navigation fail them. Re-run vitest and the new e2e on the new head; a new head needs a fresh review for the changed files.

Verdict: **REQUEST CHANGES** (blocking: F1, F2; non-blocking: F3, F4, F5).
<!-- END REPORT (sha256 2194263e749e58ed1e7fb89226dd7b30c4824b7f748ccd413b8afc9904bdea2f) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/739-d26d-ordinary-delta-a-sonnet.md; Claude Sonnet 5.5; sha256 3c4c8f5e7c47c1618feef8fc24824c5720226a3ccf1359d2f54ff577e58d4dbe) -->
# PR #739 round 2: exact-head delta review A (Claude Sonnet 5.5)

**Reviewed head:** d26d110e32ae4a9a093d9990dcc765285add0622
**Previous review:** ad160fd34daa2fb4baf8c4b7a597b90702e99b0b (REQUEST CHANGES: F1 raw keys, F2 vacuous tests). Base main 1f1abe7c merged in; I reviewed the web/i18n delta (`git diff 1f1abe7c HEAD -- apps/web i18n`), the API/migration files from the main merge are out of scope.
Scratch worktree (removed afterwards); repro specs in `739-d26d-delta-repro/`.

## Verdict
**APPROVE (ordinary review A), with non-blocking follow-ups.** F1 and F2 are resolved. Blocking items from round 1: none remain.

## F1 raw keys: FIXED (verified)
- Chromium, held `rest-*.js` chunk: no raw keys on the work list, on work-item detail, `/agent/triage` (Intake queue) or `/agent/settings/calendars` (Service calendars), checked with the implementer's spec and my own scan. Navigation completes after release.
- Deferred chunk aborted: falls back to the full catalog chunk, no raw keys on the work list or detail. Deferred and full catalog both aborted: root error screen ("Try Again"), no raw keys.
- Code review: `ensureAllNamespaces` is memoised per locale, cleared on failure; the full-catalog fallback is remembered per locale so the backend serves from the full chunk; `whenAllNamespacesLoaded` is a no-op outside group mode. Root `beforeLoad` skips only the work-list path.
- Navigation latency off `/work` (CDP 200 KB/s, 150 ms, 3 runs each): clicking a row after it appears: the deferred chunk landed within about 5-10 ms of the rows becoming visible in this fixture, click to detail 2.4-2.6 s with or without the chunk already in (no visible delay; the detail screen's own chunk and data dominate). Worst case, navigating at the moment the heading first paints (about 1.85 s, 0.7 s before the deferred chunk lands): detail visible about 3.8 s after navigation, versus about 2.4 s normal, i.e. roughly the remaining deferred transfer (about 0.7-1 s at this speed) is added, because the route chunk fetch starts after the gate. Only reachable by keyboard/URL navigation before rows paint; no extra bytes. Acceptable.

## F2 tests: FIXED, two residual weak spots (non-blocking)
Baseline: 21 files / 218 tests in `src/lib/i18n` + `src/components/work-item`. Mutants I ran:
| Mutant | Result |
|---|---|
| M4 drop `workItems` from first-paint list (previously survived) | KILLED (scan test) |
| M5 no post-paint deferral (previously survived) | **flaky**: killed 2 of 3 isolated runs, survived in the full run. `index.group.test.ts` asserts `rest.requests === 0` after a fixed 20 ms flush, which can finish before the deferred loader import is even reached |
| M7 do not record the full-catalog fallback | survives unit tests; KILLED by e2e "failed deferred fetch falls back" |
| M8 remove the single retry | survives unit AND e2e (the "retries once" test cannot see the retry; fallback masks it) |
| M9 `whenAllNamespacesLoaded` always resolves | KILLED (3 unit tests) |
| M10 ignore `pending` on the create trigger | KILLED |
| M11 remove root `beforeLoad` wait | KILLED (2 e2e tests: work-item open, both-fail error screen). The triage/calendars navigation tests did not fail under this mutant |
Follow-ups (non-blocking): make the M5 check deterministic (await the loader import or poll before asserting zero requests; assert the count before release against a settled promise); assert `rest.requests === 2` in the retry test to pin the single retry.

## F3 create pending and failure: OK with a11y nits (non-blocking)
- Pending (held shell chunk, keyboard Enter): button gets `aria-busy="true"` and is disabled, label unchanged, dialog opens on release with focus inside, Escape returns focus to the trigger. Nit: a natively disabled button drops focus to `<body>` while pending; `aria-disabled` plus ignoring clicks would keep focus.
- Failure (shell chunk aborted): `role="alert"` "The create form could not be loaded." plus "Reload page" button; Reload works and the alert is gone afterwards. Text is readable (dark and default theme), no dialog opened, trigger re-enabled. Nits: focus stays on `<body>` after the failure (should land on the Reload button or the trigger), the alert is unstyled (no destructive tint, not icon-marked), and it inserts above the table (layout shift on failure only). New keys exist in all 19 locales, `check:i18n` passes.

## F4: FIXED
The trigger preload effect is gone; only the route's after-first-paint preload remains.

## Runs at d26d110e (clean tree)
| Command | Result |
|---|---|
| web vitest | 180 files / 969 tests pass |
| typecheck (web) | exit 0 |
| `pnpm lint:ci` on a clean tree | **exit 0** (2303 files, 0 errors, 209 warnings, 1 info). The implementer's claim that it fails on main/clean trees is NOT reproduced here |
| check:i18n / check:ui / check:tokens (+contrast 418 pairs) / check:visual-scope / check:bundle-size | all pass (work-list graph 276.1 KB, 13 assets; portal 164.4 KB) |
| test:a11y | ui 154 + web 8 pass |
| G13 (7 tests, with the throwaway calibration floor 0.75 to 0.3, reverted) | 7/7 pass |
| `work-list-i18n-deferred.spec.ts` (6) + `work-item-create-dialog.spec.ts` (5) | 11/11 pass |
| Other non-Docker e2e (list layout, settings forms, project views a11y, perf fixture/paint recorder, service calendar, SLA policy, auth redirect, board smoke, approval withdrawal, god-mode users) | 44 pass |
| Not run | real-runtime Testcontainers journeys (no Docker); G8 visual (pinned image); hosted G11 |

Verdict: **APPROVE** (ordinary review A at d26d110e; non-blocking follow-ups above).
<!-- END REPORT (sha256 3c4c8f5e7c47c1618feef8fc24824c5720226a3ccf1359d2f54ff577e58d4dbe) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/739-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 5ed83c0b60e5320f715c91c508698baf757a638db060add2c8d0c8511fac8413) -->
# #739 ordinary reviewer B (architecture, build plugin, measurement, docs)

**Reviewed head:** d26d110e32ae4a9a093d9990dcc765285add0622
**Base:** main 1f1abe7c (merged into head); A/B baseline main 6015f016 (differs from 1f1abe7c only in 4 api/docs files, no web code)
**Model:** Claude Sonnet 5.5, fresh context, did not read reviewer A's report. Scratch worktrees `w739` (head) and `m739` (6015f016), both removed. Main checkout untouched. No Docker.

## Commands run at the exact head (clean worktree, `pnpm install --frozen-lockfile`, `pnpm turbo build --filter=@taskdesk/web`)
- `pnpm --filter @taskdesk/web test`: 180 files / 969 tests passed.
- `pnpm --filter @taskdesk/web typecheck`: exit 0.
- `pnpm lint:ci`: exit 0 (209 warnings, 1 info, no errors).
- `pnpm check:i18n`: all 20 locale files in sync.
- `pnpm check:tokens` (tokens + contrast): pass, 418 pairs.
- `pnpm check:bundle-size`: agent initial 231.5 KB gz, agent work-list graph 276.1 KB (13 assets) vs 350 budget, portal initial 164.4 KB vs 200. Main: 230.8 / 302.1 (27 assets) / 163.7.
- `pnpm check:visual-scope`: passed (19 screenshot cases, 18 active inventory rows mapped).
- `pnpm test:a11y`: ui 154 tests passed; web playwright @a11y 8 passed.
- New spec `e2e/work-list-i18n-deferred.spec.ts`: 6 passed.
- Note: a bare `pnpm build` in apps/web fails in a fresh tree (`@taskdesk/permissions` dist missing); `turbo build --filter` is the right entry. Environmental, not a PR problem.

## 1. i18n namespace-group design
Reading of `vite/i18n-namespace-groups.ts`, the virtual modules, `lib/i18n/index.ts` group mode, `__root.tsx` beforeLoad.
- Sound and fairly small. Catalog JSON stays the single source of truth (check:i18n untouched). Virtual ids are `\0`-prefixed and the plugin watches the catalog files, so dev mode (HMR full reload on catalog change) and the Vite build are both handled. The Docker image only copies `apps/web/dist`, and the build already needed the root `i18n/` dir, so the image build is not affected (not built here; no Docker).
- Group mode is gated on `location.pathname` matching the work-list pattern; every other entry keeps loading the whole locale. The root `beforeLoad` makes every non-work route await the full catalog, so in-app navigation off /work cannot render raw keys. Failure ladder (rest, retry, full catalog fallback, error component) is covered by e2e.
- Guards: unit test pins slim names against every locale and scans a fixed list of 10 files for `t("ns:` usage; e2e holds the deferred chunk and checks for raw keys.
- Portal: behaviourally unaffected (pattern never matches), but it ships 38 unused `slim-*`/`rest-*` chunks (about 2.4 MB raw, the catalog duplicated beside the full-locale chunks) and portal initial grows 163.7 to 164.4 KB gz from the new i18n code. Same duplication in the agent dist.
- Docs: `docs/01-architecture/i18n.md` says resources are "loaded per locale" and says nothing about namespace groups, the work-route slim list, or the "a string used on /work must be in the slim list" rule. `grep` finds no doc mention of `virtual:taskdesk-i18n` or `work-route-namespaces`.

## 2. vitest.config.ts
Only change: import and register `i18nNamespaceGroups(...)` in `plugins`. `test.*` (environment, setupFiles, include, coverage) untouched. Needed for `index.group.test.ts`. No change to test selection, coverage or setup. Confirmed from the diff.

## 3. Measurement (4 alternated rounds, serialized, symmetric uncommitted `CALIBRATION_FACTOR_MIN` 0.75 to 0.3 in both throwaway worktrees)
Logs and script: `739-ordinary-b-ab-raw/`. Raw ms per round (final sample set median); n=4 each.

| Metric | main 6015f016 raw | head raw | main norm med | head norm med |
|---|---|---|---|---|
| work-list LCP | 2320, 2284, 2280, 2288 (med 2286.0, sd 15.8) | 2048, 2016, 2056, 2068 (med 2052.0, sd 19.3) | 2461.9 | 2194.3 |
| board render | 359.4, 296.4, 320.2, 315.4 (med 317.8, sd 22.9) | 245.8, 270.4, 270.8, 279.0 (med 270.6, sd 12.4) | 558.4 | 473.9 |
| create-work-item click | 87.8, 81.9, 84.6, 91.3 (med 86.2, sd 3.5) | 81.0, 63.2, 88.0, 88.3 (med 84.5, sd 10.2) | 129.9 | 130.7 |

- LCP gain reproduces: about -234 raw (-10%), about -268 normalised. Far outside noise (sd 16-19).
- Board: about -47 raw, -85 normalised; reproduces. (Main needed a retry set in all 4 rounds on this host under the deviated calibration; head in 2.)
- Create click: no regression in my data (-2 ms raw, +1 ms normalised, inside sd 10). The implementer's +9 ms raw on n=3 is noise. The metric is the submit click to pending-state paint inside the already open dialog, which the PR does not touch; normalised about 130 against a 200 budget leaves about 70 ms (35%), and there is no mechanism by which this PR adds slow-runner cost to that path.
- Caveat: host is a fast M3 Max, factors 0.52-0.65; absolute normalised numbers are not hosted-comparable, only the symmetric delta is.

## 4. G8
`check:visual-scope` passes. Pixel reasoning: list screen first-paint copy is all slim namespaces (`common`, `navigation`, `workItems`); the `rest` strings on /work are the notification dropdown/tooltip content (opened on demand) and the reorder-error toast, none painted initially; `bindI18nStore: "added"` only re-renders, no visual change; the failure alert and `loading` state on the trigger render only on click/failure; the board screen only gains modulepreload links; the create-dialog screenshot is taken after `dialog` is visible, with the trigger behind the modal, and the shell is the same component, so the same pixels. I could not run the visual suite (pinned image). Believe no baseline changes.

## Findings
1. Non-blocking: slim-list guard is a fixed file list and only matches literal `t("ns:`. The work page renders `NotificationDropdown` (via `workspace-switcher.tsx`, namespace `notifications:`) and `nav-projects-sortable.tsx` (`workspace:projects.reorderError`), neither scanned. A user opening the bell or tooltip before the deferred group lands would see raw/undotted keys until the store update re-renders (self-healing, short window). The e2e raw-key regex only matches dotted tokens, and i18next drops the namespace prefix, so a missing key such as `title` is invisible to it. I tried to probe the bell in the e2e fixture but it is not clickable there; this path is verified by source reading only. Suggest: scan the whole import graph or the sidebar components too, or add `notifications` to the slim list, and widen the raw-key check (e.g. compare against the loaded catalog values).
2. Non-blocking: `docs/01-architecture/i18n.md` should describe namespace groups, the slim-list rule and the root-route wait; nothing documents this mechanism.
3. Non-blocking: portal and agent dist carry about 2.4 MB of duplicated, unused locale chunks each (38 files in portal); portal initial +0.7 KB gz. Could skip the virtual group modules in portal mode.
4. Non-blocking/informational: implementer's `lint:ci` failure was environmental; it is exit 0 on a clean tree here.
5. No blocking findings.

## Verdict
**APPROVE (ordinary review B): no blocking findings at d26d110e32ae4a9a093d9990dcc765285add0622.** LCP and board gains reproduce, create click-to-paint shows no regression, vitest.config.ts is plugin registration only. Security-scope Sol review still required for `vitest.config.ts`.
<!-- END REPORT (sha256 5ed83c0b60e5320f715c91c508698baf757a638db060add2c8d0c8511fac8413) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/739-d4a1-ordinary-delta-b-sonnet.md; Claude Sonnet 5.5; sha256 45667f398116663398ea7821d3ec18743cd445ede463cebc6b3c11a458ae4a4b) -->
# #739 exact-head delta review B (d26d110e to d4a17d64)

**Reviewed head:** d4a17d64e58d142ffdcdce12947fc527667d729b
**Previously approved:** d26d110e32ae4a9a093d9990dcc765285add0622 (non-blocking finding 1: slim-list guard gap)
**Model:** Claude Sonnet 5.5, fresh context. Scratch worktree, removed afterwards; no Docker; main checkout untouched.

## Is the implementer's sidebar claim correct? Yes.
- Static: `components/common/layout.tsx` (which renders `AppSidebar` / `workspace-switcher` / `NotificationDropdown`) is imported only by settings-layout, workspace-layout, project-layout, task-layout and the dashboard invitations route. `work.tsx` imports none of them; there is no `agent.tsx` or other layout route between `_authenticated` and the work route. So my finding 1 was based on a wrong premise (the bell and `nav-projects-sortable` are not on /work). I retract it as a defect.
- Live: Chromium probe of `/agent/projects/WLP/work` at 1280x720 after load: 0 sidebar elements (`[data-sidebar]`, `aside`), 0 `nav`, no "Projects" text. The one `aria-label*=notification` match is the toast viewport (`div role=region`, 0 children), not a bell. (My earlier "Notifications" aria-label sighting was the same toast region.)

## Does the build guard derive from the real chunk graph? Yes (mutation-tested)
Guard: in `preloadWorkRouteForDirectVisits` `generateBundle`, it takes the entry chunks, the `__root` / `_layout` / `_authenticated` route closures, and the dynamic imports of the work route and panel chunks, reads each chunk's real `modules` (non-test, `apps/web/src`), and runs `findDeferredNamespaceUsers` with an empty allowlist. It matches `"ns:key"` strings, `useTranslation("ns"|[...])` and `{ ns }`.
Mutations in the head worktree (`vite build --mode agent`), each restored afterwards:
1. Appended `"notifications:title.x"` to `work-item-list.tsx`: build exit 1, "work-item-list.tsx -> notifications".
2. Appended `useTranslation("tasks")` to `work-item-selection-toggle.tsx` (a module reached through the panel's dynamic chunks): build exit 1, names that file and `tasks`.
3. Control: same string appended to `app-sidebar.tsx` (not on /work): build exit 0. This shows the guard follows the real graph and also confirms the sidebar claim.
Unmutated build: exit 0. Unit suite `deferred-namespace-guard.test.ts` (6 tests) covers every detection form and the allowlist.
Limits (non-blocking): detection is regex on source, so a dynamically built key such as `` t(`${ns}:x`) `` or a namespace imported as a constant is not seen; the e2e raw-key check and the root wait are the backstops.

## Docs (`docs/01-architecture/i18n.md`)
Accurate against the code: group files and virtual modules, first-paint list (`common`, `navigation`, `workItems`), runtime and `bindI18nStore: "added"`, root-route `beforeLoad` wait, the three-step failure ladder, guard description, portal empty loader tables. "About 31 KB gzip" is correct (en-US.json gzips to 31.9 KB, the built chunk 31.5 KB). Referenced scripts (`i18n:check:fix`, `i18n:schema`) exist. No inaccuracy found.

## Portal
`dist/portal/assets` now has 0 `slim-*`/`rest-*` chunks (was 38, about 2.4 MB). `check:bundle-size`: agent initial 231.5 KB, work-list graph 276.1 KB (13 assets), portal initial 164.4 KB (unchanged from d26d110e, under 200). `check:bundle-purity`: portal graph clean (1 entry).

## Runs at d4a17d64 (clean install, `turbo build --filter=@taskdesk/web`)
- web vitest: 181 files / 975 tests passed (was 180 / 969).
- typecheck: exit 0. `check:i18n`: in sync. `check:visual-scope`: passed (19 cases).
- `test:a11y`: ui 154 passed, web 8 passed.
- New e2e spec `work-list-i18n-deferred.spec.ts`: 6 passed.
- `lint:ci`: exit 0 on a clean tree. (It exits 1 if Playwright's `apps/web/test-results/.last-run.json` is left behind, which is my test artefact, not a PR issue.)

## Findings
No blocking findings. The previous non-blocking items 1 (guard gap, now moot and structurally closed), 2 (docs) and 3 (portal chunks) are resolved. Remaining non-blocking: regex-based guard cannot see computed namespaces.

## Verdict
**APPROVE (ordinary delta review B) at d4a17d64e58d142ffdcdce12947fc527667d729b.** `apps/web/vite.config.ts` and `vite/i18n-namespace-groups.ts` changed; the security-scope Sol requirement, if any applies, is unchanged.
<!-- END REPORT (sha256 45667f398116663398ea7821d3ec18743cd445ede463cebc6b3c11a458ae4a4b) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/739-d4a1-ordinary-delta-a-sonnet.md; Claude Sonnet 5.5; sha256 ce3009187bd6f9c22aa0aeed594379a6a05f0875c2776c643fd1e2d5250b0b89) -->
# PR #739 round 3: exact-head delta review A (Claude Sonnet 5.5)

**Reviewed head:** d4a17d64e58d142ffdcdce12947fc527667d729b
**Previous:** d26d110e32ae4a9a093d9990dcc765285add0622 (approved). Main 6015f016 merged; I reviewed the web/i18n/docs delta only. Scratch worktree, removed afterwards.

## Verdict
**APPROVE (ordinary review A), with non-blocking follow-ups.** One real coverage hole in the new build guard (F-R3-1) is non-blocking because the runtime e2e and the root gate remain the backstops.

## Runs (clean tree)
| Command | Result |
|---|---|
| web vitest | 181 files / 975 tests pass |
| `check:bundle-size` | pass: agent initial 231.6 KB, work-list graph 276.1 KB (13 assets), portal 164.4 KB |
| `test:a11y` | ui 154 + web 8 pass |
| `work-list-i18n-deferred.spec.ts` + `work-item-create-dialog.spec.ts` | 11/11 pass |
| agent + portal builds | pass. Portal now emits 2 matching chunks (empty loader tables) versus 40 for the agent build (previously portal carried the full per-locale set) |

## Build guard: works for what it scans, one hole
Mutants applied to real source and built (`vite build --mode agent`):
- `work-item-create-trigger.tsx` uses `t("settings:profile.title")`: **build fails** naming the file and namespace.
- `work-items-panel.tsx` uses `t("tasks:status.open")`: **build fails**.
- `app-sidebar.tsx` (shell sidebar, paints on first load) uses `t("tasks:status.open")` in a live `t()` call: **build passes, not caught** (F-R3-1). Debug output shows the guard reads 72 first-paint sources and the `layout-*.js` chunk (app-sidebar, common layout, nav) is not in the walked chunk set even though `index.html` preloads it. The shell routes walked (`__root`, `_layout`, `_authenticated`) only static-close; the layout chunk is reached through a dynamic import that is not followed.
Suggested fix: also walk `dynamicImports` of the entry and shell route chunks (or add the layout chunk explicitly), with a unit/build test using a deferred string in `app-sidebar.tsx`. Non-blocking: the runtime backstops still cover visible text (root-route gate, held-chunk e2e with the broader catalogue-key check), and sidebar strings today are `common`/`navigation`.
The unit suite `deferred-namespace-guard.test.ts` (referencedNamespaces forms, allowlist, lost slim namespace) is non-vacuous for the pure function; the e2e raw-key check now also catches undotted catalogue leaves and attribute text (aria-label, title, placeholder), an improvement.

## My earlier weak spots
- **M5 (deferral timing test): NOT improved.** `index.group.test.ts` and `index.ts` are unchanged since d26d110e; with the post-paint deferral removed, `index.group.test.ts` failed 4 of 4 isolated runs this time (killed), but it survived once in a full-suite run last round, so the fixed 20 ms flush is still racy under load. Non-blocking: it guards a perf property (deferral), not correctness, and the guard against raw keys is independent.
- **M8 (retry count): NOT improved.** Removing the single retry still passes all 19 i18n tests and the e2e spec. Non-blocking: the full-catalog fallback gives the same user outcome; the retry is an optimisation.
Both can be closed by a deterministic wait for the loader import and an assertion `rest.requests === 2` in the retry test.

## Other
- Docs (`docs/01-architecture/i18n.md`) accurately describe groups, root wait, failure ladder, guard and the "adding a namespace" procedure; the guard row overstates its scope ("shell routes ... on-demand chunks") given F-R3-1.
- Portal `groupedEntry:false` is safe: the portal never matches the work-list path, so the empty tables are never read.

Verdict: **APPROVE** (non-blocking: F-R3-1 guard coverage of the shell layout chunk; M5/M8 test hardening).
<!-- END REPORT (sha256 ce3009187bd6f9c22aa0aeed594379a6a05f0875c2776c643fd1e2d5250b0b89) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/739-security-opus.md; Claude Opus 5.5; sha256 55a167c1d85a4d41e81ec7eb6320f6797ac56f7220405eaa641380c040b3ad78) -->
# PR #739 — independent security review (sampled big reviewer)

- **PR:** #739 "perf(web): cut the /work critical path for G11 headroom (#711)", branch `codex/g11-work-critical-path`
- **Reviewed head:** d4a17d64e58d142ffdcdce12947fc527667d729b
- **Base:** main 6015f0163f150dcb7f09e485ad0985a8d890db94 (merge base = base; verified with `git merge-base`)
- **Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context. It did not author, direct or remediate this PR.
- **Head verification:** `gh pr view 739 --json headRefOid` returned d4a17d64e58d142ffdcdce12947fc527667d729b.
- **Workspace:** a detached scratch worktree at the exact head under the session scratchpad. It was removed after the review. The main checkout and other worktrees were not touched. No Docker was used. Playwright's own `vite preview` web server was the only server.
- **Context:** Thomas decided on #711 (2026-10-14) that this work is engineering headroom only. It makes no gate, budget or calibration change. Ordinary reviews are recorded in `739-ordinary-*-sonnet.md` and `739-*-delta-*-sonnet.md`.

## Surfaces examined

- `apps/web/vitest.config.ts`: full diff.
- `apps/web/vite.config.ts`: full diff. This covers the first-paint namespace guard, the slim-loader preload, the board preload inline script, and the plugin registration with `groupedEntry: !isPortal`.
- `apps/web/vite/i18n-namespace-groups.ts`: full file. This is the new Vite plugin and its virtual modules.
- `apps/web/src/lib/i18n/index.ts`: group mode, retry, full-catalog fallback, `whenAllNamespacesLoaded`, and cache eviction on failure.
- `apps/web/src/lib/i18n/after-first-paint.ts` and `work-route-namespaces.ts` (the allowlist is empty).
- `apps/web/src/routes/agent/__root.tsx`: the `beforeLoad` wait.
- The `work.tsx` route, `work-item-create-dialog-shell-loader.ts` and `work-item-create-trigger.tsx`: the lazy create dialog and its load-failure alert.
- `apps/web/src/components/errors/error-display.tsx`: the error path when both the retry and the fallback fail.
- The `i18n/*.json` and `schema.json` diffs. Each adds two plain-text keys (`loadFailed`, `reload`).
- CSP posture: `deploy/traefik/dynamic/middlewares.yml`, plus a grep for `Content-Security-Policy`/`script-src` in the app.
- The new e2e spec `apps/web/e2e/work-list-i18n-deferred.spec.ts`.

## 1. Gate integrity

- **`vitest.config.ts`:** the only change is registering the plugin: `i18nNamespaceGroups({ i18nDir: path.resolve(__dirname, "../../i18n") })` is added to `plugins`. `test.environment`, `setupFiles`, include/exclude and coverage are byte-identical to the base. Test selection is not weakened. The plugin is required so that the virtual `virtual:taskdesk-i18n/*` imports resolve under test.
- **G11, G12 and G13 machinery, and calibration:** `git diff --stat 6015f016 d4a17d64 -- scripts/ci apps/web/playwright.perf.config.ts apps/web/e2e/performance.bench.ts .github package.json apps/web/package.json pnpm-lock.yaml` is empty. No changed path matches `g13|calibrat|bench|perf|bundle|purity`. The G11 fixture helper `e2e/helpers/g11-performance-fixture.ts` is unchanged; the new spec only imports it.
- **`CALIBRATION_FACTOR_MIN`:** it is still `0.75` in `scripts/ci/lib/performance-calibration.mjs:35`, and the PR does not touch it. The PR commits no calibration override, waiver or budget change.
- **New build-time failures (these tighten gates):** the `vite.config.ts` additions throw on four conditions:
  - a first-paint module uses a deferred namespace;
  - the slim loader chunk cannot be resolved;
  - the board route chunk cannot be resolved;
  - the board locale assets cannot be resolved.

  Each of these makes the build stricter. None of them relaxes an existing check.

**Result: no gate is weakened.**

## 2. Build plugin: supply chain and safety

- **Inputs:**
  - The plugin reads files only from `i18nDir`, which is resolved from `__dirname` to the repository's `i18n/` folder. It uses `readdirSync` and `readFileSync`.
  - Locale filenames are filtered by `^([A-Za-z]{2,3}-[A-Za-z]{2,4})\.json$`.
  - Virtual ids are accepted only if they match `^(slim|rest)-<locale regex>$` or `^loaders-(slim|rest)$`. Path traversal through a virtual id is therefore not possible.
  - The guard in `vite.config.ts` reads only module ids that are under `/apps/web/src/` and exist on disk, plus `i18n/en-US.json`.
- **No network, eval or dynamic code:** the diff has no `fetch`, `eval`, `new Function`, `child_process` or `process.env` use. The only URL is `http://example.com:8080/path`, inside the unit test `deferred-namespace-guard.test.ts`.
- **Injection:**
  - Generated module source embeds catalog content as `JSON.parse(${JSON.stringify(JSON.stringify(part))})`. That is a double-encoded string literal, so catalog content cannot break out into code.
  - Loader tables embed regex-validated locale names through `JSON.stringify`.
  - The inline HTML scripts embed only bundler-generated chunk filenames through `JSON.stringify`.
  - The catalogs are repository-controlled and go through the normal PR review; the plugin has no untrusted input.
- **Determinism:** the plugin sorts locale lists and iterates JSON in insertion order. It uses no time, randomness or environment input.
  - Empirically: `pnpm build` (agent and portal) was run twice from clean. That gave 1,586 files each time, and the SHA-256 manifests were **identical**. The manifest digest is `6e766e8d00f8a9e5c597b4df2d4d97ed3d3d82a7d20b7bc41a02db257a4c81a0`.
- **Dev-server hook:** `configureServer` only invalidates virtual modules and sends a full reload when a file in `i18nDir` changes. It is dev-only and has no effect on the security of the build.

## 3. Portal purity

- With `groupedEntry: false`, the portal build emits only two group chunks, `loaders-slim-*.js` and `loaders-rest-*.js`. Both were inspected and both export `{}`. The portal emits no `slim-<locale>` or `rest-<locale>` chunks. The agent build emits 38 of them.
- `pnpm check:bundle-purity` reported "G12 portal bundle graph is clean (1 entry, static and dynamic imports checked)", rc=0.
- **Edge case, non-blocking:** if portal code ever ran `lib/i18n` on a `/agent/projects/*/work` path, `loaders.default[locale]` would be `undefined`. The call would throw, and both the backend and `ensureAllNamespaces` already fall back to the full catalog. The result is a degraded load path, not a leak.

## 4. i18n fallback and error paths

- **Retry and fallback only use the app's own chunks.** The order is `rest` group, one retry, then `loadLocaleResources(locale)`. All three are same-origin dynamic imports of build output. `locale` is restricted to supported locales by `resolveLocale` and `isSupportedLocale`.
- **Failed fetches are not cached.** Failed promises are evicted from `groupResources`, `localeResources` and `allNamespaces`, so a later attempt reaches the network again.
- **When everything fails:** `__root.tsx` `beforeLoad` rejects and the existing `ErrorDisplay` renders. That component shows `t(parsedError.message)` as a React text node, which React escapes. The repository has no `dangerouslySetInnerHTML` in `apps/web/src`. At worst the message is a browser chunk-load error naming a same-origin asset URL, which is not sensitive. `escapeValue: false` predates this PR and is safe because React escapes the text.
- **Create-dialog load failure:** this shows two fixed catalog strings and a reload button. It renders no error content.
- **Cross-origin:** the preload `<link rel="modulepreload" crossOrigin="anonymous">` tags point only at root-relative `/assets/...` paths, so no catalog content is sent or exposed cross-origin. The board preload script is gated by a pathname regex and only appends link tags.
- **CSP (non-blocking note):** the agent HTML now carries two inline `<script>` blocks; the first predates this PR. No application CSP that restricts `script-src` exists today, as the Traefik note and an app grep confirm. If a hash- or nonce-based CSP is added later, both inline scripts must be covered. This PR adds no new class of risk here.

## 5. Secrets

`gitleaks git --log-opts="6015f016..d4a17d64" --redact` (gitleaks 8.30.1) scanned 6 commits, about 50.8 KB, and found **no leaks**.

## 6. Commands run (all at the exact head)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | ok |
| `pnpm turbo build --filter=@taskdesk/web... --force` | 5/5 tasks ok |
| `pnpm build` in `apps/web` (second clean build) | rc=0; SHA-256 manifest of `dist/` identical to the first build (1,586 files) |
| `pnpm check:bundle-size` | rc=0. Agent initial 231.6 KB of a 350 KB budget. Work-list route graph 276.1 KB of 350 KB. Portal 164.4 KB of 200 KB. |
| `pnpm check:bundle-purity` | rc=0, G12 portal graph clean |
| `pnpm check:i18n` | all locales in sync with en-US |
| `npx vitest run` in `apps/web` | **181 files, 975 tests passed** |
| `npx playwright test e2e/work-list-i18n-deferred.spec.ts` | **6/6 passed**: held-deferred work list, open item, triage, calendars, fallback-on-fail, error-on-double-fail |
| `gitleaks git` (PR range) | no leaks |

## Findings

**Blocking:** none.

**Non-blocking:**

1. **Future CSP.** The agent `index.html` now carries two inline scripts. A future `script-src` CSP must hash or nonce both. This is informational only; no CSP exists today.
2. **Portal edge case.** The portal ships two empty loader-table chunks. They are harmless and any misuse degrades to the full-catalog fallback. Purity remains clean.
3. **The first-paint guard is regex-based** (`referencedNamespaces`). A namespace built dynamically, such as ``t(`${ns}:key`)``, would not be detected. The impact is cosmetic: raw keys could appear briefly. This is not a security issue, and the e2e raw-key specs act as a backstop.

## Residual risk / not checked

- I did not run the full G11 performance bench (`playwright.perf.config.ts`) or the calibration flow. Their files are unchanged, and this PR is headroom only under the #711 owner decision.
- I did not run the full e2e suite. I ran the new spec only.
- I built no Docker image and did no UAT deploy.
- I did not review the API, auth or migration surfaces, because the PR touches none of them.

**Verdict:** CLEAR
<!-- END REPORT (sha256 55a167c1d85a4d41e81ec7eb6320f6797ac56f7220405eaa641380c040b3ad78) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/739-867e-ordinary-delta-b-sonnet.md; Claude Sonnet 5.5; sha256 d0c6c2688b8d8ee4842298a3de981dec8de1fd7592278fc55be9a31b3f628953) -->
# #739 exact-head delta review B (d4a17d64 to 867ed4f4)

**Reviewed head:** 867ed4f43fd8f8fdfeaf8e531fc29fb90853c295
**Previously approved:** d4a17d64e58d142ffdcdce12947fc527667d729b
**Model:** Claude Sonnet 5.5, fresh context. Scratch worktree, removed afterwards. No Docker. Main checkout untouched.

## Scope check
`git diff d4a17d64 867ed4f4 -- scripts .github` is empty: no gate machinery changed. Real changes: two placeholder files `lib/i18n/group-loaders-{slim,rest}.ts`, `index.ts` imports them, `vite-env.d.ts` virtual declarations removed, `vite.config.ts` locates the slim loader chunk by the placeholder path, and the plugin's `load()` replaces the placeholders. The rest is merged main (#730, API/docs) and review notes.

## Placeholder safety
- Plugin not applied: I removed `i18nNamespaceGroups(...)` from `vite.config.ts` and built the agent. The build fails loudly ("G11 work-route preload could not resolve locale assets"), because no `slim-<locale>` modules exist. So an unplugged build cannot ship.
- A tool that imports the placeholder directly gets `{}`. In group mode a lookup `loaders.default[locale]()` then throws a TypeError, which rejects the load (deferred group falls back to the full catalog; the first-paint group would fail loudly rather than silently render). It never silently succeeds with empty data. Group mode only happens in the browser on /work, so this only matters if someone bypasses the build. Non-blocking.
- Portal gets `export default {}` via `groupedEntry: false`, with 0 `slim-*`/`rest-*` chunks in `dist/portal`.

## Chunk output and determinism
- Two direct builds of this head are byte-identical (same file-list and content hash, agent and portal).
- Versus d4a17d64: the chunk set is the same, apart from the two loader chunks renamed `loaders-*` to `group-loaders-*` with identical content hashes, and the content-hash cascade through the entry's import path. Work-list route graph is unchanged: 276.1 KB gzip, 13 assets; agent initial 231.6 KB (+0.1); portal 164.4 KB.

## First-paint guard (mutation)
Added `"settings:title.x"` to `work-item-list.tsx`: build exit 1, "work-item-list.tsx -> settings". Restored.

## Hosted `static` steps and others, locally on a clean install
`lint:ci`, `typecheck` (whole repo via turbo), `check:tokens`, `check:i18n`, `check:deps`, `check:dockerfile-deps`, `check:ui`, `check:ui:raw-elements`: all exit 0. `check:deps` passes now. `check:bundle-purity`: clean (1 entry). `check:bundle-size`: passes (above).
Also: web vitest 181 files / 975 tests passed; `test:a11y` ui 154 passed, web 8 passed; e2e `work-list-i18n-deferred.spec.ts` 6 passed.

## Findings
No blocking findings. Non-blocking: as above, direct import of the placeholder in a non-Vite tool yields an empty table and a TypeError rather than the full catalog for the first-paint group.

## Verdict
**APPROVE (ordinary delta review B) at 867ed4f43fd8f8fdfeaf8e531fc29fb90853c295.**
<!-- END REPORT (sha256 d0c6c2688b8d8ee4842298a3de981dec8de1fd7592278fc55be9a31b3f628953) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/739-867e-security-delta-opus.md; Claude Opus 5.5; sha256 a55675018580b47f311d658c27c734fb69ed0e684047e5820ed09264dac26ff9) -->
# PR #739 — exact-head security delta (round 4)

- **Reviewed head:** 867ed4f43fd8f8fdfeaf8e531fc29fb90853c295
- **Previous clear:** d4a17d64e58d142ffdcdce12947fc527667d729b (`739-security-opus.md`)
- **Delta commits (first parent):**
  - 5afcfd66 docs(security-reviews): record #739 review chain
  - f88c77ca Merge origin/main (6389d6e7, #730)
  - 867ed4f4 fix(web): resolve the i18n group loaders through real files
- **Model / context:** Claude Opus 5.5 (claude-opus-5-5). This is an independent context; it did not author, direct or remediate this PR.
- **Head verification:** `gh pr view 739 --json headRefOid` returned 867ed4f43fd8f8fdfeaf8e531fc29fb90853c295.
- **Workspace:** a detached scratch worktree at the exact head. It was removed afterwards. The main checkout was not touched and no Docker was used.

## Checks

1. **`scripts/` and `.github/` are unchanged.**
   - `git diff --stat d4a17d64 867ed4f4 -- scripts .github package.json apps/web/package.json pnpm-lock.yaml apps/web/vitest.config.ts` is empty.
   - `git diff --stat 6389d6e7 867ed4f4 -- scripts .github` is also empty.
   - `check:deps` (`scripts/ci/check-deps.mjs`) and its tests are untouched.
   - The fix makes the import satisfy `check:deps` by pointing it at a real file. It does not add an exemption or allowlist. `check:deps` reported rc=0: "9 workspace packages/apps and 1595 source files; runtime workspace graph is acyclic and package boundaries hold".

2. **Content replacement in the plugin (`vite/i18n-namespace-groups.ts`) cannot inject code.**
   - The new branch in `load()` matches only ids matching `/src/lib/i18n/group-loaders-(slim|rest)\.ts$`, after stripping `?` queries and normalising backslashes.
   - The `slim` or `rest` group comes from the regex capture, not from file content. The placeholder's own source is never read or echoed.
   - The output is a fixed template. It lists `JSON.stringify(locale)`, where the locale comes from `listLocales(i18nDir)`: repo `i18n/*.json` filenames filtered by `^[A-Za-z]{2,3}-[A-Za-z]{2,4}\.json$` and sorted. Each entry maps to `() => import(JSON.stringify("virtual:taskdesk-i18n/<group>-<locale>"))`.
   - Portal builds (`groupedEntry: false`) return `export default {}`.
   - The emitted chunks were inspected. The agent tables reference only the `slim-*` / `rest-*` locale chunks. Both portal tables are `{}`.
   - The plugin has no network access, no eval and no environment input.
   - The placeholders in `src/lib/i18n/` are inert typed `{}` defaults. If the plugin were ever absent, the lookup `loaders[locale]` would throw, and the existing retry and full-catalog fallback would handle it. That is not unsafe.

3. **Determinism.** Two clean `pnpm build` runs (agent and portal) produced 1,590 files each. Their SHA-256 manifests are identical; the manifest digest is `9d041c849fb29f836692d4090db6cc55973e635be77460a6b29fa74f87173ac0`.

4. **Portal purity.**
   - `check:bundle-purity` rc=0: "G12 portal bundle graph is clean".
   - The portal has 0 `slim-`/`rest-` chunks, and its two loader tables are empty. The agent has 38 such chunks.

5. **The merge of main is pure.** `git merge-tree --write-tree 5afcfd66 6389d6e7` produces tree `b4b459b5…`, which is identical to the tree of merge commit f88c77ca. The merge therefore has no manual conflict edits. The only PR-side changes after it are the 7 files in 867ed4f4. 5afcfd66 changes one review-record doc.

6. **Secrets.** gitleaks 8.30.1 found no leaks on `d4a17d64..867ed4f4` (about 215 KB). It also found none on `6389d6e7..867ed4f4`.

## Commands and results (exact head)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile`, then `pnpm turbo build --filter=@taskdesk/web... --force` | 5/5 tasks OK |
| `pnpm build` (second clean build) | rc=0; output identical to the first build |
| `pnpm check:deps` | rc=0 |
| `pnpm check:bundle-size` | rc=0. Work-list route graph 276.1 / 350 KB, portal 164.4 / 200 KB. These match the d4a17d64 figures. |
| `pnpm check:bundle-purity` | rc=0 |
| `pnpm check:i18n` | rc=0 |
| `npx vitest run` (apps/web) | 181 files, 975 tests passed |
| `npx playwright test e2e/work-list-i18n-deferred.spec.ts` | 6/6 passed |
| gitleaks on the delta | no leaks |

## Findings

**Blocking:** none.

**Non-blocking:**

1. `check:deps` analyses source only. It sees the placeholder `{}`, not the generated `import("virtual:taskdesk-i18n/...")` edges. The hidden edges reach only build-internal JSON catalog modules generated from repo files, so no package boundary is bypassed. This is noted for awareness, not as a gate gap.
2. The older `virtual:taskdesk-i18n/loaders-*` branch in `load()` is now dead code. It is harmless and could be removed in a later cleanup.

## Residual risk

- I did not run the G11 perf bench, the full e2e suite or the Docker/UAT deploy.
- I did not review the main-side #730 API content; that PR is reviewed under its own gates. I verified only that the merge introduced no edits beyond an automatic merge.

**Verdict:** CLEAR
<!-- END REPORT (sha256 a55675018580b47f311d658c27c734fb69ed0e684047e5820ed09264dac26ff9) -->
