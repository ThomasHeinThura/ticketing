import { useQuery } from "@tanstack/react-query";
import getActiveWorkspaceUsers from "@/fetchers/workspace-user/get-active-workspace-users";

export function useGetActiveWorkspaceUsers(
  workspaceId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["active-workspace-users", workspaceId],
    queryFn: () => getActiveWorkspaceUsers({ workspaceId }),
    enabled: Boolean(workspaceId) && enabled,
  });
}
