import { useQuery } from "@tanstack/react-query";
import getProjectStateTemplates from "@/fetchers/project/get-project-state-templates";

export default function useGetProjectStateTemplates(
  projectId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["projects", projectId, "state-templates"],
    queryFn: () => getProjectStateTemplates(projectId as string),
    enabled: Boolean(projectId) && enabled,
  });
}
