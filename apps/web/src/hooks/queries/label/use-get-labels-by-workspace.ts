import { useQuery } from "@tanstack/react-query";
import getLabelsByWorkspace from "@/fetchers/label/get-label-by-workspace";

function useGetLabelsByWorkspace(workspaceId: string, enabled = true) {
  return useQuery({
    enabled: Boolean(workspaceId) && enabled,
    queryKey: ["labels", workspaceId],
    queryFn: () => getLabelsByWorkspace({ workspaceId }),
  });
}

export default useGetLabelsByWorkspace;
