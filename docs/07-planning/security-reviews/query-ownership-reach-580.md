# #580 reach and workspace-admin query ownership — authentic reviews

**Reviewed head:** `ac330d3165e74db5ee65ad6b322e93a28b94afde`

Three fresh independent ordinary contexts and a subsequent fresh independent full Sol review clear source correctness/security for this composition. Current actual typed checker7b reports zero violations across twenty-one changed production files; focused API unit three files/twenty-nine tests, API typecheck and Biome pass, with the unit run independently repeated by Sol. These are scoped checks, not whole-program progress or tenant-predicate proofs.

The clean merge preserves original #790 head `c3932308c88ba475bbabda202fff259bbc2117f0`, separately reviewed workspace-admin extraction `4ac8909c680fb026648c334e2eab6e5783b9a9a8`, and accepted main `e9df2294fa580fd2885343bbef0cec28e81ead4c`. It imports substantive accepted release/deployment/project controls, not only documentation; the automatic merge tree is verified. Original #790 completed reviews were not found (old PR body pending/comments empty), so none is fabricated. Component and fresh composition reports are retained unchanged below. Explicit dispatch used GPT-6 Luna for ordinary/author contexts and GPT-6 Sol for security; reports preserve their actual runtime identity/introspection limits.

This is partial #580. Shared reachableWorkspacePredicate SQL and project-creator-grant queries remain separate residuals; two old seed raw-builder helpers are corrected in the separately reviewed boot candidate, not this branch. #764 and the authentic #780 record carried by unaccepted #791 remain mandatory merge prerequisites. Current-head hosted PostgreSQL, image/boot/health and runtime acceptance are pending; no merge, phase, release or SIT claim.

---

Retained evidence file — 580-workspace-admin-query-extraction-luna.md

# #580 workspace admin reach query extraction handoff

- **Branch:** `codex/query-ownership-580-workspace-admin-reach`
- **Base:** `629cb54f8f68293de58bc7b98a5e408a9f679427` (requested exact base; contract 062 plus accepted main e9)
- **Candidate:** `4ac8909c680fb026648c334e2eab6e5783b9a9a8`
- **Commit:** `refactor(api): extract workspace admin reach queries`
- **Worktree:** `/Users/heinthura/.codex/worktrees/580-workspace-admin-reach/Ticketing.v2`
- **Scope:** exactly `apps/api/src/workspace/workspace-admin-reach.ts` and new `apps/api/src/workspace/workspace-admin-reach.repository.ts`.

## Change

Moved Drizzle query construction for workspace owner/admin reach into the named repository. The service retains the existing orchestration entrypoints and flow. Repository operations use the canonical `Executor` type for transaction-bound calls, await/materialize query results, and do not start transactions. Boot reconciliation still uses the shared database for candidate selection; the service still owns the per-candidate transaction and failure handling.

Preserved person row locking before grant locking, deterministic person lock ordering, the built-in owner/admin role checks and empty-capability reach carrier, direct `system_backfill` grant provenance, `sees_all` grant/revoke behavior, membership projection, project-creator grant revocation callback, audit sequencing, and migration/startup context. No schema, permission, policy, feature, dependency, or behavior changes were made. Project creator grant query ownership remains a separate explicit residual; `project/project-creator-grant.ts` was not edited.

## Checks

- `pnpm install --frozen-lockfile --prefer-offline` — passed; lockfile unchanged.
- `pnpm turbo build --filter=@taskdesk/api^...` — passed; three prerequisite package builds reported successful (cache hits).
- `pnpm --filter @taskdesk/api typecheck` — passed on the committed source (API production, permissions, tests, RLS prototype, and approvals TS projects).
- `pnpm exec biome check apps/api/src/workspace/workspace-admin-reach.ts apps/api/src/workspace/workspace-admin-reach.repository.ts` — passed, 2 files.
- `git diff --check` — passed.
- Prepared #580 ownership checker `analyzeQueryOwnership` against the two changed files and candidate checkout — passed, zero violations.

## Not run / evidence limits

- No API or integration tests were run. The only directly relevant reach test is PostgreSQL integration; the assignment explicitly prohibited PostgreSQL/Docker runtime checks pending restart authorization. No Docker, PostgreSQL, browser, image, or startup validation was attempted.
- No full-repository checker run, lint, test suite, or current runtime proof is claimed.
- Historical PostgreSQL integration evidence in repository status/records is not current-candidate proof and is not cited as such.
- No push or PR was created. No #580 acceptance or phase acceptance is claimed.

## Exact change boundary

`git show --format= --name-only 4ac8909c680fb026648c334e2eab6e5783b9a9a8` lists only the two authorized source paths above. The candidate is one commit ahead of the exact requested base.

---

Retained evidence file — 580-workspace-admin-ordinary-a-luna.md

# #580 workspace-admin reach query extraction — ordinary review A

- **Role:** fresh independent ordinary reviewer A (dispatch label: Luna-tier ordinary review)
- **Reviewer identity:** dispatched explicitly by the orchestrating session as a fresh read-only review context; I did not author, direct, or remediate this candidate. The platform identifies this context as GPT-6; this report does not relabel it as Luna.
- **Candidate:** `4ac8909c680fb026648c334e2eab6e5783b9a9a8`
- **Comparison base:** `629cb54f8f68293de58bc7b98a5e408a9f679427`
- **Scope:** only `apps/api/src/workspace/workspace-admin-reach.ts` and newly added `apps/api/src/workspace/workspace-admin-reach.repository.ts`.
- **Verdict:** **CLEAR** for the bounded repository-query extraction, by source inspection. This is not an acceptance of #580, #764, #780, carrier G11, the migration, or the broader reach feature.

## What I checked

- Compared the exact two-file diff and inspected the resulting service and repository source.
- Checked the repository executor contract in `apps/api/src/database/executor.ts`, Query ownership in `docs/04-engineering/coding-standards.md`, and the tenant/reach separation in `docs/01-architecture/multi-tenancy.md`.
- Checked the runtime owner/admin `sees_all` decision in `docs/07-planning/decision-log.md`, boot sequencing in `apps/api/src/index.ts`, and migration 0123's documented carrier/provenance shape.
- Ran `git diff --check` on the scoped candidate diff: passed. The worktree was clean at inspection.

## Findings

No blocking or non-blocking findings in the scoped extraction.

The transactional statement paths continue to receive and use the caller's exact `tx` handle: the service passes it to each query-owning repository helper, including the role resolution query. The extracted role lookup/create/re-read sequence retains conflict-tolerant creation and fails closed unless the resulting workspace carrier row is system-owned. Owner/admin resolution remains unambiguous and retains the genuine seeded-admin check. The role carrier still has empty capabilities, while `sees_all` remains an explicit direct grant with `system_backfill` provenance; active admin-origin direct grants remain untouched. Revocation, grant insertion/update, projection, creator-grant callback, and audit remain in the same caller transaction and retain their prior ordering. Person locking remains ordered by person id. Reconciliation candidate enumeration remains a non-transactional shared-database read, while each candidate sync still runs in its own transaction and failures remain isolated. Startup still seeds default roles and staff persons before reconciliation.

The new file name matches the documented `*.repository.ts` repository naming convention. This confirms ownership location only; it does not establish that the planned `check:queries` gate is implemented or wired.

## Not verified

I did not run targeted checker, TypeScript, Biome, or PostgreSQL/integration tests in this review. The implementation report supplied with the dispatch records zero targeted checker/type/Biome runs and no PostgreSQL proof; I treat those as author-provided evidence, not checks performed by this reviewer. Docker and browser verification were outside this bounded query-extraction review and unavailable under the dispatch constraints. The separate project-creator-grant helper remains an identified residual outside this two-file scope.

---

Retained evidence file — 580-workspace-admin-ordinary-b-luna.md

# Ordinary review B — #580 workspace-admin query extraction

- **Candidate:** `4ac8909c680fb026648c334e2eab6e5783b9a9a8`
- **Base:** `629cb54f8f68293de58bc7b98a5e408a9f679427`
- **Independence:** Fresh review context; I did not author, direct, or remediate this change. Review was read-only.
- **Reviewer/model provenance:** Assigned as the Luna-tier ordinary review (report filename/dispatch label: GPT-6 Luna). Runtime model introspection is unavailable to this context, so the dispatch label is recorded as such, not represented as independently verified runtime metadata.
- **Scope checked:** Exactly the two changed product files: `apps/api/src/workspace/workspace-admin-reach.ts` and new `apps/api/src/workspace/workspace-admin-reach.repository.ts`; repository query ownership rules in `docs/04-engineering/coding-standards.md` and `docs/04-engineering/agent-workflow.md`; the active mission; owner/admin explicit `sees_all` decision and project-creator grant decision; RBAC/data-model statements; all callers, the project-creator cleanup helper, and startup reconcile invocation.
- **Checks/reproductions:** Static source and diff inspection; confirmed the candidate checkout HEAD equals the candidate SHA, the diff contains exactly the two named files, `git diff --check` is clean, and the worktree was clean. No tests, typecheck, PostgreSQL/runtime, Docker, or browser checks were run in this review context; the handoff reports those separately.

## Verdict: CLEAR

I found no blocking or non-blocking defect in this two-file query extraction.

The new repository module owns the extracted Drizzle statements. Helpers used within an existing transaction accept `Executor` first and run their statements against the supplied transaction; the reconcile-candidate list is correctly a shared-`db` query that never joins a caller transaction. Every query is awaited and returns materialized rows or `void`, not a builder. `desiredWorkspaceAdminReachRole` preserves the legacy membership resolution and genuine built-in admin check. Carrier role creation still uses empty capabilities and `isSystem: true`; subsequent lookup trusts only a system row, so same-key custom rows fail closed. Grant writes retain `source_kind=direct`, `direct_origin=system_backfill`, `sees_all=true`; only that provenance is mutable, preserving admin direct and external grants.

The moved lock statements preserve their behavior: per-member sync locks the person row `FOR UPDATE` before the active grant row; paired person locks order by `person.id` before ownership-transfer syncs. The reconcile selector retains its staff and owner/admin filters and its `NOT EXISTS` exclusion for active direct workspace grants. Projection, project-creator cleanup, and the reach audit remain in the caller's transaction; the cleanup still occurs after workspace projection and before the reach audit, and both its own audit rows and grant changes use the same transaction. Boot reconciliation remains invoked at the existing startup location. Migration files and other startup wiring are unchanged by this candidate (the diff has only the two reviewed paths).

## Separate residual, outside this candidate

`project-creator-grant.ts` still constructs its own Drizzle statements outside a `*.repository.ts` module. This is a separate #580 query-ownership residual, not a defect introduced by this candidate; the requested candidate is limited to the workspace-admin reach query extraction and does not change that file.

---

Retained evidence file — 580-workspace-admin-security-sol.md

# #580 workspace-admin reach query extraction — independent security review

- **Verdict:** CLEAR for this bounded two-file extraction. No blocking or non-blocking finding in the changed scope.
- **Reviewed head:** `4ac8909c680fb026648c334e2eab6e5783b9a9a8`
- **Comparison base:** `629cb54f8f68293de58bc7b98a5e408a9f679427`
- **Scope:** `apps/api/src/workspace/workspace-admin-reach.ts` and new `apps/api/src/workspace/workspace-admin-reach.repository.ts` only.
- **Role and independence:** fresh, read-only security-review context dispatched separately from the author/fixer and ordinary reviewers A/B. I did not author, direct, or remediate this candidate. Dispatch specified `gpt-6-sol` with `fork_turns=none`; runtime model introspection is unavailable here, so this is dispatch provenance, not a claim of intrinsic model self-verification.

## Security checks performed

I compared the exact base service source with both changed files and inspected the resulting service and repository. The diff contains exactly the two named files, HEAD equals the reviewed head, the worktree was clean, and `git diff --check` passed. I read the repository `Executor` contract, query-ownership convention, the 2026-10-14 owner/admin explicit `sees_all` and project-creator decisions, RBAC and grant-provenance contracts, the workspace-role resolution helper, the project-creator cleanup callback, all `syncWorkspaceAdminReach` call sites, and startup reconciliation order.

The extracted owner/admin resolution still reads every legacy membership role through `workspaceMemberRoles`, fails closed for ambiguous or malformed roles, and checks that an `admin` workspace-role row is genuinely system-owned. The carrier-role query remains scoped to `scope='workspace'`, the supplied workspace, and key; conflict-tolerant creation retains empty capabilities and `isSystem=true`. The service re-reads after creation and accepts only a system row. No capability snapshot or identity-provider authority was added.

Every transaction-bound repository helper takes the caller's `Executor` first; the service passes its actual `tx` on each path. The person row remains locked `FOR UPDATE` before the active direct-grant row. Pairwise person locking still orders by person id and uses `FOR UPDATE`. Grant selection retains person, workspace scope/id, `source_kind='direct'`, and active-row predicates. The service still leaves any active non-`system_backfill` direct grant untouched. Its insert retains `direct/system_backfill/sees_all=true`; update and revocation preserve their previous fields and conditions. Projection follows the grant mutation, project-creator cleanup follows projection on a valid role, and the reach audit follows cleanup in the same caller transaction. No repository helper opens a transaction or falls back to shared `db` on these paths.

The boot selector remains a shared-connection query with the same staff, owner/admin, and active-direct-grant exclusion predicates. Its async function resolves the Drizzle thenable to rows for the caller; it does not expose a builder for further composition. Reconciliation still uses a separate transaction per candidate and isolates failures. Startup still seeds workspace roles and staff persons before reconciliation; migration and connection setup files were unchanged.

## Evidence limits and residual

This review ran source/diff inspection and `git diff --check`; it did not run TypeScript, Biome, the prepared query checker, PostgreSQL, API/integration tests, Docker, image boot, or browser checks. The author handoff reports API typecheck, two-file Biome, and focused query checker with zero violations, but those are author-provided results and were not independently rerun here. PostgreSQL/runtime proof awaits owner-authorized restart. The separate `project/project-creator-grant.ts` query-ownership work remains an explicit #580 residual outside this candidate.

This verdict does not accept #580, #764, #780, carrier G11, the migration, startup runtime, or any stage. It addresses security semantic conservation in the exact extraction only.

---

Retained evidence file — 580-reach790-composition-a-luna.md

# #580 composition of #790 and workspace-admin extraction — ordinary review A

- **Reviewed head:** `ac330d3165e74db5ee65ad6b322e93a28b94afde`
- **Comparison base:** accepted `main` at `e9df2294fa580fd2885343bbef0cec28e81ead4c`
- **Parents:** retained #790 source `c3932308c88ba475bbabda202fff259bbc2117f0`; workspace-admin extraction `4ac8909c680fb026648c334e2ab6e5783b9a9a8`
- **Role / independence:** fresh read-only ordinary reviewer A, assigned Luna-tier. I did not author, direct, or remediate either parent or this composition. The platform identifies this context as GPT-6 but exposes no variant/version introspection; I do not claim a verified GPT-6 Luna runtime identity.
- **Scope:** full candidate delta against accepted main, both parent deltas and merge conservation, repository D1–D4 contract, authorization/reach and registration call sites, tests and review/acceptance provenance.
- **Verdict:** **CLEAR for source correctness and behavioral conservation by inspection; no blocking or non-blocking code findings.** This is one ordinary review of the exact composition only. It is not a query-ownership slice acceptance or merge clearance.

## Review and conservation

The merge is a clean automatic composition: `git merge-tree --write-tree HEAD^1 HEAD^2` produced `3527661da9b777a49f7c910544a4f2902bf983aa`, exactly the candidate tree. The composition adds only the workspace-admin repository extraction and associated current-main changes relative to parent 1; the retained #790 utility conversion remains present. The full candidate delta against accepted `main` contains the query ownership changes and their documented source/test changes. No manual conflict resolution or unaccounted parent hunk was found.

I checked the D1–D4 contract in `docs/04-engineering/coding-standards.md`: statements are placed in repository-named modules or the bounded database infrastructure list; transaction-bound queries receive and use the caller's executor; raw query fragments remain within the specifically identified D2 residual; repository calls yield materialized results; and the scripts exclusion is unchanged. The planned `check:queries` gate remains unwired and is not claimed as an active enforcement result.

The moved utility lookups preserve their source predicates, joins, limits, result shapes, locking clauses and caller-side allow/deny decisions. In particular, API-key ownership/enabled/expiry checks, workspace membership scope, genuine-system-role lookup, live-project/task checks, asset reach and denied-evidence predicates, registration invitation status/expiry/email predicates, and the assignee membership/admin locks remain present. I found no new authority path or customer/identity-provider special case. The workspace-admin extraction preserves the caller's transaction handle, lock order, built-in role provenance checks, empty-capability reach carrier, `direct/system_backfill/sees_all` grant provenance, protection of other direct/external grants, projection, creator-grant callback and audit ordering. The explicit project-creator grant query helper is unchanged and remains a separate query-ownership residual. Registration, invitations and typed-domain SSO remain held; this extraction does not activate them.

The shared `reachableWorkspacePredicate` remains defined outside a repository and is imported by the asset repository. This is the already identified D2 fragment-helper residual, not a new change in this candidate; I do not count it as a candidate finding. Query ownership remains separate from tenant-predicate correctness, as the candidate's canonical documents now state.

## Checks performed

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/utils/authorize-asset-access.test.ts ../../tests/api/utils/require-workspace-capability.test.ts ../../tests/api/database-executor.test.ts` — **3 files, 29 tests passed**.
- `pnpm --filter @taskdesk/api typecheck` — **passed** (API production, permissions, tests, RLS prototype and approvals TypeScript projects).
- `git diff --name-only --diff-filter=ACMRT e9df2294..HEAD -- '*.ts' '*.tsx' | xargs pnpm exec biome check` — **25 files checked, passed; no fixes applied**.
- `git diff --check e9df2294..HEAD` — **not clean** because the added historical `docs/07-planning/security-reviews/764-query-ownership.md` contains existing trailing-space formatting in its review-note records. No product-source whitespace issue was identified. This is recorded, not repaired in a read-only review.
- No PostgreSQL/integration, Docker/image, browser, or hosted current-composition check was run. The requested PG/Docker authorization remains pending, and the relevant repository integration suite was not represented by the unit tests above.

## Provenance and acceptance conditions

The two fresh ordinary reviews and full Sol security review for `4ac8909c` cover only that two-file component; they are useful component evidence, not reviews of this composed SHA. I found no completed independent report for the retained #790 source. Live GitHub still shows PR #790 at its old exact head `c3932308…`, with its template/security check failed, review fields pending, and zero comments. Its prior successful integration and other checks are bound to that old head and are not current composition evidence. The composed candidate is local and unpushed in this checkout; no PR or current hosted checks for `ac330d31` are asserted.

The PR #790 body remains marked ordinary reviews and security review **pending**. Do not publish this report as filling the other ordinary roles or as a security review. The broad composition requires two more fresh ordinary contexts and a separate full independent Sol review at the current exact head before merge.

The canonical #764 documentation record says the #780 explicit-tenant decision entry is retained in carrier #791 and must first be composed into accepted main before #764 can be accepted. Live GitHub currently reports both #764 (`0627093d…`) and #780 (`4d7e2d01…`) OPEN; each has a failed PR-template/security check, and #780 has cancelled fast checks. Thus #764/#780 acceptance and their required order are explicit merge prerequisites, not facts established by this review. Candidate documentation cites the decision consistently with that recorded dependency; I found no source-code authority defect from the dependency.

**Not verified:** exact-candidate CI/required status checks, PostgreSQL integration for the moved repositories and workspace-admin reconciliation, Docker image/boot/health, browser evidence, remaining ordinary reviews, exact-head full Sol review, and the #764/#780 accepted-main prerequisite. No finding, test result, or acceptance claim is fabricated or inferred from a parent SHA.

---

Retained evidence file — 580-reach790-composition-b-luna.md

# #580 composition of #790 and workspace-admin extraction — ordinary review B

- **Reviewed head:** `ac330d3165e74db5ee65ad6b322e93a28b94afde`
- **Comparison base:** accepted `main` at `e9df2294fa580fd2885343bbef0cec28e81ead4c`
- **Parents:** retained #790 source `c3932308c88ba475bbabda202fff259bbc2117f0`; workspace-admin extraction `4ac8909c680fb026648c334e2ab6e5783b9a9a8`
- **Role / independence:** fresh read-only ordinary reviewer B. I did not author, direct, or remediate either parent or this composition. Runtime identifies this context as GPT-6; variant/version introspection is unavailable, so I do not claim verified GPT-6 Luna identity.
- **Scope:** full source composition against accepted main and both parents; D1–D4 query ownership contract; caller-to-repository wiring; executor/transaction flow; predicates and locks; materialized results; workspace-admin reach provenance, audit/error ordering; shadow evidence and error behavior.
- **Verdict:** **CLEAR for source correctness and behavioral conservation by inspection; no blocking or non-blocking candidate findings.** This verdict covers only this exact source composition. It does not establish slice acceptance or merge readiness.

## Findings and review

The candidate is the expected two-parent merge: `HEAD^1` is `c3932308…` and `HEAD^2` is `4ac8909c…`. The source delta against accepted main contains 25 TypeScript/TSX files, including the #790 repository conversions, the workspace-admin repository extraction, and their tests. `git diff --check e9df229..HEAD` reports only the previously documented trailing whitespace in the historical append-only #764 review record; I found no product-source whitespace issue.

I traced each changed caller to its new repository function and compared the moved statements to the prior inline statements. Query predicates, joins, soft-delete and expiry conditions, result fields, limits/order, and lock modes are retained. Callers still make the same authorization and response decisions. Repository functions await their statements and return rows or scalars; returning a Drizzle thenable from an `async` function is awaited by async promise assimilation, so the moved call sites receive materialized results rather than a composable builder.

Transaction-bound assignability and workspace-admin operations pass the caller's transaction handle into repository functions. The extracted workspace-admin path keeps the person-row lock before grant-row lock, the workspace membership transaction boundary, and projection/audit in that same transaction. Reconciliation candidate listing remains a standalone shared-DB read, while each candidate is reconciled in its own transaction with per-member failure logging and continued iteration. The `desiredWorkspaceAdminReachRole` role lookup receives the same executor through `workspaceMemberRoles` and `listMemberRoleRows`; no query falls back to the global connection in this transaction path.

The workspace-admin flow still requires an unambiguous genuine legacy owner/admin role, creates only the empty-capability system reach carrier, and writes only a direct `system_backfill` grant with explicit `sees_all`. It preserves explicit admin-origin grants and external grants, reprojects membership after actual derived-grant changes, removes project-creator grants when workspace `sees_all` applies, and writes the established system audit event only for real changes. The extraction did not add identity-provider authority, a new grant origin, or a new `sees_all` route.

Asset loading retains the same single-round-trip reachable predicate and post-load project reach check. Shadow evidence is still attempted only for the same policy-shadow condition, only records denial when a live non-orphaned row fails the same reach predicate, and observer failure remains swallowed solely to preserve the native masked 404. Registration/invitation error mapping and status decisions remain in their caller; query helpers only return matching rows. Session, API-key, invite-abuse, membership, task/label, and asset denial paths retain their existing shadow markers and HTTP outcomes on inspection.

The shared `reachableWorkspacePredicate` remains defined in `workspace-access-middleware.ts` and is imported into `access-lookups.repository.ts`; the explicit project-creator-grant query also remains a separate query-ownership residual. These are documented existing D2 residuals, not regressions introduced by this composition. The structural `check:queries` gate remains planned and unwired. I found no direct transaction/query ownership violation newly introduced by the candidate.

## Checks performed

- Read repository instructions and the D1–D4 coding-standard contract, RBAC/security model, workspace-admin reach implementation, all changed authorization/reach/registration wrappers, both extracted repositories, and the existing composition report A.
- Compared the candidate's changed source against accepted main and inspected its actual parent SHAs and source-file delta.
- `git diff --check e9df229..HEAD` — historical #764 review-note whitespace only; no product-source whitespace issue found.
- No tests, typecheck, PostgreSQL, image, browser, or hosted checks were run in this read-only review. I rely on no test result beyond source-bound evidence published by other contexts.

## Acceptance limits

This review is not a review of the PR body, hosted checks, PostgreSQL behavior, Docker/runtime behavior, browser evidence, or D1–D4 checker enforcement. It does not clear #764/#780 acceptance prerequisites. The earlier #790 checks and the #4ac component reviews remain bound to their original heads; they are not current-head checks or reviews. PR #790's ordinary/security fields remain pending until the conductor records authentic current-head evidence. The required independent Sol review remains separate and mandatory. No merge or slice-acceptance claim follows from this report.

---

Retained evidence file — 580-reach790-composition-c-luna.md

# #580 composition of retained #790 and workspace-admin extraction — ordinary review C

- **Reviewed head:** `ac330d3165e74db5ee65ad6b322e93a28b94afde`
- **Comparison base:** `e9df2294fa580fd2885343bbef0cec28e81ead4c`
- **Parents:** retained #790 source `c3932308c88ba475bbabda202fff259bbc2117f0`; workspace-admin extraction `4ac8909c680fb026648c334e2ab6e5783b9a9a8`
- **Role / independence:** fresh read-only ordinary reviewer C, independent of both parents and their author/remediation contexts. The platform reports this as GPT-6; the exact Luna variant/version is not exposed here, so I do not claim verified GPT-6 Luna runtime identity.
- **Scope:** exact composition and parent conservation; D1–D4 query ownership contract; authorization, registration and reach call-site behavior; transaction/lock, grant provenance, projection, audit and result-shape boundaries.
- **Verdict:** **CLEAR for source correctness and behavioral conservation by inspection; no blocking or non-blocking findings.** This report is one ordinary review of this exact composition. It does not accept the query-ownership slice or clear the candidate for merge.

## Review

The candidate has the stated accepted base as its merge base and the stated two source parents. `git merge-tree --write-tree c3932308 4ac8909c` produced tree `3527661da9b777a49f7c910544a4f2902bf983aa`, matching the candidate tree. The merge commit's changes against parent 1 are the workspace-admin repository extraction plus its associated current-main composition changes; retained #790 utility/repository conversions remain in the candidate. I found no dropped parent content or unaccounted manual conflict resolution in this composition.

I compared the extracted workspace-admin SQL against the original implementation. The repository functions retain the workspace/user keys, genuine built-in admin check, carrier lookup and insert, `FOR UPDATE` grant/person reads, deterministic person lock order, active-direct-only grant scope, reconciliation candidate predicate, and transaction executor for transaction-bound operations. The service still owns the orchestration: derive the target role from current membership, refuse custom carrier rows, preserve admin-created and external grants, project membership after a real state change, revoke creator-origin grants on promotion, and append the audit record in the same transaction. The existing person-before-audit order is preserved. No new grant source, implicit reach rule, or identity-provider authority path was introduced by extraction.

I traced the utility conversions across their callers and source queries. Moved query predicates and selected fields preserve relevant key ownership/enabled/expiry and owner-active checks, workspace scoping, project-live/task joins, invitation pending/expiry/email filters, assignability membership/admin locks, and denied-asset shadow evidence. The wrappers retain the allow/deny decisions and response behavior; repository functions return awaited/materialized rows. Invitation validity is still bounded by a caller-supplied `now`, and the public helper supplies a fresh `Date` at the same logical point as the original query helper. Registration, invitations and typed-domain SSO remain held; these moves do not activate them.

The query-ownership contract remains accurately scoped: moved statements are in named repositories or the explicitly bounded database infrastructure; transaction-bound calls receive the caller executor; the planned `check:queries` gate remains unwired and is not claimed as enforced. The `reachableWorkspacePredicate` helper remains a known shared fragment outside a repository, and the project-creator grant query remains outside this batch; both are residuals, not new composition defects. The repository/workspace-admin conversions do not establish PostgreSQL race behavior or production runtime acceptance.

The #764/#780 decision dependency in the carried documentation remains a prerequisite for acceptance: neither this source review nor the component reviews establish that either prerequisite is accepted on main. The reported ordinary and Sol reviews for the workspace-admin extraction cover that component SHA only; they do not transfer to this two-parent composition. No earlier #790 review is treated as completed evidence here.

## Checks and limitations

- `git status --short` — clean at review time.
- `git merge-tree --write-tree c3932308 4ac8909c` — result `3527661da9b777a49f7c910544a4f2902bf983aa`, equal to the candidate tree.
- Source comparisons — reviewed original and extracted workspace-admin implementation, registration helper, and modified utility call sites by inspection.
- I did not run tests or mutate repository/runtime state. No PostgreSQL integration, Docker/image boot/health, browser, exact-head hosted CI, or GitHub review/check query was performed in this context. Prior reports and component results remain bound to their respective SHAs.

**Not established:** accepted-main integration of #764/#780; two remaining fresh ordinary composition reviews; a fresh full independent Sol review on `ac330d31`; exact-head hosted checks; PostgreSQL, image/runtime or browser acceptance; or merge readiness. No gate waiver or acceptance claim is made.

---

Retained evidence file — 580-reach790-security-current-sol.md

# #580 / PR #790 composed head — independent full security review

- **Reviewed exact head:** `ac330d3165e74db5ee65ad6b322e93a28b94afde`
- **Comparison base:** accepted `main` source `e9df2294fa580fd2885343bbef0cec28e81ead4c` (`git diff base..head`, 32 paths, including 22 API source paths).
- **Parents:** retained PR #790 source `c3932308c88ba475bbabda202fff259bbc2117f0`; workspace-admin-reach extraction `4ac8909c680fb026648c334e2eab6e5783b9a9a8`.
- **Role and independence:** fresh independent full Sol-tier security reviewer, dispatched as GPT-6 Sol in a separate context with `fork_turns=none`. The runtime exposes no model-variant introspection to me, so GPT-6 Sol is the dispatch identity, not an independently measured runtime version. I did not author, direct, or remediate either parent or this merge, and I did not conduct ordinary reviews A/B/C.
- **Time:** 2026-10-15 21:40 UTC.
- **Verdict:** **CLEAR for security/source correctness on this exact head by inspection and focused offline tests. No blocking or non-blocking candidate security finding.** This is the required independent security review of this composition, not merge readiness, #580 completion, phase finalization, or runtime acceptance.

## Security assessment

I read the accepted repository authority/workflow and active mission, the D1–D4 query ownership contract, RBAC reach and provenance contract, the candidate source diff against accepted main, and both parent deltas. I also inspected the three independent ordinary composition reports as context; their conclusions did not substitute for my own review. The current-head diff against accepted main is the retained utility query extraction plus the workspace-admin reach extraction and supporting contract/tests. Changes to project settings, release, Compose, and deploy paths seen in a first-parent diff are already in the accepted comparison base; they are not new changes relative to `e9df2294..ac330d31`.

The utility repositories preserve the original predicates, joins, selected fields, limits, and result shapes for session/user facts, API key lookup, membership/role checks, registration and invitations, task/label/asset reach, and assignee eligibility. In particular, key lookup still requires the hash, `enabled = true`, and `expires_at IS NULL OR expires_at > now`; owner status still requires an existing, unbanned user with an active person. `verifyApiKey` still parses malformed permission JSON to an empty permission map and refuses inactive owners. No extracted lookup changes the caller's allow/deny branch or HTTP status. Asset loading still resolves identity and caller reach before row lookup, keeps the project join and reachable-workspace predicate, then applies project reach; its shadow-only denied-row lookup still requires a live project and is caught without changing the native masked 404. Invitation lookup still requires pending/unexpired status, lower-cased email matching, and the same caller-side validity/error handling.

For transaction-bound assignability, the repository receives the caller's executor; membership rows remain `FOR UPDATE` and global-admin user rows `FOR SHARE`. The optional executor falls back to the shared DB only where the original caller did. The workspace-admin repository also receives the same transaction handle for role resolution, genuine built-in admin verification, person and grant locks, carrier creation, and grant writes. The person lock remains before the active-direct-grant lock; the bulk person lock remains ordered by person ID. The boot candidate list remains a shared-DB read followed by one transaction per candidate. No extracted transaction query silently runs on a separate connection.

The reach service still derives owner/admin only from an unambiguous genuine legacy role, rejects a custom same-key carrier, and creates a system carrier with empty capabilities. It changes only direct `system_backfill` grants, with explicit workspace scope and `seesAll: true`; admin-made direct grants and external grants are not modified. Revocation still marks only the selected grant, and projection, creator-grant revocation on promotion, and hash-chained system audit remain in the caller's transaction and in the original order. A no-op sync still writes no audit event. Reconcile failures remain per-member and logged without aborting boot. I found no new route authority, identity-provider grant path, scope widening, or audit bypass in the extraction.

I checked the D1–D4 boundary: repositories return materialized rows through awaited async functions; the extracted functions do not pass builders to callers. `reachableWorkspacePredicate` remains a shared query-fragment helper outside the repository and the project-creator grant SQL remains outside this batch. These are known, explicit #580 residuals, not newly introduced authority changes. The structural `check:queries` gate is still unwired; this review does not claim whole-repository query ownership.

## Checks actually performed

- `git rev-parse HEAD` and `git show -s --format='%H %P' HEAD`: verified exact head and both parents; checkout clean before and after review.
- `git diff e9df2294..HEAD` plus first-parent and workspace-admin-parent source comparisons: reviewed actual changed code and the distinction between accepted-main and merge-parent deltas.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/utils/authorize-asset-access.test.ts ../../tests/api/utils/require-workspace-capability.test.ts ../../tests/api/database-executor.test.ts`: **3 files / 29 tests passed**, exit 0 on this exact checkout. These are offline/unit checks, not PostgreSQL behavior.
- `git diff --check e9df2294..HEAD`: reports trailing spaces and final blank line in the carried historical `docs/07-planning/security-reviews/764-query-ownership.md`; no product-source whitespace finding. This is recorded, not modified in this read-only review.
- Ordinary reviewer A separately recorded current-head API typecheck and Biome (25 changed TS/TSX files) passing. Those are attributed to A and not claimed as checks I reran.

## Residual and acceptance boundary

No PostgreSQL-backed integration or concurrency test, Docker build/boot/health, browser verification, or current-head hosted CI was run by me. The retained #790 remote PR was reported at old head `c3932308` in the ordinary evidence; this report does not assert that remote PR or hosted checks now target `ac330d31`. The #764/#780 decision-carrier acceptance prerequisite remains separate and unaccepted in the evidence provided. Previous component and old-head checks stay bound to their actual SHAs. The conductor must independently verify exact-head hosted gates, prerequisites, and runtime acceptance before any merge or completion claim; no gate is waived here.
