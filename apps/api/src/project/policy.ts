import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Project route policies.
 *
 * This file now classifies the whole inherited project surface (issue #8, retrofit plan
 * "delete first, then retrofit" — #6's removals settled first). All eight routes are
 * capability-kind (kind 1); none is `self`, `portal`, `public` or `delegated`, and none is
 * `elevated` — `project:manage_members` is the only Projects-group capability in
 * `AUTHORITY_GRANTING` (`elevated.ts`), and no route below declares it.
 *
 * **No `sessionOnly`, deliberately, on any route in this file except `DELETE /api/project/{id}`**
 * (P0 deletion audit; see that entry). That restriction was added
 * to the *native* `/api/workspace/*` routes (`workspace/policy.ts`) to preserve a specific
 * inherited restriction the better-auth `organization()` plugin had (`enableSessionForAPIKeys:
 * false`). Nothing analogous ever existed for the *inherited* `/api/project/*` router — kaneo
 * served it to any bearer of a valid session **or** API key, mounted below the same app-wide
 * `ALL /api/*` guard either way — so declaring `sessionOnly` here would be this lane silently
 * narrowing reach relative to what the route always did, exactly the inverse of the mistake
 * `workspace/policy.ts` was written to avoid. `GET /api/project/{id}`, already classified
 * before this batch, sets that precedent.
 *
 * Project update, health, deletion, archive and milestone routes enforce their registered
 * project capability through the project-reach middleware, including the API-key scope.
 * Reorder enforces project:update at workspace scope and filters its project set by reach.
 * Sensitive fields on project update additionally require project:manage_settings.
 * Prerequisite, stakeholder and document-link writes enforce project:update the same way.
 *
 * **Scope: the container that genuinely has an id at request time, per rbac.md's own
 * `work_item:create` example (`scope: 'project'` for a work item created inside a project, not
 * `scope: 'work_item'` — there is no work-item row yet).** By the same reasoning, creating,
 * listing or reordering *projects* uses `scope: 'workspace'` — the workspace they belong to,
 * which does exist — not `scope: 'project'`, which would have no id to resolve for a project
 * that doesn't exist yet (list/reorder) or doesn't exist YET (create). Reading, updating,
 * deleting, archiving and unarchiving *one* project use `scope: 'project'`, matching the
 * already-classified `GET /api/project/{id}` above.
 *
 * **`scopeSource`: `"row"` wherever `workspaceAccess.fromProject()` runs, `"request"`
 * wherever only `workspaceAccess.fromQuery()`/`fromBody()` runs.** `fromProject()`
 * (`utils/workspace-access-middleware.ts`) issues a real `SELECT workspaceId FROM project
 * WHERE id = :id` — the project row is genuinely read to derive its containment, exactly
 * `scopeSource: "row"`'s definition ("the addressed resource has its own row, and the scope id
 * ... must be read from that row in the same query that loads it"). `fromQuery()`/`fromBody()`
 * take `workspaceId` directly off the request with no corresponding `SELECT` against the
 * `project` table — the same "taken from the path/query/body, not read back off a loaded row"
 * shape `workspace/policy.ts` documents for its own `scopeSource: "request"` entries.
 *
 * **`reach: "required"` on every route below, including the four scoped to `workspace`.**
 * rbac.md's own generalisation ("a create... has `reach: { exempt: 'no_single_resource' }`")
 * describes a route whose scope container does not exist yet — but every route here, including
 * `POST /api/project` and `PUT /api/project/reorder`, is scoped to a workspace that already
 * exists and is named by an id from the request. `workspace/policy.ts`'s own
 * `POST /api/workspace/{workspaceId}/members` — a create, scoped to an existing workspace named
 * by a path id, `scopeSource: "request"` — is the precedent: it declares `reach: "required"`,
 * not the exemption. The `no_single_resource` exemption is for a route whose scope id names no
 * existing, addressable resource at all; none of the eight routes below are that.
 */
export const projectPolicies = {
  // PR-1: set or clear the parent project. `project:manage_members` on the child is the
  // registered gate (reach decided from the project row, 404 when out of reach); the same
  // capability on the prospective parent is checked in the handler. The parent is a
  // reach-affecting field (permissions.md "Reach"), and `project:manage_members` is in
  // `AUTHORITY_GRANTING`, but permissions.md's single elevated-action table carries no row for
  // it, so declaring `elevated: true` would claim a requirement the contract does not make
  // (the same reasoning `workspace/policy.ts` records for member routes). Declared
  // `elevated: false` with that reason. The step-up mechanism exists, so electing to elevate
  // re-parenting later is a contract decision plus a PA-15 operation, not a missing verifier.
  "PATCH /api/projects/{projectId}/ownership": {
    capability: "project:manage_members",
    scope: "project",
    scopeSource: "row",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "re-parenting is audited as project.reach_changed and needs project:manage_members on both projects; permissions.md's elevated-action table carries no row for it",
  },

  // PR-2..PR-4: the project roster. Reads need project:read; every write needs
  // project:manage_members (an authority-granting capability, but permissions.md's elevated
  // table has no row for roster writes, so each is declared `elevated: false` with that
  // reason, like the ownership route). Writes are bounded in the handler by the caller's own role rank.
  "GET /api/projects/{projectId}/members": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/projects/{projectId}/members/candidates": {
    capability: "project:manage_members",
    scope: "project",
    scopeSource: "row",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "read-only list of workspace people eligible to be added; writes nothing and grants nothing",
  },
  "POST /api/projects/{projectId}/members": {
    capability: "project:manage_members",
    scope: "project",
    scopeSource: "row",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "roster writes are audited as membership.changed and capped at the caller's own role rank in the handler; permissions.md's elevated-action table carries no row for them",
  },
  "PATCH /api/projects/{projectId}/members/{personId}": {
    capability: "project:manage_members",
    scope: "project",
    scopeSource: "row",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "roster writes are audited as membership.changed and capped at the caller's own role rank in the handler; permissions.md's elevated-action table carries no row for them",
  },
  "DELETE /api/projects/{projectId}/members/{personId}": {
    capability: "project:manage_members",
    scope: "project",
    scopeSource: "row",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "roster removal revokes a direct grant only, is audited as membership.changed and capped at the caller's own role rank; permissions.md's elevated-action table carries no row for it",
  },
  // Re-parent access preview: same gate as the ownership write (the handler also requires
  // project:manage_members on the prospective parent), but it writes nothing.
  "GET /api/projects/{projectId}/ownership/preview": {
    capability: "project:manage_members",
    scope: "project",
    scopeSource: "row",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "read-only preview of who gains or loses access; writes nothing",
  },

  // PR-17: project states management (Project settings -> States). `project:manage_settings`
  // is the registered gate ("Project states, features, labels, ..." in permissions.md); reach
  // is resolved from the project row. Creating is additionally guarded by WF-2 (the template
  // must have an outbound transition).
  "GET /api/projects/{projectId}/state-templates": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/projects/{projectId}/states": {
    capability: "project:manage_settings",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/projects/{projectId}/states/{stateId}": {
    capability: "project:manage_settings",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/projects/{projectId}/settings/inheritance": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/projects/{projectId}/settings/inheritance": {
    capability: "project:manage_settings",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/projects/{projectId}/state-set": {
    capability: "project:manage_settings",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // VW-8: read the project's active concrete states, including empty board columns.
  // Reach is resolved from the named project row before project:read is enforced.
  "GET /api/projects/{projectId}/states": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // List the customer organisations a new project may serve (create-project selector).
  // Same gate as the create itself: `workspaceAccess.fromQuery()` then
  // `requireWorkspaceCapability("project:create")`. Registered ahead of
  // `GET /api/project/{id}` in the router so "organisations" is never read as a project id.
  "GET /api/project/organisations": {
    capability: "project:create",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },

  // Reading one project. The scope is the project itself: reach decides whether this identity
  // can see it at all (404 if not), and authority decides whether they may read it (403).
  "GET /api/project/{id}": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // List a workspace's projects (sidebar order, rollup stats). Runtime checks row-independent
  // workspace reach, then requires `project:read` from the caller's workspace role.
  "GET /api/project": {
    capability: "project:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },

  // Create a project in a workspace. `workspaceAccess.fromBody()` takes `workspaceId` straight
  // off the JSON body (no project row exists yet to read it from), then
  // `requireWorkspaceCapability("project:create")` runs -- an exact match for
  // `project:create`.
  "POST /api/project": {
    capability: "project:create",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },

  // Replace a project's own fields (name, icon, slug, description).
  // `workspaceAccess.fromProject()` reads the project row for its workspaceId, and
  // the same middleware enforces the registered `project:update` capability.
  // CA-2: the body may also carry `defaultCommentVisibility`. That field alone has an extra
  // handler-level STRICT `project:manage_settings` check (+ API-key scope) after body
  // validation -- route middleware runs before validators, so it cannot be declared here.
  // The declared capability stays the baseline every caller of this route needs.
  "PUT /api/project/{id}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/project/{id}/health": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/project/{id}/health": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Soft-delete a project. The project reach middleware enforces `project:delete`.
  // P0 deletion audit: this route no longer deletes; it
  // records a durable pending action (202) that its requester approves in a current browser
  // session with the typed exact project name plus step-up (permissions.md "Deleting a ...
  // project — typed exact name/key + step-up, through a pending action"). `sessionOnly` is the
  // one deliberate exception to the file comment's no-sessionOnly rule below: an API key can no
  // longer request (or approve) a project deletion. Elevation is the approval-time step-up, not
  // a request-time `elevated: true` (permissions.md's elevated table names the target route
  // `DELETE /api/projects/{projectId}`, not this legacy key).
  "DELETE /api/project/{id}": {
    capability: "project:delete",
    scope: "project",
    scopeSource: "row",
    reach: "required",
    sessionOnly: true,
  },

  // Archive a project: `project:archive` (A8-2), enforced by the project reach middleware against
  // this declaration.
  "PUT /api/project/{id}/archive": {
    capability: "project:archive",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Unarchive a project. rbac.md's `project:archive` is "Archive **and restore**", so it uses the
  // same capability and the same enforcement as archive.
  "PUT /api/project/{id}/unarchive": {
    capability: "project:archive",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Restore a soft-deleted project within PR-16's retained recovery window. Restore is archive
  // authority ("Archive and restore"), so it declares `project:archive` like unarchive.
  "PUT /api/project/{id}/restore": {
    capability: "project:archive",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Reorder a workspace's projects. `workspaceAccess.fromQuery()` takes `workspaceId` off the
  // query string (no single project is addressed -- the body carries every id being
  // reordered, and `reorder-projects.ts` verifies each one belongs to the given workspace
  // before writing anything), then `requireWorkspaceCapability("project:update")` runs.
  // There is no dedicated "reorder" capability in rbac.md's Projects group, so `project:update`
  // is both what is enforced and the closest target match.
  "PUT /api/project/reorder": {
    capability: "project:update",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },

  // Project reach and the declared project capability are checked on project-scoped writes.
  // Milestone, prerequisite, stakeholder and document-link writes include API-key scope.
  "GET /api/project/{id}/milestones": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/project/{id}/milestones": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/project/{id}/milestones/{milestoneId}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/project/{id}/milestones/{milestoneId}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/project/{id}/prerequisites": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/project/{id}/prerequisites": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/project/{id}/prerequisites/{prerequisiteId}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/project/{id}/prerequisites/{prerequisiteId}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/project/{id}/stakeholders": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/project/{id}/stakeholders": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/project/{id}/stakeholders/{stakeholderId}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/project/{id}/stakeholders/{stakeholderId}/stand-down": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/project/{id}/document-links": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/project/{id}/document-links": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/project/{id}/document-links/{documentLinkId}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/project/{id}/document-links/{documentLinkId}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Project Overview (0213; decisions D1/D2, Thomas 31 Oct 2026). Reads need project:read.
  // The summary and lifecycle status share project:update with health and milestones; the
  // contract is engagement configuration, so writing it needs project:manage_settings.
  "GET /api/project/{id}/overview": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/project/{id}/summary": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/project/{id}/contract": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "PUT /api/project/{id}/contract": {
    capability: "project:manage_settings",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
