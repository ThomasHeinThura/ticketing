import { bodyLimit } from "hono/body-limit";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { requireSessionOnly } from "../utils/require-session-only";
import { settingsSchema } from "./response";
import { patchSettingsBody } from "./schema";
import { getOwnSettings, patchOwnSettings } from "./service";
import { SETTINGS_BODY_MAX_BYTES } from "./whitelist";

const getSettingsRoute = createRoute({
  method: "get",
  operationId: "getOwnSettings",
  path: "/settings",
  tags: ["User settings"],
  summary: "Get the caller's profile settings",
  description:
    "Returns the caller's own stored settings (whitelisted keys only). A layout for a project the caller can no longer reach is omitted.",
  responses: {
    200: jsonResponse("The caller's settings", settingsSchema),
  },
});

const patchSettingsRoute = createRoute({
  method: "patch",
  operationId: "patchOwnSettings",
  path: "/settings",
  tags: ["User settings"],
  summary: "Update the caller's profile settings",
  description:
    "Apply a partial object of whitelisted keys (`density`, `layout.<projectId>`); `null` clears a key. All keys are validated before any is written. Browser session only; API keys are refused.",
  middleware: [
    requireSessionOnly(),
    bodyLimit({
      maxSize: SETTINGS_BODY_MAX_BYTES,
      onError: (c) => c.text("Payload too large", 413),
    }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: patchSettingsBody } },
    },
  },
  responses: {
    200: jsonResponse("The caller's updated settings", settingsSchema),
    400: errorResponse("Invalid request"),
    403: errorResponse("A browser session is required"),
    404: errorResponse("Project not found"),
    413: errorResponse("Payload too large"),
    422: errorResponse("Key or value not allowed"),
  },
});

const userPreference = apiRouter()
  .openapi(getSettingsRoute, async (c) => {
    const result = await getOwnSettings(c.get("userId"));
    // Only the caller's own rows were read; mark after the read succeeds so a failure
    // leaves the shadow comparison unknown.
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(result, 200);
  })
  .openapi(patchSettingsRoute, async (c) =>
    c.json(await patchOwnSettings(c.get("userId"), c.req.valid("json")), 200),
  );

export default userPreference;
