# 616 — round 7: independent reviews of the rebased, hardened candidate (Claude Sonnet 5.5 ×2, Claude Opus 5.5)

**Reviewed head:** `1deb52320e8f1126a99d861d8dd2e9d812150f99`

- **Candidate:** #616 rebased onto `main` `26c43def` (after #602 and #615), plus hardening commit `1deb5232`. Pre-rebase head `92660ed7` is kept at branch `claude/policy-enforcement-20261009-reviewed`; the previously reviewed content head was `c3685d9d`.
- **Reviewer contexts:** two fresh Claude Sonnet 5.5 Agent-tool contexts (ordinary: correctness; test adequacy) and the Claude Opus 5.5 security context that reviewed rounds 4–6. None authored, directed or remediated the change. Each report's model is the one its transcript records for every turn of this round.
- **Transport:** each report is the reviewer's final message, extracted mechanically from its subagent transcript and inserted unmodified between the markers, with its SHA-256. A hash identifies bytes; it does not prove independence or approval.

<!-- BEGIN REPORT 1 (agent a0356f00e56d80dce; model claude-sonnet-5-5; role ordinary review A (correctness), rebased delta; candidate 1deb52320e8f1126a99d861d8dd2e9d812150f99; sha256 08b7f6d91188ab319c6f0715b678f15cacb198a0fe79d5b1c40d0de6dd1bf4e3) -->

# Independent ordinary review A (correctness) — #616 delta c3685d9d..1deb5232 (rebased)

**Exact candidate:** `1deb52320e8f1126a99d861d8dd2e9d812150f99`
**Comparison base:** origin/main `26c43def6bede50a4d831801d34a59433cbfc891`. The merge base equals it. The previous reviewed head was `c3685d9d` on old base `3096cb04`, preserved as backup `92660ed7`.
**Reviewer / model / context:** Sonnet 5.5 (`claude-sonnet-5-5`), a fresh read-only context. It did not author, direct or remediate the change, and no repo file was edited. The only scratch work was a temporary clone, deleted afterwards, for one mutation check.

**Files checked:**
- `.github/workflows/ci-fast.yml`
- `.github/workflows/ci-full.yml`
- `.github/workflows/release.yml`
- `.github/actions/change-scope/action.yml`
- `scripts/ci/lib/workflow-gates.mjs`
- `scripts/ci/check-visual-scope.mjs`
- `scripts/ci/probes/change-scope.test.mjs`
- `scripts/ci/probes/workflow-gate-drift.test.mjs`
- `scripts/ci/test-all.mjs`
- `package.json`
- `docs/04-engineering/ci-cd.md`

**Checks actually run:**
- **Range-diff, `git range-diff 3096cb04..92660ed7 origin/main..1deb5232`:**
  - Commits 1–3 and 5–7 are `=` (unchanged).
  - Commit 4 is `!`. The only differences are main's five "Normalize Ubuntu APT mirror" steps and the G8 expected-lines pin being carried into the merged result.
  - Commit 8 is the new hardening commit.
- **Job-by-job comparison with a throwaway YAML script, origin/main against HEAD, over every job in `ci-fast.yml` and `ci-full.yml`:**
  - All 13 fast jobs and 5 full jobs are present. No job-level key changed.
  - Every step of main is present in HEAD in the same order with an identical body. The only differences are:
    - the added `with: fetch-depth: 0` on the checkout of scoped jobs;
    - the added `check:policy` step in `registers` (13 steps against main's 12; `registers` is an always-run job and has no scope step);
    - the added scope step and the scope `if:`.
  - Pre-existing step conditions survive, composed as `${{ always() && steps.scope.outputs.full != 'false' }}` for the upload steps. Nothing was dropped.
  - **No step in a scoped job is left ungated after the scope step.** The single ungated step is the safe.directory step in `visual`, which by design precedes the scope step. A policy-only PR is the only case where gated steps are skipped; a full PR still runs every gate.
- **Normalize steps (all 5):**
  - `ci-fast` `build`, and the `ci-full` jobs `e2e`, `a11y` and `performance`, each carry `if: ${{ steps.scope.outputs.full != 'false' }}`.
  - `visual` keeps `run: node scripts/ci/normalize-ubuntu-apt-mirror.mjs` with no `sudo`, because it runs in the Playwright container. The G8 pin in `check-visual-scope.mjs` matches the shipped line.
  - The other four keep main's `sudo -- "$(command -v node)"` form.
  - Each Normalize step precedes its "Install Chromium" step, as on main.
- **Overlap files:** I diffed every line main added to `ci-cd.md` (the G11 method), `package.json` (`check:ui:raw-elements`), `check-visual-scope.mjs`, `workflow-gate-drift.test.mjs` and `test-all.mjs` since `3096cb04`. All are still present in HEAD. The `check:ui:raw-elements` step is kept in `ci-fast.yml` and in the `test-all.mjs` manifest.
- **Checkouts:** all 20 `actions/checkout` uses, across `ci-fast.yml` (13), `ci-full.yml` (5) and `release.yml` (2), use exactly `@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09`. The only `services:` match in `.github` is a comment in `ci-full.yml`.
- **Mutation check (temporary full clone at the candidate):**
  - Replacing the exact-SHA regex with a generic 40-hex regex made the "checkout pinned to any other commit" test fail.
  - Dropping `services` from the refused keys made the "job-level services block" test fail.
  - Everything else stayed green, so both new refused-table rows are non-vacuous.
- **Test runs:**
  - `node --test scripts/ci/probes/workflow-gate-drift.test.mjs`: 56/56 pass.
  - `node --test scripts/ci/probes/change-scope.test.mjs`: 71/71 pass.
  - `node --test 'scripts/ci/**/*.test.mjs'`: 1268 tests, 121 suites, 1268 pass, 0 fail, 0 skipped. This matches the author's count.
  - `pnpm check:policy`: 8 policy files coherent.
  - `pnpm check:visual-scope`: passes with 7 screenshot cases and 6 active inventory route rows.

## Findings

**Blocking:** None.

**Non-blocking:**
1. In `scripts/ci/check-visual-scope.mjs`, the expected line for the visual Normalize step is a hard-coded literal, while the neighbouring lines use the `SCOPE_IF` constant. The strings are identical, so there is no behavioural effect. Using `SCOPE_IF` there would be tidier.
2. The "Throttle 1 boundary" comment above `route-policy` in `ci-fast.yml` is removed. This was introduced in the earlier reviewed commit `6f15c484`, not by the rebase or the hardening, and it is comment-only. I mention it only because it is an unrelated deletion in a CI file.

## Verdict
**CLEAR WITH NON-BLOCKING**

<!-- END REPORT 1 -->

<!-- BEGIN REPORT 2 (agent a838d7af14229231e; model claude-sonnet-5-5; role ordinary review B (test adequacy), rebased delta; candidate 1deb52320e8f1126a99d861d8dd2e9d812150f99; sha256 dc655b3c09df8c04a5da2fa8387c5b68c87e41d67d8411ce3c953c627e28c935) -->

# Independent ordinary review B (test adequacy) — #616 delta c3685d9d..1deb5232 (rebased)

**Exact candidate:** 1deb52320e8f1126a99d861d8dd2e9d812150f99, worktree `/private/tmp/claude-501/policy-enforcement`, clean tree.
**Comparison base:** origin/main 26c43def; previously reviewed head c3685d9d on old base 3096cb04.
**Reviewer:** independent ordinary reviewer (test adequacy), model Sonnet 5.5 (claude-sonnet-5-5), fresh context. I authored, directed and remediated nothing. I edited nothing in the worktree. All mutation work ran in scratch copies under `$TMPDIR` (`rev`, `rev2`), each a `git archive` of 1deb5232 with its own `git init`.

**Files checked:**
- `scripts/ci/lib/workflow-gates.mjs`
- `scripts/ci/probes/change-scope.test.mjs`
- `scripts/ci/check-visual-scope.mjs`
- `.github/workflows/ci-fast.yml`
- `.github/workflows/ci-full.yml`
- `.github/actions/change-scope/action.yml`
- the range-diff `3096cb04..92660ed7` vs `origin/main..1deb5232`

**Range-diff:** commits 1–3 and 5–7 are unchanged (`=`). Commit 4 differs by the added Normalize steps and their scope condition, and `1deb5232` is new.

**Baseline:** `change-scope.test.mjs` has 71/71 passing. The full `node --test 'scripts/ci/**/*.test.mjs'` in the real worktree gives 1268 tests, 121 suites, 1268 pass, 0 fail, matching the author.

My `rev2` copy shows 3 failures that also occur in the unmutated baseline. They are environmental to a scratch copy with no origin or real tsc tree: "exemption no longer needed", "tsc programs", "changedFiles". They are identical across every mutant run, so they do not affect the mutant comparison.

## Mutant table

Each mutant is one weakening in `workflow-gates.mjs`, run against `change-scope.test.mjs` (71 tests).

| Mutant | Result |
|---|---|
| M1: checkout regex accepts any 40-hex SHA | KILLED, only "a checkout pinned to any other commit (fork-resolvable SHA)" fails (70 pass, 1 fail) |
| M2: drop `"services"` from refused job keys | KILLED, only "a job-level services block" fails |
| M3: safe.directory compare reduced to first line only | KILLED, only "a pinned-container job whose second step is not the exact safe.directory text" fails |
| M3b: safe.directory compare reduced to line count | KILLED, same single test |
| M4: `/^env\b/` narrowed to `/^env:/` | KILLED, only "a workflow env key written `env :`" fails |
| M5a: entry regex allows `\s*:` (space before the colon) | **SURVIVES** (71/71) |
| M5c: entry value pattern loosened to `(.*)` | **SURVIVES** (71/71) |
| M5d: entry key pattern loosened to `[^:]*` | **SURVIVES** (71/71) |
| M5b: drop the `ALLOWED_WORKFLOW_ENV.has(...)` check | KILLED, "a workflow env beyond the inert pair" fails (pre-existing row) |

Each of M1–M4 fails exactly the intended new row and nothing else.

**Remove-`if:` mutants.** I deleted the `if:` line from one Normalize step at a time in `rev2`, then ran `check-visual-scope.mjs`, `check-policy.mjs` and the full ci-scripts suite:

| Normalize step | Result |
|---|---|
| ci-fast.yml (only one) | **SURVIVES** (check-visual-scope exit 0, check-policy exit 0, suite same 3 baseline failures) |
| ci-full.yml job 1 | **SURVIVES** |
| ci-full.yml job 2 | **SURVIVES** |
| ci-full.yml job 4 | **SURVIVES** |
| ci-full.yml job 3 (the G8 visual job) | KILLED by `check-visual-scope.mjs` (exit 1), via `expectedVisualJobLines` |

I also ran the unit file `check-visual-scope.test.mjs` against the four surviving mutants and it stayed at 154/154.

**Full PRs still run those steps.** Every Normalize step uses `steps.scope.outputs.full != 'false'`. The `change-scope` action starts with `full=true` and flips it only on an exact `policy` verdict from the merge-base classifier. The `change-scope.test.mjs` full=true cases cover every other path, including non-default base, other events, crash and no classifier, so a non-policy PR still runs them.

## Findings

**Blocking:** none.

**Non-blocking:**

1. **The "unparseable workflow env line" row is vacuous with respect to the entry regex (M5a, M5c, M5d survive).**
   - The row's line is `  NODE_OPTIONS : x`, and `NODE_OPTIONS` is not in `ALLOWED_WORKFLOW_ENV`. It is therefore refused by the key allowlist whatever the regex does, so loosening the regex to accept the space before the colon, any value, or any key text goes unnoticed.
   - The actual effect of M5c is that an allowed key with a non-constant value, such as `DO_NOT_TRACK: ${{ github.event.pull_request.title }}`, would be accepted. No row has an allowed key with a bad value.
   - Suggested fix: use `TURBO_TELEMETRY_DISABLED : "1"`, or a value row such as `DO_NOT_TRACK: $(id)`, `"${{ github.head_ref }}"` or an unquoted `{x}`, so the regex is the only refusing mechanism.
   - The mutants are low-severity because the allowed keys are inert, but the row does not test what its name says.

2. **Removing the `if:` from a Normalize step goes unnoticed in 4 of 5 jobs.**
   - This is the ci-fast job and three ci-full jobs. Only the G8 visual job is exact-shape pinned by `check-visual-scope.mjs`.
   - The A9 `proveScopeStep` and workflow-gate-drift logic classify only gate steps. They do not require `if:` on every later step in a scope-gated job.
   - Consequence: on a policy-only PR the Normalize step, which runs `sudo node` on the runner, would still run in those jobs. That is a liveness and consistency regression, not a bypass of a gate, because the gate steps remain gated. It also contradicts the A9 doc claim that "every later step carries `if:`".
   - This predates the delta, but the delta added these steps by hand in 4 jobs with no test that pins them.
   - Suggested fix, either of: a test or checker rule that every step after the scope step in a scope-gated job carries the exact condition (or the documented `always() && …` form), or add the Normalize step to the job-shape pins as G8 has.

3. **Minor, not a gap.** M3 weakens only the first or second line of the safe.directory text. A mutant that compared only line one (the step name) would be caught by the new row (run line differs). A mutant that compared only the `run` line is untested by the new row, but the row's differing text is in the `run` line, which is the security-relevant part.

## Verdict

**CLEAR WITH NON-BLOCKING.** All five new refused-table rows are non-vacuous for SHA, services, safe.directory and `env :`, each killing its intended mutant exactly. The regex-looseness row is vacuous (finding 1), and the missing scope-condition pin on the other four Normalize steps (finding 2) is a coverage gap, not an exploitable defect.

<!-- END REPORT 2 -->

<!-- BEGIN REPORT 3 (agent a399c1abbc5121183; model claude-opus-5-5; role security review, rebased delta; candidate 1deb52320e8f1126a99d861d8dd2e9d812150f99; sha256 336d1145c11d21b06bed5a37c1fad239f18dbd757797797572d38c80146b4c03) -->

# Independent security review — #616 delta c3685d9d..1deb5232 (rebased onto main 26c43def)
- **Exact candidate reviewed:** 1deb52320e8f1126a99d861d8dd2e9d812150f99
- **Comparison base:** origin/main 26c43def6bede50a4d831801d34a59433cbfc891, which is also the merge base. The previously reviewed head was c3685d9d; the pre-rebase backup is 92660ed7.
- **Reviewer / model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh Agent-tool context (general-purpose, not forked), role: security reviewer; did not author, direct or remediate.
  - Main's model list now includes this label, so `check:pr-template` would accept this review.
  - The PR's commits carry a "Claude Opus 5.5" co-author line. Independence here rests on the context being separate, not on a different model.
- **Files / surfaces examined:**
  - the range-diff `3096cb04..92660ed7` against `origin/main..1deb5232`
  - commit 1deb5232: `workflow-gates.mjs` (`PINNED_CHECKOUT_SHA`, the `services` refusal), both workflows, `check-visual-scope.mjs`, ci-cd.md, `change-scope.test.mjs`
  - `git diff origin/main..HEAD`, with every removed line in workflows, `test-all.mjs`, `package.json` and `check-visual-scope.mjs` accounted for
  - every gated job's step order in the shipped `ci-fast.yml` and `ci-full.yml`
  - `review-models.mjs` against main's model block
  - live CI and the ruleset at 1deb5232
- **Checks actually run:**
  - **Full CI-scripts suite** in my own detached worktree at 1deb5232, with package dependencies linked from the coordinator's worktree: 1268/1268 pass. `test-all --list` exits 0.
  - **Main's probes:** atomic-gate-proof, workflow-alias-table and workflow-gate-drift at 26c43def pass 121/121 with the candidate scanner.
  - **Round-6 probes:** those three plus round 6's `change-scope.test.mjs`, at c3685d9d with the candidate scanner, pass 184/186. Both failures are GREEN controls that used a fake checkout SHA (`aaaa…`), which the exact pin now refuses. Stricter, not weaker; every RED row passes.
  - **A script of my own** listing each gated job's steps before the scope step and any ungated steps after it.
  - **`readAcceptedSecurityReviewModels()` run against the real repo:**
    - with no `GITHUB_BASE_REF` set, and with `GITHUB_BASE_REF=main`;
    - with `GITHUB_BASE_REF=feature-x`.
  - **Live CI logs and the ruleset, read-only.**
  - The coordinator's worktree was not modified (clean, still at 1deb5232). My scratch worktrees were removed.

## Disposition of round-6 findings
1. **Checkout accepted any 40-hex SHA — CLOSED.** The allowlist now requires exactly `actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09`. Verified: the round-6 fake-SHA controls are refused, and the new refused-table row passes.
2. **Job `services` accepted — CLOSED.** Scope-gated jobs now refuse `services`; the new refused-table row passes. No shipped workflow uses `services`.
3. **Harmless acceptances — no change needed.**

## Findings
**Blocking:** None.

**Non-blocking:** None new. The quoted-YAML-key class is out of scope and tracked separately.

**What I checked against each of your focus questions:**
- **Can a required check go green on a full PR without its gate running?**
  - Live CI at 1deb5232: every gated job logged `full=true — no classifier at merge base 26c43def` and ran its gate (for example, `pnpm build` executed).
  - The 5 always-run jobs carry no scope step.
  - Every one of the 13 gated jobs has no ungated step after the scope step. The five new Normalize-APT steps (four run under `sudo`) all carry the scope condition, so they run on full PRs.
  - The G8 job-shape pin requires the visual step's `if:` to appear exactly once with the scope condition.
- **Can a step before the scope step, or a new ungated step, influence the classifier or the action?**
  - In all 13 gated jobs, the only step before the scope step is the exact pinned checkout with `fetch-depth: 0`. The visual job adds the exact `safe.directory` step, inside the pinned Playwright container.
  - Nothing that runs before the classifier can write `$GITHUB_ENV` or `$GITHUB_PATH`, change `PATH`, or rewrite the workspace.
  - The Normalize steps run after the scope step and do not feed into it.
- **Is the merge-base model read still sound with the block on main?**
  - Verified: it resolves the merge base on `origin/main` (26c43def) and returns `["GPT-6 Sol", "GPT-6.1 Sol", "Claude Opus 5.5 (claude-opus-5-5)"]` from there.
  - A non-main target throws.
  - The PR does not change `agent-workflow.md` relative to main.
  - The self-approval probes ("refuses a model that only the pull request's own HEAD adds", plus the HEAD-only-list case) pass.
- **Is anything from main lost in the rebase?**
  - Commits 1–3, 5 and 6 are identical. Commit 4 differs only by main's Normalize context lines.
  - The only lines the PR removes relative to main are:
    - the old Throttle comment block;
    - one integration-job comment line;
    - six `if: always()` lines, each replaced by `always() && steps.scope.outputs.full != 'false'` (6/6 counted);
    - the G8 visual-step key check, which is extended (`["if","run"]` plus an exactly-once condition), not dropped.
  - Main's G11 changes, `check:ui:raw-elements` and its new `test-all` entries are all present: the suite and `test-all --list` are green.

## Residual risk
**Verified:**
- Everything listed above, plus: live CI at 1deb5232 is red only on the PR-template check (the security review is not yet recorded). `registers`/`check:policy` and dependency audit are green.
- The ruleset still requires the same 18 checks.
- Policy-only skipping has not yet run live. The classifier is not on main yet, so it cannot happen before this PR merges; the probes and the round-5 local action run cover it.

**Reasoned only:**
- A failing scope step fails its job.
- Re-running a single job re-runs its scope step.

**Out of this PR's reach, unchanged:**
- Workflows, the action and the scanner run from the PR's own copy, so they rest on security review of `.github/**` and `scripts/ci/**`. The action's SHA-256 pin is a tripwire for reviewers, not a boundary.
- Required checks are not pinned to a source app in the ruleset.
- A PR can be retargeted to a branch with a gutted workflow.

## Verdict
CLEAR

<!-- END REPORT 3 -->
