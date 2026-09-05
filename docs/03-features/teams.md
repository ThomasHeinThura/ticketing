# Teams

- **Phase:** P4 (the `team` table and CAB flag are created in P2 for approvals)
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** RBAC, workspace members

## Purpose

A named group of staff within a workspace, with a capacity, that can own projects, own
saved views and queues, be notified as a unit, and — flagged — act as the Change Advisory
Board. Written 2026-09-05 because the [planning review](../07-planning/review-2026-09-05.md)
found a P4 screen, a reach rule in [RBAC](../01-architecture/rbac.md) and five feature
specs all depending on a teams model that no document defined.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Team** | A workspace-scoped group of staff. Not a security boundary; a grouping |
| **Lead** | A team member flagged `is_lead`; may edit the team's shared views and roster |
| **Capacity** | `capacity_days_per_week`, used by the Capacity report and resource planning |
| **CAB** | Exactly one team per workspace may be flagged `is_cab`; its members may decide CAB approvals |
| **Ownership** | A project may name an `owner_team_id`; every member of that team is in reach of the project |

## Data

`team`, `team_member` — see [data model](../01-architecture/data-model.md) §2;
`project.owner_team_id` in §3.

## Behaviour

- `TM-1` A team belongs to one workspace; a person may belong to many teams.
- `TM-2` Only staff-side people may be team members. Adding a customer-side person is
  refused.
- `TM-3` A team may have zero or more leads. A lead may add and remove members and edit
  the team's shared saved views (`SV-17`); a lead may not change capacity or the CAB flag
  — that is `workspace:manage_settings`.
- `TM-4` `owner_team_id` on a project grants **reach only** to the team's members — step 5
  of the reach resolution in [RBAC](../01-architecture/rbac.md). It grants no capability.
  Because it *is* a reach grant, setting or changing it requires `project:manage_members`
  (not `project:update`), the team must be in the project's workspace, and the change is
  audited as `project.reach_changed` — see [RBAC § Reach](../01-architecture/rbac.md#reach).
- `TM-5` At most one team per workspace has `is_cab = true`. `approval:decide_cab` is
  honoured only for its current members, evaluated at decision time.
- `TM-6` Removing a person from the CAB team leaves their past decisions intact and makes
  their pending CAB approvals undecidable by them; the approval stays open for the rest.
- `TM-7` Deleting a team is refused while it owns a project, owns a shared view, or is the
  CAB. Reassign first.
- `TM-8` A deactivated person is removed from every team's *active* roster but stays in
  history; ownership of their shared views transfers to a lead, else to the workspace
  (`SV-17` edge case).
- `TM-9` Notifications may target a team ("send a notification" action in
  [automations.md](automations.md)); every active member receives it per their own
  preferences.

## Permissions

| Action | Capability |
| --- | --- |
| See teams | `workspace:read` |
| Create, delete, set capacity, set CAB flag | `workspace:manage_settings` |
| Add/remove members, set leads | `workspace:manage_settings`, or a lead of that team (`orOwner: 'row.is_lead'`) |
| Set a project's owning team | `project:manage_settings` |

## Screens

`Workspace — teams` (`/agent/settings/teams`, list) and `Team detail`
(`/agent/settings/teams/{id}`: roster, leads, capacity, CAB flag, owned projects, shared
views). Both P4; in the [screen inventory](../02-design/screen-inventory.md).

## API

```
GET    /api/workspaces/{id}/teams                 workspace:read              workspace
POST   /api/workspaces/{id}/teams                 workspace:manage_settings   workspace
GET    /api/teams/{id}                            workspace:read              workspace
PATCH  /api/teams/{id}                            workspace:manage_settings   workspace
DELETE /api/teams/{id}                            workspace:manage_settings   workspace
POST   /api/teams/{id}/members                    workspace:manage_settings   workspace   orOwner: lead
DELETE /api/teams/{id}/members/{personId}         workspace:manage_settings   workspace   orOwner: lead
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Two teams flagged CAB by concurrent saves | Unique partial index on `(workspace_id) where is_cab`; the second save gets 409 |
| Team owns a project in another workspace | Impossible — refused; both are workspace-scoped |
| Last lead removed | Allowed; the team simply has no lead until one is set |
| Person in the CAB team is also the requester of a change | `AP-8` — they cannot decide their own request, CAB or not |

## Out of scope

- Capacity planning and allocation UI → a candidate in [review-2026-09-05.md](../07-planning/review-2026-09-05.md)
- Team-scoped roles → roles are workspace/project-scoped ([RBAC](../01-architecture/rbac.md))

## Testing

`teams-reach-via-owner.spec.ts` (`TM-4` — a team member sees an owned project, a
non-member 404s); `teams-cab-membership-gates-decision.spec.ts` (`TM-5`, `TM-6`);
`teams-lead-can-edit-roster.spec.ts` (`TM-3`); `teams-delete-refused-while-owning.spec.ts`
(`TM-7`).

## Open questions

None.

## Related

- [RBAC](../01-architecture/rbac.md) · [Approvals](approvals.md) · [Search and saved views](search-and-saved-views.md)
