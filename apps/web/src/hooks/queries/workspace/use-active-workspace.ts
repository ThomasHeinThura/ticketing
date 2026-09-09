import { useParams } from "@tanstack/react-router";
import useGetWorkspaces from "@/hooks/queries/workspace/use-get-workspaces";
import { authClient } from "@/lib/auth-client";

// S3 (issue #6, retrofit plan §3): replaces authClient.useActiveOrganization()
// (a plugin read) with the native workspace list plus the session's own
// `activeOrganizationId` column -- a core better-auth field, not an
// organization-plugin one (apps/web/src/routes/_layout/_authenticated/
// dashboard/index.tsx already reads it this same way via
// authClient.getSession()).
//
// This still reacts correctly when the four organization.setActive() call
// sites fire (workspace-switcher.tsx, onboarding-flow.tsx,
// create-workspace-modal.tsx, accept.$inviteId.tsx), which stay on the
// plugin per S8a: better-auth's organization client plugin declares
// `/organization/set-active*` as an atomListener for `$sessionSignal`
// (node_modules/better-auth/dist/plugins/organization/client.mjs), which is
// exactly the signal authClient.useSession() is driven by. Verified against
// that source rather than assumed.
function useActiveWorkspace() {
  const { data: session, error } = authClient.useSession();
  const {
    data: workspaces,
    isLoading: isWorkspacesLoading,
    error: workspacesError,
  } = useGetWorkspaces();
  const { workspaceId } = useParams({
    strict: false,
    select: (params) => ({
      workspaceId:
        "workspaceId" in params && typeof params.workspaceId === "string"
          ? params.workspaceId
          : undefined,
    }),
  });

  const activeOrganizationId = session?.session?.activeOrganizationId;
  const targetId = workspaceId ?? activeOrganizationId ?? undefined;
  const workspace = targetId
    ? workspaces?.find((ws) => ws.id === targetId)
    : undefined;

  const combinedError = workspacesError ?? error ?? null;
  const isLoading =
    isWorkspacesLoading || (!!targetId && !workspace && !combinedError);

  return {
    data: workspace,
    error: combinedError,
    isLoading,
    isError: !!combinedError,
  };
}

export default useActiveWorkspace;
