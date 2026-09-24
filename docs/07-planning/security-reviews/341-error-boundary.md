# Security review — PR #341 (error-boundary extraction, stacked on #335)

**Status: PENDING — OPUS CAPACITY. No security review has been performed. This note is a blocker record, not a clearance.**

**Required reviewer:** independent Opus 5.5.
**Candidate head awaiting review:** `742ab6330e6a4bed906866499a4b2cbb6b1dec27` (candidate identity only; not a reviewed-head attestation).

## Scope awaiting review

The PR's direct error-boundary changes do not alter authentication, authorization, permissions,
migrations, or route policy. This PR is stacked on #335, whose Storybook compatibility change
adds `@storybook/react-vite`/Storybook tooling to `packages/ui/package.json` and `pnpm-lock.yaml`;
the full candidate diff therefore touches the dependency graph and requires the security review.
The Opus pass must review the exact candidate diff and its dependency changes, then record its
actual verdict, findings, checks and full reviewed-head SHA here.

No review evidence or clearance is claimed. `claude auth status` reported `loggedIn: false`
during the 2026-09-23 continuation, and no independent Opus reviewer was callable.

---

## Opus 5.5 independent review — 2026-09-24

This section supersedes the PENDING status above. The candidate reviewed is the current PR head,
not `742ab63`.

**Reviewed head:** `7690763aac401edcdaf80e6335ec37eea84f5a1c`

**Reviewer:** Claude Opus 5.5, fresh context, did not author or direct this change.
**Base compared:** `origin/main` at `8f545c3c1ae8ee3d5ac9b22d830ff52ab1fce918` (the head is a
merge of `f433900` with that commit; no PR-owned code path changed between `f433900` and the head).

**Verdict: CLEAR WITH FINDINGS.** No finding blocks merge. F1 is a small robustness regression,
worth a one-line follow-up.

### Security scope

- Against current `main`, the diff touches no path in `ci-cd.md`'s security-review lists. There is
  no `package.json`, lockfile, `pnpm-workspace.yaml`, `.github/**`, `scripts/ci/**`, or vitest
  config change. The Storybook dependency additions this note was originally waiting on came
  from #335, which is now on `main` with its own Opus attestation. The CI template gate agrees:
  "no security-review path touched".
- `biome.json` adds one line: `"!**/storybook-static"` to `files.includes`. That folder is the
  Storybook build output and is already in `.gitignore`. No lint rule is disabled or downgraded,
  and no source path, `scripts/ci`, or test path is excluded. It does not weaken any gate.
- No new dependency.

### Information leakage

- `apps/web/src/main.tsx` uses `RootCrashFallback`, which ignores `error` and renders only
  translated strings. No message, stack, or response body reaches the user.
- The `AppErrorBoundary` default fallback is `ErrorDisplay`. It runs `parseApiError`, which
  maps every error to a fixed i18n key (it never renders `error.message`), so it is safe too.
  Nothing uses that default today.
- The primitive renders nothing itself; the fallback decides. The story and test fallbacks
  render `error.message`, but they are dev and test only.
- `componentDidCatch` sends `console.error(error, errorInfo)` to the browser console only.
  That is the same as the deleted `apps/web` boundary. There is no remote sink.
- No `dangerouslySetInnerHTML` in the diff.

### Behaviour

- Redirects are unaffected. TanStack Router handles `redirect()` and `notFound()` inside
  `RouterProvider`, and `__root.tsx`'s `errorComponent` catches loader and `beforeLoad` throws
  first. The root wrapper is a rename of the existing boundary at the same tree position. The CI
  job `e2e - protected-route redirect` is green at this head.
- Reset does not loop. `resetError` runs only when the user clicks. If the children throw again,
  the boundary catches it again and shows the fallback again.
- Falsy throws (`undefined`, `null`, `0`, `""`), strings and symbols are normalized and render
  the fallback. Tests cover the falsy cases.

### Findings

- **F1 (low, robustness, not security): some thrown objects escape the boundary.**
  `normalizeError` calls `String(error)` inside `getDerivedStateFromError`. That call throws for
  an object whose `toString` throws, and for `Object.create(null)` ("Cannot convert object to
  primitive value"). The error then escapes the boundary, and at the root the user gets a blank
  page instead of the fallback. The deleted `apps/web` boundary stored the raw value and its
  fallbacks never stringified it, so this is a small regression for these odd values.
  Reproduced with a temporary probe test (not committed): the hostile-`toString` and null-prototype
  cases escaped; the string and symbol cases rendered. Suggested fix: wrap the `String()` call in
  a try/catch that falls back to `new Error("Unknown rendering error")`, and add both cases to
  the `it.each` list.
- **F2 (informational, pre-existing, not introduced here):** `RootCrashFallback`'s button is
  labelled `common:error.refreshPage` but calls `resetError`, which re-renders; it does not
  reload the page.
- **F3 (process): the `status.md` edit is inaccurate or stale.** (a) It says "#341 is being
  refreshed" against `8f545c3`; that is done at this head. (b) It says CI is green "except the
  Opus-bound PR-template gate". The template gate actually fails because the PR body's
  `## Checklists` has no independent-review checkbox. It does not fail for a missing Opus
  attestation, and the gate itself reports no security-review path touched. (c) `status.md` is
  orchestrator-owned (CLAUDE.md, "The control plane"), and the lane entry sits above the dated
  orchestrator snapshot header. The orchestrator should reconcile this.

### Checks run at this head (local worktree)

- `pnpm --filter @taskdesk/ui test`: 31 files, 61 tests, all passed.
- `pnpm --filter @taskdesk/web test`: 62 files, 277 tests, all passed. This was after building
  workspace deps; a fresh worktree without built `@taskdesk/permissions` fails to resolve it,
  which is an environment issue.
- `pnpm exec biome ci .`: 1316 files, 0 errors, 78 warnings. No fixes applied.
- Typecheck for `@taskdesk/ui` and `@taskdesk/web`: exit 0.
- GitHub checks at this head: every required check is green except
  `pull request template + security review`, which fails on the missing checklist checkbox (F3b).
  a11y, visual regression and performance budget jobs are skipped as NOT ENABLED.
