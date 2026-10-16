import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { resolveCallerIdentity } from "../utils/has-project-reach";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createCannedResponse from "./controllers/create-canned-response";
import deleteCannedResponse from "./controllers/delete-canned-response";
import listCannedResponses from "./controllers/list-canned-responses";
import updateCannedResponse from "./controllers/update-canned-response";
import {
  requireCannedResponseListReach,
  requireCannedResponseReach,
} from "./require-canned-response-reach";
import { cannedResponseListSchema, cannedResponseSchema } from "./response";
import {
  cannedResponseIdParam,
  cannedResponseListQuery,
  createCannedResponseBody,
  updateCannedResponseBody,
} from "./schema";

const listCannedResponsesRoute = createRoute({
  method: "get",
  operationId: "listCannedResponses",
  path: "/",
  tags: ["Canned responses"],
  summary: "List canned responses",
  description:
    "Reusable composer snippets available on this work item (`CA-19`).",
  middleware: [requireCannedResponseListReach()] as const,
  request: { query: cannedResponseListQuery },
  responses: {
    200: jsonResponse(
      "Canned responses available on the work item",
      cannedResponseListSchema,
    ),
    400: errorResponse("Work item key is required"),
    403: errorResponse("Missing work_item:read permission"),
    404: errorResponse("Work item not found or not reachable"),
  },
});

const createCannedResponseRoute = createRoute({
  method: "post",
  operationId: "createCannedResponse",
  path: "/",
  tags: ["Canned responses"],
  summary: "Create canned response",
  description: "Requires `workspace:manage_settings` (`CA-19`).",
  middleware: [
    workspaceAccess.fromBody("workspaceId"),
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createCannedResponseBody } },
    },
  },
  responses: {
    200: jsonResponse("The created canned response", cannedResponseSchema),
    400: errorResponse("Invalid body, or workspace ID could not be determined"),
    403: errorResponse("Missing workspace:manage_settings permission"),
    409: errorResponse("A canned response with this name already exists"),
  },
});

const updateCannedResponseRoute = createRoute({
  method: "patch",
  operationId: "updateCannedResponse",
  path: "/{id}",
  tags: ["Canned responses"],
  summary: "Update canned response",
  middleware: [
    requireCannedResponseReach(),
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: {
    params: cannedResponseIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateCannedResponseBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated canned response", cannedResponseSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No workspace access, or missing workspace:manage_settings permission",
    ),
    404: errorResponse("Canned response not found"),
    409: errorResponse("A canned response with this name already exists"),
  },
});

const deleteCannedResponseRoute = createRoute({
  method: "delete",
  operationId: "deleteCannedResponse",
  path: "/{id}",
  tags: ["Canned responses"],
  summary: "Delete canned response",
  middleware: [
    requireCannedResponseReach(),
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: { params: cannedResponseIdParam },
  responses: {
    200: jsonResponse("The deleted canned response", cannedResponseSchema),
    403: errorResponse(
      "No workspace access, or missing workspace:manage_settings permission",
    ),
    404: errorResponse("Canned response not found"),
  },
});

const cannedResponse = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listCannedResponsesRoute, async (c) => {
    const { workItemKey } = c.req.valid("query");
    const identity = await resolveCallerIdentity(c, c.get("userId"));
    if (!identity) throw new HTTPException(401, { message: "Unauthorized" });
    const rows = await listCannedResponses(identity, workItemKey);
    return c.json(rows, 200);
  })
  .openapi(createCannedResponseRoute, async (c) => {
    const { workspaceId, name, body, visibilityDefault } = c.req.valid("json");
    const identity = await resolveCallerIdentity(c, c.get("userId"));
    if (!identity) throw new HTTPException(401, { message: "Unauthorized" });
    const created = await createCannedResponse(identity, {
      workspaceId,
      name,
      body,
      visibilityDefault,
      createdBy: c.get("userId"),
    });
    return c.json(created, 200);
  })
  .openapi(updateCannedResponseRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const input = c.req.valid("json");
    const identity = await resolveCallerIdentity(c, c.get("userId"));
    if (!identity) throw new HTTPException(401, { message: "Unauthorized" });
    const updated = await updateCannedResponse(
      identity,
      id,
      workspaceId,
      input,
    );
    return c.json(updated, 200);
  })
  .openapi(deleteCannedResponseRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const identity = await resolveCallerIdentity(c, c.get("userId"));
    if (!identity) throw new HTTPException(401, { message: "Unauthorized" });
    const deleted = await deleteCannedResponse(identity, id, workspaceId);
    return c.json(deleted, 200);
  });

export default cannedResponse;
