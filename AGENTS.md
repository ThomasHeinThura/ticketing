# AGENTS.md

**Canonical guide for anyone — human or AI — working in this repository.**
Read this first. Then read what it points you at.

---

## What this is

**TaskDesk v2** — a self-hostable, multi-tenant service desk and work management platform.

Built on [kaneo](https://github.com/usekaneo/kaneo) (MIT), which was taken **once** as a
foundation and is now ours. There is no upstream relationship. Design inspiration from
Plane, OpenProject and Jira Service Management. Domain knowledge from TaskDesk v1.

Licensed **AGPL-3.0**.

## Read in this order

1. This file
2. [`docs/04-engineering/agent-workflow.md`](docs/04-engineering/agent-workflow.md) —
   **required** if you are an AI agent
3. [`docs/04-engineering/sdlc.md`](docs/04-engineering/sdlc.md) — the nine stages
4. [`docs/04-engineering/coding-standards.md`](docs/04-engineering/coding-standards.md)
5. The feature spec for what you are building, in
   [`docs/03-features/`](docs/03-features/README.md)
6. Any [ADR](docs/01-architecture/adr/README.md) that spec references

Full index: [`docs/README.md`](docs/README.md)

---

## The five rules

Everything else follows from these.

### 1 · UI/UX is kaneo's

No bespoke primitives. Everything comes from `packages/ui`. If a primitive is missing, add
it *there*, with a Storybook story and a test. Never inline one.

Unsure how something should look? Open `../kaneo` and look. It is the specification.

### 2 · Nothing is hardcoded per customer

We ship **one image to every customer**. Identity providers, storage, notifications,
branding, features, roles — all runtime configuration in God Mode, stored in the database.

Environment variables are for bootstrap only. There are eight of them. If you are about to
add a ninth, or write `if (customer === …)`, stop and add a plugin or a feature flag.

### 3 · Every route declares its permission

A route without a policy entry **fails the build**. This is not ceremony — v1 shipped
eleven authorization holes past a green test suite, and every one was an omission.

### 4 · Every screen has a URL

Filters, tabs, selections, open panels — all URL state. Registered in `lib/routes.ts`,
verified by a round-trip test.

### 5 · Ship narrow and finished

A phase completes before the next starts. v1 died of twenty-five screens at sixty per cent.

---

## Layout

```
apps/api      Hono + Drizzle + better-auth. The only backend.
apps/web      React 19 + TanStack. Two entries: agent, portal. One source.
apps/site     Next.js + Fumadocs. The documentation website.

packages/ui                 THE design system. Only source of primitives.
packages/domain             SLA, workflow, approvals, assignment. Pure, no I/O.
packages/permissions        Capabilities, roles, policy registry.
packages/plugins-contracts  Interfaces every plugin implements.
packages/libs               Typed Hono client.
packages/importers          Azure DevOps, Plane, Jira, CSV.

tests/        api · api-integration · permissions · e2e · visual
docs/         Read it. It is the memory this project has.
```

Detail: [`docs/01-architecture/monorepo-layout.md`](docs/01-architecture/monorepo-layout.md)

---

## Commands

```bash
pnpm install
pnpm dev                   # everything
pnpm dev --filter api
pnpm dev --filter web

pnpm lint                  # biome
pnpm typecheck
pnpm test                  # unit + component
pnpm test:integration      # Testcontainers Postgres
pnpm test:permissions      # route coverage + role × route matrix
pnpm test:e2e
pnpm test:all              # what CI runs

pnpm check:tokens          # no literal colours; contrast passes
pnpm check:ui              # no bespoke primitives
pnpm check:deps            # no cycles, no boundary violations

pnpm seed minimal | realistic | hostile
scripts/deploy.sh local
```

---

## Before you say "done"

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration      # if the API changed
pnpm test:permissions      # if a route changed
pnpm test:e2e -- <scope>   # if the UI changed
```

**And then open the screen and use it.**

v1's handover was blunt about this and it is worth repeating: *verify before you believe.*
Four of its worst defects were invisible to a green test suite.

Full checklist:
[`docs/04-engineering/definition-of-done.md`](docs/04-engineering/definition-of-done.md)

---

## Do not

1. Invent a UI primitive outside `packages/ui`
2. Write a literal colour or arbitrary spacing value
3. Add a route without a policy
4. Add a dependency without asking
5. Disable a test to make a build pass — **ever**
6. Waive a quality gate — only Thomas may
7. Approve your own design review — agents may not
8. Refactor beyond the task
9. Paste code from an unlicensed source
10. Keep trying after three failed attempts — write down what you tried and ask

---

## Licensing

| Source | Licence | What we take |
| --- | --- | --- |
| kaneo | MIT | **Code.** Keep the copyright headers |
| Plane | AGPL-3.0 | Ideas. Code is legal but we choose not to |
| OpenProject | GPL-3.0 | Ideas |
| TaskDesk v1 | Ours | Domain logic, reimplemented in TypeScript |

Never paste code from anywhere else without checking the licence and recording it in
`THIRD-PARTY-NOTICES.md`.

Detail:
[`docs/00-overview/licensing-and-attribution.md`](docs/00-overview/licensing-and-attribution.md)

---

## Where we are

[`docs/07-planning/status.md`](docs/07-planning/status.md) — updated at the end of every
session. Read it before starting; update it before stopping.

---

## Why the rules feel strict

Because most of the code here is written by AI agents with no memory between sessions, and
because v1 failed for reasons that discipline alone did not prevent.

Given a fixed vocabulary and a build that rejects invention, agent output is remarkably
consistent. Given freedom, it is remarkably inconsistent.

The constraints are not distrust. They are what makes a team of one human and three agents
able to produce one coherent product.
