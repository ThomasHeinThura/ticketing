# #632 cross-instance legacy socket revocation proof

Source is a bounded verification addition on accepted main `9f736c39d4310cde458d76e561b245619d08c3bd`: optional listener hostname passthrough preserving production defaults, one private-purpose child API helper and the existing legacy revocation integration suite. Original13 cases remain; current focused run passes all14, including real cross-process delivery, administrator sign-out, scoped workspace reach loss and continued valid user delivery. Fresh strong independent ordinary and full independent Sol reviews CLEAR the exact source below. Root dispatch selected `gpt-6-luna` and `gpt-6.1-sol`; authentic reviewer self-descriptions are retained. The conductor authored this wrapper and is not an independent reviewer.

The original c288 run13pass/1fail and ordinary BLOCK remain intact. Missing explicit project grants were corrected through canonical read-only project roles, followed by a normal accepted-main import. The new14/14 is bound to the resulting source, not a claim that the earlier401 cause was isolated independently of the base change. No assertions were disabled or made weaker.

The latest operator wrapper EXIT1 remains authentic: its post-test validator used the wrong Testcontainers label. Vitest exit0/14passing and the owned-child exit0 receipt are separate actual results. Root independently checked the retained raw inspect with the actual `org.testcontainers.session-id`, new exact Valkey ID/loopback binding, before/after/current23-container inventory and absence of exact owned PG/Valkey. That offline metadata evaluation did not rerun the test, erase the wrapper failure, waive a gate, or prove universal process absence. The temporary local test-process Ryuk setting is not a product/CI environment change.

No protected merge, full hosted CI/image proof, issue closure, real deployed journey, stage or SIT acceptance is claimed. Current-main composition remains required before PR publication. The original accepted #796 production fix is retained, not rebuilt. This record adds the missing two-process proof to its existing scope.

## Retained report: realtime632-cross-instance-author-luna.md

# #632 Valkey cross-instance regression implementation

Prepared by the authoring GPT-6 Luna context on 2026-10-16. This is implementation evidence only. No independent review, runtime acceptance, issue closure, or product fix is claimed.

## Exact source

- Actual accepted `main` inspected: `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5`, the protected #790 merge commit. It contains accepted #796 `main` source `1a34e5792ee9c42b15004b032e3c5410e5def44e`. Do not label `3d43b717` as the #796 source SHA.
- New isolated branch: `codex/realtime632-cross-instance-luna`, based directly on `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5`.
- Author commit: `35fbb4ac91a696918ca6bf6b040d9bb22ae3e8c6` (`test(realtime): prove legacy revocation across Valkey instances`). No push, PR, merge, or history rewrite.
- Only changed paths: `tests/api-integration/legacy-ws-revocation.test.ts` and new `tests/api-integration/helpers/legacy-ws-instance-server.ts`.
- The prior worktree inspected for planning was at `98a04f25a915893adb9c5e2cc211f96185270321`; its changed project-reach file is `tests/api-integration/ws-project-reach.test.ts`. Those query-ownership changes were not imported into this branch.

## What the regression adds

The existing thirteen single-process revocation cases remain present. Their adapter initialization moved from `beforeEach` to the shared fixture builder so the added scenario can configure a disposable Valkey before initialization.

The new integration case starts a disposable Valkey 9 Testcontainer and a second independent Node API child process with its own module state and WebSocket maps. Both processes receive the test database URL from the integration harness and the same Valkey URL. A private-purpose helper starts only the existing `createApp`, Node listener and WebSocket adapter, reports its selected ephemeral port over IPC, and shuts down on an IPC stop request. It captures no stdout/stderr and does not forward credentials or raw logs.

The scenario opens both legacy user and project sockets on the child process. It confirms known user and project messages published by the parent process reach those remote sockets. Then an actual administrator sign-out request on the parent process must close both idle remote sockets with code 1008; additional parent broadcasts must produce no post-revocation message. A second member exercises project reach loss through the existing workspace-member removal API: the remote project socket must close, and the still-valid user socket must continue receiving its allowed notification. This covers cross-process event delivery, identity invalidation, session revocation and lost project reach without adding application production code.

The Valkey container, sockets, adapter and owned child process are cleaned up in `finally`; if graceful child shutdown exceeds five seconds, the fallback signal targets only that child’s detached process group. The test uses the existing Testcontainers dependency and existing auth, workspace and WebSocket fixtures.

## Checks and limits

- `pnpm install --frozen-lockfile`: passed; no lockfile change.
- Built workspace dependencies required by API typecheck: `@taskdesk/permissions`, `@taskdesk/domain`, `@taskdesk/email`: passed.
- `pnpm exec biome check tests/api-integration/legacy-ws-revocation.test.ts tests/api-integration/helpers/legacy-ws-instance-server.ts`: passed.
- `pnpm --filter @taskdesk/api exec tsc --noEmit`: passed.
- `git diff --check`: passed.
- The PostgreSQL integration test was not run. Docker, PostgreSQL, Valkey, and the child API runtime were not launched, per the orchestrator’s explicit test-window constraint. Thus the new cross-instance behavior remains unverified until the runtime window is granted.
- No source-level product defect was found that required expanding the change. The existing membership-removal route sends invalidation with the target user ID; the existing legacy reauthorization handler uses that ID to refresh the affected user and project sockets.

## Proposed runtime window request

Please grant an exclusive runtime window for this worktree to run the one focused test, then the full PostgreSQL integration suite if the focused run passes:

1. `pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/legacy-ws-revocation.test.ts` (confirm the repository’s current path/filter invocation first, without changing test selection semantics).
2. If it passes, run `pnpm test:integration` from this worktree and capture only test summaries/counts, exit status and the resulting source SHA. The focused test itself creates and removes a dedicated Valkey 9 Testcontainer; the integration harness provides its isolated PostgreSQL test database.
3. If the focused case fails, stop before changing production code, report the exact failure class to the orchestrator, and do not broaden the test or reinterpret a missing runtime prerequisite as a product finding.

This report is stored with mode `0600` and contains no credentials or raw logs.

## Retained report: realtime632-cross-instance-repair-luna.md

# #632 cross-instance test repair and runtime request

Prepared by the authoring GPT-6 Luna context on 2026-10-16. The original planning and implementation reports remain unchanged. This report records only the follow-up repair requested by the orchestrator. It is not an independent review, runtime acceptance, issue closure, or production fix.

## Exact source and changes

- Base: accepted `main` merge `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5` (#790), whose parent includes accepted #796 `main` at `1a34e5792ee9c42b15004b032e3c5410e5def44e`.
- Isolated branch: `codex/realtime632-cross-instance-luna`.
- Initial implementation commit: `35fbb4ac91a696918ca6bf6b040d9bb22ae3e8c6`.
- Follow-up repair commit: `ebccbe040f6143f1df60c5fa55ff46a316396b94` (`test(realtime): harden cross-instance proof lifecycle`). No push, PR, merge, or history rewrite.
- Only source path changed in the repair: `tests/api-integration/legacy-ws-revocation.test.ts`; the initial implementation also added `tests/api-integration/helpers/legacy-ws-instance-server.ts`.

Repairs made:

1. Both remote project sockets now observe the same first allowed project broadcast and assert its exact task ID. This removes the prior race where both one-shot listeners attached before two broadcasts to the same project and both could consume the first frame.
2. The test now subclasses the repository's existing Testcontainers `GenericContainer` and binds Valkey's published port to `127.0.0.1`, following the existing loopback-only container pattern in `tests/rls-prototype/global-setup.ts`. It uses the Valkey 9 Alpine image already used by `compose.yml`; it does not reuse a possibly persistent `TASKDESK_VALKEY_URL`.
3. Owned child shutdown now has a five-second graceful IPC phase, a two-second SIGTERM phase, a two-second SIGKILL phase, and confirms actual child exit. Signals target only the detached process group created by this test's own `fork`; no PID inventory or external process targeting is used.
4. Nested `finally` blocks ensure child cleanup failure cannot skip adapter shutdown, restoration of the prior Valkey URL, or removal of the disposable Valkey container. The child uses only a strict readiness/stop IPC protocol; stdout/stderr are ignored and no credential or raw-log data is captured.

The test continues to prove allowed remote user/project delivery before revocation, actual admin sign-out from the parent closes idle sockets hosted by the child and prevents later disclosure, and actual workspace-member removal revokes the remote project socket while the valid user socket continues to receive its allowed notification.

## Checks and limits

- `pnpm exec biome check --write tests/api-integration/legacy-ws-revocation.test.ts tests/api-integration/helpers/legacy-ws-instance-server.ts`: passed after repair; formatter made no changes in the final check.
- `pnpm --filter @taskdesk/api exec tsc --noEmit`: passed after repair.
- `git diff --check`: passed after repair.
- No integration test was executed. PostgreSQL, Docker, Valkey, and the child API runtime remain unlaunched because the runtime window has not been granted.
- No production code or spec behavior changed; no product defect is claimed from this test authoring work.

## Requested exclusive runtime window

Authorization is still required. Once granted, run only the focused integration test first, from the isolated worktree, with its existing Testcontainers-provided disposable PostgreSQL test database and this test's one disposable Valkey 9 Alpine container published on loopback. The focused test starts one owned child API process and always performs bounded child/container cleanup:

```bash
pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/legacy-ws-revocation.test.ts
```

This command runs the existing 13 local revocation cases plus the new cross-process case and creates no persistent Valkey service. Do not run the full local PostgreSQL integration suite under this window. If the focused case passes, request/await hosted full-integration execution once the candidate is eligible; if it fails, stop and report the exact failure class for orchestration before changing source.

This report is private and stored with mode `0600`; it contains no credentials or raw logs.

## Retained report: realtime632-loopback-bind-luna.md

# #632 child listener loopback binding and focused runtime request

Prepared by the authoring GPT-6 Luna context on 2026-10-16. This records the server-bind seam and follow-up implementation. It is not an independent review, runtime acceptance, issue closure, or production behavior fix.

## Source and implementation

- Base: accepted `main` merge `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5` (#790), containing accepted #796 main `1a34e5792ee9c42b15004b032e3c5410e5def44e`.
- Isolated branch: `codex/realtime632-cross-instance-luna`.
- Current committed HEAD: `c2885d7844fbf859d9dbf15e980d0f1ebe579e1a`.
- Commits on the branch: `35fbb4ac91a696918ca6bf6b040d9bb22ae3e8c6` initial test implementation; `ebccbe040f6143f1df60c5fa55ff46a316396b94` listener/cleanup repair; `c2885d7844fbf859d9dbf15e980d0f1ebe579e1a` loopback bind.
- Changed paths across the branch: `tests/api-integration/legacy-ws-revocation.test.ts`, `tests/api-integration/helpers/legacy-ws-instance-server.ts`, and `apps/api/src/index.ts`.

The installed `@hono/node-server@2.1.3` declaration exposes `hostname?: string` in its `serve` options. Its installed implementation passes `options.hostname` to `server.listen(port, hostname, ...)`. `createNodeServer` previously omitted this property and therefore used adapter defaults. The minimal safe seam is an optional `hostname` in the existing internal server options type, passed through only when supplied. Existing `startServer` callers omit it and retain current production binding behavior. The test-only child explicitly requests `127.0.0.1` and checks `server.address().address === "127.0.0.1"` before announcing readiness. It does not bind wildcard then relisten, and it does not duplicate the HTTP/WebSocket or auth implementation.

This touches `apps/api/src/index.ts` in a WebSocket server path. It is security-scope for review-tier classification; this authoring context cannot independently review it. No review/merge authorization is implied.

## Checks and limits

- `pnpm exec biome check apps/api/src/index.ts tests/api-integration/legacy-ws-revocation.test.ts tests/api-integration/helpers/legacy-ws-instance-server.ts`: passed.
- `pnpm --filter @taskdesk/api exec tsc --noEmit`: passed.
- `git diff --check`: passed.
- No PostgreSQL, Docker, Valkey or child API runtime was started. No test was run. The actual bound address assertion will be exercised by the focused run after runtime authorization.
- Worktree is clean at the recorded HEAD; nothing was pushed.

## Exact focused-run resource plan

The focused run should use an explicitly root-owned disposable PostgreSQL 18 instance, not the CI global-setup container and not an existing persistent database. Provision `postgres:18-alpine` with database name ending `_test` (for example `taskdesk_test`), loopback-only host publication on a dynamically selected port, and tmpfs storage for `/var/lib/postgresql/data`. Keep the generated credentials in the orchestrator’s environment and do not put them in command output or this report. Export the already-supported `TASKDESK_DATABASE_URL` to that PostgreSQL instance; leave `CI` unset (`env -u CI`) so `tests/api-integration/global-setup.ts` does not start its own default-exposure Testcontainer. `tests/api-integration/setup.ts` preserves a database name ending in `_test` and uses the provided URL. The root-owned run wrapper must stop and remove this exact PostgreSQL container in its own `finally` path.

During the focused test, the test itself creates one disposable `valkey/valkey:9-alpine` container using the established Testcontainers loopback `HostIp: 127.0.0.1` binding and dynamic port; it restores any prior URL, stops the adapter, and removes that Valkey container in nested cleanup. It starts one detached child API process with its own module maps, binds the child server only to `127.0.0.1`, confirms the actual bound address, and owns bounded IPC → SIGTERM → SIGKILL cleanup of only that child process group. No persistent Valkey URL is reused by the scenario.

Once the root grants the exclusive runtime window, run only the focused test from this worktree, with `TASKDESK_DATABASE_URL` already exported by the root-owned wrapper and `CI` unset:

```bash
env -u CI pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/legacy-ws-revocation.test.ts
```

Capture sanitized suite/file/test counts, exit status, actual child bound address, and cleanup completion. Do not run the full local PostgreSQL suite. If focused passes, use the hosted full integration suite when the candidate is eligible; if it fails, stop and report the failure class before changing source.

This report is private with mode `0600` and contains no credentials or raw logs.

## Retained report: realtime632-cross-instance-ordinary-luna.md

# Independent ordinary review — #632 cross-instance regression

**Model:** GPT-6 Luna  
**Role:** Strong ordinary reviewer  
**Context:** Fresh independent review; did not author, direct, advise, or remediate the candidate.  
**Reviewed head:** `c2885d7844fbf859d9dbf15e980d0f1ebe579e1a`  
**Comparison base:** `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5`  
**Verdict:** BLOCKED

## Scope and checks

Reviewed the exact three-path diff, #632 issue statement, realtime architecture contract, active mission/workflow and relevant membership/project fixtures and invalidation paths. Confirmed the worktree remained clean and HEAD stayed at the reviewed SHA. Did not run integration, Docker, PostgreSQL, Valkey, browser, or process-launch checks because the author owns the active focused runtime window. No files were changed.

The bounded production delta is limited to passing an optional hostname to the existing Hono Node server, with omitted options retaining the adapter defaults. The helper requests and verifies IPv4 loopback. Child startup waits for the Redis adapter subscriptions before reporting readiness. Test cleanup closes sockets, performs bounded IPC/owned-process-group shutdown, shuts down the parent adapter, restores the prior Valkey URL, and removes the container. The thirteen existing single-process cases remain in the test.

## Blocking finding

**The new cross-instance case's two project sockets are not admitted by the test fixture.** In `tests/api-integration/legacy-ws-revocation.test.ts:493-507`, both users are invited with workspace role `member`, then the project is created, but neither user receives a project membership/grant. At lines 517-520 and 529-533 the test immediately attempts to open `/api/ws/{projectId}` for each user and expects an accepted socket. The established contract and `tests/api-integration/ws-project-reach.test.ts:315-344` explicitly refuse a same-workspace `member` with no project membership; the positive case at lines 200-219 explicitly calls `grantProjectRead` before opening. `createProjectFixture` creates the project and columns only; it does not grant project access. Therefore the test will fail at project handshake before it proves cross-instance project delivery or revocation. Add the normal persisted project-read grant for both members before starting/opening the child sockets, while preserving the post-removal assertion that the user socket remains allowed.

Evidence: `packages/permissions/src/evaluator.ts:353-401` makes project reach depend on instance-wide, workspace-with-workspaces, project-membership, ancestor-project or owning-team reach; a plain same-workspace member does not qualify. The fixture deliberately documents that project access must be explicit. This is a test-fixture/admission defect; it does not establish a product authorization defect.

## Non-blocking findings

None recorded.

## Residuals

No runtime behavior or cleanup completion is claimed. After the fixture is repaired, the focused owned PostgreSQL/Valkey/child-process run remains required; this report does not substitute for the separate GPT-6 Sol security review of the security-scope `apps/api/src/index.ts` change.

## Retained report: realtime632-cross-instance-focused-pg-luna.md

# #632 focused cross-instance runtime attempt

Date: 2026-10-16 (Asia/Yangon)
Author/runtime operator: GPT-6 Luna, candidate author

## Exact source and command

- Base: `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5` (#790 protected merge, containing accepted #796 main `1a34e5792ee9c42b15004b032e3c5410e5def44e`).
- Exact candidate: `c2885d7844fbf859d9dbf15e980d0f1ebe579e1a`.
- Source commits: `35fbb4ac91a696918ca6bf6b040d9bb22ae3e8c6`, `ebccbe040f6143f1df60c5fa55ff46a316396b94`, `c2885d7844fbf859d9dbf15e980d0f1ebe579e1a`.
- Worktree: `/Users/heinthura/.codex/worktrees/realtime632-cross-instance-luna`; branch `codex/realtime632-cross-instance-luna`; HEAD remained exact candidate; no source edits during or after run.
- Only test invoked: `pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/legacy-ws-revocation.test.ts` via the private wrapper `/tmp/run-realtime632-focused-c2885d78.sh`.
- `CI` was unset. The wrapper configured the dedicated `taskdesk_test` database URL through a mode-0600 ephemeral environment file; credentials and URI are omitted here.

## Owned runtime and result

The wrapper created and verified exact ownership of PostgreSQL container `bee91e222ff6ea1bb5df7129160333dac729fdacb7eadd56d5845ba7ef2b02ac`, image `postgres:18-alpine`, run label `50ff34da075370ab`, revision label `c2885d7844fbf859d9dbf15e980d0f1ebe579e1a`, loopback dynamic bind `127.0.0.1:32778`, and tmpfs data directory `/var/lib/postgresql`. The exact owned container was stopped and removed in wrapper cleanup; subsequent Docker inspection found it absent. The ephemeral credential environment file was removed. Before/after inventories are retained in the private evidence directory.

The focused file reported **14 tests: 13 passed, 1 failed** (Vitest exit 1). The new cross-instance case failed during WebSocket admission with `Unexpected server response: 401`, before it could demonstrate the intended broadcast/revocation path. I did not weaken assertions or edit source in response. A fresh independent ordinary review at the same SHA identified the fixture cause: both invited member actors lacked explicit project-read grants before the project socket handshake. This is a fixture blocker, not evidence of a product defect. See `/Users/heinthura/.codex/taskdesk-evidence/2026-10-16/realtime632-cross-instance-ordinary-luna.md`. Any corrected fixture must use the canonical persisted project-read grant and must establish that the later real membership-removal path revokes the relevant scope.

Full private output is retained at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/realtime632-50ff34da075370ab/focused.log`; exit code is in `focused.exit`. No database URI/password was found in that output by the operator's scan; the raw log remains private.

## Cleanup and residual resource

The exact PostgreSQL container is confirmed absent. The before/after inventory showed no additional Valkey container attributable to this run; the pre-existing `taskdesk-valkey-1` remained. The run left Testcontainers Ryuk container `da9d814edafa439d9f7eee647bf1507010b08c13350bc9de90cc81b6c3b26a4d` (`testcontainers/ryuk:0.14.0`, session label `7e579234330b`). I preserved it because it was not among the explicitly owned PG resources and did not remove or signal it. Thus the runtime window is **not declared free** until the root operator verifies/disposes of that exact run-owned reaper safely. The test's `finally` path completed and awaited its owned child shutdown, but no separate child PID/OS exit receipt was captured, so this report makes no independent process-absence claim.

No broader suite, browser, push, PR, merge, or additional runtime attempt was performed. Next required step is a bounded fixture correction and a newly authorized focused run; this result must remain recorded as a failed attempt.

## Retained report: realtime632-cross-instance-source-repair-plan-luna.md

# #632 cross-instance source correction and next-run plan

Date: 2026-10-16 (Asia/Yangon)
Author: GPT-6 Luna

## Candidate

- Base: `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5` (#790 protected merge containing accepted #796 main `1a34e5792ee9c42b15004b032e3c5410e5def44e`).
- Prior focused candidate/result retained unchanged: `c2885d7844fbf859d9dbf15e980d0f1ebe579e1a`, 13 passed / 1 failed at the new project-socket handshake with 401. The independent ordinary review block at that SHA is preserved at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-16/realtime632-cross-instance-ordinary-luna.md`; the prior private execution report is preserved at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-16/realtime632-cross-instance-focused-pg-luna.md`. The failure remains recorded and was not relabeled as a product finding.
- New source-only candidate: `e9c9c4d54432a293e0eb34fda909b6224f3141bf` (`test(realtime): grant project reach in cross-instance proof`).
- One changed file: `tests/api-integration/legacy-ws-revocation.test.ts`. No production source, dependency, or CI configuration changed. The worktree is clean at this SHA.

## Fixture and removal contract

Before opening either project socket, the cross-process test now calls the repository's existing `grantProjectRole` fixture helper for each invited actor, with only `project:read` and `work_item:read`. This is the persisted, scope-correct grant pattern used by the realtime project-reach integration tests. The member workspace role is unchanged; no owner/admin role is used.

The later loss-of-reach case still uses the real `removeWorkspaceMemberNative` HTTP path. Source inspection of `remove-workspace-member.ts` shows it deletes the target's `workspace_user` rows, updates workspace-admin reach, revokes creator project grants, and does not delete an arbitrary project-scoped membership. The socket's project lookup separately applies `reachableWorkspacePredicate`, which requires an instance admin or a live `workspace_user` row. Therefore this fixture intentionally retains and asserts the target's direct project grant after removal, while asserting the workspace membership is gone. The already-open idle project socket must then close on the next project broadcast, deliver no project payload afterward, and the user's socket must remain allowed and deliver its user event. This makes the test distinguish workspace reach loss from accidental deletion of its project-read grant. These are source-level contract observations; the corrected test has not run, so the previous 401's exact cause is not claimed proven until runtime.

## Checks completed; runtime not run

- `pnpm exec biome check tests/api-integration/legacy-ws-revocation.test.ts` — passed.
- `pnpm --filter @taskdesk/api exec tsc --noEmit` — passed.
- `git diff --check` — passed.
- No tests, PostgreSQL, Docker, Valkey, API child process, browser, push, PR, or merge ran after the fixture correction. The one earlier focused failure remains the only runtime result for the prior SHA.

## Proposed next focused runtime controls

Testcontainers is version 12.1.0 in this checkout. Its installed `build/reaper/reaper.js` reads `TESTCONTAINERS_RYUK_DISABLED` and skips creating Ryuk only when its value is exactly `"true"`. For the next authorized invocation, set that variable only in the environment of the focused test process (not a committed/project env setting); leave normal Testcontainers behavior untouched for CI and all other runs. The focused test already explicitly stops/removes its exact Valkey container in `finally`; the invoking root-owned wrapper should independently own and remove only its labeled PostgreSQL 18 Alpine container. Capture before/after Docker container IDs and inspect the exact run-owned IDs after cleanup; preserve all unrelated IDs, and do not use broad process/container cleanup. Keep the database on a dedicated unique root-owned `taskdesk_test` PG with a dynamic `127.0.0.1` bind and tmpfs data directory, `CI` unset, and private credential environment handling as in the previous authorized run. Preserve the one-file/14-test expected suite scope; do not launch any broader local suite.

Root reported that the previously listed Ryuk container naturally disappeared before cleanup, and a fresh inventory showed the same 23 IDs as the original snapshot (`added=[]`, `missing=[]`); no signal or mutation was used. The earlier execution report keeps the historical observation. The root operator has released the heavy runtime window, but this report requests a new explicit runtime grant for exact SHA `e9c9c4d54432a293e0eb34fda909b6224f3141bf`, because no runtime authorization has yet covered the corrected source.

## Retained report: realtime632-accepted785-focused-pg-luna.md

# #632 accepted-785 focused cross-instance runtime

Date: 2026-10-16 (Asia/Yangon)
Operator/author: GPT-6 Luna

## Source conservation and exact run

- Pre-merge #632 candidate: `e9c9c4d54432a293e0eb34fda909b6224f3141bf`.
- Accepted main: `9f736c39d4310cde458d76e561b245619d08c3bd` (#785, accepted by root at 2026-10-16 13:42:52Z).
- Normal merge commit: `0e9a6387c688305cfb59600622ace899549c5e99`; parents are e9 first, accepted 9f second.
- The three candidate source paths (`apps/api/src/index.ts`, `tests/api-integration/helpers/legacy-ws-instance-server.ts`, `tests/api-integration/legacy-ws-revocation.test.ts`) are the only paths differing between accepted 9f and the merge. The 73 paths introduced by accepted 9f relative to e9 are present via the ordinary merge; there were no conflicts or hand resolutions. The branch remains at the merge SHA with a clean worktree.
- Cheap checks at merge SHA: `pnpm --filter @taskdesk/api exec tsc --noEmit`, `pnpm exec biome check tests/api-integration/legacy-ws-revocation.test.ts`, and `git diff --check` passed.

One authorized focused command ran only `tests/api-integration/legacy-ws-revocation.test.ts` using the API Vitest integration config, with `CI` unset. The test-process-only `TESTCONTAINERS_RYUK_DISABLED=true` setting prevented Testcontainers from starting the otherwise wildcard-exposed Ryuk service. The test command's captured status is 0. Vitest reports **1 file, 14 tests, all 14 passed**. The 13 prior single-process cases remained in the same file and passed. The new case completed cross-process allowed user/project delivery, real administrator sign-out idle closure/no subsequent messages, real workspace-member removal idle project closure/no project disclosure, and continued user-socket delivery.

## Owned resources and cleanup evidence

Private run evidence: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-16/takeover/realtime632-2f7ce739eb307a6d/` (directory mode 0700; files mode 0600). It contains full focused output, exact exit code, before/after container inventories, selected safe container inspect facts, and cleanup log. The raw log has no database URI/password matches; no credential value is included here.

- PostgreSQL ID `afc78493670adfbe49e0653d9a3ee96ca7c0d595bf9e421986cf65d03c64ff72`; exact run label `2f7ce739eb307a6d`, revision label exact merge SHA, image `postgres:18-alpine`, `taskdesk_test`, dynamic loopback bind `127.0.0.1:32783`, tmpfs `/var/lib/postgresql`. The wrapper asserted ID/image/run/revision/bind/tmpfs before starting fixtures and reset. It then stopped and removed this exact container after the test; inspect confirmed it absent.
- Newly observed Valkey ID `407ccd6a8b87e935bbb3069b2d81b7597cf1d742678893f6b30f02aa158a7478`; image `valkey/valkey:9-alpine`, new relative to the before-run inventory, Testcontainers `org.testcontainers.session-id` label present, actual published endpoint `127.0.0.1:32784` (dynamic mapping requested by the test). The test's explicit `finally` stop/remove completed; the exact ID was absent after the run. Safe selected inspect metadata is in `valkey-inspect.jsonl`.
- Child API emitted a nonsecret owned-handle exit receipt: PID `43710`, exit code `0`, signal `null`, `exited=true`. Its helper verifies the actual listener address is `127.0.0.1`; the test passed.
- The exact 16-byte run token and database credentials were held under a mode-0700 temporary directory with mode-0600 env files, then the exact directory was removed in wrapper cleanup. No credential env file was retained.
- Before/after container inventory each contained 23 IDs; `added=[]`, `missing=[]`. Ryuk was absent and no new container remained. No unrelated resource was removed or signalled. No global process absence claim is made.

## Operator wrapper caveat and causal limits

The wrapper's final process exit was 1 even though Vitest's captured exit code was 0 and all 14 assertions passed. Its post-run metadata validator mistakenly required label `org.testcontainers.session`; installed Testcontainers 12.1.0 uses `org.testcontainers.session-id`. This validation error occurred after the test and cleanup, did not modify source or resources, and is preserved in the tool result. The raw inspect record proves the actual label and loopback mapping. No rerun was attempted.

The earlier c288 focused attempt (13 pass, one 401) and the independent ordinary block are retained at their original paths/reports. The corrected merged candidate now passes the full focused case with the two canonical project grants. This supports the fixture/admission diagnosis; because the executed merge also includes accepted #785, the prior 401 is described as consistent with the missing-grant block rather than claimed as an independently isolated sole cause.

No full integration suite, browser, additional local runtime, push, PR, or merge was performed after this test. Root has been notified that the exact owned runtime resources are absent and the bounded window is free.

## Retained report: realtime632-current-composition-ordinary-luna.md

# #632 current-composition ordinary review

- **Model:** GPT-6 Luna
- **Role:** Strong independent ordinary reviewer
- **Context / independence:** Fresh reviewer context assigned by the conductor. I did not author, direct, advise on, or remediate this candidate.
- **Exact candidate:** `0e9a6387c688305cfb59600622ace899549c5e99`
- **Comparison base:** `9f736c39d4310cde458d76e561b245619d08c3bd` (accepted #785)
- **Scope:** Full 3-path product/test diff from accepted base, callers and relevant integration fixture contracts, #632 realtime architecture contract, runtime proof attribution. No source edits.
- **Risk:** Security-scope test/runtime binding and lifecycle change. The listener hostname is optional; no authorization or production binding default is redesigned. This report is the strong ordinary review only; required fresh full GPT-6 Sol security review remains outstanding.

## Checks performed

- Confirmed candidate HEAD equals the requested SHA and reviewed the complete base-to-candidate diff. The three changed paths are `apps/api/src/index.ts`, `tests/api-integration/helpers/legacy-ws-instance-server.ts`, and `tests/api-integration/legacy-ws-revocation.test.ts`.
- Read the repository operating workflow, active mission, realtime architecture contract, legacy authorization helper, project reach predicate, server shutdown code, all original cases in the modified integration file, and the new cross-process case.
- Traced `createNodeServer`'s optional `hostname` to the existing listener setup. Omission preserves the prior `serve` options and production default; the test child explicitly requests IPv4 loopback and validates the bound address before reporting readiness.
- Checked the real cross-process test sequence: shared database and Valkey configuration, remote user/project socket delivery, administrator sign-out invalidation, workspace-member removal with the direct project grant retained, and continued valid user-channel delivery. The role fixtures explicitly grant only `project:read` and `work_item:read`; the post-removal database assertions prove the workspace membership row is gone and direct project grant remains.
- Reviewed owned child cleanup paths (IPC stop, bounded TERM/KILL fallback, actual child exit receipt), socket cleanup, adapter shutdown, environment restoration, and exact Testcontainers stop/remove.
- `git diff --check <base> <candidate>` passed. Worktree was clean. I did not rerun integration tests or touch PostgreSQL, Docker, Valkey, browser, Git refs, or remote state.

## Runtime evidence attribution

The author/operator report `/Users/heinthura/.codex/taskdesk-evidence/2026-10-16/realtime632-accepted785-focused-pg-luna.md` records Vitest exit 0, 1 file / 14 tests passed, including all 13 retained same-process cases and the new cross-process case. The separately retained offline metadata proof `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/realtime632-corrected-offline-runtime-metadata-proof.json` confirms the raw Valkey inspect metadata, `org.testcontainers.session-id` label, loopback mapping, owned child exit code 0, owned PG/Valkey absence, and restored 23-container inventory.

The original wrapper exit 1 remains an authentic result: its post-run metadata validator expected the wrong Testcontainers label (`org.testcontainers.session` rather than actual `org.testcontainers.session-id`). The offline metadata evaluation corrected that attribution from retained inspect data; it did not rerun the test or erase the wrapper failure. I make no universal process-absence claim.

## Findings

No blocking or non-blocking correctness finding in the reviewed three-path delta. The test exercises cross-process transport and revocation through actual independent API processes and a real Valkey container while retaining the prior focused cases. The direct project grant remaining after workspace-member deletion is an intentional test condition that distinguishes loss of workspace reach from deletion of project grant data.

## Verdict

**CLEAR** for the ordinary review scope at exact candidate `0e9a6387c688305cfb59600622ace899549c5e99` against base `9f736c39d4310cde458d76e561b245619d08c3bd`.

This is not security clearance, issue closure, full integration acceptance, or acceptance of the original wrapper exit. Required independent GPT-6 Sol security review and remaining exact-head gates still apply.

## Retained report: realtime632-current-composition-full-security-61-sol.md

# Independent full security review — #632 current composition

**Reviewed head:** 0e9a6387c688305cfb59600622ace899549c5e99
**Comparison base:** 9f736c39d4310cde458d76e561b245619d08c3bd
**Reviewer/model:** GPT-6.1 Sol, fresh independent security reviewer context.
**Independence:** I did not author, direct, advise on, remediate, or ordinary-review this candidate. No source edits, Git mutations, publication, runtime execution, resource signals, or resource cleanup were performed by this reviewer.
**Verdict:** CLEAR for the full bounded security review of the complete three-path delta and its relevant caller/authorization/fixture interfaces. No blocking or non-blocking security finding.

## Scope and actual checks

I confirmed worktree HEAD is the exact requested SHA, read the complete base-to-head diff (400 insertions, 3 deletions), and ran git diff --check successfully. The worktree was clean. Changed paths are apps/api/src/index.ts, tests/api-integration/helpers/legacy-ws-instance-server.ts, and tests/api-integration/legacy-ws-revocation.test.ts. This is a bounded security-scope verification addition with an optional server binding parameter, not an authority redesign.

I read AGENTS.md, agent-workflow.md, CLAUDE.md, the status blocked/latest snapshot, decision-log opening entries, realtime architecture, live issue #632, and live open PR/issue listings. I inspected the ordinary CLEAR report, author runtime report, corrected offline metadata proof, retained raw focused test summary/exit/child receipt, retained safe Valkey inspect metadata, container inventories, and cleanup receipt. I traced the canonical project role fixture, native membership-removal HTTP helper, shared project socket authorization and workspace predicate, legacy authorization queue/reuse behavior, private control subscriber/reauthorization dispatch, real administrator session deletion and membership-removal invalidation callers, and createNodeServer production caller/shutdown behavior. I inspected all 13 retained cases and the new cross-process case. No tests were independently rerun; the assigned runtime window belongs to another lane.

## Security assessment

The optional hostname is forwarded only when supplied. The production caller still omits it, preserving its prior listener options/default. The independent child explicitly binds 127.0.0.1 and checks the actual bound address before IPC readiness. Neither cookies nor credentials are accepted through the new parameter, and no request-controlled configuration or authorization bypass is introduced.

The parent creates real actors and authority through existing helpers and executes real administrator sign-out and workspace membership removal routes. The child loads the actual API in an independent Node process, shares the configured database and real Valkey endpoint, and holds all four remote sockets. Successful user and project messages prove actual cross-process fan-out before revocation. Idle close assertions require code 1008 before any post-revocation broadcast, so per-event authentication alone cannot satisfy them; the five-second deadline is below the sixty-second fallback. Real post-commit control invalidation reaches fresh legacy checks in the remote process. User-channel delivery remains live after workspace removal, distinguishing scoped project reach loss from invalidating the whole identity.

The canonical role fixture provisions project-scoped project:read/work_item:read with seesAll false; it does not elevate either member to instance admin. Post-removal SQL proves workspace_user absence while a direct project membership remains. The actual project lookup independently requires workspace reach, so that retained grant cannot authorize the removed member's project socket. Assertions require allowed deliveries, idle closure, no subsequent received frames, and continued valid user delivery. The 13 earlier cases remain intact; adapter initialization moves into their common world helper rather than disabling assertions.

Valkey binds its published port to loopback. Child control uses its owned IPC handle; bounded shutdown signals only the owned detached process group if graceful IPC shutdown fails. The executed evidence records ordinary child exit 0, so fallback signals were not needed. Nested finally blocks cover child cleanup, adapter shutdown, environment restoration, and exact owned Valkey stop/remove. Child startup failures reject the parent readiness promise; stopping on error does not turn a failed startup into a passing test. No credential is emitted by the added child readiness or exit receipt. The test intentionally inherits the integration environment to share its isolated database; that environment is not printed.

## Runtime attribution and limits

Author/operator execution, not reviewer execution: retained focused.exit is 0 and focused.log reports 1 test file / 14 tests passed, including the new case and all 13 retained cases. Raw log contains owned child PID 43710, exitCode 0, signalCode null, exited true. The retained safe Valkey inspect record hashes to 2d70ba6b6452d189a1ab72ffe4d1e5b4fd0587d3a9294b7caeac81be14075b34, matching the corrected proof. It records Valkey 9, actual org.testcontainers.session-id, and 127.0.0.1:32784 mapping. Before/after inventories each contain 23 identical container records. Cleanup receipt reports the exact owned PostgreSQL and observed Valkey IDs absent.

Evidence sources: /Users/heinthura/.codex/taskdesk-evidence/2026-10-16/realtime632-accepted785-focused-pg-luna.md; /Users/heinthura/.codex/taskdesk-evidence/2026-10-16/takeover/realtime632-2f7ce739eb307a6d/; /Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/realtime632-corrected-offline-runtime-metadata-proof.json. Ordinary independent review: /Users/heinthura/.codex/taskdesk-evidence/2026-10-16/realtime632-current-composition-ordinary-luna.md.

The original wrapper EXIT 1 is retained and is not recast as success: its post-test validator expected org.testcontainers.session, whereas actual metadata uses org.testcontainers.session-id. The later offline metadata proof corrects that attribution using retained inspect data; it does not replace or rerun Vitest. Test-process-only Ryuk disabling and exact owned manual resource cleanup concern this local execution, not a product or CI gate waiver. No universal process absence is established. Earlier failed candidate/ordinary BLOCK history remains historical evidence, not current-head clearance.

No full integration suite, image build/boot, browser journey, CI acceptance, main compatibility with later changes, stage finalizer, or issue #632 closure is claimed. Accepted base source outside the three-path delta is examined only as needed for the interfaces described above; this review does not claim a fresh full review of all inherited source. Remaining exact-head CI and deployment gates still apply before acceptance.


## Conductor offline metadata receipt

```json
{
  "time": "2026-10-16T14:03:44.297202+00:00",
  "candidate": "0e9a6387c688305cfb59600622ace899549c5e99",
  "originalWrapperExit": 1,
  "focusedVitestExit": 0,
  "files": 1,
  "tests": 14,
  "correctedOfflineMetadataChecks": "PASS",
  "actualSessionLabelKey": "org.testcontainers.session-id",
  "valkeySession": "81ba50489028",
  "valkeyId": "407ccd6a8b87e935bbb3069b2d81b7597cf1d742678893f6b30f02aa158a7478",
  "loopbackPort": 32784,
  "baselineInventoryCount": 23,
  "currentInventoryEqualsBaseline": true,
  "ownedPgAndValkeyAbsent": true,
  "childReceipt": [
    "{\"event\":\"realtime632_owned_child_exit\",\"pid\":43710,\"exitCode\":0,\"signalCode\":null,\"exited\":true}"
  ],
  "noSignalsOrRuntimeRerun": true,
  "rawInspectSha256": "2d70ba6b6452d189a1ab72ffe4d1e5b4fd0587d3a9294b7caeac81be14075b34",
  "qualification": "Wrong-label wrapper assertion remains authentic exit1. This separate offline evaluation uses retained exact inspect and actual current inventory; no test result is inferred from wrapper exit. No global process absence, security clearance, issue closure or full integration acceptance."
}
```

**Reviewed head:** `0e9a6387c688305cfb59600622ace899549c5e99`


## Accepted #804 main composition — 2026-10-16

Normal composition c8430f2cc9e617a5c343324640d067a02adfd136 has parents review publication67a64238ae5d76c5aefb6a49d70ee20f8c4a2a69 and protected accepted804 main8c3456be02d6e81c76ed2b7fc35fa7b29850a0d4. The three source/test blobs and prior note are unchanged from67a; every other path matches accepted8c. Fresh independent strong ordinary import review and bounded independent Sol security composition confirmation CLEAR below. Original FULL three-path Sol review and author-executed14/14 remain source-bound, not new runtime on this composition. The prior attempted security context was interrupted with no report and does not count. Exact-head hosted CI, shipping-image build/boot/health, future accepted-main compatibility and integrated workflows remain required. Original post-test metadata wrapper1 and corrected offline proof retain their distinct meanings; no wrapper-success or global absence claim. No issue632, feature, stage, release or SIT acceptance.

### Authentic report: realtime632-accepted804-ordinary-luna.md

# #632 accepted-main import ordinary review

- **Model:** GPT-6 Luna
- **Role:** Strong independent ordinary reviewer
- **Context / independence:** Fresh reviewer context assigned by the conductor. I did not author, direct, advise on, or remediate this candidate or the imported project-creator work.
- **Exact candidate:** `c8430f2cc9e617a5c343324640d067a02adfd136`
- **Comparison base:** accepted main `8c3456be02d6e81c76ed2b7fc35fa7b29850a0d4`
- **Composition parent:** review publication `67a64238ae5d76c5aefb6a49d70ee20f8c4a2a69`; accepted main is the second parent.
- **Scope:** Exact import composition, unchanged #632 source and own review-note identity, main-relative changed paths, and compatibility of the accepted project-creator transaction with the legacy integration fixture seam. No source edits.
- **Risk:** Existing security-scope realtime integration proof imported onto newer accepted main. This review does not claim a fresh full review of every accepted-main change or whole-repository re-review.

## Checks performed

- Confirmed `HEAD` is exactly the requested candidate, with a clean worktree.
- Compared the three #632 source blobs and its own 370-line review-note blob between the publication parent and candidate. All four blob IDs are identical: `apps/api/src/index.ts` `14e756fc3745870826f5b6a9f23f4081f34618be`; helper `72f1880e8bec5197558879335a3f974b5fd61938`; integration test `819ee73c92055dcaa25b8a8217e899462e0db823`; review note `9dee6adfed1d65cba903b7fe9aa40ddf80adb1d0`.
- Compared candidate to accepted main. The only changed paths are those same three source/test paths plus the #632 proof note. Thus all imported accepted-main product, test, and record paths are unchanged.
- Read the prior full-source ordinary and GPT-6.1 Sol reports and own-note/custody proofs supplied for this composition, plus the complete current composition diff and the accepted project-creator controller/repository seam and relevant integration fixture helpers.
- Confirmed the cross-instance case uses `createProjectFixture`, which directly inserts a project and columns and therefore deliberately bypasses the newly accepted project-creation controller transaction. It then uses `grantProjectRole`, whose established contract inserts explicit project authority or widens an existing fixture role. The creator path's new transaction writes creator grants only for real controller-created projects; it does not alter the fixture helper or workspace creation/member invitation helpers used here. The #632 test's separate workspace-member removal and retained direct project grant assertions remain meaningful under that accepted behavior.
- Reviewed optional hostname forwarding: production call still omits it; the test child explicitly binds and checks `127.0.0.1`. No authority or listener-default change is introduced by the composition.
- `git diff --name-status 8c3456be02d6e81c76ed2b7fc35fa7b29850a0d4 HEAD` confirms the four-path bounded delta. `git diff --check` reports Markdown hard-break trailing spaces in the unchanged imported #632 review note at its report-field lines; this is report formatting and does not affect source behavior. I did not edit the authenticated note.
- No tests, API typecheck, PostgreSQL, Docker, Valkey, browser, build, CI, Git ref, or remote-state operations were run.

## Reused evidence and limits

The prior source-bound reports establish the full three-path review and actual focused run (14/14 tests) on `0e9a6387c688305cfb59600622ace899549c5e99` against `9f736c39d4310cde458d76e561b245619d08c3bd`. For the current candidate, reuse is limited to those unchanged blobs and the separately inspected project-creator seam. The supplied custody proof establishes the own-note addition is byte-identical and that the previous publication carried nine authentic reports; the supplied corrected offline metadata proof preserves the original wrapper exit failure and corrects only the retained metadata attribution. I do not claim a new 14/14 execution on this candidate, full integration acceptance, image/browser evidence, CI, issue closure, or stage completion.

## Findings

No blocking or non-blocking product correctness finding in the accepted-main import composition or its relevant fixture seam. The imported #632 source is byte-identical to the already reviewed source; all other current product paths match accepted main. The project-creator change is accepted-main content, and its runtime controller transaction is separate from the legacy direct-insert fixture path used by the new cross-instance proof.

## Verdict

**CLEAR** for the bounded accepted-main import and relevant project-creator/legacy-fixture compatibility scope at exact candidate `c8430f2cc9e617a5c343324640d067a02adfd136` against accepted-main base `8c3456be02d6e81c76ed2b7fc35fa7b29850a0d4`.

This ordinary review does not replace the fresh composition-specific GPT-6 Sol confirmation or remaining exact-head acceptance gates.

### Authentic report: realtime632-accepted804-security-resume-61-sol.md

# Independent security composition confirmation — #632 on accepted #804

**Reviewed head:** c8430f2cc9e617a5c343324640d067a02adfd136
**Comparison base:** 8c3456be02d6e81c76ed2b7fc35fa7b29850a0d4
**Publication parent:** 67a64238ae5d76c5aefb6a49d70ee20f8c4a2a69
**Model:** GPT-6.1 Sol (conductor dispatch identity; this context has no separate model-introspection API).
**Context:** /root/realtime632_accepted804_security_resume_sol, fresh independent security reviewer. I did not author, direct, advise on, remediate, or ordinary-review the candidate. No child reviewer was spawned. This report is a new completed review, not an approval inferred from the interrupted predecessor.
**Verdict:** CLEAR for the bounded security composition confirmation at the exact head and base above. No blocking or non-blocking security finding within this scope.

## Scope and checks actually performed

I read the candidate repository AGENTS.md, agent-workflow.md, CLAUDE.md and active mission, the fresh accepted804 ordinary report, previous full-source security report, relevant published note, custody and corrected offline metadata proofs. The scope is accepted-main import compatibility and the project-creator/create-query seam, not a fresh full security review of all accepted-main content. The prior full-source report remains labelled with its original head 0e9a6387c688305cfb59600622ace899549c5e99 and base 9f736c39d4310cde458d76e561b245619d08c3bd.

Read-only git commands in /Users/heinthura/.codex/worktrees/realtime632-cross-instance-luna confirmed clean HEAD c8430f2cc9e617a5c343324640d067a02adfd136, parents 67a64238ae5d76c5aefb6a49d70ee20f8c4a2a69 and 8c3456be02d6e81c76ed2b7fc35fa7b29850a0d4. Commands included git status --short, git show -s, git diff --name-status/--stat, git ls-tree, targeted source reads and rg. A Python subprocess assertion independently checked each main-relative changed blob against the publication parent. The only four changed paths are the three #632 source/test paths and its own note; all other paths match accepted main. All four blobs match the publication parent exactly:

- apps/api/src/index.ts: 14e756fc3745870826f5b6a9f23f4081f34618be
- tests/api-integration/helpers/legacy-ws-instance-server.ts: 72f1880e8bec5197558879335a3f974b5fd61938
- tests/api-integration/legacy-ws-revocation.test.ts: 819ee73c92055dcaa25b8a8217e899462e0db823
- docs/07-planning/security-reviews/realtime-632-cross-instance-proof.md: 9dee6adfed1d65cba903b7fe9aa40ddf80adb1d0

The note SHA-256 independently calculated is 2a27e643c9b8580e4c79aa4d420e87913fb9d0d8e6f182aa4204f48692c3d31d, matching supplied custody. Custody records nine authentic retained reports and a 370-addition/zero-deletion own-note publication. Identity hashes prove byte equality, not reviewer independence; origin verification remains the conductor's responsibility.

I inspected the accepted create-project controller and repository, fixture project insertion and explicit role grant, cross-instance scenario, child helper, child lifecycle, hostname forwarding and shared socket workspace lookup. The new accepted controller transaction performs creator locking/granting through repository queries. createProjectFixture directly inserts project and column rows and only imports the controller's DEFAULT_PROJECT_COLUMNS constant; importing that module performs no project creation or creator grant. grantProjectRole explicitly persists project:read/work_item:read authority with seesAll false. No new controller creator grant changes these test actors. The test's retained direct project membership after workspace removal remains a meaningful negative case because findSocketProject independently requires reachableWorkspacePredicate. The accepted creator repository split does not change that path or widen these actors to instance authority.

The optional hostname remains caller-supplied server construction configuration; the production caller omits it and its listener default is unchanged. The child explicitly binds and checks 127.0.0.1 before IPC readiness. It receives the shared isolated database/Valkey environment without printing credentials. Readiness is private IPC, cleanup targets its owned child/process group, and the actual cross-instance assertions still require initial delivery, idle close 1008 after real administrator sign-out and workspace removal, absence of subsequent frames, and continued valid user-channel delivery after scoped reach loss. No compatibility issue in these preserved mechanisms was found.

One initial read-only command accidentally used the default workspace and observed unrelated dirty state/HEAD; it did not edit anything. Those observations were excluded. All subsequent source conclusions above used the explicitly assigned clean worktree and exact candidate.

## Verification and evidence limits

No runtime tests, PostgreSQL, Valkey, Docker, browser, typecheck, build, full suite, remote GitHub operations, ref mutations or source edits were performed. git diff --check against accepted main exited 2 solely for existing Markdown hard-break trailing spaces in the byte-identical imported note at lines 144–148; I preserved that authentic record. This is not a product security finding.

The retained author/operator proof reports one focused file with 14/14 passing tests on the original reviewed source, Vitest exit 0 and owned child exit 0. It is reused here only as unchanged-source evidence, not new runtime execution on c8430f2. The original post-test wrapper exit 1 remains authentic: the wrapper expected the wrong Testcontainers label. The separate corrected offline proof identifies org.testcontainers.session-id and evaluates retained metadata; it neither reruns Vitest nor recasts the original wrapper as successful. I did not independently execute or reacquire those runtime receipts.

The fresh ordinary CLEAR report and prior full security CLEAR report were read as evidence with their stated scopes, not substituted for this independent seam inspection. This confirmation does not establish exact-head CI, image build/boot, complete integration/runtime acceptance, deployed SIT, issue #632 closure or any stage completion. Current required checks and image/runtime acceptance remain the conductor's work. No gate is waived.


**Reviewed head:** `c8430f2cc9e617a5c343324640d067a02adfd136`
