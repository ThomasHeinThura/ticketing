import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type UpdateServiceCalendarRequest,
  updateServiceCalendar,
} from "@/fetchers/service-calendar";
import { auditEntity } from "@/query-client/audit-invalidation";

export function useUpdateServiceCalendar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateServiceCalendarRequest) =>
      updateServiceCalendar(input),
    meta: {
      audits: {
        targets: (_: unknown, r: { id: string; workspaceId: string }) =>
          auditEntity("service_calendar", r.id, {
            kind: "workspace",
            workspaceId: r.workspaceId,
          }),
      },
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["service-calendar", updated.id], updated);
      void queryClient.invalidateQueries({
        queryKey: ["service-calendars", updated.workspaceId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["service-calendar-preview", updated.id],
      });
    },
  });
}
