import { useQuery } from "@tanstack/react-query";
import { getServiceCalendarPreview } from "@/fetchers/service-calendar";

export function useServiceCalendarPreview(id: string, year: number) {
  return useQuery({
    queryKey: ["service-calendar-preview", id, year],
    queryFn: () => getServiceCalendarPreview(id, year),
    enabled: Boolean(id),
  });
}
