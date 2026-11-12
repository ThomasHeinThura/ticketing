import { useQuery } from "@tanstack/react-query";
import getProject from "@/fetchers/project/get-project";

type ProjectData = Awaited<ReturnType<typeof getProject>>;

export function projectOptions(id: string, workspaceId: string) {
  return {
    queryFn: () => getProject({ id, workspaceId }),
    queryKey: ["projects", workspaceId, id],
  };
}

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
    ...projectOptions(id, workspaceId),
    enabled: !!id && !!workspaceId,
    select,
  });
}

export default useGetProject;
