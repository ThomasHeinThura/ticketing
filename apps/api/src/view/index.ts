import {
  type ApiKey,
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import {
  createPendingAction,
  requirePendingActionRequesterIdentity,
} from "../pending-action/service";
import type { ApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import type { SavedViewAuditActor } from "./audit";
import createView from "./controllers/create-view";
import getView from "./controllers/get-view";
import listViews from "./controllers/list-views";
import pinView from "./controllers/pin-view";
import { countSavedView, runSavedView } from "./controllers/run-view";
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

const runViewQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(4096).optional(),
});

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

const runViewRoute = createRoute({
  method: "post",
  operationId: "runSavedView",
  path: "/{id}/run",
  tags: ["Views"],
  summary: "Run a saved view for the current viewer",
  description:
    "Executes the stored query with current work-item reach and field permissions.",
  middleware: [
    workspaceAccess.fromSavedView(),
    requireWorkspaceCapability("saved_view:read"),
  ] as const,
  request: { params: savedViewIdParam, query: runViewQuery },
  responses: {
    200: jsonResponse("A page of reachable matching work items", z.unknown()),
    404: errorResponse("Saved view not found or out of reach"),
    422: errorResponse("Saved query contains unsupported filters"),
  },
});

const countViewRoute = createRoute({
  method: "get",
  operationId: "countSavedView",
  path: "/{id}/count",
  tags: ["Views"],
  summary: "Count reachable work items matching a saved view",
  description:
    "The count uses the current viewer's work-item reach. When Valkey is configured, an authorized count may be cached for up to 30 seconds.",
  middleware: [
    workspaceAccess.fromSavedView(),
    requireWorkspaceCapability("saved_view:read"),
  ] as const,
  request: { params: savedViewIdParam },
  responses: {
    200: jsonResponse(
      "Reachable matching work-item count",
      z.object({ count: z.number().int().nonnegative() }),
    ),
    404: errorResponse("Saved view not found or out of reach"),
    422: errorResponse("Saved query contains unsupported filters"),
  },
});

const deleteViewRoute = createRoute({
  method: "delete",
  operationId: "requestDeleteView",
  path: "/{id}",
  tags: ["Views"],
  summary: "Request saved-view deletion",
  description:
    "Creates a pending action and returns 202. The saved view remains available until the requester approves it in a browser session (pending-actions.md PA-1..PA-6).",
  middleware: [
    workspaceAccess.fromSavedView(),
    requireWorkspaceCapability("saved_view:create"),
  ] as const,
  request: { params: savedViewIdParam },
  responses: {
    202: jsonResponse(
      "Pending approval; no saved-view data is deleted yet",
      z.object({
        pendingActionId: z.string(),
        action: z.literal("delete"),
        summary: z.record(z.string(), z.unknown()),
        confirmation: z.literal("click"),
        expiresAt: z.string().datetime(),
        approveUrl: z.string(),
      }),
    ),
    403: errorResponse(
      "Missing saved_view:create or workspace:manage_settings",
    ),
    404: errorResponse("Saved view not found"),
    409: errorResponse("A pending saved-view deletion already exists"),
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
    const userId = c.get("userId") as string;
    const personId = await resolveCallerPersonId(userId);
    const actor = savedViewAuditActor(userId, c.get("apiKey")?.id);
    return c.json(
      await createView(
        body,
        personId,
        userId,
        actor,
        c.get("apiKey") as ApiKeyPermissionScope | undefined,
      ),
      200,
    );
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
    return c.json(
      await updateView(
        id,
        body,
        personId,
        userId,
        actor,
        c.get("apiKey") as ApiKeyPermissionScope | undefined,
      ),
      200,
    );
  })
  .openapi(pinViewRoute, async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("userId");
    const personId = await resolveCallerPersonId(userId);
    const actor = savedViewAuditActor(userId, c.get("apiKey")?.id);
    return c.json(await pinView(id, personId, userId, actor), 200);
  })
  .openapi(runViewRoute, async (c) => {
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    const userId = c.get("userId") as string;
    const session = c.get("session") as {
      impersonatedBy?: string | null;
    } | null;
    const personId = await resolveCallerPersonId(userId);
    const result = await runSavedView({
      id,
      personId,
      userId,
      apiKey: c.get("apiKey") as ApiKey | undefined,
      impersonatedBy: session?.impersonatedBy,
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json(result, 200);
  })
  .openapi(countViewRoute, async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("userId") as string;
    const session = c.get("session") as {
      impersonatedBy?: string | null;
    } | null;
    const personId = await resolveCallerPersonId(userId);
    const result = await countSavedView({
      id,
      personId,
      userId,
      apiKey: c.get("apiKey") as ApiKey | undefined,
      impersonatedBy: session?.impersonatedBy,
    });
    return c.json(result, 200);
  })
  .openapi(deleteViewRoute, async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("userId") as string;
    const apiKey = c.get("apiKey") as ApiKey | undefined;
    const requesterPersonId = await requirePendingActionRequesterIdentity(
      userId,
      apiKey,
    );
    const created = await createPendingAction({
      requesterPersonId,
      credentialType: apiKey ? "api_key" : "session",
      credentialId: apiKey?.id ?? null,
      apiKey,
      origin: apiKey ? "api" : "web",
      action: "delete",
      routeKey: "DELETE /api/views/{id}",
      targetType: "saved_view",
      targetIds: [id],
      workspaceId: (c as unknown as { get(key: "workspaceId"): string }).get(
        "workspaceId",
      ),
      projectId: null,
      organisationId: null,
      actorId: userId,
      actorType: apiKey ? "api_key" : "person",
      actorIp: c.req.header("x-forwarded-for") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    return c.json(
      z
        .object({
          pendingActionId: z.string(),
          action: z.literal("delete"),
          summary: z.record(z.string(), z.unknown()),
          confirmation: z.literal("click"),
          expiresAt: z.string().datetime(),
          approveUrl: z.string(),
        })
        .parse(created),
      202,
    );
  });

export default view;
