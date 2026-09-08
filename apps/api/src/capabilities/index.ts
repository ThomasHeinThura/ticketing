import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireSessionOnly } from "../utils/require-session-only";
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
    "One call replacing the 16-way has-permission fan-out the client made against the organization() plugin's /organization/has-permission (apps/web/src/hooks/use-workspace-permission.ts). Computed over hasWorkspacePermission -- the same TaskDesk-native authorization check every other route already uses.",
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
>().openapi(getCapabilitiesRoute, async (c) =>
  c.json(await getCapabilitiesCtrl(c), 200),
);

export default capabilities;
