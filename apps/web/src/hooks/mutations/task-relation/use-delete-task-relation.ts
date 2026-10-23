import { useMutation } from "@tanstack/react-query";
import deleteTaskRelation from "@/fetchers/task-relation/delete-task-relation";

/** Requests relation removal; nothing is removed (or refetched) until the approval executes. */
function useDeleteTaskRelation() {
  return useMutation({ mutationFn: deleteTaskRelation });
}

export default useDeleteTaskRelation;
