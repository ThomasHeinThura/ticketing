import { useQuery } from "@tanstack/react-query";
import getProjectStates from "@/fetchers/project/get-project-states";

export default function useGetProjectStates(
  projectId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["projects", projectId, "states"],
    queryFn: () => getProjectStates(projectId as string),
    enabled: Boolean(projectId) && enabled,
  });
}
