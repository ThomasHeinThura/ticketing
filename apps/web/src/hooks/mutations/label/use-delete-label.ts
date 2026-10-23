import { useMutation } from "@tanstack/react-query";
import deleteLabel from "@/fetchers/label/delete-label";

/**
 * Requests label deletion (`202` pending action). The label stays in every cache until the
 * requester approves the action, so nothing is removed optimistically here.
 */
function useDeleteLabel() {
  return useMutation({
    mutationFn: deleteLabel,
  });
}

export default useDeleteLabel;
