import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../auth";
import { requireCurrentInstanceAdmin } from "../instance/require-instance-admin";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  providerResponseSchema,
  testProviderSchema,
  writeProviderSchema,
} from "./schema";
import {
  getEmailProvider,
  testEmailProvider,
  updateEmailProvider,
} from "./service";

const path = "/notification-providers/email";
const base = { tags: ["Notification providers"] };
const getRoute = createRoute({
  ...base,
  method: "get",
  path,
  operationId: "getEmailProvider",
  summary: "Get SMTP provider settings",
  responses: {
    200: jsonResponse("Write-only secret metadata", providerResponseSchema),
  },
});
const patchRoute = createRoute({
  ...base,
  method: "patch",
  path,
  operationId: "updateEmailProvider",
  summary: "Save SMTP provider settings",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: writeProviderSchema } },
    },
  },
  responses: { 200: jsonResponse("Saved settings", providerResponseSchema) },
});
const testRoute = createRoute({
  ...base,
  method: "post",
  path: `${path}/test`,
  operationId: "testEmailProvider",
  summary: "Verify SMTP connectivity without sending mail",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: testProviderSchema } },
    },
  },
  responses: {
    200: jsonResponse("SMTP verified", z.object({ verified: z.literal(true) })),
  },
});
const router = apiRouter()
  .openapi(getRoute, async (c) => {
    if (portalForHost(c.req.header("host")) !== "agent")
      throw new HTTPException(403, { message: "Forbidden" });
    await requireCurrentInstanceAdmin(c, "GET", `/api/instance${path}`);
    c.header("Cache-Control", "no-store");
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(await getEmailProvider(), 200);
  })
  .openapi(patchRoute, async (c) => {
    if (portalForHost(c.req.header("host")) !== "agent")
      throw new HTTPException(403, { message: "Forbidden" });
    await requireCurrentInstanceAdmin(c, "PATCH", `/api/instance${path}`);
    const identity = await resolveRequestIdentity({ userId: c.get("userId") });
    if (!identity) throw new HTTPException(403, { message: "Forbidden" });
    c.header("Cache-Control", "no-store");
    const result = await updateEmailProvider(c.req.valid("json"), {
      userId: c.get("userId"),
      personId: identity.personId,
      traceId: c.req.header("x-request-id"),
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(result, 200);
  })
  .openapi(testRoute, async (c) => {
    if (portalForHost(c.req.header("host")) !== "agent")
      throw new HTTPException(403, { message: "Forbidden" });
    await requireCurrentInstanceAdmin(c, "POST", `/api/instance${path}/test`);
    const identity = await resolveRequestIdentity({ userId: c.get("userId") });
    if (!identity) throw new HTTPException(403, { message: "Forbidden" });
    c.header("Cache-Control", "no-store");
    const result = await testEmailProvider(c.req.valid("json"), {
      userId: c.get("userId"),
      personId: identity.personId,
      traceId: c.req.header("x-request-id"),
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(result, 200);
  });
export default router;
