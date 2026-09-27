import { useQuery } from "@tanstack/react-query";
import getWorkItemTypes from "@/fetchers/work-item/get-work-item-types";

function useGetWorkItemTypes({
  workspaceId,
}: {
  workspaceId: string | undefined;
}) {
  return useQuery({
    queryKey: ["work-item-types", workspaceId],
    queryFn: () => getWorkItemTypes(workspaceId as string),
    enabled: !!workspaceId,
  });
}

export default useGetWorkItemTypes;
