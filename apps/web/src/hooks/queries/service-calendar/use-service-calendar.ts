import { useQuery } from "@tanstack/react-query";
import { getServiceCalendar } from "@/fetchers/service-calendar";

export function useServiceCalendar(id: string) {
  return useQuery({
    queryKey: ["service-calendar", id],
    queryFn: () => getServiceCalendar(id),
    enabled: Boolean(id),
  });
}
