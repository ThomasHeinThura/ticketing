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
 * **Capability: `project:manage_settings` on every mutation (A8-2, Thomas 8 Nov).** rbac.md's
 * `project:manage_settings` is "**Project states**, features, labels, SLA and calendar
 * assignment, automations", and `data-model.md`'s project-scoped `state` table is the native
 * successor to kaneo's board `column` (`name`, `icon`, `color`, `isFinal`, `position`), so
 * reshaping a project's board is a project setting, not a bare `project:update`. The project
 * reach middleware (`workspaceAccess.fromProject`/`fromColumn` with `requireProjectReach`)
 * enforces this declaration against the caller's project authority, and an API key must also
 * carry it in its scope (no `deferApiKeyCapability`). The legacy
 * `requireWorkspacePermission({ project: ["update"] })` gate stays as the baseline; the legacy
 * statement has no `column` resource and no settings action. A lead (`project:update` only) is
 * refused. Column deletion approval re-checks this same registered capability.
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
  // List a project's columns, in position order. Runtime checks row-derived reach and then
  // requires `project:read` from the caller's workspace role.
  "GET /api/column/{projectId}": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Add a column to a project's board.
  "POST /api/column/{projectId}": {
    capability: "project:manage_settings",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Update one column's own fields (name/icon/color/isFinal). `workspaceAccess.fromColumn("id")`
  // resolves the column's own project (and 404s if the column doesn't exist -- #256).
  "PUT /api/column/{id}": {
    capability: "project:manage_settings",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Delete an empty column (pending action). Same middleware shape as update.
  "DELETE /api/column/{id}": {
    capability: "project:manage_settings",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Reposition every column on a project's board in one call. Same gate as create.
  "PUT /api/column/reorder/{projectId}": {
    capability: "project:manage_settings",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
