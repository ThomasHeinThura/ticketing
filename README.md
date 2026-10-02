# TaskDesk

A self-hostable, multi-tenant **service desk and work management platform**.

Merges the ticketing depth of Jira Service Management — request catalogues, SLAs,
approvals, a customer portal — with the project-management depth of Plane and OpenProject
— cycles, custom fields, time and cost, project hierarchy — delivered with the UI/UX
quality of [kaneo](https://github.com/usekaneo/kaneo), whose codebase is our foundation.

**Target deployment model:** one image for every customer, with identity providers,
storage, notifications, branding, features and roles supplied through runtime configuration.
The planned God Mode surface is not a claim that every setting or feature is implemented;
see the [current development status](docs/07-planning/status.md).

> **Development status:** TaskDesk has substantial application code and is under active
> implementation, integration and acceptance. P0–P7 remain open; this repository does not
> claim that every planned feature is complete or accepted. See the dated
> [development status](docs/07-planning/status.md) and [stage plan](docs/07-planning/phases.md).

---

## Start here

| | |
| --- | --- |
| **Building on this?** | [AGENTS.md](AGENTS.md) — required reading, human or AI |
| **Documentation index** | [docs/README.md](docs/README.md) |
| **Why it exists** | [docs/00-overview/vision.md](docs/00-overview/vision.md) |
| **How it is built** | [docs/01-architecture/overview.md](docs/01-architecture/overview.md) |
| **How we work** | [docs/04-engineering/sdlc.md](docs/04-engineering/sdlc.md) |
| **What is next** | [docs/07-planning/phases.md](docs/07-planning/phases.md) → [accelerated-delivery-plan.md](docs/07-planning/accelerated-delivery-plan.md) for dates |
| **What shipped** | [CHANGELOG.md](CHANGELOG.md) |

---

## Target architecture

```
Traefik  ──►  ticket.<domain>   agent workspace
         ──►  portal.<domain>   customer portal      } one container
         ──►  files.<domain>    attachments

TaskDesk container   Hono API + two React bundles + in-process scheduled jobs
PostgreSQL 18        all primary data, including runtime configuration
Valkey 9             cache, pub/sub, rate limits          (optional)
SeaweedFS / S3       attachment bytes                     (pluggable)
Microsoft Entra      OIDC + SCIM — or any OIDC issuer     (plugin-configured)
```

The target uses one TypeScript backend in place of v1's .NET + Node + Go services.
Background work is designed to run in-process with leases for replica safety. See the
[development status](docs/07-planning/status.md) for implementation and acceptance evidence.

Full picture: [docs/01-architecture/overview.md](docs/01-architecture/overview.md)

---

## Development and deployment

For source setup and development commands, follow [AGENTS.md](AGENTS.md) and the
[engineering workflow](docs/04-engineering/agent-workflow.md). The documented local
deployment path is in [deployment.md](docs/05-operations/deployment.md). A local deployment
or a healthy runtime proves only the setup and behavior actually exercised; it does not
mean that every feature or stage is accepted.

The public one-line installer is planned but is not available. Its intended trust model and
offline alternative are documented in
[one-line-install.md](docs/05-operations/one-line-install.md). Kubernetes and marketplace
readiness remain subject to their stage and deployment gates; see the
[stage plan](docs/07-planning/phases.md).

## Stack

| | |
| --- | --- |
| Backend | Hono · Drizzle · PostgreSQL 18 · better-auth · Zod + OpenAPI 3.2 |
| Frontend | React 19 · TanStack Router & Query · Tailwind v4 · Base UI (`@taskdesk/ui`) · dnd-kit · Tiptap |
| Tooling | pnpm · Turborepo · Biome · Vitest · Playwright · Storybook |
| Runtime | Node 24 · Docker · Traefik |

---

## The five rules

1. **UI/UX is kaneo's.** No bespoke primitives — everything from `packages/ui`.
2. **Nothing is hardcoded per customer.** If it varies by deployment, it is God Mode.
3. **Every route declares its permission.** No policy, no build.
4. **Every screen has a URL.** No state reachable only by clicking.
5. **Ship narrow and finished.** A stage is claimed complete only after its gates pass;
   independent work may proceed in parallel.

These exist because v1 was feature-rich and unusable, and because it shipped eleven
authorization holes past a green test suite. Both failures were structural, and these are
the structural answers.

---

## Licence

**AGPL-3.0.**

Built on kaneo (MIT) — attribution retained in `THIRD-PARTY-NOTICES.md`. Design
inspiration from [Plane](https://github.com/makeplane/plane) (AGPL-3.0) and
[OpenProject](https://github.com/opf/openproject) (GPL-3.0); ideas, not code.

Details:
[docs/00-overview/licensing-and-attribution.md](docs/00-overview/licensing-and-attribution.md)
