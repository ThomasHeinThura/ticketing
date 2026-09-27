# PR #419 — check-deps vacuous-pass fix (issue #414)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (direct analysis — implementing lane
is Sonnet per this project's standing convention; reviewed together with sibling PR #417
since both touch the same root-resolution area)
**Session:** subagent `a7381120a5e7cf93e`

**Verdict: APPROVE** as a standalone fix. Confirmed the `looksLikeThisCheckout` marker
approach is directionally sound; traced `resolveRepoRoot()` and confirmed the pre-existing
#399 "genuinely not inside any git work tree" fallback is unchanged, with the new marker
check only added on the successful-resolution path. Confirmed the new probe exercises the
real `check-deps.mjs` binary end-to-end, asserting both the rejection and the
still-passes-for-a-real-worktree cases. Confirmed this PR's own two `installCheckers()`
additions to `repo-root-cwd.test.mjs` were the right instinct, and independently re-checked
every other successful-resolution call site in that file for a third unpatched spot — found
none.

## Security review

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a2479726293664064` (pass 1, joint with #417), `a9bcbcb0290dfbe90` (narrow follow-up)

**Reviewed head:** `c2b54039dd936068a25bdf373f5d5dc486aaf1c2`

**Pass 1 (head `5f797e2`): BLOCKING.** The `repo.mjs` fix itself (the `looksLikeThisCheckout`
marker check) was confirmed correct — runs only after `git rev-parse` succeeds, the
outside-any-work-tree fallback is unchanged, the marker approach is accepted as adequate
for this class of internal tooling (existence-only check, not content-verified — judged
acceptable since this guards against wrong-directory invocation, not an adversary). But
this PR's own new test file, `check-deps-vacuous-pass.test.mjs`, crashed with `EEXIST` at
this head: its `scriptCheckout()` helper called `symlinkSync()` to link `node_modules` in,
but `installCheckers()` (in `scratch-repo.mjs`) has done that same symlink itself since an
unrelated PR #342 merged into `main` and reached this branch via a routine branch-update
merge — a duplicate-symlink collision, not a design problem with the fix itself.

**Fix (commit `c2b5403`):** removed the now-redundant `symlinkSync()` call and its unused
imports (`symlinkSync`, `repoRoot`) from `scriptCheckout()`, updated the doc comment to
reflect that `installCheckers()` now does this itself.

**Follow-up pass (head `c2b5403`): CLEAR.** Confirmed the fix matches the prescribed
change exactly (3 lines added, 12 removed, one file). Confirmed the target test file now
passes (2/2). Confirmed the fuller gate-checker suite has no new failures — the only 3
remaining are the pre-existing, already-disclosed `typecheck-coverage.test.mjs` local
environment gap (missing `apps/api/node_modules/.bin/tsc` in this worktree), unrelated to
this PR. Confirmed `scripts/ci/lib/repo.mjs` itself is untouched by this commit (`git diff`
between the two heads on that file is empty) — the original F1/F2 fix from pass 1 is
unaffected.

Clear to merge.
