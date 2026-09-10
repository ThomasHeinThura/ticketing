import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { checkWorkspaceName } from "../utils/check-workspace-name";
import { requireInviteAbuseGate } from "../utils/require-invite-abuse-gate";
import { requireInviteRateLimit } from "../utils/require-invite-rate-limit";
import { requireWorkspaceCreationAllowed } from "../utils/require-session";
import { requireSessionOnly } from "../utils/require-session-only";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { requireWorkspaceMembership } from "../utils/require-workspace-membership";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { requireWorkspaceRoleAuthority } from "../utils/require-workspace-role-authority";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import addWorkspaceMemberCtrl from "./controllers/add-workspace-member";
import createWorkspaceCtrl, {
  WorkspaceSlugTakenError,
} from "./controllers/create-workspace";
import deleteWorkspaceCtrl from "./controllers/delete-workspace";
import getUserWorkspacesCtrl from "./controllers/get-user-workspaces";
import getWorkspaceDetailCtrl from "./controllers/get-workspace-detail";
import getWorkspaceInvitationsCtrl from "./controllers/get-workspace-invitations";
import getWorkspaceMembersCtrl from "./controllers/get-workspace-members";
import inviteWorkspaceMemberCtrl from "./controllers/invite-workspace-member";
import leaveWorkspaceCtrl from "./controllers/leave-workspace";
import removeWorkspaceMemberCtrl from "./controllers/remove-workspace-member";
import transferWorkspaceOwnershipCtrl from "./controllers/transfer-workspace-ownership";
import updateWorkspaceCtrl from "./controllers/update-workspace";
import updateWorkspaceMemberRoleCtrl from "./controllers/update-workspace-member-role";
import { InvitationAlreadyPendingError } from "./controllers/workspace-invitation-errors";
import {
  AlreadyOwnerError,
  AmbiguousMembershipError,
  CallerNotOwnerError,
  CannotChangeOwnerRoleHereError,
  LastOwnerCannotLeaveError,
  MemberNotFoundError,
  NewOwnerNotAMemberError,
  NotAMemberError,
  OwnerRoleNotAssignableHereError,
  TargetUserNotFoundError,
  UserAlreadyMemberError,
  WorkspaceRoleNotFoundError,
} from "./controllers/workspace-membership-errors";
import {
  deletedWorkspaceSchema,
  leftWorkspaceSchema,
  removedWorkspaceMemberSchema,
  transferredWorkspaceOwnershipSchema,
  workspaceDetailSchema,
  workspaceInvitationListSchema,
  workspaceInvitationSchema,
  workspaceMemberListSchema,
  workspaceMemberRoleSchema,
  workspaceMemberSchema,
  workspaceSchema,
  workspaceSummaryListSchema,
} from "./response";
import {
  addWorkspaceMemberBody,
  createWorkspaceBody,
  inviteWorkspaceMemberBody,
  transferWorkspaceOwnershipBody,
  updateWorkspaceBody,
  updateWorkspaceMemberRoleBody,
  workspaceIdParam,
  workspaceMemberIdParam,
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
  // `requireSessionOnly()` closes the one gap on this router: every sibling
  // read below (`GET /api/workspace`, `GET /api/workspace/{workspaceId}`,
  // `GET /api/workspace/{workspaceId}/invitations`) already carries it, and
  // membership data is exactly what the 2026-09-08 decision names ("workspace,
  // membership, invitation or capability data"). This route is pre-existing
  // inherited surface awaiting #8's classification (`workspace/policy.ts`
  // documents it as deliberately absent, and it stays listed, unmodified, in
  // `tests/permissions/inherited-uncovered.json`) — adding this middleware is
  // runtime enforcement only, exactly like the three siblings' own
  // `requireSessionOnly()` calls, and does NOT declare a route policy: #8
  // still owns classifying this route's capability/scope shape.
  middleware: [
    requireSessionOnly(),
    workspaceAccess.fromParam("workspaceId"),
  ] as const,
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

// ── S5: the native membership write routes ───────────────────────────────
// Issue #6, retrofit plan §3 (S5 row). Additive and still ships dark: the
// `organization()` plugin stays mounted and every client still writes
// through it until S3/S8a repoint them.
//
// Same authorization shape as S4's two mutation routes above --
// `requireWorkspaceMembership` first (closes the instance-admin-non-member
// gap), then `requireWorkspacePermission` against the INHERITED `member`
// resource (the actions the seeded `workspace_role` rows actually carry --
// see `policy.ts`), then `requireWorkspaceRoleAuthority` to close the
// instance-admin bypass on the capability check itself -- EXCEPT
// `transfer-ownership` and `leave`.
//
// `transfer-ownership` never calls `hasWorkspacePermission`/
// `requireWorkspacePermission` at all -- the INHERITED better-auth statements
// those read have no concept of `workspace:transfer_ownership` (or of
// `manager`/`lead`/`customer`, the TaskDesk roles that must be refused it).
// Its own gate, `requireWorkspaceCapability("workspace:transfer_ownership")`
// (`apps/api/src/utils/require-workspace-capability.ts`), evaluates the
// canonical `@taskdesk/permissions` capability data instead, granted to
// `owner` alone, and -- like the hardcoded check it replaced -- never calls
// `isInstanceAdmin`, so there is no bypass to close here either. See that
// file and `transfer-workspace-ownership.ts` for the full reasoning.
//
// `leave` carries no capability check because leaving is a self-action
// every member has.

const addWorkspaceMemberRoute = createRoute({
  method: "post",
  operationId: "addWorkspaceMember",
  path: "/{workspaceId}/members",
  tags: ["Workspaces"],
  summary: "Add a member to a workspace",
  description:
    "Add an existing platform user directly to a workspace by id. New surface -- the inherited plugin never exposed this as a public route.",
  middleware: [
    requireSessionOnly(),
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceMembership,
    requireWorkspacePermission({ member: ["create"] }),
    requireWorkspaceRoleAuthority({ member: ["create"] }),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: addWorkspaceMemberBody } },
    },
  },
  responses: {
    200: jsonResponse("The added member", workspaceMemberSchema),
    400: errorResponse(
      "Invalid body, an unknown role, or the role was 'owner'",
    ),
    401: errorResponse("No credential at all"),
    403: errorResponse(
      "An API key or impersonation session (session_required), no workspace access, or missing member:create permission",
    ),
    404: errorResponse("The target user does not exist"),
    409: errorResponse("The target user is already a member"),
  },
});

const removeWorkspaceMemberRoute = createRoute({
  method: "delete",
  operationId: "removeWorkspaceMember",
  path: "/{workspaceId}/members/{userId}",
  tags: ["Workspaces"],
  summary: "Remove a workspace member",
  description:
    "Remove a member from a workspace. Native replacement for authClient.organization.removeMember().",
  middleware: [
    requireSessionOnly(),
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceMembership,
    requireWorkspacePermission({ member: ["delete"] }),
    requireWorkspaceRoleAuthority({ member: ["delete"] }),
  ] as const,
  request: { params: workspaceMemberIdParam },
  responses: {
    200: jsonResponse(
      "The removed member's user id",
      removedWorkspaceMemberSchema,
    ),
    401: errorResponse("No credential at all"),
    400: errorResponse("Cannot remove the workspace's only owner"),
    403: errorResponse(
      "An API key or impersonation session (session_required), no workspace access, or missing member:delete permission",
    ),
    404: errorResponse("The target is not a member of this workspace"),
  },
});

const updateWorkspaceMemberRoleRoute = createRoute({
  method: "patch",
  operationId: "updateWorkspaceMemberRole",
  path: "/{workspaceId}/members/{userId}/role",
  tags: ["Workspaces"],
  summary: "Change a member's role",
  description:
    "Change a member's assigned role. Native replacement for authClient.organization.updateMemberRole(). Can never grant or touch the owner role -- use transfer-ownership for that.",
  middleware: [
    requireSessionOnly(),
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceMembership,
    requireWorkspacePermission({ member: ["update"] }),
    requireWorkspaceRoleAuthority({ member: ["update"] }),
  ] as const,
  request: {
    params: workspaceMemberIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: updateWorkspaceMemberRoleBody },
      },
    },
  },
  responses: {
    200: jsonResponse("The member's new role", workspaceMemberRoleSchema),
    400: errorResponse(
      "Invalid body, an unknown role, the role was 'owner', or the target is currently the owner",
    ),
    401: errorResponse("No credential at all"),
    403: errorResponse(
      "An API key or impersonation session (session_required), no workspace access, or missing member:update permission",
    ),
    404: errorResponse("The target is not a member of this workspace"),
  },
});

const leaveWorkspaceRoute = createRoute({
  method: "post",
  operationId: "leaveWorkspace",
  path: "/{workspaceId}/leave",
  tags: ["Workspaces"],
  summary: "Leave a workspace",
  description:
    "The caller leaves a workspace of their own accord. Native replacement for authClient.organization.leave(). Refused when the caller is the workspace's only owner.",
  middleware: [
    requireSessionOnly(),
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceMembership,
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The workspace left", leftWorkspaceSchema),
    400: errorResponse("The caller is the workspace's only owner"),
    401: errorResponse("No credential at all"),
    403: errorResponse(
      "An API key or impersonation session (session_required), or no workspace access",
    ),
    404: errorResponse("The caller is not a member of this workspace"),
  },
});

const transferWorkspaceOwnershipRoute = createRoute({
  method: "post",
  operationId: "transferWorkspaceOwnership",
  path: "/{workspaceId}/transfer-ownership",
  tags: ["Workspaces"],
  summary: "Transfer workspace ownership",
  description:
    "Atomically install a new owner and demote the caller in one transaction. Replaces the client's promote/demote pair (use-transfer-workspace-ownership.ts). Callable only by the workspace's current owner.",
  middleware: [
    requireSessionOnly(),
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceMembership,
    requireWorkspaceCapability("workspace:transfer_ownership"),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: transferWorkspaceOwnershipBody },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "The transfer result",
      transferredWorkspaceOwnershipSchema,
    ),
    400: errorResponse("The new owner is the caller themselves"),
    401: errorResponse("No credential at all"),
    403: errorResponse(
      "An API key or impersonation session (session_required), no workspace access, or the caller is not the current owner",
    ),
    404: errorResponse("The new owner is not a member of this workspace"),
    409: errorResponse(
      "The new owner has more than one membership row in this workspace, so no single role can be trusted; repair the duplicate first",
    ),
  },
});

// ── S6a: the native invitation-create write route ───────────────────────
// Issue #6, retrofit plan §3 (S6a row). This is the one S6a route scoped
// under `/workspace` rather than `/invitation` — creating an invitation
// needs a workspace id the caller supplies, where accept/reject/cancel only
// ever need the invitation's own id (see `apps/api/src/invitation/index.ts`).
//
// Same authorization shape as S4/S5's mutation routes:
// `requireWorkspaceMembership` first, then `requireWorkspacePermission`
// against the INHERITED `invitation` resource (`{ create: [...] }` /
// `{ cancel: [...] }` on `viewer`/`member`/`admin`/`owner` — see
// `packages/permissions/src/legacy-better-auth-access-control.ts`, which
// mirrors better-auth's own `defaultStatements.invitation`), then
// `requireWorkspaceRoleAuthority` to close the instance-admin bypass, same
// as every other S4/S5 mutation.
//
// TWO ADDITIONAL, INVITE-SPECIFIC GUARDS not needed by any S4/S5 route:
// `requireInviteRateLimit()` and `requireInviteAbuseGate()` — the native
// equivalents of the two path-keyed better-auth controls this same change
// moves off the plugin (`apps/api/src/auth.ts`'s `rateLimit.customRules`
// and cloud disposable-email/anonymous gate). See those two middleware
// modules' own doc comments.
const inviteWorkspaceMemberRoute = createRoute({
  method: "post",
  operationId: "inviteWorkspaceMember",
  path: "/{workspaceId}/invitations",
  tags: ["Workspaces"],
  summary: "Invite a user to a workspace",
  description:
    "Invite a user, by email, into a workspace. Native replacement for authClient.organization.inviteMember(). Sends the invitation email on success.",
  middleware: [
    requireSessionOnly(),
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceMembership,
    requireWorkspacePermission({ invitation: ["create"] }),
    requireWorkspaceRoleAuthority({ invitation: ["create"] }),
    requireInviteRateLimit(),
    requireInviteAbuseGate(),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: inviteWorkspaceMemberBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The created (or resent) invitation",
      workspaceInvitationSchema,
    ),
    400: errorResponse(
      "Invalid body, an unknown role, or the role was 'owner'",
    ),
    401: errorResponse("No credential at all"),
    403: errorResponse(
      "An API key or impersonation session (session_required), no workspace access, missing invitation:create permission, a guest account inviting on cloud, or a disposable-email invitee on cloud",
    ),
    409: errorResponse(
      "The target email is already a member, or already has a pending invitation and resend was not set",
    ),
    429: errorResponse("Too many invitations from this client recently"),
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
  })
  .openapi(addWorkspaceMemberRoute, async (c) => {
    const body = c.req.valid("json");
    try {
      const added = await addWorkspaceMemberCtrl({
        workspaceId: c.get("workspaceId"),
        userId: body.userId,
        role: body.role,
      });
      return c.json(added, 200);
    } catch (error) {
      if (error instanceof OwnerRoleNotAssignableHereError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof WorkspaceRoleNotFoundError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof TargetUserNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof UserAlreadyMemberError) {
        throw new HTTPException(409, { message: error.message });
      }
      throw error;
    }
  })
  .openapi(removeWorkspaceMemberRoute, async (c) => {
    try {
      const removed = await removeWorkspaceMemberCtrl(
        c.get("workspaceId"),
        c.req.valid("param").userId,
      );
      return c.json(removed, 200);
    } catch (error) {
      if (error instanceof MemberNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof LastOwnerCannotLeaveError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  })
  .openapi(updateWorkspaceMemberRoleRoute, async (c) => {
    const body = c.req.valid("json");
    try {
      const updated = await updateWorkspaceMemberRoleCtrl(
        c.get("workspaceId"),
        c.req.valid("param").userId,
        body.role,
      );
      return c.json(updated, 200);
    } catch (error) {
      if (error instanceof OwnerRoleNotAssignableHereError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof CannotChangeOwnerRoleHereError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof WorkspaceRoleNotFoundError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof MemberNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  })
  .openapi(leaveWorkspaceRoute, async (c) => {
    try {
      const left = await leaveWorkspaceCtrl(
        c.get("workspaceId"),
        c.get("userId"),
        requireSessionId(c),
      );
      return c.json(left, 200);
    } catch (error) {
      if (error instanceof NotAMemberError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof LastOwnerCannotLeaveError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  })
  .openapi(transferWorkspaceOwnershipRoute, async (c) => {
    const body = c.req.valid("json");
    try {
      const transferred = await transferWorkspaceOwnershipCtrl(
        c.get("workspaceId"),
        c.get("userId"),
        body.newOwnerUserId,
      );
      return c.json(transferred, 200);
    } catch (error) {
      if (error instanceof AlreadyOwnerError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof CallerNotOwnerError) {
        throw new HTTPException(403, { message: error.message });
      }
      if (error instanceof AmbiguousMembershipError) {
        throw new HTTPException(409, { message: error.message });
      }
      if (error instanceof NewOwnerNotAMemberError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  })
  .openapi(inviteWorkspaceMemberRoute, async (c) => {
    const body = c.req.valid("json");
    try {
      const invitation = await inviteWorkspaceMemberCtrl({
        workspaceId: c.get("workspaceId"),
        email: body.email,
        role: body.role,
        resend: body.resend,
        inviterId: c.get("userId"),
      });
      return c.json(invitation, 200);
    } catch (error) {
      if (error instanceof OwnerRoleNotAssignableHereError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof WorkspaceRoleNotFoundError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof UserAlreadyMemberError) {
        throw new HTTPException(409, { message: error.message });
      }
      if (error instanceof InvitationAlreadyPendingError) {
        throw new HTTPException(409, { message: error.message });
      }
      throw error;
    }
  });

export default workspace;
