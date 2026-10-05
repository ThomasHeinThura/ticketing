# Security review — service calendar management (#513)

## Current exact-head binding — 2026-10-02

**Reviewed head:** `7fde02c99653fc266930ea02e01a9553a273d946`
**Accepted comparison base:** `47bda77d6e00521847b8202ae335301cac72709f`
**Ordinary review:** independent GPT-6 Luna review [5388272407](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5388272407), CLEAR at 04:18:17 UTC on this exact head.
**Security review:** independent GPT-6 Sol review [5388292487](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5388292487), CLEAR at 04:23:02 UTC on this exact head, after the ordinary review.
**Current verdict:** CLEAR for the reviewed source delta; no blocking or non-blocking finding identified. The prior d855 reviews below remain bound to d855 only.

The bounded source delta bypasses automatic query retries for deterministic rejected-cursor HTTP 400 responses and delegates other errors to the shared retry policy. Network, 401, 429, and 5xx retry behavior remains governed by that policy. Manual Retry and Reset remain available. The current exact-head check evidence is changed-file Biome (3 files), web typecheck, and service-calendar E2E 9/9 with two workers. The independently selected SQL-NULL regression passed 1/1 in real PostgreSQL 18 (17 filtered); the other filtered cases are not counted as passes. The hosted predecessor trace belongs to PR #512 run 36961266798/job 110695264637 on `eaec8aea375dd32814a6d71ec8f98ec709ed888d`: 1 failed, 10 passed; three deterministic 400 responses left the list loading through the five-second assertion. The one-test local baseline passed and is recorded as timing sensitivity, not a failed local reproduction.

This note update changes documentation only. It does not alter application source, schema, migration, routes, or dependencies. It records these exact-head review bindings and does not claim browser acceptance, G11, H1, stage completion, merge readiness, or completion of the AU-14 metric/administrator notification, CAL-8 usage and safe-deletion, PA-6 pending-action, or #570 native WebSocket/outage-indicator work.

## Prior exact-head review record — d8557d0e149b0b901c73ebfa151a84e653bf2376

**Reviewed head:** `d8557d0e149b0b901c73ebfa151a84e653bf2376`
**Accepted comparison base:** `47bda77d6e00521847b8202ae335301cac72709f`
**Reviewer:** fresh independent GPT-6 Sol context `/root/calendar513_351_sol_security`; this reviewer did not author, direct, or remediate the SQL-NULL fix.
**Sol verdict at reviewed head:** **CLEAR for security at exact source `d8557d0e149b0b901c73ebfa151a84e653bf2376`; no blocking or non-blocking security finding identified.**
**Full review:** [GPT-6 Sol review 5387701727](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5387701727).

## Exact-head ordinary review chain

Both fresh independent GPT-6 Luna contexts reviewed exact source `d8557d0e149b0b901c73ebfa151a84e653bf2376` after the SQL-NULL correction and reported no findings. The Sol security review followed both genuine exact-head ordinary reviews.

- [Review A — 5387667528](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5387667528): exact-head authorization-delta review; no findings. Six in-process scope-boundary assertions passed. Its two focused PostgreSQL attempts failed before assertions because the inherited PostgreSQL password was rejected with SQLSTATE `28P01`; those attempts are **not passes**. The reviewer did not claim the integration assertions passed.
- [Review B — 5387681960](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5387681960): exact-head authorization-delta review; no findings. The focused SQL-NULL API-key scope regression passed **1/1** in isolated PostgreSQL 18; 17 other tests were filtered and are not counted as passes.
- [GPT-6 Sol security review — 5387701727](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5387701727): full independent review of the exact candidate and accepted-base-to-head scope; CLEAR for security.

## Current SQL-NULL finding and remediation

The earlier independent finding on source `35109d42b6cf3e21e5c5c37e79683766f447843a` remains historical and is preserved below. That source treated a stored SQL-NULL API-key permissions map as unrestricted. The exact-head fix in `d8557d0e149b0b901c73ebfa151a84e653bf2376` distinguishes absence of an API-key context (session) from a present key with null or undefined permissions, and denies the latter. Explicit key permissions still narrow, rather than grant, the canonical workspace capability. The added SQL-NULL regression asserts POST and PATCH denial and unchanged calendar, audit, outbox, and event state. The current ordinary B review and Sol review independently checked this remediation; A's `28P01` integration attempt is not represented as a pass.

## Scope checked by the Sol reviewer

The reviewer checked the accepted-base-to-head inventory; calendar API authentication and key parsing; workspace reach; API-key scope narrowing and canonical role checks; route policies; handlers and repository writes; audit and outbox effects; migration, schema and index; cursor/preview behavior; URL/cache recovery; and the relevant feature, API, data-model, ADR-0009, AK-3/AK-9, RBAC, workflow and CI security-scope contracts. The source delta after `35109d42b6cf3e21e5c5c37e79683766f447843a` changes the key-scope helper and SQL-NULL integration regression, plus planning/security-note records; calendar schema, migration, routes, repository, UI and domain are unchanged from that source.

For a session without API-key context, the helper passes only its narrowing layer and the route still evaluates the caller's current workspace capability. For bearer and `x-api-key` requests, the authentication path preserves stored SQL NULL; the helper denies it. Missing required resource/action entries in a non-null permission map also fail. A read-only key cannot create or update; an explicit manage scope remains subject to the caller's current role. The regression requires POST/PATCH 403 and unchanged calendar, audit, outbox and emitted-event snapshots. The separate canonical workspace-capability check continues to prevent a manage-scoped key owned by a viewer from writing.

Collection routes validate request workspace before authorization. Detail/update/preview derive workspace from the persisted calendar and mask foreign or absent rows as 404. PATCH locks the workspace-scoped row, compares `If-Match`, and writes audit/outbox only after authorization. No direct DELETE route exists. The migration's workspace foreign key and `(workspace_id,name,id)` index and the collection workspace predicate are unchanged. No alternate calendar route bypasses the corrected helper.

## Checks and evidence actually used by Sol

- `CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/service-calendar.test.ts -t 'AK-3/AK-9: denies|API-key scope narrows'` — **2/2 passed**, 16 filtered, one file, isolated PostgreSQL 18 Testcontainers. The tests cover actual SQL NULL, POST/PATCH 403 with unchanged calendar/audit/outbox/event state, read-only denial, explicit manage acceptance and viewer-role denial.
- `git diff --check 47bda77d6e00521847b8202ae335301cac72709f..HEAD` — passed in the reviewer's exact-source checkout.
- Live exact-head PR and review metadata were verified. At review time, hosted PostgreSQL 18 integration, route policy/matrix, unit, domain, OpenAPI, G8 and image-build checks showed success. These hosted checks and author-reported full calendar/unit/permission/typecheck/Biome/image evidence are external evidence, not Sol executions. Sol did not rerun broad suites or build/boot an image.

## Residual gates and scope

The live PR is blocked by the PR-template/security-review and GitGuardian failures. G11 is disabled/skipped on accepted `main` and is not acceptance evidence. This note does not mark the manual browser walkthrough or H1 complete. The following remain open and are not waived: live browser use; light/dark review; 200% zoom; density preference; AU-14 alerting metric and administrator notification; PA-6 pending-action-backed deletion; project/SLA usage references, imports and presets; error-state/dependency and documentation follow-through recorded by the feature/PR; and G11. CAL-8 affected-item counts and safe deletion remain blocked by the missing project/SLA references and pending-action path. No H1, stage completion, merge readiness, gate waiver, or product-browser verification is claimed.

The two current Luna reviews and the Sol review are bound to source `d8557d0e149b0b901c73ebfa151a84e653bf2376`; the follow-up commit recording this note must remain note-only. Historical review records and the missed source-351 blocker below are retained as history, not rewritten as current clearance.

## Historical review record — pre-fix source `35109d42b6cf3e21e5c5c37e79683766f447843a`

The three original independent GPT-6 Luna reviews were [A, 5387405038](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5387405038), [B, 5387417330](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5387417330), and [C, 5387425283](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5387425283). Each reviewed source `35109d42b6cf3e21e5c5c37e79683766f447843a` against accepted base `c1c820e86381b9ec199ede4f89a2bcd10147d44f` and reported no finding. Review C's focused CAL-16 local attempt failed during inherited PostgreSQL setup with SQLSTATE `28P01`; it did not pass an assertion. The exact-source hosted PostgreSQL 18 check was observed separately.

The historical independent GPT-6 Sol review [5387445863](https://github.com/ThomasHeinThura/ticketing/pull/513#pullrequestreview-5387445863) also recorded CLEAR at source `35109d42b6cf3e21e5c5c37e79683766f447843a`. That review **missed** the SQL-NULL API-key scope flaw later independently reported in [PR #512 Review A, 5387504107](https://github.com/ThomasHeinThura/ticketing/pull/512#pullrequestreview-5387504107), on source `3e02b45e7f3b46bda94c8eaad52df5b88acc9145`. The vulnerable helper blob `7e58f18797e81e88a525f4c8c0885e72eb62ee4c` was identical in #513 source `35109d42b6cf3e21e5c5c37e79683766f447843a`; stored SQL NULL was treated as unrestricted, allowing a sufficiently privileged key to reach calendar POST/PATCH without an explicit stored write subset. This was a real permission-boundary blocker despite the earlier clear verdict. The `d8557d0e` fix and exact-head reviews are documented above; this historical miss is retained and is not current clearance for source `35109d42`.

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
