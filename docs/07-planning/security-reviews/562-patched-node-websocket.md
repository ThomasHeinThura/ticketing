# PR #562 — patched Node WebSocket and bounded shutdown

**Reviewed head:** `327348e6581f63687d394cb64c8b7568768d5399`
**Comparison base:** `113a059d362feeb25372399d59a6e06d90c81f13`
**Change:** patched Hono / Node adapter dependencies, use the Node server's WebSocket upgrade helper, and make HTTP, WebSocket, and Redis adapter shutdown one bounded joined lifecycle. This note is an authoring record of independent reviews and verification at the exact source above; it is not itself a review or approval.

## Independent reviews at the exact head

All four current reviews are recorded on GitHub as `COMMENTED` at the exact reviewed head. Their CLEAR verdicts are evidence from their respective contexts; no `APPROVED` review state is claimed.

- **Ordinary A — GPT-6 Luna, CLEAR:** fresh independent context; did not author, direct, or remediate the candidate. Inspected all 15 changed files and the listener, auth/reach-before-upgrade behavior, static handling, shutdown, Redis lifecycle, dependency graph, tests, and realtime/security contract. [Review 5384925339](https://github.com/ThomasHeinThura/ticketing/pull/562#pullrequestreview-5384925339).
- **Ordinary B — GPT-6 Luna, CLEAR:** fresh independent context; did not author, direct, or remediate the candidate. Inspected shutdown/resource joining, adapter/client lifecycle, routes, dependencies, and test validity. This current review did not raise or withdraw a `windowId` concern. [Review 5384971760](https://github.com/ThomasHeinThura/ticketing/pull/562#pullrequestreview-5384971760).
- **Ordinary C — GPT-6 Luna, CLEAR:** fresh independent context; did not author, direct, or remediate the candidate. Inspected all 15 changed files, including the real listener, static handling, Redis, shutdown, and tests. This current review did not raise or withdraw a `windowId` concern. [Review 5385046891](https://github.com/ThomasHeinThura/ticketing/pull/562#pullrequestreview-5385046891).
- **Full security review — GPT-6 Sol, CLEAR:** fresh independent security context; did not author, direct, or remediate the candidate. Covered the full 15-file diff, including `apps/api/src/index.ts`, `apps/api/src/redis/index.ts`, WebSocket lifecycle, package manifests/lock/overrides/notices, and real-listener/static/Redis tests. Those source and dependency paths fall within the security-review scope in `docs/04-engineering/ci-cd.md`. [Review 5385094604](https://github.com/ThomasHeinThura/ticketing/pull/562#pullrequestreview-5385094604).

The `windowId` echo-exclusion concern belongs to historical review material on the older `07607c4` source; a separate historical review context on `a229e69` later withdrew it after checking that `TD-echo` and `TD-1` have distinct queue keys. Neither current fresh B nor current fresh C raised or withdrew that historical concern. The earlier shutdown findings on `07607c4` and `a229e69` were resolved in source subsequently reviewed at `327348e`; those old findings are not current blockers or current review evidence. The current three ordinary contexts and Sol review are the four exact-head reviews listed above.

## Review checks and source verification

The current reviewers recorded these focused results:

- Real Node HTTP/WebSocket integration: **1 file / 6 tests passed** with disposable Testcontainers PostgreSQL 18.
- Static/API tests: **1 file / 21 tests passed** (A); Redis shutdown lifecycle: **1 file / 3 tests passed** (A).
- Combined `tests/api/index.test.ts` and Redis shutdown tests: **2 files / 24 tests passed** (C and Sol).
- API Redis/WS focused unit tests: **3 files / 37 tests** and WebSocket unit suite: **6 files / 27 tests** (B).
- API typecheck (C), dependency graph, production audit, override check, and diff checks passed as individually reported by the reviewers.

Author verification on the reviewed source is recorded separately from reviewer-rerun evidence: lint and typecheck passed; the web unit suite passed **80 files / 351 tests**, and the `pnpm test` workspace run completed **12 tasks**; PostgreSQL integration passed **127 files / 1,585 tests / 5 tasks**; permission suite passed **14 files / 88 tests / 5 tasks**; `pnpm audit --prod` found no known vulnerabilities; `pnpm check:overrides` passed with 36 overrides and no competing source. The active-HTTP graceful-join regression failed on old source `a229e69` as expected and passed on the patched source.

Hosted exact-head suite counts recorded for `327348e` were API **68 files / 541 tests**, UI **59 files / 291 tests**, web **80 files / 351 tests / 12 tasks**, PostgreSQL integration **127 files / 1,585 tests / 5 tasks**, and permission coverage **14 files / 88 tests**. At the live status inspection, `pull request template + security review` was red; the note commit requires fresh hosted checks. No gate is waived here.

## Image and isolated runtime evidence

The author built the clean composed source `327348e6581f63687d394cb64c8b7568768d5399` with `docker build --pull --no-cache`. Image `taskdesk:pr562-327348e6` has ID `sha256:136328a97295b8e4da56f361f4843f8e757dcf9545a0d0d79d9ee2cc75fb1b0c`, OCI revision label `327348e6581f63687d394cb64c8b7568768d5399`, and configured user `taskdesk`. In an isolated disposable PostgreSQL 18 `taskdesk_test` plus Valkey 9 environment, the migration step exited successfully, the API booted, `/api/public/health/live` and `/api/public/health/ready` both returned HTTP 200, and the runtime UID was 10001. The temporary containers and network were removed. This was an isolated author smoke test, not a persistent deployment or reviewer-run image test.

## Residual scope and acceptance boundary

- The existing **High Origin and stored-session-portal binding gap remains OPEN** under [#560](https://github.com/ThomasHeinThura/ticketing/issues/560). The session schema lacks the portal field needed for the binding; this candidate does not add an Origin/session approximation and does not fix, waive, or clear #560. The adapter/static/dependency maintenance review clears only findings attributable to this bounded maintenance delta.
- `mockAuthenticatedSession` controls `auth.api.getSession` in the listener tests. They exercise real Node upgrade routing and pre-upgrade decisions under those controlled results; they are **not** evidence of Better Auth cookie validation or an actual login.
- No UI changed. **BROWSER VERIFICATION: BLOCKED** — no interface was available to open; the user-popup signed-in-reply request was acknowledged. No browser result is claimed.
- Required CI on the note commit remains pending; the P0 phase finalizer remains OPEN. This record does not claim phase completion, merge readiness, or deployment authorization. Root owns PR metadata, final readiness, and any merge/deployment decision.
