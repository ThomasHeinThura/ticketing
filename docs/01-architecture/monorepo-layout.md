# Monorepo layout

## Tree

```
Ticketing.v2/
├── apps/
│   ├── api/                    Hono backend — the only backend
│   │   ├── drizzle/            generated SQL migrations, forward-only
│   │   └── src/
│   │       ├── index.ts        app bootstrap, static serving, health
│   │       ├── openapi.ts      createRoute helpers, spec assembly
│   │       ├── database/       schema.ts, client, seeds
│   │       ├── middleware/     session, portal boundary, identity, policy
│   │       ├── plugins/        auth/ storage/ notify/ import/ registries
│   │       ├── jobs/           croner definitions + job_lease helper
│   │       ├── ws/             websocket adapters (memory | valkey)
│   │       ├── events/         domain event bus and subscribers
│   │       └── <feature>/      one folder per feature — see below
│   ├── web/                    React frontend — one source, two bundles
│   │   ├── index.agent.html
│   │   ├── index.portal.html
│   │   └── src/
│   │       ├── entry.agent.tsx
│   │       ├── entry.portal.tsx
│   │       ├── routes/         TanStack Router file routes
│   │       │   ├── agent/
│   │       │   └── portal/
│   │       ├── components/     feature components (NOT primitives)
│   │       ├── fetchers/       typed API calls
│   │       ├── hooks/          queries/ mutations/ and plain hooks
│   │       ├── store/          zustand, UI state only
│   │       └── lib/            routes.ts registry, formatters, guards
│   └── site/                   the documentation website — stack is an OPEN decision (08-docs-site/plan.md);
│                               kaneo's apps/site is a marketing site and its apps/docs is Mintlify, so neither is copied
│
├── packages/
│   ├── ui/                     THE design system. Only source of primitives.
│   │   ├── src/components/     button, dialog, table, sidebar, … (63, extracted from apps/web)
│   │   ├── src/styles/         tokens.css, theme.css, motion.css
│   │   └── .storybook/
│   ├── domain/                 pure business logic, zero I/O
│   │   └── src/{sla,workflow,approvals,assignment,calendar,ranking}/
│   ├── permissions/            capabilities, roles, policy registry, evaluator
│   │                           REPLACES kaneo's 84-line package, keeping its four role names
│   ├── plugins-contracts/      the interfaces every plugin implements
│   ├── libs/                   typed Hono client, shared URL helpers
│   ├── email/                  React Email templates + sender
│   ├── mcp/                    MCP server (agent access + import tooling)
│   ├── importers/              azure-devops · plane · jira · csv
│   └── typescript-config/      shared tsconfig bases
│
├── tests/                      the first two directories are kaneo's own shape, inherited with its suites
│   ├── api/                    unit tests for API modules            (inherited, minus the deleted areas)
│   ├── api-integration/        Testcontainers + real Postgres        (inherited, minus the deleted areas)
│   ├── permissions/            role × route matrix, route coverage   (ours)
│   ├── e2e/                    Playwright — agent + portal projects  (ours)
│   └── visual/                 Playwright screenshot baselines       (ours)
│
├── charts/taskdesk/            Helm chart — derived from kaneo's, rewritten for one image (05-operations/kubernetes.md)
├── tests/fixtures/             seed datasets: minimal · realistic · hostile
├── deploy/                     compose files, Traefik config, env templates
├── scripts/                    deploy.sh · install.sh · backup.sh · restore.sh · archive-wal.sh · anonymise.ts (tested — tests/anonymise/)
│                               seed.ts · check-inventory.mjs · check-queries.mjs · i18n checks · openapi export
├── i18n/                       locale JSONs, resources.ts, schema.json — stays at the root, as kaneo has it
├── plans/                      motion & interaction design specs (from kaneo)
├── skills/                     agent skills for UI review, animation, etc.
├── docs/                       this documentation corpus
├── .github/
│   ├── pull_request_template.md   the PR checklist (04-engineering/sdlc.md)
│   └── workflows/              ours, written fresh — none of kaneo's fifteen are copied
├── AGENTS.md                   canonical guide for humans and AI agents — ours, never kaneo's
├── LICENSE                     AGPL-3.0
├── THIRD-PARTY-NOTICES.md      kaneo MIT notice and any other attributions
├── compose.yml                 local development stack
├── Dockerfile                  the single multi-stage image; kaneo's apps/api/Dockerfile and
│                               apps/web/Dockerfile are not copied (05-operations/container-image.md)
├── turbo.json  ·  biome.json  ·  pnpm-workspace.yaml
```

There is **no `apps/mcp`**: the MCP server lives in `packages/mcp` and is mounted by
`apps/api` ([mcp-server.md](../03-features/mcp-server.md)). kaneo's inherited `mcp` and
`oauth` routers are a different thing and are removed at the fork
([inherited-features.md](inherited-features.md)).

## Package boundaries

The dependency graph is acyclic and enforced.

```
apps/web  ──► packages/ui, libs, permissions   (locales come from the root i18n/)
apps/api  ──► packages/domain, permissions, plugins-contracts, email, libs, importers
packages/domain        ──► (nothing — pure)
packages/permissions   ──► (nothing — pure; kaneo's depends on better-auth, which is why it is
                            replaced rather than extended)
packages/plugins-contracts ──► (nothing — types only)
packages/ui            ──► (react, Base UI, tailwind only — Radix only per KNOWN-RADIX.md)
```

**Rules:**

- `packages/domain` may not import Drizzle, Hono, or anything with I/O. If a domain
  function needs data, the caller passes it in. This is what makes it testable.
- `packages/ui` may not import from `apps/*` or from any feature package. It knows
  nothing about work items.
- `apps/web` may not import from `apps/api` except through `packages/libs` types.
- Nothing imports `apps/*`.

A `turbo` task plus a dependency-cruiser check enforces this in CI.

## API feature folder convention

Taken from kaneo unchanged. Every feature under `apps/api/src/` looks like:

```
work-item/
├── index.ts          route definitions: createRoute + policy + middleware
├── schema.ts         Zod schemas for params, query, body
├── response.ts       Zod schemas for responses — nothing else reaches the wire
├── policy.ts         the policy each route declares  (mandatory — one of the five kinds in rbac.md)
├── repository.ts     the ONLY place db.select()/insert()/update() on this feature's tables may appear;
│                     exposes forIdentity(identity) scoped queries (multi-tenancy.md). Enforced by check:queries
├── controllers/
│   ├── create-work-item.ts
│   ├── update-work-item.ts
│   └── …             one file per action
└── __tests__/
```

**`policy.ts` is mandatory.** A CI test enumerates the OpenAPI route table and fails if
any route has no policy entry. This is the mechanism that prevents v1's class of
authorization hole. See [Security model](security-model.md).

## Frontend component convention

```
apps/web/src/components/
├── board/            board-specific composites
├── work-item/        detail pane, field editors
├── settings/         settings forms
├── god-mode/         instance admin
├── portal/           customer-portal-only composites
└── common/           cross-feature composites
```

Primitives never live here. If you find yourself writing a `<Button>` in
`components/`, it belongs in `packages/ui`.

## Two bundles, one source

```
vite build --mode agent   →  dist/agent
vite build --mode portal  →  dist/portal
```

- `entry.agent.tsx` mounts the `routes/agent/*` tree.
- `entry.portal.tsx` mounts the `routes/portal/*` tree.
- Both import `packages/ui`. The primitives are shared; the screens are not.
- A build check asserts that no module under `routes/agent/` or `components/god-mode/`
  appears in the portal bundle graph.

The API serves `dist/agent` on the agent host and `dist/portal` on the portal host.

## Naming

| Thing | Convention | Example |
| --- | --- | --- |
| Files | kebab-case | `create-work-item.ts` |
| React components | PascalCase file matching export | `WorkItemHeader.tsx` |
| DB tables | singular snake_case | `work_item`, `sla_policy` |
| DB columns | snake_case | `created_at`, `assignee_id` |
| API paths | plural kebab-case | `/api/work-items/{id}` |
| Capabilities | `resource:action` | `work_item:assign` |
| Env vars | `TASKDESK_*` | `TASKDESK_DATABASE_URL` |
| Feature flags | `feature.<name>` | `feature.cycles` |
| Plugin ids | `<kind>.<name>` | `auth.oidc`, `storage.s3` |

## Related

- [Architecture overview](overview.md)
- [Plugin architecture](plugin-architecture.md)
- [Coding standards](../04-engineering/coding-standards.md)
