# Activity write ownership — independent review record

This record binds independent reviews to the source head below. Its publication commit adds only this note; the pull request includes five reviewed source/test paths and this note.

**Reviewed head:** `bb3112dc3131f60db65adf7292cfd06ea07fe8b5`
**Security review model:** GPT-6 Sol
**Security review session:** `01a14f94-0353-7240-82d5-8f942a0b798a` (native provenance records configured `gpt-6-sol`, high reasoning effort; served weights are not attested)
**Verdict:** CLEAR at the current source head. The full independent Sol review at 9d60 and its independent bb311 follow-up cover the unchanged activity source and the one-line fixture correction; both authentic reports are retained below.

## Reviewed source and surfaces

The activity source initially reviewed at `9d60e5ab264e6bec4fe16cf9e5275e2b474032b2`, tree `872ae651bb6632316edc5444b0e0a2193545fc92`, is a merge commit with source parent `6ce98d1657acf45c45ad7061bcaba9c772c4cc00` and accepted base `46e55d2da2e40e3fbd281d2bc29ba876ab52170a`. Its full `apps/api` subtree is `a118da01febd69b2b1d94c59026601e13dd69745`; `apps/api/src/activity` is `c3df8abfca95794c1fe8de9cac93abea8bf925f1`.

The four candidate-owned source/test paths are `apps/api/src/activity/repository.ts`, `apps/api/src/activity/controllers/create-activity.ts`, `apps/api/src/activity/index.ts`, and `tests/api-integration/activity-write-repository.test.ts`. The subsequent 6ce9-to-9d60 accepted-main composition adds only `tests/api-integration/leaf-module-repositories.test.ts` and its review note. The root source-conservation receipt says accepted-main non-owned source tuples were conserved. Current source `bb3112dc3131f60db65adf7292cfd06ea07fe8b5`, tree `85457cc57b2b3228dad92c8ce7a1db92431ce646`, is the sole child of 9d60. It additionally corrects one artificial metrics listener in `tests/api/mfa-csrf-app-fixture.test.ts` to the exact loopback lease address. All activity source, both PG test inputs, timeout/sentinel/stale-lock assertions and production helpers are conserved. The pull request has five source/test paths plus this new review note.

The full Sol review examined request identity and authorization, current persisted reach, task-then-project transaction locks, live-project enforcement, public insert projection and response persistence, trusted task-event subscriber writing, and the archive/deactivation race. The public create path keeps the existing route reach/permission middleware and resolves identity from authenticated request context. Its live/reach checks and insert use the same transaction executor. The subscriber-only writer remains a distinct INSERT VALUES RETURNING path, without reading or discovering existing rows, preserving already-emitted task-event history when delivery occurs after archive or actor deactivation. The exact contracts and limits are in the verbatim review below.

## Runtime evidence and limits

Root-owned native PostgreSQL evidence at `6ce98d1657acf45c45ad7061bcaba9c772c4cc00` reports exit 0, two complete integration files, 25 passed, zero failed/skipped/cancelled. It ran `activity-write-repository` and `project-archive-freeze-legacy`; the preserved archive-freeze file is byte-identical. The API subtree and those test inputs are unchanged in 9d60, but the run was **not** repeated at 9d60 and is not an exact-head CI result. The 9d60 Sol reviewer did not run tests. The earlier 6739 run genuinely failed before its deliberate rollback with Drizzle's selected-field order/shape error; the later full-column projection and successful-response persistence regression repaired that failure. Both records are retained below.

The successful 6ce9 runtime was isolated with source pre/post checks, matching Docker inventory, and exact owned-container cleanup receipts included below. The host Gitleaks scan for the three-commit `46e55..9d60` source range returned native exit 0 and “no leaks found”. This is source-history evidence, not current hosted CI.

At bb311, root ran lint, full typecheck, full unit/component tests and permissions sequentially: all four commands exited 0 with source conserved. Unit/component tasks passed 12/12: API121 files/872 tests, UI61/325, web186/1,027; the MFA fixture passed all11 cases. Permissions passed5 tasks and16 files/107 tests. The earlier 9d60 full unit and isolated MFA runs failed the stale-lock case; those records are retained. A four-case native network probe showed wildcard and loopback could coexist on this Darwin/Node26.10 host, while duplicate exact-host binds returned EADDRINUSE. The corrected test models the actual loopback lease and preserves every denial/assertion. Current exact-head hosted CI, image build/boot/health and migration smoke remain pending. No browser verification applies because no UI path changed. This note claims no merge readiness, whole #580, stage/SIT acceptance or query-gate activation.

## Review evidence (authentic payloads, verbatim)

The following reports and JSON receipts are copied verbatim from their evidence files, each once. They are evidence records with their original labels and limitations intact; the prior blocked finding is included as history, not as current status. The 29,809-byte raw failed-run log is retained privately; its failure and runtime summary are excerpted below with the structured result.

### Original ordinary-A blocked report at 6739 (corrected v2)


````markdown
# Ordinary review A — activity write repository extraction

**Verdict: BLOCKED — one confirmed blocking defect at the reviewed head.**

## Source and independence

- Candidate: `67398512774b0b01400b72488a20b1a7635a6ce4`
- Candidate tree: `a5290d3ed7565e597611d6834146f386b02a07c9`
- Comparison base: `2cd47571e4a9d39c437bbe23c61a3a4911720fdc` (tree `b83cbd0a061418713a69883b385512ee91662921`)
- Worktree: `/Users/heinthura/.codex/worktrees/query580-role-assignment-ownership/Ticketing.v2`
- `HEAD` exactly matched the candidate and `git status --short` was empty. Candidate tree matched the assigned tree. Base is an ancestor of candidate.
- I did not author, direct, or remediate this candidate and am independent of its author and the conductor. I read the separate GPT-6.1 Sol material interpretation as requested, but treated it as non-approval and independently checked the relevant current code, specs, and regression. I did not rely on its statements as source proof.

## Blocking finding

**B1 — public activity writes throw before SQL because the `INSERT … SELECT` projection omits table columns.** In `apps/api/src/activity/repository.ts:56-73,90-93`, `selectedActivity` supplies only `id`, `taskId`, `type`, `createdAt`, `updatedAt`, `userId`, `content`, and `eventData`. `taskActivityTable` has twelve columns; it also has `externalUserName`, `externalUserAvatar`, `externalSource`, and `externalUrl` (`apps/api/src/database/schema.ts:1158-1191`). Drizzle's insert-select shape check requires the selected fields to match the table definition in exact order. The captured real PostgreSQL integration run fails in the transaction-executor regression with: `Insert select error: selected fields are not the same or are in a different order compared to the table definition`. This occurs before its deliberate rollback exception. The public route calls this helper, so a valid, live, reachable public create request cannot reach the insert successfully; existing negative/revocation and archive cases return before this statement and do not cover the failure.

This is a runtime correctness failure, not merely an assertion mismatch. The candidate cannot clear ordinary review until the projection is repaired and an actual successful public request verifies the persisted row and returned full response/default fields. The pre-existing `authorization-boundaries.test.ts` success case checks actor mapping but was not included in the captured two-file run and does not assert persistence/default columns.

## Checks and scope

- Read-only source checks: exact `HEAD`, clean status, base ancestry, candidate tree, and four-path diff. The changed paths are exactly `apps/api/src/activity/{repository.ts,controllers/create-activity.ts,index.ts}` and `tests/api-integration/activity-write-repository.test.ts`.
- Compared the inherited freeze regression at base and candidate: both have Git blob ID `1368b207c9d8f69f57b5819ba5c83bb5377d7e29` (40-hex Git object ID) and raw-file SHA-256 `82a3f705a88c1bc0679c48c936084c52016a8f88ce24ae978cea83a63e737c65` (64-hex digest); the required `project-archive-freeze-legacy.test.ts` is byte-identical.
- Inspected current coding standards query ownership, multi-tenancy scoping, security-model reach/404 contract, activity policy/route, request identity adapter, identity reach predicate, task repository lock helper, `task_activity` schema, the decision-log activity contract and archive regression.
- Rechecked the intended trust boundary: public route reconstructs the resolved identity from effective `userId`, API-key permission scope, and impersonation session marker; both task-row lock and project-live/reach checks take the caller executor in task→project order; the final public insert repeats live/reach in its statement. I found no separate defect in that path by inspection, but the insert-shape failure prevents runtime confirmation of the successful case.
- The subscriber path remains a separate `INSERT … VALUES … RETURNING` using only trusted event data and shared `db`; it does not look up or re-resolve identity/reach. The new committed-event regression and the unchanged archive-freeze file passed in the captured run, supporting preservation of late archived/deactivated-actor history.
- Read the exact candidate-bound raw capture at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/query580-activity-write-implementation-luna/runtime-preparation-luna/run-output/`. Actual invocation selected two complete integration files: `activity-write-repository` had 4 runtime tests, `project-archive-freeze-legacy` had 20; observed result was 23 passed, 1 failed, 0 skipped/cancelled, exit 1. The separate `static_test_declarations` value of 24 is a source-derived declaration count, not the runtime result.
- I did not run tests, compilers, Docker, browser commands, or mutate the repository. The runtime result above is the author/conductor's retained, candidate-bound capture, not a run I personally executed.

## Non-blocking coverage note

The new file has no successful public create case that asserts both database persistence and the returned full `task_activity` row. Add that assertion with the projection repair; it should catch omitted nullable/defaulted fields and response-shape regressions. The existing archive-race and trusted-subscriber behavior is appropriately preserved.

## Limits

This is ordinary review A only. It is not a security review, phase finalizer, runtime rerun, PR approval, or authorization for another SHA. Any repair changes the candidate; this verdict covers only `67398512774b0b01400b72488a20b1a7635a6ce4`.


**Provenance correction (2026-10-18 follow-up).** The original report above mislabeled a raw-file SHA-256 digest as a Git blob ID. The corrected 40-character Git object ID is `1368b207c9d8f69f57b5819ba5c83bb5377d7e29`; the `82a3…` value is SHA-256 over file bytes. This erratum preserves the original report and its verdict; it does not represent a new source review.
````

### Ordinary-A follow-up at 6ce9


````markdown
# Ordinary review A follow-up — activity write repository

**Verdict: CLEAR for ordinary review A at this exact candidate.** This supersedes the blocked verdict for the prior candidate only after reviewing the current delta and its candidate-bound completed runtime evidence. It does not clear any later SHA or fill another review tier.

## Source and independence

- Candidate: `6ce98d1657acf45c45ad7061bcaba9c772c4cc00`
- Candidate tree: `57027b8cf2a2417df4eb294484689ed302b6541a`
- Comparison base: `2cd47571e4a9d39c437bbe23c61a3a4911720fdc`
- Delta parent: previously reviewed, blocked `67398512774b0b01400b72488a20b1a7635a6ce4`
- Worktree: `/Users/heinthura/.codex/worktrees/query580-role-assignment-ownership/Ticketing.v2`
- `HEAD` and tree matched the assignment; status was clean, and the base is an ancestor. The only delta paths from the blocked candidate are `apps/api/src/activity/repository.ts` and `tests/api-integration/activity-write-repository.test.ts`.
- I did not author, direct, or remediate the candidate and am independent of its author and the conductor. This is the same ordinary-review context following up its own prior finding; it is not a fresh second ordinary reviewer or a security review.

## Delta disposition

The prior blocker B1 is resolved. The public `INSERT … SELECT` projection now lists all twelve `task_activity` fields in schema order; the four nullable external-import fields are explicit SQL `NULL`s. The previous runtime shape exception is absent in the exact-head captured run, and the new public route regression reaches a successful response, reads the persisted row, checks all four null fields, and compares the complete response against the stored row with serialized timestamps.

I found no new blocking issue in these two changed files. On the full current source, the previously reviewed identity/reach and task→project-lock/live checks, the separate subscriber-only insert, and frozen archive behavior remain unchanged. The public identity is still resolved from effective request user, API-key scope, and impersonation marker; current project reach remains in the task lock and the final insert predicate.

## Runtime and other checks

- I did not execute tests or compiler commands. I read the candidate-bound raw capture at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/query580-activity-write-implementation-luna/select-shape-success-regression/runtime-root/run-output/`.
- The actual invocation ran two complete integration files. Runtime output reports 2 files passed and 25 tests passed, with 0 failed, skipped, or cancelled; process return code is 0. The 25 count is verified in the Vitest runtime summary. The separate source-derived static declaration count is not used as a runtime result.
- The full `project-archive-freeze-legacy.test.ts` suite completed as part of this exact run. Candidate preflight/postflight both identify `HEAD=6ce98d1657acf45c45ad7061bcaba9c772c4cc00`, tree `57027b8cf2a2417df4eb294484689ed302b6541a`, clean status and unchanged owned-source hashes.
- The preserved freeze regression has the same Git blob ID at base and candidate: `1368b207c9d8f69f57b5819ba5c83bb5377d7e29`. Its raw-file SHA-256 is `82a3f705a88c1bc0679c48c936084c52016a8f88ce24ae978cea83a63e737c65`.

## Limits

This clears only ordinary review A on the exact SHA above. The required second fresh ordinary context and the separate security-tier Sol review remain distinct gates. Any new source commit requires review at its resulting exact head.
````

### Independent ordinary-B review at 6ce9


````markdown
# Independent ordinary review B — #580 activity write extraction

**Verdict: CLEAR** for the bounded four-file candidate at the exact source below. No blocking or non-blocking code findings.

## Candidate and independence

- Candidate: `6ce98d1657acf45c45ad7061bcaba9c772c4cc00`
- Candidate tree: `57027b8cf2a2417df4eb294484689ed302b6541a`
- Base: `2cd47571e4a9d39c437bbe23c61a3a4911720fdc`
- Review context: GPT-6 Luna, ordinary review B; independent from the implementation context and remediation. I made no candidate edits, commits, pushes, or GitHub changes.
- Checkout status at review: clean, branch `codex/query580-activity-write-ownership-20261018`.
- Scope inspected: `apps/api/src/activity/repository.ts`, `apps/api/src/activity/controllers/create-activity.ts`, `apps/api/src/activity/index.ts`, and `tests/api-integration/activity-write-repository.test.ts`, plus the applicable query-ownership, identity, activity, and archive contracts and cited call paths.

## Review

The public create path keeps authorization and persistence distinct. The route resolves the request identity from the authenticated `userId`, optional authenticated API key scope, and session impersonation marker. Its existing workspace reach and permission middleware remain in place. Inside the write transaction, the repository locks the task using the resolved identity and a current persisted reach predicate, then takes a shared lock on a live, reachable project row. The insert is another identity/reach-constrained statement using the same executor. Missing or newly unreachable task/project rows return the established indistinguishable 404 before a row is written. The task-then-project order and `FOR SHARE` liveness guard match the existing project-freeze contract, while the archive route's conditional project update serializes against that guard.

The public insert-select explicitly projects the existing row shape, including the four nullable external-user fields, and reproduces the old ID/timestamp defaults. The integration regression compares the HTTP response with the complete persisted row, including those null defaults. The controller passes the same transaction executor through both repository operations; the rollback integration case checks that the insert participates in its caller's transaction.

The internal event subscriber uses a separate repository entry point with the narrow `INSERT ... VALUES ... RETURNING` shape. Its sole production caller is `recordTaskEventActivity`, imported by the trusted event subscriber module; the public route calls the identity-scoped function instead. The internal insert does not read or discover an existing row, so this preserves the reviewed legacy event behavior where a previously committed task event is recorded after project archive or actor deactivation. The existing archive-freeze regression file's Git blob remains `1368b207c9d8f69f57b5819ba5c83bb5377d7e29`.

Credential handling is coherent by inspection: session and impersonation requests resolve the authenticated target user with the matching credential kind; API-key requests pass the authenticated key owner and key permissions through `resolveRequestIdentity`, whose key scope narrows canonical capabilities. The SQL predicate then independently checks current persisted reach. No user-supplied `taskId` reaches the subscriber-only writer. The new reach-revocation regression proves stale resolved identity cannot write after persisted membership removal, and the existing archive race regression covers the live-parent denial. The existing authorization-boundaries suite also asserts that a request-supplied spoofed `userId` does not replace the authenticated activity actor.

## Checks and limits

I did not execute tests or compilers. I inspected the root-owned exact-candidate PostgreSQL capture after completion: `vitest-result.json` binds the run to this candidate and reports exit code 0; `vitest.full.log` reports 2 files and 25 tests passed, 0 failures. The raw log SHA-256 is `906b25fc75315ee747aa2c8e5791916b758d1a7ddc867add019b0c4ccfd80cac`. This is root-run evidence, not a test run by this review context. This review does not claim API-key or impersonation behavior was independently exercised by the newly added test file; those request-identity branches were checked by source inspection, while the broader existing authorization tests provide the authenticated-actor regression noted above. This is ordinary review only and does not substitute for the required full GPT-6 Sol review or exact-head CI gates.
````

### 6739 actual failing-run result JSON


````json
{
  "candidate": "67398512774b0b01400b72488a20b1a7635a6ce4",
  "pid": 21123,
  "argv": [
    "pnpm",
    "--filter",
    "@taskdesk/api",
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.integration.config.ts",
    "../../tests/api-integration/activity-write-repository.test.ts",
    "../../tests/api-integration/project-archive-freeze-legacy.test.ts"
  ],
  "cwd": "/Users/heinthura/.codex/worktrees/query580-role-assignment-ownership/Ticketing.v2",
  "start_utc": "2026-10-18T15:05:52.719493+00:00",
  "end_utc": "2026-10-18T15:06:06.699269+00:00",
  "returncode": 1,
  "timed_out": false,
  "timeout_seconds": 900,
  "duration_seconds": 13.98,
  "CI_in_child": "absent"
}
````

### 6739 failure and runtime summary excerpt (spacing normalized)


````text
FAIL  ../../tests/api-integration/activity-write-repository.test.ts > legacy activity write repository > uses the caller's transaction executor for the live check and insert
Expected: "rollback activity transaction"
Received: "Insert select error: selected fields are not the same or are in a different order compared to the table definition"
Test Files  1 failed | 1 passed (2)
Tests       1 failed | 23 passed (24)
Duration    12.62s (transform 1.43s, setup 28ms, import 3.45s, tests 8.79s, environment 0ms)
````

### Root-verified successful PostgreSQL run at 6ce9


````json
{
  "at": "2026-10-18T15:16:25.219992+00:00",
  "candidate": "6ce98d1657acf45c45ad7061bcaba9c772c4cc00",
  "tree": "57027b8cf2a2417df4eb294484689ed302b6541a",
  "nativeExit": 0,
  "completeFiles": 2,
  "runtimeTestsPassed": 25,
  "testsFailed": 0,
  "skipped": 0,
  "cancelled": 0,
  "wallSeconds": 14.248,
  "vitestReportedSeconds": 12.93,
  "rawLog": {
    "bytes": 27842,
    "sha256": "906b25fc75315ee747aa2c8e5791916b758d1a7ddc867add019b0c4ccfd80cac"
  },
  "sourceConserved": true,
  "dockerInventoriesConserved": true,
  "privateEnvRemovedWithoutReadOrHash": true,
  "scope": "Complete activitywrite5 and archivefreezelegacy20 only; not whole580 or current9d60 rerun; API and those testfiles unchanged in9d60 composition. APIkey/impersonation were sourceinspected, not separately exercised by this newtestfile."
}
````

### 6ce9 Vitest runtime result


````json
{
  "candidate": "6ce98d1657acf45c45ad7061bcaba9c772c4cc00",
  "pid": 22130,
  "argv": [
    "pnpm",
    "--filter",
    "@taskdesk/api",
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.integration.config.ts",
    "../../tests/api-integration/activity-write-repository.test.ts",
    "../../tests/api-integration/project-archive-freeze-legacy.test.ts"
  ],
  "cwd": "/Users/heinthura/.codex/worktrees/query580-role-assignment-ownership/Ticketing.v2",
  "start_utc": "2026-10-18T15:08:27.942698+00:00",
  "end_utc": "2026-10-18T15:08:42.191474+00:00",
  "returncode": 0,
  "timed_out": false,
  "timeout_seconds": 900,
  "duration_seconds": 14.248,
  "CI_in_child": "absent"
}
````

### 6ce9 invocation capture


````json
{
  "candidate": "6ce98d1657acf45c45ad7061bcaba9c772c4cc00",
  "argv": [
    "pnpm",
    "--filter",
    "@taskdesk/api",
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.integration.config.ts",
    "../../tests/api-integration/activity-write-repository.test.ts",
    "../../tests/api-integration/project-archive-freeze-legacy.test.ts"
  ],
  "cwd": "/Users/heinthura/.codex/worktrees/query580-role-assignment-ownership/Ticketing.v2",
  "expected_test_file_count": 2,
  "CI": "absent in child",
  "timeout_seconds": 900,
  "complete_suites": [
    "activity-write-repository",
    "project-archive-freeze-legacy"
  ],
  "static_test_declarations": {
    "completeIntegrationFileCount": 2,
    "perFile": {
      "activity-write-repository": 5,
      "project-archive-freeze-legacy": 20
    },
    "staticTotal": 25,
    "method": "source-derived count of explicit it(...) declarations; not a runtime test count or acceptance numerator"
  },
  "static_declaration_count_is_not_runtime_count": true
}
````

### 6ce9 source preflight


````json
{
  "head": "6ce98d1657acf45c45ad7061bcaba9c772c4cc00",
  "tree": "57027b8cf2a2417df4eb294484689ed302b6541a",
  "parents": [
    "67398512774b0b01400b72488a20b1a7635a6ce4"
  ],
  "status_porcelain": [],
  "diffSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "ownedFileSha256": {
    "apps/api/src/activity/repository.ts": "5a56fb42159082947ace796f7589bea7886e6db855b0e2edc6b75e3ecae10111",
    "apps/api/src/activity/controllers/create-activity.ts": "6da67b4423b1fa2b9293fa25ca164997b7315e42ab3f3e7a613a2ce7764b67b2",
    "apps/api/src/activity/index.ts": "bde4aa9f96ad390797e33176764ce5870de85e10ed010e3442b830c7c14daf75",
    "tests/api-integration/activity-write-repository.test.ts": "0e08807ed8e94647c13a8ecd640ce2e3923448f83e963cc48945227541b3e565",
    "tests/api-integration/project-archive-freeze-legacy.test.ts": "82a3f705a88c1bc0679c48c936084c52016a8f88ce24ae978cea83a63e737c65"
  },
  "checker_sha256": "3ae301ab73e7ae55012bb74bacf2cc6e7dde253c02dccdcb2fecc5bcffa31244",
  "expected_owned_paths": [
    "apps/api/src/activity/repository.ts",
    "apps/api/src/activity/controllers/create-activity.ts",
    "apps/api/src/activity/index.ts",
    "tests/api-integration/activity-write-repository.test.ts",
    "tests/api-integration/project-archive-freeze-legacy.test.ts"
  ],
  "meaning": "clean committed candidate source and tests identity verified"
}
````

### 6ce9 source postflight


````json
{
  "head": "6ce98d1657acf45c45ad7061bcaba9c772c4cc00",
  "tree": "57027b8cf2a2417df4eb294484689ed302b6541a",
  "parents": [
    "67398512774b0b01400b72488a20b1a7635a6ce4"
  ],
  "status_porcelain": [],
  "diffSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "ownedFileSha256": {
    "apps/api/src/activity/repository.ts": "5a56fb42159082947ace796f7589bea7886e6db855b0e2edc6b75e3ecae10111",
    "apps/api/src/activity/controllers/create-activity.ts": "6da67b4423b1fa2b9293fa25ca164997b7315e42ab3f3e7a613a2ce7764b67b2",
    "apps/api/src/activity/index.ts": "bde4aa9f96ad390797e33176764ce5870de85e10ed010e3442b830c7c14daf75",
    "tests/api-integration/activity-write-repository.test.ts": "0e08807ed8e94647c13a8ecd640ce2e3923448f83e963cc48945227541b3e565",
    "tests/api-integration/project-archive-freeze-legacy.test.ts": "82a3f705a88c1bc0679c48c936084c52016a8f88ce24ae978cea83a63e737c65"
  },
  "checker_sha256": "3ae301ab73e7ae55012bb74bacf2cc6e7dde253c02dccdcb2fecc5bcffa31244",
  "unchanged_from_frozen_preflight": true,
  "preflight": {
    "head": "6ce98d1657acf45c45ad7061bcaba9c772c4cc00",
    "tree": "57027b8cf2a2417df4eb294484689ed302b6541a",
    "parents": [
      "67398512774b0b01400b72488a20b1a7635a6ce4"
    ],
    "status_porcelain": [],
    "diffSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "ownedFileSha256": {
      "apps/api/src/activity/repository.ts": "5a56fb42159082947ace796f7589bea7886e6db855b0e2edc6b75e3ecae10111",
      "apps/api/src/activity/controllers/create-activity.ts": "6da67b4423b1fa2b9293fa25ca164997b7315e42ab3f3e7a613a2ce7764b67b2",
      "apps/api/src/activity/index.ts": "bde4aa9f96ad390797e33176764ce5870de85e10ed010e3442b830c7c14daf75",
      "tests/api-integration/activity-write-repository.test.ts": "0e08807ed8e94647c13a8ecd640ce2e3923448f83e963cc48945227541b3e565",
      "tests/api-integration/project-archive-freeze-legacy.test.ts": "82a3f705a88c1bc0679c48c936084c52016a8f88ce24ae978cea83a63e737c65"
    },
    "checker_sha256": "3ae301ab73e7ae55012bb74bacf2cc6e7dde253c02dccdcb2fecc5bcffa31244"
  }
}
````

### Docker inventory conservation


````json
{
  "containers": {
    "added": [],
    "missing": []
  },
  "volumes": {
    "added": [],
    "missing": []
  },
  "networks": {
    "added": [],
    "missing": []
  }
}
````

### Exact owned-container cleanup receipt


````json
{
  "exact_id": "475fd7454bfb0a00cedcf097eccae5c0b4343a7e72a401dfda12bc20925edc12",
  "identity_labels": {
    "taskdesk.revision": "6ce98d1657acf45c45ad7061bcaba9c772c4cc00",
    "taskdesk.run": "20261018T150825Z-669ba26b",
    "taskdesk.task": "query580-activity-write"
  },
  "returncode": 0,
  "stdout": "475fd7454bfb0a00cedcf097eccae5c0b4343a7e72a401dfda12bc20925edc12\n",
  "stderr": ""
}
````


### Limited A composition confirmation at 9d60 (corrected v2)


````markdown
# Activity source composition confirmation

**Result: LIMITED COMPOSITION CONFIRMATION.** This is not a new ordinary review, does not count as an additional reviewer context, and adds no runtime verdict at the composition SHA.

## Exact source

- Current merge commit: `9d60e5ab264e6bec4fe16cf9e5275e2b474032b2`
- Tree: `872ae651bb6632316edc5444b0e0a2193545fc92`
- Parents: previously reviewed activity source `6ce98d1657acf45c45ad7061bcaba9c772c4cc00`; accepted main `46e55d2da2e40e3fbd281d2bc29ba876ab52170a`
- Worktree: `/Users/heinthura/.codex/worktrees/query580-role-assignment-ownership/Ticketing.v2`
- `HEAD` and tree matched; `git status --short` was empty.

## Composition checks

- Read-only Git diff from `6ce98d1` to `9d60e5a` contains only the accepted PR #853 leaf regression test and its review note: `tests/api-integration/leaf-module-repositories.test.ts` and `docs/07-planning/security-reviews/query765-regression-conservation-20261018.md`.
- The full `apps/api/src/activity` subtree is unchanged (tree `c3df8abfca95794c1fe8de9cac93abea8bf925f1` at both heads). The root receipt field `apiSubtree` value `a118da01febd69b2b1d94c59026601e13dd69745` identifies the full `apps/api` subtree, also unchanged. Both relevant integration inputs are unchanged: `activity-write-repository.test.ts` Git blob `c7708889071e7f12275bc3eababb44e9aa5493a5` and `project-archive-freeze-legacy.test.ts` Git blob `1368b207c9d8f69f57b5819ba5c83bb5377d7e29` at both `6ce98d1` and `9d60e5a`.
- The root source-conservation receipt at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/activity9d60-composition-root/source-conservation.json` records the exact two parents and tree, clean worktree, only those two accepted-composition paths, unchanged API subtree, and conservation of all other accepted-main source tuples. I read and compared its claimed activity subtree and local integration-file IDs against Git.
- No test or other command was run to execute the candidate. The prior candidate-bound integration capture at `6ce98d1` remains 2 complete files / 25 passed / 0 failed / 0 skipped or cancelled, native 0. Since the API subtree and both selected activity test files are unchanged, that result's inputs are unchanged; it remains evidence for `6ce98d1`, not a new run or acceptance result at `9d60e5a`.

## Scope and limits

This confirms only that the already ordinary-A-cleared activity source and its exact PostgreSQL test inputs are unchanged in this normal merge composition, and that the accepted-main composition receipt is consistent with the inspected Git identities. It does not re-review the newly accepted leaf regression test, independently re-audit every accepted-main tuple, repeat tests, authorize the merge, or satisfy the separate ordinary-B and GPT-6 Sol gates. No canonical files, Git state, or GitHub records were changed by this check.


**Provenance correction (2026-10-18 follow-up).** The original report labeled the full `apps/api` tree hash from the root receipt as the `apps/api/src/activity` subtree hash. Direct `git rev-parse` at both `6ce98d1` and `9d60e5a` confirms `apps/api` is `a118da01febd69b2b1d94c59026601e13dd69745`, while `apps/api/src/activity` is `c3df8abfca95794c1fe8de9cac93abea8bf925f1`. Both subtrees are unchanged. This erratum preserves the original report and does not change its limited composition-confirmation scope or create a new review count.
````

### Limited B composition confirmation at 9d60


````markdown
# Limited exact-head composition confirmation — activity #580

**Result: composition confirmed, limited to the stated delta.** This is not a new ordinary review, security review, CI result, or runtime acceptance.

## Exact source

- Current merge commit: `9d60e5ab264e6bec4fe16cf9e5275e2b474032b2`
- Current tree: `872ae651bb6632316edc5444b0e0a2193545fc92`
- Parents, in order: candidate `6ce98d1657acf45c45ad7061bcaba9c772c4cc00`; accepted main `46e55d2da2e40e3fbd281d2bc29ba876ab52170a`
- Worktree: `/Users/heinthura/.codex/worktrees/query580-role-assignment-ownership/Ticketing.v2`, clean at review.

## Read-only confirmation

I confirmed the worktree HEAD and tree above, both commit parents, a clean worktree, and the exact tree diff from the prior reviewed candidate. The only two changed paths from `6ce9` to `9d60` are:

- added `docs/07-planning/security-reviews/query765-regression-conservation-20261018.md`
- modified `tests/api-integration/leaf-module-repositories.test.ts`

The entire `apps/api` subtree is byte-identical to the reviewed `6ce9` source (`a118da01febd69b2b1d94c59026601e13dd69745`). The activity repository regression test is identical at both commits (`c7708889071e7f12275bc3eababb44e9aa5493a5`). The preserved archive-freeze regression still has Git blob `1368b207c9d8f69f57b5819ba5c83bb5377d7e29`.

The root composition receipt at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/activity9d60-composition-root/source-conservation.json` independently records that all accepted-main non-owned source tuples were conserved and that the only composition delta matches the two paths above. I relied on that receipt for the whole-main conservation assertion; I did not repeat its tuple enumeration.

## Runtime and review limits

No tests, compiler, Docker, browser, or GitHub operations were run. The prior root-owned PostgreSQL capture was at `6ce9`, reported 2 files / 25 passed, and its API and activity-write test inputs are unchanged at `9d60`. No rerun at `9d60` is claimed. This confirmation adds no review count: the fresh full GPT-6 Sol review remains pending after the ordinary confirmations.
````

### Source-conservation receipt at 9d60


Retained private auxiliary receipt: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/activity9d60-composition-root/source-conservation.json` (878 bytes; SHA-256 `1e7372d2542dce2f4b9e3c4453d112dd9eebb080abb11885c29b05d72bb0241a`). Its authentic reviewer report remains included in full.


### Native reviewer provenance


````json
{
  "at": "2026-10-18T15:15:28.029795+00:00",
  "candidate": "9d60e5ab264e6bec4fe16cf9e5275e2b474032b2",
  "rootMaterialFixer": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
  "contexts": [
    {
      "id": "01a14f79-33f0-7cc3-b26d-5ee8509326c6",
      "agent_path": "/root/query580_activity_next_slice_luna",
      "model": "gpt-6-luna",
      "reasoning_effort": "high",
      "sessionMeta": {
        "id": "01a14f79-33f0-7cc3-b26d-5ee8509326c6",
        "timestamp": "2026-10-18T14:45:05.677Z"
      },
      "latestTurnContext": {
        "timestamp": "2026-10-18T15:14:50.413Z",
        "model": "gpt-6-luna",
        "effort": "high"
      }
    },
    {
      "id": "01a14f8c-6744-7533-9d65-79baec41e302",
      "agent_path": "/root/activity6739_ordinary_a_luna",
      "model": "gpt-6-luna",
      "reasoning_effort": "high",
      "sessionMeta": {
        "id": "01a14f8c-6744-7533-9d65-79baec41e302",
        "timestamp": "2026-10-18T15:06:04.022Z"
      },
      "latestTurnContext": {
        "timestamp": "2026-10-18T15:14:06.399Z",
        "model": "gpt-6-luna",
        "effort": "high"
      }
    },
    {
      "id": "01a14f8e-e691-76e3-bd18-6c76fbf4dfa6",
      "agent_path": "/root/activity6ce9_ordinary_b_luna",
      "model": "gpt-6-luna",
      "reasoning_effort": "high",
      "sessionMeta": {
        "id": "01a14f8e-e691-76e3-bd18-6c76fbf4dfa6",
        "timestamp": "2026-10-18T15:08:47.662Z"
      },
      "latestTurnContext": {
        "timestamp": "2026-10-18T15:13:12.206Z",
        "model": "gpt-6-luna",
        "effort": "high"
      }
    },
    {
      "id": "01a14f94-0353-7240-82d5-8f942a0b798a",
      "agent_path": "/root/activity9d60_security_sol",
      "model": "gpt-6-sol",
      "reasoning_effort": "high",
      "sessionMeta": {
        "id": "01a14f94-0353-7240-82d5-8f942a0b798a",
        "timestamp": "2026-10-18T15:14:22.698Z"
      },
      "latestTurnContext": {
        "timestamp": "2026-10-18T15:14:25.468Z",
        "model": "gpt-6-sol",
        "effort": "high"
      }
    }
  ],
  "servedWeightsNotAttested": true,
  "method": "Exact agent_path SQLite records and filtered session_meta identity /turn_context model and effort only; no raw transcript or instructions saved/published."
}
````

### Source-history Gitleaks native stderr

The scan covered three commits / approximately 15,070 bytes from `46e55..9d60`; native exit was 0.

````text
    ○
    │╲
    │ ○
    ○ ░
    ░    gitleaks

9:47PM INF 3 commits scanned.
9:47PM INF scanned ~15070 bytes (15.07 KB) in 46.9ms
9:47PM INF no leaks found
````

### Source-history Gitleaks machine result


````json
[]
````

### Full independent GPT-6 Sol security review at 9d60


````markdown
# Full independent Sol security review — #580 activity write extraction

**Verdict: CLEAR for this bounded security review at exact head `9d60e5ab264e6bec4fe16cf9e5275e2b474032b2`.** I found no blocking or non-blocking candidate-specific security finding. This is a fresh, full source and evidence review, independent of the implementation, its material direction, ordinary reviews, and remediation. I did not author, direct, or fix this candidate.

## Candidate and scope

- Reviewed HEAD: `9d60e5ab264e6bec4fe16cf9e5275e2b474032b2`; tree: `872ae651bb6632316edc5444b0e0a2193545fc92`; clean worktree at review.
- Accepted comparison base: `46e55d2da2e40e3fbd281d2bc29ba876ab52170a`. The four-path delta is `apps/api/src/activity/repository.ts`, `apps/api/src/activity/controllers/create-activity.ts`, `apps/api/src/activity/index.ts`, and `tests/api-integration/activity-write-repository.test.ts`.
- Merge parents, in order: source candidate `6ce98d1657acf45c45ad7061bcaba9c772c4cc00` and accepted base `46e55d2da2e40e3fbd281d2bc29ba876ab52170a`.
- `apps/api` subtree is `a118da01febd69b2b1d94c59026601e13dd69745` at both 6ce9 and 9d60. `apps/api/src/activity` subtree is `c3df8abfca95794c1fe8de9cac93abea8bf925f1` at both. The new regression blob is `c7708889071e7f12275bc3eababb44e9aa5493a5` at both. The preserved project-archive-freeze regression blob is `1368b207c9d8f69f57b5819ba5c83bb5377d7e29` at 9d60. The 6ce9→9d60 diff adds only the accepted #853 leaf test and its review note; it changes no API source or either selected activity test.

## Security analysis

The public `POST /api/activity/create` retains `workspaceAccess.fromTaskId(... requireProjectReach: true, deferApiKeyCapability: true)` and `requireWorkspacePermission({work_item:["update"]})`. Its handler resolves the actual request identity from authenticated `userId`, authenticated API key facts, and the session impersonation marker through `resolveRequestIdentity`. The body schema has no actor field; `userId` on the persisted activity comes from the authenticated context. The existing authorization-boundaries regression also asserts that a body-supplied `userId` cannot replace that actor. The credential-specific resolver rejects invalid/deactivated/banned principals and clamps API-key capabilities; this source path is not based on a bare user ID.

Inside one transaction, `lockTaskAndAssertProjectLiveForActivity` uses the identity-scoped task-row lock, then a shared lock on the task's current live project. The task lock's SQL predicate requires current persisted project reach. The project lock requires unarchived, undeleted state and current reach again; refusal is the same `404 Task not found` for missing and out-of-reach rows. Taking task before project follows the established ordering. The project share lock conflicts with an archive update until the transaction ends. The subsequent `INSERT ... SELECT ... RETURNING` uses the same transaction executor, the locked task ID, a live project join, and a fresh `currentProjectReachPredicate` in its statement. A task move cannot change the locked task row between lookup and insert. Zero selected rows become the same 404 and the transaction writes nothing. Parameters use Drizzle `sql.param`, not string interpolation.

The public insert projects the complete twelve-column `task_activity` row shape: generated ID, task/type, both timestamps, authenticated actor, content/payload, and four nullable external-import fields. The values match the prior Drizzle insert defaults. A successful route regression compares the complete JSON response to the persisted row, with timestamp serialization. The rollback regression proves the insert belongs to the caller transaction.

The internal event path is distinct: production import search finds `recordTaskEventActivity` only in the in-process `task.*` subscribers in `activity/index.ts`; the public handler calls only the identity-scoped writer. `insertTaskEventActivityFromSubscriber` is a standalone `INSERT ... VALUES ... RETURNING` of supplied event fields and database-generated defaults. It makes no read, join, `INSERT ... SELECT`, or existing-row lookup. `RETURNING` exposes only the row just inserted. Consequently it does not meet the accepted contract's conditional rule for a query that can discover cross-organisation pre-existing data. This precise shape preserves a successfully emitted task event delivered after project archive or actor deactivation; adding an existing-row read or routing user-supplied task IDs into it would change that conclusion. The pre-existing archive regression and the new post-archive/deactivation regression cover that behavior.

## Evidence and limits

I read AGENTS.md, active mission, agent workflow, CLAUDE.md, coding standards, multi-tenancy and security model query-scoping sections, the legacy activity schema/policy/response, identity and reach helpers, the four candidate files and both relevant regressions. I read the earlier contract interpretation critically as material direction only; it did not count as approval. I independently checked exact Git objects, current production call sites, and the root-owned raw PostgreSQL capture. The prior 6ce9 run reports exit 0 in 14.248 seconds, 2 complete integration files and 25 passed tests, with no failed/skipped/cancelled tests; the raw Vitest log SHA-256 is `906b25fc75315ee747aa2c8e5791916b758d1a7ddc867add019b0c4ccfd80cac`. The previous 6739 run's missing-column failure was repaired by the full-column projection and is not represented as a passing run.

I did not run tests, compiler, Docker, browser, or GitHub operations, and do not claim a 9d60 runtime rerun. The 6ce9 runtime result is evidence for unchanged API and selected test inputs, not an exact-head CI result. The new file exercises session success, revoked membership, archive serialization, subscriber retention, and transaction rollback; it does not separately execute API-key or impersonation requests. Those credential branches were checked by source inspection, with the older authenticated-actor regression as additional evidence. This report clears this security review only; it does not close all #580, stage, CI, merge, or runtime-acceptance gates.
````

### Sol evidence manifest


````json
{
  "review": "full independent Sol security review",
  "verdict": "CLEAR",
  "candidateHead": "9d60e5ab264e6bec4fe16cf9e5275e2b474032b2",
  "candidateTree": "872ae651bb6632316edc5444b0e0a2193545fc92",
  "comparisonBase": "46e55d2da2e40e3fbd281d2bc29ba876ab52170a",
  "sourceParent": "6ce98d1657acf45c45ad7061bcaba9c772c4cc00",
  "independentFromAuthorDirectionAndRemediation": true,
  "candidatePaths": [
    "apps/api/src/activity/controllers/create-activity.ts",
    "apps/api/src/activity/index.ts",
    "apps/api/src/activity/repository.ts",
    "tests/api-integration/activity-write-repository.test.ts"
  ],
  "apiTreeAtCandidateAndSourceParent": "a118da01febd69b2b1d94c59026601e13dd69745",
  "activitySubtreeAtCandidateAndSourceParent": "c3df8abfca95794c1fe8de9cac93abea8bf925f1",
  "newRegressionBlobAtCandidateAndSourceParent": "c7708889071e7f12275bc3eababb44e9aa5493a5",
  "preservedArchiveRegressionBlob": "1368b207c9d8f69f57b5819ba5c83bb5377d7e29",
  "rootRuntimeCandidate": "6ce98d1657acf45c45ad7061bcaba9c772c4cc00",
  "rootRuntimeFilesPassed": 2,
  "rootRuntimeTestsPassed": 25,
  "rootRuntimeExitCode": 0,
  "rootRuntimeLogSha256": "906b25fc75315ee747aa2c8e5791916b758d1a7ddc867add019b0c4ccfd80cac",
  "runtimeAtReviewedHead": false,
  "reviewerExecutedTests": false,
  "reportSha256": "39ee57c8a9ef8ad043d8d6d4cfaeea12d217663e71a41cb21c4d411865594150"
}
````

## Current-head delta and root verification evidence

### current ordinary a

````markdown
# Ordinary review A delta follow-up — MFA fixture stale-lock test

**Verdict: CLEAR for the bounded current delta.** No finding in the one-line fixture correction. This is the same ordinary-A reviewer context following up its prior source review; it does not add an independent review count or satisfy the separate review tiers.

## Exact source and scope

- Candidate: `bb3112dc3131f60db65adf7292cfd06ea07fe8b5`
- Tree: `85457cc57b2b3228dad92c8ce7a1db92431ce646`
- Parent: `9d60e5ab264e6bec4fe16cf9e5275e2b474032b2`
- Worktree: `/Users/heinthura/.codex/worktrees/query580-role-assignment-ownership/Ticketing.v2`
- `HEAD` and tree matched the assigned candidate; worktree was clean.
- The complete delta is one line in `tests/api/mfa-csrf-app-fixture.test.ts`: the synthetic metrics listener in `preserves stale locks when the live metrics listener owns the lease` now binds to `127.0.0.1` instead of `0.0.0.0`.
- `apps/api/src/activity` and both activity PostgreSQL integration files are unchanged from the prior composition-reviewed SHA. The activity subtree is `c3df8abfca95794c1fe8de9cac93abea8bf925f1`; the two test blobs are `c7708889071e7f12275bc3eababb44e9aa5493a5` and `1368b207c9d8f69f57b5819ba5c83bb5377d7e29`.

## Finding assessment

The correction makes the fake live listener match the exact address used by `acquireMetricsPortLease()` in `tests/e2e/helpers/child-process-supervisor.mjs` and by the API fixture metrics listener in `tests/e2e/helpers/mfa-csrf-app-fixture.ts`. The retained Darwin/Node 26.10 probe records that `0.0.0.0` and `127.0.0.1` can bind the same ephemeral port in either order, while duplicate binds to either exact host fail with `EADDRINUSE`. That explains why the prior wildcard listener did not establish the intended lease conflict on this host.

The changed test still expects `withExclusiveMetricsListener` to time out and still compares both stale owner/reaper lock files byte-for-byte. It does not relax a guard, change recovery behavior, skip a test, or touch production code. The new exact-host listener creates the test's intended same-address contention, so I found no blocker in this delta.

## Retained check evidence

- No tests, compiler, lint, Docker, or browser commands were run by me. I read the root-captured records.
- The exact current-candidate full-test log reports the MFA fixture file at 11 tests passed and the full `pnpm test` result at 12 tasks successful; API 121 files / 872 tests, UI 61 / 325, and web 186 / 1,027 are shown as passing. The changed stale-lock test appears as passed in that log. Raw log: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/activity-bb311-local-checks-root/test.log`, SHA-256 `d3ab1caf1a89635dac2c79fc37ac7775bc1316cbea3190af7906bc167f2e7e2b`.
- Root-captured lint and typecheck records both have native exit 0 and are bound to candidate `bb3112dc3131f60db65adf7292cfd06ea07fe8b5`; their JSON receipts are in the same directory.
- The prior `9d60e5a` full run and isolated MFA-file run failed this exact stale-lock case; those remain historical evidence for the old wildcard setup. The current candidate's complete test log shows the corrected case passing.

## Limits

This is ordinary review A follow-up only, with no new review count. The candidate still needs the independent ordinary-B review and the required current-head GPT-6 Sol review. The activity slice's prior A clearance applies because its implementation and selected PG inputs remain byte-identical; this report does not clear unrelated source or any later commit.

````

### current ordinary b

````markdown
# Ordinary review B — exact-head delta follow-up

Date: 2026-10-18
Role: independent ordinary-B reviewer, narrow delta follow-up only

**Verdict: CLEAR for the exact current delta.** I found no blocker or non-blocking finding in this one-line fixture correction. This is an exact-head follow-up, not a new full-source review count and not renewed clearance of unrelated source.

## Exact source and independence

Worktree: `/Users/heinthura/.codex/worktrees/query580-role-assignment-ownership/Ticketing.v2`.

- Candidate `bb3112dc3131f60db65adf7292cfd06ea07fe8b5`, tree `85457cc57b2b3228dad92c8ce7a1db92431ce646`.
- Sole parent: `9d60e5ab264e6bec4fe16cf9e5275e2b474032b2`.
- Exact `git diff --name-status HEAD^ HEAD`: only modified `tests/api/mfa-csrf-app-fixture.test.ts`.
- Exact change: within “preserves stale locks when the live metrics listener owns the lease”, bind the fake port-9464 listener to `127.0.0.1` rather than `0.0.0.0`.
- Worktree was clean. Current source-conservation receipt agrees that it is one insertion/one deletion, with all other source tuples conserved. I independently checked the exact Git diff, activity subtree, and both activity PostgreSQL test inputs; these are unchanged from 9d60.

I did not author, direct, or remediate this fixture correction. This review context previously prepared a separate read-only #580 activity-read planning note, but did not touch this test or the activity-write candidate. I read ordinary-A's follow-up note as context; my finding below comes from the source, current test and prior-failure evidence, and the raw captures I checked. This does not increase the ordinary-review count.

## Delta assessment

The changed test deliberately makes a live process occupy the metrics port while the stale main/reaper lock files are present. The real child-process supervisor acquires that lease with `server.listen(9464, "127.0.0.1")` and verifies the returned host is exactly `127.0.0.1` (`tests/e2e/helpers/child-process-supervisor.mjs:68-90`). The MFA app fixture also starts the application with explicit hostname `127.0.0.1` (current helper line 638). The test listener now holds that same address and port, so the tested condition is a real lease conflict.

The earlier 9d60 full and isolated test captures failed because the promise resolved to `"must-not-run"` rather than rejecting with `"Timed out waiting"`; this means the callback ran and the old wildcard listener did not establish the intended conflict on that Darwin host. The independent Darwin/Node 26.10 capture reports that `0.0.0.0` and `127.0.0.1` can bind the same ephemeral port in either order, while two binds to the same exact address fail with `EADDRINUSE`. I read the probe source: it uses kernel-assigned ephemeral ports, closes each server in `finally`, and does not touch application locks, databases, containers, or existing processes. I did not execute it.

The test's timeout expectation (`waitMs: 50`, `pollMs: 5`, requiring “Timed out waiting”), callback sentinel (`"must-not-run"`), and exact `staleMain` and `staleGuard` byte assertions are unchanged. No timeout was lengthened, assertion weakened, guard bypassed, skip added, or production helper edited. This is a corrected test oracle, not a behavior change to lock acquisition or stale-lock recovery.

## Captured verification and limits

I read the current-head root receipts and raw test outputs; I ran nothing. The root capture is pinned to bb311:

- `pnpm test`: native exit 0, 12/12 tasks, API 121 files / 872 tests, UI 61 / 325, web 186 / 1,027. The changed MFA fixture file reports 11/11 passing, including the corrected stale-lock test at 925 ms. Raw `test.log` SHA-256: `d3ab1caf1a89635dac2c79fc37ac7775bc1316cbea3190af7906bc167f2e7e2b`.
- `pnpm test:permissions`: native exit 0, 5/5 tasks, 16 files / 107 tests. Raw log SHA-256: `498e8736850fc4394b390e0f94476cf83195b39fd7ef25c3878a33aa0e055537`.
- Lint and typecheck receipts each bind to bb311 and record native exit 0. The lint log notes 27 warnings, including diagnostics in unchanged work-item search source; it still exits 0. Typecheck exits 0.
- The previous 9d60 test captures are adverse history, not overwritten: full run API 120/121 files and 871/872 tests passed; the isolated MFA file had 10/11 pass with this same stale-lock oracle failure.
- The actual focused PostgreSQL result remains the prior `6ce98d...` capture (2 files, 25 tests passed, native 0) supplied by the conductor. Activity source and both PG input files are byte-identical through bb311, but no bb311 PostgreSQL rerun is claimed.

This is not a full-source review, runtime review, new independent review count, security review, approval to publish/merge, or #580 completion claim. The separate fresh exact-head Sol follow-up remains required as directed by the conductor.

````

### current sol followup

````markdown
# Exact-head Sol security follow-up — #580 activity candidate

**Verdict: CLEAR at `bb3112dc3131f60db65adf7292cfd06ea07fe8b5` for the required security tier.** This verdict combines my prior full independent Sol review of the unchanged activity/API source at `9d60e5ab264e6bec4fe16cf9e5275e2b474032b2` with my independent review of the sole new test delta. It adds no new reviewer count and does not waive or substitute for a required gate. I did not author, direct, or remediate either candidate or the fixture correction. No blocking or non-blocking security finding arose in this delta.

## Exact source

- Reviewed head: `bb3112dc3131f60db65adf7292cfd06ea07fe8b5`; tree `85457cc57b2b3228dad92c8ce7a1db92431ce646`; clean worktree.
- Sole parent and prior full-source Sol-reviewed head: `9d60e5ab264e6bec4fe16cf9e5275e2b474032b2`. Its full report is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/activity9d60-security-sol/report.md` (SHA-256 `39ee57c8a9ef8ad043d8d6d4cfaeea12d217663e71a41cb21c4d411865594150`). Accepted comparison base remains `46e55d2da2e40e3fbd281d2bc29ba876ab52170a`.
- Exact parent diff: one insertion and one deletion in `tests/api/mfa-csrf-app-fixture.test.ts`, line 587. The synthetic metrics listener changes `listen(9464, "0.0.0.0", …)` to `listen(9464, "127.0.0.1", …)`. No production file changes.
- Full `apps/api` tree remains `a118da01febd69b2b1d94c59026601e13dd69745`; activity subtree remains `c3df8abfca95794c1fe8de9cac93abea8bf925f1`. The activity-write integration test remains blob `c7708889071e7f12275bc3eababb44e9aa5493a5`; the preserved archive regression remains `1368b207c9d8f69f57b5819ba5c83bb5377d7e29`. The accepted-base-to-current candidate has the four previously reviewed activity paths plus this one test file.

## Security assessment of the delta

The test named “preserves stale locks when the live metrics listener owns the lease” models another process holding the port while stale main and reaper lock files exist. The real `acquireMetricsPortLease` in `tests/e2e/helpers/child-process-supervisor.mjs` binds port 9464 to `127.0.0.1` and checks its bound address; the MFA app fixture starts on the same loopback host. Binding the fake listener to that exact address exercises the intended lease conflict. The old wildcard bind was not equivalent on the captured Darwin/Node 26.10 host: the root-owned local probe shows wildcard and loopback listeners can coexist on one ephemeral port in both orders, whereas duplicate exact-host binds return `EADDRINUSE`. I read the probe source; it uses ephemeral ports and closes its servers.

The test still requires `withExclusiveMetricsListener` to reject with “Timed out waiting” after `waitMs: 50` and `pollMs: 5`; the callback sentinel remains `"must-not-run"`; both stale lock files are still checked byte-for-byte. The listener is closed in `finally`. There is no skip, focused test, timeout increase, weaker assertion, changed supervisor logic, changed application bind, or changed production authorization path. The corrected setup improves the security regression's ability to detect accidental lock reclamation or callback execution.

My prior full review's public identity/session/API-key/impersonation, persisted reach, task→project lock and archive serialization, no-write denials, complete returned-row shape, and separate subscriber-only `INSERT … VALUES … RETURNING` conclusions continue to apply to identical source and integration inputs. The earlier material direction was not an approval. I also checked the current source-conservation receipt against the Git diff and relevant object IDs; its SHA-256 is `2a0409a49f93abfd8e63422bb9687824f563c877852e93862b3cde1a5f5249b2`.

## Checks and limits

I ran read-only Git and file/log inspection. I did not execute tests, compiler, Docker, browser, or GitHub actions. Root-owned records at this exact head report native exit 0 for lint, typecheck, `pnpm test`, and `pnpm test:permissions`. The full unit run reports 12/12 tasks; API 121 files/872 tests, UI 61/325, web 186/1,027. The changed MFA file reports 11/11 passing, including this stale-lock case. The permissions run reports 5/5 tasks and 16 files/107 tests. The raw current test log SHA-256 is `d3ab1caf1a89635dac2c79fc37ac7775bc1316cbea3190af7906bc167f2e7e2b`.

The old 9d60 full and isolated MFA runs failed the exact test because the sentinel callback ran; those adverse records remain historical evidence. The focused PostgreSQL result is still the root-owned 6ce9 run: two complete files, 25 tests passed, native exit 0. The API tree and both PostgreSQL test inputs are unchanged through bb311, but there was no bb311 PostgreSQL rerun and I claim none. This report clears only the current-head security review for this bounded candidate. It does not declare all #580 work, exact-head CI, image/runtime acceptance, stage completion, or merge eligibility.

````

### current sol manifest

Retained private auxiliary receipt: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/activity-bb311-security-sol/manifest.json` (1983 bytes; SHA-256 `799e706bbb44698559205667a7224b650220aaecc556d55ab01559169848412d`). Its authentic reviewer report remains included in full.


### current source conservation

Retained private auxiliary receipt: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/activity-bb311-current-source-root/source-conservation.json` (1355 bytes; SHA-256 `2a0409a49f93abfd8e63422bb9687824f563c877852e93862b3cde1a5f5249b2`). Its authentic reviewer report remains included in full.


### current local checks

````json
{
  "head": "bb3112dc3131f60db65adf7292cfd06ea07fe8b5",
  "results": [
    {
      "task": "lint",
      "head": "bb3112dc3131f60db65adf7292cfd06ea07fe8b5",
      "startedAt": "2026-10-18T15:32:37.169871+00:00",
      "wallSeconds": 2.0012907499913126,
      "nativeExit": 0,
      "logBytes": 25513,
      "logSha256": "37b321f5a20f510a594269609712f0e72b1e3ffe0b377d3f39ded742d400ee61"
    },
    {
      "task": "typecheck",
      "head": "bb3112dc3131f60db65adf7292cfd06ea07fe8b5",
      "startedAt": "2026-10-18T15:32:39.172000+00:00",
      "wallSeconds": 21.09870950016193,
      "nativeExit": 0,
      "logBytes": 3941,
      "logSha256": "d2d33fa1ead2269ddcf62114968fa6bdf60a55bc31fefb35ffdf49bf46d6d7d7"
    },
    {
      "task": "test",
      "head": "bb3112dc3131f60db65adf7292cfd06ea07fe8b5",
      "startedAt": "2026-10-18T15:33:00.271270+00:00",
      "wallSeconds": 50.23103183298372,
      "nativeExit": 0,
      "logBytes": 169794,
      "logSha256": "d3ab1caf1a89635dac2c79fc37ac7775bc1316cbea3190af7906bc167f2e7e2b"
    },
    {
      "task": "test:permissions",
      "head": "bb3112dc3131f60db65adf7292cfd06ea07fe8b5",
      "startedAt": "2026-10-18T15:33:50.503564+00:00",
      "wallSeconds": 10.598796041915193,
      "nativeExit": 0,
      "logBytes": 14762,
      "logSha256": "498e8736850fc4394b390e0f94476cf83195b39fd7ef25c3878a33aa0e055537"
    }
  ],
  "sourceConserved": true,
  "allFourCompletedAndPassed": true
}
````

### prior local unit adverse

````json
{
  "head": "9d60e5ab264e6bec4fe16cf9e5275e2b474032b2",
  "results": [
    {
      "task": "lint",
      "head": "9d60e5ab264e6bec4fe16cf9e5275e2b474032b2",
      "startedAt": "2026-10-18T15:25:35.756752+00:00",
      "wallSeconds": 1.9155820000451058,
      "nativeExit": 0,
      "logBytes": 25603,
      "logSha256": "d47a3dcd08aefb4ba82b7a2e73fbcf367e9e48000821c34ec3082003cb9c82d0"
    },
    {
      "task": "typecheck",
      "head": "9d60e5ab264e6bec4fe16cf9e5275e2b474032b2",
      "startedAt": "2026-10-18T15:25:37.673057+00:00",
      "wallSeconds": 23.791093167150393,
      "nativeExit": 0,
      "logBytes": 3933,
      "logSha256": "0c41fb71c13e1c2620da8ca74230f44fc1b47e5b3458bd12471eab0a0f489265"
    },
    {
      "task": "test",
      "head": "9d60e5ab264e6bec4fe16cf9e5275e2b474032b2",
      "startedAt": "2026-10-18T15:26:01.465128+00:00",
      "wallSeconds": 24.607877541100606,
      "nativeExit": 1,
      "logBytes": 152368,
      "logSha256": "697df511255ea95df993e7274a2f12c1c803a9c1abedb9fb7be89a4ae1939e1f"
    }
  ],
  "sourceConserved": true,
  "allFourCompletedAndPassed": false
}
````

### native address controls

````json
{
  "platform": "darwin",
  "node": "v26.10.0",
  "purpose": "Compare IPv4 wildcard and loopback binds, in both orders, on ephemeral ports.",
  "sequences": [
    {
      "firstHost": "0.0.0.0",
      "secondHost": "127.0.0.1",
      "port": 60382,
      "firstAddress": {
        "address": "0.0.0.0",
        "family": "IPv4",
        "port": 60382
      },
      "second": {
        "address": {
          "address": "127.0.0.1",
          "family": "IPv4",
          "port": 60382
        }
      }
    },
    {
      "firstHost": "127.0.0.1",
      "secondHost": "0.0.0.0",
      "port": 60383,
      "firstAddress": {
        "address": "127.0.0.1",
        "family": "IPv4",
        "port": 60383
      },
      "second": {
        "address": {
          "address": "0.0.0.0",
          "family": "IPv4",
          "port": 60383
        }
      }
    },
    {
      "firstHost": "127.0.0.1",
      "secondHost": "127.0.0.1",
      "port": 60384,
      "firstAddress": {
        "address": "127.0.0.1",
        "family": "IPv4",
        "port": 60384
      },
      "second": {
        "code": "EADDRINUSE",
        "message": "listen EADDRINUSE: address already in use 127.0.0.1:60384"
      }
    },
    {
      "firstHost": "0.0.0.0",
      "secondHost": "0.0.0.0",
      "port": 60385,
      "firstAddress": {
        "address": "0.0.0.0",
        "family": "IPv4",
        "port": 60385
      },
      "second": {
        "code": "EADDRINUSE",
        "message": "listen EADDRINUSE: address already in use 0.0.0.0:60385"
      }
    }
  ]
}

````

### current gitleaks stderr

````text

    ○
    │╲
    │ ○
    ○ ░
    ░    gitleaks

10:07PM INF 4 commits scanned.
10:07PM INF scanned ~15127 bytes (15.13 KB) in 42.9ms
10:07PM INF no leaks found

````

**Reviewed head:** `bb3112dc3131f60db65adf7292cfd06ea07fe8b5`
