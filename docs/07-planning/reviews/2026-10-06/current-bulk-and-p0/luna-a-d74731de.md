# Independent ordinary current-head delta review — PR #589

- **Reviewer:** fresh independent GPT-6 Luna context; did not author, direct, or remediate this candidate.
- **Candidate:** `d74731dee08861b36e16d40f0ad212d25d395cd5`
- **Compared against:** `7dd3cbb461e9a6567acb07eda64cd3bbaaac54de`
- **Lineage:** current `HEAD` verified exact; merge-base with the previously reviewed candidate is exactly `7dd3cbb461e9a6567acb07eda64cd3bbaaac54de`. Worktree is clean.
- **Verdict for this delta:** **CLEAR — no blocking findings.** One narrow, non-blocking query-gate false positive is recorded below.

## Scope

Reviewed all 10 files in the remediation delta: the auth reload fingerprint helper and its DB row readers/caller, route assertion update, SLA pause calculation and cases, query-gate `Reflect.apply` recognition and cases, and the runtime-reconfiguration contract update. Focused on the assigned auth/config-version correction and its integration with provider defaults, portal separation, provider disable behavior, and no-Valkey polling. Previous review of the unchanged 641-path candidate is preserved and was not repeated.

I did not edit source or control files. I did not run DB/SQL integration, Docker/image/boot, hosted CI, browser, visual, performance, or real Entra acceptance checks. The full auth reload path was inspected, but not integration-tested against live DB rows or multiple replicas.

## Blocking findings

None. The prior P1 is fixed: auth reload comparison now fingerprints sorted `(row id, config_version)` entries separately for plugin rows and identity-connection rows. Row ordering does not matter, while row add/remove, a lower counter increment masked by a larger counter, equal maxima across tables, and identical IDs across the two tables produce a distinct fingerprint. The reload caller compares that fingerprint before returning early, then rebuilds both portal auth instances and updates the cached fingerprint only after both constructions succeed. Provider enablement still derives from each row and preserves agent password and customer-disabled defaults.

## Non-blocking finding

### [P3] Avoid flagging unrelated `Reflect.apply.call` / `.apply` uses

**Location:** `scripts/ci/check-queries.mjs:188-196`.

The new static query detector correctly recognizes direct `Reflect.apply` with known Drizzle read methods and ordinary aliases. However, when the callee is `Reflect.apply.call(...)` or `Reflect.apply.apply(...)`, this branch sees the special `Reflect.apply` sentinel as a truthy method and emits a violation without checking the target method argument. I reproduced both cases:

- `Reflect.apply.call(null, JSON.stringify, null, [1]);` → violation method `__taskdesk_reflect_apply__`
- `Reflect.apply.apply(null, [Math.max, null, [1, 2]]);` → violation method `__taskdesk_reflect_apply__`

This is fail-closed and does not let a Drizzle read pass; it only rejects unrelated generic reflection calls. No production API source currently uses `Reflect.apply`, so I consider this a narrow maintenance false positive rather than a release blocker. If support for these call shapes is intended, map the forwarded argument positions and report only when the invoked target resolves to a registered read method.

## Checks run at exact candidate SHA

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/auth/configuration-version.test.ts` — **1 file, 6 tests passed**.
- `pnpm --filter @taskdesk/domain exec vitest run src/sla/sla.test.ts` — **1 file, 35 tests passed**.
- `node --test scripts/ci/check-queries.test.mjs` — **16/16 passed**.
- `pnpm --filter @taskdesk/web exec vitest run src/lib/routes.test.ts` — **1 file, 24 tests passed**.
- `git diff --check 7dd3cbb461e9a6567acb07eda64cd3bbaaac54de..HEAD` — passed.
- Additional read-only reproduction through `queryReadViolations` confirmed the non-blocking false positive above.

Author-reported API/domain/web typecheck, query gate, Biome, and diff checks were not independently rerun as part of this scoped delta review. This verdict does not establish full PR acceptance: remaining current-head ordinary panel reviews, required GPT-6 Sol security review, hosted/DB/image/browser/performance and other packet gates remain separate.
