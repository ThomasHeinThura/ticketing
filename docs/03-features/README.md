# Feature specifications

One document per feature. Each states what the feature is, who can do what, how it
behaves at the edges, and how it is tested.

**Status:** ⬜ not started · 🟡 in progress · ✅ shipped

## Core work management

| Feature | Phase | Status | Inspired by |
| --- | :-: | :-: | --- |
| [Work items](work-items.md) | P1 | ⬜ | kaneo, Plane, v1 |
| [Views and layouts](views.md) | P1 | ⬜ | kaneo |
| [Projects and engagements](projects-and-engagements.md) | P1 | ⬜ | v1, OpenProject |
| [Relations and hierarchy](relations-and-hierarchy.md) | P1 | ⬜ | OpenProject |
| [Comments and activity](comments-and-activity.md) | P1 | ⬜ | kaneo, JSM |
| [Attachments](attachments.md) | P1 | ⬜ | kaneo |
| [Search and saved views](search-and-saved-views.md) | P1 | ⬜ | kaneo, JSM |
| [Assignment](assignment.md) | P1 | ⬜ | v1 |

## Service desk

| Feature | Phase | Status | Inspired by |
| --- | :-: | :-: | --- |
| [Workflows](workflows.md) | P2 | ⬜ | v1, OpenProject |
| [SLA](sla.md) | P2 | ⬜ | v1, JSM |
| [Service calendars](service-calendars.md) | P2 | ⬜ | v1 |
| [Request types and catalogue](request-types-and-catalogue.md) | P2 | ⬜ | JSM |
| [Intake queue](intake-queue.md) | P2 | ⬜ | v1, Plane |
| [Approvals and CAB](approvals.md) | P2 | ⬜ | v1, JSM |
| [Audit trail](audit-trail.md) | P2 | ⬜ | v1, OpenProject |

## Portal and identity

| Feature | Phase | Status | Inspired by |
| --- | :-: | :-: | --- |
| [Customer portal](customer-portal.md) | P3 | ⬜ | JSM |

## Governance and administration

| Feature | Phase | Status | Inspired by |
| --- | :-: | :-: | --- |
| [Roles and permissions UI](roles-and-permissions-ui.md) | P4 | ⬜ | kaneo, OpenProject |
| [God Mode](god-mode.md) | P4 | ⬜ | Plane |
| [Settings hierarchy](settings-hierarchy.md) | P4 | ⬜ | Plane |
| [Custom fields](custom-fields.md) | P4 | ⬜ | OpenProject |
| [Notifications](notifications.md) | P4 | ⬜ | kaneo, OpenProject |
| [Automations](automations.md) | P4 | ⬜ | v1, JSM |
| [Webhooks and API keys](webhooks-and-api-keys.md) | P4 | ⬜ | v1 |
| [MCP server](mcp-server.md) | P4 | ⬜ | kaneo, v1 |

## Insight and agile

| Feature | Phase | Status | Inspired by |
| --- | :-: | :-: | --- |
| [Cycles, modules, estimates](agile.md) | P5 | ⬜ | Plane |
| [Time and cost](time-and-cost.md) | P5 | ⬜ | OpenProject, v1 |
| [Reports and dashboards](reports-and-dashboards.md) | P5 | ⬜ | v1 |
| [Knowledge base](knowledge-base.md) | P5 | ⬜ | JSM |
| [Service catalogue, changes, releases](service-management.md) | P5 | ⬜ | v1, ITIL |

---

## Writing a feature spec

Use this shape. It is designed so an AI agent can implement from it without asking
questions, and so a reviewer can check the result against it.

```markdown
# <Feature>

- **Phase:** Pn
- **Status:** ⬜
- **Feature flag:** `feature.<key>` (or "always on")
- **Depends on:** …

## Purpose
One paragraph. What problem does this solve, for whom.

## Concepts
The nouns this feature introduces, matching the glossary.

## Data
Tables and columns. Link to the data model rather than duplicating it.

## Behaviour
The rules. Numbered, testable, unambiguous. This is the bulk of the document.

## Permissions
Which capability guards which action. A table.

## Screens
Which screens, which routes. Link to the screen inventory.

## API
Endpoints, with their policies.

## Edge cases
The awkward ones, answered. If it is not answered here, someone will guess.

## Out of scope
What this feature deliberately does not do, and where that lives instead.

## Testing
Unit, integration, E2E. Named tests.

## Open questions
Anything genuinely undecided, with who decides and by when.
```

## Rules

- A feature is not built until its spec exists and has been read.
- Behaviour rules are numbered, so tests and code comments can cite them (`WI-14`).
- "Open questions" must be empty before implementation starts.
- If implementation reveals the spec was wrong, **fix the spec in the same pull request**.
  A stale spec is worse than no spec.

## Related

- [Screen inventory](../02-design/screen-inventory.md) · [Phases](../07-planning/phases.md)
- [Data model](../01-architecture/data-model.md) · [Glossary](../00-overview/glossary.md)
