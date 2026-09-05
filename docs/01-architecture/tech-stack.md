# Tech stack

Inherited from kaneo unless noted. Versions are the floor, not a ceiling — keep current.

## Runtime and tooling

| Concern | Choice | Notes |
| --- | --- | --- |
| Runtime | **Node 24+** | kaneo's floor |
| Language | **TypeScript 7**, strict | Shared config in `packages/typescript-config` |
| Package manager | **pnpm 10** | Workspaces |
| Task orchestration | **Turborepo 2** | `build`, `dev`, `lint`, `typecheck`, `test` |
| Lint + format | **Biome 2** | Tabs, organised imports. Replaces ESLint + Prettier |
| Custom lint rules | Biome plugins + bespoke node scripts | UX gates; see [UX quality gates](../02-design/ux-quality-gates.md) |
| Commits | **commitlint** conventional + **husky** | |
| Releases | **semantic-release** | |

## Backend

| Concern | Choice | Notes |
| --- | --- | --- |
| HTTP framework | **Hono 4** | `@hono/node-server` |
| API contract | **@hono/zod-openapi**, targeting **OpenAPI 3.2** | Every route has a schema; spec published at `/openapi.json` |
| Validation | **Zod 4** | Single source for request/response schemas and OpenAPI |
| ORM | **Drizzle 0.45** | `drizzle-kit` migrations, forward-only |
| Database | **PostgreSQL 18** | Only store for primary data. See below — bumped from 16 |
| Auth | **better-auth 1.6** | Organisation, MFA/TOTP, magic link, email OTP, API keys, generic OAuth/OIDC, admin/impersonation plugins |
| IDs | **CUID2** | Sortable-ish, URL-safe, non-enumerable |
| WebSocket | **@hono/node-ws** | In-memory or Valkey pub/sub adapter |
| Cache / pub-sub | **Valkey 9** (Redis-compatible) via **ioredis** | Optional; degrades to in-memory |
| Object storage | **@aws-sdk/client-s3** — a plain S3-API client, no vendor SDK | **SeaweedFS** for the shipped local/self-hosted default; any real S3 in production. **Not MinIO** — see below |
| Scheduling | **croner** + `job_lease` table | In-process, replica-safe |
| Email | **nodemailer** via `packages/email` | React Email templates |
| Errors | **Sentry** (optional) | Configured in God Mode, not env-only |
| Tracing | **OpenTelemetry** | Optional exporter; v1 never got this and regretted it |
| Logging | **Pino** + `pino-http` | Structured JSON with `traceId`. Not in kaneo — added |
| Metrics | **prom-client** | `/metrics`, bearer-guarded. Not in kaneo — added |

## Frontend

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | **React 19** | React Compiler enabled |
| Bundler | **Vite 8** (kaneo's current; was listed as 5 in error) | Two entries: `entry.agent.tsx`, `entry.portal.tsx` |
| Routing | **TanStack Router** | File-based, typed, search-param schemas |
| Server state | **TanStack Query 5** | The only place server data lives |
| Client state | **Zustand** | UI-only state: selection, preferences, panel sizes |
| Styling | **Tailwind CSS v4** | `@tailwindcss/vite`, CSS variables |
| Primitives | **Radix UI**, wrapped in `packages/ui` | shadcn `new-york`, zinc base. kaneo has begun adding **Base UI** (`@base-ui/react`) alongside Radix, following shadcn/ui's July 2026 default switch — see below |
| Variants | **class-variance-authority** | |
| Icons | **lucide-react** | The only icon source |
| Fonts | **Geist Variable** / **Geist Mono Variable** | |
| Motion | **Framer Motion** | Tokens per kaneo's `plans/001-motion-tokens-and-easing.md` |
| Drag & drop | **dnd-kit** | Boards, backlog ranking, column reorder |
| Forms | **React Hook Form** + Zod resolver | Client schema is the server schema |
| Rich text | **Tiptap 3** | Descriptions, comments, KB articles |
| Charts | **Recharts** | Reports and dashboards |
| Tables | **TanStack Table** | Table/spreadsheet view |
| Dates | **date-fns** + **@internationalized/date** | Calendar primitives need the latter |
| i18n | kaneo's `i18n/` structure | **18** locales inherited (not 22); `en-US` authoritative — [i18n.md](i18n.md) |

## Testing

| Layer | Tool | Where |
| --- | --- | --- |
| Unit | **Vitest** | Co-located `*.test.ts`; domain package especially |
| API integration | **Vitest** + **Testcontainers** | `tests/api-integration/`, real Postgres |
| Permission matrix | **Vitest** | `tests/permissions/` — every role × every route |
| Route coverage | **Vitest** | Fails if any OpenAPI route lacks a declared policy |
| Component | **Vitest** + Testing Library | Co-located `*.test.tsx` |
| Visual regression | **Playwright** screenshots | `tests/visual/` |
| E2E | **Playwright** | `tests/e2e/`, agent and portal projects |
| Accessibility | **@axe-core/playwright** | Runs inside E2E; zero critical/serious |
| Component catalogue | **Storybook 10** (ESM-only; 8 was two majors stale) | Required for every `packages/ui` primitive. Not in kaneo — added |
| Load | **k6** | Baseline before each release |

Detail: [Testing strategy](../04-engineering/testing-strategy.md).

## Infrastructure

| Concern | Choice |
| --- | --- |
| Container | Multi-stage Dockerfile, Node 24 Alpine, single image |
| Orchestration | Docker Compose + **Traefik** (primary); Helm chart (secondary) |
| Reverse proxy | **Traefik** — TLS, routing by host, security headers |
| Identity (optional) | **Keycloak 26** — a configurable OIDC provider, not a hard dependency |
| Object storage | **SeaweedFS** (default self-hosted) or any real S3 — see below |
| Mail (dev) | **Mailpit** |
| CI | **GitHub Actions** — decided 2026-09-05: the repository is on GitHub, and keyless cosign signing and `semantic-release`'s GitHub integration both assume it. v1's Azure Pipelines are not carried over |
| Registry | Docker Hub / ACR |

## Why MinIO is not the default (2026-09-05)

MinIO Community Edition, the obvious original choice for a self-hosted S3-compatible
default, effectively ended as an open-source project through 2025–2026: its admin
Console was stripped from the AGPL build in May 2025, image publishing stopped in
October 2025, the project entered "maintenance mode" in December 2025, and the
`minio/minio` repository was archived in April 2026 — the functionality removed is now
sold only as the paid "AIStor" product. Nothing about our own architecture depended on
MinIO specifically: `storage.s3` ([plugin architecture](plugin-architecture.md)) is
already a plain S3-API client, not a MinIO client, so this is a reference-implementation
swap, not a design change.

**SeaweedFS** (Apache-2.0, actively maintained, most production-ready of the pure
open alternatives surveyed) ships as the default self-hosted backend instead. **Garage**
(AGPL-3.0, same licence family as this product, minimal footprint) is documented as the
lightweight alternative for small single-tenant installs. Real AWS S3 remains the
recommended production choice for anyone who wants it, unaffected either way, because
`storage.s3` speaks the S3 API and nothing vendor-specific.

## Base UI, alongside Radix (2026-09-05)

kaneo has begun depending on `@base-ui/react` alongside its existing Radix primitives,
following shadcn/ui's July 2026 switch to Base UI as the default for new projects (Base
UI is production-stable, MUI-backed, API-compatible with the Radix components it
replaces). Since `packages/ui` is taken from kaneo **once**, at P0 step 1
([ADR 0001](adr/0001-kaneo-as-foundation.md)), whichever mix of Radix and Base UI kaneo
is using *at that moment* is what we inherit — this is not a separate decision to make
now, and no action is needed ahead of that step beyond knowing it is coming.

## Added to kaneo's stack — the honest P0 tooling list

kaneo does **not** ship these; every one is installed, configured and wired into CI during
P0. This is the input to the P0 estimate, not a footnote.

| Added | Serves |
| --- | --- |
| **Storybook 10** | `G7` story coverage, `G8` visual baselines |
| **Playwright** + `@axe-core/playwright` + `vitest-axe` | E2E, security, a11y (`G4`), reduced-motion (`G9`), viewport projects |
| **Testcontainers** | Real-Postgres integration tests |
| **dependency-cruiser** | Package boundaries and cycles (`check:deps`) |
| **TanStack Table** | Table layout, tier 2 reports |
| **Recharts** | Tier 1/3 reports, dashboards — wrapped as `chart` / `chart-table` primitives with a token colour ramp so `G3` applies |
| **Pino**, **prom-client** | Logging and metrics ([observability.md](observability.md)) |
| **Redocly CLI** + **oasdiff** | OpenAPI 3.1 validity and breaking-change diff in CI |
| **k6** | Load baselines |
| **cosign** | Image and release-archive signing |
| **@vitest/coverage-v8** (present in kaneo, unused) | The 90 % `packages/domain` threshold, enforced per package |
| A small AST script (`check:queries`) | The "no `db.select()` outside `repository.ts`" rule — Biome cannot express it |

Also inherited and to be **consolidated**, per the [inherited-features register](../07-planning/review-2026-09-05.md):
`valibot` → Zod only; `nanostores` → Zustand only; Radix + Base UI → one primitive library,
decided at `packages/ui` extraction.

## Deliberate omissions

| Rejected | Instead |
| --- | --- |
| Next.js for the app | Vite SPA. No SSR need; two bundles is simpler in Vite |
| MobX (Plane's choice) | TanStack Query + Zustand |
| Redux | Same |
| GraphQL | REST + OpenAPI + typed client |
| Prisma | Drizzle — lighter, SQL-transparent, kaneo already uses it |
| ESLint + Prettier | Biome — one tool, much faster |
| NextAuth | better-auth — richer plugin surface, kaneo already uses it |
| Kafka / RabbitMQ | Postgres outbox + Valkey pub/sub |
| Elasticsearch | Postgres full-text first; revisit only if measured to be insufficient |

Note: the docs site (`apps/site`) *does* use **Next.js + Fumadocs**, following kaneo.
That is a separate deployable and does not affect the app.

## Version policy

- Patch and minor: Renovate opens PRs weekly, merged if CI is green.
- Major: needs a [decision log](../07-planning/decision-log.md) entry.
- No new runtime dependency without saying what it replaces or what it makes possible.
- **Security patches are never queued behind a feature.** A `pnpm audit` high/critical or a
  Trivy container-scan high/critical (both already gates in [Security
  model](security-model.md)) is fixed in the next release, full stop — it does not wait
  for the sprint it happened to land in.
- Reviewed 2026-09-05 against current upstream status, confirming or correcting every
  pin above: **Node 24** remains correct — it is Active LTS through April 2028, well past
  Node 22's April 2027 EOL, and Node 26 does not become Active LTS until ~October 2026, so
  it stays a "Current"-only line for now, not a production pin. **Traefik v3** (currently
  3.7.x) and **Keycloak 26** (currently 26.7.x) are both still current — no major bump
  landed for either. **Valkey** and **PostgreSQL** did need bumping, and are corrected
  above: Valkey 9 shipped October 2025 (currently 9.1.x); PostgreSQL 18 shipped September
  2025 and is now the recommended default over 16, adding — among other things — native
  OAuth authentication, SCRAM enforcement over md5, TLS 1.3 cipher control and
  checksums-on-by-default, all directly relevant to [Security model](security-model.md).
  PostgreSQL 19 is in beta as of this review and is not yet a production target.
