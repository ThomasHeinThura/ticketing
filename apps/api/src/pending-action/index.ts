import type { Context } from "hono";
import {
  type ApiKey,
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { normaliseTraceId } from "../permissions/shadow-middleware";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  pendingActionDecisionSchema,
  pendingActionListResponseSchema,
  pendingActionReadSchema,
} from "./response";
import {
  pendingActionListQuerySchema,
  pendingActionParamSchema,
} from "./schema";
import {
  decideOwnPendingAction,
  getOwnPendingAction,
  getOwnPendingActions,
  requirePendingActionRequesterIdentity,
} from "./service";

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

const denyPendingActionRoute = createRoute({
  method: "post",
  operationId: "denyOwnPendingAction",
  path: "/pending-actions/{id}/deny",
  tags: ["Pending actions"],
  summary: "Deny a pending action",
  description:
    "Records the requester's denial. Requires the requester's browser session.",
  middleware: [requireSessionOnly()] as const,
  request: { params: pendingActionParamSchema },
  responses: {
    200: jsonResponse(
      "The terminal pending-action state",
      pendingActionDecisionSchema,
    ),
    401: errorResponse("The caller has no current valid identity"),
    403: errorResponse("A browser session is required"),
    404: errorResponse("Pending action not found"),
    409: errorResponse("Pending action is already terminal"),
  },
});

const cancelPendingActionRoute = createRoute({
  method: "post",
  operationId: "cancelOwnPendingAction",
  path: "/pending-actions/{id}/cancel",
  tags: ["Pending actions"],
  summary: "Cancel a pending action",
  description:
    "Cancels the requester's pending action from any authenticated credential.",
  request: { params: pendingActionParamSchema },
  responses: {
    200: jsonResponse(
      "The terminal pending-action state",
      pendingActionDecisionSchema,
    ),
    401: errorResponse("The caller has no current valid identity"),
    404: errorResponse("Pending action not found"),
    409: errorResponse("Pending action is already terminal"),
  },
});

async function decidePendingAction(
  c: Context,
  id: string,
  outcome: "denied" | "cancelled",
) {
  const apiKey = c.get("apiKey") as ApiKey | undefined;
  const requesterPersonId = await requirePendingActionRequesterIdentity(
    c.get("userId"),
    apiKey,
  );
  const session = c.get("session") as { id?: string } | null;
  const result = await decideOwnPendingAction({
    id,
    requesterPersonId,
    outcome,
    sessionId: session?.id ?? null,
  });
  return c.json(pendingActionDecisionSchema.parse(result), 200);
}

const pendingAction = apiRouter()
  .openapi(listPendingActionsRoute, async (c) => {
    const result = await getOwnPendingActions(
      c.get("userId"),
      c.req.valid("query"),
      c.get("apiKey"),
      readAuditContext(c),
    );
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(result, 200);
  })
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
  )
  .openapi(denyPendingActionRoute, (c) =>
    decidePendingAction(c, c.req.valid("param").id, "denied"),
  )
  .openapi(cancelPendingActionRoute, (c) =>
    decidePendingAction(c, c.req.valid("param").id, "cancelled"),
  );

export default pendingAction;
