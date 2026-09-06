# TaskDesk v2 — Documentation

> Working product name: **TaskDesk**. Repository: `Ticketing.v2`.
> This is a **greenfield build**, not a migration of v1. Importing data from other
> systems is one feature among many, not the purpose of the project.

## Read this first

| If you are… | Start here |
| --- | --- |
| New to the project | [Vision](00-overview/vision.md) → [Architecture overview](01-architecture/overview.md) |
| About to write code | [SDLC](04-engineering/sdlc.md) → [Coding standards](04-engineering/coding-standards.md) → [Definition of Done](04-engineering/definition-of-done.md) |
| An AI agent picking up a task | [Agent workflow](04-engineering/agent-workflow.md) — **required reading** |
| Building UI | [Design system](02-design/design-system.md) → [UX quality gates](02-design/ux-quality-gates.md) |
| Adding a feature | [Feature index](03-features/README.md) |
| Deploying | [Deployment](05-operations/deployment.md) → [One-line install](05-operations/one-line-install.md) → [Configuration reference](05-operations/configuration-reference.md) |
| Wondering "why is it like this?" | [ADR index](01-architecture/adr/README.md) and [Decision log](07-planning/decision-log.md) |
| Releasing | [Release plan](07-planning/release-plan.md) → [CI/CD](04-engineering/ci-cd.md) → [CHANGELOG](../CHANGELOG.md) |

## The one-paragraph summary

TaskDesk is a self-hostable, multi-tenant **service desk and work management platform**.
It merges the ticketing depth of Jira Service Management (request catalogues, SLAs,
approvals, customer portal) with the project-management depth of Plane and OpenProject
(cycles, custom fields, time & cost, hierarchies) — delivered with the UI/UX quality of
[kaneo](https://github.com/usekaneo/kaneo), whose codebase is our foundation.

It ships as **one image**. Every tenant-specific behaviour — identity providers, branding,
feature toggles, roles, workflows, SLAs, notification channels, storage backends — is
**configured at runtime through God Mode**, never compiled in. See
[Plugin architecture](01-architecture/plugin-architecture.md).

## Documentation map

```
docs/
├── 00-overview/        Why this exists, what it is, what we may legally reuse
├── 01-architecture/    How it is built  (+ adr/ — why it is built that way)
├── 02-design/          Design system, tokens, motion, IA, UX gates
├── 03-features/        One spec per feature — the product surface
├── 04-engineering/     SDLC, agent workflow, testing, CI/CD, standards
├── 05-operations/      Deploy, configure, run, back up, scale
├── 06-data-import/     Importing from Azure DevOps, Plane, Jira, CSV
├── 07-planning/        Roadmap, stages, risks, decisions, live status
└── 08-docs-site/       The public documentation website
```

## Non-negotiables

These are the rules that, if broken, mean v2 repeats v1's failure. They are enforced in
CI where possible and by review where not. Full list in
[Product principles](00-overview/product-principles.md) and
[UX quality gates](02-design/ux-quality-gates.md).

1. **UI/UX is kaneo's.** No bespoke primitives. Everything comes from `packages/ui`.
2. **Nothing is hardcoded per customer.** If it varies by deployment, it lives in God Mode.
3. **Every route declares its permission.** A route without a declared policy fails the build.
4. **Every screen has a URL.** No state reachable only by clicking.
5. **Ship narrow and finished, not wide and half-built.** v1 died of breadth.

## Status

Live status, current stage and open work: [07-planning/status.md](07-planning/status.md).
