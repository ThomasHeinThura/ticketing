# Workspace role-assignment lock repository ownership — issue #580

**Reviewed head:** `57f525a0d3333c961b13375a7a9a69f940a57ec6`
**Accepted comparison base:** `e6f3cce387903a533204cd93a19d4c3a8de86930`
**Accepted base tree:** `2e35ad607a814f5b70cee623ffc8ccae2ac0b12f` (3,453 entries)
**Reviewed source tree:** `6dc3e9bf7c5cec2919228aee9c9032f523940135` (3,453 entries)
**Source parents:** `6c5ed199a822355f2f15c6d0a98f6534f2006486` and accepted base `e6f3cce387903a533204cd93a19d4c3a8de86930`

## Change and boundary

This change moves the existing transaction-only workspace role-assignment advisory-lock helper into `workspace-role-assignment.repository.ts` and updates its eight existing import sites. It keeps the exact `Transaction` parameter type, requires the caller's transaction, and preserves the two awaited `pg_advisory_xact_lock` statements in order: membership namespace 4,002, then role namespace 4,003. Their workspace hash argument, callers, call positions and surrounding transactional sequencing are unchanged. The move changes query ownership/location only; it does not change authorization or the query gate's pass/fail semantics.

Against accepted base `e6f3cce...`, the product delta is exactly the eight import updates, removal of the old controller helper, and addition of the new repository module. The old helper path is absent at the reviewed head. The ten product path states are byte/tree-entry identical between the independently reviewed implementation source `6c5ed199a822355f2f15c6d0a98f6534f2006486` and composed head `57f525a0d3333c961b13375a7a9a69f940a57ec6`. All 3,444 accepted-base entries outside those ten product paths are conserved at the composed source. No checker activation, allowlist, baseline, dependency or authority change is included.

## Local checks and their exact limits

The root-verified local receipt is tied to implementation source `6c5ed199a822355f2f15c6d0a98f6534f2006486` (accepted base `340eb55e9778c71fbaed1b8ed3cd854ca3c6443c`): lint passed 2,416 files with 240 warnings and 12 informational items; typecheck passed 9/9 tasks, five cached; the complete selected PostgreSQL scope passed five files and 129 tests. The source composition to `57f525...` preserves all ten product path states exactly, but the local receipt is not a fresh execution at the composed head. Cleanup and tree-conservation fields in that receipt passed.

A separate one-time, unwired query diagnostic on implementation source `6c5ed199...` exited 1. Its 2,669 overlapping instances, 137 distinct paths and 1,479 path-line locations are diagnostic output counts, not unique queries or progress arithmetic. It classified zero rows in the candidate's owned helper/repository paths. The diagnostic remains red and unwired; no #580 completion or checker activation is claimed. Its raw retained log is 450,204 bytes with SHA-256 `1f4c4c0cce38fb071ed8bfdd030c5585a5d73b604363d2a526a0b269255e1eeb`.

## Review evidence

The ordinary reviewer cleared the ten-path implementation diff at `6c5ed199...`; the same reviewer then confirmed the exact composition head `57f525...`, all ten product path states, and accepted-main conservation. A fresh independent GPT-6.1 Sol context issued a lightweight CLEAR security confirmation directly on `57f525...`. The Sol report retains one non-blocking finding: three comments still refer to the old helper path. That comment-only finding is not closed here. No tests, compiler, PostgreSQL, Docker, browser or hosted CI were run by either independent reviewer.

### Authentic ordinary review — implementation source `6c5ed199...`

<!-- BEGIN AUTHENTIC ORDINARY REVIEW REPORT: byte-exact -->
# Independent ordinary review — workspace role-assignment repository ownership

**Reviewed source:** `6c5ed199a822355f2f15c6d0a98f6534f2006486`
**Comparison base:** `340eb55e9778c71fbaed1b8ed3cd854ca3c6443c` (accepted main)
**Verdict:** CLEAR for the ordinary review tier. No blocking findings. One non-blocking documentation finding is recorded below.

## Independence and scope

This was a fresh review context assigned an independent, strong ordinary review. I did not author, direct, compose, or remediate this change. The task was routed for the Luna ordinary-review tier; this interface does not expose an independently verifiable served-model version, so this report makes no served-model attestation.

I read the repository AGENTS.md, agent workflow, CLAUDE.md provider adapter, active mission, coding standards, CI security-scope list, current status context, and the #580 D1–D4 query-ownership decision. I inspected the complete ten-path source diff against the accepted base, the moved helper and prior version, the shared `Transaction` alias, both lock namespace modules, and all eight production import/call sites. The worktree was clean at the reviewed source SHA.

## Source findings

The change moves `lockWorkspaceRoleAssignment` from `workspace/controllers/workspace-role-assignment-lock.ts` to `workspace/workspace-role-assignment.repository.ts`, where the `.repository.ts` filename meets the accepted #580 repository-location convention. It changes eight import specifiers and makes the helper use the shared type-only `Transaction` import.

The shared alias in `apps/api/src/database/executor.ts` is the same Drizzle transaction callback parameter type expression as the prior local `WorkspaceTransaction` alias. The helper still accepts a transaction-only handle as its first argument; it cannot default to the shared connection or open/commit a transaction. Its SQL remains two awaited `pg_advisory_xact_lock` statements in the same order, membership namespace 4_002 followed by role namespace 4_003, with the same workspace hash key and return behavior. The moved helper does not change either namespace or lock semantics.

All eight call sites still pass their existing transaction handle and the same workspace identifier at the same call position. Diff inspection shows caller executable bodies unchanged; the other caller changes are import relocation and Biome import ordering. The two namespace modules have no runtime dependency on the moved repository, so the new imports do not introduce a cycle. No schema, permission, route, authority, tenant predicate, dependency, or gate logic changes. The refactor changes repository ownership/location and does not change authority or gate pass/fail semantics.

## Findings

**Non-blocking — stale path references in comments.** `workspace-membership-lock.ts`, `workspace-role-lock.ts`, and `delete-workspace-role.ts` still mention `workspace-role-assignment-lock.ts`, which no longer exists after the move. These are comment-only references; source imports and executable references use the new repository path. Updating them would improve navigation and comment accuracy, but they do not alter behavior or the query checker’s executable ownership surface.

No blocking findings.

## Checks and limits

Read-only checks performed: exact HEAD/base verification; complete ten-path `git diff --no-renames` inspection; targeted source and import searches; and `git diff --check` (exit 0). I did not run tests, compilers, PostgreSQL, Docker, browser checks, CI, or modify source. The parent-provided local check receipts were treated as contextual evidence, not as checks run by this reviewer.

This verdict covers the exact source SHA above only. It does not establish the later records composition, its exact-head CI, the required fresh security confirmation, image/runtime acceptance, whole-#580 completion, or merge readiness.
<!-- END AUTHENTIC ORDINARY REVIEW REPORT -->

### Exact-head composition confirmation — source `57f525...`

<!-- BEGIN AUTHENTIC COMPOSITION CONFIRMATION REPORT: byte-exact -->
# Exact-head composition confirmation — workspace role-assignment repository ownership

**Reviewed source:** `57f525a0d3333c961b13375a7a9a69f940a57ec6`
**Accepted comparison base:** `e6f3cce387903a533204cd93a19d4c3a8de86930`
**Prior source review:** `6c5ed199a822355f2f15c6d0a98f6534f2006486`, recorded in `report.md` (SHA-256 `ba44c44c31bce677c1b9b7352e8d4bd0816d028f02a38e5b87d4121ec28c2e4c`)
**Verdict:** The prior CLEAR ordinary review remains valid at this composed head. The product source covered by that review is unchanged.

## Exact composition checked

Git reports candidate `57f525a0d3333c961b13375a7a9a69f940a57ec6`, parents `6c5ed199a822355f2f15c6d0a98f6534f2006486` and accepted main `e6f3cce387903a533204cd93a19d4c3a8de86930`, tree `6dc3e9bf7c5cec2919228aee9c9032f523940135`. The checkout HEAD matched that candidate and the worktree was clean.

I independently compared the raw per-path tree entries (mode, type, blob object, including absence) for all ten product path names between the reviewed source and composed candidate; each matches. The accepted-main tree has 3,453 entries, of which nine have names in the ten-path product set; the remaining 3,444 non-owned accepted-main entries have identical mode/type/blob tuples in the candidate tree. Against accepted main, the product delta is exactly the eight import updates plus removal of the old helper path and addition of the new repository path.

The only intervening delta from `6c5ed199a822355f2f15c6d0a98f6534f2006486` is three records paths: `docs/07-planning/integration-execution-queue.md`, `docs/07-planning/security-reviews/records842-carrier-callback-checkpoint.md`, and `docs/07-planning/status.md`. No product-source path changed. This matches the ordinary-review scope and does not alter the prior finding about comment-only old helper path references.

`git diff --check e6f3cce387903a533204cd93a19d4c3a8de86930...57f525a0d3333c961b13375a7a9a69f940a57ec6` exited 0. I ran no tests or runtime checks for this records-only composition. Exact-head CI, the required fresh security confirmation, image/runtime acceptance, and merge readiness remain separate gates.
<!-- END AUTHENTIC COMPOSITION CONFIRMATION REPORT -->

### Fresh independent lightweight security confirmation — source `57f525...`

<!-- BEGIN AUTHENTIC SECURITY REVIEW REPORT: byte-exact -->
# Independent security confirmation — workspace role-assignment repository ownership

**Model:** GPT-6.1 Sol
**Configured model provenance:** The conductor reports independently reading this reviewer's native session header and turn context: `gpt-6.1-sol`, reasoning `high`, native context `01a14d96-dee0-7920-84b5-ba74f8a9da3b`, parent `01a14000-d9e0-7bb1-b3fd-2c0204a4834c`. This is configuration provenance, not an attestation of served weights or an independently exposed served-model version in this review context.
**Role/context:** Fresh independent security reviewer, `/root/rolelock57f5_security_sol`.
**Reviewed head:** 57f525a0d3333c961b13375a7a9a69f940a57ec6
**Comparison base:** e6f3cce387903a533204cd93a19d4c3a8de86930
**Verdict:** CLEAR for the lightweight security confirmation. No blocking findings. The existing stale-comment finding remains non-blocking.

## Independence and review order

I did not author, direct, compose or remediate this candidate. I reviewed source in a fresh independent context after the ordinary review cleared. I read the ordinary review and exact-head composition confirmation and independently reproduced their relevant source claims. Their SHA-256 values matched `ba44c44c31bce677c1b9b7352e8d4bd0816d028f02a38e5b87d4121ec28c2e4c` and `5059d88315d1e49d79c73636c514f2ade7b2b551daf39d8013b2bff7f8ceb5b41` respectively. I did not adopt their verdict as my security conclusion.

I read AGENTS.md, the active mission, agent workflow, CLAUDE.md, coding standards including issue #580 query ownership, the CI/CD security-scope list, current blocked/status context and the relevant decision-log entries. The policy and type-definition inputs inspected are identical to the accepted comparison base. The controller paths are security scope; a security review is mandatory.

## Risk classification and source findings

The lightweight row applies: this is a security-scope path change that provably changes no authority or gate pass/fail semantics. It does not alter auth or permissions behavior. The complete accepted-base diff contains ten path names: eight caller import changes, deletion of the old controller helper and addition of the named repository. Rename detection displays nine entries, including one rename. There is no new endpoint, capability, schema, tenant predicate, dependency, configuration or gate change.

I independently compared the original helper with `apps/api/src/workspace/workspace-role-assignment.repository.ts`. The function implementation and its retained documentation are byte-identical after replacing only the parameter type name. Both SQL statements remain awaited and use `pg_advisory_xact_lock`, first membership namespace `4_002`, then role namespace `4_003`, keyed by the same parameterized `hashtext(workspaceId)`. Neither statement runs on a default/shared connection. The helper opens, commits and rolls back no transaction and returns no composable query builder.

The shared `Transaction` alias in `apps/api/src/database/executor.ts` has exactly the same Drizzle transaction-callback-parameter type expression as the removed local `WorkspaceTransaction` alias. This is a type-only import of `Transaction`, not the broader `Executor` union. The transaction-only requirement has not widened. The two namespace modules are unchanged constant-only modules without runtime imports, so relocating their imports does not add an import cycle. The type-only executor import adds no database runtime initialization path.

All eight caller bodies are byte-identical after removing the single lock-helper import line. Every existing call remains awaited with the same transaction handle, workspace argument and surrounding sequencing:

| Caller | Exact-head line | Preserved arguments |
| --- | --- | --- |
| invitation/controllers/accept-invitation.ts | 84 | tx, pre.workspaceId |
| user/controllers/delete-account-data.ts | 58 | tx, workspaceId |
| workspace/controllers/add-workspace-member.ts | 60 | tx, input.workspaceId |
| workspace/controllers/delete-workspace-role.ts | 77 | tx, workspaceId |
| workspace/controllers/delete-workspace.ts | 29 | tx, workspaceId |
| workspace/controllers/invite-workspace-member.ts | 100 | tx, input.workspaceId |
| workspace/controllers/update-workspace-member-role.ts | 66 | tx, workspaceId |
| workspace/controllers/update-workspace-role.ts | 70 | tx, input.workspaceId |

The direct transaction callers remain inside their existing `db.transaction` callback. The access-lifecycle callers still receive the transaction created by `withWorkspaceDeletionAccessLifecycle`; account deletion retains its explicitly typed transaction and ordered workspace-lock loop. Role validation, owner guards, invitation checks, membership updates and deletion checks retain their original positions. No executable import of the removed helper remains under `apps/api/src`.

## Composition verification

The clean checkout matched the exact reviewed head. Its parents are `6c5ed199a822355f2f15c6d0a98f6534f2006486` and accepted base `e6f3cce387903a533204cd93a19d4c3a8de86930`. I independently compared mode/type/blob entries: all ten owned path states, including the removed path's absence, match the previously reviewed source `6c5ed199a822355f2f15c6d0a98f6534f2006486`; all 3,444 accepted non-owned entries are conserved. The delta from that prior source consists only of three accepted records paths. This security verdict is nevertheless issued directly for the exact composed head above.

## Findings

**Blocking:** None.

**Non-blocking — stale comment paths:** `workspace/controllers/workspace-membership-lock.ts:47`, `workspace/controllers/workspace-role-lock.ts:10`, and `workspace/controllers/delete-workspace-role.ts:67` still cite `workspace-role-assignment-lock.ts`. These are comment references to the relocated helper, not executable imports. The ordinary review's finding remains valid and is not silently closed. It does not affect transaction execution, authorization or the query-location surface.

## Actual checks and limits

I performed read-only Git head/parent/cleanliness checks, complete ten-path diff inspection, source/import searches, helper/type-expression and caller-body equality assertions, namespace dependency inspection, and exact tree-entry conservation assertions. All equality assertions passed. `git diff --check` against the accepted base exited 0. I created only this private report outside the repository.

I read the conductor's local verification receipt for source `6c5ed199a822355f2f15c6d0a98f6534f2006486`: lint passed over 2,416 files with 240 warnings/12 informational items, typecheck passed nine tasks (five cached), and the complete selected PostgreSQL scope passed five files/129 tests with cleanup/source conservation. These are receipt-reported earlier-source checks, not executions by this reviewer. I independently established conservation of this review's ten source paths at the composed head; I did not independently audit every raw test log or every test-input path for reuse.

I ran no tests, compilers, PostgreSQL, Docker, browsers or hosted CI and made no source, GitHub, commit, branch or ref changes. This verdict does not assert exact-head hosted CI, image build/boot/health, runtime/SIT acceptance, whole-#580 completion, query-gate activation, stage completion or merge readiness. All remaining applicable gates remain required. The reported red, unwired query diagnostic is not cleared by this ownership move or by this review.
<!-- END AUTHENTIC SECURITY REVIEW REPORT -->

## Native reviewer-context provenance

The following context metadata was checked by the conductor against the native session headers and turn contexts. It records configured model/reasoning pairs and identity only; it does not attest to served weights. The reports above remain byte-exact and are not amended to add provenance.

```json
{
  "source": "Conductor-verified native session headers and actual turn contexts; configured model metadata only, not served-weights attestation.",
  "conductor": {
    "context": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
    "configuredModel": "gpt-6.1-sol",
    "reasoning": "medium",
    "role": "conductor; mechanical source composition and review-provenance verification"
  },
  "contexts": [
    {
      "role": "source author",
      "context": "01a14cc2-ebe4-7b02-9a2d-fddf727c6b8d",
      "configuredModel": "gpt-6-luna",
      "reasoning": "high",
      "parent": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
      "independentOfSource": false
    },
    {
      "role": "fresh ordinary reviewer",
      "context": "01a14d93-ed09-7730-a211-7b14a0afcac7",
      "configuredModel": "gpt-6-luna",
      "reasoning": "high",
      "parent": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
      "independentOfSource": true,
      "reportSha256": "ba44c44c31bce677c1b9b7352e8d4bd0816d028f02a38e5b87d4121ec28c2e4c"
    },
    {
      "role": "fresh independent security reviewer",
      "context": "01a14d96-dee0-7920-84b5-ba74f8a9da3b",
      "configuredModel": "gpt-6.1-sol",
      "reasoning": "high",
      "parent": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
      "independentOfSource": true,
      "reportSha256": "eb35d748b322b55562c9ef8ee9df459e5be0c399307a5ae5cbee34a9ab006400"
    }
  ],
  "limits": [
    "The ordinary review could not independently expose a served-model version; configured context metadata was verified by the conductor.",
    "The security report names GPT-6.1 Sol; the PR template security model label uses the accepted GPT-6 Sol label.",
    "No assertion about platform-served weights is made."
  ]
}
```

## Root-verified machine evidence

These private machine receipts are reproduced byte-for-byte below. They bind the local check result to `6c5ed199...`, the composition to `57f525...`, and the diagnostic to its exact source; the receipts do not replace current hosted gates.

### Local checks on implementation source `6c5ed199...`

```json
{
  "source": "6c5ed199a822355f2f15c6d0a98f6534f2006486",
  "acceptedBase": "340eb55e9778c71fbaed1b8ed3cd854ca3c6443c",
  "lint": {
    "nativeExit": 0,
    "checkedFiles": 2416,
    "warnings": 240,
    "infos": 12
  },
  "typecheck": {
    "nativeExit": 0,
    "successful": 9,
    "cached": 5
  },
  "postgres": {
    "nativeExit": 0,
    "fullFiles": 5,
    "expandedTestsPassed": 129,
    "sourceConserved": true,
    "ownedContainerRemoved": true,
    "privateEnvRemoved": true,
    "dockerInventoryConserved": true
  },
  "nativeResultSha256": "701f4b300ba0d245be0d851330c62c670bcdcb71cbe15e78dd196dd114fdd50d",
  "rawPGSha256": "87d188370d14b3090cc12f42e1572113ca2118aae4b0c6d4d1ef82f4e6000292",
  "meaning": "bounded local checks only; no independent review, hosted CI or image acceptance"
}
```

### Accepted-main composition receipt

```json
{
  "at": "2026-10-18T05:56:25.805770+00:00",
  "oldSource": "6c5ed199a822355f2f15c6d0a98f6534f2006486",
  "oldAcceptedBase": "340eb55e9778c71fbaed1b8ed3cd854ca3c6443c",
  "acceptedMain": "e6f3cce387903a533204cd93a19d4c3a8de86930",
  "composedSource": "57f525a0d3333c961b13375a7a9a69f940a57ec6",
  "parents": [
    "6c5ed199a822355f2f15c6d0a98f6534f2006486",
    "e6f3cce387903a533204cd93a19d4c3a8de86930"
  ],
  "tree": "6dc3e9bf7c5cec2919228aee9c9032f523940135",
  "productOwnedPaths": [
    "apps/api/src/invitation/controllers/accept-invitation.ts",
    "apps/api/src/user/controllers/delete-account-data.ts",
    "apps/api/src/workspace/controllers/add-workspace-member.ts",
    "apps/api/src/workspace/controllers/delete-workspace-role.ts",
    "apps/api/src/workspace/controllers/delete-workspace.ts",
    "apps/api/src/workspace/controllers/invite-workspace-member.ts",
    "apps/api/src/workspace/controllers/update-workspace-member-role.ts",
    "apps/api/src/workspace/controllers/update-workspace-role.ts",
    "apps/api/src/workspace/controllers/workspace-role-assignment-lock.ts",
    "apps/api/src/workspace/workspace-role-assignment.repository.ts"
  ],
  "recordsPaths": [
    "docs/07-planning/integration-execution-queue.md",
    "docs/07-planning/security-reviews/records842-carrier-callback-checkpoint.md",
    "docs/07-planning/status.md"
  ],
  "allProductSourceEntriesConserved": true,
  "allAcceptedNonOwnedModeTypeBlobTuplesConserved": true,
  "clean": true,
  "normalMergeNativeExit": 0,
  "pushPerformed": false,
  "reviewOrCurrentCIClaimed": false
}
```

### Unwired query diagnostic receipt

```json
{
  "source": {
    "head": "6c5ed199a822355f2f15c6d0a98f6534f2006486",
    "status": "",
    "tree": "d0214f5878f96c1559e2e37d22fe21fa981deea7",
    "checker": "3ae301ab73e7ae55012bb74bacf2cc6e7dde253c02dccdcb2fecc5bcffa31244"
  },
  "sourcePost": {
    "head": "6c5ed199a822355f2f15c6d0a98f6534f2006486",
    "status": "",
    "tree": "d0214f5878f96c1559e2e37d22fe21fa981deea7",
    "checker": "3ae301ab73e7ae55012bb74bacf2cc6e7dde253c02dccdcb2fecc5bcffa31244"
  },
  "sourceConserved": true,
  "startedAt": "2026-10-18T05:48:58.904541+00:00",
  "endedAt": "2026-10-18T05:49:18.972212+00:00",
  "elapsedSeconds": 20.067,
  "nativeExit": 1,
  "instances": 2669,
  "distinctPaths": 137,
  "distinctPathLineLocations": 1479,
  "ownedHelperRows": [],
  "unwiredDiagnosticOnly": true,
  "notUniqueQueriesOrProgress": true,
  "rawBytes": 450204,
  "rawSha256": "1f4c4c0cce38fb071ed8bfdd030c5585a5d73b604363d2a526a0b269255e1eeb"
}
```

## Residuals and gates

- The current query diagnostic is still red and unwired. This repository move is not whole-#580 acceptance; no inventory-wide completion, checker activation, exception or waiver is claimed.
- The Sol review's comment-only stale path references remain open as a non-blocking finding.
- Exact-current-head required hosted CI and applicable shipping-image build, boot and health checks remain mandatory and pending for the publication that will contain this note. No hosted/image pass is claimed here.
- This change contains no frontend files and makes no browser or screen verification claim. No invitation/SSO/registration activation, other authority change, stage completion or mission completion is claimed.
