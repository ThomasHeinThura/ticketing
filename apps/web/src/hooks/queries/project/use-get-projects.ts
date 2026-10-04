import { useQuery } from "@tanstack/react-query";
import getProjects from "@/fetchers/project/get-projects";

function useGetProjects(
  { workspaceId }: { workspaceId: string },
  enabled = true,
) {
  return useQuery({
    queryFn: () => getProjects({ workspaceId }),
    queryKey: ["projects", workspaceId],
    enabled: Boolean(workspaceId) && enabled,
  });
}

export default useGetProjects;
