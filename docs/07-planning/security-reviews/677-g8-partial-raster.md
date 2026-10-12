# PR #677 security review record: deterministic G8 screenshots

PR #677 adds `--disable-partial-raster` to the G8 route-screenshot Playwright config (`apps/web/playwright.visual.config.ts`). It extends the G8 scope guard (`scripts/ci/check-visual-scope.mjs`) to pin exactly that one launch option, and it regenerates the one affected baseline on main (`account-security-setup-linux.png`). The guard is CI gate machinery, which makes this PR security-scope.

Root cause, from private evidence `g8-input-flake-diagnosis-sonnet/`: Chromium's partial raster re-blends the anti-aliased corner pixels of translucent rounded borders, so captures of an unchanged page alternate between two renderings. The fix was implemented by a Claude Sonnet 5.5 context. The two reviewers below are fresh, independent contexts that did not author, direct or diagnose the change.

## Review chain

- Ordinary review by Claude Sonnet 5.5: APPROVE at `347e085b`.
- Security review by Claude Opus 5.5: CLEAR at `347e085b`. It ran 36 guard-bypass variants; 31 were rejected, and the 5 accepted ones behave exactly like the approved config.

**Reviewed head:** `347e085b8ac53178b2b895dadc580bfde670f770`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `677-ordinary-sonnet.md` | Ordinary review (d86d3089..347e085b) | Claude Sonnet 5.5 | `347e085b` | APPROVE | `dc9213023a34754c3481c9bd3f895bbc9a79d12b433b76a93dee7818f99afa45` |
| 2 | `677-security-opus.md` | Security review (d86d3089..347e085b) | Claude Opus 5.5 | `347e085b` | CLEAR | `b11eb0537a21630b5e0dd0c47692b801a28ed5398b42d015ebbe0552d3f92fe5` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/677-ordinary-sonnet.md; Claude Sonnet 5.5; sha256 dc9213023a34754c3481c9bd3f895bbc9a79d12b433b76a93dee7818f99afa45) -->
# PR #677 ordinary review

Reviewer model: Claude Sonnet (fresh independent ordinary-review context)
Reviewed head: 347e085b8ac53178b2b895dadc580bfde670f770
Base: origin/main merge-base d86d3089636c1ade443a20b04e1212e4a72f42d1 (2 commits: 8924c7f2, 347e085b)

## Files examined
- apps/web/playwright.visual.config.ts (diff)
- scripts/ci/check-visual-scope.mjs (diff; hasExactObjectKeys 287-312, stringArrayProperty 372, hasExpectedUse 385, new hasExpectedVisualLaunchOptions ~423, call site ~3115, top-level key allowlist ~3079)
- scripts/ci/check-visual-scope.test.mjs (7 new tests)
- apps/web/e2e/visual.spec.ts-snapshots/account-security-setup-linux.png (opened)
- evidence: g8-input-flake-diagnosis-sonnet/notes.md + exit files/logs; g8-partial-raster-main-sonnet/pr-body.md + logs
- grep for other consumers of playwright.visual.config / partial raster (.github, docs): none besides the guard

## Commands
- Worktree had no node_modules, so I ran from a `git archive HEAD` copy in $TMPDIR with node_modules symlinked to the main checkout (worktree untouched).
- `node --test scripts/ci/check-visual-scope.test.mjs`: tests 161, pass 161, fail 0. All 7 new tests pass.
- `node scripts/ci/check-visual-scope.mjs` (= pnpm check:visual-scope): "G8 scope check passed: 7 screenshot cases, 6 active inventory route rows mapped (123 route rows total)", rc 0.
- `git diff --stat origin/main...HEAD`: 4 files (config, guard, guard test, one PNG). No Storybook files touched.

## Evidence assessment
Supports the claim.
- Diagnosis lane: two consecutive unchanged-page screenshots differ in ~30% of loads without Playwright options; computed styles/animations identical; CSS/font/timing variants and other GPU flags did not help; `--disable-partial-raster` gave 60/60 identical shots; forcing a full repaint gives the same pristine state. A single-flag differential, not just a plausible story.
- Main lane: against the old baseline with the flag, 1 failure (account-security, expected since old baseline was captured contaminated); after regenerating it, 3 full runs x 7 cases = 21/21 pass. Diagnosis lane fix-suite10 exit 0.
- Caveat: "100/100" mixes runs on the earlier fix branch and the main lane; the final regenerated main baseline itself was validated by 3 repeats (21/21), not 10. Acceptable given mechanism evidence.

## Config and guard review
- Config: `use: { ...base.use, launchOptions: { args: ["--disable-partial-raster"] } }`. Base `use` is separately pinned key-for-key by hasExpectedUse, so nothing there loosens. No existing pin loosened: "use" added to the allowed top-level keys only together with a mandatory hasExpectedVisualLaunchOptions check.
- Guard: `use` must be exactly {launchOptions} plus one spread at index 0 that is literally `base.use`; launchOptions exactly {args}; args a string-literal array of exactly one element equal to the flag. Duplicate keys, shorthand/computed keys, extra spreads, extra args, extra use keys, non-literal args, missing `use` are all rejected. I found no smuggling route.
- Observation: if a future Chromium dropped the switch it would become a silent no-op; mitigated by the pinned image and by the screenshots themselves.

## Tests (7)
Six parametrised negatives (drop option, second arg, swapped arg, extra launch option, extra use key, drop base spread) plus a remove-entirely case. Each asserts non-zero status and the failure message, and `assert.notEqual(visualConfig, original)` guards against a silently non-matching regex replace (non-vacuous). The positive case is covered by the real config passing check:visual-scope and existing pass tests.

## Baseline
account-security-setup-linux.png opened: dark "Account security" settings screen, "Set up an authenticator factor" card, focused password field, "Set up authenticator" button. Intended screen, no corruption; 47021 -> 47006 bytes consistent with a few AA pixels.

## Other consumers
No workflow, docs/04-engineering/ci-cd.md, or script references the visual config launch options (grep clean). Storybook visual config unchanged (disclosed as not done).

## Findings
Blocking: none.
Non-blocking:
1. New negative tests share one generic failure regex ("must extend the app Playwright config"), so they cannot show which sub-check fired. Low risk; each replacement is distinct.
2. Storybook visual config still on default raster path; follow-up issue advisable.
3. Final baseline validated at 3 repeats (21/21) rather than 10.

## Residual risk
- I did not run Docker/Playwright or CI; the determinism claim rests on the recorded evidence.
- Chromium flag could become a no-op in a future pin; guard cannot detect that.

Verdict: APPROVE
<!-- END REPORT (sha256 dc9213023a34754c3481c9bd3f895bbc9a79d12b433b76a93dee7818f99afa45) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/677-security-opus.md; Claude Opus 5.5; sha256 b11eb0537a21630b5e0dd0c47692b801a28ed5398b42d015ebbe0552d3f92fe5) -->
# PR #677 security review: G8 deterministic screenshots (`--disable-partial-raster`)

- **Reviewer model:** Claude Opus 5.5 (fresh independent security-review context). This context did not author, direct, diagnose or remediate the change.
- **PR:** #677 "fix(ci): make G8 screenshots deterministic by disabling Chromium partial raster"
- **Worktree:** `/Users/heinthura/.codex/worktrees/g8-partial-raster/Ticketing.v2`
- **Candidate head:** `347e085b8ac53178b2b895dadc580bfde670f770`
- **Base (origin/main):** `d86d3089636c1ade443a20b04e1212e4a72f42d1` (this is also the merge base, so the PR is not stale against base)
- **Commits:** `8924c7f2` (config + guard + tests), `347e085b` (baseline regeneration)
- **Mode:** read-only. No edits, commits or pushes in the worktree, and no Docker. All probes ran in a `git archive HEAD` copy under `$TMPDIR/rev677`, with `node_modules` symlinked from the main checkout because the worktree has none.

**Reviewed head:** `347e085b8ac53178b2b895dadc580bfde670f770`

## Surfaces examined

`git diff origin/main...HEAD` touches exactly 4 files:

| File | Change |
| --- | --- |
| `apps/web/playwright.visual.config.ts` | Adds `use: { ...base.use, launchOptions: { args: ["--disable-partial-raster"] } }` (lines 6-13) |
| `scripts/ci/check-visual-scope.mjs` | Adds `hasExpectedVisualLaunchOptions` (lines 423-447). Adds `"use"` to the visual config's exact key set (line 3082). Requires the new predicate (around line 3118). |
| `scripts/ci/check-visual-scope.test.mjs` | Adds 7 red tests (loop at line 554, plus the "removes ... entirely" test) |
| `apps/web/e2e/visual.spec.ts-snapshots/account-security-setup-linux.png` | Regenerated baseline |

- **`.github/**`:** unchanged. `git diff --name-only origin/main...HEAD -- .github` is empty. CI still runs `pnpm test:visual` (`ci-full.yml:181`), and that script runs `check:visual-scope` first.
- **Helpers read in full:** `hasExactObjectKeys`, `objectProperty`, `propertyValues`, `stringArrayProperty`, `hasExpectedUse`, and the base, visual and storybook config blocks in `check-visual-scope.mjs`. Also `hasExpectedConfigStatements` and `hasDefaultImport`, which pin imports and pin `base` to the default import of `./playwright.config`.
- **Evidence notes read:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/g8-input-flake-diagnosis-sonnet/notes.md`.
- **Security path list:** `docs/04-engineering/ci-cd.md`, evaluated through `scripts/ci/lib/security-paths.mjs`.

## Tests and reproductions run

1. **Guard unit suite:** `node --test scripts/ci/check-visual-scope.test.mjs` on the HEAD snapshot gave **161 tests, 161 pass, 0 fail**. This matches the 161/161 in the evidence notes.
2. **Live guard:** `node scripts/ci/check-visual-scope.mjs` on the HEAD snapshot exited 0 with "7 screenshot cases, 6 active inventory route rows mapped (123 route rows total)".
3. **Adversarial bypass probes:** 36 config variants. I applied each one to a copy of the real `playwright.visual.config.ts` and ran it through the test harness's `runVisualScope` with valid routes, so the only possible failure was the visual-config check. Results: **31 rejected, 5 accepted.** All 5 accepted variants are semantically equivalent to the approved config.
   - **Accepted, as expected (5):**
     - the unmodified config (control);
     - `/* deviceScaleFactor: 2 */` and `/* "--x" */` comments inside the objects (the AST ignores comments, so they have no effect);
     - `use` moved after `updateSnapshots` at top level (property order does not change Playwright semantics);
     - `...base?.use` instead of `...base.use`. `ts.isPropertyAccessExpression` also matches the optional-chain node. This has no effect because `base` is the pinned default import and is never nullish.
   - **Rejected (31):**
     - **Extra `use` keys:** `ignoreHTTPSErrors`, `screenshot`, `deviceScaleFactor` (before and after `launchOptions`).
     - **Spread tricks:** the spread moved to the end, a double spread, `...base`, `...{ ...base.use, colorScheme: "dark" }`, `...base["use"]`.
     - **Spreads inside `launchOptions`:** `...base.use?.launchOptions` and `...{ headless: false }`.
     - **Extra `launchOptions` keys:** `ignoreDefaultArgs: true` and `headless: false`.
     - **Args tricks:**
       - an array spread;
       - `.concat`;
       - a template literal;
       - one string carrying two flags (`"--disable-partial-raster --force-device-scale-factor=2"`);
       - an env-conditional ternary on `args`, and another on `launchOptions`.
     - **Type wrappers:** `as any` on `use` or `launchOptions`, `as string[]` on `args`, and a parenthesised `use`.
     - **Key forms:** a string-literal key, a computed key, a getter, a method, and a shorthand `launchOptions`.
     - **Duplicate keys:** duplicate `launchOptions`, duplicate `args`, and a duplicate top-level `use` where the second one wins at runtime.
     - **New top-level keys:** `projects` (with `deviceScaleFactor`) and `expect.toHaveScreenshot.maxDiffPixels`.
4. **Baseline pixel diff:** I compared the old baseline (origin/main) with the new one using PIL.
   - Both are 1280x720 RGB.
   - Exactly **35 pixels differ, each by 1/255 per channel**. All of them sit on the rounded-corner anti-aliasing of the password input (x 349-358 and 1201-1210, y 378-409), plus 1 pixel at (351,450).
   - The new file's sha256 is `8e5e0ac84621759aeaf5d56326cc48ce0dfe729e8c6b7fc05cc04136bda7da91`. This matches the evidence notes' independent double regeneration.
5. **Visual inspection of the baseline:** I opened it. Details are under F4.

## Findings

### F1: The guard allowance is tight; no bypass constructed (non-blocking, positive)

`scripts/ci/check-visual-scope.mjs:429-447` pins the whole `use` object key-for-key:

- the only spread allowed is `base.use`, and only at index 0;
- the only other key allowed is `launchOptions`, which may contain only `args`;
- `args` must be exactly `["--disable-partial-raster"]`.

`hasExactObjectKeys` (line 287) rejects computed keys, string-literal keys, shorthand properties, methods, accessors and duplicates. `objectProperty` and `stringArrayProperty` reject casts, conditionals and non-literal arrays. The top-level key set (line ~3075-3085) stays exact, so no `projects` or `expect` override can be added. Of 36 probes, every one that changed behaviour was rejected.

The guard also requires the flag to be present. Dropping it fails the guard (`check-visual-scope.test.mjs` "removes the partial-raster launch option entirely"), so the determinism fix cannot be silently reverted either.

### F2: `...base?.use` is accepted (non-blocking, cosmetic)

At `scripts/ci/check-visual-scope.mjs:435`, `ts.isPropertyAccessExpression` matches the optional-chain form too, so `...base?.use` passes. It is semantically identical to `...base.use`, because `base` is pinned to the default import of `./playwright.config` by `hasDefaultImport` and `hasExpectedConfigStatements`. This is not a bypass. A future tightening could add `!expression.questionDotToken`, but nothing requires it.

### F3: `--disable-partial-raster` does not reduce G8 sensitivity to app regressions (non-blocking)

Partial raster is a cc/compositor optimisation. When part of a cached tile is invalidated, Chromium re-rasterises only the invalidated rect on top of the tile's previous contents. Disabling it makes Chromium re-rasterise the whole tile from the display list.

The flag does not change:

- the DOM or CSS;
- layout or the display list;
- fonts, colour management or device scale factor;
- GPU or software raster selection.

It only removes path-dependence on what the tile held before. The evidence matches this:

- two consecutive shots of an unchanged page alternated between two states, differing only in translucent anti-aliased corner pixels;
- with the flag, 60 of 60 shots were identical;
- forcing a full repaint reproduced the "pristine" state, which shows the flag yields the from-scratch rendering;
- the baseline delta is 35 pixels of +/-1 at corner anti-aliasing.

Any real regression changes the display list, so a full raster shows it at least as faithfully as a partial one. G8 keeps `maxDiffPixels: 0`, `threshold: 0` and `includeAA: true` in `visual.spec.ts`, so this PR makes no tolerance change.

The only class G8 stops seeing is Chromium's own incremental-raster artifacts. These are not application-controlled and are what made the gate flaky. If anything, removing a source of flakes strengthens the gate, because it lowers the pressure to retry, loosen or regenerate baselines.

### F4: The regenerated baseline holds no secrets (non-blocking)

`account-security-setup-linux.png` shows the "Set up an authenticator factor" step *before* enrollment:

- the fixture identity "Ada Example / ada@example.test";
- a masked password field. The spec fills the fixture value `visual-enrollment-password`, which is not a real credential and is rendered as bullets;
- a "Set up authenticator" button.

There is no QR code, TOTP secret, `otpauth://` URI or backup code. The content is unchanged from main apart from the 35 anti-aliasing pixels.

### F5: The visual config files are not on the security path list (non-blocking, pre-existing, out of scope)

`apps/web/playwright.visual.config.ts` and `playwright.storybook.config.ts` match no glob in `ci-cd.md`. Only `apps/web/playwright.config.ts` is listed. I verified this with `security-paths.mjs`.

A PR touching only the visual config would therefore not be classified as security scope. In practice, the G8 guard pins that file exactly, and any change to the guard (`scripts/ci/**`) is security scope, so a weakening edit would still fail CI unless the guard also changed. This PR is correctly security scope through `scripts/ci/**` and `apps/web/e2e/**`.

Adding `apps/web/playwright.*.config.ts` to the list would be defence in depth. That is a separate control-plane change.

### F6: Evidence-note scope differs from the diff (non-blocking, informational)

The diagnosis notes record two regenerated baselines: account-security-setup and instance-users-directory. This PR contains only account-security-setup. `instance-users-directory` does not exist on `origin/main`; it belongs to #670, which is not yet merged. That is consistent: whichever of #670 and #677 lands second must carry the users-directory baseline regenerated under full raster. The notes record its sha256 as `3bcadc17...`.

## Residual risk / not checked

- I did not run the Playwright visual suite or Docker, so the 10/10 and 30/30 stability figures rest on the cited evidence notes.
- The Chromium semantics in F3 come from reasoning, plus the empirical evidence of a full-repaint state matching the flag state. I did not check them against the Chromium source at the pinned Playwright 1.63 build.
- The Storybook G8 config (`playwright.storybook.config.ts`) does not get the flag. Any partial-raster flake there remains. That is a reliability issue, not a security one.
- The probe set is broad but not exhaustive. Its coverage comes from the guard's structural design: exact AST shape, identifier keys only, and literal-only values.

## Verdict

No blocking findings. The new allowance is the narrowest possible shape, it is required rather than optional, and it is covered by 7 non-vacuous red tests plus 31 additional red probes run in this review. The flag does not lower G8's sensitivity to application regressions. The baseline contains no secrets. No workflow file changed.

Verdict: CLEAR
<!-- END REPORT (sha256 b11eb0537a21630b5e0dd0c47692b801a28ed5398b42d015ebbe0552d3f92fe5) -->
