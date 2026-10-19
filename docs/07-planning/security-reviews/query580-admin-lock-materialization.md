# Instance administrator lock helper — #580 partial materialization

**Reviewed head:** `34c7c3aae014af407491fd137ffba077c2aa93ad`
**Comparison base:** `17b877c31136a89ef55ee872249fb7f1ce6d4813`

The one-file source delta (4 additions / 2 deletions) makes `lockInstanceAdminSerialization` return `Promise<void>` and await its existing statement. SQL, advisory key 2026, executor, four awaited callers and their ordering are unchanged. This does not repair pending-action N1; that finding remains unresolved and unwaived. The checker remains unwired and whole #580 remains open.

## Provenance and scope

Implementation: fresh GPT-6 Luna context `/root/remaining580_type_boundary_plan_luna`, session01a14a9d-3c92-73e3-8a6a-e0db3e1d07e9. Ordinary A: fresh `/root/adminlock34c7_ordinary_a_luna`, session01a14abd-2a47-7363-98b4-d9fa9e02d1d4. Ordinary B: fresh `/root/adminlock34c7_ordinary_b_luna`, session01a14abd-584f-7f62-aaae-6c1b3cae07d3. Native platform turn metadata corroborates all three as **gpt-6-luna / medium**, provider openai, with distinct sessions and the expected parent/agent paths. Session metadata has no model field. Review A's self-description as GPT-6 and inability to claim Luna is an introspection limitation; the conductor independently checked the actual platform model metadata. Its authentic report is preserved unchanged below; no hidden serving fingerprint is claimed or required.

Two fresh independent ordinary contexts are CLEAR for the exact bounded source. The changed repository path is outside the mandatory security path list, and both inspections confirm no authority/gate/lock-order change. No security clearance or N1 remediation is claimed. Publication of this note transports the original report bytes only.

## Actual verification and limits

Root ran frozen install, one-file Biome check, API dependency builds and all five existing API no-emit configurations: native zero. The complete existing administrator-guards PostgreSQL suite passed **1 file / 24 tests**, native zero in 13.838 seconds with no timeout. It used owned disposable PostgreSQL 18, exact tmpfs data, a dynamic loopback-only port and complete exact-ID cleanup; container/volume/network inventories and source identities were conserved. Static 19 test declarations were never substituted for the actual 24 parameterized runtime tests. The prior unexecuted harness v1 was corrected before execution to route its host connection through the existing bridge.

One current diagnostic on the frozen helper source exited 1 in 18.968 seconds with unchanged tracked inputs: **2,794 overlapping diagnostic instances / 154 paths / 1,549 path-line locations**, twelve unresolved exported-type module rows and zero explicit exported-builder rows. These are not unique queries, progress or a baseline. The earlier diagnostic had one explicit builder row in this module. The current parser's first summary incorrectly counted unresolved wording containing “query-builder escape” as explicit builder rows; the authentic corrected summary compares the exact diagnostic prefix and retains the original parser output. Raw stderr is 481,229 bytes, SHA256 `d0c68f0beb615e3c4632a5eb38649aad6d8e85f43684e222b483a607b5a191dc`.

Verification used base30d8 with this exact source blob `e849e0d7f0344785a4586d0e6a18f17e2c8afad2`; accepted #824's three records were then fast-forwarded before source commit. Every other mode/type/blob entry equals accepted17b877. Product/test/build/lockfile inputs are unchanged. Required hosted checks and image build/boot/health remain mandatory on publication; no result is presumed here. No UI was changed or browser screen opened. No signed release, SIT, recovery, stage or final-audit acceptance.

## Original ordinary A report (unchanged)

# Independent ordinary review — instance-admin lock materialization

**Role:** Fresh independent ordinary correctness review (assigned Ordinary A).
**Model:** GPT-6 (platform-reported context; exact served model/version fingerprint is unavailable here). This report does not claim GPT-6 Luna provenance.
**Reviewed head:** `34c7c3aae014af407491fd137ffba077c2aa93ad`
**Comparison base:** `17b877c31136a89ef55ee872249fb7f1ce6d4813`
**Worktree:** `/Users/heinthura/.codex/worktrees/query580-admin-lock/Ticketing.v2`
**Independence:** I did not author, direct, or remediate this candidate. I reviewed the exact source and relevant call sites independently.
**Verdict:** **CLEAR** for the bounded materialization-only delta. No blocking or additional non-blocking correctness finding identified. This is not a security review, merge approval, #580 completion, or clearance of inherited findings.

## Scope and checks

Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/07-planning/active-mission.md`, the applicable query-ownership contract in `docs/04-engineering/coding-standards.md`, and the supplied #580 admin-lock materialization plan. Compared the exact candidate and base. The only changed path is `apps/api/src/instance/users/repository.ts`, with four additions and two deletions. Inspected the helper and all four call sites: three in `apps/api/src/instance/users/index.ts` and one in `apps/api/src/pending-action/service.ts`.

Inspected the installed Drizzle 0.45.2 declarations for `PgDatabase.execute`, `PgRaw`, and `QueryPromise`. `execute()` returns `PgRaw`, which implements `Promise`/thenable behavior. The candidate's `async` helper awaits this thenable, so the query is driven to settlement before the helper resolves; the async wrapper assimilates the thenable and rejects if its execution rejects. The declared `Promise<void>` intentionally discards the result while preserving the successful completion boundary.

## Correctness assessment

The source changes only the exported helper from a synchronous function returning Drizzle's query-like value to `async (...): Promise<void>` that awaits the same `executor.execute(sql`SELECT pg_advisory_xact_lock(2026)`)`. The SQL, key, executor, transaction owner, and call positions are unchanged. All four callers already use `await lockInstanceAdminSerialization(tx)`, so each transaction still waits for acquisition before its next operation. Failure continues to reject the caller's transaction callback and therefore does not permit following work to proceed after an unsuccessful lock statement.

This matches the repository contract that query functions await statements and return materialized values rather than exposing a query builder. I found no change to authorization, role checks, lock ordering, or transaction boundaries in this delta. The `git diff --check` comparison reported no whitespace issue.

## Findings and residuals

- **Blocking:** None.
- **Non-blocking:** The inherited pending-action N1 advisory/action-row lock-order inversion remains unresolved and unwaived. This change does not touch issuance ordering, reproduce the deadlock, or fix N1. The known separate `userDirectoryProjection` query-inventory row and broader #580 unknown/module findings are also outside this diff and remain unresolved; this review makes no inventory-wide claim.

## Execution limits and evidence

I ran no Node, typecheck, test, Docker, build, database, query-inventory checker, or runtime command, per assignment. The root-provided E17 verification summary is contextual evidence only: focused PostgreSQL preparation completed 1 file/24 tests with native exit 0; the actual query-inventory diagnostic completed with 2,794 overlapping instances across 154 paths and 1,549 locations, 12 unknown-module rows and zero explicit-builder rows after parser correction. The checker remains unwired and whole #580 is not complete. I did not independently execute or revalidate those runs, and they do not change this source-only review scope.

## Original ordinary B report (unchanged)

# Independent ordinary review B — admin lock helper

**Reviewer/model:** GPT-6 Luna (platform-reported task model)
**Role:** Fresh independent ordinary review B
**Independence:** This context did not author, direct, or remediate the candidate; no inherited author conversation was supplied.
**Candidate:** `34c7c3aae014af407491fd137ffba077c2aa93ad`
**Comparison base:** `17b877c31136a89ef55ee872249fb7f1ce6d4813`
**Verdict:** CLEAR for the bounded helper materialization change.

## Scope checked

- Read repository guidance (`AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`), the active mission, current status, the query ownership contract in `docs/04-engineering/coding-standards.md`, the relevant #580 decision entry, and God Mode's administrator-lock contract.
- Inspected the complete exact candidate diff and confirmed the worktree HEAD is the candidate SHA. The only changed file is `apps/api/src/instance/users/repository.ts` (4 additions, 2 deletions).
- Inspected the installed Drizzle 0.45.2 declarations and implementation: `PgDatabase.execute()` returns `PgRaw`; `PgRaw` extends `QueryPromise`; the node-postgres execution path performs the query when awaited. The new helper awaits that exact execute result and resolves as `Promise<void>`.
- Searched and inspected all four callers: three in `apps/api/src/instance/users/index.ts` and one in `apps/api/src/pending-action/service.ts`. Each already awaits the helper inside its pre-existing transaction callback.
- Checked the `pg_advisory_xact_lock(2026)` SQL/key and nearby calls. Both remain unchanged; no lock acquisition order, transaction ownership/lifetime, error handling, authority, or caller sequencing change was found.
- Ran `git diff --check` (clean). No tests, Node execution, Docker, build, or heavy work was run, per review assignment. Existing preparation/runtime evidence was not independently reproduced or treated as this review's test result.

## Findings

**Blocking:** None in the reviewed diff.

**Non-blocking / retained residual:** Pending-action N1, the previously documented possible lock-order availability/deadlock interaction, remains unresolved and unwaived. This diff preserves the existing order and does not claim to fix or reproduce N1.

**Security classification:** The changed source path is not among the security-review paths enumerated in `docs/04-engineering/ci-cd.md`. Inspection found no authority or gate semantics change. This ordinary verdict does not replace any separately required review or candidate gates.

## Limits

This is a source-level review of the exact one-file delta plus installed Drizzle types/implementation. It does not establish runtime PostgreSQL behavior, resolve N1, wire or pass the #580 checker, or claim #580 completion. The checker remains unwired and the owning inventory retains unresolved rows as documented in current status.
