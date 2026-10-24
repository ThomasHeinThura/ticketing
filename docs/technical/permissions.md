# Permissions contract

Reach and authority are separate checks. Membership determines reachable resources; scoped roles supply capabilities. Authentication alone grants neither. Every route declares one policy. No provider claim grants instance administration or unrestricted reach.

## Capabilities

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
| | `workspace:transfer_ownership` | `workspace:read` | Transfer ownership of the workspace to another existing member |
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
| | `work_item:escalate_priority` | `work_item:read` | Raise priority only — the customer capability |
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
| **Views** | `saved_view:read` | | List and open saved views and queues shared with you |
| | `saved_view:create` | `saved_view:read`, `work_item:read` | Create private saved views and queues |
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
| | `time_entry:update_own` | `time_entry:create` | Edit own entries |
| | `time_entry:delete_own` | `time_entry:create` | Delete own entries |
| | `time_entry:read_any` | | See anyone's entries |
| | `time_entry:update_any` | `time_entry:read_any`, `time_entry:update_own` | Edit anyone's entries |
| | `time_entry:delete_any` | `time_entry:update_any`, `time_entry:delete_own` | Delete anyone's entries |
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

## Built-in roles

| Key | Rank | Intent | Capabilities |
| --- | --- | --- | --- |
| `owner` | 100 | Everything, including deleting the workspace. Not editable | every capability except `instance:*` |
| `admin` | 80 | Everything except deleting the workspace or transferring its ownership | as `owner` minus `workspace:delete` and `workspace:transfer_ownership` |
| `manager` | 60 | Runs delivery: projects, members, policies, workflows | `workspace:read`, `workspace:manage_settings`, `workspace:manage_members`, `project:create`, `project:read`, `project:update`, `project:manage_members`, `project:manage_settings`, `project:archive`, all `work_item:*`, all `comment:*`, all `attachment:*`, `label:manage`, `custom_field:manage`, `saved_view:create`, `saved_view:share`, `sla_policy:manage`, `workflow:manage`, `request_type:manage`, `intake:triage`, `approval:request_cab`, `approval:decide`, all `time_entry:*`, `budget:manage`, `report:read_all`, `report:export`, `kb_article:publish`, `service:manage`, `change:manage`, `release:manage`, `member:invite`, `member:remove`, `webhook:manage`, `automation:manage` |
| `lead` | 50 | Assigns work, triages intake, decides approvals within reach | `workspace:read`, `project:read`, `project:update`, `project:manage_members`, `work_item:create`, `work_item:update`, `work_item:delete`, `work_item:assign`, `work_item:transition`, `work_item:rank`, `work_item:set_priority`, `work_item:export`, `comment:create_internal`, `comment:update_own`, `comment:delete_own`, `attachment:create`, `attachment:delete_own`, `label:manage`, `saved_view:share`, `sla_policy:read`, `workflow:read`, `request_type:read`, `intake:triage`, `approval:request`, `approval:decide`, `time_entry:create`, `time_entry:update_own`, `time_entry:delete_own`, `time_entry:read_any`, `time_entry:log_backdated`, `budget:read`, `report:read`, `report:export`, `kb_article:write`, `service:read`, `member:invite`, `automation:manage` |
| `member` | 40 | Creates and updates work items, comments internally, self-assigns | `workspace:read`, `project:read`, `work_item:create`, `work_item:update`, `work_item:transition`, `work_item:rank`, `work_item:set_priority`, `comment:create_internal`, `comment:update_own`, `comment:delete_own`, `attachment:create`, `attachment:delete_own`, `saved_view:create`, `sla_policy:read`, `workflow:read`, `request_type:read`, `approval:request`, `approval:decide`, `time_entry:create`, `time_entry:update_own`, `time_entry:delete_own`, `budget:read`, `report:read`, `kb_article:write`, `service:read` |
| `viewer` | 20 | Read-only | `workspace:read`, `project:read`, `work_item:read`, `saved_view:read`, `sla_policy:read`, `workflow:read`, `request_type:read`, `report:read`, `kb_article:read`, `service:read` |
| `customer` | 10 | Portal only. Off the ladder — see below | `work_item:read`, `comment:create`, `attachment:create`, `work_item:rank`, `work_item:escalate_priority`, `approval:decide`, `kb_article:read` — and nothing else, ever |

`project-lead` is the project-scope counterpart of `lead` (rank 50). Project authority overrides workspace authority for that project; it does not grant workspace-wide authority. The customer role is outside the staff ladder and stays portal-bound. Self-assignment and customer exceptions require their declared row predicate, not a role-name shortcut.

Capability names persist in roles and credentials. Rename/removal requires a compatibility migration; adding a capability does not expand existing API-key ceilings. MCP uses ordinary capabilities intersected with the credential ceiling. Never add MCP-only capabilities.

## Policy kinds

| Kind | Required declaration |
| --- | --- |
| Capability | Capability, scope, scope source and required reach; an explicit reason is required when no single resource can be checked. Optional owner/self branches use registered row predicates. |
| Self | Authenticated caller, self binding and explicit person parameter or reason no person parameter exists; declared workspace membership remains mandatory. |
| Customer portal | Customer session and registered portal predicate; agent credentials cannot substitute for the portal identity. |
| Public | Explicit public declaration and reason; session-only/elevated flags cannot imply authentication here. |
| Delegated | Explicit Better Auth, websocket, metrics or SCIM delegation and reason; the delegated handler enforces its own declared boundary. |

An elevated exemption requires both `elevated: false` and its written reason. Elevated actions are session-only and use a fresh, one-use, operation-bound proof. Unsupported required authentication fails closed. Missing/unreachable resources share 404; reachable insufficient authority returns 403; valid concurrency conflicts return 409.

## Elevated and audited actions

This is the retained route inventory. Existing routes are compared in both directions with their policy registry by the permissions suite. A listed future route is a requirement, not evidence that it exists. Approval, exact target binding, step-up and recovery rules also apply to deletions.


| Action | Route |
| --- | --- |
| Creating or changing an identity connection (OIDC) or a non-OIDC auth plugin | `POST /api/instance/identity-connections`, `PATCH /api/instance/identity-connections/{id}`; `POST/PATCH /api/instance/plugins/{id}` for `auth.*` |
| Creating, rotating or revoking a **SCIM token** | `POST /api/instance/identity-connections/{id}/scim`, `POST /api/instance/identity-connections/{id}/scim/rotate-token`, `POST /api/instance/identity-connections/{id}/scim/revoke-token` |
| OIDC mapping administration — every create, edit, enable and disable is unconditionally elevated, session-only and audited, including customer/display-only changes; forbidden authority remains impossible (identity-provisioning.md `IP-6`, `IP-34`) | `POST /api/instance/identity-connections/{id}/oidc-group-mappings`, `PATCH /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}` |
| Every SCIM administration PATCH is route-wide elevated, session-only and audited, with strict DTO, parent-version CAS and dedicated `scim_admin_update` PA-15 proof. An implementation lacking its verifier fails closed. Forbidden authority remains impossible (identity-provisioning.md `IP-6`, `IP-20`–`IP-22`; api-design.md) | `PATCH /api/instance/identity-connections/{id}/scim` |
| Granting `instance:admin` | `POST /api/instance/users/{id}/grant-admin` |
| Approving the canonical `delete` pending action for a `user`, with exact current account email and action-bound step-up | `POST /api/me/pending-actions/{id}/approve` |
| Resetting another person's second factor | `POST /api/instance/users/{id}/reset-mfa` — requires a mandatory verification note and fresh step-up proof; unavailable when the target has no enabled local second factor |
| Creating a workspace **service** API key | `POST /api/workspaces/{id}/api-keys` — bounded by the creator's authority |
| Granting `sees_all` on a membership | `PATCH /api/workspaces/{id}/members/{personId}` with `sees_all: true` — never self-grantable; audited as a reach change |
| Marking a provider "MFA satisfied upstream", or a JIT rule that provisions `side = staff` or a role above `member` | `PATCH /api/instance/identity-connections/{id}` |
| Deleting a workspace, organisation, project, API key, webhook or identity connection — **typed exact name/key + step-up**, through a pending action | `DELETE /api/workspaces/{id}`, `DELETE /api/instance/organisations/{id}`, `DELETE /api/projects/{projectId}`, `DELETE /api/me/api-keys/{id}`, `DELETE /api/workspaces/{id}/api-keys/{keyId}`, `DELETE /api/webhooks/{id}`, `DELETE /api/instance/identity-connections/{id}`, `DELETE /api/instance/plugins/{id}` for `auth.*` (pending-actions.md) |
| Hard purge | `POST /api/instance/purge` (`PA-13`) |
| Starting an impersonation session | `POST /api/instance/users/{id}/impersonate` |
| Rotating the encryption key — the key itself is operator-staged via environment variables; this is the re-encryption step | `POST /api/instance/plugins/rotate-secrets` (starts `secrets-rekey` — see runbook) |
| Exporting instance data — audit CSV, configuration export, full export | `POST /api/instance/audit/export`, `GET /api/instance/config-export`, `POST /api/instance/export` |
| Rotating a webhook secret | `POST /api/webhooks/{id}/rotate-secret` |
| Creating a webhook, or changing an existing webhook's `url` — a standing outbound data channel carrying every event in the owner's reach to an arbitrary endpoint, indefinitely | `POST /api/webhooks`, and `PATCH /api/webhooks/{id}` when the body changes `url` (webhooks-and-api-keys.md `WH-14`) |
| Requesting deletion of a webhook (typed name + step-up pending action; registered target `webhook`) | `DELETE /api/webhooks/{id}` |
| Overriding a change freeze | `POST /api/work-items/{key}/change/override-freeze` |
| Creating, editing or deleting a workspace role — a role editor can mint authority up to their own rank | `POST /api/workspace/{workspaceId}/roles`, `PATCH /api/workspace/{workspaceId}/roles/{roleId}`, `DELETE /api/workspace/{workspaceId}/roles/{roleId}` |
| Transferring workspace ownership — owner-only, bound to the new owner (retained-constraints.md) | `POST /api/workspace/{workspaceId}/transfer-ownership` |

| Rotating the instance metrics bearer with an operation-bound proof | `POST /api/instance/observability/metrics-token/rotate` |

PA-15 operation keys for the elevated actions above that are not pending actions: `impersonation_start` (`POST /api/instance/users/{id}/impersonate`), `secrets_rotate` (`POST /api/instance/plugins/rotate-secrets`), `webhook_create` (`POST /api/webhooks`), `webhook_update_url` (`PATCH /api/webhooks/{id}` when `url` changes), `webhook_rotate_secret` (`POST /api/webhooks/{id}/rotate-secret`), `workspace_role_create` (`POST /api/workspace/{workspaceId}/roles`), `workspace_role_update` (`PATCH /api/workspace/{workspaceId}/roles/{roleId}`), `service_key_create` (`POST /api/workspaces/{id}/api-keys`) and `workspace_ownership_transfer` (`POST /api/workspace/{workspaceId}/transfer-ownership`). Role deletion is the exception on the list: it is a click-level pending action (`RL-8`), not a step-up operation. Every elevated route spends its proof inside its own write transaction; the closed classification of each `elevated: true` route lives in `apps/api/src/auth/elevated-enforcement.ts` and is checked by `pnpm test:permissions`. An impersonation session is refused every elevated, session-only, deletion, approval-decision, export and authority-minting route with a `403` naming `impersonation` (`GM-9`), enforced once in the app-wide auth guard; the impersonation exit control (`GM-11`) is always allowed.

## Reach

Reach is evaluated for the loaded resource from current persisted memberships and explicit grants. Project roster/roles and project parent/owner-team fields are reach-affecting changes, distinct from ordinary project edits.

## Safety invariants

Tenant reach, API-key ceilings, self/owner predicates, agent/customer separation, audit records and concurrency checks remain mandatory. Instance actions and authority-minting routes need elevation or a registered exemption. User deletion is a durable pending action. Impersonation cannot satisfy an elevated/session-only action.
