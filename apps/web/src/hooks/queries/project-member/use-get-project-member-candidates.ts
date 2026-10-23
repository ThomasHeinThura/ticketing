import { useQuery } from "@tanstack/react-query";
import { getProjectMemberCandidates } from "@/fetchers/project-member/project-members";

export default function useGetProjectMemberCandidates(
  projectId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["projects", projectId, "members", "candidates"],
    queryFn: () => getProjectMemberCandidates(projectId as string),
    enabled: Boolean(projectId) && enabled,
  });
}
