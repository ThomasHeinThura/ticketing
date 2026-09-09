import { useQuery } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";

type GetFullWorkspaceRequest = {
  workspaceId?: string;
};

// S3 (issue #6, retrofit plan §3): native replacement for
// authClient.organization.getFullOrganization() -- GET
// /api/workspace/{workspaceId}. The native route has no slug-based lookup
// and no member-count limit, unlike the plugin's getFullOrganization(query:
// {organizationId, organizationSlug, membersLimit}); neither
// `workspaceSlug` nor `membersLimit` had a real caller (verified: both named
// consumers of this hook -- apps/web/src/routes/_layout/_authenticated/
// dashboard/workspace/$workspaceId/members.tsx and .../settings/workspace/
// general.tsx -- only ever pass `workspaceId`), so the parameter is dropped
// rather than silently ignored.
function useGetFullWorkspace({ workspaceId }: GetFullWorkspaceRequest) {
  return useQuery({
    queryKey: ["workspace", "full", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const response = await client.workspace[":workspaceId"].$get({
        param: { workspaceId: workspaceId as string },
      });

      if (!response.ok) {
        throw new Error("Failed to get full workspace");
      }

      return response.json();
    },
  });
}

export default useGetFullWorkspace;
