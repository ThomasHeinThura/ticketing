# Issue #580 — unwired structural checker preparation

**Reviewed head:** `4a69fc25194622494a7c1102b9f86f42e6b58edf`

Current strong ordinary delta and fresh full independent Sol adjudication are clear for the two-file checker preparation. The earlier ordinary and security blockers remain below unchanged. The repeated-class altitude rule was applied after the module-symbol/type-graph redesign; the later bounded path correction received a strong ordinary review before the final full Sol pass. No reviewer authored the candidate. Current contexts were explicitly dispatched as GPT-6 Luna and GPT-6 Sol; visible runtime identity may be generic GPT-6, as stated in their original reports.

The checker remains unwired: no package command, test-all row or workflow invokes it as the production ownership gate. Its fixture tests are discovered by the existing CI-scripts test glob. A fresh frozen-install-only focused run passed 3/3 without package builds; the complete hosted CI-scripts job is separate. This is location/type ownership and public builder/fragment-escape analysis, not proof of tenant predicates or complete handle propagation.

The contract source is reviewed #764 head `0627093df3ef9a7cf6784d242642a22cf887a077`; #764 and the #780 decision carried by #791 are still unaccepted prerequisites. No checker activation, #580 completion, merge acceptance or stage claim follows from this preparation.

Population correction: pre-repair counts such as 5,985 used broken infrastructure path classification and cannot measure progress. The corrected author scan at the reviewed head reported 5,619 diagnostic sites over 272 production files (5,601 location reports and 18 public boundaries), with zero infrastructure-location violations. These are diagnostic sites, not unique queries, and the production scan is expected red while conversions remain incomplete.

---

## Retained evidence file — 580-query-checker-preparation-luna.md

Origin SHA-256: `b65b9e1954a8d06cf89ccc0e42de03859863fe23b8e2afa38ccda566fff4ec62`.

# #580 query checker preparation handoff

Prepared by Luna on 2026-10-15. This is an **unwired tooling-preparation branch**, not completion of #580 and not evidence that production queries have been converted.

## Exact checkout and candidate

- Worktree: `/Users/heinthura/.codex/worktrees/query-checker-580`
- Branch: `codex/query-checker-580-prep`
- Base: `e9df2294fa580fd2885343bbef0cec28e81ead4c`
- Commit: `7d665191d0461be0b54bdcb27ec6ff935631bafe` (`feat(ci): add unwired query ownership checker`)
- Working tree clean after commit. No push or PR.
- Exactly two added files: `scripts/ci/check-queries.mjs` and `scripts/ci/check-queries.test.mjs`.

## Contract and implementation

The checker implements the accepted #580 D1-D4 location and structural ownership contract only. `check-queries.mjs:34-51` lists the **exact 14** persistence-infrastructure files; `isRepositoryPath` at lines 53-60 adds the named repository patterns. There is no `database/**` wildcard, environment override, exclusion list, or baseline. Production scanning is limited to `apps/api/src`; test/dev/declaration paths are excluded at lines 720-728.

The TypeScript 7 native API scan resolves Drizzle and `pg` types and detects direct and aliased/computed/optional/chained calls, builder and SQL-fragment construction, relational queries, common function escape forms, raw pg pool/client access, typed transaction handles, and exported query-builder escapes. Parse errors, semantic diagnostics, and unresolved/error-typed handles fail closed. A transaction opening is allowed as orchestration; calls in its callback still need repository ownership. Tests include 21 typed source fixtures: 16 specific ownership-violation cases (each asserts the named ownership violation rather than accepting a generic parse/type failure), 3 separate fail-closed cases (unresolved handle, semantic type error, syntax error), and 3 valid repository/transaction/transaction-opening positives. The second test checks all 14 explicit infra names plus the denied `database/new-file.ts` and `database/helper.ts` cases and repository naming.

This checker makes **no claim** to prove that repository predicates enforce the correct tenant scope, nor that every executor/transaction handle is propagated correctly across arbitrary interprocedural flows. Those remain obligations of the source conversions and their real tests under D1-D4. The checker also is not wired into `package.json`, `test:all`, a workflow, or any activation path, as explicitly required for preparation.

## Validation and observed API result

- `pnpm exec biome check --write scripts/ci/check-queries.mjs scripts/ci/check-queries.test.mjs` completed; subsequent `pnpm exec biome check scripts/ci/check-queries.mjs scripts/ci/check-queries.test.mjs` passed.
- `node --check scripts/ci/check-queries.mjs` and `node --check scripts/ci/check-queries.test.mjs` passed.
- `node --test scripts/ci/check-queries.test.mjs`: 2 tests passed, 0 failed. The fixture API reports the named ownership failures and accepts the transaction and repository positives.
- Built workspace declarations needed by the real TypeScript program with `pnpm --filter @taskdesk/domain --filter @taskdesk/permissions --filter @taskdesk/email run build`.
- `node scripts/ci/check-queries.mjs` on accepted-main source then exited 1 as expected: **3,916 diagnostic instances across 256 API source files**, with zero parse/type diagnostics and zero unresolved handles. This is the intended red result while conversion is incomplete. The 3,916 is not a unique-query count or a conversion-progress metric: 3,909 are structural operation/fragment call-site diagnostics and chained expressions/helpers can report multiple times for the same chain; seven are exported repository query-builder escapes. Do not use these diagnostic counts as query population counts.
- Preserve the initial unbuilt-tree failure as environmental evidence, not a query residual: before workspace declarations were built, TS2307 “Cannot find module '@taskdesk/permissions' or its corresponding type declarations” (and analogous workspace-module errors) prevented meaningful semantic classification. The built-tree rerun resolved those diagnostics and produced the expected structural red result above.
- `git diff --check` passed before commit; final `git status --short --branch` was clean.

The full scan output is retained at `/tmp/checkqueries-580-final2.out` on this machine. Representative accepted-main production paths in that output include `apps/api/src/activity/controllers/update-comment.ts`, `apps/api/src/approval/reminder-scan.ts`, and `apps/api/src/ws/project-read-authorization.ts`; these illustrate current non-repository ownership sites, not a counted inventory of unique queries.

## Remaining work and handoff

Production conversion remains outstanding across the API source tree; this branch performed no conversions and does not supply the source-population inventory or prove the remaining count. Reconcile actual modules and query chains against the existing #580 inventory and accepted exact 14-file contract, then convert bounded source batches with tenant predicates, result shape, executor/transaction use, and lock/audit/outbox/notification ordering covered by meaningful tests. The current carrier and production tree are still expected to fail this checker until conversion is complete. Only after that reconciliation should the checker be activated; final activation and whole-API reconciliation still require the later integration review tier, with ordinary independent reviews and GPT-6 Sol review before any push/PR path proceeds.

No production/API module, shared contract, control file, dependency, gate configuration, or central documentation was changed in this preparation commit.

---

## Retained evidence file — 580-query-checker-ordinary-a-luna.md

Origin SHA-256: `0723ef09a405daab16e18491ebcd0d12d2e2adf51ed3f76746febaadc48d11e6`.

# #580 checker preparation — independent ordinary review A

**Verdict: BLOCKED** on an exported async repository query-builder escape that the checker accepts.

## Candidate and independence

- Candidate: `7d665191d0461be0b54bdcb27ec6ff935631bafe` (`feat(ci): add unwired query ownership checker`)
- Base: `e9df2294fa580fd2885343bbef0cec28e81ead4c`
- Checkout: `/Users/heinthura/.codex/worktrees/query-checker-580`
- Exact changed paths: `scripts/ci/check-queries.mjs`, `scripts/ci/check-queries.test.mjs`; no manifest, workflow, or activation path.
- This was a fresh independent review context and did not author, direct, or remediate the candidate. The assigned Luna-tier ordinary review ran in a GPT-6 context; the model runtime does not expose a more specific Luna/Sol variant label.

## Scope and contract checked

Read the checkout's `AGENTS.md`, active mission, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, and coding standards, plus the #580 checker-preparation handoff and current query contract evidence. The applicable D1-D4 contract allows transaction opening as orchestration but routes every statement through a repository accepting the executor; includes raw `execute`/`sql`; uses the accepted bounded repository locations and exact 14 explicit infrastructure files; excludes `apps/api/scripts/**`. Repository functions return rows/DTOs/scalars, not composable query builders. The checker is a structural ownership/location gate, not proof of tenant predicates or arbitrary interprocedural transaction propagation.

## Checks and reproductions

- Confirmed `HEAD` is the requested exact SHA and its parent is the stated base; the diff contains only the two expected new files.
- Ran `node --test scripts/ci/check-queries.test.mjs`: **2 passed, 0 failed**. This includes 21 typed fixture sources, 16 class-specific ownership expectations, 3 fail-closed cases, 3 valid transaction/repository positives, and the exact 14-file classification assertions.
- Ran `git diff --check` on the candidate range: passed. Working tree is clean after the temporary probe was removed.
- Focused external reproduction through the same TypeScript `API` + `analyzeQueryOwnership` path: created a temporary `apps/api/src/database/query-review-probe/probe.repository.ts` containing `export async function escaped() { return db.select(); }`. The checker returned `[]` (no violations). The direct query call is intentionally allowed in a repository, but the exported function's inferred return is `Promise<PgSelect...>`; `isQueryBuilder` does not unwrap `Promise`, so the public-boundary check misses this query-builder escape. This directly contradicts the stated rule that exported repository boundaries return rows/DTOs/scalars and the handoff's claim that exported query-builder escapes are detected. Ordinary async repository functions are the normal contract, so this is material.
- Did not run the whole API scan: this prep candidate is expected to show the accepted-main 3,916 diagnostic instances across 256 files (not unique query counts), and that result cannot validate the discovered boundary gap. No heavy suite or dependency changes were made.

## Findings

**Blocking — async exported repository query builders evade the return-boundary check.** In `analyzeQueryOwnership`, `isQueryBuilder(result)` checks only the outer return type. For an exported `async` function returning a Drizzle builder, TypeScript produces `Promise<Builder>`; `isQueryBuilder` inspects the Promise's call signature (if any), rather than unwrapping its type argument. The focused fixture above passes with zero violations. The checker therefore cannot enforce the advertised public repository boundary for the common async form. Add a regression requiring the async escape to fail and inspect promise/thenable result types recursively or otherwise prove the resolved return shape. Retain the existing valid async row-return fixture to guard against false positives.

No other blocking or non-blocking findings identified in the bounded review. Static path classification and production-source test exclusion match the requested contract; specific ownership fixtures did not merely pass from generic TypeScript failures; the candidate correctly leaves unresolved `any`, parse errors, and semantic diagnostics fail-closed. Its comments appropriately limit the claim around tenant predicates and interprocedural executor propagation.

## Gate status

**Ordinary A: BLOCKED; not clear for the GPT-6 Sol security review yet.** Re-review the remediation at its new exact SHA. The checker remains unwired on this candidate, and later activation plus integrated whole-API reconciliation still require their separate review tier and evidence.

## Review-owned temporary probe — provenance addendum

The review created the following temporary production-path file solely for the focused repro. The `finally` cleanup removed its containing directory; a follow-up existence check found it absent and `git status --short` was clean. It was not part of the candidate and is not retained in the worktree.

- Path: `apps/api/src/database/query-review-probe/probe.repository.ts`
- Exact content (including final newline):
  `import db from "../index"; export async function escaped() { return db.select(); }\n`
- SHA-256 of exact content: `40234fc2ebb86d043a7799da32fbe271d4369fa669511a6e11bf4cf7639d94d1`
- Creation/reproduction command (run from the worktree):
  `node --input-type=module -e 'import {mkdirSync,writeFileSync,rmSync} from "node:fs"; import path from "node:path"; import {API} from "typescript/unstable/sync"; import {repoRoot} from "./scripts/ci/lib/repo.mjs"; import {analyzeQueryOwnership} from "./scripts/ci/check-queries.mjs"; const dir=path.join(repoRoot,"apps/api/src/database/query-review-probe"); const d=path.join(dir,"probe.repository.ts"); mkdirSync(dir,{recursive:true}); writeFileSync(d, `import db from "../index"; export async function escaped() { return db.select(); }\\n`); const api=new API({cwd:repoRoot}); let snapshot; try { snapshot=api.updateSnapshot({openProjects:[path.join(repoRoot,"apps/api/tsconfig.json")],openFiles:[d]}); console.log(analyzeQueryOwnership({files:[d],snapshot,root:repoRoot})); } finally {snapshot?.dispose();api.close();rmSync(dir,{recursive:true,force:true});}'`

Clarification: the earlier statement that no candidate files changed refers to the committed candidate diff; this review did create and then remove its own untracked probe under `apps/api/src`. No unknown file was deleted. The exact original fixture is preserved above as evidence.

---

## Retained evidence file — 580-query-checker-ordinary-b-luna.md

Origin SHA-256: `43e9f6f708a87f8d5dc3e5f003f8e3d6d55294ca921beebca03b723797ce9f71`.

# #580 query checker preparation — ordinary review B

**Model:** GPT-6 (this reviewer context; platform did not expose a Luna variant label)
**Role:** independent ordinary reviewer B
**Verdict:** **CHANGES REQUESTED** — exported query-builder escape checking has a reachable false negative.

## Exact source and independence

- Candidate: `7d665191d0461be0b54bdcb27ec6ff935631bafe`
- Comparison base: `e9df2294fa580fd2885343bbef0cec28e81ead4c`
- Branch/worktree: `codex/query-checker-580`, `/Users/heinthura/.codex/worktrees/query-checker-580`
- Parent: the stated comparison base; the candidate consists of exactly two added files: `scripts/ci/check-queries.mjs` and `scripts/ci/check-queries.test.mjs`.
- This context did not author, direct, or remediate the candidate. No candidate files were changed. Review was read-only.

## Scope and contract checked

I inspected the current repository workflow, `CLAUDE.md`, `docs/07-planning/status.md`, `docs/07-planning/decision-log.md`, `docs/04-engineering/coding-standards.md`, `docs/01-architecture/security-model.md`, `docs/01-architecture/multi-tenancy.md`, `docs/01-architecture/monorepo-layout.md`, `docs/04-engineering/ci-cd.md`, the candidate diff and its full checker/test source, plus actual API database exports and raw `pg` call sites. The operative ownership rule is that persistence queries live in named repositories, with an explicit 14-file infrastructure allowlist and repository naming patterns; the `database/**` wildcard is forbidden. The source is only an unwired preparation artifact. This review does not establish tenant-predicate correctness, D1 propagation, complete source conversion, activation readiness, or acceptance.

## Blocking finding

**B1 — exported query-builder escape check misses export-list and aggregate public boundaries.** `scripts/ci/check-queries.mjs:656-702` checks exported repository functions and function-valued variables only when the containing declaration itself carries an `export` modifier. It does not resolve `ExportDeclaration`/`export { local }`, nor inspect exported object/class members or other exported aggregate values. A repository can therefore expose a builder while all query operations remain correctly located inside the repository, and the gate reports no violation. For example:

```ts
import db from "../../database";
function build() { return db.select(); }
export { build };
```

`build` is not an exported declaration statement, so the public-boundary loop skips it. The repository query call is allowed by location. The same gap exists for an exported object/class whose public method returns the builder. This contradicts the checker's own declared invariant (“Public repository boundaries return rows/DTOs/scalars, never query builders”) and permits callers to execute the returned builder outside repository ownership. The current regression at `scripts/ci/check-queries.test.mjs:224-227` covers only a directly exported function (`export const escape = () => db.select()`), so it does not exercise the gap. Add a typed fixture for at least export-list re-export and an exported aggregate/class boundary, asserting the specific escape diagnostic; then inspect other module export forms covered by the declared invariant.

## Review observations

- The code uses the TypeScript checker rather than source spelling for Drizzle and `pg` shapes. Static inspection found the intended paths for aliases, optional/computed property calls, destructured methods, raw SQL tags, `pg` pool/client operations, transaction callback bodies, and call/apply/bind escape forms. The API uses `DatabaseInstance = ReturnType<typeof drizzle<typeof schema>>`, exports a default Drizzle `db`, and has actual typed `Pool`/`Client.query()` calls, so the type families being inspected correspond to real APIs.
- The explicit infra list is 14 exact paths. The repository matcher recognizes `repository.ts`, `*.repository.ts`, and nested `repository/` paths; there is no broad database-directory exemption. The second test asserts the 14 entries and rejects two representative unlisted database files.
- The test has 21 fixture files and makes per-case assertions. Fifteen fixtures assert specific ownership violations in the expected-violation map; the repository builder-escape fixture adds the sixteenth ownership/boundary negative. Three fail-closed cases assert separate unresolved-handle, semantic-type-error, and syntax-error diagnostics. Three repository/transaction positives assert no diagnostics. Counts and assertions were inspected; the tests were not executed in this review because the conductor owns the shared fixture/test window.
- `git diff --check e9df2294fa580fd2885343bbef0cec28e81ead4c..HEAD` passed. I did not run checker fixtures or the production scan, so no execution results are attributed to this review.
- The handoff’s accepted-main result of 3,916 diagnostic instances is author-supplied evidence only. It is not a unique-query total or conversion progress metric. I make no tenant-propagation or D1 proof claim.
- The checker is not wired into package scripts, workflows, test aggregation, or activation paths in this candidate; that is appropriate for this preparation stage and must remain so until source conversion/reconciliation and later activation acceptance are complete.

## Commands and inspection performed

From the candidate worktree I ran:

- `pwd && git status --short --branch && git rev-parse HEAD && git diff --stat <base>..<head> && git diff --name-only <base>..<head>` — exact branch/head, clean initial status, two-file diff confirmed.
- Read the workflow, operating guide, status and decision log, and the ownership/tenancy/CI contract passages named above.
- `rg` searches for query ownership contract and actual API database/`pg` types/call sites; `sed` and `nl -ba` inspections of the candidate implementation and tests.
- `git show -s --format='%H%n%P%n%s' HEAD` — confirmed exact head and base parent.
- `git diff --check <base>..<head>` — passed.

A later status read showed an untracked `apps/api/src/database/query-review-probe/probe.repository.ts` that was absent from my initial status. I did not create or modify it and excluded it from candidate review; this was reported to the conductor as a shared-worktree artifact. No tests, builds, production scans, pushes, PR actions, or candidate edits were performed.

## Disposition

Do not clear ordinary review B on this head. The checker’s structural ownership detection and typed fixtures are a credible preparation, but B1 needs a bounded source/test correction and a fresh review of the changed head. Required independent GPT-6 Sol security review remains a separate later gate after ordinary review clears. Whole-API conversion/reconciliation, production scan reaching zero ownership violations, activation, full acceptance and any phase claim remain separate work.

---

## Retained evidence file — 580-query-checker-review-remediation-luna.md

Origin SHA-256: `87587228e9618619281f02242b53a762b5d41e48543c7a3772549d95425d3835`.

# #580 query checker review remediation handoff

This separate handoff preserves the original independent ordinary review reports A and B and the initial candidate commit. It records the bounded structural correction only.

## Candidate

- Worktree: `/Users/heinthura/.codex/worktrees/query-checker-580`
- Branch: `codex/query-checker-580-prep`
- Original candidate/base: `7d665191d0461be0b54bdcb27ec6ff935631bafe` / `e9df2294fa580fd2885343bbef0cec28e81ead4c`
- Updated files only: `scripts/ci/check-queries.mjs`, `scripts/ci/check-queries.test.mjs`
- No manifest, workflow, activation, dependency, API source, contract, or documentation edit. No push or PR.

## Remediation

The checker now discovers runtime exports from TypeScript source declarations rather than only declarations carrying a direct `export` modifier. It covers named export lists and named re-exports, exported object values, classes and callable public members, factory-returned objects, and async callables. Query builders are checked recursively through Promise/type arguments and awaited types; object and method results are traversed with cycle detection and conservative depth/node limits that fail closed. Type-only exports are skipped. Private/protected class methods are excluded from the public boundary, while their query calls remain subject to repository location ownership.

The analyzer accepts an explicit `apiSourceRoot` for focused fixtures, defaulting to `<root>/apps/api/src`; out-of-root files are skipped. Fixtures now live in a temporary directory under `apps/api/` (outside `apps/api/src`) with a temporary config and cleanup in `finally`; no probe or fixture is left in the production tree. The static exact 14-file infrastructure allowlist and repository naming patterns are unchanged.

The fixture API suite now exercises **33 typed source fixtures**: 23 specific ownership/export-boundary negatives, 3 distinct fail-closed cases (unresolved handle, semantic type error, syntax error), and 7 positives (transaction opening, ordinary and typed-transaction repository results, async thenable-assimilated rows, private/protected implementation methods, type-only exports, and a recursive exported row-return API). Each builder-negative asserts the builder/ownership diagnostic itself, not a generic parse/type error. The second test continues to assert all 14 infrastructure paths and rejects unlisted `database/` paths.

The checker still only proves structural query ownership and export shape. It does not prove tenant predicates or arbitrary interprocedural transaction/executor propagation; those remain source conversion and regression-test obligations under D1-D4.

## Validation

- `node --test scripts/ci/check-queries.test.mjs`: 2 tests passed, 0 failed.
- `pnpm exec biome check scripts/ci/check-queries.mjs scripts/ci/check-queries.test.mjs`: passed after formatting.
- `node --check` on both files: passed.
- `git diff --check`: passed.
- Fixture cleanup verified: no `apps/api/.query-check-fixture-*` paths and the review A probe `apps/api/src/database/query-review-probe/probe.repository.ts` is absent.
- After the checker implementation change, `node scripts/ci/check-queries.mjs` on the accepted-main source exited 1 as expected with **4,031 diagnostic instances**. This reflects current source residuals plus newly detected exported-boundary cases; it is not a unique-query count or conversion-progress total. There are two additional fail-closed exported-shape results in `apps/api/src/view/repository.ts:116` and `apps/api/src/work-item/repository.ts:74`; the latter is an exported query-builder helper, and the former has an inferred nested result shape that this conservative type walk could not prove. The scan showed no parse, semantic-type, unresolved-receiver, or source-load diagnostics. Do not infer D1 correctness from this scan.
- Scan output retained at `/tmp/checkqueries-580-reviewfix-final.out`. The production run occurred after confirming the review probe was absent; the later change only adjusted the analyzer's default-root-safe fixture parameter and added a fixture, with no production-scan behavior change.

## Review status and next action

This remediation has not been independently reviewed. Both ordinary reviews A and B blocked the prior exact head; queue two fresh ordinary delta reviews against the updated candidate, preserving their prior reports. If ordinary review clears, obtain the required independent GPT-6 Sol review. This remains unwired preparation: production conversion/reconciliation and later activation/integration acceptance are separate unfinished work. Do not push or open a PR before review clearance.

Committed locally as `193daa9ddc2951a54c4c2da2cb839e6eb4f2c04c` (`fix(ci): inspect exported query boundaries`), parent `7d665191d0461be0b54bdcb27ec6ff935631bafe`. Working tree is clean.

---

## Retained evidence file — 580-query-checker-full-builder-type-luna.md

Origin SHA-256: `415546ad3f04b59265cb84ba9758e8ef8d57ac2195461190104a76c8c1b51c3b`.

# #580 checker full-query-builder type follow-up

## Checkout

- Worktree: `/Users/heinthura/.codex/worktrees/query-checker-580`
- Branch: `codex/query-checker-580-prep`
- Base candidate: `193daa9ddc2951a54c4c2da2cb839e6eb4f2c04c`
- Only `scripts/ci/check-queries.mjs` and `scripts/ci/check-queries.test.mjs` are modified. No production scan, package wiring, push, or PR.

## Evidence and fix

A targeted TS7 native API query of `apps/api/src/auth/repository.ts` found the real full-chain return type for `getAuthUserLocale`:

`Omit<PgSelectBase<"user", { locale: PgColumn<...> }, ...>, "limit" | "where">`

This is a complete `select/from/where/limit` chain and still a Drizzle thenable builder. The earlier builder family regex did not name `PgSelectBase`; the mapped `Omit<...>` wrapper also prevents relying only on a top-level symbol name. I added a bounded recognized-name check against TypeScript's rendered type before Promise argument or awaited-result traversal, covering `PgSelectBase`, `PgSelectQueryBuilderBase`, and the Pg insert/update/delete Base types. `exportedQueryBoundary` calls `isQueryBuilder` first, so a full thenable builder is identified before an async/awaited row result can be accepted.

New type-clean fixture cases assert the exact builder-escape diagnostic for a non-async full select chain and the Omit-shaped full select. The existing async incomplete builder remains a specific negative. The async full select positive now uses `from/where/limit` and verifies that the async function's genuinely assimilated rows pass. No generic parse/type failure can satisfy these expected cases.

## Checks

- `node --test scripts/ci/check-queries.test.mjs`: 2 passed, 0 failed; 35 typed sources total (25 specific ownership/builder negatives, 3 separate fail-closed inputs, 7 valid positives), plus exact 14-infrastructure-path classification.
- Biome check, Node syntax checks for both files, and `git diff --check`: passed.
- The review probe `apps/api/src/database/query-review-probe/probe.repository.ts` remains absent. No fixture files remain in `apps/api/src`.
- A production scan was intentionally not run while the local CPU window is reserved. The earlier 4,031 diagnostic scan predates this focused addition and must not be described as output from the current candidate.

No tenant-predicate or full interprocedural executor-propagation claim is made by the location checker.

## Final mechanism correction

The type-render-string fallback mentioned above was an intermediate attempt and is **not in the committed candidate**. At the conductor's request, it was replaced before commit with actual TS7 type graph traversal: `hasNamedType` follows `Type.getAliasTypeArguments()` in addition to symbol, constituent, base, and target edges; the recognized names include Drizzle's `PgSelectBase`, `PgSelectQueryBuilderBase`, and mutation `*Base` types. The regression for `Omit<PgSelectBase<...>, ...>` passes through this type graph, without matching rendered type text. `exportedQueryBoundary` checks the builder family first, before Promise type arguments and awaited results.

A focused checker pass over only the real `apps/api/src/auth/repository.ts` (not a whole API scan) now reports the builder-boundary violation for `getAuthUserLocale` at line 4 and the other non-async query-returning exports. Direct type evidence remains `Omit<PgSelectBase<...>, "limit" | "where">`. The type-clean Omit/full-chain fixture was negative under the original checker and now asserts the named builder-escape finding. Biome and the 35-source fixture suite pass after this replacement. No production scan was run.

Graph-traversal commit: see exact current head in the branch; previous claim about rendered text is superseded by this addendum.

Exact local commit: `2b66f750dd1c6b5e7e9379001d7d3af27d6095fb` (`fix(ci): follow Drizzle alias type graphs`), parent `193daa9ddc2951a54c4c2da2cb839e6eb4f2c04c`; working tree clean, no push.

---

## Retained evidence file — 580-query-checker-ordinary-a-delta-luna.md

Origin SHA-256: `db3d58d2ac45892104620c58dfb5d6f9a9af4b58539950c6394607a6d8be7beb`.

# #580 query checker — independent ordinary A delta review

**Verdict: BLOCKED** on anonymous default function/class exports bypassing the exported repository boundary check.

## Exact candidate and independence

- Worktree: `/Users/heinthura/.codex/worktrees/query-checker-580`
- Branch: `codex/query-checker-580-prep`
- Previous reviewed head: `7d665191d0461be0b54bdcb27ec6ff935631bafe`
- Intermediate public-boundary remediation: `193daa9ddc2951a54c4c2da2cb839e6eb4f2c04c`
- Frozen candidate: `2b66f750dd1c6b5e7e9379001d7d3af27d6095fb`
- Candidate parent: `193daa9ddc2951a54c4c2da2cb839e6eb4f2c04c`
- Cumulative delta from my prior reviewed head: only `scripts/ci/check-queries.mjs` and `scripts/ci/check-queries.test.mjs`; no package/CI wiring or production-source change. Current tree is clean.
- Fresh independent ordinary A context; this reviewer did not author, direct, or remediate the candidate. Review was assigned to the Luna ordinary tier; the runtime does not expose a more specific model variant label.

## Contract and delta checked

Re-read the applicable workflow, active mission, coding standards, original #580 handoff, prior A report and the remediation/full-builder-type handoffs. The checker is a structural location/export-shape gate under D1-D4, not proof of tenant predicates or arbitrary executor propagation. The exact 14-file persistence-infrastructure list and repository naming rules remain unchanged. The delta adds exported-symbol/public API traversal through functions, objects, classes, factories, reexports and async returns, then expands Drizzle builder-family detection through type alias arguments so full `PgSelectBase` / `Omit` chains are recognized.

Inspected both changed files and the official local TS 7.0.2 sync API declaration. `Checker.getExportsOfModule(symbol)` and `Symbol.getExports()` are present in `node_modules/.pnpm/typescript@7.0.2/node_modules/typescript/dist/api/sync/api.d.ts`. The source comment that export-star cannot be enumerated through the native API surface is therefore unsupported as written. `export * as repository from "./namespace-source.repository"` currently yields no finding on the namespace-exporting file. In the focused reproduction the local source file was separately scanned and did receive a builder finding, so this observation alone did not produce a whole-scan false negative. It remains a public-boundary coverage gap if an exported namespace points to a value whose declaration is outside the scanned source set.

## Validation and reproduction evidence

- `node --test scripts/ci/check-queries.test.mjs`: **2 passed, 0 failed**. The handoff's 35-source count and expected results are consistent with the reviewed fixture map: full non-async and `Omit<PgSelectBase>` chains require the named builder-escape finding; the async full-chain returning assimilated rows is an accepted positive; the incomplete async chain remains a negative; aliases, named exports/reexports, object/class/factory public shapes and fail-closed cases have specific assertions.
- Focused external fixture validation used the same TypeScript `API` and `analyzeQueryOwnership` path, in a temporary `apps/api/.query-review-boundary-*` directory outside `apps/api/src` with a temporary config. The directory and config were removed in `finally`; no candidate source or test file was edited.
- Type-clean source `database/default-anon-class.repository.ts`, exact contents `import db from "../../src/database"; export default class { read() { return db.select(); } }\n`, SHA-256 `9ab7bd9ee1b23799efbceaa4d3d8b2719179afe41b42ae46e108b6596c0c8b1e`: **no violation**.
- Type-clean source `database/default-anon-function.repository.ts`, exact contents `import db from "../../src/database"; export default function () { return db.select(); }\n`, SHA-256 `66f5b28a6354347254af94a23b4c319b9d8edad8d7cde435323c90093200f88d`: **no violation**.
- The temporary namespace pair used `export function read() { return db.select(); }` in `namespace-source.repository.ts` and `export * as repository from "./namespace-source.repository";` in `namespace.repository.ts`. Only the local source module reported the builder escape; the namespace-exporting file did not report an unenumerated boundary. Both exact fixture source hashes: `90067324fe4750e3724379ffaa4c25a276f541b4a1db55a1524c5303ec5bbf66` and `eba153f8d4b62fa1f40ff6ee014057321d53deb71a56e9889200a5e0ecfeb304`.
- `git status --short --branch` after cleanup showed only the branch header; no untracked fixtures remain.
- No whole-API scan was run, per assignment. The previous 4,031 diagnostic scan predates this frozen candidate and is not claimed as current evidence.

## Blocking finding

**Anonymous default callable/class exports are skipped by public-boundary traversal.** For an exported function or class declaration, the candidate records the boundary only when `statement.name` exists. An anonymous default function/class has no name, so its API is omitted. Calls inside the class/function are in an allowed repository location and pass the location check; consequently the two clean reproductions above let a public repository export a Drizzle builder with zero violations. This is a specific bypass of the rule that public repository boundaries expose rows/DTOs/scalars rather than composable query builders.

I did not prescribe a code repair. The separate namespace-export observation should be considered with the TS7 export-symbol API evidence; it is not a second demonstrated whole-scan bypass in the local-source reproduction.

## Review disposition

**Ordinary A delta: BLOCKED.** Do not treat the current head as ordinary-clear or proceed to the required Sol review. Re-review the exact head after the structural public-export handling is corrected. The checker remains intentionally unwired; later activation and integrated source reconciliation retain their separate gates.

---

## Retained evidence file — 580-query-checker-structural-exports-luna.md

Origin SHA-256: `e1e223556129b3d85b8bc91ff5b32275c14b7ac38273d30a1fa7846b03868308`.

# #580 checker structural runtime-export repair — author handoff

## Result

Implemented the bounded structural repair in `/Users/heinthura/.codex/worktrees/query-checker-580`, branch `codex/query-checker-580-prep`, commit `fa5d00aa878480a1583c436f6bb5dc3c17098fa9` (parent `2b66f750dd1c6b5e7e9379001d7d3af27d6095fb`). Worktree is clean. This is unwired checker preparation only; it does not claim #580 complete and does not establish tenant-predicate correctness or prove interprocedural transaction-handle propagation.

## Change

In `scripts/ci/check-queries.mjs:801-936`, public-boundary enumeration now starts from the compiler's runtime module exports via `checker.getExportsOfModule`, resolves aliases with `checker.getAliasedSymbol`, inspects types with `checker.getTypeOfSymbol`, and recursively enumerates namespace symbols. Explicit AST handling is limited to exclusion of `export type` specifiers/declarations. Missing symbols, failed alias or namespace resolution, and export graph limits fail closed. This replaces syntax-shape discovery which omitted anonymous default declarations and namespace exports. The accepted exact repository/persistence path boundaries are unchanged.

At `scripts/ci/check-queries.mjs:30`, `Aliased` is recognized as a Drizzle query fragment type. A type-clean fixture for `sql\`select 1\`.as("alias")` first demonstrated unresolved shape rather than a specific builder finding; the installed Drizzle declaration at `node_modules/.pnpm/drizzle-orm@*/node_modules/drizzle-orm/sql/sql.d.ts` identifies `Aliased<T>` as implementing `SQLWrapper`. The specific alias type is now recognized.

`scripts/ci/check-queries.test.mjs:145-200, 319-397` adds typechecked negatives for anonymous default async function, anonymous default function/class builder returns, namespace re-export of a query-returning repository, namespace export of `drizzle-orm`, and aliased SQL fragment. Positive cases cover async returned full-query thenable rows, the anonymous default async equivalent, a namespace wrapping that async row-returning export, and a class exposed only through a type-only export. Existing export-list, named re-export, object/class/factory, Omit-shaped full select, incomplete async thenable, parse/typefail, transaction-opening/handle and path-boundary fixtures remain.

## Evidence

- `node --test scripts/ci/check-queries.test.mjs` — 2 tests passed, 0 failed. The fixture harness compiles typed fixture sources before asserting specific ownership findings; the builder negatives require a query-builder boundary diagnostic. Namespace-to-`drizzle-orm` must produce either a builder finding or a specific fail-closed inability-to-exclude diagnostic, never silently pass.
- `pnpm exec biome format --write scripts/ci/check-queries.test.mjs` and `pnpm exec biome check scripts/ci/check-queries.mjs scripts/ci/check-queries.test.mjs` — clean. `git diff --check` — clean before commit. Commit hook also checked both files.
- One actual API-tree scan, `node scripts/ci/check-queries.mjs`, exited 1 as expected for the intentionally unwired, partially converted tree. It reported 5,983 findings across 273 source files: 5,708 database-operation locations, 264 raw-SQL locations, 9 exported builder escapes, and 2 exported-shape unresolved/limit findings. The repeated call-chain sites represent 2,703 distinct file/line locations, not unique queries; chains can report more than once. This count is a location-checker result, not conversion progress or tenant-isolation evidence.
- The nine concrete public builder-escape files were `attachment/repository.ts`, `auth/repository.ts`, `identity/repository.ts`, `instance/users/repository.ts`, `notification/repository.ts`, `service-calendar/repository.ts`, `sla-policy/repository.ts`, `utils/repository.ts`, and `view/repository.ts`. Two files had unresolved/limit public-shape reports: `view/repository.ts` and `work-item/repository.ts`. Other operation findings remain the larger conversion backlog and need source-by-source classification under accepted D1-D4.
- No Docker, database, browser, dependency, workflow, package script, or production API changes. No push or PR.

## Preserved limits and next action

The structural module-export invariant closes the reported anonymous-default, export-list/re-export, and namespace-discovery bypasses using the TS7 native checker API. The test set proves representative public-boundary detection, not exhaustive handling of every compiler type graph. Preserve the earlier independent A/B and remediation reports; commission fresh independent review of this exact SHA, paying particular attention to symbol/alias graph limits and the specific fail-closed behavior for external namespaces. Keep the gate unwired and red until all source conversion is reconciled and reviewed; do not add a wildcard infrastructure exemption or treat these diagnostics as tenant-predicate proof.

---

## Retained evidence file — 580-query-checker-structural-a-luna.md

Origin SHA-256: `8162427866cdfe9ce1169ca3c7ce0db1ba43f7a39236d60fabe89debb06812b0`.

# #580 query checker — independent ordinary A structural-export review

**Verdict: CLEAR for this exact candidate and bounded checker-preparation scope.** No blocker found in the structural runtime-export remediation.

## Exact candidate and independence

- Worktree: `/Users/heinthura/.codex/worktrees/query-checker-580`
- Branch: `codex/query-checker-580-prep`
- Base reviewed by this delta: `2b66f750dd1c6b5e7e9379001d7d3af27d6095fb`
- Frozen candidate: `fa5d00aa878480a1583c436f6bb5dc3c17098fa9`
- Candidate parent: `2b66f750dd1c6b5e7e9379001d7d3af27d6095fb`
- Exact changed paths: `scripts/ci/check-queries.mjs`, `scripts/ci/check-queries.test.mjs`. No package, CI, workflow, production API, or activation wiring change. Worktree remained clean.
- Fresh independent ordinary A context; this reviewer did not author, direct, or remediate the candidate. Assigned to the Luna ordinary tier; the runtime does not expose a more specific model variant label.

## Review scope and structural check

Read the structural-export author handoff and inspected the complete diff from `2b66f750` to `fa5d00aa`, including the existing async-builder/type-graph work. The contract remains the D1-D4 structural location/export boundary; the checker does not prove tenant predicate correctness or arbitrary interprocedural executor propagation. The exact 14 infrastructure paths and repository naming rules are unchanged.

The candidate now obtains runtime exports from `checker.getExportsOfModule(moduleSymbol)`, resolves alias symbols, queries exported types, and recursively visits namespace members. Resolution failures and the 512-node/20-depth bounds report violations. The native API surface matches this usage: the local TS7.0.2 sync declaration exposes `Checker.getExportsOfModule`, `Checker.getAliasedSymbol`, `Checker.getTypeOfSymbol`, and `Symbol.getExports`. AST use distinguishes type-only export syntax. The prior anonymous-default and namespace omission is addressed at the runtime symbol level, rather than relying on named syntax forms. `Aliased` is added to the Drizzle query family, consistent with its `SQLWrapper` implementation and now covered by a typed SQL alias fixture.

## Commands and observed results

- Exact-head/base verification: `git rev-parse HEAD` returned `fa5d00aa878480a1583c436f6bb5dc3c17098fa9`; candidate diff against `2b66f750` contained only the two expected checker files.
- `node --test scripts/ci/check-queries.test.mjs`: **2 passed, 0 failed**. This runs the typechecked fixture harness plus exact path-classification test.
- The fixture map now specifically exercises anonymous default function and class escapes, named exports and reexports, namespace repository exports, namespace reexports of `drizzle-orm`, SQL `Aliased` fragments, full `PgSelectBase`/`Omit` chains, async builder rejection versus async thenable row acceptance, type-only exports, and unresolved/parse/type-failure cases. Builder cases require the named boundary violation or the specifically allowed fail-closed external-namespace result; generic parse/type errors cannot satisfy the case-specific expectations.
- `git diff --check 2b66f750..fa5d00aa`: passed.
- After the fixture run, `git status --short --branch` showed only the branch header. `find apps/api` showed no `.query-check-fixture-*` or `.query-review-*` paths. The test harness performs its own cleanup. I created no separate production-tree probes.
- No whole-API scan was run. The author's 5,983 diagnostic-instance scan is taken from the handoff, not independently repeated here; diagnostic sites/lines are not unique-query or tenant-isolation counts.

## Findings and disposition

No blocking or non-blocking findings identified in this exact delta. The primary former escape path (anonymous default callable/class exports) is now included in the typed fixture suite and the module-symbol traversal has explicit namespace recursion and fail-closed resolution/limit behavior. Valid asynchronous row results and type-only class exports are covered as positives; completed query chains returned as builders and SQL alias fragments are covered as negatives.

**Ordinary A delta: CLEAR at `fa5d00aa878480a1583c436f6bb5dc3c17098fa9`.** This only clears the bounded unwired checker-preparation change. It is not a claim that query conversion is complete, that the gate is activated, or that tenant scoping has been verified. The current exact head still needs the other fresh ordinary review and the required independent full GPT-6 Sol review before any subsequent flow; integrated activation/source reconciliation retains its separate review and evidence gates.

---

## Retained evidence file — 580-query-checker-structural-b-luna.md

Origin SHA-256: `419fbff5d08322d8a68d3ce40c0ee39354b8be77513c5e82297e093f47f0129a`.

# #580 query checker structural-export revision — ordinary review B

**Model/provenance:** GPT-6, dispatched in the GPT-6 Luna ordinary-review slot; this runtime did not expose a more specific variant label.
**Role:** fresh independent ordinary reviewer B for the current structural-export revision.
**Verdict:** **CHANGES REQUESTED** — generic exported return types can be accepted without proving they exclude query builders.

## Exact source and independence

- Candidate: `fa5d00aa878480a1583c436f6bb5dc3c17098fa9`
- Comparison base for this frozen revision: `2b66f750dd1c6b5e7e9379001d7d3af27d6095fb`
- Candidate parent: `2b66f750dd1c6b5e7e9379001d7d3af27d6095fb`
- Worktree/branch: `/Users/heinthura/.codex/worktrees/query-checker-580`, `codex/query-checker-580-prep`
- Changed paths: `scripts/ci/check-queries.mjs`, `scripts/ci/check-queries.test.mjs` only.
- This reviewer did not author, direct, or remediate the candidate. Inspection was read-only; no candidate edits, source probes, test runs, production scan, push, or PR action were performed.

The candidate hash supplied in the dispatch omitted its final `9`; `git rev-parse HEAD` confirmed the full 40-character SHA above. The worktree was clean at inspection. `git diff --check 2b66f750dd1c6b5e7e9379001d7d3af27d6095fb..HEAD` passed.

## Scope checked

I inspected the full checker and fixture test at this head, the delta from the preceding `2b66f750` structural-export intermediate, the author handoff and independent A report for this exact SHA, and actual generic exported helpers in the API. Review scope is the D1-D4 repository location and public-builder-boundary checker preparation. The exact 14 infrastructure entries and repository naming patterns remain unchanged; the candidate adds no dependency, package script, workflow, CI activation or API production code.

The result is only an unwired checker preparation. It does not prove tenant predicates are correct, arbitrary transaction/executor handles propagate correctly, production conversion is complete, or the gate is ready for activation. The reported 5,983 production diagnostic instances across 273 files are author evidence, not unique query counts or progress. This review did not reproduce that scan.

## Blocking finding

**B2 — unconstrained or builder-constrained generic return types pass the public-boundary check as safe.** `exportedQueryBoundary` in `scripts/ci/check-queries.mjs:185-195` rejects missing types, `any`, `unknown` and compiler error types, then follows explicit generic arguments, awaited types, signatures and source-level public properties. It does not inspect a type parameter’s constraint or classify an unresolved type parameter as unproven. Consequently an exported repository helper such as:

```ts
export function identity<T>(value: T): T { return value; }
```

or a query-shaped constrained version such as `identity<T extends SQL>(value: T): T` can be treated as safe even though its public return type can carry a Drizzle SQL/query-builder value. The same issue can occur nested in `Promise<T>`, object members, and generic callback helpers. This conflicts with the checker’s stated invariant that public repository boundaries return rows/DTOs/scalars and with its fail-closed claim for unproven shapes. The current fixtures cover explicit direct builders, async thenable row results, recursive DTO APIs, export lists, re-exports, namespaces, type-only exports, objects and classes, but no generic pass-through or constrained type parameter.

Add typed negatives for a generic identity return and a builder-constrained return, including a nested generic callback/object form if the implementation claims those boundaries; require the specific builder or fail-closed boundary diagnostic. Keep positive generic fixtures for actual row/scalar APIs if those are part of the intended contract, and confirm the real repository’s generic callback helpers remain meaningfully classifiable. The implementation needs to reason about type parameters/constraints or conservatively report unproven output; I am not prescribing a syntax-based exception.

The source contains real generic exports, including `withDueApprovalRows<T>` in `apps/api/src/approval/repository.ts` and `withSavedViewTransaction<T>` in `apps/api/src/view/repository.ts`. I did not check their current production-scan dispositions. They demonstrate why a repair must be tested against real typed APIs rather than blanket-rejecting every generic without considering whether the generic carries rows or a query builder.

## Prior finding disposition and coverage

The prior B finding on direct-export syntax discovery is materially addressed at this head: `checker.getExportsOfModule`, alias resolution, runtime namespace traversal, and typed export-boundary inspection replace the old `statement.modifiers`-only enumeration. The fixtures now include export-list and named re-exports, anonymous default function/class exports, namespace re-exports, exported object/class/factory forms, SQL `Aliased`, full/Omit-shaped query builders, async row thenable positives, and type-only exports. The candidate-specific independent A report records a clean 2/2 focused run. I did not rerun it because the conductor owns the CPU/test window and A had just run that exact test file on this exact head.

The explicit parse, semantic-type, unresolved-handle and export-graph fail-closed assertions remain distinct. Source-level `publicMembers` filtering excludes private/protected methods, and the repository path test retains the explicit 14-file list with no database wildcard.

## Commands and evidence actually produced by this reviewer

- `git status --short --branch`, `git rev-parse HEAD`, `git diff --stat <prior>..HEAD`, `git diff --name-only <prior>..HEAD`, and `git show -s --format='%H%n%P%n%s' <head>` — clean status, exact candidate/base, and two changed files confirmed.
- Read the full relevant checker/export traversal and test fixture definitions using `sed`/`nl`.
- Read the exact-head author handoff and independent A report; their execution receipts are attributed to those contexts, not to this reviewer.
- `rg` inspection of generic exports and `sed` inspection of `withDueApprovalRows<T>` and `withSavedViewTransaction<T>` showed real generic repository callback helpers.
- `git diff --check 2b66f750dd1c6b5e7e9379001d7d3af27d6095fb..HEAD` — passed.
- No tests or builds were run here; no production probes or source changes were made.

## Disposition

Do not clear ordinary review B on this head. The symbol-based module-export repair closes the previous direct syntax/export-shape gap in the inspected cases, but B2 remains a structural fail-open for generic output types. Keep the checker unwired. After remediation, obtain fresh review on the changed exact head; the required independent full GPT-6 Sol security review remains a separate gate after ordinary review clears. Later source conversion, whole-API reconciliation and activation retain their separate reviews and acceptance evidence.

---

## Retained evidence file — 580-query-checker-generic-output-luna.md

Origin SHA-256: `f43803e76d8b63bec79d8573602a8ca5aac1852a912b8eae3f10c2917d17491f`.

# #580 generic public-output fail-closed repair — author handoff

## Result

Reproduced and repaired B2 from `580-query-checker-structural-b-luna.md` in `/Users/heinthura/.codex/worktrees/query-checker-580`, branch `codex/query-checker-580-prep`. New commit: `6ec1667e0460fa077a16d9d0d7603eb5cba6cf75`, parent `fa5d00aa878480a1583c436f6bb5dc3c17098fa9`. Worktree is clean. Only `scripts/ci/check-queries.mjs` and its fixture test changed. No push, gate wiring, production API edit, source exemption, or claim of #580 completion.

## Finding and repair

The initial type-clean `generic-identity.repository.ts` fixture (`export function identity<T>(value: T): T`) failed at the expected assertion because the old checker reported no finding. This reproduced the review finding before the fix.

At `scripts/ci/check-queries.mjs:186-196`, public output type parameters now consult the native checker constraint API. A type parameter constrained directly to a recognized query builder/SQL type is classified as a builder escape. An unconstrained parameter or one with a non-builder constraint is marked unresolved, since a generic type parameter can carry a structurally richer query builder value. The checker does not blanket-allow a type parameter or treat its constraint as a proven substitution. Concrete public output types remain inspectable.

`check-queries.test.mjs:169-187, 351-387` adds typed negatives for unconstrained identity, `T extends SQL`, a generic object method, and `Promise<T>` generic callback output. Their expected findings are specific builder or unresolved-public-shape outcomes, and the test also asserts each generic fixture has no syntax/typecheck diagnostic. A generic input projected to a concrete `{id: string}` result is a positive case and remains clear.

## Verification

- Before repair: `node --test scripts/ci/check-queries.test.mjs` failed at `generic-identity.repository.ts` with `got <none>`.
- After repair and all final fixture edits: `node --test scripts/ci/check-queries.test.mjs` — 2 passed, 0 failed.
- `pnpm exec biome check scripts/ci/check-queries.mjs scripts/ci/check-queries.test.mjs` — clean after formatting. `git diff --check` — clean. Commit hook checked both changed files.
- One production scan after the type-parameter behavior change: `node scripts/ci/check-queries.mjs` exited 1 as expected, reporting 5,985 diagnostic instances. That is two more than the preceding scan (5,983), not a unique-query count. The public-shape unresolved findings were in `approval/repository.ts`, `identity/repository.ts`, `view/repository.ts`, and `work-item/repository.ts`; the first two are newly exposed generic boundaries. Existing nine builder escapes remain. This scan is a location/public-shape result, not tenant-predicate proof or conversion progress.

The real generic repository helpers include `withDueApprovalRows<T>` at `apps/api/src/approval/repository.ts:91-97`, `retryIdentityGrantClosure<T>` at `apps/api/src/identity/repository.ts:1003`, and `withSavedViewTransaction<T>` at `apps/api/src/view/repository.ts:218-220`. Their public output types expose `T`, so the checker conservatively leaves them red until source/contract work proves a safe concrete output or redesigns the boundary. They were not waived or edited. Keep separate unresolved findings in view/work-item for their own review/classification.

## Limits and next action

The checker proves only the structural location and public type-output conditions it checks. It still does not prove tenant predicates, complete transaction-handle propagation, or all source conversions. Preserve prior independent A/B reports. Per the altitude rule, obtain a fresh full GPT-6 Sol review of this exact head to adjudicate the generic public-output finding; do not automatically add another Luna round. Keep the gate unwired and red pending full source conversion, exact-contract reconciliation, and required reviews.

---

## Retained evidence file — 580-query-checker-security-sol.md

Origin SHA-256: `43e0d1b4183709bf9ef04e7dcfe81ce50b2bf62fff9094340d4c2fab7f53d224`.

# #580 unwired query checker preparation — independent security/correctness review

**Verdict: CHANGES REQUESTED / BLOCKED** at `6ec1667e0460fa077a16d9d0d7603eb5cba6cf75`. Three reproducible defects prevent this checker from enforcing its stated location and public-output boundaries. This is a full review of the unwired preparation, not an activation or tenant-isolation assessment.

## Provenance and exact scope

- Independent reviewer context `/root/query_checker_security`, dispatched by `/root` for the Sol-tier security role with `fork_turns=none` and the requested `gpt-6-sol` model. The runtime visible in this context identifies itself only as GPT-6; it does not expose a more specific variant string. I did not author, direct, or remediate this candidate.
- **Reviewed head:** `6ec1667e0460fa077a16d9d0d7603eb5cba6cf75`; comparison base `e9df2294fa580fd2885343bbef0cec28e81ead4c`; worktree `/Users/heinthura/.codex/worktrees/query-checker-580`, branch `codex/query-checker-580-prep`. `git diff --name-only` and `git status` confirmed a clean worktree and exactly two changed files: `scripts/ci/check-queries.mjs` and `scripts/ci/check-queries.test.mjs`. `git diff --check` passed.
- Read `AGENTS.md`, the active mission, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, coding standards, the accepted D1–D4 query ownership contract at `0627093df3ef9a7cf6784d242642a22cf887a077`, the full candidate checker and fixture test, and the authentic prior ordinary A/B, A delta, structural A/B, structural author, and generic-output author reports in this evidence directory. Prior verdicts retain their original heads and roles. I did not turn a historical BLOCKED result into clearance.
- The accepted contract allows named repository paths plus **exactly 14** named persistence infrastructure files, permits transaction opening as orchestration, requires repository statements and awaited row/DTO/scalar outputs, and includes Drizzle, raw SQL fragments and `pg` forms. It does not ask this checker to prove tenant predicates or arbitrary interprocedural executor propagation. No dependency, package script, test aggregator, workflow, documentation wiring, API production file, push, PR, or merge is in this candidate.

## Blocking findings

1. **The 14 infrastructure exceptions are dead during a real scan.** `INFRA` holds root-relative strings such as `apps/api/src/database/ensure-application-role.ts` (`check-queries.mjs:36–50`), while `analyzeQueryOwnership` computes `sourceRelative` from `apps/api/src` and passes `database/ensure-application-role.ts` to `isRepositoryPath` (`:589–597`). The test invokes `isRepositoryPath` with the root-relative form (`check-queries.test.mjs:472–502`), so it gives a false positive assurance. Direct evaluation yielded `{actualAnalyzerInput:false,unitTestInput:true,namedRepository:true}`. A focused invocation of the real analyzer on the existing, type-clean `apps/api/src/database/ensure-application-role.ts` returned 26 violations, starting with its legitimate `execute` and `sql` at lines 79–80 being labelled outside an allowed file. This invalidates the location classification of the reported 5,985 diagnostic instances: that number is already non-unique, and its infrastructure portion includes false positives. Normalize the path once at the analyzer/classifier boundary and assert an actual analyzer result for a named infrastructure file and a disallowed neighbor; keep the exact 14-entry list and no `database/**` wildcard.

2. **A union wrapper hides the newly guarded generic output.** `exportedQueryBoundary` rejects a direct type parameter (`check-queries.mjs:185–197`) but never visits union constituents before returning `safe`; its later traversal covers type arguments, awaited values, signatures, and selected properties (`:209–291`). A type-clean repository fixture `export function maybeIdentity<T>(value: T): T | undefined { return value; }` produced **no violation**, although it can return a Drizzle builder. In the same focused fixture, `SQL | undefined` produced the specific builder finding and a concrete `{id:string}` output stayed clean. This shows the gap is generic substitution inside the union, not a parse failure or missing SQL type recognition. Traverse union/intersection members (with existing cycle/limit fail-closed behavior) so `T | undefined`, including when nested in `Promise`, cannot launder an unconstrained output. The current generic negatives test direct `T`, `Promise<T>`, and an object method, but not this wrapper.

3. **Imported public interfaces can hide a SQL-returning method.** The property traversal deliberately ignores every declaration outside the current source file (`check-queries.mjs:253–274`). A type-clean two-file fixture used `shape.ts` to export `interface Escape { read(): SQL }` and `shape.repository.ts` to export `const repository: Escape = { read() { return sql\`select 1\`; } }`. Scanning **both** files through the same analyzer returned `[]`: SQL construction was allowed inside the repository, and the exported object was considered safe because the public method signature came from the imported interface. This exposes a builder for a caller to compose outside the repository, contrary to the public-output contract. Inspect app-owned imported public member declarations or conservatively report an unresolved external shape; avoid recursively treating Drizzle table implementation internals as public repository APIs. Add a type-clean cross-file negative and a concrete row-returning imported-interface positive.

## Evidence, prior findings, and limits

- I ran three focused checks: direct `isRepositoryPath` evaluation; the real analyzer on one existing infrastructure file; and two temporary TypeScript `API` fixture groups outside `apps/api/src`, one for the generic union and one for the imported interface. The groups returned respectively one specific SQL-builder finding with **no** generic-union finding, and `[]` for the imported-interface escape. Temporary directories/configs were removed in `finally`; no production path or candidate file was edited. I did not rerun the whole API scan or full focused suite. The author reports the final 2/2 focused suite pass and 5,985 diagnostic instances; those results are attributed to the author and do not defeat these new reproductions.
- The earlier async return, export-list, anonymous default, namespace, `PgSelectBase`/`Omit`, and direct generic findings are represented by meaningful typed negatives. The checked implementation uses the native TypeScript 7 module-export/alias graph, distinguishes type-only exports, checks SQL/`SQL.Aliased`, Drizzle and `pg` operations, and retains valid async row results and concrete generic projection positives. I found no reason to erase the authentic prior reviews. The current direct-`T` fix closes B2 in the tested direct forms, but finding 2 is a narrower instance of the same output-graph class.
- The repeated-finding altitude rule applies: the structural module-symbol redesign already exists, so a further ordinary Luna round is **not** automatically required merely for the narrower generic case. That rule does not waive these blockers or the need for a clean independent full Sol pass at the corrected exact head. The distinct path and imported-public-shape defects must also be corrected and tested, with any changed candidate reviewed at the tier its actual delta requires.
- This verdict makes no claim about complete #580 source conversion, `check:queries` activation, unique query counts, tenant predicates, arbitrary executor propagation, image/runtime acceptance, or PR/merge readiness. The gate remains intentionally unwired and red; future complete conversion and activation require their separate ordinary panel and security review.

**Disposition:** Keep `6ec1667e0460fa077a16d9d0d7603eb5cba6cf75` blocked. Correct the three mechanisms as one coherent checker/test batch, preserve prior adverse history, then obtain independent review of the new exact head before any preparation clearance or later activation work.

---

## Retained evidence file — 580-query-checker-three-blocker-luna.md

Origin SHA-256: `a7a403b2ea4d8de9860841d57f23df7f26425f1f7bb7eeb5c653b355d00dc5bd`.

# #580 query checker: three-blocker structural repair

Candidate: `4a69fc25194622494a7c1102b9f86f42e6b58edf` (`codex/query-checker-580-prep`)
Base: `6ec1667e0460fa077a16d9d0d7603eb5cba6cf75`
Worktree: `/Users/heinthura/.codex/worktrees/query-checker-580`

This bounded tooling-preparation commit changes only `scripts/ci/check-queries.mjs` and `scripts/ci/check-queries.test.mjs`. It does not wire or activate the checker and does not claim #580 conversion completion.

The repair addresses the three blockers in `580-query-checker-security-sol.md`:

- Path checks now use repository-root-relative canonical paths, matching the exact 14-entry persistence infrastructure list. The actual analyzer regression passes all 14 listed sources and rejects an adjacent unlisted source under `apps/api/src/database/`.
- Public result inspection traverses each union/intersection constituent, so `T | undefined` cannot conceal an unresolved generic edge.
- Public object/interface inspection follows visible imported declarations as well as local ones, including method and index-signature value types. It excludes declarations proven private/protected and filters TypeScript standard-library prototype declarations. Focused cases cover an imported public `read(): SQL` escape (rejected) and an imported concrete row-returning interface (accepted).

Validation completed before commit:

- `node --test scripts/ci/check-queries.test.mjs` — 3 tests passed, 0 failed.
- `pnpm exec biome check scripts/ci/check-queries.mjs scripts/ci/check-queries.test.mjs` — passed.
- `git diff --check` — passed.
- One production analyzer run at this head, intentionally expected red because source conversion is incomplete: 5,619 findings across 272 reported files, consisting of 5,601 operation-location findings (5,357 Drizzle operation lines and 244 raw SQL lines) and 18 public-boundary findings (9 builder, 9 unresolved). There were 0 location violations in the 14 exact infrastructure files. These are diagnostic sites, not unique queries, and are not progress counts comparable to the earlier invalid 5,985 run; that earlier run used the broken path classification.

The focused analyzer fixture cleans its temporary source in `finally`. No package scripts, workflows, docs, source conversions, tenant-predicate proof, or handle-propagation proof were changed. The checker is not wired and the current tree is noncompliant by design until conversion and final scope reconciliation complete. No Docker, browser, database, push, or PR action was performed. Independent review is still required on this exact SHA, including the required fresh Sol review; do not treat this author handoff as review approval.

---

## Retained evidence file — 580-query-checker-three-blocker-ordinary-luna.md

Origin SHA-256: `98ce2a69476c51a893802a46b6e416b6e53b604af66f59f3cec9a6729ffbacc3`.

# #580 query checker three-blocker repair — independent ordinary delta review

**Verdict: CLEAR** at exact candidate `4a69fc25194622494a7c1102b9f86f42e6b58edf`. I found no blocking or non-blocking defects in this bounded two-file delta.

**Reviewed head:** `4a69fc25194622494a7c1102b9f86f42e6b58edf`  
**Comparison base:** `6ec1667e0460fa077a16d9d0d7603eb5cba6cf75`  
**Branch/worktree:** `codex/query-checker-580-prep`, `/Users/heinthura/.codex/worktrees/query-checker-580`  
**Role/provenance:** Fresh independent ordinary review context. I did not author, direct, or remediate this candidate. The runtime identifies as GPT-6 but does not expose a Luna/Sol subvariant; this report does not claim a more specific runtime model label.

## Scope and review

Confirmed `HEAD` is the reviewed SHA and the clean worktree changes exactly `scripts/ci/check-queries.mjs` and `scripts/ci/check-queries.test.mjs`. Read the required `AGENTS.md`, active mission, workflow, `CLAUDE.md`, status and decision records, the canonical #580 query-ownership contract at `0627093df3ef9a7cf6784d242642a22cf887a077`, the current checker/tests, author handoff, and authentic preceding ordinary/Sol reports. Prior adverse findings remain attached to their original heads and are not reclassified here.

I traced the production analyzer call path, rather than relying only on helper assertions. `runQueryOwnershipCheck` obtains absolute paths from `walk`; the analyzer derives both an API-source containment path and repo-root-relative path; `allowed` and the repository-export exception both consume the repo-root-relative path. The 14 explicit infrastructure exceptions remain exact file entries, and `walk` skips symlinks. I found no database-directory wildcard or path form that would turn an unlisted neighboring file into an exception.

For public export boundaries, the updated walk rejects unresolved type parameters before they can be treated as safe, visits union/intersection constituents before generic arguments, awaited types and public signatures, and follows declared public properties and index-signature values. Imported app declarations are included; members are skipped only when visibility is proven private/protected. TypeScript standard-library members are filtered before traversal, while known Drizzle query types are classified before their implementation members are followed. The new imported SQL negative and concrete imported-row positive exercise the analyzer end to end. This closes the three prior reproductions without loosening the accepted D1–D4 boundary.

## Verification

- `node --test scripts/ci/check-queries.test.mjs` — **3 passed, 0 failed, 0 skipped**. The real-analyzer scope fixture accepts all 14 named infrastructure sources and rejects an adjacent unlisted source.
- `pnpm exec biome check scripts/ci/check-queries.mjs scripts/ci/check-queries.test.mjs` — passed.
- `git diff --check 6ec1667e..4a69fc25194622494a7c1102b9f86f42e6b58edf` — passed.
- `git status --short` — clean after the fixture test.

No production full scan was repeated. No files were edited, and no push, PR, wiring, merge, database, image, browser, or runtime action was performed.

## Limits

This is clearance for the bounded checker-preparation delta only. `check:queries` remains unwired, source conversion is incomplete, and the checker does not prove tenant predicates or arbitrary executor propagation. Those remain separate contract and acceptance obligations. The required fresh GPT-6 Sol review at this exact head remains outstanding; this ordinary review does not replace it or establish activation or merge readiness.

---

## Retained evidence file — 580-query-checker-security-current-sol.md

Origin SHA-256: `57ec8f39c0c773bd4f957ead44ba2be2b91f2612255ddfee7c6c90bdbca8c060`.

# #580 unwired query checker preparation — independent full security review

**Verdict: CLEAR** for the bounded, unwired two-file checker preparation at exact head `4a69fc25194622494a7c1102b9f86f42e6b58edf`. No blocking or non-blocking findings in this candidate. This is not clearance to activate `check:queries` or claim #580 conversion complete.

## Provenance and scope

- Fresh independent reviewer context `/root/query_checker_security_final`, dispatched by `/root` specifically for a full GPT-6 Sol security adjudication with `fork_turns=none` and a `gpt-6-sol` request. The visible runtime identifies only as GPT-6 and does not expose a verifiable subvariant; the Sol designation here is the dispatch request, not a runtime attestation. I did not author, direct or remediate this candidate.
- Candidate: branch `codex/query-checker-580-prep`, worktree `/Users/heinthura/.codex/worktrees/query-checker-580`, head `4a69fc25194622494a7c1102b9f86f42e6b58edf`, accepted-main comparison base `e9df2294fa580fd2885343bbef0cec28e81ead4c`. The worktree was clean after verification. The diff adds only `scripts/ci/check-queries.mjs` and `scripts/ci/check-queries.test.mjs`; there is no package, CI, dependency, exemption, production API, or documentation wiring change.
- Read the task's AGENTS instructions, repository workflow and operating guidance, current planning records, the accepted query-ownership contract in `docs/04-engineering/coding-standards.md` at `0627093df3ef9a7cf6784d242642a22cf887a077`, both full candidate files, the author repair handoff, the current independent ordinary review and the prior full Sol blocker report. The prior blocked verdict remains attached to `6ec1667e0460fa077a16d9d0d7603eb5cba6cf75`; this review adjudicates the new exact head. Live PR and issue lists were checked; this preparation branch is not an open PR.

## Security/correctness adjudication

1. **Exact location scope is restored.** `runQueryOwnershipCheck` walks production `apps/api/src`, and `analyzeQueryOwnership` keeps API-source containment separate from the root-relative path used by both the 14-entry `INFRA` set and repository-name classifier. The latter has no blanket `database/**` allowance, per-site exemption or baseline. The end-to-end fixture uses the actual analyzer and typed source: no location finding for any of the 14 named infrastructure files; a sibling unlisted source receives a location finding. This closes the prior path-form blocker.
2. **Public output edges are followed.** The checker detects named Drizzle builders and SQL fragments, then traverses union/intersection constituents, type arguments, awaited results, callable/construct signatures, visible object properties and index-signature values. Unconstrained type parameters and unproven shapes fail closed. The type-clean `T | undefined` fixture produces the unresolved-boundary finding, while a concrete row projection and awaited row outputs remain accepted. This closes the prior union-wrapper blocker without converting all generic results into allowed outputs.
3. **Imported public members are included.** The public member walk no longer stops at the current source file. It follows an imported interface's public `read(): SQL` through its exported repository value and reports a builder escape; an imported interface returning concrete promised rows passes. It excludes members only when their declarations prove private/protected and skips TypeScript standard-library prototype declarations. The real analyzer, rather than a helper stub, exercises both cases. This closes the prior imported-shape blocker.
4. **Other enforced edges remain intact.** I traced the TypeScript module-export graph, including aliases, anonymous defaults, namespace exports and explicit type-only exclusions; the checked fixture covers those along with Drizzle handle operations, raw SQL fragments, `pg` query/connect forms, computed/aliased calls, transaction opening and statement calls inside transactions. Syntax and semantic failures report unproven ownership. The two-file change does not alter the accepted tenant-predicate rule or claim that location analysis proves it.

## Checks actually run

- `node --test scripts/ci/check-queries.test.mjs`: **3 passed, 0 failed, 0 skipped**. The tests create temporary TypeScript fixtures and remove them in `finally`; there were no lasting worktree changes.
- `pnpm exec biome check scripts/ci/check-queries.mjs scripts/ci/check-queries.test.mjs`: **2 files checked, clean**.
- `git diff --check e9df2294fa580fd2885343bbef0cec28e81ead4c..4a69fc25194622494a7c1102b9f86f42e6b58edf`: **passed**.
- `git status --short --branch`: branch shown with no changed paths after the fixture run. I did not repeat a whole-API scan; the author already recorded its current diagnostic run, and the focused execution directly resolves the three prior blocker mechanisms.

## Limits and disposition

This clearance applies only to checker preparation at this exact SHA. `check:queries` remains intentionally unwired; the source tree still has outstanding query-location and public-boundary diagnostics. The author's 5,619 findings are diagnostic instances, not unique queries or a progress comparison with the earlier invalid-scope 5,985 run. Complete source conversion, final scope reconciliation, package/CI activation, required ordinary panel and exact-head Sol review for that later integrated candidate, and normal PR/CI acceptance remain future work. The checker does not prove tenant-predicate correctness or arbitrary executor-handle propagation. No production source, Docker, database, browser, push, PR or merge action was performed in this review.

---

## Retained evidence file — 580-query-checker-clean-install-readiness-luna.md

Origin SHA-256: `053c53313d32943e7bebe809a533e56371998454feb46a97edfe938246a3bc8d`.

# #580 checker clean-install readiness reproduction

Exact source: `4a69fc25194622494a7c1102b9f86f42e6b58edf`
Disposable worktree: `/private/tmp/query-checker-4a-clean` (detached at the exact source)
Node: `v26.10.0`; pnpm: `10.32.1`.

Reproduced the CI focused-test prerequisites with a clean worktree and no workspace package builds:

1. `git worktree add --detach /private/tmp/query-checker-4a-clean 4a69fc25194622494a7c1102b9f86f42e6b58edf`
2. `pnpm install --frozen-lockfile --offline` — passed; lockfile current, 1,244 packages installed, 0 downloaded.
3. `node --test scripts/ci/check-queries.test.mjs` — passed: 3 tests, 0 failures, 0 skipped; duration 7.3 seconds.

The focused checker tests import actual repository/API types and ran successfully without built workspace outputs. Therefore the proposed TS2307 missing-output failure was not reproduced at this exact head in this environment; no test setup changes were made. No API/build command, full CI script suite, Docker, or runtime test was run. This establishes readiness only for the focused test file; it does not verify the entire `pnpm test:ci-scripts` job. pnpm reported ignored third-party install scripts for Prisma, cpu-features, msw, protobufjs, and ssh2; none blocked these tests.

---

## D2 fragment containment correction — current source

**Reviewed head:** `7b5c54279095f0384e71964adc5bf31f979d8829`

The source now distinguishes valid SQL fragments composed in repository modules from executable builder escapes. A fresh audit found the earlier false positive; the first correction exposed a SQLWrapper-carrier escape, which the ordinary reviewer blocked. The current structural repair traverses public generic/member/signature/intersection graphs and uses proven native Drizzle SQL class provenance only for the opaque leaf, while inspecting its generic payload. Outside-repository calls/composition, real builders and unresolved shapes remain rejected. One strong independent ordinary delta clearance and a further fresh full independent Sol clearance bind the current source. All adverse reports remain below unchanged.

The earlier 5619-instance scan belongs to historical source4a, before fragment classification was corrected. It is neither a current count nor comparable progress; some earlier public-boundary reports were valid repository fragments. No new whole-production count was taken. The checker remains unwired, #764/#780 prerequisites unaccepted, and #580 incomplete. Source-scoped checks on separate candidate branches are not additive whole-program completion evidence.

---

Retained evidence file — 580-query-fragment-contract-audit-sol.md

# #580 SQL fragment contract/classifier audit (read-only)

**Verdict: BLOCKING contract mismatch / real false positive at checker preparation `260e18df6445ed0f4ac1a430507dad30355a9845`.** This is a bounded diagnostic, not an independent security approval of a later fix. Source exemplar is #580 batch-4 `bd5f76d8e7e6a88c34791f94e38ad377ce5c1447`; the accepted contract exists in that tree and the #764 reviewed clarification at `0627093d`. Neither checkout was edited. The scratch probe was deleted.

**Model provenance:** This context was assigned a fresh Sol-tier read-only audit by the conductor. The session identifies me as GPT-6; no runtime tool exposed a more specific model/version string, so this record does not claim one. I did not author `260e18df` or `bd5f76d`; design advice below disqualifies this context from independently approving its eventual fix.

## Contract and exact source

`docs/04-engineering/coding-standards.md:162-166` says repository functions await statements and return rows/DTOs/scalars, never un-awaited query builders; its separate raw-SQL paragraph says SQL fragment helpers, exemplified by a project-scope predicate, live in repository modules **and are composed there**. `docs/07-planning/security-reviews/764-query-ownership.md:153,208,450` confirms D2, with no per-site allowlist or baseline. The contract permits a fragment producer in one repository module to be imported by another repository module and composed into its statement. The `Results` rule governs executable statements returned for downstream composition, not a SQL predicate whose intended use is repository-side composition.

At `bd5f76d`, `apps/api/src/notification/task-reach.repository.ts:58` exports `projectReachPredicate`, which constructs a `drizzle-orm` predicate from `exists`, `and`, `sql` and nested selects. It is consumed within that repository at lines 276 and 301 and by `approval-reach.repository.ts:4,93`. The same file exports `reachableTaskNotificationPredicate` at line 282, consumed by `inbox.repository.ts:23,75-76`. `approval-reach.repository.ts:96` also exports `approvalNotificationReadable`, consumed by `inbox.repository.ts`. Repository production caller search found no service/controller consumers for those symbols. Their result is a predicate (`SQL`/`SQLWrapper`), not a pending executable select/insert/update/delete builder.

`check-queries.mjs:29-30` combines executable Drizzle builders and `SQL|SQLWrapper|Aliased` under one `DRIZZLE_QUERY_TYPES` regex. `isQueryBuilder` at 191-202 and `exportedQueryBoundary` at 204-225 therefore classify every public SQL fragment as `builder`. The module export pass at 842-980 rejects it with the `exported repository value exposes a query builder` message; it does not check whether consumers remain repository modules. The checker correctly has a separate outside-repository call-site check in `checkCandidate` at 710-782: a call returning typed SQL is a query site and is rejected when outside an allowed repository.

## Actual analyzer probes

1. Using the unmodified checker module at `260e18df`, a TypeScript API snapshot of the three actual `bd5f76d` notification repository files reported `task-reach.repository.ts:1` and `approval-reach.repository.ts:1` as `exported repository value exposes a query builder...`; `inbox.repository.ts:1` also reported an unresolved public value shape. The first two are the relevant false positives. The third was not diagnosed here and must not be conflated with this classification finding.
2. A disposable three-file TypeScript fixture inside `apps/api/src/.query-fragment-audit-*` exported `predicate(id) => sql\`id = ${id}\`` from `reach.repository.ts`, called it from `consumer.repository.ts`, and separately called it from `consumer.service.ts`. Analyzer output rejected both repository exports as builders and rejected the service call as `database operation predicate is outside an allowed repository or explicit persistence-infrastructure file`. This demonstrates both the false positive and that call-site detection already covers a direct outside-repository use. Fixture directory and tsconfig were removed in `finally`; no product or checker source edit was made. An initial probe accidentally placed files under `apps/api/` rather than `apps/api/src/`, so the analyzer correctly skipped them and returned zero; it was corrected before drawing this verdict.

## Minimal contract-consistent correction

Separate typed **SQL fragment** results from executable **Drizzle statement builder** results at the public export boundary. Permit the former only as repository-owned fragment helpers composed within repository modules. Preserve the existing fail-closed checks for true builder exports, unresolved public types/aliases, and raw `execute`/`sql` or SQL-returning calls outside allowed locations. The existing call-site check demonstrated above is enough for direct outside-repository fragment-helper calls; any wider assertion about aliases, namespace references or re-exported fragment values should be proved with regression fixtures before claiming full containment. Avoid a blanket SQL public-export exemption if it leaves a way to import a fragment and construct a statement in a service without a detected call. A structural typed classification plus focused producer/consumer, outside-call, true-builder and unresolved-shape regressions is the narrow path. No new owner vocabulary/contract decision appears necessary: D2 expressly names repository SQL fragment helpers and composition.

**Limits:** This audit did not run the full checker, tests, PostgreSQL, Docker or browser, and did not assess the separate `inbox.repository.ts` unresolved result. It cannot clear #580 or #797 review/merge gates.

---

Retained evidence file — 580-query-fragment-classifier-repair-luna.md

# #580 SQL fragment classifier repair handoff

**Result:** `DONE` for the bounded author repair; awaiting fresh independent ordinary and security review. This note records implementation and validation, not approval, activation, completion of #580, or merge readiness.

## Source and scope

- Worktree: `/Users/heinthura/.codex/worktrees/query-checker-580`
- Branch: `codex/query-checker-580-prep`
- Frozen source: `260e18df6445ed0f4ac1a430507dad30355a9845`
- Commit: `b2edd8cd000cdaa86c8175fdae5bf810e8abba98`
- Changed files only: `scripts/ci/check-queries.mjs`, `scripts/ci/check-queries.test.mjs`
- Working tree clean after commit. No push, PR, activation, docs, package/workflow changes, contract edits, allowlist/baseline changes, dependencies, or product-source edits.

## Repair

The previous classifier grouped executable Drizzle builders with `SQL` and `SQLWrapper`, so the public export walk rejected repository fragment helpers. The checker now classifies public fragment results separately from executable builders, checking true builder types first (including types that also implement `SQLWrapper`). Fragment recognition follows direct types, union/intersection constituents and implemented base interfaces, without treating arbitrary generic containers such as `Promise<SQL>` as fragments. Public type graph traversal accepts SQL fragment leaves while retaining unresolved, generic, alias/re-export, namespace, object/interface, and builder checks. Query call-site classification still recognizes SQL-returning calls and constructors so use/composition outside an allowed repository remains rejected.

The typed analyzer fixtures cover repository producer and consumer composition, function alias, explicit re-export, namespace export, imported SQL-shaped interface, SQL fragment object output, rejected external fragment call and external SQL composition, a `Promise<builder>` escape, and a builder type intersected with `SQLWrapper`. Existing true builder, unresolved, generic, object, class, default, namespace and other public-graph cases remain in the fixture suite. The unconstrained-output generic identity case remains unresolved/fail-closed.

## Verification

On exact commit `b2edd8cd000cdaa86c8175fdae5bf810e8abba98`:

- `node --test scripts/ci/check-queries.test.mjs`: 3 tests passed, 0 failed.
- `pnpm exec biome check scripts/ci/check-queries.mjs scripts/ci/check-queries.test.mjs`: passed.
- `node --check` on both changed files: passed.
- `git diff --check`: passed before commit.
- Final tree clean; commit contains exactly the two authorized files.

During fixture development, the initial focused run exposed a raw-SQL-constructor classification regression and a temporary malformed fixture; both were corrected. The final focused run is green. No whole production analyzer scan, PostgreSQL, Docker or browser verification was run; these are outside this bounded checker repair.

## Counts and limits

The historical `5,619` number in prior #580 evidence is diagnostic instances across production files, not unique queries. This repair did not run a new production scan, and no before/after count or conversion-progress claim is made. The bounded fixtures establish the exercised classifier behaviors only; they do not prove tenant predicate correctness, arbitrary interprocedural executor propagation, production conversion completion, or checker activation.

## Review and next action

The read-only Sol audit at `580-query-fragment-contract-audit-sol.md` found the pre-repair false positive and explicitly cannot independently review its fix. Obtain a fresh strong ordinary review and a different fresh full Sol review at exact head `b2edd8cd000cdaa86c8175fdae5bf810e8abba98`. Do not push or open/update a PR until both required reviews clear. #764 remains reviewed but unaccepted; #780 remains an unaccepted carrier prerequisite. #580 is not complete or accepted by this handoff.

---

Retained evidence file — 580-query-fragment-delta-ordinary-luna.md

# #580 query-fragment repair — independent ordinary review

**Verdict: BLOCKED.** The classifier repair fixes the reported direct fragment false positive, but introduces a fail-open path: classifying an outer public type as an SQL fragment short-circuits inspection of its other public type edges. A fragment carrier can therefore export an executable query builder through a generic argument or member.

## Provenance

- Reviewer: fresh independent review context; did not author, direct, or remediate this change.
- Model: GPT-6 (runtime exposes no more specific model/version introspection in this context).
- Role: strong ordinary review of the bounded CI/gate pass/fail repair.
- Exact candidate: `b2edd8cd000cdaa86c8175fdae5bf810e8abba98`
- Comparison base: `260e18df6445ed0f4ac1a430507dad30355a9845`
- Changed scope: `scripts/ci/check-queries.mjs`, `scripts/ci/check-queries.test.mjs`.

## Checks performed

- Read repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, active mission and author handoff; inspected the full candidate diff and relevant analyzer/public-graph code.
- `node --test scripts/ci/check-queries.test.mjs`: pass, 3/3 tests.
- `pnpm exec biome check scripts/ci/check-queries.mjs scripts/ci/check-queries.test.mjs`: pass.
- `git diff --check <base>..<candidate>`: pass.
- Reviewed the preservation fixtures for direct SQL fragment composition, aliases/re-exports/namespaces, outside-repository call/composition, `Promise<builder>`, and builder intersected with `SQLWrapper`.

## Blocking finding

`exportedQueryBoundary()` returns `{ kind: "fragment" }` immediately whenever `isSqlFragment(type)` is true (around lines 269–270). `hasSqlFragmentType()` follows base interfaces and recognizes the name `SQLWrapper`. Thus any public wrapper type that implements `SQLWrapper` is accepted as a fragment before its generic arguments, call signatures, or public members are examined. This is broader than accepting the SQL fragment leaf.

A concrete adversarial shape is:

```ts
import type { SQLWrapper } from "drizzle-orm";
import db from "../../database";
import { userTable } from "../../database/schema";
const pending = db.select().from(userTable);
interface FragmentCarrier<T> extends SQLWrapper { value: T }
export function leak(): FragmentCarrier<typeof pending> {
  throw new Error("type-shape fixture");
}
```

The exported function return type extends `SQLWrapper`, so `isSqlFragment` succeeds and the public graph walk stops before discovering `typeof pending`. A non-generic interface with a public builder property and `SQLWrapper` base has the same issue. This violates the retained guarantee that repository exports cannot expose a query builder anywhere in their public graph, and can permit downstream non-repository code to reach the pending statement through the fragment carrier.

Fix the classifier so fragment acceptance is limited to the actual fragment leaf/type identity without suppressing inspection of unrelated public edges. Add typed regressions for both a fragment wrapper with a builder type argument and a public builder member; preserve genuine SQL/SQLWrapper fragment acceptance and all existing failure cases. This is a bounded structural gap, not a request for a repository allowlist or baseline.

## Non-blocking observations

No other blocking issue found in the inspected delta. The current fixtures meaningfully cover the reported direct producer/consumer and alias/re-export/namespace cases, and the requested outside-repository call/composition negatives remain present. I did not execute an additional fixture because the short-circuit is directly evident from the checker control flow and the type shapes above.

## Limits

No source edits, database, Docker, browser, production scan, or activation were performed. This review does not approve the candidate or supersede the separate required fresh full Sol review. No production population or conversion-completion count is claimed.

---

Retained evidence file — 580-query-fragment-wrapper-repair-luna.md

# #580 SQLWrapper public-graph repair handoff

**Result:** `DONE` for the bounded author repair; fresh independent ordinary review is required, followed by a different fresh full Sol review. This handoff is implementation evidence only, not approval, activation, #580 completion, or merge readiness.

## Source and scope

- Worktree: `/Users/heinthura/.codex/worktrees/query-checker-580`
- Branch: `codex/query-checker-580-prep`
- Prior reviewed candidate: `b2edd8cd000cdaa86c8175fdae5bf810e8abba98` (ordinary BLOCKED report preserved separately at `580-query-fragment-delta-ordinary-luna.md`)
- Repair commit: `7b5c54279095f0384e71964adc5bf31f979d8829`
- Changed files only: `scripts/ci/check-queries.mjs`, `scripts/ci/check-queries.test.mjs`
- Working tree clean after commit. No push, PR, docs/package/workflow/contract/path-allowlist/baseline/dependency/product-source changes, or activation.

## Repair

The previous fix treated any type inheriting `SQLWrapper` as an opaque SQL fragment. This revision treats only the Drizzle-declared `SQL` class as the opaque fragment leaf, proving symbol name, class declaration and installed Drizzle declaration provenance. It checks the leaf's generic payload first, so `SQL<typeof pendingBuilder>` is rejected. `SQLWrapper`, its implementers and local types named `SQL` remain ordinary public graphs; their generic arguments, unions/intersections, awaited types, call/construct signatures, members and re-exported members are traversed by the existing fail-closed walker. SQLWrapper call-site results remain recognized so external fragment calls are rejected. Builder classification stays ahead of fragment handling.

Fixtures now exercise a generic SQLWrapper carrier with a pending builder type argument; a non-generic public builder member; intersection, custom class, reflected type alias, named re-export and `SQL<typeof builder>` leaks; and a user-defined class named `SQL` that must not be mistaken for Drizzle's fragment class. Positive cases retain actual Drizzle SQL fragment repository producers/consumers, aliases, re-exports, namespaces, public SQL-shaped interface/object output, and a SQLWrapper-returning fragment helper. Existing Promise-of-builder, unresolved, direct true-builder and unrelated public-shape controls remain.

## Verification

On the source tree committed as `7b5c54279095f0384e71964adc5bf31f979d8829`:

- `node --test scripts/ci/check-queries.test.mjs`: 3 tests passed, 0 failed.
- `pnpm exec biome check scripts/ci/check-queries.mjs scripts/ci/check-queries.test.mjs`: passed.
- `node --check` on both changed files: passed.
- `git diff --check`: passed before commit.
- Final worktree clean; commit contains exactly the two authorized files.

During implementation, the first focused attempt failed because the native TypeScript API exposes symbol declarations as a `declarations` property rather than `getDeclarations()` in this context, and SQL constructor detection initially missed raw SQL tag results. Both were corrected; the final focused suite, formatter, syntax checks and diff check pass. A temporary test fixture from the failed analyzer probe was removed. No checker population scan, PostgreSQL, Docker or browser verification was run.

## Counts and limits

No new production analyzer count was produced. Historical diagnostic-instance counts remain non-unique and are not compared as progress. The fixtures demonstrate the covered public type-graph cases; they do not prove tenant predicate correctness, arbitrary interprocedural executor propagation, full production conversion, or checker activation.

## Review and next action

Request a fresh strong independent ordinary review at exact head `7b5c54279095f0384e71964adc5bf31f979d8829`. If it clears, obtain a different fresh full Sol review. The prior b2 ordinary BLOCKED report remains unaltered and source-bound. No push or PR action was performed. #764 remains reviewed but unaccepted; #780 remains an unaccepted carrier prerequisite.

---

Retained evidence file — 580-query-fragment-wrapper-ordinary-luna.md

# #580 SQLWrapper public-graph repair — independent ordinary review

**Verdict: CLEAR for the reviewed delta at this exact head.** The revision closes my prior blocker: only the Drizzle-declared `SQL` class is treated as the fragment leaf, its generic payload is checked, and `SQLWrapper` carriers continue through the public type graph. I found no new blocking issue in the bounded change.

## Provenance

- Reviewer: fresh independent review context; did not author, direct, or remediate this revision.
- Model: GPT-6 (runtime exposes no more specific model/version introspection in this context).
- Role: strong ordinary delta review of the bounded CI/gate pass/fail repair.
- Exact candidate: `7b5c54279095f0384e71964adc5bf31f979d8829`
- Comparison base: `b2edd8cd000cdaa86c8175fdae5bf810e8abba98`
- Prior ordinary finding: BLOCKED on `b2edd8c`, preserved unchanged in `580-query-fragment-delta-ordinary-luna.md`; this verdict applies only to the remediation delta and current exact head.
- Changed scope: `scripts/ci/check-queries.mjs`, `scripts/ci/check-queries.test.mjs`.

## Checks performed

- Read the repair handoff and inspected the full exact delta, classifier order, SQL leaf provenance check, fragment generic-payload traversal, public output graph traversal, and the added positive/negative fixtures.
- Confirmed the installed declaration shape directly: `drizzle-orm@0.45.2` declares `SQL<T = unknown>` as a class and `SQLWrapper` as a separate interface in `sql/sql.d.ts` under the pnpm-installed Drizzle package.
- `node --test scripts/ci/check-queries.test.mjs`: pass, 3/3 tests.
- `pnpm exec biome check scripts/ci/check-queries.mjs scripts/ci/check-queries.test.mjs`: pass.
- `node --check` on both changed files: pass.
- `git diff --check b2edd8cd000cdaa86c8175fdae5bf810e8abba98..7b5c54279095f0384e71964adc5bf31f979d8829`: pass.
- No source edits or extra temporary fixtures were needed; the committed typed fixtures exercise the discovered escape shapes.

## Review findings

The previous problematic branch treated any type inheriting `SQLWrapper` as opaque. This delta removes that broad classification. `isDrizzleSqlFragmentLeaf()` resolves import/export aliases, then requires the `SQL` symbol, a class declaration, and Drizzle package declaration provenance. The public boundary handles executable builders first, inspects a native Drizzle `SQL<T>` payload before accepting that leaf, and traverses custom SQLWrapper implementations through their normal type graph. This keeps the useful fragment composition allowance without letting a custom wrapper hide a builder payload.

The new fixtures cover generic and member carriers, an intersection, class implementation, reflected type alias, re-export, native `SQL<Builder>` payload, and a locally declared class named `SQL`. The positive SQLWrapper fragment helper is checked as repository-safe, while the earlier producer/consumer composition and outside-repository call/composition negatives remain. The type provenance predicate is based on the installed Drizzle declaration, not a source-file/customer/repository allowlist or a rendered type name alone.

No blocking or non-blocking findings from this delta. The old finding remains valid as history for `b2edd8c`; it is addressed in the current candidate and is not an unresolved current-head finding.

## Limits and residual gates

This verdict covers ordinary review of the bounded delta only. A separate fresh full Sol security review is still required at `7b5c54279095f0384e71964adc5bf31f979d8829`; the earlier design-audit context cannot approve this fix. No production scan/count, activation, PostgreSQL, Docker, browser, push, or PR action was performed. Checker wiring, #580 completion, and acceptance remain outside this review.

---

Retained evidence file — 580-query-fragment-security-current-sol.md

# #580 SQL fragment wrapper repair — independent full security review

**Verdict: CLEAR** for the bounded, unwired checker repair at exact head `7b5c54279095f0384e71964adc5bf31f979d8829`. I found no blocking or non-blocking issue in this candidate. This verdict does not approve checker activation or #580 completion.

## Provenance and scope

- Fresh independent security reviewer context `/root/query_fragment_security_final`. The conductor dispatched this context with `fork_turns=none` and an explicit `gpt-6-sol` request for a full security pass. The visible runtime identifies as GPT-6 but exposes no independently verifiable Sol subvariant; `gpt-6-sol` is the dispatch designation, not a runtime attestation. I did not author, direct, design, advise on, or remediate this fix. The earlier Sol contract audit that advised a correction is a distinct, disqualified context for reviewing its own design.
- Candidate/worktree: `codex/query-checker-580-prep`, `/Users/heinthura/.codex/worktrees/query-checker-580`, exact `HEAD` above. Delta base: `b2edd8cd000cdaa86c8175fdae5bf810e8abba98`. The delta changes only `scripts/ci/check-queries.mjs` and `scripts/ci/check-queries.test.mjs`; the worktree was clean after verification.
- Read repository instructions, active mission, workflow/model policy, provider adapter, the accepted query-ownership contract at `0627093df3ef9a7cf6784d242642a22cf887a077`, the exact source/test delta, the preceding ordinary blocker and its current-head CLEAR review, and the independent contract audit. The prior adverse verdicts remain attached to their own exact heads. This review independently adjudicates the current code, not those verdicts.

## Security adjudication

The contract permits repository-owned SQL predicate helpers to be exported and composed in another repository, while executable statements may not cross that boundary. The prior broad `SQLWrapper` fragment shortcut could hide a pending builder in a custom carrier. The current `exportedQueryBoundary` checks executable builder identity first. It then treats only the installed Drizzle `SQL` **class declaration** as an opaque fragment leaf, requiring the resolved symbol name, class declaration kind, and Drizzle package declaration path. The local class named `SQL` and custom `SQLWrapper` implementations therefore continue through the ordinary public output graph. The leaf's type arguments are recursively inspected; unknown is allowed as Drizzle's default payload, while builder, any/unresolved, and other unproven payloads fail closed.

I traced that ordinary graph through union/intersection constituents, generic arguments, awaited types, call/construct returns, visible properties, index values, imported declarations, and runtime re-export/namespace members. The added typed negatives cover `SQLWrapper` generic, property, intersection, implementation, reflection and re-export carriers, native `SQL<builder>`, and a local lookalike class. They exercise the real analyzer rather than a mocked classifier. The typed positive allows a plain `SQLWrapper` fragment helper. Earlier fixtures continue to reject direct executable builder exports, `Promise<builder>`, `SQL.Aliased`, unresolved generics, outside-repository fragment-helper calls and SQL construction/composition; repository producer/consumer composition stays accepted. I found no per-site exemption, baseline, rendered-type-string-only exemption, or gate activation in this delta.

## Checks actually run

- `node --test scripts/ci/check-queries.test.mjs`: **3 passed, 0 failed, 0 skipped**. This includes the real-analyzer typed fixture and the exact infrastructure-path regression.
- `pnpm exec biome check scripts/ci/check-queries.mjs scripts/ci/check-queries.test.mjs`: **2 files checked, clean**.
- `node --check` for each changed `.mjs` file: passed.
- `git diff --check b2edd8cd000cdaa86c8175fdae5bf810e8abba98..7b5c54279095f0384e71964adc5bf31f979d8829`: passed.
- `git status --short --branch`: clean branch after tests.

## Limits and disposition

This is security clearance for the two-file checker-preparation delta only. `check:queries` is still unwired, complete production conversion and final scope reconciliation are unaccepted, and the checker does not prove tenant predicates or arbitrary executor propagation. I did not run a full production scan, PostgreSQL, Docker, browser or source acceptance, and make no production finding-count or completion claim. No source edits, commit, push, PR or merge action occurred in this review.
