import { useMutation } from "@tanstack/react-query";
import deleteComment from "@/fetchers/comment/delete-comment";

/** Requests comment deletion; nothing is removed (or refetched) until the approval executes. */
function useDeleteComment() {
  return useMutation({ mutationFn: deleteComment });
}

export default useDeleteComment;
