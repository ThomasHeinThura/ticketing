import { useQuery } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";

type GetWorkspaceUsersRequest = {
  workspaceId?: string;
};

// S3 (issue #6, retrofit plan §3): native replacement for
// authClient.organization.listMembers() -- GET
// /api/workspace/{workspaceId}/members. The native route has no server-side
// sort/filter/pagination (apps/api/src/workspace/index.ts's
// getWorkspaceMembersRoute takes only `workspaceId`), unlike the plugin's
// listMembers(query: {limit, offset, sortBy, sortDirection, filterField,
// filterOperator, filterValue}); this hook's only real caller
// (apps/web/src/components/activity/index.tsx) never passed any of those,
// so they are dropped rather than silently ignored -- see the S3 report for
// the note that a future paginated/sorted members list needs its own native
// route.
function useGetWorkspaceUsers({ workspaceId }: GetWorkspaceUsersRequest) {
  return useQuery({
    queryKey: ["workspace-users", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const response = await client.workspace[":workspaceId"].members.$get({
        param: { workspaceId: workspaceId as string },
      });

      if (!response.ok) {
        throw new Error("Failed to get workspace users");
      }

      return response.json();
    },
  });
}

export default useGetWorkspaceUsers;
