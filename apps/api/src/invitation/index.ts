import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  registeredDeletionRequestSchema,
  requestRegisteredDeletion,
} from "../pending-action/deletion-targets";
import { requireInvitationWorkspaceAccess } from "../utils/require-invitation-workspace-access";
import { requireSessionOnly } from "../utils/require-session-only";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { requireWorkspaceMembership } from "../utils/require-workspace-membership";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { requireWorkspaceRoleAuthority } from "../utils/require-workspace-role-authority";
import { WorkspaceRoleNotFoundError } from "../workspace/controllers/workspace-membership-errors";
import acceptInvitationCtrl from "./controllers/accept-invitation";
import getUserPendingInvitations from "./controllers/get-user-pending-invitations";
import {
  AlreadyWorkspaceMemberError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationNotPendingError,
  InvitationRoleNotAssignableError,
  NotInvitationRecipientError,
} from "./controllers/invitation-action-errors";
import rejectInvitationCtrl from "./controllers/reject-invitation";
import { INVITATION_DELETION_ROUTE } from "./invitation-deletion-target";
import {
  acceptedInvitationSchema,
  invitationDetailsSchema,
  pendingInvitationListSchema,
  rejectedInvitationSchema,
} from "./response";
import { invitationParam } from "./schema";

const getPendingRoute = createRoute({
  method: "get",
  operationId: "getUserPendingInvitations",
  path: "/pending",
  tags: ["Invitations"],
  summary: "Get pending invitations",
  description:
    "Get the current user's unexpired, unaccepted invitations. Returns an empty list until the user's email is verified.",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse(
      "List of pending invitations",
      pendingInvitationListSchema,
    ),
  },
});

// `GET /api/invitation/{id}` had zero real callers (checked `apps/web` -- only the
// `/{id}/accept|reject` and `DELETE /{id}` siblings are ever fetched), returned the same
// invitee-email/workspace-name/inviter-name `GET /api/invitation/public/{id}` already
// serves, with no recipient or workspace-membership check of its own (any authenticated
// user could look up ANY invitation by id). `invitation/policy.ts` had flagged this exact
// route as needing a human decision on delete-vs-restrict-vs-declare-open (Opus delta
// pass F4 on PR #440's route-classification guard fix -- see
// docs/07-planning/security-reviews/440-runtime-authorization-wiring.md). Thomas's
// decision (2026-09-28): keep the operation registered (deleting it outright would be a
// breaking removal without a deprecation window, which `docs/01-architecture/
// api-design.md`'s Versioning section forbids once a stable v2.0.0+ tag exists, as one
// already does), marked `deprecated: true`, but make the handler unconditionally refuse
// -- closing the info-leak today without waiting out a deprecation window a route that
// never did anything safe doesn't deserve.
// Classification (issue #8): retains its own session, row-derived workspace, membership
// and legacy authority gates before the unconditional refusal. The route remains disabled
// for every caller; the policy declaration does not make invitation details available.
const getInvitationRoute = createRoute({
  method: "get",
  operationId: "getInvitationDetails",
  path: "/{id}",
  tags: ["Invitations"],
  summary: "Get invitation details",
  description:
    "Deprecated and permanently disabled (2026-09-28): always refuses, even for a caller who holds the workspace authority its own middleware checks. Previously looked up an invitation by id with no recipient or workspace-membership check of its own -- the same data is not available any other way that lacks that check. Kept registered, not removed, per this API's versioning policy.",
  deprecated: true,
  middleware: [
    requireSessionOnly(),
    requireInvitationWorkspaceAccess(),
    requireWorkspaceMembership,
    requireWorkspacePermission({ invitation: ["cancel"] }),
    requireWorkspaceRoleAuthority({ invitation: ["cancel"] }),
  ] as const,
  request: { params: invitationParam },
  responses: {
    200: jsonResponse("Invitation details", invitationDetailsSchema),
    401: errorResponse("No credential at all"),
    403: errorResponse(
      "This operation is deprecated and permanently disabled, or the caller lacks workspace access",
    ),
    404: errorResponse("No invitation with this id"),
  },
});

// ── S6a: the native invitation-action write routes ───────────────────────
// Issue #6, retrofit plan §3 (S6a row). Accept and reject are actions the
// INVITEE takes on their own behalf -- neither carries `workspaceAccess.*`
// or a workspace-permission check, because the caller is not (yet, in
// accept's case; never, in reject's) a member of the workspace the
// invitation belongs to. `requireSessionOnly()` is the only gate: a real
// browser session is required, then `acceptInvitation`/`rejectInvitation`
// (the controllers) check the invitation's own state and that the caller
// IS its recipient.
//
// Cancel is an action a staff member with `member:invite` takes on someone
// else's invitation. `requireInvitationWorkspaceAccess()` resolves
// `workspaceId` from the invitation id; membership and the canonical
// capability are then checked before the pending action is requested.

const acceptInvitationRoute = createRoute({
  method: "post",
  operationId: "acceptInvitation",
  path: "/{id}/accept",
  tags: ["Invitations"],
  summary: "Accept an invitation",
  description:
    "Accept an invitation, creating the caller's workspace membership. Native replacement for authClient.organization.acceptInvitation(). Atomic, and refuses a caller who is already a member of the workspace (issue #88).",
  middleware: [requireSessionOnly()] as const,
  request: { params: invitationParam },
  responses: {
    200: jsonResponse(
      "The accepted invitation and the new membership",
      acceptedInvitationSchema,
    ),
    400: errorResponse("The invitation is expired or no longer pending"),
    401: errorResponse("No credential at all"),
    403: errorResponse(
      "An API key or impersonation session (session_required), or the caller is not this invitation's recipient",
    ),
    404: errorResponse("No invitation with this id"),
    409: errorResponse("The caller is already a member of this workspace"),
  },
});

const rejectInvitationRoute = createRoute({
  method: "post",
  operationId: "rejectInvitation",
  path: "/{id}/reject",
  tags: ["Invitations"],
  summary: "Reject an invitation",
  description:
    'Decline an invitation. Native replacement for authClient.organization.rejectInvitation(). Stored as status "canceled" -- this app\'s status vocabulary has no separate "rejected" value.',
  middleware: [requireSessionOnly()] as const,
  request: { params: invitationParam },
  responses: {
    200: jsonResponse("The rejected invitation", rejectedInvitationSchema),
    400: errorResponse("The invitation is no longer pending"),
    401: errorResponse("No credential at all"),
    403: errorResponse(
      "An API key or impersonation session (session_required), or the caller is not this invitation's recipient",
    ),
    404: errorResponse("No invitation with this id"),
  },
});

const cancelInvitationRoute = createRoute({
  method: "delete",
  operationId: "cancelInvitation",
  path: "/{id}",
  tags: ["Invitations"],
  summary: "Cancel an invitation",
  description:
    "Request cancellation of a pending invitation. Native replacement for authClient.organization.cancelInvitation(). Returns a durable pending action (202); the invitation stays pending until the requester approves in a current browser session.",
  middleware: [
    requireSessionOnly(),
    requireInvitationWorkspaceAccess(),
    requireWorkspaceMembership,
    requireWorkspaceCapability("member:invite"),
  ] as const,
  request: { params: invitationParam },
  responses: {
    202: jsonResponse(
      "Pending cancellation; invitation unchanged",
      registeredDeletionRequestSchema,
    ),
    400: errorResponse("The invitation is no longer pending"),
    401: errorResponse("No credential at all"),
    403: errorResponse(
      "An API key or impersonation session (session_required), no workspace access, or missing member:invite capability",
    ),
    404: errorResponse("No invitation with this id"),
    409: errorResponse("An equivalent cancellation is already pending"),
  },
});

const invitation = apiRouter()
  .openapi(getPendingRoute, async (c) => {
    const user = c.get("user");
    if (!user?.emailVerified) {
      return c.json([], 200);
    }
    return c.json(await getUserPendingInvitations(c.get("userEmail")), 200);
  })
  .openapi(getInvitationRoute, () => {
    // Deprecated and permanently disabled -- see this route's own `createRoute` comment
    // above. The middleware chain above already resolved workspace access and the
    // `invitation:cancel` authority (a real 401/403/404 for a caller who fails any of
    // that); this still refuses even a caller who PASSES it, because the decision was
    // "nobody gets real invitation data from this operation again," not "only
    // non-admins are refused."
    throw new HTTPException(403, {
      message: "This operation is deprecated and permanently disabled",
    });
  })
  .openapi(acceptInvitationRoute, async (c) => {
    try {
      const accepted = await acceptInvitationCtrl(
        c.req.valid("param").id,
        c.get("userId"),
      );
      return c.json(accepted, 200);
    } catch (error) {
      if (error instanceof InvitationNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof NotInvitationRecipientError) {
        throw new HTTPException(403, { message: error.message });
      }
      if (
        error instanceof InvitationNotPendingError ||
        error instanceof InvitationExpiredError
      ) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof AlreadyWorkspaceMemberError) {
        throw new HTTPException(409, { message: error.message });
      }
      if (error instanceof InvitationRoleNotAssignableError) {
        throw new HTTPException(403, { message: error.message });
      }
      if (error instanceof WorkspaceRoleNotFoundError) {
        throw new HTTPException(400, {
          message: "This invitation's workspace role is no longer available",
        });
      }
      throw error;
    }
  })
  .openapi(rejectInvitationRoute, async (c) => {
    try {
      const rejected = await rejectInvitationCtrl(
        c.req.valid("param").id,
        c.get("userId"),
      );
      return c.json(rejected, 200);
    } catch (error) {
      if (error instanceof InvitationNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof NotInvitationRecipientError) {
        throw new HTTPException(403, { message: error.message });
      }
      if (error instanceof InvitationNotPendingError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  })
  .openapi(cancelInvitationRoute, async (c) => {
    const pending = await requestRegisteredDeletion(c, {
      routeKey: INVITATION_DELETION_ROUTE,
      targetType: "invitation",
      id: c.req.valid("param").id,
    });
    return c.json(pending, 202);
  });

export default invitation;
