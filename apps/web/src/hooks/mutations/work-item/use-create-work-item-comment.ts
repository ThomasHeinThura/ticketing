import { useMutation, useQueryClient } from "@tanstack/react-query";
import createWorkItemComment from "@/fetchers/work-item/create-work-item-comment";

function useCreateWorkItemComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkItemComment,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["activities"] }),
  });
}

export default useCreateWorkItemComment;
