# Pre-merge security review — PR #355 (Playwright protected-route smoke, domain coverage, OpenAPI contract gates, issue #10)

**Reviewed head:** `0f10f040f55f09dc1212a35694e445e2aafa79a7`

**Verdict: CLEAR WITH FINDINGS.** The code, workflow and dependency surfaces are clear. No
fork or `pull_request_target` path reaches a secret. There is no script injection. Every
action is SHA-pinned. Both new required jobs fail closed and run on every pull request. The
new packages match the registry, carry provenance and have no install scripts. Nothing new
reaches the production image.

**Two findings block the merge**, S1 and S2. Both are about the gate and the governance
record, not the code. Neither is closed by this note. The orchestrating session must
resolve them itself. There are also six NON-BLOCKING findings.

**Status of the gate:** this is the required independent Opus security review, run before
merge. It covers the head named above **and that head only**. Any change outside
`docs/07-planning/security-reviews/` after it makes this note stale. That includes removing
the entry that S1 concerns. A stale note needs a fresh delta review. No waiver was sought
or used, and none is authorized.

**Reviewer independence.** This was a fresh, review-only Opus 5.5 context commissioned by
the orchestrating session. It did not author, direct or remediate any part of the change.
It made no code edit, no GitHub approval and no PR comment. It did make one temporary local
mutation to prove the smoke test is not vacuous. That mutation was reverted with
`git checkout`, and `git status --porcelain` was empty afterwards. The only write is this
note.

**Attribution recorded.** `## Implemented by` says: "Codex GPT-6 Luna (this lane's root E2E
alias and process update); earlier implementation commits were authored by Claude Code".
The commit authors on `main..HEAD` are:

- `Codex (GPT-6) <codex@taskdesk.local>`: 4 commits, `2f913b6`, `ac588fa`, `75ca4b6` and
  `4b62415`. These are the Playwright suite, `test-contract.mjs`, the oasdiff installer and
  the coverage threshold.
- `Claude Code <noreply@anthropic.com>`: 8 commits, `1c49726` to `e308243`. These are the
  trigger change, the probe and the docs.
- `Codex GPT-6 Luna <codex-gpt6-luna@taskdesk.local>`: 2 commits, `121e246` and `0f10f04`.

`## Implemented by` does not name the `Codex (GPT-6)` identity that wrote the core code (see
S2).

**Base.** The merge base is `7bebaf6`, which equals `origin/main` at review time. No
update-branch is needed.

---

## Surfaces examined

`gh pr diff 355 --name-only` returned 15 files:

- `.github/workflows/ci-fast.yml`
- `.github/workflows/ci-full.yml`
- `package.json`
- `apps/web/package.json`
- `pnpm-lock.yaml`
- `packages/domain/vitest.config.ts`
- `apps/web/playwright.config.ts` (new)
- `apps/web/e2e/auth-redirect.spec.ts` (new)
- `scripts/ci/test-contract.mjs` (new)
- `scripts/ci/test-contract.test.mjs` (new)
- `scripts/ci/test-all.mjs`
- `scripts/ci/probes/workflow-gate-drift.test.mjs`
- `docs/04-engineering/ci-cd.md` (orchestrator-owned)
- `docs/07-planning/decision-log.md` (orchestrator-owned)
- `docs/07-planning/status.md` (orchestrator-owned)

I also read these unchanged inputs:

- `.github/actions/setup/action.yml`
- `Dockerfile` (the `proddeps` and `runtime` stages) and `.dockerignore`
- `pnpm-workspace.yaml` (`onlyBuiltDependencies`)
- `apps/web/src/routes/_layout/_authenticated.tsx`
- `scripts/ci/check-pr-template.mjs` and `lib/security-review-note.mjs`
- the live `protect-main` ruleset (through `gh api .../rulesets`)
- the installed package manifests of every new package
- the bundled `@redocly/cli` `lib/index.js`, for its network behaviour

## Probes and results

| # | Probe | Result |
| --- | --- | --- |
| 1a | Triggers | `ci-fast` runs on `pull_request` [opened, synchronize, reopened, ready_for_review, edited] and on `push: main`. `ci-full` runs on `merge_group`, `pull_request` [opened, reopened, labeled, synchronize, ready_for_review] and `workflow_dispatch`. Neither uses `pull_request_target` or `workflow_run`. A fork PR gets a read-only token and no secrets. PASS |
| 1b | Permissions | Both workflows set only `contents: read` at the top level. No job raises it, including `e2e` and `coverage`. PASS |
| 1c | Action pinning | The only new action is `actions/upload-artifact@043fb46d…` (v7.0.1). `gh api repos/actions/upload-artifact/git/ref/tags/v7.0.1` returns exactly that commit. `actions/checkout@fbc6f39…` still matches v5.1.0. PASS |
| 1d | `${{ }}` in `run:` | None in any added or changed step. The only interpolations are in `concurrency.group` and `cancel-in-progress`, which are not shell and not attacker-controlled strings. PASS |
| 1e | Browser download | `playwright install --with-deps chromium` (`ci-full.yml:76`). The CI log shows Chrome for Testing 153.0.8010.12 (r1243) and headless-shell downloaded from `cdn.playwright.dev`. The revision is fixed by `playwright-core@1.63.0/browsers.json`, and that package is integrity-pinned in the lockfile. There is no Actions cache, so no cross-PR cache poisoning. The download is TLS-only, not hash-verified (S6). |
| 1f | Secrets in the e2e boot | None. The webServer gets only `VITE_API_URL=http://127.0.0.1:4178`. No API process, database or secret is started. The two API calls the SPA makes are fulfilled by `page.route` mocks. PASS |
| 1g | `services:` on a mutable tag | None added. `integration` still uses Testcontainers, which is unchanged. PASS |
| 1h | Artifact | `apps/web/test-results/` only, 7-day retention. It holds a screenshot of a mocked page and a trace on failure. It never holds `.git` or credentials, although checkout persists the read-only token in `.git/config`. PASS |
| 2a | Job names and ruleset | The live ruleset requires `domain coverage (90%)` and `e2e - protected-route redirect`. The workflows define `name: domain coverage (90%)` (`ci-fast.yml:231`) and `name: e2e - protected-route redirect` (`ci-full.yml:67`). **Exact match.** The ruleset has no merge-queue rule, so the missing `merge_group` in `ci-fast` does not strand the coverage context. |
| 2b | Skip behaviour | Neither job has an `if:`, `paths:`/`paths-ignore:` filter or `needs:`. On a PR that touches no web or domain file, both jobs still run in full on opened, synchronize and reopened. `e2e` also runs on labeled and ready_for_review, and `coverage` also runs on edited. The ruleset uses the strict (up-to-date) policy, so a pre-existing PR must be updated, which fires `synchronize` and produces both contexts. Neither context can be satisfied by a skip. PASS |
| 2c | Coverage fails closed | Mutation `vitest run --coverage --coverage.thresholds.lines=99` gives `ERROR: Coverage for lines (97.66%) does not meet global threshold (99%)` and exit 1. PASS |
| 2d | e2e fails closed | See 4b to 4d. Also `forbidOnly: true` and `retries: 0`. PASS |
| 3a | New packages | `@playwright/test@1.63.0`, `playwright@1.63.0`, `playwright-core@1.63.0` (apps/web dev) and `@redocly/cli@2.54.2` (root dev, exact). No other lockfile entry changed. Each `sha512` integrity equals `pnpm view <pkg> dist.integrity`. All four have npm SLSA provenance attestations. `@redocly/cli@2.54.2` was published 2026-09-22 and is a 9.7 MB self-contained bundle with no dependencies, which explains its empty snapshot. |
| 3b | Install scripts | `scripts` is `{}` in all four installed manifests. There is no postinstall browser download; browsers are installed only by the explicit CI step. `onlyBuiltDependencies` is unchanged (biome, bcrypt, better-sqlite3, esbuild). The frozen install ran none of the new packages' scripts. PASS |
| 3c | Audit | `pnpm audit --audit-level=high` reports no known vulnerabilities. PASS |
| 3d | Production image | `pnpm check:dockerfile-deps` reports that 9 manifests match the `deps` stage COPY list. The `proddeps` stage runs `pnpm install --prod --frozen-lockfile --no-optional --ignore-scripts` over the root and api/libs/email/permissions manifests only. Root devDependencies (`@redocly/cli`) and `apps/web` devDependencies (`@playwright/test`) never reach `runtime`. PASS |
| 3e | oasdiff download | `test-contract.mjs` fetches `oasdiff_1.32.1_linux_amd64.tar.gz` from the official GitHub release. It checks SHA-256 before extracting, extracts only the `oasdiff` member into a fresh `mkdtemp` directory, and verifies `--version`. The pinned digest `7c8939fc…ee7f` equals the upstream `checksums.txt` line and the GitHub asset digest (uploader `reuvenharrison`, published 2026-09-15). PASS |
| 3f | oasdiff semantics | I mutated the contract by deleting `/activity/comment`: `3 error … api-path-removed-without-deprecation`, exit 1. The unchanged contract gives `No changes detected`, exit 0. A bad base ref gives exit 102, which fails closed. The `origin/main:<path>` git-revision syntax is honoured. PASS |
| 3g | Redocly ratchet | The baseline is built from `git show origin/main:<contract>`, not from any file the candidate controls. A missing or unparsable JSON report fails. Findings are compared as a multiset keyed on severity, rule and pointer, and the unit tests cover downgrade and add. There is one caveat: Redocly auto-discovers `redocly.yaml` from the checkout for both runs (S4). |
| 3h | Redocly network | Telemetry is on by default and is not disabled (S3). |
| 4a | Is the assertion real? | The test visits `/dashboard/workspace/e2e-workspace` with `get-session` fulfilled as `null`. It asserts the URL matches `/\/auth\/sign-in\?/`, that `redirect` equals the exact protected path, and that "Welcome back" is visible. That is the guard at `_authenticated.tsx:19`. |
| 4b | Mutation: guard removed | I changed `if (!session && !sessionError)` to `if (false)`: `✘ … Expected pattern: /\/auth\/sign-in\?/ Received string: "…/dashboard/workspace/e2e-workspace"`, exit 1. I reverted it, and the tree was clean. PASS |
| 4c | App never starts | Playwright's `webServer` must answer `/auth/sign-in` or the run errors before any test. `reuseExistingServer: false` and `--strictPort` stop a stray server on 4178 from standing in. PASS |
| 4d | Zero tests | `playwright test --grep zzz-no-such-test` gives `Error: No tests found`, exit 1. PASS |
| 4e | Local run | `CI=1 timeout -k 10 240 pnpm test:e2e` passed 1 test (16.8 s). Playwright managed the webServer lifecycle, and nothing was left listening on 4178 afterwards. |
| 5 | Coverage number | `pnpm test:coverage` on the head passed 470 tests. **Statements 97.61 %, Branches 95.15 %, Functions 98.50 %, Lines 97.66 %.** The PR does not touch `packages/domain/src`, so `main` has the same numbers and every PR will pass the 90 % gate once this merges. |
| 6a | `node --test 'scripts/ci/**/*.test.mjs'` | 500 tests in 88 suites. 500 pass, 0 fail. |
| 6b | `node scripts/ci/test-all.mjs --list` (the "CI matches ci-cd.md" checker) | Exit 0. `test:coverage`, `test:contract` and `test:e2e` are enabled. 14 are not enabled. |
| 6c | `pnpm test:contract` | Drift is clean. Redocly: 16 findings remain of `origin/main`'s 16. oasdiff was downloaded and verified: no breaking changes. |
| 7a | CI at exact head | Every required context has a latest-run success except "pull request template + security review", which fails because this review was pending. Earlier `cancelled` runs were superseded by `concurrency` and are not the latest. The non-required "Code scanning AI findings" dynamic run (`github-advanced-security`) failed with no annotation beyond exit 1. CodeQL reports no new alerts. |
| 7b | `check-pr-template.mjs --body` | 2 problems, both expected before this note: `**Note:**` must link the committed review, and the Opus checklist box is unticked. |
| 7c | Ordinary review | The body records "three fresh independent GPT-6 contexts (two GPT-6 Luna, one GPT-6 Codex)" PASS at `0f10f04`, **delta from `e308243` only**. `gh pr view --json comments` returns none. See S1 and S2. |

---

## Findings

### S1 — BLOCKING (governance) — A lane agent wrote a "Decided by: Thomas" entry into the decision log that relaxes the rule its own reviews depend on

`docs/07-planning/decision-log.md:8–23`, added by commit `0f10f04`, authored
`Codex GPT-6 Luna`.

The entry "GPT-6 Luna replaces Sonnet for ordinary reviews on active P0 lanes" lets GPT-6
Luna contexts do both "Sonnet-tier implementation **and** ordinary reviews". It is recorded
as "Decided by: Thomas, 2026-09-24, in session".

`main`'s 2026-09-23 entry ("Three non-Claude implementation agents…") says "The same agent
or tool is never both author and ordinary reviewer". This PR's latest delta was authored by
GPT-6 Luna, and two of its three recorded reviewers are GPT-6 Luna. So the new entry is
load-bearing for this PR's own gate.

The decision log is orchestrator-owned (CLAUDE.md, "The control plane"). A lane agent may
report a decision, but it may not record one. This review cannot verify that Thomas said
this. It is the same class as #331's S2.

**To close:** the orchestrating session checks its own record of Thomas's instruction.

- **If he said it:** the orchestrator owns the entry. The simplest path is a PR comment
  stating that it verified the entry, and the head does not change. It should also state
  how the entry reconciles with "never both author and reviewer".
- **If he did not say it:** the entry comes out, which is a head change and needs a delta
  Opus review, and S2 then needs a reviewer from a different tool.

### S2 — BLOCKING (gate) — No recorded ordinary review covers most of the change, and attribution does not reconcile

`## Reviewed by` in the PR body.

The recorded reviews cover only `e308243..0f10f04`. That is two commits: a one-line alias
and the decision-log entry. Nothing in the body, the comments or the reviews records an
ordinary review, at any SHA, of the twelve earlier commits `2f913b6..e308243`.

Those commits are the substance of the change:

- the Playwright suite;
- `test-contract.mjs` with its network installer and lint ratchet;
- the coverage threshold;
- the `ci-full` trigger change;
- the new red probe.

`## Implemented by` also does not name `Codex (GPT-6) <codex@taskdesk.local>`, which
authored four of those commits. The eight `Claude Code <noreply@anthropic.com>` commits
need the orchestrator's own confirmation that they were its session and not a lane agent
under that identity (the 2026-09-23 identity rule).

**To close:** either link the recorded full-range ordinary review(s) with model and SHA, or
commission one from an agent or tool that authored none of the range. Then correct
`## Implemented by`. Neither step needs a code change or changes the head.

My own reading of those twelve commits found nothing blocking (below). It is not a
substitute for the required ordinary review.

### S3 — NON-BLOCKING — Redocly CLI sends usage telemetry from CI and developer machines

`scripts/ci/test-contract.mjs:77–84` (`redoclyReport`) and `:47–55` (`run`, which inherits
`process.env`).

`@redocly/cli@2.54.2` sends telemetry unless `process.env.REDOCLY_TELEMETRY === "off"` or
the config says `telemetry: off` (`lib/index.js`). I verified this in the installed bundle.
Each send carries the command, redacted arguments, the Node version, `CI`, the lint rule ids
that errored or warned, and a persisted anonymous id. It first probes whether it can reach
the endpoint.

The workflows set `DO_NOT_TRACK=1`, which Redocly does not read. No secret or spec content
is sent. This is data egress the project has clearly opted out of elsewhere.

**Fix:** pass `env: { ...process.env, REDOCLY_TELEMETRY: "off" }` in `redoclyReport`.

### S4 — NON-BLOCKING — The new required gates' pass/fail definitions sit outside the security-review scope

`packages/domain/vitest.config.ts:11–15` is the threshold for the required context
`domain coverage (90%)`.

- `apps/web/playwright.config.ts` defines what `e2e - protected-route redirect` runs.
- Redocly auto-discovers a root `redocly.yaml` or `.redocly.yaml`, which does not exist
  today. It applies to both the baseline and the candidate run, so a PR that adds one with
  `rules: {}` silences the lint ratchet uniformly.

None of these paths is in `ci-cd.md`'s scope list (lines 140–159). A later PR outside
security scope could delete `thresholds`, add coverage `exclude` globs, retarget `testDir`
or add a Redocly config, and the required checks would stay green without an Opus review.
That is the blind spot ci-cd.md's "second block" exists for (#19).

**Follow-up:**

- add these files to the second block, or move the thresholds to the in-scope
  `package.json` script;
- pass an explicit `--config` or `--extends` to Redocly;
- or have `test-all.mjs` assert the threshold values.

### S5 — NON-BLOCKING — Factual errors in added decision-log entries

`docs/07-planning/decision-log.md:26–31` says the three contexts "already ran in CI, but
failing results did not block merges". That is false for `domain coverage (90%)` and
`e2e - protected-route redirect`, which first exist in this PR. Requiring them before this
PR merges is why every other PR is currently blocked.

`decision-log.md:70–72` justifies leaving branches unthresholded because branches would
"fail at 88.77%". Branches measure 95.15 % at this head. The rationale is stale, although
the decision stands as recorded.

Both entries were written by the PR (by `Claude Code` and `Codex (GPT-6)` respectively). The
orchestrator should correct them with a new entry, not a rewrite, since the log is
append-only.

### S6 — NON-BLOCKING — Browser binaries are TLS-trusted, not hash-pinned

`.github/workflows/ci-full.yml:76`.

The Chromium revision is pinned transitively through the lockfile, but the zip from
`cdn.playwright.dev` is not checksum-verified. `--with-deps` also runs `apt-get` as root on
the runner. The job holds only `contents: read` and no secrets, so a compromised download
could at worst falsify this job's own verdict. This is acceptable for a smoke. Revisit if
the job ever gains secrets or write scope.

### S7 — NON-BLOCKING (scope note) — The smoke proves the client router guard only

`apps/web/e2e/auth-redirect.spec.ts:6–31` and `apps/web/playwright.config.ts:15`.

The API is entirely mocked and the Vite **dev** server is booted, not the built bundle or
the Node process that ships. So the test proves the client guard and the redirect target.
It does not prove server-side enforcement or the production bundle. `ci-cd.md` states this
honestly.

A related observation that predates this PR: `_authenticated.tsx:13–19` does not redirect
when `getSession()` rejects. It defers to the children. That path is untested here.
Server-side authorization is the actual control, so this is informational.

### S8 — NON-BLOCKING (pre-existing, informational) — Required contexts are not bound to an app

The `protect-main` ruleset lists all 15 contexts without `integration_id`. Any actor able to
post a commit status could satisfy one by name, including the two added here. This predates
the PR. Binding the contexts to GitHub Actions would close it.

---

## What I did not do

- I did not run `docker build`. I relied on `check:dockerfile-deps` and a reading of the
  `proddeps` stage.
- I did not independently re-review the four `test-all.mjs` manifest wording edits beyond
  the checker's green result.
- I did not verify Thomas's 2026-09-24 or 2026-09-23 "Decided by" claims. S1 asks the
  orchestrator to do that.
