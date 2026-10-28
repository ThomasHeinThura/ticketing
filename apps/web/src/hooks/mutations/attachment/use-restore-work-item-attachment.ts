import { useMutation, useQueryClient } from "@tanstack/react-query";
import { restoreWorkItemAttachment } from "@/fetchers/attachment/work-item-attachments";

export default function useRestoreWorkItemAttachment(workItemKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restoreWorkItemAttachment,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["work-items", "attachments", workItemKey],
        }),
        queryClient.invalidateQueries({
          queryKey: ["work-items", "activity", workItemKey],
        }),
      ]);
    },
  });
}
