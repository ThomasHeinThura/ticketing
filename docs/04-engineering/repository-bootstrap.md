# Repository bootstrap — from kaneo to a green, empty TaskDesk

The most-used document of the project's first fortnight: exactly how `../kaneo` becomes
`Ticketing.v2` with CI green on the inherited kaneo surface, every route carrying a policy — no features written yet, but not an empty application either. This is P0 step 1 made concrete
([phases.md](../07-planning/phases.md)). Written 2026-09-05.

**Local prerequisites:** Node 24 via a version manager (`fnm`, `nvm` or `mise` — kaneo's
root `package.json` `engines` says `>=24.0.0`; a bare system Node of another major is the
first thing that goes wrong), pnpm 10.32.1 via `corepack enable`, and Docker (Compose v2)
for the integration tests and the local stack.

## 0. Before copying anything

1. **Choose and record the snapshot commit.** The default is a CI-green upstream `main`
   SHA — proposed today: `42bb801114aa1ae499228a53180f0cdbc5607964` (upstream CI run
   33957941564, green). **Never the `v2.22.0` tag**: it predates the authorization fixes
   `6de9ea05`, `6bfe74de` and `a581bdd2`, and kaneo is taken once and never merged again
   ([ADR 0001](../01-architecture/adr/0001-kaneo-as-foundation.md)), so a tag chosen for
   tidiness carries known-fixed authorization bugs in permanently. Procedure:

   ```bash
   git -C ../kaneo fetch origin main       # the local clone is behind; fetch first
   git -C ../kaneo log --oneline origin/main -1
   ```

   Confirm the run for that SHA is green in kaneo's Actions before proposing it. **Thomas
   confirms the exact SHA explicitly before any source is copied.** Record in both
   [inherited-features.md](../01-architecture/inherited-features.md) and
   `THIRD-PARTY-NOTICES.md`: the full SHA; "main commit, not a tag"; the date; the upstream
   CI run id and result; the reason ("post-tag authorization fixes included"); and the
   verification steps of item 2.
2. **Run kaneo's own suite on that SHA, before the fork commit** — `lint`, `typecheck`,
   `test` (unit), `build`, `test:integration` and `i18n:check` — and record the pass / fail
   / skip counts. That is the **attribution baseline**: the number the P0 exit criterion is
   measured against, and the only honest way to say later whether a red test is ours or
   inherited. Run the integration suite on **Postgres 18** (TaskDesk's target) and note in
   the record that kaneo's own CI validates on Postgres 16, so any difference is new
   information, not a regression we caused.
3. Audit the snapshot as a supply-chain input: `pnpm audit` in `../kaneo`, Trivy on
   `Dockerfile.kaneo`'s build; fix or note every high/critical **before** the fork commit
   ([security-model.md](../01-architecture/security-model.md)).
4. Confirm kaneo's licence file is MIT and copy it into `THIRD-PARTY-NOTICES.md` verbatim,
   holder line included ("Copyright (c) 2024 Andrej Acevski").

## 1. What is copied, what is not

Exhaustive over the snapshot's tree. **If an entry is not in this table, it is not copied** —
there is no `cp -r` of anything unlisted, and a new upstream entry that appears between this
writing and the fork gets a verdict here before it travels.

### Root entries

| Entry | Verdict | Note |
| --- | --- | --- |
| `.agents/` | Do not copy | kaneo's agent instructions |
| `.claude/` | Do not copy | kaneo's agent instructions |
| `.coderabbit.yaml` | Do not copy | kaneo's review bot config |
| `.cursor/` | Do not copy | kaneo's agent instructions |
| `.devcontainer/` | Do not copy | ours if we want one |
| `.dockerignore` | Copy then rewrite | one image ([container-image.md](../05-operations/container-image.md)) |
| `.env.sample` | Do not copy | `deploy/.env.example` is written fresh — see §2 |
| `.gitattributes` | Copy | line endings, lockfile diff rules |
| `.github/` | Do not copy | see the .github table below — ours are written fresh |
| `.gitignore` | Copy | |
| `.husky/` | Copy | commitlint + semantic-release are kept (decision log, 2026-09-06) |
| `.npmrc` | Copy | pnpm settings the lockfile assumes |
| `.vscode/` | Do not copy | editor-local |
| `AGENTS.md` | Do not copy | TaskDesk's is authored fresh ([phases.md](../07-planning/phases.md) P0). kaneo's may be **read once** for its architecture section; it is also internally stale (says Node 20.19 while `engines` says `>=24`) |
| `CHANGELOG.md` | Do not copy | 180 KB of someone else's history |
| `CLAUDE.md` | Do not copy | five-line pointer to kaneo's `AGENTS.md` |
| `CODE_OF_CONDUCT.md` | Do not copy | ours |
| `CONTRIBUTING.md` | Do not copy | ours |
| `CONTRIBUTORS.svg` | Do not copy | kaneo's contributors |
| `Dockerfile.kaneo` | Copy then rewrite | becomes the single root `Dockerfile` per [container-image.md](../05-operations/container-image.md); copied only as the starting point |
| `ENVIRONMENT_SETUP.md` | Do not copy | superseded by [configuration-reference.md](../05-operations/configuration-reference.md) |
| `LICENSE` | Copy → `THIRD-PARTY-NOTICES.md` | verbatim, holder line included; TaskDesk's own `LICENSE` is separate ([licensing](../00-overview/licensing-and-attribution.md)) |
| `README.md` | Do not copy | ours |
| `SECURITY.md` | Do not copy | ours |
| `apps/` | See the apps table | |
| `biome.json` | Copy | |
| `charts/kaneo` | Copy → `charts/taskdesk`, rewritten | per [kubernetes.md](../05-operations/kubernetes.md) |
| `commitlint.config.js` | Copy | semantic-release/commitlint/husky kept |
| `compose.coolify.yml` | Do not copy | |
| `compose.local.yml` | Do not copy | our compose stack is written fresh ([deployment.md](../05-operations/deployment.md)) |
| `compose.yml` | Do not copy | as above |
| `deploy/kaneo-entrypoint.sh` | Do not copy | replaced; `deploy/.env.example` and `scripts/deploy.sh` are **ours, written fresh** — neither exists upstream |
| `i18n/` | Copy, stays at the root | locale JSONs + `resources.ts` + `schema.json`; the root location is the decision ([i18n.md](../01-architecture/i18n.md)) |
| `package.json` | Copy then rewrite | name, scripts, `engines`/`packageManager` kept; `test:all` added (§7) |
| `packages/` | See the packages table | |
| `plans/` | Copy → `docs/02-design/motion/` | motion specs |
| `pnpm-lock.yaml` | Copy | keeps the audited dependency graph; regenerated only after the removals |
| `pnpm-workspace.yaml` | Copy | |
| `release.config.js` | Copy | semantic-release kept |
| `scripts/i18n/` | Copy | `check/report/schema/shared.mjs` — the root `i18n:check` scripts and the CI i18n job call them |
| `scripts/release/` | Do not copy | kaneo's release plumbing |
| `scripts/provision-sentry-alerts.sh`, `scripts/provision-sentry-dashboards.sh` | Do not copy | Sentry is removed |
| `sentry/` | Do not copy | kaneo's DSN, alerts and dashboards |
| `skills/improve-animations`, `skills/find-animation-opportunities` | Copy | |
| `skills/` — the other eight (`animate`, `animation-vocabulary`, `apple-design`, `coss`, `emil-design-eng`, `pick-ui-library`, `prototype`, `review-animations`) | Do not copy | `pick-ui-library`, `animation-vocabulary` and `review-animations` may be **read once** as references; nothing is committed |
| `skills-lock.json` | Do not copy | pins kaneo's ten-skill set; stale the moment eight are dropped |
| `tests/` | Copy then delete parts | see the deletion list below |
| `turbo.json` | Copy | task graph the scripts assume |

### Apps

| Entry | Verdict | Note |
| --- | --- | --- |
| `apps/api` | Copy, then strip per §3 | |
| `apps/api/auth-schema.ts` | Copy | better-auth's generated schema; regenerated after the plugin removals |
| `apps/api/drizzle/` | Copy | the 45 inherited migrations and `meta/_journal.json`, exactly as taken ([migrations.md](migrations.md)) |
| `apps/api/.env.test.example`, `apps/api/drizzle.config.ts`, `apps/api/scripts/`, `apps/api/vitest*.config.ts`, `apps/api/tsconfig.json` | Copy | |
| `apps/api/Dockerfile`, `apps/api/.dockerignore` | Do not copy | one image, not three |
| `apps/docs` | Do not copy | kaneo's Mintlify docs; TaskDesk's docs site is an open decision ([08-docs-site/plan.md](../08-docs-site/plan.md)) |
| `apps/site` | Do not copy | a Next 16 **marketing** site, not a docs framework — see the same open decision |
| `apps/web` | Copy, then strip per §3 | |
| `apps/web/components.json` | Copy | shadcn generator config |
| `apps/web/Dockerfile`, `apps/web/.dockerignore`, `apps/web/nginx.conf`, `apps/web/nginx.kaneo.conf`, `apps/web/env.sh`, `apps/web/.env.development`, `apps/web/.env.production` | Do not copy | the web bundle is served from the single image and learns its API origin from the page origin |

### Packages

| Entry | Verdict | Note |
| --- | --- | --- |
| `packages/email` | Copy | |
| `packages/libs` | Copy | |
| `packages/mcp` | Copy | drop the `publish-mcp` workflow, any `publishConfig` and the npm package name |
| `packages/permissions` | Copy, then **replaced** | keep the four role names for data continuity; the capability / policy / evaluator layer is written fresh (§4) |
| `packages/planka-import` | Do not copy | |
| `packages/typescript-config` | Copy | |

### `.github`

Nothing under `.github/` travels. Ours are written fresh for [ci-cd.md](ci-cd.md):
`FUNDING.yml`, `dependabot.yml`, `ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md` (ours lands
as `.github/pull_request_template.md`), and all fifteen workflows — `auto-assign`,
`auto-merge`, `build-images`, `ci`, `deploy-site`, `docker`, `helm-chart`,
`helm-validate`, `issue-notify`, `nightly`, `publish-mcp`, `publish-planka-import`,
`release-notify`, `release`, `update-contributors`. kaneo's `ci.yml` may be read once for
its job list (lint, i18n, typecheck, unit, build, integration on `postgres:16`,
docker-build), which is the shape ours starts from.

### `tests/` — copied, minus what the removals delete

`tests/api` and `tests/api-integration` come across whole, and in the **same commit** as the
code removals in §3 these are deleted, or the unit and typecheck jobs are red on day one:

- `tests/api/billing/`, `tests/api/github-integration/`, `tests/api/gitea-integration/`,
  everything under `tests/api/plugins/`, and the four root `mcp-*.test.ts` files that cover
  the removed `mcp`/`oauth` routers.
- `tests/api-integration/billing-*.test.ts` (seven files), `trial-reminders.test.ts`,
  `device-authorization.test.ts`, `mcp-oauth-shared-state.test.ts`,
  `mcp-oauth-store.test.ts`.

Everything else — `column`, `database`, `events`, `label`, `redis`, `scheduler`, `search`,
`storage`, `time-entry`, `user`, `utils`, `ws`, and the surviving integration suites
(`authorization-boundaries`, `workspace-rbac`, `session-*`, `project*`, `task*`, `comment`,
`config`, `cors`, `health`, `label*`, `leader-lock`, `openapi`, `registration-invitation`,
`account-deletion`, `external-link-secrets`) — is inherited and kept, and is part of the
baseline recorded in §0 item 2.

Order of operations: **packages before apps** — `packages/*` must compile before
`apps/api` and `apps/web` can.

## 2. De-brand

A scripted sweep, committed as one change so it is reviewable:

- Package names `@kaneo/*` → `@taskdesk/*` across every `package.json` and import.
- Strings: `kaneo`/`Kaneo` in `i18n/*.json` (product name only — not third-party names),
  page titles, email templates, `README.md`, **the `emailDomainName: "kaneo.app"` literal in
  `apps/api/src/auth.ts`** (which leaves with the anonymous plugin anyway, §3) and the copied
  `apps/web/.env.*` files (which are not copied — listed here so the sweep's grep does not
  report a false miss).
- Assets: logos, favicon, OG images → placeholders until branding lands in God Mode.
- References: GHCR image names, Docker Hub links, the Sentry DSN, Coolify labels, the
  `packageManager` and `engines` fields stay.
- Keep every kaneo copyright header on files taken verbatim
  ([licensing](../00-overview/licensing-and-attribution.md)).

### The environment migration table

This is the largest single body of §2 work and the reason the "five required variables"
rule is a **migration**, not a rename. Every variable `apps/api/src` and the web bundle read
at the snapshot, with its verdict: **rename** to a `TASKDESK_*` bootstrap variable, **move**
into God Mode (a plugin config row or an instance setting), **delete** with its feature, or
**keep** because it is an operating-system variable and not configuration at all.

| kaneo variable | Verdict | Becomes / why |
| --- | --- | --- |
| `AUTH_SECRET` | Rename | `TASKDESK_AUTH_SECRET` |
| `DATABASE_URL` | Rename | `TASKDESK_DATABASE_URL` |
| `KANEO_CLIENT_URL` | Rename | `TASKDESK_AGENT_URL` |
| `REDIS_URL` | Rename | `TASKDESK_VALKEY_URL` |
| `TRUSTED_PROXIES` | Rename | `TASKDESK_TRUST_PROXY` — a **hop count**, not a list |
| `NODE_ENV` | Keep | standard Node variable |
| — | New | `TASKDESK_ENCRYPTION_KEY` (plugin-secret encryption) |
| — | New | `TASKDESK_PORTAL_URL` (the second origin) |
| `SMTP_HOST` | Move | `notify.email` plugin config |
| `SMTP_PORT` | Move | `notify.email` |
| `SMTP_SECURE` | Move | `notify.email` |
| `SMTP_USER` | Move | `notify.email` |
| `SMTP_PASSWORD` | Move | `notify.email` (encrypted) |
| `SMTP_REQUIRE_TLS` | Move | `notify.email` |
| `SMTP_FROM` | Move | `notify.email` |
| `S3_FORCE_PATH_STYLE` | Move | `storage.s3` plugin config |
| `S3_PRESIGN_TTL_SECONDS` | Move | `storage.s3` |
| `S3_MAX_IMAGE_UPLOAD_BYTES` | Move | `storage.s3` |
| `SENTRY_DSN` | Move (optional) | Observability settings; off unless configured |
| `SENTRY_ENVIRONMENT` | Move (optional) | Observability |
| `SENTRY_RELEASE` | Move (optional) | Observability |
| `SENTRY_TRACES_SAMPLE_RATE` | Move (optional) | Observability |
| `SENTRY_PROFILES_SAMPLE_RATE` | Move (optional) | Observability |
| `CUSTOM_OAUTH_DISCOVERY_URL` | Move | an `identity_connection` row |
| `CUSTOM_OAUTH_AUTHORIZATION_URL` | Move | `identity_connection` |
| `CUSTOM_OAUTH_TOKEN_URL` | Move | `identity_connection` |
| `CUSTOM_OAUTH_USER_INFO_URL` | Move | `identity_connection` |
| `CUSTOM_OAUTH_LOGOUT_URL` | Move | `identity_connection` |
| `CUSTOM_OAUTH_CLIENT_ID` | Move | `identity_connection` |
| `CUSTOM_OAUTH_CLIENT_SECRET` | Move | `identity_connection` (encrypted) |
| `CUSTOM_OAUTH_SCOPES` | Move | `identity_connection` |
| `CUSTOM_OAUTH_RESPONSE_TYPE` | Move | `identity_connection` |
| `CUSTOM_OAUTH_AUTO_LOGIN` | Move | `identity_connection` (home-realm discovery) |
| `CUSTOM_AUTH_PKCE` | Move | `identity_connection` |
| `DISABLE_REGISTRATION` | Move | instance setting |
| `DISABLE_PASSWORD_REGISTRATION` | Move | auth plugin config |
| `DISABLE_LOGIN_FORM` | Move | auth plugin config |
| `DISABLE_EMAIL_OTP_SIGN_IN` | Move | auth plugin config |
| `DISABLE_WORKSPACE_CREATION` | Move | instance setting |
| `KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` | Move | the egress allowlist, **default empty** ([webhooks-and-api-keys.md](../03-features/webhooks-and-api-keys.md)) |
| `DISABLE_GUEST_ACCESS` | Delete | with the anonymous plugin (§3 item 1) |
| `DEMO_MODE` | Delete | with guest access; also removes `hasGuestAccess`/`isDemoMode` from the client settings payload |
| `DEVICE_AUTH_CLIENT_IDS` | Delete | with `deviceAuthorization()` |
| `COOKIE_DOMAIN` | Delete | `__Host-` cookies per portal; the cross-subdomain branch goes with it |
| `CORS_ORIGINS` | Delete | derived from `TASKDESK_AGENT_URL` and `TASKDESK_PORTAL_URL` |
| `KANEO_API_URL` | Delete | API and web are one origin |
| `KANEO_INTERNAL_API_URL` | Delete | as above |
| `KANEO_API_KEY` | Delete | MCP client-side only |
| `KANEO_MCP_CLIENT_ID` | Delete | MCP client-side only |
| `KANEO_CLOUD` | Delete | hosted-tier flag |
| `GITHUB_APP_ID` | Delete | with the GitHub integration |
| `GITHUB_APP_NAME` | Delete | GitHub integration |
| `GITHUB_CLIENT_ID` | Delete | GitHub integration |
| `GITHUB_CLIENT_SECRET` | Delete | GitHub integration |
| `GITHUB_PRIVATE_KEY` | Delete | GitHub integration |
| `GITHUB_PRIVATE_KEY_BASE64` | Delete | GitHub integration |
| `GITHUB_WEBHOOK_SECRET` | Delete | GitHub integration |
| `GITHUB_OAUTH_CLIENT_ID` | Delete | social sign-in; OIDC connections replace it |
| `GITHUB_OAUTH_CLIENT_SECRET` | Delete | as above |
| `GOOGLE_CLIENT_ID` | Delete | as above |
| `GOOGLE_CLIENT_SECRET` | Delete | as above |
| `DISCORD_CLIENT_ID` | Delete | as above, and with the Discord integration |
| `DISCORD_CLIENT_SECRET` | Delete | as above |
| `NOTIFICATION_SECRET_ENCRYPTION_KEY` | Delete | existed only for the six integrations; `TASKDESK_ENCRYPTION_KEY` replaces its role |
| `CREEM_API_KEY` | Delete | billing |
| `CREEM_TEST_MODE` | Delete | billing |
| `CREEM_WEBHOOK_SECRET` | Delete | billing |
| `BILLING_TRIAL_DAYS` | Delete | billing |
| `BILLING_FOUNDING_CUTOFF` | Delete | billing |
| `BILLING_REMINDER_MAX_PER_RUN` | Delete | billing |
| `TURNSTILE_SECRET_KEY` | Delete | with the Turnstile check |
| `TURNSTILE_TIMEOUT_MS` | Delete | as above |
| `REDIS_PASSWORD` | Delete | credentials belong in the one URL |
| `REDIS_SENTINELS` | Delete | **Sentinel support is dropped** — one `TASKDESK_VALKEY_URL` |
| `REDIS_SENTINEL_MASTER_NAME` | Delete | Sentinel dropped |
| `REDIS_SENTINEL_PASSWORD` | Delete | Sentinel dropped |
| `REDIS_SENTINEL_TLS` | Delete | Sentinel dropped |
| `REDIS_CLUSTER_NODES` | Delete | **Cluster support is dropped** |
| `POSTGRES_DB` | Delete from the app | compose-only, for the database service in the image's stack |
| `POSTGRES_USER` | Delete from the app | compose-only |
| `POSTGRES_PASSWORD` | Delete from the app | compose-only |
| `POSTGRES_HOST` | Delete from the app | compose-only |
| `POSTGRES_PORT` | Delete from the app | compose-only |
| `VITE_API_URL` | Delete | the bundle learns its API origin from the page origin |
| `VITE_APP_URL` | Delete | as above |
| `VITE_CLIENT_URL` | Delete | as above |
| `VITE_SENTRY_DSN` | Delete | Sentry removed |
| `VITE_TURNSTILE_SITE_KEY` | Delete | Turnstile removed |
| `apps/web/env.sh` (`KANEO_API_URL`, `KANEO_SENTRY_DSN`, `KANEO_TURNSTILE_SITE_KEY` substitution at container start) | Delete | the whole mechanism goes |
| `APPDATA` | Keep as an OS variable | Windows CLI path resolution — not configuration |
| `XDG_CONFIG_HOME` | Keep as an OS variable | CLI path resolution — not configuration |

`deploy/.env.example` is written from the **rename** and **new** rows only; kaneo's
`.env.sample` is not copied. The sweep touches `Dockerfile.kaneo`, `charts/kaneo/values.yaml`,
`apps/api/src/auth.ts`, `apps/api/src/database/*` and every `apps/web` `VITE_*` site.

## 3. Removals, then the retrofit

The [fork-time removal list](../07-planning/decision-log.md) is the checklist; P0 step 1 is
not complete, and the route-coverage gate is not trusted, until every item is gone or
explicitly disabled, with a test or a grep in `tests/permissions/` proving absence where one
is possible.

1. **Anonymous guest sign-in** — remove the better-auth `anonymous()` plugin
   (`apps/api/src/auth.ts:278`, enabled unless `DISABLE_GUEST_ACCESS=true`), the
   `emailDomainName: "kaneo.app"` literal, the `DISABLE_GUEST_ACCESS` and `DEMO_MODE`
   variables, the `hasGuestAccess` / `isDemoMode` fields in
   `apps/api/src/utils/get-settings.ts`, and the registration-limit exemption for anonymous
   users. `no-anonymous-plugin.test.ts` asserts the constructed config contains no
   `anonymous` plugin.
2. **Account linking** — `accountLinking.enabled` is set **explicitly `false`**
   (`auth.ts:235-245` ships `true` with `trustedProviders: ["github","google","discord",
   "custom"]`). The test for `IP-18` reads the constructed config, not only the HTTP
   behaviour.
3. **Session cookie cache** — `session.cookieCache` (`auth.ts:557-560`, `maxAge: 300`) is
   **disabled**, per the revocation SLA.
4. **`deviceAuthorization()` and `bearer()`** — removed (`auth.ts:545`, `:535`), with
   `DEVICE_AUTH_CLIENT_IDS` and the `device-authorization` integration test.
5. **The `organization` plugin** — removed (`auth.ts:315`; it is kaneo's workspace model)
   and its `/organization/*` routes with it. TaskDesk's own `invitation`, `workspace_role`
   and team tables replace it ([data-model.md](../01-architecture/data-model.md)); the
   `admin` plugin (`auth.ts:550`) is **kept as a session primitive** with its routes
   unmounted, and `twoFactor` — which kaneo does not enable — is **added** in P0.
6. **kaneo's `mcp` and `oauth` routers** — removed, with `KANEO_API_KEY`,
   `KANEO_MCP_CLIENT_ID`, the four `tests/api/mcp-*.test.ts` files and the two
   `mcp-oauth-*` integration tests. TaskDesk's MCP server is specified separately
   ([mcp-server.md](../03-features/mcp-server.md)) and is not this code.
7. **`public-project`** — not a router; a named checklist:
   `apps/api/src/index.ts:226` (the inline `GET /public-project/:id`),
   `apps/api/src/project/schema.ts`, `apps/api/src/project/response.ts`,
   `apps/api/src/project/controllers/update-project.ts`, `apps/api/src/mcp/tools.ts`,
   **`apps/api/src/utils/authorize-asset-access.ts:23` — the anonymous attachment-read
   branch**, the web `components/public-project/`, `routes/public-project.$projectId.tsx`,
   its fetchers, hooks and four test files, and a **two-phase drop** of
   `project.is_public` (`database/schema.ts:328`) per [migrations.md](migrations.md).
8. **The six integration plugins** — `apps/api/src/plugins/{github,gitea,slack,discord,
   generic-webhook,telegram}` and their registrations in `plugins/index.ts`, their routers
   and web screens, the `integration` (`schema.ts:867`) and `github_integration`
   (`schema.ts:845`) tables, the `octokit` / `@octokit/webhooks` dependencies,
   `NOTIFICATION_SECRET_ENCRYPTION_KEY`, `KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` and
   their tests. **`plugins/registry.ts` and `plugins/types.ts` are kept** as the seed of
   `packages/plugins-contracts`.
9. **Billing** — four tables (`workspace_billing` `schema.ts:178`, `trial_grant` `:211`,
   `billing_event` `:217`, `billing_reminder_sent` `:444`), `creem`, `CREEM_*` /
   `BILLING_*` / `TURNSTILE_*` / `KANEO_CLOUD`, `trial-card.tsx`, `demo-alert.tsx`,
   `get-settings.ts`'s `billingEnabled`, and the billing tests.
10. **Sentry** — the `sentry/` folder **and** the 17 code sites: `apps/api/src/instrument.ts`,
    `apps/api/src/index.ts`, `apps/api/src/scheduler/index.ts`,
    `apps/api/src/utils/authenticate-api-request.ts`, six files under `apps/api/src/plugins/*`
    (which leave anyway), `apps/web/src/instrument.ts`, the Vite source-map plugin in
    `apps/web/vite.config.ts`, `apps/web/src/query-client/index.ts`, the auth provider, and
    **`apps/web/src/components/ui/error-boundary.tsx` — de-Sentry'd *before* it moves into
    `packages/ui`**, or `packages/ui` inherits an observability dependency and breaks the
    layout rule. Plus the `@sentry/*` dependencies and every `SENTRY_*` / `VITE_SENTRY_*`.
11. **`packages/planka-import`** and the `publish-mcp` / `publish-planka-import` workflows.
12. **kaneo's own agent instructions** — `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/`,
    `.agents/`, `.coderabbit.yaml`, `skills-lock.json` and eight of the ten `skills/`.
13. **The environment surface** — the table in §2.

Anything **kept without a v2 spec** gets a feature flag defaulting **off** — today that is
`workflow-rule` until [automations.md](../03-features/automations.md) is aligned, and the
gantt/calendar views until their UX gates pass. `valibot` survives in exactly one file
(`apps/api/src/ws/redis-broadcast-adapter.ts`) once the integrations are gone — port that
one to Zod; `nanostores` is **not** removable (it is better-auth's client store, not app
code) and is not on the consolidation list.

**Then the largest security task of P0, and it is now sized:** `apps/api/src/index.ts`
mounts **28 sub-routers** plus **6 inline routes**, and `apps/api/src` carries **~105 route
definitions** — roughly **85** after the removals above. Each of those needs an entry in the
five policy kinds ([rbac.md](../01-architecture/rbac.md#route-policies--the-anti-v1-mechanism))
so the route-coverage test — which enumerates Hono's router — goes green on the *inherited*
surface, not on an empty application. **Delete first, then retrofit**, so no policy is ever
written for a route that is about to go. `GET /invitation/public/:id` (`index.ts:240`) is
**kept**, as policy kind 4 (`public`), rate-limited in the anonymous class, constant-shape
404, no email address and no member list. This is a human-reviewed pass over kaneo's code,
not a scanner run, and it gets its own Opus security review before P0 closes.

## 4. Structure

1. Create `packages/domain`, `packages/permissions` (**replaced, not extended** — kaneo's is
   84 lines of better-auth `createAccessControl`; keep the four role names for data
   continuity and write the capability / policy / evaluator layer fresh, without the
   `better-auth` dependency) and `packages/plugins-contracts` as typed skeletons with one
   test each.
2. Extract `packages/ui` per [ui-extraction-plan.md](../02-design/ui-extraction-plan.md).
3. Split `apps/web` into `entry.agent.tsx` and `entry.portal.tsx`; add the bundle-purity
   check ([ux-quality-gates.md](../02-design/ux-quality-gates.md) `G12`).
4. Add `repository.ts` to every feature folder and `check:queries`
   ([monorepo-layout.md](../01-architecture/monorepo-layout.md)).
5. Route registry `lib/routes.ts` + round-trip test; policy registry + the three permission
   tests ([rbac.md](../01-architecture/rbac.md)).
6. `docs/` — this corpus — moves in unchanged.

## 5. Tooling to add

The "Added to kaneo's stack" table in [tech-stack.md](../01-architecture/tech-stack.md):
Storybook 10, Playwright + axe, Testcontainers, dependency-cruiser, TanStack Table,
Recharts, Pino, prom-client, Redocly CLI, oasdiff, k6, cosign, coverage thresholds,
`check:queries`, `check:inventory`. Each lands with its CI step from [ci-cd.md](ci-cd.md).

Also **`pnpm test:all`**, which kaneo has no equivalent of: a root script aliasing every
check CI runs, in order — `lint`, `typecheck`, `i18n:check`, `test`, `build`,
`test:integration`, `check:queries`, `check:inventory`, `check:reviews`. It exists so "green"
means the same thing locally and in CI; kaneo's turbo tasks are only `build`, `dev`, `lint`,
`typecheck`, `test`, `test:integration`.

## 6. Local run

```bash
pnpm install
cp deploy/.env.example .env      # ours, written fresh; five required variables — generate the two secrets
scripts/deploy.sh local          # Postgres 18, Valkey 9, Traefik, the app (SeaweedFS only with --profile s3)
open https://ticket.localhost    # the one-time setup page; token is in the container log
```

## 7. Exit — P0 step 1 is done when

- `pnpm test:all` is green with kaneo's inherited routes present, including route coverage (which
  will list every inherited kaneo route with a policy — writing those policies is the
  first real security work of the project).
- Anonymous sign-in is **off**, account linking is **off**, the session cookie cache is
  **off**, and a test reads the constructed better-auth config to prove each.
- No route in Hono's router matches `public-project`, `github`, `gitea`, `slack`, `discord`,
  `telegram` or `generic-webhook`.
- No `process.env` read outside the approved list in §2.
- kaneo's own suite baseline (§0 item 2) is recorded, and every red test in ours is
  attributable to a deliberate removal.
- Both bundles build; the portal bundle contains no agent module.
- The image builds multi-arch, is signed, and `scripts/deploy.sh local` deploys it on three
  hostnames.
- `THIRD-PARTY-NOTICES.md`, `NOTICE`, `LICENSE`, `SECURITY.md`,
  `.github/pull_request_template.md` and the inherited-features register exist.

## Related

- [Phases](../07-planning/phases.md) · [ADR 0001](../01-architecture/adr/0001-kaneo-as-foundation.md) · [ADR 0008](../01-architecture/adr/0008-single-design-system.md)
- [Container image](../05-operations/container-image.md) · [Migrations](migrations.md)
