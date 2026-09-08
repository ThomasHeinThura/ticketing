import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireSessionOnly } from "../utils/require-session-only";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import getUserWorkspacesCtrl from "./controllers/get-user-workspaces";
import getWorkspaceDetailCtrl from "./controllers/get-workspace-detail";
import getWorkspaceInvitationsCtrl from "./controllers/get-workspace-invitations";
import getWorkspaceMembersCtrl from "./controllers/get-workspace-members";
import {
  workspaceDetailSchema,
  workspaceInvitationListSchema,
  workspaceMemberListSchema,
  workspaceSummaryListSchema,
} from "./response";
import { workspaceIdParam } from "./schema";

const listWorkspacesRoute = createRoute({
  method: "get",
  operationId: "listWorkspaces",
  path: "/",
  tags: ["Workspaces"],
  summary: "List the caller's workspaces",
  description:
    "List every workspace the calling user is a member of, each with the caller's own role. Native replacement for authClient.organization.list().",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse("The caller's workspaces", workspaceSummaryListSchema),
  },
});

const getWorkspaceRoute = createRoute({
  method: "get",
  operationId: "getWorkspace",
  path: "/{workspaceId}",
  tags: ["Workspaces"],
  summary: "Get a workspace",
  description:
    "Get a workspace's details, its members, and its pending invitations in one call. Native replacement for authClient.organization.getFullOrganization().",
  middleware: [
    requireSessionOnly(),
    workspaceAccess.fromParam("workspaceId"),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "The workspace, its members, and its pending invitations",
      workspaceDetailSchema,
    ),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
    404: errorResponse("Workspace not found"),
  },
});

const getWorkspaceMembersRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceMembers",
  path: "/{workspaceId}/members",
  tags: ["Workspaces"],
  summary: "Get workspace members",
  description: "Get all members of a workspace, with their role.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("List of workspace members", workspaceMemberListSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const getWorkspaceInvitationsRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceInvitations",
  path: "/{workspaceId}/invitations",
  tags: ["Workspaces"],
  summary: "Get a workspace's pending invitations",
  description:
    "List a workspace's pending, unexpired invitations. Native replacement for authClient.organization.listInvitations().",
  middleware: [
    requireSessionOnly(),
    workspaceAccess.fromParam("workspaceId"),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "List of pending invitations",
      workspaceInvitationListSchema,
    ),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const workspace = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listWorkspacesRoute, async (c) =>
    c.json(await getUserWorkspacesCtrl(c.get("userId")), 200),
  )
  .openapi(getWorkspaceRoute, async (c) =>
    c.json(await getWorkspaceDetailCtrl(c.get("workspaceId")), 200),
  )
  .openapi(getWorkspaceMembersRoute, async (c) =>
    c.json(await getWorkspaceMembersCtrl(c.get("workspaceId")), 200),
  )
  .openapi(getWorkspaceInvitationsRoute, async (c) =>
    c.json(await getWorkspaceInvitationsCtrl(c.get("workspaceId")), 200),
  );

export default workspace;
