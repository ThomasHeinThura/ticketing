import { useQuery } from "@tanstack/react-query";
import getProjects from "@/fetchers/project/get-projects";

type Projects = Awaited<ReturnType<typeof getProjects>>;

function useGetProjects<TSelected = Projects>(
  {
    workspaceId,
    includeArchived,
    includeDeleted,
  }: {
    workspaceId: string;
    includeArchived?: boolean;
    includeDeleted?: boolean;
  },
  enabled = true,
  select?: (projects: Projects) => TSelected,
) {
  return useQuery({
    queryFn: () =>
      getProjects({
        workspaceId,
        includeArchived: includeArchived ? "true" : undefined,
        includeDeleted: includeDeleted ? "true" : undefined,
      }),
    queryKey: ["projects", workspaceId, includeArchived, includeDeleted],
    enabled: Boolean(workspaceId) && enabled,
    select,
  });
}

export default useGetProjects;
