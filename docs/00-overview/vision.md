# Vision

## The sentence

**One place where every request, ticket, project and commitment lives — that people
actually enjoy using.**

## What we are building

A self-hostable service desk and work management platform that a company can run for
itself *and* sell to its customers, from a single container image, with every
customer-specific behaviour configured at runtime.

It has three faces:

1. **The agent workspace** — where staff do the work. Boards, backlogs, lists, tables,
   calendars, timelines. Tickets with SLAs, approvals and workflows. Projects with
   cycles, milestones and time tracking.
2. **The customer portal** — where customers raise requests, watch progress, approve
   things and read the knowledge base. A separate origin, a separate bundle, a separate
   identity provider if you want one.
3. **God Mode** — where the platform is configured. Identity providers, branding,
   feature toggles, roles, workflows, SLA policies, notification channels, storage.
   No YAML, no rebuild, no redeploy.

## Why it exists

Today the company runs Jira, Plane, Azure DevOps, a Power Apps ticketing tool and
Microsoft Planner simultaneously. Consequences:

- **No single answer to "how are we doing?"** Reporting requires manually stitching five
  exports together, so it doesn't happen.
- **Customers have no window in.** They email, and someone re-keys the email into a tool.
- **Work is invisible across tools.** A request in Power Apps becomes a task in Planner
  becomes a work item in Azure DevOps, and nothing links them.
- **Five licences, five admin surfaces, five sets of permissions to keep in sync.**

TaskDesk replaces all five with one system, and gives customers a portal so the
re-keying stops.

## Why v1 failed, and what changes

TaskDesk v1 was **feature-rich and unusable**. It had SLAs, approvals, workflows, CAB,
intake, 20 reports, timesheets, a service catalogue — genuinely more capability than most
commercial tools. And nobody wanted to use it, because:

- Every UI primitive was hand-written. No component library, no consistency, missing icons
  rendered as empty boxes.
- Screens were dense with no progressive disclosure — a ticket showed 20+ fields at once.
- Several screens had no URL, so you could not link to them, bookmark them, or go back.
- The customer portal was a shell that rendered fixture data.

The lesson is not "we needed more features". It is **breadth was purchased with depth,
and the interface was treated as a delivery detail rather than the product**.

v2 inverts that:

| v1 | v2 |
| --- | --- |
| Build features, then style them | Start from a finished design system; features must fit it |
| Hand-rolled primitives | kaneo's 60+ Radix/Tailwind primitives, no exceptions |
| Ship wide | Ship one phase fully finished before starting the next |
| UX reviewed at the end | UX gates in CI on every pull request |
| Config in env vars and code | Config in God Mode, at runtime |

## What success looks like

**Twelve months out:**

- Jira, Plane, Azure DevOps, Power Apps ticketing and Planner are all switched off.
- Customers raise requests in the portal instead of emailing.
- A manager can answer "which customers are we failing on SLA?" in under 30 seconds.
- A new engineer is productive on day one without training, because the interface is
  self-evident.
- The same image is deployed for a paying customer with nothing changed but God Mode
  settings.

**How we will know it is working before then:**

- Staff choose TaskDesk over the old tool without being told to.
- Nobody asks "where is that screen?"
- The design review gate stops being a bottleneck because nothing fails it.

## What this is not

- **Not a migration of v1.** v1's code is reference material. Its *domain logic* — the SLA
  engine, workflow engine, assignment rules, access model — is worth reimplementing.
  Its frontend is worth nothing but as a list of mistakes.
- **Not a fork we track upstream.** kaneo is the starting point, taken once, then owned.
  See [ADR 0001](../01-architecture/adr/0001-kaneo-as-foundation.md).
- **Not a data migration project.** Importers are a feature. See
  [06-data-import](../06-data-import/import-strategy.md).

## Related

- [Problem statement](problem-statement.md)
- [Product principles](product-principles.md)
- [Competitive inspiration](competitive-inspiration.md)
- [Roadmap](../07-planning/roadmap.md)
