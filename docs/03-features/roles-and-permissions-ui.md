# Roles and permissions UI

- **Stage:** P4
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** RBAC

## Purpose

Let an administrator **create and edit roles in the interface**, without a deploy.

This is a headline feature, taken from kaneo, which stores role permission sets as rows
rather than as code constants. It matters commercially: every organisation's idea of what
a "lead" may do is different, and a product that ships seven fixed roles will be wrong for
almost everyone.

## What an administrator can do

- See every role in the workspace, with how many people hold it.
- Clone a built-in role and adjust it.
- Create a role from nothing.
- Rename and describe a role.
- Tick and untick individual capabilities in a grouped matrix.
- Set a rank, which governs who may edit whom.
- Delete a role, after reassigning its holders.
- Compare two roles side by side.
- See exactly what changed, and when, and by whom.

## Data

`role` — `scope`, `workspace_id`, `key`, `name`, `description`, `rank`,
`capabilities` jsonb, `is_system`, `is_editable`.

See [RBAC](../01-architecture/rbac.md) for the capability list and the built-in roles.

## Behaviour

**Editing**

- `RL-1` Capabilities are presented grouped by resource, not as a flat list of eighty
  checkboxes. The group for each capability is data, not a UI decision — it is the
  `group` field in [`rbac.md`](../01-architecture/rbac.md)'s capability table (rendered
  from `packages/permissions/src/capabilities.ts`), and every capability has exactly one.
- `RL-2` Each capability shows a one-line, plain-English description. Same source: the
  `description` field in [`rbac.md`](../01-architecture/rbac.md)'s capability table.
  "`work_item:assign` — Assign to anyone on the roster" is comprehensible;
  "`work_item:assign`" alone is not.
- `RL-3` **You cannot grant a capability you do not hold yourself.** Those checkboxes are
  disabled with an explanatory tooltip, and the API rejects them independently.
- `RL-4` **You cannot edit a role ranked above or equal to your own, with one exception:
  the role you yourself hold** — see the "Editing your own role" edge case below, which
  already depends on self-editing being possible. Any *other* role at your own rank is
  read-only. Equal rank is deliberately included for OTHER roles, not just "above": a
  rank-50 lead editing another rank-50 role is lateral privilege rewriting, and the safer
  default for a security-sensitive rank system is to refuse it rather than allow peers to
  rewrite each other. **A judgment call, made here rather than left silent — reversible to
  `>` (strictly above only) by removing the `=` if this reads as too strict in practice.**
- `RL-14` **You cannot create a role, or edit an existing role's rank to, a value greater
  than or equal to your own highest rank.** Without this, a rank-80 admin could create a
  rank-100 role they could then never edit (RL-4 would lock them out of their own
  creation), or hand a peer a rank exceeding their own. Checked server-side on both create
  and rank-change; the UI also disables the input for ranks it already knows are refused.
- `RL-5` Some capabilities imply others. Ticking `work_item:update` auto-ticks
  `work_item:read`, visibly, with the implication explained. The implication graph is
  data, not invented per-implementer: the `implies` field in
  [`rbac.md`](../01-architecture/rbac.md)'s capability table. Implication is transitive
  and is expanded both at grant time (so the stored role has the full closure) and at
  evaluation time (so a role stored before an implication was added still behaves
  correctly).
- `RL-6` `owner` is not editable. `instance_admin` is not editable and is not grantable
  from a workspace role.

**Safety**

- `RL-7` At least one **active** person must hold `workspace:manage_roles` after any
  save. The last role granting it cannot be deleted or stripped of that capability, and
  — because the last role could still be held only by a suspended person, which would
  strand the workspace exactly as if no one held it at all — a save that would leave the
  capability held solely by suspended holders is refused the same way. The UI explains
  why rather than silently disabling the control.
- `RL-8` Deleting a role is a pending action ([pending-actions.md](../01-architecture/pending-actions.md),
  click-level) and requires reassigning every holder first. The dialog lists them
  and offers a bulk reassignment.
- `RL-9` Changing a role takes effect **immediately** for every holder, because authority
  is resolved from the database on every request. The save dialog says so, with the
  number of people affected: "This will change permissions for 14 people immediately."
- `RL-10` Every change writes an audit row recording which capabilities were added and
  removed.

**Preview**

- `RL-11` A "What can this role do?" panel translates the capability set into plain
  sentences grouped by area, so a manager can check a role without reading capability
  names.
- `RL-12` A "Test as this role" affordance shows which navigation entries and which
  actions on a sample work item would be available. This is a preview, not impersonation.

**Comparison**

- `RL-13` Two roles can be diffed side by side, showing only where they differ. This is
  how you answer "what actually is the difference between lead and manager?" without
  reading two long lists.

## Custom capabilities are not supported

Capabilities are defined in code, in `packages/permissions/src/capabilities.ts`, because
every capability must correspond to a route policy and a code path. Administrators compose
roles from the fixed vocabulary; they do not invent new words.

This is stated explicitly because it is the obvious next request, and the answer needs to
be consistent.

## Permissions

| Action | Capability |
| --- | --- |
| See roles | `workspace:read` |
| Create, edit, delete roles | `workspace:manage_roles` |
| Assign a role to a person | `workspace:manage_members` |

Plus the two structural constraints: you cannot grant beyond your own authority
(`RL-3`), and you cannot edit a role ranked above or equal to your own, except the
role you hold yourself (`RL-4`).

## Screens

**Roles list** — name, description, rank, holder count, system badge, last modified.

**Role editor** —

```
Support Lead                                    Rank 50    [Save] [Cancel]
Clone of Lead. Can triage and assign, cannot manage services.

┌─ Work items ─────────────────────────────────────────────────────┐
│ [x] Read            See work items in reach                      │
│ [x] Create          Create work items                            │
│ [x] Update          Edit title, description, dates, labels,      │
│                     custom fields; archive                       │
│ [x] Transition      Change state, subject to workflow legality   │
│ [x] Assign          Assign to anyone on the roster               │
│ [ ] Delete          Soft-delete                                  │
└──────────────────────────────────────────────────────────────────┘
┌─ Service management ─────────────────────────────────────────────┐
│ [x] Read            See services                                 │
│ [ ] Manage          Manage services, dependencies and service    │
│                     state                             ⓘ disabled │
│                     You don't have this permission yourself      │
└──────────────────────────────────────────────────────────────────┘

▸ Projects   ▸ Members   ▸ Time & cost   ▸ Workspace

What this role can do ▾            Compare with ▾            History ▾
```

The `capability-matrix` primitive in `packages/ui` renders this.

## API

```
GET    /api/workspaces/{id}/roles              workspace:read
POST   /api/workspaces/{id}/roles              workspace:manage_roles
GET    /api/roles/{id}                         workspace:read
PATCH  /api/roles/{id}                         workspace:manage_roles
DELETE /api/roles/{id}                         workspace:manage_roles
GET    /api/roles/{id}/holders                 workspace:read
POST   /api/roles/{id}/reassign                workspace:manage_members
GET    /api/capabilities                       workspace:read
GET    /api/roles/{a}/compare/{b}              workspace:read
GET    /api/roles/{id}/history                 workspace:read
POST   /api/roles/{id}/preview                 workspace:read
```

`GET /api/roles/{id}/history` returns the audit rows `RL-10` requires (who changed which
capabilities, when), powering the role editor's `History ▾` affordance.
`POST /api/roles/{id}/preview` returns the navigation entries and work-item actions a
holder of this role's *proposed* (not-yet-saved) capability set would see, powering `RL-12`
("Test as this role") — it must accept the draft capability set in the request body rather
than reading the persisted role, since the whole point is previewing a change before saving
it.

`GET /api/capabilities` returns the vocabulary with descriptions and implication rules, so
the UI never hard-codes the list.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Editing your own role to remove your own access | Allowed but requires typed confirmation; you may lock yourself out and are told so |
| Two administrators editing one role concurrently | Optimistic concurrency, 409, with a diff of what changed |
| Role with zero capabilities | Allowed. Effectively a placeholder with no access |
| Role name collides | Names need not be unique; the stable `key` is. Duplicates are warned about |
| System role cloned then the original changes | The clone is independent. No inheritance |
| Capability removed from the codebase | Migration strips it from every role and audits the change |

## Out of scope

- Project-scope role overrides → [settings-hierarchy.md](settings-hierarchy.md)
- Instance-level administration → [god-mode.md](god-mode.md)

## Testing

Unit: `role-privilege-escalation.spec.ts` (`RL-3`); `role-rank-guard.spec.ts`
(`RL-4`, `RL-14`); `capability-implication.spec.ts` (`RL-5`);
`last-admin-role-protected.spec.ts` (`RL-7`, including the suspended-holder case).

Integration: a role change takes effect on the very next request; the API rejects granting
a capability the actor lacks, even when the UI is bypassed.

E2E: clone a role, remove a capability, observe a holder immediately losing the
corresponding button; attempt to delete the last administrating role and see it refused
with an explanation.

## Open questions

None.

## Related

- [RBAC](../01-architecture/rbac.md) · [Settings hierarchy](settings-hierarchy.md)
