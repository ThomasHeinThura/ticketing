import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Canned response route policies (issue #27, `CA-19`/`CA-20`).
 *
 * These are genuinely new routes -- every one declares a policy at definition time, per
 * issue #8's rule. Same transitional shape as every other domain's `policy.ts` in this
 * codebase: the capability strings below are the TARGET vocabulary, and the runtime check
 * is `requireWorkspaceCapability` (or its `builtInRoleHasCapability`-based equivalent),
 * not the declarative `packages/permissions` evaluator (issue #8's runtime-integration
 * work, out of scope here).
 *
 * `POST`/`PATCH`/`DELETE` all require `workspace:manage_settings`, per the spec's own API
 * table -- managing the snippet library is a workspace-settings action, not a per-comment
 * one. `GET` requires only `work_item:read` -- rbac.md's own text: "reading the list to
 * insert one only requires `work_item:read` on the work item being commented on". This
 * The route carries the requested item key as `workItemKey`. Its middleware resolves that
 * live item for the caller, sets its exact work-item/project/workspace facts, requires
 * current project reach, then evaluates `work_item:read` against the item. The repository
 * also correlates each returned response to that item's workspace and requires current
 * project reach in the same query; workspace membership alone cannot list the library.
 */
export const cannedResponsePolicies = {
  "GET /api/canned-responses": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/canned-responses": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "PATCH /api/canned-responses/{id}": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/canned-responses/{id}": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
