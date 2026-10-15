# PR #758 security review record: release build step timeout (#753)

PR #758 adds `timeout-minutes: 35` to the "Build the multi-architecture candidate image" step of `.github/workflows/release.yml`, so a hung emulated arm64 build fails well inside the 60-minute job budget. The build, scans, SBOMs, signing and publication are unchanged. `.github/**` is security-scope.

The conductor (Claude Opus 5.5) implemented the change. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: APPROVE at `0fa992c9`, then APPROVE on the comment-only delta at `0ef6db6b`.
- Ordinary review B by Claude Sonnet 5.5: APPROVE at `0fa992c9`, then APPROVE on the delta at `0ef6db6b`.
- Security review by Claude Opus 5.5: CLEAR at `0ef6db6b`. A step timeout fails the job, and the sign/publish job is skipped, so nothing unscanned is signed or published. Permissions, triggers, concurrency and signing identity are unchanged.
- Mechanical security rebind by Claude Opus 5.5: CLEAR at `28325153`, a clean merge of `main` `8ed5fef2` (#756, docs only); merge-tree equality checked.
- Mechanical security rebind by Claude Opus 5.5: CLEAR at `24ca1f09`, a clean merge of `main` `1455ed80` (#755 and #757); `release.yml` unchanged.

**Reviewed head:** `0ef6db6ba05c7461e47c138a21abf89c83128008`
**Reviewed head:** `28325153ea446b8c3b9026a1db819d2b34a28d1e`
**Reviewed head:** `24ca1f0916061bc265e6101f5a6776ad54b8d0bd`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `758-ordinary-a-sonnet.md` | Ordinary review A (main..0ef6db6b) | Claude Sonnet 5.5 | `0ef6db6b` | APPROVE | `626d8b2a6de65fd567e38f3dcf8a50743f8e54105301a772afaed739bdb7ee18` |
| 2 | `758-ordinary-b-sonnet.md` | Ordinary review B (main..0ef6db6b) | Claude Sonnet 5.5 | `0ef6db6b` | APPROVE | `a1cb7d84173fbc91fbd36775ef7818d173a4af52719bca63d298e6d977cf888b` |
| 3 | `758-security-opus.md` | Security review (main..0ef6db6b) | Claude Opus 5.5 | `0ef6db6b` | CLEAR | `a2f173105cb18b09a6406db2bff32976203ef82106f705c7c16e2c79bd55fd06` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/758-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 626d8b2a6de65fd567e38f3dcf8a50743f8e54105301a772afaed739bdb7ee18) -->
# PR #758 ordinary review A (release.yml: 35-minute timeout on the multi-arch build, #753)

**Reviewed head:** 0fa992c987063b10a06af42c4eaf1597e8638d37
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed with `gh pr view 758` (unchanged). Diff against merge-base d159704b is exactly one hunk: 4 added lines (3 comment lines and `timeout-minutes: 35`) in `.github/workflows/release.yml`. Security-scope per ci-cd.md (CI/gate machinery), so this ordinary review does not replace the required Sol review; I did not assess that tier.

## Placement and syntax
- The key sits on the step `Build the multi-architecture candidate image` (id `build`), between `id:` and `uses:`. Step-level `timeout-minutes` is valid for `uses:` steps. Parsed the file at the exact head with Ruby YAML: the build step keys are `["name","id","timeout-minutes","uses","with"]`, value `35` (integer).
- Job-level timeout remains 60 (`build-scan`, line 33); the second job's 30 is untouched. The step budget (35) is below the job budget (60), as intended.
- The `uses:` pin, `with:` inputs (platforms, push, tags, build-args, provenance mode=max, sbom) and everything else are byte-unchanged.

## Cannot affect signing / publication / scans
- Only the build step gains a deadline. On expiry the step fails; later steps (manifest digest read, amd64/arm64 Trivy scans with `exit-code: 1`, and everything after) run only on success, and the workflow has no `if: always()`/`failure()` step that would proceed on a failed build (grep of the file at the head: no such conditions). A timeout therefore stops the run before scans, signing or publication; it cannot make a scan or signature pass, be skipped-but-successful, or publish. Trivy severity/ignore-unfixed settings, the scanner version, signing and tag publication are unchanged.
- A timed-out `push: true` build may leave a candidate build tag in GHCR, exactly as the existing 60-minute job timeout already could; the "validate unused destination" step and per-attempt build tag are the existing controls and are unchanged.
- No new secrets, permissions, triggers, inputs or action versions.

## Is 35 minutes reasonable
Step durations of the multi-arch build for the 12 most recent runs (from `gh api .../jobs`): 14.5, 14.1, 8.4, 13.9, 14.1, 10.4, 13.6, 10.8, 13.7, 13.8, 13.7, 13.9 minutes (max 14.5). 35 min is about 2.4 times the slowest healthy build, leaves headroom for a cold cache or slow runner, and cuts a hang from about 60 minutes to 35 so a re-run fits well inside the 60-minute job budget. `gh run list --workflow release.yml --limit 100`: 98 success, 2 cancelled (both about 60 minutes: 38018270604 on 2026-10-10 and 38383651313 on 2026-10-13, consistent with the job timeout firing on a hang). Issue #753 records another hang on run 38687802866 (about 52 minutes before failing), whose rerun passed in the normal about 15 minutes.

## Findings
Blocking: none.

Non-blocking:
1. The new comment says the arm64 stage "has hung once (#753)". The run history shows two earlier ~60-minute cancelled runs in addition to the one #753 describes, so "once" likely understates it. Wording only.
2. Reliability only: this bounds a hang but does not diagnose it (the PR and #753 scope it that way); a hang will still need a manual re-run.

## Residual risk
- Not exercised by an actual hung build (can't be done read-only); relies on GitHub's documented step timeout semantics.
- Required Sol security review for CI/gate-machinery is separate and still needed.

**Verdict:** APPROVE

---
# Delta review (0fa992c9 -> 0ef6db6b)

**Reviewed head:** 0ef6db6ba05c7461e47c138a21abf89c83128008
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Live head confirmed. Comment-only change: "8-14" becomes "8-15 minutes" and "has hung once" becomes "has hung" (resolves my non-blocking wording finding). `timeout-minutes: 35` and every other line unchanged; no semantics affected.

**Verdict:** APPROVE
<!-- END REPORT (sha256 626d8b2a6de65fd567e38f3dcf8a50743f8e54105301a772afaed739bdb7ee18) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/758-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 a1cb7d84173fbc91fbd36775ef7818d173a4af52719bca63d298e6d977cf888b) -->
# Ordinary review B, PR #758 (architecture, contracts, whole-system consistency)

**Reviewed head:** 0fa992c987063b10a06af42c4eaf1597e8638d37
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** origin/main d159704be626136e728df7ddef0381dc37cf7756
**Method:** scratch detached worktree at the exact head (removed afterwards); read-only; no push, comment, approve or merge.

## Checks and commands
- Diff: one file, `.github/workflows/release.yml`, +4 lines: a comment and `timeout-minutes: 35` on the `Build the multi-architecture candidate image` step (docker/build-push-action, pinned by SHA).
- Parsed the workflow with PyYAML: the only step-level timeout in build-scan is this one (35); job `build-scan` keeps `timeout-minutes: 60`; `sign-publish` keeps 30.
- Read the whole workflow for retries, concurrency and dispatch paths.

## Analysis
- Step-level `timeout-minutes` on a `uses:` step is valid; on expiry the step fails, subsequent steps are skipped, `sign-publish` (needs build-scan) does not run. No publication occurs before this step's success, so a timeout cannot publish a partial release.
- Job timeout interaction: 35 of 60 minutes leaves 25 for manifest read, two Trivy scans and two SBOMs. A healthy build is stated as 8-14 minutes, so about 2.5x headroom. The comment's phrase "re-runnable well inside the job budget" is loosely worded (budget is per run) but harmless.
- Retries: there is no automatic retry. A manual "Re-run failed jobs" increments `github.run_attempt`, and the candidate build tag is `candidate-${RUN_ID}-${RUN_ATTEMPT}`, so a rerun gets a fresh candidate tag. A timed-out attempt may leave an orphan candidate tag/layers in GHCR (pre-existing behaviour for any failed run).
- Paths: the push path (edge, concurrency group `taskdesk-edge`, cancel-in-progress false) benefits most: a hung build now frees the group after 35 minutes rather than 60, so queued edge builds start sooner. The workflow_dispatch path (group per version) is the same step and the version-unused validation runs before the build, so a rerun after timeout revalidates the same unused tag correctly because nothing was published.
- Pre-existing residual, not introduced here: a manual rerun of an older push run could later move the `edge` tag back to an older SHA if a newer run has completed in between.

## Findings
**Blocking:** none.
**Non-blocking:**
1. Wording nit in the comment as noted above.
2. The PR's `pull request template + security review` check is red; this workflow file is CI/gate machinery and so security-scope, so that outcome is expected until the required review notes are committed. Not a defect of the diff.

## Residual risk
Cannot prove the 35-minute figure against real run history from the repository; it rests on the PR's claim of 8-14 minutes and one observed hang (#753).

**Verdict:** APPROVE

---
## Delta review (0fa992c9 to 0ef6db6b)

**Reviewed head:** 0ef6db6ba05c7461e47c138a21abf89c83128008
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

- Delta is comment text only (healthy build "8-15 minutes", reworded hang note); no change to `timeout-minutes: 35` or any key. No behavioural effect.

**Verdict:** APPROVE
<!-- END REPORT (sha256 a1cb7d84173fbc91fbd36775ef7818d173a4af52719bca63d298e6d977cf888b) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/758-security-opus.md; Claude Opus 5.5; sha256 a2f173105cb18b09a6406db2bff32976203ef82106f705c7c16e2c79bd55fd06) -->
# #758 security review (Opus 5.5) — step timeout on the multi-architecture release build (#753)

**Reviewed head:** 0ef6db6ba05c7461e47c138a21abf89c83128008
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context

Head confirmed with `gh pr view 758 --json headRefOid` at the start and end of the review.

**Comparison base:** merge base `d159704be626136e728df7ddef0381dc37cf7756` (= `origin/main` at review time).

## Surfaces examined

- `.github/workflows/release.yml`, whole file: triggers, top-level and per-job permissions,
  concurrency, the `build-scan` job (validation, QEMU/Buildx, build/push, digest read, Trivy
  scans, SBOMs, SBOM upload) and the `sign-publish` job (`needs: build-scan`; cosign signing,
  attestations, tag publication, verification, GitHub release).

## Commands and results

| Command | Result |
| --- | --- |
| `git diff --stat <base> HEAD` | 1 file, 4 insertions, 0 deletions |
| `git diff <base> HEAD` | adds a 3-line comment and `timeout-minutes: 35` to the step `id: build` only |
| Python `yaml.safe_load` of release.yml | parses; build step `timeout-minutes: 35`, `continue-on-error` absent; jobs: `build-scan` (60 min, `contents: read, packages: write`), `sign-publish` (30 min, `needs: build-scan`, `actions: read, attestations: write, contents: write, id-token: write, packages: write`), both `if: github.ref == 'refs/heads/main'` |
| `grep always()|failure()|continue-on-error` in release.yml | no matches |
| `actionlint` | not installed on this host; not run |

## Analysis

- **Failure semantics.** A step that exceeds `timeout-minutes` is cancelled and counted as a
  failure. With no `continue-on-error` and no `always()`/`failure()` conditions anywhere in the
  file, every later step in `build-scan` (digest read, both Trivy scans, SBOMs) is skipped and the
  job fails. `sign-publish` has `needs: build-scan`, so it is skipped. Nothing is signed, attested,
  tagged with a version/channel tag, or released.
- **Partial push.** `build-push-action` pushes only to
  `image:candidate-<run_id>-<run_attempt>`. A cancellation mid-push can leave an incomplete or
  complete but unscanned candidate under that tag. This was already possible under the existing
  60-minute job timeout; the step timeout does not create a new state. The candidate tag is never
  signed and is not a deploy target: deploy verification is by digest and cosign identity on
  published tags. A re-run gets a new `run_attempt`, so no stale candidate tag is reused.
- **Unchanged:** `on:` triggers (push to `main`, `workflow_dispatch` with `source_sha`/`version`),
  top-level `permissions: contents: read`, per-job permissions, `concurrency` group and
  `cancel-in-progress: false`, OIDC/`id-token` scope (still only in `sign-publish`), all action
  pins, the cosign identity used for signing and verification.
- 35 minutes is below the 60-minute job budget, so the step fails visibly before the job limit.

## Findings

### Blocking

None.

### Non-blocking

- **N1 — orphaned candidate tags.** Pre-existing: a failed or cancelled build can leave an
  unsigned `candidate-*` tag in GHCR. Not introduced here. A periodic clean-up of unsigned
  candidate tags would reduce clutter and confusion; not required for this PR.

## Residual risk / not checked

- `actionlint` was not run locally (not installed). The step-level `timeout-minutes` key on a
  `uses:` step is valid workflow syntax, and the YAML parses.
- The timeout was not exercised by an actual hung run.
- The PR's `pull request template + security review` check fails pending this review, and
  `integration - Postgres 18` was pending at review time; not evaluated as part of this verdict.

**Verdict:** CLEAR

---

## Rebind — merge of main `8ed5fef2` (Opus 5.5, mechanical)

**Reviewed head:** 28325153ea446b8c3b9026a1db819d2b34a28d1e
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), same independent review context as above

**Comparison base:** `80caeda81be4c2c1ee63ae2b64bea6054f2a7a07`. That is my CLEAR head `0ef6db6b` plus one commit, which adds only `docs/07-planning/security-reviews/758-release-build-timeout.md`.

| Check | Result |
| --- | --- |
| live head (`gh pr view 758`) | `28325153ea446b8c3b9026a1db819d2b34a28d1e` |
| parents of `28325153` | `80caeda81be4c2c1ee63ae2b64bea6054f2a7a07`, `8ed5fef24f2e43aa09ac721e3c6faedda9c45030` |
| `git diff --stat 0ef6db6b 80caeda8` | 1 file: `docs/07-planning/security-reviews/758-release-build-timeout.md` (+183) |
| `git merge-tree --write-tree 80caeda8 8ed5fef2` | `cdb7734cebaab67885caffc686051c963a7ae6e7`, equal to the tree of `28325153`, so the merge was clean with no hand edits |
| `git diff --stat 80caeda8 28325153` | 5 docs files only: `docs/05-operations/environments.md`, `docs/07-planning/{active-mission,decision-log,integration-execution-queue,pr-disposition-ledger}.md` |
| paths changed since `0ef6db6b` under `.github compose.yml deploy scripts apps packages` | none; `.github/workflows/release.yml` is unchanged |

**Interaction:** none. The merge brought documentation only, and the release workflow is byte-identical to the head I cleared.

**Verdict:** CLEAR

---

## Rebind — merge of main `1455ed80` (Opus 5.5, mechanical)

**Reviewed head:** 24ca1f0916061bc265e6101f5a6776ad54b8d0bd
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), same independent review context as above

**Comparison base:** `87aaf68fc4ccb9f5411fd48022de0e0a6d52571e`. That is my CLEAR head `28325153` plus one commit, which edits only the security-review note.

| Check | Result |
| --- | --- |
| `git ls-remote origin refs/heads/codex/release-build-timeout-753` and `gh pr view 758` | `24ca1f0916061bc265e6101f5a6776ad54b8d0bd` |
| parents of `24ca1f09` | `87aaf68fc4ccb9f5411fd48022de0e0a6d52571e`, `1455ed80d87806c7c5e22c34e5f0f07c72782289` |
| `git diff --stat 28325153 87aaf68f` | 1 file: `docs/07-planning/security-reviews/758-release-build-timeout.md` (+27/−3) |
| `git merge-tree --write-tree 87aaf68f 1455ed80` | `d120b1ad811b79274ead6939bf4d47960694147b`, equal to the tree of `24ca1f09`, so the merge was clean with no hand edits |
| `git diff --stat 87aaf68f 24ca1f09` | 12 files, exactly the files main changed since `8ed5fef2` (#755 overlays, `deploy.sh`, loopback test, docs and note; #757 docs) |
| `git diff --stat 0ef6db6b 24ca1f09 -- .github` | empty: `release.yml` is byte-identical to the head I cleared |

**Interaction:** none with this PR's change. `release.yml` does package `compose.yml`, `deploy/` and `scripts/deploy.sh` into the versioned deployment archive. Main changed the content of those files, already security-reviewed under #755. The workflow's packaging, signing, permissions and step timeout are unchanged.

**Verdict:** CLEAR
<!-- END REPORT (sha256 a2f173105cb18b09a6406db2bff32976203ef82106f705c7c16e2c79bd55fd06) -->
