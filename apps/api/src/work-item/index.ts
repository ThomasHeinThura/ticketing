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
  requireWorkspaceCapability,
} from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import type { ActivityActorType } from "./activity";
import createWorkItem from "./controllers/create-work-item";
import getWorkItemByKey from "./controllers/get-work-item";
import listWorkItemTypes from "./controllers/list-work-item-types";
import listWorkItems from "./controllers/list-work-items";
import updateWorkItem, {
  WorkItemVersionConflictError,
} from "./controllers/update-work-item";
import { requireWorkItemReach } from "./require-work-item-reach";
import {
  workItemListResponseSchema,
  workItemSchema,
  workItemTypeListSchema,
  workItemVersionConflictSchema,
} from "./response";
import {
  createWorkItemBody,
  ifMatchHeader,
  listWorkItemsQuery,
  projectIdParam,
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
    200: jsonResponse("The work item", workItemSchema),
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
  });

export default workItem;
