import { useQuery } from "@tanstack/react-query";
import { getServiceCalendars } from "@/fetchers/service-calendar";

export function useServiceCalendars(workspaceId: string) {
  return useQuery({
    queryKey: ["service-calendars", workspaceId],
    queryFn: () => getServiceCalendars(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
