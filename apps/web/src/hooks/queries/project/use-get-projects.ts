import { useQuery } from "@tanstack/react-query";
import getProjects from "@/fetchers/project/get-projects";

type Projects = Awaited<ReturnType<typeof getProjects>>;

function useGetProjects<TSelected = Projects>(
  { workspaceId }: { workspaceId: string },
  enabled = true,
  select?: (projects: Projects) => TSelected,
) {
  return useQuery({
    queryFn: () => getProjects({ workspaceId }),
    queryKey: ["projects", workspaceId],
    enabled: Boolean(workspaceId) && enabled,
    select,
  });
}

export default useGetProjects;
