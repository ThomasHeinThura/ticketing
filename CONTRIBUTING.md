# Contributing

Thanks for helping with TaskDesk. This guide covers setup, checks and how to open a pull request.

## Set up

You need Node 24 or newer, pnpm 10 and a PostgreSQL database.

```sh
pnpm install
pnpm dev
```

The API reads its settings from environment variables. `apps/api/.env.test.example` shows the names used by tests, and `deploy/.env.example` lists the production set. Point `TASKDESK_DATABASE_URL` at a scratch database. Integration tests reset the database they run against, so never use one that holds real data.

The code is a pnpm and Turborepo monorepo:

| Path | Contents |
| --- | --- |
| `apps/api` | Hono API, database schema and migrations |
| `apps/web` | Agent app and customer portal (React) |
| `packages/ui` | Shared component library |
| `packages/domain`, `packages/permissions` | Shared rules, roles and capabilities |
| `packages/mcp` | MCP server |
| `tests` | Cross-package tests |

## Conventions

- Build screens from the components in `packages/ui`, with the design tokens for colour, spacing and type. Do not add native `<button>`, `<input>`, `<select>` or `<textarea>` elements in `apps/web`. `pnpm check:ui:raw-elements` enforces this.
- Every API route declares an access policy, and every URL state is registered in `apps/web/src/lib/routes.ts`.
- Add user-facing text to `i18n/en-US.json` and run `pnpm i18n:check`.
- Environment variables are for bootstrap settings only. Anything else is configured at runtime in God Mode. New variable names must be listed in `docs/technical/configuration.md`.
- Do not add dependencies without discussing them first.

## Checks

Run these before you push:

```sh
pnpm lint:ci
pnpm typecheck
pnpm test
pnpm test:permissions
pnpm check:route-policy
pnpm test:contract
```

Changes that touch the database also need `pnpm test:integration` against a fresh test database. UI changes need `pnpm check:ui:raw-elements` and `pnpm check:tokens`, and a look in a real browser. `docs/testing.md` lists every gate. Do not weaken, skip or exempt a gate to get a change through.

A schema change needs a Drizzle migration. Generate it with `pnpm --filter @taskdesk/api db:generate` and do not edit snapshots by hand. An API change needs `pnpm openapi:write` so the committed OpenAPI document matches.

## Branches, commits and pull requests

1. Branch from `main`, with a name like `feat/short-name` or `fix/short-name`.
2. Write [Conventional Commits](https://www.conventionalcommits.org/) with a lowercase subject, for example `fix: keep the board filter after reload`. A commit hook runs commitlint and Biome.
3. Open a pull request using the template. Say what changed and why, and paste the real output of the checks you ran, including anything you could not verify.
4. Every required CI check must pass. A maintainer reviews and merges.

Keep a pull request to one coherent change.

## Automation rules

Coding agents working in this repository follow [AGENTS.md](AGENTS.md). Human contributors do not need it.

## Licence

By contributing you agree that your work is licensed under the AGPL-3.0, like the rest of the project.
