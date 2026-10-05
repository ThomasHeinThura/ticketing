import { useQuery } from "@tanstack/react-query";
import getProject from "@/fetchers/project/get-project";

type ProjectData = Awaited<ReturnType<typeof getProject>>;

function useGetProject<TSelected = ProjectData>(
  {
    id,
    workspaceId,
  }: {
    id: string;
    workspaceId: string;
  },
  select?: (project: ProjectData) => TSelected,
) {
  return useQuery({
    queryFn: () => getProject({ id, workspaceId }),
    queryKey: ["projects", workspaceId, id],
    enabled: !!id,
    select,
  });
}

export default useGetProject;
