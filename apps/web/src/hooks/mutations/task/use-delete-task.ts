import { useMutation } from "@tanstack/react-query";
import requestTaskDeletion from "@/fetchers/task/delete-task";

/**
 * Requests deletion of a work item by key (`202` pending action). The task stays in every
 * cache and view until the requester approves the action.
 */
export function useDeleteTask() {
  return useMutation({
    mutationFn: (workItemKey: string) => requestTaskDeletion(workItemKey),
  });
}
