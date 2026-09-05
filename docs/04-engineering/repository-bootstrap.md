# Repository bootstrap — from kaneo to a green, empty TaskDesk

The most-used document of the project's first fortnight: exactly how `../kaneo` becomes
`Ticketing.v2` with CI green on an empty application. This is P0 step 1 made concrete
([phases.md](../07-planning/phases.md)). Written 2026-09-05.

## 0. Before copying anything

1. Record the kaneo commit: `git -C ../kaneo rev-parse HEAD` → `THIRD-PARTY-NOTICES.md`
   and the [inherited-features register](../01-architecture/inherited-features.md) (created
   in step 3).
2. Audit the snapshot as a supply-chain input: `pnpm audit` in `../kaneo`, Trivy on
   `Dockerfile.kaneo`'s build; fix or note every high/critical **before** the fork commit
   ([security-model.md](../01-architecture/security-model.md)).
3. Confirm kaneo's licence file is MIT and copy it into `THIRD-PARTY-NOTICES.md` verbatim.

## 1. What is copied, what is not

| Copy | Do not copy |
| --- | --- |
| `apps/api`, `apps/web`, `apps/site` | `apps/docs` (kaneo's own docs content) |
| `packages/email`, `packages/libs`, `packages/mcp`, `packages/permissions`, `packages/typescript-config` | `packages/planka-import` (not in scope — or park as `import.planka` later) |
| `i18n/` (18 locales — see [i18n.md](../01-architecture/i18n.md)) | `CHANGELOG.md` (kaneo's, 180 KB of someone else's history), `CONTRIBUTORS.svg` |
| `biome.json`, `turbo.json`, `pnpm-workspace.yaml`, `commitlint.config.js`, `release.config.js` | `compose.coolify.yml`, `sentry/` (kaneo's DSN and project) |
| `Dockerfile.kaneo` → renamed `Dockerfile` and rewritten per [container-image.md](../05-operations/container-image.md) | kaneo's `deploy/kaneo-entrypoint.sh` (replaced) |
| `charts/kaneo` → `charts/taskdesk`, rewritten per [kubernetes.md](../05-operations/kubernetes.md) | GitHub workflows (rewritten for [ci-cd.md](ci-cd.md)) |
| `plans/` (motion specs) → `docs/02-design/motion/` | `skills/` except `improve-animations`, `find-animation-opportunities` |

Order of operations: **packages before apps** — `packages/*` must compile before
`apps/api` and `apps/web` can.

## 2. De-brand

A scripted sweep, committed as one change so it is reviewable:

- Package names `@kaneo/*` → `@taskdesk/*` across every `package.json` and import.
- Strings: `kaneo`/`Kaneo` in `i18n/*.json` (product name only — not third-party names),
  page titles, email templates, `apps/site` content, `README.md`.
- Assets: logos, favicon, OG images → placeholders until branding lands in God Mode.
- References: GHCR image names, Docker Hub links, the Sentry DSN, Coolify labels, the
  `packageManager` and `engines` fields stay.
- Strip billing, seats and trials: `apps/api/src/billing`, `creem`, `trial-card.tsx`,
  `demo-alert.tsx`, `workspace_billing` / `trial_grant` tables and their migrations,
  Turnstile/disposable-email checks become optional plugins.
- Keep every kaneo copyright header on files taken verbatim
  ([licensing](../00-overview/licensing-and-attribution.md)).

## 3. Inherited-features register

Fill `docs/01-architecture/inherited-features.md` from the table in
[review-2026-09-05.md](../07-planning/review-2026-09-05.md): every kaneo feature folder and
notable dependency, a verdict, the SHA. Anything **kept without a v2 spec** gets a feature
flag defaulting **off** (GitHub/Gitea/Telegram integrations, `workflow-rule` until
[automations.md](../03-features/automations.md) is aligned). `public-project` is
**deleted**, not flagged — an unauthenticated read surface does not ship dormant
([inherited-features.md](../01-architecture/inherited-features.md)). Consolidate
`valibot` → Zod, `nanostores` → Zustand.

**Then the largest security task of P0:** retrofit every inherited kaneo router into the
five policy kinds ([rbac.md](../01-architecture/rbac.md#route-policies--the-anti-v1-mechanism))
so the route-coverage test — which enumerates Hono's router — goes green on the *inherited*
surface, not on an empty application. This is a human-reviewed pass over kaneo's code, not a
scanner run, and it gets its own Opus security review before P0 closes.

## 4. Structure

1. Create `packages/domain`, `packages/permissions` (extend kaneo's), `packages/plugins-contracts`
   as empty, typed skeletons with one test each.
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

## 6. Local run

```bash
pnpm install
cp deploy/.env.example .env      # five required variables; generate the two secrets
scripts/deploy.sh local          # Postgres 18, Valkey 9, SeaweedFS, Traefik, the app
open https://ticket.localhost    # the one-time setup page; token is in the container log
```

## 7. Exit — P0 step 1 is done when

- `pnpm test:all` is green on the empty application, including route coverage (which
  will list every inherited kaneo route with a policy — writing those policies is the
  first real security work of the project).
- Both bundles build; the portal bundle contains no agent module.
- The image builds multi-arch, is signed, and `scripts/deploy.sh local` deploys it on three
  hostnames.
- `THIRD-PARTY-NOTICES.md`, `NOTICE`, `LICENSE`, `SECURITY.md` and the inherited-features
  register exist.

## Related

- [Phases](../07-planning/phases.md) · [ADR 0001](../01-architecture/adr/0001-kaneo-as-foundation.md) · [ADR 0008](../01-architecture/adr/0008-single-design-system.md)
- [Container image](../05-operations/container-image.md) · [Migrations](migrations.md)
