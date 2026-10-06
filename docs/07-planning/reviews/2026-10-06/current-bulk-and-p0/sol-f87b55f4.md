# Independent GPT-6 Sol security and structural review — PR #589

**Reviewed head:** f87b55f4b66450ef397bbca6b58e26d39bd2f208  
**Comparison base:** 3096cb044bdf6ae98488bfc385f532fa6386343a  
**Reviewer:** fresh independent GPT-6 Sol context. I did not author, direct, or remediate this candidate. I made no source edits and did not merge.  
**Verdict:** **BLOCKED** — one reproduced P1 query ownership gate bypass remains. Live required checks also fail on this exact head. This is the per-PR Sol pass, not a P0–P4 phase finalizer or product acceptance.

## Scope and evidence

I verified the clean worktree at the reviewed SHA and the live PR head at the same SHA. I read `AGENTS.md`, `agent-workflow.md`, `CLAUDE.md`, the newest decision log, status, the bulk review packet, initial three Luna reports and their current-head delta reports. I inspected the full changed-file inventory and the f87 delta, then traced representative authorization, identity, approvals, schema, outbox fencing, auth reload and query gate paths in the composite candidate. Relevant contracts included `docs/03-features/{approvals,customer-portal,identity-provisioning,notifications}.md`, `docs/01-architecture/{auth-and-identity,auth-runtime-reconfiguration,security-model}.md`, and `docs/04-engineering/ci-cd.md`.

The prior auth reload finding is addressed by a stable, table-separated row ID/version fingerprint. The prior SLA cross-calendar pause finding has focused regression cases and was independently cleared in the Luna delta reports. Portal route metadata expectations were corrected. The f87 query change adds lexical/static resolution of global `Reflect`, aliases, destructuring, sequence expressions, bound arguments, and direct `call`/`apply` forwarding. Inspection of the representative source found no separate demonstrated authorization escalation in these areas: customer portal routes require customer identity and named approver; decision service rechecks current work-item reach and locks the pending approval row; OIDC role input rejects `instance:admin` and `sees_all`; auth local providers default disabled on the customer portal and keep agent password; outbox provider attempts use reservation tokens and lease checks. These are inspection conclusions, not live DB or browser acceptance.

## Blocking source finding

### [P1] Static nested `Reflect.apply` still bypasses `check:queries`

The new invariant resolves a statically known `Reflect.apply` target only when that target is directly a query-read method. When the known target is itself `Reflect.apply` (or a statically bound alias of it), the visitor stops one layer early. Both valid JavaScript expressions below execute `db.select()`, yet `queryReadViolations(source, 'x.ts')` returns `[]`:

```ts
Reflect.apply(Reflect.apply, Reflect, [db.select, db, []]);

const r = Reflect.apply.bind(Reflect, db.select);
Reflect.apply(r, null, [db, []]);
```

I reproduced both with the exported checker at this SHA. The same direct `db.select()` call is reported. These expressions require only static local expression and binding resolution, within the documented bounded gate scope; they do not require dynamic or interprocedural inference. This is the same forwarding class that blocked the d747 review. The checker should follow statically known invocation targets to a bounded fixed point (with cycle protection), then apply the read-method rule, with regression tests for nested forwarding. Do not address this by a single spelling-specific branch.

## Non-blocking structural observation

The pre-existing direct read-alias pass still uses a file-wide `collectAliases` name map rather than the new lexical bindings. A local parameter or block `read` shadows `const read = db.select`, but `read()` in that scope is still reported as `select`; a reassigned `let read` likewise remains reported. I reproduced all three at this SHA. These are false positives, not an authority bypass, and no current production source is shown to fail because of them. They are worth folding into the same binding model when changing the gate, without turning this review into an unlimited syntax hunt.

## Exact-head checks actually performed

- `node --test scripts/ci/check-queries.test.mjs`: **17/17 passed**.
- `pnpm check:queries`: passed on repository source.
- Direct exported-checker probes above: **2 static nested forwarding false negatives reproduced**; three read-alias shadowing/mutation false positives reproduced.
- `gh pr view 589`: exact head matched. At review time, **pull request template + security review**, **contract - OpenAPI drift**, and **visual regression (G8)** were failed. Other checks, including G11 and PostgreSQL integration, were pending or had separate results; this review does not clear them.
- `git diff --check 3096cb04..HEAD`: failed on trailing whitespace in `docs/07-planning/security-reviews/p4-ae2b88bd-sol-security.md` lines 3–7, inherited from the composite diff. This is separate from the query gate finding.

The reported author full-suite counts, Linux AMD64 G8 evidence and original PNG baseline SHA were not independently rerun or accepted here. I did not run SQL apply/DB integration, image build/boot/health, browser product use, performance measurement, provider credentials/real Entra, or the full repository suite. I did not inspect every line of every one of the hundreds of generated migration snapshots or source files; the review used the changed-file inventory, prior independent panel evidence, focused security boundary tracing, and direct probes of the current correction. Hosted CI and root-owned runtime/product acceptance remain independent gates.

## Contract and merge disposition

The `user_deactivation` pending-action OpenAPI enum expansion and approver-picker route/source remain pending contract decisions; this review neither guesses nor waives them. The exact-head ordinary-panel lineage is not self-closed by this Sol review. No stage completion or phase finalizer is claimed. **Do not merge f87** while the query gate bypass, failed required checks, and remaining acceptance gates are unresolved. Remediate as one structural batch, freeze a new SHA, and review its delta at the required independent tier before protected merge.
