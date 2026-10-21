import { useQuery } from "@tanstack/react-query";
import getWorkItemSla from "@/fetchers/work-item/get-work-item-sla";

/** SLA clocks move with time, so the panel refetches every minute while it is open. */
export default function useGetWorkItemSla(key: string | undefined) {
  return useQuery({
    queryKey: ["work-items", "sla", key],
    queryFn: () => getWorkItemSla(key as string),
    enabled: !!key,
    refetchInterval: 60_000,
  });
}
