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

  "GET /api/work-items/{key}/sla": {
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

  // Set a work item's parent (`relations-and-hierarchy.md` § API, `RH-5`..`RH-8`).
  // `requireWorkItemReach()` resolves `{key}` by row before the handler runs; the
  // controller (`set-work-item-parent.ts`) re-scopes its own write by the same
  // key+workspaceId pair -- `scopeSource: "row"`, identical shape to `PATCH
  // /api/work-items/{key}` above. rbac.md declares this "Required on both ends, including
  // detach" -- see that controller's own doc comment for why this is ONE capability check
  // under this codebase's current workspace-role-based permission model, not two.
  "POST /api/work-items/{key}/parent": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Detach a work item from its parent (`RH-11`/`RH-12`'s "detach"). Same reach/capability
  // shape as set-parent above -- `detach-work-item-parent.ts`.
  "DELETE /api/work-items/{key}/parent": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // The hierarchy tree rooted at (or containing) this work item (`relations-and-
  // hierarchy.md` § API/Screens). Read-only, same reach shape as `GET
  // /api/work-items/{key}` above -- see `get-work-item-tree.ts`'s own doc comment for why
  // the whole returned tree is covered by this one row's reach check.
  "GET /api/work-items/{key}/tree": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
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

  // Delete a work item (`WI-21`-`WI-23`). See `controllers/delete-work-item.ts`'s own
  // doc comment for the deliberate, tracked (#428) deviation from `pending-actions.md`'s
  // `202`/approval flow -- this route matches every OTHER existing delete route's live
  // behaviour (plain soft-delete) rather than the spec's own gate, which nothing in this
  // codebase implements yet. `scopeSource: "row"`, same reach shape as every other
  // `{key}`-addressed route: `requireWorkItemReach()` resolves the row before the
  // handler runs.
  "DELETE /api/work-items/{key}": {
    capability: "work_item:delete",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Issue #27, `docs/03-features/comments-and-activity.md`. `requireWorkItemReach()`
  // resolves the target work item by key before the handler runs; the actual capability
  // decision (`comment:create` vs `comment:create_internal`) is data-dependent (the
  // BODY's `visibility` field, not parsed until the handler -- same reason
  // `work_item:set_priority` is checked in `PATCH /api/work-items/{key}`'s own handler,
  // not `middleware`), so `capability` below names the PRIMARY, public-comment path;
  // `./controllers/create-comment.ts` checks whichever of the two the request actually
  // needs.
  "POST /api/work-items/{key}/comments": {
    capability: "comment:create",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Re-rank a work item (`WI-11`-`WI-13`). `WI-13`'s customer-organisation-scoped
  // restriction is NOT enforced here -- see `controllers/rank-work-item.ts`'s own doc
  // comment for why (no live customer-portal caller identity exists anywhere in this
  // codebase yet). Exempt from `If-Match` and last-write-wins (`WI-7`), which is a
  // WRITE-PATH property, not a policy-declaration one -- the declared capability and
  // reach are otherwise identical in shape to every other `{key}`-addressed route.
  "POST /api/work-items/{key}/rank": {
    capability: "work_item:rank",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Watch/unwatch (`WI-28`/`WI-29`). Deliberately `work_item:read`, not a dedicated
  // watch capability -- `work-items.md` § Permissions states this explicitly: "WI-28
  // already lets anyone with read access watch; this is not an omission."
  "POST /api/work-items/{key}/watch": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/work-items/{key}/watch": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Bulk operations (`WI-24`-`WI-27`). The spec's own route table: "work_item:read
  // (workspace) -- then each item is re-checked against its own capability, failures
  // reported per WI-25". This is genuinely a TWO-TIER check the declarative `PolicyMap`
  // shape cannot express in one entry (a per-OPERATION capability decided from the
  // parsed body, same reason `PATCH /api/work-items/{key}`'s `work_item:set_priority`
  // check lives in the handler, not a second policy entry) -- so the capability
  // declared here is the route's own baseline (`work_item:read`), and
  // `./index.ts`'s handler additionally asserts `work_item:delete`/`work_item:assign`
  // once the body names the operation, before calling into
  // `controllers/bulk-work-items.ts`. `scopeSource: "request"`: there is no `{key}` row
  // to resolve here -- the addressed resource is the WORKSPACE the body names, the same
  // shape `POST /api/workspace/{workspaceId}/members` uses for a request-named scope.
  "POST /api/work-items/bulk": {
    capability: "work_item:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },

  // Read a work item's combined activity/comment stream (`WI-6`, issue #292; merged
  // with posted `comment` rows by issue #452 -- see `comments-and-activity.md`'s "one
  // stream showing everything", which this route's own capability/reach shape already
  // matched before #452, since `rbac.md`'s Comments table has no capability of its own
  // for reading either). Same reach/capability shape as the plain
  // `GET /api/work-items/{key}` route above -- neither an activity row's nor a comment
  // row's visibility (`CA-7`) is filtered by this route today; see
  // `controllers/list-work-item-activity.ts`'s own doc comment for why.
  "GET /api/work-items/{key}/activity": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // `rbac.md`'s own worked example for this exact route: ownership is
  // `row.person_id === identity.personId` (the comment's `author_id`), `orOwner` with
  // `withinMinutes: 15` matching `CA-17`'s edit window -- `packages/permissions`'s
  // `OwnerBranch.withinMinutes` exists specifically for this row. `requireCommentReach()`
  // resolves the comment by id via a genuine DB lookup, so `scopeSource: "row"`. Nothing
  // here calls the declarative evaluator at runtime (issue #8's runtime-integration work,
  // out of this slice's scope) -- `./controllers/update-comment.ts` enforces the
  // identical conjunction by hand, the same "declared target, `requireWorkspaceCapability`-
  // family runtime check" split every other route in this codebase already uses.
  "PATCH /api/comments/{id}": {
    capability: "comment:update_any",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
    orOwner: {
      predicate: "row.person_id === identity.personId",
      capability: "comment:update_own",
      withinMinutes: 15,
    },
  },

  // Same shape as the update route above, minus the time window -- rbac.md's table names
  // no `withinMinutes` for either delete capability.
  "DELETE /api/comments/{id}": {
    capability: "comment:delete_any",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
    orOwner: {
      predicate: "row.person_id === identity.personId",
      capability: "comment:delete_own",
    },
  },

  // Issue #442 -- the state-transition EXECUTION route the persistence PR (#31/#443)
  // deliberately left unbuilt. `WF-4`: "Without work_item:transition the request is
  // 403". `requireWorkItemReach()` resolves the row by key before the handler runs, same
  // shape as every other `{key}`-addressed route; the controller re-derives the row's
  // own workspace/project id from the same lookup, so `scopeSource: "row"`.
  "POST /api/work-items/{key}/transition": {
    capability: "work_item:transition",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // The state-select feed (`workflows.md` § "The state select"). Deliberately
  // `work_item:read`, not `work_item:transition` -- rbac.md's own table lists
  // `work_item:read` for this route (`| ... | GET .../transitions | work_item:read |`
  // style entry mirrored from the spec's API table): seeing what one COULD do is a read,
  // same distinction `POST /assign` vs the roster-read route already draws.
  "GET /api/work-items/{key}/transitions": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
