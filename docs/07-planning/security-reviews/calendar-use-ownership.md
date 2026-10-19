# #580 CAL-9 calendar-use repository ownership review

**Reviewed head:** `19eb1c94c795df92b60cf7bb59ab0931316f1af7`
**Base:** `173501e72aa92cb3241e4fd7c64dde86486e9a48`
**Branch:** `codex/query580-calendar-use-20261018`
**Changed source paths:** `apps/api/src/pending-action/deletion-targets.ts`, `apps/api/src/service-calendar/index.ts`, `apps/api/src/service-calendar/repository.ts`

This note records the exact-head independent ordinary review and the required independent lightweight security confirmation for the bounded CAL-9 ownership relocation. It is not a claim that #580 is complete, that the checker is active, or that the slice is integrated or accepted.

## Root-run local verification at the reviewed source

The root-run pre-commit Biome hook completed successfully for the three changed source files. Its first normal invocation stopped on one extra EOF newline; the ordinary formatter corrected that byte and the hook then passed. No hook was bypassed. The source commit receipt records the exact source path hashes and conservation of all 3,457 non-owned tree tuples.

At exact source `19eb1c94c795df92b60cf7bb59ab0931316f1af7`, `pnpm --filter @taskdesk/api typecheck` exited 0 in 19.933 seconds. The complete real-Postgres file `tests/api-integration/service-calendar-usage-delete.test.ts` passed 1 file / 10 tests without focus or skips; the native test process exited 0. The saved run records source conservation, exact owned-container cleanup, preserved unknown Docker inventory, and private test-environment removal. The source-only Gitleaks scan exited 0. These are local checks for this source, not hosted CI, a shipping-image proof, or merge acceptance. The full repository `pnpm lint`, full workspace `pnpm typecheck`, full `pnpm test`, browser checks, and image build/boot/health checks were not run locally.

## Exact-source review reports

The following two report payloads are included verbatim from their original private report files. Each report independently names the same full reviewed-head SHA above. Their text has not been edited.

### Ordinary review report (authentic original follows)

# #580 service-calendar helper relocation — ordinary review

**Model / role:** GPT-6 Luna — independent ordinary reviewer  
**Candidate:** `19eb1c94c795df92b60cf7bb59ab0931316f1af7`  
**Comparison base:** `173501e72aa92cb3241e4fd7c64dde86486e9a48`  
**Branch:** `codex/query580-calendar-use-20261018`  
**Independence:** Fresh review context. I did not author, direct, or remediate this candidate.  
**Scope:** Exactly the three changed source paths: `apps/api/src/pending-action/deletion-targets.ts`, `apps/api/src/service-calendar/index.ts`, and `apps/api/src/service-calendar/repository.ts`. Static review of CAL-9 in `docs/03-features/service-calendars.md`, pending-action contract, #580 D1–D3 query ownership/executor rules, the moved helper, both call sites, module imports, and the existing `tests/api-integration/service-calendar-usage-delete.test.ts` inventory. No execution or tests were run.

## Verdict

**CLEAR — no blocking or non-blocking findings in the reviewed delta.** This is a bounded source-ownership relocation in security-scope API code. The semantic surface is narrow: one existing query helper moved from pending-action deletion orchestration into the service-calendar repository, and its two imports changed to use that repository export. The security-scope location still requires a separate fresh Sol confirmation before acceptance.

## Findings and checks

- The helper body is unchanged in behavior: it checks project and SLA policy-version references using both `workspaceId` and `calendarId`, limits each existence query to one row, and throws the same `HTTPException(409, { message: "service_calendar_in_use" })` if either reference exists. This matches CAL-9's workspace-scoped deletion guard.
- Both call sites remain in place and awaited: the request path checks before creating the pending action; the approval path rechecks after the existing pending-action lifecycle lock and current target/access checks, before deleting the calendar. Their transaction/executor argument and database operation placement do not change. No transaction, lock, audit, outbox, pending-action, or error-handling behavior was added or removed by the diff.
- The move places these SQL statements in `service-calendar/repository.ts`, matching #580 D1–D3 repository ownership. The approval caller continues to pass its transaction handle; the request caller continues to pass the shared database executor.
- The added import creates a dependency from `pending-action/deletion-targets.ts` to `service-calendar/repository.ts`. The repository already imports the direct `pending-action/workspace-access-invalidation` module. Inspection of that module and its imports found no path back to `deletion-targets.ts`, the pending-action barrel, or the service-calendar index, and no eager invocation of the moved helper. I found no module-initialization cycle introduced by this import.
- The existing integration file contains ten test cases. Their coverage includes workspace-only usage counts; successful pending-action deletion; request-time project and policy-version rejection; approval-time reference recheck/retry; version-change invalidation; audit failure and transactional event behavior; credential, role and workspace scope; unrelated-calendar non-blocking behavior; and non-disclosing 404 behavior for outsiders. The file and tests are unchanged by this candidate. These are inspected test definitions, not an execution result.

## Evidence and limits

- Read-only inspection found a clean candidate worktree at the exact SHA above and a three-path source diff, with one helper body moved and caller imports adjusted.
- Read-only inspection included `git status`, `git rev-parse`, `git diff --stat`, `git diff --name-only`, exact source diff, relevant feature/pending-action/query-ownership policy text, import references, and the ten integration test declarations.
- **Not run by this reviewer:** tests, typecheck, build, database/PostgreSQL, browser, Docker, CI, hosted checks, or GitHub operations. This report does not establish their results or acceptance. Root-owned exact-head API/type and real PostgreSQL checks remain necessary, as does the required independent Sol confirmation.

**Reviewed head:** `19eb1c94c795df92b60cf7bb59ab0931316f1af7`


### Security review report (authentic original follows)

# #580 calendar-use relocation — independent security confirmation

**Model:** GPT-6 Sol  
**Role:** Fresh independent security reviewer; lightweight confirmation after ordinary review cleared.  
**Context:** `/root/calendar19eb_security_sol`, dispatched by `/root` for this bounded review.  
**Candidate:** `19eb1c94c795df92b60cf7bb59ab0931316f1af7`  
**Comparison base:** `173501e72aa92cb3241e4fd7c64dde86486e9a48`  
**Branch:** `codex/query580-calendar-use-20261018`  
**Worktree:** `/Users/heinthura/.codex/worktrees/post838-status-queue-20261018`  
**Independence:** I did not author, direct, or remediate the candidate. This context reviewed source independently after the separate ordinary Luna report returned CLEAR. The ordinary report was read as evidence, and its material source claims were checked against the actual candidate and comparison base.

## Verdict

**CLEAR — no blocking or non-blocking findings in the reviewed delta.**

The candidate qualifies for the security-scope row that changes no authority or gate pass/fail semantics: one fresh ordinary review and a separate lightweight security confirmation. It relocates the existing calendar-reference guard into the existing service-calendar repository and updates its two imports. It does not alter authorization, tenancy, pending-action approval, database transaction ownership, SQL behavior, or quality-gate semantics. This verdict covers the exact three-path delta above, not completion of #580 or broader calendar/pending-action acceptance.

## Scope and checks actually performed

I read the checkout's `AGENTS.md`, active mission, `agent-workflow.md`, `CLAUDE.md`, the relevant CI/CD security scope, CAL-9 and calendar deletion/event contract, pending-action approval/lifecycle rules, #580 D1–D3 in the decision log, and the accepted query-ownership rules in coding standards. I inspected the full exact source diff and the changed helper's callers and relevant import dependencies. Read-only Git checks found the stated head and branch, a clean worktree, and exactly three changed paths:

- `apps/api/src/pending-action/deletion-targets.ts`
- `apps/api/src/service-calendar/index.ts`
- `apps/api/src/service-calendar/repository.ts`

A read-only standard-library extraction compared the helper comment, declaration and body from the base deletion-target module with the candidate repository: **935 bytes equal**, SHA-256 `7e2e2e86dcbd0fe7e57d3b412ab67ee2a53a5defe5eaa577c3f316f67b159116` (normalized only by stripping surrounding trailing whitespace and retaining one final newline).

## Security assessment

1. **CAL-9 and tenancy are preserved.** Both ordered existence queries still use the supplied executor. Each selects only an id, applies both the workspace predicate and the target calendar predicate, and uses `limit(1)`. The first checks projects and the second retained SLA policy versions. The same `HTTPException(409, { message: "service_calendar_in_use" })` follows either reference. The helper returns no row content or query builder to callers. The new module uses the same existing Drizzle operators, schema bindings and HTTPException import as the old module.

2. **Approval cannot bypass the guard.** The approval caller still awaits `assertCalendarUnused(tx, calendar.workspaceId, calendar.id)` inside its existing transaction after the lifecycle lock, pending-row lock, session/requester validation, registered policy and payload checks, calendar row lock, version check and current required-access evaluation. It remains before calendar deletion and the executed-state/event/audit writes. The helper neither substitutes the shared connection for `tx` nor opens or completes a transaction. The request caller still passes `db`, awaits the check before pending-action creation, and remains behind the existing calendar reach, API-key scope and workspace capability middleware. No call-site placement or error handling changed.

3. **No new disclosure or authority surface was introduced.** A foreign calendar still reaches the unchanged concealment middleware before this guard, so an outsider does not learn in-use state through the 409. Scope derives from the resolved calendar/request context and from the rechecked locked target at approval; moving the implementation does not turn a caller-supplied workspace id into authorization. No route, policy, capability, credential, schema, audit/event behavior or lock order changes in this diff.

4. **The added dependency is safe on inspection.** The new dependency is deletion-targets → service-calendar/repository. The repository's existing pending-action dependency is the direct workspace-access-invalidation module, whose imports lead through credential/lifecycle invalidation, required-access, payload and its repository. I inspected those imports and the relevant shared audit/event/observability/policy dependencies and found no new path back to deletion-targets, pending-action's router or service-calendar's router. The moved export is an async function declaration, not an eager database operation or registration. The repository was already imported by the calendar router. I found no new initialization cycle or startup side effect caused by the relocation.

5. **Negative test definitions are relevant and unchanged.** I inspected the ten-case `tests/api-integration/service-calendar-usage-delete.test.ts` inventory and the material assertions for request-time project and retained-policy-version rejection; approval-time project reference insertion, rejection, pending-state preservation and successful retry after replacement; changed-version invalidation; read-only key and viewer denial; wrong-workspace concealment; a different calendar not blocking an unused target; replay refusal; and successful deletion/event/audit-failure behavior. The outsider in-use test explicitly requires 404, excludes the in-use message and checks that no pending action or pending-action audit was created. These assertions exercise both import consumers through the real application surface. They do not claim exhaustive concurrency coverage or a separate approval-time SLA-version insertion case; the helper's exact byte preservation supports this bounded move without inventing new coverage.

## Execution evidence and limits

**Executed by this reviewer:** read-only source/Git inspections and a standard-library byte comparison. I did not run project tests, a compiler, browser, database, Docker, build, CI, GitHub operations, or any source mutation.

**Root-owned evidence inspected, not executed by this reviewer:**

- `query580-calendar-use-root/typecheck/receipt.json` and its stdout record candidate `19eb1c94c795df92b60cf7bb59ab0931316f1af7`, `pnpm --filter @taskdesk/api typecheck`, native exit 0, 19.932642667 seconds and clean conserved source.
- `query580-calendar-use-root/pg-run/root-verified-result.json`, invocation, source postflight and the saved native log record the same candidate, full unchanged test file selection, **1 file / 10 tests passed**, native exit 0, wrapper elapsed 7.234 seconds, no focus/skips and conserved source. The native log reports Vitest duration 5.90 seconds. The root receipt binds the 8,737-byte raw log to SHA-256 `d5578141da5a7780641dd8eb4807e789aa456c04bfe8a3c251ca09ebdb4f4dd8` and records owned container cleanup, unknown inventory conservation and test-environment removal. I inspected those saved records; I did not independently operate or audit the Docker cleanup.

Residual limits: this is source security confirmation for the pure relocation. It is not an image/boot result, hosted required-check result, browser proof, protected merge approval, runtime/SIT acceptance, gate waiver, stage finalizer, or whole-#580 clearance. Those remain the conductor's applicable acceptance responsibilities.

**Blocking findings:** None.  
**Non-blocking findings:** None.

**Reviewed head:** 19eb1c94c795df92b60cf7bb59ab0931316f1af7


## Native review-context provenance

This JSON is included byte-for-byte from the root-filtered native session metadata. It records configured model/effort and distinct author/reviewer contexts; served weights are not attested.

```json
{
  "at": "2026-10-18T11:56:16.108929+00:00",
  "candidate": "19eb1c94c795df92b60cf7bb59ab0931316f1af7",
  "base": "173501e72aa92cb3241e4fd7c64dde86486e9a48",
  "contexts": [
    {
      "role": "author",
      "session": "01a14cc2-ebe4-7b02-9a2d-fddf727c6b8d",
      "agent": "/root/invitation_accepted840_preparation_luna",
      "createdAt": "2026-10-18T02:06:45.257Z",
      "latestTurn": {
        "timestamp": "2026-10-18T11:47:21.346Z",
        "model": "gpt-6-luna",
        "effort": "high"
      },
      "configuredModel": "gpt-6-luna",
      "configuredEffort": "high"
    },
    {
      "role": "ordinary",
      "session": "01a14ed9-fbb3-74b3-a6a9-ba4a4789b05c",
      "agent": "/root/calendar19eb_ordinary_luna",
      "createdAt": "2026-10-18T11:51:11.060Z",
      "latestTurn": {
        "timestamp": "2026-10-18T11:51:13.473Z",
        "model": "gpt-6-luna",
        "effort": "high"
      },
      "configuredModel": "gpt-6-luna",
      "configuredEffort": "high"
    },
    {
      "role": "security",
      "session": "01a14edb-9602-7c30-b167-d33255d8e465",
      "agent": "/root/calendar19eb_security_sol",
      "createdAt": "2026-10-18T11:52:56.098Z",
      "latestTurn": {
        "timestamp": "2026-10-18T11:52:58.660Z",
        "model": "gpt-6.1-sol",
        "effort": "high"
      },
      "configuredModel": "gpt-6.1-sol",
      "configuredEffort": "high"
    }
  ],
  "reviewersSpawnedForkNone": true,
  "distinctAuthorOrdinarySecurity": true,
  "servedWeightsNotAttested": true,
  "method": "Filtered native session_meta and turn_context metadata only; no raw session transcript published."
}
```

## Root verification receipts

These root-generated JSON receipts are reproduced byte-for-byte; they bind the local source checks above to the exact reviewed source.

### Source commit and conservation

```json
{
  "at": "2026-10-18T11:50:37.724259+00:00",
  "base": "173501e72aa92cb3241e4fd7c64dde86486e9a48",
  "source": "19eb1c94c795df92b60cf7bb59ab0931316f1af7",
  "tree": "dcbfb7f46ba0f3d7188e182d54e3bec563aa9b9d",
  "sourcePaths": [
    "apps/api/src/pending-action/deletion-targets.ts",
    "apps/api/src/service-calendar/index.ts",
    "apps/api/src/service-calendar/repository.ts"
  ],
  "sourceHashes": {
    "apps/api/src/pending-action/deletion-targets.ts": "9f6b7aa09e89f299428caf6064bc23edb14a9e06bc19baf3bab58d2b42713148",
    "apps/api/src/service-calendar/index.ts": "a322e662bd14dbade8768a29426a572401b28f739da3767a12dd2b8ef034e1a6",
    "apps/api/src/service-calendar/repository.ts": "662a36443c6113e7111cee15fbb27350933a7f4b7e30f4ad69f7c7d0326d4811"
  },
  "sourceTreeEntries": 3460,
  "all3457NonownedTuplesConserved": true,
  "helperByteExact935": true,
  "bothCallStatementsUnchanged": true,
  "testAndCheckerUnchanged": true,
  "precommitFirstAttempt": "blocked by one extra EOF newline; normal biome format fixed exactly one byte; hook not bypassed",
  "checksNotYetRunBeyondPrecommitBiome": true,
  "pushed": false
}
```

### API typecheck

```json
{
  "at": "2026-10-18T11:52:13.429884+00:00",
  "head": "19eb1c94c795df92b60cf7bb59ab0931316f1af7",
  "argv": [
    "pnpm",
    "--filter",
    "@taskdesk/api",
    "typecheck"
  ],
  "nativeExit": 0,
  "seconds": 19.932642667088658,
  "sourceCleanConserved": true,
  "logs": {
    "stdout.log": {
      "bytes": 324,
      "sha256": "6587e32ff914dd91c96a0dfae043115dcf83de30ca4d4d9750e559956498d5db"
    },
    "stderr.log": {
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    }
  }
}
```

### Complete real-Postgres integration file

```json
{
  "at": "2026-10-18T11:53:18.518731+00:00",
  "candidate": "19eb1c94c795df92b60cf7bb59ab0931316f1af7",
  "nativeExit": 0,
  "files": 1,
  "tests": 10,
  "seconds": 7.234,
  "fullFileNoFocusOrSkips": true,
  "sourceConserved": true,
  "ownedContainerCleanup": true,
  "unknownDockerInventoryConserved": true,
  "testEnvRemovedWithoutReading": true,
  "rawBytes": 8737,
  "rawSha256": "d5578141da5a7780641dd8eb4807e789aa456c04bfe8a3c251ca09ebdb4f4dd8"
}
```

### Source Gitleaks

```json
{
  "at": "2026-10-18T11:53:58.760672+00:00",
  "argv": [
    "gitleaks",
    "git",
    "--no-banner",
    "--redact",
    "--log-opts=173501e72aa92cb3241e4fd7c64dde86486e9a48..19eb1c94c795df92b60cf7bb59ab0931316f1af7",
    "."
  ],
  "nativeExit": 0,
  "seconds": 0.09166958415880799,
  "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "stderrSha256": "d2c60c0392f715760f54a7cf086b9c9ed18d553603704f6ebd718a0790fa20b8"
}
```

## Remaining limits

- The #580 query-ownership checker remains unwired, and the larger #580 ownership inventory remains unfinished.
- Exact-current-head hosted required checks are pending after publication. No required check or gate is waived.
- A candidate-specific shipping-image build, boot, migration, and health proof is pending; no deployability claim is made.
- No frontend file changed. No product screen changed, and no product browser journey is claimed.
- No merge, release/SIT acceptance, integrated-slice acceptance, stage completion, or mission completion is claimed.
