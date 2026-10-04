import { useQuery } from "@tanstack/react-query";
import { getRequestTypes } from "@/fetchers/request-type";
import { shouldRetryQuery } from "@/query-client";

export function useRequestTypes(workspaceId: string) {
  return useQuery({
    queryKey: ["request-types", workspaceId],
    queryFn: () => getRequestTypes(workspaceId),
    enabled: Boolean(workspaceId),
    retry: (failureCount, error) => shouldRetryQuery(failureCount, error),
  });
}
