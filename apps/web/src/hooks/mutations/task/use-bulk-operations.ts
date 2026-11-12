import { useMutation, useQueryClient } from "@tanstack/react-query";
import bulkOperation from "@/fetchers/task/bulk-operation";

export function useBulkOperations() {
  const queryClientRef = useQueryClient();

  const invalidateCommon = (taskIds: string[]) => {
    queryClientRef.invalidateQueries({ queryKey: ["tasks"] });
    queryClientRef.invalidateQueries({ queryKey: ["projects"] });
    for (const id of new Set(taskIds))
      queryClientRef.invalidateQueries({ queryKey: ["task", id] });
  };

  const bulkArchive = useMutation({
    mutationFn: async (taskIds: string[]) => {
      await bulkOperation({
        taskIds,
        operation: "updateStatus",
        value: "archived",
      });
    },
    onSuccess: (_result, taskIds) => invalidateCommon(taskIds),
  });

  const bulkChangeStatus = useMutation({
    mutationFn: async ({
      taskIds,
      status,
    }: {
      taskIds: string[];
      status: string;
    }) => {
      await bulkOperation({
        taskIds,
        operation: "updateStatus",
        value: status,
      });
    },
    onSuccess: (_result, { taskIds }) => invalidateCommon(taskIds),
  });

  const bulkAssign = useMutation({
    mutationFn: async ({
      taskIds,
      userId,
    }: {
      taskIds: string[];
      userId: string;
    }) => {
      await bulkOperation({
        taskIds,
        operation: "updateAssignee",
        value: userId,
      });
    },
    onSuccess: (_result, { taskIds }) => invalidateCommon(taskIds),
  });

  const bulkMoveToBacklog = useMutation({
    mutationFn: async (taskIds: string[]) => {
      await bulkOperation({
        taskIds,
        operation: "updateStatus",
        value: "planned",
      });
    },
    onSuccess: (_result, taskIds) => invalidateCommon(taskIds),
  });

  const bulkMoveToBoard = useMutation({
    mutationFn: async ({
      taskIds,
      status,
    }: {
      taskIds: string[];
      status: string;
    }) => {
      await bulkOperation({
        taskIds,
        operation: "updateStatus",
        value: status,
      });
    },
    onSuccess: (_result, { taskIds }) => invalidateCommon(taskIds),
  });

  const bulkPriority = useMutation({
    mutationFn: async ({
      taskIds,
      priority,
    }: {
      taskIds: string[];
      priority: string;
    }) => {
      await bulkOperation({
        taskIds,
        operation: "updatePriority",
        value: priority,
      });
    },
    onSuccess: (_result, { taskIds }) => invalidateCommon(taskIds),
  });

  const bulkAddLabel = useMutation({
    mutationFn: async ({
      taskIds,
      labelId,
    }: {
      taskIds: string[];
      labelId: string;
    }) => {
      await bulkOperation({
        taskIds,
        operation: "addLabel",
        value: labelId,
      });
    },
    onSuccess: (_result, { taskIds }) => {
      invalidateCommon(taskIds);
      queryClientRef.invalidateQueries({ queryKey: ["labels"] });
    },
  });

  const bulkDueDate = useMutation({
    mutationFn: async ({
      taskIds,
      dueDate,
    }: {
      taskIds: string[];
      dueDate: string | null;
    }) => {
      await bulkOperation({
        taskIds,
        operation: "updateDueDate",
        value: dueDate,
      });
    },
    onSuccess: (_result, { taskIds }) => invalidateCommon(taskIds),
  });

  return {
    bulkArchive: bulkArchive.mutateAsync,
    bulkChangeStatus: bulkChangeStatus.mutateAsync,
    bulkAssign: bulkAssign.mutateAsync,
    bulkMoveToBacklog: bulkMoveToBacklog.mutateAsync,
    bulkMoveToBoard: bulkMoveToBoard.mutateAsync,
    bulkPriority: bulkPriority.mutateAsync,
    bulkAddLabel: bulkAddLabel.mutateAsync,
    bulkDueDate: bulkDueDate.mutateAsync,
  };
}
