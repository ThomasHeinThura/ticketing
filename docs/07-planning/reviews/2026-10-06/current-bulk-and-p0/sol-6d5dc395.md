# Independent GPT-6 Sol security and structural review — PR #589

**Reviewed head:** 6d5dc395b02b6ab28f18f18552188eaf27eab0ab  
**Comparison base:** 3096cb044bdf6ae98488bfc385f532fa6386343a; exact remediation parent 73e3da95b4f6edec318b009c8f754b4ef8c36332  
**Reviewer:** independent GPT-6 Sol security reviewer. I did not author, direct, or remediate the candidate. I reviewed earlier f87/bda/73e3 heads in this same independent context; this is an exact-head re-review of the author's new delta, not an author self-review. I made no source edits or merge.  
**Verdict:** **BLOCKED** — one P1 statically known transaction-type alias bypass remains in the query ownership gate. This is a per-PR Sol review, not a P0–P4 phase finalizer or full product acceptance.

## Scope and disposition of previous findings

I verified the clean checkout and live PR SHA, read the current author packet, prior independent Sol/Luna review lineage, repository operating instructions and query-ownership contract, and inspected every line of the three-file 73e3→6d delta. I rechecked representative whole-candidate security boundaries from the prior full reviews: auth reload/provider defaults, portal isolation, SCIM/identity authority, approvals/current reach/CAB, schema/migrations, outbox reservation fencing and CI controls. This delta changes only the CI checker, its regression tests and contract prose; those product implementations are unchanged. I did not independently execute SQL, runtime or browser acceptance.

The previous P1 is addressed: known `db.transaction` lookups forwarded through `.call`, `.apply` and `Reflect.apply`, or captured before invocation, now produce a `transaction` gate violation outside repositories. Direct `db.transaction((tx) => tx.select())` remains permitted as transaction orchestration while its `tx.select()` is reported. The direct callback boundary preserves existing API source: `pnpm check:queries` passes. Named `schema` imports from the database module and unrelated `BusinessTransaction` annotations no longer become database executors in my probes. Type-only `typeof db.transaction` is excluded. Read-method references still trigger at lookup, so the original nested forwarding bypasses remain closed.

## Blocking finding

### [P1] A registered transaction type loses database identity through a simple type alias

The checker records imported `DbTransaction` and `DatabaseInstance` names, and structurally derived local transaction types, in sets. Its alias collection does not propagate a simple `TSTypeReference` to another local type alias. A typed parameter using that alias is therefore treated as unrelated, even though TypeScript resolves it to the same database/transaction type:

```ts
import type { DbTransaction } from "../events/outbox";
type Tx = DbTransaction;
function read(tx: Tx) {
  return tx.select();
}
```

At this SHA, `queryReadViolations()` returns `[]` for this source outside `repository.ts`. Changing the annotation to `tx: DbTransaction` reports `select`. The same bypass works for `type MyDb = DatabaseInstance` after its registered import, and for `type Alias = Tx` when `Tx` is structurally derived from `typeof db.transaction`. These are simple statically known type aliases, not dynamic/computed source or interprocedural flow. The current implementation can thus allow an unscoped read through a transaction parameter in a feature service/controller solely because the type has a local alias. The gate's lookup invariant needs type-alias closure tied to lexical/import identity (and cycle handling); name suffix guessing is not a safe substitute. Add positive regression cases for one and chained aliases, and negative cases for unrelated/shadowed aliases.

## Other observations and residuals

- Direct `db.transaction<SomeType>((tx) => …)` remains permitted in the actual source. A parenthesized `(db.transaction)((tx) => …)` is reported as an escaped transaction even though it invokes directly; this is a narrow fail-closed false positive under the documented direct-callee exception, not a current-source blocker. The full-source gate passes.
- The 6d checker recognizes database identity only from exact database default imports or registered type origins. That is a defensible bounded scope; dynamic imports, arbitrary type inference/interprocedural transfer and dynamic computed property names remain outside the documented gate. The simple alias finding above is inside the static type-reference scope.
- The prior root Linux G8 evidence for work-item detail and reported 73e hosted G8 screen 15/15 and Storybook 143/143, plus G11 18/22, are retained evidence at their recorded SHAs; I did not rerun or transfer them to 6d. `user_deactivation` OpenAPI evolution, PR metadata/security-review gate, and remaining hosted/runtime acceptance remain separate.
- Historical whitespace in an unchanged original review artifact remains in the full base diff. The current 73e→6d delta is clean.

## Checks actually performed

- `node --test scripts/ci/check-queries.test.mjs`: **19/19 passed** at 6d.
- `pnpm check:queries`: passed over actual API source.
- Direct exported-checker probes: forwarded transaction references report `transaction`; direct callback runner reads report `select`; direct registered `DbTransaction` reports `select`; three simple/chained registered type-alias cases returned no violation; named `schema` import and `BusinessTransaction` returned no violation.
- `git diff --check 73e3da95..HEAD`: passed.
- `gh pr view 589`: exact live head matched 6d. At observation time, PR template/security-review and OpenAPI drift were failed; G8, G11, PostgreSQL integration and several other checks were still in progress. This review does not clear them.

I did not run SQL apply/DB integration, Docker/image boot/health, browser, performance, real Entra/provider credentials, or full repository tests. The author packet reports Biome and delta verification; I did not independently rerun Biome. This review does not close hosted CI, product acceptance, pending contracts, ordinary-review lineage or phase finalizers. **Do not merge 6d** while the demonstrated gate bypass and other required gates remain unresolved.
