import { createFileRoute, redirect } from "@tanstack/react-router";
import { getPendingInvitations } from "@/fetchers/invitation/get-pending-invitations";
import activateWorkspace from "@/fetchers/workspace/activate-workspace";
import getWorkspaces from "@/fetchers/workspace/get-workspaces";
import { handleUnauthorized, isUnauthorizedError } from "@/lib/http-error";
import { getActiveOrganizationId } from "@/lib/session-active-organization-id";
import type Workspace from "@/types/workspace";

export const Route = createFileRoute("/_layout/_authenticated/dashboard/")({
  beforeLoad: async ({ context }) => {
    let workspaces: Workspace[];
    let invitations: Awaited<ReturnType<typeof getPendingInvitations>>;
    try {
      workspaces = await getWorkspaces();
      invitations = await getPendingInvitations();
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized();
        return;
      }
      throw error;
    }

    if (invitations && invitations.length > 0 && !workspaces.length) {
      throw redirect({ to: "/invitations" });
    }

    // The protected layout already resolved the session (S7b); a workspace switch clears that
    // cached session through the session signal, so its active workspace is current.
    const activeWorkspaceId = getActiveOrganizationId(context.session);

    if (workspaces && workspaces.length > 0) {
      if (
        activeWorkspaceId &&
        workspaces.some((ws) => ws.id === activeWorkspaceId)
      ) {
        throw redirect({ to: "/agent" });
      }

      const firstWorkspace = workspaces[0];

      // S8a: native replacement for authClient.organization.setActive(). Deliberately not
      // awaited, matching the original: the redirect below fires regardless, and this route
      // does not block navigation on the activation write. Unlike the plugin call, this one
      // throws on failure, so a `.catch` no-op keeps that failure mode silent as before
      // rather than becoming an unhandled promise rejection.
      activateWorkspace(firstWorkspace.id).catch(() => {});

      throw redirect({ to: "/agent" });
    }
    throw redirect({ to: "/onboarding" });
  },
});
