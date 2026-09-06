# Inherited-features register

Every kaneo feature and notable dependency that arrives with the fork, with a verdict. **A
P0 step 1 deliverable** ([phases.md](../07-planning/phases.md), [repository-bootstrap.md](../04-engineering/repository-bootstrap.md)):
this page is filled in against the actual snapshot, and the kaneo commit SHA is recorded
here and in `THIRD-PARTY-NOTICES.md`. Until a "keep — write a spec" row has its spec, the
feature ships **feature-flagged off**. This page is also where every fact that **depends on
the SHA** is stated once — the locale count, the presence of `job_lease`, the primitive
counts — so no other document has to guess.

**kaneo commit taken:** **CONFIRMED** `42bb801114aa1ae499228a53180f0cdbc5607964` — upstream
`main` (a commit, not a tag), upstream CI run 33957941564 green. Reason: post-tag
authorization fixes included. **Confirmed by Thomas, 2026-09-06.**

### Verification record — taken 2026-09-06

This is the **attribution baseline**: the numbers a later red test is measured against, so
that "this failure came from kaneo" and "we introduced this regression" can be told apart.
Everything below was produced from a throwaway `git worktree` detached at the snapshot SHA,
so the reference clone never gained a `node_modules`.

| | |
| --- | --- |
| Snapshot SHA | `42bb801114aa1ae499228a53180f0cdbc5607964` |
| Verified as | tip of upstream `main` at fetch time on 2026-09-06 (`git merge-base --is-ancestor` confirms) |
| Upstream CI run | 33957941564, green |
| Toolchain | Node 24.20.0, pnpm 10.32.1 (kaneo's `engines` says `>=24.0.0`, `packageManager` says `pnpm@10.32.1`) |
| `pnpm install --frozen-lockfile` | clean, lockfile unchanged |

**kaneo's own suite on the snapshot, untouched — every check green:**

| Check | Result | Note |
| --- | --- | --- |
| `pnpm typecheck` | **pass** | |
| `pnpm test` (unit) | **pass — 130 files, 692 tests, 0 failed, 0 skipped** | api 60/386 · web 49/190 · planka-import 5/54 · mcp 8/33 · email 6/16 · permissions 1/10 · libs 1/3 |
| `pnpm build` | **pass** | |
| `pnpm i18n:check` | **pass** | |
| `pnpm openapi:check` | **pass** | not named in [repository-bootstrap.md](../04-engineering/repository-bootstrap.md) §0's baseline list — see the note below |
| `pnpm lint` | **pass, tree unmodified** | kaneo's `lint` is `biome check --write .`; it changed nothing, so the snapshot is already biome-clean |
| `pnpm test:integration` on **Postgres 16** | **pass — 33 files, 227 tests, 0 failed, 0 skipped** | 195s. This is what kaneo's own CI validates against |
| `pnpm test:integration` on **Postgres 18** | **pass — 33 files, 227 tests, 0 failed, 0 skipped** | 69s. **Identical counts.** TaskDesk's target major runs kaneo's inherited suite with no behavioural difference — new information, not a regression we caused |

**Two corrections to the surrounding documents, from running this:**

- `pnpm openapi:check` (root script, backed by `scripts/openapi/check.mjs`, with its own job
  in kaneo's `ci.yml`) is **absent from the §0 baseline list and has no verdict row in the
  §1 copy table**, while `apps/api/scripts/export-openapi.ts` is copied and
  `tests/api-integration/openapi.test.ts` is in the keep list. Under the table's own "an
  entry not in the table is not copied" rule, TaskDesk would inherit half an OpenAPI drift
  check. Flagged for Thomas; no verdict taken here.
- The local clone is **no longer 68 commits behind at `51255e85`** — it is at the snapshot
  SHA. The "`git fetch` first" instruction still stands, and the fetch was performed.

**Supply-chain scan — `pnpm audit`, 2026-09-06: 12 advisories (0 critical, 8 high, 3 moderate, 1 low).**

None of the eight high-severity advisories is reachable from a shipped TaskDesk. Each was
traced to its dependency path rather than counted:

| Severity | Package | Path | Reachable in the shipped product? |
| --- | --- | --- | --- |
| high ×4 | `fast-uri` | `@commitlint/cli > … > ajv > fast-uri` | **No** — `@commitlint/cli` is a root **devDependency** |
| high | `js-yaml` | `@commitlint/cli > … > cosmiconfig > js-yaml` | **No** — same devDependency |
| high | `nanoid` | `apps/web > postcss > nanoid` | **No** — build-time only |
| high | `mysql2` | `apps/api > better-auth > mysql2` | **No** — an **optional peerDependency** of better-auth; kaneo uses `pg`, and nothing in `apps/api/src` or `packages/*/src` imports `mysql2` |
| high | `deepmerge-ts` | `apps/api > better-auth > prisma > @prisma/config` | **No** — `prisma`/`@prisma/client` are optional peers; kaneo uses Drizzle |
| moderate ×2 | `qs` | `apps/api > @modelcontextprotocol/sdk > express` | **Yes** — `packages/mcp` is copied. **The only advisory on a shipped path** |
| moderate | `mysql2` | as above | No |
| low | `postcss-selector-parser` | `apps/site > shadcn` | **No** — `apps/site` is *Do not copy*, so it leaves at import |

**Verdict:** nothing high or critical blocks the import commit. The one item to carry
forward is `qs` via the MCP SDK's `express`, which lands with `packages/mcp` and is
recorded here rather than fixed inside an inherited snapshot.

**Trivy, 2026-09-06:**

- `trivy config` on `Dockerfile.kaneo` — **0 misconfigurations** at HIGH/CRITICAL.
- `trivy fs --scanners vuln` over `pnpm-lock.yaml` (excluding `apps/site`, which is not
  copied) — **7 HIGH, 0 CRITICAL**: `deepmerge-ts` CVE-2026-40345, `fast-uri` CVE-2026-75899
  / CVE-2026-75931 / CVE-2026-75975 / CVE-2026-76172, `mysql2` GHSA-3f6p-5ww8-9rcr, `nanoid`
  CVE-2026-67213. **The same package set `pnpm audit` found**, from a different advisory
  database — two independent scanners agreeing that nothing critical is present, and that
  every high sits in the dev, build-time or unused-optional-driver paths analysed above.


**Primitive libraries found in `components/ui`:** **Base UI 43 / Radix 1 of 63** files
(`form.tsx` imports `@radix-ui` `Slot`; `timeline.tsx` imports `Slot` from the `radix-ui`
umbrella). **17 of the 18 `@radix-ui/*` dependencies in `apps/web/package.json` are unused
and are pruned** — see [ui-extraction-plan.md](../02-design/ui-extraction-plan.md).

| kaneo feature / dependency | Where | Verdict | v2 spec / flag |
| --- | --- | --- | --- |
| `github-integration`, `gitea-integration` (`octokit`, `@octokit/webhooks`) | `apps/api/src` | **Remove at fork** (decided 2026-09-05) | Routers, handlers, screens and dependencies deleted — not kept dormant. `external_link` and the reserved `devlink` kind are the extension point; future priority GitHub → GitLab → Gitea → Bitbucket → Azure DevOps ([plugin-architecture.md](plugin-architecture.md)). `feature.dev_links` reserved, no code |
| `slack-integration`, `discord-integration`, `telegram-integration` | `apps/api/src` | **Remove at fork** (decided 2026-09-05) | Deleted, not flagged. They return — if at all — as `notify.*` plugins in the order Teams → Slack → Telegram → Viber, outside the current scope |
| `generic-webhook-integration` | `apps/api/src` | **Replace** | Deleted; our signed outbound webhooks ([webhooks-and-api-keys.md](../03-features/webhooks-and-api-keys.md)) are written fresh in P4 with `WH-1`…`WH-14` |
| `plugins/` — the registry | `apps/api/src/plugins` | **Split** | `plugins/index.ts` registers exactly the six integrations above, so it goes with them; the six subdirectories are deleted along with the `integration` (`schema.ts:867`) and `github_integration` (`schema.ts:845`) tables and their tests under `tests/api/plugins/`. **`registry.ts` and `types.ts` are kept** as the seed of `packages/plugins-contracts` ([plugin-architecture.md](plugin-architecture.md)) |
| `workflow-rule` | `apps/api/src` | Keep | [automations.md](../03-features/automations.md); `feature.automations` off until aligned |
| `time-entry` | `apps/api/src` | Keep | [time-and-cost.md](../03-features/time-and-cost.md); `feature.time_tracking` |
| `public-project` (anonymous public boards) | api + web | **Remove at fork** (decided 2026-09-05 — a flag is a runtime toggle, not a deletion; an unauthenticated read surface does not ship dormant) | Not a router — a checklist: the inline route at `apps/api/src/index.ts:226`; `project/schema.ts`; `project/response.ts`; `project/controllers/update-project.ts`; `mcp/tools.ts`; **`utils/authorize-asset-access.ts:23` — the anonymous attachment-read branch**; web `components/public-project/`, `routes/public-project.$projectId.tsx`, its fetchers, hooks and four tests; and a **two-phase drop** of `project.is_public` (`database/schema.ts:328`) per [migrations.md](../04-engineering/migrations.md). The flag name `feature.public_boards` stays **reserved** for a future spec'd re-implementation with its own security review |
| `GET /invitation/public/:id` (`index.ts:240`) | `apps/api/src` | **Keep**, as policy kind 4 (`public`) | The only other unauthenticated route in kaneo's `index.ts`. Rate-limited in the anonymous class, constant-shape 404 for an unknown or expired id, no email address and no member list. The invitee has to see what they are accepting; the id is a ≥128-bit token ([rbac.md](rbac.md)) |
| better-auth `anonymous()` guest sign-in + `DEMO_MODE` | `apps/api/src/auth.ts:278`, `utils/get-settings.ts` | **Remove at fork** | Enabled by default upstream (opt-**out** via `DISABLE_GUEST_ACCESS`), with `hasGuestAccess` / `isDemoMode` shipped to the client and anonymous users exempted from the registration limits. Same reasoning as public boards. The `emailDomainName: "kaneo.app"` literal goes with it. `no-anonymous-plugin.test.ts` reads the constructed config |
| better-auth `deviceAuthorization()` and `bearer()` | `auth.ts:545`, `:535` | **Remove at fork** | Two authentication surfaces no v2 spec mentions; `DEVICE_AUTH_CLIENT_IDS` and `tests/api-integration/device-authorization.test.ts` go with them. Either returns only with a spec and a security review |
| better-auth `organization()` plugin | `auth.ts:315` | **Remove at fork** — replaced | It *is* kaneo's workspace model. Its `/organization/*` routes are unmounted and gone; TaskDesk's `invitation`, `workspace_role` and team tables replace it ([data-model.md](data-model.md), [multi-tenancy.md](multi-tenancy.md)) |
| better-auth `adminPlugin()` | `auth.ts:550` | **Keep as a session primitive only** | The impersonation and user-state primitives are used; its HTTP routes are **not mounted**. Elevation is TaskDesk's own ([rbac.md](rbac.md), [god-mode.md](../03-features/god-mode.md)) |
| better-auth `accountLinking` | `auth.ts:235-245` | **Disable explicitly** | Ships `enabled: true` with `trustedProviders: ["github","google","discord","custom"]` — and `"custom"` is the `genericOAuth` provider `auth.oidc` is built on. Set `enabled: false`; `IP-18`'s test reads the constructed config ([auth-and-identity.md](auth-and-identity.md)) |
| better-auth `session.cookieCache` | `auth.ts:557-560` | **Disable** | Five minutes upstream; a revoked session would stay live that long. Disabled at fork — see the revocation SLA in [auth-and-identity.md](auth-and-identity.md) § Sessions |
| better-auth `twoFactor()` | not enabled upstream | **Add in P0** | kaneo enables neither `twoFactor` nor `passkey`; TaskDesk adds `twoFactor` ([auth-and-identity.md](auth-and-identity.md)) |
| `gantt`, `calendar` views | `apps/web` | Keep | [views.md](../03-features/views.md); `feature.timeline`, `feature.calendar` until P5 UX gates pass |
| `backlog-list-view`, `kanban-board`, `list-view`, `bulk-selection`, `command-palette`, `keyboard-shortcuts-help`, `search`, `onboarding`, `profile-setup`, `team` | `apps/web` | Keep | Covered by P1 specs |
| `scheduler` (`croner`), `invitation`, `notification-preferences`, `external-link`, `task-relation`, `column`, `activity`, `storage`, `instance` | `apps/api/src` | Keep | The mechanisms v2 assumes |
| `job_lease` table (`database/schema.ts:480` — `name`, `owner`, `expiresAt`) | `apps/api/src` | **Inherited — review and adopt** | It arrives with the snapshot (added post-`v2.22.0`); it is not ours to write. The heartbeat and the abort signal on lease loss are ours to add ([background-jobs.md](background-jobs.md)) |
| `mcp` and `oauth` routers | `apps/api/src` | **Remove at fork** | Two inherited surfaces with their own client credentials (`KANEO_API_KEY`, `KANEO_MCP_CLIENT_ID`) and their own OAuth store. TaskDesk's MCP server is specified separately ([mcp-server.md](../03-features/mcp-server.md)) and is not this code; the four `tests/api/mcp-*.test.ts` and the two `mcp-oauth-*` integration tests go with them. `packages/mcp` is copied, minus its publish plumbing |
| `billing`, `trial-card`, `demo-alert`, `creem`, Turnstile / disposable-email checks | api + web | **Remove** (abuse checks → optional plugins) | **Four tables**: `workspace_billing` (`schema.ts:178`), `trial_grant` (`:211`), `billing_event` (`:217`), `billing_reminder_sent` (`:444`); plus `CREEM_*`, `BILLING_TRIAL_DAYS`, `BILLING_FOUNDING_CUTOFF`, `BILLING_REMINDER_MAX_PER_RUN`, `TURNSTILE_*`, `KANEO_CLOUD`, `get-settings.ts`'s `billingEnabled`, `tests/api/billing/` and the seven `tests/api-integration/billing-*` suites plus `trial-reminders`. [competitive-inspiration.md](../00-overview/competitive-inspiration.md) |
| Sentry | api + web + `sentry/` | **Remove at fork** | The folder holds only `README.md`, `alerts.json`, `dashboards.json`; the real footprint is **17 code sites** — both `instrument.ts` files, `apps/web/vite.config.ts`'s source-map upload, the query client, the auth provider, the scheduler, `utils/authenticate-api-request.ts`, six files under `plugins/*` (which leave anyway) and **`components/ui/error-boundary.tsx`, which must be de-Sentry'd *before* it moves into `packages/ui`** — plus the `@sentry/*` dependencies and every `SENTRY_*` / `VITE_SENTRY_*` variable ([observability.md](observability.md)) |
| `packages/planka-import` | packages | **Remove** | Park as `import.planka` only if trivially cheap; the `publish-planka-import` workflow goes with it |
| `valibot` | `apps/api` only | **Port one file** | Seven of its eight import sites are inside code being deleted (the six plugin `config.ts` files and the Telegram controller); the survivor is `apps/api/src/ws/redis-broadcast-adapter.ts`. Port that one to Zod after the deletions |
| `nanostores` | `apps/web` | **Not removable — keep** | Zero direct imports in `apps` or `packages`: it is better-auth's client store, which `useSession` is built on. It is not a Zustand alternative and is not on the consolidation list ([tech-stack.md](tech-stack.md)) |
| `react-markdown`, `turndown`, `mermaid`, `shiki` (Markdown import/export, diagrams, code highlighting) | `apps/web` | Keep | Add to [comments-and-activity.md](../03-features/comments-and-activity.md)'s rich-text rules |
| `@base-ui/react` + `@radix-ui/*` | `apps/web` | **Converge on Base UI** (decided 2026-09-05) | Already largely done upstream: 43 of 63 primitives are Base UI, 1 is Radix. The remaining work is that one file plus pruning 17 stale `@radix-ui/*` dependencies; `packages/ui/KNOWN-RADIX.md` will have about one row, with a revisit date, enforced by `check:ui`. Feature code imports only `@taskdesk/ui` — [ui-extraction-plan.md](../02-design/ui-extraction-plan.md) |
| `packages/permissions` | packages | **Replace, keep the role names** | 84 lines of better-auth `createAccessControl` and four static roles — no capability registry, no policy kinds, no evaluator, and a `better-auth` dependency that breaks the layout's "pure" rule. Roles `viewer`/`member`/`admin`/`owner` are kept for data continuity; the layer is written fresh ([monorepo-layout.md](monorepo-layout.md), [rbac.md](rbac.md)) |
| `i18n/` — locale JSONs, `resources.ts`, `schema.json` | root | Keep, at the root | **18 locales at the local clone; 19 at upstream `42bb8011` (`pl-PL` added)** — state the count for the SHA actually taken. [i18n.md](i18n.md) |
| `scripts/i18n/` (`check`, `report`, `schema`, `shared`) | root | Keep | The root `i18n:check` scripts and the CI i18n gate call them; they travel with the root `i18n/` |
| `tests/` (`tests/api`, `tests/api-integration`) | root | **Copy, minus the deleted areas** | kaneo's own suites are the attribution baseline. Deleted **in the same commit** as the code they cover: `tests/api/{billing,github-integration,gitea-integration,plugins/*}`, the four `mcp-*` unit tests, and `tests/api-integration/{billing-*,trial-reminders,device-authorization,mcp-oauth-*}` ([repository-bootstrap.md](../04-engineering/repository-bootstrap.md) §1) |
| `skills/` — 10 directories + `skills-lock.json` | root | **Keep 2** | Kept: `improve-animations`, `find-animation-opportunities`. Not copied: `animate`, `animation-vocabulary`, `apple-design`, `coss`, `emil-design-eng`, `pick-ui-library`, `prototype`, `review-animations` — of which `pick-ui-library`, `animation-vocabulary` and `review-animations` are read-once references. `skills-lock.json` is **not copied**; it pins the ten-skill set and is stale the moment eight are dropped ([agent-workflow.md](../04-engineering/agent-workflow.md)) |
| `apps/site` (Next 16 marketing site) | apps | **Do not copy** | It is a marketing site, not a docs framework, and kaneo's documentation is `apps/docs` on Mintlify. TaskDesk's docs site is an **open decision** — [08-docs-site/plan.md](../08-docs-site/plan.md) |
| `.github/` — templates, `dependabot.yml`, 15 workflows | root | **Do not copy — ours written fresh** | kaneo's `ci.yml` job list (lint, i18n, typecheck, unit, build, integration on `postgres:16`, docker-build) is read once as the shape ours starts from; `publish-mcp` and `publish-planka-import` have nothing to publish here ([ci-cd.md](../04-engineering/ci-cd.md)) |

## Related

- [Review 2026-09-05](../07-planning/review-2026-09-05.md) · [ADR 0001](adr/0001-kaneo-as-foundation.md) · [Licensing](../00-overview/licensing-and-attribution.md)
