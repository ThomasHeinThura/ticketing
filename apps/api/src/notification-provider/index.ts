import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../auth";
import { runWithStepUp, stepUpTokenHeader } from "../auth/step-up-spend";
import { requireCurrentInstanceAdmin } from "../instance/require-instance-admin";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  providerResponseSchema,
  testProviderSchema,
  testResultSchema,
  writeProviderSchema,
} from "./schema";
import {
  getEmailProvider,
  testEmailProvider,
  updateEmailProvider,
} from "./service";
import { NOTIFICATION_PROVIDER_SAVE_OPERATION } from "./step-up-binding";

const path = "/notification-providers/email";
const base = { tags: ["Notification providers"] };
const getRoute = createRoute({
  ...base,
  method: "get",
  path,
  operationId: "getEmailProvider",
  summary: "Get SMTP provider settings",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse("Write-only secret metadata", providerResponseSchema),
  },
});
const errorSchema = z.object({ message: z.string() });
const patchRoute = createRoute({
  ...base,
  method: "patch",
  path,
  operationId: "updateEmailProvider",
  summary: "Save email provider settings with a one-use step-up proof",
  description:
    "Current instance administrators on the agent host, browser sessions only. Elevated (PA-15 operation `notification_provider_save`): the proof binds the settings, the enabled flag, the version and the password's keep/clear/replace intent, because this mail carries password-reset and invitation links. Saving changed settings resets the saved test status.",
  middleware: [requireSessionOnly()] as const,
  request: {
    headers: stepUpTokenHeader,
    body: {
      required: true,
      content: { "application/json": { schema: writeProviderSchema } },
    },
  },
  responses: {
    200: jsonResponse("Saved settings", providerResponseSchema),
    403: jsonResponse("Forbidden or fresh verification required", errorSchema),
    409: jsonResponse("The settings changed since they were read", errorSchema),
  },
});
const testRoute = createRoute({
  ...base,
  method: "post",
  path: `${path}/test`,
  operationId: "testEmailProvider",
  summary: "Send a real test email through the email provider settings",
  description:
    "Current instance administrators on the agent host, browser sessions only; no step-up. Sends one fixed message to the given recipient using the unsaved form values when supplied, rate limited to 5 per administrator per minute and audited with the recipient's domain only. When the tested settings match the saved settings, the result may be stored as test status. A delivery failure is a 200 answer carrying a bounded category, the SMTP reply code and the provider's text with addresses, hosts and credentials removed.",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: testProviderSchema } },
    },
  },
  responses: {
    200: jsonResponse("Test send result", testResultSchema),
    429: jsonResponse("Too many tests", errorSchema),
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
    const request = c.req.valid("json");
    const result = await runWithStepUp(
      c,
      { operation: NOTIFICATION_PROVIDER_SAVE_OPERATION, ...request },
      (spend) =>
        updateEmailProvider(
          request,
          {
            userId: c.get("userId"),
            personId: identity.personId,
            traceId: c.req.header("x-request-id"),
          },
          spend,
        ),
    );
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
