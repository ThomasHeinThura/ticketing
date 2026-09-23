# Security review — policy registry on the production boot path (issue #8 Slice 0)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `f12139fd73c82617b81cc7488d72b09a055b25b1`
**Reviewed SHA:** `f12139fd73c82617b81cc7488d72b09a055b25b1` (confirmed via `gh pr view 302 --json headRefOid`; PR code at `7c1f6ae`, remainder is `main` merges)
**Pull request:** #302
**Date:** 2026-09-23

## Surfaces examined

- `apps/api/src/index.ts` (new module-scope import; `runStartupTasks`, `startServer`, `isMainModule` block)
- `apps/api/src/policy-registry.ts` and all 22 imported `*/policy.ts` files (import lists: every one is `import type` only)
- `packages/permissions/src/registry.ts` (`createPolicyRegistry`, `PolicyRegistryError` message construction)
- `apps/api/src/utils/require-session-only.ts` (comment-only change)
- `tests/api/boot-policy-registry.test.ts`, `tests/api/production-bundle.test.ts`
- `apps/api/package.json` (`build` script), `apps/api/vitest.config.ts` / `vitest.integration.config.ts` / `vitest.permissions.config.ts`
- `Dockerfile`, `deploy/entrypoint.sh`
- Every `process.on(` in `apps/api/src` and `packages/` (only SIGTERM/SIGINT; no `uncaughtException` / `unhandledRejection` handler)

## What I probed

1. **Test suites at this head, private DB `pr302_opus_test` (td-lane-pg, dropped afterwards).**
   Integration: **74 files, 1025 tests, all passed.** API unit (`vitest.config.ts`, which holds
   both new tests): **52 files, 349 tests, all passed** locally, also under `taskset -c 0`.
   Permissions (`vitest.permissions.config.ts`): **10 files, 80 tests, all passed.**
2. **Real production bundle, valid registry.** `pnpm run build` in `apps/api` (the exact script the
   Dockerfile reaches via `pnpm turbo build --filter=@taskdesk/api`), then `node dist/index.js`
   against a scratch DB `pr302_opus_boot`: migrations ran, `🔐 117 policies loaded` printed,
   `/api/public/health/live` answered 200 within 2 s. `dist/index.js:10603` holds
   `var policyRegistry = createPolicyRegistry(POLICY_SOURCES);` at bundle top level.
3. **Real production bundle, invalid registry, through `deploy/entrypoint.sh`** (all five
   required env vars set, so the entrypoint `exec`s node). Two literal source mutations of
   `apps/api/src/work-item/policy.ts`, each rebuilt with the real `build` script, each restored
   with `git checkout` afterwards:
   - (a) added `"GET /api/health"` (collides with `platformPolicies`) → process printed
     `PolicyRegistryError: … GET /api/health: declared twice — in apps/api/src/policy-registry.ts
     (platform) and apps/api/src/work-item/policy.ts`, **exit 1**; 10 probes of the health port
     over 10 s all refused (`000`); the fresh DB had **0 public tables**, i.e. it failed before
     migrations, before `serve()`.
   - (b) deleted `scopeSource: "request"` from `POST /api/projects/{projectId}/work-items` →
     `PolicyRegistryError: … scopeSource must be "row", "request" or "instance" (got undefined)`,
     **exit 1**, port never listened, 0 tables. (esbuild does not type-check, so this is a case
     only the runtime check catches in the shipped artifact.)
   - No code path catches it: the throw happens during ESM evaluation of the entry module, before
     `startServer()`'s try/catch exists; there is no `uncaughtException`/`unhandledRejection`
     handler anywhere in `apps/api/src` or `packages/`; `entrypoint.sh` uses `set -eu` and
     `exec node apps/api/dist/index.js`, so node's exit code is the container's. Under a
     `restart:` policy this is a crash loop that never serves, which is the fail-closed outcome.
   - I did not `docker build` the image: the runtime stage runs the same `dist/index.js` via the
     same `entrypoint.sh` I executed, and the build stage runs the same `build` script.
4. **Error-content leakage.** `PolicyRegistryError`'s message
   (`packages/permissions/src/registry.ts:393-396`) is built only from route keys, policy-source
   file names and validator problem strings. No env value, secret or DB URL reaches it. The only
   output preceding it is Better Auth's own "missing clientId" warnings (names, not values).
5. **Module-evaluation order.** The new import sits after `./auth`, `./config`, `./database` in
   `index.ts`, so none of those now evaluates later than before. `policy-registry.ts` imports only
   `@taskdesk/permissions` (already imported by earlier modules, and `--packages=external`) and 22
   `policy.ts` files whose sole import is `import type { PolicyMap }` — no side effects, no cycle,
   no mutation of any shared state. No middleware registration moves.
6. **Import-elision mutation.** Deleting the single `console.log` line (the only value use of
   `policyRegistry`) makes TypeScript/esbuild elide the import entirely: the rebuilt
   `dist/index.js` contained **zero** `createPolicyRegistry(POLICY_SOURCES)` occurrences. Both new
   tests failed under that mutation (bundle test: 1/1 failed; boot test: 2/2 failed), so the test
   pair does guard this. See S2.
7. **`vi.doMock` hygiene.** `vitest.config.ts` uses default per-file isolation (no
   `isolate: false`, no shared pool override); the file `doUnmock`s and `resetModules` in
   `afterEach`; the permissions suite is a separate config and process. Full unit and permissions
   suites passed with the new file present. No leak found.
8. **Bundle-test fidelity.** The parser (`tests/api/production-bundle.test.ts:37-85`) throws on any
   flag shape it does not know, so a new flag cannot be silently dropped; `--outdir` is the only
   ignored flag and does not affect resolution. The Dockerfile has no alternative entrypoint.
   `metafile.inputs` does lose the file under the elision mutation (probe 6), so the assertion
   is meaningful.
9. **CI at this exact head** (`gh pr checks 302`, run 35841705251, `headSha` = f12139f).

## Findings

**S1 — BLOCKING (merge gate, not a security defect). The first boot test times out on CI at this
head; required check "unit + component" is red.**
`tests/api/boot-policy-registry.test.ts:32` performs a cold dynamic import of the whole
`apps/api/src/index.ts` graph inside the test body under vitest's default 5000 ms `testTimeout`
(`apps/api/vitest.config.ts` sets none). Run 35841705251 (job 107118061363, head f12139f):
`Error: Test timed out in 5000ms` at 5031 ms, 1 failed / 348 passed. The same test took 4066 ms in
the passing run at `7c1f6ae` (run 35840754511), and ~2.0–2.6 s locally. It sits at the threshold
and will flake. Fix: give that test (or the `describe`) an explicit timeout, e.g. `{ timeout:
30_000 }`, or warm the import graph in a `beforeAll` with a generous hook timeout. Re-review of
that delta alone is a narrow check.

**S2 — NON-BLOCKING. The boot guarantee rests on one value use.** `apps/api/src/index.ts:1008`
(the `🔐 … policies loaded` log) is the only reference that stops the `policy-registry` import
(`index.ts:36`) from being elided. Removing it as log "cleanup" silently removes boot-time
enforcement from `dist/` (probe 6). Both new tests catch this in CI, so it is guarded. Optional
hardening: a comment on the import saying the value use is load-bearing, or a bare
`import "./policy-registry";` side-effect import alongside it.

**S3 — NON-BLOCKING, informational.** Neither test executes `dist/index.js` itself. The boot test
runs `src/` under vitest; the bundle test proves membership, not execution. Probes 2–3 above close
that gap manually for this head. A future `sideEffects: false` in `apps/api/package.json` would be
the one change where "is an input" and "runs at boot" could diverge; nothing like that exists
today.

No request-behaviour change was found. The two comment edits (`policy-registry.ts:266-273`,
`require-session-only.ts:8-18`) are accurate: nothing on the request path consults
`policyRegistry` or `evaluatePolicy` yet.

## Verdict

**CHANGES NEEDED** — solely for S1. The required "unit + component" check is red at
`f12139fd73c82617b81cc7488d72b09a055b25b1` because of this PR's own test timing out. On the
security surface itself I found no defect. An invalid registry refuses production boot: exit 1,
never listens, no migrations run. Nothing catches the throw. No secrets leak. Module ordering
does not weaken any middleware. The tests are hygienic and faithful. A follow-up SHA that only
adds a timeout to S1's test needs a fresh exact-head confirmation of this note, not a full
re-review.
