# RBAC

> Two axes: **reach** (what you can see) and **authority** (what you can change).
> Roles are **rows in the database**, created and edited by administrators in the UI.

> Rewritten 2026-09-05 after the [planning review](../07-planning/review-2026-09-05.md):
> the policy registry gained the policy kinds the specs actually use, the capability list
> gained the write capabilities that were missing, and the built-in roles gained the
> capability matrix that the permission-matrix test and the seed data are generated from.

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

A capability is the atom: `resource:action`. The list below is **the** list — it is
`packages/permissions/src/capabilities.ts`, rendered. Each has a **group** (the heading
the role editor shows it under, `RL-1`), a one-line **description** (`RL-2`), and may
**imply** other capabilities (`RL-5`): ticking a capability auto-ticks what it implies,
implication is transitive, and it is expanded at evaluation time as well as at grant time
so a role stored without the implied entry still behaves correctly.

| Group | Capability | Implies | Description |
| --- | --- | --- | --- |
| **Instance** | `instance:admin` | every `instance:*` | Administer the whole deployment (God Mode) |
| | `instance:read_audit` | | Read the instance audit log |
| | `instance:manage_plugins` | | Configure, test, enable and disable plugins |
| | `instance:manage_jobs` | | Change job cadence, enable/disable, trigger manually |
| | `instance:manage_terminology` | | Edit instance-level terminology overrides |
| **Workspace** | `workspace:read` | | See the workspace and its settings |
| | `workspace:update` | `workspace:read` | Edit workspace general settings |
| | `workspace:delete` | `workspace:update` | Delete the workspace |
| | `workspace:manage_members` | `workspace:read` | Add and remove workspace members |
| | `workspace:manage_roles` | `workspace:read` | Create and edit roles |
| | `workspace:manage_settings` | `workspace:read` | Types, workflows, SLA policies, calendars, request types, custom fields, labels, estimates, automations, canned responses, workspace terminology |
| **Projects** | `project:create` | | Create a project or managed service |
| | `project:read` | | See a project in reach |
| | `project:update` | `project:read` | Edit project fields, health, milestones, prerequisites, stakeholders, document links — **not** `parent_id` or `owner_team_id` |
| | `project:manage_members` | `project:read` | Manage the project roster and per-project roles, and the two reach-affecting fields `parent_id` and `owner_team_id` (see [Reach](#reach)) |
| | `project:manage_settings` | `project:update` | Project states, features, labels, SLA and calendar assignment, automations |
| | `project:archive` | `project:update` | Archive and restore |
| | `project:delete` | `project:archive` | Soft-delete |
| **Work items** | `work_item:read` | | See work items in reach |
| | `work_item:create` | `work_item:read` | Create work items |
| | `work_item:update` | `work_item:read` | Edit title, description, dates, labels, custom fields; archive |
| | `work_item:delete` | `work_item:update` | Soft-delete |
| | `work_item:assign` | `work_item:read` | Assign to anyone on the roster |
| | `work_item:transition` | `work_item:read` | Change state, subject to workflow legality |
| | `work_item:rank` | `work_item:read` | Re-order within a state or backlog |
| | `work_item:set_priority` | `work_item:escalate_priority` | Set priority up or down |
| | `work_item:escalate_priority` | | Raise priority only — the customer capability |
| | `work_item:export` | `work_item:read` | Export a view or list to CSV/XLSX |
| **Comments** | `comment:create` | `work_item:read` | Comment publicly |
| | `comment:create_internal` | `comment:create` | Comment internally |
| | `comment:update_own` | `comment:create` | Edit own comments within the window |
| | `comment:delete_own` | `comment:create` | Delete own comments |
| | `comment:update_any` | `comment:update_own` | Edit anyone's comment |
| | `comment:delete_any` | `comment:delete_own` | Delete anyone's comment |
| **Attachments** | `attachment:create` | `work_item:read` | Upload to a work item or comment |
| | `attachment:delete_own` | `attachment:create` | Delete own attachments |
| | `attachment:delete_any` | `attachment:delete_own` | Delete anyone's attachments |
| **Labels & fields** | `label:manage` | | Create, edit, delete labels |
| | `custom_field:manage` | | Define custom fields and sections |
| **Views** | `saved_view:create` | `work_item:read` | Create private saved views and queues |
| | `saved_view:share` | `saved_view:create` | Share a view with a team or the workspace |
| **Service desk** | `sla_policy:read` | | Read SLA policies and service calendars |
| | `sla_policy:manage` | `sla_policy:read` | Author policies and calendars |
| | `workflow:read` | | Read workflows |
| | `workflow:manage` | `workflow:read` | Create, edit, publish workflows |
| | `request_type:read` | | Read request types (triage needs this) |
| | `request_type:manage` | `request_type:read` | Author request types and per-organisation catalogues |
| | `intake:triage` | `request_type:read` | Claim, accept, decline, merge, clarify submissions; manage queues |
| | `approval:request` | `work_item:read` | Request a customer approval |
| | `approval:request_cab` | `approval:request` | Request a CAB approval (staff only) |
| | `approval:decide` | | Decide an approval addressed to you |
| | `approval:decide_cab` | `approval:decide` | Decide a CAB approval — **and** be a member of the CAB team |
| **Time & cost** | `time_entry:create` | | Log own time; start/stop own timer |
| | `time_entry:read_any` | | See anyone's entries |
| | `time_entry:update_any` | `time_entry:read_any` | Edit anyone's entries |
| | `time_entry:delete_any` | `time_entry:update_any` | Delete anyone's entries |
| | `time_entry:log_backdated` | `time_entry:create` | Log beyond the workspace backdating limit |
| | `time_entry:manage_rates` | `time_entry:read_any` | Rates, cost types; see cost data |
| | `budget:read` | | See budgets |
| | `budget:manage` | `budget:read` | Create and edit budgets |
| **Reports** | `report:read` | | Reports for your reach |
| | `report:read_all` | `report:read` | Reports across all projects |
| | `report:export` | `report:read` | Export a report |
| **Knowledge** | `kb_article:read` | | Read articles |
| | `kb_article:write` | `kb_article:read` | Draft and edit articles |
| | `kb_article:publish` | `kb_article:write` | Publish, archive, manage categories |
| **Service management** | `service:read` | | See services |
| | `service:manage` | `service:read` | Manage services, dependencies and service state |
| | `change:manage` | | Change details, freezes, freeze override (elevated) |
| | `release:manage` | | Releases and checklists |
| **Members** | `member:invite` | | Invite people |
| | `member:remove` | | Remove people |
| **Integrations** | `api_key:manage` | | Workspace service keys |
| | `webhook:manage` | | Webhooks, secret rotation, redelivery |
| **Automations** | `automation:manage` | | Rules at project scope (workspace scope also needs `workspace:manage_settings`) |

Naming rules: singular snake_case resource, colon, verb. `*_any` means "including records
you do not own"; `*_own` means only your own. Add new capabilities here and in
`capabilities.ts` in the same change — a CI test asserts they match, that every capability
is referenced by at least one route policy or documented domain rule, and that every
capability has exactly one group.

## Roles are editable rows

This is a headline feature, inherited from kaneo's `workspace_role` design and extended.

```
role
  id            text pk
  scope         text        -- "instance" | "organisation" | "workspace" | "project"
                            --   "organisation" exists for exactly one system role: customer
  workspace_id  text null
  key           text        -- server-generated kebab slug, unique per (scope, workspace_id), immutable
  name          text        -- display name, editable
  description   text
  rank          integer     -- for comparisons; higher wins
  capabilities  jsonb       -- string[] of capability names
  is_system     boolean     -- system roles cannot be deleted
  is_editable   boolean     -- some system roles may still be edited
  version       integer
  created_at, updated_at
```

An administrator opens **Workspace settings → Roles**, sees the built-in roles, clones
one, renames it, ticks and unticks capabilities in a grouped matrix, and saves. The role
is immediately assignable. No deploy, no code.

Guardrails:

- You cannot grant a capability you do not hold. The UI greys them out; the API rejects
  them.
- You cannot edit a role whose `rank` is **greater than or equal to** your own highest
  rank, and you cannot create or set a rank greater than or equal to your own — so a peer
  cannot rewrite a peer, and nobody can mint a role they could never edit.
- At least one **active** person must hold `workspace:manage_roles` after any save —
  otherwise the workspace becomes unadministrable.
- `instance:admin` is not grantable through workspace roles at all — nor through any
  identity connection, OIDC claim, SCIM attribute or group mapping
  ([identity-provisioning.md](../03-features/identity-provisioning.md) `IP-3`, `IP-21`).
  The same is true of `sees_all`.
- **Project-scope roles** exist as per-project overrides on the project Members screen —
  a membership at `scope = project` may carry a role whose `scope = project`. They are
  created from the same editor with the project as context; P4.

Detail and screens: [Roles and permissions UI](../03-features/roles-and-permissions-ui.md).

## Built-in roles and their capabilities

Seeded on workspace creation. All except `owner` are editable. **This table is the seed
data and the permission-matrix fixture** — a change here is a change to both, and shows
up in review as a diff.

| Key | Rank | Intent | Capabilities |
| --- | --- | --- | --- |
| `owner` | 100 | Everything, including deleting the workspace. Not editable | every capability except `instance:*` |
| `admin` | 80 | Everything except deleting the workspace | as `owner` minus `workspace:delete` |
| `manager` | 60 | Runs delivery: projects, members, policies, workflows | `workspace:read`, `workspace:manage_settings`, `workspace:manage_members`, `project:create`, `project:read`, `project:update`, `project:manage_members`, `project:manage_settings`, `project:archive`, all `work_item:*`, all `comment:*`, all `attachment:*`, `label:manage`, `custom_field:manage`, `saved_view:create`, `saved_view:share`, `sla_policy:manage`, `workflow:manage`, `request_type:manage`, `intake:triage`, `approval:request_cab`, `approval:decide`, all `time_entry:*`, `budget:manage`, `report:read_all`, `report:export`, `kb_article:publish`, `service:manage`, `change:manage`, `release:manage`, `member:invite`, `member:remove`, `webhook:manage`, `automation:manage` |
| `lead` | 50 | Assigns work, triages intake, decides approvals within reach | `workspace:read`, `project:read`, `project:update`, `project:manage_members`, `work_item:create`, `work_item:update`, `work_item:delete`, `work_item:assign`, `work_item:transition`, `work_item:rank`, `work_item:set_priority`, `work_item:export`, `comment:create_internal`, `comment:update_own`, `comment:delete_own`, `attachment:create`, `attachment:delete_own`, `label:manage`, `saved_view:share`, `sla_policy:read`, `workflow:read`, `request_type:read`, `intake:triage`, `approval:request`, `approval:decide`, `time_entry:create`, `time_entry:read_any`, `time_entry:log_backdated`, `budget:read`, `report:read`, `report:export`, `kb_article:write`, `service:read`, `member:invite`, `automation:manage` |
| `member` | 40 | Creates and updates work items, comments internally, self-assigns | `workspace:read`, `project:read`, `work_item:create`, `work_item:update`, `work_item:transition`, `work_item:rank`, `work_item:set_priority`, `comment:create_internal`, `comment:update_own`, `comment:delete_own`, `attachment:create`, `attachment:delete_own`, `saved_view:create`, `sla_policy:read`, `workflow:read`, `request_type:read`, `approval:request`, `approval:decide`, `time_entry:create`, `budget:read`, `report:read`, `kb_article:write`, `service:read` |
| `viewer` | 20 | Read-only | `workspace:read`, `project:read`, `work_item:read`, `sla_policy:read`, `workflow:read`, `request_type:read`, `report:read`, `kb_article:read`, `service:read` |
| `customer` | 10 | Portal only. Off the ladder — see below | `work_item:read`, `comment:create`, `attachment:create`, `attachment:delete_own`, `work_item:rank`, `work_item:escalate_priority`, `approval:decide`, `kb_article:read` — and nothing else, ever |

Self-assignment by a `member` is `work_item:update` on an item where the new assignee is
the actor — a documented ownership predicate, not `work_item:assign`
([assignment.md](../03-features/assignment.md)).

Instance scope has one system role: `instance_admin`, holding `instance:*`.

## The customer role is special

Customers are not "a low-ranked member". They are a different kind of actor, and their
constraints are behavioural, not just capability-based. These rules live in
`packages/domain` and are enforced regardless of capabilities — an administrator cannot
grant them away through the role editor:

| Customers may | Customers may never |
| --- | --- |
| Raise requests from their published catalogue | Assign work to anyone |
| Comment publicly | See or write internal comments |
| Re-rank **their own** backlog | Re-rank anyone else's |
| **Escalate** priority — any strictly increasing change | **De-escalate** — any decrease is refused with 403 |
| Approve requests addressed to them | Approve a request they raised |
| Read published KB articles for their organisation | See staff names as **assignees** (comment and approval authors are named; the assignee field is never exposed) |
| Rate a resolution | See SLA policy internals — only their own due time |
| View their organisation's projects | See any other organisation. Ever |
| Withdraw their own submission before triage | **Read any report or dashboard** |
| Reopen a resolved request within the window | Delete anything |

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
5. Team membership where the team **owns** the project — `project.owner_team_id` — ⇒ yes.
   Specified in [teams.md](../03-features/teams.md).
6. Customer whose organisation is the project's customer ⇒ yes.
7. Otherwise ⇒ no, and the response is **`404`**, not `403`.

**Reach-affecting fields are roster changes, not field edits.** Steps 4 and 5 are set by
two columns — `project.parent_id` and `project.owner_team_id` — and changing either grants
reach to people without any role changing. Both are therefore governed by
`project:manage_members`, **not** `project:update`, even though they appear on the project
General screen:

- `owner_team_id` — requires `project:manage_members` on the project; the team must belong
  to the same workspace; the change is audited as `project.reach_changed` with the team's
  current member list in `after`.
- `parent_id` (re-parenting) — requires `project:manage_members` on **both** the child and
  the prospective parent; refused across organisation boundaries; audited on both projects.

The route table marks these with a separate policy from the rest of `PATCH /api/projects/{id}`:
the General screen sends them to `PATCH /api/projects/{id}/ownership`, so a single policy
per route remains true. `owner-team-reach.test.ts` asserts a `lead` (holding
`project:update` but not `project:manage_members`) cannot move either field.

**The 404 is constant-shape.** An out-of-reach id and a non-existent id return the same
status, the same body, and go through the same lookup path (the row is fetched, then the
reach check fails — never "not found" short-circuited before the fetch), so neither the
error body nor the latency class tells a patient attacker which of the two it was. Both
count against the same rate-limit bucket.

Within a customer organisation, a work item or submission with
`customer_visibility = 'private'` is in reach only for its requester and its participants
([customer-portal.md](../03-features/customer-portal.md)); to a colleague it is **404**,
exactly like a cross-organisation record.

## Authority

```ts
can(identity, 'work_item:assign', { projectId })
```

The evaluator gathers every role attached to the identity's memberships that apply to the
given scope, expands implications, unions their capabilities, and tests membership. Scopes
narrow: a project role overrides a workspace role for that project.

## Route policies — the anti-v1 mechanism

**Every route declares its policy at definition time.** A policy is one of exactly five
kinds — the specs may use no other form, and the route-coverage test rejects any other:

```ts
type Policy =
  | { capability: Capability; scope: Scope; orOwner?: OwnerPredicate }   // 1. capability, optionally satisfied by ownership
  | { authenticated: true; self: true }                                  // 2. the caller's own records only (/api/me/*)
  | { portal: 'customer'; predicate: PortalPredicate }                   // 3. a customer session on /api/portal/*, scoped by predicate
  | { public: true; reason: string }                                     // 4. unauthenticated, with a stated reason
  | { delegated: 'better-auth' | 'websocket' | 'metrics' | 'scim'; reason: string } // 5. mounts outside the session model, allowlisted explicitly

type Scope = 'instance' | 'workspace' | 'project' | 'work_item' | 'organisation';
type OwnerPredicate = 'row.person_id === identity.personId' | 'row.created_by === identity.personId' | 'row.requester_id === identity.personId';
type PortalPredicate = 'own_request' | 'own_organisation' | 'addressed_approval' | 'own_submission';
```

- **Kind 1** is the normal case. `orOwner` expresses "the author within the edit window, or
  `comment:update_any`" without inventing an OR of two policies: the capability is checked
  first; if absent, the named ownership predicate is evaluated against the loaded row.
- **Kind 2** replaces every `(self)` in the specs: the handler may only touch rows keyed to
  `identity.personId`, and the evaluator refuses a path or query parameter naming another
  person.
- **Kind 3** replaces every `(portal session)`: the session must be `portal = customer`,
  the host must be the portal origin, and the predicate scopes the query — `own_request`
  (requester or participant; colleagues per `customer_visibility`), `own_organisation`
  (catalogue, KB, projects), `addressed_approval`, `own_submission`.
- **Kind 4** requires a `reason`, so "public" is a deliberate, reviewable act.
- **Kind 5** exists because the route-coverage test enumerates **Hono's router**
  (`app.routes`), not the OpenAPI document — the OpenAPI document does not know about
  `/auth/*`, `/ws` or `/metrics`, and those are precisely the surfaces v1 leaked through.

**Workspace context** for routes with `scope: 'workspace'` and no workspace in the path
(`/api/custom-fields`, `/api/capabilities`, `/api/webhooks` …) is the `X-Workspace-Id`
header (or `?workspace=`), validated against the identity's memberships **before** the
policy check; absent ⇒ `400`. Defined once in [api-design.md](api-design.md).

```ts
// apps/api/src/work-item/policy.ts
export const workItemPolicies = {
  'POST  /api/projects/{projectId}/work-items': { capability: 'work_item:create', scope: 'project' },
  'GET   /api/work-items/{key}':                { capability: 'work_item:read',   scope: 'work_item' },
  'POST  /api/work-items/{key}/assign':         { capability: 'work_item:assign', scope: 'work_item' },
  'PATCH /api/comments/{id}':                   { capability: 'comment:update_any', scope: 'work_item', orOwner: 'row.person_id === identity.personId' },
  'GET   /api/me/settings':                     { authenticated: true, self: true },
  'GET   /api/portal/requests/{ref}':           { portal: 'customer', predicate: 'own_request' },
  'GET   /api/public/branding':                 { public: true, reason: 'rendered on the login page' },
} satisfies PolicyMap<typeof routes>;   // keys derive from the route table — a mismatch is a type error
```

Three CI tests make this load-bearing:

1. **Route coverage test** — enumerates every route in Hono's router and fails if any
   lacks an entry in a policy map, or has an entry of an unknown shape.
2. **Permission matrix test** — for every built-in role × every route, asserts the
   expected allow/deny, twice: once for **capability** and once for **reach** (does the
   same call 404 when the resource is outside the identity's memberships). The fixture is
   generated from the role table above.
3. **Custom-role test** — an administrator-created role is run through the same matrix.

v1 shipped 11 authorization holes past a green test suite. These tests are the structural
answer. See [Security model](security-model.md).

## 404 versus 403 versus 409

| Situation | Response |
| --- | --- |
| Out of reach | **404** — the resource does not exist, as far as you are concerned |
| In reach, insufficient capability | **403** — with the missing capability named |
| Capability held, but the workflow has no legal transition for this actor | **409** — illegal transition, with the reason |
| Not authenticated | **401** |

Returning `403` for out-of-reach would confirm that a record exists, which is a tenant
information leak.

## Elevated and audited actions — the single list

Some actions require a fresh authentication regardless of capability — **the second
factor when the account has one** (never "password *or* MFA"), an IdP re-authentication
with `prompt=login` for SSO-only accounts — which issues a single-use confirmation token
bound to the specific action and target, valid five minutes
([security model](security-model.md#sessions-csrf-and-step-up)). **This is the only
list**; God Mode, the security model and the feature specs cite it rather than restating it.

| Action | Route |
| --- | --- |
| Creating or changing an identity connection (OIDC) or a non-OIDC auth plugin | `POST /api/instance/identity-connections`, `PATCH /api/instance/identity-connections/{id}`; `POST/PATCH /api/instance/plugins/{id}` for `auth.*` |
| Creating, rotating or revoking a **SCIM token** | `POST /api/instance/identity-connections/{id}/scim`, `…/scim/rotate-token`, `…/scim/revoke-token` |
| A group→role mapping that grants staff access, a role above `member`, or changes reach — **conditionally**: `PATCH …/scim` is elevated only when the change does one of those ([identity-provisioning.md](../03-features/identity-provisioning.md) `IP-6`) | `PATCH /api/instance/identity-connections/{id}/scim` |
| Granting `instance:admin` | `POST /api/instance/users/{id}/grant-admin` |
| Resetting another person's second factor | `POST /api/instance/users/{id}/reset-mfa` — with a mandatory verification note |
| Creating a workspace **service** API key | `POST /api/workspaces/{id}/api-keys` — bounded by the creator's authority |
| Granting `sees_all` on a membership | `PATCH /api/workspaces/{id}/members/{personId}` with `sees_all: true` — never self-grantable; audited as a reach change |
| Marking a provider "MFA satisfied upstream", or a JIT rule that provisions `side = staff` or a role above `member` | `PATCH /api/instance/identity-connections/{id}` |
| Deleting a workspace, organisation, project, API key, webhook or identity connection — **typed exact name/key + step-up**, through a pending action | `DELETE /api/workspaces/{id}`, `DELETE /api/instance/organisations/{id}`, `DELETE /api/projects/{projectId}`, `DELETE /api/me/api-keys/{id}`, `DELETE /api/workspaces/{id}/api-keys/{id}`, `DELETE /api/webhooks/{id}`, `DELETE /api/instance/identity-connections/{id}`, `DELETE /api/instance/plugins/{id}` for `auth.*` ([pending-actions.md](pending-actions.md)) |
| Hard purge | `POST /api/instance/purge` (`PA-13`) |
| Starting an impersonation session | `POST /api/instance/users/{id}/impersonate` |
| Rotating the encryption key | `POST /api/instance/rotate-encryption-key` (operator-staged — see [runbook](../05-operations/runbook.md)) |
| Exporting instance data — audit CSV, configuration export, full export | `POST /api/instance/audit/export`, `GET /api/instance/config-export`, `POST /api/instance/export` |
| Rotating a webhook secret | `POST /api/webhooks/{id}/rotate-secret` |
| Overriding a change freeze | `POST /api/work-items/{key}/change/override-freeze` |

### Session-only routes

Elevated actions, and the approval/denial of a **pending action**
([pending-actions.md](pending-actions.md)), are accepted only from a **browser session**:
an API key, an `is_mcp` key or an impersonation session is refused `403 session_required`.
This is a credential check in the auth middleware, applied before the route's policy, and
`tests/permissions/session-only.test.ts` enumerates the routes it covers.

### Deletion is never immediate

Every user-initiated `DELETE` — from the web UI, the REST API, a personal API key or an
MCP tool — returns `202` with a pending action that the requesting human approves in the
UI; the server re-runs the route policy at approval time and executes exactly the approved
targets. The confirmation level (click, typed name, typed count, step-up) is decided by the
server from the target type. Rules, table and routes: [pending-actions.md](pending-actions.md).

## MCP — the same RBAC, not a second one

The MCP server is an **alternate client** of the API, owned by a named human through a
personal API key ([mcp-server.md](../03-features/mcp-server.md)). There are no MCP
capabilities — no `mcp:admin`, `mcp:read`, `mcp:write` — and there never will be.
Effective MCP authority on every request is

```
current owner RBAC  ∩  key capability subset  ∩  current reach  ∩  route policy  ∩  feature availability
```

evaluated against the owner's *current* identity, so deactivation, membership removal,
role change or key revocation take effect on the next call. An `is_mcp` key defaults to
the read capabilities; writes are an explicit, warned opt-in. Workspace service keys
cannot be MCP keys (a schema `CHECK`, [data-model.md](data-model.md) §2).

## Anti-patterns

```ts
// ✗ role name check in a handler
if (user.role === 'admin') { … }

// ✗ authority derived from reach
if (identity.reach.kind === 'all') { allowEdit(); }

// ✗ matching a work item type or state by name
if (type.name === 'Change') { requireCab(); }        // use type.is_change; use state.group

// ✗ frontend-only gate
{isAdmin && <DeleteButton />}   // fine as UX, NEVER as the only check

// ✓
await requireCapability(identity, 'project:delete', { projectId });
```

The frontend hides what you cannot do — that is good UX. The server decides what you may
do — that is security. Both, always.

## Related

- [Auth and identity](auth-and-identity.md) · [Multi-tenancy](multi-tenancy.md)
- [Security model](security-model.md) · [API design](api-design.md)
- [Roles and permissions UI](../03-features/roles-and-permissions-ui.md) · [Teams](../03-features/teams.md)
