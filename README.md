# TaskDesk

A self-hostable, multi-tenant **service desk and work management platform**.

Merges the ticketing depth of Jira Service Management — request catalogues, SLAs,
approvals, a customer portal — with the project-management depth of Plane and OpenProject
— cycles, custom fields, time and cost, project hierarchy — delivered with the UI/UX
quality of [kaneo](https://github.com/usekaneo/kaneo), whose codebase is our foundation.

**One image. Any customer.** Identity providers, storage, notifications, branding,
features and roles are configured at runtime through a God Mode administration surface —
never compiled in, never in an environment variable.

> **Status: planning complete, implementation not started.**
> See [docs/07-planning/status.md](docs/07-planning/status.md).

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

## Architecture at a glance

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

**One backend**, TypeScript end to end — replacing v1's .NET + Node + Go trio.
Background work runs in-process, leased so it is safe across replicas.

Full picture: [docs/01-architecture/overview.md](docs/01-architecture/overview.md)

---

## Install

> **Planned — not available until P0 completes.** There is no application code in this
> repository yet, `get.taskdesk.dev` does not resolve, and `scripts/deploy.sh` does not
> exist. Everything in this section, and every command elsewhere in this README, describes
> what P0 builds. Live progress: [docs/07-planning/status.md](docs/07-planning/status.md).

```bash
curl -fsSL https://get.taskdesk.dev | bash
```

One command, on a machine with nothing but a shell and outbound HTTPS. It wraps the same
idempotent `scripts/deploy.sh` documented in
[docs/05-operations/deployment.md](docs/05-operations/deployment.md) — see
[docs/05-operations/one-line-install.md](docs/05-operations/one-line-install.md) for what
it does, its trust model, and the offline alternative. Runs anywhere: a laptop, a bare
host, Kubernetes via the Helm chart, or — deferred, P7 at the earliest —
[AWS Marketplace](docs/05-operations/aws-marketplace.md).

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
5. **Ship narrow and finished.** A stage completes before the next begins.

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
