import { createFileRoute, redirect } from "@tanstack/react-router";
import { getPendingInvitations } from "@/fetchers/invitation/get-pending-invitations";
import activateWorkspace from "@/fetchers/workspace/activate-workspace";
import getWorkspaces from "@/fetchers/workspace/get-workspaces";
import { authClient } from "@/lib/auth-client";
import { handleUnauthorized, isUnauthorizedError } from "@/lib/http-error";
import type Workspace from "@/types/workspace";

export const Route = createFileRoute("/_layout/_authenticated/dashboard/")({
  beforeLoad: async () => {
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

    const session = await authClient.getSession();
    const activeWorkspaceId = session?.data?.session?.activeOrganizationId;

    if (workspaces && workspaces.length > 0) {
      if (
        activeWorkspaceId &&
        workspaces.some((ws) => ws.id === activeWorkspaceId)
      ) {
        throw redirect({
          to: "/dashboard/workspace/$workspaceId",
          params: { workspaceId: activeWorkspaceId },
        });
      }

      const firstWorkspace = workspaces[0];

      // S8a: native replacement for authClient.organization.setActive(). Deliberately not
      // awaited, matching the original: the redirect below fires regardless, and this route
      // does not block navigation on the activation write. Unlike the plugin call, this one
      // throws on failure, so a `.catch` no-op keeps that failure mode silent as before
      // rather than becoming an unhandled promise rejection.
      activateWorkspace(firstWorkspace.id).catch(() => {});

      throw redirect({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId: firstWorkspace.id },
      });
    }
    throw redirect({ to: "/onboarding" });
  },
});
