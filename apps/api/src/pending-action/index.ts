import type { Context } from "hono";
import {
  type ApiKey,
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { normaliseTraceId } from "../permissions/shadow-middleware";
import {
  pendingActionListResponseSchema,
  pendingActionReadSchema,
} from "./response";
import {
  pendingActionListQuerySchema,
  pendingActionParamSchema,
} from "./schema";
import { getOwnPendingAction, getOwnPendingActions } from "./service";

function readAuditContext(c: Context) {
  return {
    apiKeyId: (c.get("apiKey") as ApiKey | undefined)?.id ?? null,
    traceId: normaliseTraceId(c.req.header("x-request-id")),
  };
}

const listPendingActionsRoute = createRoute({
  method: "get",
  operationId: "listOwnPendingActions",
  path: "/pending-actions",
  tags: ["Pending actions"],
  summary: "List the caller's pending actions",
  description:
    "Returns pending actions owned by the authenticated caller, newest first.",
  request: { query: pendingActionListQuerySchema },
  responses: {
    200: jsonResponse(
      "The caller's pending actions",
      pendingActionListResponseSchema,
    ),
    401: errorResponse("The caller has no current valid identity"),
    400: errorResponse("Invalid cursor or limit"),
  },
});

const getPendingActionRoute = createRoute({
  method: "get",
  operationId: "getOwnPendingAction",
  path: "/pending-actions/{id}",
  tags: ["Pending actions"],
  summary: "Get one of the caller's pending actions",
  description:
    "Returns the caller's action in any state so API and MCP clients can poll its outcome.",
  request: { params: pendingActionParamSchema },
  responses: {
    200: jsonResponse("The caller's pending action", pendingActionReadSchema),
    401: errorResponse("The caller has no current valid identity"),
    404: errorResponse("Pending action not found"),
  },
});

const pendingAction = apiRouter()
  .openapi(listPendingActionsRoute, async (c) =>
    c.json(
      await getOwnPendingActions(
        c.get("userId"),
        c.req.valid("query"),
        c.get("apiKey"),
        readAuditContext(c),
      ),
      200,
    ),
  )
  .openapi(getPendingActionRoute, async (c) =>
    c.json(
      await getOwnPendingAction(
        c.get("userId"),
        c.req.valid("param").id,
        c.get("apiKey"),
        readAuditContext(c),
      ),
      200,
    ),
  );

export default pendingAction;
