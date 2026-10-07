import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { requireSessionOnly } from "../utils/require-session-only";
import { callerMembershipResolution } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import getCapabilitiesCtrl from "./controllers/get-capabilities";
import { capabilitiesResponseSchema } from "./response";
import { workspaceIdQuery } from "./schema";

const getCapabilitiesRoute = createRoute({
  method: "get",
  operationId: "getCapabilities",
  path: "/",
  tags: ["Capabilities"],
  summary: "Get the caller's capabilities in a workspace",
  description:
    "One call replacing the 16-way has-permission fan-out the client made against the organization() plugin. Includes the exact canonical sla_policy:manage check used to gate service-calendar authoring.",
  middleware: [requireSessionOnly(), workspaceAccess.fromQuery()] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse(
      "The caller's capability map for this workspace",
      capabilitiesResponseSchema,
    ),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const capabilities = apiRouter<
  BaseVariables & { workspaceId: string }
>().openapi(getCapabilitiesRoute, async (c) => {
  // Missing and duplicate rows deny; malformed roles still receive only an all-false
  // introspection map. Instance-admin reach through workspaceAccess is not membership.
  const membership = await callerMembershipResolution(c);
  if (
    membership === null ||
    (membership.ok === false && membership.reason !== "malformed-role")
  ) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "No access to the workspace" });
  }
  setShadowLegacyAuthorization(c, "allowed");
  return c.json(await getCapabilitiesCtrl(c), 200);
});

export default capabilities;
