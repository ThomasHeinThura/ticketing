import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskAssignee from "@/fetchers/task/update-task-assignee";
import type Task from "@/types/task";
import { invalidateTaskFieldQueries } from "./invalidate-task-field-queries";
import {
  beginOptimisticTaskFieldMutation,
  settleOptimisticTaskFieldMutation,
} from "./optimistic-task-version";

type AssigneeFields = Pick<Task, "userId" | "assigneeId" | "assigneeName">;
type TaskUpdateContext = { version: number };

function equalAssigneeFields(current: unknown, next: unknown) {
  if (
    !current ||
    !next ||
    typeof current !== "object" ||
    typeof next !== "object"
  )
    return current === next;

  const currentFields = current as AssigneeFields;
  const nextFields = next as AssigneeFields;
  return (
    currentFields.userId === nextFields.userId &&
    currentFields.assigneeId === nextFields.assigneeId &&
    currentFields.assigneeName === nextFields.assigneeName
  );
}

export function useUpdateTaskAssignee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["task-update"],
    mutationFn: (task: Task) => updateTaskAssignee(task.id, task),
    onMutate: (task): TaskUpdateContext | Promise<TaskUpdateContext> => {
      const queryKey = ["task", task.id];
      const applyUpdate = (): TaskUpdateContext => {
        const assignee = {
          userId: task.userId,
          assigneeId: task.assigneeId,
          assigneeName: task.assigneeName,
        };
        const version = beginOptimisticTaskFieldMutation(
          queryClient,
          task.id,
          "assignee",
          assignee,
          (current) =>
            current
              ? {
                  userId: current.userId,
                  assigneeId: current.assigneeId,
                  assigneeName: current.assigneeName,
                }
              : undefined,
          (current, value) => ({
            ...current,
            ...(value as AssigneeFields),
          }),
          equalAssigneeFields,
        );
        return { version };
      };

      const fetchStatus = queryClient.getQueryState(queryKey)?.fetchStatus;
      if (!fetchStatus || fetchStatus === "idle") return applyUpdate();

      // Abort an older detail read before the mutation is sent, but let the
      // optimistic assignee render while that canceled transport settles. The
      // canceled query cannot replace the cache afterward; `onMutate` still
      // resolves only after cancellation, so the write remains ordered safely.
      const cancellation = queryClient.cancelQueries({ queryKey });
      const context = applyUpdate();
      return cancellation.then(() => context);
    },
    onError: (_error, task, context) => {
      if (!context) return;
      settleOptimisticTaskFieldMutation(
        queryClient,
        task.id,
        "assignee",
        context.version,
        false,
        (current, value) => ({
          ...current,
          ...(value as AssigneeFields),
        }),
      );
    },
    onSuccess: (_, variables, context) => {
      if (context)
        settleOptimisticTaskFieldMutation(
          queryClient,
          variables.id,
          "assignee",
          context.version,
          true,
          (current, value) => ({
            ...current,
            ...(value as AssigneeFields),
          }),
        );
      invalidateTaskFieldQueries(queryClient, {
        projectId: variables.projectId,
        taskId: variables.id,
        // Assignment does not affect project-level completion statistics.
        projectStatisticsChanged: false,
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
