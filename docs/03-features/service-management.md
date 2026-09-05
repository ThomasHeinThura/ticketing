# Service catalogue, changes and releases

- **Phase:** P5
- **Status:** ⬜
- **Feature flag:** `feature.service_catalogue`
- **Depends on:** work items, workflows, approvals

## Purpose

The ITIL service management layer: what services we run, what changes we are making to
them, and what we are releasing.

Carried from v1, trimmed to what is actually used. ITIL has thirty-four practices; we
implement three, because the rest are process documents rather than software.

---

## Services

A named thing we operate on behalf of customers.

- `SV-1` A service has a name, description, category, owning team, support level (L1/L2/L3)
  and a service calendar.
- `SV-2` A service links to documentation, to its projects and to its knowledge base
  articles.
- `SV-3` A work item may reference the service it affects. This is what makes "which
  service generates the most incidents?" answerable.
- `SV-4` A service has a status — operational, degraded, outage — set by a person, not
  computed. Computed status from open incidents is appealing and always wrong.
- `SV-5` Services may depend on other services, forming a graph used to show impact:
  "this change affects 3 services and 2 customers."

Deliberately **not** a full CMDB. Configuration item discovery, asset inventory and
dependency mapping are a separate product, and every ticketing system that has tried to
absorb them has become unpleasant. If a customer needs a CMDB, they have one, and we link
to it.

---

## Changes

A change is a **work item** of a change type, with extra structure. Not a separate entity.

- `CH-1` Change detail carries: risk (low/medium/high), a deployment window, a rollback
  plan, affected services and a freeze override flag.
- `CH-2` A change's workflow requires CAB approval before the transition to Approved.
  See [approvals](approvals.md).
- `CH-3` Risk drives the approval requirement: low-risk changes may be pre-approved by
  workflow configuration, high-risk always require CAB.
- `CH-4` A **change freeze** is a workspace-level date range during which no change may be
  approved. Overriding requires an explicit flag, a reason, and elevated authority — and
  it is audited prominently.
- `CH-5` The change calendar shows planned windows, freezes and conflicts. Two changes to
  the same service in the same window are flagged.
- `CH-6` A rollback plan is required before a change may be approved. Not a suggestion.

---

## Releases

A grouping of changes deployed together.

- `RL-1` A release has a name, a target service, a planned date, a status and notes.
- `RL-2` Changes are associated with a release.
- `RL-3` A release checklist can be defined per service and is instantiated per release.
- `RL-4` Release notes are generated from the associated changes and are editable before
  publication.
- `RL-5` A release may be published to the customer portal, so customers can see what
  changed. Off by default.

---

## Permissions

| Action | Capability |
| --- | --- |
| See services | `project:read` |
| Manage services | `service:manage` |
| Set service status | `service:manage` |
| Manage change details | `change:manage` |
| Approve a change | `approval:decide_cab` |
| Manage freezes | `change:manage` |
| Override a freeze | `change:manage` + elevated + audited |
| Manage releases | `release:manage` |

## Screens

Services list and detail with a dependency graph; change calendar; change detail section
on the work item; freeze management; releases list and detail with checklist and notes.

The change calendar is the screen that earns this feature. Everything else is structured
data; the calendar is where someone spots that two teams planned conflicting work on the
same weekend.

## API

```
GET    /api/services                           project:read
POST   /api/services                           service:manage
PATCH  /api/services/{id}                      service:manage
POST   /api/services/{id}/status               service:manage
GET    /api/services/{id}/impact               project:read
GET    /api/changes/calendar?from=&to=         project:read
GET    /api/work-items/{key}/change            work_item:read
PATCH  /api/work-items/{key}/change            change:manage
GET    /api/change-freezes                     project:read
POST   /api/change-freezes                     change:manage
GET    /api/releases                           project:read
POST   /api/releases                           release:manage
POST   /api/releases/{id}/notes                release:manage
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Change approved, then a freeze is declared covering its window | The change is flagged; the window must be moved or the freeze overridden |
| Service deleted with open changes | Refused |
| Circular service dependency | Permitted but flagged; impact analysis stops at the cycle and says so |
| Change window in the past | Allowed, for retrospective recording, and marked as such |
| Release with no changes | Allowed. Notes are empty and say so |
| Freeze override | Requires a reason, elevated authority, and appears in a prominent audit report |

## Out of scope

- Full CMDB and asset discovery
- Automated deployment — we record changes, we do not perform them
- Problem management as a distinct workflow beyond a problem work item type
- Service level *reporting* → [reports and dashboards](reports-and-dashboards.md)

## Testing

Unit: freeze conflict detection; impact traversal with cycles; risk-to-approval mapping.

Integration: a change cannot be approved during a freeze without an override; an override
is audited; a rollback plan is required.

E2E: create a change, hit the freeze, override with a reason, observe the audit entry.

## Related

- [Approvals](approvals.md) · [Workflows](workflows.md) · [Audit trail](audit-trail.md)
