import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import type { SavedViewAuditActor } from "./audit";
import createView from "./controllers/create-view";
import getView from "./controllers/get-view";
import listViews from "./controllers/list-views";
import pinView from "./controllers/pin-view";
import updateView from "./controllers/update-view";
import { resolveCallerPersonId } from "./resolve-person-id";
import {
  pinnedViewIdsSchema,
  reachableSavedViewListSchema,
  savedViewSchema,
} from "./response";
import {
  createViewBody,
  listViewsQuery,
  savedViewIdParam,
  updateViewBody,
} from "./schema";

function savedViewAuditActor(
  userId: string,
  apiKeyId: string | undefined,
): SavedViewAuditActor {
  return {
    actorId: userId,
    actorType: apiKeyId ? "api_key" : "person",
    apiKeyId: apiKeyId ?? null,
  };
}

const listViewsRoute = createRoute({
  method: "get",
  operationId: "listViews",
  path: "/",
  tags: ["Views"],
  summary: "List saved views",
  description:
    "Every saved view the caller can reach in this workspace: their own, workspace-visible " +
    "views, and team views for teams they belong to (search-and-saved-views.md SV-15..18). " +
    "Each result includes the caller's restored pin state; pinned views are first (SV-20).",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("saved_view:read"),
  ] as const,
  request: { query: listViewsQuery },
  responses: {
    200: jsonResponse(
      "Reachable saved views with caller pin state",
      reachableSavedViewListSchema,
    ),
    400: errorResponse("workspaceId could not be determined"),
    403: errorResponse("Missing saved_view:read permission"),
  },
});

const createViewRoute = createRoute({
  method: "post",
  operationId: "createView",
  path: "/",
  tags: ["Views"],
  summary: "Create saved view",
  description:
    "A saved view is a stored search plus a presentation choice " +
    "(search-and-saved-views.md). A workspace-visible view additionally requires " +
    "workspace:manage_settings (SV-18); publishing a team view requires " +
    "saved_view:share and membership in that team.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspaceCapability("saved_view:create"),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createViewBody } },
    },
  },
  responses: {
    200: jsonResponse("Saved view created", savedViewSchema),
    400: errorResponse(
      "Invalid body, workspaceId could not be determined, or scopeId does not belong to it",
    ),
    403: errorResponse(
      "Missing saved_view:create, saved_view:share, or workspace:manage_settings " +
        "permission, or missing membership in the target team",
    ),
  },
});

const getViewRoute = createRoute({
  method: "get",
  operationId: "getView",
  path: "/{id}",
  tags: ["Views"],
  summary: "Get saved view",
  middleware: [
    workspaceAccess.fromSavedView(),
    requireWorkspaceCapability("saved_view:read"),
  ] as const,
  request: { params: savedViewIdParam },
  responses: {
    200: jsonResponse("The saved view", savedViewSchema),
    400: errorResponse("id must not contain a NUL (\\u0000) byte"),
    403: errorResponse("Missing saved_view:read permission"),
    404: errorResponse("Saved view not found, or out of reach for this viewer"),
  },
});

const updateViewRoute = createRoute({
  method: "patch",
  operationId: "updateView",
  path: "/{id}",
  tags: ["Views"],
  summary: "Update saved view",
  description:
    "The owner, or a caller with workspace:manage_settings, may edit a view. " +
    "Changing a view's team audience additionally requires saved_view:share and " +
    "membership in the target team.",
  middleware: [
    workspaceAccess.fromSavedView(),
    requireWorkspaceCapability("saved_view:create"),
  ] as const,
  request: {
    params: savedViewIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateViewBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated saved view", savedViewSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "Not the view's owner, missing workspace:manage_settings, or missing " +
        "saved_view:share permission / membership in the target team",
    ),
    404: errorResponse("Saved view not found"),
  },
});

const pinViewRoute = createRoute({
  method: "post",
  operationId: "pinView",
  path: "/{id}/pin",
  tags: ["Views"],
  summary: "Toggle pinning a saved view",
  description: "SV-20. Toggles: pinning an already-pinned view unpins it.",
  middleware: [workspaceAccess.fromSavedView()] as const,
  request: { params: savedViewIdParam },
  responses: {
    200: jsonResponse(
      "The caller's pinned view ids for this workspace",
      pinnedViewIdsSchema,
    ),
    404: errorResponse("Saved view not found"),
  },
});

const view = apiRouter()
  .openapi(listViewsRoute, async (c) => {
    const { workspaceId } = c.req.valid("query");
    const personId = await resolveCallerPersonId(c.get("userId"));
    return c.json(await listViews(workspaceId, personId, c.get("userId")), 200);
  })
  .openapi(createViewRoute, async (c) => {
    const body = c.req.valid("json");
    const userId = c.get("userId");
    const personId = await resolveCallerPersonId(userId);
    const actor = savedViewAuditActor(userId, c.get("apiKey")?.id);
    return c.json(await createView(body, personId, userId, actor), 200);
  })
  .openapi(getViewRoute, async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("userId");
    const personId = await resolveCallerPersonId(userId);
    return c.json(await getView(id, personId, userId), 200);
  })
  .openapi(updateViewRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const userId = c.get("userId");
    const personId = await resolveCallerPersonId(userId);
    const actor = savedViewAuditActor(userId, c.get("apiKey")?.id);
    return c.json(await updateView(id, body, personId, userId, actor), 200);
  })
  .openapi(pinViewRoute, async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("userId");
    const personId = await resolveCallerPersonId(userId);
    const actor = savedViewAuditActor(userId, c.get("apiKey")?.id);
    return c.json(await pinView(id, personId, userId, actor), 200);
  });

export default view;
