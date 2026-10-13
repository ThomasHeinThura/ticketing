import { useQuery } from "@tanstack/react-query";
import getAssignablePeople from "@/fetchers/work-item/get-assignable-people";

/** The people the caller may assign to (`assignment.md` `AS-5`): the server already filters
 * by capability, so the client never narrows this list itself. */
function useGetAssignablePeople({
  projectId,
  enabled,
}: {
  projectId: string | undefined;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: ["projects", projectId, "assignable"],
    queryFn: () => getAssignablePeople(projectId as string),
    enabled: enabled && !!projectId,
  });
}

export default useGetAssignablePeople;
