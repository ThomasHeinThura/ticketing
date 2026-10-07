import { useMutation } from "@tanstack/react-query";
import updateWorkItemComment from "@/fetchers/work-item/update-work-item-comment";

function useUpdateWorkItemComment() {
  return useMutation({ mutationFn: updateWorkItemComment });
}

export default useUpdateWorkItemComment;
