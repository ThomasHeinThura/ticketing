# Security review — service calendar management (#513)

**Reviewed head:** `35109d42b6cf3e21e5c5c37e79683766f447843a`
**Accepted comparison base:** `c1c820e86381b9ec199ede4f89a2bcd10147d44f`
**Reviewer:** fresh independent GPT-6 Sol context `/root/calendar513_351_sol_security`.
**Verdict:** **CLEAR for security at this exact source head. No blocking or non-blocking security findings.** This is the per-PR security review; it is not merge readiness, browser acceptance, H1 approval, or P2 stage completion.
**Full review:** [GPT-6 Sol review comment](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5387445863).

## Exact-head ordinary review chain

The three independent GPT-6 Luna reviews below each name exact candidate `35109d42b6cf3e21e5c5c37e79683766f447843a` and base `c1c820e86381b9ec199ede4f89a2bcd10147d44f`; each reports no blocking or non-blocking finding. The Sol review followed those reviews.

- [Review A — 5387405038](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5387405038): exact-head review; clear.
- [Review B — 5387417330](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5387417330): exact-head review; clear. Its scoped URL and pagination unit checks passed, 2 files / 15 tests.
- [Review C — 5387425283](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5387425283): exact-head review; clear. Its local focused CAL-16 attempt failed before setup because the inherited PostgreSQL rejected credentials; 1 selected test failed during setup and 16 tests were skipped, so no assertion was represented as passing. The exact-head hosted PostgreSQL 18 integration check was green.

## Scope checked

The full accepted-base-to-head file inventory and service-calendar API/policy/tenant/API-key authority, cursor SQL and workspace scoping, schema/migration/index, row locking and version checks, validation, audit/outbox transaction behavior, preview calculations, UI URL/query/cache/conflict recovery, and regression tests were examined against the feature spec, data model, API concurrency contract, ADR 0009, workflow, status, decision log, and CI security-scope paths.

- List seeks apply authorized workspace equality alongside forward/backward `(name,id)` boundaries. Page size is bounded at 1–200 (default 50); cursor fields, workspace, direction, and version are validated. Both directions return ascending rows and probe adjacent edges. The exact workspace total remains a scoped count; pages are not snapshots.
- Detail, update, and preview derive workspace from the stored calendar and hide inaccessible IDs as 404. List/create validate the requested workspace. API-key permission scope narrows canonical role authority; it does not grant it. The capabilities endpoint is session-only.
- PATCH compares optional quoted `If-Match` under a workspace-scoped row lock and increments version on success. A stale assertion returns 409 without calendar, audit, or outbox mutation.
- Create/update audit through a savepoint inside the mutation transaction and write the durable event envelope through the outer transaction. Outbox failure rolls back mutation and successful audit. Actor and scope come from persisted rows. No direct calendar DELETE route is exposed.
- The `0080_service_calendar` migration follows accepted `0079_task_version`; lifecycle timestamps are `timestamptz`. The composite `(workspace_id,name,id)` index matches cursor ordering.
- The list error state keeps Retry and offers Reset when a cursor remains in the URL; Reset clears it through registered navigation. The exact-source regression verifies Retry repeats the rejected 400 request before Reset returns to the first page.

## Checks and evidence actually used by Sol

- `CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/service-calendar.test.ts -t 'CAL permissions|API-key scope|EV-1'` — **1 file, 3/3 selected tests passed; 14 not selected**.
- The same CI/Testcontainers command with `-t 'CAL-14: serializes|CAL-15: rejects'` — **1 file, 2/2 selected tests passed; 15 not selected**.
- `pnpm --filter @taskdesk/api exec drizzle-kit check` — passed, “Everything’s fine”.
- `git diff --check c1c820e86381b9ec199ede4f89a2bcd10147d44f..HEAD` — passed.
- The exact-head hosted rollup observed PostgreSQL 18 integration, route policy/matrix, OpenAPI, build, unit/component, domain, G8, accessibility, and static checks green. These were observations of GitHub checks, not Sol executions.

## Residual gates and scope

AU-14 alerting metric and notification to every instance administrator remain incomplete. CAL-8 usage/affected-item count and safe deletion remain blocked on the approved pending-action path and missing SLA/project references; presets and import remain outside this slice. G11 is not enabled. The isolated Chrome live walkthrough remains blocked; fixture Playwright checks and API smoke are not manual browser acceptance. At review time the PR-template/security-review and GitGuardian checks were red. No gate is waived and no stage completion is claimed.

The preceding note-only candidate and review at `5cc4268617db51dc8fb3a5ed2bfb4ba1b3081b96` are retained below as historical evidence. This note binds the current verdict to source `35109d42b6cf3e21e5c5c37e79683766f447843a`; the note-recording commit must remain note-only.

## Historical Sol report — reviewed source `5cc4268617db51dc8fb3a5ed2bfb4ba1b3081b96`

- **Reviewer/model:** GPT-6 Sol, fresh independent context `/root/deps_519_sol_exact`. I did not author, direct, remediate, or merge this service-calendar candidate.
- **Exact candidate head:** `5cc4268617db51dc8fb3a5ed2bfb4ba1b3081b96` (confirmed in the clean worktree and live GitHub PR).
- **Comparison base:** accepted `main@b311c8cc6ba65906812eeafbf5783d2632dfee53`; `git merge-base(base, head)` is that base.
- **Ordinary review ordering:** the three independent GPT-6 Luna reports at `7ac2b4d58c020d995976bb1ce7d07d8fd9b659b2` are PASS (`/private/tmp/pr513-7ac2-luna-schema-delta.md`, `/private/tmp/pr513-7ac2-luna-ui-delta.md`, `/private/tmp/pr513-7ac2-luna-integration-delta.md`); the fresh bounded Luna confirmation at exact `5cc4268...` is PASS (`/private/tmp/pr513-5cc4-luna-final-delta.md`). I completed this Sol verdict after those ordinary clearances.

### Verdict

**CLEAR for security at the exact candidate head. No blocking security finding.** This is the per-PR security review, not P2 stage completion or permission to merge while required checks/acceptance remain open.

### Full review scope and conclusions

I reviewed the full accepted-main-to-head service-calendar diff, the canonical calendar/SLA/audit/event/API-concurrency/data-model contracts, the prior Sol note and three ordinary reports, the complete `0911590d..7ac2b4d5` recovery change, and the final `7ac2b4d5..5cc4268` composition. I traced calendar routes, policies, workspace reach, API-key narrowing, canonical capability checks, transaction/repository operations, migration/schema, lifecycle timestamps, audit/outbox writes, typed client, editor conflict recovery, focused tests, and runtime proof supplied by the orchestrator.

- **Tenancy/authority:** all five routes have policy entries. Detail/update/preview derive workspace scope from the persisted calendar row; inaccessible IDs produce the same 404 as missing IDs. List/create validate the request workspace before canonical role checks. API-key permission scopes narrow, rather than grant, `sla_policy:read/manage`; the canonical role check remains mandatory. The update repository selects by calendar ID **and** workspace ID. I found no request-controlled workspace substitution in calendar writes.
- **Concurrency:** PATCH parses a positive quoted optional `If-Match`, selects the workspace-scoped row `FOR UPDATE`, compares the version before mutation, increments it on success, and advances `updated_at`. A stale assertion returns 409 with both versions; the transaction leaves calendar, audit, and outbox unchanged. The UI's new conflict recovery waits for successful calendar and preview refetches and a returned calendar version at least as new as the 409 response before offering reload or draft resubmission. A failed refresh preserves the draft and requires retry. The server version check remains the final protection against a later competing writer.
- **Migration/time:** the new migration is `0080_service_calendar`, appended after accepted main's `0079_task_version`; 0080 snapshot parent is the 0079 snapshot ID, and the predecessor is unmodified. `created_at` and `updated_at` are `timestamp with time zone`. The focused PostgreSQL test asserts catalog types and a non-UTC instant round trip.
- **Audit/outbox:** create/update insert their audit row in a savepoint inside the mutation transaction; on audit insertion failure they log and commit the calendar mutation, as the explicitly partial AU-14 slice requires. They insert the catalogue event envelope through the durable outbox in the outer transaction; outbox failure rolls back mutation and any successful audit. Event workspace/organisation scope and person/API-key actor are resolved from persisted rows; API-key actor ID/name are verified in the same transaction. No direct calendar DELETE route is exposed.
- **Final bounded delta:** the only paths changed after the 7ac review are the approved list visual baseline and planning documents. The baseline SHA-256 is `8c187f3272b63975623145bdb10c8a0246c4acd987fe247d3b43e31cb291a12d`, matching the exact-7ac pinned Linux G8 artifact independently checked in the Luna report. API, permissions, schema, migration, domain, editor, tests, and translations are byte-identical to 7ac. The final main merge imports accepted planning status and preserves the decision-log clarification; it adds no calendar authority change.

### Checks and evidence actually used

**I ran at exact `5cc4268`:**

- Focused PostgreSQL 18 Testcontainers suite: `CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/service-calendar.test.ts` — **1 file, 16/16 tests passed**. This includes cross-workspace hiding, API-key scope/actor checks, row-lock/stale-version race, timestamptz round trip, audit failure savepoint behavior, and outbox failure rollback.
- `pnpm check:events` — passed; 31 published keys reconciled across 396 source files.
- `pnpm --filter @taskdesk/api exec drizzle-kit check` — passed, no schema drift.
- `git diff --check base..head` — passed; exact head/base/merge-base, file-delta and baseline SHA-256 checks passed. Worktree remained clean.
- Read live `gh pr checks 513`: enabled route-policy, static, registers, domain coverage, OpenAPI, unit/component, build, audit, CodeQL, and GitGuardian checks reported success at this head when sampled. Full PostgreSQL integration and G8 were still in progress. The PR-template/security-review check was red; G11 showed not enabled/skipped. This is a point-in-time snapshot, not a final merge-gate claim.

**Environment correction:** the first direct local integration command without `CI=true` attempted the worktree's configured local PostgreSQL credentials and all 16 cases failed during database setup with SQLSTATE `28P01` (password authentication failed). No application assertion executed. I reran using the repository's documented CI-only Testcontainers setup; all 16 passed. This is a local test-environment failure, not a suppressed candidate failure.

**Inherited, not my executions:** the independent integrated Luna reviewer ran the focused conflict-hook tests (1 file, 4/4) at 7ac. The orchestrator supplied an isolated image build/boot proof for the byte-identical 7ac runtime (`/private/tmp/pr513-7ac2-image-boot-health.json`: image healthy, `/`, liveness and readiness HTTP 200) and isolated API proof (`/private/tmp/taskdesk-pr513-smoke-726c/calendar-http-proof.json`: supported first-run admin, workspace/calendar create 200, preview, winning PATCH 200, stale PATCH 409 without mutation, final version 2). I inspected these records but did not execute their commands. Browser verification remains blocked by the extension popup; neither record is browser evidence.

### Findings, residuals and gates

- **Blocking security findings:** none at this exact head.
- **Non-blocking/unfinished scope:** AU-14's alerting metric and notification to every instance administrator are not implemented; the slice explicitly records error logging only and does not claim AU-14 acceptance. Runtime outbox delivery/consumers, calendar usage/counts, safe deletion, presets, cloning, and import remain outside this slice. No live browser interaction was verified. The current PR body/security note still need exact-head evidence reconciliation, and all required exact-head CI and browser/G8 gates must be checked independently before merge.
- **No gate waived.** This verdict does not turn a red template check, pending G8/integration run, or blocked browser acceptance into a pass.


### Historical review record — earlier source, retained for attribution

#### Earlier recorded review

**Reviewed head:** `41c0c8605d3c7d4c1da019f3779ebd4eeba6f205`

**Reviewer:** Independent GPT-6 Sol context `/root/p2_513_sol_security`.
**Verdict:** CLEAR for security at the reviewed code head; no blocking finding.
**Full review:** https://github.com/ThomasHeinThura/ticketing/pull/513#issuecomment-5920072137 at `7b408df6f51fb281cd092650720e7ec02f1230ab`.
**Exact-head delta confirmation:** https://github.com/ThomasHeinThura/ticketing/pull/513#issuecomment-5920238554 at `41c0c8605d3c7d4c1da019f3779ebd4eeba6f205`.

### Scope and evidence

The full Sol pass inspected calendar routes, workspace and role reach, API-key
scope and actor attribution, event and audit writes, timezone validation,
schema and migration `0079_service_calendar`. It ran PostgreSQL calendar
integration tests (15/15), calendar domain tests (66/66), route-policy tests
(83/83), `check:events`, a Drizzle schema-drift check, and `git diff --check`.
The reviewer found no blocking security issue. API-key PATCH actor attribution
has no focused regression test; that is recorded as nonblocking.

The later ordinary Luna review at
https://github.com/ThomasHeinThura/ticketing/pull/513#issuecomment-5920228733
and the Sol delta confirmation checked the merge from `main` at
`9e3e8860b1b2060bbb11d78629d3ae879fcbb4f1`. It added only
`docs/07-planning/status.md` and the deterministic workspace-slug test;
calendar source, schema, migration and contract are unchanged from the full
Sol-reviewed head. The Sol reviewer rechecked the exact candidate SHA and
`git diff --check` passed.

### Residuals and merge gate

CAL-8 affected-item count remains blocked on issue #437 and the missing SLA
policy. AU-14 alerting and instance-administrator notification infrastructure
are incomplete. Direct DELETE remains withheld pending the approved
pending-action route. Runtime outbox delivery and calendar usage/counts are
outside this bounded candidate.

This note records the security verdict, not phase completion or merge
clearance. At the exact-head delta review, the PR-template/security-review
check was red and PostgreSQL integration was in progress. Required CI,
browser evidence, and the final candidate checks remain merge gates.
