# Independent ordinary delta review — 787fb0e7

- **Reviewer:** GPT-6 Luna, fresh independent context; no author, fixer, or implementation role.
- **Exact candidate head:** `787fb0e720b9196f1365d26ed6a6ecf224fad723`
- **Reviewed delta:** `ca6f6aef28447a0837aeb9347791e54e51108e9c..787fb0e720b9196f1365d26ed6a6ecf224fad723`
- **Repository:** `/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2`
- **Worktree:** clean before and after review; exact HEAD confirmed before and after. No source or Git mutation performed. This report is the only output written.

## Scope and review

Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the newest status snapshot, and the finite logging contract in `docs/01-architecture/observability.md` plus the G8 scope contract in `docs/04-engineering/ci-cd.md`. Inspected the entire requested source delta across realtime publishers, Redis listeners/control messages, native realtime handling, adapter initialization, and API/WebSocket shutdown; inspected the shared finite logger helper, corresponding regression tests, and full G8 exact-object guard change.

The new helper emits only the finite `realtime.failure` event, fixed module and level, and fixed `failed` result. Publisher rejection, malformed listener payloads, invalid control messages, asynchronous invalidation rejection, native hint failure, initialization cleanup failure, and WebSocket adapter/server/client shutdown failures now avoid serializing error, configuration, or payload content. The native hint case identified by prior review C is corrected, with a sensitive-error regression probe. Adapter shutdown still attempts each unsubscribe/Redis close, aggregates failures for its caller, and API shutdown preserves its shared deadline, forced close, and graceful/forced result behavior. G8 now includes `workers` in the exact base config key set and requires numeric literal `1`; the paired probe verifies `2` is rejected. No retry, screenshot, threshold, or suite exclusion weakening was observed in this two-line guard delta.

## Checks actually performed

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/ws/broadcast.test.ts ../../tests/api/ws/node-server-safe-logging.test.ts ../../tests/api/ws/user-broadcast-redis-failure.test.ts ../../tests/api/ws/native-work-item-realtime.test.ts` — **4 files, 19 tests passed**.
- `node --test scripts/ci/check-visual-scope.test.mjs` — **153 passed, 0 failed, 0 skipped**.
- `pnpm check:visual-scope` — passed; **7 screenshot cases, 6 active inventory route rows mapped (123 total route rows)**.
- `git diff --check ca6f6aef28447a0837aeb9347791e54e51108e9c 787fb0e720b9196f1365d26ed6a6ecf224fad723` — passed.
- `git status --short --branch` and `git rev-parse HEAD` before/after — clean worktree and exact requested SHA.

## Verdict: BLOCK

### Blocking finding

1. **HTTP shutdown errors in the touched shutdown routine still log raw exception objects.** In `apps/api/src/index.ts`, `createNodeServer().close()` passes caught errors from `httpServer.closeAllConnections()` to `console.error` (around line 1761), logs the raw `server.close` callback error (around line 1787), and logs the caught `server.close()` throw (around line 1796). These are in the same shutdown path being structurally corrected; arbitrary runtime/error text bypasses the finite typed logger and can disclose configuration or other sensitive details. Replace these error-object arguments with the appropriate fixed safe event/message and add a regression probe that injects a sensitive HTTP shutdown error. Preserve the existing force-close decisions and shutdown completion behavior.

## Limits

No API typecheck, build, browser/E2E, Turbo, PostgreSQL, Docker, hosted CI, or source-image verification was run, as requested. The author-reported source-image and hosted proof remain unverified here. This is an ordinary delta review only, not the required GPT-6 Sol security review or P0 phase finalizer.
