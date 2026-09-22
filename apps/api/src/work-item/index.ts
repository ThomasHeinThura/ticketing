import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createWorkItem from "./controllers/create-work-item";
import getWorkItemByKey from "./controllers/get-work-item";
import listWorkItems from "./controllers/list-work-items";
import { requireWorkItemReach } from "./require-work-item-reach";
import { workItemListSchema, workItemSchema } from "./response";
import { createWorkItemBody, projectIdParam, workItemKeyParam } from "./schema";

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
    400: errorResponse(
      "Invalid body, unknown/cross-workspace type, or the project has no default state",
    ),
    403: errorResponse(
      "No workspace access, or missing work_item:create permission",
    ),
    404: errorResponse("Project not found"),
  },
});

const listWorkItemsRoute = createRoute({
  method: "get",
  operationId: "listWorkItems",
  path: "/projects/{projectId}/work-items",
  tags: ["Work items"],
  summary: "List work items",
  description:
    "List a project's work items, oldest first by number. Archived and deleted items " +
    "are excluded. Not paginated in this first slice.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspaceCapability("work_item:read"),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The project's work items", workItemListSchema),
    403: errorResponse(
      "No workspace access, or missing work_item:read permission",
    ),
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

const workItem = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(createWorkItemRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const { typeId, title, description, priority } = c.req.valid("json");
    const created = await createWorkItem({
      projectId,
      workspaceId,
      typeId,
      title,
      description,
      priority,
    });
    return c.json(created, 200);
  })
  .openapi(listWorkItemsRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const items = await listWorkItems(projectId, workspaceId);
    return c.json(items, 200);
  })
  .openapi(getWorkItemRoute, async (c) => {
    const { key } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const item = await getWorkItemByKey(key, workspaceId);
    return c.json(item, 200);
  });

export default workItem;
