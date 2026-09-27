# Security review — PR #396, empty `VITE_API_URL` resolves to same-origin

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5[1m]`; independent context; did not author, direct or remediate this change)
**Date:** 2026-09-27
**Branch:** `fix/vite-api-url-same-origin`

**Reviewed head:** `a8b24c6e025f5e2dba747492d2dbfa4231cdc262`

**Verdict:** CLEAR WITH FINDINGS. All three findings are informational. None blocks the merge.

**Scope:** `apps/web/src/lib/auth-client.ts`. This is the better-auth client base URL, which is auth and therefore in security-review scope under `ci-cd.md`. Also covered, because they decide where the same requests go: `packages/libs/src/api-url.ts`, `apps/web/src/fetchers/get-api-url.ts`, and the `Dockerfile` build-stage `ARG`/`ENV`. The two test files were read and run. Beyond that they are ordinary-review scope.

## What was checked

1. **Only the image builder controls `VITE_API_URL`. No runtime or visitor input reaches it.**
   - It is read in only three places, all through `import.meta.env.VITE_API_URL`: `auth-client.ts:18`, `get-api-url.ts:6` and `packages/libs/src/hono.ts:7`. Vite replaces it with a constant at build time.
   - I rebuilt the web bundle from this head with `VITE_API_URL=""` (Vite 8.2.1). The output contains literal empty strings:
     - `get-api-url` compiles to `` ``.replace(/\/+$/,``) ``;
     - the auth client is created with `new URL(``)` … `` ``.split(`/`) ``;
     - the Hono client is created with `` e(``) ``.
     `http://localhost:1337` is left only as the unreachable right-hand side of `??` in the shared resolver, and in source maps. The runtime image strips the source maps.
   - `deploy/entrypoint.sh` does not substitute anything into `public/`. `Dockerfile.kaneo`'s `env.sh` runtime rewrite is not carried over.
   - The `ENV VITE_API_URL` line is in the `build` stage only. `proddeps` starts `FROM base` and `runtime` starts `FROM ${NODE_IMAGE}`, so the variable is not in the runtime image's environment. Changing it would have no effect there anyway, because the value is already inlined.
   - `.github/workflows/release.yml` does not pass a `VITE_API_URL` build-arg, so release images get the default `""`.
   - Vite's `loadEnv` keeps an empty `process.env` value: `process.env` is applied last and is not filtered for empty strings. Turbo's Vite framework inference lets `VITE_*` through to the task. The rebuilt bundle shows both of these directly.

2. **With `baseURL: ""`, better-auth's client sends auth traffic to the current origin (better-auth 1.6.30, read from `node_modules`).**
   - `auth-client.ts`: `new URL("")` throws. The `catch` returns `"".split("/").slice(0, 3).join("/")`, which is `""`.
   - `better-auth/dist/utils/url.mjs` `getBaseURL`: `if (url)` is false for `""`. It then checks the `BETTER_AUTH_URL`-family env keys and `BASE_URL`, skips the request branches because the client passes no request, and returns `withPath(window.location.origin, "/api/auth")`.
   - `withPath` → `assertHasProtocol` accepts only `http:` or `https:`. `window.location.origin` is always an absolute scheme://host[:port]. That rules out a protocol-relative (`//host`) URL or a scheme-less one.
   - `client/config.mjs` computes `baseURL` once, when `createAuthClient` runs. `$fetch` uses `credentials: "include"`, but the target is the page's own origin, so cookies go only to the host that served the bundle. Before this change they went to the visitor's own `localhost:1337`.
   - The server decides trust on its own, and this PR changes none of it: `apps/api/src/auth.ts` `trustedOrigins` and the `cookieDomain`/`COOKIE_DOMAIN` cookie attributes. A client `baseURL` cannot widen what the server accepts.

3. **Developer (`vite dev`) and production paths.** With the variable unset, `?? "http://localhost:1337"` gives the same value as the old `||`. So nothing changes for development, for Playwright (`apps/web/playwright.config.ts` sets `VITE_API_URL` explicitly), or for any deployment that sets a real URL. The only change is `""`, which used to fall back to the development URL and now stays relative. No development-only assumption can reach production through this change. It removes the one that did.

4. **Dockerfile.**
   - `ARG VITE_API_URL=""` can be overridden only by whoever runs `docker build --build-arg`. That is the same trust level as editing the source.
   - It is not a secret. It lives in a build stage, not in the final image's config or history.
   - Changing the arg invalidates the `RUN pnpm turbo build` layer cache, so a cached layer cannot serve a bundle built with an old value.
   - `.turbo` is excluded by `.dockerignore`, so no Turbo cache from the host can be reused.
   - No new dependency. No change to the lockfile or manifests.

5. **Tests at this head (Node 24.20.0):**
   - `apps/web`: `get-api-url.test.ts`, `use-project-websocket.test.ts` and `resolve-avatar-src.test.ts` ran 3 files and 10 tests. All pass.
   - `packages/libs`: `api-url.test.ts` ran 1 file and 4 tests. All pass.
   - Both new empty-string cases are among these, along with the case where the variable is unset and the dev default is used.
   - GitHub checks at this head are green, except `pull request template + security review`, which is waiting for this note.

## Findings (informational, not blocking)

**F1 — The same-origin path depends on better-auth's fallback order.** Passing `""` means better-auth first checks `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`, `PUBLIC_BETTER_AUTH_URL`, `NUXT_PUBLIC_*` and `BASE_URL` before it uses `window.location.origin`. Outside a bundler, `@better-auth/core/env`'s shim falls back to `globalThis`. In a browser that would make those names readable as window properties, which a DOM element's `id` can clobber.

This is not reachable in this build, for two reasons:
- In the production bundle, Vite's define compiles that shim to `T=e=>({})`, so no `window` lookup is left.
- `main.tsx` imports `AuthProvider` → `authClient` statically. The client is therefore created before React renders anything, when the DOM is only the static `index.html`.

Optional hardening for a later change: return `window.location.origin` explicitly from `getBaseURL()` when the value is `""`. The client would then not depend on better-auth's fallback order at all.

**F2 — The relative WebSocket URL needs a recent browser.** `getWsUrl` now produces `/api/ws/<id>?windowId=…`.
- Browsers that implement the 2023 WHATWG change (Chrome/Edge 125+, Firefox 124+, Safari 17.3+) resolve it against the page and map `https:` → `wss:`. Credentials therefore stay same-origin and use TLS.
- Older browsers throw a `SyntaxError` and realtime stops working. They do not connect anywhere else.

This is a compatibility point, not a security one.

**F3 — Pre-existing and out of scope: the same "bundled image" gap exists for `VITE_CLIENT_URL`.** `apps/web/src/routes/auth/sign-in.tsx:60–138` builds the OAuth `callbackURL`/`errorCallbackURL` as `` `${import.meta.env.VITE_CLIENT_URL}/…` ``. The Dockerfile does not set that variable, so in the image these become `"undefined/dashboard"` and similar values. The server's callback-URL validation is the control, and this PR does not touch this code. It will probably break SSO sign-in in the bundled image and needs its own fix and its own Opus pass. Separately, `scripts/ci/env-baseline.json`'s `VITE_API_URL` entry points at `apps/web/src/fetchers/instance/get-instance-status.ts:9`, which no longer exists. That baseline drift is also pre-existing.

## Delta rule

Any later commit on this branch that touches non-note paths needs a delta confirmation and a new `**Reviewed head:**` line. That includes a `main` merge, a rebase or a conflict resolution. The attestation above covers `a8b24c6e025f5e2dba747492d2dbfa4231cdc262` only.
