import { useQuery } from "@tanstack/react-query";
import { getServiceCalendars } from "@/fetchers/service-calendar";
import { HttpError } from "@/lib/http-error";
import { shouldRetryQuery } from "@/query-client";

export function useServiceCalendars(workspaceId: string, cursor?: string) {
  return useQuery({
    queryKey: ["service-calendars", workspaceId, cursor ?? null],
    queryFn: () => getServiceCalendars(workspaceId, cursor),
    enabled: Boolean(workspaceId),
    retry: (failureCount, error) =>
      error instanceof HttpError && error.status === 400
        ? false
        : shouldRetryQuery(failureCount, error),
  });
}
