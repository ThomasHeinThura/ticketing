import { useMutation, useQueryClient } from "@tanstack/react-query";
import { requestServiceCalendarDeletion } from "@/fetchers/service-calendar";

export function useRequestServiceCalendarDeletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => requestServiceCalendarDeletion(id),
    onError: (_error, id) => {
      // A 409 means references changed; refresh the counts shown to the user.
      void queryClient.invalidateQueries({
        queryKey: ["service-calendar-usage", id],
      });
    },
  });
}
