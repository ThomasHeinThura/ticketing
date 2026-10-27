import { useQuery } from "@tanstack/react-query";
import getWorkItemSla from "@/fetchers/work-item/get-work-item-sla";
import { HttpError } from "@/lib/http-error";

/** SLA clocks move with time, so the panel refetches every minute while it is open. */
export default function useGetWorkItemSla(key: string | undefined) {
  return useQuery({
    queryKey: ["work-items", "sla", key],
    queryFn: () => getWorkItemSla(key as string),
    enabled: !!key,
    // 404 is `feature.sla` off (or no reach): settled, not retried or polled.
    retry: (attempt, error) =>
      !(error instanceof HttpError && error.status === 404) && attempt < 2,
    refetchInterval: (query) =>
      query.state.error instanceof HttpError && query.state.error.status === 404
        ? false
        : 60_000,
  });
}
