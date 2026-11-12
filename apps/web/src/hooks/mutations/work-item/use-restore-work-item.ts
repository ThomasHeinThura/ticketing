import { useMutation, useQueryClient } from "@tanstack/react-query";
import restoreWorkItem from "@/fetchers/work-item/restore-work-item";

type RestoreInput = { key: string; version: number; projectId: string };

function useRestoreWorkItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, version }: RestoreInput) =>
      restoreWorkItem({ key, version }),
    onSuccess: async (_item, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["work-items", input.projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["work-items", "detail", input.key],
        }),
      ]);
    },
  });
}

export default useRestoreWorkItem;
