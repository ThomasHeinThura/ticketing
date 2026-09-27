# Pre-merge security review — PR #394 (remaining UI primitive moves into packages/ui, check:tokens, #9)

**Reviewed head:** `07dbd984dd0624a5a5b8b08f3d12df1214a55458`

**Verdict: CLEAR.** No HIGH, no MEDIUM. One LOW (a wording error in companion PR #395's
decision-log entry, not in this PR — since fixed) and three informational notes, none blocking.

**Status of the gate:** this review ran **before** merge and is complete. It closes the
mandatory independent Opus security review for the head named above, **and for that head
only.** A later commit touching anything outside `docs/07-planning/security-reviews/` voids
it and requires a fresh delta review. No waiver was sought or used; none is authorized.

**Reviewer independence.** Claude Opus 5.5 (`claude-opus-5-5[1m]`), a fresh, review-only
context that authored and directed no part of the change, and made no edit, commit, push or
PR comment. Work was done in a detached worktree at the reviewed head; `git status
--porcelain` was empty at finish. Base: `origin/main` `8c0f9cf39ec82cdf2016d65fe70eb52b1c2a117d`
(commits `90b8c84`, `07dbd98`).

**Why this is in security scope.** It edits the dependency graph (`pnpm-lock.yaml`,
`packages/ui/package.json`) and CI gate machinery (`scripts/ci/check-deps.mjs`, new
`scripts/ci/check-tokens.mjs`, `scripts/ci/test-all.mjs`, `.github/workflows/ci-fast.yml`).

---

## What was established, by measurement

| Claim | Evidence |
| --- | --- |
| **No new supply-chain surface** | Lockfile diff is +9/-0, entirely inside the `packages/ui` importer block. `input-otp@1.4.2`, `react-day-picker@10.0.1` and `react-hook-form@7.84.0` resolve to exactly the entries already present on `main` for `apps/web`; no package entry, integrity hash or snapshot changed. Specifiers match `apps/web/package.json` exactly. `react-day-picker`'s transitives (`@date-fns/tz@1.4.1`, `date-fns@4.4.0`) were already locked; the other two only peer on react/react-dom. All three are the genuine, widely-used upstream libraries, not typosquats. `pnpm install --frozen-lockfile` passes |
| **They are runtime `dependencies`, correctly** | Added under `dependencies`, not `devDependencies` — required, since `check:deps` validates `manifest.dependencies` of `@taskdesk/ui` against `UI_RUNTIME_IMPORTS` |
| **Allowlist change is exact-name and load-bearing** | `check-deps.mjs` diff is +8/-0: three string literals added to the existing `Set` plus a comment. Both enforcement sites still use `Set.has()` exact matching; no pattern, prefix or exemption added. Reverting only this file to `main` makes `check:deps` fail exit 1 with exactly 6 problems (3 manifest deps, 3 imports in `calendar.tsx`/`form.tsx`/`input-otp.tsx`); restoring it → exit 0 |
| **`check:tokens` is narrow and read-only** | Reads files only — no network, subprocess, env/secret access, or writes. Uses the existing `walk()` (skips symlinks and `node_modules`/`dist`/etc.), scans only `apps/web/src` and `packages/ui`, excludes `packages/ui/src/styles/` and two exact data-file paths. Fails via `finish()` → `process.exitCode = 1`. Mutation-tested against the real tree: restoring `main`'s `apps/web/src/index.css` (`#4c9aff`) → exit 1 naming the literal; emptying `--info` in `theme.css` → fails for both `:root` and `.dark` |
| **Its tests exercise pass and fail** | `check-tokens.test.mjs` uses inline fixtures only: parity pass, missing-in-dark, missing-in-root, empty value, missing blocks, nested `@keyframes`; literal detection positive (quoted hex, bracket hex, `rgb()`, bare CSS hex) and negative (`var()`, issue-number prose, mismatched quotes, CSS comments) |
| **CI wiring is plain** | One `run: pnpm check:tokens` step in `static`, after typecheck. No `if:`, no `continue-on-error`, no new secret, permission or action; workflow stays `contents: read`. `test-all.mjs` manifest entry enabled; "CI matches ci-cd.md" green |
| **UI moves touch nothing auth/permission-adjacent** | Each moved primitive diffed against its `main` original: import-path rewrites, i18n reads → caller-supplied label props, an out-of-range throw guard in `InputOTPSlot`, and `calendar.tsx`'s `useUserPreferencesStore` fallback → caller prop. Web-side edits to auth forms, `verify-otp.tsx`, `create-api-key-dialog`, `invite-team-member-modal` and settings routes are import-only. All 7 day-picker `<Calendar>` call sites pass `weekStartsOn` |
| **Suite at this head** | `pnpm typecheck` 9/9; `pnpm build` 6/6; `node --test 'scripts/ci/**/*.test.mjs'` 620/620 (92 suites); `pnpm check:tokens`, `check:deps`, `check:ui`, `check:i18n`, `lint:ci` pass; `packages/ui` vitest 37 files / 75 tests pass; all GitHub checks green except the PR-template/security-review check awaiting this note |

## Findings

**None blocking.**

- **LOW — companion PR #395 wording (fixed).** Its decision-log entry originally said the three packages are added to `packages/ui` **devDependencies**; this PR adds them to runtime **`dependencies`**. Corrected in the entry before #395 merges. No bundle or supply-chain impact: `apps/web` already ships all three.
- **INFO — `check:tokens` false negatives (design-lint, not security).** Not caught: backtick template literals, uppercase `RGB(`, named colours, `lab()`/`lch()`/`oklab()`/`hwb()`/`color()`, and a `--x:;` (no space) value in both themes at once. Follow-up hardening only.
- **INFO — step ordering.** A `check:tokens` failure skips the later `check:i18n`/`check:deps` steps in `static` for that run; the job still fails, so nothing is bypassed.
- **INFO — test glob.** `node --test scripts/ci/**/*.test.mjs` unquoted in bash without `globstar` runs 491 tests, not 620; quote the glob.

**What the reviewer did not check.** Visual/runtime rendering of the moved primitives in a
browser; upstream tarball contents beyond lockfile identity with `main` (unchanged
integrity makes that pre-existing, not introduced here); `pnpm audit` (the CI supply-chain
audit job is green at this head).

---

## Delta review — 2026-09-27, head `37f60a31ff57e22534e77cd083564217415ecec0`

**Verdict: CLEAR.** No HIGH, MEDIUM or LOW. The delta touches no security surface.

**One-line summary:** `37f60a3` adds only Storybook stories and real axe tests for nine
primitives, and the two `main` merges in between change none of this PR's own content.

**Reviewer.** Claude Opus 5.5 (`claude-opus-5-5[1m]`), the same review-only context
role as the first pass. It authored and directed no part of the change. Checks ran in a
detached worktree at the exact head. The only edit is this section.

**What sits between the reviewed `07dbd98` and this head:**

| Commit | What it is | Evidence |
| --- | --- | --- |
| `3d2df42` | This note (first pass) | Docs only, inside `security-reviews/` |
| `e71fc35`, `984bc96` | Merges of `main` into the branch | `git show --remerge-diff` is empty for both, so there was no hand conflict resolution. `git diff f1819ca 984bc96` (excluding this note) matches `git diff 42b2e8b 07dbd98` byte for byte, ignoring `index` lines. So the PR's own diff against `main` is the same as the one already reviewed. (The first pass named `8c0f9cf` as the base. The real merge-base of `07dbd98` was `42b2e8b`. The reviewed diff itself was correct.) |
| `37f60a3` | `test(ui): make primitive axe coverage reliable` | 18 files, +621/-5, every one a `packages/ui/src/components/*.stories.tsx` or `*.test.tsx`. No component source, `package.json`, lockfile, CI script or workflow changed |

**What was established:**

- **Test/story-only, confirmed.** `git show 37f60a3 --name-only` filtered for anything that is
  not `*.stories.tsx` or `*.test.tsx` returns nothing.
- **The axe tests are real.** All nine files call the shared `expectNoA11yViolations(baseElement)`
  from `src/test/a11y.ts`. That helper runs `vitest-axe` and asserts `results.violations`
  equals `[]`, with only the `region` rule disabled, which the first pass already reviewed.
  Several tests also check roles, names or `aria-current` directly. Red probe: removing
  `aria-label` from the InputOTP axe test makes it fail on the `label` rule. Reverted after.
- **The InputOTP timer wait is safe.** `waitForInputOtpSelectionTimers()` waits for the
  library's three deferred `input` events, then removes its listener. It only makes the tests
  deterministic and hides no failure. The `waitFor` default timeout still fails a hang.
- **Stories add no surface.** They import only sibling components, `@storybook/react-vite` and
  the existing `react-hook-form` dependency. They contain no `dangerouslySetInnerHTML`, no
  URL, no `fetch` and no storage access.
- **Suite:** the nine touched test files pass, 9 files / 22 tests, on two runs back to back.
  At this head every GitHub check is green except the PR-template/security-review check,
  which is waiting for this section.

**Not checked in the delta:** browser rendering of the new stories, and a full-workspace
local re-run. CI `unit + component`, `static` and `build` are green at this exact head.
