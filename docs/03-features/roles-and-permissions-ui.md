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

- `RL-1` Capabilities are presented grouped by resource — Work items, Projects, SLA,
  Approvals, Administration — not as a flat list of eighty checkboxes.
- `RL-2` Each capability shows a one-line, plain-English description.
  "`work_item:assign` — Assign work to other people" is comprehensible;
  "`work_item:assign`" alone is not.
- `RL-3` **You cannot grant a capability you do not hold yourself.** Those checkboxes are
  disabled with an explanatory tooltip, and the API rejects them independently.
- `RL-4` **You cannot edit a role ranked above your own.** It is shown read-only.
- `RL-5` Some capabilities imply others. Ticking `work_item:update` auto-ticks
  `work_item:read`, visibly, with the implication explained.
- `RL-6` `owner` is not editable. `instance_admin` is not editable and is not grantable
  from a workspace role.

**Safety**

- `RL-7` The last role holding `workspace:manage_roles` cannot be deleted or stripped of
  that capability. The UI explains why rather than silently disabling the control.
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
(`RL-3`), and you cannot edit above your own rank (`RL-4`).

## Screens

**Roles list** — name, description, rank, holder count, system badge, last modified.

**Role editor** —

```
Support Lead                                    Rank 50    [Save] [Cancel]
Clone of Lead. Can triage and assign, cannot change SLA policy.

┌─ Work items ─────────────────────────────────────────────────────┐
│ [x] Read            See work items in projects you can access     │
│ [x] Create          Raise new work items                          │
│ [x] Update          Edit title, description, fields               │
│ [x] Transition      Move work items between states                │
│ [x] Assign          Assign work to other people                   │
│ [ ] Delete          Permanently remove work items                 │
└──────────────────────────────────────────────────────────────────┘
┌─ SLA ────────────────────────────────────────────────────────────┐
│ [x] Read            View SLA policies                             │
│ [ ] Manage          Create and edit SLA policies      ⓘ disabled  │
│                     You don't have this permission yourself       │
└──────────────────────────────────────────────────────────────────┘

▸ Projects   ▸ Approvals   ▸ Time & cost   ▸ Administration

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
```

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

Unit: privilege-escalation guard (`RL-3`); rank guard (`RL-4`); implication expansion;
last-administrator protection (`RL-7`).

Integration: a role change takes effect on the very next request; the API rejects granting
a capability the actor lacks, even when the UI is bypassed.

E2E: clone a role, remove a capability, observe a holder immediately losing the
corresponding button; attempt to delete the last administrating role and see it refused
with an explanation.

## Open questions

None.

## Related

- [RBAC](../01-architecture/rbac.md) · [Settings hierarchy](settings-hierarchy.md)
