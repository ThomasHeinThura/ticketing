# Pre-merge security review — PR #132 (read TASKDESK_PORT, add /api/public/health/{live,ready})

**Reviewed head:** `7998bf89fa17fa90fddb00096aa010c3141a75dc`
**Base:** `origin/main` at review time

**Verdict: CLEAR FOR MERGE.** Zero blocking findings outstanding at the reviewed head. Two
rounds — the first found two real, independently-confirmed issues in the initial
implementation; both fixed and re-verified by demonstration, not by reading.

**Status of the gate:** this review closes the mandatory independent Opus security review
for the head named above, and for that head only. A later commit touching anything outside
`docs/07-planning/security-reviews/` voids it.

**Reviewer independence.** A fresh Opus context, spawned explicitly via the `Agent` tool
with an explicit model pin, that authored no part of the change under review.

## Round 1 — head `8766625492139c348a1b24cec46bfe7d55d7d9c8`: findings

- **LOW — no upper bound on `TASKDESK_PORT`.** The original validation accepted any positive
  integer, so a value like `"70000"` reached `@hono/node-server`'s `serve({port})`
  unvalidated, which throws `RangeError`/`ERR_SOCKET_BAD_PORT` from Node's
  `net.Server.listen`. Since `startServer()` was invoked as `void startServer(...)` with no
  `.catch()`, this became an unhandled promise rejection that crashes the process instead of
  the intended graceful fallback. Found independently by a Sonnet reviewer and this Opus
  review.
- **MEDIUM — `apps/api/src/database/index.ts`'s connection pool had no
  `pool.on("error", ...)` listener.** node-postgres emits `"error"` on the *pool* (not the
  query) when a pooled idle client dies server-side; an `EventEmitter` with no listener for
  that event throws, crashing the whole process. This was a pre-existing, dormant gap —
  nothing previously touched an idle pooled connection outside of active request handling.
  This PR's own `/api/public/health/ready`, polled every ~10s by the container healthcheck,
  makes exactly that condition routinely reachable — activating a crash mode the
  liveness/readiness split exists to prevent. Found by this Opus review.

## Round 2 — head `7998bf89fa17fa90fddb00096aa010c3141a75dc`: verified fixed, by demonstration

- **Port bound** — `resolvePort()` (extracted into its own exported, unit-tested function)
  now bounds to 1–65535. Re-tested the exact values from the finding (`"65536"`, `"70000"`,
  `"99999999"`): all now fall back to the documented default (5173) with a warning, instead
  of reaching `serve()` and dying.
- **Pool error handling** — verified by real reproduction, not just reading the code or
  trusting the added unit test (which uses a synthetic `pool.emit("error", ...)`): killed a
  genuine idle backend connection (`pg_terminate_backend`, real Postgres `FATAL 57P01`)
  against the pre-fix code and confirmed the process crashed with an unhandled `'error'`
  event; re-ran the identical reproduction against the fixed code and the process survived
  **and the pool recovered** — a subsequent query succeeded, so `/ready` returns to 200
  after a transient database blip rather than the container being gone.
- **Re-verified everything previously cleared**, since the delta touched the same file
  (`index.ts`): `/ready` still returns only `{"status":"error"}`/503 with no error detail
  leaked; `/live` still 200 unauthenticated, no dependency touched; mutating methods on both
  routes still 401.
- **Suites at the reviewed head**: `apps/api` unit 283/283 (270 pre-existing + 13 new),
  `pnpm test:permissions` 76/76, health + global-auth-guard 16/16.

## What was established in round 1, still valid

- **No new unauthenticated-surface risk.** Both routes sit behind the same guard structure
  as the pre-existing `/api/health`; no rate limiter exists in-process anywhere in this
  codebase, and anonymous HTTP is rate-limited at the edge (Traefik, 100/s per source) —
  matching the already-documented split, not a new gap. `/ready`'s `SELECT 1` is cheaper
  than the already-public `/api/instance/status`.
- **No information leakage.** Both handlers return only `{status}`; the readiness failure
  path's real error reaches only `console.error`, confirmed by direct execution against a
  closed port (response body was exactly `{"status":"error"}`).
- **Port parsing has no request-derived path** — it reads an environment variable set at
  deploy time, not anything a remote caller can influence.

## What this review does not claim

This review clears the two new health routes and the port-resolution logic, plus the
pool-error-handling fix this PR's own review process surfaced as a necessary consequence of
adding `/ready`. It does not extend to the other two known UAT/deployability gaps (static
file serving, the `storage.filesystem` driver), which are separate, unreviewed candidates.
