# #580 project creation query ownership

**Reviewed head:** `7990746b16c10962ef086d6f832bac126d45a1ca`

Base: `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5`. Two independent ordinary contexts and a fresh full GPT-6.1 Sol security context clear this bounded two-file extraction. The original dispatch selected GPT-6 Luna for author and both ordinary reviewers; ordinary A self-identifies generically as GPT-6 and its authentic wording is retained. Reports below are byte-preserved. The conductor wrote this wrapper and is not an independent reviewer.

Author verification: API typecheck five TypeScript projects and Biome two files passed; focused PostgreSQL passed five files / 62 tests. No image, hosted CI, merged-source, browser, integrated slice, whole #580 or stage acceptance is claimed. The separate creator/grant extraction and current notification candidate are not imported. Both existing transaction and error contracts remain unchanged. Current accepted-main composition and every protected gate remain required before merge.

## Retained report: project580-create-row-extraction-author-luna.md

# #580 project create row extraction — author evidence

- Author context: GPT-6 Luna
- Accepted base: `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5`
- Candidate commit / exact head: `7990746b16c10962ef086d6f832bac126d45a1ca`
- Branch: `codex/project-create-row-extraction-580`
- Worktree: `/Users/heinthura/.codex/worktrees/580-project-create-row-extraction/Ticketing.v2`
- Working tree: clean after commit

## Changed files

- `apps/api/src/project/controllers/create-project.ts`
- `apps/api/src/project/repository.ts` (new)

## Contract and behavior retained

Moved create-project query construction into named repository functions receiving `Executor` first and awaiting each statement before returning rows, booleans or scalars. The repository owns the customer-organisation `FOR SHARE` check, internal-workspace validation, advisory transaction lock `(1524, hashtext(workspaceId))`, permanent slug-claim lookup, max position query, project insert, permanent claim insert and default column inserts.

The controller retains the transaction boundary, error classes and mapping, `DEFAULT_PROJECT_COLUMNS`, validation/orchestration, `lockCreatorPerson` then max-position/project insert/slug claim/default columns/state seeding/creator grant ordering, and rollback behavior. The customer organisation binding still returns one generic invalid-organisation error. Exact unique-constraint handling for `project_slug_unique` and `project_slug_claim_pkey` remains in the controller. No new route, schema, capability, role, permission or dependency was added. `project-creator-grant.ts` and its repository/test were not changed; #785 helpers were not imported.

## Checks

- `pnpm install --frozen-lockfile` — completed; the fresh worktree had no installed dependencies.
- `pnpm --filter @taskdesk/api^... build` — passed for 4 workspace projects (including email, permissions and domain dependencies).
- `pnpm exec biome check apps/api/src/project/controllers/create-project.ts apps/api/src/project/repository.ts` — passed, 2 files.
- `pnpm --filter @taskdesk/api typecheck` — passed all 5 TypeScript projects in the API script.
- `git diff --check` — passed before commit.
- No directly scoped unit test exists for project creation. Relevant project creation/binding/claim coverage is in `tests/api-integration/`; no PostgreSQL or Docker work was run, pending the orchestrator's isolated PG window and explicit authorization.

No credentials or database connection details are included in this report.

## Retained report: project580-create-row-pg-verification-luna.md

# #580 project create row extraction — focused PostgreSQL verification

- Candidate exact SHA: `7990746b16c10962ef086d6f832bac126d45a1ca`
- Accepted base: `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5`
- Author evidence: `project580-create-row-extraction-author-luna.md`
- PostgreSQL: `postgres:18-alpine`, image `sha256:d7a8005067f55a2f8ea369e767545fd467b1943a4f0f1a48b7dc44f06c366109` (PG 18.6)
- Test runner exit code: `0`; vitest exit code: `0`
- Result: 5 test files passed; 62 tests passed; duration 28.36 seconds
- Full private test log: `project580-create-row-pg-verification-luna.log` (mode 0600)

## Executed files and relevant assertions

- `tests/api-integration/project-slug-claim-permanence.test.ts` — permanent claim survives rename and workspace deletion; different burned work-item numbers cannot later detonate; rename-back to the same project's claimed slug remains allowed; a concurrent permanent claim is rejected.
- `tests/api-integration/project-slug-unique.test.ts` — globally duplicate project slug returns a clean 409; a different slug succeeds; update collisions are rejected.
- `tests/api-integration/project-organisation-binding.test.ts` — active customer binding, invalid workspace fail-closed behavior, internal creation, concurrent organisation deactivation serialized against create by `FOR SHARE`, and non-rebinding.
- `tests/api-integration/project-creator-lead.test.ts` — creator project membership, created_by, audit and reach behavior; creator without a staff person; role authority and grant behavior.
- `tests/api-integration/project-reorder.test.ts` — includes “places a newly created project at the end of the order” and ordering validation/behavior.

## Isolation and cleanup

- Dedicated container name: `codex-p580-f48078cb1cd5`
- Exact owned container ID: `479bec7571575e2b30e7d7d5c491176673d78e3606b7b16aac43a9f46f04c0cc`
- Ownership label: `com.codex.task=project580-row-extraction-f48078cb1cd5`; checked before integration fixture/reset and again before cleanup.
- Port binding: loopback-only dynamically allocated host port. PostgreSQL data directory was mounted on tmpfs; no persistent volume was used.
- Test database: unique `taskdesk_project580_f48078cb1cd5_test`.
- Container cleanup exit code: `0`; owned container was removed after validating its exact ownership label. Both private credential environment files were removed and the credential variables were unset.
- Container inventory: 23 IDs before creation and the same 23 IDs after cleanup; the owned ID above is absent after cleanup, and there are no surviving `com.codex.task` containers.

The exact 23-container before inventory, identical after cleanup:

```text
16d94503d52329e15feff49c6811d0d6a6309994b635c8cbae62aa8495b046a1
171df3d21b768cd2ffdbd7b0170d1c46fe69a38d78dafadefd2233ca89b0a7fa
1ad052ac4246517ee99c7006589fe7786d0606b7992caa520fc3fb37075b7fe7
1debff9ac4967b2e2f7c3549bad79aec0686c2d8e03b6b05eeaf7fe4dcf3a326
2a95b75764a3bef844c396ddf9e49a98c6d2c674941d68397942b150ce76f9da
2f24b28fe1f9ca13e7c9c5bb3823eadff83e492d2f5fc96ebe18df4ef8d0f27b
3282921b9a23f3613f0d6fbb289b1df90fcd3498a5e742e67551e40530b8b011
3e4cf0bf9050500aa2e775cd838467091dfe130daee4cc3ce3457082c84b45eb
3fcadbc00791189c8b28b88a60add48a5090b58ed9300a3584d50ade69afa57e
56228daa5382cc951477e45d1535aea4ddc60e11d24c7575c4ff672c6a88e220
67ae4e5bf1e4f9782dcc6b9f22d63904c38a6d8c3d71003bdbaaf7eed37386bc
68b2bf8fdffcf5d2bf23552c2699439ca39215711b9ff1c433a2dad69abcf1dc
6902e2eb154ee061880c7ba61260a096a1b0a5555998b9006a4d92b074e1d929
91245e6ffa822ff46458376e396b69662f5a275f7c970453a845fd436e0790d0
a5710b064a32dc5f1fac870c38ed337814eaf26f764b690d818be1511c26b83d
af5526b53e12e086ab6f40d7f344ae4f5986d9153837bc80586bed449aafe988
bd512b3833b7fb88c2ab4582e17d55141055ff7834444ffc8da0c737f13bb05f
cc9c933748c3182018bd1935ff9f160dbd598de0bad5149db7ef62b743d61620
d7c315ac4833a2a11ae30798f55b03cf90f4bdcdf904d0a0b13ab05603a08b92
e87cb6ef30bea8bbb471bd442d64cd1d8322565681be65bc1203f643f74028a1
e927355e677635cfb6a9aae6a08e231071f01596739f8e78fee2a72681b0d466
f49f33f7acbecc6ba5d9f1431e85f92882f0d6dd6d16e4818613d6e22bd7cadb
fdd3b406c35fa0aa8130edfc48cd5cbbb6212bbf95424708a754c4fa11e57035
```

No credentials are included in this report or its log.

## Retained report: project580-create-row-ordinary-a-luna.md

# Independent ordinary review — project create repository extraction

- **Verdict:** CLEAR
- **Role:** Fresh independent ordinary reviewer (A)
- **Model:** GPT-6, as reported for this context
- **Candidate:** `7990746b16c10962ef086d6f832bac126d45a1ca`
- **Base:** `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5`
- **Independence:** I did not author, direct, or remediate this candidate.
- **Scope:** Exact two-file diff (`apps/api/src/project/controllers/create-project.ts`, new `apps/api/src/project/repository.ts`), create route call site and caught errors, all direct callers/references, `Executor` contract, D1–D4 query-ownership decision and coding standard, project and tenancy contracts, creator grant helper, ordering/reorder lock usage, and accepted-base comparison.

## Checks performed

- Confirmed worktree HEAD equals the exact candidate SHA and diff contains only the two listed files.
- Read repository `AGENTS.md`, `CLAUDE.md`, `docs/04-engineering/agent-workflow.md`, `docs/04-engineering/coding-standards.md` (query ownership D1–D4), `docs/01-architecture/multi-tenancy.md`, `docs/03-features/projects-and-engagements.md`, and current active mission.
- Read the full candidate diff, accepted-base implementation, project route call site, `Executor` definition, creator-grant documentation/call, and ordering/reorder lock usages.
- Ran `git diff --check <base>...<candidate>`: passed.
- No tests, database, Docker, browser, or build commands were run, per assignment.

## Findings

No blocking or non-blocking candidate findings.

The extraction follows D1–D4 for the changed create-row statements: the service still owns the outer transaction, and each moved SQL/Drizzle statement is invoked through a repository function with the transaction `Executor` as its first argument. Repository functions await statements and return materialized rows/scalars/booleans (or `void` after awaiting); no query builder escapes. The raw advisory-lock SQL is also repository-owned. `createProjectRow` preserves its transaction boundary and invokes the creator grant and state seeding within that same transaction.

Compared with the accepted base, the organization validation retains the active, customer, non-deleted predicates and `FOR SHARE` lock; the workspace must still belong to an internal organization. The helper returns only this minimal authorization fact. It does not read or return customer content under an unresolved actor identity, and does not purport to satisfy the separate resolved-identity contract for content reads.

The ordering lock remains namespace/key-identical (`1524`, `hashtext(workspaceId)`) to the reorder path. The permanent slug claim precheck, project insert, claim-table primary-key race arbiter, named live-project unique violation, and conversion to the same 409 error are preserved. Position still derives from the workspace maximum with empty-workspace default `0`. Project creation, default columns, seeded states, and creator membership grant remain in the same transaction; creator person locking and lead grant/audit ordering are unchanged. An exception during any of those writes still rolls back the transaction. Route success shape and the 422/409 mappings are unchanged.

No accepted source or security semantics were dropped, and no new scope or public API change appears in the two-file diff. The remaining direct query construction in the separate reorder controller and other pre-existing callers is outside this candidate's diff and does not negate the create-row extraction reviewed here.

## Review commands

```text
git rev-parse HEAD
git diff --stat 3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5...7990746b16c10962ef086d6f832bac126d45a1ca
git diff --name-status 3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5...7990746b16c10962ef086d6f832bac126d45a1ca
git diff --check 3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5...7990746b16c10962ef086d6f832bac126d45a1ca
```

## Retained report: project580-create-row-ordinary-b-luna.md

# Ordinary review B — #580 project create-row extraction

**Model:** GPT-6 Luna (actual selected platform model)
**Reviewed head:** `7990746b16c10962ef086d6f832bac126d45a1ca`
**Comparison base:** `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5`
**Independence:** Fresh review context; did not author, direct, or remediate this candidate.
**Scope:** Exact two-file diff in `apps/api/src/project/controllers/create-project.ts` and new `apps/api/src/project/repository.ts`. Focused on executor/transaction behavior, customer organisation binding, ordering-lock compatibility, slug claim/error behavior, insert/seed/grant/audit atomicity, and repository query ownership/scoping contracts.

## Checks performed

- Confirmed checkout HEAD equals reviewed head; `git diff --name-only` reports exactly the two scoped files.
- Read `AGENTS.md`, required workflow/model and review rules, active mission, coding standards/query ownership, project feature spec, relevant data-model and RBAC contracts.
- Compared the complete diff against the exact base and inspected the repository executor contract, `reorderProjects`, `project-creator-grant.ts`, and existing project creator and permanent-slug-claim integration tests.
- Static review only. No tests, PostgreSQL, Docker, browser, source edits, ref changes, pushes, PRs, or merges were performed. Existing tests were inspected but not run; no test result is claimed.

## Findings

No blocking or non-blocking findings in the reviewed delta.

The new repository functions take `Executor` first, await each statement, and return a boolean/scalar/row/void result rather than a query builder. `createProjectRow` still owns the outer transaction and passes its handle to every extracted statement and to the existing state-seed and creator-grant helpers. The order is preserved: optional customer organisation is checked and share-locked; workspace ordering lock namespace/key remains `(1524, hashtext(workspaceId))`, matching `reorderProjects`; permanent claim is checked; creator person is locked; position is read; project and permanent slug claim are inserted; default columns and states are seeded; creator grant and audit are written. All remain in one transaction, so later failures roll back the project and claim. Both slug unique constraint names still reach the same `ProjectSlugTakenError`/409 mapping. Position still considers every project row in the workspace as before.

`isServableCustomerOrganisation` retains the active/non-internal/not-deleted customer predicate and `FOR SHARE`, then verifies the workspace is owned by an internal organisation. This is a create-time validation of request-selected resource facts, not a content query whose cross-organisation rows should be filtered by resolved caller identity; route permission remains outside this repository helper. No tenancy boundary or identity-derived authority was changed by this extraction.

## Verdict

**CLEAR** for the exact reviewed delta, within ordinary-review scope. This is a static/code inspection verdict only and does not substitute for the candidate's required test and other review gates.

## Retained report: project580-create-row-full-security-61-sol.md

# Full independent security review — #580 project create-row extraction

**Model:** GPT-6.1 Sol
**Role/context:** Fresh independent full security reviewer, `/root/project580_create_row_full_security_sol`.
**Reviewed head:** 7990746b16c10962ef086d6f832bac126d45a1ca
**Comparison base:** 3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5
**Independence:** I did not author, direct, advise, remediate, or perform an ordinary review of this candidate. This verdict follows my own source inspection, not adoption of the ordinary verdicts.
**Verdict:** CLEAR — no blocking or non-blocking security findings in this exact two-file delta.

## Scope and checks actually performed

Read repository AGENTS.md, active mission, workflow/review rules, CLAUDE.md, coding standards including D1–D4, relevant project and multi-tenancy contracts, and the decision-log entries for query ownership, customer binding and creator grants. Inspected the complete candidate diff and current create controller/repository, Executor definition, create route and its permission/error flow, schema constraints, reorder lock, creator-person/grant/audit helper, state-seeding helper, and exact unique-violation handling. Searched apps, tests and packages for direct callers and references. Only create-project.ts imports this new repository; production createProjectCtrl invocation is the project route; a creator-lead integration test also invokes the controller directly. Seed and fixture consumers of DEFAULT_PROJECT_COLUMNS retain the same exported constant.

Confirmed checkout HEAD equals the reviewed SHA, the diff contains exactly create-project.ts and new project/repository.ts, working tree is clean, and git diff --check against the exact base passes. No source or refs changed. No tests, PostgreSQL, Docker, browser, image build, full suite, push, PR or merge was run by this reviewer.

## Security analysis

The service retains ownership of db.transaction. Every extracted statement receives the actual tx as first Executor argument, never resolves a default/global database connection, and never starts or finishes a transaction. Helpers await execution and return only materialized boolean/scalar/row/void results; no composable builder escapes. Broad Executor typing does not silently move these actual callers outside the transaction.

Customer binding remains conditional on a non-null organisationId. The repository checks the same selected organisation id, active=true, isInternal=false and deletedAt IS NULL, with FOR SHARE held until the surrounding transaction finishes. The workspace-owner join still requires an internal organisation. A failed check now returns false and the controller throws the same generic InvalidProjectOrganisationError, preserving indistinguishable 422 outcomes. The route still checks workspace access and create permission, applies the stricter capability check before any customer lookup, validates managed-service/calendar configuration, and supplies the authenticated user id. This helper yields a minimal create-time authorization fact about request-selected resources, not customer content. It does not expose organisation rows or replace the resolved-identity/reach requirement for content-reading repositories. The insert receives the same explicitly constructed fields from the service; no request object is spread into the broader inferInsert parameter.

Ordering retains advisory transaction lock (1524, hashtext(workspaceId)), identical to reorder, before max-position and writes. The organisation check, ordering lock, permanent claim check, creator-person lock, maximum calculation, insert, claim, columns, states and creator grant remain in their original sequence. No new lock inversion or unlocked ordering read is introduced. Maximum still includes every project row in the workspace, with null mapped to first position zero.

Permanent slug uniqueness remains global by design, rather than workspace-filtered. The precheck is still advisory; project_slug_unique and project_slug_claim_pkey remain the exact race arbiters mapped to ProjectSlugTakenError and the same generic 409. Await boundaries do not add commits or change which exceptions reach the existing catch. Permanent claims are inserted in the project transaction and are never released by these helpers.

Default columns and state seeding still use the created project id and same transaction. lockCreatorPerson still precedes creator authority writes; created_by uses only the locked staff person or null. Existing sees_all handling, project-lead validation, grant projection and audit append remain untouched and inside the transaction. Any later failure propagates and rolls back project, claim, columns, states, membership and audit together. The extraction creates no capability, trust boundary, route, schema, dependency or additional authority.

## Evidence attribution and limits

Read both ordinary reports: A and B record CLEAR for the same SHA/base. A self-labels GPT-6; the conductor states its original dispatch explicitly selected GPT-6 Luna. I do not relabel that report or independently attest its dispatch metadata.

Read author evidence reporting Biome success for two files and API typecheck success across five TypeScript projects. Read the separate focused PostgreSQL verification report and inspected its private log ending: five files / 62 tests passed, 28.36 seconds. Those runs belong to the author/verification context, not this reviewer. Inspected relevant assertions, including the real concurrent deactivation lock wait followed by 422/no project, global/permanent slug rejection, creator-grant/audit behavior and appended ordering. These tests provide focused regression evidence; they are not a new reviewer-run rollback-fault proof or full runtime acceptance.

The new repository exports are internal APIs whose security still depends on authorized callers passing the correct workspace, creator and transaction. The current sole production path does so. This review clears only the bounded partial #580 extraction; it does not close #580, claim full query-location compliance elsewhere, complete a feature/stage, or establish image, browser or SIT acceptance. Remaining required CI, deployment and acceptance gates belong to the conductor.

