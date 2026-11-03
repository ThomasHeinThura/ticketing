import { useQuery } from "@tanstack/react-query";
import getRequesterCandidates from "@/fetchers/work-item/get-requester-candidates";

/** A-03: the customers the Requester field may name; the server filters to the organisation. */
function useGetRequesterCandidates({
  projectId,
  enabled,
}: {
  projectId: string | undefined;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: ["projects", projectId, "requester-candidates"],
    queryFn: () => getRequesterCandidates(projectId as string),
    enabled: enabled && !!projectId,
  });
}

export default useGetRequesterCandidates;
