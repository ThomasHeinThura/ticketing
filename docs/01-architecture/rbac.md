# RBAC

> Two axes: **reach** (what you can see) and **authority** (what you can change).
> Roles are **rows in the database**, created and edited by administrators in the UI.

## Why two axes

v1 discovered this the hard way. When "see everything" and "change everything" are one
role ladder, granting a support lead visibility across all customers silently grants them
the power to reconfigure those customers. Splitting the axes means visibility and power
are granted independently and reviewed independently.

| Axis | Question | Determined by |
| --- | --- | --- |
| **Reach** | Which organisations, workspaces and projects can this person see? | Memberships, plus an explicit `sees_all` grant |
| **Authority** | Which capabilities does this person hold in a given scope? | The roles attached to those memberships |

An authority check **never** consults reach, and a reach check never consults authority.
Enforced by the type system: the evaluator takes them as separate arguments.

## Capabilities

A capability is the atom: `resource:action`.

```
instance:admin           instance:read_audit        instance:manage_plugins
workspace:read           workspace:update           workspace:delete
workspace:manage_members workspace:manage_roles     workspace:manage_settings
project:create           project:read               project:update
project:delete           project:archive            project:manage_settings
work_item:create         work_item:read             work_item:update
work_item:delete         work_item:assign           work_item:transition
work_item:rank           work_item:set_priority     work_item:escalate_priority
comment:create           comment:create_internal    comment:update_any
comment:delete_any
label:create             label:update               label:delete
custom_field:manage
sla_policy:read          sla_policy:manage
workflow:read            workflow:manage
approval:request         approval:decide            approval:decide_cab
request_type:manage      intake:triage
time_entry:create        time_entry:read_any        time_entry:manage_rates
budget:read              budget:manage
report:read              report:read_all            report:export
kb_article:read          kb_article:write           kb_article:publish
service:manage           change:manage              release:manage
member:invite            member:remove
api_key:manage           webhook:manage
```

Naming rules: singular snake_case resource, colon, verb. `*_any` means "including records
you do not own". Add new capabilities to `packages/permissions/src/capabilities.ts` and
nowhere else.

## Roles are editable rows

This is a headline feature, inherited from kaneo's `workspace_role` design and extended.

```
role
  id            text pk
  scope         text        -- "instance" | "workspace" | "project"
  workspace_id  text null
  key           text        -- stable slug, e.g. "support-lead"
  name          text        -- display name, editable
  description   text
  rank          integer     -- for comparisons; higher wins
  capabilities  jsonb       -- string[] of capability names
  is_system     boolean     -- system roles cannot be deleted
  is_editable   boolean     -- some system roles may still be edited
  created_at, updated_at
```

An administrator opens **Workspace settings → Roles**, sees the built-in roles, clones
one, renames it, ticks and unticks capabilities in a grouped matrix, and saves. The role
is immediately assignable. No deploy, no code.

Guardrails:

- You cannot grant a capability you do not hold. The UI greys them out; the API rejects
  them.
- You cannot edit a role whose `rank` is above your own.
- The last role holding `workspace:manage_roles` in a workspace cannot be deleted or
  stripped of it — otherwise the workspace becomes unadministrable.
- `instance:admin` is not grantable through workspace roles at all.

Detail and screens: [Roles and permissions UI](../03-features/roles-and-permissions-ui.md).

## Built-in roles

Seeded on workspace creation. All except `owner` are editable.

| Key | Rank | Intent |
| --- | --- | --- |
| `owner` | 100 | Everything, including deleting the workspace. Not editable. |
| `admin` | 80 | Everything except deleting the workspace |
| `manager` | 60 | Runs delivery: create projects, manage members, author SLA policies and workflows |
| `lead` | 50 | Assigns work, triages intake, decides approvals within reach |
| `member` | 40 | Creates and updates work items, comments internally |
| `viewer` | 20 | Read-only |
| `customer` | 10 | Portal only. Off the ladder — see below |

Instance scope has one system role: `instance_admin`, holding `instance:*`.

## The customer role is special

Customers are not "a low-ranked member". They are a different kind of actor, and their
constraints are behavioural, not just capability-based. These rules live in
`packages/domain` and are enforced regardless of capabilities:

| Customers may | Customers may never |
| --- | --- |
| Raise requests from the published catalogue | Assign work to anyone |
| Comment publicly | See or write internal comments |
| Re-rank **their own** backlog | Re-rank anyone else's |
| **Escalate** priority (medium → urgent) | **De-escalate** priority |
| Approve requests addressed to them | Approve a request they raised |
| Read published KB articles for their organisation | See staff names on internal activity |
| Rate a resolution | See SLA policy internals, only their own SLA state |
| View their organisation's projects | See any other organisation. Ever. |

Modelled on Jira Service Management, which got these rules right.

## Reach

```ts
type Reach =
  | { kind: 'all' }                          // instance admin, or sees_all granted
  | { kind: 'organisation'; ids: string[] }  // customers: their org only
  | { kind: 'membership' };                  // staff: projects they are a member of
```

Resolution order for "may this person see project P?":

1. `instance:admin` ⇒ yes.
2. Explicit `sees_all` grant on their workspace membership ⇒ yes.
3. Project membership ⇒ yes.
4. Membership of an **ancestor** project ⇒ yes (hierarchy inheritance, from OpenProject).
5. Team membership where the team owns the project ⇒ yes.
6. Customer whose organisation is the project's customer ⇒ yes.
7. Otherwise ⇒ no, and the response is **`404`**, not `403`.

## Authority

```ts
can(identity, 'work_item:assign', { projectId })
```

The evaluator gathers every role attached to the identity's memberships that apply to the
given scope, unions their capabilities, and tests membership. Scopes narrow: a project
role overrides a workspace role for that project.

## Route policies — the anti-v1 mechanism

**Every route declares its policy at definition time.**

```ts
// apps/api/src/work-item/policy.ts
export const workItemPolicies = {
  'POST /api/work-items':            { capability: 'work_item:create', scope: 'project' },
  'GET /api/work-items/{id}':        { capability: 'work_item:read',   scope: 'work_item' },
  'PUT /api/work-items/{id}/assign': { capability: 'work_item:assign', scope: 'work_item' },
  'GET /api/public/branding':        { public: true, reason: 'login page needs branding' },
} satisfies PolicyMap;
```

Two CI tests make this load-bearing:

1. **Route coverage test** — enumerates the OpenAPI route table and fails if any route
   has no entry in a policy map. A public route must say `public: true` *with a reason*,
   so "public" is a deliberate act, not an omission.
2. **Permission matrix test** — for every built-in role × every route, asserts the
   expected allow/deny. The matrix is a checked-in fixture; changing behaviour requires
   changing the fixture, which shows up in review as a diff.

v1 shipped 11 authorization holes past a green test suite. These two tests are the
structural answer. See [Security model](security-model.md).

## 404 versus 403

| Situation | Response |
| --- | --- |
| Out of reach | **404** — the resource does not exist, as far as you are concerned |
| In reach, insufficient authority | **403** — with the missing capability named |
| Not authenticated | **401** |

Returning `403` for out-of-reach would confirm that a record exists, which is a tenant
information leak.

## Elevated and audited actions

Some actions require a fresh authentication (re-enter password or MFA within the last
five minutes) regardless of capability:

- Changing an identity provider's configuration
- Granting `instance:admin`
- Deleting a workspace or a project
- Starting an impersonation session
- Rotating the encryption key

## Anti-patterns

```ts
// ✗ role name check in a handler
if (user.role === 'admin') { … }

// ✗ authority derived from reach
if (identity.reach.kind === 'all') { allowEdit(); }

// ✗ frontend-only gate
{isAdmin && <DeleteButton />}   // fine as UX, NEVER as the only check

// ✓
await requireCapability(identity, 'project:delete', { projectId });
```

The frontend hides what you cannot do — that is good UX. The server decides what you may
do — that is security. Both, always.

## Related

- [Auth and identity](auth-and-identity.md) · [Multi-tenancy](multi-tenancy.md)
- [Security model](security-model.md)
- [Roles and permissions UI](../03-features/roles-and-permissions-ui.md)
