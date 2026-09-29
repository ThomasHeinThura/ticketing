import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createCannedResponse from "./controllers/create-canned-response";
import deleteCannedResponse from "./controllers/delete-canned-response";
import listCannedResponses from "./controllers/list-canned-responses";
import updateCannedResponse from "./controllers/update-canned-response";
import { requireCannedResponseReach } from "./require-canned-response-reach";
import { cannedResponseListSchema, cannedResponseSchema } from "./response";
import {
  cannedResponseIdParam,
  createCannedResponseBody,
  updateCannedResponseBody,
  workspaceIdQuery,
} from "./schema";

const listCannedResponsesRoute = createRoute({
  method: "get",
  operationId: "listCannedResponses",
  path: "/",
  tags: ["Canned responses"],
  summary: "List canned responses",
  description: "A workspace's reusable composer snippets (`CA-19`).",
  middleware: [
    workspaceAccess.fromQuery("workspaceId"),
    requireWorkspaceCapability("work_item:read"),
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse(
      "The workspace's canned responses",
      cannedResponseListSchema,
    ),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("Missing work_item:read permission"),
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
    const { workspaceId } = c.req.valid("query");
    const rows = await listCannedResponses(workspaceId);
    return c.json(rows, 200);
  })
  .openapi(createCannedResponseRoute, async (c) => {
    const { workspaceId, name, body, visibilityDefault } = c.req.valid("json");
    const created = await createCannedResponse({
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
    const updated = await updateCannedResponse(id, workspaceId, input);
    return c.json(updated, 200);
  })
  .openapi(deleteCannedResponseRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const deleted = await deleteCannedResponse(id, workspaceId);
    return c.json(deleted, 200);
  });

export default cannedResponse;
