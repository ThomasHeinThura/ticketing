# Pending-action invalidation query ownership — authentic review record

**Reviewed head:** `b4a49ac736dcf3cce585bb7fcff8eb68d744124c`

**Comparison base:** `555879db9e4841c1460346c115111881d3cd3387`

The original extraction e67 retains its independent ordinary and lightweight Sol scopes. Current source is a normal accepted-main merge conserving all four owned blobs and every other main entry. Further independent ordinary and lightweight Sol composition reports clear this exact source. N1 remains inherited, unresolved and unwaived. Root is the transporter, not an independent reviewer. Requested dispatch profiles are provenance; reports disclose unavailable served fingerprints. Runtime/current CI and protected acceptance are separate.


## Authentic artifact 1: `remaining580-pending-action-invalidation-author-luna.md`

Origin: retained private dispatched author/reviewer output; 7301 bytes, SHA256 `c13795ae46c6a33fa612e5652035944367576de048c4beb8d495562eae57b335`. The following report is reproduced unedited with its original model, role, independence and exact-source limits.

# #580 pending-action invalidation query extraction — author evidence

Date: 2026-10-17 (UTC process times below)

## Result and exact source

Implemented on isolated branch `codex/remaining580-pending-action-invalidation-luna`, worktree `/Users/heinthura/.codex/worktrees/remaining580-pending-action-invalidation-luna`.

- Base/parent: accepted main `2e6aa3dcf74ba5f2d6dc733ae54dc68be16c552b`.
- Commit: `e67c3e8b5d7cc539898196bd89efc7d7dd625c2f` (`refactor(api): extract pending-action invalidation queries`).
- Commit tree: `95a07d1d28c4aa9fac92f2da04d6b81cf37e0f88`.
- Post-commit status: clean. A recursive parent/commit tree comparison found exactly four changed paths and no other changed blobs.

| Path | Change | Commit blob |
| --- | --- | --- |
| `apps/api/src/pending-action/lifecycle-invalidation.ts` | modified service | `01103f825a0f20577cc022ea610cbff46bec6d08` |
| `apps/api/src/pending-action/lifecycle-invalidation.repository.ts` | new repository | `9f115c1321e355812b183ad9cb25349d671557eb` |
| `apps/api/src/pending-action/workspace-access-invalidation.ts` | modified service | `650d3f93bbee07da5148e03e97d0c6a1eb3f5646` |
| `apps/api/src/pending-action/workspace-access-invalidation.repository.ts` | new repository | `0856f23b4d78161a7cb4c640b4610bd58ba40898` |

The two new modules import canonical `Executor` from `../database/executor` and accept `executor: Executor` as their first parameter. They do not duplicate a local transaction-type alias. Existing service exports and public transaction signatures remain in place.

## Extraction and preservation

`lifecycle-invalidation.repository.ts` owns only the three existing lifecycle statements: the global two-key advisory transaction lock, requester pending rows selected in `id` order with `FOR UPDATE`, and the conditional pending-to-invalidated update returning `id`. The existing service awaits the repository results and retains its original iteration and subsequent outbox/audit work.

`workspace-access-invalidation.repository.ts` owns only the existing pending calendar/view target selection, ordered by `id`. The service retains its empty check and unique sorted workspace-id normalization before passing the same transaction executor to the repository.

The extracted SQL/schema predicates, ordering, lock placement, executor, result rows, `occurredAt` value, conditional no-write behavior, and caller-visible service API are preserved. The existing outer transaction/event flow, nested audit behavior/error accounting, AU-14 report timing, and caller failure boundaries remain in the service code. This is a query ownership relocation; no SQL, fields, tables, policy, event, authority, or product behavior was added. The inherited N1 action-row/advisory lock ordering was deliberately left unchanged, per assignment.

Caller/API inventory was inspected before editing. `lockPendingActionLifecycle` remains called by pending-action/service, deletion-targets, credential-invalidation, instance/reset-mfa, instance/users, identity/connection-admin, identity/repository, identity/scim-admin, identity/scim-lifecycle, identity/scim-protocol, identity/oidc-group-mapping-admin, identity/oidc-login, and the workspace access lifecycle wrapper. `invalidatePendingActionsForRequester` remains called by `identity/repository.ts`. Workspace access lifecycle helpers remain called from identity connection/SCIM/repository/OIDC paths, and `withWorkspaceDeletionAccessLifecycle` remains used by view/service-calendar/workspace mutation paths. No caller was edited.

Relevant existing integration coverage identified for a later authorized test run: requester deactivation/invalidation and event/audit behavior in `tests/api-integration/scim-admin.test.ts`, `instance-users.test.ts`, and `instance-users-guards.test.ts`; workspace access-loss transaction behavior in `service-calendar-usage-delete.test.ts`, `view.test.ts`, `identity/oidc-group-mapping-admin.test.ts`, `identity-connection-admin.test.ts`, and `scim-admin.test.ts`. No tests were run and none were added: no meaningful new behavioral gap was identified for this behavior-preserving extraction. This report does not claim runtime correctness or independent review.

## Verification window evidence

Root explicitly opened a local verification/normal-commit window. Each command below ran in the isolated worktree. Native PIDs, UTC times, elapsed time, return code, output sizes, and SHA-256 of combined raw stdout+stderr are recorded where captured. No test, database, browser, Docker, or runtime command was run.

| PID | Command | UTC start → end; elapsed | Exit | Output bytes (stdout/stderr) | Combined log SHA-256 |
| --- | --- | --- | ---: | ---: | --- |
| 18524 | `pnpm install --offline --frozen-lockfile` | 07:30:29.710926 → 07:30:36.673902; 6.963s | 0 | 1855 / 0 | `a8f9e514898df9a33f607f69308bbcb3a081ac0b712f35084edccaa8d2fe72e8` |
| 18717 | `pnpm --filter @taskdesk/permissions build` | 07:30:45.161327 → 07:30:46.476374; 1.315s | 0 | 145 / 0 | `bf8f440da2af8be478fabafffabf9552c0ae0bd966b818573a272f981e9f4373` |
| 18765 | `pnpm --filter @taskdesk/domain build` | 07:30:46.617033 → 07:30:47.297078; 0.680s | 0 | 135 / 0 | `c7024a9c631fff895057b9c91b584e225d61ffda460373aeb273af45a897ebdb` |
| 18796 | `pnpm --filter @taskdesk/email build` | 07:30:47.437752 → 07:30:48.128077; 0.690s | 0 | 133 / 0 | `70d24024f4d155153fa95204b0e4d64296bee11bac74642eb20a8da8d4007183` |
| 19214 | `pnpm exec biome check apps/api/src/pending-action/lifecycle-invalidation.ts apps/api/src/pending-action/workspace-access-invalidation.ts apps/api/src/pending-action/lifecycle-invalidation.repository.ts apps/api/src/pending-action/workspace-access-invalidation.repository.ts` | 07:31:25.239484 → 07:31:25.740444; 0.501s | 0 | 42 / 0 | `151111e9d717cbeb612322df39f79bf980b1ad06e371dfac5e270c595e99fa6d` |
| 19267 | `pnpm --filter @taskdesk/api typecheck` | 07:31:30.302725 → 07:31:48.157195; 17.854s | 0 | 340 / 0 | `3c6bd1ec637aa35824ae2d9eff47336a710a42be7e09061da3ec96d8b361b990` |
| 19534 | `git diff --check` | 07:32:01.132776 → 07:32:01.150527; 0.018s | 0 | 0 / 0 | `fe074d233abbcb2487276d8f8f069dced094844538fcb7cd1c824ff9679d923e` |
| 19811 | `git commit -m 'refactor(api): extract pending-action invalidation queries'` | 07:32:37.673536 → 07:32:40.140495; 2.467s | 0 | 351 / 43 | `738c9c57f0859a34e61a3def12aa4d60a07816535a509ec002ff0b64b6127034` |

The frozen offline install reused the lockfile dependency set and reported no downloads. The commit used normal hooks (no bypass); the pre-commit hook checked the four staged paths and reported `Checked 4 files in 31ms. No fixes applied.` The commit command began with HEAD `2e6aa3dcf74ba5f2d6dc733ae54dc68be16c552b`, staged only the four listed paths, and ended at `e67c3e8b5d7cc539898196bd89efc7d7dd625c2f` with clean status.

## Limits and handoff

Requested model route was GPT-6 Luna; this is assignment provenance only, not a served-model attestation. No push, PR, merge, or GitHub mutation occurred. The commit is not independently reviewed or accepted. Existing tests above are proposed scope only; there is no test result, PostgreSQL/transaction runtime evidence, or browser/Docker evidence. Root owns any subsequent review, tests/runtime authorization, publication, and acceptance.


## Authentic artifact 2: `pending-action-invalidation-e67-ordinary-luna.md`

Origin: retained private dispatched author/reviewer output; 5776 bytes, SHA256 `30535dc21f02123db49ff87681e3903f98dbea236d0de2f2153a58916f759e6e`. The following report is reproduced unedited with its original model, role, independence and exact-source limits.

# Independent ordinary review — pending-action invalidation query extraction

**Reviewer:** GPT-6 (platform identity; exact serving variant not exposed), fresh independent context; did not author, direct, or remediate this candidate.
**Role:** ordinary Luna-tier review only.
**Exact base:** `2e6aa3dcf74ba5f2d6dc733ae54dc68be16c552b`
**Exact candidate:** `e67c3e8b5d7cc539898196bd89efc7d7dd625c2f`
**Candidate tree:** `95a07d1d28c4aa9fac92f2da04d6b81cf37e0f88`
**Worktree/branch:** `/Users/heinthura/.codex/worktrees/remaining580-pending-action-invalidation-luna`, `codex/remaining580-pending-action-invalidation-luna`.

## Scope checked

I read the repository instructions, active mission, workflow review policy, coding-standard query-ownership rules, relevant #580 decision-log entry, PA-9 decision and pending-actions architecture contract. The change contains exactly these four paths (two additions and two modifications):

- `apps/api/src/pending-action/lifecycle-invalidation.repository.ts`
- `apps/api/src/pending-action/lifecycle-invalidation.ts`
- `apps/api/src/pending-action/workspace-access-invalidation.repository.ts`
- `apps/api/src/pending-action/workspace-access-invalidation.ts`

I inspected the complete base-to-candidate diff, both new repository modules, the resulting service modules, `apps/api/src/database/executor.ts`, and all source references/call sites for the affected exported functions. The requester invalidation call is awaited from `apps/api/src/identity/repository.ts`. Workspace-action capture is awaited by the wrapper in `workspace-access-invalidation.ts` and by `identity/connection-admin.ts`, `identity/scim-admin.ts`, `identity/repository.ts`, `identity/oidc-group-mapping-admin.ts`, and `identity/oidc-login.ts`. The existing lifecycle-lock entry points remain in pending-action creation/deletion, credential and identity lifecycle, identity administration and the associated integration cases. I checked the relevant requester and workspace access integration-test sections in `tests/api-integration/scim-admin.test.ts`, `tests/api-integration/identity/oidc-group-mapping-admin.test.ts`, and `tests/api-integration/local-factor-policy.test.ts`.

## Assessment and verdict

**CLEAR — source-level ordinary review.** This is a narrow extraction of four existing statements into canonical `*.repository.ts` modules using the accepted first-parameter `Executor` convention. The caller retains orchestration and all transaction control.

Independent comparison found the extracted statement content unchanged:

1. The lifecycle gate retains the same two-key `pg_advisory_xact_lock` SQL and key values.
2. Requester rows retain the same requester and `pending` predicates, full-row result, `id` ordering, and `FOR UPDATE` lock.
3. Per-row invalidation retains the same pending-action id and `pending` predicates, assignments (`invalidated`, `requester_deactivated`, null actor/session, supplied `occurredAt`), and returned id. The service still skips subsequent event/audit work when no row is returned.
4. Workspace candidate selection retains the same workspace-id set, `pending` state, `service_calendar`/`saved_view` target set, full-row result, and `id` ordering.

The service still performs the same operations in the same order after selection: access evaluation, conditional invalidation, outbox write, nested audit savepoint and failure count. The caller still reports AU-14 failures only after the outer transaction returns/commits. No route, policy, capability, tenant predicate, lock acquisition, write, event, audit payload, failure handling, or public API changed in this diff. The inherited lifecycle/advisory lock-order issue remains outside this extraction and was not repaired or represented as resolved.

The actual change therefore fits the security-scope row for a path-only extraction that inspection confirms changes no authority or gate pass/fail semantics: one ordinary reviewer, followed by the separately required lightweight fresh Sol security confirmation. This verdict does not replace that Sol review or any CI/runtime acceptance.

## Findings

**Blocking:** none found in the inspected source change.

**Non-blocking validation limit:** no runtime was available or authorized for this review. The affected existing integration paths are represented by the named SCIM requester-invalidation and OIDC workspace-access tests; the local-factor test covers the lifecycle gate. No test was run here, and this report makes no claim that these tests, PostgreSQL, CI, browser, Docker or image boot passed. A focused PostgreSQL run of those existing files is suitable for acceptance when the conductor's shared heavy-test window is available. No test changes appear in this candidate.

## Commands and native checks

All shell commands used an explicit workdir of `/Users/heinthura/.codex/worktrees/remaining580-pending-action-invalidation-luna`.

Read-only commands/checks actually run:

- `git status --short --branch`; `git rev-parse HEAD` and exact base/head/tree object checks.
- `git diff --stat <base> <candidate>`; `git diff --find-renames --unified=80 <base> <candidate> -- <four paths>`.
- `git diff --name-status <base> <candidate>`; result is exactly the four paths above.
- `git diff --check <base> <candidate>`; clean.
- `rg` searches for affected function imports/call sites and relevant integration-test coverage.
- Read the repository documents and targeted source/test sections listed above.
- `git status --porcelain=v1`; clean.

Not run: tests, typecheck, lint, build, AST/check:queries, database access, browser, Docker/image, CI/GitHub, or any write to the worktree. No product source, tests, or review notes were edited. This report was created as the sole output and set to mode `0600`.


## Authentic artifact 3: `pending-action-invalidation-e67-security-61-sol.md`

Origin: retained private dispatched author/reviewer output; 9552 bytes, SHA256 `6ff7cf9990aefc311f02233658b42186a7510220bc5131c61837f154e47bbe11`. The following report is reproduced unedited with its original model, role, independence and exact-source limits.

# Independent security confirmation — pending-action invalidation query ownership

**Reviewer:** GPT-6 (platform-visible identity; exact served variant is not exposed in this context).
**Dispatch provenance:** requested `gpt-6.1-sol`, reasoning `high`, `fork_turns=none`, task `/root/invalidation_e67_security_sol`; requested route is not a served-model attestation.
**Role:** fresh independent Sol-tier security confirmation, after the ordinary review cleared. I did not author, direct or remediate this candidate.
**Reviewed head:** e67c3e8b5d7cc539898196bd89efc7d7dd625c2f
**Comparison base / direct parent:** `2e6aa3dcf74ba5f2d6dc733ae54dc68be16c552b`
**Candidate tree:** `95a07d1d28c4aa9fac92f2da04d6b81cf37e0f88`
**Branch:** `codex/remaining580-pending-action-invalidation-luna`
**Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-pending-action-invalidation-luna`
**Recorded UTC:** 2026-10-17T07:39:18.878616+00:00

## Verdict and risk classification

**CLEAR — lightweight independent source-level security confirmation.** No blocking finding in this exact extraction. Inspection independently supports the review-policy row for a security-related extraction that provably changes no authority or gate pass/fail semantics: one ordinary review followed by this fresh lightweight security confirmation. The sensitive lifecycle subsystem warrants this review; the content does not change auth, permissions, concurrency semantics or a security control's core semantics and does not warrant escalation to a full redesign review.

This is a per-PR source confirmation, not a phase finalizer, SIT audit, merge approval, runtime acceptance or #580 completion.

## Exact scope and preservation

I inspected the complete base-to-head diff, both resulting services and both new repository modules. Recursive `git ls-tree -r` comparison independently proves exactly four differing paths, all regular mode `100644` files:

| Path | Candidate blob |
| --- | --- |
| `apps/api/src/pending-action/lifecycle-invalidation.repository.ts` | `9f115c1321e355812b183ad9cb25349d671557eb` |
| `apps/api/src/pending-action/lifecycle-invalidation.ts` | `01103f825a0f20577cc022ea610cbff46bec6d08` |
| `apps/api/src/pending-action/workspace-access-invalidation.repository.ts` | `0856f23b4d78161a7cb4c640b4610bd58ba40898` |
| `apps/api/src/pending-action/workspace-access-invalidation.ts` | `650d3f93bbee07da5148e03f689bb0e74b38eb06` |

All other tracked blobs and modes, including callers, routes, policies, schemas, tests, dependencies, configuration and review/gate machinery, are identical to the comparison base. The direct parent, head, tree and clean worktree were verified.

The four extracted operations preserve:

1. The exact two-key transaction advisory-lock SQL, namespace literals and awaited acquisition. The public service wrapper still receives the caller transaction and awaits the repository helper.
2. Full requester pending-row selection with the identical requester/state predicates, ascending `id` ordering and `FOR UPDATE`.
3. The identical pending-to-invalidated conditional update by action id plus `state = pending`, exact assignments including `requester_deactivated`, null actor/session and caller-supplied `occurredAt`, and `RETURNING id`. The materialized single row or `undefined` preserves the no-write branch that skips event/audit work.
4. Full workspace candidate selection with the identical workspace set, pending state, `service_calendar`/`saved_view` targets and ascending `id` order. The service retains deduplication, sorting and the empty-set early return before querying.

A Python standard-library textual comparison of the four original and extracted statement bodies passed after only the intended `tx`→`executor`, local-result and parameter-name substitutions plus whitespace normalization. The workspace target constant is identical. This is direct source comparison, not an AST/checker or SQL-runtime test.

Both new repositories use the canonical first-parameter `Executor`, await their statements, return materialized rows or `undefined`, and neither open transactions nor use a fallback/global connection. Existing service transaction signatures and public APIs remain unchanged. The extra async call preserves rejection propagation and remains awaited before the caller can commit.

## Security and transaction boundaries checked

The requester service retains row iteration, conditional write, outbox enqueue, nested audit transaction/savepoint, audit-only catch and failure counting. An outbox or query failure still escapes to roll back the outer lifecycle transaction; audit insertion failure still preserves the decision/event through the existing savepoint exception. The supplied timestamp is not replaced by a new clock sample. AU-14 reporting remains after the outer caller transaction returns successfully.

The workspace service retains before/after canonical required-access evaluation, allowed→denied filtering, unchanged reason selection and existing credential-invalidation function invocation. The wrapper still takes the lifecycle gate, captures before state, invokes mutation and checks after state in the same caller transaction, then reports AU-14 failures after commit. No new authority source, actor-facing endpoint, tenant reach, scope predicate, event or audit field is introduced. These are existing internal lifecycle selections, not a newly exposed caller read API.

I inventoried all source references for the existing lifecycle/requester/workspace helpers and verified that each new repository export is consumed only by its owning service. I inspected canonical `database/executor.ts`, representative unchanged requester and workspace authority call bodies in `identity/repository.ts`, the guarded OIDC mapping mutation and after-commit reporter, and the service-calendar/workspace wrapper consumers. Recursive tree equality proves the remaining caller code is unchanged; this report does not claim a new audit of every unchanged caller implementation.

## Existing tests and evidence limits

I read relevant existing coverage in `tests/api-integration/scim-admin.test.ts` (requester invalidation, multiple SQL audit failures and lifecycle races), `tests/api-integration/local-factor-policy.test.ts` (real lifecycle-lock serialization), and `tests/api-integration/identity/oidc-group-mapping-admin.test.ts` (workspace access loss, exactly one decision event/audit, and terminality after restored reach). No new behavioral gap attributable to this relocation was found that requires a new test.

**No runtime commands were executed by this reviewer.** Tests, PostgreSQL, lint/typecheck/build, query checker, browser, Docker/image boot, current hosted CI and GitHub state were not independently run or verified here. The conductor owns the exclusive runtime window; its proposed three-file PostgreSQL run was pending at dispatch. No outcome for that run is claimed. Source confirmation does not replace required acceptance checks.

## Findings and residuals

**Blocking findings:** none in the reviewed delta.

**Non-blocking residual N1:** the inherited action-row/advisory lifecycle-lock inversion is unchanged and unresolved. This confirmation neither repairs nor waives it and does not claim the complete pending-action lock-order contract is satisfied.

**Evidence precision:** the ordinary report's publication used initial write followed by chmod rather than exclusive creation, per the conductor's disclosed provenance. I did not observe its creation and make no exclusivity claim for it; that is not a source-security defect in this four-file candidate. The author table contains a transcription error for the workspace service blob; Git independently resolves the actual blob to `650d3f93bbee07da5148e03f689bb0e74b38eb06`, as recorded above. The authentic author report remains unchanged.

## Commands and inputs actually used

Every shell command used the explicit workdir listed above. Read-only operations: `pwd`; `git status --short` / `--porcelain=v1`; `git rev-parse HEAD HEAD^{tree}`; complete `git diff --stat`, `--full-index --no-renames`, `--raw --no-abbrev`, and `--check` against the exact base/head; `git show` and recursive `git ls-tree -r` through Python subprocess; `rg --files` and targeted `rg -n`; `cat` and ranged `sed` reads. Python standard-library assertions verified exact tree scope, file modes/blobs, direct parent, statement-body equivalence, target constant and clean status.

Read policy/spec inputs: `AGENTS.md`, `CLAUDE.md`, active mission, workflow including review/evidence rules, coding-standard #580 ownership/executor/result/scoping rules, relevant #580 and PA-9 decisions, pending-actions architecture (especially PA-9, lifecycle order and PA-11), and CI/CD security-review scope. The accepted comparison tree differs only in the four source files, so these documents are unchanged from that base. No live GitHub action was performed under the bounded review assignment.

Read external evidence as context, without treating it as my executed tests:

- Author report SHA-256: `c13795ae46c6a33fa612e5652035944367576de048c4beb8d495562eae57b335`.
- Ordinary report SHA-256: `30535dc21f02123db49ff87681e3903f98dbea236d0de2f2153a58916f759e6e`; verdict CLEAR on the exact same base/head/tree.

No source, test, repository note, Git ref or shared runtime was edited. This report is the sole written deliverable, created with `os.open(O_WRONLY | O_CREAT | O_EXCL, 0o600)`; an existing destination would fail rather than be overwritten.


## Authentic artifact 4: `pending-action-invalidation-b4a49-composition-ordinary-luna.md`

Origin: retained private dispatched author/reviewer output; 4107 bytes, SHA256 `ded7dbdc7b39b7669ba43aef203e8bf15618309c37ab647d3859b873d263d23c`. The following report is reproduced unedited with its original model, role, independence and exact-source limits.

# #580 pending-action invalidation — current-main composition ordinary review

- **Model:** GPT-6 (Luna-tier ordinary-review assignment; this context does not expose a more specific served version or fingerprint)
- **Role and independence:** Fresh independent ordinary composition reviewer; I did not author, direct, or remediate this candidate.
- **Reviewed source:** `b4a49ac736dcf3cce585bb7fcff8eb68d744124c`
- **Accepted-main comparison:** `555879db9e4841c1460346c115111881d3cd3387`
- **Parents:** prior reviewed product source `e67c3e8b5d7cc539898196bd89efc7d7dd625c2f`; accepted-main composition `555879db9e4841c1460346c115111881d3cd3387`
- **Scope:** the four conserved pending-action invalidation paths and their interaction with accepted-main callers, `Executor`, transactions, and AU-14 audit/outbox handling. This is the ordinary composition review, not the separate required lightweight security confirmation.
- **Verdict:** **CLEAR** for the reviewed composition scope. No blocking or non-blocking findings.

## What I checked

- Read the current repository workflow, active mission, pending-action contract, and accepted query-ownership convention. The convention places all statements in repository modules, requires an `Executor` for helpers participating in a caller's transaction, and permits services to own transaction orchestration.
- Inspected the exact diff from accepted main. It changes only these four paths: `lifecycle-invalidation.repository.ts` (new, 53 lines), `lifecycle-invalidation.ts` (query extraction), `workspace-access-invalidation.repository.ts` (new, 23 lines), and `workspace-access-invalidation.ts` (query extraction). `git diff --check 555879db9e4841c1460346c115111881d3cd3387..HEAD` returned no whitespace errors.
- Verified the composition conservation receipt at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/pending-action-invalidation-b4a49-main5558-conservation.json`: all four owned paths retain their source mode/type/blob; every other entry equals accepted main; the 3,404-entry tree is a normal clean merge. This receipt is source-composition evidence, not a test or acceptance result.
- Compared extracted repository statements with their former service implementations. The global two-key transaction advisory lock, requester pending-row predicate/order/`FOR UPDATE`, conditional invalidation update and returned id, and workspace deletion-action predicate/order are preserved. Repository helpers take `executor: Executor` first, await statements, and return rows/scalars; none opens or commits a transaction.
- Traced service callers in accepted-main `identity/repository.ts`, identity configuration/SCIM callers, and workspace/view/service-calendar lifecycle callers. Their exported service function signatures and call ordering are unchanged. In particular, callers still acquire the lifecycle gate and capture before-state within their transaction; workspace mutation, after-state evaluation, invalidation, and outbox remain in the same outer transaction. The AU-14 audit insert remains isolated in its existing nested transaction/savepoint and failure reporting remains after the outer commit.
- Checked the accepted-main composition preserves the current identity lifecycle callers and executor contract unchanged. The extracted repository modules fit the accepted path convention (`**/*.repository.ts`) and import only the executor type and schema/query dependencies needed for persistence.

## Findings and limits

No defect was found in the composition delta or in the reviewed caller/executor/transaction/audit seams. The inherited N1 action-row/advisory-lock inversion remains **unresolved and non-blocking for this extraction review**; this change does not fix it and I do not claim it is fixed. The previous 3-file/43-test PostgreSQL result is bound to `e67c3e8b5d7cc539898196bd89efc7d7dd625c2f`, not this composition. I ran no runtime, AST/compiler, unit/integration, PostgreSQL, or Docker checks. This verdict does not cover the lightweight Sol confirmation, exact-head hosted checks, publication, or merge readiness.


## Authentic artifact 5: `pending-action-invalidation-b4a49-composition-security-61-sol.md`

Origin: retained private dispatched author/reviewer output; 8277 bytes, SHA256 `a5a59c61ee5e3ac574391b94e694a3f5f5cc6176e271a358af1a2d337b96b1ae`. The following report is reproduced unedited with its original model, role, independence and exact-source limits.

# Independent security composition confirmation — pending-action invalidation #580

**Reviewer:** GPT-6 (platform-visible identity; no more specific serving version or fingerprint is exposed to this context).
**Dispatch provenance:** requested `gpt-6.1-sol`, reasoning `high`, `fork_turns=none`; task `/root/invalidation_b4a49_composition_security_sol`, parent `/root`. This records the requested dispatch route, not an independently attested served-model fingerprint.
**Role and independence:** Fresh independent security-tier composition reviewer, after the current ordinary review cleared. I did not author, direct, or remediate this candidate; no author conversation was inherited.
**Reviewed head:** b4a49ac736dcf3cce585bb7fcff8eb68d744124c
**Reviewed tree:** `5128f5d17b12755a18c0833f63c1ee360cf69098`
**Comparison base:** accepted main `555879db9e4841c1460346c115111881d3cd3387`
**Parents:** prior reviewed extraction `e67c3e8b5d7cc539898196bd89efc7d7dd625c2f`, then accepted main `555879db9e4841c1460346c115111881d3cd3387`.
**Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-pending-action-invalidation-luna`

## Verdict and depth

**CLEAR — lightweight independent source-level security composition confirmation.** No blocking finding or new non-blocking defect in the reviewed delta or composition seams. The four-path extraction preserves authority, predicates, locking and transaction semantics; no new capability, trust boundary, security-control semantics or gate pass/fail behavior is introduced. The no-authority-change review depth is appropriate. This is the required additive security confirmation, not a waiver or a substitute for current tests, required hosted checks, shipping image/runtime proof, protected acceptance, a phase finalizer or whole-#580 completion.

## Independent preservation checks

I fully read the current composition ordinary report and the prior e67 ordinary and security reports. Their SHA-256 values are respectively:

- `ded7dbdc7b39b7669ba43aef203e8bf15618309c37ab647d3859b873d263d23c`
- `30535dc21f02123db49ff87681e3903f98dbea236d0de2f2153a58916f759e6e`
- `6ff7cf9990aefc311f02233658b42186a7510220bc5131c61837f154e47bbe11`

The ordinary composition verdict is CLEAR on this exact head and base. I independently reconstructed recursive Git path/mode/type/blob maps rather than relying only on the conductor's conservation receipt. The 3,404-entry candidate has exactly four differences from accepted main: the two invalidation services and their two new `*.repository.ts` modules (97 insertions, 47 deletions). All four owned entries equal prior e67 mode/type/blob exactly. Every other entry equals accepted main exactly. The actual two parents, tree, source HEAD and clean worktree match the receipt. `git diff --check` against the exact accepted base passed.

The sole incoming product path since e67 is `apps/api/src/auth/repository.ts`; the other incoming paths are accepted records/review evidence. A Python standard-library reconstruction changing precisely 14 existing read declarations to `async` and their first returns to `return await` matched the entire incoming auth repository byte-for-byte. This proves all other auth bytes, including challenge/issuance locking, are preserved. GitHub read-only inspection of PR #819 verified MERGED with merge commit `555879db9e4841c1460346c115111881d3cd3387`. The open-PR listing contained no PR for this invalidation branch at inspection time; no current-publication or hosted-check clearance is claimed.

## Security seams checked

I inspected the complete accepted-base diff, both resulting services and both new repositories. The two-key global transaction advisory lock has the same SQL and literals and remains awaited. Requester selection preserves requester plus pending-state predicates, full rows, ascending id and `FOR UPDATE`. The conditional update retains action id plus pending state, exact invalidation reason, null decision actor/session, supplied timestamp and returned id. A missing returned row still skips all event/audit work.

Workspace selection preserves the exact workspace-id set, pending state, calendar/view target set and ascending id. Deduplication, sorting and the empty-set early return remain in the service. Before/after required-access evaluation still receives the same transaction and complete stored binding. Only allowed-to-denied transitions reach the existing conditional invalidation helper; reason mapping and terminality are unchanged. These are internal lifecycle selections, not a newly exposed unscoped read API.

Both repositories take the canonical first-parameter `Executor`, await materialized results and use only the supplied handle. Neither opens/commits a transaction, resolves a fallback connection or exports a query builder. Their new exports are consumed only by the owning services. The service transaction types and public signatures remain unchanged; awaited rejection propagation still reaches the outer transaction before commit.

I traced representative accepted-main seams in identity person deactivation and SCIM group writes, OIDC mapping administration, workspace member removal and the calendar wrapper. The lifecycle gate still precedes the existing mutation path, capture still precedes authority mutation, after-state evaluation still uses that same outer transaction, and AU-14 reporting remains after it returns. The outbox write is awaited outside the audit-only catch, so its failure still escapes to roll back the outer mutation. The existing nested audit transaction/savepoint remains the sole swallowed audit failure; decision/event preservation and post-commit failure reporting are unchanged. The outbox and audit writer contracts and the shared Executor were inspected.

For incoming accepted auth materialization, I inspected both pending-action preflight callers. They still await owner/state/expiry-scoped results and then enforce the existing action, target, route and confirmation checks. The read supplies no issuance authority; issuance retains its own locked rechecks. The accepted configuration reload still awaits its read-only `Promise.all` before constructing and publishing either auth instance. The disclosed exceptional scheduling difference remains: an async-wrapped synchronous construction throw can permit the second read to start before the combined rejection, but cannot publish partial configuration. No new interaction with the invalidation extraction was found. Unchanged prior work was not subjected to another comfort re-audit.

## Findings, residuals and limits

**Blocking findings:** none in this exact composition scope.

**Inherited non-blocking N1:** challenge creation takes the action-row lock before the session/action advisory lock; issuance takes that advisory lock, then the session and action-row locks. This source-derived possible deadlock remains unchanged, unresolved, unreproduced here and unwaived. It concerns the existing step-up lock order; this confirmation does not claim it fixed or claim complete PA-15/concurrency correctness.

The previous three-file/43-test PostgreSQL proof remains evidence for e67 only. It is not a test result on b4a49. I ran no Node, AST/compiler/query checker, lint, typecheck, tests, PostgreSQL, Docker/build/image, browser, application runtime or diagnostic census. The conductor reserved those resources and owns current-source acceptance. No CI result was synthesized or promoted.

Read policy/spec inputs: current AGENTS, active mission, workflow/review/evidence rules, provider adapter, error-fix-loop, CI security scope, query-ownership/Executor/results standard, PA-9 lifecycle/lock-order and PA-11 audit contract, and targeted dated status/queue/decision context. These policy bytes are conserved from accepted main. Actual read-only operations were Git HEAD/parent/tree/status/diff/numstat/check, recursive tree comparison and auth-wrapper reconstruction with Python standard library, report-byte hashing, targeted rg/cat/sed source and document reads, `gh pr list` and `gh pr view 819`. No source, tests, repository documents, refs, PRs or shared runtimes changed. This private report is the sole write, created exclusively with mode 0600.

**Recorded UTC:** 2026-10-17T11:18:50.490448+00:00


## Publication binding

**Reviewed head:** `b4a49ac736dcf3cce585bb7fcff8eb68d744124c`

All five authentic artifacts above are preserved unedited. Source conservation and the current43-test scoped proof do not clear pending required GitHub checks, runtime image acceptance or the inherited N1 residual.
