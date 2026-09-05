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
│   └── site/                   Next.js + Fumadocs documentation website
│
├── packages/
│   ├── ui/                     THE design system. Only source of primitives.
│   │   ├── src/components/     button, dialog, table, sidebar, … (60+)
│   │   ├── src/styles/         tokens.css, theme.css, motion.css
│   │   └── .storybook/
│   ├── domain/                 pure business logic, zero I/O
│   │   └── src/{sla,workflow,approvals,assignment,calendar,ranking}/
│   ├── permissions/            capabilities, roles, policy registry, evaluator
│   ├── plugins-contracts/      the interfaces every plugin implements
│   ├── libs/                   typed Hono client, shared URL helpers
│   ├── email/                  React Email templates + sender
│   ├── mcp/                    MCP server (agent access + import tooling)
│   ├── importers/              azure-devops · plane · jira · csv
│   ├── i18n/                   locale resources, schema, check scripts
│   └── typescript-config/      shared tsconfig bases
│
├── tests/
│   ├── api/                    unit tests for API modules
│   ├── api-integration/        Testcontainers + real Postgres
│   ├── permissions/            role × route matrix, route coverage
│   ├── e2e/                    Playwright — agent + portal projects
│   └── visual/                 Playwright screenshot baselines
│
├── charts/taskdesk/            Helm chart (secondary deployment path)
├── deploy/                     compose files, Traefik config, env templates
├── scripts/                    deploy.sh, seed, i18n checks, openapi export
├── plans/                      motion & interaction design specs (from kaneo)
├── skills/                     agent skills for UI review, animation, etc.
├── docs/                       this documentation corpus
├── AGENTS.md                   canonical guide for humans and AI agents
├── LICENSE                     AGPL-3.0
├── THIRD-PARTY-NOTICES.md      kaneo MIT notice and any other attributions
├── compose.yml                 local development stack
├── Dockerfile                  single multi-stage image
├── turbo.json  ·  biome.json  ·  pnpm-workspace.yaml
```

## Package boundaries

The dependency graph is acyclic and enforced.

```
apps/web  ──► packages/ui, libs, permissions, i18n
apps/api  ──► packages/domain, permissions, plugins-contracts, email, libs, importers
packages/domain        ──► (nothing — pure)
packages/permissions   ──► (nothing — pure)
packages/plugins-contracts ──► (nothing — types only)
packages/ui            ──► (react, radix, tailwind only)
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
├── policy.ts         the capability each route requires  (mandatory)
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
