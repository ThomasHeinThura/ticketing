# Better Auth admin-route refusal — review record

**Reviewed head:** `ed9878dc809e5d87125ba49ddee7ce3db01a6678`

## Background

The S6 Sol-tier security review (finding B1) reproduced the problem. Better Auth's `adminPlugin` HTTP routes under `/api/auth/admin/*` were reachable by any instance-admin session. With no step-up, no audit and no eligibility checks, such a session could:

- grant instance admin (`set-role`);
- reset passwords (`set-user-password`);
- impersonate users;
- hard-delete users (`remove-user`);
- create users.

`auth-and-identity.md` said these routes were not mounted. That statement was false.

## The fix

A `hooks.before` in the shared `createAuth` refuses, with a 404, every endpoint whose matched path is `/admin` or starts with `/admin/`. The plugin stays mounted only for its session fields and its ban enforcement.

## Contexts

- **Implementation:** Claude Sonnet `ab82256cfff33f0d8`.
- **Ordinary review:** Claude Sonnet `a44d01de398d77294`. APPROVE.
- **Security review:** Claude Opus 5.5 `ade094c41b9204b43`. PASS. This is a Sol-tier review under Thomas's routing, not a GPT-6 Sol review.

Each report is inserted unmodified, with its SHA-256.

<!-- BEGIN REPORT (agent a44d01de398d77294; model claude-sonnet-5-5; role independent ordinary review; candidate ed9878dc809e5d87125ba49ddee7ce3db01a6678; sha256 8bb9199f27bd60f7861e7a8b9e2f38b43d6fbdc60d0ebc27d837e5d4cd41c967) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: authadmin-review-sonnet (fresh ordinary reviewer context, Luna tier; did not author, direct or remediate the candidate)
**Reviewed head:** ed9878dc809e5d87125ba49ddee7ce3db01a6678
Base: b52e38bbfd3e626232abf1ce612d809f917bf0c8 (diff: auth.ts +12, auth-and-identity.md 1 row, new test file 229 lines)
**Verdict: APPROVE (ordinary review). No blocking findings. Sol security review still required (security-scope: apps/api/src/auth.ts).**

## 1. Completeness of the block
Installed better-auth 1.6.30. The admin plugin registers exactly 15 endpoints in dist/plugins/admin/routes.mjs, all under `/admin/`:
set-role, get-user, create-user, update-user, list-users, list-user-sessions, unban-user, ban-user, impersonate-user, stop-impersonating, revoke-user-session, revoke-user-sessions, remove-user, set-user-password, has-permission.
No other plugin or core endpoint in better-auth/dist registers an `/admin` path. The haveibeenpwned plugin only lists `/admin/create-user` and `/admin/set-user-password` in its own path filter; it registers no endpoints.

- ctx.path: dispatch.mjs builds the hook context with `path: endpoint.path`, the matched endpoint's registered path. Every admin endpoint path starts with `/admin/`, so the prefix check covers all 15. Case, encoding and slash variants either route to the same endpoint (and are refused) or match no endpoint (404 from the router).
- Alias or base-path variant: none in 1.6.30. basePath is `/api/auth`; the plugin has no alias paths.
- Every request: the `hooks.before` in `options.hooks` is wrapped by dispatch with `matcher: () => true`. It runs for all methods including GET, and for the router path and for direct `auth.api.*` calls, because both go through `dispatchAuthEndpoint`. It runs before the plugin's own hooks.
- auth.api server calls: grep of apps/api/src shows only getSession, verifyTOTP and verifyBackupCode. No server code calls admin API methods. If one were added later it would be blocked too, because the hook also fires for `auth.api.*` calls. That is a future footgun, not a defect (see N3).
- Both instances: one shared `createAuth(portal)`. The admin plugin is mounted only for `portal === "agent"`. The customer instance has no admin endpoints, so those paths 404 natively and the hook is redundant but harmless.
- Mounting: `/api/auth/*` in apps/api/src/index.ts forwards to `selected.handler`, so there is no bypass route around the Better Auth router.

## 2. Collateral damage
- The check is `=== "/admin"` or `startsWith("/admin/")`. No non-admin Better Auth endpoint starts with `/admin`, so no collateral blocking.
- Session fields (role, banned, impersonatedBy), `adminRoles` and `defaultRole` are plugin schema/config, and the plugin is still mounted. The test confirms `get-session` returns `role: "admin"` and a banned user is refused at sign-in with no session cookie.
- Ban enforcement lives in the plugin's session hooks, not in its endpoints, so it is unaffected.
- apps/web `adminClient()` is registered, but nothing in apps/web or packages calls `authClient.admin.*` or `/api/auth/admin` (confirmed by grep). No shipped feature is affected. It is dead registration, left untouched; fine.

## 3. Tests
- New file: 1 file, 11 tests, 11 passed.
- Mutation: replaced the condition with `if (false && ...)`. 10 of 11 fail, and the 1 survivor is the session-fields/ban test, which is expected. Restored; the diff against HEAD is empty, and the export copy was deleted afterwards.
- Full integration on a `git archive` export (HEAD), on a postgres:18-alpine container: **157 files, 1930 tests, all passed** (875s). This matches the author's counts.

## 4. Other gates (on the export)
- tsc api (tsconfig.json) and tsconfig.tests.json: clean, exit 0.
- Unit (apps/api vitest.config.ts): 102 files, 759 tests passed.
- check:openapi: ok, 208 operations.
- biome ci . : no errors, 177 warnings, 1 info (pre-existing; the same 177 the author reported).

## 5. Docs
The auth-and-identity.md `admin` row is accurate:
- "refused", with the mechanism location and the guarding test named.
- The endpoint list in the row is illustrative (ends in `...`).
- It correctly describes the identity resolver and `/api/instance/users/{id}/impersonate` as the authority path.
- It replaces the previous claim "HTTP routes are not mounted", which was false.

## Findings
BLOCKING: none.

NON-BLOCKING:
- N1. The route test covers 9 of the 15 endpoints. Uncovered: get-user, update-user, list-user-sessions, stop-impersonating, revoke-user-session, has-permission. The prefix hook covers them, so this is not a correctness gap. A stronger test would iterate `auth.api` / the plugin's endpoint paths and assert each is refused. That would also catch a future better-auth bump that adds an `/admin` route outside the prefix, such as an alias.
- N2. Assertions accept `[403, 404]`, and the variants test accepts any non-200. The mutation check shows the state snapshot catches the dangerous outcome, so this is acceptable. Asserting a 404 with body "Not found" for the canonical routes would pin the hook as the source of the refusal. The `/auth/*` policy or CSRF layers could otherwise also produce a 403.
- N3. The hook also blocks future server-side `auth.api.<adminMethod>()` calls. That matches the stated intent, but the code comment could say so, so a later implementer is not surprised.
- N4. In the variants test, csrfRequest `continue`s silently when it throws. If every variant threw, the test would pass vacuously. In my run the mutation made it fail, so some variants do reach the server. A comment or a counter assertion would harden it.
- N5. The PR/review note should state that the base was local main (origin fetch failed in the author's sandbox).

## Cleanup proof
- Container `authrev-pg` (port 55439) was stopped with `docker stop`. It was `--rm` with a tmpfs data dir, and `docker ps -a | grep -c authrev` returned 0.
- The git archive export dir was removed.
- The candidate worktree /private/tmp/claude-501/authadmin was only read, never modified. `git status --short` is empty and HEAD is ed9878dc.
- No other containers were touched. Nothing was committed or pushed.
<!-- END REPORT (sha256 8bb9199f27bd60f7861e7a8b9e2f38b43d6fbdc60d0ebc27d837e5d4cd41c967) -->

<!-- BEGIN REPORT (agent ade094c41b9204b43; model claude-opus-5-5; role independent Sol-tier security review; candidate ed9878dc809e5d87125ba49ddee7ce3db01a6678; sha256 f4ecf9968a43796f498fdd45054b3270635504e88df8276d19cfaeeea8dfefff) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:3a9e9ce4-8409-47d4-b1be-1f1544697e70/authadmin-security-review (this is a fresh subagent under that parent session; no separate agent ID was exposed to me)
**Reviewed head:** ed9878dc809e5d87125ba49ddee7ce3db01a6678

**Verdict: PASS. No blocking findings.** The fix closes B1 from `s6-security-review-opus.md`. I found no bypass by encoding, case, slashes, dot segments, path parameters, query tricks, HTTP method, the second auth instance, or a direct server-side `auth.api.*` call. I found no indirect path that lets a user change role, ban state or impersonation. Four NON-BLOCKING notes follow.

This is a security review only. It is not a merge approval, and it does not replace the ordinary Luna reviews. Whether a Claude Opus 5.5 context satisfies the "GPT-6 Sol" gate is for the orchestrator and Thomas to decide.

- Worktree: `/private/tmp/claude-501/authadmin`, branch `claude/fix-auth-admin-routes`. `git rev-parse HEAD` = `ed9878dc809e5d87125ba49ddee7ce3db01a6678`. The worktree was clean before and after the review.
- Base: main `b52e38bbfd3e626232abf1ce612d809f917bf0c8`. I verified it is the merge base.
- Diff: 2 commits, 3 files, +242/−1. The files are `apps/api/src/auth.ts` (+12), `docs/01-architecture/auth-and-identity.md` (1 line) and `tests/api-integration/auth-admin-routes-refused.test.ts` (new).
- I did not use the author's report (`authadmin-out.md`). Every claim below comes from installed source or from a test I ran.

---

## How the guard works (checked against installed source)

- Installed version: `better-auth@1.6.30`.
- `dist/api/dispatch.mjs` `dispatchAuthEndpoint` builds the hook context as `{...input, path: endpoint.path}`. So `ctx.path` is the **registered path of the endpoint the router already matched**. It is not the request URL. The request has to match an endpoint before any hook runs. That makes path normalisation a routing question, not a question about this hook.
- `getHooks` puts the user `hooks.before` **first**, ahead of every plugin before-hook. The endpoint's own `use: [adminMiddleware]` runs inside `endpoint()`, after the hooks. When the hook throws, no admin-plugin code runs.
- `dist/api/to-auth-endpoints.mjs` sends both the HTTP router and server-side `auth.api.*` calls through `dispatchAuthEndpoint`. So the refusal also covers server-side calls such as `auth.api.setRole(...)`. I confirmed this at runtime: it threw 404 `NOT_FOUND` while the victim still existed.
- `dist/plugins/admin/routes.mjs` registers 15 endpoints. Every one is under `/admin/`: `set-role`, `get-user`, `create-user`, `update-user`, `list-users`, `list-user-sessions`, `unban-user`, `ban-user`, `impersonate-user`, `stop-impersonating`, `revoke-user-session`, `revoke-user-sessions`, `remove-user`, `set-user-password`, `has-permission`. The plugin's only hook is an after-hook on `/list-sessions`. That hook filters out impersonation sessions and is harmless.
- `adminPlugin` is registered only on the agent instance (`auth.ts:422-430`). The customer-portal instance has no `/admin/*` endpoints at all. The hook runs there too, but it never matches.
- Better Auth handler mounts in `apps/api/src/index.ts`:
  - `api.on([...], "/auth/*")` at line 1170;
  - `GET /auth/get-session` at line 726;
  - `GET /auth/device` at line 1166.

  All three end in `selected.handler(buildAuthRequest(c))`. I found no other `.handler(` call in `apps/api/src`.

## Runtime evidence

Environment: a disposable `authsec-pg` container (postgres:18-alpine, tmpfs, 127.0.0.1:55492), with database `authsec_test`.

For the probe and the mutation run I used a separate `git archive` export of the exact head in my scratchpad, with the original `node_modules` linked in. I never modified the candidate worktree.

The probe signed in a real `role='admin'` user with a password, then got a CSRF token from `/api/me/csrf-token`. It started the real `createNodeServer(app, 0)` and sent **raw HTTP/1.1 bytes over a TCP socket**. That way the request path reached the server exactly as written, with no client-side `new URL` normalisation. Every request carried the session cookie, `Origin: http://localhost:1337` and `x-taskdesk-csrf`.

### Fixed head (`ed9878dc`)

- **36 path variants of `POST /api/auth/admin/set-role`** all returned 404, and the victim's role stayed `user`. The variants were:
  - trailing `/` and `//`;
  - `//` before and after `admin`;
  - a leading `//api`;
  - case changes (`Admin`, `ADMIN/SET-ROLE`, `Set-Role`);
  - percent-encoding (`%61dmin`, `%41dmin`, `%73et-role`, `set%2Drole`);
  - encoded slashes (`admin%2Fset-role`, `%2f`, `auth%2Fadmin%2Fset-role`);
  - dot segments (`/./admin`, `admin/./`, `x/../admin`, `x/%2e%2e/admin`, `%2E%2E`, `..%2f`);
  - query strings (`?x=1`, `?/admin`);
  - path parameters (`;x` on the endpoint, `admin;x`);
  - trailing `%00`, `%20`, `%09` and `%23`;
  - a `.json` suffix and a `#frag` fragment;
  - backslash forms (`admin\set-role`, `auth\admin\set-role`);
  - the absolute-form request target `http://localhost:1337/api/auth/admin/set-role`.
- **All 15 admin endpoints × GET/POST/HEAD** returned 404. **OPTIONS** returned 204. That is the CORS preflight answered by middleware; it never reaches Better Auth and has no body or side effects.
- **Portal host** (`Host: portal.localhost:5174`, portal Origin): all 15 endpoints returned 404.
- **`stop-impersonating` from a plain user session** returned 404.
- **Indirect paths, as a non-admin victim session:**
  - `POST /api/auth/update-user` refused each of `{role:"admin"}`, `{name,role:"admin"}`, `{banned:false,banReason}`, `{banned:true}` and `{banExpires}` with 400 `FIELD_NOT_ALLOWED`.
  - `{impersonatedBy}` returned 400 "No fields to update".
  - `{name,"Role":"admin","ROLE":"admin"}` returned 200. Only `name` changed; the role stayed `user`. Unknown keys are dropped because `parseInputData` iterates only declared fields.
  - `POST /api/auth/update-session {impersonatedBy}` returned 400 `FIELD_NOT_ALLOWED`.
  - `POST /api/auth/sign-up/email {..., role:"admin"}` returned 400 `FIELD_NOT_ALLOWED`, and no user was created.
- **Direct `auth.api.setRole`** threw 404 `NOT_FOUND`.
- **End state:**
  - the victim's role, ban flag and password hash were unchanged;
  - there were 0 impersonation sessions;
  - the session count and user count were unchanged.

### Mutation: hook disabled in the export (`if (false && …)`), everything else identical

- `auth-admin-routes-refused.test.ts`: **10 of 11 failed**. That is all 9 route cases plus the path-variant case. Only the session-fields/ban test still passed, which is expected because it does not depend on the hook.
- The same raw-socket probe showed that the harness really reaches the endpoints, so the fixed-head results are not vacuous:
  - **set-role returned 200 and the role became `admin`** through canonical, `/./admin`, `admin/./`, `x/../admin`, `x/%2e%2e/admin`, `%2E%2E`, `?x=1`, `?/admin`, `#frag`, both backslash forms, and the absolute-form target;
  - create-user, admin update-user, list-user-sessions (which returns live session **tokens**), ban/unban, revoke-user-session(s), remove-user and has-permission all returned 200.

  So the reachable spellings of the attack all lead to the same matched endpoint, and the hook refuses each of them at the fixed head. The other spellings (`%2F`, `%61dmin`, case changes, `;`, `%00`, and so on) match no endpoint even without the hook.

### Suites

- `auth-admin-routes-refused.test.ts` on the candidate worktree: **1 file, 11/11 passed**.
- Auth-related integration files on the candidate worktree: **26 files, 210/210 passed**. The files were: auth-admin-routes-refused, account-deletion, api-key-bearer, api-key-owner-state, api-key-self-mutations, authorization-boundaries, cors, csrf-protection, fixture-factor-compatibility, global-auth-guard, identity-connection-admin, instance-setup-bootstrap, local-factor-policy-concurrency, local-factor-policy, organization-active-session, portal-identity-boundary, resolve-identity, resolve-request-identity, session-freshness, session-client-ip, session-oauth-removal-revocation, workspace-session-only, and the `identity/` directory (4 files).

## Collateral

- **Session fields:** `GET /api/auth/get-session` still returns `user.role = "admin"`. Covered by the new test, which passed.
- **Ban enforcement:** the plugin's `databaseHooks.session.create.before` lives in `init()`, not in an endpoint, so the hook does not affect it. A banned user's sign-in is refused and no session cookie is set. Covered by the new test, which passed.
- **First-user bootstrap:** this uses a direct Drizzle write in `databaseHooks.user.create.after` (`auth.ts:686-690`). It is unaffected, and `instance-setup-bootstrap.test.ts` passed.
- **S6 grant-admin (local branch `claude/s6-users` @ `5256156a8fd8041da3758c188674681d1ead14a0`):**
  - it does not modify `auth.ts`;
  - it makes no `auth.api.*` admin-plugin call;
  - it promotes with a direct `.set({ role: "admin" })` (`apps/api/src/instance/users/index.ts:638`).

  So the hook, which also refuses server-side `auth.api` admin calls, does not affect it, and there is no merge conflict on `auth.ts`. I did not re-run S6's own tests.
- **`stop-impersonating` being refused breaks nothing today:**
  - no code in `apps/api/src` or `apps/web/src` calls `authClient.admin.*` or any `/admin/` auth route;
  - `impersonate-user` is refused, so no code path can create a session with `impersonatedBy` set;
  - `update-session` refuses that field, which I confirmed at runtime.
- **The existing `tests/api/two-entry-host.test.ts:135`** expects `/api/auth/admin/list-users` on the portal host to return 404. The hook leaves that unchanged.

## Findings

### N1 · NON-BLOCKING: the new test's path-variant case is normalised before it reaches the app and has a weak assertion

- **Where:** `tests/api-integration/auth-admin-routes-refused.test.ts:154-192`.
- **The normalisation:** `csrfRequest` and the harness's `withConfiguredAgentAuthority` both pass the path through `new URL(...)`. So `./admin`, `x/../admin` and `\` are resolved before the app sees them; they test the canonical path a second time, not the raw spelling.
- **The weak parts:** a variant that `csrfRequest` rejects is skipped silently (the `catch { continue; }` at line 186). The assertion at line 190 is only `not.toBe(200)`.
- **Mitigation:** the mutation run shows this case still fails when the hook is gone, so it is not vacuous. My raw-socket probe covers the raw spellings at the fixed head.
- **Scenario:** a future change to the hook, such as matching on a request-URL-derived path instead of `ctx.path`, could regress a raw-only spelling (for example a backslash or `%2e%2e`) without this test noticing.
- **Suggested fix:** add one raw-socket case through `createNodeServer`, with a handful of dot-segment and backslash spellings, and assert `404` exactly.

### N2 · NON-BLOCKING: the guard is a denylist keyed on a library path prefix

- **Where:** `apps/api/src/auth.ts:734`.
- **Scenario:** a later Better Auth upgrade adds an admin-plugin endpoint outside `/admin/`, or another kept plugin gains a role, ban or password-setting endpoint. The hook would not cover it, and the 15-endpoint list in the test would not notice.
- **Today:** all 15 installed endpoints are under `/admin/`, so this is a risk on upgrade only.
- **Structural options:**
  - add a test that enumerates `Object.values(auth.api)` paths under `/admin` and asserts each is refused, and that `ADMIN_ROUTES` covers the installed set;
  - or remove `adminPlugin` entirely, declare `role`/`banned`/`banReason`/`banExpires`/`impersonatedBy` as `input: false` `additionalFields`, and copy the ~15-line ban check in `session.create.before`. That removes the endpoints instead of hiding them.
- The test currently enumerates only 9 of the 15 endpoints. My probe covered the other 6: `get-user`, `update-user`, `list-user-sessions`, `stop-impersonating`, `revoke-user-session` and `has-permission`. The prefix check already refuses all of them.

### N3 · NON-BLOCKING: dead client and documentation drift around impersonation

- **Where:**
  - `apps/web/src/lib/auth-client.ts:3,38` still registers `adminClient()`. It has no callers today, and any future `authClient.admin.*` call would get 404.
  - `docs/01-architecture/rbac.md:817` and the updated `auth-and-identity.md` row cite `POST /api/instance/users/{id}/impersonate` as the authority that "sets `impersonatedBy`". That route does not exist in `apps/api/src` at this head, which is pre-existing drift.
- **Scenario:** when impersonation is built, someone may reach for `authClient.admin.impersonateUser`/`stopImpersonating` or relax the hook. The application must supply its own stop route as well as its own start route, because the plugin's `stop-impersonating` is now refused.
- **Suggestion:** drop `adminClient()` from the web client. Note in the impersonation spec that both start and stop must be first-party routes.

### N4 · NON-BLOCKING (pre-existing, outside this diff): ban takes effect only when a session is created

- The plugin checks `banned` only in `session.create.before`. A user's existing sessions survive `banned=true` unless they are revoked separately.
- This fix does not change that, but any first-party ban route (S6 or later) must revoke sessions in the same transaction.
- The OPTIONS → 204 result is the CORS preflight answered before Better Auth. It is not a finding.

No BLOCKING findings.

## Commands run (summary)

```
git -C /private/tmp/claude-501/authadmin rev-parse HEAD; git log --oneline -3
git diff --stat b52e38bb...HEAD; git merge-base HEAD b52e38bb
git diff b52e38bb..HEAD -- apps/api/src/auth.ts docs; cat tests/api-integration/auth-admin-routes-refused.test.ts
# installed library source
cat apps/api/node_modules/better-auth/dist/api/{to-auth-endpoints,dispatch}.mjs; grep api/index.mjs
grep createAuthEndpoint dist/plugins/admin/routes.mjs; cat dist/plugins/admin/{admin,schema}.mjs
grep dist/api/routes/update-user.mjs; grep -A30 parseInputData dist/db/schema.mjs
# app source
grep/sed apps/api/src/auth.ts (createAuth, plugins, hooks), apps/api/src/index.ts (all .handler mounts)
grep authClient.admin|adminClient|auth.api.<admin>|impersonat across apps/api/src, apps/web/src
git grep on claude/s6-users -- apps/api/src/instance; git diff --stat b52e38bb claude/s6-users -- apps/api/src/auth.ts
# DB
docker run -d --rm --name authsec-pg --tmpfs /var/lib/postgresql -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55492:5432 postgres:18-alpine
# tests (TASKDESK_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55492/authsec_test)
pnpm exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/auth-admin-routes-refused.test.ts   # 11/11
pnpm exec vitest run --config vitest.integration.config.ts <26 auth-related files incl. identity/>                         # 26 files, 210/210
# scratch export of the exact head (git archive ed9878dc | tar -x), with a raw-socket probe test added there only
pnpm exec vitest run ... zz-authsec-probe.test.ts                                   # fixed head: every probe refused
perl -pi (export only) to change the hook into `if (false && …)`; rerun the probe and the new test  # 10/11 failed; set-role etc. 200
restore the export; docker stop authsec-pg
```

## Residual risk

- **Library upgrade (N2):** the guard depends on Better Auth continuing to (a) set `ctx.path` from the matched endpoint and (b) keep admin endpoints under `/admin/`. Both hold in 1.6.30. A test that enumerates `auth.api` would turn a future drift into a test failure.
- **Instance-admin powers outside Better Auth:** an instance admin still has whatever powers first-party `/api/instance/*` routes grant. Those routes are S6's step-up and audit surface and were not reviewed here.
- **Unreviewed plugin routes:** other Better Auth plugin routes that can change credentials without step-up, such as `/change-password` with the current password, `/email-otp/reset-password` and `/reset-password` with a token, are standard self-service flows. I did not review them as part of this fix.

## What I did not check

- I did not run the full integration suite, the permissions suites, the web build or a container image build/boot.
- I did not run a test through a real reverse proxy (Traefik) in front of the node server. I sent raw bytes straight to `@hono/node-server`. A proxy can only normalise a path further, and every normalised spelling lands on the same matched endpoint.
- I did not runtime-test `update-user` with a real customer-portal session. My statement that `role` is dropped there (the admin schema is absent on that instance, and `parseInputData` iterates declared fields only) comes from reading the source.
- I did not run S6's own tests against this branch. My S6 check was source-level only (no `auth.ts` change, no `auth.api` admin calls).
- I did not check GitHub PR state, CI checks or review records for this branch.
<!-- END REPORT (sha256 f4ecf9968a43796f498fdd45054b3270635504e88df8276d19cfaeeea8dfefff) -->
