# Problem statement

## Current state

Five systems, none of which talk to each other.

| System | Used for | Why it isn't enough |
| --- | --- | --- |
| **Jira** | Software delivery tracking | Expensive per-seat; service desk is a paid add-on; customers can't be given access cheaply |
| **Plane PM** | Project management | No SLAs, no approvals, no customer portal, no service catalogue |
| **Azure DevOps** | Engineering work items, pipelines | Work-item UX is heavy; not customer-facing; boards don't suit service work |
| **Power Apps ticketing** | Internal ticket intake | Bespoke, brittle, one person understands it, no reporting |
| **MS Planner** | Ad-hoc team task lists | No hierarchy, no reporting, no permissions worth the name |

## The four concrete pains

### 1. Reporting is impossible

There is no query that spans all five systems. "How many open tickets does customer X
have, and are we meeting SLA?" requires five exports and a spreadsheet. Because it is
expensive, it is done rarely, which means decisions are made without it.

### 2. Customers have no window in

Customers email or call. A staff member reads the email and re-types it into a tool.
Then the customer emails again to ask for status, and a staff member looks it up and
replies. Every status update is a manual round trip. Nothing is self-service.

### 3. Work fragments across tools

A single piece of work commonly exists as: a Power Apps ticket, a Planner card, an
Azure DevOps work item and a Jira issue. None of them reference each other. Closing one
does not close the others. Effort is double-counted or lost.

### 4. Administration is multiplied by five

Onboarding a person means five accounts. Offboarding means remembering all five.
Permissions drift. There is no single audit trail.

## Why not just buy something

| Option | Blocker |
| --- | --- |
| Jira Service Management | Per-agent + per-customer pricing at our scale; data residency; cannot resell |
| ServiceNow | Cost and implementation weight are an order of magnitude beyond us |
| Zendesk / Freshdesk | Ticketing only — no project management, no cycles, no time & cost |
| Plane / OpenProject as-is | No service desk: no SLA, no request catalogue, no customer portal |
| **Fork kaneo** | Good UX, but forking creates permanent dependency on upstream's direction and merge pain |

## Why not fork kaneo

Forking sounded attractive — kaneo's UX is exactly what we want. But a live fork means:

- Every upstream release is a merge conflict against our service-desk additions, forever.
- Our roadmap is coupled to theirs; if they refactor the task model, we stop.
- We cannot restructure their data model to support tenancy, SLAs and approvals cleanly
  without diverging so far that "fork" becomes a lie.

**Decision:** take kaneo's code *once*, as a foundation, under its MIT licence with
attribution, and then own it outright. No upstream tracking. Cherry-pick good ideas
manually later if we want them. See
[ADR 0001](../01-architecture/adr/0001-kaneo-as-foundation.md).

## Success criteria

The project succeeds when all five systems are decommissioned, customers self-serve
through the portal, and a portfolio-level SLA answer is available in under a minute.

The project fails — again — if it becomes feature-rich and unpleasant. Guarding against
that is the subject of [UX quality gates](../02-design/ux-quality-gates.md).

## Secondary objective

The same image, with no code changes, must be sellable to an external customer as their
own service desk. This is why **everything configurable lives in God Mode** rather than
in environment variables or code. See
[Plugin architecture](../01-architecture/plugin-architecture.md).
