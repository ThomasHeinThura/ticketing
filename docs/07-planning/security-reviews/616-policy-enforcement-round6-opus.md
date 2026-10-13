# 616 — policy enforcement: round-6 independent delta reviews (Opus 5.5)

- **Reviewer contexts:** fresh Claude Code Agent-tool subagents (`subagent_type: general-purpose`, not forked, model inherited: `claude-opus-5-5`), parent session `412b91f1-99f8-4ac2-8f5c-a03dce507862`. None authored, directed or remediated the change.
- **Transport:** each report is the reviewer's final message, extracted mechanically from its subagent transcript and inserted unmodified between the markers, with its SHA-256. A hash identifies bytes; it does not prove independence or approval.

<!-- BEGIN REPORT 1 (agent a32abc363efeeecbd; candidate c3685d9d404ecffb6f2c8b048b0f18c6d2dcf500; sha256 c21d3599bca64b637ec263ecb59815c40f9e0d36dceeb281d163593775492293) -->

# Independent ordinary review — #616 test adequacy delta 3446fac5..c3685d9d
- **Exact candidate reviewed:** c3685d9d404ecffb6f2c8b048b0f18c6d2dcf500
- **Comparison base:** 3446fac5f28f0dbb49d7b0c9eb898a5fec9a5ce0
- **Reviewer / model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh Agent-tool context (general-purpose, not forked). I did not author, direct or remediate this change.
- **Files / surfaces checked:**
  - `scripts/ci/lib/workflow-gates.mjs`: `proveScopeStep`, `workflowEnvShape`, `meaningful`, `ALWAYS_RUN_GATES`, `PINNED_CHECKOUT`, `SAFE_DIRECTORY_STEP`, `PINNED_CONTAINER`, and the removed dead branch
  - `scripts/ci/probes/change-scope.test.mjs` and `check-policy-end-to-end.test.mjs`
  - `docs/04-engineering/ci-cd.md` § Applicability
  - REPORT 2 in `docs/07-planning/security-reviews/616-policy-enforcement-round5-opus.md`
- **Checks actually run:**
  - **Round-5 report:** REPORT 2 matches the report I returned line for line, so I confirm it as byte-identical. Its recorded sha256 `26e6bfa9…` equals the sha256 of lines 106–210 of the note with no trailing newline.
  - **Baseline:** 111/111 tests pass across `change-scope`, `check-policy-end-to-end`, `security-model-exact`, `review-models` and `check-policy`.
  - **`proveScopeStep` mutations** — all went red:
    - removing the always-run-job rule;
    - removing the always-run-gate rule;
    - dropping job `env`;
    - accepting any container, or only checking the `container:` header line;
    - dropping the workflow env-shape check;
    - dropping the digest check;
    - dropping the whole "steps before scope" check;
    - not checking the checkout's line count, its pattern, or its SHA pin;
    - allowing any number of steps before scope;
    - allowing the safe.directory step without the pinned container;
    - allowing no checkout at all.
  - **`proveScopeStep` survivors:**
    - **the exact safe.directory text check;**
    - the `gitleaks/` action prefix;
    - job `defaults` (equivalent: the older check already refuses `defaults` as unproven-shape);
    - any `fetch-depth` value (a shallow clone makes the merge base unresolvable, so the action answers full).
  - **`workflowEnvShape` mutations:** red for the plain-block requirement and the allowed-key list. Survivors:
    - `env` declared twice;
    - accepting lines the entry pattern cannot parse;
    - values containing `$`;
    - indentation other than two spaces;
    - **narrowing the start match from `^env\b` to `^env:`, so `env :` is no longer seen.**
  - **Round-5 leftovers re-tested:**
    - red: AGENTS.md startup order omitting the mission, live state in CLAUDE.md, and the classifier's exit status (with the digest pin re-synced).
    - survives: skipping a root commit instead of throwing. The new root-commit probe still answers full through the merge's per-parent diff, so it does not isolate the root rule.
  - **Adversarial run:** 33 bypass attempts against the allowlist.
  - **Pre-existing check:** the quoted-key cases were also run against main's 3096cb04 `workflow-gates.mjs`.

## Disposition of round-5 findings
- **Blocking 1 (A9's "nothing can redirect git/node" guarantee could be bypassed): CLOSED.**
  - Every shape I reported is now refused by the allowlist, and each is a probe in the refused table:
    - a step before scope that writes `$GITHUB_ENV` or `$GITHUB_PATH`, or rewrites the action;
    - a local or third-party action before scope;
    - an arbitrary container;
    - workflow env as a flow mapping or with a comment on the `env:` line;
    - a checkout of another ref.
  - The test gaps above remain, and so does the pre-existing quoted-key class in Non-blocking 1 below. Neither reopens the shapes I reported.
- **Non-blocking 1 (composite-action caller `if` ignored; pre-existing): OPEN, out of scope.** This delta does not touch that code. Still to be filed separately.
- **Non-blocking 2 (checkout of another ref): CLOSED.** A refused probe exists, and the checkout-length mutant goes red.
- **Non-blocking 3 (leftover gaps): mostly CLOSED.**
  - Closed: exit-status test, startup order omitting the mission, CLAUDE.md live state, dead branch removed.
  - Still open: the root-commit probe does not isolate the root rule (the mutant survives).
- **Non-blocking 4 (fail-closed inputs): informational.** All still fail closed.

## Findings
**Blocking:** None

**Non-blocking:**
1. **Quoted YAML keys are invisible to the workflow scanner. This is pre-existing on main and scanner-wide; file it as a high-priority separate issue.**
   - On this candidate, A9 accepts these as `scope-gated`:
     - job-level `"env":` (with `NODE_OPTIONS`), `"container":` (with any image), `'defaults':`;
     - top-level `"env":`, `'env': {…}`, and the explicit-key form `? env`.
   - With main's `workflow-gates.mjs`, a gate step or gate job with `"if": false` or `'continue-on-error': true` is already counted as `executes`.
   - So #616 does not widen what a candidate can already do. But the allowlist inherits the parser's blind spot.
   - Fix: make the job, step and workflow key readers refuse any key line they cannot parse, instead of skipping it.
   - That GitHub treats a quoted key as the same key is reasoned, not run live.
2. **Test gaps in the new allowlist** (the code is right in each case; a one-line weakening would go unnoticed). Cheap refused-table rows before merge:
   - **The safe.directory step's exact text is untested.** Any second step in a pinned-container job would be accepted under the mutant. The real code refuses it: I confirmed a `$GITHUB_ENV` writer in that position is refused.
   - **`env :` (space before the colon) is untested.** Narrowing the start match would stop seeing that spelling; current code refuses it.
   - **A workflow env line the pattern cannot parse is untested.** For example, `  NODE_OPTIONS : x` is refused today, but the mutant accepts it.
   - Also untested: `env` declared twice, the `gitleaks/` prefix, and a root commit isolated from merge diffs.
3. **The checkout pin accepts any 40-hex SHA.**
   - It does not require the reviewed checkout commit. GitHub resolves commits from forks of `actions/checkout` through the same name, a known GitHub behaviour (often called "imposter commits"), not run live here.
   - This is the same class as every SHA-pinned action in the repository. Requiring the exact `fbc6f399…` checkout SHA in `PINNED_CHECKOUT` would close it for this step.
4. **Accepted, but harmless or fail-closed at runtime:**
   - comments inside the checkout step;
   - a deeper-indented `with:` mapping;
   - `fetch-depth` as a sibling of an empty `with:` (GitHub should reject that as an invalid workflow; not checked live);
   - top-level `defaults` (does not apply to the composite scope step);
   - commented-out `env` lines.
5. **Refused, as it should be:**
   - a `name:` on the checkout step;
   - extra whitespace inside the checkout line or `fetch-depth`;
   - `fetch-depth: "0"`;
   - an `id`-bearing step placed before scope;
   - `container` written as a scalar string, or placed after `steps`;
   - job `env` placed after `steps`;
   - `env` written twice, with 4-space indentation, with an expression value, or with a `!!map` tag;
   - `runs-on: self-hosted`, an array, or an expression.
   - These make the scanner throw, which also fails closed: a flow-form checkout step, CRLF line endings, a YAML anchor or merge key on `env`.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 1 -->

<!-- BEGIN REPORT 2 (agent a399c1abbc5121183; candidate c3685d9d404ecffb6f2c8b048b0f18c6d2dcf500; sha256 cb128b385cee6580120f5e2d38c9e07222ae87c7707de82ed7f7c85c4b0cefa4) -->

# Independent security review — #616 delta 3446fac5..c3685d9d
- **Exact candidate reviewed:** c3685d9d404ecffb6f2c8b048b0f18c6d2dcf500
- **Comparison base:** 3446fac5f28f0dbb49d7b0c9eb898a5fec9a5ce0. The delta is 7d12687f (round-5 note, record-only) plus c3685d9d (A9 allowlist); 5 files.
- **Reviewer / model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh Agent-tool context (general-purpose, not forked), role: security reviewer; did not author, direct or remediate. This review cannot be the qualifying security review for #616: the merge base has no model list, so only `GPT-6 Sol` is accepted.
- **Files / surfaces examined:**
  - in `scripts/ci/lib/workflow-gates.mjs`: `proveScopeStep`, `workflowEnvShape`, `ALWAYS_RUN_GATES`, `PINNED_CHECKOUT`, `SAFE_DIRECTORY_STEP`, `PINNED_CONTAINER`, `meaningful()`, and the removed first-key duplicate check (dead code: a new step's key map is always empty at that point)
  - `scripts/ci/probes/change-scope.test.mjs`, `check-policy-end-to-end.test.mjs`
  - `docs/04-engineering/ci-cd.md` § Applicability
  - `docs/07-planning/security-reviews/616-policy-enforcement-round5-opus.md`
  - every `actions/checkout`, `container:` and `services:` in the shipped workflows
  - live CI at c3685d9d
- **Checks actually run:**
  - **Full CI-scripts suite at c3685d9d:** 1184 tests, 1182 pass. The 2 failures are the usual environmental `typecheck-coverage` ones (no `tsc` in the scratch worktree).
  - **Targeted suites, 7 files:** 369/369 pass (change-scope, check-policy-end-to-end, workflow-gate-drift, atomic-gate-proof, workflow-alias-table, check-visual-scope, security-model-exact).
  - **Base probes:** atomic-gate-proof, workflow-alias-table and workflow-gate-drift at 3096cb04 pass 120/120 with the candidate scanner swapped in.
  - **Round-5 probes:** those three plus round 5's own `change-scope.test.mjs` (its whole refused list), at 3446fac5 with the candidate scanner, pass 170/170.
  - **17 scratch A9 probes of my own.**
  - **Byte comparison of REPORT 3.**
  - **Live CI read (read-only).** All scratch worktrees were removed; the shared repo's branch is unchanged.

## Disposition of round-5 findings
1. **Redirecting `git` or `node` before the classifier — CLOSED, with one residual edge** (non-blocking item 1). Verified refused now:
   - an earlier step writing `$GITHUB_ENV`;
   - a checkout from another owner, or with an extra input;
   - the `safe.directory` step outside the pinned container;
   - a container with its own `env` or extra `options`;
   - flow-style workflow env, and workflow env whose value is an expression;
   - a step written as a flow mapping makes the scanner throw, which fails closed.
   - The before-scope check compares the exact text between steps, so a step the parser missed cannot slip in unseen.
2. **Always-run list sidestepped by renaming a job — CLOSED.** Verified: a job named `regs` that runs `pnpm check:policy` is refused ("runs an always-run gate"). The rule is now keyed by gate as well as by id, and gitleaks is matched by action prefix.
3. **SHA-256 pin is a tripwire, not a boundary — CLOSED (documented).** ci-cd.md now says so in those words.

**REPORT 3 identity: CONFIRMED.** Lines 216–310 of `616-policy-enforcement-round5-opus.md`, without a trailing newline, are byte-identical to the report I returned. Its SHA-256 is `8c34928782cf37accec8c737225e2b5cbf856684cbabc6effc93900a491852c2`, which matches the marker on line 214.

## Findings
**Blocking:** None.

**Non-blocking:**

1. **`PINNED_CHECKOUT` accepts any 40-hex SHA of `actions/checkout`.** (`workflow-gates.mjs`, `/^- uses: actions\/checkout@[0-9a-f]{40}$/`)
   - Verified: a different SHA (`bbbb…`) counts as `scope-gated`.
   - GitHub resolves `owner/repo@<sha>` across the whole fork network (the "imposter commit" problem). A swapped SHA can therefore run arbitrary code before the scope step and re-open everything item 1 closed, while looking like a routine version bump in review.
   - Every shipped workflow uses `fbc6f3992d24…`.
   - *Fix:* pin that exact SHA in the allowlist.
2. **A job-level `services:` block is accepted.**
   - Verified: it counts as `scope-gated`. No shipped workflow uses `services:`.
   - Reasoned: a service container starts before any step and can mount host paths, such as the workspace or `/usr/local/bin`. It could therefore rewrite the action, the temporary classifier file, or `node` before or while the scope step runs.
   - *Fix:* refuse `services` (or any job key not on an allowlist) on scope-gated jobs.
3. **Accepted but harmless; no action needed.** I note these so nobody reads them as gaps:
   - workflow-level `defaults` (composite action steps ignore it);
   - a YAML comment line inside the checkout's `with:`;
   - a mis-indented `fetch-depth` (GitHub rejects the workflow, which fails closed).

## Residual risk
**Verified:**
- No shape refused in rounds 4 or 5, or at the base, is now accepted.
- The shipped workflows reconcile under the new allowlist.
- The new refusals listed above work.
- Live CI at c3685d9d is red only on the pull-request template check, on `registers` (`check:policy`; it depends on the sibling policy PR) and on dependency audit — the same as before, and not security findings of this delta.

**Reasoned only:**
- the `services:` vector (item 2);
- imposter-commit resolution on GitHub's side (item 1).

**Out of this PR's reach, unchanged:**
- Workflows, the action and the scanner all run from the PR's own copy, so their integrity rests on security review of `.github/**` and `scripts/ci/**`.
- Required checks are not pinned to a source app in the ruleset.
- A PR can be retargeted to a branch with a gutted workflow.
- Items 1–2 matter only for a hostile `.github/**` edit that also passes security review. With both fixed, "nothing can run before the classifier" would hold for every job shape A9 accepts.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 2 -->
