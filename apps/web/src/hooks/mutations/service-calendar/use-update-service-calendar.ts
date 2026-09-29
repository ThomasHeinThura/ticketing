import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type ServiceCalendar,
  type UpdateServiceCalendarRequest,
  updateServiceCalendar,
} from "@/fetchers/service-calendar";

export function useUpdateServiceCalendar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateServiceCalendarRequest) =>
      updateServiceCalendar(input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["service-calendar", updated.id], updated);
      queryClient.setQueryData<ServiceCalendar[]>(
        ["service-calendars", updated.workspaceId],
        (existing) =>
          existing
            ?.map((calendar) =>
              calendar.id === updated.id ? updated : calendar,
            )
            .sort((left, right) => left.name.localeCompare(right.name)),
      );
      void queryClient.invalidateQueries({
        queryKey: ["service-calendar-preview", updated.id],
      });
    },
  });
}
