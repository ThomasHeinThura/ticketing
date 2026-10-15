# PR #764 — query ownership batch 0 review record

**Reviewed head:** 9d7e9a50364f503ceb96b939fa8a23b2c6b6a42d

The source/contract review is clear at the head above. This is a partial #580 contract and executor slice; the structural checker remains planned and unwired. The #780 decision-log entry is retained in unaccepted carrier #791 and must be composed into accepted main before #764 acceptance. No current-main composition, required-check completion, image/runtime proof or merge is claimed by this record.

The following reports are published unchanged, including adverse findings and superseded verdicts. Historical Claude reports retain their original identity and reviewed SHA. GPT reports distinguish explicit platform dispatch from unavailable runtime model introspection. Additive note publication is not a new product review.

## Authentic report — 764-ordinary-c-sonnet.md

Origin SHA-256: `c225962126c78233cef80e91f3a93553ea021808689a5761dd794343cac38254`.

# PR #764 ordinary review C (#580 batch 0: Executor contract + coding-standards D1-D4)

**Reviewed head:** 39fd2f9ef86e9f1a0f4156d139b9a22eeed7e239
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Diff (4 files, +165): `apps/api/src/database/executor.ts`, `docs/04-engineering/coding-standards.md` (new "Query ownership (issue #580)" section), `tests/api/database-executor.test.ts`, `tests/api-integration/database-executor.test.ts`. No existing code is migrated; `check:queries` is not enabled by this PR.

## Commands

| Check | Result |
| --- | --- |
| install, `pnpm turbo typecheck` | exit 0, 9/9 tasks |
| `vitest run --config vitest.config.ts ../../tests/api/database-executor.test.ts` | 1 file, 4 tests passed |
| `CI=true vitest run --config vitest.integration.config.ts ../../tests/api-integration/database-executor.test.ts` (Testcontainers) | 1 file, 2 tests passed |
| `tsc --noEmit -p apps/api/tsconfig.tests.json` (covers `tests/api` and `tests/api-integration`) | clean |
| `biome ci` on the 3 code files | clean |
| Mutation: `executorOrDefault` returns `db` ignoring the handle | killed by unit test (handle identity) and by the integration test (in-tx write became visible outside the transaction) |
| Mutation: `Executor = DatabaseInstance` only | killed by `tsc` on the integration test (`PgTransaction` lacks `$client`), so the type assertions are non-vacuous |

## Type soundness

- `Transaction = Parameters<Parameters<DatabaseInstance["transaction"]>[0]>[0]` resolves to drizzle's `PgTransaction<NodePgQueryResultHKT, schema, ...>`; the typecheck proves a real `db.transaction` callback `tx` is assignable to `Executor` (the integration test passes `tx` to functions typed `Executor`). `DatabaseInstance` carries `$client`, a transaction does not, which is why a union (not a single type) is required; the union is correct and both arms expose select/insert/update/delete/execute.
- `db` is a Proxy cast to `DatabaseInstance` (database/index.ts); `executorOrDefault()` returns that same proxy, and the unit test pins `toBe(db)`.
- The runtime `expectTypeOf` calls are no-ops under vitest; their value comes from the `tsconfig.tests.json` typecheck, which does include both test directories (verified, and shown non-vacuous by the mutation above).

## Tx propagation proof

The integration test inserts and counts through an `Executor` parameter: inside a transaction the write is visible to the handle and invisible to the shared connection, and a thrown error rolls it back; a committed transaction write is visible afterwards. Replacing the resolver with `db` fails it, so propagation is genuinely proven rather than assumed. It writes to `cannedResponseTable`, which is a stand-in table, acceptable for a contract test.

## Doc vs docs/01-architecture/monorepo-layout.md

- D3 locations `**/repository.ts`, `apps/api/src/database/**` match the layout (feature `repository.ts` is "the ONLY place" for a feature's tables; `database/` is the persistence layer).
- D1 (statements inside `db.transaction` go through repositories with the handle), D2 (raw sql/execute in scope), D4 (`apps/api/scripts/**` out of scope) are consistent with and do not weaken the layout contract or ci-cd.md's "no db.select() outside repo".

## Findings

Blocking: none.

Non-blocking:
- N1. D3 adds `**/repository/**` (directory form) which monorepo-layout.md line 149 and coding-standards.md line 120 ("outside `*/repository.ts`") do not name. It is a small widening; monorepo-layout.md should be reconciled in the PR that enables `check:queries`, or the directory form dropped until needed.
- N2. `executor.ts` doc says the executor is the FIRST parameter, while the same comment and test also allow `executor?: Executor` as the LAST parameter (the integration test uses the trailing-optional form). The coding-standards text says first parameter only. Pick one convention before batches migrate hundreds of functions.
- N3. The doc claims `Repositories never open a transaction on a handle they were given`; `Executor` includes `transaction`, so nothing in the type enforces it (the future gate must). Acceptable for a convention PR.

## Residual risk

Convention only; no gate yet, so adherence by later batches is unverified here. Security-scope path list not evaluated (no auth, migration or CI machinery files touched); the author PR body lists a security review as pending, which is for the process owner.

**Verdict:** APPROVE

---

## Delta review: 39fd2f9e to c4477744

**Reviewed head:** c447774494cc88d9787d6f11f835b59d01c57eed
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed with `gh pr view 764`. Delta: one file, `docs/04-engineering/coding-standards.md` (+34/-13); no code or test change, so my earlier code results (typecheck, executor unit and integration tests, mutations) are unaffected.

- D3 narrowed: the `apps/api/src/database/**` wildcard is replaced by two enumerations. (1) repositories by name (`**/repository.ts`, `**/*.repository.ts`, `**/repository/**`), with `database/repositories/notification-delivery.repository.ts` given as the example; (2) an explicit list of 14 persistence-infrastructure files. I listed `apps/api/src/database/` at this head: it holds exactly 14 non-repository files (append-only-tables, assert-application-role-is-not-privileged, assert-no-migration-url-in-api-process, ensure-application-role, executor, index, migrate-membership-provenance, migration-schema, prepare-database-startup, relations, resolve-database-url, schema, scram-sha-256, wait-for-database) and the single `repositories/notification-delivery.repository.ts`. The doc's list matches the directory one for one, and it states that a new file under `database/` must be named a repository or added to the list in a reviewed change. A grep for statement-building calls under `database/` finds only files on the list or the named repository, so nothing that queries today is left uncovered. This is tighter than before and no longer loosens the layout contract.
- Contradictory "lint error" sentence: replaced by a statement of the rule pointing to the Query ownership section and to `check:queries` (#580) as the gate; the `scripts/ci/check-queries.mjs` gate is still not on this base, so "the gate that enforces it" correctly refers to the future gate.
- Executor wording: now "first parameter for a function that always runs inside a caller's transaction; trailing `executor?: Executor` plus `executorOrDefault` for a function callable inside and outside; direct shared connection if it never joins". This matches how the batch 0 integration test is written (trailing optional form) and resolves my earlier N2 in the doc. It does not match the header comment in `apps/api/src/database/executor.ts`, which still says the executor is the FIRST parameter for every function that can take part in a transaction (N1 below).
- Tenant scoping / `forIdentity`: the doc states the convention (tenant ids explicit in the predicate) and says it "satisfies `forIdentity`". multi-tenancy.md and monorepo-layout.md still describe `forIdentity(identity)` as an API; the doc asserts equivalence without amending those documents (N2).

Non-blocking:
- N1. Align the `executor.ts` header comment with the new doc wording (first parameter vs optional trailing parameter), or the two statements of the convention will drift.
- N2. Either amend monorepo-layout.md line 150 and multi-tenancy.md to say explicit tenant parameters satisfy `forIdentity`, or soften "satisfies" to "is the interim convention"; it is a design position on tenancy and is stated only in the coding-standards file.
- N3. `**/*.repository.ts` is a pattern not named in monorepo-layout.md; fine, but the layout doc should mention it when the gate lands.

**Verdict:** APPROVE

## Authentic report — 764-ordinary-d-sonnet.md

Origin SHA-256: `0321ec19f41d558f89b2106b6ba1ae52c55f4c35ec6a27f47135af4d1dfec2b2`.

# #764 ordinary review D (architecture / contracts / consistency)

**Reviewed head:** 39fd2f9ef86e9f1a0f4156d139b9a22eeed7e239
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** origin/main d159704be626136e728df7ddef0381dc37cf7756 (read-only scratch worktree at the exact head)

Scope: #580 batch 0. New `apps/api/src/database/executor.ts` (`Transaction`, `Executor`, `executorOrDefault`), a "Query ownership" section in `docs/04-engineering/coding-standards.md` (decisions D1-D4), unit and integration tests. No production caller uses it yet.

## Commands run
- `pnpm install --frozen-lockfile --prefer-offline` ok; `pnpm turbo typecheck` 9/9 successful.
- `vitest run tests/api/database-executor.test.ts` (unit config): 1 file, 4 tests passed.
- `vitest run --config vitest.integration.config.ts tests/api-integration/database-executor.test.ts` against my own throwaway `postgres:18-alpine` container (removed by exact id afterwards): 1 file, 2 tests passed (write on tx invisible outside it and rolled back on throw; committed tx write visible).
- `biome check` on `apps/api/src/database` and both new test files: 17 files, clean.

## Consistency with the architecture docs
- monorepo-layout.md (line ~149) says `repository.ts` is "the ONLY place db.select()/insert()/update() on this feature's tables may appear", exposes `forIdentity(identity)` scoped queries, "Enforced by check:queries". multi-tenancy.md lines 50-58 repeat the `forIdentity` shape. Neither the code (`grep forIdentity apps/api/src` = 0 hits) nor this PR implements `forIdentity`; the new standards section does not mention it, so there is now a three-way gap: layout/multi-tenancy docs (aspirational scoped repositories), the pre-existing coding-standards sentence ("`db.select()` outside `*/repository.ts` is a lint error": no such lint exists in biome.json and `check:queries` is not defined in package.json), and the new section. The new section is the most honest of the three, but it leaves the stale sentence right above it contradicting the allowed locations (it says only `*/repository.ts`; the new bullet also allows `**/repository/**` and `database/**`).
- Per-feature ownership vs global: the layout says a feature's repository owns that feature's tables. D1-D4 as written allow ANY `repository.ts` to query ANY table (cross-feature joins are already normal, e.g. search joins task/project/user/workspace). That is realistic, but it should be a stated decision (tables-per-repository is not what the gate will check), otherwise the layout sentence remains false.

## Would the final `check:queries` gate be honest?
Mostly yes: "structural rule, no per-site allowlist or baseline", transactions stay orchestration, results must be awaited rows. Current reality for context: about 52 non-repository files still call `db`/`tx` statements (work-item 17, task 15, workspace 10, label 8, ...) and ~239 non-repository files import drizzle. So the gate cannot be turned on until the batches land, and any interim "baseline" would be the hidden allowlist the section forbids. That is a sequencing risk the batch plan must keep honest, not a defect in this PR.

## Findings
1. NON-BLOCKING (D3 breadth): `apps/api/src/database/**` as a blanket allowance is wider than its stated purpose ("schema, migration runner, role bootstrap"). It exempts every future file dropped under `database/`, including feature queries. Evidence it is already porous: `apps/api/src/database/repositories/notification-delivery.repository.ts` is a notification feature repository sitting under `database/` with a `*.repository.ts` name that matches neither `**/repository.ts` nor `**/repository/**`. Recommend the eventual gate (and the doc) enumerate: `**/repository.ts`, `**/repository/**`, and `database/` limited to a named set (schema, relations, migration-*, migrate-*, ensure-*, append-only-tables, prepare/wait/resolve startup files) or forbid feature-table statements in `database/` except an explicit `database/bootstrap/` subdir; and move `notification-delivery.repository.ts` to `notification/repository.ts` (or accept a `*.repository.ts` pattern explicitly). Also 4 `apps/api/src/utils/migrate-*.ts` files exist; the doc says they "move into database/", fine, but that is the same blanket exemption again, so the narrower enumeration matters.
2. NON-BLOCKING: `forIdentity`/scoped-repository requirement of multi-tenancy.md is neither delivered nor explicitly deferred. Add one line to the section ("scoped constructors are a separate decision; this contract governs only where statements live") or update monorepo-layout.md, so reviewers of later batches do not assume tenant scoping is part of the repository contract.
3. NON-BLOCKING: `utils/repository.ts` already defines its own ad-hoc `type SelectExecutor = Pick<typeof db, "select">` and returns un-awaited builders, which the new "Results" rule forbids; later batches should converge it on `Executor`. Not this PR's job, but note it in the batch plan.
4. NON-BLOCKING: the unit test `expectTypeOf(...)` assertions are only enforced when the test file is type-checked; confirm `tests/api` is covered by a tsconfig in `pnpm turbo typecheck` (it passed, but I did not prove those files are in its program).
5. INFO (design): `Executor = DatabaseInstance | Transaction` is a union of call surfaces; both expose select/insert/update/delete/execute per the type test. `executorOrDefault` importing the singleton `db` couples the contract file to the module that creates the connection; acceptable.

## Residual risk
Docs-and-types only; no behaviour change. The open risk is policy drift: D3 is the part a gate author will copy verbatim.

**Verdict:** APPROVE

## Authentic report — takeover/764-contract-delta-luna.md

Origin SHA-256: `863e9be8d106ba7442c1a46bfb4a740aedf09b20449258a78d5c48dfbd369407`.

# #764 query ownership contract — independent ordinary delta review

**Verdict: APPROVE current delta; no blocking findings.** The c32ab85f delta resolves the retained ordinary-review concerns about D3's overly broad database allowance, executor parameter wording, and the `forIdentity` documentation gap. D3 is now bounded to repository-name patterns plus an enumerated list of infrastructure files. This approval covers the source contract at the reviewed head; it does not claim `check:queries` is implemented or enabled.

**Reviewed head:** `c32ab85f36316a84d3ff352192f7a7f80fafbdf3`  
**Comparison base:** `c447774494cc88d9787d6f11f835b59d01c57eed`  
**Pull request base:** `d159704be626136e728df7ddef0381dc37cf7756`  
**Model/context:** GPT-6 Luna, explicitly dispatched, fork none; runtime model introspection unavailable. Fresh context, independent of authors and prior reviewers.  
**Evidence source:** immutable Git objects in `/Users/heinthura/.codex/worktrees/carrier1/Ticketing.v2`; PR metadata read from GitHub. Primary checkout was not used or changed.

## Scope and commands

The reviewed delta is three files: `apps/api/src/database/executor.ts`, `docs/01-architecture/monorepo-layout.md`, and `docs/01-architecture/multi-tenancy.md` (21 insertions, 12 deletions). The accumulated PR source also includes the original executor and its unit/integration tests, plus the coding-standards contract reviewed in the authentic reports at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/764-ordinary-{c,d}-sonnet.md`.

Read-only commands/checks performed:

- `git show` and `git diff c4477744 c32ab85f` for the exact delta and contract files.
- `gh pr view 764 --json title,body,headRefOid,baseRefOid,url` to check the live PR head/body.
- Read both preserved original ordinary reports, the current coding standards, decision-log entry, and relevant architecture docs.
- Inspected the recovered `q580-b10` worktree diff and the five moved query-bearing files for authority reconciliation.

No tests, builds, or mutation checks were run in this delta pass. The earlier code/type/unit/PostgreSQL integration/negative-control evidence remains bound to the earlier source and is preserved in the authentic C and D reports; this delta changes no executor behavior or tests. No model runtime introspection was available.

## Delta findings

- **C-N1 / D3 breadth: closed.** Coding standards at c32 enumerates 14 infrastructure files under `apps/api/src/database/`, with no wildcard over that directory, while preserving the repository patterns `**/repository.ts`, `**/*.repository.ts`, and `**/repository/**`. It explicitly requires a new database file to be named as a repository or added to the list by reviewed change. The current `database/` inventory is one feature repository (`repositories/notification-delivery.repository.ts`) plus those 14 listed infrastructure files; the report at c447 had found this exact inventory and no unlisted query-builder file there. This does not create a broad unsafe query exception.
- **C-N2 / executor convention: closed.** The `executor.ts` header now matches coding standards: always-transaction functions take required first `executor`; dual-mode functions take optional last `executor` and resolve with `executorOrDefault`; functions that never join a transaction may use the shared connection. The shared handle is retained, with no builders or transaction ownership delegated to repositories.
- **D-N2 / tenant documentation: closed.** `monorepo-layout.md` and `multi-tenancy.md` now both state explicit tenant arguments in predicates. `multi-tenancy.md` expressly says this replaces the earlier `forIdentity` wrapper shape, cites the conductor decision, and does not introduce a wrapper type. This is consistent with the recorded #580 decision. The decision still relies on repository authors putting the required tenant in each predicate; this contract does not itself enforce predicate semantics.
- **D-N3 / repository naming: closed for the recorded pattern.** Coding standards recognize the `*.repository.ts` filename now used by `database/repositories/notification-delivery.repository.ts`.
- **D1–D4: preserved.** D1 keeps transaction opening as orchestration while routing every statement through a repository with the handle; D2 includes raw `execute`/`sql` and keeps fragment helpers in repositories; D3 uses the exact bounded locations above; D4 excludes `apps/api/scripts/**`. The coding standard and decision log agree. The PR does not add query builders outside repositories, weaken tenant predicates, or enable the final checker.

## PR-body correction required

The live PR body is stale at D3. It still says allowed locations include `apps/api/src/database/**` “as a structural rule with no per-site allowlist or baseline.” That claim is false at the current source head and conflicts with the decision log. Before the PR is treated as review-ready/published, replace that D3 bullet with the actual rule, for example:

> D3: allowed locations are repository modules named `repository.ts`, `*.repository.ts` or under `repository/**`, plus the 14 explicitly named persistence-infrastructure files under `apps/api/src/database/` in `coding-standards.md`. There is no database-directory wildcard, per-site allowlist or baseline.

This is a factual PR-description correction only; no source edit was made. Other current PR-body fields still describe original Claude implementation/review/security metadata and the pre-review pending state; reconcile those through the conductor's normal authentic review-record accounting rather than treating this report as permission to rewrite historical reports.

## Recovered batch 10 authority reconciliation (data only)

The dirty `/Users/heinthura/.codex/worktrees/q580-b10/Ticketing.v2` source has five query-bearing startup/migration files moved into `apps/api/src/database/`:

- `migrate-apikey-reference-id.ts`
- `migrate-notification-preferences-schema.ts`
- `migrate-session-column.ts`
- `migrate-workspace-user-email.ts`
- `backfill-workspace-project-defaults.ts`

At c32, none is in the explicit 14-file D3 list. The four `migrate-*.ts` files remain startup SQL; the diff changes imports/path only, not query construction. `backfill-workspace-project-defaults.ts` also retains direct Drizzle statements; its diff changes path/imports and references to seed modules, not conversion of those statements into a repository. Therefore these are path moves, not genuine query-to-repository conversions, and D3 does not currently authorize them. Batch 10 must not rely on the directory move as an implicit allowlist expansion: it needs a separately reviewed explicit-list decision/change (or a repository-form placement) before those query sites fit the contract.

Separate from those five moves, batch 10's `seed-defaults.repository.ts` is a genuine query-location conversion for the seed routines: query statements were extracted from seed utility modules into a file matching `*.repository.ts`; the seed callers now invoke those repository functions. This does not authorize the five moved startup files by analogy. No batch 10 source was edited or tested in this review.

## Limits

This is an ordinary contract delta review, not the required GPT-6 Sol security review, finalizer, or a new rerun of the original code review. It does not establish hosted checks, current test results, checker implementation, PR-body correction, or batch 10 acceptance. Exact source head reviewed: `c32ab85f36316a84d3ff352192f7a7f80fafbdf3`.

## Authentic report — takeover/764-security-sol.md

Origin SHA-256: `79773467cc9c8c7dd8b621f3184995cb4bb8c326f1b160444694bffefc7207c3`.

# PR #764 / #580 batch 0 — independent security review

**Verdict: BLOCKED on one security-contract documentation inconsistency.** The executor and D1–D4 source contract have no demonstrated new runtime authority defect at this head, but the candidate changes the tenant-scoping model while the canonical security model still promises a compile-time `ScopedQuery` guarantee that the new contract expressly does not provide. Reconcile that claim before treating the contract as accepted. The PR-body D3 correction is separately required before publication/acceptance.

**Reviewed exact head:** `c32ab85f36316a84d3ff352192f7a7f80fafbdf3`  
**PR comparison base:** `d159704be626136e728df7ddef0381dc37cf7756`  
**Role/model provenance:** fresh independent full security review, dispatched as GPT-6 Sol with `fork_turns=none`; platform runtime model/version introspection was unavailable to this context, so the dispatch identity is recorded rather than presented as runtime verification. I did not author, direct, or remediate this candidate, and did not perform either ordinary review.  
**Source:** immutable Git objects in `/Users/heinthura/.codex/worktrees/carrier1/Ticketing.v2`; that worktree's checkout remained at frozen `99ff2a81d32712dda046d025f0b70595c52a692a` and was not edited. All candidate files cited below were read with `git show c32ab85f:...` or `git diff base c32ab85f`, not from the frozen checkout.

## Scope and evidence

The base-to-head diff is six files: `database/executor.ts`; the coding-standards, monorepo-layout, and multi-tenancy contracts; and one unit plus one integration test. I read those exact Git objects, `database/index.ts`, security-model.md, the decision-log #580 entry, the active mission, agent-workflow model/review policy, and the original ordinary C/D reports plus the independent c447→c32 Luna delta report. The preserved C/D reports contain actual typecheck, unit, PostgreSQL integration, and mutation negative-control evidence on the earlier source. I independently checked that the c32 delta changes executor comments and architecture text, not its function/type behavior or tests.

Read-only commands: `git rev-parse HEAD`, `git show`, `git diff --stat`, `git diff`, `git diff --check`, `git ls-tree`, `git grep`, and `rg`. `git diff --check base c32` passed; the exact-head database tree contains 14 named non-repository infrastructure files and one named feature repository. I ran no fresh typecheck, database test, Docker build, or browser test in this security pass, per the isolated static-review assignment. No current CI or current-main composition is established here.

## Blocking finding S1 — false compile-time isolation guarantee

`docs/01-architecture/security-model.md:114-117` at the reviewed head still says every table read goes through a feature `repository.ts` whose exports take an identity and return a phantom-typed `ScopedQuery` that cannot execute without identity, enforced as a type error. The candidate's `docs/04-engineering/coding-standards.md:154-160` instead makes explicit tenant parameters in predicates the convention, says no wrapper is introduced, and requires awaited rows/DTOs/scalars. `docs/01-architecture/multi-tenancy.md:50-64` explicitly replaces `forIdentity` with direct repository functions. `git grep` finds no `ScopedQuery` in API source. Thus the security model describes a control this contract does not implement and a query-result form this contract forbids. A future reviewer could incorrectly rely on the claimed type guarantee when assessing an unscoped repository query; the future location gate cannot verify tenant predicate semantics. Align the security model with the owner/conductor-approved explicit-parameter contract, stating the real enforcement and residual need for semantic tenant tests/review, or implement a separately approved equivalent type guarantee. The stale `forIdentity` example in `coding-standards.md:108` should also be updated to avoid teaching the superseded API. This is a documentation/security-claim blocker, not evidence of a new exploitable endpoint in batch 0.

## Other security checks

- **Executor/transaction propagation:** `Transaction` derives from the actual `DatabaseInstance.transaction` callback type; `Executor` is its union with the shared connection. `executorOrDefault` returns a supplied handle unchanged and falls back to the shared proxy only for `undefined`. The test uses a transaction handle for write/read and proves rollback/commit behavior; original C/D reviewers ran it with negative control. The type does not force a repository to use a passed handle, so D1 still needs per-conversion tests and review. Batch 0 changes no production caller.
- **Tenant parameters:** `multi-tenancy.md` now describes explicit `workspaceId`, `projectId`, or resolved identity predicates, consistent with the 2026-10-15 decision log. A parameter's presence alone is not proof that it came from the resolved identity or that the predicate checks the correct reach; the final gate's structural location rule cannot establish that. This is a residual semantic review/test obligation for each conversion, not a second blocker in this types/docs-only candidate.
- **Query location and SQL forms:** D2 covers raw `execute`/`sql` and fragment helpers; D3 recognizes `repository.ts`, `*.repository.ts`, and `repository/**`, plus exactly 14 named database infrastructure files. It has no `database/**` wildcard or per-site baseline. D4 excludes `apps/api/scripts/**` dev/seed tooling. The text states the final checker is future work; `package.json` has no `check:queries` script at this head. No claim of an active gate is warranted.
- **Results/builders:** The contract requires repository functions to await statements and return rows, DTOs, or scalars, preventing callers from appending filters to a builder returned by the repository. This is a convention at batch 0, pending the actual checker and conversions.
- **Separate batch 10:** The five startup/migration files moved under `database/` in the recovered batch-10 work are not in c32's 14-file list. Their move alone does not convert statements to repositories or authorize them via a directory wildcard. Each needs a separately reviewed placement/explicit-list decision. This review does not cover batch-10 source or tests.

## Non-blocking record and limits

The PR body reportedly still describes D3 as `apps/api/src/database/**`; the exact source does not. Correct that factual summary before acceptance; a PR body cannot silently broaden the source contract. I did not re-query GitHub metadata in this pass, so the current live-body status is the conductor's exact-head check. The original ordinary reports and current Luna delta approval remain their own authentic review records and are not relabelled as this Sol security review. No merge, stage claim, or final `check:queries` clearance follows from this report.

## Authentic report — takeover/764-docs-ordinary-a-luna.md

Origin SHA-256: `bb4bc1aa0c27dba803345e10b20741ae07e52c628dd288f307a4969147190707`.

# #764 docs repair — independent ordinary delta review

**Verdict: APPROVE the documentation delta; no blocking findings.** The changes resolve the prior Sol S1 finding that `security-model.md` promised an unimplemented compile-time `ScopedQuery` guarantee. The stale `forIdentity` sample and the false statement that `check:queries` is currently the enforcing gate are also corrected. The replacement accurately distinguishes query ownership/location from tenant-predicate semantics and keeps explicit tenant predicates as a requirement.

**Reviewed head:** `b5ee3413ead9174ea954f4d588844d00ad250b68`  
**Comparison base:** `c32ab85f36316a84d3ff352192f7a7f80fafbdf3`  
**Model/context:** GPT-6 Luna, explicitly dispatched, fork none; runtime model introspection unavailable. Fresh independent bounded ordinary context.  
**Source:** exact immutable Git objects, read from `/Users/heinthura/.codex/worktrees/carrier1/Ticketing.v2`; no mutable worktree source was relied upon for the delta.

## Scope and checks

The exact delta changes only `docs/01-architecture/security-model.md` and `docs/04-engineering/coding-standards.md` (+17/−13). It adds no code, tests, gate implementation, permissions, schema, policy, or runtime behavior.

Read-only review commands/checks:

- `git show -s --format='%H %P %s' b5ee3413ead9174ea954f4d588844d00ad250b68`
- `git diff --stat c32ab85f36316a84d3ff352192f7a7f80fafbdf3 b5ee3413ead9174ea954f4d588844d00ad250b68`
- `git diff c32ab85f36316a84d3ff352192f7a7f80fafbdf3 b5ee3413ead9174ea954f4d588844d00ad250b68 -- docs/01-architecture/security-model.md docs/04-engineering/coding-standards.md`
- Read the prior independent Sol report at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/764-security-sol.md`, the current #580 decision-log entry, and the relevant multi-tenancy and coding-standard contracts.
- `rg` search for stale `ScopedQuery`, `forIdentity`, gate/enforcement, and explicit-scope wording in the affected docs.

No tests or builds were run; this documentation-only diff introduces no executable change. No source edits were made.

## Findings

- **Prior Sol S1: closed.** The old `security-model.md` claim that every read returned a phantom-typed `ScopedQuery` that could not execute without identity is removed. The replacement says repository queries with cross-organisation reach take tenant scope explicitly and apply it in the statement predicate. It says repository location alone does not prove scope, and that the planned checker checks ownership/location rather than tenant predicate semantics. This is an accurate statement of the current contract and residual risk.
- **Stale example: closed.** The coding-standards example changes from `workItems.forIdentity(identity).byKey(key)` to `workItems.findByKey(identity, key)`, matching the accepted explicit-tenant-argument convention already stated in multi-tenancy.md and the decision log. The example remains illustrative; the wording does not assert that a function signature alone proves its predicate is correct.
- **Gate claim: closed.** Both affected passages now state that `check:queries` is planned and not currently wired, and describe its intended scope as query-location/ownership enforcement. They do not claim tenant-predicate verification by the gate. The decision log likewise says the final batch enables the checker.
- **D1–D4 / tenant requirements: preserved.** Nothing changes the explicit tenant parameters and predicate requirement, repository ownership, awaited-result convention, D1 transaction-handle requirement, D2 raw SQL/fragment scope, D3 exact repository patterns plus explicit infrastructure list, or D4 scripts exclusion. The doc repair changes neither accepted placement rules nor their authority.
- **Security posture: no relaxation found.** P0/RLS text and its stated backstop status are retained. The correction removes a false guarantee instead of creating an exception or waiving a control. The prose leaves semantic predicate correctness to the code, tests, and review, as the unimplemented checker cannot prove it.

## Limits

This report covers only the two-file documentation delta at `b5ee3413ead9174ea954f4d588844d00ad250b68`. It is not a fresh runtime, type, integration, or full security review; it does not establish hosted CI, final checker implementation, PR-body correction, batch 10 acceptance, or merge eligibility. The original Sol report and original ordinary code/test reports remain separate authentic evidence records. The prior PR-body D3 wildcard discrepancy recorded in the c32 report is outside this delta and still requires a live PR-body reconciliation unless already corrected separately.

## Authentic report — takeover/764-docs-ordinary-b-luna.md

Origin SHA-256: `45af82bbb417461b40d51d08524bff97aac473785984a2c337c98a79dda4b650`.

# PR #764 documentation repair — independent ordinary review B

**Verdict: CHANGES REQUESTED** — the two edited documents now correct the phantom `ScopedQuery` guarantee and accurately state the planned query-location gate's limits. The repair leaves directly conflicting active claims in other canonical documents: `multi-tenancy.md` says `check:queries` forbids out-of-repository queries and prevents unscoped queries from reaching controllers; `monorepo-layout.md` says it is enforced; `tech-stack.md` describes the checker as a small AST script; and `ci-cd.md` lists it as a pipeline gate. At this head the root package has no `check:queries` script and no query-checker implementation was found. Resolve these contradictions before calling the #580 contract documentation coherent.

**Reviewed exact head:** `b5ee3413ead9174ea954f4d588844d00ad250b68`
**Comparison base:** `c32ab85f36316a84d3ff352192f7a7f80fafbdf3`
**Model/role:** GPT-6 Luna, independent ordinary reviewer B. This context did not author, direct, or remediate the change and did not participate in the earlier reviews. Platform runtime model/version introspection was unavailable; model attribution reflects the dispatched review role, not independently inspected runtime metadata.

## Scope and evidence

Inspected the exact base-to-head diff and surrounding text in both changed documents; read the relevant query-scoping section of `multi-tenancy.md`, the repository convention in `monorepo-layout.md`, the gate references in `tech-stack.md` and `ci-cd.md`, and the existing security review `takeover/764-security-sol.md`. The diff changes exactly `docs/01-architecture/security-model.md` and `docs/04-engineering/coding-standards.md`. The 14-file database-infrastructure allowlist text was not changed. The source/API files and the security review's executor evidence were not re-reviewed as reassurance; this pass is limited to the documentation delta and its direct consistency.

Commands run in `/Users/heinthura/.codex/worktrees/q580-b0/Ticketing.v2`:

- `git status --short`
- `git diff --stat c32ab85f36316a84d3ff352192f7a7f80fafbdf3 b5ee3413ead9174ea954f4d588844d00ad250b68`
- `git diff --name-status ...`
- `git diff --find-renames ... -- docs/01-architecture/security-model.md docs/04-engineering/coding-standards.md`
- `git diff --check c32ab85f36316a84d3ff352192f7a7f80fafbdf3 b5ee3413ead9174ea954f4d588844d00ad250b68` — passed
- targeted `sed`/`rg` inspection of the cited docs and `package.json`
- `git rev-parse` for base and head

No tests or builds were run; this documentation-only review used diff checks and targeted source inspection. No PR metadata/body or live GitHub state was queried.

## Finding B1 — remaining canonical docs still claim the unwired gate is active

The changed security model and coding standards now say `check:queries` is planned, unwired, and checks query ownership rather than tenant-predicate semantics. That is accurate for this checkout: the root `package.json` has no `check:queries` script. However, unchanged canonical docs still make active-enforcement claims:

- `docs/01-architecture/multi-tenancy.md:64` says the gate forbids building queries outside repositories and therefore stops ad-hoc unscoped queries reaching controllers.
- `docs/01-architecture/monorepo-layout.md:151` says repository placement is enforced by `check:queries`.
- `docs/01-architecture/tech-stack.md:157` describes a small AST script as the enforcement mechanism.
- `docs/04-engineering/ci-cd.md:80` lists `pnpm check:queries` among pipeline gates.

These statements contradict the repaired docs and imply a runtime/build control that is not wired. They also blur repository ownership with tenant-predicate correctness, the distinction this repair correctly restores. Update the remaining stale claims in the owning documentation set (or otherwise establish the gate's current implementation and exact semantics); until then, the documentation set still invites a reviewer to believe omissions are mechanically caught.

## Checks that passed

- The original false claim that repositories return a phantom-typed `ScopedQuery` which cannot execute without identity is removed from the security model.
- The coding-standards example no longer teaches the superseded `forIdentity(...).byKey(...)` call; it uses `findByKey(identity, key)`.
- Both edited documents now distinguish repository ownership from tenant-predicate semantics, and state that explicit tenant predicates remain required.
- The new language does not claim the gate is already active. It does not add authority, waive a control, or weaken the tenant-scoping requirement.
- The documented infrastructure exception list is untouched in this diff.

## Limits

This is a documentation consistency finding, not evidence of a new runtime tenant-isolation defect. The review does not establish live PR status, CI state, or current `main` composition, and does not grant merge or phase acceptance.

## Authentic report — takeover/764-docs-final-delta-luna.md

Origin SHA-256: `012bd89dd297103f151eb48002be1161650e0fb48abb739d17f1f0792bc5d997`.

# PR #764 documentation repair — independent ordinary delta review

**Verdict: APPROVE the four-document consistency delta; no blocking findings.** At exact head `64e05893870631b7d06e44ae4f450983d87c8235`, the stale active claims identified in ordinary review B are corrected across multi-tenancy, monorepo layout, tech stack, and CI/CD. These documents now consistently describe `check:queries` as planned and unwired, distinguish query ownership/location from tenant-predicate correctness, and link to the canonical tenant-scope contract.

**Reviewed exact head:** `64e05893870631b7d06e44ae4f450983d87c8235`  
**Comparison base:** `b5ee3413ead9174ea954f4d588844d00ad250b68`  
**Model/role provenance:** GPT-6 Luna, explicitly dispatched by the parent as a fresh independent ordinary delta review. Runtime model/version introspection is unavailable here; the attribution records the dispatch role, not independently verified runtime metadata. I did not author, direct, or remediate the delta.  
**Worktree:** `/Users/heinthura/.codex/worktrees/q580-b0/Ticketing.v2`

## Scope and evidence

Read the repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, and `CLAUDE.md`, plus the assigned prior ordinary A/B reports, gate-status repair handoff, and prior security report at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/764-security-sol.md`. Inspected the exact `b5ee3413..64e05893` diff, relevant canonical query-scope sections, all matching `check:queries` references in `docs/01-architecture/` and `docs/04-engineering/`, root package scripts, and `scripts/ci/test-all.mjs`.

The delta changes exactly four files: `docs/01-architecture/multi-tenancy.md`, `docs/01-architecture/monorepo-layout.md`, `docs/01-architecture/tech-stack.md`, and `docs/04-engineering/ci-cd.md`. It adds 12 lines and removes 8. No source, test, CI workflow, or checker implementation changed.

Commands and checks:

- `git rev-parse HEAD` — `64e05893870631b7d06e44ae4f450983d87c8235`.
- `git diff --stat b5ee3413ead9174ea954f4d588844d00ad250b68 64e05893870631b7d06e44ae4f450983d87c8235` — four intended files, 12 insertions/8 deletions.
- `git diff --name-status ...` — exactly those four files.
- `git diff --check b5ee3413ead9174ea954f4d588844d00ad250b68 64e05893870631b7d06e44ae4f450983d87c8235` — passed.
- `pnpm run` — lists no `check:queries`; it does list `test:all`.
- Direct inspection of `package.json` — no root `check:queries` script.
- Direct inspection of `scripts/ci/test-all.mjs` — its `pnpm check:queries` entry has `run: null`.
- `test ! -e scripts/ci/check-queries.mjs` — passed; no checker implementation at that path.
- Corrected standalone Node/ESM file inspection confirmed the script absence and `run: null` manifest entry. An initial optional one-line check used CommonJS `require()` on the top-level-await ESM manifest and errored; it was immediately rerun as an ESM file read, producing the confirmations above.
- `pnpm check:policy` — passed: 8 policy files coherent.
- `git status --short` — clean.
- Targeted `rg` across architecture and engineering docs confirmed no remaining active present-tense claim that this gate is wired. The additional references in `repository-bootstrap.md` remain within its explicitly future/bootstrap plan, describing work to add; they are not active gate statements.

No product tests, builds, runtime checks, or broad test suites were run; this documentation-only delta introduces no executable changes. No source edits, push, or merge were performed. No live GitHub state was queried.

## Findings

- **Prior B1: closed.** `multi-tenancy.md` now says the gate will forbid out-of-repository statement construction once wired, explicitly says it is currently unwired, and says it does not establish tenant-predicate correctness. `monorepo-layout.md` no longer says the convention is enforced; it labels the gate planned and points to coding standards. `tech-stack.md` identifies the AST script as planned and unwired and links to the authoritative contract. `ci-cd.md` now labels the list as active checks plus planned additions, distinguishes planned entries from active CI gates, and describes `test:all` as running enabled checks.
- **Tenant-predicate requirement retained.** The canonical coding standard still requires explicit tenant scope in the statement predicate for cross-organisation reads and warns that repository location alone does not guarantee scoping. The changed multi-tenancy document directs readers there and expressly separates predicate correctness from query ownership.
- **Planned fail-closed location rule retained.** The coding standard still states that the eventual checker enumerates repository patterns and a closed infrastructure list, has no `database/` wildcard, and does not allow a new database file to query until named as a repository or added by reviewed change.
- **Exact infrastructure exception list retained.** The 14 named files remain: `schema.ts`, `relations.ts`, `index.ts`, `executor.ts`, `resolve-database-url.ts`, `wait-for-database.ts`, `prepare-database-startup.ts`, `migration-schema.ts`, `migrate-membership-provenance.ts`, `ensure-application-role.ts`, `assert-application-role-is-not-privileged.ts`, `assert-no-migration-url-in-api-process.ts`, `append-only-tables.ts`, and `scram-sha-256.ts`. The delta does not alter that list or broaden it.
- **No authority or gate semantics changed.** This is documentation alignment only. The false active-check claim is removed without representing the planned location gate as a tenant-isolation proof or changing the underlying requirement.

## Limits

This is a fresh review of the four-document delta only. Prior source and security findings/reviews remain bound to their original heads and are not renewed here. This report does not establish hosted checks, PR-body consistency, merge eligibility, or phase acceptance.

## Authentic report — takeover/764-security-final-sol.md

Origin SHA-256: `a7154c6176be7e2de475dae601f31556333608735e85fd93b84db7d399412b55`.

# PR #764 query-ownership contract — independent security review

**Interim verdict at `64e05893870631b7d06e44ae4f450983d87c8235`: BLOCKED.** The runtime executor change has no demonstrated new authorization defect, and the gate-status repair corrected four active documents. One canonical contract paragraph still describes a `forIdentity` shape that this same candidate explicitly replaces. This finding remains adverse evidence even if a later exact head repairs it; a final exact-head verdict will follow the correction and ordinary review.

**Reviewed candidate:** local `codex/query-ownership-580-b0` at `64e05893870631b7d06e44ae4f450983d87c8235`; comparison base `d159704be626136e728df7ddef0381dc37cf7756` (the base GitHub reported for PR #764). At the time checked, GitHub PR #764 still reported remote head `c32ab85f36316a84d3ff352192f7a7f80fafbdf3`, so its existing checks do not certify the local candidate.

**Role/provenance:** fresh independent security-review context dispatched by the conductor as `gpt-6-sol`, `fork_turns=none`; I did not author, direct or remediate the candidate. Runtime model/version introspection is unavailable to this context. The model label records the parent's explicit dispatch, not an independently inspected runtime claim.

## Scope examined

I read `AGENTS.md`, the active mission, `agent-workflow.md`, `CLAUDE.md`, the CI security-path list, and the candidate's full nine-file diff from the PR base. The code changes are `apps/api/src/database/executor.ts` and its unit/integration tests. The documentation changes are `monorepo-layout.md`, `multi-tenancy.md`, `security-model.md`, `tech-stack.md`, `ci-cd.md`, and `coding-standards.md`. I inspected the current database source and exact repository/infrastructure exception list. I read prior adverse Sol report `764-security-sol.md`, ordinary A/B reports for the b5 repair, and the author's 64e handoff. The earlier Sol blocker was the unsupported phantom `ScopedQuery` guarantee. Ordinary B then found the remaining false active-gate claims; these findings are retained, not erased by this review.

## Blocking finding S1 — superseded wrapper still described in authoritative coding standards

`docs/04-engineering/coding-standards.md:156-160` says `multi-tenancy.md` and `monorepo-layout.md` describe `forIdentity(identity)` scoped queries and that explicit tenant parameters “satisfy `forIdentity`.” At this exact head, `multi-tenancy.md:58-61` explicitly says the `forIdentity(...).inProject(...)` wrapper shape is **replaced** and no wrapper type is introduced, while `monorepo-layout.md:149-152` describes explicit tenant parameters. Neither now describes `forIdentity` as the current API or control. Because coding standards is the authoritative query-ownership contract, this still teaches a nonexistent security abstraction and contradicts the candidate's corrected tenant-scoping model. Reconcile this paragraph with the explicit-parameter/predicate rule, then obtain independent disposition on the new exact head. This is a document-contract blocker, not evidence of a newly exploitable route.

## Other findings and limits

- The previous phantom-type finding is substantively repaired in `security-model.md`: it now requires explicit tenant parameters and predicates, states repository location does not prove tenant scoping, and labels `check:queries` planned/unwired. The four-document 64e follow-up similarly labels the gate planned and distinguishes query ownership from tenant-predicate correctness. I found no remaining active-gate assertion in those changed documents. The future-oriented `repository-bootstrap.md` references remain a plan.
- `Executor` derives `Transaction` from the actual Drizzle `DatabaseInstance.transaction` callback type; `executorOrDefault` returns a supplied handle unchanged and falls back to the shared database proxy for absent/undefined handles. The full candidate changes no production query caller or policy. This type does not force future repositories to pass or use a handle, so every conversion still needs semantic review and tests. Existing controllers still contain direct statements; this partial batch does not claim they have been converted.
- The ownership rule includes raw `execute`/`sql`, fragment helpers, all three repository path forms, and an explicit **14-file** infrastructure exception list under `apps/api/src/database/`. I compared it with the actual top-level database files: the named set is present, plus the named `repositories/notification-delivery.repository.ts` matches the repository pattern. There is no `database/**` wildcard in the contract. `apps/api/scripts/**` is excluded as dev/seed tooling. The checker remains planned; `pnpm run` lists no `check:queries` script and `scripts/ci/test-all.mjs` has `run: null` for it. No gate waiver was inferred.
- `multi-tenancy.md` cites the 2026-10-15 conductor decision entry in PR #780. `gh pr view 780` reported it OPEN at `4d7e2d0170e855b830a5f6ee98e1886871cac6b7`; the entry is not in this checkout's `decision-log.md`. The cited decision is therefore a separate integration dependency, not authority already present at the #764 base/head. The conductor should verify ordering/composition before relying on that citation.
- The live PR #764 body still summarizes D3 as `apps/api/src/database/**`, broader than the source contract, and its security section is pending. That body and the remote head require reconciliation and current exact-head checks before merge. This is not a source-code widening of the exception list.

## Actual verification at 64e

- `git rev-parse HEAD`, `git status --short`, `git log`, `git diff --stat`, full `git diff` from `d159704b`, targeted `rg`/`sed` source and documentation inspection, `gh pr view 764`, `gh pr view 780`.
- `git diff --check d159704be626136e728df7ddef0381dc37cf7756 HEAD` — pass.
- `pnpm --filter @taskdesk/api exec vitest run ../../tests/api/database-executor.test.ts` — **1 file / 4 tests passed**. The integration test was read, but **not rerun** here because a separate performance lane owns the shared database load.
- `pnpm check:policy` — pass, 8 policy files coherent.
- `pnpm run | rg 'check:queries|test:all|check:policy'` — `test:all` and `check:policy` present; `check:queries` absent.

No source edits, push, merge, database suite, image boot, or runtime acceptance were performed by this reviewer. This report cannot turn the local 64e commit into the remote PR's reviewed head or clear its failing PR-template/security check.

## Authentic report — takeover/764-tenant-paragraph-delta-luna.md

Origin SHA-256: `244b780ba7a1361dea9b8a135985636199da45c49f0873abb2512923978e1a18`.

# #764 tenant-contract paragraph — independent ordinary delta review

**Verdict: APPROVE this paragraph delta; no blocking findings.** At exact head `9d7e9a50364f503ceb96b939fa8a23b2c6b6a42d`, the remaining stale claim that current contracts describe `forIdentity` and that explicit parameters “satisfy” that wrapper is removed. The replacement states the explicit tenant-and-predicate rule, warns that a supplied parameter alone does not prove caller reach, and links to the current multi-tenancy and security-model sections. It does not weaken tenant isolation or imply that the planned location gate verifies predicate semantics.

**Reviewed exact head:** `9d7e9a50364f503ceb96b939fa8a23b2c6b6a42d`  
**Comparison base:** `64e05893870631b7d06e44ae4f450983d87c8235`  
**Model/role provenance:** GPT-6 Luna, dispatched by the parent for this bounded ordinary delta review. Runtime model/version introspection is unavailable; attribution reflects dispatch and is not independent runtime verification.  
**Worktree:** `/Users/heinthura/.codex/worktrees/q580-b0/Ticketing.v2`

## Scope and evidence

Read the supplied author repair handoff and interim Sol finding, then independently inspected only the exact one-paragraph diff in `docs/04-engineering/coding-standards.md` and its linked tenant contracts in `docs/01-architecture/multi-tenancy.md#query-scoping` and `docs/01-architecture/security-model.md#5-secrets-never-serialise-queries-are-never-unscoped`.

Commands:

- `git rev-parse HEAD` — `9d7e9a50364f503ceb96b939fa8a23b2c6b6a42d`.
- `git diff --stat 64e05893870631b7d06e44ae4f450983d87c8235 9d7e9a50364f503ceb96b939fa8a23b2c6b6a42d` — one file, 6 insertions/5 deletions.
- `git diff 64e05893870631b7d06e44ae4f450983d87c8235 9d7e9a50364f503ceb96b939fa8a23b2c6b6a42d -- docs/04-engineering/coding-standards.md` — confirms only the tenant-scoping paragraph changed.
- `git diff --check 64e05893870631b7d06e44ae4f450983d87c8235 9d7e9a50364f503ceb96b939fa8a23b2c6b6a42d` — passed.
- Targeted `sed` inspection of the paragraph and both linked sections.
- `rg -n -i 'forIdentity|ScopedQuery|phantom-typed|satisfies ...' docs/01-architecture docs/04-engineering -g '!**/reviews/**'` — the only remaining active-doc references are the explicit statement that the old wrapper was replaced in `multi-tenancy.md`, and the new negative guarantee in coding standards. No active claim presents the wrapper as current or as an implemented security control.
- `git diff --name-only ...` — only `docs/04-engineering/coding-standards.md`.
- `git status --short` — clean.

No tests or builds were run; this prose-only paragraph changes no executable behavior. No edits, push, merge, or live GitHub query were performed.

## Findings

- **Interim Sol S1: closed for this paragraph.** The obsolete assertion that the neighboring documents “describe `forIdentity(identity)` scoped queries,” and the statement that explicit parameters “satisfy `forIdentity`,” are gone. The remaining `multi-tenancy.md` mention accurately identifies that wrapper as the earlier shape that was replaced.
- **Tenant isolation contract preserved.** The new paragraph requires explicit tenant scope and inclusion in the statement predicate for cross-organisation repository queries. It states that parameter presence alone does not prove the predicate enforces caller reach.
- **Linked contracts agree.** Multi-tenancy describes the same explicit-parameter/predicate contract and labels the wrapper as replaced. Security model also requires explicit predicates, warns that repository location alone does not establish scoping, and says `check:queries` only checks ownership/location and is unwired.
- **No gate overclaim or relaxation.** Coding standards continues to label `check:queries` planned and unwired; the new paragraph adds no exception to predicate requirements and makes no `ScopedQuery` guarantee.

## Limits

This verdict covers only the paragraph delta and its linked contracts at this exact head. It does not replace or rewrite the earlier approval of the b5-to-64e four-document delta, renew source review, or establish hosted checks, PR-body consistency, security final clearance, or merge eligibility.

## Authentic report — takeover/764-security-clearance-sol.md

Origin SHA-256: `649db94cef722ee33edf05532d848964213f9312cf6e3d52296781b7bc422fca`.

# PR #764 / #580 batch 0 — final independent security review

**Verdict: CLEAR at `9d7e9a50364f503ceb96b939fa8a23b2c6b6a42d`, for the source and contract reviewed. No blocking security finding remains in this candidate.** This is clearance of the full batch-0 executor/query-ownership contract, including the later documentation repairs. It is not a claim that `check:queries` is active, existing queries have been migrated, the remote PR is at this SHA, or merge gates are green.

**Exact candidate:** local `codex/query-ownership-580-b0` at `9d7e9a50364f503ceb96b939fa8a23b2c6b6a42d`; PR #764's reported base is `d159704be626136e728df7ddef0381dc37cf7756`. I reviewed the full base-to-head candidate, not just the final paragraph. `git diff 64e05893870631b7d06e44ae4f450983d87c8235..9d7e9a50364f503ceb96b939fa8a23b2c6b6a42d` modifies only the tenant-scoping paragraph of `docs/04-engineering/coding-standards.md`. At the final live query in this review, GitHub PR #764 still reported remote head `c32ab85f36316a84d3ff352192f7a7f80fafbdf3`; its successful checks and failed PR-template/security check are tied to that older head, not to 9d.

**Role and provenance:** fresh independent security reviewer dispatched by the conductor as `gpt-6-sol`, `fork_turns=none`, with no authoring, direction or remediation of this candidate. Runtime model/version introspection is unavailable here; the model label states the explicit dispatch, not an independently measured model identity. The ordinary final-paragraph delta reviewer is a separate context and recorded APPROVE at this SHA in `764-tenant-paragraph-delta-luna.md`.

## Security assessment

- **Earlier adverse findings closed on source.** The original independent Sol finding (`764-security-sol.md`) correctly blocked the false phantom `ScopedQuery`/`forIdentity` guarantee in `security-model.md`. The b5 repair removed it. Ordinary reviewer B (`764-docs-ordinary-b-luna.md`) correctly blocked the four remaining active-gate claims; 64e repaired `multi-tenancy.md`, `monorepo-layout.md`, `tech-stack.md` and `ci-cd.md`. My interim full review at 64e (`764-security-final-sol.md`) found that the authoritative coding-standards tenant paragraph still taught the replaced wrapper. The sole 64e-to-9d paragraph now requires explicit tenant scope in the statement predicate, warns that a parameter alone does not establish caller reach, links the current tenant/security contracts, and explicitly disclaims a `forIdentity`/`ScopedQuery` wrapper guarantee. The adverse records remain preserved.
- **Actual executor boundary.** `Transaction` is extracted from the real `DatabaseInstance.transaction` callback signature. `Executor` is the shared Drizzle connection or that transaction handle; `executorOrDefault` returns a caller-supplied handle unchanged and uses the shared proxy only when absent. The unit test verifies this identity/fallback/type surface. The integration test source exercises visibility inside a transaction, rollback invisibility, commit visibility and default-connection use. This batch adds no production repository conversion or changed route/policy, so it creates no new tenant-read path. The type cannot prove that a future repository uses its supplied handle; per-conversion review/tests remain necessary.
- **Tenant scope is an explicit semantic requirement.** The final `multi-tenancy.md`, `security-model.md`, and coding standards agree that cross-organisation reads take explicit scope and apply it in the SQL predicate. They do not claim repository placement, a parameter signature, or a compile-time wrapper independently proves authorization. The 404 cross-tenant rule is retained. The planned location checker is not a tenant-predicate checker.
- **Ownership boundary and exceptions.** D1 treats transaction opening as orchestration and requires statements within it to go through handle-taking repositories. D2 covers raw `execute`/`sql` and fragment helpers. D3 permits the three named repository patterns and exactly 14 named `apps/api/src/database/` persistence-infrastructure files; it does not permit a `database/**` wildcard or per-site baseline. I checked that list against the current top-level database files; the extra `database/repositories/notification-delivery.repository.ts` matches the named repository pattern. D4 excludes `apps/api/scripts/**` dev/seed tooling. Repositories are required to await statements and return results, not composable builders. These are contract rules for later batches; no final checker exists at this head.
- **Gate status.** The changed active docs now mark `check:queries` planned/unwired. The root package has no script for it; `scripts/ci/test-all.mjs` records that gate with `run: null`. No gate waiver or current machine enforcement is claimed. The future-oriented `repository-bootstrap.md` references describe adding the gate.

## Actual checks and remaining dependencies

I read `AGENTS.md`, active mission, `agent-workflow.md`, `CLAUDE.md`, the CI security path list, the full nine-file candidate diff, database entry point/executor/tests, the relevant tenant and coding contracts, the earlier adverse and ordinary reports, and the final independent ordinary delta verdict. I used `git rev-parse`, status/log/diff, targeted `rg`/`sed`, and `gh pr view 764`/`780` to verify source and live heads. `git diff --check` from the PR base passed at both 64e and 9d. `pnpm check:policy` passed at both heads (8 policy files). The focused Executor unit test passed **1 file / 4 tests** at 64e; source/tests are byte unchanged at 9d. I did **not** rerun the database integration test while another lane profiled shared performance. Its historical results are not presented as a new 9d runtime result. No image, boot, browser, or SIT acceptance was performed by this reviewer.

PR #780, which contains the cited 2026-10-15 conductor decision-log entry, was reported OPEN at `4d7e2d0170e855b830a5f6ee98e1886871cac6b7` when checked. The conductor says that decision is retained in carrier #791. The #764 documentation therefore has a **composition/merge-order dependency**: the accepted base must include the real decision entry before this citation is relied on. This is not a finding that owner authorization is absent. The live #764 PR body still describes D3 as `apps/api/src/database/**`, broader than the source contract, and its security review section is pending; its body and exact-head CI/review records must be reconciled before merge. A red required check or stale remote SHA blocks merge regardless of this source-review verdict.

No source edit, push, PR update, merge, gate waiver, stage claim, or runtime acceptance was performed in this review. The earlier 64e blocked verdict is not retroactively changed; this clearance applies only to the exact 9d candidate and its verified one-paragraph repair.

