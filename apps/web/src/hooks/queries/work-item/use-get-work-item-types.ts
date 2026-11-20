import { useQuery } from "@tanstack/react-query";
import getWorkItemTypes from "@/fetchers/work-item/get-work-item-types";

function useGetWorkItemTypes({
  workspaceId,
  projectId,
}: {
  workspaceId: string | undefined;
  projectId?: string;
}) {
  return useQuery({
    queryKey: projectId
      ? ["work-item-types", workspaceId, projectId]
      : ["work-item-types", workspaceId],
    queryFn: () =>
      projectId
        ? getWorkItemTypes(workspaceId as string, projectId)
        : getWorkItemTypes(workspaceId as string),
    enabled: !!workspaceId,
  });
}

export default useGetWorkItemTypes;
