import { useMutation, useQueryClient } from "@tanstack/react-query";
import { importServiceCalendarHolidays } from "@/fetchers/service-calendar";

export function useImportServiceCalendarHolidays() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importServiceCalendarHolidays,
    onSuccess: ({ calendar }) => {
      queryClient.setQueryData(["service-calendar", calendar.id], calendar);
      void queryClient.invalidateQueries({
        queryKey: ["service-calendars", calendar.workspaceId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["service-calendar-preview", calendar.id],
      });
    },
  });
}
