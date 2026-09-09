import { useQuery } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";

type GetWorkspaceInvitesRequest = {
  workspaceId?: string;
};

// S3 (issue #6, retrofit plan §3): native replacement for
// authClient.organization.listInvitations() -- GET
// /api/workspace/{workspaceId}/invitations. Adds an `enabled` guard the
// plugin-backed version lacked: the native route requires `workspaceId` as a
// path segment, so it cannot be called with it undefined the way the old
// version could (relying on the plugin defaulting to the session's active
// organization).
function useGetWorkspaceInvites({ workspaceId }: GetWorkspaceInvitesRequest) {
  return useQuery({
    queryKey: ["workspace-invites", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const response = await client.workspace[":workspaceId"].invitations.$get({
        param: { workspaceId: workspaceId as string },
      });

      if (!response.ok) {
        throw new Error("Failed to get workspace invites");
      }

      return response.json();
    },
  });
}

export default useGetWorkspaceInvites;
