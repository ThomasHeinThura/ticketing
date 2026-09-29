import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type CreateServiceCalendarRequest,
  createServiceCalendar,
  type ServiceCalendar,
} from "@/fetchers/service-calendar";

export function useCreateServiceCalendar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateServiceCalendarRequest) =>
      createServiceCalendar(data),
    onSuccess: (created) => {
      queryClient.setQueryData<ServiceCalendar[]>(
        ["service-calendars", created.workspaceId],
        (existing) =>
          [
            ...(existing ?? []).filter(
              (calendar) => calendar.id !== created.id,
            ),
            created,
          ].sort((left, right) => left.name.localeCompare(right.name)),
      );
    },
  });
}
