# Post-merge security review — PR #13 (kaneo import)

**Status of the gate:** this review is **remediation**. PR #13 merged on 2026-09-06 **before** its mandatory security review ran. That was a process deviation, not an approved waiver. The review below was performed immediately afterwards against the merged code, not against the PR description.

**Reviewed at:** `a719d56…` → `6a678ba…` (merge `18ae014…`), 1,272 files, 87 of them inside the security-review path list in `ci-cd.md`.

**Method:** five independent Opus reviewers in separate sessions, one lens each, reading the actual source. Every finding acted on below was **re-verified by hand against the file before any code changed** — including two agent claims that turned out to need correction. Detail files: `sec-A-auth`, `sec-B-routes`, `sec-C-storage`, `sec-D-plugins`, `sec-E-secrets`.

**Reviewer independence caveat, stated plainly:** the same session that produced PR #13 orchestrated this review. The five reviewers were separate sessions with fresh context and no knowledge of the authoring rationale, which satisfies "a different session" — but it is not an outside pair of eyes, and I am not recording it as one. Thomas should treat the CRITICAL/HIGH list as needing his own confirmation.

---

## Totals

| Severity | Count | Disposition |
| --- | --- | --- |
| **CRITICAL** | **3** | **3 fixed on `feat/p0-remove-inherited-surfaces`** |
| HIGH | 21 | 1 fixed now; 12 resolved by #6 deletions; 8 tracked to #6/#7/#8/#10/#11 |
| MEDIUM | ~24 | tracked, dispositioned below |
| LOW / informational | ~30 | in the lens files |

Roughly 99 findings in total across the five lenses. Nothing here blocks the *import* — it is already merged — but **three CRITICALs blocked Throttle 1** and are fixed.

---

## CRITICAL

### C1 — A missing auth secret silently became a published constant · FIXED

`apps/api/src/auth.ts:202` passed `secret: process.env.TASKDESK_AUTH_SECRET || ""`, and the length guard only fired when the variable was **already set**. An empty string is falsy inside better-auth, so its own chain ran: `secret → BETTER_AUTH_SECRET → AUTH_SECRET → "better-auth-secret-12345678901234567890"` (`create-context.mjs:78`) — a constant published in its source. `validateSecret` only *throws* for that default when `NODE_ENV === "production"` (`:41`).

TaskDesk is self-hosted-first, where `NODE_ENV` is routinely unset. `charts/taskdesk/values.yaml:94` ships `authSecret: ""` and `deployment.yaml` sets no `NODE_ENV`. **The documented Helm install therefore signed every session cookie with a value anyone can read on npm.** Forge the cookie, become any user — and the cookie-cache path returns session data with no database read, so nothing downstream catches it.

**Fix (commit `2d51262`):** the check moved to `apps/api/src/utils/require-auth-secret.ts` as a pure function, fails closed independently of `NODE_ENV`, and has five negative guards including one asserting the published constant can never be returned.

### C2 — Credentialed CORS reflected any origin on the default deployment · FIXED

`apps/api/src/index.ts:164`: `reflectUnconfiguredOrigins = process.env.NODE_ENV !== "production"`. "Not production" includes **unset**. With `credentials: true`, any site a logged-in user visited could read their authenticated responses.

**Fix (commit `cb64c96`):** reflection is now `NODE_ENV === "development"` — explicit opt-in, fails closed for unset and for unexpected values. The two inherited tests only exercised the explicit strings, so nothing covered the broken case; two negative guards added.

### C3 — `bearer()` publishes the raw session token to any origin · RESOLVED BY #6

`auth.ts:535` mounts `bearer()`, which emits the session token in a `set-auth-token` response header with `Access-Control-Expose-Headers`. Chained with C2 this was readable cross-origin with no XSS. `bearer` is already on #6's removal list; C2's fix removes the chain, and the plugin removal closes it.

---

## HIGH — fixed now

### H1 — A database error downgraded a tenant check to attacker input · FIXED

`utils/workspace-access-middleware.ts:273-276` caught **every** error in `lookupWorkspaceId` and returned `null`, which is indistinguishable from "no such row". Eight sources (`fromTask`, `fromTaskId`, `fromLabel`, `fromComment`, `fromColumn`, `fromTimeEntry`, `fromActivity`, `fromWorkflowRule`) then fall back to a caller-supplied `?workspaceId=`, while the handler still acts on the resource id from the path. A transient error under pool pressure was a cross-tenant window.

**Fix (commit `2d51262`):** raises 503 instead of returning null.

---

## HIGH — structural, and the most important thing in this review

### H2 — Authentication is enforced by source-code ordering · #7 + #8

`api.use("*")` sits at `apps/api/src/index.ts:537`. In Hono it gates only routes registered **below** it. **Sixteen routes are registered above it and are therefore anonymous**, and the guard additionally exempts `/api/mcp`, `/api/.well-known/` and `/api/billing/webhook` by prefix.

Worse, `createRoute({ security: [] })` is **documentation-only** — it edits the OpenAPI document and has zero runtime effect. So the docs and the enforcement can disagree silently, and a route with no `middleware:` key gets no tenant check while still compiling, type-checking and shipping.

This is v1's failure mode exactly: an omission that a green test suite cannot see. It is the precise thing #7's route-coverage gate and #8's retrofit exist to close, and it is the argument for both being non-negotiable before Throttle 1.

I confirmed this independently while removing `public-project`: that route was anonymous *because of where it sat*, and once removed the path finally reached the guard and returned 401.

---

## HIGH — resolved by #6 deletions (do not retrofit policies onto these)

| # | Finding | Path |
| --- | --- | --- |
| H3 | `public-project` returned `workspaceId`, archived/planned tasks, assignee identities and internal GitHub/Gitea URLs anonymously | **already removed, commit `15b8c7b`** |
| H4 | Anonymous asset read: `is_public` is a *project* flag, so publishing a board retroactively exposed every attachment ever uploaded, with `Cache-Control: public`; `move-task.ts:165` re-points `asset.projectId`, so moving a task published its files as a side effect | **already removed, commit `15b8c7b`** |
| H5 | MCP consent click minted a full 30-day session row (`mcp/oauth.ts:122-134`) | #6 — **but deleting the route does not revoke tokens already issued; needs its own issue** |
| H6 | Device flow launders an API key into a session outliving the key's revocation; `POST /device/code` accepts an arbitrary `user_id` unauthenticated | #6 |
| H7 | Slack and Discord webhook posts have **no** destination validation at all | #6 |
| H8 | GitHub repo squatting: failed ownership check downgraded to `console.warn` and proceeds; inbound webhooks fan out by remote-supplied repo name with no tenant scoping | #6 |

---

## HIGH — tracked, not yet fixed

| # | Finding | Path | Owner |
| --- | --- | --- | --- |
| H9 | **`getIp` never consults the TCP peer** — it only parses headers, with `cf-connecting-ip` first, and `trustedProxies` does not gate it. Rate-limit keys and the session IP audit field are attacker-chosen on every deployment. Fix this **with** the rate-limit correction, or enabling the limiter just gives attackers a free key-rotation primitive | `auth.ts` | **#6** |
| H10 | The SSRF guard's wrapper `assertPublicWebhookDestination` lives in `plugins/generic-webhook/config.ts` — a directory #6 deletes — and is imported by two **retained** files (`notification-preferences/delivery.ts:14`, `service.ts:11`). #6 as written breaks the build, and the hurried fix removes SSRF validation | plugins → core | **#6, precondition** |
| H11 | **DNS rebinding**: `assert-public-destination.ts:106-114` resolves once, discards the result, and hands the hostname to `fetch()`, which re-resolves at connect. Nothing pins the IP. (Everything else I tested — decimal/octal/hex IPv4, `127.1`, `0.0.0.0`, `169.254.169.254`, `[::1]`, IPv4-mapped IPv6, userinfo, non-HTTP schemes — is genuinely blocked) | core | **#6** |
| H12 | #6 deletes the two callers that set `redirect: "manual"` and keeps the one that does not (`delivery.ts:28`), so redirect-to-internal survives the cleanup | core | **#6** |
| H13 | Upload size limit is enforced **nowhere** — a client-supplied `size` is validated, then a presigned PUT is issued that cannot express a bound, and no `HeadObject` at finalize | `storage/s3.ts:268-301` | **#6/#10** |
| H14 | `/api/asset/{id}` ignores API-key scopes entirely (`validate-workspace-access.ts:10-30` never reads `apikey.permissions`), and the route sits above the global auth middleware | storage | **#8** |
| H15 | API-key scopes are checked only inside `requireWorkspacePermission`, attached only to **write** routes — a key scoped to `{"task":["create"]}` reads every task, comment, attachment and member email | routes | **#8** |
| H16 | WebSocket accepts cookie auth with **no `Origin` check** (CSWSH), and membership is never re-evaluated after connect | `ws/` | **#7/#8** |
| H17 | Unauthenticated first-run takeover: every registration control bypasses when `existingUserCount === 0`, with no bootstrap token, and `GET /api/instance/status` publicly advertises the window. A guest sign-in also creates a real user row, permanently locking the instance out of ever gaining an admin | `auth.ts:663`, `instance/` | **#6 + NEW ISSUE** |
| H18 | `"custom"` in `trustedProviders` short-circuits the `emailVerified` check; magic-link and email-OTP both set `emailVerified: true`, so the `requireLocalEmailVerified` mitigation is largely a no-op | `auth.ts:235-245` | **#6** |
| H19 | `openAPI()` (`auth.ts:553`) mounts an unauthenticated `/api/auth/reference` that pulls **unpinned** `cdn.jsdelivr.net/npm/@scalar/api-reference` into the API's own cookie origin | `auth.ts` | **#6 — add to the list** |
| H20 | Plugin secrets in `integration.config` (`schema.ts:880`) are **plaintext**, and a pre-P0 review document wrongly describes that column as encrypted. Key derivation is an unsalted single SHA-256 (`secrets.ts:19`) | schema | **#7/#10** |

---

## Add to issue #6's removal list (not currently on it)

`openAPI()`/Scalar reference (H19) · `DEMO_MODE` including `apps/web/src/constants/urls.ts:1` · the `/test-error` SPA route hardcoding a third-party host · guest `emailDomainName` · the scheduler's unguarded `Sentry.captureCheckIn` · **Sentry Session Replay at 10% / 100%-on-error** · and H10 as an explicit precondition ordering item.

---

## Verified clean — recorded so it is not re-litigated

No real committed credentials anywhere (the only regex hit is a synthetic PEM in a test whose body is the literal `abc` — **nothing needs rotating**). No mass assignment: every `.set()` lists columns literally. No GET controller mutates state in the core routers. No analytics or tracking SDK of any kind. No image-processing library, so no ImageTragick/libwebp surface by construction. Gitea webhook signatures use `timingSafeEqual` with the raw body and fail closed with no secret. API keys are SHA-256 digest lookups, not JS string compares. The avatar path does MIME allowlist + size cap + magic-byte verification properly — it is the model the attachment path should follow. Cross-tenant reads were actively attempted against 12 data-returning routes across 8 routers and **none** could be broken: the tenant *model* is sound; it is the *enforcement mechanism* that is one omission away from v1's failure.

---

## Disposition summary

- **3 CRITICAL — all fixed** on `feat/p0-remove-inherited-surfaces` (`2d51262`, `cb64c96`), with negative guards, before Throttle 1.
- **1 HIGH fixed** (H1).
- **H10 is a hard precondition for #6**: relocate the SSRF guard out of the deleted directory *before* deleting it, or the build breaks and the tempting fix is to drop the validation.
- **H2 is the argument for #7 and #8** and should be quoted in both issues.
- **H5 needs a new issue**: deleting the MCP OAuth route does not revoke sessions it already minted.
