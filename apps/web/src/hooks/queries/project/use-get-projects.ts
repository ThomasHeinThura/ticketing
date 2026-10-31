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
  // `false` and an omitted flag send the same request, so they share one cache entry (the key
  // `lib/work-list-prefetch.ts` also writes) instead of fetching the list twice on one screen.
  const archived = includeArchived ? true : undefined;
  const deleted = includeDeleted ? true : undefined;
  return useQuery({
    queryFn: () =>
      getProjects({
        workspaceId,
        includeArchived: archived ? "true" : undefined,
        includeDeleted: deleted ? "true" : undefined,
      }),
    queryKey: ["projects", workspaceId, archived, deleted],
    enabled: Boolean(workspaceId) && enabled,
    select,
  });
}

export default useGetProjects;
