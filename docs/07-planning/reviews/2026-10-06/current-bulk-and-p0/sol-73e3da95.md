# Independent GPT-6 Sol security and structural review — PR #589

**Reviewed head:** 73e3da95b4f6edec318b009c8f754b4ef8c36332  
**Comparison base:** 3096cb044bdf6ae98488bfc385f532fa6386343a; exact remediation parent bda2970d24774fc77a9acc6a3ee1aa99b754d3eb  
**Reviewer:** independent GPT-6 Sol security reviewer; I did not author, direct, or remediate any candidate. This is the same independent reviewer context that reported the f87 and bda failures, now rechecking the changed exact head; it is not an author self-review. I made no source edits or merge.  
**Verdict:** **BLOCKED** — a P1 query ownership gate false negative remains at a statically known transaction callback boundary. This is the per-PR Sol review, not a P0–P4 phase finalizer or product/runtime acceptance.

## Scope

I verified the clean checkout and live PR head at the exact SHA. I read the current packet, bda/f87 Sol reports, original bulk packet and independent Luna lineage, repository operating instructions, the changed CI contract, and G8 Linux evidence. I inspected every source/text line in the four-file bda→73e3 delta and traced the query gate against its canonical repository-ownership contract and actual API call sites. I carried forward prior whole-candidate security examination of auth reload/provider/portal separation, permissions/SCIM trust, schema, approvals and current reach/CAB, outbox reservation fencing, and CI controls; the present delta changes none of those product implementations. The original full review context does not replace live DB, image, browser or performance checks.

The structural shift correctly flags known Drizzle read-method **lookups**, including aliases, destructuring and the f87/bda nested `Reflect.apply` and `.call`/`.apply` compositions, regardless of invocation syntax. I reproduced representative direct, alias, destructured and transaction-callback cases. Lexical block shadowing of an imported database value and type-only `typeof db.select` references were ignored as intended. Static computed names were detected; computed expressions such as `db["se" + "lect"]` remain explicitly outside the documented bounded gate. Dynamic receivers and raw SQL transport are also outside its stated scope.

## Blocking finding

### [P1] Forwarded transaction callback loses known database identity

`collectStaticBindings()` marks an inline callback parameter as a database only when the call's *immediate callee* resolves to `transactionMethod`. A direct `db.transaction((runner) => runner.select())` is caught, but a statically known transaction method forwarded through `call`, `apply`, or `Reflect.apply` is not. The read lookup on `runner` then resolves as an unknown parameter, so the source passes `check:queries` outside a repository:

```ts
import db from "../database";
db.transaction.call(db, (runner) => runner.select());

db.transaction.apply(db, [
  (runner) => runner.query.person.findMany(),
]);

Reflect.apply(db.transaction, db, [
  (runner) => runner.select(),
]);
```

At this SHA, `queryReadViolations()` returns `[]` for all three. These are statically known local expressions with inline callbacks and literal arrays; no dynamic/interprocedural inference is needed. The gate tests and whole-source gate pass despite them. The source lookup rule is therefore sound for a known `db.select` reference but incomplete for *new database bindings introduced by known transaction callbacks*. This is a real route back to an unscoped read outside feature repositories.

The canonical contract in `coding-standards.md`, `security-model.md`, `multi-tenancy.md` and `ci-cd.md` requires repository ownership of Drizzle reads, while actual controllers/services legitimately orchestrate transactions. I found `db.transaction(` in 82 API source files, many outside `repository.ts`; flagging every direct transaction lookup would reject valid current code and broaden the gate. A narrower structural boundary appears feasible: outside repositories, allow a known transaction-method reference only as a direct call with a recognized inline callback, and reject runtime escapes/captures/passes of that method. A source scan found non-repository runtime uses as direct calls; non-call appearances were type queries such as `typeof db.transaction` and comments, which must remain excluded. This is a proposed remediation boundary, not an implemented or reviewed fix.

## Other observations and residuals

- The gate marks *every* runtime import from a path containing `database` as a database instance. For example, `import { schema } from "../database"; schema.select()` is reported as `select` although `schema` is not the Drizzle executor. It also treats any type ending in `Transaction` as a database transaction (`BusinessTransaction` repro). These are false positives, not demonstrated current-source failures or authority bypasses. They should be constrained to proven bindings as part of structural gate maintenance.
- The old direct-read alias false positives reported at f87 are superseded by the lookup-site binding model for its tested shadowing cases. Type-only references remain ignored in my probes.
- The bda G8 work-item detail fixture returns `{ approvals: [] }` in the correct route branch. I read the retained Linux AMD64 evidence: scoped visual capture and strict replay passed 1/1 each on bda with title and screenshot assertions, and root inspected the actual `/agent/work-items/HELP-7` screenshot at 1280×720. The 73e3 commit replaces the expected PNG with that captured baseline (reported SHA256 `d54bb90f23c661f045e3043b1904e337e695f3fcc3f2e0b61dcb15ef6e555900`). This establishes the documented source/capture provenance, not current-head hosted G8 or authenticated DEV acceptance.
- The `user_deactivation` pending-action OpenAPI enum expansion and approver-picker route/source remain pending contracts; no behavior or waiver was invented. Historical trailing whitespace in an unchanged original review artifact remains in the full base diff; the current delta is clean.

## Checks actually performed

- `node --test scripts/ci/check-queries.test.mjs`: **17/17 passed** at 73e3.
- `pnpm check:queries`: passed against the API source.
- Direct exported-checker probes: the three forwarded transaction forms above each returned no violation; direct transaction read, imported/aliased/destructured read references and previous Reflect compositions were detected. Shadowed imported DB and type-only references were ignored.
- `git diff --check bda2970d..HEAD`: passed.
- `gh pr view 589`: exact live head matched 73e3. At observation time, the PR template/security-review gate, OpenAPI drift, and GitGuardian check showed failure. G8, G11 and PostgreSQL integration were in progress; this review does not clear them.

I did not run SQL apply/DB integration, Docker/image boot/health, browser, performance, real Entra/provider credentials, or full repository tests. Author packet reports Biome, web typecheck and PNG capture/replay; I did not rerun those. This review does not close current-hosted CI, product acceptance, pending contracts, ordinary-review lineage or phase finalizers. **Do not merge 73e3** while the demonstrated gate bypass and other required gates remain unresolved.
