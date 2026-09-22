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
 * **No `sessionOnly`, deliberately, on any route in this file.** That restriction was added
 * to the *native* `/api/workspace/*` routes (`workspace/policy.ts`) to preserve a specific
 * inherited restriction the better-auth `organization()` plugin had (`enableSessionForAPIKeys:
 * false`). Nothing analogous ever existed for the *inherited* `/api/project/*` router — kaneo
 * served it to any bearer of a valid session **or** API key, mounted below the same app-wide
 * `ALL /api/*` guard either way — so declaring `sessionOnly` here would be this lane silently
 * narrowing reach relative to what the route always did, exactly the inverse of the mistake
 * `workspace/policy.ts` was written to avoid. `GET /api/project/{id}`, already classified
 * before this batch, sets that precedent.
 *
 * **The legacy resource key matches the target vocabulary exactly, unlike `workspace`'s
 * `organization`/`workspace` split.** `apps/api/src/utils/require-workspace-permission.ts`
 * resolves a caller's statements from `packages/permissions/src/
 * legacy-better-auth-access-control.ts`'s `statement.project = ["create", "read", "update",
 * "delete", "share"]` — the resource key is literally `"project"`, the same string the target
 * `Capability` union prefixes with (`project:create`, `project:read`, `project:update`,
 * `project:delete`). So `requireWorkspacePermission({ project: [...] })` and a declared
 * `project:*` capability name the same authority today; there is no re-keying gap to record
 * here the way there was for `workspace:update` vs the legacy `organization:update`.
 *
 * **There IS a granularity gap, on the mutation routes below `project:update`.** rbac.md
 * defines two narrower Projects-group capabilities the legacy `statement.project` never had a
 * matching action for: `project:archive` ("Archive and restore", implies `project:update`) and
 * `project:manage_settings` ("Project states, features, labels, SLA and calendar assignment,
 * automations", implies `project:update`). The runtime enforces only the broader
 * `project:update` on archive/unarchive/reorder — there is no separate archive-specific or
 * settings-specific check anywhere in these controllers. Declaring the narrower target
 * capability here would not close that gap, it would just make the declaration claim a
 * stricter requirement than what the route actually enforces — the same reasoning
 * `workspace/policy.ts` gives for declaring `workspace:update` over a hypothetically "more
 * correct" string. So archive, unarchive and reorder below declare `project:update`, matching
 * the actual `requireWorkspacePermission({ project: ["update"] })` check, and this comment is
 * where the gap is recorded for #7's capability migration rather than pretended away. (Column
 * and workflow-rule mutations, classified alongside this file, have the same
 * `project:manage_settings` gap for the same textual reason — see those files.)
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
  // Reading one project. The scope is the project itself: reach decides whether this identity
  // can see it at all (404 if not), and authority decides whether they may read it (403).
  "GET /api/project/{id}": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // List a workspace's projects (sidebar order, rollup stats). `getProjectsRoute`'s only
  // middleware is `workspaceAccess.fromQuery()` -- no `requireWorkspacePermission` call at all,
  // same shape as `GET /api/project/{id}` above: the runtime relies entirely on workspace
  // membership (reach), never a distinct capability check, because every seeded role
  // (`legacy-better-auth-access-control.ts`: viewer/member/admin/owner) holds `project: ["read"]`
  // unconditionally -- there is no role that is a workspace member yet lacks project:read.
  // `project:read` is declared here for the same reason it is on the `{id}` route: it is the
  // correct TARGET capability even though nothing distinct enforces it today.
  "GET /api/project": {
    capability: "project:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },

  // Create a project in a workspace. `workspaceAccess.fromBody()` takes `workspaceId` straight
  // off the JSON body (no project row exists yet to read it from), then
  // `requireWorkspacePermission({ project: ["create"] })` runs -- an exact match for
  // `project:create`.
  "POST /api/project": {
    capability: "project:create",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },

  // Replace a project's own fields (name, icon, slug, description).
  // `workspaceAccess.fromProject()` reads the project row for its workspaceId, and
  // `requireWorkspacePermission({ project: ["update"] })` runs after -- an exact match for
  // `project:update`.
  "PUT /api/project/{id}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Soft-delete a project. Same middleware shape as update, with `project: ["delete"]` --
  // an exact match for `project:delete`.
  "DELETE /api/project/{id}": {
    capability: "project:delete",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Archive a project. `requireWorkspacePermission({ project: ["update"] })` runs -- the
  // legacy statement has no `archive` action, so this is the broader `project:update` check,
  // not rbac.md's narrower `project:archive`. See the file comment's granularity-gap note.
  "PUT /api/project/{id}/archive": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Unarchive (restore) a project. Same middleware and same gap as archive above --
  // rbac.md's `project:archive` capability description is "Archive **and restore**", so
  // both routes map to the one narrower target capability the runtime does not distinctly
  // enforce.
  "PUT /api/project/{id}/unarchive": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Reorder a workspace's projects. `workspaceAccess.fromQuery()` takes `workspaceId` off the
  // query string (no single project is addressed -- the body carries every id being
  // reordered, and `reorder-projects.ts` verifies each one belongs to the given workspace
  // before writing anything), then `requireWorkspacePermission({ project: ["update"] })` runs.
  // There is no dedicated "reorder" capability in rbac.md's Projects group, so `project:update`
  // is both what is enforced and the closest target match.
  "PUT /api/project/reorder": {
    capability: "project:update",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
} as const satisfies PolicyMap;
