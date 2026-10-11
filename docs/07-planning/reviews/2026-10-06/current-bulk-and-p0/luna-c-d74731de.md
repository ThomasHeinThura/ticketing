# Independent ordinary delta review C — bulk integration #589

- **Reviewer:** GPT-6 Luna, fresh independent context C
- **Reviewed head:** `d74731dee08861b36e16d40f0ad212d25d395cd5`
- **Base:** `7dd3cbb461e9a6567acb07eda64cd3bbaaac54de`
- **Independence:** I did not author, direct, or remediate this correction batch. No source edits made.
- **Verdict:** **BLOCKED** on the remaining static query-checker false negative below. The current PR also has hosted required gates still red or pending; no gates are waived.

## Scope

Reviewed all 10 files in the exact candidate delta (the actual Git diff contains 10 changed paths): auth configuration version vector and its API integration, SLA pause-overlap correction and domain cases, query checker and probes, portal sign-in route assertion, and architecture-contract update. I did not rereview unchanged portions of the prior 641-file review. Main emphasis was query checker AST semantics, routes/UI contracts, and cross-checking delta test claims.

## Blocking finding

**The P4 query ownership gate still misses straightforward statically known `Reflect` aliases.** On the candidate checker, all of these valid invocations produced no violation:

```js
const R = Reflect;
R.apply(db.select, db, []).from(users);

const { apply } = Reflect;
apply(db.select, db, []).from(users);

(0, Reflect.apply)(db.select, db, []).from(users);

globalThis.Reflect.apply(db.select, db, []).from(users);

const { select: read } = db;
const { apply } = Reflect;
apply(read, db, []).from(users);
```

These call the same read method the new checker correctly recognizes when spelled directly or through a direct `const apply = Reflect.apply` alias. The patch therefore closes the original direct form but not the full bounded static-reference class. This is not a request for arbitrary dynamic JavaScript analysis; it is a request to make known builtin/helper identities and forwarded invocation targets obey one structural rule across the syntactic alias forms this checker already supports.

The alias analysis also ignores assignment and lexical binding identity: `let ra = Reflect.apply; ra = noop; ra(db.select, ...)` is still reported as `select`, and a parameter named `Reflect` is treated as the global builtin. These are false-positive risks rather than the blocking false negative. `Reflect.apply.call(Reflect, db.select, ...)` and `.apply(Reflect, [db.select, ...])` currently report the synthetic method `__taskdesk_reflect_apply__`; even an unrelated target (`fn`) reports the same synthetic method. Record and repair these together with the checker’s binding/forwarding invariant rather than adding an isolated special case for `const R = Reflect`.

## Corrections verified

- The previous portal-route assertion is updated for the registered `/sign-in` route.
- The SLA due-time correction skips closed pauses that begin during uncovered time but overlap the next covered window; the added tests cover active-at-start, zero target, pauses spanning the next opening, open pauses, and an exact-opening boundary.
- Authentication reload comparison now uses a stable, table-scoped, row-identity/version vector; tests cover counter masking, row order, creation/removal, and same IDs in separate tables.

## Checks actually run

- `node --test scripts/ci/check-queries.test.mjs`: **16/16 passed**.
- Focused web route test (`vitest run src/lib/routes.test.ts`): **24/24 passed**.
- Focused SLA domain test (`vitest run src/sla/sla.test.ts`): **35/35 passed**.
- Focused auth version test (`vitest run tests/api/auth/configuration-version.test.ts`): **6/6 passed**.
- Direct exported-checker probes covered the reflection-binding matrix above; no source was edited.
- The author’s reported focused API/web/domain/type/Biome runs are not independently claimed beyond these focused tests.

## Current hosted state observed

`gh pr view 589` confirmed the exact head. At the time checked, hosted route policy, static, gate checkers/red probes, unit/component, domain coverage, build, dependency audit, secret scan, Helm, CI manifest, G4, and CodeQL were green. OpenAPI drift and PR-template/security-review were red; G8 visual was red; G11 and PostgreSQL integration were still in progress. GitGuardian was pending. The known `user_deactivation` OpenAPI response enum expansions and PR metadata/security-review requirements remain unresolved candidate gates; no approval or waiver is implied. Root’s Linux AMD64 G8 matching-CI run uses mock-only captures and is not claimed as whole product-browser verification.

## Limits

I did not run the full repository suite, SQL apply/integration, Docker/image boot, browser use, or performance measurement. Manual product-screen verification and full acceptance remain outstanding. The previous provider-reload and cross-calendar SLA-pause findings were not duplicated; this delta review confirmed their fixes in the changed code/tests.
