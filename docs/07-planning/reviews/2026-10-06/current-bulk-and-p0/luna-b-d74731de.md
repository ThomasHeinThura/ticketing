# Independent current-head delta review — domain and concurrency

- Candidate: `d74731dee08861b36e16d40f0ad212d25d395cd5`
- Reviewed delta: `7dd3cbb461e9a6567acb07eda64cd3bbaaac54de..d74731dee08861b36e16d40f0ad212d25d395cd5`
- Base: `3096cb044bdf6ae98488bfc385f532fa6386343a`
- Reviewer: fresh independent GPT-6 Luna context; no authoring or remediation
- Scope: full 10-file current delta, with primary review of the previously reported SLA pause defect and domain/concurrency behavior. Prior review of the unchanged 641-file composition remains in force.
- Verdict: **BLOCKED — one P1 query-ownership gate bypass remains in this delta**

## Checks performed

- Confirmed worktree `HEAD` is the exact candidate SHA and the worktree is clean.
- Read the complete delta and inspected neighboring implementations/tests.
- `pnpm --filter @taskdesk/domain exec vitest run src/sla/sla.test.ts`: **1 file, 35 tests passed**.
- `pnpm --filter @taskdesk/api exec vitest run ../../tests/api/auth/configuration-version.test.ts`: **1 file, 6 tests passed**.
- `node --test scripts/ci/check-queries.test.mjs`: **16/16 passed**.
- `git diff --check`: passed.
- SQL integration, full DB/API suite, image/runtime and browser checks were not run in this review context.

## Finding

### [P1] `check:queries` still misses a statically bound `Reflect.apply` read

The new recognition handles direct and aliased `Reflect.apply`, but it misses the bound-call form. Reproduced against the candidate parser:

```ts
Reflect.apply.bind(Reflect, db.select, db, [])()
```

`queryReadViolations(...)` returns an empty array even though this invokes `db.select()`. The visitor skips the `.bind(...)` partial application, then checks the outer zero-argument call; its `addAppliedRead` reads the outer call's arguments, not the target and arguments captured by `bind`. This provides a concrete source-level bypass of the query ownership gate that this delta expands. Add a regression for this exact form and recognize statically known bound arguments before considering the pass complete.

## Resolved prior finding and remaining delta assessment

- The prior P1 in `packages/domain/src/sla/sla.ts` is **resolved**. The implementation now includes pauses active at or spanning a calendar opening, including a pause beginning exactly at that opening. The added cases verify closed cross-gap pauses, open cross-gap pauses, and the exact-opening boundary; all 35 SLA tests pass.
- The auth version-vector change correctly compares sorted `(row id, config_version)` pairs across the independently versioned sources. The six focused tests cover masked lower-counter changes, ordering, addition/removal, and table identity. No domain/concurrency defect found in the inspected change.
- The portal route change only adjusts the expected generated route metadata in its test. No finding.
- Apart from the query-gate bypass above, no additional blocking or non-blocking finding in this delta.
