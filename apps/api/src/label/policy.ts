import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Label route policies.
 *
 * Covers all eight routes in `apps/api/src/label/index.ts`, kaneo-inherited surface listed,
 * unmodified, in `tests/permissions/inherited-uncovered.json`. Mounted at
 * `const labelApi = api.route("/label", label);` in `apps/api/src/index.ts`, well below
 * `api.use("*", ...)` (the app-wide auth guard) -- verified directly from the registration
 * order.
 *
 * **The five mutation routes are `label:manage`.** rbac.md's Labels & fields group
 * (`docs/01-architecture/rbac.md`) has exactly one label capability -- `label:manage`,
 * "Create, edit, delete labels" -- and it is an exact match for what each of these five
 * routes' own runtime check already gates on: `requireWorkspacePermission({ label: [...] })`
 * against the inherited `label` resource's `create`/`update`/`delete` actions
 * (`apps/api/src/label/index.ts`). No capability-name gap to record here, unlike several
 * routes in the sibling `workspace`/`invitation` files this lane also extends.
 *
 * None of the five is in `AUTHORITY_GRANTING` (`packages/permissions/src/elevated.ts` --
 * that set is `instance:admin`, `instance:manage_plugins`, `workspace:manage_members`,
 * `workspace:manage_roles`, `project:manage_members`, `api_key:manage`, `webhook:manage`,
 * `change:manage`; `label:manage` is not among them), so no `elevated` field is declared,
 * matching the precedent `workspace/policy.ts` and `invitation/policy.ts` already set for
 * non-authority-granting capabilities.
 *
 * **The three read routes have no exact capability match, and are declared `workspace:read`
 * as the closest fit -- recorded here as a gap for #7, the same convention
 * `workspace/policy.ts` (its `workspace:manage_members` reuse for two routes) and
 * `invitation/policy.ts` (its `member:invite` reuse for cancel) already established for an
 * imperfect-but-closest capability.** None of the three GET routes below calls
 * `requireWorkspacePermission` at all -- `getTaskLabelsRoute`, `getWorkspaceLabelsRoute` and
 * `getLabelRoute` carry only a `workspaceAccess.*` middleware, so the only real gate today is
 * workspace membership itself (or instance-admin), identical to what `workspace:read` already
 * requires everywhere else in this codebase. rbac.md defines `workspace:read` as "See the
 * workspace and its settings", grants it to every built-in role from `viewer` upward
 * (`viewer`'s row is the read-only floor and already carries it), and its own table links it
 * to workspace-level "labels" visibility indirectly (`workspace:manage_settings`'s described
 * scope lists "labels" among the settings it manages, implying `workspace:read` for the
 * unprivileged view of that same data). No dedicated `label:read` capability exists in
 * rbac.md to declare instead, and inventing one is #7's decision, not this lane's -- the
 * alternative to reuse was to leave all three unclassified, which was rejected here because
 * `workspace:read`'s breadth (granted to every role, exactly matching the "any workspace
 * member may read" runtime behaviour) makes it a genuine match on breadth, not merely the
 * least-wrong option, unlike a case where reuse would silently narrow today's access.
 *
 * `scope: "workspace"` throughout: both capabilities used here (`label:manage`,
 * `workspace:read`) are workspace-domain capabilities in rbac.md, checked at workspace scope
 * regardless of which path parameter happens to identify the addressed row -- the same
 * reasoning `workspace/policy.ts` applies to its own member/invitation routes, which are
 * addressed by a `userId` or invitation id in the path yet still declare `scope: "workspace"`.
 */
export const labelPolicies = {
  // Labels attached to one task. `workspaceAccess.fromTaskId()` derives the workspace id by
  // looking up the TASK's own row (joined to its project) -- not a label row, since this route
  // addresses no single label -- so `scopeSource: "row"`, the same "row id read from a
  // different table than the policy's own scope name" shape `invitation/policy.ts` already
  // documents for `DELETE /api/invitation/{id}` (workspace id read from the invitation's row).
  // `fromTaskId`'s second source (a `?workspaceId=` query fallback) only activates when the
  // primary task lookup finds nothing, at which point the route 404s before any authority
  // decision is reached -- so the query fallback never actually supplies the scope id for a
  // request that gets this far.
  "GET /api/label/task/{taskId}": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  // All labels in one workspace. `workspaceAccess.fromParam()` reads `workspaceId` straight off
  // the path -- no row is loaded to derive it -- so `scopeSource: "request"`, the same shape
  // `workspace/policy.ts` declares for `GET /api/workspace/{workspaceId}/roles`.
  "GET /api/label/workspace/{workspaceId}": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },

  // Create a label, optionally attached to a task. `workspaceAccess.fromBody()` reads
  // `workspaceId` from the JSON body (no row loaded for it), so `scopeSource: "request"` --
  // there is no label row yet to read a scope id from, the same "create against an existing,
  // named container" shape `workspace/policy.ts` gives `POST /api/workspace/{workspaceId}/
  // members`, except the container id arrives in the body rather than the path.
  "POST /api/label": {
    capability: "label:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },

  // One label by id. `workspaceAccess.fromLabel()` looks up the LABEL's own row to derive the
  // workspace id, so `scopeSource: "row"`.
  "GET /api/label/{id}": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  // Attach an existing label to a task. `workspaceAccess.fromLabel()` loads the label's own
  // row (not the task's), so `scopeSource: "row"` -- same shape as `GET /api/label/{id}` above.
  "PUT /api/label/{id}/task": {
    capability: "label:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  // Detach a label from its task. Same middleware and scope shape as attach above.
  "DELETE /api/label/{id}/task": {
    capability: "label:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  // Update a label's name/color. Same middleware and scope shape as attach/detach above.
  "PUT /api/label/{id}": {
    capability: "label:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  // Delete a label (and cascade its task-level copies, for a workspace-level label). Same
  // middleware and scope shape as the three routes above.
  "DELETE /api/label/{id}": {
    capability: "label:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
