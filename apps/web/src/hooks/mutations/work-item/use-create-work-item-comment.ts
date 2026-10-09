import { useMutation } from "@tanstack/react-query";
import createWorkItemComment from "@/fetchers/work-item/create-work-item-comment";

function useCreateWorkItemComment() {
  return useMutation({ mutationFn: createWorkItemComment });
}

export default useCreateWorkItemComment;
