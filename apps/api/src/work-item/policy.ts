import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Work item route policies (issue #23's first slice: minimal create + read + list).
 *
 * These are three genuinely NEW routes -- not a reclassification of an inherited kaneo
 * surface -- so, per issue #8's rule, every one declares a policy at definition time.
 *
 * **The capability strings and scopes below are the TARGET vocabulary, and do NOT
 * describe what actually gates the request today** -- the same transitional shape
 * `workspace/policy.ts`'s own file comment documents for its routes. `work_item:create`/
 * `work_item:read` (`docs/01-architecture/rbac.md` § Work items) are real
 * `@taskdesk/permissions` capabilities, and the RUNTIME check on all three routes below
 * genuinely evaluates them -- via `requireWorkspaceCapability`
 * (`apps/api/src/utils/require-workspace-capability.ts`), which reads the caller's own
 * `workspace_member.role` against the compiled `BUILT_IN_ROLES` capability data, the same
 * mechanism `POST /api/workspace/{workspaceId}/transfer-ownership` already uses for a
 * canonical (non-legacy-better-auth) capability. What is NOT wired up is the declarative
 * `packages/permissions` evaluator itself (`resolveIdentity`/`can()`/`evaluatePolicy`) --
 * nothing in this codebase assembles a live `ResolvedIdentity` for a request yet, and
 * wiring that in is issue #8's runtime-integration section, explicitly out of this
 * slice's scope. This file is registered in `policy-registry.ts` for the
 * route-coverage/permission-matrix machinery only, exactly like every other domain's
 * `policy.ts`.
 *
 * **"Plus reach on the project" (`work-items.md` § Permissions) is, today, workspace
 * membership** -- see `./index.ts`'s own file comment for why: the full per-project
 * reach model (`ProjectReachFacts`, team ownership, hierarchy) exists only in
 * `packages/permissions`, unused by any live route, and every OTHER project-scoped route
 * in this codebase (`project/index.ts`) defines project reach the identical way, via
 * `workspaceAccess.fromProject()` + `validateWorkspaceAccess`'s membership check. This
 * slice follows that existing precedent rather than inventing a different reach model
 * for work items alone.
 *
 * `elevated` is omitted throughout -- neither `work_item:create` nor `work_item:read` is
 * in `AUTHORITY_GRANTING` (`packages/permissions/src/elevated.ts`); creating or reading a
 * work item mints no fresh authority.
 */
export const workItemPolicies = {
  // Create a work item in a project. There is no `work_item` row yet -- the scope id is
  // the project the item is being created IN, read from the request path
  // (`scopeSource: "request"`), the same shape `POST /api/workspace/{workspaceId}/members`
  // uses in `workspace/policy.ts`. `reach: "required"`: the caller must have reach on
  // THAT project before being allowed to create inside it, same as that precedent.
  "POST /api/projects/{projectId}/work-items": {
    capability: "work_item:create",
    scope: "project",
    scopeSource: "request",
    reach: "required",
  },

  // List a project's work items. The addressed resource is the PROJECT (a container),
  // not any one `work_item` row -- `workspaceAccess.fromProject()` loads it (a real DB
  // lookup, not trusted from the path alone), so `scopeSource: "row"`, the same reasoning
  // `workspace/policy.ts` uses for `GET /api/workspace/{workspaceId}/invitations`
  // (a compound/collection read scoped by its container's own loaded row).
  "GET /api/projects/{projectId}/work-items": {
    capability: "work_item:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Read one work item by its permanent key. `requireWorkItemReach()`
  // (`./require-work-item-reach.ts`) resolves the row by a genuine DB lookup on
  // `work_item.key` before the handler runs, and the controller (`get-work-item.ts`)
  // re-loads it itself -- `scopeSource: "row"`.
  "GET /api/work-items/{key}": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // List the workspace's work-item types -- the create dialog's Type picker
  // (`WI-1`; see `./controllers/list-work-item-types.ts`). A workspace-scoped READ:
  // any member who can read the workspace can read the type catalogue the workspace
  // itself seeded. Managing types is `workspace:manage_settings` (work-items.md §
  // Permissions), a different action on a different route. `workspaceAccess.fromParam`
  // loads the workspace by the path's own id and verifies membership before this
  // capability check runs -- `scopeSource: "request"`, the same shape the create
  // policy above uses for a resource named by the request path.
  "GET /api/workspace/{workspaceId}/work-item-types": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },

  // Update a work item's fields (`WI-7`/`WI-8`). Same reach shape as the read route above
  // -- `requireWorkItemReach()` resolves the row by key before the handler runs, and the
  // controller (`update-work-item.ts`) re-scopes its own write by the SAME key+workspaceId
  // pair -- `scopeSource: "row"`.
  //
  // The declared capability below is `work_item:update`, which gates every field this
  // route accepts EXCEPT `priority` -- rbac.md scopes that one to `work_item:set_priority`
  // specifically. That extra, field-level check cannot be expressed as a second route
  // policy entry (a `PolicyMap` has one capability per route) or a second `middleware`
  // entry (the body isn't parsed yet when `middleware` runs -- `apiRouter`'s comment in
  // `../openapi.ts`), so `./index.ts`'s handler calls `assertCallerHasCapability`
  // directly, after body validation, when the body sets `priority`.
  "PATCH /api/work-items/{key}": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // The person-picker feed (`assignment.md` § API). Read-only, addressed by the project
  // container: `workspaceAccess.fromProject()` loads it (a real DB lookup), so
  // `scopeSource: "row"`, the same shape as the sibling list route above. Capability is
  // `work_item:read` (the spec's route table). The ACTOR-dependent filtering (roster vs
  // self-only vs empty) is response shaping inside the handler, not a second capability:
  // reading the roster is `work_item:read`; choosing anyone but yourself at WRITE time is
  // `work_item:assign`, which `POST /assign` enforces.
  "GET /api/projects/{projectId}/assignable": {
    capability: "work_item:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  // Assign or reassign a work item (`assignment.md` § API; `AS-1`/`AS-2`). PRIMARY is
  // `work_item:assign`; the spec's own alternate branch is `orSelfTarget` on the PARSED
  // body -- a caller holding only `work_item:update` may assign the item TO THEMSELVES
  // (`body.assigneeId === identity.personId`, the one predicate `BODY_PREDICATES`
  // declares). This is the route `task/policy.ts`'s own comment named as the honest home
  // for that shape: the runtime enforces BOTH paths through ONE shared predicate
  // (`assertCallerHasCapabilityOrSelf`, called from the handler because the body does not
  // exist when middleware runs), so this declaration describes what actually gates the
  // request -- unlike `PUT /api/task/{id}`, where declaring `orSelfTarget` would have
  // been dishonest. Reach: `requireWorkItemReach()` resolves the row by key before the
  // handler runs, and the controller re-scopes its own conditional write by the same
  // key+workspaceId pair.
  "POST /api/work-items/{key}/assign": {
    capability: "work_item:assign",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
    orSelfTarget: {
      predicate: "body.assigneeId === identity.personId",
      capability: "work_item:update",
    },
  },

  // Clear a work item's assignment (`assignment.md` § API; `AS-2`). PRIMARY is
  // `work_item:assign` -- clearing a colleague's work is the same authority as moving it.
  // The alternate branch is `orOwner` on the LOADED ROW (the spec's
  // `orSelfTarget(row.assignee_id, work_item:update)` line): a caller holding
  // `work_item:update` may clear THEIR OWN assignment, and the predicate reads the row's
  // CURRENT holder. The fact comes from the row, not the body -- this is the first entry
  // to declare `row.assignee_id`, which is why that predicate was added to
  // `OWNER_PREDICATES` (`packages/permissions`, and `rbac.md`) in the same change:
  // declaring it without adding it there fails registry validation, deliberately.
  //
  // Reach: `requireWorkItemReach()` resolves the row by key before the handler runs (the
  // same middleware `POST .../assign` uses), and the controller's conditional write
  // re-scopes by the row's own id.
  "DELETE /api/work-items/{key}/assign": {
    capability: "work_item:assign",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
    orOwner: {
      predicate: "row.assignee_id === identity.personId",
      capability: "work_item:update",
    },
  },
} as const satisfies PolicyMap;
