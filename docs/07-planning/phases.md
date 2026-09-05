# Phases

Seven phases. Each one is **finished** before the next begins — see
[product principle 7](../00-overview/product-principles.md). That remains the definition
of "finished" used throughout this document.

**For dates**, and for the one calendar where several of these phases deliberately run in
parallel rather than sequentially — with every resulting trade-off named — see
[accelerated-delivery-plan.md](accelerated-delivery-plan.md). This document still answers
"what does done mean"; that one answers "what ships by which date."

**The operating rule for time (Thomas, 2026-09-05 — settled, not a question):** the
four-week accelerated plan is a **flexible target** for fast internal progress, not a
promise that the whole product, a marketplace launch or external-customer readiness lands
in four weeks. The complete program may take **three to four months**. A phase, feature or
P0 task may finish in **one to three days** where kaneo already provides a working
foundation and the policy/security retrofit is straightforward; other work takes longer
because it changes security, identity, tenancy or deployment behaviour. For every phase:
finish it when its exit criteria are met; do not delay finished work to match a calendar;
**never skip a security, quality, test or review gate to match a calendar**; if needed,
narrow optional scope, move an unfinished feature later, or move the target date — and
record the change in [status.md](status.md), here, and in [release-plan.md](release-plan.md).

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
  mitigations; **delete `public-project`** (anonymous boards — removed, not flagged)
- **Retrofit kaneo's inherited routers into the five policy kinds** — the largest
  security task in P0 and the reason the route-coverage test enumerates Hono's router. A
  human-reviewed pass over the inherited code (the snapshot's scanner run detects known
  CVEs, not a planted change), with its own Opus security review before P0 closes. See
  [repository-bootstrap.md](../04-engineering/repository-bootstrap.md#3-inherited-features-register)
- **Inherited-features register** — one page in `docs/01-architecture/` listing every
  kaneo feature and notable dependency with a verdict (*keep — spec exists* / *keep —
  write a spec* / *remove*) and the kaneo commit SHA taken. Anything kept without a v2
  spec is feature-flagged **off** until the spec exists. Starting table and expected
  verdicts: [review-2026-09-05.md](review-2026-09-05.md)
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
- ADRs 0001–0013 committed
- Sign-in, MFA, not-found, error boundary
- **Identity and deletion models fixed in the documents, not yet built** (decided
  2026-09-05): the authoritative `identity_connection` / `scim_connection` /
  `external_identity` / `scim_group_mapping` / `scim_group_member` / `provisioning_event`
  tables, the
  agent/customer portal boundary for identity connections, the OIDC and SCIM security
  rules, and the 17 SCIM/Entra acceptance tests and fixtures
  ([identity-provisioning.md](../03-features/identity-provisioning.md)); the
  `pending_action` model and route family ([pending-actions.md](../01-architecture/pending-actions.md)).
  **No production SCIM endpoint is built in P0.**

**P0 step 0 — spec closure (added 2026-09-05).** Before step 1, the
[planning review](review-2026-09-05.md)'s prerequisites are finished, in this order, so
nothing below is built on a guess:

1. `data-model.md` authoritative for every table and column; identifier lists
   single-homed (flags, jobs, events, env vars, capabilities) — **done in the review**.
2. `rbac.md`: five policy kinds, implication graph, role × capability matrix — **done**.
3. Week-one documents: [repository bootstrap](../04-engineering/repository-bootstrap.md),
   [`packages/ui` extraction plan](../02-design/ui-extraction-plan.md),
   [migration convention](../04-engineering/migrations.md),
   [container image](../05-operations/container-image.md),
   [auth runtime reconfiguration](../01-architecture/auth-runtime-reconfiguration.md),
   [i18n](../01-architecture/i18n.md), [Helm values contract](../05-operations/kubernetes.md),
   the threat model in [security-model.md](../01-architecture/security-model.md).
4. Each feature spec's remaining findings in
   [reviews/2026-09-05/](reviews/2026-09-05/) are closed at **SDLC stage 2 of that
   feature**, before its build starts — not all at once now. A spec is not "specified"
   until its section in those files is empty.

**Done when:** the stack builds, deploys locally on three hostnames, every CI gate runs
green **with kaneo's inherited routes present and each carrying a policy** (not on an
empty application), and the P0 Opus security review has signed off the router retrofit.

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
- **Pending actions** — the server-enforced deletion approval
  ([pending-actions.md](../01-architecture/pending-actions.md)) lands here with work-item,
  comment, attachment, **project and workspace** deletion from the web UI (the two danger
  zones ship in P1, so step-up exists in P1 too); API-key and MCP origins join in P4
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
- Invitations and onboarding; per-request visibility `private` / `organisation` (`CP-16`)
- **Microsoft Entra OIDC for the agent portal** — an `agent` identity connection
- **Organisation-bound Microsoft Entra OIDC for the customer portal** — a `customer`
  identity connection per organisation (`CP-17`)
- **Microsoft Entra SCIM provisioning and de-provisioning** — `/scim/v2/*`, users, and
  allowlisted group→role mapping; `active=false` revokes sessions and personal API/MCP keys
  ([identity-provisioning.md](../03-features/identity-provisioning.md) — **core delivery,
  decided 2026-09-05**)
- **God Mode → Authentication**: identity connections (Entra first; Keycloak and others
  are future), per-portal scoping, JIT policy, domain bindings, the SCIM panel, Test OIDC,
  Test SCIM
- **God Mode → Organisations → Identity**: the customer organisation's connection —
  instance-administrator configured, no customer self-service
- MFA policy, session policy
- **God Mode → Organisations**: tenants, catalogues, quotas, portal access
- Profile security and sessions

**Done when:** a real customer raises, tracks and approves a request without emailing
anyone; a customer organisation's people sign in with their own Entra and land only in
their organisation; Entra deactivating a person ends their access within a minute; and
**the 17 SCIM/Entra acceptance tests pass against a real Microsoft Entra test tenant** —
the identity gate does not close on a mock alone.

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
- API keys — personal and workspace service keys (bounded by their creator)
- MCP server published — read-only keys by default; destructive tools through pending
  actions; the **Profile → Pending actions** page for API/MCP-originated requests
- Impersonation, audited
- **Identity operations hardening**: provisioning-event visibility, identity health on the
  Health screen, SCIM token-rotation UX, connection config in the config export, role
  management maturity for group mappings

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
