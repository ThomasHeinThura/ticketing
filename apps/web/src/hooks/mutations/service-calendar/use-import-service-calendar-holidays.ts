import { useMutation, useQueryClient } from "@tanstack/react-query";
import { importServiceCalendarHolidays } from "@/fetchers/service-calendar";
import { auditEntity } from "@/query-client/audit-invalidation";

export function useImportServiceCalendarHolidays() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importServiceCalendarHolidays,
    meta: {
      audits: {
        targets: (
          _: unknown,
          { calendar }: { calendar: { id: string; workspaceId: string } },
        ) =>
          auditEntity("service_calendar", calendar.id, {
            kind: "workspace",
            workspaceId: calendar.workspaceId,
          }),
      },
    },
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
