import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { checkWorkspaceName } from "../utils/check-workspace-name";
import { requireWorkspaceCreationAllowed } from "../utils/require-session";
import { requireSessionOnly } from "../utils/require-session-only";
import { requireWorkspaceMembership } from "../utils/require-workspace-membership";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { requireWorkspaceRoleAuthority } from "../utils/require-workspace-role-authority";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createWorkspaceCtrl, {
  WorkspaceSlugTakenError,
} from "./controllers/create-workspace";
import deleteWorkspaceCtrl from "./controllers/delete-workspace";
import getUserWorkspacesCtrl from "./controllers/get-user-workspaces";
import getWorkspaceDetailCtrl from "./controllers/get-workspace-detail";
import getWorkspaceInvitationsCtrl from "./controllers/get-workspace-invitations";
import getWorkspaceMembersCtrl from "./controllers/get-workspace-members";
import updateWorkspaceCtrl from "./controllers/update-workspace";
import {
  deletedWorkspaceSchema,
  workspaceDetailSchema,
  workspaceInvitationListSchema,
  workspaceMemberListSchema,
  workspaceSchema,
  workspaceSummaryListSchema,
} from "./response";
import {
  createWorkspaceBody,
  updateWorkspaceBody,
  workspaceIdParam,
} from "./schema";

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

// ── S4: the native workspace write routes ────────────────────────────────
// Issue #6, retrofit plan §3 (S4 row). Additive: the `organization()` plugin
// stays mounted and every client still writes through it until S3/S8a
// repoint them, so these ship dark.
//
// All three require a real browser session (`requireSessionOnly()`, #65)
// rather than accepting an API key — see that middleware for R10 and why
// this preserves rather than widens the inherited reachability. The two
// mutation routes also close a second boundary: an instance admin's
// TaskDesk-wide authority must not silently substitute for the workspace
// role their own membership carries (`requireWorkspaceRoleAuthority`) —
// see that file for why, and for #66's boundary with it.

const createWorkspaceRoute = createRoute({
  method: "post",
  operationId: "createWorkspace",
  path: "/",
  tags: ["Workspaces"],
  summary: "Create a workspace",
  description:
    "Create a workspace, its owner membership, its default roles and its default team in a single transaction. Native replacement for authClient.organization.create().",
  middleware: [requireSessionOnly(), requireWorkspaceCreationAllowed] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createWorkspaceBody } },
    },
  },
  responses: {
    200: jsonResponse("The created workspace", workspaceSchema),
    400: errorResponse("Invalid body, or the name was rejected"),
    401: errorResponse("No credential at all"),
    403: errorResponse(
      "An API key or impersonation session (session_required), or workspace creation is disabled on this instance",
    ),
    409: errorResponse("The requested slug is already taken"),
  },
});

const updateWorkspaceRoute = createRoute({
  method: "patch",
  operationId: "updateWorkspace",
  path: "/{workspaceId}",
  tags: ["Workspaces"],
  summary: "Update a workspace",
  description:
    "Update a workspace's name, slug, logo or description. Native replacement for authClient.organization.update().",
  middleware: [
    requireSessionOnly(),
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceMembership,
    // The INHERITED capability key, which is what the seeded `workspace_role`
    // rows actually carry. Re-keying these to the TaskDesk `workspace:*`
    // vocabulary is #7's capability migration (retrofit plan §3.1 item 1),
    // not this lane's to invent — and choosing a different key here would
    // silently change who may update a workspace.
    requireWorkspacePermission({ organization: ["update"] }),
    // Closes the instance-admin bypass `requireWorkspacePermission` alone
    // would leave open — see require-workspace-role-authority.ts.
    requireWorkspaceRoleAuthority({ organization: ["update"] }),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateWorkspaceBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated workspace", workspaceSchema),
    400: errorResponse("Invalid body, or the name was rejected"),
    401: errorResponse("No credential at all"),
    403: errorResponse(
      "An API key or impersonation session (session_required), no workspace access, or missing organization:update permission",
    ),
    404: errorResponse("Workspace not found"),
    409: errorResponse("The requested slug is already taken"),
  },
});

const deleteWorkspaceRoute = createRoute({
  method: "delete",
  operationId: "deleteWorkspace",
  path: "/{workspaceId}",
  tags: ["Workspaces"],
  summary: "Delete a workspace",
  description:
    "Delete a workspace and everything cascading off it. Native replacement for authClient.organization.delete().",
  middleware: [
    requireSessionOnly(),
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceMembership,
    requireWorkspacePermission({ organization: ["delete"] }),
    // Closes the instance-admin bypass `requireWorkspacePermission` alone
    // would leave open — see require-workspace-role-authority.ts.
    requireWorkspaceRoleAuthority({ organization: ["delete"] }),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The deleted workspace's id", deletedWorkspaceSchema),
    401: errorResponse("No credential at all"),
    403: errorResponse(
      "An API key or impersonation session (session_required), no workspace access, or missing organization:delete permission",
    ),
    404: errorResponse("Workspace not found"),
  },
});

/**
 * `checkWorkspaceName` is the security control on the name, moved off
 * `beforeCreateOrganization` unchanged. It runs before anything is written.
 */
function assertWorkspaceNameAllowed(name: string) {
  const check = checkWorkspaceName(name);
  if (!check.ok) {
    throw new HTTPException(400, { message: check.reason });
  }
}

/**
 * The row id of the session making the call — needed by create (effects 7
 * and 8 of the create contract) and delete (clearing the caller's own
 * `active_organization_id`/`active_team_id` if they pointed at the deleted
 * workspace). Read directly from `c.get("session")` rather than through a
 * second context variable set by a bespoke middleware: `requireSessionOnly()`
 * has already guaranteed a real, non-impersonated session by the time any of
 * these handlers run, so this is a defensive re-check, not the control
 * itself, and there is exactly one implementation of "require a session" on
 * this router now.
 */
function requireSessionId(c: {
  get(key: "session"): { id?: string } | null;
}): string {
  const session = c.get("session");
  if (!session?.id) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return session.id;
}

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
  )
  .openapi(createWorkspaceRoute, async (c) => {
    const body = c.req.valid("json");
    assertWorkspaceNameAllowed(body.name);

    try {
      const created = await createWorkspaceCtrl({
        name: body.name.trim(),
        slug: body.slug,
        logo: body.logo,
        description: body.description,
        ownerId: c.get("userId"),
        sessionId: requireSessionId(c),
      });
      return c.json(created, 200);
    } catch (error) {
      if (error instanceof WorkspaceSlugTakenError) {
        throw new HTTPException(409, {
          message: "That workspace slug is already taken",
        });
      }
      throw error;
    }
  })
  .openapi(updateWorkspaceRoute, async (c) => {
    const body = c.req.valid("json");
    if (body.name !== undefined) {
      assertWorkspaceNameAllowed(body.name);
    }

    try {
      const updated = await updateWorkspaceCtrl(c.get("workspaceId"), {
        ...body,
        name: body.name?.trim(),
      });
      if (!updated) {
        throw new HTTPException(404, { message: "Workspace not found" });
      }
      return c.json(updated, 200);
    } catch (error) {
      if (error instanceof WorkspaceSlugTakenError) {
        throw new HTTPException(409, {
          message: "That workspace slug is already taken",
        });
      }
      throw error;
    }
  })
  .openapi(deleteWorkspaceRoute, async (c) => {
    const deleted = await deleteWorkspaceCtrl(
      c.get("workspaceId"),
      requireSessionId(c),
    );
    if (!deleted) {
      throw new HTTPException(404, { message: "Workspace not found" });
    }
    return c.json(deleted, 200);
  });

export default workspace;
