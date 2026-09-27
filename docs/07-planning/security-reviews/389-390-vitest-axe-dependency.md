# Security review — PRs #389 and #390, `vitest-axe` + `axe-core` dev dependencies (#9)

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5[1m]`; independent context; did not author, direct or remediate either change)
**Date:** 2026-09-27
**Scope:** the dependency-graph part of both PRs — `packages/ui/package.json`, `pnpm-lock.yaml` — plus the shared test files that use the new packages: `packages/ui/src/test/a11y.ts`, `packages/ui/src/test/setup.ts`, and on #390 `packages/ui/src/components/menubar.test.tsx`. Workspace manifests and the lockfile are security-review scope (`ci-cd.md`). The stories and component tests themselves are ordinary-review scope and are not covered here.

## PR #389 — group A (`feat/9-stories-axe-group-a`)

**Reviewed head:** `f6686cac5379fe44aad8536ad6d8c5a39410f61a`

## PR #390 — group B (`feat/9-stories-axe-group-b`)

**Reviewed head:** `c375136c88306b2afff6dc7792758cdc038ee699`

Both branches share the merge base `42b2e8ba5bd8bd0c9f4c7d04a7cd9ccdbb13272c`.

## Review history

### Pass 1 — REQUEST CHANGES (heads `bc7c7989659f219ddbf8697ad8be63ec1b81b4cd` for #389, `5489c89f9ec03bf8c055dc7797d3c44098ecbeb9` for #390)

**Supply chain: clear.**
- Only two new packages: `axe-core@4.13.0` and `vitest-axe@0.1.0`. Both are in `packages/ui` `devDependencies`. The lockfile adds 27 lines, all integrity-pinned. `vitest-axe`'s own dependencies (`aria-query`, `chalk`, `dom-accessibility-api`, `lodash-es`, `redent`) were already in the lockfile.
- `package.json` and `pnpm-lock.yaml` are byte-identical across the two PRs (same blob SHAs: `fb13ec3a…` and `502408e3…`).
- Only test files import the packages. Nothing in the runtime or build output depends on them.

**Blocking finding: F1, `check:deps` false positives.** `a11y.ts` had an ambient `declare module "vitest" { interface Matchers<T> { toHaveNoViolations(): T } }`. `scripts/ci/check-deps.mjs` `resolveWorkspaceTarget` walks the checker symbol's declarations and returns the first one inside a workspace package. So every `import … from "vitest"` in the monorepo was treated as an import of `@taskdesk/ui`. That produced 69 false boundary violations, for example on `packages/permissions`, which is a pure leaf package.

### Pass 2 — CLEAR (the heads above)

The fix commit on each branch touches only test infrastructure: `a11y.ts` and `setup.ts`, plus `menubar.test.tsx` on #390. The work was done in detached worktrees, one per head.

1. **The augmentation is gone.** Neither branch has a `declare module "vitest"`. The only remaining mention of `toHaveNoViolations` is a doc comment explaining the change. `setup.ts` is down to `import "@testing-library/jest-dom/vitest";`. The `vitest-axe/matchers` `expect.extend` registration is removed. `expectNoA11yViolations(root)` keeps its signature and now asserts `expect(results.violations).toEqual([])`.
2. **`check:deps` passes on both heads (Node 24.20.0):**
   - #389: 9 workspaces, 1017 files, boundaries hold, exit 0.
   - #390: 9 workspaces, 1022 files, boundaries hold, exit 0.
   - Control: putting #389's pass-1 `a11y.ts`/`setup.ts` back into the worktree makes it fail again (exit 1, vitest false positives). So the fix is what makes the gate pass.
3. **The test is just as strict as before.** `vitest-axe@0.1.0`'s `toHaveNoViolations` filters `results.violations` by `toolOptions.impactLevels`. Neither call site sets that, so the filter does nothing, and the old matcher passed exactly when `violations.length === 0`. The new `toEqual([])` passes in exactly the same cases, and it also fails if `violations` is missing. Checked by adding a bare `<img src="x.png" />` to real tests:
   - #389 `badge.test.tsx` through `expectNoA11yViolations` failed with `expected [ { id: 'image-alt', … } ] to deeply equal []`.
   - #390 `menubar.test.tsx`, which calls `axe()` directly, failed the same way.
   - Both edits were then reverted, and the worktrees were confirmed clean.
4. **The dependency graph is unchanged since pass 1.** `git diff` from each pass-1 head to its pass-2 head touches no `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml`. Against the merge base, each PR's only JSON/YAML changes are `packages/ui/package.json` and `pnpm-lock.yaml`, and they are identical to what pass 1 cleared.
5. **The two branches still match each other.** `a11y.ts` (`bf3ce6c6…`), `setup.ts` (`f149f27a…`), `package.json` and `pnpm-lock.yaml` have the same blob SHAs on both heads.
6. **Suites (`pnpm install --frozen-lockfile` first):**

   | Check | #389 | #390 |
   | --- | --- | --- |
   | `pnpm --filter @taskdesk/ui typecheck` | exit 0 | exit 0 |
   | `… test` | 35 files, 83 tests, all pass | 40 files, 86 tests, all pass |
   | `… lint` (Biome) | 108 files, no fixes | 113 files, no fixes |
   | `… build-storybook` | built | built |

## Follow-up, not blocking: the misattribution bug in `check-deps.mjs` is still there

These PRs removed the trigger, not the bug. `resolveWorkspaceTarget` still attributes a bare third-party import to whichever workspace holds the first matching declaration. That includes an ambient `declare module "<pkg>"` augmentation, which is a normal TypeScript pattern: `packages/domain/src/audit/node-crypto.d.ts` already has one for `node:crypto` on `main`.

The case seen here failed closed: it produced false positives. But the same logic can also send a real edge to the wrong workspace, and that is the kind of gate-accuracy weakness #352/#361 dealt with. **This is tracked as issue #393.** Suggested fix: skip `ModuleDeclaration` (augmentation) declarations when resolving, or use the resolved module's source file. Add a regression fixture where one workspace augments a third-party module that another workspace imports. `scripts/ci/**` is security-review scope, so that fix needs its own Opus pass.

## Merge-order note

Both PRs are behind `main` by 5 commits. None of those commits touches `packages/ui`, the lockfile or `check-deps.mjs`. Both PRs add identical files, so whichever merges second has to be brought up to date. Any update-branch or rebase changes the head SHA. Under `security-review-note.mjs` rule 3, a merge commit that touches non-note paths is not covered by the attestations above, so a new head needs a delta confirmation and a new `**Reviewed head:**` line.

## Verdict

- **#389: CLEAR** at `f6686cac5379fe44aad8536ad6d8c5a39410f61a` — merged to `main` at `4fbb036f8cfba1175b9fa02a46b5f40062044ca4` (docs-only lightweight re-confirmation on top).
- **#390: CLEAR** at `c375136c88306b2afff6dc7792758cdc038ee699`

---

## Lightweight re-confirmation after branch update, #389 only (2026-09-27)

**Reviewed head:** `70ae2ff40af19c7f50e47999fb5cb8f68e695aa4`
**Previously reviewed head:** `f6686cac5379fe44aad8536ad6d8c5a39410f61a`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged.

- `git show --remerge-diff 70ae2ff` is empty — clean automatic merge.
- Brings in 9 merged PRs' worth of unrelated `main` history (#383, #388, and their own docs/decision-log entries), zero overlap with `packages/ui/**` or the dependency-graph files this review covers.

---

## Merge confirmation: #389 landed on main, #390's own merge is clean (2026-09-27)

**Reviewed head:** post-merge, pending exact SHA
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged.

#389 merged to `main` at `4fbb036f8cfba1175b9fa02a46b5f40062044ca4`. #390's merge of `main` into its own branch produced exactly one conflict: this note file itself (both branches independently appended their own re-confirmation sections after the shared "Verdict" section) — resolved by keeping both sections, no content dropped or altered. `packages/ui/package.json`, `pnpm-lock.yaml`, `a11y.ts`, and `setup.ts` merged with zero conflict, since #389's merged version is byte-identical to what #390 already had (both PRs carried the same reconciled content throughout). No security-relevant content changed by this merge.
