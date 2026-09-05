# Phases

Seven phases. Each one is **finished** before the next begins — see
[product principle 7](../00-overview/product-principles.md). That remains the definition
of "finished" used throughout this document.

**For dates**, and for the one calendar where several of these phases deliberately run in
parallel rather than sequentially — with every resulting trade-off named — see
[accelerated-delivery-plan.md](accelerated-delivery-plan.md). This document still answers
"what does done mean"; that one answers "what ships by which date."

A phase is finished when every feature in it meets the
[Definition of Done](../04-engineering/definition-of-done.md), including the UX gates, and
the phase gate in the [SDLC](../04-engineering/sdlc.md) has been passed and written up.

---

## P0 · Foundation

**Goal:** a working, de-branded, quality-gated skeleton. No features yet, but every guard
in place before the first feature is written.

Doing this first is the whole bet. Adding quality gates to an existing codebase never
happens; building on top of them is easy.

- Copy kaneo into `Ticketing.v2`; de-brand; strip billing, seats, trials and cloud abuse
  mitigations
- `THIRD-PARTY-NOTICES.md`, `NOTICE`, `LICENSE` (AGPL-3.0), `AGENTS.md`
- Extract `packages/ui` from kaneo's `components/ui`; Tailwind preset; Storybook
- Split `apps/web` into two entries: `entry.agent.tsx`, `entry.portal.tsx`
- `packages/domain`, `packages/permissions`, `packages/plugins-contracts` scaffolded
- Route registry `lib/routes.ts` with the round-trip test
- Policy registry + **route coverage test** + **permission matrix test**
- CI: lint, typecheck, unit, integration, permissions, E2E, visual, a11y, performance
- UX gate scripts: `check-tokens`, `check-ui`, `check-deps`, `check-bundle-purity`
- Playwright with agent, portal, security, reduced-motion and mobile projects
- Testcontainers integration harness
- Seed scripts: minimal, realistic, hostile
- Dockerfile, `compose.yml`, Traefik config, `scripts/deploy.sh`, the `install.sh`
  bootstrapper it is wrapped by — see [One-line install](../05-operations/one-line-install.md)
- Observability: Pino, Prometheus, health endpoints
- `apps/site` docs skeleton (Fumadocs)
- ADRs 0001–0010 committed
- Sign-in, MFA, not-found, error boundary

**Done when:** the stack builds, deploys locally on three hostnames, and every CI gate runs
green on an empty application.

---

## P1 · Core work management

**Goal:** the work surface. This is where kaneo's existing capability is rebranded,
hardened and extended.

**Replaces:** Microsoft Planner.

- Organisations, workspaces, projects, membership
- Work items: types, states, priority, ranking, hierarchy
- Board, list and table layouts with shared filters
- Backlog with drag ranking
- Work item detail — full page **and** side pane, both addressable
- Comments and activity, with public/internal visibility
- Attachments
- Labels, relations
- Search, command palette, saved views
- Assignment rules
- Realtime over WebSocket
- Profile settings: general, appearance
- Workspace and project settings: general, members, states, labels

**Done when:** a team can run its work here and prefers it to Planner.

---

## P2 · Service desk

**Goal:** the thing that makes it a ticketing product rather than a task tracker. Most of
this is v1's domain logic reimplemented in TypeScript.

**Replaces:** the Power Apps ticketing tool.

- `packages/domain`: SLA engine, service calendars, workflow engine, approvals,
  assignment rules — ported from v1, tested exhaustively
- Work item types with categories (service / delivery)
- Workflows: versioned, per-role transitions, note policies, guards
- SLA policies, goals, pauses, at-risk and breach events
- Service calendars with holidays and the cover preview
- Request types, the form builder, versioned forms
- Intake queue: triage, accept, decline, merge, clarify
- Submissions with durable pages
- Approvals and CAB gating
- Triage queues with addressable filters
- Audit trail
- Milestones, prerequisites, stakeholders, escalation paths

**Done when:** a real support queue runs here, with SLAs measured and approvals working.

---

## P3 · Portal and identity

**Goal:** customers self-serve, and any enterprise identity landscape is configurable.

- Portal origin, bundle, session and narrow API router
- Portal screens: home, requests, request detail, catalogue, form, approvals, projects,
  account
- Escalate-only priority, own-backlog ranking, public-only comments
- Satisfaction rating, reopen window
- Invitations and onboarding
- **God Mode → Authentication**: pluggable OIDC, Entra and Keycloak presets, per-portal
  scoping, JIT provisioning, group-to-role mapping, Test connection
- MFA policy, session policy
- **God Mode → Organisations**: tenants, catalogues, quotas, portal access
- Profile security and sessions

**Done when:** a real customer raises, tracks and approves a request without emailing
anyone, and a second identity provider can be added in the UI without a deploy.

---

## P4 · Governance and administration

**Goal:** one image, any customer, configured entirely through the interface.

- **Roles editor** — create and edit roles in settings, with the capability matrix
- Reach vs authority fully enforced; `sees_all` grants
- Teams
- Custom fields with sections and per-type visibility
- Feature flags: instance, workspace, project, with locking
- **God Mode**: general, branding, storage, notifications, features, jobs, plugins, users,
  audit, health
- Notification channels and preferences, digests, quiet hours
- Automations with dry-run
- Webhooks with signing, retry, delivery history, SSRF protection
- API keys
- MCP server published
- Impersonation, audited

**Done when:** a fresh container can be turned into a customer's own service desk without
touching a file.

---

## P5 · Insight and agile

**Goal:** answer "how are we doing?", and support delivery projects properly.

**Replaces:** Jira and Plane.

- Cycles, modules, estimates
- Calendar and timeline layouts
- Time entries, timer, timesheet grid
- Rates, cost types, cost entries, budgets, capacity
- The fourteen reports, in five groups
- Dashboards with widgets
- Knowledge base with deflection
- Service catalogue, changes, change freezes, releases
- Pages

**Done when:** a manager answers a portfolio SLA question in under thirty seconds, and
delivery teams run their sprints here.

---

## P6 · Import and cutover

**Goal:** move everything in and switch the old systems off.

**Replaces:** Azure DevOps.

- Import framework: discover, map, dry-run, execute, resume, reconcile
- `import.azure-devops`, `import.plane`, `import.jira`, `import.csv`
- MCP import tooling with idempotency
- Import UI in God Mode
- Migration rehearsals against copies
- Cutover, with the old systems set read-only
- Decommission

**Done when:** Jira, Plane, Azure DevOps, Power Apps ticketing and Planner are switched
off.

---

## P7 · Polish and hardening

**Goal:** the things that separate "works" from "good", plus the external-readiness work.

- Performance pass against realistic volumes
- Full accessibility audit and remediation
- i18n completion beyond `en-US`
- Mobile refinement, especially the portal
- External penetration test
- Documentation site completion
- Onboarding and empty-state pass
- Load test baselines
- Disaster recovery drill
- **AWS Marketplace listing**: container-product packaging, `license.aws-marketplace`
  plugin ([ADR 0013](../01-architecture/adr/0013-marketplace-metering-plugin.md)), seller
  registration and security review — see
  [AWS Marketplace listing](../05-operations/aws-marketplace.md)
- **One-line installer** hardened and published at a stable URL — see
  [One-line install](../05-operations/one-line-install.md)

**Done when:** the product can be handed to an external customer without embarrassment.

---

## Ordering rationale

**Why P0 first, with no features.** Retrofitting quality gates never happens. Every rule in
[UX quality gates](../02-design/ux-quality-gates.md) is cheap to add to an empty repository
and expensive to add to a full one. This is the phase most likely to feel like a delay and
most likely to be the reason v2 does not repeat v1.

**Why core work before the service desk.** The service desk is built on work items. There
is no useful order the other way.

**Why the portal in P3, before governance.** The portal is the visible, differentiating
feature, and it is the one v1 failed at most publicly. Building it early — while there is
still appetite to do it properly — matters more than building it conveniently.

**Why reports in P5, not earlier.** Reports need data and need the model to have settled.
Building them against a moving schema wastes the work twice.

**Why import last.** Importing into a model that is still changing means importing twice.
And there is no point migrating history into a product nobody has agreed to use yet.

## Related

- [Roadmap](roadmap.md) · [Status](status.md) · [Screen inventory](../02-design/screen-inventory.md)
- [SDLC](../04-engineering/sdlc.md)
