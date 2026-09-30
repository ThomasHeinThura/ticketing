import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskAssignee from "@/fetchers/task/update-task-assignee";
import type Task from "@/types/task";

type AssigneeFields = Pick<Task, "userId" | "assigneeId" | "assigneeName">;
type TaskUpdateContext = { previousAssignee?: AssigneeFields };

export function useUpdateTaskAssignee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (task: Task) => updateTaskAssignee(task.id, task),
    onMutate: async (task): Promise<TaskUpdateContext> => {
      const queryKey = ["task", task.id];
      await queryClient.cancelQueries({ queryKey });
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
      return { previousAssignee };
    },
    onError: (_error, task, context) => {
      const previousAssignee = context?.previousAssignee;
      if (!previousAssignee) return;
      queryClient.setQueryData<Task>(["task", task.id], (current) =>
        current ? { ...current, ...previousAssignee } : current,
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
