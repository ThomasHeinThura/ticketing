# 616 — policy enforcement: round-4 independent reviews (Opus 5.5)

- **Reviewer contexts:** fresh Claude Code Agent-tool subagents (`subagent_type: general-purpose`, not forked, model inherited: `claude-opus-5-5`), parent session `412b91f1-99f8-4ac2-8f5c-a03dce507862`. None authored, directed or remediated the change.
- **Transport:** each report is the reviewer's final message, extracted mechanically from its subagent transcript and inserted unmodified between the markers, with its SHA-256. A hash identifies bytes; it does not prove independence or approval.

<!-- BEGIN REPORT 1 (agent a34879707b9e889e2; candidate 7e8ab21792c85fd8b40480b22bcc01f908c6bd25; sha256 c7bb68090638663201a014a231e4c0f3ebc3ca486d9859deee95b53a3ee7fb18) -->

# Independent ordinary review — #616 correctness
- **Exact candidate reviewed:** 7e8ab21792c85fd8b40480b22bcc01f908c6bd25
- **Comparison base:** 3096cb044bdf6ae98488bfc385f532fa6386343a
- **Reviewer / model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh Agent-tool context (general-purpose, not forked), did not author or remediate
- **Files / surfaces checked:**
  - `scripts/ci/classify-change.mjs`
  - `.github/actions/change-scope/action.yml`
  - `.github/workflows/ci-fast.yml` and `ci-full.yml`
  - `scripts/ci/lib/review-models.mjs`, plus the `check-pr-template.mjs` diff
  - `scripts/ci/check-policy.mjs` and its test
  - A9 in `scripts/ci/lib/workflow-gates.mjs`
  - `check-visual-scope.mjs` pin, `test-all.mjs`, `package.json`
  - `docs/04-engineering/ci-cd.md` (Applicability section, model wording, merge method, security path list)
  - CODEOWNERS and PR-template diffs
  - `scripts/ci/probes/change-scope.test.mjs`
- **Checks actually run:**
  - **Full `node --test 'scripts/ci/**/*.test.mjs'`:**
    - Candidate: 1142 tests, 118 suites, 1139 pass, 3 fail.
    - Main: 1078 tests, 112 suites, 1076 pass, 2 fail.
    - Failing on both: two typecheck-coverage tests ("every covered tree is fully present…" and "an exemption that is no longer needed FAILS…"). Cause: `tsc` ENOENT.
    - Failing on the candidate only: "RED — set +eu", from an ENOENT race on `contrast-alias-caller-*.tsx`. Run alone, `atomic-gate-proof.test.mjs` passes 52/52.
  - **Changed or new test files run alone, all passing:**
    - change-scope 38/38
    - security-model-exact 18/18
    - review-models 9/9
    - check-policy 4/4
    - check-visual-scope 154/154
    - workflow-gate-drift 55/55
    - workflow-alias-table 13/13
    - security-scope-shrink 4/4
  - **`node scripts/ci/test-all.mjs --list`:** exit 0, and `pnpm check:policy` is listed as enabled.
  - **Classifier, 14 scratch-repo scenarios.** Inputs: a path containing a newline, an empty range, product change then revert, exec bit, symlink, rename into planning, a delete, merging main in, `-s ours` merge of a product branch, a png in planning, `.MD`, a bad base, a missing argument, and a merge of two policy-only branches. Every result matched the code's intent and failed closed.
  - **Workflows parsed with PyYAML.**
    - The `scope` job has no `if` or `needs` in either workflow.
    - All 8 product jobs in ci-fast and all 5 in ci-full carry `needs: scope` and the exact canonical `if`.
    - `registers` (which includes `check:policy`), `pull-request`, `ci-scripts`, `secret-scan` and `gates-declared` stay unconditional.
  - **Security path list:** parsed with `parseSecurityReviewPaths`. It includes `docs/04-engineering/agent-workflow.md` and still includes `.npmrc` and `.pnpmfile.cjs`.
  - **A9:** 16 extra adversarial shapes through the probe harness. Results are under F5.
  - **`check:policy` on the candidate:** 5 expected failures, because #615 is absent.
  - **`check:policy` from a path containing a space:** exit 0 with no output (see F2).

## Findings
**Blocking:**
- **F1 — Cancelling a run can turn the product gates green (not yet verified live; becomes non-blocking if a live test disproves it or a mitigation lands).**
  - **Mechanism.** Each gate job now waits on `scope` and has `if: ${{ !cancelled() && … }}`.
    - If the workflow run is cancelled before the gate jobs are evaluated, `!cancelled()` is false.
    - The jobs are then skipped by their condition. GitHub counts a skipped job as passing a required check.
    - Before this PR, gate jobs started straight away, and a cancel left them `cancelled` (failing).
  - **ci-fast** is mostly covered: its unconditional required jobs (`registers`, `ci-scripts`, …) would also be cancelled and fail.
  - **ci-full** has no unconditional sibling.
    - It also re-runs on `labeled` with `cancel-in-progress: true` for the same head SHA.
    - So adding a label while `scope` is running can leave integration, e2e, G4, G8 and G11 showing as skipped (green) on the head until the new run's jobs register.
    - A manual cancel can leave them that way indefinitely.
  - **Doc contradiction.** If this holds, it contradicts ci-cd.md's line "A required check is never turned green by anything but its own run or this classification". It also breaks the repo's own A7b rule that NOT PROVEN means refuse.
  - **What GitHub does here was not confirmed.** Specifically: what conclusion a dependent job that never started gets in a cancelled run.
  - **Downgrade path:**
    - either a live experiment showing those jobs conclude `cancelled`, not `skipped`;
    - or a mitigation: make the scope job a required status check (with distinct job names per workflow, since both are named `change scope` today), or keep an unconditional required job in ci-full.

**Non-blocking:**
- **F2 — `check:policy` can silently check nothing.**
  - Its entry guard `import.meta.url === \`file://${process.argv[1]}\`` is false when the path needs URL encoding, for example a space.
  - In that case the script exits 0 without running any check. I confirmed this.
  - CI paths have no spaces, so CI is not affected today.
  - Other repo scripts use `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])`.
- **F3 — ci-cd.md overstates what a merge does.** It says "a merge … make[s] the change full".
  - In fact a merge of two policy-only branches stays `policy`.
  - What does make it full is merging main into the branch (for example GitHub's "Update branch" merge commit), because the merge's diff against the PR-side parent brings in main's product changes.
  - So in practice, policy-only PRs kept up to date by merge commit will always run the full suite. The doc should say "a merge that brings in any non-policy change, including updating from main", and recommend updating by rebase.
- **F4 — `check:policy` helper gaps.**
  - `slugify` strips `_`, but GitHub's slugger keeps underscores. A correct `#a_b` link gets flagged, and a broken `#ab` link passes.
  - `linksOf` misses links that have a title (`[a](x.md "t")`).
  - `liveStateIn` misses one-digit `#N` and short SHAs.
- **F5 — A9 accepts some shapes beyond the documented "exact shape".**
  - **Bare condition.** It accepts the condition without `${{ }}`, because the existing `normaliseCondition` treats the two forms as equal. Bare, `!cancelled()` is read by YAML as a tag. The likely outcome is an invalid workflow, which fails closed.
  - **Checkout options.** It does not constrain the scope job's checkout `with:` options (`repository:`, `ref:`, `path:`). A probe with `repository: evil/repo` was accepted as scope-gated.
  - **Composite action.** No check pins the composite action's contents.
  - These sit inside the residual ci-cd.md already documents (workflows and actions run from the PR; `.github/**` is security-scope). They are worth naming for the security reviewer.
  - **Everything else was refused, as it should be:** `== 'true'`, a missing `!cancelled()`, `||`, a list or other `needs`, quoted `needs`, a step-level fail-open `if`, a scope job with `if`/`needs`/`env`/`strategy`/`continue-on-error`/self-hosted runner, extra outputs, a hardcoded or wrong-step output, a `with:` or `continue-on-error` on the classify step, an extra step, a `run` step, an unpinned checkout, a duplicate job `if`, and an `if:` hidden after a column-0 comment.
- **Verified correct:**
  - **Classifier:** `-z` parsing, `--no-renames`, per-parent merge charging, root-commit, empty-range and bad-base handling, and the mode allowlist.
  - **Composite action bash:**
    - `set +e`, defaults to `full=true`, exact match on `policy`, and `status=$?` captured from the command substitution.
    - `GITHUB_OUTPUT` is written once, quoted.
    - Any non-`pull_request` event (push, merge_group, workflow_dispatch) gives `full=true`.
  - **review-models parser:** exactly one block required; empty, padded or duplicate labels and malformed lines are refused; legacy `GPT-6 Sol` is used only when the block is absent.
  - **Other ci-cd.md statements match the implementation:** the lists of what runs and what is skipped, the merge-base model list, the bootstrap behaviour, and squash-merge wording.
  - **CODEOWNERS:** the removed `/.claude/agents/` entry pointed at a path that exists on neither main nor the candidate.

## Verdict
BLOCKED. Only F1 blocks. It clears with either a live demonstration that a cancelled run does not leave the scope-gated required checks skipped, or a mitigation such as a required scope check or an unconditional required job in ci-full. Everything else is non-blocking.

## Not checked
- Real GitHub behaviour: cancellation conclusions, `pull_request` checkout refs and fork PRs. No live runs were made.
- The protect-main ruleset's actual required-context list.
- Runtime behaviour together with #615. `check:policy` and an Opus security review on this candidate fail without #615, as expected.
- Security-depth threat modelling beyond correctness. That is the Sol reviewer's job.
- `secret-scan` and `gates-declared` job internals.
- `security-model-exact.test.mjs` and `review-models.test.mjs` were run but not read line by line.

My worktrees (`$TMPDIR/616a`, `$TMPDIR/616main`) were removed; the incremental findings are in `$TMPDIR/616-ordinary-a.md` (`/private/tmp/claude-501/616-ordinary-a.md`).

<!-- END REPORT 1 -->

<!-- BEGIN REPORT 2 (agent a32abc363efeeecbd; candidate 7e8ab21792c85fd8b40480b22bcc01f908c6bd25; sha256 ead8e704ac304287a11cc9b1abe437e1cbaa5a083e531922bc2c548181bcb881) -->

# Independent ordinary review — #616 test adequacy
- **Exact candidate reviewed:** 7e8ab21792c85fd8b40480b22bcc01f908c6bd25
- **Comparison base:** 3096cb044bdf6ae98488bfc385f532fa6386343a
- **Reviewer / model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh Agent-tool context (general-purpose, not forked). I did not author or remediate this change.
- **Files / surfaces checked:**
  - `scripts/ci/classify-change.mjs` and `.github/actions/change-scope/action.yml`
  - `scripts/ci/lib/workflow-gates.mjs` (A9, `proveScopeJob`, `SCOPE_CONDITION`, `scopeGated`, the duplicate-job-key refusal, `normaliseCondition`)
  - `scripts/ci/lib/review-models.mjs` and `scripts/ci/check-policy.mjs`
  - The `check-pr-template.mjs`, `check-visual-scope.mjs`, `ci-fast.yml` and `ci-full.yml` diffs
  - The tests: `change-scope.test.mjs`, `security-model-exact.test.mjs`, `review-models.test.mjs`, `check-policy.test.mjs`, and the new case in `check-visual-scope.test.mjs`
  - Live PR #616 body and checks, plus a grep confirming no scope-gated job reads policy or planning Markdown.
- **Checks actually run:**
  - **Baseline:** the four main test files pass, 69/69 (node 26.10). `node scripts/ci/check-policy.mjs` at head exits 1 (no active mission, no model block). The PR body says this is expected until #615 lands.
  - **How mutations were run:** in a scratch worktree, then reverted. "Red" means at least one test failed; "survives" means none did.
  - **Classifier:** these went red:
    - treating any `.md` as policy;
    - dropping the mode check;
    - judging the net tree instead of landed commits;
    - letting an empty range pass;
    - accepting non-Markdown files under the planning prefix.
  - **Classifier survivors:**
    - dropping `--no-renames` (equivalent: `diff-tree` does no rename detection by default);
    - skipping a root commit instead of throwing;
    - checking only the first parent of a merge.
  - **Composite action:** these went red:
    - running the HEAD copy of the classifier;
    - matching `policy` with `grep` instead of exactly;
    - defaulting to `full=false`;
    - answering `false` when there is no base or no classifier at the base.
  - **Composite action survivors:**
    - ignoring the classifier's exit status;
    - using the `origin` tip instead of the merge base (equivalent: same commit range, trusted copy either way).
  - **workflow-gates (A9):** these went red:
    - dropping `!cancelled()` from the condition;
    - allowing extra keys on the scope job;
    - accepting any output on the scope job;
    - ignoring the scope-job proof;
    - allowing duplicate job keys.
  - **workflow-gates survivors:**
    - not checking the scope job's `runs-on`;
    - not checking forbidden step keys inside the scope job;
    - **W8: exempting step-level conditions as well as the job-level one for scope-gated jobs.** It survives every test in `scripts/ci/probes/`.
  - **review-models:** these went red:
    - reading the model list from HEAD;
    - taking the union of base and HEAD;
    - falling back to the legacy model when the base list is malformed;
    - removing the duplicate check;
    - removing the padding check.
  - **check-policy `main()`:** all of these survive:
    - removing the startup-order rule;
    - removing the "model block missing" rule;
    - letting a missing policy file pass silently;
    - removing the anchor check.
  - **check-visual-scope:** weakening the expected visual-job condition line goes red, so the new fail-open test is real.
  - **Adversarial run:** about 40 hand-made inputs, results below.

## Findings
**Blocking:**
1. **No test covers a step-level `if` on a gate step inside a scope-gated job.**
   - The code is correct today: such a step is refused as `unknown-condition`.
   - But mutant W8 changes `!(scoped && level === "job")` to `!scoped`, and then `if: ${{ github.event_name == 'push' }}` (or `github.actor == 'nobody'`) on the gate step counts as executed.
   - Every test in `scripts/ci/probes/` stays green under that mutant.
   - So a one-token edit would silently turn this protection fail-open. This is the "step-level `if` combined with scope gating" case the owner asked for.
   - Fix: add an unproven step-level `if` (not literal `false`, which is caught by an earlier branch) to the `refused` table in `change-scope.test.mjs`.
2. **`check:policy` has no end-to-end test, only tests of its helpers.**
   - Rule 3 (active mission read before the workflow), rule 4 (exactly one model block present), the missing-policy-file failure and the anchor-resolution loop can each be deleted with no test going red.
   - Rule 4 is the model-policy validator the owner explicitly asked to have positive and adversarial tests for.
   - The real repository cannot serve as the positive case until #615 merges, so a scratch-repo test is needed. Two or three scenarios would do it:
     - a coherent policy set passes;
     - no model block fails;
     - the mission listed after the workflow fails;
     - a broken anchor fails.

**Non-blocking:**
1. **An edited composite action never reaches the base classifier.**
   - The PR body says the workflow and action "are on the security path list, and the base classifier answers full for them". That is only true while the action still calls the classifier.
   - If a PR rewrites `.github/actions/change-scope/action.yml` to `echo full=false`, A9 still proves `scope-gated`/executed (I confirmed this). All 13 product gate jobs would then skip. Changing the scope job's `checkout` to point at another ref has the same effect.
   - The only remaining protection is the mandatory security review. This is the same threat model as editing any head-run checker, but it needs just one small file. Suggested fixes:
     - pin the action's content in A9, as `check-visual-scope` does for the visual job;
     - or add a job that always runs and re-derives the answer from the base copy;
     - and correct the residual wording in the PR body.
2. **A9 accepts two condition spellings GitHub probably reads differently.**
   - A bare `if: !cancelled() && …` without `${{ }}` (in YAML a leading `!` is a tag).
   - `!= "false"` with double quotes.
   - `normaliseCondition` strips `${{ }}` and rewrites `"` to `'`. GitHub most likely rejects both as an invalid workflow, which fails closed (no checks report, so the PR is blocked). Unverified.
3. **The model-label parser accepts invisible or non-ASCII characters.** Zero-width space, NBSP and a U+2011 hyphen homoglyph all pass, so two labels that look identical can coexist. The parser also accepts a BOM, CR-only line endings, and a block inside a ``` fence. The list is trusted once merged, but an ASCII-only label rule is cheap.
4. **Small test gaps that are currently safe for other reasons:**
   - Root commit inside the range: the merge-base step and per-parent diffs catch it in practice.
   - A classifier that prints `policy` but exits non-zero: the base classifier is trusted.
   - `runs-on` and step keys in the scope job are not tested: a step `if` or `continue-on-error` only empties the output, so gates still run.
5. **Updating a policy-only PR from `main` makes it full forever.** If `main` gained a product change and the PR's branch is updated (GitHub's "Update branch"), the merge commit is charged against its PR-side parent. The classifier then answers full permanently (confirmed). This fails closed, so it costs time, not safety. The behaviour is untested and undocumented.
6. **What required checks report.** None of this was verifiable locally.
   - **A job skipped by its `if`:** reports as successful and satisfies a required check. This is the intended mechanism; from GitHub's documentation, not verified here.
   - **`scope` fails or times out:** the output is empty and `!cancelled()` is true, so the gates run. This is correct by reasoning.
   - **The whole run is cancelled while `scope` is still running:** the waiting gate jobs get a false condition. I could not confirm whether GitHub then marks them "skipped" (which would count as passing) or "cancelled".
     - If "skipped", this is a regression from today, where cancelled gate jobs fail the check.
     - Suggested fix: make `change scope` itself a required context.
     - That needs distinct names first: both workflows currently name the job `change scope`, so one required context with that name is ambiguous.
   - **A workflow file GitHub rejects:** reports nothing, so required checks stay pending and the PR is blocked (fail-closed).
7. **Adversarial inputs that correctly fail closed:**
   - **A9 refused:**
     - `needs: [scope]`, `needs: "scope"`, or `needs` as a block list;
     - the scope job declared twice;
     - the scope job on a `self-hosted` runner, with a condition on its `classify` step, or with `env` on the job;
     - `if` written with swapped terms, uppercase `'FALSE'`, no spaces, YAML quotes, a block scalar or a trailing comment;
     - a workflow that only triggers on `push`.
   - **Classifier answered full:**
     - a submodule at `docs/07-planning/x.md`;
     - `docs/07-planning/x.md/evil.ts` (a directory named like a Markdown file);
     - a head that is an ancestor of the base;
     - unrelated histories;
     - `docs/07-planning/.gitattributes`.

## Verdict
BLOCKED

## Not checked
- Real GitHub behaviour for a cancelled run, a job timeout, and a skipped dependent job as a required context. All of point 6 is unverified.
- Whether GitHub rejects the bare-`!` and double-quoted conditions.
- Whether the policy file set and `ci-cd.md` § Applicability match #615.
- Full `pnpm test:ci-scripts`: I relied on the PR's reported 1,140/1,142 plus my targeted runs.
- Deployment and image impact.

Scratch worktree `$TMPDIR/616b` has been removed. Incremental notes are in `$TMPDIR/616-ordinary-b.md`.

<!-- END REPORT 2 -->

<!-- BEGIN REPORT 3 (agent a399c1abbc5121183; candidate 7e8ab21792c85fd8b40480b22bcc01f908c6bd25; sha256 5e36c811c5615ccacda07283e13a6a13167eaf7b894c4c93883f9f8e2c56fc48) -->

# Independent security review — #616
- **Exact candidate reviewed:** 7e8ab21792c85fd8b40480b22bcc01f908c6bd25
- **Comparison base:** 3096cb044bdf6ae98488bfc385f532fa6386343a (merge base equals base main)
- **Reviewer / model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh Agent-tool context (general-purpose, not forked), role: security reviewer; did not author, direct or remediate.
  - **Gate note:** under this PR's own merge base there is no model block, so only `GPT-6 Sol` is accepted. Live CI already refuses "Claude Opus 5.5" for #616. This review cannot satisfy the required security-review gate for #616. It is evidence only, and a GPT-6 Sol review is still required.
- **Files / surfaces examined:** the full diff (25 files). In depth:
  - `.github/actions/change-scope/action.yml`, `.github/workflows/ci-fast.yml` and `ci-full.yml` (triggers, `scope` job, job conditions, which jobs stay unconditional)
  - `scripts/ci/classify-change.mjs`, `scripts/ci/lib/review-models.mjs`, `lib/git-baseline.mjs` (`resolveMergeBase`), `lib/diff.mjs`
  - `scripts/ci/check-pr-template.mjs`, `check-policy.mjs`, `lib/workflow-gates.mjs` (A9, duplicate-key refusal), `check-visual-scope.mjs`
  - every new or changed probe and test, `docs/04-engineering/ci-cd.md` § Applicability and the security-path list, CODEOWNERS
  - live GitHub, read-only: PR #616 state, CI runs 37947693756 and 37947693826 with job conclusions and failure logs, the `protect-main` ruleset
- **Checks actually run:**
  - **Full CI-scripts suite at the candidate:** 1142 tests, 1140 pass. The 2 failures are in `typecheck-coverage` and are environmental: there is no `apps/api/node_modules/.bin/tsc` in the scratch worktree.
  - **Targeted suites:** 343/343 pass (change-scope, security-model-exact, review-models, check-policy, workflow-gate-drift, atomic-gate-proof, workflow-alias-table, check-visual-scope).
  - **Regression check on A9:** I ran the base's own workflow probes (atomic-gate-proof, workflow-alias-table, workflow-gate-drift) against the base workflows with the candidate's `workflow-gates.mjs` swapped in. 120/120 pass, so nothing the scanner refused before is accepted now.
  - **My own scratch A9 probes:** a `PATH` env override on the classify step, a workflow-level `PATH` env, a step `working-directory`, a checkout `ref:` override, `needs: scope # comment`, and the `'FALSE'` spelling of the condition.
  - **Classifier with a newline-bearing filename:** it prints attacker-chosen `::set-output` and `::warning::` lines verbatim.
  - **Model-list parser edge cases:** CRLF, NBSP, zero-width characters, a block inside an HTML comment or code fence, `*` bullets.
  - **Ruleset read via `gh api`.**
  - The scratch worktrees were removed afterwards. A `git worktree prune` I ran was denied by the sandbox for other sessions' stale entries and changed nothing. The shared repo's checked-out branch is unchanged.

## Findings
**Blocking:** None.

**Non-blocking:**

1. **The PR's chosen base branch decides which classifier and which model list are trusted.** (`action.yml:20,32`; `lib/git-baseline.mjs:48-50`; `ci-full.yml:17`)
   - *Exploit (reasoned, not run on GitHub):* the `pull_request` triggers have no branch filter, and `ci-full` does not run on `edited`, so changing the PR's base branch does not re-run it.
     - Push branch `x` whose tip edits `classify-change.mjs` to always answer `policy`. Head `H` builds on `x`, reverts that edit, and adds a product change, so the net diff against main shows only the product change.
     - Retarget the PR to `x` and add a label. The labeled `ci-full` run takes the classifier from `x` and skips integration, E2E, G4, G8 and G11 on head `H`.
     - Retarget back to main. Only `ci-fast` re-runs, so the skipped `ci-full` results stay the latest on `H`.
   - This uses PR metadata (the base branch) to classify, which the owner's constraint forbids.
   - *Not new in power:* the same trick already works with a gutted workflow on `x`. Also, the ruleset's required checks have no integration_id/source pin, so a commit status posted through the API already satisfies any required context.
   - *Fix:* answer `full` unless `BASE_REF` is the default branch. Read the model list from `origin/<default branch>` rather than `GITHUB_BASE_REF`. Separately, consider pinning the required checks to GitHub Actions in the ruleset.

2. **Cancelling a run can leave the product checks reported as skipped (GitHub behaviour not verified).** (`ci-fast.yml:52`, `ci-full.yml:35`, `ci-cd.md:554`)
   - If the run is cancelled while `scope` is still running, `!cancelled()` is false and the gated jobs do not run. They likely conclude as `skipped`, which counts as satisfied.
   - If someone then re-runs only the unconditional jobs one by one, all 18 required checks can show green.
   - The comments ("a failed, cancelled-mid-way … answer still runs them") and ci-cd.md ("never turned green by anything but its own run or this classification") overclaim.
   - *Fix:* test it empirically, then correct the wording. A sound option is a final, required "verdict" job that checks the gated jobs' results explicitly.

3. **A9's "canonical scope job" proof is incomplete.** (`workflow-gates.mjs:139,180`)
   - It accepts these on the classify step or workflow: an `env:` override such as `PATH` (pointing it at checked-out PR files would replace `node` and `git`), a workflow-level `env`, `working-directory`, and a checkout `with: ref:`.
   - It never checks what `change-scope/action.yml` contains, so a PR can rewrite the action itself.
   - These need a `.github/**` edit and so fall under security review, which ci-cd.md states honestly. Still, a green A9 does not prove the wiring is canonical.
   - *Fix:* refuse any scope-step key other than `uses`, `id`, `name` and checkout `with.fetch-depth`; refuse workflow-level `env`/`defaults` that touch the scope job; pin the action file by hash.

4. **Filenames can inject workflow commands.** (`classify-change.mjs:137`, `action.yml:40,51,53`)
   - Path names go to stdout unescaped, and the action echoes the verdict. A product file named with an embedded `\n::set-output name=full::false` reaches the runner as a command, with no security-path change needed.
   - I verified the classifier emits the line. My reasoning says the `GITHUB_OUTPUT` file is processed after stdout commands, so `full=true` wins, but I did not verify that. Annotation spoofing does work.
   - *Fix:* JSON-escape paths in the reason, or wrap the echo in `::stop-commands::<random token>`.

5. **Nothing limits which jobs may be scope-gated.** (`workflow-gates.mjs:106`)
   - A later change could gate `registers` (check:policy, check:reviews), `pull-request` (the security-review check), `ci-scripts`, `gates-declared` or `secret-scan`, and A9 would accept it.
   - *Fix:* keep an explicit list of jobs that must always run, and refuse `needs: scope` on them.

6. **Red product checks on main stop surfacing on policy-only PRs.**
   - The dependency audit is red right now at this candidate: 1 critical and 3 high advisories, coming from main's lockfile.
   - After merge, policy-only PRs will merge with it skipped. That is defensible (the PR cannot change it), but § Applicability should say so explicitly.

7. **The design depends on the "branch must be up to date" rule being on.**
   - The classifier comes from the PR's fork point; the model list comes from the base tip. They match at merge time only because strict up-to-date is on, which I verified in the ruleset.
   - A PR updated with a merge commit (the default "Update branch" button) is classified full. That fails closed but is worth documenting.

8. **The candidate is not merge-ready at this SHA**, independent of security:
   - `check:policy` fails because `active-mission.md` and the model block are missing, so it depends on an unmerged sibling PR.
   - The PR-template check fails: the model is refused and the review note is not committed.
   - `static` (biome lint) and dependency audit are red.

## Residual risk
**Verified:**
- The classifier is taken from the merge base, and a PR's own edit of it is ignored.
- Reverted product commits, merges, renames, symlinks, executable bits, submodules, root commits, empty ranges and crashes all classify as full.
- The PR introducing the classifier ran fully (every gated job ran on #616).
- Model self-approval is refused, and a missing list at the merge base falls back exactly to `GPT-6 Sol`.
- The duplicate job-key refusal works, and no shape the scanner refused before is now accepted.
- No gated job reads a policy-path document as input (grep-level check).
- `pnpm-lock.yaml`, `package.json`, `.github/**`, `scripts/**` and `ci-cd.md` classify as full, and `agent-workflow.md` is added to the security-path list.

**Reasoned only:**
- that GitHub reuses check runs across a base-branch change and cancellation produces `skipped` (items 1 and 2)
- precedence between the output file and stdout commands (item 4)
- `cancelled()` semantics when only the `scope` job times out

Against an adversary holding a write token, the workflow-level arguments are bounded by the pre-existing weaknesses: unpinned required-check sources, retargeting the PR to another base, and the PR's own copy of the workflows running. This PR does not raise that ceiling, but items 1–3 should be closed or documented as known.

## Verdict
CLEAR WITH NON-BLOCKING

The full notes are in `/tmp/claude-501/616-security.md`.

<!-- END REPORT 3 -->
