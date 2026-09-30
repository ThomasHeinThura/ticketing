import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskStatus from "@/fetchers/task/update-task-status";
import type Task from "@/types/task";

type TaskUpdateContext = { previousStatus?: string };

export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (task: Task) => updateTaskStatus(task.id, task),
    onMutate: async (task): Promise<TaskUpdateContext> => {
      const queryKey = ["task", task.id];
      await queryClient.cancelQueries({ queryKey });
      const previousTask = queryClient.getQueryData<Task>(queryKey);
      const previousStatus = previousTask?.status;
      if (previousTask)
        queryClient.setQueryData<Task>(queryKey, {
          ...previousTask,
          status: task.status,
        });
      return { previousStatus };
    },
    onError: (_error, task, context) => {
      const previousStatus = context?.previousStatus;
      if (previousStatus === undefined) return;
      queryClient.setQueryData<Task>(["task", task.id], (current) =>
        current ? { ...current, status: previousStatus } : current,
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["task", variables.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["tasks", variables.projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["notifications"],
      });
      queryClient.invalidateQueries({
        queryKey: ["projects"],
      });
      queryClient.invalidateQueries({
        queryKey: ["activities", variables.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["task-relations"],
      });
    },
  });
}
