import { useQuery } from "@tanstack/react-query";
import { getSlaPolicies } from "@/fetchers/sla-policy";
import { shouldRetryQuery } from "@/query-client";

export function useSlaPolicies(workspaceId: string, cursor?: string) {
  return useQuery({
    queryKey: ["sla-policies", workspaceId, cursor ?? null],
    queryFn: () => getSlaPolicies(workspaceId, cursor),
    enabled: Boolean(workspaceId),
    retry: (failureCount, error) => shouldRetryQuery(failureCount, error),
  });
}
