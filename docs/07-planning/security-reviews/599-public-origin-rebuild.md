# Rebuilt #599 — configured public origin for storage URLs — review record

**Reviewed head:** `c05a4a3209faa4613045180e106f9a00daab5aa7`

This rebuilds existing PR #599's commits `51d151e8` and `9abb6013` onto main `6568fc3e` as `276660b4` and `0726d7f8`. `c05a4a32` adds fail-closed tests (Opus N1). #599's old review records (`7c5ae58c`) are historical and are not carried as current reviews.

- **Implementation:** Claude Sonnet context `ac9b2f6bac145d5c0`.
- **Ordinary review:** Claude Sonnet `a0b967c61da018eb5`, APPROVE at `0726d7f8`.
- **Security review:** Claude Opus 5.5 `af70b84f848171cb7`, CLEAR WITH NON-BLOCKING; N1 closed at `c05a4a32`. It is not a GPT-6 Sol review.

Each report is inserted unmodified, with its SHA-256.

<!-- BEGIN REPORT (agent a0b967c61da018eb5; model claude-sonnet-5-5; role ordinary review; candidate 0726d7f86879f65650698b5727403245a2140405; sha256 bfaf7a492e7303de466f07550e3a96bf7b3cebc4cf1bade805e5b65543de5f78) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: fresh independent Sonnet review context, session 3a9e9ce4 (did not author or direct the candidate)
Candidate SHA: 0726d7f86879f65650698b5727403245a2140405 (branch claude/p599-public-origin, base main 6568fc3e; 2 commits: 276660b4, 0726d7f8)
Verdict: APPROVE (ordinary tier). No blocking findings. Three non-blocking notes.

## Scope examined
`git diff 6568fc3e..HEAD`: attachment/index.ts, task/index.ts, index.ts, openapi.ts, storage/shared.ts, utils/request-origin.ts, tests/api/request-origin.test.ts, tests/api/two-entry-host.test.ts, tests/api-integration/{attachment,task-image-upload}.test.ts. Read-only; mutation done on a git-archive copy in scratchpad/mut.

## 1. Correctness: PASS
- Origin is taken from the configured origin of the Host-selected surface: hostRoutingGuard (apps/api/src/index.ts:~509) sets `appPublicOrigin = publicOriginForKind(selected, origins)`. `origins` comes from parseConfiguredOrigins(TASKDESK_AGENT_URL, TASKDESK_PORTAL_URL). The returned value is `URL.origin` of the validated config, not request data.
- All four consumers switched: attachment/index.ts:196 (presign), :238 (download), task/index.ts:878 (image upload URL), :971 (finalize asset URL). Grep of apps/api/src for `req.url`, `KANEO_API_URL`, `x-forwarded`, `new URL(` shows no remaining request-derived URL in attachment, task or storage paths.
- Remaining KANEO_API_URL reads are index.ts:952 (OpenAPI `servers` doc, defaults to relative "/api") and :1876 (startup log). Neither builds a storage/attachment URL. Pre-existing; out of scope.
- Health path: appPublicOrigin is set for health requests only when selected != "unknown". Health handlers use no origin URLs, so nothing consumes it. Fine. Unknown-host health still answers without an origin, unchanged from main.
- Only the agent surface can reach these routes. Portal host is denied for /api paths and non-GET, so a portal origin never lands in attachment/task URLs.

## 2. Unset or invalid origin: PASS (fail closed)
- Unset or invalid TASKDESK_AGENT_URL / TASKDESK_PORTAL_URL throws in parseConfiguredOrigins at createApp() time ("TASKDESK_AGENT_URL is required.", query/fragment/path/userinfo/same-host checks). The app never starts, so there is no per-request fallback to the Host header.
- requirePublicAppOrigin throws if the context value is missing. That is defence in depth, and it surfaces as a 500 via onError with no leak. It is reachable only if a route runs outside hostRoutingGuard, which is a catch-all (`declareCatchAllMiddleware`) so it should not happen.
- Consistent with docs/05-operations/configuration-reference.md:26-27, which lists both as required public origins. No doc change in the diff. KANEO_API_URL is not documented there, so removing the override from task/index.ts is consistent. `node scripts/ci/check-env.mjs` passes (stale KANEO_API_URL baseline entry for task/index.ts only yields the "no longer read" note).

## 3. Tests
Run (sandbox, from apps/api): `vitest run --config vitest.config.ts ../../tests/api/request-origin.test.ts ../../tests/api/two-entry-host.test.ts` -> 12 passed, 1 failed. The failure is "rejects repeated raw Host fields at the actual Node HTTP boundary": `listen EPERM 127.0.0.1`, a sandbox port-binding denial and not a candidate defect (the test binds a real socket). `tsc --noEmit -p apps/api` clean.
Mutation (copy):
- A: revert all four call sites to `new URL(c.req.url).origin` -> tests/api/request-origin.test.ts still 7/7 PASS. The unit tests do not guard the call-site regression; only the DB-backed integration tests do (they assert `https://localhost:1337/...` while the request URL is `http://localhost:1337`, with spoofed x-forwarded-* headers, so reverting would fail them by reading). I did not run those (Docker/Postgres excluded per brief); I rely on the author's run.
- B: make publicOriginForKind return origins[0] -> "maps validated agent and portal surfaces" fails. Good.
Assessment: the integration tests are meaningful (scheme differs between the request and the configured origin, and the `/api/` count is asserted to be 1). The new unit test "does not select a public origin from forwarded headers or a spoofed Host" and the two-entry-host spoof test mostly re-assert existing Host selection and exercise none of the new code. They are not vacuous, but they add little.

## 4. Cherry-pick onto newer main: PASS
Diff applies on main 6568fc3e with no textual conflict. Semantically compatible with the P0 strict enforcement and two-entry host: the new `c.set` sits after the invalid/WebSocket denials and the unknown-host denial, so no request reaches a handler with a missing origin on the non-health path. `appPublicOrigin` is declared in both AppVariables and BaseVariables, and tsc is clean. The health branch ordering is unchanged.

## Findings
NON-BLOCKING
1. apps/api/src/storage/filesystem.ts:370, 650, 729 (grep with -a; git treats it as binary): still falls back to `"http://localhost:1337"` when apiBaseUrl is undefined, and the comment at :363-368 still describes the old source ("computed from its own origin ... task/index.ts"). All callers now pass a validated origin, so it is unreachable via routes, but it is a latent non-failing default and a stale comment. Suggest making apiBaseUrl required or throwing in a follow-up.
2. tests/api: no unit-level guard that the routes use appPublicOrigin (mutation A survives). Optional: a non-DB test of requirePublicAppOrigin (throws on undefined) plus a static/grep-style assertion, or accept the integration coverage.
3. apps/api/src/index.ts:951-953 OpenAPI servers still honours KANEO_API_URL. Non-storage and pre-existing; mention only for completeness.

## Not checked
- Integration tests (DB/Docker) were not run by me; only reasoned. The full-repo typecheck variants (permissions/tests/rls-prototype tsconfigs) were not run; only the main apps/api tsconfig. The real-socket Node HTTP boundary test could not run under the sandbox. The traefik/deploy docs were not audited beyond configuration-reference.md. S3-driver paths ignore apiBaseUrl by design and were not exercised.
<!-- END REPORT a0b967c61da018eb5 0726d7f8 -->

<!-- BEGIN REPORT (agent af70b84f848171cb7; model claude-opus-5-5; role Sol-tier security review and N1 closure; candidate c05a4a3209faa4613045180e106f9a00daab5aa7; sha256 b85dc0bd4c79c7a74a3438f160d63f03a1d66e1d491571ad251c7b6971bd81b5) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:af70b84f848171cb7
**Reviewed head:** 0726d7f86879f65650698b5727403245a2140405
Verdict: CLEAR WITH NON-BLOCKING

# #599 rebuild: security review (configured public origin for storage URLs)

- Branch: `claude/p599-public-origin`, worktree `/private/tmp/claude-501/p599` (clean, no edits made)
- Base: main `6568fc3e545b36580f8a8248f4dcf3fa48257854` (this is the merge base)
- Commits: `276660b4` fix(api): generate storage URLs from public origin; `0726d7f8` test(api): fix configured-origin integration fixtures
- Role: independent security-tier reviewer. I did not author, direct or remediate this change. Note: the role table in CLAUDE.md assigns this gate to GPT-6 Sol. I am Claude Opus 5.5. The orchestrator decides whether this review satisfies that gate.

## Surfaces examined

- `apps/api/src/index.ts:477-518`: `hostRoutingGuard`, both the health branch (`:494-506`) and the normal branch (`:507-516`), plus where it sits in the middleware chain (`:458` metrics, `:518` host guard, `:563` CORS).
- `apps/api/src/utils/request-origin.ts`: the new `publicOriginForKind` and `requirePublicAppOrigin`, and the existing `parseConfiguredOrigins`, `selectOriginFromHost` and `selectOriginFromContext`.
- Consumers: `apps/api/src/attachment/index.ts:196` (presign) and `:238` (download, 302 redirect); `apps/api/src/task/index.ts:878` (task image upload URL) and `:970-976` (finalize asset URL).
- Signing: `apps/api/src/storage/filesystem.ts:315-318` (upload HMAC), `:582`, `:609` (attachment upload and download HMACs), `:645-662`, `:724-740` (URL builders); `storage/s3.ts` is unchanged.
- `apps/api/src/openapi.ts` (`BaseVariables.appPublicOrigin`) and `storage/shared.ts` (comment only).
- Repo-wide grep of `apps/api/src` for remaining `c.req.url`, `KANEO_API_URL`, `x-forwarded*` and `header("host")` used to build URLs.

## Commands run

- `git rev-parse HEAD`, `git merge-base HEAD 6568fc3e`, `git diff 6568fc3e..HEAD`
- Unit: `vitest run --config vitest.config.ts tests/api/request-origin.test.ts tests/api/two-entry-host.test.ts` gave **2 files, 13/13 passed**. This needed the sandbox lifted for the Node HTTP boundary test, which uses listen.
- Integration: I started a private disposable Postgres (`postgres:18`, 127.0.0.1:55599, DB `taskdesk_p599_test`) and removed it afterwards. `vitest run --config vitest.integration.config.ts tests/api-integration/attachment.test.ts tests/api-integration/task-image-upload.test.ts` gave **2 files, 23/23 passed**.
- `tsc --noEmit -p apps/api` exited 0.
- `node scripts/ci/check-env.mjs` passed. It notes that 2 baseline names are no longer read, which is a prune hint and not a failure.
- Mutation testing on a temp `git archive` copy (since deleted):

| # | Mutation | Result |
|---|---|---|
| M1 | attachment presign uses `new URL(c.req.url).origin` | KILLED (AT-2) |
| M2 | attachment download uses `new URL(c.req.url).origin` | KILLED (AT-2) |
| M3 | task image upload URL uses request origin | KILLED |
| M4 | task finalize asset URL uses request origin | KILLED |
| M5 | normal path swaps agent and portal public origin | KILLED (9 tests) |
| M7 | `publicOriginForKind` always returns `origins[0]` | KILLED (unit) |
| M8 | finalize builds URL from `x-forwarded-proto`/`x-forwarded-host` | KILLED (2 tests) |
| M9 | normal path stops setting `appPublicOrigin` | KILLED (18 tests, fail-closed 500) |
| M6 | `requirePublicAppOrigin` falls back to `http://localhost:1337` instead of throwing | **SURVIVED** (unit and integration) |

## Findings

### 1. Host-header injection and origin confusion: no finding
- `appPublicOrigin` comes only from `publicOriginForKind(selected, origins)` (`index.ts:496`, `:509`). Its value is `AppOrigin.url`, which is `new URL(TASKDESK_*_URL).origin` after `parseConfiguredOrigin` validates it (http or https only, no userinfo, path, query or fragment). No request data flows into the value. The Host header only *chooses between* two configured strings.
- `selectOriginFromContext` reads only the raw Host field or the HTTP/2 `:authority`. It never reads `X-Forwarded-*`. Repeated Host fields and mismatched Host vs `:authority` are rejected. An unknown host is denied on every non-health path (`index.ts:507`).
- After this change, no `c.req.url`, request-Host or forwarded-header URL construction is left anywhere in `apps/api/src` (grep).
- Two-entry model: a portal-selected request to any `/api/*` path is denied at `index.ts:511` before routing. All four consumers are under `/api`, so in practice they only ever run with `selected === "agent"` and get the agent origin. A portal request cannot reach them, so it cannot leak an agent URL or receive a portal URL. M5 shows the per-kind mapping is test-pinned.
- Side benefit: Host spellings that normalize to the agent (case, trailing dot, explicit default port) now produce the canonical configured URL instead of echoing the spelling back.

### 2. Fail-closed: holds in code, with one gap in test pinning (NON-BLOCKING, N1)
- An unset or invalid `TASKDESK_AGENT_URL`/`TASKDESK_PORTAL_URL` makes `parseConfiguredOrigins` throw at `createApp` (startup), so there is no runtime fallback to request data.
- A missing `appPublicOrigin` at a consumer throws from `requirePublicAppOrigin` (`request-origin.ts:22-26`). `app.onError` turns that into a generic 500. For download, the throw happens while arguments are evaluated, before `downloadAttachment` runs, so no audit row is written for a URL that was never issued.
- **N1:** M6 survived. No test asserts that `requirePublicAppOrigin(undefined)` throws. Today the guard is defence in depth, because the normal path always sets the value (M9 is killed). But a future edit to fail-open would pass CI. Suggested fix: a one-line unit test, `expect(() => requirePublicAppOrigin(undefined)).toThrow()`, plus the empty string. The rule "every rule that closes a code defect gets a test" applies.
- Related note: the storage drivers still default to `"http://localhost:1337"` when `apiBaseUrl` is falsy (`filesystem.ts:370`, `:650`, `:729`). Every production caller now passes a value that is guaranteed non-empty, so this cannot be reached through these routes. It is pre-existing and out of the diff.

### 3. Signed and presigned URL integrity: no finding
- None of the HMAC inputs changed: upload is `key\nexpires`, attachment upload binds key, maxBytes and expires, download binds key and expires. The base URL is not and was not part of any signature. S3 presigning is unchanged and ignores `apiBaseUrl`.
- Open redirect: the 302 target in `attachment/index.ts` is either the S3 presigned URL or `<configured agent origin>/api/storage/filesystem-download?...`. No user-controlled component reaches the scheme or authority. `filename` is only a query parameter that `URLSearchParams` encodes.

### 4. Middleware ordering and strict-policy/CSRF interaction: no finding
- The only change in `index.ts` adds two `c.set` calls inside the existing `hostRoutingGuard`. Its registration point (`:518`, after metrics and before CORS) and every deny branch are unchanged. CORS, CSRF, strict policy enforcement and shadow-middleware classification are untouched. `declareCatchAllMiddleware(hostRoutingGuard)` still keeps the same function identity.

### 5. Test coverage: adequate for the attack cases, except N1
- Integration tests send `host: localhost:1337` with `x-forwarded-host: attacker.example` and `x-forwarded-proto: http` against configured `https://localhost:1337`. They assert an `https://localhost:1337/api/...` prefix with exactly one `/api/` for presign, the download redirect, task upload and finalize. This is discriminating: it would catch both request-origin derivation (M1-M4) and forwarded-header derivation (M8).
- There is also a spoofed-Host test where the Host is the attacker and `x-forwarded-host` is the real host, expecting 404.
- **N2 (NON-BLOCKING, test strength):** `two-entry-host.test.ts:158-166` (`new Request("http://attacker.example.test/api/workspaces", {x-forwarded-host...})`) sends no Host header. Its 404 comes from the "invalid / missing Host" branch, not from "attacker Host with forwarded real host". The equivalent attacker-Host case is covered properly in `request-origin.test.ts` ("does not select a public origin from forwarded headers or a spoofed Host") and in the `task-image-upload` integration test. So this test is redundant rather than wrong, but its name overstates what it proves.

### 6. Operational behaviour change (explanation, not a security defect)
- Storage URLs no longer honour `KANEO_API_URL`. They are always `TASKDESK_AGENT_URL` + `/api`. A deployment that served the API from an origin other than the agent URL would get broken (but not unsafe) storage links. The bundled image is same-origin, per the CORS comment in `index.ts`. `KANEO_API_URL` is still read for the OpenAPI server URL (`index.ts:951-953`) and in `auth.ts:74`, so two "public API URL" sources now exist side by side. The orchestrator should confirm that the configuration reference or decision log records that storage URLs follow `TASKDESK_AGENT_URL`. The env baseline has stale `KANEO_API_URL` read entries that `check:env --prune` would remove (housekeeping).

## Residual risk
- If an operator sets `TASKDESK_AGENT_URL` to an http origin behind TLS termination, the URLs will be http. That is a configuration responsibility, and it is better than the previous behaviour of trusting the request.
- The health branch sets `appPublicOrigin` but no health handler uses it. This is harmless.

## Not checked
- Live UAT or container image boot and redeploy, and a real TLS-terminating proxy end to end.
- The full unit, permissions and integration suites. I ran only the 4 touched test files, 36 tests in total.
- `auth.ts` and Better Auth `baseURL`/trusted-origin derivation, email and invitation link generation, and the web client's use of `KANEO_API_URL`. These are outside this diff.
- S3 driver behaviour against a real S3 endpoint.
- GitHub PR state and CI checks: `gh pr list --head claude/p599-public-origin` returned no PR at review time.

---

## Addendum: N1 re-check at c05a4a32

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:af70b84f848171cb7
**Reviewed head:** c05a4a3209faa4613045180e106f9a00daab5aa7
Verdict: N1 CLOSED. The overall verdict for the candidate is still CLEAR WITH NON-BLOCKING, with only N2 (test-name strength) left open.

- Delta: `git diff 0726d7f8..c05a4a32` has 1 commit and touches only `tests/api/request-origin.test.ts` (+21 lines). No source changes. It adds a `requirePublicAppOrigin` describe block with three tests: it throws on `undefined`, it throws on `""`, and it passes `"https://agent.example.test"` through unchanged. The throw assertions match on the message `/validated application origin is required/u`.
- Method: a clean `git archive c05a4a32` copy in the scratchpad, with node_modules symlinked and the copy deleted afterwards. The worktree was not touched and `git status` is clean.
- Clean run: `vitest run --config vitest.config.ts tests/api/request-origin.test.ts` gave **10/10 passed**.
- M6 mutant (`if (!value) return "http://localhost:1337";` in `apps/api/src/utils/request-origin.ts`): **KILLED**, 2 failed and 8 passed. The failures were "throws when no validated origin was set" and "throws for an empty origin instead of falling back".
- Not re-run at c05a4a32: the integration suites. The delta does not touch them, so the result is the same as at 0726d7f8 (23/23).
<!-- END REPORT af70b84f848171cb7 c05a4a32 -->

