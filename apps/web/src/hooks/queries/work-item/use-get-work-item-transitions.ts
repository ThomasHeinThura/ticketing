import { useQuery } from "@tanstack/react-query";
import getWorkItemTransitions from "@/fetchers/work-item/get-work-item-transitions";

/** The transitions the server says this actor may take now (`workflows.md` § "The state
 * select"). Legality is never computed client-side. */
function useGetWorkItemTransitions({
  key,
  enabled,
}: {
  key: string | undefined;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: ["work-items", "transitions", key],
    queryFn: () => getWorkItemTransitions(key as string),
    enabled: enabled && !!key,
  });
}

export default useGetWorkItemTransitions;
