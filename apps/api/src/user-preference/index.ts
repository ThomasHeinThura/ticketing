import { bodyLimit } from "hono/body-limit";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { requireSessionOnly } from "../utils/require-session-only";
import { preferenceListSchema, preferenceWrittenSchema } from "./response";
import {
  listPreferencesQuery,
  preferencePathParams,
  putPreferenceBody,
} from "./schema";
import { listOwnPreferences, putOwnPreference } from "./service";
import { PREFERENCE_BODY_MAX_BYTES } from "./whitelist";

const listPreferencesRoute = createRoute({
  method: "get",
  operationId: "listOwnPreferences",
  path: "/preferences",
  tags: ["User preferences"],
  summary: "List the caller's preferences for one scope",
  description:
    "Returns the caller's own stored preferences (whitelisted keys only) for a global, workspace or project scope. A workspace or project the caller cannot reach is 404.",
  request: { query: listPreferencesQuery },
  responses: {
    200: jsonResponse("The caller's preferences", preferenceListSchema),
    400: errorResponse("Invalid request"),
    404: errorResponse("Workspace or project not found"),
    422: errorResponse("Invalid scope or scopeId"),
  },
});

const putPreferenceRoute = createRoute({
  method: "put",
  operationId: "putOwnPreference",
  path: "/preferences/{scope}/{key}",
  tags: ["User preferences"],
  summary: "Set one of the caller's preferences",
  description:
    "Create or replace the caller's value for a whitelisted key. Browser session only; API keys are refused.",
  middleware: [
    requireSessionOnly(),
    bodyLimit({
      maxSize: PREFERENCE_BODY_MAX_BYTES,
      onError: (c) => c.text("Payload too large", 413),
    }),
  ] as const,
  request: {
    params: preferencePathParams,
    body: {
      required: true,
      content: { "application/json": { schema: putPreferenceBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored preference", preferenceWrittenSchema),
    400: errorResponse("Invalid request"),
    403: errorResponse("A browser session is required"),
    404: errorResponse("Workspace or project not found"),
    413: errorResponse("Payload too large"),
    422: errorResponse("Key, scope or value not allowed"),
  },
});

const userPreference = apiRouter()
  .openapi(listPreferencesRoute, async (c) => {
    const result = await listOwnPreferences(
      c.get("userId"),
      c.req.valid("query"),
    );
    // Only the caller's own rows were read; mark after the read succeeds so a failure
    // leaves the shadow comparison unknown.
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(result, 200);
  })
  .openapi(putPreferenceRoute, async (c) => {
    const { scope, key } = c.req.valid("param");
    const { scopeId, value } = c.req.valid("json");
    return c.json(
      await putOwnPreference(c.get("userId"), {
        scope,
        key,
        ...(scopeId === undefined ? {} : { scopeId }),
        value,
      }),
      200,
    );
  });

export default userPreference;
