import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  type ApiKey,
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { normaliseTraceId } from "../permissions/shadow-middleware";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  pendingActionApprovalSchema,
  pendingActionDecisionSchema,
  pendingActionListResponseSchema,
  pendingActionReadSchema,
} from "./response";
import {
  pendingActionListQuerySchema,
  pendingActionParamSchema,
} from "./schema";
import {
  approveSavedViewDeletion,
  approveServiceCalendarDeletion,
  approveUserDeactivation,
  decideOwnPendingAction,
  getOwnPendingAction,
  getOwnPendingActions,
  getPendingActionExecutionTarget,
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

const approvePendingActionRoute = createRoute({
  method: "post",
  operationId: "approveOwnPendingAction",
  path: "/pending-actions/{id}/approve",
  tags: ["Pending actions"],
  summary: "Approve a pending action",
  description:
    "Executes a pending action owned by the authenticated requester after its server-selected confirmation.",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: pendingActionParamSchema,
    headers: z.object({
      "x-taskdesk-step-up-token": z.string().length(43).optional(),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({ typedName: z.string().max(320).optional() })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Approved pending action executed",
      pendingActionApprovalSchema,
    ),
    400: errorResponse("The typed target name does not match"),
    401: errorResponse("The current session is unavailable"),
    403: errorResponse("Current authority or PA-15 proof is unavailable"),
    404: errorResponse("Pending action not found"),
    409: errorResponse("Pending action is stale, terminal, or unsupported"),
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
  .openapi(approvePendingActionRoute, async (c) => {
    const apiKey = c.get("apiKey") as ApiKey | undefined;
    const requesterPersonId = await requirePendingActionRequesterIdentity(
      c.get("userId"),
      apiKey,
    );
    const session = c.get("session") as { id?: string } | null;
    if (!session?.id) throw new HTTPException(401, { message: "Unauthorized" });
    const id = c.req.valid("param").id;
    const typedName = c.req.valid("json").typedName;
    const token = c.req.valid("header")["x-taskdesk-step-up-token"];
    const traceId = normaliseTraceId(c.req.header("x-request-id"));
    const target = await getPendingActionExecutionTarget({
      id,
      requesterPersonId,
    });
    const result =
      target.targetType === "service_calendar"
        ? await approveServiceCalendarDeletion({
            id,
            requesterPersonId,
            userId: c.get("userId"),
            sessionId: session.id,
            traceId,
          })
        : target.targetType === "saved_view"
          ? await approveSavedViewDeletion({
              id,
              requesterPersonId,
              userId: c.get("userId"),
              sessionId: session.id,
              traceId,
            })
          : target.targetType === "user" &&
              target.action === "delete" &&
              target.routeKey === "POST /api/instance/users/{id}/deactivate" &&
              typedName !== undefined
            ? token === undefined
              ? (() => {
                  throw new HTTPException(403, { message: "step_up_expired" });
                })()
              : await approveUserDeactivation({
                  id,
                  requesterPersonId,
                  userId: c.get("userId"),
                  sessionId: session.id,
                  typedName,
                  stepUpToken: token,
                  traceId,
                })
            : (() => {
                throw new HTTPException(409, {
                  message: "pending_action_kind_unsupported",
                });
              })();
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      { id: result.id, state: result.state as "executed" | "expired" },
      200,
    );
  })
  .openapi(denyPendingActionRoute, (c) =>
    decidePendingAction(c, c.req.valid("param").id, "denied"),
  )
  .openapi(cancelPendingActionRoute, (c) =>
    decidePendingAction(c, c.req.valid("param").id, "cancelled"),
  );

export default pendingAction;
