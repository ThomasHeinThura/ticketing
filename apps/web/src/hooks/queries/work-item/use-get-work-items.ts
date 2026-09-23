import { useQuery } from "@tanstack/react-query";
import getWorkItems from "@/fetchers/work-item/get-work-items";

function useGetWorkItems({ projectId }: { projectId: string | undefined }) {
  return useQuery({
    queryKey: ["work-items", projectId],
    queryFn: () => getWorkItems(projectId as string),
    enabled: !!projectId,
  });
}

export default useGetWorkItems;
