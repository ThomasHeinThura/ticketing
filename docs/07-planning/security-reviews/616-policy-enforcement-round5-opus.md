# 616 — policy enforcement: round-5 independent delta reviews (Opus 5.5)

- **Reviewer contexts:** fresh Claude Code Agent-tool subagents (`subagent_type: general-purpose`, not forked, model inherited: `claude-opus-5-5`), parent session `412b91f1-99f8-4ac2-8f5c-a03dce507862`. None authored, directed or remediated the change.
- **Transport:** each report is the reviewer's final message, extracted mechanically from its subagent transcript and inserted unmodified between the markers, with its SHA-256. A hash identifies bytes; it does not prove independence or approval.

<!-- BEGIN REPORT 1 (agent a34879707b9e889e2; candidate 3446fac5f28f0dbb49d7b0c9eb898a5fec9a5ce0; sha256 781e13104cf77c467f82adbc167297c2dda347c9637b5e54fa6a97e1f8f6d370) -->

# Independent ordinary review — #616 correctness delta 7e8ab217..3446fac5
- **Exact candidate reviewed:** 3446fac5f28f0dbb49d7b0c9eb898a5fec9a5ce0. It descends from 7e8ab217, and the delta is two commits, cbd27f24 and 3446fac5.
- **Comparison base:** 7e8ab21792c85fd8b40480b22bcc01f908c6bd25. For test-name comparison I used main at 3096cb044bdf6ae98488bfc385f532fa6386343a.
- **Reviewer / model / context:** Claude Opus 5.5 (claude-opus-5-5). Fresh Agent-tool context (general-purpose, not forked), continued for this delta. Did not author or remediate.
- **Files / surfaces checked:**
  - `.github/actions/change-scope/action.yml`
  - `.github/workflows/ci-fast.yml` and `ci-full.yml`
  - `scripts/ci/lib/workflow-gates.mjs`: A9 `proveScopeStep`, `workflowEnvKeys`, the action digest, duplicate step-key refusal, and `classify`
  - `scripts/ci/classify-change.mjs`
  - `scripts/ci/lib/review-models.mjs`
  - `scripts/ci/check-policy.mjs`
  - `scripts/ci/check-visual-scope.mjs`
  - `docs/04-engineering/ci-cd.md` § Applicability
  - `docs/07-planning/security-reviews/616-policy-enforcement-round4-opus.md` (REPORT 1)
- **Checks actually run:**
  - **Full `node --test 'scripts/ci/**/*.test.mjs'`:**
    - Candidate: 1166 tests, 119 suites, 1164 pass, 2 fail. Both failures are the known typecheck-coverage pair ("every covered tree is fully present…" and "an exemption that is no longer needed FAILS…").
    - Main: 1078 tests, 112 suites, 1074 pass, 4 fail. That is the same typecheck pair plus "A: a second read plus a matching baseline entry…" and "RED — set +ex". Both extra failures are ENOENT races on contrast scratch files.
    - No test fails on the candidate only.
  - **Changed test files run alone, all passing:**
    - change-scope 50/50
    - check-policy-end-to-end 8/8
    - check-policy 4/4
    - review-models 12/12
    - security-model-exact 19/19
  - **`node scripts/ci/test-all.mjs --list`:** exit 0.
  - **PyYAML, both workflows:**
    - All 13 gated jobs (8 in ci-fast, 5 in ci-full) have no job-level `needs` or `if`.
    - In 12 of them the `scope` step is step 2, straight after a pinned checkout with `fetch-depth: 0`. In `visual` it is step 3, after the safe.directory step.
    - Every later step's `if` is exactly `${{ steps.scope.outputs.full != 'false' }}`, or `${{ always() && steps.scope.outputs.full != 'false' }}` where the step previously had `always()`. That covers 4 upload steps and the performance diagnostic step, which keeps `continue-on-error: true` as before.
    - A field-by-field comparison with main found the gated jobs unchanged apart from the scope additions.
    - Triggers and concurrency are unchanged.
    - `pull-request`, `ci-scripts`, `secret-scan` and `gates-declared` are byte-equal to main. `registers` differs only by the added `check:policy` step.
  - **9 extra adversarial A9 shapes through the probe harness.** Results are under the non-blocking findings.
  - **One baseline probe:** an ungated gate placed after a step that poisons `GITHUB_PATH` is still classified as "executes".
  - **F2 re-test:** `check:policy` run from a path with a space now runs and exits 1.
  - **Helper spot-checks:** `slugify`, `linksOf` and `liveStateIn`.
  - **REPORT 1 diffed** against my returned text.

## Disposition of round-4 findings
- **F1 (BLOCKING) — CLOSED.**
  - **Verified from source:** no gated job has job-level `needs` or `if` any more. The gating is now a step-level condition after an unconditional scope step. A9 refuses `needs` by presence again.
  - **Reasoned from GitHub semantics, not verified live.** A step `if` without a status function gets an implicit `success() &&`. Therefore:
    - **Scope step fails:** later steps are skipped and the job concludes failure (red).
    - **Run cancelled:** every gated job has already started with no `needs`, so the running or queued job is cancelled (red), as on main. No job is ever left skipped because it never started.
    - **Same-SHA re-trigger** (`labeled` or `edited` with cancel-in-progress): the old run's jobs end cancelled and the new run's jobs register straight away, so there is no green window.
    - **Policy-only answer:** later steps are skipped and the job succeeds. That is the authorised green.
    - **Empty or missing output:** `'' != 'false'`, so the gates run.
  - **What could turn green otherwise:** I found no path to a green required check other than the action writing exactly `full=false`, which it does only on the exact answer `policy`. The exception is a workflow edit in the same PR (see N1).
- **F2 — CLOSED.** The guard now compares `realpathSync(argv[1])` with `realpathSync(fileURLToPath(import.meta.url))`. From a path containing a space, the script now runs and exits 1.
- **F3 — CLOSED.** ci-cd.md now says "a merge that brings in any non-policy change". It names the merge-from-main edge and says to prefer rebasing.
- **F4 — PARTIAL.**
  - Fixed: `_` is kept in slugs; `[a](x.md "t")` is parsed.
  - Still open (all minor): titles in single quotes or parentheses; one-digit `#N`; short SHAs.
- **F5 — PARTIAL.**
  - **Closed:** the composite action is now pinned by SHA-256. The bare-condition point is moot: at step level the bare form is valid YAML with the same meaning.
  - **Still open:** the checkout `with:` options (`repository`, `ref`, `path`) are still unconstrained. The pin is taken over the repository file the scanner reads, not over whatever a re-pointed checkout would execute. Folded into N1.

## Findings
**Blocking:** None

**Non-blocking:**
- **N1 — A9's "nothing can redirect the action's `git` or `node`" is broader than what it checks.**
  - **Accepted as `scope-gated`, confirmed with probes:**
    - a step before the scope step that writes `$GITHUB_PATH`, or writes `BASH_ENV` into `$GITHUB_ENV` (the composite runs a non-interactive bash, which honours `BASH_ENV`);
    - a step before the scope step that `uses:` another action;
    - a job-level `container:` image on a gated job;
    - a workflow-level `env:` written in flow form, such as `env: { BASH_ENV: … }`. `workflowEnvKeys` only parses the block form.
  - **Not new in kind:** the same poisoning before an *ungated* gate is already classified "executes". All of these need a `.github/**` edit, which is security-scope.
  - **But it is a step back from round 4.** There, the scope job's steps and keys were fixed by allowlist.
  - **Suggested fixes:**
    - allow before the scope step only the pinned checkout (plus visual's exact safe.directory step);
    - refuse or pin job `container:`;
    - refuse a non-block-form top-level `env:`;
    - or narrow the wording in the code comment and in ci-cd.md.
- **N2 — The always-run rule is keyed by job ID, not by gate.**
  - `ALWAYS_RUN_JOBS` lists job IDs. A probe gating a step in job `registers` was refused, but the same step in a job named `registers2` was accepted.
  - So moving, for example, `pnpm check:policy` or `check:pr-template` into a gated job would be counted as executing. ci-cd.md's statement that always-run jobs "may never be gated; `workflow-gates.mjs` refuses it" holds only for those job IDs.
  - Suggested fix: key the rule on gate names, such as `check:policy`, `check:pr-template`, `test:ci-scripts`, `test:all --list` and the secret scan.
- **N3 — Small points.**
  - The action fences its log correctly: a random 128-bit token, resumed after one line. `GITHUB_OUTPUT` is written before the fence, outside the log.
  - The `DEFAULT_BRANCH` gate fails closed when the value is empty.
  - The classifier's switch to JSON-escaped paths is correct.
  - review-models: rejecting a non-default `GITHUB_BASE_REF` and requiring printable-ASCII labels are both correct. The ASCII check runs before the padding check, so a tab gives the ASCII message, which is acceptable.
  - The duplicate step-key refusal covers both the first-key and later-key paths.
- **REPORT 1 is byte-identical.**
  - Lines 8–108 of the note (between the BEGIN and END markers) match what I returned, line for line, including the closing worktree sentence.
  - Their SHA-256 without the trailing newline is `c7bb68090638663201a014a231e4c0f3ebc3ca486d9859deee95b53a3ee7fb18`, which matches the hash in the note's BEGIN marker.

## Verdict
CLEAR WITH NON-BLOCKING

My scratch worktrees (`$TMPDIR/616r5`, `$TMPDIR/616r5main`) are removed, and incremental notes are appended to `/private/tmp/claude-501/616-ordinary-a.md`.

<!-- END REPORT 1 -->

<!-- BEGIN REPORT 2 (agent a32abc363efeeecbd; candidate 3446fac5f28f0dbb49d7b0c9eb898a5fec9a5ce0; sha256 26e6bfa93dc3a42e3da30dd330977e38f246f3846264bc315a948e1a75f09455) -->

# Independent ordinary review — #616 test adequacy delta 7e8ab217..3446fac5
- **Exact candidate reviewed:** 3446fac5f28f0dbb49d7b0c9eb898a5fec9a5ce0
- **Comparison base:** 7e8ab21792c85fd8b40480b22bcc01f908c6bd25
- **Reviewer / model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh Agent-tool context (general-purpose, not forked). I did not author, direct or remediate this change.
- **Files / surfaces checked:**
  - `.github/actions/change-scope/action.yml`
  - Every scope step and gated step in `ci-fast.yml` and `ci-full.yml` (job ids checked against `ALWAYS_RUN_JOBS`)
  - `scripts/ci/lib/workflow-gates.mjs`: `proveScopeStep`, `workflowEnvKeys`, `SCOPE_ACTION_SHA256`, `ALWAYS_RUN_JOBS`, the duplicate-step-key refusal, the change to step-level scoping
  - `classify-change.mjs`, `review-models.mjs` and `check-policy.mjs` diffs
  - The probes: `change-scope.test.mjs`, the new `check-policy-end-to-end.test.mjs`, `security-model-exact.test.mjs`, `review-models.test.mjs`, `check-visual-scope.test.mjs`
  - The ci-cd.md § Applicability text
  - REPORT 2 in `docs/07-planning/security-reviews/616-policy-enforcement-round4-opus.md`
- **Checks actually run:**
  - **Round-4 report:** REPORT 2 matches the report I returned line for line, so I confirm it as byte-identical. Its recorded sha256 `ead8e704…` equals the sha256 of lines 114–237 of the note with no trailing newline.
  - **Baseline:** 93/93 tests pass across the five probe and test files.
  - **workflow-gates mutations** — all went red:
    - exempting job-level conditions for scoped steps;
    - dropping the digest check;
    - dropping `ALWAYS_RUN_JOBS`;
    - allowing extra scope-step keys;
    - dropping the job env check, and separately the workflow env check;
    - letting the scope step come after the gate;
    - allowing two scope steps;
    - dropping the `uses` check;
    - dropping the duplicate step key check at its later position.
  - **workflow-gates survivor:** the duplicate-key check on a step's first line. That branch can never fire (the key map was just created), so the mutant is equivalent.
  - **Action mutations, digest pin left as is:** every edit goes red, but only because of the pin.
  - **Action mutations, digest pin re-synced** (to see whether the behaviour tests catch them):
    - red: dropping the default-branch check, dropping `::stop-commands::`, a fixed fence string.
    - survives: ignoring the classifier's exit status (still untested).
    - survives: allowing an empty default branch. Equivalent: the base-ref comparison still forces full.
  - **review-models mutations:** reading `GITHUB_BASE_REF` again goes red; removing the ASCII rule goes red.
  - **check-policy mutations:** every rule goes red (startup order, model block missing, malformed model block, missing file, anchor, link target, live state, SHA rule, PR-number rule). Two survive:
    - narrowing the order rule to only `mission > workflow`: no test covers an AGENTS.md that omits the active mission entirely;
    - dropping CLAUDE.md from the no-live-state list.
  - **Adversarial run:** about 40 step-level inputs in a scratch probe. Results below.
  - **Pre-existing check:** the composite-action test was also run with main's (3096cb04) `workflow-gates.mjs`.

## Disposition of round-4 findings
- **Blocking 1 (no test for a step-level `if` under scope gating): CLOSED.** The "exempt every level" mutant now goes red. The unproven step-condition and unproven job-condition cases are in the refused table.
- **Blocking 2 (`check:policy` had no end-to-end test): CLOSED.** The new end-to-end probe has a green control and turns red for every rule. The two survivors above are minor.
- **Non-blocking 1 (an edited action never reaches the base classifier): PARTIAL.**
  - The digest pin is in and tested.
  - But a step before the scope step can still replace the action in the workspace, so the pin can be bypassed (Blocking 1 below).
- **Non-blocking 2 (condition spellings): OPEN, low.**
  - `!= "false"` with double quotes is still accepted.
  - The bare `steps.scope…` form is accepted too. It is valid for a step `if` and means the same thing, so it is harmless.
- **Non-blocking 3 (non-ASCII labels): CLOSED.** The ASCII rule is in, and the zero-width space, NBSP and look-alike hyphen probes are red.
- **Non-blocking 4 (small test gaps): PARTIAL.** Scope-step keys are now tested. Still untested: the classifier's exit status, and a root commit inside the range.
- **Non-blocking 5 (updating the branch from main makes it full): CLOSED.** It is now documented as a known edge in ci-cd.md, with "Prefer rebasing".
- **Non-blocking 6 (what required checks report): CLOSED by the redesign.**
  - No job-level `needs` or `if` remains.
  - A cancelled run gives a cancelled job, which fails the check.
  - A failing scope step fails the job.
  - A policy-only change skips steps and the job succeeds. That last behaviour is GitHub's documented behaviour; I did not check it live.
  - The duplicate `change scope` name problem no longer exists.
- **Non-blocking 7 (fail-closed cases): informational.** I re-ran the step-level equivalents, listed below.

## Findings
**Blocking:**
1. **A9's guarantee that nothing can redirect the scope action's `git` or `node`, and that an edited action is refused, can be bypassed by shapes A9 still accepts.**
   - I confirmed the scanner accepts each of these as `scope-gated`/executed. Whether each one fools the runner is reasoned, not run live.
   - **Workflow env written as a flow mapping:** `env: { TURBO_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "--require ./evil.cjs" }`.
   - **Workflow env with a comment on the key:** `env: # inert` followed by a `NODE_OPTIONS` entry. `workflowEnvKeys` only matches `^env:\s*$`, so both forms read as "no env".
   - **A step before the scope step in the same job** that does any of these:
     - rewrites `.github/actions/change-scope/action.yml` on disk. The scanner hashes the repository's copy; the runner loads the workspace copy when the step runs;
     - writes `NODE_OPTIONS=…` to `$GITHUB_ENV`;
     - prepends a directory to `$GITHUB_PATH`;
     - is any third-party or local action.
   - **A job `container:` image**, which supplies its own `node` and `git`.
   - Each of these lets a candidate whose own diff is not policy-only skip its product gates while every machine check stays green.
   - This is the third round finding this same class of attack (head-controlled redirection of the scope mechanism). Per CLAUDE.md's review-round discipline, the fix should be structural, not more deny-list entries:
     - an allowlist: the job's steps before `id: scope` must be exactly the pinned checkout with only `fetch-depth: 0`, plus the one exact `safe.directory` step the visual job needs;
     - `container` refused unless it is the pinned, allowlisted image;
     - top-level `env` accepted only as a plain block mapping, with any other form refused;
     - each of the above as a refused-table probe.
   - The mandatory security review is still a backstop. But ci-cd.md and the A9 comment now state a guarantee the code does not provide.

**Non-blocking:**
1. **Pre-existing on main, not introduced by #616 — file it separately.** `workflow-gates.mjs` ignores the calling step's `if` when it follows a local composite action.
   - A gate inside `./.github/actions/<x>` called with `if: false`, `if: ${{ false }}` or `if: github.actor == 'x'` is classified `executes` / "runs unconditionally".
   - I reproduced this with main's 3096cb04 `workflow-gates.mjs`, so it is a fail-open in the gate scanner.
   - Under #616 it also means a gate inside a composite would bypass the scope-gated accounting.
2. **`checkout` with `with: ref: <other ref>` is accepted.** The scope action, and every gate in the job, would then come from that ref. This is the same pre-existing class for all gates; the Blocking 1 allowlist would close it here.
3. **Leftover gaps from the mutation run:**
   - the classifier's exit status is not tested once the pin is re-synced;
   - a root commit inside the range is not tested;
   - no test for an AGENTS.md startup order that omits the active mission entirely;
   - no test for live state in CLAUDE.md;
   - the duplicate-key branch on a step's first line can never fire and could be deleted.
4. **Inputs that fail closed (as expected, or at runtime):**
   - **Refused by the scanner:**
     - scope id spelled `Scope`, or quoted as `"scope"` or `'scope'`;
     - `uses: ./.github/actions/change-scope/` with a trailing slash;
     - the condition with no spaces, YAML quotes, `outputs['full']`, `'FALSE'`, or extra `success() &&` / `always() &&` atoms;
     - job `defaults`, flow-form job `env`, a quoted `NODE_OPTIONS` key;
     - an action file with a BOM; a CRLF action file makes the scanner throw.
   - **Accepted by the scanner but fail closed at runtime:**
     - no checkout step, or a checkout with `if: false`: the local action cannot be found, so the job fails.
   - **Accepted and harmless:**
     - `id: scope # comment`;
     - `uses:` written before `id:`.

## Verdict
BLOCKED

<!-- END REPORT 2 -->

<!-- BEGIN REPORT 3 (agent a399c1abbc5121183; candidate 3446fac5f28f0dbb49d7b0c9eb898a5fec9a5ce0; sha256 8c34928782cf37accec8c737225e2b5cbf856684cbabc6effc93900a491852c2) -->

# Independent security review — #616 delta 7e8ab217..3446fac5
- **Exact candidate reviewed:** 3446fac5f28f0dbb49d7b0c9eb898a5fec9a5ce0
- **Comparison base:** 7e8ab21792c85fd8b40480b22bcc01f908c6bd25. The delta is cbd27f24 (round-4 review note) plus 3446fac5 (fix batch); 19 files.
- **Reviewer / model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh Agent-tool context (general-purpose, not forked), role: security reviewer; did not author, direct or remediate. This review cannot be the qualifying security review for #616: the merge base has no model list, so only `GPT-6 Sol` is accepted.
- **Files / surfaces examined:**
  - `.github/actions/change-scope/action.yml`, `.github/workflows/ci-fast.yml`, `ci-full.yml`
  - `scripts/ci/lib/workflow-gates.mjs` (step-level A9, `ALWAYS_RUN_JOBS`, environment allowlist, SHA-256 pin, duplicate step-key refusal)
  - `scripts/ci/classify-change.mjs`, `lib/review-models.mjs`, `check-pr-template.mjs`, `check-policy.mjs`, `check-visual-scope.mjs`
  - all new and changed probes, `docs/04-engineering/ci-cd.md` § Applicability
  - `docs/07-planning/security-reviews/616-policy-enforcement-round4-opus.md`
  - live CI runs at 3446fac5: 37951195041, 37951023855, 37951023958
- **Checks actually run:**
  - **Full CI-scripts suite at 3446fac5:** 1166 tests, 1164 pass. The 2 failures are the same environmental `typecheck-coverage` ones as round 4 (no `tsc` in the scratch worktree).
  - **Targeted suites, 10 files:** 371/371 pass (change-scope, check-policy-end-to-end, security-model-exact, review-models, check-policy, workflow-gate-drift, atomic-gate-proof, workflow-alias-table, check-visual-scope, security-scope-shrink).
  - **Base probes:** atomic-gate-proof, workflow-alias-table and workflow-gate-drift at 3096cb04 pass 120/120 with the candidate's `workflow-gates.mjs` swapped in.
  - **Round-4 probes:** the same three at 7e8ab217 pass 108/120 with the candidate scanner. All 12 failures are GREEN controls on the round-4 `needs: scope` workflows, which the scanner now refuses ("declares `needs`"). That is stricter, not weaker, and every RED probe passes.
  - **11 scratch A9 probes of my own** (results below).
  - **The action script run locally:**
    - With a newline-bearing file path, the path comes out JSON-escaped, the log is fenced by a random `::stop-commands::` token, and `full=true` is written.
    - With a non-default `BASE_REF`, the answer is `full`.
  - **Live CI read (read-only).**
  - **Byte comparison of REPORT 3** against my returned text.
  - All scratch worktrees were removed; the shared repo's branch is unchanged.

## Disposition of round-4 findings
1. **Base branch selects the classifier and model list — CLOSED for this mechanism.**
   - The action answers `full` unless `BASE_REF` equals the event's default branch. Verified by running the script.
   - `review-models.mjs` refuses any target other than `main`.
   - The older, separate weaknesses remain and are named in ci-cd.md "Known edges": retargeting to a branch with a gutted workflow, and required checks not pinned to a source app in the ruleset.
2. **Cancellation leaving checks skipped — CLOSED.**
   - There are no job-level `needs` or conditions any more; every gated job starts.
   - Verified live: run 37951023958, cancelled through the `edited` concurrency group, shows its in-flight gated jobs (`static`, `unit + component`) as `cancelled`, which is red.
   - A failing scope step fails the job, because later steps keep the implicit `success()`. This follows from Actions semantics and the step layout; I reasoned it rather than observed it.
   - Re-running a single job re-runs its scope step too (reasoned, standard semantics).
3. **A9 proof incomplete — PARTIAL.**
   - Now refused: scope-step `env`, `with` or `working-directory`; job-level `env`; workflow block-style `env` beyond the two inert variables; a tampered action (SHA-256 pin, which I verified matches the shipped file); job `defaults`; self-hosted runners.
   - Still accepted (see non-blocking item 1).
4. **Workflow-command injection through file names — CLOSED.** Verified: paths are JSON-escaped and the log is fenced by a random token.
5. **No limit on which jobs may be gated — PARTIAL.** `ALWAYS_RUN_JOBS` refuses the five always-run jobs, but it is keyed by job id. A renamed id that keeps the ruleset's display name is accepted (verified; see non-blocking item 2).
6. **Red product checks on main hidden on policy-only PRs — CLOSED (documented).** ci-cd.md "Known edges" now says it.
7. **Dependence on strict up-to-date — CLOSED (documented).** The "update with a merge commit makes it full" edge is documented too.
8. **Candidate not merge-ready — OPEN (not security).** At 3446fac5:
   - `registers` fails on `check:policy` (`active-mission.md` and the model block are missing; it depends on the sibling PR);
   - the PR-template check fails;
   - dependency audit is red.
   - `static` is green now.

**REPORT 3 identity: CONFIRMED.** Lines 243–332 of `616-policy-enforcement-round4-opus.md`, without a trailing newline, are byte-identical to the report I returned. Its SHA-256 is `5e36c811c5615ccacda07283e13a6a13167eaf7b894c4c93883f9f8e2c56fc48`, which matches the marker on line 241.

## Findings
**Blocking:** None.

**Non-blocking:**

1. **A9 still cannot prove `git` and `node` are not redirected.** (`workflow-gates.mjs` `proveScopeStep`/`workflowEnvKeys`; ci-cd.md § Applicability, "no job- or workflow-level environment that could redirect the action's `git` or `node`")
   - My scratch probes found these all still counted as `scope-gated`:
     - an earlier step in the same job writing `PATH` or `BASH_ENV` to `$GITHUB_ENV`, or writing to `$GITHUB_PATH`;
     - an earlier local action;
     - a job `container:` with its own `env:` or an arbitrary `image:`;
     - a flow-style workflow env, `env: { PATH: ./bin }` (`workflowEnvKeys` only matches block style);
     - a checkout `ref:` override, or no checkout at all.
   - Every one of these needs a `.github/**` edit, so it falls under security review. In the shipped workflows only a pinned checkout and, in the visual job, a `git config safe.directory` step come before the scope step; neither writes the environment.
   - The doc sentence overclaims.
   - *Fix:* allow only a SHA-pinned `actions/checkout` (and the exact visual `safe.directory` step) before the scope step; refuse a job `container` other than the pinned visual image; parse flow-style `env`; or reword the doc.

2. **The always-run list can be sidestepped by renaming a job id.** (`workflow-gates.mjs`, `ALWAYS_RUN_JOBS`)
   - Verified: a job with id `regs` and the display name "registers - env, vocabulary, reviews, skips, overrides" can be scope-gated.
   - *Fix:* key the list on the ruleset display names, or refuse scope-gating any step that runs the always-run gates (`check:pr-template`, `check:policy`, `check:reviews`, `test:ci-scripts`, `test:all`, gitleaks).

3. **The SHA-256 pin is a tripwire, not a boundary.** The PR controls both the action file and the scanner holding the pin. ci-cd.md states this honestly; I note it only so a green A9 is not read as proof the action is untampered.

## Residual risk
**Verified:**
- Bootstrap runs in full: live log says "no classifier at merge base 3096cb04…: full".
- A non-default base answers `full`.
- Path names are escaped and fenced.
- A cancelled run's in-flight gated jobs report `cancelled`.
- No previously refused shape is accepted.
- Round-4 `needs` shapes are now refused.
- The action digest matches its pin.
- The visual job's scope step ran inside the Playwright container.
- The REPORT 3 bytes match.

**Reasoned only:**
- A failing scope step fails the job (implicit `success()` on later steps).
- Re-running a single job re-runs its scope step.
- Each job reaches the same answer independently, since the merge-base classifier is deterministic for a given head.

**Out of this PR's reach:**
- A write-token holder can still satisfy required checks without real runs: required checks are not pinned to a source app in the ruleset, and a PR can be retargeted to a branch with a gutted workflow.
- Changes to workflows or the composite action rely on security review.
- The redesign does not raise that ceiling. Items 1–2 are about A9's claims, not about anything the shipped workflows expose.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 3 -->
