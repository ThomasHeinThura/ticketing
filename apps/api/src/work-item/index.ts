import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  membershipTable,
  personTable,
  workItemTable,
} from "../database/schema";
import {
  type ApiKey,
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  assertCallerHasCapability,
  assertCallerHasCapabilityOrSelf,
  builtInRoleHasCapability,
  requireWorkspaceCapability,
} from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  isUnambiguousMembership,
  workspaceMemberRoles,
} from "../utils/workspace-member-roles";
import type { ActivityActorType } from "./activity";
import assignWorkItem, {
  WorkItemAssigneeConflictError,
} from "./controllers/assign-work-item";
import bulkWorkItems from "./controllers/bulk-work-items";
import createWorkItem from "./controllers/create-work-item";
import deleteWorkItem from "./controllers/delete-work-item";
import detachWorkItemParent from "./controllers/detach-work-item-parent";
import getWorkItemByKey from "./controllers/get-work-item";
import getWorkItemTree from "./controllers/get-work-item-tree";
import listAssignablePeople from "./controllers/list-assignable-people";
import listWorkItemActivity from "./controllers/list-work-item-activity";
import listWorkItemTypes from "./controllers/list-work-item-types";
import listWorkItems from "./controllers/list-work-items";
import rankWorkItem from "./controllers/rank-work-item";
import setWorkItemParent from "./controllers/set-work-item-parent";
import unassignWorkItem from "./controllers/unassign-work-item";
import updateWorkItem, {
  WorkItemVersionConflictError,
} from "./controllers/update-work-item";
import { unwatchWorkItem, watchWorkItem } from "./controllers/watch-work-item";
import { requireWorkItemReach } from "./require-work-item-reach";
import {
  assignablePeopleSchema,
  assignWorkItemResponseSchema,
  bulkWorkItemsResponseSchema,
  deletedWorkItemSchema,
  rankWorkItemResponseSchema,
  unassignWorkItemResponseSchema,
  workItemActivityListResponseSchema,
  workItemAssigneeConflictSchema,
  workItemDetailSchema,
  workItemListResponseSchema,
  workItemSchema,
  workItemTreeResponseSchema,
  workItemTypeListSchema,
  workItemVersionConflictSchema,
  workItemWatchStateSchema,
} from "./response";
import {
  assignWorkItemBody,
  bulkWorkItemsBody,
  createWorkItemBody,
  ifMatchHeader,
  listWorkItemActivityQuery,
  listWorkItemsQuery,
  projectIdParam,
  rankWorkItemBody,
  setWorkItemParentBody,
  updateWorkItemBody,
  workItemKeyParam,
  workspaceIdParam,
} from "./schema";

/**
 * #23's first slice: minimal create + read + list for `work_item`
 * (`docs/03-features/work-items.md`, `WI-1`..`WI-4`).
 *
 * Mounted at the API root (`api.route("/", workItem)` in `index.ts`), not under a
 * feature-name prefix like every other domain here (`/api/project`, `/api/task`, ...) --
 * the spec's own API table names two DIFFERENT path shapes for this one resource
 * (`/api/projects/{projectId}/work-items` and `/api/work-items/{key}`), which a single
 * prefixed mount cannot produce. This is a deliberate, narrow exception, not a new
 * convention for every future domain.
 *
 * AUTHORIZATION, and why it is `requireWorkspaceCapability`, not
 * `requireWorkspacePermission`. `work_item:create`/`work_item:read` are canonical
 * `@taskdesk/permissions` capabilities (`BUILT_IN_ROLES`), not legacy better-auth-shaped
 * `{resource: action[]}` statements -- `requireWorkspacePermission` cannot evaluate them
 * at all. `requireWorkspaceCapability` (`apps/api/src/utils/require-workspace-capability.ts`)
 * is this codebase's existing, already-reviewed mechanism for exactly that vocabulary,
 * reading the caller's own `workspace_member.role` against the compiled `BUILT_IN_ROLES`
 * data.
 *
 * "Plus reach on the project" (`work-items.md` § Permissions) reduces to WORKSPACE
 * membership here, not a dedicated per-project reach model: `packages/permissions`
 * ships a full reach/identity system (`ResolvedIdentity`, `ProjectReachFacts`, team
 * ownership, hierarchy), but nothing in this codebase assembles it for a live request
 * yet (no route calls `resolveIdentity`/`can()`/`evaluatePolicy` outside tests) -- that
 * is #8's runtime-integration work, explicitly out of this slice's scope. Every OTHER
 * project-scoped route in this codebase today (`project/index.ts`) defines its own reach
 * identically: `workspaceAccess.fromProject()` resolves the project's workspace, then
 * `validateWorkspaceAccess` (inside that middleware) requires actual membership in it.
 * This slice follows that same, already-live precedent rather than inventing a
 * project-level membership check nothing else here has yet. Flagged as a judgment call
 * in the PR body.
 *
 * The declared route policies in `./policy.ts` are the TARGET vocabulary
 * (`work_item:create`/`work_item:read`, `scope: "project"`/`"work_item"`) -- registered
 * in `policy-registry.ts` for the route-coverage/matrix machinery, same as every other
 * domain's `policy.ts`. Nothing here calls `evaluatePolicy`/the declarative registry at
 * runtime; the actual enforcement is the `requireWorkspaceCapability` middleware below,
 * exactly the same "declared target, different live mechanism" shape
 * `workspace/policy.ts`'s own file comment documents for its own routes.
 */

/**
 * WI-6/CA-9's actor for the create/update write paths -- reused by both route
 * handlers below so the two never drift. `data-model.md`'s Conventions: "`actor_type`
 * accompanies every `actor_id`: `person | automation | system | api_key`" -- this route
 * only ever sees a person or an API key (never `automation`/`system`, which are
 * background-job/automation-engine actors with no HTTP request to authenticate).
 *
 * `c.get("apiKey")` is set by `authenticate-api-request.ts` only when the request
 * authenticated via an API key (Bearer token or `x-api-key`), never for a cookie
 * session -- its presence is exactly the api_key/person distinction.
 *
 * The actor ID is the KEY'S OWNER, not the key's own id, even when `actorType` is
 * `api_key` -- unchanged from what `c.get("userId")` already carries for both cases,
 * since `authenticate-api-request.ts` sets `userId` to `key.userId` for an
 * API-key-authenticated request. This mirrors `data-model.md`'s own `audit_log` row
 * (~365): `actor_id`, `actor_type`, `api_key_id` null, ... -- `api_key_id` is a
 * SEPARATE column from `actor_id`, which is why an api-key action still records a
 * real actor identity (the owner) in `actor_id` rather than the key's id. `activity`
 * has no parallel `api_key_id` column (`data-model.md` ~222), so which specific key
 * acted is not recorded there -- only that a key (vs. a person) did, and by whom it is
 * owned.
 */
function resolveActor(
  userId: string,
  apiKey: ApiKey | undefined,
): { actorId: string; actorType: ActivityActorType } {
  return {
    actorId: userId,
    actorType: apiKey ? "api_key" : "person",
  };
}

const createWorkItemRoute = createRoute({
  method: "post",
  operationId: "createWorkItem",
  path: "/projects/{projectId}/work-items",
  tags: ["Work items"],
  summary: "Create work item",
  description:
    "Create a work item in a project. The key is `{project.slug}-{number}`, assigned " +
    "atomically. The initial state is the project's own default state.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspaceCapability("work_item:create"),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createWorkItemBody } },
    },
  },
  responses: {
    200: jsonResponse("The created work item", workItemSchema),
    // #290: an unknown/out-of-reach project now 400s uniformly via
    // `workspaceAccess.fromProject()` (#202's own precedent for this helper), folded
    // into this same 400 alongside the route's other malformed-request cases.
    400: errorResponse(
      "Invalid body, unknown/unreachable/cross-workspace type, or the project has no default state",
    ),
    403: errorResponse("Missing work_item:create permission"),
    404: errorResponse("Project not found"),
    // #23's mandatory Opus security review of PR #261, F1's delta-confirmation (D1,
    // 2026-09-22): defence in depth for a poisoned key range that predates the
    // `project_slug_claim` fix (see `create-work-item.ts`'s own catch clause) -- expected
    // to be effectively unreachable going forward, not a normal-path response.
    409: errorResponse(
      "This work item's key is already claimed by another work item",
    ),
  },
});

const listWorkItemsRoute = createRoute({
  method: "get",
  operationId: "listWorkItems",
  path: "/projects/{projectId}/work-items",
  tags: ["Work items"],
  summary: "List work items",
  description:
    "List a project's work items with server-side sort, cursor pagination and " +
    "filters (`docs/01-architecture/api-design.md`'s collection convention; " +
    "`sort`/`dir` match #306's own URL param names: `key | title | priority | " +
    "dueDate`, `asc | desc`, default `key`/`asc`). Archived and deleted items are " +
    "excluded by default. Each row also carries the resolved `stateName`, " +
    "`stateCategory` and `assigneeName` (#310) alongside the raw ids.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspaceCapability("work_item:read"),
  ] as const,
  request: { params: projectIdParam, query: listWorkItemsQuery },
  responses: {
    200: jsonResponse(
      "A page of the project's work items",
      workItemListResponseSchema,
    ),
    // #290: an unknown/out-of-reach project 400s via `workspaceAccess.fromProject()`
    // before this route's own permission check runs (#202's own precedent) -- folded
    // into the same 400 alongside #310's own query-validation cases (unknown sort
    // field, out-of-range limit, malformed cursor, NUL byte, etc.).
    400: errorResponse(
      "Unknown project or its workspace could not be determined, or an invalid " +
        "query parameter (unknown sort field, out-of-range limit, malformed cursor, " +
        "NUL byte, etc.)",
    ),
    403: errorResponse("Missing work_item:read permission"),
    // #202 / PR #204's freeze invariant (independent Opus security review of PR #271,
    // S2): a soft-deleted project's work-item list now 404s, matching every other
    // project-scoped route's convention for a soft-deleted subject.
    404: errorResponse("Project not found"),
  },
});

const getWorkItemRoute = createRoute({
  method: "get",
  operationId: "getWorkItem",
  path: "/work-items/{key}",
  tags: ["Work items"],
  summary: "Get work item",
  description: "Get a single work item by its permanent key, e.g. PROJ-123.",
  middleware: [
    requireWorkItemReach(),
    requireWorkspaceCapability("work_item:read"),
  ] as const,
  request: { params: workItemKeyParam },
  responses: {
    200: jsonResponse("The work item", workItemDetailSchema),
    403: errorResponse(
      "No workspace access, or missing work_item:read permission",
    ),
    404: errorResponse("Work item not found"),
  },
});

// The workspace's type catalogue, for the create dialog's Type picker (`WI-1`). The
// first workspace-scoped route in this module; `workspaceAccess.fromParam` loads the
// workspace by the path's own id and verifies membership before the capability check,
// the same helper shape the member/invitation reads in `workspace/index.ts` use.
const listWorkItemTypesRoute = createRoute({
  method: "get",
  operationId: "listWorkItemTypes",
  path: "/workspace/{workspaceId}/work-item-types",
  tags: ["Work items"],
  summary: "List the workspace's work-item types",
  description:
    "The workspace's configured `work_item_type` rows -- what a create dialog's Type " +
    "picker reads. Workspace-scoped: every project in a workspace shares the catalogue.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceCapability("workspace:read"),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "The workspace's work-item types",
      workItemTypeListSchema,
    ),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse(
      "No access to the workspace, or missing workspace:read permission",
    ),
  },
});

const updateWorkItemRoute = createRoute({
  method: "patch",
  operationId: "updateWorkItem",
  path: "/work-items/{key}",
  tags: ["Work items"],
  summary: "Update work item",
  description:
    "Partially update a work item's title, description, priority, startDate or dueDate " +
    "(`WI-8`). Requires `If-Match` with the work item's current version (`WI-7`); a " +
    "mismatch returns 409 with both versions. Label/custom-field editing, state " +
    "transitions and assignment are not part of this route -- see their own mechanisms. " +
    "Changing `priority` additionally requires `work_item:set_priority` " +
    "(`docs/01-architecture/rbac.md`) -- `work_item:update` alone is not enough.",
  middleware: [
    requireWorkItemReach(),
    requireWorkspaceCapability("work_item:update"),
  ] as const,
  request: {
    params: workItemKeyParam,
    headers: ifMatchHeader,
    body: {
      required: true,
      content: { "application/json": { schema: updateWorkItemBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated work item", workItemSchema),
    400: errorResponse("Invalid body, or a malformed If-Match header"),
    403: errorResponse(
      "No workspace access, missing work_item:update permission, or (when the body " +
        "sets priority) missing work_item:set_priority",
    ),
    404: errorResponse("Work item not found"),
    409: jsonResponse(
      "Version mismatch: the work item has changed since If-Match was read",
      workItemVersionConflictSchema,
    ),
  },
});

const listAssignablePeopleRoute = createRoute({
  method: "get",
  operationId: "listAssignablePeople",
  path: "/projects/{projectId}/assignable",
  tags: ["Work items"],
  summary: "List assignable people",
  description:
    "The project roster with each person's open-work count, filtered to the people the " +
    "caller may actually assign to (`assignment.md`): an actor holding `work_item:assign` " +
    "sees the active roster; anyone else with reach sees only themselves; a caller with " +
    "neither capability sees an empty list. The client never filters this itself.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspaceCapability("work_item:read"),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "The people the caller may assign to",
      assignablePeopleSchema,
    ),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("Missing work_item:read permission"),
    404: errorResponse("Project not found"),
  },
});

const assignWorkItemRoute = createRoute({
  method: "post",
  operationId: "assignWorkItem",
  path: "/work-items/{key}/assign",
  tags: ["Work items"],
  summary: "Assign work item",
  description:
    "Assign or reassign a work item (`assignment.md`, `AS-1`/`AS-2`). Requires " +
    "`work_item:assign`; a caller holding only `work_item:update` may assign the item to " +
    "themselves. The target must be an active member of the project's roster (`AS-5`). " +
    "An unconditional assign only succeeds while the item is unassigned; pass " +
    "`expectedCurrentAssigneeId` to replace a specific holder. A lost race returns 409 " +
    "with the current assignee. Clearing an assignment and bulk assign are later slices.",
  // `requireWorkItemReach()` resolves the row by key and its workspace before the body
  // has been parsed; the capability decision itself is field-dependent (`AS-2`'s
  // self-branch reads `body.assigneeId`), so it runs in the handler -- the same placement
  // `PATCH`'s `work_item:set_priority` check uses, for the same reason.
  middleware: [requireWorkItemReach()] as const,
  request: {
    params: workItemKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: assignWorkItemBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The assignment as applied",
      assignWorkItemResponseSchema,
    ),
    400: errorResponse(
      "Invalid body, or the target is not an active member of the project's roster",
    ),
    403: errorResponse(
      "No workspace access, missing work_item:assign, or (for self-assignment) missing " +
        "work_item:update",
    ),
    404: errorResponse("Work item not found"),
    409: jsonResponse(
      "The assignee changed while this request was in flight",
      workItemAssigneeConflictSchema,
    ),
  },
});

const deleteWorkItemRoute = createRoute({
  method: "delete",
  operationId: "deleteWorkItem",
  path: "/work-items/{key}",
  tags: ["Work items"],
  summary: "Delete work item",
  description:
    "Soft-deletes a work item (`WI-21`). KNOWN DEVIATION from `pending-actions.md`'s " +
    "`WI-23` (this route deletes immediately rather than returning a `202` pending " +
    "action awaiting browser approval) -- matches every OTHER existing delete route in " +
    "this codebase today (e.g. `DELETE /api/projects/{id}`), none of which implement " +
    "that mechanism yet. Tracked on issue #428.",
  middleware: [
    requireWorkItemReach(),
    requireWorkspaceCapability("work_item:delete"),
  ] as const,
  request: { params: workItemKeyParam },
  responses: {
    200: jsonResponse("The deleted work item", deletedWorkItemSchema),
    403: errorResponse(
      "No workspace access, or missing work_item:delete permission",
    ),
    404: errorResponse("Work item not found, or already deleted"),
  },
});

const rankWorkItemRoute = createRoute({
  method: "post",
  operationId: "rankWorkItem",
  path: "/work-items/{key}/rank",
  tags: ["Work items"],
  summary: "Re-rank work item",
  description:
    "Reorders a work item within its own project+state partition (`WI-11`-`WI-12`) by " +
    "fractional position. Exempt from `If-Match`; last-write-wins (`WI-7`). At least " +
    "one of `beforeId`/`afterId` (the two items that should end up surrounding this " +
    "one's new slot) is required.",
  middleware: [
    requireWorkItemReach(),
    requireWorkspaceCapability("work_item:rank"),
  ] as const,
  request: {
    params: workItemKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: rankWorkItemBody } },
    },
  },
  responses: {
    200: jsonResponse("The re-ranked work item", rankWorkItemResponseSchema),
    400: errorResponse(
      "Invalid body, or beforeId/afterId is not in the same project/state",
    ),
    403: errorResponse(
      "No workspace access, or missing work_item:rank permission",
    ),
    404: errorResponse("Work item not found"),
  },
});

const setWorkItemParentRoute = createRoute({
  method: "post",
  operationId: "setWorkItemParent",
  path: "/work-items/{key}/parent",
  tags: ["Work items"],
  summary: "Set work item parent",
  description:
    "Attach a work item into a hierarchy under `parentKey` (`relations-and-hierarchy.md` " +
    "`RH-5`..`RH-8`). Rejected at 422 when the proposed parent is the item itself, is a " +
    "descendant of it (a cycle, at any distance), or would exceed the maximum hierarchy " +
    "depth of 5. Parent and child must be in the same project (`RH-6`).",
  middleware: [
    requireWorkItemReach(),
    requireWorkspaceCapability("work_item:update"),
  ] as const,
  request: {
    params: workItemKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: setWorkItemParentBody } },
    },
  },
  responses: {
    200: jsonResponse("The work item with its parent set", workItemSchema),
    400: errorResponse(
      "Invalid body, or the parent is not in the same project (RH-6)",
    ),
    403: errorResponse(
      "No workspace access, or missing work_item:update permission",
    ),
    404: errorResponse("Work item or parent work item not found"),
    409: errorResponse(
      "A concurrent change affected this hierarchy -- reload and retry",
    ),
    422: errorResponse(
      "The proposed parent is the item itself, a descendant of it, or would exceed the " +
        "maximum hierarchy depth of 5",
    ),
  },
});

const detachWorkItemParentRoute = createRoute({
  method: "delete",
  operationId: "detachWorkItemParent",
  path: "/work-items/{key}/parent",
  tags: ["Work items"],
  summary: "Detach work item parent",
  description:
    "Detach a work item from its parent (`RH-11`/`RH-12`). Idempotent when the item " +
    "already has no parent. Detaching mutates the former parent's own roll-up too.",
  middleware: [
    requireWorkItemReach(),
    requireWorkspaceCapability("work_item:update"),
  ] as const,
  request: { params: workItemKeyParam },
  responses: {
    200: jsonResponse("The work item with its parent cleared", workItemSchema),
    403: errorResponse(
      "No workspace access, or missing work_item:update permission",
    ),
    404: errorResponse("Work item not found"),
  },
});

const getWorkItemTreeRoute = createRoute({
  method: "get",
  operationId: "getWorkItemTree",
  path: "/work-items/{key}/tree",
  tags: ["Work items"],
  summary: "Get work item hierarchy tree",
  description:
    "The full hierarchy tree containing this work item -- its true root and every " +
    "descendant beneath it, with the requested item's own node flagged `isCurrent`. " +
    "Capped in total size (`truncated: true` when the real subtree is larger than the " +
    "response returned) -- see `get-work-item-tree.ts`'s own doc comment.",
  middleware: [
    requireWorkItemReach(),
    requireWorkspaceCapability("work_item:read"),
  ] as const,
  request: { params: workItemKeyParam },
  responses: {
    200: jsonResponse("The hierarchy tree", workItemTreeResponseSchema),
    403: errorResponse(
      "No workspace access, or missing work_item:read permission",
    ),
    404: errorResponse("Work item not found"),
  },
});

const watchWorkItemRoute = createRoute({
  method: "post",
  operationId: "watchWorkItem",
  path: "/work-items/{key}/watch",
  tags: ["Work items"],
  summary: "Watch work item",
  description:
    "Starts (or un-mutes) watching a work item (`WI-28`/`WI-29`). Deliberately gated " +
    "on `work_item:read`, not a dedicated watch capability -- anyone with read access " +
    "may watch.",
  middleware: [
    requireWorkItemReach(),
    requireWorkspaceCapability("work_item:read"),
  ] as const,
  request: { params: workItemKeyParam },
  responses: {
    200: jsonResponse("The watch state as applied", workItemWatchStateSchema),
    400: errorResponse("No person profile for this account"),
    403: errorResponse("No workspace access"),
    404: errorResponse("Work item not found"),
  },
});

const unwatchWorkItemRoute = createRoute({
  method: "delete",
  operationId: "unwatchWorkItem",
  path: "/work-items/{key}/watch",
  tags: ["Work items"],
  summary: "Unwatch work item",
  description:
    "Stops watching a work item (`WI-28`/`WI-29`). An implicit watcher (assignee or " +
    "requester) is muted, not deleted, so a later un-mute needs no new implicit watch " +
    "to be recreated; an explicit watcher's row is deleted outright. Idempotent: " +
    "unwatching something never watched is a 200 no-op.",
  middleware: [
    requireWorkItemReach(),
    requireWorkspaceCapability("work_item:read"),
  ] as const,
  request: { params: workItemKeyParam },
  responses: {
    200: jsonResponse("The watch state as applied", workItemWatchStateSchema),
    400: errorResponse("No person profile for this account"),
    403: errorResponse("No workspace access"),
    404: errorResponse("Work item not found"),
  },
});

const bulkWorkItemsRoute = createRoute({
  method: "post",
  operationId: "bulkWorkItems",
  path: "/work-items/bulk",
  tags: ["Work items"],
  summary: "Bulk work item operation",
  description:
    "Runs one operation (`delete` or `assign` -- see `controllers/bulk-work-items.ts` " +
    "for why `WI-24`'s other bulk operations are deferred) over multiple work items, " +
    "transactional PER ITEM (`WI-25`): a partial failure reports per-item reasons " +
    "rather than rolling back the whole batch. `workspaceId` scopes the batch; every " +
    "id is re-checked for reach the same way a single-item call would (`WI-25`: " +
    "'not found' and 'out of reach' share one reason).",
  middleware: [] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: bulkWorkItemsBody } },
    },
  },
  responses: {
    200: jsonResponse("Per-item results", bulkWorkItemsResponseSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No workspace access, or missing the operation's own capability " +
        "(work_item:delete or work_item:assign)",
    ),
  },
});

const listWorkItemActivityRoute = createRoute({
  method: "get",
  operationId: "listWorkItemActivity",
  path: "/work-items/{key}/activity",
  tags: ["Work items"],
  summary: "List work item activity",
  description:
    "The work item's activity journal (`WI-6`), newest first, cursor-paginated. Every " +
    "row is returned regardless of `visibility` -- see the controller's own doc " +
    "comment for why no caller-type filtering is applied yet.",
  middleware: [
    requireWorkItemReach(),
    requireWorkspaceCapability("work_item:read"),
  ] as const,
  request: { params: workItemKeyParam, query: listWorkItemActivityQuery },
  responses: {
    200: jsonResponse(
      "A page of the work item's activity",
      workItemActivityListResponseSchema,
    ),
    400: errorResponse("Invalid query, e.g. a malformed cursor"),
    403: errorResponse(
      "No workspace access, or missing work_item:read permission",
    ),
    404: errorResponse("Work item not found"),
  },
});

const unassignWorkItemRoute = createRoute({
  method: "delete",
  operationId: "unassignWorkItem",
  path: "/work-items/{key}/assign",
  tags: ["Work items"],
  summary: "Unassign work item",
  description:
    "Clear a work item's assignee (`assignment.md`, `AS-2`). Requires " +
    "`work_item:assign`; a caller holding only `work_item:update` may clear their OWN " +
    "assignment (the branch reads the row's current holder, not the request body). " +
    "Clearing an already-unassigned item is an idempotent 200 no-op with no activity " +
    "entry and no event (`AS-9`: work is never silently unassigned, so there is " +
    "nothing to unwrite). A lost race returns 409 with the current assignee. Bulk " +
    "unassign and the `work_item.unassigned` notification fan-out are later slices.",
  // Same reasoning as the assign route directly above: reach resolves the row in
  // middleware, while the capability decision depends on a fact (the row's CURRENT
  // holder) that is only known in the handler.
  middleware: [requireWorkItemReach()] as const,
  request: { params: workItemKeyParam },
  responses: {
    200: jsonResponse(
      "The assignment as cleared",
      unassignWorkItemResponseSchema,
    ),
    403: errorResponse(
      "No workspace access, missing work_item:assign, or (for clearing your own " +
        "assignment) missing work_item:update",
    ),
    404: errorResponse("Work item not found"),
    409: jsonResponse(
      "The assignee changed while this request was in flight",
      workItemAssigneeConflictSchema,
    ),
  },
});

const workItem = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(createWorkItemRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const { typeId, title, description, priority } = c.req.valid("json");
    const { actorId, actorType } = resolveActor(
      c.get("userId"),
      c.get("apiKey"),
    );
    const created = await createWorkItem({
      projectId,
      workspaceId,
      typeId,
      title,
      description,
      priority,
      actorId,
      actorType,
    });
    return c.json(created, 200);
  })
  .openapi(listWorkItemsRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const query = c.req.valid("query");
    const result = await listWorkItems(
      projectId,
      workspaceId,
      c.get("userId"),
      query,
    );
    return c.json(result, 200);
  })
  .openapi(getWorkItemRoute, async (c) => {
    const { key } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const item = await getWorkItemByKey(key, workspaceId);
    return c.json(item, 200);
  })
  .openapi(listWorkItemTypesRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const types = await listWorkItemTypes(workspaceId);
    return c.json(types, 200);
  })
  .openapi(updateWorkItemRoute, async (c) => {
    const { key } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const { "if-match": ifMatch } = c.req.valid("header");
    const assertedVersion = Number(ifMatch.replaceAll('"', ""));
    const { title, description, priority, startDate, dueDate } =
      c.req.valid("json");

    // Field-level authority, on top of the route's `work_item:update` gate above: rbac.md
    // scopes `priority` specifically to `work_item:set_priority`, not `work_item:update` --
    // see `assertCallerHasCapability`'s own doc comment for why this cannot be a second
    // `middleware` entry (the body isn't parsed yet when `middleware` runs). Runs BEFORE
    // `updateWorkItem` so a caller who fails it writes nothing -- no partial update of the
    // other fields.
    if (priority !== undefined) {
      await assertCallerHasCapability(
        workspaceId,
        c.get("userId"),
        "work_item:set_priority",
      );
    }

    const { actorId, actorType } = resolveActor(
      c.get("userId"),
      c.get("apiKey"),
    );

    try {
      const updated = await updateWorkItem(
        key,
        workspaceId,
        assertedVersion,
        actorId,
        actorType,
        {
          title,
          description,
          priority,
          startDate,
          dueDate,
        },
      );
      return c.json(updated, 200);
    } catch (error) {
      if (error instanceof WorkItemVersionConflictError) {
        return c.json(
          {
            message: error.message,
            assertedVersion: error.assertedVersion,
            currentVersion: error.currentVersion,
          },
          409,
        );
      }
      throw error;
    }
  })
  .openapi(listAssignablePeopleRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");

    // The caller's personal id -- resolved as the STAFF person for this user who is on
    // THIS PROJECT'S roster, deterministically. Written this way on the PR #362
    // review's L4 ask, with one correction the review's premise needed: the reviewer
    // read `person_userId_idx` as a plain index and concluded an unordered `LIMIT 1`
    // could pick the wrong row for a user with two person rows. The schema also carries
    // `person_user_unique` (a partial UNIQUE index, migration 0053) whose own comment
    // says "one `user_id` may back at most one `person` row anywhere" precisely so
    // resolveIdentity cannot resolve arbitrarily -- so the multi-row tie is not
    // reachable today. The resolution above is kept anyway, because it makes the id the
    // self branch uses the SAME fact the roster is built from (staff, on this roster),
    // instead of relying on a constraint defined in another file to stay deterministic.
    const [callerPerson] = await db
      .select({ id: personTable.id })
      .from(personTable)
      .innerJoin(membershipTable, eq(membershipTable.personId, personTable.id))
      .where(
        and(
          eq(personTable.userId, userId),
          eq(personTable.side, "staff"),
          eq(membershipTable.scope, "project"),
          eq(membershipTable.scopeId, projectId),
        ),
      )
      .orderBy(personTable.createdAt)
      .limit(1);

    // "May assign anyone" reads the caller's own role through the same
    // `builtInRoleHasCapability` predicate every other authority check uses (#318's
    // genuine-row rule included) -- one source, so this feed cannot disagree with
    // `POST /assign` about what the actor may do.
    const roles = await workspaceMemberRoles(db, workspaceId, userId);
    const hasUnambiguousRole = isUnambiguousMembership(roles);
    const canAssignAnyone =
      hasUnambiguousRole &&
      (await builtInRoleHasCapability(
        workspaceId,
        roles[0],
        "work_item:assign",
      ));
    // The self-only tier keys on the CAPABILITY (`work_item:update`), never on "the
    // caller happens to have a person row" -- PR #362's F2.
    const canSelfAssign =
      hasUnambiguousRole &&
      (await builtInRoleHasCapability(
        workspaceId,
        roles[0],
        "work_item:update",
      ));

    const people = await listAssignablePeople({
      projectId,
      workspaceId,
      callerPersonId: callerPerson?.id ?? null,
      callerCanAssignAnyone: canAssignAnyone,
      callerCanSelfAssign: canSelfAssign,
    });
    return c.json(people, 200);
  })
  .openapi(assignWorkItemRoute, async (c) => {
    const { key } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const { assigneeId, expectedCurrentAssigneeId } = c.req.valid("json");
    const userId = c.get("userId");

    // `AS-2`'s self-branch: `work_item:update` covers assigning the item to the CALLER.
    // The predicate is the one `./policy.ts` declares
    // (`body.assigneeId === identity.personId`), resolved from `person.user_id` -- the
    // same mapping the identity adapter walks (#315). A caller with no person row can
    // never BE the target, so the branch is false and only `work_item:assign` carries
    // them.
    const [callerPerson] = await db
      .select({ id: personTable.id })
      .from(personTable)
      .where(eq(personTable.userId, userId))
      .limit(1);
    await assertCallerHasCapabilityOrSelf(
      workspaceId,
      userId,
      "work_item:assign",
      "work_item:update",
      callerPerson !== undefined && callerPerson.id === assigneeId,
    );

    const { actorId, actorType } = resolveActor(
      c.get("userId"),
      c.get("apiKey"),
    );

    try {
      const assigned = await assignWorkItem(
        key,
        workspaceId,
        actorId,
        actorType,
        callerPerson?.id ?? null,
        { assigneeId, expectedCurrentAssigneeId },
      );
      return c.json(assigned, 200);
    } catch (error) {
      if (error instanceof WorkItemAssigneeConflictError) {
        return c.json(
          {
            message: error.message,
            key: error.key,
            currentAssigneeId: error.currentAssigneeId,
          },
          409,
        );
      }
      throw error;
    }
  })
  .openapi(setWorkItemParentRoute, async (c) => {
    const { key } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const { parentKey } = c.req.valid("json");
    const { actorId, actorType } = resolveActor(
      c.get("userId"),
      c.get("apiKey"),
    );

    const updated = await setWorkItemParent(
      key,
      workspaceId,
      parentKey,
      actorId,
      actorType,
    );
    return c.json(updated, 200);
  })
  .openapi(detachWorkItemParentRoute, async (c) => {
    const { key } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const { actorId, actorType } = resolveActor(
      c.get("userId"),
      c.get("apiKey"),
    );

    const updated = await detachWorkItemParent(
      key,
      workspaceId,
      actorId,
      actorType,
    );
    return c.json(updated, 200);
  })
  .openapi(getWorkItemTreeRoute, async (c) => {
    const { key } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const tree = await getWorkItemTree(key, workspaceId);
    return c.json(tree, 200);
  })
  .openapi(deleteWorkItemRoute, async (c) => {
    const { key } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const { actorId, actorType } = resolveActor(
      c.get("userId"),
      c.get("apiKey"),
    );
    const deleted = await deleteWorkItem(key, workspaceId, actorId, actorType);
    return c.json(deleted, 200);
  })
  .openapi(rankWorkItemRoute, async (c) => {
    const { key } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const { beforeId, afterId } = c.req.valid("json");
    const ranked = await rankWorkItem(key, workspaceId, {
      beforeId,
      afterId,
    });
    return c.json(ranked, 200);
  })
  .openapi(watchWorkItemRoute, async (c) => {
    const { key } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const state = await watchWorkItem(key, workspaceId, userId);
    return c.json(state, 200);
  })
  .openapi(unwatchWorkItemRoute, async (c) => {
    const { key } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const state = await unwatchWorkItem(key, workspaceId, userId);
    return c.json(state, 200);
  })
  .openapi(bulkWorkItemsRoute, async (c) => {
    // F3, Opus security review of PR #433: `workspaceId` here is read straight from
    // the request body, which `assertCallerHasCapability`'s own contract note (see
    // `require-workspace-capability.ts`) says never to do -- it can only check
    // authority IN the workspace it is given, not whether that's the workspace the
    // write actually lands in. Safe today ONLY because `deleteWorkItem`/
    // `assignWorkItem` each independently re-filter every per-item write on this same
    // `workspaceId` (a mismatched id just finds no row and 404s per item) -- this is
    // a load-bearing invariant, not an incidental detail: any future change to this
    // route or its two called controllers must keep that per-item re-filter.
    const { workspaceId, workItemKeys, operation, assigneeId } =
      c.req.valid("json");
    const userId = c.get("userId");

    // No path/param-scoped middleware resolved a workspace for this flat,
    // non-project-scoped route (`policy.ts`'s own comment: `scopeSource: "request"`) --
    // membership is checked directly here, the same `validateWorkspaceAccess` call
    // `require-work-item-reach.ts` and every `workspaceAccess.*` helper use underneath.
    await validateWorkspaceAccess(userId, workspaceId, c.get("apiKey")?.id);

    // Per-OPERATION capability, decided from the parsed body -- see `policy.ts`'s own
    // comment on this route for why a single declarative policy entry cannot express
    // this (the same reason `PATCH /api/work-items/{key}`'s `work_item:set_priority`
    // check lives here instead of a second policy entry).
    await assertCallerHasCapability(
      workspaceId,
      userId,
      operation === "delete" ? "work_item:delete" : "work_item:assign",
    );

    const { actorId, actorType } = resolveActor(
      c.get("userId"),
      c.get("apiKey"),
    );

    const result = await bulkWorkItems(
      workspaceId,
      actorId,
      actorType,
      workItemKeys,
      operation === "delete"
        ? { operation: "delete" }
        : // `assigneeId` is required by `bulkWorkItemsBody`'s own `.refine` whenever
          // `operation === "assign"`, so this is never actually undefined here.
          { operation: "assign", assigneeId: assigneeId as string },
    );
    return c.json(result, 200);
  })
  .openapi(listWorkItemActivityRoute, async (c) => {
    const { key } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const { cursor, limit } = c.req.valid("query");
    const activity = await listWorkItemActivity(key, workspaceId, {
      cursor,
      limit,
    });
    return c.json(activity, 200);
  })
  .openapi(unassignWorkItemRoute, async (c) => {
    const { key } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");

    // `AS-2`'s row branch: `work_item:update` covers clearing the CALLER'S OWN
    // assignment. The predicate is the one `./policy.ts` declares
    // (`row.assignee_id === identity.personId`) and the fact lives on the LOADED ROW,
    // so -- exactly like the assign route's body branch -- the decision runs in the
    // handler, after the middleware's reach/404 answer and before any write. A caller
    // with no person row can never BE the holder, so the branch is false and only
    // `work_item:assign` carries them. The read here is the row the predicate names;
    // the controller re-loads it (same shape as the assign route) and re-scopes its own
    // conditional write.
    const [current] = await db
      .select({ assigneeId: workItemTable.assigneeId })
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.key, key),
          eq(workItemTable.workspaceId, workspaceId),
          isNull(workItemTable.archivedAt),
          isNull(workItemTable.deletedAt),
        ),
      )
      .limit(1);
    if (current === undefined) {
      throw new HTTPException(404, { message: "Work item not found" });
    }
    const [callerPerson] = await db
      .select({ id: personTable.id })
      .from(personTable)
      .where(eq(personTable.userId, userId))
      .limit(1);
    await assertCallerHasCapabilityOrSelf(
      workspaceId,
      userId,
      "work_item:assign",
      "work_item:update",
      callerPerson !== undefined &&
        current.assigneeId !== null &&
        callerPerson.id === current.assigneeId,
    );

    const { actorId, actorType } = resolveActor(
      c.get("userId"),
      c.get("apiKey"),
    );

    try {
      // `current.assigneeId` -- the SAME value the branch above decided against -- is
      // what the controller pins its write to. Passing a fresh read instead was the
      // ordinary review's F1: a reassignment between the two made the pin name the new
      // holder, letting a `work_item:update` caller clear the wrong assignment.
      const cleared = await unassignWorkItem(
        key,
        workspaceId,
        actorId,
        actorType,
        current.assigneeId,
      );
      return c.json(cleared, 200);
    } catch (error) {
      if (error instanceof WorkItemAssigneeConflictError) {
        return c.json(
          {
            message: error.message,
            key: error.key,
            currentAssigneeId: error.currentAssigneeId,
          },
          409,
        );
      }
      throw error;
    }
  });

export default workItem;
