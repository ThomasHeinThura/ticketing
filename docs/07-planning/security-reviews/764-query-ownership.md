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


## CI table repair and exact-head binding

**Reviewed head:** `22374eb8e504ab8d200c9cd5d826eaa087195096`

Full independent security clearance at9d and the following ordinary/lightweight Sol confirmations cover the sole later CI table correction. The old top-level attestation lacked backticks and was not parsed; it is retained unchanged. This correctly formatted additive binding names the actual current reviewed source. Hosted753 CI failure is preserved; no acceptance gate is waived.

### Authentic report — 764-ci-row-delta-luna.md

Origin SHA-256: `e8b3b87444a6ef52c43a0bc458b3c36b17c3908882c3d0c3953e0f466d2a8f1b`.

# PR #764 CI table row — independent ordinary delta review

**Verdict: APPROVE this bounded documentation delta; no blocking findings.** At exact local head 22374eb8e504ab8d200c9cd5d826eaa087195096, the one-line ci-cd.md correction restores the check command in the table's command column while retaining “planned — not wired” as its description. This satisfies the existing parser and manifest without claiming that the check runs or changing any gate behavior.

**Reviewed exact head:** 22374eb8e504ab8d200c9cd5d826eaa087195096  
**Comparison base:** 753653bd04d210056d30c79ae487f1a33a83e887  
**Model/role provenance:** GPT-6 Luna, dispatched by the parent for this bounded ordinary delta review. Runtime model/version introspection is unavailable; attribution records dispatch, not independently verified runtime metadata. I did not author or remediate this change.

## Scope and evidence

Inspected only the exact one-line diff in docs/04-engineering/ci-cd.md, the hosted failure log for 753653bd, the parser in scripts/ci/lib/ci-cd-gates.mjs, the manifest entry in scripts/ci/test-all.mjs, and the relevant GitHub Actions workflow comments/job. Confirmed the worktree HEAD is the requested candidate and the diff changes exactly one file and one line.

Commands/checks:

- git rev-parse HEAD — 22374eb8e504ab8d200c9cd5d826eaa087195096.
- git diff --stat 753653bd04d210056d30c79ae487f1a33a83e887 22374eb8e504ab8d200c9cd5d826eaa087195096 — one file, one insertion and one deletion.
- git diff --name-status ... — only docs/04-engineering/ci-cd.md.
- git diff --check ... — passed.
- Read /Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/764-ci-docs-753653bd.log. The hosted parser failure says ci-cd.md declared “planned” as the gate while the manifest runs pnpm check:queries, and says the command was not declared. This is the exact mismatch the line repairs.
- Read scripts/ci/lib/ci-cd-gates.mjs. It normalizes a cell beginning with pnpm <command> as the declared gate; with the new row, the command column parses to pnpm check:queries and the explanatory text is dropped.
- Read scripts/ci/test-all.mjs: the matching manifest entry remains run: null and retains its reason. No implementation or active command is added.
- Read .github/workflows/ci-fast.yml: check:queries is explicitly among gates that cannot exist yet; no job is added by this delta.
- pnpm test:all --list — exit 0; lists pnpm check:queries as “not enabled” with its existing reason; reports 0 passed, 0 failed, 5 not enabled yet.
- pnpm check:policy — passed: 8 policy files coherent.
- git status --short — clean.

No heavy tests, builds, source edits, push, or merge were performed.

## Findings

- **Parser mismatch: closed.** The new cell begins with the canonical command pnpm check:queries, matching the manifest gate. The three-space separation preserves the parser's existing command/prose split.
- **Planned status retained.** The same row still labels the check “planned — not wired (#580)”. The introductory paragraph in ci-cd.md also says entries with that marker are future checks, not active CI gates.
- **No pass/fail or authority semantics changed.** The manifest continues to use run: null, the --list output continues to say “not enabled”, and the workflow continues to omit a job intentionally. The repaired command label does not execute, enable, or treat the gate as passing.
- **No scope expansion.** The delta changes no checker, manifest, workflow, permission, policy, or test.

## Limits

This verdict is bound to the local one-line delta at 22374eb8e504ab8d200c9cd5d826eaa087195096. It does not establish remote PR head, hosted status checks on this new SHA, final #764 acceptance, or merge eligibility.

### Authentic report — 764-ci-row-security-sol.md

Origin SHA-256: `b6a9e09c12bf9024ae74690821e29e1f579a28c2da817582d9b1499da23f4eed`.

# PR #764 CI gate table row — independent security confirmation

**Verdict: CLEAR at exact local head `22374eb8e504ab8d200c9cd5d826eaa087195096` for the bounded CI table-row delta.** It restores the parser-visible `pnpm check:queries` command while retaining the explicit “planned — not wired (#580)” description. The command remains disabled in the test manifest. This confirmation preserves the full independent security clearance of the unchanged product/query contract at `9d7e9a50364f503ceb96b939fa8a23b2c6b6a42d`; it does not reclassify the prior adverse reviews or grant merge eligibility.

**Role/provenance:** fresh independent security-review context dispatched by the conductor as `gpt-6-sol`, `fork_turns=none`; I did not author, direct, or remediate the one-line repair. Runtime model/version introspection is unavailable. This label records explicit dispatch, not independent runtime identification. The independent ordinary delta reviewer separately APPROVED the exact 223 head in `764-ci-row-delta-luna.md`.

## Exact scope and finding

The comparison base for this confirmation is `753653bd04d210056d30c79ae487f1a33a83e887`, the immediate parent of 223. `git diff 753653bd..22374eb8` changes only `docs/04-engineering/ci-cd.md`: one table row from `planned — not wired: check:queries (#580)` to `pnpm check:queries   planned — not wired (#580)`. The older full security-cleared source head is 9d. Its intervening 753 commit adds only `docs/07-planning/security-reviews/764-query-ownership.md`, the published review record; it changes no product source, tests, gate script, CI workflow, package script or canonical query contract. The 753 publication remains its own evidence, not an edit to the underlying reviewer verdicts.

The active table parser in `scripts/ci/lib/ci-cd-gates.mjs` takes the first cell segment before two or more spaces and normalizes a `pnpm <script>` command. At 753, the row parsed as gate `planned`, producing the hosted reconciliation failure: the log reported that `ci-cd.md` declares `planned` with no manifest entry and omits `pnpm check:queries`. At 223, the row parses as `pnpm check:queries`, matching the existing manifest entry. The prose after the three spaces is a description, and the table introduction says **planned — not wired** entries are future additions. `scripts/ci/test-all.mjs` still has `run: null` for this gate; `.github/workflows/ci-fast.yml` still says `check:queries` has no job. This changes the erroneous table declaration that made reconciliation fail, but does not activate the checker, change its eventual scope, relax an authorization requirement, add a waiver, or change any runtime behavior.

## Actual verification and limits

- Read `764-ci-row-repair-conductor.md`, the independent ordinary delta report, the exact one-line diff, the earlier full security report `764-security-clearance-sol.md`, the parser, manifest, CI workflow note and the retained hosted 753 failure log.
- `git rev-parse HEAD` returned `22374eb8e504ab8d200c9cd5d826eaa087195096`; `git status --short` was clean. `git diff --name-status 753653bd..22374eb8` named only `docs/04-engineering/ci-cd.md` and `git diff --check` on that exact one-line delta passed.
- `pnpm test:all --list` exited 0 and reconciled 40 declared gates. It displayed `pnpm check:queries` as **not enabled**, with **0 passed, 0 failed, 5 not enabled yet**. This list/manifest check does not run the disabled checker.
- `git diff --name-status 9d7e9a5..753653bd` named only the added #764 security-review note. The broad 9d-to-223 `git diff --check` reports trailing Markdown line-break spaces in that published note; it is not a failure of the one-line CI-row repair and is not represented here as passing.

No product tests, PostgreSQL suite, image, browser, source edit, push, merge or PR-body update was performed. A correctly formatted current-head attestation, remote exact-head checks, and the standing composition/dependency requirements remain for the conductor. This clearance covers only the 223 source delta atop the already cleared 9d candidate.


## Current accepted-main conformance and independent review

**Reviewed head:** ca30c08d11807bee1346eb62693e2097e55b7f78

Accepted main is09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6. The earlier preparation packet incorrectly named782 as a prerequisite; its separate erratum corrects this. Accepted780 preserves resolved-identity scoped repositories. The author conformed the proposed docs to that accepted convention without changing executor or tests. Two fresh independent ordinary contexts and a separate fresh full Sol context clear the current source. Advice, preparation and author handoffs are not independent approvals; eight raw record versions are not eight approvals. Historical adverse reports remain intact. Current hosted checks and image/runtime proof remain pending. Ordinary A's full-diff whitespace claim is corrected by its separate unchanged erratum; raw historical formatting is preserved.

### Source report — 764-current-main-preparation-luna.md

Source SHA-256: `c229e2f06a13886732e5e4e9777f840e7ea1868cc8dcb6fed9257a323f7238a1`.

# PR764 current-main preparation (read-only)

Prepared 2026-10-16 by bounded Luna preparation context. This packet is source inventory and composition guidance only; it is not an independent source review, runtime proof, or merge approval.

## State observed

- Retained worktree: `/Users/heinthura/.codex/worktrees/q580-b0/Ticketing.v2`; branch `codex/query-ownership-580-b0`; local `HEAD` `0627093df3ef9a7cf6784d242642a22cf887a077`; working tree clean and tracking `origin/codex/query-ownership-580-b0` at the same SHA. No recreation/reset or edits performed.
- Remote: `ThomasHeinThura/ticketing`. PR #764 is OPEN, base `main` at `d159704be626136e728df7ddef0381dc37cf7756`, exact head `0627093df3ef9a7cf6784d242642a22cf887a077`. GitHub reports `mergeable: UNKNOWN`, no review decision. At this head, the PR-template + security-review check is FAILURE; remaining listed checks were SUCCESS on that SHA. These old hosted results do not satisfy final-head CI.
- Fetched `origin/main`: `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6` (protected #802). The actual merge base of this checkout's candidate and `origin/main` is `d159704be626136e728df7ddef0381dc37cf7756`.
- PR #782 is OPEN at `b407e3f82028952139b16ff9cd5cf97892fd4a7a`, based on the accepted `09dd...`; hosted CI had a fresh run in progress when sampled (older run cancelled). Treat the referenced #780 decision as not yet accepted through #782; do not import #782's current tree or assume a future merge SHA.

## Candidate source inventory

`git diff --name-status d159704be626136e728df7ddef0381dc37cf7756..0627093df3ef9a7cf6784d242642a22cf887a077` has exactly these ten unique paths:

1. `apps/api/src/database/executor.ts` (new; 37 lines, including `executorOrDefault`)
2. `tests/api/database-executor.test.ts` (new; 37 lines)
3. `tests/api-integration/database-executor.test.ts` (new; 69 lines)
4. `docs/01-architecture/monorepo-layout.md`
5. `docs/01-architecture/multi-tenancy.md`
6. `docs/01-architecture/security-model.md`
7. `docs/01-architecture/tech-stack.md`
8. `docs/04-engineering/ci-cd.md`
9. `docs/04-engineering/coding-standards.md`
10. `docs/07-planning/security-reviews/764-query-ownership.md`

The product contract remains batch 0 only: executor type/helper, D1–D4, exactly 14 named DB infrastructure paths plus repository naming patterns, and no production caller migrations. `check:queries` is still explicitly planned/unwired (`ci-cd.md` row and manifest remain disabled). The PR body's D3 summary matches the reviewed bounded source contract.

## Existing review coverage

The committed review record `docs/07-planning/security-reviews/764-query-ownership.md` preserves original reports and adverse findings. The report chain identifies these relevant clears:

- Ordinary Claude Sonnet reviews at `39fd2f9e...` (initial source; original D3/executor/doc caveats preserved) and `c4477744...` (D3 narrowing/document wording delta).
- Independent GPT-6 Luna contract delta APPROVE at `c32ab85f...`; earlier Sol BLOCKED and Luna CHANGES REQUESTED findings are preserved, then repaired and re-reviewed.
- Independent ordinary doc repairs: APPROVE at `b5ee3413...` (first correction), CHANGES REQUESTED at that same head from a second doc reviewer for remaining canonical claims, then APPROVE for four-document repair at `64e05893...`.
- Ordinary tenant paragraph delta APPROVE and full independent security CLEAR at `9d7e9a50...`; the latter covers full batch-0 executor/query contract and tenant docs.
- Ordinary and independent security confirmation APPROVE/CLEAR at `22374eb8...` for the one-line `ci-cd.md` parser declaration repair. `0627093...` is a review-record/PR binding continuation according to the branch log and contains no new product source beyond the already reviewed source and this CI row.

The note contains twelve unique authentic original report entries (including blocked/changes-requested and later superseding verdicts); they should remain intact. Confirm provenance and the note-only intervening commit semantics before reusing any report under the workflow's exact-source rules. The final applicable source clears are 9d (full contract) plus 223 (bounded CI-row delta), not 062 as an independently reviewed product source. Historical runtime/unit and integration evidence is explicitly labelled to its originating SHA; it is not fresh evidence at the current head. No image, boot, browser, or current-main runtime proof is claimed.

## Accepted-main overlap and composition risks

Pairwise candidate-vs-current-main diff has the executor plus overlapping canonical docs. `git merge-tree` against the real base shows substantive same-hunk overlap in at least `monorepo-layout.md` and `multi-tenancy.md`; it also reports overlapping edits in `security-model.md`, `tech-stack.md`, `ci-cd.md`, and `coding-standards.md`. These are semantic composition points even where Git can auto-merge. The accepted main has newer unrelated work, including the current image-helper/control-plane changes; preserve those.

The exact accepted-main source text must be read before composing each of the six overlapping documents. Preserve both the accepted main changes and the reviewed #764 contract: explicit tenant parameters in actual SQL predicates; no phantom `ScopedQuery`/`forIdentity` guarantee; gate remains planned/unwired; D1–D4 and the exact allowlist; command-column syntax for the CI parser. Do not transplant the old-base file wholesale or create/apply a different-base net-diff reversion patch. The new executor and both new focused tests are non-overlapping candidate paths in the observed current main tree and can be composed as their own reviewed owner unit, subject to exact source verification.

The review note is append-only historical evidence. Preserve its authentic reports and source hashes. Any current-head attestation should be additive and accurately bound; do not rewrite historic reviewed SHAs or imply 062 was cleared as new product source.

## Minimal safe next composition and gates

1. Wait until prerequisite #782's accepted-main dependency is actually merged and refresh `origin/main`; capture its real accepted SHA. Do not use the open PR's proposed head.
2. Compose only the #764 owner unit onto that accepted main, resolving the six overlapping docs by preserving accepted-main content and the reviewed contract. Preserve `executor.ts` and both tests; no checker/inventory/conversion source belongs in this unit.
3. Verify the final composed diff against both the true accepted main and the reviewed candidate, tracing every commit/file rather than relying on a net diff. Confirm the executor signature/body and both tests byte/semantically match the reviewed versions, and that no PR #782 content was folded wholesale.
4. Because the final current-base SHA is new, obtain the required ordinary and full independent GPT-6 Sol reviews at the exact final SHA for the composition delta as applicable. Then run the exact-head required GitHub checks and image build/boot/health proof required for shipped source. The historical PR764 failure and old green checks cannot be reused.
5. Keep `check:queries` unwired until real conversions are complete; this prerequisite PR is neither checker implementation nor inventory/conversion work. No browser work is implicated by this API/docs candidate.

## Source-conservation questions for conductor

- After #782 is accepted, does the accepted decision-log entry precisely authorize the same D1–D4/tenant-scoping language now under review? Verify before relying on the PR body's #780 citation.
- For each overlapping canonical document, what accepted-main paragraphs postdate the old PR base, and can both be preserved while retaining the full reviewed contract? Escalate only a true normative conflict; do not guess.
- Does the merge retain exactly the executor and test behavior cleared in the historical report, with no change in transaction-handle propagation or test coverage?
- Which required checks and image/runtime proof are required on the actual composed SHA under the then-current rules? Recompute from live CI policy and GitHub.

## Commands used

Read-only: `git status`, `git rev-parse`, `git fetch origin main`, `git merge-base`, `git diff --name-status`, `git merge-tree`, `git log`, targeted `rg`, and `gh pr view 764/782`. No tests, PostgreSQL, Docker, browser, code edits, PR edits, commits, pushes, or merges were run/performed.

### Source report — 764-current-main-preparation-luna-erratum.md

Source SHA-256: `493705a7d78687ad56fd3ad360d5b1704a3996c44591d47baea59b455e401c73`.

# Erratum: PR764 dependency state

This corrects the dependency statement in `764-current-main-preparation-luna.md`; that original packet is preserved unchanged.

The packet incorrectly said PR #780's cited decision was not yet accepted through #782 and recommended waiting for #782. Live accepted `origin/main` is `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`; `git merge-base --is-ancestor d603c068c3f181bc6f3d61a2b86727ed5b9dfe92 origin/main` succeeds. The #780 decision entry is present in `docs/07-planning/decision-log.md` at that accepted main SHA. The live PR764 body says the #780 owner-decision provenance is its only acceptance dependency. Therefore #782 is not a technical prerequisite for #764. The conductor may serialize protected acceptance after #782 to avoid CI churn, but that is scheduling, not source authorization.

A separate normative tension was found while verifying the decision: accepted #780 text says the tenant-scoping convention remains scoped repositories taking resolved identity, documented with `forIdentity(identity)`; the reviewed #764 contract says explicit tenant parameters must appear in the SQL predicate and says no wrapper type is introduced. Both are present in accepted main plus the candidate. The #764 review record explicitly cleared its own contract at `9d7e9a50...`, but it cannot amend accepted #780 authority. This is not resolved by the dependency correction. Do not guess whether #780's wording means a semantic scope convention only or requires a scoped repository API shape. The conductor should decide whether the two statements are compatible under existing contracts or route a precise clarification to the owner before merging #764.

Evidence: `git rev-parse origin/main`; `git merge-base --is-ancestor d603... origin/main`; `rg` and `git show origin/main:docs/07-planning/decision-log.md` around the 2026-10-15 entry; `gh pr view 764 --json body`.

### Source report — 764-authority-adjudication-sol.md

Source SHA-256: `adb47518ac65cb07efa79715bce6b3d75c57f252b9692e14fed4fe379070d4c1`.

# PR #764 / accepted #780: query-scoping authority adjudication

**Role and limit:** Bounded, read-only architecture/compatibility advice for the orchestrator. This is neither an independent merge review nor authorization to merge or implement. I have materially directed a possible documentation reconciliation and therefore cannot independently review that fix. No repository files, PRs, commits, checks, or runtime state were changed.

## Exact source state examined

- Accepted `main`: `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`; #780 is merged with merge commit `d603c068c3f181bc6f3d61a2b86727ed5b9dfe92`. I read accepted files using `git show 09dd5acf:PATH`, avoiding the dirty primary worktree.
- Proposed #764 worktree `/Users/heinthura/.codex/worktrees/q580-b0/Ticketing.v2`: clean at `0627093df3ef9a7cf6784d242642a22cf887a077`. I compared its canonical-document changes to the accepted SHA. Its last commit is review-record-only, and its product contract remains the one reviewed earlier in its branch history.
- The 2026-10-16 `764-current-main-preparation-luna-erratum.md` correctly retracts the original packet's invented #782 prerequisite. The original preparation packet and erratum were read as evidence, not as authority.

## Authority and incompatibility

`CLAUDE.md` § “The control plane, and who owns it” orders sources as “latest Thomas decision in the decision log or authoritative spec → accepted ADR/spec → ... → issue acceptance criteria → status.md/board → PR body”. It also says lower sources never silently override higher ones and that conductor decisions are reversible. `AGENTS.md` do-not 17 says to avoid guessing behavior where the spec does not decide it. These rules permit a conductor to reconcile a proposal *to* accepted authority; they do not permit the proposal to silently reverse accepted authority.

Accepted `docs/07-planning/decision-log.md`, 2026-10-15 “Conductor implementation decisions: query ownership contract and identity admin UI”, records D1–D4 for #580. In the same #580 bullet it explicitly says: “The accepted tenant-scoping convention remains: cross-organisation reads use scoped repositories taking the resolved identity, as documented in `multi-tenancy.md` and illustrated by `forIdentity(identity)` in `monorepo-layout.md`. These query-location and executor choices do not replace that convention or claim the checker proves a universal type-level `forIdentity`/`ScopedQuery` wrapper for every query.” It says the expanded #764 coding-standards text is proposed and “not yet part of accepted main.” The entry’s reversal path is a later conductor or owner entry; none was found in the accepted source examined.

Accepted `docs/01-architecture/multi-tenancy.md` § Query scoping says: “Every query that can return cross-organisation data passes through a scoped repository helper that takes the resolved identity,” then shows `workItems.forIdentity(identity).inProject(projectId).list(filter)`. Accepted `docs/01-architecture/monorepo-layout.md` line 150 likewise says a repository “exposes `forIdentity(identity)` scoped queries.” These are accepted design documents, though their literal wrapper example is not a proven universal type-level guarantee. Accepted `docs/01-architecture/security-model.md` still makes a stronger phantom-type claim; #764 rightly corrects that unsupported enforcement claim. The accepted #780 decision expressly separates the semantic resolved-identity convention from that universal type guarantee.

Proposed #764 `docs/01-architecture/multi-tenancy.md` lines 50–63 instead says a repository may take `workspaceId`, `projectId`, “or the resolved identity,” then explicitly: “This replaces the earlier `workItems.forIdentity(identity).inProject(projectId)` wrapper shape ... (conductor decision recorded in PR #780...).” That attribution is false against the accepted #780 text. Proposed `docs/01-architecture/monorepo-layout.md` lines 149–153 similarly replaces the accepted `forIdentity(identity)` convention with alternate tenant parameters and attributes this to #780. Proposed `docs/04-engineering/coding-standards.md` lines 156–161 and `docs/01-architecture/security-model.md` lines 113–119 allow an id *or* identity and require an SQL predicate; this is valuable as a predicate rule but, if it is the entire cross-organisation-read contract, it no longer requires a repository that takes resolved identity. A bare workspace/project id cannot by itself express a person's resolved reach.

The proposed and accepted texts therefore conflict on **who supplies authoritative scope** and on the claim that #780 replaced the older convention. There is no conflict between scoped repositories taking resolved identity and additionally requiring explicit SQL predicates; there is also no conflict between the resolved-identity convention and admitting that no universal `forIdentity`/`ScopedQuery` type proof or live predicate checker exists.

## Narrow supported reconciliation

The orchestrator can make a reversible, bounded **conformance correction** to #764 without seeking a new Thomas architecture decision: retain D1–D4, `Executor`, the finite allowed-location list, and the planned/unwired status of `check:queries`; require cross-organisation reads to use repository functions/helpers taking the resolved identity and deriving/applying the authorized tenant/reach predicate in the statement. Where a workspace/project id is also needed, it is an additional scope argument and is checked against the resolved identity; it is not an alternative to that identity for this class of read. Describe `forIdentity(identity)` as the accepted illustration/convention, without asserting that a literal fluent API or universal phantom type is already implemented or mechanically enforced. Correct #764's “replaces” sentence and false #780 attribution, and align the corresponding `monorepo-layout.md`, `coding-standards.md`, and `security-model.md` statements. A simple illustrative call could be `listWorkItemsInProject(identity, projectId, filter)` with a documented repository predicate derived from the identity and authorized project; no new implementation shape is mandated by this advice.

If the intended #764 rule instead permits a cross-organisation read to take only an unchecked `workspaceId`/`projectId`, or intends to retire the resolved-identity scoped-repository convention itself, that is a **new architecture decision** contradicting accepted #780 and the accepted specs. Stop that decision path and ask Thomas whether to supersede the resolved-identity requirement, with the security consequences and replacement reach proof stated explicitly and recorded in the decision log/spec. The present evidence does not authorize that reversal. Thomas need not be asked merely to permit the compatible conformance correction above.

## Prior reviews and practical consequence

The #764 review note and source reports (notably `764-tenant-paragraph-delta-luna.md` and the full `764-security-final-sol.md`) cleared the candidate's internally consistent explicit-parameter wording at `9d7e9a50364f503ceb96b939fa8a23b2c6b6a42d`. The ordinary report explicitly treated the wrapper as replaced; the Sol report notes #780 was still open at review time. Those reviews did not adjudicate the *accepted* #780 wording at current main, and their source clearance cannot amend it. The current candidate `0627093d...` also has not been reviewed as a fresh composed head on accepted `09dd5acf...`.

This is a blocker to merging #764 unchanged. Composition onto accepted main, the corrected contract, independent exact-head review, required checks, and any applicable runtime evidence remain the orchestrator's work. This report supplies no clearance for those gates.

### Source report — 764-current-main-composition-luna.md

Source SHA-256: `2454bca80463f978a6e1e3bf37d1e7994575578293db58c9404abf82181cf895`.

# PR764 current-main composition (author handoff)

Prepared 2026-10-16 by the bounded authoring lane. This records composition and local checks; it is not an independent review, merge approval, hosted CI result, image proof, or runtime acceptance.

## Result and exact source

- Local branch: `codex/query-ownership-580-b0` in the retained worktree `/Users/heinthura/.codex/worktrees/q580-b0/Ticketing.v2`.
- Current exact head: `ca30c08d11807bee1346eb62693e2097e55b7f78` (`docs: conform query scope to accepted identity convention`).
- Parent is local merge commit `77c855ff38d3df93a3ffbfa9b3049db906af35f6`, whose parents are original candidate `0627093df3ef9a7cf6784d242642a22cf887a077` and accepted main `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`. Accepted #780 commit `d603c068c3f181bc6f3d61a2b86727ed5b9dfe92` is included in that main ancestry.
- Worktree is clean after the author commit. No push, PR body update, or merge to main was performed.
- `git diff --name-status 09dd5acf..ca30c08d` contains the same ten PR764 paths: executor, its two original tests, six canonical documents, and the existing review note. Main’s other accepted files entered only through the normal merge commit. No #782 files were cherry-picked or imported.

## Resolution of the six canonical documents

- `docs/01-architecture/monorepo-layout.md`: keeps the accepted rule that cross-organisation reads use repository functions taking resolved identity; `forIdentity(identity)` is the illustration/convention. Additional workspace/project IDs are checked against identity and included in the predicate. Removes the claim that #780 replaced this convention. The checker remains planned/unwired.
- `docs/01-architecture/multi-tenancy.md`: restores the resolved-identity scoped-repository requirement. The example takes identity and an additional project ID; it says the ID narrows the query only after checking against identity. Retains the accepted `forIdentity(...).inProject(...)` illustration as convention, while disclaiming a universal implemented fluent API/type guarantee. Adds the planned/unwired query-location gate explanation and distinguishes it from predicate correctness.
- `docs/01-architecture/security-model.md`: makes resolved identity authoritative for caller reach, requires applying it in the SQL predicate, treats workspace/project IDs as additional checked scope, and rejects a universal `forIdentity`/`ScopedQuery` type theorem. Preserves the existing RLS backstop text.
- `docs/01-architecture/tech-stack.md`: retains the accepted-main context and updates the query checker row to say planned/not wired, linking the coding-standards contract.
- `docs/04-engineering/ci-cd.md`: normal merge retained accepted-main additions describing planned entries and enabled checks. The PR764 row remains `pnpm check:queries` with “planned — not wired (#580)”, so the parser sees the command without implying it runs.
- `docs/04-engineering/coding-standards.md`: retains D1–D4 and the exact 14 infrastructure paths, repository filename patterns, no wildcard/per-site baseline, executor conventions, and unwired status. Tenant scoping now requires resolved identity plus a caller-reach predicate; any extra tenant ID is checked against identity and also appears in the predicate. The false `forIdentity`-replacement framing was removed.

Accepted main’s image helper, CI/release changes, status/queue/decision records and other files were brought in unchanged by the merge. The merge had no unresolved textual conflict. No blanket `database/**` exception was added. `check:queries` remains not enabled in the actual local gate listing.

## Source conservation

The executor and both tests compare byte-identically with their versions at original candidate `0627093df3ef9a7cf6784d242642a22cf887a077` (`git diff --quiet 0627093..HEAD -- <three paths>` exit 0). No production callers, conversions, checker, route, schema, capability, dependency, or feature scope was added. The authentic `docs/07-planning/security-reviews/764-query-ownership.md` was not edited; historic reports and reviewed SHAs remain unchanged.

The only post-merge author commit is `ca30c08d...`, changing four documents (`monorepo-layout.md`, `multi-tenancy.md`, `security-model.md`, `coding-standards.md`). The `tech-stack.md` and `ci-cd.md` updates were already present in the original candidate and survived the normal merge along with accepted-main additions.

## Checks actually run

- Focused unit test: `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/database-executor.test.ts` — 1 file, 4 tests passed.
- `pnpm check:policy` — passed, 8 policy files coherent.
- `pnpm test:all --list` — exited 0; reports `pnpm check:queries` as **not enabled**; 0 passed, 0 failed, 5 not enabled yet.
- `git diff --check` on the working tree passed before commit. `git diff --check origin/main..HEAD` reports existing trailing spaces and a final blank line in the preserved authentic security-review note. That note was explicitly out of write scope and was not “cleaned up.”
- `git status --porcelain=v1` after commit was empty.

## Limits and next gate

No Postgres/integration run, Docker build/boot/health, browser, image evidence, or hosted status checks were performed. The original source’s integration test report is historical and remains bound to its reviewed SHA. The merge introduced accepted-main changes beyond the narrow executor contract, so the final head requires the fresh independent ordinary review and full GPT-6 Sol review specified by policy, followed by required hosted CI and applicable image/runtime evidence before acceptance. This author handoff cannot serve as any of those reviews.

### Source report — 764-current-ordinary-a-luna.md

Source SHA-256: `48a5bed8b8d8879d3313311cb1055a5d0e652c161423ba3505dc6178003f82ee`.

# PR #764 current-main ordinary review A

**Role:** Fresh independent ordinary reviewer; did not author, direct, or remediate this candidate.
**Model dispatch:** Explicit GPT-6 Luna selection for this review. No serving-version attestation is claimed.
**Reviewed head:** `ca30c08d11807bee1346eb62693e2097e55b7f78`
**Comparison base:** accepted `main` `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`
**Verdict:** **APPROVE** for ordinary-review scope; no blocking findings.

## Scope checked

I verified the clean retained worktree at the exact reviewed SHA and inspected the complete base-to-head diff across all ten paths: `apps/api/src/database/executor.ts`; the unit and integration executor tests; `monorepo-layout.md`, `multi-tenancy.md`, `security-model.md`, `tech-stack.md`, `ci-cd.md`, and `coding-standards.md`; and the new `docs/07-planning/security-reviews/764-query-ownership.md` record. I read `AGENTS.md`, `CLAUDE.md`, the active mission, `agent-workflow.md`, and the accepted-main decision-log entry governing #580. I used both supplied packets as leads and checked their material claims against accepted/current source.

## Findings

- The current docs preserve the accepted semantic convention: cross-organisation reads use repository functions that receive resolved identity and apply caller reach in the SQL predicate. An extra workspace/project ID narrows the query only after validation against that identity and appears in the predicate. `forIdentity(identity)` remains an illustration/convention; no universal fluent API or phantom-type guarantee is asserted. This matches accepted `docs/07-planning/decision-log.md` at the comparison base and the accepted multi-tenancy/monorepo documents. The false claim that #780 replaced the convention has been removed.
- D1–D4 are bounded and consistent: transaction statements use repositories accepting the transaction handle; raw `execute`/`sql` and fragments are in scope; repository paths are the three named forms; persistence infrastructure is a closed list of 14 explicit top-level files; `apps/api/scripts/**` is excluded. The 14 names match the current top-level files in `apps/api/src/database/` exactly. There is no `database/**` exception or per-site baseline. The example database repository matches a named repository pattern.
- The executor implementation returns a supplied handle unchanged and falls back to shared `db` only when omitted. Its types include both the shared database and Drizzle transaction handle, and the tests cover supplied/default handles, type surface, and transaction visibility/rollback. The integration test is meaningful for propagation and rollback.
- All six canonical docs now consistently label `check:queries` planned/unwired and distinguish query-location enforcement from tenant predicate correctness. The CI table retains the parser-visible `pnpm check:queries` command. The local manifest confirms `run: null`; no active checker is claimed.
- The new review-record file is the only review-note path in the diff; no pre-existing historic note was edited. The executor and both tests are byte-identical to the original candidate versions, so this composition did not alter source/test behavior. The four-document correction restores conformance to accepted identity semantics.

## Checks actually run

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/database-executor.test.ts` — 1 file, 4 tests passed.
- `pnpm check:policy` — passed; 8 policy files coherent.
- `pnpm test:all --list` — exited 0; 40 declared gates reconcile, `check:queries` is not enabled (0 run, 0 failed, 5 not enabled).
- Compared the exact D3 list with top-level `apps/api/src/database/` files — exact 14-file match.
- `git diff --check 09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6..HEAD` — clean for the diff. The repository is clean at the reviewed head.
- Verified product executor/test files are byte-identical between original candidate `0627093df3ef9a7cf6784d242642a22cf887a077` and current head.

## Limits and residuals

I did not run the Postgres integration test, typecheck, Docker build/boot/health, browser verification, full suites, hosted CI, or inspect live PR metadata. The checker is planned and does not enforce D1–D4 yet; query predicate correctness remains a source/test/review obligation. These limits do not reveal an ordinary-review blocker in the bounded contract/composition, but this report is not the required security review, hosted-check evidence, image/runtime acceptance, or merge clearance. The preserved historical review material was checked as a newly added record path; I did not independently re-authenticate every embedded historical report.

### Source report — 764-current-ordinary-a-luna-erratum.md

Source SHA-256: `2f87609096e9798d23c864db76fc61ae0470edebf1f7342887ec437ccae3ce6d`.

# PR #764 current-main ordinary review A — whitespace-check erratum

**Applies to:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/764-current-ordinary-a-luna.md`
**Candidate:** `ca30c08d11807bee1346eb62693e2097e55b7f78` against accepted base `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`

The original report incorrectly said `git diff --check 09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6..HEAD` was clean. I reran the exact comparison with the candidate SHA pinned: it exits **2**. It reports preserved trailing hard-break spaces in the raw historical reports carried in `docs/07-planning/security-reviews/764-query-ownership.md` (lines 128–131, 189–191, 224–226, 314–316, 400–402, and 476–477), plus the file's final blank line at line 535. These bytes were intentionally preserved; I did not edit or normalize them.

To scope the check to the rest of the candidate, I ran:

`git diff --check 09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6..ca30c08d11807bee1346eb62693e2097e55b7f78 -- . ':(exclude)docs/07-planning/security-reviews/764-query-ownership.md'`

That excluded-path check exits **0** with no findings. The earlier report's phrase “clean for the diff” was too broad and is corrected here: the complete candidate diff is not whitespace-clean because the preserved raw review text contains those findings; the remainder of the diff is clean.

This correction does not change the ordinary-review verdict. The whitespace findings are confined to preserved historical report formatting in the review record and do not change the candidate's product or canonical contract semantics. No blocker was found in the ordinary-review scope. The original report remains untouched, the candidate SHA is unchanged, and no repository or review-note edits were made.

### Source report — 764-current-ordinary-b-luna.md

Source SHA-256: `1e650a602b65f6f068503c8307babba264d20e6c74d0bad2f93300bd5341a6a7`.

# PR #764 current-head ordinary review B

**Verdict: APPROVE; no blocking findings.**

**Reviewed head:** `ca30c08d11807bee1346eb62693e2097e55b7f78`  
**Comparison base:** accepted `main` `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`  
**Model / role / independence:** GPT-6 Luna, explicitly assigned fresh independent ordinary reviewer context; I did not author, direct, or remediate this candidate. No platform-reported serving-version attestation was available, so none is claimed.  
**Worktree:** `/Users/heinthura/.codex/worktrees/q580-b0/Ticketing.v2`, clean at the reviewed head before and after the read-only review. No repository edits or commits were made.

## Scope and checks

Inspected all ten changed paths: `apps/api/src/database/executor.ts`; both database-executor tests; the six architecture/engineering contract files; and `docs/07-planning/security-reviews/764-query-ownership.md`. Read `AGENTS.md`, `CLAUDE.md`, and `docs/04-engineering/agent-workflow.md`, and checked the accepted-main decision-log convention and current gate inventory.

Commands and results:

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/database-executor.test.ts` — 1 file, 4 tests passed.
- `pnpm check:policy` — passed, 8 policy files coherent.
- `node scripts/ci/test-all.mjs --list` — `pnpm check:queries` is explicitly **not enabled**; 40 gates listed, 5 not enabled.
- `git diff --check` across the nine code/contract paths — passed. The preserved historic review-note file was excluded because its original whitespace is part of the record.
- Verified HEAD is a descendant of accepted main through merge commit `77c855ff38d3df93a3ffbfa9b3049db906af35f6`, whose parents are original candidate `0627093df3ef9a7cf6784d242642a22cf887a077` and accepted main `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`. The base-to-head changed-path list is exactly the ten PR paths; no accepted-main-only path is lost from the composed tree.

No Postgres integration test, Docker, browser, full suite, or PR/hosted action was run, per assignment.

## Findings

**Blocking:** none.

The executor contract is implemented narrowly and matches its intended calling convention. `Transaction` is derived from the transaction callback handle, `Executor` is the shared `DatabaseInstance` or that transaction handle, and `executorOrDefault` returns a supplied handle unchanged or falls back to the shared connection only when absent. The unit tests cover identity of the returned handle, fallback behavior, and the shared query surface. The historical integration test source checks commit visibility and rollback behavior, but I did not rerun it because it requires the prohibited Postgres runtime.

The accepted resolved-identity requirement is retained in all relevant current contract docs: a cross-organisation repository query takes resolved identity, derives/applies caller reach in its SQL predicate, and checks any additional workspace/project id against that identity and in the predicate. `forIdentity(identity)` is described as the accepted convention/example without claiming a universal wrapper type. This conforms to the accepted #780 decision as clarified by the adjudication packet.

D3 has no blanket `apps/api/src/database/**` query exception. It names the repository patterns and enumerates the 14 infrastructure files, and states that new database files must be named as repositories or added through a reviewed change. The statement preserves the reviewed bounded rule and does not add per-site allowances or a baseline.

CI status is represented accurately in the docs and the live local gate inventory: `check:queries` is planned and not wired. The documents also correctly limit that future location check to query ownership rather than asserting it proves tenant predicates.

**Non-blocking residual:** `Executor` intentionally exposes the Drizzle query surface, including `transaction`; TypeScript does not prevent a repository from opening a transaction on a supplied handle or returning an un-awaited builder. The contract states these as repository requirements, while the planned location checker is not yet wired and does not establish tenant-predicate or result-shape correctness. The current docs are candid about these enforcement limits, so this is not a defect in this bounded executor/contract slice; later enforcement and implementation batches must preserve the stated boundaries.

## Limits

The executor unit test and policy/gate inventory were rerun at the exact head. Integration behavior is supported here by source inspection and prior historical reports only; those reports are not fresh runtime evidence for this head. This ordinary review does not substitute for the required security review, hosted checks, image/runtime evidence, or merge decision.

### Source report — 764-current-security-sol.md

Source SHA-256: `ed93656ae819cc8fcc6752176d58faf1fff9c68de31415e7fd8f820d0f25d1ca`.

# PR #764 current-main composition — independent full security review

**Verdict: CLEAR at exact candidate `ca30c08d11807bee1346eb62693e2097e55b7f78` against accepted base `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`. No blocking finding in this bounded batch-0 source and contract.** This verdict covers the composed candidate, not activation or acceptance of the future `check:queries` gate, existing repository migrations, live PR status, hosted checks, or runtime acceptance.

**Role and provenance:** Fresh independent full security-review context, explicitly selected as `gpt-6-sol` with `fork_turns=none` by the conductor. I did not author, direct, adjudicate, or remediate this candidate and performed neither current ordinary review. I have no platform serving-version introspection; the model label records explicit dispatch, not an independently measured version. The conductor's prior conformance direction and the architecture adjudication packet are not independent review evidence. I made no repository edit, commit, push, or PR action.

## Scope and security judgment

I read the accepted AGENTS/workflow/active mission/model adapter, accepted #780/#580 decision-log entry, original accepted multi-tenancy and monorepo contract, all ten base-to-head changed paths, the historical #764 review record, the two current ordinary reviews and A's whitespace erratum, and the advisory composition and adjudication packets. I checked their material claims against source. The changed paths are the new executor, its unit and integration tests, six canonical architecture/engineering documents, and the preserved historical security-review note. The worktree was clean at the reviewed head. The executor and both tests are byte-identical to original candidate `0627093df3ef9a7cf6784d242642a22cf887a077`.

**Authority and tenancy.** The accepted #780/#580 decision requires cross-organisation reads to use repositories taking resolved identity; `forIdentity(identity)` illustrates that convention without promising a universal implemented fluent API or phantom type. Current `multi-tenancy.md`, `monorepo-layout.md`, `security-model.md`, and `coding-standards.md` preserve that requirement. They additionally require caller reach derived from identity in the statement predicate; a supplied workspace/project ID must be checked against identity and included as a narrower predicate. This closes the earlier proposed wording that treated a bare tenant ID as an alternative authority and falsely said #780 replaced the convention. The docs distinguish query location from predicate correctness and do not claim that the checker proves tenancy. No route, role, policy, schema, capability, identity resolver, query caller, or production read/write path changes in this candidate; the new helper cannot itself grant reach.

**Statement ownership and bypass surface.** D1–D4 permit transaction opening as service orchestration but require each statement inside it to use a repository receiving the handle; raw `execute`/`sql` and fragments are included. Repository locations are the three explicit filename/path forms, and persistence infrastructure uses a closed list of fourteen top-level `apps/api/src/database/` files; there is no blanket `database/**` exception, per-site allowlist, or baseline. A new file must be named as a repository or added to the finite infrastructure list in a reviewed change. `apps/api/scripts/**` is excluded as dev/seed tooling. This is a documented future gate contract, not a currently enforced structural invariant. I found no newly introduced bypass in the current source or a claim that current inherited queries have been converted.

**Transaction handle.** `Transaction` is derived from the callback parameter of `DatabaseInstance["transaction"]`, `Executor` is that handle or the shared database instance, and `executorOrDefault` returns a supplied handle unchanged or shared `db` when omitted. A repository can therefore keep all statements in the caller's transaction. The unit test checks identity/fallback and type surface; the authored integration test checks uncommitted visibility, rollback, and commit behavior. TypeScript does not force callers to pass the handle or prevent repository code from opening a nested transaction or returning a builder. Those are explicit contract requirements, with enforcement left to later work; this bounded helper does not misrepresent them as proven.

**Gate and accepted-main conservation.** The `ci-cd.md` table retains the parser-visible `pnpm check:queries` name with “planned — not wired (#580)”. The manifest has `run: null`, and `.github/workflows/ci-fast.yml` says it has no job. The current wording does not silently activate, waive, or weaken a required check. The composed head descends from accepted main; the base-to-head diff has only the ten #764 paths. No accepted-main-only path is lost. The authentic historical review note remains byte-preserved, including older reviews of an earlier internally consistent contract; those historical verdicts do not substitute for this current-main assessment.

## Checks actually run

- `git rev-parse HEAD` returned `ca30c08d11807bee1346eb62693e2097e55b7f78`; `git status --porcelain=v1` was empty. `git merge-base --is-ancestor 09dd5acf... ca30c08d...` exited 0. `git diff --quiet 0627093d... ca30c08d...` on the executor and two tests exited 0.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/database-executor.test.ts` passed 1 file / 4 tests.
- `pnpm check:policy` passed (8 coherent policy files).
- `pnpm test:all --list` exited 0 and reconciled 40 gate entries; `pnpm check:queries` is explicitly **not enabled**, with 0 passed / 0 failed / 5 not enabled.
- `git diff --check` over the nine code/canonical-contract paths exited 0. The full base-to-head command exited 2 only for preserved Markdown hard-break spaces and the final blank line in the historical review record, as independently corrected in ordinary A's separate erratum. I did not edit that authentic record or describe the full diff as whitespace-clean.

## Findings, limits, and disposition

**Blocking findings:** none. **Non-blocking residual:** the query-location gate is unwired, and even its eventual location check cannot establish the tenant predicate or the repository result-shape/handle conventions. Future #580 batches must implement and test their own enforcement without treating this batch-0 clearance as proof of whole-program query safety. The historical review note contains prior adverse and superseded reasoning; retaining it is evidence preservation, not current authority.

No PostgreSQL integration test, Docker build/boot/health, browser, full suite, live PR metadata query, hosted status check, or runtime security exercise was performed for this review. The integration test's prior run is historical evidence bound to its source. The conductor still must verify publication/provenance, exact remote head, required current hosted checks, and applicable image/runtime gates before any protected merge. This security verdict is not merge authorization by itself.

## Accepted782 main import

**Reviewed head:** abe66d8ef8d52d6eb4d51fc72320ce612359916c

Accepted main dfbb3e46e0a1a40cfd5106b00c0bd26138fb950e is normally merged. Three incoming paths match accepted main; all ten unique764paths remain byte-identical to prior296485fb publication. The two ordinary and full independent Sol conformance reviews remain at ca30. A strong independent ordinary import review and separate lightweight independent Sol confirmation clear this later accepted import. Author handoff is not independent review; raw report versions are not approval counts. Current publication-SHA checks and image proof remain pending; older296 evidence is not transferred.

### Source report — 764-accepted-782-main-composition-luna.md

Source SHA-256: `46d703ccbbf199cc92d2bbd0dd50e9ca376b1c66790bfd8256a56cac401d3b72`.

# PR764 accepted #782-main import (author handoff)

Prepared 2026-10-16 by the bounded authoring lane. This is a local history/conservation handoff only. It is not a review, CI result, runtime proof, PR update, or merge approval.

## Exact state

- Retained worktree: `/Users/heinthura/.codex/worktrees/q580-b0/Ticketing.v2`
- Branch: `codex/query-ownership-580-b0`
- Before merge: clean at `296485fb1e1f583bad04474530dbefac4c98f3f3`, tracking remote at that same SHA.
- Accepted main before merge: `dfbb3e46e0a1a40cfd5106b00c0bd26138fb950e` (`origin/main`), the protected #782 merge commit. Its tree is identical to #782 source `b407e3f82028952139b16ff9cd5cf97892fd4a7a` (`git diff --exit-code b407... dfbb...` passed).
- Local normal merge commit: `abe66d8ef8d52d6eb4d51fc72320ce612359916c`; parents are exactly `296485fb1e1f583bad04474530dbefac4c98f3f3` and `dfbb3e46e0a1a40cfd5106b00c0bd26138fb950e`.
- Worktree is clean. No push, PR edit, or main merge was performed.

## Conservation proof

The accepted-main delta from the prior #764 source contains exactly these three paths, all byte-identical to their blobs on accepted `dfbb3e46...`:

1. `docs/03-features/webhooks-and-api-keys.md` — blob `016614f23321ad38e618030eeaf3a6c9668c6923`
2. `docs/07-planning/reviews/2026-09-05/features-governance-design.md` — blob `92d02b53d82ca2fe58017ff869ed8f07f382012b`
3. `docs/07-planning/security-reviews/782-webhooks-review-disposition.md` — blob `2aa4c7897477efeff57ea0772e3f27f7d6a6d5cc`

All ten unique PR764 paths have the same blobs on `296485fb...` and the merge result `abe66d8...`; each comparison returned `UNCHANGED`: executor; unit and integration tests; `monorepo-layout.md`, `multi-tenancy.md`, `security-model.md`, `tech-stack.md`, `ci-cd.md`, `coding-standards.md`; and the authentic `764-query-ownership.md` review note. The resolved-identity correction and finite D1–D4/14-file contract remain byte-for-byte frozen. No behavior or contract edit was made.

`git status --porcelain=v1` is empty. `git diff --name-status 296485fb... abe66d8...` lists only the three accepted-main paths above.

## Checks and limits

- No product source or test changed, so no unit/integration/build suite was rerun.
- `git diff --check 296485fb... abe66d8...` reports preserved trailing Markdown hard-break spaces and a final blank line in the newly imported authentic #782 review note. Its blob matches accepted main exactly; it was not normalized or edited. No other files are named by that command's findings.
- The previously running hosted Postgres check was tied to the old remote head `296485fb...`; it is not evidence for local merge head `abe66d8...`. No result is claimed for the local merge. No Postgres, Docker, browser, or full suite was run here.
- The original ordinary A/B and full Sol clearances remain bound to `ca30c08d11807bee1346eb62693e2097e55b7f78`. This import needs the planned independent ordinary and lightweight Sol review of the exact merge delta/head; this author handoff fills neither role.

No PR #795 worktree or other lane was touched. Source is frozen at `abe66d8ef8d52d6eb4d51fc72320ce612359916c` for the independent import-delta review.

### Source report — 764-accepted-782-main-ordinary-luna.md

Source SHA-256: `602c8f2b790c9e87c2555ae53cff60346ff7a1fc2cd8fda291b7a7a6985dc2c0`.

# PR #764 accepted-main import — ordinary delta review

**Verdict: CLEAR for the bounded accepted-main import; no blocking findings.**

**Reviewed head:** `abe66d8ef8d52d6eb4d51fc72320ce612359916c`  
**Previously reviewed publication:** `296485fb1e1f583bad04474530dbefac4c98f3f3`  
**Accepted main:** `dfbb3e46e0a1a40cfd5106b00c0bd26138fb950e`  
**Merge parents:** exactly the prior publication and accepted main, in that order.  
**Model / role / independence:** GPT-6 Luna was explicitly selected for this bounded independent import-delta review. This is the same reviewer context that performed ordinary B on the parent candidate; that prior review does not cover this new import. I did not author, direct, or remediate the import. No serving-version attestation is claimed.  
**Worktree:** `/Users/heinthura/.codex/worktrees/q580-b0/Ticketing.v2`, clean at the reviewed head. No files or Git history were modified.

## Scope and evidence

The candidate is a normal two-parent merge commit. The direct `296485...` to `abe66d8...` difference is exactly these three accepted-main paths:

1. `docs/03-features/webhooks-and-api-keys.md`
2. `docs/07-planning/reviews/2026-09-05/features-governance-design.md`
3. `docs/07-planning/security-reviews/782-webhooks-review-disposition.md`

For each path, the blob at the reviewed head equals the blob at accepted main `dfbb3e46...`. The diff content confirms the incoming webhook/API-key spec additions, design-review disposition, and authentic #782 review note are the accepted-main content.

I independently compared all ten unique #764 paths at prior publication `296485...` and current head `abe66d8...`. Every path is byte-identical by Git blob ID: `executor.ts`; the unit and integration executor tests; `monorepo-layout.md`, `multi-tenancy.md`, `security-model.md`, `tech-stack.md`, `ci-cd.md`, `coding-standards.md`; and `764-query-ownership.md`. Thus the corrected resolved-identity contract, bounded D1–D4/14-file infrastructure list, executor/tests, and original review record remain unchanged. No candidate-specific implementation, test, tenant authority, gate behavior, or other runtime semantics were introduced by the merge beyond the accepted-main import.

Read-only commands used: `git show`, `git diff`, `git rev-parse` blob comparisons for all 13 paths, ancestry/parent verification, `git diff --name-only`, `git diff --check`, and `git status --porcelain=v1`. No product or test delta existed, so no tests were run. No Postgres, Docker, browser, full suite, or hosted/PR action was run.

`git diff --check 296485...abe66d8` reports trailing Markdown whitespace on lines 141–143, 168–169, and 211–213, plus a final blank line in the imported #782 authentic review note. The same file is byte-identical to accepted main; these are preserved report bytes, not a new import edit. I do **not** claim the whole-range diff is whitespace-clean and did not normalize the raw note.

## Limits

This review establishes only history conservation and absence of candidate-specific behavior or gate changes in the accepted-main import. Any historical Postgres result at `296485...` remains bound to that old SHA and is not current-head evidence for `abe66d8...`. This report is not a security review, runtime acceptance, hosted-check result, or merge authorization.

### Source report — 764-accepted-782-main-security-sol.md

Source SHA-256: `3441e0d2c5fbc5492e8d02acfa8a081d3f12e17d9cdc2eb9945b49aed06d9ce5`.

# PR #764 accepted-#782-main import — independent security delta confirmation

**Verdict: CLEAR for the lightweight import delta at exact local head `abe66d8ef8d52d6eb4d51fc72320ce612359916c`, compared with prior #764 publication `296485fb1e1f583bad04474530dbefac4c98f3f3` and accepted main `dfbb3e46e0a1a40cfd5106b00c0bd26138fb950e`. No blocking finding.** The earlier full security review at `ca30c08d11807bee1346eb62693e2097e55b7f78` covers the unchanged #764 source/contract; this confirmation covers only the later import of already accepted #782 material. It is not current-head runtime or hosted-check clearance.

**Role/provenance:** Fresh independent security-review context, explicitly dispatched as `gpt-6-sol` with `fork_turns=none`. I did not author, direct, adjudicate, or remediate the #764 source, the #782 content, or this merge. I previously conducted the full independent #764 security review but did not perform the current ordinary import review. No platform serving-version introspection is available; this records the explicit selector, not an invented runtime attestation. The conductor's author/adviser reports were treated as leads and reverified against Git. I made no source edit, commit, push, PR action, or merge.

## Scope and direct evidence

`git show -s --format='%H%n%P%n%s'` shows `abe66d8...` is a normal merge with parents `296485fb...` and `dfbb3e46...`, in that order. The worktree was clean at `abe66d8...`. `git diff --name-status 296485fb... abe66d8...` names only three accepted-main paths: `docs/03-features/webhooks-and-api-keys.md`, `docs/07-planning/reviews/2026-09-05/features-governance-design.md`, and `docs/07-planning/security-reviews/782-webhooks-review-disposition.md`. I compared their Git blob IDs at the candidate and accepted main; all three are exact matches (respectively `016614f23321ad38e618030eeaf3a6c9668c6923`, `92d02b53d82ca2fe58017ff869ed8f07f382012b`, `2aa4c7897477efeff57ea0772e3f27f7d6a6d5cc`). Accepted main is an ancestor of the candidate.

I independently compared all ten unique #764 paths at prior publication and the merge result by blob ID. Every one is byte-identical: executor, unit and integration tests, `monorepo-layout.md`, `multi-tenancy.md`, `security-model.md`, `tech-stack.md`, `ci-cd.md`, `coding-standards.md`, and the authentic `764-query-ownership.md` review note. Thus the prior reviewed resolved-identity tenant-scoping rule, checked narrower ID/predicate requirement, D1–D4 finite query-location contract, fourteen-file infrastructure list, planned/unwired checker status, transaction handle, tests, and historical review record are unchanged. There is no candidate-specific authority change, gate activation, bypass, query caller change, or API runtime change in this import.

I inspected the incoming diff, not just the filenames. It adds accepted #782 webhook/API-key spec facts, a self-row write boundary, named future security tests, scope/exclusions and open-issue references; the design-review register maps historical findings; and the third path preserves the accepted #782 security-review record. These are normative spec and review documents already present on accepted main, with no change to #764's query-ownership documents or its product source. They do not assert that the #580 checker runs, that API-key/webhook runtime is implemented, or that the #764 executor provides any new authority. I found no cross-contract conflict requiring a fresh full security review of the unchanged #764 portion.

## Checks, findings, and limits

Read-only Git checks: exact SHA/parents/status, both parent diffs, ancestry, all thirteen path blob comparisons, direct diff inspection, and scoped/full `git diff --check`. The diff check excluding the imported authentic #782 review note exited 0. The full `296485...abe66d8` check exited 2 solely for preserved Markdown hard-break spaces and a final blank line in that imported note, which is byte-identical to accepted main; I did not normalize or call the full diff whitespace-clean. The `dfbb...abe66d8` check similarly reports preserved historical formatting in the #764 note. **Blocking findings: none. Non-blocking finding:** inherited raw review-note whitespace is retained as authentic publication, with no semantic effect on this import.

No unit, PostgreSQL, Docker, browser, full suite, hosted CI, or live PR action was run for this pure accepted-main import. Historical image proof (125 UID-10001 health/cleanup) and the old hosted PostgreSQL run at `296485fb...` are not current-head acceptance evidence for `abe66d8...`. Required exact-head hosted checks, current remote/publication identity, and any applicable image/runtime evidence remain the conductor's responsibility before a protected merge. This report is a security delta confirmation, not merge authorization.
