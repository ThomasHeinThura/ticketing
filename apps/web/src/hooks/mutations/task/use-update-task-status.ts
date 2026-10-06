import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskStatus from "@/fetchers/task/update-task-status";
import type Task from "@/types/task";
import { invalidateTaskFieldQueries } from "./invalidate-task-field-queries";
import {
  beginOptimisticTaskFieldMutation,
  settleOptimisticTaskFieldMutation,
} from "./optimistic-task-version";

type TaskUpdateContext = { version: number };

export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["task-update"],
    mutationFn: (task: Task) => updateTaskStatus(task.id, task),
    onMutate: (task): TaskUpdateContext | Promise<TaskUpdateContext> => {
      const queryKey = ["task", task.id];
      const applyUpdate = (): TaskUpdateContext => {
        const version = beginOptimisticTaskFieldMutation(
          queryClient,
          task.id,
          "status",
          task.status,
          (current) => current?.status,
          (current, value) => ({ ...current, status: value as string }),
        );
        return { version };
      };

      const fetchStatus = queryClient.getQueryState(queryKey)?.fetchStatus;
      if (!fetchStatus || fetchStatus === "idle") return applyUpdate();

      // Query cancellation aborts the current fetch synchronously. Start it before
      // writing so a late response cannot replace this optimistic status, but do not
      // make the visible update wait for the transport to settle after its signal is
      // already aborted. Keep the mutation request ordered after cancellation settles.
      const cancellation = queryClient.cancelQueries({ queryKey });
      const context = applyUpdate();
      return cancellation.then(() => context);
    },
    onError: (_error, task, context) => {
      if (!context) return;
      settleOptimisticTaskFieldMutation(
        queryClient,
        task.id,
        "status",
        context.version,
        false,
        (current, value) => ({ ...current, status: value as string }),
      );
    },
    onSuccess: (_, variables, context) => {
      if (context)
        settleOptimisticTaskFieldMutation(
          queryClient,
          variables.id,
          "status",
          context.version,
          true,
          (current, value) => ({ ...current, status: value as string }),
        );
      invalidateTaskFieldQueries(queryClient, {
        projectId: variables.projectId,
        taskId: variables.id,
        // Project-list completion totals change when a task enters or leaves
        // a final state, so refresh the matching workspace list as well.
        projectStatisticsChanged: true,
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
