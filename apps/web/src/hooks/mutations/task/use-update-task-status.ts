import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskStatus from "@/fetchers/task/update-task-status";
import type Task from "@/types/task";
import {
  isCurrentTaskFieldMutationVersion,
  nextTaskFieldMutationVersion,
} from "./optimistic-task-version";

type TaskUpdateContext = { previousStatus?: string; version: number };

export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["task-update"],
    mutationFn: (task: Task) => updateTaskStatus(task.id, task),
    onMutate: async (task): Promise<TaskUpdateContext> => {
      const queryKey = ["task", task.id];
      await queryClient.cancelQueries({ queryKey });
      const version = nextTaskFieldMutationVersion(
        queryClient,
        task.id,
        "status",
      );
      const previousTask = queryClient.getQueryData<Task>(queryKey);
      const previousStatus = previousTask?.status;
      if (previousTask)
        queryClient.setQueryData<Task>(queryKey, {
          ...previousTask,
          status: task.status,
        });
      return { previousStatus, version };
    },
    onError: (_error, task, context) => {
      const previousStatus = context?.previousStatus;
      if (
        previousStatus === undefined ||
        context === undefined ||
        !isCurrentTaskFieldMutationVersion(
          queryClient,
          task.id,
          "status",
          context.version,
        )
      )
        return;
      queryClient.setQueryData<Task>(["task", task.id], (current) =>
        current ? { ...current, status: previousStatus } : current,
      );
    },
    onSuccess: (_, variables) => {
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
    onSettled: (_data, _error, task) => {
      if (
        queryClient.isMutating({
          predicate: (mutation) =>
            mutation.options.mutationKey?.[0] === "task-update" &&
            (mutation.state.variables as Task | undefined)?.id === task.id,
        }) === 1
      )
        queryClient.invalidateQueries({ queryKey: ["task", task.id] });
    },
  });
}
