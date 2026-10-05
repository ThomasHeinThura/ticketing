import { useQuery } from "@tanstack/react-query";
import { getSlaPolicy } from "@/fetchers/sla-policy";
import { shouldRetryQuery } from "@/query-client";

export function useSlaPolicy(id: string, enabled = true) {
  return useQuery({
    queryKey: ["sla-policy", id],
    queryFn: () => getSlaPolicy(id),
    enabled: Boolean(id) && enabled,
    retry: (failureCount, error) => shouldRetryQuery(failureCount, error),
  });
}
