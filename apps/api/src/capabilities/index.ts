import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireSessionOnly } from "../utils/require-session-only";
import { callerMembershipResolution } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import getCapabilitiesCtrl from "./controllers/get-capabilities";
import {
  capabilitiesResponseSchema,
  malformedMembershipResponseSchema,
} from "./response";
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
    409: jsonResponse(
      "The caller's membership row does not hold exactly one role, so no capability answer can be computed from it (issue #82)",
      malformedMembershipResponseSchema,
    ),
  },
});

const capabilities = apiRouter<
  BaseVariables & { workspaceId: string }
>().openapi(getCapabilitiesRoute, async (c) => {
  // Issue #82. Asked BEFORE the sixteen checks, and asked through the evaluator's own
  // resolution rather than a second reading of the same rows, so this endpoint cannot
  // disagree with `hasWorkspacePermission` about what the row means -- a second reading
  // that drifts is the precise defect #82 is about.
  //
  // Only `malformed-role` is reported this way. `no-membership` is already the route's 403
  // (the `workspaceAccess` middleware refuses first), and `ambiguous-rows` -- two rows for
  // one pair -- is issue #88's subject, whose remedy is a UNIQUE constraint rather than a
  // response shape; it keeps today's all-denied answer here deliberately, so this change
  // does not quietly re-decide a question another issue owns.
  const membership = await callerMembershipResolution(c);
  if (membership?.ok === false && membership.reason === "malformed-role") {
    return c.json(
      {
        error: "MALFORMED_MEMBERSHIP_ROLE" as const,
        message:
          "This workspace membership does not hold exactly one role, so no capability can be granted from it. An administrator must reassign a single role to this member.",
        problem: membership.problem,
      },
      409,
    );
  }
  return c.json(await getCapabilitiesCtrl(c), 200);
});

export default capabilities;
