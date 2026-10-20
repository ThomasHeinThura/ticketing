# AGENTS.md

The entry point for anyone, human or AI, working here. **Read this file and
[`docs/07-planning/status.md`](docs/07-planning/status.md). That is the whole startup.** The
workflow is in [`docs/04-engineering/workflow.md`](docs/04-engineering/workflow.md). Read other
docs only when the task touches them.

## What this is

**TaskDesk v2** is a self-hostable, multi-tenant service desk and work-management platform.
It is built on [kaneo](https://github.com/usekaneo/kaneo) (MIT), which we forked once and now
own. The licence is **AGPL-3.0**. Only Thomas sets direction. His decisions live in
[`decision-log.md`](docs/07-planning/decision-log.md), newest first.

## The rules

1. **Kaneo is the design.** Keep kaneo's existing screens, layout, sidebar, settings shell,
   tables, cards, spacing and type. A new capability goes into an existing kaneo surface: a
   tab, a section, a panel, a column, a menu item or a settings page. Don't build a parallel
   screen for something kaneo already has, and don't restyle what works. Build only from
   `packages/ui` and kaneo's own components (`components/common/*-layout.tsx`,
   `settings-layout.tsx`, the board, list and task components). Full rules:
   [design-principles.md](docs/02-design/design-principles.md).
2. **No mock data.** Every screen a user can reach reads and writes the real API. A screen
   with no API is kept out of navigation.
3. **Nothing is hardcoded per customer.** We ship one image. Customer-specific behaviour is
   runtime configuration in God Mode. Environment variables are bootstrap-only and registered in
   [configuration-reference.md](docs/05-operations/configuration-reference.md), and `check:env`
   enforces this.
4. **Every route declares its permission.** A route without a policy entry fails
   `check:route-policy`. v1 shipped authorization holes past green tests, so this one is not
   negotiable.
5. **Every screen has a URL.** Filters, tabs, selections and open panels are URL state,
   registered in `apps/web/src/lib/routes.ts`.
6. **Ship narrow and finished.** Fewer screens at 100% beat many at 60%; v1 died of the
   second. A stage is ✅ only when its exit criteria in [phases.md](docs/07-planning/phases.md)
   hold **and** Thomas has walked through it on SIT. No stage is ✅ yet.

## Layout

```text
apps/api      Hono + Drizzle + better-auth. The only backend.
apps/web      React 19 + TanStack Router. Two entries: agent (/agent/*) and portal (own host).
packages/ui   The design system. packages/domain, permissions, plugins-contracts, libs, email, mcp.
tests/        api · api-integration · permissions · e2e · visual
```

The single authoritative documents for identifiers are:

- tables: [data-model.md](docs/01-architecture/data-model.md)
- capabilities: [rbac.md](docs/01-architecture/rbac.md)
- flags and plugins: [plugin-architecture.md](docs/01-architecture/plugin-architecture.md)
- events: [events.md](docs/01-architecture/events.md)
- jobs: [background-jobs.md](docs/01-architecture/background-jobs.md)
- environment variables: [configuration-reference.md](docs/05-operations/configuration-reference.md)

## Commands

```bash
pnpm install && pnpm dev
pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration          # API changed
pnpm test:permissions          # a route changed
scripts/deploy.sh local        # SIT: https://ticketing.localhost:8443, https://portal.localhost:8443
```

## Do not

The numbers are referenced by CI messages, so keep them stable.

1. Invent a UI primitive outside `packages/ui`.
2. Write a literal colour or arbitrary spacing value.
3. Add a route without a policy.
4. Add a dependency without asking.
5. Disable, skip or focus a test to make CI pass.
6. Waive a gate. Only Thomas can, in the decision log, and a waiver is "deferred", never "approved".
7. Review your own work, or fake review evidence.
8. Refactor beyond the task.
9. Paste code from an unlicensed source (see Licensing below).
10. Retry a failing approach a fourth time without diagnosing the whole path.
11. Name a table, column, capability, flag, event or job that is not in its authoritative document.
12. Delete user data without a pending action where the architecture requires one.
13. Invent an MCP permission or a SCIM-only tenancy rule, or let identity-provider data grant `instance:admin` or `sees_all`.
14. Restore a kaneo integration router that was removed at fork.
15. Merge a feature whose findings in `docs/07-planning/reviews/` are still open.
16. Push to `main`, force-push shared history, use `[skip ci]`, or bypass branch protection.
17. Guess at behaviour the spec doesn't define. Ask, then write the answer into the spec.
18. Claim something works without running it. Open every screen you touched.
19. Spawn a subagent without a concrete, bounded deliverable.
20. Let two sessions edit the same file at once.
21. Use `pal-mcp`, `pal-reviewer`, `clink` or 9Router.
22. Treat a status snapshot or PR body as policy.
23. Call a stage, screen or feature done when it isn't. Source review, offline tests or an image boot are not runtime acceptance.

## Licensing

We take **code** only from kaneo (MIT: keep its copyright headers) and TaskDesk v1 (ours).
Plane, OpenProject and JSM are sources of ideas, never of source code. Record any
third-party code in `THIRD-PARTY-NOTICES.md`. Details are in
[licensing-and-attribution.md](docs/00-overview/licensing-and-attribution.md).
