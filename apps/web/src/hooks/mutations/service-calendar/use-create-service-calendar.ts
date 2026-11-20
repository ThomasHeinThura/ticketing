import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type CreateServiceCalendarRequest,
  createServiceCalendar,
} from "@/fetchers/service-calendar";
import { auditEntity } from "@/query-client/audit-invalidation";

export function useCreateServiceCalendar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateServiceCalendarRequest) =>
      createServiceCalendar(data),
    meta: {
      audits: {
        targets: (_: unknown, r: { id: string; workspaceId: string }) =>
          auditEntity("service_calendar", r.id, {
            kind: "workspace",
            workspaceId: r.workspaceId,
          }),
      },
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({
        queryKey: ["service-calendars", created.workspaceId],
      });
    },
  });
}
