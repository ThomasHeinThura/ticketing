import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskAssignee from "@/fetchers/task/update-task-assignee";
import type Task from "@/types/task";
import {
  isCurrentTaskFieldMutationVersion,
  nextTaskFieldMutationVersion,
} from "./optimistic-task-version";

type AssigneeFields = Pick<Task, "userId" | "assigneeId" | "assigneeName">;
type TaskUpdateContext = { previousAssignee?: AssigneeFields; version: number };

export function useUpdateTaskAssignee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["task-update"],
    mutationFn: (task: Task) => updateTaskAssignee(task.id, task),
    onMutate: (task): TaskUpdateContext | Promise<TaskUpdateContext> => {
      const queryKey = ["task", task.id];
      const applyUpdate = (): TaskUpdateContext => {
        const version = nextTaskFieldMutationVersion(
          queryClient,
          task.id,
          "assignee",
        );
        const previousTask = queryClient.getQueryData<Task>(queryKey);
        const previousAssignee = previousTask
          ? {
              userId: previousTask.userId,
              assigneeId: previousTask.assigneeId,
              assigneeName: previousTask.assigneeName,
            }
          : undefined;
        if (previousTask)
          queryClient.setQueryData<Task>(queryKey, {
            ...previousTask,
            userId: task.userId,
            assigneeId: task.assigneeId,
            assigneeName: task.assigneeName,
          });
        return { previousAssignee, version };
      };

      const fetchStatus = queryClient.getQueryState(queryKey)?.fetchStatus;
      if (!fetchStatus || fetchStatus === "idle") return applyUpdate();
      return queryClient.cancelQueries({ queryKey }).then(applyUpdate);
    },
    onError: (_error, task, context) => {
      const previousAssignee = context?.previousAssignee;
      if (
        !previousAssignee ||
        context === undefined ||
        !isCurrentTaskFieldMutationVersion(
          queryClient,
          task.id,
          "assignee",
          context.version,
        )
      )
        return;
      queryClient.setQueryData<Task>(["task", task.id], (current) =>
        current ? { ...current, ...previousAssignee } : current,
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
