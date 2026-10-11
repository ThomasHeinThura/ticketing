import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Saved-view route policies (#24 "views and layouts" / #29 "search and saved views" --
 * `search-and-saved-views.md`'s "Data" section: a saved view IS a stored search plus a
 * presentation choice, one table serves both specs).
 *
 * Runtime gates use the canonical capability vocabulary and API-key scope intersection,
 * not legacy `requireWorkspacePermission` statements -- `saved_view:*` has no
 * better-auth-inherited equivalent to re-key, the same reason `work_item/policy.ts` uses
 * canonical capability checks. The saved-view edit admission helper applies the same OR
 * branches declared here, and the strict route evaluator verifies the registry policy.
 *
 * `scopeSource: "request"` on the collection routes (`GET`/`POST /api/views`) -- the
 * workspace comes from `?workspaceId=`/body `workspaceId`, there is no row yet for POST and
 * no single row at all for the list GET. `scopeSource: "row"` on the by-id routes --
 * `workspaceAccess.fromSavedView()` resolves the workspace from the loaded row, the same
 * shape `label`/`column`/`workflowRule` already use.
 *
 * `orOwner` on `PATCH` and `DELETE`: `search-and-saved-views.md`'s own API table --
 * `workspace:manage_settings · orOwner(created_by, saved_view:create)`. The predicate is
 * `row.created_by === identity.personId`, the only owner predicate `packages/permissions`
 * declares over a `created_by` column (`policy.ts`'s closed `OWNER_PREDICATES`) -- this is
 * why `saved_view.created_by` references `person.id`, not `user.id` (see that column's own
 * schema.ts comment).
 *
 * `POST /api/views` declares `saved_view:create`; PATCH/DELETE use the documented
 * manager-or-owner policy. After body validation, the PATCH controller
 * add `saved_view:share` when the requested operation publishes a team view or changes its
 * team audience; target-team membership is checked separately against the same workspace.
 *
 * `POST /api/views/{id}/pin` is kind 2 (`self`) per the spec's own "self (kind 2 -- the
 * caller's own `user_preference` row)" -- it never reads or writes another person's pinned
 * set, so there is no workspace-capability gate to declare; `personParam` is
 * `{ exempt: "no_person_parameter" }` because the route addresses the CALLER, not a named
 * person in a param.
 *
 * Run/count always re-evaluate the stored query as the current viewer through the
 * canonical work-item search repository, which applies reach and field policy.
 */
export const viewPolicies = {
  "GET /api/views": {
    capability: "saved_view:read",
    scope: "workspace",
    scopeSource: "request",
    reach: {
      exempt: "no_single_resource",
      reason: "A filtered collection, not one row",
    },
  },

  "GET /api/views/team-audiences": {
    capability: "saved_view:share",
    scope: "workspace",
    scopeSource: "request",
    reach: {
      exempt: "no_single_resource",
      reason: "A filtered collection of teams the caller can share with",
    },
  },

  "POST /api/views": {
    capability: "saved_view:create",
    scope: "workspace",
    scopeSource: "request",
    reach: {
      exempt: "no_single_resource",
      reason: "A create; no row exists yet",
    },
  },

  "GET /api/views/{id}": {
    capability: "saved_view:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  "GET /api/views/{id}/count": {
    capability: "saved_view:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  "POST /api/views/{id}/run": {
    capability: "saved_view:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  "PATCH /api/views/{id}": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    orOwner: {
      predicate: "row.created_by === identity.personId",
      capability: "saved_view:create",
    },
  },

  "DELETE /api/views/{id}": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    orOwner: {
      predicate: "row.created_by === identity.personId",
      capability: "saved_view:create",
    },
  },

  "POST /api/views/{id}/pin": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "Toggles the caller's own pinned-views preference, not a named person's",
    },
  },
} as const satisfies PolicyMap;
