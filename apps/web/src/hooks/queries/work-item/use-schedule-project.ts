import { useQuery } from "@tanstack/react-query";
import { getScheduleProject } from "@/fetchers/work-item/get-schedule-project";
import { HttpError } from "@/lib/http-error";
export function useScheduleProject(
  projectId: string,
  workspaceId: string,
  filter = "",
) {
  const accessLost = (error: unknown) =>
    error instanceof HttpError && [401, 403, 404].includes(error.status);
  const query = useQuery({
    queryKey: ["work-items", projectId, "schedule", workspaceId, filter],
    queryFn: ({ signal }) =>
      getScheduleProject(projectId, workspaceId, signal, filter),
    enabled: Boolean(projectId && workspaceId),
    retry: (attempt, error) => !accessLost(error) && attempt < 2,
    refetchInterval: (query) => (accessLost(query.state.error) ? false : 30000),
  });
  return { ...query, data: query.isError ? undefined : query.data };
}
