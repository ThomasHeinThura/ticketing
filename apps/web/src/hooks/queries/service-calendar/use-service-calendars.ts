import { useQuery } from "@tanstack/react-query";
import { getServiceCalendars } from "@/fetchers/service-calendar";

export function useServiceCalendars(workspaceId: string, cursor?: string) {
  return useQuery({
    queryKey: ["service-calendars", workspaceId, cursor ?? null],
    queryFn: () => getServiceCalendars(workspaceId, cursor),
    enabled: Boolean(workspaceId),
  });
}
