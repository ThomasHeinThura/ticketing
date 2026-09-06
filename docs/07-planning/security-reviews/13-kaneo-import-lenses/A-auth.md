# Security Review — TaskDesk v2 PR #13 (kaneo import)
## Lens A: Authentication & Session Configuration
Reviewer: independent post-merge security review. Repo: /home/ubuntu/ticketing.v2 @ main.

Status: COMPLETE — 20 findings (3 CRITICAL, 9 HIGH, 5 MEDIUM, 3 LOW). See the summary table at the end.

---

## Environment facts established (used by findings below)

- better-auth **1.6.25** is the resolved version (`node_modules/.pnpm/better-auth@1.6.25...`), declared as `^1.6.26` in `apps/api/package.json:49`. All library behaviour below is read out of the *installed* 1.6.25 dist, not from docs.
- The whole better-auth handler is mounted as a catch-all: `apps/api/src/index.ts:511` `api.on(["POST","GET","PUT","PATCH","DELETE"], "/auth/*", ...)` -> `auth.handler(c.req.raw)`. **Every endpoint every enabled plugin registers is reachable at `/api/auth/*`.** There is no allow-list of auth routes.
- App-wide identity lookup is `apps/api/src/utils/authenticate-api-request.ts:64` (`authenticateApiRequest`), installed at `apps/api/src/index.ts:555`. It resolves, in order: `x-api-key` -> raw DB api-key lookup; `Authorization: Bearer` -> api-key lookup, then better-auth session; else cookie session.
- `isCloud()` is `process.env.KANEO_CLOUD === "true"` (`apps/api/src/utils/is-cloud.ts:2`). Self-hosted = `isCloud() === false`, which is the *default*.

---

## FINDING A1 — CRITICAL — Auth secret silently falls back to better-auth's public hard-coded default when `NODE_ENV !== "production"`

**Where:** `apps/api/src/auth.ts:202` and the guard at `apps/api/src/auth.ts:104-111`

```ts
// auth.ts:104-111
if (
  process.env.TASKDESK_AUTH_SECRET &&
  process.env.TASKDESK_AUTH_SECRET.length < 32
) { console.error(...); process.exit(1); }
...
// auth.ts:202
secret: process.env.TASKDESK_AUTH_SECRET || "",
```

The guard only fires when the variable **is set and too short**. If it is **unset or empty**, the guard is skipped and `secret` is passed as `""`.

better-auth then does (`apps/api/node_modules/better-auth/dist/context/create-context.mjs:70-79`):
```js
const legacySecret = options.secret || env.BETTER_AUTH_SECRET || env.AUTH_SECRET || "";
...
secret = legacySecret || "better-auth-secret-12345678901234567890";
validateSecret(secret, logger);
```
and `validateSecret` (same file, :38-45):
```js
const isDefaultSecret = secret === DEFAULT_SECRET;
if (isTest()) return;
if (isDefaultSecret && isProduction) throw new BetterAuthError("You are using the default secret...");
```

So the hard fail exists **only when `NODE_ENV === "production"`**. Any deployment that does not set `NODE_ENV` — `pnpm dev`, `node dist/index.js` from a systemd unit, a bare `tsx src/index.ts`, a docker-compose that overrides `NODE_ENV`, or a custom image not built from `Dockerfile.kaneo` — boots happily with the globally-known constant `better-auth-secret-12345678901234567890` (published in the better-auth source and in every node_modules on earth).

**Attack:** the session cookie is `HMAC-SHA256(secret, sessionToken)` and the cookie-cache cookie is a compact-strategy payload verified with `createHMAC("SHA-256").verify(ctx.context.secret, ...)` (`better-auth/dist/api/routes/session.mjs:74-79`). With a known secret an unauthenticated attacker forges a `session_data` cookie containing an arbitrary `{session, user}` payload — including `user.role: "admin"` and any `session.activeOrganizationId` — signs it with the public default, and is served straight out of the cookie cache without any DB read (`session.mjs:87-120`). That is instant full-instance takeover, cross-tenant, with no account needed.

**Why the container image does not save you:** `Dockerfile.kaneo:110` sets `ENV NODE_ENV=production`, so the *bundled image* fails closed. This is exactly the "safe only because of how the vendor shipped it" pattern the review is looking for — the safety lives in one Dockerfile line, not in the application.

**Fix:** make the guard total in `apps/api/src/auth.ts`, independent of `NODE_ENV`:
```ts
const authSecret = process.env.TASKDESK_AUTH_SECRET?.trim();
if (!authSecret || authSecret.length < 32) { console.error("TASKDESK_AUTH_SECRET must be set to >= 32 chars"); process.exit(1); }
```
and pass `secret: authSecret` (never `|| ""`).

**Owner:** #11 deployment (it is a boot-time config contract) — but the code change belongs with #6/#7. Recommend NEW ISSUE if #11 is docs-only, because the fix is a source change in `auth.ts`.

---

## FINDING A2 — HIGH — Client identity for rate limiting and for the session IP audit trail is a plain unverified request header (`cf-connecting-ip`); the TCP peer is never consulted

**Where:** `apps/api/src/auth.ts:800-803`
```ts
advanced: {
  ipAddress: {
    ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
    trustedProxies: trustedProxies(),
  },
```
plus `DEFAULT_TRUSTED_PROXIES` at `apps/api/src/auth.ts:175-181` (loopback + 10/8 + 172.16/12 + 192.168/16).

**What the library actually does** (`@better-auth/core/dist/utils/ip.mjs:201-217` and `:172-192`):
```js
function getIp(req, options) {
  const headers = "headers" in req ? req.headers : req;
  const ipHeaders = options.advanced?.ipAddress?.ipAddressHeaders || ["x-forwarded-for"];
  for (const key of ipHeaders) { const value = headers.get(key); if (typeof value === "string") { const ip = getIPFromHeader(value, {...}); if (ip) return ip; } }
  ...
}
```
`getIp` **never looks at the socket/peer address**. `trustedProxies` only controls how many *trailing* entries of the header chain are skipped; it does not verify that the request actually arrived from a proxy. `getIPFromHeader` walks right-to-left and returns the first entry not in the trusted CIDRs.

Because `cf-connecting-ip` is listed **first** and is a single-value header, `getIp` returns whatever the caller puts there — no proxy required, on any deployment, cloud or self-hosted. Nothing in `apps/api/src/index.ts` strips inbound `cf-connecting-ip` or `x-forwarded-for`.

**Attack:**
1. Rate-limit evasion (where rate limiting is on at all, i.e. cloud): the limiter key is `createRateLimitKey(ip, path)` = `` `${ip}|${path}` `` (`ip.mjs:226`). `curl -H 'cf-connecting-ip: <random public IP>' .../api/auth/sign-in/email` gives a fresh bucket on **every request** — the `/sign-up/email` 3/60s and `/organization/invite-member` 5/60s custom rules at `apps/api/src/auth.ts:570-573` are worth nothing, and neither are the emailOTP plugin's built-in 3/60s rules.
2. Audit-trail poisoning: the value is persisted as `session.ipAddress`, so the "active sessions"/security UI and any incident forensics attribute a compromise to an IP of the attacker's choosing.
3. On self-hosted behind a reverse proxy that does not clear `cf-connecting-ip` (nginx/Traefik do not, by default), the same spoof works from the public internet.

**Fix:** do not put `cf-connecting-ip` in `ipAddressHeaders` unless `isCloud()` (where Cloudflare is actually in front and does overwrite it); for self-hosted derive the IP from `x-forwarded-for` **only** when a proxy is explicitly configured, default `TRUSTED_PROXIES` to empty (fail closed to "no header trusted") rather than to all of RFC1918, and strip inbound `cf-connecting-ip`/`x-forwarded-for` at the edge middleware in `apps/api/src/index.ts` when no proxy is configured.

**Owner:** #7 policy registry (the trust decision is a policy) + #11 deployment. NEW ISSUE if neither covers the `ipAddressHeaders` ordering, which is the actual bug.

---

## FINDING A3 (confirms known item, but the impact is worse than stated) — HIGH — `rateLimit.enabled: isCloud()` disables *every* rate-limit rule, including plugin-declared ones, and there is no other limiter anywhere in the API

**Where:** `apps/api/src/auth.ts:565-575`
```ts
rateLimit: {
  enabled: isCloud(),
  window: 10, max: 100,
  customRules: {
    "/sign-up/email": { window: 60, max: 3 },
    "/organization/invite-member": { window: 60, max: 5 },
  },
},
```

Three things sharpen the known finding:

1. **It is strictly worse than the upstream default.** better-auth defaults to `enabled: options.rateLimit?.enabled ?? isProduction` (`better-auth/dist/context/create-context.mjs:170`). By hard-coding `isCloud()`, a **production self-hosted** instance loses the limiter that better-auth would otherwise have switched on for it.
2. **Plugin-declared rules die with it.** `better-auth/dist/api/rate-limiter/index.mjs:333` is `if (!ctx.rateLimit.enabled) return;` — evaluated *before* plugin rules (`:293-300`) and custom rules (`:301-310`) are consulted. So the `emailOTP` plugin's own 3-per-60s protections on `/sign-in/email-otp`, `/email-otp/send-verification-otp`, `/email-otp/verify-email`, `/forget-password/email-otp`, `/email-otp/reset-password` (`better-auth/dist/plugins/email-otp/index.mjs:74-131`) are **all inert on self-hosted**. The library author's assumption was that these rules always run.
3. **Nothing else fills the gap.** A grep of `apps/api/src` for `rateLimit|rate-limit|rateLimiter` finds only this block, the api-key plugin block, and DB columns — there is no Hono rate-limit middleware.

**Concrete consequences on a default self-hosted TaskDesk:**
- Unlimited password guessing on `POST /api/auth/sign-in/email` (bcrypt cost 10, `apps/api/src/auth.ts:251` — cheap enough to be a practical online attack, and the cost is a server-side DoS lever too).
- Unlimited 6-digit sign-in OTP guessing: the OTP is 6 numeric digits with a 300 s life (`email-otp/index.mjs:11,14`), stored **in plaintext** in the verification table (`storeOTP` defaults to `"plain"`, not overridden at `apps/api/src/auth.ts:474-487`). The only remaining brake is the per-OTP attempt counter (`email-otp/routes.mjs:246-253`), and `/email-otp/send-verification-otp` is itself unthrottled, so the attacker mints fresh OTPs indefinitely.
- Unlimited magic-link and OTP email sends to arbitrary addresses = mail bombing an arbitrary victim from the instance's SMTP identity, plus SMTP-cost DoS.
- Unlimited `/organization/invite-member` — the exact "~14k phishing invites" incident referenced in the code comment at `apps/api/src/auth.ts:681-684` is unmitigated on self-hosted, because that gate is also `isCloud()`-only (`auth.ts:686`).

**Fix:** `enabled: process.env.DISABLE_RATE_LIMIT !== "true"` (on by default everywhere, explicit opt-out), and keep the customRules.

**Owner:** #8 router retrofit / #7 policy registry.

---

## FINDING A4 — HIGH — Rate-limit state is per-process memory even when enabled, despite Redis being a first-class dependency

**Where:** `apps/api/src/auth.ts:565-575` — no `storage` / `customStorage` / `secondaryStorage` is configured anywhere in the `betterAuth({...})` call.

better-auth resolves `storage: options.rateLimit?.storage || (options.secondaryStorage ? "secondary-storage" : "memory")` (`better-auth/dist/context/create-context.mjs:172`), and the memory backend is a module-level `Map` (`better-auth/dist/api/rate-limiter/index.mjs:6`) capped at 100k entries with FIFO eviction (`:8-17`).

**Attack / impact:** the API is horizontally scaled (the Helm chart templates a Deployment; `ioredis` is a direct dependency and `apps/api/src/redis/` exists). With N replicas behind a service, every limit is effectively **N x** looser, and each pod's counters reset on restart/rollout. Worse, the 100k-entry FIFO cap is itself an eviction attack: combined with A2 (attacker-chosen IP), an attacker sends 100k requests with distinct spoofed `cf-connecting-ip` values and **flushes every real bucket out of the map**, resetting everyone's limits including their own.

**Fix:** back the limiter with the existing Redis client via `rateLimit.customStorage` (or wire `secondaryStorage`), and fix A2 so the key is not attacker-chosen.

**Owner:** #8 router retrofit. NEW ISSUE if #8 is HTTP-routing only.

---

## FINDING A5 — CRITICAL — Helm chart ships `authSecret: ""` and never sets `NODE_ENV`, so the documented Kubernetes install boots on better-auth's public default secret

This is A1 turned from "possible" into "the default for the documented production install path". Three chart facts:

1. `charts/taskdesk/values.yaml:94` — `authSecret: ""`, with `existingSecret.enabled: false` (`:95-98`).
2. `charts/taskdesk/templates/deployment.yaml:56-64` renders `TASKDESK_AUTH_SECRET` unconditionally; with the defaults it renders `value: ""`. There is no `required`, no `fail`, no NOTES-time check anywhere in the chart.
3. The container `env:` block (`deployment.yaml:51-96`) sets **`TASKDESK_AGENT_URL`, `CORS_ORIGINS`, `TASKDESK_AUTH_SECRET`, `TASKDESK_DATABASE_URL`, `DISABLE_REGISTRATION`, `DISABLE_PASSWORD_REGISTRATION`, `DISABLE_EMAIL_OTP_SIGN_IN` — and nothing else. No `NODE_ENV`.**

`isProduction` is exactly `NODE_ENV === "production"` (`@better-auth/core/dist/env/env-impl.mjs:30-31`). With `NODE_ENV` unset in the pod, `validateSecret`'s hard failure never fires and the instance runs on `better-auth-secret-12345678901234567890`.

**Result: `helm install taskdesk ./charts/taskdesk --set taskdesk.env.clientUrl=https://... ` produces an instance whose session cookies anyone on the internet can forge.** See A1 for the forgery mechanics.

**Corroborating evidence that the "NODE_ENV=production" safety net is not real:** the only place that sets it is `Dockerfile.kaneo:110`, and **`Dockerfile.kaneo` cannot build from this tree** — it `COPY`s three files that do not exist in the repo: `apps/web/env.sh` (`:105`), `apps/web/nginx.kaneo.conf` (`:103`), and `deploy/kaneo-entrypoint.sh` (`:106`; there is no `deploy/` directory at all). So no artifact in this repo reliably sets `NODE_ENV=production`.

**Fix:**
- `apps/api/src/auth.ts` — hard-fail on a missing/short secret regardless of `NODE_ENV` (see A1).
- `charts/taskdesk/templates/deployment.yaml` — `{{ required "taskdesk.env.authSecret or existingSecret is required" ... }}`, and add `- name: NODE_ENV / value: production`.

**Owner:** #11 deployment + #10 CI (a chart-render + boot smoke test would have caught this). The `auth.ts` half is NEW ISSUE.

---

## FINDING A6 — CRITICAL — Same chart defaults produce credentialed CORS reflection of *any* origin, and `bearer()` deliberately exposes the session token to that origin

Two halves that only bite together.

**Half 1 — CORS.** `apps/api/src/index.ts:156-191`:
```ts
const corsOriginSource = [process.env.CORS_ORIGINS, process.env.TASKDESK_AGENT_URL].find((v) => v?.trim());
const corsOrigins = corsOriginSource?.split(",")...;
const reflectUnconfiguredOrigins = process.env.NODE_ENV !== "production";
...
cors({ credentials: true, origin: (origin) => {
  if (!corsOrigins) { return reflectUnconfiguredOrigins ? origin || "*" : null; }
  ...
}})
```
The chart's default `clientUrl: ""` (`values.yaml:88`) makes `$corsOriginsValue` empty (`deployment.yaml:1-9` falls through every branch), so **both** `CORS_ORIGINS` and `TASKDESK_AGENT_URL` render as `""`. Both are falsy, `corsOrigins` is `undefined`, and `NODE_ENV` is unset (A5), so `reflectUnconfiguredOrigins` is `true` -> **every origin is reflected with `Access-Control-Allow-Credentials: true`.** The in-code comment ("so it stays a development convenience") is correct about the intent and wrong about the effect, because nothing in the deployment path pins `NODE_ENV`.

**Half 2 — `bearer()` hands the raw session token to that origin.** `apps/api/src/auth.ts:535` enables `bearer()` with no options. Its `after` hook matches **every** auth route (`better-auth/dist/plugins/bearer/index.mjs:50-52` — `matcher(context) { return true; }`) and does:
```js
ctx.setHeader("set-auth-token", token);
ctx.setHeader("Access-Control-Expose-Headers", ...headersSet incl. "set-auth-token");
```
So any auth response that sets a session cookie also returns the raw session token in a header that is **explicitly whitelisted for cross-origin JavaScript to read**. That is a deliberate opt-out of `HttpOnly` for whatever origin CORS allows.

**Attack:** victim is signed in to `https://taskdesk.example`. They visit `https://evil.test`. `evil.test` runs `fetch("https://taskdesk.example/api/auth/sign-in/email", {credentials:"include", ...})` or any auth route that refreshes the session; the reflected `Access-Control-Allow-Origin: https://evil.test` + `Allow-Credentials: true` lets it read the body **and** the exposed `set-auth-token` header. It now holds a bearer session token valid for 7 days, usable against the whole API (`bearer()` accepts unsigned raw session tokens — `bearer/index.mjs:33-36`, `requireSignature` is not set). No XSS on the victim origin required.

**Fix:** delete `reflectUnconfiguredOrigins` entirely (fail closed with the warning that is already written), make `TASKDESK_AGENT_URL` a required boot variable, and set `bearer({ requireSignature: true })` — or drop `bearer()` if the CLI/MCP clients can use `x-api-key`.

**Owner:** #10 CI + #11 deployment for the chart half; #6 removals for `bearer()`. The `reflectUnconfiguredOrigins` branch is NEW ISSUE.

---

## FINDING A7 — HIGH — `KANEO_API_URL` is set by nothing, so the session cookie is issued **without `Secure`** on an HTTPS deployment

`apps/api/src/auth.ts:82` — `const apiUrl = process.env.KANEO_API_URL || "http://localhost:1337";`

`charts/taskdesk/values.yaml:87` claims *"KANEO_API_URL is derived automatically as clientUrl/api if not set"*. **No such derivation exists** — not in `deployment.yaml` (there is no `API_URL` env at all), not in `auth.ts`, not anywhere. The variable is also still `KANEO_`-prefixed, i.e. it was missed by the PR-#13 env rename, so operators following `docs/05-operations/configuration-reference.md` never set it either.

Consequence, via `apps/api/src/utils/get-default-cookie-attributes.ts:19,37`:
```ts
const isHttps = parsedApiUrl?.protocol === "https:";   // false, apiUrl is http://localhost:1337
return { sameSite: ..., secure: isHttps, ... };        // secure: false
```
**The better-auth session cookie is issued with `Secure` unset on a TLS-fronted instance.** Any plaintext request to the same host — a `http://` link, an HSTS-less first visit, a captive portal / hostile Wi-Fi triggering one sub-resource — transmits the full session cookie in cleartext, and an on-path attacker replays it.

Second-order: `baseURL` is also `http://localhost:1337` (`auth.ts:92-100, 200`), so every URL better-auth generates from `baseURL` (OAuth `redirect_uri`, magic-link and verification links when the plugin builds them from baseURL) points at localhost, and `trustedOrigins` contains `http://localhost:1337` (`auth.ts:85-91`).

Note the correct branch does exist and works — `isCrossSubdomain` deliberately excludes `localhost` (`get-default-cookie-attributes.ts:24-28`), so this is not a bug in that helper; it is that nothing supplies its input.

**Fix:** rename to `TASKDESK_API_URL`, template it in the chart (`https://` + `hosts.agent` + no path), and make `secure` default to `true` unless the resolved origin is explicitly `http://localhost`/`127.0.0.1`.

**Owner:** #11 deployment. NEW ISSUE for the `secure` default in `get-default-cookie-attributes.ts`.

---

## FINDING A8 — HIGH — Unauthenticated `POST /api/auth/sign-in/anonymous` bypasses `DISABLE_REGISTRATION`, and one such call permanently destroys the instance-admin bootstrap

**Where:** `apps/api/src/auth.ts:274-283` (plugin enabled unless `DISABLE_GUEST_ACCESS === "true"` — i.e. **on by default**), `apps/api/src/auth.ts:584-589` and `:623-630` (the two `isAnonymous` early-returns), `apps/api/src/auth.ts:640-666` (first-user promotion), `apps/api/src/instance/controllers/get-instance-status.ts:10-19`.

**(a) It is a registration bypass.** `databaseHooks.user.create.before` returns early for anonymous users *before* `checkRegistrationAllowed` runs:
```ts
// auth.ts:584-589
const userWithAnonymous = user as Partial<UserWithAnonymous>;
if (userWithAnonymous.isAnonymous) { return; }
```
So on an instance hardened with `DISABLE_REGISTRATION=true` **and** `DISABLE_LOGIN_FORM=true`, an unauthenticated attacker still gets a real `user` row and a real 7-day session with `POST /api/auth/sign-in/anonymous` (`/sign-in/anonymous` is also not in `localSignInPaths`, `apps/api/src/utils/is-local-sign-in-path.ts:1-6`, so the login-form kill switch does not cover it either). The plugin creates a genuine row: `internalAdapter.createUser({ email: temp-<id>@taskdesk.app, emailVerified: false, isAnonymous: true, ... })` then `createSession` (`better-auth/dist/plugins/anonymous/index.mjs:46-60`).

**(b) That guest is a first-class principal everywhere.** A grep of the entire `apps/api/src` tree for `isAnonymous` returns **six** hits, all in `auth.ts`, and only one is an authorization gate — the invite-member gate at `auth.ts:686-697`, which is wrapped in `if (... && isCloud())`. **No route in the API restricts anonymous users.** A guest can create workspaces (`allowUserToCreateOrganization: true` unless `DISABLE_WORKSPACE_CREATION`, `auth.ts:395-401`), create projects and tasks, upload assets, configure integrations, send workspace invitations on self-hosted, and **mint a permanent API key** via `POST /api/auth/api-key/create` — turning a zero-credential request into a durable credential. Anonymous users are never garbage-collected; they are deleted only if they later link to a real account (`anonymous/index.mjs:155-165`).

**(c) One request permanently prevents the operator from ever becoming instance admin.** The promotion is guarded by `totalUserCount === 1` (`auth.ts:655-665`) and anonymous users return early *before* it (`auth.ts:623-630`) but *after* the row is inserted. So:
1. Attacker: `POST /api/auth/sign-in/anonymous` -> `user` table now has 1 row (an anonymous one, never promoted).
2. Operator signs up -> `after` hook sees `totalUserCount === 2` -> **no promotion**.
3. `auth.ts:663` is the **only** code in the entire repo that ever writes `role: "admin"`. There is no CLI, script, or env-var fallback. The instance is permanently admin-less.

With `DISABLE_REGISTRATION=true` it is worse: the bootstrap exemption is `if (existingUserCount === 0) return;` (`auth.ts:596-603`), and the anonymous row makes the count 1, so the operator's own first signup is rejected with FORBIDDEN and **the instance can never be set up at all**. Unauthenticated, single request, permanent.

**(d) A public oracle makes it targetable.** `GET /api/instance/status` is registered with `security: []` (`apps/api/src/index.ts:207-222`) and returns `{ hasUsers, hasAdmin }` computed over the whole user table. An attacker scanning for TaskDesk instances learns exactly which ones are unclaimed, and can either race the operator to first-signup (**becoming instance admin of someone else's deployment**) or brick the bootstrap per (c).

**Fix:** default the anonymous plugin **off** (`ENABLE_GUEST_ACCESS === "true"` to opt in) rather than on; count only non-anonymous users in the bootstrap/promotion logic and in `getInstanceStatus`; replace first-signup-wins with an out-of-band bootstrap (`TASKDESK_INITIAL_ADMIN_EMAIL`, or a one-time token printed to the container log); require auth on `/api/instance/status` or reduce it to a boolean that does not distinguish "fresh" from "claimed".

**Owner:** #6 removals (drop `anonymous()`), #7 policy registry (default-off + bootstrap policy). The `totalUserCount` miscount is NEW ISSUE.

---

## FINDING A9 — HIGH — `DISABLE_LOGIN_FORM` does not cover `/sign-up/email`, and `autoSignIn: true` mints a session straight from signup

**Where:** `apps/api/src/utils/is-local-sign-in-path.ts:1-9` and `apps/api/src/auth.ts:248-259, 675-680`

```ts
// is-local-sign-in-path.ts
const localSignInPaths = new Set(["/sign-in/email", "/sign-in/magic-link", "/magic-link/verify", "/sign-in/email-otp"]);
export function isLocalSignInPath(path: string) { return localSignInPaths.has(path) || path.startsWith("/email-otp/"); }
```
```ts
// auth.ts:675-680
if (isLoginFormDisabled && isLocalSignInPath(ctx.path)) { throw new APIError("FORBIDDEN", {...}); }
```
```ts
// auth.ts:248-253
emailAndPassword: { enabled: true, autoSignIn: true, ... }
```

`/sign-up/email` is **not** in the set, and `/sign-in/anonymous` is not either. `DISABLE_LOGIN_FORM=true` is the switch an operator flips to say "SSO only, no local passwords". It does not do that: as long as registration is on (the default), an attacker `POST`s `/api/auth/sign-up/email` and, because `autoSignIn: true`, the response carries a valid session cookie. They never touch a blocked path. The password-only kill switch `DISABLE_PASSWORD_REGISTRATION` is a *separate* variable (`auth.ts:723-729`), so an operator who sets only `DISABLE_LOGIN_FORM` gets no protection at all.

**Fix:** add `/sign-up/email` and `/sign-in/anonymous` to `localSignInPaths`, or better, invert the check to an allow-list of the enabled federated paths.

**Owner:** #7 policy registry.

---

## FINDING A10 — HIGH — `accountLinking.trustedProviders` includes `"custom"`; an attacker with an account at the operator's OIDC provider takes over any TaskDesk account whose email is "verified", and magic-link/OTP sign-in makes almost every account "verified"

**Where:** `apps/api/src/auth.ts:233-246`
```ts
account: { accountLinking: {
  // The listed providers verify the email on their side, so they are trusted to link.
  enabled: true,
  trustedProviders: ["github", "google", "discord", "custom"],
  requireLocalEmailVerified: true,
} },
```
`"custom"` is the `genericOAuth` provider id defined at `apps/api/src/auth.ts:520-535`, configured entirely from `CUSTOM_OAUTH_*` env vars. **The comment's premise is false for `custom`:** it is an arbitrary operator-supplied OIDC endpoint. Nothing checks its `email_verified` claim — `mapCustomOAuthProfileToUser` (`apps/api/src/utils/custom-oauth-profile.ts:5-23`) maps only `name` and never touches `email_verified`.

**Why "trusted" removes the only check.** `better-auth/dist/oauth2/link-account.mjs:20-28`:
```js
const isTrustedProvider = opts.isTrustedProvider || opts.trustProviderByName !== false && c.context.trustedProviders.includes(account.providerId);
const requireLocalEmailVerified = accountLinking?.requireLocalEmailVerified ?? true;
if (!isTrustedProvider && !userInfo.emailVerified || requireLocalEmailVerified && !dbUser.user.emailVerified || ...) { return { error: "account not linked", data: null }; }
```
`genericOAuth` calls `handleOAuthUserInfo` with neither `isTrustedProvider` nor `trustProviderByName` (`better-auth/dist/plugins/generic-oauth/routes.mjs:273-284`), so `trustProviderByName !== false` is true and `trustedProviders.includes("custom")` is true. The `!userInfo.emailVerified` guard — the *only* thing that would reject an unverified IdP email — is short-circuited away. The remaining gate is purely about the **local** account.

**Why the local gate is almost always satisfied.** `requireLocalEmailVerified: true` looks protective, and the comment at `auth.ts:240-244` reasons about pre-registration squatting. But TaskDesk sets `emailVerified: true` on every magic-link and email-OTP sign-in:
- `better-auth/dist/plugins/magic-link/index.mjs:162` (`emailVerified: true` on create) and `:169-171` (upgrades an existing unverified user to verified).
- `better-auth/dist/plugins/email-otp/routes.mjs:412` and `:426-428` (same, for `/sign-in/email-otp`).

Both plugins are enabled by default (`auth.ts:280-294` unconditional magic link; `auth.ts:295-311` emailOTP unless `DISABLE_EMAIL_OTP_SIGN_IN`). So the population with `emailVerified = true` is essentially everyone who has ever used a login link or code, plus every Google/GitHub/Discord SSO user.

**Attack:** operator runs TaskDesk with a `custom` OIDC provider (a partner IdP, a Keycloak/Authentik realm with self-service registration, or any IdP where `email` is a self-asserted or editable profile field).
1. Attacker registers at that IdP with `email = victim@corp.com`, no verification needed.
2. Attacker hits `GET /api/auth/sign-in/oauth2?providerId=custom` and completes the flow.
3. `handleOAuthUserInfo` finds the existing TaskDesk user for `victim@corp.com`, sees `isTrustedProvider === true`, sees `dbUser.user.emailVerified === true`, and calls `internalAdapter.linkAccount(...)` (`link-account.mjs:30-42`).
4. The attacker is now signed in **as the victim** — including if the victim is the instance admin (who can then impersonate everyone else, A11).

`allowDifferentEmails` is not set, so the emails must match — which is precisely what the attacker arranges.

**Fix:** remove `"custom"` from `trustedProviders` (leave `github`/`google`/`discord`, which do assert verification), and require `userInfo.emailVerified` for the generic provider — surface `email_verified` through `mapCustomOAuthProfileToUser` and gate on it. If an operator's IdP genuinely is authoritative, make it an explicit `CUSTOM_OAUTH_TRUST_EMAIL=true` opt-in rather than the default.

**Owner:** #7 policy registry. Confirms and sharpens the known accountLinking item.

---

## FINDING A11 — HIGH — `enableSessionForAPIKeys: true` makes an API key a full, always-"fresh" session on every `/api/auth/*` route, escaping TaskDesk's own API-key permission scoping

**Where:** `apps/api/src/auth.ts:536-546`, `apps/api/src/index.ts:511-538`, `apps/api/src/utils/authenticate-api-request.ts:69-104`

The api-key plugin registers a `before` hook whose matcher is simply "an `x-api-key` header is present" and which sets a synthetic session (`@better-auth/api-key/dist/index.mjs:2396-2445`):
```js
const session = { user, session: { id: apiKey.id, token: key, userId: apiKey.referenceId, ..., createdAt: new Date(), ... } };
ctx.context.session = session;
```
No permission check of any kind happens in that hook.

Three consequences that are **not** just "an API key acts as the user":

1. **The API key's `permissions` scope is bypassed on every auth route.** TaskDesk enforces key scoping in its own middleware (`authenticate-api-request.ts:69-86` sets `c.set("apiKey", { permissions })`). That middleware is `api.use("*", ...)` registered at `index.ts:552` — **after** the `/auth/*` catch-all handler at `index.ts:511`. A Hono route handler registered earlier returns the response and the later middleware never runs. So a deliberately narrow key still gets an unrestricted session for `/api/auth/organization/*` (invite-member, remove-member, update-member-role, create/delete workspace, dynamic-role creation), `/api/auth/api-key/create`, `/api/auth/unlink-account`, and — if the key's owner is an instance admin — the whole `/api/auth/admin/*` surface.

2. **An API key can mint more API keys.** `createApiKey` reads the session with `getSessionFromCtx(ctx, { disableCookieCache: true })`, but `getSessionFromCtx` short-circuits on line 1: `if (ctx.context.session) return ctx.context.session;` (`better-auth/dist/api/routes/session.mjs:273-274`). The api-key hook already populated it, so the "disableCookieCache" hardening is moot. Revoking a leaked key does not contain the incident — the attacker minted siblings.

3. **An API key satisfies every freshness requirement.** `freshSessionMiddleware` compares `session.session.createdAt` against `freshAge` (default 1 day, `better-auth/dist/api/routes/session.mjs:358-365`); the synthetic session's `createdAt` is `new Date()`, so it is **always fresh**. Re-authentication requirements that exist specifically to force a recent interactive login are unconditionally satisfied by a static credential.

**Verified NOT vulnerable (stated for completeness):** `sensitiveSessionMiddleware` does resist this — `getAuthoritativeSessionFromCtx` explicitly does `ctx.context.session = null` before re-reading (`session.mjs:312-316`), so `/delete-user`, `/change-password`, `/change-email` and `/update-user` are **not** reachable with an API key. Also, `POST /api-key/create` correctly refuses client-supplied `userId` and `permissions` (`@better-auth/api-key/dist/index.mjs:734-737`), so a user cannot self-issue a key for another user or widen its scope.

**Fix:** set `enableSessionForAPIKeys: false` and let `authenticateApiRequest` remain the single place that resolves an API key (it already does the DB lookup itself in `utils/verify-api-key.ts`). If session-for-key must stay, move the `/auth/*` mount **after** a middleware that rejects `x-api-key` on `/auth/admin/*`, `/auth/api-key/*`, `/auth/organization/*` and `/auth/device/*`.

**Owner:** #6 removals. Confirms the known `enableSessionForAPIKeys` item.

---

## FINDING A12 — HIGH — The device-authorization flow turns any API key (or any session) into a fresh long-lived session token, and `POST /device/code` accepts an attacker-chosen `user_id` unauthenticated

**Where:** `apps/api/src/auth.ts:547-552`, `apps/api/src/index.ts:473-508`

**(a) Privilege laundering: API key -> real session.** `/device/approve` authorizes with a bare `getSessionFromCtx(ctx)` (`better-auth/dist/plugins/device-authorization/routes.mjs:395`), and `/device` (the claim step) likewise (`:341`). Per A11 an `x-api-key` header satisfies both. Full chain, all unauthenticated except step 2:
1. `POST /api/auth/device/code` `{client_id:"taskdesk-cli"}` — allowed because `taskdesk-cli` is in the built-in default set (`apps/api/src/auth.ts:162-173`, used as `validateClient` at `:549-551`). Returns `device_code` + `user_code`.
2. `GET /api/auth/device?user_code=...` with `x-api-key: <key>` — claims the code for the key's owner (`routes.mjs:341-362`).
3. `POST /api/auth/device/approve` `{userCode}` with `x-api-key: <key>` — marks it approved.
4. `POST /api/auth/device/token` `{grant_type:"urn:ietf:params:oauth:grant-type:device_code", device_code, client_id:"taskdesk-cli"}` — **no credential at all** — returns `{ access_token: session.token, ... }` from a freshly created DB session (`routes.mjs:246-287`).

The result is a real 7-day session token that **survives revocation of the API key** and is not listed as an API key anywhere. A CI token or a narrowly-scoped bot key becomes an indefinitely renewable interactive session. The same chain works from a stolen session cookie to produce a second, independent token that logging out will not kill.

**(b) Unauthenticated pre-binding of device codes to arbitrary users.** `deviceCodeBodySchema` includes `user_id` ("The user ID to which the device code should be pre-bound") and the handler writes it straight through with **no guard for client requests** (`routes.mjs:9-13` and `:98-109`):
```js
data: { deviceCode, userCode, userId: ctx.body.user_id || null, expiresAt, status: "pending", ... }
```
Compare `/api-key/create`, which explicitly does `if (ctx.request && ctx.body.userId !== void 0) throw UNAUTHORIZED` — the device plugin has no equivalent. An unauthenticated attacker can therefore create unlimited `deviceCode` rows bound to any user id they can guess or read, which (i) pre-targets a phishing approval at a specific victim and (ii) with no rate limiting (A3) is an unauthenticated write-amplification against the `deviceCode` table.

**(c) TaskDesk widens the phishing surface rather than narrowing it.** `apps/api/src/index.ts:490-507` deliberately redirects a browser navigation of `/api/auth/device?user_code=...` to `${TASKDESK_AGENT_URL}/device?user_code=...`, i.e. it supports the RFC 8628 `verification_uri_complete` pre-filled-code pattern. Pre-filling the code is exactly what makes device-code phishing a one-click attack (RFC 8628 s5.3): the attacker starts the flow, sends the victim the complete URL, the victim clicks Approve, and the attacker polls `/device/token` for the victim's session.

**Fix:** reject `user_id` on `/device/code` for client requests; require a **cookie** session (not an api-key session) for `/device` and `/device/approve`; drop the `ui=1` / pre-filled-code redirect and require the user to type the code; and scope the resulting token rather than issuing a full session.

**Owner:** #6 removals (drop `deviceAuthorization()` if the CLI can use API keys) or NEW ISSUE. Confirms and greatly extends the known `deviceAuthorization()` item.

---

### A1 addendum — exact forgery mechanics (verified in the installed dist)

`setCookieCache` (`better-auth/dist/cookies/index.mjs:74-111`), default `strategy: "compact"`:
```js
data = base64Url.encode(JSON.stringify({
  session: { session: filteredSession, user: filteredUser, updatedAt, version },
  expiresAt: expiresAtDate,
  signature: await createHMAC("SHA-256","base64urlnopad").sign(ctx.context.secret, JSON.stringify({ ...sessionData, expiresAt: expiresAtDate })),
}))
```
and the read path (`better-auth/dist/api/routes/session.mjs:44-45, 74-120`):
```js
const sessionCookieToken = await ctx.getSignedCookie(authCookies.sessionToken.name, ctx.context.secret);
if (!sessionCookieToken) return null;
...
if (await createHMAC("SHA-256","base64urlnopad").verify(ctx.context.secret, JSON.stringify({...parsed.session, expiresAt: parsed.expiresAt}), parsed.signature)) sessionDataPayload = parsed;
...
// cache hit -> returns parsedSession/parsedUser directly, with NO database read and NO comparison
// between sessionCookieToken and session.session.token
```
So with a known secret the attacker forges **two** cookies signed with it — a `session_token` whose value is never checked against the database, and a `session_data` payload containing an arbitrary `user` object (`id`, `email`, `role: "admin"`) and `session` object (`activeOrganizationId` of any tenant). No account, no database row, no network position. Every request through `authenticateApiRequest` -> `auth.api.getSession` takes this cache path (it does not pass `disableCookieCache`), so the forged identity is accepted API-wide.

---

## FINDING A13 — MEDIUM — Session revocation, ban, and role changes take up to 5 minutes to take effect, and nothing bounds that for privileged operations

**Where:** `apps/api/src/auth.ts:556-561`
```ts
session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
```

**Verified behaviour (not assumed):**
- `refreshCache` is not set, so `cookieRefreshCache` resolves to `false` (`better-auth/dist/context/create-context.mjs:149-165`). The cache therefore **cannot** renew itself from the cookie; the window is bounded at `maxAge` from the last database-backed read. Good — this is the one thing that keeps the window at 5 minutes instead of unbounded, and it should be stated in the issue so nobody "fixes" it by enabling `refreshCache`.
- On a cache hit the handler returns the cached `{session, user}` with **no database read at all** (`session.mjs:104-120`), so a deleted `session` row keeps working.
- `authenticateApiRequest` calls `auth.api.getSession({ headers })` with no `disableCookieCache` (`apps/api/src/utils/authenticate-api-request.ts:24-25`), so every API request in the product takes that path.

**Concrete windows:**
- `POST /api/auth/admin/ban-user` calls `deleteUserSessions` (`better-auth/dist/plugins/admin/routes.mjs:538`) — the banned user keeps full access for up to 5 minutes. The `banned` check itself lives **only** in `databaseHooks.session.create.before` (`better-auth/dist/plugins/admin/admin.mjs:32-49`), i.e. it is a *session-creation* check; it never runs on session *validation*, so nothing else catches them.
- `/admin/revoke-user-session(s)`, a user's own "sign out other devices", and workspace member removal are all subject to the same 5-minute tail.
- Instance-admin demotion: better-auth's own `adminMiddleware`/`hasPermission` reads `ctx.context.session.user.role` (`better-auth/dist/plugins/admin/routes.mjs:577-581`), which is the cached value. A demoted admin can still call `/admin/impersonate-user` for up to 5 minutes — and an impersonation session it creates lasts a full hour (`impersonationSessionDuration` is not configured, so it defaults to 3600 s, `routes.mjs:596-599`).

TaskDesk already knows about this class of bug — `apps/api/src/auth.ts:381-394` re-reads the role from the database precisely because "a cached session can still say `role: "user"` for up to `cookieCache.maxAge`". That one-off workaround exists for **workspace creation only**; the far more dangerous `/admin/*` surface has no equivalent.

**Fix:** either drop `cookieCache` (the DB read is one indexed lookup) or add `session.cookieCache.version` as a function of a per-user `sessionEpoch` bumped on ban/revoke/role-change — better-auth honours that and expires the cache (`session.mjs:88-98`). At minimum, force `disableCookieCache` on every `/api/auth/admin/*` request.

**Owner:** #7 policy registry. Confirms the known cookieCache item and adds the ban/impersonate consequences.

---

## FINDING A14 — MEDIUM/HIGH — No MFA is possible, while instance admins can silently impersonate any user

**MFA:** the `twoFactor` plugin is not imported and not enabled — the full plugin list is `anonymous, lastLoginMethod, magicLink, emailOTP, organization, genericOAuth, bearer, apiKey, deviceAuthorization, admin, openAPI` (`apps/api/src/auth.ts:273-557`). There is no TOTP, no WebAuthn/passkey, no backup codes, and no configuration surface to add any. `emailOTP` is a *primary* sign-in factor here (`sendVerificationOTP` only handles `type === "sign-in"`, `auth.ts:298-307`), not a second factor. **A single password — 8 characters minimum, no lockout, no rate limit on self-hosted (A3) — is the only thing between the internet and a multi-tenant instance.**

**Impersonation is live.** The admin plugin is enabled (`auth.ts:553-556`) and mounted by the `/auth/*` catch-all (`index.ts:511`), so `POST /api/auth/admin/impersonate-user` is reachable in production. It creates a real session for any target user (`better-auth/dist/plugins/admin/routes.mjs:593-611`). Notes for the issue:
- `allowImpersonatingAdmins` is not set, so admin-on-admin impersonation is blocked (`routes.mjs:586-592`) — correct.
- There is **no audit event**. TaskDesk publishes events elsewhere (`publishEvent` in `auth.ts:455-460`), but nothing hooks `/admin/impersonate-user`. The DB records `session.impersonatedBy`, and the admin plugin then *filters those sessions out* of `/list-sessions` (`admin.mjs:53-65`), so the impersonated user cannot see the session in their own security UI.
- Combined with A10 (account-takeover of an admin via the `custom` OIDC provider) or A8(d) (winning the first-signup race), impersonation is the escalation from "one account" to "every account in every workspace".

**Fix:** enable `twoFactor()` and require it for `role === "admin"`; emit an audit event on impersonate/stop-impersonating and surface impersonated sessions to the impersonated user; set `impersonationSessionDuration` well below the 1-hour default.

**Owner:** NEW ISSUE (MFA is a feature gap, not a removal). Impersonation auditing belongs with #7.

---

## FINDING A15 — MEDIUM — Email addresses are never verified, so `email` is an unverified self-asserted identity product-wide, and any address can be squatted to permanently block its owner's SSO

**Where:** `apps/api/src/auth.ts:248-259` — the `emailAndPassword` block sets only `enabled`, `autoSignIn`, and the hash/verify functions. There is **no `requireEmailVerification`**, and there is **no top-level `emailVerification: { sendVerificationEmail }`** anywhere in the file. The code says so itself at `auth.ts:402-404`: *"TaskDesk does not verify emails on signup."*

**(a) Identity spoofing.** With registration enabled (the default), anyone can `POST /api/auth/sign-up/email` as `ceo@customer-corp.com` and — because `autoSignIn: true` — immediately hold a session under that identity. Every member list, mention, invitation UI, and audit record in a multi-tenant product then displays an address the account never proved control of.

**(b) SSO denial-of-service by squatting.** Because `requireLocalEmailVerified: true` (`auth.ts:245`), an unverified local account **blocks** OAuth linking: `link-account.mjs:23` returns `{ error: "account not linked" }` and `generic-oauth/routes.mjs:289` turns that into `redirectOnError(..., "account_not_linked")`. So an attacker who pre-registers `victim@corp.com` with a password makes the real victim's Google/GitHub/OIDC sign-in fail permanently, with no self-service recovery path.

**(c) A mitigation that is documented as depending on verification, and does not.** `auth.ts:399-407` disables `requireEmailVerificationOnInvitation` with the reasoning *"The invitation link id is the actual secret here."* That reasoning is sound in isolation, but it means the *only* identity proof for joining a workspace is possession of the invitation link — and `checkRegistrationAllowed` will happily create the matching account for whoever holds it (`apps/api/src/utils/check-registration-allowed.ts:42-55` -> `findValidInvitation`, which requires the invitation id **and** the email to match; possession of the link therefore confers the identity).

**Verified NOT vulnerable:** invitation acceptance itself does check recipient identity — `if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) throw FORBIDDEN` (`better-auth/dist/plugins/organization/routes/crud-invites.mjs:268`). An anonymous guest (`temp-*@taskdesk.app`) therefore cannot accept somebody else's invitation. Also, `checkRegistrationAllowed` correctly ANDs the invitation id with the email when both are supplied, so a stolen invitation id cannot be redeemed under a different address.

**Fix:** configure `emailVerification.sendVerificationEmail` (the SMTP transport already exists — `@taskdesk/email` is imported at `auth.ts:2-6`) and set `emailAndPassword.requireEmailVerification: true`, with a documented escape hatch for SMTP-less installs that *also* disables password registration rather than silently accepting unverified identities.

**Owner:** #7 policy registry. NEW ISSUE for the squatting/DoS path specifically.

---

## FINDING A16 — MEDIUM — Weak password policy: 8-character minimum with no complexity or breach check, and the import downgrades better-auth's memory-hard KDF to bcryptjs cost 10

**Where:** `apps/api/src/auth.ts:248-259`
```ts
emailAndPassword: {
  enabled: true,
  autoSignIn: true,
  password: {
    hash: async (password) => await bcrypt.hash(password, 10),
    verify: async ({ hash, password }) => await bcrypt.compare(password, hash),
  },
},
```

- `minPasswordLength` is not set -> **8** (`better-auth/dist/context/create-context.mjs:185`), enforced at `dist/api/routes/sign-up.mjs:152-158`. No complexity rule, no breach-corpus check, no account lockout, and — on self-hosted — no rate limit (A3). Eight characters with unlimited online guessing is not a defensible policy for a multi-tenant instance.
- The custom `password` override replaces better-auth's default, which is **scrypt** via `node:crypto` on the libuv threadpool (`better-auth/dist/crypto/password.mjs:1-9`). `bcryptjs` is a **pure-JavaScript** bcrypt: it is not memory-hard (so offline GPU cracking of a stolen `account` table is far cheaper than against scrypt) *and* it runs on the main event loop rather than the threadpool, so each verification blocks the Node process. With no rate limiting, a flood of `POST /sign-in/email` is a straightforward CPU-starvation DoS on the whole API. Cost 10 is also below current OWASP guidance (>=12) — but raising the cost makes the event-loop blocking worse, which is why the right fix is to drop the override.

This one is inherited verbatim from kaneo and was safe there only because kaneo's cloud front-end rate-limited sign-in.

**Fix:** remove the `password` override (use better-auth's scrypt) or move bcrypt to a worker; set `minPasswordLength: 12`; add lockout/backoff on repeated failures per account, not just per IP (A2 shows per-IP is spoofable anyway).

**Owner:** #7 policy registry.

---

## FINDING A17 — LOW/MEDIUM — `openAPI()` publishes an unauthenticated inventory of every auth endpoint

**Where:** `apps/api/src/auth.ts:557` — `openAPI()` with no options, mounted through the `/auth/*` catch-all.

`better-auth/dist/plugins/open-api/index.mjs:42-59` registers two endpoints with **no session middleware**:
- `GET /api/auth/reference` — a full Scalar HTML API explorer (only suppressed by `disableDefaultReference`, which is not set).
- `GET /api/auth/open-api/generate-schema` — the complete OpenAPI JSON.

On a self-hosted box this hands an unauthenticated scanner the exact enabled-plugin inventory: `/sign-in/anonymous`, `/admin/impersonate-user`, `/device/code`, `/api-key/create`, `/sign-in/oauth2`. It is the reconnaissance step for A8, A11 and A12, and it is how an attacker distinguishes a hardened instance from a default one.

**Fix:** `openAPI({ disableDefaultReference: true })` in production, or gate both routes on `isCloud()`/an admin session.

**Owner:** #6 removals.

---

## FINDING A18 — MEDIUM — The MCP OAuth flow mints 30-day session rows directly, bypassing better-auth's session-creation hooks, and those tokens are full API sessions

**Where:** `apps/api/src/mcp/oauth.ts:108-133`
```ts
const sessionToken = randomUUID();
const expiresIn = 30 * 24 * 60 * 60;
await db.insert(sessionTable).values({ id: createId(), token: sessionToken, userId: stored.userId, expiresAt: new Date(Date.now() + expiresIn * 1000), ... });
return { accessToken: sessionToken, expiresIn };
```

Three problems, all in scope for session configuration:

1. **It bypasses `databaseHooks.session.create.before`.** Writing the row with Drizzle means the admin plugin's banned-user check (`better-auth/dist/plugins/admin/admin.mjs:32-49`) never runs — a banned user who still holds an MCP authorization code gets a valid session — and TaskDesk's own `hooks.after` that populates `activeOrganizationId` (`apps/api/src/auth.ts:779-798`) never runs either.
2. **30 days vs the 7-day default.** `session.expiresIn` is not configured in `auth.ts`, so ordinary sessions last 7 days (`create-context.mjs:147`). MCP sessions last four times longer, decided in a different file, with no corresponding config knob or documentation.
3. **The "MCP access token" is an unscoped session token for the entire product.** Because `bearer()` is enabled without `requireSignature` (`auth.ts:535`), the raw `session.token` is accepted as `Authorization: Bearer` on **every** route — `validateBearerToken` in `apps/api/src/mcp/index.ts:56-71` just calls `auth.api.getSession` with that header. So a token the user granted to an MCP client (through a dynamically-registered, unvetted OAuth client — `POST /api/mcp/register`, `apps/api/src/mcp/index.ts:78-86,166-168`) is equally valid for the full REST API. The consent screen's scope is fictional.

**Fix:** mint MCP tokens through `auth.api` (or `internalAdapter.createSession`) so the hooks run; give them their own short lifetime; and mark them so `authenticateApiRequest` can restrict them to `/api/mcp/*`.

**Owner:** NEW ISSUE (overlaps the MCP reviewer's lens — flagged here because it is session minting).

---

## FINDING A19 — LOW — `COOKIE_DOMAIN` is applied unvalidated, widening the session cookie to every sibling subdomain

**Where:** `apps/api/src/auth.ts:804-808` -> `apps/api/src/utils/get-default-cookie-attributes.ts:34-40`
```ts
return { sameSite: ..., secure: isHttps, partitioned: ..., domain: cookieDomain || undefined };
```
Nothing checks that `COOKIE_DOMAIN` is a suffix of the API host. An operator setting `COOKIE_DOMAIN=example.com` to share the session with a marketing site scopes the session cookie to **every** subdomain, so any subdomain takeover, any legacy app, or any third-party-hosted `*.example.com` CNAME receives the session cookie on every request. Browsers reject public suffixes, so the blast radius is bounded to the operator's own domain — hence LOW — but the setting deserves a validation check and a warning in the config reference.

**Fix:** validate that `cookieDomain` is `apiHost` or a dot-prefixed suffix of it, and refuse (or warn loudly) otherwise.

**Owner:** #11 deployment.

---

## Items reviewed and found NOT to be defects (stated so they are not re-litigated)

- **`trustedOrigins`** (`apps/api/src/auth.ts:85-91`) — built from `TASKDESK_AGENT_URL` plus the API's own origin, with no wildcard and no request-derived entries. `matchesOriginPattern` is the standard better-auth check. Sound as written; its only weakness is the `apiUrl` default (A7).
- **`accountLinking.allowDifferentEmails`** — not set, so it defaults to false; the explicit `/link-social` path enforces `link.email === userInfo.email` (`better-auth/dist/plugins/generic-oauth/routes.mjs:238`). The A10 takeover works *with* matching emails, not around this check.
- **`POST /api-key/create` privilege escalation** — correctly blocked: client requests may not supply `userId`, `permissions`, `remaining`, `rateLimit*` or `refill*` (`@better-auth/api-key/dist/index.mjs:734-737`). A user cannot mint a key for another user or widen a key's scope.
- **`sensitiveSessionMiddleware` and API keys** — `getAuthoritativeSessionFromCtx` nulls `ctx.context.session` before re-reading (`better-auth/dist/api/routes/session.mjs:312-316`), so `/delete-user`, `/change-password`, `/change-email`, `/update-user` are genuinely **not** reachable with an `x-api-key` session. A11 is scoped to the routes that use plain `sessionMiddleware`/`getSessionFromCtx`.
- **Cookie-cache self-renewal** — `refreshCache` is not set, so `cookieRefreshCache === false` (`better-auth/dist/context/create-context.mjs:149-165`). The 5-minute window in A13 is bounded and does **not** extend itself indefinitely.
- **Invitation acceptance by a guest or a wrong recipient** — blocked by the recipient-email check (`better-auth/dist/plugins/organization/routes/crud-invites.mjs:268`), and `checkRegistrationAllowed` ANDs invitation id with email (`apps/api/src/utils/check-registration-allowed.ts:64-78`). `requireEmailVerificationOnInvitation: false` is therefore a reasoned trade-off, not a hole on its own.
- **First-user admin promotion race** — genuinely fixed: the count-and-promote runs in one transaction under `pg_advisory_xact_lock(2026)` (`apps/api/src/auth.ts:657-666`). The defect in A8(c) is the *counting of anonymous users*, not the concurrency.
- **`normalizeInvitationId`** (`apps/api/src/auth.ts:70-75`) — `^[a-z0-9_-]{1,128}$` before the value ever reaches a query. Correct.
- **`TASKDESK_AUTH_SECRET` length check** — the `< 32` branch does work when the variable is set (`auth.ts:104-111`); the defect (A1) is only the missing/empty case.

---

## FINDING A20 — LOW — `GET /api/config` is a public, complete fingerprint of the instance's auth posture

**Where:** `apps/api/src/config/index.ts:7-23` (`security: []`, mounted before `authenticateApiRequest`) -> `apps/api/src/utils/get-settings.ts:8-33`.

One unauthenticated request returns `disableRegistration`, `disablePasswordRegistration`, `disableEmailOtpSignIn`, `disableWorkspaceCreation`, `disableLoginForm`, `hasSmtp`, `hasGithubSignIn`, `hasGoogleSignIn`, `hasDiscordSignIn`, **`hasCustomOAuth`**, **`hasGuestAccess`**, `customOAuthAutoLogin`, `customOAuthLogoutUrl`, `billingEnabled`.

Most of this is legitimately needed to render the login screen. The security consequence is that it makes every finding above **scannable**: `hasGuestAccess: true` says A8 applies, `hasCustomOAuth: true` says A10 applies, `disableRegistration: false` says A9 applies — and `GET /api/instance/status` (A8d) then says whether the instance is still unclaimed. An attacker enumerating TaskDesk instances can pick exactly the exploitable ones without sending a single suspicious request.

**Fix:** not to hide it — the login screen needs it — but to make the underlying defaults safe so the fingerprint stops being actionable (guest access off by default, `custom` untrusted for linking). Optionally drop `customOAuthLogoutUrl` and `hasSmtp` from the unauthenticated payload.

**Owner:** #7 policy registry (as context, not as its own fix).

---

## Note on `apps/api/src/auth-openapi.ts` (reviewed in full)

The file is **documentation only** — 1175 lines of `registry.registerPath(...)` calls for the 30 `/auth/organization/*` operations, registered against the OpenAPI registry because "Better Auth serves `/api/auth/*` from its own handler, so these operations have no route of ours to hang documentation off" (`auth-openapi.ts:4-12`). It creates no handlers and enforces nothing. It contains **zero** `security:` keys (verified by grep), so it neither weakens nor strengthens any route.

One observation worth carrying into the issue: it documents **only** the organization surface. The published API spec therefore shows 30 organization endpoints, while the actual mounted surface at `/api/auth/*` (`apps/api/src/index.ts:511`, `app.route("/api", api)` at `:745`, `basePath: "/api/auth"` at `auth.ts:203`) additionally includes every route from `anonymous`, `magicLink`, `emailOTP`, `genericOAuth`, `bearer`, `apiKey`, `deviceAuthorization`, `admin` and `openAPI`. The spec understates the attack surface by roughly 40 endpoints — including `/admin/impersonate-user`, `/sign-in/anonymous`, `/device/*` and `/api-key/*` — while `GET /api/auth/reference` (A17) hands the complete list to anyone who asks. Any route-inventory or contract test built from this file will have a blind spot exactly where the dangerous endpoints are.

---

## Summary table

| # | Sev | Title | Anchor | Owner |
|---|-----|-------|--------|-------|
| A1 | CRITICAL | Auth secret falls back to better-auth's public default when `NODE_ENV != production` | `apps/api/src/auth.ts:104-111,202` | NEW ISSUE (+#11) |
| A5 | CRITICAL | Helm chart ships `authSecret: ""` and no `NODE_ENV` -> A1 is the K8s default | `charts/taskdesk/values.yaml:94`, `templates/deployment.yaml:51-96` | #11 + #10 |
| A6 | CRITICAL | Chart defaults -> credentialed CORS reflection of any origin; `bearer()` exposes the session token to it | `apps/api/src/index.ts:156-191`, `auth.ts:535` | #10/#11 + #6 |
| A2 | HIGH | Client identity for rate limiting and IP audit is the unverified `cf-connecting-ip` header | `apps/api/src/auth.ts:800-803` | #7 + #11 |
| A3 | HIGH | `rateLimit.enabled: isCloud()` kills global **and** plugin rules; no other limiter exists | `apps/api/src/auth.ts:565-575` | #8/#7 (known) |
| A4 | HIGH | Rate-limit state is per-process memory with a floodable 100k cap | `apps/api/src/auth.ts:565-575` | #8 |
| A7 | HIGH | `KANEO_API_URL` set by nothing -> session cookie issued without `Secure` on HTTPS | `apps/api/src/auth.ts:82`, `utils/get-default-cookie-attributes.ts:19,37` | #11 |
| A8 | HIGH | `/sign-in/anonymous` bypasses `DISABLE_REGISTRATION`; one call permanently kills the admin bootstrap | `apps/api/src/auth.ts:274-283,584-589,623-666` | #6/#7 (known) |
| A9 | HIGH | `DISABLE_LOGIN_FORM` misses `/sign-up/email`; `autoSignIn` mints a session | `apps/api/src/utils/is-local-sign-in-path.ts:1-9`, `auth.ts:248-253` | #7 |
| A10 | HIGH | `"custom"` in `trustedProviders` -> OIDC-to-local account takeover; magic-link/OTP make almost everyone "verified" | `apps/api/src/auth.ts:233-246` | #7 (known, sharpened) |
| A11 | HIGH | API key = always-fresh full session on `/api/auth/*`, escaping TaskDesk's own key scoping | `apps/api/src/auth.ts:536-546`, `index.ts:511,552` | #6 (known, sharpened) |
| A12 | HIGH | Device flow launders an API key into a fresh session token; `/device/code` takes an unauthenticated `user_id` | `apps/api/src/auth.ts:547-552`, `index.ts:473-508` | #6 / NEW |
| A13 | MEDIUM | 5-minute revocation/ban/role-change window, unbounded for `/admin/*` | `apps/api/src/auth.ts:556-561` | #7 (known) |
| A14 | MED/HIGH | No MFA is possible; impersonation live and unaudited | `apps/api/src/auth.ts:273-557` | NEW ISSUE |
| A15 | MEDIUM | No email verification -> unverified identity product-wide + SSO squatting DoS | `apps/api/src/auth.ts:248-259,402-404` | #7 / NEW |
| A16 | MEDIUM | 8-char passwords, no lockout; scrypt downgraded to event-loop-blocking bcryptjs cost 10 | `apps/api/src/auth.ts:248-259` | #7 |
| A17 | LOW/MED | `openAPI()` publishes an unauthenticated inventory of every auth endpoint | `apps/api/src/auth.ts:557` | #6 |
| A18 | MEDIUM | MCP OAuth mints 30-day session rows directly, skipping session-creation hooks | `apps/api/src/mcp/oauth.ts:108-133` | NEW ISSUE |
| A19 | LOW | `COOKIE_DOMAIN` applied unvalidated | `apps/api/src/auth.ts:804-808` | #11 |
| A20 | LOW | `GET /api/config` publicly fingerprints the auth posture | `apps/api/src/config/index.ts:7-23` | #7 (context) |

**Chains worth calling out in the issues:**
- A5 -> A1: the documented `helm install` produces a forgeable-session instance.
- A5 -> A6 -> `bearer()`: same defaults also give any website a readable session token.
- A20 + A8(d): unauthenticated fingerprinting tells an attacker which instances are exploitable and which are unclaimed.
- A10 -> A14: takeover of an instance admin via the `custom` provider, then impersonate everyone.
- A11 -> A12: a scoped API key becomes an unscoped session token that outlives the key's revocation.
- A3 + A2 + A4: rate limiting is off by default, and where it is on it is keyed on a spoofable header in a floodable per-replica map.
