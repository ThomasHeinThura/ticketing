import { HTTPException } from "hono/http-exception";
import { requireCurrentInstanceAdmin } from "../instance/require-instance-admin";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { requestRegisteredDeletion } from "../pending-action/deletion-targets";
import { requireSessionOnly } from "../utils/require-session-only";
import { IDENTITY_CONNECTION_DELETION_ROUTE } from "./connection-deletion-policy";

const deleteConnectionRoute = createRoute({
  method: "delete",
  path: "/identity-connections/{id}",
  operationId: "requestIdentityConnectionDeletion",
  tags: ["Identity connections"],
  summary: "Request identity connection deletion",
  middleware: [requireSessionOnly()] as const,
  request: { params: z.object({ id: z.string().min(1).max(128) }) },
  responses: {
    202: jsonResponse(
      "Identity connection deletion pending approval",
      z.object({
        pendingActionId: z.string(),
        action: z.literal("delete"),
        summary: z.record(z.string(), z.unknown()),
        confirmation: z.literal("typed_name_step_up"),
        expiresAt: z.string().datetime(),
        approveUrl: z.string(),
      }),
    ),
    403: jsonResponse("Forbidden", z.object({ message: z.string() })),
    404: jsonResponse(
      "Connection unavailable",
      z.object({ message: z.string() }),
    ),
    409: jsonResponse(
      "A deletion is already pending",
      z.object({ message: z.string() }),
    ),
  },
});

const router = apiRouter();

router.openapi(deleteConnectionRoute, async (c) => {
  c.header("Cache-Control", "no-store");
  await requireCurrentInstanceAdmin(
    c,
    "DELETE",
    "/api/instance/identity-connections/{id}",
  );
  const session = c.get("session") as {
    id: string;
    impersonatedBy?: string | null;
  } | null;
  if (!session || session.impersonatedBy)
    throw new HTTPException(403, { message: "Forbidden" });
  const result = await requestRegisteredDeletion(c, {
    routeKey: IDENTITY_CONNECTION_DELETION_ROUTE,
    targetType: "identity_connection",
    id: c.req.valid("param").id,
  });
  if (result.confirmation !== "typed_name_step_up")
    throw new HTTPException(500, {
      message: "Identity connection deletion confirmation invariant failed",
    });
  return c.json({ ...result, confirmation: result.confirmation }, 202);
});

export default router;
