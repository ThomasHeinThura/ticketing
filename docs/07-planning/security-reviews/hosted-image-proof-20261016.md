# Hosted exact-candidate shipping image proof — 2026-10-16

**Reviewed head:** `dd619a29ff64de3bbe632b1990b8f4f5c8caf7cd`

This bounded CI change adds actual image build/boot/migration/non-root/health/no-host-exposure proof to the existing required protected-route E2E job. Accepted main d603 is included; only five implementation/documentation paths differ from accepted main before this own-note publication. One strong independent GPT-6 Luna ordinary context and one independent full GPT-6 Sol security context clear current dd619a29. Original Sol BLOCKING at f5b8 is retained unchanged: host networking could bypass port checks. The repair requires all four services to use only the nonce-owned local bridge network with exact ID; runtime and final artifact validate the invariant. Eight raw records below include author handoffs and adverse/superseded reviews, not eight approvals.

Actual hosted Docker execution remains pending. In particular, the exited migrator network attachment representation is not verified by fake-engine tests. Exact-publication full CI and sanitized artifact must prove actual build, migration ledger, configured/runtime non-root identity, image IDs, isolation, exact live/ready200 and successful owned cleanup before merge. No signed release, laptop SIT, recovery, phase or feature acceptance is claimed. This changes no publisher, status context, ruleset, product runtime, dependency, test budget or owner hold. Existing job timeout45min allows build work.

Dispatch provenance: independent ordinary task `/root/hosted_image_proof_ordinary_luna` explicitly selected `model=gpt-6-luna`, security task `/root/hosted_image_proof_security_sol` explicitly selected `model=gpt-6-sol`; both original contexts used `fork_turns=none`. Serving-version introspection is unavailable and not fabricated. Root directed remediation/composed/published and is not an independent reviewer.

## Record 1

# Hosted candidate-image proof implementation handoff

Date: 2026-10-16
Author: GPT-6 Luna (implementation; not an independent reviewer)

## Source and commits

- Base: accepted main `f781b954b41811e810b093647254a384c8e83e78`.
- Worktree: `/Users/heinthura/.codex/worktrees/hosted-image-proof-20261016/Ticketing.v2`.
- Branch: `codex/hosted-image-proof-20261016`.
- Final local head: `438af994c4b1e56914f12d97514f96a1b86f9d99`.
- Commits: `3a9ddee878b3a756cb2bcb303cc8a88fd5f44bf5` (`ci: smoke test the candidate shipping image`); `438af994c4b1e56914f12d97514f96a1b86f9d99` (`fix(ci): fail when image proof cannot be recorded`).
- Worktree is clean. Neither commit was pushed; no PR was created or edited.

## Changes

- Added `scripts/ci/run-shipping-image-smoke.sh` and appended it after the existing real-Docker helper in the existing required `e2e - protected-route redirect` job. It adds no workflow, required status context, publisher, registry credentials, product variables, package, or dependency.
- The script requires `GITHUB_SHA` to be a full SHA matching the actual checkout, archives that exact candidate commit into an owned runner-temporary build context, and builds the repository shipping Dockerfile locally for the hosted runner's native Linux architecture. It does not publish or tag a release image.
- It starts only the canonical Compose Postgres 18 and Valkey plus the candidate `migrate` and `taskdesk` services, under a unique Compose project and overridden unique network with no published ports. Generated bootstrap values use already registered product variables, live only in a 0600 runner-temp env file, and are never emitted.
- The step fails on build/Compose/migration failure, empty source journal, mismatch between journal entry count and applied `__drizzle_migrations` rows, a root or invalid runtime UID, unhealthy image healthcheck, or failed live/ready endpoint. It writes sanitized source/checkout SHA, local image ID/platform, migration counts, non-root identity, health/readiness and cleanup results to a short-lived workflow artifact. Cleanup removes only the owned Compose project and volumes, network, local image tag, temp context and env file. Failure to record proof or clean up fails the step.
- Clarified the same full-CI job and merge-ready proof in `docs/04-engineering/ci-cd.md` and `docs/04-engineering/definition-of-done.md`. Kept final published-digest/SIT acceptance separate and explicit. No `test:all` gate declaration was added; the image smoke is an additional step in the existing e2e context.
- Raised only the existing e2e job-level timeout from 20 to 45 minutes to account for Docker image build/boot after existing browser and Docker-helper tasks. Test commands/timeouts and full-CI suite selection were not changed.

## Validation

- `pnpm install --frozen-lockfile` completed in the isolated worktree; lockfile and tracked dependencies were unchanged.
- Final-head `pnpm test:ci-scripts`: 1,339 passed, 0 failed, 20 skipped (suite-reported skips).
- `pnpm check:policy`: pass (8 policy files coherent).
- `bash -n scripts/ci/run-shipping-image-smoke.sh`: pass.
- Ruby YAML parse of `.github/workflows/ci-full.yml`: pass.
- `git diff --check`: pass; committed-tree diff check passed.
- Negative check: an event SHA not matching checkout exits 1 before Docker/runtime setup.

A first CI-script run without installed workspace dependencies failed module resolution; after the lockfile install, a run exposed a temporary `ci-cd.md` diagram label that looked like an unregistered gate. I removed that row and described the smoke within the existing browser job prose; the final full CI-script suite is green.

## Not run / limits

- No local Docker, Postgres, Valkey, browser, shared database, primary checkout or external workload was touched.
- The actual image build, migration, runtime UID, health/readiness and owned cleanup have not executed on a hosted runner. Those exact runtime assertions are pending the candidate PR's full CI after review and push.
- No signed multi-architecture release image, deployment, SIT journey, or integrated-slice acceptance is claimed. Hosted native-platform smoke does not replace published-digest verification on SIT.
- Required independent review(s), security review for `.github/**`, CI on the exact pushed SHA, and all merge gates remain pending.


## Record 2

# Hosted image proof remediation handoff (GPT-6 Luna author)

Date: 2026-10-16

## Exact source

- Accepted base: `f781b954b41811e810b093647254a384c8e83e78`
- Worktree: `/Users/heinthura/.codex/worktrees/hosted-image-proof-20261016/Ticketing.v2`
- Branch: `codex/hosted-image-proof-20261016`
- Final head: `dd7eb919021e6967c1c4bfd2a2e721d4549c2231`
- Commits: `3a9ddee8` initial hosted image proof; `438af994` exact candidate/image/runtime and ownership fixes; `951edf8a` candidate-source binding and runtime-proof corrections; `dd7eb919` final artifact/cleanup invariant.
- Final changed files in the last remediation commit: `scripts/ci/run-shipping-image-smoke.sh`, `scripts/ci/run-shipping-image-smoke.test.mjs` only. No push, PR edit, or merge.
- Primary dirty worktree was not opened for edits. Runtime bytes remain accepted `d93c0967ecc7b1a1d721ff25202737cd72430a0d`; no Docker/Postgres runtime was run locally.

## Latest bounded remediation

The cleanup trap now fails when the proof JSON is missing/unreadable, malformed/incomplete, or cannot be rewritten. A proof is marked `finalVerdict: passed` only when candidate and checkout SHAs are recorded; the build succeeded; both running services’ immutable image IDs match the locally built image ID; configured/runtime users are non-root; host-port mappings and publish-all-ports are absent; source migration journal count matches the qualified `drizzle.__drizzle_migrations` ledger; health is healthy; live and ready are exactly HTTP 200; and every owned cleanup action plus temporary-context removal succeeds. The original command exit code must also be zero. The artifact records a failed verdict otherwise.

Added fake-Docker regression cases demonstrate that an otherwise-successful run fails if cleanup removes the artifact, makes its path unwritable, or replaces the artifact with incomplete JSON.

## Validation

- `bash -n scripts/ci/run-shipping-image-smoke.sh` passed.
- Focused smoke tests: 15 cases, all passed (including missing, unwritable, and incomplete proof after cleanup).
- `pnpm test:ci-scripts`: 1,374 tests, 1,354 passed, 0 failed, 20 skipped; suite passed.
- `pnpm check:policy` passed.
- `pnpm exec biome check scripts/ci/run-shipping-image-smoke.test.mjs` passed.
- `git diff --check` passed.
- Full-tree `gitleaks detect --no-git --source .` reports 11 findings in pre-existing unrelated files (`apps/web/e2e/mfa-csrf-journey.spec.ts`, `docs/07-planning/security-reviews/13-kaneo-import-lenses/E-secrets.md`, existing accepted-record/security-review docs, `tests/api/portal-attachment-storage.test.ts`, and `docs/07-planning/status.md`). No finding points to either changed file. No secret values copied into this report.
- No hosted Docker execution yet; real candidate image build/boot/migration/health evidence remains pending exact-head CI.

## Review boundary and not done

This is author remediation, not independent review. The previous adverse handoff at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/image-proof-hosted-implementation-luna.md` is preserved unchanged, as are the adverse review records. No independent GPT-6 Luna or GPT-6 Sol review, push, PR update, CI execution on this head, image registry publication, SIT, release, or final acceptance is claimed.


## Record 3

# Hosted image proof final invariant remediation handoff (GPT-6 Luna author)

Date: 2026-10-16

## Exact source

- Prepared branch: `codex/hosted-image-proof-20261016`
- Branch base used for this isolated author work: accepted-main SHA at branch creation `f781b954b41811e810b093647254a384c8e83e78`.
- Final head: `9da4fddf4ebc08d6e9c8e4bc1590d9f3f8236434`.
- Prior local author commits preserved in ancestry, including `dd7eb919021e6967c1c4bfd2a2e721d4549c2231` (proof artifact/cleanup invariant) and the candidate-binding/runtime corrections described in `image-proof-hosted-implementation-luna.md`.
- Worktree: `/Users/heinthura/.codex/worktrees/hosted-image-proof-20261016/Ticketing.v2`.
- Last commit changes only `docs/04-engineering/ci-cd.md`, `scripts/ci/run-shipping-image-smoke.sh`, and `scripts/ci/run-shipping-image-smoke.test.mjs`.
- No push, PR edit, merge, main refresh, local Docker/Postgres runtime, image publish, or SIT run. Do not treat this source as hosted runtime proof.
- Parent informed me accepted main advanced to `d603c068c3f181bc6f3d61a2b86727ed5b9dfe92` while I worked; this prepared branch was intentionally left based on its original accepted base for the orchestrator’s normal re-composition after source freeze.

## Four bounded precision fixes

1. The image `Config.User` check now parses the account component before `:` and rejects `root`, `0`, and zero-padded numeric zero accounts even when a group is supplied. Final proof validation independently requires a non-empty non-root account. Regression cases cover `root`, `root:group`, `0:10001`, and `000:10001`; the fake runtime UID remains non-root to show the image declaration itself is rejected.
2. The script now inspects all four started default Compose services (`migrate`, `taskdesk`, `postgres`, `valkey`) for `HostConfig.PortBindings` and `PublishAllPorts`. The proof records each service’s image ID, bindings, and publish-all value; final proof validation requires all four entries and no port exposure. No product Compose configuration changed. Negative tests cover a Postgres host binding and Postgres automatic publishing.
3. The smoke bootstrap portal origin is `https://portal.localhost`; the agent origin remains `https://ticketing.localhost`.
4. The script reports “runtime checks complete; cleanup and proof validation pending” before exit-trap work. It prints the final “passed” line only after cleanup succeeds and the complete proof is successfully written/validated. A cleanup-failure assertion verifies no pass line is emitted.

The CI/CD guidance now describes all four services, both port exposure checks, and cleanup/proof completion as part of pass criteria.

## Validation on final source

- Focused image-smoke suite: 21 tests, 21 passed, 0 failed.
- `pnpm test:ci-scripts`: 1,380 tests, 1,360 passed, 0 failed, 20 skipped; suite exit 0.
- `pnpm check:policy`: passed (8 policy files coherent).
- `pnpm exec biome check scripts/ci/run-shipping-image-smoke.test.mjs`: passed.
- `bash -n scripts/ci/run-shipping-image-smoke.sh`: passed.
- `git diff --check`: passed before commit; committed tree clean.
- Full-tree `gitleaks detect --no-git --source .` found the same 11 existing unrelated matches, in `apps/web/e2e/mfa-csrf-journey.spec.ts`, prior security-review/status docs, and `tests/api/portal-attachment-storage.test.ts`. None of the changed files appeared. Findings were location-only in the terminal/report; no secret values were copied here.

## Review boundary

Author remediation only. All prior handoff/adverse reports remain untouched. This branch is now frozen for independent review. No independent GPT-6 Luna or GPT-6 Sol verdict is claimed. Hosted CI on the eventual exact composed head remains required to prove the real shipping image, PostgreSQL migration execution, non-root runtime UID, health, and live/ready 200 responses.


## Record 4

# Hosted image proof — ordinary review

**Reviewed head:** `f5b8c361aa969ca2d9b733ebb8934b9acde48848`
**Comparison base (accepted main):** `d603c068c3f181bc6f3d61a2b86727ed5b9dfe92`
**Role:** Fresh independent ordinary reviewer; strong review for a bounded CI/gate pass/fail change.
**Independence:** I did not author, direct, or remediate this candidate. I reviewed the frozen isolated worktree and its complete five-file change against the accepted base.
**Model provenance:** Parent selected this context for the GPT-6 Luna ordinary-review role. The execution surface does not expose a model/version identifier to this context, so I cannot independently authenticate the runtime model label; the conductor should attach platform provenance before recording this as a named GPT-6 Luna verdict.

## Scope checked

The candidate adds `scripts/ci/run-shipping-image-smoke.sh` and its 21-case fake-Docker test, inserts the proof into the existing required `e2e - protected-route redirect` job, and documents the proof/acceptance boundary. I reviewed the complete diffs, including exact-source archive selection, candidate-vs-checkout SHA recording, image ID/platform and configured/runtime user checks, the four-service host-port checks, the qualified `drizzle.__drizzle_migrations` query, exact 200 no-redirect probes, proof completeness, ownership-constrained cleanup, and the existing workflow trigger/step ordering.

## Verification

- `node --test scripts/ci/run-shipping-image-smoke.test.mjs` — 21 passed, 0 failed, 0 skipped.
- `pnpm test:ci-scripts` — 1,380 total; 1,360 passed, 0 failed, 20 skipped (existing suite skips).
- `pnpm check:policy` — passed; 8 policy files coherent.
- `git diff --check d603c068c3f181bc6f3d61a2b86727ed5b9dfe92...HEAD` — passed.
- `gitleaks git --log-opts='d603c068c3f181bc6f3d61a2b86727ed5b9dfe92..f5b8c361aa969ca2d9b733ebb8934b9acde48848' --redact` — 5 commits scanned, no leaks.
- Working tree was clean at review time.
- A real local Docker/Compose runtime was unavailable in this review environment; the helper's simulated engine suite is not evidence of hosted image execution.

## Findings

No blocking or non-blocking code findings.

The workflow step is within the already-required E2E job, passes the PR head SHA explicitly, and retains full checkout history so that the head commit object is available to `git archive`. The script builds only the candidate archive, runs the app and one-shot migrator from the exact built local image ID, verifies both PostgreSQL and Valkey service exposure state, and makes the proof fail closed on probe, artifact, or owned-resource cleanup failures. The tests exercise the specified negative cases, including foreign resource collisions and missing, incomplete, or unwritable proof output.

## Verdict and limits

**Code review: PASS.** No source change is requested by this review. This verdict is limited to the code and simulated-engine evidence at the reviewed SHA. Hosted GitHub execution must still demonstrate the actual shipping image build, migration, non-root runtime, health, exact live/ready responses, cleanup, and complete artifact on this exact candidate SHA before the candidate is merge-ready. That hosted proof was not available to this reviewer. This review does not replace the required independent GPT-6 Sol security review.


## Record 5

# Hosted candidate-image proof — independent security review

**Reviewed head:** `f5b8c361aa969ca2d9b733ebb8934b9acde48848`  
**Comparison base (accepted main):** `d603c068c3f181bc6f3d61a2b86727ed5b9dfe92`  
**Role:** Full Sol-tier security review of a bounded CI gate change.  
**Independence:** Fresh reviewer context (`/root/hosted_image_proof_security_sol`, `fork_turns=none`). I did not author, direct, or remediate the candidate. The parent/conductor and implementation lane are not counted as reviewers.  
**Model provenance:** The parent reports its platform spawn call selected `model='gpt-6-sol'`, `task_name='hosted_image_proof_security_sol'`, `fork_turns='none'`, with no reasoning override. This context cannot independently inspect a runtime model/version identifier. The report is therefore attributable to that explicit GPT-6 Sol selection, without an invented version attestation.

## Scope and evidence

I inspected the complete five-file diff: `.github/workflows/ci-full.yml`, `scripts/ci/run-shipping-image-smoke.sh`, its `.test.mjs`, `docs/04-engineering/ci-cd.md`, and `docs/04-engineering/definition-of-done.md`. I compared the script with the current `compose.yml`, Dockerfile-facing source archive path, the existing real-Docker isolation tests, the ordinary review, and all three author handoffs. I checked event SHA selection, archive build context, generated credentials, immutable image-ID comparison, migration ledger query, runtime identity, all four service port checks, redirect-bounded health probes, proof finalization, and owned cleanup.

My commands on the frozen head:

- `node --test scripts/ci/run-shipping-image-smoke.test.mjs`: **21 passed, 0 failed, 0 skipped**.
- `pnpm check:policy`: **passed**, 8 policy files coherent.
- `bash -n scripts/ci/run-shipping-image-smoke.sh`: **passed**.
- `git diff --check d603c068c3f181bc6f3d61a2b86727ed5b9dfe92..HEAD`: **passed**.
- `git merge-base --is-ancestor d603c068c3f181bc6f3d61a2b86727ed5b9dfe92 HEAD`: **passed**; `git status --porcelain=v1` was empty; `git rev-parse HEAD` matched the reviewed head.

The separate independent ordinary report records `pnpm test:ci-scripts`: 1,380 total, 1,360 passed, 0 failed, 20 pre-existing skips, plus policy/diff checks and a five-commit gitleaks range with no leaks. Those are the ordinary reviewer's results, not commands I reran. I did not run Docker: the local daemon is unavailable and no restart was authorized. The 21 tests use a fake Docker CLI, so they cannot prove actual Compose or Engine behavior.

## Blocking finding — host networking bypasses the isolation assertion

`run-shipping-image-smoke.sh` inspects `HostConfig.PortBindings` and `HostConfig.PublishAllPorts` for `migrate`, `taskdesk`, `postgres`, and `valkey`, but never inspects `HostConfig.NetworkMode` or membership in the run-owned network. The final proof repeats only the two port fields. A service using `network_mode: host` needs no port mapping, so those fields can remain empty/false while the service binds directly on the runner host. Docker's [Compose service reference](https://docs.docker.com/reference/compose-file/services/#network_mode) and [host-network driver documentation](https://docs.docker.com/engine/network/drivers/host/) state this behavior. `docs/04-engineering/ci-cd.md` claims the stack is isolated with no published ports, and its adjacent real-Docker helper explicitly tests host and container-shared network modes. A candidate can alter its archived Compose source and service connection URLs to use host networking; if the stack boots, this new gate can record `finalVerdict: passed` while its isolation claim is false.

The current `compose.yml` assigns all four default services to `taskdesk`, so this is a **gate invariant defect**, not evidence that this frozen candidate currently exposes a host port. Since the gate is meant to enforce the invariant on future candidate source as well, the false-pass path blocks security clearance. Inspect each started service's actual network mode and attachment to the unique run-owned network; reject `host`, `container:*`, `service:*`, unexpected networks, and missing attachment. Add a negative regression for the host-mode condition and, ideally, a real-Engine assertion at the existing Docker test tier. Re-review the repaired exact head.

## Other observations and limits

No other blocking or non-blocking finding emerged from this pass. The source archive is selected from the explicit PR-head SHA while retaining the synthetic checkout SHA in proof. The job stays within the required E2E status context; a failed smoke step fails that job. Generated secrets are stored in a mode-0600 temporary env file and are absent from the sanitized proof. The script tests configured and running non-root identity, exact app/migrator image IDs, qualified migration count, health status, manual-redirect HTTP 200, and final cleanup/proof completeness. Resource names include a random nonce and cleanup checks ownership labels before deleting the external network or image.

Hosted execution on this exact head remains outstanding: actual image build, Compose boot, migrations, non-root UID, health, live/ready status, cleanup, and the complete uploaded artifact have not been demonstrated here. This review says nothing about a signed release image, published digest, SIT, or stage acceptance.

**Verdict: BLOCKING — security review does not clear `f5b8c361aa969ca2d9b733ebb8934b9acde48848`.** The host-network false-pass must be repaired and reviewed on the new exact head. Required hosted CI evidence remains a separate merge gate.


## Record 6

# Hosted image proof network-isolation remediation handoff (GPT-6 Luna author)

Date: 2026-10-16

## Source and scope

- Accepted-main base: `d603c068c3f181bc6f3d61a2b86727ed5b9dfe92`.
- Prepared branch: `codex/hosted-image-proof-20261016`.
- Final head: `dd619a29ff64de3bbe632b1990b8f4f5c8caf7cd`.
- Worktree: `/Users/heinthura/.codex/worktrees/hosted-image-proof-20261016/Ticketing.v2`.
- Commit: `dd619a29 fix(ci): enforce isolated network for smoke services`.
- Commit changes only `scripts/ci/run-shipping-image-smoke.sh`, its existing `scripts/ci/run-shipping-image-smoke.test.mjs`, and the coherent CI/CD description in `docs/04-engineering/ci-cd.md`.
- The preceding reviewed source `f5b8c361aa969ca2d9b733ebb8934b9acde48848` and its adverse Sol report were not rewritten. No push, PR edit, merge, local Docker/Postgres execution, image publication, or SIT run. Prepared branch is clean and descends from the accepted base.

## Implemented invariant

The helper now creates its nonce-unique external network explicitly with `--driver bridge`, then verifies the created network’s ownership label, ID, `Driver=bridge`, and `Scope=local`. It records the network name, ID, driver, scope, and ownership-label verification in the sanitized proof.

For each default service (`migrate`, `taskdesk`, `postgres`, `valkey`), it inspects the actual container’s `HostConfig.NetworkMode` and `NetworkSettings.Networks`. It records only the configured mode and a map of attached network names to network IDs. Before continuing, it requires the mode to equal the unique run-owned network name and the attachment map to contain exactly that single network with the exact created network ID. Thus host mode, container/service-shared mode, another network mode, no attachment, a foreign attachment, or any extra attachment fails closed. These checks apply to the exited one-shot migration container via `docker compose ps -a -q migrate` and `docker inspect`.

The required final-proof validator independently requires the local bridge identity and complete exact network evidence for all four services. It therefore cannot report a pass when runtime inspection was skipped or a network record is absent or mismatched. Per-service sanitized evidence is written before assertion so a rejected mode/attachment remains diagnosable in the failure artifact.

The existing port-binding and `PublishAllPorts` checks remain for every service. No product Compose file, dependency, framework, status rule, publisher, or release behavior changed.

## Tests and checks

- Focused `node --test scripts/ci/run-shipping-image-smoke.test.mjs`: **31 passed, 0 failed, 0 skipped**. New simulated-engine cases reject host mode and an extra foreign attachment for each of the four services, plus container-shared and foreign network modes. Success-path assertions verify the owned bridge metadata and exact recorded attachment for every service. The tests model the stopped migrator as inspectable.
- `pnpm test:ci-scripts`: **1,390 total; 1,370 passed; 0 failed; 20 skipped**; exit 0.
- `pnpm check:policy`: passed, 8 policy files coherent.
- `pnpm exec biome check scripts/ci/run-shipping-image-smoke.test.mjs`: passed.
- `bash -n scripts/ci/run-shipping-image-smoke.sh`: passed.
- `git diff --check`: passed.
- Candidate-range leak scan: `pnpm exec gitleaks git --log-opts='d603c068c3f181bc6f3d61a2b86727ed5b9dfe92..HEAD' --no-banner` — 6 commits scanned, no leaks found.

## Docker inspect semantics and runtime limit

I checked the official Docker [`docker inspect` documentation](https://docs.docker.com/reference/cli/docker/inspect/), which states inspection also works for stopped containers, and the Engine API container-inspect schema documents `NetworkSettings.Networks`. That supports using `docker inspect` for the exited migrator. The local Docker daemon is unavailable, so I did **not** verify against a real engine that this candidate’s stopped Compose migrator retains a populated `NetworkSettings.Networks` map or confirm the exact `HostConfig.NetworkMode` string for an external Compose network on the hosted runner. The helper intentionally has no allowance for alternate names or empty evidence: actual exact-head hosted CI must confirm the expected Engine representation. If it differs, the record must be inspected and any adjustment narrowly justified; this report does not claim real Docker proof.

## Review boundary

This is GPT-6 Luna author remediation, not an independent review. No verdict is claimed for the repaired SHA. The root/orchestrator should obtain fresh ordinary delta review and a fresh full GPT-6 Sol security review on `dd619a29ff64de3bbe632b1990b8f4f5c8caf7cd`, then exact-head hosted CI. Do not treat the fake Docker tests as engine evidence.


## Record 7

# Hosted image proof network invariant — ordinary delta review

**Reviewed head:** `dd619a29ff64de3bbe632b1990b8f4f5c8caf7cd`
**Comparison base for current delta:** `f5b8c361aa969ca2d9b733ebb8934b9acde48848`
**Accepted-main base:** `d603c068c3f181bc6f3d61a2b86727ed5b9dfe92`
**Role:** Independent ordinary review of the bounded network-isolation remediation delta.
**Independence:** I did not author, direct, or remediate the candidate. I reviewed the exact three-path delta from the prior reviewed source, plus the current final invariant and regressions.
**Model provenance:** The parent explicitly selected this context for `gpt-6-luna` with `fork_turns=none`. The execution surface does not expose a runtime model/version identifier, so I cannot independently attest to a more specific version label.

## Delta and checks

The delta is limited to `scripts/ci/run-shipping-image-smoke.sh`, its existing test file, and `docs/04-engineering/ci-cd.md`. It creates and verifies a nonce-owned local bridge network, records its ID and metadata, and checks each of the four actual service containers for the exact network mode and exactly one attachment with the owned network name and ID. It records that per-service evidence before rejecting a mismatch, then independently requires complete matching evidence in final-proof validation. Port checks remain applied to all four services.

- `node --test scripts/ci/run-shipping-image-smoke.test.mjs` — 31 passed, 0 failed, 0 skipped.
- `pnpm check:policy` — passed; 8 policy files coherent.
- `git diff --check f5b8c361aa969ca2d9b733ebb8934b9acde48848...dd619a29ff64de3bbe632b1990b8f4f5c8caf7cd` — passed.
- `git status --porcelain=v1` — clean.
- Confirmed the three-file delta matches the assigned scope.

The new regression cases reject host mode and unexpected extra network attachment for each of `migrate`, `taskdesk`, `postgres`, and `valkey`; additional cases reject container-shared and foreign network modes. The success case asserts exact owned bridge identity and attachment evidence for all four. The harness models the one-shot migrator as exited but still inspectable.

## Review assessment

No code finding blocks this delta. The check is fail closed: missing/invalid Docker inspection output, a wrong mode, no attachment, an additional attachment, or a mismatched network ID fails before runtime probes and prevents a passing final artifact. Cleanup of the owned bridge then fails the job if the network remains in use or cannot be removed. The proof's final validator independently checks all four evidence records. The stopped migration container is obtained through `docker compose ps -a -q migrate`, then inspected with ordinary `docker inspect` fields. Docker documents that `docker inspect` works on stopped containers and that network attachment data is exposed under `NetworkSettings.Networks` ([docker inspect](https://docs.docker.com/reference/cli/docker/inspect/), [Engine API history](https://docs.docker.com/reference/api/engine/version-history/)).

## Verdict and limits

**Current-delta code review: PASS.** No source change is requested by this review. The prior ordinary PASS report for `f5b8c361aa969ca2d9b733ebb8934b9acde48848` remains unchanged; this report covers only the remediation delta through `dd619a29ff64de3bbe632b1990b8f4f5c8caf7cd`.

A real Docker daemon was unavailable here. Documentation and simulated-engine tests support the inspection approach, but they do not establish the exact hosted Engine representation for an exited Compose migrator or confirm its retained network attachment. The required exact-head hosted CI run must exercise that path and produce a complete passing artifact before merge readiness. This code review does not replace the required fresh GPT-6 Sol security review of the repaired head.


## Record 8

# Hosted candidate-image proof network repair — independent security review

**Reviewed head:** `dd619a29ff64de3bbe632b1990b8f4f5c8caf7cd`  
**Prior adverse head:** `f5b8c361aa969ca2d9b733ebb8934b9acde48848`  
**Accepted-main comparison base:** `d603c068c3f181bc6f3d61a2b86727ed5b9dfe92`  
**Role:** Full Sol-tier security review of the repaired candidate, including the original gate scope.  
**Independence:** My context `/root/hosted_image_proof_security_sol` was spawned with `fork_turns=none`. I identified and reported the prior host-network false-pass, but did not author, edit, direct the implementation of, or remediate this source. The author and conductor are not counted as reviewers. The original BLOCKING report remains unchanged.  
**Model provenance:** The parent reports the platform spawn selected `model='gpt-6-sol'`, `task_name='hosted_image_proof_security_sol'`, and `fork_turns='none'`, without a reasoning override. This context cannot independently inspect a runtime model/version identifier, so the GPT-6 Sol label is attributed to that explicit spawn selection and no more specific version is attested.

## Scope and actual checks

I reviewed the exact three-file delta (`scripts/ci/run-shipping-image-smoke.sh`, its `.test.mjs`, and `docs/04-engineering/ci-cd.md`) from the adverse head, then checked the complete current helper and its workflow/Compose boundary against the original five-file candidate. I compared the author remediation and independent ordinary delta report with source. The original controls for exact candidate archive, four service image IDs and no-port state, configured and runtime non-root identity, qualified migration count, exact HTTP 200 without redirects, complete sanitized proof, and owned cleanup remain present.

Commands I ran on this head:

- `node --test scripts/ci/run-shipping-image-smoke.test.mjs`: **31 passed, 0 failed, 0 skipped**.
- `pnpm check:policy`: **passed**, 8 coherent policy files.
- `bash -n scripts/ci/run-shipping-image-smoke.sh`: **passed**.
- `git diff --check f5b8c361aa969ca2d9b733ebb8934b9acde48848..HEAD`: **passed**.
- `git rev-parse HEAD` matched the reviewed SHA; `git status --porcelain=v1` was empty; the delta had exactly the three paths above.

The author reports a broader `pnpm test:ci-scripts` run: 1,390 total, 1,370 passed, 0 failed, 20 existing skips, plus a six-commit candidate-range gitleaks scan with no leaks. I did not rerun those commands; the independent ordinary delta reviewer separately ran the focused 31-case test and policy/diff checks. No real local Docker or PostgreSQL runtime was invoked.

## Security assessment

**The prior blocker is resolved in code.** The helper creates a nonce-named bridge network and verifies its ownership label, immutable ID, driver `bridge`, and scope `local`. For each actual Compose container (`migrate`, `taskdesk`, `postgres`, `valkey`), it now reads `HostConfig.NetworkMode` and `NetworkSettings.Networks`, records a sanitized name-to-network-ID map, and requires the configured mode and sole attachment to match that run-owned network exactly. Host mode, container sharing, another network, no network, an extra network, and an ID mismatch cannot satisfy either the runtime assertion or the independent final-proof completeness check. PortBindings and PublishAllPorts remain checked for every service. The new fake-Docker regressions cover host mode and extra attachment for each service, plus shared and foreign modes, and verify successful owned-network proof. Rejected mode evidence is written before the assertion when inspection output is parseable.

I checked this against Docker's [Compose network-mode reference](https://docs.docker.com/reference/compose-file/services/#network_mode), [host-network behavior](https://docs.docker.com/engine/network/drivers/host/), [network-create bridge behavior](https://docs.docker.com/reference/cli/docker/network/create/), and [container-inspect schema history](https://docs.docker.com/reference/api/engine/version-history/). The repaired equality to the unique network name and ID closes the empty-port-fields false-pass described in my prior report. The bridge check also rejects an unexpected driver or scope before boot. The current canonical `compose.yml` connects all four default services to its `taskdesk` network, which the override names to the owned external network.

I found **no new blocking or non-blocking code finding**. Cleanup still uses the unique Compose project, verifies the network/image ownership labels before removal, removes the temporary context, and makes any owned cleanup or final-artifact failure fail the step. The workflow remains in the already-required E2E job without new publisher or release permission.

## Runtime boundary and verdict

The tests simulate Docker. I could not verify locally the exact `HostConfig.NetworkMode` string or retained `NetworkSettings.Networks` representation for the **exited one-shot migrator** on the hosted runner's real Engine and Compose versions. The new assertions fail closed if those values differ; that would be an integration failure requiring evidence-led correction, not a reason to relax the invariant silently. The exact-head hosted job must still build and boot the shipping image and upload a complete passing artifact covering all four services, migration, health, HTTP probes, and cleanup before merge readiness. This report does not establish a signed release image, published digest, or SIT acceptance.

**Verdict: PASS — full security code review clears `dd619a29ff64de3bbe632b1990b8f4f5c8caf7cd`.** Hosted Engine proof and every other required exact-head gate remain pending and separate.

