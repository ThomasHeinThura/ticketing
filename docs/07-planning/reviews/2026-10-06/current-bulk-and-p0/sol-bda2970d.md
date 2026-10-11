# Independent GPT-6 Sol security and structural review — PR #589

**Reviewed head:** bda2970d24774fc77a9acc6a3ee1aa99b754d3eb  
**Comparison base:** 3096cb044bdf6ae98488bfc385f532fa6386343a; exact remediation parent f87b55f4b66450ef397bbca6b58e26d39bd2f208  
**Reviewer:** fresh independent GPT-6 Sol security-review context. I did not author, direct, or remediate the candidate. I made no source edits or merge.  
**Verdict:** **BLOCKED** — a remaining P1 static forwarding bypass of the query ownership gate. This is a per-PR exact-head Sol review and structural closeout attempt, not a P0–P4 phase finalizer or full product acceptance.

## Reviewed scope

I verified the clean local worktree and live PR head at the exact SHA. I read the repository operating instructions, status/decision log and prior bulk review packet and independent panel records. I considered the original integrated security scope (authorization, identity/provider reload and portal separation, approvals/current reach/CAB, migration/schema, outbox fencing, query gate and CI controls) using the f87 whole-candidate Sol review as context, then inspected every changed line in the three-file bda delta and its neighboring code and schema. The substantive security-control change is in `scripts/ci/check-queries.mjs`; the visual change is a test fixture only. Nothing in this delta alters application authorization, migrations, provider configuration or notification delivery. The prior whole-candidate observations remain, except where superseded below.

The exact f87 bypasses are fixed: nested direct `Reflect.apply(Reflect.apply, Reflect, [db.select, db, []])` and a bound `Reflect.apply` alias now resolve to `select`. The new tests include these and several direct/call/apply/bind outer wrappers. The recursive resolver caps depth at 32 and tracks visited call nodes. It still resolves only statically known local expressions/literal forwarded arrays; dynamic arrays, mutable/shadowed aliases and cycles are conservatively unresolved. This is a useful structural improvement, but it does not close the whole statically composed invocation mechanism.

## Blocking finding

### [P1] A statically known `.call` or `.apply` target remains an invocation bypass

`resolveInvokedQueryRead()` recurses only when `resolveStaticValue(targetNode)` returns kind `reflectApply`. When `Reflect.apply` invokes the statically known `.call` or `.apply` forwarder *as its target*, that resolver returns null and does not compose the forwarded call. These are valid direct expressions with literal argument arrays and no dynamic/interprocedural inference:

```ts
Reflect.apply(Reflect.apply.call, Reflect.apply,
  [Reflect, db.select, db, []]);

Reflect.apply(Reflect.apply.apply, Reflect.apply,
  [Reflect, [db.select, db, []]]);

const f = Reflect.apply.bind(Reflect, db.select);
Reflect.apply(f.call, f, [null, db, []]);
```

At the reviewed SHA, the exported `queryReadViolations()` returned `[]` for all three; I executed them against a local object whose `select()` logs a call and confirmed all three invoke it. A direct `db.select()` is detected. This remains the same known static forwarding class. The structural rule needs to represent and compose callable `call`/`apply` targets, including bound aliases, rather than recognizing these only as the immediate outer callee. Add regressions for each composition and an unknown-target negative case. Do not waive the query ownership gate.

## Visual fixture and residual observations

The bda visual fixture adds an exact `/api/work-items/HELP-7/approvals` branch before the generic work-item branch and returns `{ approvals: [] }`, matching `approvalListResponseSchema` and the detail component's `data?.approvals.length` read. The test title assertion and screenshot expectation are unchanged. This addresses the documented fixture response-shape cause at f87, but I did not rerun the browser test. The live G8 check at bda was still reported failed when checked; the current artifact/result requires root-owned triage and cannot be inferred clear from source inspection.

The earlier Sol note on the legacy direct-read alias pass remains non-blocking: its file-wide alias map can falsely flag shadowed or reassigned `read` identifiers. The pending `user_deactivation` OpenAPI contract decision and approver-picker source/route remain unresolved; no behavior was guessed or gate waived. Historical trailing whitespace in the unchanged original review artifact remains in the full base diff; the bda delta itself is clean.

## Checks actually performed

- `node --test scripts/ci/check-queries.test.mjs`: **17/17 passed** at bda.
- `pnpm check:queries`: passed against repository source.
- Direct exported-checker probes: three static forwarded-call false negatives reproduced; runtime execution of all three confirmed `db.select()` is invoked.
- `git diff --check f87b55f4..HEAD`: passed.
- `gh pr view 589`: live exact head matched bda. At the time checked, **pull request template + security review**, **visual regression (G8)**, and **contract - OpenAPI drift** showed failure. PostgreSQL integration, G11 and several other hosted checks were still in progress.

I did not run SQL apply/DB integration, Docker/image boot/health, browser, performance, provider credentials/real Entra, or full repository tests. Author packet claims Biome, web typecheck and the Linux visual diagnosis; I did not independently rerun those. This review does not close hosted CI, product-browser acceptance, pending contracts, ordinary-review lineage or phase finalizers. **Do not merge bda** while the demonstrated source bypass and required checks remain unresolved.
