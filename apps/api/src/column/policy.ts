import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Column route policies (issue #8).
 *
 * A board column is a project's own kanban lane -- `columnTable.projectId` is `NOT NULL`, and
 * every route here is reached through a project (`{projectId}` on three routes, a column
 * `{id}` resolved back to its project on the other two). All five are capability-kind (kind
 * 1); none is `self`/`portal`/`public`/`delegated`, and none is `elevated` -- no
 * Projects-group capability declared below is in `AUTHORITY_GRANTING` (`elevated.ts`). No
 * `sessionOnly` either, for the same reason `project/policy.ts` gives: nothing in kaneo or in
 * this batch restricted `/api/column/*` to a browser session, and declaring it now would
 * narrow reach relative to what the route has always done.
 *
 * **Legacy resource key: same `"project"` string as `project/policy.ts`, not a `"column"`
 * resource of its own.** Every mutation route below runs
 * `requireWorkspacePermission({ project: ["update"] })` -- `column`'s own controllers never
 * check a distinct `column` permission, because the legacy `statement` object
 * (`legacy-better-auth-access-control.ts`) never had one. `project:update` is therefore both
 * the exact runtime check and the only Projects-group capability with a matching legacy
 * action.
 *
 * **Granularity gap, same shape as `project/policy.ts`'s archive/unarchive note, and arguably
 * sharper here.** rbac.md's `project:manage_settings` capability is described as "**Project
 * states**, features, labels, SLA and calendar assignment, automations" -- and
 * `docs/01-architecture/data-model.md`'s `state` table (project-scoped, `position`-ordered,
 * `is_default`) is the documented NATIVE replacement for exactly what kaneo calls a board
 * `column` (`name`, `icon`, `color`, `isFinal`, `position` -- `apps/api/src/column/
 * schema.ts`). So the capability the target vocabulary actually names for "who may reshape a
 * project's board columns" is `project:manage_settings`, not the bare `project:update` these
 * routes enforce today. Declaring `project:manage_settings` here regardless would overstate
 * what the runtime requires -- `project:manage_settings` implies `project:update` but not the
 * reverse, so a role holding only `project:update` would be denied by the declaration while
 * still being let through by `requireWorkspacePermission`, the same "declaration claims more
 * than enforcement gives" mismatch `project/policy.ts`'s own comment reasons through. Declared
 * `project:update` below, matching enforcement; recorded here as a gap for #7 (re-key the
 * routes to `project:manage_settings`, or teach the migration that "board structure" was
 * always meant to live under project settings, not bare project update).
 *
 * **Scope and scopeSource.** All five routes address one identifiable project (never a
 * bare workspace query) -- `scope: 'project'` throughout, matching `project:read`/
 * `project:update`'s own Projects-group tier and rbac.md's `work_item:create` precedent for
 * "the nearest scope-enum container that has an id." `scopeSource: "row"` throughout too:
 * `workspaceAccess.fromProject("projectId")` (the three `{projectId}` routes) issues a real
 * `SELECT workspaceId FROM project WHERE id = :id`, and `workspaceAccess.fromColumn("id")`
 * (the two `{id}` routes) issues a real `SELECT ... FROM column JOIN project WHERE column.id =
 * :id` -- both genuinely read a row (the project, or the column joined to its project) to
 * derive the scope's containment chain, never trust an unread path/query value for it.
 *
 * **`reach: "required"` throughout**, for the same reasoning `project/policy.ts`'s file
 * comment gives at length: every route addresses an existing project (directly, or via the
 * column that belongs to it), so its reach must be checked -- there is no route here whose
 * scope id names nothing that could be out of reach.
 */
export const columnPolicies = {
  // List a project's columns, in position order. `getColumnsRoute`'s only middleware is
  // `workspaceAccess.fromProject("projectId")` -- no `requireWorkspacePermission` call, same
  // "reach alone, capability declared for the target model anyway" shape as
  // `GET /api/project/{id}` and `GET /api/project`: every seeded role holds `project: ["read"]`
  // unconditionally, so there is no role that reaches the project yet lacks read authority
  // over it.
  "GET /api/column/{projectId}": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Add a column to a project's board. `requireWorkspacePermission({ project: ["update"] })`
  // runs after `workspaceAccess.fromProject("projectId")`.
  "POST /api/column/{projectId}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Update one column's own fields (name/icon/color/isFinal). `workspaceAccess.fromColumn("id")`
  // resolves the column's own project (and 400s if the column doesn't exist), then
  // `requireWorkspacePermission({ project: ["update"] })` runs.
  "PUT /api/column/{id}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Delete an empty column. Same middleware shape as update.
  "DELETE /api/column/{id}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Reposition every column on a project's board in one call.
  // `workspaceAccess.fromProject("projectId")` then
  // `requireWorkspacePermission({ project: ["update"] })`, same as create.
  "PUT /api/column/reorder/{projectId}": {
    capability: "project:update",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
