import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Workflow persistence route policies (issue #31).
 *
 * `workflow:read`/`workflow:manage` (`docs/01-architecture/rbac.md`) exist ONLY in the
 * new native capability vocabulary (`@taskdesk/permissions`) -- unlike most of this
 * codebase's inherited kaneo surface, there is no legacy better-auth `ac` statement
 * resource for "workflow" to fall back to, so these five routes use
 * `requireWorkspaceCapability` directly (`require-workspace-capability.ts`), not
 * `requireWorkspacePermission`'s legacy statement shape.
 *
 * Neither capability is in `AUTHORITY_GRANTING` (`packages/permissions/src/elevated.ts`),
 * so no `elevated` field is declared, same as `label/policy.ts`'s `label:manage`.
 *
 * **Scope note.** This PR builds ONLY persistence + the admin CRUD needed to create a
 * workflow/version/transition set for testing -- `GET /transitions` and
 * `POST /api/work-items/{key}/transition` (the actual state-transition EXECUTION route)
 * are a follow-up issue, not declared here.
 */
export const workflowPolicies = {
  // All workflows in one workspace. `workspaceAccess.fromQuery()` reads `?workspaceId=`
  // straight off the query string -- no row loaded for it -- so `scopeSource: "request"`,
  // same shape as `GET /api/label/workspace/{workspaceId}`.
  "GET /api/workflows": {
    capability: "workflow:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },

  // Create a workflow. `workspaceAccess.fromBody()` reads `workspaceId` from the JSON
  // body -- no row yet to read a scope id from -- so `scopeSource: "request"`, same
  // shape as `POST /api/label`.
  "POST /api/workflows": {
    capability: "workflow:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },

  // One workflow by id, with its versions and their transitions.
  // `workspaceAccess.fromWorkflow()` loads the workflow's own row to derive the
  // workspace id, so `scopeSource: "row"`.
  "GET /api/workflows/{id}": {
    capability: "workflow:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  // Create a new draft version under an existing workflow. Same `fromWorkflow()`
  // row-derived scope as the get route above.
  "POST /api/workflows/{id}/versions": {
    capability: "workflow:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  // Publish a draft version. `workspaceAccess.fromWorkflow()` here too -- the route
  // addresses a workflow (`{id}`) and a version number nested under it, not a
  // standalone version resource.
  "POST /api/workflows/{id}/versions/{number}/publish": {
    capability: "workflow:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  // Issue #442's validation-panel route. Read-only (it reports, never mutates -- see
  // `validate-workflow-version.ts`'s own doc comment), but gated on `workflow:manage`,
  // matching the spec's own API table (`workflows.md`: every `/versions/...` route is
  // `workflow:manage`) -- the validation panel is part of the "Workflow editor" screen,
  // not a general read surface. Same `fromWorkflow()` row-derived scope as its sibling
  // routes above.
  "POST /api/workflows/{id}/versions/{number}/validate": {
    capability: "workflow:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
