import { useQuery } from "@tanstack/react-query";
import { getProjectMembers } from "@/fetchers/project-member/project-members";

export const projectMembersKey = (projectId: string | undefined) =>
  ["projects", projectId, "members"] as const;

export default function useGetProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: projectMembersKey(projectId),
    queryFn: () => getProjectMembers(projectId as string),
    enabled: Boolean(projectId),
  });
}
