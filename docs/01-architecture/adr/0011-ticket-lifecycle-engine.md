# 0011 — One generic lifecycle engine for every work item, not per-category logic

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

## Context

An incident, a service request, a change, a problem, an epic, a story, a task and a bug
all move through a sequence of named stages that someone can act on, be gated by a role,
and eventually count as "done" for SLA and reporting purposes. Nearly every ITSM and
ticketing system we reviewed — v1 included — answers this by giving each category its own
fixed status enum, hand-coded: `open / pending / resolved / closed` for tickets,
`new / in_progress / review / done` for tasks, wired into the application in `switch`
statements and template strings. Renaming a stage, or adding one, means shipping a code
change.

That is precisely the rigidity the product must not repeat. One customer wants
"Diagnosing → Awaiting Parts → Fixed"; another wants "Triaged → In Build → Verified →
Released"; a third is happy with kaneo's default "To Do / In Progress / Done". None of
that is a product decision we get to make once, centrally, in code.

At the same time, SLA calculation, board columns, "what's still open" filters and
cross-project reporting all need to ask one question that must have a stable answer
regardless of what a state is called: *is this work item effectively not started, in
flight, paused, done, or abandoned?* A completely free-form graph with no shared
vocabulary cannot answer that question portably.

`work-items.md`, `workflows.md` and the `state` / `workflow` / `workflow_version` /
`workflow_transition` tables in [data model](../data-model.md) already describe the
mechanism. This ADR exists to say, explicitly and in one place, what problem that
mechanism is solving and what is — and is deliberately not — hardcoded.

## Decision

**There is exactly one lifecycle engine, used by every work item type, service or
delivery alike. Its states and its transition graph are data. Only the state's `group` is
fixed vocabulary, and it exists solely to make cross-cutting logic possible.**

- A **state** (`state` table) belongs to a **workspace** — so a workspace-scoped workflow
  can reference it and serve every project — has an admin-supplied `name` and `colour`,
  and is assigned to exactly one of five **groups**:
  `backlog · unstarted · started · completed · cancelled`. The five groups are the entire
  fixed vocabulary in the system — nowhere in the codebase does a literal state name like
  `"Resolved"` or `"Open"` appear in domain logic. SLA resolution, "is this done?" checks,
  board column defaults and portfolio reporting all key off `group`, never off `name`.
- A **workflow** (`workflow` / `workflow_version` / `workflow_transition`) attached to a
  work item type defines which state-to-state moves are legal, optionally restricted to a
  role, with a note policy and guards — see [Workflows](../../03-features/workflows.md).
  Editing states and transitions is a settings screen, not a deploy.
- This is the *only* lifecycle mechanism. There is no separate "ticket status" system
  distinct from a "task status" system, and no per-category branch of workflow logic.
  Incident, service request, change, epic and bug all flow through the same `state` +
  `workflow` tables, exactly as [work-items.md](../../03-features/work-items.md) already
  argues for the work item table itself.
- **Renaming, adding or removing states — and reshaping the transition graph between
  them — is a workspace-settings action**; **which states a project uses, in what order,
  and which is its default is a project-settings action** (`project_state`). Both take
  effect immediately, with the workflow editor's validation panel (see
  [workflows.md](../../03-features/workflows.md)) refusing a change that would strand
  in-flight work items or enable a state the workflow cannot leave.
- **Transitions carry `guards` and `effects`** — two closed vocabularies owned by
  [workflows.md](../../03-features/workflows.md). Effects are how a transition sets or
  clears an assignee, pauses or resumes the SLA clock, or schedules a follow-up transition
  ("pending until Thursday"). There is no second place where lifecycle side-effects live:
  [sla.md](../../03-features/sla.md) and [assignment.md](../../03-features/assignment.md)
  cite the vocabulary, they do not define their own.

*(Corrected 2026-09-05: the first draft made states project-scoped, which the
[planning review](../../07-planning/review-2026-09-05.md) showed made a workspace workflow
unable to serve a second project — the exact thing this ADR exists to guarantee.)*
- The **noun** used to describe a work item, a project, a cycle and so on (`"Ticket"` vs
  `"Issue"` vs `"Case"`) is a *separate* concern, covered by
  [ADR 0012](0012-terminology-overlay.md). This ADR is about the **stages** a work item
  passes through; ADR 0012 is about the **names of the concepts** themselves.

## Consequences

### Positive

- **One thing to build, test, secure and document.** kaneo's simple per-project states,
  Plane's state groups and OpenProject's type × role × status transitions unify into one
  engine instead of three half-features.
- A customer relabels "Resolved" to "Fixed", or inserts "Awaiting Vendor" between
  "In Progress" and "Resolved", entirely in the UI. This is the concrete answer to "not
  hardcoded like v1."
- Reporting, SLA and board logic are portable across every project and every customer,
  because they are written against five stable groups, never against names.
- Seeded default workflows (see [work-items.md](../../03-features/work-items.md)'s default
  types) give a good out-of-the-box experience without constraining anyone who wants
  something else.

### Negative

- **The group is a leaky abstraction.** An administrator adding a state must still decide
  which of five buckets it belongs to, which is a small extra cognitive step the raw name
  doesn't require. Mitigated with a required, explained field in the state editor and a
  sensible default (a newly-added state defaults to `started`, the least surprising
  choice) plus the "stuck item" validation from `workflows.md` catching bad wiring before
  publish.
- **Idiosyncratic grouping reduces cross-project comparability.** If one project marks a
  "Waiting on customer" state as `started` and another marks an equivalent state
  `cancelled`, portfolio reports diverge in meaning. Mitigated by documenting the intended
  semantics of each group prominently in the editor, not by constraining the choice.
- **Five groups will occasionally not fit.** A state that is "on hold" is neither cleanly
  "started" nor "cancelled". This is accepted as the cost of having *any* shared
  vocabulary; the alternative (no groups) breaks SLA and reporting entirely, which is
  worse.

### Neutral

- This ADR changes nothing about what `work-items.md`, `workflows.md` or the data model
  already specify. It exists so the decision — one engine, data-driven stages, one fixed
  five-value vocabulary — is recorded as a decision rather than left implicit across three
  documents.

## Alternatives considered

**A fixed status enum per work item category, as v1 and most reviewed ITSM tools do.**
Rejected outright — it is the specific rigidity this product exists to not repeat.

**A fully free-form state graph with no group vocabulary at all.** Rejected. SLA
resolution and "what's still open" reporting need a portable answer to "is this done?"
that survives an administrator renaming things; without groups, every customer's renaming
would silently break SLA and reporting.

**Separate lifecycle engines for service work (tickets) and delivery work (tasks/epics),
mirroring the Jira-classic vs. Jira-Service-Management split some competitors have.**
Rejected for the same reason `work-items.md` rejects separate ticket and task entities:
it produces duplicated views, duplicated reporting, and an eventual clumsy bridge between
the two.

## Related

- [Work items](../../03-features/work-items.md) · [Workflows](../../03-features/workflows.md)
- [Data model](../data-model.md) · [ADR 0012 — Terminology overlay](0012-terminology-overlay.md)
- [Competitive inspiration](../../00-overview/competitive-inspiration.md)
