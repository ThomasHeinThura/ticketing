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
3. [`CLAUDE.md`](CLAUDE.md) — **required if you are Claude**: the working mode, the model
   tiers, which subagent patterns work in this repository and which stall, and how Thomas
   wants reports written
4. [`docs/04-engineering/sdlc.md`](docs/04-engineering/sdlc.md) — the nine steps
5. [`docs/04-engineering/coding-standards.md`](docs/04-engineering/coding-standards.md)
6. The feature spec for what you are building, in
   [`docs/03-features/`](docs/03-features/README.md)
7. Any [ADR](docs/01-architecture/adr/README.md) that spec references

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

Environment variables are for bootstrap only — five required, a handful of optional
operational switches, all listed in
[`docs/05-operations/configuration-reference.md`](docs/05-operations/configuration-reference.md)
and nowhere else. `check:env` is the gate that makes this enforceable, and it is **IN OPEN
PR #19** — `main` carries no workflow files at all, so nothing fails a build over a stray
`process.env` read today and the rule holds by discipline alone. If you are
about to add one, or write `if (customer === …)`, stop and add
a plugin or a feature flag.

### 3 · Every route declares its permission

A route without a policy entry **must fail the build**. This is not ceremony — v1 shipped
eleven authorization holes past a green test suite, and every one was an omission.

**Stated as the rule, not as today's behaviour.** The registry and coverage gate are **IN
OPEN PR #21**, the CI job that runs them is **IN OPEN PR #19**, and neither is on `main`.
Until both land the rule is enforced by review, which is precisely what ADR 0010 rejected.
Write policies as though the gate were live, because it is about to be.

### 4 · Every screen has a URL

Filters, tabs, selections, open panels — all URL state. Registered in `lib/routes.ts`,
verified by a round-trip test.

### 5 · Ship narrow and finished

A stage completes before the next starts. v1 died of twenty-five screens at sixty per cent.

---

## Layout

```
apps/api      Hono + Drizzle + better-auth. The only backend.
apps/web      React 19 + TanStack. Two entries: agent, portal. One source.
apps/site     The documentation website — stack pending Thomas's decision (docs/08-docs-site/plan.md)

packages/ui                 THE design system. Only source of primitives.      NOT YET (#9)
packages/domain             SLA, workflow, approvals, assignment. Pure, no I/O.  NOT YET
packages/permissions        Capabilities, roles, policy registry.                ON MAIN (registry is in #21)
packages/plugins-contracts  Interfaces every plugin implements.                  NOT YET
packages/libs               Typed Hono client.                                   ON MAIN
packages/importers          Azure DevOps, Plane, Jira, CSV.                      NOT YET
packages/email              Transactional email.                                 ON MAIN
packages/mcp                MCP client surface.                                  ON MAIN

Dockerfile · compose.yml · deploy/ · charts/taskdesk/ · scripts/deploy.sh       ON MAIN (#20)

tests/        api · api-integration · permissions · e2e · visual
docs/         Read it. It is the memory this project has.
```

This is the target shape with today's state marked. Four `packages/*` entries do not exist
yet — do not import from them, and do not take their absence as licence to put their
contents somewhere else.

Detail: [`docs/01-architecture/monorepo-layout.md`](docs/01-architecture/monorepo-layout.md)

---

## Commands

> **Some of these run today; most do not yet.** The repository has a `package.json`, a
> `pnpm-lock.yaml`, `apps/api`, `apps/web` and `packages/*` — that changed when #5 merged.
> [ci-cd.md](docs/04-engineering/ci-cd.md) remains the single list of what CI runs.
>
> The table below says what is true **on `main`** right now. A command marked *open PR* is
> real code on an unmerged branch: do not describe it as available, and do not re-implement
> it. A command marked *not yet* has nothing behind it, and a "no such script" failure is
> the expected state rather than a broken checkout.
>
> | Command | State |
> | --- | --- |
> | `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck` | **ON MAIN** |
> | `pnpm i18n:check`, `i18n:check:fix`, `i18n:report`, `i18n:report:fix`, `i18n:schema` | **ON MAIN** — five scripts this document never listed |
> | `pnpm test` (unit + component) | **ON MAIN** |
> | `pnpm test:integration` | **ON MAIN** — a Postgres service container, not yet Testcontainers |
> | `scripts/deploy.sh local` | **ON MAIN** — landed with #11's deployment slice (#20) |
> | `pnpm test:all`, `pnpm test:permissions` | **IN OPEN PR #19** |
> | `pnpm check:env`, `check:vocabulary`, `check:reviews`, `check:skips`, `check:i18n`, `check:openapi` | **IN OPEN PR #19** |
> | `pnpm test:e2e`, `pnpm seed` | **not yet** |
> | `pnpm check:tokens`, `check:ui`, `check:deps` | **not yet** — they assert over `packages/ui` and `packages/domain`, which #9 creates |
> | `pnpm check:queries`, `check:inventory`, `check:bundle-purity` | **not yet** |
>
> **There are no workflow files on `main`** — `.github/` holds only
> `pull_request_template.md`. So nothing runs automatically on a push to `main` today; CI
> exists only on #19's branch, where it runs against that pull request. Any sentence in this
> repository saying a gate "fails the build" describes the intended rule, not current
> behaviour, until #19 merges.
>
> **When a command fails, the cause decides the response.** `turbo: not found` or a missing
> `node_modules` means an uninstalled tree — run `pnpm install`. "No such script" for
> something marked *IN OPEN PR* or *not yet* is the expected state. "No such script" for
> anything marked **ON MAIN** is a real problem: say so rather than working around it.
>
> Keeping this table honest matters more than it looks. An agent told "none of this runs"
> will scaffold a second copy of something that already exists; an agent told a command is
> available when it only exists on a branch will report a gate as passing that never ran.

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
pnpm test:all              # alias for every CI check — ci-cd.md is the single list

pnpm check:tokens          # no literal colours; contrast passes
pnpm check:ui              # no bespoke primitives
pnpm check:deps            # no cycles, no boundary violations
pnpm check:queries         # no db.select() outside repository.ts
pnpm check:inventory       # screen inventory ↔ generated routes
pnpm check:reviews         # a spec in build has an empty review section
pnpm check:env             # no process.env read outside configuration-reference.md
pnpm check:vocabulary      # tables/capabilities/events/jobs exist in their authority doc
pnpm check:skips           # no .skip / .only / describe.skip
pnpm check:bundle-purity   # no agent module in the portal bundle

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

**And then open the screen and use it** — and list every screen you opened in the pull
request's `## Screens opened` section (route, viewport, what you clicked, screenshot).

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
11. Name a table, column, capability, feature flag, event key or job that is not in its
    single authoritative document — `data-model.md`, `rbac.md`, `plugin-architecture.md`,
    `events.md`, `background-jobs.md`. Add it there first, in the same change
12. Delete anything without a **pending action** — every user-initiated deletion, from
    every client, returns `202` and waits for the requesting human's approval in the UI
    (`docs/01-architecture/pending-actions.md`). No `confirm: true`, no client-side dialog
    as the control
13. Invent an MCP permission (`mcp:*`), a SCIM-only tenancy rule, or any path by which an
    identity provider, group or SCIM attribute grants `instance:admin` or `sees_all`
14. Keep, flag or "leave for later" an inherited kaneo integration router (public boards,
    GitHub, Gitea, Slack, Discord, Telegram, generic webhook) — they are **deleted at fork**
    (`docs/01-architecture/inherited-features.md`); the plugin contracts are the way back
15. Start building a feature while its section in `docs/07-planning/reviews/2026-09-05/`
    is non-empty
16. Commit, push or merge anything outside the agreed working mode. **A report is not
    approval.** The working mode *is* the standing approval, and it is:
    **branch → commit → pull request → Thomas approves → merge.** So: create a branch,
    commit your work to it, push it, open a pull request describing what you did — that is
    the normal end of a task. **Only Thomas merges to `main`**, and only Thomas approves
    anything outside this path (committing straight to `main`, force-pushing, rewriting
    history, deleting a branch someone else may be using). Never leave finished work
    uncommitted on a local machine — that is how eighty-three files once sat on one laptop
    ([decision log](docs/07-planning/decision-log.md), 2026-09-06)
17. Guess at behaviour — if the spec does not say, ask, and then write the answer into the
    spec
18. Claim something works without running it — every screen you touched is opened and
    listed in the pull request's `## Screens opened` section

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
