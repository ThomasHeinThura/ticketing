import { useQuery } from "@tanstack/react-query";
import { getServiceCalendarUsage } from "@/fetchers/service-calendar";

export function useServiceCalendarUsage(id: string) {
  return useQuery({
    queryKey: ["service-calendar-usage", id],
    queryFn: () => getServiceCalendarUsage(id),
    enabled: Boolean(id),
    // Usage is live reference state; never serve a stale count into a
    // delete or timezone-change decision.
    staleTime: 0,
    refetchOnMount: "always",
  });
}
