# Competitive inspiration

What we take from each system, and what we deliberately reject. This is a design
reference, not a legal one — for licence rules see
[Licensing and attribution](licensing-and-attribution.md).

---

## kaneo — the foundation

**Role:** the codebase and the entire visual language.

**Take:**

- The complete design system: a full primitive set in `components/ui` (mixed Radix + Base UI at fork, converged on Base UI at extraction), Tailwind v4
  with CSS variables, `new-york` shadcn style, neutral base, Geist Variable typography.
- The application shell: collapsible sidebar, workspace switcher, project nav, command
  palette (`⌘K`), breadcrumbs.
- The board / list / calendar / gantt / backlog view family, with dnd-kit drag & drop.
- The API architecture: Hono + `@hono/zod-openapi`, feature-folder route organisation
  (`controllers/`, `index.ts`, `schema.ts`, `response.ts`), Drizzle, better-auth.
- **Editable roles in workspace settings** — kaneo stores role permission sets as rows in
  `workspace_role`, so an admin can create and adjust roles in the UI rather than picking
  from a fixed list. This is a headline feature for us; see
  [Roles and permissions UI](../03-features/roles-and-permissions-ui.md).
- The motion design specs in `kaneo/plans/` and the UI review skills in `kaneo/skills/`.
- Single-container Dockerfile, Helm chart, i18n structure, Biome config, Vitest setup.

**Reject:**

- Billing / seat / trial machinery (`workspace_billing`, `trial_grant`, Creem). We are
  self-hosted; remove it entirely rather than leave it dormant.
- Flat single-axis roles — we need reach vs authority.
- Cloud-specific abuse mitigations (Turnstile, disposable-email blocking) as
  *always-on*; they become optional God Mode plugins instead.

---

## Plane — the administration and agile model

**Role:** how a mature instance-admin surface and a three-tier settings hierarchy should
feel.

**Take:**

- **God Mode as a distinct surface** with its own navigation: instance general, email/SMTP,
  authentication providers, AI, image/storage, workspace provisioning.
- **Three-tier settings**: instance → workspace → project, with clear ownership at each
  level, plus per-user profile settings.
- **Project feature toggles** — cycles, modules, views, pages, intake can each be switched
  off per project so a simple project stays simple. This is the single best idea in Plane
  for us: it lets a feature-rich product present a small surface.
- **Cycles, modules, estimates** as first-class agile constructs.
- **Intake/inbox** as a pre-project triage queue.
- Numeric role ranks (Admin 20 / Member 15 / Guest 5) so comparisons are `>=` rather than
  a lookup table.
- Live collaborative editing via Hocuspocus — noted as a *later* possibility, not a
  phase-one commitment.

**Reject:**

- MobX. We use TanStack Query + Zustand.
- The Python/Django backend and its multi-service deployment.
- Separate `admin` and `space` applications — our God Mode is a route group inside the
  agent app, gated by capability.

---

## OpenProject — the enterprise depth

**Role:** proof of what serious organisations eventually need.

**Take:**

- **Workflow as (type × role × from-status → to-status).** Different roles get different
  legal transitions on the same work item type. This is materially more expressive than
  Jira's basic model and neither Plane nor kaneo has it.
- **Custom field sections** — grouped, with per-type visibility rules — so a
  30-custom-field instance still renders a clean form.
- **Project hierarchy with role inheritance.** A child project inherits members and roles
  from its parent, with the inheritance recorded so it can be reasoned about.
- **Dual time and cost tracking.** Time entries and cost entries are separate, with
  hourly rates and cost rates that are effective-dated, and budgets to compare against.
- **Rich relation types**: relates, blocks, duplicates, includes, requires, precedes —
  with parent/child hierarchy modelled *separately* from relations.
- **Journals** — an immutable per-change audit log rich enough to reconstruct any work
  item's state at any past instant. This is how you get baselines for free.
- Notification settings that are granular per event type per user.

**Reject:**

- The Rails codebase and its module/plugin system.
- BIM/IFC, forums, news — out of scope.
- Its information density. OpenProject is powerful and visually exhausting; we take the
  model, not the presentation.

---

## Jira Service Management — the service desk baseline

**Role:** the feature bar we must clear to replace it.

**Take:**

- Request types with per-type forms, grouped into a customer-facing catalogue.
- Queues with saved filters, shared at team level.
- SLA policies with multiple goals, calendars, pause conditions and start/stop/reset
  triggers.
- Approvals as a first-class workflow step, not a comment convention.
- Customer portal with public vs internal comment visibility.
- Satisfaction (CSAT) surveys on resolution.
- Knowledge base articles surfaced during request creation ("did you mean this article?").
- The **customer permission model**: customers may escalate priority but not de-escalate;
  may re-rank their own backlog; may not assign; may not approve their own request.

**Reject:**

- Per-seat economics.
- The automation rule builder's complexity. Ours should cover 90% of cases with 20% of
  the concepts.

---

## TaskDesk v1 — our own hard-won domain knowledge

**Role:** the feature inventory and the security model. Its code is reference; its
*understanding* is an asset.

**Take:**

- **Reach vs authority** as separate RBAC axes.
- **Scope resolved from the directory by email, never from the token** — so revocation is
  immediate and stale tokens carry no stale privilege.
- **404 not 403** for out-of-scope reads, so tenant boundaries leak nothing.
- **Lazy SLA evaluation** — no stored timers; deadline computed from creation + policy +
  service calendar on read. Far fewer moving parts than a timer-based design.
- Service calendars covering 8×5 / 12×5 / 24×7 with holidays.
- Versioned workflows with per-transition note policies (`none` / `optional` / `required`,
  plus `customer` / `internal` visibility).
- Engagement composition rules (exactly one PM, at least one team member, no role mixing).
- Prerequisites, milestones, stakeholders with escalation paths.
- The distinction between **project** (dated, has a backlog and sprints) and
  **managed service** (indefinite, has a support level and cover window).
- Outbound webhooks with SSRF/DNS-rebinding protection.
- The route registry pattern (`lib/routes.ts`) with a round-trip test.

**Reject:**

- Everything about the frontend.
- Three backends. One suffices; see
  [ADR 0002](../01-architecture/adr/0002-single-backend.md).
- Two hand-maintained UI codebases for agent and portal.

---

## Also reviewed — six more self-hosted systems

Cloned into `ITSM/` and reviewed 2026-09-05, at lighter depth than the five systems above
because none of them changed a decision already made — each one either confirmed a
decision we had already recorded, or demonstrated a mistake we are already avoiding.

### Chatwoot — the omnichannel-conversation genre

**Role:** proof that a different genre (live chat / conversational support) is not the
genre we are building, and one validated pattern worth having an opinion about.

**Take:** SLA policies tied to business hours with escalation email; canned responses
applied inline to a conversation. The contact/company model spans channels for one
customer identity, which is a reasonable check against our own `person` /
`organisation` model, even though multi-channel intake itself stays a documented
candidate, not a commitment — see [roadmap.md](../07-planning/roadmap.md).

**Reject:** round-robin conversation assignment — already rejected, see
[decision log](../07-planning/decision-log.md). The open-core split (an MIT core with an
`enterprise/` directory under a separate, non-open licence) — we chose uniform AGPL over
an open-core split; see [ADR 0005](../01-architecture/adr/0005-agpl-licensing.md).
Conversation-first information architecture — we are work-item-first.

**Licence:** MIT (core), with an `enterprise/` directory carved out under a separate
licence.

### FreeScout — proof a lean core plus a module marketplace works commercially

**Take:** a genuinely small self-hosted core (PHP/Laravel) with paid add-on modules
distributed like plugins is a real, working commercial model built on the same idea our
own plugin registry ([ADR 0006](../01-architecture/adr/0006-plugin-registry.md)) enables —
useful external validation, even though we monetise through God Mode feature-flag tiers
and — if a marketplace listing is ever made — a BYOL/contract entitlement plugin ([ADR 0013](../01-architecture/adr/0013-marketplace-metering-plugin.md); metering is the non-preferred path)
rather than a module storefront.

**Reject:** its ticket status set is small and effectively fixed. A second concrete,
currently-maintained example of exactly the rigidity
[ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md) exists to avoid.

**Licence:** AGPL-3.0.

### GLPI — proof that absorbing a CMDB is a mistake

**Take:** its **Entities** — a hierarchical tree scoping data across sub-organisations —
is a mature, battle-tested precedent for the project-hierarchy-with-role-inheritance idea
we already took from OpenProject. Its business-rules engine (condition → action on a
ticket, e.g. auto-assign by category) is real-world validation that
[automations.md](../03-features/automations.md)'s scope is the right size.

**Reject:** GLPI is also a full CMDB, asset inventory, software-licence tracker, contract
manager and data-centre inventory tool. It is the concrete cautionary example behind
[service-management.md](../03-features/service-management.md)'s explicit refusal to
become one: "every ticketing system that has tried to absorb \[a CMDB\] has become
unpleasant." GLPI is capable and exactly that.

**Licence:** GPL-3.0 — note, **not** AGPL: GLPI carries no network-copyleft obligation the
way our own licence does. Worth remembering when comparing commercial postures.

### NocoBase — validates the plugin-registry pattern, tempts scope creep

**Role:** not an ITSM tool — a no-code/AI application-building platform — reviewed for its
plugin and workflow architecture, not its product surface.

**Take:** its plugin-manager screen (enable, configure, and see the health of every
installed plugin from one place, each with its own generated settings form) is
architecturally the same idea as our own God Mode → Plugins screen — good independent
validation of [ADR 0006](../01-architecture/adr/0006-plugin-registry.md). Its visual,
node-based workflow engine (trigger → condition → action, user-buildable) is a stronger,
more general automation model than ours — and a whole product surface by itself, which is
exactly why [automations.md](../03-features/automations.md) deliberately covers "90% of
cases with 20% of the concepts" rather than building toward this.

**Reject:** building a general no-code data-model designer. We are an opinionated
product, not a platform for building arbitrary apps. Its mixed licensing (an Apache-2.0
core alongside a separate, proprietary-style "NocoBase License Agreement" covering other
parts of the same repository) also means: **ideas only, never code**, and check which
licence covers any specific file before ever considering otherwise.

**Licence:** Apache-2.0 for part of the repository; a separate proprietary-style licence
agreement for another part. Mixed — treat as ideas-only regardless of which part.

### osTicket — proof that lean and simple still wins deployments

**Take:** its **Help Topics** map almost exactly onto our own request type — a
customer-facing named template routing to a department, a workflow and an SLA plan.
Independent convergence on the same shape as Jira Service Management's request types is
good evidence the pattern is right, not merely borrowed. Its enduring popularity despite
real simplicity is a data point in favour of
[product principle 7](../00-overview/product-principles.md) — narrow and finished beats
broad and half-built, at any scale.

**Reject:** a fixed, small ticket status set with no per-deployment renaming — a third
concrete example (with FreeScout and, in spirit, most of this list) of the rigidity
[ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md) exists to avoid.
Department-only routing, with no project or workspace hierarchy underneath it.

**Licence:** GPL-2.0 — the oldest licence of the six, and (like GLPI) not AGPL.

### Zammad — the closest real-world precedent to our own lifecycle engine

**Role:** the most architecturally relevant of the six reviewed here.

**Take:** Zammad's ticket **states** carry an admin-editable display name *and* a fixed
underlying state type (new / open / pending / closed, in substance) — an independent
convergence on exactly the "renameable name, fixed semantic bucket" shape decided in
[ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md), and strong evidence
that shape is right-sized rather than over-engineered. Its **Triggers** (condition →
action automation firing on ticket create, update, or a state change) map directly onto
our own [`WF-20`](../03-features/workflows.md) and
[automations.md](../03-features/automations.md). Its **Object Manager** (an admin screen
that adds a custom field to a core object, no code) is functionally the same ambition as
[custom-fields.md](../03-features/custom-fields.md). Its **Overviews** — admin-defined,
shared saved views with a chosen column set — is a direct, currently-shipping precedent
for the "selectable, check-box row-and-column" report tier now specified in
[reports-and-dashboards.md](../03-features/reports-and-dashboards.md).

**Reject:** a Rails-monolith admin UI that has not had the design-system investment ours
gets from taking kaneo wholesale — exactly the gap
[product principle 2](../00-overview/product-principles.md) exists to close. No
reach-versus-authority split — a flat role model, the same limitation kaneo itself has and
[product principle 5](../00-overview/product-principles.md) exists to fix.

**Licence:** AGPL-3.0 — the same licence family as this product.

## Summary table

| Capability | kaneo | Plane | OpenProject | JSM | v1 | **v2** |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| Design system quality | ●●● | ●● | ● | ●● | ○ | **●●●** |
| Editable roles in UI | ●● | ○ | ●●● | ●● | ● | **●●●** |
| Pluggable identity providers | ● | ●● | ●●● | ● | ●● | **●●●** |
| SLA engine | ○ | ○ | ○ | ●●● | ●●● | **●●●** |
| Approvals / CAB | ○ | ○ | ● | ●●● | ●●● | **●●●** |
| Customer portal | ○ | ● | ● | ●●● | ●● | **●●●** |
| Cycles / agile | ● | ●●● | ●● | ● | ● | **●●●** |
| Time & cost with budgets | ● | ● | ●●● | ○ | ●● | **●●** |
| Project hierarchy | ○ | ○ | ●●● | ● | ○ | **●●** |
| Feature toggles per project | ○ | ●●● | ●● | ● | ○ | **●●●** |
| Instance admin (God Mode) | ● | ●●● | ●● | ●● | ●● | **●●●** |
