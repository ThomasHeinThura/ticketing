import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type CreateServiceCalendarRequest,
  createServiceCalendar,
} from "@/fetchers/service-calendar";

export function useCreateServiceCalendar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateServiceCalendarRequest) =>
      createServiceCalendar(data),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({
        queryKey: ["service-calendars", created.workspaceId],
      });
    },
  });
}
