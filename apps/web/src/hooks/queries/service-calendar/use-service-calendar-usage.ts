import { useQuery } from "@tanstack/react-query";
import { getServiceCalendarUsage } from "@/fetchers/service-calendar";
import { shouldRetryQuery } from "@/query-client";

export function useServiceCalendarUsage(id: string) {
  return useQuery({
    queryKey: ["service-calendar-usage", id],
    queryFn: () => getServiceCalendarUsage(id),
    enabled: Boolean(id),
    retry: shouldRetryQuery,
  });
}
